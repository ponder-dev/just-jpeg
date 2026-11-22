#!/usr/bin/env bash
#
# Builds build/icon.icns from the iconset that scripts/icons.cjs rendered.
#
# electron-builder can convert a single PNG to .icns on its own, but it
# flattened the alpha channel on the 16x16 and 32x32 entries, which turned the
# icon into a solid square in Finder's list view. Every other size was fine, so
# it only showed up at small non-retina sizes and only on someone else's
# machine. Handing macOS's own iconutil a finished iconset takes the guesswork
# out of it.
#
#   ./scripts/make-icns.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SET=build/icon.iconset
OUT=build/icon.icns

[ -d "$SET" ] || { echo "missing $SET, run: node scripts/make-icon.mjs && electron scripts/icons.cjs" >&2; exit 1; }

iconutil --convert icns "$SET" --output "$OUT"

echo "$OUT written"

# A mean alpha of exactly 1.0 means every pixel is opaque, which for a tile
# that has rounded corners can only mean the transparency was lost somewhere.
# It is the failure that is invisible until the icon is in a Finder list, so it
# is worth a line of output every build. ImageMagick is only used for this
# check, so skip it rather than fail if it is not installed.
if command -v magick >/dev/null 2>&1; then
  echo
  echo "  size                   alpha (1.0 would mean transparency was lost)"
  for f in "$SET"/*.png; do
    printf "  %-22s %s\n" "$(basename "$f")" "$(magick "$f" -alpha extract -format '%[fx:mean]' info:)"
  done
fi
