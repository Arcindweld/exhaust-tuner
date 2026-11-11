#!/usr/bin/env python3
"""Rounded-entrance loss in 3-D (snappyHexMesh path) against the 2-D sector and the handbooks.

  python3 entrance3d.py run     # generate + run the six cases (2 at a time, 1 core each), then write the table
  python3 entrance3d.py table   # rewrite entrance3d_results.json and print the table from cached runs

Straight tube D = 50 mm, L = 25 D (+3 D outlet extension), flange mount (mouth flush with the plenum floor),
force_3d, Re 1.0e5, simpleFoam, medium mesh; inlet sharp (plain cut, 3 mm wall) or a rolled lip of r/D 0.02, 0.04,
0.06, 0.10, 0.15. K is extrapolated back to the mouth from the planes at 10, 13, 16, 19 and 22 D, as NOTES 4 (c3),
(c4) did (the 2-D suite, run_validation.py entrance, uses 20-40 D of a 50 D tube):
  K_total            = mass-averaged total-pressure loss line at x = 0, over q        (what a CFD tract-end figure is)
  K_static_minus_1   = (p0 - static-pressure line at x = 0) / q - 1                    (the handbooks' basis)
The two differ by the kinetic-energy coefficient of the profile, alpha - 1 (here alpha is read at each plane as
(p0_massavg - p_static_avg) / q). At 10-22 D the profile is still developing (alpha falls along the tube), so the
static line's slope and intercept carry that too; K_total + (alpha at 22 D - 1) is given as a third, like-for-like
handbook-basis figure (the basis conversion the Intake tab makes with ALPHA_DEV, alpha read from the CFD itself).
Cases are run in $E3D_WORK (default: a temporary folder); each case's results.json is kept in runs/e3d_*/ and the case
folder is deleted. Every case is generated with intake_cfd.generate_case(), as a user would.
"""
import concurrent.futures as cf
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import intake_cfd as ic  # noqa: E402

FOAMENV = os.environ.get("FOAMENV") or os.path.join(ROOT, "foamenv.sh")
RUNS = os.path.join(HERE, "runs")
NWORK = int(os.environ.get("NWORK", "2"))
P0, T0 = 101325.0, 298.15
D = 0.050
XS = (10, 13, 16, 19, 22)
CASES = {"sharp": None, "r0.02D": 0.02, "r0.04D": 0.04, "r0.06D": 0.06, "r0.10D": 0.10, "r0.15D": 0.15}

# Handbook entrance K against r/D, inlet flush with a wall, static-pressure basis (velocity head of the bulk velocity).
# Crane TP-410, "Resistance due to pipe entrance", flush: 0.5 square-edged; rounded r/d 0.02 0.28, 0.04 0.24,
# 0.06 0.15, 0.10 0.09, 0.15 and up 0.04 (as tabulated by Neutrium and in fluids.fittings; the Intake tab's CRANE_ENTRY).
CRANE = {0.0: 0.50, 0.02: 0.28, 0.04: 0.24, 0.06: 0.15, 0.10: 0.09, 0.15: 0.04}
# Idelchik, Handbook of Hydraulic Resistance (1966 translation; diagram 3-4 in the 3rd ed.: inlet rounded by an arc of
# a circle, flush with the wall; based on Hamilton's data): r/Dh 0 0.50, 0.01 0.44, 0.02 0.37, 0.03 0.31, 0.04 0.26, 0.05 0.22, 0.06 0.20, 0.08 0.15,
# 0.12 0.09, 0.16 0.06, 0.20 0.03 (as transcribed in the fluids library, fluids.fittings.entrance_rounded,
# method 'Idelchik'); linear between the points (0.10 -> 0.12).
IDELCHIK = [(0.0, 0.50), (0.01, 0.44), (0.02, 0.37), (0.03, 0.31), (0.04, 0.26), (0.05, 0.22), (0.06, 0.20),
            (0.08, 0.15), (0.12, 0.09), (0.16, 0.06), (0.20, 0.03)]




def rennels(r):
    """Rennels & Hudson, Pipe Flow (2012), rounded inlet flush with a wall (as in fluids.fittings)."""
    lam = 1 + 0.622 * (1 - 0.30 * math.sqrt(r) - 0.70 * r) ** 4
    return 0.0696 * (1 - 0.569 * r) * lam ** 2 + (lam - 1) ** 2


def lin(tab, x):
    for (x0, y0), (x1, y1) in zip(tab, tab[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return tab[-1][1]


def design(tag, rD, level="medium"):
    mdot = 1e5 * ic.mu_air(T0) * math.pi * D / 4
    inlet = {"type": "plain", "wall_thickness_mm": 3.0} if rD is None else \
        {"type": "radius", "lip_radius_mm": round(rD * D * 1e3, 6)}
    return {"name": "e3d_" + tag,
            "geometry": {"tube_diameter_mm": D * 1e3, "tube_length_mm": 25 * D * 1e3, "inlet": inlet,
                         "mount": {"type": "flange"}, "force_3d": True,
                         "planes_mm": {"x%dD" % k: k * D * 1e3 for k in XS},
                         "outlet_extension_D": 3},
            "operating_point": {"mass_flow_kg_s": mdot},
            "ambient": {"p_pa": P0, "T_c": 25.0},
            "mesh": {"level": level},
            "solver": {"force": "incompressible"}}


def run_case(work, tag, rD):
    name = "e3d_" + tag
    keep = os.path.join(RUNS, name)
    rj = os.path.join(keep, "results.json")
    if os.path.exists(rj):
        return json.load(open(rj))
    cdir = os.path.join(work, name)
    if os.path.exists(cdir):
        shutil.rmtree(cdir)
    summ = ic.generate_case(design(tag, rD), cdir)
    t0 = time.time()
    with open(os.path.join(cdir, "allrun.out"), "w") as f:
        subprocess.run(["bash", "-c", ". %s && ./Allrun 1" % FOAMENV], cwd=cdir, stdout=f, stderr=subprocess.STDOUT)
    src = os.path.join(cdir, "results.json")
    if not os.path.exists(src):
        print("  %s FAILED (see %s/allrun.out)" % (name, cdir))
        return None
    res = json.load(open(src))
    res["wall_time_s"] = time.time() - t0
    res["cells_estimate"] = summ["cells"]           # the generator's estimate; checkMesh's count below
    m = re.search(r"cells:\s+(\d+)", open(os.path.join(cdir, "log.checkMesh")).read())
    if m:
        res["cells"] = int(m.group(1))
    os.makedirs(keep, exist_ok=True)
    json.dump(res, open(rj, "w"), indent=2)
    shutil.rmtree(cdir)
    print("  %-14s %6.0f s  %7d cells  converged=%s" % (name, res["wall_time_s"], summ["cells"], res["converged"]))
    return res


def fit(xs, ys):
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    return my - b * mx, b


def analyse(res):
    pl = res["planes"]
    q = pl["x%dD" % XS[-1]]["q_dyn_Pa"]
    a, b = fit(XS, [P0 - pl["x%dD" % k]["p0_massavg_Pa"] for k in XS])
    a2, b2 = fit(XS, [P0 - pl["x%dD" % k]["p_static_avg_Pa"] for k in XS])
    alpha = [(pl["x%dD" % k]["p0_massavg_Pa"] - pl["x%dD" % k]["p_static_avg_Pa"]) / q for k in XS]
    yp = (res.get("yPlus") or {}).get("tract_wall")
    return dict(K_total=a / q, K_static_minus_1=a2 / q - 1.0, K_total_plus_alpha22_minus_1=a / q + alpha[-1] - 1.0, f_total_slope=b / q, f_static_slope=b2 / q,
                alpha_10D=alpha[0], alpha_22D=alpha[-1], q_Pa=q, converged=res["converged"],
                iterations=res["iterations"], wall_time_s=res.get("wall_time_s"), cells=res.get("cells"), cells_estimate=res.get("cells_estimate"),
                solver=res["solver"], yplus_tract_wall=yp)


def table():
    two_d = json.load(open(os.path.join(HERE, "entrance_results.json")))
    out = {"setup": "3-D straight tube D 50 mm, L 25 D, flange, Re 1e5, simpleFoam, medium mesh; K extrapolated "
                    "from 10-22 D; generator %s with slipFeatureAngle 100 and cache grad(U)" % ic.VERSION,
           "f_colebrook": ic.friction_factor_colebrook(1e5), "cases": {}}
    rows = []
    for tag, rD in CASES.items():
        rj = os.path.join(RUNS, "e3d_" + tag, "results.json")
        if not os.path.exists(rj):
            continue
        e = analyse(json.load(open(rj)))
        r = rD or 0.0
        e.update(r_over_D=r, crane=CRANE[r], idelchik=lin(IDELCHIK, r), rennels=rennels(r))
        k2 = {"sharp": "entrance_sharp", "r0.04D": "entrance_r0.04D", "r0.10D": "entrance_r0.10D"}.get(tag)
        if k2 in two_d:
            e.update(K_total_2d=two_d[k2]["K_total"], K_static_minus_1_2d=two_d[k2]["K_static_minus_1"])
        out["cases"][tag] = e
        rows.append("%-7s r/D %.2f  3-D K_total %.3f  K_total+alpha22-1 %.3f  K_static-1 %.3f  (alpha 10D %.3f 22D %.3f)  2-D %s  "
                    "Crane %.2f  Idelchik %.2f  f %.5f  %s it %s" % (
                        tag, r, e["K_total"], e["K_total_plus_alpha22_minus_1"], e["K_static_minus_1"], e["alpha_10D"], e["alpha_22D"],
                        ("%.3f / %.3f" % (e["K_total_2d"], e["K_static_minus_1_2d"])) if "K_total_2d" in e else "-",
                        e["crane"], e["idelchik"], e["f_total_slope"], int(e["iterations"]),
                        "conv" if e["converged"] else "NOT converged"))
    json.dump(out, open(os.path.join(HERE, "entrance3d_results.json"), "w"), indent=2)
    print("\n".join(rows))


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "table"
    if what == "run":
        work = os.environ.get("E3D_WORK") or tempfile.mkdtemp(prefix="e3d_")
        os.makedirs(work, exist_ok=True)
        with cf.ThreadPoolExecutor(max_workers=NWORK) as ex:
            list(ex.map(lambda kv: run_case(work, *kv), CASES.items()))
    table()
