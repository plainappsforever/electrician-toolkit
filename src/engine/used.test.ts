// D53 (review finding 2): usedInput drops exactly the fields the engine ignores. Invariant over every oracle input
// (valid and invalid): computing from the used input gives the same result, and usedInput is idempotent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compute, usedInput, type CalcKind } from './index';

const DIR = join(__dirname, '..', '..', 'test', 'fixtures', 'oracle');
const KINDS: CalcKind[] = ['vdrop', 'current', 'ohm', 'coord', 'loop', 'resistance', 'convert'];
type Case = { id: string; kind: CalcKind; input: unknown };

describe('usedInput invariant over the oracle inputs', () => {
  for (const kind of KINDS) {
    it(`${kind}: compute(usedInput(x)) equals compute(x); idempotent`, () => {
      const cases = JSON.parse(readFileSync(join(DIR, `${kind}.json`), 'utf8')) as Case[];
      let dropped = 0;
      for (const c of cases) {
        const used = usedInput(kind, c.input);
        const a = compute(kind, c.input as never);
        const b = compute(kind, used as never);
        if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${c.id}: ${JSON.stringify(c.input)} → ${JSON.stringify(used)}`);
        expect(usedInput(kind, used)).toEqual(used);
        if (a.ok) expect(a.usedInput).toEqual(used);
        else expect(a.usedInput).toBeUndefined();
        if (JSON.stringify(used) !== JSON.stringify(c.input)) dropped++;
      }
      expect(cases.length).toBeGreaterThan(2000);
      if (kind === 'vdrop' || kind === 'loop' || kind === 'coord') expect(dropped).toBeGreaterThan(0);
    });
  }
});

describe('usedInput drops the ignored fields', () => {
  const base = { system: 'dc', voltage: 24, current: 20, length: { value: 10, unit: 'm' }, material: 'cu', size: { value: 6, unit: 'mm2' }, limitPercent: 3 };
  it('DC voltage drop: cos φ, X\' and η (current given) are not used', () => {
    const r = compute('vdrop', { ...base, cosPhi: 0.8, efficiency: 1.5, reactanceOhmPerM: 0.5, method: 'M1', kappa: 40 } as never);
    expect(r.ok).toBe(true);
    expect(r.usedInput).toEqual({ ...base, method: 'M1', kappa: 40 });
  });
  it('an invalid X\' on DC is still validated, so it is kept (the engine refuses it)', () => {
    const r = compute('vdrop', { ...base, reactanceOhmPerM: -1 } as never);
    expect(r.ok).toBe(false);
    expect(usedInput('vdrop', { ...base, reactanceOhmPerM: -1 })).toHaveProperty('reactanceOhmPerM', -1);
  });
  it('AC with power: η and cos φ are used; with current: η is not', () => {
    const ac = { ...base, system: 'ac1', current: undefined, power: 2000, cosPhi: 0.9, efficiency: 0.9 };
    expect(compute('vdrop', ac as never).usedInput).toMatchObject({ power: 2000, cosPhi: 0.9, efficiency: 0.9 });
    const withI = compute('vdrop', { ...base, system: 'ac1', cosPhi: 0.9, efficiency: 1.5 } as never);
    expect(withI.ok).toBe(true);
    expect(withI.usedInput).not.toHaveProperty('efficiency');
    expect(withI.usedInput).toHaveProperty('cosPhi', 0.9);
  });
  it('unknown fields and stray sub-fields are dropped', () => {
    const r = compute('vdrop', { ...base, '<x>': '<script>', length: { value: 10, unit: 'm', junk: 1 } } as never);
    expect(r.usedInput).toEqual(base);
  });
  it('measured loop: the cable fields are not used; calculated loop: the measured fields are not', () => {
    const measured = { mode: 'measured', u0: 230, device: { type: 'mcb', curve: 'B', ratedCurrent: 16, ia: 99 }, zsMeasured: 1.8, ze: 0.35, length: { value: 25, unit: 'm' }, material: 'cu' };
    expect(compute('loop', measured as never).usedInput).toEqual({ mode: 'measured', u0: 230, device: { type: 'mcb', curve: 'B', ratedCurrent: 16 }, zsMeasured: 1.8 });
    const calc = { u0: 230, device: { type: 'other', ia: 160, ratedCurrent: 32 }, ze: 0.35, material: 'cu', lineSize: { value: 1.5, unit: 'mm2' }, peSize: { value: 1.5, unit: 'mm2' }, length: { value: 25, unit: 'm' }, zsMeasured: 9, measuredFactor: 0.8 };
    expect(compute('loop', calc as never).usedInput).toEqual({ u0: 230, device: { type: 'other', ia: 160 }, ze: 0.35, material: 'cu', lineSize: { value: 1.5, unit: 'mm2' }, peSize: { value: 1.5, unit: 'mm2' }, length: { value: 25, unit: 'm' } });
  });
  it('coordination: a typed f_θ makes ambient and reference temperatures unused', () => {
    const r = compute('coord', { ib: 13, device: { type: 'mcb', curve: 'B', ratedCurrent: 16 }, izTyped: 20, insulationMaxC: 70, referenceAmbientC: 30, ambientC: 40, fTheta: 0.9 } as never);
    expect(r.ok).toBe(true);
    expect(r.usedInput).toEqual({ ib: 13, device: { type: 'mcb', curve: 'B', ratedCurrent: 16 }, izTyped: 20, fTheta: 0.9 });
  });
  it('current/power on DC: cos φ is not used', () => {
    expect(compute('current', { system: 'dc', voltage: 24, current: 2, cosPhi: 0.5 }).usedInput).toEqual({ system: 'dc', voltage: 24, current: 2 });
  });
  it('error results carry no usedInput', () => {
    expect(compute('vdrop', { ...base, voltage: 0 } as never).usedInput).toBeUndefined();
  });
});
