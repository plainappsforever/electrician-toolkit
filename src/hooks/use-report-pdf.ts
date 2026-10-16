// "Make the PDF, then share it": one place for the calculator, saved-calculation and project screens. The PDF is created
// first; only a real file is shared, a failure shows a message and shares nothing (SPEC §13). Dev builds also show how long it took.
import Constants from 'expo-constants';
import { useState } from 'react';

import type { NoticeData } from '@/components/notice';
import { useT } from '@/hooks/use-t';
import { getLanguage } from '@/i18n';
import { formatBytes, shareFile } from '@/lib/files';
import { makeReportPdf } from '@/lib/pdf';
import type { BuiltReport } from '@/lib/report-data';

export const appVersion = (): string => Constants.expoConfig?.version ?? '';

export function useReportPdf() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<NoticeData | null>(null);

  /** `build` reads the data and returns the HTML (or null when the thing no longer exists). */
  async function run(build: (language: ReturnType<typeof getLanguage>, version: string) => Promise<BuiltReport | null>) {
    if (busy) return;
    setBusy(true);
    setNote({ kind: 'info', testID: 'pdf-working', text: t('pdf.working') });
    try {
      const t0 = Date.now();
      const report = await build(getLanguage(), appVersion());
      const buildMs = Date.now() - t0;
      if (!report) return setNote({ kind: 'error', testID: 'pdf-failed', text: t('pdf.failed', { reason: t('pdf.noProject') }) });
      const pdf = await makeReportPdf(report.html, report.paper, report.fileName);
      const text = t('pdf.done', { name: pdf.name, size: formatBytes(pdf.bytes), pages: pdf.pages });
      setNote({ kind: 'info', testID: 'pdf-done', text: __DEV__ ? `${text} pdf: ${pdf.bytes} bytes, ${pdf.ms} ms (html ${buildMs} ms, ${report.calculations} calculations)` : text });
      if ((await shareFile(pdf.file, 'application/pdf', 'com.adobe.pdf')) === 'unavailable') setNote({ kind: 'error', testID: 'pdf-failed', text: t('file.shareUnavailable') });
    } catch (e) {
      setNote({ kind: 'error', testID: 'pdf-failed', text: t('pdf.failed', { reason: e instanceof Error ? e.message : String(e) }) });
    } finally {
      setBusy(false);
    }
  }
  return { busy, note, run };
}
