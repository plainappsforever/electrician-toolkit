// Device probes (V1_PLAN "P5 note"): the checks only a real expo-sqlite connection and Hermes can answer. The same code
// runs in Jest on the Node fake, so a probe that fails on a phone and passes in Node points at the platform, not at the
// probe. Development builds only (the `debug/probe` route); every probe WIPES the database first.
// Statements run on unit handles (`tx`, `r`), as the queue-usage scan requires.
import { wipeAllData, dataCounts, exportBackup, parseBackup, restoreBackup, serializeBackup } from '@/db/backup';
import { listHistory, recordHistory, saveCalculation } from '@/db/calculations';
import { createCircuit, createProject, deleteProject, listProjects } from '@/db/projects';
import { withRead, withTransaction, withWrite } from '@/db/tx';
import type { Db } from '@/db/types';
import { compute, type CalcInput } from '@/engine';
import { displayText, formatValue } from '@/lib/format';

import { E1_INPUT, E4_INPUT, loadSeed } from './seeds';

export type ProbeLine = { name: string; ok: boolean; detail: string };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const e1 = (current: number): CalcInput => ({ ...(E1_INPUT as object), current }) as CalcInput;

/** Runs `sql` in a unit and reports the abort message (null = it ran). */
async function attempt(db: Db, sql: string, ...params: (string | number | null)[]): Promise<string | null> {
  return withWrite(db, async (tx) => {
    try {
      await tx.runAsync(sql, ...params);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  });
}

export async function runDbProbes(db: Db): Promise<ProbeLine[]> {
  const out: ProbeLine[] = [];
  const add = (name: string, ok: boolean, detail = '') => out.push({ name, ok, detail });
  await wipeAllData(db);

  // 1. foreign keys are on for this connection
  const fk = await withRead(db, (r) => r.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys'));
  add('foreign_keys pragma', fk?.foreign_keys === 1, `PRAGMA foreign_keys = ${fk?.foreign_keys}`);

  // 2. cascade: deleting a project removes its circuits and calculations
  const p = await createProject(db, { name: 'Probe' });
  const c = await createCircuit(db, p, { label: 'F1' });
  const calc = compute('vdrop', E1_INPUT as never);
  await saveCalculation(db, { projectId: p, circuitId: c }, { kind: 'vdrop', input: E1_INPUT, result: calc });
  await deleteProject(db, p);
  const after = await dataCounts(db);
  add('cascade delete', after.projects === 0 && after.circuits === 0 && after.calculations === 0, JSON.stringify(after));

  // 3. the frozen-snapshot triggers abort every reviewer bypass (D56)
  const p2 = await createProject(db, { name: 'Probe 2' });
  const c2 = await createCircuit(db, p2, { label: 'F1' });
  const keep = await saveCalculation(db, { projectId: p2, circuitId: c2 }, { kind: 'vdrop', input: E1_INPUT, result: calc });
  const hist = await recordHistory(db, { kind: 'vdrop', input: e1(10), result: compute('vdrop', e1(10) as never) });
  const other = await createProject(db, { name: 'Other' });
  const otherCircuit = await createCircuit(db, other, { label: 'X' });
  const bypasses: [string, string, (string | number | null)[]][] = [
    ['rewrite inputs', 'UPDATE calculations SET inputs_json = ? WHERE id = ?', ['{}', keep]],
    ['rewrite result', 'UPDATE calculations SET result_json = ? WHERE id = ?', ['{}', keep]],
    ['change kind', "UPDATE calculations SET kind = 'loop' WHERE id = ?", [keep]],
    ['change engine version', "UPDATE calculations SET engine_version = '9' WHERE id = ?", [keep]],
    ['change created_at', 'UPDATE calculations SET created_at = 1 WHERE id = ?', [keep]],
    ['change id', 'UPDATE calculations SET id = 999999 WHERE id = ?', [keep]],
    ['detach (project_id NULL) to rewrite', 'UPDATE calculations SET project_id = NULL WHERE id = ?', [keep]],
    ['insert or replace the same id', "INSERT OR REPLACE INTO calculations (id, project_id, kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at) VALUES (?, ?, 'vdrop', '{}', '{}', '1', 'eu-de', '1', 1, 1)", [keep, p2]],
    ['promote a history row in place', 'UPDATE calculations SET project_id = ? WHERE id = ?', [p2, hist]],
    ['circuit of another project', 'UPDATE calculations SET circuit_id = ? WHERE id = ?', [otherCircuit, keep]],
    ['move a circuit to another project', 'UPDATE circuits SET project_id = ? WHERE id = ?', [other, c2]],
  ];
  for (const [name, sql, params] of bypasses) {
    const refused = await attempt(db, sql, ...params);
    add(`trigger aborts: ${name}`, refused !== null, refused ?? 'NOT refused');
  }
  const again = await withRead(db, (r) => r.getFirstAsync<{ inputs_json: string }>('SELECT inputs_json FROM calculations WHERE id = ?', keep));
  add('saved snapshot unchanged after the attempts', !!again && again.inputs_json === JSON.stringify(compute('vdrop', E1_INPUT as never).usedInput), '');
  const allowed = await attempt(db, "UPDATE calculations SET title = 'ok', note = 'ok', updated_at = 5 WHERE id = ?", keep);
  add('title and note stay editable', allowed === null, allowed ?? '');

  // 4. write queue on the real connection: 30 overlapping saves all land; a failing unit beside 5 saves loses none
  await wipeAllData(db);
  const p3 = await createProject(db, { name: 'Queue' });
  const t0 = now();
  await Promise.all(Array.from({ length: 30 }, (_, i) => saveCalculation(db, { projectId: p3 }, { kind: 'vdrop', input: e1(1 + i), result: compute('vdrop', e1(1 + i) as never) })));
  const n30 = (await dataCounts(db)).calculations;
  add('30 overlapping saves', n30 === 30, `${n30}/30 in ${Math.round(now() - t0)} ms`);
  const failing = withTransaction(db, async (tx) => {
    await tx.runAsync("INSERT INTO projects (name, created_at, updated_at) VALUES ('lost', 1, 1)");
    throw new Error('boom');
  }).catch(() => 'rolled back');
  const five = Promise.all(Array.from({ length: 5 }, (_, i) => saveCalculation(db, { projectId: p3 }, { kind: 'vdrop', input: e1(100 + i), result: compute('vdrop', e1(100 + i) as never) })));
  await Promise.all([failing, five]);
  const lost = await withRead(db, (r) => r.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM projects WHERE name = 'lost'"));
  const n35 = (await dataCounts(db)).calculations;
  add('failing unit beside 5 saves', n35 === 35 && lost?.n === 0, `${n35 - 30}/5 saves kept, rolled-back row present: ${lost?.n}`);

  // 5. history is ordered and trimmed by id, not by the clock (D63): newest recorded first although the clock goes back
  await wipeAllData(db);
  for (let i = 0; i < 5; i++) await recordHistory(db, { kind: 'vdrop', input: e1(10 + i), result: compute('vdrop', e1(10 + i) as never) }, 1_000_000 - i * 100_000);
  const h = await listHistory(db, 3);
  const currents = h.map((x) => (x.input as { current: number }).current);
  add('history newest first with the clock set back', currents.join() === '14,13,12', `currents ${currents.join(',')}`);

  // 6. search folds umlauts under this JS engine
  await createProject(db, { name: 'Ärztehaus Süd' });
  const found = await listProjects(db, { search: 'ärzte' });
  add('search "ärzte" finds "Ärztehaus"', found.length === 1, `${found.length} found; normalize ${typeof String.prototype.normalize}`);
  await wipeAllData(db);
  return out;
}

/** The display rule (D52) and Intl.NumberFormat under this JS engine (Hermes on a phone). */
export function runIntlProbes(): ProbeLine[] {
  const out: ProbeLine[] = [];
  const add = (name: string, ok: boolean, detail = '') => out.push({ name, ok, detail });
  const e4 = compute('loop', E4_INPUT as never);
  const lMax = e4.values.lMax;
  add('E4 L_max en', formatValue('lMax', lMax.value, lMax.unit, 'en') === '91.7 m', formatValue('lMax', lMax.value, lMax.unit, 'en'));
  add('E4 L_max de', formatValue('lMax', lMax.value, lMax.unit, 'de') === '91,7 m', formatValue('lMax', lMax.value, lMax.unit, 'de'));
  const v = compute('vdrop', { ...(E1_INPUT as object), length: { value: 14.39, unit: 'm' } } as never);
  const vt = displayText(v.checks[0], 'en');
  add('E1 at 14.39 m check text', /3\.01 %.*exceeds.*3 %/.test(vt), vt);
  const l = compute('loop', { ...(E4_INPUT as object), length: { value: 91.8, unit: 'm' } } as never);
  const lt = l.checks.map((c) => displayText(c, 'en')).join(' | ');
  add('E4 at 91.8 m check text', lt.includes('2.876 Ω > Zs_max 2.875 Ω'), lt);
  const e1r = compute('vdrop', E1_INPUT as never);
  const d = e1r.values.deltaUPercent;
  add('E1 3.76 % en', formatValue('deltaUPercent', d.value, d.unit, 'en') === '3.76 %', formatValue('deltaUPercent', d.value, d.unit, 'en'));
  add('E1 3,76 % de', formatValue('deltaUPercent', d.value, d.unit, 'de') === '3,76 %', formatValue('deltaUPercent', d.value, d.unit, 'de'));
  return out;
}

export type RestoreTiming = { fileMB: number; calculations: number; seedMs: number; exportMs: number; serializeMs: number; parseMs: number; restoreMs: number; ok: boolean; detail: string };

/** A13 / D57: the 56 MB `many` backup — validate and restore on this platform. */
export async function runRestoreTiming(db: Db): Promise<RestoreTiming> {
  let t = now();
  const counts = await loadSeed(db, 'many');
  const seedMs = now() - t;
  t = now();
  const backup = await exportBackup(db);
  const exportMs = now() - t;
  t = now();
  const text = serializeBackup(backup);
  const serializeMs = now() - t;
  const fileMB = text.length / (1024 * 1024);
  t = now();
  const parsed = parseBackup(text);
  const parseMs = now() - t;
  if (!parsed.ok) return { fileMB, calculations: counts.calculations, seedMs, exportMs, serializeMs, parseMs, restoreMs: 0, ok: false, detail: `parse refused: ${parsed.error.code}` };
  await wipeAllData(db);
  t = now();
  await restoreBackup(db, parsed.backup);
  const restoreMs = now() - t;
  const after = await dataCounts(db);
  const ok = after.calculations === counts.calculations && after.projects === counts.projects;
  await wipeAllData(db);
  return { fileMB, calculations: counts.calculations, seedMs, exportMs, serializeMs, parseMs, restoreMs, ok, detail: JSON.stringify(after) };
}
