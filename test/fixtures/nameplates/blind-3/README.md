# Blind nameplate fixtures, set 3

Third independent blind set. Written without reading `electrician-toolkit/src`, its test fixtures, or the
plates of sets 1 and 2. Format and checker are the unchanged `FORMAT.md` / `check.py` of sets 1 and 2.
Generator lives outside this folder (`../nameplates-gen-3/`).

Character of this set: the plates an electrician in Germany photographs most (Siemens, ABB, WEG, SEW, Nord,
Lenze, Grundfos, Wilo, KSB, ebm-papst, Ziehl-Abegg, Danfoss/ABB/SEW converters, compressors, contactors,
distribution and control transformers).

Run: `python3 -I check.py <this folder>`

## Fixtures

- `siemens_1le1_eta_quarter_loads_60hz` (motor-iec, en; decimal-comma): Siemens 1LE1 11 kW, 400 Δ / 690 Y / 460 Δ 60 Hz rows, efficiency at 4/4, 3/4, 2/4 load
- `siemens_1la7_ocr_heavy` (motor-iec, en; 0/O,1/l/I,5/S,rn/m,Δ->D,φ->o,decimal-comma): Siemens 1LA7 1.5 kW 230/400 V, very heavy OCR damage (O/0, l/1, S/5, rn, D for Δ, coso)
- `siemens_1av_split_lines` (motor-iec, en; split-lines,decimal-comma): Siemens SIMOTICS GP 1AV IE4 2.2 kW, every value on one line and its unit/label on the next
- `siemens_geafol_dyn5_uk6_de` (transformer, de; decimal-comma): Siemens GEAFOL cast-resin 400 kVA 10/0.4 kV, Dyn5, Uk 6 %, tap ± 2 x 2,5 % trap, LI/AC test-voltage traps
- `siemens_3rt2_dc_coil_contactor` (motor-iec, en; dropped-spaces): Siemens SIRIUS 3RT2 contactor with 24 V DC coil: NOT a motor, every rating field absent
- `abb_m2bax_table_read_by_columns` (motor-iec, en; clean): ABB M2BAX 4 kW table plate, OCR read the table column by column (all V, then all Hz, then all kW ...)
- `abb_m3bp_four_rows_cos_phi` (motor-iec, en; φ->phi): ABB M3BP 11 kW, four rating rows 690 Y / 400 D / 415 D / 460 D 60 Hz, 'cos phi' spelled out
- `abb_acs580_u1_u2_converter` (motor-fc, en; clean): ABB ACS580 15 kW frequency converter: Input U1/I1/f1 vs Output U2/I2/f2, '033A' in the type code
- `missing_abb_m2_cropped_right` (motor-iec, en; decimal-comma): ABB M2AA 1.5 kW, photo cropped on the right: r/min, A, cos φ, IP digits, serial and weight cut off
- `weg_w22_ocr_vv_8b` (motor-iec, en; W/VV,8/B,0/O,decimal-comma): WEG W22 IE3 5.5 kW / 7.5 HP, efficiency at 100/75/50 %, 'VVEG', B for 8, ΔT 80K trap
- `sew_drn_gearmotor_brake_230ac_de` (gearmotor, de; decimal-comma): SEW R37DRN90L4/BE2 1.5 kW gearmotor, n 1450/58, i 24,96, brake 230 V AC trap, voltage ranges
- `sew_dre_gearmotor_dropped_spaces_ocr` (gearmotor, de; W/VV,0/O,rn/m,dropped-spaces,glued-unit,decimal-comma): SEW KA47DRE100M4 3 kW gearmotor, labels glued to values, 'SEVV', O for 0, '1/rnin1435/31'
- `sew_movitrac_eingang_ausgang_de` (motor-fc, de; decimal-comma): SEW MOVITRAC B 4 kW converter, German Eingang/Ausgang, output voltage '0-U Netz', Sach-Nr. trap
- `missing_sew_drn_label_scratched_de` (motor-iec, de; decimal-comma): SEW DRN80M4 0.75 kW, voltage values and Δ/Y scratched off the 'V' line
- `nord_two_columns_left_then_right_de` (gearmotor, de; decimal-comma): Nord SK gearmotor 3 kW, two printed columns (motor | gear); OCR emits the left column, then the right
- `nord_87hz_row_ocr` (motor-iec, en; 0/O,1/l/I,8/B,Δ->A,decimal-comma): Nord 80LP/4 0.75 kW with an 87 Hz row (400 V Δ, 1.3 kW), Δ read as A, 87 read as B7
- `missing_nord_oil_soaked` (motor-iec, de; decimal-comma): Nord 2.2 kW motor, oil-soaked: type, serial, duty and weight lines unreadable (not emitted by OCR)
- `lenze_kw_34_2023_week_de` (motor-iec, de; decimal-comma): Lenze 1.1 kW motor with a 'KW 34/2023' production-week line (Kalenderwoche, not kW)
- `aeg_current_two_lines_below_voltage_de` (motor-iec, de; decimal-comma): Old AEG 4 kW motor: '230/400 V' and '13,3/7,7 A' two lines apart, Δ/Y on the line between
- `perske_spindle_11400_de` (motor-iec, de; thousands-space,decimal-comma): Perske high-speed spindle 3 kW 330 V 200 Hz, '11 400 min-1', S1 and S6-60% rows
- `grundfos_cr_pump_only_p2_code` (pump, en; decimal-comma): Grundfos CR 10-04 bare pump plate: Q/H/n only; 'P2 2338' in the model line is a plant/date code
- `grundfos_cm_1ph_p1_p2` (pump, en; rn/m,decimal-comma): Grundfos CM3-5 single-phase pump, P1 0,65 kW and P2 0,45 kW, 16 µF capacitor, 'P1 2341' code trap
- `missing_grundfos_mg_faded` (motor-iec, en; decimal-comma): Grundfos MG 3 kW motor, current line faded to dots; 'P.c. 2309' production code is not a serial
- `wilo_stratos_p1_range_eei_de` (pump, de; decimal-comma): Wilo-Stratos circulator, P1 8-130 W and I 0,08-1,08 A ranges, EEI ≤ 0,20 and TF 110 traps
- `wilo_drain_tauchtiefe_p1_p2_de` (pump, de; 1/l/I,8/B,decimal-comma): Wilo-Drain TS 40/14 A submersible: P1/P2, Qmax/Hmax, 'Tauchtiefe max. 7 m' trap, 'lP6B'
- `ksb_etaline_p2_only_ocr` (pump, en; rn/m,1/l/I,0/O,W/VV,decimal-comma): KSB Etaline inline pump 7.5 kW, P2 only, 'kVV', 'rn³/h', 'l4,O A', no phases/cos printed
- `ebmpapst_ec_fan_input_w_de` (fan, de; 1/l/I,0/O,glued-unit,dropped-spaces,decimal-comma): ebm-papst EC centrifugal fan, 1~200-277V 50/60Hz, P 154W input power, glued units, '2311' date code
- `missing_ebmpapst_fan_bleached` (fan, en; clean): ebm-papst AC axial fan, sun-bleached label: only type, 3~ 400 V Y 50 Hz and IP/class remain
- `ziehl_abegg_two_speed_delta_star_de` (fan, de; decimal-comma): Ziehl-Abegg axial fan, two speeds by Δ/Y switching, P1 in W per row, Art.-Nr. vs Nr.
- `danfoss_fc51_1ph_in_3ph_out` (motor-fc, en; glued-unit,decimal-comma): Danfoss VLT Micro FC51 0.75 kW: IN 1x200-240V 9,9A, OUT 3x0-Vin 4,2A: phases trap (1 in, 3 out)
- `kaeser_screw_compressor_two_motors_de` (motor-iec, de; decimal-comma): Kaeser screw compressor plate with two motors: drive 11 kW 400/690 V Δ/Y and fan 0,25 kW 230/400 V Δ/Y
- `bitzer_compressor_y_yy_de` (motor-iec, de; decimal-comma): Bitzer semi-hermetic refrigeration compressor: part-winding Y/YY, max. Betriebsstrom, locked-rotor traps, no kW
- `compressor_1ph_run_start_caps_mu_de` (motor-iec, de; decimal-comma): ATB single-phase compressor motor 1.5 kW: run capacitor 30 μF (Greek mu) and start capacitor 100 µF (micro sign)
- `schneider_lc1d_dc_coil_contactor` (motor-iec, en; dropped-spaces): Schneider TeSys LC1D09BD contactor, 24 V DC coil: NOT a motor, every rating field absent
- `block_transformer_yyn0_ocr_de` (transformer, de; 0/O,1/l/I,8/B,decimal-comma): Block 10 kVA three-phase isolating transformer, Pri/Sek, Yyn0, uk 3,9 %, heavy O/l damage
- `missing_siemens_1le1_overspray` (motor-iec, en; decimal-comma): Siemens 1LE1, paint overspray hides the power / cos φ / duty line (not emitted by OCR)

## Coverage

- fixtures: 36; ground-truth values: 643; absent entries: 182
- with OCR damage beyond decimal comma: 15; worn/missing plates (`missing_*`): 6
  (plus plates whose fields are genuinely not printed: bare pump plate, contactors, compressor without kW)
- kinds: fan 3, gearmotor 3, motor-fc 3, motor-iec 20, pump 5, transformer 2
- languages: de 18, en 18
- damage tags: 0/O 7, 1/l/I 6, 5/S 1, 8/B 4, W/VV 3, decimal-comma 30, dropped-spaces 4, glued-unit 3, rn/m 4, split-lines 1, thousands-space 1, Δ->A 1, Δ->D 1, φ->o 1, φ->phi 1

## Conventions

Reused unchanged from set 2: Δ and Y on separate rows -> `connection` array, one printed group `Δ/Y` ->
scalar; DC motor = armature values; servo `current` = IN; P1-only single-phase -> kind `1ph` with eta 1.0
assumed; worn voltage -> current check with `U` assumed; LBS weights and temperature-only insulation count as
absent.

New in this set (all within FORMAT.md, no new keys):

- Frequency converter plates (kind `motor-fc`): the OUTPUT side is the motor rating. `current` = output
  current (I2 / OUT / Ausgang), `frequencyHz` = output frequency range (e.g. `0-590 Hz` -> `[0, 590]`),
  `phases` = output phases (a 1x input / 3x output drive has `phases` 3). Input current and input frequency are
  traps. Output voltage is printed without a number (`0-Vin`, `0...U1`, `0-U Netz`), so `voltage` = the input
  voltage range. `ratedPowerKw` = the printed motor power. Physics checks assume cos φ and η.
- Contactor plates (kind `motor-iec`): every rating field is absent; only `manufacturer` and `type` (what the
  plate really identifies) are present. Both contactors have DC coils printed `24VDC`. An AC coil printed
  `230 V 50/60 Hz` cannot be expressed: the unchanged check.py would read its `V` and `Hz` as labels of
  voltage and frequency and refuse the absent list.
- A plate carrying two motors (compressor drive motor + fan motor): every per-motor field is an array in
  reading order, drive motor first; fields printed once stay scalar.
- Efficiency load points printed as `4/4`, `3/4`, `2/4`: `efficiencyPct` lists the values, `efficiencyLoadPct`
  is left out (check.py wants literal 100/75/50 on the line).
- A field printed twice on a plate (ABB `IE3` in the header and the efficiency line) is scalar, cited at its
  first occurrence.
- Part-winding compressor motors use `connection` `Y/YY`.
- Production / date codes (`P.c. 2309`, Grundfos `P2 2338` in the Model line, ebm-papst `/ 2311`) are not
  serials, years or powers; Grundfos `Model:` lines are the serial.
