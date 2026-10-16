import { compute } from '@/engine';
import { explain } from '@/engine/explain';

import { formatDate, formatNumber, formatPlain, isoDate, reportFileName, safeFileStem } from './format';

describe('display rounding (D22)', () => {
  it('rounds by unit, English decimal point', () => {
    expect(formatNumber(3.7565217391, '%', 'en')).toBe('3.76 %'); // U1
    expect(formatNumber(2.346864, '%', 'en')).toBe('2.35 %');
    expect(formatNumber(0.1234, '%', 'en')).toBe('0.123 %');
    expect(formatNumber(12.34, '%', 'en')).toBe('12.3 %');
    expect(formatNumber(8.64, 'V', 'en')).toBe('8.64 V');
    expect(formatNumber(221.36, 'V', 'en')).toBe('221.36 V');
    expect(formatNumber(230, 'V', 'en')).toBe('230 V');
    expect(formatNumber(1.0376436782, 'Ω', 'en')).toBe('1.038 Ω');
    expect(formatNumber(14.9666295471, 'A', 'en')).toBe('14.97 A');
    expect(formatNumber(91.7989970748, 'm', 'en')).toBe('91.8 m'); // U5
    expect(formatNumber(14.375, 'm', 'en')).toBe('14.4 m');
    expect(formatNumber(2.0525253885, 'mm', 'en')).toBe('2.053 mm');
    expect(formatNumber(0.0206293103, 'Ω·mm²/m', 'en')).toBe('0.0206293 Ω·mm²/m');
    expect(formatNumber(0.9354143467, '', 'en')).toBe('0.9354');
    expect(formatNumber(16, '', 'en')).toBe('16');
    expect(formatNumber(12345.678, 'W', 'en')).toBe('12345.68 W'); // no grouping, integers never lose digits
    expect(formatNumber(-3, 'AWG', 'en')).toBe('AWG 4/0');
  });
  it('German decimal comma, same rounding', () => {
    expect(formatNumber(3.7565217391, '%', 'de')).toBe('3,76 %');
    expect(formatNumber(221.36, 'V', 'de')).toBe('221,36 V');
    expect(formatPlain(1.5, 'mm²', 'de')).toBe('1,5');
  });
  it('never prints -0, NaN-safe, huge numbers keep their digits', () => {
    expect(formatPlain(-0, 'V', 'en')).toBe('0');
    expect(formatPlain(-0.0001, 'V', 'en')).toBe('0');
    expect(formatPlain(Number.NaN, 'V', 'en')).toBe('NaN');
    expect(formatPlain(123456789, 'A', 'en')).toBe('123456789');
  });
  it('plugs into explain(): the working shows the D22 rounding', () => {
    const r = compute('vdrop', { system: 'ac1', voltage: 230, current: 16, length: { value: 18, unit: 'm' }, material: 'cu', size: { value: 1.5, unit: 'mm2' }, cosPhi: 1, limitPercent: 3 });
    const pct = r.steps.find((s) => s.key === 'step.vdrop.percent')!;
    expect(explain(pct, 'en', formatNumber)).toBe('Δu = 100 × u / U0 = 100 × 8.64 V / 230 V = 3.76 %');
    expect(explain(pct, 'de', formatNumber)).toBe('Δu = 100 × u / U0 = 100 × 8,64 V / 230 V = 3,76 %');
  });
});

describe('dates and file names', () => {
  const ms = new Date(2026, 9, 1, 12, 0, 0).getTime();
  it('formats dates per language', () => {
    expect(formatDate(ms, 'en')).toBe('2026-10-01');
    expect(formatDate(ms, 'de')).toBe('01.10.2026');
    expect(isoDate(ms)).toBe('2026-10-01');
  });
  it('report file name: <project>-<date>.pdf, safe characters, umlauts kept', () => {
    expect(reportFileName('Müller, Küche', ms)).toBe('Müller-Küche-2026-10-01.pdf');
    expect(reportFileName('../../etc/passwd', ms)).toBe('etc-passwd-2026-10-01.pdf');
    expect(reportFileName('   ', ms)).toBe('report-2026-10-01.pdf');
    expect(reportFileName('<script>"x"', ms)).toBe('script-x-2026-10-01.pdf');
    expect(safeFileStem('a'.repeat(200)).length).toBe(60);
    expect(reportFileName('Straße Ö/ÄÜ ß', ms)).toBe('Straße-Ö-ÄÜ-ß-2026-10-01.pdf');
    expect(reportFileName('日本語', ms)).toBe('report-2026-10-01.pdf');
  });
});
