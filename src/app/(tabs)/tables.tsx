// Tables tab (SPEC §9): the user's own cable tables. The empty state says in plain words why no table ships (D14).
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { Button } from '@/components/button';
import { Card, ListRow, Screen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { listCableTables, type CableTableListItem } from '@/db/tables';
import { useDb } from '@/hooks/use-db';
import { useT } from '@/hooks/use-t';

export default function TablesScreen() {
  const t = useT();
  const db = useDb();
  const router = useRouter();
  const [items, setItems] = useState<CableTableListItem[] | null>(null);
  useFocusEffect(useCallback(() => void listCableTables(db).then(setItems).catch(() => undefined), [db]));

  return (
    <Screen testID="tables-screen">
      <Button testID="table-new" label={'＋ ' + t('tables.new')} onPress={() => router.push('/table/new')} />
      {items && items.length === 0 ? (
        <Card>
          <ThemedText testID="tables-empty">{t('tables.empty')}</ThemedText>
        </Card>
      ) : null}
      {(items ?? []).map((x) => (
        <ListRow
          key={x.id}
          testID={`table-${x.id}`}
          title={x.name}
          subtitle={t('tables.summary', { material: t(`material.${x.material}`), rows: x.rowCount, max: x.insulationMaxC, ref: x.referenceAmbientC })}
          onPress={() => router.push(`/table/${x.id}`)}
        />
      ))}
    </Screen>
  );
}
