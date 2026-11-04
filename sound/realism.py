#!/usr/bin/env python3
"""realism.py - turn one OpenWAM cycle into a sound that varies the way a running engine's does, and measure it the
way a recording is measured.

An OpenWAM run settles to one cycle that repeats exactly, so its sound has every bit of energy on the engine orders
and nothing between them. A real engine does not repeat: each combustion differs from the last (cycle-to-cycle
variation, usually quoted as the coefficient of variation of IMEP: about 1-3 % at part load and up to 5-10 % at
idle for a spark-ignition engine, Heywood, Internal Combustion Engine Fundamentals, ch. 9.4), and the cylinders differ
from each other by a few per cent in air and fuel (cylinder-to-cylinder variation). Both put energy between the
orders: the cycle-to-cycle part as a broadband floor and side bands, the steady cylinder-to-cylinder part on the half
orders.

Here each firing's outflow pulse is scaled by its own gain, 1 + s_c + cov * N(0, 1): s_c is that cylinder's steady
offset, cov the cycle-to-cycle spread. The scaling works on the pulse (the outflow less its mean) inside a smooth
window around each firing, the windows a partition of unity over the cycle, so the mean flow and the cycle's average
shape are unchanged. The tailpipe is then a compact monopole, p = (1 / 4 pi r) d mdot / dt, as wam_sound.py.

Measured as order_spectrum.py measures a recording (Hann windows, Welch average, the power within +-0.15 order of
each half order), plus the floor: the power within +-0.1 order of each quarter order (halfway between two half
orders), relative to the strongest order. A recording's floor against the model's at the same cov is what fits cov.
"""
import math

import numpy as np
from scipy.signal import welch


def cycle_of(ins, rpm, n):
    """The last complete cycle of the INS outflow (mass flow out of the open end), resampled to n points."""
    t = np.asarray(ins["time"], float)
    md = np.asarray(ins["mdot"], float)
    ang = np.asarray(ins["angle"], float)
    starts = [0] + [i for i in range(1, len(ang)) if ang[i] < ang[i - 1] - 180.0]
    s = starts[-2] if len(starts) >= 2 else 0
    e = starts[-1] if len(starts) >= 2 else len(t)
    tc = t[s:e] - t[s]
    T = 120.0 / rpm
    return np.interp(np.arange(n) * T / n, tc, md[s:e], period=T)


def firing_windows(n, nfire, phase0=0.0, overlap=0.5):
    """nfire smooth windows over a cycle of n samples, centred phase0 + k / nfire of the cycle, raised-cosine edges
    `overlap` of a firing interval wide; they add up to one everywhere."""
    x = (np.arange(n) / n - phase0) % 1.0
    W = np.zeros((nfire, n))
    for k in range(nfire):
        c = k / nfire
        d = (x - c + 0.5) % 1.0 - 0.5            # distance from this window's centre, in cycles
        h = 0.5 / nfire                           # half a firing interval
        a = overlap * h
        w = np.where(np.abs(d) <= h - a, 1.0, 0.0)
        edge = (np.abs(d) > h - a) & (np.abs(d) < h + a)
        w[edge] = 0.5 * (1.0 + np.cos(math.pi * (np.abs(d[edge]) - (h - a)) / (2.0 * a)))
        W[k] = w
    return W / W.sum(axis=0)


def pulse_phase(y, nfire):
    """Where the firing-order component of the outflow peaks, as a fraction of the cycle: the windows are centred
    on the pulses."""
    Y = np.fft.rfft(y - y.mean())
    return (-np.angle(Y[nfire]) / (2 * math.pi) / nfire) % (1.0 / nfire)


def rpm_walk(seconds, sd, tau=0.5, dt=0.05, seed=2):
    """Engine speed wander as a fraction of the mean: an Ornstein-Uhlenbeck process with standard deviation sd and
    correlation time tau (s), sampled every dt (s). A hold on the owner's Outback wandered 1.2 % (1980 rpm, 5 s)."""
    rng = np.random.default_rng(seed)
    k = int(math.ceil(seconds / dt)) + 2
    a = math.exp(-dt / tau)
    x = np.zeros(k)
    for i in range(1, k):
        x[i] = a * x[i - 1] + sd * math.sqrt(1 - a * a) * rng.standard_normal()
    return np.arange(k) * dt, x


def realize(ins, rpm, nfire, seconds=20.0, fs=22050, cov=0.02, spread=None, seed=1, r=1.0, ground=True,
            wander=None):
    """A pressure signal at r (Pa) of `seconds` of running: every firing scaled by 1 + spread[k] + cov N(0, 1).
    spread: one steady offset per firing in the cycle (None = all zero). wander: (t, fraction) of the engine speed
    (rpm_walk, or a measured track divided by its mean, less one): each cycle is stretched to its own length, so
    the orders spread as a recording's do. The cycle's shape is kept in crank angle (a fair first step: the pipe's
    own resonances do not move with speed, so this smears them slightly too)."""
    rng = np.random.default_rng(seed)
    n = int(round(fs * 120.0 / rpm))
    y = cycle_of(ins, rpm, n)
    W = firing_windows(n, nfire, pulse_phase(y, nfire))
    m = y.mean()
    dev = y - m
    s = np.zeros(nfire) if spread is None else np.asarray(spread, float)
    ncyc = int(math.ceil(seconds * fs / n * 1.1)) + 1
    g = 1.0 + s[None, :] + cov * rng.standard_normal((ncyc, nfire))
    rows = m + (g @ W) * dev[None, :]                       # each row: that cycle's outflow
    if wander is None:
        sig = rows.ravel()
    else:
        tw, fw = wander
        out, t = [], 0.0
        for row in rows:
            f = 1.0 + float(np.interp(t, tw, fw))
            ni = max(8, int(round(n / f)))                  # a faster cycle is shorter
            out.append(np.interp(np.arange(ni) * n / ni, np.arange(n), row, period=n))
            t += ni / fs
            if t > seconds:
                break
        sig = np.concatenate(out)
    # monopole: derivative in the frequency domain of the whole record, then 1 / (4 pi r), ground doubling
    F = np.fft.rfft(sig)
    w = 2 * math.pi * np.fft.rfftfreq(len(sig), 1.0 / fs)
    p = np.fft.irfft(1j * w * F, len(sig)) / (4 * math.pi * r) * (2.0 if ground else 1.0)
    return p[: int(seconds * fs)], fs


def levels(x, fs, rpm, ord_max=12.0, win=0.5):
    """Half-order levels and the quarter-order floor, dB relative to the strongest order (order_spectrum.py's method)."""
    nper = int(win * fs)
    fr, P = welch(x, fs, window="hann", nperseg=nper, noverlap=nper // 2)
    f1 = rpm / 60.0
    df = fr[1] - fr[0]
    band = lambda o, hw: 10 * np.log10(P[(fr >= (o - hw) * f1) & (fr <= (o + hw) * f1)].sum() * df + 1e-30)
    orders = np.arange(0.5, ord_max + 1e-9, 0.5)
    lev = {float(o): band(o, 0.15) for o in orders}
    flo = {float(o + 0.25): band(o + 0.25, 0.1) for o in orders[:-1]}
    top = max(lev.values())
    return {k: v - top for k, v in lev.items()}, {k: v - top for k, v in flo.items()}
