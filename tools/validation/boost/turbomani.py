#!/usr/bin/env python3
"""Independent check of the Intake tab's turbo manifold loss (mfdCalc, 2026-11-13): the gas states and the march from the
turbine flange back to the exhaust port. Written from the relations, not ported from web/index.html.

Usage: echo '<case json>' | python3 tools/validation/boost/turbomani.py      (web/tests/turbomani_ui.js runs it)
Input (one case, SI units, mm for sizes): m_col, m_run kg/s; p3 Pa (static at the turbine flange); T0 K; gamma, R (held
constant: the test sets the page's gamma to the same constant); d_col, L_col, d_eq (the runners' combined bore), d_run,
L_straight, d_port mm; K_merge, K_bends, K_port (the loss coefficients; see below); rough m.
Output: the static and total pressure at the port, the runner's Mach number at the port end and at the merge, the loss.

What is taken from the page and what is not:
 - the loss COEFFICIENTS (the 20 deg merge cone by Rennels with its friction term, the bends by Crane TP-410 / Idelchik,
   the sharp contraction at the port by Rennels) are the page's numbers: they are table and formula lookups already checked
   against python-fluids in the boost audit (B3, B6, B17, B24). Here each is applied on the head the page documents: a
   narrowing on the small downstream section's head, the bends on their own (upstream) state's head (a fixed point);
 - the GAS STATES are solved here: Mach number from the mass flow at a static or a stagnation pressure (bisection on the
   isentropic relations, constant gamma), stagnation pressure p0 = p (1 + (g - 1)/2 M^2)^(g/(g - 1));
 - the PIPE FRICTION is the closed Fanno form, dp/p = -g M^2 (1 + (g - 1) M^2) / (2 (1 - M^2)) f dx / D (Darcy f; Shapiro
   ch. 6; constant T0), integrated with RK4 in 4000 steps, f by Haaland on the drawn-tube roughness at the local Reynolds
   number with Sutherland's viscosity for air (the page's documented choice for the film); the page marches Shapiro's
   influence coefficients in 10 mm steps. No heat loss (the page holds T0 = T3 in the manifold).
"""
import json, math, sys


def mu(T):
    return 1.716e-5 * (T / 273.15) ** 1.5 * (273.15 + 110.4) / (T + 110.4)


def haaland(Re, D, rough):
    if Re < 2300:
        return 64.0 / Re
    return 1.0 / (-1.8 * math.log10((rough / D / 3.7) ** 1.11 + 6.9 / Re)) ** 2


def bisect(fn, lo, hi, n=200):
    flo = fn(lo)
    for _ in range(n):
        mid = 0.5 * (lo + hi)
        fm = fn(mid)
        if (fm > 0) == (flo > 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return 0.5 * (lo + hi)


class Gas:
    def __init__(self, g, R):
        self.g, self.R = g, R

    def psi(self, M):
        return 1 + (self.g - 1) / 2 * M * M

    def from_p(self, m, A, p, T0):
        # m = p A M sqrt(g / (R T)), T = T0 / psi
        g, R = self.g, self.R
        M = bisect(lambda M: p * A * M * math.sqrt(g * self.psi(M) / (R * T0)) - m, 1e-9, 0.999999)
        return self.state(m, A, p, M, T0)

    def from_p0(self, m, A, p0, T0):
        g, R = self.g, self.R
        tgt = m * math.sqrt(R * T0) / (A * p0)
        M = bisect(lambda M: math.sqrt(g) * M * self.psi(M) ** (-(g + 1) / (2 * (g - 1))) - tgt, 1e-9, 0.999999)
        p = p0 / self.psi(M) ** (g / (g - 1))
        return self.state(m, A, p, M, T0)

    def state(self, m, A, p, M, T0):
        g, R = self.g, self.R
        T = T0 / self.psi(M)
        rho = p / (R * T)
        v = m / (rho * A)
        return {'p': p, 'M': M, 'T': T, 'rho': rho, 'v': v, 'q': rho * v * v / 2, 'p0': p * self.psi(M) ** (g / (g - 1)), 'A': A, 'T0': T0}


def fanno_back(gas, m, d_mm, L_mm, s, rough):
    """march a constant-area pipe upstream from its downstream state s (static pressure rises upstream)"""
    D, A, T0, g = d_mm / 1000.0, s['A'], s['T0'], gas.g
    n = 4000
    h = L_mm / 1000.0 / n

    def dpdx(p):   # magnitude of the static-pressure fall per metre in the flow direction
        st = gas.from_p(m, A, p, T0)
        M2 = st['M'] ** 2
        f = haaland(4 * m / (math.pi * D * mu(st['T'])), D, rough)
        return p * g * M2 * (1 + (g - 1) * M2) / (2 * (1 - M2)) * f / D

    p = s['p']
    for _ in range(n):
        k1 = dpdx(p); k2 = dpdx(p + h / 2 * k1); k3 = dpdx(p + h / 2 * k2); k4 = dpdx(p + h * k3)
        p += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6
    return gas.from_p(m, A, p, T0)


def lump_up(gas, m, A, sd, K):
    """a loss K on the upstream state's own head: p0_up = p0_down + K q(up), solved by fixed point"""
    p0 = sd['p0']
    for _ in range(200):
        su = gas.from_p0(m, A, p0, sd['T0'])
        nx = sd['p0'] + K * su['q']
        if abs(nx - p0) < 1e-9 * nx:
            break
        p0 = nx
    return gas.from_p0(m, A, p0, sd['T0'])


def area(d_mm):
    return math.pi * (d_mm / 2000.0) ** 2


def run(c):
    gas = Gas(c['gamma'], c['R'])
    T0, rough = c['T0'], c.get('rough', 1.5e-6)
    s3 = gas.from_p(c['m_col'], area(c['d_col']), c['p3'], T0)           # the collector at the turbine flange (same bore)
    sc = fanno_back(gas, c['m_col'], c['d_col'], c['L_col'], s3, rough)   # collector, upstream end
    # merge: the runners' combined bore narrowing into the collector, K on the collector's (downstream, small) head
    sm = gas.from_p0(c['m_col'], area(c['d_eq']), sc['p0'] + c['K_merge'] * sc['q'], T0)
    sr = gas.from_p(c['m_run'], area(c['d_run']), sm['p'], T0)           # each runner at the merge: the same static pressure
    if c['L_straight'] > 0:
        sr = fanno_back(gas, c['m_run'], c['d_run'], c['L_straight'], sr, rough)
    sb = lump_up(gas, c['m_run'], area(c['d_run']), sr, c['K_bends']) if c['K_bends'] > 0 else sr
    # the port: a narrowing from the port into the runner, K on the runner's (downstream) head
    if c['d_port'] > c['d_run']:
        sp = gas.from_p0(c['m_run'], area(c['d_port']), sb['p0'] + c['K_port'] * sb['q'], T0)
    else:
        sp = sb   # (the K24 case narrows; a widening port step is not exercised here)
    return {'p_port': sp['p'], 'p0_port': sp['p0'], 'p3': s3['p'], 'p03': s3['p0'], 'dp': sp['p'] - s3['p'], 'dp0': sp['p0'] - s3['p0'],
            'M3': s3['M'], 'M_run_merge': gas.from_p(c['m_run'], area(c['d_run']), sm['p'], T0)['M'], 'M_port': sp['M'],
            'v_run_p3': gas.from_p(c['m_run'], area(c['d_run']), c['p3'], T0)['v']}


if __name__ == '__main__':
    print(json.dumps(run(json.loads(sys.stdin.read()))))
