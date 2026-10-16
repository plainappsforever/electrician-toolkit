// Nameplate parser (V1.5 phase A, NW2): unit tests for each layout and OCR repair, and seeded property tests.
// Accuracy over whole fixture sets: nameplate-fixtures.test.ts.
import { rng } from '../../test/seeded-random';

import { NAMEPLATE_FIELDS, normalizeLine, offered, OFFER_THRESHOLD, parseDecimal, parseNameplate, repairFactor, unglue, type Candidate, type NameplateField, type NameplateReading } from './nameplate';

const values = (r: NameplateReading, field: NameplateField) => offered(r, field).map((c) => (typeof c.value === 'number' ? c.base ?? c.value : c.value));
const one = (lines: string | string[], field: NameplateField) => values(parseNameplate(lines), field);

describe('parseDecimal: OCR digits and decimal separators', () => {
  it.each([
    ['400', 400, []],
    ['1,5', 1.5, []],
    ['1.5', 1.5, []],
    ['4O0', 400, ['O→0']],
    ['l450', 1450, ['l→1']],
    ['1,S', 1.5, ['S→5']],
    ['B,2', 8.2, ['B→8']],
    ['O,82', 0.82, ['O→0']],
    ['.82', 0.82, []],
    ['1.234,5', 1234.5, []],
    ['20.000.000', 20000000, []],
  ])('%s → %d', (text, value, repairs) => {
    expect(parseDecimal(text)).toMatchObject({ value, repairs });
  });
  it('a lone separator with three digits after it also offers the grouped reading', () => {
    expect(parseDecimal('1.450')).toEqual({ value: 1.45, alt: 1450, repairs: [] });
    expect(parseDecimal('0.750')).toEqual({ value: 0.75, repairs: [] });
  });
  it('refuses text that is no number', () => {
    for (const t of ['', 'kW', 'OO', '1.2.3', 'S', '1,2.3,4']) expect(parseDecimal(t)).toBeNull();
  });
});

describe('normalizeLine', () => {
  it('folds the Unicode and OCR spellings of Δ, φ, ~, minus and min⁻¹', () => {
    expect(normalizeLine('∆/Y  400/690 V')).toBe('Δ/Y 400/690 V');
    expect(normalizeLine('cos ϕ 0,8')).toBe('cos φ 0,8');
    expect(normalizeLine('COS Φ 0.8')).toBe('COS φ 0.8');
    expect(normalizeLine('1440 min⁻¹')).toBe('1440 min-1');
    expect(normalizeLine("1440 min'1")).toBe('1440 min-1');
    expect(normalizeLine('3∼ 400 V')).toBe('3~ 400 V');
    expect(normalizeLine('U 3~400 V')).toBe('U 3~ 400 V');
    expect(normalizeLine('２３０ Ｖ')).toBe('230 V');
  });
});

describe('units: value first, unit first, glued, pairs and ranges', () => {
  it('value then unit, glued or apart, decimal comma or point', () => {
    const r = parseNameplate(['400V 50Hz 1,5kW 3.4 A', '1440 min-1']);
    expect(values(r, 'voltage')).toEqual([400]);
    expect(values(r, 'frequency')).toEqual([50]);
    expect(values(r, 'power')).toEqual([1500]);
    expect(values(r, 'current')).toEqual([3.4]);
    expect(values(r, 'speed')).toEqual([1440]);
  });
  it('unit then value (SEW layout), including two units on one line', () => {
    const r = parseNameplate(['kW 1.5 S1', 'r/min 1400/73', 'V 380-500', 'A 3.5 Hz 50']);
    expect(values(r, 'power')).toEqual([1500]);
    expect(values(r, 'speed')).toEqual([1400]); // 73 is the gear output: kept, not offered
    expect(r.candidates.speed.find((c) => c.value === 73)?.evidence).toContain('secondary');
    expect(values(r, 'voltage').sort()).toEqual([380, 500]);
    expect(values(r, 'current')).toEqual([3.5]);
    expect(values(r, 'frequency')).toEqual([50]);
    expect(values(r, 'duty')).toEqual(['S1']);
  });
  it('"S1 kW 1.5" is never 51 kW: duty codes, IE/IP and mounting codes are not numbers', () => {
    expect(one('S1 kW 1.5 IM B3', 'power')).toEqual([1500]);
    expect(one('IE3 400 V', 'voltage')).toEqual([400]);
  });
  it('a value is claimed by its own unit, not by the unit before it ("V 18,2 A")', () => {
    const r = parseNameplate(['OS 20000 V ± 2x2,5 % 18,2 A']);
    expect(values(r, 'voltage')).toEqual([20000]);
    expect(values(r, 'current')).toEqual([18.2]);
  });
  it('kV, kVA, VA, HP, PS, mA convert to the base unit and keep the printed unit', () => {
    const r = parseNameplate(['20 kV / 0,4 kV 630 kVA', '2 PS 1/2 HP 160 VA 450 mA']);
    expect(values(r, 'voltage').sort((a, b) => Number(a) - Number(b))).toEqual([400, 20000]);
    const units = offered(r, 'power').map((c) => `${c.value} ${c.unit}`);
    expect(units).toEqual(expect.arrayContaining(['630 kVA', '2 PS', '0.5 HP', '160 VA']));
    expect(values(r, 'current')).toEqual([0.45]);
  });
  it('fractional horsepower: "1/2", "3/4", "1-1/2"', () => {
    expect(one('HP 3/4 RPM 1725', 'power')[0]).toBeCloseTo(745.7 * 0.75, 9);
    expect(one('1-1/2 HP', 'power')[0]).toBeCloseTo(745.7 * 1.5, 9);
    expect(offered(parseNameplate('HP 3/4'), 'power')[0]).toMatchObject({ value: 0.75, unit: 'HP' });
  });
  it('a cell per line (column-wise OCR): a lone unit joins the lone number on the next line', () => {
    const r = parseNameplate(['V', '400/690', 'cos φ', '0,80', 'Hz', '50']);
    expect(values(r, 'voltage')).toEqual([400, 690]);
    expect(values(r, 'cosPhi')).toEqual([0.8]);
    expect(values(r, 'frequency')).toEqual([50]);
  });
});

describe('Δ/Y connections', () => {
  it('a Δ/Y marker names both halves of a pair, for voltages and currents', () => {
    const r = parseNameplate(['400/690 V Δ/Y 6,2/3,6 A']);
    const conn = (f: NameplateField) => offered(r, f).map((c) => `${c.value}${c.connection === 'delta' ? 'Δ' : 'Y'}`);
    expect(conn('voltage')).toEqual(['400Δ', '690Y']);
    expect(conn('current')).toEqual(['6.2Δ', '3.6Y']);
  });
  it('markers glued to each half, also inside ranges', () => {
    const r = parseNameplate(['V 230Δ/400Y', '380-415D/660-690Y V']);
    const got = offered(r, 'voltage').map((c) => `${c.value}${c.connection === 'delta' ? 'Δ' : 'Y'}`).sort();
    expect(got).toEqual(['230Δ', '380Δ', '400Y', '415Δ', '660Y', '690Y']);
  });
  it('one marker per row ("Δ 230 V 3,4 A" / "Y 400 V 1,97 A") and markers after the unit', () => {
    const r = parseNameplate(['Δ 230 V 3,4 A', 'Y 400 V 1,97 A', '400 V Y 1,45 A']);
    expect(offered(r, 'current').map((c) => `${c.value}${c.connection}`)).toEqual(expect.arrayContaining(['3.4delta', '1.97star', '1.45star']));
    const r2 = parseNameplate(['230 V Δ 400 V Y']);
    expect(offered(r2, 'voltage').map((c) => `${c.value}${c.connection}`)).toEqual(['230delta', '400star']);
  });
  it('no marker → no connection claimed (L26: we never guess what the plate does not say)', () => {
    expect(offered(parseNameplate(['230/400 V']), 'voltage').map((c) => c.connection)).toEqual([undefined, undefined]);
  });
});

describe('cos φ in its spellings', () => {
  it.each([
    'cos phi 0.8',
    'cosφ 0,8',
    'cos φ = 0,80',
    'COS Φ 0.80',
    'cos ϕ 0,8',
    'cos ø 0,8',
    'cosphi 0.8',
    'cos fi 0,8',
    'PF 0.8',
    'P.F. 80',
    'PF 80 %',
    'Power factor: 0.80',
    'Leistungsfaktor 0,8',
    'cos phi O,8',
  ])('%s → 0.8', (line) => {
    expect(one(line, 'cosPhi')).toEqual([0.8]);
  });
  it('a value above 1 without a percent context is implausible and not offered', () => {
    const r = parseNameplate(['cos φ 8']);
    expect(values(r, 'cosPhi')).toEqual([]);
    expect(r.candidates.cosPhi[0].evidence).toContain('implausible');
  });
});

describe('labelled fields, German and English', () => {
  it('German labels with colons', () => {
    const r = parseNameplate(['Nennleistung: 7,5 kW', 'Nennstrom: 14,8 A', 'Nenndrehzahl: 1455', 'Wirkungsgrad: 90,4 %', 'Schutzart: IP55', 'Wärmeklasse: F', 'Betriebsart: S1', 'Seriennummer: 2019-04471', 'Typ: AM 132MN4']);
    expect(values(r, 'power')).toEqual([7500]);
    expect(values(r, 'current')).toEqual([14.8]);
    expect(values(r, 'speed')).toEqual([1455]); // label only, no unit
    expect(values(r, 'efficiency')).toEqual([90.4]);
    expect(values(r, 'ipRating')).toEqual(['IP55']);
    expect(values(r, 'insulationClass')).toEqual(['F']);
    expect(values(r, 'duty')).toEqual(['S1']);
    expect(values(r, 'serial')).toEqual(['2019-04471']);
    expect(values(r, 'type')).toEqual(['AM 132MN4']);
  });
  it('NEMA abbreviations: FLA, NOM EFF, INSUL CLASS, DUTY CONT, PH; service-factor amps are not the rating', () => {
    const r = parseNameplate(['FLA 7.2 VOLTS 460 HZ 60 PH 3', 'SF 1.15 SF AMPS 8.3', 'NEMA NOM. EFF. 91.0 GUARANTEED EFF 89.5', 'INSUL CLASS F DUTY CONT']);
    expect(values(r, 'current')).toEqual([7.2]);
    expect(r.candidates.current.find((c) => c.value === 8.3)?.evidence).toContain('secondary');
    expect(values(r, 'efficiency')).toEqual([91]);
    expect(values(r, 'insulationClass')).toEqual(['F']);
    expect(values(r, 'duty')).toEqual(['S1']);
    expect(values(r, 'phases')).toEqual(['3']);
  });
  it('insulation class spellings', () => {
    for (const line of ['Isol.-Kl. F', 'Isol.Kl. F', 'Iso.Kl. F', 'Th.Cl. F', 'Th.Cl. 155(F)', 'Ins.cl. F', 'INS.CL.F', 'Insulation class F', 'Isolierstoffklasse F', 'Wärmeklasse F', 'CLASS F INSUL', 'INS CL F', '155 (F)']) {
      expect([line, one(line, 'insulationClass')]).toEqual([line, ['F']]);
    }
  });
  it('IP codes with OCR misreads', () => {
    for (const line of ['IP55', 'IP 55', 'lP55', '1P55', 'IP5S', '|P 55', 'IP-55']) expect([line, one(line, 'ipRating')]).toEqual([line, ['IP55']]);
    expect(one('IPX4', 'ipRating')).toEqual(['IPX4']);
    expect(one('IP69K', 'ipRating')).toEqual(['IP69K']);
    expect(one('IP77', 'ipRating')).toEqual([]); // first digit above 6 is no IP code
  });
  it('IE class and the efficiency printed with it', () => {
    const r = parseNameplate(['IE3-91.4%(100%) 91.7%(75%) 91.0%(50%)']);
    expect(values(r, 'ieClass')).toEqual(['IE3']);
    expect(values(r, 'efficiency')).toEqual([91.4]);
    expect(one('lE2 400 V', 'ieClass')).toEqual(['IE2']);
    expect(one('η 100% 84.1 %', 'efficiency')).toEqual([84.1]);
    expect(one('Eff. 0,896', 'efficiency')).toEqual([89.6]);
  });
  it('duty types incl. intermittent', () => {
    expect(one('S3 40% 0,55 kW', 'duty')).toEqual(['S3 40%']);
    expect(one('Duty: S6', 'duty')).toEqual(['S6']);
    expect(one('Dauerbetrieb', 'duty')).toEqual(['S1']);
  });
  it('phases', () => {
    for (const [line, n] of [['3~ Mot', '3'], ['~3 Mot', '3'], ['1~ Mot.', '1'], ['PH 3', '3'], ['3 Ph', '3'], ['Drehstrommotor', '3'], ['THREE PHASE MOTOR', '3'], ['Wechselstrommotor', '1']]) {
      expect([line, one(line, 'phases')]).toEqual([line, [n]]);
    }
  });
});

describe('what is NOT the rating', () => {
  it('capacitor, brake, fan lines are kept but not offered', () => {
    const r = parseNameplate(['230 V 50 Hz 2,9 A', 'Kond. 12 µF 450 V', 'Bremse 205 V DC 0,25 A']);
    expect(values(r, 'voltage')).toEqual([230]);
    expect(values(r, 'current')).toEqual([2.9]);
    expect(r.candidates.voltage.map((c) => c.value).sort()).toEqual([205, 230, 450]);
  });
  it('numbers inside a serial number or type are not ratings', () => {
    const r = parseNameplate(['Typ K21R 112 M4 Nr. 2018/0471123']);
    expect(values(r, 'voltage')).toEqual([]);
    expect(values(r, 'speed')).toEqual([]);
  });
  it('years, masses, standards and temperatures give no candidates', () => {
    const r = parseNameplate(['Bj. 2018 32 kg', 'IEC 60034-1 EN 60034', 'Ta 40 °C', 'Mat.: 123456']);
    for (const f of ['power', 'voltage', 'current', 'frequency', 'speed', 'cosPhi', 'efficiency'] as const) expect([f, values(r, f)]).toEqual([f, []]);
  });
  it('"1.450 min-1" is 1450 rpm (grouped), "1,5 V" stays 1.5 V', () => {
    expect(one('1.450 min-1', 'speed')).toEqual([1450]);
    expect(one('1,5 V', 'voltage')).toEqual([1.5]);
  });
});

describe('unit header tables (ABB/WEG layout)', () => {
  it('maps every row to its columns, keeps Δ/Y markers in the row', () => {
    const r = parseNameplate(['V Hz kW r/min A cos φ', '690 Y 50 11 1470 12.0 0.82', '400 D 50 11 1470 20.7 0.82', '460 D 60 12.6 1775 19.8 0.80']);
    expect(offered(r, 'voltage').map((c) => `${c.value}${c.connection}`)).toEqual(['690star', '400delta', '460delta']);
    expect(values(r, 'current')).toEqual([12, 20.7, 19.8]);
    expect(values(r, 'power')).toEqual([11000, 12600]);
    expect(values(r, 'frequency')).toEqual([50, 60]);
    expect(values(r, 'speed')).toEqual([1470, 1775]);
    expect(values(r, 'cosPhi')).toEqual([0.82, 0.8]);
    expect(offered(r, 'voltage').every((c) => c.evidence.includes('table'))).toBe(true);
  });
  it('a HP column is horsepower, not kW', () => {
    const r = parseNameplate(['V Hz A RPM kW HP', '460 60 13.1 1765 7.5 10']);
    expect(offered(r, 'power').map((c) => `${c.value} ${c.unit}`)).toEqual(['7.5 kW', '10 HP']);
  });
});

describe('candidates carry their source and never fill anything (L26)', () => {
  it('line index, source text, match, evidence and repairs are set', () => {
    const lines = ['Typ X', '4OO V 5O Hz'];
    const r = parseNameplate(lines);
    const v = r.candidates.voltage[0];
    expect(v).toMatchObject({ line: 1, source: '4OO V 5O Hz', value: 400, unit: 'V', repairs: ['O→0', 'O→0'] });
    expect(v.evidence).toEqual(expect.arrayContaining(['unit', 'ocr-repair']));
    expect(v.confidence).toBeCloseTo(0.8 * repairFactor(2), 10);
    expect(r.lines).toEqual(lines);
  });
  it('the input is not changed; the result is only lists (no "chosen" value exists in the API)', () => {
    const lines = Object.freeze(['400 V']);
    const r = parseNameplate(lines);
    expect(Object.keys(r).sort()).toEqual(['candidates', 'lines']);
    for (const f of NAMEPLATE_FIELDS) expect(Array.isArray(r.candidates[f])).toBe(true);
  });
  it('a single string with line breaks equals the same lines as an array', () => {
    expect(parseNameplate('400 V\n50 Hz\r\n1,5 kW')).toEqual(parseNameplate(['400 V', '50 Hz', '1,5 kW']));
  });
});

// Rules added AFTER the blind measurement (docs/V15_LOG.md A2/A3): each is a general OCR or layout form, tested here on
// texts written for this file, not copied from the blind set.
describe('OCR and layout forms added in round 2 (not blind any more)', () => {
  it('glued multi-unit tokens are split only where two different unit words touch numbers', () => {
    expect(unglue('5,5kW230VΔ2l,1A60Hz')).toEqual(['5,5', 'kW', '230', 'V', 'Δ', '2l,1', 'A', '60', 'Hz']);
    expect(unglue('V230/400A9,1/5,3PFO,77')).toEqual(['V', '230/400', 'A', '9,1/5,3', 'PF', 'O,77']);
    for (const code of ['1LE1002-2AA4', 'W4lR132M4', 'S4D400-AP12-01', '3GBP161410-ADG', '7,9/4,SSA']) expect(unglue(code)).toEqual([code]);
    const r = parseNameplate(['3~5,5kW230VΔ2l,1A60Hz', 'V230/400A9,1/5,3PFO,77']);
    expect(values(r, 'power')).toEqual([5500]);
    expect(values(r, 'frequency')).toEqual([60]);
    expect(values(r, 'cosPhi')).toEqual([0.77]);
    expect(values(r, 'current').sort((a, b) => Number(a) - Number(b))).toEqual([5.3, 9.1, 21.1]);
  });
  it('rn read for m, VV read for W, a split "kV A", thousands written with a space, "3x400 V"', () => {
    expect(one('1390 1/rnin', 'speed')).toEqual([1390]);
    expect(one('2,2kVV', 'power')).toEqual([2200]);
    expect(offered(parseNameplate('Rated power 160 kV A'), 'power').map((c) => `${c.value} ${c.unit}`)).toEqual(['160 kVA']);
    expect(one('HV 10 000 V', 'voltage')).toEqual([10000]);
    expect(one('IP 55 400 V', 'voltage')).toEqual([400]); // never "55400 V"
    expect(one('3x230 V 50 Hz', 'voltage')).toEqual([230]);
    expect(one('3x230 V 50 Hz', 'phases')).toEqual(['3']);
  });
  it('Δ read as A next to a Y half, and a Δ/Y-marked number without a unit, are voltages', () => {
    expect(offered(parseNameplate('230A/400Y 50Hz'), 'voltage').map((c) => `${c.value}${c.connection}`)).toEqual(['230delta', '400star']);
    expect(one('230A/400Y 50Hz', 'current')).toEqual([]);
    expect(offered(parseNameplate('690 Y 50 Hz'), 'voltage').map((c) => `${c.value}${c.connection}`)).toEqual(['690star']);
  });
  it('digit-less look-alikes count only right next to a unit ("SO Hz", "S,S kW"), and as cos φ after its label', () => {
    const r = parseNameplate(['400 D SO Hz S,S kW', 'lO,S A cos φ O,BB']);
    expect(values(r, 'frequency')).toEqual([50]);
    expect(values(r, 'power')).toEqual([5500]);
    expect(values(r, 'current')).toEqual([10.5]);
    expect(values(r, 'cosPhi')).toEqual([0.88]);
    expect(one('SO WHAT', 'frequency')).toEqual([]);
  });
  it('a unit wrapped to the start of the next line goes back to the bare numbers before it', () => {
    const r = parseNameplate(['6,1/3,5', 'A 2,2', 'kW 1430 rpm']);
    expect(values(r, 'current')).toEqual([6.1, 3.5]);
    expect(values(r, 'power')).toEqual([2200]);
    expect(values(r, 'speed')).toEqual([1430]);
    // a line with words keeps its number: "CAT 645" / "HP 3/4" is not 645 HP
    expect(offered(parseNameplate(['MOD X1 CAT 645', 'HP 3/4 RPM 1725']), 'power').map((c) => c.value)).toEqual([0.75]);
  });
  it('a table row whose last cell wrapped onto its own line', () => {
    const r = parseNameplate(['V Hz kW r/min A cos φ', '400 D 50 7.5 1455 14.6', '0.83', '690 Y 50 7.5 1455 8.4 0.83']);
    expect(values(r, 'cosPhi')).toEqual([0.83]);
    expect(values(r, 'current')).toEqual([14.6, 8.4]);
  });
  it('gear output speed, "l/min" without an n label, the gear ratio "i=" are not ratings', () => {
    const r = parseNameplate(['1400 rpm i=12,5 n2=112 1/min', 'Q 400 l/min']);
    expect(values(r, 'speed')).toEqual([1400]);
    expect(values(r, 'current')).toEqual([]);
    expect(one('n 2900 l/min', 'speed')).toEqual([2900]);
  });
  it('"Drehzahl 1455 min-1 50 Hz": a label with its own unit keeps the line value-first', () => {
    const r = parseNameplate(['Drehzahl 1455 min-1 50 Hz']);
    expect(values(r, 'speed')).toEqual([1455]);
    expect(values(r, 'frequency')).toEqual([50]);
  });
  it('efficiency with a "(100%)" load mark, IE written lE, part-load values not offered', () => {
    expect(one('IE2-88.0(100%)-88.4(75%)-87.1(50%)', 'efficiency')).toEqual([88]);
    expect(one('lE3-9l,2% (1OO%)', 'efficiency')).toEqual([91.2]);
  });
  it('NEMA forms: Premium class, CONT duty anywhere, "INS B", "CL F", IP with letters', () => {
    expect(one('SUPER-E NEMA PREMIUM', 'ieClass')).toEqual(['NEMA Premium']);
    expect(one('RATING 40C AMB-CONT', 'duty')).toEqual(['S1']);
    expect(one('FR 56 INS B AMB 40°C', 'insulationClass')).toEqual(['B']);
    expect(one('FRAME 215T CL F', 'insulationClass')).toEqual(['F']);
    expect(one('IPX4D TF 110', 'ipRating')).toEqual(['IPX4D']);
    expect(one('Sl 26 kg', 'duty')).toEqual(['S1']);
  });
  it('serial labels: "Nr.912345", "Nr.: 12345678", "SER.NO.", "SER.", "Nº", "NO.", digit groups, never a year', () => {
    expect(one('Th.Cl.F S1 Nr.912345/0021', 'serial')).toEqual(['912345/0021']);
    expect(one('Nr.: 9876543210 Datum 2347', 'serial')).toEqual(['9876543210']);
    expect(one('DE 6307 SER.NO. Z1903041234', 'serial')).toEqual(['Z1903041234']);
    expect(one('SER. MS1234567', 'serial')).toEqual(['MS1234567']);
    expect(one('Nº 1034567890 05JUN2024', 'serial')).toEqual(['1034567890']);
    expect(one('TYPE Y2-100L1-4 NO. 2105A0317', 'serial')).toEqual(['2105A0317']);
    expect(one('Fabrik-Nr. 7 384 552', 'serial')).toEqual(['7 384 552']);
    expect(one('No. 4523987123 2024', 'serial')).toEqual(['4523987123']);
    expect(one('SER.F. 1.15', 'serial')).toEqual([]); // service factor, not a serial number
  });
  it('type: explicit labels before "3~Mot.", stops at the next label, skips "DRY TYPE TRANSFORMER"', () => {
    expect(one('3~Mot. polumschaltbar Typ D 90 L 4/2', 'type')).toEqual(['D 90 L 4/2']);
    expect(one('CAT.NO. EM2334T SPEC. 37J012Y214', 'type')).toEqual(['EM2334T']);
    expect(one('MOD C48J2DB11C3 CAT 645', 'type')).toEqual(['C48J2DB11C3']);
    expect(one('DRY TYPE TRANSFORMER IEC 60076-11', 'type')).toEqual([]);
  });
});

// Fix round after the independent review (docs/REVIEW_V15_PA.md): every input below is the reviewer's failing input.
// L26 standard: offered (≥ 0.5) only when a label or unit anchors the value AND it is the rating; a line that cannot be
// read consistently offers nothing rather than a swapped field.
describe('REVIEW_V15_PA fix round: the reviewer\'s failing inputs', () => {
  const all = (lines: string | string[]) => {
    const r = parseNameplate(lines);
    return Object.fromEntries(NAMEPLATE_FIELDS.map((f) => [f, values(r, f)]).filter(([, v]) => (v as unknown[]).length > 0));
  };

  it('M1: one stray character before a number-first line does not flip the line', () => {
    for (const junk of ['_', "'", '*', '-', '»', '~']) {
      expect([junk, all(`${junk}400 V 50 Hz 7,5 kW 14,3 A`)]).toEqual([junk, { power: [7500], voltage: [400], current: [14.3], frequency: [50] }]);
    }
    expect(all('~230 V 50 Hz 0,55 kW 3,6 A')).toEqual({ power: [550], voltage: [230], current: [3.6], frequency: [50] });
    const r = parseNameplate('_50 Hz 400/690 V Δ/Y 3,0 kW 6,2/3,6 A');
    expect(values(r, 'power')).toEqual([3000]);
    expect(values(r, 'frequency')).toEqual([50]);
    expect(offered(r, 'voltage').map((c) => `${c.value}${c.connection}`)).toEqual(['400delta', '690star']);
  });
  it('M1: "3~ Mot. 400 VA 50 Hz" (Δ read as A after V) gives no type "400" and no 50 VA or 400 VA power', () => {
    const r = parseNameplate('3~ Mot. 400 VA 50 Hz');
    expect(values(r, 'type')).toEqual([]);
    expect(values(r, 'power')).toEqual([]);
    expect(values(r, 'frequency')).toEqual([50]);
  });
  it('M2: a table row that lost a cell offers nothing from that row (no shifted columns)', () => {
    const header = 'V Hz kW r/min A cos φ';
    expect(all([header, '400 D 50 1465 27.7 0.85'])).toEqual({});
    expect(all([header, '50 15 1465 27.7 0.85'])).toEqual({});
    expect(all(['V Hz A kW cos φ 1/min', '690 Y 50 6,5 0,83 1455'])).toEqual({});
    // a full row is still read, and a short row whose last cell wrapped onto the next line too
    expect(all([header, '400 D 50 15 1465 27.7 0.85'])).toMatchObject({ power: [15000], voltage: [400], speed: [1465], current: [27.7], cosPhi: [0.85] });
    expect(values(parseNameplate([header, '400 D 50 7.5 1455 14.6', '0.83']), 'cosPhi')).toEqual([0.83]);
  });
  it('M2: a full row that breaks the columns\' physics (I ≈ P / (√3·U·cos φ·η)) is not trusted', () => {
    // currents and powers swapped by OCR column order: 27.7 kW at 400 V cannot draw 15 A
    expect(all(['V Hz A kW r/min cos φ', '400 D 50 15 27.7 1465 0.85'])).toEqual({});
  });
  it('M3: guaranteed-minimum efficiency, service-factor amps, output speed, starting and test values are not offered', () => {
    for (const [line, field] of [
      ['Guaranteed Min. Eff. 89.5 %', 'efficiency'],
      ['GUARANTEED EFF 89.5', 'efficiency'],
      ['Mindestwirkungsgrad 88,0 %', 'efficiency'],
      ['SERVICE FACTOR AMPS 14.2', 'current'],
      ['S.F.A. 14.2', 'current'],
      ['Output speed 41 rpm', 'speed'],
      ['Abtriebsdrehzahl 41 1/min', 'speed'],
      ['n2 41 1/min', 'speed'],
      ['Starting current 100 A', 'current'],
      ['Anlaufstrom 100 A', 'current'],
      ['Locked rotor amps 96 A', 'current'],
      ['LRA 78 A', 'current'],
      ['Ia / In = 7,5', 'current'],
      ['IA/IN = 7,5', 'current'],
      ['Test voltage 3 kV', 'voltage'],
      ['Prüfspannung 2,5 kV', 'voltage'],
      ['BIL 95 kV', 'voltage'],
      ['RUN 30 MFD 370 V', 'voltage'],
      ['Frequenzbereich 5-100 Hz', 'frequency'],
      ['Frequency range 5 - 100 Hz', 'frequency'],
    ] as [string, NameplateField][]) {
      expect([line, one(line, field)]).toEqual([line, []]);
    }
    // kept below the threshold (for "show more"), marked secondary
    for (const [line, field] of [['Starting current 100 A', 'current'], ['Test voltage 3 kV', 'voltage'], ['Output speed 41 rpm', 'speed'], ['GUARANTEED EFF 89.5', 'efficiency']] as [string, NameplateField][]) {
      expect([line, parseNameplate(line).candidates[field][0]?.evidence]).toEqual([line, expect.arrayContaining(['secondary'])]);
    }
  });
  it('M3: the rating next to a non-rating value on the same line still ranks first', () => {
    expect(one('AMPS 12.6 LRA 78 A', 'current')).toEqual([12.6]);
    expect(one('FLA 14.2 SF AMPS 16.3', 'current')).toEqual([14.2]);
    expect(one('NEMA NOM. EFF. 91.0 GUARANTEED EFF 89.5', 'efficiency')).toEqual([91]);
    expect(one('Ur 20 kV Um 24 kV', 'voltage')).toEqual([20000]);
    expect(one('Um 24 kV LI 125 kV AC 50 kV', 'voltage')).toEqual([]);
    // a starting word disqualifies currents, not the voltage on the same line
    expect(one('Anlaufstrom 400 V 50 Hz', 'voltage')).toEqual([400]);
  });
  it('M4: "V~" is alternating current, not a phase count; "3," is no phase mark', () => {
    expect(all('230 V~ 3,5 A')).toEqual({ voltage: [230], current: [3.5] });
    expect(all('230V~ 50Hz 1,2A')).toEqual({ voltage: [230], current: [1.2], frequency: [50] });
    expect(one('230/400V~ 50 Hz', 'voltage')).toEqual([230, 400]);
    expect(all('230 V ~ 1,5 A')).toEqual({ voltage: [230], current: [1.5] });
    expect(one('1~ 230 V 50 Hz', 'phases')).toEqual(['1']);
    expect(one('120 VAC 60 Hz', 'voltage')).toEqual([120]);
  });
  it('M5: Δ read as "A" before a Y half, with or without a slash, is a voltage pair — never 400 A', () => {
    for (const line of ['400A 690Y 50Hz', '400 A / 690 Y 50 Hz', '400A/690Y 50Hz']) {
      const r = parseNameplate(line);
      expect([line, values(r, 'current')]).toEqual([line, []]);
      expect([line, offered(r, 'voltage').map((c) => `${c.value}${c.connection}`)]).toEqual([line, ['400delta', '690star']]);
      expect([line, offered(r, 'frequency').map((c) => c.connection)]).toEqual([line, [undefined]]);
    }
    // not a √3 pair: no voltage pair invented, and the "A" value is not offered as a current either
    expect(one('400A 600Y 50Hz', 'current')).toEqual([]);
  });
  it('S2: "uF" only as a unit — "Käfigläufer", "Anlaufstrom", "Stufe" do not make the rating line secondary', () => {
    for (const word of ['Käfigläufer', 'Leistungsaufnahme', 'Stufe', 'Laufrad']) {
      expect([word, all(`${word} 400 V 50 Hz 7,5 kW 14,3 A`)]).toMatchObject([word, { voltage: [400], frequency: [50], current: [14.3] }]);
    }
    expect(one('Kond. 12 uF 450 V', 'voltage')).toEqual([]);
    expect(one('Kondensator 12 µF 450 V', 'voltage')).toEqual([]);
  });
  it('S3: input power P1 is marked as input', () => {
    const r = parseNameplate('P1 2,6 kW P2 2,2 kW');
    expect(offered(r, 'power').find((c) => c.value === 2.6)?.evidence).toContain('input');
    expect(offered(r, 'power').find((c) => c.value === 2.2)?.evidence).not.toContain('input');
    expect(offered(parseNameplate('Input power 250 W'), 'power')[0].evidence).toContain('input');
    expect(offered(parseNameplate('Leistungsaufnahme 250 W'), 'power')[0].evidence).toContain('input');
  });
  it('S4: Order/Part/Cat/Model numbers are not serials; "Typenschild", "Type of …", "Cooling type IC" are not types', () => {
    for (const line of ['Order No. 1LE1002-1AB42', 'Part No. 12345-678', 'Cat. No. EM3615T', 'Model No. M3BP 160 MLA 4', 'Art.-Nr. 4711-0815']) expect([line, one(line, 'serial')]).toEqual([line, []]);
    expect(one('Model No. M3BP 160 MLA 4', 'type')).toEqual(['M3BP 160 MLA 4']);
    for (const line of ['Typenschild Drehstrommotor', 'Type of duty S1', 'Type of protection IP55', 'Cooling type IC 411', 'Duty type S1']) expect([line, one(line, 'type')]).toEqual([line, []]);
    expect(one('Type of duty S1', 'duty')).toEqual(['S1']);
    expect(one('Typ-Nr. KMR 90 S4', 'type')).toEqual(['KMR 90 S4']);
  });
  it('S5: an identifier with OCR look-alikes next to digits is flagged "check against the plate"', () => {
    expect(offered(parseNameplate('Type LLE1OO21BB222AA4'), 'type')[0].evidence).toContain('look-alike');
    expect(offered(parseNameplate('SER.NO. TR2LO8817'), 'serial')[0].evidence).toContain('look-alike');
    expect(offered(parseNameplate('Type DRN90L4'), 'type')[0].evidence).not.toContain('look-alike');
  });
  it('S6: Δ/Y marks belong to voltages and currents only', () => {
    const r = parseNameplate('400 V Dreieck 50 Hz');
    expect(offered(r, 'frequency').map((c) => c.connection)).toEqual([undefined]);
    expect(offered(r, 'voltage').map((c) => c.connection)).toEqual(['delta']);
    const fan = parseNameplate(['230/400 V Δ/Y 250 W 50 Hz', '400 V Y 250 W 50 Hz']);
    expect(offered(fan, 'power').map((c) => `${c.value}${c.connection ?? ''}`)).toEqual(['250']);
    expect(offered(fan, 'frequency').map((c) => `${c.value}${c.connection ?? ''}`)).toEqual(['50']);
  });
  it('S7: setting ranges and part-load efficiencies are not offered; rated pairs and slip ranges are', () => {
    expect(one('Frequenzbereich 5-100 Hz', 'frequency')).toEqual([]);
    expect(one('5-100 Hz', 'frequency')).toEqual([]);
    expect(one('300-3000 rpm', 'speed')).toEqual([]);
    expect(one('50-60 Hz', 'frequency')).toEqual([50, 60]);
    expect(one('1455-1470 rpm', 'speed')).toEqual([1455, 1470]);
    expect(one('Eff 50% 91.0', 'efficiency')).toEqual([]);
    expect(parseNameplate('Eff 50% 91.0').candidates.efficiency[0].evidence).toContain('part-load');
    expect(one('η 3/4 90.1', 'efficiency')).toEqual([]);
    expect(one('Eff 100% 91.0', 'efficiency')).toEqual([91]);
  });
  it('N2–N4 (cheap ones): "kV A" followed by a current, lower-case efficiency label, "SI units", SEW brake line', () => {
    const r = parseNameplate('Primary 10 kV A 14,4');
    expect(values(r, 'voltage')).toEqual([10000]);
    expect(values(r, 'current')).toEqual([14.4]);
    expect(values(r, 'power')).toEqual([]);
    expect(offered(parseNameplate('630 kV A 50 Hz'), 'power').map((c) => `${c.value} ${c.unit}`)).toEqual(['630 kVA']);
    expect(one('Nominal efficiency 91.0 %', 'efficiency')).toEqual([91]);
    expect(one('SI units', 'duty')).toEqual([]);
    expect(one('BE2 230 V AC 20 Nm', 'voltage')).toEqual([]);
  });
  it('two "not the rating" readings of one value never add up to an offer', () => {
    expect(one(['n2 41 1/min', 'Output speed 41 rpm'], 'speed')).toEqual([]);
    expect(one(['5-100 Hz', 'Frequenzbereich 5 - 100 Hz'], 'frequency')).toEqual([]);
  });
});

// Fix round 2 (docs/V15_LOG.md "Fix round 2"): one regression per item, built from the blind-2 plate that exposed it.
// Blind-2 is a tuning set from here on; these inputs are its lines (or the same form), not evidence.
describe('fix round 2: blind-2 misses (wrong values first, L26)', () => {
  const conn = (lines: string | string[], field: NameplateField) => offered(parseNameplate(lines), field).map((c) => `${c.base}${c.connection ? ` ${c.connection}` : ''}`);

  it('1: a capacitor line is secondary with either micro sign (U+00B5 MICRO SIGN, U+03BC GREEK MU) and with uF', () => {
    for (const mu of ['µ', 'μ', 'u']) {
      expect([mu, one(['0.75 kW   230 V   50 Hz   5.3 A', `Cr 20 ${mu}F   450 V~`], 'voltage')]).toEqual([mu, [230]]); // elektrim_1ph_capacitor
      expect([mu, one(['1~   230 V   50 Hz   P1 220 W', `n 1310 min-1   C 4 ${mu}F 400 V   IP54`], 'voltage')]).toEqual([mu, [230]]); // missing_ziehl_abegg_faded_fan
    }
    expect(normalizeLine('20 µF')).toBe(normalizeLine('20 μF'));
  });

  it('2: a DC motor offers its armature values, never the field (excitation) values', () => {
    const plate = ['LSK 1604 M 04   N° 731204/018   2019', '25 kW   2400 min-1   S1   IP23S   Cl. H', 'INDUIT / ARMATURE   460 V   59 A', 'EXCITATION / FIELD   360 V   3.9 A'];
    expect(one(plate, 'voltage')).toEqual([460]);
    expect(one(plate, 'current')).toEqual([59]);
    expect(one('Erregung 180 V 1,2 A', 'voltage')).toEqual([]);
  });

  it('3: a German calendar week ("KW 12/23", "KW 12" after a date word, "Woche") is never a power', () => {
    expect(one(['1~   230 V   50 Hz   P1 80 W   0,45 A', 'Made in Germany   KW 12/23'], 'power')).toEqual([80]); // missing_hanning_torn_label_pump
    for (const l of ['KW 12/23', 'KW 12/2023', 'KW 7-24', 'Made in Germany KW 12', 'Datum: KW 12', 'Woche 12/23', 'Week 12', 'CW 12/23']) expect([l, one(l, 'power')]).toEqual([l, []]);
    // a unit-first power stays a power: decimals, lower-case kW, no year and no date word
    expect(one('KW 11 HP 15', 'power')).toEqual([11000, 11185.5]);
    expect(one('KW 7.5', 'power')).toEqual([7500]);
    expect(one('kW 12/23', 'power')).toEqual([12000, 23000]);
  });

  it('4: "23O A / 4OO Y V" (Δ read as A, O for 0) is a Δ/Y voltage pair, never 230 A', () => {
    const lines = ['3~ HB 9OLB 4   23O A / 4OO Y V   5O Hz', 'l,85kW   7,45/4,3A   l4OOmin-1   cos 0,78']; // rossi_gearmotor_ocr
    expect(conn(lines, 'voltage')).toEqual(['230 delta', '400 star']);
    expect(one(lines, 'current')).toEqual([7.45, 4.3]);
    expect(one('230 A 400 V Y', 'current')).toEqual([]);
    expect(one('400 V Y 8.2 A', 'current')).toEqual([8.2]);
  });

  it('5: a space as thousands separator before a speed unit: "11 400 r/min" is 11400 rpm, never 400', () => {
    expect(one('11 400 r/min   PF 0.85   S1', 'speed')).toEqual([11400]); // rotor_400hz_aviation
    expect(one('1 450 rpm', 'speed')).toEqual([1450]);
    expect(one('min-1 1450 400 V', 'speed')).not.toContain(400);
  });

  it('6: "HP 7 l/2" (l for 1 in the fraction) is 7.5 HP, never 7 HP', () => {
    expect(one('HP 7 l/2   PH 3   HZ 6O   RPM l77O   FR 2l3T', 'power')).toEqual([5592.75]); // toshiba_nema_premium_ocr
    expect(one('HP 7 I/2', 'power')).toEqual([5592.75]);
    expect(one('HP 2 3/4', 'power')).toEqual([2050.675]);
  });

  it('7: servo: rated "IN 3.5 A" found on a line with Nm; I0, Imax and "(continuous)" are no rating and no duty', () => {
    const plate = ['Lenze', 'MCS09H41-RS0B0-Z0-0', '3~ Servo motor   SN 1830742215', 'M0  6.6 Nm    I0  4.3 A   (continuous)', 'MN  5.1 Nm    IN  3.5 A   nN 3000 r/min', 'PN  1.60 kW   UN  330 V   fN  200 Hz', 'Mmax 19.2 Nm  Imax 15.0 A (peak)'];
    const r = parseNameplate(plate); // lenze_servo_mcs
    expect(values(r, 'current')).toEqual([3.5]);
    expect(values(r, 'duty')).toEqual([]);
    expect(values(r, 'power')).toEqual([1600]);
    expect(values(r, 'speed')).toEqual([3000]);
    // the torque number is taken out, the SEW brake line stays secondary, a labelled continuous duty still counts
    expect(one('BE2 230 V AC 20 Nm', 'voltage')).toEqual([]);
    expect(one('20 Nm 400 V', 'voltage')).toEqual([400]);
    for (const l of ['DUTY CONT', 'TIME RATING CONT', 'AMB 40C CONT', 'Duty: continuous']) expect([l, one(l, 'duty')]).toEqual([l, ['S1']]);
  });

  it('8: types stop at the next label; description words and a "Model:" product number are no type; serials are not cut short', () => {
    expect(one('Type RH40M-4EK.4F.1R   Part 112897', 'type')).toEqual(['RH40M-4EK.4F.1R']); // missing_ziehl_abegg_faded_fan
    expect(one('Typ FN050-4DK.4F.V7P1   Art.-Nr. 116336', 'type')).toEqual(['FN050-4DK.4F.V7P1']); // ziehl_abegg_fan_p1_watts_de
    const weg = parseNameplate('MOD: W21 100L-04 BRAKE   3~   No. 1027345621   2018'); // weg_w21_brake_motor
    expect([values(weg, 'type'), values(weg, 'phases'), values(weg, 'serial')]).toEqual([['W21 100L-04'], ['3'], ['1027345621']]);
    expect(one('LEROY-SOMER          3~ MOT. ASYNCHRONE', 'type')).toEqual([]); // leroy_somer_lses_voltage_table
    expect(one('3~ Mot. ASYNCHRONOUS', 'type')).toEqual([]);
    expect(one(['Type: MGE 90LC2-24FT100-H3   IP55   Th.Cl. F', 'Model: 98303542   P.c. 2241   Serial no. 0012345678'], 'type')).toEqual(['MGE 90LC2-24FT100-H3']); // grundfos
    expect(one('MODEL HO25E2DLR   SER. NO. Y11 4572 R290', 'serial')).toEqual(['Y11 4572 R290']); // us_motors_575v_designB
    expect(one('3~Mot. 4AP lOOL-4   Nr. 22O8 4l7S', 'serial')).toEqual(['22O8 4l7S']); // mez_mohelnice_ocr_de
    expect(one('Ser. No. 22l7O45-OO3   32 kg', 'serial')).toEqual(['22l7O45-OO3']); // rossi: the weight is not a serial group
    expect(one('No. 1027345621   2018', 'serial')).toEqual(['1027345621']); // a year is not a serial group
    expect(one('S/N 12345 IP55', 'serial')).toEqual(['12345']);
  });

  it('9a: value columns under a Δ/Y line ("Δ Y" / "400 690 V" / "21,4 12,4 A"), checked by √3', () => {
    expect([conn(['      Δ           Y', '    400         690      V', '    21,4        12,4     A'], 'voltage'), conn(['Δ Y', '400 690 V', '21,4 12,4 A'], 'current')]).toEqual([
      ['400 delta', '690 star'],
      ['21.4 delta', '12.4 star'],
    ]); // celma_delta_star_own_line_de
    const koncar = ['3~ Mot. 5AZ ll2M-4   No. 87O3l2', 'D        Y', '4OO      69O V', '8,2      4,7', 'A    4kVV    5O Hz'];
    expect([conn(koncar, 'voltage').sort(), conn(koncar, 'current'), one(koncar, 'power')]).toEqual([['400 delta', '690 star'], ['8.2 delta', '4.7 star'], [4000]]);
    expect(conn(['Δ Y', '380-420 V 660-725 V'], 'voltage')).toEqual(['380 delta', '420 delta', '660 star', '725 star']);
    // columns that break √3 offer nothing (a lost or misread cell)
    expect(one(['Δ Y', '400 400 V'], 'voltage')).toEqual([]);
    expect(one(['Δ Y', '8,2 2,1 A'], 'current')).toEqual([]);
  });

  it('9b: NEMA plates with the spaces dropped ("HP10 PH3", "VOLTS230/460", "MODELEP0104C")', () => {
    const teco = ['TECO-WESTINGHOUSE   MAX-E1   NEMA PREMIUM', 'MODELEP0104C SERIALNO.TW2211874', 'HP10 PH3 HZ60 RPM1765', 'VOLTS230/460 AMPS24.6/12.3', 'SF1.15 SFA28.3/14.1 CODE:H DES:B', 'FR215T ENCL:ODP INS.CL.F', 'NEMANOMEFF91.7 PF85 AMB40C DUTYCONT'];
    const r = parseNameplate(teco); // teco_nema_dropped_spaces
    expect(['power', 'voltage', 'current', 'frequency', 'cosPhi', 'speed', 'efficiency', 'phases', 'type', 'duty'].map((f) => values(r, f as NameplateField))).toEqual([
      [7457],
      [230, 460],
      [24.6, 12.3],
      [60],
      [0.85],
      [1765],
      [91.7],
      ['3'],
      ['EP0104C'],
      ['S1'],
    ]);
    // one glued token alone is left as printed (a type code)
    expect(one('Type HP10X', 'power')).toEqual([]);
  });

  it('9c: "OS 20 000 V", "208Y/120 V", "Ins F", "NEMA PREMlUM", "CAT.NO." on a DRY TYPE line, "7,SkVV … SOHz"', () => {
    expect(one('OS 20 000 V   18,2 A', 'voltage')).toEqual([20000]); // sgb_oil_transformer_dyn5_de
    const lv = parseNameplate('LV 208Y/120 V   l25 A'); // hammond_dry_transformer_ocr
    expect([values(lv, 'voltage'), values(lv, 'current'), offered(lv, 'voltage').map((c) => c.connection)]).toEqual([[208, 120], [125], [undefined, undefined]]);
    expect(one('Tamb -20 °C ... +40 °C   IP66   Ins F   S1', 'insulationClass')).toEqual(['F']); // brook_crompton_exd_t4
    expect(one('Ins Fan', 'insulationClass')).toEqual([]);
    expect(one('TOSHlBA   NEMA PREMlUM EFFlClENCY', 'ieClass')).toEqual(['NEMA Premium']); // toshiba_nema_premium_ocr
    expect(one('DRY TYPE TRANSFORMER   CAT.NO. NMK045KB', 'type')).toEqual(['NMK045KB']); // hammond
    const e = parseNameplate('7,SkVV   l455rnin-1   SOHz'); // elektrim_sg132_range_ocr
    expect([values(e, 'power'), values(e, 'frequency'), values(e, 'speed')]).toEqual([[7500], [50], [1455]]);
    for (const l of ['BBA', 'lSV', 'lOHz']) expect([l, NAMEPLATE_FIELDS.flatMap((f) => one(l, f))]).toEqual([l, []]);
  });

  it('10 (orchestrator decision, D105): a motor with a built-in drive offers its speed range; every other plate keeps the cap', () => {
    const mge = ['Type: MGE 90LC2-24FT100-H3   IP55   Th.Cl. F', 'P2 1.5 kW   P1 1.68 kW   3x380-500 V   50/60 Hz', 'I1/1 2.75-2.10 A   cos φ 0.93   n 360-4000 min-1'];
    expect(one(mge, 'speed')).toEqual([360, 4000]); // grundfos_mge_integrated_drive
    for (const word of ['integrated frequency converter', 'Frequenzumrichter integriert', 'VFD']) expect([word, one([word, 'n 300-3000 rpm'], 'speed')]).toEqual([word, [300, 3000]]);
    expect(one(['50 Hz 1450 rpm', 'f 87 Hz', 'n 300-3000 rpm'], 'speed')).toEqual([1450, 300, 3000]); // a second frequency rating
    // no drive: the range stays a setting range (S7)
    expect(one('n 360-4000 min-1', 'speed')).toEqual([]);
    expect(one(['50/60 Hz', 'n 300-3000 rpm'], 'speed')).toEqual([]);
    expect(one(['400 Hz', 'n 300-3000 rpm'], 'speed')).toEqual([]);
    // the frequency range of a drive is still no rating
    expect(one(['VFD', 'Frequenzbereich 5-100 Hz'], 'frequency')).toEqual([]);
  });
});

// ---------------------------------------------------------------- properties (seeded: failures reproduce)

describe('properties', () => {
  const R = rng(20261015);
  type Gen = { lines: string[]; want: Partial<Record<NameplateField, number[]>> };
  const fmt = (x: number, decimals: number, comma: boolean) => {
    const s = x.toFixed(decimals);
    return comma ? s.replace('.', ',') : s;
  };
  /** A random plate in one of the clean layouts, with its true values. */
  function plate(): Gen {
    const comma = R.next() < 0.5;
    const glued = R.next() < 0.3;
    const unitFirst = R.next() < 0.3;
    const kw = R.pick([0.18, 0.25, 0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22, 30, 45, 55, 75, 90, 110, 160]);
    const v = R.pick([230, 400, 415, 440, 460, 500, 525, 690]);
    const a = Number(R.between(0.5, 300).toFixed(R.pick([1, 2])));
    const hz = R.pick([50, 60]);
    const n = R.int(600, 3600);
    const cos = Number(R.between(0.6, 0.95).toFixed(2));
    const eff = Number(R.between(70, 97).toFixed(1));
    const vu = (val: string, unit: string) => (unitFirst ? `${unit} ${val}` : glued ? `${val}${unit}` : `${val} ${unit}`);
    const lines = [
      vu(fmt(kw, kw < 1 ? 2 : 1, comma), 'kW'),
      vu(String(v), 'V'),
      vu(fmt(a, 2, comma), 'A'),
      vu(String(hz), 'Hz'),
      unitFirst ? `r/min ${n}` : `${n} ${R.pick(['min-1', '1/min', 'rpm', 'U/min'])}`,
      `${R.pick(['cos φ', 'cosφ', 'cos phi', 'COS Φ'])} ${fmt(cos, 2, comma)}`,
      `${R.pick(['η', 'Eff.', 'Wirkungsgrad'])} ${fmt(eff, 1, comma)} %`,
    ];
    return { lines, want: { power: [kw * 1000], voltage: [v], current: [a], frequency: [hz], speed: [n], cosPhi: [cos], efficiency: [eff] } };
  }
  const same = (r: NameplateReading, want: Gen['want']) => {
    for (const [f, w] of Object.entries(want) as [NameplateField, number[]][]) {
      const got = values(r, f).map((x) => Number(Number(x).toPrecision(9)));
      expect([f, got]).toEqual([f, w.map((x) => Number(x.toPrecision(9)))]);
    }
  };

  it('every clean random plate is read exactly, in any line order (300 plates)', () => {
    for (let i = 0; i < 300; i++) {
      const g = plate();
      same(parseNameplate(g.lines), g.want);
      const shuffled = [...g.lines].sort(() => R.next() - 0.5);
      same(parseNameplate(shuffled), g.want);
    }
  });

  it('all ratings on ONE line, in any field order, either layout, with OCR junk at either end, are read exactly (300 lines)', () => {
    const JUNK = ['', '', '_', "'", '*', '-', '»', '~', '"'];
    for (let i = 0; i < 300; i++) {
      const comma = R.next() < 0.5;
      const unitFirst = R.next() < 0.4;
      const kw = R.pick([0.55, 0.75, 1.1, 1.5, 2.2, 4, 7.5, 11, 15, 22, 45, 90]);
      const v = R.pick([230, 400, 415, 460, 690]);
      const a = Number(R.between(1, 200).toFixed(1));
      const hz = R.pick([50, 60]);
      const n = R.int(700, 3600);
      const pieces: [string, string][] = [
        [fmt(kw, kw < 1 ? 2 : 1, comma), 'kW'],
        [String(v), 'V'],
        [fmt(a, 1, comma), 'A'],
        [String(hz), 'Hz'],
        [String(n), R.pick(['rpm', 'min-1', '1/min'])],
      ].sort(() => R.next() - 0.5) as [string, string][];
      const line = `${R.pick(JUNK)}${pieces.map(([val, unit]) => (unitFirst ? `${unit} ${val}` : `${val} ${unit}`)).join(R.pick([' ', '  ', '   ']))}${R.pick(JUNK)}`;
      const r = parseNameplate([line]);
      const got = (f: NameplateField) => values(r, f).map((x) => Number(Number(x).toPrecision(9)));
      expect([line, got('power'), got('voltage'), got('current'), got('frequency'), got('speed')]).toEqual([line, [kw * 1000], [v], [a], [hz], [n]].map((x) => (Array.isArray(x) ? x.map((y) => Number(Number(y).toPrecision(9))) : x)));
    }
  });

  it('decimal comma and decimal point give the same values', () => {
    for (let i = 0; i < 200; i++) {
      const g = plate();
      const swapped = g.lines.map((l) => l.replace(/(\d)[.,](\d)/g, (_, a, b) => `${a}${l.includes(',') ? '.' : ','}${b}`));
      same(parseNameplate(swapped), g.want);
    }
  });

  it('OCR misreads (0→O, 1→l, 5→S, 8→B; up to 2 per number) keep the value offered, at lower confidence', () => {
    const MIS: Record<string, string> = { '0': 'O', '1': 'l', '5': 'S', '8': 'B' };
    for (let i = 0; i < 200; i++) {
      const g = plate();
      const clean = parseNameplate(g.lines);
      // misread inside the voltage and speed numbers only (never the first character: "O400" is not a plate)
      const noisy = g.lines.map((l, k) =>
        k === 1 || k === 4
          ? l.replace(/\d{3,}/, (num) => {
              let out = num[0];
              let n = 0;
              for (const ch of num.slice(1)) {
                if (MIS[ch] && n < 2 && R.next() < 0.6) {
                  out += MIS[ch];
                  n++;
                } else out += ch;
              }
              return out;
            })
          : l
      );
      const r = parseNameplate(noisy);
      same(r, g.want);
      for (const f of ['voltage', 'speed'] as const) expect(offered(r, f)[0].confidence).toBeLessThanOrEqual(offered(clean, f)[0].confidence + 1e-12);
    }
  });

  it('never throws on random text; every candidate is well formed; every offered number is plausible', () => {
    const ALPHABET = 'aAbBcCdDeEfFhHiIkKlLmMnNoOpPrRsStTuUvVwWxXyYzZ0123456789 .,:;/-+%()~ΔφηµΦ∆°|=';
    for (let i = 0; i < 400; i++) {
      const lines = Array.from({ length: R.int(0, 8) }, () => Array.from({ length: R.int(0, 40) }, () => R.pick([...ALPHABET])).join(''));
      const r = parseNameplate(lines);
      for (const f of NAMEPLATE_FIELDS) {
        for (const c of r.candidates[f] as Candidate[]) {
          expect(c.field).toBe(f);
          expect(c.confidence).toBeGreaterThanOrEqual(0);
          expect(c.confidence).toBeLessThanOrEqual(0.99);
          expect(c.line).toBeGreaterThanOrEqual(0);
          expect(c.source).toBe(lines[c.line]);
          if (typeof c.value === 'number') expect(Number.isFinite(c.base)).toBe(true);
          // independent of the parser's own flags: what is offered must be physically possible for its field
          if (c.confidence >= OFFER_THRESHOLD && typeof c.base === 'number') {
            const ok: Partial<Record<NameplateField, (x: number) => boolean>> = {
              cosPhi: (x) => x > 0 && x <= 1,
              efficiency: (x) => x > 0 && x < 100,
              frequency: (x) => x > 0 && x <= 2000,
              speed: (x) => x > 0 && x <= 1e5,
              voltage: (x) => x > 0 && x <= 1e6,
              current: (x) => x > 0 && x <= 1e5,
              power: (x) => x > 0 && x <= 2e8,
            };
            expect([f, c.base, ok[f]?.(c.base) ?? true]).toEqual([f, c.base, true]);
          }
        }
        // best first
        const conf = r.candidates[f].map((c) => c.confidence);
        expect(conf).toEqual([...conf].sort((a, b) => b - a));
      }
    }
  });
});
