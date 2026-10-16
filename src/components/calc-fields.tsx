// The input section of each calculator (SPEC §9). Renders a `FormByKind[K]` state from src/lib/calc-form.ts; knows no
// formulas. Fields the engine would ignore are hidden (D53/SPEC §13: cos φ and X' for DC, η while a current is typed).
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Chips, LinkButton, SectionTitle, TextField } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getCableTable, listCableTables, userTableRow, type CableRow, type CableTable, type CableTableListItem } from '@/db/tables';
import { useDb } from '@/hooks/use-db';
import { useLanguage, useT } from '@/hooks/use-t';
import { EU_DE, type CalcKind } from '@/engine';
import type { MessageKey } from '@/i18n';
import type {
  ConvertForm,
  CoordForm,
  CurrentForm,
  DeviceForm,
  FormByKind,
  LoopForm,
  OhmForm,
  Problems,
  ResistanceForm,
  VdropForm,
} from '@/lib/calc-form';
import { numText } from '@/lib/calc-form';
import { formatNumber } from '@/lib/format';
import type { ParseConvention, ParseError } from '@/engine/parse';

type Set<F> = (patch: Partial<F>) => void;
type Props<K extends CalcKind> = {
  form: FormByKind[K];
  set: Set<FormByKind[K]>;
  problems: Problems;
  conv: ParseConvention;
  optionsOpen: boolean;
  setOptionsOpen: (open: boolean) => void;
};

const SYSTEM_VOLTAGE = { dc: '24', ac1: '230', ac3: '400' } as const;
const STANDARD_SIZES = EU_DE.metricSizesMm2;

function useBind<F extends object>(form: F, set: Set<F>, problems: Problems) {
  const t = useT();
  const message = (p: ParseError | undefined): string | null =>
    p === undefined ? null : p === 'negative' ? t('form.error.negative') : t('form.error.notNumber');
  function bind(
    field: keyof F & string,
    label: string,
    extra: { unit?: string; kind?: 'decimal' | 'signed' | 'text'; hint?: string; right?: ReactNode; placeholder?: string } = {}
  ) {
    return (
      <TextField
        label={label}
        testID={`input-${field}`}
        value={String(form[field] ?? '')}
        onChangeText={(v) => set({ [field]: v } as Partial<F>)}
        error={message(problems[field])}
        {...extra}
      />
    );
  }
  return bind;
}

function SystemChips({ value, onChange }: { value: 'dc' | 'ac1' | 'ac3'; onChange: (v: 'dc' | 'ac1' | 'ac3') => void }) {
  const t = useT();
  return (
    <Chips
      label={t('field.system')}
      testIDPrefix="system"
      value={value}
      onChange={onChange}
      options={[
        { value: 'dc', label: t('system.dc') },
        { value: 'ac1', label: t('system.ac1') },
        { value: 'ac3', label: t('system.ac3') },
      ]}
    />
  );
}

const unitChips = <T extends string>(prefix: string, value: T, onChange: (v: T) => void, options: readonly T[], labels?: Partial<Record<T, string>>) => (
  <Chips testIDPrefix={prefix} value={value} onChange={onChange} options={options.map((o) => ({ value: o, label: labels?.[o] ?? o }))} />
);

function MaterialChips({ value, onChange }: { value: 'cu' | 'al'; onChange: (v: 'cu' | 'al') => void }) {
  const t = useT();
  return (
    <Chips
      label={t('field.material')}
      testIDPrefix="material"
      value={value}
      onChange={onChange}
      options={[
        { value: 'cu', label: t('material.cu') },
        { value: 'al', label: t('material.al') },
      ]}
    />
  );
}

const SIZE_LABELS = { mm2: 'mm²', awg: 'AWG', kcmil: 'kcmil' } as const;

function StandardSizes({ value, onPick, prefix = 'size-chip' }: { value: string; onPick: (v: string) => void; prefix?: string }) {
  const t = useT();
  const lang = useLanguage();
  return (
    <Chips
      label={t('calc.sizeStandard')}
      testIDPrefix={prefix}
      value={STANDARD_SIZES.map(String).includes(value) ? value : null}
      onChange={onPick}
      options={STANDARD_SIZES.map((s) => ({ value: String(s), label: String(s).replace('.', lang === 'de' ? ',' : '.') }))}
    />
  );
}

function Options({ open, onToggle, children }: { open: boolean; onToggle: (v: boolean) => void; children: ReactNode }) {
  const t = useT();
  return (
    <View style={styles.group}>
      <LinkButton testID="options-toggle" label={(open ? '▾ ' : '▸ ') + t('calc.options')} onPress={() => onToggle(!open)} />
      {open ? <View style={styles.group}>{children}</View> : null}
    </View>
  );
}

// ------------------------------------------------------------------ voltage drop

function VdropFields({ form, set, problems, conv, optionsOpen, setOptionsOpen }: Props<'vdrop'>) {
  const t = useT();
  const lang = useLanguage();
  const bind = useBind<VdropForm>(form, set, problems);
  const dc = form.system === 'dc';
  const awg = form.sizeUnit === 'awg';
  const changeSystem = (system: VdropForm['system']) => {
    const known = Object.values(SYSTEM_VOLTAGE) as string[];
    const voltage = form.voltage.trim() === '' || known.includes(form.voltage) ? SYSTEM_VOLTAGE[system] : form.voltage;
    set({ system, voltage });
  };
  return (
    <>
      <SystemChips value={form.system} onChange={changeSystem} />
      {bind('voltage', form.system === 'ac3' ? t('field.voltageLine') : t('field.voltage'), { unit: 'V' })}
      <Chips
        label={t('calc.loadSource')}
        testIDPrefix="load"
        value={form.load}
        onChange={(load) => set({ load })}
        options={[
          { value: 'current', label: t('field.current') },
          { value: 'power', label: t('field.power') },
        ]}
      />
      {form.load === 'current' ? (
        bind('current', t('field.current'), { unit: 'A' })
      ) : (
        <>
          {bind('power', t('field.power'), { right: unitChips('power-unit', form.powerUnit, (powerUnit) => set({ powerUnit }), ['W', 'kW']) })}
          {bind('efficiency', t('field.efficiency'), { placeholder: '1' })}
        </>
      )}
      {!dc ? bind('cosPhi', t('field.cosPhi'), { placeholder: '1' }) : null}
      {bind('length', t('field.length'), { hint: t('calc.lengthOneWay'), right: unitChips('length-unit', form.lengthUnit, (lengthUnit) => set({ lengthUnit }), ['m', 'ft']) })}
      <MaterialChips value={form.material} onChange={(material) => set({ material })} />
      {bind('size', t('field.size'), {
        kind: awg ? 'text' : 'decimal',
        right: unitChips('size-unit', form.sizeUnit, (sizeUnit) => set({ sizeUnit, size: '' }), ['mm2', 'awg', 'kcmil'], SIZE_LABELS),
        hint: awg ? t('calc.awgHint') : undefined,
      })}
      {form.sizeUnit === 'mm2' ? <StandardSizes value={form.size} onPick={(size) => set({ size: conv === 'de' ? size.replace('.', ',') : size })} /> : null}
      {bind('parallel', t('field.parallel'), { placeholder: '1' })}

      <Chips
        label={t('field.limit')}
        testIDPrefix="limit"
        value={form.preset}
        onChange={(preset) => set({ preset })}
        options={[
          ...EU_DE.limitPresets.map((p) => ({ value: p.id, label: `${t(`limit.${p.id}` as MessageKey)} (${formatNumber(p.percent, '%', lang)})` })),
          { value: 'custom', label: t('limit.custom') },
        ]}
      />
      {form.preset === 'custom' ? bind('limit', t('field.limit'), { unit: '%' }) : null}

      <Options open={optionsOpen} onToggle={setOptionsOpen}>
        <Chips
          label={t('field.method')}
          testIDPrefix="method"
          value={form.method}
          onChange={(method) => set({ method })}
          options={(['M1', 'M2', 'M3'] as const).map((m) => ({ value: m, label: t(`method.${m}`) }))}
        />
        <Chips
          label={t('field.insulation')}
          testIDPrefix="insulation"
          value={form.insulation}
          onChange={(insulation) => set({ insulation })}
          options={[
            { value: 'pvc', label: t('insulation.pvc') },
            { value: 'xlpe', label: t('insulation.xlpe') },
          ]}
        />
        {bind('theta', t('field.conductorTemp'), { unit: '°C', kind: 'signed', hint: t('calc.thetaHint') })}
        {!dc ? bind('reactance', t('field.reactance'), { unit: 'mΩ/m', hint: t('calc.reactanceHint') }) : null}
        {bind('kappa', t('field.kappa'), { unit: 'm/(Ω·mm²)', hint: t('calc.kappaHint') })}
      </Options>
    </>
  );
}

// ------------------------------------------------------------------ current and power

function CurrentFields({ form, set, problems }: Props<'current'>) {
  const t = useT();
  const bind = useBind<CurrentForm>(form, set, problems);
  const changeSystem = (system: CurrentForm['system']) => {
    const known = Object.values(SYSTEM_VOLTAGE) as string[];
    set({ system, voltage: form.voltage.trim() === '' || known.includes(form.voltage) ? SYSTEM_VOLTAGE[system] : form.voltage });
  };
  return (
    <>
      <SystemChips value={form.system} onChange={changeSystem} />
      {bind('voltage', form.system === 'ac3' ? t('field.voltageLine') : t('field.voltage'), { unit: 'V' })}
      <Chips
        label={t('calc.loadSource')}
        testIDPrefix="load"
        value={form.load}
        onChange={(load) => set({ load })}
        options={[
          { value: 'power', label: t('field.power') },
          { value: 'current', label: t('field.current') },
        ]}
      />
      {form.load === 'current'
        ? bind('current', t('field.current'), { unit: 'A' })
        : bind('power', t('field.power'), { right: unitChips('power-unit', form.powerUnit, (powerUnit) => set({ powerUnit }), ['W', 'kW']) })}
      {form.system !== 'dc' ? bind('cosPhi', t('field.cosPhi'), { placeholder: '1' }) : null}
      {bind('efficiency', t('field.efficiency'), { placeholder: '1' })}
    </>
  );
}

function OhmFields({ form, set, problems }: Props<'ohm'>) {
  const t = useT();
  const bind = useBind<OhmForm>(form, set, problems);
  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        {t('calc.ohm.hint')}
      </ThemedText>
      {bind('voltage', t('field.voltage'), { unit: 'V' })}
      {bind('current', t('field.current'), { unit: 'A' })}
      {bind('resistance', t('field.resistance'), { unit: 'Ω' })}
      {bind('power', t('field.power'), { unit: 'W' })}
    </>
  );
}

// ------------------------------------------------------------------ device (shared by coordination and loop)

function DeviceFields({ device, onChange, problems, need }: { device: DeviceForm; onChange: (d: DeviceForm) => void; problems: Problems; need: 'coord' | 'loop' }) {
  const t = useT();
  const set = (patch: Partial<DeviceForm>) => onChange({ ...device, ...patch });
  const bind = useBind<DeviceForm>(device, set, problems);
  return (
    <>
      <Chips
        label={t('field.device')}
        testIDPrefix="device"
        value={device.type}
        onChange={(type) => set({ type })}
        options={[
          { value: 'mcb', label: t('device.mcb') },
          { value: 'other', label: t('device.other') },
        ]}
      />
      {device.type === 'mcb' ? (
        <>
          <Chips
            label={t('field.curve')}
            testIDPrefix="curve"
            value={device.curve}
            onChange={(curve) => set({ curve })}
            options={(['B', 'C', 'D'] as const).map((c) => ({ value: c, label: c }))}
          />
          <Chips
            label={t('field.ratedCurrent')}
            testIDPrefix="rating"
            value={device.rating}
            onChange={(rating) => set({ rating })}
            options={EU_DE.mcbRatingsA.map((r) => ({ value: String(r), label: `${r} A` }))}
          />
        </>
      ) : need === 'coord' ? (
        <>
          {bind('otherIn', t('field.ratedCurrent'), { unit: 'A' })}
          {bind('otherI2', t('field.i2'), { unit: 'A' })}
        </>
      ) : (
        bind('otherIa', t('field.ia'), { unit: 'A' })
      )}
    </>
  );
}

// ------------------------------------------------------------------ coordination

function CoordFields({ form, set, problems, optionsOpen, setOptionsOpen }: Props<'coord'>) {
  const t = useT();
  const db = useDb();
  const bind = useBind<CoordForm>(form, set, problems);
  const [tables, setTables] = useState<CableTableListItem[] | null>(null);
  const [picked, setPicked] = useState<{ table: CableTable; rows: CableRow[] } | null>(null);
  useEffect(() => {
    listCableTables(db).then(setTables).catch(() => undefined);
  }, [db]);
  const lang = useLanguage();
  const pickTable = async (id: number) => {
    const loaded = await getCableTable(db, id);
    if (loaded) setPicked(loaded);
  };
  return (
    <>
      {bind('ib', t('field.ib'), { unit: 'A' })}
      <DeviceFields device={form.device} onChange={(device) => set({ device })} problems={problems} need="coord" />

      <Chips
        label={t('field.iz')}
        testIDPrefix="iz"
        value={form.izSource}
        onChange={(izSource) => set({ izSource })}
        options={[
          { value: 'table', label: t('calc.tablePick') },
          { value: 'typed', label: t('calc.izTyped') },
        ]}
      />
      {form.izSource === 'table' ? (
        <View style={styles.group}>
          {form.table ? (
            <ThemedText testID="selected-row" type="smallBold">
              {`${form.table.tableName ?? ''} · ${formatNumber(form.table.sizeMm2 ?? 0, 'mm²', lang)} · Iz ${formatNumber(form.table.izA, 'A', lang)}`}
            </ThemedText>
          ) : (
            <ThemedText testID="no-row" type="small" themeColor="textSecondary">
              {tables && tables.length === 0 ? t('calc.tableEmpty') : t('calc.tableNone')}
            </ThemedText>
          )}
          {tables && tables.length > 0 ? (
            <Chips
              label={t('calc.myTables')}
              testIDPrefix="pick-table"
              value={picked ? String(picked.table.id) : null}
              onChange={(id) => pickTable(Number(id))}
              options={tables.map((x) => ({ value: String(x.id), label: x.name }))}
            />
          ) : null}
          {picked ? (
            <Chips
              label={t('calc.pickRow')}
              testIDPrefix="pick-row"
              value={form.table && form.table.tableName === picked.table.name ? String(form.table.sizeMm2) : null}
              onChange={(size) => {
                const row = picked.rows.find((r) => String(r.sizeMm2) === size);
                if (row) set({ table: userTableRow(picked.table, row) });
              }}
              options={picked.rows.map((r) => ({ value: String(r.sizeMm2), label: `${numText(r.sizeMm2, lang === 'de' ? 'de' : 'en')} mm² · ${numText(r.izA, lang === 'de' ? 'de' : 'en')} A` }))}
            />
          ) : null}
        </View>
      ) : (
        <>
          {bind('izTyped', t('field.iz'), { unit: 'A' })}
          {bind('insulationMaxC', t('field.insulationMax'), { unit: '°C', kind: 'signed' })}
          {bind('referenceAmbientC', t('field.referenceAmbient'), { unit: '°C', kind: 'signed' })}
        </>
      )}
      {bind('ambientC', t('field.ambient'), { unit: '°C', kind: 'signed', hint: t('calc.ambientHint') })}
      {bind('fGroup', t('field.fGroup'), { placeholder: '1' })}
      <Options open={optionsOpen} onToggle={setOptionsOpen}>
        {bind('fTheta', t('field.fTheta'), { hint: t('calc.fThetaHint') })}
        {bind('fOther', t('field.fOther'), { placeholder: '1' })}
      </Options>
    </>
  );
}

// ------------------------------------------------------------------ loop impedance

const FACTORS = [
  { id: 'twothirds', value: 2 / 3, label: '⅔' },
  { id: '0.8', value: 0.8, label: '0.8' },
  { id: '1', value: 1, label: '1.0' },
] as const;

function LoopFields({ form, set, problems, conv, optionsOpen, setOptionsOpen }: Props<'loop'>) {
  const t = useT();
  const bind = useBind<LoopForm>(form, set, problems);
  const awg = form.sizeUnit === 'awg';
  const factorNow = Number(form.measuredFactor.replace(',', '.'));
  const factorId = FACTORS.find((f) => Math.abs(f.value - factorNow) < 1e-6)?.id ?? null;
  return (
    <>
      <Chips
        label={t('field.mode')}
        testIDPrefix="mode"
        value={form.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { value: 'calculated', label: t('mode.calculated') },
          { value: 'measured', label: t('mode.measured') },
        ]}
      />
      {bind('u0', t('field.u0'), { unit: 'V' })}
      {form.mode === 'calculated' ? (
        <>
          {bind('ze', t('field.ze'), { unit: 'Ω' })}
          <MaterialChips value={form.material} onChange={(material) => set({ material })} />
          {bind('lineSize', t('field.lineSize'), {
            kind: awg ? 'text' : 'decimal',
            right: unitChips('size-unit', form.sizeUnit, (sizeUnit) => set({ sizeUnit, lineSize: '', peSize: '' }), ['mm2', 'awg', 'kcmil'], SIZE_LABELS),
            hint: awg ? t('calc.awgHint') : undefined,
          })}
          {form.sizeUnit === 'mm2' ? <StandardSizes prefix="line-chip" value={form.lineSize} onPick={(lineSize) => set({ lineSize: conv === 'de' ? lineSize.replace('.', ',') : lineSize })} /> : null}
          {bind('peSize', t('field.peSize'), { kind: awg ? 'text' : 'decimal' })}
          {form.sizeUnit === 'mm2' ? <StandardSizes prefix="pe-chip" value={form.peSize} onPick={(peSize) => set({ peSize: conv === 'de' ? peSize.replace('.', ',') : peSize })} /> : null}
          {bind('length', t('field.length'), { hint: t('calc.lengthOneWay'), right: unitChips('length-unit', form.lengthUnit, (lengthUnit) => set({ lengthUnit }), ['m', 'ft']) })}
        </>
      ) : (
        <>
          {bind('zsMeasured', t('field.zsMeasured'), { unit: 'Ω' })}
          <Chips
            label={t('field.measuredFactor')}
            testIDPrefix="kmeas"
            value={factorId}
            onChange={(id) => set({ measuredFactor: numText(FACTORS.find((f) => f.id === id)!.value, conv) })}
            options={FACTORS.map((f) => ({ value: f.id, label: f.label }))}
          />
        </>
      )}
      <DeviceFields device={form.device} onChange={(device) => set({ device })} problems={problems} need="loop" />
      <Options open={optionsOpen} onToggle={setOptionsOpen}>
        <Chips
          label={t('field.cmin')}
          testIDPrefix="cmin"
          value={Math.abs(Number(form.cmin.replace(',', '.')) - 0.95) < 1e-9 ? '0.95' : Math.abs(Number(form.cmin.replace(',', '.')) - 1) < 1e-9 ? '1' : null}
          onChange={(v) => set({ cmin: numText(Number(v), conv) })}
          options={[
            { value: '1', label: '1.0' },
            { value: '0.95', label: `0.95 ${t('calc.cminVoltage')}` },
          ]}
        />
        {form.mode === 'calculated' ? bind('loopTemp', t('field.loopTemp'), { unit: '°C', kind: 'signed' }) : null}
      </Options>
    </>
  );
}

// ------------------------------------------------------------------ resistance and conversions

function ResistanceFields({ form, set, problems, conv }: Props<'resistance'>) {
  const t = useT();
  const bind = useBind<ResistanceForm>(form, set, problems);
  const awg = form.sizeUnit === 'awg';
  return (
    <>
      <MaterialChips value={form.material} onChange={(material) => set({ material })} />
      {bind('size', t('field.size'), {
        kind: awg ? 'text' : 'decimal',
        right: unitChips('size-unit', form.sizeUnit, (sizeUnit) => set({ sizeUnit, size: '', peSize: '' }), ['mm2', 'awg', 'kcmil'], SIZE_LABELS),
        hint: awg ? t('calc.awgHint') : undefined,
      })}
      {form.sizeUnit === 'mm2' ? <StandardSizes value={form.size} onPick={(size) => set({ size: conv === 'de' ? size.replace('.', ',') : size })} /> : null}
      {bind('length', t('field.length'), { hint: t('calc.lengthOneWay'), right: unitChips('length-unit', form.lengthUnit, (lengthUnit) => set({ lengthUnit }), ['m', 'ft']) })}
      {bind('temperature', t('field.temperature'), { unit: '°C', kind: 'signed', placeholder: '70' })}
      {bind('parallel', t('field.parallel'), { placeholder: '1' })}
      {bind('peSize', t('field.peSize'), { kind: awg ? 'text' : 'decimal', hint: t('calc.peOptional') })}
    </>
  );
}

function ConvertFields({ form, set, problems }: Props<'convert'>) {
  const t = useT();
  const bind = useBind<ConvertForm>(form, set, problems);
  const units = { awg: 'AWG', mm2: 'mm²', kcmil: 'kcmil', ft: 'ft', m: 'm' } as const;
  return (
    <>
      <Chips
        label={t('field.from')}
        testIDPrefix="from"
        value={form.from}
        onChange={(from) => set({ from, value: '' })}
        options={(Object.keys(units) as (keyof typeof units)[]).map((u) => ({ value: u, label: units[u] }))}
      />
      {bind('value', t('field.value'), { unit: units[form.from], kind: form.from === 'awg' ? 'text' : 'decimal', hint: form.from === 'awg' ? t('calc.awgHint') : undefined })}
    </>
  );
}

// ------------------------------------------------------------------ dispatcher

export function CalcFields<K extends CalcKind>(props: { kind: K } & Props<K>) {
  const { kind, ...rest } = props;
  switch (kind) {
    case 'vdrop':
      return <VdropFields {...(rest as unknown as Props<'vdrop'>)} />;
    case 'current':
      return <CurrentFields {...(rest as unknown as Props<'current'>)} />;
    case 'ohm':
      return <OhmFields {...(rest as unknown as Props<'ohm'>)} />;
    case 'coord':
      return <CoordFields {...(rest as unknown as Props<'coord'>)} />;
    case 'loop':
      return <LoopFields {...(rest as unknown as Props<'loop'>)} />;
    case 'resistance':
      return <ResistanceFields {...(rest as unknown as Props<'resistance'>)} />;
    case 'convert':
      return <ConvertFields {...(rest as unknown as Props<'convert'>)} />;
  }
}

export { SectionTitle };

const styles = StyleSheet.create({
  group: { gap: Spacing.two },
});
