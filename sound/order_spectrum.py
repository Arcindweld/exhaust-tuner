"""Engine-order spectrum of a steady segment: Hann windows, Welch average, then the level at each half order
(integrated over +-0.15 order, so RPM wander does not drop the peak). Levels are relative to the strongest order."""
import sys, json, numpy as np
from scipy.signal import welch
from rpm_track import load, track
def order_levels(f, t0, t1, rpm=None, ord_max=16, win=0.5):
    sr, x = load(f); seg = x[int(t0*sr):int(t1*sr)]
    if rpm is None:
        tr = track(f, rpm_lo=500, rpm_hi=3000); sel = (tr[:,0] >= t0) & (tr[:,0] <= t1); rpm = float(np.median(tr[sel,1]))
    n = int(win*sr); fr, P = welch(seg, sr, window='hann', nperseg=n, noverlap=n//2)
    f1 = rpm/60.0; orders = np.arange(0.5, ord_max+0.01, 0.5); lev = {}
    for o in orders:
        m = (fr >= (o-0.15)*f1) & (fr <= (o+0.15)*f1)
        lev[float(o)] = 10*np.log10(P[m].sum()*(fr[1]-fr[0]) + 1e-18)
    top = max(lev.values())
    return rpm, {k: round(v-top, 1) for k, v in lev.items()}, (fr, 10*np.log10(P+1e-18))
if __name__ == '__main__':
    out = {}
    for f, t0, t1, tag in [('startup_idle.wav', 12.0, 20.0, 'idle_warm'), ('startup_idle.wav', 24.0, 36.0, 'idle'), ('idle_to_2000.wav', 11.0, 16.0, 'hold_1900')]:
        rpm, lev, _ = order_levels(f, t0, t1)
        out[tag] = {'file': f, 't': [t0, t1], 'rpm': round(rpm), 'orders_dB_rel': lev}
        print(tag, 'rpm %.0f' % rpm, ' '.join('%g:%+.0f' % (k, v) for k, v in lev.items() if k <= 8))
    json.dump(out, open('recording_orders.json', 'w'), indent=1)
