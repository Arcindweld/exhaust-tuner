#!/usr/bin/env python3
"""sound_sanity.py - sanity checks of wam_sound.py on known cases (step 4 of the sound pipeline).

    python3 sound_sanity.py [rpm=3000] [cycles=20] [--rerun]

1. i4_41 (even-firing inline-4, 4-into-1 header open to air, specs/i4_41.json) held at rpm:
     the order spectrum must peak at engine order 2 (4 firings per 2 revolutions = 2 per revolution).
2. i4_single_cyl (one cylinder of the same engine, 0.68 m exhaust pipe from the valve to the open end):
     the firing order is 0.5 (1 firing per 2 revolutions), and the exhaust pipe is closed at the valve for most
     of the cycle and open at the end, so its quarter-wave resonance sits near f = c/(4 L) (end correction
     0.6 a ignored, ~2 %). The spectrum envelope over the orders must have a local maximum at the order nearest
     f_qw. c is taken from OpenWAM's own cycle-mean gas temperature of the pipe (AVG.DAT T_duct column) with
     gamma = 1.33 and R = 285.4 (burnt gas).
   Why not the inline-4 for this one: with four identical cylinders only every fourth half-order (2, 4, 6 ...)
   carries energy, 100 Hz apart at 3000 rpm, too coarse to place a ~120 Hz resonance, and a 4-1 manifold is not
   one closed-open pipe. The single cylinder has every half-order (25 Hz apart at 3000 rpm).
3. the mass-flow and the rho0*u*A forms of the monopole are compared on the i4 outlet (ratio of order-2 levels).
Both cases are run with ins_outlet=1 at 20 kHz output rows (out_step_deg = 6 rpm / 20000). Exit code 1 on failure.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "openwam"))     # make_wam, run_models and cases live there
import cases          # noqa: E402
import make_wam       # noqa: E402
import run_models     # noqa: E402
import wam_sound      # noqa: E402

GAMMA_EXH = 1.33


def run_case(case, rpm, cycles, rerun):
    name = "snd_%s_%d" % (case, rpm)
    folder = os.path.join(HERE, "runs", name)
    os.makedirs(folder, exist_ok=True)
    run = {"rpm": float(rpm), "cycles": cycles, "name": name, "ins_outlet": 1, "ins_cycles": 2,
           "out_step_deg": make_wam.out_step_for_rate(rpm, 20000.0)}
    spec = cases.ALL[case]()
    model = make_wam.model_from_spec(spec, run)
    run_models.write_and_run(folder, name, model, rerun=rerun)     # also reruns when the model text changed
    with open(os.path.join(folder, "spec.json"), "w") as f:
        json.dump(spec, f)
    with open(os.path.join(folder, "run.json"), "w") as f:
        json.dump({k: v for k, v in run.items() if k != "name"}, f)
    s = run_models.summarise(folder, name, model)
    with open(os.path.join(folder, name + "INS.DAT")) as f:
        ins = make_wam.read_ins(f.read(), keep_cycles=2, model=model)
    return folder, name, model, s, ins


def mean_pipe_T(folder, name, pipe_no):
    head, rows = run_models.read_avg(os.path.join(folder, name + "AVG.DAT"))
    col = [i for i, h in enumerate(head) if h.startswith("T_duct_%d_at_" % pipe_no)][0]
    return rows[-1][col] + 273.15


def main(argv):
    rpm, cycles, rerun = 3000, 20, "--rerun" in argv
    for a in argv[1:]:
        if a.startswith("rpm="):
            rpm = int(a[4:])
        elif a.startswith("cycles="):
            cycles = int(a[7:])
    ok = True
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=2) as ex:
        r4, r1 = list(ex.map(lambda c: run_case(c, rpm, cycles, rerun), ["i4_41", "i4_single_cyl"]))
    report = {"rpm": rpm}

    # ---- 1. inline-4: order 2
    folder, name, model, s, ins = r4
    pp = model["pipes"][ins["pipe"] - 1]
    res = wam_sound.synthesize(ins, rpm, d_tip_m=pp["secs"][-1][1])
    wam_sound.write_wav(os.path.join(folder, name + ".wav"), res["signal"], res["fs"])
    orders, rel = np.array(res["orders"]), np.array(res["dB_rel"])
    print("inline-4 at %d rpm: finished %s, NMEP %.2f bar, periodicity %.4f, overall %.1f dB SPL at 1 m" %
          (rpm, s["finished"], s["last"]["NMEP"], res["periodicity_rms"], res["overall_spl_dB"]))
    print("  order : " + " ".join("%6.1f" % o for o in orders))
    print("  dB rel: " + " ".join("%6.1f" % v for v in rel))
    o2 = res["strongest_order"]
    print("  strongest order %.1f (expected 2.0); half/odd orders are %.0f dB down (identical cylinders)" %
          (o2, -max(rel[(orders * 2) % 4 != 0])))
    if o2 != 2.0:
        if rpm >= 2500:
            ok = False
            print("  FAIL: the spectrum does not peak at order 2")
        else:
            print("  NOTE: at low speed the radiated spectrum favours the higher firing harmonics (monopole radiation grows "
                  "with frequency; the idle recordings of the Outback show the same, order 4/6 above order 2); the order-2 "
                  "criterion is applied at 2500 rpm and above")
    # 3. mass-flow vs rho0*u*A form of the monopole at order 2 (same open-end node)
    t = np.array(ins["time"]); u = np.array(ins["u"]); md = np.array(ins["mdot"])
    A = math.pi / 4 * pp["secs"][-1][1] ** 2
    ang = np.array(ins["angle"]); st = [0] + [i for i in range(1, len(ang)) if ang[i] < ang[i - 1] - 180]
    sl = slice(st[-1], len(t))
    n = res["n_per_cycle"]
    y_m, _ = wam_sound.resample_cycle(t[sl], md[sl], n)
    y_q, _ = wam_sound.resample_cycle(t[sl], 1.2 * u[sl] * A, n)
    k4 = 4   # harmonic index of order 2
    ratio = abs(np.fft.rfft(y_m)[k4]) / abs(np.fft.rfft(y_q)[k4])
    print("  order-2 source strength, mass-flow form / (rho0 u A) form = %.3f (%.1f dB): the hot jet (rho ~ %.2f kg/m3) "
          "carries less mass per volume than rho0 = 1.2" % (ratio, 20 * math.log10(ratio), float(np.mean(ins["rho"]))))
    report["i4"] = {"strongest_order": o2, "dB_rel": rel.tolist(), "orders": orders.tolist(), "periodicity": res["periodicity_rms"],
                    "overall_spl_dB": res["overall_spl_dB"], "mass_vs_volume_form_ratio": ratio, "NMEP": s["last"]["NMEP"]}

    # ---- 2. single cylinder: quarter-wave of the exhaust pipe
    folder, name, model, s, ins = r1
    pp = model["pipes"][ins["pipe"] - 1]
    L = make_wam.pipe_len(pp)
    TK = mean_pipe_T(folder, name, ins["pipe"])
    c = math.sqrt(GAMMA_EXH * make_wam.R_BURNT * TK)
    f_qw = c / (4 * L)
    o_qw = f_qw / (rpm / 60.0)
    res1 = wam_sound.synthesize(ins, rpm, d_tip_m=pp["secs"][-1][1], orders_max=16)
    wam_sound.write_wav(os.path.join(folder, name + ".wav"), res1["signal"], res1["fs"])
    orders1, rel1 = np.array(res1["orders"]), np.array(res1["dB_rel"])
    src1 = np.array(res1["source_orders_dB"])
    print("single cylinder at %d rpm: finished %s, NMEP %.2f bar, periodicity %.4f; exhaust pipe L = %.3f m, cycle-mean gas T %.0f K -> c = %.0f m/s" %
          (rpm, s["finished"], s["last"]["NMEP"], res1["periodicity_rms"], L, TK, c))
    print("  analytic quarter wave c/(4L) = %.1f Hz = order %.2f (orders are %.1f Hz apart)" % (f_qw, o_qw, rpm / 120.0))
    print("  order : " + " ".join("%6.1f" % o for o in orders1))
    print("  dB rel: " + " ".join("%6.1f" % v for v in rel1))
    print("  source: " + " ".join("%6.1f" % v for v in src1) + "   (m_dot spectrum, relative)")
    # the radiated spectrum is the source spectrum x omega: look for a local maximum of the radiated level
    # (above order 1, where the firing fundamental and its slope dominate) nearest to the analytic value
    peaks = [i for i in range(1, len(rel1) - 1) if rel1[i] >= rel1[i - 1] and rel1[i] >= rel1[i + 1] and orders1[i] > 1.0]
    print("  local maxima of the radiated order spectrum at orders: %s" % [float(orders1[i]) for i in peaks])
    if peaks:
        nearest = min(peaks, key=lambda i: abs(orders1[i] - o_qw))
        f_sim = orders1[nearest] * rpm / 60.0
        print("  nearest local maximum: order %.1f = %.1f Hz; analytic %.1f Hz; difference %.1f Hz = %.1f%% (resolution +-%.1f Hz)" %
              (orders1[nearest], f_sim, f_qw, f_sim - f_qw, 100 * (f_sim - f_qw) / f_qw, rpm / 240.0))
        if abs(f_sim - f_qw) > rpm / 120.0 + 0.1 * f_qw:
            ok = False
            print("  FAIL: no spectral maximum within one order spacing + 10%% of c/(4L)")
        report["single"] = {"L_m": L, "T_K": TK, "c_m_s": c, "f_qw_Hz": f_qw, "f_sim_peak_Hz": float(f_sim),
                            "orders": orders1.tolist(), "dB_rel": rel1.tolist(), "source_dB": src1.tolist(),
                            "strongest_order": res1["strongest_order"], "periodicity": res1["periodicity_rms"]}
    else:
        ok = False
        print("  FAIL: no local maximum found")
    with open(os.path.join(HERE, "runs", "sound_sanity_%d.json" % rpm), "w") as f:
        json.dump(report, f, indent=1)
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
