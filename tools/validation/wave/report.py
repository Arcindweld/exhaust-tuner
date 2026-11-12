#!/usr/bin/env python3
"""report.py - the tables of docs/WAVE_VALIDATION_2026-11-11.md from the result files of compare.py and gridconv.py.

    python3 tools/validation/wave/report.py [tag=base] [vs=before]

Prints Markdown: per configuration the VE curve agreement (correlation, peak speeds, mean ratio, largest difference),
the exhaust-port trace agreement (correlation, amplitude ratio), mean port pressure (back pressure), net IMEP and the
indicated efficiency of the heat released, and the tailpipe order levels at 0.5, 1, 1.5, 2 and 4 x the firing order.
With vs=<tag> it also prints the change of the wave model's numbers from that tag's run (for example the page before
this validation's fixes). Nothing is fitted; every number comes from the result files.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "results")


def load(tag):
    p = os.path.join(RES, tag + ".json")
    return json.load(open(p)) if os.path.exists(p) else {}


def med(v):
    v = sorted(x for x in v if x is not None and not math.isnan(x))
    return v[len(v) // 2] if v else float("nan")


def main(argv):
    o = {"tag": "base", "vs": ""}
    for a in argv[1:]:
        k, v = a.split("=", 1)
        o[k] = v
    R = load(o["tag"])
    print("### VE, port pressure and work (%s)\n" % o["tag"])
    print("| configuration | speeds (rpm) | VE corr | VE peak wave / OpenWAM | VE mean ratio | max |dVE| | port p corr (median) | port p-p amplitude ratio (median) | mean port p wave - OpenWAM (kPa, mean) | NMEP ratio (mean) | indicated eff. of heat released wave / OpenWAM (mean) |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for cfg, m in R.items():
        rows = m["rows"]
        s = m["summary"]
        dve = max(abs(r["wave"]["ve"] - r["wam"]["ve"]) for r in rows)
        dp = sum(r["wave"]["pPortMean"] - r["wam"]["pPortMean"] for r in rows) / len(rows) / 1e3
        nm = sum(r["wave"]["nmep"] / r["wam"]["nmep"] for r in rows) / len(rows)
        vd = None
        eff = ""
        if all(r["wave"].get("Qcomb") and r["wam"].get("Qcomb") for r in rows):
            e = m.get("Vd")
            # net work per cylinder and cycle = NMEP x Vd; Vd cancels in the ratio, so report NMEP / Q in bar per kJ
            ew = sum(r["wave"]["nmep"] / r["wave"]["Qcomb"] for r in rows) / len(rows)
            eo = sum(r["wam"]["nmep"] / r["wam"]["Qcomb"] for r in rows) / len(rows)
            eff = "%.3f / %.3f (x Vd)" % (ew * 1e-2, eo * 1e-2) if e is None else "%.3f / %.3f" % (ew * e, eo * e)
        print("| %s | %s | %.3f | %d / %d | %.3f | %.3f | %.2f | %.2f | %+.1f | %.3f | %s |" % (
            cfg, "-".join(str(r["rpm"]) for r in (rows[0], rows[-1])), s["veCorr"], s["vePeakWave"], s["vePeakWam"],
            s["veMeanRatio"], dve, med([r.get("portCorr") for r in rows]), med([r.get("portAmpRatio") for r in rows]), dp, nm, eff))
    print("\n### Tailpipe order levels, wave - OpenWAM (dB, monopole at 1 m), per speed\n")
    for cfg, m in R.items():
        rows = m["rows"]
        orders = list(rows[0]["orderDiff"].keys())
        orders = [x for x in orders if float(x) > 0]
        print("**%s** (orders: %s)\n" % (cfg, ", ".join(orders)))
        print("| rpm | " + " | ".join(orders) + " | VE wave / OpenWAM |")
        print("|---|" + "---|" * (len(orders) + 1))
        for r in rows:
            print("| %d | %s | %.3f / %.3f |" % (r["rpm"], " | ".join("%+.1f" % r["orderDiff"][x] for x in orders), r["wave"]["ve"], r["wam"]["ve"]))
        al = [abs(r["orderDiff"][x]) for r in rows for x in orders]
        print("\nmedian |difference| %.1f dB, %d of %d within 3 dB\n" % (med(al), sum(1 for x in al if x <= 3), len(al)))
    if o["vs"]:
        B = load(o["vs"])
        print("\n### The wave model now against tag %s (same OpenWAM runs)\n" % o["vs"])
        print("| configuration | VE corr %s -> now | VE mean ratio %s -> now | max |VE change| | median |order change| (dB) |" % (o["vs"], o["vs"]))
        print("|---|---|---|---|---|")
        for cfg, m in R.items():
            if cfg not in B:
                continue
            b = B[cfg]
            dv = max(abs(x["wave"]["ve"] - y["wave"]["ve"]) for x, y in zip(m["rows"], b["rows"]))
            do = med([abs(x["wave"]["orders"][k] - y["wave"]["orders"][k]) for x, y in zip(m["rows"], b["rows"]) for k in x["wave"]["orders"] if float(k) > 0])
            print("| %s | %.3f -> %.3f | %.3f -> %.3f | %.3f | %.1f |" % (cfg, b["summary"]["veCorr"], m["summary"]["veCorr"],
                  b["summary"]["veMeanRatio"], m["summary"]["veMeanRatio"], dv, do))


if __name__ == "__main__":
    main(sys.argv)
