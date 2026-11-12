#!/usr/bin/env python3
"""Independent check of the Intake tab's exhaust march (exhMarch, 2026-11-12): the gas cooling along the pipe, the
compressible flow with friction and heat loss, the minor losses, the steps and the tip. Written from the sources, not
ported from web/index.html; where the page's model chooses a property fit or a coefficient, the same documented choice is
taken here (said at each place), so that what is checked is the solution of the equations.

Usage: node tools/validation/boost/xflow_page.js > page.json
       python3 tools/validation/boost/xflow.py page.json path/to/cantera/data/gri30.yaml
Prints, per case and per part, this script's static pressure rise against the page's, and the back pressure.

Different from the page on purpose:
 - the cooling is integrated with scipy's solve_ivp (RK45, rtol 1e-10) on a continuous T0(x), the page uses calcSkin's
   explicit 10 mm steps;
 - the pipe flow is integrated in the gas speed from the primitive equations with cp(T) (no constant-gamma step), the page in
   p with Shapiro's influence coefficients (gamma held over each 10 mm step);
 - the sudden enlargement is solved in Mach numbers (momentum and continuity ratio), the page by bisection on V1;
 - the outer-surface balance is solved with brentq, the page by bisection.
"""
import json, math, re, sys
from scipy.integrate import solve_ivp
from scipy.optimize import brentq

PATM, RU, SIG = 101325.0, 8.314462618, 5.670374e-8
R_AIR = 287.05

# ---- burned gas: stoichiometric CH1.87 + air, per C atom CO2 1, H2O 0.935, N2 1.4675 x 3.7279, Ar 1.4675 x 0.04459 (MIT 2.61
# lecture 4; NOAA dry air), NASA-7 cp/R from Cantera's gri30.yaml (read here from the file) -----------------------------
def nasa(path):
    txt = open(path, encoding='utf-8').read()
    out = {}
    for name in ('CO2', 'H2O', 'N2', 'AR'):
        m = re.search(r'- name: ' + name + r'\n.*?data:\n\s*- \[([^\]]*)\]\n\s*- \[([^\]]*)\]', txt, re.S)
        lo = [float(x) for x in m.group(1).replace('\n', ' ').split(',')]
        hi = [float(x) for x in m.group(2).replace('\n', ' ').split(',')]
        out[name] = (lo, hi)
    return out


AW = {'C': 12.011, 'H': 1.008, 'O': 15.999, 'N': 14.007, 'Ar': 39.95}   # IUPAC conventional atomic weights
MW = {'CO2': AW['C'] + 2 * AW['O'], 'H2O': 2 * AW['H'] + AW['O'], 'N2': 2 * AW['N'], 'AR': AW['Ar']}
MOL = {'CO2': 1.0, 'H2O': 0.935, 'N2': 1.4675 * 3.7279, 'AR': 1.4675 * 0.04459}


class Gas:
    def __init__(self, path):
        self.c = nasa(path)
        n = sum(MOL.values())
        self.x = {k: v / n for k, v in MOL.items()}
        self.M = sum(self.x[k] * MW[k] for k in MOL) / 1000
        self.R = RU / self.M

    def cpR(self, T):
        s = 0.0
        for k, xk in self.x.items():
            a = self.c[k][0] if T <= 1000 else self.c[k][1]
            s += xk * (a[0] + T * (a[1] + T * (a[2] + T * (a[3] + T * a[4]))))
        return s

    def g(self, T):
        c = self.cpR(T); return c / (c - 1)

    def cp(self, T):
        return self.cpR(T) * self.R


# ---- the film: the page's documented air fits (calcSkin): Sutherland, k = 0.0241 (T/273.15)^0.81, cp = 1005 + 0.195 (T - 300)
mu = lambda T: 1.716e-5 * (T / 273.15) ** 1.5 * (273.15 + 110.4) / (T + 110.4)
kA = lambda T: 0.0241 * (T / 273.15) ** 0.81
cpA = lambda T: 1005 + 0.195 * (T - 300)
EPS = {'ox': 0.85, 'tint': 0.70, 'new': 0.30, 'black': 0.90, 'wrap1': 0.90, 'wrap2': 0.90}   # SKIN_FIN (the research note's table)
WRAP = {'wrap1': 1, 'wrap2': 2}


def h_out(Ts, Ta, D, v):
    """Churchill-Chu (horizontal cylinder) and Churchill-Bernstein (cross flow), combined as the cube root of the sum of cubes."""
    Tf = (Ts + Ta) / 2; m_, k_, cp_ = mu(Tf), kA(Tf), cpA(Tf); rho = PATM / (R_AIR * Tf); nu = m_ / rho; Pr = m_ * cp_ / k_
    Ra = 9.81 / Tf * max(Ts - Ta, 1e-6) * D ** 3 / nu ** 2 * Pr
    Nn = (0.60 + 0.387 * Ra ** (1 / 6) / (1 + (0.559 / Pr) ** (9 / 16)) ** (8 / 27)) ** 2
    Nf = 0.0
    if v > 0:
        Re = v * D / nu
        Nf = 0.3 + 0.62 * Re ** 0.5 * Pr ** (1 / 3) / (1 + (0.4 / Pr) ** (2 / 3)) ** 0.25 * (1 + (Re / 282000) ** 0.625) ** 0.8
    return (Nn ** 3 + Nf ** 3) ** (1 / 3) * k_ / D


def q_per_m(Tg, m, di, wall, fin, Ta, v, caf):
    """Heat leaving one metre of pipe, W/m: Gnielinski with Petukhov's f (x CAF) inside, conduction (304, k 20; wrap 1.6 mm a
    layer at k 0.08, the page's figures), convection and grey radiation outside."""
    ri = di / 2000; rw = ri + wall / 1000; ro = rw + WRAP.get(fin, 0) * 1.6e-3; Do = 2 * ro
    Re = 4 * m / (math.pi * 2 * ri * mu(Tg)); Pr = mu(Tg) * cpA(Tg) / kA(Tg)
    f = (0.79 * math.log(Re) - 1.64) ** -2
    Nu = max(3.66, (f / 8) * (Re - 1000) * Pr / (1 + 12.7 * math.sqrt(f / 8) * (Pr ** (2 / 3) - 1)))
    hi = caf * Nu * kA(Tg) / (2 * ri)
    Rin = 1 / (hi * 2 * math.pi * ri) + math.log(rw / ri) / (2 * math.pi * 20) + (math.log(ro / rw) / (2 * math.pi * 0.08) if fin in WRAP else 0)
    e = EPS[fin]
    bal = lambda Ts: (Tg - Ts) / Rin - math.pi * Do * (h_out(Ts, Ta, Do, v) * (Ts - Ta) + e * SIG * (Ts ** 4 - Ta ** 4))
    Ts = brentq(bal, Ta + 1e-9, Tg)
    return (Tg - Ts) / Rin


def cool(gas, m, di, L, T0, c, caf):
    if c is None or not L > 0:
        return lambda x: T0, T0
    Ta = c['Ta'] + 273.15
    sol = solve_ivp(lambda x, T: [-q_per_m(T[0], m, di, c['wall'], c['fin'], Ta, c['v'], caf) / (m * gas.cp(T[0]))], (0, L / 1000), [T0],
                    rtol=1e-10, atol=1e-8, dense_output=True)
    return (lambda x: float(sol.sol(min(max(x, 0), L / 1000))[0])), float(sol.y[0][-1])


# ---- 1-D compressible states (NASA Glenn, "Isentropic Flow"; mass-flow function) -------------------------------------------
class St:
    pass


def state_p(gas, m, A, p, T0):
    """State at a static pressure: m^2 R T0 / (p^2 A^2 g) = M^2 (1 + (g-1) M^2 / 2), g at the static T (fixed point)."""
    g = gas.g(T0)
    for _ in range(30):
        K2 = m * m * gas.R * T0 / (p * p * A * A * g)
        X = (math.sqrt(1 + 2 * (g - 1) * K2) - 1) / (g - 1)
        T = T0 / (1 + (g - 1) / 2 * X); g2 = gas.g(T)
        if abs(g2 - g) < 1e-14: break
        g = g2
    s = St(); s.p, s.T0, s.T, s.g, s.M = p, T0, T, g, math.sqrt(X)
    s.rho = p / (gas.R * T); s.v = m / (s.rho * A); s.q = s.rho * s.v ** 2 / 2; s.p0 = p * (1 + (g - 1) / 2 * X) ** (g / (g - 1))
    return s


def state_p0(gas, m, A, p0, T0):
    """Subsonic state at a stagnation pressure. p0(p) = p psi^(g/(g-1)) at fixed m, A, T0 is least at M = 1 (p*): below
    p0(p*) the section is choked (None); otherwise brentq for p on the subsonic side [p*, p0]."""
    ps = brentq(lambda p: state_p(gas, m, A, p, T0).M - 1, 1e-3 * p0, p0, xtol=1e-12, rtol=1e-15) if state_p(gas, m, A, p0, T0).M < 1 else p0
    if state_p(gas, m, A, ps, T0).p0 > p0: return None
    p = brentq(lambda p: state_p(gas, m, A, p, T0).p0 - p0, ps, p0, xtol=1e-10, rtol=1e-15)
    return state_p(gas, m, A, p, T0)


def lump(gas, m, A, sd, loss):
    """Upstream state of a part that loses stagnation pressure loss(su), su its upstream state."""
    p0 = sd.p0
    for _ in range(200):
        su = state_p0(gas, m, A, p0, sd.T0)
        nx = sd.p0 + loss(su)
        if abs(nx - p0) < 1e-9 * nx: break
        p0 = nx
    return state_p0(gas, m, A, p0, sd.T0)


def haaland(Re, D):
    return 64 / Re if Re < 2300 else 1 / (-1.8 * math.log10((1.5e-6 / D / 3.7) ** 1.11 + 6.9 / Re)) ** 2


def pipe_back(gas, m, d, L, n90, T0x, sd):
    """The primitive 1-D equations, marched upstream in the gas speed V with solve_ivp (no constant-gamma step):
    G = m / A = rho V, p = G R T / V, energy T0(x) = T + V^2 / (2 cp(T)) (T found from V and the cooled T0 by brentq: the page's
    definition, T0 = T (1 + (gamma(T) - 1) M^2 / 2), is the same relation), momentum dp/dx = -G dV/dx - f G V / (2 D). With
    T = T(V, x): dV/dx = [-f V / (2 D) - R (dT/dx)_V / V] / [1 + R ((dT/dV)_x / V - T / V^2)], the partials by central
    differences. Crane bends (n 14 at r/D 1.5, K = n f) at the middle as a stagnation-pressure loss."""
    A = math.pi * (d / 2000) ** 2; D = d / 1000; Lm = L / 1000; G = m / A; R = gas.R
    arc = math.pi / 2 * 1.5 * d; kf = max(0, L - n90 * arc) / L
    def Tof(V, x):
        T0 = T0x(x); return brentq(lambda T: T + V * V / (2 * gas.cp(T)) - T0, 0.3 * T0, T0, xtol=1e-12, rtol=1e-15)
    def rhs(x, y):
        V = y[0]; T = Tof(V, x); dv = V * 1e-6; dx = 1e-6
        TV = (Tof(V + dv, x) - Tof(V - dv, x)) / (2 * dv)
        Tx = (Tof(V, min(x + dx, Lm)) - Tof(V, max(x - dx, 0))) / (min(x + dx, Lm) - max(x - dx, 0))
        f = kf * haaland(4 * m / (math.pi * D * mu(T)), D)
        return [(-f * V / (2 * D) - R * Tx / V) / (1 + R * (TV / V - T / V ** 2))]
    def st(V, x):
        T = Tof(V, x); return state_p(gas, m, A, G * R * T / V, T0x(x))
    V = state_p(gas, m, A, sd.p, T0x(Lm)).v; x0 = Lm
    if n90 > 0:
        sol = solve_ivp(rhs, (Lm, Lm / 2), [V], rtol=1e-11, atol=1e-10); V = sol.y[0][-1]
        sm = st(V, Lm / 2)
        Kb = n90 * 14 * haaland(4 * m / (math.pi * D * mu(sm.T)), D)
        su = lump(gas, m, A, sm, lambda u: Kb * u.q); V = su.v; x0 = Lm / 2
    sol = solve_ivp(rhs, (x0, 0), [V], rtol=1e-11, atol=1e-10); V = sol.y[0][-1]
    return st(V, 0)


def rennels_diffuser(a, b):
    """python-fluids diffuser_conical 'Rennels' (Rennels and Hudson 2012), alpha <= 20 deg branch (the least-loss angle here)."""
    e = (1 - b * b) ** 2
    if a <= 20: return 8.30 * math.tan(math.radians(a / 2)) ** 1.75 * e
    if a <= 60: return (1.366 * math.sqrt(math.sin(2 * math.pi * (a - 15) / 180)) - 0.170 - (3.28 * (0.0625 - b ** 4) * math.sqrt((a - 20) / 40) if b < 0.5 else 0)) * e
    raise ValueError


def main(page_json, yaml_path):
    gas = Gas(yaml_path)
    data = json.load(open(page_json, encoding='utf-8'))
    print('burned gas R %.4f J/kg K (page %.4f)' % (gas.R, data['case1']['R']))
    for name, case in data.items():
        o, pg = case['o'], case['page']
        c = o['cool']
        caf = (lambda k: (3.0 if k == 'dp' else 1.6) if c and c['caf'] == 'w' else 1.0)
        me, nt, xn = o['me'], o['nt'], o['xn']; mP = me * nt / xn
        T0 = o['t4'] + 273.15
        # forward: temperatures
        T0x_dp, T0 = cool(gas, me, o['d'], o['L'], T0, c, caf('dp'))
        T_muf = T0
        sec = o['tail']['secs'][0]; T0x_t, T0 = cool(gas, mP, sec['d'], sec['L'], T0, c, caf('tail'))
        T_tip = T0
        # backward: pressures
        res = {}
        A = lambda d: math.pi * (d / 2000) ** 2
        dE = o['tail']['dExit']; s0 = state_p(gas, mP, A(dE), PATM, T_tip); p = PATM
        for _ in range(200):
            se = state_p(gas, mP, A(dE), p, T_tip); nx = PATM + 0.4 * se.q
            if abs(nx - p) < 1e-9: break
            p = nx
        res['tip'] = se.p - PATM
        su = pipe_back(gas, mP, sec['d'], sec['L'], o['xb'], T0x_t, se); res['tail'] = su.p - se.p; s = su
        mf = o['muf']
        if abs(sec['d'] - mf['d']) >= 0.05:   # the step from the muffler pipe to the tail
            A1, A2 = A(mf['d']), A(sec['d']); s2 = state_p(gas, mP, A2, s.p, T_muf)
            if sec['d'] > mf['d']:
                # sudden enlargement: p1 M1 a sqrt(psi1) = p2 M2 sqrt(psi2) and p1 (1 + g M1^2 a) = p2 (1 + g M2^2), a = A1/A2
                a = A1 / A2; g = s2.g; psi = lambda M: 1 + (g - 1) / 2 * M * M
                rhs = (1 + g * s2.M ** 2) / (s2.M * math.sqrt(psi(s2.M)))
                M1 = brentq(lambda M: (1 + g * M * M * a) / (M * a * math.sqrt(psi(M))) - rhs, s2.M, 0.999999)
                p1 = s2.p * s2.M * math.sqrt(psi(s2.M)) / (M1 * a * math.sqrt(psi(M1)))
                s1 = state_p(gas, mP, A1, p1, T_muf)
            else:
                b = sec['d'] / mf['d']; lam = 1 + 0.622 * (1 - 0.215 * b * b - 0.785 * b ** 5); K = 0.0696 * (1 - b ** 5) * lam * lam + (lam - 1) ** 2
                s1 = state_p0(gas, mP, A1, s2.p0 + K * s2.q, T_muf)
            res['step'] = s1.p - s2.p; s = s1
        # the muffler: Munjal (1987) eq. 8.4 for the chamber; Munjal, Vijayasree and Chaitanya (2013) for the plug, on the inlet's head
        Am = A(mf['d']); s2 = state_p(gas, mP, Am, s.p, T_muf)
        if mf['kind'] == 'chamber':
            n = (mf['d'] / mf['dch']) ** 2; Kt = (1 - n) ** 2 + (1 - n) / 2
        else:
            n = min(1.66, max(0.31, 4 * (mf['por'] / 100) * mf['plugL'] / mf['d'])); Kt = 3.136 * n ** -1.391 + 2.208 * n ** -1.5818
        su = lump(gas, mP, Am, s2, lambda u: Kt * u.q); res['muf'] = su.p - s2.p; s = su
        # the downpipe (one turbo, all in one pipe here)
        sd = state_p(gas, me, A(o['d']), s.p, T0x_dp(o['L'] / 1000))
        su = pipe_back(gas, me, o['d'], o['L'], o['n90'], T0x_dp, sd); res['dp'] = su.p - sd.p; s = su
        # the cone from the turbine outlet: Rennels' conical diffuser plus its friction f (1 - b^4)/(8 sin(a/2)), f at the small
        # end's Re at the downstream static temperature, the least-loss angle on a 0.5 deg grid from 2 deg; on the small end's head
        d1, d2 = o['dOut'], o['d']; b = d1 / d2; Tc = o['t4'] + 273.15
        f = haaland(4 * me / (math.pi * d1 / 1000 * mu(s.T)), d1 / 1000)
        K = min((rennels_diffuser(a / 2, b) + f * (1 - b ** 4) / (8 * math.sin(math.radians(a / 4))), a / 2) for a in range(4, 121))
        su = lump(gas, me, A(d1), s, lambda u: K[0] * u.q); res['cone'] = su.p - s.p
        bp = su.p - PATM
        print('\n%s: back pressure %.3f Pa here, %.3f Pa on the page (%.2e); total %.3f / %.3f Pa; tip T0 %.4f / %.4f K; cone %.1f deg'
              % (name, bp, pg['bp'], bp / pg['bp'] - 1, su.p0 - PATM, pg['bp0'], T_tip, pg['T0tip'], K[1]))
        for r in pg['rows']:
            if r['k'] in res:
                print('  %-5s here %12.3f  page %12.3f  (%.2e)' % (r['k'], res[r['k']], r['dp'], (res[r['k']] - r['dp']) / max(abs(r['dp']), 1)))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
