/**
 * @jest-environment node
 */
// Nameplate parser accuracy on whole fixture sets (V1.5 phase A; numbers and their meaning: docs/V15_LOG.md).
//  - own/: the development set (34 plates). The parser was tuned on it, so its figure is NOT evidence (WORKFLOW L27).
//  - blind/: blind set 1, written by a separate agent; measured ONCE with the parser frozen (79.6 %, V15_LOG A2). Rules
//    were then derived from its misses (A3) and from REVIEW_V15_PA: it is a TUNING set now, like own/.
// Both sets are pinned by their exact list of misses (REVIEW_V15_PA S8: a 0.97 floor let regressions pass silently):
// any new miss fails, and a miss that goes away must be removed here on purpose. Text is compared EXACTLY (S5): the
// folded figure (O→0, I/L→1 …) is lenient and pinned apart.
//  - blind-2/: blind set 2, measured ONCE against e0d953f (87.2 % exact text); tuned on in fix round 2: a TUNING set now.
// Metamorphic tests (S8): one junk character at either end of any line, a lost table cell, and the "not the rating"
// lines of REVIEW_V15_PA M3 inserted into every plate must never ADD an offered value — over all three sets (round 2).
// Print the tables: node --import ./scripts/node/ts-hooks.mjs scripts/nameplate-bench.mjs own blind --misses
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NAMEPLATE_FIELDS, offered, parseNameplate } from './nameplate';
import { loadPlates, plateFromBlind } from './nameplate-fixtures';
import { missList, scorePlates, type Plate } from './nameplate-score';

const dir = (name: string) => join(__dirname, '../../test/fixtures/nameplates', name);
const load = (name: string) => loadPlates(dir(name), (f) => readFileSync(f, 'utf8'), (d) => (existsSync(d) ? readdirSync(d) : []), join);

const OWN_MISSES = ['own-01 serial'];
const BLIND_MISSES_EXACT = [
  'fc_lenze_two_ratings_en type',
  'missing_worn_plate_de type',
  'ocr_abb_heavy_8B_5S_en serial',
  'ocr_abb_heavy_8B_5S_en type',
  'ocr_abb_split_row_en serial',
  'ocr_gearmotor_split_unit_de type',
  'ocr_glued_units_de type',
  'ocr_ie4_90kw_de serial',
  'ocr_ie4_90kw_de type',
  'ocr_nema_fraction_hp_en serial',
  'ocr_nema_fraction_hp_en type',
  'ocr_siemens_compact_de serial',
  'ocr_siemens_compact_de type',
  'ocr_transformer_250kva_dyn11_en serial',
  'ocr_weg_no_spaces_en duty',
  'ocr_weg_no_spaces_en serial',
  'ocr_weg_no_spaces_en type',
  'ocr_wilo_pump_de type',
  'pump_grundfos_cr_en serial',
  'siemens_1le1_tabular_de serial',
];
const BLIND_MISSES_FOLDED = [
  'fc_lenze_two_ratings_en type',
  'missing_worn_plate_de type',
  'ocr_glued_units_de type',
  'ocr_ie4_90kw_de serial',
  'ocr_siemens_compact_de serial',
  'ocr_weg_no_spaces_en duty',
  'ocr_weg_no_spaces_en type',
  'pump_grundfos_cr_en serial',
  'siemens_1le1_tabular_de serial',
];

/** Offered values as "field=value" (connections left out: losing a Δ/Y mark is no new value; contradicting one is tested apart). */
const offeredKeys = (lines: readonly string[]) => {
  const r = parseNameplate(lines);
  const out = new Set<string>();
  for (const f of NAMEPLATE_FIELDS) for (const c of offered(r, f)) out.add(`${f}=${typeof c.value === 'number' ? c.base : String(c.value).toUpperCase()}`);
  return out;
};
const added = (base: Set<string>, lines: readonly string[]) => [...offeredKeys(lines)].filter((k) => !base.has(k));

// Blind set 2: measured ONCE against snapshot e0d953f (parser blob 1bb80d0) — 87.2 % exact text, 89.2 % folded, 1 false
// positive (V15_LOG "Blind set 2"); that is its only evidence figure. Fix round 2 tuned on its misses: a TUNING set now,
// pinned here as a regression guard (the remaining misses: identifiers with look-alikes, unlabelled types).
const BLIND2_MISSES_EXACT = [
  'elektrim_sg132_range_ocr serial',
  'elektrim_sg132_range_ocr type',
  'hammond_dry_transformer_ocr serial',
  'koncar_split_lines_ocr serial',
  'koncar_split_lines_ocr type',
  'lenze_servo_mcs type',
  'leroy_somer_lses_voltage_table type',
  'leroy_somer_lsk_dc_motor type',
  'mez_mohelnice_ocr_de serial',
  'mez_mohelnice_ocr_de type',
  'rossi_gearmotor_ocr serial',
  'rossi_gearmotor_ocr type',
  'toshiba_nema_premium_ocr serial',
  'toshiba_nema_premium_ocr type',
];
const BLIND2_MISSES_FOLDED = [
  'lenze_servo_mcs type',
  'leroy_somer_lses_voltage_table type',
  'leroy_somer_lsk_dc_motor type',
  'rossi_gearmotor_ocr type',
];

// Blind set 3: measured ONCE against snapshot c003585 (parser blob 9cc96c7) — 83.0 % exact text, 83.8 % folded, 3 false
// positives (V15_LOG "Blind set 3"). Pinned here as a regression guard only; from this commit on it is a TUNING set.
const BLIND3_MISSES_EXACT = [
  'abb_acs580_u1_u2_converter current',
  'abb_acs580_u1_u2_converter frequency',
  'abb_acs580_u1_u2_converter ipRating',
  'abb_acs580_u1_u2_converter type',
  'abb_acs580_u1_u2_converter voltage',
  'abb_m2bax_table_read_by_columns current',
  'abb_m2bax_table_read_by_columns type',
  'abb_m3bp_four_rows_cos_phi type',
  'bitzer_compressor_y_yy_de current',
  'block_transformer_yyn0_ocr_de serial',
  'block_transformer_yyn0_ocr_de type',
  'danfoss_fc51_1ph_in_3ph_out current',
  'danfoss_fc51_1ph_in_3ph_out frequency',
  'danfoss_fc51_1ph_in_3ph_out phases',
  'danfoss_fc51_1ph_in_3ph_out type',
  'ebmpapst_ec_fan_input_w_de serial',
  'ebmpapst_ec_fan_input_w_de speed',
  'grundfos_cm_1ph_p1_p2 serial',
  'grundfos_cr_pump_only_p2_code serial',
  'grundfos_cr_pump_only_p2_code type',
  'kaeser_screw_compressor_two_motors_de current',
  'kaeser_screw_compressor_two_motors_de power',
  'kaeser_screw_compressor_two_motors_de serial',
  'kaeser_screw_compressor_two_motors_de voltage',
  'ksb_etaline_p2_only_ocr type',
  'missing_abb_m2_cropped_right type',
  'missing_ebmpapst_fan_bleached type',
  'missing_grundfos_mg_faded type',
  'missing_nord_oil_soaked type',
  'missing_sew_drn_label_scratched_de efficiency',
  'missing_sew_drn_label_scratched_de serial',
  'missing_sew_drn_label_scratched_de type',
  'missing_siemens_1le1_overspray serial',
  'nord_87hz_row_ocr frequency',
  'nord_87hz_row_ocr speed',
  'nord_87hz_row_ocr type',
  'nord_two_columns_left_then_right_de type',
  'schneider_lc1d_dc_coil_contactor type',
  'schneider_lc1d_dc_coil_contactor voltage',
  'sew_dre_gearmotor_dropped_spaces_ocr current',
  'sew_dre_gearmotor_dropped_spaces_ocr duty',
  'sew_dre_gearmotor_dropped_spaces_ocr efficiency',
  'sew_dre_gearmotor_dropped_spaces_ocr frequency',
  'sew_dre_gearmotor_dropped_spaces_ocr ieClass',
  'sew_dre_gearmotor_dropped_spaces_ocr power',
  'sew_dre_gearmotor_dropped_spaces_ocr serial',
  'sew_dre_gearmotor_dropped_spaces_ocr speed',
  'sew_dre_gearmotor_dropped_spaces_ocr type',
  'sew_drn_gearmotor_brake_230ac_de efficiency',
  'sew_drn_gearmotor_brake_230ac_de serial',
  'sew_drn_gearmotor_brake_230ac_de type',
  'sew_movitrac_eingang_ausgang_de current',
  'sew_movitrac_eingang_ausgang_de frequency',
  'sew_movitrac_eingang_ausgang_de phases',
  'sew_movitrac_eingang_ausgang_de voltage',
  'siemens_1av_split_lines efficiency',
  'siemens_1av_split_lines serial',
  'siemens_1la7_ocr_heavy serial',
  'siemens_1la7_ocr_heavy type',
  'siemens_1le1_eta_quarter_loads_60hz serial',
  'siemens_3rt2_dc_coil_contactor type',
  'siemens_3rt2_dc_coil_contactor voltage',
  'weg_w22_ocr_vv_8b type',
  'wilo_drain_tauchtiefe_p1_p2_de current',
  'wilo_drain_tauchtiefe_p1_p2_de type',
  'wilo_stratos_p1_range_eei_de type',
  'ziehl_abegg_two_speed_delta_star_de type',
];
const BLIND3_MISSES_FOLDED = [
  'abb_acs580_u1_u2_converter current',
  'abb_acs580_u1_u2_converter frequency',
  'abb_acs580_u1_u2_converter ipRating',
  'abb_acs580_u1_u2_converter type',
  'abb_acs580_u1_u2_converter voltage',
  'abb_m2bax_table_read_by_columns current',
  'abb_m2bax_table_read_by_columns type',
  'abb_m3bp_four_rows_cos_phi type',
  'bitzer_compressor_y_yy_de current',
  'danfoss_fc51_1ph_in_3ph_out current',
  'danfoss_fc51_1ph_in_3ph_out frequency',
  'danfoss_fc51_1ph_in_3ph_out phases',
  'danfoss_fc51_1ph_in_3ph_out type',
  'ebmpapst_ec_fan_input_w_de serial',
  'ebmpapst_ec_fan_input_w_de speed',
  'grundfos_cm_1ph_p1_p2 serial',
  'grundfos_cr_pump_only_p2_code serial',
  'grundfos_cr_pump_only_p2_code type',
  'kaeser_screw_compressor_two_motors_de current',
  'kaeser_screw_compressor_two_motors_de power',
  'kaeser_screw_compressor_two_motors_de serial',
  'kaeser_screw_compressor_two_motors_de voltage',
  'ksb_etaline_p2_only_ocr type',
  'missing_abb_m2_cropped_right type',
  'missing_ebmpapst_fan_bleached type',
  'missing_grundfos_mg_faded type',
  'missing_nord_oil_soaked type',
  'missing_sew_drn_label_scratched_de efficiency',
  'missing_sew_drn_label_scratched_de serial',
  'missing_sew_drn_label_scratched_de type',
  'missing_siemens_1le1_overspray serial',
  'nord_87hz_row_ocr frequency',
  'nord_87hz_row_ocr speed',
  'nord_87hz_row_ocr type',
  'nord_two_columns_left_then_right_de type',
  'schneider_lc1d_dc_coil_contactor type',
  'schneider_lc1d_dc_coil_contactor voltage',
  'sew_dre_gearmotor_dropped_spaces_ocr current',
  'sew_dre_gearmotor_dropped_spaces_ocr duty',
  'sew_dre_gearmotor_dropped_spaces_ocr efficiency',
  'sew_dre_gearmotor_dropped_spaces_ocr frequency',
  'sew_dre_gearmotor_dropped_spaces_ocr ieClass',
  'sew_dre_gearmotor_dropped_spaces_ocr power',
  'sew_dre_gearmotor_dropped_spaces_ocr serial',
  'sew_dre_gearmotor_dropped_spaces_ocr speed',
  'sew_dre_gearmotor_dropped_spaces_ocr type',
  'sew_drn_gearmotor_brake_230ac_de efficiency',
  'sew_drn_gearmotor_brake_230ac_de serial',
  'sew_drn_gearmotor_brake_230ac_de type',
  'sew_movitrac_eingang_ausgang_de current',
  'sew_movitrac_eingang_ausgang_de frequency',
  'sew_movitrac_eingang_ausgang_de phases',
  'sew_movitrac_eingang_ausgang_de voltage',
  'siemens_1av_split_lines efficiency',
  'siemens_1av_split_lines serial',
  'siemens_1la7_ocr_heavy serial',
  'siemens_1le1_eta_quarter_loads_60hz serial',
  'siemens_3rt2_dc_coil_contactor type',
  'siemens_3rt2_dc_coil_contactor voltage',
  'weg_w22_ocr_vv_8b type',
  'wilo_drain_tauchtiefe_p1_p2_de current',
  'wilo_drain_tauchtiefe_p1_p2_de type',
  'wilo_stratos_p1_range_eei_de type',
  'ziehl_abegg_two_speed_delta_star_de type',
];

const ownPlates = load('own');
const blindPlates = load('blind');
const blind2Plates = load('blind-2');
const allPlates: Plate[] = [...ownPlates, ...blindPlates, ...blind2Plates];

describe('own nameplate set (development set, not held out)', () => {
  it('has at least 30 plates in English and German, every one with truth', () => {
    expect(ownPlates.length).toBeGreaterThanOrEqual(30);
    expect(ownPlates.filter((p) => p.lang === 'de').length).toBeGreaterThanOrEqual(10);
    expect(ownPlates.filter((p) => p.lang === 'en').length).toBeGreaterThanOrEqual(10);
    expect(new Set(ownPlates.map((p) => p.id)).size).toBe(ownPlates.length);
    for (const p of ownPlates) for (const f of Object.keys(p.truth)) expect(NAMEPLATE_FIELDS).toContain(f);
  });
  it('pinned: exactly the known misses (exact text and folded), no false positive, every stated Δ/Y right', () => {
    const s = scorePlates(ownPlates);
    expect(missList(s)).toEqual(OWN_MISSES);
    expect(missList(scorePlates(ownPlates, { text: 'folded' }))).toEqual(OWN_MISSES);
    expect(s.total.falsePositives).toBe(0);
    for (const f of NAMEPLATE_FIELDS) if (s.fields[f].connections) expect(s.fields[f].connectionsRight).toBe(s.fields[f].connections);
  });
});

describe('blind set 1 (separate agent; a TUNING set since A3 and this fix round, docs/V15_LOG.md)', () => {
  it('is complete: 31 plates with truth', () => {
    expect(blindPlates.length).toBe(31);
  });
  it('pinned: exactly the known misses, exact text (headline) and folded; no wrong Δ/Y', () => {
    const s = scorePlates(blindPlates);
    expect(missList(s)).toEqual(BLIND_MISSES_EXACT);
    expect(missList(scorePlates(blindPlates, { text: 'folded' }))).toEqual(BLIND_MISSES_FOLDED);
    expect(s.total.falsePositives).toBe(2);
    // a stated connection is never contradicted: missing (not offered) is allowed, wrong is not
    for (const p of blindPlates) {
      const got = offered(parseNameplate(p.lines), 'voltage');
      const truth = (p.truth.voltage ?? []).filter((v): v is Exclude<typeof v, number | string> => typeof v === 'object');
      for (const v of truth) {
        if (!v.connection) continue;
        // a value printed in both connections (two rating rows) allows both
        const allowed = truth.filter((x) => x.value === v.value).map((x) => x.connection);
        const same = got.filter((c) => c.base === v.value);
        expect([p.id, v.value, same.every((c) => c.connection === undefined || allowed.includes(c.connection))]).toEqual([p.id, v.value, true]);
      }
    }
  });
});

describe('blind set 2 (separate agent; measured once against e0d953f, a TUNING set from then on)', () => {
  const plates = blind2Plates;
  it('is complete: 36 plates with truth', () => {
    expect(plates.length).toBe(36);
  });
  it('pinned: exactly the known misses after fix round 2 (exact text and folded); first run: test/fixtures/nameplates/blind-2-first-run.txt', () => {
    const s = scorePlates(plates);
    expect(missList(s)).toEqual(BLIND2_MISSES_EXACT);
    expect(missList(scorePlates(plates, { text: 'folded' }))).toEqual(BLIND2_MISSES_FOLDED);
    expect([s.total.fieldCases, s.total.exact, s.total.falsePositives]).toEqual([407, 393, 0]);
  });
  it('no stated Δ/Y connection is contradicted (voltage and current; missing is allowed)', () => {
    const wrong: string[] = [];
    for (const p of plates) {
      for (const field of ['voltage', 'current'] as const) {
        const got = offered(parseNameplate(p.lines), field);
        const truth = (p.truth[field] ?? []).filter((v): v is Exclude<typeof v, number | string> => typeof v === 'object');
        for (const v of truth) {
          if (!v.connection) continue;
          const allowed = truth.filter((x) => x.value === v.value).map((x) => x.connection);
          if (got.some((c) => c.base === v.value && c.connection !== undefined && !allowed.includes(c.connection))) wrong.push(`${p.id} ${field} ${v.value}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('blind set 3 (separate agent; measured once against c003585, a TUNING set from then on)', () => {
  const plates = load('blind-3');
  it('is complete: 36 plates with truth', () => {
    expect(plates.length).toBe(36);
  });
  it('pinned: exactly the misses of the first and only blind run (exact text and folded)', () => {
    const s = scorePlates(plates);
    expect(missList(s)).toEqual(BLIND3_MISSES_EXACT);
    expect(missList(scorePlates(plates, { text: 'folded' }))).toEqual(BLIND3_MISSES_FOLDED);
    expect([s.total.fieldCases, s.total.exact, s.total.falsePositives]).toEqual([376, 312, 3]);
  });
});

describe('metamorphic (REVIEW_V15_PA S8), over own, blind-1 and blind-2 (fix round 2)', () => {
  it('one junk character before or after any line adds no offered value', () => {
    const problems: string[] = [];
    for (const p of allPlates) {
      const base = offeredKeys(p.lines);
      p.lines.forEach((line, i) => {
        for (const junk of ['_', "'", '*', '-', '»', '~', '"', '!', '#']) {
          for (const variant of [`${junk}${line}`, `${line}${junk}`]) {
            const lines = [...p.lines];
            lines[i] = variant;
            const extra = added(base, lines);
            if (extra.length > 0) problems.push(`${p.id} ${JSON.stringify(variant)} +${extra.join(' +')}`);
          }
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('a table row that lost one cell adds no offered value', () => {
    const unitWord = /^(?:V|kV|A|Hz|HZ|kW|KW|HP|W|r\/min|rpm|RPM|1\/min|min-1|U\/min|cos|φ|cosφ|PF|η|%|Eff\.?)$/;
    const isHeader = (l: string) => {
      const w = l.trim().split(/\s+/);
      return w.filter((x) => unitWord.test(x)).length >= 3 && !w.some((x) => /^[0-9]/.test(x));
    };
    const problems: string[] = [];
    let rows = 0;
    for (const p of allPlates) {
      const base = offeredKeys(p.lines);
      let header = -1;
      p.lines.forEach((line, i) => {
        if (isHeader(line)) header = i;
        if (header < 0 || i === header || i - header > 6) return;
        const cells = line.trim().split(/\s+/);
        if (cells.filter((c) => /^[0-9OoIlSB][0-9OoIlSB.,]*$/.test(c)).length < 3) return;
        rows++;
        cells.forEach((c, k) => {
          if (!/^[0-9OoIlSB][0-9OoIlSB.,]*$/.test(c)) return;
          const lines = [...p.lines];
          lines[i] = cells.filter((_, j) => j !== k).join('   ');
          const extra = added(base, lines);
          if (extra.length > 0) problems.push(`${p.id} ${JSON.stringify(lines[i])} +${extra.join(' +')}`);
        });
      });
    }
    expect(rows).toBeGreaterThanOrEqual(12); // the sets hold ABB, WEG, Siemens, Leroy-Somer, Toshiba tables
    expect(problems).toEqual([]);
  });

  it('inserting a "not the rating" line (M3) into any plate adds no offered value', () => {
    const NOT_RATING_LINES = [
      'Guaranteed Min. Eff. 89.5 %',
      'SERVICE FACTOR AMPS 14.2',
      'Output speed 41 rpm',
      'Abtriebsdrehzahl 41 1/min',
      'Starting current 100 A',
      'Anlaufstrom 7,5 x In',
      'LRA 78 A',
      'Locked rotor amps 96 A',
      'Ia / In = 7,5',
      'Test voltage 3 kV',
      'Prüfspannung 2,5 kV',
      'Um 24 kV LI 125 kV AC 50 kV',
      'RUN 30 MFD 370 V',
      'Kond. 12 µF 450 V',
      'Bremse 205 V DC 0,25 A',
      'BE2 230 V AC 20 Nm',
      'Frequenzbereich 5-100 Hz',
      'Eff 50% 91.0',
    ];
    const problems: string[] = [];
    for (const p of allPlates) {
      const base = offeredKeys(p.lines);
      for (const extraLine of NOT_RATING_LINES) {
        for (const lines of [[...p.lines, extraLine], [extraLine, ...p.lines]]) {
          const extra = added(base, lines);
          if (extra.length > 0) problems.push(`${p.id} + ${JSON.stringify(extraLine)}: +${extra.join(' +')}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('blind adapter: blind-3 README conventions (mapped before that set was scored)', () => {
  const eff = (line: string, values: number[], loads?: number[]) =>
    plateFromBlind('x', `a\n${line}`, { fields: { efficiencyPct: { value: values, unit: '%', line: values.map(() => 1) }, ...(loads ? { efficiencyLoadPct: { value: loads, unit: '%', line: loads.map(() => 1) } } : {}) } }).truth.efficiency;
  it('"4/4 3/4 2/4" load markers without efficiencyLoadPct: only the 4/4 value is the full-load efficiency', () => {
    expect(eff('η 4/4 91.4 %  3/4 91.9 %  2/4 91.3 %', [91.4, 91.9, 91.3])).toEqual([{ value: 91.4, line: 1 }]);
    expect(eff('η 3/4 91.9  4/4 91.4', [91.9, 91.4])).toEqual([{ value: 91.4, line: 1 }]);
    // literal load points still decide; no markers keep every value
    expect(eff('η 100% 91.8 75% 92.0', [91.8, 92.0], [100, 75])).toEqual([{ value: 91.8, line: 1 }]);
    expect(eff('η 91.8 / 92.0', [91.8, 92.0])).toEqual([{ value: 91.8, line: 1 }, { value: 92.0, line: 1 }]);
  });
});

describe('blind adapter: connection shapes (blind-2 README conventions, mapped before that set was scored)', () => {
  const conns = (voltage: { value: number[]; line: number[] }, connection: { value: string | string[]; line: number | number[] }) =>
    (plateFromBlind('x', 'a\nb\nc', { fields: { voltage: { ...voltage, unit: 'V' }, connection } }).truth.voltage ?? []).map((v) => (typeof v === 'object' ? v.connection : undefined));
  it('one Δ/Y group: a pair, or a range pair split in halves', () => {
    expect(conns({ value: [400, 690], line: [1, 1] }, { value: 'Δ/Y', line: 1 })).toEqual(['delta', 'star']);
    expect(conns({ value: [380, 420, 660, 725], line: [2, 2, 2, 2] }, { value: 'Δ/Y', line: 1 })).toEqual(['delta', 'delta', 'star', 'star']);
  });
  it('one mark per row, rows with ranges, two marks on one line, and Δ/Y next to a single-mark row', () => {
    expect(conns({ value: [220, 240, 380, 415], line: [1, 1, 2, 2] }, { value: ['Δ', 'Y'], line: [1, 2] })).toEqual(['delta', 'delta', 'star', 'star']);
    expect(conns({ value: [220, 242, 380, 420], line: [0, 0, 0, 0] }, { value: ['Δ', 'Y'], line: [0, 0] })).toEqual(['delta', 'delta', 'star', 'star']);
    expect(conns({ value: [230, 400, 400], line: [0, 0, 1] }, { value: ['Δ/Y', 'Δ'], line: [0, 1] })).toEqual(['delta', 'star', 'delta']);
    expect(conns({ value: [230, 400, 690], line: [0, 0, 0] }, { value: 'Δ/Y', line: 0 })).toEqual([undefined, undefined, undefined]); // does not split: none
  });
});

