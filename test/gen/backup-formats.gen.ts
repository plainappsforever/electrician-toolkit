/**
 * @jest-environment node
 */
// Writes the frozen backup files of each format that the app must keep restoring (V1.5 phase A, D100):
//  - backup-format1.json: the shape v1.0 wrote (backupVersion 1, schema 2, no checksums, engine 1.0.0 results). SYNTHESIZED
//    from the e1 seed by the same transformation the v1.1 F7 test uses (1.0.0 lacked two assumption texts and the loop.ik
//    check); no v1.0 build was run for it.
//  - backup-format2.json is a frozen copy of `release-backup.json` as the v1.1 code wrote it (F13) — never regenerated.
//  - backup-format3.json: e1 seed + a cable table + two real JPEG photos (test/fixtures/photos), written by
//    writeBackupStream — the format this app writes now.
// Deterministic. Not part of `npm test` (testMatch). Run ONLY this file (the other generator rewrites the Release fixtures):
//   npx jest --testMatch '**/test/gen/backup-formats.gen.ts'
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestDb } from '../node-sqlite-db';
import { exportBackup, serializeBackup, writeBackupStream, type BackupFile } from '@/db/backup';
import { migrate } from '@/db/migrations';
import { addPhoto } from '@/db/photos';
import { createCableTable } from '@/db/tables';
import { loadSeed } from '@/dev/seeds';

const T0 = Date.UTC(2026, 9, 15, 8, 0, 0);
const files = join(__dirname, '../fixtures/files');
const photo = (name: string) => readFileSync(join(__dirname, '../fixtures/photos', name)).toString('base64');

async function seeded() {
  const db = createTestDb();
  await migrate(db);
  await loadSeed(db, 'e1', T0);
  await createCableTable(db, { name: 'Format test table', sourceNote: 'Invented test values, not from a standard', material: 'cu', insulationMaxC: 70, referenceAmbientC: 30, methodLabel: 'C', loadedConductors: 2 }, [
    { sizeMm2: 1.5, izA: 20 },
    { sizeMm2: 2.5, izA: 28 },
  ], T0);
  return db;
}

it('writes backup-format1.json and backup-format3.json', async () => {
  const db = await seeded();
  // format 1
  const f = JSON.parse(serializeBackup(await exportBackup(db, '2026-10-15T08:00:00.000Z'))) as Partial<BackupFile> & Record<string, unknown>;
  f.backupVersion = 1;
  f.schemaVersion = 2;
  f.engineVersion = '1.0.0';
  delete f.checksums;
  delete f.photos;
  delete f.photoData;
  for (const c of f.calculations as Record<string, string | number | null>[]) {
    c.engine_version = '1.0.0';
    const r = JSON.parse(String(c.result_json));
    r.engineVersion = '1.0.0';
    r.assumptions = r.assumptions.filter((a: { key: string }) => !['assume.vdrop.minSize.scope', 'assume.coord.suggestionScope'].includes(a.key));
    r.checks = r.checks.filter((x: { id: string }) => x.id !== 'loop.ik');
    c.result_json = JSON.stringify(r);
  }
  writeFileSync(join(files, 'backup-format1.json'), JSON.stringify(f));
  // format 3 with two photos
  const calcId = (await db.getFirstAsync<{ id: number }>('SELECT id FROM calculations WHERE project_id IS NOT NULL ORDER BY id'))!.id;
  const data: Record<string, string> = { 'photos/board.jpg': photo('board-1200x900.jpg'), 'photos/cable.jpg': photo('cable-480x640.jpg') };
  await addPhoto(db, { type: 'project', id: 1 }, { filePath: 'photos/board.jpg', width: 1200, height: 900, bytes: Buffer.from(data['photos/board.jpg'], 'base64').length, caption: 'Verteiler UV1' }, T0);
  await addPhoto(db, { type: 'calculation', id: calcId }, { filePath: 'photos/cable.jpg', width: 480, height: 640, bytes: Buffer.from(data['photos/cable.jpg'], 'base64').length, caption: 'Kabelweg F3' }, T0);
  let text = '';
  await writeBackupStream(db, (chunk) => void (text += chunk), { read: async (row) => data[String(row.file_path)] ?? null }, { exportedAt: '2026-10-15T08:00:00.000Z' });
  writeFileSync(join(files, 'backup-format3.json'), text);
  expect(text.length).toBeGreaterThan(100_000);
});
