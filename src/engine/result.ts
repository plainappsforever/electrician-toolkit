// Result builder and input validation shared by every calculator. Collects steps, assumptions, values, checks,
// warnings and errors; derives the source list. Validation never throws: it records an error and returns undefined.
import type { MessageKey } from '../i18n/en';
import type { Profile } from './profiles';
import { isSourceId, type SourceId } from './sources';
import {
  ENGINE_VERSION,
  type Assumption,
  type CalcKind,
  type CalcResult,
  type Check,
  type Issue,
  type Step,
  type Unit,
  type Value,
  type Var,
  type Vars,
} from './types';

export const FIELDS = [
  'input',
  'system',
  'voltage',
  'current',
  'power',
  'resistance',
  'efficiency',
  'length',
  'material',
  'size',
  'peSize',
  'lineSize',
  'parallel',
  'cosPhi',
  'method',
  'conductorTemp',
  'insulation',
  'reactance',
  'kappa',
  'limit',
  'limitPreset',
  'ib',
  'device',
  'curve',
  'ratedCurrent',
  'i2',
  'ia',
  'iz',
  'insulationMax',
  'referenceAmbient',
  'ambient',
  'fTheta',
  'fGroup',
  'fOther',
  'mode',
  'u0',
  'ze',
  'cmin',
  'loopTemp',
  'zsMeasured',
  'measuredFactor',
  'temperature',
  'from',
  'value',
] as const;
export type Field = (typeof FIELDS)[number];

/** -0 becomes 0: a result must survive JSON (saved snapshots, D20) unchanged. */
const plain = (x: number) => (x === 0 ? 0 : x);
export const num = (value: number, unit: Unit): Var => ({ kind: 'num', value: plain(value), unit });
export const text = (value: string): Var => ({ kind: 'text', value });
export const key = (value: MessageKey): Var => ({ kind: 'key', value });
export const fieldVar = (field: Field): Var => key(`field.${field}` as MessageKey);

/** Relative tolerance for "≤" comparisons against limits, so a value computed at the limit (Δu(L_max)) is "at" it. */
export const COMPARE_REL_TOL = 1e-12;
/** a ≤ b within COMPARE_REL_TOL (relative to the larger magnitude). */
export function leq(a: number, b: number): boolean {
  return a <= b + COMPARE_REL_TOL * Math.max(Math.abs(a), Math.abs(b));
}

export class Builder {
  readonly values: Record<string, Value> = {};
  readonly texts: Record<string, string> = {};
  readonly checks: Check[] = [];
  readonly steps: Step[] = [];
  readonly assumptions: Assumption[] = [];
  readonly warnings: Issue[] = [];
  readonly errors: Issue[] = [];
  private readonly used = new Set<SourceId>();

  constructor(
    readonly kind: CalcKind,
    readonly profile: Profile,
  ) {}

  step(stepKey: MessageKey, vars: Vars, source?: SourceId) {
    this.steps.push(source ? { key: stepKey, vars, source } : { key: stepKey, vars });
    if (source) this.used.add(source);
  }

  /** Records an output value and the step (formula) it came from. */
  value(name: string, value: number, unit: Unit, formula: MessageKey, source: SourceId): number {
    this.values[name] = { value: plain(value), unit, formula, source };
    this.used.add(source);
    return value;
  }

  assume(assumptionKey: MessageKey, vars: Vars, isDefault: boolean, source?: SourceId) {
    this.assumptions.push(source ? { key: assumptionKey, vars, source, isDefault } : { key: assumptionKey, vars, isDefault });
    if (source) this.used.add(source);
  }

  check(id: string, met: boolean, checkKey: MessageKey, vars: Vars, source: SourceId) {
    this.checks.push({ id, met, key: checkKey, vars, source });
    this.used.add(source);
  }

  warn(code: string, warnKey: MessageKey, vars: Vars = {}) {
    this.warnings.push({ code, key: warnKey, vars });
  }

  error(code: string, errorKey: MessageKey, vars: Vars = {}, field?: Field) {
    this.errors.push(field ? { code, key: errorKey, vars, field } : { code, key: errorKey, vars });
  }

  get failed(): boolean {
    return this.errors.length > 0;
  }

  /** Text outputs never claim compliance; they are ids like 'within', 'B13', 'M1'. */
  setText(name: string, value: string) {
    this.texts[name] = value;
  }

  result(): CalcResult {
    const ok = this.errors.length === 0;
    return {
      kind: this.kind,
      ok,
      values: ok ? this.values : {},
      texts: ok ? this.texts : {},
      checks: ok ? this.checks : [],
      steps: ok ? this.steps : [],
      assumptions: ok ? this.assumptions : [],
      sources: ok ? [...this.used].sort() : [],
      warnings: ok ? this.warnings : [],
      errors: this.errors,
      engineVersion: ENGINE_VERSION,
      profileId: this.profile.id,
      profileVersion: this.profile.version,
    };
  }

  // ---------- validation ----------

  /** A required finite number. */
  number(raw: unknown, field: Field): number | undefined {
    if (raw === undefined || raw === null) {
      this.error('input.missing', 'error.input.missing', { field: fieldVar(field) }, field);
      return undefined;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      this.error('input.notNumber', 'error.input.notNumber', { field: fieldVar(field) }, field);
      return undefined;
    }
    return raw;
  }

  /** An optional finite number: undefined/null → the default. */
  optionalNumber(raw: unknown, field: Field, fallback: number): number | undefined {
    if (raw === undefined || raw === null) return fallback;
    return this.number(raw, field);
  }

  positive(raw: unknown, field: Field): number | undefined {
    const v = this.number(raw, field);
    if (v === undefined) return undefined;
    if (v <= 0) {
      this.error('input.notPositive', 'error.input.notPositive', { field: fieldVar(field) }, field);
      return undefined;
    }
    return v;
  }

  nonNegative(raw: unknown, field: Field): number | undefined {
    const v = this.number(raw, field);
    if (v === undefined) return undefined;
    if (v < 0) {
      this.error('input.negative', 'error.input.negative', { field: fieldVar(field) }, field);
      return undefined;
    }
    return v;
  }

  /** A number in (0, max]. */
  fraction(raw: unknown, field: Field, max = 1): number | undefined {
    const v = this.number(raw, field);
    if (v === undefined) return undefined;
    if (!(v > 0 && v <= max)) {
      this.error('input.range', 'error.input.range', { field: fieldVar(field), max: num(max, '') }, field);
      return undefined;
    }
    return v;
  }

  option<T extends string>(raw: unknown, field: Field, options: readonly T[]): T | undefined {
    if (raw === undefined || raw === null) {
      this.error('input.missing', 'error.input.missing', { field: fieldVar(field) }, field);
      return undefined;
    }
    if (typeof raw !== 'string' || !options.includes(raw as T)) {
      this.error('input.option', 'error.input.option', { field: fieldVar(field), value: text(String(raw)) }, field);
      return undefined;
    }
    return raw as T;
  }

  optionalOption<T extends string>(raw: unknown, field: Field, options: readonly T[], fallback: T): T | undefined {
    if (raw === undefined || raw === null) return fallback;
    return this.option(raw, field, options);
  }

  /** Whole number ≥ 1 (parallel conductors). */
  count(raw: unknown, field: Field, fallback: number): number | undefined {
    const v = this.optionalNumber(raw, field, fallback);
    if (v === undefined) return undefined;
    if (!Number.isInteger(v) || v < 1) {
      this.error('input.count', 'error.input.count', { field: fieldVar(field) }, field);
      return undefined;
    }
    return v;
  }
}

export function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

export function sourceIdOr(id: string | undefined, fallback: SourceId): SourceId {
  return id !== undefined && isSourceId(id) ? id : fallback;
}
