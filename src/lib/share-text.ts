// One result as plain text for the share sheet / clipboard (V1.5 phase A, NW3; Mike Holt 1-star review: "can't email the
// information"). The same content rules as the PDF (D16, D52, D53): the headline values with the display rounding,
// every check against the limit the user selected, warnings, only the inputs the engine used, the responsibility note
// and the versions. Never a verdict word (A4 test). PURE: the screen passes the text to expo-clipboard / the share sheet.
import type { StoredCalculation } from '@/db/calculations';
import { ENGINE_VERSION, EU_DE, type CalcResult, type Unit, type Vars } from '@/engine';
import { isMessageKey } from '@/engine/explain';
import { headlineValues, valueLabelKey } from '@/lib/calc-summary';
import { KIND_TITLE } from '@/lib/kinds';
import { translate, type Language, type MessageKey } from '@/i18n';

import { displayText, formatDate, formatNumber, formatValue } from './format';
import { describeInput } from './report-html';

export type SharedText = { subject: string; text: string };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const items = (x: unknown): { key: string; vars: Vars; met?: unknown }[] => (Array.isArray(x) ? x.filter((i) => isObj(i) && typeof i.key === 'string') : []) as { key: string; vars: Vars }[];

/**
 * `calc` is a saved or history record (frozen, D20: printed as stored, never recomputed) or a calculator screen's draft
 * (`id` 0). `working: true` adds the formula steps and assumptions (long; off for a quick message).
 */
export function shareText(calc: StoredCalculation, language: Language, opts: { appVersion: string; working?: boolean }): SharedText {
  const tr = (key: MessageKey, params?: Record<string, string | number>) => translate(language, key, params);
  const say = (i: { key: string; vars: Vars; met?: unknown }) => {
    try {
      return displayText(i, language);
    } catch {
      return i.key;
    }
  };
  const label = tr(KIND_TITLE[calc.kind] ?? 'calc.vdrop');
  const heading = calc.title.trim() !== '' ? `${calc.title.trim()} — ${label}` : label;
  const lines: string[] = [heading];
  if (calc.id === 0) lines.push(`${tr('share.notSaved')} (${formatDate(calc.createdAt, language)})`); // N11: no date after a full stop
  else lines.push(tr(calc.projectId === null ? 'report.computedWith.history' : 'report.computedWith', { engine: calc.engineVersion, profile: calc.profileId, pv: calc.profileVersion, date: formatDate(calc.createdAt, language) }));
  if (calc.note.trim() !== '') lines.push(calc.note.trim());

  const r: CalcResult | null = isObj(calc.result) ? calc.result : null;
  if (!r) {
    lines.push('', tr('report.damaged'));
  } else {
    const results = headlineValues(calc.kind, r)
      .filter((v) => v.name !== 'suggestedIn')
      .map((v) => {
        const k = valueLabelKey(calc.kind, v.name, isMessageKey);
        return `• ${isMessageKey(k) ? tr(k) : v.name}: ${formatValue(v.name, v.value, v.unit as Unit, language)}`;
      });
    const texts = isObj(r.texts) ? r.texts : {};
    if (typeof texts.minSize === 'string' && texts.minSize.startsWith('AWG')) results.push(`• ${tr('report.minSize')}: ${texts.minSize}`);
    if (typeof texts.suggestion === 'string') results.push(`• ${tr(texts.verdict === 'met' ? 'report.suggestion.secondary' : 'report.suggestion')}: ${texts.suggestion}`);
    const section = (title: MessageKey, rows: string[]) => (rows.length ? ['', `${tr(title)}:`, ...rows] : []);
    lines.push(...section('report.results', results));
    lines.push(...section('report.checks', items(r.checks).map((c) => `• ${say(c)}`)));
    lines.push(...section('report.warnings', items(r.warnings).map((w) => `• ${say(w)}`)));
    lines.push(...section('report.inputs', describeInput(calc.kind, calc.input, { lang: language, tr, num: formatNumber }).map((i) => `• ${i.label}: ${i.value}`)));
    if (opts.working) {
      lines.push(...section('report.assumptions', items(r.assumptions).map((a) => `• ${say(a)}`)));
      lines.push(...section('report.working', items(r.steps).map((s, i) => `${i + 1}. ${say(s)}`)));
    }
  }
  lines.push('', tr('note.responsibility'), tr('report.versions', { app: opts.appVersion, engine: ENGINE_VERSION, profile: `${EU_DE.id} v${EU_DE.version}` }));
  return { subject: tr('share.subject', { title: calc.title.trim() !== '' ? calc.title.trim() : label }), text: lines.join('\n') };
}
