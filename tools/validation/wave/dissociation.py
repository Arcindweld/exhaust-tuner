#!/usr/bin/env python3
"""dissociation.py - the size of the wave model's frozen-products assumption, by an independent equilibrium calculation.

    curl -sSLO https://raw.githubusercontent.com/Cantera/cantera/main/data/gri30.yaml
    python3 tools/validation/wave/dissociation.py gri30.yaml          # numpy, scipy, pyyaml; a few seconds

For CH1.87 with air (the model's fuel, formation enthalpy from its 44.0 MJ/kg lower heating value) at AFR 14.6 and 12.8:
an adiabatic constant-volume burn from an unburned state at TDC (750 K / 25 bar and 800 K / 35 bar), (a) to the wave
model's frozen products (complete combustion when lean; CO2, CO, H2O, H2 with the water-gas ratio 3.5 when rich) and (b) to
chemical equilibrium over N2, O2, Ar, CO2, H2O, CO, H2, OH, H, O, NO, N (minimum Helmholtz energy at the burn's T and V,
the temperature from the same total internal energy); then an isentropic expansion to 8 times the volume, frozen against
shifting equilibrium, and the expansion work of each. Properties: GRI-Mech 3.0 NASA-7 polynomials with a6 (formation
enthalpy) and a7 (entropy). An upper estimate: the real burn is spread over 55 degrees and loses heat, so its peak is lower
and dissociates less. Not used by the model; results quoted in docs/WAVE_VALIDATION_2026-11-11.md (addendum part 2).
"""
import sys, math, warnings, yaml
warnings.filterwarnings('ignore')
import numpy as np
from scipy.optimize import minimize, brentq
d = yaml.safe_load(open(sys.argv[1]))
SP = {}
for s in d['species']:
    n = s['name']; n = 'NO' if n is False else str(n)
    SP[n] = s
R = 8.314462618
NAMES = ['N2','O2','AR','CO2','H2O','CO','H2','OH','H','O','NO','N']
EL = {n: SP[n]['composition'] for n in NAMES}
M = {'C':12.0107,'H':1.00794,'O':15.9994,'N':14.0067,'Ar':39.948}
def coef(n, T):
    t = SP[n]['thermo']; r = t['temperature-ranges']
    return t['data'][0] if T < r[1] else t['data'][1]
def h_RT(n, T):
    a = coef(n, T); return a[0]+a[1]*T/2+a[2]*T**2/3+a[3]*T**3/4+a[4]*T**4/5+a[5]/T
def s_R(n, T):
    a = coef(n, T); return a[0]*math.log(T)+a[1]*T+a[2]*T**2/2+a[3]*T**3/3+a[4]*T**4/4+a[6]
def mw(n): return sum(M[e]*k for e,k in EL[n].items())
y = 1.87; o = 1+y/4; AIRN2 = 3.7279; AIRAR = 0.04459
MF = 12.0107 + y*1.00794
LHV = 44.0e6
hCO2 = h_RT('CO2',298.15)*R*298.15; hH2O = h_RT('H2O',298.15)*R*298.15
HFUEL = hCO2 + y/2*hH2O + LHV*MF/1000      # J/mol of CH1.87, from its LHV
P0 = 101325.0
def frozen(lam, K=3.5):
    n2 = lam*o*AIRN2; ar = lam*o*AIRAR
    if lam >= 1: return {'N2':n2,'O2':(lam-1)*o,'AR':ar,'CO2':1,'H2O':y/2}
    S = 2*lam*o-1; qa = K-1; qb = K*(y/2-S)+1+S; a = (-qb+math.sqrt(qb*qb+4*qa*S))/(2*qa)
    return {'N2':n2,'AR':ar,'CO2':a,'H2O':S-a,'CO':1-a,'H2':y/2-S+a}
def U(n, T):   # J, absolute (formation-enthalpy datum), n in mol
    return sum(k*(h_RT(s,T)-1)*R*T for s,k in n.items())
def Sfun(n, T, V):  # J/K
    N = sum(n.values()); out = 0
    for s,k in n.items():
        if k <= 0: continue
        p_i = k*R*T/V
        out += k*(s_R(s,T)*R - R*math.log(p_i/P0))
    return out
def elements(n):
    e = {}
    for s,k in n.items():
        for el,c in EL[s].items(): e[el] = e.get(el,0)+c*k
    return e
def equil(el, T, V):
    # minimise Helmholtz free energy at T, V over the 12 species with element constraints (log variables)
    sp = NAMES
    A = np.array([[EL[s].get(e,0) for s in sp] for e in ['C','H','O','N','Ar']])
    b = np.array([el.get(e,0) for e in ['C','H','O','N','Ar']])
    g0 = np.array([h_RT(s,T)-s_R(s,T) for s in sp])   # g/RT at p0
    c = math.log(R*T/(V*P0))
    def f(z):
        n = np.exp(z); return float(np.sum(n*(g0+z+c-1)))
    def gr(z):
        n = np.exp(z); return n*(g0+z+c)
    best = None
    z0 = np.log(np.maximum(1e-12, np.linalg.lstsq(A, b, rcond=None)[0].clip(1e-6)))
    cons = {'type':'eq','fun':lambda z: A@np.exp(z)-b,'jac':lambda z: A*np.exp(z)}
    r = minimize(f, z0, jac=gr, constraints=[cons], method='SLSQP', options={'maxiter':500,'ftol':1e-14})
    n = np.exp(r.x)
    return {s:float(k) for s,k in zip(sp,n)}
def case(afr, Tu, pu, ratio):
    lam = afr/ (o*(AIRN2*28.0134+31.9988+AIRAR*39.948)/MF)
    reac = {'O2':lam*o,'N2':lam*o*AIRN2,'AR':lam*o*AIRAR}
    mass = (lam*o*(AIRN2*28.0134+31.9988+AIRAR*39.948)+MF)/1000   # kg per mol of fuel
    # unburned: air + fuel; fuel's sensible energy taken as that of the same mass of air at Tu (it cancels between
    # the two product models below: both start from the same total internal energy)
    Nr = lam*o*(1+AIRN2+AIRAR)+1
    V = Nr*R*Tu/pu
    U0 = U(reac,Tu) + (HFUEL + (U({'N2':1},Tu)-U({'N2':1},298.15)) ) - R*298.15*0   # J; fuel as vapour: formation from LHV plus a N2-like sensible part
    nf = frozen(lam)
    Tf = brentq(lambda T: U(nf,T)-U0, 1000, 4500)
    el = elements(nf)
    Teq = brentq(lambda T: U(equil(el,T,V),T)-U0, 1500, 4000)
    ne = equil(el,Teq,V)
    pf = sum(nf.values())*R*Tf/V; pe = sum(ne.values())*R*Teq/V
    # isentropic expansion to ratio*V
    V2 = ratio*V
    Sf = Sfun(nf,Tf,V); Tf2 = brentq(lambda T: Sfun(nf,T,V2)-Sf, 300, Tf)
    Se = Sfun(ne,Teq,V); Te2 = brentq(lambda T: Sfun(equil(el,T,V2),T,V2)-Se, 300, Teq)
    ne2 = equil(el,Te2,V2)
    Wf = U0 - U(nf,Tf2); We = U0 - U(ne2,Te2)
    eres = max(abs(elements(ne)[k]-el[k])/max(1e-12,el[k]) for k in el)
    assert eres < 1e-6, 'element balance of the equilibrium %.1e' % eres
    assert abs(U(ne,Teq)-U0) < 1.0, (U(ne,Teq), U0)   # J per mol of fuel (of about 6e5 released)
    print(f"AFR {afr}: lambda {lam:.3f}, unburned {Tu} K, {pu/1e5:.0f} bar; frozen: T {Tf:.0f} K p {pf/1e5:.1f} bar; equilibrium: T {Teq:.0f} K p {pe/1e5:.1f} bar"
          f" (dT {Teq-Tf:+.0f} K); expansion x{ratio}: work frozen {Wf/mass/1e6:.4f} MJ/kg, equilibrium {We/mass/1e6:.4f} MJ/kg ({100*(Wf/We-1):+.2f} %);"
          f" T after: {Tf2:.0f} / {Te2:.0f} K; CO {ne['CO']:.4f} OH {ne['OH']:.4f} NO {ne['NO']:.4f} H2 {ne['H2']:.4f} O2 {ne['O2']:.4f} at peak (frozen CO {nf.get('CO',0):.4f})")
for afr in (14.6, 12.8):
    case(afr, 750.0, 25e5, 8.0)
    case(afr, 800.0, 35e5, 8.0)
