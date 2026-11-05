#!/usr/bin/env python3
"""sweep.py - a pull through the revs, and a pass-by, from OpenWAM runs at a few fixed speeds.

A recording is rarely a steady hold: it is a pull through a gear, or the car driving past. OpenWAM settles one speed at a
time, so the sound of a pull is put together from runs at several speeds:

  * each run's tailpipe outflow over one cycle gives every half order's complex amplitude Y_k (k = 1, 2, ... for orders
    0.5, 1, ...); between two runs a harmonic's level is interpolated in dB and its phase along the shorter way round,
    linearly in rpm (the pipe's resonances move smoothly with speed between runs a few hundred rpm apart);
  * the sound is the sum of the harmonics, each with the phase of its own frequency integrated along the rpm track,
    phi_k(t) = 2 pi (k / 2) int rpm / 60 dt, through the monopole p = (1 / 4 pi r) d mdot / dt (wam_sound.py);
  * the tip's jet noise (realism.py) with its power interpolated in dB between the runs and its firing-by-firing swing
    taken from the nearer run's cycle at the current crank angle.

Pass-by: the source moves along a straight line at speed v(t), the microphone d metres from that line. Sound emitted at
t_e from distance r(t_e) arrives at t_r = t_e + r / c0; the received signal is the emitted one at t_e(t_r), over r (and
doubled for a microphone on hard ground), which gives the Doppler shift (f c0 / (c0 - v cos theta)) and the rise and
fall of level. The convective amplification of a moving source (a further factor of about (1 - M cos theta)^-1 for a
monopole, Dowling and Ffowcs Williams, Sound and Sources of Sound, 1983, ch. 9) is left out: at 25 m/s it is 0.6 dB.
"""
import math

import numpy as np

import realism as RZ


def harmonics(ins, rpm, kmax=24, n=4096):
    """One run's outflow harmonics: {"rpm", "Y": complex [kmax] (k = 1..kmax, order k / 2, FFT of one cycle of n points),
    "n", "mean", "jet": {"W": the mean jet power (W) at the run's tip, "U_eff", "env": the jet's amplitude over the
    cycle (n points, mean square 1), "d_m": the tip diameter, from the flow (mdot = rho u A)}}; no "jet" without u, T
    and rho in the INS record."""
    y = RZ.cycle_of(ins, rpm, n)
    Y = np.fft.rfft(y)[1:kmax + 1]
    out = {"rpm": float(rpm), "Y": Y, "n": n, "mean": float(y.mean())}
    if ins.get("u") is not None and ins.get("T") is not None and ins.get("rho") is not None:
        U = RZ.cycle_of_key(ins, rpm, n, "u")
        Tj = RZ.cycle_of_key(ins, rpm, n, "T")
        rho = RZ.cycle_of_key(ins, rpm, n, "rho")
        A = float(np.mean(y) / max(np.mean(rho * U), 1e-12))
        d = math.sqrt(4 * A / math.pi) if A > 0 else None
        if d:
            wj = RZ.jet_power(U, Tj, d)
            out["jet"] = {"W": float(wj.mean()), "U_eff": float(np.mean(np.abs(U) ** 8) ** 0.125),
                          "env": np.sqrt(wj / max(wj.mean(), 1e-30)), "d_m": d}
    return out


def _between(runs, rpm):
    """The two runs either side of rpm and the fraction of the way from the first to the second (clamped at the ends)."""
    rs = [r["rpm"] for r in runs]
    if rpm <= rs[0]:
        return runs[0], runs[0], 0.0
    if rpm >= rs[-1]:
        return runs[-1], runs[-1], 0.0
    i = int(np.searchsorted(rs, rpm)) - 1
    a, b = runs[i], runs[i + 1]
    return a, b, (rpm - a["rpm"]) / (b["rpm"] - a["rpm"])


def harm_at(runs, rpm):
    """Interpolated complex harmonics at rpm: level in dB, phase along the shorter way round."""
    a, b, u = _between(runs, rpm)
    if u == 0.0:
        return a["Y"]
    La, Lb = np.log(np.abs(a["Y"]) + 1e-30), np.log(np.abs(b["Y"]) + 1e-30)
    pa, pb = np.angle(a["Y"]), np.angle(b["Y"])
    dp = (pb - pa + np.pi) % (2 * np.pi) - np.pi
    return np.exp(La + u * (Lb - La)) * np.exp(1j * (pa + u * dp))


def pull(runs, rpm_of_t, seconds, fs=44100, jet=True, seed=7, chunk=0.02):
    """The emitted sound (Pa at 1 m, free field) of the engine following rpm_of_t(t) (a function or (t, rpm) arrays) for
    `seconds`. runs: harmonics() of each run, any order. Returns (p, rpm track per sample)."""
    runs = sorted(runs, key=lambda r: r["rpm"])
    N = int(round(seconds * fs))
    t = np.arange(N) / fs
    if callable(rpm_of_t):
        rp = np.array([rpm_of_t(x) for x in t])
    else:
        rp = np.interp(t, np.asarray(rpm_of_t[0], float), np.asarray(rpm_of_t[1], float))
    cyc = np.cumsum(rp / 120.0) / fs                   # engine cycles turned (a cycle is two revolutions)
    cyc -= cyc[0]
    kmax = len(runs[0]["Y"])
    n = runs[0]["n"]
    k = np.arange(1, kmax + 1)
    p = np.zeros(N)
    step = max(1, int(chunk * fs))                     # harmonics refreshed every `chunk` seconds
    for s0 in range(0, N, step):
        s1 = min(N, s0 + step)
        rm = float(rp[s0:s1].mean())
        Y = harm_at(runs, rm)
        w = 2 * math.pi * k * rm / 120.0               # rad/s of half order k
        ph = 2 * math.pi * np.outer(cyc[s0:s1], k)     # phase of each half order
        # y(t) = mean + (2 / n) sum Re(Y_k e^{j k theta}) -> dy/dt = (2 / n) sum Re(j w_k Y_k e^{j phi_k})
        p[s0:s1] = (2.0 / n) * np.real(np.exp(1j * ph) @ (1j * w * Y)) / (4 * math.pi)
    if jet and all("jet" in r for r in runs):
        Wt = np.zeros(N)
        env = np.zeros(N)
        for s0 in range(0, N, step):
            s1 = min(N, s0 + step)
            rm = float(rp[s0:s1].mean())
            a, b, u = _between(runs, rm)
            Wt[s0:s1] = math.exp(math.log(a["jet"]["W"]) + u * (math.log(b["jet"]["W"]) - math.log(a["jet"]["W"])))
            near = a if u < 0.5 else b
            th = (cyc[s0:s1] % 1.0) * n
            env[s0:s1] = np.interp(th, np.arange(n), near["jet"]["env"], period=n)
        Ue = float(np.mean([r["jet"]["U_eff"] for r in runs]))
        d = runs[0]["jet"]["d_m"]
        noise = RZ.jet_signal(np.ones(N), Ue, d, N, fs, 1.0, False, 1.0, seed=seed)   # unit power at 1 m
        unit = math.sqrt(1.2 * 343.0 * 1.0 / (4 * math.pi))
        p = p + noise / unit * np.sqrt(1.2 * 343.0 * Wt / (4 * math.pi)) * env
    return p, rp


def passby(p_e, fs, v, d, t_closest, c0=343.0, ground=True):
    """The emitted sound p_e (Pa at 1 m) heard by a microphone d m from the line the source drives along at v m/s
    (a number, or an array per sample), closest at t_closest (s of emission time). Returns (p at the microphone, the
    reception times of the output samples, the distance per output sample)."""
    N = len(p_e)
    te = np.arange(N) / fs
    vv = np.full(N, float(v)) if np.isscalar(v) else np.asarray(v, float)
    x = np.cumsum(vv) / fs
    x -= np.interp(t_closest, te, x)
    r = np.sqrt(x * x + d * d)
    tr = te + r / c0
    out_t = np.arange(math.ceil(tr[0] * fs), math.floor(tr[-1] * fs)) / fs
    te_of = np.interp(out_t, tr, te)                   # tr is increasing for a subsonic source
    pe = np.interp(te_of, te, p_e)
    re = np.interp(te_of, te, r)
    return pe / re * (2.0 if ground else 1.0), out_t, re
