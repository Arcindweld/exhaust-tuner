#!/usr/bin/env python3
"""test_2t.py - build, run and summarise two-stroke cases with make_wam2t.py.

    python3 tests/test_2t.py [case ...] [rpm=7000,9000] [cycles=30] [cell_mm=8] [jobs=4] [pipe=chamber|straight|both]

cases: mx125 (125 cc MX single, the project's own chamber design), maico490 (vintage Maico 490, the sample engine
of 2 Stroke Wizard). Each run goes to openwam/runs2t/<case>_<pipe>_<rpm>/; results are printed as a table and
written to openwam/runs2t/<case>_results.json.

Assumed values that the brief did not give are marked ASSUMED below.
"""
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import make_wam2t as m2  # noqa: E402

MM = 1e-3


def segs_mm(rows):
    """[(L, d0, d1) mm] -> [{L, d0, d1} m]"""
    return [{"L": L * MM, "d0": d0 * MM, "d1": d1 * MM} for (L, d0, d1) in rows]


def straight_like(segs):
    L = sum(s["L"] for s in segs)
    d = segs[0]["d0"]
    return [{"L": L, "d0": d, "d1": d}]


def example_125():
    """125 cc MX single, 54 x 54.5 mm, rod 110 mm."""
    return {
        "e": {"bore": 54.0 * MM, "stroke": 54.5 * MM, "rod": 110.0 * MM,
              "cr_trapped": 8.8,          # ASSUMED, modern 125 MX on pump/race fuel
              "ccr": 1.40,                # ASSUMED crankcase compression ratio
              "afr": 12.5,                # ASSUMED, rich for power
              "burn": {"start": 20.0, "dur": 50.0, "a": 5.0, "m": 2.0},   # ASSUMED Wiebe
              "Twall": {"piston": 280.0, "head": 220.0, "liner": 180.0}},  # ASSUMED, water-cooled
        # exhaust: 194 deg; effective width 39 mm (72 % of bore, main + aux ports as one window), radii ASSUMED
        "exhaust_port": {"dur": 194.0, "width": 39.0 * MM, "r_top": 6.0 * MM, "r_bot": 3.0 * MM, "cd": 0.70},
        # transfers: 130 deg; one equivalent port, effective total width 62 mm (5-port layout, ~115 % of bore chordal,
        # ASSUMED), duct 75 mm long, 34 mm equivalent diameter (ASSUMED)
        "transfers": [{"dur": 130.0, "width": 62.0 * MM, "r_top": 3.0 * MM, "r_bot": 2.0 * MM, "cd": 0.65,
                       "duct": {"L": 75.0 * MM, "d": 34.0 * MM}}],
        # intake: 38 mm carburettor, bellmouth-to-reed 250 mm, reed block 4 carbon petals (ASSUMED)
        "intake": {"type": "reed", "segs": segs_mm([(250.0, 38.0, 38.0)]), "Tw": 318.15,
                   "reed": {"petals": 4, "L": 38.0 * MM, "w": 24.0 * MM, "t": 0.45 * MM, "E": 45e9, "rho": 1550.0,
                            "zeta": 0.15, "cd": 0.60, "A_block": 2600.0 * MM * MM}},
        "exhaust": {"Tw": 450.0 + 273.15,          # ASSUMED mean chamber wall temperature
                    "segs": segs_mm([(85.6, 38.0, 39.9), (210.6, 39.9, 54.0), (140.4, 54.0, 83.6), (119.8, 83.6, 123.5),
                                     (94.2, 123.5, 123.5), (205.5, 123.5, 22.8), (205.5, 22.8, 22.8)])},
    }


def example_maico():
    """Vintage Maico 490 single (2 Stroke Wizard sample engine): 86.5 x 83 mm, 53 hp at 6500 rpm claimed."""
    return {
        "e": {"bore": 86.5 * MM, "stroke": 83.0 * MM, "rod": 150.0 * MM,    # rod ASSUMED (rod/stroke 1.8)
              "cr_trapped": 7.0,          # ASSUMED, vintage open-class
              "ccr": 1.35,                # ASSUMED
              "afr": 12.5,
              "burn": {"start": 25.0, "dur": 60.0, "a": 5.0, "m": 2.0},   # ASSUMED, large bore burns longer
              "Twall": {"piston": 300.0, "head": 250.0, "liner": 220.0}},  # ASSUMED, air-cooled
        # exhaust: 179 deg, round 43 mm port (width = height = 43, radii 21.5); its bottom lies below the BDC crown
        "exhaust_port": {"dur": 179.0, "width": 43.0 * MM, "height": 43.0 * MM, "r_top": 21.5 * MM, "r_bot": 21.5 * MM, "cd": 0.70},
        # transfers: 123 deg, one equivalent port 65 mm effective width (ASSUMED, ~75 % of bore), duct 100 x 40 mm
        "transfers": [{"dur": 123.0, "width": 65.0 * MM, "r_top": 4.0 * MM, "r_bot": 3.0 * MM, "cd": 0.65,
                       "duct": {"L": 100.0 * MM, "d": 40.0 * MM}}],
        # intake: reed assumed (brief), 40 mm carburettor, 280 mm to the reed, 6 petals (ASSUMED)
        "intake": {"type": "reed", "segs": segs_mm([(280.0, 40.0, 40.0)]), "Tw": 318.15,
                   "reed": {"petals": 6, "L": 45.0 * MM, "w": 26.0 * MM, "t": 0.50 * MM, "E": 45e9, "rho": 1550.0,
                            "zeta": 0.15, "cd": 0.60, "A_block": 4200.0 * MM * MM}},
        # chamber from the port face (first 55 mm of the header is the port in the cylinder), corrected brief
        "exhaust": {"Tw": 400.0 + 273.15,          # ASSUMED
                    "segs": segs_mm([(118.9, 43.0, 43.0), (324.7, 43.0, 45.4), (214.1, 45.4, 69.9), (107.0, 69.9, 89.3),
                                     (139.1, 89.3, 89.3), (285.4, 89.3, 22.8), (182.4, 22.8, 22.8)])},
    }


CASES = {"mx125": (example_125, [7000, 9000, 10000, 11000, 11500, 12000, 13000]),
         "maico490": (example_maico, [4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000])}


def run_one(case, pipe, rpm, over):
    spec = CASES[case][0]()
    if pipe == "straight":
        spec["exhaust"]["segs"] = straight_like(spec["exhaust"]["segs"])
    name = "%s_%s_%d" % (case, pipe, rpm)
    run = dict(over, rpm=float(rpm), name=name)
    model = m2.model_from_spec(spec, run)
    folder = os.path.join(ROOT, "runs2t", name)
    m2.run_model(folder, model)
    s = m2.wam2t_summary(folder, model)
    s["pipe"] = pipe
    return s


def table(res):
    lines = ["%-8s %6s %5s %6s %7s %7s %7s %7s %6s %6s %6s %6s %6s %6s %7s" %
             ("pipe", "rpm", "fin", "IMEP", "ccMEP", "BMEP", "T_b Nm", "P_b hp", "P_i hp", "DR", "TE", "SE", "CE", "sprd%", "BSFC")]
    for s in res:
        lines.append("%-8s %6d %5s %6.2f %7.3f %7.2f %7.2f %7.1f %6.1f %6.3f %6.3f %6.3f %6.3f %6.2f %7.0f" %
                     (s["pipe"], s["rpm"], "y" if s["finished"] else "NO", s["IMEP_bar"], s["crankcase_MEP_bar"], s["BMEP_bar"],
                      s["T_brake_Nm"], s["P_brake_hp"], s["P_ind_hp"], s["DR"], s["TE"], s["SE"], s["CE"],
                      s["NMEP_spread_last5_pct"], s["BSFC_g_kWh"]))
    return "\n".join(lines)


def main(argv):
    cases, over, jobs, rpms, pipes = [], {"cycles": 30, "cell_mm": 8.0}, 4, None, ["chamber", "straight"]
    for a in argv[1:]:
        if "=" in a:
            k, v = a.split("=", 1)
            if k == "jobs":
                jobs = int(v)
            elif k == "rpm":
                rpms = [int(x) for x in v.split(",")]
            elif k == "pipe":
                pipes = ["chamber", "straight"] if v == "both" else [v]
            elif k in ("cycles", "cd_points", "closing_fix"):
                over[k] = int(v)
            else:
                over[k] = float(v)
        else:
            cases.append(a)
    for case in cases or ["mx125"]:
        todo = [(case, pp, r) for pp in pipes for r in (rpms or CASES[case][1])]
        with ThreadPoolExecutor(max_workers=jobs) as ex:
            res = list(ex.map(lambda t: run_one(t[0], t[1], t[2], over), todo))
        print("== %s (%s)" % (case, ", ".join("%s=%s" % kv for kv in sorted(over.items()))))
        print(table(res))
        with open(os.path.join(ROOT, "runs2t", "%s_results.json" % case), "w") as f:
            json.dump(res, f, indent=1)


if __name__ == "__main__":
    main(sys.argv)
