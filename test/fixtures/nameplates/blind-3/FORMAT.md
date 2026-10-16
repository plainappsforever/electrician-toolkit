# Blind nameplate fixtures: format

Written independently of the parser (the author never read `electrician-toolkit/src`).
Each fixture is two files with the same stem:

- `<name>.txt` : OCR text as a phone OCR engine would emit it. UTF-8, one line per printed line,
  `\n` line ends, trailing newline. Line indices below are 0-based over `text.split("\n")`.
- `<name>.expected.json` : ground truth.

## expected.json

```json
{
  "fixture": "<name>",
  "kind": "motor-iec | motor-nema | motor-fc | gearmotor | pump | fan | transformer",
  "lang": "de | en",
  "ocrDamage": ["0/O", "decimal-comma", ...],
  "fields": {
    "<key>": { "value": <number|string>, "unit": "<string>", "line": <int> },
    "<key>": { "value": [<v1>, <v2>], "unit": "<string>", "line": [<l1>, <l2>] }
  },
  "absent": ["<key>", ...],
  "checks": [ { "kind": "3ph", "P_kW": 5.5, "U": 400, "I": 10.7, "cosPhi": 0.83, "eta": 0.896, "assumed": [] } ],
  "notes": "<traps a parser must not fall for>"
}
```

- `value` is the TRUE value printed on the plate, in the unit given by `unit` (the unit as printed,
  normalised spelling). Numbers are JSON numbers (decimal comma already converted). Strings are the
  true printed text (OCR damage already undone, e.g. type `1LE1002-1BB22-2AA4` even if OCR says
  `lLE1OO2-...`).
- Multi-valued fields are arrays **in reading order** (line by line, left to right), and then `line`
  is an array of the same length. Examples: `400/690 V` -> `[400, 690]`; `12.5/7.2 A` -> `[12.5, 7.2]`;
  a voltage range `220-242` counts as two entries; a plate with several rating rows (50 Hz / 60 Hz,
  or 50 Hz / 87 Hz inverter rows) repeats every per-row field once per row, so `frequencyHz` may be
  `[50, 50, 60]`. Single value -> scalar `value` and scalar `line`.
- When a printed unit differs from the key's canonical unit (e.g. a fan's `250 W` under `inputPowerKw`,
  a control transformer's `1000 VA` under `ratedPowerKva`), `value` stays as printed (250, 1000) and
  `unit` says `W` / `VA`. Convert before comparing: W/1000 -> kW, VA/1000 -> kVA, kV*1000 -> V.
- `absent`: every core key for the plate's kind (see below) that is NOT in the text. For worn plates
  "not in the text" also covers illegible lines. A parser should return nothing (or a low-confidence
  nothing) for these. Keys that make no sense for the kind (speed on a transformer) are neither in
  `fields` nor in `absent`.
- `checks`: physical consistency tuples used by `check.py` (not parser output). `assumed` lists tuple
  members that are NOT printed on the plate (typical catalogue values filled in), everything else must
  equal one of the expected values of the matching field.
- `ocrDamage`: tags from the damage list below that occur in this fixture's text.

## Keys

| key | type | canonical unit (`unit` values allowed) | notes |
|---|---|---|---|
| ratedPowerKw | number | kW (kW, W) | rated OUTPUT power (P2) |
| ratedPowerHp | number | hp | NEMA / dual-marked plates; fractions `7 1/2`, `3/4` are printed |
| inputPowerKw | number | kW (kW, W) | input power P1 (fans, circulators) |
| voltage | number | V (V, kV) | motor/pump/fan rated voltage(s); NOT brake or capacitor voltage |
| current | number | A | rated / full-load current(s) (FLA) |
| frequencyHz | number | Hz | |
| cosPhi | number | "" | may be printed as a percentage (`PF 82` = 0.82) |
| speedRpm | number | rpm | motor shaft speed (r/min, 1/min, min-1, U/min, rpm all = rpm) |
| outputSpeedRpm | number | rpm | gearbox output speed n2 |
| efficiencyClass | string | "" | `IE1`..`IE5`, `NEMA Premium` |
| efficiencyPct | number | % | first entry is full-load efficiency |
| efficiencyLoadPct | number | % | load points belonging to `efficiencyPct` entries (100/75/50) |
| ipRating | string | "" | `IP55` (written without space) |
| insulationClass | string | "" | single letter `B`/`F`/`H` (printed e.g. `155(F)`, `CL F`) |
| duty | string | "" | duty code as printed: `S1`, `S3 40%`, `CONT` |
| serial | string | "" | serial / production number as printed (spaces kept) |
| type | string | "" | type / model / catalogue designation |
| manufacturer | string | "" | maker name as printed |
| phases | number | "" | 1 or 3 (from `3~`, `PH 3`, `3x400 V`, `Drehstrom`, `THREE-PHASE`) |
| connection | string | "" | `Δ`, `Y`, `Δ/Y`, `Δ/YY`; one string per printed group, arrays for per-row groups |
| weightKg | number | kg | |
| serviceFactor | number | "" | NEMA SF |
| serviceFactorCurrent | number | A | NEMA SF amps (NOT `current`) |
| frame | string | "" | NEMA frame |
| codeLetter | string | "" | NEMA locked-rotor kVA code |
| nemaDesign | string | "" | NEMA design letter |
| enclosure | string | "" | TEFC / ODP |
| ambientC | number | °C | |
| year | number | "" | year of manufacture |
| gearRatio | number | "" | gearbox ratio i |
| brakeVoltage | number | V | brake coil voltage (trap for `voltage`) |
| capacitorUf | number | µF | run capacitor |
| flowM3h | number | m3/h | pump flow Q |
| headM | number | m | pump head H |
| ratedPowerKva | number | kVA (kVA, VA) | transformer rated power |
| primaryVoltage / secondaryVoltage | number | V (V, kV) | transformer HV / LV |
| primaryCurrent / secondaryCurrent | number | A | |
| vectorGroup | string | "" | `Dyn5`, `Dyn11` |
| ukPct | number | % | short-circuit (impedance) voltage |
| cooling | string | "" | ONAN, AN |

Core keys (drive `absent`):
- motor-iec, motor-nema, motor-fc, gearmotor, fan: ratedPowerKw, ratedPowerHp, voltage, current,
  frequencyHz, cosPhi, speedRpm, efficiencyClass, efficiencyPct, ipRating, insulationClass, duty,
  serial, type, manufacturer, phases, connection, weightKg.
- pump: the motor core keys plus flowM3h, headM.
- transformer: ratedPowerKva, primaryVoltage, secondaryVoltage, primaryCurrent, secondaryCurrent,
  vectorGroup, ukPct, frequencyHz, phases, serial, type, manufacturer, weightKg, cooling,
  insulationClass, ipRating.

## OCR damage used (and tolerated by check.py)

| tag | example in text | meaning |
|---|---|---|
| `0/O` | `4O0 V`, `O,84` | zero read as letter O/o |
| `1/l/I` | `l4,3 A`, `lP55`, `Sl` | one read as l, I or \| |
| `5/S` | `S,5 kW`, `IPSS` | five read as S |
| `8/B` | `9,B kg`, `l4BB` | eight read as B |
| `rn/m` | `1/rnin`, `rn³/h`, `Rnotor` | m read as rn |
| `W/VV` | `4kVV`, `VVEG` | W read as VV |
| `Δ->A`, `Δ->D` | `400A/690Y`, `D/Y` | delta sign read as A or D (ABB prints a real `D`; that is not damage) |
| `φ->o`, `φ->phi` | `cos o 0,82`, `coso`, `cosphi` | phi read as o or spelled out |
| `decimal-comma` | `7,5` | decimal comma (German print, not damage, but parsers must handle it) |
| `dropped-spaces` | `V400/690A6,37/3,69PF0,80` | spaces between label/value/unit lost |
| `split-lines` | `4,6/2,65` then `A   1,1` on the next line | a value and its unit/label on different lines |
| `glued-unit` | `7,5kW400VΔl4,3A50Hz` | units glued to numbers |
| `thousands-space` | `20 000 V` | space as thousands separator |

Other printed forms tolerated: `PF 82` for cos φ 0.82, `7 1/2` / `3/4` HP fractions, trailing zeros
(`6,20` = 6.2), `D`/`d`/`∆`/`Dreieck` for Δ, `Stern` for Y.

## Scoring suggestion for the parser test

Numbers: compare after unit conversion with relative tolerance 1e-6. Strings: compare after the
`canon()` normalisation in `check.py` (uppercase, drop whitespace and `-_.:·`, `RN->M`, `VV->W`,
`O->0`, `I/L/|/!->1`, `S->5`, `B->8`), because a parser cannot know whether a serial has O or 0.
Arrays: same order. A parser value for an `absent` key is a false positive.
