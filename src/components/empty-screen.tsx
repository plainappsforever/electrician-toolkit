import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Placeholder body for a tab that has no content yet (P5 replaces these screens). */
export function EmptyScreen({ testID, text }: { testID: string; text: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.container, { backgroundColor: theme.background }]}>
      <ThemedText themeColor="textSecondary">{text}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.three },
});
