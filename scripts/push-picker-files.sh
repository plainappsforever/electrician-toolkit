#!/usr/bin/env bash
# Puts files where the REAL system file picker shows them, for the Release flows (Release builds have no dev links, so
# the picker must be driven: .maestro/release/backup-restore.yaml, v1.1 F13). Copies/overwrites, deletes nothing.
#   iOS simulator: Files → On My iPhone (the FileProvider.LocalStorage group container's "File Provider Storage")
#   Android emulator: /sdcard/Download (DocumentsUI → Downloads), then a media scan so it is listed
# Usage: scripts/push-picker-files.sh <ios|android> <file>...
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/env.sh
platform=${1:?Usage: push-picker-files.sh <ios|android> <file>...}
shift
device=$(scripts/boot.sh "$platform")
if [[ $platform == ios ]]; then
  base="$HOME/Library/Developer/CoreSimulator/Devices/$device/data/Containers/Shared/AppGroup"
  dest=""
  for g in "$base"/*; do
    id=$(plutil -extract MCMMetadataIdentifier raw "$g/.com.apple.mobile_container_manager.metadata.plist" 2>/dev/null || true)
    if [[ $id == *FileProvider.LocalStorage* ]]; then dest="$g/File Provider Storage"; break; fi
  done
  [[ -n $dest ]] || { echo "On My iPhone storage not found (open the Files app once on $device)" >&2; exit 1; }
  mkdir -p "$dest"
  for f in "$@"; do cp "$f" "$dest/"; done
else
  for f in "$@"; do
    adb -s "$device" push "$f" "/sdcard/Download/$(basename "$f")" >/dev/null
    adb -s "$device" shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d "file:///sdcard/Download/$(basename "$f")" >/dev/null 2>&1 || true
  done
fi
echo "placed $# file(s) for the $platform picker"
