// A saved calculation (SPEC §9): the frozen result exactly as saved (D20), "Open as new calculation", title/note edit,
// delete. A record from another engine version says so (SPEC §13).
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { Button } from '@/components/button';
import { Card, Screen, SectionTitle, TextField } from '@/components/form';
import { Notice } from '@/components/notice';
import { ResultView } from '@/components/result-view';
import { ThemedText } from '@/components/themed-text';
import { deleteCalculation, getCalculation, updateCalculationText, type StoredCalculation } from '@/db/calculations';
import { useDb } from '@/hooks/use-db';
import { useReportPdf } from '@/hooks/use-report-pdf';
import { useLanguage, useT } from '@/hooks/use-t';
import { isNewerVersion } from '@/db/backup';
import { ENGINE_VERSION } from '@/engine';
import { translate } from '@/i18n';
import { describeInput } from '@/lib/report-html';
import { formatDate, formatNumber } from '@/lib/format';
import { KIND_TITLE } from '@/lib/kinds';
import { buildCalculationReportFor } from '@/lib/report-data';

export default function SavedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cid = Number(id);
  const t = useT();
  const db = useDb();
  const router = useRouter();
  const lang = useLanguage();
  const [calc, setCalc] = useState<StoredCalculation | null | undefined>(undefined);
  // edits typed so far; until the user types, the stored title and note are shown
  const [edits, setEdits] = useState<{ title?: string; note?: string }>({});
  const [message, setMessage] = useState<string | null>(null);
  const pdf = useReportPdf();

  const load = useCallback(() => {
    (async () => {
      const c = await getCalculation(db, cid);
      setCalc(c);
    })();
  }, [db, cid]);
  useFocusEffect(load);

  if (calc === undefined) return <View testID="saved-loading" />;
  if (calc === null)
    return (
      <Screen>
        <ThemedText>{t('common.notFound')}</ThemedText>
      </Screen>
    );

  const fields = { title: edits.title ?? calc.title, note: edits.note ?? calc.note };
  const fmt = { lang, tr: (k: Parameters<typeof translate>[1], p?: Record<string, string | number>) => translate(lang, k, p), num: formatNumber };
  const rows = describeInput(calc.kind, calc.input, fmt);
  // v1.1 (REVIEW_V1 #27): a record of a NEWER engine (restored from a newer app) gets its own message
  const newer = isNewerVersion(calc.engineVersion, ENGINE_VERSION);
  const older = !newer && calc.engineVersion !== ENGINE_VERSION;

  return (
    <Screen testID="saved-screen">
      <Stack.Screen options={{ title: calc.title || t(KIND_TITLE[calc.kind]) }} />
      <ThemedText type="small" themeColor="textSecondary">
        {t('report.computedWith', { engine: calc.engineVersion, profile: calc.profileId, pv: calc.profileVersion, date: formatDate(calc.createdAt, lang) })}
      </ThemedText>
      {older ? (
        <ThemedText testID="older-engine" type="smallBold">
          {t('saved.olderEngine', { engine: calc.engineVersion })}
        </ThemedText>
      ) : null}
      {newer ? (
        <ThemedText testID="newer-engine" type="smallBold" themeColor="warning">
          {t('saved.newerEngine', { engine: calc.engineVersion, current: ENGINE_VERSION })}
        </ThemedText>
      ) : null}

      <SectionTitle>{t('report.inputs')}</SectionTitle>
      <Card testID="saved-inputs">
        {rows.map((r, i) => (
          <View key={`${r.label}-${i}`} style={{ flexDirection: 'row', gap: 8 }}>
            <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1 }}>
              {r.label}
            </ThemedText>
            <ThemedText type="smallBold">{r.value}</ThemedText>
          </View>
        ))}
      </Card>

      {calc.result ? <ResultView result={calc.result} workingOpen /> : <ThemedText>{t('report.damaged')}</ThemedText>}

      <TextField kind="text" label={t('save.calcTitle')} testID="saved-title" value={fields.title} onChangeText={(title) => setEdits({ ...edits, title })} />
      <TextField kind="text" multiline label={t('report.notes')} testID="saved-note" value={fields.note} onChangeText={(note) => setEdits({ ...edits, note })} />
      <Button
        testID="saved-save"
        label={t('common.save')}
        onPress={async () => {
          await updateCalculationText(db, cid, fields);
          setMessage(t('common.saved'));
        }}
      />
      {message ? <ThemedText testID="saved-message" type="small" themeColor="textSecondary">{message}</ThemedText> : null}
      <Button testID="saved-pdf" variant="secondary" label={t('calc.actions.pdf')} disabled={pdf.busy || !calc.result} onPress={() => void pdf.run((language, version) => buildCalculationReportFor(db, calc, language, version))} />
      <Notice note={pdf.note} />
      <Button
        testID="saved-open-new"
        variant="secondary"
        label={t('saved.openAsNew')}
        onPress={() => router.push({ pathname: '/calc/[kind]', params: { kind: calc.kind, history: String(calc.id) } })}
      />
      <Button
        testID="saved-delete"
        variant="secondary"
        label={t('saved.deleteButton')}
        onPress={() =>
          Alert.alert(t('saved.delete.title'), t('saved.delete.body'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: async () => {
                await deleteCalculation(db, cid);
                router.back();
              },
            },
          ])
        }
      />
    </Screen>
  );
}
