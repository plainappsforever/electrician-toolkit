// Settings (SPEC §9): appearance, language, length unit, calculation defaults (method, limit, temperatures, Cmin,
// measured factor), profile, company header, paper. Chips save at once; a typed value is saved when it is valid (the
// same validators as the backup, src/db/settings.ts) and shows an error otherwise.
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { Image } from 'react-native';

import { Button } from '@/components/button';
import { Chips, Screen, SectionTitle, TextField } from '@/components/form';
import { Notice, type NoticeData } from '@/components/notice';
import { ThemedText } from '@/components/themed-text';
import {
  clearSetting,
  getAppSettings,
  MAX_LOGO_BYTES,
  saveSetting,
  settingProblem,
  setLanguagePreference,
  setThemePreference,
  type AppSettings,
  type SettingKey,
} from '@/db/settings';
import { useConvention } from '@/hooks/use-convention';
import { useDb } from '@/hooks/use-db';
import { useT } from '@/hooks/use-t';
import { EU_DE, ENGINE_VERSION } from '@/engine';
import { parseNumber, type ParseConvention } from '@/engine/parse';
import { applyLanguagePreference, type LanguagePreference, type MessageKey } from '@/i18n';
import { numText } from '@/lib/calc-form';
import { pickFile } from '@/lib/files';
import { logoFromBase64 } from '@/lib/logo';
import { applyThemePreference } from '@/lib/theme-preference';

type NumericKey = 'vdropLimitPercent' | 'conductorTempC' | 'reactanceMohmPerM' | 'loopTempC' | 'cmin' | 'measuredFactor';

function NumberSetting({ settings, name, label, unit, conv, onSaved, signed }: { settings: AppSettings; name: NumericKey; label: string; unit?: string; conv: ParseConvention; onSaved: () => void; signed?: boolean }) {
  const t = useT();
  const db = useDb();
  const [text, setText] = useState(numText(settings[name], conv));
  const [error, setError] = useState<string | null>(null);
  async function change(v: string) {
    setText(v);
    const parsed = parseNumber(v, conv, { allowNegative: signed });
    if (!parsed.ok || settingProblem(name, String(parsed.value)) !== null) return setError(t('settings.invalidValue'));
    setError(null);
    await saveSetting(db, name, String(parsed.value));
    onSaved();
  }
  return <TextField label={label} testID={`setting-${name}`} unit={unit} kind={signed ? 'signed' : 'decimal'} value={text} onChangeText={change} error={error} />;
}

function TextSetting({ settings, name, label, multiline }: { settings: AppSettings; name: 'company.name' | 'company.address' | 'company.phone' | 'company.email' | 'company.regNo'; label: string; multiline?: boolean }) {
  const db = useDb();
  const [text, setText] = useState(settings.company[name.slice(8) as keyof AppSettings['company']]);
  return (
    <TextField
      kind="text"
      label={label}
      testID={`setting-${name}`}
      multiline={multiline}
      value={text}
      onChangeText={async (v) => {
        setText(v);
        if (settingProblem(name, v) === null) await saveSetting(db, name as SettingKey, v);
      }}
    />
  );
}

export default function SettingsScreen() {
  const db = useDb();
  const t = useT();
  const conv = useConvention();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logoNote, setLogoNote] = useState<NoticeData | null>(null);
  const reload = () => void getAppSettings(db).then(setSettings);
  useEffect(reload, [db]);

  if (!settings) return <Screen testID="settings-screen">{null}</Screen>;
  const save = async (key: SettingKey, value: string) => {
    await saveSetting(db, key, value);
    reload();
  };

  async function chooseLogo() {
    setLogoNote(null);
    try {
      const picked = await pickFile(['image/png', 'image/jpeg']);
      if (picked.canceled) return;
      // size first: a huge file is never read; the type comes from the bytes
      const tooBig = picked.file.size > MAX_LOGO_BYTES;
      const logo = logoFromBase64(picked.file.size, tooBig ? '' : await picked.file.base64());
      if (!logo.ok) return setLogoNote({ kind: 'error', testID: 'logo-error', text: t(logo.reason === 'tooBig' ? 'settings.logo.tooBig' : 'settings.logo.notImage') });
      await saveSetting(db, 'logoDataUri', logo.dataUri);
      reload();
    } catch (e) {
      setLogoNote({ kind: 'error', testID: 'logo-error', text: t('settings.logo.failed', { reason: e instanceof Error ? e.message : String(e) }) });
    }
  }

  return (
    <Screen testID="settings-screen">
      <SectionTitle>{t('settings.appearance')}</SectionTitle>
      <Chips
        testIDPrefix="theme"
        value={settings.theme}
        onChange={async (theme) => {
          applyThemePreference(theme);
          await setThemePreference(db, theme);
          reload();
        }}
        options={[
          { value: 'system', label: t('settings.theme.system') },
          { value: 'light', label: t('settings.theme.light') },
          { value: 'dark', label: t('settings.theme.dark') },
        ]}
      />

      <SectionTitle>{t('settings.language')}</SectionTitle>
      <Chips
        testIDPrefix="language"
        value={settings.language}
        onChange={async (language: LanguagePreference) => {
          applyLanguagePreference(language);
          await setLanguagePreference(db, language);
          reload();
        }}
        options={[
          { value: 'system', label: t('settings.language.system') },
          { value: 'en', label: t('settings.language.en') },
          { value: 'de', label: t('settings.language.de') },
        ]}
      />

      <SectionTitle>{t('settings.units')}</SectionTitle>
      <Chips
        label={t('settings.lengthUnit')}
        testIDPrefix="unit"
        value={settings.lengthUnit}
        onChange={(v) => save('lengthUnit', v)}
        options={[
          { value: 'm', label: t('settings.unit.m') },
          { value: 'ft', label: t('settings.unit.ft') },
        ]}
      />

      <SectionTitle>{t('settings.profile')}</SectionTitle>
      <ThemedText testID="profile-name">{t('settings.profile.eu')}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.profile.note', { profile: EU_DE.version, engine: ENGINE_VERSION })}
      </ThemedText>

      <SectionTitle>{t('settings.defaults')}</SectionTitle>
      <Chips
        label={t('field.method')}
        testIDPrefix="default-method"
        value={settings.vdropMethod}
        onChange={(v) => save('vdropMethod', v)}
        options={(['M1', 'M2', 'M3'] as const).map((m) => ({ value: m, label: t(`method.${m}`) }))}
      />
      <Chips
        label={t('field.limit')}
        testIDPrefix="default-limit"
        value={settings.vdropLimitPreset}
        onChange={(v) => save('vdropLimitPreset', v)}
        options={[...EU_DE.limitPresets.map((p) => ({ value: p.id, label: t(`limit.${p.id}` as MessageKey) })), { value: 'custom', label: t('limit.custom') }]}
      />
      {settings.vdropLimitPreset === 'custom' ? <NumberSetting settings={settings} name="vdropLimitPercent" label={t('field.limit')} unit="%" conv={conv} onSaved={reload} /> : null}
      <NumberSetting settings={settings} name="conductorTempC" label={t('field.conductorTemp')} unit="°C" signed conv={conv} onSaved={reload} />
      <NumberSetting settings={settings} name="reactanceMohmPerM" label={t('field.reactance')} unit="mΩ/m" conv={conv} onSaved={reload} />
      <NumberSetting settings={settings} name="loopTempC" label={t('field.loopTemp')} unit="°C" signed conv={conv} onSaved={reload} />
      <NumberSetting settings={settings} name="cmin" label={t('field.cmin')} conv={conv} onSaved={reload} />
      <NumberSetting settings={settings} name="measuredFactor" label={t('field.measuredFactor')} conv={conv} onSaved={reload} />

      <SectionTitle>{t('settings.company')}</SectionTitle>
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.company.note')}
      </ThemedText>
      <TextSetting settings={settings} name="company.name" label={t('settings.company.name')} />
      <TextSetting settings={settings} name="company.address" label={t('settings.company.address')} multiline />
      <TextSetting settings={settings} name="company.phone" label={t('settings.company.phone')} />
      <TextSetting settings={settings} name="company.email" label={t('settings.company.email')} />
      <TextSetting settings={settings} name="company.regNo" label={t('settings.company.regNo')} />

      <SectionTitle>{t('settings.logo')}</SectionTitle>
      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.logo.note')}
      </ThemedText>
      {settings.logoDataUri ? (
        <>
          <Image testID="logo-preview" source={{ uri: settings.logoDataUri }} style={{ height: 56, width: 160 }} resizeMode="contain" accessibilityLabel={t('settings.logo.set')} />
          <ThemedText testID="logo-set" type="small" themeColor="textSecondary">
            {t('settings.logo.set')}
          </ThemedText>
        </>
      ) : null}
      <Button testID="logo-choose" variant="secondary" label={t(settings.logoDataUri ? 'settings.logo.replace' : 'settings.logo.choose')} onPress={chooseLogo} />
      {settings.logoDataUri ? (
        <Button
          testID="logo-remove"
          variant="secondary"
          label={t('settings.logo.remove')}
          onPress={async () => {
            await clearSetting(db, 'logoDataUri');
            setLogoNote(null);
            reload();
          }}
        />
      ) : null}
      <Notice note={logoNote} />

      <SectionTitle>{t('settings.paper')}</SectionTitle>
      <Chips testIDPrefix="paper" value={settings.paper} onChange={(v) => save('paper', v)} options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }]} />

      <ThemedText type="small" themeColor="textSecondary">
        {t('settings.version', { version: Constants.expoConfig?.version ?? '', variant: String(Constants.expoConfig?.extra?.appVariant) })}
      </ThemedText>
    </Screen>
  );
}
