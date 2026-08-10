#!/usr/bin/env bash
#
# Runs the command line on a real Linux box, in a container.
#
#   ./scripts/test-linux.sh            the published main branch
#   ./scripts/test-linux.sh --local    this working copy
#
# The CLI is headless, so a container is a genuine test: real kernel, real
# distro, real npm install. The GUI needs a desktop and is not tested here.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

docker info >/dev/null 2>&1 || { echo "docker is not running" >&2; exit 1; }

if [ "${1:-}" = "--local" ]; then
  MOUNT=(-v "$PWD:/src:ro")
  # Pack a tarball and install that. npm treats a plain folder install as a
  # symlink, which resolves dependencies from the folder instead of installing
  # them, and that is not what a real user's install does. A tarball is.
  INSTALL='cp -r /src /work && cd /work && npm pack --silent >/dev/null && npm install -g ./justjpeg-*.tgz --silent'
else
  MOUNT=()
  INSTALL='npm install -g github:ponder-dev/just-jpeg --silent'
fi

docker run --rm --platform linux/amd64 "${MOUNT[@]}" \
  -v "$PWD/test/fixtures:/fixtures:ro" node:22-bookworm bash -c "
  set -e
  $INSTALL >/dev/null 2>&1
  cd /tmp
  fail() { echo \"  FAIL: \$1\"; exit 1; }

  echo \"  justjpeg \$(justjpeg --version)\"
  justjpeg --help | grep -q 'No camera RAW here' || fail 'the RAW caveat is missing from --help'
  echo '  --help          ok, says what it does not do'

  cp /fixtures/withexif.heic .
  out=\$(justjpeg withexif.heic --json)
  echo \"\$out\" | grep -q '\"ok\":true' || fail \"convert said \$out\"
  echo \"\$out\" | grep -q '\"height\":1200' || fail 'not upright, orientation is broken on linux'
  echo '  heic            ok, upright, on a real linux kernel'

  head -c3 withexif.jpg | od -An -tx1 | tr -d ' \n' | grep -q ffd8ff || fail 'not a jpeg'
  grep -q Exif withexif.jpg || fail 'metadata lost'
  echo '  exif            survived'

  cat /fixtures/sample.heic | justjpeg > piped.jpg 2>/dev/null
  head -c2 piped.jpg | od -An -tx1 | tr -d ' \n' | grep -q ffd8 || fail 'pipe produced no jpeg'
  echo '  pipe            ok'

  cp /fixtures/sample.dng .
  justjpeg sample.dng 2>raw.log || fail 'raw refusal should not be a failing exit'
  grep -qi raw raw.log || fail 'no raw explanation'
  [ ! -f sample.jpg ] || fail 'raw wrote output, it must not'
  echo '  raw             refused politely'
"
echo "  linux: all good"
