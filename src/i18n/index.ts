import { deviceLocaleTag } from '../lib/locale';
import { de } from './de';
import { en, type MessageKey } from './en';

export type { MessageKey };
export type Language = 'en' | 'de';
/** What the user picked in Settings: a language, or follow the device. */
export type LanguagePreference = 'system' | Language;

export const LANGUAGES: readonly Language[] = ['en', 'de'];
export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ['system', 'en', 'de'];
export const messages: Record<Language, Record<MessageKey, string>> = { en, de };

/** 'de', 'de-DE' and 'de_AT' all mean German; anything unsupported falls back to English. */
export function resolveLanguage(preference: LanguagePreference, deviceTag: string | undefined): Language {
  if (preference !== 'system') return preference;
  const primary = deviceTag?.split(/[-_]/)[0]?.toLowerCase();
  return LANGUAGES.find((l) => l === primary) ?? 'en';
}

/** Device language tag: expo-localization (getLocales()[0].languageTag), else Intl. */
export function deviceLanguageTag(): string | undefined {
  const tag = deviceLocaleTag();
  if (tag) return tag;
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return undefined;
  }
}

let current: Language = resolveLanguage('system', deviceLanguageTag());
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

export function setLanguage(language: Language) {
  if (language === current) return;
  current = language;
  listeners.forEach((listener) => listener());
}

export function applyLanguagePreference(preference: LanguagePreference) {
  setLanguage(resolveLanguage(preference, deviceLanguageTag()));
}

export function subscribeLanguage(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Translate a key in the current language, filling `{name}` placeholders. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  return translate(current, key, params);
}

/** t() bound to a language (a new function per language so memoised render output follows a switch). */
export function makeT(language: Language) {
  return (key: MessageKey, params?: Record<string, string | number>): string => translate(language, key, params);
}

export function translate(language: Language, key: MessageKey, params?: Record<string, string | number>): string {
  const text = messages[language][key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
