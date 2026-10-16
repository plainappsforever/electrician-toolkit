/** @jest-environment node */
// The device probes also pass on the Node fake: a probe failing on a phone then points at the platform (expo-sqlite,
// Hermes), not at the probe itself.
import { createTestDb } from '../../test/node-sqlite-db';
import { migrate } from '@/db/migrations';

import { runDbProbes, runIntlProbes, runRestoreTiming } from './probe';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

describe('device probes on Node', () => {
  it('database probes pass', async () => {
    const lines = await runDbProbes(await freshDb());
    expect(lines.filter((l) => !l.ok)).toEqual([]);
    expect(lines.length).toBeGreaterThanOrEqual(18);
  });

  it('display-rule and Intl probes pass', () => {
    const lines = runIntlProbes();
    expect(lines.filter((l) => !l.ok)).toEqual([]);
  });

  it('restore timing of the many backup round-trips', async () => {
    const r = await runRestoreTiming(await freshDb());
    expect(r.ok).toBe(true);
    expect(r.fileMB).toBeGreaterThan(40);
  }, 120_000);
});
