// Release variants only: removes android.permission.INTERNET from the Android manifest (D12) and the three permissions
// Expo's prebuild template declares by default that this app never uses (D81, A8: no dangerous/special permission):
// SYSTEM_ALERT_WINDOW ("draw over other apps", only the development menu needs it) and READ/WRITE_EXTERNAL_STORAGE
// (the system file picker and the share sheet need none), plus VIBRATE and ACCESS_NETWORK_STATE (v1.1 F11). Applied to preview and production only: development builds
// need them to reach Metro and show the dev menu (with-dev-network.js puts them back). Release JS is embedded and the
// app uses no network; links open in the browser, which is another app with its own permission.
// Two parts: drop what the prebuild template declares in the app manifest, and add a tools:node="remove" marker so a
// library manifest cannot bring it back during the manifest merge.
const { withAndroidManifest } = require('expo/config-plugins');

const REMOVED = [
  'android.permission.INTERNET',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  // v1.1 F11 (REVIEW_V1 #11): no haptics in the app (VIBRATE comes from Expo's template) and no network
  // (ACCESS_NETWORK_STATE comes from the unused expo-image library manifest; Play shows it as "view network connections")
  'android.permission.VIBRATE',
  'android.permission.ACCESS_NETWORK_STATE',
];

function apply(manifest) {
  manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
  const others = (manifest['uses-permission'] ?? []).filter((p) => !REMOVED.includes(p.$['android:name']));
  for (const name of REMOVED) others.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
  manifest['uses-permission'] = others;
}

module.exports = function withNoInternet(config) {
  return withAndroidManifest(config, (mod) => {
    apply(mod.modResults.manifest);
    return mod;
  });
};
module.exports.REMOVED = REMOVED;
module.exports.apply = apply;
