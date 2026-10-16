# Blind nameplate fixtures

Written without reading the parser source. Format: `FORMAT.md`. Check: `python3 -I check.py .` (exit 0 = all good).

## Fixtures (what makes each one hard)

- `siemens_1le1_tabular_de` (motor-iec, de): Siemens table layout: units only in a header row, values in 3 rating rows (400Δ/690Y 50 Hz, 460Δ 60 Hz); bearing numbers 6208 as traps.
- `abb_m3bp_multivoltage_en` (motor-iec, en): ABB 6-row voltage table (690Y..440D 60 Hz), real 'D' for delta, IE3 line with efficiency at 100/75/50 % load; product code and bearings as number traps.
- `weg_w22_ie3_en` (motor-iec, en): WEG label-before-value layout, kW and HP on one token 'kW(HP) 7.5(10)', 'ΔT 80K' Δ that is not a connection, SF 1.00, altitude 1000 m trap.
- `sew_r47_gearmotor_de` (gearmotor, de): SEW gearmotor: voltage RANGES 220-242Δ/380-420Y, speed '1440/41' (motor/output), brake 230 V AC and gear ratio as traps, postal code 76646.
- `nema_baldor_10hp_en` (motor-nema, en): NEMA: HP/VOLTS/AMPS dual 230/460, SF 1.15 and separate SF AMPS (must not become current), PF printed as '82' percent, CODE/DES letters.
- `transformer_630kva_dyn5_de` (transformer, de): Oil distribution transformer: 630 kVA, '20 000 V' with thousands space, ± 2 x 2,5 % taps, Dyn5, uk 4,0 %, 'AC 50' insulation level (not Hz), oil mass vs total mass.
- `ocr_transformer_250kva_dyn11_en` (transformer, en): Dry-type transformer with OCR damage everywhere: 'Dyn1l', 'uk 6,O %', '1OOOO V', '36O,8 A', 'S0 Hz', 'IPOO'; 'kV A' split unit; 'DRY TYPE TRANSFORMER' heading is not the type.
- `pump_grundfos_cr_en` (pump, en): Pump unit plate: Q/H/n, '3x400 V' phases glued to voltage, 'P2 1924' inside the model code (NOT power) vs real 'P2 2.2 kW', 16 bar / 120 °C / PN 16 traps.
- `fan_ebmpapst_ac_de` (fan, de): Fan: two full rating rows (400 V Y / 230 V Δ) each with phases, input power in W (P1, not P2), no cos φ printed.
- `fc_nord_87hz_de` (motor-fc, de): Inverter-fed motor with two ratings: 50 Hz 230/400 V Δ/Y 0,75 kW and 87 Hz 400 V Δ 1,30 kW; '5 - 87 Hz' range and torque line as traps; postal code D-22941.
- `china_y2_delta_star_en` (motor-iec, en): Generic Asian Y2 plate: units glued ('2.2kW', '4.7/2.7A', '1430r/min'), Δ/Y with two currents, phases only as 'THREE-PHASE', long company name.
- `aeg_longform_split_labels_de` (motor-iec, de): Old AEG plate with long German labels on their own lines and values on the next line (Bemessungsleistung / 11 kW ...), no efficiency at all.
- `ocr_siemens_compact_de` (motor-iec, de): Damaged compact Siemens: '400A/690Y' where Δ became A (400 A trap), '4,SS' current, '4kVV', 'cos o', '1455/rnin', 'lE3', 'Sl'.
- `ocr_abb_split_row_en` (motor-iec, en): ABB table where OCR wrapped the first row: cos φ of the 400 V row lands alone on the next line; 'cos phi' header; 'l470', 'l2.0', 'O.84'; IE3 100/75/50 line.
- `ocr_weg_no_spaces_en` (motor-iec, en): WEG with all spaces dropped: 'kW(HP)3(4)RPMl44OSFl.OO', 'V400/690A6,37/3,69PFO,80', 'EFF8S,5%INS.CL.FΔT80K', 'VVEG'.
- `ocr_nema_fraction_hp_en` (motor-nema, en): NEMA 7 1/2 HP fraction, triple voltage '2O8-230/46O' with matching triple FLA and triple SF amps, '6O' Hz, 'l.15' SF, damaged model/serial.
- `ocr_wilo_pump_de` (pump, de): Pump with 'l/min' (OCR of 1/min, looks like litres per minute), 'rn³/h' and 'rn' units, '6,l A', 'O,86', 'IPSS', PN 16 / 120 °C traps.
- `ocr_single_phase_capacitor_de` (motor-iec, de): Single-phase capacitor motor: '1~', capacitor '25uF/450V' (450 V is NOT motor voltage), 'cosphi', '1/rnin', weight '9,B kg'.
- `ocr_ie4_90kw_de` (motor-iec, de): IE4 90 kW with efficiency at 100/75/50 % all OCR-damaged ('96,l', '9S,6', '(1OO%)', '(S0%)'), 'O,B6', 'l4BB/rnin', 'S0Hz', '9l,O' A.
- `ocr_glued_units_de` (motor-iec, de): Whole rating glued into one token '3~7,5kW400VΔl4,3A50Hz', then 'cosφ0,84 1455min-1'; type 'W4lR132M4' with spaces lost.
- `ocr_abb_heavy_8B_5S_en` (motor-iec, en): Heavily damaged ABB 2-pole: 'A8B', 'S,S kW', 'lO,S A', 'O,BB', 'B7,O %', 'lP SS', 'SO Hz', '29lS r/min', '3B kg'.
- `ocr_gearmotor_split_unit_de` (gearmotor, de): Bauer gearmotor: current values on one line and their unit 'A' at the start of the next, kW unit on the line after its value, 'coso', 'Rnotor', gear ratio and output speed n2.
- `missing_ddr_no_cosphi_de` (motor-iec, de): MISSING: old VEM/DDR plate without cos φ, efficiency, IE class, duty or weight; star only at 380 V; 'TGL 2643' standard number trap; speed in U/min.
- `missing_power_blower_de` (fan, de): MISSING: small blower plate with no power, no cos φ, no efficiency, no insulation class, no weight; only U/I/f/n.
- `missing_worn_plate_de` (motor-iec, de): MISSING: worn plate, OCR got junk on the maker/type line and the 690 V row; 'IP5.' is incomplete; only the 400 V row is readable.
- `missing_current_circulator_de` (pump, de): MISSING: EC circulator with only voltage, 50/60 Hz and a P1 power RANGE (4-40 W); no current, no speed, no Q/H; 'IPX4D' and 'TF 110' unusual tokens.
- `nema_single_phase_fraction_hp_en` (motor-nema, en): NEMA single-phase 3/4 HP (pure fraction), 115/230 V with 10.8/5.4 A, SF 1.25, no PF/efficiency printed, 'CAT 645' trap.
- `crane_s3_duty_de` (motor-iec, de): Crane motor with two duty ratings on separate rows (S3-40% ED 3,3 kW and S1 2,6 kW), brake 180 V DC trap.
- `dahlander_two_speed_de` (motor-iec, de): Pole-changing Dahlander motor: Δ/YY at one voltage, two powers, two currents, two speeds and two cos φ; type ends '4/2' (pole numbers).
- `fc_lenze_two_ratings_en` (motor-fc, en): Inverter-duty motor with a 50 Hz and a 100 Hz (field-weakening) rating at the same 400 V Y; 'fsw ≥ 4 kHz' and '5 - 100 Hz' traps.
- `transformer_control_1ph_en` (transformer, en): Single-phase control transformer: power in VA (not kVA), 50/60 Hz, PRI/SEC labels, no vector group, no cooling; 'ta 40 °C'.

## Coverage

- 31 fixtures, 629 ground-truth values, 107 absent-key entries, 58 physical consistency checks (all within ±10 %).
- Kinds: fan 2, gearmotor 2, motor-fc 2, motor-iec 16, motor-nema 3, pump 3, transformer 3
- Language: de 18, en 13
- With OCR damage beyond decimal comma: 14; `missing_*` plates with genuinely missing core fields: 4 (every fixture also lists its own `absent` keys).
- Plates with two or more currents (Δ/Y, multi-voltage, two speeds, two duties): 19; plates with several rating rows (different Hz): 6; efficiency at 100/75/50 % load: 3.
- OCR damage tags: decimal-comma 20, 1/l/I 10, 0/O 8, 5/S 7, glued-unit 6, rn/m 5, split-lines 3, φ->phi 3, Δ->D 3, 8/B 3, W/VV 2, φ->o 2, dropped-spaces 2, thousands-space 1, Δ->A 1
- Field keys used (fixtures containing the key): frequencyHz 31, manufacturer 30, phases 30, serial 30, insulationClass 28, type 28, voltage 28, current 27, speedRpm 27, ipRating 26, cosPhi 22, ratedPowerKw 22, connection 21, weightKg 21, duty 18, efficiencyClass 16, efficiencyPct 15, year 6, ambientC 5, ratedPowerHp 5, serviceFactor 5, codeLetter 3, efficiencyLoadPct 3, enclosure 3, frame 3, primaryCurrent 3, primaryVoltage 3, ratedPowerKva 3, secondaryCurrent 3, secondaryVoltage 3, ukPct 3, brakeVoltage 2, cooling 2, flowM3h 2, gearRatio 2, headM 2, inputPowerKw 2, nemaDesign 2, outputSpeedRpm 2, serviceFactorCurrent 2, vectorGroup 2, capacitorUf 1

## Proof the checker bites

A perturbed copy with 8 deliberate defects (wrong value, wrong line, out-of-range line, key both present and absent,
printed key moved to absent, physically impossible current, W/kW unit slip, undocumented OCR substitution 'G' for 6)
failed with exit 1 and 12 messages naming all 8 fixtures; the clean set exits 0.
