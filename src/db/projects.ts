// Projects and circuits (SPEC §6, §9). Writes run as one unit through the queue, reads through withRead (template
// rule); inside a unit only the handle the callback receives is used.
import { withRead, withTransaction } from './tx';
import type { Db } from './types';
import { cleanText, DataError, flag } from './util';

export type Project = {
  id: number;
  name: string;
  client: string;
  site: string;
  notes: string;
  profileId: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};
export type ProjectListItem = Project & { circuitCount: number; calculationCount: number };
export type ProjectFields = { name: string; client?: string; site?: string; notes?: string };

export type Circuit = {
  id: number;
  projectId: number;
  label: string;
  notes: string;
  sort: number;
  createdAt: number;
  updatedAt: number;
};
export type CircuitListItem = Circuit & { calculationCount: number };

type ProjectRow = {
  id: number;
  name: string;
  client: string;
  site: string;
  notes: string;
  profile_id: string;
  archived: number;
  created_at: number;
  updated_at: number;
};
type CircuitRow = { id: number; project_id: number; label: string; notes: string; sort: number; created_at: number; updated_at: number };

const toProject = (r: ProjectRow): Project => ({
  id: r.id,
  name: r.name,
  client: r.client,
  site: r.site,
  notes: r.notes,
  profileId: r.profile_id,
  archived: r.archived === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const toCircuit = (r: CircuitRow): Circuit => ({
  id: r.id,
  projectId: r.project_id,
  label: r.label,
  notes: r.notes,
  sort: r.sort,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

function projectFields(f: Partial<ProjectFields>, requireName: boolean) {
  return {
    name: f.name === undefined && !requireName ? undefined : cleanText('name', f.name, 200, true),
    client: f.client === undefined ? undefined : cleanText('client', f.client, 200, false),
    site: f.site === undefined ? undefined : cleanText('site', f.site, 200, false),
    notes: f.notes === undefined ? undefined : cleanText('notes', f.notes, 5000, false),
  };
}

// ---------------------------------------------------------------- projects

export async function createProject(db: Db, fields: ProjectFields, now = Date.now()): Promise<number> {
  const f = projectFields(fields, true);
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync(
      'INSERT INTO projects (name, client, site, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      f.name as string,
      f.client ?? '',
      f.site ?? '',
      f.notes ?? '',
      now,
      now
    );
    return r.lastInsertRowId;
  });
}

export async function getProject(db: Db, id: number): Promise<Project | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE id = ?', id));
  return row ? toProject(row) : null;
}

export type ProjectFilter = { search?: string; archived?: 'active' | 'archived' | 'all' };

/** Newest activity first; counts come from one query (the `many` seed, A13). */
export async function listProjects(db: Db, filter: ProjectFilter = {}): Promise<ProjectListItem[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const archived = filter.archived ?? 'active';
  if (archived !== 'all') {
    where.push('p.archived = ?');
    params.push(archived === 'archived' ? 1 : 0);
  }
  // Search is done in JS (review #14, D62): SQLite's LIKE folds case for ASCII only, so "ärzte" missed "Ärztehaus".
  const search = searchFold(filter.search?.trim() ?? '');
  const rows = await withRead(db, (r) =>
    r.getAllAsync<ProjectRow & { circuit_count: number; calculation_count: number }>(
      `SELECT p.*,
         (SELECT COUNT(*) FROM circuits c WHERE c.project_id = p.id) AS circuit_count,
         (SELECT COUNT(*) FROM calculations k WHERE k.project_id = p.id) AS calculation_count
       FROM projects p ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.updated_at DESC, p.id DESC`,
      ...params
    )
  );
  const hits = search === '' ? rows : rows.filter((r) => [r.name, r.client, r.site].some((t) => searchFold(t).includes(search)));
  return hits.map((r) => ({ ...toProject(r), circuitCount: r.circuit_count, calculationCount: r.calculation_count }));
}

/**
 * Text folded for search: Unicode-lower-cased (German rules), accents and umlauts removed (NFD), ß → ss — so "ärzte"
 * finds "Ärztehaus", "MÜLLER" finds "Müller" and "strasse" finds "Straße". Literal: `%` and `_` are plain characters.
 */
export function searchFold(text: string): string {
  const decomposed = typeof text.normalize === 'function' ? text.normalize('NFD') : text;
  return decomposed.replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('de').replace(/ß/g, 'ss');
}

export async function updateProject(db: Db, id: number, patch: Partial<ProjectFields>, now = Date.now()): Promise<void> {
  const f = projectFields(patch, false);
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync(
      `UPDATE projects SET name = COALESCE(?, name), client = COALESCE(?, client), site = COALESCE(?, site),
         notes = COALESCE(?, notes), updated_at = ? WHERE id = ?`,
      f.name ?? null,
      f.client ?? null,
      f.site ?? null,
      f.notes ?? null,
      now,
      id
    );
    if (r.changes === 0) throw new DataError('not_found', 'project', `no project ${id}`);
  });
}

export async function setProjectArchived(db: Db, id: number, archived: boolean, now = Date.now()): Promise<void> {
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync('UPDATE projects SET archived = ?, updated_at = ? WHERE id = ?', flag(archived), now, id);
    if (r.changes === 0) throw new DataError('not_found', 'project', `no project ${id}`);
  });
}

/** What deleting a project removes — shown in the confirm dialog (SPEC §13). */
export async function projectCounts(db: Db, id: number): Promise<{ circuits: number; calculations: number }> {
  const row = await withRead(db, (r) =>
    r.getFirstAsync<{ circuits: number; calculations: number }>(
      `SELECT (SELECT COUNT(*) FROM circuits WHERE project_id = ?) AS circuits,
              (SELECT COUNT(*) FROM calculations WHERE project_id = ?) AS calculations`,
      id,
      id
    )
  );
  return row ?? { circuits: 0, calculations: 0 };
}

/** Deletes the project; its circuits and saved calculations go with it (ON DELETE CASCADE). */
export async function deleteProject(db: Db, id: number): Promise<void> {
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync('DELETE FROM projects WHERE id = ?', id);
    if (r.changes === 0) throw new DataError('not_found', 'project', `no project ${id}`);
  });
}

/**
 * Copies a project with its circuits and saved calculations in one unit. Calculations are copied verbatim — still the
 * frozen snapshots of the original (D20), with their original creation time.
 */
export async function duplicateProject(db: Db, id: number, name?: string, now = Date.now()): Promise<number> {
  return withTransaction(db, async (tx) => {
    const src = await tx.getFirstAsync<ProjectRow>('SELECT * FROM projects WHERE id = ?', id);
    if (!src) throw new DataError('not_found', 'project', `no project ${id}`);
    const title = cleanText('name', name ?? `${src.name} (copy)`, 200, true);
    const created = await tx.runAsync(
      'INSERT INTO projects (name, client, site, notes, profile_id, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
      title,
      src.client,
      src.site,
      src.notes,
      src.profile_id,
      now,
      now
    );
    const newId = created.lastInsertRowId;
    const circuitMap = new Map<number, number>();
    for (const c of await tx.getAllAsync<CircuitRow>('SELECT * FROM circuits WHERE project_id = ? ORDER BY sort, id', id)) {
      const r = await tx.runAsync(
        'INSERT INTO circuits (project_id, label, notes, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        newId,
        c.label,
        c.notes,
        c.sort,
        now,
        now
      );
      circuitMap.set(c.id, r.lastInsertRowId);
    }
    await tx.runAsync(
      `INSERT INTO calculations (project_id, circuit_id, kind, title, note, inputs_json, result_json, engine_version, profile_id,
         profile_version, created_at, updated_at)
       SELECT ?, NULL, kind, title, note, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, ?
       FROM calculations WHERE project_id = ? AND circuit_id IS NULL ORDER BY created_at, id`,
      newId,
      now,
      id
    );
    for (const [oldCircuit, newCircuit] of circuitMap) {
      await tx.runAsync(
        `INSERT INTO calculations (project_id, circuit_id, kind, title, note, inputs_json, result_json, engine_version, profile_id,
           profile_version, created_at, updated_at)
         SELECT ?, ?, kind, title, note, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, ?
         FROM calculations WHERE circuit_id = ? ORDER BY created_at, id`,
        newId,
        newCircuit,
        now,
        oldCircuit
      );
    }
    return newId;
  });
}

// ---------------------------------------------------------------- circuits

export async function createCircuit(db: Db, projectId: number, fields: { label: string; notes?: string }, now = Date.now()): Promise<number> {
  const label = cleanText('label', fields.label, 200, true);
  const notes = fields.notes === undefined ? '' : cleanText('notes', fields.notes, 5000, false);
  return withTransaction(db, async (tx) => {
    const project = await tx.getFirstAsync('SELECT id FROM projects WHERE id = ?', projectId);
    if (!project) throw new DataError('not_found', 'project', `no project ${projectId}`);
    const next = await tx.getFirstAsync<{ n: number }>('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM circuits WHERE project_id = ?', projectId);
    const r = await tx.runAsync(
      'INSERT INTO circuits (project_id, label, notes, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      projectId,
      label,
      notes,
      next?.n ?? 0,
      now,
      now
    );
    await tx.runAsync('UPDATE projects SET updated_at = ? WHERE id = ?', now, projectId);
    return r.lastInsertRowId;
  });
}

export async function getCircuit(db: Db, id: number): Promise<Circuit | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<CircuitRow>('SELECT * FROM circuits WHERE id = ?', id));
  return row ? toCircuit(row) : null;
}

export async function listCircuits(db: Db, projectId: number): Promise<CircuitListItem[]> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<CircuitRow & { calculation_count: number }>(
      `SELECT c.*, (SELECT COUNT(*) FROM calculations k WHERE k.circuit_id = c.id) AS calculation_count
       FROM circuits c WHERE c.project_id = ? ORDER BY c.sort, c.id`,
      projectId
    )
  );
  return rows.map((r) => ({ ...toCircuit(r), calculationCount: r.calculation_count }));
}

export async function updateCircuit(db: Db, id: number, patch: { label?: string; notes?: string }, now = Date.now()): Promise<void> {
  const label = patch.label === undefined ? null : cleanText('label', patch.label, 200, true);
  const notes = patch.notes === undefined ? null : cleanText('notes', patch.notes, 5000, false);
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync('UPDATE circuits SET label = COALESCE(?, label), notes = COALESCE(?, notes), updated_at = ? WHERE id = ?', label, notes, now, id);
    if (r.changes === 0) throw new DataError('not_found', 'circuit', `no circuit ${id}`);
  });
}

/** Deletes the circuit and the saved calculations in it (ON DELETE CASCADE). */
export async function deleteCircuit(db: Db, id: number): Promise<void> {
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync('DELETE FROM circuits WHERE id = ?', id);
    if (r.changes === 0) throw new DataError('not_found', 'circuit', `no circuit ${id}`);
  });
}
