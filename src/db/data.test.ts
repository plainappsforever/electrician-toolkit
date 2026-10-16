/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';
import { compute, ENGINE_VERSION } from '@/engine';
import { E1_INPUT, E3_INPUT, E4_INPUT } from '@/dev/seeds';

import {
  deleteCalculation,
  getCalculation,
  listCalculations,
  listHistory,
  openAsNew,
  recordHistory,
  saveCalculation,
  saveHistoryEntry,
  updateCalculationText,
} from './calculations';
import { migrate } from './migrations';
import { createCircuit, createProject, deleteCircuit, deleteProject, duplicateProject, getProject, listCircuits, listProjects, projectCounts, setProjectArchived, updateProject } from './projects';
import { clearSetting, getAppSettings, resolveSettings, saveSetting, setSetting, SETTING_SPECS, settingProblem } from './settings';
import { createCableTable, deleteCableTable, userTableRow, getCableTable } from './tables';
import { withTransaction } from './tx';
import { DataError } from './util';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}
const vdrop = () => ({ kind: 'vdrop' as const, input: E1_INPUT, result: compute('vdrop', E1_INPUT as never) });
const count = async (db: Awaited<ReturnType<typeof freshDb>>, table: string, where = '1=1') =>
  (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`))?.n;

describe('projects and circuits', () => {
  it('creates, lists with counts, searches, updates, archives and validates', async () => {
    const db = await freshDb();
    const a = await createProject(db, { name: '  Müller, Küche ', client: 'Müller' }, 1000);
    const b = await createProject(db, { name: 'Büro 100%_x' }, 2000);
    const c = await createCircuit(db, a, { label: 'F3 Steckdosen' }, 1500);
    await saveCalculation(db, { projectId: a, circuitId: c }, vdrop(), 1600);

    expect((await getProject(db, a))?.name).toBe('Müller, Küche');
    const all = await listProjects(db);
    expect(all.map((p) => p.id)).toEqual([a, b].sort((x, y) => (all.find((p) => p.id === y)?.updatedAt ?? 0) - (all.find((p) => p.id === x)?.updatedAt ?? 0)));
    expect(all.find((p) => p.id === a)).toMatchObject({ circuitCount: 1, calculationCount: 1 });
    expect((await listProjects(db, { search: 'müller' })).map((p) => p.id)).toEqual([a]);
    expect((await listProjects(db, { search: '100%_x' })).map((p) => p.id)).toEqual([b]); // LIKE metacharacters are literal
    expect(await listProjects(db, { search: '%' })).toHaveLength(1);
    // D62 (review #14): umlauts and ß, case-insensitive, at the start of a word
    const u = await createProject(db, { name: 'Ärztehaus Über Straße', client: 'ÖKO GmbH' }, 3000);
    for (const q of ['ärzte', 'ÄRZTE', 'über', 'Über', 'straße', 'STRASSE', 'öko', 'oko', 'arztehaus']) {
      expect([q, (await listProjects(db, { search: q })).map((p) => p.id)]).toEqual([q, [u]]);
    }
    expect((await listProjects(db, { search: 'MÜLLER' })).map((p) => p.id)).toEqual([a]);
    await deleteProject(db, u);

    await updateProject(db, a, { site: 'Musterstraße 1' }, 3000);
    expect((await getProject(db, a))?.site).toBe('Musterstraße 1');
    await setProjectArchived(db, b, true, 3100);
    expect((await listProjects(db)).map((p) => p.id)).toEqual([a]);
    expect((await listProjects(db, { archived: 'archived' })).map((p) => p.id)).toEqual([b]);
    expect(await listProjects(db, { archived: 'all' })).toHaveLength(2);

    await expect(createProject(db, { name: '   ' })).rejects.toBeInstanceOf(DataError);
    await expect(createCircuit(db, 999, { label: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateProject(db, 999, { name: 'x' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('delete confirms with counts and cascades; duplicate copies frozen snapshots', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P' }, 1);
    const c1 = await createCircuit(db, p, { label: 'C1' }, 2);
    const c2 = await createCircuit(db, p, { label: 'C2' }, 3);
    await saveCalculation(db, { projectId: p, circuitId: c1 }, vdrop(), 4);
    await saveCalculation(db, { projectId: p, circuitId: c2 }, { kind: 'loop', input: E4_INPUT, result: compute('loop', E4_INPUT as never) }, 5);
    await saveCalculation(db, { projectId: p }, vdrop(), 6);
    expect(await projectCounts(db, p)).toEqual({ circuits: 2, calculations: 3 });

    const copy = await duplicateProject(db, p, undefined, 100);
    expect(await projectCounts(db, copy)).toEqual({ circuits: 2, calculations: 3 });
    expect((await getProject(db, copy))?.name).toBe('P (copy)');
    const orig = await listCalculations(db, p);
    const dup = await listCalculations(db, copy);
    expect(dup.map((x) => [x.input, x.result, x.createdAt])).toEqual(orig.map((x) => [x.input, x.result, x.createdAt]));
    expect((await listCircuits(db, copy)).map((x) => x.calculationCount)).toEqual([1, 1]);

    await deleteCircuit(db, c1);
    expect(await projectCounts(db, p)).toEqual({ circuits: 1, calculations: 2 });
    await deleteProject(db, p);
    expect(await count(db, 'circuits')).toBe(2); // only the copy's
    expect(await count(db, 'calculations')).toBe(3);
  });
});

describe('saved calculations and history (D20, A5)', () => {
  it('saves a frozen snapshot with versions; refuses invalid results and foreign circuits', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P' });
    const q = await createProject(db, { name: 'Q' });
    const c = await createCircuit(db, q, { label: 'C' });
    const id = await saveCalculation(db, { projectId: p }, { ...vdrop(), title: 'Küche', note: 'n' }, 50);
    const saved = await getCalculation(db, id);
    expect(saved).toMatchObject({ projectId: p, circuitId: null, kind: 'vdrop', title: 'Küche', engineVersion: ENGINE_VERSION, profileId: 'eu-de', profileVersion: '1' });
    expect(saved?.input).toEqual(E1_INPUT);
    expect(saved?.result).toEqual(compute('vdrop', E1_INPUT as never));

    const bad = compute('vdrop', { ...(E1_INPUT as object), voltage: -1 } as never);
    await expect(saveCalculation(db, { projectId: p }, { kind: 'vdrop', input: {}, result: bad })).rejects.toMatchObject({ code: 'not_saveable' });
    await expect(saveCalculation(db, { projectId: p }, { ...vdrop(), kind: 'loop' })).rejects.toMatchObject({ code: 'not_saveable' });
    await expect(saveCalculation(db, { projectId: p, circuitId: c }, vdrop())).rejects.toMatchObject({ code: 'wrong_project' });
    await expect(saveCalculation(db, { projectId: 999 }, vdrop())).rejects.toMatchObject({ code: 'not_found' });
    expect(await count(db, 'calculations')).toBe(1);
  });

  it('A5: the stored JSON is unchanged after every setting changes and the table it used is deleted; only open-as-new recomputes', async () => {
    const db = await freshDb();
    const tableId = await createCableTable(db, { name: 'T', sourceNote: 'example', material: 'cu', insulationMaxC: 70, referenceAmbientC: 30, methodLabel: '', loadedConductors: null }, [
      { sizeMm2: 1.5, izA: 20 },
      { sizeMm2: 2.5, izA: 27 },
    ]);
    const t = (await getCableTable(db, tableId))!;
    const input = { ...(E3_INPUT as object), table: userTableRow(t.table, t.rows[0]) };
    const p = await createProject(db, { name: 'P' });
    const id = await saveCalculation(db, { projectId: p }, { kind: 'coord', input, result: compute('coord', input as never) });
    const before = await db.getFirstAsync<{ inputs_json: string; result_json: string; engine_version: string }>('SELECT inputs_json, result_json, engine_version FROM calculations WHERE id = ?', id);

    for (const key of Object.keys(SETTING_SPECS) as (keyof typeof SETTING_SPECS)[]) {
      const alt: Record<string, string> = { language: 'de', theme: 'dark', lengthUnit: 'ft', vdropMethod: 'M3', vdropLimitPreset: 'custom', vdropLimitPercent: '5', conductorTempC: '90', reactanceMohmPerM: '0.1', loopTempC: '90', cmin: '0.95', measuredFactor: '0.8', favorites: '["loop"]', paper: 'Letter', historyLimit: '10', logoDataUri: 'data:image/png;base64,iVBORw0KGgoAAAA' };
      await saveSetting(db, key, alt[key] ?? 'Changed');
    }
    await deleteCableTable(db, tableId);
    const after = await db.getFirstAsync<{ inputs_json: string; result_json: string; engine_version: string }>('SELECT inputs_json, result_json, engine_version FROM calculations WHERE id = ?', id);
    expect(after).toEqual(before);
    expect(JSON.parse(after!.inputs_json).table).toMatchObject({ izA: 20, sourceNote: 'example', tableName: 'T' }); // the copied row survives the table

    // "Open as new" recomputes with the current engine and writes nothing.
    const reopened = await openAsNew(db, id);
    expect(reopened?.result.ok).toBe(true);
    expect(reopened?.result.engineVersion).toBe(ENGINE_VERSION);
    expect(await db.getFirstAsync('SELECT inputs_json, result_json, engine_version FROM calculations WHERE id = ?', id)).toEqual(before);
    expect(await count(db, 'calculations')).toBe(1);
  });

  it('only title and note can be edited, in the database and in the repository', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P' });
    const id = await saveCalculation(db, { projectId: p }, vdrop(), 1);
    await updateCalculationText(db, id, { title: 'neu', note: 'Notiz' }, 9);
    expect(await getCalculation(db, id)).toMatchObject({ title: 'neu', note: 'Notiz', updatedAt: 9 });
    await expect(db.runAsync("UPDATE calculations SET result_json = '{}' WHERE id = ?", id)).rejects.toThrow('saved_calculation_frozen');
    await deleteCalculation(db, id);
    await expect(deleteCalculation(db, id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('history: capped at 100 in the same unit, identical newest entry refreshed, invalid results skipped', async () => {
    const db = await freshDb();
    for (let i = 1; i <= 105; i++) {
      const input = { ...(E1_INPUT as object), current: i } as never;
      await recordHistory(db, { kind: 'vdrop', input, result: compute('vdrop', input) }, 1000 + i);
    }
    expect(await count(db, 'calculations', 'project_id IS NULL')).toBe(100);
    const history = await listHistory(db, 200);
    expect(history).toHaveLength(100);
    expect((history[0].input as { current: number }).current).toBe(105); // newest first
    expect((history[99].input as { current: number }).current).toBe(6); // 1…5 were dropped

    const idA = await recordHistory(db, vdrop(), 5000);
    const idB = await recordHistory(db, vdrop(), 5001); // same inputs as the newest → refresh, no new row
    expect(idB).toBe(idA);
    expect(await count(db, 'calculations', 'project_id IS NULL')).toBe(100);

    expect(await recordHistory(db, { kind: 'vdrop', input: {}, result: compute('vdrop', {} as never) })).toBeNull();

    await saveSetting(db, 'historyLimit', '3');
    await recordHistory(db, { kind: 'loop', input: E4_INPUT, result: compute('loop', E4_INPUT as never) }, 6000);
    expect(await count(db, 'calculations', 'project_id IS NULL')).toBe(3);
  });

  it('history cap holds under 30 concurrent saves, and every save is kept', async () => {
    const db = await freshDb();
    await saveSetting(db, 'historyLimit', '10');
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => {
        const input = { ...(E1_INPUT as object), current: i + 1 } as never;
        return recordHistory(db, { kind: 'vdrop', input, result: compute('vdrop', input) }, 100 + i);
      })
    );
    const history = await listHistory(db, 100);
    expect(history).toHaveLength(10);
    expect(history.map((h) => (h.input as { current: number }).current).sort((a, b) => a - b)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  });

  it('saving a history entry creates a new frozen row; the history entry stays', async () => {
    const db = await freshDb();
    const h = (await recordHistory(db, vdrop(), 10))!;
    const p = await createProject(db, { name: 'P' });
    const c = await createCircuit(db, p, { label: 'C' });
    const id = await saveHistoryEntry(db, h, { projectId: p, circuitId: c }, { title: 'aus Verlauf' }, 20);
    expect(id).not.toBe(h);
    expect(await getCalculation(db, id)).toMatchObject({ projectId: p, circuitId: c, title: 'aus Verlauf', createdAt: 20 });
    expect((await getCalculation(db, h))?.projectId).toBeNull();
    await expect(saveHistoryEntry(db, id, { projectId: p })).rejects.toMatchObject({ code: 'not_found' }); // a saved row is not a history entry
  });

  it('concurrent saves, a failing unit and a rollback never lose or half-apply writes (queue)', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P' });
    const failing = withTransaction(db, async (tx) => {
      await saveCalculation(tx, { projectId: p }, vdrop(), 1);
      throw new Error('boom');
    });
    const others = Array.from({ length: 5 }, (_, i) => saveCalculation(db, { projectId: p }, vdrop(), 10 + i));
    await expect(failing).rejects.toThrow('boom');
    await Promise.all(others);
    expect(await count(db, 'calculations')).toBe(5);
  });
});

describe('history order by id, not by the clock (D63, review #10)', () => {
  it('a clock moved back keeps the newest entry, and the returned id exists', async () => {
    const db = await freshDb();
    const draft = (current: number) => {
      const input = { ...(E1_INPUT as object), current };
      return { kind: 'vdrop' as const, input, result: compute('vdrop', input as never) };
    };
    for (let i = 0; i < 100; i++) await recordHistory(db, draft(1 + i), 10_000 + i);
    const id = (await recordHistory(db, draft(7.77), 5_000))!;
    expect(await getCalculation(db, id)).not.toBeNull();
    const h = await listHistory(db, 100);
    expect(h).toHaveLength(100);
    expect(h[0].id).toBe(id);
    expect((h[0].input as { current: number }).current).toBe(7.77);
    // the same inputs again refresh the newest entry in place (D47), which stays on top
    expect(await recordHistory(db, draft(7.77), 4_000)).toBe(id);
    expect((await listHistory(db, 1))[0].id).toBe(id);
  });
});

describe('a frozen result always belongs to its input (D54, review finding 3)', () => {
  it('saveCalculation and recordHistory refuse a result that compute(kind, input) does not reproduce; nothing is written', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P' }, 1);
    const other = compute('vdrop', { ...(E1_INPUT as object), size: { value: 2.5, unit: 'mm2' } } as never);
    const stale = { kind: 'vdrop' as const, input: E1_INPUT, result: other };
    await expect(saveCalculation(db, { projectId: p }, stale, 2)).rejects.toMatchObject({ code: 'not_saveable' });
    await expect(recordHistory(db, stale, 2)).rejects.toMatchObject({ code: 'not_saveable' });
    // a tampered number, a tampered verdict text, a dropped warning
    const good = compute('vdrop', E1_INPUT as never);
    const num = JSON.parse(JSON.stringify(good));
    num.values.deltaUPercent.value *= 1 + 1e-9;
    const verdict = { ...good, texts: { ...good.texts, verdict: 'within' } };
    const quiet = { ...good, warnings: [] };
    for (const result of [num, verdict, quiet]) {
      await expect(saveCalculation(db, { projectId: p }, { kind: 'vdrop', input: E1_INPUT, result }, 3)).rejects.toMatchObject({ code: 'not_saveable' });
    }
    expect(await count(db, 'calculations')).toBe(0);
  });

  it('accepts a result equal within the D37 tolerance and stores the fresh result with the input the engine used', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P' }, 1);
    const dc = { system: 'dc', voltage: 24, current: 20, length: { value: 10, unit: 'm' }, material: 'cu', size: { value: 6, unit: 'mm2' }, cosPhi: 0.8, efficiency: 1.5, limitPercent: 3 };
    const result = JSON.parse(JSON.stringify(compute('vdrop', dc as never)));
    result.values.u.value *= 1 + 1e-14; // a JSON/engine round-off, not a different input
    const id = await saveCalculation(db, { projectId: p }, { kind: 'vdrop', input: dc, result }, 2);
    const s = await getCalculation(db, id);
    expect(s!.input).toEqual({ system: 'dc', voltage: 24, current: 20, length: { value: 10, unit: 'm' }, material: 'cu', size: { value: 6, unit: 'mm2' }, limitPercent: 3 });
    expect(s!.result).toEqual(compute('vdrop', dc as never));
    expect(compute('vdrop', s!.input as never)).toEqual(s!.result);
    const h = await recordHistory(db, { kind: 'vdrop', input: dc, result: compute('vdrop', dc as never) }, 3);
    expect((await getCalculation(db, h!))!.input).not.toHaveProperty('cosPhi');
  });

  it('saveHistoryEntry refuses a history row whose stored result its input does not reproduce', async () => {
    const db = await freshDb();
    const p = await createProject(db, { name: 'P' }, 1);
    const h = (await recordHistory(db, vdrop(), 2))!;
    await db.runAsync("UPDATE calculations SET result_json = replace(result_json, '\"exceeds\"', '\"within\"') WHERE id = ?", h);
    await expect(saveHistoryEntry(db, h, { projectId: p }, {}, 3)).rejects.toMatchObject({ code: 'not_saveable' });
    const ok = (await recordHistory(db, { kind: 'coord', input: E3_INPUT, result: compute('coord', E3_INPUT as never) }, 4))!;
    expect(await saveHistoryEntry(db, ok, { projectId: p }, {}, 5)).toBeGreaterThan(0);
  });
});

describe('settings', () => {
  it('defaults, validated writes, invalid stored values fall back, clear restores the default', async () => {
    const db = await freshDb();
    const d = await getAppSettings(db);
    expect(d).toMatchObject({ language: 'system', lengthUnit: 'm', vdropMethod: 'M1', vdropLimitPreset: 'din18015-1', conductorTempC: 70, cmin: 1, paper: 'A4', historyLimit: 100, favorites: [], logoDataUri: null });
    expect(d.measuredFactor).toBeCloseTo(2 / 3, 12);
    expect(d.company).toEqual({ name: '', address: '', phone: '', email: '', regNo: '' });

    await saveSetting(db, 'company.name', 'Elektro Müller');
    await saveSetting(db, 'favorites', '["vdrop","loop"]');
    expect(await getAppSettings(db)).toMatchObject({ company: { name: 'Elektro Müller' }, favorites: ['vdrop', 'loop'] });
    await expect(saveSetting(db, 'cmin', '1.5')).rejects.toThrow();
    await expect(saveSetting(db, 'paper', 'A3')).rejects.toThrow();
    await expect(saveSetting(db, 'favorites', '["nope"]')).rejects.toThrow();
    await expect(saveSetting(db, 'logoDataUri', 'data:text/html;base64,AAAA')).rejects.toThrow();

    await setSetting(db, 'cmin', 'garbage'); // damaged stored value → default
    expect((await getAppSettings(db)).cmin).toBe(1);
    await clearSetting(db, 'company.name');
    expect((await getAppSettings(db)).company.name).toBe('');
  });

  it('logo: PNG/JPEG data URIs up to 512 KB only', () => {
    const png = (bytes: number) => `data:image/png;base64,iVBORw0KGgo${'A'.repeat(Math.ceil((bytes * 4) / 3 / 4) * 4 - 12)}A`;
    expect(settingProblem('logoDataUri', png(1000))).toBeNull();
    expect(settingProblem('logoDataUri', png(512 * 1024 - 8))).toBeNull();
    expect(settingProblem('logoDataUri', png(600 * 1024))).toMatch(/512 KB/);
    expect(settingProblem('logoDataUri', 'data:image/svg+xml;base64,AAAA')).not.toBeNull();
    expect(settingProblem('logoDataUri', 'data:image/png;base64,"><script>')).not.toBeNull();
    expect(resolveSettings({ logoDataUri: 'data:image/png;base64,"><script>' }).logoDataUri).toBeNull();
    // review #20 (D65): the bytes must match the type — HTML or a GIF labelled as PNG/JPEG is refused
    expect(settingProblem('logoDataUri', 'data:image/png;base64,PHNjcmlwdD4=')).toMatch(/not a PNG or JPEG image/);
    expect(settingProblem('logoDataUri', 'data:image/jpeg;base64,iVBORw0KGgoAAAA')).toMatch(/not a PNG or JPEG image/);
    expect(settingProblem('logoDataUri', 'data:image/png;base64,R0lGODlhAQABAAAAACw=')).toMatch(/not a PNG or JPEG image/);
    expect(settingProblem('logoDataUri', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBeNull();
  });
});
