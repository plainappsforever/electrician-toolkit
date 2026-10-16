// Backup & restore (SPEC §9, §11, U6, D57, D74). Back up = one JSON file through the share sheet. Restore = system file picker
// → size check BEFORE reading → validate everything → show what the file holds → ask once → keep a copy of the current
// data → replace everything in one transaction with a progress line → "Undo last restore" brings the kept copy back.
// Calculations CSV for all projects. Files leave only through the share sheet; no permission is asked.
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform } from 'react-native';

import { Button } from '@/components/button';
import { Card, Screen, SectionTitle } from '@/components/form';
import { Notice, type NoticeData } from '@/components/notice';
import { ThemedText } from '@/components/themed-text';
import { backupExceedsRestoreLimit, backupFileName, dataCounts, exportBackup, serializeBackup, type BackupFile, type BackupSummary, type DataCounts } from '@/db/backup';
import { csvFileName, csvFormatFor, exportCalculationsCsv } from '@/db/csv';
import { getLanguagePreference, getThemePreference } from '@/db/settings';
import { useDb } from '@/hooks/use-db';
import { useLanguage, useT } from '@/hooks/use-t';
import { applyLanguagePreference, type MessageKey } from '@/i18n';
import { checkBackupFile, replaceWithBackup, SafetyCopyError, type RestorePhase } from '@/lib/backup-flow';
import { BEFORE_RESTORE_FILE, cacheFile, documentFile, formatBytes, keepBackupForDev, pickFile, readTextChunked, shareFile, writeDocumentText, writeTextFile } from '@/lib/files';
import { formatDate, isoDate } from '@/lib/format';
import { deviceDecimalSeparator } from '@/lib/locale';
import { applyThemePreference } from '@/lib/theme-preference';

const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));
const seconds = (ms: number) => (ms / 1000).toFixed(1);

type Preview = { backup: BackupFile; summary: BackupSummary; name: string; checkMs: number };

export default function BackupScreen() {
  const t = useT();
  const lang = useLanguage();
  const db = useDb();
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<{ kind: 'checking' } | RestorePhase | null>(null);
  const [exportNote, setExportNote] = useState<NoticeData | null>(null);
  const [csvNote, setCsvNote] = useState<NoticeData | null>(null);
  const [restoreNote, setRestoreNote] = useState<NoticeData | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [hasBefore, setHasBefore] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void dataCounts(db).then(setCounts).catch(() => undefined);
      try {
        setHasBefore(documentFile(BEFORE_RESTORE_FILE) !== null);
      } catch {
        setHasBefore(false);
      }
    }, [db])
  );

  const contents = (c: { projects: number; circuits: number; calculations: number; history: number; cableTables: number }) =>
    t('backup.contents', { projects: c.projects, circuits: c.circuits, calculations: c.calculations, history: c.history, tables: c.cableTables });

  async function backUp() {
    setBusy(true);
    setExportNote(null);
    try {
      const backup = await exportBackup(db);
      const text = serializeBackup(backup);
      const name = backupFileName(isoDate(Date.now()));
      const file = cacheFile('backup', name);
      writeTextFile(file, text);
      keepBackupForDev(text);
      const calcs = backup.calculations.filter((c) => c.project_id !== null).length;
      const summary = contents({ projects: backup.projects.length, circuits: backup.circuits.length, calculations: calcs, history: backup.calculations.length - calcs, cableTables: backup.cableTables.length });
      const size = formatBytes(text.length);
      // D57: a backup above the restore limit is still created and shared, with a warning that this app cannot restore it
      const tooBig = backupExceedsRestoreLimit(text);
      setExportNote({ kind: tooBig ? 'warning' : 'info', testID: 'backup-done', text: `${t('backup.exported', { name, size, contents: summary })}${tooBig ? ` ${t('backup.exportTooBig', { size })}` : ''}` });
      if ((await shareFile(file, 'application/json', 'public.json')) === 'unavailable') setExportNote({ kind: 'error', testID: 'backup-failed', text: t('file.shareUnavailable') });
    } catch (e) {
      setExportNote({ kind: 'error', testID: 'backup-failed', text: t('backup.exportFailed', { reason: reason(e) }) });
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    setBusy(true);
    setCsvNote(null);
    try {
      // a phone with a decimal comma gets `;` between cells and decimal commas, as Excel there expects
      const format = csvFormatFor(deviceDecimalSeparator());
      const text = await exportCalculationsCsv(db, {}, format, lang);
      const name = csvFileName('calculations', isoDate(Date.now()));
      const file = cacheFile('csv', name);
      writeTextFile(file, text);
      setCsvNote({ kind: 'info', testID: 'csv-done', text: t('backup.csvDone', { name, size: formatBytes(text.length), format: t(format === 'semicolon' ? 'backup.csvSemicolon' : 'backup.csvComma') }) });
      if ((await shareFile(file, 'text/csv', 'public.comma-separated-values-text')) === 'unavailable') setCsvNote({ kind: 'error', testID: 'csv-failed', text: t('file.shareUnavailable') });
    } catch (e) {
      setCsvNote({ kind: 'error', testID: 'csv-failed', text: t('backup.csvFailed', { reason: reason(e) }) });
    } finally {
      setBusy(false);
    }
  }

  /** Picks (or takes the kept copy), checks the whole file, and shows what it holds. Nothing is written yet. */
  async function check(source: 'picker' | 'before') {
    setBusy(true);
    setRestoreNote(null);
    setPreview(null);
    try {
      let file: { name: string; size: number; text(): Promise<string> };
      if (source === 'picker') {
        const picked = await pickFile();
        if (picked.canceled) return;
        const f = picked.file;
        file = { name: f.name, size: f.size, text: () => readTextChunked(f) };
      } else {
        const kept = documentFile(BEFORE_RESTORE_FILE);
        if (!kept) return setRestoreNote({ kind: 'error', testID: 'restore-error', text: t('backup.undoMissing') });
        file = { name: t('backup.beforeName'), size: kept.size, text: () => readTextChunked(kept) };
      }
      setPhase({ kind: 'checking' });
      const checked = await checkBackupFile(file);
      if (!checked.ok) {
        const text = t(`backup.error.${checked.error.code}` as MessageKey);
        return setRestoreNote({ kind: 'error', testID: 'restore-error', text: t('backup.refused', { reason: text }) });
      }
      setPreview({ backup: checked.backup, summary: checked.summary, name: file.name, checkMs: checked.checkMs });
    } catch (e) {
      setRestoreNote({ kind: 'error', testID: 'restore-error', text: t('backup.pickFailed', { reason: reason(e) }) });
    } finally {
      setPhase(null);
      setBusy(false);
    }
  }

  async function replace() {
    if (!preview) return;
    const { backup, summary, checkMs } = preview;
    setBusy(true);
    setRestoreNote(null);
    try {
      const run = await replaceWithBackup(
        db,
        backup,
        (text) => writeDocumentText(BEFORE_RESTORE_FILE, text),
        (p) => setPhase(p)
      );
      // the restored settings hold theme and language: apply them now
      applyThemePreference(await getThemePreference(db));
      applyLanguagePreference(await getLanguagePreference(db));
      setPreview(null);
      if (run.kept) setHasBefore(true);
      void dataCounts(db).then(setCounts).catch(() => undefined);
      const took = seconds(checkMs + run.copyMs + run.writeMs);
      const text = t('backup.restored', { contents: contents(summary.counts), seconds: took });
      setRestoreNote({ kind: 'info', testID: 'restore-done', text: run.kept ? `${text} ${t('backup.kept')}` : text });
    } catch (e) {
      setRestoreNote({
        kind: 'error',
        testID: 'restore-failed',
        text: e instanceof SafetyCopyError ? t('backup.keepFailed', { reason: e.reason }) : t('backup.restoreFailed', { reason: reason(e) }),
      });
    } finally {
      setPhase(null);
      setBusy(false);
    }
  }

  const busyText =
    phase?.kind === 'checking'
      ? t('backup.checking')
      : phase?.kind === 'keeping'
        ? t('backup.keeping')
        : phase?.kind === 'writing' && phase.total > 0
          ? t('backup.writing', { done: phase.done, total: phase.total })
          : null;

  return (
    <Screen testID="backup-screen">
      <ThemedText>{t('backup.intro')}</ThemedText>
      {Platform.OS === 'android' ? (
        // v1.1 F10 (REVIEW_V1 #10, D82): allowBackup is off, so a new phone gets nothing unless the user exported a file
        <ThemedText testID="backup-android-note" type="smallBold" themeColor="warning">
          {t('backup.androidTransfer')}
        </ThemedText>
      ) : null}
      {counts ? (
        <Card>
          <ThemedText testID="backup-counts">{t('backup.counts', { projects: counts.projects, circuits: counts.circuits, calculations: counts.calculations, tables: counts.tables })}</ThemedText>
        </Card>
      ) : null}
      {busyText ? <Notice note={{ kind: 'info', testID: 'backup-working', text: busyText }} /> : null}

      <SectionTitle>{t('backup.section.backup')}</SectionTitle>
      <Button testID="backup-export" label={t('backup.export')} disabled={busy} onPress={backUp} />
      <Notice note={exportNote} />
      <ThemedText type="small" themeColor="textSecondary">
        {t('backup.plain')}
      </ThemedText>

      <SectionTitle>{t('backup.section.restore')}</SectionTitle>
      <Button testID="backup-restore" variant="secondary" label={t('backup.restore')} disabled={busy} onPress={() => check('picker')} />
      {hasBefore ? <Button testID="restore-undo" variant="secondary" label={t('backup.undo')} disabled={busy} onPress={() => check('before')} /> : null}
      {preview ? (
        <Card testID="restore-preview">
          <ThemedText testID="restore-summary" type="small">
            {t('backup.preview', { name: preview.name, date: formatDate(Date.parse(preview.summary.exportedAt) || 0, lang), contents: contents(preview.summary.counts) })}
          </ThemedText>
          {preview.summary.newerEngine > 0 ? (
            <ThemedText testID="restore-newer-engine" type="small" themeColor="warning">
              {t('backup.newerEngine', { count: preview.summary.newerEngine })}
            </ThemedText>
          ) : null}
          {preview.summary.unverified > 0 ? (
            <ThemedText testID="restore-unverified" type="small" themeColor="warning">
              {t('backup.unverified', { count: preview.summary.unverified })}
            </ThemedText>
          ) : null}
          <ThemedText type="small" themeColor="textSecondary">
            {t('backup.replaceAsk')}
          </ThemedText>
          <Button testID="restore-confirm" label={t('backup.replace')} disabled={busy} onPress={replace} />
        </Card>
      ) : null}
      <Notice note={restoreNote} />

      <SectionTitle>{t('backup.section.csv')}</SectionTitle>
      <Button testID="export-csv-all" variant="secondary" label={t('backup.csvAll')} disabled={busy} onPress={exportCsv} />
      <Notice note={csvNote} />
    </Screen>
  );
}
