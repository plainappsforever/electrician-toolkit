/** @jest-environment node */
// D59 / P5 note: the seeds (the `table` seed holds IEC values) and the probes must not be part of a preview/production
// bundle. Metro folds `__DEV__ ? require(x) : null` to `null` in a release bundle (checked once with `expo export`,
// V1_LOG P5); any other way of reaching src/dev from the app code would put it back. This scan keeps that true.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });

describe('src/dev stays out of release bundles', () => {
  it('nothing outside src/dev imports src/dev statically; a require is always `__DEV__ ? require(…) : null`', () => {
    const offenders: string[] = [];
    let guarded = 0;
    for (const f of files(SRC)) {
      const rel = relative(SRC, f);
      if (rel.startsWith('dev/')) continue;
      const code = readFileSync(f, 'utf8');
      if (/from\s+['"](?:@\/dev|\.{1,2}\/(?:\.\.\/)*dev)\//.test(code)) offenders.push(`${rel}: static import`);
      for (const m of code.matchAll(/require\(\s*['"]@\/dev\/[^'"]+['"]\s*\)/g)) {
        const before = code.slice(Math.max(0, m.index! - 40), m.index);
        if (/__DEV__\s*\?\s*$/.test(before)) guarded++;
        else offenders.push(`${rel}: unguarded ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
    expect(guarded).toBeGreaterThanOrEqual(2);
  });
});
