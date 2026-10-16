// Device number format and language tag (expo-localization, V1_PLAN pinned additions). Falls back to Intl/language when the
// native module is unavailable (Jest, web). The decimal separator decides what a lone "," or "." means while typing
// (src/engine/parse.ts); both are always accepted.
import { getLocales } from 'expo-localization';

export function deviceDecimalSeparator(): string | null {
  try {
    return getLocales()[0]?.decimalSeparator ?? null;
  } catch {
    return null;
  }
}

export function deviceLocaleTag(): string | undefined {
  try {
    return getLocales()[0]?.languageTag;
  } catch {
    return undefined;
  }
}
