// Voltage drop (SPEC §7.3, D17, D18): three methods, end voltage, loss, verdict against the user's limit, minimum
// standard size, maximum length, and the method comparison (honest-result rule: opposite verdicts → warning).
//   u = b · (ρ_m · L/S_eff · cos φ + X'/n · L · sin φ) · I     b = 2 (DC, 1~), 1 (3~); S_eff = n·S
//   Δu % = 100 · u / U0                                         U0 = U (DC, 1~), Un/√3 (3~)
//   L_max = limit · U0 / (100 · b · I · (ρ_m/S_eff · cos φ + X'/n · sin φ))
//   M1 Annex G: ρ_m = ρ1, X' = λ · M2 physics: ρ_m = ρθ, X' typed · M3 κ: ρ_m = 1/κ, X' typed
import type { MessageKey } from '../i18n/en';
import { materialKey, readMaterial, rhoAt, rhoAtWithStep } from './conductor';
import { currentFromPower, phaseFactor, readCosPhi, readEfficiency, readLoad, SYSTEMS } from './power';
import type { MaterialConstants } from './profiles';
import { type Builder, isRecord, key, leq, num, text } from './result';
import type { Insulation, Material, Size, System, VdropInput, VdropMethod } from './types';
import { awgAreaMm2, awgLabel, readLength, readSize } from './units';

export const VDROP_METHODS: readonly VdropMethod[] = ['M1', 'M2', 'M3'];
export const INSULATIONS: readonly Insulation[] = ['pvc', 'xlpe'];

type Ctx = {
  system: System;
  /** 2 for DC/1~, 1 for 3~. */
  bFactor: number;
  u: number;
  u0: number;
  i: number;
  lengthM: number;
  n: number;
  cos: number;
  sin: number;
  c: MaterialConstants;
  thetaC: number;
  kappa: number;
  /** Typed/default X' (Ω/m) for M2/M3; 0 for DC. */
  xUser: number;
  /** Annex G λ (Ω/m) for M1; 0 for DC. */
  xAnnexG: number;
};

/** ρ_m of a method, Ω·mm²/m. */
export function methodRho(ctx: Ctx, method: VdropMethod): number {
  if (method === 'M1') return ctx.c.rhoAnnexG;
  if (method === 'M2') return rhoAt(ctx.c, ctx.thetaC);
  return 1 / ctx.kappa;
}
/** Reactance per metre of ONE conductor of the method before dividing by n, Ω/m. */
export function methodX(ctx: Ctx, method: VdropMethod): number {
  return method === 'M1' ? ctx.xAnnexG : ctx.xUser;
}
/** Δu % at a given cross-section (mm², single conductor) — the same expression for the result, min section and comparison. */
export function percentAt(ctx: Ctx, method: VdropMethod, sizeMm2: number): number {
  const sEff = ctx.n * sizeMm2;
  const r = (methodRho(ctx, method) * ctx.lengthM) / sEff;
  const u = ctx.bFactor * (r * ctx.cos + (methodX(ctx, method) / ctx.n) * ctx.lengthM * ctx.sin) * ctx.i;
  return (100 * u) / ctx.u0;
}

function limitLabel(id: string | undefined): MessageKey {
  return id === undefined ? 'limit.custom' : (`limit.${id}` as MessageKey);
}

export function computeVdrop(b: Builder, raw: unknown) {
  if (!isRecord(raw)) return b.error('input.missing', 'error.input.missing', { field: key('field.input') }, 'input');
  const input = raw as Partial<Record<keyof VdropInput, unknown>>;
  const p = b.profile;

  // ---- validation (every method's parameters, because the comparison evaluates all three) ----
  const system = b.option(input.system, 'system', SYSTEMS);
  const u = b.positive(input.voltage, 'voltage');
  const load = readLoad(b, input.current, input.power);
  const c = readMaterial(b, input.material);
  const method = b.optionalOption(input.method, 'method', VDROP_METHODS, 'M1');
  const insulation = b.optionalOption(input.insulation, 'insulation', INSULATIONS, p.defaultInsulation);
  const thetaDefault = insulation ? p.conductorTempC[insulation] : 70;
  const thetaC = b.optionalNumber(input.conductorTempC, 'conductorTemp', thetaDefault);
  const xRaw = input.reactanceOhmPerM;
  const xUser = xRaw === undefined || xRaw === null ? p.defaultReactanceOhmPerM : b.nonNegative(xRaw, 'reactance');
  const kappaDefault = c ? c.kappa : 1;
  const kappa = input.kappa === undefined || input.kappa === null ? kappaDefault : b.positive(input.kappa, 'kappa');
  const limit = b.fraction(input.limitPercent, 'limit', 100);
  let preset: (typeof p.limitPresets)[number] | undefined;
  if (input.limitPreset !== undefined && input.limitPreset !== null) {
    preset = p.limitPresets.find((x) => x.id === input.limitPreset);
    if (!preset) b.error('input.option', 'error.input.option', { field: key('field.limitPreset'), value: text(String(input.limitPreset)) }, 'limitPreset');
    else if (limit !== undefined && preset.percent !== limit)
      b.error('input.limitPreset', 'error.input.limitPreset', { limit: num(limit, '%'), preset: num(preset.percent, '%') }, 'limit');
  }
  if (b.failed || !system || u === undefined || !load || !c || !method || thetaC === undefined || xUser === undefined || kappa === undefined || limit === undefined) {
    // read the remaining fields anyway so every input error is listed at once
    readLength(b, input.length);
    readSize(b, input.size);
    b.count(input.parallel, 'parallel', 1);
    return;
  }
  const material = input.material as Material;
  const lengthM = readLength(b, input.length);
  const size = readSize(b, input.size);
  const n = b.count(input.parallel, 'parallel', 1);
  const cos = readCosPhi(b, system, input.cosPhi);
  const eta = load.power !== undefined ? readEfficiency(b, input.efficiency) : 1;
  if (b.failed || lengthM === undefined || !size || n === undefined || cos === undefined || eta === undefined) return;
  if (!(rhoAt(c, thetaC) > 0)) {
    return b.error('input.temperature', 'error.input.temperature', { theta: num(thetaC, '°C') }, 'conductorTemp');
  }

  // ---- setup ----
  const bFactor = system === 'ac3' ? 1 : 2;
  b.setText('method', method);
  b.assume('assume.length.oneWay', {}, false);
  if (system === 'ac3') {
    b.assume('assume.ac3.balanced', {}, false, 'physics-power');
    b.assume('assume.vdrop.u0.ac3', {}, false, 'iec60364-5-52-G');
  }
  const u0 = u / phaseFactor(system);
  if (system === 'ac3') b.step('step.vdrop.u0', { un: num(u, 'V'), u0: num(u0, 'V') }, 'iec60364-5-52-G');
  b.value('u0', u0, 'V', system === 'ac3' ? 'step.vdrop.u0' : 'field.voltage', 'iec60364-5-52-G');

  const i = load.current !== undefined ? load.current : currentFromPower(b, system, u, load.power!, cos, eta);
  if (load.current !== undefined) b.value('current', i, 'A', 'field.current', 'physics-power');

  const sin = system === 'dc' ? 0 : Math.sqrt(1 - cos * cos);
  const ctx: Ctx = {
    system,
    bFactor,
    u,
    u0,
    i,
    lengthM,
    n,
    cos,
    sin,
    c,
    thetaC,
    kappa,
    xUser: system === 'dc' ? 0 : xUser,
    xAnnexG: system === 'dc' ? 0 : p.annexGReactanceOhmPerM,
  };

  // ---- the selected method, step by step ----
  const sEff = n * size.mm2;
  if (n > 1) {
    b.assume('assume.parallel', { n: num(n, '') }, false);
    b.step('step.parallel.s', { n: num(n, ''), s: num(size.mm2, 'mm²'), seff: num(sEff, 'mm²') }, 'physics-resistance');
  }
  b.value('sEff', sEff, 'mm²', 'step.parallel.s', 'physics-resistance');

  let rho: number;
  if (method === 'M1') {
    rho = c.rhoAnnexG;
    b.assume('assume.vdrop.m1', { material: key(materialKey(material)), rho: num(rho, 'Ω·mm²/m'), x: num(p.annexGReactanceOhmPerM, 'Ω/m') }, false, 'iec60364-5-52-G');
    b.step('step.vdrop.rho.m1', { rho: num(rho, 'Ω·mm²/m') }, 'iec60364-5-52-G');
    b.value('rho', rho, 'Ω·mm²/m', 'step.vdrop.rho.m1', 'iec60364-5-52-G');
  } else if (method === 'M2') {
    const isDefault = input.conductorTempC === undefined || input.conductorTempC === null;
    rho = rhoAtWithStep(b, material, thetaC, isDefault, 'conductorTemp')!;
    if (isDefault) b.assume('assume.insulation', { insulation: key(`insulation.${insulation!}`), theta: num(thetaC, '°C') }, true);
    b.value('rho', rho, 'Ω·mm²/m', 'step.rho.theta', 'physics-resistance');
  } else {
    rho = 1 / kappa;
    b.assume('assume.kappa', { kappa: num(kappa, 'm/(Ω·mm²)'), material: key(materialKey(material)) }, input.kappa === undefined || input.kappa === null, 'de-practice-kappa');
    b.step('step.vdrop.rho.m3', { kappa: num(kappa, 'm/(Ω·mm²)'), rho: num(rho, 'Ω·mm²/m') }, 'de-practice-kappa');
    b.value('rho', rho, 'Ω·mm²/m', 'step.vdrop.rho.m3', 'de-practice-kappa');
  }
  const xPerM = methodX(ctx, method);
  if (system !== 'dc' && method !== 'M1') {
    b.assume('assume.reactance', { x: num(xUser, 'Ω/m') }, xRaw === undefined || xRaw === null, 'iec60364-5-52-G');
  }
  const xEff = xPerM / n;
  b.value('reactance', xEff, 'Ω/m', 'step.vdrop.u', method === 'M1' ? 'iec60364-5-52-G' : 'physics-resistance');

  const r = (rho * lengthM) / sEff;
  b.step('step.r', { rho: num(rho, 'Ω·mm²/m'), l: num(lengthM, 'm'), s: num(sEff, 'mm²'), r: num(r, 'Ω') }, 'physics-resistance');
  b.value('r', r, 'Ω', 'step.r', 'physics-resistance');
  if (system !== 'dc') {
    b.step('step.sin', { cos: num(cos, ''), sin: num(sin, '') }, 'physics-power');
    b.value('sinPhi', sin, '', 'step.sin', 'physics-power');
  }
  const uDrop = bFactor * (r * cos + xEff * lengthM * sin) * i;
  const vdropSource = method === 'M1' ? 'iec60364-5-52-G' : method === 'M2' ? 'physics-resistance' : 'de-practice-kappa';
  b.step(
    'step.vdrop.u',
    { b: num(bFactor, ''), r: num(r, 'Ω'), cos: num(cos, ''), x: num(xEff, 'Ω/m'), l: num(lengthM, 'm'), sin: num(sin, ''), i: num(i, 'A'), u: num(uDrop, 'V') },
    vdropSource,
  );
  b.value('u', uDrop, 'V', 'step.vdrop.u', vdropSource);
  const pct = (100 * uDrop) / u0;
  b.step('step.vdrop.percent', { u: num(uDrop, 'V'), u0: num(u0, 'V'), pct: num(pct, '%') }, 'iec60364-5-52-G');
  b.value('deltaUPercent', pct, '%', 'step.vdrop.percent', 'iec60364-5-52-G');

  if (system === 'ac3') {
    const ull = Math.sqrt(3) * uDrop;
    b.step('step.vdrop.ull', { u: num(uDrop, 'V'), ull: num(ull, 'V') }, 'physics-power');
    b.value('deltaULL', ull, 'V', 'step.vdrop.ull', 'physics-power');
    const uEnd = u - ull;
    b.step('step.vdrop.uend.ac3', { un: num(u, 'V'), ull: num(ull, 'V'), uend: num(uEnd, 'V') }, 'physics-power');
    b.value('uEnd', uEnd, 'V', 'step.vdrop.uend.ac3', 'physics-power');
    const loss = 3 * i * i * r;
    b.step('step.vdrop.loss.ac3', { i: num(i, 'A'), r: num(r, 'Ω'), p: num(loss, 'W') }, 'physics-resistance');
    b.value('powerLoss', loss, 'W', 'step.vdrop.loss.ac3', 'physics-resistance');
  } else {
    const uEnd = u - uDrop;
    b.step('step.vdrop.uend', { u: num(u, 'V'), du: num(uDrop, 'V'), uend: num(uEnd, 'V') }, 'physics-power');
    b.value('uEnd', uEnd, 'V', 'step.vdrop.uend', 'physics-power');
    const loss = 2 * i * i * r;
    b.step('step.vdrop.loss', { i: num(i, 'A'), r: num(r, 'Ω'), p: num(loss, 'W') }, 'physics-resistance');
    b.value('powerLoss', loss, 'W', 'step.vdrop.loss', 'physics-resistance');
  }

  // ---- verdict against the user's limit (never a compliance verdict, D16) ----
  const limitSource = preset ? preset.source : 'iec60364-5-52-G';
  b.assume('assume.limit', { limit: num(limit, '%'), preset: key(limitLabel(preset?.id)) }, false, preset?.source);
  b.value('limit', limit, '%', 'assume.limit', limitSource);
  const within = leq(pct, limit);
  b.setText('verdict', within ? 'within' : 'exceeds');
  b.check('vdrop.limit', within, within ? 'check.vdrop.within' : 'check.vdrop.exceeds', { pct: num(pct, '%'), limit: num(limit, '%') }, limitSource);

  // ---- maximum length ----
  const lMax = (limit * u0) / (100 * bFactor * i * ((rho / sEff) * cos + xEff * sin));
  b.step(
    'step.vdrop.lmax',
    { limit: num(limit, '%'), u0: num(u0, 'V'), b: num(bFactor, ''), i: num(i, 'A'), rho: num(rho, 'Ω·mm²/m'), s: num(sEff, 'mm²'), cos: num(cos, ''), x: num(xEff, 'Ω/m'), sin: num(sin, ''), lmax: num(lMax, 'm') },
    'iec60364-5-52-G',
  );
  b.value('lMax', lMax, 'm', 'step.vdrop.lmax', 'iec60364-5-52-G');

  // ---- minimum standard size (metric list, or AWG when the input is AWG) ----
  minimumSize(b, ctx, method, size.unit, limit);

  // ---- method comparison ----
  for (const m of VDROP_METHODS) {
    const mp = m === method ? pct : percentAt(ctx, m, size.mm2);
    b.value(`percent${m}`, mp, '%', m === method ? 'step.vdrop.percent' : 'step.vdrop.compare', m === 'M1' ? 'iec60364-5-52-G' : m === 'M2' ? 'physics-resistance' : 'de-practice-kappa');
    if (m === method) continue;
    b.step('step.vdrop.compare', { method: key(`method.${m}`), pct: num(mp, '%') });
    if (leq(mp, limit) !== within) {
      b.warn('method.disagree', 'warn.method.disagree', { method: key(`method.${m}`), pct: num(mp, '%'), verdict: key(leq(mp, limit) ? 'verdict.within' : 'verdict.exceeds') });
    }
  }
  b.assume(
    'assume.vdrop.compare',
    // the X' the comparison really used: 0 for DC (D39), not a typed value it ignored (D53)
    { theta: num(thetaC, '°C'), kappa: num(kappa, 'm/(Ω·mm²)'), x: num(ctx.xUser, 'Ω/m') },
    (input.conductorTempC === undefined || input.conductorTempC === null) && (input.kappa === undefined || input.kappa === null),
  );

  if (lengthM > p.typicalRange.lengthM) b.warn('range.length', 'warn.range.length', { max: num(p.typicalRange.lengthM, 'm') });
  if (i > p.typicalRange.currentA) b.warn('range.current', 'warn.range.current', { max: num(p.typicalRange.currentA, 'A') });
}

/** Smallest standard size with Δu ≤ limit (Δu falls as S grows, so the list is scanned from small to large, A14). */
function minimumSize(b: Builder, ctx: Ctx, method: VdropMethod, unit: Size['unit'], limit: number) {
  const p = b.profile;
  const awg = unit === 'awg';
  const list = awg ? p.awgGauges.map((g) => ({ label: g, mm2: awgAreaMm2(g) })) : p.metricSizesMm2.map((s) => ({ label: s, mm2: s }));
  b.assume(awg ? 'assume.vdrop.sizes.awg' : 'assume.vdrop.sizes.metric', {}, false, awg ? 'astm-b258' : 'iec60228');
  const idx = list.findIndex((s) => leq(percentAt(ctx, method, s.mm2), limit));
  const sizeUnit = awg ? 'AWG' : 'mm²';
  if (idx < 0) {
    const last = list[list.length - 1];
    b.warn('vdrop.noStandardSize', 'warn.vdrop.noStandardSize', { size: num(last.label, sizeUnit) });
    return;
  }
  const hit = list[idx];
  const hitPct = percentAt(ctx, method, hit.mm2);
  b.step('step.vdrop.minSize', { size: num(hit.label, sizeUnit), pct: num(hitPct, '%'), limit: num(limit, '%') });
  b.value('minSize', hit.label, sizeUnit, 'step.vdrop.minSize', awg ? 'astm-b258' : 'iec60228');
  b.value('minSizeMm2', hit.mm2, 'mm²', 'step.vdrop.minSize', awg ? 'astm-b258' : 'iec60228');
  b.value('minSizePercent', hitPct, '%', 'step.vdrop.minSize', 'iec60364-5-52-G');
  b.setText('minSize', awg ? `AWG ${awgLabel(hit.label)}` : `${hit.label} mm²`);
  // v1.1 F1 (REVIEW_V1 #1): the size answers the voltage-drop limit only, never Iz, protection or disconnection
  b.assume('assume.vdrop.minSize.scope', {}, false);
  if (idx > 0) {
    const prev = list[idx - 1];
    const prevPct = percentAt(ctx, method, prev.mm2);
    b.step('step.vdrop.minSize.smaller', { size: num(prev.label, sizeUnit), pct: num(prevPct, '%'), limit: num(limit, '%') });
  }
}
