// Device glue for files (SPEC §11, §12): the system picker in, the share sheet out. Files leave the app only through the
// share sheet and enter only through the picker; no storage permission is asked on either platform. Everything here is
// thin and untested in Jest on purpose; the logic lives in pure modules (`backup-flow.ts`, `pdf.ts`, `csv.ts`).
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { writeTextChunked } from './write-chunked';

// `__DEV__ ? require(…) : null` is folded to `null` in a release bundle (D70): flows' switches never ship.
/* eslint-disable @typescript-eslint/no-require-imports */
const dev: typeof import('@/dev/flags') | null = __DEV__ ? require('@/dev/flags') : null;
/* eslint-enable @typescript-eslint/no-require-imports */

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A file in a sub-folder of the cache (the folder is created). Share copies live here; the OS may clear them. */
export function cacheFile(dir: string, name: string): File {
  const folder = new Directory(Paths.cache, dir);
  if (!folder.exists) folder.create({ intermediates: true, idempotent: true });
  return new File(folder, name);
}

/** Replaces the file's content (creating it): one write, nothing half-written is shared. */
export function writeTextFile(file: File, text: string): void {
  if (file.exists) file.delete();
  file.create({ intermediates: true });
  writeTextChunked(file, text); // long backups in slices (Android Java heap, V1_LOG P7)
}

/** The copy of the data kept before the last restore (one file in the app's private documents, replaced by the next restore). */
export const BEFORE_RESTORE_FILE = 'before-last-restore.json';

export function writeDocumentText(name: string, text: string): void {
  writeTextFile(new File(Paths.document, name), text);
}

export function documentFile(name: string): File | null {
  const f = new File(Paths.document, name);
  return f.exists ? f : null;
}

/** Dev builds keep the newest backup (so a flow can restore it without the picker) and PDFs (to pull and measure). */
export function keepBackupForDev(text: string): void {
  dev?.keepTextForDev(text, dev.LAST_BACKUP);
}
export function keepFileForDev(file: File): string | null {
  return dev ? dev.keepForDev(file) : null;
}

export type ShareOutcome = 'shared' | 'skipped' | 'unavailable';

/** Opens the system share sheet for a file we just wrote. A dev link can skip it (Maestro cannot drive it). */
export async function shareFile(file: File, mimeType: string, UTI: string): Promise<ShareOutcome> {
  if (dev?.devFlags.skipShare) return 'skipped';
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(file.uri, { mimeType, UTI, dialogTitle: file.name });
  return 'shared';
}

export type Picked = { canceled: true } | { canceled: false; file: File };

/**
 * The system document picker (UIDocumentPicker / Storage Access Framework): no permission needed. On iOS the result is a
 * temporary copy. `mimeTypes` narrows what is offered (backup: JSON, table: CSV, logo: PNG/JPEG).
 */
export async function pickFile(mimeTypes?: string[]): Promise<Picked> {
  const forced = dev?.devPickedFile() ?? null;
  if (forced) {
    if (!forced.exists) throw new Error(`dev fixture ${forced.name} is missing (run scripts/push-fixtures.sh)`);
    return { canceled: false, file: forced };
  }
  const r = await File.pickFileAsync(mimeTypes ? { mimeTypes } : undefined);
  return r.canceled ? { canceled: true } : { canceled: false, file: r.result };
}

/** Bytes per read of `readTextChunked` (the native side never holds more than this at once). */
export const READ_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * The whole file as text, read in chunks. `File.text()` builds the entire file as a Java string on Android: a 58 MB backup
 * needs ≈ 175 MB of Java heap and ran out of memory on the emulator (V1_LOG P6, D76). Chunks of 4 MB are decoded as UTF-8
 * here; a multi-byte character cut by a chunk edge is carried over by the streaming decoder. A leading BOM is dropped.
 */
export async function readTextChunked(file: File): Promise<string> {
  if (typeof TextDecoder === 'undefined') return file.text();
  const handle = file.open(FileMode.ReadOnly);
  try {
    const size = handle.size ?? file.size;
    const decoder = new TextDecoder('utf-8');
    let out = '';
    for (let offset = 0; offset < size; offset += READ_CHUNK_BYTES) {
      handle.offset = offset;
      out += decoder.decode(handle.readBytes(Math.min(READ_CHUNK_BYTES, size - offset)), { stream: offset + READ_CHUNK_BYTES < size });
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); // let the screen repaint between chunks
    }
    return out.charCodeAt(0) === 0xfeff ? out.slice(1) : out;
  } finally {
    handle.close();
  }
}
