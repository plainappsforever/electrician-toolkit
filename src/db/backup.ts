// One-file JSON backup and restore (SPEC §11, A6, D25, D44; pattern of print-cost's backup.ts). `parseBackup` validates
// EVERYTHING before any change: size, JSON, app, versions, every table, column, foreign key, uniqueness, every setting,
// the shape of every stored calculation, every cable table, every photo. `restoreBackup` replaces all data in ONE
// transaction and rolls back completely on any error. Files, share sheet and picker are P6 glue.
// Format 3 (V1.5 phase A, D100) adds photos: their rows (`photos`) and their JPEG bytes as base64 (`photoData`, by photo
// id). Big files are written by `writeBackupStream` one photo at a time (D83: never one huge string or native call), with
// a downscale plan when the 100 MiB cap would be exceeded (`planBackupPhotos`); a restore writes the photo files to new
// names first and then replaces the rows in one transaction.
import { CALC_KINDS, compute, ENGINE_VERSION, EU_DE, type CalcInput, type CalcKind } from '@/engine';

import { sameResult } from './calculations';

import { LATEST_VERSION } from './migrations';
import { PHOTO_LIMITS, PHOTO_OWNER_TYPES, PHOTO_PATH } from './photos';
import { isSettingKey, settingProblem } from './settings';
import { TABLE_LIMITS, validateRows } from './tables';
import { withRead, withTransaction } from './tx';
import type { Db } from './types';

export const BACKUP_APP = 'electrician-toolkit';
/**
 * 2 (v1.1, F7): adds `checksums` — one checksum per calculation over engine version, profile, calculator, inputs and
 * result. Version 1 files (v1.0) are still accepted; the app of v1.0 refuses version 2 files as "newer".
 */
export const BACKUP_VERSION = 3;
/** 3 (V1.5 A, D100): adds `photos` (rows) and `photoData` (base64 JPEG per photo id). Versions 1 and 2 are still read. */
export const PHOTOS_SINCE_BACKUP_VERSION = 3;
/** Migration 3 made the photos table. */
export const PHOTOS_SINCE_SCHEMA = 3;
/** One photo in a backup: far above a stored photo (≈ 0.3–0.6 MB at 2048 px), small enough for one native write. */
export const MAX_PHOTO_BACKUP_BYTES = 8 * 1024 * 1024;
/** Engine versions whose numbers and verdicts this app reproduces exactly (1.1.0 added texts only, D87/D90). */
export const RECOMPUTABLE_ENGINES: readonly string[] = ['1.0.0', '1.1.0'];
export const CHECKSUM_ALGORITHM = 'cyrb64-1';
/** Migration 2 is the first schema with product tables. */
export const MIN_SCHEMA_VERSION = 2;
/**
 * SPEC §11 (amended, D57): files above 100 MiB are refused — on the file size BEFORE reading (`backupFileSizeProblem`,
 * P6 calls it with `File.size`), and again on the text length before JSON.parse. The app's own A13 backup (10 000 saved
 * calculations ≈ 54 MB) is below it; export warns when its own file would be above it (`backupExceedsRestoreLimit`).
 */
export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
/**
 * Row caps per section, checked before any per-row work so a hostile file is refused in time linear in its size (D57).
 * They are far above what a 100 MiB file of real data holds (≈ 18 000 saved calculations).
 */
export const MAX_SECTION_ROWS: Record<string, number> = {
  projects: 100_000,
  circuits: 100_000,
  calculations: 100_000,
  cable_tables: 10_000,
  cable_table_rows: 100_000,
  photos: 20_000,
};
const MAX_JSON_CELL = 4 * 1024 * 1024;

type Kind = 'int' | 'real' | 'text' | 'flag' | 'json';
type Col = {
  name: string;
  kind: Kind;
  nullable?: boolean;
  oneOf?: readonly (string | number)[];
  min?: number;
  max?: number;
  minExclusive?: boolean;
  minLen?: number;
  maxLen?: number;
  pattern?: RegExp;
};

const int = (name: string, o: Partial<Col> = {}): Col => ({ name, kind: 'int', ...o });
const real = (name: string, o: Partial<Col> = {}): Col => ({ name, kind: 'real', ...o });
const text = (name: string, o: Partial<Col> = {}): Col => ({ name, kind: 'text', maxLen: 5000, ...o });
const flag = (name: string): Col => ({ name, kind: 'flag' });
const json = (name: string): Col => ({ name, kind: 'json' });
const id = int('id', { min: 1 });
const stamps = [int('created_at', { min: 0, max: 1e14 }), int('updated_at', { min: 0, max: 1e14 })];
const profileId = (name: string) => text(name, { minLen: 1, maxLen: 40, pattern: /^[a-z0-9-]+$/ });
const version = (name: string) => text(name, { minLen: 1, maxLen: 40 });

export type TableName = 'projects' | 'circuits' | 'calculations' | 'cable_tables' | 'cable_table_rows' | 'photos';
type TableSpec = { columns: Col[]; refs: { column: string; table: TableName }[] };

/** Parents before children: restore inserts in this order and deletes in reverse. */
export const TABLE_ORDER: readonly TableName[] = ['projects', 'circuits', 'calculations', 'cable_tables', 'cable_table_rows', 'photos'];

/** Backup top-level key for each table (SPEC §11). */
export const BACKUP_KEYS: Record<TableName, string> = {
  projects: 'projects',
  circuits: 'circuits',
  calculations: 'calculations',
  cable_tables: 'cableTables',
  cable_table_rows: 'cableTableRows',
  photos: 'photos',
};

/** Mirrors migration 2 (a test compares the column lists with `PRAGMA table_info`). */
export const TABLES: Record<TableName, TableSpec> = {
  projects: {
    columns: [id, text('name', { minLen: 1, maxLen: 200 }), text('client', { maxLen: 200 }), text('site', { maxLen: 200 }), text('notes'), profileId('profile_id'), flag('archived'), ...stamps],
    refs: [],
  },
  circuits: {
    columns: [id, int('project_id', { min: 1 }), text('label', { minLen: 1, maxLen: 200 }), text('notes'), int('sort', { min: -1e9, max: 1e9 }), ...stamps],
    refs: [{ column: 'project_id', table: 'projects' }],
  },
  calculations: {
    columns: [
      id,
      int('project_id', { nullable: true, min: 1 }),
      int('circuit_id', { nullable: true, min: 1 }),
      text('kind', { oneOf: CALC_KINDS }),
      text('title', { maxLen: 200 }),
      text('note'),
      json('inputs_json'),
      json('result_json'),
      version('engine_version'),
      profileId('profile_id'),
      version('profile_version'),
      ...stamps,
    ],
    refs: [
      { column: 'project_id', table: 'projects' },
      { column: 'circuit_id', table: 'circuits' },
    ],
  },
  cable_tables: {
    columns: [
      id,
      text('name', { minLen: 1, maxLen: 200 }),
      text('source_note', { minLen: 1, maxLen: 2000 }),
      text('material', { oneOf: ['cu', 'al'] }),
      real('insulation_max_c', { min: 0, minExclusive: true, max: 250 }),
      real('reference_ambient_c', { min: -50, max: 100 }),
      text('method_label', { maxLen: 50 }),
      int('loaded_conductors', { nullable: true, oneOf: [2, 3] }),
      ...stamps,
    ],
    refs: [],
  },
  cable_table_rows: {
    columns: [int('table_id', { min: 1 }), real('size_mm2', { min: 0, minExclusive: true, max: 2000 }), real('iz_a', { min: 0, minExclusive: true, max: 10_000 })],
    refs: [{ column: 'table_id', table: 'cable_tables' }],
  },
  // migration 3; the owner is polymorphic (owner_type + owner_id), checked by `photoProblem`, not by `refs`
  photos: {
    columns: [
      id,
      text('owner_type', { oneOf: PHOTO_OWNER_TYPES }),
      int('owner_id', { min: 1 }),
      text('file_path', { minLen: 1, maxLen: 300, pattern: PHOTO_PATH }),
      int('width', { min: 1, max: PHOTO_LIMITS.maxEdge }),
      int('height', { min: 1, max: PHOTO_LIMITS.maxEdge }),
      int('bytes', { min: 1, max: MAX_PHOTO_BACKUP_BYTES }),
      text('caption', { maxLen: PHOTO_LIMITS.captionMax }),
      int('sort', { min: -1e9, max: 1e9 }),
      ...stamps,
    ],
    refs: [],
  },
};

export type Row = Record<string, string | number | null>;
export type BackupFile = {
  app: typeof BACKUP_APP;
  backupVersion: number;
  schemaVersion: number;
  exportedAt: string;
  engineVersion: string;
  settings: Record<string, string>;
  projects: Row[];
  circuits: Row[];
  calculations: Row[];
  cableTables: Row[];
  cableTableRows: Row[];
  /** Version 3+: photo rows (empty when reading a version 1/2 file). */
  photos: Row[];
  /** Version 3+: the JPEG bytes of each photo as base64, keyed by photo id (empty when reading a version 1/2 file). */
  photoData: Record<string, string>;
  /** Version 2+: checksum per calculation id (`calculationChecksum`). Detects hand edits; it is not a signature. */
  checksums?: { algorithm: string; calculations: Record<string, string> };
};

export type BackupErrorCode =
  | 'too_large'
  | 'too_many_rows'
  | 'not_json'
  | 'not_a_backup'
  | 'wrong_app'
  | 'invalid_version'
  | 'newer_backup'
  | 'newer_schema'
  | 'invalid_structure'
  | 'invalid_row'
  | 'duplicate_row'
  | 'broken_reference'
  | 'inconsistent'
  | 'edited';

export type BackupError = { code: BackupErrorCode; /** For logs and tests; the UI shows a string per code (`backup.error.<code>`). */ detail: string };

export type BackupSummary = {
  exportedAt: string;
  backupVersion: number;
  schemaVersion: number;
  engineVersion: string;
  counts: { projects: number; circuits: number; calculations: number; history: number; cableTables: number; cableTableRows: number; photos: number };
  hasLogo: boolean;
  /** Calculations computed by a NEWER engine than this app's (review #18): the restore screen says "update the app". */
  newerEngine: number;
  /**
   * Calculations whose result could be checked neither by recomputing it (another engine/profile version) nor by a
   * checksum (a version 1 file): restored as stored, and the restore screen says how many (v1.1 F7).
   */
  unverified: number;
};

/** a > b for dotted numeric versions ("1.10.0" > "1.9.2"); a non-numeric part compares as 0. */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split('.').map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

export type ValidateResult = { ok: true; backup: BackupFile; summary: BackupSummary } | { ok: false; error: BackupError };

const fail = (code: BackupErrorCode, detail: string): ValidateResult => ({ ok: false, error: { code, detail } });
const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isTextOf = (x: unknown, key: string): boolean => isObject(x) && typeof x[key] === 'string';

/** A stored calculation must be renderable and re-openable: the shapes the report and the screens read. */
function resultProblem(kind: string, value: unknown): string | null {
  if (!isObject(value)) return 'is not an object';
  if (value.kind !== kind) return 'is of another calculator';
  if (value.ok !== true) return 'is not a valid result';
  for (const list of ['steps', 'assumptions', 'checks', 'warnings'] as const) {
    const items = value[list];
    if (!Array.isArray(items)) return `${list} is not a list`;
    if (!items.every((i) => isTextOf(i, 'key') && isObject((i as Record<string, unknown>).vars))) return `${list} has a malformed entry`;
  }
  if (!Array.isArray(value.errors) || value.errors.length > 0) return 'carries errors';
  if (!Array.isArray(value.sources) || !value.sources.every((s) => typeof s === 'string')) return 'sources is not a list of ids';
  if (!isObject(value.values) || !Object.values(value.values).every((v) => isObject(v) && isFiniteNumber(v.value) && typeof v.unit === 'string')) return 'values are malformed';
  if (!isObject(value.texts) || !Object.values(value.texts).every((v) => typeof v === 'string')) return 'texts are malformed';
  for (const f of ['engineVersion', 'profileId', 'profileVersion'] as const) if (typeof value[f] !== 'string') return `${f} is missing`;
  return null;
}

function columnProblem(spec: Col, v: unknown, row: Record<string, unknown>): string | null {
  if (v === null) return spec.nullable ? null : 'is null';
  switch (spec.kind) {
    case 'int':
    case 'flag': {
      if (!isInt(v)) return 'is not an integer';
      if (spec.kind === 'flag' && v !== 0 && v !== 1) return 'is not 0 or 1';
      if (spec.oneOf && !spec.oneOf.includes(v)) return 'is not an allowed value';
      if (spec.min !== undefined && v < spec.min) return `is below ${spec.min}`;
      if (spec.max !== undefined && v > spec.max) return `is above ${spec.max}`;
      return null;
    }
    case 'real': {
      if (!isFiniteNumber(v)) return 'is not a number';
      if (spec.min !== undefined && (spec.minExclusive ? v <= spec.min : v < spec.min)) return `is not above ${spec.min}`;
      if (spec.max !== undefined && v > spec.max) return `is above ${spec.max}`;
      return null;
    }
    case 'text':
      if (typeof v !== 'string') return 'is not text';
      if (spec.oneOf && !spec.oneOf.includes(v)) return 'is not an allowed value';
      if (spec.minLen !== undefined && v.trim().length < spec.minLen) return 'is empty';
      if (spec.maxLen !== undefined && v.length > spec.maxLen) return 'is too long';
      if (spec.pattern && !spec.pattern.test(v)) return 'has an invalid format';
      return null;
    case 'json': {
      if (typeof v !== 'string') return 'is not text';
      if (v.length > MAX_JSON_CELL) return 'is too large';
      let parsed: unknown;
      try {
        parsed = JSON.parse(v);
      } catch {
        return 'is not valid JSON text';
      }
      if (spec.name === 'inputs_json') return isObject(parsed) ? null : 'is not an object';
      const problem = resultProblem(String(row.kind), parsed);
      return problem ? `${problem}` : null;
    }
  }
}

function validateTable(name: TableName, rows: unknown): { rows: Row[] } | { error: BackupError } {
  const spec = TABLES[name];
  const key = BACKUP_KEYS[name];
  if (!Array.isArray(rows)) return { error: { code: 'invalid_structure', detail: `${key} is not a list` } };
  if (rows.length > MAX_SECTION_ROWS[name]) return { error: { code: 'too_many_rows', detail: `${key} has ${rows.length} rows (max ${MAX_SECTION_ROWS[name]})` } };
  const names = new Set(spec.columns.map((c) => c.name));
  for (let i = 0; i < rows.length; i++) {
    const row: unknown = rows[i];
    if (!isObject(row)) return { error: { code: 'invalid_row', detail: `${key}[${i}] is not an object` } };
    const extra = Object.keys(row).find((k) => !names.has(k));
    if (extra) return { error: { code: 'invalid_row', detail: `${key}[${i}] has unknown column ${extra}` } };
    for (const c of spec.columns) {
      if (!(c.name in row)) return { error: { code: 'invalid_row', detail: `${key}[${i}] lacks ${c.name}` } };
      const problem = columnProblem(c, row[c.name], row);
      if (problem) return { error: { code: 'invalid_row', detail: `${key}[${i}].${c.name} ${problem}` } };
    }
  }
  const keys = new Set<string>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] as Row;
    const k = name === 'cable_table_rows' ? `${String(r.table_id)}|${String(r.size_mm2)}` : String(r.id);
    if (keys.has(k)) return { error: { code: 'duplicate_row', detail: `${key}[${i}] repeats ${k}` } };
    keys.add(k);
  }
  return { rows: rows as Row[] };
}

/** Rules the database enforces with CHECKs or the app enforces on every write, checked up front so a refusal names the reason. */
function consistencyProblem(tables: Record<TableName, Row[]>): string | null {
  const circuitProject = new Map(tables.circuits.map((c) => [c.id, c.project_id] as const));
  for (const c of tables.calculations) {
    if (c.circuit_id !== null) {
      if (c.project_id === null) return `calculations ${String(c.id)}: a circuit without a project`;
      if (circuitProject.get(c.circuit_id) !== c.project_id) return `calculations ${String(c.id)}: its circuit belongs to another project`;
    }
  }
  const byTable = new Map<unknown, Row[]>();
  for (const r of tables.cable_table_rows) {
    // push, never copy: the copy per row made this O(n²) (review #5: 64 000 rows took 6.6 s)
    const list = byTable.get(r.table_id);
    if (list) list.push(r);
    else byTable.set(r.table_id, [r]);
  }
  for (const t of tables.cable_tables) {
    if ((t.reference_ambient_c as number) >= (t.insulation_max_c as number)) return `cable_tables ${String(t.id)}: reference ambient is not below θmax`;
    const rows = byTable.get(t.id) ?? [];
    if (rows.length > 0) {
      const problems = validateRows(rows.map((r) => ({ sizeMm2: r.size_mm2 as number, izA: r.iz_a as number })));
      if (problems.length > 0) return `cable_tables ${String(t.id)}: rows are not valid (${problems[0].code})`;
    }
  }
  return null;
}

/** P6: call with the picked file's size in bytes BEFORE reading it; a non-null result means "do not read". */
export function backupFileSizeProblem(bytes: number, maxBytes = MAX_BACKUP_BYTES): BackupError | null {
  if (!Number.isFinite(bytes) || bytes < 0) return { code: 'too_large', detail: 'the file size is unknown' };
  return bytes > maxBytes ? { code: 'too_large', detail: `${bytes} bytes` } : null;
}

/** UTF-8 length of a string in bytes (what the file will measure), without allocating an encoded copy. */
export function utf8Length(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < text.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/** P6 export: true when the app could not restore its own file (warn before sharing it). */
export function backupExceedsRestoreLimit(fileText: string): boolean {
  return utf8Length(fileText) > MAX_BACKUP_BYTES;
}

// ---------------------------------------------------------------- integrity (v1.1 F7, REVIEW_V1 #7, D88)

/**
 * 64-bit non-cryptographic checksum of a text (cyrb53-style, two 32-bit lanes), as 16 hex digits. It detects a result
 * edited by hand in the plain-JSON file; anyone who knows the algorithm can recompute it, which is why records of a
 * recomputable engine are also recomputed and compared.
 */
const imul = Math.imul; // a local reference: the global lookup per character made the loop ~25× slower (measured in Jest)

export function checksum(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = imul(h1 ^ ch, 2654435761);
    h2 = imul(h2 ^ ch, 1597334677);
  }
  h1 = imul(h1 ^ (h1 >>> 16), 2246822507) ^ imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = imul(h2 ^ (h2 >>> 16), 2246822507) ^ imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** Checksum of one calculation row over everything that makes its frozen result: engine, profile, calculator, inputs, result. */
export function calculationChecksum(row: Row): string {
  return checksum([row.engine_version, row.profile_id, row.profile_version, row.kind, row.inputs_json, row.result_json].map((x) => String(x)).join('\u0000'));
}

/** What a recompute must reproduce of a stored result of an older (text-only different) engine: numbers and verdicts. */
function numbersAndVerdicts(r: Record<string, unknown>, checkIds?: Set<unknown>) {
  const checks = Array.isArray(r.checks) ? (r.checks as Record<string, unknown>[]) : [];
  return {
    values: r.values,
    texts: r.texts,
    steps: r.steps,
    warnings: r.warnings,
    checks: checkIds ? checks.filter((c) => checkIds.has(c.id)) : checks,
  };
}

type Verify = { problem: string | null; checked: boolean };

/**
 * Recomputes a stored calculation of a recomputable engine (same profile) and compares: the app's own engine → the whole
 * result (numbers within D37); 1.0.0 → numbers, verdicts, working and warnings (1.1.0 only added assumption/check texts).
 * `cache` holds the fresh result per (engine, calculator, inputs): the same input is computed once.
 */
function recomputeProblem(row: Row, cache: Map<string, { json: string; result: Record<string, unknown> }>): Verify {
  const engine = String(row.engine_version);
  if (!RECOMPUTABLE_ENGINES.includes(engine) || row.profile_id !== EU_DE.id || row.profile_version !== EU_DE.version) return { problem: null, checked: false };
  const inputs = String(row.inputs_json);
  const key = `${String(row.kind)}\u0000${inputs}`;
  let fresh = cache.get(key);
  if (!fresh) {
    const result = compute(row.kind as CalcKind, JSON.parse(inputs) as CalcInput) as unknown as Record<string, unknown>;
    fresh = { json: JSON.stringify(result), result };
    cache.set(key, fresh);
  }
  if (fresh.result.ok !== true) return { problem: 'its inputs no longer give a valid result', checked: true };
  if (engine === ENGINE_VERSION && fresh.json === row.result_json) return { problem: null, checked: true };
  const stored = JSON.parse(String(row.result_json)) as Record<string, unknown>;
  const same =
    engine === ENGINE_VERSION
      ? sameResult(stored, fresh.result)
      : sameResult(numbersAndVerdicts(stored), numbersAndVerdicts(fresh.result, new Set((Array.isArray(stored.checks) ? (stored.checks as Record<string, unknown>[]) : []).map((c) => c.id))));
  return { problem: same ? null : 'its stored result does not match its inputs (recomputed and compared)', checked: true };
}

/** Every calculation's checksum (version 2+) and recompute (recomputable engines); returns the first problem or the count of unchecked rows. */
function integrityProblem(calculations: Row[], backupVersion: number, checksums: unknown): { error: BackupError } | { unverified: number } {
  let sums: Record<string, unknown> | null = null;
  if (backupVersion >= 2) {
    if (!isObject(checksums) || checksums.algorithm !== CHECKSUM_ALGORITHM || !isObject(checksums.calculations)) {
      return { error: { code: 'invalid_structure', detail: 'checksums are missing or of an unknown kind' } };
    }
    sums = checksums.calculations;
  } else if (checksums !== undefined) {
    return { error: { code: 'invalid_structure', detail: 'a version 1 backup has no checksums' } };
  }
  const cache = new Map<string, { json: string; result: Record<string, unknown> }>();
  let unverified = 0;
  for (const row of calculations) {
    if (sums) {
      const want = sums[String(row.id)];
      if (typeof want !== 'string') return { error: { code: 'edited', detail: `calculations ${String(row.id)}: no checksum` } };
      if (want !== calculationChecksum(row)) return { error: { code: 'edited', detail: `calculations ${String(row.id)}: checksum does not match` } };
    }
    let v: Verify;
    try {
      v = recomputeProblem(row, cache);
    } catch {
      v = { problem: 'its inputs could not be recomputed', checked: true };
    }
    if (v.problem) return { error: { code: 'edited', detail: `calculations ${String(row.id)}: ${v.problem}` } };
    if (!v.checked && !sums) unverified++;
  }
  return { unverified };
}

// ---------------------------------------------------------------- photos (format 3, D100)

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Bytes a base64 text decodes to (null when it is not canonical base64). */
export function base64Bytes(b64: string): number | null {
  if (b64.length % 4 !== 0 || !BASE64.test(b64)) return null;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

/** A JPEG starts with FF D8 FF: in base64 that is "/9j/". */
export const isJpegBase64 = (b64: string) => b64.startsWith('/9j/');

/** Owners exist (a calculation owner is a saved one), paths are unique, every photo has exactly its JPEG bytes. */
function photoProblem(tables: Record<TableName, Row[]>, photoData: unknown): BackupError | null {
  if (tables.photos.length === 0 && (photoData === undefined || (isObject(photoData) && Object.keys(photoData).length === 0))) return null;
  if (!isObject(photoData)) return { code: 'invalid_structure', detail: 'photoData is not an object' };
  const owners: Record<string, Map<unknown, Row>> = {
    project: new Map(tables.projects.map((r) => [r.id, r])),
    circuit: new Map(tables.circuits.map((r) => [r.id, r])),
    calculation: new Map(tables.calculations.map((r) => [r.id, r])),
  };
  const paths = new Set<unknown>();
  const perOwner = new Map<string, number>();
  for (let i = 0; i < tables.photos.length; i++) {
    const p = tables.photos[i];
    const owner = owners[String(p.owner_type)]?.get(p.owner_id);
    if (!owner) return { code: 'broken_reference', detail: `photos[${i}] belongs to a missing ${String(p.owner_type)} ${String(p.owner_id)}` };
    if (p.owner_type === 'calculation' && owner.project_id === null) return { code: 'inconsistent', detail: `photos[${i}] belongs to a history entry` };
    if (paths.has(p.file_path)) return { code: 'duplicate_row', detail: `photos[${i}] repeats the file ${String(p.file_path)}` };
    paths.add(p.file_path);
    const key = `${String(p.owner_type)}|${String(p.owner_id)}`;
    const n = (perOwner.get(key) ?? 0) + 1;
    if (n > PHOTO_LIMITS.perOwner) return { code: 'too_many_rows', detail: `${key} has more than ${PHOTO_LIMITS.perOwner} photos` };
    perOwner.set(key, n);
    const data = photoData[String(p.id)];
    if (typeof data !== 'string') return { code: 'invalid_row', detail: `photos[${i}] has no photoData` };
    if (data.length > Math.ceil(MAX_PHOTO_BACKUP_BYTES / 3) * 4) return { code: 'invalid_row', detail: `photoData ${String(p.id)} is too large` };
    const bytes = base64Bytes(data);
    if (bytes === null || !isJpegBase64(data)) return { code: 'invalid_row', detail: `photoData ${String(p.id)} is not a base64 JPEG` };
    if (bytes !== p.bytes) return { code: 'inconsistent', detail: `photoData ${String(p.id)} holds ${bytes} bytes, its row says ${String(p.bytes)}` };
  }
  const ids = new Set(tables.photos.map((p) => String(p.id)));
  const extra = Object.keys(photoData).find((k) => !ids.has(k));
  if (extra !== undefined) return { code: 'invalid_structure', detail: `photoData ${extra} has no photo row` };
  return null;
}

export function parseBackup(textContent: string, opts: { currentSchema?: number; maxBytes?: number } = {}): ValidateResult {
  if (textContent.length > (opts.maxBytes ?? MAX_BACKUP_BYTES)) return fail('too_large', `${textContent.length} characters`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(textContent);
  } catch {
    return fail('not_json', 'the file is not JSON');
  }
  return validateBackup(parsed, opts);
}

const TOP_KEYS = ['app', 'backupVersion', 'schemaVersion', 'exportedAt', 'engineVersion', 'settings', 'checksums', 'photoData', ...Object.values(BACKUP_KEYS)];

export function validateBackup(input: unknown, opts: { currentSchema?: number } = {}): ValidateResult {
  const currentSchema = opts.currentSchema ?? LATEST_VERSION;
  if (!isObject(input)) return fail('not_a_backup', 'top level is not an object');
  if (input.app !== BACKUP_APP) return fail(typeof input.app === 'string' ? 'wrong_app' : 'not_a_backup', `app is ${JSON.stringify(input.app)}`);
  const { backupVersion, schemaVersion, exportedAt, engineVersion } = input;
  if (!isInt(backupVersion) || backupVersion < 1) return fail('invalid_version', 'backupVersion is not a positive integer');
  if (!isInt(schemaVersion) || schemaVersion < 1) return fail('invalid_version', 'schemaVersion is not a positive integer');
  if (backupVersion > BACKUP_VERSION) return fail('newer_backup', `backupVersion ${backupVersion} > ${BACKUP_VERSION}`);
  if (schemaVersion > currentSchema) return fail('newer_schema', `schemaVersion ${schemaVersion} > ${currentSchema}`);
  if (schemaVersion < MIN_SCHEMA_VERSION) return fail('invalid_version', `schemaVersion ${schemaVersion} < ${MIN_SCHEMA_VERSION}`);
  // Older schemas would need a row upgrader; until a migration 3 exists every accepted file has the current shape.
  if (typeof exportedAt !== 'string' || Number.isNaN(Date.parse(exportedAt))) return fail('invalid_structure', 'exportedAt is not a date');
  if (typeof engineVersion !== 'string' || engineVersion.length === 0 || engineVersion.length > 40) return fail('invalid_structure', 'engineVersion is not text');
  const unknownKey = Object.keys(input).find((k) => !TOP_KEYS.includes(k));
  if (unknownKey) return fail('invalid_structure', `unknown top-level key ${unknownKey}`);

  const withPhotos = backupVersion >= PHOTOS_SINCE_BACKUP_VERSION;
  if (!withPhotos && ('photos' in input || 'photoData' in input)) return fail('invalid_structure', `a version ${backupVersion} backup has no photos`);
  if (withPhotos && schemaVersion < PHOTOS_SINCE_SCHEMA) return fail('invalid_version', `a version ${backupVersion} backup needs schemaVersion ${PHOTOS_SINCE_SCHEMA}`);
  if (withPhotos && !isObject(input.photoData)) return fail('invalid_structure', 'photoData is missing');
  const tables = {} as Record<TableName, Row[]>;
  for (const name of TABLE_ORDER) {
    if (name === 'photos' && !withPhotos) {
      tables.photos = [];
      continue;
    }
    const r = validateTable(name, input[BACKUP_KEYS[name]]);
    if ('error' in r) return { ok: false, error: r.error };
    tables[name] = r.rows;
  }

  if (!isObject(input.settings)) return fail('invalid_structure', 'settings is not an object');
  const settings: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.settings)) {
    if (!isSettingKey(key)) return fail('invalid_row', `settings.${key} is not a known setting`);
    if (typeof value !== 'string') return fail('invalid_row', `settings.${key} is not text`);
    const problem = settingProblem(key, value);
    if (problem) return fail('invalid_row', `settings.${key} ${problem}`);
    settings[key] = value;
  }

  for (const name of TABLE_ORDER) {
    for (const ref of TABLES[name].refs) {
      const ids = new Set(tables[ref.table].map((r) => r.id));
      for (let i = 0; i < tables[name].length; i++) {
        const v = tables[name][i][ref.column];
        if (v !== null && !ids.has(v)) return fail('broken_reference', `${BACKUP_KEYS[name]}[${i}].${ref.column} points to a missing ${BACKUP_KEYS[ref.table]} row`);
      }
    }
  }
  // one cable table holds at most TABLE_LIMITS.maxRows rows: refuse before sorting/validating an oversized one
  const perTable = new Map<unknown, number>();
  for (const r of tables.cable_table_rows) {
    const n = (perTable.get(r.table_id) ?? 0) + 1;
    if (n > TABLE_LIMITS.maxRows) return fail('too_many_rows', `cable table ${String(r.table_id)} has more than ${TABLE_LIMITS.maxRows} rows`);
    perTable.set(r.table_id, n);
  }
  const problem = consistencyProblem(tables);
  if (problem) return fail('inconsistent', problem);
  const photoData = withPhotos ? input.photoData : {};
  const photos = photoProblem(tables, photoData);
  if (photos) return { ok: false, error: photos };
  // v1.1 F7: a frozen result must still be the engine's answer to its inputs (recompute) and unchanged since export (checksum)
  const integrity = integrityProblem(tables.calculations, backupVersion, input.checksums);
  if ('error' in integrity) return { ok: false, error: integrity.error };

  const backup: BackupFile = {
    app: BACKUP_APP,
    backupVersion,
    schemaVersion,
    exportedAt,
    engineVersion,
    settings,
    projects: tables.projects,
    circuits: tables.circuits,
    calculations: tables.calculations,
    cableTables: tables.cable_tables,
    cableTableRows: tables.cable_table_rows,
    photos: tables.photos,
    photoData: photoData as Record<string, string>,
  };
  const history = tables.calculations.filter((c) => c.project_id === null).length;
  return {
    ok: true,
    backup,
    summary: {
      exportedAt,
      backupVersion,
      schemaVersion,
      engineVersion,
      counts: {
        projects: tables.projects.length,
        circuits: tables.circuits.length,
        calculations: tables.calculations.length - history,
        history,
        cableTables: tables.cable_tables.length,
        cableTableRows: tables.cable_table_rows.length,
        photos: tables.photos.length,
      },
      hasLogo: 'logoDataUri' in settings && settings.logoDataUri !== '',
      newerEngine: tables.calculations.filter((c) => isNewerVersion(String(c.engine_version), ENGINE_VERSION)).length,
      unverified: integrity.unverified,
    },
  };
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup);
}

/** 'electrician-toolkit-backup-2026-10-01.json' */
export function backupFileName(today: string): string {
  return `electrician-toolkit-backup-${today}.json`;
}

// ---------------------------------------------------------------- database side

const ORDER_BY: Record<TableName, string> = {
  projects: 'id',
  circuits: 'id',
  calculations: 'id',
  cable_tables: 'id',
  cable_table_rows: 'table_id, size_mm2',
  photos: 'id',
};

/**
 * Rows fetched per query. On Android one `getAllAsync` over 17 500 saved calculations (101 MB of text) ran the Java heap
 * (192 MB) out of memory; pages of 500 (≈ 3 MB) keep the native side small. Paging by OFFSET is consistent here because the
 * whole export is one read unit behind the write queue (nothing can change between pages).
 */
export const EXPORT_PAGE_ROWS = 500;

/** Where photo bytes come from when a backup is written (device glue: expo-file-system + expo-image-manipulator). */
export type PhotoSource = {
  /** The stored JPEG of this photo row as base64, or null when its file is gone (it is then left out and reported). */
  read(photo: Row): Promise<string | null>;
  /** Re-encodes the photo with its long edge at most `maxEdge` px (JPEG). Without it a too-large backup is refused. */
  downscale?(photo: Row, maxEdge: number): Promise<{ base64: string; width: number; height: number } | null>;
};

/** Where restored photo files go (device glue). `name` is relative to the app's document folder (`photos/…`). */
export type PhotoSink = { write(name: string, base64: string): Promise<void> };

/** Everything except the photo bytes, in one consistent read unit (behind the write queue: never half of a running write). */
async function readCore(db: Db, exportedAt: string): Promise<Omit<BackupFile, 'photoData'>> {
  return withRead(db, async (r) => {
    const rows = {} as Record<TableName, Row[]>;
    for (const name of TABLE_ORDER) {
      const columns = TABLES[name].columns.map((c) => c.name).join(', ');
      const all: Row[] = [];
      for (let offset = 0; ; offset += EXPORT_PAGE_ROWS) {
        const page = await r.getAllAsync<Row>(`SELECT ${columns} FROM ${name} ORDER BY ${ORDER_BY[name]} LIMIT ${EXPORT_PAGE_ROWS} OFFSET ${offset}`);
        for (const row of page) all.push(row);
        if (page.length < EXPORT_PAGE_ROWS) break;
      }
      rows[name] = all;
    }
    const settingRows = await r.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings ORDER BY key');
    return {
      app: BACKUP_APP,
      backupVersion: BACKUP_VERSION,
      schemaVersion: LATEST_VERSION,
      exportedAt,
      engineVersion: ENGINE_VERSION,
      settings: Object.fromEntries(settingRows.map((s) => [s.key, s.value])),
      projects: rows.projects,
      circuits: rows.circuits,
      calculations: rows.calculations,
      cableTables: rows.cable_tables,
      cableTableRows: rows.cable_table_rows,
      photos: rows.photos,
      checksums: { algorithm: CHECKSUM_ALGORITHM, calculations: Object.fromEntries(rows.calculations.map((c) => [String(c.id), calculationChecksum(c)])) },
    };
  });
}

/**
 * The whole backup as one object (small data, tests, the dev seed route). With photos it needs their `PhotoSource` and
 * holds every photo in memory: the app writes real backups with `writeBackupStream` instead.
 */
export async function exportBackup(db: Db, exportedAt = new Date().toISOString(), photos?: PhotoSource): Promise<BackupFile> {
  const core = await readCore(db, exportedAt);
  const photoData: Record<string, string> = {};
  const kept: Row[] = [];
  if (core.photos.length > 0 && !photos) throw new Error('This backup has photos: export it with their PhotoSource (writeBackupStream).');
  for (const row of core.photos) {
    const data = await photos!.read(row);
    if (data === null) continue; // file gone: left out (writeBackupStream reports it)
    photoData[String(row.id)] = data;
    kept.push(row);
  }
  return { ...core, photos: kept, photoData };
}

// ---------------------------------------------------------------- size plan for photos (D100)

/** Long-edge steps a backup may downscale photos to, largest first. 640 px still shows a distribution board legibly. */
export const BACKUP_PHOTO_EDGES: readonly number[] = [2048, 1600, 1280, 1024, 800, 640];
/** Head-room under the cap for the estimate (JPEG sizes do not scale exactly with the area). */
export const BACKUP_BUDGET_SHARE = 0.92;

export type PhotoPlan = { ok: true; maxEdge: number | null; estimatedBytes: number; downscale: number[] } | { ok: false; estimatedBytes: number; reason: 'too_large' | 'no_downscale' };

const b64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;
/** Per photo in the file: `"id":"…",` and its row (≈ 260 characters). */
const PHOTO_OVERHEAD = 300;

/** Estimated bytes of a photo after scaling its long edge to `edge` (area ratio, 10 % margin; never more than now). */
export function estimatedPhotoBytes(photo: { width: number; height: number; bytes: number }, edge: number | null): number {
  const long = Math.max(photo.width, photo.height);
  if (edge === null || long <= edge) return photo.bytes;
  return Math.min(photo.bytes, Math.ceil(photo.bytes * (edge / long) ** 2 * 1.1));
}

/**
 * Which long edge (if any) the photos must be scaled to so the whole file stays under `maxBytes` × BACKUP_BUDGET_SHARE.
 * `coreBytes` = the file without photos. Smallest change first: as stored, then 2048, 1600, … 640 px.
 */
export function planBackupPhotos(photos: readonly { id: number; width: number; height: number; bytes: number }[], coreBytes: number, opts: { maxBytes?: number; canDownscale?: boolean } = {}): PhotoPlan {
  const budget = (opts.maxBytes ?? MAX_BACKUP_BYTES) * BACKUP_BUDGET_SHARE;
  const size = (edge: number | null) => coreBytes + photos.reduce((n, p) => n + b64Length(estimatedPhotoBytes(p, edge)) + PHOTO_OVERHEAD, 0);
  const asStored = size(null);
  if (asStored <= budget) return { ok: true, maxEdge: null, estimatedBytes: asStored, downscale: [] };
  if (opts.canDownscale === false) return { ok: false, estimatedBytes: asStored, reason: 'no_downscale' };
  for (const edge of BACKUP_PHOTO_EDGES) {
    const est = size(edge);
    if (est <= budget) return { ok: true, maxEdge: edge, estimatedBytes: est, downscale: photos.filter((p) => Math.max(p.width, p.height) > edge).map((p) => p.id) };
  }
  return { ok: false, estimatedBytes: size(BACKUP_PHOTO_EDGES[BACKUP_PHOTO_EDGES.length - 1]), reason: 'too_large' };
}

/** The backup does not fit the restore cap even with every photo at 640 px (or no downscaler was given). Nothing was written. */
export class BackupTooLargeError extends Error {
  constructor(readonly estimatedBytes: number, readonly reason: 'too_large' | 'no_downscale') {
    super(`The backup would be about ${Math.round(estimatedBytes / 1048576)} MB, above the ${Math.round(MAX_BACKUP_BYTES / 1048576)} MB a restore accepts.`);
    this.name = 'BackupTooLargeError';
  }
}

export type StreamResult = {
  /** UTF-8 bytes written. */
  bytes: number;
  photos: number;
  /** Photo ids whose file was missing: not in the backup (the screen names the count). */
  missing: number[];
  /**
   * Photos whose file exists but could not go into the backup (REVIEW_V15_PA S1/N6): not a JPEG, above
   * MAX_PHOTO_BACKUP_BYTES, or the downscaler returned nothing — left out and reported, never a thrown backup.
   */
  skipped: { id: number; reason: 'not_jpeg' | 'too_large' | 'not_reduced' }[];
  downscaled: number;
  maxEdge: number | null;
  /** The longest edge (px) of the photos as stored: where the "next lower edge" for a retry starts. */
  longestEdge: number;
  /**
   * The plan's estimate was too low and the file came out above the cap: the caller must not offer it. Retry with
   * `startEdge: nextLowerPhotoEdge(result)` (a new file), and refuse when that is null.
   */
  overLimit: boolean;
};

/**
 * The next long edge to retry a too-large backup with (N7): the next step below the one used, or — when the photos went
 * in as stored — the first step below the longest stored photo (retrying 2048 for 2048-px photos would write the same
 * file). Null when 640 px was already used.
 */
export function nextLowerPhotoEdge(result: Pick<StreamResult, 'maxEdge' | 'longestEdge'>): number | null {
  const from = result.maxEdge ?? result.longestEdge;
  return BACKUP_PHOTO_EDGES.find((e) => e < from) ?? null;
}

/**
 * Writes the backup in pieces through `write` (the device glue appends each piece to the file through a handle, D83):
 * first everything except the photos as one JSON text (paged reads), then one photo at a time — read (or downscaled),
 * written, dropped — then the photo rows (with the sizes actually written) and the checksums. At most one photo is in
 * memory at a time. Refuses (BackupTooLargeError) BEFORE writing anything when even 640 px photos would not fit.
 */
export async function writeBackupStream(
  db: Db,
  write: (chunk: string) => void | Promise<void>,
  photos: PhotoSource,
  opts: { exportedAt?: string; maxBytes?: number; startEdge?: number | null } = {}
): Promise<StreamResult> {
  const maxBytes = opts.maxBytes ?? MAX_BACKUP_BYTES;
  const core = await readCore(db, opts.exportedAt ?? new Date().toISOString());
  const { photos: photoRows, checksums, ...rest } = core;
  const head = JSON.stringify(rest);
  const tail = JSON.stringify({ checksums });
  const plan = planBackupPhotos(
    photoRows.map((p) => ({ id: p.id as number, width: p.width as number, height: p.height as number, bytes: p.bytes as number })),
    utf8Length(head) + utf8Length(tail),
    { maxBytes, canDownscale: !!photos.downscale }
  );
  if (!plan.ok) throw new BackupTooLargeError(plan.estimatedBytes, plan.reason);
  const edge = opts.startEdge !== undefined && opts.startEdge !== null && (plan.maxEdge === null || opts.startEdge < plan.maxEdge) ? opts.startEdge : plan.maxEdge;
  let bytes = 0;
  const out = async (chunk: string) => {
    bytes += utf8Length(chunk);
    await write(chunk);
  };
  await out(`${head.slice(0, -1)},"photoData":{`);
  const written: Row[] = [];
  const missing: number[] = [];
  const skipped: StreamResult['skipped'] = [];
  let downscaled = 0;
  const fits = (data: string) => {
    const size = base64Bytes(data);
    return size !== null && isJpegBase64(data) && size <= MAX_PHOTO_BACKUP_BYTES ? size : null;
  };
  for (const row of photoRows) {
    const id = row.id as number;
    let data: string | null;
    let width = row.width as number;
    let height = row.height as number;
    let reduced = false;
    if (edge !== null && Math.max(width, height) > edge) {
      const small = await photos.downscale!(row, edge);
      if (!small) {
        skipped.push({ id, reason: 'not_reduced' }); // N6: the file may be there; it could not be made smaller
        continue;
      }
      data = small.base64;
      width = small.width;
      height = small.height;
      reduced = true;
    } else data = await photos.read(row);
    if (data === null) {
      missing.push(id);
      continue;
    }
    let size = fits(data);
    // S1: a photo above the backup's per-photo limit or not a JPEG is re-encoded once (at the plan's edge, else the
    // stored size) when a downscaler exists; otherwise it is left out and reported — one bad photo never blocks a backup
    if (size === null && !reduced && photos.downscale) {
      const reason: 'not_jpeg' | 'too_large' = isJpegBase64(data) ? 'too_large' : 'not_jpeg';
      const small = await photos.downscale(row, edge ?? BACKUP_PHOTO_EDGES[0]);
      data = small?.base64 ?? null;
      size = data === null ? null : fits(data);
      if (small && size !== null) {
        width = small.width;
        height = small.height;
        reduced = true;
      } else {
        skipped.push({ id, reason });
        continue;
      }
    } else if (size === null) {
      skipped.push({ id, reason: isJpegBase64(data) ? 'too_large' : 'not_jpeg' });
      continue;
    }
    if (reduced) downscaled++;
    await out(`${written.length > 0 ? ',' : ''}"${String(id)}":"${data}"`);
    written.push({ ...row, width, height, bytes: size });
  }
  await out(`},"photos":${JSON.stringify(written)},${tail.slice(1)}`);
  const longestEdge = photoRows.reduce((m, p) => Math.max(m, p.width as number, p.height as number), 0);
  return { bytes, photos: written.length, missing, skipped, downscaled, maxEdge: edge, longestEdge, overLimit: bytes > maxBytes };
}

/** Deletes every row of every table (children first), settings included, as one unit. Used by the dev seed route. */
export async function wipeAllData(db: Db): Promise<void> {
  await withTransaction(db, async (tx) => {
    for (const name of [...TABLE_ORDER].reverse()) await tx.runAsync(`DELETE FROM ${name}`);
    await tx.runAsync('DELETE FROM settings');
  });
}

/** Rows per INSERT statement stay under 900 bound values (older SQLite builds allow 999). */
const MAX_BOUND_VALUES = 900;

/** Called now and then with how many rows (and photo files) are written of how many (the Backup screen's progress line). */
export type RestoreProgress = (done: number, total: number) => void;

export type RestoreFiles = {
  /** Photo files written for this restore (relative paths). After a failure they belong to nobody: the caller may remove them. */
  written: string[];
};

/**
 * Replaces everything with the backup's content in one transaction. Any error — a constraint that got past
 * validation, a full disk, a foreign key left dangling — rolls everything back and is rethrown; the data is exactly as
 * before. Pass a result of `parseBackup` (validated). Rows go in several per INSERT (one native round trip per row took
 * 9.8 s for the 10 000-calculation backup on the Android emulator, P5); `onProgress` is called after every statement.
 * Photos (format 3): their files are written FIRST, to new names `photos/r<restoreId>-<id>.jpg`, so the photos the phone
 * has now stay untouched until the transaction commits; the rows then point to the new files. The old files are
 * unreferenced afterwards (`unreferencedPhotoFiles`); the safety copy of the old data holds their bytes.
 */
/** A fresh restore id: time plus randomness, so a clock set back can never reuse an earlier restore's file names (N5). */
export const newRestoreId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, '0')}`;

export async function restoreBackup(db: Db, backup: BackupFile, onProgress?: RestoreProgress, files?: PhotoSink, restoreId: string = newRestoreId()): Promise<RestoreFiles> {
  if (backup.app !== BACKUP_APP) throw new Error('Not an Electrician Toolkit backup');
  const photos = backup.photos ?? [];
  if (photos.length > 0 && !files) throw new Error('This backup has photos: restore it with a PhotoSink.');
  if (!/^[a-z0-9]{1,20}$/.test(restoreId)) throw new Error('restoreId must be short lower-case letters and digits');
  const data: Record<TableName, Row[]> = {
    projects: backup.projects,
    circuits: backup.circuits,
    calculations: backup.calculations,
    cable_tables: backup.cableTables,
    cable_table_rows: backup.cableTableRows,
    photos: photos.map((p) => ({ ...p, file_path: `photos/r${restoreId}-${String(p.id)}.jpg` })),
  };
  const settingEntries = Object.entries(backup.settings);
  const total = TABLE_ORDER.reduce((n, name) => n + data[name].length, 0) + settingEntries.length + photos.length;
  let done = 0;
  onProgress?.(0, total);
  const written: string[] = [];
  for (const p of data.photos) {
    await files!.write(String(p.file_path), backup.photoData[String(p.id)]);
    written.push(String(p.file_path));
    done++;
    onProgress?.(done, total);
  }
  await withTransaction(db, async (tx) => {
    await tx.execAsync('PRAGMA defer_foreign_keys = ON;');
    for (const name of [...TABLE_ORDER].reverse()) await tx.runAsync(`DELETE FROM ${name}`);
    await tx.runAsync('DELETE FROM settings');
    const insertAll = async (name: string, columns: readonly string[], rows: readonly (string | number | null)[][]) => {
      const perStatement = Math.max(1, Math.floor(MAX_BOUND_VALUES / columns.length));
      const one = `(${columns.map(() => '?').join(', ')})`;
      for (let i = 0; i < rows.length; i += perStatement) {
        const chunk = rows.slice(i, i + perStatement);
        await tx.runAsync(`INSERT INTO ${name} (${columns.join(', ')}) VALUES ${chunk.map(() => one).join(', ')}`, ...chunk.flat());
        done += chunk.length;
        onProgress?.(done, total);
      }
    };
    for (const name of TABLE_ORDER) {
      const columns = TABLES[name].columns.map((c) => c.name);
      await insertAll(name, columns, data[name].map((row) => columns.map((c) => (row[c] === undefined ? null : row[c]))));
    }
    await insertAll('settings', ['key', 'value'], settingEntries);
    const dangling = await tx.getAllAsync('PRAGMA foreign_key_check');
    if (dangling.length > 0) throw new Error(`Restore left ${dangling.length} dangling reference(s)`);
  });
  return { written };
}

export type RestoreOutcome = { ok: true; summary: BackupSummary; files: RestoreFiles } | { ok: false; error: BackupError };

/**
 * The whole restore path for the file text the picker returned: validate, then replace everything. A refused file
 * changes nothing (`ok: false`, nothing was written); a failure while writing throws and is rolled back. The UI shows
 * `parseBackup(...).summary` first and asks once before calling this.
 */
export async function restoreFromText(db: Db, fileText: string, files?: PhotoSink, restoreId?: string): Promise<RestoreOutcome> {
  const parsed = parseBackup(fileText);
  if (!parsed.ok) return parsed;
  const written = await restoreBackup(db, parsed.backup, undefined, files, restoreId);
  return { ok: true, summary: parsed.summary, files: written };
}

export type DataCounts = { projects: number; circuits: number; calculations: number; history: number; tables: number; photos: number };

/** What the database holds now (Backup screen, probes): saved calculations and history entries counted apart. */
export async function dataCounts(db: Db): Promise<DataCounts> {
  const row = await withRead(db, (r) =>
    r.getFirstAsync<DataCounts>(
      `SELECT (SELECT COUNT(*) FROM projects) AS projects, (SELECT COUNT(*) FROM circuits) AS circuits,
              (SELECT COUNT(*) FROM calculations WHERE project_id IS NOT NULL) AS calculations,
              (SELECT COUNT(*) FROM calculations WHERE project_id IS NULL) AS history,
              (SELECT COUNT(*) FROM cable_tables) AS tables, (SELECT COUNT(*) FROM photos) AS photos`
    )
  );
  return row ?? { projects: 0, circuits: 0, calculations: 0, history: 0, tables: 0, photos: 0 };
}
