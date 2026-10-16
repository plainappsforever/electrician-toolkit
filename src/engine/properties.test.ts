// Property tests (V1_PLAN P2, SPEC §16 A14/§17): linearity, parallel conductors, monotonic minimum section,
// Δu(L_max) = limit, unit round trips, coordination suggestion satisfies C1–C3.
import { compute } from './index';
import { EU_DE } from './profiles';
import { rng } from '../../test/seeded-random';
import type { CalcResult, Size, VdropInput, VdropMethod } from './types';
import { awgAreaMm2, awgFromAreaMm2, ftToM, kcmilToMm2, mm2ToKcmil, mToFt } from './units';

const R = rng(20261001);
const METHODS: VdropMethod[] = ['M1', 'M2', 'M3'];
const relEq = (a: number, b: number, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(Math.abs(a), Math.abs(b));
const v = (r: CalcResult, name: string) => {
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const x = r.values[name];
  if (!x) throw new Error(`missing ${name}`);
  return x.value;
};

function randomVdrop(): VdropInput {
  const system = R.pick(['dc', 'ac1', 'ac3'] as const);
  const awg = R.next() < 0.2;
  const size: Size = awg ? { value: R.int(-3, 18), unit: 'awg' } : { value: R.pick(EU_DE.metricSizesMm2), unit: 'mm2' };
  return {
    system,
    voltage: system === 'dc' ? R.pick([12, 24, 48, 110]) : system === 'ac1' ? R.pick([120, 230, 240]) : R.pick([400, 415, 690]),
    current: R.between(0.5, 400),
    length: { value: R.between(1, 500), unit: R.next() < 0.2 ? 'ft' : 'm' },
    material: R.pick(['cu', 'al'] as const),
    size,
    parallel: R.int(1, 4),
    cosPhi: R.pick([1, 0.95, 0.9, 0.85, 0.8, 0.5]),
    method: R.pick(METHODS),
    conductorTempC: R.pick([20, 70, 90]),
    reactanceOhmPerM: R.pick([0, 0.00008, 0.0001]),
    limitPercent: R.pick([0.5, 1, 3, 5]),
  };
}

describe('voltage drop properties', () => {
  it('u is linear in L and in I (300 random cases)', () => {
    for (let k = 0; k < 300; k++) {
      const input = randomVdrop();
      const f = R.between(0.1, 10);
      const base = compute('vdrop', input);
      const longer = compute('vdrop', { ...input, length: { ...input.length, value: input.length.value * f } });
      const more = compute('vdrop', { ...input, current: input.current! * f });
      expect(relEq(v(longer, 'u'), f * v(base, 'u'))).toBe(true);
      expect(relEq(v(more, 'u'), f * v(base, 'u'))).toBe(true);
      expect(relEq(v(longer, 'deltaUPercent'), f * v(base, 'deltaUPercent'))).toBe(true);
    }
  });

  it('n parallel conductors divide the drop (resistive and reactive part) by n', () => {
    for (let k = 0; k < 200; k++) {
      const input = { ...randomVdrop(), parallel: 1 };
      const n = R.int(2, 6);
      const one = compute('vdrop', input);
      const many = compute('vdrop', { ...input, parallel: n });
      expect(relEq(v(many, 'u'), v(one, 'u') / n)).toBe(true);
      expect(relEq(v(many, 'r'), v(one, 'r') / n)).toBe(true);
    }
  });

  it('Δu falls as the cross-section grows (monotonic over the standard list)', () => {
    for (let k = 0; k < 100; k++) {
      const input = randomVdrop();
      let last = Infinity;
      for (const s of EU_DE.metricSizesMm2) {
        const pct = v(compute('vdrop', { ...input, size: { value: s, unit: 'mm2' } }), 'deltaUPercent');
        expect(pct).toBeLessThan(last);
        last = pct;
      }
    }
  });

  it('A14: the minimum section meets the limit and the next smaller standard size does not', () => {
    let found = 0;
    let none = 0;
    for (let k = 0; k < 400; k++) {
      const input = randomVdrop();
      const r = compute('vdrop', input);
      const awg = input.size.unit === 'awg';
      if (!r.values.minSize) {
        expect(r.warnings.map((w) => w.code)).toContain('vdrop.noStandardSize');
        // the largest size of the list does not meet the limit either
        const largest: Size = awg ? { value: -3, unit: 'awg' } : { value: 300, unit: 'mm2' };
        expect(v(compute('vdrop', { ...input, size: largest }), 'deltaUPercent')).toBeGreaterThan(input.limitPercent);
        none++;
        continue;
      }
      found++;
      const min = v(r, 'minSize');
      const atMin = compute('vdrop', { ...input, size: { value: min, unit: awg ? 'awg' : 'mm2' } });
      expect(v(atMin, 'deltaUPercent')).toBeLessThanOrEqual(input.limitPercent * (1 + 1e-12));
      expect(relEq(v(atMin, 'deltaUPercent'), v(r, 'minSizePercent'))).toBe(true);
      const list = awg ? EU_DE.awgGauges : EU_DE.metricSizesMm2;
      const i = list.indexOf(min);
      if (i > 0) {
        const smaller = compute('vdrop', { ...input, size: { value: list[i - 1], unit: awg ? 'awg' : 'mm2' } });
        expect(v(smaller, 'deltaUPercent')).toBeGreaterThan(input.limitPercent);
      }
    }
    expect(found).toBeGreaterThan(100);
    expect(none).toBeGreaterThan(5);
  });

  it('A14: Δu at L_max equals the limit (rel 1e-9) and the verdict there is "within"', () => {
    for (let k = 0; k < 300; k++) {
      const input = randomVdrop();
      const r = compute('vdrop', input);
      const lMax = v(r, 'lMax');
      const at = compute('vdrop', { ...input, length: { value: lMax, unit: 'm' } });
      expect(relEq(v(at, 'deltaUPercent'), input.limitPercent)).toBe(true);
      expect(at.texts.verdict).toBe('within');
    }
  });

  it('switching length and size units keeps the physical value (ft ↔ m, AWG/kcmil ↔ mm²)', () => {
    for (let k = 0; k < 100; k++) {
      const input = { ...randomVdrop(), length: { value: R.between(1, 300), unit: 'ft' as const } };
      const inM = compute('vdrop', { ...input, length: { value: ftToM(input.length.value), unit: 'm' } });
      expect(relEq(v(compute('vdrop', input), 'u'), v(inM, 'u'), 1e-12)).toBe(true);
      const g = R.int(-3, 20);
      const asAwg = compute('vdrop', { ...input, size: { value: g, unit: 'awg' } });
      const asMm2 = compute('vdrop', { ...input, size: { value: awgAreaMm2(g), unit: 'mm2' } });
      expect(relEq(v(asAwg, 'u'), v(asMm2, 'u'), 1e-12)).toBe(true);
      const kc = R.between(250, 1000);
      const asKcmil = compute('vdrop', { ...input, size: { value: kc, unit: 'kcmil' } });
      expect(relEq(v(asKcmil, 'u'), v(compute('vdrop', { ...input, size: { value: kcmilToMm2(kc), unit: 'mm2' } }), 'u'), 1e-12)).toBe(true);
    }
  });

  it('the selected method and its percentM value agree; disagreement warning ⇔ opposite verdicts', () => {
    for (let k = 0; k < 300; k++) {
      const input = randomVdrop();
      const r = compute('vdrop', input);
      const method = input.method!;
      expect(v(r, `percent${method}`)).toBe(v(r, 'deltaUPercent'));
      const within = (pct: number) => pct <= input.limitPercent * (1 + 1e-12);
      const opposite = METHODS.filter((m) => m !== method && within(v(r, `percent${m}`)) !== within(v(r, 'deltaUPercent')));
      expect(r.warnings.filter((w) => w.code === 'method.disagree').length).toBe(opposite.length);
    }
  });
});

describe('unit round trips', () => {
  it('AWG → mm² → AWG and kcmil/ft round trips', () => {
    for (let n = -3; n <= 40; n++) expect(Math.abs(awgFromAreaMm2(awgAreaMm2(n)) - n)).toBeLessThan(1e-9);
    for (let k = 0; k < 500; k++) {
      const x = R.between(0.001, 1e5);
      expect(relEq(mToFt(ftToM(x)), x, 1e-14)).toBe(true);
      expect(relEq(mm2ToKcmil(kcmilToMm2(x)), x, 1e-14)).toBe(true);
    }
  });

  it('convert: mm² of an AWG size gives that AWG back as at-least and at-most', () => {
    for (let n = -3; n <= 40; n++) {
      const r = compute('convert', { from: 'mm2', value: awgAreaMm2(n) });
      expect(v(r, 'awgAtLeast')).toBe(n);
      expect(v(r, 'awgAtMost')).toBe(n);
      expect(Math.abs(v(r, 'awgExact') - n)).toBeLessThan(1e-9);
    }
  });
});

describe('coordination properties', () => {
  it('the suggested MCB rating satisfies C1–C3 and no smaller preferred rating does', () => {
    let suggested = 0;
    for (let k = 0; k < 500; k++) {
      const ib = R.between(1, 120);
      const input = {
        ib,
        device: { type: 'mcb' as const, curve: R.pick(['B', 'C', 'D'] as const), ratedCurrent: R.pick(EU_DE.mcbRatingsA) },
        izTyped: R.between(5, 200),
        insulationMaxC: R.pick([70, 90]),
        referenceAmbientC: R.pick([20, 30]),
        ambientC: R.between(0, 60),
        fGroup: R.pick([1, 0.8, 0.7, 0.5]),
      };
      const r = compute('coord', input);
      if (!r.ok) {
        expect(r.errors.map((e) => e.code)).toEqual(expect.arrayContaining([expect.stringMatching(/coord\.(ambient|factor)/)]));
        continue;
      }
      const iz = v(r, 'iz');
      if (r.texts.suggestion === undefined) {
        expect(r.warnings.map((w) => w.code)).toContain('coord.noRating');
        expect(EU_DE.mcbRatingsA.some((x) => ib <= x && x <= iz)).toBe(false);
        continue;
      }
      suggested++;
      const inS = v(r, 'suggestedIn');
      const check = compute('coord', { ...input, device: { ...input.device, ratedCurrent: inS } });
      expect(check.checks.map((c) => c.met)).toEqual([true, true, true]);
      for (const smaller of EU_DE.mcbRatingsA.filter((x) => x < inS)) {
        const c = compute('coord', { ...input, device: { ...input.device, ratedCurrent: smaller } });
        expect(c.checks.every((x) => x.met)).toBe(false);
      }
    }
    expect(suggested).toBeGreaterThan(100);
  });
});

describe('loop properties', () => {
  it('Zs at L_max equals Zs_max; Zs grows linearly with L', () => {
    for (let k = 0; k < 300; k++) {
      const input = {
        u0: 230,
        ze: R.between(0.05, 1.2),
        material: R.pick(['cu', 'al'] as const),
        lineSize: { value: R.pick([1.5, 2.5, 4, 6, 10, 16]), unit: 'mm2' as const },
        peSize: { value: R.pick([1.5, 2.5, 4, 6, 10, 16]), unit: 'mm2' as const },
        length: { value: R.between(1, 200), unit: 'm' as const },
        device: { type: 'mcb' as const, curve: R.pick(['B', 'C', 'D'] as const), ratedCurrent: R.pick([6, 10, 13, 16, 20, 25, 32]) },
        cmin: R.pick([1, 0.95]),
      };
      const r = compute('loop', input);
      if (!r.values.lMax) {
        expect(r.warnings.map((w) => w.code)).toContain('loop.zeExceeds');
        expect(input.ze).toBeGreaterThanOrEqual(v(r, 'zsMax'));
        continue;
      }
      const at = compute('loop', { ...input, length: { value: v(r, 'lMax'), unit: 'm' } });
      expect(relEq(v(at, 'zs'), v(r, 'zsMax'))).toBe(true);
      expect(at.checks[0].met).toBe(true);
      const twice = compute('loop', { ...input, length: { value: 2 * input.length.value, unit: 'm' } });
      expect(relEq(v(twice, 'zs') - input.ze, 2 * (v(r, 'zs') - input.ze))).toBe(true);
    }
  });
});
