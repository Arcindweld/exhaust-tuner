#!/usr/bin/env python3
"""Markdown validation tables from validation/*_results.json (for NOTES.md)."""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import intake_cfd as ic  # noqa


def load(n):
    f = os.path.join(HERE, n)
    return json.load(open(f)) if os.path.exists(f) else None


def rennels(rD):
    lam = 1 + 0.622 * (1 - 0.30 * math.sqrt(rD) - 0.70 * rD) ** 4
    return 0.0696 * (1 - 0.569 * rD) * lam ** 2 + (lam - 1) ** 2


out = []
B = load("blair_results.json")
if B:
    out.append("### (b) Blair & Cahoon bellmouths, De = 23 mm, inflow from 1 atm / 25 °C\n")
    out.append("Mass flow at the published pressure ratio (PR = p0 / area-averaged static pressure at the tract-end station). "
               "Our value is interpolated between two converged runs that bracket the PR (medium mesh).\n")
    out.append("| case | PR (published) | ṁ published [g/s] | ṁ CFD [g/s] | error | Blair 'actual' CD pub. / CFD | flow-bench Cd pub. / CFD |")
    out.append("|---|---|---|---|---|---|---|")
    for n, e in B.items():
        out.append("| %s | %.3f | %.3f | %.3f | %+.1f %% | %.4f / %.4f | %.4f / %.4f |" % (
            n, e["PR_pub"], e["mdot_pub"] * 1e3, e["mdot_cfd"] * 1e3, 100 * (e["mdot_cfd"] / e["mdot_pub"] - 1),
            e["CD_actual_pub"], e["CD_actual_cfd"], e["Cd_fb_pub"], e["Cd_cfd"]))
    pp, rad, ell = B["PP-46-23-23-0"], B["RAD-46-23-35-6"], B["ELL-23-23-49-3"]
    out.append("")
    out.append("| ratio | published | CFD | difference |")
    out.append("|---|---|---|---|")
    out.append("| RAD / PP, caption values (RAD at PR 1.037, PP at 1.039) | %.3f | %.3f | %+.1f %% |" % (
        rad["mdot_pub"] / pp["mdot_pub"], rad["mdot_cfd"] / pp["mdot_cfd"],
        100 * ((rad["mdot_cfd"] / pp["mdot_cfd"]) / (rad["mdot_pub"] / pp["mdot_pub"]) - 1)))
    out.append("| ELL / RAD, caption values (ELL at 1.039, RAD at 1.037) | %.3f | %.3f | %+.1f %% |" % (
        ell["mdot_pub"] / rad["mdot_pub"], ell["mdot_cfd"] / rad["mdot_cfd"],
        100 * ((ell["mdot_cfd"] / rad["mdot_cfd"]) / (ell["mdot_pub"] / rad["mdot_pub"]) - 1)))
    # same-PR published estimates
    rad_pub_1039 = rad["mdot_pub"] / ic.ideal_mass_flux(101325, 298.15, 101325 / 1.037) * \
        ic.ideal_mass_flux(101325, 298.15, 101325 / 1.039)
    out.append("| RAD / PP at the same PR = 1.039 | %.3f (RAD caption value scaled to 1.039 at constant Cd; text: \"near constant 16 %%\") | %.3f | |" % (
        rad_pub_1039 / pp["mdot_pub"], rad["mdot_cfd_1039"] / pp["mdot_cfd_1039"]))
    out.append("| ELL / RAD at the same PR = 1.039 | %.3f (same scaling; Fig. 12: ≈ +1.9 %% at PR ≈ 1.04; text: \"a mere 1.5 %%\") | %.3f | |" % (
        ell["mdot_pub"] / rad_pub_1039, ell["mdot_cfd_1039"] / rad["mdot_cfd_1039"]))
    out.append("")
    out.append("Mesh sensitivity (ṁ at the published PR):\n")
    out.append("| case | coarse | medium | fine | fine vs medium |")
    out.append("|---|---|---|---|---|")
    for n, e in B.items():
        m = e["mesh"]
        row = [("%.3f g/s (%d cells)" % (m[l]["mdot_at_PRpub"] * 1e3, m[l]["cells"])) if l in m else "-"
               for l in ("coarse", "medium", "fine")]
        d = 100 * (m["fine"]["mdot_at_PRpub"] / m["medium"]["mdot_at_PRpub"] - 1) if "fine" in m and "medium" in m else float("nan")
        out.append("| %s | %s | %s | %s | %+.2f %% |" % (n, row[0], row[1], row[2], d))
    out.append("")
    out.append("Sensitivity to where the static-pressure station is (flow-bench Cd, medium mesh):\n")
    out.append("| case | station at L | L + 1 D | L + 2 D |")
    out.append("|---|---|---|---|")
    for n, e in B.items():
        s = e["station_sensitivity"]
        out.append("| %s | %.4f | %.4f | %.4f |" % (n, s["tract_end"]["Cd"], s["plus1D"]["Cd"], s["plus2D"]["Cd"]))
    out.append("")
    out.append("Run cost: " + "; ".join("%s %s it / %.0f s" % (n, "+".join(str(int(x)) for x in e["iterations"]),
                                                               sum(x or 0 for x in e["wall_time_s"])) for n, e in B.items()))
    out.append("")
F = load("friction_results.json")
if F:
    out.append("### (a) Fully developed turbulent pipe flow (D = 50 mm, L = 80 D, f from Δp between 50 D and 70 D)\n")
    out.append("f CFD is the Darcy factor from the static-pressure drop between 50 D and 70 D (compressible runs: the "
               "momentum-flux change of the accelerating gas taken off); f wall is 8 τw / (ρ U²) from the wall shear stress "
               "on the same stretch. The two must agree in developed flow (a momentum balance).\n")
    out.append("| case | Re | f CFD (Δp) | f wall (τw) | Δp / τw | Colebrook | error | Haaland | McKeon 2005 | error | y+ avg/max | run |")
    out.append("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for n, e in sorted(F.items(), key=lambda kv: (kv[1]["Re"], kv[0])):
        yp = e.get("yplus") or {}
        fw = e.get("f_wall")
        out.append("| %s | %.0e | %.5f | %s | %s | %.5f | %+.1f %% | %.5f | %.5f | %+.1f %% | %s | %s it, %.0f s |" % (
            n, e["Re"], e["f_cfd"], "%.5f" % fw if fw else "-", "%.3f" % (e["f_cfd"] / fw) if fw else "-",
            e["f_colebrook"], 100 * (e["f_cfd"] / e["f_colebrook"] - 1), e["f_haaland"],
            e["f_mckeon"], 100 * (e["f_cfd"] / e["f_mckeon"] - 1),
            ("%.2f/%.2f" % (yp["avg"], yp["max"])) if yp else "-", int(e["iterations"]), e["wall_time_s"] or 0))
    out.append("")
E = load("entrance_results.json")
if E:
    out.append("### (c) Entrance loss coefficient, inlet flush with a wall (D = 50 mm, Re = 1e5)\n")
    out.append("K = total-pressure loss extrapolated from the fully developed region (20–40 D) back to the inlet plane, "
               "in dynamic heads of the bulk velocity.\n")
    out.append("| case | K CFD | Crane TP-410 | Idelchik | Rennels | run |")
    out.append("|---|---|---|---|---|---|")
    ref = {"sharp": (0.50, 0.50, 0.57), "r0.04D": (0.24, 0.26, rennels(0.04)), "r0.10D": (0.09, 0.12, rennels(0.10)),
           "r0.20D": (0.04, 0.03, rennels(0.20))}
    for n, e in sorted(E.items()):
        key = n.replace("entrance_", "").replace("_fine", "").replace("_coarse", "")
        c, i, r = ref.get(key, (float("nan"),) * 3)
        out.append("| %s | %.3f | %.2f | %.2f | %.3f | %s it, %.0f s |" % (n, e["K_total"], c, i, r,
                                                                         int(e["iterations"]), e["wall_time_s"] or 0))
    out.append("")
X = load("exhaust_results.json")
if X:
    out.append("### (d) Exhaust-component mode: known-answer checks (gas 650 °C, inlet 100 m/s, medium mesh)\n")
    out.append("K is the total-pressure loss from the part's inlet face to its exit face in dynamic heads of the inlet velocity. "
               "The part's own straight pipes between those faces (inlet 1 D or 2 D, outlet 10 D; the 2 D extensions the generator "
               "adds lie outside the measured section) add wall friction, estimated with Colebrook at the run's Reynolds number and "
               "taken off to give the component's own K.\n")
    out.append("| case | K CFD, inlet to exit | friction of the straights (est.) | K of the component | reference | run |")
    out.append("|---|---|---|---|---|---|")
    for n, e in X.items():
        ref = ("%.3f (%s)" % (e["K_ref"], e["ref"])) if isinstance(e["K_ref"], float) else ("%.2f–%.2f (%s)" % (e["K_ref"][0], e["K_ref"][1], e["ref"]))
        out.append("| %s | %.3f | %.3f | **%.3f** | %s | %s, %d it, %.0f s, %s cells |" % (
            n, e["K_cfd"], e["K_friction_est"], e["K_component"], ref, "converged" if e["converged"] else "NOT converged",
            int(e["iterations"]), e["wall_time_s"] or 0, e.get("cells")))
    out.append("")
print("\n".join(out))
