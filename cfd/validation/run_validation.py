#!/usr/bin/env python3
"""Validation of intake_cfd.py against published results.

  python3 run_validation.py blair      # Blair & Cahoon (RET Sept 2006) bellmouths
  python3 run_validation.py friction   # fully developed pipe friction vs Colebrook
  python3 run_validation.py entrance   # entrance loss K, sharp vs rounded
  python3 run_validation.py all
  python3 run_validation.py table      # print the summary tables from cached runs

Every case is generated with intake_cfd.generate_case() exactly as a user
would, run with its own Allrun, and read back from its results.json.
Runs are cached in validation/runs/<name>/ (delete a folder to re-run).
"""
import concurrent.futures as cf
import json
import math
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import intake_cfd as ic  # noqa: E402

FOAMENV = os.environ.get("FOAMENV") or os.path.join(ROOT, "foamenv.sh")   # a script that puts OpenFOAM v2412 on PATH
RUNS = os.path.join(HERE, "runs")
NWORK = int(os.environ.get("NWORK", "2"))
P0, T0 = 101325.0, 298.15


def run_case(design, name):
    cdir = os.path.join(RUNS, name)
    rj = os.path.join(cdir, "results.json")
    if os.path.exists(rj):
        return json.load(open(rj))
    if os.path.exists(cdir):
        subprocess.run(["rm", "-rf", cdir])
    summ = ic.generate_case(design, cdir)
    t0 = time.time()
    with open(os.path.join(cdir, "allrun.out"), "w") as f:
        subprocess.run(["bash", "-c", ". %s && ./Allrun" % FOAMENV], cwd=cdir, stdout=f, stderr=subprocess.STDOUT)
    if not os.path.exists(rj):
        print("  %s FAILED (see %s/allrun.out)" % (name, cdir))
        return None
    res = json.load(open(rj))
    res["wall_time_s"] = time.time() - t0
    res["cells"] = summ["cells"]
    json.dump(res, open(rj, "w"), indent=2)
    print("  %-34s %6.0f s  %6d cells  converged=%s" % (name, res["wall_time_s"], summ["cells"], res["converged"]))
    return res


def run_many(jobs):
    """jobs: list of (design, name) -> dict name -> results"""
    out = {}
    with cf.ThreadPoolExecutor(max_workers=NWORK) as ex:
        futs = {ex.submit(run_case, d, n): n for d, n in jobs}
        for fu in cf.as_completed(futs):
            out[futs[fu]] = fu.result()
    return out


# --------------------------------------------------------------------------
# (b) Blair & Cahoon, "Best bell", Race Engine Technology, Sept 2006
# --------------------------------------------------------------------------
A23 = math.pi / 4 * 0.023 ** 2
BLAIR = {
    # published values from the Fig. 4/6/7 captions (FLUENT, matched to QUB tests)
    "PP-46-23-23-0": dict(inlet={"type": "plain", "wall_thickness_mm": 1.85}, L=46.0,
                          PR=1.039, mdot=30.023e-3, CD=0.5672),
    "RAD-46-23-35-6": dict(inlet={"type": "radius", "lip_radius_mm": 6.0}, L=46.0,
                           PR=1.037, mdot=34.83e-3, CD=0.719),
    "ELL-23-23-49-3": dict(inlet={"type": "ellipse", "length_mm": 23.0, "entry_diameter_mm": 49.0,
                                  "exit_diameter_mm": 23.0, "corner_radius_mm": 3.0}, L=23.0,
                           PR=1.039, mdot=36.15e-3, CD=0.743),
}


def tmdot(PR):
    return ic.ideal_mass_flux(P0, T0, P0 / PR) * A23


def blair_design(name, mdot, level="medium"):
    b = BLAIR[name]
    L = b["L"]
    return {"name": name,
            "geometry": {"tube_diameter_mm": 23.0, "tube_length_mm": L, "inlet": b["inlet"],
                         "mount": {"type": "free", "protrusion_mm": L},
                         "planes_mm": {"plus1D": L + 23.0, "plus2D": L + 46.0},
                         "outlet_extension_D": 4},
            "operating_point": {"mass_flow_kg_s": mdot},
            "ambient": {"p_pa": P0, "T_c": 25.0},
            "mesh": {"level": level},
            "solver": {"force": "compressible"}}


def station(res, plane="tract_end"):
    r = res["planes"][plane]
    return r["PR_p0_over_ps"], r["Cd_flowbench"], r


def interp_cd(pts, PR):
    """pts: [(PR, Cd)], linear interpolation/extrapolation in PR"""
    pts = sorted(pts)
    if len(pts) == 1 or abs(pts[-1][0] - pts[0][0]) < 1e-6:
        return pts[-1][1]
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    return y0 + (y1 - y0) * (PR - x0) / (x1 - x0)


def blair():
    print("Blair & Cahoon bellmouths: pass 1 (published mass flow)")
    r1 = run_many([(blair_design(n, b["mdot"]), n + "_m1") for n, b in BLAIR.items()])
    jobs = []
    m2 = {}
    for n, b in BLAIR.items():
        PR1, Cd1, _ = station(r1[n + "_m1"])
        m2[n] = Cd1 * tmdot(b["PR"])
        jobs.append((blair_design(n, m2[n]), n + "_m2"))
    print("pass 2 (mass flow re-targeted to the published pressure ratio)")
    r2 = run_many(jobs)
    print("mesh sensitivity (coarse / fine) at the pass-2 mass flow")
    jobs = []
    for n in BLAIR:
        for lvl in ("coarse", "fine"):
            jobs.append((blair_design(n, m2[n], lvl), "%s_m2_%s" % (n, lvl)))
    r3 = run_many(jobs)
    out = {}
    for n, b in BLAIR.items():
        pts = [station(r1[n + "_m1"])[:2], station(r2[n + "_m2"])[:2]]
        slope = (pts[1][1] - pts[0][1]) / (pts[1][0] - pts[0][0]) if abs(pts[1][0] - pts[0][0]) > 1e-6 else 0.0
        cd_pub = interp_cd(pts, b["PR"])
        cd_1039 = interp_cd(pts, 1.039)
        e = dict(PR_pub=b["PR"], mdot_pub=b["mdot"], CD_actual_pub=b["CD"],
                 Cd_fb_pub=b["mdot"] / tmdot(b["PR"]),
                 Cd_cfd=cd_pub, mdot_cfd=cd_pub * tmdot(b["PR"]),
                 Cd_cfd_1039=cd_1039, mdot_cfd_1039=cd_1039 * tmdot(1.039),
                 runs=[dict(PR=p, Cd=c) for p, c in pts], dCd_dPR=slope)
        r = r2[n + "_m2"]
        e["CD_actual_cfd"] = r["planes"]["tract_end"]["Cd_vena_contracta_Blair"]
        e["PR_run2"] = station(r)[0]
        e["K_run2"] = r["planes"]["tract_end"]["K_total_loss"]
        e["station_sensitivity"] = {pl: dict(PR=r["planes"][pl]["PR_p0_over_ps"], Cd=r["planes"][pl]["Cd_flowbench"])
                                    for pl in ("tract_end", "plus1D", "plus2D")}
        e["converged"] = [r1[n + "_m1"]["converged"], r["converged"]]
        e["iterations"] = [r1[n + "_m1"]["iterations"], r["iterations"]]
        e["wall_time_s"] = [r1[n + "_m1"].get("wall_time_s"), r.get("wall_time_s")]
        e["cells"] = r.get("cells")
        ms = {}
        for lvl in ("coarse", "medium", "fine"):
            rr = r2[n + "_m2"] if lvl == "medium" else r3.get("%s_m2_%s" % (n, lvl))
            if not rr:
                continue
            PRl, Cdl, _ = station(rr)
            Cd_at = Cdl + slope * (b["PR"] - PRl)
            ms[lvl] = dict(cells=rr.get("cells"), PR=PRl, Cd=Cdl, mdot_at_PRpub=Cd_at * tmdot(b["PR"]),
                           converged=rr["converged"], wall_time_s=rr.get("wall_time_s"),
                           iterations=rr["iterations"])
        e["mesh"] = ms
        out[n] = e
    json.dump(out, open(os.path.join(HERE, "blair_results.json"), "w"), indent=2)
    return out


# --------------------------------------------------------------------------
# (a) fully developed turbulent pipe flow vs Colebrook / Haaland / McKeon
# --------------------------------------------------------------------------
DF = 0.050
LF = 80 * DF


def mckeon(Re):
    """McKeon et al. (2005), J. Fluid Mech. 538: 1/sqrt(f) = 1.930 log10(Re sqrt f) - 0.537"""
    f = 0.02
    for _ in range(100):
        f = (1.930 * math.log10(Re * math.sqrt(f)) - 0.537) ** -2
    return f


def friction_design(Re, level="medium", axial=0.25):
    mu = ic.mu_air(T0)
    mdot = Re * mu * math.pi * DF / 4
    return {"name": "pipe_Re%.0e" % Re,
            "geometry": {"tube_diameter_mm": DF * 1e3, "tube_length_mm": LF * 1e3,
                         "inlet": {"type": "radius", "lip_radius_mm": 0.2 * DF * 1e3},
                         "mount": {"type": "flange"},
                         "planes_mm": {"x50D": 50 * DF * 1e3, "x60D": 60 * DF * 1e3, "x70D": 70 * DF * 1e3},
                         "outlet_extension_D": 3},
            "operating_point": {"mass_flow_kg_s": mdot},
            "ambient": {"p_pa": P0, "T_c": 25.0},
            "mesh": {"level": level, "tube": axial},
            "solver": {"max_iterations": 8000}}


def friction_f(res):
    pl = res["planes"]
    rho = P0 / (ic.R_AIR * T0) if res["solver"] == "simpleFoam" else None
    m = res["mdot_outlet_kg_s"]
    A = math.pi / 4 * DF ** 2
    p50, p70 = pl["x50D"]["p_static_avg_Pa"], pl["x70D"]["p_static_avg_Pa"]
    if rho is None:   # compressible: use local density, include acceleration term
        rho = 0.5 * (p50 / (ic.R_AIR * pl["x50D"]["T_static_avg_K"]) + p70 / (ic.R_AIR * pl["x70D"]["T_static_avg_K"]))
    U = m / (rho * A)
    return (p50 - p70) / (20.0 * 0.5 * rho * U * U), U


def friction():
    print("Pipe friction (L = 80 D, D = 50 mm, rounded flush entrance)")
    jobs = [(friction_design(Re), "pipe_Re%.0e" % Re) for Re in (5e4, 1e5, 2e5)]
    jobs += [(friction_design(1e5, "coarse", 1 / 2.67), "pipe_Re1e+05_coarse"),
             (friction_design(1e5, "fine", 1 / 6.0), "pipe_Re1e+05_fine")]
    r = run_many(jobs)
    out = {}
    for name, res in sorted(r.items()):
        if not res:
            continue
        Re = float(name.split("Re")[1].split("_")[0])
        f, U = friction_f(res)
        out[name] = dict(Re=Re, U=U, f_cfd=f, f_colebrook=ic.friction_factor_colebrook(Re),
                         f_haaland=ic.friction_factor_haaland(Re), f_mckeon=mckeon(Re),
                         converged=res["converged"], iterations=res["iterations"],
                         wall_time_s=res.get("wall_time_s"), cells=res.get("cells"),
                         yplus=res.get("yPlus", {}).get("tract_wall"), solver=res["solver"])
    json.dump(out, open(os.path.join(HERE, "friction_results.json"), "w"), indent=2)
    return out


# --------------------------------------------------------------------------
# (c) entrance loss coefficient, flush-mounted pipe inlet
# --------------------------------------------------------------------------
DE = 0.050
LE = 50 * DE
ENTR = {"sharp": None, "r0.04D": 0.04, "r0.10D": 0.10, "r0.20D": 0.20}


def entrance_design(tag, rD, Re=1e5, level="medium"):
    mu = ic.mu_air(T0)
    mdot = Re * mu * math.pi * DE / 4
    inlet = {"type": "plain", "wall_thickness_mm": 3.0} if rD is None else \
        {"type": "radius", "lip_radius_mm": rD * DE * 1e3}
    return {"name": "entrance_" + tag,
            "geometry": {"tube_diameter_mm": DE * 1e3, "tube_length_mm": LE * 1e3, "inlet": inlet,
                         "mount": {"type": "flange"},
                         "planes_mm": {"x%dD" % k: k * DE * 1e3 for k in (2, 5, 10, 20, 25, 30, 35, 40)},
                         "outlet_extension_D": 3},
            "operating_point": {"mass_flow_kg_s": mdot},
            "ambient": {"p_pa": P0, "T_c": 25.0},
            "mesh": {"level": level, "tube": 0.25},
            "solver": {"max_iterations": 8000}}


def entrance_K(res):
    """Total-pressure loss extrapolated from the fully developed region
    (20-40 D) back to the inlet plane, in dynamic heads of the bulk velocity."""
    pl = res["planes"]
    xs, ys = [], []
    q = None
    for k in (20, 25, 30, 35, 40):
        r = pl["x%dD" % k]
        xs.append(k)
        ys.append(P0 - r["p0_massavg_Pa"])
        q = r["q_dyn_Pa"]
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    a = my - b * mx
    # same with static pressure (handbook convention, includes the profile's kinetic-energy factor)
    ys2 = [P0 - pl["x%dD" % k]["p_static_avg_Pa"] for k in (20, 25, 30, 35, 40)]
    my2 = sum(ys2) / n
    b2 = sum((x - mx) * (y - my2) for x, y in zip(xs, ys2)) / sum((x - mx) ** 2 for x in xs)
    a2 = my2 - b2 * mx
    return dict(K_total=a / q, K_static_minus_1=a2 / q - 1.0, f_from_slope=b / q, q=q)


def entrance():
    print("Entrance loss K (D = 50 mm, Re = 1e5, flush in a wall, L = 50 D)")
    jobs = [(entrance_design(t, rD), "entrance_" + t) for t, rD in ENTR.items()]
    jobs += [(entrance_design("sharp", None, level="fine"), "entrance_sharp_fine"),
             (entrance_design("sharp", None, level="coarse"), "entrance_sharp_coarse")]
    r = run_many(jobs)
    out = {}
    for name, res in sorted(r.items()):
        if not res:
            continue
        k = entrance_K(res)
        k.update(converged=res["converged"], iterations=res["iterations"], wall_time_s=res.get("wall_time_s"),
                 cells=res.get("cells"), solver=res["solver"], f_colebrook=ic.friction_factor_colebrook(1e5))
        out[name] = k
    json.dump(out, open(os.path.join(HERE, "entrance_results.json"), "w"), indent=2)
    return out


# --------------------------------------------------------------------------
# (d) exhaust-component mode: sudden expansion (Borda-Carnot) and a 90-degree mandrel bend
# --------------------------------------------------------------------------
T_GAS_C = 650.0
U_IN = 100.0          # m/s at the inlet pipe (M ~ 0.16 at 650 C)


def tube_stl(path, segs, nphi=72):
    """ASCII STL of a round tube: segs = list of ('line', L, R0, R1) or ('arc', clr, angle_rad, R).
    Solids: inlet (start cap), outlet (end cap), wall.  mm in, mm out."""
    P = ic.Path3D()
    rings = []       # (s, R)
    s = 0.0
    rings.append((0.0, segs[0][2]))
    for sg in segs:
        if sg[0] == "line":
            _, L, R0, R1 = sg
            if abs(R0 - rings[-1][1]) > 1e-9:
                rings.append((s, R0))               # a step
            n = max(2, int(math.ceil(L / (0.1 * 2 * max(R0, R1)))))
            for i in range(1, n + 1):
                rings.append((s + L * i / n, R0 + (R1 - R0) * i / n))
            P.straight(L); s += L
        else:
            _, clr, ang, R = sg
            n = max(8, int(math.ceil(ang / math.radians(5))))
            for i in range(1, n + 1):
                rings.append((s + clr * ang * i / n, R))
            P.arc(clr, ang, 0.0); s += clr * ang
    pts = []
    for (sv, R) in rings:
        p, t, n1, n2 = P.frame(sv)
        pts.append([ic.v_add(p, ic.v_add(ic.v_mul(n1, R * math.cos(2 * math.pi * j / nphi)),
                                         ic.v_mul(n2, R * math.sin(2 * math.pi * j / nphi)))) for j in range(nphi)])
    wall = []
    for k in range(len(pts) - 1):
        A, B = pts[k], pts[k + 1]
        for j in range(nphi):
            j1 = (j + 1) % nphi
            wall.append((A[j], A[j1], B[j1])); wall.append((A[j], B[j1], B[j]))
    p0, t0, _, _ = P.frame(0.0)
    inlet = [(p0, pts[0][(j + 1) % nphi], pts[0][j]) for j in range(nphi)]
    pe, te, _, _ = P.frame(s)
    outlet = [(pe, pts[-1][j], pts[-1][(j + 1) % nphi]) for j in range(nphi)]
    ic.write_stl_ascii(path, [("inlet", inlet), ("outlet", outlet), ("wall", wall)])
    return s


def exhaust_design(name, stl, mdot, level="medium"):
    return {"name": name, "mode": "exhaust",
            "geometry": {"stl": stl, "stl_units": "mm", "inlet_extension_D": 2, "outlet_extension_D": 2},
            "operating_point": {"mass_flow_kg_s": mdot},
            "gas": {"T_c": T_GAS_C}, "ambient": {"p_pa": P0, "T_c": 25.0},
            "mesh": {"level": level}}


def exhaust():
    print("Exhaust components: sudden expansion D 50 -> 100 mm (Borda-Carnot) and a 90 deg bend R/D 1.5 (Idelchik / Crane)")
    os.makedirs(RUNS, exist_ok=True)
    Tg = T_GAS_C + 273.15
    rho = P0 / (ic.R_AIR * Tg)
    D1 = 0.050
    A1 = math.pi / 4 * D1 ** 2
    mdot = rho * U_IN * A1
    stl_dir = os.path.join(RUNS, "_stl")
    os.makedirs(stl_dir, exist_ok=True)
    exp_stl = os.path.join(stl_dir, "expansion_50_100.stl")
    tube_stl(exp_stl, [("line", 50.0, 25.0, 25.0), ("line", 1000.0, 50.0, 50.0)])
    bend_stl = os.path.join(stl_dir, "bend90_50_R75.stl")
    tube_stl(bend_stl, [("line", 100.0, 25.0, 25.0), ("arc", 75.0, math.pi / 2, 25.0), ("line", 500.0, 25.0, 25.0)])
    jobs = [(exhaust_design("expansion_50_100", exp_stl, mdot), "EXH-expansion-50-100"),
            (exhaust_design("bend90_50_R75", bend_stl, mdot), "EXH-bend90-50-R75")]
    r = run_many(jobs)
    out = {}
    mu = ic.mu_air(Tg)
    Re1 = rho * U_IN * D1 / mu
    f1 = ic.friction_factor_colebrook(Re1)
    for name, res in r.items():
        if not res:
            continue
        sm = res["summary"]
        e = dict(K_cfd=sm["K"], K_to_ambient=sm["K_to_ambient"], dp_total_Pa=sm["dp_total_Pa"], U_in=sm["U_in_m_s"],
                 T_in_K=sm["T_in_K"], Re_in=Re1, mdot=sm["mdot_kg_s"], converged=res["converged"],
                 iterations=res["iterations"], wall_time_s=res.get("wall_time_s"), cells=res.get("cells"),
                 exit_uniformity=sm["exit_uniformity_index"])
        if "expansion" in name:
            # straights in the model: inlet 1 D1 + 2 D1 extension; outlet 10 D2 + 2 D2 extension, in inlet dynamic heads
            D2 = 0.100
            Re2 = rho * (U_IN / 4) * D2 / mu
            f2 = ic.friction_factor_colebrook(Re2)
            fric = f1 * 3.0 + f2 * 12.0 * (A1 / (math.pi / 4 * D2 ** 2)) ** 2
            e.update(K_friction_est=fric, K_component=sm["K"] - fric, K_ref=(1 - A1 / (math.pi / 4 * D2 ** 2)) ** 2,
                     ref="Borda-Carnot (1 - A1/A2)^2")
        else:
            # straights: 2 D in + 2 D extension, 10 D out + 2 D extension = 16 D; the arc's own friction (2.36 D) stays in K
            fric = f1 * 16.0
            e.update(K_friction_est=fric, K_component=sm["K"] - fric, K_ref=(0.20, 0.30),
                     ref="Idelchik diag. 6-1 / Crane TP-410 (14 fT), R/D = 1.5", f_T=f1)
        out[name] = e
    json.dump(out, open(os.path.join(HERE, "exhaust_results.json"), "w"), indent=2)
    return out


def table():
    L = []
    fb = os.path.join(HERE, "blair_results.json")
    if os.path.exists(fb):
        B = json.load(open(fb))
        L.append("Blair & Cahoon bellmouths (mass flow at the published PR; tract-end station)")
        L.append("%-16s %6s %9s %9s %7s | %8s %8s | %8s %8s" % ("case", "PR", "pub g/s", "CFD g/s", "err%",
                                                              "CDact pb", "CDact cf", "Cd fb pb", "Cd fb cf"))
        for n, e in B.items():
            L.append("%-16s %6.3f %9.3f %9.3f %+7.2f | %8.4f %8.4f | %8.4f %8.4f" % (
                n, e["PR_pub"], e["mdot_pub"] * 1e3, e["mdot_cfd"] * 1e3, 100 * (e["mdot_cfd"] / e["mdot_pub"] - 1),
                e["CD_actual_pub"], e["CD_actual_cfd"] or float("nan"), e["Cd_fb_pub"], e["Cd_cfd"]))
        pp, rad, ell = B["PP-46-23-23-0"], B["RAD-46-23-35-6"], B["ELL-23-23-49-3"]
        L.append("ratios at a common PR = 1.039: RAD/PP = %.4f, ELL/RAD = %.4f, ELL/PP = %.4f" % (
            rad["mdot_cfd_1039"] / pp["mdot_cfd_1039"], ell["mdot_cfd_1039"] / rad["mdot_cfd_1039"],
            ell["mdot_cfd_1039"] / pp["mdot_cfd_1039"]))
        L.append("ratios of the published caption values (PRs 1.037/1.039 mixed): RAD/PP = %.4f, ELL/RAD = %.4f" % (
            rad["mdot_pub"] / pp["mdot_pub"], ell["mdot_pub"] / rad["mdot_pub"]))
        L.append("ratios of our values at the caption PRs: RAD/PP = %.4f, ELL/RAD = %.4f" % (
            rad["mdot_cfd"] / pp["mdot_cfd"], ell["mdot_cfd"] / rad["mdot_cfd"]))
        for n, e in B.items():
            for lvl, m in e["mesh"].items():
                L.append("   mesh %-16s %-6s cells %6s mdot@PRpub %.3f g/s conv %s time %.0f s it %d" % (
                    n, lvl, m["cells"], m["mdot_at_PRpub"] * 1e3, m["converged"], m["wall_time_s"] or 0, m["iterations"]))
            ss = e["station_sensitivity"]
            L.append("   station %-16s Cd at L: %.4f  L+1D: %.4f  L+2D: %.4f" % (
                n, ss["tract_end"]["Cd"], ss["plus1D"]["Cd"], ss["plus2D"]["Cd"]))
    ff = os.path.join(HERE, "friction_results.json")
    if os.path.exists(ff):
        F = json.load(open(ff))
        L.append("")
        L.append("Fully developed pipe friction (50-70 D)")
        for n, e in F.items():
            L.append("%-24s Re %.0e f_cfd %.5f Colebrook %.5f (%+.2f%%) Haaland %.5f McKeon %.5f (%+.2f%%) y+ %s conv %s %.0f s" % (
                n, e["Re"], e["f_cfd"], e["f_colebrook"], 100 * (e["f_cfd"] / e["f_colebrook"] - 1), e["f_haaland"],
                e["f_mckeon"], 100 * (e["f_cfd"] / e["f_mckeon"] - 1),
                ("%.2f/%.2f" % (e["yplus"]["avg"], e["yplus"]["max"])) if e.get("yplus") else "-",
                e["converged"], e["wall_time_s"] or 0))
    fe = os.path.join(HERE, "entrance_results.json")
    if os.path.exists(fe):
        E = json.load(open(fe))
        L.append("")
        L.append("Entrance loss coefficient (flush, Re 1e5)")
        for n, e in E.items():
            L.append("%-24s K_total %.4f  K_static-1 %.4f  f(slope) %.5f (Colebrook %.5f) conv %s %.0f s" % (
                n, e["K_total"], e["K_static_minus_1"], e["f_from_slope"], e["f_colebrook"], e["converged"],
                e["wall_time_s"] or 0))
    fx = os.path.join(HERE, "exhaust_results.json")
    if os.path.exists(fx):
        X = json.load(open(fx))
        L.append("")
        L.append("Exhaust components (gas %.0f C, inlet %.0f m/s)" % (T_GAS_C, U_IN))
        for n, e in X.items():
            L.append("%-24s K_cfd %.3f  friction est %.3f  K_component %.3f  reference %s %s  dp %.0f Pa  conv %s  %d it %.0f s" % (
                n, e["K_cfd"], e["K_friction_est"], e["K_component"], str(e["K_ref"]), e["ref"], e["dp_total_Pa"],
                e["converged"], int(e["iterations"]), e["wall_time_s"] or 0))
    print("\n".join(L))


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    os.makedirs(RUNS, exist_ok=True)
    if what in ("blair", "all"):
        blair()
    if what in ("friction", "all"):
        friction()
    if what in ("entrance", "all"):
        entrance()
    if what in ("exhaust", "all"):
        exhaust()
    table()
