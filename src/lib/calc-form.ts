// Calculator form model (SPEC §9, D26, D53): what a person types (text per field, chips) ⇄ the engine's CalcInput.
// Pure and language-free apart from the decimal convention, so Jest can type E1–E8 "through the form" and compare with
// the oracle values; the screens only render this state. Rules:
//  - empty field = not given (the engine reports "missing" or applies its documented default);
//  - an unreadable field is reported in `problems` and left out;
//  - fields the engine ignores are hidden by the screen and never put into the input (D53: cos φ/X' on DC, η while a
//    current is typed); `usedInput` on the result is what is stored and printed;
//  - `'custom'` is never passed as a limitPreset (omitted).
import {
  EU_DE,
  type CalcInput,
  type CalcInputByKind,
  type CalcKind,
  type Material,
  type McbCurve,
  type Size,
  type System,
  type UserTableRow,
  type VdropMethod,
} from '@/engine';
import { numberConvention, parseAwg, parseNumber, type ParseConvention, type ParseError } from '@/engine/parse';
import { awgLabel } from '@/engine/units';

export type Problems = Record<string, ParseError>;
export type SizeUnit = Size['unit'];
export type LengthUnit = 'm' | 'ft';

export type Defaults = {
  lengthUnit: LengthUnit;
  vdropMethod: VdropMethod;
  vdropLimitPreset: string;
  vdropLimitPercent: number;
  conductorTempC: number;
  reactanceMohmPerM: number;
  loopTempC: number;
  cmin: number;
  measuredFactor: number;
};

export const FALLBACK_DEFAULTS: Defaults = {
  lengthUnit: 'm',
  vdropMethod: 'M1',
  vdropLimitPreset: EU_DE.limitPresets[0].id,
  vdropLimitPercent: 3,
  conductorTempC: 70,
  reactanceMohmPerM: 0.08,
  loopTempC: 70,
  cmin: 1,
  measuredFactor: 2 / 3,
};

export type DeviceForm = { type: 'mcb' | 'other'; curve: McbCurve; rating: string; otherIn: string; otherI2: string; otherIa: string };

export type VdropForm = {
  system: System;
  voltage: string;
  load: 'current' | 'power';
  current: string;
  power: string;
  powerUnit: 'W' | 'kW';
  efficiency: string;
  cosPhi: string;
  length: string;
  lengthUnit: LengthUnit;
  material: Material;
  size: string;
  sizeUnit: SizeUnit;
  parallel: string;
  method: VdropMethod;
  preset: string;
  limit: string;
  insulation: 'pvc' | 'xlpe';
  theta: string;
  reactance: string;
  kappa: string;
};
export type CurrentForm = { system: System; voltage: string; load: 'current' | 'power'; current: string; power: string; powerUnit: 'W' | 'kW'; cosPhi: string; efficiency: string };
export type OhmForm = { voltage: string; current: string; resistance: string; power: string };
export type CoordForm = {
  ib: string;
  device: DeviceForm;
  izSource: 'table' | 'typed';
  table: UserTableRow | null;
  izTyped: string;
  insulationMaxC: string;
  referenceAmbientC: string;
  ambientC: string;
  fTheta: string;
  fGroup: string;
  fOther: string;
};
export type LoopForm = {
  mode: 'calculated' | 'measured';
  u0: string;
  ze: string;
  material: Material;
  lineSize: string;
  peSize: string;
  sizeUnit: SizeUnit;
  length: string;
  lengthUnit: LengthUnit;
  loopTemp: string;
  device: DeviceForm;
  cmin: string;
  zsMeasured: string;
  measuredFactor: string;
};
export type ResistanceForm = { material: Material; size: string; sizeUnit: SizeUnit; peSize: string; length: string; lengthUnit: LengthUnit; temperature: string; parallel: string };
export type ConvertForm = { from: 'awg' | 'mm2' | 'kcmil' | 'ft' | 'm'; value: string };

export type FormByKind = {
  vdrop: VdropForm;
  current: CurrentForm;
  ohm: OhmForm;
  coord: CoordForm;
  loop: LoopForm;
  resistance: ResistanceForm;
  convert: ConvertForm;
};

/** The convention for typed numbers: the DEVICE's decimal separator decides, else the UI language. */
export function conventionFor(decimalSeparator: string | null | undefined, language: 'en' | 'de'): ParseConvention {
  return numberConvention(decimalSeparator, language);
}

/** A number as typed text in the given convention: 1.5 → "1.5" (en) / "1,5" (de); 12 significant digits. */
export function numText(value: number, conv: ParseConvention): string {
  const s = String(Number(value.toPrecision(12)));
  return conv === 'de' ? s.replace('.', ',') : s;
}

const emptyDevice = (): DeviceForm => ({ type: 'mcb', curve: 'B', rating: '16', otherIn: '', otherI2: '', otherIa: '' });
const PVC_THETA = EU_DE.conductorTempC.pvc;

export function initialForm<K extends CalcKind>(kind: K, d?: Defaults, conv?: ParseConvention): FormByKind[K];
export function initialForm(kind: CalcKind, d: Defaults = FALLBACK_DEFAULTS, conv: ParseConvention = 'en'): FormByKind[CalcKind] {
  const lengthUnit = d.lengthUnit;
  switch (kind) {
    case 'vdrop':
      return {
        system: 'ac1',
        voltage: '230',
        load: 'current',
        current: '',
        power: '',
        powerUnit: 'kW',
        efficiency: '',
        cosPhi: '',
        length: '',
        lengthUnit,
        material: 'cu',
        size: '',
        sizeUnit: 'mm2',
        parallel: '',
        method: d.vdropMethod,
        preset: d.vdropLimitPreset,
        limit: numText(d.vdropLimitPercent, conv),
        insulation: 'pvc',
        // a stored default equal to the engine's own default is left blank so the result says "default" (honest labelling)
        theta: d.conductorTempC === PVC_THETA ? '' : numText(d.conductorTempC, conv),
        reactance: d.reactanceMohmPerM === EU_DE.defaultReactanceOhmPerM * 1000 ? '' : numText(d.reactanceMohmPerM, conv),
        kappa: '',
      };
    case 'current':
      return { system: 'ac1', voltage: '230', load: 'power', current: '', power: '', powerUnit: 'kW', cosPhi: '', efficiency: '' };
    case 'ohm':
      return { voltage: '', current: '', resistance: '', power: '' };
    case 'coord':
      return {
        ib: '',
        device: emptyDevice(),
        izSource: 'table',
        table: null,
        izTyped: '',
        insulationMaxC: '70',
        referenceAmbientC: '30',
        ambientC: '',
        fTheta: '',
        fGroup: '',
        fOther: '',
      };
    case 'loop':
      return {
        mode: 'calculated',
        u0: numText(EU_DE.loop.u0, conv),
        ze: '',
        material: 'cu',
        lineSize: '',
        peSize: '',
        sizeUnit: 'mm2',
        length: '',
        lengthUnit,
        loopTemp: numText(d.loopTempC, conv),
        device: emptyDevice(),
        cmin: numText(d.cmin, conv),
        zsMeasured: '',
        measuredFactor: numText(d.measuredFactor, conv),
      };
    case 'resistance':
      return { material: 'cu', size: '', sizeUnit: 'mm2', peSize: '', length: '', lengthUnit, temperature: '', parallel: '' };
    case 'convert':
      return { from: 'awg', value: '' };
  }
}

// ---------------------------------------------------------------- form → input

class Reader {
  problems: Problems = {};
  constructor(private conv: ParseConvention) {}

  /** A number or undefined (empty, or unreadable → recorded in problems). */
  num(field: string, text: string, opts: { allowNegative?: boolean; scale?: number } = {}): number | undefined {
    if (text.trim() === '') return undefined;
    const r = parseNumber(text, this.conv, { allowNegative: opts.allowNegative });
    if (!r.ok) {
      this.problems[field] = r.error;
      return undefined;
    }
    return opts.scale === undefined ? r.value : r.value * opts.scale;
  }

  awg(field: string, text: string): number | undefined {
    if (text.trim() === '') return undefined;
    const r = parseAwg(text);
    if (!r.ok) {
      this.problems[field] = r.error;
      return undefined;
    }
    return r.value;
  }

  size(field: string, text: string, unit: SizeUnit): Size | undefined {
    const value = unit === 'awg' ? this.awg(field, text) : this.num(field, text);
    return value === undefined ? undefined : { value, unit };
  }

  length(field: string, text: string, unit: LengthUnit): { value: number; unit: LengthUnit } | undefined {
    const value = this.num(field, text);
    return value === undefined ? undefined : { value, unit };
  }
}

function putDefined(o: Record<string, unknown>, k: string, v: unknown) {
  if (v !== undefined) o[k] = v;
}

const power = (r: Reader, text: string, unit: 'W' | 'kW') => r.num('power', text, { scale: unit === 'kW' ? 1000 : 1 });

function deviceInput(r: Reader, d: DeviceForm, need: 'coord' | 'loop'): Record<string, unknown> {
  if (d.type === 'mcb') {
    const rating = r.num('rating', d.rating);
    const o: Record<string, unknown> = { type: 'mcb', curve: d.curve };
    putDefined(o, 'ratedCurrent', rating);
    return o;
  }
  const o: Record<string, unknown> = { type: 'other' };
  if (need === 'coord') {
    putDefined(o, 'ratedCurrent', r.num('otherIn', d.otherIn));
    putDefined(o, 'i2', r.num('otherI2', d.otherI2));
  } else {
    putDefined(o, 'ia', r.num('otherIa', d.otherIa));
  }
  return o;
}

export function buildInput<K extends CalcKind>(kind: K, form: FormByKind[K], conv: ParseConvention): { input: CalcInputByKind[K]; problems: Problems };
export function buildInput(kind: CalcKind, form: FormByKind[CalcKind], conv: ParseConvention): { input: CalcInput; problems: Problems } {
  const r = new Reader(conv);
  const o: Record<string, unknown> = {};
  switch (kind) {
    case 'vdrop': {
      const f = form as VdropForm;
      o.system = f.system;
      putDefined(o, 'voltage', r.num('voltage', f.voltage));
      if (f.load === 'current') putDefined(o, 'current', r.num('current', f.current));
      else {
        putDefined(o, 'power', power(r, f.power, f.powerUnit));
        putDefined(o, 'efficiency', r.num('efficiency', f.efficiency));
      }
      putDefined(o, 'length', r.length('length', f.length, f.lengthUnit));
      o.material = f.material;
      putDefined(o, 'size', r.size('size', f.size, f.sizeUnit));
      putDefined(o, 'parallel', r.num('parallel', f.parallel));
      if (f.system !== 'dc') putDefined(o, 'cosPhi', r.num('cosPhi', f.cosPhi));
      o.method = f.method;
      const preset = EU_DE.limitPresets.find((p) => p.id === f.preset);
      if (preset) {
        o.limitPreset = preset.id; // 'custom' is never passed (D53)
        o.limitPercent = preset.percent;
      } else putDefined(o, 'limitPercent', r.num('limit', f.limit));
      if (f.insulation === 'xlpe') o.insulation = 'xlpe';
      putDefined(o, 'conductorTempC', r.num('theta', f.theta, { allowNegative: true }));
      if (f.system !== 'dc') putDefined(o, 'reactanceOhmPerM', r.num('reactance', f.reactance, { scale: 0.001 }));
      putDefined(o, 'kappa', r.num('kappa', f.kappa));
      break;
    }
    case 'current': {
      const f = form as CurrentForm;
      o.system = f.system;
      putDefined(o, 'voltage', r.num('voltage', f.voltage));
      if (f.load === 'current') putDefined(o, 'current', r.num('current', f.current));
      else putDefined(o, 'power', power(r, f.power, f.powerUnit));
      if (f.system !== 'dc') putDefined(o, 'cosPhi', r.num('cosPhi', f.cosPhi));
      putDefined(o, 'efficiency', r.num('efficiency', f.efficiency));
      break;
    }
    case 'ohm': {
      const f = form as OhmForm;
      for (const k of ['voltage', 'current', 'resistance', 'power'] as const) putDefined(o, k, r.num(k, f[k]));
      break;
    }
    case 'coord': {
      const f = form as CoordForm;
      putDefined(o, 'ib', r.num('ib', f.ib));
      o.device = deviceInput(r, f.device, 'coord');
      if (f.izSource === 'table') {
        if (f.table) o.table = { ...f.table };
      } else {
        putDefined(o, 'izTyped', r.num('izTyped', f.izTyped));
        putDefined(o, 'insulationMaxC', r.num('insulationMaxC', f.insulationMaxC, { allowNegative: true }));
        putDefined(o, 'referenceAmbientC', r.num('referenceAmbientC', f.referenceAmbientC, { allowNegative: true }));
      }
      putDefined(o, 'ambientC', r.num('ambientC', f.ambientC, { allowNegative: true }));
      putDefined(o, 'fTheta', r.num('fTheta', f.fTheta));
      putDefined(o, 'fGroup', r.num('fGroup', f.fGroup));
      putDefined(o, 'fOther', r.num('fOther', f.fOther));
      break;
    }
    case 'loop': {
      const f = form as LoopForm;
      o.mode = f.mode;
      putDefined(o, 'u0', r.num('u0', f.u0));
      o.device = deviceInput(r, f.device, 'loop');
      putDefined(o, 'cmin', r.num('cmin', f.cmin));
      if (f.mode === 'calculated') {
        putDefined(o, 'ze', r.num('ze', f.ze));
        o.material = f.material;
        putDefined(o, 'lineSize', r.size('lineSize', f.lineSize, f.sizeUnit));
        putDefined(o, 'peSize', r.size('peSize', f.peSize, f.sizeUnit));
        putDefined(o, 'length', r.length('length', f.length, f.lengthUnit));
        putDefined(o, 'loopTempC', r.num('loopTemp', f.loopTemp, { allowNegative: true }));
      } else {
        putDefined(o, 'zsMeasured', r.num('zsMeasured', f.zsMeasured));
        putDefined(o, 'measuredFactor', r.num('measuredFactor', f.measuredFactor));
      }
      break;
    }
    case 'resistance': {
      const f = form as ResistanceForm;
      o.material = f.material;
      putDefined(o, 'size', r.size('size', f.size, f.sizeUnit));
      putDefined(o, 'length', r.length('length', f.length, f.lengthUnit));
      putDefined(o, 'temperatureC', r.num('temperature', f.temperature, { allowNegative: true }));
      putDefined(o, 'parallel', r.num('parallel', f.parallel));
      putDefined(o, 'peSize', r.size('peSize', f.peSize, f.sizeUnit));
      break;
    }
    case 'convert': {
      const f = form as ConvertForm;
      o.from = f.from;
      putDefined(o, 'value', f.from === 'awg' ? r.awg('value', f.value) : r.num('value', f.value));
      break;
    }
  }
  return { input: o as CalcInput, problems: r.problems };
}

// ---------------------------------------------------------------- input → form (reopen a history entry / open as new)

const isRec = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const numOf = (x: unknown, conv: ParseConvention): string => (typeof x === 'number' && Number.isFinite(x) ? numText(x, conv) : '');

function sizeText(x: unknown, conv: ParseConvention): { text: string; unit?: SizeUnit } {
  if (!isRec(x) || typeof x.value !== 'number') return { text: '' };
  const unit = x.unit === 'awg' || x.unit === 'kcmil' || x.unit === 'mm2' ? x.unit : undefined;
  return { text: unit === 'awg' ? awgLabel(x.value) : numOf(x.value, conv), unit };
}

function lengthText(x: unknown, conv: ParseConvention): { text: string; unit?: LengthUnit } {
  if (!isRec(x) || typeof x.value !== 'number') return { text: '' };
  return { text: numOf(x.value, conv), unit: x.unit === 'ft' || x.unit === 'm' ? x.unit : undefined };
}

/** Power W → the chip and text a person would have typed (kW when it is a clean number of kW). */
function powerText(w: unknown, conv: ParseConvention): { text: string; unit: 'W' | 'kW' } {
  if (typeof w !== 'number' || !Number.isFinite(w)) return { text: '', unit: 'kW' };
  const kw = Number((w / 1000).toPrecision(12));
  if (w >= 1000 && kw * 1000 === w) return { text: numText(kw, conv), unit: 'kW' };
  return { text: numText(w, conv), unit: 'W' };
}

function deviceForm(x: unknown, conv: ParseConvention): DeviceForm {
  const d = emptyDevice();
  if (!isRec(x)) return d;
  if (x.type === 'other') {
    return { ...d, type: 'other', otherIn: numOf(x.ratedCurrent, conv), otherI2: numOf(x.i2, conv), otherIa: numOf(x.ia, conv) };
  }
  return { ...d, curve: x.curve === 'C' || x.curve === 'D' ? x.curve : 'B', rating: numOf(x.ratedCurrent, conv) || d.rating };
}

const oneOf = <T extends string>(x: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(x as T) ? (x as T) : fallback);

/** The form that, built again, gives this input (stored inputs are `usedInput`s, so ignored fields are simply absent). */
export function formFromInput<K extends CalcKind>(kind: K, input: unknown, conv: ParseConvention, d?: Defaults): FormByKind[K];
export function formFromInput(kind: CalcKind, input: unknown, conv: ParseConvention, d: Defaults = FALLBACK_DEFAULTS): FormByKind[CalcKind] {
  const base = initialForm(kind, d, conv);
  if (!isRec(input)) return base;
  const x = input;
  switch (kind) {
    case 'vdrop': {
      const f = base as VdropForm;
      const size = sizeText(x.size, conv);
      const len = lengthText(x.length, conv);
      const pw = powerText(x.power, conv);
      const preset = EU_DE.limitPresets.find((p) => p.id === x.limitPreset);
      return {
        ...f,
        system: oneOf(x.system, ['dc', 'ac1', 'ac3'] as const, 'ac1'),
        voltage: numOf(x.voltage, conv),
        load: typeof x.power === 'number' ? 'power' : 'current',
        current: numOf(x.current, conv),
        power: pw.text,
        powerUnit: pw.unit,
        efficiency: numOf(x.efficiency, conv),
        cosPhi: numOf(x.cosPhi, conv),
        length: len.text,
        lengthUnit: len.unit ?? f.lengthUnit,
        material: x.material === 'al' ? 'al' : 'cu',
        size: size.text,
        sizeUnit: size.unit ?? 'mm2',
        parallel: numOf(x.parallel, conv),
        method: oneOf(x.method, ['M1', 'M2', 'M3'] as const, 'M1'),
        preset: preset ? preset.id : 'custom',
        limit: numOf(x.limitPercent, conv) || f.limit,
        insulation: x.insulation === 'xlpe' ? 'xlpe' : 'pvc',
        theta: numOf(x.conductorTempC, conv),
        reactance: typeof x.reactanceOhmPerM === 'number' ? numText(x.reactanceOhmPerM * 1000, conv) : '',
        kappa: numOf(x.kappa, conv),
      } satisfies VdropForm;
    }
    case 'current': {
      const pw = powerText(x.power, conv);
      return {
        system: oneOf(x.system, ['dc', 'ac1', 'ac3'] as const, 'ac1'),
        voltage: numOf(x.voltage, conv),
        load: typeof x.current === 'number' ? 'current' : 'power',
        current: numOf(x.current, conv),
        power: pw.text,
        powerUnit: pw.unit,
        cosPhi: numOf(x.cosPhi, conv),
        efficiency: numOf(x.efficiency, conv),
      } satisfies CurrentForm;
    }
    case 'ohm':
      return { voltage: numOf(x.voltage, conv), current: numOf(x.current, conv), resistance: numOf(x.resistance, conv), power: numOf(x.power, conv) } satisfies OhmForm;
    case 'coord': {
      const f = base as CoordForm;
      const table = isRec(x.table) && typeof x.table.izA === 'number' ? (x.table as unknown as UserTableRow) : null;
      return {
        ...f,
        ib: numOf(x.ib, conv),
        device: deviceForm(x.device, conv),
        izSource: table ? 'table' : 'typed',
        table,
        izTyped: numOf(x.izTyped, conv),
        insulationMaxC: numOf(x.insulationMaxC, conv) || f.insulationMaxC,
        referenceAmbientC: numOf(x.referenceAmbientC, conv) || f.referenceAmbientC,
        ambientC: numOf(x.ambientC, conv),
        fTheta: numOf(x.fTheta, conv),
        fGroup: numOf(x.fGroup, conv),
        fOther: numOf(x.fOther, conv),
      } satisfies CoordForm;
    }
    case 'loop': {
      const f = base as LoopForm;
      const line = sizeText(x.lineSize, conv);
      const pe = sizeText(x.peSize, conv);
      const len = lengthText(x.length, conv);
      return {
        ...f,
        mode: x.mode === 'measured' ? 'measured' : 'calculated',
        u0: numOf(x.u0, conv) || f.u0,
        ze: numOf(x.ze, conv),
        material: x.material === 'al' ? 'al' : 'cu',
        lineSize: line.text,
        peSize: pe.text,
        sizeUnit: line.unit ?? pe.unit ?? 'mm2',
        length: len.text,
        lengthUnit: len.unit ?? f.lengthUnit,
        loopTemp: numOf(x.loopTempC, conv) || f.loopTemp,
        device: deviceForm(x.device, conv),
        cmin: numOf(x.cmin, conv) || f.cmin,
        zsMeasured: numOf(x.zsMeasured, conv),
        measuredFactor: numOf(x.measuredFactor, conv) || f.measuredFactor,
      } satisfies LoopForm;
    }
    case 'resistance': {
      const f = base as ResistanceForm;
      const size = sizeText(x.size, conv);
      const pe = sizeText(x.peSize, conv);
      const len = lengthText(x.length, conv);
      return {
        ...f,
        material: x.material === 'al' ? 'al' : 'cu',
        size: size.text,
        sizeUnit: size.unit ?? 'mm2',
        peSize: pe.text,
        length: len.text,
        lengthUnit: len.unit ?? f.lengthUnit,
        temperature: numOf(x.temperatureC, conv),
        parallel: numOf(x.parallel, conv),
      } satisfies ResistanceForm;
    }
    case 'convert': {
      const from = oneOf(x.from, ['awg', 'mm2', 'kcmil', 'ft', 'm'] as const, 'awg');
      return { from, value: from === 'awg' && typeof x.value === 'number' ? awgLabel(x.value) : numOf(x.value, conv) } satisfies ConvertForm;
    }
  }
}

/** "Enter the values": every error is a missing field (or the load/pair is not complete yet) — no error text yet. */
export const INCOMPLETE_CODES: ReadonlySet<string> = new Set(['input.missing', 'input.oneOf', 'ohm.needTwo', 'coord.izSource']);
