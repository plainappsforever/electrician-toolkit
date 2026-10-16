/**
 * @jest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestDb } from '../../test/node-sqlite-db';
import { E1_INPUT, loadSeed } from '@/dev/seeds';

import {
  BACKUP_APP,
  backupExceedsRestoreLimit,
  backupFileName,
  backupFileSizeProblem,
  calculationChecksum,
  dataCounts,
  EXPORT_PAGE_ROWS,
  exportBackup,
  isNewerVersion,
  MAX_BACKUP_BYTES,
  utf8Length,
  parseBackup,
  restoreBackup,
  restoreFromText,
  serializeBackup,
  TABLES,
  type BackupFile,
} from './backup';
import { recordHistory } from './calculations';
import { migrate } from './migrations';
import { createProject } from './projects';
import { saveSetting } from './settings';
import { createCableTable } from './tables';
import { compute, ENGINE_VERSION } from '@/engine';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

async function snapshotOf(db: Awaited<ReturnType<typeof freshDb>>) {
  const out: Record<string, unknown> = {};
  for (const t of ['projects', 'circuits', 'calculations', 'cable_tables', 'cable_table_rows', 'settings']) out[t] = await db.getAllAsync(`SELECT * FROM ${t} ORDER BY 1, 2`);
  return out;
}

/** A populated database: the e1 seed, a user table, settings (incl. a logo) and history. */
async function populated() {
  const db = await freshDb();
  await loadSeed(db, 'e1', 1_000_000);
  await createCableTable(db, { name: 'Tabelle', sourceNote: 'Datenblatt', material: 'cu', insulationMaxC: 70, referenceAmbientC: 30, methodLabel: 'C', loadedConductors: 2 }, [
    { sizeMm2: 1.5, izA: 20 },
    { sizeMm2: 2.5, izA: 27 },
  ]);
  await saveSetting(db, 'company.name', 'Elektro Müller');
  await saveSetting(db, 'logoDataUri', 'data:image/png;base64,iVBORw0KGgo=');
  await saveSetting(db, 'language', 'de');
  await recordHistory(db, { kind: 'vdrop', input: E1_INPUT, result: compute('vdrop', E1_INPUT as never) }, 2_000_000);
  return db;
}

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** The shape v1.0 wrote: backup version 1, schema 2, no checksums, no photo keys. */
function asVersion1(f: BackupFile): BackupFile {
  const g = f as Partial<BackupFile> & Record<string, unknown>;
  g.backupVersion = 1;
  g.schemaVersion = 2;
  delete g.checksums;
  delete g.photos;
  delete g.photoData;
  return g as BackupFile;
}

describe('backup round trip (A6)', () => {
  it('exports every table and restores it into an empty database, row for row', async () => {
    const a = await populated();
    const file = await exportBackup(a, '2026-10-01T10:00:00.000Z');
    expect(file).toMatchObject({ app: BACKUP_APP, backupVersion: 3, schemaVersion: 3, engineVersion: ENGINE_VERSION, photos: [], photoData: {} });
    expect(file.projects).toHaveLength(1);
    expect(file.calculations).toHaveLength(4); // 3 saved + 1 history
    const text = serializeBackup(file);
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.summary).toMatchObject({ counts: { projects: 1, circuits: 1, calculations: 3, history: 1, cableTables: 1, cableTableRows: 2 }, hasLogo: true });

    const b = await freshDb();
    expect(await restoreFromText(b, text)).toMatchObject({ ok: true });
    expect(await snapshotOf(b)).toEqual(await snapshotOf(a));
    // and the restored data exports to the same file
    expect(await exportBackup(b, '2026-10-01T10:00:00.000Z')).toEqual(file);
  });

  it('replaces everything that was there before and keeps ids usable afterwards', async () => {
    const a = await populated();
    const text = serializeBackup(await exportBackup(a));
    const b = await freshDb();
    await createProject(b, { name: 'Old' });
    await loadSeed(b, 'table');
    await restoreFromText(b, text);
    expect(await snapshotOf(b)).toEqual(await snapshotOf(a));
    const next = await createProject(b, { name: 'New' });
    expect(next).toBeGreaterThan(1);
  });

  it('pages the export (EXPORT_PAGE_ROWS): the many seed comes out complete, in id order, and restores to the same data', async () => {
    const a = await freshDb();
    await loadSeed(a, 'many');
    const file = await exportBackup(a, '2026-10-01T10:00:00.000Z');
    expect(file.projects).toHaveLength(200);
    expect(file.calculations).toHaveLength(10000);
    expect(10000 > EXPORT_PAGE_ROWS * 2).toBe(true); // several full pages and a last partial one
    const ids = file.calculations.map((c) => c.id as number);
    expect(ids.every((id, i) => i === 0 || id > ids[i - 1])).toBe(true);
    expect(new Set(ids).size).toBe(10000);
    const b = await freshDb();
    expect(await restoreFromText(b, serializeBackup(file))).toMatchObject({ ok: true });
    expect(await exportBackup(b, '2026-10-01T10:00:00.000Z')).toEqual(file);
  });

  it('a backup of an empty database (no tables, no calculations) restores', async () => {
    const empty = await freshDb();
    const text = serializeBackup(await exportBackup(empty));
    const b = await populated();
    expect(await restoreFromText(b, text)).toMatchObject({ ok: true, summary: { counts: { projects: 0, cableTables: 0 } } });
    expect((await snapshotOf(b)).projects).toEqual([]);
    expect((await snapshotOf(b)).settings).toEqual([]);
  });

  it('column lists mirror migration 2', async () => {
    const db = await freshDb();
    for (const [name, spec] of Object.entries(TABLES)) {
      const cols = (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${name})`)).map((c) => c.name).sort();
      expect(spec.columns.map((c) => c.name).sort()).toEqual(cols);
    }
  });

  it('file name', () => {
    expect(backupFileName('2026-10-01')).toBe('electrician-toolkit-backup-2026-10-01.json');
  });
});

describe('hostile and broken files are refused before any write (A6)', () => {
  let good: BackupFile;
  beforeAll(async () => {
    good = await exportBackup(await populated(), '2026-10-01T10:00:00.000Z');
  });

  const refuseText = async (text: string, code: string, detail?: RegExp) => {
    const target = await populated();
    const before = await snapshotOf(target);
    const outcome = await restoreFromText(target, text);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe(code);
    if (detail) expect(outcome.error.detail).toMatch(detail);
    expect(await snapshotOf(target)).toEqual(before); // database unchanged
  };
  const refuse = (mutate: (f: Record<string, any>) => unknown, code: string, detail?: RegExp) => {
    const file = clone(good) as unknown as Record<string, any>;
    mutate(file);
    return refuseText(JSON.stringify(file), code, detail);
  };

  it('not JSON, not an object, empty, foreign app, no app', async () => {
    await refuseText('{"app":', 'not_json');
    await refuseText('', 'not_json');
    await refuseText('[1,2]', 'not_a_backup');
    await refuseText('null', 'not_a_backup');
    await refuse((f) => (f.app = 'print-cost'), 'wrong_app');
    await refuse((f) => delete f.app, 'not_a_backup');
  });

  it('too large (before parsing), newer backup, newer schema, bad versions, too old', async () => {
    expect(parseBackup('x'.repeat(100), { maxBytes: 50 })).toMatchObject({ ok: false, error: { code: 'too_large' } });
    expect(MAX_BACKUP_BYTES).toBe(100 * 1024 * 1024); // SPEC §11 amended (D57)
    await refuse((f) => (f.backupVersion = 4), 'newer_backup'); // V1.5 A: this app writes and reads version 3
    await refuse((f) => (f.schemaVersion = 4), 'newer_schema');
    await refuse((f) => (f.schemaVersion = 2), 'invalid_version'); // a version 3 file comes from schema 3
    await refuse((f) => (f.backupVersion = '1'), 'invalid_version');
    await refuse((f) => (f.schemaVersion = 0), 'invalid_version');
    await refuse((f) => (f.schemaVersion = 1), 'invalid_version');
  });

  it('structure: missing or wrong-typed sections, unknown keys, bad date', async () => {
    await refuse((f) => delete f.projects, 'invalid_structure');
    await refuse((f) => (f.cableTables = {}), 'invalid_structure');
    await refuse((f) => (f.settings = []), 'invalid_structure');
    await refuse((f) => (f.surprise = 1), 'invalid_structure', /surprise/);
    await refuse((f) => (f.exportedAt = 'yesterday'), 'invalid_structure');
    await refuse((f) => delete f.engineVersion, 'invalid_structure');
    await refuseText('{"app":"electrician-toolkit","backupVersion":1,"schemaVersion":2,"exportedAt":"2026-10-01T00:00:00Z","engineVersion":"1","__proto__":{"x":1},"settings":{},"projects":[],"circuits":[],"calculations":[],"cableTables":[],"cableTableRows":[]}', 'invalid_structure', /__proto__/);
  });

  it('rows: wrong types, nulls, unknown/missing columns, ranges, enums', async () => {
    await refuse((f) => (f.projects[0].name = 5), 'invalid_row', /projects\[0\]\.name/);
    await refuse((f) => (f.projects[0].name = '   '), 'invalid_row');
    await refuse((f) => (f.projects[0].archived = 2), 'invalid_row');
    await refuse((f) => (f.projects[0].id = 1.5), 'invalid_row');
    await refuse((f) => (f.projects[0].created_at = -1), 'invalid_row');
    await refuse((f) => (f.projects[0].extra = 1), 'invalid_row', /unknown column/);
    await refuse((f) => delete f.projects[0].notes, 'invalid_row', /lacks notes/);
    await refuse((f) => (f.circuits[0].label = null), 'invalid_row');
    await refuse((f) => (f.calculations[0].kind = 'bogus'), 'invalid_row');
    await refuse((f) => (f.cableTables[0].material = 'fe'), 'invalid_row');
    await refuse((f) => (f.cableTables[0].loaded_conductors = 4), 'invalid_row');
    await refuse((f) => (f.cableTables[0].source_note = ''), 'invalid_row');
    await refuse((f) => (f.cableTableRows[0].iz_a = 0), 'invalid_row');
    await refuse((f) => (f.cableTableRows[0].size_mm2 = '1.5'), 'invalid_row');
    await refuse((f) => (f.projects[0].name = 'x'.repeat(201)), 'invalid_row');
  });

  it('stored calculations must be well-formed JSON of the right calculator, without errors', async () => {
    await refuse((f) => (f.calculations[0].inputs_json = '{not json'), 'invalid_row', /inputs_json/);
    await refuse((f) => (f.calculations[0].inputs_json = '[1]'), 'invalid_row');
    await refuse((f) => (f.calculations[0].result_json = '"text"'), 'invalid_row');
    await refuse((f) => (f.calculations[0].result_json = JSON.stringify({ ...JSON.parse(f.calculations[0].result_json), kind: 'loop' })), 'invalid_row', /another calculator/);
    await refuse((f) => (f.calculations[0].result_json = JSON.stringify({ ...JSON.parse(f.calculations[0].result_json), steps: [{ key: 5 }] })), 'invalid_row', /steps/);
    await refuse((f) => (f.calculations[0].result_json = JSON.stringify({ ...JSON.parse(f.calculations[0].result_json), errors: [{ code: 'x' }] })), 'invalid_row');
    await refuse((f) => (f.calculations[0].result_json = JSON.stringify({ ...JSON.parse(f.calculations[0].result_json), values: { a: { value: 'NaN', unit: '' } } })), 'invalid_row');
    await refuse((f) => (f.calculations[0].result_json = 'x'.repeat(5 * 1024 * 1024)), 'invalid_row', /too large/);
  });

  it('references and consistency: dangling ids, duplicates, a circuit of another project, bad tables', async () => {
    await refuse((f) => (f.circuits[0].project_id = 99), 'broken_reference');
    await refuse((f) => (f.calculations[0].circuit_id = 99), 'broken_reference');
    await refuse((f) => (f.calculations[0].project_id = 99), 'broken_reference');
    await refuse((f) => (f.cableTableRows[0].table_id = 99), 'broken_reference');
    await refuse((f) => f.projects.push(clone(f.projects[0])), 'duplicate_row');
    await refuse((f) => f.cableTableRows.push(clone(f.cableTableRows[0])), 'duplicate_row');
    await refuse((f) => {
      f.projects.push({ ...clone(f.projects[0]), id: 2, name: 'Zwei' });
      f.calculations.find((c: any) => c.circuit_id !== null).project_id = 2;
    }, 'inconsistent', /another project/);
    await refuse((f) => {
      const c = f.calculations.find((x: any) => x.project_id === null);
      c.circuit_id = f.circuits[0].id; // a circuit without a project
    }, 'inconsistent');
    await refuse((f) => (f.cableTableRows[0].iz_a = 99), 'inconsistent', /rows are not valid/); // Iz no longer increases
    await refuse((f) => (f.cableTables[0].reference_ambient_c = 80), 'inconsistent', /θmax/);
  });

  it('settings: unknown key, wrong type, invalid values, a logo that is not an image', async () => {
    await refuse((f) => (f.settings.evil = 'x'), 'invalid_row', /not a known setting/);
    await refuse((f) => (f.settings.cmin = 1), 'invalid_row');
    await refuse((f) => (f.settings.cmin = '7'), 'invalid_row');
    await refuse((f) => (f.settings.paper = 'A3'), 'invalid_row');
    await refuse((f) => (f.settings.logoDataUri = 'data:text/html;base64,PHNjcmlwdD4='), 'invalid_row');
    await refuse((f) => (f.settings.logoDataUri = 'data:image/png;base64,"><script>alert(1)</script>'), 'invalid_row');
  });
});

describe('restore is atomic (A6)', () => {
  it('a failure in the middle of writing rolls everything back', async () => {
    const source = await populated();
    const file = await exportBackup(source);
    const target = await freshDb();
    await loadSeed(target, 'e1', 5);
    const before = await snapshotOf(target);
    // Passes validation by construction here, but the database refuses it half-way: tables are written in order, and
    // the third table (calculations) holds a kind the CHECK constraint rejects after projects/circuits were inserted.
    const broken = clone(file);
    broken.calculations[1].kind = 'bogus';
    await expect(restoreBackup(target, broken)).rejects.toThrow();
    expect(await snapshotOf(target)).toEqual(before);
    // and the connection is not left inside a transaction
    await expect(createProject(target, { name: 'still works' })).resolves.toBeGreaterThan(0);
  });

  it('a foreign-key problem that slipped through validation is caught at the end and rolled back', async () => {
    const target = await populated();
    const before = await snapshotOf(target);
    const file = await exportBackup(await populated());
    const broken = clone(file);
    broken.cableTableRows[0].table_id = 999;
    await expect(restoreBackup(target, broken)).rejects.toThrow(/dangling|FOREIGN/i);
    expect(await snapshotOf(target)).toEqual(before);
  });

  it('refuses a backup object of another app', async () => {
    const target = await freshDb();
    await expect(restoreBackup(target, { ...(await exportBackup(target)), app: 'x' as never })).rejects.toThrow();
  });

  it('writes made while a restore runs are not lost or half-applied (queue)', async () => {
    const source = await populated();
    const text = serializeBackup(await exportBackup(source));
    const target = await freshDb();
    const restore = restoreFromText(target, text);
    const concurrent = createProject(target, { name: 'during restore' });
    await Promise.all([restore, concurrent]);
    const names = (await target.getAllAsync<{ name: string }>('SELECT name FROM projects ORDER BY id')).map((r) => r.name);
    expect(names).toEqual(['Müller, Küche', 'during restore']); // restore first (queue order), then the new project
  });
});

describe('restore size and time limits (D57, review #5–#7)', () => {
  const tableFile = (rowsPerTable: number, tables = 1) =>
    JSON.stringify({
      app: BACKUP_APP,
      backupVersion: 1,
      schemaVersion: 2,
      exportedAt: '2026-10-01T00:00:00Z',
      engineVersion: '1.0.0',
      settings: {},
      projects: [],
      circuits: [],
      calculations: [],
      cableTables: Array.from({ length: tables }, (_, t) => ({ id: t + 1, name: 'x', source_note: 'y', material: 'cu', insulation_max_c: 70, reference_ambient_c: 30, method_label: '', loaded_conductors: null, created_at: 1, updated_at: 1 })),
      cableTableRows: Array.from({ length: tables * rowsPerTable }, (_, i) => ({ table_id: Math.floor(i / rowsPerTable) + 1, size_mm2: ((i % rowsPerTable) + 1) / 40, iz_a: 1 + (i % rowsPerTable) / 10 })),
    });

  it('the reviewer\'s hostile file (64 000 rows in one table, 2.9 MB) is refused in well under 1 s', () => {
    const file = tableFile(64_000);
    expect(file.length).toBeGreaterThan(2_500_000);
    const t = Date.now();
    expect(parseBackup(file)).toMatchObject({ ok: false, error: { code: 'too_many_rows' } });
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('100 000+ rows are refused before any per-row work, in well under 1 s', () => {
    const file = tableFile(1, 100_001);
    const t = Date.now();
    expect(parseBackup(file)).toMatchObject({ ok: false, error: { code: 'too_many_rows' } });
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('validation is linear: 1 000 full tables (100 000 rows) validate in well under 1 s', () => {
    const file = tableFile(100, 1_000);
    const t = Date.now();
    const r = parseBackup(file);
    expect(r.ok ? 'ok' : r.error).toBe('ok');
    expect(Date.now() - t).toBeLessThan(1000);
  });

  it('file-size check before reading, and the export warning use the same 100 MiB constant', () => {
    expect(backupFileSizeProblem(MAX_BACKUP_BYTES)).toBeNull();
    expect(backupFileSizeProblem(MAX_BACKUP_BYTES + 1)).toMatchObject({ code: 'too_large' });
    expect(backupFileSizeProblem(2 * 1024 ** 3)).toMatchObject({ code: 'too_large' });
    expect(backupFileSizeProblem(Number.NaN)).toMatchObject({ code: 'too_large' });
    expect(utf8Length('aä€😀')).toBe(1 + 2 + 3 + 4);
    expect(backupExceedsRestoreLimit('{}')).toBe(false);
  });
});

describe('restore summary flags a newer engine (review #18, D65)', () => {
  it('counts calculations made by a newer engine and still restores them', async () => {
    const db = await populated();
    const file = JSON.parse(serializeBackup(await exportBackup(db))) as BackupFile;
    (file.calculations[0] as Record<string, unknown>).engine_version = '9.0.0';
    // a file of a future app carries a valid checksum for its row (a hand edit would not: see the F7 tests)
    file.checksums!.calculations[String(file.calculations[0].id)] = calculationChecksum(file.calculations[0]);
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok && parsed.summary.newerEngine).toBe(1);
    const same = parseBackup(serializeBackup(await exportBackup(db)));
    expect(same.ok && same.summary.newerEngine).toBe(0);
    expect(isNewerVersion('1.10.0', '1.9.2')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('0.9', '1.0.0')).toBe(false);
  });
});

describe('dataCounts (Backup screen)', () => {
  it('counts saved calculations and history entries apart', async () => {
    const db = createTestDb();
    await migrate(db);
    expect(await dataCounts(db)).toEqual({ projects: 0, circuits: 0, calculations: 0, history: 0, tables: 0, photos: 0 });
    await loadSeed(db, 'e1');
    expect(await dataCounts(db)).toEqual({ projects: 1, circuits: 1, calculations: 3, history: 0, tables: 0, photos: 0 });
  });
});

describe('v1.1 F7: a restore refuses edited frozen results (REVIEW_V1 #7, probe D1)', () => {
  const e1Row = (f: BackupFile) => f.calculations.find((c) => c.kind === 'vdrop' && c.project_id !== null)! as Record<string, any>;
  const forge = (row: Record<string, any>) => {
    const r = JSON.parse(row.result_json);
    r.values.deltaUPercent.value = 1.23;
    r.checks[0].met = true;
    r.checks[0].key = 'check.vdrop.within';
    r.texts.verdict = 'within';
    row.result_json = JSON.stringify(r);
  };
  it('every exported calculation carries a checksum; the file restores unchanged', async () => {
    const f = await exportBackup(await populated());
    expect(f.checksums?.algorithm).toBe('cyrb64-1');
    expect(Object.keys(f.checksums!.calculations)).toHaveLength(f.calculations.length);
    const parsed = parseBackup(serializeBackup(f));
    expect(parsed.ok && parsed.summary.unverified).toBe(0);
  });
  it('a result edited by hand is refused by the checksum, and nothing is written', async () => {
    const f = clone(await exportBackup(await populated()));
    forge(e1Row(f));
    const target = await populated();
    const before = await snapshotOf(target);
    const out = await restoreFromText(target, JSON.stringify(f));
    expect(out).toMatchObject({ ok: false, error: { code: 'edited', detail: expect.stringMatching(/checksum does not match/) } });
    expect(await snapshotOf(target)).toEqual(before);
  });
  it('a forger who also recomputes the checksum is refused by the recompute (probe D1: E1 "1.23 % within")', async () => {
    const f = clone(await exportBackup(await populated()));
    const row = e1Row(f);
    forge(row);
    f.checksums!.calculations[String(row.id)] = calculationChecksum(row as never);
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false, error: { code: 'edited', detail: expect.stringMatching(/does not match its inputs/) } });
    // an edited input with the old result is refused the same way
    const g = clone(await exportBackup(await populated()));
    const r2 = e1Row(g);
    r2.inputs_json = r2.inputs_json.replace('"current":16', '"current":10');
    g.checksums!.calculations[String(r2.id)] = calculationChecksum(r2 as never);
    expect(parseBackup(JSON.stringify(g))).toMatchObject({ ok: false, error: { code: 'edited' } });
  });
  it('a version 1 file (v1.0, no checksums, engine 1.0.0) restores; its 1.0.0 results are recomputed, a forged one is refused', async () => {
    const f = asVersion1(clone(await exportBackup(await populated())));
    for (const c of f.calculations as Record<string, any>[]) {
      c.engine_version = '1.0.0';
      const r = JSON.parse(c.result_json);
      r.engineVersion = '1.0.0';
      r.assumptions = r.assumptions.filter((a: { key: string }) => !['assume.vdrop.minSize.scope', 'assume.coord.suggestionScope'].includes(a.key));
      r.checks = r.checks.filter((x: { id: string }) => x.id !== 'loop.ik');
      c.result_json = JSON.stringify(r);
    }
    const ok = parseBackup(JSON.stringify(f));
    expect(ok.ok && ok.summary.unverified).toBe(0);
    forge(e1Row(f));
    expect(parseBackup(JSON.stringify(f))).toMatchObject({ ok: false, error: { code: 'edited' } });
  });
  it('a version 1 file with a record of an engine this app cannot recompute restores, counted as unverified', async () => {
    const f = asVersion1(clone(await exportBackup(await populated())));
    (e1Row(f) as Record<string, unknown>).engine_version = '0.9.0';
    const parsed = parseBackup(JSON.stringify(f));
    expect(parsed.ok && parsed.summary.unverified).toBe(1);
  });
  it('version 2 without checksums, or a version 1 file with them, is refused as damaged', async () => {
    const f = clone(await exportBackup(await populated()));
    const noSums = { ...f, checksums: undefined };
    expect(parseBackup(JSON.stringify(noSums))).toMatchObject({ ok: false, error: { code: 'invalid_structure' } });
    expect(parseBackup(JSON.stringify({ ...f, backupVersion: 1, schemaVersion: 2, photos: undefined, photoData: undefined }))).toMatchObject({ ok: false, error: { code: 'invalid_structure' } });
    const missing = clone(f);
    delete missing.checksums!.calculations[String(missing.calculations[0].id)];
    expect(parseBackup(JSON.stringify(missing))).toMatchObject({ ok: false, error: { code: 'edited', detail: expect.stringMatching(/no checksum/) } });
  });
});

describe('v1.1 F13: the Release-flow backup fixtures (test/gen/release-backup.gen.ts)', () => {
  it('release-backup.json restores (format 2, all checked); the forged copy is refused as edited', () => {
    const dir = join(__dirname, '../../test/fixtures/files');
    const good = parseBackup(readFileSync(join(dir, 'release-backup.json'), 'utf8'));
    expect(good.ok && good.summary).toMatchObject({ backupVersion: 2, unverified: 0, counts: { projects: 1, circuits: 1, calculations: 3, cableTables: 1 } });
    expect(parseBackup(readFileSync(join(dir, 'release-backup-edited.json'), 'utf8'))).toMatchObject({ ok: false, error: { code: 'edited' } });
  });
});
