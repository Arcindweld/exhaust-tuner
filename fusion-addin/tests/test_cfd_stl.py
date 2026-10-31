"""The CFD STL writer of the add-in (cadtools.stl_ascii) without Fusion: a stub adsk module, then a capped tube
written as inlet / outlet / wall and read back by the case generator's own STL reader (cfd/intake_cfd.py)."""
import math
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(HERE, "..", "..", "cfd"))
adsk = types.ModuleType("adsk")
adsk.core = types.ModuleType("adsk.core")
adsk.fusion = types.ModuleType("adsk.fusion")
for n in ("HTMLEventHandler", "CommandCreatedEventHandler", "CommandEventHandler", "ApplicationEventHandler"):
    setattr(adsk.core, n, object)
sys.modules.update({"adsk": adsk, "adsk.core": adsk.core, "adsk.fusion": adsk.fusion})
import cadtools        # noqa: E402
import intake_cfd      # noqa: E402


def tube(r, L, n=24):
    """A closed tube along x in cm: (inlet disc at x=0, outlet disc at x=L, wall), outward normals."""
    ring = lambda x: [(x, r * math.cos(2 * math.pi * k / n), r * math.sin(2 * math.pi * k / n)) for k in range(n)]
    a, b = ring(0.0), ring(L)
    wall = []
    for k in range(n):
        k2 = (k + 1) % n
        wall += [(a[k], b[k2], b[k]), (a[k], a[k2], b[k2])]
    inlet = [((0.0, 0.0, 0.0), a[k2], a[k]) for k, k2 in ((k, (k + 1) % n) for k in range(n))]
    outlet = [((L, 0.0, 0.0), b[k], b[k2]) for k, k2 in ((k, (k + 1) % n) for k in range(n))]
    return inlet, outlet, wall


def main():
    fails = 0
    inlet, outlet, wall = tube(2.5, 30.0)              # 50 mm x 300 mm, in cm like Fusion
    degenerate = [((0, 0, 0), (0, 0, 0), (1, 0, 0))]
    text, n = cadtools.stl_ascii([("inlet", inlet), ("outlet", outlet), ("wall", wall + degenerate)])
    ok = n == len(inlet) + len(outlet) + len(wall)
    print(("PASS" if ok else "FAIL") + " %d triangles written, the zero-area one left out" % n); fails += not ok
    path = os.path.join(HERE, "_cfd_stl_test.stl")
    with open(path, "w") as f:
        f.write(text)
    regions = intake_cfd.read_stl(path, 0.001)          # the generator reads it (mm -> m)
    names = [nm for nm, _ in regions]
    ok = names == ["inlet", "outlet", "wall"]
    print(("PASS" if ok else "FAIL") + " regions read back by intake_cfd.read_stl: %s" % names); fails += not ok
    xs = [p[0] for nm, tris in regions if nm == "outlet" for t in tris for p in t]
    ok = all(abs(x - 0.300) < 1e-9 for x in xs)
    print(("PASS" if ok else "FAIL") + " millimetres: outlet plane at x = %.6f m" % xs[0]); fails += not ok
    # outward normals on the wall: the normal points away from the axis
    bad = 0
    for line_i, line in enumerate(text.splitlines()):
        pass
    blocks = text.split("solid wall")[1]
    for chunk in blocks.split("facet normal ")[1:]:
        nrm = [float(v) for v in chunk.split("\n")[0].split()]
        vs = [[float(v) for v in ln.split()[1:]] for ln in chunk.split("\n") if ln.strip().startswith("vertex")]
        cy = sum(v[1] for v in vs) / 3; cz = sum(v[2] for v in vs) / 3
        if nrm[1] * cy + nrm[2] * cz <= 0:
            bad += 1
    ok = bad == 0
    print(("PASS" if ok else "FAIL") + " wall normals point outward (%d wrong)" % bad); fails += not ok
    os.remove(path)
    print("all passed" if not fails else "FAILS %d" % fails)
    return fails


if __name__ == "__main__":
    sys.exit(main())
