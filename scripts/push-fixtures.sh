#!/usr/bin/env bash
# Copies the files the dev links/flows "pick" (src/dev/flags.ts) into the dev app's documents folder on the
# simulator/emulator: <documents>/dev-fixtures/*. Usage: scripts/push-fixtures.sh <ios|android>
# (development variant only; the app must have been installed once). Never deletes anything: files are overwritten in place.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
platform=${1:?Usage: push-fixtures.sh <ios|android>}
[[ -f test/fixtures/files/logo-big.png ]] || node scripts/fixtures/make-fixtures.mjs >/dev/null

files=()
for f in test/fixtures/files/*; do
  [[ -f $f ]] && files+=("$f")
done

device=$(scripts/boot.sh "$platform")
if [[ $platform == ios ]]; then
  bundle=$(APP_VARIANT=development npx expo config --json --type public | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).ios.bundleIdentifier)')
  dest="$(xcrun simctl get_app_container "$device" "$bundle" data)/Documents/dev-fixtures"
  mkdir -p "$dest"
  for f in "${files[@]}"; do cp "$f" "$dest/$(basename "$f")"; done
else
  bundle=$(APP_VARIANT=development npx expo config --json --type public | node -e 'console.log(JSON.parse(require("fs").readFileSync(0,"utf8")).android.package)')
  adb -s "$device" shell run-as "$bundle" mkdir -p files/dev-fixtures
  for f in "${files[@]}"; do
    adb -s "$device" exec-in run-as "$bundle" sh -c "cat > files/dev-fixtures/$(basename "$f")" <"$f"
  done
fi
echo "pushed ${#files[@]} fixtures to $platform ($device)"
