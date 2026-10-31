#!/bin/bash
# Cross-compiles the parts of OpenFOAM v2412 that Exhaust Tuner's CFD cases use, for 64-bit Windows, with
# MinGW-w64 on Linux (the route ESI uses for its own Windows builds), no MPI (serial runs: the dummy Pstream).
#   bash build_mingw.sh /path/to/OpenFOAM-v2412 [minutes] [full | objects:i/n]
# full (default): builds and links everything, in dependency order.
# objects:i/n   : only compiles part i of n of the source files (no linking). Several of these run side by side
#                 in CI and fill the compiler cache; the full build afterwards then mostly links.
# Re-runnable: wmake skips what is up to date and ccache (WM_SCHEDULER) serves objects compiled before.
OF=${1:?OpenFOAM source folder}
BUDGET=${2:-330}
MODE=${3:-full}
HERE=$(cd "$(dirname "$0")" && pwd)
START=$(date +%s)
left() { echo $(( BUDGET - ($(date +%s) - START) / 60 )); }

set +u
export WM_COMPILER=Mingw WM_MPLIB=dummy WM_LABEL_SIZE=32 WM_COMPILE_OPTION=Opt
. "$OF/etc/bashrc" WM_COMPILER=Mingw WM_MPLIB=dummy WM_LABEL_SIZE=32 || true
export WM_NCOMPPROCS=$(nproc)
export WM_SCHEDULER=ccache CCACHE_DIR=${CCACHE_DIR:-$HOME/.ccache} CCACHE_MAXSIZE=8G CCACHE_COMPRESS=1 \
       CCACHE_BASEDIR="$OF" CCACHE_NOHASHDIR=1
echo "WM_OPTIONS=$WM_OPTIONS FOAM_MPI=$FOAM_MPI procs=$WM_NCOMPPROCS mode=$MODE budget=${BUDGET}min"
echo "compiler: $(x86_64-w64-mingw32-g++ --version | head -1)  ccache: $(ccache --version | head -1)"
[ "$WM_OPTIONS" = linux64MingwDPInt32Opt ] || { echo "unexpected WM_OPTIONS"; exit 1; }
cd "$OF" || exit 1
mkdir -p logs

APPS="applications/utilities/mesh/generation/blockMesh
applications/utilities/mesh/generation/snappyHexMesh
applications/utilities/surface/surfaceFeatureExtract
applications/utilities/mesh/manipulation/checkMesh
applications/utilities/mesh/manipulation/topoSet
applications/utilities/miscellaneous/foamDictionary
applications/solvers/incompressible/simpleFoam
applications/solvers/compressible/rhoSimpleFoam"

step() {   # name, command...   logs to logs/<name>.log, stops the build when the time budget is spent
  local name=$1; shift
  if [ "$(left)" -le 5 ]; then echo "time budget spent before $name"; exit 3; fi
  local t0=$(date +%s)
  timeout "$(( $(left) - 3 ))m" "$@" > "logs/$name.log" 2>&1
  local rc=$?
  printf "%-64s rc=%s  %4ds  (%s min left)\n" "$name" "$rc" "$(( $(date +%s) - t0 ))" "$(left)"
  if [ $rc -ne 0 ]; then grep -E "error|Error" "logs/$name.log" | head -20; tail -15 "logs/$name.log"; return $rc; fi
}

# host tools (wmkdepend, lemon) for the Linux side of wmake, and the Windows ones
step wmake-tools bash -c 'cd wmake/src && ./Allmake' || exit 1

# lnInclude folders for every library first: some libraries include headers of libraries they do not link
for d in $(find src -type d -name Make -prune | sed 's,/Make$,,' | sort); do wmakeLnInclude -u "$d" > /dev/null 2>&1; done
src/OpenFOAM/Alltouch -check 2>/dev/null

fail=0
case "$MODE" in
objects:*)
  PART=${MODE#objects:}
  for d in $(python3 "$HERE/libs_for_apps.py" "$OF" --shard "$PART" $APPS); do
    step "objects_$(echo "$d" | tr / _)" wmake -j "$WM_NCOMPPROCS" objects "$d" || fail=$((fail+1))
  done
  ccache -s | head -14
  echo "failed steps: $fail"
  exit $fail
  ;;
esac

# OS layer, then the Pstream/OpenFOAM cyclic link exactly as src/Allwmake does for Mingw
step OSspecific bash -c "src/OSspecific/MSwindows/Allwmake" || exit 1
step Pstream-libo bash -c "cd src && WM_MPLIB=dummy Pstream/Allwmake libo" || exit 1
step OpenFOAM-pass1 bash -c "cd src && FOAM_LINK_DUMMY_PSTREAM=libo wmake -j $WM_NCOMPPROCS libso OpenFOAM" || exit 1
step Pstream bash -c "cd src && Pstream/Allwmake libso" || exit 1
src/OpenFOAM/Alltouch 2>/dev/null
step OpenFOAM bash -c "cd src && wmake -j $WM_NCOMPPROCS libso OpenFOAM" || exit 1

# the libraries the eight programs and the cases' function objects need, each after the ones it links to
ORDER=$(python3 "$HERE/libs_for_apps.py" "$OF" $APPS)
echo "$(echo "$ORDER" | wc -l) libraries to build"
for d in $ORDER; do
  step "$(echo "$d" | tr / _)" wmake -j "$WM_NCOMPPROCS" libso "$d" || fail=$((fail+1))
done
for a in $APPS; do
  step "$(basename "$a")" wmake -j "$WM_NCOMPPROCS" "$a" || fail=$((fail+1))
done
ccache -s | head -14
ls -la "platforms/$WM_OPTIONS/bin" 2>/dev/null
echo "failed steps: $fail"
exit $fail
