#!/usr/bin/env bash
#
# Dresses the raw UI captures as app windows: traffic lights in the title bar
# area, rounded corners, and a soft shadow. Output goes to shots/framed/.
#
#   ./scripts/frame-shots.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

SRC=shots
OUT=shots/framed
RADIUS=26          # corner radius, in captured (2x) pixels
mkdir -p "$OUT"

for file in "$SRC"/*.png; do
  [ -f "$file" ] || continue
  name="$(basename "$file")"

  # The trailing newline matters: read exits non-zero without it, and
  # set -e would take the whole script down with it.
  read -r W H < <(magick identify -format "%w %h\n" "$file")

  # The app reserves 28 logical pixels at the top for the traffic lights,
  # which the OS draws rather than the page. Put them back.
  magick "$file" \
    -fill '#ff5f57' -draw "circle 40,28 40,35" \
    -fill '#febc2e' -draw "circle 80,28 80,35" \
    -fill '#28c840' -draw "circle 120,28 120,35" \
    "$OUT/.tmp-$name"

  # Round the corners.
  magick "$OUT/.tmp-$name" -alpha set \
    \( -size "${W}x${H}" xc:none -draw "roundrectangle 0,0,$((W-1)),$((H-1)),$RADIUS,$RADIUS" \) \
    -compose DstIn -composite "$OUT/.tmp2-$name"

  # Drop it on a dark mat with a shadow underneath.
  magick "$OUT/.tmp2-$name" \
    \( +clone -background black -shadow 55x24+0+14 \) \
    +swap -background none -layers merge +repage \
    -bordercolor none -border 30 \
    "$OUT/$name"

  rm -f "$OUT/.tmp-$name" "$OUT/.tmp2-$name"
  echo "  framed $name  ($(magick identify -format '%wx%h' "$OUT/$name"))"
done
