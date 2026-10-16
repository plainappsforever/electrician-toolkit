/**
 * @jest-environment node
 */
// Writes the two backup files the Release backup flow (.maestro/release/backup-restore.yaml, v1.1 F13) picks through the
// REAL system picker: `release-backup.json` (the e1 seed + a cable table, exported by the app's own code, format 2 with
// checksums) and `release-backup-edited.json` (the same file with the E1 result forged to "1.23 % within" and its checksum
// recomputed — the probe D1 forger; the restore must refuse it). Deterministic. Not part of `npm test` (testMatch).
// Run: npx jest --testMatch '**/test/gen/*.gen.ts' test/gen
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestDb } from '../node-sqlite-db';
import { calculationChecksum, exportBackup, serializeBackup } from '@/db/backup';
import { migrate } from '@/db/migrations';
import { createCableTable } from '@/db/tables';
import { loadSeed } from '@/dev/seeds';

it('writes the Release backup fixtures', async () => {
  const db = createTestDb();
  await migrate(db);
  await loadSeed(db, 'e1', Date.UTC(2026, 9, 4, 8, 0, 0));
  await createCableTable(db, { name: 'Release test table', sourceNote: 'Invented test values, not from a standard', material: 'cu', insulationMaxC: 70, referenceAmbientC: 30, methodLabel: 'C', loadedConductors: 2 }, [
    { sizeMm2: 1.5, izA: 20 },
    { sizeMm2: 2.5, izA: 28 },
  ]);
  const file = await exportBackup(db, '2026-10-04T08:00:00.000Z');
  const dir = join(__dirname, '../fixtures/files');
  writeFileSync(join(dir, 'release-backup.json'), serializeBackup(file));
  const forged = JSON.parse(serializeBackup(file)) as typeof file;
  const row = forged.calculations.find((c) => c.kind === 'vdrop' && c.project_id !== null)! as Record<string, string | number | null>;
  const r = JSON.parse(String(row.result_json));
  r.values.deltaUPercent.value = 1.23;
  r.checks[0].met = true;
  r.checks[0].key = 'check.vdrop.within';
  r.texts.verdict = 'within';
  row.result_json = JSON.stringify(r);
  forged.checksums!.calculations[String(row.id)] = calculationChecksum(row);
  writeFileSync(join(dir, 'release-backup-edited.json'), serializeBackup(forged));
  expect(file.calculations.length).toBeGreaterThan(0);
});
