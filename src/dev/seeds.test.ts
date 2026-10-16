/** @jest-environment node */
import { createTestDb } from '../../test/node-sqlite-db';
import { backupExceedsRestoreLimit, backupFileSizeProblem, exportBackup, parseBackup, restoreBackup, serializeBackup, utf8Length } from '@/db/backup';
import { listCalculations } from '@/db/calculations';
import { migrate } from '@/db/migrations';
import { listProjects } from '@/db/projects';
import { getAppSettings, saveSetting } from '@/db/settings';
import { getCableTable, listCableTables } from '@/db/tables';
import { compute } from '@/engine';

import { E3_INPUT, EXAMPLE_TABLE, isSeedName, loadSeed, SEED_NAMES } from './seeds';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}
const n = async (db: Awaited<ReturnType<typeof freshDb>>, t: string) => (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))?.n;

describe('dev seeds', () => {
  it('names', () => {
    expect([...SEED_NAMES]).toEqual(['empty', 'e1', 'table', 'many', 'huge']);
    expect(isSeedName('e1')).toBe(true);
    expect(isSeedName('nope')).toBe(false);
  });

  it('empty wipes everything, settings included', async () => {
    const db = await freshDb();
    await loadSeed(db, 'e1');
    await saveSetting(db, 'paper', 'Letter');
    await loadSeed(db, 'empty');
    for (const t of ['projects', 'circuits', 'calculations', 'cable_tables', 'settings']) expect(await n(db, t)).toBe(0);
    expect((await getAppSettings(db)).paper).toBe('A4');
  });

  it('e1: one project, one circuit, E1, E3 and E4 saved with the engine results from SPEC §8', async () => {
    const db = await freshDb();
    expect(await loadSeed(db, 'e1', 1000)).toEqual({ projects: 1, circuits: 1, calculations: 3, tables: 0 });
    const [project] = await listProjects(db);
    expect(project).toMatchObject({ name: 'Müller, Küche', circuitCount: 1, calculationCount: 3 });
    const calcs = await listCalculations(db, project.id);
    expect(calcs.map((c) => c.kind)).toEqual(['vdrop', 'coord', 'loop']);
    expect(calcs[0].result?.values.deltaUPercent.value).toBeCloseTo(3.7565217391, 9);
    expect(calcs[1].result?.texts.suggestion).toBe('B13');
    expect(calcs[2].result?.values.lMax.value).toBeCloseTo(91.7989970748, 9);
    expect(calcs.every((c) => c.circuitId !== null)).toBe(true);
  });

  it('table: one example table whose labels name its real source (IEC Table B.52.2 method C) and say "seed only"; E3 on it gives B13', async () => {
    const db = await freshDb();
    await loadSeed(db, 'table');
    const [t] = await listCableTables(db);
    expect(t.name).toContain('IEC 60364-5-52 Table B.52.2, method C');
    expect(t.name).not.toMatch(/not from a standard/);
    expect(t.sourceNote).toContain('Table B.52.2, reference method C');
    expect(t.sourceNote).toContain('Development and test seed only');
    expect((E3_INPUT as { table: { sourceNote: string } }).table.sourceNote).toBe(t.sourceNote);
    const got = (await getCableTable(db, t.id))!;
    expect(got.rows).toEqual(EXAMPLE_TABLE.rows);
    const result = compute('coord', E3_INPUT as never);
    expect(result.texts.suggestion).toBe('B13');
  });

  it('loading a seed twice gives the same data (it wipes first)', async () => {
    const db = await freshDb();
    await loadSeed(db, 'e1');
    await loadSeed(db, 'e1');
    expect(await n(db, 'projects')).toBe(1);
    expect(await n(db, 'calculations')).toBe(3);
    await loadSeed(db, 'table');
    expect(await n(db, 'projects')).toBe(0);
    expect(await n(db, 'cable_tables')).toBe(1);
  });

  it('many (A13): 200 × 10 × 5, projects list fast, backup of it validates', async () => {
    const db = await freshDb();
    const t0 = Date.now();
    const counts = await loadSeed(db, 'many', 1_000_000);
    const seedMs = Date.now() - t0;
    expect(counts).toEqual({ projects: 200, circuits: 2000, calculations: 10_000, tables: 0 });
    expect(await n(db, 'calculations')).toBe(10_000);
    const t1 = Date.now();
    const list = await listProjects(db);
    const listMs = Date.now() - t1;
    expect(list).toHaveLength(200);
    expect(list[0]).toMatchObject({ circuitCount: 10, calculationCount: 50 });
    expect(listMs).toBeLessThan(1000);
    const text = serializeBackup(await exportBackup(db));
    // D57 (review #6): the app restores every file its own export produces for the A13 volume — the 10 000-calculation
    // backup (≈ 57 MB) is under the 100 MiB cap, validates, and round-trips row for row.
    expect(backupExceedsRestoreLimit(text)).toBe(false);
    expect(backupFileSizeProblem(utf8Length(text))).toBeNull();
    const t2 = Date.now();
    const parsed = parseBackup(text);
    const validateMs = Date.now() - t2;
    expect(parsed.ok ? 'ok' : parsed.error).toBe('ok');
    if (!parsed.ok) return;
    const before = await db.getFirstAsync<{ n: number; s: number }>('SELECT COUNT(*) AS n, SUM(length(result_json)) AS s FROM calculations');
    await restoreBackup(db, parsed.backup);
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n, SUM(length(result_json)) AS s FROM calculations')).toEqual(before);
    console.info(`many backup: validate ${validateMs} ms`);
    console.info(`seed many: ${seedMs} ms, projects list: ${listMs} ms (Node, in-memory), backup ${(text.length / 1048576).toFixed(1)} MB`);
  }, 60_000);
});
