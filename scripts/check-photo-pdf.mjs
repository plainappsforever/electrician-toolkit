#!/usr/bin/env node
// Re-reads report PDFs with photos and sign-off slots with pdf.js (V1.5 phase A, docs/V15_LOG.md A6) — an independent
// reader, not the code that wrote them. The PDFs come from test/gen/photo-report.gen.ts (HTML) rendered by
// scripts/html-to-pdf.swift (macOS WebKit) or, in the device phase, from a phone/simulator. Per file (manifest.json from
// the generator): paper size; every photo painted exactly once (a picture cut by a page break is painted twice), fully
// inside the page and its top/bottom margins; every caption and both sign-off labels in the text; the two sign-off slots
// on one page with the drawn signature as curves on it; the responsibility note; no banned verdict word outside it.
// pdf.js is NOT a project dependency: install it anywhere and pass its folder (as for scripts/verify-pdfs.mjs).
// Usage: node scripts/check-photo-pdf.mjs --pdfjs <dir with node_modules/pdfjs-dist> <dir with manifest.json + PDFs> [--margin 31]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const at = args.indexOf('--pdfjs');
const mAt = args.indexOf('--margin');
if (at < 0 || !args[at + 1]) {
  console.error('Usage: node scripts/check-photo-pdf.mjs --pdfjs <dir> <dir> [--margin 31]');
  process.exit(2);
}
// expo-print gives iOS 31 pt top/bottom margins; macOS WebKit printing ignores them (measured: text 8 pt from the edge), so
// the device-free run checks against the page edge (--margin 0) and the device phase uses --margin 31
const margin = mAt >= 0 ? Number(args[mAt + 1]) : 31;
const skip = new Set([at, at + 1, ...(mAt >= 0 ? [mAt, mAt + 1] : [])]);
const dir = args.find((a, i) => !skip.has(i));
const req = createRequire(path.join(path.resolve(args[at + 1]), 'index.js'));
const pdfjs = await import(pathToFileURL(req.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const OPS = pdfjs.OPS;
const BANNED = ['compliant', 'konform', 'zulässig', 'zulaessig', 'normgerecht', 'vde-gerecht', 'approved', 'certified', 'zertifiziert', 'bestanden', 'passed']; // src/lib/wording.ts
const NOTE = { en: 'Calculation aid.', de: 'Rechenhilfe.' };
const dense = (s) => s.replace(/[\s\u00a0\u202f]+/g, '').toLowerCase(); // h4 labels print upper case (report CSS)
let failures = 0;
const check = (ok, text) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${text}`);
  if (!ok) failures++;
};
const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** Image boxes (page coordinates) and curve segments of one page, walking the operator list with the CTM stack. */
async function walk(page) {
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const images = [];
  let curves = 0;
  ops.fnArray.forEach((fn, i) => {
    const a = ops.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
    else if (fn === OPS.transform) ctm = mul(ctm, a);
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      images.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    } else if (fn === OPS.constructPath) {
      // pdf.js 5/6: [paintOp, [path], minMax]; path ops: 0 moveTo(2) 1 lineTo(2) 2 curveTo(6) 3 quadraticCurveTo(4) 4 closePath(0)
      const data = a?.[1]?.[0];
      if (!data) return;
      const d = Array.from(Object.values(data));
      for (let k = 0; k < d.length; ) {
        const op = d[k];
        if (op === 2 || op === 3) curves++;
        k += 1 + ({ 0: 2, 1: 2, 2: 6, 3: 4, 4: 0 }[op] ?? 0);
      }
    }
  });
  return { images, curves };
}

const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
for (const m of manifest) {
  const file = path.join(dir, `${m.name}.pdf`);
  console.log(`${m.name}.pdf`);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const [, , W, H] = page.view;
    const text = (await page.getTextContent()).items.map((i) => i.str).join(' ');
    pages.push({ n, W, H, text, ...(await walk(page)) });
  }
  check(pages.every((p) => Math.abs(p.W - m.size.width) < 1.5 && Math.abs(p.H - m.size.height) < 1.5), `${m.paper} ${m.size.width} x ${m.size.height} pt on all ${pages.length} pages`);
  const images = pages.flatMap((p) => p.images.map((b) => ({ ...b, page: p.n, W: p.W, H: p.H })));
  check(images.length === m.photos, `${m.photos} photos painted, each exactly once (found ${images.length})`);
  const inside = images.every((b) => b.x0 >= 10 && b.x1 <= b.W - 10 && b.y0 >= margin - 1.5 && b.y1 <= b.H - margin + 1.5);
  check(inside, `every photo inside the page and its ${margin} pt top/bottom margins`);
  if (!inside) for (const b of images) console.log(`    page ${b.page}: x ${b.x0.toFixed(1)}–${b.x1.toFixed(1)}, y ${b.y0.toFixed(1)}–${b.y1.toFixed(1)}`);
  const minW = Math.min(...images.map((b) => b.x1 - b.x0));
  check(images.length === 0 || minW > 100, `photos are printed large enough (smallest box ${minW.toFixed(0)} pt wide)`);
  const all = dense(pages.map((p) => p.text).join(' '));
  const missing = m.captions.filter((c) => !all.includes(dense(c)));
  check(missing.length === 0, `all ${m.captions.length} captions in the text${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);
  const sigPages = pages.filter((p) => m.signature.every((l) => dense(p.text).includes(dense(l))));
  check(sigPages.length === 1, `both sign-off slots on one page (page ${sigPages.map((p) => p.n).join(',') || '-'})`);
  check(sigPages.length === 1 && sigPages[0].curves >= 20, `the drawn signature is on that page as curves (${sigPages[0]?.curves ?? 0} curve segments)`);
  check(all.includes(dense(NOTE[m.language])), 'responsibility note present');
  const lower = all.toLowerCase().split(dense(NOTE[m.language]).toLowerCase()).map((part, i) => (i === 0 ? part : part.slice(300))).join(' ');
  const banned = BANNED.filter((w) => lower.includes(w));
  check(banned.length === 0, `no banned verdict word outside the note${banned.length ? ` (${banned.join(', ')})` : ''}`);
  console.log(`  info  ${pages.length} pages, photos on pages ${[...new Set(images.map((b) => b.page))].join(',')}, ${fs.statSync(file).size} bytes`);
}
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
