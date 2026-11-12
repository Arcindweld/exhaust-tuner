#!/usr/bin/env python3
"""ratings_report.py - the table of results/ratings_<tag>.json (ratings.js) against the engines' published ratings.

    python3 tools/validation/wave/ratings_report.py before after [more tags]

Per engine and tag: peak torque (lb-ft) and its rpm, peak power (hp) and its rpm, indicated (net loop) and brake
(gross loop less the page's friction law, WS.tfmep), each with its error against the rating; and the "net - tfmep"
bracket (friction off the net loop: the model's pumping counted on top of Heywood's, the low end). A run whose page had
no friction law (tag before) gets its brake from the same law applied here to its gross loop (the hook's p dV)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LB, HP = 1 / 1.3558179483, 1 / 0.745699872


def tfmep(rpm):
    n = rpm / 1000.0
    return 1e5 * (0.97 + 0.15 * n + 0.05 * n * n)


def peaks(rows, vtot, f):
    tq = [(f(r) * vtot / (4 * 3.141592653589793), r["rpm"]) for r in rows]
    t = max(tq)
    p = max((x * rpm * 3.141592653589793 / 30 / 1000, rpm) for x, rpm in tq)
    return t[0] * LB, t[1], p[0] * 1000 * HP / 1000, p[1]


def main(tags):
    print("| engine | rating | tag | indicated torque | indicated power | brake torque | brake power | brake (net - tfmep) torque / power | VE peak @ rpm; at the rated torque speed | gross IMEP at the rated torque speed (bar) |")
    print("|---|---|---|---|---|---|---|---|---|---|")
    for tag in tags:
        d = json.load(open(os.path.join(HERE, "results", "ratings_%s.json" % tag)))
        for k, E in d["engines"].items():
            R = E["summary"]["rated"]
            r0 = E["rows"][0]
            vtot = r0["tq"] * 4 * 3.141592653589793 / r0["imep"]
            g = lambda r: r.get("gimep") if r.get("gimep") is not None else r["gross"]
            ti, tir, pi, pir = peaks(E["rows"], vtot, lambda r: r["imep"])
            tb, tbr, pb, pbr = peaks(E["rows"], vtot, lambda r: g(r) - tfmep(r["rpm"]))
            tn, tnr, pn, pnr = peaks(E["rows"], vtot, lambda r: r["imep"] - tfmep(r["rpm"]))
            e = lambda v, ref: "%+.0f %%" % (100 * (v / ref - 1))
            vp = max(E["rows"], key=lambda r: r["ve"])
            at = min(E["rows"], key=lambda r: abs(r["rpm"] - R["tqRpm"]))
            print("| %s%s | %d lb-ft @ %d, %d hp @ %d | %s | %.0f @ %d (%s) | %.0f @ %d (%s) | %.0f @ %d (%s) | %.0f @ %d (%s) | %.0f (%s) / %.0f (%s) | %.3f @ %d; %.3f | %.2f |" % (
                k.upper(), " (cam assumed)" if E.get("assumed") else "", R["lbft"], R["tqRpm"], R["hp"], R["hpRpm"], tag,
                ti, tir, e(ti, R["lbft"]), pi, pir, e(pi, R["hp"]), tb, tbr, e(tb, R["lbft"]), pb, pbr, e(pb, R["hp"]),
                tn, e(tn, R["lbft"]), pn, e(pn, R["hp"]), vp["ve"], vp["rpm"], at["ve"], g(at) / 1e5))


if __name__ == "__main__":
    main(sys.argv[1:] or ["before", "after"])
