import { CALC_KINDS, EU_DE, type CalcKind } from '@/engine';
import { LANGUAGE_PREFERENCES, type LanguagePreference } from '@/i18n';

import { withRead, withWrite } from './tx';
import type { Db } from './types';

export type ThemePreference = 'system' | 'light' | 'dark';

const THEME_KEY = 'theme';
const LANGUAGE_KEY = 'language';
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await withRead(db, (r) => r.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key));
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await withWrite(db, (tx) =>
    tx.runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value
    )
  );
}

export async function getThemePreference(db: Db): Promise<ThemePreference> {
  const value = await getSetting(db, THEME_KEY);
  return THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system';
}

export function setThemePreference(db: Db, theme: ThemePreference): Promise<void> {
  return setSetting(db, THEME_KEY, theme);
}

export async function getLanguagePreference(db: Db): Promise<LanguagePreference> {
  const value = await getSetting(db, LANGUAGE_KEY);
  return LANGUAGE_PREFERENCES.includes(value as LanguagePreference) ? (value as LanguagePreference) : 'system';
}

export function setLanguagePreference(db: Db, language: LanguagePreference): Promise<void> {
  return setSetting(db, LANGUAGE_KEY, language);
}

// ---------------------------------------------------------------- app settings (SPEC §6 settings list, D44)
// One text value per key. Every key has a validator (`settingProblem`) and a default; reads fall back to the default
// for a missing or invalid value, writes and backup restore refuse an invalid one.

export type Paper = 'A4' | 'Letter';
export type Company = { name: string; address: string; phone: string; email: string; regNo: string };
export type AppSettings = {
  language: LanguagePreference;
  theme: ThemePreference;
  lengthUnit: 'm' | 'ft';
  vdropMethod: 'M1' | 'M2' | 'M3';
  /** A preset id of the profile, or 'custom' (then `vdropLimitPercent` is the limit). */
  vdropLimitPreset: string;
  vdropLimitPercent: number;
  conductorTempC: number;
  reactanceMohmPerM: number;
  loopTempC: number;
  cmin: number;
  measuredFactor: number;
  favorites: CalcKind[];
  company: Company;
  /** `data:image/png|jpeg;base64,…`, at most 512 KB decoded. */
  logoDataUri: string | null;
  paper: Paper;
  historyLimit: number;
};

export const MAX_LOGO_BYTES = 512 * 1024;
export const LOGO_DATA_URI = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;

type SettingSpec = { default: string; problem: (value: string) => string | null };

const oneOf = (allowed: readonly string[]) => (v: string) => (allowed.includes(v) ? null : 'is not an allowed value');
const numberIn =
  (min: number, max: number, opts: { minExclusive?: boolean; integer?: boolean } = {}) =>
  (v: string) => {
    const n = Number(v);
    if (v.trim() !== v || v === '' || !Number.isFinite(n)) return 'is not a number';
    if (opts.integer && !Number.isInteger(n)) return 'is not a whole number';
    if (opts.minExclusive ? n <= min : n < min) return `is not above ${min}`;
    if (n > max) return `is above ${max}`;
    return null;
  };
const textUpTo = (max: number) => (v: string) => (v.length <= max ? null : 'is too long');
const PRESET_IDS = [...EU_DE.limitPresets.map((p) => p.id), 'custom'];

function favoritesProblem(v: string): string | null {
  try {
    const parsed: unknown = JSON.parse(v);
    if (!Array.isArray(parsed) || parsed.length > CALC_KINDS.length) return 'is not a list of calculators';
    if (!parsed.every((k) => CALC_KINDS.includes(k as CalcKind)) || new Set(parsed).size !== parsed.length) return 'has an unknown or repeated calculator';
    return null;
  } catch {
    return 'is not valid JSON';
  }
}

function logoProblem(v: string): string | null {
  const m = LOGO_DATA_URI.exec(v);
  if (!m) return 'is not a base64 PNG or JPEG data URI';
  const b64 = m[2];
  // the bytes must be what the MIME type says (review #20): PNG signature 89 50 4E 47 0D 0A 1A 0A, JPEG FF D8 FF
  if (m[1] === 'png' ? !b64.startsWith('iVBORw0KGgo') : !b64.startsWith('/9j/')) return 'is not a PNG or JPEG image';
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  return bytes <= MAX_LOGO_BYTES ? null : 'is larger than 512 KB';
}

export const SETTING_SPECS = {
  language: { default: 'system', problem: oneOf(LANGUAGE_PREFERENCES) },
  theme: { default: 'system', problem: oneOf(THEMES) },
  lengthUnit: { default: 'm', problem: oneOf(['m', 'ft']) },
  vdropMethod: { default: 'M1', problem: oneOf(['M1', 'M2', 'M3']) },
  vdropLimitPreset: { default: EU_DE.limitPresets[0].id, problem: oneOf(PRESET_IDS) },
  vdropLimitPercent: { default: '3', problem: numberIn(0, 100, { minExclusive: true }) },
  conductorTempC: { default: '70', problem: numberIn(-50, 250) },
  reactanceMohmPerM: { default: '0.08', problem: numberIn(0, 10) },
  loopTempC: { default: '70', problem: numberIn(-50, 250) },
  cmin: { default: '1', problem: numberIn(0, 1, { minExclusive: true }) },
  measuredFactor: { default: String(2 / 3), problem: numberIn(0, 1, { minExclusive: true }) },
  favorites: { default: '[]', problem: favoritesProblem },
  'company.name': { default: '', problem: textUpTo(200) },
  'company.address': { default: '', problem: textUpTo(1000) },
  'company.phone': { default: '', problem: textUpTo(100) },
  'company.email': { default: '', problem: textUpTo(200) },
  'company.regNo': { default: '', problem: textUpTo(100) },
  logoDataUri: { default: '', problem: (v) => (v === '' ? null : logoProblem(v)) },
  paper: { default: 'A4', problem: oneOf(['A4', 'Letter']) },
  historyLimit: { default: '100', problem: numberIn(1, 1000, { integer: true }) },
} as const satisfies Record<string, SettingSpec>;

export type SettingKey = keyof typeof SETTING_SPECS;

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTING_SPECS, key);
}

/** null when `value` is acceptable for `key`; otherwise a short reason (logs and tests; the UI shows its own text). */
export function settingProblem(key: string, value: string): string | null {
  return isSettingKey(key) ? SETTING_SPECS[key].problem(value) : 'is not a known setting';
}

/** Validated write; throws on an unknown key or an invalid value (nothing is written). */
export async function saveSetting(db: Db, key: SettingKey, value: string): Promise<void> {
  const problem = settingProblem(key, value);
  if (problem) throw new Error(`Setting ${key} ${problem}`);
  await setSetting(db, key, value);
}

/** Removes the stored value (the default applies again). */
export async function clearSetting(db: Db, key: SettingKey): Promise<void> {
  await withWrite(db, (tx) => tx.runAsync('DELETE FROM settings WHERE key = ?', key));
}

export function resolveSettings(stored: Record<string, string>): AppSettings {
  const get = (key: SettingKey): string => {
    const v = stored[key];
    return v !== undefined && SETTING_SPECS[key].problem(v) === null ? v : SETTING_SPECS[key].default;
  };
  return {
    language: get('language') as LanguagePreference,
    theme: get('theme') as ThemePreference,
    lengthUnit: get('lengthUnit') as 'm' | 'ft',
    vdropMethod: get('vdropMethod') as 'M1' | 'M2' | 'M3',
    vdropLimitPreset: get('vdropLimitPreset'),
    vdropLimitPercent: Number(get('vdropLimitPercent')),
    conductorTempC: Number(get('conductorTempC')),
    reactanceMohmPerM: Number(get('reactanceMohmPerM')),
    loopTempC: Number(get('loopTempC')),
    cmin: Number(get('cmin')),
    measuredFactor: Number(get('measuredFactor')),
    favorites: JSON.parse(get('favorites')) as CalcKind[],
    company: {
      name: get('company.name'),
      address: get('company.address'),
      phone: get('company.phone'),
      email: get('company.email'),
      regNo: get('company.regNo'),
    },
    logoDataUri: get('logoDataUri') || null,
    paper: get('paper') as Paper,
    historyLimit: Number(get('historyLimit')),
  };
}

/** Every setting with defaults filled in, from one consistent read. */
export async function getAppSettings(db: Db): Promise<AppSettings> {
  const rows = await withRead(db, (r) => r.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings'));
  return resolveSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}
