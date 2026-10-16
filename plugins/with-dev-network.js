// Development builds only: the inverse of with-no-internet.js. `expo prebuild` runs WITHOUT --clean (deletion rule), so
// the generated AndroidManifest.xml keeps what an earlier PREVIEW/PRODUCTION prebuild wrote, among it the
// `tools:node="remove"` markers for INTERNET (and, D81, SYSTEM_ALERT_WINDOW and the two storage permissions). A development
// build made after a preview build would then ship without INTERNET and could not reach Metro. This plugin removes the
// markers again and declares the permissions the dev client needs, so the order of preview and development builds never
// matters (pattern of meter-tracker D73).
const { withAndroidManifest } = require('expo/config-plugins');

const { REMOVED } = require('./with-no-internet.js');

function apply(manifest) {
  const kept = (manifest['uses-permission'] ?? []).filter((p) => !(REMOVED.includes(p.$['android:name']) && p.$['tools:node'] === 'remove'));
  for (const name of REMOVED) {
    if (kept.some((p) => p.$['android:name'] === name)) continue;
    // the template declares the two storage permissions for Android 12 and older only
    const storage = name.endsWith('_EXTERNAL_STORAGE');
    kept.push({ $: storage ? { 'android:name': name, 'android:maxSdkVersion': '32', 'tools:replace': 'android:maxSdkVersion' } : { 'android:name': name } });
  }
  manifest['uses-permission'] = kept;
}

module.exports = function withDevNetwork(config) {
  return withAndroidManifest(config, (mod) => {
    apply(mod.modResults.manifest);
    return mod;
  });
};
module.exports.apply = apply;
