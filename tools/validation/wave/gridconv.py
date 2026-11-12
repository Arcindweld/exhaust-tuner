#!/usr/bin/env python3
"""gridconv.py - grid and time-step convergence of the wave model's VE, net IMEP and tailpipe order levels.

    python3 tools/validation/wave/gridconv.py [configs=single_L800,i4_41] [page=path]

Each configuration of compare.py runs at its page grid times 2, 1, 1/2 and 1/4 (the time step follows the grid through
the CFL limit, 0.8; the 0.5 crank-degree cap only binds on coarse grids at low speed). Writes results/gridconv.json.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare  # noqa: E402

GRID_RPM = {"single_L800": [4000, 6000, 8000], "single_muffler": [4000, 6000, 8000], "i4_41": [3500, 5500, 7500]}


def main(argv):
    opts = {"configs": "single_L800,single_muffler,i4_41", "page": ""}
    for a in argv[1:]:
        k, v = a.split("=", 1)
        opts[k] = v
    out = {}
    for cfg in opts["configs"].split(","):
        build, _rpms, dx0 = compare.CONFIGS[cfg]
        spec = build()
        rpms = GRID_RPM[cfg]
        nc = len(spec["opt"]["phases"])
        orders = sorted(set([0.5, 1.0, 1.5, 2.0] + [round(f * nc) / 2 for f in (0.5, 1, 1.5, 2, 4)]))
        res = []
        for f in (2.0, 1.0, 0.5, 0.25):
            w = compare.wave_runs(cfg + "_grid%g" % f, spec, rpms, dx0 * f, None, opts["page"] or None, 12)
            for r in w["runs"]:
                th = r["trace"]["th"]
                mo = [0.0] * 1440
                for m in r["trace"]["mOut"]:
                    mo = [a + b for a, b in zip(mo, compare.resample(th, m))]
                res.append({"dx": dx0 * f, "rpm": r["rpm"], "ve": r["ve"], "imep": r["imep"], "seconds": r["seconds"],
                            "orders": compare.order_levels(mo, r["rpm"], orders)})
                print("%s dx %.5f %d rpm VE %.4f IMEP %.3f bar %.1f s" % (cfg, dx0 * f, r["rpm"], r["ve"], r["imep"] / 1e5, r["seconds"]), flush=True)
        out[cfg] = {"dx0": dx0, "rows": res, "orders": orders}
    os.makedirs(compare.RES, exist_ok=True)
    with open(os.path.join(compare.RES, "gridconv.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main(sys.argv)
