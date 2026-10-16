// Writes a long text to a file without handing the whole string to the native side at once.
// `File.write(text)` turns the entire string into a Java string on Android (UTF-16, twice the size): a backup of about
// 100 MB (the restore cap, D57) ran the emulator's Java heap out of memory (V1_LOG P7), as `File.text()` did for reading
// (D76). Here the text is encoded in slices of 2 million characters and written through a file handle.
import { FileMode, type File } from 'expo-file-system';

/** Texts up to this many characters are written in one call as before. */
export const WRITE_DIRECT_CHARS = 4 * 1024 * 1024;
/** Characters per slice of a long text (≈ 2-6 MB of UTF-8). */
export const WRITE_SLICE_CHARS = 2 * 1024 * 1024;

/** Slice end that never cuts a surrogate pair (a high surrogate would be encoded as U+FFFD). */
export function sliceEnd(text: string, start: number, size: number): number {
  let end = Math.min(text.length, start + size);
  if (end < text.length) {
    const last = text.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return end;
}

/** Replaces the content of an existing (created, empty) file with `text`. */
export function writeTextChunked(file: File, text: string): void {
  if (text.length <= WRITE_DIRECT_CHARS || typeof TextEncoder === 'undefined') {
    file.write(text);
    return;
  }
  const encoder = new TextEncoder();
  const handle = file.open(FileMode.WriteOnly);
  try {
    for (let start = 0; start < text.length; ) {
      const end = sliceEnd(text, start, WRITE_SLICE_CHARS);
      handle.writeBytes(encoder.encode(text.slice(start, end)));
      start = end;
    }
  } finally {
    handle.close();
  }
}
