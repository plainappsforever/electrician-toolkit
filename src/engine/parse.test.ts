import { numberConvention, parseAwg, parseNumber } from './parse';

describe('parseNumber (D26: decimal comma and point everywhere)', () => {
  it('accepts comma and point in both conventions', () => {
    for (const c of ['en', 'de'] as const) {
      expect(parseNumber('1,5', c)).toEqual({ ok: true, value: 1.5 });
      expect(parseNumber('1.5', c)).toEqual({ ok: true, value: 1.5 });
      expect(parseNumber(' 230 ', c)).toEqual({ ok: true, value: 230 });
      expect(parseNumber(',5', c)).toEqual({ ok: true, value: 0.5 });
    }
  });

  it('grouping by convention; both separators → last is decimal', () => {
    expect(parseNumber('1,250', 'en')).toEqual({ ok: true, value: 1250 });
    expect(parseNumber('1.250', 'en')).toEqual({ ok: true, value: 1.25 });
    expect(parseNumber('1.250', 'de')).toEqual({ ok: true, value: 1250 });
    expect(parseNumber('1,250', 'de')).toEqual({ ok: true, value: 1.25 });
    expect(parseNumber('22.000,5', 'en')).toEqual({ ok: true, value: 22000.5 });
    expect(parseNumber('22,000.5', 'de')).toEqual({ ok: true, value: 22000.5 });
    expect(parseNumber('1 000', 'de')).toEqual({ ok: true, value: 1000 });
  });

  it('refuses garbage; negative only when allowed (temperatures)', () => {
    expect(parseNumber('', 'en')).toEqual({ ok: false, error: 'empty' });
    for (const bad of ['abc', '1e3', '1,2,3,4', '1..5', '12 V', '-', '.']) expect(parseNumber(bad, 'en').ok).toBe(false);
    expect(parseNumber('-5', 'de')).toEqual({ ok: false, error: 'negative' });
    expect(parseNumber('-5,5', 'de', { allowNegative: true })).toEqual({ ok: true, value: -5.5 });
    expect(parseNumber('−10', 'de', { allowNegative: true })).toEqual({ ok: true, value: -10 });
    expect(parseNumber('-0', 'en', { allowNegative: true })).toEqual({ ok: true, value: 0 });
  });

  it('device decimal separator decides the convention', () => {
    expect(numberConvention(',', 'en')).toBe('de');
    expect(numberConvention('.', 'de')).toBe('en');
    expect(numberConvention(undefined, 'de')).toBe('de');
  });
});

describe('parseAwg', () => {
  it('reads 12, 1/0 … 4/0, 00 … 0000', () => {
    expect(parseAwg('12')).toEqual({ ok: true, value: 12 });
    expect(parseAwg('AWG 10')).toEqual({ ok: true, value: 10 });
    expect(parseAwg('0')).toEqual({ ok: true, value: 0 });
    expect(parseAwg('1/0')).toEqual({ ok: true, value: 0 });
    expect(parseAwg('2/0')).toEqual({ ok: true, value: -1 });
    expect(parseAwg('4/0')).toEqual({ ok: true, value: -3 });
    expect(parseAwg('0000')).toEqual({ ok: true, value: -3 });
    expect(parseAwg('')).toEqual({ ok: false, error: 'empty' });
    expect(parseAwg('12.5').ok).toBe(false);
  });
});
