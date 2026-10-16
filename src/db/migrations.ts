import { withTransaction, withWrite } from './tx';
import type { Db } from './types';

// Append-only. Never edit a migration that has shipped; add a new one instead.
const MIGRATIONS: string[] = [
  `CREATE TABLE items (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL
   );
   CREATE TABLE settings (
     key TEXT PRIMARY KEY NOT NULL,
     value TEXT NOT NULL
   );`,
  // Migration 2 = SPEC §6 (D44). The template demo table is dropped (D33, nothing uses it). Indexes serve the project list,
  // the circuit lists and the capped history. The triggers enforce D20 in the database: a saved calculation (project_id
  // set) can never have its id, inputs, result, versions or saved time rewritten, cannot be turned back into a history
  // row (the project_id NULL round trip), and cannot be replaced (INSERT OR REPLACE); a history row is saved by
  // inserting a new row, never promoted in place; a calculation's circuit always belongs to its project, and a circuit
  // never moves to another project. Title, note and placement (project/circuit) stay editable. Amended in P4.5 (D56)
  // before it ran on any device or install.
  `DROP TABLE IF EXISTS items;
   CREATE TABLE projects (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, client TEXT NOT NULL DEFAULT '',
     site TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', profile_id TEXT NOT NULL DEFAULT 'eu-de',
     archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE TABLE circuits (
     id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
     label TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE TABLE calculations (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
     circuit_id INTEGER REFERENCES circuits(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('vdrop','current','ohm','coord','loop','resistance','convert')),
     title TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
     inputs_json TEXT NOT NULL, result_json TEXT NOT NULL,
     engine_version TEXT NOT NULL, profile_id TEXT NOT NULL, profile_version TEXT NOT NULL,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
     CHECK (circuit_id IS NULL OR project_id IS NOT NULL)
   );
   CREATE TABLE cable_tables (
     id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, source_note TEXT NOT NULL,
     material TEXT NOT NULL CHECK (material IN ('cu','al')),
     insulation_max_c REAL NOT NULL, reference_ambient_c REAL NOT NULL,
     method_label TEXT NOT NULL DEFAULT '', loaded_conductors INTEGER,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE TABLE cable_table_rows (
     table_id INTEGER NOT NULL REFERENCES cable_tables(id) ON DELETE CASCADE,
     size_mm2 REAL NOT NULL, iz_a REAL NOT NULL CHECK (iz_a > 0),
     PRIMARY KEY (table_id, size_mm2)
   );
   CREATE INDEX circuits_project ON circuits (project_id, sort, id);
   CREATE INDEX calculations_project ON calculations (project_id, circuit_id, created_at);
   CREATE INDEX calculations_circuit ON calculations (circuit_id);
   CREATE INDEX calculations_history ON calculations (id) WHERE project_id IS NULL;
   CREATE TRIGGER calculations_frozen BEFORE UPDATE ON calculations
   WHEN OLD.project_id IS NOT NULL AND (NEW.project_id IS NULL OR NEW.id IS NOT OLD.id OR NEW.kind IS NOT OLD.kind
     OR NEW.inputs_json IS NOT OLD.inputs_json OR NEW.result_json IS NOT OLD.result_json
     OR NEW.engine_version IS NOT OLD.engine_version OR NEW.profile_id IS NOT OLD.profile_id
     OR NEW.profile_version IS NOT OLD.profile_version OR NEW.created_at IS NOT OLD.created_at)
   BEGIN SELECT RAISE(ABORT, 'saved_calculation_frozen'); END;
   CREATE TRIGGER calculations_no_promote BEFORE UPDATE OF project_id ON calculations
   WHEN OLD.project_id IS NULL AND NEW.project_id IS NOT NULL
   BEGIN SELECT RAISE(ABORT, 'saved_calculation_frozen'); END;
   CREATE TRIGGER calculations_no_replace BEFORE INSERT ON calculations
   WHEN NEW.id IS NOT NULL AND EXISTS (SELECT 1 FROM calculations WHERE id = NEW.id)
   BEGIN SELECT RAISE(ABORT, 'saved_calculation_frozen'); END;
   CREATE TRIGGER calculations_circuit_insert BEFORE INSERT ON calculations
   WHEN NEW.circuit_id IS NOT NULL AND (SELECT project_id FROM circuits WHERE id = NEW.circuit_id) IS NOT NEW.project_id
   BEGIN SELECT RAISE(ABORT, 'calculation_circuit_project'); END;
   CREATE TRIGGER calculations_circuit_update BEFORE UPDATE OF project_id, circuit_id ON calculations
   WHEN NEW.circuit_id IS NOT NULL AND (SELECT project_id FROM circuits WHERE id = NEW.circuit_id) IS NOT NEW.project_id
   BEGIN SELECT RAISE(ABORT, 'calculation_circuit_project'); END;
   CREATE TRIGGER circuits_fixed_project BEFORE UPDATE OF project_id ON circuits
   WHEN NEW.project_id IS NOT OLD.project_id
   BEGIN SELECT RAISE(ABORT, 'circuit_project_fixed'); END;`,
  // Migration 3 = photos (V1.5 phase A, NW1; D99). A photo belongs to one owner: a project, a circuit or a SAVED
  // calculation (owner_type + owner_id, as V15_PLAN says). The owner is checked by triggers, not a CHECK constraint, so a
  // later phase can add an owner type (a measurement record) by replacing the triggers instead of rebuilding the table;
  // deleting an owner (also through the project → circuit → calculation cascade: SQLite fires triggers on cascaded rows,
  // tested) deletes its photo rows. A history entry (project_id NULL) takes no photo: the history is trimmed. The photo
  // never touches the calculation row: frozen snapshots (D20) stay byte-identical. `file_path` is relative to the app's
  // document folder (the absolute iOS container path changes between installs). The files themselves are the app's job.
  `CREATE TABLE photos (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     owner_type TEXT NOT NULL,
     owner_id INTEGER NOT NULL,
     file_path TEXT NOT NULL UNIQUE CHECK (length(file_path) BETWEEN 1 AND 300 AND substr(file_path, 1, 1) <> '/' AND instr(file_path, '..') = 0),
     width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 20000),
     height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 20000),
     bytes INTEGER NOT NULL CHECK (bytes BETWEEN 1 AND 52428800),
     caption TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 500),
     sort INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
   );
   CREATE INDEX photos_owner ON photos (owner_type, owner_id, sort, id);
   CREATE TRIGGER photos_owner_insert BEFORE INSERT ON photos
   BEGIN
     SELECT RAISE(ABORT, 'photo_owner_type') WHERE NEW.owner_type NOT IN ('project', 'circuit', 'calculation');
     SELECT RAISE(ABORT, 'photo_owner_missing')
       WHERE (NEW.owner_type = 'project' AND NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.owner_id))
          OR (NEW.owner_type = 'circuit' AND NOT EXISTS (SELECT 1 FROM circuits WHERE id = NEW.owner_id))
          OR (NEW.owner_type = 'calculation' AND NOT EXISTS (SELECT 1 FROM calculations WHERE id = NEW.owner_id));
     SELECT RAISE(ABORT, 'photo_owner_history')
       WHERE NEW.owner_type = 'calculation' AND (SELECT project_id FROM calculations WHERE id = NEW.owner_id) IS NULL;
   END;
   CREATE TRIGGER photos_owner_fixed BEFORE UPDATE OF owner_type, owner_id ON photos
   WHEN NEW.owner_type IS NOT OLD.owner_type OR NEW.owner_id IS NOT OLD.owner_id
   BEGIN SELECT RAISE(ABORT, 'photo_owner_fixed'); END;
   CREATE TRIGGER projects_photos_cleanup AFTER DELETE ON projects
   BEGIN DELETE FROM photos WHERE owner_type = 'project' AND owner_id = OLD.id; END;
   CREATE TRIGGER circuits_photos_cleanup AFTER DELETE ON circuits
   BEGIN DELETE FROM photos WHERE owner_type = 'circuit' AND owner_id = OLD.id; END;
   CREATE TRIGGER calculations_photos_cleanup AFTER DELETE ON calculations
   BEGIN DELETE FROM photos WHERE owner_type = 'calculation' AND owner_id = OLD.id; END;`,
];

export const LATEST_VERSION = MIGRATIONS.length;
/** The migration texts, for upgrade tests only (an older database is built from a prefix). */
export const MIGRATIONS_FOR_TEST: readonly string[] = MIGRATIONS;

export async function migrate(db: Db, migrations: string[] = MIGRATIONS): Promise<void> {
  // Foreign keys are off by default in SQLite and the pragma cannot change inside a transaction (print-cost D38).
  await withWrite(db, (tx) => tx.execAsync('PRAGMA foreign_keys = ON;'));
  // The version is read INSIDE each unit: another JS handle on the same connection (a background task at a cold
  // start) may have migrated meanwhile, and a migration must never run twice (warranty-wallet D110). One transaction
  // per migration: a failure rolls back both the schema change and user_version.
  for (;;) {
    const applied = await withTransaction(db, async (tx) => {
      const row = await tx.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      const version = row?.user_version ?? 0;
      if (version >= migrations.length) return false;
      await tx.execAsync(`${migrations[version]} PRAGMA user_version = ${version + 1};`);
      return true;
    });
    if (!applied) return;
  }
}
