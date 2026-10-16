import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useT } from '@/hooks/use-t';

/** The header back button of the pushed screens (same on both platforms; carries a testID for UI tests). */
export function BackButton() {
  const router = useRouter();
  const t = useT();
  return (
    <Pressable testID="nav-back" accessibilityRole="button" accessibilityLabel={t('common.back')} hitSlop={12} onPress={() => router.back()} style={{ paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' }}>
      <ThemedText maxFontSizeMultiplier={1.2} style={{ fontSize: 32, lineHeight: 36 }}>‹</ThemedText>
    </Pressable>
  );
}
