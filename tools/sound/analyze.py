#!/usr/bin/env python3
"""analyze.py - objective "does it sound like an engine" measures for one WAV segment (a recording or the page's output).

    python3 tools/sound/analyze.py FILE.wav --t0 14 --t1 26 --rpm 735 --fire 2 [--json out.json] [--label name]

--fire is the firing order in crank orders (4-stroke: cylinders / 2; a V8 on one collector of 4 is 2, both banks 4;
the 270-degree twin 1). Everything is relative (no absolute level: the recordings are phone-class, gain unknown).

Measures (each on the same segment, the same way for recording and model):
  octave / third-octave band levels re the total (dB), 31.5 Hz - 16 kHz;
  slope: least-squares dB per octave of the third-octave levels from 2 x the firing frequency to 8 kHz;
  rpm track: harmonic-comb tracker on frames of max(0.2 s, 3 cycles) every 25 ms (half orders 1..24, search +-12 % of --rpm);
    jitter = std of the tracked firing frequency after a 1 s moving-average detrend (short-time, %) and the raw std (%);
  angle-domain (order tracking): the segment resampled to 2048 points per 720 deg cycle along the integrated track,
    then one FFT over all whole cycles: tonal energy = bins at the half orders (+-1 bin) up to 4 kHz-equivalent,
    noise = the rest of the same band; TNR = 10 log10(tonal / noise) (dB);
  gap depth: Welch spectrum (0.5 s Hann); for half orders 1..24 the level at each order minus the minimum midway
    between it and the next, median (dB) - what the page's own recAbCheck calls the gap between the orders;
  cycle-to-cycle: per-cycle RMS (angle domain) COV (%), per-firing RMS COV (%);
  order amplitude jitter: per-cycle FFT, the std in dB of each of the 6 strongest half orders across cycles, median;
  envelope modulation: Hilbert envelope of the 50 Hz - 5 kHz band, its modulation spectrum: RMS modulation depth
    (re the mean envelope) in 0.3-2 Hz (slow hunting) and 2 Hz - (cycle frequency / 2) (cycle-to-cycle);
  crest factor: peak / RMS (dB) after a 30 Hz high-pass; also the 99.9th-percentile crest.
"""
import argparse, json, sys
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfiltfilt, welch, hilbert, stft


def load(path, t0=None, t1=None):
    sr, x = wavfile.read(path)
    x = x.astype(np.float64)
    if x.ndim > 1:
        x = x.mean(1)
    x /= np.abs(x).max() or 1.0
    a = int((t0 or 0) * sr)
    b = int(t1 * sr) if t1 else len(x)
    return sr, x[a:b]


def bands(x, sr, third=True):
    f, P = welch(x, sr, nperseg=min(len(x), 1 << 15))
    centres = 1000 * 2 ** (np.arange(-15, 13) / 3) if third else 1000 * 2.0 ** np.arange(-5, 5)
    k = 2 ** (1 / 6) if third else 2 ** 0.5
    tot = P.sum()
    out = []
    for fc in centres:
        if fc * k > sr / 2:
            break
        m = (f >= fc / k) & (f < fc * k)
        out.append((float(fc), float(10 * np.log10(P[m].sum() / tot + 1e-30))))
    return out


def track(x, sr, rpm0, kmax=24, win=0.25, hop=0.025):
    n = int(win * sr)
    nfft = 1 << int(np.ceil(np.log2(n * 4)))
    f, t, Z = stft(x, sr, window='hann', nperseg=n, noverlap=n - int(hop * sr), nfft=nfft, boundary=None, padded=False)
    A = np.abs(Z)
    L = np.log10(A + 1e-9 * A.max())
    cand = np.linspace(rpm0 * 0.88, rpm0 * 1.12, 481)
    ords = np.arange(1, kmax + 1) / 2.0
    df = f[1] - f[0]
    rpm = np.empty(L.shape[1])
    for j in range(L.shape[1]):
        col = L[:, j]
        fr = np.outer(cand / 60.0, ords) / df
        i0 = np.floor(fr).astype(int)
        u = fr - i0
        ok = i0 + 1 < len(col)
        v = np.where(ok, col[np.minimum(i0, len(col) - 2)] * (1 - u) + col[np.minimum(i0 + 1, len(col) - 1)] * u, 0)
        s = v.sum(1)
        b = int(np.argmax(s))
        if 0 < b < len(s) - 1:  # parabolic refinement
            d = (s[b - 1] - s[b + 1]) / (2 * (s[b - 1] - 2 * s[b] + s[b + 1]) + 1e-30)
            rpm[j] = cand[b] + d * (cand[1] - cand[0])
        else:
            rpm[j] = cand[b]
    return t, rpm


def analyze(x, sr, rpm0, fire):
    sos = butter(4, 30, 'hp', fs=sr, output='sos')
    x = sosfiltfilt(sos, x)
    rms = np.sqrt(np.mean(x ** 2))
    res = {}
    res['crest_dB'] = float(20 * np.log10(np.abs(x).max() / rms))
    res['crest999_dB'] = float(20 * np.log10(np.percentile(np.abs(x), 99.9) / rms))
    ob = bands(x, sr, third=False)
    res['octaves_dB'] = {('%g' % round(fc)): round(v, 1) for fc, v in ob}
    tb = bands(x, sr, third=True)
    ff = rpm0 / 60.0 * fire
    pts = [(fc, v) for fc, v in tb if 2 * ff <= fc <= 8000]
    if len(pts) >= 3:
        p = np.polyfit(np.log2([q[0] for q in pts]), [q[1] for q in pts], 1)
        res['slope_dB_per_oct'] = float(p[0])
    # rpm track
    win = max(0.2, 3 * 120.0 / rpm0)          # at least three 720-degree cycles per frame (half orders resolved)
    t, r = track(x, sr, rpm0, win=win)
    res['track_win_s'] = win
    res['rpm_mean'] = float(r.mean())
    k = max(1, int(round(1.0 / 0.025)))
    sm = np.convolve(r, np.ones(k) / k, mode='same')
    core = slice(k // 2, len(r) - k // 2) if len(r) > k else slice(None)
    res['rpm_jitter_short_pct'] = float(np.std((r - sm)[core]) / r.mean() * 100)
    res['rpm_std_pct'] = float(np.std(r) / r.mean() * 100)
    # angle domain along the track
    ti = np.arange(len(x)) / sr
    rr = np.interp(ti, t, r)
    cyc = np.cumsum(rr / 120.0) / sr            # 720-degree cycles elapsed
    ncyc = int(np.floor(cyc[-1] - cyc[0])) - 1
    P = 2048
    res['cycles'] = ncyc
    if ncyc >= 4:
        grid = cyc[0] + np.arange(ncyc * P) / P
        y = np.interp(grid, cyc, x)
        Y = np.abs(np.fft.rfft(y)) ** 2
        # bin b is b / ncyc half-orders... in cycle orders: bin b <-> b/ncyc per cycle; half order k <-> bin k*ncyc
        fmax_bin = int(4000 / (r.mean() / 120.0) * ncyc)
        fmin_bin = int(40 / (r.mean() / 120.0) * ncyc)
        b = np.arange(len(Y))
        band = (b >= fmin_bin) & (b <= min(fmax_bin, len(Y) - 1))
        near = (np.abs(b - np.round(b / ncyc) * ncyc) <= 1) & (np.round(b / ncyc) >= 1)
        ton = Y[band & near].sum(); noi = Y[band & ~near].sum()
        res['TNR_dB'] = float(10 * np.log10(ton / (noi + 1e-30)))
        res['tonal_fraction'] = float(ton / (ton + noi))
        Yc = y.reshape(ncyc, P)
        cr = np.sqrt((Yc ** 2).mean(1))
        res['cycle_rms_cov_pct'] = float(cr.std() / cr.mean() * 100)
        nf = max(1, int(round(2 * fire)))   # firings per cycle
        fr_ = y[: ncyc * P - (ncyc * P) % nf].reshape(-1, P // nf) if P % nf == 0 else None
        if fr_ is not None:
            fr_rms = np.sqrt((fr_ ** 2).mean(1)).reshape(ncyc, nf)
            # pulse-to-pulse after removing each firing slot's mean (systematic cylinder differences kept apart)
            res['firing_rms_cov_pct'] = float((fr_rms / fr_rms.mean(0)).std() * 100)
            res['cyl_to_cyl_spread_pct'] = float(fr_rms.mean(0).std() / fr_rms.mean() * 100)
        F = np.fft.rfft(Yc, axis=1)
        mag = np.abs(F[:, 1:49])                    # half orders 1..48 (bin k = half order k)
        top = np.argsort(mag.mean(0))[-6:]
        res['order_amp_jitter_dB'] = float(np.median(np.std(20 * np.log10(mag[:, top] + 1e-12), axis=0)))
    # gap depth
    f, Pw = welch(x, sr, nperseg=int(0.5 * sr))
    Lw = 10 * np.log10(Pw + 1e-30)
    h = r.mean() / 120.0
    gaps = []
    for kk in range(1, 25):
        fa, fb = kk * h, (kk + 1) * h
        ia = np.argmin(abs(f - fa)); ib = np.argmin(abs(f - fb))
        if ib >= len(f) - 1:
            break
        pk = Lw[max(0, ia - 1): ia + 2].max()
        lo = Lw[ia + (ib - ia) // 4: ib - (ib - ia) // 4 + 1].min()
        gaps.append(pk - lo)
    res['gap_median_dB'] = float(np.median(gaps)) if gaps else None
    # envelope modulation
    sb = butter(4, [50, min(5000, sr / 2 * 0.9)], 'bp', fs=sr, output='sos')
    env = np.abs(hilbert(sosfiltfilt(sb, x)))
    dec = int(sr / 400)
    e = env[: len(env) // dec * dec].reshape(-1, dec).mean(1)
    fe = 400.0
    E = np.fft.rfft(e - e.mean()); fq = np.fft.rfftfreq(len(e), 1 / fe)
    pw = np.abs(E) ** 2 / len(e) ** 2 * 2
    def depth(lo, hi):
        m = (fq >= lo) & (fq < hi)
        return float(np.sqrt(pw[m].sum()) / e.mean() * 100)
    res['mod_slow_pct'] = depth(0.3, 2.0)
    res['mod_cycle_pct'] = depth(2.0, max(2.5, h / 2))
    return res


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('wav'); ap.add_argument('--t0', type=float); ap.add_argument('--t1', type=float)
    ap.add_argument('--rpm', type=float, required=True); ap.add_argument('--fire', type=float, required=True)
    ap.add_argument('--json'); ap.add_argument('--label', default='')
    a = ap.parse_args(argv)
    sr, x = load(a.wav, a.t0, a.t1)
    r = analyze(x, sr, a.rpm, a.fire)
    r['label'] = a.label or a.wav
    if a.json:
        try:
            d = json.load(open(a.json))
        except Exception:
            d = {}
        d[r['label']] = r
        json.dump(d, open(a.json, 'w'), indent=1)
    print(json.dumps(r, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
