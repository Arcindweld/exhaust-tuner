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

# 2. libOpenFOAM.dll takes the OS layer and (first pass) the dummy Pstream as partially linked objects
#    (libOSspecific.o / dummy/libPstream.o, made with "ld -r"). With Ubuntu 24.04's MinGW binutils that loses the
#    COMDAT association of the switch jump tables in .rdata, and the DLL link stops with "relocation truncated to
#    fit: IMAGE_REL_AMD64_REL32 against .text$_ZN4Foam5token5resetEv" (fileMonitor.C). Link the same objects from
#    static archives instead (built with wmake's 'lib' target), whole, so every member stays in the DLL.
opts=src/OpenFOAM/Make/options
if grep -q 'libOSspecific\.o' "$opts"; then
  sed -i 's|\$(FOAM_LIBBIN)/libOSspecific\.o|-Wl,--whole-archive $(FOAM_LIBBIN)/libOSspecific.a -Wl,--no-whole-archive|' "$opts"
  sed -i 's|LIB_LIBS += \$(FOAM_LIBBIN)/dummy/libPstream\.o|LIB_LIBS += -Wl,--whole-archive $(FOAM_LIBBIN)/dummy/libPstream.a -Wl,--no-whole-archive|' "$opts"
  echo "patched $opts: OS layer and first-pass Pstream from archives"
fi
grep -q 'libOSspecific\.a' "$opts" && grep -q 'dummy/libPstream\.a' "$opts"

# 3. The cross compiler does not search /usr/include, where flex keeps FlexLexer.h (ESI's cross-compile notes).
if [ -f /usr/include/FlexLexer.h ] && [ ! -e src/OSspecific/MSwindows/FlexLexer.h ]; then
  cp /usr/include/FlexLexer.h src/OSspecific/MSwindows/
  echo "copied FlexLexer.h into src/OSspecific/MSwindows"
fi
