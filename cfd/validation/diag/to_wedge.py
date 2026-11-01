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
print("wedge sides:", case)
