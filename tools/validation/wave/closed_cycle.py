#!/usr/bin/env python3
"""closed_cycle.py - an independent closed-cycle (intake closing to exhaust opening) calculation of a single-zone spark-ignition
cylinder, from first principles, to arbitrate between the page's wave model and OpenWAM (docs/WAVE_VALIDATION_2026-11-11.md,
addendum part 4, D sections). It shares no code and no property data with either:

  * properties: NASA's 9-coefficient polynomials (McBride, Zehe and Gordon 2002, NASA TP-2002-211556; the NASA CEA file
    data/thermo.inp, github.com/nasa/cea), not the GRI-Mech 3.0 fits the model uses, for N2, O2, Ar, CO2, H2O, CO, H2, OH,
    H, O, NO, N and the fuel's vapour as 0.62608 isooctane + 0.37392 toluene by mole (H/C 1.87), each from its own fit
    (not the model's refit). Absolute enthalpies (formation included); the fuel's formation enthalpy from its 44.0 MJ/kg
    lower heating value with NASA's CO2 and H2O (as the model and B1 define the fuel), so a lean burn releases exactly 44 MJ/kg;
  * products: frozen at the air-fuel ratio (complete when lean; CO2, CO, H2O, H2 at the water-gas ratio 3.5 when rich, the
    model's rule, so that its property data alone can be compared), or in chemical equilibrium over the 12 species at the
    zone's temperature and the cylinder's pressure (Gibbs minimum by the element-potential Newton method of Gordon and
    McBride, NASA RP-1311, 1994, eqs. 2.24-2.26, with its damping 3.2), the unburned part frozen;
  * energy: dU = -p dV - dQw - (Qchem - Q) dxb, U = sum n_i (h_i(T) - R T) absolute, so the heat of combustion follows from
    the composition change (Q: the heat the case releases; Qchem - Q is the combustion inefficiency, the share of the
    frozen chemistry's heat that is not released, removed as the burn proceeds); RK4 in crank angle at 0.05 deg;
  * burn: Wiebe x = 1 - exp(-a (t / dur)^(m+1)), a 5, m 2 (both codes);
  * wall heat: Woschni (SAE 670931) in a chosen form (see WOSCHNI), with the motored pressure from a motored run of the same
    charge (the published definition), or the polytropic stand-ins the two codes use.

Options reproduce each code's choices one at a time (gas='openwam': OpenWAM's simple species model, its cv polynomials and
energy equation; woschni='openwam'; integ='euler' with a given step list: the wave model's explicit p dV), so that each
difference can be priced by itself.

    curl -sSL -o thermo.inp https://raw.githubusercontent.com/nasa/cea/main/data/thermo.inp
    python3 tools/validation/wave/closed_cycle.py thermo.inp [gri30.yaml]   # self-checks; with gri30.yaml (dissociation.py's
                                                                           # file) the equilibrium against dissociation.py
Used by cyl_phase.py (the comparison against both codes).
"""
import math
import os
import sys

import numpy as np

RU = 8.314462618
P0 = 1e5               # NASA's standard-state pressure
TREF = 298.15
AIR_N2, AIR_AR = 3.7279, 0.04459       # per O2: the model's dry air (A1); a stated input, not a model output
FUEL_Y = 1.87
X_ISO = (FUEL_Y * 7 - 8) / (10 - FUEL_Y)  # isooctane C8H18 + toluene C7H8 by mole with H/C 1.87: 0.62608
LHV = 44.0e6
K_WGS = 3.5

NAMES = ["N2", "O2", "Ar", "CO2", "H2O", "CO", "H2", "OH", "H", "O", "NO", "N", "C8H18,isooctane", "C7H8"]
ELEMS = ["C", "H", "O", "N", "Ar"]
COMP = {"N2": {"N": 2}, "O2": {"O": 2}, "Ar": {"Ar": 1}, "CO2": {"C": 1, "O": 2}, "H2O": {"H": 2, "O": 1}, "CO": {"C": 1, "O": 1},
        "H2": {"H": 2}, "OH": {"O": 1, "H": 1}, "H": {"H": 1}, "O": {"O": 1}, "NO": {"N": 1, "O": 1}, "N": {"N": 1},
        "C8H18,isooctane": {"C": 8, "H": 18}, "C7H8": {"C": 7, "H": 8}}
GAS12 = NAMES[:12]


# ---------------------------------------------------------------- NASA thermo.inp (TP-2002-211556, appendix A format)
def _f(s):
    s = s.strip().replace("D", "E").replace("d", "E")
    return float(s) if s else 0.0


def read_thermo(path, names=NAMES):
    lines = open(path).read().splitlines()
    out = {}
    for k, ln in enumerate(lines):
        nm = ln[:18].split()
        if not nm or nm[0] not in names or nm[0] in out:
            continue
        if k + 2 >= len(lines):
            continue
        h2 = lines[k + 1]
        try:
            nint = int(h2[0:2])
            mw = float(h2[52:65])
        except ValueError:
            continue
        ivs = []
        j = k + 2
        for _ in range(nint):
            tr = lines[j]
            tlo, thi = float(tr[0:11]), float(tr[11:21])
            c1, c2 = lines[j + 1], lines[j + 2]
            a = [_f(c1[16 * i:16 * i + 16]) for i in range(5)] + [_f(c2[0:16]), _f(c2[16:32])]
            b = [_f(c2[48:64]), _f(c2[64:80])]
            ivs.append((tlo, thi, a, b))
            j += 3
        out[nm[0]] = {"M": mw, "iv": ivs}
    miss = [n for n in names if n not in out]
    if miss:
        raise ValueError("thermo.inp: species not found: %s" % miss)
    return out


class Thermo:
    """per-species cp/R, h/RT, s/R from NASA-9 fits; outside the fits' range the end interval is extrapolated (only the
    fuel vapour above 6000 K, never reached)."""

    def __init__(self, path):
        self.d = read_thermo(path)
        self.M = np.array([self.d[n]["M"] for n in NAMES]) / 1000.0     # kg/mol
        self.A = np.array([[COMP[n].get(e, 0) for n in NAMES] for e in ELEMS], dtype=float)

    def _iv(self, n, T):
        ivs = self.d[n]["iv"]
        for iv in ivs:
            if T <= iv[1]:
                return iv if T >= iv[0] or iv is ivs[0] else iv
        return ivs[-1]

    def sp(self, T, which=None):
        """arrays over NAMES (or which): cp/R, h/RT, s/R (s at P0)"""
        which = which or NAMES
        cp, h, s = [], [], []
        lt = math.log(T)
        for n in which:
            _, _, a, b = self._iv(n, T)
            cp.append(a[0] / T ** 2 + a[1] / T + a[2] + a[3] * T + a[4] * T ** 2 + a[5] * T ** 3 + a[6] * T ** 4)
            h.append(-a[0] / T ** 2 + a[1] * lt / T + a[2] + a[3] * T / 2 + a[4] * T ** 2 / 3 + a[5] * T ** 3 / 4 + a[6] * T ** 4 / 5 + b[0] / T)
            s.append(-a[0] / T ** 2 / 2 - a[1] / T + a[2] * lt + a[3] * T + a[4] * T ** 2 / 2 + a[5] * T ** 3 / 3 + a[6] * T ** 4 / 4 + b[1])
        return np.array(cp), np.array(h), np.array(s)


# ---------------------------------------------------------------- the charge
class Charge:
    """moles per kg of fresh mixture (air + fuel vapour at the AFR) and of its products; fuel enthalpy from the LHV."""

    def __init__(self, th, afr, vapour=True, beta=None):
        """beta: instead of the frozen products at the AFR, OpenWAM's composition (its simple species model): a share beta of
        the fuel burned to CO2 and H2O with oxygen from the air (stoichiometric products), the rest of the fuel left as vapour
        and the rest of the air as air"""
        self.th = th
        ix = {n: i for i, n in enumerate(NAMES)}
        self.ix = ix
        M = th.M * 1000
        o = 1 + FUEL_Y / 4
        mair_o2 = AIR_N2 * M[ix["N2"]] + M[ix["O2"]] + AIR_AR * M[ix["Ar"]]       # g of air per mol O2
        mfuel = X_ISO * M[ix["C8H18,isooctane"]] + (1 - X_ISO) * M[ix["C7H8"]]       # g per molecule-mix
        cfv = 8 * X_ISO + 7 * (1 - X_ISO)                                             # C atoms per molecule
        self.mfuelC = mfuel / cfv                                                     # g of fuel per C atom
        self.afr_st = o * mair_o2 / self.mfuelC
        lam = afr / self.afr_st
        self.lam, self.afr = lam, afr
        nf = np.zeros(len(NAMES))
        nf[ix["O2"]], nf[ix["N2"]], nf[ix["Ar"]] = lam * o, lam * o * AIR_N2, lam * o * AIR_AR
        if vapour:
            nf[ix["C8H18,isooctane"]], nf[ix["C7H8"]] = X_ISO / cfv, (1 - X_ISO) / cfv
        mf = (lam * o * mair_o2 + (self.mfuelC if vapour else 0.0)) / 1000.0        # kg per C atom
        nb = np.zeros(len(NAMES))
        nb[ix["N2"]], nb[ix["Ar"]] = lam * o * AIR_N2, lam * o * AIR_AR
        if lam >= 1:
            nb[ix["O2"]], nb[ix["CO2"]], nb[ix["H2O"]] = (lam - 1) * o, 1.0, FUEL_Y / 2
        else:
            S = 2 * lam * o - 1
            qa, qb = K_WGS - 1, K_WGS * (FUEL_Y / 2 - S) + 1 + S
            a = (-qb + math.sqrt(qb * qb + 4 * qa * S)) / (2 * qa)
            nb[ix["CO2"]], nb[ix["H2O"]], nb[ix["CO"]], nb[ix["H2"]] = a, S - a, 1 - a, FUEL_Y / 2 - S + a
        if beta is not None:
            nb = np.zeros(len(NAMES))
            nb[ix["N2"]], nb[ix["Ar"]] = lam * o * AIR_N2, lam * o * AIR_AR
            nb[ix["O2"]], nb[ix["CO2"]], nb[ix["H2O"]] = (lam - beta) * o, beta, beta * FUEL_Y / 2
            nb[ix["C8H18,isooctane"]], nb[ix["C7H8"]] = (1 - beta) * X_ISO / cfv, (1 - beta) * (1 - X_ISO) / cfv
        self.mb_per_C = mf if vapour else (lam * o * mair_o2 + self.mfuelC) / 1000.0
        self.nf = nf / mf                      # mol per kg of fresh mixture
        self.nb = nb / self.mb_per_C           # mol per kg of products
        # the fuel's formation enthalpy per C atom from the LHV: CH1.87 + o O2 -> CO2 + 0.935 H2O(g) releases LHV
        _, h298, _ = th.sp(TREF)
        H298 = h298 * RU * TREF
        hf_fuel_C = H298[ix["CO2"]] + FUEL_Y / 2 * H298[ix["H2O"]] + LHV * self.mfuelC / 1000.0
        # the vapour's own NASA enthalpy at 298.15 per C atom, replaced by hf_fuel_C (its sensible part is NASA's)
        hv298 = (X_ISO * H298[ix["C8H18,isooctane"]] + (1 - X_ISO) * H298[ix["C7H8"]]) / cfv
        self.dHfuel = hf_fuel_C - hv298        # J per C atom added to the vapour's NASA enthalpy
        self.vapour = vapour
        if not vapour:
            raise ValueError("only the vapour charge (the model's default) is implemented")
        self.qchem = self.H(self.nf, TREF) - self.H(self.nb, TREF)     # J per kg of fresh mixture, frozen products

    def H(self, n, T, hsp=None):
        """absolute enthalpy of n mol (array over NAMES), J; the fuel vapour carries dHfuel per C atom"""
        if hsp is None:
            _, hsp, _ = self.th.sp(T)
        ix = self.ix
        corr = (n[ix["C8H18,isooctane"]] * 8 + n[ix["C7H8"]] * 7) * self.dHfuel
        return float(np.dot(n, hsp)) * RU * T + corr

    def U(self, n, T, hsp=None):
        return self.H(n, T, hsp) - n.sum() * RU * T


# ---------------------------------------------------------------- equilibrium (Gordon and McBride, RP-1311, TP problem)
class Equil:
    def __init__(self, th):
        self.th = th
        self.A = th.A[:, :12]                 # elements x the 12 gas species (no fuel in the products)
        self.last = None

    def tp(self, b, T, p, n0=None):
        """moles over GAS12 at T, p for element amounts b (array over ELEMS); Newton on ln n_j, pi_i, ln n."""
        A = self.A
        _, h, s = self.th.sp(T, GAS12)
        g = h - s                              # g/RT at P0
        nj = (n0.copy() if n0 is not None else np.full(12, 0.1 * b.sum() / 12)) + 1e-12
        act = b > 0
        Aa = A[act]
        ba = b[act]
        n = nj.sum()
        lp = math.log(p / P0)
        for it in range(200):
            mu = g + np.log(nj / n) + lp
            Ane = Aa * nj
            m = Aa.shape[0]
            M = np.zeros((m + 1, m + 1))
            M[:m, :m] = Ane @ Aa.T
            M[:m, m] = Ane.sum(axis=1)
            M[m, :m] = Ane.sum(axis=1)
            M[m, m] = nj.sum() - n
            r = np.zeros(m + 1)
            r[:m] = ba - Ane.sum(axis=1) + Ane @ mu
            r[m] = n - nj.sum() + float(np.dot(nj, mu))
            sol = np.linalg.solve(M, r)
            pi, dln = sol[:m], sol[m]
            dlnj = -mu + Aa.T @ pi + dln
            big = max(5 * abs(dln), max(abs(dlnj[nj / n > 1e-8])) if np.any(nj / n > 1e-8) else 0.0)
            lam = min(1.0, 2.0 / big) if big > 2.0 else 1.0
            nj = nj * np.exp(lam * np.clip(dlnj, -50, 50))
            nj = np.maximum(nj, 1e-300)
            n = n * math.exp(lam * dln)
            if np.sum(nj * np.abs(dlnj)) / nj.sum() < 1e-12 and abs(dln) < 1e-12:
                break
        else:
            raise RuntimeError("equilibrium did not converge at T %g p %g" % (T, p))
        el = A @ nj
        if np.max(np.abs(el[act] - ba) / ba) > 1e-9:
            raise RuntimeError("element balance %g" % np.max(np.abs(el[act] - ba) / ba))
        return nj


# ---------------------------------------------------------------- OpenWAM's simple species model (Globales.h:1609-1660)
def wam_cv(T, Yb, Yf):
    rt = math.sqrt(T)
    cva = -10.4199 * rt + 2522.88 + (-67227.1 * rt + 917124.4 - 4174853.6 / rt) / T
    cvb = 641.154 + T * (0.43045 + T * (-0.0001125 + T * 8.979e-9))
    cvf = ((4.200E-07 * T - 2.524E-03) * T + 5.834E+00) * T + 1.890E+02 - 72.42
    return cvb * Yb + cvf * Yf + cva * (1 - Yf - Yb)


def wam_u(T, k, T0=TREF):
    """sensible internal energy from T0 of OpenWAM's cv polynomials (closed-form integrals), J/kg"""
    def F(T):
        if k == "a":
            rt = math.sqrt(T)
            return -10.4199 * 2 / 3 * T * rt + 2522.88 * T - 67227.1 * 2 * rt + 917124.4 * math.log(T) + 4174853.6 * 2 / rt
        if k == "b":
            return 641.154 * T + 0.43045 * T ** 2 / 2 - 0.0001125 * T ** 3 / 3 + 8.979e-9 * T ** 4 / 4
        return 4.2e-7 * T ** 4 / 4 - 2.524e-3 * T ** 3 / 3 + 5.834 * T ** 2 / 2 + (1.890E+02 - 72.42) * T
    return F(T) - F(T0)


def wam_R(Yb, Yf):
    return 285.4 * Yb + 72.42 * Yf + 287.0 * (1 - Yb - Yf)


# ---------------------------------------------------------------- geometry, burn, Woschni
class Geom:
    def __init__(self, bore, stroke, rod, cr):
        self.B, self.S, self.L, self.cr = bore, stroke, rod, cr
        self.Ap = math.pi / 4 * bore * bore
        self.Vd = self.Ap * stroke
        self.Vc = self.Vd / (cr - 1)
        self.a = stroke / 2

    def V(self, th):
        t = math.radians(th)
        s = math.sin(t)
        return self.Vc + self.Ap * (self.a + self.L - self.a * math.cos(t) - math.sqrt(self.L ** 2 - (self.a * s) ** 2))

    def dV(self, th):     # per degree
        t = math.radians(th)
        s, c = math.sin(t), math.cos(t)
        return self.Ap * self.a * (s + self.a * s * c / math.sqrt(self.L ** 2 - (self.a * s) ** 2)) * math.pi / 180


def wiebe(a, dur, aw=5.0, mw=2.0):
    if a <= 0:
        return 0.0
    if a >= dur:
        return 1.0
    return 1 - math.exp(-aw * (a / dur) ** (mw + 1))


def dwiebe(a, dur, aw=5.0, mw=2.0):
    if a <= 0 or a >= dur:
        return 0.0
    u = a / dur
    return aw * (mw + 1) * u ** mw / dur * math.exp(-aw * u ** (mw + 1))


# Woschni forms. C: the coefficient of p^0.8 (p in Pa) B^-0.2 w^0.8 T^eT; C2 the combustion velocity coefficient (m/s K);
# c2when: 'burn_to_evo' (Heywood's "combustion and expansion"; the model) or 'burn' (only while burning; OpenWAM)
WOSCHNI = {
    # Heywood 1988 eq. 12.19 form: 3.26 B^-0.2 p(kPa)^0.8 T^-0.55 w^0.8 -> 3.26 x 1000^-0.8 per Pa^0.8; the model
    "heywood": {"C": 3.26 * 1000 ** -0.8, "eT": -0.55, "C2": 3.24e-3, "c2when": "burn_to_evo"},
    # Woschni 1967 (SAE 670931) in its own units: 110 kcal/m2 h K, d m, p at (kp/cm2), T^-0.53 -> per Pa^0.8
    "woschni67": {"C": 110 * 4186.8 / 3600 * 98066.5 ** -0.8, "eT": -0.53, "C2": 3.24e-3, "c2when": "burn_to_evo"},
    # OpenWAM (TCilindro4T.cpp:549-577): 1.2e-2 Pa^0.8, T^-0.53, C2 0.001 only between the start and end of the burn
    "openwam": {"C": 1.2e-2, "eT": -0.53, "C2": 1.0e-3, "c2when": "burn"},
}


# ---------------------------------------------------------------- the closed cycle
def run(case, gas="frozen", woschni="heywood", pm="motored", integ="rk4", dth=0.1, steps=None, record=False, _pm_table=None):
    """case: geom {bore, stroke, rod, cr}, rpm, ivc, evo, ign (deg, cylinder frame, firing TDC 0/720), dur, afr, Q (J to
    release; None = the frozen chemistry's), m (kg), T (K), x (fresh mass fraction at IVC, the rest burned products at the
    AFR), Twall (K), [vapour True]. gas: 'frozen' | 'equil' | 'openwam'; woschni: a WOSCHNI key or 'none';
    pm: 'motored' (a motored run of the same charge) | a number (polytropic exponent from IVC).
    integ: 'rk4' at dth, or 'euler' (the wave model's explicit step: p at the step's start) on steps [(th, dth, dt)].
    Returns W (p dV), Qw (wall heat), Qrel (heat released), per phase (comp: IVC to ignition, burn: the Wiebe duration,
    exp: burn end to EVO), and the trace if record."""
    g = Geom(case["bore"], case["stroke"], case["rod"], case["cr"])
    rpm = case["rpm"]
    omega = rpm * 6.0                       # deg/s
    Sp = 2 * case["stroke"] * rpm / 60
    th0 = case["ivc"]
    span = (case["evo"] - th0) % 720.0
    ign_rel = (case["ign"] - th0) % 720.0
    dur = case["dur"]
    Tw = case.get("Twall", 450.0)
    m = case["m"]
    x0 = case["x"]
    W = WOSCHNI.get(woschni)
    if woschni != "none" and pm == "motored" and _pm_table is None and case.get("Q", 1) != 0:
        mot = run(dict(case, Q=0.0, motored=True), gas=gas, woschni=woschni, pm="none_needed", integ="rk4", dth=dth, record=True)
        _pm_table = (np.array(mot["trace"]["rel"]), np.array(mot["trace"]["p"]))
    motored = case.get("motored", False)
    if gas in ("frozen", "equil"):
        ch = case.get("_charge") or Charge(case["thermo"], case["afr"], case.get("vapour", True))
        eq = Equil(case["thermo"]) if gas == "equil" else None
        nf, nb = ch.nf, ch.nb
        qchem = ch.qchem
        Q = qchem * m * x0 if case.get("Q") is None else case["Q"]
        if motored:
            Q = 0.0
        loss = (qchem * m * x0 - Q)     # chemistry not released over the burn
        bel = ch.th.A[:, :12] @ nb[:12]   # elements per kg of products
        state = {"neq": None}

        def comp(xb, T, V):
            """moles of the charge at burned fraction xb (frozen unburned fresh, products frozen or in equilibrium)"""
            fu = m * x0 * (1 - xb)            # kg of unburned fresh mixture
            fb = m - fu
            if motored:
                fu, fb = m * x0, m * (1 - x0)
            nu = nf * fu
            if eq is None or fb <= 0:
                return nu + nb * fb
            # products at the cylinder's pressure: p from all moles, fixed point (the products' moles move weakly with p)
            ne = state["neq"] if state["neq"] is not None else nb[:12] * fb
            p = (nu.sum() + ne.sum()) * RU * T / V
            for _ in range(4):
                ne2 = eq.tp(bel * fb, T, p, ne if state["neq"] is not None else nb[:12] * fb + 1e-10)
                p2 = (nu.sum() + ne2.sum()) * RU * T / V
                ne = ne2
                if abs(p2 / p - 1) < 1e-12:
                    break
                p = p2
            state["neq"] = ne
            out = nu.copy()
            out[:12] += ne
            return out

        def U_of(T, xb, V):
            n = comp(xb, T, V)
            return ch.U(n, T), n

        def T_of(Uv, xb, V, Tg):
            T = Tg
            for _ in range(60):
                u1, n = U_of(T, xb, V)
                dT = 0.5
                u2, _ = U_of(T + dT, xb, V)
                cvt = (u2 - u1) / dT
                step = (u1 - Uv) / cvt
                T -= step
                if abs(step) < 1e-10 * T:
                    break
            n = comp(xb, T, V)
            return T, n

        def pressure(n, T, V):
            return n.sum() * RU * T / V

        def props(n, T):
            cpR, _, _ = ch.th.sp(T)
            mtot = float(np.dot(n, ch.th.M))
            R = n.sum() * RU / mtot
            cp = float(np.dot(n, cpR)) * RU / mtot     # frozen cp
            return R, cp
    else:   # OpenWAM's simple species model
        Yb0 = 1 - x0
        if motored:
            Q = 0.0
        else:
            Q = case["Q"]
        mf_tot = case.get("mfuel", 0.0)

    rel_end = span
    t_burn_end = ign_rel + dur
    bps = [ign_rel, t_burn_end]       # steps end on the burn's start and end (kinks of the Wiebe law)

    def xb_at(rel):
        return 0.0 if motored else wiebe(rel - ign_rel, dur)

    def woschni_q(p, T, V, rel, ivc_state):
        if W is None:
            return 0.0
        pr, Tr, Vr = ivc_state
        burning = (not motored) and rel >= ign_rel and (rel <= t_burn_end if W["c2when"] == "burn" else True)
        if burning:
            if isinstance(pm, (int, float)):
                pmo = pr * (Vr / V) ** pm
            elif _pm_table is not None:
                pmo = float(np.interp(rel, _pm_table[0], _pm_table[1]))
            else:
                pmo = p
            rref = 287.0 if woschni == "openwam" else None
            if rref:
                fac = g.Vd / (case.get("mtrap", m) * rref)
            else:
                fac = g.Vd * Tr / (pr * Vr)
            wv = 2.28 * Sp + W["C2"] * fac * max(0.0, p - pmo)
        else:
            wv = 2.28 * Sp
        h = W["C"] * g.B ** -0.2 * p ** 0.8 * T ** W["eT"] * wv ** 0.8
        if woschni == "openwam":
            A = 4 * (V - g.Vc) / g.B + g.Ap + (g.Ap + 4 * g.Vc / g.B)
        else:
            A = 2 * g.Ap + 4 * V / g.B
        return h * A * (T - Tw), h, A

    # ---- integrate
    rec = {"rel": [], "p": [], "T": [], "gamma": [], "cp": [], "R": [], "qw": [], "hc": [], "A": [], "dQ": [], "xb": []}
    acc = {k: {"W": 0.0, "Qw": 0.0, "Qrel": 0.0} for k in ("comp", "burn", "exp")}
    phase = lambda rel: "comp" if rel < ign_rel else ("burn" if rel < t_burn_end else "exp")
    V0 = g.V(th0)
    if gas in ("frozen", "equil"):
        n0 = comp(0.0, case["T"], V0)
        U0 = ch.U(n0, case["T"])
        p0 = pressure(n0, case["T"], V0)
        ivc_state = (p0, case["T"], V0)
        Tcur = case["T"]

        def deriv(rel, Uv, Tg):
            th = th0 + rel
            V = g.V(th)
            xb = xb_at(rel)
            # the state variable is U + loss xb: the chemistry not released leaves with the burned fraction itself (Wiebe's
            # last 0.7 % included, which both codes burn at once at the end of the duration)
            T, n = T_of(Uv - loss * xb, xb, V, Tg)
            p = pressure(n, T, V)
            q, h, A = woschni_q(p, T, V, rel, ivc_state) if W else (0.0, 0.0, 0.0)
            dxb = 0.0
            dU = -p * g.dV(th) - q / omega      # per degree
            return dU, T, p, q, h, A, n, dxb

        rel = 0.0
        Uv = U0
        while rel < rel_end - 1e-12:
            h_ = min(dth, rel_end - rel, *[b - rel for b in bps if b > rel + 1e-9])
            k1, T1, p1, q1, hc1, A1, n1, dx1 = deriv(rel, Uv, Tcur)
            if record:
                R, cp = props(n1, T1)
                for k, v in (("rel", rel), ("p", p1), ("T", T1), ("gamma", cp / (cp - R)), ("cp", cp), ("R", R), ("qw", q1), ("hc", hc1), ("A", A1), ("xb", xb_at(rel))):
                    rec[k].append(v)
            k2 = deriv(rel + h_ / 2, Uv + h_ / 2 * k1, T1)
            k3 = deriv(rel + h_ / 2, Uv + h_ / 2 * k2[0], k2[1])
            k4 = deriv(rel + h_, Uv + h_ * k3[0], k3[1])
            # integrals by the same RK4 weights (Simpson in the step)
            ph = phase(rel + h_ / 2)
            pdv = h_ / 6 * (p1 * g.dV(th0 + rel) + 2 * k2[2] * g.dV(th0 + rel + h_ / 2) + 2 * k3[2] * g.dV(th0 + rel + h_ / 2) + k4[2] * g.dV(th0 + rel + h_))
            acc[ph]["W"] += pdv
            acc[ph]["Qw"] += h_ / 6 * (q1 + 2 * k2[3] + 2 * k3[3] + k4[3]) / omega
            acc[ph]["Qrel"] += (Q if not motored else 0.0) * (xb_at(rel + h_) - xb_at(rel))
            Uv = Uv + h_ / 6 * (k1 + 2 * k2[0] + 2 * k3[0] + k4[0])
            Tcur = k4[1]
            rel += h_
        Tend, nend = T_of(Uv - loss * xb_at(rel_end), xb_at(rel_end), g.V(th0 + rel_end), Tcur)
        pend = pressure(nend, Tend, g.V(th0 + rel_end))
        Uend = Uv - loss * xb_at(rel_end)
    else:
        # OpenWAM: dlnT = (gamma - 1) (-dV/V + dm/m) + dQ / (m cv T), R and cv from (Yb, Yf, T); fuel injected from IVC + 2 deg
        # over inj_deg (TCilindro4T.cpp:180-181) with h = cp T (the mass term of its energy equation, line 911); burnt =
        # stoichiometric products of the fuel burned (Q / LHV), air consumed at the stoichiometric ratio FS
        FS = 0.068468349
        inj0, injd = 2.0, case.get("inj_deg", 0.0)
        mf_inj = mf_tot if injd > 0 else 0.0
        m_air0 = case["m"] * (1 - Yb0)            # OpenWAM's x at IVC: the air (its burnt is the residual)
        LHVw = 44e6
        ivc_state = None

        def masses(rel):
            fin = 0.0 if injd <= 0 else mf_inj * min(1.0, max(0.0, (rel - inj0) / injd))
            dfin = 0.0 if injd <= 0 or not (inj0 < rel < inj0 + injd) else mf_inj / injd
            xbv = xb_at(rel)
            # fuel burned: OpenWAM burns Q / LHV (TCilindro4T.cpp:641), so with a combustion efficiency below 1 the rest of the
            # fuel stays in the gas as vapour to EVO; wam_burn_all: all of it is converted (the heat released still Q)
            mburn_f = (case.get("mfuel0", 0.0) + mf_inj if case.get("wam_burn_all") else Q / LHVw) * xbv
            mb = case["m"] * Yb0 + mburn_f * (1 + 1 / FS)
            mfu = (case.get("mfuel0", 0.0) + fin) - mburn_f
            mtot = case["m"] + fin
            return mtot, mb / mtot, mfu / mtot, dfin

        def deriv(rel, T):
            th = th0 + rel
            V = g.V(th)
            mt, Yb, Yf, dfin = masses(rel)
            R = wam_R(Yb, Yf)
            cv = wam_cv(T, Yb, Yf)
            p = mt * R * T / V
            q, h, A = woschni_q(p, T, V, rel, ivc_state) if W else (0.0, 0.0, 0.0)
            dQ = 0.0 if motored else Q * dwiebe(rel - ign_rel, dur)
            gm1 = R / cv
            dT = T * (gm1 * (-g.dV(th) / V + dfin / mt)) + (dQ - q / omega) / (mt * cv)
            if case.get("wam_consistent") and not motored:
                # the term OpenWAM's energy equation leaves out: converting dm of air and fuel into burnt gas at T changes U
                # by dm (u_b(T) - u_unburned(T)), u the sensible energies of its own cv polynomials from 298.15 K (the LHV's datum)
                dxb = dwiebe(rel - ign_rel, dur)
                dmf = (case.get("mfuel0", 0.0) + mf_inj if case.get("wam_burn_all") else Q / LHVw) * dxb
                dma = dmf / FS
                dU = (dmf + dma) * wam_u(T, "b") - dmf * wam_u(T, "f") - dma * wam_u(T, "a")
                dT -= dU / (mt * cv)
            return dT, p, q, h, A, R, cv

        T = case["T"]
        mt0, _, _, _ = masses(0.0)
        ivc_state = (mt0 * wam_R(Yb0, case.get("mfuel0", 0.0) / mt0) * T / V0, T, V0)
        rel = 0.0
        while rel < rel_end - 1e-12:
            h_ = min(dth, rel_end - rel, *[b - rel for b in bps if b > rel + 1e-9])
            k1 = deriv(rel, T)
            if record:
                R, cv = k1[5], k1[6]
                for k, v in (("rel", rel), ("p", k1[1]), ("T", T), ("gamma", 1 + R / cv), ("cp", cv + R), ("R", R), ("qw", k1[2]), ("hc", k1[3]), ("A", k1[4]), ("xb", xb_at(rel))):
                    rec[k].append(v)
            k2 = deriv(rel + h_ / 2, T + h_ / 2 * k1[0])
            k3 = deriv(rel + h_ / 2, T + h_ / 2 * k2[0])
            k4 = deriv(rel + h_, T + h_ * k3[0])
            ph = phase(rel + h_ / 2)
            acc[ph]["W"] += h_ / 6 * (k1[1] * g.dV(th0 + rel) + 2 * (k2[1] + k3[1]) * g.dV(th0 + rel + h_ / 2) + k4[1] * g.dV(th0 + rel + h_))
            acc[ph]["Qw"] += h_ / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) / omega
            acc[ph]["Qrel"] += (0.0 if motored else Q) * (xb_at(rel + h_) - xb_at(rel))
            T = T + h_ / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
            rel += h_
        Tend = T
        pend = deriv(rel_end, T)[1]
        p0 = ivc_state[0]
        Uend = U0 = None
    tot = {k: sum(acc[ph][k] for ph in acc) for k in ("W", "Qw", "Qrel")}
    out = {"W": tot["W"], "Qw": tot["Qw"], "Qrel": tot["Qrel"], "phases": acc, "pEvo": pend, "TEvo": Tend, "pIvc": p0,
           "U0": U0, "Uend": Uend, "Q": Q}
    if gas in ("frozen", "equil") and not motored:
        # energy balance: U0 - Uend = W + Qw + loss (to rounding of the RK4 integrals of p dV and Qw)
        out["energyResid"] = (U0 - Uend - tot["W"] - tot["Qw"] - loss) / Q if Q else 0.0
    if record:
        out["trace"] = rec
    return out


def euler_wave(case, steps, woschni="heywood", pm=1.32):
    """the wave model's own scheme (runSpeed's cylinder step: p and the wall heat at the step's start, U_new = U - p dV + Q dxb
    - qw, T from U_new) with this script's NASA properties and frozen products: prices the explicit p dV on the wave's steps.
    steps: [(th, dth, dt)] from IVC to EVO as the wave run took them."""
    g = Geom(case["bore"], case["stroke"], case["rod"], case["cr"])
    ch = case.get("_charge") or Charge(case["thermo"], case["afr"], case.get("vapour", True))
    m, x0 = case["m"], case["x"]
    Q = case["Q"]
    Sp = 2 * case["stroke"] * case["rpm"] / 60
    W = WOSCHNI[woschni] if woschni != "none" else None
    ign, dur, Tw = case["ign"], case["dur"], case.get("Twall", 450.0)
    T = case["T"]
    xb = 0.0
    burning = burnt = False
    comp = lambda xb: ch.nf * m * x0 * (1 - xb) + ch.nb * (m - m * x0 * (1 - xb))
    V0 = g.V(steps[0][0])
    pr = comp(0).sum() * RU * T / V0
    Tr, Vr = T, V0
    Wsum = Qw = 0.0
    U = ch.U(comp(0), T)
    for th, d, dt in steps:
        n = comp(xb)
        V = g.V(th)
        p = n.sum() * RU * T / V
        a = ((th - ign) % 720 + 720) % 720
        nxb = xb
        if not burnt:
            if a <= dur and (burning or a < 3):
                burning = True
                nxb = wiebe(a, dur)
            elif burning:
                nxb = 1.0
                burnt = True
        dxb = max(0.0, nxb - xb)
        dV = g.dV(th) * d
        qw = 0.0
        if W:
            pmo = pr * (Vr / V) ** pm
            wv = 2.28 * Sp + (W["C2"] * g.Vd * Tr / (pr * Vr) * max(0.0, p - pmo) if burning else 0.0)
            h = W["C"] * g.B ** -0.2 * p ** 0.8 * T ** W["eT"] * wv ** 0.8
            qw = h * (2 * g.Ap + 4 * V / g.B) * (T - Tw) * dt
        nn = comp(nxb)
        Unew = U - p * dV - qw - (ch.qchem * m * x0 - Q) * dxb
        # T from Unew at the new composition
        Tn = T
        for _ in range(50):
            u1 = ch.U(nn, Tn)
            cvt = (ch.U(nn, Tn + 0.5) - u1) / 0.5
            st = (u1 - Unew) / cvt
            Tn -= st
            if abs(st) < 1e-10 * Tn:
                break
        T, U, xb = Tn, Unew, nxb
        Wsum += p * dV
        Qw += qw
    return {"W": Wsum, "Qw": Qw}


# ---------------------------------------------------------------- self-checks
def selfcheck(path):
    th = Thermo(path)
    ok = True

    def chk(c, msg):
        nonlocal ok
        ok = ok and c
        print(("PASS " if c else "FAIL ") + msg)

    ch = Charge(th, 14.6)
    chk(abs(ch.afr_st - 14.596) < 0.01, "stoichiometric AFR %.4f (the model's 14.596)" % ch.afr_st)
    chk(abs(ch.qchem * (1 + 1 / 14.6 * 0) - 2.8205e6) / 2.8205e6 < 2e-3, "heat per kg of mixture at AFR 14.6 %.4f MJ/kg (B1 by hand: 2.8205)" % (ch.qchem / 1e6))
    ch12 = Charge(th, 12.8)
    chk(abs(ch12.qchem - 2.6746e6) / 2.6746e6 < 2e-3, "heat per kg of mixture at AFR 12.8 %.4f MJ/kg (B1 by hand: 2.6746)" % (ch12.qchem / 1e6))
    # NIST-JANAF cp, J/mol K (janaf.nist.gov tables C-095 CO2, H-064 H2O, N-023 N2, fetched 2026-11-12). NASA's water above
    # 1000 K is Gurvich's 1989 analysis, 1.1 % above JANAF at 2000 K (addendum part 1, A1), hence its wider tolerance
    for nm, T, cpj, tol in (("CO2", 1000.0, 54.308, 4e-3), ("H2O", 2000.0, 51.180, 1.5e-2), ("N2", 1500.0, 34.843, 4e-3), ("CO2", 3000.0, 62.229, 4e-3),
                            ("H2O", 1000.0, 41.268, 4e-3), ("N2", 3000.0, 37.030, 4e-3)):
        cp, _, _ = th.sp(T, [nm])
        chk(abs(cp[0] * RU / cpj - 1) < tol, "NASA-9 cp %s at %g K %.3f J/mol K, JANAF %.3f" % (nm, T, cp[0] * RU, cpj))
    eq = Equil(th)
    # equilibrium of stoichiometric products at 2500 K, 1 atm vs the frozen moles: element balance and Kp of CO2 = CO + 1/2 O2
    b = th.A[:, :12] @ ch.nb[:12]
    n = eq.tp(b, 2500.0, 101325.0)
    ix = {k: i for i, k in enumerate(GAS12)}
    N = n.sum()
    _, h, s = th.sp(2500.0, GAS12)
    gRT = h - s
    lnK = -(gRT[ix["CO"]] + 0.5 * gRT[ix["O2"]] - gRT[ix["CO2"]])
    lnQ = math.log((n[ix["CO"]] / N) * (n[ix["O2"]] / N) ** 0.5 / (n[ix["CO2"]] / N) * (101325.0 / P0) ** 0.5)
    chk(abs(lnK - lnQ) < 1e-8, "equilibrium satisfies CO2 = CO + 1/2 O2 at 2500 K, 1 atm (ln K %.6f, ln Q %.6f)" % (lnK, lnQ))
    return ok


def crosscheck(path, gri):
    """the equilibrium solver: (1) with this script's NASA-9 data, the equilibrium constants of CO2 = CO + 1/2 O2 and
    H2O = OH + 1/2 H2 hold to 1e-9 in ln K on the products of AFR 12.8 and 14.6 at 2000-3000 K and 20-120 bar; (2) run on
    GRI-Mech 3.0 data, against dissociation.py's solution (an independent method: SLSQP minimum of the Helmholtz energy) at
    the same T and V: mole fractions above 1e-3 within 2 % wherever dissociation.py's own minimum satisfies those two
    equilibrium constants to 0.02 in ln K (where it does not, its optimiser stopped short; reported, not counted)."""
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dissociation.py")).read()
    src = src[:src.index("def case(")]
    ns = {}
    argv = sys.argv
    sys.argv = ["dissociation.py", gri]
    try:
        exec(compile(src, "dissociation.py", "exec"), ns)
    finally:
        sys.argv = argv
    th = Thermo(path)
    key = lambda nm: "AR" if nm == "Ar" else nm

    class GriData:
        A, M = th.A, th.M

        def sp(self, T, which=None):
            which = which or NAMES
            return (np.zeros(len(which)), np.array([ns["h_RT"](key(n), T) for n in which]), np.array([ns["s_R"](key(n), T) for n in which]))

    def lnres(x, T, P, gfun):
        L = lambda k: math.log(max(x[k], 1e-300))
        r1 = L("CO") + 0.5 * L("O2") - L("CO2") + 0.5 * math.log(P / P0) + gfun("CO") + 0.5 * gfun("O2") - gfun("CO2")
        r2 = L("OH") + 0.5 * L("H2") - L("H2O") + 0.5 * math.log(P / P0) + gfun("OH") + 0.5 * gfun("H2") - gfun("H2O")
        return max(abs(r1), abs(r2))

    ok, worst, worstK, skipped = True, 0.0, 0.0, []
    for afr in (12.8, 14.6):
        b = th.A[:, :12] @ Charge(th, afr).nb[:12]
        el = dict(zip(ELEMS, b))
        for T in (2000.0, 2500.0, 3000.0):
            for p in (20e5, 120e5):
                n = Equil(th).tp(b, T, p)
                _, h, s_ = th.sp(T, GAS12)
                gN = dict(zip(GAS12, h - s_))
                worstK = max(worstK, lnres(dict(zip(GAS12, n / n.sum())), T, p, lambda k: gN[k]))
                ng = Equil(GriData()).tp(b, T, p)
                V = ng.sum() * RU * T / p
                d = ns["equil"](el, T, V)
                N2 = sum(d.values())
                xd = {nm: max(d[key(nm)] / N2, 1e-300) for nm in GAS12}
                gG = lambda k: ns["h_RT"](key(k), T) - ns["s_R"](key(k), T)
                rd = lnres(xd, T, N2 * RU * T / V, gG)
                if rd > 0.02:
                    skipped.append("AFR %g %g K %g bar (its ln K residual %.3g)" % (afr, T, p / 1e5, rd))
                    continue
                for k, nm in enumerate(GAS12):
                    if xd[nm] > 1e-3:
                        worst = max(worst, abs(ng[k] / ng.sum() / xd[nm] - 1))
    ok = worstK < 1e-9 and worst < 0.02
    print(("PASS " if worstK < 1e-9 else "FAIL ") + "equilibrium constants hold to %.1e in ln K (AFR 12.8 / 14.6, 2000-3000 K, 20-120 bar)" % worstK)
    print(("PASS " if worst < 0.02 else "FAIL ") + "on GRI data, against dissociation.py: largest relative difference %.2f %% of a mole fraction above 1e-3"
          % (100 * worst) + ("; not compared (dissociation.py's optimiser stopped short): " + "; ".join(skipped) if skipped else ""))
    return ok


def b2(path):
    """addendum part 2's B2 case again with this script's equilibrium solver: an adiabatic constant-volume burn of the fresh
    mixture from (Tu, pu), then expansion to 8 times the volume (dU = -p dV, RK4 in ln V, 4000 steps), the products frozen
    against shifting equilibrium; ETA_C not applied (all of the chemistry released, as B2)"""
    th = Thermo(path)
    eq = Equil(th)
    for afr in (14.6, 12.8):
        ch = Charge(th, afr)
        for Tu, pu in ((750.0, 25e5), (800.0, 35e5)):
            m = 1.0
            nu = ch.nf * m
            V0 = nu.sum() * RU * Tu / pu
            U0 = ch.U(nu, Tu)
            bel = th.A[:, :12] @ ch.nb[:12]
            res = {}
            for mode in ("frozen", "equil"):
                st = {"n": None}

                def comp(T, V):
                    if mode == "frozen":
                        return ch.nb * m
                    ne = st["n"] if st["n"] is not None else ch.nb[:12] * m + 1e-10
                    p = ne.sum() * RU * T / V
                    for _ in range(6):
                        ne = eq.tp(bel * m, T, p, ne)
                        p2 = ne.sum() * RU * T / V
                        if abs(p2 / p - 1) < 1e-13:
                            break
                        p = p2
                    st["n"] = ne
                    out = np.zeros(len(NAMES))
                    out[:12] = ne
                    return out

                def T_of(U, V, T):
                    for _ in range(80):
                        u1 = ch.U(comp(T, V), T)
                        c = (ch.U(comp(T + 0.5, V), T + 0.5) - u1) / 0.5
                        d = (u1 - U) / c
                        T -= d
                        if abs(d) < 1e-9 * T:
                            break
                    return T

                T1 = T_of(U0, V0, 3000.0)
                n1 = comp(T1, V0)
                p1 = n1.sum() * RU * T1 / V0
                N = 4000
                dl = math.log(8.0) / N
                U, T, lv = U0, T1, math.log(V0)

                def f(lv, U, Tg):
                    V = math.exp(lv)
                    T = T_of(U, V, Tg)
                    p = comp(T, V).sum() * RU * T / V
                    return -p * V, T
                for _ in range(N):
                    k1, t1 = f(lv, U, T)
                    k2, t2 = f(lv + dl / 2, U + dl / 2 * k1, t1)
                    k3, t3 = f(lv + dl / 2, U + dl / 2 * k2, t2)
                    k4, t4 = f(lv + dl, U + dl * k3, t3)
                    U += dl / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
                    lv += dl
                    T = t4
                res[mode] = (T1, p1, (U0 - U) / m, T)
            f_, e_ = res["frozen"], res["equil"]
            print("AFR %g, unburned %g K %g bar: peak T frozen %.0f / equilibrium %.0f K, p %.1f / %.1f bar, expansion work x8 %.4f / %.4f MJ/kg (%+.2f %%), end T %.0f / %.0f K"
                  % (afr, Tu, pu / 1e5, f_[0], e_[0], f_[1] / 1e5, e_[1] / 1e5, f_[2] / 1e6, e_[2] / 1e6, 100 * (f_[2] / e_[2] - 1), f_[3], e_[3]))


def afr_check(path, res):
    """dissociation at another AFR: single_L800's 5000 rpm wave IVC state (results/cyl_d.json; geometry of compare.py's
    single cylinder) at AFR 12.8 and 14.6, the heat ETA_C 0.975 x the frozen chemistry, Heywood's Woschni with pm 1.32,
    frozen against equilibrium products, and adiabatic"""
    import json
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import compare
    th = Thermo(path)
    r = next(x for x in json.load(open(res))["single_L800"] if x["rpm"] == 5000)
    e = compare.CONFIGS["single_L800"][0]()["e"]
    iv = r["wave"]["ivc"]
    for afr in (12.8, 14.6):
        ch = Charge(th, afr)
        case = dict(bore=e["bore"], stroke=e["stroke"], rod=e["rod"], cr=e["cr"], rpm=5000, ivc=r["ivcDeg"] if "ivcDeg" in r else 0, evo=0,
                    ign=0, dur=e["burn"]["dur"], afr=afr, Twall=e.get("Twall") or 450.0, thermo=th, m=iv["m"], T=iv["T"], x=iv["x"], _charge=ch)
        case.update(r["angles"])
        case["Q"] = 0.975 * ch.qchem * iv["m"] * iv["x"]
        for wo in ("heywood", "none"):
            f = run(case, "frozen", wo, 1.32, dth=0.25)
            q = run(case, "equil", wo, 1.32, dth=0.25)
            print("AFR %g, Woschni %s: W frozen %.2f J, equilibrium %.2f J (%+.2f %%)" % (afr, wo, f["W"], q["W"], 100 * (q["W"] / f["W"] - 1)))


if __name__ == "__main__":
    if len(sys.argv) > 3 and sys.argv[2] == "afr":
        afr_check(sys.argv[1], sys.argv[3])
        sys.exit(0)
    if len(sys.argv) > 2 and sys.argv[2] == "b2":
        b2(sys.argv[1])
        sys.exit(0)
    good = selfcheck(sys.argv[1])
    if len(sys.argv) > 2:
        good = crosscheck(sys.argv[1], sys.argv[2]) and good
    sys.exit(0 if good else 1)
