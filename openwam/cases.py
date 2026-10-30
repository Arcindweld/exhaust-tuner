#!/usr/bin/env python3
"""cases.py - the specs used for validation and for the Python/JS identity test.

All specs use the calculator's simSpec() structure (SI units). i4_41 and i4_single_cyl come straight
from the calculator (calc_spec.js writes specs/*.json); the others are built here from the i4_41 spec.
"""
import copy
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    with open(os.path.join(HERE, "specs", name + ".json")) as f:
        return json.load(f)


def i4_41():
    return load("i4_41")


def i4_single_cyl():
    return load("i4_single_cyl")


def i4_triy():
    """Tri-Y 4-2-1 on the same engine: cylinders that fire 360 deg apart are paired (phase indices 0+2
    and 1+3 of phases [0, 180, 360, 540]). Primary = the 4-1's port + primary; each secondary starts at
    the pair's combined area (44.5*sqrt2 = 62.9 mm), cones to 57 mm over 60 mm and runs 340 mm straight;
    the final junction feeds a cone from the pair's combined area (57*sqrt2) down to the 4-1's 79.6 mm
    collector, then the 4-1's collector straight and megaphone."""
    s = i4_41()
    col = s["opt"].pop("collector")
    dsec = 0.057
    d4 = col["segs"][1]["d0"]
    s["opt"]["collectors"] = [{
        "cyls": [0, 1, 2, 3],
        "stages": [{"groups": [[0, 2], [1, 3]], "Tw": 675,
                    "segs": [{"L": 0.06, "d0": 0.0445 * math.sqrt(2.0), "d1": dsec}, {"L": 0.34, "d0": dsec, "d1": dsec}]}],
        "segs": [{"L": 0.08, "d0": dsec * math.sqrt(2.0), "d1": d4}] + col["segs"][1:],
        "Tw": col["Tw"]}]
    return s


def i4_41_stepped():
    """The 4-1 with a stepped primary: the last 200 mm of each primary is 47.6 mm instead of 44.5 mm
    (a diameter jump -> TCCUnionEntreTubos), and the merge starts at 4 x the 47.6 mm area."""
    s = i4_41()
    segs = s["exhaust"]["segs"]
    lp = segs[1]["L"]
    s["exhaust"]["segs"] = [segs[0], {"L": lp - 0.2, "d0": 0.0445, "d1": 0.0445},
                            {"L": 0.2, "d0": 0.0476, "d1": 0.0476}]
    s["opt"]["collector"]["segs"][0]["d0"] = 0.0476 * 2.0
    return s


V8_FIRING = [1, 8, 4, 3, 6, 5, 7, 2]       # cross-plane V8, one firing every 90 deg


def v8_dual():
    """A cross-plane V8 built from the i4's cylinder (84 x 89 mm, so 3.95 L), firing order 1-8-4-3-6-5-7-2,
    odd cylinders on the left bank, even on the right. Each bank has its own 4-1 (the i4_41 header) open to
    air, so each collector is fed at 270/180/90/180 deg gaps. Cylinder index k-1 = cylinder k."""
    s = i4_41()
    col = s["opt"].pop("collector")
    phases = [0.0] * 8
    for slot, c in enumerate(V8_FIRING):
        phases[c - 1] = 90.0 * slot
    s["opt"]["phases"] = phases
    s["opt"]["collectors"] = [dict(copy.deepcopy(col), cyls=[0, 2, 4, 6]), dict(copy.deepcopy(col), cyls=[1, 3, 5, 7])]
    s["n"] = 8
    return s


def i4_open_primaries():
    """Diagnostic: the i4_41 cylinders and primaries with no collector, every primary open to air."""
    s = i4_41()
    s["opt"].pop("collector")
    return s


ALL = {
    "i4_41": i4_41,
    "i4_single_cyl": i4_single_cyl,
    "i4_triy": i4_triy,
    "i4_41_stepped": i4_41_stepped,
    "v8_dual": v8_dual,
    "i4_open_primaries": i4_open_primaries,
}

if __name__ == "__main__":
    # i4_41 and i4_single_cyl are written by calc_spec.js; the derived ones are written here
    for k, f in ALL.items():
        if k in ("i4_41", "i4_single_cyl"):
            continue
        obj = f()
        with open(os.path.join(HERE, "specs", k + ".json"), "w") as fo:
            json.dump(obj, fo, indent=1)
            fo.write("\n")
        print("specs/%s.json" % k)
