#!/usr/bin/env python3
"""rs660.py - 2026 Aprilia RS 660 (US MY2026 = Euro 5+ engine), completely stock exhaust: OpenWAM model, no-load runs at
the speeds in the owner's recording, sound synthesis from both outlets and comparison with the recording.

    python3 rs660.py calib     # per speed: three short runs at different manifold pressures -> p_map for zero brake torque
    python3 rs660.py run       # idle and the 5460 rpm hold at the calibrated manifold pressures (about 10 minutes)
    python3 rs660.py sound     # both outlets -> one microphone, order spectra, comparison tables, results.json
    python3 rs660.py all
    python3 rs660.py sweep     # header-length sensitivity at the hold (3 runs, about 13 minutes) -> sweep.json
  A model runs again only if its text changed or its last run did not finish; --rerun forces the runs, --no-run
  re-summarises the existing runs without running OpenWAM.

Sources and estimates: ../stock_exhaust_research.md (every sourced number carries its URL there). Here [src] = sourced
there, [est] = estimate, [page] = the calculator's generic default.

ENGINE
  parallel twin, 270 deg crank, 81 x 63.93 mm, 659 cc, CR 13.5 [src]; rated 77.2 kW @ 10,400, 70 Nm @ 8,400 [src]
  firing 1-2 at 270 deg, then 450 deg -> phases [0, 270] [src: 270 deg crankpin offset]
  rod 1.7 x stroke = 108.7 mm [page]
  4 valves/cyl DOHC: valve sizes, lift and cam timing are NOT published [src: research sec. 1.1]. Estimates for an 81 mm
    bore road sport twin: 2 x 32.4 mm intake (0.40 B), lift 9.5 mm; 2 x 26.7 mm exhaust (0.33 B), lift 8.0 mm; cd 0.7;
    IVO 25 BTDC, IVC 55 ABDC, EVO 50 BBDC, EVC 20 ATDC [est]
  no-load: each intake runner (250 mm x 46 mm [est]; 52 mm throttle bodies [src]) opens into a reservoir held at
    manifold pressure p_map, calibrated at each speed so that NMEP = FMEP = 0.5 + 0.012 rpm/60 bar [page friction law]
    (the Outback model's method; a fixed-pressure plenum is stable where a throttle orifice was a knife edge)
  combustion no-load: Wiebe start 12 BTDC, 65 deg, AFR 14.6, efficiency 0.72 [page / Outback no-load values, est]

EXHAUST - every dimension is an ESTIMATE (research sec. 4: nothing dimensional is published for the stock system)
  two stainless primaries [src: separate headers], 35.5 mm ID at the flange (36 mm gasket seat [src]) for 225 mm, then
    a step to 48 mm ID [est: Austin Racing's 51-55 mm slip clamps on the cut stock secondaries]; total 575 mm for
    cylinder 1 and 625 mm for cylinder 2 (visibly unequal in the photos, 30-80 mm [est])
  short Y into the underbelly box [src]: 58 mm ID x 100 mm [est, between Arrow's 54 and Max Torque Cans' 60 mm]
  catalyst: single-bed TWC [src: EPA]; here a straight 85 mm pipe 115 mm long (Akrapovic's Euro 5 replacement cats for
    this engine are 82-83 x 120 mm [src]) - LIMITATION as in the Outback model: no channel friction or damping
  silencer box: 10 L [est, photo scaling 8-12 L] as one expansion volume (internals unknown)
  outlets: TWO, one each side [the owner: "comes out both sides of the bike, slightly off straight out"], 40 mm ID x 120 mm
    [est: Akrapovic's replacement has a 40 mm outlet]
  wall temperatures (steady no-load, est): primaries 600 K, Y 550 K, cat 300 C, box outlets 150 C
TO MEASURE: research sec. 6 (header IDs/lengths per cylinder and the step position, Y, cat brick, box volume and
  internals, outlet count/ID/length), and the mic position relative to each outlet.

ACOUSTICS: microphone on the ground about 3 ft behind and 1.5 ft right [the owner]; outlets taken 0.15 m either side of the
  centre line, pointing back: right outlet r = 0.96 m at 19 deg off its axis, left outlet r = 1.10 m at 34 deg. Each
  outlet is a compact monopole (wam_sound.py), the two summed coherently with the path difference (synthesize_multi),
  ground plane +6 dB. Orders below 60 Hz are not compared (phone-class microphone roll-off).
"""
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "sound"))
sys.path.insert(0, os.path.join(REPO, "openwam"))
import make_wam       # noqa: E402
import run_models     # noqa: E402
import wam_sound      # noqa: E402
import order_compare  # noqa: E402

EXE = os.environ.get("OPENWAM_EXE") or run_models.EXE
B, S = 0.081, 0.06393
VD_CYL = math.pi / 4 * B * B * S
POINTS = [("idle_1442", 1442.0, "idle_after"), ("hold_5460", 5460.0, "hold_5400")]
EXTRA_KEYS = {"idle_1442": ["idle_warm", "idle_start"]}       # same idle, other segments of the recording
CAL_P = [0.25, 0.40, 0.55]
REC_JSON = os.path.join(HERE, "..", "recording_orders.json")
SOURCES = [{"name": "right outlet", "r": 0.96, "theta_deg": 19.0}, {"name": "left outlet", "r": 1.10, "theta_deg": 34.0}]
F_MIN_HZ = 60.0


def fmep_bar(rpm):
    return make_wam.DEFAULTS["fmep_c0"] + make_wam.DEFAULTS["fmep_c1"] * rpm / 60.0


def build_spec(p_map_bar):
    dIn, dEx = 0.40 * B, 0.33 * B
    e = {"bore": B, "stroke": S, "rod": 1.7 * S, "cr": 13.5, "cd": 0.7, "nIn": 2, "dIn": dIn, "liftIn": 0.0095,
         "nEx": 2, "dEx": dEx, "liftEx": 0.0080, "cam": {"ivo": 25, "ivc": 55, "evo": 50, "evc": 20},
         "burn": {"start": 12, "dur": 65}, "afr": 14.6, "eta": 0.72}
    intake = {"segs": [{"L": 0.25, "d0": 0.046, "d1": 0.046}], "Tw": 320, "reservoir": {"p_bar": p_map_bar}}
    prim = lambda L2: [{"L": 0.225, "d0": 0.0355, "d1": 0.0355, "primary": True}, {"L": L2, "d0": 0.048, "d1": 0.048}]
    return {
        "e": e,
        "intake": intake,
        "exhaust": {"segs": prim(0.35), "per_cyl": [prim(0.35), prim(0.40)], "Tw": 600, "chambers": []},
        "opt": {
            "phases": [0, 270],
            "collectors": [{
                "cyls": [0, 1],
                "segs": [{"L": 0.10, "d0": 0.058, "d1": 0.058}],
                "Tw": 550,
                "tail": [
                    {"L_mm": 115, "d0_mm": 85, "d1_mm": 85, "Tw_C": 300, "note": "catalyst as a straight pipe [limitation]"},
                    {"V_litres": 10.0, "note": "underbelly silencer box [est]"},
                    {"outlets": [[{"L_mm": 120, "d0_mm": 40, "d1_mm": 40, "Tw_C": 150}],
                                 [{"L_mm": 120, "d0_mm": 40, "d1_mm": 40, "Tw_C": 150}]]},
                ]}]},
        "n": 2,
    }


def run_settings(rpm, cycles, name):
    # INS rows at 64 kHz: against rows at every solver step the order levels agree within 0.4 dB up to order 12
    # (at 16 kHz orders 10-12 were up to 2.5 dB off at 5460 rpm)
    return {"rpm": float(rpm), "cycles": int(cycles), "name": name, "cell_mm": 10.0, "ins_outlet": 1, "ins_cycles": 2,
            "out_step_deg": make_wam.out_step_for_rate(rpm, 64000.0)}


def run_one(name, spec, run, argv=()):
    """--rerun: run even if the folder holds finished results of this model; --no-run: never run, re-summarise what
    is there. Otherwise OpenWAM runs when the model text changed or the last run did not finish."""
    folder = os.path.join(HERE, "runs", name)
    os.makedirs(folder, exist_ok=True)
    model = make_wam.model_from_spec(spec, run)
    run_models.write_and_run(folder, name, model, exe=EXE, rerun="--rerun" in argv, allow_run="--no-run" not in argv)
    with open(os.path.join(folder, "spec.json"), "w") as f:
        json.dump(spec, f, indent=1)
    with open(os.path.join(folder, "run.json"), "w") as f:
        json.dump({k: v for k, v in run.items() if k != "name"}, f, indent=1)
    return folder, model, run_models.summarise(folder, name, model)


def box_settling(s):
    """The silencer box (plenum 1) over the last 10 cycles: relative change of its gas density per cycle, and of
    its temperature in K. OpenWAM's pipe-station mean flows are no measure of settling (run_models docstring)."""
    q = s["plenum_settling"][0]
    return {"density_change_per_cycle": q["density_change_per_cycle"], "T_change_K": q["T_change_K"], "cycles": q["cycles"]}


def calib(argv):
    jobs = []
    for name, rpm, _ in POINTS:
        for pm in CAL_P:
            nm = "cal_%s_%g" % (name, pm)
            jobs.append((name, rpm, pm, nm, build_spec(pm), run_settings(rpm, 14, nm)))
    with ThreadPoolExecutor(max_workers=2) as ex:
        res = list(ex.map(lambda j: run_one(j[3], j[4], j[5], argv), jobs))
    out = {}
    for name, rpm, _ in POINTS:
        pts = []
        for j, (folder, model, s) in zip(jobs, res):
            if j[0] != name:
                continue
            L = s["last"]
            print("%s p_map %.2f bar: finished %s NMEP %.3f IMEP %.3f PMEP %.3f bar" % (name, j[2], s["finished"], L["NMEP"], L["IMEP"], L["PMEP"]))
            pts.append((j[2], L["NMEP"]))
        x = np.array([q[0] for q in pts]); y = np.array([q[1] for q in pts])
        b_, a_ = np.polyfit(x, y, 1)
        target = fmep_bar(rpm)
        out[name] = {"rpm": rpm, "points": pts, "fit_NMEP_bar": {"a": float(a_), "b_per_bar": float(b_)}, "fmep_target_bar": target,
                     "p_map_bar": float((target - a_) / b_)}
        print("%s: NMEP = %.3f + %.3f p_map -> NMEP = FMEP %.3f bar at p_map %.3f bar" % (name, a_, b_, target, out[name]["p_map_bar"]))
    with open(os.path.join(HERE, "calibration.json"), "w") as f:
        json.dump(out, f, indent=1)


def run(argv):
    with open(os.path.join(HERE, "calibration.json")) as f:
        cal = json.load(f)
    # 48 / 72 cycles: the 10 L box fills and cools slowly (box_settling); NMEP settles sooner
    jobs =[(name, build_spec(cal[name]["p_map_bar"]), run_settings(rpm, 48 if rpm < 3000 else 72, name)) for name, rpm, _ in POINTS]
    with ThreadPoolExecutor(max_workers=2) as ex:
        res = list(ex.map(lambda j: run_one(j[0], j[1], j[2], argv), jobs))
    rows = []
    for (name, spec, rs), (folder, model, s) in zip(jobs, res):
        L = s["last"]
        rpm = rs["rpm"]
        tq = (L["NMEP"] - fmep_bar(rpm)) * 1e5 * 2 * VD_CYL / (4 * math.pi)
        r = {"name": name, "rpm": rpm, "finished": s["finished"], "warnings": len(s["warning_or_error_lines"]), "NMEP": L["NMEP"],
             "FMEP": fmep_bar(rpm), "T_brake_Nm": tq, "p_map_bar": cal[name]["p_map_bar"], "VE_delivered": L["VE_delivered"],
             "conv_NMEP_last_change": s["convergence"]["NMEP"]["last_change"], "box_settling": box_settling(s),
             "cycles": rs["cycles"]}
        rows.append(r)
        b = r["box_settling"]
        print("%-10s %5.0f rpm fin %s warn %d | NMEP %6.3f FMEP %5.3f -> T_brake %5.1f Nm | p_map %.3f bar VE %.3f | dNMEP %.1e | box %+.3f %%/cycle, %+.1f K over the last %d cycles" %
              (name, rpm, s["finished"], r["warnings"], r["NMEP"], r["FMEP"], tq, r["p_map_bar"], r["VE_delivered"], r["conv_NMEP_last_change"],
               100 * b["density_change_per_cycle"], b["T_change_K"], b["cycles"]))
    with open(os.path.join(HERE, "runs_summary.json"), "w") as f:
        json.dump(rows, f, indent=1)


def sound(argv):
    os.makedirs(os.path.join(HERE, "sound"), exist_ok=True)
    with open(REC_JSON) as f:
        rec = json.load(f)
    results = {"receiver": "microphone on the ground ~3 ft behind, 1.5 ft right: both outlets summed coherently, ground plane +6 dB",
               "sources": SOURCES, "cases": []}
    for name, rpm, key in POINTS:
        folder = os.path.join(HERE, "runs", name)
        with open(os.path.join(folder, "spec.json")) as f:
            spec = json.load(f)
        with open(os.path.join(folder, "run.json")) as f:
            rs = json.load(f)
        model = make_wam.model_from_spec(spec, dict(rs, name=name))
        txt = open(os.path.join(folder, name + "INS.DAT")).read()
        first = make_wam.read_ins(txt, keep_cycles=2, model=model)
        outs = first["outlets"]
        if len(outs) != 2:
            raise RuntimeError("expected two outlets in the INS output, got %s" % outs)
        srcs = []
        for pipe, sc in zip(outs, SOURCES):
            ins = make_wam.read_ins(txt, pipe=pipe, keep_cycles=2, model=model)
            srcs.append({"ins": ins, "r": sc["r"], "theta_deg": sc["theta_deg"], "d_tip_m": model["pipes"][pipe - 1]["secs"][-1][1]})
        res = wam_sound.synthesize_multi(srcs, rpm, ground=True, orders_max=12)
        base = os.path.join(HERE, "sound", name)
        pa_fs = wam_sound.write_wav(base + ".wav", res["signal"], res["fs"])
        out = {k: v for k, v in res.items() if k not in ("signal", "p_cycle")}
        out.update({"rpm": rpm, "pa_per_fullscale": pa_fs})
        with open(base + "_orders.json", "w") as f:
            json.dump(out, f, indent=1)
        orders = np.array(res["orders"])
        case = {"name": name, "rpm": rpm, "overall_spl_dB": res["overall_spl_dB"], "overall_spl_dBA": res["overall_spl_dBA"],
                "strongest_order": res["strongest_order"], "periodicity": res["periodicity_rms"], "orders": res["orders"],
                "model_dB_rel": res["dB_rel"], "per_outlet": res["sources"], "compare": {}}
        print("=" * 100)
        print("%s: %.0f rpm, overall %.1f dB SPL (%.1f dBA), strongest order %.1f, periodicity %.3f; outlets %s" %
              (name, rpm, res["overall_spl_dB"], res["overall_spl_dBA"], res["strongest_order"], res["periodicity_rms"] or float("nan"),
               ", ".join("%.4f kg/s %.1f dB" % (x["mdot_mean_kg_s"], x["overall_spl_dB"]) for x in res["sources"])))
        min_order = max(0.5, math.ceil(2 * F_MIN_HZ / (rpm / 60.0)) / 2.0)
        for k in [key] + EXTRA_KEYS.get(name, []):
            ent = rec.get(k)
            if not ent:
                continue
            lev = ent["orders_dB_rel"]
            meas = np.array([lev.get("%.1f" % o, np.nan) for o in orders], float)
            cmp_ = order_compare.compare(meas, np.array(res["spl_dB"]), orders, min_order=min_order, max_order=7.0)
            order_compare.print_table(cmp_, rpm, "%s vs recording '%s' (t %s s, %s rpm), orders %.1f-7" % (name, k, ent.get("t"), ent.get("rpm"), min_order))
            half = [o for o in (1.5, 2.5, 3.5, 4.5, 5.5) if o >= min_order]
            print("half orders (270-degree firing), recording / model dB rel: " + "  ".join(
                "%.1f: %+.1f / %+.1f" % (o, cmp_["measured_dB_rel"][list(orders).index(o)], cmp_["model_dB_rel"][list(orders).index(o)]) for o in half))
            case["compare"][k] = cmp_
        results["cases"].append(case)
    # level from idle to the hold, fixed gain in the recording
    if len(results["cases"]) == 2:
        dm = results["cases"][1]["overall_spl_dB"] - results["cases"][0]["overall_spl_dB"]
        dr = rec["hold_5400"]["rms_dBFS"] - rec["idle_after"]["rms_dBFS"]
        results["level_change_idle_to_hold"] = {"model_dB": dm, "recording_dB": dr}
        print("Level change idle -> 5460 rpm hold: model %+.1f dB, recording %+.1f dB (fixed gain, rms of the clip segments)" % (dm, dr))
    with open(os.path.join(HERE, "results.json"), "w") as f:
        json.dump(results, f, indent=1)


def sweep(argv):
    """Header-length sensitivity at the 5460 rpm hold, run with the same settings as the main runs (64 kHz rows,
    72 cycles): both headers' second sections moved together by -50, +50 and +100 mm, everything else unchanged.
    Writes sweep.json and prints the table NOTES.md quotes (RMS against the recording over orders 1-7, and the
    relative levels of orders 1-3)."""
    with open(os.path.join(HERE, "calibration.json")) as f:
        cal = json.load(f)
    with open(REC_JSON) as f:
        rec = json.load(f)
    name0, rpm, key = POINTS[1]
    jobs = []
    for d_mm in (-50, 50, 100):
        spec = build_spec(cal[name0]["p_map_bar"])
        for pc in spec["exhaust"]["per_cyl"]:
            pc[1]["L"] += d_mm / 1000.0
        spec["exhaust"]["segs"][1]["L"] += d_mm / 1000.0
        nm = "len%+d_%d" % (d_mm, rpm)
        jobs.append((nm, spec, run_settings(rpm, 72, nm), d_mm))
    with ThreadPoolExecutor(max_workers=2) as ex:
        res = list(ex.map(lambda j: run_one(j[0], j[1], j[2], argv), jobs))
    lev = rec[key]["orders_dB_rel"]
    rows = []
    for (nm, spec, rs, d_mm), (folder, model, s) in zip(jobs, res):
        txt = open(os.path.join(folder, nm + "INS.DAT")).read()
        outs = make_wam.read_ins(txt, keep_cycles=2, model=model)["outlets"]
        srcs = []
        for pipe, sc in zip(outs, SOURCES):
            ins = make_wam.read_ins(txt, pipe=pipe, keep_cycles=2, model=model)
            srcs.append({"ins": ins, "r": sc["r"], "theta_deg": sc["theta_deg"], "d_tip_m": model["pipes"][pipe - 1]["secs"][-1][1]})
        r = wam_sound.synthesize_multi(srcs, rpm, ground=True, orders_max=12)
        orders = np.array(r["orders"])
        meas = np.array([lev.get("%.1f" % o, np.nan) for o in orders], float)
        min_order = max(0.5, math.ceil(2 * F_MIN_HZ / (rpm / 60.0)) / 2.0)
        cmp_ = order_compare.compare(meas, np.array(r["spl_dB"]), orders, min_order=min_order, max_order=7.0)
        rel = {("%.1f" % o): r["dB_rel"][list(orders).index(o)] for o in (1.0, 1.5, 2.0, 2.5, 3.0)}
        row = {"header_change_mm": d_mm, "rms_dB": cmp_["rms_delta_dB"], "model_dB_rel": rel, "finished": s["finished"],
               "warnings": len(s["warning_or_error_lines"]), "conv_NMEP_last_change": s["convergence"]["NMEP"]["last_change"],
               "box_settling": box_settling(s), "periodicity": r["periodicity_rms"], "cycles": rs["cycles"]}
        rows.append(row)
        b = row["box_settling"]
        print("%+4d mm: RMS %.1f dB | orders 1 %.1f  1.5 %.1f  2 %.1f  2.5 %.1f  3 %.1f | finished %s, dNMEP %.1e, box %+.3f %%/cycle %+.1f K, periodicity %.3f" % (
            d_mm, row["rms_dB"], rel["1.0"], rel["1.5"], rel["2.0"], rel["2.5"], rel["3.0"], s["finished"], row["conv_NMEP_last_change"],
            100 * b["density_change_per_cycle"], b["T_change_K"], r["periodicity_rms"] or float("nan")))
    with open(os.path.join(HERE, "sweep.json"), "w") as f:
        json.dump(rows, f, indent=1)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in ("calib", "all"):
        calib(sys.argv)
    if mode in ("run", "all"):
        run(sys.argv)
    if mode in ("sound", "all"):
        sound(sys.argv)
    if mode == "sweep":
        sweep(sys.argv)
