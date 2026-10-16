#!/usr/bin/env node
// Independent re-read of the PDFs a development build wrote (`debug/pdfprobe`, D75): pdf.js parses every file (not the
// code that made it). Per file: page count equals what the app counted, A4 595 x 842 / Letter 612 x 792 pt, the dominant
// font size (the report CSS says body 9.5 pt: this is how the per-engine zoom in src/lib/print-html.ts is MEASURED), the
// text margins on every page (CSS: 13 mm sides), the responsibility note + version line on EVERY page, the note on page 1
// and on every page with a verdict line (v1.1 F2), the logo image,
// the numbers a reader needs (SPEC E1: 3.76 % / 3,76 %), every probe calculation once, no banned verdict words.
// pdf.js is NOT a project dependency: install it anywhere and pass its folder.
// Usage: node scripts/verify-pdfs.mjs --pdfjs <dir containing node_modules/pdfjs-dist> <pulled-dir> [--json out.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--pdfjs');
const jsonAt = args.indexOf('--json');
if (at < 0 || !args[at + 1]) {
  console.error('Usage: node scripts/verify-pdfs.mjs --pdfjs <dir> <pulled-dir> [--json out.json]');
  process.exit(2);
}
const perCalcFooter = args.includes('--footer-per-calc'); // iOS: WebKit repeats no footer, the note closes every calculation block (D75)
const skip = new Set([at, at + 1, ...(jsonAt >= 0 ? [jsonAt, jsonAt + 1] : [])]);
const dirs = args.filter((a, i) => !skip.has(i) && a !== '--footer-per-calc');
const req = createRequire(path.join(path.resolve(args[at + 1]), 'index.js'));
const pdfjs = await import(pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);

const MM = 72 / 25.4;
const dense = (s) => s.replace(/[\s   ]+/g, '');
const PAPER = { A4: [595, 842], Letter: [612, 792] };
const NOTE = { en: 'Calculationaid.', de: 'Rechenhilfe.' };
const VERSION = { en: 'ElectricianToolkit', de: 'ElectricianToolkit' };
const BANNED = ['compliant', 'konform', 'zulässig', 'zulaessig', 'normgerecht', 'vde-gerecht', 'approved', 'certified', 'zertifiziert', 'bestanden', 'passed']; // src/lib/wording.ts (v1.1)
let failures = 0;
const results = [];
const check = (ok, text) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${text}`);
  if (!ok) failures++;
  return ok;
};

async function inspect(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const byteLength = data.length;
  const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  const sizes = new Map();
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [x0, y0, x1, y1] = page.view;
    const W = x1 - x0;
    const H = y1 - y0;
    const content = await page.getTextContent();
    let minX = Infinity, maxX = -Infinity, minTop = Infinity, maxBottom = -Infinity, text = '';
    for (const item of content.items) {
      if (!item.str.trim()) continue;
      text += `${item.str} `;
      const [a, b, , , e, f] = item.transform;
      const size = Math.round(Math.hypot(a, b) * 10) / 10;
      sizes.set(size, (sizes.get(size) ?? 0) + item.str.length);
      minX = Math.min(minX, e);
      maxX = Math.max(maxX, e + item.width);
      minTop = Math.min(minTop, H - (f + size * 0.8));
      maxBottom = Math.max(maxBottom, H - f);
    }
    const ops = await page.getOperatorList();
    const images = ops.fnArray.filter((fn) => fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject).length;
    pages.push({ n, W, H, minX, maxX, top: minTop, bottomGap: H - maxBottom, text, images });
  }
  const dominant = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return { pages, dominant, sizes, bytes: byteLength };
}

for (const dir of dirs) {
  const reportPath = path.join(dir, 'report.json');
  const meta = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  for (const entry of meta.entries) {
    const file = path.join(dir, entry.file);
    console.log(`\n== ${file} (${entry.language}, ${entry.paper}, ${entry.calculations} calculation(s), zoom ${entry.zoom ?? 'production'})`);
    const r = await inspect(file);
    const [pw, ph] = PAPER[entry.paper];
    const first = r.pages[0];
    const topSizes = [...r.sizes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([s, n]) => `${s}pt×${n}`).join(', ');
    console.log(`  pages ${r.pages.length}, bytes ${r.bytes}, font sizes by characters: ${topSizes}`);
    check(r.pages.length === entry.pages, `page count: pdf.js ${r.pages.length}, app counted ${entry.pages}`);
    check(r.pages.every((p) => Math.abs(p.W - pw) < 1.5 && Math.abs(p.H - ph) < 1.5), `every page is ${entry.paper} ${pw} x ${ph} pt (${[...new Set(r.pages.map((p) => `${p.W.toFixed(0)}x${p.H.toFixed(0)}`))].join(', ')})`);
    check(Math.abs(r.dominant - 9.5) < 0.4, `body text prints at the CSS size 9.5 pt (measured ${r.dominant})`);
    const lefts = r.pages.map((p) => p.minX);
    const rights = r.pages.map((p) => p.W - p.maxX);
    const leftMin = Math.min(...lefts), leftMax = Math.max(...lefts), rightMin = Math.min(...rights);
    console.log(`  left text edge ${leftMin.toFixed(1)}..${leftMax.toFixed(1)} pt (CSS 13 mm = ${(13 * MM).toFixed(1)} pt); right gap min ${rightMin.toFixed(1)} pt; top min ${Math.min(...r.pages.map((p) => p.top)).toFixed(1)} pt; bottom gap min ${Math.min(...r.pages.map((p) => p.bottomGap)).toFixed(1)} pt`);
    // list numbers hang in the 5 mm gutter left of the text: the page minimum may be up to 5 mm left of the margin
    check(leftMin > 13 * MM - 5 * MM && leftMax < 13 * MM + 3 && leftMax > 13 * MM - 3, `text starts at the 13 mm margin (list numbers hang up to 5 mm left of it): page minima ${leftMin.toFixed(1)}..${leftMax.toFixed(1)} pt`);
    check(rightMin > 13 * MM - 3, `right text edge inside the 13 mm margin (min gap ${rightMin.toFixed(1)} pt)`);
    const perPage = r.pages.map((p) => ({ note: dense(p.text).includes(NOTE[entry.language]), version: dense(p.text).includes(VERSION[entry.language]) }));
    const noteOn = perPage.filter((p) => p.note).length;
    const versionOn = perPage.filter((p) => p.version).length;
    let footerAll;
    if (perCalcFooter) {
      const occurrences = dense(r.pages.map((p) => p.text).join(' ')).split(NOTE[entry.language]).length - 1;
      footerAll = noteOn === r.pages.length;
      check(occurrences >= entry.calculations && versionOn >= 1, `responsibility note after every calculation (${occurrences} times for ${entry.calculations}), version line ${versionOn}x`);
      console.log(`  INFO  note present on ${noteOn} of ${r.pages.length} pages (L11: no repeating footer in this print engine)`);
    } else {
      footerAll = check(noteOn === r.pages.length && versionOn === r.pages.length, `responsibility note on ${noteOn} of ${r.pages.length} pages, version line on ${versionOn} of ${r.pages.length}`);
    }
    // v1.1 F2 (REVIEW_V1 #2): the note sits under every calculation's checks, so EVERY page showing a verdict line, and
    // page 1, carries it — on both print engines (on iOS, pure continuation pages of working/sources may still lack it, L11)
    const VERDICT = /iswithintheselectedlimit|exceedstheselectedlimit|condition(not)?met|c1ib≤in|c2in≤iz|c3i2≤|liegtinnerhalbdesgewähltengrenzwerts|überschreitetdengewähltengrenzwert|bedingung(nicht)?erfüllt/;
    const verdictPages = r.pages.filter((p) => VERDICT.test(dense(p.text).toLowerCase()));
    const bare = verdictPages.filter((p) => !perPage[p.n - 1].note).map((p) => p.n);
    check(perPage[0].note, 'responsibility note on page 1');
    check(bare.length === 0, `responsibility note on every page with a verdict line (${verdictPages.length - bare.length} of ${verdictPages.length}${bare.length ? `; missing on pages ${bare.join(', ')}` : ''})`);
    console.log(`  PAGES ${r.pages.map((p, i) => `${p.n}:${perPage[i].note ? 'note' : '----'}${VERDICT.test(dense(p.text).toLowerCase()) ? '+verdict' : ''}`).join(' ')}`);
    check(first.images >= 1, `logo image on page 1 (${first.images})`);
    const all = r.pages.map((p) => p.text).join(' ');
    const d = dense(all);
    const lower = all.replace(/https?:\/\/\S+/g, ' ').toLowerCase(); // a cited source's web address is not a verdict (v1.1)
    const dl = d.toLowerCase(); // headings are upper-cased by the CSS
    check(BANNED.every((w) => !lower.includes(w)), `none of the banned verdict words (${BANNED.join(', ')})`);
    if (entry.file.startsWith('single-en')) {
      check(d.includes('Calculationreport') && d.includes('3.76%'), 'EN single: "Calculation report", E1 result 3.76 %');
      check(dl.includes('exceeds') && dl.includes('working') && dl.includes('sources') && dl.includes('assumptions'), 'EN single: exceeds, Working, Assumptions, Sources');
      check(d.includes('notsavedtoaproject'), 'EN single: says "not saved to a project"');
    }
    if (entry.file.startsWith('single-de')) {
      check(d.includes('Berechnungsbericht') && d.includes('3,76%'), 'DE single: "Berechnungsbericht", E1 result 3,76 %');
      check(dl.includes('überschreitet') && dl.includes('rechenweg') && dl.includes('quellen') && dl.includes('annahmen'), 'DE single: überschreitet, Rechenweg, Annahmen, Quellen');
      check(d.includes('Müller,Küche'), 'DE single: umlauts in the project name');
    }
    if (entry.file.startsWith('project30')) {
      const titles = Array.from({ length: 27 }, (_, i) => `Probe${i + 1}—`);
      const missing = titles.filter((t) => !d.includes(t));
      const twice = titles.filter((t) => d.split(t).length - 1 !== 1);
      check(missing.length === 0 && twice.length === 0, `all 27 probe calculations appear exactly once (missing ${missing.length}, repeated ${twice.length})`);
      check(d.includes(entry.language === 'en' ? 'Projectreport' : 'Projektbericht') && d.includes('ElektroMüllerGmbH'), 'project title and company header');
    }
    results.push({ file: entry.file, verdictPages: verdictPages.length, verdictPagesWithoutNote: bare, pages: r.pages.length, bytes: r.bytes, dominantPt: r.dominant, leftMinPt: +leftMin.toFixed(1), leftMaxPt: +leftMax.toFixed(1), rightMinPt: +rightMin.toFixed(1), noteOnPages: noteOn, footerAll });
  }
}
if (jsonAt >= 0) fs.writeFileSync(args[jsonAt + 1], JSON.stringify(results, null, 1));
console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
