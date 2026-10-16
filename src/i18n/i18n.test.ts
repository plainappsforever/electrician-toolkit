import { bannedWordsIn } from '@/lib/wording';

import { de } from './de';
import { en, type MessageKey } from './en';
import { applyLanguagePreference, getLanguage, resolveLanguage, setLanguage, t, translate } from './index';

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
const keys = Object.keys(en) as MessageKey[];

describe('translations (A11)', () => {
  it('en and de define exactly the same keys', () => {
    expect(Object.keys(de).sort()).toEqual(Object.keys(en).sort());
  });

  it('no string is empty and placeholders match between languages', () => {
    for (const key of keys) {
      expect(en[key].trim()).not.toBe('');
      expect(de[key].trim()).not.toBe('');
      expect(placeholders(de[key])).toEqual(placeholders(en[key]));
    }
  });

  it('German differs from English for the navigation and the responsibility note', () => {
    for (const key of ['tab.calculators', 'tab.projects', 'tab.tables', 'tab.more', 'note.responsibility'] as const) {
      expect(de[key]).not.toBe(en[key]);
    }
    expect(de['calc.vdrop']).toContain('Spannungsfall'); // U7 Maestro anchor (SPEC §10)
  });
});

describe('wording (A4)', () => {
  const whitelist: readonly MessageKey[] = ['note.responsibility'];

  it('no en/de string except the responsibility note contains a banned word', () => {
    const hits = keys
      .filter((key) => !whitelist.includes(key))
      .flatMap((key) => [...bannedWordsIn(en[key]), ...bannedWordsIn(de[key])].map((word) => `${key}: ${word}`));
    expect(hits).toEqual([]);
  });
});

describe('language selection', () => {
  it('follows the device unless the user chose', () => {
    expect(resolveLanguage('system', 'de-DE')).toBe('de');
    expect(resolveLanguage('system', 'de_AT')).toBe('de');
    expect(resolveLanguage('system', 'en-US')).toBe('en');
    expect(resolveLanguage('system', 'fr-FR')).toBe('en');
    expect(resolveLanguage('system', undefined)).toBe('en');
    expect(resolveLanguage('en', 'de-DE')).toBe('en');
    expect(resolveLanguage('de', 'en-US')).toBe('de');
  });

  it('t() uses the current language and fills placeholders', () => {
    setLanguage('de');
    expect(t('tab.calculators')).toBe('Rechner');
    expect(t('settings.version', { version: '1.0.0', variant: 'development' })).toBe('Version 1.0.0 (development)');
    applyLanguagePreference('en');
    expect(getLanguage()).toBe('en');
    expect(t('tab.calculators')).toBe('Calculators');
    expect(translate('de', 'tab.more')).toBe('Mehr');
    expect(translate('en', 'settings.version', { version: '2' })).toBe('Version 2 ({variant})');
  });
});
