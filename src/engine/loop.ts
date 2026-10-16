// Loop impedance and disconnection in TN systems (SPEC §7.6, D19) — IEC 60364-4-41 411.4.4 / DIN VDE 0100-410.
//   R'_loop = ρθ · (1/S_L + 1/S_PE)   Zs = Ze + R'_loop · L (reactance neglected)   Zs_max = Cmin · U0 / Ia
//   check Zs ≤ Zs_max   L_max = (Zs_max − Ze) / R'_loop   Ik = Cmin · U0 / Zs
//   Measured mode: limit = Zs_max · k_meas (default 2/3), check Zs_measured ≤ limit.
//   Ia = 5/10/20 · In for MCB B/C/D (upper limit of the instantaneous range), typed for other devices.
import { rhoAtWithStep, readMaterial } from './conductor';
import { readDevice } from './coord';
import { type Builder, isRecord, key, leq, num, text } from './result';
import type { LoopInput, Material } from './types';
import { readLength, readSize } from './units';

export function computeLoop(b: Builder, raw: unknown) {
  if (!isRecord(raw)) return b.error('input.missing', 'error.input.missing', { field: key('field.input') }, 'input');
  const input = raw as Partial<Record<keyof LoopInput, unknown>>;
  const p = b.profile;
  const mode = b.optionalOption(input.mode, 'mode', ['calculated', 'measured'] as const, 'calculated');
  const u0Default = input.u0 === undefined || input.u0 === null;
  const u0 = u0Default ? p.loop.u0 : b.positive(input.u0, 'u0');
  const cminDefault = input.cmin === undefined || input.cmin === null;
  const cmin = cminDefault ? p.loop.cmin : b.fraction(input.cmin, 'cmin');
  const dev = readDevice(b, input.device, 'loop');
  if (b.failed || !mode || u0 === undefined || cmin === undefined || !dev) return;

  // ---- Ia and Zs_max (both modes) ----
  let ia: number;
  if (dev.kind === 'mcb') {
    const mult = p.mcbTripMultiple[dev.curve];
    ia = mult * dev.inA;
    b.assume('assume.loop.mcbIa', { curve: text(dev.curve), m: num(mult, '') }, false, 'iec60898-1');
    b.step('step.loop.ia', { m: num(mult, ''), in: num(dev.inA, 'A'), ia: num(ia, 'A') }, 'iec60898-1');
    b.value('ia', ia, 'A', 'step.loop.ia', 'iec60898-1');
    b.setText('device', `${dev.curve}${dev.inA}`);
  } else {
    ia = dev.ia!;
    b.assume('assume.loop.otherIa', { ia: num(ia, 'A') }, false);
    b.value('ia', ia, 'A', 'field.ia', 'iec60364-4-41-411.4.4');
  }
  b.assume('assume.loop.tn', {}, false, 'iec60364-4-41-411.4.4');
  b.assume('assume.loop.time', {}, false, 'iec60364-4-41-t41.1');
  b.assume('assume.loop.u0', { u0: num(u0, 'V') }, u0Default);
  // v1.1 F9 (REVIEW_V1 #9, D89): the default Cmin 1 stays until someone with the licensed standard confirms the edition's
  // value; the default says so in the assumption itself (a typed Cmin keeps the plain line)
  b.assume(cminDefault ? 'assume.loop.cmin.default' : 'assume.loop.cmin', { cmin: num(cmin, '') }, cminDefault, 'iec60364-4-41-411.4.4');
  const zsMax = (cmin * u0) / ia;
  b.step('step.loop.zsMax', { cmin: num(cmin, ''), u0: num(u0, 'V'), ia: num(ia, 'A'), zsmax: num(zsMax, 'Ω') }, 'iec60364-4-41-411.4.4');
  b.value('zsMax', zsMax, 'Ω', 'step.loop.zsMax', 'iec60364-4-41-411.4.4');
  b.setText('mode', mode);

  if (mode === 'measured') {
    const zs = b.positive(input.zsMeasured, 'zsMeasured');
    const kDefault = input.measuredFactor === undefined || input.measuredFactor === null;
    const k = kDefault ? p.loop.measuredFactor : b.fraction(input.measuredFactor, 'measuredFactor');
    if (zs === undefined || k === undefined) return;
    b.assume('assume.loop.measured', { k: num(k, '') }, kDefault, 'measured-factor');
    const limit = zsMax * k;
    b.step('step.loop.measuredLimit', { zsmax: num(zsMax, 'Ω'), k: num(k, ''), lim: num(limit, 'Ω') }, 'measured-factor');
    b.value('zs', zs, 'Ω', 'field.zsMeasured', 'measured-factor');
    b.value('measuredLimit', limit, 'Ω', 'step.loop.measuredLimit', 'measured-factor');
    const met = leq(zs, limit);
    b.check('loop.measured', met, met ? 'check.loop.measured.met' : 'check.loop.measured.notMet', { zs: num(zs, 'Ω'), lim: num(limit, 'Ω') }, 'measured-factor');
    b.setText('verdict', met ? 'met' : 'notMet');
    const ik = (cmin * u0) / zs;
    b.step('step.loop.ik', { cmin: num(cmin, ''), u0: num(u0, 'V'), zs: num(zs, 'Ω'), ik: num(ik, 'A') }, 'iec60364-4-41-411.4.4');
    b.value('ik', ik, 'A', 'step.loop.ik', 'iec60364-4-41-411.4.4');
    return;
  }

  // ---- calculated mode ----
  const ze = b.nonNegative(input.ze, 'ze');
  const c = readMaterial(b, input.material);
  const sL = readSize(b, input.lineSize, 'lineSize');
  const sPe = readSize(b, input.peSize, 'peSize');
  const length = readLength(b, input.length);
  const thetaDefault = input.loopTempC === undefined || input.loopTempC === null;
  const theta = thetaDefault ? p.loop.thetaC : b.number(input.loopTempC, 'loopTemp');
  if (b.failed || ze === undefined || !c || !sL || !sPe || length === undefined || theta === undefined) return;
  const rho = rhoAtWithStep(b, input.material as Material, theta, thetaDefault, 'loopTemp');
  if (rho === undefined) return;
  b.value('rhoTheta', rho, 'Ω·mm²/m', 'step.rho.theta', 'physics-resistance');
  b.assume('assume.loop.ze', { ze: num(ze, 'Ω') }, false);
  b.assume('assume.loop.noReactance', {}, false);
  b.assume('assume.length.oneWay', {}, false);

  const rPrime = rho * (1 / sL.mm2 + 1 / sPe.mm2);
  b.step('step.loop.rPrime', { rho: num(rho, 'Ω·mm²/m'), sl: num(sL.mm2, 'mm²'), spe: num(sPe.mm2, 'mm²'), r: num(rPrime, 'Ω/m') }, 'physics-resistance');
  b.value('rPrime', rPrime, 'Ω/m', 'step.loop.rPrime', 'physics-resistance');
  const zs = ze + rPrime * length;
  b.step('step.loop.zs', { ze: num(ze, 'Ω'), r: num(rPrime, 'Ω/m'), l: num(length, 'm'), zs: num(zs, 'Ω') }, 'iec60364-4-41-411.4.4');
  b.value('zs', zs, 'Ω', 'step.loop.zs', 'iec60364-4-41-411.4.4');
  const met = leq(zs, zsMax);
  b.check('loop.zs', met, met ? 'check.loop.met' : 'check.loop.notMet', { zs: num(zs, 'Ω'), zsmax: num(zsMax, 'Ω') }, 'iec60364-4-41-411.4.4');
  b.setText('verdict', met ? 'met' : 'notMet');

  if (ze >= zsMax) {
    // SPEC §7.6/§13: "Ze alone exceeds the limit" — no maximum length; Zs and the check above still stand.
    b.warn('loop.zeExceeds', 'warn.loop.zeExceeds', { ze: num(ze, 'Ω'), zsmax: num(zsMax, 'Ω') });
  } else {
    const lMax = (zsMax - ze) / rPrime;
    b.step('step.loop.lMax', { zsmax: num(zsMax, 'Ω'), ze: num(ze, 'Ω'), r: num(rPrime, 'Ω/m'), lmax: num(lMax, 'm') }, 'iec60364-4-41-411.4.4');
    b.value('lMax', lMax, 'm', 'step.loop.lMax', 'iec60364-4-41-411.4.4');
  }
  const ik = (cmin * u0) / zs;
  b.step('step.loop.ik', { cmin: num(cmin, ''), u0: num(u0, 'V'), zs: num(zs, 'Ω'), ik: num(ik, 'A') }, 'iec60364-4-41-411.4.4');
  b.value('ik', ik, 'A', 'step.loop.ik', 'iec60364-4-41-411.4.4');
  // v1.1 F4 (REVIEW_V1 #4): the same criterion seen from the current side, spelled out. Ik ≥ Ia ⇔ Zs ≤ Zs_max (both are
  // Cmin·U0 divided by the other), so it carries the Zs verdict itself and can never disagree with it.
  b.check('loop.ik', met, met ? 'check.loop.ik.met' : 'check.loop.ik.notMet', { ik: num(ik, 'A'), ia: num(ia, 'A') }, 'iec60364-4-41-411.4.4');
  if (length > p.typicalRange.lengthM) b.warn('range.length', 'warn.range.length', { max: num(p.typicalRange.lengthM, 'm') });
}
