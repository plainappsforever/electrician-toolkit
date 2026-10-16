// Small helpers shared by the repositories: one error type with a stable code (the UI shows its own text per code),
// text validation and LIKE escaping.
export type DataErrorCode =
  | 'invalid'
  | 'not_found'
  | 'not_saveable'
  | 'wrong_project'
  | 'duplicate';

export class DataError extends Error {
  constructor(
    readonly code: DataErrorCode,
    readonly field: string,
    detail: string
  ) {
    super(`${field}: ${detail}`);
    this.name = 'DataError';
  }
}

/** Trimmed text of 1…max characters (required) or 0…max (optional); throws DataError('invalid'). */
export function cleanText(field: string, value: unknown, max: number, required: boolean): string {
  if (typeof value !== 'string') throw new DataError('invalid', field, 'is not text');
  const v = value.trim();
  if (required && v === '') throw new DataError('invalid', field, 'is required');
  if (v.length > max) throw new DataError('invalid', field, `is longer than ${max} characters`);
  return v;
}

/** Escapes `%`, `_` and the escape character itself for `LIKE ? ESCAPE '\'`. */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export const flag = (b: boolean): 0 | 1 => (b ? 1 : 0);
