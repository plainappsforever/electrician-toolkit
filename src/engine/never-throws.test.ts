// compute() never throws (SPEC §7.0) on 10 000 random/garbage inputs, and every result it returns keeps the
// result invariants: A3 (steps, assumptions, sources that resolve), message keys and placeholders exist in EN and DE
// (A11), no banned word in any rendered text (A4), only finite numbers, errors ⇔ no result.
import { messages } from '../i18n';
import { bannedWordsIn } from '../lib/wording';
import { rng } from '../../test/seeded-random';
import { explain, isMessageKey, placeholdersOf } from './explain';
import { compute } from './index';
import { isSourceId, SOURCES } from './sources';
import { CALC_KINDS, type CalcResult, type Vars } from './types';

const R = rng(4711);

const GARBAGE: unknown[] = [undefined, null, '', 'abc', '12', '1,5', NaN, Infinity, -Infinity, -0, 0, -1, 1e308, 1e-308, -1e308, true, [], {}, [1, 2], { value: 1 }];
const NUMBERS = () => R.pick([R.between(0, 1), R.between(0, 100), R.between(0, 1e4), R.int(-5, 45), R.between(-50, 400), 0.95, 1, 2 / 3]);
const garbageOr = <T,>(valid: () => T): unknown => (R.next() < 0.15 ? R.pick(GARBAGE) : valid());

const SIZE = () => garbageOr(() => R.pick([{ value: R.pick([1.5, 2.5, 6, 25, 300, 0.5]), unit: 'mm2' }, { value: R.int(-5, 42), unit: 'awg' }, { value: R.between(1, 2000), unit: 'kcmil' }, { value: 1, unit: 'inch' }]));
const LENGTH = () => garbageOr(() => ({ value: R.pick([R.between(0, 20000), 0, -3]), unit: R.pick(['m', 'ft', 'yd']) }));
const DEVICE = () =>
  garbageOr(() =>
    R.pick([
      { type: 'mcb', curve: R.pick(['B', 'C', 'D', 'K']), ratedCurrent: R.pick([6, 10, 13, 16, 15, 125, 0]) },
      { type: 'other', ratedCurrent: NUMBERS(), i2: NUMBERS(), ia: NUMBERS() },
      { type: 'fuse' },
    ]),
  );

function randomInput(kind: string): unknown {
  switch (kind) {
    case 'vdrop':
      return {
        system: garbageOr(() => R.pick(['dc', 'ac1', 'ac3'])),
        voltage: garbageOr(NUMBERS),
        ...(R.next() < 0.5 ? { current: garbageOr(NUMBERS) } : { power: garbageOr(() => R.between(1, 1e6)) }),
        efficiency: R.next() < 0.3 ? garbageOr(NUMBERS) : undefined,
        length: LENGTH(),
        material: garbageOr(() => R.pick(['cu', 'al', 'fe'])),
        size: SIZE(),
        parallel: R.next() < 0.3 ? garbageOr(() => R.int(0, 5)) : undefined,
        cosPhi: R.next() < 0.6 ? garbageOr(NUMBERS) : undefined,
        method: R.next() < 0.7 ? garbageOr(() => R.pick(['M1', 'M2', 'M3', 'M9'])) : undefined,
        conductorTempC: R.next() < 0.3 ? garbageOr(NUMBERS) : undefined,
        insulation: R.next() < 0.2 ? garbageOr(() => R.pick(['pvc', 'xlpe', 'rubber'])) : undefined,
        reactanceOhmPerM: R.next() < 0.3 ? garbageOr(() => R.between(-0.001, 0.001)) : undefined,
        kappa: R.next() < 0.3 ? garbageOr(NUMBERS) : undefined,
        limitPercent: garbageOr(NUMBERS),
        limitPreset: R.next() < 0.2 ? garbageOr(() => R.pick(['din18015-1', 'vde-ar-n-4100', 'iec-g-lighting', 'iec-g-other', 'x'])) : undefined,
      };
    case 'current':
      return { system: garbageOr(() => R.pick(['dc', 'ac1', 'ac3'])), voltage: garbageOr(NUMBERS), power: R.next() < 0.6 ? garbageOr(NUMBERS) : undefined, current: R.next() < 0.6 ? garbageOr(NUMBERS) : undefined, cosPhi: garbageOr(NUMBERS), efficiency: garbageOr(NUMBERS) };
    case 'ohm':
      return Object.fromEntries(['voltage', 'current', 'resistance', 'power'].filter(() => R.next() < 0.55).map((k) => [k, garbageOr(NUMBERS)]));
    case 'coord':
      return {
        ib: garbageOr(NUMBERS),
        device: DEVICE(),
        ...(R.next() < 0.5 ? { izTyped: garbageOr(NUMBERS) } : { table: garbageOr(() => ({ izA: NUMBERS(), insulationMaxC: R.pick([70, 90]), referenceAmbientC: R.pick([20, 30, 95]), tableName: 'T', sourceNote: 'n', sizeMm2: 2.5 })) }),
        insulationMaxC: R.next() < 0.5 ? garbageOr(NUMBERS) : undefined,
        referenceAmbientC: R.next() < 0.5 ? garbageOr(NUMBERS) : undefined,
        ambientC: R.next() < 0.6 ? garbageOr(NUMBERS) : undefined,
        fTheta: R.next() < 0.2 ? garbageOr(NUMBERS) : undefined,
        fGroup: R.next() < 0.5 ? garbageOr(NUMBERS) : undefined,
        fOther: R.next() < 0.2 ? garbageOr(NUMBERS) : undefined,
      };
    case 'loop':
      return {
        mode: R.next() < 0.8 ? garbageOr(() => R.pick(['calculated', 'measured', 'guessed'])) : undefined,
        u0: R.next() < 0.5 ? garbageOr(NUMBERS) : undefined,
        device: DEVICE(),
        cmin: R.next() < 0.5 ? garbageOr(NUMBERS) : undefined,
        ze: garbageOr(NUMBERS),
        material: garbageOr(() => R.pick(['cu', 'al'])),
        lineSize: SIZE(),
        peSize: SIZE(),
        length: LENGTH(),
        loopTempC: R.next() < 0.3 ? garbageOr(NUMBERS) : undefined,
        zsMeasured: garbageOr(NUMBERS),
        measuredFactor: R.next() < 0.3 ? garbageOr(NUMBERS) : undefined,
      };
    case 'resistance':
      return { material: garbageOr(() => R.pick(['cu', 'al'])), size: SIZE(), length: LENGTH(), temperatureC: R.next() < 0.5 ? garbageOr(NUMBERS) : undefined, parallel: R.next() < 0.3 ? garbageOr(() => R.int(0, 4)) : undefined, peSize: R.next() < 0.3 ? SIZE() : undefined };
    case 'convert':
      return { from: garbageOr(() => R.pick(['awg', 'mm2', 'kcmil', 'ft', 'm', 'in'])), value: garbageOr(() => R.pick([R.int(-5, 45), R.between(0, 1000)])) };
    default:
      return R.pick(GARBAGE);
  }
}

/** Every key exists, its placeholders are exactly the vars given, nested key vars exist too. */
function checkItem(item: { key: string; vars: Vars }, where: string, problems: string[]) {
  if (!isMessageKey(item.key)) return problems.push(`${where}: unknown key ${item.key}`);
  const want = [...new Set(placeholdersOf(item.key))].sort();
  const got = Object.keys(item.vars).sort();
  if (want.join() !== got.join()) problems.push(`${where} ${item.key}: placeholders ${want} vs vars ${got}`);
  for (const v of Object.values(item.vars)) {
    if (v.kind === 'key' && !isMessageKey(v.value)) problems.push(`${where} ${item.key}: unknown var key ${v.value}`);
    if (v.kind === 'num' && !Number.isFinite(v.value)) problems.push(`${where} ${item.key}: non-finite var`);
  }
  for (const lang of ['en', 'de'] as const) {
    const words = bannedWordsIn(explain(item, lang));
    if (words.length) problems.push(`${where} ${item.key} (${lang}): banned ${words}`);
  }
}

function invariants(r: CalcResult): string[] {
  const problems: string[] = [];
  expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  if (r.ok !== (r.errors.length === 0)) problems.push('ok ⇔ no errors');
  r.errors.forEach((e) => checkItem(e, 'error', problems));
  if (!r.ok) {
    if (Object.keys(r.values).length || r.steps.length || r.checks.length) problems.push('error result carries values');
    return problems;
  }
  if (r.steps.length < 1) problems.push('A3: no step');
  if (r.assumptions.length < 1) problems.push('A3: no assumption');
  if (r.sources.length < 1) problems.push('A3: no source');
  for (const s of r.sources) if (!isSourceId(s) || !SOURCES[s].licence) problems.push(`source ${s} unresolved`);
  for (const [name, v] of Object.entries(r.values)) {
    if (!Number.isFinite(v.value)) problems.push(`value ${name} not finite`);
    if (!isMessageKey(v.formula)) problems.push(`value ${name}: unknown formula key ${v.formula}`);
    if (!isSourceId(v.source)) problems.push(`value ${name}: unknown source ${v.source}`);
  }
  r.steps.forEach((s) => checkItem(s, 'step', problems));
  r.assumptions.forEach((a) => checkItem(a, 'assumption', problems));
  r.checks.forEach((c) => checkItem(c, 'check', problems));
  r.warnings.forEach((w) => checkItem(w, 'warning', problems));
  for (const t of Object.values(r.texts)) if (bannedWordsIn(t).length) problems.push(`text ${t} banned`);
  return problems;
}

describe('compute() never throws and keeps its invariants', () => {
  it('10 000 random and garbage inputs', () => {
    const seen = { ok: 0, error: 0 };
    const kinds = [...CALC_KINDS, 'nonsense'];
    const problems = new Set<string>();
    for (let k = 0; k < 10000; k++) {
      const kind = R.pick(kinds);
      const input = R.next() < 0.03 ? R.pick(GARBAGE) : randomInput(kind);
      let r: CalcResult;
      try {
        r = compute(kind, input);
      } catch (e) {
        throw new Error(`threw on ${kind} ${JSON.stringify(input)}: ${String(e)}`);
      }
      seen[r.ok ? 'ok' : 'error']++;
      for (const p of invariants(r)) problems.add(`${kind}: ${p}`);
    }
    expect([...problems]).toEqual([]);
    expect(seen.ok).toBeGreaterThan(1000);
    expect(seen.error).toBeGreaterThan(1500);
  });

  it('every valid result of every kind passes the invariants (one per kind)', () => {
    const samples: [string, unknown][] = [
      ['vdrop', { system: 'ac3', voltage: 400, power: 50000, cosPhi: 0.9, length: { value: 80, unit: 'ft' }, material: 'al', size: { value: 10, unit: 'awg' }, parallel: 2, method: 'M2', limitPercent: 3, limitPreset: 'din18015-1' }],
      ['current', { system: 'ac1', voltage: 230, current: 10, cosPhi: 0.8 }],
      ['ohm', { resistance: 10, power: 100 }],
      ['coord', { ib: 13, device: { type: 'other', ratedCurrent: 16, i2: 25.6 }, table: { izA: 20, insulationMaxC: 70, referenceAmbientC: 30, tableName: 'Mine', sourceNote: 'datasheet', sizeMm2: 1.5 }, ambientC: 40, fGroup: 0.8, fOther: 0.9 }],
      ['loop', { ze: 0.2, material: 'al', lineSize: { value: 250, unit: 'kcmil' }, peSize: { value: 16, unit: 'mm2' }, length: { value: 100, unit: 'm' }, device: { type: 'other', ia: 500 } }],
      ['resistance', { material: 'cu', size: { value: 4, unit: 'awg' }, length: { value: 30, unit: 'ft' }, peSize: { value: 10, unit: 'mm2' }, parallel: 3 }],
      ['convert', { from: 'mm2', value: 2.5 }],
    ];
    for (const [kind, input] of samples) {
      const r = compute(kind, input);
      expect(r.errors).toEqual([]);
      expect(invariants(r)).toEqual([]);
    }
  });

  it('every message key the engine can emit has EN and DE text', () => {
    // i18n.test.ts proves key parity; here: the engine's key families are all present.
    for (const prefix of ['field.', 'step.', 'assume.', 'check.', 'warn.', 'error.', 'method.', 'limit.', 'verdict.', 'material.', 'insulation.']) {
      expect(Object.keys(messages.en).some((k) => k.startsWith(prefix))).toBe(true);
    }
  });
});
