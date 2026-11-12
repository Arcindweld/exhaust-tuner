#!/usr/bin/env python3
"""Independent checks of the Intake tab's turbo, valve and intercooler formulas (boost audit 2026-11-12).

Each block states its source; none is a port of web/index.html. Prints JSON; the page values to compare with are read
through Playwright by page_values.js in this folder, and both are tabulated in docs/BOOST_AUDIT_2026-11-12.md.
Usage: PYTHONPATH=<python-ht checkout>:<python-fluids checkout> python3 thermo.py [path/to/gri30.yaml]
"""
import json, math, sys

out = {}
PATM, R_AIR, G = 101325.0, 287.05, 1.4
CP_AIR = G * R_AIR / (G - 1)

# ---- 1. Cross-flow, both streams unmixed: exact series against the closed-form approximation -------------------------
# Exact (Mason 1954; Kays & London; the form python-ht's 'crossflow' method codes):
#   eps = 1/(Cr NTU) sum_{n>=0} [1 - e^-NTU sum_{m<=n} NTU^m/m!] [1 - e^-CrNTU sum_{m<=n} (Cr NTU)^m/m!]
# Approximation (Incropera / Bergman et al., Table 11.3): eps = 1 - exp((1/Cr) NTU^0.22 (exp(-Cr NTU^0.78) - 1))


def eps_exact(ntu, cr, N=400):
    if cr == 0:
        return 1 - math.exp(-ntu)
    a, b = ntu, cr * ntu
    s, ta, tb, sa, sb = 0.0, 1.0, 1.0, 1.0, 1.0   # running terms x^m/m! and partial sums
    for n in range(N):
        if n > 0:
            ta *= a / n; tb *= b / n; sa += ta; sb += tb
        term = (1 - math.exp(-a) * sa) * (1 - math.exp(-b) * sb)
        s += term
        if term < 1e-16 and n > a + b + 10:
            break
    return s / (cr * ntu)


def eps_approx(ntu, cr):
    return 1 - math.exp(1 / cr * ntu ** 0.22 * (math.exp(-cr * ntu ** 0.78) - 1))


def invert(fn, eps, cr):
    lo, hi = 0.0, 1.0
    while fn(hi, cr) < eps and hi < 1e3:
        hi *= 2
    for _ in range(200):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if fn(mid, cr) < eps else (lo, mid)
    return (lo + hi) / 2


tab = []
for cr in (0.5, 0.8, 0.9, 0.955, 1.0):
    for ntu in (1, 2, 3, 4, 4.45237, 5, 6):
        e, ap = eps_exact(ntu, cr), eps_approx(ntu, cr)
        tab.append(dict(cr=cr, ntu=ntu, exact=e, approx=ap, diff_pts=100 * (ap - e)))
out['xflow_table'] = tab
out['xflow_max_err_pts_cr_0.9_1_ntu_3_6'] = max(abs(r['diff_pts']) for r in tab if r['cr'] >= 0.9 and r['ntu'] >= 3)
# default case: eps 0.75 on Cmin, Cr 435.215/455.716 (60 lb/min outside air, 0.4331842 kg/s charge)
ma = 0.4331842065213; ao = 60 * 0.45359237 / 60
Ch, Cc = ma * CP_AIR, ao * CP_AIR
cr0 = min(Ch, Cc) / max(Ch, Cc)
Q = ma * CP_AIR * (101.56982099150139 - 44.14245524787535)
epsm = Q / (min(Ch, Cc) * (101.56982099150139 - 25))
for e_ in (0.70, 0.75, 0.77):
    out.setdefault('xflow_inverse_cr1', []).append(dict(eps=e_, ntu_exact=invert(eps_exact, e_, 1.0), ntu_approx=invert(eps_approx, e_, 1.0)))
out['default_ic'] = dict(Cr=cr0, eps=epsm, ntu_approx=invert(eps_approx, epsm, cr0), ntu_exact=invert(eps_exact, epsm, cr0))
try:
    from ht import effectiveness_from_NTU
    out['ht_check'] = dict(approx=effectiveness_from_NTU(4.45237, cr0, 'crossflow approximate'),
                           exact=effectiveness_from_NTU(4.45237, cr0, 'crossflow'), mine_exact=eps_exact(4.45237, cr0))
except ImportError:
    out['ht_check'] = 'python-ht not on PYTHONPATH'

# ---- 2. Garrett's airflow and required MAP (Garrett, "How to select a turbo, part 2", worked example) ---------------
# Wa = HP x A/F x BSFC / 60; MAP = Wa R (460 + Tm) / (VE N/2 Vd), R 639.6 (the article names R = 639.6, Tm deg F, Vd ci)
wa = 650 * 11.5 * 0.46 / 60
mp = wa * 639.6 * (460 + 130) / (0.80 * 6000 / 2 * 348)
out['garrett_part2'] = dict(wa=wa, wa_garrett=57.3, map=mp, map_garrett=26.025, pr=(mp + 2) / (14.7 - 1), pr_garrett=28.025 / 13.7)

# ---- 3. Corrected flow (ATP Turbo general definitions: 85 F = 544.67 R, 13.95 psia) ---------------------------------
P1 = 100109.56592394777
out['corr_flow'] = ma * math.sqrt((30 * 1.8 + 32 + 459.67) / 544.67) / (P1 / 6894.757 / 13.95)

# ---- 4. Turbine power balance with variable cp (burned-gas properties from GRI-Mech 3.0 NASA-7 polynomials) ---------
# Products of CH1.87 with stoichiometric air per C atom (Heywood): CO2 1, H2O 0.935, N2 + Ar 1.4675 x 3.773.
def nasa(path):
    import re
    txt = open(path).read()
    sp = {}
    for name in ('CO2', 'H2O', 'N2', 'AR'):
        i = txt.find('- name: ' + name + '\n')
        blk = txt[txt.find('data:', i):txt.find('note:', i) if 0 < txt.find('note:', i) < i + 900 else i + 900]
        rows = re.findall(r'\[([^\]]+)\]', blk.replace('\n', ' '))
        lo, hi = ([float(x) for x in r.split(',')] for r in rows[:2])
        sp[name] = (lo[:5], hi[:5])
    return sp


Ru = 8.314462618
M = dict(CO2=44.0095, H2O=18.01528, N2=28.0134, AR=39.948)
X = dict(CO2=1.0, H2O=0.935, N2=1.4675 * 3.7279, AR=1.4675 * 0.04459)
nt = sum(X.values())
Mmix = sum(X[k] * M[k] for k in X) / nt / 1000
Rex = Ru / Mmix
gri = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/calebbell/cantera/data/gri30.yaml'
try:
    S = nasa(gri)

    def cpR(T):
        return sum(X[k] / nt * (lambda a: a[0] + T * (a[1] + T * (a[2] + T * (a[3] + T * a[4]))))(S[k][0] if T <= 1000 else S[k][1]) for k in X)

    def h(T):  # J/kg, integral of cp from 300 K (trapezoid, 0.5 K)
        n = int((T - 300) / 0.5) + 1
        dT = (T - 300) / n
        return sum(0.5 * (cpR(300 + i * dT) + cpR(300 + (i + 1) * dT)) * dT for i in range(n)) * Rex

    def s0(T):  # J/kg K, integral of cp/T dT from 300 K
        n = int((T - 300) / 0.5) + 1
        dT = (T - 300) / n
        return sum(0.5 * (cpR(300 + i * dT) / (300 + i * dT) + cpR(300 + (i + 1) * dT) / (300 + (i + 1) * dT)) * dT for i in range(n)) * Rex

    T3 = 950 + 273.15
    g3 = cpR(T3) / (cpR(T3) - 1)
    cp3 = cpR(T3) * Rex
    t2 = 101.56982099150139
    Wc = ma * CP_AIR * (t2 - 30)
    me = ma * (1 + 1 / 12)
    res = dict(R=Rex, gamma_T3=g3, cp_T3=cp3, me=me, Wc=Wc)
    for eta in (0.55, 0.70, 0.75):
        need = Wc / (eta * me)              # J/kg isentropic drop needed
        # constant cp at T3 (the page's form): need = cp3 T3 (1 - ER^-k)
        k = (g3 - 1) / g3
        ER_c = (1 - need / (cp3 * T3)) ** (-1 / k)
        # variable cp: find T4s with h(T3) - h(T4s) = need, then ER = exp((s0(T3) - s0(T4s)) / R)
        h3, lo, hi = h(T3), 400.0, T3
        for _ in range(60):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if h3 - h(mid) > need else (lo, mid)
        T4 = (lo + hi) / 2
        ER_v = math.exp((s0(T3) - s0(T4)) / Rex)
        p3 = PATM + 2 * 55158
        share_c = need / (cp3 * T3 * (1 - (PATM / p3) ** k))
        res['eta_%.2f' % eta] = dict(ER_const_cp=ER_c, ER_var_cp=ER_v, wg_share_2x_const=1 - share_c)
        # variable-cp share at p3: isentropic drop available at p3 -> p4
        lo, hi = 400.0, T3
        target = s0(T3) - Rex * math.log(p3 / PATM)
        for _ in range(60):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if s0(mid) < target else (lo, mid)
        dh_av = h3 - h((lo + hi) / 2)
        res['eta_%.2f' % eta]['wg_share_2x_var'] = 1 - need / dh_av
    out['turbine'] = res
except (OSError, ValueError) as e:
    out['turbine'] = 'gri30.yaml not read: %s' % e

# ---- 5. Orifice / valve flow (isentropic nozzle; choked when p/p0 <= (2/(g+1))^(g/(g-1)); Wikipedia "Choked flow",
#         NASA Glenn "Mass flow choking": m = A p0 sqrt(g/(R T0)) ((g+1)/2)^(-(g+1)/(2(g-1))) when choked) --------------
def area(m, p0, T0, p, g, R):
    rc = (2 / (g + 1)) ** (g / (g - 1))
    if p / p0 <= rc:
        flux = p0 * math.sqrt(g / (R * T0)) * ((g + 1) / 2) ** (-(g + 1) / (2 * (g - 1)))
        return m / flux, True
    r = p / p0
    flux = p0 * math.sqrt(2 * g / ((g - 1) * R * T0) * (r ** (2 / g) - r ** ((g + 1) / g)))
    return m / flux, False


out['bov_default'] = dict(zip(('A_m2', 'choked'), area(ma, PATM + 55158, 44.14245524787535 + 273.15, P1, G, R_AIR)))
if isinstance(out['turbine'], dict):
    sh = out['turbine']['eta_0.75']['wg_share_2x_const']
    out['wg_default'] = dict(zip(('A_m2', 'choked'), area(sh * me, PATM + 2 * 55158, 1223.15, PATM, g3, Rex)), mw=sh * me)
    # poppet valve: curtain area pi D L equals the port area pi D^2 / 4 at L = D / 4 (Heywood sec. 6.3); lift a 40 mm
    # valve needs to give the effective area at Cd 1 and at an assumed Cd 0.7 (illustration only, no sourced Cd)
    A = out['wg_default']['A_m2']
    out['wg_default']['lift_40mm_cd1_mm'] = A / (math.pi * 0.040) * 1000
    out['wg_default']['lift_40mm_cd07_mm'] = A / 0.7 / (math.pi * 0.040) * 1000

# ---- 6. Water-to-air loop: steady state and warm-up, by direct time integration of the lumped balance ---------------
def loop(UA1, UA2, Ch, Cw, Ca, th, ta, Mcw, dt=0.01, tend=2000):
    c1, c2 = min(Ch, Cw), min(Ca, Cw)
    e1 = eps_exact(UA1 / c1, c1 / max(Ch, Cw)) * c1
    e2 = eps_exact(UA2 / c2, c2 / max(Ca, Cw)) * c2
    Tw, t, t90 = ta, 0.0, None
    # steady state by fixed point: Q1 = Q2
    Ts = ta
    for _ in range(10000):
        Q1 = e1 * (th - Ts); Q2 = e2 * (Ts + Q1 / Cw - ta); Ts += (Q1 - Q2) / (e1 + e2) * 0.5
    while t < tend:
        Q1 = e1 * (th - Tw); Q2 = e2 * (Tw + Q1 / Cw - ta)
        Tw += (Q1 - Q2) / Mcw * dt; t += dt
        if t90 is None and Tw - ta >= 0.9 * (Ts - ta):
            t90 = t
    return dict(Q=e1 * (th - Ts), tw1=Ts, t90=t90)


Cw = 20 / 60 / 1000 * 992 * 4183
out['w2a_loop'] = loop(600.0, 1500.0, Ch, Cw, 1.0 * CP_AIR, 101.56982099150139, 25.0, 6 / 1000 * 992 * 4183)
out['w2a_loop']['inputs'] = 'UA1 600, UA2 1500 W/K, water 20 L/min (rho 992, cp 4183), front air 1 kg/s, 6 L'
if __name__ == '__main__':
    print(json.dumps(out, indent=1))
