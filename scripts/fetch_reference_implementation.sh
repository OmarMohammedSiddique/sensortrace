#!/usr/bin/env bash
# Fetch the independent reference implementation used as a development-only test oracle.
# polimi-ispl/prnu-python, MIT licence. It is never imported by the product or redistributed.
set -euo pipefail
DEST="${1:-data/third_party/prnu-python}"
if [ ! -d "$DEST/.git" ]; then
  git clone --quiet https://github.com/polimi-ispl/prnu-python.git "$DEST"
fi
git -C "$DEST" checkout --quiet 91e1585a
echo "reference implementation at $DEST ($(git -C "$DEST" rev-parse --short HEAD))"
