#!/usr/bin/env python3
"""order_compare.py - compare a recording's engine-order spectrum with the simulated one (wam_sound.py).

    python3 order_compare.py recording.wav --rpm 1915 [--t0 11 --t1 16] --model sim_orders.json
                             [--min-order 2] [--max-order 12] [--exclude 0.5 1] [--win 0.5] [--json out.json]
    python3 order_compare.py recording.wav --rpm 1915 --model-wav sim.wav ...        (both sides by the same method)
    python3 order_compare.py --self-test                                             (synthetic check, see below)

Method (the same as outback_rec/order_spectrum.py): Hann windows of --win seconds, 50 % overlap, Welch average
over the clip (--t0/--t1), then the power integrated over +-0.15 order around every half order k/2 * rpm/60 (so
a small rpm wander does not drop a peak). The recording's absolute level is unknown (unknown mic, gain, AGC), so
only RELATIVE levels are compared: both spectra are expressed relative to their strongest order within the
compared set, and the table also gives the delta after removing the mean offset over the compared orders
(a pure gain difference does not count as an error).

Output: a table (order, Hz, measured dB rel, model dB rel, delta dB) and the RMS of the mean-removed deltas.
What the RMS means: it is the typical dB by which the model's relative order levels miss the recording's; 0 means
the same spectral shape, 3 dB is a factor 1.4 in amplitude, 10 dB a factor 3. Orders below the firing order of a
four-stroke four (order 2) and the 2nd order at idle (25 Hz at 750 rpm) are physically suppressed in a recording:
monopole radiation grows with f^2 relative to the volume flow, and phone/recorder microphones roll off below
~50-100 Hz, so --min-order sets where the comparison starts.

--self-test: wam_sound's own output (runs/snd_i4_41_3000/snd_i4_41_3000.wav, from sound_sanity.py) with
-30 dB white noise added, 0.5 % faster playback and a 6 dB gain change is analysed as if it were a recording and
compared with its _orders.json: every delta must come back within 1 dB and the RMS within 0.5 dB.
"""
import argparse
import json
import math
import os
import sys
import wave

import numpy as np
from scipy.signal import welch

HERE = os.path.dirname(os.path.abspath(__file__))


def read_wav(path):
    """WAV -> (sr, mono float array in [-1, 1]); 8/16/24/32-bit PCM and 32-bit float."""
    with wave.open(path, "rb") as w:
        sr, nch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, "<i2").astype(np.float64) / 32768.0
    elif sw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v >= 1 << 23, v - (1 << 24), v)
        x = v.astype(np.float64) / float(1 << 23)
    elif sw == 4:
        x = np.frombuffer(raw, "<i4").astype(np.float64) / float(1 << 31)
    elif sw == 1:
        x = (np.frombuffer(raw, np.uint8).astype(np.float64) - 128.0) / 128.0
    else:
        raise ValueError("unsupported sample width %d" % sw)
    if nch > 1:
        x = x.reshape(-1, nch).mean(axis=1)
    return sr, x


def order_levels(x, sr, rpm, orders, win=0.5, band=0.15):
    """Welch (Hann, 50 % overlap) power integrated over +-band order around each order -> dB (arbitrary ref)."""
    n = int(win * sr)
    n = min(n, len(x))
    fr, P = welch(x, sr, window="hann", nperseg=n, noverlap=n // 2)
    f1 = rpm / 60.0
    out = []
    for o in orders:
        m = (fr >= (o - band) * f1) & (fr <= (o + band) * f1)
        out.append(10 * math.log10(float(P[m].sum()) * (fr[1] - fr[0]) + 1e-30))
    return np.array(out)


def compare(meas, model, orders, min_order=2.0, max_order=12.0, exclude=()):
    orders = np.asarray(orders, float)
    meas, model = np.asarray(meas, float), np.asarray(model, float)
    sel = (orders >= min_order) & (orders <= max_order) & ~np.isin(orders, list(exclude))
    sel &= np.isfinite(meas) & np.isfinite(model)
    m_rel = meas - meas[sel].max()
    s_rel = model - model[sel].max()
    offset = float(np.mean(s_rel[sel] - m_rel[sel]))
    delta = s_rel - m_rel - offset
    rms = float(np.sqrt(np.mean(delta[sel] ** 2)))
    return {"orders": orders.tolist(), "measured_dB_rel": m_rel.tolist(), "model_dB_rel": s_rel.tolist(),
            "delta_dB": delta.tolist(), "compared": sel.tolist(), "mean_offset_dB": offset, "rms_delta_dB": rms,
            "max_abs_delta_dB": float(np.max(np.abs(delta[sel]))), "n_compared": int(sel.sum())}


def print_table(cmp, rpm, title=""):
    if title:
        print(title)
    print("%6s %8s %12s %10s %9s" % ("order", "Hz", "measured dB", "model dB", "delta dB"))
    for o, m, s, d, c in zip(cmp["orders"], cmp["measured_dB_rel"], cmp["model_dB_rel"], cmp["delta_dB"], cmp["compared"]):
        print("%6.1f %8.1f %12.1f %10.1f %9s" % (o, o * rpm / 60.0, m, s, ("%+.1f" % d) if c else "  (not compared)"))
    print("RMS of the deltas over %d compared orders: %.2f dB (largest %.1f dB; mean offset %.1f dB removed, it is only gain)." %
          (cmp["n_compared"], cmp["rms_delta_dB"], cmp["max_abs_delta_dB"], cmp["mean_offset_dB"]))
    r = cmp["rms_delta_dB"]
    print("Meaning: the model's relative order levels miss the recording's by %.1f dB typically, i.e. a factor %.2f in amplitude%s." %
          (r, 10 ** (r / 20.0), " - the same spectral shape" if r < 1.0 else (" - a close match" if r < 3.0 else (" - the right picture, levels off" if r < 6.0 else " - the balance between orders is not reproduced"))))


def self_test():
    base = os.path.join(HERE, "runs", "snd_i4_41_3000")
    wav = os.path.join(base, "snd_i4_41_3000.wav")
    js = os.path.join(base, "snd_i4_41_3000_orders.json")
    if not os.path.exists(wav) or not os.path.exists(js):
        print("self-test needs %s and %s (run sound_sanity.py first)" % (wav, js))
        return 1
    sr, x = read_wav(wav)
    with open(js) as f:
        sim = json.load(f)
    rng = np.random.default_rng(1)
    rms = math.sqrt(float(np.mean(x ** 2)))
    # a "recording": 6 dB quieter, 0.5 % faster (rpm wander), white noise 30 dB below the signal
    t = np.arange(len(x)) / sr
    xr = np.interp(t * 1.005, t, x) * 0.5 + rng.normal(0.0, rms * 10 ** (-30 / 20.0), len(x))
    orders = np.array(sim["orders"])
    meas = order_levels(xr, sr, sim["rpm"], orders)
    model = np.array(sim["spl_dB"])
    cmp = compare(meas, model, orders, min_order=2.0, max_order=12.0, exclude=())
    # only the even orders carry energy on an even-firing four; the others are numerical noise -> compare orders 2, 4, 6 ...
    even = [o for o in orders if o >= 2 and abs(o / 2 - round(o / 2)) < 1e-9]
    cmp2 = compare(meas, model, orders, min_order=2.0, max_order=12.0, exclude=[o for o in orders if o not in even])
    print_table(cmp2, sim["rpm"], "self-test: simulated WAV (+noise, +0.5%% speed, -6 dB) vs its own order JSON, %d rpm, even orders" % sim["rpm"])
    ok = cmp2["max_abs_delta_dB"] <= 1.0 and cmp2["rms_delta_dB"] <= 0.5
    print("all orders incl. the empty half/odd ones (noise floor, expected to disagree): RMS %.1f dB" % cmp["rms_delta_dB"])
    print("self-test " + ("PASS" if ok else "FAIL"))
    return 0 if ok else 1


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("wav", nargs="?")
    ap.add_argument("--rpm", type=float)
    ap.add_argument("--t0", type=float, default=0.0)
    ap.add_argument("--t1", type=float)
    ap.add_argument("--model", help="wam_sound.py _orders.json")
    ap.add_argument("--model-wav", help="simulated WAV, analysed by the same Welch method instead of --model")
    ap.add_argument("--measured-json", help="recording_orders.json entry instead of analysing the WAV: file.json:key")
    ap.add_argument("--min-order", type=float, default=2.0)
    ap.add_argument("--max-order", type=float, default=12.0)
    ap.add_argument("--exclude", type=float, nargs="*", default=[])
    ap.add_argument("--win", type=float, default=0.5, help="Hann window s (default 0.5)")
    ap.add_argument("--json", help="write the comparison here")
    ap.add_argument("--note", default="", help="text printed under the table")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args(argv[1:])
    if a.self_test:
        return self_test()
    if not a.rpm or not (a.model or a.model_wav):
        ap.error("need a WAV (or --measured-json), --rpm and --model or --model-wav")
    orders = np.arange(0.5, a.max_order + 1e-9, 0.5)
    if a.measured_json:
        path, key = a.measured_json.rsplit(":", 1)
        with open(path) as f:
            ent = json.load(f)[key]
        lev = ent["orders_dB_rel"]
        meas = np.array([lev.get("%g" % o, lev.get(str(float(o)), np.nan)) for o in orders], float)
        src = "%s[%s] (%s, %s s, %s rpm)" % (os.path.basename(path), key, ent.get("file"), ent.get("t"), ent.get("rpm"))
    else:
        sr, x = read_wav(a.wav)
        i0, i1 = int(a.t0 * sr), int(a.t1 * sr) if a.t1 else len(x)
        meas = order_levels(x[i0:i1], sr, a.rpm, orders, win=a.win)
        src = "%s %.1f-%.1f s" % (os.path.basename(a.wav), a.t0, (i1 / sr))
    if a.model:
        with open(a.model) as f:
            sim = json.load(f)
        so = np.array(sim["orders"])
        model = np.array([sim["spl_dB"][list(so).index(o)] if o in so else np.nan for o in orders])
        if abs(sim["rpm"] - a.rpm) > 0.02 * a.rpm:
            print("WARNING: model rpm %.0f differs from %.0f" % (sim["rpm"], a.rpm))
        msrc = os.path.basename(a.model)
    else:
        sr2, xm = read_wav(a.model_wav)
        model = order_levels(xm, sr2, a.rpm, orders, win=a.win)
        msrc = os.path.basename(a.model_wav)
    cmp = compare(meas, model, orders, a.min_order, a.max_order, a.exclude)
    print_table(cmp, a.rpm, "recording %s  vs  model %s  at %.0f rpm, orders %g-%g%s" %
                (src, msrc, a.rpm, a.min_order, a.max_order, (", excluding " + ", ".join("%g" % e for e in a.exclude)) if a.exclude else ""))
    if a.note:
        print(a.note)
    if a.json:
        cmp.update({"rpm": a.rpm, "recording": src, "model": msrc, "min_order": a.min_order, "max_order": a.max_order,
                    "exclude": list(a.exclude), "note": a.note})
        with open(a.json, "w") as f:
            json.dump(cmp, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
