/**
 * @jest-environment node
 */
import { createTestDb } from '../../test/node-sqlite-db';

import { migrate } from './migrations';
import {
  createCableTable,
  deleteCableTable,
  getCableTable,
  importTableCsv,
  listCableTables,
  parseTableCsv,
  tableWarnings,
  tableWarningText,
  parseTableNumber,
  replaceTableRows,
  serializeTableCsv,
  tableProblemText,
  TableValidationError,
  updateCableTable,
  userTableRow,
  validateRows,
  validateTableMeta,
  type CableTableMeta,
} from './tables';

const META: CableTableMeta = { name: 'Meine Tabelle', sourceNote: 'Datenblatt Hersteller X, Tabelle 3', material: 'cu', insulationMaxC: 70, referenceAmbientC: 30, methodLabel: 'C', loadedConductors: 2 };
const ROWS = [
  { sizeMm2: 1.5, izA: 20 },
  { sizeMm2: 2.5, izA: 27 },
  { sizeMm2: 4, izA: 36 },
];

async function freshDb() {
  const db = createTestDb();
  await migrate(db);
  return db;
}

describe('table number cells', () => {
  it('accepts decimal point and comma, refuses signs, units, exponents and ambiguous groups', () => {
    expect(parseTableNumber('1.5')).toEqual({ ok: true, value: 1.5 });
    expect(parseTableNumber(' 1,5 ')).toEqual({ ok: true, value: 1.5 });
    expect(parseTableNumber('16')).toEqual({ ok: true, value: 16 });
    expect(parseTableNumber('0.125')).toEqual({ ok: true, value: 0.125 });
    expect(parseTableNumber('1.25')).toEqual({ ok: true, value: 1.25 });
    for (const bad of ['', '-1', '+2', '1e3', '2.5 mm²', '1.2.3', '1,234.5', 'abc', '١٢']) expect(parseTableNumber(bad)).toMatchObject({ ok: false, reason: 'notNumber' });
    for (const amb of ['1.500', '2,500', '10.125', '999,999']) expect(parseTableNumber(amb)).toMatchObject({ ok: false, reason: 'ambiguous' });
  });
});

describe('table CSV import (A12)', () => {
  it('reads header size_mm2,iz_a with comma and point', () => {
    expect(parseTableCsv('size_mm2,iz_a\n1.5,20\n2.5,27\n4,36\n')).toEqual({ ok: true, rows: ROWS });
  });
  it('reads ";" with decimal comma, BOM, CRLF, quotes, trailing delimiters, unsorted rows (returned sorted)', () => {
    const csv = '﻿Size_mm2;IZ_A;\r\n"4";36;\r\n1,5;20,0;\r\n\r\n2,5;27\r\n';
    expect(parseTableCsv(csv)).toEqual({ ok: true, rows: ROWS.map((r) => ({ ...r })) });
  });
  it('D60 (review #12): a trailing empty cell is accepted only when the header had one too', () => {
    // `1,5,` under a comma header: decimal comma with Iz left empty — not "size 1, Iz 5"
    const r = parseTableCsv('size_mm2,iz_a\n1,5,\n2.5,27\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => `${e.line}:${e.code}`)).toEqual(['2:columns']);
    expect(parseTableCsv('size_mm2;iz_a\n1,5;20;\n').ok).toBe(false);
    // the Excel pattern: trailing separator on the header and the rows
    expect(parseTableCsv('size_mm2,iz_a,\n1.5,20,\n2.5,27\n')).toEqual({ ok: true, rows: [{ sizeMm2: 1.5, izA: 20 }, { sizeMm2: 2.5, izA: 27 }] });
    // one trailing header cell allows one trailing row cell, not two
    expect(parseTableCsv('size_mm2,iz_a,\n1.5,20,,\n').ok).toBe(false);
  });
  it('D61 (review #13): non-blocking warnings for a non-IEC size (AWG/kcmil typed as mm²) and an implausible Iz/S', () => {
    const awg = parseTableCsv('size_mm2,iz_a\n12,20\n');
    expect(awg.ok && awg.warnings?.map((w) => `${w.line}:${w.code}`)).toEqual(['2:notStandardSize']);
    const kcmil = parseTableCsv('size_mm2,iz_a\n250,255\n500,380\n');
    expect(kcmil.ok && kcmil.warnings?.map((w) => `${w.line}:${w.code}`)).toEqual(['2:notStandardSize']);
    const swapped = parseTableCsv('size_mm2,iz_a\n20,1.5\n');
    expect(swapped.ok && swapped.warnings?.map((w) => w.code)).toEqual(['notStandardSize', 'ratio']);
    expect(parseTableCsv('size_mm2,iz_a\n1.5,20\n2.5,27\n')).toEqual({ ok: true, rows: [{ sizeMm2: 1.5, izA: 20 }, { sizeMm2: 2.5, izA: 27 }] });
    expect(tableWarnings([{ sizeMm2: 300, izA: 100 }, { sizeMm2: 0.5, izA: 12 }]).map((w) => w.code)).toEqual(['ratio']);
    if (swapped.ok) {
      expect(tableWarningText(swapped.warnings![1], 'en')).toBe('Line 2: 20 mm² with Iz 1.5 A is outside 0.5…25 A per mm². Columns swapped?');
      expect(tableWarningText(swapped.warnings![0], 'de')).toContain('AWG oder kcmil?');
    }
  });
  it('D65 (review #17): inner spaces are refused, outer ones trimmed', () => {
    expect(parseTableNumber('1 5')).toEqual({ ok: false, reason: 'notNumber' });
    expect(parseTableNumber('1 000')).toEqual({ ok: false, reason: 'notNumber' });
    expect(parseTableNumber('1\u00a0000')).toEqual({ ok: false, reason: 'notNumber' });
    expect(parseTableNumber(' 1,5\u00a0')).toEqual({ ok: true, value: 1.5 });
  });
  it('reads a tab-separated file', () => {
    expect(parseTableCsv('size_mm2\tiz_a\n1,5\t20\n')).toEqual({ ok: true, rows: [{ sizeMm2: 1.5, izA: 20 }] });
  });

  it('all or nothing: every problem is listed with its line number', () => {
    const csv = ['size_mm2;iz_a', '1,5;20', '2,5;abc', '4;36;7', '6;0', '', '10;15', '16', '1,5;22'].join('\n');
    const r = parseTableCsv(csv);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const byLine = r.errors.map((e) => `${e.line}:${e.code}`);
    expect(byLine).toEqual(['3:notNumber', '4:columns', '5:iz', '7:order', '8:columns', '9:duplicate']);
    // the line is that of the file, not the record index (a blank line sits in between)
    expect(r.errors.find((e) => e.code === 'order')?.vars).toMatchObject({ size: 10, prevSize: 1.5 });
  });

  it('line numbers survive a quoted cell with a line break', () => {
    const r = parseTableCsv('size_mm2,iz_a\n"1.5\n",20\nx,5\n');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.map((e) => e.line)).toEqual([4]);
  });

  it('refuses: wrong header, no rows, empty file, non-increasing Iz, bounds, too many rows, oversized file, unterminated quote', () => {
    expect(parseTableCsv('a,b\n1,2')).toMatchObject({ ok: false, errors: [{ code: 'header', line: 1 }] });
    expect(parseTableCsv('1.5,20\n2.5,27')).toMatchObject({ ok: false, errors: [{ code: 'header' }] }); // data without a header
    expect(parseTableCsv('size_mm2,iz_a\n')).toMatchObject({ ok: false, errors: [{ code: 'empty' }] });
    expect(parseTableCsv('')).toMatchObject({ ok: false, errors: [{ code: 'empty' }] });
    expect(parseTableCsv('size_mm2,iz_a\n1.5,30\n2.5,27')).toMatchObject({ ok: false, errors: [{ code: 'order', line: 3 }] });
    expect(parseTableCsv('size_mm2,iz_a\n1.5,30\n2.5,30')).toMatchObject({ ok: false, errors: [{ code: 'order', line: 3 }] }); // equal is not increasing
    expect(parseTableCsv('size_mm2,iz_a\n0,5')).toMatchObject({ ok: false, errors: [{ code: 'size', line: 2 }] });
    expect(parseTableCsv('size_mm2,iz_a\n3000,5')).toMatchObject({ ok: false, errors: [{ code: 'size', line: 2 }] });
    expect(parseTableCsv('size_mm2,iz_a\n1.5,99999')).toMatchObject({ ok: false, errors: [{ code: 'iz', line: 2 }] });
    const many = ['size_mm2,iz_a', ...Array.from({ length: 101 }, (_, i) => `${i + 1},${i + 10}`)].join('\n');
    expect(parseTableCsv(many)).toMatchObject({ ok: false, errors: [{ code: 'tooMany', line: 102 }] });
    expect(parseTableCsv('x'.repeat(300_000))).toMatchObject({ ok: false, errors: [{ code: 'tooLarge' }] });
    expect(parseTableCsv('size_mm2,iz_a\n"1.5,20')).toMatchObject({ ok: false });
  });

  it('caps the error list; formulas and hostile text are plain refusals, never evaluated', () => {
    const csv = ['size_mm2,iz_a', ...Array.from({ length: 200 }, () => '=1+1,"@SUM(A1)"')].join('\n');
    const r = parseTableCsv(csv);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.length).toBeLessThanOrEqual(50);
      expect(r.errors[0]).toMatchObject({ code: 'notNumber', line: 2 });
    }
  });

  it('error text in both languages carries the line', () => {
    const r = parseTableCsv('size_mm2;iz_a\n1,5;abc');
    if (r.ok) throw new Error('expected errors');
    expect(tableProblemText(r.errors[0], 'en')).toBe('Line 2: "abc" in column iz_a is not a number.');
    expect(tableProblemText(r.errors[0], 'de')).toBe('Zeile 2: „abc“ in Spalte iz_a ist keine Zahl.');
  });

  it('exports in the language of the user and reads its own files back (round trip)', () => {
    const rows = [{ sizeMm2: 0.75, izA: 12.5 }, ...ROWS];
    const en = serializeTableCsv(rows, 'en');
    const de = serializeTableCsv(rows, 'de');
    expect(en).toBe('﻿size_mm2,iz_a\r\n0.75,12.5\r\n1.5,20\r\n2.5,27\r\n4,36\r\n');
    expect(de).toBe('﻿size_mm2;iz_a\r\n0,75;12,5\r\n1,5;20\r\n2,5;27\r\n4;36\r\n');
    expect(parseTableCsv(en)).toEqual({ ok: true, rows });
    expect(parseTableCsv(de)).toEqual({ ok: true, rows });
  });
});

describe('table validation', () => {
  it('meta: name, source note required, material, temperatures, loaded conductors', () => {
    expect(validateTableMeta(META)).toEqual([]);
    expect(validateTableMeta({ ...META, name: '  ' }).map((p) => p.code)).toEqual(['name']);
    expect(validateTableMeta({ ...META, sourceNote: '' }).map((p) => p.code)).toEqual(['sourceNote']);
    expect(validateTableMeta({ ...META, material: 'fe' as never }).map((p) => p.code)).toEqual(['material']);
    expect(validateTableMeta({ ...META, insulationMaxC: 30 }).map((p) => p.code)).toEqual(['reference']); // θref must be below θmax
    expect(validateTableMeta({ ...META, insulationMaxC: 400 }).map((p) => p.code)).toEqual(['temperature']);
    expect(validateTableMeta({ ...META, loadedConductors: 4 as never }).map((p) => p.code)).toEqual(['loaded']);
    expect(validateTableMeta({ ...META, insulationMaxC: NaN }).map((p) => p.code)).toContain('temperature');
  });
  it('rows: bounds, duplicates, strictly increasing Iz, NaN', () => {
    expect(validateRows(ROWS)).toEqual([]);
    expect(validateRows([])).toEqual([{ code: 'empty' }]);
    expect(validateRows([{ sizeMm2: 1.5, izA: 20 }, { sizeMm2: 1.5, izA: 21 }]).map((p) => p.code)).toEqual(['duplicate']);
    expect(validateRows([{ sizeMm2: NaN, izA: 20 }]).map((p) => p.code)).toEqual(['size']);
    expect(validateRows([{ sizeMm2: 1.5, izA: -3 }]).map((p) => p.code)).toEqual(['iz']);
    expect(validateRows([{ sizeMm2: 4, izA: 36 }, { sizeMm2: 1.5, izA: 40 }]).map((p) => p.code)).toEqual(['order']);
  });
});

describe('table repository', () => {
  it('creates with rows, lists with counts, updates, replaces rows, deletes', async () => {
    const db = await freshDb();
    const id = await createCableTable(db, { ...META, name: ' Meine Tabelle ' }, ROWS, 10);
    const got = (await getCableTable(db, id))!;
    expect(got.table).toMatchObject({ name: 'Meine Tabelle', material: 'cu', loadedConductors: 2, createdAt: 10 });
    expect(got.rows).toEqual(ROWS);
    expect((await listCableTables(db))[0]).toMatchObject({ id, rowCount: 3 });

    await updateCableTable(db, id, { ...META, material: 'al', loadedConductors: null }, 20);
    expect((await getCableTable(db, id))?.table).toMatchObject({ material: 'al', loadedConductors: null, updatedAt: 20 });
    await replaceTableRows(db, id, [{ sizeMm2: 16, izA: 80 }], 30);
    expect((await getCableTable(db, id))?.rows).toEqual([{ sizeMm2: 16, izA: 80 }]);
    await deleteCableTable(db, id);
    expect(await getCableTable(db, id)).toBeNull();
    await expect(deleteCableTable(db, id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('a refused list or file changes nothing', async () => {
    const db = await freshDb();
    const id = await createCableTable(db, META, ROWS);
    await expect(replaceTableRows(db, id, [{ sizeMm2: 1.5, izA: 30 }, { sizeMm2: 2.5, izA: 27 }])).rejects.toBeInstanceOf(TableValidationError);
    await expect(createCableTable(db, { ...META, sourceNote: '' }, ROWS)).rejects.toBeInstanceOf(TableValidationError);
    const bad = await importTableCsv(db, id, 'size_mm2;iz_a\n1,5;20\n2,5;x\n');
    expect(bad.ok).toBe(false);
    expect((await getCableTable(db, id))?.rows).toEqual(ROWS);
    expect(await listCableTables(db)).toHaveLength(1);

    const good = await importTableCsv(db, id, 'size_mm2;iz_a\n1,5;21\n2,5;28\n');
    expect(good).toEqual({ ok: true, rows: [{ sizeMm2: 1.5, izA: 21 }, { sizeMm2: 2.5, izA: 28 }] });
    expect((await getCableTable(db, id))?.rows).toHaveLength(2);
    await expect(importTableCsv(db, 999, 'size_mm2;iz_a\n1,5;21\n')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('copies a row into a coordination input with its source note (D20)', async () => {
    const db = await freshDb();
    const id = await createCableTable(db, META, ROWS);
    const { table, rows } = (await getCableTable(db, id))!;
    expect(userTableRow(table, rows[0])).toEqual({
      tableName: 'Meine Tabelle',
      sourceNote: 'Datenblatt Hersteller X, Tabelle 3',
      sizeMm2: 1.5,
      izA: 20,
      insulationMaxC: 70,
      // v1.1 F8: what the Iz belongs to travels with the copy
      material: 'cu',
      methodLabel: 'C',
      loadedConductors: 2,
      referenceAmbientC: 30,
    });
  });
});
