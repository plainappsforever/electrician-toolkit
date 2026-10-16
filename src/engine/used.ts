// The input the engine actually used (review finding 2, D53, L26): the same calculator input without the fields the
// engine ignores for that system, mode or load source, and without fields it does not know. A saved calculation stores
// this (src/db/calculations.ts) and the report prints only this, so a PDF never lists a number that was not used —
// e.g. cos φ, η or X' on a DC voltage drop. Invariant (src/engine/used.test.ts, all oracle inputs):
// compute(kind, usedInput(kind, x)) equals compute(kind, x). Fields that were ignored but would have been rejected
// (an invalid X' on DC is still validated) are kept, so the invariant also holds for invalid input.
import { isRecord } from './result';
import type { CalcKind } from './types';

type Obj = Record<string, unknown>;
const has = (o: Obj, k: string) => o[k] !== undefined && o[k] !== null;
const finiteAtLeast0 = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;

function pick(o: Obj, keys: readonly string[]): Obj {
  const out: Obj = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined) out[k] = o[k];
  return out;
}

/** {value, unit} of a length/size; anything else is kept as given (the engine reports it). */
const quantity = (x: unknown) => (isRecord(x) ? pick(x, ['value', 'unit']) : x);

function device(x: unknown, need: 'coord' | 'loop'): unknown {
  if (!isRecord(x)) return x;
  if (x.type === 'mcb') return pick(x, ['type', 'curve', 'ratedCurrent']);
  if (x.type === 'other') return pick(x, need === 'coord' ? ['type', 'ratedCurrent', 'i2'] : ['type', 'ia']);
  return pick(x, ['type', 'curve', 'ratedCurrent', 'i2', 'ia']);
}

function withQuantities(o: Obj, keys: readonly string[]): Obj {
  const out = { ...o };
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(out, k)) out[k] = quantity(out[k]);
  return out;
}

const VDROP = ['system', 'voltage', 'current', 'power', 'efficiency', 'length', 'material', 'size', 'parallel', 'cosPhi', 'method', 'conductorTempC', 'insulation', 'reactanceOhmPerM', 'kappa', 'limitPercent', 'limitPreset'] as const;
const CURRENT = ['system', 'voltage', 'power', 'current', 'cosPhi', 'efficiency'] as const;
const OHM = ['voltage', 'current', 'resistance', 'power'] as const;
const COORD = ['ib', 'device', 'table', 'izTyped', 'insulationMaxC', 'referenceAmbientC', 'ambientC', 'fTheta', 'fGroup', 'fOther'] as const;
const TABLE_ROW = ['tableName', 'sourceNote', 'sizeMm2', 'izA', 'insulationMaxC', 'referenceAmbientC', 'material', 'methodLabel', 'loadedConductors'] as const;
const LOOP_BOTH = ['mode', 'u0', 'device', 'cmin'] as const;
const LOOP_CALCULATED = ['ze', 'material', 'lineSize', 'peSize', 'length', 'loopTempC'] as const;
const LOOP_MEASURED = ['zsMeasured', 'measuredFactor'] as const;
const RESISTANCE = ['material', 'size', 'length', 'temperatureC', 'parallel', 'peSize'] as const;
const CONVERT = ['from', 'value'] as const;

function vdrop(x: Obj): Obj {
  const o = withQuantities(pick(x, VDROP), ['length', 'size']);
  const hasI = has(o, 'current');
  const hasP = has(o, 'power');
  // η only turns a power into a current (§7.3); with a current given it is never read.
  if (hasI && !hasP) delete o.efficiency;
  if (o.system === 'dc') {
    delete o.cosPhi; // forced 1, never read (SPEC §13)
    if (finiteAtLeast0(o.reactanceOhmPerM)) delete o.reactanceOhmPerM; // X' = 0 for DC; an invalid one is still refused
  }
  // a typed conductor temperature replaces the insulation default; a valid insulation is then not used
  if (has(o, 'conductorTempC') && (o.insulation === 'pvc' || o.insulation === 'xlpe')) delete o.insulation;
  return o;
}

function current(x: Obj): Obj {
  const o = pick(x, CURRENT);
  if (o.system === 'dc') delete o.cosPhi;
  return o;
}

function ohm(x: Obj): Obj {
  return pick(x, OHM);
}

function coord(x: Obj): Obj {
  const o = pick(x, COORD);
  if (has(o, 'device')) o.device = device(o.device, 'coord');
  const table = isRecord(o.table) ? o.table : undefined;
  if (table) o.table = pick(table, TABLE_ROW);
  const typed = has(o, 'izTyped');
  if (table && !typed) {
    // Iz, θmax and θref come from the copied table row
    delete o.insulationMaxC;
    delete o.referenceAmbientC;
  }
  if (has(o, 'fTheta')) {
    // a typed f_θ wins: ambient and the two reference temperatures are not read
    delete o.ambientC;
    if (table || typed) {
      delete o.insulationMaxC;
      delete o.referenceAmbientC;
    }
  } else if (!has(o, 'ambientC') && (table || typed)) {
    // no ambient → f_θ = 1; the reference temperatures are not read
    delete o.insulationMaxC;
    delete o.referenceAmbientC;
  }
  return o;
}

function loop(x: Obj): Obj {
  const mode = x.mode === undefined || x.mode === null ? 'calculated' : x.mode;
  const keys = mode === 'calculated' ? [...LOOP_BOTH, ...LOOP_CALCULATED] : mode === 'measured' ? [...LOOP_BOTH, ...LOOP_MEASURED] : [...LOOP_BOTH, ...LOOP_CALCULATED, ...LOOP_MEASURED];
  const o = withQuantities(pick(x, keys), ['lineSize', 'peSize', 'length']);
  if (has(o, 'device')) o.device = device(o.device, 'loop');
  return o;
}

function resistance(x: Obj): Obj {
  return withQuantities(pick(x, RESISTANCE), ['size', 'peSize', 'length']);
}

function convert(x: Obj): Obj {
  return pick(x, CONVERT);
}

const BY_KIND: Record<CalcKind, (x: Obj) => Obj> = { vdrop, current, ohm, coord, loop, resistance, convert };

/** The input as the engine used it (see the file header). A non-object or an unknown kind is returned unchanged. */
export function usedInput(kind: CalcKind, input: unknown): unknown {
  if (!isRecord(input) || !Object.prototype.hasOwnProperty.call(BY_KIND, kind)) return input;
  return BY_KIND[kind](input);
}
