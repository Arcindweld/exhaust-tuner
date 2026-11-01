#!/bin/bash
# Re-run every variant of a Windows diag round on Linux with the identical case files and meshes, so the two builds
# are compared on the same input (the case files come from the downloaded diag-variants artifact; carriage returns
# are stripped; variants marked REMESH are re-meshed on Linux exactly as windows_variants.ps1 does).
#   . <OpenFOAM v2412 environment>
#   bash linux_rerun.sh <diag-variants folder (holds var/)> <out folder>
#   python3 compare_variants.py <out folder> <diag-variants folder>/var
set -e
SRC=$1/var; OUT=$2
[ -d "$SRC" ] || { echo "no $SRC"; exit 1; }
mkdir -p "$OUT"
for d in "$SRC"/*/; do
  v=$(basename "$d"); c="$OUT/$v"; rm -rf "$c"; mkdir -p "$c"
  cp -r "$d/0" "$d/constant" "$d/system" "$c/"
  find "$c" -type f -exec sed -i 's/\r$//' {} +
  if [ -f "$d/REMESH" ]; then (cd "$c" && blockMesh > log.blockMesh 2>&1 && topoSet > log.topoSet 2>&1); fi
  (cd "$c" && simpleFoam > log.simpleFoam 2>&1) || echo "$v: simpleFoam exit $?"
  echo "$v done"
done
