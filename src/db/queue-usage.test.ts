/** @jest-environment node */
// Review #21 (D65): a static scan of the app code. (1) Every statement runs on a queue handle: `getAllAsync`,
// `getFirstAsync`, `runAsync` and `execAsync` are only called on `tx` or `r` (the unit's handle), except inside tx.ts,
// its retry wrapper native-retry.ts and the two PRAGMA reads of migrate(). (2) Inside a withTransaction/withWrite/withRead callback the outer `db` is
// never mentioned: passing it to a data function from inside a unit waits for the unit to end — a deadlock (P4 note 1).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
const ALLOWED_DIRECT = new Set(['db/tx.ts', 'db/migrations.ts', 'db/native-retry.ts']); // native-retry wraps the raw connection for tx.ts

/** The text of each `withX(db, <callback>)` call: from its opening parenthesis to the matching one. */
function unitBodies(code: string): string[] {
  const out: string[] = [];
  const re = /\bwith(?:Transaction|Write|Read)\(\s*\w+\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    let depth = 0;
    let i = code.indexOf('(', m.index);
    const start = re.lastIndex;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) break;
    }
    out.push(code.slice(start, i));
  }
  return out;
}

describe('queue usage scan (review #21)', () => {
  const all = files(SRC);
  it('scans the app code', () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it('statements run only on a unit handle', () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const f of all) {
      const rel = relative(SRC, f);
      if (ALLOWED_DIRECT.has(rel)) continue;
      const code = readFileSync(f, 'utf8');
      for (const m of code.matchAll(/\b(\w+)\s*\.\s*(getAllAsync|getFirstAsync|runAsync|execAsync)\s*[<(]/g)) {
        seen++;
        if (m[1] !== 'tx' && m[1] !== 'r') offenders.push(`${rel}: ${m[0]}`);
      }
    }
    expect(seen).toBeGreaterThan(40);
    expect(offenders).toEqual([]);
  });

  it('no unit callback mentions the outer `db`', () => {
    const offenders: string[] = [];
    let units = 0;
    for (const f of all) {
      const code = readFileSync(f, 'utf8');
      units += unitBodies(code).length;
      for (const body of unitBodies(code)) if (/\bdb\b/.test(body)) offenders.push(`${relative(SRC, f)}: ${body.slice(0, 80)}`);
    }
    expect(units).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it('the scan catches the deadlock pattern it is meant for', () => {
    const bad = 'await withTransaction(db, async (tx) => { await getAppSettings(db); });';
    expect(unitBodies(bad).some((b) => /\bdb\b/.test(b))).toBe(true);
    expect(unitBodies('await withRead(db, (r) => r.getAllAsync(sql))').some((b) => /\bdb\b/.test(b))).toBe(false);
  });
});
