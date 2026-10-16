// Regional profiles (D13). v1 has one: 'eu-de' (IEC 60364 / DIN VDE). Every German/IEC constant lives here or in
// sources.ts, never in the formulas, so a US/NEC or UK/BS 7671 profile is a new object, not a code change.
import type { SourceId } from './sources';
import type { Insulation, Material, McbCurve } from './types';

export type MaterialConstants = {
  /** ρ20, Ω·mm²/m. */
  rho20: number;
  /** α20, 1/K. */
  alpha20: number;
  /** Annex G ρ1, Ω·mm²/m (M1). */
  rhoAnnexG: number;
  /** κ, m/(Ω·mm²) (M3). */
  kappa: number;
  rho20Source: SourceId;
  alpha20Source: SourceId;
};

export type LimitPreset = { id: string; percent: number; source: SourceId };

export type Profile = {
  id: string;
  version: string;
  materials: Record<Material, MaterialConstants>;
  /** Annex G λ, Ω/m (M1). */
  annexGReactanceOhmPerM: number;
  /** Default cable reactance X' for M2/M3, Ω/m. */
  defaultReactanceOhmPerM: number;
  /** Default conductor temperature per insulation, °C (M2, resistance). */
  conductorTempC: Record<Insulation, number>;
  defaultInsulation: Insulation;
  /** IEC 60228 series, mm², ascending. */
  metricSizesMm2: readonly number[];
  /** AWG gauges checked for the minimum section when the input unit is AWG, ascending area (40 … −3 = 4/0). */
  awgGauges: readonly number[];
  awgRange: { min: number; max: number };
  /** IEC 60898-1 preferred MCB ratings, A, ascending. */
  mcbRatingsA: readonly number[];
  /** Ia = multiple × In (upper limit of the instantaneous range). */
  mcbTripMultiple: Record<McbCurve, number>;
  /** I2 = factor × In for MCBs. */
  mcbI2Factor: number;
  /** C3: I2 ≤ factor × Iz. */
  coordI2Factor: number;
  /** Correction factors must be in (0, maxFactor]. */
  maxFactor: number;
  limitPresets: readonly LimitPreset[];
  loop: { u0: number; thetaC: number; cmin: number; measuredFactor: number };
  /** Above these the result carries the warning "outside the typical range of this tool" (SPEC §13). */
  typicalRange: { lengthM: number; currentA: number };
};

const RHO_CU = 1 / 58;

export const EU_DE: Profile = {
  id: 'eu-de',
  version: '1',
  materials: {
    cu: {
      rho20: RHO_CU,
      alpha20: 0.00393,
      rhoAnnexG: 0.0225,
      kappa: 56,
      rho20Source: 'iec60028',
      alpha20Source: 'iec60028',
    },
    al: {
      rho20: 1 / (0.61 * 58),
      alpha20: 0.00403,
      rhoAnnexG: 0.036,
      kappa: 35,
      rho20Source: 'iacs-al',
      alpha20Source: 'al-alpha20',
    },
  },
  annexGReactanceOhmPerM: 0.08e-3,
  defaultReactanceOhmPerM: 0.08e-3,
  conductorTempC: { pvc: 70, xlpe: 90 },
  defaultInsulation: 'pvc',
  metricSizesMm2: [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240, 300],
  awgGauges: Array.from({ length: 44 }, (_, i) => 40 - i),
  awgRange: { min: -3, max: 40 },
  mcbRatingsA: [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125],
  mcbTripMultiple: { B: 5, C: 10, D: 20 },
  mcbI2Factor: 1.45,
  coordI2Factor: 1.45,
  maxFactor: 1.5,
  limitPresets: [
    { id: 'din18015-1', percent: 3, source: 'din18015-1' },
    { id: 'vde-ar-n-4100', percent: 0.5, source: 'vde-ar-n-4100' },
    { id: 'iec-g-lighting', percent: 3, source: 'iec60364-5-52-G' },
    { id: 'iec-g-other', percent: 5, source: 'iec60364-5-52-G' },
  ],
  loop: { u0: 230, thetaC: 70, cmin: 1.0, measuredFactor: 2 / 3 },
  typicalRange: { lengthM: 10000, currentA: 10000 },
};

export const PROFILES: Record<string, Profile> = { [EU_DE.id]: EU_DE };
