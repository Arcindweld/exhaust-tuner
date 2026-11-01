#!/bin/bash
# Regenerates the Linux reference runs in cfd/validation/reference/ with the current generator: the square-cut pipe
# (rhoSimpleFoam) and its incompressible twin (simpleFoam), medium mesh, each (a) run straight to the 6000-iteration
# cap the way validate_windows.ps1 runs it on Windows and (b) run with Allrun (stops when settled). Needed after every
# change of intake_cfd.py's VERSION: compare_results.py refuses a reference made by another generator version or
# with other numerics.
#   . <OpenFOAM v2412 environment>; bash make_references.sh [work dir]
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); CFD=$(dirname "$HERE")
WORK=${1:-$(mktemp -d)}; mkdir -p "$WORK"
export INTAKE_CFD_STAMP=probe
run6000() {  # name
  local c="$WORK/$1_6000"; rm -rf "$c"
  python3 "$CFD/intake_cfd.py" "$CFD/tests/$1.json" "$c" > /dev/null
  ( cd "$c"; s=$(sed -n 's/^application\s\+\(\S\+\);/\1/p' system/controlDict)
    for e in blockMesh checkMesh topoSet "$s"; do "$e" > "log.$e" 2>&1; done
    python3 intake_report.py > log.report 2>&1 )
  cp "$c/results.json" "$HERE/reference/$1_medium_linux_6000it_results.json"
}
runall() {  # name
  local c="$WORK/$1_allrun"; rm -rf "$c"
  python3 "$CFD/intake_cfd.py" "$CFD/tests/$1.json" "$c" > /dev/null
  ( cd "$c"; ./Allrun > allrun.out 2>&1 )
  cp "$c/results.json" "$HERE/reference/$1_medium_linux_results.json"
}
run6000 pp & a=$!; run6000 pp_inc & b=$!; wait $a; wait $b
runall pp & a=$!; runall pp_inc & b=$!; wait $a; wait $b
echo "references written to $HERE/reference (work files in $WORK)"
