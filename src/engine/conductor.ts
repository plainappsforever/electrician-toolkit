// Conductor resistance (SPEC §7.2): ρθ = ρ20·(1 + α20·(θ − 20)), R = ρθ·L/S_eff, loop = 2·R or R_L + R_PE.
import type { MessageKey } from '../i18n/en';
import type { MaterialConstants, Profile } from './profiles';
import { type Builder, isRecord, key, num } from './result';
import type { Material, ResistanceInput } from './types';
import { readLength, readSize } from './units';

export const MATERIALS: readonly Material[] = ['cu', 'al'];
export const materialKey = (m: Material): MessageKey => `material.${m}`;

/** ρθ, Ω·mm²/m. */
export function rhoAt(c: MaterialConstants, thetaC: number): number {
  return c.rho20 * (1 + c.alpha20 * (thetaC - 20));
}

/** Reads the material; unsupported → error (no result). */
export function readMaterial(b: Builder, raw: unknown): MaterialConstants | undefined {
  if (raw === undefined || raw === null) {
    b.error('input.missing', 'error.input.missing', { field: key('field.material') }, 'material');
    return undefined;
  }
  if (typeof raw !== 'string' || !MATERIALS.includes(raw as Material)) {
    b.error('input.material', 'error.input.material', { value: { kind: 'text', value: String(raw) } }, 'material');
    return undefined;
  }
  return b.profile.materials[raw as Material];
}

/** ρθ with its assumption and step; error when the temperature gives no positive resistivity. */
export function rhoAtWithStep(
  b: Builder,
  material: Material,
  thetaC: number,
  isDefault: boolean,
  field: 'conductorTemp' | 'loopTemp' | 'temperature',
): number | undefined {
  const c = b.profile.materials[material];
  const rho = rhoAt(c, thetaC);
  if (!(rho > 0)) {
    b.error('input.temperature', 'error.input.temperature', { theta: num(thetaC, '°C') }, field);
    return undefined;
  }
  b.assume('assume.material.constants', materialVars(material, c), false, c.rho20Source);
  if (c.alpha20Source !== c.rho20Source) b.assume('assume.material.alpha', { alpha: num(c.alpha20, '1/K') }, false, c.alpha20Source);
  b.assume('assume.conductorTemp', { theta: num(thetaC, '°C') }, isDefault);
  b.step(
    'step.rho.theta',
    { rho20: num(c.rho20, 'Ω·mm²/m'), alpha: num(c.alpha20, '1/K'), theta: num(thetaC, '°C'), rho: num(rho, 'Ω·mm²/m') },
    'physics-resistance',
  );
  return rho;
}

export function materialVars(material: Material, c: MaterialConstants) {
  return { material: key(materialKey(material)), rho20: num(c.rho20, 'Ω·mm²/m'), alpha: num(c.alpha20, '1/K') };
}

export function computeResistance(b: Builder, raw: unknown) {
  if (!isRecord(raw)) return b.error('input.missing', 'error.input.missing', { field: key('field.input') }, 'input');
  const input = raw as Partial<Record<keyof ResistanceInput, unknown>>;
  const p: Profile = b.profile;
  const c = readMaterial(b, input.material);
  const size = readSize(b, input.size, 'size');
  const length = readLength(b, input.length, 'length');
  const n = b.count(input.parallel, 'parallel', 1);
  const thetaDefault = p.conductorTempC[p.defaultInsulation];
  const theta = b.optionalNumber(input.temperatureC, 'temperature', thetaDefault);
  const pe = input.peSize === undefined || input.peSize === null ? undefined : readSize(b, input.peSize, 'peSize');
  if (b.failed || !c || !size || length === undefined || n === undefined || theta === undefined) return;
  if (input.peSize !== undefined && input.peSize !== null && !pe) return;
  const material = input.material as Material;
  const rho = rhoAtWithStep(b, material, theta, input.temperatureC === undefined || input.temperatureC === null, 'temperature');
  if (rho === undefined) return;

  const sEff = n * size.mm2;
  if (n > 1) {
    b.assume('assume.parallel', { n: num(n, '') }, false);
    b.step('step.parallel.s', { n: num(n, ''), s: num(size.mm2, 'mm²'), seff: num(sEff, 'mm²') }, 'physics-resistance');
  }
  b.value('rho20', c.rho20, 'Ω·mm²/m', 'assume.material.constants', c.rho20Source);
  b.value('rhoTheta', rho, 'Ω·mm²/m', 'step.rho.theta', 'physics-resistance');
  b.value('sEff', sEff, 'mm²', 'step.parallel.s', 'physics-resistance');
  const r20 = (c.rho20 * length) / sEff;
  b.step('step.r20', { rho: num(c.rho20, 'Ω·mm²/m'), l: num(length, 'm'), s: num(sEff, 'mm²'), r: num(r20, 'Ω') }, 'physics-resistance');
  b.value('r20', r20, 'Ω', 'step.r20', 'physics-resistance');
  const r = (rho * length) / sEff;
  b.step('step.r', { rho: num(rho, 'Ω·mm²/m'), l: num(length, 'm'), s: num(sEff, 'mm²'), r: num(r, 'Ω') }, 'physics-resistance');
  b.value('r', r, 'Ω', 'step.r', 'physics-resistance');
  b.assume('assume.length.oneWay', {}, false);
  if (pe) {
    const rPe = (rho * length) / pe.mm2;
    b.step('step.r.pe', { rho: num(rho, 'Ω·mm²/m'), l: num(length, 'm'), s: num(pe.mm2, 'mm²'), r: num(rPe, 'Ω') }, 'physics-resistance');
    b.value('rPe', rPe, 'Ω', 'step.r.pe', 'physics-resistance');
    const loop = r + rPe;
    b.step('step.r.loop.pe', { rl: num(r, 'Ω'), rpe: num(rPe, 'Ω'), loop: num(loop, 'Ω') }, 'physics-resistance');
    b.value('rLoop', loop, 'Ω', 'step.r.loop.pe', 'physics-resistance');
  } else {
    const loop = 2 * r;
    b.step('step.r.loop', { r: num(r, 'Ω'), loop: num(loop, 'Ω') }, 'physics-resistance');
    b.value('rLoop', loop, 'Ω', 'step.r.loop', 'physics-resistance');
  }
  if (length > p.typicalRange.lengthM) b.warn('range.length', 'warn.range.length', { max: num(p.typicalRange.lengthM, 'm') });
}
