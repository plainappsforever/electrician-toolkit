// The user's own cable tables (D14): validation, repository, CSV import/export (SPEC §6, §11, A12). Nothing here knows
// a standard's numbers: every value comes from the user. A row is copied into a calculation's input when used (D20).
import type { UserTableRow } from '@/engine';
import { translate, type Language, type MessageKey } from '@/i18n';

import { CSV_BOM, parseCsv, toCsv } from './csv';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';
import { DataError } from './util';

export const TABLE_LIMITS = {
  maxRows: 100,
  maxSizeMm2: 2000,
  maxIzA: 10_000,
  maxCsvChars: 200_000,
  maxErrors: 50,
} as const;

export type CableTableMeta = {
  name: string;
  /** Where the values come from, in the user's words (required, D14). */
  sourceNote: string;
  material: 'cu' | 'al';
  insulationMaxC: number;
  referenceAmbientC: number;
  methodLabel: string;
  loadedConductors: 2 | 3 | null;
};
export type CableTable = CableTableMeta & { id: number; createdAt: number; updatedAt: number };
export type CableTableListItem = CableTable & { rowCount: number };
export type CableRow = { sizeMm2: number; izA: number };

export type TableProblemCode =
  | 'name'
  | 'sourceNote'
  | 'material'
  | 'temperature'
  | 'reference'
  | 'loaded'
  | 'label'
  | 'header'
  | 'columns'
  | 'notNumber'
  | 'ambiguous'
  | 'size'
  | 'iz'
  | 'duplicate'
  | 'order'
  | 'empty'
  | 'tooMany'
  | 'tooLarge';
/** `line` = line of the CSV file (1-based) when the problem comes from an import. */
export type TableProblem = { code: TableProblemCode; line?: number; vars?: Record<string, string | number> };

export class TableValidationError extends DataError {
  constructor(readonly problems: TableProblem[]) {
    super('invalid', 'table', problems.map((p) => p.code).join(', '));
  }
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validateTableMeta(meta: CableTableMeta): TableProblem[] {
  const p: TableProblem[] = [];
  const name = typeof meta.name === 'string' ? meta.name.trim() : '';
  if (name === '' || name.length > 200) p.push({ code: 'name' });
  const note = typeof meta.sourceNote === 'string' ? meta.sourceNote.trim() : '';
  if (note === '' || note.length > 2000) p.push({ code: 'sourceNote' });
  if (meta.material !== 'cu' && meta.material !== 'al') p.push({ code: 'material' });
  const maxOk = finite(meta.insulationMaxC) && meta.insulationMaxC > 0 && meta.insulationMaxC <= 250;
  const refOk = finite(meta.referenceAmbientC) && meta.referenceAmbientC >= -50 && meta.referenceAmbientC <= 100;
  if (!maxOk) p.push({ code: 'temperature' });
  if (!refOk) p.push({ code: 'reference' });
  else if (maxOk && meta.referenceAmbientC >= meta.insulationMaxC) p.push({ code: 'reference' });
  if (meta.loadedConductors !== null && meta.loadedConductors !== 2 && meta.loadedConductors !== 3) p.push({ code: 'loaded' });
  if (typeof meta.methodLabel !== 'string' || meta.methodLabel.length > 50) p.push({ code: 'label' });
  return p;
}

/**
 * Bounds, duplicates and monotonicity of a row list (`lines` = CSV line per row for imports). Iz must strictly
 * increase with the size — a cable table where a bigger conductor carries less is a typing error.
 */
export function validateRows(rows: readonly CableRow[], lines?: readonly number[]): TableProblem[] {
  const p: TableProblem[] = [];
  const at = (i: number) => (lines ? { line: lines[i] } : {});
  if (rows.length === 0) return [{ code: 'empty' }];
  if (rows.length > TABLE_LIMITS.maxRows) p.push({ code: 'tooMany', ...at(TABLE_LIMITS.maxRows), vars: { max: TABLE_LIMITS.maxRows } });
  const valid: { size: number; iz: number; i: number }[] = [];
  rows.forEach((r, i) => {
    const sizeOk = finite(r.sizeMm2) && r.sizeMm2 > 0 && r.sizeMm2 <= TABLE_LIMITS.maxSizeMm2;
    const izOk = finite(r.izA) && r.izA > 0 && r.izA <= TABLE_LIMITS.maxIzA;
    if (!sizeOk) p.push({ code: 'size', ...at(i), vars: { max: TABLE_LIMITS.maxSizeMm2 } });
    if (!izOk) p.push({ code: 'iz', ...at(i), vars: { max: TABLE_LIMITS.maxIzA } });
    if (sizeOk && izOk) valid.push({ size: r.sizeMm2, iz: r.izA, i });
  });
  const seen = new Map<number, number>();
  const unique: typeof valid = [];
  for (const r of valid) {
    const first = seen.get(r.size);
    if (first !== undefined) p.push({ code: 'duplicate', ...at(r.i), vars: { size: r.size, first: lines ? lines[first] : first + 1 } });
    else {
      seen.set(r.size, r.i);
      unique.push(r);
    }
  }
  unique.sort((a, b) => a.size - b.size);
  for (let k = 1; k < unique.length; k++) {
    if (unique[k].iz <= unique[k - 1].iz) {
      p.push({ code: 'order', ...at(unique[k].i), vars: { size: unique[k].size, iz: unique[k].iz, prevSize: unique[k - 1].size, prevIz: unique[k - 1].iz } });
    }
  }
  return p;
}

// ---------------------------------------------------------------- CSV (size_mm2,iz_a)

export const TABLE_CSV_HEADER = ['size_mm2', 'iz_a'] as const;

/**
 * A number as typed in a table cell: digits with at most one `.` or `,` decimal separator. Signs, exponents, units,
 * inner spaces and grouping are refused. A cell like `1.500` or `2,500` (1–3 digits, one separator, exactly three digits after it)
 * could mean 1.5 or 1500 and is refused as ambiguous instead of guessed.
 */
export function parseTableNumber(cell: string): { ok: true; value: number } | { ok: false; reason: 'notNumber' | 'ambiguous' } {
  // only the ends are trimmed: an inner space (`1 5`, `1 000`) is refused, not glued together (review #17, D65)
  const s = cell.replace(/^[\s\u00a0\u202f]+|[\s\u00a0\u202f]+$/g, '');
  const m = /^(\d+)(?:[.,](\d+))?$/.exec(s);
  if (!m) return { ok: false, reason: 'notNumber' };
  if (m[2] !== undefined && m[2].length === 3 && /^[1-9]\d{0,2}$/.test(m[1])) return { ok: false, reason: 'ambiguous' };
  return { ok: true, value: Number(m[2] === undefined ? m[1] : `${m[1]}.${m[2]}`) };
}

/** Non-blocking hints (D61): the values stay the user's (D14); the import and the editor show them next to the rows. */
export type TableWarning = { code: 'notStandardSize' | 'ratio'; line?: number; vars: Record<string, string | number> };

export type TableCsvResult = { ok: true; rows: CableRow[]; warnings?: TableWarning[] } | { ok: false; errors: TableProblem[] };

/** IEC 60228 nominal cross-sections, mm² (source `iec60228`), up to the 2000 mm² import limit. */
export const IEC60228_SIZES_MM2: readonly number[] = [
  0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300, 400, 500, 630, 800, 1000, 1200, 1400, 1600, 1800, 2000,
];
/** Plausible Iz per mm² for a cable table (A/mm²): outside it, the columns are probably swapped or the unit is wrong. */
export const IZ_PER_MM2 = { min: 0.5, max: 25 } as const;

/**
 * Hints for rows that are valid but look like a mix-up (review #13): a size outside the IEC 60228 series (an AWG
 * gauge or kcmil typed as mm²?) and an Iz/S outside 0.5…25 A/mm² (columns swapped?). Never blocks an import.
 */
export function tableWarnings(rows: readonly CableRow[], lines?: readonly number[]): TableWarning[] {
  const out: TableWarning[] = [];
  rows.forEach((r, i) => {
    const at = lines ? { line: lines[i] } : {};
    if (!IEC60228_SIZES_MM2.some((s) => Math.abs(s - r.sizeMm2) <= 1e-9 * s)) out.push({ code: 'notStandardSize', ...at, vars: { size: r.sizeMm2 } });
    const ratio = r.izA / r.sizeMm2;
    if (ratio < IZ_PER_MM2.min || ratio > IZ_PER_MM2.max) out.push({ code: 'ratio', ...at, vars: { size: r.sizeMm2, iz: r.izA, min: IZ_PER_MM2.min, max: IZ_PER_MM2.max } });
  });
  return out;
}

export function tableWarningText(w: TableWarning, language: Language): string {
  const body = translate(language, `tableWarning.${w.code}` as MessageKey, w.vars);
  return w.line === undefined ? body : `${translate(language, 'tableError.line', { line: w.line })} ${body}`;
}

/**
 * Reads a table CSV: header `size_mm2,iz_a` with `,` `;` or tab as separator and a decimal comma or point. All or
 * nothing: any problem returns the full list of line-numbered errors and no rows. The rows come back sorted by size.
 */
export function parseTableCsv(input: string): TableCsvResult {
  if (input.length > TABLE_LIMITS.maxCsvChars) return { ok: false, errors: [{ code: 'tooLarge', vars: { max: TABLE_LIMITS.maxCsvChars } }] };
  const firstLine = (input.startsWith(CSV_BOM) ? input.slice(1) : input).split(/\r\n|\r|\n/).find((l) => l.trim() !== '') ?? '';
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  let records;
  try {
    records = parseCsv(input, delimiter);
  } catch {
    return { ok: false, errors: [{ code: 'columns', line: 1 }] };
  }
  if (records.length === 0) return { ok: false, errors: [{ code: 'empty' }] };
  const [head, ...body] = records;
  const headCells = head.cells.map((c) => c.trim().toLowerCase());
  while (headCells.length > 2 && headCells[headCells.length - 1] === '') headCells.pop();
  // Excel writes a trailing separator on EVERY line when it writes one on the header (`Size_mm2;IZ_A;`). A row may end
  // in at most as many empty cells as the header did; otherwise `1,5,` (decimal comma, Iz left empty) would silently
  // become size 1 mm², Iz 5 A (review #12, D60).
  const trailingAllowed = head.cells.length - headCells.length;
  if (headCells.length !== 2 || headCells[0] !== TABLE_CSV_HEADER[0] || headCells[1] !== TABLE_CSV_HEADER[1]) {
    return { ok: false, errors: [{ code: 'header', line: head.line }] };
  }
  if (body.length === 0) return { ok: false, errors: [{ code: 'empty' }] };
  const errors: TableProblem[] = [];
  const rows: CableRow[] = [];
  const lines: number[] = [];
  for (const rec of body) {
    const cells = [...rec.cells];
    for (let k = 0; k < trailingAllowed && cells.length > 2 && cells[cells.length - 1].trim() === ''; k++) cells.pop();
    if (cells.length !== 2) {
      errors.push({ code: 'columns', line: rec.line, vars: { found: cells.length } });
      continue;
    }
    const size = parseTableNumber(cells[0]);
    const iz = parseTableNumber(cells[1]);
    if (!size.ok) errors.push({ code: size.reason, line: rec.line, vars: { column: TABLE_CSV_HEADER[0], text: cells[0].trim().slice(0, 40) } });
    if (!iz.ok) errors.push({ code: iz.reason, line: rec.line, vars: { column: TABLE_CSV_HEADER[1], text: cells[1].trim().slice(0, 40) } });
    if (size.ok && iz.ok) {
      rows.push({ sizeMm2: size.value, izA: iz.value });
      lines.push(rec.line);
    }
  }
  if (rows.length > 0 || errors.length === 0) errors.push(...validateRows(rows, lines));
  if (errors.length > 0) return { ok: false, errors: errors.sort((a, b) => (a.line ?? 0) - (b.line ?? 0)).slice(0, TABLE_LIMITS.maxErrors) };
  const warnings = tableWarnings(rows, lines).slice(0, TABLE_LIMITS.maxErrors);
  const sorted = [...rows].sort((a, b) => a.sizeMm2 - b.sizeMm2);
  return warnings.length > 0 ? { ok: true, rows: sorted, warnings } : { ok: true, rows: sorted };
}

/** English → `,` and point; German → `;` and decimal comma (Excel in German opens it directly). parseTableCsv reads both. */
export function serializeTableCsv(rows: readonly CableRow[], language: Language): string {
  const comma = language === 'de';
  const fmt = (n: number) => (comma ? String(n).replace('.', ',') : String(n));
  return toCsv(TABLE_CSV_HEADER, [...rows].sort((a, b) => a.sizeMm2 - b.sizeMm2).map((r) => [fmt(r.sizeMm2), fmt(r.izA)]), comma ? ';' : ',');
}

/** Message for a table problem in the given language, with the CSV line in front when there is one. */
export function tableProblemText(problem: TableProblem, language: Language): string {
  const body = translate(language, `tableError.${problem.code}` as MessageKey, problem.vars);
  return problem.line === undefined ? body : `${translate(language, 'tableError.line', { line: problem.line })} ${body}`;
}

// ---------------------------------------------------------------- repository

type TableRow = {
  id: number;
  name: string;
  source_note: string;
  material: 'cu' | 'al';
  insulation_max_c: number;
  reference_ambient_c: number;
  method_label: string;
  loaded_conductors: 2 | 3 | null;
  created_at: number;
  updated_at: number;
};
const toTable = (r: TableRow): CableTable => ({
  id: r.id,
  name: r.name,
  sourceNote: r.source_note,
  material: r.material,
  insulationMaxC: r.insulation_max_c,
  referenceAmbientC: r.reference_ambient_c,
  methodLabel: r.method_label,
  loadedConductors: r.loaded_conductors,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const trimmed = (m: CableTableMeta): CableTableMeta => ({ ...m, name: m.name.trim(), sourceNote: m.sourceNote.trim(), methodLabel: m.methodLabel.trim() });

async function writeRows(tx: Db, tableId: number, rows: readonly CableRow[]): Promise<void> {
  await tx.runAsync('DELETE FROM cable_table_rows WHERE table_id = ?', tableId);
  for (const r of [...rows].sort((a, b) => a.sizeMm2 - b.sizeMm2)) {
    await tx.runAsync('INSERT INTO cable_table_rows (table_id, size_mm2, iz_a) VALUES (?, ?, ?)', tableId, r.sizeMm2, r.izA);
  }
}

/** Creates a table with its rows in one unit. Rows may be empty while the user is still typing; imports require some. */
export async function createCableTable(db: Db, meta: CableTableMeta, rows: readonly CableRow[] = [], now = Date.now()): Promise<number> {
  const m = trimmed(meta);
  const problems = [...validateTableMeta(m), ...(rows.length > 0 ? validateRows(rows) : [])];
  if (problems.length > 0) throw new TableValidationError(problems);
  return withTransaction(db, async (tx) => {
    const r = await tx.runAsync(
      `INSERT INTO cable_tables (name, source_note, material, insulation_max_c, reference_ambient_c, method_label, loaded_conductors, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      m.name,
      m.sourceNote,
      m.material,
      m.insulationMaxC,
      m.referenceAmbientC,
      m.methodLabel,
      m.loadedConductors,
      now,
      now
    );
    await writeRows(tx, r.lastInsertRowId, rows);
    return r.lastInsertRowId;
  });
}

export async function updateCableTable(db: Db, id: number, meta: CableTableMeta, now = Date.now()): Promise<void> {
  const m = trimmed(meta);
  const problems = validateTableMeta(m);
  if (problems.length > 0) throw new TableValidationError(problems);
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync(
      `UPDATE cable_tables SET name = ?, source_note = ?, material = ?, insulation_max_c = ?, reference_ambient_c = ?, method_label = ?,
         loaded_conductors = ?, updated_at = ? WHERE id = ?`,
      m.name,
      m.sourceNote,
      m.material,
      m.insulationMaxC,
      m.referenceAmbientC,
      m.methodLabel,
      m.loadedConductors,
      now,
      id
    );
    if (r.changes === 0) throw new DataError('not_found', 'table', `no table ${id}`);
  });
}

/** Replaces all rows of a table; validated first, one unit — a refused list changes nothing. */
export async function replaceTableRows(db: Db, id: number, rows: readonly CableRow[], now = Date.now()): Promise<void> {
  const problems = validateRows(rows);
  if (problems.length > 0) throw new TableValidationError(problems);
  await withTransaction(db, async (tx) => {
    const t = await tx.getFirstAsync('SELECT id FROM cable_tables WHERE id = ?', id);
    if (!t) throw new DataError('not_found', 'table', `no table ${id}`);
    await writeRows(tx, id, rows);
    await tx.runAsync('UPDATE cable_tables SET updated_at = ? WHERE id = ?', now, id);
  });
}

/** CSV text → rows of an existing table, all or nothing. Nothing is written unless every line is valid. */
export async function importTableCsv(db: Db, id: number, csvText: string, now = Date.now()): Promise<TableCsvResult> {
  const parsed = parseTableCsv(csvText);
  if (parsed.ok) await replaceTableRows(db, id, parsed.rows, now);
  return parsed;
}

export async function getCableTable(db: Db, id: number): Promise<{ table: CableTable; rows: CableRow[] } | null> {
  return withRead(db, async (r) => {
    const row = await r.getFirstAsync<TableRow>('SELECT * FROM cable_tables WHERE id = ?', id);
    if (!row) return null;
    const rows = await r.getAllAsync<{ size_mm2: number; iz_a: number }>('SELECT size_mm2, iz_a FROM cable_table_rows WHERE table_id = ? ORDER BY size_mm2', id);
    return { table: toTable(row), rows: rows.map((x) => ({ sizeMm2: x.size_mm2, izA: x.iz_a })) };
  });
}

export async function listCableTables(db: Db): Promise<CableTableListItem[]> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<TableRow & { row_count: number }>(
      'SELECT t.*, (SELECT COUNT(*) FROM cable_table_rows x WHERE x.table_id = t.id) AS row_count FROM cable_tables t ORDER BY t.name COLLATE NOCASE, t.id'
    )
  );
  return rows.map((r) => ({ ...toTable(r), rowCount: r.row_count }));
}

/** Deleting a table never touches saved calculations: they hold a copy of the row they used (D20, A5). */
export async function deleteCableTable(db: Db, id: number): Promise<void> {
  await withTransaction(db, async (tx) => {
    const r = await tx.runAsync('DELETE FROM cable_tables WHERE id = ?', id);
    if (r.changes === 0) throw new DataError('not_found', 'table', `no table ${id}`);
  });
}

/**
 * The row to copy into a coordination input (D20): values plus the table's name, source note, temperatures and — v1.1 F8
 * (REVIEW_V1 #8) — material, installation-method label and loaded conductors, without which an Iz means little years later.
 */
export function userTableRow(table: CableTable, row: CableRow): UserTableRow {
  const out: UserTableRow = {
    tableName: table.name,
    sourceNote: table.sourceNote,
    sizeMm2: row.sizeMm2,
    izA: row.izA,
    insulationMaxC: table.insulationMaxC,
    referenceAmbientC: table.referenceAmbientC,
    material: table.material,
  };
  if (table.methodLabel.trim() !== '') out.methodLabel = table.methodLabel.trim();
  if (table.loadedConductors !== null) out.loadedConductors = table.loadedConductors;
  return out;
}
