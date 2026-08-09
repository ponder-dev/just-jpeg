#!/usr/bin/env bash
#
# Builds build/icon.icns from build/icon.png.
#
# electron-builder can convert a PNG to .icns on its own, but it flattened the
# alpha channel on the 16x16 and 32x32 entries, which turned the icon into a
# solid square in Finder's list view. Every other size was fine, so it only
# showed up at small non-retina sizes.
#
# Building the iconset ourselves and handing macOS's own iconutil the finished
# article avoids the guesswork.
#
#   ./scripts/make-icns.sh

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SRC=build/icon.png
SET=build/icon.iconset
OUT=build/icon.icns

[ -f "$SRC" ] || { echo "missing $SRC, run: node scripts/make-icon.mjs && npx electron scripts/icons.cjs" >&2; exit 1; }

rm -rf "$SET"
mkdir -p "$SET"

# name:pixels. macOS wants both the 1x and 2x of each logical size.
for entry in \
  icon_16x16:16      icon_16x16@2x:32 \
  icon_32x32:32      icon_32x32@2x:64 \
  icon_128x128:128   icon_128x128@2x:256 \
  icon_256x256:256   icon_256x256@2x:512 \
  icon_512x512:512   icon_512x512@2x:1024
do
  name="${entry%%:*}"
  size="${entry##*:}"
  # PNG32 keeps a real alpha channel at every size, which is the whole point.
  magick "$SRC" -resize "${size}x${size}" -define png:color-type=6 "PNG32:$SET/$name.png"
done

iconutil --convert icns "$SET" --output "$OUT"

echo "$OUT written"
echo
echo "  size        alpha (1.0 would mean transparency was lost)"
for f in "$SET"/*.png; do
  printf "  %-22s %s\n" "$(basename "$f")" "$(magick "$f" -alpha extract -format '%[fx:mean]' info:)"
done
