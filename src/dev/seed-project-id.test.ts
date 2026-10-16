/** @jest-environment node */
// The device probes and dev routes address "the first project after a seed": MIN(id) of projects holds the seeded calculations.
import { createTestDb } from '../../test/node-sqlite-db';
import { listCalculations } from '@/db/calculations';
import { migrate } from '@/db/migrations';

import { loadSeed } from './seeds';

it('after the e1 seed the lowest project id owns its three saved calculations', async () => {
  const db = createTestDb();
  await migrate(db);
  await loadSeed(db, 'e1', 1);
  const pid = (await db.getFirstAsync<{ id: number }>('SELECT MIN(id) AS id FROM projects'))!.id;
  expect(await listCalculations(db, pid)).toHaveLength(3);
});
