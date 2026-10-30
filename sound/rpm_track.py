"""Engine-order RPM tracker for an exhaust recording of a 4-stroke engine.
Scores each candidate RPM by the summed log power at integer and half engine orders (orders 0.5..ORD_MAX),
i.e. a harmonic comb on f1 = RPM/60. Firing frequency of a 4-cyl 4-stroke = 2*f1 (order 2)."""
import sys, numpy as np, wave
from scipy.io import wavfile
from scipy.signal import stft
NCYL = 4
def load(f):
    sr, x = wavfile.read(f); x = x.astype(np.float64)
    x /= 2**31 if np.abs(x).max() > 2**16 else 2**15
    return sr, (x.mean(1) if x.ndim > 1 else x)
def track(f, win=0.5, hop=0.1, rpm_lo=500, rpm_hi=6500, ord_max=12):
    sr, x = load(f)
    n = int(win*sr); f_, t, Z = stft(x, sr, window='hann', nperseg=n, noverlap=n-int(hop*sr), boundary=None)
    P = np.abs(Z)**2; L = 10*np.log10(P + 1e-14)
    orders = np.arange(0.5, ord_max+0.01, 0.5)
    # weight: the firing order (NCYL/2) and its multiples count double
    w = np.where(np.isclose((orders/(NCYL/2.0)) % 1, 0), 2.0, 1.0)
    cands = np.arange(rpm_lo, rpm_hi, 5.0)
    out = []
    for j in range(L.shape[1]):
        col = L[:, j]; col = col - np.median(col)
        best, brpm = -1e9, None
        for r in cands:
            fr = r/60.0*orders
            idx = np.round(fr/(f_[1]-f_[0])).astype(int)
            ok = idx < len(col)
            s = (col[idx[ok]]*w[ok]).sum()/w[ok].sum()
            if s > best: best, brpm = s, r
        out.append((t[j], brpm, best, 10*np.log10(P[:, j].sum()+1e-14)))
    return np.array(out)
if __name__ == '__main__':
    for f in sys.argv[1:]:
        o = track(f); np.save(f.replace('.wav','_rpm.npy'), o)
        print(f)
        for tt, r, s, lv in o[::5]:
            print('  t=%5.1f s  rpm %5.0f  score %4.1f  level %5.1f dB' % (tt, r, s, lv))
