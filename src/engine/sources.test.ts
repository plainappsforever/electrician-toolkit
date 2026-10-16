// D30 / A3: every source id resolves to a registry entry with standard, clause, licence and (where one exists) a public
// restatement link; profile constants point at registry ids; nothing is marked public that cites a licensed text.
import { EU_DE } from './profiles';
import { bannedWordsIn } from '../lib/wording';

import { isSourceId, SOURCE_IDS, SOURCES } from './sources';

describe('source registry', () => {
  it('every entry is complete', () => {
    for (const id of SOURCE_IDS) {
      const s = SOURCES[id];
      expect(s.standard.length).toBeGreaterThan(5);
      expect(s.clause.length).toBeGreaterThan(3);
      expect(['public', 'licensed-cited']).toContain(s.licence);
      expect(s.summary.length).toBeGreaterThan(5);
      expect(s.publicUrl).toMatch(/^https:\/\//);
    }
  });

  it('profile constants and presets reference registry ids', () => {
    for (const m of Object.values(EU_DE.materials)) {
      expect(isSourceId(m.rho20Source)).toBe(true);
      expect(isSourceId(m.alpha20Source)).toBe(true);
    }
    for (const p of EU_DE.limitPresets) expect(isSourceId(p.source)).toBe(true);
  });

  it('the aluminium α20 = 0.00403 is cited with its public restatement and marked unconfirmed against the primary text', () => {
    expect(EU_DE.materials.al.alpha20).toBe(0.00403);
    expect(EU_DE.materials.al.alpha20Source).toBe('al-alpha20');
    expect(SOURCES['al-alpha20'].unconfirmed).toBeTruthy();
  });

  it('SPEC §7.1 constants', () => {
    expect(EU_DE.materials.cu.rho20).toBe(1 / 58);
    expect(EU_DE.materials.al.rho20).toBe(1 / (0.61 * 58));
    expect([EU_DE.materials.cu.alpha20, EU_DE.materials.cu.rhoAnnexG, EU_DE.materials.cu.kappa]).toEqual([0.00393, 0.0225, 56]);
    expect([EU_DE.materials.al.rhoAnnexG, EU_DE.materials.al.kappa]).toEqual([0.036, 35]);
    expect(EU_DE.annexGReactanceOhmPerM).toBe(0.00008);
  });

  it('D58: every entry has German texts; customer-facing texts carry no internal notes or ids', () => {
    // proper names that stay as cited in German
    const sameInGerman = new Set(['vde-ar-n-4100:standard']);
    for (const id of SOURCE_IDS) {
      const s = SOURCES[id];
      for (const f of ['standard', 'clause', 'summary'] as const) {
        expect(s.de[f].length).toBeGreaterThan(3);
        if (!sameInGerman.has(`${id}:${f}`)) expect(`${id}:${f}:${s.de[f]}`).not.toBe(`${id}:${f}:${s[f]}`);
      }
      expect(Boolean((s as { unconfirmed?: string }).unconfirmed)).toBe(Boolean((s.de as { unconfirmed?: string }).unconfirmed));
      const texts = [s.standard, s.clause, s.summary, (s as { unconfirmed?: string }).unconfirmed ?? '', s.de.standard, s.de.clause, s.de.summary, (s.de as { unconfirmed?: string }).unconfirmed ?? ''];
      for (const t of texts) expect(bannedWordsIn(t)).toEqual([]);
      for (const t of texts) expect(t).not.toMatch(/\((?:R|D|L|P)\d+\)|\bowner\b|\btester\b|TODO|FIXME/i);
    }
  });

  it('D43/D58: the aluminium α20 entry links the primary public source NBS Handbook 109', () => {
    expect(SOURCES['al-alpha20'].publicUrl).toBe('https://doi.org/10.6028/NBS.HB.109');
    expect(SOURCES['al-alpha20'].unconfirmed).toContain('NBS Handbook 109');
  });

  it('review #15: the measured-factor clause names k_meas and Cmin, not a fixed ⅔', () => {
    expect(SOURCES['measured-factor'].clause).toContain('k_meas · Cmin');
  });
});
