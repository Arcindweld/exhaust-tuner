#!/usr/bin/env python3
"""cyl_phase.py - the closed cycle (IVC to EVO) of the wave model and of OpenWAM, phase by phase, against an independent
calculation (closed_cycle.py) from each code's own IVC state (docs/WAVE_VALIDATION_2026-11-11.md, addendum part 4, D2-D4).

    python3 tools/validation/wave/cyl_phase.py thermo.inp [configs=single_L800] [rpms=3000,5000,7000] [tag=d] [page=...]

For each speed: OpenWAM is run with its cylinder's Woschni coefficient, gas mass fractions, gamma and wall heat rates in its
instantaneous output (make_wam cyl_ins_extra 1); the wave model by cyl_trace.js (per step: p dV, heat released, wall heat
with its coefficient and area, gamma, cp, R). Both are split into compression (IVC to ignition), burn (the Wiebe's 55 deg) and
expansion (to EVO): p dV, wall heat, heat released. Then closed_cycle.py runs from the same IVC states with one choice changed
at a time: the gas (frozen NASA-9 products and premixed vapour / chemical equilibrium / OpenWAM's simple species model with
its injection during compression), the Woschni form (the model's Heywood form / Woschni's 1967 constants / OpenWAM's), the
motored pressure (a motored run / the codes' polytropic 1.32 or 1.36), the integration (RK4 / the wave model's explicit step).
Results: tools/validation/wave/results/cyl_<tag>.json.
"""
import json
import math
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare        # noqa: E402
import closed_cycle as cc   # noqa: E402

RES = os.path.join(HERE, "results")
FS_W = 0.068468349     # OpenWAM's stoichiometric fuel-air ratio (make_wam FS_GASOLINE_SIMPLE)


def cols(path):
    head, data = compare.read_table(path)
    return head, {h: [r[i] for r in data] for i, h in enumerate(head)}


def find(head, *keys):
    for h in head:
        if all(k.lower() in h.lower() for k in keys):
            return h
    return None


def phase_of(rel, ign_rel, dur):
    return "comp" if rel < ign_rel else ("burn" if rel < ign_rel + dur else "exp")


def wam_phases(C, head, th, ivc, evo, ign, dur, Qcomb):
    """OpenWAM's closed cycle from its INS samples (0.5 deg): trapezoid p dV, wall heat (its W rates x dt), heat released
    (Qcomb x the change of its HRL); split by phase at the sample midpoints"""
    kP, kV, kT, kX = find(head, "pressure_cyl_1"), find(head, "volume_cyl_1"), find(head, "temperature_cyl_1"), find(head, "hrl_cyl_1")
    kq = [find(head, "heat_cyl_head_cyl_1"), find(head, "heat_cylinder_cyl_1"), find(head, "heat_piston_cyl_1")]
    t = C["Time"] if "Time" in C else C[head[0]]
    span = (evo - ivc) % 720.0
    ign_rel = (ign - ivc) % 720.0
    rows = sorted((((a - ivc) % 720.0), k) for k, a in enumerate(th))
    rows = [r for r in rows if r[0] <= span + 1e-9]
    acc = {k: {"W": 0.0, "Qw": 0.0, "Qrel": 0.0} for k in ("comp", "burn", "exp")}
    for (r0, k0), (r1, k1) in zip(rows[:-1], rows[1:]):
        ph = phase_of(0.5 * (r0 + r1), ign_rel, dur)
        p0, p1 = C[kP][k0] * 1e5, C[kP][k1] * 1e5
        acc[ph]["W"] += 0.5 * (p0 + p1) * (C[kV][k1] - C[kV][k0])
        dt = (r1 - r0) / (6.0 * RPM[0])
        q0 = -sum(C[k][k0] for k in kq)
        q1 = -sum(C[k][k1] for k in kq)
        acc[ph]["Qw"] += 0.5 * (q0 + q1) * dt
        acc[ph]["Qrel"] += Qcomb * max(0.0, C[kX][k1] - C[kX][k0])     # its HRL drops back to 0 after the burn
    return acc


RPM = [0]


def wave_phases(tr, ivc, evo, ign, dur, k0):
    span = (evo - ivc) % 720.0
    ign_rel = (ign - ivc) % 720.0
    acc = {k: {"W": 0.0, "Qw": 0.0, "Qrel": 0.0} for k in ("comp", "burn", "exp")}
    steps = []
    for k in range(k0, len(tr["th"])):
        rel = (tr["th"][k] - ivc) % 720.0
        if rel >= span - 1e-9 and k > k0:
            break
        ph = phase_of(rel + 0.5 * tr["dth"][k], ign_rel, dur)
        acc[ph]["W"] += tr["pdV"][k]
        acc[ph]["Qw"] += tr["qw"][k]
        acc[ph]["Qrel"] += tr["Q"][k]
        steps.append((tr["th"][k], tr["dth"][k], tr["dt"][k]))
    return acc, steps


def tot(acc, k="W"):
    return sum(acc[p][k] for p in acc)


def fmt(acc):
    return " | ".join("%s W %.1f Qw %.1f Q %.1f" % (p, acc[p]["W"], acc[p]["Qw"], acc[p]["Qrel"]) for p in ("comp", "burn", "exp"))


def main(argv):
    thermo = argv[1]
    o = {"configs": "single_L800", "tag": "d", "rpms": "3000,5000,7000", "cycles": "12", "fast": "0"}
    for a in argv[2:]:
        k, v = a.split("=", 1)
        o[k] = v
    TH = cc.Thermo(thermo)
    out = {}
    for cfg in o["configs"].split(","):
        build, _, dx = compare.CONFIGS[cfg]
        spec = build()
        e = spec["e"]
        rows = []
        for rpm in [int(x) for x in o["rpms"].split(",")]:
            RPM[0] = rpm
            wm = compare.wam_one(cfg, spec, rpm, {"cyl_ins_extra": 1})
            head, C = cols(os.path.join(wm["folder"], "caseINS.DAT"))
            th = wm["trace"]["th"]
            jf = os.path.join(compare.SCRATCH, "wave", "%s_%d_phase_job.json" % (cfg, rpm))
            of = os.path.join(compare.SCRATCH, "wave", "%s_%d_phase_out.json" % (cfg, rpm))
            os.makedirs(os.path.dirname(jf), exist_ok=True)
            with open(jf, "w") as f:
                json.dump({"spec": spec, "rpm": rpm, "dx": dx, "cycles": int(o["cycles"])}, f)
            subprocess.run(["node", os.path.join(HERE, "cyl_trace.js"), jf, of], check=True)
            with open(of) as f:
                wv = json.load(f)
            ivc, evo, ign, dur = wv["ivcDeg"], wv["evoDeg"], wv["ign"], e["burn"]["dur"]
            tr = wv["trace"]
            wacc, steps = wave_phases(tr, ivc, evo, ign, dur, wv["ivc"]["k"])
            oacc = wam_phases(C, head, th, ivc, evo, ign, dur, wm["Qcomb"])
            # OpenWAM's IVC state (its samples interpolated to the wave model's IVC angle)
            interp = lambda key: cyl_interp(th, C[find(head, *key)], ivc)
            pw, Tw_, mw = interp(("pressure_cyl_1",)) * 1e5, interp(("temperature_cyl_1",)) + 273.15, interp(("mass_cyl_1",))
            Yb, Ya = interp(("y_gasesquemados",)), interp(("y_aire",))
            mair = mw * Ya
            mfuel = mair / e["afr"]          # = its air x phi x FS (make_wam's phi = (1/AFR) / FS)
            geom = {"bore": e["bore"], "stroke": e["stroke"], "rod": e["rod"], "cr": e["cr"], "rpm": rpm, "ivc": ivc, "evo": evo,
                    "ign": ign, "dur": dur, "afr": e["afr"], "Twall": e.get("Twall") or 450.0, "thermo": TH}
            ch = cc.Charge(TH, e["afr"])
            geom["_charge"] = ch
            wst = dict(geom, m=wv["ivc"]["m"], T=wv["ivc"]["T"], x=wv["ivc"]["x"], Q=wv["ivc"]["burnQ"])
            ost = dict(geom, m=mw + mfuel, T=Tw_, x=(mair + mfuel) / (mw + mfuel), Q=wm["Qcomb"])
            orep = dict(geom, m=mw, T=Tw_, x=1 - Yb, Q=wm["Qcomb"], mfuel=mfuel, mfuel0=0.0, mtrap=mw,
                        inj_deg=(720.0 + e["burn"]["start"] - ivc) / 2.0)
            R = {}
            t0 = time.time()
            # the wave model's own state and heat
            R["wave_state:frozen,heywood,pm1.32"] = cc.run(wst, "frozen", "heywood", 1.32)
            R["wave_state:euler_on_wave_steps,heywood,pm1.32"] = cc.euler_wave(wst, steps, "heywood", 1.32)
            R["wave_state:frozen,heywood,motored"] = cc.run(wst, "frozen", "heywood", "motored")
            R["wave_state:frozen,woschni67,motored"] = cc.run(wst, "frozen", "woschni67", "motored")
            R["wave_state:frozen,none"] = cc.run(wst, "frozen", "none")
            R["wave_state:frozen,openwam,pm1.36"] = cc.run(dict(wst, mtrap=wst["m"]), "frozen", "openwam", 1.36)
            # OpenWAM's own state and heat
            R["wam_state:openwam_gas,openwam,pm1.36"] = cc.run(orep, "openwam", "openwam", 1.36)
            R["wam_state:openwam_gas,heywood,pm1.32"] = cc.run(orep, "openwam", "heywood", 1.32)
            R["wam_state:openwam_gas,none"] = cc.run(orep, "openwam", "none")
            # OpenWAM's gas, one of its choices changed at a time (its Woschni kept)
            prem = dict(orep, m=mw + mfuel, x=(mair + mfuel) / (mw + mfuel), mfuel0=mfuel, inj_deg=0.0)
            R["wam_state:openwam_gas[premixed fuel],openwam,pm1.36"] = cc.run(prem, "openwam", "openwam", 1.36)
            R["wam_state:openwam_gas[all fuel burned],openwam,pm1.36"] = cc.run(dict(orep, wam_burn_all=True), "openwam", "openwam", 1.36)
            R["wam_state:openwam_gas[premixed, all burned],openwam,pm1.36"] = cc.run(dict(prem, wam_burn_all=True), "openwam", "openwam", 1.36)
            R["wam_state:openwam_gas[premixed, all burned, + composition term],openwam,pm1.36"] = cc.run(dict(prem, wam_burn_all=True, wam_consistent=True), "openwam", "openwam", 1.36)
            R["wam_state:openwam_gas[+ composition term],openwam,pm1.36"] = cc.run(dict(orep, wam_consistent=True), "openwam", "openwam", 1.36)
            R["wam_state:openwam_gas[premixed, + composition term],openwam,pm1.36"] = cc.run(dict(prem, wam_consistent=True), "openwam", "openwam", 1.36)
            # OpenWAM's Wiebe stops at 1 - exp(-5) = 0.99326 of its heat (its HRL ends at 0.9924-0.9933); the wave model and
            # this script burn the rest at the end of the duration: the same heat in, spread over the burn
            R["wam_state:openwam_gas[premixed, + composition term, full heat],openwam,pm1.36"] = cc.run(dict(prem, wam_consistent=True, Q=wm["Qcomb"] / (1 - math.exp(-5))), "openwam", "openwam", 1.36)
            R["wam_state:frozen,openwam,pm1.36"] = cc.run(dict(ost, mtrap=mw), "frozen", "openwam", 1.36)
            # NASA properties, consistent energy, but OpenWAM's composition: stoichiometric products of the fuel it burns
            # (beta = its heat / (fuel x LHV)), the rest of the fuel as vapour, the rest of the air as air
            beta = wm["Qcomb"] / (mfuel * 44e6)
            R["wam_state:frozen[OpenWAM's composition],openwam,pm1.36"] = cc.run(dict(ost, mtrap=mw, _charge=cc.Charge(TH, e["afr"], beta=beta)), "frozen", "openwam", 1.36)
            R["wam_state:frozen,heywood,pm1.32"] = cc.run(ost, "frozen", "heywood", 1.32)
            R["wam_state:frozen,heywood,motored"] = cc.run(ost, "frozen", "heywood", "motored")
            R["wam_state:frozen,none"] = cc.run(ost, "frozen", "none")
            if o["fast"] != "1":
                R["wave_state:equil,heywood,pm1.32"] = cc.run(wst, "equil", "heywood", 1.32, dth=0.25)
                R["wave_state:equil,none"] = cc.run(wst, "equil", "none", dth=0.25)
                R["wam_state:equil,heywood,pm1.32"] = cc.run(ost, "equil", "heywood", 1.32, dth=0.25)
                R["wam_state:equil,none"] = cc.run(ost, "equil", "none", dth=0.25)
            el = time.time() - t0
            Wwave, Wwam = tot(wacc), tot(oacc)
            print("\n%s %d rpm (independent runs %.0f s): closed-cycle work wave %.2f J, OpenWAM %.2f J, ratio %.4f" % (cfg, rpm, el, Wwave, Wwam, Wwave / Wwam))
            print("  wave    : " + fmt(wacc))
            print("  OpenWAM : " + fmt(oacc))
            print("  IVC: wave m %.5g kg T %.1f K x %.4f Q %.1f J | OpenWAM m %.5g (+ fuel %.4g) T %.1f K Yb %.4f Q %.1f J" % (
                wst["m"], wst["T"], wst["x"], wst["Q"], mw, mfuel, Tw_, Yb, wm["Qcomb"]))
            for k, r in R.items():
                ref = Wwave if k.startswith("wave_state") else Wwam
                extra = (" | " + fmt(r["phases"])) if "phases" in r else ""
                print("  %-48s W %8.2f J (%.4f of that code's own) Qw %7.2f%s" % (k, r["W"], r["W"] / ref, r["Qw"], extra))
            for r in R.values():
                r.pop("trace", None)
            rows.append({"rpm": rpm, "angles": {"ivc": ivc, "evo": evo, "ign": ign}, "wave": {"phases": wacc, "W": Wwave, "ivc": wv["ivc"], "Qw": tot(wacc, "Qw")},
                         "wam": {"phases": oacc, "W": Wwam, "ivc": {"p": pw, "T": Tw_, "m": mw, "Yb": Yb, "Ya": Ya, "mfuel": mfuel},
                                 "Qcomb": wm["Qcomb"], "Qw": tot(oacc, "Qw"), "nmep": wm["nmep"]},
                         "indep": {k: {kk: vv for kk, vv in r.items() if kk not in ("U0", "Uend")} for k, r in R.items()}})
        out[cfg] = rows
    os.makedirs(RES, exist_ok=True)
    with open(os.path.join(RES, "cyl_%s.json" % o["tag"]), "w") as f:
        json.dump(out, f, separators=(",", ":"))


def cyl_interp(th, y, x):
    pts = sorted(zip(th, y))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    xs = [xs[-1] - 720.0] + xs + [xs[0] + 720.0]
    ys = [ys[-1]] + ys + [ys[0]]
    for j in range(len(xs) - 1):
        if xs[j] <= x <= xs[j + 1]:
            t = (x - xs[j]) / (xs[j + 1] - xs[j]) if xs[j + 1] > xs[j] else 0.0
            return ys[j] + t * (ys[j + 1] - ys[j])
    return float("nan")


if __name__ == "__main__":
    main(sys.argv)
