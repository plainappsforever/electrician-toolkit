// Photos on a project, circuit or saved calculation (V1.5 phase A, NW1; migration 3, D99). Rows only: the JPEG files live
// in the app's document folder under `photos/` and are written/removed by the device glue (camera/picker phase), which
// also downscales a capture before it is stored (PHOTO_LIMITS). Writes run as one unit through the queue, reads through
// withRead (template rule). A photo never changes the calculation it belongs to (D20).
import { withRead, withTransaction } from './tx';
import type { Db } from './types';
import { cleanText, DataError } from './util';

export type PhotoOwnerType = 'project' | 'circuit' | 'calculation';
export const PHOTO_OWNER_TYPES: readonly PhotoOwnerType[] = ['project', 'circuit', 'calculation'];
export type PhotoOwner = { type: PhotoOwnerType; id: number };

export type Photo = {
  id: number;
  owner: PhotoOwner;
  /** Relative to the app's document folder, e.g. `photos/3f2a….jpg`. */
  filePath: string;
  width: number;
  height: number;
  bytes: number;
  caption: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
};
export type NewPhoto = { filePath: string; width: number; height: number; bytes: number; caption?: string };

/**
 * What the app stores. The capture glue downscales to `storeMaxEdge` (long edge, px) at JPEG quality `storeQuality`
 * before saving: a 12 MP phone photo becomes ≈ 0.3–0.6 MB and still prints sharp at the PDF's 85 mm cell width
 * (2048 px ≈ 600 dpi there). The other limits refuse what a bug or a hand-made file could bring in.
 */
export const PHOTO_LIMITS = {
  storeMaxEdge: 2048,
  storeQuality: 0.7,
  maxEdge: 8192,
  // = MAX_PHOTO_BACKUP_BYTES (backup.ts, tested equal): a photo the backup could not hold is never stored (REVIEW_V15_PA S1)
  maxBytes: 8 * 1024 * 1024,
  captionMax: 500,
  perOwner: 100,
} as const;

/** `photos/<name>.jpg`: one folder, a plain file name, no way out of the folder. */
export const PHOTO_PATH = /^photos\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.jpe?g$/i;

type PhotoRow = { id: number; owner_type: string; owner_id: number; file_path: string; width: number; height: number; bytes: number; caption: string; sort: number; created_at: number; updated_at: number };

const toPhoto = (r: PhotoRow): Photo => ({
  id: r.id,
  owner: { type: r.owner_type as PhotoOwnerType, id: r.owner_id },
  filePath: r.file_path,
  width: r.width,
  height: r.height,
  bytes: r.bytes,
  caption: r.caption,
  sort: r.sort,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const COLUMNS = 'id, owner_type, owner_id, file_path, width, height, bytes, caption, sort, created_at, updated_at';

function checkOwner(owner: PhotoOwner) {
  if (!PHOTO_OWNER_TYPES.includes(owner.type)) throw new DataError('invalid', 'owner', 'is not a project, circuit or calculation');
  if (!Number.isSafeInteger(owner.id) || owner.id < 1) throw new DataError('invalid', 'owner', 'has no valid id');
}

const intIn = (field: string, v: unknown, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) throw new DataError('invalid', field, `is not a whole number from ${min} to ${max}`);
  return v;
};

export function checkNewPhoto(p: NewPhoto): Required<NewPhoto> {
  if (typeof p.filePath !== 'string' || !PHOTO_PATH.test(p.filePath)) throw new DataError('invalid', 'filePath', 'is not photos/<name>.jpg');
  return {
    filePath: p.filePath,
    width: intIn('width', p.width, 1, PHOTO_LIMITS.maxEdge),
    height: intIn('height', p.height, 1, PHOTO_LIMITS.maxEdge),
    bytes: intIn('bytes', p.bytes, 1, PHOTO_LIMITS.maxBytes),
    caption: p.caption === undefined ? '' : cleanText('caption', p.caption, PHOTO_LIMITS.captionMax, false),
  };
}

/** Maps the database's trigger messages to data errors the screens know. */
function ownerError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (/photo_owner_missing/.test(msg)) throw new DataError('not_found', 'owner', 'does not exist');
  if (/photo_owner_history/.test(msg)) throw new DataError('not_saveable', 'owner', 'is a history entry, not a saved calculation');
  if (/UNIQUE/.test(msg)) throw new DataError('duplicate', 'filePath', 'is already used by another photo');
  throw e;
}

/** Adds a photo row at the end of its owner's list. Returns the new id. */
export async function addPhoto(db: Db, owner: PhotoOwner, photo: NewPhoto, now = Date.now()): Promise<number> {
  checkOwner(owner);
  const p = checkNewPhoto(photo);
  return withTransaction(db, async (tx) => {
    const n = await tx.getFirstAsync<{ n: number; next: number }>('SELECT COUNT(*) AS n, COALESCE(MAX(sort), -1) + 1 AS next FROM photos WHERE owner_type = ? AND owner_id = ?', owner.type, owner.id);
    if ((n?.n ?? 0) >= PHOTO_LIMITS.perOwner) throw new DataError('invalid', 'owner', `already has ${PHOTO_LIMITS.perOwner} photos`);
    try {
      const r = await tx.runAsync(
        'INSERT INTO photos (owner_type, owner_id, file_path, width, height, bytes, caption, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        owner.type,
        owner.id,
        p.filePath,
        p.width,
        p.height,
        p.bytes,
        p.caption,
        n?.next ?? 0,
        now,
        now
      );
      return r.lastInsertRowId;
    } catch (e) {
      return ownerError(e);
    }
  });
}

export async function getPhoto(db: Db, id: number): Promise<Photo | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<PhotoRow>(`SELECT ${COLUMNS} FROM photos WHERE id = ?`, id));
  return row ? toPhoto(row) : null;
}

/** One owner's photos in their order. */
export async function listPhotos(db: Db, owner: PhotoOwner): Promise<Photo[]> {
  checkOwner(owner);
  const rows = await withRead(db, (r) => r.getAllAsync<PhotoRow>(`SELECT ${COLUMNS} FROM photos WHERE owner_type = ? AND owner_id = ? ORDER BY sort, id`, owner.type, owner.id));
  return rows.map(toPhoto);
}

/**
 * Every photo of a project for its report: the project's own, then per circuit (circuit order), then per saved
 * calculation (report order: created_at, id). One read unit, so the list is consistent.
 */
export async function projectPhotos(db: Db, projectId: number): Promise<Photo[]> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<PhotoRow>(
      `SELECT ${COLUMNS.split(', ').map((c) => `p.${c}`).join(', ')} FROM photos p
       LEFT JOIN circuits ci ON p.owner_type = 'circuit' AND ci.id = p.owner_id
       LEFT JOIN calculations ca ON p.owner_type = 'calculation' AND ca.id = p.owner_id
       WHERE (p.owner_type = 'project' AND p.owner_id = ?) OR ci.project_id = ? OR ca.project_id = ?
       ORDER BY CASE p.owner_type WHEN 'project' THEN 0 WHEN 'circuit' THEN 1 ELSE 2 END,
                ci.sort, ci.id, ca.created_at, ca.id, p.sort, p.id`,
      projectId,
      projectId,
      projectId
    )
  );
  return rows.map(toPhoto);
}

export async function setPhotoCaption(db: Db, id: number, caption: string, now = Date.now()): Promise<void> {
  const c = cleanText('caption', caption, PHOTO_LIMITS.captionMax, false);
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync('UPDATE photos SET caption = ?, updated_at = ? WHERE id = ?', c, now, id);
    if (r.changes === 0) throw new DataError('not_found', 'photo', 'does not exist');
  });
}

/** New order of one owner's photos: `ids` must be exactly that owner's photo ids. */
export async function reorderPhotos(db: Db, owner: PhotoOwner, ids: readonly number[], now = Date.now()): Promise<void> {
  checkOwner(owner);
  await withTransaction(db, async (tx) => {
    const have = (await tx.getAllAsync<{ id: number }>('SELECT id FROM photos WHERE owner_type = ? AND owner_id = ?', owner.type, owner.id)).map((r) => r.id).sort((a, b) => a - b);
    const want = [...ids].sort((a, b) => a - b);
    if (have.length !== want.length || have.some((id, i) => id !== want[i])) throw new DataError('invalid', 'ids', "are not exactly this owner's photos");
    for (let i = 0; i < ids.length; i++) await tx.runAsync('UPDATE photos SET sort = ?, updated_at = ? WHERE id = ?', i, now, ids[i]);
  });
}

/** Deletes the row and returns its file path: the caller removes the file AFTER this succeeded (a failed delete keeps both). */
export async function deletePhoto(db: Db, id: number): Promise<string> {
  return withTransaction(db, async (tx) => {
    const row = await tx.getFirstAsync<{ file_path: string }>('SELECT file_path FROM photos WHERE id = ?', id);
    if (!row) throw new DataError('not_found', 'photo', 'does not exist');
    await tx.runAsync('DELETE FROM photos WHERE id = ?', id);
    return row.file_path;
  });
}

/** Every file path a photo row points to: files in `photos/` that are not in this set belong to nobody (after a delete or restore). */
export async function referencedPhotoFiles(db: Db): Promise<Set<string>> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ file_path: string }>('SELECT file_path FROM photos'));
  return new Set(rows.map((r) => r.file_path));
}

/** A file of the photo folder as the device glue lists it; `modifiedMs` lets the sweep spare files written just now. */
export type FolderFile = string | { path: string; modifiedMs: number };

/** Files younger than this are never swept: a capture or a restore may be between writing the file and its row (S9). */
export const SWEEP_MIN_AGE_MS = 10 * 60 * 1000;

/**
 * Files of the photo folder that no row references (pure; the device glue lists the folder and removes these).
 * Contract for the glue (REVIEW_V15_PA S9): sweep only at launch and after a committed write, never while a restore or a
 * capture runs (one lock); pass `{ path, modifiedMs }` so files younger than SWEEP_MIN_AGE_MS stay (plain strings count
 * as old); pass `keep` = `RestoreRun.previousPhotoFiles` until the undo of a restore expires.
 */
export function unreferencedPhotoFiles(referenced: ReadonlySet<string>, filesInFolder: readonly FolderFile[], opts: { now?: number; minAgeMs?: number; keep?: ReadonlySet<string> | readonly string[] } = {}): string[] {
  const now = opts.now ?? Date.now();
  const minAge = opts.minAgeMs ?? SWEEP_MIN_AGE_MS;
  const keep = new Set(opts.keep ?? []);
  return filesInFolder.flatMap((f) => {
    const path = typeof f === 'string' ? f : f.path;
    if (!PHOTO_PATH.test(path) || referenced.has(path) || keep.has(path)) return [];
    if (typeof f !== 'string' && now - f.modifiedMs < minAge) return [];
    return [path];
  });
}
