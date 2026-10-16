/** @jest-environment node */
import { createTestDb } from '../../test/node-sqlite-db';
import { loadSeed } from '@/dev/seeds';
import { BACKUP_PHOTO_EDGES, exportBackup, MAX_BACKUP_BYTES, serializeBackup, writeBackupStream } from '@/db/backup';
import { addPhoto } from '@/db/photos';
import { migrate } from '@/db/migrations';
import { createProject } from '@/db/projects';

import { checkBackupFile, holdsAnything, replaceWithBackup, SafetyCopyError, type RestorePhase } from './backup-flow';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}
const names = async (db: Awaited<ReturnType<typeof freshDb>>) => (await db.getAllAsync<{ name: string }>('SELECT name FROM projects ORDER BY id')).map((r) => r.name);

describe('checkBackupFile (D57)', () => {
  it('never reads a file above 100 MiB: the size is checked before text()', async () => {
    const text = jest.fn(async () => '{}');
    const r = await checkBackupFile({ name: 'huge.json', size: MAX_BACKUP_BYTES + 1, text });
    expect(r).toMatchObject({ ok: false, error: { code: 'too_large' } });
    expect(text).not.toHaveBeenCalled();
  });

  it('a file of exactly 100 MiB is read (and then judged by its content)', async () => {
    const text = jest.fn(async () => 'not json');
    const r = await checkBackupFile({ name: 'edge.json', size: MAX_BACKUP_BYTES, text });
    expect(text).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ ok: false, error: { code: 'not_json' } });
  });

  it('a good backup comes back with its summary and the time it took', async () => {
    const a = await freshDb();
    await loadSeed(a, 'e1', 1_000_000);
    const text = serializeBackup(await exportBackup(a));
    let t = 100;
    const r = await checkBackupFile({ name: 'b.json', size: text.length, text: async () => text }, () => (t += 7));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.summary.counts).toMatchObject({ projects: 1, calculations: 3 });
      expect(r.checkMs).toBe(7);
    }
  });

  it('foreign, newer and damaged files are refused with a code', async () => {
    const mk = (s: string) => ({ name: 'x.json', size: s.length, text: async () => s });
    expect(await checkBackupFile(mk('[]'))).toMatchObject({ ok: false });
    expect(await checkBackupFile(mk(JSON.stringify({ app: 'other-app' })))).toMatchObject({ ok: false, error: { code: 'wrong_app' } });
  });
});

describe('replaceWithBackup: safety copy, progress, undo', () => {
  it('keeps what was there, replaces it, reports progress, and the kept copy restores the old data (undo)', async () => {
    const a = await freshDb();
    await loadSeed(a, 'e1', 1_000_000);
    const fromA = (await checkBackupFile({ name: 'a.json', size: 1, text: async () => serializeBackup(await exportBackup(a)) }));
    expect(fromA.ok).toBe(true);
    if (!fromA.ok) return;

    const phone = await freshDb();
    await createProject(phone, { name: 'Already here' });
    let safety = '';
    const phases: RestorePhase[] = [];
    const run = await replaceWithBackup(phone, fromA.backup, (t) => (safety = t), (p) => phases.push(p));
    expect(run.kept).toBe(true);
    expect(await names(phone)).toEqual(['Müller, Küche']);
    expect(phases[0]).toEqual({ kind: 'keeping' });
    const writing = phases.filter((p): p is Extract<RestorePhase, { kind: 'writing' }> => p.kind === 'writing');
    expect(writing.length).toBeGreaterThan(2);
    expect(writing[writing.length - 1].done).toBe(writing[writing.length - 1].total);
    expect(writing.map((w) => w.done)).toEqual([...writing.map((w) => w.done)].sort((x, y) => x - y));

    // undo: the safety copy goes through the same check and replace
    const undo = await checkBackupFile({ name: 'before.json', size: safety.length, text: async () => safety });
    expect(undo.ok).toBe(true);
    if (!undo.ok) return;
    let again = '';
    await replaceWithBackup(phone, undo.backup, (t) => (again = t));
    expect(await names(phone)).toEqual(['Already here']);
    expect(again).not.toBe(''); // undoing keeps the state before the undo: redo is possible
  });

  it('when the safety copy cannot be written nothing is replaced', async () => {
    const a = await freshDb();
    await loadSeed(a, 'e1', 1_000_000);
    const parsed = await checkBackupFile({ name: 'a.json', size: 1, text: async () => serializeBackup(await exportBackup(a)) });
    if (!parsed.ok) throw new Error('setup');
    const phone = await freshDb();
    await createProject(phone, { name: 'Keep me' });
    await expect(
      replaceWithBackup(phone, parsed.backup, () => {
        throw new Error('disk full');
      })
    ).rejects.toThrow(SafetyCopyError);
    expect(await names(phone)).toEqual(['Keep me']);
  });

  it('a phone with no data keeps no copy; settings alone count as data', async () => {
    const a = await freshDb();
    await loadSeed(a, 'e1', 1_000_000);
    const parsed = await checkBackupFile({ name: 'a.json', size: 1, text: async () => serializeBackup(await exportBackup(a)) });
    if (!parsed.ok) throw new Error('setup');
    const empty = await freshDb();
    const keep = jest.fn();
    expect((await replaceWithBackup(empty, parsed.backup, keep)).kept).toBe(false);
    expect(keep).not.toHaveBeenCalled();
    expect(holdsAnything(await exportBackup(await freshDb()))).toBe(false);
    const onlySettings = await freshDb();
    await onlySettings.runAsync("INSERT INTO settings (key, value) VALUES ('company.name', 'X')");
    expect(holdsAnything(await exportBackup(onlySettings))).toBe(true);
  });

  it('a failure while writing rolls back to exactly the old data and the safety copy exists', async () => {
    const a = await freshDb();
    await loadSeed(a, 'e1', 1_000_000);
    const parsed = await checkBackupFile({ name: 'a.json', size: 1, text: async () => serializeBackup(await exportBackup(a)) });
    if (!parsed.ok) throw new Error('setup');
    const broken = { ...parsed.backup, circuits: [{ ...parsed.backup.circuits[0], project_id: 999 }] };
    const phone = await freshDb();
    await createProject(phone, { name: 'Old' });
    let safety = '';
    await expect(replaceWithBackup(phone, broken, (t) => (safety = t))).rejects.toThrow();
    expect(await names(phone)).toEqual(['Old']);
    expect(safety).not.toBe('');
  });
});

describe('replaceWithBackup with photos (format 3, D100)', () => {
  const jpeg = (n: number) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9])]).toString('base64');
  const folder = () => {
    const files = new Map<string, string>();
    return {
      files,
      source: { read: async (row: Record<string, unknown>) => files.get(String(row.file_path)) ?? null },
      sink: { write: async (name: string, b64: string) => void files.set(name, b64) },
    };
  };
  async function phoneWithPhoto(name: string) {
    const db = await freshDb();
    await loadSeed(db, 'e1', 1_000_000);
    const f = folder();
    f.files.set(`photos/${name}.jpg`, jpeg(100));
    await addPhoto(db, { type: 'project', id: 1 }, { filePath: `photos/${name}.jpg`, width: 10, height: 10, bytes: 106 });
    return { db, f };
  }

  it('streams the safety copy with the phone\'s photos, restores the backup\'s photos, and the copy undoes it', async () => {
    const backupSide = await phoneWithPhoto('from-backup');
    let backupText = '';
    await writeBackupStream(backupSide.db, (c) => void (backupText += c), backupSide.f.source);
    const parsed = await checkBackupFile({ name: 'b.json', size: backupText.length, text: async () => backupText });
    if (!parsed.ok) throw new Error(parsed.error.detail);

    const phone = await phoneWithPhoto('on-phone');
    await createProject(phone.db, { name: 'Nur auf dem Telefon' });
    let kept = '';
    const run = await replaceWithBackup(phone.db, parsed.backup, () => undefined, undefined, Date.now, { source: phone.f.source, files: phone.f.sink, keep: (c) => void (kept += c), restoreId: 'a1' });
    expect(run).toMatchObject({ kept: true, written: ['photos/ra1-1.jpg'] });
    expect(await names(phone.db)).toEqual(['Müller, Küche']);
    expect(phone.f.files.get('photos/ra1-1.jpg')).toBe(backupSide.f.files.get('photos/from-backup.jpg'));
    // undo = restore the kept copy: the old project and the old photo (bytes from the copy) are back
    const undo = await checkBackupFile({ name: 'before.json', size: kept.length, text: async () => kept });
    if (!undo.ok) throw new Error(undo.error.detail);
    expect(undo.summary.counts).toMatchObject({ projects: 2, photos: 1 });
    await replaceWithBackup(phone.db, undo.backup, () => undefined, undefined, Date.now, { source: phone.f.source, files: phone.f.sink, keep: () => undefined, restoreId: 'u1' });
    expect(await names(phone.db)).toEqual(['Müller, Küche', 'Nur auf dem Telefon']);
    expect(phone.f.files.get('photos/ru1-1.jpg')).toBe(jpeg(100));
  });

  // REVIEW_V15_PA M6: the safety copy's StreamResult was thrown away; an over-cap or downscaled copy went unnoticed
  describe('the safety copy is checked (M6)', () => {
    const W = 2048;
    async function bigPhone() {
      const db = await freshDb();
      await loadSeed(db, 'e1', 1_000_000);
      const f = folder();
      f.files.set('photos/big.jpg', jpeg(60_000));
      await addPhoto(db, { type: 'project', id: 1 }, { filePath: 'photos/big.jpg', width: W, height: 1536, bytes: 60_006 });
      return { db, f };
    }
    async function smallBackup() {
      const other = await freshDb();
      await createProject(other, { name: 'Aus der Sicherung' });
      return exportBackup(other);
    }
    /** The restore cap for these tests: the phone's copy as stored does not fit, at 1600 px the estimate does. */
    async function capFor(db: Awaited<ReturnType<typeof freshDb>>, f: ReturnType<typeof folder>) {
      let n = 0;
      await writeBackupStream(db, (c) => void (n += Buffer.byteLength(c)), f.source);
      return n - 20_000;
    }
    /** A downscaler whose first answer is far bigger than the estimate (as the reviewer's probe), then honest ones. */
    const liarThenHonest = (calls: number[]) => async (row: Record<string, unknown>, maxEdge: number) => {
      calls.push(maxEdge);
      const scale = maxEdge / W;
      const size = calls.length === 1 ? 60_000 : Math.floor(60_000 * scale * scale);
      return { base64: jpeg(size), width: Math.round(W * scale), height: Math.round(1536 * scale) };
    };

    it('an over-cap copy without a way to start the file again refuses the restore: nothing replaced', async () => {
      const phone = await bigPhone();
      const cap = await capFor(phone.db, phone.f);
      const calls: number[] = [];
      const source = { ...phone.f.source, downscale: liarThenHonest(calls) };
      await expect(replaceWithBackup(phone.db, await smallBackup(), () => undefined, undefined, Date.now, { source, files: phone.f.sink, keep: () => undefined, maxBytes: cap, restoreId: 'm6a' })).rejects.toBeInstanceOf(SafetyCopyError);
      expect(await names(phone.db)).toEqual(['Müller, Küche']);
      expect(calls).toHaveLength(1); // one copy at the plan's edge, flagged over the cap, no second try without `restart`
    });

    it('with `restart` it retries at the next lower edge, and the run says the undo brings photos back downscaled', async () => {
      const phone = await bigPhone();
      const cap = await capFor(phone.db, phone.f);
      const calls: number[] = [];
      let copy = '';
      let restarts = 0;
      const source = { ...phone.f.source, downscale: liarThenHonest(calls) };
      const run = await replaceWithBackup(phone.db, await smallBackup(), () => undefined, undefined, Date.now, {
        source,
        files: phone.f.sink,
        keep: (c) => void (copy += c),
        restart: () => {
          restarts++;
          copy = '';
        },
        maxBytes: cap,
        restoreId: 'm6b',
      });
      // the plan's edge first, then exactly the next lower step of the ladder
      expect(calls).toEqual([calls[0], BACKUP_PHOTO_EDGES[BACKUP_PHOTO_EDGES.indexOf(calls[0]) + 1]]);
      expect(restarts).toBe(1);
      expect(Buffer.byteLength(copy)).toBeLessThanOrEqual(cap);
      expect(run.safety).toMatchObject({ maxEdge: calls[1], downscaled: 1, photos: 1, missing: [] });
      // the full-size original stays for the glue to keep until the undo expires
      expect(run.previousPhotoFiles).toEqual(['photos/big.jpg']);
      expect(await names(phone.db)).toEqual(['Aus der Sicherung']);
      const undo = await checkBackupFile({ name: 'before.json', size: copy.length, text: async () => copy }, Date.now);
      expect(undo.ok).toBe(true);
      if (undo.ok) expect(undo.backup.photos?.map((p) => p.width)).toEqual([calls[1]]);
    });

    it('a copy that is over the cap even at 640 px refuses; a photo that cannot be copied refuses too', async () => {
      const phone = await bigPhone();
      const cap = await capFor(phone.db, phone.f);
      const always = async () => ({ base64: jpeg(60_000), width: 640, height: 480 });
      type Source = NonNullable<Parameters<typeof replaceWithBackup>[5]>['source'];
      const restore = async (source: Source, maxBytes?: number) =>
        replaceWithBackup(phone.db, await smallBackup(), () => undefined, undefined, Date.now, { source, files: phone.f.sink, keep: () => undefined, restart: () => undefined, ...(maxBytes ? { maxBytes } : {}) });
      await expect(restore({ ...phone.f.source, downscale: always }, cap)).rejects.toThrow(/above the restore limit/);
      // a stored file that is no JPEG (and no downscaler to convert it) would be lost by the undo: refused
      phone.f.files.set('photos/big.jpg', Buffer.from('not a jpeg at all').toString('base64'));
      await expect(restore(phone.f.source)).rejects.toThrow(/could not be copied/);
      expect(await names(phone.db)).toEqual(['Müller, Küche']);
    });
  });

  it('without the photo streams a phone or backup with photos is refused before anything changes', async () => {
    const phone = await phoneWithPhoto('on-phone');
    const empty = await exportBackup(await freshDb());
    await expect(replaceWithBackup(phone.db, empty, () => undefined)).rejects.toBeInstanceOf(SafetyCopyError);
    expect(await names(phone.db)).toEqual(['Müller, Küche']);
  });
});
