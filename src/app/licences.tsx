// Open-source licences (v1.1, RELEASE_KIT 1c item 10): every production dependency with its licence text, generated from
// node_modules by `node scripts/licences.mjs` into src/constants/licences.json (src/lib/licences.test.ts keeps it current).
import { FlatList, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import LICENCES from '@/constants/licences.json';
import { Spacing } from '@/constants/theme';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';

type Licence = { name: string; version: string; licence: string; text: string };

export default function LicencesScreen() {
  const t = useT();
  const theme = useTheme();
  return (
    <FlatList
      testID="licences-screen"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}
      data={LICENCES as Licence[]}
      keyExtractor={(p) => p.name}
      ListHeaderComponent={
        <ThemedText type="small" themeColor="textSecondary">
          {t('licences.intro', { count: (LICENCES as Licence[]).length })}
        </ThemedText>
      }
      renderItem={({ item }) => (
        <View testID={`licence-${item.name}`} style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="smallBold">{`${item.name} ${item.version} — ${item.licence}`}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary" selectable>
            {item.text}
          </ThemedText>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.three, gap: Spacing.two },
  card: { padding: Spacing.three, borderRadius: 12, gap: Spacing.one },
});
