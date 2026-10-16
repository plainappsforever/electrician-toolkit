#!/usr/bin/env bash
# Android App Bundle (.aab) for Google Play (D81; RELEASE_KIT 1c items 3 and 16). Local and free; uploads nothing.
# Usage: scripts/bundle-release.sh [preview|production]   (default production)
#   - prebuild (no --clean) when the variant or the config changed, exactly like scripts/native.sh
#   - ./gradlew bundleRelease for arm64-v8a, armeabi-v7a, x86_64 (RELEASE_KIT D14: no 32-bit x86)
#   - signed with the owner's upload key when keystore.properties exists (plugins/with-release-signing.js), otherwise
#     with the DEBUG key: such a bundle is for size checks only and Play refuses it
#   - copies the bundle to artifacts/builds/Electrician-v<version>-<variant>.aab and prints the per-ABI native code sizes
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh

variant=${1:-production}
[[ $variant == preview || $variant == production ]] || { echo "variant must be preview or production"; exit 2; }
export APP_VARIANT=$variant

shopt -s nullglob
marker="android/.generated-for"
stamp="$variant $(cat app.config.ts package.json package-lock.json plugins/*.js | shasum | cut -c1-12)" # same stamp as native.sh: no second prebuild
if [[ ! -f $marker || "$(cat "$marker")" != "$stamp" ]]; then
  # shellcheck disable=SC2086
  SDKROOT="$(xcrun --sdk macosx --show-sdk-path)" npx expo prebuild ${PREBUILD_FLAGS:---no-clean} --platform android
  echo "$stamp" >"$marker"
  # stale autolinking.json after a variant switch (see scripts/native.sh, v1.1): force its regeneration, delete nothing
  [[ -f android/build/generated/autolinking/package.json.sha ]] && echo "variant-changed $variant" >android/build/generated/autolinking/package.json.sha
fi

[[ -f keystore.properties ]] || echo "NOTE: keystore.properties not found - this bundle is signed with the DEBUG key (size check only, not uploadable)."

(cd android && ./gradlew bundleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64 --console=plain 2>&1 | grep -E "BUILD|FAILURE|error:|What went wrong" || true)
aab=android/app/build/outputs/bundle/release/app-release.aab
[[ -f $aab ]] || { echo "no bundle at $aab"; exit 1; }

version=$(node -p "require('./package.json').version")
mkdir -p artifacts/builds
out="artifacts/builds/Electrician-v${version}-${variant}.aab"
cp "$aab" "$out"
echo "bundle: $out ($(stat -f %z "$out") bytes)"
# Per-ABI native libraries inside the bundle (compressed / uncompressed bytes). A phone downloads one ABI plus dex and
# resources; `bundletool get-size total` gives Play's exact estimate (bundletool is not installed here).
unzip -v "$out" | awk '/ base\/lib\// { split($8, p, "/"); abi = p[3]; c[abi] += $3; u[abi] += $1 }
  / base\/dex\// { dc += $3; du += $1 }
  END { for (a in c) printf "  lib %-12s %10d compressed  %10d uncompressed\n", a, c[a], u[a]; printf "  dex          %10d compressed  %10d uncompressed\n", dc, du }'
