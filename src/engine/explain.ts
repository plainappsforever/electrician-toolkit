// Formula and message texts (print-cost D37 pattern): steps, assumptions, checks, warnings and errors carry
// { key, vars }; this fills the key's EN/DE text with the vars. Numbers are formatted for display only; the result
// values stay full precision. P4's format.ts (D22 display rounding) can be passed in as `formatNumber`.
import { messages, translate, type Language, type MessageKey } from '../i18n';
import type { Unit, Var, Vars } from './types';
import { awgLabel } from './units';

export type NumberFormatter = (value: number, unit: Unit, language: Language) => string;

export const defaultNumberFormatter: NumberFormatter = (value, unit, language) => {
  if (unit === 'AWG') return `AWG ${awgLabel(value)}`;
  const n = new Intl.NumberFormat(language === 'de' ? 'de-DE' : 'en-GB', { maximumSignificantDigits: 6 }).format(value);
  return unit === '' ? n : `${n} ${unit}`;
};

export function isMessageKey(k: string): k is MessageKey {
  return Object.prototype.hasOwnProperty.call(messages.en, k);
}

/** Placeholders a message expects, e.g. ['u', 'u0', 'pct']. */
export function placeholdersOf(k: MessageKey, language: Language = 'en'): string[] {
  return (messages[language][k].match(/\{(\w+)\}/g) ?? []).map((p) => p.slice(1, -1));
}

function formatVar(v: Var, language: Language, formatNumber: NumberFormatter): string {
  if (v.kind === 'text') return v.value;
  if (v.kind === 'key') return isMessageKey(v.value) ? translate(language, v.value) : v.value;
  return formatNumber(v.value, v.unit, language);
}

/** The text of a step/assumption/check/issue in the given language. Unknown keys are returned as is. */
export function explain(item: { key: string; vars: Vars }, language: Language, formatNumber: NumberFormatter = defaultNumberFormatter): string {
  if (!isMessageKey(item.key)) return item.key;
  const params: Record<string, string> = {};
  for (const [name, v] of Object.entries(item.vars)) params[name] = formatVar(v, language, formatNumber);
  return translate(language, item.key, params);
}
