#!/usr/bin/env python3
"""work_split.py - where the net-IMEP difference between the wave model and OpenWAM sits (2026-11-12).

    python3 tools/validation/wave/work_split.py [tag=base] [configs=a,b]

From the cylinder-1 pressure traces that compare.py keeps (every 2 degrees of the last cycle, firing TDC at 0) and the
engine's geometry, each code's indicated work is split into the gross loop (compression and expansion strokes, 540-720
and 0-180 degrees) and the pumping loop (exhaust and intake strokes, 180-540 degrees), per unit of displaced volume,
together with the peak pressure. The same 2-degree trapezoid is applied to both codes, so the split compares like with
like (its absolute values are within about 1 % of the codes' own NMEP; the script prints that check). Nothing is fitted.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare  # noqa: E402


def vol(e, th):
    ap = math.pi * e["bore"] ** 2 / 4
    vd = ap * e["stroke"]
    vc = vd / (e["cr"] - 1)
    cr, rod = e["stroke"] / 2, e["rod"]
    t = math.radians(th)
    s = math.sin(t)
    return vc + ap * (cr + rod - cr * math.cos(t) - math.sqrt(rod * rod - cr * cr * s * s)), vd


def split(e, p):
    n = len(p)
    d = 720.0 / n
    g = q = 0.0
    for k in range(n):
        a, b = k * d, (k + 1) * d
        va, vd = vol(e, a)
        vb, _ = vol(e, b)
        w = 0.5 * (p[k] + p[(k + 1) % n]) * (vb - va)
        if 180.0 <= a < 540.0:
            q += w
        else:
            g += w
    return g / vd, q / vd


def main(argv):
    o = {"tag": "base", "configs": ""}
    for a in argv[1:]:
        k, v = a.split("=", 1)
        o[k] = v
    R = json.load(open(os.path.join(HERE, "results", o["tag"] + ".json")))
    cfgs = o["configs"].split(",") if o["configs"] else list(R)
    print("| configuration | rpm | gross IMEP wave / OpenWAM (bar) | ratio | pumping wave / OpenWAM (bar) | net (trace) wave / OpenWAM | net ratio | NMEP check wave / OpenWAM | peak p wave / OpenWAM (bar) |")
    print("|---|---|---|---|---|---|---|---|---|")
    tot = {}
    for cfg in cfgs:
        m = R[cfg]
        e = compare.CONFIGS[cfg][0]()["e"]
        for r in m["rows"]:
            gw, qw = split(e, r["wave"]["pCyl"])
            go, qo = split(e, r["wam"]["pCyl"])
            print("| %s | %d | %.2f / %.2f | %.3f | %+.2f / %+.2f | %.2f / %.2f | %.3f | %.3f / %.3f | %.1f / %.1f |" % (
                cfg, r["rpm"], gw / 1e5, go / 1e5, gw / go, qw / 1e5, qo / 1e5, (gw + qw) / 1e5, (go + qo) / 1e5, (gw + qw) / (go + qo),
                (gw + qw) / r["wave"]["nmep"], (go + qo) / r["wam"]["nmep"], max(r["wave"]["pCyl"]) / 1e5, max(r["wam"]["pCyl"]) / 1e5))
            t = tot.setdefault(cfg, [0, 0, 0, 0, 0])
            t[0] += gw / go
            t[1] += (qw - qo) / (go + qo)
            t[2] += (gw + qw) / (go + qo)
            t[3] += max(r["wave"]["pCyl"]) / max(r["wam"]["pCyl"])
            t[4] += 1
    print("\n| configuration | gross ratio (mean) | pumping difference / OpenWAM net (mean) | net ratio (mean) | peak pressure ratio (mean) |")
    print("|---|---|---|---|---|")
    for cfg, t in tot.items():
        n = t[4]
        print("| %s | %.3f | %+.3f | %.3f | %.3f |" % (cfg, t[0] / n, t[1] / n, t[2] / n, t[3] / n))


if __name__ == "__main__":
    main(sys.argv)
