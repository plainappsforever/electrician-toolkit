/** @jest-environment node */
// Result as plain text for sharing / copying (V1.5 phase A, NW3), English and German.
import type { StoredCalculation } from '@/db/calculations';
import { E1_INPUT, E3_INPUT } from '@/dev/seeds';
import { compute, type CalcKind } from '@/engine';
import { translate } from '@/i18n';
import { bannedWordsIn } from '@/lib/wording';

import { shareText } from './share-text';

const stored = (kind: CalcKind, input: unknown, over: Partial<StoredCalculation> = {}): StoredCalculation => {
  const result = compute(kind, input as never);
  return { id: 7, projectId: 1, circuitId: 1, kind, title: 'F3 Küche', note: '', input: result.usedInput, result, engineVersion: result.engineVersion, profileId: result.profileId, profileVersion: result.profileVersion, createdAt: Date.UTC(2026, 9, 1, 12), updatedAt: 0, ...over };
};

describe('shareText', () => {
  it('English: heading, saved-with line, headline values with the display rounding (D52), checks, inputs used, note, versions', () => {
    const { subject, text } = shareText(stored('vdrop', E1_INPUT), 'en', { appVersion: '1.5.0' });
    expect(subject).toBe('Calculation: F3 Küche');
    const lines = text.split('\n');
    expect(lines[0]).toBe('F3 Küche — Voltage drop & cross-section');
    expect(lines[1]).toMatch(/^Computed with engine 1\.1\.0, profile eu-de \(version 1\), saved /);
    expect(text).toContain('3.76 %'); // SPEC U1/E1, rounded up (D52)
    expect(text).toContain('Checks against the limits you selected:');
    expect(text).toContain('Inputs:');
    expect(text).toContain(translate('en', 'note.responsibility'));
    expect(lines[lines.length - 1]).toBe('Electrician Toolkit 1.5.0 · engine 1.1.0 · profile eu-de v1');
    expect(text).not.toContain('<'); // plain text, no markup
  });

  it('German: decimal comma, German labels, same structure', () => {
    const en = shareText(stored('vdrop', E1_INPUT), 'en', { appVersion: '1.5.0' }).text.split('\n');
    const { subject, text } = shareText(stored('vdrop', E1_INPUT), 'de', { appVersion: '1.5.0' });
    expect(subject).toBe('Berechnung: F3 Küche');
    expect(text).toContain('3,76 %');
    expect(text).toContain(translate('de', 'report.inputs'));
    expect(text).toContain(translate('de', 'note.responsibility'));
    expect(text.split('\n')).toHaveLength(en.length); // EN/DE parity: the same lines
  });

  it('a draft from the calculator says it is not saved; working adds assumptions and numbered steps', () => {
    const draft = stored('coord', E3_INPUT, { id: 0, projectId: null, circuitId: null, title: '' });
    const short = shareText(draft, 'en', { appVersion: '1.5.0' });
    expect(short.subject).toBe('Calculation: Protection coordination');
    expect(short.text.split('\n')[1]).toMatch(/^Not saved to a project \([^()]+\)$/); // N11: the date in brackets, not after a full stop
    const long = shareText(draft, 'en', { appVersion: '1.5.0', working: true });
    expect(long.text).toContain('Working:');
    expect(long.text).toMatch(/\n1\. /);
    expect(long.text.length).toBeGreaterThan(short.text.length);
  });

  it('a damaged record says so and still carries the note', () => {
    const { text } = shareText(stored('vdrop', E1_INPUT, { result: null }), 'en', { appVersion: '1.5.0' });
    expect(text).toContain(translate('en', 'report.damaged'));
    expect(text).toContain(translate('en', 'note.responsibility'));
  });

  it('no compliance words outside the responsibility note, every calculator, both languages (A4)', () => {
    for (const language of ['en', 'de'] as const) {
      for (const [kind, input] of [['vdrop', E1_INPUT], ['coord', E3_INPUT]] as const) {
        const t = shareText(stored(kind, input), language, { appVersion: '1.5.0', working: true }).text.replace(translate(language, 'note.responsibility'), '');
        expect([language, kind, bannedWordsIn(t)]).toEqual([language, kind, []]);
      }
    }
  });
});
