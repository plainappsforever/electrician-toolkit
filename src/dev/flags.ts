// Development-build switches for Maestro (V1_PLAN P6 dev links, print-cost D63): flows cannot drive the system share sheet
// or the system document picker, so a dev link can switch the share sheet off and name a fixture file that "gets picked".
// Loaded only as `__DEV__ ? require('@/dev/flags') : null` (src/lib/files.ts), so a release bundle does not contain it and
// the production code paths never reach it. Fixture files are copied into the app's documents folder by
// `scripts/push-fixtures.sh`; the newest backup and every PDF made in a dev build are also kept there (dev-out/).
import { Directory, File, Paths } from 'expo-file-system';

import { writeTextChunked } from '@/lib/write-chunked';

export const devFlags: { skipShare: boolean; pick: string | null } = { skipShare: false, pick: null };

export const FIXTURE_DIR = 'dev-fixtures';
export const OUT_DIR = 'dev-out';
export const LAST_BACKUP = 'last-backup.json';

/** The file a flow wants "picked" instead of the system picker, or null (no override). */
export function devPickedFile(): File | null {
  if (!devFlags.pick) return null;
  return devFlags.pick === 'last' ? new File(Paths.document, OUT_DIR, LAST_BACKUP) : new File(Paths.document, FIXTURE_DIR, devFlags.pick);
}

/** Copies a produced file into `Documents/dev-out/` so a script can pull it from the simulator/emulator. */
export function keepForDev(file: File, name: string = file.name): string {
  const dir = new Directory(Paths.document, OUT_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, name);
  const bytes = file.bytesSync(); // File.copy() onto a File target left nothing behind on Android
  if (dest.exists) dest.delete();
  dest.create();
  dest.write(bytes);
  return dest.uri;
}

export function keepTextForDev(text: string, name: string): void {
  const dir = new Directory(Paths.document, OUT_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const dest = new File(dir, name);
  if (dest.exists) dest.delete();
  dest.create();
  writeTextChunked(dest, text);
}
