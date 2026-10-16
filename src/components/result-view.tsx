// The result of one calculation, exactly as the engine (or a frozen snapshot) says it: headline value with unit,
// verdict lines against the limits the USER selected (never "compliant", D16), warnings, and "Show working" with the
// formula lines, assumptions (defaults marked, "change" link), sources with clause and licence status, and the
// responsibility note. Every number a person reads goes through `displayText`/`formatValue` (D52).
import { useState } from 'react';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';

import { Card, LinkButton, SectionTitle } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useKeyboardVisible } from '@/hooks/use-keyboard-visible';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { SOURCES, isSourceId, type CalcKind, type CalcResult, type Issue, type Source } from '@/engine';
import { isMessageKey } from '@/engine/explain';
import type { MessageKey } from '@/i18n';
import { valueLabelKey } from '@/lib/calc-summary';
import { displayText, formatValue } from '@/lib/format';

const ROWS: Record<CalcKind, readonly string[]> = {
  vdrop: ['u', 'deltaULL', 'uEnd', 'powerLoss', 'lMax'],
  current: ['current', 'power', 'inputPower', 'apparentPower', 'reactivePower'],
  ohm: ['voltage', 'current', 'resistance', 'power'],
  coord: ['iz', 'in', 'i2'],
  loop: ['zsMax', 'measuredLimit', 'lMax', 'ik', 'ia'],
  resistance: ['r20', 'rPe', 'rLoop'],
  convert: ['mm2', 'diameterMm', 'kcmil', 'awgExact', 'awgAtLeast', 'awgAtMost', 'metricAtLeast', 'metricAtMost', 'm', 'ft'],
};

/** Headline items that are texts, not numbers: the suggested device ("B13") or the user's own device ("B16"). */
function primaryText(result: CalcResult, primary: string | null): string | undefined {
  if (primary === 'suggestedIn') return result.texts.suggestion;
  if (primary === 'device') return result.texts.device;
  return undefined;
}

/** The big number of a result (absent for Ohm's law, which has four equal values). */
function primaryName(result: CalcResult): string | null {
  const v = result.values;
  switch (result.kind) {
    case 'vdrop':
      return 'deltaUPercent';
    case 'current': {
      const typedCurrent = (result.usedInput as { current?: unknown } | undefined)?.current !== undefined;
      return typedCurrent ? 'power' : 'current';
    }
    case 'coord':
      // v1.1 F6 (REVIEW_V1 #6): when the user's own device meets C1–C3 the headline is that device; the suggestion is
      // only the headline when a check fails (then it is the answer to "which rating would fit?")
      if (result.texts.verdict === 'met') return result.texts.device ? 'device' : null;
      return result.texts.suggestion ? 'suggestedIn' : null;
    case 'loop':
      return 'zs';
    case 'resistance':
      return 'r';
    case 'convert':
      return ['mm2', 'm', 'ft', 'awgExact'].find((n) => v[n]) ?? null;
    default:
      return null;
  }
}

const labelOf = (t: ReturnType<typeof useT>, name: string, kind: CalcKind): string => {
  const key = valueLabelKey(kind, name, isMessageKey);
  return isMessageKey(key) ? t(key as MessageKey) : name;
};

function IssueList({ items, color, idPrefix }: { items: Issue[]; color: string; idPrefix: string }) {
  const lang = useLanguage();
  return (
    <>
      {items.map((w, i) => (
        <ThemedText key={`${w.code}-${i}`} testID={`${idPrefix}-${w.code}`} type="small" style={{ color }}>
          {displayText(w, lang)}
        </ThemedText>
      ))}
    </>
  );
}

/**
 * v1.1 F16 (REVIEW_V1 #15): a visible "Done" at the right of a dismiss strip while the iPhone keyboard is open — the
 * strip already closes the keyboard on a tap, this makes that findable (no Done key on the decimal pad below iOS 26).
 */
export function KeyboardDoneHint() {
  const t = useT();
  const theme = useTheme();
  const visible = useKeyboardVisible();
  if (Platform.OS !== 'ios' || !visible) return null;
  return (
    <ThemedText testID="keyboard-done" maxFontSizeMultiplier={1.6} type="smallBold" style={[styles.done, { color: theme.tint }]}>
      {t('keyboard.done')}
    </ThemedText>
  );
}

/**
 * A compact result that stays visible above the scrolling form (headline value and the first check that is not met,
 * else the first check), so the result is seen while typing — with the keyboard open too.
 */
export function ResultStrip({ result, hint }: { result: CalcResult | null; hint: string | null }) {
  const theme = useTheme();
  const t = useT();
  const lang = useLanguage();
  const primary = result && result.ok ? primaryName(result) : null;
  const main = primary && result ? result.values[primary] : undefined;
  const check = result && result.ok ? (result.checks.find((c) => !c.met) ?? result.checks[0]) : undefined;
  const keyboard = useKeyboardVisible() && Platform.OS === 'ios'; // room for the "Done" hint at the right
  return (
    // a tap on the strip closes the keyboard (the decimal keyboards have no "done" key)
    <Pressable testID="dismiss-strip" accessible={false} onPress={() => Keyboard.dismiss()} style={[styles.strip, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, keyboard ? styles.stripKeyboard : null]}>
      {result && result.ok && (main || primaryText(result, primary)) ? (
        <>
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {labelOf(t, primary!, result.kind)}
          </ThemedText>
          <ThemedText maxFontSizeMultiplier={1.6} testID="strip-main" style={styles.stripBig}>
            {primaryText(result, primary) ?? formatValue(primary!, main!.value, main!.unit, lang)}
          </ThemedText>
        </>
      ) : result && result.ok && result.kind === 'ohm' ? (
        <ThemedText maxFontSizeMultiplier={1.6} testID="strip-main" type="smallBold" numberOfLines={2}>
          {ROWS.ohm.map((n) => formatValue(n, result.values[n].value, result.values[n].unit, lang)).join('   ')}
        </ThemedText>
      ) : (
        <ThemedText maxFontSizeMultiplier={1.6} testID="strip-hint" type="small" themeColor="textSecondary" numberOfLines={2}>
          {hint ?? ' '}
        </ThemedText>
      )}
      <KeyboardDoneHint />
      {check ? (
        <ThemedText maxFontSizeMultiplier={1.6} testID="strip-verdict" type="smallBold" numberOfLines={2} style={{ color: check.met ? theme.success : theme.warning }}>
          {(check.met ? '✓ ' : '✗ ') + displayText(check, lang)}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

type Props = {
  result: CalcResult;
  /** "change" next to a default assumption (calculator screen: opens the options section). */
  onChangeAssumption?: () => void;
  /** Start with the working open (saved calculations). */
  workingOpen?: boolean;
};

export function ResultView({ result, onChangeAssumption, workingOpen = false }: Props) {
  const t = useT();
  const theme = useTheme();
  const lang = useLanguage();
  const [open, setOpen] = useState(workingOpen);
  const primary = primaryName(result);
  const rows = ROWS[result.kind].filter((n) => result.values[n] && n !== primary);
  const main = primary ? result.values[primary] : undefined;

  return (
    <View style={styles.wrap}>
      <Card testID="result-card">
        {main || primaryText(result, primary) ? (
          <View>
            <ThemedText type="small" themeColor="textSecondary">
              {primary ? labelOf(t, primary, result.kind) : ''}
            </ThemedText>
            <ThemedText testID="result-main" style={styles.big}>
              {primaryText(result, primary) ?? (main ? formatValue(primary!, main.value, main.unit, lang) : '')}
            </ThemedText>
          </View>
        ) : null}

        {rows.map((name) => (
          <View key={name} style={styles.valueRow}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
              {labelOf(t, name, result.kind)}
            </ThemedText>
            <ThemedText testID={`result-${name}`} type="smallBold">
              {formatValue(name, result.values[name].value, result.values[name].unit, lang)}
            </ThemedText>
          </View>
        ))}
        {result.kind === 'coord' && primary === 'device' && result.texts.suggestion ? (
          <View style={styles.valueRow}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
              {t('result.coord.alsoFits')}
            </ThemedText>
            <ThemedText testID="result-suggestion" type="smallBold">
              {result.texts.suggestion}
            </ThemedText>
          </View>
        ) : null}
        {result.kind === 'vdrop' && result.texts.minSize ? (
          <View style={styles.valueRow}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.flex}>
              {t('value.minSizeMm2')}
            </ThemedText>
            <ThemedText testID="result-minSize" type="smallBold">
              {result.texts.minSize}
            </ThemedText>
          </View>
        ) : null}

        {result.checks.map((c) => (
          <ThemedText key={c.id} testID={`check-${c.id}`} type="smallBold" style={{ color: c.met ? theme.success : theme.warning }}>
            {(c.met ? '✓ ' : '✗ ') + displayText(c, lang)}
          </ThemedText>
        ))}
        <IssueList items={result.warnings} color={theme.warning} idPrefix="warning" />
        {/* v1.1 (REVIEW_V1 #18): the verdict lines are on screen without the collapsed working, so one short line says what they are */}
        <ThemedText testID="result-note-short" type="small" themeColor="textSecondary">
          {t('result.noteShort')}
        </ThemedText>
      </Card>

      <LinkButton testID="working-toggle" label={open ? t('result.hide') : t('result.show')} onPress={() => setOpen((x) => !x)} />

      {open ? (
        <Card testID="working">
          <SectionTitle>{t('report.working')}</SectionTitle>
          {result.steps.map((s, i) => (
            <ThemedText key={`${s.key}-${i}`} testID={`step-${i}`} type="code" style={styles.step}>
              {displayText(s, lang)}
            </ThemedText>
          ))}

          <SectionTitle>{t('report.assumptions')}</SectionTitle>
          {result.assumptions.map((a, i) => (
            <View key={`${a.key}-${i}`} style={styles.assumption}>
              <ThemedText type="small" style={styles.flex}>
                {displayText(a, lang) + (a.isDefault ? ` ${t('report.default')}` : '')}
              </ThemedText>
              {a.isDefault && onChangeAssumption ? <LinkButton label={t('result.change')} onPress={onChangeAssumption} testID={`assumption-change-${i}`} /> : null}
            </View>
          ))}

          <SectionTitle>{t('report.sources')}</SectionTitle>
          {result.sources.filter(isSourceId).map((id) => {
            const s: Source = SOURCES[id];
            const text = lang === 'de' ? s.de : s;
            return (
              <View key={id} testID={`source-${id}`} style={styles.source}>
                <ThemedText type="smallBold">{`${text.standard} — ${text.clause}`}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t(s.licence === 'public' ? 'report.licence.public' : 'report.licence.licensed-cited')}
                </ThemedText>
                {text.unconfirmed ? (
                  <ThemedText type="small" style={{ color: theme.warning }}>
                    {t('report.unconfirmed', { note: text.unconfirmed })}
                  </ThemedText>
                ) : null}
              </View>
            );
          })}

          <ThemedText testID="responsibility-note" type="small" themeColor="textSecondary" style={styles.note}>
            {t('note.responsibility')}
          </ThemedText>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, minHeight: 84 },
  stripBig: { fontSize: 30, lineHeight: 36, fontWeight: 700 },
  wrap: { gap: Spacing.two },
  big: { fontSize: 40, lineHeight: 46, fontWeight: 700 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  flex: { flex: 1 },
  step: { lineHeight: 18 },
  assumption: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  source: { gap: 2 },
  note: { marginTop: Spacing.two },
  done: { position: 'absolute', top: Spacing.two, right: Spacing.three },
  stripKeyboard: { paddingRight: 88 },
});
