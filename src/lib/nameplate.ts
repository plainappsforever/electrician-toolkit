// Nameplate text parser (V1.5 phase A, NW2; docs/V15_LOG.md). Input: the text lines an on-device OCR returns for a photo
// of a motor or transformer rating plate. Output: CANDIDATES per field (value, unit, the line it came from, a confidence and
// the evidence) — never a filled form. The screen offers them and the user taps the one to use (WORKFLOW L26: never fill a
// field the user did not confirm); nothing here writes anywhere.
//
// What a plate looks like (sources in V15_LOG): value then unit ("1.5 kW", "400/690 V"), unit then value ("kW 1.5",
// "V 380-500", SEW style), a unit header over value rows (ABB/Siemens tables: "V Hz kW r/min A cos φ" / "400 D 50 1.5 …"),
// labels in German or English ("Nennstrom", "FLA", "Isol.-Kl. F", "Th.Cl. F", "Betriebsart S1"), Δ/Y pairs and ranges.
// OCR misreads handled where a number is expected: O/o→0, I/l/|→1, S→5, B→8, decimal comma or point, glued units
// ("4OOV", "1,5kW"), "cos φ" spelled "cosφ", "cos phi", "COS Φ", "cos ø", "PF"; each repair lowers the confidence.
//
// PURE and dependency-free (no `@/` imports): `scripts/nameplate-bench.mjs` runs it in plain Node.

export const NAMEPLATE_FIELDS = [
  'power',
  'voltage',
  'current',
  'frequency',
  'cosPhi',
  'speed',
  'efficiency',
  'ieClass',
  'ipRating',
  'insulationClass',
  'duty',
  'phases',
  'serial',
  'type',
] as const;
export type NameplateField = (typeof NAMEPLATE_FIELDS)[number];

export type Connection = 'delta' | 'star';

/** Why a candidate exists or how sure it is; shown to nobody, kept for tests, the bench and a future "why?" line. */
export type Evidence =
  | 'unit' // a unit sat right after the number ("400 V", "400V")
  | 'unit-first' // a unit sat right before it ("V 400")
  | 'label' // a field label named it ("Nennstrom", "FLA", "cos φ")
  | 'table' // a cell under a unit header
  | 'pair' // one of "a/b" (Δ/Y voltages, 50/60 Hz)
  | 'range' // one end of "a-b"
  | 'ocr-repair' // letters read as digits (O→0 …)
  | 'grouped' // "1.450" read as 1450 because 1.45 is implausible for the field
  | 'implausible' // outside the field's range: kept, not offered
  | 'percent-to-ratio' // "PF 82" → 0.82
  | 'ratio-to-percent' // "η 0.896" → 89.6 %
  | 'continuous' // "Duty CONT" → S1
  | 'secondary' // a value that is probably not the rating (capacitor, brake, service-factor amps, gear output, test or starting values)
  | 'input' // input power P1 ("P1", "Input", "Aufnahme"): not the shaft output a load-current calculation divides by η
  | 'part-load' // a value at a load point other than full load ("Eff 50% 91.0")
  | 'ambiguous' // the line pairs its units with numbers equally well both ways (a number lost at one end): not offered
  | 'look-alike' // an identifier holding letters OCR confuses with digits (O/0, I/1, S/5, B/8): check it against the plate
  | 'agree'; // found twice

export type Candidate = {
  field: NameplateField;
  /** Numbers in the unit given in `unit`; classes and identifiers as text ("IE3", "IP55", "F", "S1", "3"). */
  value: number | string;
  /** As printed, normalised spelling: kW W HP PS kVA VA MVA · V kV · A mA · Hz · rpm · % · '' for text and ratios. */
  unit: string;
  /** Numeric fields: the value in the base unit (W or VA, V, A, Hz, rpm, %, ratio); text fields: undefined. */
  base?: number;
  connection?: Connection;
  /** Index into the input lines, and that line as given. */
  line: number;
  source: string;
  /** The piece of the (normalised) line that produced it. */
  match: string;
  /** 0…1. `OFFER_THRESHOLD` and above is offered; below is kept for "show more". */
  confidence: number;
  repairs: string[];
  evidence: Evidence[];
};

export type NameplateReading = {
  lines: string[];
  candidates: Record<NameplateField, Candidate[]>;
};

/** Candidates at or above this confidence are offered on the screen (all of them, best first; the user taps one). */
export const OFFER_THRESHOLD = 0.5;

// ---------------------------------------------------------------- normalising

/** Unicode and OCR spelling variants to one form; the line keeps its words and spacing otherwise. */
export function normalizeLine(raw: string): string {
  return raw
    .normalize('NFKC')
    // both micro signs as one (NFKC already maps U+00B5 to U+03BC; kept explicit so "µF" never depends on it)
    .replace(/\u00B5/g, '\u03BC')
    // OCR junk at the edges of the line (rivets, frame lines): "_HP 7 1/2", "»400 V" (not "~", ".", ",": they mean something)
    .replace(/^\s*[_'*»«"`´’‘!?#^·+-]+(?=[^\s0-9])/, '')
    .replace(/^\s*[_'*»«"`´’‘!?#^·+-]+(?=[0-9])/, '')
    .replace(/(?<=\S)[_'*»«"`´’‘!?#^·+-]+\s*$/, '')
    .replace(/[∆△▲]/g, 'Δ')
    .replace(/[ϕΦɸФф]/g, 'φ')
    .replace(/[∼˜〜]/g, '~')
    .replace(/[−–—‐‑]/g, '-')
    .replace(/[“”„]/g, '"')
    // OCR: "m" read as "rn" in units ("1/rnin", "rnin-1", "rn³/h"), "W" read as "VV" after a number ("4kVV")
    .replace(/rn(?=in(?:-1|\b))/g, 'm')
    .replace(/rn(?=³|3\/h|\/h)/g, 'm')
    .replace(/([0-9][.,]?[OoIlSB]?\s?k?)VV(?![A-Za-z])/g, '$1W') // also "7,SkVV" (round 2: elektrim_sg132_range_ocr)
    .replace(/\bmin\s*(?:-\s*1|'\s*1|\^\s*-?\s*1)\b/gi, 'min-1')
    // a unit split by OCR after a number: "250 kV A", "630 kV A 50 Hz" (not "10 kV A 14,4": a bare number after the A is its current)
    .replace(/([0-9]\s?)kV\s+A(?![A-Za-z])(?!\s*[0-9][0-9.,/]*(?:\s+[0-9]|\s*$))/g, '$1kVA')
    // "V~", "V ~" = alternating current, not a phase count ("230 V~ 3,5 A" is 230 V and 3.5 A); "1~"/"3~" stay phases
    .replace(/(^|[0-9\s/])(k?V)\s?~(?!\s?[13](?![0-9.,]))/g, '$1$2 ')
    // OCR reads Δ as "A": "400A 690Y", "400 A / 690 Y" (a √3 pair of voltages) is "400Δ/690Y" — also with O/l for 0/1
    // in the digits ("23O A / 4OO Y V", round 2: rossi_gearmotor_ocr); the pair wins over a bare "230 A"
    .replace(/(?<![0-9A-Za-z.,])([1-9lI|][0-9OoIl|]{2})\s?A\s?\/?\s?([1-9lI|][0-9OoIl|]{2,3})\s?Y(?![A-Za-z])/g, (all, d: string, y: string) => {
      const n = (x: string) => Number(x.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1'));
      return /[0-9]/.test(d) && /[0-9]/.test(y) && n(y) / n(d) > 1.6 && n(y) / n(d) < 1.85 ? `${d}Δ/${y}Y` : all;
    })
    // US transformer secondaries "208Y/120 V", "480Y/277": the line and the phase voltage of one star system (√3 apart),
    // a voltage pair without a motor connection (round 2: hammond_dry_transformer_ocr)
    .replace(/(?<![0-9A-Za-z.,])([1-9][0-9]{2})\s?Y\s?\/\s?([1-9][0-9]{1,2})(?![0-9.,])/g, (all, l: string, p: string) => (Number(l) / Number(p) > 1.6 && Number(l) / Number(p) < 1.85 ? `${l}/${p}` : all))
    // phases glued to the voltage: "3~400 V", "3x400 V", "1~230 V"
    .replace(/(^|\s)([13])\s?[~x×]\s?(?=[0-9])/g, '$1$2~ ')
    // spaced ranges: "5 - 100 Hz", "380 - 415 V" (one group, so a setting range is seen as a range)
    .replace(/([0-9])\s+-\s+(?=[0-9])/g, '$1-')
    // spaced slashes: "400 / 690 V", "Δ / Y"
    .replace(/([0-9])\s*\/\s*(?=[0-9])/g, '$1/')
    .replace(/(^|\s)([ΔDY])\s*\/\s*(?=[ΔDY](?:\s|$))/g, '$1$2/')
    // a space as thousands separator before a unit: "20 000 V", "6 300 kVA", "11 400 r/min" (round 2: speeds too) — never
    // after IP/IE codes or a duty "S 1", inside a decimal or after "min-1 400 V"; "OS 20 000 V" (Oberspannung) is no duty
    .replace(/(?<![0-9.,/-]|IP\s?|IE\s?|(?:^|[^A-Za-z])S\s?)\b([1-9][0-9]?) ([0-9][05]0)(?= ?(?:V|kV|kVA|VA|W|kW|r\/min|rpm|RPM|min-1|1\/min|U\/min|tr\/min)(?![A-Za-z]))/g, '$1$2')
    // dual-unit print "kW(HP) 7.5(10)" → "7.5 kW 10 HP"
    .replace(/\b(kW|KW)\s*\(\s*(HP|hp)\s*\)\s*([0-9OoIlSB.,]+)\s*\(\s*([0-9OoIlSB.,/ -]+?)\s*\)/g, ' $3 kW $4 HP ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mixed-number horsepower with a space, "HP 7 1/2" → "HP 7-1/2" (only on lines that say HP); OCR "l"/"I"/"|" for the 1
 * of the numerator ("HP 7 l/2", round 2: toshiba_nema_premium_ocr) is read as 1 here (a number group needs a real digit
 * in every part, and "7 l/2" has no other reading next to "HP").
 */
function joinHpFractions(line: string): string {
  return /\bHP\b/i.test(line) ? line.replace(/(?<![0-9A-Za-z.,])([0-9]{1,3}) ([1-7lI|])\/(2|4|8)(?![0-9A-Za-z.,])/g, (_, w: string, n: string, d: string) => `${w}-${/[lI|]/.test(n) ? '1' : n}/${d}`) : line;
}

/**
 * A production week is no power (round 2, missing_hanning_torn_label_pump): German plates print the calendar week as
 * "KW 12/23" or "KW 12/2023" (Kalenderwoche/year), also "Woche 12", "Week 12/23", "CW 12". Upper-case "KW" + a week
 * number 1–53 + a year is read as a date; a bare "KW 12" only after a date word on the line ("Made in Germany KW 12",
 * "Datum", "Prod.", "Bj."), otherwise it stays a unit-first power ("KW 11 HP 15"). The date is masked into one inert
 * token so no unit can claim its numbers. Lower-case "kW 12/23" is always power.
 */
export function maskCalendarWeek(line: string): string {
  const week = '(0?[1-9]|[1-4][0-9]|5[0-3])';
  const year = '((?:19|20)[0-9]{2}|[0-9]{2})';
  const mask = (_: string, lead: string, w: string, y?: string) => `${lead}Kalenderwoche_${w}${y ? `_${y}` : ''}`;
  return line
    .replace(new RegExp(`(^|\\s)(?:Woche|Wo\\.|Week|Wk\\.?|CW|Kalenderwoche)\\s?${week}(?:\\s?[/.-]\\s?${year})?(?![0-9.,A-Za-z])`, 'g'), mask)
    .replace(new RegExp(`(^|\\s)KW\\s?${week}\\s?[/.-]\\s?${year}(?![0-9.,A-Za-z/-])`, 'g'), mask)
    .replace(new RegExp(`(^|\\s)KW\\s?${week}(?![0-9.,A-Za-z/-])`, 'g'), (all: string, lead: string, w: string, offset: number, str: string) =>
      /\b(?:Made\s+in\s+\S+|Datum|Date|Prod(?:uktion|uction|\.)?|Herst(?:ellung|\.)?|Fert(?:igung|\.)?|Baujahr|Bj\.?|Year)\s*[:.]?\s*$/i.test(str.slice(0, offset + lead.length)) ? mask(all, lead, w) : all
    );
}

/**
 * NEMA plates with the spaces dropped between label and value (round 2: teco_nema_dropped_spaces): "HP10 PH3 HZ60
 * RPM1765", "VOLTS230/460 AMPS24.6/12.3", "NEMANOMEFF91.7 PF85", "MODELEP0104C", "DUTYCONT" → the label, a space, the
 * value. Only on a line with at least two such tokens (a type code like "HP10X" or a lone "PF85" stays as it is).
 */
const GLUED_LABEL = /^(HP|PH|HZ|Hz|RPM|VOLTS?|AMPS?|SFA|SF|PF|FLA|KVA|kVA|KW|kW|(?:NEMA)?NOM(?:INAL)?EFF(?:ICIENCY)?|EFF)([0-9OoIl|][0-9OoIl|.,/-]*)$/;
const GLUED_NAME = /^(MODEL|DUTY|SERIALNO\.?|SERNO\.?)((?=[A-Z0-9-]*[0-9])[A-Z0-9][A-Z0-9-]{3,}|CONT)$/;
export function splitGluedLabels(line: string): string {
  const words = line.split(' ');
  const glued = words.filter((w) => (GLUED_LABEL.test(w) && /[0-9]/.test(w.replace(GLUED_LABEL, '$2'))) || GLUED_NAME.test(w)).length;
  if (glued < 2) return line;
  return words
    .map((w) => {
      const m = GLUED_LABEL.exec(w);
      if (m && /[0-9]/.test(m[2])) return `${m[1].replace(/^(NEMA)?(NOM(?:INAL)?)(EFF(?:ICIENCY)?)$/, (_, a?: string, b?: string, c?: string) => [a, b, c].filter(Boolean).join(' '))} ${m[2]}`;
      const n = GLUED_NAME.exec(w);
      return n && !/^SER/.test(n[1]) ? `${n[1]} ${n[2]}` : w;
    })
    .join(' ');
}

/** Words the OCR glues to numbers when it drops spaces ("7,5kW400VΔl4,3A50Hz", "V400/690A6,37/3,69PFO,80"). */
const GLUE_WORDS = ['cosφ', 'r/min', 'min-1', '1/min', '/min', 'kVA', 'kW', 'KW', 'Hz', 'HZ', 'rpm', 'RPM', 'EFF', 'PF', 'SF', 'HP', 'kg', 'VA', 'A', 'V', 'W', '%', 'Δ'];
const GLUE_MEASURE = new Set(['r/min', 'min-1', '1/min', '/min', 'kVA', 'kW', 'KW', 'Hz', 'HZ', 'rpm', 'RPM', 'HP', 'VA', 'A', 'V', 'W', '%']);

/**
 * Splits one space-less token at the unit words glued to numbers. Only when at least two DIFFERENT words sit next to
 * number-like characters and one of them is a unit: type codes like "1LE1002-2AA4" or "W4lR132M4" stay whole.
 */
export function unglue(piece: string): string[] {
  if (piece.length < 6 || !/[0-9]/.test(piece)) return [piece];
  const numish = (ch: string | undefined) => ch !== undefined && /[0-9OoIlSB.,]/.test(ch);
  const out: string[] = [];
  const words = new Set<string>();
  let buf = '';
  for (let i = 0; i < piece.length; ) {
    const w = GLUE_WORDS.find((g) => piece.startsWith(g, i));
    if (w && (numish(piece[i - 1]) || numish(piece[i + w.length]))) {
      if (buf) out.push(buf);
      out.push(w);
      words.add(w);
      buf = '';
      i += w.length;
      continue;
    }
    buf += piece[i];
    i++;
  }
  if (buf) out.push(buf);
  return words.size >= 2 && [...words].some((w) => GLUE_MEASURE.has(w)) ? out : [piece];
}

function unglueLine(line: string): string {
  return line
    .split(' ')
    .map((p) => unglue(p).join(' '))
    .join(' ');
}

const CONFUSABLE: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', '|': '1', S: '5', B: '8' };
const NUM_CHAR = '0-9OoIl|SB';
/** One number as OCR may print it: at least one real digit, letters that look like digits, one decimal separator group. */
const NUM_CORE = `(?:[${NUM_CHAR}]*[0-9][${NUM_CHAR}]*(?:[.,][${NUM_CHAR}]+)*|[${NUM_CHAR}]{1,3}[.,][${NUM_CHAR}]*[0-9][${NUM_CHAR}]*|[.,][0-9]+)`;

type Decimal = { value: number; alt?: number; repairs: string[] };

/** "4O0" → 400 (repair O→0), "1,5" → 1.5, "1.450" → 1.45 with alt 1450, "1.234,5" → 1234.5. Null when not a number. */
export function parseDecimal(text: string, allowNoDigit = false): Decimal | null {
  const repairs: string[] = [];
  let s = '';
  for (const ch of text) {
    const r = CONFUSABLE[ch];
    if (r !== undefined) {
      repairs.push(`${ch}→${r}`);
      s += r;
    } else s += ch;
  }
  if (!/^[0-9.,]*[0-9][0-9.,]*$/.test(s) && !/^[.,][0-9]+$/.test(s)) return null;
  if (!allowNoDigit && !/[0-9]/.test(text)) return null; // letters alone ("OO", "lS") are no number, unless a unit sits right next to them
  const seps = s.replace(/[0-9]/g, '');
  if (seps === '') return { value: Number(s), repairs };
  const lastSep = seps[seps.length - 1];
  if (seps.length > 1) {
    const kinds = new Set(seps);
    if (kinds.size === 2) {
      // "1.234,5": the decimal separator once, at the end; the other one only groups thousands before it
      const i = s.lastIndexOf(lastSep);
      const grp = lastSep === ',' ? '.' : ',';
      const intPart = s.slice(0, i);
      if (s.indexOf(lastSep) !== i || !new RegExp(`^\\d{1,3}(\\${grp}\\d{3})+$`).test(intPart)) return null;
      return { value: Number(`${intPart.split(grp).join('')}.${s.slice(i + 1)}`), repairs };
    }
    // one kind several times: grouping ("20.000.000")
    if (!/^\d{1,3}([.,]\d{3})+$/.test(s)) return null;
    return { value: Number(s.replace(/[.,]/g, '')), repairs };
  }
  const [a, b] = s.split(lastSep);
  const value = Number(`${a === '' ? '0' : a}.${b}`);
  if (Number.isNaN(value)) return null;
  const alt = /^[1-9]\d{0,2}$/.test(a) && /^\d{3}$/.test(b) ? Number(`${a}${b}`) : undefined;
  return alt === undefined ? { value, repairs } : { value, alt, repairs };
}

// ---------------------------------------------------------------- units

type Quantity = 'power' | 'voltage' | 'current' | 'frequency' | 'speed' | 'percent';
type UnitDef = { quantity: Quantity; unit: string; factor: number };

const U = (quantity: Quantity, unit: string, factor = 1): UnitDef => ({ quantity, unit, factor });
/** Exact spellings (case matters where a letter is ambiguous: "W" is a unit, "w" is not; "PS" is metric horsepower). */
const UNIT_SPELLINGS: Record<string, UnitDef> = {
  kW: U('power', 'kW', 1000),
  KW: U('power', 'kW', 1000),
  kw: U('power', 'kW', 1000),
  W: U('power', 'W'),
  HP: U('power', 'HP', 745.7),
  hp: U('power', 'HP', 745.7),
  Hp: U('power', 'HP', 745.7),
  PS: U('power', 'PS', 735.49875),
  kVA: U('power', 'kVA', 1000),
  KVA: U('power', 'kVA', 1000),
  kva: U('power', 'kVA', 1000),
  VA: U('power', 'VA'),
  MVA: U('power', 'MVA', 1e6),
  V: U('voltage', 'V'),
  VAC: U('voltage', 'V'),
  Vac: U('voltage', 'V'),
  VDC: U('voltage', 'V'),
  Vdc: U('voltage', 'V'),
  Volt: U('voltage', 'V'),
  VOLT: U('voltage', 'V'),
  Volts: U('voltage', 'V'),
  VOLTS: U('voltage', 'V'),
  kV: U('voltage', 'kV', 1000),
  KV: U('voltage', 'kV', 1000),
  A: U('current', 'A'),
  Amp: U('current', 'A'),
  Amps: U('current', 'A'),
  AMP: U('current', 'A'),
  AMPS: U('current', 'A'),
  Ampere: U('current', 'A'),
  mA: U('current', 'mA', 0.001),
  Hz: U('frequency', 'Hz'),
  HZ: U('frequency', 'Hz'),
  hz: U('frequency', 'Hz'),
  rpm: U('speed', 'rpm'),
  RPM: U('speed', 'rpm'),
  'r/min': U('speed', 'rpm'),
  'R/MIN': U('speed', 'rpm'),
  'rev/min': U('speed', 'rpm'),
  'min-1': U('speed', 'rpm'),
  'MIN-1': U('speed', 'rpm'),
  '1/min': U('speed', 'rpm'),
  '/min': U('speed', 'rpm'),
  'U/min': U('speed', 'rpm'),
  'U/MIN': U('speed', 'rpm'),
  'u/min': U('speed', 'rpm'),
  'tr/min': U('speed', 'rpm'),
  Upm: U('speed', 'rpm'),
  UpM: U('speed', 'rpm'),
  'l/min': U('speed', 'rpm'), // OCR of "1/min" — also litres per minute: offered only after an "n" label
  'I/min': U('speed', 'rpm'),
  '%': U('percent', '%'),
};
/** Suffixes that may be glued to a number, longest first so "kVA" wins over "VA" and "A". */
const GLUED_SUFFIXES = Object.keys(UNIT_SPELLINGS)
  .filter((k) => !['Volt', 'VOLT', 'Ampere'].includes(k))
  .sort((a, b) => b.length - a.length);

const FIELD_OF: Record<Exclude<Quantity, 'percent'>, NameplateField> = {
  power: 'power',
  voltage: 'voltage',
  current: 'current',
  frequency: 'frequency',
  speed: 'speed',
};

/** Plausible base-unit ranges; outside → 'implausible' (kept, not offered). */
const RANGE: Partial<Record<NameplateField, [number, number]>> = {
  power: [1, 2e8],
  voltage: [1, 1e6],
  current: [0.001, 1e5],
  frequency: [1, 2000],
  speed: [1, 1e5],
  cosPhi: [0.05, 1],
  efficiency: [10, 99.99],
};
const inRange = (field: NameplateField, base: number) => {
  const r = RANGE[field];
  return !r || (base >= r[0] && base <= r[1]);
};

// ---------------------------------------------------------------- tokens

type NumberGroup = { parts: Decimal[]; seps: string[]; raw: string };
type Tok = {
  text: string;
  i: number;
  num?: NumberGroup;
  unit?: UnitDef;
  /** Unit glued to the number ("400V"). */
  glued?: UnitDef;
  conn?: Connection[];
  reserved?: boolean;
  /** Digit-less look-alikes ("SO", "S,S", "lO,S"): a number only when a unit sits right next to it. */
  weak?: boolean;
};

const CONN_WORDS: Record<string, Connection[]> = {
  'Δ': ['delta'],
  D: ['delta'],
  Y: ['star'],
  'Δ/Y': ['delta', 'star'],
  'D/Y': ['delta', 'star'],
  'Y/Δ': ['star', 'delta'],
  'Y/D': ['star', 'delta'],
  'ΔY': ['delta', 'star'],
  delta: ['delta'],
  Delta: ['delta'],
  DELTA: ['delta'],
  star: ['star'],
  Star: ['star'],
  STAR: ['star'],
  Dreieck: ['delta'],
  Stern: ['star'],
};
/** Tokens that look like numbers but are something else: duty S1, IE3, IP55, mounting B3/V1, IM B35. */
const RESERVED = /^(?:S(?:10|[1-9])|IE[1-5]|IP[0-9X]{2}K?|IM|B\d{1,2}|V\d{1,2}|[1-5]E[1-5])$/;

const NUM_GROUP_RE = new RegExp(`^(${NUM_CORE}(?:[/-]${NUM_CORE})*)$`);
const SPLIT_GROUP_RE = new RegExp(`(${NUM_CORE})|([/-])`, 'g');

function numberGroup(text: string): NumberGroup | null {
  if (!NUM_GROUP_RE.test(text)) return null;
  const parts: Decimal[] = [];
  const seps: string[] = [];
  for (const m of text.matchAll(SPLIT_GROUP_RE)) {
    if (m[1] !== undefined) {
      const d = parseDecimal(m[1]);
      if (!d) return null;
      parts.push(d);
    } else seps.push(m[2]);
  }
  return parts.length > 0 && parts.length <= 4 ? { parts, seps, raw: text } : null;
}

/** "380-415D/660-690Y", "230Δ/400Y", "230Δ/400YV": a connection marker after each half → the parts with their connections. */
function innerMarkerGroup(piece: string): { group: NumberGroup; conns: Connection[]; unit?: UnitDef } | null {
  if (!piece.includes('/') || !/[0-9OoIl|](?:Δ|D|Y|A)(?:\/|$|[A-Za-z]+$)/.test(piece)) return null;
  // OCR reads Δ as "A": "400A/690Y" is a Δ/Y pair, not 400 A (only when another half is marked Y)
  if (/[0-9]A\//.test(piece) && /[0-9]Y(?:$|[A-Za-z]+$|\/)/.test(piece)) piece = piece.replace(/([0-9])A\//g, '$1Δ/');
  const unit = GLUED_SUFFIXES.find((s) => piece.endsWith(s) && piece.length > s.length && /[ΔDY]$/.test(piece.slice(0, -s.length)));
  const body = unit ? piece.slice(0, -unit.length) : piece;
  const conns: Connection[] = [];
  const clean: string[] = [];
  for (const half of body.split('/')) {
    const mk = /^(.*?[0-9OoIl|])(Δ|D|Y)$/.exec(half);
    const g = mk ? numberGroup(mk[1]) : null;
    if (!mk || !g) return null;
    for (let k = 0; k < g.parts.length; k++) conns.push(mk[2] === 'Y' ? 'star' : 'delta');
    clean.push(mk[1]);
  }
  const group = numberGroup(clean.join('/'));
  if (!group || group.parts.length !== conns.length) return null;
  return unit ? { group, conns, unit: UNIT_SPELLINGS[unit] } : { group, conns };
}

/**
 * OCR junk glued to the ends of a token (rivets, frame lines, smudges): "_400", "'50", "»7,5", "400V.", "~230" → the
 * token without it. A phase mark ("3~", "~3") keeps its "~"; a token of junk alone stays as it is (no number).
 */
export function stripJunk(piece: string): string {
  if (/^~?[13]~?$/.test(piece)) return piece;
  const s = piece.replace(/^(?:[_'*»«"`´’‘!?#^·~+-]|[.,](?![0-9]))+/, '').replace(/[_'*»«"`´’‘!?#^·~.,+-]+$/, '');
  return s === '' ? piece : s;
}

function tokenize(line: string): Tok[] {
  const spaced = line.replace(/[:;=]/g, ' ').replace(/[()[\]]/g, ' ').replace(/\s\|\s/g, ' ');
  const out: Tok[] = [];
  for (const rawPiece of spaced.split(' ')) {
    if (rawPiece === '') continue;
    const piece = stripJunk(rawPiece);
    const tok: Tok = { text: piece, i: out.length };
    const inner = innerMarkerGroup(piece);
    if (inner) {
      tok.num = inner.group;
      tok.conn = inner.conns;
      if (inner.unit) tok.glued = inner.unit;
      out.push(tok);
      continue;
    }
    let core = piece;
    // connection markers glued to either end: "400VΔ", "Δ400V", "690Y"
    const pre = /^(Δ|Y)(?=[0-9])/.exec(core);
    const post = /(?<=[0-9VA])(Δ|Y|D)$/.exec(core);
    if (CONN_WORDS[core] && !/^\d/.test(core)) {
      tok.conn = CONN_WORDS[core];
      out.push(tok);
      continue;
    }
    if (pre) core = core.slice(1);
    else if (post) core = core.slice(0, -1);
    if (RESERVED.test(core)) {
      tok.reserved = true;
      out.push(tok);
      continue;
    }
    const unit = UNIT_SPELLINGS[core];
    if (unit) {
      tok.unit = unit;
      out.push(tok);
      continue;
    }
    let group = numberGroup(core);
    if (!group) {
      for (const suffix of GLUED_SUFFIXES) {
        if (core.length > suffix.length && core.endsWith(suffix)) {
          const head = core.slice(0, -suffix.length);
          const g = numberGroup(head);
          if (g) {
            group = g;
            tok.glued = UNIT_SPELLINGS[suffix];
            break;
          }
          // round 2: "SOHz" — a mains frequency of digit-less look-alikes with "Hz" glued on is 50 Hz (as "SO Hz"); only
          // 50/60 Hz: "BBA", "lSV" are more likely letters than 88 A or 15 V
          const weakHead = /^[OoIlSB|]{2}$/.test(head) && !/^[Oo]/.test(head) && UNIT_SPELLINGS[suffix].quantity === 'frequency' ? parseDecimal(head, true) : null;
          if (weakHead && (weakHead.value === 50 || weakHead.value === 60)) {
            group = { parts: [weakHead], seps: [], raw: head };
            tok.glued = UNIT_SPELLINGS[suffix];
            tok.weak = true;
            break;
          }
        }
      }
    }
    // ("OS" = Oberspannung would be "05", "Sl" is the duty S1: neither is a number)
    if (!group && /^[OoIlSB|]{1,3}(?:[.,][OoIlSB|]{1,3})?$/.test(core) && (core.length >= 2 || /[.,]/.test(core)) && !/^[Oo][^.,]/.test(core) && !/^S[lI|]$/.test(core)) {
      const d = parseDecimal(core, true);
      if (d) {
        group = { parts: [d], seps: [], raw: core };
        tok.weak = true;
      }
    }
    if (group) {
      tok.num = group;
      if (group && (pre || post)) tok.conn = [(pre ?? post)![1] === 'Y' ? 'star' : 'delta'];
    }
    out.push(tok);
  }
  // "I1 2.5 A", "U2 230 V", "P1 2,6 kW": one look-alike letter and one digit before a number is a label, not "12"
  for (let k = 0; k + 1 < out.length; k++) if (out[k].num && /^[IlOSB|][0-9]$/.test(out[k].text) && out[k + 1].num) delete out[k].num;
  return out;
}

// ---------------------------------------------------------------- building candidates

/** `drive`: the plate is a motor with its own drive (driveOnPlate): its speed range is the rating (D105). */
type Ctx = { line: number; source: string; out: Candidate[]; drive?: boolean };

/**
 * Round 2, orchestrator decision (D105): a motor with a built-in drive — Grundfos MGE, "integrated frequency converter",
 * "Umrichter", "VFD", or a second frequency rating next to 50/60 Hz ("50 Hz … 87 Hz") — runs over its speed range, so
 * that range IS its rating and is offered; every other plate keeps the S7 cap (a range is a drive's setting range).
 */
const DRIVE_WORDS = /\bMGE\b|integrated\s+(?:frequency\s+)?(?:converter|drive|inverter)|umrichter|\bVFD\b|frequency\s+converter/i;
function driveOnPlate(norms: readonly string[]): boolean {
  if (norms.some((n) => DRIVE_WORDS.test(n))) return true;
  const hz = new Set<number>();
  for (const n of norms) for (const m of n.matchAll(/(?<![0-9.,/-])([0-9]{2,4})(?:\/([0-9]{2,4}))?\s?(?:Hz|HZ|hz)(?![A-Za-z])/g)) for (const v of [m[1], m[2]]) if (v) hz.add(Number(v));
  return (hz.has(50) || hz.has(60)) && [...hz].some((v) => v !== 50 && v !== 60);
}

function push(ctx: Ctx, c: Omit<Candidate, 'line' | 'source'>) {
  ctx.out.push({ ...c, confidence: Math.max(0, Math.min(0.99, c.confidence)), line: ctx.line, source: ctx.source });
}

/**
 * Lines whose voltages/currents belong to something else (capacitor, brake, fan, heater, SEW brake "BE2 …", the field
 * winding of a DC motor: "EXCITATION / FIELD 360 V 3.9 A", "Erregung 180 V"). A torque ("20 Nm") no longer makes the
 * whole line secondary (round 2: a servo prints "MN 5.1 Nm IN 3.5 A"); only the number before "Nm" is taken out.
 */
const SECONDARY_LINE = /(?:\bkond|\bcap(?:acitor)?\b|\bMFD\b|\bbrems|\bbrake|\bbremse|\bfan\b|\blüfter|\bfremdlüfter|\bheiz|\bheater|\bthermist|\bPTC\b|\bCT\s*1:|\bBE\d|\bexcit|\berreg|\bfield\b|\bfeld\b|\bshunt\b)/i;
/**
 * µF/uF only as a unit, case-sensitive: never inside a word ("Käfigläufer", "Anlaufstrom", "Stufe", S2). Both micro
 * signs: NFKC turns MICRO SIGN U+00B5 into GREEK SMALL LETTER MU U+03BC, so the line holds the latter (round 2 fix).
 */
const SECONDARY_CASED = /(?<![A-Za-zÀ-ɏ])[\u00B5\u03BCu]F(?![A-Za-zÀ-ɏ])/;

/**
 * Words before a value that make it something other than the rating (M3, L26), per field they disqualify: guaranteed /
 * minimum efficiency, service-factor amps, starting / locked-rotor current and its ratios, gear output speed, setting
 * ranges, test and insulation voltages, capacitor values. Applied to the words between the previous number on the line
 * and the value (`wordsBefore` / `textBefore`), case-insensitive unless noted.
 */
const NOT_RATING: [RegExp, readonly NameplateField[] | 'all'][] = [
  [/\bguar(?:anteed|\.)?(?![a-z])|\bmin(?:imum|\.)?\s*(?:eff|η|wirk)|\bmindest/i, ['efficiency']],
  [/\bservice\s*factor\s*(?:amps?|current|a)\b|\bS\.?\s?F\.?\s*A(?:mps?)?\b|\bSFA\b/i, ['current']],
  [/\bstart(?:ing)?\s*(?:current|amps?)|\banlaufstrom|\banzugsstrom|\bLRA\b|\blocked[\s-]*rotor|\binrush|\bI[aAsSkK]\s*\/\s*I[nNrR]\b|\b[MT][aAkK]\s*\/\s*[MT][nNrR]\b/i, ['current', 'power']],
  // servo: I0 = standstill current, Imax / peak = short-time maximum (round 2, lenze_servo_mcs); rated is IN
  [/(?:^|\s)(?:I0|I_0|Imax|I_max|Ipeak|Ip)(?![A-Za-z0-9])|\bpeak\b|\bstandstill\b|\bstillstand|\bmax(?:imum|\.)?\s*(?:current|strom)/i, ['current']],
  [/\boutput\s*(?:speed|rpm|r\/min|shaft)|\babtrieb|\bausgangsdrehzahl/i, ['speed']],
  [/(?:^|\s)(?:n2|n_2|na|n_a|nab)(?![A-Za-z0-9])/, ['speed']],
  [/bereich|\brange\b|\bsetting/i, ['frequency', 'speed']],
  [/\btest|\bprüf|\bpruef|\bBIL\b|\binsulation\s*level|\bisolationspegel|\bimpuls|\bstehspannung/i, 'all'],
  // Um = highest voltage for equipment, LI = lightning impulse level (transformers), case-sensitive
  [/(?:^|\s)(?:Um|LI)(?![A-Za-z0-9])/, ['voltage']],
  [/\bMFD\b|\bcap(?:acitor)?\b|\bkond/i, 'all'],
];
/** Input power P1: marked, not hidden (owner question in V15_LOG: offer it with "use η = 1", or keep it below 0.5). */
const INPUT_POWER = /(?:^|\s)P1(?![0-9])|\binput\b|aufnahme|aufgenommen|\babsorbed\b/i;

function notRatingContext(words: string, field: NameplateField, unit?: UnitDef): boolean {
  if (NOT_RATING.some(([re, fields]) => (fields === 'all' || fields.includes(field)) && re.test(words))) return true;
  // "AC 50 kV": the power-frequency withstand level of a transformer, not its rated voltage
  return field === 'voltage' && unit?.unit === 'kV' && /(?:^|\s)AC(?![A-Za-z])/.test(words);
}

/** The token texts between the previous number on the line and token `k` (what labels the value at `k`). */
function wordsBefore(toks: readonly Tok[], k: number): string {
  const w: string[] = [];
  for (let j = k - 1; j >= 0 && !toks[j].num; j--) w.unshift(toks[j].text);
  return w.join(' ');
}

/** The words of `norm` before `index` back to the previous number (a word starting with a digit). */
function textBefore(norm: string, index: number): string {
  const words = norm.slice(0, index).split(' ');
  const out: string[] = [];
  for (let j = words.length - 1; j >= 0 && !/^[0-9]/.test(stripJunk(words[j])); j--) out.unshift(stripJunk(words[j]));
  return out.join(' ');
}

/** A number group with its unit → one candidate per part (pairs, ranges). */
function numericCandidates(ctx: Ctx, group: NumberGroup, unit: UnitDef, how: 'unit' | 'unit-first' | 'table' | 'label', base: number, conns: Connection[] | undefined, match: string, secondary: boolean, notRating = false, input = false) {
  if (unit.quantity === 'percent') return;
  const field = FIELD_OF[unit.quantity];
  // S6: a Δ/Y mark belongs to a voltage or a current, never to a power, frequency or speed on the same line
  if (field !== 'voltage' && field !== 'current') conns = undefined;
  // S7: a frequency or speed range ("5-100 Hz", "300-3000 rpm") is a drive's setting range, not the rating — unless both
  // ends are rated values (50-60 Hz; a slip range like 1455-1470 rpm)
  const rangeVals = group.seps.length === 1 && group.seps[0] === '-' && group.parts.length === 2 ? group.parts.map((p) => p.value) : null;
  const settingRange =
    !!rangeVals &&
    ((field === 'frequency' && !rangeVals.every((v) => v === 50 || v === 60)) || (field === 'speed' && !ctx.drive && !(Math.min(...rangeVals) >= 100 && Math.max(...rangeVals) / Math.min(...rangeVals) <= 1.1)));
  const fraction = hpFraction(group, unit);
  if (fraction !== null) group = { parts: [{ value: fraction, repairs: group.parts.flatMap((p) => p.repairs) }], seps: [], raw: group.raw };
  const many = group.parts.length > 1;
  group.parts.forEach((part, k) => {
    let value = part.value;
    const evidence: Evidence[] = [how];
    let conf = base;
    if (part.repairs.length > 0) {
      evidence.push('ocr-repair');
      conf *= repairFactor(part.repairs.length);
    }
    if (!inRange(field, value * unit.factor) && part.alt !== undefined && inRange(field, part.alt * unit.factor)) {
      value = part.alt;
      evidence.push('grouped');
      conf *= 0.8;
    }
    // "1.450 rpm" is not 1.45 rpm: speeds below 100 rpm only on gear outputs; prefer the grouped reading when there is one
    if (field === 'speed' && value < 100 && part.alt !== undefined) {
      value = part.alt;
      evidence.push('grouped');
      conf *= 0.8;
    }
    if (many) {
      const sep = group.seps[Math.max(0, k - 1)] ?? '/';
      evidence.push(sep === '-' && (k === 0 ? group.seps[0] === '-' : true) ? 'range' : 'pair');
    }
    // "r/min 1400/73": motor / gear output — the second, much smaller one is not the motor's speed
    if (field === 'speed' && k > 0 && value < group.parts[0].value / 5) {
      evidence.push('secondary');
      conf = Math.min(conf, 0.45);
    }
    if (notRating || (secondary && (field === 'voltage' || field === 'current' || field === 'power'))) {
      evidence.push('secondary');
      conf = Math.min(conf, 0.4);
    }
    if (settingRange) {
      evidence.push('secondary');
      conf = Math.min(conf, 0.45);
    }
    if (input && field === 'power') evidence.push('input');
    const baseValue = value * unit.factor;
    if (!inRange(field, baseValue)) {
      evidence.push('implausible');
      conf *= 0.4;
    }
    const connection = conns && conns.length === group.parts.length ? conns[k] : conns && conns.length === 1 && !many ? conns[0] : undefined;
    push(ctx, { field, value: round(value), unit: unit.unit, base: round(baseValue), connection, match, confidence: conf, repairs: part.repairs, evidence });
  });
}

const round = (x: number) => Number(x.toPrecision(12));

/** Confidence factor for OCR repairs in one number: the first costs most; "2OOOO" (four O→0) is still a likely 20000. */
export function repairFactor(n: number): number {
  return n === 0 ? 1 : 0.85 * 0.95 ** (n - 1);
}

/** US plates print fractional horsepower: "1/2 HP", "3/4", "1-1/2" (= 1.5). Null when the group is not such a fraction. */
function hpFraction(group: NumberGroup, unit: UnitDef): number | null {
  if (unit.unit !== 'HP') return null;
  const v = group.parts.map((p) => p.value);
  const isInt = (x: number) => Number.isInteger(x);
  const den = (x: number) => [2, 3, 4, 6, 8, 16, 32].includes(x);
  if (v.length === 2 && group.seps[0] === '/' && v.every(isInt) && den(v[1]) && v[0] < v[1]) return v[0] / v[1];
  if (v.length === 3 && group.seps[0] === '-' && group.seps[1] === '/' && v.every(isInt) && den(v[2]) && v[1] < v[2]) return v[0] + v[1] / v[2];
  return null;
}

/** A field label right before a line's first number means the line reads "label value", like "unit value". */
const LAYOUT_LABEL = /^(?:FLA|F\.L\.A\.?|FL|U|Un|I|In|P|P1|P2|Pn|n|f|PH|Nennstrom|Strom|Spannung|Nennspannung|Leistung|Nennleistung|Drehzahl|Frequenz)$/i;
const LABEL_FIELD: [RegExp, NameplateField][] = [
  [/^(?:FLA|F\.L\.A\.?|FL|I|In|Nennstrom|Strom)$/i, 'current'],
  [/^(?:U|Un|Spannung|Nennspannung)$/i, 'voltage'],
  [/^(?:P|P1|P2|Pn|Leistung|Nennleistung)$/i, 'power'],
  [/^(?:n|Drehzahl)$/i, 'speed'],
  [/^(?:f|Frequenz)$/i, 'frequency'],
];
/** Gear-unit output speed labels: "n2=41 1/min" is not the motor speed. */
const GEAR_OUT = /^(?:n2|n_2|na|n_a|nab)$/i;

/**
 * Units attach to the number right before them ("400 V"), otherwise to the number right after ("V 400"); a number takes
 * one unit. Of two free neighbours the one with fewer OCR repairs wins (so "S1 kW 1.5" is not 51 kW).
 */
function attachUnits(ctx: Ctx, toks: Tok[], used: Set<number>, secondary: boolean) {
  const firstMarkerIsPrefix = (() => {
    for (const t of toks) {
      if (t.conn && !t.num) return true;
      if (t.num) return false;
    }
    return false;
  })();
  const lineConns = toks.filter((t) => t.conn && !t.num);
  const pairConn = lineConns.find((t) => (t.conn?.length ?? 0) > 1)?.conn;
  const singleMarkers = lineConns.filter((t) => t.conn?.length === 1);

  const connFor = (numTok: Tok): Connection[] | undefined => {
    if (numTok.conn) return numTok.conn;
    if (pairConn && numTok.num && numTok.num.parts.length === pairConn.length) return pairConn;
    if (singleMarkers.length === 1 && lineConns.length === 1 && numTok.num?.parts.length === 1) return singleMarkers[0].conn;
    if (singleMarkers.length > 1) {
      // several markers: each belongs to the next number (prefix layout) or to the previous one (suffix layout)
      for (const m of singleMarkers) {
        const target = firstMarkerIsPrefix ? toks.slice(m.i + 1).find((t) => t.num) : [...toks.slice(0, m.i)].reverse().find((t) => t.num);
        if (target === numTok) return m.conn;
      }
    }
    return undefined;
  };
  // M3: what the words before a value say about it; a "VA" on a motor line is "V" with Δ read as "A" (M1: "3~ Mot. 400 VA")
  const motorLine = /\bMot(?:or)?\b/i.test(ctx.source);
  // M5: a Y-marked voltage next to the only "A" value of the line, and that value looks like a voltage: probably Δ read as A
  const amps = toks.filter((t) => (t.unit ?? t.glued)?.unit === 'A');
  const starVoltage = toks.some((t) => t.num && !t.glued && t.conn?.length === 1 && t.conn[0] === 'star');
  const yOnLine = toks.some((t) => t.conn?.includes('star'));
  const voltNums = toks.flatMap((t) => (t.num && ((t.glued ?? toks[t.i + 1]?.unit)?.quantity === 'voltage') ? t.num.parts.map((p) => p.value) : []));
  const judge = (target: Tok, unit: UnitDef) => {
    const words = wordsBefore(toks, target.i);
    const a = target.num!.parts[0].value;
    // round 2: "230 A 400 V Y" — a Y mark on the line and a voltage √3 times the "A" value is the same Δ-read-as-A pair
    const sqrt3Partner = yOnLine && voltNums.some((v) => v / a > 1.6 && v / a < 1.85);
    const looksDelta = (starVoltage || sqrt3Partner) && amps.length === 1 && unit.unit === 'A' && target.num!.parts.length === 1 && Number.isInteger(a) && a >= 100 && a <= 1000;
    return { notRating: (unit.quantity !== 'percent' && notRatingContext(words, FIELD_OF[unit.quantity], unit)) || (motorLine && unit.unit === 'VA') || looksDelta, input: INPUT_POWER.test(words) };
  };

  // a torque ("M0 6.6 Nm", "BE2 … 20 Nm") is no field of ours: its number is taken out, so no unit can claim it
  for (const t of toks) if (t.num && /^(?:Nm|NM|kNm)$/.test(toks[t.i + 1]?.text ?? '')) used.add(t.i);
  for (const t of toks) {
    if (t.num && t.glued && !used.has(t.i)) {
      used.add(t.i);
      const j = judge(t, t.glued);
      numericCandidates(ctx, t.num, t.glued, 'unit', 0.8, connFor(t), t.text, secondary || j.notRating, j.notRating, j.input);
    }
  }
  // Layout of the line: "unit value" ("HP 10 RPM 3500", SEW "kW 1.5") or "value unit" ("400 V 18,2 A"); a label
  // before the first number counts as a unit. A unit takes its layout's neighbour first, the other one only
  // when that is free and not already claimed by its own unit; a % only ever takes the number before it.
  const firstNumber = toks.find((t) => t.num);
  const beforeFirstNumber = firstNumber ? toks[firstNumber.i - 1] : undefined;
  // "FLA 7.2 VOLTS 460": a label before the first number and another field's unit after it → "label value, unit value";
  // "Drehzahl 1455 min-1 50 Hz": the unit after the number is the label's own → plain "value unit"
  const afterFirstNumber = firstNumber ? toks[firstNumber.i + 1] : undefined;
  const labelField = beforeFirstNumber && LAYOUT_LABEL.test(beforeFirstNumber.text) ? LABEL_FIELD.find(([re]) => re.test(beforeFirstNumber.text))?.[1] : undefined;
  const ownUnitAfter = !!afterFirstNumber?.unit && afterFirstNumber.unit.quantity !== 'percent' && FIELD_OF[afterFirstNumber.unit.quantity as Exclude<Quantity, 'percent'>] === labelField;
  // M1 (REVIEW_V15_PA): the layout is not decided by the first token any more — one junk character glued to the first
  // number flipped the whole line. Both readings are simulated with the same rules; the one that pairs more units with
  // numbers wins (a label before the first number counts as a pair when that number stays free for it). Mixed lines
  // ("7.5 kW 10 HP RPM 1460") come out right because each reading falls back to the other side.
  const labelLeads = !!beforeFirstNumber && LAYOUT_LABEL.test(beforeFirstNumber.text) && !ownUnitAfter;
  type Pair = { unit: Tok; target: Tok; how: 'unit' | 'unit-first'; own: boolean };
  // a number right after a label belongs to that label ("cos φ 0,79", "FLA 7.2"): a unit of another field never takes it
  const labelOf = (t: Tok): NameplateField | 'none' | undefined => {
    const before = toks[t.i - 1];
    if (!before || before.num || before.unit) return undefined;
    if (/^(?:φ|phi|cosφ|PF|P\.F\.?|η|Eff\.?|EFF\.?)$/i.test(before.text)) return 'none';
    return LAYOUT_LABEL.test(before.text) ? (LABEL_FIELD.find(([re]) => re.test(before.text))?.[1] ?? 'none') : undefined;
  };
  const assign = (unitFirst: boolean): Pair[] => {
    const taken = new Set(used);
    const out: Pair[] = [];
    for (const t of toks) {
      if (!t.unit) continue;
      const own = t.unit.quantity === 'percent' ? undefined : FIELD_OF[t.unit.quantity];
      const ok = (x: Tok | undefined): x is Tok => {
        if (!x || !x.num || x.glued || taken.has(x.i)) return false;
        const l = labelOf(x);
        return l === undefined || l === own;
      };
      let prev = toks[t.i - 1];
      if (prev && prev.conn && !prev.num) prev = toks[t.i - 2]; // "400 Δ V"
      const next: Tok | undefined = toks[t.i + 1];
      const afterNext = toks[t.i + 2];
      const nextOk = t.unit.quantity !== 'percent' && ok(next) && (unitFirst || !(afterNext && afterNext.unit && afterNext.unit.quantity !== 'percent'));
      let pair: Pair | undefined;
      if (unitFirst && nextOk) pair = { unit: t, target: next, how: 'unit-first', own: true };
      else if (ok(prev)) pair = { unit: t, target: prev, how: 'unit', own: !unitFirst };
      else if (nextOk) pair = { unit: t, target: next, how: 'unit-first', own: unitFirst };
      if (!pair) continue;
      taken.add(pair.target.i);
      out.push(pair);
    }
    return out;
  };
  const byValue = assign(false);
  const byUnit = assign(true);
  // more pairs first (a leading label counts when its number stays free), then more pairs in the reading's own direction
  // ("SEC 2 x 12 V 2 x 4.17 A" reads value-first throughout; unit-first would need a fallback for the A)
  const measured = (ps: Pair[]) => ps.filter((p) => p.unit.unit!.quantity !== 'percent');
  const score = (ps: Pair[]) => 2 * (measured(ps).length + (labelLeads && firstNumber && !ps.some((p) => p.target === firstNumber) ? 1 : 0)) * 100 + measured(ps).filter((p) => p.own).length;
  const sig = (ps: Pair[]) => ps.map((p) => `${p.unit.i}>${p.target.i}`).join(',');
  const sv = score(byValue);
  const su = score(byUnit);
  // a tie with different pairings happens on a damaged line (a number lost at one end: "kW 4 HP", " min-1 50 Hz"):
  // either reading may be the swapped one, so nothing paired across the line is offered (L26); the line's first token
  // picks the reading that is kept below the threshold
  const ambiguous = sv === su && measured(byValue).length > 0 && sig(byValue) !== sig(byUnit);
  const startsWithUnit = !!toks[0] && ((!!toks[0].unit && toks[0].unit.quantity !== 'percent') || (labelLeads && toks[0] === beforeFirstNumber));
  const chosen = su > sv || (ambiguous && startsWithUnit) ? byUnit : byValue;
  for (const { unit: t, target, how } of chosen) {
    used.add(target.i);
    const label = toks[target.i - 1]?.text ?? '';
    // gear output "n2=41 1/min"; "l/min" read for "1/min" counts only after an "n" label (else it may be litres per minute)
    const j = judge(target, t.unit!);
    const notRating = (t.unit!.quantity === 'speed' && GEAR_OUT.test(label)) || (/^[lI]\/min$/.test(t.text) && !/^n$/i.test(label)) || j.notRating;
    const before = ctx.out.length;
    numericCandidates(ctx, target.num!, t.unit!, how, how === 'unit' ? 0.8 : 0.75, connFor(target), `${target.text} ${t.text}`, secondary || notRating, notRating, j.input);
    if (ambiguous) {
      for (const c of ctx.out.slice(before)) {
        c.confidence = Math.min(c.confidence, 0.45);
        c.evidence.push('ambiguous');
      }
    }
  }
  // A number with a Δ/Y mark and no unit is a voltage ("400D/690Y 50Hz", ABB "400 D 50 Hz"): plates print the
  // connection next to the voltage it belongs to
  for (const t of toks) {
    if (!t.num || used.has(t.i) || t.weak) continue;
    const next = toks[t.i + 1];
    const conns = t.conn ?? (next && next.conn && !next.num && next.conn.length === 1 && t.num.parts.length === 1 ? next.conn : undefined);
    if (!conns || conns.length !== t.num.parts.length) continue;
    if (!t.num.parts.every((p) => p.value >= 100 && p.value <= 1000)) continue;
    used.add(t.i);
    const j = judge(t, UNIT_SPELLINGS.V);
    numericCandidates(ctx, t.num, UNIT_SPELLINGS.V, 'label', 0.7, conns, t.text, secondary || j.notRating, j.notRating);
  }
}

// ---------------------------------------------------------------- labelled fields (regex over the normalised line)

const NUM_AFTER = `\\s*[:=]?\\s*(${NUM_CORE}(?:\\s?[/-]\\s?${NUM_CORE})*)`;

type LabelRule = { field: NameplateField; re: RegExp; letter?: RegExp; conf: number; unit: string; factor?: number; quantity?: Quantity };

/** Label → number rules for values printed without a unit (or with one: then they confirm the unit candidate). */
const LABEL_RULES: LabelRule[] = [
  { field: 'voltage', re: new RegExp(`\\b(?:Nennspannung|Bemessungsspannung|Spannung|Rated\\s+voltage|Voltage)\\b${NUM_AFTER}`, 'gi'), letter: new RegExp(`(?:^|\\s)U[nN]?(?=\\s*[:=])${NUM_AFTER}`, 'g'), conf: 0.6, unit: 'V' },
  { field: 'current', re: new RegExp(`\\b(?:Nennstrom|Bemessungsstrom|Strom|Rated\\s+current|Current|F\\.?\\s?L\\.?\\s?A\\.?|FL\\s+AMPS?)\\b${NUM_AFTER}`, 'gi'), letter: new RegExp(`(?:^|\\s)I[nN]?(?=\\s*[:=])${NUM_AFTER}`, 'g'), conf: 0.6, unit: 'A' },
  { field: 'power', re: new RegExp(`\\b(?:Nennleistung|Bemessungsleistung|Leistung|Rated\\s+output|Output|Power)\\b${NUM_AFTER}`, 'gi'), letter: new RegExp(`(?:^|\\s)P[2nN]?(?=\\s*[:=])${NUM_AFTER}`, 'g'), conf: 0.55, unit: 'kW', factor: 1000 },
  { field: 'frequency', re: new RegExp(`\\b(?:Frequenz|Frequency|Freq\\.?)${NUM_AFTER}`, 'gi'), letter: new RegExp(`(?:^|\\s)f(?=\\s*[:=])${NUM_AFTER}`, 'g'), conf: 0.6, unit: 'Hz' },
  { field: 'speed', re: new RegExp(`\\b(?:Drehzahl|Nenndrehzahl|Speed|Rated\\s+speed)\\b${NUM_AFTER}`, 'gi'), letter: new RegExp(`(?:^|\\s)n(?=\\s*[:=])${NUM_AFTER}`, 'g'), conf: 0.6, unit: 'rpm' },
];

function labelCandidates(ctx: Ctx, norm: string, secondary: boolean) {
  for (const rule of LABEL_RULES) {
    const matches = [...norm.matchAll(rule.re), ...(rule.letter ? norm.matchAll(rule.letter) : [])];
    for (const m of matches) {
      const group = numberGroup(m[1].replace(/\s/g, ''));
      if (!group) continue;
      const words = `${textBefore(norm, m.index ?? 0)} ${m[0]}`;
      // a unit right after decides the quantity (unit path made that candidate); here only the label evidence is added
      const after = norm.slice((m.index ?? 0) + m[0].length).trimStart();
      const unitAfter = GLUED_SUFFIXES.find((s) => after.startsWith(s) && !/^[A-Za-z]/.test(after.slice(s.length)));
      // the label's own unit after the value confirms it; another field's unit there starts the next "unit value" pair
      // ("FLA 7.2 VOLTS 460"), so the label alone decides
      if (unitAfter && UNIT_SPELLINGS[unitAfter].quantity !== 'percent' && FIELD_OF[UNIT_SPELLINGS[unitAfter].quantity as Exclude<Quantity, 'percent'>] === rule.field) {
        const nr = notRatingContext(words, rule.field, UNIT_SPELLINGS[unitAfter]);
        numericCandidates(ctx, group, UNIT_SPELLINGS[unitAfter], 'unit', 0.9, undefined, m[0].trim(), secondary || nr, nr, INPUT_POWER.test(words));
        continue;
      }
      const unit = rule.field === 'power' ? UNIT_SPELLINGS.kW : Object.values(UNIT_SPELLINGS).find((u) => u.unit === rule.unit)!;
      // a label without a unit after it: a ratio ("Ia / In = 7,5") or a test value is no rating either
      const nr = notRatingContext(words, rule.field, unit);
      numericCandidates(ctx, group, unit, 'label', rule.conf, undefined, m[0].trim(), secondary || nr, nr, INPUT_POWER.test(words));
    }
  }
}

const COS_LABEL = /(?:\bcos\s*\.?\s*\(?\s*(?:φ|phi|fi|ø|ϕ|q|o(?![0-9])|p(?![a-z.])|@|<p|9(?=\s))?\s*\)?|\bP\.\s?F\.?|\bPF\b|\bpower\s*factor|\bLeistungsfaktor)/gi;

function cosPhiCandidates(ctx: Ctx, norm: string) {
  for (const m of norm.matchAll(COS_LABEL)) {
    const rest = norm.slice((m.index ?? 0) + m[0].length);
    // not "cosφ 1/min" (a header) — a slash right after the number starts a unit
    const v = new RegExp(`^\\s*[:=]?\\s*(${NUM_CORE}(?:\\s?[/-]\\s?${NUM_CORE})*)(?!\\/)\\s*(%?)`).exec(rest);
    const weak = v ? null : /^\s*[:=]?\s*([OoIlSB|]{1,2}[.,][OoIlSB|]{1,3})(?![0-9A-Za-z])()/.exec(rest);
    const hit = v ?? weak;
    if (!hit) continue;
    const weakPart = weak ? parseDecimal(weak[1], true) : null;
    const group = weakPart ? { parts: [weakPart], seps: [], raw: weak![1] } : numberGroup(hit[1].replace(/\s/g, ''));
    if (!group) continue;
    const isPf = /p\.?\s?f|power|leistungs/i.test(m[0]);
    for (const part of group.parts) {
      let value = part.value;
      const evidence: Evidence[] = ['label'];
      let conf = 0.88;
      if (part.repairs.length) {
        evidence.push('ocr-repair');
        conf *= repairFactor(part.repairs.length);
      }
      if (value > 1 && value <= 100 && (isPf || hit[2] === '%')) {
        value /= 100;
        evidence.push('percent-to-ratio');
        conf *= 0.85;
      }
      if (!inRange('cosPhi', value)) {
        evidence.push('implausible');
        conf *= 0.4;
      }
      push(ctx, { field: 'cosPhi', value: round(value), unit: '', base: round(value), match: `${m[0]}${hit[0]}`.trim(), confidence: conf, repairs: part.repairs, evidence });
    }
  }
}

const EFF_LABEL = /(?:\bNEMA\s+NOM(?:INAL)?\.?\s*EFF(?:ICIENCY)?\.?|\bNOM(?:INAL)?\.?\s*EFF(?:ICIENCY)?\.?|\b(?:GUAR(?:ANTEED)?|MIN(?:IMUM)?)\.?\s*EFF(?:ICIENCY)?\.?|η|\beta\b|\b[Ee]ff(?:iciency)?\.?|\bEFF(?:ICIENCY)?\.?|\bWirkungsgrad|\bWirkungsgr\.?|(?<![A-Za-z0-9])[I1l|]E[1-5]\s*-?)/g;

function efficiencyCandidates(ctx: Ctx, norm: string) {
  for (const m of norm.matchAll(EFF_LABEL)) {
    let rest = norm.slice((m.index ?? 0) + m[0].length);
    // "η (100%) 89.6", "η 100 % 89,6": a load marker before the value; "Eff 50% 91.0", "η 3/4 90.1": a part-load value (S7)
    const load = /^\s*[:=]?\s*\(?\s*(25|50|75|100|115|125|[1-5]\/4)\s*%?\s*\)?\s*[:=]?(?=\s*[0-9OoIlSB.,])/.exec(rest);
    const loadPct = load ? (/\//.test(load[1]) ? 25 * Number(load[1][0]) : Number(load[1])) : 100;
    if (load && (/%/.test(load[0]) || /\//.test(load[1]))) rest = rest.slice(load[0].length);
    const partLoad = load !== null && (/%/.test(load[0]) || /\//.test(load[1])) && loadPct !== 100;
    const words = `${textBefore(norm, m.index ?? 0)} ${m[0]}`;
    const v = new RegExp(`^\\s*[:=]?\\s*-?\\s*(${NUM_CORE})\\s*(%?)`).exec(rest);
    if (!v) continue;
    const d = parseDecimal(v[1]);
    if (!d) continue;
    const isIe = /^[I1l|]E/.test(m[0]);
    // "IE3-92.1(100%)": the full-load marker after the value says it is a percentage
    const fullLoadAfter = /^\s*\(\s*[1lI][0Oo]{2}\s*%\s*\)/.test(rest.slice(v.index + v[0].length));
    const percent = v[2] === '%' || fullLoadAfter;
    if (isIe && !percent) continue; // "IE3 400 V" is a class, not an efficiency
    let value = d.value;
    const evidence: Evidence[] = ['label'];
    let conf = isIe ? 0.8 : 0.85;
    if (/^(?:GUAR|MIN)/i.test(m[0].trim()) || notRatingContext(words, 'efficiency')) {
      evidence.push('secondary');
      conf = 0.4; // the guaranteed minimum is not the nominal efficiency
    }
    if (partLoad) {
      evidence.push('part-load');
      conf = Math.min(conf, 0.4);
    }
    if (d.repairs.length) {
      evidence.push('ocr-repair');
      conf *= repairFactor(d.repairs.length);
    }
    if (value > 0 && value <= 1 && !percent) {
      value *= 100;
      evidence.push('ratio-to-percent');
      conf *= 0.85;
    }
    if (!inRange('efficiency', value)) {
      evidence.push('implausible');
      conf *= 0.4;
    }
    push(ctx, { field: 'efficiency', value: round(value), unit: '%', base: round(value), match: `${m[0]}${v[0]}`.trim(), confidence: conf, repairs: d.repairs, evidence });
  }
}

function digitRepair(s: string): { text: string; repairs: string[] } {
  const repairs: string[] = [];
  let text = '';
  for (const ch of s) {
    const r = CONFUSABLE[ch];
    if (r !== undefined && !/[0-9X]/.test(ch)) {
      repairs.push(`${ch}→${r}`);
      text += r;
    } else text += ch;
  }
  return { text, repairs };
}

function classCandidates(ctx: Ctx, norm: string, toks: Tok[]) {
  // IE class: "IE3", OCR "lE3", "1E3"
  for (const m of norm.matchAll(/(?<![A-Za-z0-9])([I1l|])\s?E\s?-?\s?([1-5])(?![0-9])/g)) {
    const repairs = m[1] === 'I' ? [] : [`${m[1]}→I`];
    push(ctx, { field: 'ieClass', value: `IE${m[2]}`, unit: '', match: m[0], confidence: 0.88 * repairFactor(repairs.length), repairs, evidence: ['label', ...(repairs.length ? (['ocr-repair'] as Evidence[]) : [])] });
  }
  // IP code: "IP55", "IP 54", "lP55", "1P55", "IP5S", "IPX4", "IP69K"
  for (const m of norm.matchAll(/(?<![A-Za-z0-9])([I1l|])\s?P\s?-?\s?([0-6XSOoIl])\s?([0-9XSOoIlB])(K|[ABCD]?[HMSW]?)(?![0-9A-Za-z])/g)) {
    if (/P\s+S(?:10|[1-9lI|])$/.test(m[0])) continue; // "IP S1": the duty after a lost IP code, not IP51 ("lP SS" stays IP55)
    const first = digitRepair(m[2]);
    const second = digitRepair(m[3]);
    const repairs = [...(m[1] === 'I' ? [] : [`${m[1]}→I`]), ...first.repairs, ...second.repairs];
    if (!/^[0-6X]$/.test(first.text) || !/^[0-9X]$/.test(second.text)) continue;
    push(ctx, { field: 'ipRating', value: `IP${first.text}${second.text}${m[4]}`, unit: '', match: m[0], confidence: 0.9 * repairFactor(repairs.length), repairs, evidence: ['label', ...(repairs.length ? (['ocr-repair'] as Evidence[]) : [])] });
  }
  // insulation (thermal) class
  const LETTER: Record<string, string> = { '105': 'A', '120': 'E', '130': 'B', '155': 'F', '180': 'H', '200': 'N' };
  const insLabel =
    /(?:\bIsol(?:ations|ier)?(?:stoff)?\.?\s*-?\s*(?:stoff)?\s*-?\s*Kl(?:asse)?\.?|\bIso\.?\s*-?\s*Kl\.?|\bW[äa]rmeklasse|\bTh(?:ermal)?\.?\s*-?\s*Cl(?:ass)?\.?|\bIns(?:ul(?:ation)?)?\.?\s*-?\s*Cl(?:ass)?\.?|\bINSUL(?:ATION)?\.?\s+CLASS|\bKl\.|\bCl\.|\bCLASS(?=\s+[ABEFH]\s+INS))\s*[:.]?\s*(105|120|130|155|180|200|[AEBFHN])(?:\s*\(\s*([AEBFH])\s*\))?(?![A-Za-z0-9])/gi;
  for (const m of norm.matchAll(insLabel)) {
    const letter = (LETTER[m[1]] ?? m[1]).toUpperCase();
    push(ctx, { field: 'insulationClass', value: letter, unit: '', match: m[0], confidence: 0.88, repairs: [], evidence: ['label'] });
  }
  for (const m of norm.matchAll(/(?<![0-9])(130|155|180)\s*\(\s*([BFH])\s*\)/g)) {
    push(ctx, { field: 'insulationClass', value: m[2], unit: '', match: m[0], confidence: 0.75, repairs: [], evidence: ['label'] });
  }
  for (const m of norm.matchAll(/\bINS(?:UL)?\.?\s+CL(?:ASS)?\.?\s*([ABEFH])\b|\bCLASS\s+([ABEFH])\s+INS/gi)) {
    push(ctx, { field: 'insulationClass', value: (m[1] ?? m[2]).toUpperCase(), unit: '', match: m[0], confidence: 0.85, repairs: [], evidence: ['label'] });
  }
  // NEMA short forms: "INS B", "INS. F", "CL F", and mixed case "Ins F" (round 2: brook_crompton_exd_t4)
  for (const m of norm.matchAll(/(?<![A-Za-z])(?:INS|Ins|CL)\.?\s+([ABFH])(?![A-Za-z0-9])/g)) {
    push(ctx, { field: 'insulationClass', value: m[1], unit: '', match: m[0], confidence: 0.75, repairs: [], evidence: ['label'] });
  }
  // the US efficiency class
  // OCR l/1/| for the I ("NEMA PREMlUM", round 2: toshiba_nema_premium_ocr)
  if (/\bNEMA\s*PREM[I1l|]UM\b/i.test(norm)) push(ctx, { field: 'ieClass', value: 'NEMA Premium', unit: '', match: 'NEMA PREMIUM', confidence: 0.75, repairs: [], evidence: ['label'] });
  // duty type S1…S10, "S3 40%", labelled or standalone; "Duty CONT" / "Dauerbetrieb" = S1
  const dutyLabel = /\b(?:Duty|Betriebsart|Betr\.?-?Art|BA|Mode)\b/i.test(norm);
  for (const m of norm.matchAll(/(?<![A-Za-z0-9/.-])S(10|[1-9]|(?:[l|]|I(?!\s+(?:units?|Einheiten)\b))(?![0-9]))(?:\s*-?\s*(\d{1,3})\s*%)?(?![0-9A-Za-z])/g)) {
    const ocr = /^[lI|]$/.test(m[1]);
    const n = ocr ? '1' : m[1];
    const value = m[2] ? `S${n} ${m[2]}%` : `S${n}`;
    const repairs = ocr ? [`${m[1]}→1`] : [];
    const evidence: Evidence[] = [...(dutyLabel ? (['label'] as Evidence[]) : []), ...(ocr ? (['ocr-repair'] as Evidence[]) : [])];
    push(ctx, { field: 'duty', value, unit: '', match: m[0], confidence: (dutyLabel ? 0.9 : 0.8) * repairFactor(repairs.length), repairs, evidence });
  }
  // "continuous" right after a value names that value ("I0 4.3 A (continuous)": the servo's standstill current), not the
  // duty (round 2, lenze_servo_mcs); a duty label before it always counts
  const cont = /(?<![A-Za-z])CONT(?:INUOUS)?\.?(?![A-Za-z])|\bDauerbetrieb\b|\bcontinuous\s+duty\b|\bDuty\s*[:.]?\s*Cont/i.exec(norm);
  const contNamesValue = !!cont && !/\b(?:duty|rating|betriebsart)\s*[:.]?\s*$/i.test(norm.slice(0, cont.index)) && /[0-9]\s?(?:(?:A|mA|V|kV|kW|W|Nm|HP|kVA|VA)\s*\(?|\s*\()\s*$/.test(norm.slice(0, cont.index));
  if (cont && !contNamesValue) {
    push(ctx, { field: 'duty', value: 'S1', unit: '', match: 'continuous', confidence: 0.6, repairs: [], evidence: ['continuous'] });
  }
  // phases
  const ph = /(?<![0-9.,A-Za-z/-])([13])\s?~|~\s?([13])(?![0-9.,A-Za-z])|\b([13])\s?-?\s?(?:Ph(?:ase)?|PH)\b|\bPH(?:ASE)?\.?\s*([13])\b|\b(Drehstrom|Dreiphasen|three[- ]phase)|\b(Wechselstrom|Einphasen|single[- ]phase)/gi;
  for (const m of norm.matchAll(ph)) {
    const n = m[1] ?? m[2] ?? m[3] ?? m[4] ?? (m[5] ? '3' : '1');
    push(ctx, { field: 'phases', value: n, unit: '', match: m[0], confidence: m[5] || m[6] ? 0.75 : 0.85, repairs: [], evidence: ['label'] });
  }
  void toks;
}

/** A further group of a serial number: 2–3 digits ("E0907/1234567 01 001", "7 384 552"), never a year or a value with a unit. */
// round 2: also 4 characters, look-alikes and one leading letter ("SER. NO. Y11 4572 R290", "Nr. 22O8 4l7S"), at least
// two real digits; never a year ("2018", "2O2O"), a code (IP55, IE3, S1) or a value with a unit ("32 kg", "50 Hz")
const SERIAL_MORE = `(?:\\s(?!(?:19|2[0O])[0-9OoIl]{2}(?![0-9A-Za-z]))(?!IP|IE|S[0-9lI](?![0-9]))(?=[A-Z]?[0-9OoIlSB]{0,3}[0-9][0-9OoIlSB]{0,3}[0-9])[A-Z]?[0-9OoIlSB]{2,4}(?![0-9A-Za-z/.,])(?!\\s?(?:V|A|kW|W|Hz|kVA|VA|%|kg|KG|lbs?|LBS?|°|C|K|Nm|mm|m|rpm|RPM|min)(?![A-Za-z])))`;
const SERIAL_LABEL = new RegExp(
  `(?:\\bS\\/N|\\bSN\\b|\\bSer(?:ial)?\\.?\\s*-?\\s*(?:No|Nr|Number)\\.?|\\bSerial\\b|\\bSeriennummer|\\bSerien-?Nr\\.?|\\bFabr(?:ik)?\\.?\\s*-?\\s*Nr\\.?|\\bFab\\.?\\s*-?\\s*Nr\\.?|\\bWerk-?\\s*Nr\\.?|\\bHerst\\.?\\s*-?\\s*Nr\\.?|\\bID\\s*-?\\s*Nr\\.?|\\bSER\\.?(?=\\s)|(?<![A-Za-z.-])(?:No|Nr|N°)\\.?(?=[\\s:#]|[0-9OoIl]))` +
    `\\s*[:#.]?\\s*([0-9]{1,3}(?:\\s[0-9]{3})+\\b|[A-Za-z0-9][A-Za-z0-9./-]{2,}${SERIAL_MORE}?${SERIAL_MORE}?)`,
  'gi'
);
/** Words that make a following bare "No."/"Nr." something other than the serial number. */
const NOT_SERIAL_BEFORE = /\b(?:Order|Part|Cat(?:alog)?|Kat(?:alog)?|Model(?:l)?|Mod|Type|Typ|Art(?:ikel)?|Teile|Pole|Polzahl|Bestell|Ref|Item|Drawing|Zeichnungs?|Schaltbild|Stock|Code|Ident|Material|Mat)\.?\s*-?\s*$/i;
/** Explicit type labels; "3~ Motor <designation>" only when no explicit label is on the line. */
const TYPE_LABEL = /(?:\bMot(?:or)?\.?\s*-?\s*Typ(?:e)?\b|\b(?:Type|Typ|Model(?:l)?)\b(?:\s*-?\s*(?:No|Nr|Number)\b\.?)?|\bMod\b\.?|\bBestell-?\s*Nr\.?|\bOrder\s*(?:No|Code)\.?|\bCat(?:alog)?\.?\s*No\.?|\bMLFB|\bArt\.?\s*-?\s*Nr\.?)\s*[:.]?\s*(?=\S)/gi;
const MOTOR_TYPE_LABEL = /(?<=(?:[13]\s?~|~\s?[13]?)\s?)Mot(?:or)?\b\.?\s*[:.]?\s*(?=\S)/i;
/** Words that end a type designation: the next field's label. */
const TYPE_STOP = /^(?:S\/N|SN|Ser|Serial|Nr\.?|No\.?|N°|IP\d|IE\d|IM(?:[BV]\d+)?$|IC\d*$|Isol|Th\.|Ins|cos|η|Eff|kg|Bj|Year|Baujahr|Jahr|Datum|Date|SPEC\.?|CAT\.?|FRAME|FR|CODE|DES\.?|HP|VOLTS?|AMPS?|RPM|Typ|Type|Made|Fabr|Part$|P\/N$|Art\.|Art-|Artikel|BRAKE|Brems|[13]~|~[13]?$|P\.c\.?$|Model(?:l)?$|Mod\.?$)/i;

/**
 * S5: an identifier is shown as printed (there is no grammar to repair it by), so the screen must say "check against the
 * plate" when it holds a letter OCR confuses with a digit next to digits (O/0, I/l/|/1, S/5, B/8, Z/2) — e.g. "LLE1OO2".
 */
function lookAlike(value: string): Evidence[] {
  return /[0-9]/.test(value) && /(?:[0-9][OoIl|SBZ]|[OoIl|SBZ][0-9])/.test(value) ? ['look-alike'] : [];
}

/** Serial number and type designation: text after a label, kept as printed (no OCR repair: there is no grammar to repair by). */
function identifierCandidates(ctx: Ctx, norm: string): Set<string> {
  const consumed = new Set<string>();
  for (const m of norm.matchAll(SERIAL_LABEL)) {
    const value = stripJunk(m[1].replace(/[.,;:]+$/, ''));
    if (!/[0-9]/.test(value)) continue;
    const strong = !/^(?:No|Nr|N°|SER)/i.test(m[0].trim());
    // a bare "No."/"Nr." after Order/Part/Cat/Model/Art/Teile/Pole … numbers something else (S4); after a bare label a
    // code (IP54, IE3, S1), a year or a date is the next field, not the serial number
    if (!strong && NOT_SERIAL_BEFORE.test(norm.slice(0, m.index ?? 0))) continue;
    if (/^(?:IP|IE)[0-9X]|^S(?:10|[1-9])$/i.test(value) || (!strong && (/^(?:19|20)[0-9]{2}$/.test(value) || /^[0-9]{1,2}[A-Z]{3}[0-9]{2,4}$/i.test(value)))) continue;
    push(ctx, { field: 'serial', value, unit: '', match: m[0], confidence: strong ? 0.8 : 0.6, repairs: [], evidence: ['label', ...lookAlike(value)] });
    consumed.add(m[0]);
  }
  // every label on the line in order (round 2: "DRY TYPE TRANSFORMER CAT.NO. NMK045KB" — a skipped description no longer
  // hides a later label); the value is the text after the label up to the next field
  const heads = [...norm.matchAll(TYPE_LABEL)];
  const motorHead = heads.length === 0 ? MOTOR_TYPE_LABEL.exec(norm) : null;
  const labels = (motorHead ? [motorHead] : heads).map((h) => ({ index: h.index ?? 0, head: h[0], rest: norm.slice((h.index ?? 0) + h[0].length) }));
  for (const t of labels) {
    // "Cooling type IC 411", "Duty type S1", "Enclosure type …": the word before "type" says it names something else
    const before = norm.slice(0, t.index);
    if (/\b(?:cooling|kühl(?:ungs)?(?:art)?|duty|enclosure|mounting|connection|protection|insulation|bearing|lager|bau)\s*-?\s*$/i.test(before)) continue;
    const words: string[] = [];
    const all = t.rest.split(' ');
    for (let k = 0; k < all.length; k++) {
      const w = all[k];
      // stop at the next field: a unit, a value with a unit, a bare number followed by its unit ("Mot. 400 V"), a label
      // of another field; a word of junk alone (". .. :", rivets) ends it too (round 2)
      if (UNIT_SPELLINGS[w] || TYPE_STOP.test(stripJunk(w)) || numberWithUnit(w) || (numberGroup(stripJunk(w)) !== null && UNIT_SPELLINGS[all[k + 1] ?? ''] !== undefined) || (w !== '' && !/[A-Za-z0-9]/.test(w))) break;
      words.push(w);
      if (words.length === 4) break;
    }
    const value = stripJunk(words.join(' ').replace(/[.,;:]+$/, ''));
    // "DRY TYPE TRANSFORMER": a plain word after "type" is a description, not a designation; "Type of duty S1" names a field
    // round 2: "3~ MOT. ASYNCHRONE" (Leroy-Somer) describes the machine too
    if (!/[A-Za-z0-9]/.test(value) || /^[13]~$/.test(value) || /^(?:TRANSFORMERS?|TRANSFORMATOR(?:EN)?|MOTORS?|ASYNCHRON(?:E|OUS|MOTOR)?|ASYNC|ASINCRONO|INDUCTION|SYNCHRON(?:E|OUS)?|SERVO|BRUSHLESS|GENERATORS?|PUMPS?|FANS?|DRIVES?|PLATE|SCHILD|of|de|der|des)$/i.test(stripJunk(words[0]))) continue;
    const order = /Bestell|Order|Cat|MLFB|Art/i.test(t.head);
    // round 2: "Model: 98303542" (Grundfos) is a product number when a plain number; the type is on the "Type" line
    const productNumber = /^Mod/i.test(t.head) && /^[0-9]{5,}$/.test(words[0]);
    push(ctx, { field: 'type', value, unit: '', match: `${t.head}${value}`, confidence: productNumber ? 0.45 : order ? 0.55 : 0.75, repairs: [], evidence: ['label', ...lookAlike(value)] });
    consumed.add(value);
    break;
  }
  return consumed;
}

function numberWithUnit(w: string): boolean {
  const toks = tokenize(w);
  return toks.length === 1 && !!toks[0].glued;
}

// ---------------------------------------------------------------- unit-header tables

type Column = { field: NameplateField | 'skip'; unit?: UnitDef };

function headerColumns(norm: string): Column[] | null {
  const words = norm
    .replace(/cos\s*\.?\s*φ|cos\s*phi|cosφ/gi, 'cosφ')
    .split(' ')
    .map((w) => (w === '%' ? w : stripJunk(w)));
  const cols: Column[] = [];
  let known = 0;
  let numbers = 0;
  for (const w of words) {
    const unit = UNIT_SPELLINGS[w] ?? UNIT_SPELLINGS[w.replace(/[[\]()]/g, '')];
    if (unit && unit.quantity !== 'percent') {
      cols.push({ field: FIELD_OF[unit.quantity], unit });
      known++;
    } else if (/^cosφ$|^PF$|^p\.f\.$/i.test(w)) {
      cols.push({ field: 'cosPhi' });
      known++;
    } else if (/^(?:η|Eff\.?%?|EFF\.?%?|η%|IE[1-5]-?%|%)$/.test(w)) {
      if (w === '%' && cols[cols.length - 1]?.field === 'efficiency') continue; // "η %" is one column
      cols.push({ field: 'efficiency' });
      known++;
    } else if (/^[0-9]/.test(w)) numbers++;
    else if (w !== '' && w !== '|') cols.push({ field: 'skip' });
  }
  return known >= 3 && numbers === 0 && cols.length <= 10 ? cols : null;
}

/**
 * Cells that cannot belong to their column (M2): a row that lost a cell shifts every later cell one column left, so a
 * speed lands under "kW" and a cos φ under "A". Physics the columns must satisfy: cos φ ≤ 1, a motor speed ≥ 100 rpm,
 * a voltage ≥ 24 V, a frequency ≤ 1000 Hz, an efficiency 40–99.99 %, and I ≈ P / (√3 · U · cos φ · η) within a wide band.
 */
function rowConsistent(cols: Column[], nums: Tok[]): boolean {
  const at: Partial<Record<NameplateField, number>> = {};
  for (let k = 0; k < nums.length; k++) {
    const col = cols[k];
    if (col.field === 'skip') continue;
    const v = nums[k].num!.parts[0].value * (col.unit?.factor ?? 1);
    if (col.field === 'cosPhi' && (v > 1 || v < 0.05)) return false;
    if (col.field === 'speed' && v < 100) return false;
    if (col.field === 'voltage' && v < 24) return false;
    if (col.field === 'frequency' && v > 1000) return false;
    if (col.field === 'efficiency' && !((v >= 40 && v <= 99.99) || (v >= 0.4 && v <= 1))) return false;
    if (col.field === 'power' && col.unit?.unit === 'HP') continue;
    at[col.field] = v;
  }
  if (at.voltage && at.current && at.power) {
    // three-phase: I·√3·U / P = 1 / (cos φ · η) lies between ~1.05 (large motors) and ~4 (small ones); a shifted cell is off by far more
    const r = (at.current * Math.sqrt(3) * at.voltage) / at.power;
    if (r < 0.7 || r > 6) return false;
  }
  return true;
}

function tableCandidates(ctx: Ctx, cols: Column[], toks: Tok[], wrappedCell = false, nextIsCell = false): 'full' | 'short' | false {
  const cells = toks.filter((t) => t.num || (t.conn && !t.num));
  const nums = cells.filter((t) => t.num && t.num.parts.length === 1 && !t.glued);
  if (!wrappedCell && (nums.length < 3 || nums.length > cols.length || nums.length < cols.length - 1)) return false;
  if (toks.some((t) => t.unit || t.glued)) return false;
  const markers = cells.filter((t) => t.conn && !t.num);
  // M2: a row one cell short is read left to right only when the next line is its wrapped last cell; otherwise a lost
  // first or middle cell would shift every later value into the wrong column — and a row that breaks the columns'
  // physics is not trusted either. Such rows keep their candidates below the offer threshold.
  const short = !wrappedCell && nums.length < cols.length;
  const doubtful = (short && !nextIsCell) || (!wrappedCell && !rowConsistent(cols, nums));
  const cap = (conf: number) => (doubtful ? Math.min(conf, 0.45) : conf);
  nums.forEach((t, k) => {
    const column = cols[k];
    const col = column.field;
    if (col === 'skip') return;
    const part = t.num!.parts[0];
    let conn = t.conn?.[0];
    if (!conn && (col === 'voltage' || col === 'current')) {
      const m = markers.find((x) => x.i === t.i + 1 || x.i === t.i - 1);
      conn = m?.conn?.length === 1 ? m.conn[0] : undefined;
      if (!conn && markers.length === 1 && markers[0].conn?.length === 1) conn = markers[0].conn[0];
    }
    if (column.unit) {
      numericCandidates(ctx, { parts: [part], seps: [], raw: t.text }, column.unit, 'table', cap(0.85), conn ? [conn] : undefined, t.text, false);
      return;
    }
    let value = part.value;
    const evidence: Evidence[] = ['table'];
    let conf = cap(0.85) * repairFactor(part.repairs.length);
    if (part.repairs.length) evidence.push('ocr-repair');
    if (col === 'efficiency' && value > 0 && value <= 1) {
      value *= 100;
      evidence.push('ratio-to-percent');
    }
    if (!inRange(col, value)) {
      evidence.push('implausible');
      conf *= 0.4;
    }
    push(ctx, { field: col, value: round(value), unit: col === 'efficiency' ? '%' : '', base: round(value), match: t.text, confidence: conf, repairs: part.repairs, evidence });
  });
  return short && !doubtful ? 'short' : 'full';
}

// ---------------------------------------------------------------- Δ/Y columns ("Δ Y" / "400 690 V" / "21,4 12,4 A")

/** A line of single Δ/Y marks only ("Δ Y", "D Y"): the next lines may be value columns under them. */
function markerRow(toks: readonly Tok[]): Connection[] | null {
  return toks.length >= 2 && toks.every((t) => !t.num && t.conn?.length === 1) ? toks.map((t) => t.conn![0]) : null;
}

/**
 * Round 2 (celma_delta_star_own_line_de, koncar_split_lines_ocr): under a marker line, a row of one bare number per mark
 * and ONE voltage or current unit at its end ("400 690 V", "8,2 4,7 A" after the wrapped unit was joined back) gives
 * each number that unit and its column's connection. Physics decides whether the row is trusted: a Y voltage is √3
 * times the Δ one, a Δ current √3 times the Y one (1.6–1.85); otherwise the values stay below the offer threshold.
 * Returns false when the line is no such row.
 */
function markerColumnCandidates(ctx: Ctx, conns: readonly Connection[], toks: readonly Tok[]): boolean {
  // "380-420 V 660-725 V" (Lenze): one number group with its own unit per column is the same layout
  const paired = toks.length === 2 * conns.length && toks.every((t, k) => (k % 2 === 0 ? !!t.num && !t.glued && !t.conn && !t.weak : t.unit?.unit === toks[1].unit?.unit));
  const unitTok = paired ? toks[1] : toks[toks.length - 1];
  const nums = paired ? toks.filter((_, k) => k % 2 === 0) : toks.slice(0, -1);
  const unit = unitTok?.unit;
  if (!unit || (unit.quantity !== 'voltage' && unit.quantity !== 'current')) return false;
  if (nums.length !== conns.length || !nums.every((t) => t.num && !t.glued && !t.conn && !t.weak && (paired || t.num.parts.length === 1))) return false;
  const base = (k: number) => nums[k].num!.parts[0].value * unit.factor;
  const d = conns.indexOf('delta');
  const y = conns.indexOf('star');
  const ratio = d >= 0 && y >= 0 ? (unit.quantity === 'voltage' ? base(y) / base(d) : base(d) / base(y)) : NaN;
  const trusted = ratio > 1.6 && ratio < 1.85;
  nums.forEach((t, k) => {
    const before = ctx.out.length;
    numericCandidates(ctx, t.num!, unit, 'table', 0.8, t.num!.parts.map(() => conns[k]), `${t.text} ${unitTok.text}`, false);
    if (!trusted) for (const c of ctx.out.slice(before)) c.confidence = Math.min(c.confidence, 0.45);
  });
  return true;
}

// ---------------------------------------------------------------- merge and rank

function key(c: Candidate): string {
  return `${c.field}|${typeof c.value === 'number' ? (c.base ?? c.value) : String(c.value).toUpperCase()}|${c.connection ?? ''}`;
}

/** Same field and value from several places → one candidate (highest confidence, a small boost, the evidence united). */
function merge(all: Candidate[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const c of all) {
    const k = key(c);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...c, evidence: [...c.evidence] });
      continue;
    }
    const best = c.confidence > prev.confidence ? { ...c, evidence: [...c.evidence] } : prev;
    // two "not the rating" readings of the same value never add up to an offer (M3: a gear plate's n2 printed twice)
    const weak = (x: Candidate) => x.evidence.some((e) => e === 'secondary' || e === 'part-load' || e === 'implausible');
    const boost = prev.line === c.line && prev.match === c.match ? 0 : weak(prev) || weak(c) ? 0 : 0.05;
    for (const e of [...prev.evidence, ...c.evidence]) if (!best.evidence.includes(e)) best.evidence.push(e);
    if (!best.evidence.includes('agree')) best.evidence.push('agree');
    best.confidence = Math.min(0.99, Math.max(prev.confidence, c.confidence) + boost);
    byKey.set(k, best);
  }
  // a value with a connection and the same value without one: keep the one that says more
  const list = [...byKey.values()];
  return list.filter((c) => c.connection !== undefined || !list.some((o) => o !== c && o.field === c.field && o.connection !== undefined && o.base === c.base && o.confidence >= c.confidence - 0.1));
}

// ---------------------------------------------------------------- entry point

/** Parses OCR text (one string with line breaks, or the lines). Never throws; unknown text gives no candidates. */
type Logical = { index: number; raw: string; norm: string };

/**
 * Lines as the parser reads them: normalised, and repaired where the OCR broke a value from its unit or label across
 * lines — a lone unit or label followed by a lone number ("V" / "400/690": column-wise reading), and a line ending in a
 * bare number followed by a line starting with a unit ("4,6/2,65" / "A 1,1": the unit wrapped to the next line).
 */
function logicalLines(lines: readonly string[]): Logical[] {
  const out: Logical[] = lines.map((raw, index) => ({ index, raw, norm: maskCalendarWeek(joinHpFractions(splitGluedLabels(normalizeLine(raw)))) })).filter((l) => l.norm !== '');
  const lone = (n: string) => UNIT_SPELLINGS[n] !== undefined || /^(?:cos\s*\.?\s*φ|cos\s*phi|PF|η|Eff\.?)$/i.test(n);
  const loneNumber = (n: string) => {
    const t = tokenize(n);
    return t.length === 1 && !!t[0].num && !t[0].glued;
  };
  for (let k = 0; k + 1 < out.length; k++) {
    const a = out[k];
    const b = out[k + 1];
    if (lone(a.norm) && loneNumber(b.norm)) {
      b.norm = `${a.norm} ${b.norm}`;
      a.norm = '';
      continue;
    }
    const ta = tokenize(a.norm);
    const tb = tokenize(b.norm);
    const last = ta[ta.length - 1];
    const before = ta[ta.length - 2];
    const first = tb[0];
    // only a line of bare numbers (and Δ/Y marks) can have lost its unit to the next line
    const bare = ta.length > 0 && ta.every((t) => (t.num && !t.glued) || (t.conn && !t.num));
    const dangling = bare && !!last?.num && !last.weak && !(before && (LAYOUT_LABEL.test(before.text) || (before.conn && !before.num)));
    if (dangling && first?.unit && first.unit.quantity !== 'percent' && tb.length > 1 && headerColumns(a.norm) === null && headerColumns(b.norm) === null) {
      a.norm = `${a.norm} ${first.text}`;
      b.norm = b.norm.replace(/^\S+\s*/, '').trim();
    }
  }
  return out.filter((l) => l.norm !== '');
}

/** Parses OCR text (one string with line breaks, or the lines). Never throws; unknown text gives no candidates. */
export function parseNameplate(input: string | readonly string[]): NameplateReading {
  const lines = (typeof input === 'string' ? input.split(/\r?\n/) : [...input]).map((l) => String(l));
  const all: Candidate[] = [];
  let header: Column[] | null = null;
  let headerAge = 0;
  let shortRow = false; // the last table row lacked its last cell (OCR wrapped it onto the next line)
  let columnMarks: Connection[] | null = null; // a "Δ Y" line: the value columns under it (markerColumnCandidates)
  let columnAge = 0;
  const logical = logicalLines(lines);
  const drive = driveOnPlate(logical.map((l) => l.norm));
  for (let li = 0; li < logical.length; li++) {
    const { index, raw, norm } = logical[li];
    const ctx: Ctx = { line: index, source: raw, out: all, drive };
    const cols = headerColumns(norm);
    if (cols) {
      header = cols;
      headerAge = 0;
      shortRow = false;
      classCandidates(ctx, norm, []);
      continue;
    }
    const toks = tokenize(norm);
    const marks = markerRow(toks);
    if (marks) {
      columnMarks = marks;
      columnAge = 0;
      continue;
    }
    if (columnMarks && columnAge < 3 && markerColumnCandidates(ctx, columnMarks, toks)) {
      columnAge++;
      continue;
    }
    columnMarks = null;
    if (header && headerAge < 8) {
      if (shortRow && toks.length === 1 && toks[0].num && toks[0].num.parts.length === 1) {
        // the wrapped last cell of the previous row
        tableCandidates(ctx, header.slice(header.length - 1), toks, true);
        shortRow = false;
        headerAge++;
        continue;
      }
      const nextToks = li + 1 < logical.length ? tokenize(logical[li + 1].norm) : [];
      const nextIsCell = nextToks.length === 1 && !!nextToks[0].num && nextToks[0].num.parts.length === 1 && !nextToks[0].glued;
      const row = tableCandidates(ctx, header, toks, false, nextIsCell);
      if (row) {
        shortRow = row === 'short';
        headerAge++;
        classCandidates(ctx, norm, toks);
        continue;
      }
    }
    if (header) headerAge++;
    shortRow = false;
    const consumed = identifierCandidates(ctx, norm);
    // numbers inside a serial number or type designation are not ratings
    let rest = norm;
    for (const c of consumed) rest = rest.replace(c, ' ');
    rest = unglueLine(normalizeLine(rest));
    const restToks = tokenize(rest);
    const plain = norm.replace(/[_*»«]/g, ' '); // "_Kond." is still a capacitor line (\b does not split "_K")
    const secondary = SECONDARY_LINE.test(plain) || SECONDARY_CASED.test(plain);
    const used = new Set<number>();
    attachUnits(ctx, restToks, used, secondary);
    labelCandidates(ctx, rest, secondary);
    cosPhiCandidates(ctx, rest);
    efficiencyCandidates(ctx, rest);
    classCandidates(ctx, rest, restToks);
  }
  const merged = merge(all);
  const candidates = Object.fromEntries(NAMEPLATE_FIELDS.map((f) => [f, [] as Candidate[]])) as unknown as Record<NameplateField, Candidate[]>;
  for (const c of merged) candidates[c.field].push(c);
  for (const f of NAMEPLATE_FIELDS) candidates[f].sort((a, b) => b.confidence - a.confidence || a.line - b.line);
  return { lines, candidates };
}

/** What the screen offers for a field: confident candidates, best first. The user still taps one (L26). */
export function offered(reading: NameplateReading, field: NameplateField, threshold = OFFER_THRESHOLD): Candidate[] {
  return reading.candidates[field].filter((c) => c.confidence >= threshold);
}
