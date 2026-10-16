// Source registry (SPEC §7.8, D30). Every constant, rule and limit preset the engine uses has an id here.
// licence: 'public' = physics/definitions or freely published values; 'licensed-cited' = the clause is cited, its text
// and tables are NOT reproduced (D14). publicUrl = a public restatement a user can read without buying the standard.
// No standard's table or text is copied here — titles, clause numbers and our own one-line summaries only.
// Every text here can reach a customer's PDF (EN or DE): no internal notes, decision or research ids (D58).

export type Licence = 'public' | 'licensed-cited';

export type Source = {
  /** Standard or document name as cited. */
  standard: string;
  edition: string;
  clause: string;
  licence: Licence;
  /** Our own short summary of what is taken from it (English; the Sources screen shows it). */
  summary: string;
  publicUrl?: string;
  /** Set when the value is only confirmed by secondary public restatements, not by reading the licensed primary text. */
  unconfirmed?: string;
  /** German texts for the report and the Sources screen (D58); proper names stay as cited. */
  de: { standard: string; clause: string; summary: string; unconfirmed?: string };
};

export const SOURCES = {
  iec60028: {
    standard: 'IEC 60028 International standard of resistance for copper',
    edition: '1925 (current)',
    clause: 'annealed copper: 1/58 Ω·mm²/m at 20 °C, α20 = 0.00393 1/K',
    licence: 'licensed-cited',
    summary: 'Resistivity and temperature coefficient of annealed copper at 20 °C.',
    publicUrl: 'https://en.wikipedia.org/wiki/Electrical_resistivity_and_conductivity',
    de: {
      standard: 'IEC 60028 Internationaler Normwert für den Widerstand von Kupfer',
      clause: 'geglühtes Kupfer: 1/58 Ω·mm²/m bei 20 °C, α20 = 0,00393 1/K',
      summary: 'Spezifischer Widerstand und Temperaturbeiwert von geglühtem Kupfer bei 20 °C.',
    },
  },
  'iacs-al': {
    standard: 'International Annealed Copper Standard (IACS); IEC 60889 hard-drawn aluminium',
    edition: '—',
    clause: 'aluminium conductor 61 % IACS → ρ20 = 1/(0.61 × 58) Ω·mm²/m',
    licence: 'public',
    summary: 'Aluminium conductor resistivity from the 61 % IACS conductivity definition.',
    publicUrl: 'https://en.wikipedia.org/wiki/International_Annealed_Copper_Standard',
    de: {
      standard: 'International Annealed Copper Standard (IACS); IEC 60889 hartgezogener Aluminiumdraht',
      clause: 'Aluminiumleiter 61 % IACS → ρ20 = 1/(0,61 × 58) Ω·mm²/m',
      summary: 'Spezifischer Widerstand von Aluminiumleitern aus der Leitfähigkeitsdefinition 61 % IACS.',
    },
  },
  'al-alpha20': {
    standard: 'IEC 60287-1-1 (Table 1) / IEC 60228 — temperature coefficient of aluminium',
    edition: 'IEC 60287-1-1:2006+A1:2014; IEC 60228:2004',
    clause: 'Table 1: α20 (Al) = 4.03 × 10⁻³ 1/K',
    licence: 'licensed-cited',
    summary:
      'α20 = 0.00403 1/K for aluminium conductors (61 % IACS). Primary public source: NBS Handbook 109 (1972), Table 1; also restated by the cableizer documentation (citing IEC 60287-1-1) and the AESA Cortaillod application note AN-190227-E (citing IEC 60228).',
    publicUrl: 'https://doi.org/10.6028/NBS.HB.109',
    unconfirmed:
      'The IEC tables themselves were not read; the value agrees with NBS Handbook 109 (1972), Table 1, and two public restatements of the IEC values.',
    de: {
      standard: 'IEC 60287-1-1 (Tabelle 1) / IEC 60228 — Temperaturbeiwert von Aluminium',
      clause: 'Tabelle 1: α20 (Al) = 4,03 × 10⁻³ 1/K',
      summary: 'α20 = 0,00403 1/K für Aluminiumleiter (61 % IACS). Öffentliche Primärquelle: NBS Handbook 109 (1972), Tabelle 1; dazu zwei öffentliche Wiedergaben der IEC-Werte.',
      unconfirmed: 'Die IEC-Tabellen selbst wurden nicht gelesen; der Wert stimmt mit NBS Handbook 109 (1972), Tabelle 1, und zwei öffentlichen Wiedergaben der IEC-Werte überein.',
    },
  },
  'iec60364-5-52-G': {
    standard: 'IEC 60364-5-52 / DIN VDE 0100-520, Annex G (informative): voltage drop',
    edition: 'IEC 60364-5-52:2009+AMD1:2024',
    clause: 'Annex G: u = b(ρ1·L/S·cos φ + λ·L·sin φ)·IB; Δu = 100·u/U0; ρ1 Cu 0.0225, Al 0.036 Ω·mm²/m; λ 0.08 mΩ/m; recommendation 3 % lighting / 5 % other uses',
    licence: 'licensed-cited',
    summary: 'The voltage-drop method M1, its constants and the 3 %/5 % recommendation (informative).',
    publicUrl: 'https://www.trace-software.com/en/verification-of-voltage-drops/',
    unconfirmed: 'The constants ρ1 and λ are taken from public restatements of the standard; they have not been checked against the licensed text.',
    de: {
      standard: 'IEC 60364-5-52 / DIN VDE 0100-520, Anhang G (informativ): Spannungsfall',
      clause: 'Anhang G: u = b(ρ1·L/S·cos φ + λ·L·sin φ)·IB; Δu = 100·u/U0; ρ1 Cu 0,0225, Al 0,036 Ω·mm²/m; λ 0,08 mΩ/m; Empfehlung 3 % Beleuchtung / 5 % andere Verbraucher',
      summary: 'Das Spannungsfall-Verfahren M1, seine Konstanten und die Empfehlung 3 %/5 % (informativ).',
      unconfirmed: 'Die Konstanten ρ1 und λ stammen aus öffentlichen Wiedergaben der Norm; sie wurden nicht am lizenzierten Normtext geprüft.',
    },
  },
  'de-practice-kappa': {
    standard: 'German installation practice: ΔU = 2·L·I·cos φ/(κ·S)',
    edition: '—',
    clause: 'κ ≈ 56 m/(Ω·mm²) copper, 35 aluminium',
    licence: 'public',
    summary: 'Fixed-conductivity voltage-drop method M3 used in German trade training.',
    publicUrl: 'https://www.elektrikerwissen.de/spannungsfall/',
    de: {
      standard: 'Deutsche Installationspraxis: ΔU = 2·L·I·cos φ/(κ·S)',
      clause: 'κ ≈ 56 m/(Ω·mm²) Kupfer, 35 Aluminium',
      summary: 'Spannungsfall-Verfahren M3 mit fester Leitfähigkeit, wie in der deutschen Elektro-Ausbildung gelehrt.',
    },
  },
  'physics-resistance': {
    standard: 'Physics: R = ρ·L/S, ρθ = ρ20·(1 + α20·(θ − 20 °C))',
    edition: '—',
    clause: 'linear temperature model of metallic resistivity',
    licence: 'public',
    summary: 'Conductor resistance from resistivity, length and cross-section, corrected linearly for temperature.',
    publicUrl: 'https://en.wikipedia.org/wiki/Electrical_resistivity_and_conductivity',
    de: {
      standard: 'Physik: R = ρ·L/S, ρθ = ρ20·(1 + α20·(θ − 20 °C))',
      clause: 'lineares Temperaturmodell des spezifischen Widerstands von Metallen',
      summary: 'Leiterwiderstand aus spezifischem Widerstand, Länge und Querschnitt, linear temperaturkorrigiert.',
    },
  },
  'physics-power': {
    standard: "Physics: P = U·I·cos φ, S = U·I, Q = S·sin φ (×√3 three-phase); Ohm's law U = I·R",
    edition: '—',
    clause: 'AC power relations, balanced three-phase',
    licence: 'public',
    summary: 'Load current and power for DC, single-phase and balanced three-phase loads.',
    publicUrl: 'https://en.wikipedia.org/wiki/AC_power',
    de: {
      standard: 'Physik: P = U·I·cos φ, S = U·I, Q = S·sin φ (×√3 bei Drehstrom); Ohmsches Gesetz U = I·R',
      clause: 'Leistungsbeziehungen bei Wechselstrom, symmetrischer Drehstrom',
      summary: 'Laststrom und Leistung für Gleichstrom, Wechselstrom und symmetrischen Drehstrom.',
    },
  },
  'din18015-1': {
    standard: 'DIN 18015-1 Electrical installations in residential buildings',
    edition: 'DIN 18015-1:2020-05',
    clause: 'voltage drop meter → load: 3 %',
    licence: 'licensed-cited',
    summary: 'Limit preset 3 % from the meter to the load.',
    publicUrl: 'https://www.elektrikerwissen.de/spannungsfall/',
    de: {
      standard: 'DIN 18015-1 Elektrische Anlagen in Wohngebäuden',
      clause: 'Spannungsfall Zähler → Verbraucher: 3 %',
      summary: 'Grenzwert-Vorgabe 3 % vom Zähler bis zum Verbraucher.',
    },
  },
  'vde-ar-n-4100': {
    standard: 'VDE-AR-N 4100 (TAR Niederspannung) / TAB',
    edition: 'VDE-AR-N 4100:2019-04',
    clause: 'main line: 0.5 % (≤ 100 kVA)',
    licence: 'licensed-cited',
    summary: 'Limit preset 0.5 % for the main line up to 100 kVA.',
    publicUrl: 'https://iwer.info/article/Elektrotechnik/zulaessiger-Spannungsfall/index.html',
    de: {
      standard: 'VDE-AR-N 4100 (TAR Niederspannung) / TAB',
      clause: 'Hauptleitung: 0,5 % (≤ 100 kVA)',
      summary: 'Grenzwert-Vorgabe 0,5 % für die Hauptleitung bis 100 kVA.',
    },
  },
  'iec60364-4-43-433.1': {
    standard: 'IEC 60364-4-43 / DIN VDE 0100-430: protection against overcurrent',
    edition: 'IEC 60364-4-43:2023',
    clause: '433.1: Ib ≤ In ≤ Iz and I2 ≤ 1.45·Iz',
    licence: 'licensed-cited',
    summary: 'Coordination between conductor and overload protective device (conditions C1–C3).',
    publicUrl: 'https://professional-electrician.com/technical/requirements-protection-overload/',
    de: {
      standard: 'IEC 60364-4-43 / DIN VDE 0100-430: Schutz bei Überstrom',
      clause: '433.1: Ib ≤ In ≤ Iz und I2 ≤ 1,45·Iz',
      summary: 'Zuordnung von Leiter und Überlast-Schutzeinrichtung (Bedingungen C1–C3).',
    },
  },
  'heat-balance': {
    standard: 'Heat balance of a cable: ambient correction f_θ = √((θmax − θa)/(θmax − θref))',
    edition: '—',
    clause: 'I²R losses proportional to the permitted temperature rise',
    licence: 'public',
    summary: 'Computed ambient-temperature factor; your table’s printed factor may differ by rounding.',
    publicUrl: 'https://ecalpro.com/docs/cable-derating-factors-methodology',
    de: {
      standard: 'Wärmebilanz eines Kabels: Umgebungstemperaturfaktor f_θ = √((θmax − θa)/(θmax − θref))',
      clause: 'Stromwärmeverluste proportional zur Erwärmung bis zur Leiter-Grenztemperatur',
      summary: 'Berechneter Umgebungstemperaturfaktor; der gedruckte Faktor Ihrer Tabelle kann durch Rundung abweichen.',
    },
  },
  'iec60898-1': {
    standard: 'IEC 60898-1 / DIN EN 60898-1: circuit-breakers for household installations',
    edition: 'IEC 60898-1:2015+AMD1:2019',
    clause: 'preferred In; instantaneous trip B 3–5·In, C 5–10·In, D 10–20·In; conventional tripping current I2 = 1.45·In',
    licence: 'licensed-cited',
    summary: 'MCB ratings, upper limit of the instantaneous range used as Ia, and I2.',
    publicUrl: 'https://de.wikipedia.org/wiki/Leitungsschutzschalter',
    de: {
      standard: 'IEC 60898-1 / DIN EN 60898-1: Leitungsschutzschalter für Hausinstallationen',
      clause: 'Vorzugswerte In; unverzögerte Auslösung B 3–5·In, C 5–10·In, D 10–20·In; großer Prüfstrom I2 = 1,45·In',
      summary: 'LS-Bemessungsströme, obere Grenze des unverzögerten Auslösebereichs als Ia, und I2.',
    },
  },
  'iec60364-4-41-411.4.4': {
    standard: 'IEC 60364-4-41 / DIN VDE 0100-410: protection against electric shock, TN systems',
    edition: 'IEC 60364-4-41:2005+AMD1:2017',
    clause: '411.4.4: Zs × Ia ≤ U0 (here with Cmin: Zs ≤ Cmin·U0/Ia)',
    licence: 'licensed-cited',
    summary: 'Loop-impedance condition for automatic disconnection in TN systems.',
    publicUrl: 'https://de.wikipedia.org/wiki/Schleifenimpedanz',
    de: {
      standard: 'IEC 60364-4-41 / DIN VDE 0100-410: Schutz gegen elektrischen Schlag, TN-Systeme',
      clause: '411.4.4: Zs × Ia ≤ U0 (hier mit Cmin: Zs ≤ Cmin·U0/Ia)',
      summary: 'Schleifenimpedanz-Bedingung für die automatische Abschaltung in TN-Systemen.',
    },
  },
  'iec60364-4-41-t41.1': {
    standard: 'IEC 60364-4-41 / DIN VDE 0100-410: maximum disconnection times',
    edition: 'IEC 60364-4-41:2005+AMD1:2017',
    clause: 'Table 41.1 / 411.3.2: 0.4 s final circuits ≤ 63 A at 230 V TN; 5 s distribution circuits',
    licence: 'licensed-cited',
    summary: 'Which disconnection time Ia must correspond to (shown as an assumption, not computed).',
    publicUrl: 'https://de.wikipedia.org/wiki/Schleifenimpedanz',
    de: {
      standard: 'IEC 60364-4-41 / DIN VDE 0100-410: maximale Abschaltzeiten',
      clause: 'Tabelle 41.1 / 411.3.2: 0,4 s für Endstromkreise ≤ 63 A bei 230 V TN; 5 s für Verteilungsstromkreise',
      summary: 'Zu welcher Abschaltzeit Ia gehören muss (als Annahme gezeigt, nicht berechnet).',
    },
  },
  'measured-factor': {
    standard: 'Measured loop impedance compared with a reduced limit (cold conductor, low test current)',
    edition: '—',
    clause: 'Zs(measured) ≤ k_meas · Cmin · U0/Ia; k_meas default ⅔',
    licence: 'public',
    summary: 'Measured-mode factor k_meas (default 2/3, options 0.8 and 1.0).',
    publicUrl: 'https://de.wikipedia.org/wiki/Schleifenimpedanz',
    de: {
      standard: 'Gemessene Schleifenimpedanz, verglichen mit einem verringerten Grenzwert (kalter Leiter, kleiner Prüfstrom)',
      clause: 'Zs(gemessen) ≤ k_meas · Cmin · U0/Ia; k_meas Standard ⅔',
      summary: 'Faktor k_meas für Messwerte (Standard 2/3, wählbar 0,8 und 1,0).',
    },
  },
  'astm-b258': {
    standard: 'ASTM B258 American Wire Gauge',
    edition: 'ASTM B258-18',
    clause: 'd(n) = 0.127 mm · 92^((36 − n)/39); 1 kcmil = 1000 circular mils',
    licence: 'licensed-cited',
    summary: 'AWG diameter formula and kcmil definition (pure geometry).',
    publicUrl: 'https://en.wikipedia.org/wiki/American_wire_gauge',
    de: {
      standard: 'ASTM B258 American Wire Gauge (AWG)',
      clause: 'd(n) = 0,127 mm · 92^((36 − n)/39); 1 kcmil = 1000 circular mils',
      summary: 'AWG-Durchmesserformel und kcmil-Definition (reine Geometrie).',
    },
  },
  iec60228: {
    standard: 'IEC 60228 Conductors of insulated cables',
    edition: 'IEC 60228:2004',
    clause: 'nominal cross-sections 0.5 … 300 mm² (series used here)',
    licence: 'licensed-cited',
    summary: 'Metric standard sizes checked for the minimum cross-section.',
    publicUrl: 'https://en.wikipedia.org/wiki/IEC_60228',
    de: {
      standard: 'IEC 60228 / DIN EN 60228 Leiter für Kabel und isolierte Leitungen',
      clause: 'Nennquerschnitte 0,5 … 300 mm² (hier verwendete Reihe)',
      summary: 'Metrische Normquerschnitte, die für den Mindestquerschnitt geprüft werden.',
    },
  },
  'si-units': {
    standard: 'International yard and pound agreement (1959); SI',
    edition: '—',
    clause: '1 ft = 0.3048 m exactly',
    licence: 'public',
    summary: 'Length conversion.',
    publicUrl: 'https://en.wikipedia.org/wiki/Foot_(unit)',
    de: {
      standard: 'Internationales Yard-und-Pfund-Abkommen (1959); SI',
      clause: '1 ft = 0,3048 m exakt',
      summary: 'Längenumrechnung.',
    },
  },
} satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;
export const SOURCE_IDS = Object.keys(SOURCES) as SourceId[];

export function isSourceId(id: string): id is SourceId {
  return Object.prototype.hasOwnProperty.call(SOURCES, id);
}
