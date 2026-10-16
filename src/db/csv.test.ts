/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';
import { compute, ENGINE_VERSION } from '@/engine';
import { E1_INPUT, E3_INPUT, E4_INPUT } from '@/dev/seeds';

import { saveCalculation } from './calculations';
import { CALCULATIONS_HEADER, CSV_BOM, csvFileName, csvFormatFor, exportCalculationsCsv, guardCell, parseCsv, toCsv, unguardCell } from './csv';
import { migrate } from './migrations';
import { createCircuit, createProject } from './projects';

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

describe('formula-injection guard (SPEC §11)', () => {
  it('prefixes cells that start a formula and nothing else', () => {
    for (const bad of ['=1+1', '+49 170', '-5', '@SUM(A1)', '\tcmd', '\rcmd', "'=x"]) expect(guardCell(bad)).toBe(`'${bad}`);
    for (const ok of ['Küche', '12 m', 'a=b', '', 'x=1', ' text', "'plain"]) expect(guardCell(ok)).toBe(ok);
    // D65 (review #16): leading space, leading line feed, full-width signs
    for (const bad of [' =1+1', '\n=1', '  @x', '＝1+1', '＋1', ' \t=x', "' =1"]) {
      expect(guardCell(bad)).toBe(`'${bad}`);
      expect(unguardCell(guardCell(bad))).toBe(bad);
    }
  });
  it('is exactly reversible', () => {
    for (const v of ['=1', "'=1", "''@x", 'plain', "'plain", '-1']) expect(unguardCell(guardCell(v))).toBe(v);
  });
});

describe('CSV writer and reader', () => {
  it('writes BOM, CRLF and quotes only where needed; reads it back incl. line numbers', () => {
    const csv = toCsv(['a', 'b'], [['x,y', 'say "hi"'], ['multi\nline', ' pad '], ['', 'ü']]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}a,b\r\n"x,y","say ""hi"""\r\n"multi\nline"," pad "\r\n,ü\r\n`);
    const rows = parseCsv(csv);
    expect(rows.map((r) => r.cells)).toEqual([['a', 'b'], ['x,y', 'say "hi"'], ['multi\nline', ' pad '], ['', 'ü']]);
    expect(rows.map((r) => r.line)).toEqual([1, 2, 3, 5]);
  });
  it('reads LF, CR, blank lines and a missing final newline', () => {
    expect(parseCsv('a;b\n\n1;2\r3;4', ';').map((r) => r.cells)).toEqual([['a', 'b'], ['1', '2'], ['3', '4']]);
  });
  it('csvFileName', () => {
    expect(csvFileName('calculations', '2026-10-01')).toBe('electrician-toolkit-calculations-2026-10-01.csv');
  });
});

describe('calculations.csv', () => {
  async function seeded() {
    const db = await freshDb();
    const p = await createProject(db, { name: '=HYPERLINK("http://evil","x")' }, 1);
    const c = await createCircuit(db, p, { label: '@F3, "Küche"' }, 2);
    const at = Date.UTC(2026, 9, 1, 12, 30, 45);
    await saveCalculation(db, { projectId: p, circuitId: c }, { kind: 'vdrop', input: E1_INPUT, result: compute('vdrop', E1_INPUT as never), title: '-2+3', note: '+cmd|calc' }, at);
    await saveCalculation(db, { projectId: p }, { kind: 'loop', input: E4_INPUT, result: compute('loop', E4_INPUT as never) }, at + 1000);
    await saveCalculation(db, { projectId: p, circuitId: c }, { kind: 'coord', input: E3_INPUT, result: compute('coord', E3_INPUT as never) }, at + 2000);
    return { db, p };
  }

  it('has the header, BOM, ISO dates, point decimals, and guards every hostile text cell', async () => {
    const { db } = await seeded();
    const csv = await exportCalculationsCsv(db);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const rows = parseCsv(csv);
    expect(rows[0].cells).toEqual([...CALCULATIONS_HEADER]);
    expect(rows).toHaveLength(4);
    const vd = rows.find((r) => r.cells[2] === 'vdrop')!.cells;
    expect(vd[0]).toBe(`'=HYPERLINK("http://evil","x")`); // guarded project name
    expect(vd[1]).toBe(`'@F3, "Küche"`);
    expect(vd[3]).toBe("'-2+3");
    expect(vd[4]).toBe("'+cmd|calc");
    expect(vd[5]).toBe('2026-10-01T12:30:45Z');
    expect(vd[6]).toContain('voltage=230');
    expect(vd[6]).toContain('length.value=18');
    expect(vd[7]).toContain('deltaUPercent=3.756521739 %');
    expect(vd[7]).toContain('minSize=2.5 mm²');
    // v1.1 F1: the smallest size carries its scope (voltage drop only) in the file too
    expect(vd[7]).toContain('minSizeScope=voltage-drop limit only, check current-carrying capacity and protection separately');
    expect(vd[8]).toBe('M1');
    expect(vd[9]).toBe('3');
    expect(vd[10]).toBe('exceeds');
    expect(vd[11]).toBe(ENGINE_VERSION);
    // no cell of any row starts with a formula character
    for (const r of rows.slice(1)) for (const cell of r.cells) expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
    const loop = rows.find((r) => r.cells[2] === 'loop')!.cells;
    expect(loop[0]).toBe(`'=HYPERLINK("http://evil","x")`);
    expect(loop[1]).toBe(''); // project level
    expect(loop[7]).toContain('lMax=91.79899707 m');
    expect(rows.find((r) => r.cells[2] === 'coord')!.cells[7]).toContain('suggestion=B13');
  });

  it('writes the smallest-size scope in German when the UI is German (v1.1 F1)', async () => {
    const { db } = await seeded();
    const rows = parseCsv(await exportCalculationsCsv(db, {}, 'semicolon', 'de'), ';');
    expect(rows.find((r) => r.cells[2] === 'vdrop')!.cells[7]).toContain('minSizeScope=nur Spannungsfall-Grenzwert, Strombelastbarkeit und Schutz getrennt prüfen');
  });

  it('exports one project or all, saved calculations only', async () => {
    const { db, p } = await seeded();
    const other = await createProject(db, { name: 'Other' }, 3);
    await saveCalculation(db, { projectId: other }, { kind: 'vdrop', input: E1_INPUT, result: compute('vdrop', E1_INPUT as never) }, 4);
    await saveCalculation(db, { projectId: other }, { kind: 'vdrop', input: E1_INPUT, result: compute('vdrop', E1_INPUT as never) }, 5);
    expect(parseCsv(await exportCalculationsCsv(db))).toHaveLength(1 + 5);
    expect(parseCsv(await exportCalculationsCsv(db, { projectId: p }))).toHaveLength(1 + 3);
    expect(parseCsv(await exportCalculationsCsv(await freshDb()))).toHaveLength(1); // header only
  });

  it('survives a damaged stored result', async () => {
    const { db } = await seeded();
    // bypass the repository on purpose: a row as an old/damaged file might leave it (result is not an object)
    await db.runAsync("INSERT INTO calculations (project_id, kind, inputs_json, result_json, engine_version, profile_id, profile_version, created_at, updated_at) SELECT id, 'ohm', 'null', 'null', '0', 'eu-de', '1', 0, 0 FROM projects LIMIT 1");
    const rows = parseCsv(await exportCalculationsCsv(db));
    expect(rows).toHaveLength(5);
  });

  it('the semicolon variant (decimal-comma phones): `;` cells, decimal commas, same guard, reads back', async () => {
    const { db } = await seeded();
    const csv = await exportCalculationsCsv(db, {}, 'semicolon');
    expect(csv.startsWith(CSV_BOM + CALCULATIONS_HEADER.join(';') + '\r\n')).toBe(true);
    const rows = parseCsv(csv, ';');
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.cells.length === CALCULATIONS_HEADER.length)).toBe(true);
    const vd = rows.find((r) => r.cells[2] === 'vdrop')!.cells;
    expect(vd[0]).toBe(`'=HYPERLINK("http://evil","x")`);
    expect(vd[6]).toContain('voltage=230; ');
    expect(vd[7]).toContain('deltaUPercent=3,756521739 %');
    expect(vd[7]).not.toMatch(/\d\.\d/);
    expect(vd[9]).toBe('3');
    const loop = rows.find((r) => r.cells[2] === 'loop')!.cells;
    expect(loop[7]).toContain('lMax=91,79899707 m');
    // same content as the comma file once the decimal mark is undone (nothing else differs)
    const comma = parseCsv(await exportCalculationsCsv(db), ',');
    rows.forEach((r, i) => expect(r.cells.map((c) => c.replace(/(\d),(\d)/g, '$1.$2'))).toEqual(comma[i].cells));
    for (const r of rows.slice(1)) for (const cell of r.cells) expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
  });

  it('csvFormatFor picks the variant from the device decimal separator', () => {
    expect(csvFormatFor(',')).toBe('semicolon');
    expect(csvFormatFor('.')).toBe('comma');
    expect(csvFormatFor(null)).toBe('comma');
    expect(csvFormatFor(undefined)).toBe('comma');
  });
});
