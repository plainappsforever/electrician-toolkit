/** @jest-environment node */
// v1.1 (REVIEW_V1 #20): no table-CSV fixture and no Maestro flow carries the published IEC 60364-5-52 Table B.52.2
// method-C row set (2.5 → 27, 4 → 36, 6 → 46, 10 → 63): example files and screenshots must only ever show invented
// values (D59, RELEASE_KIT 1c item 25). The labelled `table` dev seed (D59) is the one deliberate exception.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '../..');
const DENY = [/(^|[^\d.,])2[.,]5\D+27(?!\d)/, /(^|[^\d.,])4\D+36(?!\d)/, /(^|[^\d.,])6\D+46(?!\d)/, /(^|[^\d.,])10\D+63(?!\d)/];

function files(dir: string, pick: (n: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name), pick) : pick(e.name) ? [join(dir, e.name)] : []));
}

describe('invented table values only (fixtures and flows)', () => {
  it('no table CSV fixture holds a published row pair', () => {
    for (const f of files(join(root, 'test/fixtures/files'), (n) => n.endsWith('.csv'))) {
      const lines = readFileSync(f, 'utf8').split(/\r?\n/);
      for (const line of lines) for (const re of DENY) expect(`${f}: ${line}`).not.toMatch(re);
    }
  });
  it('no Maestro flow types a published Iz for 2.5 mm²', () => {
    for (const f of files(join(root, '.maestro'), (n) => n.endsWith('.yaml'))) {
      const text = readFileSync(f, 'utf8');
      expect(`${f}: ${/inputText: "2,5;27"|TEXT: "27"/.test(text)}`).toBe(`${f}: false`);
    }
  });
});
