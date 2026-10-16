import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';
import { Spacing } from '@/constants/theme';

type SegmentedProps<T extends string> = {
  /** testID prefix: each segment gets `${testIDPrefix}-${value}`. */
  testIDPrefix: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
};

export function Segmented<T extends string>({ testIDPrefix, options, value, onChange }: SegmentedProps<T>) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={`${testIDPrefix}-${option.value}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, selected && { backgroundColor: theme.backgroundSelected }]}>
            <ThemedText type={selected ? 'smallBold' : 'small'}>{option.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    borderRadius: 12,
    padding: Spacing.one,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
