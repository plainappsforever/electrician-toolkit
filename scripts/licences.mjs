#!/usr/bin/env node
// Writes src/constants/licences.json: name, version, licence id and licence text of every production dependency in
// package.json, read from node_modules (v1.1, RELEASE_KIT 1c item 10). Run after a dependency change:
//   node scripts/licences.mjs          (writes the file)
//   node scripts/licences.mjs --check  (exit 1 when the file is out of date; src/lib/licences.test.ts runs this check)
// Only the direct dependencies are listed; each package's own dependencies carry their notices in their packages
// (owner question: whether that is enough for the stores is UNCONFIRMED). Never deletes anything.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, 'src/constants/licences.json');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const NAMES = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

export function collect() {
  return Object.keys(pkg.dependencies ?? {})
    .sort()
    .map((name) => {
      const dir = path.join(root, 'node_modules', name);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const file = fs.readdirSync(dir).find((f) => NAMES.test(f));
      const licence = typeof meta.license === 'string' ? meta.license : (meta.license?.type ?? 'see package');
      let text = file ? fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n').trim() : '';
      // two packages of the expo/expo monorepo (@expo/ui, expo-router) ship no licence file: they carry the monorepo's MIT
      // licence, which the `expo` package itself ships
      const repo = typeof meta.repository === 'string' ? meta.repository : (meta.repository?.url ?? '');
      if (!text && licence === 'MIT' && /github\.com\/expo\/expo(\.git)?$/.test(repo)) {
        text = `(MIT licence of the expo/expo repository, as shipped in the expo package)\n\n${fs.readFileSync(path.join(root, 'node_modules/expo/LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim()}`;
      }
      return { name, version: meta.version, licence, text };
    });
}

const json = `${JSON.stringify(collect(), null, 1)}\n`;
if (process.argv.includes('--check')) {
  const now = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (now !== json) {
    console.error('src/constants/licences.json is out of date: run node scripts/licences.mjs');
    process.exit(1);
  }
  console.log('licences.json is current');
} else {
  fs.writeFileSync(out, json);
  const list = JSON.parse(json);
  console.log(`wrote ${list.length} packages (${list.filter((p) => !p.text).length} without a licence file) to ${path.relative(root, out)}`);
}
