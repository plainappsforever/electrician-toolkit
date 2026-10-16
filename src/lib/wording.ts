// Honest-result wording (D16, SPEC §12, A4): words that claim a compliance verdict never appear in result, report or
// UI text. The responsibility note (SPEC §15) is the only whitelisted text: it names what a result is NOT.
// v1.1 (REVIEW_V1 #21): matching folds umlauts (ä→ae, ö→oe, ü→ue, ß→ss), so "zulaessig" and "Konformitaet" count, the
// list has the near-synonyms "bestanden", "passed" and "…-gerecht" (VDE-gerecht, normgerecht), and web addresses are
// ignored (a cited source's URL may contain such a word, e.g. "…/zulaessiger-Spannungsfall/…").
export const BANNED_WORDS: readonly string[] = [
  'compliant',
  'konform',
  'zulaessig',
  'normgerecht',
  'vde-gerecht',
  'vdegerecht',
  'din-gerecht',
  'approved',
  'certified',
  'zertifiziert',
  'bestanden',
  'passed',
];

/** Lower case with umlauts folded to their two-letter forms and web addresses removed. */
export function foldForWording(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, ' ')
    .toLocaleLowerCase('de')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

/** Banned words contained in `text` (case-insensitive, umlaut-folded substring match, so inflections like "konforme" count). */
export function bannedWordsIn(text: string): string[] {
  const folded = foldForWording(text);
  return BANNED_WORDS.filter((word) => folded.includes(word));
}
