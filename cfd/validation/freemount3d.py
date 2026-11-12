#!/usr/bin/env python3
"""Free-standing (re-entrant) mouth in 3-D against the 2-D free mount and Idelchik, and a measured mouth profile
against the ellipse it was measured from (cfd/NOTES.md 4 (i), (j)).

  python3 freemount3d.py table   # print the tables from runs/f3_*, f2_*, p2_* results.json -> freemount3d_results.json

Straight tube D 50 mm, L 25 D (+3 D outlet extension), Re 1.0e5, simpleFoam, medium mesh, mount free with the tube
standing 25 mm (0.5 D) proud of the plenum wall; K from the total-pressure line over 10-22 D exactly as
entrance3d.py (analyse()). Cases (designs: design() below; generated with intake_cfd.py, run with ./Allrun 1):
  f3_t002 / f2_t002   plain cut, wall 1.0 mm (t/D 0.02), 3-D / 2-D
  f3_t005 / f2_t005   plain cut, wall 2.5 mm (t/D 0.05)
  f3_r004 / f2_r004   rolled lip r/D 0.04 (2 mm), free-standing
  f3_r004_level4      f3_r004 as first generated (lip cells 1.56 mm = 1.3 across the 2 mm lip radius, before
                      LIP_CELLS_3D); f3_r004_l5: that case with inlet_wall and lipShell set to level 5 by hand (0.78 mm)
  p2_ell / p2_prof    2-D, flange: the 25 mm x 80 mm elliptical bellmouth (sharp 1.5 mm rim), and the same flare
                      given as 21 measured points (inlet type profile)
Idelchik's re-entrant entrance (Handbook of Hydraulic Resistance, diagram 3-1) as python-fluids transcribes it
(fluids.fittings.entrance_distance, method 'Idelchik'): a table of K against the wall thickness t/D (rows) and the
distance the tube stands from the wall l/D (columns), linear in both; read from the fluids source and checked against
its two docstring examples (Di 0.1 m, t 0.5 mm: 0.925; with l 20 mm: 0.8475) by IDELCHIK_CHECK below. Rennels' and
the flush handbook values are as entrance3d.py.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import entrance3d as e3  # noqa: E402

RUNS = os.path.join(HERE, "runs")
D = 0.050
PROTRUSION = 0.025
# fluids.fittings: entrance_distance_Idelchik_t_Di (rows), entrance_distance_Idelchik_l_Di (columns; the last of each
# stands for infinity) and entrance_distance_Idelchik_dat
I_T = [0.0, 0.004, 0.008, 0.012, 0.016, 0.02, 0.024, 0.03, 0.04, 0.05, 1.0]
I_L = [0.0, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 10.0]
I_K = [[0.5, 0.57, 0.63, 0.68, 0.73, 0.8, 0.86, 0.92, 0.97, 1, 1],
       [0.5, 0.54, 0.58, 0.63, 0.67, 0.74, 0.8, 0.86, 0.9, 0.94, 0.94],
       [0.5, 0.53, 0.55, 0.58, 0.62, 0.68, 0.74, 0.81, 0.85, 0.88, 0.88],
       [0.5, 0.52, 0.53, 0.55, 0.58, 0.63, 0.68, 0.75, 0.79, 0.83, 0.83],
       [0.5, 0.51, 0.51, 0.53, 0.55, 0.58, 0.64, 0.7, 0.74, 0.77, 0.77],
       [0.5, 0.51, 0.51, 0.52, 0.53, 0.55, 0.6, 0.66, 0.69, 0.72, 0.72],
       [0.5, 0.5, 0.5, 0.51, 0.52, 0.53, 0.58, 0.62, 0.65, 0.68, 0.68],
       [0.5, 0.5, 0.5, 0.51, 0.52, 0.52, 0.54, 0.57, 0.59, 0.61, 0.61],
       [0.5, 0.5, 0.5, 0.51, 0.51, 0.51, 0.51, 0.52, 0.52, 0.54, 0.54],
       [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
       [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]]


def _seg(xs, x):
    x = min(max(x, xs[0]), xs[-1])
    for i in range(len(xs) - 1):
        if x <= xs[i + 1]:
            return i, (x - xs[i]) / (xs[i + 1] - xs[i])
    return len(xs) - 2, 1.0


def idelchik_reentrant(t_D, l_D=1.0):
    """K of a sharp re-entrant entrance, Idelchik diagram 3-1 as fluids.fittings.entrance_distance (bilinear)."""
    i, u = _seg(I_T, min(t_D, 1.0))
    j, v = _seg(I_L, min(l_D, 10.0))
    k = I_K
    return max(0.0, (1 - u) * (1 - v) * k[i][j] + u * (1 - v) * k[i + 1][j] + (1 - u) * v * k[i][j + 1] + u * v * k[i + 1][j + 1])


def rennels_reentrant(t_D):
    """Rennels & Hudson (2012) as fluids.fittings.entrance_distance's default: K = 1.12 - 22 t/d + 216 (t/d)^2 +
    80 (t/d)^3 (pipe standing at least D/2 into the reservoir; settles to 0.57)."""
    if t_D >= 0.05:
        return 0.57
    return 1.12 - 22 * t_D + 216 * t_D ** 2 + 80 * t_D ** 3


IDELCHIK_CHECK = (idelchik_reentrant(0.0005 / 0.1, 1.0), idelchik_reentrant(0.0005 / 0.1, 0.02 / 0.1))
assert abs(IDELCHIK_CHECK[0] - 0.925) < 1e-9 and abs(IDELCHIK_CHECK[1] - 0.8475) < 1e-9, IDELCHIK_CHECK

CASES = [("t/D 0.02, sharp", "f3_t002", "f2_t002", 0.02, None),
         ("t/D 0.05, sharp", "f3_t005", "f2_t005", 0.05, None),
         ("r/D 0.04 lip, free-standing", "f3_r004", "f2_r004", None, 0.04)]


def load(name):
    rj = os.path.join(RUNS, name, "results.json")
    return json.load(open(rj)) if os.path.exists(rj) else None


def table():
    out = {"setup": "straight tube D 50 mm, L 25 D + 3 D, Re 1e5, simpleFoam, medium, mount free with 25 mm (0.5 D) "
                    "protrusion; K extrapolated from 10-22 D (entrance3d.analyse)",
           "idelchik_docstring_check": IDELCHIK_CHECK, "free": {}, "profile": {}}
    rows = []
    for label, n3, n2, tD, rD in CASES:
        e = {"t_over_D": tD, "r_over_D": rD, "l_over_D": PROTRUSION / D}
        for tag, nm in (("3d", n3), ("2d", n2)):
            r = load(nm)
            if r:
                a = e3.analyse(r)
                e[tag] = a
        if tD is not None:
            e["idelchik_reentrant"] = idelchik_reentrant(tD, PROTRUSION / D)
            e["rennels_reentrant"] = rennels_reentrant(tD)
        else:
            e["crane_flush"] = e3.CRANE[rD]
            e["idelchik_flush"] = e3.lin(e3.IDELCHIK, rD)
        out["free"][label] = e
        f = lambda k: ("%.3f" % e[k]["K_total_plus_alpha22_minus_1"]) if k in e else "-"
        g = lambda k: ("%.3f" % e[k]["K_total"]) if k in e else "-"
        ref = ("Idelchik %.3f, Rennels %.3f" % (e["idelchik_reentrant"], e["rennels_reentrant"]) if tD is not None
               else "flush: Crane %.2f, Idelchik %.2f" % (e["crane_flush"], e["idelchik_flush"]))
        rows.append("%-28s 3-D K_total %s  +alpha-1 %s | 2-D K_total %s  +alpha-1 %s | %s" % (label, g("3d"), f("3d"), g("2d"), f("2d"), ref))
    out["lip_resolution"] = {}
    for nm in ("f3_r004_level4", "f3_r004_l5", "f3_r004"):
        r = load(nm)
        if r:
            a = out["lip_resolution"][nm] = e3.analyse(r)
            rows.append("%-28s 3-D K_total %.3f  +alpha-1 %.3f  f %.5f" % (nm, a["K_total"], a["K_total_plus_alpha22_minus_1"], a["f_total_slope"]))
    for nm in ("p2_ell", "p2_prof"):
        r = load(nm)
        if r:
            out["profile"][nm] = e3.analyse(r)
            a = out["profile"][nm]
            rows.append("%-28s 2-D K_total %.4f  +alpha-1 %.4f  f %.5f  %d it" % (nm, a["K_total"], a["K_total_plus_alpha22_minus_1"],
                                                                                 a["f_total_slope"], a["iterations"]))
    json.dump(out, open(os.path.join(HERE, "freemount3d_results.json"), "w"), indent=2)
    print("\n".join(rows))


if __name__ == "__main__":
    table()
