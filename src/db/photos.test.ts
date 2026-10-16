/**
 * @jest-environment node
 */
// Photos repository (V1.5 phase A, NW1, migration 3, D99).
import { createTestDb } from '../../test/node-sqlite-db';
import { E1_INPUT, loadSeed } from '@/dev/seeds';
import { compute } from '@/engine';

import { recordHistory } from './calculations';
import { migrate } from './migrations';
import { MAX_PHOTO_BACKUP_BYTES } from './backup';
import { addPhoto, checkNewPhoto, deletePhoto, getPhoto, listPhotos, PHOTO_LIMITS, projectPhotos, referencedPhotoFiles, reorderPhotos, setPhotoCaption, SWEEP_MIN_AGE_MS, unreferencedPhotoFiles } from './photos';
import { createCircuit, createProject, deleteProject } from './projects';

async function seeded() {
  const db = createTestDb();
  await migrate(db);
  await loadSeed(db, 'e1', 1_000_000); // project 1, circuit 1, 3 saved calculations
  return db;
}
const jpg = (name: string, extra: Partial<{ width: number; height: number; bytes: number; caption: string }> = {}) => ({ filePath: `photos/${name}.jpg`, width: 2048, height: 1536, bytes: 412_000, ...extra });

describe('photos repository', () => {
  it('adds photos to a project, circuit and saved calculation, in order, and lists them per owner', async () => {
    const db = await seeded();
    const calcId = (await db.getFirstAsync<{ id: number }>('SELECT id FROM calculations WHERE project_id = 1 ORDER BY id'))!.id;
    const a = await addPhoto(db, { type: 'project', id: 1 }, jpg('a', { caption: '  Zählerschrank  ' }), 10);
    const b = await addPhoto(db, { type: 'project', id: 1 }, jpg('b'), 11);
    await addPhoto(db, { type: 'circuit', id: 1 }, jpg('c'), 12);
    await addPhoto(db, { type: 'calculation', id: calcId }, jpg('d'), 13);
    const list = await listPhotos(db, { type: 'project', id: 1 });
    expect(list.map((p) => [p.id, p.sort, p.caption])).toEqual([
      [a, 0, 'Zählerschrank'],
      [b, 1, ''],
    ]);
    expect(await getPhoto(db, a)).toMatchObject({ owner: { type: 'project', id: 1 }, filePath: 'photos/a.jpg', width: 2048, height: 1536, bytes: 412_000, createdAt: 10 });
    expect((await projectPhotos(db, 1)).map((p) => p.filePath)).toEqual(['photos/a.jpg', 'photos/b.jpg', 'photos/c.jpg', 'photos/d.jpg']);
  });

  it('refuses a missing owner, a history entry, a bad path, bad sizes, a long caption, a used path, too many photos', async () => {
    const db = await seeded();
    await recordHistory(db, { kind: 'vdrop', input: E1_INPUT, result: compute('vdrop', E1_INPUT as never) }, 2_000_000);
    const historyId = (await db.getFirstAsync<{ id: number }>('SELECT id FROM calculations WHERE project_id IS NULL'))!.id;
    await expect(addPhoto(db, { type: 'project', id: 99 }, jpg('x'))).rejects.toMatchObject({ code: 'not_found' });
    await expect(addPhoto(db, { type: 'calculation', id: historyId }, jpg('x'))).rejects.toMatchObject({ code: 'not_saveable' });
    await expect(addPhoto(db, { type: 'invoice' as never, id: 1 }, jpg('x'))).rejects.toMatchObject({ code: 'invalid' });
    for (const filePath of ['/abs/photos/x.jpg', 'photos/../x.jpg', 'photos/x.png', 'photos/sub/x.jpg', 'x.jpg', '']) {
      await expect(addPhoto(db, { type: 'project', id: 1 }, { ...jpg('x'), filePath })).rejects.toMatchObject({ code: 'invalid', field: 'filePath' });
    }
    await expect(addPhoto(db, { type: 'project', id: 1 }, jpg('x', { width: 0 }))).rejects.toMatchObject({ field: 'width' });
    await expect(addPhoto(db, { type: 'project', id: 1 }, jpg('x', { height: PHOTO_LIMITS.maxEdge + 1 }))).rejects.toMatchObject({ field: 'height' });
    await expect(addPhoto(db, { type: 'project', id: 1 }, jpg('x', { bytes: PHOTO_LIMITS.maxBytes + 1 }))).rejects.toMatchObject({ field: 'bytes' });
    await expect(addPhoto(db, { type: 'project', id: 1 }, jpg('x', { width: 1.5 }))).rejects.toMatchObject({ field: 'width' });
    await expect(addPhoto(db, { type: 'project', id: 1 }, jpg('x', { caption: 'x'.repeat(501) }))).rejects.toMatchObject({ field: 'caption' });
    await addPhoto(db, { type: 'project', id: 1 }, jpg('x'));
    await expect(addPhoto(db, { type: 'circuit', id: 1 }, jpg('x'))).rejects.toMatchObject({ code: 'duplicate' });
    for (let i = 1; i < PHOTO_LIMITS.perOwner; i++) await addPhoto(db, { type: 'circuit', id: 1 }, jpg(`n${i}`));
    await addPhoto(db, { type: 'circuit', id: 1 }, jpg('last'));
    await expect(addPhoto(db, { type: 'circuit', id: 1 }, jpg('one-too-many'))).rejects.toMatchObject({ code: 'invalid', field: 'owner' });
  });

  it('caption, reorder (exactly the owner ids), delete returns the file path for the caller to remove', async () => {
    const db = await seeded();
    const ids: number[] = [];
    for (const n of ['a', 'b', 'c']) ids.push(await addPhoto(db, { type: 'circuit', id: 1 }, jpg(n)));
    await setPhotoCaption(db, ids[1], ' Kabelweg ', 50);
    expect(await getPhoto(db, ids[1])).toMatchObject({ caption: 'Kabelweg', updatedAt: 50 });
    await expect(setPhotoCaption(db, 999, 'x')).rejects.toMatchObject({ code: 'not_found' });
    await reorderPhotos(db, { type: 'circuit', id: 1 }, [ids[2], ids[0], ids[1]]);
    expect((await listPhotos(db, { type: 'circuit', id: 1 })).map((p) => p.id)).toEqual([ids[2], ids[0], ids[1]]);
    await expect(reorderPhotos(db, { type: 'circuit', id: 1 }, [ids[0], ids[1]])).rejects.toMatchObject({ code: 'invalid' });
    expect(await deletePhoto(db, ids[0])).toBe('photos/a.jpg');
    await expect(deletePhoto(db, ids[0])).rejects.toMatchObject({ code: 'not_found' });
    expect([...(await referencedPhotoFiles(db))].sort()).toEqual(['photos/b.jpg', 'photos/c.jpg']);
  });

  it('deleting a project removes the photo rows of the project, its circuits and calculations (the files become unreferenced)', async () => {
    const db = await seeded();
    const other = await createProject(db, { name: 'Andere' });
    const circuit = await createCircuit(db, other, { label: 'F9' });
    await addPhoto(db, { type: 'project', id: 1 }, jpg('p1'));
    await addPhoto(db, { type: 'circuit', id: 1 }, jpg('c1'));
    await addPhoto(db, { type: 'circuit', id: circuit }, jpg('c9'));
    await deleteProject(db, 1);
    const referenced = await referencedPhotoFiles(db);
    expect([...referenced]).toEqual(['photos/c9.jpg']);
    expect(unreferencedPhotoFiles(referenced, ['photos/p1.jpg', 'photos/c1.jpg', 'photos/c9.jpg', 'notes.txt', 'photos/../x.jpg'])).toEqual(['photos/p1.jpg', 'photos/c1.jpg']);
  });

  it('S1: a photo the backup could not hold (above 8 MiB) is never stored', async () => {
    expect(PHOTO_LIMITS.maxBytes).toBe(MAX_PHOTO_BACKUP_BYTES);
    const db = await seeded();
    await expect(addPhoto(db, { type: 'project', id: 1 }, jpg('big', { bytes: 10 * 1024 * 1024 }))).rejects.toMatchObject({ field: 'bytes' });
  });

  it('S9: the sweep spares files written in the last 10 minutes and the files kept for an undo', () => {
    const now = 1_760_000_000_000;
    const files = [
      { path: 'photos/old.jpg', modifiedMs: now - SWEEP_MIN_AGE_MS - 1 },
      { path: 'photos/fresh.jpg', modifiedMs: now - 1000 }, // a capture or restore between file and row
      { path: 'photos/undo.jpg', modifiedMs: now - 3_600_000 }, // RestoreRun.previousPhotoFiles
      { path: 'photos/kept.jpg', modifiedMs: now - 3_600_000 },
    ];
    expect(unreferencedPhotoFiles(new Set(['photos/kept.jpg']), files, { now, keep: ['photos/undo.jpg'] })).toEqual(['photos/old.jpg']);
    expect(unreferencedPhotoFiles(new Set(), files, { now, minAgeMs: 0 })).toEqual(['photos/old.jpg', 'photos/fresh.jpg', 'photos/undo.jpg', 'photos/kept.jpg']);
  });

  it('checkNewPhoto: storage defaults are inside the limits', () => {
    expect(PHOTO_LIMITS.storeMaxEdge).toBeLessThanOrEqual(PHOTO_LIMITS.maxEdge);
    expect(checkNewPhoto(jpg('ok'))).toEqual({ filePath: 'photos/ok.jpg', width: 2048, height: 1536, bytes: 412_000, caption: '' });
  });
});
