/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { LATEST_VERSION, migrate, MIGRATIONS_FOR_TEST } from './migrations';
import { getLanguagePreference, getThemePreference, setLanguagePreference, setThemePreference } from './settings';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

describe('migrations', () => {
  it('reaches the latest version and is safe to run again', async () => {
    const db = await freshDb();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(LATEST_VERSION);
  });
});

describe('theme preference', () => {
  it('defaults to system, persists changes, and ignores invalid stored values', async () => {
    const db = await freshDb();
    expect(await getThemePreference(db)).toBe('system');

    await setThemePreference(db, 'dark');
    expect(await getThemePreference(db)).toBe('dark');

    await db.runAsync("UPDATE settings SET value = 'purple' WHERE key = 'theme'");
    expect(await getThemePreference(db)).toBe('system');
  });
});

describe('language preference', () => {
  it('defaults to the device language, persists changes, and ignores invalid stored values', async () => {
    const db = await freshDb();
    expect(await getLanguagePreference(db)).toBe('system');

    await setLanguagePreference(db, 'de');
    expect(await getLanguagePreference(db)).toBe('de');

    await db.runAsync("UPDATE settings SET value = 'fr' WHERE key = 'language'");
    expect(await getLanguagePreference(db)).toBe('system');
  });
});

describe('migration 2 (SPEC §6)', () => {
  const tableNames = async (db: Awaited<ReturnType<typeof freshDb>>) =>
    (await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")).map((r) => r.name);

  it('creates the product tables and drops the template demo table', async () => {
    const db = await freshDb();
    expect(await tableNames(db)).toEqual(['cable_table_rows', 'cable_tables', 'calculations', 'circuits', 'photos', 'projects', 'settings']);
    expect(LATEST_VERSION).toBe(3); // migration 3 = photos (V1.5 A, D99)
  });

  it('upgrades a version-1 database that already holds settings and keeps them', async () => {
    const db = createTestDb();
    await migrate(db, ["CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);"]);
    await db.runAsync("INSERT INTO settings (key, value) VALUES ('theme', 'dark')");
    await migrate(db); // user_version is 1 now, so only migration 2 runs
    expect(await getThemePreference(db)).toBe('dark');
    expect(await tableNames(db)).toContain('calculations');
  });

  it('enforces foreign keys: cascade project → circuits → calculations, no orphans, circuit needs a project', async () => {
    const db = await freshDb();
    const fk = await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(fk?.foreign_keys).toBe(1);
    await db.runAsync("INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'P', 0, 0)");
    await db.runAsync("INSERT INTO circuits (id, project_id, label, created_at, updated_at) VALUES (1, 1, 'C', 0, 0)");
    const calc = `INSERT INTO calculations (project_id, circuit_id, kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at)
                  VALUES (?, ?, 'vdrop', '{}', '{}', '1', 'eu-de', '1', 0, 0)`;
    await db.runAsync(calc, 1, 1);
    await expect(db.runAsync("INSERT INTO circuits (project_id, label, created_at, updated_at) VALUES (99, 'x', 0, 0)")).rejects.toThrow();
    await expect(db.runAsync(calc, null, 1)).rejects.toThrow(); // CHECK: a circuit needs a project
    await expect(db.runAsync("INSERT INTO calculations (kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at) VALUES ('bogus','{}','{}','1','eu-de','1',0,0)")).rejects.toThrow();
    await db.runAsync('DELETE FROM projects WHERE id = 1');
    for (const t of ['circuits', 'calculations']) {
      expect((await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`))?.n).toBe(0);
    }
  });

  it('cable tables: material check, Iz > 0, one row per size, rows cascade with the table', async () => {
    const db = await freshDb();
    const table = (material: string) =>
      db.runAsync(`INSERT INTO cable_tables (id, name, source_note, material, insulation_max_c, reference_ambient_c, created_at, updated_at) VALUES (1, 'T', 'n', ?, 70, 30, 0, 0)`, material);
    await expect(table('fe')).rejects.toThrow();
    await table('cu');
    await db.runAsync('INSERT INTO cable_table_rows VALUES (1, 1.5, 20)');
    await expect(db.runAsync('INSERT INTO cable_table_rows VALUES (1, 1.5, 21)')).rejects.toThrow();
    await expect(db.runAsync('INSERT INTO cable_table_rows VALUES (1, 2.5, 0)')).rejects.toThrow();
    await db.runAsync('DELETE FROM cable_tables');
    expect((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM cable_table_rows'))?.n).toBe(0);
  });

  it('refuses to rewrite a saved calculation (D20) but allows title and note', async () => {
    const db = await freshDb();
    await db.runAsync("INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'P', 0, 0)");
    await db.runAsync(`INSERT INTO calculations (id, project_id, kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at)
                       VALUES (1, 1, 'vdrop', '{"a":1}', '{"b":2}', '1.0.0', 'eu-de', '1', 0, 0)`);
    for (const col of ['inputs_json', 'result_json', 'engine_version', 'profile_version']) {
      await expect(db.runAsync(`UPDATE calculations SET ${col} = 'x' WHERE id = 1`)).rejects.toThrow('saved_calculation_frozen');
    }
    await db.runAsync("UPDATE calculations SET title = 'T', note = 'N' WHERE id = 1");
    const row = await db.getFirstAsync<{ inputs_json: string; title: string }>('SELECT inputs_json, title FROM calculations WHERE id = 1');
    expect(row).toEqual({ inputs_json: '{"a":1}', title: 'T' });
  });

  it('D56 (review #4): no status flip, no REPLACE, no saved-time edit, no promotion, no circuit/project mismatch', async () => {
    const db = await freshDb();
    const one = async () => (await db.getFirstAsync<{ result_json: string; project_id: number | null; created_at: number }>('SELECT result_json, project_id, created_at FROM calculations WHERE id = 1'))!;
    await db.runAsync("INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'A', 0, 0), (2, 'B', 0, 0)");
    await db.runAsync("INSERT INTO circuits (id, project_id, label, created_at, updated_at) VALUES (1, 1, 'F1', 0, 0), (2, 2, 'F2', 0, 0)");
    await db.runAsync(`INSERT INTO calculations (id, project_id, circuit_id, kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at)
                       VALUES (1, 1, 1, 'vdrop', '{"a":1}', '{"b":2}', '1.0.0', 'eu-de', '1', 5, 5)`);
    const frozen = 'saved_calculation_frozen';
    // status flip: project_id NULL, then rewrite, then back
    await expect(db.runAsync('UPDATE calculations SET project_id = NULL, circuit_id = NULL WHERE id = 1')).rejects.toThrow(frozen);
    // INSERT OR REPLACE with the same id
    await expect(
      db.runAsync(`INSERT OR REPLACE INTO calculations (id, project_id, circuit_id, kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at)
                   VALUES (1, 1, NULL, 'vdrop', '{}', '{"forged":2}', '1.0.0', 'eu-de', '1', 5, 5)`)
    ).rejects.toThrow(frozen);
    await expect(db.runAsync('UPDATE calculations SET created_at = 0 WHERE id = 1')).rejects.toThrow(frozen);
    await expect(db.runAsync('UPDATE calculations SET id = 9 WHERE id = 1')).rejects.toThrow(frozen);
    await expect(db.runAsync("UPDATE calculations SET kind = 'loop' WHERE id = 1")).rejects.toThrow(frozen);
    await expect(db.runAsync("UPDATE calculations SET profile_id = 'x' WHERE id = 1")).rejects.toThrow(frozen);
    expect(await one()).toEqual({ result_json: '{"b":2}', project_id: 1, created_at: 5 });
    // circuit / project consistency
    await expect(db.runAsync('UPDATE circuits SET project_id = 2 WHERE id = 1')).rejects.toThrow('circuit_project_fixed');
    await expect(db.runAsync('UPDATE calculations SET circuit_id = 2 WHERE id = 1')).rejects.toThrow('calculation_circuit_project');
    await expect(db.runAsync('UPDATE calculations SET project_id = 2 WHERE id = 1')).rejects.toThrow('calculation_circuit_project');
    await expect(
      db.runAsync(`INSERT INTO calculations (project_id, circuit_id, kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at)
                   VALUES (1, 2, 'vdrop', '{}', '{}', '1.0.0', 'eu-de', '1', 0, 0)`)
    ).rejects.toThrow('calculation_circuit_project');
    // still allowed: title/note, moving to the other project's circuit in one statement, to project level, deleting
    await db.runAsync("UPDATE calculations SET title = 'T', note = 'N', updated_at = 9 WHERE id = 1");
    await db.runAsync('UPDATE calculations SET project_id = 2, circuit_id = 2 WHERE id = 1');
    await db.runAsync('UPDATE calculations SET circuit_id = NULL WHERE id = 1');
    expect(await one()).toEqual({ result_json: '{"b":2}', project_id: 2, created_at: 5 });
    // a history row is never promoted in place (saving inserts a new row); history rows stay editable
    await db.runAsync(`INSERT INTO calculations (id, project_id, kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at)
                       VALUES (2, NULL, 'vdrop', '{}', '{}', '1.0.0', 'eu-de', '1', 0, 0)`);
    await db.runAsync("UPDATE calculations SET result_json = '{\"c\":3}', created_at = 7 WHERE id = 2");
    await expect(db.runAsync('UPDATE calculations SET project_id = 1 WHERE id = 2')).rejects.toThrow(frozen);
    await db.runAsync('DELETE FROM calculations WHERE id = 1');
    await db.runAsync('DELETE FROM projects WHERE id = 2');
  });
});

describe('migration 3: photos (V1.5 phase A, D99)', () => {
  type T = Awaited<ReturnType<typeof freshDb>>;
  const count = async (db: T, sql = 'SELECT COUNT(*) AS n FROM photos') => (await db.getFirstAsync<{ n: number }>(sql))?.n;
  const photo = (db: T, type: string, id: number, path: string) =>
    db.runAsync('INSERT INTO photos (owner_type, owner_id, file_path, width, height, bytes, created_at, updated_at) VALUES (?, ?, ?, 640, 480, 1000, 0, 0)', type, id, path);
  async function seeded() {
    const db = await freshDb();
    await db.runAsync("INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'P', 0, 0), (2, 'Q', 0, 0)");
    await db.runAsync("INSERT INTO circuits (id, project_id, label, created_at, updated_at) VALUES (1, 1, 'F1', 0, 0)");
    await db.runAsync(`INSERT INTO calculations (id, project_id, circuit_id, kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at)
                       VALUES (1, 1, 1, 'vdrop', '{"a":1}', '{"b":2}', '1.1.0', 'eu-de', '1', 5, 5), (2, NULL, NULL, 'vdrop', '{}', '{}', '1.1.0', 'eu-de', '1', 6, 6)`);
    return db;
  }

  it('upgrades a version-2 database with data: rows kept, photos table empty, triggers of migration 2 untouched', async () => {
    const db = createTestDb();
    await migrate(db, MIGRATIONS_FOR_TEST.slice(0, 2));
    await db.runAsync("INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'Alt', 0, 0)");
    await migrate(db);
    expect((await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(3);
    expect(await count(db, 'SELECT COUNT(*) AS n FROM projects')).toBe(1);
    expect(await count(db)).toBe(0);
    const triggers = (await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")).map((t) => t.name);
    expect(triggers).toEqual(expect.arrayContaining(['calculations_frozen', 'calculations_no_promote', 'calculations_no_replace', 'photos_owner_insert', 'photos_owner_fixed', 'calculations_photos_cleanup']));
  });

  it('an owner must exist and be of a known type; a history entry takes no photo', async () => {
    const db = await seeded();
    await photo(db, 'project', 1, 'photos/a.jpg');
    await photo(db, 'circuit', 1, 'photos/b.jpg');
    await photo(db, 'calculation', 1, 'photos/c.jpg');
    await expect(photo(db, 'project', 99, 'photos/x.jpg')).rejects.toThrow('photo_owner_missing');
    await expect(photo(db, 'circuit', 99, 'photos/x.jpg')).rejects.toThrow('photo_owner_missing');
    await expect(photo(db, 'calculation', 99, 'photos/x.jpg')).rejects.toThrow('photo_owner_missing');
    await expect(photo(db, 'calculation', 2, 'photos/x.jpg')).rejects.toThrow('photo_owner_history');
    await expect(photo(db, 'invoice', 1, 'photos/x.jpg')).rejects.toThrow('photo_owner_type');
    await expect(db.runAsync("UPDATE photos SET owner_id = 2 WHERE file_path = 'photos/a.jpg'")).rejects.toThrow('photo_owner_fixed');
    await expect(db.runAsync("UPDATE photos SET owner_type = 'circuit' WHERE file_path = 'photos/a.jpg'")).rejects.toThrow('photo_owner_fixed');
    expect(await count(db)).toBe(3);
  });

  it('checks: unique relative path without "..", sizes and caption length', async () => {
    const db = await seeded();
    await photo(db, 'project', 1, 'photos/a.jpg');
    await expect(photo(db, 'project', 1, 'photos/a.jpg')).rejects.toThrow(/UNIQUE/);
    await expect(photo(db, 'project', 1, '/var/mobile/photos/b.jpg')).rejects.toThrow(/CHECK/);
    await expect(photo(db, 'project', 1, 'photos/../../b.jpg')).rejects.toThrow(/CHECK/);
    const bad = (col: string, v: number | string) => {
      const row: Record<string, number | string> = { owner_type: 'project', owner_id: 1, file_path: 'photos/z.jpg', width: 1, height: 1, bytes: 1, created_at: 0, updated_at: 0, [col]: v };
      return db.runAsync(`INSERT INTO photos (${Object.keys(row).join(', ')}) VALUES (${Object.keys(row).map(() => '?').join(', ')})`, ...Object.values(row));
    };
    await bad('width', 1); // the row itself is fine
    await db.runAsync("DELETE FROM photos WHERE file_path = 'photos/z.jpg'");
    await expect(bad('width', 0)).rejects.toThrow(/CHECK/);
    await expect(bad('height', 20001)).rejects.toThrow(/CHECK/);
    await expect(bad('bytes', 0)).rejects.toThrow(/CHECK/);
    await expect(bad('caption', 'x'.repeat(501))).rejects.toThrow(/CHECK/);
  });

  it('deleting an owner deletes its photo rows, also through the project → circuit → calculation cascade', async () => {
    const db = await seeded();
    await photo(db, 'project', 2, 'photos/q.jpg');
    await photo(db, 'project', 1, 'photos/p.jpg');
    await photo(db, 'circuit', 1, 'photos/ci.jpg');
    await photo(db, 'calculation', 1, 'photos/ca.jpg');
    await db.runAsync('DELETE FROM calculations WHERE id = 1');
    expect(await count(db)).toBe(3);
    await db.runAsync('DELETE FROM projects WHERE id = 1'); // cascades to circuit 1
    const left = (await db.getAllAsync<{ file_path: string }>('SELECT file_path FROM photos')).map((r) => r.file_path);
    expect(left).toEqual(['photos/q.jpg']);
  });

  it('D20: adding, captioning and deleting photos of a saved calculation never changes the calculation row', async () => {
    const db = await seeded();
    const before = await db.getFirstAsync('SELECT * FROM calculations WHERE id = 1');
    await photo(db, 'calculation', 1, 'photos/c.jpg');
    await db.runAsync("UPDATE photos SET caption = 'Verteiler' WHERE file_path = 'photos/c.jpg'");
    await db.runAsync("DELETE FROM photos WHERE file_path = 'photos/c.jpg'");
    expect(await db.getFirstAsync('SELECT * FROM calculations WHERE id = 1')).toEqual(before);
    await expect(db.runAsync("UPDATE calculations SET result_json = '{}' WHERE id = 1")).rejects.toThrow('saved_calculation_frozen');
  });
});
