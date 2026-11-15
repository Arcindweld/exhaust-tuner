#!/usr/bin/env python3
"""knock_ref.py - independent checks of the knock estimate (docs/WAVE_VALIDATION_2026-11-11.md part 12, L3):

 (a) the Livengood-Wu integral of Douaud and Eyzat's tau on synthetic histories, by hand-integrable cases and by adaptive
     Simpson quadrature (the numbers knock_ui.js checks knockLib against);
 (b) from results/knock_ref_in.json (knock_refdump.js): the unburned temperature by isentropic compression along the
     model's pressure, integrated here independently (RK4 in ln p with cp(T) from the tables), against knockLib's;
 (c) a two-zone closed cycle written here from the same IVC state, volume, Wiebe burn and the same gas tables (an
     adiabatic unburned zone of the trapped mixture, a burned zone of products, one pressure; the heat released taken from
     the model's own adiabatic run by its energy balance), against the single-zone pressure + isentropic method.

    python3 tools/validation/wave/knock_ref.py        prints the tables; writes results/knock_ref.json
"""
import json
import math
import os
import bisect

HERE = os.path.dirname(os.path.abspath(__file__))
ATM = 101325.0
A, AE, N, B = 0.01768, 3.402, 1.7, 3800.0


def tau(on, p, T):
    return A * (on / 100.0) ** AE * (p / ATM) ** (-N) * math.exp(B / T)


def simpson(f, a, b, n=20000):
    h = (b - a) / n
    s = f(a) + f(b)
    for i in range(1, n):
        s += (4 if i % 2 else 2) * f(a + i * h)
    return s * h / 3


def synthetic():
    out = {}
    # 1: constant state: I = t / tau exactly
    t1 = tau(95, 40 * ATM, 800.0)
    out["const_tau_s"] = t1
    out["const_I_2ms"] = 0.002 / t1
    # 2: linear ramps over 5 ms: p 20 -> 60 atm, T 700 -> 950 K, ON 90
    f2 = lambda t: 1.0 / tau(90, (20 + 40 * t / 0.005) * ATM, 700 + 250 * t / 0.005)
    out["ramp_I"] = simpson(f2, 0.0, 0.005)
    # 3: an isentropic-like history p = p0 (V0/V)^1.3 with T = T0 (p/p0)^(0.3/1.3) over a crank sweep at 3000 rpm
    #    (V/V0 = 1 - 0.9 sin(pi u / 180) for u in 0..90 deg), ON 100, p0 1 atm... the closed form is not elementary: Simpson
    def st(u):
        r = 1 - 0.9 * math.sin(math.pi * u / 180)
        p = 1.5 * ATM * r ** -1.3
        T = 350 * r ** -0.3
        return p, T
    w = 6 * 3000.0
    out["sweep_I"] = simpson(lambda u: 1.0 / tau(100, *st(u)) / w, 0.0, 90.0)
    return out


class Tab:
    def __init__(self, t, keys):
        self.T = t["T"]
        self.k = {k: t[k] for k in keys}

    def at(self, k, T):
        i = min(max(int(T - self.T[0]), 0), len(self.T) - 2)
        f = T - self.T[i]
        a = self.k[k]
        return a[i] + f * (a[i + 1] - a[i])

    def inv(self, k, v, T0):
        T = T0
        for _ in range(60):
            e = self.at(k, T) - v
            d = (self.at(k, T + 0.5) - self.at(k, T - 0.5))
            dT = -e / d
            T += dT
            if abs(dT) < 1e-9:
                break
        return T


def isentropic(c, tab):
    """RK4 in ln p: dT / d ln p = R T / cp(T) (the mixture at x0)"""
    Tu = [c["T"][0]]
    g = lambda T: tab.at("Ru", T) * T / tab.at("cpu", T)
    for k in range(1, len(c["p"])):
        h = math.log(c["p"][k] / c["p"][k - 1])
        T = Tu[-1]
        k1 = g(T); k2 = g(T + 0.5 * h * k1); k3 = g(T + 0.5 * h * k2); k4 = g(T + h * k3)
        Tu.append(T + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6)
    return Tu


def wiebe(a, dur):
    return 0.0 if a <= 0 else 1.0 if a >= dur else 1 - math.exp(-5 * (a / dur) ** 3)


def lw(c, p, Tu, rpm, on, xend=0.9):
    uign = ((c["ign"] - c["ivc"]) % 720 + 720) % 720
    uend = uign + c["dur"] * (math.log(1 / (1 - xend)) / 5) ** (1 / 3)
    I = 0.0
    u = c["u"]
    for k in range(1, len(u)):
        if u[k - 1] >= uend:
            break
        u1 = min(u[k], uend)
        f = (u1 - u[k - 1]) / (u[k] - u[k - 1])
        p1 = p[k - 1] + f * (p[k] - p[k - 1]); T1 = Tu[k - 1] + f * (Tu[k] - Tu[k - 1])
        I += (u1 - u[k - 1]) / (6 * rpm) / tau(on, 0.5 * (p[k - 1] + p1), 0.5 * (Tu[k - 1] + T1))
    return I, T1


def two_zone(c, tab, Q):
    """from the IVC state: unburned (x0) adiabatic, burned (x = 0) zone, one pressure; xb the Wiebe; V the model's"""
    u, V = c["u"], c["V"]
    uign = ((c["ign"] - c["ivc"]) % 720 + 720) % 720
    p0, T0 = c["p"][0], c["T"][0]
    m = p0 * V[0] / (tab.at("Ru", T0) * T0)
    p, Tu, Tb = [p0], [T0], [float("nan")]
    U = m * tab.at("eu", T0)
    xb0 = 0.0
    for k in range(1, len(u)):
        xb = wiebe(u[k] - uign, c["dur"])
        dV = V[k] - V[k - 1]
        mu, mb = m * (1 - xb), m * xb

        def tu_of(pn):
            # isentropic step (RK4 in ln p), the unburned zone's own law
            h = math.log(pn / p[-1]); g = lambda T: tab.at("Ru", T) * T / tab.at("cpu", T); T = Tu[-1]
            k1 = g(T); k2 = g(T + 0.5 * h * k1); k3 = g(T + 0.5 * h * k2); k4 = g(T + h * k3)
            return T + h * (k1 + 2 * k2 + 2 * k3 + k4) / 6

        def resid(pn):
            Un = U - 0.5 * (p[-1] + pn) * dV + Q * (xb - xb0)
            tu = tu_of(pn)
            if mb > 1e-12 * m:
                tb = tab.inv("eb", (Un - mu * tab.at("eu", tu)) / mb, Tb[-1] if Tb[-1] == Tb[-1] else 2500.0)
                vol = (mu * tab.at("Ru", tu) * tu + mb * tab.at("Rb", tb) * tb) / pn
            else:
                tb = float("nan")
                # no burned mass: one zone, its energy fixes T (and must equal the isentropic tu)
                T1 = tab.inv("eu", Un / m, tu)
                vol = m * tab.at("Ru", T1) * T1 / pn
            return vol - V[k], tu, tb, Un

        a = p[-1] * (V[k - 1] / V[k]) ** 1.3
        b = a * 1.001
        ra, rb = resid(a)[0], resid(b)[0]
        for _ in range(80):
            if rb == ra:
                break
            cN = b - rb * (b - a) / (rb - ra)
            a, ra = b, rb
            b = cN
            rb = resid(b)[0]
            if abs(rb) < 1e-14 * V[k]:
                break
        _, tu, tb, Un = resid(b)
        p.append(b); Tu.append(tu); Tb.append(tb); U = Un; xb0 = xb
    return p, Tu, Tb


def main():
    res = {"synthetic": synthetic()}
    for k, v in res["synthetic"].items():
        print("synthetic", k, "%.10g" % v)
    inp = json.load(open(os.path.join(HERE, "results", "knock_ref_in.json")))
    rpm, on = inp["rpm"], inp["ON"]
    for name, c in inp["cases"].items():
        tab = Tab(c["tab"], ["eu", "cpu", "Ru", "eb", "cpb", "Rb", "emid"])
        # the mixing of the gas between x0 and 0: is e linear in x (the single zone's assumption here)?
        lin = max(abs(tab.at("emid", T) - 0.5 * (tab.at("eu", T) + tab.at("eb", T))) / abs(tab.at("eb", T) - tab.at("eu", T) + 1e-30) for T in range(300, 3400, 50))
        Tu = isentropic(c, tab)
        dT = max(abs(a - b) for a, b in zip(Tu, c["TuJS"]))
        Ipy, TuE = lw(c, c["p"], Tu, rpm, on)
        r = {"lin_e_max_rel": lin, "isentropic_max_dT_vs_js_K": dT, "I_py_same_p": Ipy, "I_js": c["IJS"]["I"], "TuEnd_py": TuE, "TuEnd_js": c["IJS"]["TuEnd"]}
        print(name, "e linear in x within %.2e;" % lin, "isentropic Tu: Python RK4 vs knockLib max %.4f K;" % dT, "I Python %.6f vs knockLib %.6f" % (Ipy, c["IJS"]["I"]))
        if name == "adiabatic":
            # the heat released from the model's own adiabatic run: U_end - U_ivc + integral p dV, U = m e(T, x) at the ends
            m = c["p"][0] * c["V"][0] / (tab.at("Ru", c["T"][0]) * c["T"][0])
            uign = ((c["ign"] - c["ivc"]) % 720 + 720) % 720
            kend = max(i for i, uu in enumerate(c["u"]) if uu <= uign + c["dur"] + 2)
            W = sum(0.5 * (c["p"][i] + c["p"][i - 1]) * (c["V"][i] - c["V"][i - 1]) for i in range(1, kend + 1))
            Q = m * tab.at("eb", c["T"][kend]) - m * tab.at("eu", c["T"][0]) + W
            p2, Tu2, Tb2 = two_zone(c, tab, Q)
            I2, Tu2E = lw(c, p2, Tu2, rpm, on)
            Tu1on2 = isentropic(dict(c, p=p2), tab)
            uend = uign + c["dur"] * (math.log(10) / 5) ** (1 / 3)
            kk = [i for i, uu in enumerate(c["u"]) if uu <= uend]
            dp = max(abs(p2[i] / c["p"][i] - 1) for i in kk)
            pmax1, pmax2 = max(c["p"][i] for i in kk), max(p2[i] for i in kk)
            r.update({"Q_J": Q, "m_kg": m, "two_zone_I": I2, "two_zone_TuEnd": Tu2E, "single_zone_I": Ipy, "max_rel_dp_to_mfb90": dp, "pmax_single": pmax1, "pmax_two": pmax2,
                      "Tb_at_mfb90": Tb2[kk[-1]]})
            print("  two-zone (same IVC state, burn, volume, gas): I %.4f against the single-zone pressure + isentropic %.4f (%.1f %%); Tu at MFB90 %.1f vs %.1f K;"
                  " pressure differs by at most %.2f %% to MFB90; peak %.2f vs %.2f bar; Tb at MFB90 %.0f K" % (I2, Ipy, 100 * (Ipy / I2 - 1), Tu2E, TuE, 100 * dp, pmax2 / 1e5, pmax1 / 1e5, Tb2[kk[-1]]))
        res[name] = r
    json.dump(res, open(os.path.join(HERE, "results", "knock_ref.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
