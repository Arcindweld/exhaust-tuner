#!/usr/bin/env python3
"""outback04.py - 2004 Subaru Outback 2.5i (EJ251) exhaust: OpenWAM model, no-load runs at the recorded speeds,
WOT torque sanity sweep, sound synthesis and comparison with the owner's recordings.

    python3 outback04.py calib            # throttle orifice calibration at 1980 rpm (two short runs)
    python3 outback04.py run              # the no-load points + the WOT sweep, 2 at a time (long: the 735 rpm idle
                                          # alone took over 2 hours at 28 cycles)
    python3 outback04.py sound            # WAVs + order spectra + comparison tables (fast, needs run)
    python3 outback04.py all
  A model runs again only if its text changed or its last run did not finish; --rerun forces the runs, --no-run
  re-summarises the existing runs without running OpenWAM.

Everything lives in this folder: spec_<case>.json, runs/<case>/ (wam, AVG, INS, log, summary.json), sound/
(<case>.wav, <case>_orders.json, compare_<case>.json), results.json.

2026-10-31: valve events and valve sizes now from Subaru's service data instead of the page's generic defaults
  (see build_spec()): IVO 1 BTDC / IVC 51 ABDC / EVO 50 BBDC / EVC 6 ATDC (Subaru 2.5 SOHC service manual,
  99.5 x 79 mm, CR 10.0), valve heads 36.0 / 31.4 mm (SOHC EJ25 replacement valves), lift = cam lobe lift
  (cam height - base circle: 5.535 / 5.307 mm) x rocker ratio 1.6 [est]. Result against the recording: the
  high orders moved by less than 1 dB (model excess at orders >= 6 still +21..25 dB at 2585-3550 rpm), so the
  valve events are not the cause of the bright high end; with the offset removed per case the model-minus-recording
  difference rises only ~6 dB per octave and scatters by ~10 dB order to order, i.e. it is mostly per-order
  structure from the PLACEHOLDER pipe lengths (the half orders above all), not one missing smooth filter.
  WOT brake torque 138 lb-ft @ 4000 / 144 hp @ 5600 against 166 lb-ft / 165 hp rated (base model: 142 / 160):
  the full-load gap is intake and combustion (page defaults: 300 mm runners, efficiency 0.72), not the exhaust.
ENGINE (sources: the brief; rod/combustion numbers are the exhaust calculator's simSpec() defaults,
exhaust-calculator.html:6846-6848, because the page has no EJ25 head data - stated here, not measured)
  flat-4 EJ251, 2457 cc: bore 99.5 mm, stroke 79 mm (Vd 614.3 cc/cyl), CR 10.0, 165 hp @ 5600, 166 lb-ft @ 4000
  firing 1-3-2-4, all 180 deg apart -> phases by cylinder index [0, 360, 180, 540]
  rod = 1.7 x stroke = 134.3 mm (page default; the real EJ25 rod is 130.5 mm)          [page default]
  4 valves/cyl SOHC: 2 x 36.0 mm intake, lift 8.86 mm; 2 x 31.4 mm exhaust, lift 8.49 mm; cd 0.7 [page default]
    (until 2026-10-31: the page's generic 39.8 / 33.8 mm, 10.3 / 9.5 mm)
  cam: IVO 1 BTDC, IVC 51 ABDC, EVO 50 BBDC, EVC 6 ATDC [Subaru service manual]
    (until 2026-10-31: EVO 48 BBDC, EVC 12 ATDC, IVO 8 BTDC, IVC 52 ABDC [est])
  combustion WOT: Wiebe start 18 BTDC, 55 deg, AFR 12.8, eff 0.72 (page defaults); no-load: AFR 14.6,
    start 12 BTDC, 65 deg (assumed idle-like calibration)                                             [est]
  no-load: the intake runners (300 mm, 43.6 mm, page default) open into a reservoir held at manifold pressure
    p_map (OpenWAM BC type 1, the throttled plenum downstream of the throttle plate). p_map is calibrated at
    1980 rpm so that NMEP = the friction law FMEP = 0.5 + 0.012 rpm/60 bar (zero brake torque), from two short
    runs and a linear NMEP(p_map) fit, and the same fit gives p_map(rpm) for FMEP(rpm); checked at every speed.
    (A first attempt with a small orifice per runner was a knife edge: a little too small and the simulated
    engine stalls over 10-20 cycles - the runner fills with back-flowed exhaust and the trapped fresh air decays
    to zero; see calibration_orifice.json. A fixed-pressure plenum is stable and monotonic.)

EXHAUST - every stock length below is a PLACEHOLDER awaiting the owner's measurements (no credible published
stock EJ251 manifold dimensions were found: aftermarket EJ UEL headers for the turbo cars are sold without
runner lengths). Marked [est]. The muffler and the 2.5 in section are the owner's own parts (brief).
  stock UEL 4-2-1 manifold: cylinders 1 & 3 (right bank, fire consecutively) join under the right side,
    2 & 4 join and cross under the pan to the right, the two secondaries merge ahead of the cat
  primaries 38 mm ID: cyl 1 & 3 = 430 mm, cyl 2 & 4 = 600 mm                                        [est]
  secondaries 45 mm ID: start at 2 primaries' area (53.7 mm) coning to 45 mm over 60 mm, then
    right (1&3) 290 mm straight, left (2&4, crosses under the pan) 590 mm straight               [est]
  2-1 merge: cone 63.6 -> 50.8 mm over 60 mm, front pipe 500 mm x 50.8 mm ID to the catalyst            [est]
  catalyst: 100 mm straight pipe of 50.8 mm ID - LIMITATION: a brick's channels add friction, heat loss
    and acoustic damping that a straight pipe does not; expect the model to be too bright/loud above a
    few hundred Hz until a real cat model is added                                                      [est]
  300 mm x 50.8 mm after the cat, then the 2 in OD mild-steel mid pipe: 2400 mm x 48.3 mm ID to the
    rear differential joint (brief: 2 in OD, 1.25 mm wall)                                             [est length]
  2.5 in OD 304 stainless: 600 mm x 60.3 mm ID, Spintech 3331 (2.5 in centre in / centre out, case
    4 x 8.5 x 13 in = 7.24 L) as a 7.2 L expansion volume - captures the low-frequency expansion-chamber
    behaviour, not the internal chambers/baffles - then 500 mm x 60.3 mm tailpipe, downturned tip      [brief]
  wall temperatures (steady no-load, est): primaries 600 K, secondaries 550 K, front 500 K, cat 300 C,
    mid pipe 200 -> 150 C, rear 150 C, tail 120 C
TO MEASURE ON THE CAR: primary lengths (port face to first merge) of cyl 1/3 and 2/4; secondary lengths
  and ID; front-pipe length to the cat, cat length/ID; after-cat length to the mid-pipe flange; mid-pipe
  length to the diff flange; 2.5 in lengths before and after the Spintech; tip length; and the mic spot.

ACOUSTICS: receiver 1.0 m from the tip, mic on the ground 3 ft behind and 1.5 ft right of the downturned
  tip (the owner) -> ground-plane microphone (+6 dB pressure doubling on every order, cancels in relative
  levels), monopole at the tip (wam_sound.py assumptions). Only RELATIVE order levels are compared; the
  fixed-gain clip also allows the overall-level trend across speeds to be compared.
"""
import json
import math
import os
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(REPO, "sound"))
sys.path.insert(0, os.path.join(REPO, "openwam"))
import make_wam      # noqa: E402
import run_models    # noqa: E402
import wam_sound     # noqa: E402
import order_compare  # noqa: E402

import numpy as np   # noqa: E402

B, S = 0.0995, 0.079
NOLOAD = [("idle_735", 735.0, "full_idle"), ("hold_1980", 1980.0, "full_hold_2000"), ("hold_2585", 2585.0, "full_hold_2600"),
          ("hold_2955", 2955.0, "full_hold_2950"), ("hold_3550", 3550.0, "full_hold_3500")]
SECONDARY = [("hold_1915", 1915.0, "hold_1900")]      # AGC clips: the 1915 hold only (the 730/765 idles duplicate the fixed-gain 735 idle)
WOT_RPM = [2000.0, 2800.0, 4000.0, 4800.0, 5600.0]
CAL_RPM = 1980.0
CELL_MM = 15.0
REC_JSON = os.path.join(HERE, "..", "recording_orders.json")
R_MIC, THETA = 1.0, 45.0


def fmep_bar(rpm):
    return make_wam.DEFAULTS["fmep_c0"] + make_wam.DEFAULTS["fmep_c1"] * rpm / 60.0


def build_spec(load="noload", p_map_bar=0.4):
    # FSM variant: valve timing from the Subaru service manual for the 2.5 SOHC (99.5 x 79, CR 10.0):
    #   intake opens 1 BTDC, closes 51 ABDC; exhaust opens 50 BBDC, closes 6 ATDC
    #   (raig0.planet.ee .../Legacy 2000 Service Manual/ENGINE SECTION/Engine/MSA5TCD00L16111.pdf)
    # valve heads: intake 36 mm, exhaust 31.4 mm (SOHC EJ25 1999-2012 replacement valves: enginepartsonly.com IV710EP38,
    #   partsology.com EV710-9); valve lift = cam lobe lift x rocker ratio 1.6 [est]: lobe lift from the same manual's
    #   cam height minus base circle, intake 39.535 - 34.00 = 5.535 mm, exhaust 39.307 - 34.00 = 5.307 mm (MSA5TCD00L16122.pdf)
    dIn, dEx = 0.036, 0.0314
    e = {"bore": B, "stroke": S, "rod": 1.7 * S, "cr": 10.0, "cd": 0.7, "nIn": 2, "dIn": dIn, "liftIn": 5.535e-3 * 1.6,
         "nEx": 2, "dEx": dEx, "liftEx": 5.307e-3 * 1.6, "cam": {"ivo": 1, "ivc": 51, "evo": 50, "evc": 6},
         "burn": {"start": 18, "dur": 55}, "afr": 12.8, "eta": 0.72}
    if load == "noload":
        e["burn"] = {"start": 12, "dur": 65}
        e["afr"] = 14.6
    dI = math.sqrt(0.6 * 2) * 0.40 * B      # intake runner unchanged from the base model (43.6 mm) to isolate the valve/cam change
    isegs = [{"L": 0.3, "d0": dI, "d1": dI}]
    intake = {"segs": isegs, "Tw": 320}
    if load == "noload":
        intake["reservoir"] = {"p_bar": p_map_bar}
    dp = 0.038
    prim = lambda L: [{"L": L, "d0": dp, "d1": dp, "primary": True}]
    dsec = 0.045
    sec = lambda Ls: [{"L": 0.06, "d0": dp * math.sqrt(2.0), "d1": dsec}, {"L": Ls, "d0": dsec, "d1": dsec}]
    dfp = 0.0508
    spec = {
        "e": e,
        "intake": intake,
        "exhaust": {"segs": prim(0.43), "per_cyl": [prim(0.43), prim(0.60), prim(0.43), prim(0.60)], "Tw": 600, "chambers": []},
        "opt": {
            "phases": [0, 360, 180, 540],
            "collectors": [{
                "cyls": [0, 1, 2, 3],
                "stages": [{"groups": [[0, 2], [1, 3]], "segs": sec(0.29), "segs_by_group": [sec(0.29), sec(0.59)], "Tw": 550}],
                "segs": [{"L": 0.06, "d0": dsec * math.sqrt(2.0), "d1": dfp}, {"L": 0.50, "d0": dfp, "d1": dfp}],
                "Tw": 500,
                "tail": [
                    {"L_mm": 100, "d0_mm": 50.8, "d1_mm": 50.8, "Tw_C": 300, "note": "catalyst as a straight pipe [limitation]"},
                    {"L_mm": 300, "d0_mm": 50.8, "d1_mm": 50.8, "Tw_C": 250, "note": "after the cat [est]"},
                    {"L_mm": 2400, "d0_mm": 48.3, "d1_mm": 48.3, "Tw_C": 200, "note": "2 in OD mild steel mid pipe to the diff [est length]"},
                    {"L_mm": 600, "d0_mm": 60.3, "d1_mm": 60.3, "Tw_C": 150, "note": "2.5 in OD 304 before the muffler [brief]"},
                    {"V_litres": 7.24, "note": "Spintech 3331, 4 x 8.5 x 13 in case, as an expansion volume"},
                    {"L_mm": 500, "d0_mm": 60.3, "d1_mm": 60.3, "Tw_C": 120, "note": "2.5 in tailpipe, downturned tip [brief]"},
                ]}]},
        "n": 4,
        "notes": __doc__.split("EXHAUST")[1].split("ACOUSTICS")[0],
    }
    return spec


def run_settings(rpm, cycles, name, fs_rows=64000.0):
    # 64 kHz INS rows (order levels within 0.4 dB of every-step output up to order 12; 16 kHz was up to 2.5 dB off
    # at 1 kHz on the RS 660 model)
    return {"rpm": float(rpm), "cycles": int(cycles), "name": name, "cell_mm": CELL_MM, "ins_outlet": 1, "ins_cycles": 2,
            "out_step_deg": make_wam.out_step_for_rate(rpm, fs_rows)}


def run_one(name, spec, run, argv=()):
    """--rerun: run even if the folder holds finished results of this model; --no-run: never run, re-summarise what
    is there. Otherwise OpenWAM runs when the model text changed or the last run did not finish."""
    folder = os.path.join(HERE, "runs", name)
    os.makedirs(folder, exist_ok=True)
    model = make_wam.model_from_spec(spec, run)
    run_models.write_and_run(folder, name, model, exe=os.environ.get("OPENWAM_EXE") or run_models.EXE,
                             rerun="--rerun" in argv, allow_run="--no-run" not in argv)
    with open(os.path.join(folder, "spec.json"), "w") as f:
        json.dump(spec, f, indent=1)
    with open(os.path.join(folder, "run.json"), "w") as f:
        json.dump({k: v for k, v in run.items() if k != "name"}, f, indent=1)
    s = run_models.summarise(folder, name, model)
    return folder, model, s


def calib(argv):
    """Short no-load runs at CAL_RPM at several manifold pressures -> linear NMEP(p_map), p_map for NMEP = FMEP."""
    ds = [0.30, 0.45, 0.60]
    jobs = [("calp_%g" % d, build_spec("noload", d), run_settings(CAL_RPM, 12, "calp_%g" % d)) for d in ds]
    with ThreadPoolExecutor(max_workers=2) as ex:
        res = list(ex.map(lambda j: run_one(j[0], j[1], j[2], argv), jobs))
    target = fmep_bar(CAL_RPM)
    pts = []
    for d, (folder, model, s) in zip(ds, res):
        L = s["last"]
        print("p_map %.2f bar: finished %s warn %d sonic %d  NMEP %.3f IMEP %.3f PMEP %.3f bar  intake %.3e kg/cycle/cyl  T_brake %.1f Nm" %
              (d, s["finished"], len(s["warning_or_error_lines"]), s["sonic_messages"], L["NMEP"], L["IMEP"], L["PMEP"], L["intake"],
               s["last"].get("Net_Torque", float("nan"))))
        pts.append((d, L["NMEP"]))
    # linear least-squares NMEP = a + b * p_map
    x = np.array([q[0] for q in pts]); y = np.array([q[1] for q in pts])
    b_, a_ = np.polyfit(x, y, 1)
    p_t = (target - a_) / b_
    out = {"cal_rpm": CAL_RPM, "fmep_target_bar": target, "points": pts, "fit_NMEP_bar": {"a": float(a_), "b_per_bar": float(b_)},
           "p_map_bar_at_cal": float(p_t), "rule": "p_map(rpm) = (FMEP(rpm) - a) / b, the same fit at every speed; checked after the runs"}
    with open(os.path.join(HERE, "calibration.json"), "w") as f:
        json.dump(out, f, indent=1)
    print("NMEP = %.3f + %.3f * p_map  -> target NMEP = FMEP(%d) = %.3f bar at p_map = %.3f bar (saved calibration.json)" % (a_, b_, CAL_RPM, target, p_t))


def d_for(rpm):
    """manifold pressure [bar] for zero brake torque at rpm, from the calibration fit"""
    with open(os.path.join(HERE, "calibration.json")) as f:
        c = json.load(f)
    return (fmep_bar(rpm) - c["fit_NMEP_bar"]["a"]) / c["fit_NMEP_bar"]["b_per_bar"]


def run(argv):
    jobs = []
    for name, rpm, _ in NOLOAD + SECONDARY:
        # 28 / 48 cycles: the 7.24 L muffler volume fills and cools slowly at no load (box_settling in
        # runs_summary.json); NMEP settles sooner
        jobs.append((name, build_spec("noload", d_for(rpm)), run_settings(rpm, 28 if rpm < 1000 else 48, name)))
    for rpm in WOT_RPM:
        nm = "wot_%d" % int(rpm)
        jobs.append((nm, build_spec("wot"), dict(run_settings(rpm, 16, nm), ins_outlet=0, ins_cycles=1, out_step_deg=1.0)))
    # longest first so the two workers finish together
    jobs.sort(key=lambda j: -j[2]["cycles"] * 120.0 / j[2]["rpm"])
    with ThreadPoolExecutor(max_workers=2) as ex:
        res = list(ex.map(lambda j: run_one(j[0], j[1], j[2], argv), jobs))
    rows = []
    for (name, spec, rs), (folder, model, s) in zip(jobs, res):
        L = s["last"]
        rpm = rs["rpm"]
        tq_brake = L["T_net_from_NMEP"] - fmep_bar(rpm) * 1e5 * 4 * 614.3e-6 / (4 * math.pi)
        r = {"name": name, "rpm": rpm, "load": "wot" if name.startswith("wot") else "noload", "finished": s["finished"],
             "warnings": len(s["warning_or_error_lines"]), "sonic": s["sonic_messages"], "NMEP": L["NMEP"], "IMEP": L["IMEP"],
             "PMEP": L["PMEP"], "FMEP": fmep_bar(rpm), "T_net_Nm": L["T_net_from_NMEP"], "T_brake_Nm": tq_brake,
             "T_brake_lbft": tq_brake * 0.73756, "P_brake_hp": tq_brake * 2 * math.pi * rpm / 60 / 745.7,
             "VE_delivered": L["VE_delivered"], "p_map_bar": d_for(rpm) if not name.startswith("wot") else None,
             "mass_balance_cyl": s["mass_balance_cyl"],
             "box_settling": {k: s["plenum_settling"][0][k] for k in ("density_change_per_cycle", "T_change_K", "cycles")},
             "conv_NMEP_last_change": s["convergence"]["NMEP"]["last_change"]}
        rows.append(r)
        print("%-10s %5.0f rpm %-6s fin %s warn %d sonic %4d | NMEP %6.3f FMEP %5.3f -> T_brake %6.1f Nm = %6.1f lb-ft, %5.1f hp | VE %.3f | dNMEP %.1e" %
              (name, rpm, r["load"], s["finished"], r["warnings"], r["sonic"], r["NMEP"], r["FMEP"], tq_brake, r["T_brake_lbft"], r["P_brake_hp"],
               r["VE_delivered"], r["conv_NMEP_last_change"]))
    with open(os.path.join(HERE, "runs_summary.json"), "w") as f:
        json.dump(rows, f, indent=1)


def sound(argv):
    os.makedirs(os.path.join(HERE, "sound"), exist_ok=True)
    with open(REC_JSON) as f:
        rec = json.load(f)
    results = {"receiver": "1.0 m from the tip, microphone on the ground 3 ft behind / 1.5 ft right of the downturned tip: "
                           "ground-plane mic, +6 dB pressure doubling applied to every order (cancels in relative levels)",
               "cases": []}
    print("=" * 100)
    for name, rpm, key in NOLOAD + SECONDARY:
        folder = os.path.join(HERE, "runs", name)
        ins_path = os.path.join(folder, name + "INS.DAT")
        if not os.path.exists(ins_path):
            print("%s: no INS.DAT yet" % name)
            continue
        with open(os.path.join(folder, "spec.json")) as f:
            spec = json.load(f)
        with open(os.path.join(folder, "run.json")) as f:
            rs = json.load(f)
        model = make_wam.model_from_spec(spec, dict(rs, name=name))
        with open(ins_path) as f:
            ins = make_wam.read_ins(f.read(), keep_cycles=2, model=model)
        pp = model["pipes"][ins["pipe"] - 1]
        res = wam_sound.synthesize(ins, rpm, r=R_MIC, theta_deg=THETA, ground=True, d_tip_m=pp["secs"][-1][1], orders_max=12)
        base = os.path.join(HERE, "sound", name)
        pa_fs = wam_sound.write_wav(base + ".wav", res["signal"], res["fs"])
        out = {k: v for k, v in res.items() if k not in ("signal", "p_cycle")}
        out.update({"rpm": rpm, "r_m": R_MIC, "theta_deg": THETA, "ground": True, "pa_per_fullscale": pa_fs, "ins_file": ins_path})
        with open(base + "_orders.json", "w") as f:
            json.dump(out, f, indent=1)
        # comparison with the recording
        ent = rec.get(key)
        cmp_ = None
        if ent:
            orders = np.array(res["orders"])
            lev = ent["orders_dB_rel"]
            meas = np.array([lev.get("%g" % o, lev.get(str(float(o)), np.nan)) for o in orders], float)
            min_order = 4.0 if rpm < 1000 else 2.0
            cmp_ = order_compare.compare(meas, np.array(res["spl_dB"]), orders, min_order=min_order, max_order=12.0)
            title = ("%s: recording %s %s t=%s (%s rpm, %s) vs model at %.0f rpm, orders >= %g" %
                     (name, ent["file"], key, ent.get("t"), ent["rpm"], "fixed gain" if ent["file"].startswith("full") else "AGC clip, secondary",
                      rpm, min_order))
            order_compare.print_table(cmp_, rpm, title)
            if rpm < 1000:
                print("Order 2 (%.1f Hz) and 3 are left out at idle on purpose: a monopole's radiated pressure falls with f^2 relative "
                      "to the volume flow and a phone/recorder-class microphone rolls off below ~50-100 Hz, so the recording's 2nd order "
                      "(-24..-29 dB in the clips) is suppressed by the measurement chain, not something to tune the model to." % (2 * rpm / 60))
            h = [o for o in (1.5, 2.5, 3.5) if o in orders]
            mi = {o: cmp_["model_dB_rel"][list(orders).index(o)] for o in h}
            me = {o: cmp_["measured_dB_rel"][list(orders).index(o)] for o in h}
            print("Half orders (UEL manifold signature), dB relative to the strongest order - recording / model: " +
                  "  ".join("%.1f: %+.1f / %+.1f" % (o, me[o], mi[o]) for o in h))
            print()
        results["cases"].append({"name": name, "rpm": rpm, "recording_key": key, "overall_spl_dB": res["overall_spl_dB"],
                                 "overall_spl_dBA": res["overall_spl_dBA"], "strongest_order": res["strongest_order"],
                                 "periodicity": res["periodicity_rms"], "orders": res["orders"], "model_dB_rel": res["dB_rel"],
                                 "model_spl_dB": res["spl_dB"], "compare": cmp_, "recording_dBFS_rms": ent.get("rms_dBFS") if ent else None})
        print("%s: %.0f rpm, overall %.1f dB SPL (%.1f dBA) at 1 m ground-plane, strongest order %.1f, periodicity %.3f, WAV %s" %
              (name, rpm, res["overall_spl_dB"], res["overall_spl_dBA"], res["strongest_order"], res["periodicity_rms"], base + ".wav"))
        print("=" * 100)
    # level trend across the fixed-gain clip
    fixed = [c for c in results["cases"] if c["recording_key"].startswith("full")]
    if len(fixed) >= 2:
        print("Overall level trend (fixed-gain recording vs model), relative to the 1980 rpm hold:")
        ref = [c for c in fixed if c["rpm"] == 1980.0]
        if ref:
            ref = ref[0]
            lvl = {k: rec[k].get("rms_dBFS") for k in rec}
            print("%-12s %6s %14s %14s %8s" % ("case", "rpm", "recording dB", "model dB SPL", "delta"))
            trend = []
            for c in fixed:
                rl = lvl.get(c["recording_key"])
                rr = lvl.get(ref["recording_key"])
                dm = c["overall_spl_dB"] - ref["overall_spl_dB"]
                dr = (rl - rr) if (rl is not None and rr is not None) else float("nan")
                trend.append({"name": c["name"], "rpm": c["rpm"], "rec_rel_dB": dr, "model_rel_dB": dm})
                print("%-12s %6.0f %+14.1f %+14.1f %+8.1f" % (c["name"], c["rpm"], dr, dm, dm - dr))
            results["level_trend"] = trend
            print("(recording levels are the clip's dBFS rms per segment from recording_orders.json; the model's is the overall SPL of "
                  "the synthesised tailpipe sound; both relative to the 1980 rpm hold, so the unknown gain cancels)")
    with open(os.path.join(HERE, "results.json"), "w") as f:
        json.dump(results, f, indent=1)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in ("calib", "all"):
        calib(sys.argv)
    if mode in ("run", "all"):
        run(sys.argv)
    if mode in ("sound", "all"):
        sound(sys.argv)
