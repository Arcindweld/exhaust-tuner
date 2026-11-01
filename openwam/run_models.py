#!/usr/bin/env python3
"""run_models.py - write, run and check OpenWAM models built by make_wam.py.

    python3 run_models.py i4_41@4000 i4_41@6000 v8_dual@5500 ...   [cycles=30] [jobs=2] [key=value ...]

Each model runs in its own folder runs/<case>_<rpm>[_tag]/ (OpenWAM writes tmp.wam into the current
directory, TOpenWAM.cpp:355). After the run the script checks the log and the AVG file and writes
runs/<folder>/summary.json:
  - the log ends with SIMULATION FINISHED CORRECTLY and has no line with WARNING or ERROR
  - "Sonic condition in boundary" lines (TCCRamificacion.cpp:285/305 printf) are counted per cycle
  - the last cycle's results are finite (a diverged run can still end with SIMULATION FINISHED CORRECTLY)
  - convergence: change of NMEP, IMEP, intake mass and trapped fresh air over the last cycles
  - settling of each plenum (a muffler box fills and heats slowly): change of its gas density p/T per cycle
    and of its temperature over the last 10 cycles ("plenum_settling")
  - mass: per cylinder, exhaust mass = intake mass + fuel (valve fluxes integrated by OpenWAM over the
    cycle); and "mass_balance_pipes", the ratio of the outlet pipes' mean flows to the intake runners' plus
    the fuel. That ratio is NOT a mass balance and says nothing about settling: OpenWAM's characteristic
    boundary conditions do not conserve mass at closed valves and open ends. Measured on the RS 660 model
    (validation/rs660-2026, TVD, 10 mm cells): next to a closed intake valve the runner gas drifts into the
    valve at 1.2 m/s (5460 rpm, 0.31 bar) and 3.6 m/s (1442 rpm, 0.26 bar) without ever reversing, and next to
    a closed exhaust valve it drifts out at 0.9 m/s on average (5460 rpm). While a valve is open, the pipe
    flow next to it matches the valve flow within 2 % at 5460 rpm, but at 1442 rpm the runner carries twice
    the intake valve's flow even then. The boundary node is reset by the boundary condition every step, so
    what flows into it from the pipe is lost (or, flowing out, created). So the runners' station means read
    11 % above the cylinders' intake at 5460 rpm and 3.7-3.8 times it at 1442 rpm, the primaries' 5-8 %
    (5460 rpm) and 13-16 % (1442 rpm) above the exhaust valve flow, and the outlets' open-end node 19 % below
    the middle of the same pipe (5460 rpm, 72 cycles). 5 mm cells move these by
    several points either way, so they do not vanish with the grid. The cylinders' own masses (VE, trapped
    mass, NMEP) are consistent and are the ones to use.
"""
import json
import math
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import cases            # noqa: E402
import make_wam         # noqa: E402

# OpenWAM 2.2 solver: EXHAUST_TUNER_OPENWAM (the same variable the program and its tests use), else a build of CMT-UPV's
# source next to the repository (ext/OpenWAM/build, see openwam/README)
EXE = os.environ.get("EXHAUST_TUNER_OPENWAM") or os.path.abspath(os.path.join(HERE, "..", "ext", "OpenWAM", "build", "bin", "release", "OpenWAM"))
R_AIR = 287.0           # Constantes.h:69 __R::Air, also the calculator's RG (exhaust-calculator.html:3767)


def read_avg(path):
    with open(path) as f:
        rows = [ln.rstrip("\n").split("\t") for ln in f if ln.strip()]
    head = rows[0]
    return head, [[float(x) for x in r] for r in rows[1:]]


def write_and_run(folder, name, model, exe=None, rerun=False, allow_run=True):
    """Write <folder>/<name>.wam and run OpenWAM on it, unless the folder already holds the finished results of
    exactly this model text (then nothing is written or run). A changed model, or a run that did not finish (killed
    or crashed), runs again: results of another text are never summarised as this one.
    allow_run=False never runs: it keeps whatever results of this text exist, finished or not (to re-summarise
    after a change to the summary code), and raises if there are none. Returns True if OpenWAM ran."""
    text = make_wam.write_model(model)
    path = os.path.join(folder, name + ".wam")
    old = None
    if os.path.exists(path):
        with open(path, newline="") as f:
            old = f.read()
    have = os.path.exists(os.path.join(folder, name + "AVG.DAT"))
    done = False
    if have and os.path.exists(os.path.join(folder, "run.log")):
        with open(os.path.join(folder, "run.log"), errors="replace") as f:
            done = "SIMULATION FINISHED CORRECTLY" in f.read()
    if not rerun and old == text and have and (done or not allow_run):
        return False
    if not allow_run:
        raise RuntimeError("%s: %s holds no results of this model text; run without --no-run" % (name, folder))
    with open(path, "w", newline="\n") as f:
        f.write(text)
    for fn in (name + "AVG.DAT", name + "INS.DAT"):       # a failed run must not leave the previous results behind
        if os.path.exists(os.path.join(folder, fn)):
            os.remove(os.path.join(folder, fn))
    with open(os.path.join(folder, "run.log"), "w") as lf:
        subprocess.run([exe or EXE, name + ".wam"], cwd=folder, stdout=lf, stderr=subprocess.STDOUT, check=False)
    return True


def plenum_settling(head, data, last=10):
    """Per plenum (AVG.DAT columns Pressure_plenum_k / Temperature_plenum_k): relative change of the gas density
    p/T per cycle and change of the temperature over the last `last` cycles (fewer if the run is shorter)."""
    ix = {h: i for i, h in enumerate(head)}
    out = []
    k = 1
    while ("Pressure_plenum_%d(bar)" % k) in ix and ("Temperature_plenum_%d(degC)" % k) in ix:
        n = min(last, len(data) - 1)
        if n >= 1:
            p = [r[ix["Pressure_plenum_%d(bar)" % k]] for r in data]
            T = [r[ix["Temperature_plenum_%d(degC)" % k]] + 273.15 for r in data]
            rho1, rho0 = p[-1] / T[-1], p[-1 - n] / T[-1 - n]
            out.append({"plenum": k, "cycles": n, "density_change_per_cycle": (rho1 - rho0) / rho1 / n,
                        "T_change_K": T[-1] - T[-1 - n], "p_bar": p[-1], "T_K": T[-1]})
        k += 1
    return out


def summarise(folder, name, model):
    log = open(os.path.join(folder, "run.log"), errors="replace").read().splitlines()
    finished = any("SIMULATION FINISHED CORRECTLY" in ln for ln in log)
    bad = [ln for ln in log if "WARNING" in ln.upper() or "ERROR" in ln.upper()]
    sonic, cyc, last_sonic_cycle = 0, 0, 0
    for ln in log:
        if "Cylinder number 1 Cycle number" in ln:
            cyc = int(ln.split()[-1])
        if ln.startswith("Sonic condition"):
            sonic += 1
            last_sonic_cycle = max(last_sonic_cycle, cyc)
    head, data = read_avg(os.path.join(folder, name + "AVG.DAT"))
    ix = {h: i for i, h in enumerate(head)}
    p = model["p"]
    ncyl = len(model["phases"])
    d = make_wam.engine_derived(p)
    rho = p["p_amb_bar"] * 1e5 / (R_AIR * (p["T_amb_C"] + 273.15))
    Vd = d["Vd"]
    n_s = p["rpm"] / 120.0                       # cycles per second

    def row_metrics(r):
        g = lambda k: r[ix[k]]
        out = {"cycle": int(g("Cycle(-)")), "NMEP": g("NMEP_Cycle(bar)"), "IMEP": g("IMEP_Cycle(bar)"),
               "PMEP": -g("PMEP_Cycle(bar)"), "BMEP": g("BMEP_Cycle(bar)"), "Net_Torque": g("Net_Torque(Nm)"),
               "fuel": g("Fuel_Mass(kg/cc)"), "intake": g("Intake_Mass(kg/cc)"), "trapped": g("Trapped_Mass(kg/cc)")}
        out["T_net_from_NMEP"] = out["NMEP"] * 1e5 * Vd * ncyl / (4.0 * math.pi)
        out["P_net_kW"] = out["T_net_from_NMEP"] * 2.0 * math.pi * p["rpm"] / 60.0 / 1000.0
        out["VE_delivered"] = out["intake"] / (rho * Vd)
        out["VE_trapped_fresh"] = p["afr"] * out["fuel"] / (rho * Vd)
        cyl = []
        for c in range(1, ncyl + 1):
            im = g("Intake_Mass_Cyl_%d(kg/cc)" % c)
            em = -g("Exhaust_Mass_Cyl_%d(kg/cc)" % c)
            cyl.append({"cyl": c, "NMEP": g("NMEP_Cyl_%d(bar)" % c), "IMEP": g("IMEP_Cyl_%d(bar)" % c),
                        "VE_delivered": im / (rho * Vd), "intake": im, "exhaust": em,
                        "trapped": g("Trapped_Mass_Cyl_%d(kg)" % c)})
        out["cyl"] = cyl
        # per cylinder: exhaust = intake + fuel; OpenWAM's Fuel_Mass is the mean over the cylinders
        out["mass_cyl_in_plus_fuel_kg_s"] = (sum(c["intake"] for c in cyl) + ncyl * out["fuel"]) * n_s
        out["mass_cyl_exhaust_kg_s"] = sum(c["exhaust"] for c in cyl) * n_s
        # pipes: intake runners (their left end is an open end) and outlets (right end open, exhaust side)
        fin, fout = 0.0, 0.0
        for i, pp in enumerate(model["pipes"]):
            cols = [k for k in head if k.startswith("F_duct_%d_at_" % (i + 1))]
            if not cols:
                continue
            mid = cols[len(cols) // 2]
            if model["bcs"][pp["left"]]["type"] in ("open", "reservoir") and pp["ht"] == 1:
                fin += r[ix[mid]]
            if model["bcs"][pp["right"]]["type"] == "open" and pp["ht"] == 2:
                fout += r[ix[mid]]
        out["pipe_intake_kg_s"] = fin
        out["pipe_outlet_kg_s"] = fout
        out["pipe_fuel_kg_s"] = ncyl * out["fuel"] * n_s
        return out

    rows = [row_metrics(r) for r in data]
    last = rows[-1]
    finite = all(math.isfinite(x) for x in data[-1])
    conv = {}
    for k in ("NMEP", "IMEP", "VE_delivered", "VE_trapped_fresh"):
        tail = [r[k] for r in rows[-5:]]
        conv[k] = {"last_change": abs(rows[-1][k] - rows[-2][k]) / abs(rows[-1][k]),
                   "spread_last5": (max(tail) - min(tail)) / abs(rows[-1][k])}
    s = {"name": name, "rpm": p["rpm"], "cycles": int(p["cycles"]), "finished": finished and finite,
         "log_finished": finished, "results_finite": finite,
         "warning_or_error_lines": bad, "sonic_messages": sonic, "last_cycle_with_sonic": last_sonic_cycle,
         "last": last, "convergence": conv, "plenum_settling": plenum_settling(head, data),
         "mass_balance_cyl": last["mass_cyl_exhaust_kg_s"] / last["mass_cyl_in_plus_fuel_kg_s"] - 1.0,
         "mass_balance_pipes": last["pipe_outlet_kg_s"] / (last["pipe_intake_kg_s"] + last["pipe_fuel_kg_s"]) - 1.0,
         "rho_ref": rho, "Vd_cyl": Vd, "ncyl": ncyl, "history": [{k: r[k] for k in ("cycle", "NMEP", "VE_trapped_fresh")} for r in rows]}
    with open(os.path.join(folder, "summary.json"), "w") as f:
        json.dump(s, f, indent=1)
    return s


def run_case(case, rpm, over, tag=""):
    name = "%s_%d%s" % (case, rpm, tag)
    folder = os.path.join(HERE, "runs", name)
    os.makedirs(folder, exist_ok=True)
    run = dict(over, rpm=float(rpm), name=name)
    spec = cases.ALL[case]()
    model = make_wam.model_from_spec(spec, run)
    write_and_run(folder, name, model, rerun=True)
    return summarise(folder, name, model)


def fmt(s):
    L = s["last"]
    c = s["convergence"]
    box = "".join(" | plenum %d %+.2f %%/cycle %+.1f K" % (q["plenum"], 100 * q["density_change_per_cycle"], q["T_change_K"])
                  for q in s.get("plenum_settling", []))
    return ("%-24s fin=%s warn/err=%d sonic=%d(last cyc %d) | NMEP %.3f IMEP %.3f PMEP %.3f bar | T_net %.1f Nm | "
            "VEdel %.4f VEtrap %.4f | dNMEP %.1e spread5 %.1e | mass cyl %+.2e, station flow ratio %+.2e%s" %
            (s["name"], s["finished"], len(s["warning_or_error_lines"]), s["sonic_messages"], s["last_cycle_with_sonic"],
             L["NMEP"], L["IMEP"], L["PMEP"], L["T_net_from_NMEP"], L["VE_delivered"], L["VE_trapped_fresh"],
             c["NMEP"]["last_change"], c["NMEP"]["spread_last5"], s["mass_balance_cyl"], s["mass_balance_pipes"], box))


def main(argv):
    jobs, over, todo, tag = 2, {"cycles": 30}, [], ""
    for a in argv[1:]:
        if "=" in a:
            k, v = a.split("=", 1)
            if k == "jobs":
                jobs = int(v)
            elif k == "tag":
                tag = v
            else:
                ref = dict(make_wam.DEFAULTS, **make_wam.EXTRA_DEFAULTS)[k]
                over[k] = make_wam._parse_value(k, v, ref)
        else:
            c, r = a.split("@")
            todo.append((c, int(r)))
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        res = list(ex.map(lambda cr: run_case(cr[0], cr[1], over, tag), todo))
    for s in res:
        print(fmt(s))


if __name__ == "__main__":
    main(sys.argv)
