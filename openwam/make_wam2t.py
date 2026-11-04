#!/usr/bin/env python3
"""make_wam2t.py - write a labelled OpenWAM 2.2 input file (.wam) for a piston-ported, crankcase-scavenged two-stroke.

Companion of make_wam.py (four-strokes). It reuses that file's WamWriter (every value line carries a <source:line>
label naming the OpenWAM reader that consumes it), split_runs (a line of {L,d0,d1} segments -> pipes, a diameter jump
starts a new pipe joined by TCCUnionEntreTubos) and the gasoline constants. make_wam.py is imported, never changed.

WHAT IS MODELLED (per cylinder; N cylinders = N copies, each with its own crankcase, intake and exhaust line)
  cylinder      TCilindro2T (TOpenWAM.cpp:627 cycle type 1, TBloqueMotor.cpp:138 360-degree cycle). Angle frame:
                0 = TDC, 180 = BDC (TLumbrera::CalculaDistPMI, TLumbrera.cpp:181). Perfect-mixing scavenging: OpenWAM
                2.2 has no 2T scavenging model; the cylinder is one well-stirred zone and the exhaust port outflow has
                the cylinder's mean composition (TCilindro2T.cpp:1048-1058). Real loop scavenging lies between perfect
                mixing and perfect displacement, so trapping efficiency here is on the pessimistic side.
                In-cylinder heat transfer for SI two-strokes is OpenWAM's Blair-type correlation, Nu = 0.26 Re^0.7
                with mean piston speed (TCilindro2T.cpp:521-531), fixed wall temperatures. Woschni cw1/cw2 are read
                but not used for SI.
  exhaust port  TLumbrera (valve type 4) on an exhaust-valve BC (type 8). The port top height above the BDC crown
                comes from the timing: opening angle ATDC = 180 - dur/2, height = crown height above BDC there,
                using OpenWAM's own crank-slider law (port_height below = TLumbrera::CalculaDistPMI). OpenWAM reads
                width and corner radii but does not use them (TLumbrera.cpp:103, only FAltura/FPosicionPMI enter
                CalculaCD:138): the window shape lives in the CD table, which is Cd * exposed window area(opening) /
                pipe-end area (reference diameter 0 = pipe end, TTipoValvula.cpp:89, 323), so the area law here is
                the real one: a rectangle with top and bottom corner radii (a round port = width = height = d,
                radii d/2), integrated over the exposed height.
  transfers     one or more TLumbrera ports on intake-valve BCs (type 7), each at the cylinder end of its own
                transfer duct (a pipe), whose other end opens into the crankcase through a fixed-CD pipe-to-plenum
                port (TCCDeposito, BC 11, TCDFijo CD 1). "One equivalent transfer" = one entry.
  closing fix   OpenWAM 2.2 closes the 2T cycle (stops the cylinder mass balance, fixes the trapped mass and burns
                from there) at FDistribucion.CA = the LATEST closing of the cylinder's intake-valve BCs
                (TCilindro.cpp:479-495; TCilindro2T.cpp:300, 418). With only transfers on intake BCs that is transfer
                closing, 20-40 deg before the exhaust port closes, and everything the exhaust port passes after it -
                in particular the expansion chamber's plugging pulse pushing charge back in - would be dropped from
                the cylinder. So every cylinder gets one extra intake-valve BC: a TLumbrera port with the exhaust
                port's height (opens and closes with it) and CD 0 everywhere (never flows: TCCCilindro.cpp treats
                CD < 1e-4 as closed), on a 3-cell stub pipe with a closed end. CA then equals exhaust closing.
                run["closing_fix"] = 0 switches it off (to see the difference).
  short circuit OpenWAM's short-circuit split uses FAlphaEscape/FAlphaAdmision, which are only set for four-strokes
                (TCilindro.cpp:554-559) and are uninitialised for 2T (TCilindro2T.cpp:990-1051). It only changes the
                composition of the exhaust outflow; the summary reports OpenWAM's short-circuit mass so a non-zero
                value (garbage alpha) is visible.
  crankcase     TDepVolVariable (plenum type 1), driven by the engine speed (control 1, ratio 1). OpenWAM's volume law
                is the cylinder's, V = Vdead + A*(L + S/2(1-cos a) - sqrt(L^2 - (S/2 sin a)^2)) with a = crank angle -
                Desfase (TDepVolVariable.cpp:194-207); Desfase = 180 + firing angle puts the minimum at BDC and the
                maximum at TDC, exact at both, but in between the rod term has the wrong sign: the modelled crankcase
                volume runs 2*A*(L - sqrt(L^2-(S/2)^2)) ahead of the real one at 90 deg (125 example: 15 cm3 of the
                125 cm3 swing). Vdead = A*S/(CCR-1), CCR = crankcase compression ratio (max/min volume). Adiabatic.
                Its pumping work is not in OpenWAM's torque (the cylinder torque is (p_cyl - p_amb) * A,
                TCilindro2T.cpp:964): it is integrated here from the crankcase p and V in INS.DAT (wam2t_summary).
  intake        "reed": a line of pipe segments (bellmouth, carburettor bore, boot) from an open end to a reed valve
                into the crankcase: TLamina 1-D (valve type 2, TLamina.cpp:158-206), a lumped mass-spring-damper
                driven by (p_pipe - p_crankcase) * A (TLamina.cpp:241-243), lift in metres, no lift stop. Its m, k, c,
                A come from the petal geometry (reed_lumped below: cantilever tip stiffness 3EI/L^3 per petal, tip-
                equivalent mass 0.2357 * beam mass, uniform-pressure equivalent tip area 3/8 w L, damping ratio zeta),
                its flow area from the opening petal perimeter (tip + both sides: (w + L) * lift per petal), capped
                at the reed block window area. OpenWAM's 1-D reed has no lift stop (lift capped at 1e5 m,
                TLamina.cpp:248, 345), so it overshoots and closes late (back-flow out of the crankcase after TDC was seen
                on the Maico case). reed.model = "0d" instead writes TLamina 0-D: quasi-steady, lift = dp*A/k up to
                reed.lift_stop, closed (CD 0 both ways) when the crankcase pressure exceeds the pipe's; it delivered
                LESS air on both test engines (no inertia overshoot while the intake column rams), so 1-D is the default.
                "port": a piston-controlled intake port (the skirt uncovers it near TDC) as TDiscoRotativo (valve type
                3) on the crankcase port, with a CD-versus-angle table computed from the exact skirt geometry. The
                pipe-to-plenum BC integrates its own clock (TCCDeposito.cpp:82, 366-377); reading the code suggests it
                starts at 0 while the engine starts at 256 deg (TBloqueMotor.cpp:551), but a 30-cycle all-cycles
                INS.DAT run (125 example, 11500 rpm) showed the table angle equal to the cylinder-1 angle: the port
                opened at 29.3 +- 0.5 deg cylinder angle every cycle with the table written for 29.3 deg. The table is
                therefore written in the cylinder-1 frame (angle = cylinder angle + firing angle); tests/test_2t.py
                check_intake_phase() repeats that check.
  combustion    one Wiebe law (TBloqueMotor.cpp:358-373), spark ignition, fuel = trapped fresh air * relative F/A
                (TCilindro2T.cpp:430, 497). The carburettor fuel that short-circuits is not in OpenWAM's fuel mass;
                BSFC here is computed on the delivered air / AFR.
  exhaust line  the expansion chamber as conical segments {L, d0, d1} [m] from the port face (header, diffusers,
                belly, baffle, stinger), wall temperature Tw, then optionally a silencer volume (constant-volume
                plenum, as make_wam.py) and tailpipe, open end.
  dual power    exhaust.dual = {x0, Li, Dm, di, Lp} [m]: an insert cone (mouth Dm at x0 from the port face, the belly end,
                small end di after Li) and its pipe (di, Lp) inside the baffle and stinger. Two paths between two
                junctions (TCCRamificacion, BC type 12): the annulus round the insert (the equivalent diameter of the
                area between the outer wall and the insert, sqrt(Do^2 - Di^2), at every break of either profile) and
                the insert itself, joined again where its pipe ends (x0 + Li + Lp); the stinger runs on to the tip. The
                perforated half of the cone is not modelled (no cross-flow through the holes): the insert as a
                solid-walled second path, the limit of a closed perforation.
  friction      OpenWAM's FMEP is set to zero (OpenWAM's torque = indicated). wam2t_summary reports indicated
                (cylinder), crankcase pumping, and a brake estimate with fmep = fmep_coef * S[m] * rpm [Pa]
                (default 100, a Blair-style motored-friction form quoted from memory - an assumption, see
                FMEP_COEF_PA).

COMPRESSION RATIO: e.cr_trapped (volume at exhaust closing / clearance, the two-stroke convention) or e.cr_geom
(full stroke); the one given is converted to the geometric ratio OpenWAM wants (TBloqueMotor.cpp:252, 266).

DISCHARGE COEFFICIENTS (assumptions, flagged): constant Cd on the exposed window area, exhaust 0.70, transfers 0.65,
reed 0.60, the same for both flow directions. Blair and co-workers measured two-stroke port Cd of roughly 0.6-0.8
varying with pressure ratio and opening (SAE 962534, 2003-32-0029); those tables are not reproduced here.

SPEC (SI units, angles in degrees; see example_125() in tests/test_2t.py)
  e: {bore, stroke, rod, cr_trapped | cr_geom, ccr (crankcase compression ratio) | Vcc_min (m3, crankcase volume at
      BDC), afr, [combEff], burn: {start (deg BTDC), dur, [a, m]}, [Twall: {piston, head, liner} degC], [ncyl, phases]}
  exhaust_port: {dur, width, r_top, r_bot, [height] (window height, default = port top height: bottom at BDC crown),
                 [cd]}
  transfers: [{dur, width, r_top, r_bot, [height], [cd], duct: {L, d}}, ...]
  intake: {type: "reed", segs: [{L,d0,d1}] open end -> reed, Tw, reed: {petals, L, w, t, E, rho, zeta, cd, A_block,
           [model "1d" | "0d"], [lift_stop m, 0d only], [lift_table_max m, 1d only]}}
          {type: "port", segs, Tw, port: {open_btdc, width, r_top, r_bot, [height], [cd]}}
  exhaust: {segs: [{L,d0,d1}], Tw (K), [silencer: {V_m3, segs}]}
  run: name, rpm, cycles, cell_mm, courant, out_step_deg, closing_fix, ...

VALIDATION SO FAR (tests/test_2t.py, 40 cycles, 8 mm cells; 5 mm cells changed IMEP by 1 %, 60 cycles by 0.3 %)
  125 MX (54 x 54.5): chamber peak 31.7 hp brake / 35.5 hp indicated at 12000 rpm (target ~38 hp at 11000-11500),
  about twice the straight pipe's power at 11000-12000 rpm. Delivery ratio 0.86-0.89 at the peak is the shortfall;
  it is set mainly by the port windows (assumed widths) and the reed: exhaust 45 / transfers 72 mm wide instead of
  39 / 62 gave 34.9 hp, plus a stiffer, better-damped reed 37.6 hp - not adopted, the widths are not known.
  Maico 490 (86.5 x 83, 43 mm round exhaust port): chamber peak 35 hp brake at 5500 rpm (claim 53 hp at 6500), DR only
  0.4-0.55: the 43 mm round exhaust window (1275 mm2 exposed) blows down too slowly (2.2 bar in the cylinder at
  transfer opening, back-flow into the transfers); a 58 mm wide rectangular window gave +25 % at 6500 rpm.
  The closing fix moved the trapped mass by 0.2 % at 11500 rpm (the plugging pulse pushes charge in after transfer
  closing and part of it leaves again before exhaust closing) but makes the cycle-to-cycle spread smaller.

Plain Python 3, standard library only.
"""
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import make_wam  # noqa: E402   (WamWriter, split_runs, FS_GASOLINE_SIMPLE, COMB_COMPLETE; never modified)
from make_wam import WamWriter, split_runs, FS_GASOLINE_SIMPLE  # noqa: E402

K0 = 273.15
ENGINE_START_DEG = 256.0      # TBloqueMotor.cpp:551 FTheta = 256 for 2T
FMEP_COEF_PA = 100.0          # brake estimate: fmep [Pa] = FMEP_COEF_PA * stroke [m] * rpm (assumption, see notes)

RUN_DEFAULTS = {
    "name": "twostroke",
    "rpm": 11000.0,
    "cycles": 30,
    "out_step_deg": 1.0,
    "p_amb_bar": 1.01325,
    "T_amb_C": 25.0,
    "gamma_model": 2,
    "cell_mm": 8.0,
    "courant": 0.8,
    "roughness_mm": 0.02,
    "end_loss": 1.0,
    "pipe_htc_mult": 1.0,
    "pipe_fric_mult": 1.0,
    "cd_points": 41,             # points of each port CD table (opening 0..height)
    "closing_fix": 1,            # 1 = CD-0 port that makes OpenWAM close the cycle at exhaust closing (see notes)
    "exhaust_Tgas0_C": 500.0,    # initial gas temperature in the exhaust line
    "crankcase_T0_C": 40.0,
    "lhv_J_kg": 44.0e6,
    "fuel_density": 740.0,
}

CD_EXHAUST = 0.70
CD_TRANSFER = 0.65
CD_REED = 0.60
CD_INTAKE_PORT = 0.65


# --------------------------------------------------------------------------------------------- geometry
def crown_above_bdc(theta_deg, S, L):
    """Piston crown height above its BDC position [m] = TLumbrera::CalculaDistPMI (TLumbrera.cpp:181-186)."""
    c = math.radians(theta_deg)
    return S - (L + S * (1.0 - math.cos(c)) / 2.0 - math.sqrt(L * L - (S * math.sin(c) / 2.0) ** 2))


def port_top_for_duration(dur, S, L):
    """Port top height above the BDC crown for a piston-controlled port open `dur` crank degrees around BDC."""
    if not (0.0 < dur < 360.0):
        raise ValueError("port duration %g must lie in (0, 360)" % dur)
    return crown_above_bdc(180.0 - dur / 2.0, S, L)


def opening_angle(H, S, L):
    """Crank angle ATDC at which the crown passes height H on the way down (bisection, as TLumbrera.cpp:192-213)."""
    a0, a1 = 0.0, 180.0
    for _ in range(60):
        a = (a0 + a1) / 2.0
        if H - crown_above_bdc(a, S, L) > 0.0:
            a1 = a
        else:
            a0 = a
    return (a0 + a1) / 2.0


def window_width(y, W, Hw, rt, rb):
    """Width of a rounded-rectangle window at depth y below its top (0 <= y <= Hw)."""
    if y < 0.0 or y > Hw:
        return 0.0
    w = W
    if rt > 0.0 and y < rt:
        w -= 2.0 * (rt - math.sqrt(max(0.0, rt * rt - (rt - y) ** 2)))
    yb = Hw - y
    if rb > 0.0 and yb < rb:
        w -= 2.0 * (rb - math.sqrt(max(0.0, rb * rb - (rb - yb) ** 2)))
    return max(0.0, w)


def window_area(h, W, Hw, rt, rb, n=200):
    """Area of the window exposed when the crown is h below its top [m2] (Simpson on the width law)."""
    h = min(max(h, 0.0), Hw)
    if h <= 0.0:
        return 0.0
    n += n % 2
    dy = h / n
    s = window_width(0.0, W, Hw, rt, rb) + window_width(h, W, Hw, rt, rb)
    for i in range(1, n):
        s += (4.0 if i % 2 else 2.0) * window_width(i * dy, W, Hw, rt, rb)
    return s * dy / 3.0


def check_window(port, what):
    W, rt, rb = port["width"], port.get("r_top", 0.0), port.get("r_bot", 0.0)
    Hw = port["Hw"]
    if not (W > 0.0 and Hw > 0.0):
        raise ValueError("%s: width and window height must be positive" % what)
    if 2.0 * max(rt, rb) > W + 1e-12 or rt + rb > Hw + 1e-12:
        raise ValueError("%s: corner radii %g/%g mm do not fit a %g x %g mm window" % (what, rt * 1e3, rb * 1e3, W * 1e3, Hw * 1e3))


def port_cd_table(port, H, a_ref, cd, npts, clip=1.0):
    """(openings [m], CD referred to a_ref) for a piston-controlled port whose top is H above the BDC crown, window
    height port['Hw'] (bottom at H - Hw; a bottom below the BDC crown is never uncovered)."""
    opens, cds = [], []
    for i in range(npts):
        h = H * i / (npts - 1)
        a = window_area(h, port["width"], port["Hw"], port.get("r_top", 0.0), port.get("r_bot", 0.0))
        opens.append(round(h, 9))
        cds.append(round(min(clip, cd * a / a_ref), 6))
    return opens, cds


def time_area(port, H, S, L, rpm, Vd, cd=1.0):
    """Blair-style specific time-area of a port [s/m]: integral of Cd*A dt / Vd over the open period."""
    a_open = opening_angle(H, S, L)
    n = 720
    tot = 0.0
    for i in range(n):
        th = a_open + (360.0 - 2.0 * a_open) * (i + 0.5) / n
        tot += window_area(H - crown_above_bdc(th, S, L), port["width"], port["Hw"], port.get("r_top", 0.0), port.get("r_bot", 0.0))
    dth = (360.0 - 2.0 * a_open) / n
    return cd * tot * dth / (6.0 * rpm) / Vd


def reed_lumped(r):
    """Reed petals -> TLamina 1-D lumped parameters: mass kg, damping N s/m, stiffness N/m, pressure area m2."""
    n, L, w, t = int(r["petals"]), float(r["L"]), float(r["w"]), float(r["t"])
    E, rho, zeta = float(r["E"]), float(r["rho"]), float(r.get("zeta", 0.15))
    I = w * t ** 3 / 12.0
    k1 = 3.0 * E * I / L ** 3                     # cantilever tip stiffness
    m1 = 0.2357 * rho * w * t * L                  # tip-equivalent mass (Rayleigh)
    a1 = 3.0 / 8.0 * w * L                         # uniform pressure p*w*L gives the tip deflection of a tip force p*(3/8)wL
    k, m, A = n * k1, n * m1, n * a1
    c = 2.0 * zeta * math.sqrt(k * m)
    f1 = 3.516 / (2.0 * math.pi * L * L) * math.sqrt(E * I / (rho * w * t))   # first bending mode of one petal
    return {"m": m, "c": c, "k": k, "A": A, "f_n_Hz": f1, "perimeter": n * (w + L)}


# --------------------------------------------------------------------------------------------- model
BC_DESC = {"open": "open end", "closed": "closed end", "step": "diameter step", "plenum": "plenum port",
           "eport": "exhaust port", "tport": "transfer port", "branch": "junction"}
BC_ENDS = {"open": (1, 1), "closed": (1, 1), "step": (2, 2), "plenum": (1, 1), "eport": (1, 1), "tport": (1, 1), "branch": (3, 3)}


def dual_lines(segs, d):
    """Exhaust segs and a dual power insert d = {x0, Li, Dm, di, Lp} [m] -> (before, annulus, insert, after) seg lists."""
    x0, Li, Dm, di, Lp = float(d["x0"]), float(d["Li"]), float(d["Dm"]), float(d["di"]), float(d["Lp"])
    x2 = x0 + Li + Lp
    total = sum(float(sg["L"]) for sg in segs)
    if not (Li > 0.0 and Lp >= 0.0 and Dm > di > 0.0 and 0.0 < x0 < x2 < total):
        raise ValueError("the dual power insert must lie inside the chamber, its mouth wider than its pipe")
    before, rest = make_wam.split_segs_at(segs, x0)
    mid, after = make_wam.split_segs_at(rest, x2 - x0)
    cuts, a = [], 0.0
    for sg in mid:
        a += float(sg["L"])
        cuts.append(a)
    xs = sorted(set([0.0, Li] + cuts))
    xs = [x for x in xs if x <= x2 - x0 + 1e-12]
    inner = lambda x: Dm + (di - Dm) * x / Li if x <= Li else di
    ann = []
    for a, b in zip(xs, xs[1:]):
        if b - a <= 1e-9:
            continue
        m = 0.5 * (a + b)
        acc = 0.0
        for sg in mid:
            L = float(sg["L"])
            if acc <= m <= acc + L:
                o0 = float(sg["d0"]) + (float(sg["d1"]) - float(sg["d0"])) * (a - acc) / L
                o1 = float(sg["d0"]) + (float(sg["d1"]) - float(sg["d0"])) * (b - acc) / L
                break
            acc += L
        i0 = inner(a) if m <= Li else di
        i1 = inner(b) if m <= Li else di
        if not (o0 > i0 and o1 > i1):
            raise ValueError("the dual power insert touches the chamber wall")
        ann.append({"L": b - a, "d0": math.sqrt(o0 * o0 - i0 * i0), "d1": math.sqrt(o1 * o1 - i1 * i1)})
    ins = [{"L": Li, "d0": Dm, "d1": di}] + ([{"L": Lp, "d0": di, "d1": di}] if Lp > 1e-6 else [])
    return before, ann, ins, after


def number_model(pipes, bcs):
    num, order, ends = {}, [], {}
    for i, pp in enumerate(pipes):
        if pp["left"] == pp["right"]:
            raise ValueError("pipe %d has the same BC at both ends" % (i + 1))
        for side in ("left", "right"):
            k = pp[side]
            if k not in bcs:
                raise ValueError("pipe %d refers to unknown BC %r" % (i + 1, k))
            if k not in num:
                order.append(k)
                num[k] = len(order)
            ends.setdefault(k, []).append((i, side))
    for k in bcs:
        if k not in num:
            raise ValueError("BC %r is not attached to any pipe" % k)
        lo, hi = BC_ENDS[bcs[k]["type"]]
        if not (lo <= len(ends[k]) <= hi):
            raise ValueError("BC %r of type %s has %d pipe ends" % (k, bcs[k]["type"], len(ends[k])))
    return num, order, ends


def model_from_spec(spec, run=None):
    run = dict(run or {})
    for k in run:
        if k not in RUN_DEFAULTS:
            raise ValueError("unknown run setting %r" % k)
    p = dict(RUN_DEFAULTS)
    p.update(run)
    e = spec["e"]
    B, S, L = float(e["bore"]), float(e["stroke"]), float(e["rod"])
    Ap = math.pi / 4.0 * B * B
    Vd = Ap * S
    ncyl = int(e.get("ncyl", 1))
    phases = [float(x) % 360.0 for x in (e.get("phases") or [360.0 * c / ncyl for c in range(ncyl)])]
    if len(phases) != ncyl:
        raise ValueError("e.phases must list one firing angle per cylinder")

    # ports
    ex = dict(spec["exhaust_port"])
    Hex = port_top_for_duration(float(ex["dur"]), S, L)
    ex["H"], ex["Hw"] = Hex, float(ex.get("height") or Hex)
    check_window(ex, "exhaust port")
    trs = []
    for j, t in enumerate(spec["transfers"]):
        t = dict(t)
        t["H"] = port_top_for_duration(float(t["dur"]), S, L)
        t["Hw"] = float(t.get("height") or t["H"])
        check_window(t, "transfer %d" % (j + 1))
        if t["H"] >= Hex:
            raise ValueError("transfer %d opens before the exhaust port (top %g >= %g mm)" % (j + 1, t["H"] * 1e3, Hex * 1e3))
        trs.append(t)

    # compression ratios
    if e.get("cr_geom") is not None:
        crg = float(e["cr_geom"])
        Vc = Vd / (crg - 1.0)
    elif e.get("cr_trapped") is not None:
        Vtr = Ap * (S - Hex)                       # swept volume above the exhaust port top
        Vc = Vtr / (float(e["cr_trapped"]) - 1.0)
        crg = (Vc + Vd) / Vc
    else:
        raise ValueError("give e.cr_trapped or e.cr_geom")
    cr_trapped = (Vc + Ap * (S - Hex)) / Vc
    if e.get("ccr") is not None:
        ccr = float(e["ccr"])
    elif e.get("Vcc_min") is not None:
        ccr = (float(e["Vcc_min"]) + Vd) / float(e["Vcc_min"])
    else:
        raise ValueError("give e.ccr (crankcase compression ratio) or e.Vcc_min (m3)")
    if not ccr > 1.0:
        raise ValueError("crankcase compression ratio must exceed 1")

    afr = float(e["afr"])
    phi = (1.0 / afr) / FS_GASOLINE_SIMPLE
    comb_eff = float(e["combEff"]) if e.get("combEff") is not None else make_wam.COMB_COMPLETE * min(1.0, 1.0 / phi)
    burn = e["burn"]
    tw = e.get("Twall") or {}
    eng = {"B": B, "S": S, "L": L, "Ap": Ap, "Vd": Vd, "Vc": Vc, "cr_geom": crg, "cr_trapped": cr_trapped, "ccr": ccr,
           "Vcc_min": Vd / (ccr - 1.0), "afr": afr, "phi": phi, "comb_eff": comb_eff,
           "burn_start": float(burn["start"]), "burn_dur": float(burn["dur"]),
           "wiebe_a": float(burn.get("a", 5.0)), "wiebe_m": float(burn.get("m", 2.0)),
           "T_piston": float(tw.get("piston", 280.0)), "T_head": float(tw.get("head", 220.0)), "T_liner": float(tw.get("liner", 180.0)),
           "ex_open_atdc": opening_angle(Hex, S, L)}

    pipes, bcs, plenums, vtypes = [], {}, [], []

    def vtype(d):
        vtypes.append(d)
        return len(vtypes)

    def add_line(segs, left, right, role, Twc, Tgc, comp, ht):
        runs = split_runs(segs)
        keys = [left]
        for j in range(1, len(runs)):
            sk = "%s/step%d" % (role, j)
            bcs[sk] = {"type": "step", "note": "%s diameter step %g to %g mm" % (role, runs[j - 1]["d1"] * 1e3, runs[j]["D0"] * 1e3)}
            keys.append(sk)
        keys.append(right)
        for j, rn in enumerate(runs):
            pipes.append({"role": role if len(runs) == 1 else "%s part %d" % (role, j + 1), "left": keys[j], "right": keys[j + 1],
                          "D0": rn["D0"], "secs": [list(s) for s in rn["secs"]], "Tw_C": Twc, "Tg_C": Tgc, "comp": comp, "ht": ht})

    cdfix = vtype({"kind": "cdfix", "cd": 1.0, "note": "fixed CD 1, transfer ducts and silencer into their plenums"})
    exh = spec["exhaust"]
    intake = spec["intake"]
    air, burnt = [0.0, 0.0, 1.0], [1.0, 0.0, 0.0]
    Tex = float(exh["Tw"]) - K0
    Tin = float(intake.get("Tw") or (p["T_amb_C"] + K0)) - K0
    info = {"cyl": []}
    for c in range(ncyl):
        C = c + 1
        # crankcase
        plenums.append({"kind": "crankcase", "cyl": C, "desfase": (180.0 + phases[c]) % 360.0, "ccr": ccr,
                        "p_bar": p["p_amb_bar"], "T_C": p["crankcase_T0_C"], "comp": air,
                        "note": "cylinder %d crankcase, CCR %.3f, %.1f cm3 at BDC" % (C, ccr, eng["Vcc_min"] * 1e6)})
        npl_cc = len(plenums)
        # intake line -> crankcase
        segs = intake["segs"]
        D_in = float(segs[-1]["d1"])
        a_in = math.pi / 4.0 * D_in * D_in
        ok, ck = "c%d/in/open" % C, "c%d/in/cc" % C
        bcs[ok] = {"type": "open", "note": "cylinder %d intake inlet, open end to atmosphere" % C}
        if intake.get("type", "reed") == "reed":
            r = intake["reed"]
            lp = reed_lumped(r)
            model = r.get("model", "1d")
            cdr = float(r.get("cd", CD_REED))
            area = lambda lift: round(min(1.0, cdr * min(lp["perimeter"] * lift, float(r["A_block"])) / a_in), 6)
            nlift = 31
            desc = "%d petals %gx%gx%g mm, k %.0f N/m, m %.3g kg, f_n %.0f Hz" % (
                int(r["petals"]), float(r["L"]) * 1e3, float(r["w"]) * 1e3, float(r["t"]) * 1e3, lp["k"], lp["m"], lp["f_n_Hz"])
            if model == "1d":
                lmax = float(r.get("lift_table_max", 0.015))
                lifts = [lmax * i / (nlift - 1) for i in range(nlift)]
                vt = vtype({"kind": "reed", "model": 1, "lp": lp, "step": lmax / (nlift - 1), "cds": [area(x) for x in lifts],
                            "note": "reed 1-D (no lift stop in OpenWAM), " + desc})
            elif model == "0d":
                stop = float(r.get("lift_stop", 0.010))
                dp_stop = stop * lp["k"] / lp["A"] / 1e5           # bar at which the static lift reaches the stop
                dps = [1.5 * dp_stop * i / (nlift - 1) for i in range(nlift)]
                vt = vtype({"kind": "reed", "model": 0, "lp": lp, "step": dps[1], "cds": [area(min(stop, d * 1e5 * lp["A"] / lp["k"])) for d in dps],
                            "note": "reed quasi-steady 0-D: static lift dp*A/k, stop %g mm reached at %.3f bar, " % (stop * 1e3, dp_stop) + desc})
            else:
                raise ValueError("intake.reed.model must be 0d or 1d")
            bcs[ck] = {"type": "plenum", "plenum": npl_cc, "vt": vt, "note": "cylinder %d reed valve into the crankcase" % C}
            info_in = {"type": "reed", "lumped": lp}
        elif intake["type"] == "port":
            ip = dict(intake["port"])
            # skirt-controlled: open while the crown is above (skirt below) the port; open_btdc = opening angle BTDC
            a_o = 360.0 - float(ip["open_btdc"])
            h_open = crown_above_bdc(a_o, S, L)       # crown height when the skirt bottom passes the port top
            ip["Hw"] = float(ip.get("height") or (S - h_open))
            check_window(ip, "intake port")
            cdv = float(ip.get("cd", CD_INTAKE_PORT))
            angs, cdt = [], []
            for i in range(361):
                phi_bc = float(i)
                th = (phi_bc - phases[c]) % 360.0     # this cylinder's angle at BC-clock angle phi_bc (= cylinder-1 angle, measured)
                h = crown_above_bdc(th, S, L) - h_open                   # how far the skirt is past the port top
                aa = window_area(h, ip["width"], ip["Hw"], ip.get("r_top", 0.0), ip.get("r_bot", 0.0))
                angs.append(phi_bc)
                cdt.append(round(min(1.0, cdv * aa / a_in), 6))
            vt = vtype({"kind": "disc", "angles": angs, "cds": cdt,
                        "note": "piston-controlled intake port, opens %g BTDC, as a rotary-disc CD(angle) table" % float(ip["open_btdc"])})
            bcs[ck] = {"type": "plenum", "plenum": npl_cc, "vt": vt, "note": "cylinder %d piston-controlled intake port into the crankcase" % C}
            info_in = {"type": "port", "open_btdc": float(ip["open_btdc"])}
        else:
            raise ValueError("intake.type must be reed or port")
        add_line(segs, ok, ck, "cylinder %d intake" % C, Tin, p["T_amb_C"], air, 1)
        if c == 0:
            ve_pipe = len(pipes)                 # the (last) intake pipe of cylinder 1
        # transfers
        a_tr_max = 0.0
        for j, t in enumerate(trs):
            d = float(t["duct"]["d"])
            a_duct = math.pi / 4.0 * d * d
            opens, cds = port_cd_table(t, t["H"], a_duct, float(t.get("cd", CD_TRANSFER)), int(p["cd_points"]))
            amax = window_area(t["H"], t["width"], t["Hw"], t.get("r_top", 0.0), t.get("r_bot", 0.0))
            a_tr_max += amax
            if amax * float(t.get("cd", CD_TRANSFER)) > a_duct:
                sys.stderr.write("WARNING: transfer %d effective window area exceeds its duct area: CD clipped at 1\n" % (j + 1))
            vt = vtype({"kind": "port", "port": t, "opens": opens, "cdin": cds, "cdout": cds,
                        "note": "transfer %d: %g deg, top %.2f mm above BDC crown, %g mm wide, opens %.1f ATDC" %
                        (j + 1, float(t["dur"]), t["H"] * 1e3, t["width"] * 1e3, opening_angle(t["H"], S, L))})
            pk, tk = "c%d/tr%d/cc" % (C, j + 1), "c%d/tr%d/port" % (C, j + 1)
            bcs[pk] = {"type": "plenum", "plenum": npl_cc, "vt": cdfix, "note": "cylinder %d transfer duct %d from the crankcase" % (C, j + 1)}
            bcs[tk] = {"type": "tport", "cyl": C, "vt": vt, "note": "cylinder %d transfer port %d" % (C, j + 1)}
            add_line([{"L": float(t["duct"]["L"]), "d0": d, "d1": d}], pk, tk, "cylinder %d transfer duct %d" % (C, j + 1),
                     p["crankcase_T0_C"], p["crankcase_T0_C"], air, 1)
        # closing fix
        if int(p["closing_fix"]) == 1:
            dfix = 0.01
            fake = {"width": ex["width"], "Hw": ex["Hw"], "r_top": 0.0, "r_bot": 0.0}
            vt = vtype({"kind": "port", "port": dict(fake, H=Hex), "opens": [0.0, Hex], "cdin": [0.0, 0.0], "cdout": [0.0, 0.0],
                        "note": "CD-0 port with the exhaust port's height: makes OpenWAM close the cycle at exhaust closing"})
            fk, fc = "c%d/fix/port" % C, "c%d/fix/closed" % C
            bcs[fk] = {"type": "tport", "cyl": C, "vt": vt, "note": "cylinder %d cycle-closing port, never flows" % C}
            bcs[fc] = {"type": "closed", "note": "cylinder %d cycle-closing stub, closed end" % C}
            Lstub = 3.0 * p["cell_mm"] / 1000.0
            add_line([{"L": Lstub, "d0": dfix, "d1": dfix}], fk, fc, "cylinder %d cycle-closing stub" % C, Tin, p["T_amb_C"], air, 1)
        # exhaust port and line
        segs = exh["segs"]
        D_ex = float(segs[0]["d0"])
        a_ex = math.pi / 4.0 * D_ex * D_ex
        opens, cds = port_cd_table(ex, Hex, a_ex, float(ex.get("cd", CD_EXHAUST)), int(p["cd_points"]))
        a_ex_max = window_area(Hex, ex["width"], ex["Hw"], ex.get("r_top", 0.0), ex.get("r_bot", 0.0))
        if a_ex_max * float(ex.get("cd", CD_EXHAUST)) > a_ex:
            sys.stderr.write("WARNING: exhaust effective window area exceeds the header area: CD clipped at 1\n")
        vt = vtype({"kind": "port", "port": ex, "opens": opens, "cdin": cds, "cdout": cds,
                    "note": "exhaust port: %g deg, top %.2f mm above BDC crown, %g mm wide, opens %.1f ATDC" %
                    (float(ex["dur"]), Hex * 1e3, ex["width"] * 1e3, eng["ex_open_atdc"])})
        ek, xk = "c%d/ex/port" % C, "c%d/ex/open" % C
        bcs[ek] = {"type": "eport", "cyl": C, "vt": vt, "note": "cylinder %d exhaust port" % C}
        bcs[xk] = {"type": "open", "note": "cylinder %d exhaust outlet, open end to atmosphere" % C}
        sil = exh.get("silencer")
        dual = exh.get("dual")
        if dual:
            # the insert: two paths between junction 1 (the belly end) and junction 2 (the end of its pipe)
            before, ann, ins, after = dual_lines(segs, dual)
            j1, j2 = "c%d/dual/j1" % C, "c%d/dual/j2" % C
            bcs[j1] = {"type": "branch", "note": "cylinder %d dual power insert, junction at its mouth" % C}
            bcs[j2] = {"type": "branch", "note": "cylinder %d dual power insert, junction at the end of its pipe" % C}
            add_line(before, ek, j1, "cylinder %d exhaust chamber" % C, Tex, p["exhaust_Tgas0_C"], burnt, 2)
            add_line(ann, j1, j2, "cylinder %d chamber round the insert" % C, Tex, p["exhaust_Tgas0_C"], burnt, 2)
            add_line(ins, j1, j2, "cylinder %d dual power insert" % C, Tex, p["exhaust_Tgas0_C"], burnt, 2)
            segs = after
            ek = j2
        tail_role = "cylinder %d stinger after the insert" % C if dual else "cylinder %d exhaust chamber" % C
        if sil:
            plenums.append({"kind": "const", "V_m3": float(sil["V_m3"]), "p_bar": p["p_amb_bar"], "T_C": p["exhaust_Tgas0_C"],
                            "comp": burnt, "note": "cylinder %d silencer, %g litres" % (C, float(sil["V_m3"]) * 1e3)})
            si, so = "c%d/sil/in" % C, "c%d/sil/out" % C
            bcs[si] = {"type": "plenum", "plenum": len(plenums), "vt": cdfix, "note": "cylinder %d silencer inlet" % C}
            bcs[so] = {"type": "plenum", "plenum": len(plenums), "vt": cdfix, "note": "cylinder %d silencer outlet" % C}
            add_line(segs, ek, si, tail_role, Tex, p["exhaust_Tgas0_C"], burnt, 2)
            add_line(sil["segs"], so, xk, "cylinder %d tailpipe" % C, Tex, p["exhaust_Tgas0_C"], burnt, 2)
        else:
            add_line(segs, ek, xk, tail_role, Tex, p["exhaust_Tgas0_C"], burnt, 2)
        info["cyl"].append({"intake": info_in, "A_ex_max_mm2": a_ex_max * 1e6, "A_tr_max_mm2": a_tr_max * 1e6,
                            "A_header_mm2": a_ex * 1e6})
    eng["H_ex"] = Hex
    eng["H_tr"] = [t["H"] for t in trs]
    eng["tr_open_atdc"] = [opening_angle(t["H"], S, L) for t in trs]
    return {"p": p, "eng": eng, "phases": phases, "pipes": pipes, "bcs": bcs, "plenums": plenums, "vtypes": vtypes,
            "ve_pipe": ve_pipe, "info": info, "spec": spec}


# --------------------------------------------------------------------------------------------- writer
def write_model(m):
    p, g = m["p"], m["eng"]
    pipes, bcs, plenums, vtypes = m["pipes"], m["bcs"], m["plenums"], m["vtypes"]
    phases = m["phases"]
    ncyl = len(phases)
    num, order, ends = number_model(pipes, bcs)
    w = WamWriter()
    T = "TOpenWAM.cpp"
    E = "TBloqueMotor.cpp"
    U = "TTubo.cpp"
    w.comment("OpenWAM 2.2 two-stroke input written by make_wam2t.py - %s, %g rpm" % (p["name"], p["rpm"]))
    w.comment("labels give the reader source file:line; units as used by that reader")
    w.comment("geometric CR %.3f, trapped CR %.3f, crankcase CR %.3f, exhaust opens %.2f ATDC" %
              (g["cr_geom"], g["cr_trapped"], g["ccr"], g["ex_open_atdc"]))

    w.section("HEADER  TOpenWAM::ReadInputData")
    w.v(2200, T + ":477 version, must equal vers 2200 Globales.h:53")
    w.v(0, T + ":485 Independent 0 = common time step for all pipes")

    w.section("GENERAL DATA  TOpenWAM::ReadGeneralData")
    w.v(float(p["out_step_deg"]), T + ":606 agincr, instantaneous output interval deg")
    w.v(int(p["cycles"]), T + ":606 SimulationDuration = number of engine cycles")
    w.v(float(p["p_amb_bar"]), T + ":607 ambient pressure bar")
    w.v(float(p["T_amb_C"]), T + ":607 ambient temperature degC")
    w.v(0, T + ":608 species model 0 = simple: burnt gas, fuel, air")
    w.v(int(p["gamma_model"]), T + ":608 gamma 0 const, 1 f-composition, 2 f-composition-temperature")
    w.v(1, T + ":622 engine block present")
    w.v(1, T + ":627 cycle type 1 = two-stroke nm2T, 360 deg cycle TBloqueMotor.cpp:138")
    w.v(0, T + ":627 simulation type 0 = steady speed")
    w.v(0, T + ":627 EGR transport 0 = no")
    w.v(1, T + ":743 fuel present")
    w.v(1, T + ":745 fuel type 1 = gasoline")
    w.row([0.0, 0.0, 1.0], T + ":802 atmosphere mass fractions burnt, fuel, air; sum must be exactly 1")

    w.section("ENGINE  TBloqueMotor::LeeMotor")
    w.v(0, E + ":117 ACT combustion model 0 = off, Wiebe law used")
    w.v(ncyl, E + ":134 number of cylinders")
    w.v(float(p["rpm"]), E + ":148 engine speed rpm")
    w.v(float(p["p_amb_bar"]), E + ":149 initial cylinder pressure at closing bar")
    m0 = p["p_amb_bar"] * 1e5 * (g["Vd"] + g["Vc"]) / (287.0 * (p["T_amb_C"] + K0 + 35.0))
    w.v(round(m0, 9), E + ":150 initial cylinder mass kg, start-up guess only")
    w.v(0, E + ":153 impose composition at exhaust opening 0 = no")
    w.row([0.0, 0.0, 1.0], E + ":156 initial cylinder mass fractions burnt, fuel, air")
    w.v(0, E + ":176 pressure at exhaust opening 0 = calculated")
    w.v(1, E + ":185 combustion type 1 = spark ignition, fuel from trapped air TCilindro2T.cpp:430,497")
    w.v(round(g["phi"], 10), E + ":196 relative fuel-air ratio = (1/AFR)/0.068468349, TCilindro.cpp:2735")
    w.v(round(g["comb_eff"], 6), E + ":199 combustion efficiency, multiplies released heat TCilindro2T.cpp:630")
    w.v(float(p["lhv_J_kg"]), E + ":200 lower heating value J/kg")
    w.v(float(p["fuel_density"]), E + ":201 fuel density kg/m3, not used")
    w.v(m["ve_pipe"], E + ":203 pipe used for volumetric efficiency = cylinder 1 intake pipe at the reed / port")
    w.v(g["T_piston"], E + ":209 piston wall temperature degC")
    w.v(g["T_head"], E + ":210 head wall temperature degC")
    w.v(g["T_liner"], E + ":211 liner wall temperature degC")
    w.v(round(g["Ap"], 9), E + ":213 piston heat-transfer area m2")
    w.v(round(g["Ap"] + 4.0 * g["Vc"] / g["B"], 9), E + ":214 head heat-transfer area m2 = bore area + 4 Vc/B")
    w.row([0.01, 150.0, 2700.0, 900.0], E + ":216 piston wall thickness m, k W/mK, rho, cp; unused, walls fixed")
    w.row([0.01, 150.0, 2700.0, 900.0], E + ":218 head wall thickness m, k, rho, cp; unused")
    w.row([0.01, 150.0, 2700.0, 900.0], E + ":220 liner wall thickness m, k, rho, cp; unused")
    w.row([1.0, 1.0, 10.0, 90.0], E + ":223 HT multipliers intake, exhaust (CI Woschni only), torque at max power Nm, coolant degC")
    w.v(2, E + ":225 wall temperature 2 = fixed")
    w.v(2.28, E + ":241 Woschni cw1, not used for SI two-strokes TCilindro2T.cpp:521-531")
    w.v(0.308, E + ":242 Woschni cw2, not used for SI")
    w.v(0.0, E + ":243 Woschni xpe, read but not used")
    w.v(g["L"], E + ":249 connecting rod length m")
    w.v(g["S"], E + ":250 stroke m")
    w.v(g["B"], E + ":251 bore m")
    w.v(round(g["cr_geom"], 9), E + ":252 geometric compression ratio, Vc = Vd/(CR-1) :266; trapped CR %.3f" % g["cr_trapped"])
    w.v(0.0, E + ":253 bowl diameter m, 0 = flat")
    w.v(0.0, E + ":254 bowl height m")
    w.v(g["B"], E + ":255 distance between valves m, four-stroke short-circuit model only")
    w.v(0.0, E + ":256 blow-by area")
    w.v(0.0, E + ":257 blow-by CD, 0 = no blow-by TCilindro2T.cpp:343")
    w.v(0.0, E + ":258 piston pin offset mm")
    w.v(0.015, E + ":259 pin diameter m, deformation only")
    w.v(0.02, E + ":260 piston crown height m, deformation only")
    w.v(0.2, E + ":261 rod mass kg, deformation only")
    w.v(0.2, E + ":262 piston+rings+pin mass kg, deformation only")
    w.v(2.1e11, E + ":263 elastic modulus Pa, deformation only")
    w.v(0.0, E + ":264 deformation coefficient 0 = rigid")
    w.row([0.0, 0.0, 0.0, 0.0], E + ":274 FMEP coefficients all 0: OpenWAM torque = indicated; friction applied in wam2t_summary")
    w.v(1, E + ":358 number of burn laws")
    w.row([round(m0, 9), round(m0 / g["afr"], 12), float(p["rpm"])], E + ":360 law reference air mass kg, fuel kg, rpm; blending only")
    w.v(1, E + ":367 number of Wiebe functions")
    w.row([g["wiebe_m"], g["wiebe_a"], 1.0, g["burn_dur"], g["burn_start"]],
          E + ":369 Wiebe m, C=a, share, duration deg, start deg BTDC entered positive :371")
    w.v(0, E + ":384 injection data 0 = none")
    if ncyl > 1:
        w.v(0, E + ":446 firing angles 0 = one angle per cylinder, read at 457")
        for c, ph in enumerate(phases):
            w.v(float(ph), E + ":457 cylinder %d firing angle deg in the 360 deg engine cycle" % (c + 1))
    w.v(0, E + ":485 engine controllers")
    for c in range(ncyl):
        w.v(0, E + ":503 controllers for cylinder %d" % (c + 1))

    w.section("PIPES  TOpenWAM::ReadPipes")
    w.v(len(pipes), T + ":852 number of pipes")
    for i, pp in enumerate(pipes):
        nl, nr = num[pp["left"]], num[pp["right"]]
        w.comment("%s pipe %d, %s BC%d to %s BC%d" % (pp["role"], i + 1, BC_DESC[bcs[pp["left"]]["type"]], nl,
                                                     BC_DESC[bcs[pp["right"]]["type"]], nr))
        w.row([nl, nr, len(pp["secs"]), 1], U + ":546 left BC, right BC, number of sections, number of identical ducts")
        w.v(float(p["roughness_mm"]), U + ":547 wall roughness mm")
        w.row([float(pp["Tw_C"]), float(pp["Tg_C"]), float(p["p_amb_bar"]), 0.0],
              U + ":548 initial wall T degC, gas T degC, pressure bar, velocity m/s")
        w.row([int(pp["ht"]), float(p["pipe_htc_mult"]), float(p["pipe_fric_mult"])],
              U + ":549 HT type 1 intake 2 exhaust, HT multiplier, friction multiplier")
        w.row([float(x) for x in pp["comp"]], U + ":568 initial mass fractions burnt, fuel, air")
        w.row([p["cell_mm"] / 1000.0, 2], U + ":590 mesh size m, wall T 2 = constant")
        w.v(2, U + ":604 solver 2 = TVD")
        w.v(float(p["courant"]), U + ":665 Courant number")
        w.v(float(pp["D0"]), U + ":710 diameter at section start m")
        for sec in pp["secs"]:
            w.row([float(sec[0]), float(sec[1])], U + ":712 section length m, diameter at section end m")

    w.section("VALVE TYPES  TOpenWAM::ReadValves")
    w.v(len(vtypes), T + ":956 number of valve types")
    LU, LA, DR = "TLumbrera.cpp", "TLamina.cpp", "TDiscoRotativo.cpp"
    for j, vt in enumerate(vtypes):
        w.comment("valve type %d: %s" % (j + 1, vt["note"]))
        k = vt["kind"]
        if k == "cdfix":
            w.v(0, T + ":976 valve type 0 = TCDFijo fixed CD")
            w.row([vt["cd"], vt["cd"], 0], "TCDFijo.cpp:85 CD pipe to plenum, CD plenum to pipe, 0 = referred to the pipe-end area")
        elif k == "port":
            pt = vt["port"]
            w.v(4, T + ":996 valve type 4 = TLumbrera piston-controlled port")
            w.row([round(pt["H"], 9), round(pt["width"], 9), round(pt.get("r_top", 0.0), 9), round(pt.get("r_bot", 0.0), 9), 0.0, 0.0],
                  LU + ":103 height m (port top above BDC crown, opening = this - crown height :138), width, top radius, "
                  "bottom radius (read, unused), position above BDC 0, reference diameter 0 = pipe end")
            w.v(len(vt["opens"]), LU + ":104 number of CD points")
            w.row(vt["opens"], LU + ":111 opening m")
            w.row(vt["cdin"], LU + ":114 CD pipe to cylinder = Cd x exposed window area / pipe-end area")
            w.row(vt["cdout"], LU + ":117 CD cylinder to pipe")
        elif k == "reed":
            lp = vt["lp"]
            w.v(2, T + ":986 valve type 2 = TLamina reed valve")
            if vt["model"] == 1:
                w.row([1, 0.0, 0], LA + ":158 model 1 = 1-D mass-spring-damper, reference diameter 0 = pipe end, 0 = opens when pipe p exceeds plenum p")
                w.row([round(lp["m"], 9), round(lp["c"], 9), round(lp["k"], 6), round(lp["A"], 9)],
                      LA + ":186 mass kg, damping N s/m, stiffness N/m, pressure area m2 (lumped petals, reed_lumped)")
            else:
                w.row([0, 0.0, 0], LA + ":158 model 0 = 0-D, CD from the pressure difference, closed (both CD 0) when it is negative, GetCDin :333-338, GetCDout :420-425; "
                      "reference diameter 0 = pipe end; 0 = opens when pipe p exceeds plenum p")
            w.row([len(vt["cds"]), len(vt["cds"])], LA + ":191 CD points inflow, outflow")
            w.v(round(vt["step"], 9), LA + ":198 table step, " + ("lift m" if vt["model"] == 1 else "pressure difference bar"))
            w.row([1.0, 1.0], LA + ":199 CD multipliers inflow, outflow")
            w.row(vt["cds"], LA + ":202 CD pipe to plenum = Cd x min(perimeter x lift, block window) / pipe-end area")
            w.row(vt["cds"], LA + ":206 CD plenum to pipe")
        elif k == "disc":
            w.v(3, T + ":991 valve type 3 = TDiscoRotativo, CD vs angle")
            w.v(0.0, DR + ":113 reference diameter 0 = pipe end")
            w.row([1.0, 0.0, 1.0], DR + ":114 CD multiplier 1 (the outflow loop multiplies the inflow table again :132), shift, duration factor")
            w.v(len(vt["angles"]), DR + ":116 number of points")
            w.row(vt["angles"], DR + ":123 angle deg on the pipe-to-plenum BC clock = cylinder-1 angle, measured, see notes")
            w.row(vt["cds"], DR + ":127 CD pipe to plenum")
            w.row(vt["cds"], DR + ":131 CD plenum to pipe")
            w.v(1, DR + ":135 speed control 1 = engine")
            w.v(1.0, DR + ":149 speed ratio to the engine")
        else:
            raise ValueError(k)

    w.section("PLENUMS  TOpenWAM::ReadPlenums")
    w.v(len(plenums), T + ":1063 number of plenums")
    w.row([0, 0, 0], T + ":1065 WAMer counts turbines, venturis, directional junctions")
    DV = "TDepVolVariable.cpp"
    for j, pl in enumerate(plenums):
        w.comment("plenum %d: %s" % (j + 1, pl["note"]))
        if pl["kind"] == "crankcase":
            w.v(1, T + ":1089 plenum type 1 = TDepVolVariable, variable volume")
            w.row([float(x) for x in pl["comp"]], "TDeposito.cpp:161 initial mass fractions burnt, fuel, air")
            w.row([float(pl["p_bar"]), float(pl["T_C"])], "TDeposito.cpp:209 initial pressure bar, temperature degC")
            w.row([g["L"], g["S"], g["B"]], DV + ":65 rod m, stroke m, bore m")
            w.row([round(pl["ccr"], 9), float(pl["desfase"]), 0.0],
                  DV + ":66 compression ratio = crankcase CR, Vdead = A S/(CR-1) :91; phase deg = 180 + firing angle, "
                  "minimum volume at BDC IniciaVolumen :221; offset unused")
            w.v(1, DV + ":68 speed control 1 = engine")
            w.v(1.0, DV + ":82 speed ratio to the engine")
        else:
            w.v(0, T + ":1085 plenum type 0 = TDepVolCte constant volume, adiabatic")
            w.row([float(x) for x in pl["comp"]], "TDeposito.cpp:161 initial mass fractions burnt, fuel, air")
            w.row([float(pl["V_m3"]), float(pl["p_bar"]), float(pl["T_C"])], "TDeposito.cpp:185 volume m3, initial pressure bar, temperature degC")
    w.section("COMPRESSORS  TOpenWAM::ReadCompressors")
    w.v(0, T + ":1181 number of compressors")

    w.section("CONNECTIONS  TOpenWAM::ReadConnections")
    w.v(len(order), T + ":1242 number of boundary conditions")
    w.row([0] * 9, T + ":1244 nine WAMer-only counts, read and ignored")
    first_open = True
    for k in order:
        b = bcs[k]
        t = b["type"]
        w.comment("BC%d: %s" % (num[k], b["note"]))
        if t == "open":
            w.v(0, T + ":1260 BC type 0 = open end to atmosphere")
            w.v(float(p["end_loss"]), "TCCDescargaExtremoAbierto.cpp:141 inflow velocity coefficient" + (", 1 = no loss" if first_open else ""))
            first_open = False
        elif t == "closed":
            w.v(3, T + ":1294 BC type 3 = closed end, reads no data")
        elif t == "step":
            w.v(6, T + ":1314 BC type 6 = pipe-to-pipe connection TCCUnionEntreTubos")
            w.row([0.0, 0.0], "TCCUnionEntreTubos.cpp:200 wall thickness m, conductivity W/mK; unused")
        elif t in ("eport", "tport"):
            w.v(8 if t == "eport" else 7, T + (":1335 BC type 8 = exhaust valve BC" if t == "eport" else
                                              ":1324 BC type 7 = intake valve BC, here a transfer / closing port"))
            w.v(0, "TCCCilindro.cpp:169 WAMer id, ignored")
            w.v(int(b["cyl"]), "TCCCilindro.cpp:171 cylinder number")
            w.v(int(b["vt"]), T + ":1460 valve type index 1-based")
        elif t == "branch":
            w.v(12, T + ":1376 BC type 12 = branch TCCRamificacion, takes every pipe end with this number, "
                "reads no data TCCRamificacion.cpp:94-147")
        elif t == "plenum":
            w.v(11, T + ":1366 BC type 11 = pipe-to-plenum connection TCCDeposito")
            w.v(0, "TCCDeposito.cpp:204 WAMer id, ignored")
            w.v(int(b["plenum"]), "TCCDeposito.cpp:206 plenum number")
            w.v(int(b["vt"]), T + ":1460 valve type index 1-based")
        else:
            raise ValueError(t)

    w.section("TURBOCHARGERS, SENSORS, CONTROLLERS")
    w.v(0, T + ":1669 turbocharger axes")
    w.v(0, T + ":1699 sensors")
    w.v(0, T + ":1720 controllers")

    O = "TOutputResults.cpp"
    port_bcs = [k for k in order if bcs[k]["type"] in ("eport", "tport") and "/fix/" not in k]
    w.section("AVERAGE RESULTS  TOutputResults::ReadAverageResults")
    w.v(0, O + ":37 instantaneous results 0 = last cycle only")
    w.v(len(pipes), O + ":63 pipes with average results")
    w.v(0, O + ":64 WAMer number, ignored")
    for i, pp in enumerate(pipes):
        Lp = sum(s[0] for s in pp["secs"])
        w.v(i + 1, O + ":66 pipe %d" % (i + 1))
        w.v(1, U + ":2465 points")
        w.row([Lp / 2.0, 3, 0, 1, 3], U + ":2508 distance m, n vars; vars 0 T, 1 p, 3 mass flow")
    w.v(ncyl, O + ":78 cylinders with average results")
    cyl_avg = [0, 1, 4, 5, 6, 7, 8, 9, 20, 22, 23, 24, 25, 27]
    for c in range(ncyl):
        w.v(c + 1, O + ":80 cylinder %d" % (c + 1))
        w.v(len(cyl_avg), "TCilindro.cpp:738 number of variables")
        w.row(cyl_avg, "TCilindro.cpp:740 0 Wnet 1 NMEP 4 Qcomb 5-7 Q liner head piston 8 IMEP 9 trapped 20 AFR 22 intake "
                       "23 exhaust 24 short-circuit 25 mean T 27 VE")
    w.v(1, O + ":92 engine average results on")
    eng_avg = list(range(0, 23)) + [25, 26]
    w.v(len(eng_avg), E + ":648 number of variables")
    w.row(eng_avg, E + ":650 0-22 torque, work, MEPs, power, masses, rpm, VE, efficiencies, BSFC; 25 F/A; 26 AFR", per_line=25)
    w.v(len(plenums), O + ":105 plenums")
    for j in range(len(plenums)):
        w.v(j + 1, O + ":107 plenum %d" % (j + 1))
        w.row([2, 0, 1], "TDeposito.cpp:791 n vars, 0 pressure, 1 temperature")
    w.v(0, O + ":119 turbocharger axes")
    w.v(0, O + ":133 compressors")
    w.v(0, O + ":147 turbines")
    w.v(len(port_bcs), O + ":161 valves")
    for k in port_bcs:
        w.v(num[k], O + ":163 BC%d %s" % (num[k], bcs[k]["note"]))
        w.row([2, 0, 1], "TTipoValvula.cpp:239 n vars, 0 CD in, 1 CD out")
    w.v(0, O + ":184 root compressors")
    w.v(0, O + ":199 venturis")
    w.v(0, O + ":214 plenum-to-plenum connections")
    w.v(0, O + ":249 sensors")
    w.v(0, O + ":263 controllers")

    w.section("INSTANTANEOUS RESULTS  TOutputResults::ReadInstantaneousResults")
    w.v(ncyl, O + ":540 cylinders")
    cyl_ins = [0, 1, 4, 5, 10, 11, 13, 25]
    for c in range(ncyl):
        w.v(c + 1, O + ":542 cylinder %d" % (c + 1))
        w.v(len(cyl_ins), "TCilindro.cpp:1342 number of variables")
        w.row(cyl_ins, "TCilindro.cpp:1344 0 p 1 T 4 exhaust flow 5 intake flow 10 mass 11 volume 13 burned fraction 25 torque")
    w.v(len(plenums), O + ":554 plenums")
    for j in range(len(plenums)):
        w.v(j + 1, O + ":556 plenum %d" % (j + 1))
        w.row([4, 0, 1, 2, 3], "TDeposito.cpp:746 n vars, 0 pressure 1 temperature 2 volume 3 mass")
    ins_pts = []
    cell = p["cell_mm"] / 1000.0
    for i, pp in enumerate(pipes):
        if bcs[pp["left"]]["type"] == "eport":
            ins_pts.append((i, cell))
    w.v(len(ins_pts), O + ":568 pipes")
    w.v(0, O + ":571 WAMer number, ignored")
    for (i, x) in ins_pts:
        w.v(i + 1, O + ":573 pipe %d" % (i + 1))
        w.v(1, U + ":2700 points")
        w.row([x, 3, 0, 1, 2], U + ":2737 distance m one cell from the exhaust port, n vars; vars 0 p 1 u 2 T")
    w.v(0, O + ":585 venturis")
    ins_valves = port_bcs + [k for k in order if k.endswith("/in/cc")]     # + the reed / intake port into each crankcase
    w.v(len(ins_valves), O + ":599 valves")
    for k in ins_valves:
        w.v(num[k], O + ":601 BC%d %s" % (num[k], bcs[k]["note"]))
        w.row([2, 0, 1], "TTipoValvula.cpp:134 n vars, 0 CD in 1 CD out")
    w.v(0, O + ":621 turbocharger axes")
    w.v(0, O + ":634 compressors")
    w.v(0, O + ":647 turbines")
    w.v(0, O + ":660 root compressors")
    w.v(0, O + ":674 plenum-to-plenum connections")
    w.v(0, O + ":695 waste-gates")
    w.v(0, O + ":721 reed valves")
    w.v(0, O + ":764 sensors")
    w.v(0, O + ":779 controllers")

    w.section("SPACE-TIME RESULTS  TOutputResults::ReadSpaceTimeResults")
    w.v(0, O + ":808 number of space-time quantities, 0 = none")
    w.section("TAIL")
    w.v(0, T + ":531 external DLL 0 = none")
    return w.text()


def make_wam2t(spec, run=None):
    return write_model(model_from_spec(spec, run))


# --------------------------------------------------------------------------------------------- run + summary
EXE = os.environ.get("EXHAUST_TUNER_OPENWAM") or os.path.abspath(os.path.join(HERE, "..", "ext", "OpenWAM", "build", "bin", "release", "OpenWAM"))


def run_model(folder, model, exe=None, timeout=1800):
    """Write <folder>/<name>.wam, run OpenWAM in that folder (it writes tmp files there), return the log text."""
    name = model["p"]["name"]
    os.makedirs(folder, exist_ok=True)
    text = write_model(model)
    with open(os.path.join(folder, name + ".wam"), "w", newline="\n") as f:
        f.write(text)
    for fn in (name + "AVG.DAT", name + "INS.DAT"):
        if os.path.exists(os.path.join(folder, fn)):
            os.remove(os.path.join(folder, fn))
    with open(os.path.join(folder, "run.log"), "w") as lf:
        subprocess.run([exe or EXE, name + ".wam"], cwd=folder, stdout=lf, stderr=subprocess.STDOUT, check=False, timeout=timeout)
    with open(os.path.join(folder, "run.log"), errors="replace") as f:
        return f.read()


def read_table(path):
    with open(path) as f:
        rows = [ln.rstrip("\n").split("\t") for ln in f if ln.strip()]
    head = [h.strip() for h in rows[0]]
    data = []
    for r in rows[1:]:
        try:
            data.append([float(x) for x in r[:len(head)]])
        except ValueError:
            pass
    return head, data


def _col(head, *keys):
    for i, h in enumerate(head):
        if all(k in h for k in keys):
            return i
    raise KeyError("no column with %s in %s" % (keys, head[:12]))


def wam2t_summary(folder, model, fmep_coef=FMEP_COEF_PA):
    """Per-cycle and last-cycle results of a finished run. MEPs in bar, power kW and hp, masses per cycle."""
    p, g = model["p"], model["eng"]
    name = p["name"]
    ncyl = len(model["phases"])
    log = open(os.path.join(folder, "run.log"), errors="replace").read()
    finished = "SIMULATION FINISHED CORRECTLY" in log
    head, data = read_table(os.path.join(folder, name + "AVG.DAT"))
    rho = p["p_amb_bar"] * 1e5 / (287.0 * (p["T_amb_C"] + K0))
    Vd = g["Vd"]
    rpm = p["rpm"]
    omega = 2.0 * math.pi * rpm / 60.0
    rows = []
    for r in data:
        cyc = []
        for c in range(1, ncyl + 1):
            nmep = r[_col(head, "NMEP_Cyl_%d" % c)]
            intake = r[_col(head, "Intake_Mass_Cyl_%d" % c)]
            trapped = r[_col(head, "Trapped_Mass_Cyl_%d" % c)]
            sc = r[_col(head, "Short_Circuit_Mass_Cyl_%d" % c)] if any("Short_Circuit" in h for h in head) else float("nan")
            cyc.append({"NMEP": nmep, "intake": intake, "trapped": trapped, "short_circuit": sc})
        fuel = r[_col(head, "Fuel_Mass")]
        rows.append({"cycle": int(r[_col(head, "Cycle")]), "cyl": cyc, "fuel": fuel})
    last = rows[-1]
    out = {"name": name, "rpm": rpm, "finished": finished, "cycles": len(rows)}
    nm = [sum(c["NMEP"] for c in r["cyl"]) / ncyl for r in rows]
    tail = nm[-5:] if len(nm) >= 5 else nm
    out["NMEP_spread_last5_pct"] = 100.0 * (max(tail) - min(tail)) / abs(sum(tail) / len(tail)) if tail and sum(tail) else float("nan")
    out["NMEP_history"] = nm
    c1 = last["cyl"][0]
    air_trapped = last["fuel"] * g["afr"]          # fuel = trapped air * phi * Fs, Fs*phi = 1/AFR
    out["IMEP_bar"] = sum(c["NMEP"] for c in last["cyl"]) / ncyl     # 2T: the net cylinder work over 360 deg
    out["DR"] = c1["intake"] / (rho * Vd)
    out["TE"] = air_trapped / c1["intake"] if c1["intake"] > 0 else float("nan")
    out["SE"] = air_trapped / c1["trapped"] if c1["trapped"] > 0 else float("nan")
    out["CE"] = air_trapped / (rho * Vd)
    out["short_circuit_kg"] = c1["short_circuit"]
    # crankcase pumping work from the last cycle in INS.DAT
    pmep_cc = []
    try:
        ih, idata = read_table(os.path.join(folder, name + "INS.DAT"))
        for k, pl in enumerate(model["plenums"]):
            if pl["kind"] != "crankcase":
                continue
            ip = _col(ih, "Pressure_plenum_%d" % (k + 1))
            iv = _col(ih, "Volume_plenum_%d" % (k + 1))
            W = 0.0
            for a, b in zip(idata[:-1], idata[1:]):
                W += 0.5 * (a[ip] + b[ip]) * 1e5 * (b[iv] - a[iv])
            pmep_cc.append(W / Vd / 1e5)
    except (OSError, KeyError) as exc:
        out["ins_error"] = str(exc)
    out["crankcase_MEP_bar"] = sum(pmep_cc) / len(pmep_cc) if pmep_cc else float("nan")   # negative = work absorbed
    fmep = fmep_coef * g["S"] * rpm / 1e5
    out["FMEP_bar"] = fmep
    out["BMEP_bar"] = out["IMEP_bar"] + (out["crankcase_MEP_bar"] if pmep_cc else 0.0) - fmep
    mep2kw = lambda mep: mep * 1e5 * Vd * ncyl / (2.0 * math.pi) * omega / 1000.0
    out["T_ind_Nm"] = out["IMEP_bar"] * 1e5 * Vd * ncyl / (2.0 * math.pi)
    out["P_ind_kW"] = mep2kw(out["IMEP_bar"])
    out["T_brake_Nm"] = out["BMEP_bar"] * 1e5 * Vd * ncyl / (2.0 * math.pi)
    out["P_brake_kW"] = mep2kw(out["BMEP_bar"])
    out["P_ind_hp"] = out["P_ind_kW"] / 0.7457
    out["P_brake_hp"] = out["P_brake_kW"] / 0.7457
    # BSFC on the delivered fuel (carburettor fuel goes with all the delivered air, short-circuit included)
    fuel_deliv = c1["intake"] / g["afr"] * ncyl * rpm / 60.0
    out["BSFC_g_kWh"] = fuel_deliv * 3.6e6 / out["P_brake_kW"] if out["P_brake_kW"] > 0 else float("nan")
    return out


def main(argv):
    import json
    if len(argv) < 3:
        raise SystemExit("usage: make_wam2t.py out.wam spec.json [key=value ...]")
    with open(argv[2]) as f:
        spec = json.load(f)
    run = {}
    for a in argv[3:]:
        k, v = a.split("=", 1)
        run[k] = type(RUN_DEFAULTS[k])(float(v)) if isinstance(RUN_DEFAULTS.get(k), (int, float)) else v
    text = make_wam2t(spec, run)
    with open(argv[1], "w", newline="\n") as f:
        f.write(text)
    print("wrote %s (%d lines)" % (argv[1], text.count("\n")))


if __name__ == "__main__":
    main(sys.argv)
