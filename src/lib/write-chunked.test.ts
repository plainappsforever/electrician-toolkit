/** @jest-environment node */
import { sliceEnd, WRITE_DIRECT_CHARS, WRITE_SLICE_CHARS, writeTextChunked } from './write-chunked';

jest.mock('expo-file-system', () => ({ FileMode: { WriteOnly: 'w' } }));

function fakeFile() {
  const calls: string[] = [];
  const chunks: Uint8Array[] = [];
  let closed = false;
  const file = {
    write: (t: string) => calls.push(`write ${t.length}`),
    open: (mode: string) => {
      calls.push(`open ${mode}`);
      return {
        writeBytes: (b: Uint8Array) => {
          chunks.push(b);
        },
        close: () => {
          closed = true;
        },
      };
    },
  };
  return { file: file as never, calls, chunks, isClosed: () => closed };
}

describe('writeTextChunked (Android Java heap, V1_LOG P7)', () => {
  it('writes a short text in one call', () => {
    const f = fakeFile();
    writeTextChunked(f.file, 'hello');
    expect(f.calls).toEqual(['write 5']);
  });

  it('writes a long text in slices through a handle; the bytes decode to the original text (umlauts, emoji at the slice edge)', () => {
    const f = fakeFile();
    const unit = 'Müller, Küche Ω 😀 ';
    let text = '';
    while (text.length < WRITE_DIRECT_CHARS + 3 * WRITE_SLICE_CHARS) text += unit;
    writeTextChunked(f.file, text);
    expect(f.calls).toEqual(['open w']);
    expect(f.chunks.length).toBeGreaterThanOrEqual(3);
    expect(f.isClosed()).toBe(true);
    const joined = Buffer.concat(f.chunks.map((c) => Buffer.from(c))).toString('utf8');
    expect(joined === text).toBe(true);
    expect(joined.includes('�')).toBe(false);
  });

  it('never cuts a surrogate pair', () => {
    const text = 'ab😀cd'; // 😀 = indices 2 and 3
    expect(sliceEnd(text, 0, 3)).toBe(2);
    expect(sliceEnd(text, 0, 4)).toBe(4);
    expect(sliceEnd(text, 4, 10)).toBe(text.length);
  });
});
