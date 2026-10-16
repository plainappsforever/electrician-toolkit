import type { ConfigContext, ExpoConfig } from 'expo/config';

// One codebase, three installable variants that can sit side by side on a device.
// Select with APP_VARIANT (set by scripts/native.sh and eas.json).
const VARIANTS = {
  development: { name: 'Electrician Toolkit Dev', id: 'com.tim.electrician.dev', scheme: 'electrician-dev' },
  preview: { name: 'Electrician Toolkit Preview', id: 'com.tim.electrician.preview', scheme: 'electrician-preview' },
  production: { name: 'Electrician Toolkit', id: 'com.tim.electrician', scheme: 'electrician' },
} as const;

type Variant = keyof typeof VARIANTS;

const variant = (process.env.APP_VARIANT ?? 'development') as Variant;
if (!(variant in VARIANTS)) {
  throw new Error(`Unknown APP_VARIANT "${variant}". Use development, preview or production.`);
}
const { name, id, scheme } = VARIANTS[variant];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name,
  slug: 'electrician-toolkit',
  // v1.1: versionName 1.1.0; Android versionCode and iOS build number follow MMmmpp (RELEASE_KIT §2) — every upload higher
  version: '1.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme,
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: id,
    buildNumber: '10100',
    icon: './assets/expo.icon',
    // v1.1 (RELEASE_KIT 1c item 6): the app has no encryption of its own and no network code, so App Store Connect does not ask
    // the export-compliance question at every upload (ITSAppUsesNonExemptEncryption = false)
    config: { usesNonExemptEncryption: false },
    // D82: the app's own privacy manifest (no tracking, no collected data) and the required-reason APIs the app and its modules use,
    // with app-level reasons. expo-file-system's privacy bundle was empty in the P7 simulator build, so its file-timestamp and
    // disk-space reasons are declared here too. "Generate Privacy Report" on the archive stays an owner/signing-time check.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyTrackingDomains: [],
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyAccessedAPITypes: [
        // C617.1: files inside the app container (database, backups, PDFs); 3B52.1: files the user picks (backup, table CSV, logo).
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1', '3B52.1'] },
        // E174.1: expo-file-system can check free space before the app writes a backup or a PDF.
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
        // 35F9.1: elapsed time inside the app (React Native timers, the restore time shown to the user).
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
        // CA92.1: React Native / Expo keep their own settings in the app's user defaults.
        { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
      ],
    },
  },
  android: {
    package: id,
    versionCode: 10100,
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    // D82: no Android Auto Backup. It would copy app.db (customer names, addresses, every saved calculation) to the user's
    // Google Drive without a word from this app, against "no cloud, no account"; the app has its own one-file backup (D74).
    allowBackup: false,
  },
  plugins: [
    // FIRST, so its mods run after the others: preview/production carry no dev-client keys, even from an earlier
    // development prebuild (prebuild runs without --clean, so nothing is ever removed from ios/android by hand).
    ...(variant === 'development' ? [] : (['./plugins/without-dev-client-residue.js'] as const)),
    // A no-clean prebuild never removes the URL scheme another variant's earlier prebuild wrote.
    ['./plugins/with-own-scheme-only.js', { own: scheme, all: Object.values(VARIANTS).map((v) => v.scheme) }],
    'expo-router',
    ['expo-splash-screen', { backgroundColor: '#1F232A', image: './assets/images/splash-icon.png', imageWidth: 76 }],
    'expo-sqlite',
    'expo-localization',
    // v1.1 (RELEASE_KIT 1c item 7): English and German declared to iOS (CFBundleLocalizations) and Android 13+ (localeConfig)
    ['./plugins/with-locale-config.js', { locales: ['en', 'de'] }],
    // Dev builds reopen the last Metro server directly, so Maestro can launch them unattended. Development only.
    ...(variant === 'development'
      ? [['expo-dev-client', { launchMode: 'most-recent' }] as [string, object], './plugins/with-dev-menu-defaults.js' as const]
      : []),
    // Release variants ship without android.permission.INTERNET (D12, A8); dev builds need it for Metro, and
    // with-dev-network undoes the marker an earlier preview prebuild left behind.
    variant === 'development' ? './plugins/with-dev-network.js' : './plugins/with-no-internet.js',
    // D81: the owner's upload key when the git-ignored keystore.properties exists, else the debug key (preview builds).
    './plugins/with-release-signing.js',
    // Xcode 27 / iOS 27 SDK: apps without the UIScene lifecycle trap at launch. SDK 57 opt-in (expo >= 57.0.23,
    // expo-build-properties >= 57.0.20); SDK 58+ has it by default, then remove this line. See docs/DECISIONS.md.
    ['expo-build-properties', { ios: { enableSceneSupport: true } }],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    appVariant: variant,
  },
});
