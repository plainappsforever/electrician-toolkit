// Loads nameplate fixture files for the scorer (Jest and scripts/nameplate-bench.mjs). PURE: the caller passes the file
// functions, so this runs in Jest and in plain Node alike.
//  - own set: a JSON file holding `{ plates: Plate[] }`, a `Plate[]` or one `Plate`;
//  - blind sets (test/fixtures/nameplates/blind, blind-2, blind-3; FORMAT.md there): `<stem>.txt` + `<stem>.expected.json` with ITS OWN keys,
//    mapped here onto the parser's fields. The mapping was written after the parser was frozen and before scoring; what it
//    merges or leaves out is listed in BLIND_MAPPING and in docs/V15_LOG.md.
import type { NameplateField } from './nameplate';
import type { Plate, TruthValue } from './nameplate-score';

export function platesFromJson(json: unknown): Plate[] {
  const list = Array.isArray(json) ? json : typeof json === 'object' && json !== null && Array.isArray((json as { plates?: unknown }).plates) ? (json as { plates: unknown[] }).plates : [json];
  return list.filter((p): p is Plate => typeof p === 'object' && p !== null && Array.isArray((p as Plate).lines) && typeof (p as Plate).truth === 'object');
}

/** Blind keys → parser field. Not mapped (the parser has no such field): manufacturer, weightKg, year, serviceFactor, frame, codeLetter, nemaDesign, enclosure, ambientC, gearRatio, brakeVoltage, capacitorUf, flowM3h, headM, vectorGroup, ukPct, cooling, outputSpeedRpm, serviceFactorCurrent, efficiencyLoadPct. */
export const BLIND_MAPPING: Record<NameplateField, readonly string[]> = {
  // the parser has one "power" field: output P2, input P1 (fans, circulators), HP and transformer kVA all land there
  power: ['ratedPowerKw', 'ratedPowerHp', 'inputPowerKw', 'ratedPowerKva'],
  voltage: ['voltage', 'primaryVoltage', 'secondaryVoltage'],
  current: ['current', 'primaryCurrent', 'secondaryCurrent'],
  frequency: ['frequencyHz'],
  cosPhi: ['cosPhi'],
  speed: ['speedRpm'],
  efficiency: ['efficiencyPct'], // full-load entries only (efficiencyLoadPct 100, or all when no load points are printed)
  ieClass: ['efficiencyClass'],
  ipRating: ['ipRating'],
  insulationClass: ['insulationClass'],
  duty: ['duty'], // "CONT" = S1 (the parser offers continuous duty as S1)
  phases: ['phases'],
  serial: ['serial'],
  type: ['type'],
};

type BlindField = { value: number | string | (number | string)[]; unit?: string; line?: number | number[] };
type BlindExpected = { fixture?: string; kind?: string; lang?: string; fields: Record<string, BlindField>; absent?: string[] };

const asList = <T,>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const UNIT_FOR_POWER: Record<string, string> = { ratedPowerKw: 'kW', ratedPowerHp: 'HP', inputPowerKw: 'kW', ratedPowerKva: 'kVA' };

export function plateFromBlind(stem: string, text: string, expected: BlindExpected): Plate & { absentFields: NameplateField[] } {
  const lines = text.replace(/\n$/, '').split('\n');
  const truth: Partial<Record<NameplateField, TruthValue[]>> = {};
  const absentFields: NameplateField[] = [];
  const f = expected.fields;
  for (const [field, keys] of Object.entries(BLIND_MAPPING) as [NameplateField, readonly string[]][]) {
    const out: TruthValue[] = [];
    for (const key of keys) {
      const entry = f[key];
      if (!entry) continue;
      const values = asList(entry.value);
      const lineList = asList(entry.line);
      let pick = values.map((_, i) => i);
      if (key === 'efficiencyPct' && f.efficiencyLoadPct) {
        const loads = asList(f.efficiencyLoadPct.value);
        pick = pick.filter((i) => loads[i] === 100);
      } else if (key === 'efficiencyPct' && values.length > 1) {
        // blind-3 README: load points printed "4/4 3/4 2/4" list the values without efficiencyLoadPct (check.py wants a
        // literal 100/75/50) — the markers on the cited lines, in reading order, say which value is full load (4/4)
        const cited = [...new Set(lineList)].filter((l): l is number => typeof l === 'number').map((l) => lines[l] ?? '');
        const marks = cited.flatMap((l) => [...l.matchAll(/(?<![0-9/])([1-4])\/4(?![0-9])/g)].map((m) => m[1]));
        if (marks.length === values.length) pick = pick.filter((i) => marks[i] === '4');
      }
      for (const i of pick) {
        let value = values[i];
        if (field === 'duty' && typeof value === 'string' && /^CONT/i.test(value)) value = 'S1';
        const line = lineList[i] ?? lineList[0];
        const unit = field === 'power' ? (entry.unit === 'W' ? 'W' : entry.unit === 'VA' ? 'VA' : entry.unit === 'hp' ? 'HP' : UNIT_FOR_POWER[key]) : field === 'voltage' && entry.unit === 'kV' ? 'kV' : undefined;
        out.push(typeof value === 'number' && (unit || line !== undefined) ? { value, unit, line } : typeof value === 'string' ? { value: field === 'phases' ? value : value, line } : { value: field === 'phases' ? String(value) : value, line });
      }
    }
    if (field === 'phases') for (let i = 0; i < out.length; i++) out[i] = typeof out[i] === 'object' ? { ...(out[i] as object), value: String((out[i] as { value: unknown }).value) } : String(out[i]);
    if (out.length > 0) truth[field] = out;
    else if (keys.some((k) => expected.absent?.includes(k))) absentFields.push(field);
  }
  // Δ/Y per value where the plate's groups line up with the voltages (one string per voltage, or "Δ/Y" for a pair).
  // Blind set 2's README (conventions within FORMAT.md, mapped here BEFORE that set was scored): Δ and Y on separate rows
  // give an array with one mark per ROW — a row may hold a voltage range, so marks are matched to voltages by line; one
  // printed group "Δ/Y" over a range pair ("380-420/660-725 V") gives the scalar: first half Δ, second half Y.
  const conn = f.connection ? asList(f.connection.value).map(String) : [];
  const connLines = f.connection ? asList(f.connection.line) : [];
  const volts = truth.voltage;
  if (volts && f.voltage) {
    const sym = (s: string) => (s === 'Δ' ? 'delta' : s === 'Y' ? 'star' : undefined);
    const voltLines = volts.map((v) => (typeof v === 'object' ? v.line : undefined));
    const byLine = conn.length > 1 && connLines.length === conn.length && voltLines.every((l) => l !== undefined && connLines.includes(l));
    // the marks of a row share that row's voltages in reading order ("220-242Δ/380-420Y" = two marks, two voltages each);
    // a "Δ/Y" mark counts as two marks Δ, Y; a row whose voltages do not split evenly gets no connection
    const onRow = (i: number) => {
      const line = voltLines[i];
      const marks = conn.filter((_, j) => connLines[j] === line).flatMap((m) => (m === 'Δ/Y' ? ['Δ', 'Y'] : [m]));
      const row = voltLines.map((l, k) => (l === line ? k : -1)).filter((k) => k >= 0);
      if (marks.length === 0 || row.length % marks.length !== 0) return undefined;
      return sym(marks[Math.floor(row.indexOf(i) / (row.length / marks.length))]);
    };
    const perValue = byLine
      ? voltLines.map((_, i) => onRow(i))
      : conn.length === volts.length
        ? conn.map(sym)
        : conn.length === 1 && conn[0] === 'Δ/Y' && volts.length % 2 === 0
          ? volts.map((_, i) => (i < volts.length / 2 ? 'delta' : 'star'))
          : conn.length === 1 && volts.length === 1
            ? [sym(conn[0])]
            : [];
    volts.forEach((v, i) => {
      const c = perValue[i];
      if (c && typeof v === 'object') (v as { connection?: string }).connection = c;
    });
  }
  return { id: expected.fixture ?? stem, lang: expected.lang, kind: expected.kind, lines, truth, absentFields };
}

export function loadPlates(dir: string, read: (file: string) => string, list: (dir: string) => string[], join: (a: string, b: string) => string): Plate[] {
  const files = list(dir).sort();
  const blind = files.filter((f) => f.endsWith('.expected.json'));
  if (blind.length > 0) {
    return blind.map((f) => {
      const stem = f.slice(0, -'.expected.json'.length);
      return plateFromBlind(stem, read(join(dir, `${stem}.txt`)), JSON.parse(read(join(dir, f))) as BlindExpected);
    });
  }
  return files.filter((f) => f.endsWith('.json')).flatMap((f) => platesFromJson(JSON.parse(read(join(dir, f)))));
}
