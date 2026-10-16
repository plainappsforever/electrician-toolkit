/** @jest-environment node */
// The calculator forms (what a person types) reproduce SPEC E1–E8: fixture input → form text → built input → engine gives
// the same values, texts, checks and warnings as the fixture input itself (A1 "through the UI model"); both decimal
// conventions; unreadable fields are reported, hidden fields never reach the engine (D53).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compute, type CalcKind } from '@/engine';

import { buildInput, formFromInput, initialForm, numText } from './calc-form';

type Fixture = { id: string; cases: { name: string; kind: CalcKind; input: unknown }[] };
const DIR = join(__dirname, '../../test/fixtures/engine');
const fixtures: Fixture[] = readdirSync(DIR)
  .filter((f) => /^e\d+\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));

describe('form model reproduces the worked examples', () => {
  for (const fixture of fixtures) {
    for (const c of fixture.cases) {
      for (const conv of ['en', 'de'] as const) {
        it(`${fixture.id} ${c.name} (${conv})`, () => {
          const form = formFromInput(c.kind, c.input, conv);
          const { input, problems } = buildInput(c.kind, form, conv);
          expect(problems).toEqual({});
          const want = compute(c.kind, c.input as never);
          const got = compute(c.kind, input as never);
          expect(got.errors).toEqual(want.errors);
          expect(Object.keys(got.values).sort()).toEqual(Object.keys(want.values).sort());
          for (const [name, v] of Object.entries(want.values)) expect(got.values[name].value).toBeCloseTo(v.value, 9);
          expect(got.texts).toEqual(want.texts);
          expect(got.checks.map((x) => [x.id, x.met])).toEqual(want.checks.map((x) => [x.id, x.met]));
          expect(got.warnings.map((x) => x.code)).toEqual(want.warnings.map((x) => x.code));
        });
      }
    }
  }
});

describe('typing', () => {
  it('E1 typed as in U1: 230, 16, 18, 1.5 gives 3.7565 %', () => {
    const f = initialForm('vdrop');
    f.current = '16';
    f.length = '18';
    f.size = '1.5';
    const { input, problems } = buildInput('vdrop', f, 'en');
    expect(problems).toEqual({});
    const r = compute('vdrop', input);
    expect(r.values.deltaUPercent.value).toBeCloseTo(3.7565217391, 9);
    expect(r.texts.verdict).toBe('exceeds');
  });

  it('decimal comma in German, point in English, both parse', () => {
    const f = initialForm('vdrop', undefined, 'de');
    f.current = '16';
    f.length = '18,5';
    f.size = '1,5';
    expect(buildInput('vdrop', f, 'de').input).toMatchObject({ length: { value: 18.5 }, size: { value: 1.5 } });
    f.length = '18.5';
    expect(buildInput('vdrop', f, 'de').input).toMatchObject({ length: { value: 18.5 } });
  });

  it('numText never writes an ambiguous grouping', () => {
    expect(numText(1.234, 'de')).toBe('1,234');
    expect(numText(0.001, 'de')).toBe('0,001');
    expect(numText(1234, 'en')).toBe('1234');
  });

  it('an unreadable field is reported and left out; an empty one is simply absent', () => {
    const f = initialForm('vdrop');
    f.current = 'abc';
    f.length = '-5';
    const { input, problems } = buildInput('vdrop', f, 'en');
    expect(problems).toEqual({ current: 'invalid', length: 'negative' });
    expect(input).not.toHaveProperty('current');
    expect(input).not.toHaveProperty('length');
  });

  it('DC: cos φ and X\' are not passed; with a current typed η is not passed (D53)', () => {
    const f = initialForm('vdrop');
    f.system = 'dc';
    f.cosPhi = '0,8';
    f.reactance = '0.1';
    f.efficiency = '0.9';
    f.current = '20';
    const { input } = buildInput('vdrop', f, 'en');
    expect(input).not.toHaveProperty('cosPhi');
    expect(input).not.toHaveProperty('reactanceOhmPerM');
    expect(input).not.toHaveProperty('efficiency');
  });

  it("the limit preset 'custom' is never passed; a preset passes its own percent", () => {
    const f = initialForm('vdrop');
    f.preset = 'custom';
    f.limit = '4';
    expect(buildInput('vdrop', f, 'en').input).toMatchObject({ limitPercent: 4 });
    expect(buildInput('vdrop', f, 'en').input).not.toHaveProperty('limitPreset');
    f.preset = 'vde-ar-n-4100';
    expect(buildInput('vdrop', f, 'en').input).toMatchObject({ limitPreset: 'vde-ar-n-4100', limitPercent: 0.5 });
  });

  it('power in kW is converted exactly (3.68 kW = 3680 W) and reopens as typed', () => {
    const f = initialForm('current');
    f.voltage = '230';
    f.power = '3.68';
    f.powerUnit = 'kW';
    const { input } = buildInput('current', f, 'en');
    expect((input as { power: number }).power).toBe(3680);
    const back = formFromInput('current', input, 'en');
    expect(back.power).toBe('3.68');
    expect(back.powerUnit).toBe('kW');
  });

  it('AWG sizes round-trip through their label (4/0 = -3)', () => {
    const f = initialForm('resistance');
    f.size = '4/0';
    f.sizeUnit = 'awg';
    f.length = '10';
    const { input } = buildInput('resistance', f, 'en');
    expect(input).toMatchObject({ size: { value: -3, unit: 'awg' } });
    expect(formFromInput('resistance', input, 'en').size).toBe('4/0');
  });
});
