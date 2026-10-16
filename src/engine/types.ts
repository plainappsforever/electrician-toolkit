// Engine input and output types (SPEC §7, V1_PLAN "Architecture"). Pure TypeScript: no React Native, no database.
// Numbers are IEEE doubles in SI units (D22); display rounding happens only in the UI/report (P4/P5).
// A CalcInput is plain JSON so a saved calculation (D20) stores it verbatim; a CalcResult is plain JSON too.
import type { MessageKey } from '../i18n/en';
import type { SourceId } from './sources';

/** Bump when a formula, default or output field changes; saved calculations keep the version they were made with. */
export const ENGINE_VERSION = '1.1.0';

export type CalcKind = 'vdrop' | 'current' | 'ohm' | 'coord' | 'loop' | 'resistance' | 'convert';
export const CALC_KINDS: readonly CalcKind[] = ['vdrop', 'current', 'ohm', 'coord', 'loop', 'resistance', 'convert'];

export type Unit =
  | ''
  | 'V'
  | 'A'
  | 'Ω'
  | 'Ω/m'
  | '%'
  | 'm'
  | 'ft'
  | 'mm'
  | 'mm²'
  | 'kcmil'
  | 'AWG'
  | 'W'
  | 'VA'
  | 'var'
  | '°C'
  | 'Ω·mm²/m'
  | '1/K'
  | 'm/(Ω·mm²)';

/** A number in a formula text, a label key, or a plain text (e.g. "B13"). Formatted by the UI language (D37 pattern). */
export type Var =
  | { kind: 'num'; value: number; unit: Unit }
  | { kind: 'text'; value: string }
  | { kind: 'key'; value: MessageKey };
export type Vars = Record<string, Var>;

/** One formula line with substituted numbers: `key` is an i18n key in src/i18n/{en,de}.ts, `vars` fill its placeholders. */
export type Step = { key: MessageKey; vars: Vars; source?: SourceId };

/** A named assumption. `isDefault` = the engine filled it in because the input did not say otherwise. */
export type Assumption = { key: MessageKey; vars: Vars; source?: SourceId; isDefault: boolean };

/** A warning (result still valid) or an error (no result). `code` is stable for tests and the oracle (P3). */
export type Issue = { code: string; key: MessageKey; vars: Vars; field?: string };

/** One output quantity: its value, unit, the step key whose formula produced it, and the source id of that formula. */
export type Value = { value: number; unit: Unit; formula: MessageKey; source: SourceId };

/** A comparison against a limit the user selected ("met / not met" — never a compliance verdict, D16). */
export type Check = { id: string; met: boolean; key: MessageKey; vars: Vars; source: SourceId };

export type CalcResult = {
  kind: CalcKind;
  /** true when errors is empty. */
  ok: boolean;
  values: Record<string, Value>;
  /** Text outputs, e.g. { method: 'M1', suggestion: 'B13', verdict: 'exceeds' }. */
  texts: Record<string, string>;
  checks: Check[];
  steps: Step[];
  assumptions: Assumption[];
  /** Every source id used by a value, step, check or assumption (sorted, unique). Resolve with SOURCES. */
  sources: SourceId[];
  warnings: Issue[];
  errors: Issue[];
  engineVersion: string;
  profileId: string;
  profileVersion: string;
  /**
   * The input as the engine used it (ok results only, D53): the given input without the fields this calculation
   * ignored (cos φ/X' on DC, η when a current is given, cable fields in measured mode …) and without unknown fields.
   * This is what is stored and printed; compute(kind, usedInput) gives the same result.
   */
  usedInput?: CalcInput;
};

// ---------- inputs (SI units; length and conductor size carry their input unit so "switching units keeps the
// physical value" and the minimum-section list follows the input unit, SPEC §7.3) ----------

export type Material = 'cu' | 'al';
export type System = 'dc' | 'ac1' | 'ac3';
export type VdropMethod = 'M1' | 'M2' | 'M3';
export type Insulation = 'pvc' | 'xlpe';
export type McbCurve = 'B' | 'C' | 'D';

/** Length as typed: metres or feet (1 ft = 0.3048 m exactly). */
export type Length = { value: number; unit: 'm' | 'ft' };
/** Conductor cross-section as typed: mm², AWG gauge number (−3 = 4/0 … 40, integer) or kcmil. */
export type Size = { value: number; unit: 'mm2' | 'awg' | 'kcmil' };

export type VdropInput = {
  system: System;
  /** U (DC, single-phase L–N) or Un (three-phase line-to-line), V. */
  voltage: number;
  /** Load current I, A — give either current or power. */
  current?: number;
  /** Rated (output) power P, W — the engine derives I with §7.4 using cosPhi and efficiency. */
  power?: number;
  /** η for the power → current step (default 1). */
  efficiency?: number;
  /** One-way length. */
  length: Length;
  material: Material;
  size: Size;
  /** Equal conductors in parallel per phase (default 1). */
  parallel?: number;
  /** AC only (default 1); forced to 1 for DC. */
  cosPhi?: number;
  /** Default 'M1' (Annex G). */
  method?: VdropMethod;
  /** M2 conductor temperature, °C (default from insulation: PVC 70, XLPE/EPR 90). */
  conductorTempC?: number;
  insulation?: Insulation;
  /** M2/M3 cable reactance X', Ω/m (default 0.08 mΩ/m = 0.00008 Ω/m). M1 always uses λ = 0.08 mΩ/m. */
  reactanceOhmPerM?: number;
  /** M3 conductivity κ, m/(Ω·mm²) (default 56 Cu, 35 Al). */
  kappa?: number;
  /** Selected limit, % of U0. */
  limitPercent: number;
  /** Id of the limit preset (profile.limitPresets) the limit came from; omitted = "custom". */
  limitPreset?: string;
};

export type CurrentInput = {
  system: System;
  voltage: number;
  /** Give exactly one of power (rated output, W) or current (A). */
  power?: number;
  current?: number;
  cosPhi?: number;
  efficiency?: number;
};

/** Ohm's law (resistive/DC): exactly two of the four. */
export type OhmInput = { voltage?: number; current?: number; resistance?: number; power?: number };

export type ProtectiveDevice =
  | { type: 'mcb'; curve: McbCurve; ratedCurrent: number }
  /** Fuse, MCCB …: In and I2 from the manufacturer (coord); Ia for the disconnection time (loop). */
  | { type: 'other'; ratedCurrent?: number; i2?: number; ia?: number };

/** The user's own table row (D14), copied into the input so a saved calculation never changes (D20). */
export type UserTableRow = {
  tableName?: string;
  sourceNote?: string;
  sizeMm2?: number;
  izA: number;
  insulationMaxC?: number;
  referenceAmbientC?: number;
  /** v1.1 F8 (REVIEW_V1 #8): what the Iz belongs to, so a record handed over years later still says it (optional: old snapshots lack them). */
  material?: 'cu' | 'al';
  methodLabel?: string;
  loadedConductors?: 2 | 3;
};

export type CoordInput = {
  /** Design current Ib, A. */
  ib: number;
  device: ProtectiveDevice;
  /** Iz from a user table row; or izTyped (typed value). One of the two. */
  table?: UserTableRow;
  izTyped?: number;
  /** Conductor max temperature / table reference ambient when Iz is typed (needed only for the computed f_θ). */
  insulationMaxC?: number;
  referenceAmbientC?: number;
  /** Actual ambient θa, °C. Omitted → f_θ = 1 (ambient = reference, assumption). */
  ambientC?: number;
  /** Typed f_θ overrides the computed one. */
  fTheta?: number;
  /** Grouping factor (default 1), other factor (default 1). */
  fGroup?: number;
  fOther?: number;
};

export type LoopInput = {
  mode?: 'calculated' | 'measured';
  /** U0, V (default 230). */
  u0?: number;
  device: ProtectiveDevice;
  /** Cmin (default 1.0; 0.95 "with voltage factor"). */
  cmin?: number;
  // calculated mode
  ze?: number;
  material?: Material;
  lineSize?: Size;
  peSize?: Size;
  length?: Length;
  /** Conductor temperature for the loop resistance, °C (default 70). */
  loopTempC?: number;
  // measured mode
  zsMeasured?: number;
  /** k_meas (default 2/3; options 0.8, 1.0). */
  measuredFactor?: number;
};

export type ResistanceInput = {
  material: Material;
  size: Size;
  length: Length;
  /** Conductor temperature θ, °C (default 70). R at 20 °C is always shown too. */
  temperatureC?: number;
  parallel?: number;
  /** Protective/return conductor size if different from the line conductor (loop = R_L + R_PE). */
  peSize?: Size;
};

export type ConvertInput =
  | { from: 'awg'; value: number }
  | { from: 'mm2'; value: number }
  | { from: 'kcmil'; value: number }
  | { from: 'ft'; value: number }
  | { from: 'm'; value: number };

export type CalcInputByKind = {
  vdrop: VdropInput;
  current: CurrentInput;
  ohm: OhmInput;
  coord: CoordInput;
  loop: LoopInput;
  resistance: ResistanceInput;
  convert: ConvertInput;
};
export type CalcInput = CalcInputByKind[CalcKind];
