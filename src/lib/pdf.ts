// HTML → PDF file (SPEC §12): expo-print prints the report HTML into a PDF in the cache, which is renamed to
// `<project>-<date>.pdf` and handed to the share sheet. A failure or a stuck print engine gives a message and no file.
import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

import type { Paper } from '@/db/settings';

import { cacheFile, keepFileForDev } from './files';
import { PAPER_POINTS } from './report-html';
import { PRINT_PROFILE, printHtml, type PrintMargins, type PrintPlatform } from './print-html';

/** A PDF normally takes 0.5–3 s; far beyond that the print engine is stuck. */
export const PDF_TIMEOUT_MS = 60_000;
export const REPORT_DIR = 'reports';

export type ReportPdf = { file: File; name: string; pages: number; bytes: number; ms: number; devCopy: string | null };

/** Number of `/Type /Page` objects: expo-print's `numberOfPages` is not trusted on Android. */
export function countPdfPages(bytes: Uint8Array): number {
  let s = '';
  const CHUNK = 0x2000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return (s.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The PDF took too long and was stopped.')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** `zoomOverride`: only the development probe passes it, to re-measure a print engine (D75). */
export async function makeReportPdf(html: string, paper: Paper, fileName: string, platformOverride?: PrintPlatform, zoomOverride?: number, margins?: PrintMargins): Promise<ReportPdf> {
  const platform: PrintPlatform = platformOverride ?? (Platform.OS === 'ios' ? 'ios' : 'android');
  const { width, height } = PAPER_POINTS[paper];
  const started = Date.now();
  const out = await withTimeout(Print.printToFileAsync({ html: printHtml(html, platform, paper, zoomOverride), width, height, ...(platform === 'ios' ? { margins: margins ?? PRINT_PROFILE.ios.margins ?? undefined } : {}) }), PDF_TIMEOUT_MS);
  const ms = Date.now() - started;
  const dest = cacheFile(REPORT_DIR, fileName);
  // File.move()/copy() onto a File target left nothing behind on Android (print-cost D62): copy the bytes by hand
  const bytes = await new File(out.uri).bytes();
  if (dest.exists) dest.delete();
  dest.create({ intermediates: true });
  dest.write(bytes);
  return { file: dest, name: fileName, pages: countPdfPages(bytes) || out.numberOfPages, bytes: bytes.length, ms, devCopy: keepFileForDev(dest) };
}
