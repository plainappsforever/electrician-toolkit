# Blind nameplate fixtures, set 2

Second independent blind set. Written without reading `electrician-toolkit/src`, its test fixtures, or the first blind set's plates. Format and checker are the unchanged `FORMAT.md` / `check.py` of set 1. Generator lives outside this folder (`../nameplates-gen-2/`).

Run: `python3 -I check.py <this folder>`

## Fixtures

- `bonfiglioli_gearmotor_ranges` (gearmotor, en; φ->phi): Bonfiglioli BN gearmotor, Δ/Y on separate rows with voltage ranges, i and n2
- `brook_crompton_exd_t4` (motor-iec, en; clean): Brook Crompton Ex db flameproof motor, T4 temperature class trap
- `celma_delta_star_own_line_de` (motor-iec, de; decimal-comma): Celma (Cantoni) Sh 160M, Δ/Y marks on a separate line above the columns
- `danfoss_bauer_brake_gearmotor_de` (gearmotor, de; decimal-comma): Danfoss Bauer BG gearmotor with DC brake, German
- `elektrim_1ph_capacitor` (motor-iec, en; clean): Elektrim single-phase capacitor-run, 20 µF / 450 V capacitor trap
- `elektrim_sg132_range_ocr` (motor-iec, en; 0/O,1/l/I,5/S,rn/m,W/VV,Δ->A,φ->o,decimal-comma,glued-unit,dropped-spaces): Elektrim Sg 132M, 380-420/660-725 V range, very heavy OCR damage
- `grundfos_mge_integrated_drive` (motor-fc, en; clean): Grundfos MGE motor with integrated drive, voltage/current/speed ranges, P1/P2
- `hammond_dry_transformer_ocr` (transformer, en; 0/O,1/l/I): Hammond 45 kVA 480Δ-208Y/120 dry-type, l/O damage, LBS and 220 C traps
- `koncar_split_lines_ocr` (motor-iec, en; 0/O,1/l/I,Δ->D,W/VV,split-lines,decimal-comma,glued-unit): Končar 4 kW, Δ read as D on own line, current unit on next line
- `ksb_amarex_submersible_p1p2` (pump, en; rn/m): KSB Amarex submersible, P1/P2, submergence depth trap
- `ksb_etanorm_pump_only_de` (pump, de; clean): KSB Etanorm bare pump plate, Q/H/n only, all electrical fields absent
- `lafert_upside_down_reversed_rows` (motor-iec, en; clean): Lafert AMHE 4 kW, rows arrive in reverse order (upside-down photo)
- `lenze_range_delta_star_own_line` (motor-iec, en; clean): Lenze 0.75 kW, Δ/Y header line above 380-420 / 660-725 V columns
- `lenze_servo_mcs` (motor-iec, en; clean): Lenze MCS servo: Nm, I0 continuous / Imax peak, 330 V, 200 Hz
- `leroy_somer_lses_voltage_table` (motor-iec, en; clean): Leroy-Somer LSES table plate, four voltage rows under a column header
- `leroy_somer_lsk_dc_motor` (motor-iec, en; clean): Leroy-Somer LSK DC motor, armature/field rows, DC physics check
- `marathon_nema_designB_60hz` (motor-nema, en; clean): Marathon NEMA 5 HP, 208-230/460 V, Design B, Code J, SF amps
- `mez_mohelnice_ocr_de` (motor-iec, de; 0/O,1/l/I,5/S,rn/m,Δ->D,φ->o,decimal-comma,glued-unit): MEZ Mohelnice 2.2 kW 400 V Δ, Czech plate, heavy OCR damage
- `missing_brook_crompton_painted_over` (motor-iec, en; clean): Brook Crompton, bottom half painted over: no A, rpm, cos φ
- `missing_hanning_torn_label_pump` (pump, de; decimal-comma): Hanning drain-pump motor, type torn off, 'KW 12/23' calendar-week trap
- `missing_marathon_worn_amps` (motor-nema, en; clean): Marathon 1 1/2 HP ODP, amps/serial/code worn off
- `missing_toshiba_worn_power_line` (motor-iec, en; clean): Toshiba IEC worn: power line and cos φ rubbed off
- `missing_vem_corroded_voltage_line_de` (motor-iec, de; decimal-comma): VEM K11R 1.5 kW, voltage/frequency/serial line corroded away
- `missing_ziehl_abegg_faded_fan` (fan, en; clean): Ziehl-Abegg single-phase fan, current and serial faded, capacitor 400 V trap
- `riedel_control_transformer_1ph_de` (transformer, de; decimal-comma): Riedel 250 VA single-phase control transformer, Pri/Sek, VA unit
- `rossi_gearmotor_ocr` (gearmotor, en; 0/O,1/l/I,Δ->A,decimal-comma,glued-unit): Rossi MR gearmotor, heavy O/0 and l/1 damage, Δ read as A
- `rotor_400hz_aviation` (motor-iec, en; thousands-space): Rotor 400 Hz 200 V Y motor, 11 400 r/min
- `sgb_oil_transformer_dyn5_de` (transformer, de; thousands-space,decimal-comma): SGB-SMIT 630 kVA oil transformer, OS/US, 20 000 V, Dyn5
- `teco_nema_dropped_spaces` (motor-nema, en; dropped-spaces,glued-unit): Teco-Westinghouse NEMA Premium 10 HP ODP, spaces dropped everywhere
- `toshiba_iec_50_60hz_table` (motor-iec, en; clean): Toshiba IEC 11 kW, 50/60 Hz column table without per-value labels
- `toshiba_nema_premium_ocr` (motor-nema, en; 0/O,1/l/I): Toshiba EQP NEMA Premium 7 1/2 HP, l/1 and O/0 damage, weight in LBS
- `us_motors_575v_designB` (motor-nema, en; clean): US Motors (Nidec) 25 HP 575 V, Design B, Code G
- `vem_dahlander_two_rows_de` (motor-iec, de; decimal-comma): VEM Dahlander 4/2-pole, two rating rows Δ / YY
- `vem_ie2_full_load_only_de` (motor-iec, de; decimal-comma): VEM WE2R IE2 7.5 kW, efficiency at 100 % only, voltage range
- `weg_w21_brake_motor` (motor-iec, en; W/VV,Δ->A): WEG W21 brake motor, brake 180 V DC trap, ΔT trap, Δ read as A
- `ziehl_abegg_fan_p1_watts_de` (fan, de; 8/B,1/l/I,decimal-comma): Ziehl-Abegg axial fan, P1 in W, article number vs serial

## Coverage

- fixtures: 36; ground-truth values: 670; absent entries: 150
- with OCR damage beyond decimal comma: 13; worn/missing plates (`missing_*`): 6
- kinds: fan 2, gearmotor 3, motor-fc 1, motor-iec 19, motor-nema 5, pump 3, transformer 3
- languages: de 11, en 25
- damage tags: 0/O 6, 1/l/I 7, 5/S 2, 8/B 1, W/VV 3, decimal-comma 13, dropped-spaces 2, glued-unit 5, rn/m 3, split-lines 1, thousands-space 2, Δ->A 3, Δ->D 2, φ->o 2, φ->phi 1

## Conventions used in this set (within FORMAT.md, no new keys)

- Δ and Y on separate rows (each with its own voltages) -> `connection` is an array, one mark per row; one printed group `Δ/Y` (same line, or a Δ/Y header line above columns) -> scalar `Δ/Y`.
- DC motor: `voltage`/`current` = armature only; field (excitation) voltage/current are traps like a brake coil. Physics check = P = U*I*eta, encoded as kind `1ph` with cosPhi 1.0 marked assumed.
- Servo: `current` = rated IN; I0 (standstill continuous) and Imax (peak) are traps.
- Input-only power (P1 in W on a fan/pump motor) with a single-phase supply: kind `1ph` with eta 1.0 assumed.
- A worn plate whose voltage is gone keeps its current check with `U` in `assumed`.
- Weights printed in LBS and insulation printed only as a temperature (220 C) count as absent.
