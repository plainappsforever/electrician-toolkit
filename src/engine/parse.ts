// Input parsing (SPEC §13, D22, D26): decimal comma or point in every field, the device's decimal separator decides
// what a lone "," or "." means when it could be grouping (print-cost REVIEW_ENGINE #19 pattern), AWG sizes like "4/0".
// Returns doubles (D22); the engine validates ranges.

export type ParseConvention = 'en' | 'de';
export type ParseError = 'empty' | 'invalid' | 'negative';
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ParseError };

const SPACES = /[\s  ']/g;

/** The number convention from the DEVICE's decimal separator (expo-localization), falling back to the UI language. */
export function numberConvention(decimalSeparator: string | null | undefined, fallback: ParseConvention): ParseConvention {
  if (decimalSeparator === ',') return 'de';
  if (decimalSeparator === '.') return 'en';
  return fallback;
}

function groupedOk(intPart: string, sep: string): boolean {
  const groups = intPart.split(sep);
  return /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((g) => /^\d{3}$/.test(g));
}

/**
 * A decimal number typed by a person: `1,5` and `1.5` both mean 1.5. When both separators appear the last one is the
 * decimal separator (`1.234,5` / `1,234.5`). A lone separator is decimal, except the convention's grouping separator
 * followed by exactly three digits (`1,234` in en, `1.234` in de = 1234). Negative only with allowNegative
 * (temperatures). Exponents, units and other characters are refused.
 */
export function parseNumber(text: string, convention: ParseConvention = 'en', options: { allowNegative?: boolean } = {}): Parsed<number> {
  let s = String(text).replace(SPACES, '').replace(/^−/, '-');
  if (s === '') return { ok: false, error: 'empty' };
  let sign = 1;
  if (s.startsWith('-')) {
    if (!/^-[\d.,]+$/.test(s) || !/\d/.test(s)) return { ok: false, error: 'invalid' };
    if (!options.allowNegative) return { ok: false, error: 'negative' };
    sign = -1;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return { ok: false, error: 'invalid' };
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normal: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    const grp = dec === '.' ? ',' : '.';
    const i = s.lastIndexOf(dec);
    const intPart = s.slice(0, i);
    const frac = s.slice(i + 1);
    if (!/^\d*$/.test(frac) || !groupedOk(intPart, grp)) return { ok: false, error: 'invalid' };
    normal = `${intPart.split(grp).join('')}.${frac}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const grouping = convention === 'de' ? '.' : ',';
    if (parts.length > 2) {
      if (!groupedOk(s, sep)) return { ok: false, error: 'invalid' };
      normal = parts.join('');
    } else if (sep === grouping && /^[1-9]\d{0,2}$/.test(parts[0]) && /^\d{3}$/.test(parts[1])) {
      normal = parts.join('');
    } else {
      normal = `${parts[0] || '0'}.${parts[1]}`;
    }
  } else {
    normal = s;
  }
  const value = Number(normal);
  if (!Number.isFinite(value)) return { ok: false, error: 'invalid' };
  return { ok: true, value: sign * value || 0 };
}

/** AWG size as typed: "12", "1/0" … "4/0", "0", "00" … "0000" → gauge number (4/0 = −3). Range is checked by the engine. */
export function parseAwg(text: string): Parsed<number> {
  const s = String(text).replace(SPACES, '').toLowerCase().replace(/^awg/, '');
  if (s === '') return { ok: false, error: 'empty' };
  const slash = /^([1-9])\/0$/.exec(s);
  if (slash) return { ok: true, value: 1 - Number(slash[1]) };
  if (/^0{2,}$/.test(s)) return { ok: true, value: 1 - s.length };
  if (/^\d+$/.test(s)) return { ok: true, value: Number(s) };
  if (/^-/.test(s)) return { ok: false, error: 'negative' };
  return { ok: false, error: 'invalid' };
}
