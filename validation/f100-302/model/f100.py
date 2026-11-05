#!/usr/bin/env python3
"""f100.py - a built 1971 Ford F-100 302 (5.0 L) with long-tube headers, a 2.5 in X-pipe and chambered mufflers:
OpenWAM model at wide-open throttle, sound synthesis, and comparison with roadside pass-by recordings.

    python3 f100.py run [case ...]     # OpenWAM, 2 at a time; cases below (default: all)
    python3 f100.py sound              # order spectra + comparison with recording_orders.json (needs run)
  NCYC (environment) sets the cycles per run (default 30).

The engine is the owner's build sheet, supplied by the user; the exhaust layout comes from published write-ups of
the truck (long-tube headers, a 2.5 in X-pipe, chambered mufflers, side exits ahead of the rear wheels). Every
exhaust length below is a PLACEHOLDER [est]: none was published.

ENGINE (build sheet unless marked)
  bore 4.040 in (0.040 over) = 102.62 mm, stroke 3.000 in = 76.20 mm (stock crank), rod 5.090 in = 129.29 mm
  piston 7 cc dome; head gasket 4.060 in bore x 0.027 in; heads AFR Renegade 185 (2.02 / 1.60 in valves; the chamber
    is 58 or 72 cc in AFR's range and the sheet does not say which: 58 cc taken [est]); deck 0.010 in down [est]
    -> CR 11.6 (72 cc would give 9.7)
  cam Anderson N-91 hydraulic roller: 240 / 248 deg at 0.050 in tappet lift, IVO 15 BTDC, IVC 45 ABDC, EVO 59 BBDC,
    EVC 9 ATDC, lobe lift 0.360 in, 1.6 rockers -> 0.576 in valve lift; checked at 0.050 x 1.6 = 0.080 in at the
    valve (the generator's sin^2 lobe is fitted through those events)
  firing order: not on the sheet. The N-91 is sold for the 1987-93 Mustang 5.0 HO, whose order is 1-3-7-2-6-5-4-8
    [est]; the older 302 order 1-5-4-2-6-3-7-8 runs as a check. Ford numbers the right bank 1-4, the left 5-8.
  intake AFR 4830 single plane, 750 cfm carburettor: modelled as a 280 mm runner of 47 mm (the 2.10 x 1.28 in
    gasket port's area) open to the air [est]; WOT burn 25 BTDC start, 55 deg, AFR 12.8 [est]
  published: 507 hp at 7200 rpm on 91 octane (chassis figure not stated)

EXHAUST [est throughout]
  primaries 1-5/8 in OD x 0.049 in wall (38.8 mm ID), 762 mm each; 4-1 collector 77.6 -> 73 mm over 150 mm,
    73 mm x 150 mm, reducer 73 -> 60.3 mm over 100 mm (2.5 in OD, 1.6 mm wall)
  2.5 in pipe 1000 mm from each collector to the X-pipe; the X as one junction (make_wam v10 crossover)
  after the X: 300 mm to each muffler, the muffler, 600 mm turned-down exit ahead of the rear wheel
  muffler (two versions): "box" = one 6.5 L volume (a 14 x 9 x 4 in oval case); "venom" = the chambered layout of the
    maker's cutaway: a front chamber, a V baffle splitting the flow into two side passages, a rear chamber
    (2.0 L + two 280 mm x 70 mm passages + 2.0 L, the case volume shared out by eye)
  wall temperatures at WOT: primaries 800 K, collector 750 K, to the X 450 C, after the X 350 C, exit 250 C

ACOUSTICS: the recordings are roadside pass-bys under acceleration (see recording_orders.json), so only RELATIVE
  order levels mean anything; the near exit is the source at 4 m, the far exit 1.8 m further (the truck's width),
  both on the ground plane. Doppler shifts all orders by one factor and leaves their relative levels.
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
import make_wam       # noqa: E402
import run_models     # noqa: E402
import wam_sound      # noqa: E402
import order_compare  # noqa: E402

import numpy as np    # noqa: E402

IN = 0.0254
B, S, ROD = 4.040 * IN, 3.000 * IN, 5.090 * IN
REC_JSON = os.path.join(HERE, "..", "recording_orders.json")
CELL_MM = 15.0
FLOOR_DB = -25.0


def cr(chamber_cc=58.0, dome_cc=7.0, deck_in=0.010):
    vd = math.pi / 4 * (B * 100) ** 2 * S * 100                     # cc per cylinder
    gasket = math.pi / 4 * (4.060 * 2.54) ** 2 * 0.027 * 2.54
    deck = math.pi / 4 * (B * 100) ** 2 * deck_in * 2.54
    vc = chamber_cc - dome_cc + gasket + deck
    return (vd + vc) / vc


# phases by cylinder index (cylinder 1 = index 0), 90 deg between firings
def phases_for(order):
    ph = [0.0] * 8
    for k, c in enumerate(order):
        ph[c - 1] = 90.0 * k
    return ph


ORDERS = {"ho": [1, 3, 7, 2, 6, 5, 4, 8], "std": [1, 5, 4, 2, 6, 3, 7, 8]}
D25 = 60.3
seg = lambda L, d0=D25, d1=None, T=None: dict({"L_mm": L, "d0_mm": d0, "d1_mm": d0 if d1 is None else d1}, **({"Tw_C": T} if T is not None else {}))
MUFFLERS = {
    "box": [{"V_litres": 6.5, "note": "14 x 9 x 4 in oval case as one volume"}],
    "venom": [{"V_litres": 2.0, "note": "front chamber"}, seg(40, T=330),
              {"parallel": [[seg(280, 70.0, T=330)], [seg(280, 70.0, T=330)]], "note": "the two side passages around the V baffle"},
              seg(40, T=330), {"V_litres": 2.0, "note": "rear chamber"}],
    # the same 6.5 L as a 1-D chamber with the case's length (356 mm; the oval's area as a 152 mm round): its
    # length passes and stops frequencies as an expansion chamber does, which a 0-D volume cannot
    "chamber": [seg(356, 152.0, T=330)],
    "pipe": [seg(356, T=330)],
}


def build_spec(fo="ho", muffler="box", exit_mm=600, plenum=False, to_x_mm=1000, prim_mm=762):
    e = {"bore": B, "stroke": S, "rod": ROD, "cr": round(cr(), 2), "cd": 0.7,
         "nIn": 1, "dIn": 2.02 * IN, "liftIn": 0.576 * IN, "nEx": 1, "dEx": 1.60 * IN, "liftEx": 0.576 * IN,
         "cam": {"ivo": 15, "ivc": 45, "evo": 59, "evc": 9, "checkLift_mm": 0.080 * 25.4},
         "burn": {"start": 25, "dur": 55}, "afr": 12.8, "eta": 0.72}
    dp = 38.8e-3
    prim = [{"L": prim_mm / 1000.0, "d0": dp, "d1": dp, "primary": True}]
    col_segs = [{"L": 0.15, "d0": 2 * dp, "d1": 0.073}, {"L": 0.15, "d0": 0.073, "d1": 0.073}, {"L": 0.10, "d0": 0.073, "d1": D25 / 1000}]
    to_x = [seg(to_x_mm, T=450)]
    after = [seg(300, T=350)] + MUFFLERS[muffler] + [seg(exit_mm, T=250)]
    return {
        "e": e,
        "intake": dict({"segs": [{"L": 0.28, "d0": 0.047, "d1": 0.047}], "Tw": 330},
                       # the single plane's shared plenum under the carburettor (1.8 L [est]), fed through the four
                       # throttle bores as one 86 mm inlet (4 x 1-11/16 in bores' area [est]) behind a 100 mm air-cleaner
                       # stack, instead of every runner open to the air
                       **({"plenum": {"V_m3": 1.8e-3, "inlet": [{"L": 0.10, "d0": 0.086, "d1": 0.086}]}} if plenum else {})),
        "exhaust": {"segs": prim, "Tw": 800},
        "opt": {"phases": phases_for(ORDERS[fo]),
                "collectors": [{"cyls": [0, 1, 2, 3], "segs": col_segs, "Tw": 750, "tail": to_x},
                               {"cyls": [4, 5, 6, 7], "segs": col_segs, "Tw": 750, "tail": to_x}],
                "crossover": {"cols": [0, 1], "type": "x", "tails": [after, after]}},
        "n": 8,
        "notes": __doc__.split("EXHAUST")[1].split("ACOUSTICS")[0],
    }


CASES = {"ho_box_5000": ("ho", "box", 5000.0), "ho_box_5800": ("ho", "box", 5800.0),
         "std_box_5800": ("std", "box", 5800.0), "ho_venom_5800": ("ho", "venom", 5800.0),
         "ho_chamber_5800": ("ho", "chamber", 5800.0), "ho_pipe_5800": ("ho", "pipe", 5800.0),
         "ho_chamber_5000": ("ho", "chamber", 5000.0), "std_chamber_5800": ("std", "chamber", 5800.0),
         "ho_chamber_exit300_5800": ("ho", "chamber", 5800.0, 300), "ho_box_exit300_5800": ("ho", "box", 5800.0, 300),
         "ho_venom_plenum_5800": ("ho", "venom", 5800.0, 600, True), "ho_pipe_plenum_5800": ("ho", "pipe", 5800.0, 600, True),
         "std_venom_plenum_5800": ("std", "venom", 5800.0, 600, True), "ho_venom_plenum_5000": ("ho", "venom", 5000.0, 600, True),
         # where the X sits: collector reducer to the X junction
         "ho_venom_plenum_x400_5800": ("ho", "venom", 5800.0, 600, True, 400),
         "ho_venom_plenum_x700_5800": ("ho", "venom", 5800.0, 600, True, 700),
         "ho_venom_plenum_x1400_5800": ("ho", "venom", 5800.0, 600, True, 1400),
         "ho_venom_plenum_x250_5800": ("ho", "venom", 5800.0, 600, True, 250),
         "ho_venom_plenum_x550_5800": ("ho", "venom", 5800.0, 600, True, 550),
         "ho_venom_plenum_x400_5000": ("ho", "venom", 5000.0, 600, True, 400),
         "std_venom_plenum_x400_5800": ("std", "venom", 5800.0, 600, True, 400),
         # the speeds a pull is put together from (sound/sweep.py), with ho_venom_plenum_x400_5000 and _5800
         "ho_venom_plenum_x400_5400": ("ho", "venom", 5400.0, 600, True, 400),
         "ho_venom_plenum_x400_6200": ("ho", "venom", 6200.0, 600, True, 400)}


def run_settings(rpm, cycles, name):
    return {"rpm": float(rpm), "cycles": int(cycles), "name": name, "cell_mm": CELL_MM, "ins_outlet": 1, "ins_cycles": 2,
            "out_step_deg": make_wam.out_step_for_rate(rpm, 64000.0)}


def run_case(name):
    fo, mu, rpm = CASES[name][:3]
    spec = build_spec(fo, mu, *CASES[name][3:])
    run = run_settings(rpm, int(os.environ.get("NCYC", "30")), name)
    folder = os.path.join(HERE, "runs", name)
    os.makedirs(folder, exist_ok=True)
    model = make_wam.model_from_spec(spec, run)
    run_models.write_and_run(folder, name, model, exe=os.environ.get("OPENWAM_EXE") or run_models.EXE,
                             rerun="--rerun" in sys.argv, allow_run="--no-run" not in sys.argv)
    json.dump(spec, open(os.path.join(folder, "spec.json"), "w"), indent=1)
    s = run_models.summarise(folder, name, model)
    return name, model, s


def sound(names):
    rec = json.load(open(REC_JSON))
    res = {}
    for name in names:
        fo, mu, rpm = CASES[name][:3]
        folder = os.path.join(HERE, "runs", name)
        if not os.path.exists(os.path.join(folder, name + "INS.DAT")):
            continue
        model = make_wam.model_from_spec(build_spec(fo, mu, *CASES[name][3:]), run_settings(rpm, 1, name))
        txt = open(os.path.join(folder, name + "INS.DAT")).read()
        base = make_wam.read_ins(txt, keep_cycles=2, model=model)
        srcs = []
        for k, pn in enumerate(base["outlets"]):
            ins = make_wam.read_ins(txt, pipe=pn, keep_cycles=2, model=model)
            srcs.append({"ins": ins, "r": 4.0 + 1.8 * k, "theta_deg": 90.0, "d_tip_m": D25 / 1000})
        variants = {"both_exits": wam_sound.synthesize_multi(srcs, rpm, ground=True, orders_max=12),
                    "near_exit": wam_sound.synthesize_multi(srcs[:1], rpm, ground=True, orders_max=12)}
        res[name] = {}
        for vn, sy in variants.items():
            O = np.array(sy["orders"]); md = np.array(sy["spl_dB"])
            res[name][vn] = {"model_dB_rel": dict(zip(["%g" % o for o in O], np.round(md - md.max(), 1).tolist())), "vs": {}}
            for rk, rv in rec.items():
                meas = np.array([rv["orders_dB_rel"].get("%g" % o, np.nan) for o in O])
                cm = order_compare.compare(meas, md, O, min_order=1.5, max_order=12.0)
                res[name][vn]["vs"][rk] = round(float(cm["rms_delta_dB"]), 2)
                # the recording's floor: every non-firing order sits near -20..-25 dB (road, wind and tyre noise and the
                # speed change within each window), so below FLOOR_DB neither side says anything; both clipped there,
                # each relative to its own strongest order, orders 1.5-12
                k = (O >= 1.5) & (O <= 12.0) & np.isfinite(meas)
                a = np.maximum(meas[k] - np.nanmax(meas[k]), FLOOR_DB); b = np.maximum(md[k] - md[k].max(), FLOOR_DB)
                res[name][vn].setdefault("vs_floor", {})[rk] = round(float(np.sqrt(np.mean((a - b) ** 2))), 2)
        s = run_models.summarise(folder, name, model)
        res[name]["NMEP_bar"] = s["last"]["NMEP"]
        res[name]["finished"] = s["finished"]
    # merge into what is there: a call scores the cases asked for and keeps the others' last scores
    path = os.path.join(HERE, "results.json")
    allres = json.load(open(path)) if os.path.exists(path) else {}
    allres.update(res)
    json.dump({k: allres[k] for k in sorted(allres)}, open(path, "w"), indent=1)
    O = ["%g" % o for o in np.arange(0.5, 12.01, 0.5)]
    for name, r in res.items():
        for vn in ("both_exits", "near_exit"):
            print("%-24s %-10s RMS vs pulls %s | floored at %g dB %s" % (name, vn, " ".join("%5.1f" % v for v in r[vn]["vs"].values()),
                  FLOOR_DB, " ".join("%5.1f" % v for v in r[vn]["vs_floor"].values())))
            print("   model ", " ".join("%4.0f" % r[vn]["model_dB_rel"][o] for o in O))
    rk = list(rec)[0]
    print("   record", " ".join("%4.0f" % rec[rk]["orders_dB_rel"][o] for o in O), "(%s)" % rk)


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "sound"
    names = [a for a in sys.argv[2:] if not a.startswith("--")] or list(CASES)
    if cmd == "run":
        with ThreadPoolExecutor(max_workers=2) as ex:
            for name, model, s in ex.map(run_case, names):
                print("%-14s finished %s warn %d NMEP %.2f bar" % (name, s["finished"], len(s["warning_or_error_lines"]), s["last"]["NMEP"]))
    sound(names)
