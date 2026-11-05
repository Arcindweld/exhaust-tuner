#!/usr/bin/env python3
"""make_wam.py v2 - write a labelled OpenWAM 2.2 input file (.wam) without WAMer.

v2 extends v1 (../openwam_run/make_wam.py) from one cylinder to multi-cylinder four-strokes:
N cylinders with their own firing angle, each with its own intake runner (open to the
atmosphere) and its own exhaust primary; the primaries meet in one or more junctions
(TCCRamificacion, BC type 12) and run on through the collector sections to an open end.
4-into-1, Tri-Y 4-2-1 (or any number of junction levels) and several separate collectors
(a V8 as two 4-1 banks) are supported. Diameter jumps inside a line become separate pipes
joined by TCCUnionEntreTubos (BC type 6); cones and tapers stay inside one pipe.

Every number is written in the exact order OpenWAM's readers consume it (sequential fscanf),
followed by a <label> naming the source file:line that reads it. See NOTES.md.

v3 (sound) adds the line downstream of the collector and the output needed for sound synthesis:
  * collector.tail (or exhaust.tail when there is no collector): the whole line after the collector /
    megaphone as a list of elements, ending at the open end:
      {"L_mm", "d0_mm", "d1_mm", ["Tw_C"]}   a pipe segment (cone allowed); consecutive segments whose
                                             diameters meet and whose Tw_C agree become one OpenWAM pipe,
                                             a diameter jump or a Tw change starts a new pipe joined by the
                                             step BC (TCCUnionEntreTubos); Tw_C defaults to the collector's
      {"V_litres", ["T0_C"]}                 a muffler as an expansion volume: a constant-volume plenum
                                             (TDepVolCte, plenum type 0) between the pipe before and the pipe
                                             after it, each joined with a pipe-to-plenum BC (TCCDeposito, BC
                                             type 11) through a fixed-CD "valve" (TCDFijo, CD 1 both ways,
                                             referred to the pipe-end area). This captures the low-frequency
                                             expansion-chamber behaviour of a chambered muffler (the volume
                                             acts as a compliance, the sudden area change reflects the pulse,
                                             the 1-D pipe flow stagnates into the volume and re-accelerates
                                             out of it) - NOT the internal baffles, perforated tubes, flow
                                             reversals or packing. TDepVolCte is adiabatic in OpenWAM 2.2
                                             (TDeposito.cpp:111 FHeatPower = 0 for plain plenums), so a wall
                                             temperature has no meaning for it (Tw_C on a plenum is ignored);
                                             T0_C is its initial gas temperature, default = the exhaust pipes'
                                             initial gas temperature (exhaust_Tgas0_C).
      {"outlets": [[seg, ...], [seg, ...], ...]}
                                             only as the LAST element, right after a plenum: a muffler box with
                                             several exits (a bike's underbelly box venting on both sides, a
                                             centre box with two tips). Each outlet is a list of pipe segments
                                             (as above, no plenums) from its own pipe-to-plenum BC (TCCDeposito)
                                             to its own open end. The first outlet uses the line's open-end BC, so
                                             a single-outlet list writes exactly what the plain chain writes.
  * run setting ins_outlet = 1: instantaneous output (pressure, velocity, temperature, mass flow) at the
    LAST node of every exhaust outlet pipe, i.e. the open-end boundary cell (TTubo.cpp:3155-3167 clamps a
    distance past the end to node FNin-1), at the pipe nodes on both sides of every plenum (last node of
    the pipe feeding it, first node of the pipe leaving it: the muffler's inlet and outlet mass flows),
    plus pressure, temperature and mass of every plenum.
  * run setting ins_cycles: 1 (default) = OpenWAM's "last cycle" file (one cycle, TOutputResults.cpp:37
    option 0); N > 1 = option 2, every cycle concatenated in one INS.DAT; readIns() keeps the last N.
    The output cadence is out_step_deg crank degrees (TOutputResults::PlotControl); out_step_for_rate()
    turns a target sample rate into that step; a step smaller than the solver's time step gives a row
    every time step (then the rows are not equally spaced in time: resample on the Time column).
  * readIns(text, opts): reader of INS.DAT -> the open-end node's time, p, u, T, mdot, rho arrays.
v4 (unequal length): exhaust.per_cyl gives each cylinder its own primary geometry and a stage's segs_by_group
  gives each junction group its own branch, for Subaru/Porsche-style unequal-length 4-2-1 manifolds; the firing
  phases plus these lengths produce the half-order (1.5, 2.5 ...) content a symmetric model cannot.

Entry points
    make_wam(p)                 v1 flat parameter dict (DEFAULTS keys), one cylinder. The output
                                is byte-identical to v1 for the same inputs.
    make_wam_spec(spec, run)    the exhaust calculator's simSpec() structure
                                {e, intake, exhaust, opt, n} (SI units, cam-card degrees), plus
                                optional opt.collectors for Tri-Y / several collectors. `run`
                                holds run settings and overrides of any DEFAULTS key
                                (rpm, cycles, name, cell_mm, ...).
    model_from_spec / legacy_model / write_model   the layers underneath.

CLI
    python3 make_wam.py out.wam rpm=6000            # v1 single cylinder, DEFAULTS + overrides
    python3 make_wam.py out.wam params.json         # v1 overrides from JSON
    python3 make_wam.py out.wam spec.json rpm=6000  # spec.json holds a simSpec ("e" key)

Plain Python 3, standard library only. wam_export.js is a line-for-line JavaScript port.
"""
import json
import math
import sys

# Simple species model, gasoline: stoichiometric fuel/air ratio hard-coded in OpenWAM
# (TCilindro.cpp:2201-2203). The SI "Dosado" input is RELATIVE to it (TCilindro.cpp:2735).
FS_GASOLINE_SIMPLE = 0.068468349

START_SHIFT_DEG = 45.0   # where the engine clock starts relative to cylinder 1 firing TDC (see model_from_spec)

DEFAULTS = {
    "name": "single450",
    # ---- run control -------------------------------------------------------------
    "rpm": 8000.0,                # engine speed [rpm]
    "cycles": 25,                 # simulated engine cycles (SimulationDuration)
    "out_step_deg": 1.0,          # crank-angle interval of the instantaneous output [deg]
    # ---- ambient -----------------------------------------------------------------
    "p_amb_bar": 1.013,
    "T_amb_C": 25.0,
    # ---- gas properties: 0 = constant (air, gamma 1.4), 1 = f(composition),
    #      2 = f(composition, temperature)  (TOpenWAM.cpp:610-620)
    "gamma_model": 2,
    # ---- crank train ---------------------------------------------------------------
    "bore_mm": 95.0,
    "stroke_mm": 63.4,
    "rod_mm": 110.0,
    "cr": 13.0,
    # ---- valves (cam-card timing; lift is sin^2 between opening and closing) --------
    "n_int": 2, "d_int_mm": 40.0, "lift_int_mm": 11.0,
    "n_exh": 2, "d_exh_mm": 33.0, "lift_exh_mm": 9.5,
    "ivo_btdc": 35.0, "ivc_abdc": 65.0, "evo_bbdc": 65.0, "evc_atdc": 35.0,
    # effective area per valve = cd * min(pi*d*L, curtain_cap*pi/4*d^2)  (same law as wavesim.js:239)
    "valve_cd": 0.7,
    "curtain_cap": 0.85,
    "lift_step_deg": 1.0,         # angle step of the lift table [deg]
    "cd_step_mm": 0.25,           # lift step of the CD table [mm]
    "cd_clip": 1.0,               # CD referred to the pipe area is clipped here (see notes)
    "valve_spacing_mm": 40.0,     # intake-to-exhaust valve axis distance (short-circuit model only)
    # ---- combustion (single Wiebe, x = 1 - exp(-a*(dθ/Δθ)^(m+1))) ------------------
    "burn_start_btdc": 18.0,
    "burn_dur_deg": 55.0,
    "wiebe_a": 5.0,
    "wiebe_m": 2.0,
    "afr": 12.8,
    "lhv_J_kg": 44.0e6,
    "comb_eff": 0.72,             # share of fuel LHV released into the gas (v1 entry point; spec cases: comb_eff_for)
    "fuel_density": 740.0,        # read but not used by OpenWAM 2.2
    # ---- in-cylinder heat transfer (Woschni), fixed wall temperatures --------------
    "T_piston_C": 176.85, "T_head_C": 176.85, "T_liner_C": 176.85,
    "woschni_cw1": 2.28, "woschni_cw2": 0.308,
    "A_piston_m2": None,          # None -> pi/4*B^2
    "A_head_m2": None,            # None -> pi/4*B^2 + 4*Vc/B (wavesim.js:356 wall area)
    # ---- friction: FMEP[bar] = c0 + c1*(rpm/60) + c2*(rpm/60)^2 + c3*IMEP --------
    "fmep_c0": 0.5, "fmep_c1": 0.012, "fmep_c2": 0.0, "fmep_c3": 0.0,
    # ---- pipes ---------------------------------------------------------------------
    "intake_len_mm": 300.0, "intake_d_mm": 44.0, "intake_Twall_C": 46.85,
    "exhaust_len_mm": 800.0, "exhaust_d_mm": 42.0, "exhaust_Twall_C": 426.85,
    "exhaust_Tgas0_C": 426.85,
    "roughness_mm": 0.02,
    # cell size, checked 2026-11-01 against 7.07 and 5 mm (30 cycles, WOT): net torque and delivered VE within 0.4 %
    # (i4_41 at 4000 and 6000 rpm) and 1.0 % (v8_dual at 5500 rpm). The outflow's single order levels are not
    # settled at 10 mm: on the RS 660 model (no load, 5460 rpm) orders in or next to a dip moved up to 15 dB, while
    # 7.07 and 5 mm agreed within 1 dB on all but one order; use 5 mm for sound
    "cell_mm": 10.0,
    "courant": 0.8,
    "pipe_method": "tvd",         # "tvd" | "lw" | "lw_fct" (lw_fct went NaN on the RS 660 no-load model)
    "fct_option": 1,              # FCT sub-option 0..5 (TTubo.cpp:627-658) if pipe_method="lw_fct"
    "end_loss": 1.0,              # open-end inflow velocity coefficient (1 = isentropic)
    "pipe_htc_mult": 1.0,         # pipe heat-transfer multiplier
    "pipe_fric_mult": 1.0,        # pipe friction multiplier
}

# Settings that only the multi-pipe writer uses (accepted in both entry points).
EXTRA_DEFAULTS = {
    # A diameter jump inside a line: "union" = TCCUnionEntreTubos (BC type 6, sudden expansion with
    # the Borda-Carnot momentum balance / isentropic contraction, BoundaryFunctions.h:203-325) or
    # "branch" = TCCRamificacion with two pipes (constant pressure, the calculator's own junction()).
    "step_bc": "union",
    # points per pipe in the average results: 1 = the midpoint (v1), 3 = one cell from the left end,
    # the midpoint and one cell from the right end (to see the mean mass flow along a pipe)
    "avg_points": 1,
    # instantaneous output at the open end of every exhaust outlet pipe (last node) and in every plenum:
    # 0 = off (v1/v2 files unchanged), 1 = on (needed by wam_sound.py)
    "ins_outlet": 0,
    # 1 = OpenWAM's one-cycle INS.DAT (option 0); N > 1 = all cycles concatenated (option 2), keep the last N
    "ins_cycles": 1,
    # discharge coefficient of the pipe-to-plenum ports, referred to the pipe-end area (TCDFijo both ways)
    "plenum_cd": 1.0,
    # v12: 1 = also the instantaneous output at the intake's open end (the first node of every intake pipe that starts
    # open to the air: the air-filter end of the plenum inlet, or each runner's mouth without a plenum), for the
    # intake's sound; 0 = off (the file unchanged)
    "ins_intake": 0,
    # v14: the open ends' end correction. OpenWAM's open end (TCCDescargaExtremoAbierto) is a constant-pressure
    # discharge: no inertia of the air just outside, so a pipe's resonances come out a little high. With 1 every pipe
    # that ends open to the air (an exhaust outlet, an intake mouth) is written 0.6133 x its end radius longer at that
    # end, the unflanged open-end correction of Levine and Schwinger (1948; Morse and Ingard, Theoretical Acoustics,
    # 9.1, fig. 9.2; the page's END_CORR), as the plane-wave models have it; 0 writes the bare lengths (pre-v14 files).
    "open_end_corr": 1,
}

OPEN_END_CORR = 0.6133   # v14: open-end correction x the end radius (Levine and Schwinger), as the page's END_CORR
HELM_END_CORR = 0.6133   # v13: Helmholtz neck end correction x neck diameter, as the page's HELM_END (Selamet)
R_BURNT = 285.4     # Constantes.h:71 __R::Burnt, gas constant of the burnt gas in the simple species model


def out_step_for_rate(rpm, fs_hz):
    """Crank-angle output step [deg] that gives fs_hz rows per second at rpm (6*rpm deg/s)."""
    return 6.0 * float(rpm) / float(fs_hz)

# Values the exhaust calculator's wave simulation uses that simSpec() does not carry.
CALC_P_ATM_BAR = 1.01325      # exhaust-calculator.html:3768 PATM=101325 Pa
CALC_T_ATM_C = 25.0           # exhaust-calculator.html:3768 TATM=298.15 K
CALC_T0_EXHAUST_K = 700.0     # exhaust-calculator.html:4021, 4033 buildLine(..., 700, 0) primaries and collector
CALC_TWALL_CYL_K = 450.0      # exhaust-calculator.html:4115 e.Twall||450
CALC_CURTAIN_CAP = 0.85       # exhaust-calculator.html:3997 min(pi*d*l, 0.85*pi/4*d^2)
CALC_TATM_K = 298.15          # exhaust-calculator.html:4013 Tw: line.Tw||TATM when a line has no Tw
K0 = 273.15


# --------------------------------------------------------------------------------------
class WamWriter:
    """Collects 'value  <label>' lines; checks every line against CleanLabelsX's limits."""

    def __init__(self):
        self.lines = []

    @staticmethod
    def _clean(label):
        if "<" in label or ">" in label:
            raise ValueError("label may not contain angle brackets: %r" % label)
        return label

    @staticmethod
    def fmt(x):
        if isinstance(x, bool):
            raise TypeError("bool not allowed")
        if isinstance(x, int):
            return "%d" % x
        if isinstance(x, float):
            if x == 0.0:
                return "0"
            s = "%.12g" % x
            return s
        raise TypeError("unsupported value %r" % (x,))

    def section(self, title):
        self.lines.append("")
        self.lines.append("<%s>" % self._clean("==== " + title + " ===="))

    def comment(self, text):
        self.lines.append("<%s>" % self._clean(text))

    def v(self, value, label):
        self.lines.append("%-18s <%s>" % (self.fmt(value), self._clean(label)))

    def row(self, values, label, per_line=10):
        """A table written as several lines; the label goes on the first line."""
        values = list(values)
        for i in range(0, len(values), per_line):
            chunk = " ".join(self.fmt(x) for x in values[i:i + per_line])
            if i == 0:
                self.lines.append("%s <%s>" % (chunk, self._clean(label)))
            else:
                self.lines.append(chunk)

    def text(self):
        for ln in self.lines:
            if len(ln) >= 790:
                raise ValueError("line too long for CleanLabelsX (char line[800]): %s..." % ln[:60])
        return "\n".join(self.lines) + "\n"     # trailing newline is required by CleanLabelsX


# --------------------------------------------------------------------------------------
def engine_derived(p):
    """Engine geometry and timing derived from the parameter dict (SI units)."""
    d = {}
    B = p["bore_mm"] / 1000.0
    S = p["stroke_mm"] / 1000.0
    d["B"], d["S"], d["rod"] = B, S, p["rod_mm"] / 1000.0
    d["Ap"] = math.pi / 4.0 * B * B
    d["Vd"] = d["Ap"] * S
    d["Vc"] = d["Vd"] / (p["cr"] - 1.0)
    d["A_piston"] = p["A_piston_m2"] if p["A_piston_m2"] else d["Ap"]
    d["A_head"] = p["A_head_m2"] if p["A_head_m2"] else d["Ap"] + 4.0 * d["Vc"] / B
    # cylinder crank angle frame: 0 = firing TDC, 360 = gas-exchange TDC (TCilindro4T.cpp:277-284, 531-577)
    d["ivo"] = 360.0 - p["ivo_btdc"]
    d["ivc"] = 540.0 + p["ivc_abdc"]
    d["evo"] = 180.0 - p["evo_bbdc"]
    d["evc"] = 360.0 + p["evc_atdc"]
    d["dur_int"] = d["ivc"] - d["ivo"]
    d["dur_exh"] = d["evc"] - d["evo"]
    for k in ("ivo", "ivc", "evo", "evc"):
        if not (0.0 < d[k] < 720.0):
            raise ValueError("%s=%g must lie inside (0,720) for TValvula4T::GetCDin" % (k, d[k]))
    d["phi"] = (1.0 / p["afr"]) / FS_GASOLINE_SIMPLE
    if d["phi"] * p["comb_eff"] > 1.0:
        sys.stderr.write("WARNING: comb_eff*phi > 1: OpenWAM will run out of air before the Wiebe "
                         "law ends (TCilindro4T.cpp:643-664) and truncate the burn\n")
    if not (p["valve_spacing_mm"] > max(p["d_int_mm"], p["d_exh_mm"]) / 2.0):
        raise ValueError("valve_spacing_mm must exceed the larger valve radius: asin(d/2/spacing) TCilindro.cpp:555")
    return d


def lift_table(lmax_mm, dur_deg, step_deg):
    n = int(round(dur_deg / step_deg))
    if abs(n * step_deg - dur_deg) > 1e-9:
        raise ValueError("valve duration %g is not a multiple of lift_step_deg %g" % (dur_deg, step_deg))
    return [round(lmax_mm * math.sin(math.pi * i / n) ** 2, 6) for i in range(n + 1)]


def profile_table(prof, dur_deg, step_deg):
    """A measured lift profile (profile_events) as OpenWAM's lift table: lift every step_deg from the opening, linear
    between the given points, 0 outside them."""
    n = int(round(dur_deg / step_deg))
    if abs(n * step_deg - dur_deg) > 1e-9:
        raise ValueError("valve duration %g is not a multiple of lift_step_deg %g" % (dur_deg, step_deg))
    xs, ys = prof["deg"], prof["mm"]
    out = []
    for i in range(n + 1):
        a = prof["a0"] + i * step_deg
        v = 0.0
        if xs[0] <= a <= xs[-1]:
            k = 0
            while k < len(xs) - 2 and xs[k + 1] < a:
                k += 1
            t = (a - xs[k]) / (xs[k + 1] - xs[k])
            v = ys[k] + t * (ys[k + 1] - ys[k])
        out.append(round(max(0.0, v), 6))
    return out


def profile_events(cam, pr, kind):
    """spec.e.camProfile.in / .ex: {deg: [crank degrees from the lobe's centreline, increasing], mm: [valve lift],
    [cl: the centreline, intake deg ATDC / exhaust deg BTDC; default from the cam card's events]} -> the seat events
    (opening and closing whole degrees from the centreline, outward from where the lift leaves and returns to zero) and
    the profile for profile_table. Returns (open, close) as (ivo BTDC, ivc ABDC) or (evo BBDC, evc ATDC), and the profile."""
    xs, ys = [float(x) for x in pr["deg"]], [float(y) for y in pr["mm"]]
    if len(xs) != len(ys) or len(xs) < 3:
        raise ValueError("camProfile.%s: deg and mm need the same number of points, at least 3" % kind)
    if any(xs[i + 1] <= xs[i] for i in range(len(xs) - 1)):
        raise ValueError("camProfile.%s: deg must increase" % kind)
    if any(y < 0 for y in ys) or max(ys) <= 0:
        raise ValueError("camProfile.%s: lifts must be zero or more, with some lift" % kind)
    nz = [i for i, y in enumerate(ys) if y > 0]
    i0, i1 = max(0, nz[0] - 1), min(len(xs) - 1, nz[-1] + 1)
    a0, a1 = math.floor(xs[i0]), math.ceil(xs[i1])
    if kind == "in":
        cl = float(pr["cl"]) if pr.get("cl") is not None else (180.0 + float(cam["ivc"]) - float(cam["ivo"])) / 2.0
        ev = (round01(-(cl + a0)), round01(cl + a1 - 180.0))
    else:
        cl = float(pr["cl"]) if pr.get("cl") is not None else (180.0 + float(cam["evo"]) - float(cam["evc"])) / 2.0
        ev = (round01(cl - a0 - 180.0), round01(a1 - cl))
    return ev, {"a0": float(a0), "deg": xs, "mm": ys, "cl": cl, "max_mm": max(ys)}


def cd_table(n_valves, d_mm, lmax_mm, step_mm, cd, cap, a_pipe_m2, clip):
    """CD referred to the pipe-end area, as a function of lift [mm], 0..lmax (and a bit past)."""
    npts = int(math.ceil(lmax_mm / step_mm - 1e-9)) + 1
    out = []
    for i in range(npts):
        L = i * step_mm
        a_valve_mm2 = min(math.pi * d_mm * L, cap * math.pi / 4.0 * d_mm * d_mm)
        val = n_valves * cd * a_valve_mm2 * 1e-6 / a_pipe_m2
        out.append(round(min(clip, val), 6))
    return npts, out


# --------------------------------------------------------------------------------------
# The model: p (flat parameters, DEFAULTS keys), phases (firing angle of each cylinder, deg after
# cylinder 1), pipes (list) and bcs (dict key -> BC). Pipe: role, left, right (BC keys), D0 [m],
# secs [[L m, D_end m], ...], Tw_C, Tg_C, comp [burnt, fuel, air], ht (1 intake / 2 exhaust).
# BC: type open|ivalve|evalve|branch|step|plenum|reservoir, cyl (1-based, valves), plenum (1-based, plenum ports),
#     p_bar, T_C, comp (reservoir: an open end into a space held at fixed pressure and temperature), note.
# plenums (optional list): V_m3, T_C (initial gas temperature), p_bar, comp [burnt, fuel, air], note.
# BCs are numbered in order of first reference, walking the pipes in order, left end first.
BC_DESC = {"open": "open end", "closed": "closed end", "ivalve": "intake valve", "evalve": "exhaust valve",
           "branch": "junction", "step": "diameter step", "plenum": "plenum port", "reservoir": "reservoir",
           "loss": "pressure loss"}
BC_ENDS = {"open": (1, 1), "closed": (1, 1), "ivalve": (1, 1), "evalve": (1, 1), "step": (2, 2), "branch": (2, 999), "plenum": (1, 1),
           "reservoir": (1, 1), "loss": (2, 2)}


def pipe_len(pp):
    s = 0.0
    for sec in pp["secs"]:
        s += sec[0]
    return s


def end_D(pp, side):
    return pp["D0"] if side == "left" else pp["secs"][-1][1]


def number_model(m):
    pipes, bcs = m["pipes"], m["bcs"]
    num, order, ends = {}, [], {}
    for i, pp in enumerate(pipes):
        if pp["left"] == pp["right"]:
            raise ValueError("pipe %d has the same BC at both ends" % (i + 1))
        if not pp["secs"]:
            raise ValueError("pipe %d has no sections" % (i + 1))
        for side in ("left", "right"):
            k = pp[side]
            if k not in bcs:
                raise ValueError("pipe %d refers to unknown BC %r" % (i + 1, k))
            if k not in num:
                order.append(k)
                num[k] = len(order)
            ends.setdefault(k, []).append((i, side))
    for k in sorted(bcs):
        if k not in num:
            raise ValueError("BC %r is not attached to any pipe" % k)
    for k in order:
        b = bcs[k]
        lo, hi = BC_ENDS[b["type"]]
        if not (lo <= len(ends[k]) <= hi):
            raise ValueError("BC %r of type %s has %d pipe ends" % (k, b["type"], len(ends[k])))
    return num, order, ends


def write_model(m):
    p = m["p"]
    d = engine_derived(p)
    phases = m["phases"]
    ncyl = len(phases)
    pipes, bcs = m["pipes"], m["bcs"]
    num, order, ends = number_model(m)
    pnum = lambda k: ends[k][0][0] + 1     # pipe number of a one-ended BC
    for k in order:
        b = bcs[k]
        if b["type"] in ("ivalve", "evalve") and not (1 <= b["cyl"] <= ncyl):
            raise ValueError("valve BC %r refers to cylinder %r" % (k, b["cyl"]))
    for c in range(1, ncyl + 1):
        for t in ("ivalve", "evalve"):
            if not [k for k in order if bcs[k]["type"] == t and bcs[k]["cyl"] == c]:
                raise ValueError("cylinder %d has no %s" % (c, BC_DESC[t]))
    for ph in phases:
        if not (0.0 <= ph < 720.0):
            raise ValueError("firing angle %g must lie in [0, 720)" % ph)
    plenums = m.get("plenums") or []
    plenum_bcs = [k for k in order if bcs[k]["type"] == "plenum"]
    for k in plenum_bcs:
        if not (1 <= bcs[k]["plenum"] <= len(plenums)):
            raise ValueError("plenum BC %r refers to plenum %r of %d" % (k, bcs[k]["plenum"], len(plenums)))
    for j in range(len(plenums)):
        if not [k for k in plenum_bcs if bcs[k]["plenum"] == j + 1]:
            raise ValueError("plenum %d has no pipe connected" % (j + 1))
        if not (plenums[j]["V_m3"] > 0.0):
            raise ValueError("plenum %d volume must be positive" % (j + 1))

    # valve types: one per (intake/exhaust, pipe-end diameter), in order of first use
    vkeys, vt_of = [], {}
    for k in order:
        b = bcs[k]
        if b["type"] in ("ivalve", "evalve"):
            i, side = ends[k][0]
            key = (b["type"], end_D(pipes[i], side))
            if key not in vkeys:
                vkeys.append(key)
            vt_of[k] = vkeys.index(key) + 1
    n_side = {"ivalve": 0, "evalve": 0}
    for key in vkeys:
        n_side[key[0]] += 1

    w = WamWriter()
    T = "TOpenWAM.cpp"
    w.comment("OpenWAM 2.2 input written by make_wam.py - %s, %g rpm" % (p["name"], p["rpm"]))
    w.comment("labels give the reader source file:line; units as used by that reader")

    # ---------------------------------------------------------------- header
    w.section("HEADER  TOpenWAM::ReadInputData")
    w.v(2200, T + ":477 version, must equal vers 2200 Globales.h:53")
    w.v(0, T + ":485 Independent 0 = common time step for all pipes")

    # ---------------------------------------------------------------- general data
    w.section("GENERAL DATA  TOpenWAM::ReadGeneralData")
    w.v(float(p["out_step_deg"]), T + ":606 agincr, instantaneous output interval deg")
    w.v(int(p["cycles"]), T + ":606 SimulationDuration = number of engine cycles")
    w.v(float(p["p_amb_bar"]), T + ":607 ambient pressure bar")
    w.v(float(p["T_amb_C"]), T + ":607 ambient temperature degC")
    w.v(0, T + ":608 species model 0 = simple: burnt gas, fuel, air")
    w.v(int(p["gamma_model"]), T + ":608 gamma 0 const, 1 f-composition, 2 f-composition-temperature")
    w.v(1, T + ":622 engine block present")
    w.v(0, T + ":627 cycle type, 1 = 2T, anything else = 4T")
    w.v(0, T + ":627 simulation type 0 = steady speed")
    w.v(0, T + ":627 EGR transport 0 = no")
    w.v(1, T + ":743 fuel present")
    w.v(1, T + ":745 fuel type 1 = gasoline")
    w.row([0.0, 0.0, 1.0], T + ":802 atmosphere mass fractions burnt, fuel, air; sum must be exactly 1")

    # ---------------------------------------------------------------- engine
    E = "TBloqueMotor.cpp"
    w.section("ENGINE  TBloqueMotor::LeeMotor")
    w.v(0, E + ":117 ACT combustion model 0 = off, Wiebe law used")
    w.v(ncyl, E + ":134 number of cylinders")
    w.v(float(p["rpm"]), E + ":148 engine speed rpm")
    w.v(float(p["p_amb_bar"]), E + ":149 initial cylinder pressure at IVC bar")
    m0 = p["p_amb_bar"] * 1e5 * (d["Vd"] + d["Vc"]) / (287.0 * (p["T_amb_C"] + 273.15 + 35.0))
    w.v(round(m0, 9), E + ":150 initial cylinder mass kg, start-up guess only")
    w.v(0, E + ":153 impose composition at EVO 0 = no")
    w.row([0.0, 0.0, 1.0], E + ":156 initial cylinder mass fractions burnt, fuel, air")
    w.v(0, E + ":176 pressure at EVO 0 = calculated")
    w.v(1, E + ":185 combustion type 1 = spark ignition, fuel from trapped air")
    w.v(round(d["phi"], 10), E + ":196 relative fuel-air ratio = (1/AFR)/0.068468349, TCilindro.cpp:2735")
    w.v(float(p["comb_eff"]), E + ":199 combustion efficiency, multiplies released heat TCilindro4T.cpp:634")
    w.v(float(p["lhv_J_kg"]), E + ":200 lower heating value J/kg")
    w.v(float(p["fuel_density"]), E + ":201 fuel density kg/m3, not used")
    ve_keys = [k for k in order if bcs[k]["type"] == "ivalve" and bcs[k]["cyl"] == 1]
    vep = pnum(ve_keys[0])
    w.v(vep, E + ":203 pipe used for volumetric efficiency, %d = intake pipe" % vep +
        ("" if ncyl == 1 else " of cylinder 1; engine VE then counts one runner, use the per-cylinder VE"))
    w.v(float(p["T_piston_C"]), E + ":209 piston wall temperature degC")
    w.v(float(p["T_head_C"]), E + ":210 head wall temperature degC")
    w.v(float(p["T_liner_C"]), E + ":211 liner wall temperature degC")
    w.v(round(d["A_piston"], 9), E + ":213 piston heat-transfer area m2")
    w.v(round(d["A_head"], 9), E + ":214 head heat-transfer area m2")
    w.row([0.01, 150.0, 2700.0, 900.0], E + ":216 piston wall thickness m, k W/mK, rho, cp; unused, walls fixed")
    w.row([0.01, 150.0, 2700.0, 900.0], E + ":218 head wall thickness m, k, rho, cp; unused")
    w.row([0.01, 150.0, 2700.0, 900.0], E + ":220 liner wall thickness m, k, rho, cp; unused")
    w.row([1.0, 1.0, 50.0, 90.0], E + ":223 HT multiplier intake stroke, exhaust stroke, torque at max power Nm, coolant degC")
    w.v(2, E + ":225 wall temperature 2 = fixed, CalculaTemperaturasPared skipped TCilindro4T.cpp:579")
    w.v(float(p["woschni_cw1"]), E + ":241 Woschni cw1 compression-expansion")
    w.v(float(p["woschni_cw2"]), E + ":242 Woschni cw2, multiplies swirl velocity, zero here")
    w.v(0.0, E + ":243 Woschni xpe, read but not used")
    w.v(d["rod"], E + ":249 connecting rod length m")
    w.v(d["S"], E + ":250 stroke m")
    w.v(d["B"], E + ":251 bore m")
    w.v(float(p["cr"]), E + ":252 compression ratio")
    w.v(0.0, E + ":253 bowl diameter m, 0 = flat, no squish swirl")
    w.v(0.0, E + ":254 bowl height m")
    w.v(p["valve_spacing_mm"] / 1000.0, E + ":255 distance between valves m, short-circuit model, must exceed valve radius")
    w.v(0.0, E + ":256 blow-by area")
    w.v(0.0, E + ":257 blow-by CD, 0 = no blow-by TCilindro4T.cpp:355")
    w.v(0.0, E + ":258 piston pin offset mm, TCilindro.cpp:1951 divides by 1000")
    w.v(0.02, E + ":259 pin diameter m, used only if deformation coef non-zero")
    w.v(0.03, E + ":260 piston crown height m, deformation only")
    w.v(0.35, E + ":261 rod mass kg, deformation only")
    w.v(0.35, E + ":262 piston+rings+pin mass kg, deformation only")
    w.v(2.1e11, E + ":263 elastic modulus Pa, deformation only")
    w.v(0.0, E + ":264 deformation coefficient 0 = rigid")
    w.row([float(p["fmep_c0"]), float(p["fmep_c1"]), -float(p["fmep_c2"]), float(p["fmep_c3"])],
          E + ":274 FMEP bar = C0 + C1*n/60 - C2*(n/60)^2 + C3*IMEP, TBloqueMotor.cpp:1073")
    w.v(1, E + ":358 number of burn laws")
    w.row([round(m0, 9), round(m0 / p["afr"], 12), float(p["rpm"])],
          E + ":360 law reference air mass kg, fuel mass kg, rpm; only used to blend several laws")
    w.v(1, E + ":367 number of Wiebe functions")
    w.row([float(p["wiebe_m"]), float(p["wiebe_a"]), 1.0, float(p["burn_dur_deg"]), float(p["burn_start_btdc"])],
          E + ":369 Wiebe m, C=a, share, duration deg, start deg BTDC entered positive")
    w.v(0, E + ":384 injection data 0 = none, SI default timing used TCilindro4T.cpp:179-182")
    if ncyl > 1:
        w.v(0, E + ":446 firing angles 0 = one angle per cylinder, in cylinder order, read at 457")
        for c, ph in enumerate(phases):
            w.v(float(ph), E + ":457 cylinder %d fires at this engine angle deg; its angle = engine angle - this, "
                "TCilindro.cpp:2001-2004" % (c + 1))
    w.v(0, E + ":485 engine controllers")
    for c in range(ncyl):
        w.v(0, E + ":503 controllers for cylinder %d" % (c + 1))

    # ---------------------------------------------------------------- pipes
    U = "TTubo.cpp"
    w.section("PIPES  TOpenWAM::ReadPipes")
    w.v(len(pipes), T + ":852 number of pipes")
    method = {"tvd": [2], "lw": [0, 0], "lw_fct": [0, 1, int(p["fct_option"])]}[p["pipe_method"]]
    for i, pp in enumerate(pipes):
        nl, nr = num[pp["left"]], num[pp["right"]]
        w.comment("%s pipe %d, %s BC%d to %s BC%d" % (pp["role"], i + 1, BC_DESC[bcs[pp["left"]]["type"]], nl,
                                                     BC_DESC[bcs[pp["right"]]["type"]], nr))
        w.row([nl, nr, len(pp["secs"]), 1], U + ":546 left BC, right BC, number of sections, number of identical ducts")
        w.v(float(p["roughness_mm"]), U + ":547 wall roughness mm, Colebrook rug/3700/D TTubo.cpp:2121")
        w.row([float(pp["Tw_C"]), float(pp["Tg_C"]), float(p["p_amb_bar"]), 0.0],
              U + ":548 initial wall T degC, gas T degC, pressure bar, velocity m/s")
        w.row([int(pp["ht"]), float(p["pipe_htc_mult"]), float(p["pipe_fric_mult"])],
              U + ":549 HT type 1 intake 2 exhaust, HT multiplier, friction multiplier")
        w.row([float(x) for x in pp["comp"]], U + ":568 initial mass fractions burnt, fuel, air")
        w.row([p["cell_mm"] / 1000.0, 2], U + ":590 mesh size m, wall T 2 = constant")
        if method[0] == 2:
            w.v(2, U + ":604 solver 2 = TVD")
        else:
            w.v(0, U + ":604 solver 0 = Lax-Wendroff family")
            w.v(method[1], U + ":608 0 = plain LW, 1 = LW+FCT")
            if method[1] == 1:
                w.v(method[2], U + ":626 FCT option")
        w.v(float(p["courant"]), U + ":665 Courant number")
        w.v(float(pp["D0"]), U + ":710 diameter at section start m")
        for sec in pp["secs"]:
            w.row([float(sec[0]), float(sec[1])], U + ":712 section length m, diameter at section end m")
        w.comment("TTubo.cpp:716-776 reads no wall data: wall T constant and HT type 1 or 2")

    # ---------------------------------------------------------------- valves
    V = "TValvula4T.cpp"
    w.section("VALVE TYPES  TOpenWAM::ReadValves")
    n_vtypes = len(vkeys) + (1 if plenum_bcs else 0)
    cd_vtype = len(vkeys) + 1        # index of the fixed-CD type used by every pipe-to-plenum port
    w.v(n_vtypes, T + ":956 number of valve types")
    for j, (vtype, Dend) in enumerate(vkeys):
        a_pipe = math.pi / 4.0 * Dend * Dend
        extra = ", pipe end %g mm" % (Dend * 1000.0) if n_side[vtype] > 1 else ""
        if vtype == "ivalve":
            w.comment("valve type %d: intake, %d x %g mm, %g mm lift, IVO %g BTDC IVC %g ABDC%s" %
                      (j + 1, p["n_int"], p["d_int_mm"], p["lift_int_mm"], p["ivo_btdc"], p["ivc_abdc"], extra))
            dv, lmax, dur, ao, nv = p["d_int_mm"], p["lift_int_mm"], d["dur_int"], d["ivo"], p["n_int"]
        else:
            w.comment("valve type %d: exhaust, %d x %g mm, %g mm lift, EVO %g BBDC EVC %g ATDC%s" %
                      (j + 1, p["n_exh"], p["d_exh_mm"], p["lift_exh_mm"], p["evo_bbdc"], p["evc_atdc"], extra))
            dv, lmax, dur, ao, nv = p["d_exh_mm"], p["lift_exh_mm"], d["dur_exh"], d["evo"], p["n_exh"]
        w.v(1, T + ":974 valve type 1 = TValvula4T poppet valve")
        prof = p.get("lift_profile_int" if vtype == "ivalve" else "lift_profile_exh")
        lifts = profile_table(prof, dur, p["lift_step_deg"]) if prof else lift_table(lmax, dur, p["lift_step_deg"])
        ncd, cds = cd_table(nv, dv, lmax, p["cd_step_mm"], p["valve_cd"], p["curtain_cap"], a_pipe, p["cd_clip"])
        w.v(dv / 1000.0, V + ":149 valve diameter m, short-circuit model only")
        w.v(len(lifts), V + ":149 number of lift points")
        w.v(float(p["lift_step_deg"]), V + ":149 angle step deg")
        w.v(float(ao), V + ":149 opening angle, cylinder frame 0 = firing TDC")
        w.v(0.0, V + ":149 reference diameter 0 = CD referred to pipe-end area TTipoValvula.cpp:89,323")
        w.v(0.0, V + ":149 mean swirl coefficient")
        w.row(lifts, V + ":162 lift mm, " + ("measured profile, centreline %g deg %s" % (prof["cl"], "ATDC" if vtype == "ivalve" else "BTDC")
                                             if prof else "sin^2 profile") + ", closes at opening + (n-1)*step")
        w.v(ncd, V + ":165 number of CD points")
        w.v(float(p["cd_step_mm"]), V + ":165 lift step of CD table mm")
        w.row(cds, V + ":174 CD inflow pipe to cylinder")
        w.row(cds, V + ":177 CD outflow cylinder to pipe")
        w.row([0.0] * ncd, V + ":180 swirl coefficient vs lift")
        w.v(1, V + ":183 speed control 1 = engine")
        w.v(1.0, V + ":197 cam to engine speed ratio, angle taken from cylinder")
        w.v(0, V + ":204 VVT controllers")
    if plenum_bcs:
        w.comment("valve type %d: fixed discharge coefficient, used by every pipe-to-plenum port" % cd_vtype)
        w.v(0, T + ":974 valve type 0 = TCDFijo fixed CD")
        w.row([float(p["plenum_cd"]), float(p["plenum_cd"]), 0],
              "TCDFijo.cpp:85 CD pipe to plenum, CD plenum to pipe, 0 = referred to the pipe-end area")

    # ---------------------------------------------------------------- plenums, compressors
    w.section("PLENUMS  TOpenWAM::ReadPlenums")
    w.v(len(plenums), T + ":1063 number of plenums")
    w.row([0, 0, 0], T + ":1065 WAMer counts turbines, venturis, directional junctions")
    for j, pl in enumerate(plenums):
        w.comment("plenum %d: %s" % (j + 1, pl["note"]))
        w.v(0, T + ":1078 plenum type 0 = TDepVolCte constant volume, adiabatic (TDeposito.cpp:111)")
        w.row([float(x) for x in pl["comp"]], "TDeposito.cpp:161 initial mass fractions burnt, fuel, air")
        w.row([float(pl["V_m3"]), float(pl["p_bar"]), float(pl["T_C"])],
              "TDeposito.cpp:185 volume m3, initial pressure bar, initial gas temperature degC")
    w.section("COMPRESSORS  TOpenWAM::ReadCompressors")
    w.v(0, T + ":1181 number of compressors")

    # ---------------------------------------------------------------- connections
    w.section("CONNECTIONS  TOpenWAM::ReadConnections")
    w.v(len(order), T + ":1242 number of boundary conditions")
    w.row([0] * 9, T + ":1244 nine WAMer-only counts, read and ignored")
    first_open = True
    for k in order:
        b = bcs[k]
        t = b["type"]
        note = b["note"]
        if t == "branch":
            note += ", joins pipes " + ", ".join("%d %s" % (i + 1, s) for (i, s) in ends[k])
        w.comment("BC%d: %s" % (num[k], note))
        if t == "open":
            w.v(0, T + ":1256 BC type 0 = open end to atmosphere")
            w.v(float(p["end_loss"]), "TCCDescargaExtremoAbierto.cpp:141 inflow velocity coefficient" +
                (", 1 = no loss" if first_open else ""))
            first_open = False
        elif t in ("ivalve", "evalve"):
            if t == "ivalve":
                w.v(7, T + ":1256 BC type 7 = intake valve")
            else:
                w.v(8, T + ":1256 BC type 8 = exhaust valve")
            w.v(0, "TCCCilindro.cpp:169 WAMer id, ignored")
            w.v(int(b["cyl"]), "TCCCilindro.cpp:171 cylinder number")
            w.v(vt_of[k], T + ":1460 valve type index 1-based = valve type %d" % vt_of[k])
        elif t == "branch":
            w.v(12, T + ":1376 BC type 12 = branch TCCRamificacion, takes every pipe end with this number, "
                "reads no data TCCRamificacion.cpp:94-147")
        elif t == "closed":
            w.v(3, T + ":1294 BC type 3 = closed end TCCExtremoCerrado, reads no data")
        elif t == "loss":
            w.v(10, T + ":1356 BC type 10 = quadratic pressure loss TCCPerdidadePresion between two pipe ends")
            w.v(float(b["K"]), "TCCPerdidadePresion.cpp:134 loss coefficient K on the velocity head of the pipe the flow leaves")
        elif t == "step":
            w.v(6, T + ":1314 BC type 6 = pipe-to-pipe connection TCCUnionEntreTubos")
            w.row([0.0, 0.0], "TCCUnionEntreTubos.cpp:200 wall thickness m, conductivity W/mK; wall conduction "
                  "only, unused with constant wall T")
        elif t == "reservoir":
            w.v(1, T + ":1272 BC type 1 = open end into a reservoir at fixed pressure and temperature")
            w.row([float(b["p_bar"]), float(b["T_C"]), float(p["end_loss"])],
                  "TCCDescargaExtremoAbierto.cpp:144 reservoir pressure bar, temperature degC, inflow velocity coefficient")
            w.v(0, "TCCDescargaExtremoAbierto.cpp:147 0 = this reservoir is not the engine exhaust")
            w.row([float(x) for x in b["comp"]], "TCCDescargaExtremoAbierto.cpp:154 reservoir mass fractions burnt, fuel, air")
        elif t == "plenum":
            w.v(11, T + ":1366 BC type 11 = pipe-to-plenum connection TCCDeposito")
            w.v(0, "TCCDeposito.cpp:204 WAMer id, ignored")
            w.v(int(b["plenum"]), "TCCDeposito.cpp:206 plenum number")
            w.v(cd_vtype, T + ":1460 valve type index 1-based = valve type %d, fixed CD" % cd_vtype)
        else:
            raise ValueError("unknown BC type %r" % t)

    w.section("TURBOCHARGERS, SENSORS, CONTROLLERS")
    w.v(0, T + ":1669 turbocharger axes")
    w.v(0, T + ":1699 sensors")
    w.v(0, T + ":1720 controllers")

    # ---------------------------------------------------------------- output
    O = "TOutputResults.cpp"
    cell = p["cell_mm"] / 1000.0
    valve_bcs = [k for k in order if bcs[k]["type"] in ("ivalve", "evalve")]
    cyl_sfx = lambda k: "" if ncyl == 1 else ", cylinder %d" % bcs[k]["cyl"]

    w.section("AVERAGE RESULTS  TOutputResults::ReadAverageResults")
    ins_cycles = int(p["ins_cycles"])
    if ins_cycles < 1:
        raise ValueError("ins_cycles must be 1 or more")
    if ins_cycles == 1:
        w.v(0, O + ":37 instantaneous results 0 = last cycle only")
    else:
        w.v(2, O + ":37 instantaneous results 2 = all cycles concatenated in one INS file; readIns keeps the last %d"
            % ins_cycles)
    w.v(len(pipes), O + ":63 pipes with average results")
    w.v(0, O + ":64 WAMer number, ignored")
    for i, pp in enumerate(pipes):
        L = pipe_len(pp)
        h = min(cell, L / 2.0)
        apts = [L / 2.0] if int(p["avg_points"]) == 1 else [h, L / 2.0, L - h]
        w.v(i + 1, O + ":66 pipe %d" % (i + 1))
        w.v(len(apts), U + ":2465 points")
        for j, x in enumerate(apts):
            w.row([x, 3, 0, 1, 3], U + ":2508 distance m, n vars; %svars 0 T, 1 p, 3 mass flow" %
                  ("2511 " if i == 0 and j == 0 else ""))
    w.v(ncyl, O + ":78 cylinders with average results")
    cyl_avg = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 20, 22, 23, 24, 25, 27]
    for c in range(ncyl):
        w.v(c + 1, O + ":80 cylinder %d" % (c + 1))
        w.v(len(cyl_avg), "TCilindro.cpp:738 number of variables")
        w.row(cyl_avg, "TCilindro.cpp:740 0 Wnet 1 NMEP 2 Wpump 3 PMEP 4 Qcomb 5-7 Q liner head piston "
                       "8 IMEP 9 trapped 20 AFR 22 intake 23 exhaust 24 short-circuit 25 mean T 27 VE")
    w.v(1, O + ":92 engine average results on")
    eng_avg = list(range(0, 23)) + [25, 26]
    w.v(len(eng_avg), E + ":648 number of variables")
    w.row(eng_avg, E + ":650 0-22 torque, work, MEPs, power, masses, rpm, VE, efficiencies, BSFC; 25 F/A; 26 AFR",
          per_line=25)
    w.v(len(plenums), O + ":105 plenums")
    for j in range(len(plenums)):
        w.v(j + 1, O + ":107 plenum %d" % (j + 1))
        w.row([2, 0, 1], "TDeposito.cpp:791 n vars, 0 pressure, 1 temperature")
    w.v(0, O + ":119 turbocharger axes")
    w.v(0, O + ":133 compressors")
    w.v(0, O + ":147 turbines")
    w.v(len(valve_bcs), O + ":161 valves")
    for k in valve_bcs:
        w.v(num[k], O + ":163 BC%d %s%s" % (num[k], BC_DESC[bcs[k]["type"]], cyl_sfx(k)))
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
        w.row([3, 0, 1, 3], "TDeposito.cpp:746 n vars, 0 pressure 1 temperature 3 mass")
    ins_outlet = int(p["ins_outlet"]) == 1
    ins_pts = []      # (pipe index, [(distance, what, vars)])
    for i, pp in enumerate(pipes):
        L = pipe_len(pp)
        h = min(cell, L / 2.0)
        pts = []
        tl, tr = bcs[pp["left"]]["type"], bcs[pp["right"]]["type"]
        if tl in ("ivalve", "evalve"):
            pts.append((h, "near the valve", [0, 1, 2]))
        elif tl == "branch":
            pts.append((h, "after the junction", [0, 1, 2]))
        if tr in ("ivalve", "evalve"):
            pts.append((L - h, "near the valve", [0, 1, 2]))
        if ins_outlet and tl == "plenum":
            pts.append((0.0, "= first node, plenum outlet port", [0, 1, 2, 3]))      # x = 0 -> node 0 (TTubo.cpp:3212)
        if int(p["ins_intake"]) == 1 and tl == "open" and int(pp["ht"]) == 1:
            pts.append((0.0, "= first node, the intake's open end", [0, 1, 2, 3]))
        if ins_outlet and tr == "plenum":
            pts.append((L + cell / 2.0, "= past the end, clamped to the last node, plenum inlet port", [0, 1, 2, 3]))
        if ins_outlet and tr == "open" and int(pp["ht"]) == 2:
            # past the end on purpose: TTubo.cpp:3155-3157 floor(x/dx) >= FNin-1 selects the last node (the
            # open-end boundary cell) whatever the rounding of L/dx
            pts.append((L + cell / 2.0, "= past the end, clamped to the last node at the open end", [0, 1, 2, 3]))
        if pts:
            ins_pts.append((i, pts))
    w.v(len(ins_pts), O + ":568 pipes")
    w.v(0, O + ":571 WAMer number, ignored")
    first = True
    for (i, pts) in ins_pts:
        w.v(i + 1, O + ":573 pipe %d" % (i + 1))
        w.v(len(pts), U + ":2700 points")
        for (x, what, vs) in pts:
            w.row([x, len(vs)] + vs, U + ":2737 distance m %s, n vars; %svars 0 p 1 u 2 T%s" %
                  (what, "2740 " if first else "", " 3 mass flow" if 3 in vs else ""))
            first = False
    w.v(0, O + ":585 venturis")
    w.v(len(valve_bcs), O + ":599 valves")
    for k in valve_bcs:
        w.v(num[k], O + ":601 BC%d %s%s" % (num[k], BC_DESC[bcs[k]["type"]], cyl_sfx(k)))
        if bcs[k]["type"] == "ivalve":
            w.row([1, 0], "TTipoValvula.cpp:134 n vars, 0 CD in")
        else:
            w.row([1, 1], "TTipoValvula.cpp:134 n vars, 1 CD out")
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
    w.comment("compressor map data would follow here; there is no compressor BC, so nothing is read TOpenWAM.cpp:521-525")
    w.v(0, T + ":531 external DLL 0 = none")
    return w.text()


# --------------------------------------------------------------------------------------
def legacy_model(p):
    """v1 layout: one cylinder, intake pipe 1 (open end -> valve), exhaust pipe 2 (valve -> open end)."""
    pipes = [
        {"role": "intake", "left": "in_open", "right": "ivalve",
         "D0": p["intake_d_mm"] / 1000.0, "secs": [[p["intake_len_mm"] / 1000.0, p["intake_d_mm"] / 1000.0]],
         "Tw_C": p["intake_Twall_C"], "Tg_C": p["T_amb_C"], "comp": [0.0, 0.0, 1.0], "ht": 1},
        {"role": "exhaust", "left": "evalve", "right": "ex_open",
         "D0": p["exhaust_d_mm"] / 1000.0, "secs": [[p["exhaust_len_mm"] / 1000.0, p["exhaust_d_mm"] / 1000.0]],
         "Tw_C": p["exhaust_Twall_C"], "Tg_C": p["exhaust_Tgas0_C"], "comp": [1.0, 0.0, 0.0], "ht": 2},
    ]
    bcs = {"in_open": {"type": "open", "note": "intake pipe inlet, open end to atmosphere"},
           "ivalve": {"type": "ivalve", "cyl": 1, "note": "intake valve"},
           "evalve": {"type": "evalve", "cyl": 1, "note": "exhaust valve"},
           "ex_open": {"type": "open", "note": "exhaust pipe outlet, open end to atmosphere"}}
    return {"p": p, "phases": [0.0], "pipes": pipes, "bcs": bcs}


def make_wam(p):
    """v1 entry point: flat parameter dict, one cylinder, byte-identical to v1."""
    p = dict(DEFAULTS, **p)
    for k, v in EXTRA_DEFAULTS.items():
        p.setdefault(k, v)
    return write_model(legacy_model(p))


# --------------------------------------------------------------------------------------
def split_runs(segs):
    """Mirror of the calculator's buildLine (exhaust-calculator.html:4003-4009): consecutive segments
    whose diameters meet (|d1 - next d0| < 1e-6 m) form one pipe; a jump starts a new pipe; segments
    of 1 micron or less are dropped."""
    runs, cur = [], None
    for sg in segs:
        L, d0, d1 = float(sg["L"]), float(sg["d0"]), float(sg["d1"])
        if not (L > 1e-6):
            continue
        if not (d0 > 0.0 and d1 > 0.0):
            raise ValueError("segment diameters must be positive")
        if cur is not None and abs(cur["d1"] - d0) < 1e-6:
            cur["secs"].append([L, d1])
            cur["d1"] = d1
        else:
            cur = {"D0": d0, "secs": [[L, d1]], "d1": d1}
            runs.append(cur)
    if not runs:
        raise ValueError("a line has no segment longer than 1 micron")
    return runs


def split_segs_at(segs, x):
    """segs ({L,d0,d1}, m) cut at x from their start: (before, after), a cone cut with its diameter interpolated."""
    before, after, a = [], [], 0.0
    for sg in segs:
        L, d0, d1 = float(sg["L"]), float(sg["d0"]), float(sg["d1"])
        b = a + L
        if b <= x:
            before.append(dict(sg))
        elif a >= x:
            after.append(dict(sg))
        else:
            dx = d0 + (d1 - d0) * (x - a) / L
            before.append(dict(sg, L=x - a, d0=d0, d1=dx))
            after.append(dict(sg, L=b - x, d0=dx, d1=d1))
        a = b
    return before, after


def round01(x):
    """Round to 0.1 deg, halves up (the page's JS port rounds the same way)."""
    return math.floor(x * 10.0 + 0.5) / 10.0


def seat_events(cam, lift_in_mm, lift_ex_mm):
    """Cam events measured at a check lift (cam.checkLift_mm, e.g. 1.27 = 0.050 in) -> the seat-to-seat events of the
    sin^2 lift curve this generator uses, so that curve passes the check lift at the card's angles. A sin^2 lobe of
    duration D and lift L is at h when its angle from opening is a0 = D/pi*asin(sqrt(h/L)); with the card's duration
    d = D - 2 a0, each event moves out by a0 = d*k / (2 (1 - k)), k = (2/pi) asin(sqrt(h/L)). No check lift: the events
    are seat to seat already and come back unchanged."""
    h = float(cam.get("checkLift_mm") or 0.0)
    ev = {k: float(cam[k]) for k in ("ivo", "ivc", "evo", "evc")}
    if h <= 0.0:
        return ev
    out = {}
    for (o, c, L) in (("ivo", "ivc", lift_in_mm), ("evo", "evc", lift_ex_mm)):
        if not (L > h):
            raise ValueError("valve lift %g mm must exceed the check lift %g mm" % (L, h))
        d = ev[o] + 180.0 + ev[c]
        k = 2.0 / math.pi * math.asin(math.sqrt(h / L))
        a0 = d * k / (2.0 * (1.0 - k))
        out[o], out[c] = round01(ev[o] + a0), round01(ev[c] + a0)
    return out


COMB_COMPLETE = 0.98     # share of the burnable fuel that burns completely (combustion inefficiency ~2 %, assumed)


def comb_eff_for(e):
    """OpenWAM's combustion efficiency (the share of the fuel's heat released into the gas). spec.e.combEff when given;
    otherwise the share of the fuel the air can burn, min(1, 1/phi) (a rich mixture leaves the excess fuel unburnt),
    times COMB_COMPLETE. OpenWAM takes the heat lost to the walls itself (Woschni), so the wave simulation's eta, which
    lumps that heat loss in (0.72), is not used here: before v6 it was, and the losses were counted twice (a stock LS3
    then made 352 lb-ft at 4600 rpm against GM's 425; with this, 423)."""
    if e.get("combEff") is not None:
        return float(e["combEff"])
    phi = (1.0 / float(e["afr"])) / FS_GASOLINE_SIMPLE
    return COMB_COMPLETE * min(1.0, 1.0 / phi)


def lift_step_for(durs):
    for st in (1.0, 0.5, 0.25, 0.2, 0.1):
        if all(abs(round(dd / st) * st - dd) <= 1e-9 for dd in durs):
            return st
    raise ValueError("valve durations %s are not multiples of 0.1 deg" % (durs,))


def model_from_spec(spec, run=None):
    """simSpec() structure -> model. Lengths in m, temperatures in K, cam in cam-card degrees.

    spec.e: {bore, stroke, rod, cr, cd, nIn, dIn, liftIn, nEx, dEx, liftEx, cam:{ivo,ivc,evo,evc,[checkLift_mm]},
             burn:{start, dur}, afr, eta (the wave simulation's; not used here), [combEff], [Twall K]}
    spec.intake: {segs:[{L,d0,d1}] from the airbox to the valve, Tw,
                  [plenum: {V_m3, inlet:[{L,d0,d1}] from the open end (air filter) to the plenum: a diameter jump in it
                  is the throttle body}  every runner then starts at this one plenum instead of open air (v5)],
                  [reservoir: {p_bar, [T_C]}  the runner inlet opens into a space held at this pressure instead of
                  the atmosphere (BC type 1): the throttled intake plenum at manifold pressure, for part-load /
                  no-load runs; the load is then a stable, monotonic function of p_bar (v4)]}
    spec.exhaust: {segs:[{L,d0,d1}] from the valve outward (the primary), Tw,
                   [chambers: [{x m from the valve, V m3, A m2 total hole area, Le m neck length}] side-branch
                   resonators on every primary, as the wave simulation has them (v7): the primary splits at x into a
                   junction, a neck of area 0.75 A (the wave model's CdA) and length Le runs to a closed constant-volume
                   plenum V; a neck shorter than 3 cells is lengthened to 3 cells with its area raised by the same
                   factor, which keeps Le/A and so the Helmholtz tuning],
                   [per_cyl: [segs or None, ...] one primary geometry per cylinder, in cylinder index order,
                   None = use segs  (v4: unequal-length headers)]
    spec.opt: {phases:[deg after cylinder 1, one per cylinder], collector:{segs, Tw}}  (calculator form:
              every cylinder on one collector), or
              {phases, collectors:[{cyls:[0-based], stages:[{groups:[[...]], segs, Tw}], segs, Tw}]}
              stages are junction levels before the last one (Tri-Y: one stage, groups [[0,3],[1,2]]);
              stage-0 groups list cylinder indices, later groups list the previous stage's group indices.
              A stage may carry segs_by_group: [segs or None, ...], one per group, None = the stage's segs
              (v4: unequal secondaries).
              A collector may carry loss_K, and a stage loss_K (v8): the merge's total-pressure loss coefficient on
              the inlet's velocity head (the exhaust CFD's K). Each line into that junction then ends in a quadratic
              pressure-loss BC (TCCPerdidadePresion, type 10) 3 cells before it; the junction itself stays lossless.
              opt.crossover (v10): {cols:[a, b] (0-based collectors), type:'x'|'h', tails:[tail_a, tail_b],
              [tube:{L_mm, d_mm, [Tw_C]} for 'h']}: the two collectors' lines end at an X junction (or one H
              junction each, joined by the tube) and tails[k] runs from there to outlet k (same form as a tail).
    tail elements (v11): {loss_K} alone between two pipe segments is a quadratic total-pressure loss there (a slot, a
              perforated baffle, a passage entry); a Helmholtz side branch may carry loss_K, a loss halfway along its
              neck (the neck is then at least 6 cells, its area raised with its length to keep the tuning).
    run: run settings / overrides of DEFAULTS and EXTRA_DEFAULTS keys (rpm, cycles, name, cell_mm ...).
    """
    run = dict(run or {})
    for k in run:
        if k not in DEFAULTS and k not in EXTRA_DEFAULTS:
            raise ValueError("unknown run setting %r" % k)
    e = spec["e"]
    cam, burn = e["cam"], e["burn"]
    p = dict(DEFAULTS)
    p.update(EXTRA_DEFAULTS)
    twc = (e["Twall"] if e.get("Twall") else CALC_TWALL_CYL_K) - K0
    seat = seat_events(cam, e["liftIn"] * 1000.0, e["liftEx"] * 1000.0)
    # a measured lift profile (v9) replaces the sin^2 curve of its valve: its events and peak lift come from it
    profs = {}
    for kind, (o, c) in (("in", ("ivo", "ivc")), ("ex", ("evo", "evc"))):
        pr = (e.get("camProfile") or {}).get(kind)
        if pr:
            (seat[o], seat[c]), profs[kind] = profile_events(cam, pr, kind)
    p.update({
        "name": "simspec",
        "p_amb_bar": CALC_P_ATM_BAR, "T_amb_C": CALC_T_ATM_C,
        "bore_mm": e["bore"] * 1000.0, "stroke_mm": e["stroke"] * 1000.0, "rod_mm": e["rod"] * 1000.0,
        "cr": float(e["cr"]),
        "n_int": int(e["nIn"]), "d_int_mm": e["dIn"] * 1000.0, "lift_int_mm": e["liftIn"] * 1000.0,
        "n_exh": int(e["nEx"]), "d_exh_mm": e["dEx"] * 1000.0, "lift_exh_mm": e["liftEx"] * 1000.0,
        "ivo_btdc": seat["ivo"], "ivc_abdc": seat["ivc"],
        "evo_bbdc": seat["evo"], "evc_atdc": seat["evc"],
        "valve_cd": float(e["cd"]), "curtain_cap": CALC_CURTAIN_CAP,
        "burn_start_btdc": float(burn["start"]), "burn_dur_deg": float(burn["dur"]),
        "afr": float(e["afr"]), "comb_eff": comb_eff_for(e),
        "T_piston_C": twc, "T_head_C": twc, "T_liner_C": twc,
        "exhaust_Tgas0_C": CALC_T0_EXHAUST_K - K0,
    })
    if "in" in profs:
        p["lift_int_mm"], p["lift_profile_int"] = profs["in"]["max_mm"], profs["in"]
    if "ex" in profs:
        p["lift_exh_mm"], p["lift_profile_exh"] = profs["ex"]["max_mm"], profs["ex"]
    p["lift_step_deg"] = lift_step_for([180.0 + p["ivo_btdc"] + p["ivc_abdc"], 180.0 + p["evo_bbdc"] + p["evc_atdc"]])
    p.update(run)

    opt = spec.get("opt") or {}
    # every firing angle is shifted by START_SHIFT_DEG (see the constant): the steady cycle does not care where the
    # clock starts, but OpenWAM's initial state does (an LS3 bank at 0/180/450/630 went to NaN; any shift ran clean)
    shift = START_SHIFT_DEG if opt.get("start_shift_deg") is None else float(opt["start_shift_deg"])
    phases = [(float(x) + shift) % 720.0 for x in (opt.get("phases") or [0.0])]
    ncyl = len(phases)
    ex = spec["exhaust"]
    chambers = sorted(ex.get("chambers") or [], key=lambda c: float(c["x"]))
    if chambers and ex.get("tail"):
        raise ValueError("side-branch chambers (exhaust.chambers) with an exhaust tail are not written; give one or the other")
    if opt.get("collectors"):
        cols = opt["collectors"]
    elif opt.get("collector"):
        cols = [dict(opt["collector"], cyls=list(range(ncyl)))]
    else:
        cols = []

    step_t = {"union": "step", "branch": "branch"}[p["step_bc"]]
    pipes, bcs, plenums = [], {}, []

    def tw_c(line):
        return (line["Tw"] if line.get("Tw") else CALC_TATM_K) - K0

    loss_at = {}       # v8: junction key -> (loss coefficient K, what it is): each line into it ends in a pressure loss

    def add_line(segs, left, right, role, Twc, Tgc, comp, ht):
        """a line of pipes; into a junction with a loss coefficient, its last 3 cells go after a quadratic pressure-loss
        BC (the merge's loss, from CFD: K on the inlet's velocity head)"""
        if right in loss_at:
            K, what = loss_at[right]
            total = 0.0
            for sg in segs:
                total += float(sg["L"])
            Lk = 3.0 * p["cell_mm"] / 1000.0
            if total <= 2.0 * Lk:
                raise ValueError("%s is %g mm, too short to end in the %s loss (needs over %g mm)" % (role, total * 1000.0, what, 2.0 * Lk * 1000.0))
            before, last = split_segs_at(segs, total - Lk)
            lk = "%s/loss" % role
            bcs[lk] = {"type": "loss", "K": K, "note": "%s, %s loss K %g" % (role, what, K)}
            add_line_raw(before, left, lk, role, Twc, Tgc, comp, ht)
            add_line_raw(last, lk, right, role + " into the " + what, Twc, Tgc, comp, ht)
            return
        add_line_raw(segs, left, right, role, Twc, Tgc, comp, ht)

    def add_line_raw(segs, left, right, role, Twc, Tgc, comp, ht):
        runs = split_runs(segs)
        keys = [left]
        for j in range(1, len(runs)):
            sk = "%s/step%d" % (role, j)
            bcs[sk] = {"type": step_t, "note": "%s diameter step %g to %g mm" %
                       (role, runs[j - 1]["d1"] * 1000.0, runs[j]["D0"] * 1000.0)}
            keys.append(sk)
        keys.append(right)
        for j, rn in enumerate(runs):
            nm = role if len(runs) == 1 else "%s part %d" % (role, j + 1)
            pipes.append({"role": nm, "left": keys[j], "right": keys[j + 1], "D0": rn["D0"],
                          "secs": [list(s) for s in rn["secs"]], "Tw_C": Twc, "Tg_C": Tgc, "comp": comp, "ht": ht})

    def tail_items(tail, Twc_default, T0_default):
        """collector.tail / exhaust.tail (mm, litres, degC) -> [("seg", {L,d0,d1} m, Tw_C) | ("plenum", V_m3, T0_C)]."""
        items = []
        for n, el in enumerate(tail):
            if el.get("outlets") is not None:
                if n != len(tail) - 1 or not items or items[-1][0] != "plenum":
                    raise ValueError("tail element %d: 'outlets' must be the last element, right after a plenum (V_litres)" % (n + 1))
                outs = []
                for k, ol in enumerate(el["outlets"]):
                    if not ol:
                        raise ValueError("tail element %d: outlet %d has no pipe segments" % (n + 1, k + 1))
                    segs = []
                    for m, sg in enumerate(ol):
                        for kk in ("L_mm", "d0_mm", "d1_mm"):
                            if sg.get(kk) is None:
                                raise ValueError("tail element %d outlet %d segment %d needs %s" % (n + 1, k + 1, m + 1, kk))
                        segs.append(("seg", {"L": float(sg["L_mm"]) / 1000.0, "d0": float(sg["d0_mm"]) / 1000.0,
                                             "d1": float(sg["d1_mm"]) / 1000.0},
                                     float(sg["Tw_C"]) if sg.get("Tw_C") is not None else Twc_default))
                    outs.append(segs)
                if not outs:
                    raise ValueError("tail element %d: 'outlets' lists no outlet" % (n + 1))
                items.append(("outlets", outs))
                continue
            if el.get("parallel") is not None:
                # v8: two or more pipes side by side between two junctions (a timbre tube bundle, an auger's centre tube
                # and spiral channel, a Herschel-Quincke pair); each path a list of segments like the tail's own
                paths = []
                for k, pa in enumerate(el["parallel"]):
                    if not pa:
                        raise ValueError("tail element %d: parallel path %d has no pipe segments" % (n + 1, k + 1))
                    segs = []
                    for m, sg in enumerate(pa):
                        for kk in ("L_mm", "d0_mm", "d1_mm"):
                            if sg.get(kk) is None:
                                raise ValueError("tail element %d parallel path %d segment %d needs %s" % (n + 1, k + 1, m + 1, kk))
                        segs.append(("seg", {"L": float(sg["L_mm"]) / 1000.0, "d0": float(sg["d0_mm"]) / 1000.0,
                                             "d1": float(sg["d1_mm"]) / 1000.0},
                                     float(sg["Tw_C"]) if sg.get("Tw_C") is not None else Twc_default))
                    paths.append(segs)
                if len(paths) < 2:
                    raise ValueError("tail element %d: 'parallel' needs at least two paths" % (n + 1))
                if not items or items[-1][0] != "seg":
                    raise ValueError("tail element %d: parallel paths must come after a pipe segment" % (n + 1))
                items.append(("parallel", paths))
                continue
            if el.get("side") is not None:
                sd = el["side"]
                tw = float(sd["Tw_C"]) if sd.get("Tw_C") is not None else Twc_default
                if sd.get("type") == "quarter":
                    L, d = float(sd.get("L_mm") or 0.0) / 1000.0, float(sd.get("d_mm") or 0.0) / 1000.0
                    if not (L > 0.0 and d > 0.0):
                        raise ValueError("tail element %d: a quarter-wave side branch needs L_mm and d_mm" % (n + 1))
                    items.append(("side", {"type": "quarter", "L": L, "d": d}, tw))
                elif sd.get("type") == "helmholtz":
                    V, L, d = float(sd.get("V_litres") or 0.0) / 1000.0, float(sd.get("neck_L_mm") or 0.0) / 1000.0, float(sd.get("neck_d_mm") or 0.0) / 1000.0
                    if not (V > 0.0 and L > 0.0 and d > 0.0):
                        raise ValueError("tail element %d: a Helmholtz side branch needs V_litres, neck_L_mm and neck_d_mm" % (n + 1))
                    lk_ = float(sd["loss_K"]) if sd.get("loss_K") is not None else 0.0
                    if lk_ < 0.0:
                        raise ValueError("tail element %d: a Helmholtz neck's loss_K must be zero or more" % (n + 1))
                    items.append(("side", {"type": "helmholtz", "V": V, "L": L, "d": d, "K": lk_,
                                           "T0": float(sd["T0_C"]) if sd.get("T0_C") is not None else T0_default}, tw))
                else:
                    raise ValueError("tail element %d: side.type must be quarter or helmholtz" % (n + 1))
                if not items[:-1] or items[-2][0] != "seg":
                    raise ValueError("tail element %d: a side branch must come after a pipe segment" % (n + 1))
                continue
            if el.get("loss_K") is not None and el.get("L_mm") is None and el.get("V_litres") is None:
                # v11: a quadratic total-pressure loss between two pipe segments (a slot, a perforated baffle, a
                # passage entry: K on the velocity head of the pipe the flow leaves, either way), TCCPerdidadePresion
                K = float(el["loss_K"])
                if not (K > 0.0):
                    raise ValueError("tail element %d: loss_K must be positive" % (n + 1))
                if not items or items[-1][0] != "seg":
                    raise ValueError("tail element %d: a loss must come after a pipe segment" % (n + 1))
                items.append(("loss", K))
                continue
            if el.get("V_litres") is not None:
                V = float(el["V_litres"])
                if not (V > 0.0):
                    raise ValueError("tail element %d: V_litres must be positive" % (n + 1))
                # the plenum is adiabatic: Tw_C has no meaning for it and is ignored; T0_C sets the initial gas
                # temperature, default = the exhaust pipes' initial gas temperature (the converged state is reached
                # sooner: a plenum started cold heats up over many cycles, losing stored mass all the while)
                items.append(("plenum", V / 1000.0, float(el["T0_C"]) if el.get("T0_C") is not None else T0_default))
            else:
                for k in ("L_mm", "d0_mm", "d1_mm"):
                    if el.get(k) is None:
                        raise ValueError("tail element %d needs %s (or V_litres for a plenum)" % (n + 1, k))
                items.append(("seg", {"L": float(el["L_mm"]) / 1000.0, "d0": float(el["d0_mm"]) / 1000.0,
                                      "d1": float(el["d1_mm"]) / 1000.0},
                              float(el["Tw_C"]) if el.get("Tw_C") is not None else Twc_default))
        for n in range(len(items) - 1):
            if items[n][0] == "side" and items[n + 1][0] != "seg":
                raise ValueError("a side branch must be followed by a pipe segment")
            if items[n][0] == "parallel" and items[n + 1][0] != "seg":
                raise ValueError("parallel paths must be followed by a pipe segment")
            if items[n][0] == "loss" and items[n + 1][0] != "seg":
                raise ValueError("a loss must be followed by a pipe segment")
        if not items or items[-1][0] not in ("seg", "outlets"):
            raise ValueError("a tail must end with a pipe segment at the open end, not a plenum, a side branch, parallel paths or a loss")
        if items[0][0] != "seg":
            raise ValueError("a tail must start with a pipe segment (the collector or primary cannot open into a plenum directly)")
        return items

    def add_chain(items, left, right, role, Tgc, comp, ht):
        """A line made of pipe segments (each with its own Tw_C) and plenums, from BC `left` to BC `right`.
        Segments between plenums form one add_line() per run of equal Tw_C; Tw changes at equal diameter are
        joined by the step BC (TCCUnionEntreTubos with no area change = continuity), plenums by TCCDeposito."""
        groups, cur = [], None          # [[(seg, Tw)...] or ("plenum", V, T) or ("outlets", [[seg items]...])]
        for it in items:
            if it[0] in ("plenum", "outlets", "side", "parallel", "loss"):
                groups.append(it)
                cur = None
            else:
                if cur is None:
                    cur = []
                    groups.append(cur)
                cur.append((it[1], it[2]))
        state = {"npipe": 0}

        def add_group(g, lk, rk):
            # split the group by wall temperature
            runs = []
            for (sg, tw) in g:
                if runs and abs(runs[-1][1] - tw) < 1e-9:
                    runs[-1][0].append(sg)
                else:
                    runs.append(([sg], tw))
            keys = [lk]
            for j in range(1, len(runs)):
                sk = "%s/tw%d" % (role, state["npipe"] + j)
                bcs[sk] = {"type": step_t, "note": "%s section change, wall %g to %g degC, diameter %g to %g mm" %
                           (role, runs[j - 1][1], runs[j][1], runs[j - 1][0][-1]["d1"] * 1000.0, runs[j][0][0]["d0"] * 1000.0)}
                keys.append(sk)
            keys.append(rk)
            for j, (segs, tw) in enumerate(runs):
                state["npipe"] += 1
                add_line(segs, keys[j], keys[j + 1], "%s section %d" % (role, state["npipe"]), tw, Tgc, comp, ht)

        npl, nside, npar, nloss = 0, 0, 0, 0
        loss_key = {}                       # loss group index -> its BC key
        side_key, side_num = {}, {}         # side-branch group index -> its junction BC key, its number
        par_keys = {}                       # parallel group index -> (junction in, junction out)

        def add_side(gi, sd, tw):
            """v7: a side branch off the line at the junction before group gi+1 (quarter-wave: a pipe to a closed end;
            Helmholtz: a neck to a closed constant-volume plenum; a neck or tube shorter than 3 cells is lengthened, a
            neck with its area raised by the same factor so its Helmholtz tuning stays)"""
            bk = side_key[gi]
            Lmin = 3.0 * p["cell_mm"] / 1000.0
            if sd["type"] == "quarter":
                if sd["L"] < Lmin:
                    raise ValueError("%s: a quarter-wave branch shorter than 3 cells (%g mm) cannot be written" % (role, Lmin * 1000.0))
                ck = bk + "/closed"
                bcs[ck] = {"type": "closed", "note": "%s side branch %d closed end" % (role, side_num[gi])}
                add_line([{"L": sd["L"], "d0": sd["d"], "d1": sd["d"]}], bk, ck, "%s side branch %d, quarter-wave tube" % (role, side_num[gi]),
                         tw, Tgc, comp, ht)
            else:
                plenums.append({"V_m3": sd["V"], "T_C": sd["T0"], "p_bar": p["p_amb_bar"], "comp": list(comp),
                                "note": "%s side branch %d, Helmholtz %g litres" % (role, side_num[gi], sd["V"] * 1000.0)})
                pk = bk + "/port"
                bcs[pk] = {"type": "plenum", "plenum": len(plenums), "note": "%s side branch %d neck into the volume" % (role, side_num[gi])}
                L, A = sd["L"], math.pi / 4.0 * sd["d"] * sd["d"]
                # v13: the end correction. The written neck runs from a point junction to a 0-D volume, so the inertia of
                # the air just outside each end is missing; the plane-wave model (the page's Mufflers tab) adds
                # 0.6133 x the diameter to the length for it (Rienstra and Hirschberg, An Introduction to Acoustics,
                # 4.4.3: L_eff = L + 2 delta, delta of the order of the radius), and so does this: the neck is written
                # that much longer, same area, so its Helmholtz tuning matches the plane-wave model's
                L = L + HELM_END_CORR * sd["d"]
                Lmin_n = 2.0 * Lmin if sd.get("K") else Lmin     # v11: a neck with a loss is two halves of 3 cells or more
                if L < Lmin_n:
                    A, L = A * Lmin_n / L, Lmin_n
                dn = math.sqrt(4.0 * A / math.pi)
                if sd.get("K"):
                    mk = bk + "/neckloss"
                    bcs[mk] = {"type": "loss", "K": sd["K"], "note": "%s side branch %d, loss in the Helmholtz neck K %g" % (role, side_num[gi], sd["K"])}
                    add_line([{"L": L / 2.0, "d0": dn, "d1": dn}], bk, mk, "%s side branch %d, Helmholtz neck part 1" % (role, side_num[gi]), tw, Tgc, comp, ht)
                    add_line([{"L": L / 2.0, "d0": dn, "d1": dn}], mk, pk, "%s side branch %d, Helmholtz neck part 2" % (role, side_num[gi]), tw, Tgc, comp, ht)
                    return
                add_line([{"L": L, "d0": dn, "d1": dn}], bk, pk, "%s side branch %d, Helmholtz neck" % (role, side_num[gi]),
                         tw, Tgc, comp, ht)

        for gi, g in enumerate(groups):
            if isinstance(g, tuple) and g[0] in ("side", "parallel", "loss"):
                continue
            if isinstance(g, tuple) and g[0] == "plenum":
                npl += 1
                plenums.append({"V_m3": g[1], "T_C": g[2], "p_bar": p["p_amb_bar"], "comp": list(comp),
                                "note": "%s muffler %d as a %g litre expansion volume" % (role, npl, g[1] * 1000.0)})
                continue
            if isinstance(g, tuple):    # ("outlets", [...]): every exit of the last muffler to its own open end
                for k, osegs in enumerate(g[1]):
                    lk = "%s/muffler%d/out" % (role, npl) + ("" if k == 0 else "%d" % (k + 1))
                    bcs[lk] = {"type": "plenum", "plenum": len(plenums),
                               "note": "%s muffler %d outlet port%s" % (role, npl, "" if k == 0 else " %d" % (k + 1))}
                    if k == 0:
                        rk = right
                    else:
                        rk = "%s/%d" % (right, k + 1)
                        bcs[rk] = dict(bcs[right], note="%s, outlet %d" % (bcs[right]["note"], k + 1))
                    add_group([(sg[1], sg[2]) for sg in osegs], lk, rk)
                continue
            # the BC on each side of this group of pipes
            if gi == 0:
                lk = left
            elif isinstance(groups[gi - 1], tuple) and groups[gi - 1][0] == "side":
                lk = side_key[gi - 1]
            elif isinstance(groups[gi - 1], tuple) and groups[gi - 1][0] == "parallel":
                lk = par_keys[gi - 1][1]
            elif isinstance(groups[gi - 1], tuple) and groups[gi - 1][0] == "loss":
                lk = loss_key[gi - 1]
            else:
                lk = "%s/muffler%d/out" % (role, npl)
                bcs[lk] = {"type": "plenum", "plenum": len(plenums), "note": "%s muffler %d outlet port" % (role, npl)}
            if gi == len(groups) - 1:
                rk = right
            elif isinstance(groups[gi + 1], tuple) and groups[gi + 1][0] == "side":
                nside += 1
                rk = "%s/side%d" % (role, nside)
                side_key[gi + 1], side_num[gi + 1] = rk, nside
                bcs[rk] = {"type": "branch", "note": "%s side branch %d junction" % (role, nside)}
            elif isinstance(groups[gi + 1], tuple) and groups[gi + 1][0] == "loss":
                nloss += 1
                rk = "%s/loss%d" % (role, nloss)
                loss_key[gi + 1] = rk
                bcs[rk] = {"type": "loss", "K": groups[gi + 1][1], "note": "%s loss %d, K %g" % (role, nloss, groups[gi + 1][1])}
            elif isinstance(groups[gi + 1], tuple) and groups[gi + 1][0] == "parallel":
                npar += 1
                rk, ok_ = "%s/par%d/in" % (role, npar), "%s/par%d/out" % (role, npar)
                par_keys[gi + 1] = (rk, ok_)
                bcs[rk] = {"type": "branch", "note": "%s parallel paths %d, inlet junction" % (role, npar)}
                bcs[ok_] = {"type": "branch", "note": "%s parallel paths %d, outlet junction" % (role, npar)}
            else:
                rk = "%s/muffler%d/in" % (role, npl + 1)
                bcs[rk] = {"type": "plenum", "plenum": len(plenums) + 1, "note": "%s muffler %d inlet port" % (role, npl + 1)}
            add_group(g, lk, rk)
            if gi + 1 < len(groups) and isinstance(groups[gi + 1], tuple) and groups[gi + 1][0] == "side":
                add_side(gi + 1, groups[gi + 1][1], groups[gi + 1][2])
            if gi + 1 < len(groups) and isinstance(groups[gi + 1], tuple) and groups[gi + 1][0] == "parallel":
                jin, jout = par_keys[gi + 1]
                for pa in groups[gi + 1][1]:
                    add_group([(sg[1], sg[2]) for sg in pa], jin, jout)

    # where each cylinder's primary ends, and each stage pipe's right end
    prim_end = {}
    col_plan = []
    for ci, col in enumerate(cols):
        cyls = [int(c) for c in col["cyls"]]
        for c in cyls:
            if not (0 <= c < ncyl):
                raise ValueError("collector %d lists cylinder index %d of %d" % (ci + 1, c, ncyl))
            if c in prim_end:
                raise ValueError("cylinder index %d is on two collectors" % c)
        inlets = [("cyl", c) for c in cyls]
        levels = []
        for si, st in enumerate(col.get("stages") or []):
            groups = [[int(g) for g in grp] for grp in st["groups"]]
            flat = sorted(g for grp in groups for g in grp)
            want = sorted(cyls) if si == 0 else list(range(len(levels[-1]["groups"])))
            if flat != want:
                raise ValueError("collector %d stage %d groups %s must split %s" % (ci + 1, si + 1, groups, want))
            for grp in groups:
                if len(grp) < 2:
                    raise ValueError("a junction needs at least two inlets: %s" % (grp,))
            sbg = st.get("segs_by_group")
            if sbg is not None and len(sbg) != len(groups):
                raise ValueError("collector %d stage %d: segs_by_group must have one entry per group (%d, None = the stage's "
                                 "segs), got %d" % (ci + 1, si + 1, len(groups), len(sbg)))
            levels.append({"groups": groups, "segs": st["segs"], "sbg": sbg, "Tw": st.get("Tw", col.get("Tw"))})
        nfinal = len(cyls) if not levels else len(levels[-1]["groups"])
        if nfinal < 2:
            raise ValueError("collector %d: the last junction needs at least two inlets" % (ci + 1))
        jkey = "col%d/J" % (ci + 1)
        bcs[jkey] = {"type": "branch", "note": "collector %d junction" % (ci + 1)}
        if col.get("loss_K") is not None:
            if not (float(col["loss_K"]) >= 0.0):
                raise ValueError("collector %d: loss_K must be zero or more" % (ci + 1))
            if float(col["loss_K"]) > 0.0:
                loss_at[jkey] = (float(col["loss_K"]), "collector %d merge" % (ci + 1))
        # right end of each inlet into level 0 / later levels
        for si, lv in enumerate(levels):
            lv["jkeys"] = []
            for gi, grp in enumerate(lv["groups"]):
                k = "col%d/L%d/J%d" % (ci + 1, si + 1, gi + 1)
                bcs[k] = {"type": "branch", "note": "collector %d level %d junction %d" % (ci + 1, si + 1, gi + 1)}
                lk_ = (col.get("stages") or [])[si].get("loss_K")
                if lk_ is not None and float(lk_) > 0.0:
                    loss_at[k] = (float(lk_), "collector %d level %d merge %d" % (ci + 1, si + 1, gi + 1))
                lv["jkeys"].append(k)
                for g in grp:
                    if si == 0:
                        prim_end[g] = k
            lv["right"] = [None] * len(lv["groups"])
        for si, lv in enumerate(levels):
            nxt = levels[si + 1] if si + 1 < len(levels) else None
            for gi in range(len(lv["groups"])):
                if nxt is None:
                    lv["right"][gi] = jkey
                else:
                    lv["right"][gi] = [nxt["jkeys"][g2] for g2, grp in enumerate(nxt["groups"]) if gi in grp][0]
        if not levels:
            for c in cyls:
                prim_end[c] = jkey
        col_plan.append((ci, col, levels, jkey))

    T0x = p["exhaust_Tgas0_C"]
    per_cyl = ex.get("per_cyl")
    if per_cyl and len(per_cyl) != ncyl:
        raise ValueError("exhaust.per_cyl must list one primary per cylinder (%d entries, None = exhaust.segs), got %d"
                         % (ncyl, len(per_cyl)))
    prim_segs = lambda c: per_cyl[c] if (per_cyl and per_cyl[c] is not None) else ex["segs"]
    ipl = spec["intake"].get("plenum")
    if ipl:
        # v5: every runner starts at one intake plenum (a constant volume), fed by an inlet line from an open end
        if spec["intake"].get("reservoir"):
            raise ValueError("intake.plenum and intake.reservoir are alternatives: give one")
        if not (float(ipl.get("V_m3") or 0.0) > 0.0):
            raise ValueError("intake.plenum.V_m3 must be positive")
        if not ipl.get("inlet"):
            raise ValueError("intake.plenum.inlet needs at least one pipe segment (air filter to plenum)")
        plenums.append({"V_m3": float(ipl["V_m3"]), "T_C": p["T_amb_C"], "p_bar": p["p_amb_bar"], "comp": [0.0, 0.0, 1.0],
                        "note": "intake plenum, %g litres" % (float(ipl["V_m3"]) * 1000.0)})
        ipl_n = len(plenums)
    def add_primary(segs, ev, right, c):
        """the primary, split at every chamber: valve -> junction -> ... -> right; each junction also feeds a neck to
        its chamber's plenum"""
        if not chambers:
            add_line(segs, ev, right, "cylinder %d exhaust primary" % (c + 1), tw_c(ex), T0x, [1.0, 0.0, 0.0], 2)
            return
        total = 0.0
        for sg in segs:
            total += float(sg["L"])        # a plain running sum, as the JS port adds
        rest, left, done = [dict(sg) for sg in segs], ev, 0.0
        for k, ch in enumerate(chambers):
            x = float(ch["x"])
            if not (0.0 < x < total):
                raise ValueError("chamber %d at %g m is not inside the primary (0 to %g m)" % (k + 1, x, total))
            if not (float(ch["V"]) > 0.0 and float(ch["A"]) > 0.0 and float(ch["Le"]) > 0.0):
                raise ValueError("chamber %d needs a positive V, A and Le" % (k + 1))
            before, rest = split_segs_at(rest, x - done)
            jk = "c%d/ch%d" % (c + 1, k + 1)
            bcs[jk] = {"type": "branch", "note": "cylinder %d chamber %d junction, %g mm from the valve" % (c + 1, k + 1, x * 1000.0)}
            add_line(before, left, jk, "cylinder %d exhaust primary part %d" % (c + 1, k + 1), tw_c(ex), T0x, [1.0, 0.0, 0.0], 2)
            plenums.append({"V_m3": float(ch["V"]), "T_C": T0x, "p_bar": p["p_amb_bar"], "comp": [1.0, 0.0, 0.0],
                            "note": "cylinder %d chamber %d, %g litres" % (c + 1, k + 1, float(ch["V"]) * 1000.0)})
            pk = "c%d/ch%d/port" % (c + 1, k + 1)
            bcs[pk] = {"type": "plenum", "plenum": len(plenums), "note": "cylinder %d chamber %d neck into the chamber" % (c + 1, k + 1)}
            Le, Ae = float(ch["Le"]), 0.75 * float(ch["A"])
            Lmin = 3.0 * p["cell_mm"] / 1000.0
            if Le < Lmin:
                Ae, Le = Ae * Lmin / Le, Lmin
            dn = math.sqrt(4.0 * Ae / math.pi)
            add_line([{"L": Le, "d0": dn, "d1": dn}], jk, pk, "cylinder %d chamber %d neck" % (c + 1, k + 1), tw_c(ex), T0x, [1.0, 0.0, 0.0], 2)
            left, done = jk, x
        add_line(rest, left, right, "cylinder %d exhaust primary part %d" % (c + 1, len(chambers) + 1), tw_c(ex), T0x, [1.0, 0.0, 0.0], 2)

    for c in range(ncyl):
        ik, iv, ev = "c%d/in/open" % (c + 1), "c%d/iv" % (c + 1), "c%d/ev" % (c + 1)
        rsv = spec["intake"].get("reservoir")
        if ipl:
            bcs[ik] = {"type": "plenum", "plenum": ipl_n, "note": "cylinder %d intake runner inlet, from the intake plenum" % (c + 1)}
        elif rsv:
            bcs[ik] = {"type": "reservoir", "p_bar": float(rsv["p_bar"]),
                       "T_C": float(rsv["T_C"]) if rsv.get("T_C") is not None else p["T_amb_C"], "comp": [0.0, 0.0, 1.0],
                       "note": "cylinder %d intake runner inlet, reservoir at %g bar (throttled plenum)" % (c + 1, float(rsv["p_bar"]))}
        else:
            bcs[ik] = {"type": "open", "note": "cylinder %d intake runner inlet, open end to atmosphere" % (c + 1)}
        bcs[iv] = {"type": "ivalve", "cyl": c + 1, "note": "intake valve, cylinder %d" % (c + 1)}
        bcs[ev] = {"type": "evalve", "cyl": c + 1, "note": "exhaust valve, cylinder %d" % (c + 1)}
        add_line(spec["intake"]["segs"], ik, iv, "cylinder %d intake runner" % (c + 1),
                 tw_c(spec["intake"]), p["T_amb_C"], [0.0, 0.0, 1.0], 1)
        if c in prim_end:
            right = prim_end[c]
            add_primary(prim_segs(c), ev, right, c)
        else:
            right = "c%d/ex/open" % (c + 1)
            bcs[right] = {"type": "open", "note": "cylinder %d exhaust outlet, open end to atmosphere" % (c + 1)}
            if ex.get("tail"):
                items = [("seg", {"L": s["L"], "d0": s["d0"], "d1": s["d1"]}, tw_c(ex)) for s in prim_segs(c)]
                items += tail_items(ex["tail"], tw_c(ex), T0x)
                add_chain(items, ev, right, "cylinder %d exhaust line" % (c + 1), T0x, [1.0, 0.0, 0.0], 2)
            else:
                add_primary(prim_segs(c), ev, right, c)
    if ipl:
        bcs["in/open"] = {"type": "open", "note": "intake inlet, open end to atmosphere"}
        bcs["in/plenum"] = {"type": "plenum", "plenum": ipl_n, "note": "intake inlet into the plenum"}
        add_line(ipl["inlet"], "in/open", "in/plenum", "intake inlet", tw_c(spec["intake"]), p["T_amb_C"], [0.0, 0.0, 1.0], 1)
    # v10: a crossover between two collectors' lines (dual exhaust): an X-pipe is one junction that both lines run
    # into and both outlet lines leave (the merged section lumped into the junction: OpenWAM's branch is a
    # constant-pressure node, so the X's own short shared length, ~100-150 mm, is not resolved); an H-pipe is a
    # junction on each line joined by a balance tube. Each collector's own tail then ends at the crossover, and
    # crossover.tails[k] (the same mm / litre form as a collector tail) runs from it to outlet k's open end.
    xo = opt.get("crossover")
    xo_right = {}
    if xo:
        xc = [int(c) for c in xo.get("cols") or []]
        if len(xc) != 2 or xc[0] == xc[1] or not all(0 <= c < len(cols) for c in xc):
            raise ValueError("crossover.cols must name two different collectors (0-based), got %r" % (xo.get("cols"),))
        if xo.get("type") not in ("x", "h"):
            raise ValueError("crossover.type must be 'x' or 'h'")
        if len(xo.get("tails") or []) != 2:
            raise ValueError("crossover.tails must give the two outlet lines, one per collector in cols order")
        if xo["type"] == "x":
            bcs["xo/J"] = {"type": "branch", "note": "X-pipe junction (both banks' lines in, both outlet lines out)"}
            xo_right = {xc[0]: "xo/J", xc[1]: "xo/J"}
        else:
            tb = xo.get("tube") or {}
            if not (float(tb.get("L_mm") or 0) > 0 and float(tb.get("d_mm") or 0) > 0):
                raise ValueError("an H-pipe crossover needs tube: {L_mm, d_mm}")
            for k, c in enumerate(xc):
                bcs["xo/J%d" % (k + 1)] = {"type": "branch", "note": "H-pipe junction on collector %d's line" % (c + 1)}
                xo_right[c] = "xo/J%d" % (k + 1)
            if 3.0 * p["cell_mm"] > float(tb["L_mm"]):
                raise ValueError("the H-pipe balance tube is shorter than 3 cells (%g mm)" % (3.0 * p["cell_mm"]))
            dtb = float(tb["d_mm"]) / 1000.0
            add_line([{"L": float(tb["L_mm"]) / 1000.0, "d0": dtb, "d1": dtb}], "xo/J1", "xo/J2", "H-pipe balance tube",
                     float(tb["Tw_C"]) if tb.get("Tw_C") is not None else 250.0, T0x, [1.0, 0.0, 0.0], 2)
    for (ci, col, levels, jkey) in col_plan:
        for si, lv in enumerate(levels):
            for gi in range(len(lv["groups"])):
                gsegs = lv["sbg"][gi] if (lv["sbg"] is not None and lv["sbg"][gi] is not None) else lv["segs"]
                add_line(gsegs, lv["jkeys"][gi], lv["right"][gi],
                         "collector %d level %d branch %d" % (ci + 1, si + 1, gi + 1),
                         tw_c({"Tw": lv["Tw"]}), T0x, [1.0, 0.0, 0.0], 2)
        if ci in xo_right:
            ok = xo_right[ci]
            role = "collector %d line to the crossover" % (ci + 1)
            if col.get("tail"):
                items = [("seg", {"L": s["L"], "d0": s["d0"], "d1": s["d1"]}, tw_c(col)) for s in col["segs"]]
                items += tail_items(col["tail"], tw_c(col), T0x)
                if items[-1][0] != "seg":
                    raise ValueError("collector %d: a tail into a crossover must end with a pipe segment" % (ci + 1))
                add_chain(items, jkey, ok, role, T0x, [1.0, 0.0, 0.0], 2)
            else:
                add_line(col["segs"], jkey, ok, role, tw_c(col), T0x, [1.0, 0.0, 0.0], 2)
            continue
        ok = "col%d/out" % (ci + 1)
        bcs[ok] = {"type": "open", "note": "collector %d outlet, open end to atmosphere" % (ci + 1)}
        if col.get("tail"):
            items = [("seg", {"L": s["L"], "d0": s["d0"], "d1": s["d1"]}, tw_c(col)) for s in col["segs"]]
            items += tail_items(col["tail"], tw_c(col), T0x)
            add_chain(items, jkey, ok, "collector %d line" % (ci + 1), T0x, [1.0, 0.0, 0.0], 2)
        else:
            add_line(col["segs"], jkey, ok, "collector %d" % (ci + 1), tw_c(col), T0x, [1.0, 0.0, 0.0], 2)
    if xo:
        for k, c in enumerate(xc):
            ok = "xo/out%d" % (k + 1)
            bcs[ok] = {"type": "open", "note": "crossover outlet %d (collector %d's side), open end to atmosphere" % (k + 1, c + 1)}
            items = tail_items(xo["tails"][k], tw_c(cols[c]), T0x)
            add_chain(items, xo_right[c], ok, "crossover outlet %d line" % (k + 1), T0x, [1.0, 0.0, 0.0], 2)
    if int(p["open_end_corr"]) == 1:
        for pp in pipes:
            if bcs[pp["right"]]["type"] == "open":
                pp["secs"][-1][0] += OPEN_END_CORR * pp["secs"][-1][1] / 2.0
            elif bcs[pp["left"]]["type"] == "open":
                pp["secs"][0][0] += OPEN_END_CORR * pp["D0"] / 2.0
    return {"p": p, "phases": phases, "pipes": pipes, "bcs": bcs, "plenums": plenums}


def make_wam_spec(spec, run=None):
    return write_model(model_from_spec(spec, run))


# --------------------------------------------------------------------------------------
def read_ins(text, pipe=None, keep_cycles=None, model=None, intake=False):
    """Read an OpenWAM INS.DAT (tab-separated, one header row) and return the open-end node of an exhaust
    outlet pipe (the point written with ins_outlet=1; those points are the only pipe points that carry a
    mass-flow column).

    pipe: 1-based pipe number of the outlet to use (several collectors give several outlets).
    intake: (v12, needs model and a run with ins_intake = 1) the intake's open end instead of an exhaust outlet (pipe
           then picks among the intake pipes, which "outlets" then lists); its mdot is positive INTO the engine, so the
           intake's radiated outflow is -mdot.
    model: the model dict the file was written from (model_from_spec); with it the outlet pipes and the plenum
           ports are identified exactly and "ports" is filled; without it the outlet is taken as the mass-flow
           point with the highest pipe number and, on that pipe, the largest distance (the tailpipe is the last
           pipe of a chain and its open end its last point; a plenum outlet port sits at x = 0).
    keep_cycles: keep only the last N complete engine cycles (a cycle boundary is a drop of the Angle column;
           a trailing fragment shorter than 600 deg is dropped).
    Returns {"time": [s], "angle": [deg in cycle], "p": [Pa], "u": [m/s], "T": [K], "mdot": [kg/s],
             "rho": [kg/m3] = p/(R_BURNT*T), "pipe": n, "x_m": label distance, "cycles": N kept,
             "outlets": [pipe numbers with an outlet point],
             "plenums": {k: {"p": [Pa], "T": [K], "m": [kg]}},
             "ports": {k: {"in": {"pipe", "mdot", "p", "T"}, "out": {...}}}  (model given, flows positive along
                      the line, i.e. into the plenum at "in" and out of it at "out")}
    Rows are in file order; with a fine out_step_deg they are the solver's own time steps, not evenly spaced."""
    import re
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        raise ValueError("INS file has no data rows")
    head = lines[0].split("\t")
    ix = {h: i for i, h in enumerate(head)}
    pts = {}       # (pipe, x) -> {"P": col, "V": col, "T": col, "F": col}
    # OpenWAM reuses one ostringstream for the distance labels of a pipe (TTubo.cpp:2575, 2822), so the k-th point
    # of a pipe is labelled with the labels of points 1..k run together ("0.01" then "0.010.49349518"): the
    # previous point's full label is stripped from the front to recover x. Points come in header order.
    seen = {}      # pipe -> cumulative label of the last point
    for i, h in enumerate(head):
        mm = re.match(r"^([PVTF])_duct_(\d+)_at_([-0-9.eE+]+)_m\(", h)
        if mm:
            n, lab = int(mm.group(2)), mm.group(3)
            key = [k for k in pts if k[0] == n and pts[k]["lab"] == lab]
            if key:
                key = key[0]
            else:
                prev = seen.get(n, "")
                x = float(lab[len(prev):]) if prev and lab.startswith(prev) and len(lab) > len(prev) else float(lab)
                key = (n, x)
                pts[key] = {"lab": lab}
                seen[n] = lab
            pts[key][mm.group(1)] = i
    fpts = sorted(k for k, v in pts.items() if "F" in v and "P" in v and "V" in v and "T" in v)
    if not fpts:
        raise ValueError("no mass-flow point (a duct point with P, V, T and F columns) in the INS header; "
                         "write the model with ins_outlet=1")
    ports = {}
    if model is not None:
        bcs = model["bcs"]
        outlet_pipes = [i + 1 for i, pp in enumerate(model["pipes"]) if bcs[pp["right"]]["type"] == "open" and int(pp["ht"]) == 2]
        outlets = [max(k for k in fpts if k[0] == n) for n in outlet_pipes if [k for k in fpts if k[0] == n]]
        for i, pp in enumerate(model["pipes"]):
            for side, key in (("in", pp["right"]), ("out", pp["left"])):
                if bcs[key]["type"] == "plenum":
                    cand = [k for k in fpts if k[0] == i + 1 and ((side == "in" and k[1] > 0.0) or (side == "out" and k[1] == 0.0))]
                    if cand:
                        ports.setdefault(bcs[key]["plenum"], {})[side] = (max(cand) if side == "in" else min(cand))
    else:
        outlets = [max(k for k in fpts if k[0] == max(k2[0] for k2 in fpts))]
    if intake:
        if model is None:
            raise ValueError("reading the intake's open end needs the model the file was written from")
        intake_pipes = [i + 1 for i, pp in enumerate(model["pipes"]) if bcs[pp["left"]]["type"] == "open" and int(pp["ht"]) == 1]
        outlets = [min(k for k in fpts if k[0] == n) for n in intake_pipes if [k for k in fpts if k[0] == n and k[1] == 0.0]]
        if not outlets:
            raise ValueError("no intake open-end point in the INS header; write the model with ins_intake=1")
    if not outlets:
        raise ValueError("no outlet point in the INS header")
    if pipe is None:
        key = outlets[-1]
    else:
        cand = [k for k in outlets if k[0] == int(pipe)]
        if not cand:
            raise ValueError("pipe %r has no outlet point; outlets are on pipes %s" % (pipe, [k[0] for k in outlets]))
        key = cand[-1]
    cols = pts[key]
    it, ia = ix["Time"], ix.get("Angle(deg)")
    plen = {}
    for h in head:
        mm = re.match(r"^(Pressure|Temperature|Mass)_plenum_(\d+)\(", h)
        if mm:
            plen.setdefault(int(mm.group(2)), {})[mm.group(1)[0]] = ix[h]
    rows = [f for f in (ln.split("\t") for ln in lines[1:]) if len(f) >= len(head)]
    # cycle boundaries from the angle column; a trailing fragment (OpenWAM writes the first row of the next cycle) is dropped
    starts = [0]
    if ia is not None:
        prev = None
        for r, f in enumerate(rows):
            a = float(f[ia])
            if prev is not None and a < prev - 180.0:
                starts.append(r)
            prev = a
        if len(starts) > 1 and float(rows[-1][ia]) - float(rows[starts[-1]][ia]) < 600.0:
            rows = rows[:starts[-1]]
            starts = starts[:-1]
    ncyc = len(starts)
    if keep_cycles is not None and 0 < int(keep_cycles) < ncyc:
        rows = rows[starts[ncyc - int(keep_cycles)]:]
        ncyc = int(keep_cycles)
    out = {"time": [], "angle": [], "p": [], "u": [], "T": [], "mdot": [], "rho": [],
           "pipe": key[0], "x_m": key[1], "cycles": ncyc, "outlets": sorted(set(k[0] for k in outlets)),
           "plenums": {k: {"p": [], "T": [], "m": []} for k in plen},
           "ports": {k: {s: {"pipe": kk[0], "x_m": kk[1], "mdot": [], "p": [], "T": []} for s, kk in v.items()} for k, v in ports.items()}}
    for f in rows:
        p_pa = float(f[cols["P"]]) * 1e5
        TK = float(f[cols["T"]]) + K0
        out["time"].append(float(f[it]))
        out["angle"].append(float(f[ia]) if ia is not None else 0.0)
        out["p"].append(p_pa)
        out["u"].append(float(f[cols["V"]]))
        out["T"].append(TK)
        out["mdot"].append(float(f[cols["F"]]))
        out["rho"].append(p_pa / (R_BURNT * TK))
        for k, c in plen.items():
            if "P" in c:
                out["plenums"][k]["p"].append(float(f[c["P"]]) * 1e5)
            if "T" in c:
                out["plenums"][k]["T"].append(float(f[c["T"]]) + K0)
            if "M" in c:
                out["plenums"][k]["m"].append(float(f[c["M"]]))
        for k, v in ports.items():
            for s, kk in v.items():
                c = pts[kk]
                out["ports"][k][s]["mdot"].append(float(f[c["F"]]))
                out["ports"][k][s]["p"].append(float(f[c["P"]]) * 1e5)
                out["ports"][k][s]["T"].append(float(f[c["T"]]) + K0)
    return out


# --------------------------------------------------------------------------------------
def _parse_value(k, v, ref):
    if isinstance(ref, bool):
        return v.lower() in ("1", "true", "yes")
    if isinstance(ref, int):
        return int(v)
    if isinstance(ref, float) or ref is None:
        return float(v)
    return v


def main(argv):
    out = None
    over, spec = {}, None
    allowed = dict(DEFAULTS, **EXTRA_DEFAULTS)
    for a in argv[1:]:
        if a.endswith(".json"):
            with open(a) as f:
                obj = json.load(f)
            if isinstance(obj, dict) and "e" in obj:
                spec = obj
            else:
                over.update(obj)
        elif "=" in a:
            k, v = a.split("=", 1)
            if k not in allowed:
                raise SystemExit("unknown parameter %r" % k)
            over[k] = _parse_value(k, v, allowed[k])
        else:
            out = a
    unknown = set(over) - set(allowed)
    if unknown:
        raise SystemExit("unknown parameter(s): %s" % ", ".join(sorted(unknown)))
    if spec is not None:
        text = make_wam_spec(spec, over)
        name = over.get("name", "simspec")
    else:
        text = make_wam(over)
        name = over.get("name", DEFAULTS["name"])
    out = out or "%s.wam" % name
    with open(out, "w", newline="\n") as f:
        f.write(text)
    print("wrote %s (%d lines)" % (out, text.count("\n")))


if __name__ == "__main__":
    main(sys.argv)
