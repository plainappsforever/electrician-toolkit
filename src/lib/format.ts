// Display formatting (D22): results keep full precision in the engine and in saved snapshots; only the text a person
// reads is rounded here. `formatNumber` has the signature `explain()` accepts, so the working shows the same rounding as
// the result card and the report. Locale: German → de-DE (decimal comma), else en-GB (decimal point).
import type { Unit, Var, Vars } from '@/engine';
import { explain, isMessageKey } from '@/engine/explain';
import { COMPARE_REL_TOL, leq } from '@/engine/result';
import { awgLabel } from '@/engine/units';
import type { Language, MessageKey } from '@/i18n';

export type Rounding = { decimals: number } | { significant: number };

/** D22: % to 3 significant digits (3.76), V and A to 0.01, Ω to 0.001, lengths to 0.1; the rest generously. */
export const ROUNDING: Record<Unit, Rounding> = {
  '': { decimals: 4 },
  V: { decimals: 2 },
  A: { decimals: 2 },
  'Ω': { decimals: 3 },
  'Ω/m': { significant: 6 },
  '%': { significant: 3 },
  m: { decimals: 1 },
  ft: { decimals: 1 },
  mm: { decimals: 3 },
  'mm²': { decimals: 3 },
  kcmil: { decimals: 2 },
  AWG: { decimals: 2 },
  W: { decimals: 2 },
  VA: { decimals: 2 },
  var: { decimals: 2 },
  '°C': { decimals: 1 },
  'Ω·mm²/m': { significant: 6 },
  '1/K': { significant: 6 },
  'm/(Ω·mm²)': { significant: 4 },
};

export const localeOf = (language: Language) => (language === 'de' ? 'de-DE' : 'en-GB');

/** A number rounded for display (no unit); trailing zeros are dropped, −0 is shown as 0. */
export function formatPlain(value: number, unit: Unit, language: Language): string {
  if (!Number.isFinite(value)) return String(value);
  const rule = ROUNDING[unit] ?? { significant: 6 };
  const options: Intl.NumberFormatOptions =
    'decimals' in rule ? { minimumFractionDigits: 0, maximumFractionDigits: rule.decimals } : { maximumSignificantDigits: rule.significant };
  const text = new Intl.NumberFormat(localeOf(language), { ...options, useGrouping: false }).format(value);
  return /^[-−]?0(?:[.,]0+)?$/.test(text) ? '0' : text;
}

/** With its unit: "3.76 %", "8.64 V", "AWG 4/0". Pass as `formatNumber` to `explain()`. */
export function formatNumber(value: number, unit: Unit, language: Language): string {
  if (unit === 'AWG') return `AWG ${awgLabel(value)}`;
  const n = formatPlain(value, unit, language);
  return unit === '' ? n : `${n} ${unit}`;
}

// ---------------------------------------------------------------- conservative display (D52, review finding 1)
// A displayed maximum must never lie above the true one, and a displayed quantity that is compared with a maximum must
// never lie below the true one: upper limits (L_max, Zs_max, the measured limit, 1.45·Iz, Iz) are rounded DOWN, the
// values checked against them (Δu, u, Zs, I2) are rounded UP. In a check text, when the two rounded numbers look equal
// (or their order contradicts the verdict) while the true numbers differ, digits are added until they no longer do.
// Two numbers that are equal within the D37 tolerance are shown equal (nearest rounding), as the verdict treats them.
// Minimums work the other way round: Ik (must reach Ia) is rounded down, Ia up (v1.1 F4, D87).

export type Direction = 'up' | 'down';

/** Headline values with a direction (by the engine's value name); every other value is rounded to nearest. */
export const VALUE_DIRECTION: Record<string, Direction> = {
  lMax: 'down',
  zsMax: 'down',
  measuredLimit: 'down',
  i2Limit: 'down',
  iz: 'down',
  uEnd: 'down',
  deltaUPercent: 'up',
  u: 'up',
  deltaULL: 'up',
  zs: 'up',
  i2: 'up',
  // v1.1 F4 (REVIEW_V1 #4): Ik must reach Ia (a minimum), so Ik is shown rounded DOWN and Ia UP — "Ik 80 A" next to
  // "Ia 80 A" can no longer appear while the check says not met (true Ik 79.9992 A shows as 79.99 A)
  ik: 'down',
  ia: 'up',
};

/** Placeholders with a direction, per message key (steps, checks, warnings). */
export const VAR_DIRECTION: Partial<Record<MessageKey, Record<string, Direction>>> = {
  'step.vdrop.percent': { pct: 'up' },
  'step.vdrop.lmax': { lmax: 'down' },
  'step.vdrop.minSize': { pct: 'up', limit: 'down' },
  'step.vdrop.minSize.smaller': { pct: 'up', limit: 'down' },
  'step.vdrop.compare': { pct: 'up' },
  'warn.method.disagree': { pct: 'up' },
  'check.vdrop.within': { pct: 'up', limit: 'down' },
  'check.vdrop.exceeds': { pct: 'up', limit: 'down' },
  'step.coord.iz': { iz: 'down' },
  'step.coord.i2': { i2: 'up' },
  'step.coord.suggestion': { iz: 'down', i2: 'up', lim: 'down' },
  'check.coord.c1': { ib: 'up', in: 'down' },
  'check.coord.c2': { in: 'up', iz: 'down' },
  'check.coord.c3': { i2: 'up', iz: 'down', lim: 'down' },
  'step.loop.zsMax': { zsmax: 'down' },
  'step.loop.measuredLimit': { zsmax: 'down', lim: 'down' },
  'step.loop.zs': { zs: 'up' },
  'step.loop.lMax': { zsmax: 'down', lmax: 'down' },
  'check.loop.met': { zs: 'up', zsmax: 'down' },
  'check.loop.notMet': { zs: 'up', zsmax: 'down' },
  'check.loop.measured.met': { zs: 'up', lim: 'down' },
  'check.loop.measured.notMet': { zs: 'up', lim: 'down' },
  'step.loop.ik': { ik: 'down' },
  'check.loop.ik.met': { ik: 'down', ia: 'up' },
  'check.loop.ik.notMet': { ik: 'down', ia: 'up' },
  'warn.loop.zeExceeds': { ze: 'up', zsmax: 'down' },
};

type Relation = 'le' | 'gt' | 'ge' | 'verdict';
/** Pairs whose displayed order must agree with the relation: `verdict` = "≤" when the item is met, else ">". */
export const COMPARED_PAIRS: Partial<Record<MessageKey, { value: string; limit: string; relation: Relation }>> = {
  'check.vdrop.within': { value: 'pct', limit: 'limit', relation: 'le' },
  'check.vdrop.exceeds': { value: 'pct', limit: 'limit', relation: 'gt' },
  'step.vdrop.minSize': { value: 'pct', limit: 'limit', relation: 'le' },
  'step.vdrop.minSize.smaller': { value: 'pct', limit: 'limit', relation: 'gt' },
  'check.coord.c1': { value: 'ib', limit: 'in', relation: 'verdict' },
  'check.coord.c2': { value: 'in', limit: 'iz', relation: 'verdict' },
  'check.coord.c3': { value: 'i2', limit: 'lim', relation: 'verdict' },
  'check.loop.met': { value: 'zs', limit: 'zsmax', relation: 'le' },
  'check.loop.notMet': { value: 'zs', limit: 'zsmax', relation: 'gt' },
  'check.loop.measured.met': { value: 'zs', limit: 'lim', relation: 'le' },
  'check.loop.measured.notMet': { value: 'zs', limit: 'lim', relation: 'gt' },
  'warn.loop.zeExceeds': { value: 'ze', limit: 'zsmax', relation: 'ge' },
  // Ik ≥ Ia written as "Ia ≤ Ik": Ia is the quantity rounded up, Ik the one rounded down; digits are added until they differ
  'check.loop.ik.met': { value: 'ia', limit: 'ik', relation: 'le' },
  'check.loop.ik.notMet': { value: 'ia', limit: 'ik', relation: 'gt' },
};

/**
 * Extra digits for a placeholder that is an intermediate of a product in the same text (v1.1, REVIEW_V1 #17): C3 prints
 * "1.45 × Iz = lim"; Iz rounded down to 0.01 A (14.96 for 14.9666) did not multiply out to the printed product (21.7).
 */
export const VAR_EXTRA: Partial<Record<MessageKey, Record<string, number>>> = {
  'check.coord.c3': { iz: 1 },
};

/**
 * A check whose stored key prints "≤" between its two numbers reads as a false inequality when it is NOT met
 * ("16 A ≤ 14.96 A — not met", REVIEW_V1 #17). The display uses a ">" twin key then (stored keys never change, D64).
 */
export const NOT_MET_TEXT: Partial<Record<MessageKey, MessageKey>> = {
  'check.coord.c1': 'check.coord.c1.notMet',
  'check.coord.c2': 'check.coord.c2.notMet',
  'check.coord.c3': 'check.coord.c3.notMet',
};

/** Most digits a check text adds to separate two numbers that look equal. */
export const MAX_EXTRA_DIGITS = 6;

/** Decimal places of a rule for this value (a significant-digit rule depends on the magnitude); may be negative. */
function decimalsFor(value: number, unit: Unit): number {
  const rule = ROUNDING[unit] ?? { significant: 6 };
  if ('decimals' in rule) return rule.decimals;
  if (value === 0) return rule.significant - 1;
  return rule.significant - 1 - Math.floor(Math.log10(Math.abs(value)));
}

/** `value` rounded to `decimals` places in a direction; a value already on the grid within D37 is kept. */
function roundTo(value: number, decimals: number, direction: Direction | 'nearest'): number {
  const scale = 10 ** Math.abs(decimals);
  const scaled = decimals >= 0 ? value * scale : value / scale;
  const nearest = Math.round(scaled);
  let k: number;
  if (Math.abs(scaled - nearest) <= COMPARE_REL_TOL * Math.abs(scaled)) k = nearest;
  else k = direction === 'up' ? Math.ceil(scaled) : direction === 'down' ? Math.floor(scaled) : nearest;
  return decimals >= 0 ? k / scale : k * scale;
}

function render(rounded: number, decimals: number, unit: Unit, language: Language): string {
  if (unit === 'AWG') return `AWG ${awgLabel(rounded)}`;
  const text = new Intl.NumberFormat(localeOf(language), {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.max(0, Math.min(20, decimals)),
    useGrouping: false,
  }).format(rounded);
  const n = /^[-−]?0(?:[.,]0+)?$/.test(text) ? '0' : text;
  return unit === '' ? n : `${n} ${unit}`;
}

/** A number with its unit, rounded in a direction (`extra` = digits beyond the D50 rule). */
export function formatDirected(value: number, unit: Unit, direction: Direction | 'nearest', language: Language, extra = 0): string {
  if (!Number.isFinite(value) || unit === 'AWG') return formatNumber(value, unit, language);
  if (direction === 'nearest' && extra === 0) return formatNumber(value, unit, language);
  const decimals = decimalsFor(value, unit) + extra;
  return render(roundTo(value, decimals, direction), decimals, unit, language);
}

/** A headline value by its engine name (`lMax`, `zs` …): maxima rounded down, checked quantities up (D52). */
export function formatValue(name: string, value: number, unit: Unit, language: Language): string {
  return formatDirected(value, unit, VALUE_DIRECTION[name] ?? 'nearest', language);
}

const sameWithinTolerance = (a: number, b: number) => leq(a, b) && leq(b, a);

/** The two numbers of a comparison as text, so that their displayed order agrees with `relation`. */
export function formatComparedPair(
  value: { value: number; unit: Unit },
  limit: { value: number; unit: Unit },
  relation: 'le' | 'gt' | 'ge',
  language: Language
): [string, string] {
  if (sameWithinTolerance(value.value, limit.value)) return [formatNumber(value.value, value.unit, language), formatNumber(limit.value, limit.unit, language)];
  for (let extra = 0; extra <= MAX_EXTRA_DIGITS; extra++) {
    const dv = decimalsFor(value.value, value.unit) + extra;
    const dl = decimalsFor(limit.value, limit.unit) + extra;
    const v = roundTo(value.value, dv, 'up');
    const l = roundTo(limit.value, dl, 'down');
    // the numbers really differ here, so equal-looking text is never right; the order must match the relation
    const ok = relation === 'le' ? v < l : v > l;
    if (ok) return [render(v, dv, value.unit, language), render(l, dl, limit.unit, language)];
  }
  // only a value within 1e−(digits+6) of its limit gets here: show both to nearest with the extra digits
  return [formatDirected(value.value, value.unit, 'nearest', language, MAX_EXTRA_DIGITS), formatDirected(limit.value, limit.unit, 'nearest', language, MAX_EXTRA_DIGITS)];
}

const isNumVar = (v: Var | undefined): v is Extract<Var, { kind: 'num' }> =>
  !!v && typeof v === 'object' && v.kind === 'num' && typeof v.value === 'number' && Number.isFinite(v.value);

/**
 * The display text of a step, assumption, check, warning or error (D52): `explain()` with directed rounding for maxima
 * and the quantities compared with them, and check texts whose numbers never contradict their verdict. Use this, not
 * `explain(…, formatNumber)`, wherever a person reads a result (screens, report).
 */
export function displayText(item: { key: string; vars: Vars; met?: unknown }, language: Language): string {
  if (!isMessageKey(item.key)) return item.key;
  const key = item.key;
  const directions = VAR_DIRECTION[key] ?? {};
  const extras = VAR_EXTRA[key] ?? {};
  const vars: Vars = {};
  for (const [name, v] of Object.entries(item.vars ?? {})) {
    const direction = directions[name];
    vars[name] = direction && isNumVar(v) ? { kind: 'text', value: formatDirected(v.value, v.unit, direction, language, extras[name] ?? 0) } : v;
  }
  const pair = COMPARED_PAIRS[key];
  const a = pair ? item.vars?.[pair.value] : undefined;
  const b = pair ? item.vars?.[pair.limit] : undefined;
  if (pair && isNumVar(a) && isNumVar(b)) {
    let relation: 'le' | 'gt' | 'ge';
    if (pair.relation !== 'verdict') relation = pair.relation;
    else {
      const metVar = item.vars?.met;
      const met = metVar && metVar.kind === 'key' ? metVar.value === 'verdict.met' : item.met === true;
      relation = met ? 'le' : 'gt';
    }
    const [va, vb] = relation === 'ge' ? formatComparedPair(a, b, 'gt', language) : formatComparedPair(a, b, relation, language);
    vars[pair.value] = { kind: 'text', value: va };
    vars[pair.limit] = { kind: 'text', value: vb };
  }
  const metVar = item.vars?.met;
  const notMet = item.met === false || (metVar !== undefined && metVar.kind === 'key' && metVar.value === 'verdict.notMet');
  return explain({ key: (notMet && NOT_MET_TEXT[key]) || key, vars }, language, formatNumber);
}

/** `YYYY-MM-DD` (en) or `DD.MM.YYYY` (de) in the device's time zone. */
export function formatDate(ms: number, language: Language): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return language === 'de' ? `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}` : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `YYYY-MM-DD` in the device's time zone, for file names. */
export function isoDate(ms: number): string {
  return formatDate(ms, 'en');
}

/**
 * A file-name stem from user text: ASCII letters and digits and the Latin letters of À–ɏ (umlauts, ß, accents) are
 * kept, everything else becomes `-`; no path characters survive. (No `\p{L}`: not every JS engine in the app has it.)
 */
export function safeFileStem(text: string, fallback = 'report'): string {
  const stem = text
    .normalize('NFC')
    .replace(/[^A-Za-z0-9\u00C0-\u024F]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return stem === '' ? fallback : stem;
}

/** `<project>-<YYYY-MM-DD>.pdf` (SPEC §12). */
export function reportFileName(title: string, ms: number): string {
  return `${safeFileStem(title)}-${isoDate(ms)}.pdf`;
}
