#!/usr/bin/env python3
"""tail_test.py - validation of the downstream chain + expansion-volume muffler (make_wam.py v3).

    python3 tail_test.py [jobs=2] [cycles=12] [rpm=3000]

Builds the i4_41 spec with a tail (1 m of 60 mm pipe, a plenum, 0.5 m of 60 mm tailpipe) for three plenum
volumes (2, 7.2 and 20 litres), runs them with OpenWAM (runs/tail_V<litres>_<rpm>/) and reports:
  * plenum mass conservation from INS.DAT, last complete cycle: the plenum's mass change m(end) - m(start)
    against the integral of (mass flow in at the inlet port - mass flow out at the outlet port) dt, both
    written by OpenWAM; the residual is given relative to the mass that passed through in the cycle
  * mass balance from AVG.DAT: mean mass flow through the tailpipe (F_duct of the last pipe) against the
    sum of the intake runners' mean flows plus the fuel, last cycle (run_models.summarise). NOTE: this
    measure is +2..3% (up to +10% at 4000 rpm) on every pre-existing run WITHOUT a tail (runs/*/summary.json),
    so it is reported and compared with the no-tail i4_41 at the same speed rather than tested against zero.
    The offset is OpenWAM's: its closed-valve and open-end boundary conditions do not conserve mass, so the
    pipes' mean flows are not a mass balance (measurements in the run_models.py docstring). The plenum check
    above is the conservative one: a plenum's own mass change against its port flows. A plenum that is
    still heating up (started cold) also loses stored mass every cycle, and that shows here too.
  * the plenum is in the path: INS.DAT pressure traces of the plenum and of the outlet node change
    with the volume (peak-to-peak of the plenum pressure must FALL as the volume grows, the muffler
    acting as a compliance), and the plenum mass is of the order rho*V.
Exit code 1 if any check fails.
"""
import json
import math
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_wam         # noqa: E402
import run_models       # noqa: E402

VOLS = [2.0, 7.2, 20.0]


def tail_spec(V_l):
    with open(os.path.join(HERE, "specs", "i4_41.json")) as f:
        s = json.load(f)
    s["opt"]["collector"]["tail"] = [
        {"L_mm": 1000, "d0_mm": 60, "d1_mm": 60, "Tw_C": 350},
        {"V_litres": V_l},
        {"L_mm": 500, "d0_mm": 60, "d1_mm": 60, "Tw_C": 250},
    ]
    return s


def run_one(V_l, rpm, cycles):
    name = "tail_V%g_%d" % (V_l, rpm)
    folder = os.path.join(HERE, "runs", name)
    os.makedirs(folder, exist_ok=True)
    run = {"rpm": float(rpm), "cycles": cycles, "name": name, "ins_outlet": 1, "ins_cycles": 2,
           "out_step_deg": make_wam.out_step_for_rate(rpm, 20000.0)}
    model = make_wam.model_from_spec(tail_spec(V_l), run)
    with open(os.path.join(folder, name + ".wam"), "w", newline="\n") as f:
        f.write(make_wam.write_model(model))
    if not os.path.exists(os.path.join(folder, name + "INS.DAT")) or "--rerun" in sys.argv:
        with open(os.path.join(folder, "run.log"), "w") as lf:
            subprocess.run([run_models.EXE, name + ".wam"], cwd=folder, stdout=lf, stderr=subprocess.STDOUT, check=False)
    s = run_models.summarise(folder, name, model)
    with open(os.path.join(folder, name + "INS.DAT")) as f:
        ins = make_wam.read_ins(f.read(), keep_cycles=1, model=model)
    pl = ins["plenums"][1]
    # conservation over the last complete cycle: dm = integral (mdot_in - mdot_out) dt
    t = ins["time"]
    fin_, fout_ = ins["ports"][1]["in"]["mdot"], ins["ports"][1]["out"]["mdot"]
    integ = lambda y: sum(0.5 * (y[i] + y[i + 1]) * (t[i + 1] - t[i]) for i in range(len(t) - 1))
    m_in, m_out = integ(fin_), integ(fout_)
    dm = pl["m"][-1] - pl["m"][0]
    cons_res = (dm - (m_in - m_out)) / m_in
    plenum_T_rise = pl["T"][-1] - pl["T"][0]
    pp = lambda a: max(a) - min(a)
    rho_pl = sum(pl["m"]) / len(pl["m"]) / (V_l / 1000.0)
    T_pl = sum(pl["T"]) / len(pl["T"])
    p_pl = sum(pl["p"]) / len(pl["p"])
    return {"V_l": V_l, "name": name, "finished": s["finished"], "warn": len(s["warning_or_error_lines"]),
            "mass_balance_pipes": s["mass_balance_pipes"], "mass_balance_cyl": s["mass_balance_cyl"],
            "pipe_outlet_kg_s": s["last"]["pipe_outlet_kg_s"], "pipe_intake_kg_s": s["last"]["pipe_intake_kg_s"],
            "pipe_fuel_kg_s": s["last"]["pipe_fuel_kg_s"],
            "cycle_mass_in_kg": m_in, "cycle_mass_out_kg": m_out, "plenum_dm_kg": dm, "conservation_residual": cons_res,
            "plenum_T_rise_last_cycle_K": plenum_T_rise,
            "plenum_p_pp_Pa": pp(pl["p"]), "plenum_p_mean_Pa": p_pl, "plenum_T_mean_K": T_pl,
            "plenum_rho_from_mass": rho_pl, "plenum_rho_ideal": p_pl / (make_wam.R_BURNT * T_pl),
            "outlet_u_pp": pp(ins["u"]), "outlet_mdot_pp": pp(ins["mdot"]), "outlet_rows_per_cycle": len(ins["time"]),
            "NMEP": s["last"]["NMEP"]}


def main(argv):
    jobs, cycles, rpm = 2, 12, 3000
    for a in argv[1:]:
        if a.startswith("jobs="):
            jobs = int(a[5:])
        elif a.startswith("cycles="):
            cycles = int(a[7:])
        elif a.startswith("rpm="):
            rpm = int(a[4:])
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        res = list(ex.map(lambda V: run_one(V, rpm, cycles), VOLS))
    ok = True
    base = os.path.join(HERE, "runs", "i4_41_%d" % rpm, "summary.json")
    base_mb = json.load(open(base))["mass_balance_pipes"] if os.path.exists(base) else None
    print("%-16s %5s %5s %12s %12s %10s %12s %10s %10s %9s %8s" % ("case", "fin", "warn", "plenum cons.", "AVG mass", "mass cyl", "plenum p-p Pa",
                                                                      "rho m/V", "rho p/RT", "u p-p", "NMEP"))
    for r in res:
        print("%-16s %5s %5d %+12.2e %+12.2e %+10.2e %12.0f %10.4f %10.4f %9.1f %8.3f" %
              (r["name"], r["finished"], r["warn"], r["conservation_residual"], r["mass_balance_pipes"], r["mass_balance_cyl"], r["plenum_p_pp_Pa"],
               r["plenum_rho_from_mass"], r["plenum_rho_ideal"], r["outlet_u_pp"], r["NMEP"]))
        print("  last cycle: in %.5f g, out %.5f g, plenum dm %+.5f g, T rise %+.2f K" %
              (1e3 * r["cycle_mass_in_kg"], 1e3 * r["cycle_mass_out_kg"], 1e3 * r["plenum_dm_kg"], r["plenum_T_rise_last_cycle_K"]))
        if not r["finished"] or r["warn"]:
            ok = False
            print("  FAIL: run did not finish cleanly")
        if abs(r["conservation_residual"]) > 0.01:
            ok = False
            print("  FAIL: plenum mass change differs from integral(in - out) by %.2f%% of the through-flow" % (100 * r["conservation_residual"]))
        if abs(r["mass_balance_pipes"]) > 0.10:
            ok = False
            print("  FAIL: AVG tailpipe mean flow differs from intake + fuel by %.1f%%" % (100 * r["mass_balance_pipes"]))
    if base_mb is not None:
        print("AVG pipe mass measure of the no-tail i4_41 at %d rpm for reference: %+.2e" % (rpm, base_mb))
        if abs(r["plenum_rho_from_mass"] / r["plenum_rho_ideal"] - 1.0) > 0.05:
            ok = False
            print("  FAIL: plenum mass is not rho*V")
    pps = [r["plenum_p_pp_Pa"] for r in res]
    if not all(pps[i] > pps[i + 1] for i in range(len(pps) - 1)):
        ok = False
        print("FAIL: plenum pressure swing does not fall with volume: %s" % pps)
    ups = [r["outlet_u_pp"] for r in res]
    if len(set(round(u, 3) for u in ups)) != len(ups):
        ok = False
        print("FAIL: outlet velocity trace does not change with the plenum volume")
    print("plenum peak-to-peak pressure vs volume: " + ", ".join("%g L: %.0f Pa" % (r["V_l"], r["plenum_p_pp_Pa"]) for r in res))
    print("outlet peak-to-peak velocity vs volume: " + ", ".join("%g L: %.1f m/s" % (r["V_l"], r["outlet_u_pp"]) for r in res))
    with open(os.path.join(HERE, "runs", "tail_test_result.json"), "w") as f:
        json.dump(res, f, indent=1)
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
