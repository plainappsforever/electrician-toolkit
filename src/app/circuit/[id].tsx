// One circuit (SPEC §9): label, notes, its saved calculations; delete with confirm.
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { Button } from '@/components/button';
import { ListRow, Screen, SectionTitle, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { listCalculations, type StoredCalculation } from '@/db/calculations';
import { deleteCircuit, getCircuit, updateCircuit, type Circuit } from '@/db/projects';
import { useDb } from '@/hooks/use-db';
import { useLanguage, useT } from '@/hooks/use-t';
import { headlineText } from '@/lib/calc-label';
import { KIND_TITLE } from '@/lib/kinds';

export default function CircuitScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cid = Number(id);
  const t = useT();
  const lang = useLanguage();
  const db = useDb();
  const router = useRouter();
  const [circuit, setCircuit] = useState<Circuit | null | undefined>(undefined);
  const [fields, setFields] = useState({ label: '', notes: '' });
  const [calcs, setCalcs] = useState<StoredCalculation[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    (async () => {
      const c = await getCircuit(db, cid);
      setCircuit(c);
      if (!c) return;
      setFields((f) => (f.label === '' && f.notes === '' ? { label: c.label, notes: c.notes } : f));
      setCalcs(await listCalculations(db, c.projectId, cid));
    })();
  }, [db, cid]);
  useFocusEffect(load);

  if (circuit === undefined) return <View testID="circuit-loading" />;
  if (circuit === null)
    return (
      <Screen>
        <ThemedText>{t('common.notFound')}</ThemedText>
      </Screen>
    );

  return (
    <Screen testID="circuit-screen">
      <Stack.Screen options={{ title: circuit.label }} />
      <TextField kind="text" label={t('report.circuit')} testID="circuit-label" value={fields.label} onChangeText={(label) => setFields({ ...fields, label })} />
      <TextField kind="text" multiline label={t('report.notes')} testID="circuit-notes" value={fields.notes} onChangeText={(notes) => setFields({ ...fields, notes })} />
      <Button
        testID="circuit-save"
        label={t('common.save')}
        onPress={async () => {
          if (fields.label.trim() === '') return setMessage(t('save.error.circuitLabel'));
          await updateCircuit(db, cid, fields);
          setMessage(t('common.saved'));
        }}
      />
      {message ? <ThemedText testID="circuit-message" type="small" themeColor="textSecondary">{message}</ThemedText> : null}

      <SectionTitle>{t('circuit.calculations')}</SectionTitle>
      {calcs.length === 0 ? <ThemedText type="small" themeColor="textSecondary">{t('project.noCalcs')}</ThemedText> : null}
      {calcs.map((c) => (
        <ListRow key={c.id} testID={`calc-${c.id}`} title={c.title || t(KIND_TITLE[c.kind])} subtitle={`${t(KIND_TITLE[c.kind])} · ${headlineText(c, lang)}`} onPress={() => router.push(`/saved/${c.id}`)} />
      ))}

      <Button
        testID="circuit-delete"
        variant="secondary"
        label={t('circuit.deleteButton')}
        onPress={() =>
          Alert.alert(t('circuit.delete.title'), t('circuit.delete.body', { calculations: calcs.length }), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: async () => {
                await deleteCircuit(db, cid);
                router.back();
              },
            },
          ])
        }
      />
    </Screen>
  );
}
