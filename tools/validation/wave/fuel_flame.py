#!/usr/bin/env python3
"""fuel_flame.py - adiabatic flame temperatures of the wave model's fuels, frozen and at equilibrium (part 11, K3).

    curl -sSLO https://raw.githubusercontent.com/Cantera/cantera/main/data/gri30.yaml
    python3 tools/validation/wave/fuel_flame.py gri30.yaml          # numpy, scipy, pyyaml; a few seconds

Constant pressure (1 atm), stoichiometric and lambda 0.822, reactants at 298.15 K: the fuel's enthalpy from its liquid
formation enthalpy (NASA CEA thermo.inp: ethanol -277510, methanol -238910 J/mol; the gasoline CH1.87 from its 44.0 MJ/kg
LHV) and, as a second case, from the vapour's (ethanol -234950, methanol -200940; the gasoline + 341.7 kJ/kg), and
(a) the wave model's frozen products (complete when lean; CO2, CO, H2O, H2 with the water-gas ratio 3.5 when rich) or
(b) chemical equilibrium over N2, O2, Ar, CO2, H2O, CO, H2, OH, H, O, NO, N (minimum Gibbs energy at T, p). Properties:
GRI-Mech 3.0's NASA-7 polynomials with a6 and a7. Independent of the page; results quoted in the validation document.
"""
import sys, math, warnings, yaml
warnings.filterwarnings('ignore')
import numpy as np
from scipy.optimize import minimize, brentq
SP = {}
for s in yaml.safe_load(open(sys.argv[1]))['species']:
    n = s['name']; SP['NO' if n is False else str(n)] = s
R = 8.314462618; P0 = 101325.0
NAMES = ['N2', 'O2', 'AR', 'CO2', 'H2O', 'CO', 'H2', 'OH', 'H', 'O', 'NO', 'N']
EL = {n: SP[n]['composition'] for n in NAMES}
def coef(n, T):
    t = SP[n]['thermo']; return t['data'][0] if T < t['temperature-ranges'][1] else t['data'][1]
def h_RT(n, T):
    a = coef(n, T); return a[0] + a[1] * T / 2 + a[2] * T ** 2 / 3 + a[3] * T ** 3 / 4 + a[4] * T ** 4 / 5 + a[5] / T
def s_R(n, T):
    a = coef(n, T); return a[0] * math.log(T) + a[1] * T + a[2] * T ** 2 / 2 + a[3] * T ** 3 / 3 + a[4] * T ** 4 / 4 + a[6]
def H(n, T): return sum(k * h_RT(s, T) * R * T for s, k in n.items())
AIRN2, AIRAR = 3.7279, 0.04459
hCO2, hH2O = h_RT('CO2', 298.15) * R * 298.15, h_RT('H2O', 298.15) * R * 298.15
MG = 12.0107 + 1.87 * 1.00794
FUELS = {   # per C atom: y, z, liquid formation enthalpy J/mol C, latent heat J/mol C
    'gasoline CH1.87': (1.87, 0.0, hCO2 + 0.935 * hH2O + 44.0e6 * MG / 1000, 341.72e3 * MG / 1000),
    'ethanol': (3.0, 0.5, -277510 / 2, 42560 / 2),
    'methanol': (4.0, 1.0, -238910.0, 37970.0)}
def frozen(y, z, lam, K=3.5):
    o = 1 + y / 4 - z / 2; n2 = lam * o * AIRN2; ar = lam * o * AIRAR
    if lam >= 1: return {'N2': n2, 'O2': (lam - 1) * o, 'AR': ar, 'CO2': 1, 'H2O': y / 2}
    S = 2 * lam * o + z - 1; qa = K - 1; qb = K * (y / 2 - S) + 1 + S; a = (-qb + math.sqrt(qb * qb + 4 * qa * S)) / (2 * qa)
    return {'N2': n2, 'AR': ar, 'CO2': a, 'H2O': S - a, 'CO': 1 - a, 'H2': y / 2 - S + a}
def elements(n):
    e = {}
    for s, k in n.items():
        for el, c in EL[s].items(): e[el] = e.get(el, 0) + c * k
    return e
def equil_v(el, T, V):
    # minimum Helmholtz energy at T, V (dissociation.py's form, log variables, SLSQP)
    A = np.array([[EL[s].get(e, 0) for s in NAMES] for e in ['C', 'H', 'O', 'N', 'Ar']]); b = np.array([el.get(e, 0) for e in ['C', 'H', 'O', 'N', 'Ar']])
    g0 = np.array([h_RT(s, T) - s_R(s, T) for s in NAMES]); c = math.log(R * T / (V * P0))
    f = lambda z: float(np.sum(np.exp(z) * (g0 + z + c - 1)))
    gr = lambda z: np.exp(z) * (g0 + z + c)
    z0 = np.log(np.maximum(1e-12, np.linalg.lstsq(A, b, rcond=None)[0].clip(1e-6)))
    r = minimize(f, z0, jac=gr, constraints=[{'type': 'eq', 'fun': lambda z: A @ np.exp(z) - b, 'jac': lambda z: A * np.exp(z)}], method='SLSQP', options={'maxiter': 500, 'ftol': 1e-14})
    return {s: float(k) for s, k in zip(NAMES, np.exp(r.x))}
def equil(el, T, p, n0):
    # at constant pressure: the volume of the mixture's own moles, V = N R T / p, by fixed point
    N = sum(n0.values())
    for _ in range(30):
        n = equil_v(el, T, N * R * T / p); N1 = sum(n.values())
        if abs(N1 / N - 1) < 1e-12: break
        N = N1
    return n
for name, (y, z, hl, lv) in FUELS.items():
    for lam in (1.0, 0.822):
        o = 1 + y / 4 - z / 2
        air = {'O2': lam * o, 'N2': lam * o * AIRN2, 'AR': lam * o * AIRAR}
        out = []
        for basis, hf in (('liquid', hl), ('vapour', hl + lv)):
            H0 = H(air, 298.15) + hf
            nf = frozen(y, z, lam); Tf = brentq(lambda T: H(nf, T) - H0, 800, 4000)
            el = elements(nf); Te = brentq(lambda T: H(equil(el, T, P0, nf), T) - H0, 1200, 3500)
            ne = equil(el, Te, P0, nf); er = max(abs(elements(ne)[k] - el[k]) / el[k] for k in el)
            assert er < 1e-5 and abs(H(ne, Te) - H0) < 5.0, (er, H(ne, Te) - H0)
            out.append(f"{basis}: frozen {Tf:.0f} K, equilibrium {Te:.0f} K")
        print(f"{name:16s} lambda {lam:.3f}: " + '; '.join(out))
