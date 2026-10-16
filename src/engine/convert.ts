// Conversions (SPEC §7.7): AWG ↔ mm² (exact formula; nearest metric standard sizes ≥ and ≤), kcmil ↔ mm², ft ↔ m.
import { type Builder, isRecord, key, num } from './result';
import type { ConvertInput } from './types';
import {
  awgAreaMm2,
  awgAtLeast,
  awgAtMost,
  awgDiameterMm,
  awgFromAreaMm2,
  awgLabel,
  ftToM,
  isAwg,
  KCMIL_MM2,
  kcmilToMm2,
  metricAtLeast,
  metricAtMost,
  mm2ToKcmil,
  mToFt,
} from './units';

const FROM = ['awg', 'mm2', 'kcmil', 'ft', 'm'] as const;

/** Nearest metric standard sizes around an area (absent when outside the 0.5–300 mm² list). */
function nearestMetric(b: Builder, mm2: number) {
  const up = metricAtLeast(mm2, b.profile);
  const down = metricAtMost(mm2, b.profile);
  b.assume('assume.vdrop.sizes.metric', {}, false, 'iec60228');
  if (up !== undefined) b.value('metricAtLeast', up, 'mm²', 'step.convert.nearest', 'iec60228');
  if (down !== undefined) b.value('metricAtMost', down, 'mm²', 'step.convert.nearest', 'iec60228');
  b.step('step.convert.nearest', { s: num(mm2, 'mm²'), up: up === undefined ? key('convert.none') : num(up, 'mm²'), down: down === undefined ? key('convert.none') : num(down, 'mm²') }, 'iec60228');
}

export function computeConvert(b: Builder, raw: unknown) {
  if (!isRecord(raw)) return b.error('input.missing', 'error.input.missing', { field: key('field.input') }, 'input');
  const input = raw as Partial<Record<keyof ConvertInput, unknown>>;
  const from = b.option(input.from, 'from', FROM);
  if (from === undefined) return;
  if (from === 'awg') {
    const n = b.number(input.value, 'value');
    if (n === undefined) return;
    if (!isAwg(n, b.profile)) return b.error('input.awg', 'error.input.awg', { field: key('field.value') }, 'value');
    const d = awgDiameterMm(n);
    const a = awgAreaMm2(n);
    b.step('step.convert.awg', { n: num(n, 'AWG'), d: num(d, 'mm'), s: num(a, 'mm²') }, 'astm-b258');
    b.assume('assume.convert.awg', {}, false, 'astm-b258');
    b.value('diameterMm', d, 'mm', 'step.convert.awg', 'astm-b258');
    b.value('mm2', a, 'mm²', 'step.convert.awg', 'astm-b258');
    b.value('kcmil', mm2ToKcmil(a), 'kcmil', 'step.convert.toKcmil', 'astm-b258');
    b.step('step.convert.toKcmil', { s: num(a, 'mm²'), k: num(mm2ToKcmil(a), 'kcmil') }, 'astm-b258');
    b.setText('awg', awgLabel(n));
    nearestMetric(b, a);
    return;
  }
  const v = b.positive(input.value, 'value');
  if (v === undefined) return;
  if (from === 'mm2' || from === 'kcmil') {
    const mm2 = from === 'mm2' ? v : kcmilToMm2(v);
    b.assume('assume.convert.kcmil', { f: num(KCMIL_MM2, 'mm²') }, false, 'astm-b258');
    if (from === 'kcmil') {
      b.step('step.convert.kcmil', { k: num(v, 'kcmil'), s: num(mm2, 'mm²') }, 'astm-b258');
      b.value('mm2', mm2, 'mm²', 'step.convert.kcmil', 'astm-b258');
    } else {
      b.step('step.convert.toKcmil', { s: num(mm2, 'mm²'), k: num(mm2ToKcmil(mm2), 'kcmil') }, 'astm-b258');
      b.value('kcmil', mm2ToKcmil(mm2), 'kcmil', 'step.convert.toKcmil', 'astm-b258');
    }
    const g = awgFromAreaMm2(mm2);
    b.step('step.convert.awgExact', { s: num(mm2, 'mm²'), n: num(g, '') }, 'astm-b258');
    b.value('awgExact', g, '', 'step.convert.awgExact', 'astm-b258');
    const up = awgAtLeast(mm2, b.profile);
    const down = awgAtMost(mm2, b.profile);
    if (up !== undefined) b.value('awgAtLeast', up, 'AWG', 'step.convert.awgExact', 'astm-b258');
    if (down !== undefined) b.value('awgAtMost', down, 'AWG', 'step.convert.awgExact', 'astm-b258');
    nearestMetric(b, mm2);
    return;
  }
  b.assume('assume.convert.foot', {}, false, 'si-units');
  if (from === 'ft') {
    b.step('step.convert.ft', { ft: num(v, 'ft'), m: num(ftToM(v), 'm') }, 'si-units');
    b.value('m', ftToM(v), 'm', 'step.convert.ft', 'si-units');
  } else {
    b.step('step.convert.m', { m: num(v, 'm'), ft: num(mToFt(v), 'ft') }, 'si-units');
    b.value('ft', mToFt(v), 'ft', 'step.convert.m', 'si-units');
  }
}
