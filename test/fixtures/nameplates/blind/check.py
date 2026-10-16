#!/usr/bin/env python3
"""Independent checker for the blind nameplate fixtures.

Usage: python3 -I check.py <folder>
Exit code 0 = all fixtures pass, 1 = at least one problem (each printed).

Verifies, per fixture:
 1. .txt and .expected.json pair up; JSON has the documented top-level keys; fixture name matches.
 2. Every key is known, has the right value type and an allowed unit; arrays and line arrays match.
 3. Every line index is in range and every ground-truth value is literally on its cited line,
    allowing only the OCR damage documented in FORMAT.md.
 4. No key is both in fields and in absent; every core key of the kind is in exactly one of them.
 5. Keys listed as absent have no obvious label on any line (catches forgotten annotations).
 6. Physical consistency: for every check tuple, the printed members equal expected values and
    I_calc = P/(sqrt3*U*cos*eta) (3ph), P/(U*cos*eta) (1ph), P/(sqrt3*U*cos) (3ph-input),
    S/(sqrt3*U) (transformer3), S/U (transformer1) is within +-10 % of I.
    Every current value of a plate that prints a power must be covered by some check.
"""
import json, math, os, re, sys

STRING_KEYS = {"efficiencyClass", "ipRating", "insulationClass", "duty", "serial", "type", "manufacturer",
               "connection", "frame", "codeLetter", "nemaDesign", "enclosure", "vectorGroup", "cooling"}
UNITS = {"ratedPowerKw": {"kW", "W"}, "ratedPowerHp": {"hp"}, "inputPowerKw": {"kW", "W"},
         "voltage": {"V", "kV"}, "current": {"A"}, "frequencyHz": {"Hz"}, "cosPhi": {""},
         "speedRpm": {"rpm"}, "outputSpeedRpm": {"rpm"}, "efficiencyPct": {"%"}, "efficiencyLoadPct": {"%"},
         "weightKg": {"kg"}, "serviceFactor": {""}, "serviceFactorCurrent": {"A"}, "ambientC": {"°C"},
         "year": {""}, "gearRatio": {""}, "brakeVoltage": {"V"}, "capacitorUf": {"µF"}, "flowM3h": {"m3/h"},
         "headM": {"m"}, "ratedPowerKva": {"kVA", "VA"}, "primaryVoltage": {"V", "kV"},
         "secondaryVoltage": {"V", "kV"}, "primaryCurrent": {"A"}, "secondaryCurrent": {"A"}, "ukPct": {"%"},
         "phases": {""}}
for k in STRING_KEYS:
    UNITS[k] = {""}
MOTOR_CORE = ["ratedPowerKw", "ratedPowerHp", "voltage", "current", "frequencyHz", "cosPhi", "speedRpm",
              "efficiencyClass", "efficiencyPct", "ipRating", "insulationClass", "duty", "serial", "type",
              "manufacturer", "phases", "connection", "weightKg"]
TRAFO_CORE = ["ratedPowerKva", "primaryVoltage", "secondaryVoltage", "primaryCurrent", "secondaryCurrent",
              "vectorGroup", "ukPct", "frequencyHz", "phases", "serial", "type", "manufacturer", "weightKg",
              "cooling", "insulationClass", "ipRating"]
CORE = {"motor-iec": MOTOR_CORE, "motor-nema": MOTOR_CORE, "motor-fc": MOTOR_CORE, "gearmotor": MOTOR_CORE,
        "fan": MOTOR_CORE, "pump": MOTOR_CORE + ["flowM3h", "headM"], "transformer": TRAFO_CORE}
DAMAGE_TAGS = {"0/O", "1/l/I", "5/S", "8/B", "rn/m", "W/VV", "Δ->A", "Δ->D", "φ->o", "φ->phi", "decimal-comma",
               "dropped-spaces", "split-lines", "glued-unit", "thousands-space"}

# Labels that betray a field on the plate; used to catch keys wrongly listed as absent.
ABSENT_LABELS = {
    "ratedPowerKw": r"\d\s*k(W|VV)\b|\bkW\b",
    "ratedPowerHp": r"\bHP\b",
    "inputPowerKw": r"\bP1\b",
    "voltage": r"\d\s*V\b|VOLTS",
    "current": r"\d\s*A\b|AMPS|\bFLA\b",
    "frequencyHz": r"Hz|HZ",
    "cosPhi": r"cos|\bPF\b|P\.F\.|Leistungsfaktor",
    "speedRpm": r"min|rpm|RPM|r/min",
    "efficiencyClass": r"\b[Il1]E[1-5]\b|PREMIUM",
    "efficiencyPct": r"\bEFF|η|Wirkungsgrad",
    "ipRating": r"\b[Il1]P\s?[0-9OSX][0-9OSXD]",
    "insulationClass": r"Ins\.?\s?cl|INS\b|Isol\.?-?\s?Kl|Isolierstoffklasse|Iso\.?-?\s?Kl|Th\.?\s?Cl|\bCL\b|Insulation class",
    "duty": r"\bS[1-9]\b|\bCONT\b|Betriebsart|DUTY",
    "serial": r"\bNo\.|\bNr\.|\bSER\b|SER\.|N[°º]|Serial",
    "type": r"\bTyp\b|\bType\b|\bTYPE\b|\bMODEL\b|\bMOD\b|CAT\.NO",
    "phases": r"\d\s*~|\bPH\b|phase|PHASE|Drehstrom|Wechselstrom",
    "connection": r"Δ(?!T)|∆|\bY\b|\bYY\b|Stern|Dreieck",
    "weightKg": r"\bkg\b|Gewicht|weight",
    "flowM3h": r"m[³3]/h|Förderstrom|\bQ\b",
    "headM": r"Förderhöhe|\bH\s*\d|\bhead\b",
    "vectorGroup": r"\b[DY]yn\d|Schaltgruppe|Vector group",
    "ukPct": r"\buk\b|Impedance|Kurzschlussspannung",
    "cooling": r"\bON[AO]N\b|\bONAF\b|\bAN\b|\bAF\b|Cooling|Kühlung",
    "ratedPowerKva": r"kVA|kV A|\bVA\b",
    "primaryVoltage": r"\bOS\b|\bHV\b|\bPRI\b", "secondaryVoltage": r"\bUS\b|\bLV\b|\bSEC\b",
    "primaryCurrent": r"\bI1\b", "secondaryCurrent": r"\bI2\b",
    "manufacturer": None,
}

CONF = {"0": "[0Oo]", "1": "[1lI|!]", "5": "[5S]", "8": "[8B]"}
SEP = "[.,]"
THSP = "[   ]?"

def digit_class(ch):
    return CONF.get(ch, ch)

def int_pattern(s):
    if len(s) > 3:  # optional thousands space
        head = len(s) % 3 or 3
        groups = [s[:head]] + [s[i:i + 3] for i in range(head, len(s), 3)]
        return THSP.join("".join(digit_class(c) for c in g) for g in groups)
    return "".join(digit_class(c) for c in s)

def number_patterns(v, key):
    pats = []
    if float(v) == int(float(v)):
        pats.append(int_pattern(str(int(float(v)))) + "(?:" + SEP + "[0Oo]+)?")
    else:
        s = repr(float(v))
        ip, fp = s.split(".")
        pats.append(int_pattern(ip) + SEP + "".join(digit_class(c) for c in fp) + "[0Oo]*")
    if key == "cosPhi":
        pats.append(int_pattern(str(int(round(float(v) * 100)))))
    if key == "ratedPowerHp":
        fr = {0.5: "1/2", 0.25: "1/4", 0.75: "3/4"}
        whole = int(float(v)); rest = round(float(v) - whole, 4)
        if rest in fr:
            num, den = fr[rest].split("/")
            f = digit_class(num) + "/" + digit_class(den)
            pats.append((int_pattern(str(whole)) + "[ -]" + f) if whole else f)
    return pats

def number_on_line(v, key, line):
    for p in number_patterns(v, key):
        rx = r"(?<![0-9])(?<![0-9][.,])" + p + r"(?![0-9])(?![.,][0-9])"
        if re.search(rx, line):
            return True
    return False

def canon(s):
    s = s.upper()
    s = re.sub(r"[\s\-_.:·]+", "", s)
    s = s.replace("RN", "M").replace("VV", "W")
    return s.translate(str.maketrans({"O": "0", "I": "1", "L": "1", "|": "1", "!": "1", "S": "5", "B": "8"}))

def string_on_line(v, line):
    cv = canon(v)
    if not cv:
        return False
    if re.search(r"\d", cv) or len(cv) > 2:
        return cv in canon(line)
    toks = [canon(t) for t in re.split(r"[^0-9A-Za-zÀ-ÿ]+", line) if t]
    return cv in toks

DELTA = r"(Δ|∆|Dreieck|delta|DELTA|(?:(?<=\d)|(?<=\s)|(?<=/)|^)[ADd](?=[\s/]|$|\d))"
STAR = r"(Stern|star|STAR|(?:(?<=\d)|(?<=\s)|(?<=/)|^)[Yy](?=[\s/]|$|\d))"
DSTAR = r"((?:(?<=\d)|(?<=\s)|(?<=/)|^)YY(?=[\s/]|$|\d))"

def connection_on_line(v, line):
    for part in v.split("/"):
        rx = {"Δ": DELTA, "Y": STAR, "YY": DSTAR}.get(part)
        if rx is None or not re.search(rx, line):
            return False
    return True

def phases_on_line(v, line):
    if number_on_line(v, "phases", line):
        return True
    kw = {3: r"Drehstrom|THREE|three|Three", 1: r"Wechselstrom|SINGLE|single|Single"}
    return bool(re.search(kw.get(int(v), "$^"), line))

def value_on_line(key, v, line):
    if key == "connection":
        return connection_on_line(v, line)
    if key == "phases":
        return phases_on_line(v, line)
    if key in STRING_KEYS:
        return string_on_line(v, line)
    return number_on_line(v, key, line)

def to_base(key, v, unit):
    f = float(v)
    if unit in ("W", "VA"):
        return f / 1000
    if unit == "kV":
        return f * 1000
    return f

def values_of(fields, *keys):
    out = []
    for k in keys:
        if k in fields:
            fd = fields[k]
            vals = fd["value"] if isinstance(fd["value"], list) else [fd["value"]]
            out += [to_base(k, x, fd["unit"]) for x in vals]
    return out

def close(a, b):
    return abs(a - b) <= 1e-6 * max(1.0, abs(a), abs(b))

def check_fixture(folder, stem):
    errs = []
    lines = open(os.path.join(folder, stem + ".txt"), encoding="utf-8").read().split("\n")
    if lines and lines[-1] == "":
        lines = lines[:-1]
    exp = json.load(open(os.path.join(folder, stem + ".expected.json"), encoding="utf-8"))
    for k in ("fixture", "kind", "lang", "ocrDamage", "fields", "absent", "checks"):
        if k not in exp:
            errs.append(f"missing top-level key {k}")
    if errs:
        return errs
    if exp["fixture"] != stem:
        errs.append(f"fixture name {exp['fixture']} != file stem")
    if exp["kind"] not in CORE:
        errs.append(f"unknown kind {exp['kind']}")
    for t in exp["ocrDamage"]:
        if t not in DAMAGE_TAGS:
            errs.append(f"unknown ocrDamage tag {t}")
    if any("{{" in l or "}}" in l for l in lines):
        errs.append("marker remnant in text")
    fields = exp["fields"]
    for key, fd in fields.items():
        if key not in UNITS:
            errs.append(f"{key}: unknown key"); continue
        if fd.get("unit") not in UNITS[key]:
            errs.append(f"{key}: unit {fd.get('unit')!r} not allowed")
        vals, lns = fd["value"], fd["line"]
        if isinstance(vals, list) != isinstance(lns, list):
            errs.append(f"{key}: value/line array mismatch"); continue
        if not isinstance(vals, list):
            vals, lns = [vals], [lns]
        if len(vals) != len(lns) or not vals:
            errs.append(f"{key}: {len(vals)} values vs {len(lns)} lines"); continue
        for v, ln in zip(vals, lns):
            want_str = key in STRING_KEYS
            if want_str != isinstance(v, str) or isinstance(v, bool):
                errs.append(f"{key}: wrong type for {v!r}"); continue
            if not isinstance(ln, int) or not 0 <= ln < len(lines):
                errs.append(f"{key}: line {ln} out of range 0..{len(lines) - 1}"); continue
            if not value_on_line(key, v, lines[ln]):
                errs.append(f"{key}: {v!r} not found on line {ln}: {lines[ln]!r}")
    absent = exp["absent"]
    for k in absent:
        if k in fields:
            errs.append(f"{k}: both present and absent")
        if k not in UNITS:
            errs.append(f"{k}: unknown absent key")
        pat = ABSENT_LABELS.get(k)
        if pat:
            for i, l in enumerate(lines):
                if re.search(pat, l):
                    errs.append(f"{k}: listed absent but line {i} has a label for it: {l!r}")
                    break
    for k in CORE.get(exp["kind"], []):
        if k not in fields and k not in absent:
            errs.append(f"{k}: core key neither present nor absent")
    # physical consistency
    covered = set()
    for c in exp["checks"]:
        assumed = set(c.get("assumed", []))
        kind = c["kind"]
        def need(name, keys):
            if name in assumed or name not in c:
                return
            target = c[name] * (100 if name == "eta" else 1)
            if not any(close(target, x) for x in values_of(fields, *keys)):
                errs.append(f"check {c}: {name}={c[name]} not among printed {keys}")
        need("P_kW", ("ratedPowerKw", "inputPowerKw")); need("P_hp", ("ratedPowerHp",))
        need("S_kVA", ("ratedPowerKva",)); need("U", ("voltage", "primaryVoltage", "secondaryVoltage"))
        need("I", ("current", "primaryCurrent", "secondaryCurrent")); need("cosPhi", ("cosPhi",))
        need("eta", ("efficiencyPct",))
        P = c["P_kW"] * 1000 if "P_kW" in c else c.get("P_hp", 0) * 745.7
        U, I = c["U"], c["I"]
        if kind == "3ph":
            Ic = P / (math.sqrt(3) * U * c["cosPhi"] * c["eta"])
        elif kind == "1ph":
            Ic = P / (U * c["cosPhi"] * c["eta"])
        elif kind == "3ph-input":
            Ic = P / (math.sqrt(3) * U * c["cosPhi"])
        elif kind == "transformer3":
            Ic = c["S_kVA"] * 1000 / (math.sqrt(3) * U)
        elif kind == "transformer1":
            Ic = c["S_kVA"] * 1000 / U
        else:
            errs.append(f"unknown check kind {kind}"); continue
        if abs(Ic / I - 1) > 0.10:
            errs.append(f"check {kind} U={U} I={I}: calculated {Ic:.2f} A, off by {100 * (Ic / I - 1):+.1f} %")
        covered.add(round(I, 6))
    has_power = any(k in fields for k in ("ratedPowerKw", "ratedPowerHp", "inputPowerKw", "ratedPowerKva"))
    if has_power:
        for I in values_of(fields, "current", "primaryCurrent", "secondaryCurrent"):
            if round(I, 6) not in covered:
                errs.append(f"current {I} A has no consistency check")
    return errs

def main():
    if len(sys.argv) != 2:
        print(__doc__); return 2
    folder = sys.argv[1]
    txts = sorted(f[:-4] for f in os.listdir(folder) if f.endswith(".txt"))
    jsons = sorted(f[:-14] for f in os.listdir(folder) if f.endswith(".expected.json"))
    bad = 0
    for s in sorted(set(txts) ^ set(jsons)):
        print(f"FAIL {s}: missing .txt or .expected.json partner"); bad += 1
    stats = {"fixtures": 0, "values": 0, "checks": 0, "ocr": 0, "missing": 0}
    for stem in sorted(set(txts) & set(jsons)):
        try:
            errs = check_fixture(folder, stem)
        except Exception as e:  # malformed fixture
            errs = [f"exception {type(e).__name__}: {e}"]
        stats["fixtures"] += 1
        if errs:
            bad += 1
            for e in errs:
                print(f"FAIL {stem}: {e}")
        else:
            exp = json.load(open(os.path.join(folder, stem + ".expected.json"), encoding="utf-8"))
            n = sum(len(f["value"]) if isinstance(f["value"], list) else 1 for f in exp["fields"].values())
            stats["values"] += n; stats["checks"] += len(exp["checks"])
            stats["ocr"] += bool(set(exp["ocrDamage"]) - {"decimal-comma"})
            stats["missing"] += stem.startswith("missing_")
            print(f"ok   {stem}: {n} values, {len(exp['checks'])} checks, absent={len(exp['absent'])}")
    print(f"\n{stats['fixtures']} fixtures, {bad} failing; {stats['values']} ground-truth values, "
          f"{stats['checks']} consistency checks; {stats['ocr']} with OCR damage, {stats['missing']} missing_* plates")
    return 1 if bad else 0

if __name__ == "__main__":
    sys.exit(main())
