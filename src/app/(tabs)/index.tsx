// Calculators tab (SPEC §9): favourites first (star), the six calculators, then "Recent" (last 20 history entries,
// tap = reopen with its inputs).
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ListRow, Screen, SectionTitle } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { listHistory, type StoredCalculation } from '@/db/calculations';
import { getAppSettings, saveSetting } from '@/db/settings';
import { useDb } from '@/hooks/use-db';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import type { CalcKind } from '@/engine';
import { headlineText } from '@/lib/calc-label';
import { formatDate } from '@/lib/format';
import { KIND_TITLE, LISTED_KINDS } from '@/lib/kinds';

export default function CalculatorsScreen() {
  const t = useT();
  const db = useDb();
  const router = useRouter();
  const theme = useTheme();
  const lang = useLanguage();
  const [favorites, setFavorites] = useState<CalcKind[]>([]);
  const [recent, setRecent] = useState<StoredCalculation[]>([]);

  const load = useCallback(() => {
    getAppSettings(db).then((s) => setFavorites(s.favorites)).catch(() => undefined);
    listHistory(db, 20).then(setRecent).catch(() => undefined);
  }, [db]);
  useFocusEffect(load);

  async function toggleFavorite(kind: CalcKind) {
    const next = favorites.includes(kind) ? favorites.filter((k) => k !== kind) : [...favorites, kind];
    setFavorites(next);
    await saveSetting(db, 'favorites', JSON.stringify(next));
  }

  const ordered = [...LISTED_KINDS].sort((a, b) => Number(favorites.includes(b)) - Number(favorites.includes(a)));

  return (
    <Screen testID="calculators-screen">
      {ordered.map((kind) => (
        <View key={kind} style={styles.row}>
          <View style={styles.flex}>
            <ListRow testID={`calc-open-${kind}`} title={t(KIND_TITLE[kind])} onPress={() => router.push(`/calc/${kind}`)} />
          </View>
          <Pressable
            testID={`calc-fav-${kind}`}
            accessibilityRole="button"
            accessibilityLabel={t('calc.favorite')}
            accessibilityState={{ selected: favorites.includes(kind) }}
            onPress={() => toggleFavorite(kind)}
            style={styles.star}>
            <ThemedText maxFontSizeMultiplier={1.3} style={{ color: favorites.includes(kind) ? theme.warning : theme.textSecondary, fontSize: 26 }}>{favorites.includes(kind) ? '★' : '☆'}</ThemedText>
          </Pressable>
        </View>
      ))}

      {recent.length > 0 ? (
        <>
          <SectionTitle>{t('calc.recent')}</SectionTitle>
          {recent.map((c) => {
            return (
              <ListRow
                key={c.id}
                testID={`recent-${c.id}`}
                title={t(KIND_TITLE[c.kind])}
                subtitle={headlineText(c, lang)}
                right={formatDate(c.createdAt, lang)}
                onPress={() => router.push({ pathname: '/calc/[kind]', params: { kind: c.kind, history: String(c.id) } })}
              />
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  star: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
});
