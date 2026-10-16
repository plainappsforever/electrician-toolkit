// Import a table CSV (SPEC §11, A12): choose a file with the system picker, or paste the text; all or nothing; every
// problem is listed with its line. A file is size-checked before it is read.
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Keyboard } from 'react-native';

import { Button } from '@/components/button';
import { Card, Screen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { importTableCsv, TABLE_LIMITS, tableProblemText, tableWarningText, type TableProblem, type TableWarning } from '@/db/tables';
import { useDb } from '@/hooks/use-db';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { pickFile } from '@/lib/files';

export default function ImportTableScreen() {
  const { id, csv } = useLocalSearchParams<{ id: string; csv?: string }>();
  const t = useT();
  const db = useDb();
  const router = useRouter();
  const theme = useTheme();
  const lang = useLanguage();
  // `csv` prefills the box for UI tests in the development build only
  const [text, setText] = useState(__DEV__ && typeof csv === 'string' ? csv : '');
  const [errors, setErrors] = useState<TableProblem[]>([]);
  const [warnings, setWarnings] = useState<TableWarning[]>([]);
  const [done, setDone] = useState<number | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);

  async function chooseFile() {
    setPickError(null);
    try {
      const picked = await pickFile();
      if (picked.canceled) return;
      setFileName(picked.file.name);
      // a UTF-8 character is at most 4 bytes: a file above that can never pass the character cap, so it is not read at all
      if (picked.file.size > TABLE_LIMITS.maxCsvChars * 4) {
        setDone(null);
        setWarnings([]);
        return setErrors([{ code: 'tooLarge', vars: { max: TABLE_LIMITS.maxCsvChars } }]);
      }
      const content = await picked.file.text();
      setText(content.length <= TABLE_LIMITS.maxCsvChars ? content : '');
      await run(content);
    } catch (e) {
      setPickError(t('tables.import.pickFailed', { reason: e instanceof Error ? e.message : String(e) }));
    }
  }

  async function run(source: string = text) {
    Keyboard.dismiss(); // the result card must not sit behind the open keyboard
    setDone(null);
    const r = await importTableCsv(db, Number(id), source);
    if (r.ok) {
      setErrors([]);
      setWarnings(r.warnings ?? []);
      setDone(r.rows.length);
    } else {
      setErrors(r.errors);
      setWarnings([]);
    }
  }

  return (
    <Screen testID="table-import-screen">
      <Stack.Screen options={{ title: t('tables.import') }} />
      <ThemedText type="small" themeColor="textSecondary">
        {t('tables.import.help')}
      </ThemedText>
      <Button testID="import-choose" label={t('tables.import.choose')} onPress={chooseFile} />
      {fileName ? (
        <ThemedText testID="import-file" type="small" themeColor="textSecondary">
          {t('tables.import.file', { name: fileName })}
        </ThemedText>
      ) : null}
      {pickError ? (
        <ThemedText testID="import-pick-error" type="small" style={{ color: theme.danger }}>
          {pickError}
        </ThemedText>
      ) : null}
      <TextField kind="text" multiline autoCapitalize="none" label="CSV" testID="import-csv-text" value={text} onChangeText={setText} placeholder={'size_mm2,iz_a\n1.5,20'} />
      <Button testID="import-run" variant="secondary" label={t('tables.import.run')} onPress={() => void run()} />
      {errors.length > 0 ? (
        <Card testID="import-errors">
          <ThemedText type="smallBold" style={{ color: theme.danger }}>
            {t('tables.import.refused')}
          </ThemedText>
          {errors.map((e, i) => (
            <ThemedText key={i} testID={`import-error-${i}`} type="small" style={{ color: theme.danger }}>
              {tableProblemText(e, lang)}
            </ThemedText>
          ))}
        </Card>
      ) : null}
      {done !== null ? (
        <Card testID="import-success">
          <ThemedText type="smallBold" style={{ color: theme.success }}>
            {t('tables.import.done', { count: done })}
          </ThemedText>
          {warnings.map((w, i) => (
            <ThemedText key={i} testID={`import-warning-${i}`} type="small" style={{ color: theme.warning }}>
              {tableWarningText(w, lang)}
            </ThemedText>
          ))}
          <Button testID="import-back" variant="secondary" label={t('tables.import.back')} onPress={() => router.replace(`/table/${id}`)} />
        </Card>
      ) : null}
    </Screen>
  );
}
