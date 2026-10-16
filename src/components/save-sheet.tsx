// "Save to project…" (SPEC §9, U2): pick or create the project and the circuit, optional title, save. The data layer
// recomputes the result from the input and refuses one that does not belong to it (D54): then `onStale` tells the
// calculator screen to recompute and show the fresh result so the user can save again.
import { useEffect, useState } from 'react';
import { Keyboard, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card, ListRow, LinkButton, Screen, SectionTitle, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { saveCalculation, type CalculationDraft } from '@/db/calculations';
import { createCircuit, createProject, listCircuits, listProjects, type CircuitListItem, type ProjectListItem } from '@/db/projects';
import { withTransaction } from '@/db/tx';
import { DataError } from '@/db/util';
import { useDb } from '@/hooks/use-db';
import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';

export type SavedInfo = { projectId: number; projectName: string; circuitId: number | null; calculationId: number };

type Props = {
  onClose: () => void;
  draft: CalculationDraft | null;
  onSaved: (info: SavedInfo) => void;
  onStale: () => void;
};

export function SaveSheet({ onClose, draft, onSaved, onStale }: Props) {
  const t = useT();
  const db = useDb();
  const theme = useTheme();
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [circuits, setCircuits] = useState<CircuitListItem[]>([]);
  const [projectId, setProjectId] = useState<number | 'new' | null>(null);
  const [circuitId, setCircuitId] = useState<number | 'new' | null>(null);
  const [projectName, setProjectName] = useState('');
  const [circuitLabel, setCircuitLabel] = useState('');
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // the sheet is mounted only while it is open, so its state starts fresh; the project list loads on mount
  useEffect(() => {
    listProjects(db, { archived: 'active' }).then((list) => {
      setProjects(list);
      setProjectId(list.length === 0 ? 'new' : null);
    });
  }, [db]);

  function chooseProject(id: number | 'new') {
    setProjectId(id);
    setCircuitId(null);
    setCircuits([]);
    if (typeof id === 'number') listCircuits(db, id).then(setCircuits);
  }

  async function save() {
    if (!draft || busy) return;
    if (projectId === null) return setError(t('save.error.noProject'));
    if (projectId === 'new' && projectName.trim() === '') return setError(t('save.error.projectName'));
    setBusy(true);
    setError(null);
    try {
      const info = await withTransaction(db, async (tx) => {
        const pid = projectId === 'new' ? await createProject(tx, { name: projectName }) : projectId;
        let cid: number | null = null;
        if (circuitId === 'new' && circuitLabel.trim() !== '') cid = await createCircuit(tx, pid, { label: circuitLabel });
        else if (typeof circuitId === 'number') cid = circuitId;
        const calculationId = await saveCalculation(tx, { projectId: pid, circuitId: cid }, { ...draft, title });
        const name = projectId === 'new' ? projectName.trim() : (projects.find((p) => p.id === pid)?.name ?? '');
        return { projectId: pid, projectName: name, circuitId: cid, calculationId };
      });
      setTitle('');
      setProjectName('');
      setCircuitLabel('');
      onSaved(info);
    } catch (e) {
      if (e instanceof DataError && e.code === 'not_saveable') {
        onClose();
        onStale();
      } else {
        setError(t('save.error.failed'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modal, { backgroundColor: theme.background }]} testID="save-sheet">
        <Screen>
          <Pressable testID="sheet-heading" accessible={false} onPress={() => Keyboard.dismiss()}>
            <ThemedText type="subtitle">{t('save.title')}</ThemedText>
          </Pressable>
          <TextField kind="text" label={t('save.calcTitle')} testID="save-title" value={title} onChangeText={setTitle} />

          <SectionTitle>{t('save.project')}</SectionTitle>
          {projects.map((p) => (
            <ListRow key={p.id} testID={`save-project-${p.id}`} title={(projectId === p.id ? '✓ ' : '') + p.name} subtitle={p.client || undefined} onPress={() => chooseProject(p.id)} />
          ))}
          <ListRow testID="save-new-project" title={(projectId === 'new' ? '✓ ' : '') + '＋ ' + t('save.newProject')} onPress={() => chooseProject('new')} />
          {projectId === 'new' ? <TextField kind="text" label={t('save.projectName')} testID="save-project-name" value={projectName} onChangeText={setProjectName} /> : null}

          {projectId !== null ? (
            <Card>
              <SectionTitle>{t('save.circuit')}</SectionTitle>
              <ListRow testID="save-circuit-none" title={(circuitId === null ? '✓ ' : '') + t('save.noCircuit')} onPress={() => setCircuitId(null)} />
              {circuits.map((c) => (
                <ListRow key={c.id} testID={`save-circuit-${c.id}`} title={(circuitId === c.id ? '✓ ' : '') + c.label} onPress={() => setCircuitId(c.id)} />
              ))}
              <ListRow testID="save-new-circuit" title={(circuitId === 'new' ? '✓ ' : '') + '＋ ' + t('save.newCircuit')} onPress={() => setCircuitId('new')} />
              {circuitId === 'new' ? <TextField kind="text" label={t('save.circuitLabel')} testID="save-circuit-label" value={circuitLabel} onChangeText={setCircuitLabel} /> : null}
            </Card>
          ) : null}

          {error ? (
            <ThemedText testID="save-error" style={{ color: theme.danger }}>
              {error}
            </ThemedText>
          ) : null}
          <Button testID="save-confirm" label={t('save.confirm')} onPress={save} disabled={busy} />
          <LinkButton testID="save-cancel" label={t('common.cancel')} onPress={onClose} />
        </Screen>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, paddingTop: Spacing.five },
});
