#!/usr/bin/env bash
# Copies what the development build kept in Documents/dev-out/ (PDFs of `debug/pdfprobe` and of the report buttons,
# report.json, the newest backup) from the simulator/emulator to a folder on the Mac, for scripts/verify-pdfs.mjs.
# Usage: scripts/pull-pdfs.sh <ios|android> <dest-dir>   (creates files, deletes nothing)
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
platform=${1:?Usage: pull-pdfs.sh <ios|android> <dest>}
dest=${2:?Usage: pull-pdfs.sh <ios|android> <dest>}
mkdir -p "$dest"
bundle=$(APP_VARIANT=development npx expo config --json --type public | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(process.argv[1]==="ios"?c.ios.bundleIdentifier:c.android.package)' "$platform")
device=$(scripts/boot.sh "$platform")
if [[ $platform == ios ]]; then
  cp "$(xcrun simctl get_app_container "$device" "$bundle" data)"/Documents/dev-out/* "$dest"/
else
  for f in $(adb -s "$device" shell run-as "$bundle" ls files/dev-out | tr -d '\r'); do
    adb -s "$device" exec-out run-as "$bundle" cat "files/dev-out/$f" >"$dest/$f"
  done
fi
echo "files copied: $(ls "$dest" | wc -l | tr -d ' ')"
