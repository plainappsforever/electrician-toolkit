import type { CalcKind } from '@/engine';
import type { MessageKey } from '@/i18n';

export const KIND_TITLE: Record<CalcKind, MessageKey> = {
  vdrop: 'calc.vdrop',
  current: 'calc.current',
  ohm: 'calc.ohm',
  coord: 'calc.coord',
  loop: 'calc.loop',
  resistance: 'calc.resistance',
  convert: 'calc.convert',
};

/** The six calculators of the Calculators tab (Ohm's law is a segment of "Current & power", SPEC §9). */
export const LISTED_KINDS: readonly CalcKind[] = ['vdrop', 'current', 'coord', 'loop', 'resistance', 'convert'];
