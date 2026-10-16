/** @jest-environment node */
// D64 (review #9): golden EN + DE HTML of the saved E1/E3/E4 reports. A frozen record's rendering may change only by a
// deliberate wording, registry, i18n or formatter edit — and then this test fails until the golden files are
// regenerated on purpose (`UPDATE_GOLDEN=1 npx jest src/lib/report-golden`) and the diff is reviewed in the commit.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StoredCalculation } from '@/db/calculations';
import { E1_INPUT, E3_INPUT, E4_INPUT } from '@/dev/seeds';
import { compute, type CalcKind } from '@/engine';
import { isMessageKey } from '@/engine/explain';

import { buildCalculationReport, type ReportContext } from './report-html';

const DIR = join(__dirname, '..', '..', 'test', 'fixtures', 'report-golden');
const ctx = (language: 'en' | 'de'): ReportContext => ({
  language,
  paper: 'A4',
  company: { name: 'Elektro Muster GmbH', address: 'Hauptstr. 1', phone: '', email: '', regNo: '' },
  logoDataUri: null,
  generatedAt: Date.UTC(2026, 9, 1, 12),
  appVersion: '1.0.0',
});
const stored = (kind: CalcKind, input: unknown): StoredCalculation => {
  const result = compute(kind, input as never);
  return { id: 1, projectId: 1, circuitId: null, kind, title: 'F3', note: '', input: result.usedInput, result, engineVersion: result.engineVersion, profileId: result.profileId, profileVersion: result.profileVersion, createdAt: Date.UTC(2026, 8, 30, 12), updatedAt: 0 };
};
const CASES: [string, CalcKind, unknown][] = [
  ['e1', 'vdrop', E1_INPUT],
  ['e3', 'coord', E3_INPUT],
  ['e4', 'loop', E4_INPUT],
];

describe('golden reports (D64)', () => {
  for (const [name, kind, input] of CASES) {
    for (const language of ['en', 'de'] as const) {
      it(`${name} ${language}`, () => {
        const html = buildCalculationReport(stored(kind, input), ctx(language));
        const file = join(DIR, `${name}-${language}.html`);
        if (process.env.UPDATE_GOLDEN === '1') writeFileSync(file, html);
        expect(html).toBe(readFileSync(file, 'utf8'));
      });
    }
  }

  it('every step, assumption, check and warning key of the golden records exists (old snapshots reference them; keys are never renamed or deleted)', () => {
    for (const [, kind, input] of CASES) {
      const r = compute(kind, input as never);
      for (const item of [...r.steps, ...r.assumptions, ...r.checks, ...r.warnings]) expect([item.key, isMessageKey(item.key)]).toEqual([item.key, true]);
    }
  });
});
