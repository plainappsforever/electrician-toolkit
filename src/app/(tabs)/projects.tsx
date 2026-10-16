// Projects tab (SPEC §9): list with search and archive filter, create a project.
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { Button } from '@/components/button';
import { Card, Chips, ListRow, Screen, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { createProject, listProjects, type ProjectListItem } from '@/db/projects';
import { useDb } from '@/hooks/use-db';
import { useLanguage, useT } from '@/hooks/use-t';
import { formatDate } from '@/lib/format';

export default function ProjectsScreen() {
  const t = useT();
  const lang = useLanguage();
  const db = useDb();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'active' | 'archived' | 'all'>('active');
  const [items, setItems] = useState<ProjectListItem[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    listProjects(db, { search, archived: filter }).then(setItems).catch(() => undefined);
  }, [db, search, filter]);
  useFocusEffect(load);

  async function create() {
    if (name.trim() === '') return setError(t('save.error.projectName'));
    const id = await createProject(db, { name });
    setName('');
    setAdding(false);
    setError(null);
    router.push(`/project/${id}`);
  }

  return (
    <Screen testID="projects-screen">
      <TextField kind="text" label={t('projects.search')} testID="project-search" value={search} onChangeText={setSearch} autoCapitalize="none" />
      <Chips
        testIDPrefix="filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: t('projects.filter.active') },
          { value: 'archived', label: t('projects.filter.archived') },
          { value: 'all', label: t('projects.filter.all') },
        ]}
      />
      {adding ? (
        <Card>
          <TextField kind="text" label={t('save.projectName')} testID="new-project-name" value={name} onChangeText={setName} error={error} />
          <Button testID="project-create" label={t('projects.create')} onPress={create} />
        </Card>
      ) : (
        <Button testID="project-new" label={'＋ ' + t('save.newProject')} onPress={() => setAdding(true)} />
      )}
      {items && items.length === 0 ? (
        <ThemedText testID="projects-empty" themeColor="textSecondary">
          {search ? t('projects.noMatch') : t('projects.empty')}
        </ThemedText>
      ) : null}
      {(items ?? []).map((p) => (
        <ListRow
          key={p.id}
          testID={`project-${p.id}`}
          title={p.name}
          subtitle={[p.client, t('projects.counts', { circuits: p.circuitCount, calculations: p.calculationCount })].filter(Boolean).join(' · ')}
          right={formatDate(p.updatedAt, lang)}
          onPress={() => router.push(`/project/${p.id}`)}
        />
      ))}
    </Screen>
  );
}
