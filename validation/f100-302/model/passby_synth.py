#!/usr/bin/env python3
"""passby_synth.py - the F-100's second pass-by (26:05 in the video) put together from the OpenWAM runs at 5000, 5400,
5800 and 6200 rpm (sound/sweep.py): the truck pulls in one gear past a roadside microphone. The rpm track and the
speed come from the recording's own order 4 line (recording_orders.json: 4650 -> 5840 rpm apparent through the pull);
the road speed from the gearing is a guess (3rd of a TKX, 3.73 axle, 28 in tyre: about 70 mph at 5800). Writes
passby_model.wav beside this file and prints the order levels in the same windows the recording was read in, so the
two can be compared window by window.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "sound"))
sys.path.insert(0, os.path.join(HERE, "..", "..", "..", "openwam"))
import f100          # noqa: E402
import make_wam      # noqa: E402
import sweep as SW   # noqa: E402
import wam_sound     # noqa: E402

SPEEDS = ["ho_venom_plenum_x400_5000", "ho_venom_plenum_x400_5400", "ho_venom_plenum_x400_5800", "ho_venom_plenum_x400_6200"]
FS = 44100


def load_runs():
    runs = []
    for name in SPEEDS:
        fo, mu, rpm = f100.CASES[name][:3]
        folder = os.path.join(HERE, "runs", name)
        if not os.path.exists(os.path.join(folder, name + "INS.DAT")):
            continue
        model = make_wam.model_from_spec(f100.build_spec(fo, mu, *f100.CASES[name][3:]), f100.run_settings(rpm, 1, name))
        txt = open(os.path.join(folder, name + "INS.DAT")).read()
        b = make_wam.read_ins(txt, keep_cycles=2, model=model)
        ins = make_wam.read_ins(txt, pipe=b["outlets"][0], keep_cycles=2, model=model)
        runs.append(SW.harmonics(ins, rpm))
    return runs


if __name__ == "__main__":
    runs = load_runs()
    if len(runs) < 2:
        sys.exit("need at least two speeds run: python3 f100.py run " + " ".join(SPEEDS))
    print("runs at", [r["rpm"] for r in runs])
    # the pull: 4650 -> 5850 rpm over 7.5 s (pass 2, 1565.6-1573 s), as the recording's apparent track rises; the
    # Doppler is taken out of the emitted rpm by the pass-by itself, so the engine track is the apparent one divided by
    # the Doppler factor at each moment (approaching: apparent higher), done by iteration below
    T = 7.5
    v_mph = 70.0 * 5800.0 / 5800.0
    v = v_mph * 0.44704
    d = 8.0                                   # microphone from the truck's line [est]
    t_close = 3.0                             # it passes the microphone 3 s into the pull (the level peaks there)
    app = lambda t: 4650.0 + (5850.0 - 4650.0) * t / T
    c0 = 343.0
    tt = np.arange(0, T, 1.0 / FS)
    x = v * (tt - t_close)
    cos_th = -x / np.sqrt(x * x + d * d)      # +1 approaching
    dop = c0 / (c0 - v * cos_th)
    eng_rpm = app(tt) / dop
    p_e, rp = SW.pull(runs, (tt, eng_rpm), T, fs=FS, jet=True)
    p_m, t_r, r_m = SW.passby(p_e, FS, v, d, t_close, ground=True)
    wam_sound.write_wav(os.path.join(HERE, "passby_model.wav"), p_m, FS)
    print("wrote passby_model.wav: %.1f s, engine %.0f-%.0f rpm, %.0f mph, closest %.0f m" % (len(p_m) / FS, eng_rpm.min(), eng_rpm.max(), v_mph, d))
    # order levels in 0.4 s windows as the recording was read (the apparent rpm from the firing line itself)
    rec = json.load(open(os.path.join(HERE, "..", "recording_orders.json")))["pass2_pull_a"]
    O = np.arange(0.5, 12.01, 0.5)
    win = int(0.4 * FS)
    rows = []
    for a in np.arange(0.2, len(p_m) / FS - 0.4, 0.2):
        seg = p_m[int(a * FS):int(a * FS) + win] * np.hanning(win)
        P = np.abs(np.fft.rfft(seg, 1 << 17)) ** 2
        fr = np.fft.rfftfreq(1 << 17, 1.0 / FS)
        # the firing line is near 4 x the apparent rpm at this moment of the pull (the output starts d/c0 after the pull)
        f4 = 4 * app(min(T, max(0.0, a + 0.2 - d / c0))) / 60.0
        # refine it within +-4 %
        m = (fr > f4 * 0.96) & (fr < f4 * 1.04)
        f4 = fr[m][np.argmax(P[m])]
        f1 = f4 / 4.0
        lev = np.array([10 * np.log10(P[(fr > (o - 0.15) * f1) & (fr < (o + 0.15) * f1)].sum() + 1e-30) for o in O])
        rows.append(lev - lev.max())
    M = np.mean(rows, axis=0)
    R = np.array([rec["orders_dB_rel"]["%g" % o] for o in O])
    print("order   " + " ".join("%5g" % o for o in O))
    print("model   " + " ".join("%5.0f" % v for v in M))
    print("record  " + " ".join("%5.0f" % v for v in R))
    k = O >= 1.5
    print("clipped RMS at -25 dB over orders 1.5-12: %.1f dB" % math.sqrt(np.mean((np.maximum(M[k], -25) - np.maximum(R[k], -25)) ** 2)))
