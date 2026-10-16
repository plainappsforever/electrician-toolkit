// Scores the nameplate parser against fixtures with ground truth (own set and the blind set; docs/V15_LOG.md). PURE and
// dependency-free: Jest (`nameplate-fixtures.test.ts`) and `scripts/nameplate-bench.mjs` share it.
//
// Per field, per plate where the truth names the field:
//  - exact: the OFFERED values (confidence >= OFFER_THRESHOLD, distinct) are exactly the true values — what the user sees
//    is complete and holds nothing wrong;
//  - top1: the best OFFERED candidate is one of the true values (a single tap would be right);
//  - recall: share of the true values that are offered.
// Fields the truth does not name: anything offered is a false positive. Connections (Δ/Y) are scored apart, on true
// values that state one (right = offered with it, and no offered twin says the other one).
// Text (serial, type, classes) is compared two ways (REVIEW_V15_PA S5): EXACT TEXT — upper case, whitespace and -_.:·
// removed, nothing else — is the headline, because that is what the user sees; the FOLDED figure also folds the OCR
// look-alikes (O→0, I/L→1, S→5, B→8, RN→M, VV→W) as the blind set's FORMAT.md suggests, and is reported next to it.
import { NAMEPLATE_FIELDS, offered, parseNameplate, type Candidate, type Connection, type NameplateField } from './nameplate';

export type TruthValue = number | string | { value: number | string; unit?: string; connection?: Connection; line?: number };
/** `absentFields`: fields the truth says are NOT on the plate (blind set); every other field without truth counts too. */
export type Plate = { id: string; lang?: string; kind?: string; layout?: string; lines: string[]; truth: Partial<Record<NameplateField, TruthValue[]>>; absentFields?: NameplateField[] };

const POWER_FACTOR: Record<string, number> = { W: 1, kW: 1000, HP: 745.7, PS: 735.49875, VA: 1, kVA: 1000, MVA: 1e6 };

type Norm = { key: string; connection?: Connection; line?: number };

/** A truth entry in the parser's terms: numbers in the base unit (power: W or VA, kV → V), text upper case without spaces. */
type TextFn = (s: string) => string;

function normTruth(field: NameplateField, t: TruthValue, text: TextFn): Norm {
  const o = typeof t === 'object' ? t : { value: t };
  if (typeof o.value === 'number') {
    let base = o.value;
    let suffix = '';
    if (field === 'power') {
      const unit = o.unit ?? 'kW';
      base = o.value * (POWER_FACTOR[unit] ?? 1);
      suffix = /VA$/.test(unit) ? 'VA' : 'W';
    } else if (field === 'voltage' && o.unit === 'kV') base = o.value * 1000;
    else if (field === 'current' && o.unit === 'mA') base = o.value / 1000;
    return { key: `${num(base)}${suffix}`, connection: o.connection, line: o.line };
  }
  return { key: text(String(o.value)), line: o.line };
}

function normCandidate(c: Candidate, text: TextFn): Norm {
  if (typeof c.value === 'number') {
    const suffix = c.field === 'power' ? (/VA$/.test(c.unit) ? 'VA' : 'W') : '';
    return { key: `${num(c.base ?? c.value)}${suffix}`, connection: c.connection, line: c.line };
  }
  return { key: text(c.value), line: c.line };
}

const num = (x: number) => String(Number(x.toPrecision(6)));
/** Exact text: upper case, no whitespace or -_.:· — what the user would read, letter for letter. */
const plainText: TextFn = (s) => s.toUpperCase().replace(/[\s\-_.:·]+/g, '');
/**
 * Folded text as the blind set's FORMAT.md suggests (`canon()` in its check.py): exact text plus the OCR look-alikes
 * folded (RN→M, VV→W, O→0, I/L/|/!→1, S→5, B→8). Lenient: "LLE1OO2" scores as "1LE1002" although the user sees the former.
 */
const foldedText: TextFn = (s) =>
  plainText(s)
    .replace(/RN/g, 'M')
    .replace(/VV/g, 'W')
    .replace(/O/g, '0')
    .replace(/[IL|!]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8');

export type FieldScore = { field: NameplateField; plates: number; exact: number; top1: number; trueValues: number; recalled: number; extra: number; falsePositivePlates: number; connections: number; connectionsRight: number; lines: number; linesRight: number };
export type PlateResult = { id: string; misses: { field: NameplateField; want: string[]; got: string[]; best?: string }[] };
export type Score = { fields: Record<NameplateField, FieldScore>; plates: PlateResult[]; total: { fieldCases: number; exact: number; top1: number; falsePositives: number }; text: 'exact' | 'folded' };

/** Scores with exact-text comparison (the headline); `{ text: 'folded' }` folds the OCR look-alikes (lenient, S5). */
export function scorePlates(plates: readonly Plate[], opts: { text?: 'exact' | 'folded' } = {}): Score {
  const mode = opts.text ?? 'exact';
  const text = mode === 'folded' ? foldedText : plainText;
  const normC = (c: Candidate) => normCandidate(c, text);
  const fields = Object.fromEntries(
    NAMEPLATE_FIELDS.map((f) => [f, { field: f, plates: 0, exact: 0, top1: 0, trueValues: 0, recalled: 0, extra: 0, falsePositivePlates: 0, connections: 0, connectionsRight: 0, lines: 0, linesRight: 0 }])
  ) as Record<NameplateField, FieldScore>;
  const results: PlateResult[] = [];
  for (const plate of plates) {
    const reading = parseNameplate(plate.lines);
    const misses: PlateResult['misses'] = [];
    for (const field of NAMEPLATE_FIELDS) {
      const s = fields[field];
      const offeredList = offered(reading, field);
      const got = offeredList.map(normC);
      const gotKeys = [...new Set(got.map((g) => g.key))];
      const truth = plate.truth[field];
      if (!truth || truth.length === 0) {
        if (gotKeys.length > 0) {
          s.falsePositivePlates++;
          misses.push({ field, want: [], got: gotKeys });
        }
        continue;
      }
      const want = truth.map((t) => normTruth(field, t, text));
      const wantKeys = [...new Set(want.map((w) => w.key))];
      s.plates++;
      s.trueValues += wantKeys.length;
      s.recalled += wantKeys.filter((k) => gotKeys.includes(k)).length;
      s.extra += gotKeys.filter((k) => !wantKeys.includes(k)).length;
      const exact = gotKeys.length === wantKeys.length && wantKeys.every((k) => gotKeys.includes(k));
      const best = offeredList[0];
      const top1 = !!best && wantKeys.includes(normC(best).key);
      if (exact) s.exact++;
      if (top1) s.top1++;
      for (const w of want) {
        if (w.line !== undefined && gotKeys.includes(w.key)) {
          s.lines++;
          if (got.some((g) => g.key === w.key && want.some((x) => x.key === w.key && x.line === g.line))) s.linesRight++;
        }
        if (!w.connection) continue;
        s.connections++;
        // contradicted = an offered twin carries a connection that no true entry of the same value has (a plate may print
        // 400 V both as Y and as Δ, on two rating rows)
        const twins = got.filter((g) => g.key === w.key);
        const allowed = new Set(want.filter((x) => x.key === w.key).map((x) => x.connection));
        if (twins.some((g) => g.connection === w.connection) && !twins.some((g) => g.connection !== undefined && !allowed.has(g.connection))) s.connectionsRight++;
      }
      if (!exact) misses.push({ field, want: wantKeys, got: gotKeys, best: best ? normC(best).key : undefined });
    }
    results.push({ id: plate.id, misses });
  }
  const all = Object.values(fields);
  return {
    fields,
    plates: results,
    total: {
      fieldCases: all.reduce((n, f) => n + f.plates, 0),
      exact: all.reduce((n, f) => n + f.exact, 0),
      top1: all.reduce((n, f) => n + f.top1, 0),
      falsePositives: all.reduce((n, f) => n + f.falsePositivePlates, 0),
    },
    text: mode,
  };
}

/** "field:plate" for every field case that is not exact (and every false positive): pinned in the fixture tests. */
export function missList(score: Score): string[] {
  return score.plates.flatMap((p) => p.misses.map((m) => `${p.id} ${m.field}`)).sort();
}

const pct = (a: number, b: number) => (b === 0 ? '   -  ' : `${((100 * a) / b).toFixed(1).padStart(5)}%`);

/** A plain-text table for the bench script and the log; `folded` adds the look-alike-folded figure as a second line. */
export function formatScore(score: Score, title: string, folded?: Score): string {
  const rows = [`${title} — text compared ${score.text === 'exact' ? 'EXACTLY (headline)' : 'with look-alike folding'}`, 'field             plates  exact    top1     recall   extra  false+  conn(Δ/Y)  line'];
  for (const f of NAMEPLATE_FIELDS) {
    const s = score.fields[f];
    rows.push(
      `${f.padEnd(16)} ${String(s.plates).padStart(6)}  ${pct(s.exact, s.plates)}  ${pct(s.top1, s.plates)}  ${pct(s.recalled, s.trueValues)}  ${String(s.extra).padStart(5)}  ${String(s.falsePositivePlates).padStart(6)}  ${(s.connections ? `${s.connectionsRight}/${s.connections}` : '-').padEnd(9)}  ${s.lines ? `${s.linesRight}/${s.lines}` : '-'}`
    );
  }
  const t = score.total;
  rows.push(`ALL              ${String(t.fieldCases).padStart(6)}  ${pct(t.exact, t.fieldCases)}  ${pct(t.top1, t.fieldCases)}                    ${String(t.falsePositives).padStart(6)}`);
  if (folded) {
    const f = folded.total;
    rows.push(`ALL folded       ${String(f.fieldCases).padStart(6)}  ${pct(f.exact, f.fieldCases)}  ${pct(f.top1, f.fieldCases)}                    ${String(f.falsePositives).padStart(6)}   (O→0, I/L→1, S→5, B→8 folded: lenient)`);
  }
  return rows.join('\n');
}
