import { BANNED_WORDS, bannedWordsIn } from './wording';

describe('bannedWordsIn (A4)', () => {
  it('finds every banned word, case-insensitive and inflected', () => {
    for (const word of BANNED_WORDS) expect(bannedWordsIn(`x ${word.toUpperCase()} y`)).toEqual([word]);
    expect(bannedWordsIn('Die Anlage ist normgerechte und KONFORME Ausführung')).toEqual(['konform', 'normgerecht']);
    expect(bannedWordsIn('unzulässig')).toEqual(['zulaessig']);
  });

  it('v1.1 (REVIEW_V1 #21): folds umlauts, knows the near-synonyms, ignores web addresses', () => {
    expect(bannedWordsIn('zulaessig')).toEqual(['zulaessig']);
    expect(bannedWordsIn('ZULÄSSIG')).toEqual(['zulaessig']);
    expect(bannedWordsIn('Konformitaet')).toEqual(['konform']);
    expect(bannedWordsIn('Prüfung bestanden')).toEqual(['bestanden']);
    expect(bannedWordsIn('All checks passed')).toEqual(['passed']);
    expect(bannedWordsIn('Ausführung VDE-gerecht')).toEqual(['vde-gerecht']);
    expect(bannedWordsIn('see https://example.org/zulaessiger-Spannungsfall/ for the formula')).toEqual([]);
  });

  it('lets neutral result wording through', () => {
    expect(bannedWordsIn('Within the selected limit (3 %, user preset). Condition met.')).toEqual([]);
    expect(bannedWordsIn('Grenzwert überschritten. Bedingung erfüllt.')).toEqual([]);
  });
});
