#!/usr/bin/env bash
# Rebuilds the editing toolkit in a fresh cloud container. Idempotent.
# Usage: bash montage/setup.sh            (work dir defaults to <repo>/work, gitignored)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${MONTAGE_WORK:-$ROOT/work}"
mkdir -p "$WORK/assets" "$WORK/fonts"

pip install -q opencv-python-headless "rembg[cpu]" fonttools brotli pillow numpy 2>&1 | grep -v WARNING || true

# rembg downloads its default model (bria-rmbg, ~1 GB) from GitHub releases on first use.

python3 "$ROOT/montage/tools/fonts.py" "$WORK/fonts"

# free test assets (raw.githubusercontent.com is reachable; most stock sites are not)
get() { [ -f "$WORK/assets/$1" ] || curl -sSL -o "$WORK/assets/$1" "$2"; }
get s9.jpg https://raw.githubusercontent.com/KwaiVGI/LivePortrait/main/assets/examples/source/s9.jpg   # Mona Lisa, public domain
[ -f "$WORK/assets/mona_fg.png" ] || python3 "$ROOT/montage/tools/cutout.py" "$WORK/assets/s9.jpg" "$WORK/assets/mona_fg.png"

echo "toolkit ready in $WORK"
