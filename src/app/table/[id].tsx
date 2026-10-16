// Table editor (SPEC §9, U4): name, SOURCE NOTE (required: where the values come from, D14), material, θmax, θref,
// method label, loaded conductors, typed rows size → Iz; Import CSV (file picker or paste); Export CSV (share sheet). Rows get non-blocking
// plausibility hints (D61). Saving validates everything and writes in one unit; a refused table changes nothing.
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Keyboard, Pressable, View } from 'react-native';

import { Button } from '@/components/button';
import { Card, Chips, LinkButton, Screen, SectionTitle, TextField } from '@/components/form';
import { Notice, type NoticeData } from '@/components/notice';
import { ThemedText } from '@/components/themed-text';
import { KeyboardDoneHint } from '@/components/result-view';
import {
  createCableTable,
  deleteCableTable,
  getCableTable,
  replaceTableRows,
  serializeTableCsv,
  tableProblemText,
  tableWarnings,
  tableWarningText,
  TableValidationError,
  updateCableTable,
  type CableRow,
  type CableTableMeta,
  type TableProblem,
} from '@/db/tables';
import { useConvention } from '@/hooks/use-convention';
import { useDb } from '@/hooks/use-db';
import { useLanguage, useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import { parseNumber } from '@/engine/parse';
import { numText } from '@/lib/calc-form';
import { cacheFile, formatBytes, shareFile, writeTextFile } from '@/lib/files';
import { isoDate, safeFileStem } from '@/lib/format';

type RowText = { size: string; iz: string };
type Meta = { name: string; sourceNote: string; material: 'cu' | 'al'; max: string; ref: string; label: string; loaded: 'none' | '2' | '3' };

const BLANK: Meta = { name: '', sourceNote: '', material: 'cu', max: '70', ref: '30', label: '', loaded: 'none' };

export default function TableEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const tid = Number(id);
  const t = useT();
  const db = useDb();
  const router = useRouter();
  const theme = useTheme();
  const conv = useConvention();
  const lang = useLanguage();
  const [meta, setMeta] = useState<Meta>(BLANK);
  const [rows, setRows] = useState<RowText[]>(isNew ? [{ size: '', iz: '' }] : []);
  const [loaded, setLoaded] = useState(isNew);
  const [problems, setProblems] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<NoticeData | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (isNew || loaded) return;
      getCableTable(db, tid).then((x) => {
        if (!x) return;
        const tb = x.table;
        setMeta({ name: tb.name, sourceNote: tb.sourceNote, material: tb.material, max: numText(tb.insulationMaxC, conv), ref: numText(tb.referenceAmbientC, conv), label: tb.methodLabel, loaded: tb.loadedConductors ? (String(tb.loadedConductors) as '2' | '3') : 'none' });
        setRows(x.rows.map((r) => ({ size: numText(r.sizeMm2, conv), iz: numText(r.izA, conv) })));
        setLoaded(true);
      });
    }, [db, tid, isNew, loaded, conv])
  );

  // parse what is typed; a row with an unreadable cell is reported at save time and left out of the live hints
  const parsed = useMemo(() => {
    const out: CableRow[] = [];
    const bad: number[] = [];
    rows.forEach((r, i) => {
      if (r.size.trim() === '' && r.iz.trim() === '') return;
      const s = parseNumber(r.size, conv);
      const z = parseNumber(r.iz, conv);
      if (s.ok && z.ok) out.push({ sizeMm2: s.value, izA: z.value });
      else bad.push(i + 1);
    });
    return { rows: out, bad };
  }, [rows, conv]);
  const hints = useMemo(() => tableWarnings(parsed.rows), [parsed.rows]);

  function metaForSave(): { meta: CableTableMeta; errors: string[] } {
    const errors: string[] = [];
    const num = (text: string, label: string) => {
      const r = parseNumber(text, conv, { allowNegative: true });
      if (!r.ok) errors.push(t('form.errorField', { field: label }));
      return r.ok ? r.value : NaN;
    };
    return {
      meta: {
        name: meta.name,
        sourceNote: meta.sourceNote,
        material: meta.material,
        insulationMaxC: num(meta.max, t('field.insulationMax')),
        referenceAmbientC: num(meta.ref, t('field.referenceAmbient')),
        methodLabel: meta.label,
        loadedConductors: meta.loaded === 'none' ? null : (Number(meta.loaded) as 2 | 3),
      },
      errors,
    };
  }

  async function save(): Promise<number | null> {
    const { meta: m, errors } = metaForSave();
    const rowErrors = parsed.bad.map((n) => t('tables.rowError', { row: n }));
    if (errors.length + rowErrors.length > 0) {
      setProblems([...errors, ...rowErrors]);
      return null;
    }
    try {
      let savedId = tid;
      if (isNew) savedId = await createCableTable(db, m, parsed.rows);
      else {
        await updateCableTable(db, tid, m);
        await replaceTableRows(db, tid, parsed.rows);
      }
      setProblems([]);
      setMessage(t('common.saved'));
      return savedId;
    } catch (e) {
      if (e instanceof TableValidationError) setProblems(e.problems.map((p: TableProblem) => tableProblemText(p, lang)));
      else setProblems([t('save.error.failed')]);
      return null;
    }
  }

  async function importCsv() {
    const savedId = await save();
    if (savedId !== null) router.replace({ pathname: '/table/import', params: { id: String(savedId) } });
  }

  /** Saves what is typed (an unsaved or invalid table is not exported), then shares the stored rows as CSV in the UI language's form (D46). */
  async function exportCsv() {
    setExportNote(null);
    const savedId = await save();
    if (savedId === null) return;
    try {
      const stored = await getCableTable(db, savedId);
      if (!stored) throw new Error(t('common.notFound'));
      const text = serializeTableCsv(stored.rows, lang);
      const name = `${safeFileStem(stored.table.name, 'table')}-${isoDate(Date.now())}.csv`;
      const file = cacheFile('csv', name);
      writeTextFile(file, text);
      setExportNote({ kind: 'info', testID: 'table-export-done', text: t('tables.exported', { name, size: formatBytes(text.length) }) });
      if ((await shareFile(file, 'text/csv', 'public.comma-separated-values-text')) === 'unavailable') setExportNote({ kind: 'error', testID: 'table-export-failed', text: t('file.shareUnavailable') });
      if (isNew) router.replace(`/table/${savedId}`);
    } catch (e) {
      setExportNote({ kind: 'error', testID: 'table-export-failed', text: t('tables.exportFailed', { reason: e instanceof Error ? e.message : String(e) }) });
    }
  }

  const setRow = (i: number, patch: Partial<RowText>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  if (!loaded) return <View testID="table-loading" />;

  return (
    <View testID="table-screen" style={{ flex: 1 }}>
      <Stack.Screen options={{ title: meta.name || t('tables.new') }} />
      {/* a tap closes the keyboard (the decimal keyboards have no "done" key) */}
      <Pressable testID="dismiss-strip" accessible={false} onPress={() => Keyboard.dismiss()} style={{ padding: 12, paddingRight: 88, backgroundColor: theme.backgroundElement }}>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {t('tables.summary', { material: t(`material.${meta.material}`), rows: parsed.rows.length, max: meta.max, ref: meta.ref })}
        </ThemedText>
        <KeyboardDoneHint />
      </Pressable>
      <Screen>
      <TextField kind="text" label={t('tables.name')} testID="table-name" value={meta.name} onChangeText={(name) => setMeta({ ...meta, name })} />
      <TextField kind="text" multiline label={t('tables.sourceNote')} testID="table-source" hint={t('tables.sourceHint')} value={meta.sourceNote} onChangeText={(sourceNote) => setMeta({ ...meta, sourceNote })} />
      <Chips
        label={t('field.material')}
        testIDPrefix="table-material"
        value={meta.material}
        onChange={(material) => setMeta({ ...meta, material })}
        options={[
          { value: 'cu', label: t('material.cu') },
          { value: 'al', label: t('material.al') },
        ]}
      />
      <TextField kind="signed" label={t('field.insulationMax')} testID="table-max" unit="°C" value={meta.max} onChangeText={(max) => setMeta({ ...meta, max })} />
      <TextField kind="signed" label={t('field.referenceAmbient')} testID="table-ref" unit="°C" value={meta.ref} onChangeText={(ref) => setMeta({ ...meta, ref })} />
      <TextField kind="text" label={t('tables.methodLabel')} testID="table-label" value={meta.label} onChangeText={(label) => setMeta({ ...meta, label })} />
      <Chips
        label={t('tables.loaded')}
        testIDPrefix="table-loaded"
        value={meta.loaded}
        onChange={(loadedConductors) => setMeta({ ...meta, loaded: loadedConductors })}
        options={[
          { value: 'none', label: t('tables.loaded.none') },
          { value: '2', label: '2' },
          { value: '3', label: '3' },
        ]}
      />

      <SectionTitle>{t('tables.rows')}</SectionTitle>
      {rows.map((r, i) => (
        <Card key={i}>
          <TextField label={t('tables.rowSize')} testID={`row-size-${i}`} unit="mm²" value={r.size} onChangeText={(size) => setRow(i, { size })} />
          <TextField label={t('tables.rowIz')} testID={`row-iz-${i}`} unit="A" value={r.iz} onChangeText={(iz) => setRow(i, { iz })} />
          <LinkButton testID={`row-remove-${i}`} danger label={t('tables.rowRemove')} onPress={() => setRows((rs) => rs.filter((_, j) => j !== i))} />
        </Card>
      ))}
      <Button testID="row-add" variant="secondary" label={'＋ ' + t('tables.rowAdd')} onPress={() => setRows((rs) => [...rs, { size: '', iz: '' }])} />
      {hints.map((w, i) => (
        <ThemedText key={i} testID={`table-hint-${i}`} type="small" style={{ color: theme.warning }}>
          {tableWarningText(w, lang)}
        </ThemedText>
      ))}

      {problems.map((p, i) => (
        <ThemedText key={i} testID={`table-problem-${i}`} style={{ color: theme.danger }}>
          {p}
        </ThemedText>
      ))}
      {message && problems.length === 0 ? (
        <ThemedText testID="table-message" type="small" themeColor="textSecondary">
          {message}
        </ThemedText>
      ) : null}
      <Button
        testID="table-save"
        label={t('common.save')}
        onPress={async () => {
          const savedId = await save();
          if (savedId !== null && isNew) router.replace(`/table/${savedId}`);
        }}
      />
      <Button testID="table-import" variant="secondary" label={t('tables.import')} onPress={importCsv} />
      <Button testID="table-export" variant="secondary" label={t('tables.export')} onPress={exportCsv} />
      <Notice note={exportNote} />
      {!isNew ? (
        <Button
          testID="table-delete"
          variant="secondary"
          label={t('tables.deleteButton')}
          onPress={() =>
            Alert.alert(t('tables.delete.title'), t('tables.delete.body'), [
              { text: t('common.cancel'), style: 'cancel' },
              {
                text: t('common.delete'),
                style: 'destructive',
                onPress: async () => {
                  await deleteCableTable(db, tid);
                  router.back();
                },
              },
            ])
          }
        />
      ) : null}
      </Screen>
    </View>
  );
}
