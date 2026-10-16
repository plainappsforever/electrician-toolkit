// A picked image file → the `data:image/…;base64,…` text the settings and the report keep (D44, D65). Pure: the screen
// reads the file (size first, bytes second) and this decides. The type comes from the bytes, never from the file name.
import { MAX_LOGO_BYTES } from '@/db/settings';

export type LogoResult = { ok: true; dataUri: string } | { ok: false; reason: 'tooBig' | 'notImage' };

/** `size`: the file size in bytes, checked BEFORE the file is read. `base64`: the content (only read when the size passed). */
export function logoFromBase64(size: number, base64: string): LogoResult {
  if (size > MAX_LOGO_BYTES) return { ok: false, reason: 'tooBig' };
  const clean = base64.replace(/\s+/g, '');
  const type = clean.startsWith('iVBORw0KGgo') ? 'png' : clean.startsWith('/9j/') ? 'jpeg' : null;
  if (!type || !/^[A-Za-z0-9+/]+={0,2}$/.test(clean)) return { ok: false, reason: 'notImage' };
  const bytes = Math.floor((clean.length * 3) / 4) - (clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0);
  if (bytes > MAX_LOGO_BYTES) return { ok: false, reason: 'tooBig' };
  return { ok: true, dataUri: `data:image/${type};base64,${clean}` };
}
