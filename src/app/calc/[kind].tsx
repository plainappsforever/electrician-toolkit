// One calculator (SPEC §9): inputs on top, live result card, "Show working", Save to project, PDF report, Reset.
// The form state is text; `buildInput` turns it into the engine input, `compute()` gives the result on every change.
// Computed-and-left calculations go to the history after a 2 s pause or when the screen is left (SPEC §6).
import { Stack, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { Button } from '@/components/button';
import { CalcFields } from '@/components/calc-fields';
import { Card, Chips, LinkButton, Screen } from '@/components/form';
import { Notice } from '@/components/notice';
import { ResultStrip, ResultView } from '@/components/result-view';
import { SaveSheet, type SavedInfo } from '@/components/save-sheet';
import { ThemedText } from '@/components/themed-text';
import { getCalculation, recordHistory } from '@/db/calculations';
import { getAppSettings } from '@/db/settings';
import { useReportPdf } from '@/hooks/use-report-pdf';
import { useConvention } from '@/hooks/use-convention';
import { useDb } from '@/hooks/use-db';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { CALC_KINDS, compute, type CalcKind } from '@/engine';
import { buildInput, formFromInput, initialForm, INCOMPLETE_CODES, type Defaults, type FormByKind } from '@/lib/calc-form';
import { displayText } from '@/lib/format';
import { KIND_TITLE } from '@/lib/kinds';
import { buildCalculationReportFor, draftCalculation } from '@/lib/report-data';

export default function CalcScreen() {
  const { kind, history } = useLocalSearchParams<{ kind: string; history?: string }>();
  const t = useT();
  if (!CALC_KINDS.includes(kind as CalcKind)) return <Screen><ThemedText>{t('common.notFound')}</ThemedText></Screen>;
  // `key` = a fresh form when the user switches between Current & power and Ohm's law
  return <CalcBody key={`${kind}-${history ?? ''}`} kind={kind as CalcKind} historyId={history ? Number(history) : undefined} />;
}

function CalcBody({ kind, historyId }: { kind: CalcKind; historyId?: number }) {
  const t = useT();
  const db = useDb();
  const router = useRouter();
  const theme = useTheme();
  const navigation = useNavigation();
  const conv = useConvention();
  const lang = useLanguage();

  const [defaults, setDefaults] = useState<Defaults | null>(null);
  const [form, setForm] = useState<FormByKind[CalcKind] | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saved, setSaved] = useState<SavedInfo | null>(null);
  const [stale, setStale] = useState(false);
  const pdf = useReportPdf();

  // load settings (defaults for units/method/limit) once, then the form: a reopened history entry or a fresh one
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settings = await getAppSettings(db);
      const d: Defaults = settings;
      const stored = historyId !== undefined ? await getCalculation(db, historyId) : null;
      if (cancelled) return;
      setDefaults(d);
      setForm(stored && stored.kind === kind ? formFromInput(kind, stored.input, conv, d) : initialForm(kind, d, conv));
    })();
    return () => {
      cancelled = true;
    };
    // conv is read once: a language switch while the screen is open keeps the typed text as it is
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, kind, historyId]);

  const built = useMemo(() => (form ? buildInput(kind, form as never, conv) : null), [form, kind, conv]);
  const result = useMemo(() => (built ? compute(kind, built.input as never) : null), [built, kind]);

  // ---- history: after a 2 s pause, and when the screen is left (blur or unmount) ----
  const latest = useRef<{ input: unknown; result: NonNullable<typeof result> } | null>(null);
  useEffect(() => {
    latest.current = built && result && result.ok ? { input: built.input, result } : null;
  }, [built, result]);
  const flushHistory = useCallback(() => {
    const d = latest.current;
    if (!d) return;
    recordHistory(db, { kind, input: d.input, result: d.result }).catch(() => undefined); // a stale/invalid draft is simply not recorded
  }, [db, kind]);
  useEffect(() => {
    if (!result || !result.ok) return;
    const id = setTimeout(flushHistory, 2000);
    return () => clearTimeout(id);
  }, [result, flushHistory]);
  useEffect(() => {
    const unsub = navigation.addListener('blur', flushHistory);
    return () => {
      unsub();
      flushHistory();
    };
  }, [navigation, flushHistory]);

  if (!form || !built || !result || !defaults) return <View testID="calc-loading" />;

  const set = (patch: Partial<FormByKind[CalcKind]>) => {
    setStale(false);
    setSaved(null);
    setForm((f) => (f ? ({ ...f, ...patch } as FormByKind[CalcKind]) : f));
  };
  const hasProblems = Object.keys(built.problems).length > 0;
  const incomplete = !result.ok && result.errors.every((e) => INCOMPLETE_CODES.has(e.code));
  const shownErrors = result.ok ? [] : incomplete ? [] : result.errors;

  const onStale = () => {
    // D54: the result a sheet was opened with no longer belongs to the input — show the fresh one, let the user save again
    setStale(true);
  };

  const stripHint = result.ok && !hasProblems ? null : kind === 'ohm' ? t('calc.ohm.hint') : incomplete || hasProblems ? t('calc.incomplete') : displayText(result.errors[0], lang);

  return (
    <View testID={`calc-${kind}`} style={{ flex: 1 }}>
      <Stack.Screen options={{ title: t(KIND_TITLE[kind]) }} />
      <ResultStrip result={result.ok && !hasProblems ? result : null} hint={stripHint} />
      <Screen>
      {kind === 'current' || kind === 'ohm' ? (
        <Chips
          testIDPrefix="calc-mode"
          value={kind}
          onChange={(k) => router.replace(`/calc/${k}`)}
          options={[
            { value: 'current', label: t('calc.current') },
            { value: 'ohm', label: t('calc.ohm') },
          ]}
        />
      ) : null}

      <CalcFields
        kind={kind}
        form={form as never}
        set={set as never}
        problems={built.problems}
        conv={conv}
        optionsOpen={optionsOpen}
        setOptionsOpen={setOptionsOpen}
      />

      {result.ok && !hasProblems ? (
        <ResultView result={result} onChangeAssumption={() => setOptionsOpen(true)} />
      ) : incomplete || hasProblems ? (
        <Card>
          <ThemedText testID="result-hint" themeColor="textSecondary">
            {kind === 'ohm' ? t('calc.ohm.hint') : t('calc.incomplete')}
          </ThemedText>
        </Card>
      ) : null}
      {shownErrors.length > 0 ? (
        <Card testID="result-errors">
          {shownErrors.map((e, i) => (
            <ThemedText key={`${e.code}-${i}`} testID={`error-${e.code}`} style={{ color: theme.danger }}>
              {displayText(e, lang)}
            </ThemedText>
          ))}
        </Card>
      ) : null}

      {stale ? (
        <ThemedText testID="stale-note" style={{ color: theme.warning }}>
          {t('calc.stale')}
        </ThemedText>
      ) : null}
      {saved ? (
        <Card testID="saved-banner">
          <ThemedText type="smallBold">{t('save.done', { project: saved.projectName })}</ThemedText>
          <LinkButton testID="saved-open-project" label={t('save.openProject')} onPress={() => router.push(`/project/${saved.projectId}`)} />
        </Card>
      ) : null}

      <Button testID="save-open" label={t('calc.actions.save')} disabled={!result.ok || hasProblems} onPress={() => setSaveOpen(true)} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Button
            testID="pdf-button"
            variant="secondary"
            label={t('calc.actions.pdf')}
            disabled={!result.ok || hasProblems || pdf.busy}
            onPress={() => {
              if (!result.ok) return;
              const draft = draftCalculation(kind, built.input, result, Date.now());
              void pdf.run((language, version) => buildCalculationReportFor(db, draft, language, version));
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            testID="reset-button"
            variant="secondary"
            label={t('calc.actions.reset')}
            onPress={() => {
              setForm(initialForm(kind, defaults, conv));
              setSaved(null);
              setStale(false);
            }}
          />
        </View>
      </View>

      <Notice note={pdf.note} />

      {saveOpen ? (
        <SaveSheet
          onClose={() => setSaveOpen(false)}
          draft={result.ok ? { kind, input: built.input, result } : null}
          onSaved={(info) => {
            setSaveOpen(false);
            setSaved(info);
          }}
          onStale={onStale}
        />
      ) : null}
      </Screen>
    </View>
  );
}
