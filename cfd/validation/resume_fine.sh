#!/bin/bash
# Resume the two interrupted fine runs from their latest written time step.
# Trims postProcessing rows past the restart time so the concatenated series stay monotonic.
cd "$(dirname "$0")"
source ../foamenv.sh
for d in runs/PP-46-23-23-0_m2_fine runs/RAD-46-23-35-6_m2_fine; do
  (
    cd $d
    T=$(ls -d [1-9]* 2>/dev/null | sort -n | tail -1)
    echo "$d: resuming from time $T"
    python3 - "$T" <<'PY'
import glob, sys, os
T = float(sys.argv[1])
for fn in glob.glob("postProcessing/*/0/*.dat"):
    out = []
    for ln in open(fn):
        if ln.startswith("#"):
            out.append(ln); continue
        p = ln.split()
        try:
            if p and float(p[0]) > T: continue
        except ValueError:
            pass
        out.append(ln)
    open(fn, "w").write("".join(out))
PY
    sed -i 's/stopAt          writeNow;/stopAt          endTime;/' system/controlDict
    ./Allrun >> allrun.out 2>&1
    echo "$d: Allrun exit $?"
  ) &
done
wait
echo ALL DONE
