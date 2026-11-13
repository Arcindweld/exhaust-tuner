#!/usr/bin/env python3
"""Independent checks of the Conflux barrel model and the oil-cooler arithmetic (web/index.html cfxModel, cfxUA,
cfxPredict, cfxDp, oilUnit, oilSize, oilEps, w2aLoop with Qx), audit 3 (docs/BOOST_AUDIT_2026-11-12.md Part 2, C2-C4,
O2-O5). Written from the sources, not from the page.

  python3 tools/validation/boost/conflux.py

Cross-flow, both fluids unmixed: solved here as the 2-D field it is (each fluid flows straight through, its temperature
varying across the other's direction), on a grid, with the Cmin fluid's mean outlet giving eps (Kays and London's
definition). Not the series formula: a check of it. Counter-flow: eps = (1 - e) / (1 - Cr e), e = exp(-NTU (1 - Cr)) (any text). UA = NTU Cmin from the
tabulated effectiveness (brentq). Pressure drop at equal mass flow: dp = K m^2 / (2 rho A^2) -> dp ∝ 1/rho, rho = p / (R T).
"""
import math
import numpy as np
from scipy.optimize import brentq

CP_AIR = 1.4 * 287.05 / 0.4   # 1004.675 J/kg K: ideal air at gamma 1.4, the constant the page states (its comment rounds it to 1004.7)
EGW25_CP = 3917.0        # J/kg K at 40 C, EGW 25/75 by mass (Engineering ToolBox page the page cites, interpolated)


def eps_cross_grid(ntu, cr, n=600):
    """Both unmixed, solved on an n x n grid of cells: the hot fluid (Cmin, the charge air) in n rows, each of capacity
    Cmin/n, crossing n columns of the cold fluid, each of capacity Cmax/n. A cell's conductance is NTU Cmin / n^2, so its
    hot-side NTU is NTU/n, and the cold rise is Cr times the hot drop. Each cell is solved on the mean of its inlet
    differences (second order in the cell size). eps = the hot rows' mean drop (the hot side is Cmin)."""
    Th = np.ones(n)          # hot temperature entering the next column, one per row; 1 = hot inlet, 0 = cold inlet
    nh = ntu / n
    for _j in range(n):      # the columns in the hot flow's direction
        tc = 0.0             # the cold fluid enters each column at its first row
        th_new = np.empty(n)
        for i in range(n):   # down the column, in the cold flow's direction
            dm = (Th[i] - tc) / (1 + 0.5 * nh * (1 + cr))   # the cell's mean difference
            dh = nh * dm
            th_new[i] = Th[i] - dh
            tc += cr * dh
        Th = th_new
    return 1 - Th.mean()


def eps_counter(ntu, cr):
    if cr > 1 - 1e-12:
        return ntu / (1 + ntu)
    e = math.exp(-ntu * (1 - cr))
    return (1 - e) / (1 - cr * e)


def eps_series(ntu, cr, terms=200):
    """The exact series (Mason; as the page's comment cites), for comparison with the grid."""
    s = 0.0
    a, b = ntu, cr * ntu
    pa = pb = 0.0
    ta = tb = 1.0
    for k in range(terms):
        if k:
            ta *= a / k; tb *= b / k
        pa += ta; pb += tb
        s += (1 - math.exp(-a) * pa) * (1 - math.exp(-b) * pb)
    return s / (cr * ntu)


BARRELS = {   # the page's tabulation (rated: inlet temperature C, inlet pressure kPa abs, coolant kg/s, coolant in 30 C)
    '100012': dict(thi=200, p=350, kgs=0.60, m=[0.40, 0.45, 0.50, 0.55, 0.60], eff=[87.0, 85.5, 84.0, 82.0, 80.0], dp=[11.0, 13.4, 16.0, 19.4, 23.0]),
    '100013': dict(thi=250, p=500, kgs=0.86, m=[0.60, 0.65, 0.70, 0.75, 0.80], eff=[92.0, 91.0, 90.0, 89.0, 88.0], dp=[10.0, 11.4, 13.0, 14.9, 17.0]),
}


def ua_points(b, f):
    Cc0 = b['kgs'] * EGW25_CP
    out = []
    for m, e in zip(b['m'], b['eff']):
        Ch = m * CP_AIR; Cmin = min(Ch, Cc0); cr = Cmin / max(Ch, Cc0)
        ntu = brentq(lambda x: f(x, cr) - e / 100, 1e-6, 50)
        out.append((m, cr, ntu, ntu * Cmin))
    return out


def predict(b, m, Cc, thi, tci, f_ua_x, f_ua_c):
    Ch = m * CP_AIR; Cmin = min(Ch, Cc); cr = Cmin / max(Ch, Cc)
    res = {}
    for name, ua, f in (('cross', f_ua_x, eps_cross_series_fast), ('counter', f_ua_c, eps_counter)):
        e = f(ua / Cmin, cr); Q = e * Cmin * (thi - tci)
        res[name] = (ua, e, Q, thi - Q / Ch)
    return res


def eps_cross_series_fast(ntu, cr):
    return eps_series(ntu, cr)


def lerp(xs, ys, x):
    return float(np.interp(x, xs, ys))


def main():
    print('C2 cross-flow, both unmixed: the series against a direct 2-D solution (grid 600 x 600)')
    for ntu, cr in ((2.0, 0.214), (3.5, 0.3), (6.0, 1.0)):
        g = eps_cross_grid(ntu, cr); s = eps_series(ntu, cr)
        print('  NTU %.2f Cr %.3f: grid %.6f series %.6f (diff %.1e); counter %.6f' % (ntu, cr, g, s, g - s, eps_counter(ntu, cr)))
    for pn, b in BARRELS.items():
        X = ua_points(b, eps_series); C = ua_points(b, eps_counter)
        print('C2 %s UA at the tabulated points (W/K): cross %s; counter %s; counter/cross %s' % (pn,
              ' '.join('%.4f' % p[3] for p in X), ' '.join('%.4f' % p[3] for p in C), ' '.join('%.4f' % (c[3] / x[3]) for x, c in zip(X, C))))
        # prediction at two build points: inside the range, the maker's coolant flow but 45 C coolant and a hotter inlet;
        # and at 0.8 x the coolant flow
        for (m, cw, thi, tci) in ((b['m'][1] + 0.01, 1.0, 180.0, 45.0), (b['m'][3], 0.8, 150.0, 35.0)):
            Cc = b['kgs'] * cw * EGW25_CP
            uax = lerp(b['m'], [p[3] for p in X], m); uac = lerp(b['m'], [p[3] for p in C], m)
            r = predict(b, m, Cc, thi, tci, uax, uac)
            print('   m %.3f kg/s, coolant x%.2f, %g -> %g C: cross UA %.4f eps %.6f Q %.3f W out %.4f C; counter UA %.4f eps %.6f Q %.3f W out %.4f C'
                  % ((m, cw, thi, tci) + r['cross'] + r['counter']))
        # drop at the build's density: rho ratio = (p_r / T_r) / (p_b / T_b)
        for (m, pb, tb) in ((b['m'][2], 170984.534, 101.5698), (b['m'][4], 300000.0, 160.0)):
            dpc = lerp(b['m'], b['dp'], m)
            ratio = (b['p'] * 1000 / (b['thi'] + 273.15)) / (pb / (tb + 273.15))
            print('   drop at m %.3f: curve %.3f kPa at %g kPa(a), %g C; at %.1f Pa, %.4f C: x%.6f = %.4f kPa (pressure ratio alone x%.6f)'
                  % (m, dpc, b['p'], b['thi'], pb, tb, ratio, dpc * ratio, b['p'] * 1000 / pb))

    print('O2 oil cooler translation and units in parallel (Conflux 100218 curve as the page tabulates it)')
    f = [50, 75, 100, 125, 150]; Q = [37.6, 46.7, 53.3, 58.3, 62.5]; dp = [23.4, 40.8, 60.1, 81.5, 105.0]
    for (F, toi, tci, load) in ((60.0, 120.0, 85.0, 15562.0), (130.0, 110.0, 70.0, 20221.0)):
        k = (toi - tci) / (120.0 - 85.0)
        for n in range(1, 5):
            fu = F / n
            if fu < f[0] or fu > f[-1]:
                print('   F %.0f L/min, n %d: %.1f L/min each is outside the plotted range' % (F, n, fu)); continue
            q = lerp(f, Q, fu) * 1000 * k
            print('   F %.0f L/min, %g/%g C, n %d: each %.2f L/min, %.3f W, together %.3f W (load %.0f W) %s; drop %.3f kPa'
                  % (F, toi, tci, n, fu, q, n * q, load, 'meets' if n * q >= load else 'short', lerp(f, dp, fu)))
    print('O3 effectiveness at the maker conditions, Cmin = min(oil, coolant), oil at 120 C rho/cp from Engineering ToolBox')
    rho = 836 + (393.15 - 380) / 20 * (824 - 836); cp = 2250 + (393.15 - 380) / 20 * (2340 - 2250)
    for fi, qi in ((50, 37.6), (150, 62.5)):
        Co = fi / 60000 * rho * cp; Cc = 2.0 * EGW25_CP
        print('   100218 %d L/min: oil C %.2f W/K, coolant C %.1f W/K -> Cmin oil, eps %.6f' % (fi, Co, Cc, qi * 1000 / (min(Co, Cc) * 35)))

    print('O5 oil heat into the charge cooler loop: closed loop, charge cooler e1, oil cooler after it, front exchanger e2')
    for (e1, e2, Cw, Th, Ta, Qo) in ((600.0, 1000.0, 20 / 60000 * 1029.5 * EGW25_CP, 101.57, 30.0, 15562.0), (900.0, 1100.0, 1300.0, 140.0, 35.0, 8000.0)):
        # fixed point on the loop temperatures (no closed form used): tw1 guess, iterate
        tw1 = Ta
        for _ in range(2000):
            Q = e1 * (Th - tw1); tw2 = tw1 + Q / Cw; tw3 = tw2 + Qo / Cw
            Qr = e2 * (tw3 - Ta); tw1n = tw3 - Qr / Cw
            tw1 = 0.5 * tw1 + 0.5 * tw1n
        k = 1 / e2 - 1 / Cw
        print('   e1 %g e2 %g Cw %.3f: fixed point Q %.4f W, tw1 %.4f C, oil cooler coolant in %.4f C; closed form (Th-Ta-kQo)/(1/e1+k) %.4f W'
              % (e1, e2, Cw, Q, tw1, tw2, (Th - Ta - k * Qo) / (1 / e1 + k)))


if __name__ == '__main__':
    main()
