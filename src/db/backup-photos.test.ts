/**
 * @jest-environment node
 */
// Backup format 3: photos (V1.5 phase A, NW1, D100). Round trip through the streaming writer, refusals, the frozen files of
// formats 1, 2 and 3, a 100-photo backup, the memory behaviour of the writer and the size budget.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import v8 from 'node:v8';
import vm from 'node:vm';

import { createTestDb } from '../../test/node-sqlite-db';
import { rng } from '../../test/seeded-random';
import { loadSeed } from '@/dev/seeds';

import {
  BACKUP_PHOTO_EDGES,
  BackupTooLargeError,
  base64Bytes,
  estimatedPhotoBytes,
  exportBackup,
  MAX_BACKUP_BYTES,
  MAX_PHOTO_BACKUP_BYTES,
  newRestoreId,
  nextLowerPhotoEdge,
  parseBackup,
  planBackupPhotos,
  restoreBackup,
  restoreFromText,
  serializeBackup,
  writeBackupStream,
  type BackupFile,
  type PhotoSink,
  type PhotoSource,
  type Row,
} from './backup';
import { migrate } from './migrations';
import { addPhoto, listPhotos, projectPhotos, referencedPhotoFiles, unreferencedPhotoFiles } from './photos';

type DB = ReturnType<typeof createTestDb>;
const T0 = 1_760_000_000_000;

/** A JPEG-looking byte string (FF D8 FF E0 … FF D9) of `size` bytes as base64; content is a seeded 1 KiB noise block, tiled. */
function fakeJpeg(size: number, seed: number): string {
  const r = rng(seed);
  const block = Buffer.alloc(1024);
  for (let i = 0; i < block.length; i++) block[i] = Math.floor(r.next() * 256);
  const b = Buffer.alloc(size);
  for (let i = 0; i < size; i += block.length) block.copy(b, i, 0, Math.min(block.length, size - i));
  b[0] = 0xff;
  b[1] = 0xd8;
  b[2] = 0xff;
  b[3] = 0xe0;
  b[size - 2] = 0xff;
  b[size - 1] = 0xd9;
  return b.toString('base64');
}

/** The phone's photo folder in memory: a PhotoSource for export and a PhotoSink for restore, with counters. */
class Folder implements PhotoSource, PhotoSink {
  files = new Map<string, string>();
  reads = 0;
  writes = 0;
  async read(row: Row) {
    this.reads++;
    return this.files.get(String(row.file_path)) ?? null;
  }
  async write(name: string, base64: string) {
    this.writes++;
    this.files.set(name, base64);
  }
}

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

/** e1 seed (project 1, circuit 1, 3 saved calculations) and `n` photos spread over the three owner types. */
async function withPhotos(n: number, size = 3000, folder = new Folder()) {
  const db = await freshDb();
  await loadSeed(db, 'e1', T0);
  const calcId = (await db.getFirstAsync<{ id: number }>('SELECT id FROM calculations WHERE project_id IS NOT NULL ORDER BY id'))!.id;
  const owners = [
    { type: 'project' as const, id: 1 },
    { type: 'circuit' as const, id: 1 },
    { type: 'calculation' as const, id: calcId },
  ];
  for (let i = 0; i < n; i++) {
    const path = `photos/p${i}.jpg`;
    const data = fakeJpeg(size + (i % 7) * 11, 1000 + i);
    folder.files.set(path, data);
    await addPhoto(db, owners[i % 3], { filePath: path, width: 2048, height: 1536, bytes: base64Bytes(data)!, caption: i % 2 ? `Foto ${i}` : '' }, T0 + i);
  }
  return { db, folder };
}

async function streamText(db: DB, source: PhotoSource, opts: Parameters<typeof writeBackupStream>[3] = {}) {
  const chunks: string[] = [];
  const result = await writeBackupStream(db, (c) => void chunks.push(c), source, { exportedAt: '2026-10-15T10:00:00.000Z', ...opts });
  return { text: chunks.join(''), chunks, result };
}

const rowsWithoutPath = async (db: DB) =>
  (await db.getAllAsync<Record<string, unknown>>('SELECT * FROM photos ORDER BY id')).map(({ file_path: _drop, ...rest }) => rest);

describe('format 3 round trip', () => {
  it('streams photos into the file, restores rows and files (new names), and the old photos stay untouched until commit', async () => {
    const { db, folder } = await withPhotos(6);
    const { text, result } = await streamText(db, folder);
    expect(result).toMatchObject({ photos: 6, missing: [], downscaled: 0, maxEdge: null, overLimit: false });
    expect(result.bytes).toBe(Buffer.byteLength(text, 'utf8'));
    const parsed = parseBackup(text);
    expect(parsed.ok && parsed.summary).toMatchObject({ backupVersion: 3, schemaVersion: 3, counts: { projects: 1, calculations: 3, photos: 6 }, unverified: 0 });

    // a phone that already has a photo of its own
    const phone = new Folder();
    const target = await freshDb();
    await loadSeed(target, 'e1', T0);
    phone.files.set('photos/mine.jpg', fakeJpeg(500, 7));
    await addPhoto(target, { type: 'project', id: 1 }, { filePath: 'photos/mine.jpg', width: 10, height: 10, bytes: 500 });
    const out = await restoreFromText(target, text, phone, 'abc');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.files.written).toHaveLength(6);
    expect(out.files.written.every((p) => /^photos\/rabc-\d+\.jpg$/.test(p))).toBe(true);
    expect(phone.files.get('photos/mine.jpg')).toBe(fakeJpeg(500, 7)); // never overwritten
    expect(await rowsWithoutPath(target)).toEqual(await rowsWithoutPath(db));
    for (const p of await listPhotos(target, { type: 'project', id: 1 })) {
      const original = (await listPhotos(db, { type: 'project', id: 1 })).find((o) => o.id === p.id)!;
      expect(phone.files.get(p.filePath)).toBe(folder.files.get(original.filePath)); // byte for byte
    }
    // the phone's old photo file is unreferenced now (the device glue removes it; the safety copy holds its bytes)
    expect(unreferencedPhotoFiles(await referencedPhotoFiles(target), [...phone.files.keys()])).toEqual(['photos/mine.jpg']);
    expect((await projectPhotos(target, 1)).length).toBe(6);
  });

  it('a backup of a phone without photos is format 3 with empty photo sections and needs no PhotoSource', async () => {
    const db = await freshDb();
    await loadSeed(db, 'e1', T0);
    const f = await exportBackup(db);
    expect(f).toMatchObject({ backupVersion: 3, photos: [], photoData: {} });
    const target = await freshDb();
    expect(await restoreFromText(target, serializeBackup(f))).toMatchObject({ ok: true, files: { written: [] } });
  });

  it('exportBackup with photos needs their source; a photo whose file is gone is left out and reported', async () => {
    const { db, folder } = await withPhotos(3);
    await expect(exportBackup(db)).rejects.toThrow(/PhotoSource/);
    folder.files.delete('photos/p1.jpg');
    const { text, result } = await streamText(db, folder);
    expect(result).toMatchObject({ photos: 2, missing: [2] });
    const parsed = parseBackup(text);
    expect(parsed.ok && parsed.summary.counts.photos).toBe(2);
    const small = await exportBackup(db, undefined, folder);
    expect(small.photos.map((p) => p.id)).toEqual([1, 3]);
  });

  it('a backup with photos needs a PhotoSink to restore', async () => {
    const { db, folder } = await withPhotos(1);
    const parsed = parseBackup((await streamText(db, folder)).text);
    if (!parsed.ok) throw new Error(parsed.error.detail);
    await expect(restoreBackup(await freshDb(), parsed.backup)).rejects.toThrow(/PhotoSink/);
  });

  it('a failure inside the transaction leaves the old rows (and their files); the new files are unreferenced', async () => {
    const { db, folder } = await withPhotos(2);
    const parsed = parseBackup((await streamText(db, folder)).text);
    if (!parsed.ok) throw new Error(parsed.error.detail);
    const broken = JSON.parse(JSON.stringify(parsed.backup)) as BackupFile;
    broken.calculations[1].kind = 'bogus'; // passes the parsed object, refused by the database half-way
    const phone = new Folder();
    const target = await freshDb();
    await loadSeed(target, 'e1', T0);
    await expect(restoreBackup(target, broken, undefined, phone, 'x1')).rejects.toThrow();
    expect(await referencedPhotoFiles(target)).toEqual(new Set());
    expect(unreferencedPhotoFiles(await referencedPhotoFiles(target), [...phone.files.keys()]).sort()).toEqual(['photos/rx1-1.jpg', 'photos/rx1-2.jpg']);
  });
});

describe('format 3 refusals (nothing written)', () => {
  let good: BackupFile;
  beforeAll(async () => {
    const { db, folder } = await withPhotos(3);
    const parsed = parseBackup((await streamText(db, folder)).text);
    if (!parsed.ok) throw new Error(parsed.error.detail);
    good = parsed.backup;
  });
  const refuse = (mutate: (f: Record<string, any>) => unknown, code: string, detail?: RegExp) => {
    const f = JSON.parse(JSON.stringify(good)) as Record<string, any>;
    mutate(f);
    const r = parseBackup(JSON.stringify(f));
    expect(r).toMatchObject({ ok: false, error: { code } });
    if (detail && !r.ok) expect(r.error.detail).toMatch(detail);
  };
  it('photo data: missing, extra, not base64, not a JPEG, wrong length, too large', () => {
    refuse((f) => delete f.photoData['1'], 'invalid_row', /no photoData/);
    refuse((f) => (f.photoData['99'] = f.photoData['1']), 'invalid_structure', /no photo row/);
    refuse((f) => (f.photoData['1'] = 'not base64!'), 'invalid_row', /base64 JPEG/);
    refuse((f) => (f.photoData['1'] = Buffer.from('PNG not JPEG').toString('base64')), 'invalid_row', /base64 JPEG/);
    refuse((f) => (f.photos[0].bytes += 1), 'inconsistent', /holds/);
    refuse((f) => (f.photoData['1'] = '/9j/' + 'A'.repeat(Math.ceil(MAX_PHOTO_BACKUP_BYTES / 3) * 4)), 'invalid_row', /too large/);
    refuse((f) => delete f.photoData, 'invalid_structure', /photoData/);
  });
  it('photo rows: unknown owner type, missing owner, a history entry, duplicate file, bad path, too big', () => {
    refuse((f) => (f.photos[0].owner_type = 'invoice'), 'invalid_row');
    refuse((f) => (f.photos[0].owner_id = 99), 'broken_reference');
    refuse((f) => {
      f.calculations[0].project_id = null;
      f.calculations[0].circuit_id = null;
      f.photos[2].owner_id = f.calculations[0].id;
    }, 'inconsistent', /history/);
    refuse((f) => (f.photos[1].file_path = f.photos[0].file_path), 'duplicate_row');
    refuse((f) => (f.photos[0].file_path = '../../etc/passwd.jpg'), 'invalid_row');
    refuse((f) => (f.photos[0].width = 9000), 'invalid_row');
  });
  it('versions: a version 2 file with photos, a version 3 file of schema 2', () => {
    refuse((f) => (f.backupVersion = 2), 'invalid_structure', /has no photos/);
    refuse((f) => (f.schemaVersion = 2), 'invalid_version');
  });
});

describe('frozen files of every format restore with this code (D100)', () => {
  const dir = join(__dirname, '../../test/fixtures/files');
  it.each([
    ['backup-format1.json', 1, 0],
    ['backup-format2.json', 2, 0],
    ['backup-format3.json', 3, 2],
  ])('%s', async (name, version, photos) => {
    const text = readFileSync(join(dir, name), 'utf8');
    const parsed = parseBackup(text);
    expect(parsed.ok && parsed.summary).toMatchObject({ backupVersion: version, unverified: 0, counts: { projects: 1, circuits: 1, calculations: 3, cableTables: 1, photos } });
    const phone = new Folder();
    const target = await freshDb();
    const out = await restoreFromText(target, text, phone, 'f1');
    expect(out.ok).toBe(true);
    expect(phone.files.size).toBe(photos);
    if (photos) {
      const board = readFileSync(join(__dirname, '../../test/fixtures/photos/board-1200x900.jpg')).toString('base64');
      expect([...phone.files.values()]).toContain(board);
    }
  });
});

describe('a 100-photo backup (size, round trip, memory)', () => {
  const PHOTO_BYTES = 300_000; // a stored 2048 px JPEG is ≈ 0.3–0.6 MB (PHOTO_LIMITS)
  it('round trip of 100 photos of ≈ 300 KB: ≈ 40 MB file, every byte back, within the 100 MiB cap', async () => {
    const { db, folder } = await withPhotos(100, PHOTO_BYTES);
    const started = Date.now();
    const { text, result } = await streamText(db, folder);
    const exportMs = Date.now() - started;
    expect(result).toMatchObject({ photos: 100, missing: [], downscaled: 0, overLimit: false });
    expect(result.bytes).toBeGreaterThan(100 * PHOTO_BYTES * (4 / 3));
    expect(result.bytes).toBeLessThan(MAX_BACKUP_BYTES);
    const t1 = Date.now();
    const parsed = parseBackup(text);
    const parseMs = Date.now() - t1;
    if (!parsed.ok) throw new Error(parsed.error.detail);
    const phone = new Folder();
    const target = await freshDb();
    const t2 = Date.now();
    await restoreBackup(target, parsed.backup, undefined, phone, 'big');
    const restoreMs = Date.now() - t2;
    expect(phone.files.size).toBe(100);
    expect(await rowsWithoutPath(target)).toEqual(await rowsWithoutPath(db));
    const original = new Map((await db.getAllAsync<{ id: number; file_path: string }>('SELECT id, file_path FROM photos')).map((r) => [r.id, r.file_path]));
    for (const r of await target.getAllAsync<{ id: number; file_path: string }>('SELECT id, file_path FROM photos')) {
      expect(phone.files.get(r.file_path) === folder.files.get(original.get(r.id)!)).toBe(true);
    }
    console.log(`100 photos: file ${(result.bytes / 1048576).toFixed(1)} MiB, export ${exportMs} ms, parse+validate ${parseMs} ms, restore ${restoreMs} ms`);
  });

  it('memory: the writer holds at most one photo at a time and never builds one big string', async () => {
    const { db, folder } = await withPhotos(100, PHOTO_BYTES);
    let held = 0;
    let maxHeld = 0;
    const source: PhotoSource = {
      read: async (row) => {
        held++;
        maxHeld = Math.max(maxHeld, held);
        return folder.read(row);
      },
    };
    const sizes: number[] = [];
    // Retained memory, not garbage: force a full GC before each reading (Node's gc through --expose_gc).
    v8.setFlagsFromString('--expose_gc');
    const gc = vm.runInNewContext('gc') as () => void;
    gc();
    const before = process.memoryUsage().heapUsed;
    let peak = before;
    const result = await writeBackupStream(
      db,
      (chunk) => {
        if (chunk.includes('/9j/')) held -= (chunk.match(/"\/9j\//g) ?? []).length;
        sizes.push(chunk.length);
        // the chunk is dropped here (a real sink appends it to the file); every 10th chunk, measure what is still held
        if (sizes.length % 10 === 0) {
          gc();
          peak = Math.max(peak, process.memoryUsage().heapUsed);
        }
      },
      source,
      { exportedAt: '2026-10-15T10:00:00.000Z' }
    );
    expect(result.photos).toBe(100);
    expect(maxHeld).toBe(1);
    const biggestPhoto = Math.ceil((PHOTO_BYTES + 6 * 11) / 3) * 4;
    expect(Math.max(...sizes)).toBeLessThanOrEqual(biggestPhoto + 32); // no chunk is larger than one photo
    // What this measures (REVIEW_V15_PA S11): the WRITER retains no photo — retained V8 heap after GC, with every photo
    // string already in the Folder before `before` was sampled and `read()` returning that same string. It says nothing
    // about peak memory, Hermes, or a real source (file read → new base64 string → concatenation → bridge copy, ≈ 3 × one
    // photo); the phone figures are IMPLEMENTED BUT UNVERIFIED until measured on a low-memory phone.
    const growth = peak - before;
    expect(growth).toBeLessThan(8 * 1024 * 1024);
    console.log(`stream of ${(result.bytes / 1048576).toFixed(1)} MiB: ${sizes.length} chunks, largest ${(Math.max(...sizes) / 1024).toFixed(0)} KiB, writer retains ≤ ${(growth / 1048576).toFixed(1)} MiB (V8, after GC; not peak, not Hermes)`);
  });
});

describe('size budget (100 MiB cap, D57/D100)', () => {
  const photos = (n: number, bytes: number, edge = 4000) => Array.from({ length: n }, (_, i) => ({ id: i + 1, width: edge, height: Math.round(edge * 0.75), bytes }));
  it('as stored when it fits; otherwise the largest edge that fits; refused when 640 px does not fit or nobody can downscale', () => {
    expect(planBackupPhotos(photos(100, 400_000), 1_000_000)).toMatchObject({ ok: true, maxEdge: null, downscale: [] });
    // 200 photos of 2 MB at 4000 px: 2048 px ≈ 2e6·(2048/4000)²·1.1 = 577 kB → 769 kB base64 · 200 = 154 MB > 96.5 MB;
    // 1600 px ≈ 352 kB → 469 kB · 200 = 94 MB ≤ 96.5 MB (100 MiB · 0.92)
    const p = planBackupPhotos(photos(200, 2_000_000), 1_000_000);
    expect(p.ok && p.maxEdge).toBe(1600);
    expect(p.ok && p.estimatedBytes).toBeLessThanOrEqual(MAX_BACKUP_BYTES * 0.92);
    expect(p.ok && p.downscale).toHaveLength(200);
    // 600 photos: 1024 px ≈ 144 kB → 192 kB · 600 = 115 MB (no); 800 px ≈ 88 kB → 117 kB · 600 = 70 MB (yes)
    const q = planBackupPhotos(photos(600, 2_000_000), 1_000_000);
    expect(q.ok && q.maxEdge).toBe(800);
    expect(planBackupPhotos(photos(5000, 2_000_000), 1_000_000)).toMatchObject({ ok: false, reason: 'too_large' });
    expect(planBackupPhotos(photos(200, 2_000_000), 1_000_000, { canDownscale: false })).toMatchObject({ ok: false, reason: 'no_downscale' });
    expect(BACKUP_PHOTO_EDGES[BACKUP_PHOTO_EDGES.length - 1]).toBe(640);
    expect(estimatedPhotoBytes({ width: 1000, height: 800, bytes: 100 }, 2048)).toBe(100); // never upscaled
  });

  it('the writer downscales through the PhotoSource and the file stays under a (small, test) cap', async () => {
    const { db, folder } = await withPhotos(12, 60_000);
    let calls = 0;
    const source: PhotoSource = {
      read: (row) => folder.read(row),
      downscale: async (row, maxEdge) => {
        calls++;
        const scale = maxEdge / Math.max(row.width as number, row.height as number);
        return { base64: fakeJpeg(Math.max(200, Math.floor((row.bytes as number) * scale * scale)), row.id as number), width: Math.round((row.width as number) * scale), height: Math.round((row.height as number) * scale) };
      },
    };
    const cap = 400_000;
    const { text, result } = await streamText(db, source, { maxBytes: cap });
    expect(result.maxEdge).not.toBeNull();
    expect(result.downscaled).toBe(12);
    expect(calls).toBe(12);
    expect(result.overLimit).toBe(false);
    expect(result.bytes).toBeLessThanOrEqual(cap);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) for (const p of parsed.backup.photos) expect(Math.max(p.width as number, p.height as number)).toBeLessThanOrEqual(result.maxEdge!);
  });

  it('refuses before writing anything when the photos cannot fit, and flags an estimate that came out too low', async () => {
    const { db, folder } = await withPhotos(12, 60_000);
    const writes: string[] = [];
    await expect(writeBackupStream(db, (c) => void writes.push(c), folder, { maxBytes: 400_000 })).rejects.toBeInstanceOf(BackupTooLargeError);
    expect(writes).toEqual([]);
    // a downscaler that returns more than the estimate: the file is written but flagged
    const liar: PhotoSource = { read: (row) => folder.read(row), downscale: async (row) => ({ base64: folder.files.get(String(row.file_path))!, width: 640, height: 480 }) };
    const { result } = await streamText(db, liar, { maxBytes: 400_000 });
    expect(result.overLimit).toBe(true);
  });
});

// REVIEW_V15_PA S1 / N5 / N6 / N7: one bad photo never makes a backup impossible; it is left out and reported
describe('photos that cannot go into the backup as they are (S1, N6)', () => {
  it('a stored file above 8 MiB or not a JPEG is skipped and reported (no throw after the first chunk); the file still restores', async () => {
    const { db, folder } = await withPhotos(3, 3000);
    folder.files.set('photos/p1.jpg', fakeJpeg(MAX_PHOTO_BACKUP_BYTES + 1, 7)); // grew after it was stored
    folder.files.set('photos/p2.jpg', Buffer.from('GIF89a not a jpeg').toString('base64'));
    const { text, result } = await streamText(db, folder);
    expect(result.skipped).toEqual([
      { id: 2, reason: 'too_large' },
      { id: 3, reason: 'not_jpeg' },
    ]);
    expect(result).toMatchObject({ photos: 1, missing: [] });
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.summary.counts.photos).toBe(1);
  });

  it('with a downscaler the oversized / non-JPEG photo is re-encoded once and kept', async () => {
    const { db, folder } = await withPhotos(3, 3000);
    folder.files.set('photos/p1.jpg', fakeJpeg(MAX_PHOTO_BACKUP_BYTES + 1, 7));
    folder.files.set('photos/p2.jpg', Buffer.from('GIF89a not a jpeg').toString('base64'));
    const edges: number[] = [];
    const source: PhotoSource = { read: (row) => folder.read(row), downscale: async (row, edge) => (edges.push(edge), { base64: fakeJpeg(2000, row.id as number), width: edge, height: Math.round(edge * 0.75) }) };
    const { text, result } = await streamText(db, source);
    expect(result).toMatchObject({ photos: 3, skipped: [], downscaled: 2, maxEdge: null });
    expect(edges).toEqual([BACKUP_PHOTO_EDGES[0], BACKUP_PHOTO_EDGES[0]]);
    expect(parseBackup(text).ok).toBe(true);
  });

  it('a downscale that returns nothing is "could not be reduced", not "file missing" (N6)', async () => {
    const { db, folder } = await withPhotos(3, 60_000);
    const source: PhotoSource = { read: (row) => folder.read(row), downscale: async () => null };
    const { result } = await streamText(db, source, { maxBytes: 200_000 }); // as stored too big, 1600 px fits
    expect(result.maxEdge).not.toBeNull();
    expect(result.missing).toEqual([]);
    expect(result.skipped.map((x) => x.reason)).toEqual(['not_reduced', 'not_reduced', 'not_reduced']);
  });

  it('the next lower edge for a retry (N7): below the edge used, or below the longest stored photo when none was used', () => {
    expect(nextLowerPhotoEdge({ maxEdge: null, longestEdge: 2048 })).toBe(1600);
    expect(nextLowerPhotoEdge({ maxEdge: null, longestEdge: 1000 })).toBe(800);
    expect(nextLowerPhotoEdge({ maxEdge: 1600, longestEdge: 2048 })).toBe(1280);
    expect(nextLowerPhotoEdge({ maxEdge: 640, longestEdge: 2048 })).toBeNull();
    expect(nextLowerPhotoEdge({ maxEdge: null, longestEdge: 600 })).toBeNull();
  });

  it('restore ids are random as well as timed: a clock set back cannot reuse old file names (N5)', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newRestoreId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{1,20}$/);
  });
});
