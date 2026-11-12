#!/usr/bin/env python3
"""The intercooler cases pinned in web/tests/turbolib_ui.js and turbosize_ui.js, recomputed with the EXACT cross-flow
(both unmixed) series (thermo.eps_exact; python-ht 'crossflow' gives the same to 1e-15), after the boost audit replaced the
page's closed-form approximation (finding B9). Steady loop by fixed point of the two exchangers; warm-up by explicit time
integration (0.01 s) of M cw dTw/dt = e1 (Th - Tw) - e2 (Tw + e1 (Th - Tw)/Cw - Ta). Prints JSON.
"""
import json, math, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from thermo import eps_exact, invert, CP_AIR  # noqa: E402

LB = 60 / 0.45359237


def predict(UA, Ch, Cc, thi, tci):
    Cmin, Cmax = min(Ch, Cc), max(Ch, Cc)
    e = eps_exact(UA / Cmin, Cmin / Cmax)
    Q = e * Cmin * (thi - tci)
    return dict(eps=e, Q=Q, tho=thi - Q / Ch, tco=tci + Q / Cc, ntu=UA / Cmin)


def from_point(Ch, Cc, thi, tho, tci):
    Cmin, Cmax = min(Ch, Cc), max(Ch, Cc)
    Q = Ch * (thi - tho)
    e = Q / (Cmin * (thi - tci))
    ntu = invert(eps_exact, e, Cmin / Cmax)
    return dict(Q=Q, eps=e, ntu=ntu, UA=ntu * Cmin)


o = {}
Ch, Cc = 30 / LB * CP_AIR, 45 / LB * CP_AIR
P0 = predict(800, Ch, Cc, 150, 25)
A = from_point(Ch, Cc, 150, P0['tho'], 25)
P1 = predict(A['UA'], 40 / LB * CP_AIR, 60 / LB * CP_AIR, 160, 30)
o['routeA'] = dict(tho0=P0['tho'], Q0=P0['Q'], UA=A['UA'], eps1=P1['eps'], Q1=P1['Q'], tho1=P1['tho'])

# loop: UA1 900, UA2 1200, charge 30 lb/min at 150 C, water 20 L/min (992, 4183), front air 60 lb/min at 25 C, 8 L
Cw = 20 / 60 / 1000 * 992 * 4183
Ca = 60 / LB * CP_AIR
c1, c2 = min(Ch, Cw), min(Ca, Cw)
e1 = eps_exact(900 / c1, c1 / max(Ch, Cw)) * c1
e2 = eps_exact(1200 / c2, c2 / max(Ca, Cw)) * c2
Tw = 25.0
for _ in range(20000):                       # fixed point on the coolant temperature into the charge cooler
    Q1 = e1 * (150 - Tw); Q2 = e2 * (Tw + Q1 / Cw - 25); Tw += 0.3 * (Q1 - Q2) / (e1 + e2)
Q = e1 * (150 - Tw)
M = 8 / 1000 * 992
T, t, t90 = 25.0, 0.0, None
while t90 is None:
    Q1 = e1 * (150 - T); Q2 = e2 * (T + Q1 / Cw - 25); T += (Q1 - Q2) / (M * 4183) * 0.01; t += 0.01
    if T - 25 >= 0.9 * (Tw - 25):
        t90 = t
o['loop'] = dict(e1=e1, e2=e2, Q=Q, tw1=Tw, tw2=Tw + Q / Cw, tho=150 - Q / Ch, b=e1 + e2 - e1 * e2 / Cw, t90_integrated=t90)

# EJ Bowman EC120-4073-3 point (brochure G21): 2.5 kg/min, 180 -> 53.1 C, water 30 L/min at 30 C (water at 40 C: 992, 4183)
cw = 30 / 60 / 1000 * 992 * 4183
chb = 2.5 / 60 * CP_AIR
B = from_point(chb, cw, 180, 53.1, 30)
ch2 = 3.5 / 60 * CP_AIR
H = predict(B['UA'], ch2, cw, 180, 30)
UAs = B['UA'] * (3.5 / 2.5) ** (1 - 0.5236)
K = predict(UAs, ch2, cw, 180, 30)
o['bowman'] = dict(Q=B['Q'], ntu=B['ntu'], UA=B['UA'], thoH=H['tho'], UAs=UAs, thoS=K['tho'])

# turbosize default: charge 0.4331842 kg/s 101.5698 -> 44.1425 C, 60 lb/min outside air at 25 C, eps on Cmin
ma = 0.43318420652130163
Chd, Ccd = ma * CP_AIR, 60 / LB * CP_AIR
crd = min(Chd, Ccd) / max(Chd, Ccd)
o['turbosize'] = dict(cr=crd, ntu=invert(eps_exact, 0.75, crd), ntu_UA=invert(eps_exact, 0.75, crd) * min(Chd, Ccd),
                      eps_at_4_452373=eps_exact(4.452373040571574, crd))
print(json.dumps(o, indent=1))
