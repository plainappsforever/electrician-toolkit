// Saved calculations and the capped history (SPEC §6, D20). A saved calculation is a frozen snapshot: `inputs_json` and
// `result_json` are written once, verbatim, and the database refuses to change them (trigger calculations_frozen).
// History entries have project_id NULL; saving one to a project creates a new row. All writes are one unit in the
// serialised queue; reads go through withRead.
import { CALC_KINDS, compute, ENGINE_VERSION, EU_DE, type CalcInput, type CalcKind, type CalcResult } from '@/engine';
import { COMPARE_REL_TOL } from '@/engine/result';

import { getAppSettings } from './settings';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';
import { cleanText, DataError } from './util';

export type StoredCalculation = {
  id: number;
  projectId: number | null;
  circuitId: number | null;
  kind: CalcKind;
  title: string;
  note: string;
  /** The CalcInput exactly as saved; null when the stored text is not valid JSON (damaged file). */
  input: unknown;
  /** The CalcResult exactly as saved; null when the stored text is not valid JSON. */
  result: CalcResult | null;
  engineVersion: string;
  profileId: string;
  profileVersion: string;
  createdAt: number;
  updatedAt: number;
};

type Row = {
  id: number;
  project_id: number | null;
  circuit_id: number | null;
  kind: string;
  title: string;
  note: string;
  inputs_json: string;
  result_json: string;
  engine_version: string;
  profile_id: string;
  profile_version: string;
  created_at: number;
  updated_at: number;
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function toStored(r: Row): StoredCalculation {
  return {
    id: r.id,
    projectId: r.project_id,
    circuitId: r.circuit_id,
    kind: r.kind as CalcKind,
    title: r.title,
    note: r.note,
    input: parseJson(r.inputs_json),
    result: parseJson(r.result_json) as CalcResult | null,
    engineVersion: r.engine_version,
    profileId: r.profile_id,
    profileVersion: r.profile_version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export type CalculationDraft = { kind: CalcKind; input: unknown; result: CalcResult; title?: string; note?: string };

function checkDraft(d: CalculationDraft): void {
  if (!CALC_KINDS.includes(d.kind)) throw new DataError('invalid', 'kind', `unknown calculator ${String(d.kind)}`);
  if (!d.result || d.result.ok !== true || d.result.kind !== d.kind) {
    throw new DataError('not_saveable', 'result', 'only a valid result of the same calculator can be stored');
  }
}

/** Numbers equal within the D37 tolerance; everything else (keys, texts, flags, list lengths) exactly equal. */
export function sameResult(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a === b) return true;
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= COMPARE_REL_TOL * Math.max(Math.abs(a), Math.abs(b));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameResult(x, b[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && sameResult(ra[k], rb[k]));
}

/**
 * D54 (review finding 3): the data layer recomputes the result from the input itself and refuses a draft whose result
 * the engine does not reproduce (a stale result from a debounced screen, a result of another input). What is stored is
 * the fresh result and the input the engine used (D53), so a frozen record always belongs to its input.
 */
function verifiedSnapshot(d: CalculationDraft): { inputs: string; result: CalcResult; resultJson: string } {
  checkDraft(d);
  const fresh = compute(d.kind, d.input as CalcInput);
  if (!fresh.ok || !sameResult(fresh, d.result)) {
    throw new DataError('not_saveable', 'result', 'the result does not belong to this input (recomputed and compared)');
  }
  return { inputs: JSON.stringify(fresh.usedInput ?? d.input), result: fresh, resultJson: JSON.stringify(fresh) };
}

const COLUMNS =
  'project_id, circuit_id, kind, title, note, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at';

// ---------------------------------------------------------------- history

/**
 * Stores a computed-and-left calculation as a history entry and trims the history to `historyLimit` (default 100) in
 * the same unit. Order and trim go by id (AUTOINCREMENT, monotonic), never by the device clock: a clock set back must
 * not make the newest entry the "oldest" one (review #10, D63). A calculation identical to the newest entry (same calculator, same inputs) only refreshes that entry,
 * so editing back and forth does not fill the list. Invalid results are not stored (returns null).
 */
export async function recordHistory(db: Db, draft: CalculationDraft, now = Date.now()): Promise<number | null> {
  if (!draft.result || draft.result.ok !== true) return null;
  const { inputs, result, resultJson } = verifiedSnapshot(draft);
  const title = cleanText('title', draft.title ?? '', 200, false);
  return withTransaction(db, async (tx) => {
    const newest = await tx.getFirstAsync<{ id: number; kind: string; inputs_json: string }>(
      'SELECT id, kind, inputs_json FROM calculations WHERE project_id IS NULL ORDER BY id DESC LIMIT 1'
    );
    let id: number;
    if (newest && newest.kind === draft.kind && newest.inputs_json === inputs) {
      await tx.runAsync('UPDATE calculations SET created_at = ?, updated_at = ?, result_json = ? WHERE id = ?', now, now, resultJson, newest.id);
      id = newest.id;
    } else {
      const r = await tx.runAsync(
        `INSERT INTO calculations (${COLUMNS}) VALUES (NULL, NULL, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)`,
        draft.kind,
        title,
        inputs,
        resultJson,
        result.engineVersion,
        result.profileId,
        result.profileVersion,
        now,
        now
      );
      id = r.lastInsertRowId;
    }
    const { historyLimit } = await getAppSettings(tx);
    await tx.runAsync(
      `DELETE FROM calculations WHERE project_id IS NULL AND id NOT IN (
         SELECT id FROM calculations WHERE project_id IS NULL ORDER BY id DESC LIMIT ?)`,
      historyLimit
    );
    return id;
  });
}

/** Newest first (by id, D63); the Calculators tab shows the last 20. */
export async function listHistory(db: Db, limit = 20): Promise<StoredCalculation[]> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<Row>('SELECT * FROM calculations WHERE project_id IS NULL ORDER BY id DESC LIMIT ?', limit)
  );
  return rows.map(toStored);
}

// ---------------------------------------------------------------- saved calculations

async function assertPlacement(tx: Db, projectId: number, circuitId: number | null): Promise<void> {
  const project = await tx.getFirstAsync('SELECT id FROM projects WHERE id = ?', projectId);
  if (!project) throw new DataError('not_found', 'project', `no project ${projectId}`);
  if (circuitId !== null) {
    const circuit = await tx.getFirstAsync<{ project_id: number }>('SELECT project_id FROM circuits WHERE id = ?', circuitId);
    if (!circuit) throw new DataError('not_found', 'circuit', `no circuit ${circuitId}`);
    if (circuit.project_id !== projectId) throw new DataError('wrong_project', 'circuit', 'the circuit belongs to another project');
  }
}

/** Saves a calculation into a project (and optionally a circuit) as a frozen snapshot; returns its id. */
export async function saveCalculation(
  db: Db,
  target: { projectId: number; circuitId?: number | null },
  draft: CalculationDraft,
  now = Date.now()
): Promise<number> {
  const { inputs, result, resultJson } = verifiedSnapshot(draft);
  const title = cleanText('title', draft.title ?? '', 200, false);
  const note = cleanText('note', draft.note ?? '', 5000, false);
  const circuitId = target.circuitId ?? null;
  return withTransaction(db, async (tx) => {
    await assertPlacement(tx, target.projectId, circuitId);
    const r = await tx.runAsync(
      `INSERT INTO calculations (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      target.projectId,
      circuitId,
      draft.kind,
      title,
      note,
      inputs,
      resultJson,
      result.engineVersion,
      result.profileId,
      result.profileVersion,
      now,
      now
    );
    await tx.runAsync('UPDATE projects SET updated_at = ? WHERE id = ?', now, target.projectId);
    return r.lastInsertRowId;
  });
}

/** Copies a history entry (verbatim) into a project as a new saved calculation. */
export async function saveHistoryEntry(
  db: Db,
  historyId: number,
  target: { projectId: number; circuitId?: number | null },
  fields: { title?: string; note?: string } = {},
  now = Date.now()
): Promise<number> {
  const title = cleanText('title', fields.title ?? '', 200, false);
  const note = cleanText('note', fields.note ?? '', 5000, false);
  const circuitId = target.circuitId ?? null;
  return withTransaction(db, async (tx) => {
    const src = await tx.getFirstAsync<Row>('SELECT * FROM calculations WHERE id = ? AND project_id IS NULL', historyId);
    if (!src) throw new DataError('not_found', 'history', `no history entry ${historyId}`);
    // D54: an entry of this engine and profile must still be reproduced by its stored input; one from another engine
    // version (restored from an older backup) is copied as it was computed, like every frozen record of that version.
    if (src.engine_version === ENGINE_VERSION && src.profile_id === EU_DE.id && src.profile_version === EU_DE.version) {
      const input = parseJson(src.inputs_json);
      const stored = parseJson(src.result_json);
      const fresh = compute(src.kind as CalcKind, input as CalcInput);
      if (!fresh.ok || !sameResult(fresh, stored) || JSON.stringify(fresh.usedInput) !== src.inputs_json) {
        throw new DataError('not_saveable', 'result', 'the history entry is not reproduced by its input');
      }
    }
    await assertPlacement(tx, target.projectId, circuitId);
    const r = await tx.runAsync(
      `INSERT INTO calculations (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      target.projectId,
      circuitId,
      src.kind,
      title || src.title,
      note,
      src.inputs_json,
      src.result_json,
      src.engine_version,
      src.profile_id,
      src.profile_version,
      now,
      now
    );
    await tx.runAsync('UPDATE projects SET updated_at = ? WHERE id = ?', now, target.projectId);
    return r.lastInsertRowId;
  });
}

export async function getCalculation(db: Db, id: number): Promise<StoredCalculation | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<Row>('SELECT * FROM calculations WHERE id = ?', id));
  return row ? toStored(row) : null;
}

/**
 * Saved calculations of a project. `circuitId`: a number = that circuit, null = project level only, undefined = all of
 * the project. Oldest first (report order).
 */
export async function listCalculations(db: Db, projectId: number, circuitId?: number | null): Promise<StoredCalculation[]> {
  const rows = await withRead(db, (r) =>
    circuitId === undefined
      ? r.getAllAsync<Row>('SELECT * FROM calculations WHERE project_id = ? ORDER BY created_at, id', projectId)
      : circuitId === null
        ? r.getAllAsync<Row>('SELECT * FROM calculations WHERE project_id = ? AND circuit_id IS NULL ORDER BY created_at, id', projectId)
        : r.getAllAsync<Row>('SELECT * FROM calculations WHERE project_id = ? AND circuit_id = ? ORDER BY created_at, id', projectId, circuitId)
  );
  return rows.map(toStored);
}

/** Title and note are the only editable parts of a saved calculation. */
export async function updateCalculationText(db: Db, id: number, patch: { title?: string; note?: string }, now = Date.now()): Promise<void> {
  const title = patch.title === undefined ? null : cleanText('title', patch.title, 200, false);
  const note = patch.note === undefined ? null : cleanText('note', patch.note, 5000, false);
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync('UPDATE calculations SET title = COALESCE(?, title), note = COALESCE(?, note), updated_at = ? WHERE id = ?', title, note, now, id);
    if (r.changes === 0) throw new DataError('not_found', 'calculation', `no calculation ${id}`);
  });
}

export async function deleteCalculation(db: Db, id: number): Promise<void> {
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync('DELETE FROM calculations WHERE id = ?', id);
    if (r.changes === 0) throw new DataError('not_found', 'calculation', `no calculation ${id}`);
  });
}

/**
 * "Open as new calculation" (D20): the stored input recomputed by the CURRENT engine and profile. Nothing is written;
 * the saved row stays as it was. Returns null when the stored input is unreadable.
 */
export async function openAsNew(db: Db, id: number): Promise<{ kind: CalcKind; input: unknown; result: CalcResult } | null> {
  const stored = await getCalculation(db, id);
  if (!stored || stored.input === null || typeof stored.input !== 'object') return null;
  return { kind: stored.kind, input: stored.input, result: compute(stored.kind, stored.input as CalcInput) };
}
