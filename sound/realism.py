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

JET NOISE (jet=): the gas leaving the tip is a hot subsonic jet, and its turbulent mixing radiates broadband noise that
the 1-D model has none of. Its power follows Lighthill's eighth-power law, W = K rho0 U^8 D^2 / c0^5 (Lighthill 1952;
K is quoted between about 3e-5 and 1.2e-4, e.g. Goldstein, Aeroacoustics, 1976; 6e-5 is used, so +-3 dB), times
(rho_j / rho0)^omega for a hot jet, omega = 3 M^3.5 / (0.6 + M^3.5) - 1, M = U / c0 (Hoch, Duponchel, Cocking and Bryce
1973, as SAE ARP876 uses it): at exhaust speeds omega is close to -1, so a jet at twice the ambient temperature is about
3 dB louder than a cold one. The spectrum is broadband, its third-octave level peaking at a Strouhal number f D / U of
about 0.2 and falling about 6 dB per octave below the peak and 3 dB per octave above it (a smooth stand-in for the
fine-scale similarity spectrum, Tam, Golebiowski and Seiner 1996). The tip's gas speed swings through every firing,
so the noise is modulated: the instantaneous power follows U(t)^8, which is what makes an exhaust's roar pulse with
the firing. Free field p^2 = rho0 c0 W / (4 pi r^2), no directivity (a jet radiates most at 30-40 deg off its axis
and a few dB less at 90).
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


def cycle_of_key(ins, rpm, n, key):
    """As cycle_of, for another INS column (u, T, p)."""
    t = np.asarray(ins["time"], float)
    v = np.asarray(ins[key], float)
    ang = np.asarray(ins["angle"], float)
    starts = [0] + [i for i in range(1, len(ang)) if ang[i] < ang[i - 1] - 180.0]
    s = starts[-2] if len(starts) >= 2 else 0
    e = starts[-1] if len(starts) >= 2 else len(t)
    T = 120.0 / rpm
    return np.interp(np.arange(n) * T / n, t[s:e] - t[s], v[s:e], period=T)


JET_K = 6.0e-5        # Lighthill's constant (3e-5 to 1.2e-4 in the literature)
JET_ST = 0.2          # Strouhal number of the spectrum's peak


def jet_omega(M):
    """Hoch et al. (1973) density exponent: the intensity of a jet at density rho_j goes as (rho_j / rho0)^omega."""
    m = abs(M) ** 3.5
    return 3.0 * m / (0.6 + m) - 1.0


def jet_power(U, Tj, D, T0=298.15, rho0=1.2, c0=343.0, K=JET_K):
    """Acoustic power (W) of a round jet of speed U (m/s), gas temperature Tj (K) and diameter D (m)."""
    U = np.abs(np.asarray(U, float))
    rr = T0 / np.asarray(Tj, float)                        # rho_j / rho0 at the same pressure
    return K * rho0 * U ** 8 * D ** 2 / c0 ** 5 * rr ** jet_omega(U / c0)


def jet_band_shape(f, fp):
    """Third-octave level shape of the jet spectrum (linear, peak 1 at fp): x^2 / (1 + x^3) with x = f / f0 peaks at
    x = 2^(1/3), so f0 = fp / 2^(1/3)."""
    x = np.asarray(f, float) / (fp / 2 ** (1.0 / 3.0))
    return x ** 2 / (1.0 + x ** 3) / (2 ** (2.0 / 3.0) / 3.0)


def jet_signal(env, U_eff, D, nsamp, fs, r, ground, power_mean, seed=5, rho0=1.2, c0=343.0):
    """Jet noise at r (Pa): white noise shaped to the spectrum at speed U_eff, scaled to the mean power, times the
    envelope env (n samples, mean square 1) that carries the firing-by-firing swing."""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal(nsamp)
    F = np.fft.rfft(w)
    f = np.fft.rfftfreq(nsamp, 1.0 / fs)
    fp = JET_ST * U_eff / D
    # PSD per Hz = band shape / f (a third octave is 0.23 f wide); zero at DC
    psd = np.zeros_like(f)
    psd[1:] = jet_band_shape(f[1:], fp) / f[1:]
    x = np.fft.irfft(F * np.sqrt(psd), nsamp)
    x /= np.sqrt(np.mean(x ** 2)) + 1e-30
    p_rms = math.sqrt(rho0 * c0 * power_mean / (4 * math.pi * r * r))
    return x * env * p_rms * (2.0 if ground else 1.0)


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
            wander=None, jet=None):
    """A pressure signal at r (Pa) of `seconds` of running: every firing scaled by 1 + spread[k] + cov N(0, 1).
    spread: one steady offset per firing in the cycle (None = all zero). wander: (t, fraction) of the engine speed
    (rpm_walk, or a measured track divided by its mean, less one): each cycle is stretched to its own length, so
    the orders spread as a recording's do. The cycle's shape is kept in crank angle (a fair first step: the pipe's
    own resonances do not move with speed, so this smears them slightly too).
    jet: None, or {"d_m": tip inside diameter, ["K": Lighthill constant]}: adds the tip's jet noise (module notes),
    from the INS velocity and temperature at the open end, modulated through each cycle and by each firing's gain.
    The second value returned is fs; with jet, a third is {"jet_rms_Pa", "tone_rms_Pa", "U_eff", "fp_Hz"}."""
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
    if jet:
        D = float(jet["d_m"])
        U = cycle_of_key(ins, rpm, n, "u")
        Tj = cycle_of_key(ins, rpm, n, "T")
        wj = jet_power(U, Tj, D, K=float(jet.get("K", JET_K)))
        wmean = float(wj.mean())
        env1 = np.sqrt(wj / (wmean + 1e-30))
        # a firing's flow gain g scales its gas speed, so its jet pressure by g^4
        erows = env1[None, :] * np.maximum((g @ W), 0.0) ** 4
        U_eff = float(np.mean(np.abs(U) ** 8) ** 0.125)
    if wander is None:
        sig = rows.ravel()
        esig = erows.ravel() if jet else None
    else:
        tw, fw = wander
        out, eout, t = [], [], 0.0
        for i, row in enumerate(rows):
            f = 1.0 + float(np.interp(t, tw, fw))
            ni = max(8, int(round(n / f)))                  # a faster cycle is shorter
            out.append(np.interp(np.arange(ni) * n / ni, np.arange(n), row, period=n))
            if jet:
                eout.append(np.interp(np.arange(ni) * n / ni, np.arange(n), erows[i], period=n))
            t += ni / fs
            if t > seconds:
                break
        sig = np.concatenate(out)
        esig = np.concatenate(eout) if jet else None
    # monopole: derivative in the frequency domain of the whole record, then 1 / (4 pi r), ground doubling
    F = np.fft.rfft(sig)
    w = 2 * math.pi * np.fft.rfftfreq(len(sig), 1.0 / fs)
    p = np.fft.irfft(1j * w * F, len(sig)) / (4 * math.pi * r) * (2.0 if ground else 1.0)
    N = int(seconds * fs)
    if not jet:
        return p[:N], fs
    esig = esig / (math.sqrt(np.mean(esig ** 2)) + 1e-30)
    pj = jet_signal(esig, U_eff, D, len(sig), fs, r, ground, wmean, seed=seed + 101)
    info = {"jet_rms_Pa": float(np.sqrt(np.mean(pj[:N] ** 2))), "tone_rms_Pa": float(np.sqrt(np.mean(p[:N] ** 2))),
            "U_eff": U_eff, "fp_Hz": JET_ST * U_eff / D}
    return (p + pj)[:N], fs, info


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
