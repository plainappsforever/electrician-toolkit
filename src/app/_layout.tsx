import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import type { SQLiteDatabase } from 'expo-sqlite';
import { useColorScheme } from 'react-native';

import { BackButton } from '@/components/back-button';
import { migrate } from '@/db/migrations';
import { DatabaseProvider } from '@/db/provider';
import { getLanguagePreference, getThemePreference } from '@/db/settings';
import { useT } from '@/hooks/use-t';
import { applyLanguagePreference } from '@/i18n';
import { applyThemePreference } from '@/lib/theme-preference';

async function initDatabase(db: SQLiteDatabase) {
  await migrate(db);
  applyThemePreference(await getThemePreference(db));
  applyLanguagePreference(await getLanguagePreference(db));
}

export default function RootLayout() {
  return (
    <DatabaseProvider onInit={initDatabase}>
      <Navigator />
    </DatabaseProvider>
  );
}

function Navigator() {
  const scheme = useColorScheme();
  const t = useT();
  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack screenOptions={{ headerBackVisible: false, headerLeft: ({ canGoBack }) => (canGoBack ? <BackButton /> : null) }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
        <Stack.Screen name="backup" options={{ title: t('more.backup') }} />
        <Stack.Screen name="sources" options={{ title: t('more.sources') }} />
        <Stack.Screen name="about" options={{ title: t('more.about') }} />
        <Stack.Screen name="licences" options={{ title: t('licences.title') }} />
        <Stack.Screen name="debug/[action]" options={{ title: 'Debug' }} />
      </Stack>
    </ThemeProvider>
  );
}
