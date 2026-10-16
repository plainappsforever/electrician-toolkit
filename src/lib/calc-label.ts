// One-line texts for a stored calculation in lists (project, circuit, recent): the headline value of its stored result.
import type { StoredCalculation } from '@/db/calculations';
import { translate, type Language, type MessageKey } from '@/i18n';

import { headlineValues } from './calc-summary';
import { formatValue } from './format';

/** "Voltage drop Δu: 3.76 %" — or an empty text for a damaged or non-numeric result. */
export function headlineText(c: Pick<StoredCalculation, 'kind' | 'result'>, lang: Language): string {
  const head = headlineValues(c.kind, c.result)[0];
  if (!head) return '';
  const label = translate(lang, `value.${head.name}` as MessageKey);
  return `${label}: ${formatValue(head.name, head.value, head.unit as never, lang)}`;
}
