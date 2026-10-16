/** @jest-environment node */
// PDF report: photo grid and sign-off slots (V1.5 phase A, NW1/FL129). The rendered PDF is checked with pdf.js by
// scripts/check-photo-pdf.mjs (docs/V15_LOG.md A6); here the HTML.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { StoredCalculation } from '@/db/calculations';
import { E1_INPUT } from '@/dev/seeds';
import { compute } from '@/engine';
import { bannedWordsIn } from '@/lib/wording';

import { buildCalculationReport, buildProjectReport, type ReportContext, type ReportExtras } from './report-html';
import { signatureSvg } from './signature';

const ctx = (language: 'en' | 'de'): ReportContext => ({
  language,
  paper: 'A4',
  company: { name: 'Elektro Muster GmbH', address: 'Hauptstr. 1', phone: '', email: '', regNo: '' },
  logoDataUri: null,
  generatedAt: Date.UTC(2026, 9, 15, 12),
  appVersion: '1.5.0',
});
const result = compute('vdrop', E1_INPUT as never);
const calc: StoredCalculation = { id: 1, projectId: 1, circuitId: 1, kind: 'vdrop', title: 'F3', note: '', input: result.usedInput, result, engineVersion: result.engineVersion, profileId: result.profileId, profileVersion: result.profileVersion, createdAt: Date.UTC(2026, 9, 1), updatedAt: 0 };
const jpegUri = `data:image/jpeg;base64,${readFileSync(join(__dirname, '../../test/fixtures/photos/cable-480x640.jpg')).toString('base64')}`;
const ink = signatureSvg([[{ x: 0, y: 20 }, { x: 20, y: 0 }, { x: 40, y: 25 }, { x: 70, y: 5 }]])!.svg;
const extras: ReportExtras = {
  photos: [
    { dataUri: jpegUri, caption: 'Verteiler <UV1> & "Zähler"', owner: 'project', ownerLabel: '' },
    { dataUri: jpegUri, caption: '', owner: 'circuit', ownerLabel: 'F3 Steckdosen' },
    { dataUri: jpegUri, caption: 'Kabelweg', owner: 'calculation', ownerLabel: 'Spannungsfall F3' },
  ],
  signatures: [
    { role: 'prepared', name: 'Max Muster', place: 'Köln', date: Date.UTC(2026, 9, 15), svg: ink },
    { role: 'received', name: '', place: '', date: null, svg: null },
  ],
};
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ');

describe('report extras', () => {
  it('without extras (or empty ones) the document is byte-identical to v1.1 (golden reports stay valid, D64)', () => {
    for (const language of ['en', 'de'] as const) {
      const plain = buildCalculationReport(calc, ctx(language));
      expect(buildCalculationReport(calc, ctx(language), undefined, {})).toBe(plain);
      expect(buildCalculationReport(calc, ctx(language), undefined, { photos: [], signatures: [] })).toBe(plain);
      const project = { name: 'Müller', client: '', site: '', notes: '' };
      expect(buildProjectReport(project, [], [calc], ctx(language), { photos: [] })).toBe(buildProjectReport(project, [], [calc], ctx(language)));
    }
  });

  it('photo grid: every JPEG once, owner labels, escaped captions; other data URIs are dropped', () => {
    const hostile: ReportExtras = {
      photos: [
        ...extras.photos!,
        { dataUri: 'data:image/png;base64,iVBORw0KGgo=', caption: 'png', owner: 'project', ownerLabel: '' },
        { dataUri: 'javascript:alert(1)', caption: 'js', owner: 'project', ownerLabel: '' },
        { dataUri: 'data:image/jpeg;base64,/9j/" onerror="alert(1)', caption: 'attr', owner: 'project', ownerLabel: '' },
      ],
    };
    const html = buildCalculationReport(calc, ctx('en'), undefined, hostile);
    expect(html.match(/<img src="data:image\/jpeg;base64,/g)).toHaveLength(3);
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('Verteiler &lt;UV1&gt; &amp; &quot;Zähler&quot;');
    expect(html).toContain('<h2>Photos</h2>');
    expect(html).toContain('Circuit F3 Steckdosen');
    expect(html).toContain('Calculation Spannungsfall F3');
    expect(html.indexOf('<h2>Photos</h2>')).toBeGreaterThan(html.indexOf('class="checks-note"')); // after the calculation
  });

  it('sign-off slots: the drawn SVG inline, an empty slot shows the line to fill in, foreign markup is never drawn', () => {
    const html = buildCalculationReport(calc, ctx('de'), undefined, extras);
    expect(html).toContain('Erstellt von');
    expect(html).toContain('Entgegengenommen von');
    expect(html).toContain(ink);
    expect(html).toContain('Max Muster · Köln, 15.10.2026');
    expect(html).toContain('Name, Ort, Datum');
    const evil = buildCalculationReport(calc, ctx('en'), undefined, { signatures: [{ role: 'prepared', name: 'X', place: '', date: null, svg: '<svg onload="alert(1)"><script>alert(1)</script></svg>' }] });
    expect(evil).not.toContain('<script');
    expect(evil).not.toContain('onload');
  });

  it('EN and DE: no compliance words anywhere outside the responsibility note (A4)', () => {
    for (const language of ['en', 'de'] as const) {
      const all = text(buildProjectReport({ name: 'P', client: '', site: '', notes: '' }, [{ label: 'F3', notes: '', calculations: [calc] }], [], ctx(language), extras));
      const withoutNote = all.split(language === 'en' ? 'Calculation aid.' : 'Rechenhilfe.')[0];
      expect([language, bannedWordsIn(withoutNote)]).toEqual([language, []]);
    }
  });
});
