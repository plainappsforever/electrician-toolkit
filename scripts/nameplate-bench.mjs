#!/usr/bin/env node
// Nameplate parser accuracy on fixture sets (V1.5 phase A, docs/V15_LOG.md): per field the share of plates where the
// offered values are exactly the true ones ("exact"), where the best candidate is right ("top1"), recall, extra values and
// false positives; text fields compared exactly (headline) and with OCR look-alikes folded (second ALL line). Device-free: runs the app's TypeScript parser in plain Node (type stripping, scripts/node/ts-hooks.mjs).
// Usage: node --import ./scripts/node/ts-hooks.mjs scripts/nameplate-bench.mjs [own|blind|<file.json>…] [--misses]
//   own   = test/fixtures/nameplates/own/plates.json (development set, NOT held out)
//   blind = test/fixtures/nameplates/blind/ (blind set 1, a tuning set now); blind-2 = test/fixtures/nameplates/blind-2/
//   (blind set 2, measured once against snapshot e0d953f; see its README); blind-3 = blind set 3 (measured once against c003585)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatScore, scorePlates } from '../src/lib/nameplate-score.ts';
import { loadPlates } from '../src/lib/nameplate-fixtures.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const showMisses = args.includes('--misses');
const sets = args.filter((a) => !a.startsWith('--'));
for (const set of sets.length ? sets : ['own']) {
  const dir = ['own', 'blind', 'blind-2', 'blind-3'].includes(set) ? path.join(root, 'test/fixtures/nameplates', set) : set;
  const plates = loadPlates(dir, (p) => fs.readFileSync(p, 'utf8'), (d) => (fs.statSync(d).isDirectory() ? fs.readdirSync(d) : []), path.join);
  const started = performance.now();
  const score = scorePlates(plates);
  const ms = performance.now() - started;
  const folded = scorePlates(plates, { text: 'folded' });
  console.log(formatScore(score, `${set}: ${plates.length} plates, ${ms.toFixed(0)} ms`, folded));
  if (showMisses) for (const p of score.plates) for (const m of p.misses) console.log(`  ${p.id} ${m.field}: want [${m.want.join(', ')}] offered [${m.got.join(', ')}]${m.best ? ` best ${m.best}` : ''}`);
  console.log('');
}
