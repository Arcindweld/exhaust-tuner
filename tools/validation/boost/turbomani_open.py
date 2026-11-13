#!/usr/bin/env python3
"""Independent check of the turbo manifold's open-period basis and its loss march (boost audit part 3, 2026-11-13).
Written from the relations for this audit, not ported from web/index.html and not from tools/validation/boost/turbomani.py.

Usage: echo '<case json>' | python3 tools/validation/boost/turbomani_open.py       (web/tests/boostaudit3_ui.js runs it)
       python3 tools/validation/boost/turbomani_open.py --self                     (the hand cases below)

1. Open period. A runner passes its cylinder's exhaust only while the exhaust valve is open, D crank degrees of the
   C-degree cycle (C = 720 for a four-stroke). Continuity over one cycle: the mass m_cyc leaves in the time D/C of the
   cycle, so the mean flow while open is m_mean x C / D (k = C / D), whatever the shape of the pulse.
   Loss averaging: a loss K rho v^2 / 2 at a given density goes as the square of the mass flow, so its time average is
   K <m^2> / (2 rho A^2). For a runner that flows k m_mean while open and nothing while shut, <m^2> over the open period
   is k^2 m_mean^2 (the loss while open is k^2 x the loss at the cycle mean) and over the whole cycle (D/C) k^2 m_mean^2 =
   k m_mean^2 (k x). A non-uniform pulse has a larger <m^2> for the same <m> (Cauchy-Schwarz), so the open-period figure
   is a lower bound for the mean loss while open.
   The collector carries n(t) runners' flow at once (square waves); over runner j's open period its mean square is
   <n^2> k^2 m_mean^2. Here <n^2> is worked out as sum over runner pairs (i, l) of |W_j n O_i n O_l| / D (the length of the
   triple intersection of circular arcs, by unrolling each arc into linear pieces over three cycles), averaged over j:
   a different method from the page's (which counts n on the pieces between breakpoints).
2. Gas states at a stagnation pressure p0 and temperature T0 with constant gamma: the mass-flow function
   m sqrt(R T0) / (A p0) = sqrt(gamma) M (1 + (gamma - 1)/2 M^2)^(-(gamma + 1)/(2 (gamma - 1))), solved for the subsonic M
   by bisection; T = T0 / psi, p = p0 / psi^(gamma/(gamma - 1)), v = M sqrt(gamma R T).
3. The march from the turbine flange (p3 a TOTAL pressure, as the page's turbine balance takes it) to the port: the
   collector and the runner straight by Fanno flow with Darcy friction, integrated in p0 here (not p: a different
   variable from the page's static-pressure RK4): dp0/dx = -p0 gamma M^2 f / (2 D) (Shapiro, ch. 6, the stagnation-pressure
   form for adiabatic constant-area flow), M from the mass-flow function at each p0; f by Haaland on 1.5 um drawn tube
   with Sutherland's viscosity for air (the page's choice for the film), RK4 in 2000 steps. The merge (narrowing to the
   collector) and the port step (narrowing into the runner) lose K x the downstream (smaller) section's dynamic head, the
   bends K x their own (upstream) head, solved by fixed point. The coefficients K are the page's (Rennels' cone, Crane /
   Idelchik bends, Rennels' sharp contraction: checked against python-fluids in Part 1, B3 / B6 / B17 / B24).
"""
import json
import math
import sys


def arcs(a, D, C):
    """the arc [a, a + D) mod C as linear intervals over [-C, 2C)"""
    a = a % C
    out = []
    for s in (-C, 0.0, C):
        out.append((a + s, a + s + D))
    return out


def inter(I, J):
    out = []
    for (a, b) in I:
        for (c, d) in J:
            lo, hi = max(a, c), min(b, d)
            if hi > lo:
                out.append((lo, hi))
    return out


def overlap(gaps, D, C=720.0):
    n = len(gaps)
    a = [0.0]
    for g in gaps[:-1]:
        a.append(a[-1] + g)
    s1 = s2 = 0.0
    for j in range(n):
        W = [(a[j], a[j] + D)]                   # the window itself, linear (the arcs below cover it in any copy)
        for i in range(n):
            Wi = inter(W, arcs(a[i], D, C))
            s1 += sum(h - l for l, h in Wi)
            for l_ in range(n):
                s2 += sum(h - l for l, h in inter(Wi, arcs(a[l_], D, C)))
    return {'mean': s1 / (n * D), 'rms': math.sqrt(s2 / (n * D)), 'k': C / D}


def mu(T):
    return 1.716e-5 * (T / 273.15) ** 1.5 * (273.15 + 110.4) / (T + 110.4)


def haaland(Re, D, rough=1.5e-6):
    if Re < 2300:
        return 64.0 / Re
    return 1.0 / (-1.8 * math.log10((rough / D / 3.7) ** 1.11 + 6.9 / Re)) ** 2


class Gas:
    def __init__(self, g, R):
        self.g, self.R = g, R

    def at_p0(self, m, d_mm, p0, T0):
        g, R = self.g, self.R
        A = math.pi * (d_mm / 2000.0) ** 2
        tgt = m * math.sqrt(R * T0) / (A * p0)
        F = lambda M: math.sqrt(g) * M * (1 + (g - 1) / 2 * M * M) ** (-(g + 1) / (2 * (g - 1)))
        if F(1.0) < tgt:
            return None
        lo, hi = 0.0, 1.0
        for _ in range(200):
            mid = 0.5 * (lo + hi)
            if F(mid) < tgt:
                lo = mid
            else:
                hi = mid
        M = 0.5 * (lo + hi)
        psi = 1 + (g - 1) / 2 * M * M
        T = T0 / psi
        p = p0 / psi ** (g / (g - 1))
        rho = p / (R * T)
        v = M * math.sqrt(g * R * T)
        return {'M': M, 'p': p, 'p0': p0, 'T': T, 'rho': rho, 'v': v, 'q': rho * v * v / 2, 'T0': T0, 'd': d_mm, 'm': m}


def fanno_up(gas, s, L_mm, f_fix=None):
    """constant-area adiabatic pipe, from its downstream state upstream: p0 rises by p0 gamma M^2 f / (2 D) per metre"""
    if L_mm <= 0:
        return s
    D = s['d'] / 1000.0
    n = 2000
    h = L_mm / 1000.0 / n

    def rate(p0):
        st = gas.at_p0(s['m'], s['d'], p0, s['T0'])
        Re = 4 * s['m'] / (math.pi * D * mu(st['T']))
        return p0 * gas.g * st['M'] ** 2 * (f_fix or haaland(Re, D)) / (2 * D)

    p0 = s['p0']
    for _ in range(n):
        k1 = rate(p0); k2 = rate(p0 + h / 2 * k1); k3 = rate(p0 + h / 2 * k2); k4 = rate(p0 + h * k3)
        p0 += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6
    return gas.at_p0(s['m'], s['d'], p0, s['T0'])


def lump_own(gas, s, K):
    """a loss K on its own (upstream) head, same area: p0u = p0d + K q(p0u), fixed point"""
    p0 = s['p0']
    for _ in range(500):
        u = gas.at_p0(s['m'], s['d'], p0, s['T0'])
        nx = s['p0'] + K * u['q']
        if abs(nx - p0) < 1e-12 * nx:
            break
        p0 = nx
    return gas.at_p0(s['m'], s['d'], p0, s['T0'])


def march(gas, c, m_col, m_run):
    T0 = c['T0']
    s3 = gas.at_p0(m_col, c['d_col'], c['p3'], T0)               # at the turbine flange (the collector's bore matches it)
    sc = fanno_up(gas, s3, c['L_col'])
    sm = gas.at_p0(m_col, c['d_eq'], sc['p0'] + c['K_merge'] * sc['q'], T0)   # merge: narrowing, K on the collector's head
    # each runner at the merge: the same static pressure as the combined section there (the page's junction rule)
    lo, hi = sm['p'], sm['p'] * 1.5
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        st = gas.at_p0(m_run, c['d_run'], mid, T0)
        if st is None or st['p'] < sm['p']:
            lo = mid
        else:
            hi = mid
    sr = gas.at_p0(m_run, c['d_run'], 0.5 * (lo + hi), T0)
    sr = fanno_up(gas, sr, c['L_straight'])
    sb = lump_own(gas, sr, c['K_bends']) if c['K_bends'] > 0 else sr
    sp = gas.at_p0(m_run, c['d_port'], sb['p0'] + c['K_port'] * sb['q'], T0)   # port: narrowing into the runner
    return {'dp0': sp['p0'] - s3['p0'], 'p0_port': sp['p0'], 'p_port': sp['p'], 'M3': s3['M'], 'M_run_merge': sr['M'] if c['L_straight'] <= 0 else None,
            'M_port': sp['M'], 'parts': {'col': sc['p0'] - s3['p0'], 'merge': sm['p0'] - sc['p0'], 'run': sr['p0'] - sm['p0'], 'bends': sb['p0'] - sr['p0'], 'port': sp['p0'] - sb['p0']}}


def run(c):
    gas = Gas(c['gamma'], c['R'])
    ov = overlap(c['gaps'], c['dur'], c.get('cycle', 720.0))
    k = ov['k']
    m_run = c['m_run']
    rm = gas.at_p0(m_run, c['d_run'], c['p3'], c['T0'])
    ro = gas.at_p0(m_run * k, c['d_run'], c['p3'], c['T0'])
    out = {'k': k, 'mean': ov['mean'], 'rms': ov['rms'], 'v_mean': rm['v'], 'M_mean': rm['M'], 'v_open': ro['v'], 'M_open': ro['M']}
    if 'd_col' in c:
        a = march(gas, c, m_run * c['n'], m_run)
        b = march(gas, c, m_run * k * ov['rms'], m_run * k)
        out.update({'dp0_mean': a['dp0'], 'p_port_mean': a['p_port'], 'dp0_open': b['dp0'], 'p_port_open': b['p_port'], 'p0_port_open': b['p0_port'],
                    'parts_open': b['parts'], 'parts_mean': a['parts']})
        if 'K_open' in c:   # the open-period coefficients (the bends' f at that flow) when they differ
            cc = dict(c, **c['K_open'])
            b2 = march(gas, cc, m_run * k * ov['rms'], m_run * k)
            out.update({'dp0_open': b2['dp0'], 'p_port_open': b2['p_port'], 'p0_port_open': b2['p0_port'], 'parts_open': b2['parts']})
    return out


def selfcheck():
    fails = []

    def ok(c, m):
        print(('PASS ' if c else 'FAIL ') + m)
        if not c:
            fails.append(m)
    # I4 into one collector, 180 deg apart, D = 260: on a window [0, 260) two are open on [0, 80) and [180, 260), one on
    # [80, 180): mean (160 + 100 + 160)/260 = 1.6153846, <n^2> = (320 + 100 + 320)/260 = 2.8461538, rms 1.6870549
    o = overlap([180, 180, 180, 180], 260)
    ok(abs(o['mean'] - 420 / 260) < 1e-12 and abs(o['rms'] - math.sqrt(740 / 260)) < 1e-12, 'I4, 260 deg: mean %.7f rms %.7f' % (o['mean'], o['rms']))
    # D under the spacing: never two open at once
    o = overlap([180] * 4, 170)
    ok(abs(o['mean'] - 1) < 1e-12 and abs(o['rms'] - 1) < 1e-12, 'I4, 170 deg: one at a time')
    # I6 into one, 120 apart, D = 250: window [0, 250): neighbours at +-120 overlap 130 each, +-240 overlap 10 each:
    # n = 3 on [0, 10), 2 on [10, 120), 3 on [120, 130), 2 on [130, 240), 3 on [240, 250)
    o = overlap([120] * 6, 250)
    s1 = 3 * 10 + 2 * 110 + 3 * 10 + 2 * 110 + 3 * 10
    s2 = 9 * 10 + 4 * 110 + 9 * 10 + 4 * 110 + 9 * 10
    ok(abs(o['mean'] - s1 / 250) < 1e-12 and abs(o['rms'] - math.sqrt(s2 / 250)) < 1e-12, 'I6, 250 deg: mean %.6f (hand %.6f) rms %.6f (hand %.6f)' % (o['mean'], s1 / 250, o['rms'], math.sqrt(s2 / 250)))
    # uneven: a cross-plane V8 bank 270/180/90/180 with D = 240: mean = 1 + sum of the overlaps / (n D)
    o = overlap([270, 180, 90, 180], 240)
    ok(o['mean'] > 1 and o['rms'] >= o['mean'], 'V8 bank, uneven: mean %.6f rms %.6f' % (o['mean'], o['rms']))
    # Fanno in p0 against the closed form for constant f: fL/D = (1 - M^2)/(g M^2) + (g + 1)/(2 g) ln(((g + 1) M^2)/(2 + (g - 1) M^2))
    g = Gas(1.3, 287.0)
    s = g.at_p0(0.2, 40.0, 3e5, 1200.0)
    fl = lambda M, G=1.3: (1 - M * M) / (G * M * M) + (G + 1) / (2 * G) * math.log((G + 1) * M * M / (2 + (G - 1) * M * M))
    u = fanno_up(g, s, 2000.0, f_fix=0.02)
    want = fl(s['M']) + 0.02 * 2000.0 / 40.0          # the upstream end sits further from choking: (fL*/D)_1 = (fL*/D)_2 + f L / D
    ok(abs(fl(u['M']) - want) < 1e-6 * want, 'Fanno in p0 against the closed form: fL*/D %.8f against %.8f (M %.5f -> %.5f)' % (fl(u['M']), want, u['M'], s['M']))
    return fails


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--self':
        f = selfcheck()
        print('FAILS', f)
        sys.exit(1 if f else 0)
    print(json.dumps(run(json.loads(sys.stdin.read()))))
