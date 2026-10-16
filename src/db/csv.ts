// CSV: shared pure helpers (writer with formula-injection guard, reader) and the calculations export (SPEC §11, A12,
// D25). UTF-8 with BOM, `,` separator, CRLF line ends, `.` decimals, ISO dates. A TEXT cell that would start a formula
// (`= + - @`, tab, CR) gets a leading apostrophe (OWASP CSV injection); number cells are never guarded. `parseCsv`
// (any one-character delimiter, line numbers) is also used for the cable-table import.
import { usedInput } from '@/engine';
import { translate, type Language } from '@/i18n';
import { flattenInput, headlineValues, plainNumber } from '@/lib/calc-summary';

import { toStored, type StoredCalculation } from './calculations';
import { withRead } from './tx';
import type { Db } from './types';

export const CSV_BOM = '﻿';
const EOL = '\r\n';

// Leading apostrophes are counted so the guard is exactly reversible: guard("'=x") = "''=x". Leading whitespace and
// the full-width ＝＋－＠ are covered too (review #16, D65): restored backup text is not trimmed.
const NEEDS_GUARD = /^[\s']*[=+\-@\t\r\n＝＋－＠]/;

/** Formula-injection guard for a TEXT cell: a leading apostrophe makes spreadsheets read it as plain text. */
export function guardCell(value: string): string {
  return NEEDS_GUARD.test(value) ? `'${value}` : value;
}

/** Inverse of `guardCell`: strips the one apostrophe the guard added. */
export function unguardCell(value: string): string {
  return value.startsWith("'") && NEEDS_GUARD.test(value.slice(1)) ? value.slice(1) : value;
}

function quoteCell(cell: string, delimiter: string): string {
  return cell.includes(delimiter) || /["\r\n]/.test(cell) || cell !== cell.trim() ? `"${cell.replace(/"/g, '""')}"` : cell;
}

/** Header + rows of finished cell strings → CSV text with BOM and CRLF line ends. */
export function toCsv(header: readonly string[], rows: readonly (readonly string[])[], delimiter = ','): string {
  return CSV_BOM + [header, ...rows].map((r) => r.map((c) => quoteCell(c, delimiter)).join(delimiter)).join(EOL) + EOL;
}

export type CsvRecord = { /** 1-based line of the file on which the record starts. */ line: number; cells: string[] };

/** RFC 4180 reader: quoted cells with `""` escapes and line breaks inside, CRLF / LF / CR, BOM stripped, blank lines skipped. */
export function parseCsv(input: string, delimiter = ','): CsvRecord[] {
  const text = input.startsWith(CSV_BOM) ? input.slice(1) : input;
  const rows: CsvRecord[] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellStarted = false;
  let line = 1;
  let rowLine = 1;
  const endCell = () => {
    row.push(cell);
    cell = '';
    cellStarted = false;
  };
  const endRow = () => {
    endCell();
    if (!(row.length === 1 && row[0].trim() === '')) rows.push({ line: rowLine, cells: row });
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
    } else if (ch === delimiter) endCell();
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      line++;
      rowLine = line;
    } else {
      cell += ch;
      cellStarted = true;
    }
  }
  if (inQuotes) throw new Error(`CSV ends inside a quoted cell (started on line ${rowLine})`);
  if (cellStarted || cell !== '' || row.length > 0) endRow();
  return rows;
}

/**
 * `comma`: `,` between cells, `.` decimals (the default and the international form). `semicolon`: `;` between cells and a
 * decimal comma in every number, which is what Excel on a phone or PC set to a decimal-comma language (German) opens
 * directly. Same columns, same guard, same BOM and line ends.
 */
export type CsvFormat = 'comma' | 'semicolon';

/** The device's decimal separator decides (`,` → semicolon format); anything else → comma format. */
export function csvFormatFor(decimalSeparator: string | null | undefined): CsvFormat {
  return decimalSeparator === ',' ? 'semicolon' : 'comma';
}

/** 'electrician-toolkit-calculations-2026-10-01.csv' */
export function csvFileName(kind: 'calculations' | 'cable-table', today: string): string {
  return `electrician-toolkit-${kind}-${today}.csv`;
}

// ---------------------------------------------------------------- calculations.csv

export const CALCULATIONS_HEADER = [
  'project',
  'circuit',
  'kind',
  'title',
  'note',
  'created',
  'inputs',
  'key_results',
  'method',
  'limit_percent',
  'verdict',
  'engine_version',
  'profile_version',
] as const;

const isoDateTime = (ms: number) => new Date(ms).toISOString().slice(0, 19) + 'Z';
const text = (s: unknown): string => guardCell(typeof s === 'string' ? s : '');

/** One CSV row (cells already guarded / formatted) for a stored calculation. Never throws on a damaged result. */
export function calculationCsvRow(c: StoredCalculation, projectName: string, circuitLabel: string, format: CsvFormat = 'comma', language: Language = 'en'): string[] {
  const decimal = format === 'semicolon' ? ',' : '.';
  const results = headlineValues(c.kind, c.result).map((v) => `${v.name}=${plainNumber(v.value, decimal)}${v.unit ? ` ${v.unit}` : ''}`);
  const texts = c.result && typeof c.result.texts === 'object' && c.result.texts !== null ? c.result.texts : {};
  for (const name of ['minSize', 'suggestion', 'device', 'awg']) if (typeof texts[name] === 'string') results.push(`${name}=${decimal === ',' ? texts[name].replace(/(\d)\.(\d)/g, '$1,$2') : texts[name]}`);
  // v1.1 F1 (REVIEW_V1 #1): the smallest size is a voltage-drop-only answer; the file says so next to it, in the UI language
  if (c.kind === 'vdrop' && typeof texts.minSize === 'string') results.push(`minSizeScope=${translate(language, 'csv.minSizeScope')}`);
  const limit = c.result?.values?.limit;
  const method = typeof texts.method === 'string' ? texts.method : typeof texts.mode === 'string' ? texts.mode : '';
  return [
    text(projectName),
    text(circuitLabel),
    c.kind,
    text(c.title),
    text(c.note),
    isoDateTime(c.createdAt),
    text(flattenInput(usedInput(c.kind, c.input), decimal)), // only the inputs the engine used (D53)
    text(results.join('; ')),
    text(method),
    limit && typeof limit.value === 'number' && Number.isFinite(limit.value) ? plainNumber(limit.value, decimal) : '',
    text(typeof texts.verdict === 'string' ? texts.verdict : ''),
    text(c.engineVersion),
    text(c.profileVersion),
  ];
}

/**
 * calculations.csv for one project or for all projects: every saved calculation (history entries are not exported),
 * oldest first within a project. One consistent read.
 */
export async function exportCalculationsCsv(db: Db, scope: { projectId?: number } = {}, format: CsvFormat = 'comma', language: Language = 'en'): Promise<string> {
  const rows = await withRead(db, (r) =>
    r.getAllAsync<Parameters<typeof toStored>[0] & { project_name: string; circuit_label: string | null }>(
      `SELECT k.*, p.name AS project_name, c.label AS circuit_label
       FROM calculations k JOIN projects p ON p.id = k.project_id LEFT JOIN circuits c ON c.id = k.circuit_id
       ${scope.projectId === undefined ? '' : 'WHERE k.project_id = ?'}
       ORDER BY p.name COLLATE NOCASE, p.id, c.sort, c.id, k.created_at, k.id`,
      ...(scope.projectId === undefined ? [] : [scope.projectId])
    )
  );
  return toCsv(
    CALCULATIONS_HEADER,
    rows.map((r) => calculationCsvRow(toStored(r), r.project_name, r.circuit_label ?? '', format, language)),
    format === 'semicolon' ? ';' : ','
  );
}
