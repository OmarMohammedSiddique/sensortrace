#!/usr/bin/env bash
# Download the VISION evaluation subset used by SensorTrace's validation.
#
# VISION dataset: Shullani et al., EURASIP J. Inf. Security 2017.
# (c) CSP Lab, University of Florence. Licensed CC BY-SA 4.0.
# The images are evaluation data only: they are never committed or redistributed.
#
# Usage: scripts/download_vision_subset.sh [DEST_DIR] [N_PER_CATEGORY]
set -euo pipefail
DEST="${1:-data/vision}"
N="${2:-40}"
BASE="https://lesc.dinfo.unifi.it/VISION"
# Calibration devices and test devices are disjoint (see VALIDATION.md).
DEVICES="D05 D14 D18 D02 D10 D03 D06 D15 D29 D34 D01 D26 D11"
mkdir -p "$DEST"
LIST="$DEST/VISION_files.txt"
[ -s "$LIST" ] || curl -fsS --retry 3 -o "$LIST" "$BASE/VISION_files.txt"
: > "$DEST/subset_urls.txt"
for d in $DEVICES; do
  for c in flat nat; do
    grep -E "/${d}_[^/]+/images/${c}/[^/]+\.jpg" "$LIST" | tr -d '\r' | sort | head -n "$N" >> "$DEST/subset_urls.txt"
  done
done
echo "$(wc -l < "$DEST/subset_urls.txt") files selected"
fetch() {
  url="$1"; dest="$2"
  rel="${url#*/dataset/}"            # D05_Apple_iPhone5c/images/flat/D05_I_flat_0001.jpg
  dev="${rel%%/*}"; cat="$(echo "$rel" | cut -d/ -f3)"; name="${rel##*/}"
  out="$dest/$dev/$cat/$name"
  [ -s "$out" ] && exit 0
  mkdir -p "$(dirname "$out")"
  curl -fsS --retry 4 --retry-delay 3 --max-time 180 -o "$out.part" "$url" && mv "$out.part" "$out" || { rm -f "$out.part"; echo "FAILED $url" >&2; }
}
export -f fetch
xargs -P 4 -I{} bash -c 'fetch "$1" "$2"' _ {} "$DEST" < "$DEST/subset_urls.txt"
echo "done: $(find "$DEST" -name '*.jpg' | wc -l) files, $(du -sh "$DEST" | cut -f1)"
