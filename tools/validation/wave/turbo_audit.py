#!/usr/bin/env python3
"""Independent references for the turbine boundary (docs/WAVE_VALIDATION_2026-11-11.md, addendum part 6, F1, F2, F9).

Reads results/turbo_audit_sim.json (what the page's model gives, from turbo_audit.js) and computes every reference from
the equations with its own implementation; writes results/turbo_audit.json and prints the tables of part 6.

Sources of the equations (fetched 2026-11-13):
  * NASA Glenn Research Center, Beginner's Guide to Aeronautics, "Mass flow choking" (grc.nasa.gov/www/k-12/airplane/mflchk.html)
    and "Isentropic flow" (isentrop.html): mdot = A pt / sqrt(Tt) sqrt(g/R) M (1 + (g-1)/2 M^2)^(-(g+1)/(2(g-1))); choked at M = 1;
    p/pt = (1 + (g-1)/2 M^2)^(-g/(g-1)).
  * the thermally perfect gas (cp a function of T): ds = cp(T) dT / T - R dp / p (any thermodynamics text; here integrated
    numerically with scipy.integrate.quad, not with the page's closed form);
  * the turbine's isentropic total-to-static work: dh_is = h(T0) - h(T_is), T_is on the isentrope through the inlet's total
    state at the outlet's static pressure (e.g. Dixon and Hall, Fluid Mechanics and Thermodynamics of Turbomachinery, ch. 2;
    the definition the page's turbineBalance and OpenWAM's TTurbinaSimple use);
  * the characteristic at an end (Benson, The Thermodynamics and Gas Dynamics of Internal-Combustion Engines, vol. 1): the
    arriving Riemann invariant J = u + 2c/(g-1) with the cell's entropy, frozen gamma; here solved with brentq;
  * acoustics of a compact quasi-steady nozzle: linearised mass and energy balances across the element, upstream plane waves
    p' = a+ + a-, u' = (a+ - a-)/(rho c), downstream a transmitted wave plus an entropy wave (Marble and Candel, J. Sound
    Vib. 55 (1977) 225-243, give the choked limit R = (1 - (g-1)M/2) / (1 + (g-1)M/2), which the linear model below
    reproduces as a check of itself).
"""
import json, math, os, sys
import numpy as np
from scipy.integrate import quad
from scipy.optimize import brentq, minimize_scalar

HERE = os.path.dirname(os.path.abspath(__file__))
S = json.load(open(os.path.join(HERE, 'results', 'turbo_audit_sim.json')))
GAS = S['gas']
GAM, RG = 1.35, 287.0
CPC = GAM * RG / (GAM - 1)


# ---------- the engine's gas (the page's cp polynomials are an INPUT here; everything built on them is this script's own)
def cp_of(T, x=0.0):
    Tc = min(max(T, 200.0), 3500.0)
    b, d = (GAS['bhi'], GAS['dhi']) if Tc > 1000 else (GAS['blo'], GAS['dlo'])
    c = [b[k] + x * d[k] for k in range(5)]
    return c[0] + Tc * (c[1] + Tc * (c[2] + Tc * (c[3] + Tc * c[4])))


def R_of(x=0.0):
    return GAS['Rb'] + x * GAS['Rd']


def dh(T1, T2, x=0.0):            # h(T2) - h(T1) by quadrature of cp
    return quad(lambda T: cp_of(T, x), T1, T2, limit=200, epsabs=1e-9, epsrel=1e-13)[0]


def ds_T(T1, T2, x=0.0):          # integral of cp/T dT
    return quad(lambda T: cp_of(T, x) / T, T1, T2, limit=200, epsabs=1e-12, epsrel=1e-13)[0]


def T_isentrope(T1, p1, p2, x=0.0):   # the temperature at p2 on the isentrope through (T1, p1)
    target = R_of(x) * math.log(p2 / p1)
    return brentq(lambda T: ds_T(T1, T, x) - target, 150.0, 4000.0, xtol=1e-12, rtol=1e-15)


def T_from_dh(T1, q, x=0.0):      # T with h(T) - h(T1) = q
    return brentq(lambda T: dh(T1, T, x) - q, 150.0, 4500.0, xtol=1e-12, rtol=1e-15)


# ---------- nozzle laws
def psi(pr, g):
    prc = (2 / (g + 1)) ** (g / (g - 1))
    if pr <= prc:
        return math.sqrt(g) * (2 / (g + 1)) ** ((g + 1) / (2 * (g - 1)))
    return math.sqrt(2 * g / (g - 1) * (pr ** (2 / g) - pr ** ((g + 1) / g)))


def nasa_flow(A, p0, T0, pd, g, R):
    """NASA Glenn: the throat Mach number from p/pt (unchoked) or 1 (choked), then mdot = A pt/sqrt(Tt) sqrt(g/R) M (...)"""
    if p0 <= pd or A <= 0:
        return 0.0
    prc = (2 / (g + 1)) ** (g / (g - 1))
    M = 1.0 if pd / p0 <= prc else math.sqrt(2 / (g - 1) * ((p0 / pd) ** ((g - 1) / g) - 1))
    return A * p0 / math.sqrt(T0) * math.sqrt(g / R) * M * (1 + 0.5 * (g - 1) * M * M) ** (-(g + 1) / (2 * (g - 1)))


def exact_flow(A, Ts, ps, h0rel, pd, x=0.0):
    """the variable-cp isentropic nozzle: from a static state (Ts, ps) with stagnation enthalpy h(Ts) + h0rel, the flux
    rho u at the throat pressure max(pd, the pressure of maximum flux) along the exact isentrope"""
    R = R_of(x)
    def flux(p):
        T = T_isentrope(Ts, ps, p, x)
        q = h0rel - dh(Ts, T, x)
        return p / (R * T) * math.sqrt(max(0.0, 2 * q))
    # the total pressure on the exact isentrope
    T0 = T_from_dh(Ts, h0rel, x)
    p0 = ps * math.exp(ds_T(Ts, T0, x) / R)
    if pd >= p0:
        return 0.0, p0, T0, False
    r = minimize_scalar(lambda p: -flux(p), bounds=(0.3 * p0, 0.999999 * p0), method='bounded', options={'xatol': 1e-6 * p0})
    pstar = r.x
    if pd <= pstar:
        return A * flux(pstar), p0, T0, True
    return A * flux(pd), p0, T0, False


# ---------- A. the face solve, re-derived
def face_solve(s):
    c_ = s['cell']; r, u, p, gm, R, cp = c_['r'], s['u'], s['p'], c_['gamma'], c_['R'], c_['cp']
    af = math.pi * s['d'] ** 2 / 4
    K2, ex = 2 / (gm - 1), (gm - 1) / (2 * gm)
    c = math.sqrt(gm * p / r); J = u + K2 * c

    def st(pb):
        sr = pb / p; cb = c * sr ** ex; ub = J - K2 * cb; rb = r * sr ** (1 / gm); Tb = pb / (rb * R)
        T0 = Tb + 0.5 * ub * ub / cp; p0 = pb * (T0 / Tb) ** (gm / (gm - 1))
        return dict(cb=cb, ub=ub, rb=rb, Tb=Tb, T0=T0, p0=p0)

    pS = p * (J / (K2 * c)) ** (1 / ex)       # stalled: ub = 0
    pC = p * (J / ((1 + K2) * c)) ** (1 / ex) # sonic: ub = cb
    At, Ag, pT, pG = s['At'], s['Ag'], s['pT'], s['pG']
    if pS > pT or (Ag > 0 and pS > pG):
        noz = lambda q: nasa_flow(At, q['p0'], q['T0'], pT, gm, R) + nasa_flow(Ag, q['p0'], q['T0'], pG, gm, R)
        F = lambda pb: af * st(pb)['rb'] * st(pb)['ub'] - noz(st(pb))
        if F(pC) <= 0:
            pb, choked = pC, True
        else:
            pb, choked = brentq(F, pC, pS, xtol=1e-10, rtol=1e-15), False
        q = st(pb); m = af * q['rb'] * q['ub']
        nt = nasa_flow(At, q['p0'], q['T0'], pT, gm, R); ng = nasa_flow(Ag, q['p0'], q['T0'], pG, gm, R)
        mt = m * nt / (nt + ng); mg = m - mt
        # work: exact variable-cp isentrope from the face's static state (the same isentrope as its total state) to pT
        Tis = T_isentrope(q['Tb'], pb, pT, 0.0)
        dhis = dh(Tis, q['Tb'], 0.0) + 0.5 * q['ub'] ** 2
        W = s['eta'] * mt * dhis
        # the exact variable-cp nozzle from the same face state (what frozen gamma approximates)
        mxt, p0x, T0x, chx = exact_flow(At, q['Tb'], pb, 0.5 * q['ub'] ** 2, pT)
        mxg = exact_flow(Ag, q['Tb'], pb, 0.5 * q['ub'] ** 2, pG)[0] if Ag > 0 else 0.0
        # the frozen-gamma nozzle law as NASA writes it at the face's total state
        return dict(pb=pb, m=m, mt=mt, mg=mg, p0=q['p0'], W=W, dhis=dhis, endChoked=choked, nozzleCap=nt + ng, exactNozzle=mxt + mxg, p0exact=p0x,
                    noz_choked=pT / q['p0'] <= (2 / (gm + 1)) ** (gm / (gm - 1)), rev=0)
    # flow back: the downpipe cell's total state through At (+ Ag into the downpipe) into the face
    D = s['Dcell']; rd, ud, pd, gd, Rd, cpd = D['r'], D['u'], D['p'], D['gamma'], D['R'], D['cp']
    Td = pd / (Rd * rd); Tdo = Td + 0.5 * ud * ud / cpd; pdo = pd * (Tdo / Td) ** (gd / (gd - 1))
    Ar = At + (Ag if s['gDown'] else 0)
    F = lambda pb: af * st(pb)['rb'] * st(pb)['ub'] + nasa_flow(Ar, pdo, Tdo, pb, gd, Rd)
    lo = pS if pS > 0 else 1e-3 * pT
    pb = brentq(F, lo, pdo, xtol=1e-10, rtol=1e-15)
    q = st(pb); m = af * q['rb'] * q['ub']
    return dict(pb=pb, m=m, mt=m, mg=0.0, p0=q['p0'], W=0.0, dhis=0.0, rev=1)


def rel(a, b):
    return (a / b - 1) if b else (a - b)


resA = []
for s in S['A']:
    ref = face_solve(s); sim = s['sim']
    row = dict(tag=s['tag'], sim=sim, ref=ref,
               d_m=rel(sim['m'], ref['m']), d_pb=rel(sim['pb'], ref['pb']), d_mt=rel(sim['mt'], ref['mt']) if ref['mt'] else sim['mt'] - ref['mt'],
               d_W=rel(sim['W'], ref['W']) if ref['W'] else sim['W'], d_dhis=rel(sim['dhis'], ref['dhis']) if ref['dhis'] else sim['dhis'])
    if 'exactNozzle' in ref:
        row['frozen_vs_exact_nozzle'] = rel(ref['nozzleCap'], ref['exactNozzle'])
    resA.append(row)

# ---------- B. steady closed form
def closed_const(p0, T0, At, pT, Aface, g=GAM, R=RG):
    mN = nasa_flow(At, p0, T0, pT, g, R)
    mmax = nasa_flow(Aface, p0, T0, 0.0 + 1e-9, g, R)   # the pipe's sonic flux
    if mN >= mmax:
        return dict(m=mmax, pb=p0 * (2 / (g + 1)) ** (g / (g - 1)), W=None, pipeChoked=True)
    f = lambda M: Aface * p0 / math.sqrt(T0) * math.sqrt(g / R) * M * (1 + 0.5 * (g - 1) * M * M) ** (-(g + 1) / (2 * (g - 1))) - mN
    M = brentq(f, 1e-9, 1.0, xtol=1e-14)
    return dict(m=mN, pb=p0 * (1 + 0.5 * (g - 1) * M * M) ** (-g / (g - 1)), pipeChoked=False, M=M)


def closed_engine(p0, T0, At, pT, Aface):
    # exact variable-cp: a static state on the isentrope through (T0, p0) has h0 - h(T) = u^2 / 2
    R = R_of(0.0)
    def stat(p):
        T = T_isentrope(T0, p0, p); u = math.sqrt(max(0.0, 2 * dh(T, T0))); return T, u, p / (R * T) * u
    # nozzle from the reservoir's total state
    mstarN = -minimize_scalar(lambda p: -stat(p)[2], bounds=(0.3 * p0, 0.9999 * p0), method='bounded', options={'xatol': 1e-7 * p0}).fun
    pstar = minimize_scalar(lambda p: -stat(p)[2], bounds=(0.3 * p0, 0.9999 * p0), method='bounded', options={'xatol': 1e-7 * p0}).x
    mN = At * (mstarN if pT <= pstar else stat(pT)[2])
    if mN >= Aface * mstarN:
        return dict(m=Aface * mstarN, pb=pstar, pipeChoked=True)
    pb = brentq(lambda p: Aface * stat(p)[2] - mN, pstar, 0.999999999 * p0, xtol=1e-9)
    return dict(m=mN, pb=pb, pipeChoked=False)


def work_ref(p0, T0, pT, gas):
    if gas == 'const':
        return CPC * T0 * (1 - (pT / p0) ** ((GAM - 1) / GAM))
    return dh(T_isentrope(T0, p0, pT), T0)


resB = []
for b in S['B']:
    ref = closed_const(b['p0'], b['T0'], b['At'], b['pT'], b['Aface']) if b['gas'] == 'const' else closed_engine(b['p0'], b['T0'], b['At'], b['pT'], b['Aface'])
    if b['gas'] == 'engine':   # also the frozen-gamma NASA law at the reservoir's gamma, for scale
        g0 = cp_of(b['T0']) / (cp_of(b['T0']) - R_of()); ref['m_frozen_T0'] = closed_const(b['p0'], b['T0'], b['At'], b['pT'], b['Aface'], g0, R_of())['m']
    # the work per kg of the turbine's flow: total (reservoir) to the outlet's static pressure
    wref = b['eta'] * work_ref(b['p0'], b['T0'], b['pT'], b['gas'])
    resB.append(dict(tag=b['tag'], sim=b['sim'], ref=ref, d_m=rel(b['sim']['m'], ref['m']), d_pb=rel(b['sim']['pb'], ref['pb']),
                     d_w=rel(b['sim']['W'] / b['sim']['m'], wref), mSpread=b['sim']['mSpread']))
E = S['Benergy']
energy = dict(Ein=E['Ein'], Eout=E['Eout'], W=E['W'], residual=(E['Ein'] - E['Eout'] - E['W']) / E['Ein'], mass=(E['mIn'] - E['mOut']) / E['mIn'],
              hres_check=rel(E['Ein'] / E['mIn'], E['hRes']))

# ---------- C. convergence
resC = {}
for gas in ['const', 'engine']:
    rows = [c for c in S['C'] if c['gas'] == gas]
    grid = [c for c in rows if c['cfl'] == 0.8]
    tstep = [c for c in rows if c['dx'] == 0.01]
    out = dict(grid=[], dt=[], orders={}, dtorders={})
    for q in ['m', 'W', 'pb1', 'p0max']:
        v = [c[q] for c in grid]
        e = [abs(v[k] - v[k + 1]) for k in range(len(v) - 1)]
        out['orders'][q] = [math.log2(e[k] / e[k + 1]) if e[k + 1] > 0 else float('nan') for k in range(len(e) - 1)]
        out['grid'].append(dict(q=q, values=v, diffs_rel=[ek / abs(v[-1]) for ek in e]))
        w = [c[q] for c in sorted(tstep, key=lambda c: -c['cfl'])]
        ed = [abs(w[k] - w[k + 1]) for k in range(len(w) - 1)]
        out['dtorders'][q] = math.log2(ed[0] / ed[1]) if ed[1] > 0 else float('nan')
        out['dt'].append(dict(q=q, values=w, diffs_rel=[x / abs(w[-1]) for x in ed]))
    resC[gas] = out

# ---------- D. acoustics: the simulated pulse against the linearised compact element
def linear_RT(face, Aface, At, pT, eta, down, AD, g=GAM, R=RG):
    """reflection R = a-/a+ and transmission T = (downstream wave)/a+ of the quasi-steady equivalent nozzle with work removed,
    linearised numerically (unit incident wave of 1e-3 Pa, Newton on the three balances)"""
    cp = g * R / (g - 1)
    p1, r1, u1 = face['p'], face['r'], face['u']; c1 = math.sqrt(g * p1 / r1)
    p2, r2, u2 = down['p0'], down['r0'], down['u0']; c2 = math.sqrt(g * p2 / r2)
    def nozzle(p, rho, u, pd):
        T = p / (rho * R); T0 = T + 0.5 * u * u / cp; p0 = p * (T0 / T) ** (g / (g - 1))
        m = At * math.sqrt(p0 * p0 / (R * T0)) * psi(pd / p0, g)
        w = eta * cp * T0 * (1 - (pd / p0) ** ((g - 1) / g))
        return m, cp * T0, w
    def F(z, a):
        b, tau, sig = z
        P1 = p1 + a + b; U1 = u1 + (a - b) / (r1 * c1); RH1 = r1 + (a + b) / c1 ** 2
        P2 = p2 + tau; U2 = u2 + tau / (r2 * c2); RH2 = r2 + tau / c2 ** 2 + sig
        m, h0, w = nozzle(P1, RH1, U1, P2)
        m1 = Aface * RH1 * U1; m2 = AD * RH2 * U2
        e2 = m2 * (cp * P2 / (RH2 * R) + 0.5 * U2 * U2)
        return np.array([m1 - m, m2 - m, (m * (h0 - w) - e2) / cp])
    base = F(np.zeros(3), 0.0)
    a = 1e-3; z = np.zeros(3)
    for _ in range(8):
        f = F(z, a) - base
        Jm = np.zeros((3, 3))
        for k in range(3):
            dz = np.zeros(3); dz[k] = 1e-6
            Jm[:, k] = (F(z + dz, a) - base - f) / 1e-6
        z = z - np.linalg.solve(Jm, f)
    return z[0] / a, z[1] / a, dict(M1=u1 / c1, M2=u2 / c2, base_residual=list(base))


def pulse_amp(t, p, t_c, half):
    t = np.asarray(t); p = np.asarray(p)
    sel = (t > t_c - half) & (t < t_c + half)
    d = p[sel]                     # the record is already the pulse's own signal (difference of two runs)
    k = np.argmax(np.abs(d))
    return float(d[k]), float(t[sel][k])


resD = []
wall = [d for d in S['D'] if d['tag'] == 'closed end'][0]
for d in S['D']:
    mA = d['meanA']; c = math.sqrt(GAM * mA['p'] / mA['r']); u = mA['u']
    tin = d['t1'] + 3.0 / (c + u); tref = d['t1'] + 6.0 / (c + u) + 3.0 / (c - u)
    half = 4 * d['tau']
    inc, ti = pulse_amp(d['t'], d['pA'], tin, half)
    ref_, tr = pulse_amp(d['t'], d['pA'], tref, half)
    row = dict(tag=d['tag'], incident=inc, reflected=ref_, R_sim=ref_ / inc, t_inc=ti, t_ref=tr, M_pipe=u / c)
    if d['pD'] is not None:
        mD = d['meanD']; cD = math.sqrt(GAM * mD['p'] / mD['r'])
        ttr = d['t1'] + 6.0 / (c + u) + 2.0 / (cD + mD['u'])
        tra, tt = pulse_amp(d['t'], d['pD'], ttr, half)
        row['T_sim'] = tra / inc
        pT = d['meanD']['p0']
        Rl, Tl, info = linear_RT(d['faceA'], d['Aface'], d['At'], pT, d['eta'], d['meanD'], d['AD'])
        row.update(R_lin=Rl, T_lin=Tl, lin=info)
    elif d.get('pT'):
        # the outlet pressure held: only the mass balance at the face, one unknown (the reflected wave)
        fa = d['faceA']; p1, r1, u1 = fa['p'], fa['r'], fa['u']; c1 = math.sqrt(GAM * p1 / r1); cpg = GAM * RG / (GAM - 1)
        def mres(b, a):
            P1 = p1 + a + b; U1 = u1 + (a - b) / (r1 * c1); RH1 = r1 + (a + b) / c1 ** 2
            T = P1 / (RH1 * RG); T0 = T + 0.5 * U1 * U1 / cpg; p0 = P1 * (T0 / T) ** (GAM / (GAM - 1))
            return d['Aface'] * RH1 * U1 - d['At'] * p0 / math.sqrt(RG * T0) * psi(d['pT'] / p0, GAM)
        a = 1e-3; b0 = mres(0, 0); db = 1e-6
        k = (mres(db, a) - mres(0, a)) / db; row['R_lin'] = -(mres(0, a) - b0) / k / a
        if 'choked' == d['tag']:
            M = info['M1']; row['R_marble_candel'] = (1 - 0.5 * (GAM - 1) * M) / (1 + 0.5 * (GAM - 1) * M)
    resD.append(row)
Rwall = [r for r in resD if r['tag'] == 'closed end'][0]['R_sim']
for r in resD:
    r['R_sim_corr'] = r['R_sim'] / Rwall   # the scheme's own loss over the 6 m return, from the closed end (ideally 1)

out = dict(A=resA, B=resB, energy=energy, C=resC, D=resD)
json.dump(out, open(os.path.join(HERE, 'results', 'turbo_audit.json'), 'w'), indent=1, default=float)

# ---------- print
f = lambda v, n=4: ('%.' + str(n) + 'f') % v
print('A. face solve (model vs this re-derivation)')
print('| state | m model kg/s | m ref | dm | pb model kPa | dpb | split dm_t | W model W | dW | frozen-gamma vs exact-cp nozzle |')
print('|---|---|---|---|---|---|---|---|---|---|')
for r in resA:
    print('| %s | %.6f | %.6f | %.2e | %.3f | %.2e | %.2e | %.2f | %.2e | %s |' % (r['tag'], r['sim']['m'], r['ref']['m'], r['d_m'], r['sim']['pb'] / 1e3, r['d_pb'], r['d_mt'], r['sim']['W'], r['d_W'],
          ('%+.3f %%' % (100 * r['frozen_vs_exact_nozzle'])) if 'frozen_vs_exact_nozzle' in r else '-'))
print('\nB. steady rig vs closed form')
print('| case | m model | m closed form | dm | pb model kPa | pb closed form | dpb | work/kg vs eta dh_is | m spread over the last 5 ms |')
print('|---|---|---|---|---|---|---|---|---|')
for r in resB:
    print('| %s | %.6f | %.6f | %+.3f %% | %.3f | %.3f | %+.3f %% | %+.3f %% | %.1e |' % (r['tag'], r['sim']['m'], r['ref']['m'], 100 * r['d_m'], r['sim']['pb'] / 1e3, r['ref']['pb'] / 1e3, 100 * r['d_pb'], 100 * r['d_w'], r['mSpread']))
    if 'm_frozen_T0' in r['ref']:
        print('|  (frozen gamma at T0: m %.6f, model vs it %+.3f %%) |' % (r['ref']['m_frozen_T0'], 100 * rel(r['sim']['m'], r['ref']['m_frozen_T0'])))
print('\nsteady energy balance through a real downpipe (engine gas, internal gate): (Ein - Eout - W)/Ein = %.2e, mass %.2e, inflow h vs h(T0) %.2e' % (energy['residual'], energy['mass'], energy['hres_check']))
print('\nC. pulsating rig: grid (dx 40/20/10/5/2.5 mm, CFL 0.8) and time step (dx 10 mm, CFL 0.8/0.4/0.2)')
for gas, o in resC.items():
    for g_, d_ in zip(o['grid'], o['dt']):
        print('%s %-6s values %s | rel. diffs %s | orders %s | dt: values %s diffs %s order %s' % (gas, g_['q'], ['%.6g' % v for v in g_['values']], ['%.1e' % v for v in g_['diffs_rel']],
              ['%.2f' % v for v in o['orders'][g_['q']]], ['%.6g' % v for v in d_['values']], ['%.1e' % v for v in d_['diffs_rel']], '%.2f' % o['dtorders'][g_['q']]))
print('\nD. small pulse through the element')
for r in resD:
    print('%-18s M %.3f incident %.3f Pa reflected %.3f  R_sim %.4f (corr. %.4f)  T_sim %s  R_lin %s T_lin %s %s' % (r['tag'], r['M_pipe'], r['incident'], r['reflected'], r['R_sim'], r['R_sim_corr'],
          '%.4f' % r['T_sim'] if 'T_sim' in r else '-', '%.4f' % r['R_lin'] if 'R_lin' in r else '-', '%.4f' % r['T_lin'] if 'T_lin' in r else '-',
          ('Marble-Candel %.4f' % r['R_marble_candel']) if 'R_marble_candel' in r else ''))
