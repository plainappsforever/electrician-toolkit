/** @jest-environment node */
// v1.1 (RELEASE_KIT 1c item 10): the licences screen lists every production dependency with a licence text, and the
// generated file matches node_modules (rerun `node scripts/licences.mjs` after a dependency change).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import LICENCES from '@/constants/licences.json';

describe('open-source licences', () => {
  it('lists every production dependency, each with a licence id and text', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(LICENCES.map((l) => l.name).sort()).toEqual(Object.keys(pkg.dependencies).sort());
    for (const l of LICENCES) {
      expect(l.licence).toMatch(/\S/);
      expect(l.text.length).toBeGreaterThan(200);
    }
  });
  it('the generated file is current', () => {
    expect(() => execFileSync('node', [join(__dirname, '../../scripts/licences.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
