// The logic of "Restore from a file" without the screen (SPEC §11, D57, D74), so it runs in Jest:
//  1. check the picked file's SIZE before reading it (a 2 GB pick must never be read into memory),
//  2. read it, validate it completely (nothing is written yet) and report what it holds,
//  3. only after the user confirms: keep a safety copy of what is on the phone now, then replace everything in one
//     transaction (a failure rolls back to exactly the old data). "Undo last restore" is a restore of the safety copy.
import {
  backupFileSizeProblem,
  dataCounts,
  exportBackup,
  nextLowerPhotoEdge,
  parseBackup,
  restoreBackup,
  serializeBackup,
  writeBackupStream,
  type BackupError,
  type BackupFile,
  type BackupSummary,
  type PhotoSink,
  type PhotoSource,
  type RestoreProgress,
  type StreamResult,
} from '@/db/backup';
import { withRead } from '@/db/tx';
import type { Db } from '@/db/types';

/** What the picker gave us, reduced to what the check needs. */
export type PickedFileLike = { name: string; size: number; text(): Promise<string> };

export type CheckedBackup = { ok: true; backup: BackupFile; summary: BackupSummary; checkMs: number } | { ok: false; error: BackupError };

/** Lets the screen paint "Checking the file…" before the (synchronous) JSON parse blocks the JS thread. */
const nextTurn = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function checkBackupFile(file: PickedFileLike, now: () => number = Date.now): Promise<CheckedBackup> {
  const started = now();
  const tooBig = backupFileSizeProblem(file.size);
  if (tooBig) return { ok: false, error: tooBig }; // `text()` is never called
  const text = await file.text();
  await nextTurn();
  const parsed = parseBackup(text);
  if (!parsed.ok) return parsed;
  return { ok: true, backup: parsed.backup, summary: parsed.summary, checkMs: now() - started };
}

/** True when the data holds anything at all (settings count: company details and logo are work too). */
export function holdsAnything(backup: BackupFile): boolean {
  return backup.projects.length + backup.circuits.length + backup.calculations.length + backup.cableTables.length + backup.cableTableRows.length + (backup.photos?.length ?? 0) + Object.keys(backup.settings).length > 0;
}

/** Same question as `holdsAnything`, asked of the database without reading every row (and without photo bytes). */
async function phoneHoldsAnything(db: Db): Promise<boolean> {
  const c = await dataCounts(db);
  if (c.projects + c.circuits + c.calculations + c.history + c.tables + c.photos > 0) return true;
  const settings = await withRead(db, (r) => r.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM settings'));
  return (settings?.n ?? 0) > 0;
}

/** The copy of the current data could not be kept; nothing was replaced. */
export class SafetyCopyError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SafetyCopyError';
  }
}

export type RestorePhase = { kind: 'keeping' } | { kind: 'writing'; done: number; total: number };

export type RestoreRun = {
  kept: boolean;
  copyMs: number;
  writeMs: number;
  written: string[];
  /**
   * How the safety copy came out (photo restores, REVIEW_V15_PA M6): `maxEdge` not null = its photos were downscaled to
   * that long edge, so "Undo" brings them back at that size — the screen must say so. Absent when no copy was streamed.
   */
  safety?: Pick<StreamResult, 'bytes' | 'photos' | 'missing' | 'downscaled' | 'maxEdge'>;
  /**
   * The phone's photo files before the restore. They are unreferenced after the commit, but the device glue keeps them
   * until the undo option expires (never swept right after the restore): they are the full-size originals when the
   * safety copy had to be downscaled.
   */
  previousPhotoFiles: string[];
};

/**
 * Photos in a restore (format 3, D100): the safety copy is STREAMED through `keep` (one photo at a time, D83) from
 * `source`, and the backup's photo files go to `files`. Without it a phone or backup with photos is refused before
 * anything changes. `restart` empties the safety-copy file before a retry at a smaller photo size (M6): without it a copy
 * that came out above the restore limit refuses the restore. `maxBytes` = the restore cap (tests use a small one).
 */
export type PhotoRestore = {
  source: PhotoSource;
  files: PhotoSink;
  keep: (chunk: string) => void | Promise<void>;
  restart?: () => void | Promise<void>;
  restoreId?: string;
  maxBytes?: number;
};

/**
 * Keeps the data now on the phone through `keep(text)` (which throws when the copy cannot be written: then NOTHING is
 * replaced), then replaces everything with `backup`. A phone with no data keeps no copy.
 */
export async function replaceWithBackup(
  db: Db,
  backup: BackupFile,
  keep: (text: string) => void,
  onPhase?: (phase: RestorePhase) => void,
  now: () => number = Date.now,
  photos?: PhotoRestore
): Promise<RestoreRun> {
  const copyStarted = now();
  onPhase?.({ kind: 'keeping' });
  const phonePhotos = (await dataCounts(db)).photos;
  if (!photos && (phonePhotos > 0 || (backup.photos?.length ?? 0) > 0)) throw new SafetyCopyError('photos need the streaming safety copy (PhotoRestore)');
  let kept = false;
  let safety: RestoreRun['safety'];
  const previousPhotoFiles = (await withRead(db, (r) => r.getAllAsync<{ file_path: string }>('SELECT file_path FROM photos ORDER BY id'))).map((r) => r.file_path);
  if (photos) {
    if (await phoneHoldsAnything(db)) {
      // M6: the copy is the only way back. A copy the restore would refuse (above the cap) or one that left a photo out
      // that still exists is no copy: retry smaller (when the file can be started again), else refuse — nothing replaced.
      let startEdge: number | null | undefined;
      for (;;) {
        let result: StreamResult;
        try {
          result = await writeBackupStream(db, photos.keep, photos.source, { ...(startEdge === undefined ? {} : { startEdge }), ...(photos.maxBytes === undefined ? {} : { maxBytes: photos.maxBytes }) });
        } catch (e) {
          throw new SafetyCopyError(e instanceof Error ? e.message : String(e));
        }
        if (result.skipped.length > 0) throw new SafetyCopyError(`${result.skipped.length} photo(s) could not be copied (${result.skipped.map((x) => `${x.id}: ${x.reason}`).join(', ')})`);
        if (!result.overLimit) {
          safety = { bytes: result.bytes, photos: result.photos, missing: result.missing, downscaled: result.downscaled, maxEdge: result.maxEdge };
          break;
        }
        const next = nextLowerPhotoEdge(result);
        if (next === null || !photos.restart || !photos.source.downscale) throw new SafetyCopyError(`the copy of the current data came out at ${result.bytes} bytes, above the restore limit`);
        await photos.restart();
        startEdge = next;
      }
      kept = true;
    }
  } else {
    const current = await exportBackup(db);
    if (holdsAnything(current)) {
      try {
        keep(serializeBackup(current));
      } catch (e) {
        throw new SafetyCopyError(e instanceof Error ? e.message : String(e));
      }
      kept = true;
    }
  }
  const copyMs = now() - copyStarted;
  const writeStarted = now();
  const progress: RestoreProgress = (done, total) => onPhase?.({ kind: 'writing', done, total });
  progress(0, 0);
  const { written } = await restoreBackup(db, backup, progress, photos?.files, photos?.restoreId);
  return { kept, copyMs, writeMs: now() - writeStarted, written, ...(safety ? { safety } : {}), previousPhotoFiles };
}
