#!/usr/bin/env python3
"""fuel_fit.py - the oxygenated fuels' data for the wave model (docs/WAVE_VALIDATION_2026-11-11.md part 11), from NASA's tables.

    curl -sSLo thermo.inp https://raw.githubusercontent.com/nasa/cea/main/data/thermo.inp
    curl -sSLO https://raw.githubusercontent.com/Cantera/cantera/main/data/gri30.yaml
    python3 tools/validation/wave/fuel_fit.py thermo.inp gri30.yaml         # numpy, pyyaml; under a second

From NASA CEA's thermo.inp (McBride, Zehe and Gordon 2002, NASA TP-2002-211556), for C2H5OH, CH3OH, C8H18,isooctane and C7H8:
the gas and the liquid entries' enthalpies of formation at 298.15 K (the header line's last number, J/mol), so the latent
heat of vaporisation at 298.15 K = H(gas) - H(liquid); and the gas's NASA 9-coefficient cp/R, refitted (least squares on the
relative error of cp/R, 1 K steps) to the model's 7-term form (cp/R = a1 + a2 T + ... + a5 T^4) over 300-1000 K and 1000-3500 K, as the gasoline
vapour of part 2 was. Methanol's polynomial is GRI-Mech 3.0's own NASA-7 (Cantera gri30.yaml), compared here with NASA's fit.
Prints the coefficients the page and et_wave carry (SPEC[8], SPEC[9]) and the largest deviations.
"""
import sys, yaml
import numpy as np

def cea(path):
    L = open(path).read().split('\n'); out = {}
    for i, l in enumerate(L):
        name = l[:18].strip()
        if name in ('C2H5OH', 'CH3OH', 'C8H18,isooctane', 'C7H8', 'C2H5OH(L)', 'CH3OH(L)', 'C8H18(L),isooct', 'C7H8(L)') and l[:1] not in ' !':
            h2 = L[i + 1]; nint = int(h2[:2]); M = float(h2[52:65]); hf = float(h2[65:80]); ranges = []
            j = i + 2
            for _ in range(nint):
                t0, t1 = float(L[j][:11]), float(L[j][11:22])
                c = (L[j + 1] + L[j + 2]).replace('D', 'E')
                a = [float(c[k * 16:(k + 1) * 16]) for k in range(5)] + [float(c[80 + k * 16:80 + (k + 1) * 16]) for k in range(2)]
                ranges.append((t0, t1, a)); j += 3
            out[name] = {'M': M, 'hf': hf, 'r': ranges}
    return out

def cp9(sp, T):
    for t0, t1, a in sp['r']:
        if T <= t1 + 1e-9:
            return a[0] / T / T + a[1] / T + a[2] + a[3] * T + a[4] * T * T + a[5] * T ** 3 + a[6] * T ** 4
    t0, t1, a = sp['r'][-1]
    return a[0] / T / T + a[1] / T + a[2] + a[3] * T + a[4] * T * T + a[5] * T ** 3 + a[6] * T ** 4

def fit(f, lo, hi):
    # least squares on the relative error of cp/R (each row divided by the value)
    T = np.arange(lo, hi + 0.5, 1.0); y = np.array([f(t) for t in T]); X = np.vstack([T ** k for k in range(5)]).T
    c = np.linalg.lstsq(X / y[:, None], np.ones_like(y), rcond=None)[0]; dev = np.max(np.abs(X @ c / y - 1))
    return c, dev

def cp7(c, T): return sum(c[k] * T ** k for k in range(5))

D = cea(sys.argv[1]); G = {s['name']: s for s in yaml.safe_load(open(sys.argv[2]))['species']}
print('NASA CEA thermo.inp, H(298.15 K) of formation, J/mol (gas / liquid) and the latent heat at 298.15 K:')
for g, l in (('C2H5OH', 'C2H5OH(L)'), ('CH3OH', 'CH3OH(L)'), ('C8H18,isooctane', 'C8H18(L),isooct'), ('C7H8', 'C7H8(L)')):
    a, b = D[g], D[l]; dv = a['hf'] - b['hf']
    print(f"  {g:16s} M {a['M']:.5f}  gas {a['hf']:.0f}  liquid {b['hf']:.0f}  dvapH {dv:.0f} J/mol = {dv / a['M']:.2f} kJ/kg")
xi = (1.87 * 7 - 8) / (10 - 1.87)
dvg = xi * (D['C8H18,isooctane']['hf'] - D['C8H18(L),isooct']['hf']) + (1 - xi) * (D['C7H8']['hf'] - D['C7H8(L)']['hf'])
Mg = xi * D['C8H18,isooctane']['M'] + (1 - xi) * D['C7H8']['M']
print(f"  gasoline vapour (the model's CH1.87: isooctane {xi:.6f} + toluene by mole, M {Mg:.4f}): dvapH {dvg:.2f} J/mol = {dvg / Mg:.2f} kJ/kg")
E = D['C2H5OH']
lo, dlo = fit(lambda t: cp9(E, t), 300, 1000); hi, dhi = fit(lambda t: cp9(E, t), 1000, 3500)
print('ethanol C2H5OH, refit of NASA-9 (300-1000 K / 1000-3500 K): largest cp deviation %.3f %% / %.3f %%' % (100 * dlo, 100 * dhi))
print('  lo [' + ','.join('%.10e' % v for v in lo) + ']')
print('  hi [' + ','.join('%.10e' % v for v in hi) + ']')
print('  cp/R at 300, 500, 1000, 1500, 2500 K: NASA ' + ', '.join('%.4f' % cp9(E, t) for t in (300, 500, 1000, 1500, 2500)) +
      '; refit ' + ', '.join('%.4f' % cp7(lo if t <= 1000 else hi, t) for t in (300, 500, 1000, 1500, 2500)))
M = G['CH3OH']['thermo']['data']; W = D['CH3OH']
w = 0
for t in range(300, 3501, 10):
    c = M[0] if t < 1000 else M[1]; w = max(w, abs(cp7(c, t) / cp9(W, t) - 1))
print('methanol CH3OH: GRI-Mech 3.0 NASA-7 against NASA CEA NASA-9, 300-3500 K: largest cp deviation %.3f %%' % (100 * w))
print('  lo [' + ','.join(repr(v) for v in M[0][:5]) + ']'); print('  hi [' + ','.join(repr(v) for v in M[1][:5]) + ']')
