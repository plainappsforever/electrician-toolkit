/** @jest-environment node */
// A1: SPEC §8 worked examples E1–E8, values copied verbatim into test/fixtures/engine/*.json (see its README).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { compute } from './index';
import type { CalcResult } from './types';

type Expectation = number | string | boolean | string[] | { printed: string };
type Fixture = { id: string; spec: string; cases: { name: string; kind: string; input: unknown; expected: Record<string, Expectation> }[] };

const DIR = join(__dirname, '../../test/fixtures/engine');
const files = readdirSync(DIR).filter((f) => /^e\d+\.json$/.test(f)).sort();
const fixtures: Fixture[] = files.map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')));

function close(actual: number, expected: number, absTol: number) {
  return Math.abs(actual - expected) <= Math.max(1e-9 * Math.abs(expected), absTol);
}

function assertExpectation(result: CalcResult, path: string, exp: Expectation) {
  if (path === 'warnings') {
    expect(result.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(exp as string[]));
    return;
  }
  const [group, ...rest] = path.split('.');
  const name = rest.join('.');
  if (group === 'values') {
    const v = result.values[name];
    if (v === undefined) throw new Error(`missing value ${name}`);
    if (typeof exp === 'number') {
      if (!close(v.value, exp, 0)) throw new Error(`${path}: ${v.value} ≠ ${exp} (rel 1e-9)`);
    } else {
      const printed = (exp as { printed: string }).printed;
      const decimals = printed.includes('.') ? printed.split('.')[1].length : 0;
      const half = 0.5 * 10 ** -decimals * (1 + 1e-9);
      if (!close(v.value, Number(printed), half)) throw new Error(`${path}: ${v.value} ≠ ${printed} (±${half})`);
    }
  } else if (group === 'texts') {
    expect(result.texts[name]).toBe(exp);
  } else if (group === 'checks') {
    const check = result.checks.find((c) => c.id === name);
    if (!check) throw new Error(`missing check ${name}`);
    expect(check.met).toBe(exp);
  } else {
    throw new Error(`unknown expectation path ${path}`);
  }
}

describe('SPEC §8 worked examples (A1)', () => {
  it('has all eight example files', () => {
    expect(fixtures.map((f) => f.id)).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8']);
  });

  for (const fixture of fixtures) {
    describe(`${fixture.id}: ${fixture.spec}`, () => {
      for (const c of fixture.cases) {
        it(c.name, () => {
          const result = compute(c.kind, c.input);
          expect(result.errors).toEqual([]);
          expect(result.ok).toBe(true);
          for (const [path, exp] of Object.entries(c.expected)) assertExpectation(result, path, exp);
        });
      }
    });
  }
});
