// Shared form pieces for the calculator, project, table and settings screens (D28). Plain React Native; every control
// that a Maestro flow uses takes a testID from the caller.
import type { ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type KeyboardTypeOptions, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A scrolling screen body with the keyboard handled: taps reach buttons while a field is focused. */
export function Screen({ children, testID, style }: { children: ReactNode; testID?: string; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <>
      <ScrollView
        testID={testID}
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={[styles.screen, style]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="automatic">
        {children}
      </ScrollView>
    </>
  );
}

export function Card({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.card, { backgroundColor: theme.backgroundElement }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <ThemedText type="smallBold" themeColor="textSecondary" style={[styles.sectionTitle, style as object]}>
      {children}
    </ThemedText>
  );
}

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  testID: string;
  /** Unit shown at the right of the field. */
  unit?: string;
  error?: string | null;
  hint?: string;
  placeholder?: string;
  /** 'decimal' (default) = decimal-pad; 'signed' = a keyboard with a minus sign; 'text' = free text. */
  kind?: 'decimal' | 'signed' | 'text';
  multiline?: boolean;
  /** Extra content at the right of the label row (e.g. a unit switch). */
  right?: ReactNode;
  autoCapitalize?: 'none' | 'sentences' | 'words';
};

function keyboardFor(kind: NonNullable<TextFieldProps['kind']>): KeyboardTypeOptions {
  if (kind === 'text') return 'default';
  if (kind === 'signed') return Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default';
  return 'decimal-pad';
}

export function TextField({ label, value, onChangeText, testID, unit, error, hint, placeholder, kind = 'decimal', multiline, right, autoCapitalize }: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <ThemedText type="smallBold" style={styles.flex}>
          {label}
        </ThemedText>
        {right}
      </View>
      <View style={styles.inputRow}>
        <TextInput
          testID={testID}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardFor(kind)}
          autoCapitalize={autoCapitalize ?? (kind === 'text' ? 'sentences' : 'none')}
          autoCorrect={false}
          multiline={multiline}
          returnKeyType="done"
          placeholder={placeholder}
          placeholderTextColor={theme.textSecondary}
          selectTextOnFocus={false}
          style={[
            styles.input,
            multiline && styles.multiline,
            { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: error ? theme.danger : theme.border },
          ]}
        />
        {unit ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.unit}>
            {unit}
          </ThemedText>
        ) : null}
      </View>
      {error ? (
        <ThemedText testID={`${testID}-error`} type="small" style={{ color: theme.danger }}>
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" themeColor="textSecondary">
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
}

type ChipsProps<T extends string> = {
  /** Each chip gets `${testIDPrefix}-${value}`. */
  testIDPrefix: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  label?: string;
};

/** A wrapping row of single-choice chips (system, material, units, ratings, standard sizes). */
export function Chips<T extends string>({ testIDPrefix, options, value, onChange, label }: ChipsProps<T>) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      {label ? <ThemedText type="smallBold">{label}</ThemedText> : null}
      <View style={styles.chips}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              testID={`${testIDPrefix}-${o.value}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={[styles.chip, { borderColor: selected ? theme.tint : theme.border, backgroundColor: selected ? theme.tint : theme.backgroundElement }]}>
              <ThemedText type={selected ? 'smallBold' : 'small'} style={{ color: selected ? theme.onTint : theme.text }}>
                {o.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A row the user can tap (lists of projects, circuits, tables, saved calculations, settings entries). */
export function ListRow({ title, subtitle, onPress, testID, right }: { title: string; subtitle?: string; onPress?: () => void; testID?: string; right?: string }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={[styles.row, { backgroundColor: theme.backgroundElement }]}>
      <View style={styles.flex}>
        <ThemedText>{title}</ThemedText>
        {subtitle ? (
          <ThemedText type="small" themeColor="textSecondary">
            {subtitle}
          </ThemedText>
        ) : null}
      </View>
      {right ? (
        <ThemedText type="small" themeColor="textSecondary">
          {right}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

/** A small text button (links, "change", "reset"). */
export function LinkButton({ label, onPress, testID, danger }: { label: string; onPress: () => void; testID?: string; danger?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} hitSlop={8} style={styles.link}>
      <ThemedText type="smallBold" style={{ color: danger ? theme.danger : theme.tint }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },
  card: { borderRadius: 12, padding: Spacing.three, gap: Spacing.two },
  sectionTitle: { marginTop: Spacing.two, textTransform: 'uppercase' },
  field: { gap: Spacing.one },
  flex: { flex: 1 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  input: { flex: 1, minHeight: 48, borderRadius: 10, borderWidth: 1, paddingHorizontal: Spacing.three, fontSize: 17 },
  multiline: { minHeight: 88, paddingTop: Spacing.two, textAlignVertical: 'top' },
  unit: { minWidth: 36 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: { minHeight: 40, minWidth: 44, borderRadius: 10, borderWidth: 1, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' },
  row: { borderRadius: 12, padding: Spacing.three, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  link: { minHeight: 32, justifyContent: 'center' },
});
