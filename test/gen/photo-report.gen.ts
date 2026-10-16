/**
 * @jest-environment node
 */
// Writes report HTML with photos and sign-off slots for the device-free PDF check (V1.5 phase A, docs/V15_LOG.md A6):
// scripts/html-to-pdf.swift renders each with macOS WebKit, scripts/check-photo-pdf.mjs re-reads the PDFs with pdf.js.
// The HTML goes through the iOS print profile (WKWebView, the same engine family as macOS WebKit).
// Run: PHOTO_REPORT_OUT=<dir> npx jest --testMatch '**/test/gen/photo-report.gen.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StoredCalculation } from '@/db/calculations';
import { E1_INPUT, E3_INPUT, E4_INPUT } from '@/dev/seeds';
import { compute, type CalcKind } from '@/engine';
import { printHtml } from '@/lib/print-html';
import { buildCalculationReport, buildProjectReport, PAPER_POINTS, type ReportContext, type ReportExtras, type ReportPhoto } from '@/lib/report-html';
import { signatureSvg } from '@/lib/signature';

const out = process.env.PHOTO_REPORT_OUT ?? '';
const photo = (name: string) => `data:image/jpeg;base64,${readFileSync(join(__dirname, '../fixtures/photos', name)).toString('base64')}`;
const stored = (kind: CalcKind, input: unknown, title: string): StoredCalculation => {
  const r = compute(kind, input as never);
  return { id: 1, projectId: 1, circuitId: 1, kind, title, note: '', input: r.usedInput, result: r, engineVersion: r.engineVersion, profileId: r.profileId, profileVersion: r.profileVersion, createdAt: Date.UTC(2026, 9, 1), updatedAt: 0 };
};
const ctx = (language: 'en' | 'de', paper: 'A4' | 'Letter'): ReportContext => ({
  language,
  paper,
  company: { name: 'Elektro Muster GmbH', address: 'Hauptstr. 1, 50667 Köln', phone: '0221 123456', email: '', regNo: '' },
  logoDataUri: null,
  generatedAt: Date.UTC(2026, 9, 15, 12),
  appVersion: '1.5.0',
});
// a finger signature: a few loops
const strokes = [Array.from({ length: 80 }, (_, i) => ({ x: i * 4, y: 30 + Math.sin(i / 4) * 20 + (i % 13) })), Array.from({ length: 20 }, (_, i) => ({ x: 120 + i * 3, y: 70 - i * 2 }))];
const ink = signatureSvg(strokes)!.svg;

it('writes the photo report HTML files and their expectations', () => {
  if (out === '') return;
  mkdirSync(out, { recursive: true });
  const board = photo('board-1200x900.jpg');
  const cable = photo('cable-480x640.jpg');
  const cases: { name: string; language: 'en' | 'de'; paper: 'A4' | 'Letter'; html: string; photos: ReportPhoto[] }[] = [];
  // 1. project, EN, A4: 6 photos over the three owner types, both signatures (one drawn, one blank)
  const six: ReportPhoto[] = [
    { dataUri: board, caption: 'Distribution board UV1, before', owner: 'project', ownerLabel: '' },
    { dataUri: cable, caption: 'Cable route kitchen', owner: 'project', ownerLabel: '' },
    { dataUri: board, caption: 'Breaker F3', owner: 'circuit', ownerLabel: 'F3 Sockets' },
    { dataUri: cable, caption: '', owner: 'circuit', ownerLabel: 'F3 Sockets' },
    { dataUri: board, caption: 'Measuring point', owner: 'calculation', ownerLabel: 'Voltage drop F3' },
    { dataUri: cable, caption: 'Terminal', owner: 'calculation', ownerLabel: 'Loop F3' },
  ];
  const extras = (photos: ReportPhoto[]): ReportExtras => ({ photos, signatures: [{ role: 'prepared', name: 'Max Muster', place: 'Köln', date: Date.UTC(2026, 9, 15), svg: ink }, { role: 'received', name: '', place: '', date: null, svg: null }] });
  const calcs = [stored('vdrop', E1_INPUT, 'Voltage drop F3'), stored('coord', E3_INPUT, 'Protection F3'), stored('loop', E4_INPUT, 'Loop F3')];
  cases.push({ name: 'project-en-a4-6photos', language: 'en', paper: 'A4', photos: six, html: buildProjectReport({ name: 'Müller kitchen', client: 'Familie Müller', site: 'Musterstraße 1', notes: '' }, [{ label: 'F3 Sockets', notes: '', calculations: calcs }], [], ctx('en', 'A4'), extras(six)) });
  // 2. one calculation, DE, Letter, 1 photo
  const one: ReportPhoto[] = [{ dataUri: board, caption: 'Verteiler UV1', owner: 'calculation', ownerLabel: 'Spannungsfall F3' }];
  cases.push({ name: 'calc-de-letter-1photo', language: 'de', paper: 'Letter', photos: one, html: buildCalculationReport(stored('vdrop', E1_INPUT, 'Spannungsfall F3'), ctx('de', 'Letter'), undefined, extras(one)) });
  // 3. project, DE, A4, 20 photos: the grid runs over several pages, no picture may be cut
  const twenty: ReportPhoto[] = Array.from({ length: 20 }, (_, i) => ({ dataUri: i % 2 ? cable : board, caption: `Foto ${i + 1}`, owner: 'project', ownerLabel: '' }));
  cases.push({ name: 'project-de-a4-20photos', language: 'de', paper: 'A4', photos: twenty, html: buildProjectReport({ name: 'Müller Küche', client: '', site: '', notes: '' }, [{ label: 'F3', notes: '', calculations: [calcs[0]] }], [], ctx('de', 'A4'), extras(twenty)) });
  const manifest = cases.map((c) => {
    writeFileSync(join(out, `${c.name}.html`), printHtml(c.html, 'ios', c.paper));
    return { name: c.name, language: c.language, paper: c.paper, size: PAPER_POINTS[c.paper], photos: c.photos.length, captions: c.photos.map((p) => p.caption).filter((x) => x !== ''), signature: c.language === 'en' ? ['Prepared by', 'Received by'] : ['Erstellt von', 'Entgegengenommen von'] };
  });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
  expect(manifest).toHaveLength(3);
});
