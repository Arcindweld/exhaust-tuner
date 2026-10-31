#!/bin/bash
# Packs the Windows build into openfoam-v2412-win64.zip, laid out like OpenFOAM's own bin/tools/createMingwRuntime
# does it: the eight programs and every DLL they load (OpenFOAM's, the dummy Pstream, the MinGW runtime) together in
# bin/, where Windows finds a program's DLLs (and the libraries a case loads with "libs (...)") without PATH, plus
# etc/ (OpenFOAM reads its global controlDict and caseDicts from there through WM_PROJECT_DIR) and META-INFO/.
# Fails if any program or DLL needs a DLL that is neither in the package nor part of Windows.
#   bash package_mingw.sh /path/to/OpenFOAM-v2412 OUTDIR
set -euo pipefail
OF=${1:?}; OUT=$(mkdir -p "${2:?}" && cd "$2" && pwd)
P="$OF/platforms/linux64MingwDPInt32Opt"
STAGE=$(mktemp -d)/OpenFOAM-v2412
mkdir -p "$STAGE/bin"
for e in blockMesh snappyHexMesh surfaceFeatureExtract checkMesh topoSet foamDictionary simpleFoam rhoSimpleFoam; do
  cp "$P/bin/$e.exe" "$STAGE/bin/"
done
cp "$P"/lib/*.dll "$STAGE/bin/"
cp "$P"/lib/dummy/*.dll "$STAGE/bin/"            # serial Pstream and the dummy decomposition libraries: no MPI
cp -r "$OF/etc" "$OF/META-INFO" "$STAGE/"
cp "$OF/COPYING" "$STAGE/COPYING"
# MinGW runtime DLLs the libraries link to (the programs link libgcc and libstdc++ statically)
for f in libstdc++-6.dll libgcc_s_seh-1.dll; do
  src=$(find /usr/lib/gcc/x86_64-w64-mingw32 -name "$f" -path "*posix*" | sort | tail -1)
  [ -n "$src" ] && cp "$src" "$STAGE/bin/" && echo "runtime: $src"
done
for f in libwinpthread-1.dll zlib1.dll; do
  src=$(find /usr/x86_64-w64-mingw32 -name "$f" | head -1)
  [ -n "$src" ] && cp "$src" "$STAGE/bin/" && echo "runtime: $src"
done
# every import must be in the package or be a Windows system DLL
have=$(ls "$STAGE/bin" | tr 'A-Z' 'a-z')
missing=0
for f in "$STAGE"/bin/*.exe "$STAGE"/bin/*.dll; do
  for dll in $(x86_64-w64-mingw32-objdump -p "$f" | awk '/DLL Name:/ {print tolower($3)}'); do
    case "$dll" in
      kernel32.dll|msvcrt.dll|advapi32.dll|user32.dll|ws2_32.dll|shell32.dll|ole32.dll|psapi.dll|dbghelp.dll|bcrypt.dll|ntdll.dll|api-ms-win-*) ;;
      *) echo "$have" | grep -qx "$dll" || { echo "MISSING $dll (needed by $(basename "$f"))"; missing=1; } ;;
    esac
  done
done
[ $missing -eq 0 ] || exit 1
x86_64-w64-mingw32-objdump -p "$STAGE/bin/rhoSimpleFoam.exe" | awk '/DLL Name:/ {print "rhoSimpleFoam.exe imports", $3}'
(cd "$(dirname "$STAGE")" && zip -qr "$OUT/openfoam-v2412-win64.zip" OpenFOAM-v2412)
ls -la "$OUT"
du -sh "$STAGE" "$STAGE/bin"
ls "$STAGE/bin" | wc -l
