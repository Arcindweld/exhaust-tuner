#!/usr/bin/env python3
"""v8_841_study.py - 8-4-1 headers on a cross-plane V8 in OpenWAM, against the layouts they replace.

    python3 v8_841_study.py [rpm ...] [cycles=40] [jobs=2] [cell_mm=7.07] [sound=5000] [layouts=a,b] [tag=_x] [yr=0.8] [first=368]

One engine, six exhaust layouts, the same primary tube, the same path length from the valve to the last
collector and the same collector rules, so only the grouping changes:

  dual41    each bank its own 4-1 (the usual long-tube header): collectors fed at 90/180/270/180 deg gaps
  bank180   180-degree headers: two 4-1s, each taking alternate cylinders in the firing order (180 deg gaps)
  all81     8-into-1: every cylinder into one collector (90 deg gaps)
  c841_180  8-4-1, pairs on the same bank that fire 180 deg apart, four secondaries into one 4-1
  c841_270  8-4-1, pairs on the same bank as evenly spaced as the bank allows (270 / 450 deg)
  c841_x    8-4-1, pairs across the banks that fire 360 deg apart (each needs a crossover tube)

The engine is a 6.2 L GM LS3 V8 (stated, not measured, parameters; the cylinder and cam from GM): 103.25 x 92 mm,
rod 154 mm, 10.7:1, one 55.0 mm intake and one 40.4 mm exhaust valve per cylinder, 14.01 / 13.33 mm lift, and GM's
2008 LS3 valve events at 0.050 in (Corvette Action Center's reproduction of GM's LS3 technical briefing): intake opens
19 deg ATDC and closes 43 deg ABDC, exhaust opens 38 deg BBDC and closes 7 deg BTDC (204 / 211 deg), given at 0.050 in
(checkLift_mm 1.27, so the model's lift passes 0.050 in there). Before 2026-11-03 these runs fed 0.050 in events in as
seat timing (about 25 deg short at each end) and assumed the cam 4 deg advanced, where GM's events put the intake
centreline 121 deg ATDC on a 117 deg lobe separation (4 deg retarded); the results in openwam/ref/v8_841/results*.json
from then are kept for the record but superseded by the _v3 runs. firing order 1-8-7-2-6-5-4-3 (odd cylinders on the left bank). Header tubes follow Concept 841's published C7
8-4-1 sizes (2.00 in primaries, 2.25 in secondaries, a 4.5 in 4-1 collector outlet; 16-gauge wall assumed:
47.5 / 53.9 / 111.0 mm inside), and the same primary is used for every layout. Path from the valve to the last
collector: 36 in (914 mm), the first merge of the 8-4-1s at 14.5 in (368 mm, the Headers tab's Tri-Y default).
Collectors: a 15 deg half-angle cone from the combined inlet area to the collector, collector area = 0.8 x the
inlets for the 4-1s and the 8-1 (the Headers tab's default ratio) and Concept's 111 mm for the 8-4-1s
(1.06 x its four secondaries), a straight 1.5 collector diameters long, then 1.0 m of the same pipe to the open
end. These are comparisons between layouts on one model, not a prediction of any car's dyno numbers.

Writes runs/v8_841/<layout>_<rpm>/ (OpenWAM's files and summary.json) and runs/v8_841/results.json; with
sound=<rpm>, also the outlet's order levels at that speed (sound/wam_sound.py, ins_outlet=1).
"""
import copy
import json
import math
import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_wam  # noqa: E402
import run_models  # noqa: E402

IN = 0.0254
CHECK = 1.27            # the cam events are the card's 0.050 in timing (make_wam seat_events stretches the sin^2 lift)
FIRING = [1, 8, 7, 2, 6, 5, 4, 3]            # GM LS / LT
LEFT, RIGHT = [1, 3, 5, 7], [2, 4, 6, 8]
DP = 2.00 * IN - 2 * 0.065 * IN             # 47.5 mm
DSEC = 2.25 * IN - 2 * 0.065 * IN           # 53.85 mm
DC841 = 4.50 * IN - 2 * 0.065 * IN          # 111.0 mm
TOTAL = 36.0 * IN                           # valve to the last collector
FIRST = 368.3e-3                            # valve to the first merge of an 8-4-1
CR = 0.8                                    # collector area / inlets (4-1s, 8-1)
TAIL = 1.0                                  # collector to the open end


def cone(d0, d1, half_deg=15.0):
    return max(abs(d0 - d1) / 2.0 / math.tan(math.radians(half_deg)), 0.02)


def engine():
    """LS3 cylinder; cam events at 0.050 in as GM published them for the 2008 LS3 (ivo/evc negative = after/before TDC)."""
    return {"bore": 0.10325, "stroke": 0.092, "rod": 0.154, "cr": 10.7, "cd": 0.7,
            "nIn": 1, "dIn": 0.0550, "liftIn": 0.01401, "nEx": 1, "dEx": 0.0404, "liftEx": 0.01333,
            "cam": {"ivo": -19.0, "ivc": 43.0, "evo": 38.0, "evc": -7.0, "checkLift_mm": CHECK},
            "burn": {"start": 18, "dur": 55}, "afr": 12.8, "eta": 0.72}


def phases():
    ph = [0.0] * 8
    for slot, c in enumerate(FIRING):
        ph[c - 1] = 90.0 * slot
    return ph


def collector(d_in_combined, dc, extra=None):
    segs = [{"L": cone(d_in_combined, dc), "d0": d_in_combined, "d1": dc},
            {"L": 1.5 * dc, "d0": dc, "d1": dc},
            {"L": TAIL, "d0": dc, "d1": dc}]
    return segs


def idx(cyls):
    return [c - 1 for c in cyls]


def spec(layout):
    s = {"e": engine(), "n": 8,
         "intake": {"segs": [{"L": 0.30, "d0": 0.052, "d1": 0.052}], "Tw": 320},
         "exhaust": {"segs": [], "Tw": 700, "chambers": []},
         "opt": {"phases": phases()}}
    four = lambda g: {"cyls": idx(g), "Tw": 650,
                      "segs": collector(DP * 2.0, DP * math.sqrt(4 * CR))}
    if layout in ("dual41", "bank180", "all81"):
        s["exhaust"]["segs"] = [{"L": TOTAL, "d0": DP, "d1": DP, "primary": True}]
        if layout == "dual41":
            groups = [LEFT, RIGHT]
        elif layout == "bank180":
            groups = [FIRING[0::2], FIRING[1::2]]
        else:
            groups = [FIRING]
        if layout == "all81":
            s["opt"]["collectors"] = [{"cyls": idx(FIRING), "Tw": 650,
                                       "segs": collector(DP * math.sqrt(8), DP * math.sqrt(8 * CR))}]
        else:
            s["opt"]["collectors"] = [four(g) for g in groups]
        return s
    if layout in ("triy_180", "triy_270"):
        # each bank its own Tri-Y (4-2-1): pairs on the bank, two secondaries into a 2-1 per bank
        pp = {"triy_180": [[[1, 7], [5, 3]], [[8, 2], [6, 4]]], "triy_270": [[[1, 5], [7, 3]], [[8, 6], [2, 4]]]}[layout]
        s["exhaust"]["segs"] = [{"L": FIRST, "d0": DP, "d1": DP, "primary": True}]
        yc = cone(DP * math.sqrt(2), DSEC)
        s["opt"]["collectors"] = [{
            "cyls": idx(bank), "Tw": 650,
            "stages": [{"groups": [sorted(idx(p)) for p in prs], "Tw": 675,
                        "segs": [{"L": yc, "d0": DP * math.sqrt(2), "d1": DSEC},
                                 {"L": TOTAL - FIRST - yc, "d0": DSEC, "d1": DSEC}]}],
            "segs": collector(DSEC * math.sqrt(2), DSEC * math.sqrt(2 * CR))} for bank, prs in zip([LEFT, RIGHT], pp)]
        return s
    pairs = {"c841_180": [[1, 7], [5, 3], [8, 2], [6, 4]],          # same bank, 180 deg apart
             "c841_270": [[1, 5], [7, 3], [8, 6], [2, 4]],          # same bank, 270 / 450 deg
             "c841_x": [[1, 6], [8, 5], [7, 4], [2, 3]]}[layout]    # across the banks, 360 deg
    s["exhaust"]["segs"] = [{"L": FIRST, "d0": DP, "d1": DP, "primary": True}]
    yc = cone(DP * math.sqrt(2), DSEC)
    s["opt"]["collectors"] = [{
        "cyls": idx(FIRING), "Tw": 650,
        "stages": [{"groups": [sorted(idx(p)) for p in pairs], "Tw": 675,
                    "segs": [{"L": yc, "d0": DP * math.sqrt(2), "d1": DSEC},
                             {"L": TOTAL - FIRST - yc, "d0": DSEC, "d1": DSEC}]}],
        "segs": collector(DSEC * 2.0, DC841)}]
    return s


LAYOUTS = ["dual41", "bank180", "all81", "c841_180", "c841_270", "c841_x"]
MORE = ["triy_180", "triy_270"]           # per-bank Tri-Y, run with layouts=


def pulse_gaps(cyls):
    a = sorted(90.0 * FIRING.index(c) for c in cyls)
    return [round((a[(i + 1) % len(a)] - a[i]) % 720 or 720) for i in range(len(a))]


def run_one(layout, rpm, over, sound=False, tag=""):
    name = "%s_%d%s" % (layout, rpm, tag)
    folder = os.path.join(HERE, "runs", "v8_841", name)
    os.makedirs(folder, exist_ok=True)
    run = dict(over, rpm=float(rpm), name=name)
    if sound:
        run["ins_outlet"] = 1
    sp = spec(layout)
    model = make_wam.model_from_spec(sp, run)
    run_models.write_and_run(folder, name, model, rerun=True)
    s = run_models.summarise(folder, name, model)
    out = {"layout": layout, "rpm": rpm, "finished": s["finished"], "warnings": len(s["warning_or_error_lines"]),
           "sonic": s["sonic_messages"], "T_net_Nm": s["last"]["T_net_from_NMEP"], "P_net_kW": s["last"]["P_net_kW"],
           "VE_delivered": s["last"]["VE_delivered"], "VE_trapped": s["last"]["VE_trapped_fresh"],
           "PMEP_bar": s["last"]["PMEP"], "dNMEP_last": s["convergence"]["NMEP"]["last_change"]}
    if sound:
        ins = os.path.join(folder, name + "INS.DAT")
        json.dump(sp, open(os.path.join(folder, "spec.json"), "w"))
        json.dump(run, open(os.path.join(folder, "run.json"), "w"))
        base = os.path.join(folder, "sound")
        r = subprocess.run([sys.executable, os.path.join(HERE, "..", "sound", "wam_sound.py"), ins, "--rpm", str(rpm),
                            "--spec", os.path.join(folder, "spec.json"), "--run", os.path.join(folder, "run.json"),
                            "--out", base, "--orders", "12", "--cycles", "2"], capture_output=True, text=True)
        if r.returncode == 0 and os.path.isfile(base + "_orders.json"):
            o = json.load(open(base + "_orders.json"))
            out["sound"] = {"strongest_order": o["strongest_order"], "overall_spl_dBA": o["overall_spl_dBA"],
                            "orders": o["orders"], "dB_rel": o["dB_rel"], "periodicity_rms": o["periodicity_rms"]}
        else:
            out["sound_error"] = (r.stdout + r.stderr)[-400:]
    return out


def main(argv):
    rpms, over, jobs, sound_rpm, layouts, tag, yr, first = [], {"cycles": 40, "cell_mm": 7.07}, 2, None, LAYOUTS, "", None, None
    for a in argv[1:]:
        if "=" in a:
            k, v = a.split("=", 1)
            if k == "jobs":
                jobs = int(v)
            elif k == "sound":
                sound_rpm = int(v)
            elif k == "layouts":
                layouts = v.split(",")
            elif k == "tag":
                tag = v
            elif k == "yr":
                yr = float(v)
            elif k == "first":
                first = float(v) / 1000.0
            else:
                over[k] = float(v) if k != "cycles" else int(v)
        else:
            rpms.append(int(a))
    rpms = rpms or [3000, 4000, 5000, 6000, 6600]
    global DSEC, DC841, FIRST
    if yr:                                   # secondary area / the two primaries feeding it (Concept 841: 0.64); the
        DSEC = DP * math.sqrt(2 * yr)        # 4-1 keeps Concept's 1.06 x the four secondaries
        DC841 = DSEC * math.sqrt(4 * (111.0e-3 / (53.85e-3 * 2)) ** 2)
    if first:                                # valve to the first merge, mm
        FIRST = first
    todo = [(l, r, r == sound_rpm) for l in layouts for r in rpms]
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        res = list(ex.map(lambda t: run_one(t[0], t[1], over, t[2], tag), todo))
    groups = {"dual41": [LEFT, RIGHT], "bank180": [FIRING[0::2], FIRING[1::2]], "all81": [FIRING]}
    meta = {"engine": engine(), "firing": FIRING, "d_primary_mm": DP * 1e3, "d_secondary_mm": DSEC * 1e3,
            "d_collector_841_mm": DC841 * 1e3, "layouts": layouts, "tag": tag, "yr": (DSEC / DP) ** 2 / 2, "total_mm": TOTAL * 1e3, "first_mm": FIRST * 1e3, "run": over,
            "collector_pulse_gaps_deg": {k: [pulse_gaps(g) for g in v] for k, v in groups.items()}}
    json.dump({"meta": meta, "results": res}, open(os.path.join(HERE, "runs", "v8_841", "results%s.json" % tag), "w"), indent=1)
    print("%-9s %5s %8s %8s %7s %7s %5s" % ("layout", "rpm", "T_Nm", "P_kW", "VEdel", "PMEP", "ok"))
    for o in res:
        print("%-9s %5d %8.1f %8.1f %7.3f %7.3f %5s%s" % (o["layout"], o["rpm"], o["T_net_Nm"], o["P_net_kW"], o["VE_delivered"],
                                                     o["PMEP_bar"], o["finished"] and not o["warnings"],
                                                     ("  strongest order %.1f, %s" % (o["sound"]["strongest_order"], o["sound"]["overall_spl_dBA"]))
                                                     if "sound" in o else ""))


if __name__ == "__main__":
    main(sys.argv)
