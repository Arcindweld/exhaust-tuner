#!/usr/bin/env python3
"""make_wam.py - write a labelled OpenWAM 2.2 input file (.wam) for a single-cylinder
4-stroke engine with one intake pipe and one exhaust pipe, both open to the atmosphere.

No WAMer needed. Every number is written in the exact order OpenWAM's readers consume it
(sequential fscanf), followed by a <label> naming the source file:line that reads it.
OpenWAM strips everything between '<' and '>' and drops empty lines before parsing
(TOpenWAM::CleanLabelsX, TOpenWAM.cpp:349-399), so the labels are free documentation.

Usage
    python3 make_wam.py                         # writes single450.wam with the defaults
    python3 make_wam.py out.wam rpm=6000        # override any DEFAULTS key as key=value
    python3 make_wam.py out.wam params.json     # or load overrides from a JSON file

From Python
    from make_wam import DEFAULTS, make_wam
    text = make_wam(dict(DEFAULTS, rpm=10000))

Plain Python 3, standard library only.
"""
import json
import math
import sys

# Simple species model, gasoline: stoichiometric fuel/air ratio hard-coded in OpenWAM
# (TCilindro.cpp:2201-2203). The SI "Dosado" input is RELATIVE to it (TCilindro.cpp:2735).
FS_GASOLINE_SIMPLE = 0.068468349

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
    "comb_eff": 0.72,             # share of fuel LHV released into the gas (wavesim eta)
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
    "cell_mm": 10.0,
    "courant": 0.8,
    "pipe_method": "tvd",         # "tvd" | "lw" | "lw_fct"
    "fct_option": 1,              # FCT sub-option 0..5 (TTubo.cpp:627-658) if pipe_method="lw_fct"
    "end_loss": 1.0,              # open-end inflow velocity coefficient (1 = isentropic)
    "pipe_htc_mult": 1.0,         # pipe heat-transfer multiplier
    "pipe_fric_mult": 1.0,        # pipe friction multiplier
}


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
def derived(p):
    """Geometry and timing derived from the parameter dict (SI units)."""
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
    d["A_int_pipe"] = math.pi / 4.0 * (p["intake_d_mm"] / 1000.0) ** 2
    d["A_exh_pipe"] = math.pi / 4.0 * (p["exhaust_d_mm"] / 1000.0) ** 2
    return d


def lift_table(lmax_mm, dur_deg, step_deg):
    n = int(round(dur_deg / step_deg))
    if abs(n * step_deg - dur_deg) > 1e-9:
        raise ValueError("valve duration %g is not a multiple of lift_step_deg %g" % (dur_deg, step_deg))
    return [round(lmax_mm * math.sin(math.pi * i / n) ** 2, 6) for i in range(n + 1)]


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
def make_wam(p):
    p = dict(DEFAULTS, **p)
    d = derived(p)
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
    w.v(1, E + ":134 number of cylinders")
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
    w.v(1, E + ":203 pipe used for volumetric efficiency, 1 = intake pipe")
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
    w.v(0, E + ":485 engine controllers")
    w.v(0, E + ":503 controllers for cylinder 1")

    # ---------------------------------------------------------------- pipes
    U = "TTubo.cpp"
    w.section("PIPES  TOpenWAM::ReadPipes")
    w.v(2, T + ":852 number of pipes")
    method = {"tvd": [2], "lw": [0, 0], "lw_fct": [0, 1, int(p["fct_option"])]}[p["pipe_method"]]
    pipes = [
        # name, left BC, right BC, length, diameter, wall T, gas T0, composition, HT type
        ("intake pipe 1, open end BC1 to intake valve BC2", 1, 2, p["intake_len_mm"], p["intake_d_mm"],
         p["intake_Twall_C"], p["T_amb_C"], [0.0, 0.0, 1.0], 1),
        ("exhaust pipe 2, exhaust valve BC3 to open end BC4", 3, 4, p["exhaust_len_mm"], p["exhaust_d_mm"],
         p["exhaust_Twall_C"], p["exhaust_Tgas0_C"], [1.0, 0.0, 0.0], 2),
    ]
    for (nm, nl, nr, L, D, Tw, Tg, comp, htype) in pipes:
        w.comment(nm)
        w.row([nl, nr, 1, 1], U + ":546 left BC, right BC, number of sections, number of identical ducts")
        w.v(float(p["roughness_mm"]), U + ":547 wall roughness mm, Colebrook rug/3700/D TTubo.cpp:2121")
        w.row([float(Tw), float(Tg), float(p["p_amb_bar"]), 0.0],
              U + ":548 initial wall T degC, gas T degC, pressure bar, velocity m/s")
        w.row([htype, float(p["pipe_htc_mult"]), float(p["pipe_fric_mult"])],
              U + ":549 HT type 1 intake 2 exhaust, HT multiplier, friction multiplier")
        w.row(comp, U + ":568 initial mass fractions burnt, fuel, air")
        w.row([p["cell_mm"] / 1000.0, 2], U + ":590 mesh size m, wall T 2 = constant")
        if method[0] == 2:
            w.v(2, U + ":604 solver 2 = TVD")
        else:
            w.v(0, U + ":604 solver 0 = Lax-Wendroff family")
            w.v(method[1], U + ":608 0 = plain LW, 1 = LW+FCT")
            if method[1] == 1:
                w.v(method[2], U + ":626 FCT option")
        w.v(float(p["courant"]), U + ":665 Courant number")
        w.v(D / 1000.0, U + ":710 diameter at section start m")
        w.row([L / 1000.0, D / 1000.0], U + ":712 section length m, diameter at section end m")
        w.comment("TTubo.cpp:716-776 reads no wall data: wall T constant and HT type 1 or 2")

    # ---------------------------------------------------------------- valves
    V = "TValvula4T.cpp"
    w.section("VALVE TYPES  TOpenWAM::ReadValves")
    w.v(2, T + ":956 number of valve types")
    vals = [
        ("valve type 1: intake, %d x %g mm, %g mm lift, IVO %g BTDC IVC %g ABDC" %
         (p["n_int"], p["d_int_mm"], p["lift_int_mm"], p["ivo_btdc"], p["ivc_abdc"]),
         p["d_int_mm"], p["lift_int_mm"], d["dur_int"], d["ivo"], p["n_int"], d["A_int_pipe"]),
        ("valve type 2: exhaust, %d x %g mm, %g mm lift, EVO %g BBDC EVC %g ATDC" %
         (p["n_exh"], p["d_exh_mm"], p["lift_exh_mm"], p["evo_bbdc"], p["evc_atdc"]),
         p["d_exh_mm"], p["lift_exh_mm"], d["dur_exh"], d["evo"], p["n_exh"], d["A_exh_pipe"]),
    ]
    for (nm, dv, lmax, dur, ao, nv, apipe) in vals:
        w.comment(nm)
        w.v(1, T + ":974 valve type 1 = TValvula4T poppet valve")
        lifts = lift_table(lmax, dur, p["lift_step_deg"])
        ncd, cds = cd_table(nv, dv, lmax, p["cd_step_mm"], p["valve_cd"], p["curtain_cap"], apipe, p["cd_clip"])
        w.v(dv / 1000.0, V + ":149 valve diameter m, short-circuit model only")
        w.v(len(lifts), V + ":149 number of lift points")
        w.v(float(p["lift_step_deg"]), V + ":149 angle step deg")
        w.v(float(ao), V + ":149 opening angle, cylinder frame 0 = firing TDC")
        w.v(0.0, V + ":149 reference diameter 0 = CD referred to pipe-end area TTipoValvula.cpp:89,323")
        w.v(0.0, V + ":149 mean swirl coefficient")
        w.row(lifts, V + ":162 lift mm, sin^2 profile, closes at opening + (n-1)*step")
        w.v(ncd, V + ":165 number of CD points")
        w.v(float(p["cd_step_mm"]), V + ":165 lift step of CD table mm")
        w.row(cds, V + ":174 CD inflow pipe to cylinder")
        w.row(cds, V + ":177 CD outflow cylinder to pipe")
        w.row([0.0] * ncd, V + ":180 swirl coefficient vs lift")
        w.v(1, V + ":183 speed control 1 = engine")
        w.v(1.0, V + ":197 cam to engine speed ratio, angle taken from cylinder")
        w.v(0, V + ":204 VVT controllers")

    # ---------------------------------------------------------------- plenums, compressors
    w.section("PLENUMS  TOpenWAM::ReadPlenums")
    w.v(0, T + ":1063 number of plenums")
    w.row([0, 0, 0], T + ":1065 WAMer counts turbines, venturis, directional junctions")
    w.section("COMPRESSORS  TOpenWAM::ReadCompressors")
    w.v(0, T + ":1181 number of compressors")

    # ---------------------------------------------------------------- connections
    w.section("CONNECTIONS  TOpenWAM::ReadConnections")
    w.v(4, T + ":1242 number of boundary conditions")
    w.row([0] * 9, T + ":1244 nine WAMer-only counts, read and ignored")
    w.comment("BC1: intake pipe inlet, open end to atmosphere")
    w.v(0, T + ":1256 BC type 0 = open end to atmosphere")
    w.v(float(p["end_loss"]), "TCCDescargaExtremoAbierto.cpp:141 inflow velocity coefficient, 1 = no loss")
    w.comment("BC2: intake valve")
    w.v(7, T + ":1256 BC type 7 = intake valve")
    w.v(0, "TCCCilindro.cpp:169 WAMer id, ignored")
    w.v(1, "TCCCilindro.cpp:171 cylinder number")
    w.v(1, T + ":1460 valve type index 1-based = valve type 1")
    w.comment("BC3: exhaust valve")
    w.v(8, T + ":1256 BC type 8 = exhaust valve")
    w.v(0, "TCCCilindro.cpp:169 WAMer id, ignored")
    w.v(1, "TCCCilindro.cpp:171 cylinder number")
    w.v(2, T + ":1460 valve type index 1-based = valve type 2")
    w.comment("BC4: exhaust pipe outlet, open end to atmosphere")
    w.v(0, T + ":1256 BC type 0 = open end to atmosphere")
    w.v(float(p["end_loss"]), "TCCDescargaExtremoAbierto.cpp:141 inflow velocity coefficient")

    w.section("TURBOCHARGERS, SENSORS, CONTROLLERS")
    w.v(0, T + ":1669 turbocharger axes")
    w.v(0, T + ":1699 sensors")
    w.v(0, T + ":1720 controllers")

    # ---------------------------------------------------------------- output
    O = "TOutputResults.cpp"
    w.section("AVERAGE RESULTS  TOutputResults::ReadAverageResults")
    w.v(0, O + ":37 instantaneous results 0 = last cycle only")
    w.v(2, O + ":63 pipes with average results")
    w.v(0, O + ":64 WAMer number, ignored")
    w.v(1, O + ":66 pipe 1")
    w.v(1, U + ":2465 points")
    w.row([p["intake_len_mm"] / 2000.0, 3, 0, 1, 3], U + ":2508 distance m, n vars; 2511 vars 0 T, 1 p, 3 mass flow")
    w.v(2, O + ":66 pipe 2")
    w.v(1, U + ":2465 points")
    w.row([p["exhaust_len_mm"] / 2000.0, 3, 0, 1, 3], U + ":2508 distance m, n vars; vars 0 T, 1 p, 3 mass flow")
    w.v(1, O + ":78 cylinders with average results")
    w.v(1, O + ":80 cylinder 1")
    cyl_avg = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 20, 22, 23, 24, 25, 27]
    w.v(len(cyl_avg), "TCilindro.cpp:738 number of variables")
    w.row(cyl_avg, "TCilindro.cpp:740 0 Wnet 1 NMEP 2 Wpump 3 PMEP 4 Qcomb 5-7 Q liner head piston "
                   "8 IMEP 9 trapped 20 AFR 22 intake 23 exhaust 24 short-circuit 25 mean T 27 VE")
    w.v(1, O + ":92 engine average results on")
    eng_avg = list(range(0, 23)) + [25, 26]
    w.v(len(eng_avg), E + ":648 number of variables")
    w.row(eng_avg, E + ":650 0-22 torque, work, MEPs, power, masses, rpm, VE, efficiencies, BSFC; 25 F/A; 26 AFR",
          per_line=25)
    w.v(0, O + ":105 plenums")
    w.v(0, O + ":119 turbocharger axes")
    w.v(0, O + ":133 compressors")
    w.v(0, O + ":147 turbines")
    w.v(2, O + ":161 valves")
    w.v(2, O + ":163 BC2 intake valve")
    w.row([2, 0, 1], "TTipoValvula.cpp:239 n vars, 0 CD in, 1 CD out")
    w.v(3, O + ":163 BC3 exhaust valve")
    w.row([2, 0, 1], "TTipoValvula.cpp:239 n vars, 0 CD in, 1 CD out")
    w.v(0, O + ":184 root compressors")
    w.v(0, O + ":199 venturis")
    w.v(0, O + ":214 plenum-to-plenum connections")
    w.v(0, O + ":249 sensors")
    w.v(0, O + ":263 controllers")

    w.section("INSTANTANEOUS RESULTS  TOutputResults::ReadInstantaneousResults")
    w.v(1, O + ":540 cylinders")
    w.v(1, O + ":542 cylinder 1")
    cyl_ins = [0, 1, 4, 5, 10, 11, 13, 25]
    w.v(len(cyl_ins), "TCilindro.cpp:1342 number of variables")
    w.row(cyl_ins, "TCilindro.cpp:1344 0 p 1 T 4 exhaust flow 5 intake flow 10 mass 11 volume 13 burned fraction 25 torque")
    w.v(0, O + ":554 plenums")
    w.v(2, O + ":568 pipes")
    w.v(0, O + ":571 WAMer number, ignored")
    w.v(1, O + ":573 pipe 1")
    w.v(1, U + ":2700 points")
    w.row([(p["intake_len_mm"] - p["cell_mm"]) / 1000.0, 3, 0, 1, 2],
          U + ":2737 distance m near the valve, n vars; 2740 vars 0 p 1 u 2 T")
    w.v(2, O + ":573 pipe 2")
    w.v(1, U + ":2700 points")
    w.row([p["cell_mm"] / 1000.0, 3, 0, 1, 2], U + ":2737 distance m near the valve, n vars; vars 0 p 1 u 2 T")
    w.v(0, O + ":585 venturis")
    w.v(2, O + ":599 valves")
    w.v(2, O + ":601 BC2 intake valve")
    w.row([1, 0], "TTipoValvula.cpp:134 n vars, 0 CD in")
    w.v(3, O + ":601 BC3 exhaust valve")
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


def main(argv):
    out = "%s.wam" % DEFAULTS["name"]
    over = {}
    for a in argv[1:]:
        if a.endswith(".json"):
            with open(a) as f:
                over.update(json.load(f))
        elif "=" in a:
            k, v = a.split("=", 1)
            if k not in DEFAULTS:
                raise SystemExit("unknown parameter %r" % k)
            ref = DEFAULTS[k]
            if isinstance(ref, bool):
                v = v.lower() in ("1", "true", "yes")
            elif isinstance(ref, int):
                v = int(v)
            elif isinstance(ref, float) or ref is None:
                v = float(v)
            over[k] = v
        else:
            out = a
    unknown = set(over) - set(DEFAULTS)
    if unknown:
        raise SystemExit("unknown parameter(s): %s" % ", ".join(sorted(unknown)))
    text = make_wam(over)
    with open(out, "w", newline="\n") as f:
        f.write(text)
    print("wrote %s (%d lines)" % (out, text.count("\n")))


if __name__ == "__main__":
    main(sys.argv)
