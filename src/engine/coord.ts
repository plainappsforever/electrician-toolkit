// Protective-device coordination (SPEC §7.5, D14, D15) — IEC 60364-4-43 cl. 433.1 / DIN VDE 0100-430.
//   f_θ = √((θmax − θa)/(θmax − θref))   (computed, overridable)       Iz = Iz_table · f_θ · f_group · f_other
//   C1 Ib ≤ In · C2 In ≤ Iz · C3 I2 ≤ 1.45·Iz (I2 = 1.45·In for MCBs; typed for other devices)
//   Suggestion (MCB only): smallest preferred In of the same curve with Ib ≤ In ≤ Iz and 1.45·In ≤ 1.45·Iz.
// Iz comes from the user's own table row or is typed — no licensed table ships (D14).
import { type Builder, type Field, isRecord, key, leq, num, text } from './result';
import type { CoordInput, McbCurve } from './types';

export const MCB_CURVES: readonly McbCurve[] = ['B', 'C', 'D'];

type Device = { kind: 'mcb'; curve: McbCurve; inA: number; i2: number } | { kind: 'other'; inA: number; i2: number };

/** Reads an MCB (In must be a preferred rating) or another device. `need` says which typed values "other" requires. */
export function readDevice(b: Builder, raw: unknown, need: 'coord' | 'loop'):
  | { kind: 'mcb'; curve: McbCurve; inA: number }
  | { kind: 'other'; inA?: number; i2?: number; ia?: number }
  | undefined {
  if (!isRecord(raw)) {
    b.error('input.missing', 'error.input.missing', { field: key('field.device') }, 'device');
    return undefined;
  }
  const type = b.option(raw.type, 'device', ['mcb', 'other'] as const);
  if (type === undefined) return undefined;
  if (type === 'mcb') {
    const curve = b.option(raw.curve, 'curve', MCB_CURVES);
    const inA = b.positive(raw.ratedCurrent, 'ratedCurrent');
    if (curve === undefined || inA === undefined) return undefined;
    if (!b.profile.mcbRatingsA.includes(inA)) {
      b.error('input.rating', 'error.input.rating', { value: num(inA, 'A') }, 'ratedCurrent');
      return undefined;
    }
    return { kind: 'mcb', curve, inA };
  }
  if (need === 'coord') {
    const inA = b.positive(raw.ratedCurrent, 'ratedCurrent');
    const i2 = b.positive(raw.i2, 'i2');
    if (inA === undefined || i2 === undefined) return undefined;
    return { kind: 'other', inA, i2 };
  }
  const ia = b.positive(raw.ia, 'ia');
  return ia === undefined ? undefined : { kind: 'other', ia };
}

function factor(b: Builder, raw: unknown, field: Field): { value: number; isDefault: boolean } | undefined {
  if (raw === undefined || raw === null) return { value: 1, isDefault: true };
  const v = b.number(raw, field);
  if (v === undefined) return undefined;
  if (!(v > 0 && v <= b.profile.maxFactor)) {
    b.error('coord.factor', 'error.coord.factor', { field: key(`field.${field}`), max: num(b.profile.maxFactor, '') }, field);
    return undefined;
  }
  return { value: v, isDefault: false };
}

export function computeCoord(b: Builder, raw: unknown) {
  if (!isRecord(raw)) return b.error('input.missing', 'error.input.missing', { field: key('field.input') }, 'input');
  const input = raw as Partial<Record<keyof CoordInput, unknown>>;
  const p = b.profile;
  const ib = b.positive(input.ib, 'ib');
  const dev = readDevice(b, input.device, 'coord');

  // Iz_table: the user's table row (copied in) or a typed value.
  const table = isRecord(input.table) ? input.table : undefined;
  if (input.table !== undefined && input.table !== null && !table) b.error('input.notNumber', 'error.input.notNumber', { field: key('field.iz') }, 'iz');
  const hasTyped = input.izTyped !== undefined && input.izTyped !== null;
  if (!table === !hasTyped && !b.failed) b.error('coord.izSource', 'error.coord.izSource', {}, 'iz');
  const izTable = table ? b.positive(table.izA, 'iz') : hasTyped ? b.positive(input.izTyped, 'iz') : undefined;
  const thetaMaxRaw = table ? table.insulationMaxC : input.insulationMaxC;
  const thetaRefRaw = table ? table.referenceAmbientC : input.referenceAmbientC;

  // f_θ: typed → used; ambient given → computed; neither → 1 (ambient = reference).
  let fTheta: { value: number; mode: 'typed' | 'computed' | 'default' } | undefined;
  let thetas: { max: number; ref: number; a: number } | undefined;
  if (input.fTheta !== undefined && input.fTheta !== null) {
    const f = factor(b, input.fTheta, 'fTheta');
    if (f) fTheta = { value: f.value, mode: 'typed' };
  } else if (input.ambientC !== undefined && input.ambientC !== null) {
    const a = b.number(input.ambientC, 'ambient');
    const max = b.number(thetaMaxRaw, 'insulationMax');
    const ref = b.number(thetaRefRaw, 'referenceAmbient');
    if (a !== undefined && max !== undefined && ref !== undefined) {
      if (!(ref < max)) b.error('coord.reference', 'error.coord.reference', { ref: num(ref, '°C'), max: num(max, '°C') }, 'referenceAmbient');
      else if (!(a < max)) b.error('coord.ambient', 'error.coord.ambient', { a: num(a, '°C'), max: num(max, '°C') }, 'ambient');
      else {
        const f = Math.sqrt((max - a) / (max - ref));
        if (!(f <= p.maxFactor)) b.error('coord.factor', 'error.coord.factor', { field: key('field.fTheta'), max: num(p.maxFactor, '') }, 'fTheta');
        else {
          fTheta = { value: f, mode: 'computed' };
          thetas = { max, ref, a };
        }
      }
    }
  } else {
    fTheta = { value: 1, mode: 'default' };
  }
  const fGroup = factor(b, input.fGroup, 'fGroup');
  const fOther = factor(b, input.fOther, 'fOther');
  if (b.failed || ib === undefined || !dev || izTable === undefined || !fTheta || !fGroup || !fOther) return;

  const device: Device =
    dev.kind === 'mcb'
      ? { kind: 'mcb', curve: dev.curve, inA: dev.inA, i2: p.mcbI2Factor * dev.inA }
      : { kind: 'other', inA: dev.inA!, i2: dev.i2! };

  // ---- assumptions ----
  if (table) {
    b.assume(
      'assume.coord.table',
      {
        name: text(typeof table.tableName === 'string' ? table.tableName : ''),
        note: text(typeof table.sourceNote === 'string' ? table.sourceNote : ''),
        size: num(typeof table.sizeMm2 === 'number' ? table.sizeMm2 : 0, 'mm²'),
        iz: num(izTable, 'A'),
      },
      false,
    );
  } else {
    b.assume('assume.coord.izTyped', { iz: num(izTable, 'A') }, false);
  }
  if (fTheta.mode === 'computed') {
    b.assume('assume.coord.fTheta.computed', {}, false, 'heat-balance');
    b.step('step.coord.fTheta', { max: num(thetas!.max, '°C'), a: num(thetas!.a, '°C'), ref: num(thetas!.ref, '°C'), f: num(fTheta.value, '') }, 'heat-balance');
  } else if (fTheta.mode === 'typed') {
    b.assume('assume.coord.fTheta.typed', { f: num(fTheta.value, '') }, false);
  } else {
    b.assume('assume.coord.fTheta.default', {}, true);
  }
  b.value('fTheta', fTheta.value, '', fTheta.mode === 'computed' ? 'step.coord.fTheta' : 'field.fTheta', 'heat-balance');
  if (fGroup.isDefault) b.assume('assume.coord.fGroup.default', {}, true);
  else b.assume('assume.coord.fGroup', { f: num(fGroup.value, '') }, false);
  if (!fOther.isDefault) b.assume('assume.coord.fOther', { f: num(fOther.value, '') }, false);
  b.value('fGroup', fGroup.value, '', 'field.fGroup', 'iec60364-4-43-433.1');
  b.value('fOther', fOther.value, '', 'field.fOther', 'iec60364-4-43-433.1');

  // ---- Iz and I2 ----
  const iz = izTable * fTheta.value * fGroup.value * fOther.value;
  b.step('step.coord.iz', { izt: num(izTable, 'A'), ft: num(fTheta.value, ''), fg: num(fGroup.value, ''), fo: num(fOther.value, ''), iz: num(iz, 'A') }, 'iec60364-4-43-433.1');
  b.value('izTable', izTable, 'A', 'field.iz', 'iec60364-4-43-433.1');
  b.value('iz', iz, 'A', 'step.coord.iz', 'iec60364-4-43-433.1');
  b.value('ib', ib, 'A', 'field.ib', 'iec60364-4-43-433.1');
  b.value('in', device.inA, 'A', 'field.ratedCurrent', device.kind === 'mcb' ? 'iec60898-1' : 'iec60364-4-43-433.1');
  if (device.kind === 'mcb') {
    b.assume('assume.coord.mcbI2', { f: num(p.mcbI2Factor, '') }, false, 'iec60898-1');
    b.step('step.coord.i2', { f: num(p.mcbI2Factor, ''), in: num(device.inA, 'A'), i2: num(device.i2, 'A') }, 'iec60898-1');
    b.value('i2', device.i2, 'A', 'step.coord.i2', 'iec60898-1');
    b.setText('device', `${device.curve}${device.inA}`);
  } else {
    b.assume('assume.coord.otherI2', { i2: num(device.i2, 'A') }, false);
    b.value('i2', device.i2, 'A', 'field.i2', 'iec60364-4-43-433.1');
  }
  const i2Limit = p.coordI2Factor * iz;
  b.value('i2Limit', i2Limit, 'A', 'check.coord.c3', 'iec60364-4-43-433.1');

  // ---- checks ----
  const c1 = leq(ib, device.inA);
  const c2 = leq(device.inA, iz);
  const c3 = leq(device.i2, i2Limit);
  const src = 'iec60364-4-43-433.1';
  b.check('coord.c1', c1, 'check.coord.c1', { ib: num(ib, 'A'), in: num(device.inA, 'A'), met: key(c1 ? 'verdict.met' : 'verdict.notMet') }, src);
  b.check('coord.c2', c2, 'check.coord.c2', { in: num(device.inA, 'A'), iz: num(iz, 'A'), met: key(c2 ? 'verdict.met' : 'verdict.notMet') }, src);
  b.check('coord.c3', c3, 'check.coord.c3', { i2: num(device.i2, 'A'), f: num(p.coordI2Factor, ''), iz: num(iz, 'A'), lim: num(i2Limit, 'A'), met: key(c3 ? 'verdict.met' : 'verdict.notMet') }, src);
  b.setText('verdict', c1 && c2 && c3 ? 'met' : 'notMet');

  // ---- suggestion (MCB only) ----
  if (device.kind === 'mcb') {
    const fit = p.mcbRatingsA.find((r) => leq(ib, r) && leq(r, iz) && leq(p.mcbI2Factor * r, i2Limit));
    if (fit === undefined) {
      b.warn('coord.noRating', 'warn.coord.noRating');
    } else {
      const label = `${device.curve}${fit}`;
      b.setText('suggestion', label);
      b.value('suggestedIn', fit, 'A', 'step.coord.suggestion', 'iec60898-1');
      b.value('suggestedI2', p.mcbI2Factor * fit, 'A', 'step.coord.suggestion', 'iec60898-1');
      b.step('step.coord.suggestion', { device: text(label), ib: num(ib, 'A'), in: num(fit, 'A'), iz: num(iz, 'A'), i2: num(p.mcbI2Factor * fit, 'A'), lim: num(i2Limit, 'A') }, 'iec60898-1');
      // v1.1 F6 (REVIEW_V1 #6): the suggestion answers overload coordination only
      b.assume('assume.coord.suggestionScope', {}, false, 'iec60364-4-43-433.1');
    }
  } else {
    b.assume('assume.coord.otherNoSuggestion', {}, false);
  }
  if (ib > p.typicalRange.currentA) b.warn('range.current', 'warn.range.current', { max: num(p.typicalRange.currentA, 'A') });
}
