"""Turn a generated 2-D case (sector with a rotational cyclic pair for sides) back into the old wedge-patch case, in
place, before blockMesh: for comparing OpenFOAM builds on the wedge setup.
    python3 to_wedge.py <case dir>"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_variants import edit, sides  # noqa: E402

case = sys.argv[1]
edit(os.path.join(case, "system", "blockMeshDict"), sides("        type wedge;\n"))
for f in sorted(os.listdir(os.path.join(case, "0"))):
    p = os.path.join(case, "0", f)
    t = open(p).read()
    if "type cyclic;" in t:
        open(p, "w", newline="\n").write(t.replace("type cyclic;", "type wedge;"))
# the case's numerics record must say so, or compare_results.py would take it for the generator's cyclic case
import json  # noqa: E402
ci = os.path.join(case, "case_info.json")
info = json.load(open(ci))
info["numerics"]["mesh"] = "2-D sector, wedge sides (diag/to_wedge.py)"
open(ci, "w", newline="\n").write(json.dumps(info, indent=2))
print("wedge sides:", case)
