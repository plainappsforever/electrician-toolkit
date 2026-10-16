// Development-only print-engine experiments (D75): synthetic multi-page HTML with candidate footer techniques, printed through
// expo-print and kept in Documents/dev-out/ for scripts/verify-pdfs.mjs --exp. Answers "which CSS repeats a footer on every
// page in this print engine, and where does the text land". Not in any release bundle.
import { keepTextForDev as saveText } from './flags';
import { makeReportPdf } from '@/lib/pdf';
import type { PrintMargins } from '@/lib/print-html';

const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `<p class="p">Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog, again and again, so that this line wraps over the full text width of the page and the page count grows steadily.</p>`).join('\n');
const NOTE = '<div class="note">FOOTER NOTE: calculation aid, not an approval. Electrician Toolkit 1.0.0</div>';
const BASE = 'html,body{margin:0;padding:0}body{font-family:Helvetica,Arial,sans-serif;font-size:9.5pt;line-height:1.35}.p{margin:0 0 3mm}.note{font-size:7.5pt;border-top:1px solid #888;padding-top:2mm}';

export const CASES: Record<string, { html: string; margins?: PrintMargins; zoom?: number }> = {
  // A: fixed footer, no margins: does WebKit repeat it on every page?
  'fixed-a': { html: `<html><head><style>@page{size:A4;margin:0}${BASE}body{padding:0 13mm}.note{position:fixed;left:13mm;right:13mm;bottom:6mm}</style></head><body>${paragraphs(60)}${NOTE}</body></html>` },
  // B: fixed footer + native bottom margin 70 pt; footer inside the content box
  'fixed-b': { html: `<html><head><style>@page{size:A4;margin:0}${BASE}.note{position:fixed;left:0;right:0;bottom:0}</style></head><body>${paragraphs(60)}${NOTE}</body></html>`, margins: { left: 37, right: 37, top: 31, bottom: 70 } },
  // C: fixed footer pushed into the native bottom margin
  'fixed-c': { html: `<html><head><style>@page{size:A4;margin:0}${BASE}.note{position:fixed;left:0;right:0;bottom:-55pt}</style></head><body>${paragraphs(60)}${NOTE}</body></html>`, margins: { left: 37, right: 37, top: 31, bottom: 70 } },
  // D: native margins only, table footer (does tfoot repeat with margins?)
  'tfoot-d': { html: `<html><head><style>@page{size:A4;margin:0}${BASE}table{width:100%;border-collapse:collapse}</style></head><body><table><tfoot><tr><td>${NOTE}</td></tr></tfoot><tbody><tr><td>${paragraphs(60)}</td></tr></tbody></table></body></html>`, margins: { left: 37, right: 37, top: 31, bottom: 70 } },
};

export async function runPdfExperiment(names: string[], zoom: number | null): Promise<string[]> {
  const out: string[] = [];
  for (const name of names) {
    const c = CASES[name];
    if (!c) {
      out.push(`${name}: unknown`);
      continue;
    }
    const pdf = await makeReportPdf(c.html, 'A4', `exp-${name}.pdf`, undefined, zoom ?? c.zoom, c.margins);
    out.push(`${name}: ${pdf.pages} pages, ${pdf.bytes} bytes`);
  }
  saveText(JSON.stringify({ names, zoom }), 'exp-report.json');
  return out;
}
