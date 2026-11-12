#!/usr/bin/env python3
"""Independent recomputation of the Intake tab's boosted route (calcTurboRoute) for two input sets.

Boost audit 2026-11-12 (docs/BOOST_AUDIT_2026-11-12.md). Written from the sources, not ported from web/index.html:
  - ideal gas rho = p / (R T), R 287.05; Sutherland viscosity for air (mu0 1.716e-5 at 273.15 K, S 110.4 K);
  - Haaland's explicit friction factor (Haaland 1983, as in python-fluids friction.Haaland) on drawn tube,
    roughness 0.0015 mm;
  - Crane TP-410 90 deg bend multiples of f against r/D (python-fluids bend_rounded_Crane table, ratios 1-20),
    times Idelchik's angle factor A1, applied to the tube's own f (the page's documented convention; Crane itself
    uses the fully turbulent fT of commercial steel; see finding B6);
  - cones and steps: python-fluids diffuser_conical / contraction_conical 'Rennels' (imported from the library
    source, CalebBell/fluids), sudden enlargement Borda-Carnot (1 - beta^2)^2, sharp contraction Rennels;
  - compressor outlet temperature T2 = T1 (1 + (PR^((g-1)/g) - 1) / eta), g 1.4;
  - the march: p at the throttle, each section's density at its downstream pressure, back to the compressor,
    repeated until the outlet pressure is stationary.
Usage: PYTHONPATH=<fluids checkout> python3 route.py   (prints JSON of both cases)
"""
import json, math, sys
try:
    from fluids.fittings import diffuser_conical, contraction_conical
except ImportError:
    sys.exit('needs python-fluids on PYTHONPATH (git clone https://github.com/CalebBell/fluids)')

R, G, PATM = 287.05, 1.4, 101325.0
KS = 1.5e-6
CRANE = [(1, 20), (1.5, 14), (2, 12), (3, 12), (4, 14), (6, 17), (8, 24), (10, 30), (12, 34), (14, 38), (16, 42), (20, 50)]


def mu(tc):
    T = tc + 273.15
    return 1.716e-5 * (T / 273.15) ** 1.5 * (273.15 + 110.4) / (T + 110.4)


def haaland(Re, D):
    if Re < 2300:
        return 64 / Re
    return (-1.8 * math.log10((KS / D / 3.7) ** 1.11 + 6.9 / Re)) ** -2


def crane_n(rd):
    x = min(max(rd, 1), 20)
    for (a, na), (b, nb) in zip(CRANE, CRANE[1:]):
        if x <= b:
            return na + (nb - na) * (x - a) / (b - a)
    return CRANE[-1][1]


def a1(deg):
    if deg <= 70:
        return 0.9 * math.sin(math.radians(deg))
    if deg >= 100:
        return 0.7 + 0.35 * deg / 90
    a70, a100 = 0.9 * math.sin(math.radians(70)), 0.7 + 0.35 * 100 / 90
    return a70 + (1 - a70) * (deg - 70) / 20 if deg <= 90 else 1 + (a100 - 1) * (deg - 90) / 10


def pipe(m, d_mm, L_mm, tc, p, n90=0.0, angs=(), rb=None):
    D = d_mm / 1000
    A = math.pi * D * D / 4
    rho = p / (R * (tc + 273.15))
    v = m / (rho * A)
    q = rho * v * v / 2
    Re = rho * v * D / mu(tc)
    f = haaland(Re, D)
    rmm = rb if rb else 1.5 * d_mm
    bends = list(angs) if angs else []
    if bends:
        K = sum(crane_n(rmm / d_mm) * f * a1(a) for a in bends)
        arcs = sum(math.radians(a) * rmm for a in bends)
    else:
        K = n90 * crane_n(rmm / d_mm) * f
        arcs = n90 * math.pi / 2 * rmm
    Ls = max(0, L_mm - arcs)
    return dict(rho=rho, v=v, q=q, f=f, Re=Re, dpF=f * Ls / d_mm * q, dpB=K * q, A=A)


def step(dup, ddn, m, tc, p, sudden=False):
    if abs(dup - ddn) < 0.05:
        return None
    d, Dm = min(dup, ddn), max(dup, ddn)
    widen = ddn > dup
    beta = d / Dm
    A = math.pi * (d / 2000) ** 2
    rho = p / (R * (tc + 273.15))
    v = m / (rho * A)
    q = rho * v * v / 2
    f = haaland(rho * v * d / 1000 / mu(tc), d / 1000)
    best = None
    a = 2.0
    while a <= 60 + 1e-9:
        if widen:
            K = diffuser_conical(d / 1000, Dm / 1000, angle=a, fd=f, method='Rennels')
        else:
            K = contraction_conical(Dm / 1000, d / 1000, angle=a, fd=f, method='Rennels')
        if best is None or K < best[1] - 1e-15:
            best = (a, K)
        a += 0.5
    Ks = (1 - beta * beta) ** 2 if widen else contraction_conical(Dm / 1000, d / 1000, angle=180, fd=0.0, method='Rennels')
    K = Ks if sudden else best[1]
    return dict(alpha=best[0], Kcone=best[1], Kstep=Ks, dp=K * q, q=q)


def t_out(t1, pr, eta):
    return (t1 + 273.15) * (1 + (pr ** ((G - 1) / G) - 1) / eta) - 273.15


def route(c):
    nt = c.get('nt', 1)
    merged = c.get('merge', False) and nt > 1
    m = c['Q'] / nt * PATM / (R * (c['tin'] + 273.15))
    mc = m * nt if merged else m
    dc = c.get('dc') or c['dh']
    Pt = PATM + c['boost']
    n90 = c['bends'] / 2
    trIn = step(c['dt'], c['dci'], m, c['tin'], PATM, c.get('step', False)) if c.get('dci') else None
    P1 = PATM - c['inlet_dp'] - (trIn['dp'] if trIn else 0)
    P2 = Pt
    for it in range(60):
        t2 = t_out(c['tin'], P2 / P1, c['eff'])
        t3 = t2 - c['ice'] * (t2 - c['tamb'])
        P = Pt
        if nt == 1 or merged:
            s = step(dc, c['dtb'], mc, t3, P, c.get('step', False)) if c.get('dtb') else None
            P += s['dp'] if s else 0
        cold = pipe(mc, dc, c['Lc'], t3, P, n90, c.get('angC', ()), c.get('rb'))
        P += cold['dpF'] + cold['dpB']
        if c.get('dico'):
            s = step(c['dico'], dc, mc, t3, P, c.get('step', False)); P += s['dp'] if s else 0
        P += c['dpIC']
        if c.get('dici') and not merged:
            s = step(c['dh'], c['dici'], m, t2, P, c.get('step', False)); P += s['dp'] if s else 0
        hot = pipe(m, c['dh'], c['Lh'], t2, P, n90, c.get('angH', ()), c.get('rb'))
        P += hot['dpF'] + hot['dpB']
        if c.get('dco'):
            s = step(c['dco'], c['dh'], m, t2, P, c.get('step', False)); P += s['dp'] if s else 0
        if abs(P - P2) < 1e-7:
            P2 = P
            break
        P2 = P
    t2 = t_out(c['tin'], P2 / P1, c['eff'])
    return dict(m=m, P1=P1, P2=P2, PRc=P2 / P1, t2=t2, t3=t2 - c['ice'] * (t2 - c['tamb']), total=PATM - P1 + P2 - Pt,
                iters=it + 1, hot_rho=hot['rho'], cold_rho=cold['rho'])


# Case A: the Intake tab's defaults (5735.5 cc, 5600 RPM, VE 0.90, 8 psi, inlet 30 C, ambient 25 C, eta 0.70,
# intercooler 75 %, core 6.895 kPa, 2.37 in (60.198 mm) pipes 36 in each, 4 x 90 deg bends, 3.0 in throttle).
# The inlet tube loss (calcIntake, audited 2026-11-11) is taken as an input: 1215.434 Pa.
Q = 5.7355e-3 * 5600 / 120 * 0.90 * (PATM + 55158) / PATM
A = dict(Q=Q, tin=30, tamb=25, eff=0.70, ice=0.75, dpIC=6895, boost=55158, inlet_dp=1215.4340760522273, dt=88.9,
         dh=60.198, Lh=914.4, Lc=914.4, bends=4, dtb=76.2)
# Case B: twin turbos into one intercooler, compressor ports 76.2 / 50.8 mm, cooler ports 63.5 mm, 45 + 90 deg hot,
# 90 deg cold at 100 mm radius, 12 psi, eta 0.72, inlet tube loss per turbo taken as 334.4772272 Pa.
B = dict(Q=Q * (PATM + 82737) / (PATM + 55158), nt=2, merge=True, tin=30, tamb=25, eff=0.72, ice=0.8, dpIC=6895,
         boost=82737, inlet_dp=334.4772272, dt=88.9, dci=76.2, dco=50.8, dici=63.5, dico=63.5, dh=60.198, dc=72.898,
         Lh=700, Lc=1200, bends=0, angH=(45, 90), angC=(90,), rb=100, dtb=76.2)
if __name__ == '__main__':
    print(json.dumps({'A': route(A), 'B': route(B), 'inputs': {'A': A, 'B': B}}, indent=1))
