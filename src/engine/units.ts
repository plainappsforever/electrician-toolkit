// Units (SPEC §7.0): AWG (−3 = 4/0 … 40) ↔ mm², kcmil ↔ mm², ft ↔ m, nearest standard sizes. Pure functions plus
// readers that turn a typed Length/Size into SI and record the conversion step.
import type { Profile } from './profiles';
import { type Builder, fieldVar, isRecord, leq, num, type Field } from './result';
import type { Length, Size } from './types';

/** 1 ft = 0.3048 m exactly. */
export const FOOT_M = 0.3048;
/** 1 kcmil = 1000 circular mils = 1000 · π/4 · (0.0254 mm)² = 0.506707479… mm². */
export const KCMIL_MM2 = (1000 * Math.PI * 0.0254 * 0.0254) / 4;

export const ftToM = (ft: number) => ft * FOOT_M;
export const mToFt = (m: number) => m / FOOT_M;
export const kcmilToMm2 = (kcmil: number) => kcmil * KCMIL_MM2;
export const mm2ToKcmil = (mm2: number) => mm2 / KCMIL_MM2;

/** AWG diameter, mm: d = 0.127 mm · 92^((36 − n)/39) (ASTM B258). */
export function awgDiameterMm(n: number): number {
  return 0.127 * Math.pow(92, (36 - n) / 39);
}
/** AWG cross-section, mm²: π/4 · d². */
export function awgAreaMm2(n: number): number {
  const d = awgDiameterMm(n);
  return (Math.PI / 4) * d * d;
}
/** The (real-valued) gauge whose area is `mm2`: inverse of awgAreaMm2. */
export function awgFromAreaMm2(mm2: number): number {
  const d = Math.sqrt((4 * mm2) / Math.PI);
  return 36 - (39 * Math.log(d / 0.127)) / Math.log(92);
}
/** "4/0" for −3, "1/0" for 0, else the number. */
export function awgLabel(n: number): string {
  return n <= 0 ? `${1 - n}/0` : String(n);
}

export function isAwg(n: number, profile: Profile): boolean {
  return Number.isInteger(n) && n >= profile.awgRange.min && n <= profile.awgRange.max;
}

// The bounds use the D37 tolerance (D55, M1): a value equal to a standard size within rel 1e−12 is that size on BOTH
// bounds, so a pasted full-precision AWG area maps back to its own gauge (SPEC §7.7).
/** Smallest metric standard size ≥ mm2 (undefined above the list). */
export function metricAtLeast(mm2: number, profile: Profile): number | undefined {
  return profile.metricSizesMm2.find((s) => leq(mm2, s));
}
/** Largest metric standard size ≤ mm2 (undefined below the list). */
export function metricAtMost(mm2: number, profile: Profile): number | undefined {
  return [...profile.metricSizesMm2].reverse().find((s) => leq(s, mm2));
}
/** Gauge of the smallest AWG size with area ≥ mm2 (undefined above 4/0). */
export function awgAtLeast(mm2: number, profile: Profile): number | undefined {
  return profile.awgGauges.find((n) => leq(mm2, awgAreaMm2(n)));
}
/** Gauge of the largest AWG size with area ≤ mm2 (undefined below AWG 40). */
export function awgAtMost(mm2: number, profile: Profile): number | undefined {
  return [...profile.awgGauges].reverse().find((n) => leq(awgAreaMm2(n), mm2));
}

/** Reads a typed Length → metres; records the ft → m step. */
export function readLength(b: Builder, raw: unknown, field: Field = 'length'): number | undefined {
  if (!isRecord(raw)) {
    b.error('input.missing', 'error.input.missing', { field: fieldVar(field) }, field);
    return undefined;
  }
  const unit = b.option(raw.unit, field, ['m', 'ft'] as const);
  const value = b.positive(raw.value, field);
  if (unit === undefined || value === undefined) return undefined;
  if (unit === 'm') return value;
  const m = ftToM(value);
  b.step('step.convert.ft', { ft: num(value, 'ft'), m: num(m, 'm') }, 'si-units');
  return m;
}

/** Reads a typed Size → mm²; records the AWG/kcmil → mm² step. `unit` tells the minimum-section list to use. */
export function readSize(
  b: Builder,
  raw: unknown,
  field: Field = 'size',
): { mm2: number; unit: Size['unit']; typed: number } | undefined {
  if (!isRecord(raw)) {
    b.error('input.missing', 'error.input.missing', { field: fieldVar(field) }, field);
    return undefined;
  }
  const unit = b.option(raw.unit, field, ['mm2', 'awg', 'kcmil'] as const);
  if (unit === undefined) return undefined;
  if (unit === 'awg') {
    const n = b.number(raw.value, field);
    if (n === undefined) return undefined;
    if (!isAwg(n, b.profile)) {
      b.error('input.awg', 'error.input.awg', { field: fieldVar(field) }, field);
      return undefined;
    }
    const d = awgDiameterMm(n);
    const mm2 = awgAreaMm2(n);
    b.step('step.convert.awg', { n: num(n, 'AWG'), d: num(d, 'mm'), s: num(mm2, 'mm²') }, 'astm-b258');
    return { mm2, unit, typed: n };
  }
  const value = b.positive(raw.value, field);
  if (value === undefined) return undefined;
  if (unit === 'mm2') return { mm2: value, unit, typed: value };
  const mm2 = kcmilToMm2(value);
  b.step('step.convert.kcmil', { k: num(value, 'kcmil'), s: num(mm2, 'mm²') }, 'astm-b258');
  return { mm2, unit, typed: value };
}

export type { Length, Size };
