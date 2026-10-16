// One project (SPEC §9): its fields, circuits with counts, project-level calculations, and the actions (report PDF, CSV).
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';

import { Button } from '@/components/button';
import { Card, ListRow, Screen, SectionTitle, TextField } from '@/components/form';
import { Notice, type NoticeData } from '@/components/notice';
import { ThemedText } from '@/components/themed-text';
import { listCalculations, type StoredCalculation } from '@/db/calculations';
import {
  createCircuit,
  deleteProject,
  duplicateProject,
  getProject,
  listCircuits,
  projectCounts,
  setProjectArchived,
  updateProject,
  type CircuitListItem,
  type Project,
} from '@/db/projects';
import { exportCalculationsCsv, csvFileName, csvFormatFor } from '@/db/csv';
import { useDb } from '@/hooks/use-db';
import { useReportPdf } from '@/hooks/use-report-pdf';
import { useLanguage, useT } from '@/hooks/use-t';
import { headlineText } from '@/lib/calc-label';
import { cacheFile, formatBytes, shareFile, writeTextFile } from '@/lib/files';
import { isoDate } from '@/lib/format';
import { KIND_TITLE } from '@/lib/kinds';
import { deviceDecimalSeparator } from '@/lib/locale';
import { buildProjectReportFor } from '@/lib/report-data';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = Number(id);
  const t = useT();
  const lang = useLanguage();
  const db = useDb();
  const router = useRouter();
  const [project, setProject] = useState<Project | null | undefined>(undefined);
  const [fields, setFields] = useState({ name: '', client: '', site: '', notes: '' });
  const [circuits, setCircuits] = useState<CircuitListItem[]>([]);
  const [calcs, setCalcs] = useState<StoredCalculation[]>([]);
  const [newCircuit, setNewCircuit] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const pdf = useReportPdf();
  const [csvNote, setCsvNote] = useState<NoticeData | null>(null);

  const load = useCallback(() => {
    (async () => {
      const p = await getProject(db, pid);
      setProject(p);
      if (!p) return;
      setFields((f) => (f.name === '' && f.client === '' && f.site === '' && f.notes === '' ? { name: p.name, client: p.client, site: p.site, notes: p.notes } : f));
      setCircuits(await listCircuits(db, pid));
      setCalcs(await listCalculations(db, pid, null));
    })();
  }, [db, pid]);
  useFocusEffect(load);

  if (project === undefined) return <View testID="project-loading" />;
  if (project === null)
    return (
      <Screen>
        <ThemedText testID="project-missing">{t('common.notFound')}</ThemedText>
      </Screen>
    );

  async function saveFields() {
    if (fields.name.trim() === '') return setMessage(t('save.error.projectName'));
    await updateProject(db, pid, fields);
    setMessage(t('common.saved'));
  }

  async function addCircuit() {
    if (newCircuit.trim() === '') return;
    await createCircuit(db, pid, { label: newCircuit });
    setNewCircuit('');
    setCircuits(await listCircuits(db, pid));
  }

  async function exportCsv() {
    setCsvNote(null);
    try {
      const format = csvFormatFor(deviceDecimalSeparator());
      const text = await exportCalculationsCsv(db, { projectId: pid }, format, lang);
      const name = csvFileName('calculations', isoDate(Date.now()));
      const file = cacheFile('csv', name);
      writeTextFile(file, text);
      const fmt = t(format === 'semicolon' ? 'backup.csvSemicolon' : 'backup.csvComma');
      setCsvNote({ kind: 'info', testID: 'csv-done', text: t('backup.csvDone', { name, size: formatBytes(text.length), format: fmt }) });
      if ((await shareFile(file, 'text/csv', 'public.comma-separated-values-text')) === 'unavailable') setCsvNote({ kind: 'error', testID: 'csv-failed', text: t('file.shareUnavailable') });
    } catch (e) {
      setCsvNote({ kind: 'error', testID: 'csv-failed', text: t('backup.csvFailed', { reason: e instanceof Error ? e.message : String(e) }) });
    }
  }

  async function confirmDelete() {
    const counts = await projectCounts(db, pid);
    Alert.alert(t('project.delete.title'), t('project.delete.body', { circuits: counts.circuits, calculations: counts.calculations }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await deleteProject(db, pid);
          router.dismissTo('/projects');
        },
      },
    ]);
  }

  return (
    <Screen testID="project-screen">
      <Stack.Screen options={{ title: project.name }} />
      <TextField kind="text" label={t('report.project')} testID="project-name" value={fields.name} onChangeText={(name) => setFields({ ...fields, name })} />
      <TextField kind="text" label={t('report.client')} testID="project-client" value={fields.client} onChangeText={(client) => setFields({ ...fields, client })} />
      <TextField kind="text" label={t('report.site')} testID="project-site" value={fields.site} onChangeText={(site) => setFields({ ...fields, site })} />
      <TextField kind="text" multiline label={t('report.notes')} testID="project-notes" value={fields.notes} onChangeText={(notes) => setFields({ ...fields, notes })} />
      <Button testID="project-save" label={t('common.save')} onPress={saveFields} />
      {message ? <ThemedText testID="project-message" type="small" themeColor="textSecondary">{message}</ThemedText> : null}

      <SectionTitle>{t('project.circuits')}</SectionTitle>
      {circuits.map((c) => (
        <ListRow key={c.id} testID={`circuit-${c.id}`} title={c.label} subtitle={t('project.calcCount', { count: c.calculationCount })} onPress={() => router.push(`/circuit/${c.id}`)} />
      ))}
      <Card>
        <TextField kind="text" label={t('save.circuitLabel')} testID="new-circuit-label" value={newCircuit} onChangeText={setNewCircuit} />
        <Button testID="circuit-add" variant="secondary" label={'＋ ' + t('save.newCircuit')} onPress={addCircuit} />
      </Card>

      <SectionTitle>{t('project.projectLevel')}</SectionTitle>
      {calcs.length === 0 ? <ThemedText type="small" themeColor="textSecondary">{t('project.noCalcs')}</ThemedText> : null}
      {calcs.map((c) => (
        <ListRow
          key={c.id}
          testID={`calc-${c.id}`}
          title={c.title || t(KIND_TITLE[c.kind])}
          subtitle={`${t(KIND_TITLE[c.kind])} · ${headlineText(c, lang)}`}
          onPress={() => router.push(`/saved/${c.id}`)}
        />
      ))}

      <SectionTitle>{t('project.actions')}</SectionTitle>
      <Button testID="project-report" variant="secondary" label={t('project.report')} disabled={pdf.busy} onPress={() => void pdf.run((language, version) => buildProjectReportFor(db, pid, language, version))} />
      <Notice note={pdf.note} />
      <Button testID="project-csv" variant="secondary" label={t('project.exportCsv')} onPress={exportCsv} />
      <Notice note={csvNote} />
      <Button
        testID="project-duplicate"
        variant="secondary"
        label={t('project.duplicate')}
        onPress={async () => {
          const copy = await duplicateProject(db, pid);
          router.replace(`/project/${copy}`);
        }}
      />
      <Button
        testID="project-archive"
        variant="secondary"
        label={project.archived ? t('project.unarchive') : t('project.archive')}
        onPress={async () => {
          await setProjectArchived(db, pid, !project.archived);
          load();
        }}
      />
      <Button testID="project-delete" variant="secondary" label={t('project.deleteButton')} onPress={confirmDelete} />
    </Screen>
  );
}
