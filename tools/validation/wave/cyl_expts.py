#!/usr/bin/env python3
"""cyl_expts.py - the cylinder, like for like: the page's wave model against OpenWAM on the same engine, part by part
(docs/WAVE_VALIDATION_2026-11-11.md, part 3, C6). For each configuration and speed of compare.py's matrix:

  1. the valves' effective areas each code actually used, against crank angle (OpenWAM's instantaneous valve CD x the
     pipe-end area it is referred to; the wave model's CdA(theta)): largest difference, and the opening and closing
     angles (where the area passes 1 % of its peak);
  2. the trapped charge at intake closing (mass, temperature, pressure) and OpenWAM's own fresh-charge VE;
  3. the burn: the angles at which 10, 50 and 90 % has burned in each code;
  4. the closed cycle (IVC to EVO) work, OpenWAM's from its own trace, the wave model's from its run, and the wave model's
     cylinder run again from OpenWAM's IVC state (cyl_trace.js), which separates what the cylinder does with a charge
     from how much charge it gets.

    python3 tools/validation/wave/cyl_expts.py [configs=single_L800,i4_41] [rpms=a,b] [tag=c6]
Results: tools/validation/wave/results/cyl_<tag>.json. OpenWAM runs go under WAMVAL_SCRATCH as compare.py's do.
"""
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import compare   # noqa: E402

RES = os.path.join(HERE, "results")


def cols(path):
    head, data = compare.read_table(path)
    return head, {h: [r[i] for r in data] for i, h in enumerate(head)}


def find(head, *keys):
    for h in head:
        if all(k.lower() in h.lower() for k in keys):
            return h
    return None


def interp(th, y, x):
    """y at angle x on a cycle trace th (unordered, 0-720)."""
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


def unwrap_from(th, a0):
    return [((t - a0) % 720.0) for t in th]


def closed_work(th, p, v, ivc, evo):
    """p dV from IVC to EVO (through firing TDC at 0/720), trapezoid over the samples in order of angle."""
    pts = sorted(zip(unwrap_from(th, ivc), p, v))
    span = (evo - ivc) % 720.0
    pts = [q for q in pts if q[0] <= span]
    return sum(0.5 * (pts[k][1] + pts[k + 1][1]) * (pts[k + 1][2] - pts[k][2]) for k in range(len(pts) - 1))


def burn_angles(th, xb, ign):
    """angles after ignition at which 10, 50, 90 % has burned (the burned fraction rising from 0 after ignition)."""
    pts = sorted(zip(unwrap_from(th, ign), xb))
    out = []
    for f in (0.1, 0.5, 0.9):
        a = next((pts[k][0] + (f - pts[k][1]) / (pts[k + 1][1] - pts[k][1]) * (pts[k + 1][0] - pts[k][0])
                  for k in range(len(pts) - 1) if pts[k][1] < f <= pts[k + 1][1] and pts[k][0] < 200), None)
        out.append(a)
    return out


def edges(th, a, frac=0.01):
    """opening and closing angles: where the area first rises above and last falls below frac x its peak."""
    pk = max(a)
    on = [t for t, x in sorted(zip(th, a)) if x > frac * pk]
    if not on:
        return None, None
    # the open period may wrap through 0/720: take the longest run
    srt = sorted(on)
    gaps = [(srt[(k + 1) % len(srt)] - srt[k]) % 720.0 for k in range(len(srt))]
    k = max(range(len(gaps)), key=lambda q: gaps[q])
    return srt[(k + 1) % len(srt)], srt[k]


def main(argv):
    o = {"configs": "single_L800,i4_41", "tag": "c6", "rpms": "", "cycles": "12"}
    for a in argv[1:]:
        k, v = a.split("=", 1)
        o[k] = v
    out = {}
    for cfg in o["configs"].split(","):
        build, rpms, dx = compare.CONFIGS[cfg]
        if o["rpms"]:
            rpms = [int(x) for x in o["rpms"].split(",")]
        spec = build()
        rows = []
        for rpm in rpms:
            wm = compare.wam_one(cfg, spec, rpm, {})
            head, C = cols(os.path.join(wm["folder"], "caseINS.DAT"))
            ah, ad = compare.read_table(os.path.join(wm["folder"], "caseAVG.DAT"))
            avg = {h: ad[-1][i] for i, h in enumerate(ah)}
            th = wm["trace"]["th"]
            kP, kT, kM, kV = find(head, "pressure_cyl_1"), find(head, "temperature_cyl_1"), find(head, "mass_cyl_1"), find(head, "volume_cyl_1")
            kX = find(head, "hrl_cyl_1")          # OpenWAM's heat release law: the burned fraction
            cdIn = [h for h in head if h.lower().startswith("inflow_discharge_coef")]    # the intake valve's CD (pipe to cylinder)
            cdEx = [h for h in head if h.lower().startswith("outflow_discharge_coef")]   # the exhaust valve's CD (cylinder to pipe)
            # the wave model's run and its cylinder from OpenWAM's IVC state
            jf = os.path.join(compare.SCRATCH, "wave", "%s_%d_cyl_job.json" % (cfg, rpm))
            of = os.path.join(compare.SCRATCH, "wave", "%s_%d_cyl_out.json" % (cfg, rpm))
            os.makedirs(os.path.dirname(jf), exist_ok=True)
            first = {"spec": spec, "rpm": rpm, "dx": dx, "cycles": int(o["cycles"])}
            with open(jf, "w") as f:
                json.dump(first, f)
            subprocess.run(["node", os.path.join(HERE, "cyl_trace.js"), jf, of], check=True)
            with open(of) as f:
                wv = json.load(f)
            ivc, evo, ign = wv["ivcDeg"], wv["evoDeg"], wv["ign"]
            pw = [x * 1e5 for x in C[kP]]
            Tw = [x + 273.15 for x in C[kT]] if kT else None
            mw = C[kM] if kM else None
            vw = C[kV]
            s = {"p": interp(th, pw, ivc), "T": interp(th, Tw, ivc) if Tw else None, "m": interp(th, mw, ivc) if mw else None, "V": interp(th, vw, ivc)}
            # OpenWAM's charge at IVC: its cylinder mass holds air and residual but not yet the fuel (its SI model takes the
            # fuel from the trapped air, 1/AFR of it); the trapped air is its trapped-fresh VE x the reference density x Vd.
            # The wave model's fresh charge is air with its fuel vapour, so the like-for-like start state is OpenWAM's mass
            # plus that fuel, at OpenWAM's temperature, releasing OpenWAM's heat (Qcomb, per cycle)
            rho_ref = 101325.0 / (287.1 * 298.15)
            mair = wm["ve"] * rho_ref * wv["Vd"]
            mfuel = mair / spec["e"]["afr"]
            resid_wam = (s["m"] - mair) / s["m"] if s["m"] else None
            m_eq = s["m"] + mfuel if s["m"] else None
            x_wam = (mair + mfuel) / m_eq if m_eq else None
            starts = []
            if s["m"] and s["T"]:
                starts = [{"label": "openwam_ivc", "m": m_eq, "T": s["T"], "x": x_wam, "burnQ": wm["Qcomb"]},
                          {"label": "openwam_ivc_wave_T", "m": m_eq, "T": wv["ivc"]["T"], "x": x_wam, "burnQ": wm["Qcomb"]},
                          # OpenWAM's pressure and temperature at IVC (so the same p V / T), the wave model's own composition, OpenWAM's heat
                          {"label": "openwam_pT", "m": s["p"] * s["V"] / ((wv["Rburnt"] + wv["ivc"]["x"] * (wv["Rfresh"] - wv["Rburnt"])) * s["T"]), "T": s["T"], "x": wv["ivc"]["x"], "burnQ": wm["Qcomb"]},
                          {"label": "wave_ivc_openwam_heat_per_charge", "m": wv["ivc"]["m"], "T": wv["ivc"]["T"], "x": wv["ivc"]["x"],
                           "burnQ": wm["Qcomb"] * (wv["ivc"]["fresh"] / (mair + mfuel))}]
                first["starts"] = starts
                with open(jf, "w") as f:
                    json.dump(first, f)
                subprocess.run(["node", os.path.join(HERE, "cyl_trace.js"), jf, of], check=True)
                with open(of) as f:
                    wv = json.load(f)
            Wwam = closed_work(th, pw, vw, ivc, evo)
            tr = wv["trace"]
            # areas: OpenWAM's CD referred to its pipe-end area; the area is in the .wam (the runner's / primary's end)
            area = {}
            for side, keys, wa in (("in", cdIn, tr["cdaIn"]), ("ex", cdEx, tr["cdaEx"])):
                if not keys:
                    continue
                cdw = C[keys[0]]
                d = spec["intake"]["segs"][-1]["d1"] if side == "in" else spec["exhaust"]["segs"][0]["d0"]
                ap = math.pi / 4 * d * d
                aw = [c * ap for c in cdw]
                pk = max(wa)
                dif = max(abs(interp(th, aw, t) - a) for t, a in zip(tr["th"], wa)) / pk
                area[side] = {"column": keys[0], "peakWave": pk, "peakWam": max(aw), "maxDiffOfPeak": dif,
                              "edgesWave": edges(tr["th"], wa), "edgesWam": edges(th, aw)}
            row = {"rpm": rpm, "wam": {"ve": wm["ve"], "nmep": wm["nmep"], "ivc": s, "Rivc": s["p"] * s["V"] / (s["m"] * s["T"]) if s["m"] and s["T"] else None, "xIvc": x_wam, "mAir": mair, "residual": resid_wam, "Wclosed": Wwam,
                                       "Qcomb": wm["Qcomb"], "Qwall": wm["Qwall"],
                                       "burn": burn_angles(th, C[kX], ign) if kX else None},
                   "wave": {"ve": wv["ve"], "nmep": wv["imep"], "ivc": wv["ivc"], "Wclosed": wv["closedRun"]["W"], "Qclosed": wv["closedRun"]["Q"],
                            "qwClosed": wv["closedRun"]["qw"], "burn": burn_angles(tr["th"], tr["xb"], ign), "starts": wv["starts"]},
                   "areas": area, "columns": {"p": kP, "T": kT, "m": kM, "V": kV, "xb": kX, "cdIn": cdIn, "cdEx": cdEx}}
            rows.append(row)
            st = {q["label"]: q["W"] for q in wv["starts"]}
            print("%s %d rpm: closed-cycle work wave %.2f J, OpenWAM %.2f J (ratio %.3f); wave from OpenWAM's IVC state %s | IVC m wave %.4g / wam %s kg, T %.1f / %s K | "
                  "areas: %s | burn 10/50/90 wave %s wam %s" % (
                      cfg, rpm, wv["closedRun"]["W"], Wwam, wv["closedRun"]["W"] / Wwam,
                      ", ".join("%s %.2f (%.3f)" % (k, v, v / Wwam) for k, v in st.items()),
                      wv["ivc"]["m"], "%.4g" % s["m"] if s["m"] else "?", wv["ivc"]["T"], "%.1f" % s["T"] if s["T"] else "?",
                      "; ".join("%s peak %.4g / %.4g m2, max diff %.3f of peak, edges %s / %s" % (k, a["peakWave"], a["peakWam"], a["maxDiffOfPeak"], a["edgesWave"], a["edgesWam"]) for k, a in area.items()),
                      row["wave"]["burn"], row["wam"]["burn"]), flush=True)
        out[cfg] = rows
        os.makedirs(RES, exist_ok=True)
        with open(os.path.join(RES, "cyl_%s.json" % o["tag"]), "w") as f:
            json.dump(out, f, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv)
