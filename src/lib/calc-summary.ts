// What a stored calculation is summarised by, shared by the CSV export and the report (D44). Pure, language-free:
// names are the engine's value/text ids; the report maps them to labels (`value.<name>` in i18n).
import type { CalcKind, CalcResult } from '@/engine';

/** Headline numeric values per calculator, in display order; only those present in a result are shown. */
export const HEADLINE_VALUES: Record<CalcKind, readonly string[]> = {
  vdrop: ['deltaUPercent', 'u', 'deltaULL', 'uEnd', 'powerLoss', 'lMax', 'minSizeMm2'],
  current: ['current', 'power', 'inputPower', 'apparentPower', 'reactivePower'],
  ohm: ['voltage', 'current', 'resistance', 'power'],
  coord: ['iz', 'in', 'i2', 'suggestedIn'],
  loop: ['zs', 'zsMax', 'measuredLimit', 'lMax', 'ik', 'ia'],
  resistance: ['r20', 'r', 'rPe', 'rLoop'],
  convert: ['diameterMm', 'mm2', 'kcmil', 'awgExact', 'ft', 'm'],
};

/**
 * The i18n key of a value's label. One value name can mean different things per calculator: `lMax` is the voltage-drop
 * limit in Voltage drop and the disconnection limit in Loop impedance (v1.1 F5, REVIEW_V1 #5), so a calculator-specific
 * key `value.<name>.<kind>` wins over the shared `value.<name>` (kept for old snapshots, D64).
 */
export function valueLabelKey(kind: string, name: string, has: (key: string) => boolean): string {
  const specific = `value.${name}.${kind}`;
  return has(specific) ? specific : `value.${name}`;
}

/** Headline values of a (possibly damaged) stored result: only well-formed numeric entries. */
export function headlineValues(kind: CalcKind, result: CalcResult | null): { name: string; value: number; unit: string }[] {
  const values = result && typeof result.values === 'object' && result.values !== null ? result.values : {};
  const out: { name: string; value: number; unit: string }[] = [];
  for (const name of HEADLINE_VALUES[kind] ?? []) {
    const v = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    if (v && typeof v.value === 'number' && Number.isFinite(v.value)) out.push({ name, value: v.value, unit: typeof v.unit === 'string' ? v.unit : '' });
  }
  return out;
}

/** A number as plain text: 10 significant digits, no trailing noise (0.1 + 0.2 → "0.3"); a point decimal unless `decimal` is ','. */
export function plainNumber(n: number, decimal: '.' | ',' = '.'): string {
  const text = String(Number(n.toPrecision(10)));
  return decimal === ',' ? text.replace('.', ',') : text;
}

/** "a=1; b.c=2": every stored input field, nested objects flattened with dots, SI values. Language-free. */
export function flattenInput(input: unknown, decimal: '.' | ',' = '.'): string {
  const parts: string[] = [];
  const walk = (value: unknown, path: string, depth: number) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'number') parts.push(`${path}=${Number.isFinite(value) ? plainNumber(value, decimal) : String(value)}`);
    else if (typeof value === 'string' || typeof value === 'boolean') parts.push(`${path}=${String(value)}`);
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, depth + 1));
    else if (typeof value === 'object' && depth < 6) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k, depth + 1);
    }
  };
  walk(input, '', 0);
  return parts.join('; ');
}
