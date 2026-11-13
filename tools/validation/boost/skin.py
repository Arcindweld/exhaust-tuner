#!/usr/bin/env python3
"""Independent check of the runner steel temperature the turbo manifold takes from the Headers tab's skin model
(calcSkin), boost audit part 3, 2026-11-13. Written from the relations the page's comment names, not ported:

 gas to wall: Gnielinski, Nu = (f/8)(Re - 1000) Pr / (1 + 12.7 sqrt(f/8)(Pr^(2/3) - 1)), Petukhov's f = (0.79 ln Re - 1.64)^-2
   (Incropera 8.62 / 8.21), at least the laminar 3.66, times the pulsating-flow factor CAF (1 steady, 2.3 Wendland's
   manifold figure), on the time-averaged mass flow;
 through the wall: ln(r_o / r_i) / (2 pi k), k = 20 W/m K (stainless);
 off the outside: Churchill-Chu natural convection on a horizontal cylinder, Churchill-Bernstein in cross flow when the
   air moves, combined as the cube root of the sum of cubes; grey radiation eps sigma (Ts^4 - Ta^4);
 the gas: m cp dTg/dx = -q', cp the burned gas's (the caller gives it as a constant here);
 properties: the page's documented air fits for the film (Sutherland mu; k = 0.0241 (T/273.15)^0.81; cp = 1005 +
   0.195 (T - 300)), so that the check is of the model's arithmetic, not of the property choice.
The steel temperature is the wall's mid-thickness, Tg - q' (R_in + R_wall / 2). The outer surface balance is solved by
Brent's method (here: bisection to 1e-10 K), the gas by Heun's method on 4000 steps (the page: Euler on 10 mm steps), so
the two differ by the step error, a few hundredths of a degree.

Usage: echo '{"mdot":..,"Tg":..,"di":..,"wall":..,"L":..,"caf":..,"Ta":..,"v":..,"eps":..,"cp":..}' | python3 skin.py
"""
import json
import math
import sys

SIG = 5.670374e-8
P_ATM, R_AIR = 101325.0, 287.05


def mu(T): return 1.716e-5 * (T / 273.15) ** 1.5 * (273.15 + 110.4) / (T + 110.4)
def kk(T): return 0.0241 * (T / 273.15) ** 0.81
def cpa(T): return 1005 + 0.195 * (T - 300)


def h_out(Ts, Ta, D, v):
    Tf = (Ts + Ta) / 2
    m, k, cp = mu(Tf), kk(Tf), cpa(Tf)
    rho = P_ATM / (R_AIR * Tf)
    nu = m / rho
    Pr = m * cp / k
    Ra = 9.81 / Tf * max(Ts - Ta, 1e-6) * D ** 3 / nu ** 2 * Pr
    Nn = (0.60 + 0.387 * Ra ** (1 / 6) / (1 + (0.559 / Pr) ** (9 / 16)) ** (8 / 27)) ** 2
    Nf = 0.0
    if v > 0:
        Re = v * D / nu
        Nf = 0.3 + 0.62 * math.sqrt(Re) * Pr ** (1 / 3) / (1 + (0.4 / Pr) ** (2 / 3)) ** 0.25 * (1 + (Re / 282000) ** (5 / 8)) ** (4 / 5)
    return (Nn ** 3 + Nf ** 3) ** (1 / 3) * k / D


def local(c, Tg):
    ri, ro = c['di'] / 2000, c['di'] / 2000 + c['wall'] / 1000
    Ta = c['Ta'] + 273.15
    m, k, cp = mu(Tg), kk(Tg), cpa(Tg)
    Pr = m * cp / k
    Re = 4 * c['mdot'] / (math.pi * 2 * ri * m)
    f = (0.79 * math.log(Re) - 1.64) ** -2
    Nu = max(3.66, (f / 8) * (Re - 1000) * Pr / (1 + 12.7 * math.sqrt(f / 8) * (Pr ** (2 / 3) - 1)))
    hi = c['caf'] * Nu * k / (2 * ri)
    Ri, Rw = 1 / (hi * 2 * math.pi * ri), math.log(ro / ri) / (2 * math.pi * 20.0)
    lo, hi_ = Ta, Tg
    for _ in range(200):
        Ts = (lo + hi_) / 2
        qin = (Tg - Ts) / (Ri + Rw)
        qout = math.pi * 2 * ro * (h_out(Ts, Ta, 2 * ro, c.get('v', 0)) * (Ts - Ta) + c['eps'] * SIG * (Ts ** 4 - Ta ** 4))
        if qout > qin:
            hi_ = Ts
        else:
            lo = Ts
    q = (Tg - Ts) / (Ri + Rw)
    return q, Tg - q * (Ri + Rw / 2), Ts


def run(c):
    n = 4000
    dx = c['L'] / 1000 / n
    Tg = c['Tg'] + 273.15
    st = []
    for i in range(n + 1):
        q, Tst, Ts = local(c, Tg)
        st.append(Tst)
        if i < n:
            T1 = Tg - q * dx / (c['mdot'] * c['cp'])
            q2, _, _ = local(c, T1)
            Tg -= 0.5 * (q + q2) * dx / (c['mdot'] * c['cp'])
    # the page averages its point values (equal steps, both ends): the same here (trapezoid-free mean of the nodes)
    return {'mean': sum(st) / len(st) - 273.15, 'max': max(st) - 273.15, 'Tg_out': Tg - 273.15}


if __name__ == '__main__':
    print(json.dumps(run(json.loads(sys.stdin.read()))))
