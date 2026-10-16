// D52 (review finding 1, owner sign-off): maxima are shown rounded DOWN, the quantities checked against them rounded UP,
// and a check text never shows two equal-looking numbers (or a contradicting order) next to a strict verdict.
import { compute, type CalcResult } from '@/engine';
import { E1_INPUT, E3_INPUT, E4_INPUT } from '@/dev/seeds';

import { displayText, formatComparedPair, formatValue, VALUE_DIRECTION } from './format';

const vdrop = (length: number, extra: object = {}) => compute('vdrop', { ...(E1_INPUT as object), length: { value: length, unit: 'm' }, ...extra } as never);
const loop = (extra: object) => compute('loop', { ...(E4_INPUT as object), ...extra } as never);
const checkTexts = (r: CalcResult, lang: 'en' | 'de' = 'en') => r.checks.map((c) => displayText(c, lang));
const shown = (text: string) => Number(text.split(' ')[0].replace(',', '.'));

describe('the review cases (REVIEW_ENGINE #1)', () => {
  it('(a) E1 at 14.39 m: Δu 3.0031 % is shown above the 3 % it exceeds', () => {
    const r = vdrop(14.39);
    expect(r.checks[0].met).toBe(false);
    expect(checkTexts(r)).toEqual(['Δu 3.01 % exceeds the selected limit 3 %']);
    expect(checkTexts(r, 'de')[0]).toContain('3,01 %');
  });
  it('(b) E4 at 91.8 m: Zs is shown above Zs_max', () => {
    const r = loop({ length: { value: 91.8, unit: 'm' } });
    expect(r.checks[0].met).toBe(false);
    // v1.1 F4: the current side is spelled out with Ik rounded down — never "Ik 80 A" beside "Ia 80 A" with "not met"
    expect(checkTexts(r)).toEqual(['Zs 2.876 Ω > Zs_max 2.875 Ω — condition not met', 'Ik ≥ Ia required: Ik 79.99 A < Ia 80 A — not met (Zs is above Zs_max)']);
    expect(formatValue('ik', r.values.ik.value, 'A', 'en')).toBe('79.99 A');
    expect(formatValue('ia', r.values.ia.value, 'A', 'en')).toBe('80 A');
  });
  it('(c) E1 L_max 14.375 m is shown as 14.3 m, and typing 14.3 m gives "within"', () => {
    const r = vdrop(18);
    expect(formatValue('lMax', r.values.lMax.value, 'm', 'en')).toBe('14.3 m');
    expect(vdrop(14.3).texts.verdict).toBe('within');
    expect(vdrop(14.4).texts.verdict).toBe('exceeds');
  });
  it('(c) E4 L_max 91.799 m is shown as 91.7 m (SPEC U5 "91.8 m" → "91.7 m", owner sign-off)', () => {
    const r = loop({});
    expect(formatValue('lMax', r.values.lMax.value, 'm', 'en')).toBe('91.7 m');
    expect(formatValue('lMax', r.values.lMax.value, 'm', 'de')).toBe('91,7 m');
    expect(loop({ length: { value: 91.7, unit: 'm' } }).checks[0].met).toBe(true);
    const step = r.steps.find((s) => s.key === 'step.loop.lMax')!;
    expect(displayText(step, 'en')).toMatch(/= 91\.7 m$/);
  });
  it('(c) E4b Zs_max 1.4375 Ω is shown as 1.437 Ω; the measured limit 1.91667 Ω as 1.916 Ω', () => {
    const e4b = loop({ lineSize: { value: 2.5, unit: 'mm2' }, peSize: { value: 2.5, unit: 'mm2' }, length: { value: 20, unit: 'm' }, device: { type: 'mcb', curve: 'C', ratedCurrent: 16 } });
    expect(e4b.values.zsMax.value).toBeCloseTo(1.4375, 12);
    expect(formatValue('zsMax', e4b.values.zsMax.value, 'Ω', 'en')).toBe('1.437 Ω');
    const meas = compute('loop', { mode: 'measured', u0: 230, device: { type: 'mcb', curve: 'B', ratedCurrent: 16 }, cmin: 1, zsMeasured: 1.917 } as never);
    expect(formatValue('measuredLimit', meas.values.measuredLimit.value, 'Ω', 'en')).toBe('1.916 Ω');
    expect(meas.checks[0].met).toBe(false);
    expect(checkTexts(meas)).toEqual(['Measured Zs 1.917 Ω > 1.916 Ω — condition not met']);
  });
  it('a value equal to its limit within D37 is shown equal and "met" (length = L_max)', () => {
    const lMax = vdrop(18).values.lMax.value;
    const at = vdrop(lMax);
    expect(at.texts.verdict).toBe('within');
    expect(checkTexts(at)).toEqual(['Δu 3 % is within the selected limit 3 %']);
    const e4 = loop({});
    const atLoop = loop({ length: { value: e4.values.lMax.value, unit: 'm' } });
    expect(checkTexts(atLoop)).toEqual(['Zs 2.875 Ω ≤ Zs_max 2.875 Ω — condition met', 'Ik ≥ Ia required: Ik 80 A ≥ Ia 80 A — met']);
  });
  it('"met" with numbers that would round to the same text gets another digit', () => {
    expect(formatComparedPair({ value: 2.9991, unit: '%' }, { value: 3, unit: '%' }, 'le', 'en')).toEqual(['2.9991 %', '3 %']);
    expect(formatComparedPair({ value: 2.87449, unit: 'Ω' }, { value: 2.8745, unit: 'Ω' }, 'le', 'en')).toEqual(['2.87449 Ω', '2.8745 Ω']);
    expect(formatComparedPair({ value: 3.0004, unit: '%' }, { value: 3, unit: '%' }, 'gt', 'en')).toEqual(['3.01 %', '3 %']);
  });
  it('coordination: In 13 A against Ib 13.0001 A is not shown as "13 A ≤ 13 A — not met"', () => {
    const c = compute('coord', { ...(E3_INPUT as object), ib: 13.0001, device: { type: 'mcb', curve: 'B', ratedCurrent: 13 } } as never);
    const c1 = c.checks.find((x) => x.id === 'coord.c1')!;
    expect(c1.met).toBe(false);
    // v1.1 (REVIEW_V1 #17): a not-met check prints ">" between its numbers, never a false "≤"
    expect(displayText(c1, 'en')).toBe('C1 Ib ≤ In: 13.01 A > 13 A — not met');
  });
  it('E3: C2/C3 not met print ">" and the C3 product multiplies out (REVIEW_V1 #17, probe R3)', () => {
    const r = compute('coord', E3_INPUT as never);
    const c2 = r.checks.find((x) => x.id === 'coord.c2')!;
    const c3 = r.checks.find((x) => x.id === 'coord.c3')!;
    expect(displayText(c2, 'en')).toBe('C2 In ≤ Iz: 16 A > 14.96 A — not met');
    expect(displayText(c3, 'en')).toBe('C3 I2 ≤ 1.45 × Iz: 23.2 A > 1.45 × 14.966 A = 21.7 A — not met');
    expect(displayText(c2, 'de')).toBe('C2 In ≤ Iz: 16 A > 14,96 A — nicht erfüllt');
    // met checks keep "≤"
    const ok = compute('coord', { ...(E3_INPUT as object), device: { type: 'mcb', curve: 'B', ratedCurrent: 13 } } as never);
    expect(displayText(ok.checks.find((x) => x.id === 'coord.c2')!, 'en')).toMatch(/^C2 In ≤ Iz: 13 A ≤ 14\.96 A — met$/);
  });
});

// ---------------------------------------------------------------- properties over random cases

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('properties (seeded random cases)', () => {
  const rand = rng(20261001);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
  const results: CalcResult[] = [];
  for (let i = 0; i < 400; i++) {
    const base = vdrop(18);
    const lMax = base.values.lMax.value;
    results.push(vdrop(lMax * (0.98 + 0.04 * rand()), { current: 1 + 40 * rand(), size: { value: pick([1.5, 2.5, 4, 6]), unit: 'mm2' }, limitPercent: pick([3, 4, 5, 2.5]) }));
    results.push(vdrop(1 + 200 * rand(), { method: pick(['M1', 'M2', 'M3']), current: 1 + 63 * rand() }));
    const e4 = loop({ ze: 0.1 + 0.8 * rand(), device: { type: 'mcb', curve: pick(['B', 'C', 'D']), ratedCurrent: pick([6, 10, 13, 16, 20, 25, 32]) } });
    if (e4.values.lMax) results.push(loop({ ...{ ze: 0.35 }, length: { value: e4.values.lMax.value * (0.99 + 0.02 * rand()), unit: 'm' } }));
    results.push(loop({ length: { value: 1 + 150 * rand(), unit: 'm' }, cmin: pick([1, 0.95]) }));
    results.push(compute('loop', { mode: 'measured', u0: 230, device: { type: 'mcb', curve: pick(['B', 'C']), ratedCurrent: pick([10, 13, 16, 20]) }, cmin: pick([1, 0.95]), zsMeasured: 0.2 + 3 * rand(), measuredFactor: pick([2 / 3, 0.8, 1]) } as never));
    results.push(compute('coord', { ...(E3_INPUT as object), ib: 5 + 20 * rand(), table: undefined, izTyped: 10 + 30 * rand(), device: { type: 'mcb', curve: 'B', ratedCurrent: pick([10, 13, 16, 20, 25]) } } as never));
  }
  const ok = results.filter((r) => r.ok);

  it('generated enough valid cases', () => {
    expect(ok.length).toBeGreaterThan(1800);
  });

  it('a displayed maximum is never above the true maximum; a displayed checked quantity never below the true one', () => {
    let n = 0;
    for (const r of ok) {
      for (const [name, dir] of Object.entries(VALUE_DIRECTION)) {
        const v = r.values[name];
        if (!v) continue;
        const d = shown(formatValue(name, v.value, v.unit, 'en'));
        if (dir === 'down') expect(d).toBeLessThanOrEqual(v.value * (1 + 1e-12));
        else expect(d).toBeGreaterThanOrEqual(v.value * (1 - 1e-12));
        n++;
      }
    }
    expect(n).toBeGreaterThan(3000);
  });

  it('no check text shows two equal numbers with "exceeds", ">" or "not met", nor an order that contradicts "met"', () => {
    const pairs: Record<string, [string, string]> = {
      'check.vdrop.within': ['pct', 'limit'],
      'check.vdrop.exceeds': ['pct', 'limit'],
      'check.loop.met': ['zs', 'zsmax'],
      'check.loop.notMet': ['zs', 'zsmax'],
      'check.loop.measured.met': ['zs', 'lim'],
      'check.loop.measured.notMet': ['zs', 'lim'],
      'check.coord.c1': ['ib', 'in'],
      'check.coord.c2': ['in', 'iz'],
      'check.coord.c3': ['i2', 'lim'],
      // Ik ≥ Ia is checked as "Ia ≤ Ik" (Ia rounded up, Ik down, v1.1 F4)
      'check.loop.ik.met': ['ia', 'ik'],
      'check.loop.ik.notMet': ['ia', 'ik'],
    };
    let strict = 0;
    for (const r of ok) {
      for (const c of r.checks) {
        const [a, b] = pairs[c.key];
        const va = c.vars[a];
        const vb = c.vars[b];
        if (va.kind !== 'num' || vb.kind !== 'num') throw new Error('pair');
        const [ta, tb] = formatComparedPair(va, vb, c.met ? 'le' : 'gt', 'en');
        const text = displayText(c, 'en');
        if (c.id === 'loop.ik') expect(c.met).toBe(r.checks.find((z) => z.id === 'loop.zs')!.met); // one criterion, one verdict
        expect(text).toContain(ta);
        expect(text).toContain(tb);
        if (c.met) expect(shown(ta)).toBeLessThanOrEqual(shown(tb));
        else {
          strict++;
          expect(shown(ta)).toBeGreaterThan(shown(tb));
        }
      }
    }
    expect(strict).toBeGreaterThan(300);
  });
});
