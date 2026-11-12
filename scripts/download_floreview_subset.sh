#!/usr/bin/env bash
# Download the FloreView evaluation subset (smartphones from 2017-2021) used by the audit.
#
# FloreView dataset: Baracchi, Shullani, Iuliani, Piva, "FloreView: an image and video dataset
# for forensic analysis", IEEE Access 2023. (c) LESC, University of Florence. CC BY-SA 4.0.
# Evaluation data only: never committed or redistributed.
#
# Usage: scripts/download_floreview_subset.sh [DEST_DIR] [N_PER_CATEGORY]
set -euo pipefail
DEST="${1:-data/floreview}"
N="${2:-30}"
BASE="https://lesc.dinfo.unifi.it/FloreView"
# Two same-model pairs (Redmi Note 8T, Pixel 3a) and eight recent single devices.
DEVICES="D04 D10 D19 D23 D02 D14 D37 D25 D17 D34 D43 D30"
mkdir -p "$DEST"
LIST="$DEST/FloreView_Dataset.txt"
[ -s "$LIST" ] || curl -fsS --retry 3 -o "$LIST" "$BASE/FloreView_Dataset.txt"
: > "$DEST/subset_urls.txt"
for d in $DEVICES; do
  for c in Flat Nat; do
    grep -E "/Dataset/${d}_[^/]+/${c}/jpeg-h264/[^/]+\.jpg" "$LIST" | tr -d '\r' | sort | head -n "$N" >> "$DEST/subset_urls.txt"
  done
done
echo "$(wc -l < "$DEST/subset_urls.txt") files selected"
fetch() {
  url="$1"; dest="$2"
  rel="${url#*/Dataset/}"            # D04_Xiaomi_RedmiNote8T/Flat/jpeg-h264/D04_I001.jpg
  dev="${rel%%/*}"; cat="$(echo "$rel" | cut -d/ -f2)"; name="${rel##*/}"
  out="$dest/$dev/$cat/$name"
  [ -s "$out" ] && exit 0
  mkdir -p "$(dirname "$out")"
  curl -fsS --retry 4 --retry-delay 3 --max-time 240 -o "$out.part" "$url" && mv "$out.part" "$out" || { rm -f "$out.part"; echo "FAILED $url" >&2; }
}
export -f fetch
xargs -P 6 -I{} bash -c 'fetch "$1" "$2"' _ {} "$DEST" < "$DEST/subset_urls.txt"
echo "done: $(find "$DEST" -name '*.jpg' | wc -l) files, $(du -sh "$DEST" | cut -f1)"
