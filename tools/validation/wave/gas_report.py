#!/usr/bin/env python3
"""gas_report.py - the wave model against OpenWAM before and after the temperature- and composition-dependent gas
(2026-11-12): results/<before>.json (default const: the constant gamma 1.35, R 287 model) against results/<after>.json
(default base), both against the same OpenWAM runs.

    python3 tools/validation/wave/gas_report.py [before=const] [after=base]

Per configuration (means over its speeds): net IMEP (NMEP) ratio wave / OpenWAM, VE mean ratio and correlation, the
crank-angle mean exhaust-port gas temperature wave - OpenWAM, the mass-averaged exhaust-valve outflow temperature of the
wave model, the median exhaust-port trace correlation, and the tailpipe firing-order levels (median |wave - OpenWAM| and
how many within 3 dB). Prints Markdown. Nothing is fitted.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load(tag):
    return json.load(open(os.path.join(HERE, "results", tag + ".json")))


def med(v):
    v = sorted(x for x in v if x is not None and not (isinstance(x, float) and math.isnan(x)))
    return v[len(v) // 2] if v else float("nan")


def firing(cfg, m):
    ncyl = {"i4_41": 4, "v8_2x41": 8, "v8_line": 8, "v8_line_X": 8}.get(cfg, 1)
    fo = ncyl / 2.0
    if ncyl == 1:
        return ["0.5", "1.0", "1.5", "2.0"]
    return [str(round(f * fo * 2) / 2) for f in (1, 2, 4)]


def summ(cfg, m):
    rows = m["rows"]
    n = len(rows)
    nm = sum(r["wave"]["nmep"] / r["wam"]["nmep"] for r in rows) / n
    tp = [r["wave"].get("tPortMean") - r["wam"].get("tPortMean") for r in rows if r["wave"].get("tPortMean") and r["wam"].get("tPortMean")]
    tex = [r["wave"].get("tEx") for r in rows if r["wave"].get("tEx")]
    od = [abs(r["orderDiff"][o]) for r in rows for o in firing(cfg, m) if o in r.get("orderDiff", {})]
    return {"nmep": nm, "veRatio": m["summary"]["veMeanRatio"], "veCorr": m["summary"]["veCorr"],
            "dT": sum(tp) / len(tp) if tp else float("nan"), "tEx": sum(tex) / len(tex) if tex else float("nan"),
            "pc": med([r.get("portCorr") for r in rows]), "od": med(od), "od3": sum(1 for x in od if x <= 3.0), "odn": len(od),
            "eff": sum(r["wave"]["nmep"] / (r["wave"]["Qcomb"] / m["Vd"]) for r in rows if r["wave"].get("Qcomb")) / n,
            "effw": sum(r["wam"]["nmep"] / (r["wam"]["Qcomb"] / m["Vd"]) for r in rows if r["wam"].get("Qcomb")) / n}


def main(argv):
    o = {"before": "const", "after": "base"}
    for a in argv[1:]:
        k, v = a.split("=", 1)
        o[k] = v
    B, A = load(o["before"]), load(o["after"])
    print("| configuration | NMEP ratio wave / OpenWAM, before -> after | indicated eff. of heat released, wave before -> after (OpenWAM) | VE mean ratio before -> after | VE corr before -> after | mean port gas T wave - OpenWAM (K) before -> after | exhaust-valve outflow T, wave (K) before -> after | port p corr (median) before -> after | firing orders: median abs diff (dB), within 3 dB, before -> after |")
    print("|---|---|---|---|---|---|---|---|---|")
    for cfg in A:
        if cfg not in B:
            continue
        b, a = summ(cfg, B[cfg]), summ(cfg, A[cfg])
        print("| %s | %.3f -> %.3f | %.3f -> %.3f (%.3f) | %.3f -> %.3f | %.3f -> %.3f | %+.0f -> %+.0f | %.0f -> %.0f | %.2f -> %.2f | %.1f, %d/%d -> %.1f, %d/%d |" % (
            cfg, b["nmep"], a["nmep"], b["eff"], a["eff"], a["effw"], b["veRatio"], a["veRatio"], b["veCorr"], a["veCorr"], b["dT"], a["dT"],
            b["tEx"], a["tEx"], b["pc"], a["pc"], b["od"], b["od3"], b["odn"], a["od"], a["od3"], a["odn"]))


if __name__ == "__main__":
    main(sys.argv)
