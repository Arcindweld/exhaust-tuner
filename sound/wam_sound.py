#!/usr/bin/env python3
"""wam_sound.py - exhaust sound from the OpenWAM open-end outflow (make_wam.py v3, run setting ins_outlet=1).

    python3 wam_sound.py <name>INS.DAT --rpm 1915 [--spec spec.json --run run.json] [--out base]
                         [--r 1.0] [--theta 45] [--ground] [--d-mm 60.3] [--fs 44100] [--seconds 5]
                         [--cycles 2] [--orders 12]

Acoustic model (stated assumptions)
  * The tailpipe open end is a compact monopole: the sound comes from the fluctuating mass outflow through
    the exit plane, the OpenWAM open-end boundary cell (last node of the tailpipe, pressure there is held at
    ambient during outflow, so the pressure column is NOT the sound). This is the classic low-frequency
    unflanged/flanged-pipe radiation model, valid for k*a << 1 (a = tip radius): at 60 mm, k*a = 1 at 1.8 kHz;
    the engine orders of interest (< 500 Hz) are well inside it.
  * Free-field monopole:   p'(r, t) = (1 / (4 pi r)) * d m_dot(t - r/c0) / dt      [mass-flow form]
    which equals rho0/(4 pi r) * dQ/dt with Q = u*A when the jet density is rho0; the mass-flow form is used
    because the exhaust gas is hot (rho ~ 0.5 kg/m3) and OpenWAM gives m_dot directly (F_duct column).
    The retarded time only shifts the signal and is dropped.
  * --theta: a flanged piston of radius a has directivity D = 2 J1(k a sin th) / (k a sin th); it is applied
    per harmonic (it is 1.0 within 0.3 dB below 1 kHz for a 60 mm tip at 45 deg, i.e. a monopole).
  * --ground: microphone on a rigid ground plane next to a downturned tip -> pressure doubling, +6 dB on
    every harmonic (a single path, no comb filter). It cancels in relative order levels.
  * Steady speed: the last N complete engine cycles of INS.DAT are read (make_wam.read_ins); the last
    cycle is resampled to exactly n = round(fs * 120 / rpm) samples per 720 deg (the effective speed is then
    120 fs / n, within 0.05 % of rpm) and tiled to --seconds. The derivative is taken spectrally on the
    periodic cycle, so the loop joins without a click. Cycle-to-cycle periodicity (RMS difference of the
    last two cycles relative to the signal RMS) is reported: it should be a few percent or less.
  * The WAV is 16-bit PCM, normalised so the peak is -1 dBFS; "pa_per_fullscale" in the JSON gives the
    pressure of a full-scale sample, and the JSON carries the absolute SPL of the model.

Outputs  <out>.wav  and  <out>_orders.json:
  {rpm, fs, r_m, theta_deg, ground, orders [0.5 .. --orders], f_Hz, spl_dB (absolute, per order, re 20 uPa, rms),
   dB_rel (relative to the strongest order), overall_spl_dB, overall_spl_dBA, strongest_order,
   source_orders_dB (spectrum of m_dot itself, relative), periodicity_rms, pa_per_fullscale, assumptions}
"""
import argparse
import json
import math
import os
import struct
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_wam  # noqa: E402

P_REF = 20e-6


def a_weight_db(f):
    f = np.asarray(f, dtype=float)
    f2 = f * f
    ra = (12194.0 ** 2 * f2 * f2) / ((f2 + 20.6 ** 2) * np.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194.0 ** 2))
    with np.errstate(divide="ignore"):
        return 20 * np.log10(ra) + 2.00


def resample_cycle(t, y, n):
    """One period of a periodic signal sampled at (possibly uneven) times t -> n evenly spaced samples.
    The period is t[-1] - t[0] plus one more step (the next cycle starts where this one ends)."""
    t = np.asarray(t, float)
    y = np.asarray(y, float)
    T = (t[-1] - t[0]) * len(t) / (len(t) - 1)          # include the last sample's own step
    tt = np.concatenate([t, [t[0] + T]])
    yy = np.concatenate([y, [y[0]]])                      # periodic closure
    grid = t[0] + T * np.arange(n) / n
    return np.interp(grid, tt, yy), T


def _last_cycle(ins, rpm, fs):
    """The last complete engine cycle of the open-end mass flow, resampled to n = round(fs * 120 / rpm) samples,
    and the cycle-to-cycle periodicity of the last two cycles."""
    t = np.asarray(ins["time"])
    md = np.asarray(ins["mdot"])
    ang = np.asarray(ins["angle"])
    starts = [0] + [i for i in range(1, len(ang)) if ang[i] < ang[i - 1] - 180.0]
    T_cyc = 120.0 / rpm
    n = int(round(fs * T_cyc))
    cycles = []
    for i in range(len(starts)):
        s = starts[i]
        e = starts[i + 1] if i + 1 < len(starts) else len(t)
        if e - s < 10:
            continue
        yc, Tc = resample_cycle(t[s:e], md[s:e], n)
        cycles.append((yc, Tc))
    if not cycles:
        raise ValueError("no complete cycle in the INS data")
    y, T_meas = cycles[-1]
    periodicity = None
    if len(cycles) >= 2:
        y0 = cycles[-2][0]
        periodicity = float(np.sqrt(np.mean((y - y0) ** 2)) / (np.sqrt(np.mean((y - y.mean()) ** 2)) + 1e-30))
    return y, T_meas, periodicity, n


def _radiate(y, rpm, r, theta_deg, d_tip_m, c0):
    """Pressure harmonics at distance r of a compact monopole driven by the periodic mass flow y (one cycle):
    p' = (1/(4 pi r)) d m_dot/dt, the derivative taken spectrally, times the flanged-piston directivity."""
    Y = np.fft.rfft(y)
    k = np.arange(len(Y))
    f = k * rpm / 120.0
    omega = 2 * np.pi * f
    P = (1j * omega) * Y / (4 * np.pi * r)              # pressure harmonics (complex, FFT scaling of y)
    # directivity of a flanged piston at theta
    if d_tip_m and theta_deg:
        from scipy.special import j1
        a = d_tip_m / 2.0
        x = (omega / c0) * a * math.sin(math.radians(theta_deg))
        D = np.ones_like(x)
        nz = x > 1e-9
        D[nz] = 2 * j1(x[nz]) / x[nz]
        P = P * D
    return P, Y, f, omega


def _result(P, Y, f, n, rpm, fs, seconds, orders_max, ground, y, T_meas, periodicity):
    if ground:
        P = P * 2.0
    P[0] = 0.0
    p_cycle = np.fft.irfft(P, n)                        # one period of p'(t) in Pa
    reps = int(math.ceil(seconds * fs / n))
    sig = np.tile(p_cycle, reps)[: int(seconds * fs)]
    # order spectrum: rms amplitude of each harmonic -> SPL
    amp = np.abs(P) / n                                 # peak amplitude of each harmonic (two-sided -> one-sided x2 below)
    amp[1:] *= 2.0
    rms = amp / math.sqrt(2.0)
    orders = np.arange(0.5, orders_max + 1e-9, 0.5)
    kk = np.rint(orders * 2).astype(int)
    spl = 20 * np.log10(np.maximum(rms[kk], 1e-12) / P_REF)
    top = spl.max()
    # source spectrum (mass flow) for reference
    src = np.abs(Y) / n
    src[1:] *= 2.0
    src_db = 20 * np.log10(np.maximum(src[kk], 1e-15))
    src_db -= src_db.max()
    overall = 10 * np.log10(np.sum(rms[1:] ** 2) / P_REF ** 2)
    aw = a_weight_db(f[1:])
    overall_a = 10 * np.log10(np.sum((rms[1:] * 10 ** (aw / 20)) ** 2) / P_REF ** 2)
    return {
        "signal": sig, "p_cycle": p_cycle, "fs": fs, "n_per_cycle": n, "rpm_effective": 120.0 * fs / n,
        "T_cycle_measured_s": T_meas, "periodicity_rms": periodicity,
        "orders": orders.tolist(), "f_Hz": (orders * rpm / 60.0).tolist(), "spl_dB": spl.tolist(),
        "dB_rel": (spl - top).tolist(), "strongest_order": float(orders[int(np.argmax(spl))]),
        "source_orders_dB": src_db.tolist(), "overall_spl_dB": float(overall), "overall_spl_dBA": float(overall_a),
        "mdot_mean_kg_s": float(y.mean()), "mdot_pp_kg_s": float(y.max() - y.min()),
    }


def synthesize(ins, rpm, r=1.0, theta_deg=45.0, ground=False, d_tip_m=None, fs=44100, seconds=5.0, orders_max=12.0,
               c0=343.0, rho0=1.2):
    y, T_meas, periodicity, n = _last_cycle(ins, rpm, fs)
    P, Y, f, _ = _radiate(y, rpm, r, theta_deg, d_tip_m, c0)
    return _result(P, Y, f, n, rpm, fs, seconds, orders_max, ground, y, T_meas, periodicity)


def synthesize_multi(sources, rpm, ground=False, fs=44100, seconds=5.0, orders_max=12.0, c0=343.0):
    """Several open ends heard at one microphone (a muffler box with two exits, dual tips): each outlet is a compact
    monopole at its own distance r and angle theta (flanged-piston directivity with its own tip diameter), and the
    complex harmonics are summed with the phase of the path difference, exp(-j w (r_i - r_min) / c0): the outlets
    are coherent (the same cycle of the same model), so they interfere order by order.
        sources: [{"ins": read_ins(...) of that outlet's pipe, "r": m, "theta_deg": deg, "d_tip_m": m or None}, ...]
    The mass-flow spectrum in the result ("source_orders_dB", mdot_*) is that of the summed outflow."""
    if not sources:
        raise ValueError("no sources")
    rmin = min(float(sc["r"]) for sc in sources)
    P_sum, y_sum, per = None, None, []
    T_meas = periodicity = n = None
    for sc in sources:
        y, T_meas, per_i, n_i = _last_cycle(sc["ins"], rpm, fs)
        if n is not None and n_i != n:
            raise ValueError("the outlets' INS data do not share one cycle")
        n = n_i
        P, Y, f, omega = _radiate(y, rpm, float(sc["r"]), sc.get("theta_deg"), sc.get("d_tip_m"), c0)
        P = P * np.exp(-1j * omega * (float(sc["r"]) - rmin) / c0)
        P_sum = P if P_sum is None else P_sum + P
        y_sum = y if y_sum is None else y_sum + y
        if per_i is not None:
            periodicity = per_i if periodicity is None else max(periodicity, per_i)
        rms_i = np.abs(P[1:]) / n * 2.0 / math.sqrt(2.0) * (2.0 if ground else 1.0)
        per.append({"r_m": float(sc["r"]), "theta_deg": sc.get("theta_deg"), "pipe": sc["ins"].get("pipe"),
                    "mdot_mean_kg_s": float(y.mean()), "overall_spl_dB": float(10 * np.log10(np.sum(rms_i ** 2) / P_REF ** 2))})
    out = _result(P_sum, np.fft.rfft(y_sum), f, n, rpm, fs, seconds, orders_max, ground, y_sum, T_meas, periodicity)
    out["sources"] = per
    return out


def write_wav(path, sig, fs, peak_dbfs=-1.0):
    peak = float(np.max(np.abs(sig))) or 1.0
    scale = 10 ** (peak_dbfs / 20.0) / peak
    x = np.clip(sig * scale, -1.0, 1.0)
    pcm = (x * 32767.0).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(fs))
        w.writeframes(pcm.tobytes())
    return 1.0 / scale            # Pa per full scale


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("ins", help="<name>INS.DAT written with ins_outlet=1")
    ap.add_argument("--rpm", type=float, required=True)
    ap.add_argument("--spec", help="simSpec JSON the model was built from (gives the model for exact outlet/port detection)")
    ap.add_argument("--run", help="JSON of the run settings used (with --spec)")
    ap.add_argument("--pipe", type=int, help="outlet pipe number (several collectors)")
    ap.add_argument("--out", help="output base name (default: next to the INS file)")
    ap.add_argument("--r", type=float, default=1.0, help="listener distance m (default 1)")
    ap.add_argument("--theta", type=float, default=45.0, help="angle off the tip axis deg (default 45)")
    ap.add_argument("--ground", action="store_true", help="ground-plane microphone: +6 dB pressure doubling")
    ap.add_argument("--d-mm", type=float, help="tip inner diameter mm for the piston directivity (default: from --spec tail, else none)")
    ap.add_argument("--fs", type=int, default=44100)
    ap.add_argument("--seconds", type=float, default=5.0)
    ap.add_argument("--cycles", type=int, default=2, help="INS cycles to read (last N complete)")
    ap.add_argument("--orders", type=float, default=12.0)
    a = ap.parse_args(argv[1:])
    model = None
    if a.spec:
        with open(a.spec) as f:
            spec = json.load(f)
        run = {}
        if a.run:
            with open(a.run) as f:
                run = json.load(f)
        run.setdefault("rpm", a.rpm)
        model = make_wam.model_from_spec(spec, run)
    with open(a.ins) as f:
        ins = make_wam.read_ins(f.read(), pipe=a.pipe, keep_cycles=a.cycles, model=model)
    d_tip = a.d_mm / 1000.0 if a.d_mm else None
    if d_tip is None and model is not None:
        pp = model["pipes"][ins["pipe"] - 1]
        d_tip = pp["secs"][-1][1]
    res = synthesize(ins, a.rpm, r=a.r, theta_deg=a.theta, ground=a.ground, d_tip_m=d_tip, fs=a.fs,
                     seconds=a.seconds, orders_max=a.orders)
    base = a.out or os.path.splitext(a.ins)[0].replace("INS", "") + "_%drpm" % int(round(a.rpm))
    pa_fs = write_wav(base + ".wav", res["signal"], a.fs)
    out = {k: v for k, v in res.items() if k not in ("signal", "p_cycle")}
    out.update({"rpm": a.rpm, "r_m": a.r, "theta_deg": a.theta, "ground": bool(a.ground), "d_tip_m": d_tip,
                "ins_file": os.path.abspath(a.ins), "outlet_pipe": ins["pipe"], "ins_cycles_read": ins["cycles"],
                "pa_per_fullscale": pa_fs, "wav": os.path.abspath(base + ".wav"),
                "assumptions": [
                    "compact monopole at the tailpipe exit plane: p'(r,t) = (1/(4 pi r)) d m_dot/dt, m_dot = OpenWAM mass flow at the open-end boundary cell",
                    "flanged-piston directivity 2J1(ka sin th)/(ka sin th) applied per harmonic" if d_tip else "omnidirectional (no tip diameter given)",
                    "ground-plane microphone, pressure doubling +6 dB on every harmonic (cancels in relative levels)" if a.ground else "free field",
                    "steady speed, last complete OpenWAM cycle tiled; effective speed %.2f rpm" % res["rpm_effective"],
                    "no atmospheric or ground absorption, no flow noise, no shell/structure noise, no intake noise",
                ]})
    with open(base + "_orders.json", "w") as f:
        json.dump(out, f, indent=1)
    print("wrote %s.wav (%.1f s, %d Hz) and %s_orders.json" % (base, a.seconds, a.fs, base))
    print("rpm %.0f: strongest order %.1f, overall %.1f dB SPL (%.1f dBA) at r = %g m%s; periodicity %s; m_dot mean %.4f kg/s, p-p %.4f" %
          (a.rpm, res["strongest_order"], res["overall_spl_dB"], res["overall_spl_dBA"], a.r, ", ground plane" if a.ground else "",
           "%.3f" % res["periodicity_rms"] if res["periodicity_rms"] is not None else "n/a", res["mdot_mean_kg_s"], res["mdot_pp_kg_s"]))
    print("order : " + " ".join("%5.1f" % o for o in res["orders"]))
    print("dB rel: " + " ".join("%5.1f" % v for v in res["dB_rel"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
