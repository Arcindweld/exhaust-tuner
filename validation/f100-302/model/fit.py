#!/usr/bin/env python3
"""fit.py - which of the F-100's unknown lengths the pass-by recording pins down: from the best case so far (HO firing
order, chambered muffler, shared intake plenum, X 400 mm from the collectors, 600 mm exits, 762 mm primaries), each
unknown is moved on its own to either side, every case run in OpenWAM at 5800 rpm and scored as f100.py scores it
(both exits, clipped at the recording's floor, the mean over the four pulls). A length the recording pins down moves
the score by more than its spread between pulls; one it does not, by less.

    python3 fit.py run      # the cases (2 at a time; about 10 minutes each)
    python3 fit.py report   # the table, into fit.json
"""
import json
import os
import sys

import numpy as np

import f100

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = {"to_x_mm": 400, "exit_mm": 600, "prim_mm": 762}
STEPS = {"to_x_mm": [250, 550], "exit_mm": [300, 900], "prim_mm": [660, 860]}


def case_name(p):
    return "fit_x%d_e%d_p%d_5800" % (p["to_x_mm"], p["exit_mm"], p["prim_mm"])


def cases():
    out = [dict(BASE)]
    for k, vs in STEPS.items():
        for v in vs:
            q = dict(BASE); q[k] = v; out.append(q)
    return out


def register():
    for q in cases():
        f100.CASES[case_name(q)] = ("ho", "venom", 5800.0, q["exit_mm"], True, q["to_x_mm"], q["prim_mm"])


if __name__ == "__main__":
    register()
    names = [case_name(q) for q in cases()]
    if sys.argv[1:2] == ["run"]:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as ex:
            for name, model, s in ex.map(f100.run_case, names):
                print("%-28s finished %s NMEP %.2f" % (name, s["finished"], s["last"]["NMEP"]), flush=True)
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        f100.sound([n for n in names if os.path.exists(os.path.join(HERE, "runs", n, n + "INS.DAT"))])
    res = json.load(open(os.path.join(HERE, "results.json")))
    rows = []
    for q, n in zip(cases(), names):
        if n not in res:
            continue
        v = list(res[n]["both_exits"]["vs_floor"].values())
        rows.append(dict(q, case=n, mean=round(float(np.mean(v)), 2), spread=round(float(np.std(v)), 2), each=v))
    json.dump(rows, open(os.path.join(HERE, "fit.json"), "w"), indent=1)
    base = [r for r in rows if all(r[k] == BASE[k] for k in BASE)]
    b0 = base[0]["mean"] if base else float("nan")
    print("%-10s %-8s %-7s %-7s  clipped RMS mean (spread over pulls)  vs base" % ("X to coll", "exit", "primary", ""))
    for r in rows:
        print("%-10d %-8d %-7d %-7s  %5.2f (%.2f)  %+5.2f" % (r["to_x_mm"], r["exit_mm"], r["prim_mm"], "", r["mean"], r["spread"], r["mean"] - b0))
