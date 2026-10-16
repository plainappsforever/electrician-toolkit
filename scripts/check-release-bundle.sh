#!/usr/bin/env bash
# D70/D81 proof: the dev-only modules (seeds, probes, PDF probe, flags) are not in a Release JS bundle.
# Usage: scripts/check-release-bundle.sh <bundle file> [more bundle files]   (Hermes bytecode or plain JS; grep -a)
# Sentinels = text that exists only in src/dev/*. Controls = text that must be present, so an empty or wrong file cannot pass.
set -euo pipefail
sentinels=("Development and test seed only" runDbProbes loadSeed "B.52.2" "Spannungsfall F3" "Schutz F3" "Familie Müller" "Musterstraße 1" "Schleife F3" "pdf-exp" pdfprobe "restore-timing" "dev-fixtures" "dev-out")
controls=("Calculation aid" "Spannungsfall")
bad=0
for f in "$@"; do
  echo "== $f ($(stat -f %z "$f") bytes)"
  for s in "${sentinels[@]}"; do
    n=$(grep -c -a -- "$s" "$f" || true)
    printf '  %-34s %s\n' "$s" "$n"
    [[ $n == 0 ]] || bad=1
  done
  for s in "${controls[@]}"; do
    n=$(grep -c -a -- "$s" "$f" || true)
    printf '  control %-26s %s\n' "$s" "$n"
    [[ $n != 0 ]] || bad=1
  done
done
[[ $bad == 0 ]] && echo "OK: no dev-only text in the bundle(s), controls present" || { echo "FAIL"; exit 1; }
