// Engine entry point: compute(kind, input, profile) → CalcResult. Never throws (SPEC §7.0): invalid input → errors[],
// an unexpected exception → errors[{ code: 'internal' }]. Pure TypeScript; no React Native imports.
import { computeResistance } from './conductor';
import { computeConvert } from './convert';
import { computeCoord } from './coord';
import { computeLoop } from './loop';
import { computeCurrent, computeOhm } from './power';
import { EU_DE, type Profile } from './profiles';
import { Builder, text } from './result';
import { CALC_KINDS, type CalcInput, type CalcInputByKind, type CalcKind, type CalcResult } from './types';
import { usedInput } from './used';
import { computeVdrop } from './vdrop';

const RUNNERS: Record<CalcKind, (b: Builder, input: unknown) => void> = {
  vdrop: computeVdrop,
  current: computeCurrent,
  ohm: computeOhm,
  coord: computeCoord,
  loop: computeLoop,
  resistance: computeResistance,
  convert: computeConvert,
};

export function compute<K extends CalcKind>(kind: K, input: CalcInputByKind[K], profile?: Profile): CalcResult;
export function compute(kind: unknown, input: unknown, profile?: Profile): CalcResult;
export function compute(kind: unknown, input: unknown, profile: Profile = EU_DE): CalcResult {
  const k: CalcKind = CALC_KINDS.includes(kind as CalcKind) ? (kind as CalcKind) : 'convert';
  const b = new Builder(k, profile);
  if (k !== kind) {
    b.error('input.kind', 'error.input.option', { field: { kind: 'key', value: 'field.input' }, value: text(String(kind)) }, 'input');
    return { ...b.result(), kind: kind as CalcKind };
  }
  try {
    RUNNERS[k](b, input);
    const result = b.result();
    // A result must never carry a non-finite number (SPEC §7.0); treat one as an internal error, not a value.
    if (result.ok && Object.values(result.values).some((v) => !Number.isFinite(v.value))) {
      const fail = new Builder(k, profile);
      fail.error('internal', 'error.internal', {}, 'input');
      return fail.result();
    }
    // D53: the input as used — a JSON copy, so the result never shares objects with the caller's input
    if (result.ok) result.usedInput = JSON.parse(JSON.stringify(usedInput(k, input))) as CalcInput;
    return result;
  } catch {
    const fail = new Builder(k, profile);
    fail.error('internal', 'error.internal', {}, 'input');
    return fail.result();
  }
}

export { EU_DE };
export type { Profile };
export * from './types';
export { SOURCES, SOURCE_IDS, isSourceId, type Source, type SourceId, type Licence } from './sources';
export { PROFILES } from './profiles';
export { usedInput } from './used';
