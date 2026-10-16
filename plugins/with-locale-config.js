// v1.1 (RELEASE_KIT 1c item 7): declares the app's UI languages to the system and the stores. iOS: CFBundleLocalizations
// (Info.plist); Android 13+: android:localeConfig → res/xml/locales_config.xml (per-app language list in the system
// settings). Written here instead of expo-localization's `supportedLocales` option because that one also APPENDS a
// `resourceConfigurations` line to app/build.gradle on every prebuild, and this project's prebuild runs without --clean.
// Idempotent: the plist key and the manifest attribute are set, the XML file is overwritten with the same content.
const fs = require('node:fs');
const path = require('node:path');
const { withAndroidManifest, withDangerousMod, withInfoPlist, AndroidConfig } = require('expo/config-plugins');

function localesXml(locales) {
  return ['<?xml version="1.0" encoding="utf-8"?>', '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">', ...locales.map((l) => `  <locale android:name="${l}"/>`), '</locale-config>', ''].join('\n');
}

module.exports = function withLocaleConfig(config, { locales }) {
  config = withInfoPlist(config, (mod) => {
    mod.modResults.CFBundleLocalizations = [...locales];
    return mod;
  });
  config = withAndroidManifest(config, (mod) => {
    AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults).$['android:localeConfig'] = '@xml/locales_config';
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const dir = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'locales_config.xml'), localesXml(locales));
      return mod;
    },
  ]);
};
module.exports.localesXml = localesXml;
