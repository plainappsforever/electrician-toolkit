// Development-only PDF probe (V1_PLAN P6, D75): renders the report documents through the PRODUCTION path (report data →
// HTML → expo-print → file) into Documents/dev-out/ with a report.json, so scripts/pull-pdfs.sh can copy them to the Mac
// and scripts/verify-pdfs.mjs can re-read them with pdf.js (page count, A4/Letter size, font size, margins, text,
// footer on every page, logo image). Not part of any release bundle (loaded only as `__DEV__ ? require(…) : null`).
import { Directory, File, Paths } from 'expo-file-system';

import { saveCalculation, listCalculations } from '@/db/calculations';
import { saveSetting } from '@/db/settings';
import { withRead } from '@/db/tx';
import { makeReportPdf } from '@/lib/pdf';
import { buildCalculationReportFor, buildProjectReportFor, draftCalculation, type BuiltReport } from '@/lib/report-data';
import type { Db } from '@/db/types';
import { compute } from '@/engine';
import { loadSeed, E1_INPUT } from './seeds';
import { OUT_DIR } from './flags';

/** A small PNG (240 × 72, dark frame, yellow stroke) so the letterhead has a real image to print. */
export const PROBE_LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAABICAIAAABHru/dAAAA/0lEQVR42u3XuwkAIBBEwevEwMz+S7AgA3PtQRA/DLwKjmHhIuUifVM4gYCWrgfdWpceDWgBLQEtAS0BLaCBFtAS0BLQEtAPNGos53pAAw20aAZaW0E7HdDmGWjRDLSABppmmoH2Cwpo8wy0aAZaQANNM81A+wUFtHkGWjQDLaCBpplmoP2CAto8Ay2agQYaaKBpFtB+QaCBNs9Ai2aggQYaaJoFtF8QaKDNM9CiGWiggQaaZgHtFwQaaPMMNM00Aw206wFNs4D2CwIt8ww0zTQDDbSApllA+wWBlnkGmmaagQZaQEtAC2gJaAloCWgJaAEtAS2dBi19ENACWrq1CeTyzTUzppvuAAAAAElFTkSuQmCC';

export type ProbeEntry = { file: string; language: 'en' | 'de'; paper: 'A4' | 'Letter'; calculations: number; pages: number; bytes: number; ms: number; buildMs: number; zoom: number | null };

/** `zoom`: override the per-engine factor (re-measuring a new OS or WebView version); null = the production value. */
export async function runPdfProbe(db: Db, version: string, zoom: number | null = null): Promise<{ entries: ProbeEntry[]; json: string }> {
  await loadSeed(db, 'e1', Date.UTC(2026, 9, 3, 10, 0, 0));
  await saveSetting(db, 'company.name', 'Elektro Müller GmbH');
  await saveSetting(db, 'company.address', 'Hauptstraße 12\n12345 Beispielstadt');
  await saveSetting(db, 'company.phone', '+49 123 456789');
  await saveSetting(db, 'company.email', 'info@example.org');
  await saveSetting(db, 'company.regNo', 'HRB 12345');
  await saveSetting(db, 'logoDataUri', PROBE_LOGO);
  // the e1 project grows to 30 saved calculations (page-break and repeating-footer test)
  const pid = (await withRead(db, (r) => r.getFirstAsync<{ id: number }>('SELECT MIN(id) AS id FROM projects')))!.id;
  const base = await listCalculations(db, pid);
  for (let i = 0; base.length + i < 30; i++) {
    const src = base[i % base.length];
    await saveCalculation(db, { projectId: pid, circuitId: src.circuitId }, { kind: src.kind, input: src.input, result: compute(src.kind, src.input as never) as never, title: `Probe ${i + 1}` }, Date.UTC(2026, 9, 3, 10, 1 + i));
  }
  const draft = draftCalculation('vdrop', E1_INPUT, compute('vdrop', E1_INPUT as never) as never, Date.UTC(2026, 9, 3, 11, 0, 0));
  const entries: ProbeEntry[] = [];
  const jobs: { file: string; language: 'en' | 'de'; paper: 'A4' | 'Letter'; build: (language: 'en' | 'de', t0: number) => Promise<BuiltReport | null> }[] = [
    { file: 'single-en-a4.pdf', language: 'en', paper: 'A4', build: (l) => buildCalculationReportFor(db, draft, l, version, Date.UTC(2026, 9, 3, 11, 0, 0)) },
    { file: 'single-de-letter.pdf', language: 'de', paper: 'Letter', build: (l) => buildCalculationReportFor(db, { ...draft, projectId: pid }, l, version, Date.UTC(2026, 9, 3, 11, 0, 0)) },
    { file: 'project30-en-a4.pdf', language: 'en', paper: 'A4', build: (l) => buildProjectReportFor(db, pid, l, version, Date.UTC(2026, 9, 3, 11, 0, 0)) },
    { file: 'project30-de-letter.pdf', language: 'de', paper: 'Letter', build: (l) => buildProjectReportFor(db, pid, l, version, Date.UTC(2026, 9, 3, 11, 0, 0)) },
  ];
  for (const job of jobs) {
    await saveSetting(db, 'paper', job.paper);
    const t0 = Date.now();
    const built = await job.build(job.language, t0);
    if (!built) throw new Error(`probe: nothing to build for ${job.file}`);
    const buildMs = Date.now() - t0;
    const pdf = await makeReportPdf(built.html, built.paper, job.file, undefined, zoom ?? undefined);
    entries.push({ file: job.file, language: job.language, paper: job.paper, calculations: built.calculations, pages: pdf.pages, bytes: pdf.bytes, ms: pdf.ms, buildMs, zoom });
  }
  await saveSetting(db, 'paper', 'A4');
  const json = JSON.stringify({ version, entries }, null, 1);
  const dir = new Directory(Paths.document, OUT_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const out = new File(dir, 'report.json');
  if (out.exists) out.delete();
  out.create();
  out.write(json);
  return { entries, json };
}
