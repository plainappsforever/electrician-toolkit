# Electrician Toolkit

Voltage drop, cable size, loop impedance - working shown. Offline, no ads.

Voltage drop, cable cross-section, protective-device and loop-impedance checks for electricians, with the working shown. Every result lists its formula, the numbers put into it, the assumptions used and where each rule comes from. Everything stays on your phone: no account, no ads, no tracking.

**Get it:** [App Store](https://plainapps.dfdsfdsfsdf.workers.dev/apps/electrician-toolkit/) · [Google Play](https://plainapps.dfdsfdsfsdf.workers.dev/apps/electrician-toolkit/) · [GitHub Releases](https://github.com/plainappsforever/electrician-toolkit/releases) ·
[Obtainium](https://apps.obtainium.imranr.dev/redirect?r=obtainium://add/https://github.com/plainappsforever/electrician-toolkit)

**Status:** first store release pending.

## Our promise

**Free, no ads, no tracking, no accounts.** This app keeps your data on your phone. It has no analytics, no crash
reporter, no advertising SDK and no sign-in. The Android release build has no INTERNET permission at all. We will not sell this app or this project to a company
that changes any of this.

Why we write it down: in 2023 a popular open-source Android suite was sold to an ad-funded app company and its store
listings started saying "Contains ads"; its community had to fork it to keep a clean version. The source code of
Electrician Toolkit is published under GPL-3.0, so if this promise were ever broken, anyone could continue the last
version that kept it.

## What it does

Bring your own cable tables
The current-carrying-capacity tables of the standards are copyrighted, so this app does not contain them. For the protective-device check you type or import the values from your own copy of the standard or from the cable datasheet once (a simple CSV file works), together with a note where they came from. The app then calculates with your values and prints that note with the result. Everything else is calculated from public formulas.

What it calculates
- Voltage drop and cross-section: DC, single-phase and three-phase, cables in mm² or AWG. Three methods side by side (constants of the installation standard's voltage-drop annex, conductor temperature, fixed conductivity), the smallest size by voltage drop alone (not a cable rating) and the longest length for the limit you select, and a warning when the methods disagree about the verdict.
- Current and power: DC, single-phase and three-phase, with power factor and efficiency; Ohm's law.
- Protective-device coordination: Ib, In and Iz checked for B, C and D breakers or for a device you describe, using your own cable table, the ambient temperature and the grouping factor you enter; when a check fails it suggests a preferred rating (overload protection only).
- Loop impedance and disconnection in TN systems: calculated from the cable or taken from your measurement, longest cable length, prospective fault current.
- Conductor resistance, and conversions between mm², AWG, kcmil, feet and metres.

Results that say what they are
The app compares numbers with the limit you select and says "exceeds" or "within". It does not tell you that an installation is allowed or correct. Longest lengths are rounded down and checked values are rounded up, so a displayed maximum is never above the true one. Constants and rules come from public sources; each is listed in the app with its source and is marked where it has not been checked against the standard itself.

Projects and reports
Save results into projects and circuits; a saved result never changes afterwards. Make a PDF report of one calculation or a whole project, with your company name, address and logo, in English or German, on A4 or Letter. Export all calculations as a spreadsheet file (CSV) and keep everything in one backup file that you can restore on another phone. The backup file is readable text and is not encrypted.

Your data
Projects, customer names, notes, tables and settings are stored on the phone only. Files leave the phone only when you share them; links to public sources open in your browser. The app has no internet permission. The phone's automatic app backup is switched off for this app; the backup file is the way to a new phone.

Languages
English and German, following your phone. Decimal comma and decimal point both work in every field.

Not in this version
- No built-in current-carrying-capacity or grouping tables (see "Bring your own cable tables").
- No US or UK rule sets, no TT or RCD checks, no short-circuit heating check, no conduit fill.
- No test certificates or measurement protocols.

Your responsibility
This is a calculation aid, not a design approval or a certificate. You are responsible for checking every result against the rules that apply to your installation, the manufacturer's data and the network operator's requirements. The standards' own texts are not included. This app is independent and is not affiliated with or endorsed by IEC, DIN, VDE or any other standards body.

## Privacy

- All data is stored locally (SQLite in the app's private storage). Nothing is uploaded.
- Files leave the phone only when you share or export them yourself.
- Privacy policy: https://plainapps.dfdsfdsfsdf.workers.dev/apps/electrician-toolkit/privacy

## Build from source

The app identifier `com.tim.electrician` is a placeholder: the identifier changes before the first store release.

You need: **Node.js 22 LTS** (the React Native version used here accepts `^20.19.4 || ^22.13.0 || ^24.3.0`), npm,
and git. The app is an [Expo](https://expo.dev) (SDK 57) / React Native app; the native `android/` and `ios/` folders
are generated from `app.config.ts` and are not in the repository.

```sh
git clone https://github.com/plainappsforever/electrician-toolkit.git
cd electrician-toolkit
npm ci
npm run verify          # typecheck + lint + all unit tests
```

### Android (Linux, macOS or Windows)

Needs JDK 17 and the Android SDK (Android Studio installs both; set `ANDROID_HOME`).

```sh
export APP_VARIANT=production
npx expo prebuild --platform android
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# APK: android/app/build/outputs/apk/release/ (signed with the debug key unless you configure your own key)
```

`APP_VARIANT` selects the app id and name (`development`, `preview`, `production`; see `app.config.ts`).
Builds made this way are signed with your key, not ours, so they cannot update an installed store version.

### iOS (macOS only)

Needs Xcode (26 or newer) and CocoaPods.

```sh
export APP_VARIANT=production
npx expo prebuild --platform ios
npx expo run:ios --configuration Release        # runs on the iOS Simulator
```

For a real iPhone, open `ios/*.xcworkspace` in Xcode, choose your own team under *Signing & Capabilities*
and change the bundle identifier. There is no sideloading store for iOS; the App Store build is ours.

## Verifying a release

Every GitHub release lists SHA-256 checksums (`SHA256SUMS.txt`) and the APKs are signed with one key per app.
Certificate SHA-256 fingerprint: `not yet published on Android`

## How this app was made

Electrician Toolkit was written with substantial help from an AI coding assistant (Claude Code), directed, reviewed and
tested by the maintainer. We say this openly because some stores and users care about it.

## Licence

Copyright (C) 2026 Farija Retkoceri

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, version 3 (GPL-3.0-only). See [LICENSE](LICENSE).
Third-party components keep their own licences (see `LICENSES/` and the app's licences screen where present).
Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
