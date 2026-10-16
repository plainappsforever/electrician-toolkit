// P3 oracle comparator (SPEC A2, D23): engine vs the independent Python oracle in oracle/.
// Calls ONLY the exported compute(kind, input) — written without reading the engine's code.
// Fixtures: test/fixtures/oracle/<kind>.json from `python3 oracle/gen.py` (never edited by hand).
// Numbers: |engine − oracle| ≤ max(1e−9·|oracle|, 1e−12). Texts, checks, warning codes (multiset),
// error codes (set), required source ids and "≥ 1 assumption when a default was used" exactly.
// Known mismatches (classified in docs/REVIEW_ORACLE.md) live in known-mismatches.json; the test
// fails on any NEW mismatch and on any listed mismatch that has disappeared (so the list stays true).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { compute, SOURCE_IDS } from './index';

type Expect = {
  ok: boolean;
  values?: Record<string, number>;
  texts?: Record<string, string>;
  checks?: Record<string, boolean>;
  warnings?: string[];
  errors?: string[];
  absent?: string[];
  sources?: string[];
  assumptions?: boolean;
};
type Case = { id: string; kind: string; input: Record<string, unknown>; expect: Expect; tags?: string[] };
type Example = Case & { spec: Record<string, string | boolean | string[]> };
type Known = { id: string; field: string; class: string; finding: string };
type Compute = (kind: string, input: Record<string, unknown>) => unknown;

const DIR = join(__dirname, '..', '..', 'test', 'fixtures', 'oracle');
const KINDS = ['vdrop', 'current', 'ohm', 'coord', 'loop', 'resistance', 'convert'] as const;
const load = <T,>(name: string): T => JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as T;
const REL = 1e-9;
const ABS = 1e-12;
const sourceIds = new Set<string>(SOURCE_IDS as readonly string[]);

const close = (got: number, want: number) => Math.abs(got - want) <= Math.max(REL * Math.abs(want), ABS);

// The result is read defensively: the contract (V1_LOG P3 oracle note) is all this test relies on.
type AnyResult = {
  ok?: unknown;
  values?: Record<string, { value?: unknown } | undefined>;
  texts?: Record<string, unknown>;
  checks?: { id?: unknown; met?: unknown }[];
  warnings?: { code?: unknown }[];
  errors?: { code?: unknown }[];
  steps?: unknown[];
  assumptions?: unknown[];
  sources?: unknown[];
};
const sourceId = (s: unknown): string =>
  typeof s === 'string' ? s : s && typeof s === 'object' && 'id' in s ? String((s as { id: unknown }).id) : '?';
const codes = (xs: { code?: unknown }[] | undefined) => (xs ?? []).map((x) => String(x.code)).sort();

/** Every difference between the engine and the oracle for one case, as "field: detail". */
export function diffCase(c: Case, run: Compute = compute as unknown as Compute): string[] {
  const out: string[] = [];
  const r = run(c.kind, c.input) as AnyResult;
  const e = c.expect;
  if (r.ok !== e.ok) {
    out.push(`ok: oracle ${e.ok} [${(e.errors ?? []).join(',')}] engine ${String(r.ok)} [${codes(r.errors).join(',')}]`);
    return out;
  }
  if (!e.ok) {
    const got = [...new Set(codes(r.errors))];
    if (got.join(',') !== (e.errors ?? []).join(',')) out.push(`errors: oracle [${e.errors}] engine [${got}]`);
    if (Object.keys(r.values ?? {}).length || (r.warnings ?? []).length) out.push('errors: result not empty');
    return out;
  }
  for (const [name, want] of Object.entries(e.values ?? {})) {
    const got = r.values?.[name]?.value;
    if (typeof got !== 'number') out.push(`values.${name}: missing (oracle ${want})`);
    else if (!close(got, want)) out.push(`values.${name}: oracle ${want} engine ${got}`);
  }
  for (const name of e.absent ?? []) {
    if (r.values?.[name] !== undefined) out.push(`values.${name}: present (oracle: absent)`);
  }
  for (const [name, want] of Object.entries(e.texts ?? {})) {
    if (r.texts?.[name] !== want) out.push(`texts.${name}: oracle ${want} engine ${String(r.texts?.[name])}`);
  }
  for (const [id, want] of Object.entries(e.checks ?? {})) {
    const ch = (r.checks ?? []).find((x) => x.id === id);
    if (!ch) out.push(`checks.${id}: missing`);
    else if (ch.met !== want) out.push(`checks.${id}: oracle ${want} engine ${String(ch.met)}`);
  }
  const w = codes(r.warnings).join(',');
  if (w !== (e.warnings ?? []).join(',')) out.push(`warnings: oracle [${e.warnings}] engine [${w}]`);
  const src = (r.sources ?? []).map(sourceId);
  for (const id of e.sources ?? []) if (!src.includes(id)) out.push(`sources: ${id} missing`);
  for (const id of src) if (!sourceIds.has(id)) out.push(`sources: ${id} not in registry`);
  if (!src.length) out.push('sources: none');
  if (!(r.steps ?? []).length) out.push('steps: none');
  if (e.assumptions && !(r.assumptions ?? []).length) out.push('assumptions: none although a default was used');
  return out;
}

const field = (d: string) => d.slice(0, d.indexOf(':'));
const known: Known[] = load<Known[]>('known-mismatches');
const knownKeys = new Set(known.map((k) => `${k.id}|${k.field}`));
const report: { id: string; kind: string; diff: string; tags?: string[] }[] = [];

describe.each(KINDS)('oracle vs engine: %s', (kind) => {
  const cases = load<Case[]>(kind);

  it(`has ≥ 2000 cases per kind (SPEC A2), ${kind}`, () => {
    expect(cases.filter((c) => !c.id.includes('-edge-')).length).toBeGreaterThanOrEqual(2000);
  });

  it('matches the oracle on every case (new mismatches fail; listed ones must still occur)', () => {
    const found = new Set<string>();
    const unexpected: string[] = [];
    for (const c of cases) {
      for (const d of diffCase(c)) {
        const key = `${c.id}|${field(d)}`;
        found.add(key);
        report.push({ id: c.id, kind: c.kind, diff: d, tags: c.tags });
        if (!knownKeys.has(key)) unexpected.push(`${c.id} ${d}`);
      }
    }
    const ids = new Set(cases.map((c) => c.id));
    const vanished = known.filter((k) => ids.has(k.id) && !found.has(`${k.id}|${k.field}`)).map((k) => k.id);
    expect(unexpected.slice(0, 20)).toEqual([]);
    expect(vanished).toEqual([]);
  });
});

describe('SPEC §8 E1–E8: SPEC, oracle and engine agree', () => {
  const examples = load<Example[]>('examples');
  const printedOk = (got: unknown, printed: string) => {
    if (typeof got !== 'number') return false;
    const p = Number(printed);
    const decimals = printed.includes('.') ? printed.split('.')[1].length : 0;
    return Math.abs(got - p) <= Math.max(0.5 * 10 ** -decimals, REL * Math.abs(p));
  };
  it.each(examples.map((x) => [x.id, x] as const))('%s', (_id, x) => {
    const r = compute(x.kind as never, x.input as never) as unknown as AnyResult;
    for (const [path, want] of Object.entries(x.spec)) {
      const [head, ...rest] = path.split('.');
      const name = rest.join('.');
      if (head === 'values') {
        expect([path, printedOk(r.values?.[name]?.value, want as string)]).toEqual([path, true]);
        expect([path, 'oracle', printedOk(x.expect.values?.[name], want as string)]).toEqual([path, 'oracle', true]);
      } else if (head === 'texts') {
        expect([path, r.texts?.[name], x.expect.texts?.[name]]).toEqual([path, want, want]);
      } else if (head === 'checks') {
        const met = (r.checks ?? []).find((ch) => ch.id === name)?.met;
        expect([path, met, x.expect.checks?.[name]]).toEqual([path, want, want]);
      } else if (head === 'warnings') {
        // the SPEC names warnings that must be present
        for (const code of want as string[]) {
          expect(codes(r.warnings)).toContain(code);
          expect(x.expect.warnings).toContain(code);
        }
      }
    }
  });
});

describe('mutation check: the comparator catches deliberate engine bugs (test-only wrappers)', () => {
  const vdrop = load<Case[]>('vdrop');
  const loops = load<Case[]>('loop');
  const run = compute as unknown as Compute;

  it('b = 2 for three-phase (vdrop ac3 computed as a single-phase loop at U0)', () => {
    const mutant: Compute = (kind, input) => {
      if (kind !== 'vdrop' || input.system !== 'ac3' || typeof input.voltage !== 'number') return run(kind, input);
      const U = input.voltage;
      let current = input.current;
      if (typeof input.power === 'number') {
        const cos = typeof input.cosPhi === 'number' ? input.cosPhi : 1;
        const eta = typeof input.efficiency === 'number' ? input.efficiency : 1;
        current = input.power / (Math.sqrt(3) * U * cos * eta);
      }
      const { power: _p, efficiency: _e, ...rest } = input;
      return run('vdrop', { ...rest, system: 'ac1', voltage: U / Math.sqrt(3), current });
    };
    const target = vdrop.filter((c) => c.input.system === 'ac3' && c.expect.ok);
    const caught = target.filter((c) => diffCase(c, mutant).some((d) => d.startsWith('values.deltaUPercent')));
    expect(target.length).toBeGreaterThan(1000);
    expect(caught.length).toBe(target.length);
  });

  it('Cmin applied twice (loop)', () => {
    const mutant: Compute = (kind, input) =>
      kind === 'loop' && typeof input.cmin === 'number' ? run(kind, { ...input, cmin: input.cmin ** 2 }) : run(kind, input);
    const target = loops.filter((c) => c.expect.ok && c.input.cmin === 0.95);
    const caught = target.filter((c) => diffCase(c, mutant).some((d) => d.startsWith('values.zsMax')));
    expect(target.length).toBeGreaterThan(300);
    expect(caught.length).toBe(target.length);
  });
});

afterAll(() => {
  // Optional mismatch dump for docs/REVIEW_ORACLE.md: ORACLE_REPORT=/path/file.json npx jest src/engine/oracle
  const path = process.env.ORACLE_REPORT;
  if (path) writeFileSync(path, JSON.stringify(report, null, 1));
});
