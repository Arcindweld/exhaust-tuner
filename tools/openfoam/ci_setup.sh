#!/bin/bash
# CI setup for the Windows OpenFOAM build (Ubuntu 24.04 runner): the MinGW-w64 cross compiler with POSIX threads
# (what ESI's own Windows packages use; they ship libwinpthread), zlib for Windows, flex, ccache; then the v2412
# source release, checked against its SHA-256, unpacked to $HOME/of and patched.
#   OF_URL=... OF_SHA256=... bash ci_setup.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
sudo apt-get update -q
sudo apt-get install -y -q --no-install-recommends \
  g++-mingw-w64-x86-64-posix gcc-mingw-w64-x86-64-posix binutils-mingw-w64-x86-64 mingw-w64-x86-64-dev \
  libz-mingw-w64-dev flex libfl-dev ccache zip
for t in gcc g++ cpp; do
  sudo update-alternatives --set "x86_64-w64-mingw32-$t" "/usr/bin/x86_64-w64-mingw32-$t-posix" 2>/dev/null || true
  command -v "x86_64-w64-mingw32-$t" > /dev/null || sudo ln -sf "/usr/bin/x86_64-w64-mingw32-$t-posix" "/usr/local/bin/x86_64-w64-mingw32-$t"
done
x86_64-w64-mingw32-g++ -v 2>&1 | grep -E "^(gcc version|Thread model)"
x86_64-w64-mingw32-g++ -v 2>&1 | grep -q "Thread model: posix"
test -f /usr/include/FlexLexer.h

T=${RUNNER_TEMP:-/tmp}
curl -sSL --retry 4 --retry-delay 10 -A "Wget/1.21" -o "$T/of.tgz" "${OF_URL:?}"
echo "${OF_SHA256:?}  $T/of.tgz" | sha256sum -c -
mkdir -p "$HOME/of"
tar -xzf "$T/of.tgz" -C "$HOME/of" --exclude='OpenFOAM-v2412/tutorials' --exclude='OpenFOAM-v2412/doc'
bash "$HERE/patch_v2412_windows.sh" "$HOME/of/OpenFOAM-v2412"
df -h "$HOME" | tail -1
