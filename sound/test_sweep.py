#!/usr/bin/env python3
"""sweep.py checks on synthetic outflows (no OpenWAM needed): a pull held at a run's speed has that run's order levels;
between two runs a harmonic's level is interpolated in dB; along a ramp each order's frequency follows the speed; a
pass-by shifts the pitch by the Doppler ratio and peaks at 1/d; the jet noise follows the interpolated power."""
import math
import sys

import numpy as np

import realism as RZ
import sweep as SW

fails = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        fails.append(m)


def run_ins(rpm, gain2=1.0):
    """A four's outflow at rpm: four pulses a cycle, an extra order-2 component scaled by gain2; u, T, rho for the jet."""
    T = 120.0 / rpm
    t = np.arange(0, 3 * T, 1.0 / 40000)
    ph = (t % T) / T
    y = 0.02 + sum(0.03 * np.exp(-((((ph - k / 4.0 + 0.5) % 1.0) - 0.5) / 0.03) ** 2) for k in range(4))
    y = y + 0.004 * gain2 * np.cos(2 * math.pi * 4 * ph)          # order 2 = half order k 4 in a 720 deg cycle
    rho = np.full_like(t, 0.6)
    A = math.pi / 4 * 0.05 ** 2
    return {"time": t.tolist(), "mdot": y.tolist(), "angle": (ph * 720.0).tolist(), "u": (y / (rho * A)).tolist(),
            "T": [650.0] * len(t), "rho": rho.tolist()}


fs = 44100
r3 = SW.harmonics(run_ins(3000.0), 3000.0)
p, rp = SW.pull([r3], lambda t: 3000.0, 6.0, fs=fs, jet=False)
L, _ = RZ.levels(p, fs, 3000.0, win=1.0)
y = RZ.cycle_of(run_ins(3000.0), 3000.0, 4096)
Y = np.abs(np.fft.rfft(y)) * np.arange(2049)
det = {k / 2.0: 20 * np.log10(Y[k] / Y[1:25].max()) for k in range(1, 25)}
dd = [abs(L[o] - det[o]) for o in (2.0, 4.0, 6.0, 8.0)]   # the orders this four has
ok(max(dd) < 0.3, 'held at the run\'s speed: the run\'s own order levels (within %.2f dB)' % max(dd))
# interpolation between a run with order 2 at gain 1 and one at gain 4 (+12 dB on that component)
ra = SW.harmonics(run_ins(3000.0, 1.0), 3000.0); rb = SW.harmonics(run_ins(3200.0, 4.0), 3200.0)
Ym = SW.harm_at([ra, rb], 3100.0)
la, lb, lm = (20 * np.log10(abs(q[3])) for q in (ra["Y"], rb["Y"], Ym))
ok(abs(lm - (la + lb) / 2) < 0.01, 'halfway between two runs a harmonic\'s level is halfway in dB (%.2f between %.2f and %.2f)' % (lm, la, lb))
# a ramp: order 2's frequency follows the speed
pr, rpr = SW.pull([ra, rb], (np.array([0.0, 4.0]), np.array([3000.0, 3200.0])), 4.0, fs=fs, jet=False)
seg = lambda a: pr[int(a * fs):int(a * fs) + 8192] * np.hanning(8192)
fr = np.fft.rfftfreq(1 << 16, 1.0 / fs)
pk = lambda a, f0: fr[np.argmax(np.abs(np.fft.rfft(seg(a), 1 << 16)) * ((fr > f0 * 0.9) & (fr < f0 * 1.1)))]
fexp = lambda a: 2 * (3000.0 + 50.0 * (a + 8192 / fs / 2)) / 60.0
errs = [abs(pk(a, fexp(a)) / fexp(a) - 1) for a in (0.5, 2.0, 3.5)]
ok(max(errs) < 0.005, 'along a 3000-3200 rpm ramp order 2 is where the speed puts it (within %.2f %%)' % (100 * max(errs)))
# pass-by: a steady pull driven past at 25 m/s, 5 m from the microphone
p1, _ = SW.pull([r3], lambda t: 3000.0, 8.0, fs=fs, jet=False)
pm, tr, rr = SW.passby(p1, fs, 25.0, 5.0, 4.0, ground=False)
f2 = 2 * 3000.0 / 60.0
def peak_near(a, f0):
    i = int(a * fs); x = pm[i:i + 8192] * np.hanning(8192); X = np.abs(np.fft.rfft(x, 1 << 16)); m = (fr > f0 * 0.8) & (fr < f0 * 1.2)
    return fr[np.argmax(X * m)]
fa, fb = peak_near(1.0, f2), peak_near(5.9, f2)
want = (343.0 + 25.0) / (343.0 - 25.0)
ok(abs(fa / fb / want - 1) < 0.01, 'pass-by at 25 m/s: order 2 approaching / receding %.3f (Doppler %.3f)' % (fa / fb, want))
i0 = int(np.argmin(rr)); w = int(0.05 * fs)
rms_c = np.sqrt(np.mean(pm[i0 - w:i0 + w] ** 2)); rms_e = np.sqrt(np.mean(p1 ** 2))
ok(abs(20 * np.log10(rms_c / (rms_e / 5.0))) < 0.3 and abs(rr.min() - 5.0) < 0.01, 'at closest approach the level is the 1 m level over 5 m (%.2f dB off)' % (20 * np.log10(rms_c / (rms_e / 5.0))))
# jet noise: interpolated power, the steady level of the jet law
pj, _ = SW.pull([r3], lambda t: 3000.0, 4.0, fs=fs, jet=True)
jet_only = pj - SW.pull([r3], lambda t: 3000.0, 4.0, fs=fs, jet=False)[0]
want_j = math.sqrt(1.2 * 343.0 * r3["jet"]["W"] / (4 * math.pi))
ok(abs(20 * np.log10(np.sqrt(np.mean(jet_only ** 2)) / want_j)) < 0.5, 'the jet noise at a run\'s speed has that run\'s mean power (%.4f Pa at 1 m against %.4f)' % (np.sqrt(np.mean(jet_only ** 2)), want_j))
print('failures:', len(fails))
sys.exit(1 if fails else 0)
