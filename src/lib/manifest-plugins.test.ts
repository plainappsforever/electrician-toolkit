/** @jest-environment node */
// D81: the Android permission plugins. A release prebuild strips INTERNET, SYSTEM_ALERT_WINDOW and the two storage
// permissions; a development prebuild after it must put them back (prebuild runs without --clean, so the order of
// preview and development builds must not matter).
/* eslint-disable @typescript-eslint/no-require-imports */
const noInternet = require('../../plugins/with-no-internet.js');
const devNetwork = require('../../plugins/with-dev-network.js');
/* eslint-enable @typescript-eslint/no-require-imports */

type Perm = { $: Record<string, string> };
type Manifest = { $: Record<string, string>; 'uses-permission': Perm[] };
const names = (m: Manifest, removed: boolean) => m['uses-permission'].filter((p) => (p.$['tools:node'] === 'remove') === removed).map((p) => p.$['android:name']).sort();

const template = (): Manifest => ({
  $: { 'xmlns:android': 'x' },
  'uses-permission': [
    { $: { 'android:name': 'android.permission.READ_EXTERNAL_STORAGE', 'android:maxSdkVersion': '32', 'tools:replace': 'android:maxSdkVersion' } },
    { $: { 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW' } },
    { $: { 'android:name': 'android.permission.VIBRATE' } },
    { $: { 'android:name': 'android.permission.WRITE_EXTERNAL_STORAGE', 'android:maxSdkVersion': '32', 'tools:replace': 'android:maxSdkVersion' } },
  ],
});

describe('Android permission plugins', () => {
  it('a release manifest declares nothing of its own and removes the unused permissions, VIBRATE and ACCESS_NETWORK_STATE included (v1.1 F11)', () => {
    const m = template();
    noInternet.apply(m);
    expect(names(m, false)).toEqual([]);
    expect(names(m, true)).toEqual([...noInternet.REMOVED].sort());
    expect(noInternet.REMOVED).toEqual(expect.arrayContaining(['android.permission.VIBRATE', 'android.permission.ACCESS_NETWORK_STATE']));
  });

  it('a development prebuild after a release prebuild restores INTERNET, the overlay and the storage permissions (Android 12 and older only)', () => {
    const m = template();
    noInternet.apply(m);
    devNetwork.apply(m);
    expect(names(m, true)).toEqual([]);
    expect(names(m, false)).toEqual([...noInternet.REMOVED].sort());
    const storage = m['uses-permission'].find((p) => p.$['android:name'] === 'android.permission.READ_EXTERNAL_STORAGE');
    expect(storage?.$['android:maxSdkVersion']).toBe('32');
  });

  it('is idempotent in both directions', () => {
    const m = template();
    noInternet.apply(m);
    noInternet.apply(m);
    expect(m['uses-permission'].filter((p) => p.$['android:name'] === 'android.permission.INTERNET')).toHaveLength(1);
    devNetwork.apply(m);
    devNetwork.apply(m);
    expect(m['uses-permission'].filter((p) => p.$['android:name'] === 'android.permission.INTERNET')).toHaveLength(1);
  });
});

describe('locale declaration plugin (v1.1, RELEASE_KIT 1c item 7)', () => {
  /* eslint-disable-next-line @typescript-eslint/no-require-imports */
  const locales = require('../../plugins/with-locale-config.js');
  it('writes an Android locale-config with en and de', () => {
    const xml: string = locales.localesXml(['en', 'de']);
    expect(xml).toContain('<locale android:name="en"/>');
    expect(xml).toContain('<locale android:name="de"/>');
    expect(xml.startsWith('<?xml')).toBe(true);
  });
});
