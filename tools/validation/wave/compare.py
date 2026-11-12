#!/usr/bin/env python3
"""compare.py - the page's wave model against OpenWAM on a matrix of engines, like for like.

    python3 tools/validation/wave/compare.py [configs=a,b] [tag=base] [page=path] [wave=0|1] [wam=0|1] [k=v ...]

Each configuration is one engine spec in the page's simSpec form (SI units), which both the wave model (engine.js) and
OpenWAM's writer (openwam/make_wam.py) read, so the two codes get the same geometry, valve lift and flow-area law,
cam timing, Wiebe burn, heat release (OpenWAM's combustion efficiency set to the wave model's eta), cylinder wall
temperature, pipe wall temperatures and initial gas temperatures. Run settings that make OpenWAM like the wave model:
open_end_corr 0 (the wave model has no radiation end correction), 10 mm cells, TVD scheme, 30 cycles; the wave model
runs each speed from a cold start for `cycles` cycles at the page's grid (10 mm, 12.5 mm with a collector).
Tags switch one thing in both codes for the mechanism experiments:
  base      as above; the wave model with its default gas (temperature- and composition-dependent, 2026-11-12)
  const     the wave model with its constant-gamma gas (spec.e.gas 'const', gamma 1.35, R 287: base before 2026-11-12)
  nofric    no pipe friction and no pipe wall heat transfer in either code
  endcorr   OpenWAM with its 0.6133 r open-end correction (the writer's default), wave unchanged
  gamma14   OpenWAM with constant gamma (its gamma_model 0), wave at constant gamma 1.35
  gamma14b  OpenWAM with constant gamma (gamma_model 0) and the wave model at constant gamma 1.4: the gas properties alike
  gamma130w OpenWAM as base, the wave model at constant gamma 1.30 (the sensitivity of its work to the gas's gamma)
  before    the wave model of the page before this validation's fixes (page=...), OpenWAM as base (reuses its runs)
  endp      a candidate page (page=...) against the base OpenWAM runs, before it replaces the page
Results: tools/validation/wave/results/<tag>.json (metrics per configuration and speed, and the traces).
OpenWAM: EXHAUST_TUNER_OPENWAM (else ext/OpenWAM/build/bin/release/OpenWAM next to the repository). Scratch folders go
under WAMVAL_SCRATCH (default /tmp/wamval) and can be deleted afterwards.
"""
import copy
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "openwam"))
import cases       # noqa: E402
import make_wam    # noqa: E402
import run_models  # noqa: E402

SCRATCH = os.environ.get("WAMVAL_SCRATCH", "/tmp/wamval")
RES = os.path.join(HERE, "results")
P_REF = 2e-5


# ---------------------------------------------------------------- configurations
def single(L, extra=None):
    s = cases.i4_single_cyl()
    s["exhaust"]["segs"] = extra or [{"L": L, "d0": 0.0445, "d1": 0.0445}]
    s["opt"] = {"phases": [0.0]}
    return s


def v8_line(xpipe):
    """Cross-plane V8 (cases.v8_dual's engine), each bank's 4-1 merging into a 63.5 mm (2.5 in) line: 150 mm cone from
    the merge, 500 mm to the crossover point, 1000 mm on to the tip. xpipe: an X joining the two lines 650 mm from the
    merges (one four-way node)."""
    s = cases.v8_dual()
    line = [{"L": 0.15, "d0": 0.089, "d1": 0.0635}, {"L": 0.5, "d0": 0.0635, "d1": 0.0635}, {"L": 1.0, "d0": 0.0635, "d1": 0.0635}]
    for c in s["opt"]["collectors"]:
        c["segs"] = copy.deepcopy(line)
    if xpipe:
        s["opt"]["crossover"] = {"type": "x", "pos": [0.65, 0.65]}
    return s


def wam_spec(s):
    """The same engine in the form OpenWAM's writer takes where the two differ: an X crossover is written as each
    collector's line up to the X plus a tail after it (opt.crossover {cols, type, tails})."""
    w = copy.deepcopy(s)
    xo = w["opt"].get("crossover")
    if xo:
        tails = []
        for k, c in enumerate(w["opt"]["collectors"]):
            pos, before, after, x = xo["pos"][k], [], [], 0.0
            for sg in c["segs"]:
                if x + sg["L"] <= pos + 1e-9:
                    before.append(sg)
                elif x >= pos - 1e-9:
                    after.append(sg)
                else:
                    raise ValueError("the crossover must sit on a segment boundary here")
                x += sg["L"]
            c["segs"] = before
            tails.append([{"L_mm": sg["L"] * 1000, "d0_mm": sg["d0"] * 1000, "d1_mm": sg["d1"] * 1000} for sg in after])
        w["opt"]["crossover"] = {"cols": [0, 1], "type": xo["type"], "tails": tails}
    w["e"]["combEff"] = w["e"]["eta"]
    return w


SINGLE_RPM = [3000, 4000, 5000, 6000, 7000, 8000]
CONFIGS = {
    "single_L400": (lambda: single(0.4), SINGLE_RPM, 0.01),
    "single_L800": (lambda: single(0.8), SINGLE_RPM, 0.01),
    "single_L1200": (lambda: single(1.2), SINGLE_RPM, 0.01),
    "single_muffler": (lambda: single(None, [{"L": 0.5, "d0": 0.0445, "d1": 0.0445}, {"L": 0.3, "d0": 0.127, "d1": 0.127},
                                             {"L": 0.6, "d0": 0.0445, "d1": 0.0445}]), SINGLE_RPM, 0.01),
    "i4_41": (cases.i4_41, [2500, 3500, 4500, 5500, 6500, 7500], 0.0125),
    "v8_2x41": (cases.v8_dual, [2000, 2900, 3800, 4700, 5600, 6500], 0.0125),
    "v8_line": (lambda: v8_line(False), [2000, 2900, 3800, 4700, 5600, 6500], 0.0125),
    "v8_line_X": (lambda: v8_line(True), [2000, 2900, 3800, 4700, 5600, 6500], 0.0125),
}
# tag: (OpenWAM overrides, wave Fanning factor, wave constant gamma, wave gas: None = the page's default, 'const')
TAGS = {
    "base": ({}, None, None, None),
    "const": ({}, None, None, "const"),
    "nofric": ({"pipe_fric_mult": 0.0, "pipe_htc_mult": 0.0}, 0.0, None, None),
    "nofricconst": ({"pipe_fric_mult": 0.0, "pipe_htc_mult": 0.0}, 0.0, None, "const"),
    "endcorr": ({"open_end_corr": 1}, None, None, None),
    "gamma14": ({"gamma_model": 0}, None, None, "const"),
    "gamma14b": ({"gamma_model": 0}, None, 1.4, "const"),
    "gamma130w": ({}, None, 1.30, "const"),
    "before": ({}, None, None, None),
    "endp": ({}, None, None, None),
}


# ---------------------------------------------------------------- OpenWAM side
def read_table(path):
    with open(path) as f:
        rows = [ln.rstrip("\n").split("\t") for ln in f if ln.strip()]
    return rows[0], [[float(x) for x in r] for r in rows[1:]]


def wam_one(name, spec, rpm, over, cycles=30):
    folder = os.path.join(SCRATCH, "wam", "%s_%d_%s" % (name, rpm, "_".join("%s%s" % kv for kv in sorted(over.items())) or "base"))
    os.makedirs(folder, exist_ok=True)
    run = dict({"rpm": float(rpm), "cycles": cycles, "name": "case", "open_end_corr": 0, "ins_outlet": 1, "out_step_deg": 0.5}, **over)
    model = make_wam.model_from_spec(wam_spec(spec), run)
    run_models.write_and_run(folder, "case", model)
    s = run_models.summarise(folder, "case", model)
    head, data = read_table(os.path.join(folder, "caseINS.DAT"))
    ix = {h: i for i, h in enumerate(head)}
    col = lambda k: [r[ix[k]] for r in data]
    pipes = model["pipes"]
    prim = next(i for i, p in enumerate(pipes) if p["role"] in ("cylinder 1 exhaust primary", "cylinder 1 exhaust primary part 1"))
    after = next((i for i, p in enumerate(pipes) if p["role"].startswith("collector")), None)
    ang, vol, pc = col("Angle(deg)"), col("Volume_Cyl_1(m^3)"), col("Pressure_Cyl_1(bar)")
    # cylinder 1's firing TDC: the smallest volume within a quarter cycle of the cycle's pressure peak. Until 2026-11-12
    # this took the highest pressure among the samples within 1e-6 of the smallest volume; when the output grid missed the
    # firing TDC by a fraction of a degree only the gas-exchange TDC qualified, and 22 of the 48 runs were compared 360
    # degrees out of phase (docs/WAVE_VALIDATION_2026-11-11.md, addendum 2026-11-12)
    kpk = max(range(len(pc)), key=lambda k: pc[k])
    near = [k for k in range(len(vol)) if min(abs(ang[k] - ang[kpk]) % 720.0, 720.0 - abs(ang[k] - ang[kpk]) % 720.0) <= 90.0]
    k0 = min(near, key=lambda k: vol[k])
    th = [((a - ang[k0]) % 720.0) for a in ang]
    port = [k for k in head if k.startswith("P_duct_%d_at_" % (prim + 1))][0]
    runner = next(i for i, p in enumerate(pipes) if p["role"] == "cylinder 1 intake runner")
    pin = [k for k in head if k.startswith("P_duct_%d_at_" % (runner + 1))][0]
    tr = {"th": th, "pCyl": [x * 1e5 for x in pc], "pPort": [x * 1e5 for x in col(port)], "mOut": [],
          "tPort": [x + 273.15 for x in col(port.replace("P_duct", "T_duct").replace("(bar)", "(degC)"))],
          "pIn": [x * 1e5 for x in col(pin)], "mIv": col("Mass_Flow_Int_Valve_0_Cyl_1(kg/s)")}
    if after is not None:
        k = [h for h in head if h.startswith("P_duct_%d_at_0.01" % (after + 1))]
        if k:
            tr["pAfter"] = [x * 1e5 for x in col(k[0])]
    for h in head:
        if h.startswith("F_duct_"):
            tr["mOut"].append(col(h))
    L = s["last"]
    ah, ad = read_table(os.path.join(folder, "caseAVG.DAT"))
    ai = {h: i for i, h in enumerate(ah)}
    # OpenWAM's Combustion_Heat column stays 0 in this build: the heat released is its fuel mass per cycle (a mean per cylinder)
    # times the LHV (44 MJ/kg, as the wave model) times the combustion efficiency it was given; wall heat as heat lost (> 0)
    q = ad[-1][ai["Fuel_Mass(kg/cc)"]] * 44e6 * spec["e"]["eta"]
    qw = -sum(ad[-1][ai[k]] for k in ("Heat_Through_Liner_Cyl_1(J)", "Heat_Through_Cylinder_Head_Cyl_1(J)", "Heat_Through_Piston_Cyl_1(J)"))
    return {"rpm": rpm, "Qcomb": q, "Qwall": qw, "finished": s["finished"], "ve": L["VE_trapped_fresh"], "veDelivered": L["VE_delivered"],
            "nmep": L["NMEP"] * 1e5, "imep": L["IMEP"] * 1e5, "nmepChange": s["convergence"]["NMEP"]["last_change"],
            "trace": tr, "folder": folder}


# ---------------------------------------------------------------- wave side
def wave_runs(name, spec, rpms, dx, fanning, page, cycles, gamma=None, gas=None):
    os.makedirs(os.path.join(SCRATCH, "wave"), exist_ok=True)
    jf = os.path.join(SCRATCH, "wave", name + "_job.json")
    of = os.path.join(SCRATCH, "wave", name + "_%s_out.json" % (os.path.basename(page or "page")))
    job = {"spec": spec, "rpms": rpms, "dx": dx, "cycles": cycles}
    if fanning is not None:
        job["fanning"] = fanning
    if gamma is not None:
        job["gamma"] = gamma
    if gas is not None:
        job["gas"] = gas
    with open(jf, "w") as f:
        json.dump(job, f)
    env = dict(os.environ)
    if page:
        env["PAGE"] = page
    subprocess.run(["node", os.path.join(HERE, "engine.js"), jf, of], check=True, env=env)
    with open(of) as f:
        return json.load(f)


# ---------------------------------------------------------------- metrics
def resample(th, y, n=1440):
    """y(th) over one 720-degree cycle onto n equal steps (th unwrapped and sorted, linear between samples)."""
    pts = sorted(zip(th, y))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    xs = [xs[-1] - 720.0] + xs + [xs[0] + 720.0]
    ys = [ys[-1]] + ys + [ys[0]]
    out, j = [], 0
    for k in range(n):
        x = 720.0 * k / n
        while xs[j + 1] < x:
            j += 1
        t = (x - xs[j]) / (xs[j + 1] - xs[j]) if xs[j + 1] > xs[j] else 0.0
        out.append(ys[j] + t * (ys[j + 1] - ys[j]))
    return out


def harmonic(y, k):
    """Amplitude of harmonic k of a cycle sampled at len(y) equal steps (k = 2 x engine order)."""
    n = len(y)
    re = sum(y[i] * math.cos(2 * math.pi * k * i / n) for i in range(n))
    im = sum(y[i] * math.sin(2 * math.pi * k * i / n) for i in range(n))
    return 2.0 * math.hypot(re, im) / n


def order_levels(mdot, rpm, orders):
    """Monopole sound pressure level at 1 m (dB re 20 uPa) of the summed open-end mass flows: p = (1/4 pi r) d mdot/dt,
    the page's wamInsOrders law, per engine order."""
    out = {}
    for o in orders:
        k = int(round(2 * o))
        w = 2 * math.pi * o * rpm / 60.0
        a = harmonic(mdot, k) * w / (4 * math.pi)
        out[str(o)] = 20 * math.log10(max(a / math.sqrt(2), 1e-12) / P_REF)
    return out


def corr(a, b):
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    sa = math.sqrt(sum((x - ma) ** 2 for x in a))
    sb = math.sqrt(sum((x - mb) ** 2 for x in b))
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (sa * sb) if sa > 0 and sb > 0 else float("nan")


def returning_wave(th, p, evo_deg, window=(0.0, 360.0)):
    """Timing of the returning (reflected) wave at the port: the crank angle of the lowest port pressure after the
    blow-down peak, inside the exhaust valve's open period (local cylinder degrees, firing TDC = 0), and its depth."""
    pts = [(t, v) for t, v in zip(th, p) if evo_deg <= t <= 400.0]
    if not pts:
        return None, None
    kpk = max(range(len(pts)), key=lambda k: pts[k][1])
    after = pts[kpk:]
    kmin = min(range(len(after)), key=lambda k: after[k][1])
    return after[kmin][0], after[kmin][1]


def metrics(cfg, spec, wave, wam):
    ncyl = len(spec["opt"]["phases"])
    fo = ncyl / 2.0
    orders = sorted(set([0.5, 1.0, 1.5, 2.0] + [round(f * fo * 2) / 2 for f in (0.5, 1, 1.5, 2, 4)]))
    eng_evo = 180.0 - make_wam.seat_events(spec["e"]["cam"], spec["e"]["liftIn"] * 1000, spec["e"]["liftEx"] * 1000)["evo"]
    rows = []
    for wv, wm in zip(wave["runs"], wam):
        r = {"rpm": wv["rpm"], "wave": {}, "wam": {}}
        for side, run in (("wave", wv), ("wam", wm)):
            tr = run["trace"]
            if tr is None:
                continue
            th = tr["th"]
            pp = resample(th, tr["pPort"])
            mo = [0.0] * 1440
            for m in tr["mOut"]:
                mm = resample(th, m)
                mo = [a + b for a, b in zip(mo, mm)]
            rt, rp = returning_wave([720.0 * k / 1440 for k in range(1440)], pp, eng_evo)
            if side == "wave" and run.get("balances"):
                bb = run["balances"][-1]
                run["Qcomb"], run["Qwall"] = bb["Q"] / ncyl, bb["qw"] / ncyl
            d = {"ve": run["ve"], "veDelivered": run["veDelivered"], "nmep": run.get("nmep", run.get("imep")),
                 "Qcomb": run.get("Qcomb"), "Qwall": run.get("Qwall"),
                 "pPortMean": sum(pp) / len(pp), "pPortMax": max(pp), "pPortMin": min(pp),
                 "returnDeg": rt, "returnP": rp, "orders": order_levels(mo, wv["rpm"], orders), "pPort": pp, "mOut": mo,
                 "pCyl": resample(th, tr["pCyl"]),
                 # crank-angle mean gas temperature at the exhaust port (OpenWAM 10 mm from the valve, wave the first cell)
                 "tPortMean": sum(resample(th, tr["tPort"])) / 1440 if tr.get("tPort") else None,
                 "tEx": run.get("tEx")}
            if tr.get("pAfter"):
                d["pAfterMean"] = sum(resample(th, tr["pAfter"])) / 1440
            r[side] = d
        if r["wave"] and r["wam"]:
            r["portCorr"] = corr(r["wave"]["pPort"], r["wam"]["pPort"])
            amp = lambda q: max(q) - min(q)
            r["portAmpRatio"] = amp(r["wave"]["pPort"]) / amp(r["wam"]["pPort"])
            r["returnShiftDeg"] = (r["wave"]["returnDeg"] - r["wam"]["returnDeg"]) if r["wave"]["returnDeg"] is not None and r["wam"]["returnDeg"] is not None else None
            r["orderDiff"] = {o: r["wave"]["orders"][o] - r["wam"]["orders"][o] for o in r["wave"]["orders"]}
        if wv.get("balances"):
            b = wv["balances"][-1]
            r["wave"]["massResidual"] = b["massResidual"]
            r["wave"]["energyResidual"] = b["energyResidual"]
        r["wave"]["veHistory"] = wv.get("veHistory")
        r["wam"]["nmepChange"] = wm.get("nmepChange")
        r["wam"]["finished"] = wm.get("finished")
        rows.append(r)
    ve_w = [r["wave"]["ve"] for r in rows]
    ve_o = [r["wam"]["ve"] for r in rows]
    rp = [r["rpm"] for r in rows]
    summ = {"veCorr": corr(ve_w, ve_o), "vePeakWave": rp[max(range(len(rp)), key=lambda k: ve_w[k])],
            "vePeakWam": rp[max(range(len(rp)), key=lambda k: ve_o[k])],
            "veMeanRatio": sum(ve_w) / sum(ve_o), "orders": orders}
    vd = math.pi / 4 * spec["e"]["bore"] ** 2 * spec["e"]["stroke"]
    return {"config": cfg, "rows": rows, "summary": summ, "Vd": vd}


def main(argv):
    opts = {"configs": ",".join(CONFIGS), "tag": "base", "page": "", "wave": "1", "wam": "1", "cycles": "12"}
    for a in argv[1:]:
        k, v = a.split("=", 1)
        opts[k] = v
    over, fan, gam, gas = TAGS[opts["tag"]]
    page = opts["page"] or None
    os.makedirs(RES, exist_ok=True)
    outp = os.path.join(RES, opts["tag"] + ".json")
    allres = {}
    if os.path.exists(outp):
        with open(outp) as f:
            allres = json.load(f)
    for cfg in opts["configs"].split(","):
        build, rpms, dx = CONFIGS[cfg]
        spec = build()
        print("== %s (%s)" % (cfg, opts["tag"]), flush=True)
        wam = [wam_one(cfg, spec, rpm, over) for rpm in rpms]
        wave = wave_runs(cfg + "_" + opts["tag"], spec, rpms, dx, fan, page, int(opts["cycles"]), gam, gas)
        m = metrics(cfg, spec, wave, wam)
        for r in m["rows"]:
            print("%6d rpm  VE wave %.4f wam %.4f | NMEP wave %.2f wam %.2f bar | port mean %.1f / %.1f kPa corr %.3f amp %.2f "
                  "return %+.0f deg | mass res %.1e energy res %.1e" % (
                      r["rpm"], r["wave"]["ve"], r["wam"]["ve"], r["wave"]["nmep"] / 1e5, r["wam"]["nmep"] / 1e5,
                      r["wave"]["pPortMean"] / 1e3, r["wam"]["pPortMean"] / 1e3, r.get("portCorr", float("nan")),
                      r.get("portAmpRatio", float("nan")), r.get("returnShiftDeg") or 0.0,
                      r["wave"].get("massResidual", float("nan")), r["wave"].get("energyResidual", float("nan"))), flush=True)
        print("   VE correlation %.3f, peak wave %d / wam %d rpm, mean ratio %.3f" % (
            m["summary"]["veCorr"], m["summary"]["vePeakWave"], m["summary"]["vePeakWam"], m["summary"]["veMeanRatio"]), flush=True)
        for r in m["rows"]:                   # traces kept every 2 deg (the metrics above used 0.5 deg)
            for side in ("wave", "wam"):
                for k in ("pPort", "mOut", "pCyl"):
                    if k in r[side]:
                        r[side][k] = [round(x, 6 if k == "mOut" else 1) for x in r[side][k][::4]]
        allres[cfg] = m
        with open(outp, "w") as f:
            json.dump(allres, f, separators=(",", ":"))


if __name__ == "__main__":
    main(sys.argv)
