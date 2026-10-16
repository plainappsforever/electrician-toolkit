// Report HTML (SPEC §12, D24, D44): a pure string builder for one calculation or a whole project; P6 prints it with
// expo-print. Every result shows its inputs, formula lines with numbers, assumptions (defaults marked), checks against the
// limits the user selected, and sources with licence status; the responsibility note sits under every calculation's checks
// (v1.1 F2) and in the page footer (repeated on every page by Chromium/Android; once per block on iOS, D75). Saved
// calculations are rendered from their stored snapshot — nothing is recomputed (D20). All dynamic text is escaped; the
// logo is accepted only as a base64 PNG/JPEG data URI. No Date.now(): `generatedAt` is passed in, same input → same string.
import { LOGO_DATA_URI, type Company, type Paper } from '@/db/settings';
import type { StoredCalculation } from '@/db/calculations';
import { ENGINE_VERSION, EU_DE, SOURCES, usedInput, type CalcKind, type CalcResult, type Source, type Unit, type Vars } from '@/engine';
import { isMessageKey, type NumberFormatter } from '@/engine/explain';
import { flattenInput, headlineValues, valueLabelKey } from '@/lib/calc-summary';
import { translate, type Language, type MessageKey } from '@/i18n';

import { displayText, formatDate, formatNumber, formatValue } from './format';
import { SIGNATURE_SVG } from './signature';

export type { Paper };

/** Page sizes in PostScript points for `printToFileAsync({ width, height })`. */
export const PAPER_POINTS: Record<Paper, { width: number; height: number }> = {
  A4: { width: 595, height: 842 },
  Letter: { width: 612, height: 792 },
};

/** OWNER WORDING: the responsibility note (SPEC §15, D16) is a draft in `note.responsibility`; the owner decides the text. */
export const RESPONSIBILITY_NOTE_STATUS = 'OWNER WORDING';

export type ReportContext = {
  language: Language;
  paper: Paper;
  company: Company;
  /** `data:image/png|jpeg;base64,…` or null. Anything else is ignored. */
  logoDataUri: string | null;
  /** Epoch ms of the report ("Created …"). */
  generatedAt: number;
  appVersion: string;
};
export type ReportProject = { name: string; client: string; site: string; notes: string };

/** A photo for the report (V1.5 A, NW1): a JPEG data URI (the device glue reads and, for print, downscales the file). */
export type ReportPhoto = { dataUri: string; caption: string; owner: 'project' | 'circuit' | 'calculation'; ownerLabel: string };
/** One signature slot (FL129: who prepared / who received the document; never a certification, D16). */
export type ReportSignature = { role: 'prepared' | 'received'; name: string; place: string; date: number | null; svg: string | null };
/** Optional parts after the calculations. Absent or empty → the document is byte-identical to v1.1 (golden reports, D64). */
export type ReportExtras = { photos?: ReportPhoto[]; signatures?: ReportSignature[] };

const JPEG_DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;
export type ReportCircuit = { label: string; notes: string; calculations: StoredCalculation[] };

export const esc = (value: unknown): string =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

type Fmt = { lang: Language; tr: (key: MessageKey, params?: Record<string, string | number>) => string; num: NumberFormatter };

function makeFmt(lang: Language): Fmt {
  return { lang, tr: (key, params) => translate(lang, key, params), num: formatNumber };
}

/** displayText() (D52) that never throws on a stored item of an unexpected shape: falls back to the key. */
function say(item: { key: string; vars: Vars; met?: unknown }, f: Fmt): string {
  try {
    return displayText(item, f.lang);
  } catch {
    return String(item.key);
  }
}

const CALC_LABEL: Record<CalcKind, MessageKey> = {
  vdrop: 'calc.vdrop',
  current: 'calc.current',
  ohm: 'calc.ohm',
  coord: 'calc.coord',
  loop: 'calc.loop',
  resistance: 'calc.resistance',
  convert: 'calc.convert',
};

// ---------------------------------------------------------------- inputs table

const INPUT_FIELDS: Record<string, { key: MessageKey; unit: Unit }> = {
  voltage: { key: 'field.voltage', unit: 'V' },
  current: { key: 'field.current', unit: 'A' },
  power: { key: 'field.power', unit: 'W' },
  resistance: { key: 'field.resistance', unit: 'Ω' },
  efficiency: { key: 'field.efficiency', unit: '' },
  parallel: { key: 'field.parallel', unit: '' },
  cosPhi: { key: 'field.cosPhi', unit: '' },
  conductorTempC: { key: 'field.conductorTemp', unit: '°C' },
  reactanceOhmPerM: { key: 'field.reactance', unit: 'Ω/m' },
  kappa: { key: 'field.kappa', unit: 'm/(Ω·mm²)' },
  limitPercent: { key: 'field.limit', unit: '%' },
  ib: { key: 'field.ib', unit: 'A' },
  izTyped: { key: 'field.iz', unit: 'A' },
  insulationMaxC: { key: 'field.insulationMax', unit: '°C' },
  referenceAmbientC: { key: 'field.referenceAmbient', unit: '°C' },
  ambientC: { key: 'field.ambient', unit: '°C' },
  fTheta: { key: 'field.fTheta', unit: '' },
  fGroup: { key: 'field.fGroup', unit: '' },
  fOther: { key: 'field.fOther', unit: '' },
  u0: { key: 'field.u0', unit: 'V' },
  ze: { key: 'field.ze', unit: 'Ω' },
  cmin: { key: 'field.cmin', unit: '' },
  loopTempC: { key: 'field.loopTemp', unit: '°C' },
  zsMeasured: { key: 'field.zsMeasured', unit: 'Ω' },
  measuredFactor: { key: 'field.measuredFactor', unit: '' },
  temperatureC: { key: 'field.temperature', unit: '°C' },
};
const SIZE_FIELDS: Record<string, MessageKey> = { size: 'field.size', lineSize: 'field.lineSize', peSize: 'field.peSize' };
const ENUM_FIELDS: Record<string, { key: MessageKey; prefix: string }> = {
  system: { key: 'field.system', prefix: 'system.' },
  material: { key: 'field.material', prefix: 'material.' },
  method: { key: 'field.method', prefix: 'method.' },
  insulation: { key: 'field.insulation', prefix: 'insulation.' },
  mode: { key: 'field.mode', prefix: 'mode.' },
  limitPreset: { key: 'field.limitPreset', prefix: 'limit.' },
};
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Label/value pairs of a stored input, translated and rounded for display (D22). Only the fields the engine used are
 * listed (D53, `usedInput`): a DC calculation never shows a stale cos φ, η or X', whatever the stored record holds.
 */
export function describeInput(kind: CalcKind, stored: unknown, f: Fmt): { label: string; value: string }[] {
  const input = usedInput(kind, stored);
  if (!isObj(input)) return [];
  const rows: { label: string; value: string }[] = [];
  for (const [name, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    const plain = INPUT_FIELDS[name];
    const size = SIZE_FIELDS[name];
    const en = ENUM_FIELDS[name];
    if (kind === 'convert' && name === 'from') {
      rows.push({ label: f.tr('field.from'), value: String(v) });
    } else if (kind === 'convert' && name === 'value' && isNum(v)) {
      const unit = ({ awg: 'AWG', mm2: 'mm²', kcmil: 'kcmil', ft: 'ft', m: 'm' } as Record<string, Unit>)[String(input.from)] ?? '';
      rows.push({ label: f.tr('field.value'), value: f.num(v, unit, f.lang) });
    } else if (plain && isNum(v)) {
      rows.push({ label: f.tr(plain.key), value: f.num(v, plain.unit, f.lang) });
    } else if (name === 'length' && isObj(v) && isNum(v.value)) {
      rows.push({ label: f.tr('field.length'), value: f.num(v.value, v.unit === 'ft' ? 'ft' : 'm', f.lang) });
    } else if (size && isObj(v) && isNum(v.value)) {
      const unit: Unit = v.unit === 'awg' ? 'AWG' : v.unit === 'kcmil' ? 'kcmil' : 'mm²';
      rows.push({ label: f.tr(size), value: f.num(v.value, unit, f.lang) });
    } else if (en && typeof v === 'string') {
      const key = `${en.prefix}${v}`;
      rows.push({ label: f.tr(en.key), value: isMessageKey(key) ? f.tr(key) : v });
    } else if (name === 'device' && isObj(v)) {
      rows.push({ label: f.tr('field.device'), value: describeDevice(v, f) });
    } else if (name === 'table' && isObj(v) && isNum(v.izA)) {
      const num = (x: unknown, unit: Unit) => (isNum(x) ? f.num(x, unit, f.lang) : '–');
      rows.push({
        label: f.tr('field.iz'),
        value: f.tr('report.userTable', {
          name: typeof v.tableName === 'string' ? v.tableName : '–',
          size: num(v.sizeMm2, 'mm²'),
          iz: num(v.izA, 'A'),
          max: num(v.insulationMaxC, '°C'),
          ref: num(v.referenceAmbientC, '°C'),
          // v1.1 F8: material, method label and loaded conductors when the snapshot has them (older ones do not)
          details: [
            v.material === 'cu' || v.material === 'al' ? f.tr(`material.${v.material}`) : '',
            typeof v.methodLabel === 'string' && v.methodLabel.trim() !== '' ? f.tr('report.methodLabel', { label: v.methodLabel.trim() }) : '',
            v.loadedConductors === 2 || v.loadedConductors === 3 ? f.tr('report.loadedConductors', { n: v.loadedConductors }) : '',
          ]
            .filter((x) => x !== '')
            .map((x) => `, ${x}`)
            .join(''),
          note: typeof v.sourceNote === 'string' ? v.sourceNote : '–',
        }),
      });
    } else {
      rows.push({ label: name, value: flattenInput(v) || String(v) });
    }
  }
  return rows;
}

function describeDevice(d: Record<string, unknown>, f: Fmt): string {
  if (d.type === 'mcb' && typeof d.curve === 'string' && isNum(d.ratedCurrent)) return `${d.curve}${d.ratedCurrent}`;
  const parts: string[] = [];
  if (isNum(d.ratedCurrent)) parts.push(`In ${f.num(d.ratedCurrent, 'A', f.lang)}`);
  if (isNum(d.i2)) parts.push(`I2 ${f.num(d.i2, 'A', f.lang)}`);
  if (isNum(d.ia)) parts.push(`Ia ${f.num(d.ia, 'A', f.lang)}`);
  return parts.length ? `${f.tr('device.other')} (${parts.join(', ')})` : f.tr('device.other');
}

// ---------------------------------------------------------------- blocks

const lookupSource = (id: string): Source | undefined =>
  Object.prototype.hasOwnProperty.call(SOURCES, id) ? (SOURCES as Record<string, Source>)[id] : undefined;

/** The registry texts in the report language (D58): German report → German titles, clauses and notes. */
function sourceTexts(s: Source, lang: Language): { standard: string; clause: string; unconfirmed?: string } {
  return lang === 'de' && s.de ? { standard: s.de.standard, clause: s.de.clause, unconfirmed: s.unconfirmed ? (s.de.unconfirmed ?? s.unconfirmed) : undefined } : s;
}

function sourceLine(id: string, f: Fmt): string {
  const s = lookupSource(id);
  if (!s) return `<li>${esc(id)}</li>`;
  const t = sourceTexts(s, f.lang);
  const licence = f.tr(`report.licence.${s.licence}` as MessageKey);
  const edition = s.edition && s.edition !== '—' ? `, ${esc(s.edition)}` : '';
  const unconfirmed = t.unconfirmed ? `<div class="small">${esc(f.tr('report.unconfirmed', { note: t.unconfirmed }))}</div>` : '';
  const url = s.publicUrl ? `<div class="small url">${esc(s.publicUrl)}</div>` : '';
  return `<li><b>${esc(t.standard)}</b>${edition}<br>${esc(t.clause)}<br><span class="badge ${s.licence === 'public' ? 'pub' : 'lic'}">${esc(licence)}</span>${url}${unconfirmed}</li>`;
}

function sourceName(id: string, lang: Language): string {
  const s = lookupSource(id);
  return s ? sourceTexts(s, lang).standard : id;
}

const list = (x: unknown): { key: string; vars: Vars; [k: string]: unknown }[] =>
  Array.isArray(x) ? x.filter((i): i is { key: string; vars: Vars } => isObj(i) && typeof i.key === 'string') : [];

function calcBlock(c: StoredCalculation, f: Fmt, level: 'h2' | 'h3'): string {
  const label = f.tr(CALC_LABEL[c.kind] ?? 'calc.vdrop');
  const heading = c.title.trim() !== '' ? `${c.title} — ${label}` : label;
  const head = `<${level}>${esc(heading)}</${level}>`;
  const meta = `<div class="small">${esc(
    // a history entry was computed, not saved (review #19)
    f.tr(c.projectId === null ? 'report.computedWith.history' : 'report.computedWith', { engine: c.engineVersion, profile: c.profileId, pv: c.profileVersion, date: formatDate(c.createdAt, f.lang) })
  )}</div>`;
  const note = c.note.trim() !== '' ? `<p class="user">${esc(c.note)}</p>` : '';
  const r: CalcResult | null = isObj(c.result) ? c.result : null;
  // v1.1 F2 (REVIEW_V1 #2, #26): the responsibility note sits directly under the checks of every calculation, on both
  // print engines, so every page that shows a verdict (page 1 included) shows the note; a damaged record prints it too.
  const checksNote = `<p class="checks-note">${esc(f.tr('note.responsibility'))}</p>`;
  if (!r) return `<section class="calc">${head}${meta}${note}<p class="warn">${esc(f.tr('report.damaged'))}</p>${checksNote}</section>`;

  const h = (key: MessageKey) => `<h4>${esc(f.tr(key))}</h4>`;
  // the suggested rating prints once, as the device text row below (scoped, v1.1 F6), not also as a bare number
  const results = headlineValues(c.kind, r).filter((v) => v.name !== 'suggestedIn').map((v) => {
    const k = valueLabelKey(c.kind, v.name, isMessageKey);
    const name = isMessageKey(k) ? f.tr(k) : v.name;
    return `<tr><th>${esc(name)}</th><td class="num">${esc(formatValue(v.name, v.value, v.unit as Unit, f.lang))}</td></tr>`;
  });
  const texts = isObj(r.texts) ? r.texts : {};
  if (typeof texts.minSize === 'string' && texts.minSize.startsWith('AWG')) results.push(`<tr><th>${esc(f.tr('report.minSize'))}</th><td class="num">${esc(texts.minSize)}</td></tr>`);
  // v1.1 F6: when the user's own device meets C1–C3 the suggestion is a secondary line, scoped to overload protection
  if (typeof texts.suggestion === 'string') results.push(`<tr><th>${esc(f.tr(texts.verdict === 'met' ? 'report.suggestion.secondary' : 'report.suggestion'))}</th><td class="num">${esc(texts.suggestion)}</td></tr>`);
  const resultsHtml = results.length ? `<div class="keep">${h('report.results')}<table class="kv">${results.join('')}</table></div>` : '';

  const checks = list(r.checks).map((ch) => `<li>${esc(say(ch, f))}${typeof ch.source === 'string' ? ` <span class="small">[${esc(sourceName(ch.source, f.lang))}]</span>` : ''}</li>`);
  const warnings = list(r.warnings).map((w) => `<li>${esc(say(w, f))}</li>`);
  const checksHtml = checks.length ? `<div class="keep">${h('report.checks')}<ul>${checks.join('')}</ul>` : '';
  const warningsHtml = warnings.length ? `<div class="keep">${h('report.warnings')}<ul class="warn">${warnings.join('')}</ul></div>` : '';
  // checks, warnings and the note form one unbreakable group: a verdict line never sits on a page without the note
  const verdictHtml = checks.length ? `${checksHtml}${warningsHtml}${checksNote}</div>` : `${warningsHtml}${checksNote}`;

  const inputs = describeInput(c.kind, c.input, f).map((i) => `<tr><th>${esc(i.label)}</th><td>${esc(i.value)}</td></tr>`);
  const inputsHtml = inputs.length ? `<div class="keep">${h('report.inputs')}<table class="kv">${inputs.join('')}</table></div>` : '';

  const assumptions = list(r.assumptions).map(
    (a) => `<li>${esc(say(a, f))}${a.isDefault === true ? ` <span class="small">${esc(f.tr('report.default'))}</span>` : ''}</li>`
  );
  const assumptionsHtml = assumptions.length ? `<div class="keep">${h('report.assumptions')}<ul>${assumptions.join('')}</ul></div>` : '';
  const steps = list(r.steps).map((s) => `<li>${esc(say(s, f))}</li>`);
  const stepsHtml = steps.length ? `<div>${h('report.working')}<ol class="steps">${steps.join('')}</ol></div>` : '';

  const ids = Array.isArray(r.sources) ? (r.sources as unknown[]).filter((s): s is string => typeof s === 'string') : [];
  const sourcesHtml = ids.length ? `<div>${h('report.sources')}<ul class="sources">${ids.map((id) => sourceLine(id, f)).join('')}</ul></div>` : '';

  // `.calc-note` is hidden unless the print profile shows it (src/lib/print-html.ts): iOS WebKit repeats no footer on later
  // pages, so there the responsibility note closes every calculation block instead (D75).
  const closing = `<p class="calc-note">${esc(f.tr('note.responsibility'))}</p>`;
  return `<section class="calc">${head}${meta}${note}${resultsHtml}${verdictHtml}${inputsHtml}${assumptionsHtml}${stepsHtml}${sourcesHtml}${closing}</section>`;
}

// ---------------------------------------------------------------- page

const CSS = (paper: Paper) => `
@page { size: ${paper === 'Letter' ? 'Letter' : 'A4'}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 9.5pt; line-height: 1.35; color: #111; padding: 0 13mm; }
table.page { width: 100%; border-collapse: collapse; }
table.page > thead > tr > td, table.page > tfoot > tr > td, table.page > tbody > tr > td { padding: 0; }
.top-space { height: 11mm; }
.foot { border-top: 1px solid #888; margin-top: 4mm; padding: 2mm 0 9mm; font-size: 7.5pt; color: #333; }
.foot p { margin: 0 0 1mm; }
.letterhead { display: flex; justify-content: space-between; align-items: flex-start; gap: 8mm; border-bottom: 2px solid #111; padding-bottom: 3mm; margin-bottom: 4mm; }
.letterhead img { max-height: 18mm; max-width: 55mm; }
.company { text-align: right; font-size: 8.5pt; white-space: pre-line; }
.company b { font-size: 11pt; }
h1 { font-size: 16pt; margin: 0 0 2mm; }
h2 { font-size: 12.5pt; margin: 6mm 0 2mm; border-bottom: 1px solid #bbb; padding-bottom: 1mm; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 4mm 0 1mm; break-after: avoid; page-break-after: avoid; }
h4 { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.04em; color: #444; margin: 3mm 0 1mm; break-after: avoid; page-break-after: avoid; }
.small { font-size: 8pt; color: #444; }
.url { word-break: break-all; }
.user, .multiline { white-space: pre-line; }
table.kv { border-collapse: collapse; width: 100%; }
table.kv th, table.kv td { text-align: left; vertical-align: top; padding: 0.8mm 2mm 0.8mm 0; border-bottom: 1px solid #e3e3e3; }
table.kv th { font-weight: 600; width: 46%; }
table.kv td.num { font-variant-numeric: tabular-nums; }
tr, li { break-inside: avoid; page-break-inside: avoid; }
ul, ol { margin: 0; padding-left: 5mm; }
ol.steps li { margin-bottom: 1mm; font-variant-numeric: tabular-nums; }
ul.sources { list-style: none; padding-left: 0; }
ul.sources li { margin-bottom: 1.5mm; }
.badge { display: inline-block; font-size: 7.5pt; padding: 0 1.5mm; border: 1px solid #777; border-radius: 2mm; }
.badge.lic { background: #f1f1f1; }
.warn { color: #7a3b00; }
section.calc { margin-bottom: 4mm; }
.calc-note { display: none; margin: 2mm 0 0; padding-top: 1mm; border-top: 1px solid #bbb; font-size: 7.5pt; color: #333; }
.checks-note { margin: 1.5mm 0 0; padding: 1mm 0 0; border-top: 1px dotted #999; font-size: 7.5pt; color: #333; }
.keep { break-inside: avoid; page-break-inside: avoid; }
.circuit { margin-top: 3mm; }
`;

function letterhead(ctx: ReportContext): string {
  const c = ctx.company;
  const logo = ctx.logoDataUri !== null && LOGO_DATA_URI.test(ctx.logoDataUri) ? `<img src="${esc(ctx.logoDataUri)}" alt="">` : '';
  const lines = [c.address, [c.phone, c.email].filter((x) => x.trim() !== '').join(' · '), c.regNo].filter((x) => x.trim() !== '');
  const name = c.name.trim() !== '' ? `<b>${esc(c.name)}</b>\n` : '';
  const company = name || lines.length ? `<div class="company">${name}${esc(lines.join('\n'))}</div>` : '<div></div>';
  return `<div class="letterhead"><div>${logo}</div>${company}</div>`;
}

function page(title: string, body: string, f: Fmt, ctx: ReportContext, extraCss = ''): string {
  const note = f.tr('note.responsibility');
  const versions = f.tr('report.versions', { app: ctx.appVersion, engine: ENGINE_VERSION, profile: `${EU_DE.id} v${EU_DE.version}` });
  // The note sits in a table footer: it repeats at the bottom of every printed page and reserves its space (D44).
  return `<!DOCTYPE html>
<html lang="${f.lang}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS(ctx.paper)}</style>${extraCss === '' ? '' : `<style>${extraCss}</style>`}</head>
<body>
<table class="page">
<thead><tr><td><div class="top-space"></div></td></tr></thead>
<tfoot><tr><td><div class="foot">
<!-- ${RESPONSIBILITY_NOTE_STATUS}: draft wording of the responsibility note (SPEC §15); the owner decides the final text. -->
<p class="resp-note">${esc(note)}</p>
<p>${esc(versions)}</p>
</div></td></tr></tfoot>
<tbody><tr><td>
${letterhead(ctx)}
${body}
</td></tr></tbody>
</table>
</body></html>
`;
}

// ---------------------------------------------------------------- photos and signatures (V1.5 A)

const EXTRAS_CSS = `
.photos { margin-top: 4mm; font-size: 0; }
.photos figure { display: inline-block; vertical-align: top; width: 49%; margin: 0 0 3mm; padding: 0 1mm; box-sizing: border-box; break-inside: avoid; page-break-inside: avoid; font-size: 8pt; }
.photos img { display: block; width: 100%; height: 62mm; object-fit: contain; background: #f2f2f2; border: 1px solid #ccc; }
.photos figcaption { margin-top: 1mm; color: #333; white-space: pre-line; }
.photos .owner { color: #666; }
.signatures { margin-top: 6mm; break-inside: avoid; page-break-inside: avoid; }
.signatures .slot { display: inline-block; vertical-align: top; width: 48%; margin-right: 2%; }
.signatures .ink { height: 20mm; border-bottom: 1px solid #111; display: flex; align-items: flex-end; }
.signatures .ink svg { max-height: 19mm; max-width: 100%; width: auto; height: auto; }
.signatures .who { margin-top: 1mm; font-size: 8.5pt; }
`;

function photosBlock(photos: readonly ReportPhoto[], f: Fmt): string {
  const ok = photos.filter((p) => JPEG_DATA_URI.test(p.dataUri));
  if (ok.length === 0) return '';
  const owner = (p: ReportPhoto) =>
    p.owner === 'project' ? f.tr('report.photos.ofProject') : f.tr(p.owner === 'circuit' ? 'report.photos.ofCircuit' : 'report.photos.ofCalculation', { label: p.ownerLabel });
  const figures = ok.map(
    (p) => `<figure><img src="${p.dataUri}" alt=""><figcaption><span class="owner">${esc(owner(p))}</span>${p.caption.trim() !== '' ? `\n${esc(p.caption.trim())}` : ''}</figcaption></figure>`
  );
  return `<h2>${esc(f.tr('report.photos'))}</h2><div class="photos">${figures.join('')}</div>`;
}

function signaturesBlock(slots: readonly ReportSignature[], f: Fmt): string {
  if (slots.length === 0) return '';
  const slot = (s: ReportSignature) => {
    const ink = s.svg !== null && SIGNATURE_SVG.test(s.svg) ? s.svg : '';
    const who = [s.name.trim(), [s.place.trim(), s.date === null ? '' : formatDate(s.date, f.lang)].filter((x) => x !== '').join(', ')].filter((x) => x !== '');
    return `<div class="slot"><h4>${esc(f.tr(s.role === 'prepared' ? 'report.signature.prepared' : 'report.signature.received'))}</h4><div class="ink">${ink}</div><div class="who">${esc(who.join(' · ') || f.tr('report.signature.blank'))}</div></div>`;
  };
  return `<div class="signatures">${slots.map(slot).join('')}<p class="small">${esc(f.tr('report.signature.note'))}</p></div>`;
}

function extrasHtml(extras: ReportExtras | undefined, f: Fmt): { html: string; css: string } {
  const html = photosBlock(extras?.photos ?? [], f) + signaturesBlock(extras?.signatures ?? [], f);
  return html === '' ? { html: '', css: '' } : { html, css: EXTRAS_CSS };
}

function projectHeader(p: ReportProject, f: Fmt, ctx: ReportContext): string {
  const rows: [MessageKey, string][] = [['report.project', p.name]];
  if (p.client.trim() !== '') rows.push(['report.client', p.client]);
  if (p.site.trim() !== '') rows.push(['report.site', p.site]);
  rows.push(['report.date', formatDate(ctx.generatedAt, f.lang)]);
  const table = `<table class="kv">${rows.map(([k, v]) => `<tr><th>${esc(f.tr(k))}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
  const notes = p.notes.trim() !== '' ? `<h4>${esc(f.tr('report.notes'))}</h4><p class="multiline">${esc(p.notes)}</p>` : '';
  return `${table}${notes}`;
}

/** One saved (or history) calculation as a document. `project` adds the project/client/site header when it belongs to one. */
export function buildCalculationReport(calc: StoredCalculation, ctx: ReportContext, project?: ReportProject, extras?: ReportExtras): string {
  const f = makeFmt(ctx.language);
  const title = f.tr('report.title.calculation');
  const header = project ? projectHeader(project, f, ctx) : `<table class="kv"><tr><th>${esc(f.tr('report.date'))}</th><td>${esc(formatDate(ctx.generatedAt, f.lang))}</td></tr></table>`;
  const x = extrasHtml(extras, f);
  return page(`${title} — ${calc.title || f.tr(CALC_LABEL[calc.kind] ?? 'calc.vdrop')}`, `<h1>${esc(title)}</h1>${header}${calcBlock(calc, f, 'h2')}${x.html}`, f, ctx, x.css);
}

/** A project: circuits in order, each with its saved calculations; calculations without a circuit come first. */
export function buildProjectReport(project: ReportProject, circuits: ReportCircuit[], projectLevel: StoredCalculation[], ctx: ReportContext, extras?: ReportExtras): string {
  const f = makeFmt(ctx.language);
  const title = f.tr('report.title.project');
  const parts: string[] = [`<h1>${esc(title)}</h1>`, projectHeader(project, f, ctx)];
  let any = false;
  if (projectLevel.length > 0) {
    any = true;
    parts.push(`<div class="circuit"><h2>${esc(f.tr('report.noCircuit'))}</h2>${projectLevel.map((c) => calcBlock(c, f, 'h3')).join('')}</div>`);
  }
  for (const circuit of circuits) {
    if (circuit.calculations.length === 0) continue;
    any = true;
    const notes = circuit.notes.trim() !== '' ? `<p class="multiline small">${esc(circuit.notes)}</p>` : '';
    parts.push(`<div class="circuit"><h2>${esc(`${f.tr('report.circuit')}: ${circuit.label}`)}</h2>${notes}${circuit.calculations.map((c) => calcBlock(c, f, 'h3')).join('')}</div>`);
  }
  // an empty project still carries the note in the body (the iPhone print engine shows no footer note, review #26)
  if (!any) parts.push(`<p>${esc(f.tr('report.empty'))}</p><p class="checks-note">${esc(f.tr('note.responsibility'))}</p>`);
  const x = extrasHtml(extras, f);
  if (x.html !== '') parts.push(x.html);
  return page(`${title} — ${project.name}`, parts.join('\n'), f, ctx, x.css);
}
