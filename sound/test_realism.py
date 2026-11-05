#!/usr/bin/env python3
"""realism.py checks on a synthetic outflow (no OpenWAM needed): the firing windows add up to one; with no variation
the realised sound has the deterministic cycle's order levels; cycle-to-cycle variation raises the floor between
the orders by 6 dB per doubling (power ~ cov^2) and leaves the firing orders where they were; a steady offset on one
cylinder of a four puts energy on the half orders; speed wander widens the orders and fills the gaps above them; the
mean flow is unchanged."""
import math
import sys

import numpy as np

import realism as RZ

fails = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        fails.append(m)


rpm, fs, nfire = 3000.0, 22050, 4
T = 120.0 / rpm
# a four's outflow: four blowdown pulses a cycle over a mean flow, as an INS record of three cycles
t = np.arange(0, 3 * T, 1.0 / 20000)
ph = (t % T) / T
y = 0.02 + sum(0.03 * np.exp(-((((ph - k / 4.0 + 0.5) % 1.0) - 0.5) / 0.03) ** 2) for k in range(4))
ang = (t % T) / T * 720.0
ins = {"time": t.tolist(), "mdot": y.tolist(), "angle": ang.tolist()}

W = RZ.firing_windows(735, 4, 0.1)
ok(np.allclose(W.sum(axis=0), 1.0) and W.min() >= 0, 'four firing windows add up to one everywhere')

p0, _ = RZ.realize(ins, rpm, nfire, seconds=8.0, fs=fs, cov=0.0, seed=1)
L0, F0 = RZ.levels(p0, fs, rpm, win=1.0)
# the deterministic cycle's own order levels, by FFT of one cycle
n = int(round(fs * T))
yc = RZ.cycle_of(ins, rpm, n)
Y = np.fft.rfft(yc)
w = np.arange(len(Y)) * 2 * math.pi / T
P = np.abs(1j * w * Y)
det = {k / 2.0: 20 * np.log10(P[k] + 1e-30) for k in range(1, 25)}
top = max(det[o] for o in det)
dd = [abs((det[o] - top) - L0[o]) for o in (2.0, 4.0, 6.0, 8.0)]
ok(max(dd) < 0.3, 'no variation: firing orders as the deterministic cycle (within %.2f dB)' % max(dd))
ok(np.mean(list(F0.values())) < -80, 'no variation: nothing between the orders (%.0f dB)' % np.mean(list(F0.values())))
fl = {}
for cov in (0.01, 0.02, 0.04):
    p, _ = RZ.realize(ins, rpm, nfire, seconds=8.0, fs=fs, cov=cov, seed=7)
    L, F = RZ.levels(p, fs, rpm, win=1.0)
    fl[cov] = np.mean([F[k] for k in F if 2 <= k <= 10])
    ok(all(abs(L[o] - L0[o]) < 0.5 for o in (2.0, 4.0)), 'cov %g: orders 2 and 4 unchanged' % cov)
ok(abs((fl[0.02] - fl[0.01]) - 6.0) < 1.5 and abs((fl[0.04] - fl[0.02]) - 6.0) < 1.5,
   'the floor rises about 6 dB per doubling of cov (%.1f, %.1f dB)' % (fl[0.02] - fl[0.01], fl[0.04] - fl[0.02]))
ps, _ = RZ.realize(ins, rpm, nfire, seconds=8.0, fs=fs, cov=0.0, spread=[0.05, 0, 0, 0])
Ls, _ = RZ.levels(ps, fs, rpm, win=1.0)
ok(Ls[1.0] > L0[1.0] + 30 and Ls[0.5] > L0[0.5] + 30, 'one cylinder 5 %% strong: orders 0.5 and 1 come up (%.0f and %.0f dB)' % (Ls[0.5], Ls[1.0]))
pw, _ = RZ.realize(ins, rpm, nfire, seconds=8.0, fs=fs, cov=0.0, wander=RZ.rpm_walk(9.0, 0.012))
Lw, Fw = RZ.levels(pw, fs, rpm, win=1.0)
ok(np.mean([Fw[k] for k in Fw if 6 <= k <= 12]) > np.mean([F0[k] for k in F0 if 6 <= k <= 12]) + 20, '1.2 % speed wander fills the gaps between the higher orders')
ok(abs(np.mean(RZ.realize(ins, rpm, nfire, seconds=8.0, fs=fs, cov=0.04, ground=False)[0])) < 1e-3, 'the radiated pressure has no mean')
# jet noise: Lighthill's U^8, the hot-jet density exponent, the spectrum's peak and the absolute level
D = 0.0603
d8 = 10 * np.log10(RZ.jet_power(80.0, 298.15, D) / RZ.jet_power(40.0, 298.15, D))
ok(abs(d8 - 24.08) < 0.6, 'cold jet: twice the speed is %.1f dB louder (U^8: 24.1, with the small density term)' % d8)
dh = 10 * np.log10(RZ.jet_power(60.0, 600.0, D) / RZ.jet_power(60.0, 298.15, D))
ok(2.0 < dh < 3.2, 'a jet at about twice ambient temperature, 60 m/s: %.1f dB louder than cold (Hoch et al.: about 3)' % dh)
ok(abs(RZ.jet_band_shape(1000.0, 1000.0) - 1.0) < 1e-9 and RZ.jet_band_shape(500.0, 1000.0) < 1 and RZ.jet_band_shape(2000.0, 1000.0) < 1, 'the band shape peaks, at 1, at fp')
# a steady jet (constant U and T in the INS) through realize: level and peak as the formulas give
tt = np.arange(0, 3 * T, 1.0 / 20000)
ins_j = dict(ins); ins_j["u"] = [70.0] * len(ins["time"]); ins_j["T"] = [700.0] * len(ins["time"])
pj, _, info = RZ.realize(ins_j, rpm, nfire, seconds=8.0, fs=44100, cov=0.0, r=2.0, ground=False, jet={"d_m": D})
W0 = float(RZ.jet_power(70.0, 700.0, D)); want = math.sqrt(1.2 * 343.0 * W0 / (4 * math.pi * 4.0))
ok(abs(20 * np.log10(info["jet_rms_Pa"] / want)) < 0.2, 'steady jet: %.4f Pa rms at 2 m against %.4f from the power law' % (info["jet_rms_Pa"], want))
from scipy.signal import welch as _w
fq, Pq = _w(pj, 44100, nperseg=8192)
edges = 1000 * 2 ** (np.arange(-12, 10) / 3.0)
bands = [Pq[(fq >= e / 2 ** (1 / 6.)) & (fq < e * 2 ** (1 / 6.))].sum() for e in edges]
fpk = edges[int(np.argmax(bands))]
ok(abs(np.log2(fpk / info["fp_Hz"])) <= 0.34, 'the jet noise peaks in the third octave at %.0f Hz (St 0.2 gives %.0f Hz)' % (fpk, info["fp_Hz"]))
ok(abs(np.mean(pj)) < 1e-2 * np.std(pj), 'the jet noise has no mean')
print('failures:', len(fails))
sys.exit(1 if fails else 0)
