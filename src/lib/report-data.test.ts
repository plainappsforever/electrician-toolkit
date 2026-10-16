/** @jest-environment node */
import { createTestDb } from '../../test/node-sqlite-db';
import { E1_INPUT, loadSeed } from '@/dev/seeds';
import { listCalculations } from '@/db/calculations';
import { migrate } from '@/db/migrations';
import { saveSetting } from '@/db/settings';
import { compute } from '@/engine';

import { buildCalculationReportFor, buildProjectReportFor, draftCalculation } from './report-data';

async function seeded() {
  const db = createTestDb();
  await migrate(db);
  await loadSeed(db, 'e1', 1_000_000);
  return db;
}
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0);

describe('report data', () => {
  it('a project report holds every saved calculation, in the settings paper, with the company header and the note', async () => {
    const db = await seeded();
    await saveSetting(db, 'paper', 'Letter');
    await saveSetting(db, 'company.name', 'Elektro Müller');
    const r = await buildProjectReportFor(db, 1, 'en', '1.0.0', NOW);
    expect(r).not.toBeNull();
    expect(r!.paper).toBe('Letter');
    expect(r!.calculations).toBe(3);
    expect(r!.fileName).toBe('Müller-Küche-2026-10-03.pdf');
    expect(r!.html).toContain('size: Letter');
    expect(r!.html).toContain('Elektro Müller');
    expect(r!.html).toContain('resp-note');
    expect((r!.html.match(/<section class="calc">/g) ?? []).length).toBe(3);
    expect(r!.html).toContain('F3 Steckdosen');
  });

  it('German on request; an unknown project gives null', async () => {
    const db = await seeded();
    const r = await buildProjectReportFor(db, 1, 'de', '1.0.0', NOW);
    expect(r!.html).toContain('lang="de"');
    expect(r!.html).toContain('Rechenhilfe');
    expect(await buildProjectReportFor(db, 999, 'en', '1.0.0', NOW)).toBeNull();
  });

  it('a saved calculation prints with its project header; a screen draft says it is not saved', async () => {
    const db = await seeded();
    const [first] = await listCalculations(db, 1);
    const saved = await buildCalculationReportFor(db, first, 'en', '1.0.0', NOW);
    expect(saved.html).toContain('Müller, Küche');
    expect(saved.calculations).toBe(1);
    const draft = draftCalculation('vdrop', E1_INPUT, compute('vdrop', E1_INPUT as never) as never, NOW);
    const r = await buildCalculationReportFor(db, draft, 'en', '1.0.0', NOW);
    expect(r.html).toContain('not saved to a project');
    expect(r.html).toContain('3.76');
    expect(r.fileName).toBe('vdrop-2026-10-03.pdf');
  });
});
