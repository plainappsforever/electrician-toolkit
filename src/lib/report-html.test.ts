/** @jest-environment node */
// A7 (HTML side), A4 on the generated HTML, escaping, frozen rendering, page-break rules, A4/Letter, EN/DE.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createTestDb } from '../../test/node-sqlite-db';
import { listCalculations, saveCalculation, type StoredCalculation } from '@/db/calculations';
import { migrate } from '@/db/migrations';
import { createCircuit, createProject } from '@/db/projects';
import { E1_INPUT, E3_INPUT, E4_INPUT } from '@/dev/seeds';
import { compute, ENGINE_VERSION, type CalcKind } from '@/engine';
import { SOURCES } from '@/engine';

import { bannedWordsIn } from './wording';
import { buildCalculationReport, buildProjectReport, esc, PAPER_POINTS, RESPONSIBILITY_NOTE_STATUS, type ReportContext } from './report-html';
import { en } from '@/i18n/en';
import { de } from '@/i18n/de';

const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const NOW = new Date(2026, 9, 1, 10, 0, 0).getTime();
const ctx = (over: Partial<ReportContext> = {}): ReportContext => ({
  language: 'en',
  paper: 'A4',
  company: { name: 'Elektro Müller GmbH', address: 'Hauptstr. 1\n12345 Musterstadt', phone: '+49 123', email: 'info@example.org', regNo: 'HRB 1' },
  logoDataUri: LOGO,
  generatedAt: NOW,
  appVersion: '1.0.0',
  ...over,
});

let seq = 0;
function stored(kind: CalcKind, input: unknown, over: Partial<StoredCalculation> = {}): StoredCalculation {
  const result = compute(kind, input as never);
  return {
    id: ++seq,
    projectId: 1,
    circuitId: null,
    kind,
    title: '',
    note: '',
    input,
    result,
    engineVersion: result.engineVersion,
    profileId: result.profileId,
    profileVersion: result.profileVersion,
    createdAt: new Date(2026, 8, 30, 9, 0, 0).getTime(),
    updatedAt: 0,
    ...over,
  };
}

/** Visible text of the HTML: tags and comments removed, entities decoded — what A4 is checked against. */
function visibleText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
const withoutNote = (text: string, note: string) => text.split(note).join(' ');

const fixtureInputs: [CalcKind, unknown][] = [];
for (const f of readdirSync(join(__dirname, '../../test/fixtures/engine')).filter((n) => /^e\d+\.json$/.test(n))) {
  const fx = JSON.parse(readFileSync(join(__dirname, '../../test/fixtures/engine', f), 'utf8')) as { cases: { kind: CalcKind; input: unknown }[] };
  for (const c of fx.cases) fixtureInputs.push([c.kind, c.input]);
}

describe('single calculation report (A7)', () => {
  const calc = stored('vdrop', E1_INPUT, { title: 'Spannungsfall F3' });
  const html = buildCalculationReport(calc, ctx());

  it('is a complete HTML document with letterhead, logo, inputs, results, working, assumptions, sources, note and versions', () => {
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Elektro Müller GmbH');
    expect(html).toContain('Hauptstr. 1\n12345 Musterstadt');
    expect(html).toContain(`<img src="${LOGO}"`);
    const text = visibleText(html);
    expect(text).toContain('Calculation report');
    expect(text).toContain('Spannungsfall F3');
    // inputs (D22 rounding, unit chips)
    expect(text).toMatch(/Voltage\s+230 V/);
    expect(text).toMatch(/Current\s+16 A/);
    expect(text).toMatch(/Length\s+18 m/);
    expect(text).toMatch(/Cross-section\s+1\.5 mm²/);
    expect(text).toMatch(/Conductor material\s+copper/);
    // results: the headline number, rounded as the result card does
    expect(text).toMatch(/Voltage drop Δu\s+3\.76 %/);
    // D52: a maximum is rounded down (14.375 m → 14.3 m), a checked quantity up (owner sign-off, review finding 1)
    expect(text).toMatch(/Maximum length for the selected Δu limit\s+14\.3 m/);
    expect(text).toMatch(/Smallest standard size for the voltage-drop limit only — check current-carrying capacity and protection separately\s+2\.5 mm²/);
    expect(text).toContain('current-carrying capacity Iz, overload and short-circuit protection and disconnection are not checked here');
    // checks vs the limit the user selected + the method disagreement warning
    expect(text).toContain('exceeds the selected limit');
    expect(text).toContain('M3 fixed conductivity κ gives Δu = 2.99 %'); // 2.9814 % rounded up (D52)
    // working: formula with numbers
    expect(text).toMatch(/u = b × \(R × cos φ/);
    expect(text).toContain('Δu = 100 × u / U0');
    // assumptions with defaults marked
    expect(text).toContain('(default)');
    // sources with clause and licence status
    expect(text).toContain('IEC 60364-5-52');
    expect(text).toContain('licensed standard: clause cited, text not reproduced');
    expect(text).toContain('public source');
    expect(text).toContain('Not yet confirmed against the primary text');
    // versions: stored with the calculation and of the app
    expect(text).toContain(`Computed with engine ${ENGINE_VERSION}, profile eu-de (version 1), saved 2026-09-30`);
    expect(text).toContain(`Electrician Toolkit 1.0.0 · engine ${ENGINE_VERSION} · profile eu-de v1`);
    expect(text).toMatch(/Date\s+2026-10-01/);
  });

  it('puts the responsibility note in a repeating table footer and marks it OWNER WORDING', () => {
    expect(html).toContain('<tfoot>');
    const footer = html.slice(html.indexOf('<tfoot>'), html.indexOf('</tfoot>'));
    expect(footer).toContain(esc(en['note.responsibility']));
    expect(footer).toContain(`<!-- ${RESPONSIBILITY_NOTE_STATUS}`);
    expect(html.indexOf('<tfoot>')).toBeLessThan(html.indexOf('<tbody>')); // HTML order lets print engines repeat it
    const german = buildCalculationReport(calc, ctx({ language: 'de' }));
    expect(german.slice(german.indexOf('<tfoot>'), german.indexOf('</tfoot>'))).toContain('Rechenhilfe.');
  });

  it('page-break rules and paper sizes', () => {
    expect(html).toContain('break-inside: avoid');
    expect(html).toContain('break-after: avoid');
    expect(html).toContain('@page { size: A4; margin: 0; }');
    expect(buildCalculationReport(calc, ctx({ paper: 'Letter' }))).toContain('@page { size: Letter; margin: 0; }');
    expect(PAPER_POINTS).toEqual({ A4: { width: 595, height: 842 }, Letter: { width: 612, height: 792 } });
  });

  it('German: German labels, decimal comma, German date, German note', () => {
    const text = visibleText(buildCalculationReport(calc, ctx({ language: 'de' })));
    expect(text).toContain('Berechnungsbericht');
    expect(text).toContain('Spannungsfall Δu');
    expect(text).toMatch(/Spannungsfall Δu\s+3,76 %/);
    expect(text).toMatch(/Querschnitt\s+1,5 mm²/);
    expect(text).toContain('(Standardwert)');
    expect(text).toMatch(/Datum\s+01\.10\.2026/);
    expect(text).toContain('lizenzierte Norm');
    expect(text).toContain('Rechenhilfe.');
  });

  it('is deterministic: same input, same string', () => {
    expect(buildCalculationReport(calc, ctx())).toBe(html);
  });

  it('renders a coordination calculation with the copied table row and the source note', () => {
    const text = visibleText(buildCalculationReport(stored('coord', E3_INPUT), ctx()));
    expect(text).toContain('Source given: IEC 60364-5-52:2009 Table B.52.2, reference method C');
    // v1.1 F8 (REVIEW_V1 #8): third person, and it says the values are not the app's
    expect(text).toContain('From the installer’s own table');
    expect(text).toContain('values entered by the user, not supplied by this app');
    expect(text).not.toMatch(/\byour table\b|Source you noted/);
    expect(text).toContain('Suggested device');
    expect(text).toContain('B13');
    expect(text).toMatch(/Protective device\s+B16/);
    expect(text).toContain('not met');
  });
});

describe('only the inputs the engine used are printed (D53, review finding 2)', () => {
  const inputsBlock = (html: string, lang: 'en' | 'de' = 'en') => {
    const h = `<h4>${(lang === 'de' ? de : en)['report.inputs']}</h4>`;
    const i = html.indexOf(h);
    expect(i).toBeGreaterThan(0);
    return visibleText(html.slice(i, html.indexOf('<h4>', i + h.length)));
  };
  it('DC voltage drop with a stale cos φ, η, X\' and M1: none of them is printed', () => {
    const dc = { system: 'dc', voltage: 24, current: 20, length: { value: 10, unit: 'm' }, material: 'cu', size: { value: 6, unit: 'mm2' }, cosPhi: 0.8, efficiency: 1.5, reactanceOhmPerM: 0.5, method: 'M1', limitPercent: 3 };
    const c = stored('vdrop', dc);
    expect(c.result!.ok).toBe(true);
    for (const language of ['en', 'de'] as const) {
      const html = buildCalculationReport(c, ctx({ language }));
      const text = visibleText(html);
      const block = inputsBlock(html, language);
      expect(block).toMatch(/24 V/);
      expect(block).not.toMatch(/cos φ/);
      expect(block).not.toMatch(/η|Efficiency|Wirkungsgrad/);
      expect(block).not.toMatch(/Reactance|Reaktanz|0[.,]5 Ω\/m/);
      // nor anywhere else in the document: the comparison names X' = 0 for DC, not the stale 0.5
      expect(text).not.toMatch(/X' = 0[.,]5/);
      expect(text).toMatch(/X' = 0 Ω\/m/);
    }
  });
  it('voltage drop with a current and a stale η: η is not printed; with a power it is', () => {
    const ac = { system: 'ac1', voltage: 230, current: 16, efficiency: 0.85, length: { value: 18, unit: 'm' }, material: 'cu', size: { value: 1.5, unit: 'mm2' }, cosPhi: 1, limitPercent: 3 };
    expect(inputsBlock(buildCalculationReport(stored('vdrop', ac), ctx()))).not.toMatch(/Efficiency/);
    const withPower = { ...ac, current: undefined, power: 3000 };
    expect(inputsBlock(buildCalculationReport(stored('vdrop', withPower), ctx()))).toMatch(/Efficiency η\s+0\.85/);
  });
  it('measured loop: the cable fields of an earlier calculated entry are not printed', () => {
    const m = { mode: 'measured', u0: 230, device: { type: 'mcb', curve: 'B', ratedCurrent: 16 }, zsMeasured: 1.8, ze: 0.35, length: { value: 25, unit: 'm' }, lineSize: { value: 1.5, unit: 'mm2' } };
    const block = inputsBlock(buildCalculationReport(stored('loop', m), ctx()));
    expect(block).toContain('1.8 Ω');
    expect(block).not.toMatch(/Ze|25 m|1\.5 mm²/);
  });
});

describe('German report: German source texts (D58, review #8)', () => {
  it('the DE report of E1/E3/E4 contains no English registry text and no internal note', () => {
    const allowSame = new Set([SOURCES['vde-ar-n-4100'].standard]);
    for (const [kind, input] of [['vdrop', E1_INPUT], ['coord', E3_INPUT], ['loop', E4_INPUT], ['vdrop', { ...(E1_INPUT as object), material: 'al' }]] as [CalcKind, unknown][]) {
      const text = visibleText(buildCalculationReport(stored(kind, input), ctx({ language: 'de' })));
      for (const src of Object.values(SOURCES)) {
        for (const t of [src.standard, src.clause, (src as { unconfirmed?: string }).unconfirmed]) {
          if (t && !allowSame.has(t)) expect(text).not.toContain(t);
        }
      }
      expect(text).not.toMatch(/\((?:R|D)\d+\)|owner|tester/);
    }
    const de = visibleText(buildCalculationReport(stored('vdrop', E1_INPUT), ctx({ language: 'de' })));
    expect(de).toContain('IEC 60364-5-52 / DIN VDE 0100-520, Anhang G (informativ): Spannungsfall');
  });
});

describe('history entry wording (review #19, D65)', () => {
  it('a history entry printed on its own says "computed", not "saved"', () => {
    const text = visibleText(buildCalculationReport(stored('vdrop', E1_INPUT, { projectId: null }), ctx()));
    expect(text).toContain('(not saved to a project)');
    expect(text).not.toMatch(/saved 2026/);
    expect(visibleText(buildCalculationReport(stored('vdrop', E1_INPUT), ctx()))).toMatch(/saved 2026-09-30/);
  });
});

describe('frozen rendering (D20)', () => {
  it('shows the stored numbers and engine version, never a recomputation', () => {
    const c = stored('vdrop', E1_INPUT, { engineVersion: '0.9.0' });
    const tampered = JSON.parse(JSON.stringify(c.result));
    tampered.values.deltaUPercent.value = 9.99;
    tampered.engineVersion = '0.9.0';
    const html = buildCalculationReport({ ...c, result: tampered, engineVersion: '0.9.0' }, ctx());
    const text = visibleText(html);
    expect(text).toMatch(/Voltage drop Δu\s+9\.99 %/);
    expect(text).toContain('Computed with engine 0.9.0');
  });

  it('a damaged or empty stored result renders a notice, not an exception', () => {
    for (const result of [null, 'text', { values: 5 }, { steps: 'x', assumptions: [{}], checks: [null], sources: [1, 'nope-id'] }] as unknown[]) {
      const html = buildCalculationReport({ ...stored('vdrop', E1_INPUT), result: result as never, input: null }, ctx());
      expect(html).toContain('</html>');
    }
    expect(visibleText(buildCalculationReport({ ...stored('vdrop', E1_INPUT), result: null }, ctx()))).toContain('could not be read');
  });
});

describe('escaping', () => {
  const evil = '<script>alert(1)</script> & "x" \'y\'';
  it('escapes every piece of user text in project, company, title, note, circuit and table input', () => {
    const e3 = { ...(E3_INPUT as object), table: { ...(E3_INPUT as { table: object }).table, tableName: evil, sourceNote: evil } };
    const c = stored('coord', e3, { title: evil, note: evil });
    const html = buildProjectReport(
      { name: evil, client: evil, site: evil, notes: evil },
      [{ label: evil, notes: evil, calculations: [c] }],
      [stored('loop', E4_INPUT, { title: evil })],
      ctx({ company: { name: evil, address: evil, phone: evil, email: evil, regNo: evil } })
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;x&quot; &#39;y&#39;');
    expect((html.match(/&lt;script&gt;/g) ?? []).length).toBeGreaterThanOrEqual(12);
    // the only tags in the document are ours
    const tags = new Set([...html.matchAll(/<\/?([a-zA-Z0-9]+)/g)].map((m) => m[1].toLowerCase()));
    expect([...tags].sort()).toEqual(['b', 'body', 'br', 'div', 'h1', 'h2', 'h3', 'h4', 'head', 'html', 'img', 'li', 'meta', 'ol', 'p', 'section', 'span', 'style', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'ul'].filter((t) => tags.has(t)));
  });

  it('accepts only a base64 PNG/JPEG logo', () => {
    for (const bad of ['data:text/html;base64,PHNjcmlwdD4=', 'javascript:alert(1)', 'data:image/png;base64,"><script>alert(1)</script>', 'https://evil.example/x.png', 'file:///etc/passwd']) {
      const html = buildCalculationReport(stored('vdrop', E1_INPUT), ctx({ logoDataUri: bad }));
      expect(html).not.toContain('<img');
      expect(html).not.toContain('<script');
    }
    expect(buildCalculationReport(stored('vdrop', E1_INPUT), ctx({ logoDataUri: null }))).not.toContain('<img');
    expect(buildCalculationReport(stored('vdrop', E1_INPUT), ctx({ logoDataUri: 'data:image/jpeg;base64,/9j/4AAQ' }))).toContain('<img src="data:image/jpeg;base64,/9j/4AAQ"');
  });
});

describe('project report', () => {
  it('lists project-level calculations first, then each circuit; skips empty circuits; empty project says so', () => {
    const html = buildProjectReport(
      { name: 'Müller, Küche', client: 'Familie Müller', site: 'Musterstr. 1', notes: 'Zeile 1\nZeile 2' },
      [
        { label: 'F3 Steckdosen', notes: 'Küche', calculations: [stored('vdrop', E1_INPUT), stored('loop', E4_INPUT)] },
        { label: 'F4 leer', notes: '', calculations: [] },
      ],
      [stored('coord', E3_INPUT)],
      ctx()
    );
    const text = visibleText(html);
    expect(text).toContain('Project report');
    expect(text).toMatch(/Project\s+Müller, Küche/);
    expect(text).toMatch(/Client\s+Familie Müller/);
    expect(html).toContain('Zeile 1\nZeile 2');
    expect(text.indexOf('Not assigned to a circuit')).toBeLessThan(text.indexOf('Circuit: F3 Steckdosen'));
    expect(text).not.toContain('F4 leer');
    expect((html.match(/<section class="calc">/g) ?? []).length).toBe(3);
    expect(visibleText(buildProjectReport({ name: 'Leer', client: '', site: '', notes: '' }, [], [], ctx()))).toContain('No saved calculations.');
  });

  it('A7: a 30-calculation project renders with page-break rules, in well under a second', async () => {
    const db = createTestDb();
    await migrate(db);
    const p = await createProject(db, { name: 'Groß' });
    const circuits = [await createCircuit(db, p, { label: 'F1' }), await createCircuit(db, p, { label: 'F2' })];
    const kinds: [CalcKind, unknown][] = [['vdrop', E1_INPUT], ['coord', E3_INPUT], ['loop', E4_INPUT]];
    for (let i = 0; i < 30; i++) {
      const [kind, input] = kinds[i % 3];
      await saveCalculation(db, { projectId: p, circuitId: circuits[i % 2] }, { kind, input, result: compute(kind, input as never), title: `Berechnung ${i + 1}` });
    }
    const all = await listCalculations(db, p);
    const t0 = Date.now();
    const html = buildProjectReport(
      { name: 'Groß', client: '', site: '', notes: '' },
      circuits.map((id, i) => ({ label: `F${i + 1}`, notes: '', calculations: all.filter((c) => c.circuitId === id) })),
      [],
      ctx()
    );
    expect(Date.now() - t0).toBeLessThan(1000);
    expect((html.match(/<section class="calc">/g) ?? []).length).toBe(30);
    expect((html.match(/<\/section>/g) ?? []).length).toBe(30);
    // D75: a calculation may break across pages (device PDFs showed a whole page left empty before a long calculation); its groups may not
    expect(html).toContain('.keep { break-inside: avoid');
    expect(html).not.toContain('section.calc { break-inside');
    expect((html.match(/<tfoot>/g) ?? []).length).toBe(1);
  });
});

describe('wording (A4) on the generated HTML', () => {
  it('no banned word in any report text, EN and DE, for every worked example (note whitelisted)', () => {
    const calcs = fixtureInputs.map(([k, i]) => stored(k, i, { title: 'Test' }));
    expect(calcs.length).toBeGreaterThanOrEqual(22);
    for (const [language, note] of [['en', en['note.responsibility']], ['de', de['note.responsibility']]] as const) {
      const html = buildProjectReport({ name: 'P', client: 'C', site: 'S', notes: 'N' }, [{ label: 'F1', notes: '', calculations: calcs }], [], ctx({ language }));
      const text = withoutNote(visibleText(html), note);
      expect(bannedWordsIn(text)).toEqual([]);
      expect(text.length).toBeGreaterThan(5000);
    }
  });

  it('every source printed in a report resolves in the registry with a licence status', () => {
    const html = buildCalculationReport(stored('vdrop', E1_INPUT), ctx());
    for (const id of compute('vdrop', E1_INPUT as never).sources) {
      expect(SOURCES[id as keyof typeof SOURCES].licence).toMatch(/public|licensed-cited/);
      expect(html).toContain(SOURCES[id as keyof typeof SOURCES].standard.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    }
  });
});

describe('v1.1 F2: the responsibility note directly under every calculation\'s checks (REVIEW_V1 #2, #26)', () => {
  const NOTE = `<p class="checks-note">${esc(en['note.responsibility'])}</p>`;
  it('every calculation of a project report has the note right after its checks/warnings, inside the same unbreakable group', () => {
    const calcs = fixtureInputs.map(([k, i]) => stored(k, i));
    const html = buildProjectReport({ name: 'P', client: '', site: '', notes: '' }, [{ label: 'C1', notes: '', calculations: calcs }], [], ctx());
    const blocks = html.split('<section class="calc">').slice(1);
    expect(blocks).toHaveLength(calcs.length);
    for (const b of blocks) {
      expect(b).toContain(NOTE);
      const checks = b.indexOf('Checks against the limits you selected');
      if (checks >= 0) {
        // the note comes after the checks and before the inputs, in the same .keep group as the checks heading
        expect(b.indexOf(NOTE)).toBeGreaterThan(checks);
        expect(b.indexOf(NOTE)).toBeLessThan(b.indexOf('<h4>Inputs</h4>'));
        const group = b.slice(b.lastIndexOf('<div class="keep">', checks));
        expect(group.indexOf(NOTE)).toBeLessThan(group.indexOf('</div><div class="keep"><h4>Inputs'));
      }
    }
  });
  it('the note is visible on both print engines (not hidden by a profile), and a damaged record and an empty project print it once', () => {
    expect(buildCalculationReport(stored('vdrop', E1_INPUT), ctx())).not.toMatch(/\.checks-note\s*\{[^}]*display:\s*none/);
    expect(buildCalculationReport({ ...stored('vdrop', E1_INPUT), result: null }, ctx()).split(NOTE).length - 1).toBe(1);
    expect(buildProjectReport({ name: 'Empty', client: '', site: '', notes: '' }, [], [], ctx()).split(NOTE).length - 1).toBe(1);
    const de1 = buildCalculationReport(stored('vdrop', E1_INPUT), ctx({ language: 'de' }));
    expect(de1).toContain(`<p class="checks-note">${esc(de['note.responsibility'])}</p>`);
  });
});

describe('v1.1 F5: the two maximum lengths carry different labels (REVIEW_V1 #5)', () => {
  it('voltage drop says "for the selected Δu limit", loop says "disconnection only"', () => {
    const text = visibleText(buildProjectReport({ name: 'P', client: '', site: '', notes: '' }, [{ label: 'C', notes: '', calculations: [stored('vdrop', E1_INPUT), stored('loop', E4_INPUT)] }], [], ctx()));
    expect(text).toMatch(/Maximum length for the selected Δu limit\s+14\.3 m/);
    expect(text).toMatch(/Maximum length for Zs ≤ Zs_max \(disconnection only, not voltage drop\)\s+91\.7 m/);
    expect(text).not.toMatch(/Maximum length\s+\d/);
    const de1 = visibleText(buildCalculationReport(stored('loop', E4_INPUT), ctx({ language: 'de' })));
    expect(de1).toMatch(/Maximale Länge für Zs ≤ Zs_max \(nur Abschaltung, nicht Spannungsfall\)\s+91,7 m/);
  });
});

describe('v1.1 F6: the breaker suggestion is secondary when the user\'s own device passes (REVIEW_V1 #6, probe X2)', () => {
  const X2 = { ib: 10, izTyped: 20, device: { type: 'mcb', curve: 'B', ratedCurrent: 16 } };
  it('X2 (Ib 10 A, B16, Iz 20 A): C1–C3 met; the report names the suggestion as "also meets … (overload only)"', () => {
    const r = compute('coord', X2 as never);
    expect(r.ok).toBe(true);
    expect(r.texts.verdict).toBe('met');
    expect(r.texts.suggestion).toBe('B10');
    expect(r.assumptions.map((a) => a.key)).toContain('assume.coord.suggestionScope');
    const text = visibleText(buildCalculationReport(stored('coord', X2), ctx()));
    expect(text).toMatch(/Smallest preferred rating that also meets C1–C3 \(overload only\)\s+B10/);
    expect(text).not.toContain('Suggested device');
    expect(text).not.toContain('Suggested rating In');
  });
  it('E3 (B16 fails C2): the suggestion stays the answer, labelled overload protection only', () => {
    const text = visibleText(buildCalculationReport(stored('coord', E3_INPUT), ctx()));
    expect(text).toMatch(/Suggested device \(overload protection C1–C3 only\)\s+B13/);
    expect(text).toContain('The suggested rating covers overload protection (C1–C3) only');
  });
});

describe('v1.1 F8: the copied table row keeps material, method label and loaded conductors (REVIEW_V1 #8)', () => {
  it('a new snapshot prints them; an old snapshot without them still renders', () => {
    const table = { tableName: 'Datenblatt X', sourceNote: 'Hersteller X, Tab. 3', sizeMm2: 1.5, izA: 20, insulationMaxC: 70, referenceAmbientC: 30, material: 'cu', methodLabel: 'C', loadedConductors: 2 };
    const input = { ib: 13, device: { type: 'mcb', curve: 'B', ratedCurrent: 16 }, table };
    const r = compute('coord', input as never);
    expect((r.usedInput as { table: Record<string, unknown> }).table).toMatchObject({ material: 'cu', methodLabel: 'C', loadedConductors: 2 });
    expect(visibleText(buildCalculationReport(stored('coord', r.usedInput), ctx()))).toContain('"Datenblatt X" (1.5 mm², copper, method C, 2 loaded conductors)');
    expect(visibleText(buildCalculationReport(stored('coord', r.usedInput), ctx({ language: 'de' })))).toContain('„Datenblatt X“ (1,5 mm², Kupfer, Verlegeart C, 2 belastete Adern)');
    expect(visibleText(buildCalculationReport(stored('coord', E3_INPUT), ctx()))).toMatch(/\(1\.5 mm²\), values entered by the user/);
  });
});
