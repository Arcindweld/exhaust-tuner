#!/bin/bash
# Patches applied to the OpenFOAM v2412 source before the Windows (MinGW) build. Each one is small and says why.
#   bash patch_v2412_windows.sh /path/to/OpenFOAM-v2412
set -euo pipefail
OF=${1:?OpenFOAM source folder}
cd "$OF"

# 1. Scoped object names. On Windows OpenFOAM joins scoped names with '_' instead of ':' (IOobject.C:
#    "Windows: using ':' causes scoping conflicts with d:/path"), so the thermo fields are registered as
#    thermo_psi / thermo_mu. Eleven boundary conditions and models still default to the literal "thermo:psi" /
#    "thermo:mu" and fail with "failed lookup of thermo:psi" (seen with totalTemperature in rhoSimpleFoam on ESI's
#    Windows build). Use IOobject::scopedName, which gives ':' on Linux and '_' on Windows: no change on Linux.
files=$(grep -rl '"thermo:\(psi\|mu\)"' --include=*.C src applications || true)
for f in $files; do
  sed -i 's/"thermo:psi"/Foam::IOobject::scopedName("thermo", "psi")/g; s/"thermo:mu"/Foam::IOobject::scopedName("thermo", "mu")/g' "$f"
  echo "patched scoped name: $f"
done
test -z "$(grep -rl '"thermo:\(psi\|mu\)"' --include=*.C src applications || true)"

# 2. The cross compiler does not search /usr/include, where flex keeps FlexLexer.h (ESI's cross-compile notes).
if [ -f /usr/include/FlexLexer.h ] && [ ! -e src/OSspecific/MSwindows/FlexLexer.h ]; then
  cp /usr/include/FlexLexer.h src/OSspecific/MSwindows/
  echo "copied FlexLexer.h into src/OSspecific/MSwindows"
fi
