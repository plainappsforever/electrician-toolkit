// Database → report HTML (SPEC §12, D49): reads one consistent snapshot (behind the write queue) and calls the pure
// builders. The logo and company header come from the settings; the language and paper are passed in (the screen's
// language, the paper setting). Saved calculations are printed from their frozen snapshot, never recomputed (D20).
import { toStored, type StoredCalculation } from '@/db/calculations';
import { getAppSettings } from '@/db/settings';
import { withRead } from '@/db/tx';
import type { Db } from '@/db/types';
import type { Language } from '@/i18n';

import { buildCalculationReport, buildProjectReport, type Paper, type ReportCircuit, type ReportContext, type ReportProject } from './report-html';
import { reportFileName } from './format';

export type BuiltReport = { html: string; fileName: string; paper: Paper; title: string; calculations: number };

export async function reportContext(db: Db, language: Language, appVersion: string, now: number): Promise<ReportContext> {
  const s = await getAppSettings(db);
  return { language, paper: s.paper, company: s.company, logoDataUri: s.logoDataUri, generatedAt: now, appVersion };
}

type CalcRow = Parameters<typeof toStored>[0];

/** The whole project: its circuits in order, each with its saved calculations, and the project-level ones first. */
export async function buildProjectReportFor(db: Db, projectId: number, language: Language, appVersion: string, now: number = Date.now()): Promise<BuiltReport | null> {
  const parts = await withRead(db, async (r) => {
    const p = await r.getFirstAsync<{ name: string; client: string; site: string; notes: string }>('SELECT name, client, site, notes FROM projects WHERE id = ?', projectId);
    if (!p) return null;
    const circuits = await r.getAllAsync<{ id: number; label: string; notes: string }>('SELECT id, label, notes FROM circuits WHERE project_id = ? ORDER BY sort, id', projectId);
    const rows = await r.getAllAsync<CalcRow>('SELECT * FROM calculations WHERE project_id = ? ORDER BY created_at, id', projectId);
    return { p, circuits, calcs: rows.map(toStored) };
  });
  if (!parts) return null;
  const ctx = await reportContext(db, language, appVersion, now);
  const project: ReportProject = { name: parts.p.name, client: parts.p.client, site: parts.p.site, notes: parts.p.notes };
  const circuits: ReportCircuit[] = parts.circuits.map((c) => ({ label: c.label, notes: c.notes, calculations: parts.calcs.filter((k) => k.circuitId === c.id) }));
  const projectLevel = parts.calcs.filter((k) => k.circuitId === null);
  return { html: buildProjectReport(project, circuits, projectLevel, ctx), fileName: reportFileName(project.name, now), paper: ctx.paper, title: project.name, calculations: parts.calcs.length };
}

/** One calculation: a saved one (with its project's header) or a draft built from the screen (`calc.id === 0`). */
export async function buildCalculationReportFor(db: Db, calc: StoredCalculation, language: Language, appVersion: string, now: number = Date.now()): Promise<BuiltReport> {
  const project =
    calc.projectId === null
      ? undefined
      : await withRead(db, (r) => r.getFirstAsync<ReportProject>('SELECT name, client, site, notes FROM projects WHERE id = ?', calc.projectId)).then((p) => p ?? undefined);
  const ctx = await reportContext(db, language, appVersion, now);
  const stem = calc.title.trim() !== '' ? calc.title : project?.name ?? calc.kind;
  return { html: buildCalculationReport(calc, ctx, project), fileName: reportFileName(stem, now), paper: ctx.paper, title: stem, calculations: 1 };
}

/** The calculation on a calculator screen as a document: not saved, so `projectId` is null (the report says "not saved to a project"). */
export function draftCalculation(kind: StoredCalculation['kind'], input: unknown, result: NonNullable<StoredCalculation['result']>, now: number): StoredCalculation {
  return {
    id: 0,
    projectId: null,
    circuitId: null,
    kind,
    title: '',
    note: '',
    input: result.usedInput ?? input,
    result,
    engineVersion: result.engineVersion,
    profileId: result.profileId,
    profileVersion: result.profileVersion,
    createdAt: now,
    updatedAt: now,
  };
}
