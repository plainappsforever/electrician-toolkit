// SPEC §13 edge cases and input validation, one calculator at a time.
import { compute } from './index';
import type { CalcResult, VdropInput } from './types';

const E1: VdropInput = { system: 'ac1', voltage: 230, current: 16, length: { value: 18, unit: 'm' }, material: 'cu', size: { value: 1.5, unit: 'mm2' }, cosPhi: 1, limitPercent: 3 };
const codes = (r: CalcResult) => r.errors.map((e) => e.code);
const warns = (r: CalcResult) => r.warnings.map((w) => w.code);

describe('voltage drop edge cases', () => {
  it('zero, negative and non-numeric inputs → error, no result', () => {
    for (const bad of [
      { length: { value: 0, unit: 'm' } },
      { length: { value: -5, unit: 'm' } },
      { voltage: 0 },
      { current: -1 },
      { current: Number.NaN },
      { current: Infinity },
      { voltage: '230' },
      { size: { value: 0, unit: 'mm2' } },
    ]) {
      const r = compute('vdrop', { ...E1, ...bad } as unknown as VdropInput);
      expect(r.ok).toBe(false);
      expect(r.values).toEqual({});
      expect(r.steps).toEqual([]);
      expect(r.errors.length).toBeGreaterThan(0);
    }
    expect(codes(compute('vdrop', { ...E1, length: { value: 0, unit: 'm' } }))).toEqual(['input.notPositive']);
    expect(compute('vdrop', { ...E1, length: { value: 0, unit: 'm' } }).errors[0].field).toBe('length');
  });

  it('cos φ outside (0, 1], η outside (0, 1] → error; DC forces cos φ = 1', () => {
    expect(codes(compute('vdrop', { ...E1, cosPhi: 0 }))).toEqual(['input.range']);
    expect(codes(compute('vdrop', { ...E1, cosPhi: 1.2 }))).toEqual(['input.range']);
    expect(codes(compute('vdrop', { ...E1, current: undefined, power: 3000, efficiency: 0 }))).toEqual(['input.range']);
    const dc = compute('vdrop', { ...E1, system: 'dc', voltage: 24, cosPhi: 0.5 });
    expect(dc.ok).toBe(true);
    expect(dc.values.u.value).toBeCloseTo(8.64, 12);
    expect(dc.values.sinPhi).toBeUndefined();
    expect(dc.assumptions.map((a) => a.key)).toContain('assume.dc');
  });

  it('unsupported material, AWG outside −3…40 or fractional, unknown system/method → error', () => {
    expect(codes(compute('vdrop', { ...E1, material: 'silver' } as unknown as VdropInput))).toEqual(['input.material']);
    expect(codes(compute('vdrop', { ...E1, size: { value: 41, unit: 'awg' } }))).toEqual(['input.awg']);
    expect(codes(compute('vdrop', { ...E1, size: { value: -4, unit: 'awg' } }))).toEqual(['input.awg']);
    expect(codes(compute('vdrop', { ...E1, size: { value: 12.5, unit: 'awg' } }))).toEqual(['input.awg']);
    expect(codes(compute('vdrop', { ...E1, system: 'ac2' } as unknown as VdropInput))).toEqual(['input.option']);
    expect(codes(compute('vdrop', { ...E1, method: 'M4' } as unknown as VdropInput))).toEqual(['input.option']);
    expect(codes(compute('vdrop', { ...E1, parallel: 1.5 }))).toEqual(['input.count']);
    expect(codes(compute('vdrop', { ...E1, parallel: 0 }))).toEqual(['input.count']);
  });

  it('current and power: exactly one', () => {
    expect(codes(compute('vdrop', { ...E1, power: 3680 }))).toEqual(['input.oneOf']);
    expect(codes(compute('vdrop', { ...E1, current: undefined }))).toEqual(['input.oneOf']);
    const fromPower = compute('vdrop', { ...E1, current: undefined, power: 3680 });
    expect(fromPower.values.current.value).toBeCloseTo(16, 12);
    expect(fromPower.values.u.value).toBeCloseTo(8.64, 12);
  });

  it('limit must be in (0, 100]; a preset must match its value', () => {
    expect(codes(compute('vdrop', { ...E1, limitPercent: 0 }))).toEqual(['input.range']);
    expect(codes(compute('vdrop', { ...E1, limitPercent: 101 }))).toEqual(['input.range']);
    expect(codes(compute('vdrop', { ...E1, limitPreset: 'nope' }))).toEqual(['input.option']);
    expect(codes(compute('vdrop', { ...E1, limitPreset: 'vde-ar-n-4100' }))).toEqual(['input.limitPreset']);
    const din = compute('vdrop', { ...E1, limitPreset: 'din18015-1' });
    expect(din.sources).toContain('din18015-1');
    expect(din.checks[0].source).toBe('din18015-1');
  });

  it('a conductor temperature without positive resistivity → error', () => {
    expect(codes(compute('vdrop', { ...E1, method: 'M2', conductorTempC: -300 }))).toEqual(['input.temperature']);
  });

  it('huge loads and lengths stay computable but warn "outside the typical range"', () => {
    const r = compute('vdrop', { ...E1, current: 20000, length: { value: 12000, unit: 'm' }, size: { value: 300, unit: 'mm2' } });
    expect(r.ok).toBe(true);
    expect(warns(r)).toEqual(expect.arrayContaining(['range.length', 'range.current']));
    expect(warns(compute('vdrop', E1))).not.toContain('range.current');
    expect(warns(compute('vdrop', { ...E1, current: 10000 }))).not.toContain('range.current'); // limit is "above 10 kA"
  });

  it('no standard size meets the limit → warning with the parallel hint, result still shown', () => {
    const r = compute('vdrop', { ...E1, current: 2000, length: { value: 500, unit: 'm' } });
    expect(r.ok).toBe(true);
    expect(r.values.minSize).toBeUndefined();
    expect(warns(r)).toContain('vdrop.noStandardSize');
    const awg = compute('vdrop', { ...E1, size: { value: 12, unit: 'awg' }, current: 2000, length: { value: 500, unit: 'm' } });
    expect(awg.warnings.find((w) => w.code === 'vdrop.noStandardSize')?.vars.size).toEqual({ kind: 'num', value: -3, unit: 'AWG' });
  });

  it('AWG input → minimum section from the AWG list; kcmil input → metric list', () => {
    const r = compute('vdrop', { ...E1, size: { value: 14, unit: 'awg' } });
    expect(r.values.minSize.unit).toBe('AWG');
    expect(r.texts.minSize).toMatch(/^AWG /);
    const k = compute('vdrop', { ...E1, size: { value: 250, unit: 'kcmil' } });
    expect(k.values.minSize.unit).toBe('mm²');
  });

  it('E1 method comparison: M1 exceeds, M3 (κ 56) within → exactly one disagreement warning naming M3', () => {
    const r = compute('vdrop', E1);
    const w = r.warnings.filter((x) => x.code === 'method.disagree');
    expect(w).toHaveLength(1);
    expect(w[0].vars.method).toEqual({ kind: 'key', value: 'method.M3' });
    expect(w[0].vars.verdict).toEqual({ kind: 'key', value: 'verdict.within' });
  });

  it('methods agree → no disagreement note', () => {
    const r = compute('vdrop', { ...E1, length: { value: 5, unit: 'm' } });
    expect(warns(r)).not.toContain('method.disagree');
  });
});

describe('current, Ohm', () => {
  it('current from power and power from current are inverse', () => {
    const p = compute('current', { system: 'ac3', voltage: 400, power: 7500, cosPhi: 0.85, efficiency: 0.9 });
    const i = compute('current', { system: 'ac3', voltage: 400, current: p.values.current.value, cosPhi: 0.85, efficiency: 0.9 });
    expect(i.values.power.value).toBeCloseTo(7500, 9);
    expect(codes(compute('current', { system: 'ac1', voltage: 230 }))).toEqual(['input.oneOf']);
    const dc = compute('current', { system: 'dc', voltage: 24, power: 240 });
    expect(dc.values.current.value).toBe(10);
    expect(dc.values.reactivePower).toBeUndefined();
  });

  it("Ohm's law: every pair gives the same four numbers", () => {
    const want = { voltage: 230, current: 10, resistance: 23, power: 2300 };
    const keys = Object.keys(want) as (keyof typeof want)[];
    for (let a = 0; a < 4; a++)
      for (let b = a + 1; b < 4; b++) {
        const r = compute('ohm', { [keys[a]]: want[keys[a]], [keys[b]]: want[keys[b]] });
        for (const k of keys) expect(r.values[k].value).toBeCloseTo(want[k], 9);
      }
    expect(codes(compute('ohm', { voltage: 230 }))).toEqual(['ohm.needTwo']);
    expect(codes(compute('ohm', { voltage: 230, current: 1, power: 230 }))).toEqual(['ohm.needTwo']);
    expect(codes(compute('ohm', { voltage: 230, current: 0 }))).toEqual(['input.notPositive']);
  });
});

describe('coordination edge cases', () => {
  const base = { ib: 13, device: { type: 'mcb' as const, curve: 'B' as const, ratedCurrent: 16 }, izTyped: 20, insulationMaxC: 70, referenceAmbientC: 30 };
  it('θa ≥ θmax, θref ≥ θmax, factors ≤ 0 or > 1.5, Iz ≤ 0, Ib ≤ 0 → error', () => {
    expect(codes(compute('coord', { ...base, ambientC: 70 }))).toEqual(['coord.ambient']);
    expect(codes(compute('coord', { ...base, ambientC: 35, referenceAmbientC: 70 }))).toEqual(['coord.reference']);
    expect(codes(compute('coord', { ...base, fGroup: 0 }))).toEqual(['coord.factor']);
    expect(codes(compute('coord', { ...base, fGroup: 1.6 }))).toEqual(['coord.factor']);
    expect(codes(compute('coord', { ...base, fTheta: -1 }))).toEqual(['coord.factor']);
    expect(codes(compute('coord', { ...base, izTyped: 0 }))).toEqual(['input.notPositive']);
    expect(codes(compute('coord', { ...base, ib: 0 }))).toEqual(['input.notPositive']);
    expect(codes(compute('coord', { ...base, device: { type: 'mcb', curve: 'B', ratedCurrent: 15 } }))).toEqual(['input.rating']);
    expect(codes(compute('coord', { ...base, izTyped: undefined }))).toEqual(['coord.izSource']);
    expect(codes(compute('coord', { ...base, table: { izA: 20 } }))).toEqual(['coord.izSource']);
  });

  it('no ambient → f_θ = 1 as a default assumption; typed f_θ overrides the computed one', () => {
    const r = compute('coord', base);
    expect(r.values.fTheta.value).toBe(1);
    expect(r.assumptions.find((a) => a.key === 'assume.coord.fTheta.default')?.isDefault).toBe(true);
    const typed = compute('coord', { ...base, ambientC: 35, fTheta: 0.94 });
    expect(typed.values.fTheta.value).toBe(0.94);
  });

  it('other device: typed I2, no suggestion; nothing fits → warning', () => {
    const other = compute('coord', { ...base, device: { type: 'other', ratedCurrent: 16, i2: 25.6 } });
    expect(other.values.i2.value).toBe(25.6);
    expect(other.texts.suggestion).toBeUndefined();
    expect(codes(compute('coord', { ...base, device: { type: 'other', ratedCurrent: 16 } }))).toEqual(['input.missing']);
    const tight = compute('coord', { ...base, ib: 18, izTyped: 19 });
    expect(warns(tight)).toContain('coord.noRating');
  });
});

describe('loop edge cases', () => {
  const E4 = { u0: 230, ze: 0.35, material: 'cu' as const, lineSize: { value: 1.5, unit: 'mm2' as const }, peSize: { value: 1.5, unit: 'mm2' as const }, length: { value: 25, unit: 'm' as const }, device: { type: 'mcb' as const, curve: 'B' as const, ratedCurrent: 16 } };
  it('defaults: U0 230, θ 70, Cmin 1 marked as default assumptions', () => {
    const r = compute('loop', { ...E4, u0: undefined });
    expect(r.values.zs.value).toBeCloseTo(1.0376436782, 9);
    expect(r.assumptions.filter((a) => a.isDefault).map((a) => a.key)).toEqual(
      expect.arrayContaining(['assume.loop.u0', 'assume.loop.cmin.default', 'assume.conductorTemp']),
    );
    // v1.1 F9: a typed Cmin gets the plain line, the default the caution line
    const typed = compute('loop', { ...E4, cmin: 0.95 });
    expect(typed.assumptions.map((a) => a.key)).toContain('assume.loop.cmin');
    expect(typed.assumptions.map((a) => a.key)).not.toContain('assume.loop.cmin.default');
    expect(typed.values.zsMax.value).toBeCloseTo(0.95 * 230 / 80, 12);
  });

  it('Ze ≥ Zs_max → "Ze alone exceeds", no L_max, check not met', () => {
    const r = compute('loop', { ...E4, ze: 3 });
    expect(r.ok).toBe(true);
    expect(warns(r)).toContain('loop.zeExceeds');
    expect(r.values.lMax).toBeUndefined();
    expect(r.checks[0].met).toBe(false);
  });

  it('S_PE > S_L allowed; other device needs Ia; measured mode needs Zs; Cmin and k in (0, 1]', () => {
    expect(compute('loop', { ...E4, peSize: { value: 2.5, unit: 'mm2' } }).ok).toBe(true);
    expect(codes(compute('loop', { ...E4, device: { type: 'other' } }))).toEqual(['input.missing']);
    const other = compute('loop', { ...E4, device: { type: 'other', ia: 80 } });
    expect(other.values.zsMax.value).toBe(2.875);
    expect(codes(compute('loop', { mode: 'measured', device: E4.device }))).toEqual(['input.missing']);
    expect(codes(compute('loop', { ...E4, cmin: 1.1 }))).toEqual(['input.range']);
    expect(codes(compute('loop', { mode: 'measured', zsMeasured: 1.8, measuredFactor: 0, device: E4.device }))).toEqual(['input.range']);
    const measured = compute('loop', { mode: 'measured', zsMeasured: 2, device: E4.device });
    expect(measured.checks[0].met).toBe(false); // 2 > 2/3 · 2.875
    expect(compute('loop', { mode: 'measured', zsMeasured: 2, measuredFactor: 0.8, device: E4.device }).checks[0].met).toBe(true);
  });

  it('measured mode ignores cable fields', () => {
    const r = compute('loop', { mode: 'measured', zsMeasured: 1.8, device: E4.device, material: 'gold' } as never);
    expect(r.ok).toBe(true);
  });
});

describe('resistance and convert edge cases', () => {
  it('loop = 2R for equal sections, R_L + R_PE for different ones; parallel divides', () => {
    const r = compute('resistance', { material: 'cu', size: { value: 2.5, unit: 'mm2' }, length: { value: 50, unit: 'm' }, temperatureC: 20 });
    expect(r.values.rLoop.value).toBeCloseTo(2 * r.values.r.value, 15);
    const pe = compute('resistance', { material: 'cu', size: { value: 2.5, unit: 'mm2' }, peSize: { value: 1.5, unit: 'mm2' }, length: { value: 50, unit: 'm' }, temperatureC: 20 });
    expect(pe.values.rLoop.value).toBeCloseTo((50 / 58) * (1 / 2.5 + 1 / 1.5), 12);
    const two = compute('resistance', { material: 'cu', size: { value: 2.5, unit: 'mm2' }, length: { value: 50, unit: 'm' }, parallel: 2, temperatureC: 20 });
    expect(two.values.r.value).toBeCloseTo(r.values.r.value / 2, 15);
    const dflt = compute('resistance', { material: 'al', size: { value: 16, unit: 'mm2' }, length: { value: 100, unit: 'm' } });
    expect(dflt.assumptions.find((a) => a.key === 'assume.conductorTemp')?.isDefault).toBe(true);
    expect(dflt.sources).toContain('al-alpha20');
  });

  it('convert: ft ↔ m, AWG range, nearest metric sizes', () => {
    expect(compute('convert', { from: 'ft', value: 100 }).values.m.value).toBeCloseTo(30.48, 12);
    expect(compute('convert', { from: 'm', value: 30.48 }).values.ft.value).toBeCloseTo(100, 12);
    expect(codes(compute('convert', { from: 'awg', value: 41 }))).toEqual(['input.awg']);
    const awg12 = compute('convert', { from: 'awg', value: 12 });
    expect(awg12.values.metricAtLeast.value).toBe(4);
    expect(awg12.values.metricAtMost.value).toBe(2.5);
    expect(awg12.texts.awg).toBe('12');
    expect(compute('convert', { from: 'awg', value: -3 }).texts.awg).toBe('4/0');
    const big = compute('convert', { from: 'mm2', value: 400 });
    expect(big.values.metricAtLeast).toBeUndefined();
    expect(big.values.awgAtLeast).toBeUndefined();
    expect(big.values.metricAtMost.value).toBe(300);
  });

  it('unknown kind → error, never throws', () => {
    const r = compute('teleport' as never, {});
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(['input.kind']);
  });
});

describe('D55: the four P3 SPEC readings (M1–M4), as signed off', () => {
  it('M1: an area equal to a standard size within D37 is that size on both bounds (every AWG gauge, every metric size)', () => {
    for (let n = -3; n <= 40; n++) {
      const area = compute('convert', { from: 'awg', value: n }).values.mm2.value;
      for (const a of [area, area * (1 + 4e-13), area * (1 - 4e-13)]) {
        const r = compute('convert', { from: 'mm2', value: a });
        expect([r.values.awgAtLeast.value, r.values.awgAtMost.value]).toEqual([n, n]);
      }
    }
    const r = compute('convert', { from: 'mm2', value: 2.5 * (1 + 1e-13) });
    expect([r.values.metricAtLeast.value, r.values.metricAtMost.value]).toEqual([2.5, 2.5]);
  });
  it('M2: an unknown preset id is input.option; a known preset with another % is input.limitPreset', () => {
    expect(codes(compute('vdrop', { ...E1, limitPreset: 'nec-3' }))).toEqual(['input.option']);
    expect(codes(compute('vdrop', { ...E1, limitPreset: 'din18015-1', limitPercent: 4 }))).toEqual(['input.limitPreset']);
  });
  it('M3: Ohm\'s law warns above 10 kA (230 V / 0.01 Ω = 23 kA), not at 10 kA', () => {
    expect(warns(compute('ohm', { voltage: 230, resistance: 0.01 }))).toEqual(['range.current']);
    expect(warns(compute('ohm', { voltage: 100, current: 10_000 }))).toEqual([]);
  });
  it('M4: η is validated only when it is used (power given)', () => {
    expect(compute('vdrop', { ...E1, efficiency: 1.5 }).ok).toBe(true);
    expect(codes(compute('vdrop', { ...E1, current: undefined, power: 3000, efficiency: 1.5 }))).toEqual(['input.range']);
  });
});

describe('v1.1 F1: smallest size is scoped to voltage drop (REVIEW_V1 #1, probe X1)', () => {
  it('3~ 400 V, 63 A, 5 m gives 1 mm² by voltage drop and says Iz/protection are not checked', () => {
    const r = compute('vdrop', { system: 'ac3', voltage: 400, current: 63, length: { value: 5, unit: 'm' }, material: 'cu', size: { value: 16, unit: 'mm2' }, cosPhi: 0.9, limitPercent: 3 });
    expect(r.ok).toBe(true);
    expect(r.texts.minSize).toBe('1 mm²');
    expect(r.assumptions.map((a) => a.key)).toContain('assume.vdrop.minSize.scope');
  });
  it('no scope line when no standard size meets the limit', () => {
    const r = compute('vdrop', { ...E1, length: { value: 20000, unit: 'm' } });
    expect(r.texts.minSize).toBeUndefined();
    expect(r.assumptions.map((a) => a.key)).not.toContain('assume.vdrop.minSize.scope');
  });
});
