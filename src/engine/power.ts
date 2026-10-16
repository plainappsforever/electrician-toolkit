// Load current and power (SPEC §7.4). DC: I = P/(U·η); 1~: I = P/(U·cos φ·η); 3~: I = P/(√3·Un·cos φ·η).
// S = U·I (1~) or √3·Un·I (3~); P_in = S·cos φ; Q = S·sin φ. Ohm's law: any two of U, I, R, P.
import type { MessageKey } from '../i18n/en';
import { type Builder, isRecord, key, num } from './result';
import type { CurrentInput, OhmInput, System, Vars } from './types';

export const SYSTEMS: readonly System[] = ['dc', 'ac1', 'ac3'];

/** √3 for three-phase, 1 otherwise. */
export const phaseFactor = (system: System) => (system === 'ac3' ? Math.sqrt(3) : 1);

/** Reads cos φ: AC → (0, 1], default 1; DC → forced 1 (SPEC §13), whatever was typed. */
export function readCosPhi(b: Builder, system: System, raw: unknown): number | undefined {
  if (system === 'dc') {
    b.assume('assume.dc', {}, true, 'physics-power');
    return 1;
  }
  const isDefault = raw === undefined || raw === null;
  const cos = isDefault ? 1 : b.fraction(raw, 'cosPhi');
  if (cos === undefined) return undefined;
  b.assume('assume.cosPhi', { cos: num(cos, '') }, isDefault);
  return cos;
}

export function readEfficiency(b: Builder, raw: unknown): number | undefined {
  const isDefault = raw === undefined || raw === null;
  const eta = isDefault ? 1 : b.fraction(raw, 'efficiency');
  if (eta === undefined) return undefined;
  b.assume('assume.efficiency', { eta: num(eta, '') }, isDefault);
  return eta;
}

function loadVars(system: System, u: number, i: number, p: number, cos: number, eta: number): Vars {
  const vars: Vars = { p: num(p, 'W'), u: num(u, 'V'), eta: num(eta, ''), i: num(i, 'A') };
  if (system !== 'dc') vars.cos = num(cos, '');
  return vars;
}

/** I from rated output power, with its step. */
export function currentFromPower(b: Builder, system: System, u: number, p: number, cos: number, eta: number): number {
  const i = p / (phaseFactor(system) * u * cos * eta);
  b.step(`step.current.${system}`, loadVars(system, u, i, p, cos, eta), 'physics-power');
  b.value('current', i, 'A', `step.current.${system}`, 'physics-power');
  return i;
}

/** Rated output P from I, with its step. */
export function powerFromCurrent(b: Builder, system: System, u: number, i: number, cos: number, eta: number): number {
  const p = phaseFactor(system) * u * i * cos * eta;
  b.step(`step.power.${system}`, loadVars(system, u, i, p, cos, eta), 'physics-power');
  b.value('power', p, 'W', `step.power.${system}`, 'physics-power');
  return p;
}

/** Exactly one of current / power must be given. */
export function readLoad(b: Builder, rawCurrent: unknown, rawPower: unknown): { current?: number; power?: number } | undefined {
  const hasI = rawCurrent !== undefined && rawCurrent !== null;
  const hasP = rawPower !== undefined && rawPower !== null;
  if (hasI === hasP) {
    b.error('input.oneOf', 'error.input.oneOf', { a: key('field.current'), b: key('field.power') }, 'current');
    return undefined;
  }
  if (hasI) {
    const current = b.positive(rawCurrent, 'current');
    return current === undefined ? undefined : { current };
  }
  const power = b.positive(rawPower, 'power');
  return power === undefined ? undefined : { power };
}

export function computeCurrent(b: Builder, raw: unknown) {
  if (!isRecord(raw)) return b.error('input.missing', 'error.input.missing', { field: key('field.input') }, 'input');
  const input = raw as Partial<Record<keyof CurrentInput, unknown>>;
  const system = b.option(input.system, 'system', SYSTEMS);
  const u = b.positive(input.voltage, 'voltage');
  const load = readLoad(b, input.current, input.power);
  if (b.failed || system === undefined || u === undefined || !load) return;
  const cos = readCosPhi(b, system, input.cosPhi);
  const eta = readEfficiency(b, input.efficiency);
  if (cos === undefined || eta === undefined) return;
  if (system === 'ac3') b.assume('assume.ac3.balanced', {}, false, 'physics-power');

  const i = load.current !== undefined ? load.current : currentFromPower(b, system, u, load.power!, cos, eta);
  if (load.current !== undefined) {
    b.value('current', i, 'A', 'field.current', 'physics-power');
    powerFromCurrent(b, system, u, i, cos, eta);
  } else {
    b.value('power', load.power!, 'W', 'field.power', 'physics-power');
  }
  const s = phaseFactor(system) * u * i;
  if (system === 'dc') {
    b.step('step.inputPower.dc', { u: num(u, 'V'), i: num(i, 'A'), pin: num(s, 'W') }, 'physics-power');
    b.value('inputPower', s, 'W', 'step.inputPower.dc', 'physics-power');
  } else {
    const sin = Math.sqrt(1 - cos * cos);
    b.step(`step.apparent.${system}`, { u: num(u, 'V'), i: num(i, 'A'), s: num(s, 'VA') }, 'physics-power');
    b.value('apparentPower', s, 'VA', `step.apparent.${system}`, 'physics-power');
    b.step('step.inputPower.ac', { s: num(s, 'VA'), cos: num(cos, ''), pin: num(s * cos, 'W') }, 'physics-power');
    b.value('inputPower', s * cos, 'W', 'step.inputPower.ac', 'physics-power');
    b.step('step.reactive', { s: num(s, 'VA'), sin: num(sin, ''), q: num(s * sin, 'var') }, 'physics-power');
    b.value('reactivePower', s * sin, 'var', 'step.reactive', 'physics-power');
  }
  if (i > b.profile.typicalRange.currentA) b.warn('range.current', 'warn.range.current', { max: num(b.profile.typicalRange.currentA, 'A') });
}

export function computeOhm(b: Builder, raw: unknown) {
  if (!isRecord(raw)) return b.error('input.missing', 'error.input.missing', { field: key('field.input') }, 'input');
  const input = raw as Partial<Record<keyof OhmInput, unknown>>;
  const given = (['voltage', 'current', 'resistance', 'power'] as const).filter((f) => input[f] !== undefined && input[f] !== null);
  if (given.length !== 2) return b.error('ohm.needTwo', 'error.ohm.needTwo', {}, 'input');
  const v: Partial<Record<(typeof given)[number], number>> = {};
  for (const f of given) {
    const x = b.positive(input[f], f);
    if (x !== undefined) v[f] = x;
  }
  if (b.failed) return;
  let { voltage: u, current: i, resistance: r, power: p } = v;
  const pair = given.join('+');
  switch (pair) {
    case 'voltage+current':
      r = u! / i!;
      p = u! * i!;
      break;
    case 'voltage+resistance':
      i = u! / r!;
      p = (u! * u!) / r!;
      break;
    case 'voltage+power':
      i = p! / u!;
      r = (u! * u!) / p!;
      break;
    case 'current+resistance':
      u = i! * r!;
      p = i! * i! * r!;
      break;
    case 'current+power':
      u = p! / i!;
      r = p! / (i! * i!);
      break;
    case 'resistance+power':
      u = Math.sqrt(p! * r!);
      i = Math.sqrt(p! / r!);
      break;
  }
  const vars = { u: num(u!, 'V'), i: num(i!, 'A'), r: num(r!, 'Ω'), p: num(p!, 'W') };
  const stepKey = `step.ohm.${given[0]}.${given[1]}` as MessageKey;
  b.step(stepKey, vars, 'physics-power');
  b.assume('assume.ohm.resistive', {}, false, 'physics-power');
  b.value('voltage', u!, 'V', stepKey, 'physics-power');
  b.value('current', i!, 'A', stepKey, 'physics-power');
  b.value('resistance', r!, 'Ω', stepKey, 'physics-power');
  b.value('power', p!, 'W', stepKey, 'physics-power');
  // SPEC §13 "I > 10 kA → warning" applies to every calculator (D55, M3): 230 V / 0.01 Ω = 23 kA is the case it is for
  if (i! > b.profile.typicalRange.currentA) b.warn('range.current', 'warn.range.current', { max: num(b.profile.typicalRange.currentA, 'A') });
}
