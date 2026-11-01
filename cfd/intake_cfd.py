#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
intake_cfd.py -- OpenFOAM case generator for engine intake tracts
=================================================================

Pure Python 3 (standard library only), so it can ship inside a Fusion 360
add-in (Windows) or behind a web page.  It takes one design dictionary and
writes a complete, ready-to-run OpenFOAM (ESI/openfoam.com v2412) case:

    mesh        blockMesh (2-D axisymmetric: a 5 deg sector whose two sides
                are a rotational cyclic pair) for straight parametric
                tracts, or blockMesh background + snappyHexMesh (3-D) for
                tracts with a bend or for an STL exported from CAD.
                An open inlet always gets an atmosphere/plenum region in
                front of it, so the entry flow (vena contracta, lip
                separation) is computed instead of imposed.
    physics     dry air, perfect gas, Sutherland viscosity; k-omega SST;
                rhoSimpleFoam (compressible) or simpleFoam (incompressible),
                chosen from the estimated peak Mach number.
    numerics    second-order bounded upwind-biased convection, SIMPLE.
    controls    residual targets, an engineering-quantity convergence stop,
                and an iteration cap.
    outputs     mass flow, static and total pressure drop, loss coefficient
                K, discharge coefficient Cd (flow-bench definition), and for
                each named plane (e.g. the MAF): velocity uniformity index,
                secondary-flow angle and swirl angle (intake_report.py).

Every generated file starts with a header comment that says which design
inputs set which values in that file.

Usage
-----
    python intake_cfd.py design.json  out_case_dir
    python intake_cfd.py --example  > design.json   (prints an example)

or from Python:

    import intake_cfd
    summary = intake_cfd.generate_case(design_dict, "out_case_dir")

Design dictionary (lengths in mm unless the key says otherwise)
---------------------------------------------------------------
{
  "name": "stack_test",
  "geometry": {                     # EITHER parametric ...
    "tube_diameter_mm": 23.0,       # inner diameter after the inlet piece
    "tube_length_mm": 46.0,         # mouth front plane -> tract end (station)
    "inlet": {"type": "plain",   "wall_thickness_mm": 1.85}
          |  {"type": "radius",  "lip_radius_mm": 6}
          |  {"type": "ellipse", "length_mm": 23, "entry_diameter_mm": 49,
              "exit_diameter_mm": 23, "corner_radius_mm": 3}
          |  {"type": "taper",   "entry_diameter_mm": 40,
              "wall_half_angle_deg": 10, "lip_radius_mm": 3},
    "mount": {"type": "free", "protrusion_mm": 46}   # stack stands in open air
           | {"type": "flange"},                       # flush in a wall/airbox floor
    "diameter_change": {"to_diameter_mm": 30, "cone_half_angle_deg": 7,
                        "start_mm": 60},               # optional
    "bend": {"clr_mm": 60, "angle_deg": 90, "start_mm": 80},  # optional -> 3-D
    "maf_plane_mm": 150,                               # optional
    "planes_mm": {"name": x_mm, ...},                  # optional extra planes
    "outlet_extension_D": 4                            # straight pipe after
  },                                                   # the tract end
  "geometry": {                     # ... OR an STL from CAD
    "stl": "tract.stl"  |  {"wall": "w.stl", "inlet": "i.stl", "outlet": "o.stl"},
    "stl_units": "mm",              # ASCII multi-solid STL: solids named
                                    # 'inlet', 'outlet', anything else = wall
    "planes": {"maf": {"point_mm": [x,y,z], "normal": [nx,ny,nz]}},
    "outlet_extension_D": 4
  },
  "operating_point": {
    "mass_flow_kg_s": 0.05                          # OR
    "engine": {"displacement_cc": 1000, "rpm": 9000, "ve": 0.95,
               "strokes": 4, "cylinders": 4, "cylinders_fed": 1}   # OR
    "pressure_ratio": 1.04                           # p0_ambient / p_outlet
  },
  "ambient": {"p_pa": 101325, "T_c": 25},
  "mesh": {"level": "medium"},        # coarse | medium | fine
  "turbulence": {"intensity": 0.01, "viscosity_ratio": 1},  # optional inflow
                                      # turbulence (default: quiet air)
  "solver": {"force": null}           # "compressible" | "incompressible"
}

Exhaust-component mode (collectors, X/H-pipes, muffler shells, tips):
{
  "name": "collector_4_1",
  "mode": "exhaust",
  "geometry": {"stl": "part.stl", "stl_units": "mm",     # solids named inlet or inlet1..N, outlet
               "inlet_extension_D": 2, "outlet_extension_D": 2},
  "operating_point": {"mass_flow_kg_s": 0.25            # total exhaust flow, OR
                      "engine": {... as above, "cylinders_fed": 4},   # air flow x (1 + 1/AFR)
                      "inlet_split": {"inlet1": 1, "inlet2": 1, ...}}, # optional; default equal
  "gas": {"T_c": 650, "afr": 12.5},                     # gas temperature at the inlets
  "ambient": {"p_pa": 101325, "T_c": 25},               # outlet static pressure; intake air
  "mesh": {"level": "medium"}
}
Each inlet is extruded upstream by inlet_extension_D x its diameter and fed a
uniform mass flow of hot gas; the outlet is extruded by outlet_extension_D and
held at ambient static pressure.  results.json then holds, under "summary":
the total-pressure loss inlet faces -> exit face (Pa), K in dynamic heads of
the inlet bulk velocity (total flow / total inlet area), K_to_ambient, the
back pressure, the flow split and the exit uniformity.  Always compressible.

Coordinates (intake mode): the flow enters along +x; x = 0 is the front-most
plane of the inlet mouth (the bellmouth lip or the pipe end).  Exhaust mode
keeps the CAD coordinates.

The defaults and every physical choice are explained in NOTES.md and in the
header of each generated file.
"""

from __future__ import annotations

import datetime
import json
import math
import os
import stat
import struct
import sys

GENERATOR = "intake_cfd.py"
VERSION = "1.1.0"      # 1.1.0 (2026-11-01): 2-D sector with rotational cyclic sides instead of wedge patches;
#                         flow scale from the sector's true (flat-chord) area; incompressible SIMPLE (was SIMPLEC);
#                         a finer 3-D base cell for mesh level 'fine'; Re from the smallest section's own diameter
FOAM_VERSION = "v2412"

# --------------------------------------------------------------------------
# Dry-air properties
# --------------------------------------------------------------------------
R_UNIV = 8.314462618          # J/(mol K)   CODATA 2018
M_AIR = 28.9647e-3            # kg/mol      dry air (US Std. Atmosphere 1976)
R_AIR = R_UNIV / M_AIR        # 287.05 J/(kg K)
CP_AIR = 1004.5               # J/(kg K)    near 300 K (varies <0.5 % 250-400 K)
GAMMA = CP_AIR / (CP_AIR - R_AIR)   # 1.400
SUTH_AS = 1.458e-6            # Pa s K^-0.5 Sutherland constants for air
SUTH_TS = 110.4               # K           (White, Viscous Fluid Flow)
PR_T = 0.85                   # turbulent Prandtl number (standard)

# Solver selection threshold: estimated *peak local* Mach number above which
# density changes (~M^2/2 > 2 %) are not negligible for a "no surprises"
# pressure-drop prediction.
MACH_COMPRESSIBLE = 0.20
MACH_TRANSONIC = 0.60

MESH_LEVELS = {
    #            q_r: radial growth from the wall, core: max radial cell / R
    #            q_up: growth away from lip/body, far: far-field cell / R_ff
    #            entry: axial cell at tube entry / D, q_ax: axial growth,
    #            tube: max axial cell / D, bell: wall-tangential cell on the
    #            bellmouth / D, q_cap: growth around the lip; 3-D: background cell D/bg3d refined
    #            level3d times (fine = medium's levels on a 1.5x finer background, so it is a real check)
    "coarse": dict(q_r=1.15, core=1 / 12., q_up=1.18, far=1 / 10., entry=1 / 50.,
                   q_ax=1.12, tube=1 / 10., bell=1 / 50., q_cap=1.15, out=1 / 4.,
                   level3d=2, bg3d=2.0),
    "medium": dict(q_r=1.10, core=1 / 18., q_up=1.13, far=1 / 14., entry=1 / 75.,
                   q_ax=1.08, tube=1 / 15., bell=1 / 75., q_cap=1.10, out=1 / 6.,
                   level3d=3, bg3d=2.0),
    "fine": dict(q_r=1.07, core=1 / 27., q_up=1.09, far=1 / 20., entry=1 / 110.,
                 q_ax=1.055, tube=1 / 22., bell=1 / 110., q_cap=1.07, out=1 / 9.,
                 level3d=3, bg3d=3.0),
}

# 2-D axisymmetric cases are a thin sector of the 3-D tract (half-angle below, 5 deg in all) whose two sides are a
# rotational cyclic pair, not OpenFOAM wedge patches. On wedge patches the Linux build of the reference runs
# (conda-forge openfoam 2412) gives fully developed pipe flow 1.25x the pressure gradient that its wall shear stress
# balances (laminar against Hagen-Poiseuille, and turbulent at Re 2e5 alike): there the explicit part of the viscous
# stress, -div(nuEff dev2(T(grad U))), which simpleFoam/rhoSimpleFoam carry, sustains an axial odd-even velocity mode,
# and the Windows builds gave a different answer on the same wedge mesh. On the cyclic sector the pipe comes out right
# (1.008x laminar, 1.015x turbulent). cfd/NOTES.md section 4 (e).
SECTOR_HALF_ANGLE_DEG = 2.5
RAMP_ITER = 300          # outlet condition ramp for a smooth start-up


class DesignError(ValueError):
    """Raised for an invalid or physically impossible design input."""


# --------------------------------------------------------------------------
# Small math helpers
# --------------------------------------------------------------------------
def mu_air(T):
    """Dynamic viscosity of air [Pa s], Sutherland's law."""
    return SUTH_AS * math.sqrt(T) / (1.0 + SUTH_TS / T)


def ideal_mass_flux(p0, T0, p):
    """Isentropic mass flux [kg/(s m^2)] from reservoir (p0,T0) to static p.
    Choked (sonic) value below the critical pressure ratio."""
    g = GAMMA
    pr_crit = (2.0 / (g + 1.0)) ** (g / (g - 1.0))
    pr = max(min(p / p0, 1.0), pr_crit)
    return p0 * math.sqrt(2.0 * g / ((g - 1.0) * R_AIR * T0)) * pr ** (1.0 / g) * \
        math.sqrt(max(0.0, 1.0 - pr ** ((g - 1.0) / g)))


def mach_from_mass_flux(G, p0, T0):
    """Subsonic Mach number giving isentropic mass flux G [kg/(s m^2)]."""
    g = GAMMA

    def flux(M):
        return p0 * math.sqrt(g / (R_AIR * T0)) * M * \
            (1 + 0.5 * (g - 1) * M * M) ** (-(g + 1) / (2 * (g - 1)))
    if G >= flux(1.0):
        raise DesignError("requested mass flow exceeds the choked (sonic) limit "
                          "of the smallest cross-section (%.1f kg/s/m^2 > %.1f)"
                          % (G, flux(1.0)))
    lo, hi = 0.0, 1.0
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if flux(mid) < G:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def friction_factor_haaland(Re, rel_rough=0.0):
    """Darcy friction factor, Haaland (1983) explicit form of Colebrook."""
    if Re < 2300:
        return 64.0 / max(Re, 1.0)
    return (-1.8 * math.log10((rel_rough / 3.7) ** 1.11 + 6.9 / Re)) ** -2


def friction_factor_colebrook(Re, rel_rough=0.0):
    """Darcy friction factor, Colebrook-White (1939), solved iteratively."""
    if Re < 2300:
        return 64.0 / max(Re, 1.0)
    f = friction_factor_haaland(Re, rel_rough)
    for _ in range(60):
        f = (-2.0 * math.log10(rel_rough / 3.7 + 2.51 / (Re * math.sqrt(f)))) ** -2
    return f


def _solve_ratio(L, n, h1):
    """Per-cell geometric ratio r with h1*(r^n-1)/(r-1) = L."""
    if n <= 1:
        return 1.0
    if abs(L - n * h1) < 1e-12 * L:
        return 1.0

    def S(r):
        return n * h1 if abs(r - 1) < 1e-12 else h1 * (r ** n - 1) / (r - 1)
    if L > n * h1:
        lo, hi = 1.0, 2.0
        while S(hi) < L:
            hi *= 1.5
    else:
        lo, hi = 1e-6, 1.0
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if S(mid) < L:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


class Dist:
    """1-D cell distribution along a blockMesh edge, stored as blockMesh
    multi-grading sections [(length_frac, cell_frac, expansion_ratio), ...]
    in the edge's positive direction."""

    def __init__(self, n, sections):
        self.n = int(n)
        self.sections = sections

    def rev(self):
        return Dist(self.n, [(a, b, 1.0 / c) for (a, b, c) in reversed(self.sections)])

    def foam(self):
        if len(self.sections) == 1:
            return "%.8g" % self.sections[0][2]
        return "(" + " ".join("(%.10g %.10g %.8g)" % s for s in self.sections) + ")"

    def sizes(self, L):
        out = []
        for (lf, cf, er) in self.sections:
            nc = int(round(cf * self.n))
            Ls = lf * L
            if nc <= 0:
                continue
            r = er ** (1.0 / (nc - 1)) if nc > 1 else 1.0
            h1 = Ls / nc if abs(r - 1) < 1e-12 else Ls * (r - 1) / (r ** nc - 1)
            out += [h1 * r ** i for i in range(nc)]
        return out

    @staticmethod
    def uniform(n):
        return Dist(max(1, int(n)), [(1.0, 1.0, 1.0)])

    @staticmethod
    def fine_start(L, h1, q, hmax, nmin=2):
        """Geometric growth from h1 (ratio q) until hmax, then uniform."""
        if h1 >= hmax or q <= 1.0001:
            return Dist.uniform(max(nmin, math.ceil(L / min(h1, hmax))))
        k = int(math.floor(math.log(hmax / h1) / math.log(q))) + 1
        Lg = h1 * (q ** k - 1) / (q - 1)
        if Lg >= L:
            n = max(nmin, int(math.ceil(math.log(1 + L * (q - 1) / h1) / math.log(q))))
            r = _solve_ratio(L, n, h1)
            return Dist(n, [(1.0, 1.0, r ** (n - 1))])
        nu = int(math.ceil((L - Lg) / hmax))
        n = k + nu
        return Dist(n, [(Lg / L, k / n, q ** (k - 1)), ((L - Lg) / L, nu / n, 1.0)])

    @staticmethod
    def fixed_n(L, n, h1, q):
        """n cells, first cell h1 growing at <= q, remainder uniform; the
        split is chosen so the size changes smoothly. Used where several
        edges must share a cell count but have different lengths."""
        n = int(n)
        if n * h1 >= L:
            return Dist.uniform(n)
        best = None
        for k in range(1, n):
            Lg = h1 * (q ** k - 1) / (q - 1)
            if Lg >= L:
                break
            hu = (L - Lg) / (n - k)
            err = abs(math.log(hu / (h1 * q ** k)))
            if best is None or err < best[0]:
                best = (err, k, Lg)
        if best is None or best[0] > math.log(q) * 1.5:
            # pure geometric with solved ratio
            if best is None or (L - best[2]) / (n - best[1]) > h1 * q ** best[1] * q:
                r = _solve_ratio(L, n, h1)
                return Dist(n, [(1.0, 1.0, r ** (n - 1))])
        _, k, Lg = best
        return Dist(n, [(Lg / L, k / n, q ** (k - 1)), ((L - Lg) / L, (n - k) / n, 1.0)])

    @staticmethod
    def geometric_n(L, n, h1):
        r = _solve_ratio(L, n, h1)
        return Dist(n, [(1.0, 1.0, r ** (n - 1))])


def _poly_len(pts):
    return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
               for i in range(len(pts) - 1))


def _fmt(v):
    return "%.9g" % v


def _vec(v):
    return "(%s %s %s)" % (_fmt(v[0]), _fmt(v[1]), _fmt(v[2]))


# 3-D vector helpers
def v_add(a, b): return (a[0] + b[0], a[1] + b[1], a[2] + b[2])
def v_sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def v_mul(a, s): return (a[0] * s, a[1] * s, a[2] * s)
def v_dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def v_cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def v_norm(a):
    m = math.sqrt(v_dot(a, a))
    return (a[0] / m, a[1] / m, a[2] / m) if m > 0 else (0.0, 0.0, 0.0)


def v_len(a): return math.sqrt(v_dot(a, a))


def rotate_about(v, axis, ang):
    """Rodrigues rotation of v about unit axis by ang [rad]."""
    c, s = math.cos(ang), math.sin(ang)
    return v_add(v_add(v_mul(v, c), v_mul(v_cross(axis, v), s)),
                 v_mul(axis, v_dot(axis, v) * (1 - c)))


# --------------------------------------------------------------------------
# File writing with provenance headers
# --------------------------------------------------------------------------
FOAM_BANNER = """/*--------------------------------*- C++ -*----------------------------------*\\
  =========                 |
  \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox
   \\\\    /   O peration     | Version:  %s (openfoam.com)
    \\\\  /    A nd           |
     \\\\/     M anipulation  |
\\*---------------------------------------------------------------------------*/
""" % FOAM_VERSION


class CaseWriter:
    def __init__(self, root, design_name, stamp):
        self.root = root
        self.name = design_name
        self.stamp = stamp
        self.files = []

    def _provenance(self, lines, comment="//"):
        out = ["%s Generated by %s %s on %s for design '%s'." %
               (comment, GENERATOR, VERSION, self.stamp, self.name),
               "%s Design inputs -> values in this file:" % comment]
        for ln in lines:
            out.append("%s   %s" % (comment, ln))
        out.append("%s Do not edit by hand unless you know why; re-generate instead." % comment)
        return "\n".join(out) + "\n"

    def foam(self, rel, cls, obj, body, prov, location=None):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        hdr = FOAM_BANNER + self._provenance(prov) + "\nFoamFile\n{\n    version     2.0;\n" \
            "    format      ascii;\n    class       %s;\n" % cls
        if location:
            hdr += '    location    "%s";\n' % location
        hdr += "    object      %s;\n}\n" % obj
        hdr += "// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //\n\n"
        with open(path, "w", newline="\n") as f:
            f.write(hdr + body.rstrip() + "\n\n// ************************************************************************* //\n")
        self.files.append(rel)

    def text(self, rel, body, prov=None, comment="#", executable=False, shebang=None):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path) or self.root, exist_ok=True)
        s = ""
        if shebang:
            s += shebang + "\n"
        if prov is not None:
            s += self._provenance(prov, comment) + "\n"
        s += body
        with open(path, "w", newline="\n") as f:
            f.write(s)
        if executable:
            st = os.stat(path)
            os.chmod(path, st.st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        self.files.append(rel)

    def raw(self, rel, data):
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", newline="\n") as f:
            f.write(data)
        self.files.append(rel)


# --------------------------------------------------------------------------
# Design normalisation and derived physics
# --------------------------------------------------------------------------
def _get(d, key, default=None):
    v = d.get(key, default) if isinstance(d, dict) else default
    return default if v is None else v


def normalise(design, base_dir="."):
    """Validate the design dictionary and convert it to SI units."""
    if not isinstance(design, dict):
        raise DesignError("design must be a dict")
    d = {"name": str(_get(design, "name", "intake")).strip() or "intake"}
    g_in = design.get("geometry")
    if not isinstance(g_in, dict):
        raise DesignError("design['geometry'] is required")
    amb = design.get("ambient", {}) or {}
    p_amb = float(_get(amb, "p_pa", 101325.0))
    if "T_c" in amb or "T_k" in amb:
        T_amb = float(amb["T_k"]) if "T_k" in amb else float(amb["T_c"]) + 273.15
    else:
        T_amb = 298.15
    if not (20e3 < p_amb < 200e3):
        raise DesignError("ambient pressure %.0f Pa is outside 20-200 kPa" % p_amb)
    if not (200 < T_amb < 400):
        raise DesignError("ambient temperature %.1f K is outside 200-400 K" % T_amb)
    d["p_amb"], d["T_amb"] = p_amb, T_amb
    # mode: 'intake' (an open mouth drawing from the atmosphere) or 'exhaust' (a component with one or more
    # inlets fed with hot gas at a set mass flow and an outlet at ambient static pressure)
    d["mode_kind"] = str(_get(design, "mode", "intake")).lower()
    if d["mode_kind"] not in ("intake", "exhaust"):
        raise DesignError("mode must be 'intake' or 'exhaust'")
    if d["mode_kind"] == "exhaust":
        gas = design.get("gas", {}) or {}
        T_gas = float(gas["T_k"]) if "T_k" in gas else float(_get(gas, "T_c", 650.0)) + 273.15
        if not (250 < T_gas < 1400):
            raise DesignError("gas temperature %.0f K is outside 250-1400 K" % T_gas)
        d["T_gas"] = T_gas
        d["T_air"] = T_amb          # intake air for the engine mass-flow formula
        d["T_amb"] = T_gas          # the reservoir state for density, viscosity, Mach and wall spacing is the hot gas
        d["afr"] = float(_get(gas, "afr", 12.5))
        if "stl" not in (g_in or {}):
            raise DesignError("exhaust mode needs geometry.stl (an STL from CAD with faces named inlet / inlet1..N and outlet)")
    mm = 1e-3
    g = {}
    if "stl" in g_in:
        g["kind"] = "stl"
        g["exhaust"] = d["mode_kind"] == "exhaust"
        g["ext_in_D"] = float(_get(g_in, "inlet_extension_D", 2.0))
        split = _get(design.get("operating_point", {}) or {}, "inlet_split", None)
        g["inlet_split"] = {str(k): float(v) for k, v in split.items()} if isinstance(split, dict) else None
        units = str(_get(g_in, "stl_units", "mm")).lower()
        g["scale"] = {"mm": 1e-3, "m": 1.0, "cm": 1e-2, "in": 0.0254, "inch": 0.0254}.get(units)
        if g["scale"] is None:
            raise DesignError("stl_units must be mm, cm, m or in")
        g["stl"] = g_in["stl"]
        g["base_dir"] = base_dir
        g["planes3d"] = {}
        for nm, pl in (_get(g_in, "planes", {}) or {}).items():
            g["planes3d"][_safe_name(nm)] = (tuple(float(c) * g["scale"] for c in pl["point_mm"]) if "point_mm" in pl
                                             else tuple(float(c) for c in pl["point_m"]),
                                             v_norm(tuple(float(c) for c in pl["normal"])))
        g["ext_D"] = float(_get(g_in, "outlet_extension_D", 4.0))
        g["mount"] = "flange"
    else:
        D = float(_get(g_in, "tube_diameter_mm", 0)) * mm
        Lt = float(_get(g_in, "tube_length_mm", 0)) * mm
        if D <= 0 or Lt <= 0:
            raise DesignError("tube_diameter_mm and tube_length_mm must be > 0")
        g["D"], g["L"] = D, Lt
        inl = dict(_get(g_in, "inlet", {"type": "plain"}))
        t = str(_get(inl, "type", "plain")).lower()
        if t not in ("plain", "radius", "ellipse", "taper"):
            raise DesignError("inlet type must be plain, radius, ellipse or taper")
        gi = {"type": t}
        if t == "plain":
            gi["t"] = float(_get(inl, "wall_thickness_mm", max(1.5, 0.06 * D / mm))) * mm
        elif t == "radius":
            gi["rc"] = float(_get(inl, "lip_radius_mm", 0.15 * D / mm)) * mm
            if gi["rc"] <= 0:
                raise DesignError("radius inlet needs lip_radius_mm > 0")
        elif t == "ellipse":
            gi["L"] = float(_get(inl, "length_mm", D / mm)) * mm
            gi["Di"] = float(_get(inl, "entry_diameter_mm", 2.0 * D / mm)) * mm
            gi["De"] = float(_get(inl, "exit_diameter_mm", D / mm)) * mm
            gi["rc"] = float(_get(inl, "corner_radius_mm", 0.0)) * mm
            gi["t"] = float(_get(inl, "rim_thickness_mm", 1.5)) * mm
            if abs(gi["De"] - D) > 1e-6:
                raise DesignError("ellipse exit_diameter_mm must equal tube_diameter_mm")
            if gi["Di"] <= gi["De"] or gi["L"] <= 0:
                raise DesignError("ellipse needs entry_diameter > exit_diameter and length > 0")
        elif t == "taper":
            gi["Di"] = float(_get(inl, "entry_diameter_mm", 1.6 * D / mm)) * mm
            gi["alpha"] = math.radians(float(_get(inl, "wall_half_angle_deg", 10.0)))
            gi["rl"] = float(_get(inl, "lip_radius_mm", 0.1 * D / mm)) * mm
            if gi["Di"] <= D:
                raise DesignError("taper entry_diameter_mm must exceed tube_diameter_mm")
            if not (math.radians(1) <= gi["alpha"] <= math.radians(60)):
                raise DesignError("taper wall_half_angle_deg must be 1..60")
            if gi["rl"] < 0.2e-3:
                raise DesignError("taper lip_radius_mm must be >= 0.2 mm")
        g["inlet"] = gi
        mount = dict(_get(g_in, "mount", {"type": "free"}))
        g["mount"] = str(_get(mount, "type", "free")).lower()
        if g["mount"] not in ("free", "flange"):
            raise DesignError("mount type must be free or flange")
        g["protrusion"] = float(mount["protrusion_mm"]) * mm if "protrusion_mm" in mount else None
        dc = g_in.get("diameter_change")
        if dc:
            g["dc"] = dict(D2=float(dc["to_diameter_mm"]) * mm,
                           beta=math.radians(float(_get(dc, "cone_half_angle_deg", 7.0))),
                           x0=float(dc["start_mm"]) * mm)
            if not (0 < g["dc"]["beta"] <= math.radians(60)):
                raise DesignError("cone_half_angle_deg must be in (0, 60]")
        else:
            g["dc"] = None
        bd = g_in.get("bend")
        if bd:
            bl = bd if isinstance(bd, list) else [bd]
            g["bends"] = [dict(clr=float(b["clr_mm"]) * mm, angle=math.radians(float(b["angle_deg"])),
                               s0=float(b["start_mm"]) * mm,
                               plane=math.radians(float(_get(b, "plane_deg", 0.0)))) for b in bl]
        else:
            g["bends"] = []
        planes = {}
        if g_in.get("maf_plane_mm") is not None:
            planes["maf"] = float(g_in["maf_plane_mm"]) * mm
        for nm, x in (_get(g_in, "planes_mm", {}) or {}).items():
            planes[_safe_name(nm)] = float(x) * mm
        g["planes"] = planes
        g["ext_D"] = float(_get(g_in, "outlet_extension_D", 4.0))
        g["kind"] = "3d" if (g["bends"] or str(_get(g_in, "force_3d", False)).lower() == "true"
                             or g_in.get("force_3d") is True) else "axisym"
    d["geometry"] = g
    op = design.get("operating_point")
    if not isinstance(op, dict):
        raise DesignError("design['operating_point'] is required")
    d["op_in"] = op
    m = design.get("mesh", {}) or {}
    lvl = str(_get(m, "level", "medium")).lower()
    if lvl not in MESH_LEVELS:
        raise DesignError("mesh level must be coarse, medium or fine")
    d["mesh_level"] = lvl
    d["mesh_overrides"] = m
    sv = design.get("solver", {}) or {}
    force = _get(sv, "force", None)
    if force not in (None, "compressible", "incompressible"):
        raise DesignError("solver.force must be compressible, incompressible or null")
    d["solver_force"] = force
    d["max_iter"] = int(_get(sv, "max_iterations", 0))
    d["turbulence_in"] = design.get("turbulence") or {}
    d["write_interval"] = int(_get(sv, "write_interval", 0))
    return d


def _safe_name(s):
    out = "".join(c if (c.isalnum() or c == "_") else "_" for c in str(s))
    if not out or not out[0].isalpha():
        out = "p_" + out
    return out


def engine_mass_flow(eng, rho_amb):
    """Mean air mass flow of the cylinders fed by this tract [kg/s].
    mdot = VE * rho_amb * V_d * (rpm/60) / (revs per cycle) * fed/total."""
    if "displacement_cc" in eng:
        Vd = float(eng["displacement_cc"]) * 1e-6
    elif "displacement_l" in eng:
        Vd = float(eng["displacement_l"]) * 1e-3
    else:
        raise DesignError("engine needs displacement_cc or displacement_l")
    rpm = float(eng["rpm"])
    ve = float(_get(eng, "ve", 0.9))
    if ve > 3:
        ve /= 100.0          # given in percent
    strokes = int(_get(eng, "strokes", 4))
    if strokes not in (2, 4):
        raise DesignError("strokes must be 2 or 4")
    ncyl = int(_get(eng, "cylinders", 1))
    nfed = int(_get(eng, "cylinders_fed", ncyl))
    peak = float(_get(eng, "flow_factor", 1.0))
    revs = 2.0 if strokes == 4 else 1.0
    mdot = ve * rho_amb * Vd * rpm / 60.0 / revs * nfed / ncyl * peak
    return mdot, dict(Vd=Vd, rpm=rpm, ve=ve, strokes=strokes, cylinders=ncyl,
                      cylinders_fed=nfed, flow_factor=peak)


# --------------------------------------------------------------------------
# Axisymmetric inlet profiles  (x downstream, r radial; metres)
# --------------------------------------------------------------------------
class InletProfile:
    """inner : flow-side surface from the front point F to the tube start T
       iM    : index of the 'mouth' block vertex M in inner
       cap_free : lip outer surface F -> O for a free-standing inlet
       r_out : outer body radius behind the lip
       sharp_M, sharp_O : sharp (non-tangent) corners at M / O"""

    def __init__(self, inner, iM, cap_free, r_out, sharp_M, sharp_O, front_r, label):
        self.inner, self.iM, self.cap_free = inner, iM, cap_free
        self.r_out, self.sharp_M, self.sharp_O = r_out, sharp_M, sharp_O
        self.front_r = front_r
        self.length = inner[-1][0]
        self.label = label


def _arc_pts(cx, cr, rad, a0, a1, n):
    return [(cx + rad * math.cos(a0 + (a1 - a0) * i / n), cr + rad * math.sin(a0 + (a1 - a0) * i / n))
            for i in range(n + 1)]


def _edge_radius(g):
    """Radius used for 'sharp' edges: 0.001 D, at most 0.05 mm (a machined
    sharp edge).  Idelchik's entrance data show no measurable change of the
    loss coefficient below r/D ~ 0.002, so this is 'sharp' for the flow but
    lets one body-fitted mesh topology handle every inlet type."""
    return min(1e-3 * g["D"], 0.05e-3)


def inlet_profile(g):
    R = g["D"] / 2.0
    gi = g["inlet"]
    t = gi["type"]
    re_ = _edge_radius(g)
    if t in ("plain", "radius"):
        rc = gi["rc"] if t == "radius" else re_
        cx, cr = rc, R + rc
        a = _arc_pts(cx, cr, rc, math.pi, 1.25 * math.pi, 24)
        b = _arc_pts(cx, cr, rc, 1.25 * math.pi, 1.5 * math.pi, 24)
        inner = a + b[1:]
        if t == "radius":
            cap = _arc_pts(cx, cr, rc, math.pi, 0.5 * math.pi, 36)
            return InletProfile(inner, 24, cap, R + 2 * rc, False, False, R + rc,
                                "semi-toroidal lip, radius %.2f mm (entry dia %.2f mm)" % (rc * 1e3, 2 * (R + rc) * 1e3))
        tw = gi["t"]
        face_top = R + tw - re_
        cap = [(0.0, R + re_ + (face_top - R - re_) * i / 20) for i in range(21)] + \
            _arc_pts(re_, face_top, re_, math.pi, 0.5 * math.pi, 12)[1:]
        return InletProfile(inner, 24, cap, R + tw, False, False, R,
                            "sharp-edged plain pipe, wall %.2f mm (edge radius %.3f mm)" % (tw * 1e3, re_ * 1e3))
    if t == "ellipse":
        a, b = gi["L"], (gi["Di"] - gi["De"]) / 2.0
        cx, cr = gi["L"], gi["Di"] / 2.0
        tM = math.atan2(b, a)

        def P(tt): return (cx - a * math.cos(tt), cr - b * math.sin(tt))
        n1, n2 = 24, 48
        inner = [P(tM * i / n1) for i in range(n1 + 1)] + \
                [P(tM + (0.5 * math.pi - tM) * i / n2) for i in range(1, n2 + 1)]
        if gi["rc"] > 0:
            rc = gi["rc"]
            cap = _arc_pts(rc, cr, rc, math.pi, 0.5 * math.pi, 24)
            return InletProfile(inner, n1, cap, cr + rc, False, False, cr,
                                "elliptical bellmouth L=%.1f Di=%.1f De=%.1f Rc=%.1f mm" %
                                (gi["L"] * 1e3, gi["Di"] * 1e3, gi["De"] * 1e3, rc * 1e3))
        tw = gi["t"]
        face_top = cr + tw - re_
        cap = [(0.0, cr + (face_top - cr) * i / 16) for i in range(17)] + \
            _arc_pts(re_, face_top, re_, math.pi, 0.5 * math.pi, 12)[1:]
        return InletProfile(inner, n1, cap, cr + tw, False, False, cr,
                            "elliptical bellmouth L=%.1f Di=%.1f De=%.1f, sharp rim %.1f mm thick" %
                            (gi["L"] * 1e3, gi["Di"] * 1e3, gi["De"] * 1e3, tw * 1e3))
    # taper
    al, rl, ri = gi["alpha"], gi["rl"], gi["Di"] / 2.0
    cx, cr = rl, ri + rl * math.cos(al)
    S = (cx - rl * math.sin(al), ri)
    T = (S[0] + (ri - R) / math.tan(al), R)
    a_end = 1.5 * math.pi - al
    if al < math.radians(45):
        a = _arc_pts(cx, cr, rl, math.pi, 1.25 * math.pi, 16)
        b = _arc_pts(cx, cr, rl, 1.25 * math.pi, a_end, 12)
        arc = a + b[1:]
        iM = 16
    else:
        arc = _arc_pts(cx, cr, rl, math.pi, a_end, 24)
        iM = 12
    ncone = 40
    cone = [(S[0] + (T[0] - S[0]) * i / ncone, S[1] + (T[1] - S[1]) * i / ncone) for i in range(1, ncone + 1)]
    cap = _arc_pts(cx, cr, rl, math.pi, 0.5 * math.pi, 24)
    return InletProfile(arc + cone, iM, cap, cr + rl, False, False, cr,
                        "tapered inlet, %.1f deg half-angle, lip radius %.2f mm, entry dia %.1f mm" %
                        (math.degrees(al), rl * 1e3, gi["Di"] * 1e3))


def tube_radius(g, x):
    """Inner radius of the tract downstream of the inlet piece at axial x."""
    R = g["D"] / 2.0
    dc = g.get("dc")
    if not dc:
        return R
    R2 = dc["D2"] / 2.0
    Lc = abs(R2 - R) / math.tan(dc["beta"])
    if x <= dc["x0"]:
        return R
    if x >= dc["x0"] + Lc:
        return R2
    return R + (R2 - R) * (x - dc["x0"]) / Lc


def tract_stations(g, prof):
    """Axial break points of the tube: inlet end, cone ends, planes, end, outlet."""
    xs = {prof.length: "inlet_end"}
    if g.get("dc"):
        R, R2 = g["D"] / 2.0, g["dc"]["D2"] / 2.0
        Lc = abs(R2 - R) / math.tan(g["dc"]["beta"])
        x0 = g["dc"]["x0"]
        if x0 < prof.length - 1e-9 or x0 + Lc > g["L"] + 1e-9:
            raise DesignError("diameter change must start after the inlet piece (x >= %.1f mm) "
                              "and end before the tract end" % (prof.length * 1e3))
        xs[x0] = "cone_start"
        xs[x0 + Lc] = "cone_end"
    xs[g["L"]] = "tract_end"
    Dout = 2 * tube_radius(g, g["L"])
    xo = g["L"] + g["ext_D"] * Dout
    xs[xo] = "outlet"
    for nm, x in g["planes"].items():
        if x < prof.length - 1e-9 or x > xo - 0.5 * Dout:
            raise DesignError("plane '%s' at %.1f mm must lie between the end of the inlet piece "
                              "(%.1f mm) and the outlet minus D/2 (%.1f mm)" %
                              (nm, x * 1e3, prof.length * 1e3, (xo - 0.5 * Dout) * 1e3))
        xs[x] = "plane:" + nm
    if g["L"] < prof.length - 1e-9:
        raise DesignError("tube_length_mm (%.1f) must be at least the inlet piece length (%.1f mm)"
                          % (g["L"] * 1e3, prof.length * 1e3))
    # merge stations closer than 1e-6 m
    out = []
    for x in sorted(xs):
        if out and abs(x - out[-1][0]) < 1e-6:
            out[-1] = (out[-1][0], out[-1][1] + "|" + xs[x])
        else:
            out.append((x, xs[x]))
    return out


def derive(d):
    """Operating point, fluid properties, Mach estimate, solver choice,
    turbulence boundary values and wall resolution (all SI)."""
    p0, T0 = d["p_amb"], d["T_amb"]
    rho0 = p0 / (R_AIR * T0)
    mu0 = mu_air(T0)
    g = d["geometry"]
    op = d["op_in"]
    der = {"p_amb": p0, "T_amb": T0, "rho_amb": rho0, "mu_amb": mu0, "nu_amb": mu0 / rho0,
           "a_amb": math.sqrt(GAMMA * R_AIR * T0), "R_air": R_AIR, "cp": CP_AIR, "gamma": GAMMA}
    # reference (tract) diameter and the smallest flow area
    if g["kind"] == "stl":
        Dref, Amin = g["Dref"], g["Amin"]
        peak_factor = 1.3
    else:
        prof = g["profile"]
        Dref = g["D"]
        Rmin = min(g["D"] / 2.0, tube_radius(g, g["L"]))
        Amin = math.pi * Rmin ** 2
        peak_factor = {"plain": 1.6, "taper": 1.2, "radius": 1.1, "ellipse": 1.05}[g["inlet"]["type"]]
        if g["bends"]:
            peak_factor *= 1.15
    der["D_ref"], der["A_min"], der["peak_factor"] = Dref, Amin, peak_factor
    # Reynolds number (wall-cell sizing, Colebrook f) at the smallest section, from that section's own diameter:
    # the bulk velocity below is the one at Amin (before 1.1.0 it was paired with Dref, e.g. an exhaust part's
    # outlet diameter with its inlet velocity)
    if g["kind"] == "stl" and g.get("inlets") and Amin >= g["A_in_total"] * (1 - 1e-9):
        der["D_Re"] = math.sqrt(4.0 * Amin / (math.pi * len(g["inlets"])))     # per inlet pipe
    else:
        der["D_Re"] = math.sqrt(4.0 * Amin / math.pi)
    # operating point
    if "mass_flow_kg_s" in op:
        mode = "mass_flow"
        mdot = float(op["mass_flow_kg_s"])
        src = "mass_flow_kg_s = %.6g kg/s (given)" % mdot
    elif "engine" in op:
        mode = "mass_flow"
        rho_eng = p0 / (R_AIR * d.get("T_air", T0))      # intake air density (exhaust mode: not the hot gas)
        mdot, info = engine_mass_flow(op["engine"], rho_eng)
        der["engine"] = info
        src = ("engine: VE %.3f x rho_amb %.4f kg/m3 x Vd %.1f cc x %.0f rpm / 60 / %d rev/cycle x %d/%d cyl x %.2f"
               " = %.6g kg/s" % (info["ve"], rho_eng, info["Vd"] * 1e6, info["rpm"], 2 if info["strokes"] == 4 else 1,
                                 info["cylinders_fed"], info["cylinders"], info["flow_factor"], mdot))
        if d.get("mode_kind") == "exhaust":
            mdot *= 1.0 + 1.0 / d["afr"]
            src += " of air; exhaust = air x (1 + 1/AFR %.1f) = %.6g kg/s" % (d["afr"], mdot)
    elif "pressure_ratio" in op:
        mode = "pressure_ratio"
        PR = float(op["pressure_ratio"])
        if PR <= 1.0:
            raise DesignError("pressure_ratio must be > 1 (p0_ambient / p_outlet)")
        der["PR"] = PR
        der["p_out"] = p0 / PR
        mdot = None
        src = "pressure_ratio p0/p_out = %.5g -> p_out = %.1f Pa" % (PR, p0 / PR)
    else:
        raise DesignError("operating_point needs mass_flow_kg_s, engine or pressure_ratio")
    der["mode"] = mode
    der["op_source"] = src
    if mode == "mass_flow":
        if mdot <= 0:
            raise DesignError("mass flow must be > 0")
        M_bulk = mach_from_mass_flux(mdot / Amin, p0, T0)
        der["mdot"] = mdot
    else:
        PR = der["PR"]
        M_bulk = math.sqrt(2.0 / (GAMMA - 1) * (PR ** ((GAMMA - 1) / GAMMA) - 1))   # ideal
        mdot = 0.85 * ideal_mass_flux(p0, T0, p0 / PR) * Amin   # estimate (Cd ~ 0.85)
        der["mdot_estimate"] = mdot
    T_s = T0 / (1 + 0.5 * (GAMMA - 1) * M_bulk ** 2)
    a_s = math.sqrt(GAMMA * R_AIR * T_s)
    U_bulk = M_bulk * a_s
    M_peak = min(0.99, M_bulk * peak_factor)
    der.update(M_bulk=M_bulk, U_bulk=U_bulk, M_peak=M_peak, U_peak=M_peak * a_s)
    # solver choice
    if d.get("mode_kind") == "exhaust":
        comp = True
        why = "exhaust mode: hot gas with a temperature field, always compressible"
    elif d["solver_force"]:
        comp = d["solver_force"] == "compressible"
        why = "forced by design['solver']['force']"
    else:
        comp = M_peak >= MACH_COMPRESSIBLE
        why = ("estimated peak Mach %.3f %s %.2f (density change ~M^2/2 = %.1f %%)" %
               (M_peak, ">=" if comp else "<", MACH_COMPRESSIBLE, 50 * M_peak ** 2))
    der["compressible"] = comp
    der["solver"] = "rhoSimpleFoam" if comp else "simpleFoam"
    der["solver_why"] = why
    der["transonic"] = comp and M_peak >= MACH_TRANSONIC
    if M_peak >= 0.95:
        raise DesignError("estimated peak Mach %.2f: flow would choke; steady subsonic RANS case "
                          "generation refused" % M_peak)
    # Reynolds number, friction velocity, wall cell
    rho_s = p0 / (R_AIR * T0) * (T_s / T0) ** (1 / (GAMMA - 1))
    Re = rho_s * U_bulk * der["D_Re"] / mu_air(T_s)
    f = friction_factor_colebrook(Re)
    utau_bulk = U_bulk * math.sqrt(f / 8.0)
    utau_peak = der["U_peak"] * math.sqrt(f / 8.0)
    nu_s = mu_air(T_s) / rho_s
    der.update(Re=Re, f_colebrook=f, u_tau=utau_bulk, u_tau_peak=utau_peak, nu_s=nu_s, rho_s=rho_s)
    # wall-resolved (2-D) first cell height for y+ ~ 1 at the *peak* velocity
    der["h_wall_lowRe"] = 2.0 * 1.0 * nu_s / utau_peak
    # wall-function (3-D) first-layer height for y+ ~ 50 at bulk velocity
    der["h_wall_wf"] = 2.0 * 50.0 * nu_s / utau_bulk
    # inflow turbulence (quiet atmosphere by default): intensity 1 % of the
    # tract bulk velocity and nut/nu = 1; design['turbulence'] can override
    # (e.g. behind an air filter element)
    tu = d.get("turbulence_in") or {}
    Iin = float(tu.get("intensity", 0.01))
    vr = float(tu.get("viscosity_ratio", 1.0))
    k_in = 1.5 * (Iin * U_bulk) ** 2
    der["k_in"] = k_in
    der["omega_in"] = k_in / (vr * der["nu_amb"])
    der["I_in"], der["nut_ratio_in"] = Iin, vr
    return der


# --------------------------------------------------------------------------
# 2-D axisymmetric sector mesh (blockMesh): one cell thick in the
# circumferential direction, the two sides a rotational cyclic pair
# --------------------------------------------------------------------------
class Sector:
    def __init__(self, half_angle_deg=SECTOR_HALF_ANGLE_DEG):
        self.th = math.radians(half_angle_deg)
        self.pts = []
        self.ids = {}
        self.xr = {}
        self.blocks = []
        self.edges = []
        self.edge_keys = set()
        self.curve_pts = {}
        self.patches = {}
        self.patch_types = {}

    def point(self, name, x, r):
        self.xr[name] = (x, r)
        if r < 1e-12:
            i = len(self.pts)
            self.pts.append((x, 0.0, 0.0))
            self.ids[name] = (i, i)
        else:
            i = len(self.pts)
            c, s = math.cos(self.th), math.sin(self.th)
            self.pts.append((x, r * c, -r * s))
            self.pts.append((x, r * c, r * s))
            self.ids[name] = (i, i + 1)

    def curve(self, a, b, inner_xr):
        """polyLine edge between named vertices a and b through inner points."""
        if not inner_xr:
            return
        key = (a, b)
        if key in self.edge_keys or (b, a) in self.edge_keys:
            return
        self.edge_keys.add(key)
        self.curve_pts[key] = list(inner_xr)
        c, s = math.cos(self.th), math.sin(self.th)
        fa, ba = self.ids[a]
        fb, bb = self.ids[b]
        front = [(x, r * c, -r * s) for (x, r) in inner_xr]
        back = [(x, r * c, r * s) for (x, r) in inner_xr]
        self.edges.append((fa, fb, front))
        if ba != fa or bb != fb:
            self.edges.append((ba, bb, back))

    def _edge_pts(self, a, b):
        pa, pb = self.xr[a], self.xr[b]
        if (a, b) in self.curve_pts:
            mid = self.curve_pts[(a, b)]
        elif (b, a) in self.curve_pts:
            mid = list(reversed(self.curve_pts[(b, a)]))
        else:
            mid = []
        return [pa] + mid + [pb]

    def block(self, name, a, b, c, d, bottom, top, left, right):
        """Quad a-b-c-d; x1 = a->b, x2 = a->d.  bottom: a->b, top: d->c,
        left: a->d, right: b->c (Dist objects).  If the quad is clockwise in
        (x, r) it is re-ordered (b, a, d, c) so blockMesh sees a right-handed
        block."""
        assert bottom.n == top.n and left.n == right.n, name
        poly = self._edge_pts(a, b)[:-1] + self._edge_pts(b, c)[:-1] + \
            self._edge_pts(c, d)[:-1] + self._edge_pts(d, a)[:-1]
        area = 0.0
        for i in range(len(poly)):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % len(poly)]
            area += x1 * y2 - x2 * y1
        if area < 0:
            a, b, c, d = b, a, d, c
            bottom, top, left, right = bottom.rev(), top.rev(), right, left
        self.blocks.append((name, (a, b, c, d), bottom, top, left, right))

    def face(self, patch, a, b, ptype="patch"):
        fa, ba = self.ids[a]
        fb, bb = self.ids[b]
        self.patches.setdefault(patch, []).append((fa, fb, bb, ba))
        self.patch_types[patch] = ptype

    def ncells(self):
        return sum(bl[2].n * bl[4].n for bl in self.blocks)

    def write(self):
        L = ["scale 1;", "", "mergeType points;   // sector: merge the collapsed points on the axis", "", "vertices", "("]
        for i, p in enumerate(self.pts):
            L.append("    %s  // %d" % (_vec(p), i))
        L += [");", "", "blocks", "("]
        front_faces, back_faces = [], []
        for (name, (a, b, c, d), bot, top, left, right) in self.blocks:
            fa, ba = self.ids[a]
            fb, bb = self.ids[b]
            fc, bc = self.ids[c]
            fd, bd = self.ids[d]
            gr = [bot.foam(), top.foam(), top.foam(), bot.foam(),
                  left.foam(), right.foam(), right.foam(), left.foam(), "1", "1", "1", "1"]
            L.append("    // %s" % name)
            L.append("    hex (%d %d %d %d %d %d %d %d) (%d %d 1)" % (fa, fb, fc, fd, ba, bb, bc, bd, bot.n, left.n))
            L.append("    edgeGrading (%s)" % " ".join(gr))
            front_faces.append((fa, fb, fc, fd))
            back_faces.append((ba, bb, bc, bd))
        L += [");", "", "edges", "("]
        for (i, j, pts) in self.edges:
            L.append("    polyLine %d %d" % (i, j))
            L.append("    (")
            for p in pts:
                L.append("        %s" % _vec(p))
            L.append("    )")
        L += [");", "", "boundary", "("]
        for patch, faces in self.patches.items():
            L.append("    %s" % patch)
            L.append("    {")
            L.append("        type %s;" % self.patch_types[patch])
            if self.patch_types[patch] == "wall":
                L.append("        inGroups (wall);")
            L.append("        faces")
            L.append("        (")
            for f in faces:
                L.append("            (%d %d %d %d)" % f)
            L.append("        );")
            L.append("    }")
        for nm, other, faces in (("front", "back", front_faces), ("back", "front", back_faces)):
            L.append("    %s" % nm)
            L.append("    {")
            L.append("        type cyclic;")
            L.append("        neighbourPatch %s;" % other)
            L.append("        transform rotational;")
            L.append("        rotationAxis (1 0 0);")
            L.append("        rotationCentre (0 0 0);")
            L.append("        faces")
            L.append("        (")
            for f in faces:
                L.append("            (%d %d %d %d)" % (f[0], f[3], f[2], f[1]) if nm == "front" else
                         "            (%d %d %d %d)" % f)
            L.append("        );")
            L.append("    }")
        L += [");"]
        return "\n".join(L)


def _bezier(P0, P1, P2, n):
    out = []
    for i in range(1, n):
        t = i / n
        out.append(((1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0],
                    (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]))
    return out


def _cumlen(pts):
    out = [0.0]
    for i in range(len(pts) - 1):
        out.append(out[-1] + math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]))
    return out


def _u_at(cum, s):
    """fractional polyline index at arc length s"""
    if s <= 0:
        return 0.0
    if s >= cum[-1]:
        return float(len(cum) - 1)
    lo, hi = 0, len(cum) - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if cum[mid] <= s:
            lo = mid
        else:
            hi = mid
    seg = cum[hi] - cum[lo]
    return lo + (0.0 if seg <= 0 else (s - cum[lo]) / seg)


def _s_at(cum, u):
    i = min(int(math.floor(u)), len(cum) - 2)
    return cum[i] + (u - i) * (cum[i + 1] - cum[i])


def _offset(poly, delta, side):
    """Offset an (x, r) polyline by delta to its 'left' or 'right' side."""
    out = []
    n = len(poly)
    for i in range(n):
        p0 = poly[max(i - 1, 0)]
        p1 = poly[min(i + 1, n - 1)]
        tx, tr = p1[0] - p0[0], p1[1] - p0[1]
        tl = math.hypot(tx, tr)
        tx, tr = tx / tl, tr / tl
        nx, nr = (-tr, tx) if side == "left" else (tr, -tx)
        out.append((poly[i][0] + delta * nx, poly[i][1] + delta * nr))
    return out


def _sizes_two_sided(L, ha, hb, q, hmax, nmin=2):
    """Cell sizes along length L: geometric growth (ratio q) from ha at the
    start and from hb at the end, capped at hmax, scaled to sum to L."""
    n = nmin
    while True:
        sz = [min(ha * q ** i, hb * q ** (n - 1 - i), hmax) for i in range(n)]
        if sum(sz) >= L or n > 20000:
            break
        n += 1
    f = L / sum(sz)
    return [x * f for x in sz]


def _fracs_from_sizes(sz):
    tot = sum(sz)
    c = [0.0]
    for x in sz:
        c.append(c[-1] + x / tot)
    c[-1] = 1.0
    return c


def dist_from_fracs(fr):
    """One-cell-per-section multi-grading: places every point exactly."""
    n = len(fr) - 1
    return Dist(n, [(fr[i + 1] - fr[i], 1.0 / n, 1.0) for i in range(n)])


def _mapped_pair(wall, off, sizes_on_off):
    """Distribute cells along the offset curve with the given sizes and map
    the same points (same polyline parameter = wall-normal correspondence)
    onto the wall curve.  Returns (wall Dist, offset Dist)."""
    cw_, co_ = _cumlen(wall), _cumlen(off)
    fo = _fracs_from_sizes(sizes_on_off)
    fw = [0.0]
    for f in fo[1:-1]:
        u = _u_at(co_, f * co_[-1])
        fw.append(_s_at(cw_, u) / cw_[-1])
    fw.append(1.0)
    # guard against non-monotonic mapping on degenerate wall segments
    for i in range(1, len(fw)):
        if fw[i] <= fw[i - 1]:
            fw[i] = fw[i - 1] + 1e-9
    fw = [x / fw[-1] for x in fw]
    return dist_from_fracs(fw), dist_from_fracs(fo)


def build_axisym_mesh(d, der):
    """Body-fitted multi-block axisymmetric sector mesh.

    Topology (meridional x-r plane):
      * a wall layer (C-grid) of thickness delta follows every wall of the
        inlet piece and the tube, with grid lines exactly wall-normal and
        y+ ~ 1 grading;
      * core blocks fill the tube; an atmosphere region (spherical dome for
        a free-standing inlet, box for a flange-mounted one) surrounds the
        mouth;  block corners with non-90-degree angles only occur on the
        layer's outer edge, never on a wall.
    Returns (Sector, info dict)."""
    g = d["geometry"]
    prof = g["profile"]
    lv = dict(MESH_LEVELS[d["mesh_level"]])
    for k in list(lv):
        if k in d["mesh_overrides"]:
            lv[k] = float(d["mesh_overrides"][k])
    D = g["D"]
    R = D / 2.0
    hw = min(der["h_wall_lowRe"], R / 50.0)
    stations = tract_stations(g, prof)
    free = g["mount"] == "free"
    delta = 0.15 * R
    W = Sector()
    inner = prof.inner
    iM = prof.iM
    M = inner[iM]
    T = inner[-1]
    # ---- wall-normal layer distribution (shared by all layer blocks)
    L_d = Dist.fine_start(delta, hw, lv["q_r"], 1e9)
    hL = L_d.sizes(delta)[-1]            # last layer cell = 'outer' size
    n_L = L_d.n
    # ---- wall curves and their offsets
    bell_w = inner[iM:]                                  # M -> T, fluid on the right
    bell_o = _offset(bell_w, delta, "right")
    Dm = 2.0 * prof.r_out
    Rff = max(15.0 * D, 8.0 * Dm)
    h_far = lv["far"] * Rff
    if free:
        P = g["protrusion"] if g["protrusion"] is not None else max(prof.length, D)
        O = prof.cap_free[-1]
        P = max(P, O[0] + max(0.1 * D, 2 * delta))
        g["protrusion_used"] = P
        cap_w = list(reversed(inner[:iM + 1])) + prof.cap_free[1:]   # M -> O, fluid on the left
    else:
        g["protrusion_used"] = 0.0
        Fr = inner[0]
        cap_w = list(reversed(inner[:iM + 1])) + [(0.0, Fr[1] + (Rff - Fr[1]) * i / 40) for i in range(1, 41)]
    cap_o = _offset(cap_w, delta, "left")
    Mo = bell_o[0]
    cap_o[0] = Mo                                         # identical offset point at M
    To = (T[0], T[1] - delta)
    bell_o[-1] = To
    if free:
        Oo = (O[0], O[1] + delta)
        cap_o[-1] = Oo
    else:
        Wp = cap_w[-1]
        Wo = (-delta, Rff)
        cap_o[-1] = Wo
    iF = iM                                               # front point F index in cap_w
    Fw, Fo = cap_w[iF], cap_o[iF]
    # ---- points
    W.point("M", *M)
    W.point("Mo", *Mo)
    W.point("F", *Fw)
    W.point("Fo", *Fo)
    W.point("T", *T)
    W.point("To", *To)
    W.point("A_M", Mo[0], 0.0)
    W.point("A_T", T[0], 0.0)
    if free:
        phi1, phiH = math.radians(30), math.radians(60)
        F0 = (-Rff, 0.0)
        F1 = (-Rff * math.cos(phi1), Rff * math.sin(phi1))
        H = (-Rff * math.cos(phiH), Rff * math.sin(phiH))
        G = (O[0], Rff)
        Bo, Bf, Boo = (P, prof.r_out), (P, Rff), (P, prof.r_out + delta)
        for nm, pnt in (("F0", F0), ("F1", F1), ("H", H), ("O", O), ("Oo", Oo), ("G", G), ("Bo", Bo),
                        ("Boo", Boo), ("Bf", Bf)):
            W.point(nm, *pnt)
        cap_end, cap_end_o = "O", "Oo"
    else:
        x0 = -Rff
        F0, F1, H, C = (x0, 0.0), (x0, 0.5 * Rff), (x0, 0.75 * Rff), (x0, Rff)
        for nm, pnt in (("F0", F0), ("F1", F1), ("H", H), ("C", C), ("Wp", Wp), ("Wo", Wo)):
            W.point(nm, *pnt)
        cap_end, cap_end_o = "Wp", "Wo"
    # ---- tangential distributions along the lip (mapped wall <-> offset),
    #      split at the front point F so no block wraps more than ~135 deg
    h_t = hL                                              # tangential size at M', F'
    h_bell = lv["bell"] * D
    h_capmax = max(h_bell, lv["out"] * D * 0.5)
    cap1_w, cap1_o = cap_w[:iF + 1], cap_o[:iF + 1]
    cap2_w, cap2_o = cap_w[iF:], cap_o[iF:]
    s1 = _sizes_two_sided(_poly_len(cap1_o), h_t, h_t, lv["q_cap"], h_capmax, nmin=4)
    if free:
        s2 = _sizes_two_sided(_poly_len(cap2_o), h_t, h_t, lv["q_cap"], h_capmax, nmin=4)
    else:
        hfl = min(h_far, 0.5 * D)
        s2 = _sizes_two_sided(_poly_len(cap2_o), h_t, hfl, lv["q_cap"], hfl, nmin=4)
    cap1_dw, cap1_do = _mapped_pair(cap1_w, cap1_o, s1)
    cap2_dw, cap2_do = _mapped_pair(cap2_w, cap2_o, s2)
    h_entry = lv["entry"] * D
    Lbo = _poly_len(bell_o)
    bell_sizes = _sizes_two_sided(Lbo, h_t, max(h_t, h_entry), lv["q_cap"], h_bell, nmin=4)
    bell_dw, bell_do = _mapped_pair(bell_w, bell_o, bell_sizes)
    W.curve("M", "F", cap1_w[1:-1])
    W.curve("Mo", "Fo", cap1_o[1:-1])
    W.curve("F", cap_end, cap2_w[1:-1])
    W.curve("Fo", cap_end_o, cap2_o[1:-1])
    W.curve("M", "T", bell_w[1:-1])
    W.curve("Mo", "To", bell_o[1:-1])
    # ---- core radial and 'up' distributions
    core_ref = Dist.fine_start(R - delta, hL, lv["q_r"], lv["core"] * R)
    n_c = core_ref.n

    def core_radial(Lr):
        return Dist.fixed_n(Lr, n_c, hL, lv["q_r"]).rev()   # fine at the layer edge (end)

    def leave_horiz(Pa, Pb):
        dd = math.hypot(Pb[0] - Pa[0], Pb[1] - Pa[1])
        return _bezier(Pa, (Pa[0] - 0.4 * dd, Pa[1]), Pb, 60)
    curve = leave_horiz(Mo, F1)
    W.curve("F1", "Mo", list(reversed(curve)))
    Lcurve = _poly_len([Mo] + curve + [F1])
    curveH = leave_horiz(Fo, H)
    W.curve("H", "Fo", list(reversed(curveH)))
    LcurveH = _poly_len([Fo] + curveH + [H])
    up_ref = Dist.fine_start(max(Lcurve, LcurveH), hL, lv["q_up"], h_far)
    n_up = up_ref.n

    def up_to(Lu):            # n_up cells, fine at the END
        return Dist.fixed_n(Lu, n_up, hL, lv["q_up"]).rev()
    # ---- layer blocks
    W.block("layer_cap1", "M", "F", "Fo", "Mo", bottom=cap1_dw, top=cap1_do, left=L_d, right=L_d)
    W.face("inlet_wall", "M", "F", "wall")
    W.block("layer_cap2", "F", cap_end, cap_end_o, "Fo", bottom=cap2_dw, top=cap2_do, left=L_d,
            right=L_d if free else Dist.uniform(n_L))
    W.face("inlet_wall", "F", cap_end, "wall")
    W.block("layer_bell", "M", "T", "To", "Mo", bottom=bell_dw, top=bell_do, left=L_d, right=L_d)
    W.face("inlet_wall", "M", "T", "wall")
    # ---- far core and bell core
    up_c = up_to(Lcurve)
    up_h = up_to(LcurveH)
    rad_M = core_radial(Mo[1])
    if free:
        dome = [(-Rff * math.cos(a_), Rff * math.sin(a_)) for a_ in [phi1 * i / 30 for i in range(1, 30)]]
        W.curve("F0", "F1", dome)
        domeFH = [(-Rff * math.cos(a_), Rff * math.sin(a_)) for a_ in
                  [phi1 + (phiH - phi1) * i / 30 for i in range(1, 30)]]
        W.curve("F1", "H", domeFH)
    W.block("far_core", "F0", "A_M", "Mo", "F1", bottom=up_c, top=up_c, left=rad_M, right=rad_M)
    W.face("atmosphere", "F0", "F1")
    W.block("bell_core", "A_M", "A_T", "To", "Mo", bottom=bell_do, top=bell_do,
            left=rad_M, right=core_radial(To[1]))
    W.block("front_a", "F1", "Mo", "Fo", "H", bottom=up_c, top=up_h, left=cap1_do, right=cap1_do)
    W.face("atmosphere", "F1", "H")
    # ---- front_b / around
    if free:
        arc = [(-Rff * math.cos(a_), Rff * math.sin(a_)) for a_ in
               [phiH + (math.pi / 2 - phiH) * i / 30 for i in range(1, 31)]]
        W.curve("H", "G", arc[:-1] + ([(0.0, Rff)] if G[0] > 1e-12 else []))
        L_GO = Rff - Oo[1]
        W.block("front_b", "H", "Fo", "Oo", "G", bottom=up_h, top=up_to(L_GO), left=cap2_do, right=cap2_do)
        W.face("atmosphere", "H", "G")
        n_out = max(4, int(math.ceil((P - O[0]) / (lv["out"] * D))))
        up_out = Dist.fixed_n(L_GO, n_up, hL, lv["q_up"])
        W.block("layer_out", "O", "Bo", "Boo", "Oo", bottom=Dist.uniform(n_out), top=Dist.uniform(n_out),
                left=L_d, right=L_d)
        W.face("inlet_wall", "O", "Bo", "wall")
        W.face("plenum_wall", "Bo", "Boo", "wall")
        W.block("around", "Oo", "Boo", "Bf", "G", bottom=Dist.uniform(n_out), top=Dist.uniform(n_out),
                left=up_out, right=up_out)
        W.face("plenum_wall", "Boo", "Bf", "wall")
        W.face("atmosphere", "G", "Bf")
    else:
        W.block("front_b", "H", "Fo", "Wo", "C", bottom=up_h, top=up_h, left=cap2_do, right=cap2_do)
        W.face("atmosphere", "H", "C")
        W.face("atmosphere", "C", "Wo")
        W.face("atmosphere", "Wp", "Wo")
    # ---- tube segments (layer + core)
    h_prev = bell_sizes[-1] * (_poly_len(bell_w) / Lbo)
    h_prev = max(h_prev, bell_sizes[-1] * 0.5)
    prev_a, prev_w, prev_o = "A_T", "T", "To"
    for i in range(1, len(stations)):
        x0s, x1s = stations[i - 1][0], stations[i][0]
        a_, w_, o_ = "A%d" % i, "W%d" % i, "Wo%d" % i
        r1 = tube_radius(g, min(x1s, g["L"]))
        W.point(a_, x1s, 0.0)
        W.point(w_, x1s, r1)
        W.point(o_, x1s, r1 - delta)
        Ls = x1s - x0s
        in_ext = x0s >= g["L"] - 1e-12
        hmax = lv["tube"] * D * (1.5 if in_ext else 1.0)
        ax = Dist.fine_start(Ls, min(h_prev, hmax), lv["q_ax"], hmax, nmin=2)
        h_prev = ax.sizes(Ls)[-1]
        r0o = W.xr[prev_o][1]
        W.block("tube_core_%d" % i, prev_a, a_, o_, prev_o, bottom=ax, top=ax,
                left=core_radial(r0o), right=core_radial(r1 - delta))
        W.block("tube_layer_%d" % i, prev_w, w_, o_, prev_o, bottom=ax, top=ax, left=L_d, right=L_d)
        W.face("extension_wall" if in_ext else "tract_wall", prev_w, w_, "wall")
        prev_a, prev_w, prev_o = a_, w_, o_
    W.face("outlet", prev_a, prev_o)
    W.face("outlet", prev_o, prev_w)
    info = dict(n_r=n_L + n_c, n_layer=n_L, n_up=n_up, Rff=Rff, h_wall=hw, delta=delta, stations=stations,
                ncells=W.ncells(), protrusion=g["protrusion_used"], free=free, profile=prof.label,
                sector_deg=2 * SECTOR_HALF_ANGLE_DEG)
    return W, info


# --------------------------------------------------------------------------
# 3-D geometry: STL generation / reading, plenum, snappyHexMesh
# --------------------------------------------------------------------------
def read_stl(path, scale):
    """Return list of (region_name, [(p1,p2,p3), ...]) from ASCII or binary STL."""
    with open(path, "rb") as f:
        data = f.read()
    regions = []
    head = data[:256].lstrip().lower()
    is_ascii = head.startswith(b"solid") and b"facet" in data[:2048].lower()
    if is_ascii:
        name, tris, verts = "wall", [], []
        for raw in data.decode("latin-1").splitlines():
            ln = raw.strip()
            low = ln.lower()
            if low.startswith("solid"):
                name = ln[5:].strip().split()[0] if ln[5:].strip() else "wall"
                tris, verts = [], []
            elif low.startswith("vertex"):
                p = ln.split()[1:4]
                verts.append(tuple(float(c) * scale for c in p))
                if len(verts) == 3:
                    tris.append(tuple(verts))
                    verts = []
            elif low.startswith("endsolid"):
                regions.append((name, tris))
                tris = []
        if tris:
            regions.append((name, tris))
    else:
        n = struct.unpack("<I", data[80:84])[0]
        tris = []
        off = 84
        for _ in range(n):
            vals = struct.unpack("<12f", data[off:off + 48])
            off += 50
            tris.append(((vals[3] * scale, vals[4] * scale, vals[5] * scale),
                         (vals[6] * scale, vals[7] * scale, vals[8] * scale),
                         (vals[9] * scale, vals[10] * scale, vals[11] * scale)))
        regions.append(("wall", tris))
    return regions


def write_stl_ascii(path, regions):
    with open(path, "w", newline="\n") as f:
        for name, tris in regions:
            f.write("solid %s\n" % name)
            for (a, b, c) in tris:
                n = v_norm(v_cross(v_sub(b, a), v_sub(c, a)))
                f.write("  facet normal %.6e %.6e %.6e\n    outer loop\n" % n)
                for p in (a, b, c):
                    f.write("      vertex %.9e %.9e %.9e\n" % p)
                f.write("    endloop\n  endfacet\n")
            f.write("endsolid %s\n" % name)


def tri_area_vec(t):
    return v_mul(v_cross(v_sub(t[1], t[0]), v_sub(t[2], t[0])), 0.5)


def region_stats(tris):
    A = 0.0
    c = (0.0, 0.0, 0.0)
    nvec = (0.0, 0.0, 0.0)
    for t in tris:
        av = tri_area_vec(t)
        a = v_len(av)
        A += a
        c = v_add(c, v_mul(v_mul(v_add(v_add(t[0], t[1]), t[2]), 1.0 / 3.0), a))
        nvec = v_add(nvec, av)
    return A, v_mul(c, 1.0 / A) if A > 0 else c, v_norm(nvec)


def boundary_loop(tris, tol):
    """Ordered boundary loop (list of points) of a triangulated planar cap."""
    def key(p):
        return (round(p[0] / tol), round(p[1] / tol), round(p[2] / tol))
    pts = {}
    cnt = {}
    for t in tris:
        ks = [key(p) for p in t]
        for p, k in zip(t, ks):
            pts[k] = p
        for i in range(3):
            e = (ks[i], ks[(i + 1) % 3])
            ek = tuple(sorted(e))
            cnt[ek] = cnt.get(ek, 0) + 1
    bedges = [e for e, c in cnt.items() if c == 1]
    if not bedges:
        raise DesignError("inlet face has no boundary edges (is it a closed surface?)")
    adj = {}
    for a, b in bedges:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    start = bedges[0][0]
    loop = [start]
    prev, cur = None, start
    while True:
        nxt = [n for n in adj[cur] if n != prev]
        if not nxt:
            break
        prev, cur = cur, nxt[0]
        if cur == start:
            break
        loop.append(cur)
        if len(loop) > len(adj) + 1:
            break
    if len(loop) < len(adj):
        raise DesignError("inlet face boundary is not a single closed loop (%d of %d edge points)"
                          % (len(loop), len(adj)))
    return [pts[k] for k in loop]


class Path3D:
    """Centre-line made of straights and planar arcs, with a parallel-
    transported frame.  Starts at the origin heading +x."""

    def __init__(self):
        self.segs = []      # (kind, length, data)

    def straight(self, L):
        if L > 1e-12:
            self.segs.append(("line", L, None))

    def arc(self, radius, angle, plane):
        self.segs.append(("arc", radius * angle, (radius, angle, plane)))

    def total(self):
        return sum(s[1] for s in self.segs)

    def frame(self, s):
        """(point, tangent, normal1, normal2) at arc length s."""
        p = (0.0, 0.0, 0.0)
        t = (1.0, 0.0, 0.0)
        n1 = (0.0, 1.0, 0.0)
        n2 = (0.0, 0.0, 1.0)
        rem = s
        for kind, L, dat in self.segs:
            ds = min(rem, L)
            if kind == "line":
                p = v_add(p, v_mul(t, ds))
            else:
                radius, angle, plane = dat
                # bend toward direction k (n1 rotated by plane about t)
                k = rotate_about(n1, t, plane)
                axis = v_norm(v_cross(t, k))
                centre = v_add(p, v_mul(k, radius))
                ang = ds / radius
                rel = v_sub(p, centre)
                p = v_add(centre, rotate_about(rel, axis, ang))
                t = rotate_about(t, axis, ang)
                n1 = rotate_about(n1, axis, ang)
                n2 = rotate_about(n2, axis, ang)
            rem -= ds
            if rem <= 1e-15:
                break
        if rem > 1e-9:
            p = v_add(p, v_mul(t, rem))
        return p, t, n1, n2


def build_param_3d_surface(g, prof, nphi=64):
    """Triangulated tract (walls, outlet) for a parametric design with bends,
    in flange mount: the mouth lies in the plane x=0."""
    path = Path3D()
    bends = sorted(g["bends"], key=lambda b: b["s0"])
    s_cur = 0.0
    Lin = prof.length
    for b in bends:
        if b["s0"] < Lin - 1e-9:
            raise DesignError("bend must start after the inlet piece (s >= %.1f mm)" % (Lin * 1e3))
        path.straight(b["s0"] - s_cur)
        path.arc(b["clr"], b["angle"], b["plane"])
        s_cur = b["s0"] + b["clr"] * b["angle"]
    if s_cur > g["L"] + 1e-9:
        raise DesignError("bend ends beyond the tract end (tube_length_mm)")
    if g.get("dc"):
        dc = g["dc"]
        R, R2 = g["D"] / 2, dc["D2"] / 2
        Lc = abs(R2 - R) / math.tan(dc["beta"])
        for b in bends:
            e = b["s0"] + b["clr"] * b["angle"]
            if not (dc["x0"] + Lc <= b["s0"] or dc["x0"] >= e):
                raise DesignError("diameter change may not overlap a bend")
    Dout = 2 * tube_radius(g, g["L"])
    S_end = g["L"]
    S_out = g["L"] + g["ext_D"] * Dout
    path.straight(S_out - s_cur)
    # radius along s (inlet profile is in axial coordinate == s)
    prof_x = [p[0] for p in prof.inner]

    def rad(s):
        if s <= Lin:
            for i in range(len(prof_x) - 1):
                if prof_x[i] <= s <= prof_x[i + 1]:
                    x0, x1 = prof_x[i], prof_x[i + 1]
                    w = 0 if x1 == x0 else (s - x0) / (x1 - x0)
                    return prof.inner[i][1] * (1 - w) + prof.inner[i + 1][1] * w
            return prof.inner[-1][1]
        return tube_radius(g, min(s, S_end))
    # stations along s
    ss = set([p[0] for p in prof.inner if p[0] > 1e-12])
    ss.add(0.0)
    ds = g["D"] / 10.0
    s = Lin
    while s < S_out:
        ss.add(s)
        s += ds
    for b in bends:
        n = max(8, int(math.ceil(b["angle"] / math.radians(5))))
        for i in range(n + 1):
            ss.add(b["s0"] + b["clr"] * b["angle"] * i / n)
    ss.add(S_end)
    ss.add(S_out)
    svals = sorted(x for x in ss if x <= S_out + 1e-12)
    rings = []
    for s in svals:
        p, t, n1, n2 = path.frame(s)
        r = rad(s)
        ring = [v_add(p, v_add(v_mul(n1, r * math.cos(2 * math.pi * j / nphi)),
                               v_mul(n2, r * math.sin(2 * math.pi * j / nphi)))) for j in range(nphi)]
        rings.append((s, ring, p, t))
    wall, ext = [], []
    for k in range(len(rings) - 1):
        s0, A, _, _ = rings[k]
        _, B, _, _ = rings[k + 1]
        tgt = ext if s0 >= S_end - 1e-12 else wall
        for j in range(nphi):
            j1 = (j + 1) % nphi
            # outward normals (away from the axis)
            tgt.append((A[j], A[j1], B[j1]))
            tgt.append((A[j], B[j1], B[j]))
    s_last, ring_o, po, to = rings[-1]
    outlet = [(po, ring_o[(j + 1) % nphi], ring_o[j]) for j in range(nphi)]
    # flip outlet so the normal points out of the fluid (+t)
    outlet = [(a, c, b) if v_dot(tri_area_vec((a, b, c)), to) < 0 else (a, b, c) for (a, b, c) in outlet]
    mouth_ring = rings[0][1]
    mouth = [((0.0, 0.0, 0.0), mouth_ring[j], mouth_ring[(j + 1) % nphi]) for j in range(nphi)]
    return dict(wall=wall, ext=ext, outlet=outlet, mouth=mouth, mouth_loop=mouth_ring, path=path,
                S_end=S_end, S_out=S_out)


def floor_surface(loop, Rfloor, nseg=None):
    """Annulus in the plane x=0 between the (star-shaped) mouth loop and a
    circle of radius Rfloor.  Normals point +x (into the tract side)."""
    cy = sum(p[1] for p in loop) / len(loop)
    cz = sum(p[2] for p in loop) / len(loop)
    ang = [math.atan2(p[2] - cz, p[1] - cy) for p in loop]
    order = sorted(range(len(loop)), key=lambda i: ang[i])
    # check star-shapedness: polar order must equal loop order (cyclic, either way)
    pos = {i: k for k, i in enumerate(order)}
    steps = [(pos[(i + 1) % len(loop)] - pos[i]) % len(loop) for i in range(len(loop))]
    if not (all(s == 1 for s in steps) or all(s == len(loop) - 1 for s in steps)):
        raise DesignError("inlet mouth outline is not star-shaped about its centre; the plenum "
                          "floor cannot be generated automatically")
    inner = [loop[i] for i in order]
    outer = [(0.0, cy + Rfloor * math.cos(ang[i]), cz + Rfloor * math.sin(ang[i])) for i in order]
    tris = []
    n = len(inner)
    for j in range(n):
        j1 = (j + 1) % n
        a, b, c, e = inner[j], inner[j1], outer[j1], outer[j]
        for t in ((a, b, c), (a, c, e)):
            if tri_area_vec(t)[0] < 0:
                t = (t[0], t[2], t[1])
            tris.append(t)
    return tris


def _orient_stl_to_x(regions, inlet_name="inlet"):
    """Translate/rotate a user STL so the inlet face centre is at the origin
    and the inflow direction is +x.  Returns (regions, transform info)."""
    inl = [t for (nm, tris) in regions if nm.lower() == inlet_name for t in tris]
    if not inl:
        raise DesignError("STL has no solid named 'inlet' (the open intake mouth)")
    A, c, n = region_stats(inl)
    allpts = [p for (_, tris) in regions for t in tris for p in t]
    cen = v_mul(sum_pts(allpts), 1.0 / len(allpts))
    if v_dot(v_sub(cen, c), n) > 0:
        n = v_mul(n, -1.0)     # make n point out of the fluid (upstream)
    flow = v_mul(n, -1.0)       # inflow direction into the tract
    # rotation taking flow -> +x
    ex = (1.0, 0.0, 0.0)
    axis = v_cross(flow, ex)
    s = v_len(axis)
    cth = v_dot(flow, ex)
    if s < 1e-12:
        rot = (lambda p: p) if cth > 0 else (lambda p: (-p[0], -p[1], p[2]))
    else:
        axis = v_mul(axis, 1.0 / s)
        ang = math.atan2(s, cth)
        rot = lambda p: rotate_about(p, axis, ang)  # noqa: E731
    out = []
    for nm, tris in regions:
        out.append((nm, [tuple(rot(v_sub(p, c)) for p in t) for t in tris]))
    return out, dict(origin=c, flow_dir=flow, rot=rot, area=A)


def sum_pts(pts):
    x = y = z = 0.0
    for p in pts:
        x += p[0]
        y += p[1]
        z += p[2]
    return (x, y, z)


def prepare_stl_geometry(g):
    """Read the user STL(s), orient them, identify inlet/outlet/walls,
    build an outlet extension; fills g with Dref, Amin etc."""
    src = g["stl"]
    base = g["base_dir"]
    regions = []
    if isinstance(src, dict):
        for role, fn in src.items():
            fp = fn if os.path.isabs(fn) else os.path.join(base, fn)
            for nm, tris in read_stl(fp, g["scale"]):
                regions.append((role.lower(), tris))
    else:
        fp = src if os.path.isabs(src) else os.path.join(base, src)
        regions = [(nm.lower(), tris) for nm, tris in read_stl(fp, g["scale"])]
    names = set(nm for nm, _ in regions)
    if "inlet" not in names or "outlet" not in names:
        raise DesignError("STL must contain solids/files named 'inlet' and 'outlet' (found %s)"
                          % sorted(names))
    regions, tf = _orient_stl_to_x(regions)
    inlet = [t for nm, tris in regions if nm == "inlet" for t in tris]
    outlet = [t for nm, tris in regions if nm == "outlet" for t in tris]
    wall = [t for nm, tris in regions if nm not in ("inlet", "outlet") for t in tris]
    Ai, ci, ni = region_stats(inlet)
    Ao, co, no = region_stats(outlet)
    size = max(math.sqrt(Ai), math.sqrt(Ao))
    xs = [p[0] for t in inlet for p in t]
    if max(abs(x) for x in xs) > 0.01 * size:
        raise DesignError("inlet face is not planar (deviation %.3g m)" % max(abs(x) for x in xs))
    xmin = min(p[0] for t in wall + outlet for p in t)
    if xmin < -0.02 * size:
        raise DesignError("the tract passes upstream of its own inlet plane; the plenum would "
                          "intersect it")
    # outlet orientation: normal pointing out of the fluid
    allpts = [p for t in wall for p in t]
    cen = v_mul(sum_pts(allpts), 1.0 / len(allpts))
    if v_dot(v_sub(co, cen), no) < 0:
        no = v_mul(no, -1.0)
    Do = math.sqrt(4 * Ao / math.pi)
    Di = math.sqrt(4 * Ai / math.pi)
    # outlet extension: translate outlet loop along no
    loop_o = boundary_loop(outlet, tol=1e-6 * size)
    Lext = g["ext_D"] * Do
    ext = []
    shift = v_mul(no, Lext)
    nloop = len(loop_o)
    for j in range(nloop):
        a, b = loop_o[j], loop_o[(j + 1) % nloop]
        a2, b2 = v_add(a, shift), v_add(b, shift)
        for t in ((a, b, b2), (a, b2, a2)):
            ext.append(t)
    new_out = [tuple(v_add(p, shift) for p in t) for t in outlet]
    # orient extension triangles outward (away from the outlet centroid axis)
    fixed = []
    for t in ext:
        cc = v_mul(v_add(v_add(t[0], t[1]), t[2]), 1 / 3.0)
        radial = v_sub(cc, v_add(co, v_mul(no, v_dot(v_sub(cc, co), no))))
        if v_dot(tri_area_vec(t), radial) < 0:
            t = (t[0], t[2], t[1])
        fixed.append(t)
    g["tris"] = dict(wall=wall, ext=fixed, outlet=new_out, mouth=inlet)
    g["mouth_loop"] = boundary_loop(inlet, tol=1e-6 * size)
    g["Dref"] = Do
    g["Amin"] = min(Ai, Ao)
    g["D_mouth"] = Di
    g["tract_end"] = (co, no, Ao)
    g["transform"] = tf
    allp = [p for t in wall + fixed + new_out for p in t]
    g["bbox"] = ([min(p[i] for p in allp) for i in range(3)], [max(p[i] for p in allp) for i in range(3)])
    # planes from CAD coordinates -> local frame
    pl = {}
    for nm, (pt, nn) in g["planes3d"].items():
        pl[nm] = (tf["rot"](v_sub(pt, tf["origin"])), v_norm(tf["rot"](nn)))
    g["planes_local"] = pl


def _extrude_face(tris, co, no, L):
    """Extrude a planar cap (triangles) along its outward normal no by L.
    Returns (side wall triangles, oriented outward; the translated cap)."""
    size = math.sqrt(sum(v_len(tri_area_vec(t)) for t in tris))
    loop = boundary_loop(tris, tol=1e-6 * size)
    shift = v_mul(no, L)
    ext = []
    nloop = len(loop)
    for j in range(nloop):
        a, b = loop[j], loop[(j + 1) % nloop]
        a2, b2 = v_add(a, shift), v_add(b, shift)
        for t in ((a, b, b2), (a, b2, a2)):
            cc = v_mul(v_add(v_add(t[0], t[1]), t[2]), 1 / 3.0)
            radial = v_sub(cc, v_add(co, v_mul(no, v_dot(v_sub(cc, co), no))))
            if v_dot(tri_area_vec(t), radial) < 0:
                t = (t[0], t[2], t[1])
            ext.append(t)
    cap = [tuple(v_add(p, shift) for p in t) for t in tris]
    return ext, cap


def prepare_exhaust_geometry(g):
    """Exhaust component from CAD: solids named inlet (or inlet1..N) and outlet,
    everything else wall.  No plenum: each inlet face is extruded upstream by
    inlet_extension_D x its diameter (a uniform-velocity inlet is imposed
    there), the outlet face downstream by outlet_extension_D.  The original
    inlet and outlet faces become the measurement planes.  Coordinates are
    kept as in the CAD file (metres after scaling)."""
    src = g["stl"]
    base = g["base_dir"]
    regions = []
    if isinstance(src, dict):
        for role, fn in src.items():
            fp = fn if os.path.isabs(fn) else os.path.join(base, fn)
            for nm, tris in read_stl(fp, g["scale"]):
                regions.append((role.lower(), tris))
    else:
        fp = src if os.path.isabs(src) else os.path.join(base, src)
        regions = [(nm.lower(), tris) for nm, tris in read_stl(fp, g["scale"])]
    names = [nm for nm, _ in regions]
    inlet_names = sorted(set(nm for nm in names if nm == "inlet" or (nm.startswith("inlet") and nm[5:].isdigit())),
                         key=lambda s: (len(s), s))
    if not inlet_names or "outlet" not in names:
        raise DesignError("exhaust STL must contain solids/files named inlet (or inlet1, inlet2, ...) and outlet (found %s)"
                          % sorted(set(names)))
    wall = [t for nm, tris in regions if nm not in inlet_names and nm != "outlet" for t in tris]
    outlet = [t for nm, tris in regions if nm == "outlet" for t in tris]
    if not wall:
        raise DesignError("exhaust STL has no wall faces")
    allpts = [p for t in wall for p in t]
    cen = v_mul(sum_pts(allpts), 1.0 / len(allpts))
    Ao, co, no = region_stats(outlet)
    if v_dot(v_sub(co, cen), no) < 0:
        no = v_mul(no, -1.0)          # outward
    Do = math.sqrt(4 * Ao / math.pi)
    inlets = []
    for nm in inlet_names:
        tris = [t for n2, tr in regions if n2 == nm for t in tr]
        Ai, ci, ni = region_stats(tris)
        if v_dot(v_sub(ci, cen), ni) < 0:
            ni = v_mul(ni, -1.0)      # outward (upstream)
        xs = [v_dot(v_sub(p, ci), ni) for t in tris for p in t]
        Di = math.sqrt(4 * Ai / math.pi)
        if max(abs(x) for x in xs) > 0.02 * Di:
            raise DesignError("inlet face '%s' is not planar (deviation %.3g m)" % (nm, max(abs(x) for x in xs)))
        ext, cap = _extrude_face(tris, ci, ni, g["ext_in_D"] * Di)
        inlets.append(dict(name=nm, A=Ai, D=Di, centre=ci, normal=ni, tris=tris, ext=ext, cap=cap,
                           inlet_point=v_add(ci, v_mul(ni, g["ext_in_D"] * Di))))
    ext_o, cap_o = _extrude_face(outlet, co, no, g["ext_D"] * Do)
    g["inlets"] = inlets
    g["tris"] = dict(wall=wall, ext=ext_o, outlet=cap_o, inlet_ext=[t for i in inlets for t in i["ext"]],
                     inlet_caps={i["name"]: i["cap"] for i in inlets}, exit=outlet)
    g["Dref"] = Do
    g["A_in_total"] = sum(i["A"] for i in inlets)
    g["Amin"] = min(g["A_in_total"], Ao)
    g["D_mouth"] = max(i["D"] for i in inlets)
    g["exit_face"] = (co, no, Ao)
    g["loc_in_mesh"] = v_add(co, v_mul(no, 0.5 * g["ext_D"] * Do))     # inside the straight outlet extension
    allp = [p for t in wall + ext_o + cap_o + g["tris"]["inlet_ext"] for p in t]
    g["bbox"] = ([min(p[i] for p in allp) for i in range(3)], [max(p[i] for p in allp) for i in range(3)])
    # measurement planes: the original inlet faces, the original outlet face ('exit'), user planes
    pl = {}
    for i in inlets:
        pl[i["name"]] = (i["centre"], v_mul(i["normal"], -1.0), i["A"], 0.5 * i["D"])
    pl["exit"] = (co, no, Ao, 0.5 * Do)
    for nm, (pt, nn) in g["planes3d"].items():
        pl[nm] = (pt, nn, None, 0.75 * Do)
    g["planes_exhaust"] = pl
    # mass-flow split between the inlets (equal shares, 1/n each, unless operating_point.inlet_split is given)
    sp = g.get("inlet_split")
    if sp:
        missing = [i["name"] for i in inlets if i["name"] not in sp]
        if missing:
            raise DesignError("operating_point.inlet_split must name every inlet; missing %s" % missing)
        tot = sum(sp[i["name"]] for i in inlets)
        g["split"] = {i["name"]: sp[i["name"]] / tot for i in inlets}
    else:
        n = len(inlets)
        g["split"] = {i["name"]: 1.0 / n for i in inlets}


def prepare_param3d_geometry(g):
    prof = g["profile"]
    surf = build_param_3d_surface(g, prof)
    g["tris"] = dict(wall=surf["wall"], ext=surf["ext"], outlet=surf["outlet"], mouth=surf["mouth"])
    g["mouth_loop"] = surf["mouth_loop"]
    path = surf["path"]
    pe, te, _, _ = path.frame(surf["S_end"])
    Rend = tube_radius(g, g["L"])
    g["tract_end"] = (pe, te, math.pi * Rend ** 2)
    g["Dref"] = g["D"]
    g["D_mouth"] = 2 * prof.front_r
    allp = [p for k in ("wall", "ext", "outlet") for t in g["tris"][k] for p in t]
    g["bbox"] = ([min(p[i] for p in allp) for i in range(3)], [max(p[i] for p in allp) for i in range(3)])
    pl = {}
    for nm, s in g["planes"].items():
        p, t, _, _ = path.frame(s)
        pl[nm] = (p, t)
    g["planes_local"] = pl
    g["path"] = path


# --------------------------------------------------------------------------
# OpenFOAM dictionaries
# --------------------------------------------------------------------------
def _bc_block(entries):
    out = []
    for patch, body in entries:
        out.append("    %s\n    {\n%s\n    }" % (patch, "\n".join("        " + ln for ln in body.strip().split("\n"))))
    return "\n".join(out)


def field_files(cw, d, der, patches):
    """Write 0/ fields. patches: dict name -> role in {'atmosphere','outlet',
    'wall','cyclic'}."""
    comp = der["compressible"]
    p0, T0 = der["p_amb"], der["T_amb"]
    k_in, om_in = der["k_in"], der["omega_in"]
    mdot = der.get("mdot")
    rho = der["rho_amb"]
    prov_common = [
        "ambient.p_pa = %.1f Pa, ambient T = %.2f K -> atmosphere total pressure / total temperature" % (p0, T0),
        "operating point: %s" % der["op_source"],
        "inflow turbulence: I = %.3g %% of tract bulk velocity %.2f m/s -> k = %.4g m2/s2; nut/nu = %.3g -> omega = %.4g 1/s"
        % (100 * der["I_in"], der["U_bulk"], k_in, der["nut_ratio_in"], om_in),
    ]

    def make(name, cls, dims, internal, rules, extra_prov):
        ents = []
        for pn, role in patches.items():
            if role == "cyclic":
                ents.append((pn, "type cyclic;"))
            else:
                rule = rules[role]
                ents.append((pn, rule(pn) if callable(rule) else rule))
        body = "dimensions      %s;\n\ninternalField   %s;\n\nboundaryField\n{\n%s\n}\n" % (
            dims, internal, _bc_block(ents))
        cw.foam("0/%s" % name, cls, name, body, prov_common + extra_prov, location="0")

    # ---- U
    ramp = RAMP_ITER
    if der["mode"] == "mass_flow":
        fs = der.get("flow_scale", 1.0)
        if comp:
            out_U = ("type            flowRateOutletVelocity;\nmassFlowRate    table ((0 0) (%d %.9g));\n"
                     "rho             rho;\nvalue           uniform (0 0 0);" % (ramp, mdot / fs))
        else:
            out_U = ("type            flowRateOutletVelocity;\nvolumetricFlowRate table ((0 0) (%d %.9g));\n"
                     "value           uniform (0 0 0);" % (ramp, mdot / rho / fs))
        out_p = "type            zeroGradient;"
        prov_out = ["outlet: imposed mass flow %.6g kg/s%s (flowRateOutletVelocity), ramped linearly from 0 over "
                    "the first %d iterations for a smooth start; pressure zeroGradient"
                    % (mdot, " (x 1/%.6g for the 2-D sector)" % fs if fs != 1 else "", ramp)]
    else:
        out_U = "type            pressureInletOutletVelocity;\nvalue           uniform (0 0 0);"
        pout = der["p_out"] if comp else (der["p_out"] - p0) / rho
        pstart = p0 if comp else 0.0
        out_p = ("type            uniformFixedValue;\nuniformValue    table ((0 %.9g) (%d %.9g));\n"
                 "value           uniform %.9g;" % (pstart, ramp, pout, pstart))
        prov_out = ["outlet: static pressure p0/PR = %.2f Pa (%s), ramped from ambient over the first %d iterations"
                    % (der["p_out"], "absolute" if comp else "kinematic gauge %.6g m2/s2" % pout, ramp)]
    exh = d.get("mode_kind") == "exhaust"
    if exh:
        # inlets: mass flow per inlet (ramped), hot gas at T_gas; outlet: static pressure = ambient
        split = d["geometry"]["split"]
        Tg = d["T_gas"]
        k_x = 1.5 * (0.05 * der["U_bulk"]) ** 2                       # 5 % intensity, nut/nu = 10 at the inlets
        om_x = k_x / (10.0 * der["nu_amb"])
        der["k_in"], der["omega_in"] = k_x, om_x
        k_in, om_in = k_x, om_x

        def in_U(pn):
            return ("type            flowRateInletVelocity;\nmassFlowRate    table ((0 0) (%d %.9g));\n"
                    "rho             rho;\nextrapolateProfile no;\nvalue           uniform (0 0 0);" % (ramp, mdot * split[pn]))
        out_U = "type            inletOutlet;\ninletValue      uniform (0 0 0);\nvalue           uniform (0 0 0);"
        out_p = "type            fixedValue;\nvalue           uniform %.9g;" % p0
        prov_out = ["inlets: imposed mass flow %.6g kg/s in total, split %s (flowRateInletVelocity, ramped over %d iterations); gas at %.1f K"
                    % (mdot, ", ".join("%s %.3f" % (k, v) for k, v in split.items()), ramp, Tg),
                    "outlet: static pressure = ambient %.1f Pa after the outlet extension" % p0,
                    ]
        prov_common[2] = "inlet turbulence: 5 %% intensity, nut/nu = 10 (turbulent flow from the ports) -> k = %.4g, omega = %.4g" % (k_x, om_x)
        make("U", "volVectorField", "[0 1 -1 0 0 0 0]", "uniform (0 0 0)", {
            "exh_inlet": in_U, "exh_outlet": out_U, "wall": "type            noSlip;"}, prov_out)
        make("p", "volScalarField", "[1 -1 -2 0 0 0 0]", "uniform %.9g" % p0, {
            "exh_inlet": "type            zeroGradient;", "exh_outlet": out_p, "wall": "type            zeroGradient;"},
            prov_out + ["p is absolute static pressure [Pa]"])
        make("T", "volScalarField", "[0 0 0 1 0 0 0]", "uniform %.9g" % Tg, {
            "exh_inlet": "type            fixedValue;\nvalue           uniform %.9g;" % Tg,
            "exh_outlet": "type            inletOutlet;\ninletValue      uniform %.9g;\nvalue           uniform %.9g;" % (Tg, Tg),
            "wall": "type            zeroGradient;   // adiabatic walls"}, ["gas temperature %.1f K at the inlets (design['gas'])" % Tg])
        make("alphat", "volScalarField", "[1 -1 -1 0 0 0 0]", "uniform 0", {
            "exh_inlet": "type            calculated;\nvalue           uniform 0;",
            "exh_outlet": "type            calculated;\nvalue           uniform 0;",
            "wall": "type            compressible::alphatWallFunction;\nPrt             %.3g;\nvalue           uniform 0;" % PR_T},
            ["turbulent Prandtl number Prt = %.2f" % PR_T])
        make("k", "volScalarField", "[0 2 -2 0 0 0 0]", "uniform %.6g" % k_in, {
            "exh_inlet": "type            fixedValue;\nvalue           uniform %.6g;" % k_in,
            "exh_outlet": "type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;" % (k_in, k_in),
            "wall": "type            kqRWallFunction;\nvalue           uniform %.6g;" % k_in}, [])
        make("omega", "volScalarField", "[0 0 -1 0 0 0 0]", "uniform %.6g" % om_in, {
            "exh_inlet": "type            fixedValue;\nvalue           uniform %.6g;" % om_in,
            "exh_outlet": "type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;" % (om_in, om_in),
            "wall": "type            omegaWallFunction;\nvalue           uniform %.6g;" % om_in}, [])
        make("nut", "volScalarField", "[0 2 -1 0 0 0 0]", "uniform 0", {
            "exh_inlet": "type            calculated;\nvalue           uniform 0;",
            "exh_outlet": "type            calculated;\nvalue           uniform 0;",
            "wall": "type            nutUSpaldingWallFunction;\nvalue           uniform 0;"},
            ["walls: nutUSpaldingWallFunction (valid from y+~1 to the log layer)"])
        return
    make("U", "volVectorField", "[0 1 -1 0 0 0 0]", "uniform (0 0 0)", {
        "atmosphere": "type            pressureInletOutletVelocity;\nvalue           uniform (0 0 0);",
        "outlet": out_U,
        "wall": "type            noSlip;",
    }, prov_out)
    # ---- p
    if comp:
        atm_p = ("type            totalPressure;\np0              uniform %.9g;\nvalue           uniform %.9g;"
                 % (p0, p0))
        make("p", "volScalarField", "[1 -1 -2 0 0 0 0]", "uniform %.9g" % p0, {
            "atmosphere": atm_p, "outlet": out_p, "wall": "type            zeroGradient;"},
            prov_out + ["p is absolute static pressure [Pa]"])
        make("T", "volScalarField", "[0 0 0 1 0 0 0]", "uniform %.9g" % T0, {
            "atmosphere": "type            totalTemperature;\nT0              uniform %.9g;\ngamma           %.6g;\nvalue           uniform %.9g;" % (T0, GAMMA, T0),
            "outlet": "type            inletOutlet;\ninletValue      uniform %.9g;\nvalue           uniform %.9g;" % (T0, T0),
            "wall": "type            zeroGradient;   // adiabatic walls"}, [])
        make("alphat", "volScalarField", "[1 -1 -1 0 0 0 0]", "uniform 0", {
            "atmosphere": "type            calculated;\nvalue           uniform 0;",
            "outlet": "type            calculated;\nvalue           uniform 0;",
            "wall": "type            compressible::alphatWallFunction;\nPrt             %.3g;\nvalue           uniform 0;" % PR_T},
            ["turbulent Prandtl number Prt = %.2f" % PR_T])
    else:
        atm_p = "type            totalPressure;\np0              uniform 0;\nvalue           uniform 0;"
        make("p", "volScalarField", "[0 2 -2 0 0 0 0]", "uniform 0", {
            "atmosphere": atm_p, "outlet": out_p, "wall": "type            zeroGradient;"},
            prov_out + ["p is kinematic gauge pressure (p - p_amb)/rho [m2/s2], rho = %.5g kg/m3" % rho])
    make("k", "volScalarField", "[0 2 -2 0 0 0 0]", "uniform %.6g" % k_in, {
        "atmosphere": "type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;" % (k_in, k_in),
        "outlet": "type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;" % (k_in, k_in),
        "wall": "type            kqRWallFunction;\nvalue           uniform %.6g;" % k_in}, [])
    make("omega", "volScalarField", "[0 0 -1 0 0 0 0]", "uniform %.6g" % om_in, {
        "atmosphere": "type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;" % (om_in, om_in),
        "outlet": "type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;" % (om_in, om_in),
        "wall": "type            omegaWallFunction;\nvalue           uniform %.6g;" % om_in}, [])
    make("nut", "volScalarField", "[0 2 -1 0 0 0 0]", "uniform 0", {
        "atmosphere": "type            calculated;\nvalue           uniform 0;",
        "outlet": "type            calculated;\nvalue           uniform 0;",
        "wall": "type            nutUSpaldingWallFunction;\nvalue           uniform 0;"},
        ["walls: nutUSpaldingWallFunction (valid from y+~1 to the log layer, so it is "
         "correct for both the wall-resolved 2-D mesh and the wall-function 3-D mesh)"])


def physics_files(cw, d, der):
    comp = der["compressible"]
    prov = ["dry air: R = %.3f J/kgK (M = %.4f g/mol), cp = %.1f J/kgK, gamma = %.4f" %
            (R_AIR, M_AIR * 1e3, CP_AIR, GAMMA),
            "Sutherland viscosity As = %.4g, Ts = %.1f K -> mu(%.1f K) = %.5g Pa s" %
            (SUTH_AS, SUTH_TS, der["T_amb"], der["mu_amb"])]
    if comp:
        body = """thermoType
{
    type            hePsiThermo;
    mixture         pureMixture;
    transport       sutherland;
    thermo          hConst;
    equationOfState perfectGas;
    specie          specie;
    energy          sensibleEnthalpy;
}

mixture
{
    specie
    {
        molWeight   %.6g;
    }
    thermodynamics
    {
        Cp          %.6g;
        Hf          0;
    }
    transport
    {
        As          %.6g;
        Ts          %.6g;
    }
}
""" % (M_AIR * 1e3, CP_AIR, SUTH_AS, SUTH_TS)
        cw.foam("constant/thermophysicalProperties", "dictionary", "thermophysicalProperties", body, prov,
                location="constant")
    else:
        body = "transportModel  Newtonian;\n\nnu              %.9g;\n\nrhoInf          %.9g;\n" % (
            der["nu_amb"], der["rho_amb"])
        cw.foam("constant/transportProperties", "dictionary", "transportProperties", body,
                prov + ["incompressible: nu = mu/rho at ambient p, T = %.5g m2/s, rho = %.5g kg/m3"
                        % (der["nu_amb"], der["rho_amb"])], location="constant")
    tb = """simulationType  RAS;

RAS
{
    RASModel        kOmegaSST;
    turbulence      on;
    printCoeffs     on;
}
"""
    cw.foam("constant/turbulenceProperties", "dictionary", "turbulenceProperties", tb, [
        "k-omega SST (Menter 1994/2003): blends k-omega near walls with k-epsilon in the free stream;",
        "the shear-stress limiter makes it the standard RANS choice for adverse pressure",
        "gradients and separation (sharp lips, vena contracta, diffusers, bends).",
        "Estimated tract Re = %.3g (D = %.2f mm, U_bulk = %.2f m/s)" % (der["Re"], der["D_Re"] * 1e3, der["U_bulk"])],
        location="constant")


def numerics_files(cw, d, der, is3d, monitors, nonortho):
    comp = der["compressible"]
    if is3d:
        psolver = "solver          GAMG;\n        smoother        GaussSeidel;"
    else:
        # 2-D sector meshes are small but strongly graded (y+ ~ 1, sharp-edge
        # fans); a Krylov solver converges far more reliably than GAMG here
        psolver = "solver          PCG;\n        preconditioner  DIC;"
    lim = "limited corrected 0.5" if is3d else "corrected"
    energy = "h"
    div = []
    div.append("div(phi,U)      bounded Gauss linearUpwindV grad(U);")
    if comp:
        div += ["div(phi,h)      bounded Gauss linearUpwind limited;",
                "div(phi,K)      bounded Gauss linearUpwind limited;",
                "div(phi,Ekp)    bounded Gauss linearUpwind limited;",
                "div(phid,p)     Gauss limitedLinear 1;",
                "div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;"]
    else:
        div += ["div((nuEff*dev2(T(grad(U))))) Gauss linear;"]
    div += ["div(phi,k)      bounded Gauss limitedLinear 1;",
            "div(phi,omega)  bounded Gauss limitedLinear 1;"]
    schemes = """ddtSchemes
{
    default         steadyState;
}

gradSchemes
{
    default         Gauss linear;
    limited         cellLimited Gauss linear 1;
    grad(U)         $limited;
    grad(h)         $limited;
    grad(k)         $limited;
    grad(omega)     $limited;
}

divSchemes
{
    default         none;
%s
}

laplacianSchemes
{
    default         Gauss linear %s;
}

interpolationSchemes
{
    default         linear;
}

snGradSchemes
{
    default         %s;
}

wallDist
{
    method          meshWave;
}
""" % ("\n".join("    " + x for x in div), lim, lim.replace("Gauss linear ", ""))
    cw.foam("system/fvSchemes", "dictionary", "fvSchemes", schemes, [
        "second-order bounded linear-upwind convection for U%s; limitedLinear (TVD) for k, omega" %
        (" and enthalpy" if comp else ""),
        "cell-limited gradients for robustness at sharp lips",
        "laplacian/snGrad: %s (%s mesh)" % (lim, "snappyHexMesh 3-D" if is3d else "structured 2-D sector")])
    if comp:
        sol = """solvers
{
    p
    {
        @PSOLVER@
        tolerance       1e-12;
        relTol          0.01;
    }
    "(U|h|k|omega)"
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-10;
        relTol          0.1;
    }
}

SIMPLE
{
    nNonOrthogonalCorrectors %d;
    consistent      no;       // classic SIMPLE: SIMPLEC without density
                              // relaxation oscillated/diverged on sharp-edged
                              // inlets in testing; this setting does not
    transonic       %s;
    pMinFactor      0.5;
    pMaxFactor      1.5;
    residualControl
    {
        p               1e-6;
        U               1e-7;
        h               1e-7;
        "(k|omega)"     1e-6;
    }
}

relaxationFactors
{
    fields
    {
        p               0.3;
        rho             0.05;
    }
    equations
    {
        U               0.7;
        h               0.7;
        "(k|omega)"     0.7;
    }
}
""" % (nonortho, "yes" if der["transonic"] else "no")
        sol = sol.replace("@PSOLVER@", psolver)
    else:
        sol = """solvers
{
    p
    {
        @PSOLVER@
        tolerance       1e-12;
        relTol          0.01;
    }
    "(U|k|omega)"
    {
        solver          smoothSolver;
        smoother        symGaussSeidel;
        tolerance       1e-10;
        relTol          0.1;
    }
}

SIMPLE
{
    nNonOrthogonalCorrectors %d;
    consistent      no;       // classic SIMPLE: SIMPLEC (U 0.8) diverged on long
                              // flow-rate-driven pipes (80 D at Re 1e5); this gives
                              // the same converged answer within 0.03 %% on the
                              // square-cut pipe case
    residualControl
    {
        p               1e-6;
        U               1e-7;
        "(k|omega)"     1e-6;
    }
}

relaxationFactors
{
    fields
    {
        p               0.3;
    }
    equations
    {
        U               0.7;
        "(k|omega)"     0.7;
    }
}
""" % nonortho
        sol = sol.replace("@PSOLVER@", psolver)
    # what the results depend on besides the mesh, recorded in case_info.json and results.json, and compared
    # against a reference run's record by tools/openfoam/compare_results.py
    der["numerics"] = dict(algorithm="SIMPLE",
                           relaxation="p 0.3 / rho 0.05 / U, h, k, omega 0.7" if comp else "p 0.3 / U, k, omega 0.7",
                           p_solver="GAMG" if is3d else "PCG/DIC",
                           mesh="3-D snappyHexMesh" if is3d else "2-D sector, rotational cyclic sides")
    cw.foam("system/fvSolution", "dictionary", "fvSolution", sol, [
        "solver %s: %s" % (der["solver"], der["solver_why"]),
        ("SIMPLE, relaxation p 0.3 / rho 0.05 / U, h, k, omega 0.7 (robust for separated compressible flow)"
         if comp else "SIMPLE, relaxation p 0.3 / U, k, omega 0.7") +
        "; p solver: %s" % ("GAMG (3-D)" if is3d else "PCG/DIC (2-D sector)"),
        "transonic formulation: %s (estimated peak Mach %.3f)" % ("on" if der["transonic"] else "off", der["M_peak"]),
        "residual targets are a secondary stop; the primary stop is the engineering-quantity",
        "watchdog run by Allrun (see controlDict header) plus the iteration cap"])


def control_dict(cw, d, der, monitors, surfaces, n_iter, write_int, conv):
    """monitors: list of FO dict bodies (name, text). surfaces: text for the
    'surfaces' function object."""
    fo = "\n".join(monitors)
    body = """application     %s;

startFrom       latestTime;
startTime       0;
stopAt          endTime;
endTime         %d;
deltaT          1;
writeControl    timeStep;
writeInterval   %d;
purgeWrite      2;
writeFormat     ascii;
writePrecision  10;
writeCompression off;
timeFormat      general;
timePrecision   8;
runTimeModifiable true;

functions
{
%s
%s
%s
}
""" % (der["solver"], n_iter, write_int, fo, surfaces, conv)
    cw.foam("system/controlDict", "dictionary", "controlDict", body, [
        "application %s chosen because %s" % (der["solver"], der["solver_why"]),
        "endTime %d iterations = cap; writeInterval %d" % (n_iter, write_int),
        "function objects: mass flow on atmosphere/outlet patches, area-averaged static pressure on",
        "each named plane, y+, solver residuals, sampled planes (VTK) for intake_report.py.",
        "Convergence stop: Allrun's watchdog (intake_report.py --watch) sets stopAt writeNow once the",
        "inflow mass flow changes < 0.02 % and every plane's static pressure drop < 0.1 % over 300 iterations"])


def fo_patch_sum(name, patch, field="phi", interval=10):
    return """    %s
    {
        type            surfaceFieldValue;
        libs            (fieldFunctionObjects);
        regionType      patch;
        name            %s;
        operation       sum;
        fields          (%s);
        writeFields     false;
        log             false;
        writeControl    timeStep;
        writeInterval   %d;
    }""" % (name, patch, field, interval)


def fo_patch_avg(name, patch, fields, interval=10):
    return """    %s
    {
        type            surfaceFieldValue;
        libs            (fieldFunctionObjects);
        regionType      patch;
        name            %s;
        operation       areaAverage;
        fields          (%s);
        writeFields     false;
        log             false;
        writeControl    timeStep;
        writeInterval   %d;
    }""" % (name, patch, " ".join(fields), interval)


def fo_zone(name, zone, op, fields, interval=10):
    return """    %s
    {
        type            surfaceFieldValue;
        libs            (fieldFunctionObjects);
        regionType      faceZone;
        name            %s;
        operation       %s;
        fields          (%s);
        writeFields     false;
        log             false;
        writeControl    timeStep;
        writeInterval   %d;
    }""" % (name, zone, op, " ".join(fields), interval)


def fo_plane_sampled(name, pt, nn, bmin, bmax, op, fields, interval=10):
    return """    %s
    {
        type            surfaceFieldValue;
        libs            (fieldFunctionObjects);
        regionType      sampledSurface;
        name            %s;
        sampledSurfaceDict
        {
            type        cuttingPlane;
            planeType   pointAndNormal;
            pointAndNormalDict
            {
                point   %s;
                normal  %s;
            }
            bounds      %s %s;
            interpolate false;
        }
        operation       %s;
        fields          (%s);
        writeFields     false;
        log             false;
        writeControl    timeStep;
        writeInterval   %d;
    }""" % (name, name, _vec(pt), _vec(nn), _vec(bmin), _vec(bmax), op, " ".join(fields), interval)


def plane_bounds(pt, nn, radius, margin):
    """Axis-aligned box that contains the disk of given radius on the plane,
    plus `margin` (at least one cell, because cut cells are selected by
    their centres)."""
    half = [radius * math.sqrt(max(0.0, 1 - nn[i] ** 2)) + margin for i in range(3)]
    return (tuple(pt[i] - half[i] for i in range(3)), tuple(pt[i] + half[i] for i in range(3)))


def surfaces_fo(planes, fields):
    """planes: list of (name, point, normal, bmin, bmax)."""
    lines = []
    for (nm, pt, nn, bmin, bmax) in planes:
        lines.append("""            %s
            {
                type        cuttingPlane;
                planeType   pointAndNormal;
                pointAndNormalDict
                {
                    point   %s;
                    normal  %s;
                }
                bounds      %s %s;
                interpolate false;
            }""" % (nm, _vec(pt), _vec(nn), _vec(bmin), _vec(bmax)))
    return """    planes
    {
        type            surfaces;
        libs            (sampling);
        writeControl    writeTime;
        surfaceFormat   vtk;
        formatOptions
        {
            vtk
            {
                format      ascii;
                legacy      true;
                precision   10;
            }
        }
        fields          (%s);
        interpolationScheme cell;
        surfaces
        {
%s
        }
    }""" % (" ".join(fields), "\n".join(lines))


# --------------------------------------------------------------------------
# Post-processing script written into the case (stdlib only)
# --------------------------------------------------------------------------
REPORT_PY = r'''
"""intake_report.py -- reads the OpenFOAM results of this case and prints
mass flow, pressure drops, loss coefficient K, discharge coefficient Cd and,
for every sampled plane, uniformity index, secondary-flow and swirl angles.
Standard library only.  Run from the case directory:  python3 intake_report.py
Writes results.json and results.txt."""
import glob, json, math, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
INFO = json.load(open(os.path.join(HERE, "case_info.json")))
G, R = INFO["gamma"], INFO["R_air"]
P0, T0 = INFO["p_amb"], INFO["T_amb"]
COMP = INFO["compressible"]
RHO_INC = INFO["rho_amb"]
SCALE = INFO["flow_scale"]          # 360/sector angle for the 2-D sector, 1 in 3-D


def ideal_flux(p0, T0, p):
    prc = (2.0 / (G + 1)) ** (G / (G - 1))
    pr = max(min(p / p0, 1.0), prc)
    return p0 * math.sqrt(2 * G / ((G - 1) * R * T0)) * pr ** (1 / G) * math.sqrt(max(0.0, 1 - pr ** ((G - 1) / G)))


def blair_cd(p0, T0, ps, mdot, A):
    """'Actual' discharge coefficient Ac/A of Blair & Lau (SAE 952138; Blair,
    Design and Simulation of Four-Stroke Engines, 1999): isentropic flow
    p0 -> vena contracta (pc, area Ac), then a momentum (Borda-Carnot)
    recovery with pc acting on the full area A to the measured state ps:
        (pc - ps) A = mdot (Us - Uc),  cp T0 = cp Ts + Us^2/2.
    This is the CD a 1-D wave-action engine simulation expects at a pipe end."""
    cp = G * R / (G - 1)
    Gf = mdot / A
    Ts = T0
    for _ in range(50):
        Us = Gf / (ps / (R * Ts))
        Ts = T0 - Us * Us / (2 * cp)
    Us = Gf / (ps / (R * Ts))

    def Uc(pc):
        return math.sqrt(max(0.0, 2 * cp * T0 * (1 - (pc / p0) ** ((G - 1) / G))))

    def f(pc):
        return pc - ps + Gf * (Uc(pc) - Us)
    lo = p0 * (2 / (G + 1)) ** (G / (G - 1))
    hi = ps
    if f(lo) > 0 or f(hi) < 0:
        return None
    for _ in range(100):
        mid = 0.5 * (lo + hi)
        if f(mid) > 0:
            hi = mid
        else:
            lo = mid
    pc = 0.5 * (lo + hi)
    Tc = T0 * (pc / p0) ** ((G - 1) / G)
    return mdot / (pc / (R * Tc) * Uc(pc)) / A


def last_rows(fo, n=1):
    """Return (header, rows) of the newest surfaceFieldValue.dat of a FO."""
    files = sorted(glob.glob(os.path.join(HERE, "postProcessing", fo, "*", "*.dat")),
                   key=lambda f: float(os.path.basename(os.path.dirname(f))))
    rows, header = [], None
    for fn in files:
        for ln in open(fn):
            if ln.startswith("#"):
                if "Time" in ln:
                    header = ln[1:].split()
                continue
            parts = ln.split()
            if parts:
                try:
                    rows.append([float(x) for x in parts])
                except ValueError:
                    pass
    return header, rows


def series(fo, col=1):
    h, rows = last_rows(fo)
    return [(r[0], r[col]) for r in rows if len(r) > col]


def drift(ser, window):
    """Relative change of a monitored quantity over the last `window` iterations."""
    if len(ser) < 3:
        return None
    tend = ser[-1][0]
    old = [v for (t, v) in ser if t <= tend - window]
    if not old:
        return None
    ref = abs(ser[-1][1]) if abs(ser[-1][1]) > 0 else 1.0
    return abs(ser[-1][1] - old[-1]) / ref


def read_vtk(fn):
    """Minimal legacy-ASCII VTK POLYDATA reader -> points, polys, cell fields."""
    tok = open(fn).read().split()
    i = 0
    pts, polys, fields = [], [], {}
    ncell = 0
    while i < len(tok):
        t = tok[i]
        if t == "POINTS":
            n = int(tok[i + 1]); i += 3
            pts = [(float(tok[i + 3 * k]), float(tok[i + 3 * k + 1]), float(tok[i + 3 * k + 2])) for k in range(n)]
            i += 3 * n
        elif t == "POLYGONS":
            n = int(tok[i + 1]); i += 3
            for _ in range(n):
                m = int(tok[i]); polys.append([int(x) for x in tok[i + 1:i + 1 + m]]); i += m + 1
        elif t == "CELL_DATA":
            ncell = int(tok[i + 1]); i += 2
        elif t == "POINT_DATA":
            i += 2
            break
        elif t == "FIELD" and ncell:
            nf = int(tok[i + 2]); i += 3
            for _ in range(nf):
                name, nc, nt = tok[i], int(tok[i + 1]), int(tok[i + 2]); i += 4
                vals = [float(x) for x in tok[i:i + nc * nt]]; i += nc * nt
                fields[name] = [tuple(vals[k * nc:(k + 1) * nc]) for k in range(nt)] if nc > 1 else vals
        elif t == "SCALARS" and ncell:
            name = tok[i + 1]; i += 3
            if tok[i] == "LOOKUP_TABLE": i += 2
            fields[name] = [float(x) for x in tok[i:i + ncell]]; i += ncell
        elif t == "VECTORS" and ncell:
            name = tok[i + 1]; i += 3
            v = [float(x) for x in tok[i:i + 3 * ncell]]; i += 3 * ncell
            fields[name] = [tuple(v[3 * k:3 * k + 3]) for k in range(ncell)]
        else:
            i += 1
    return pts, polys, fields


def sub(a, b): return (a[0] - b[0], a[1] - b[1], a[2] - b[2])
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
def mag(a): return math.sqrt(dot(a, a))


def plane_metrics(fn, centre, normal):
    pts, polys, F = read_vtk(fn)
    U = F.get("U"); p = F.get("p")
    T = F.get("T"); rho = F.get("rho")
    if U is None or p is None:
        return None
    n = normal
    A = mdot = 0.0
    sp = sT = 0.0
    p0w = Tw = 0.0
    un_list = []
    sec_w = swl_w = swl_abs_w = 0.0
    ang_mom = mom = 0.0
    for k, poly in enumerate(polys):
        P = [pts[j] for j in poly]
        c = (sum(q[0] for q in P) / len(P), sum(q[1] for q in P) / len(P), sum(q[2] for q in P) / len(P))
        S = (0.0, 0.0, 0.0)
        for j in range(len(P)):
            S = tuple(S[m] + cross(P[j], P[(j + 1) % len(P)])[m] * 0.5 for m in range(3))
        a = abs(dot(S, n))
        if a <= 0:
            continue
        u = U[k]
        if COMP:
            pk, Tk, rk = p[k], T[k], rho[k]
            M2 = dot(u, u) / (G * R * Tk)
            p0k = pk * (1 + 0.5 * (G - 1) * M2) ** (G / (G - 1))
            T0k = Tk * (1 + 0.5 * (G - 1) * M2)
        else:
            rk = RHO_INC
            pk = P0 + p[k] * RHO_INC
            Tk = T0
            p0k = pk + 0.5 * RHO_INC * dot(u, u)
            T0k = T0
        un = dot(u, n)
        ut = sub(u, tuple(un * x for x in n))
        r_vec = sub(c, centre)
        r_vec = sub(r_vec, tuple(dot(r_vec, n) * x for x in n))
        rr = mag(r_vec)
        et = cross(n, r_vec)
        et = tuple(x / rr for x in et) if rr > 1e-12 else (0.0, 0.0, 0.0)
        uth = dot(u, et)
        dm = rk * un * a
        A += a; mdot += dm
        sp += pk * a; sT += Tk * a
        p0w += p0k * dm; Tw += T0k * dm
        un_list.append((un, a))
        sec_w += math.degrees(math.atan2(mag(ut), abs(un))) * abs(dm)
        swl_w += math.degrees(math.atan2(uth, abs(un))) * abs(dm)
        swl_abs_w += abs(math.degrees(math.atan2(uth, abs(un)))) * abs(dm)
        ang_mom += rk * un * uth * rr * a
        mom += rk * un * un * a
    if A <= 0 or mdot == 0:
        return None
    ubar = sum(x * a for x, a in un_list) / A
    ui = 1 - sum(abs(x - ubar) * a for x, a in un_list) / (2 * abs(ubar) * A) if ubar else float("nan")
    req = math.sqrt(A / math.pi)
    return dict(area_m2=A * SCALE, mdot_kg_s=mdot * SCALE, p_static_avg_Pa=sp / A, T_static_avg_K=sT / A,
                p0_massavg_Pa=p0w / mdot, T0_massavg_K=Tw / mdot, U_normal_avg_m_s=ubar,
                uniformity_index=ui, secondary_flow_angle_deg=sec_w / abs(mdot),
                swirl_angle_net_deg=swl_w / abs(mdot), swirl_angle_abs_deg=swl_abs_w / abs(mdot),
                swirl_number=ang_mom / (mom * req) if mom else 0.0, n_faces=len(polys))


EXH = INFO.get("kind") == "exhaust"
INFLOW = INFO.get("inlets", []) if EXH else ["atmosphere"]


def dp_reference():
    """Pressure difference the drift tests are measured against: the plane's own
    drop from ambient (intake), or the largest plane-to-ambient difference (exhaust,
    where the exit plane sits at ambient and would divide by ~0)."""
    best = 0.0
    for pl in INFO["planes"]:
        ser = series("p_" + pl["name"])
        if ser:
            pv = ser[-1][1] if COMP else P0 + ser[-1][1] * RHO_INC
            best = max(best, abs(pv - P0))
    return best


def main():
    out = {"case": INFO["name"], "solver": INFO["solver"], "notes": [], "kind": INFO.get("kind", "intake"),
           "generator": INFO.get("generator"), "numerics": INFO.get("numerics"), "flow_scale": SCALE}
    # mass flow (exact, from face fluxes)
    h, rows = last_rows("mdot_outlet")
    if not rows:
        print("no results yet (postProcessing/mdot_outlet missing)"); sys.exit(1)
    it = rows[-1][0]
    fac = 1.0 if COMP else RHO_INC
    m_out = rows[-1][1] * fac * SCALE
    m_in = 0.0
    m_each = {}
    for nm in INFLOW:
        h2, rows2 = last_rows("mdot_" + nm)
        if rows2:
            m_each[nm] = -rows2[-1][1] * fac * SCALE
            m_in += m_each[nm]
        else:
            m_in = float("nan")
    out["iterations"] = it
    out["mdot_outlet_kg_s"] = m_out
    out["mdot_atmosphere_kg_s"] = m_in
    if EXH:
        out["mdot_inlets_kg_s"] = m_each
    out["mass_imbalance_rel"] = abs(m_in - m_out) / abs(m_out) if m_out else None
    # convergence evidence
    win = INFO["conv_window"]
    conv = {"window_iterations": win,
            "mdot_atmosphere_rel_change": drift(series("mdot_outlet" if EXH else "mdot_atmosphere"), win)}
    dref = dp_reference() if EXH else None
    for pl in INFO["planes"]:
        conv["p_%s_rel_change_of_dp" % pl["name"]] = None
        ser = series("p_" + pl["name"])
        if ser and len(ser) > 2:
            tend = ser[-1][0]
            old = [v for (t, v) in ser if t <= tend - win]
            if old:
                pv = ser[-1][1] if COMP else P0 + ser[-1][1] * RHO_INC
                po = old[-1] if COMP else P0 + old[-1] * RHO_INC
                dp = dref if EXH else P0 - pv
                conv["p_%s_rel_change_of_dp" % pl["name"]] = abs(pv - po) / abs(dp) if dp else None
    out["convergence"] = conv
    # sampled planes
    tdirs = sorted(glob.glob(os.path.join(HERE, "postProcessing", "planes", "*")),
                   key=lambda f: float(os.path.basename(f)) if os.path.basename(f).replace(".", "").isdigit() else -1)
    planes = {}
    if tdirs:
        td = tdirs[-1]
        out["sample_time"] = os.path.basename(td)
        for pl in INFO["planes"]:
            fn = os.path.join(td, pl["name"] + ".vtk")
            if os.path.exists(fn):
                m = plane_metrics(fn, tuple(pl["point"]), tuple(pl["normal"]))
                if m:
                    planes[pl["name"]] = m
    ref = INFO["reference_plane"]
    res = {}
    for nm, m in planes.items():
        A = m["area_m2"]
        pl = [x for x in INFO["planes"] if x["name"] == nm][0]
        A_geo = pl.get("area_geometric_m2") or A
        ps = m["p_static_avg_Pa"]
        rho_s = ps / (R * m["T_static_avg_K"]) if COMP else RHO_INC
        Ub = m_out / (rho_s * A_geo)
        q = 0.5 * rho_s * Ub * Ub
        mid = ideal_flux(P0, T0, ps) * A_geo if COMP else A_geo * math.sqrt(2 * RHO_INC * max(P0 - ps, 0.0))
        m.update(PR_p0_over_ps=P0 / ps, dp_static_Pa=P0 - ps, dp_total_Pa=P0 - m["p0_massavg_Pa"],
                 U_bulk_m_s=Ub, q_dyn_Pa=q, K_total_loss=(P0 - m["p0_massavg_Pa"]) / q,
                 Cd_flowbench=m_out / mid if mid > 0 else None, area_geometric_m2=A_geo,
                 Cd_vena_contracta_Blair=blair_cd(P0, T0, ps, m_out, A_geo),
                 mdot_plane_vs_outlet=m["mdot_kg_s"] / m_out if m_out else None,
                 Mach_bulk=Ub / math.sqrt(G * R * m["T_static_avg_K"]))
        res[nm] = m
    out["planes"] = res
    out["reference_plane"] = ref
    if EXH:
        # component loss: inlet total pressure (mass-averaged over the inlet faces) to the exit face,
        # in dynamic heads of the inlet bulk velocity (total mass flow over the total inlet area)
        ins = [n for n in INFO["inlets"] if n in res]
        if ins and "exit" in res:
            mt = sum(res[n]["mdot_kg_s"] for n in ins)
            p0_in = sum(res[n]["p0_massavg_Pa"] * res[n]["mdot_kg_s"] for n in ins) / mt
            A_in = INFO["A_in_total_m2"]
            ps_in = sum(res[n]["p_static_avg_Pa"] * INFO["inlet_areas_m2"][n] for n in ins) / A_in
            T_in = sum(res[n]["T_static_avg_K"] * INFO["inlet_areas_m2"][n] for n in ins) / A_in
            rho_in = ps_in / (R * T_in)
            U_in = m_out / (rho_in * A_in)
            q_in = 0.5 * rho_in * U_in * U_in
            ex = res["exit"]
            summ = {"mdot_kg_s": m_out, "T_in_K": T_in, "rho_in_kg_m3": rho_in, "U_in_m_s": U_in, "q_in_Pa": q_in,
                    "p0_in_Pa": p0_in, "ps_in_Pa": ps_in, "p0_exit_Pa": ex["p0_massavg_Pa"], "ps_exit_Pa": ex["p_static_avg_Pa"],
                    "dp_total_Pa": p0_in - ex["p0_massavg_Pa"], "dp_static_Pa": ps_in - ex["p_static_avg_Pa"],
                    "K": (p0_in - ex["p0_massavg_Pa"]) / q_in,
                    "K_to_ambient": (p0_in - P0) / q_in,
                    "back_pressure_Pa": ps_in - P0,
                    "split": {n: res[n]["mdot_kg_s"] / mt for n in ins},
                    "split_set": INFO.get("split"),
                    "exit_uniformity_index": ex["uniformity_index"], "exit_swirl_angle_deg": ex["swirl_angle_abs_deg"],
                    "Mach_in": U_in / math.sqrt(G * R * T_in)}
            for n in ins:
                res[n]["K_inlet_to_exit"] = (res[n]["p0_massavg_Pa"] - ex["p0_massavg_Pa"]) / q_in
            out["summary"] = summ
    elif ref in res:
        r = res[ref]
        out["summary"] = {"mdot_kg_s": m_out, "PR": r["PR_p0_over_ps"], "dp_static_Pa": r["dp_static_Pa"],
                          "dp_total_Pa": r["dp_total_Pa"], "K": r["K_total_loss"], "Cd": r["Cd_flowbench"],
                          "Cd_vena_contracta_Blair": r["Cd_vena_contracta_Blair"]}
    # y+
    yp = sorted(glob.glob(os.path.join(HERE, "postProcessing", "yPlus", "*", "yPlus.dat")))
    if yp:
        lines = [l.split() for l in open(yp[-1]) if not l.startswith("#") and l.strip()]
        last_t = lines[-1][0] if lines else None
        out["yPlus"] = {l[1]: {"min": float(l[2]), "max": float(l[3]), "avg": float(l[4])}
                        for l in lines if l[0] == last_t}
    ok = True
    c = out["convergence"]
    if out["mass_imbalance_rel"] is None or out["mass_imbalance_rel"] > 1e-3:
        ok = False; out["notes"].append("mass imbalance > 0.1 %")
    if c.get("mdot_atmosphere_rel_change") is None or c["mdot_atmosphere_rel_change"] > 1e-3:
        ok = False; out["notes"].append("mass flow still changing > 0.1 % over the last window")
    for k, v in c.items():
        if k.startswith("p_") and v is not None and v > 5e-3:
            ok = False; out["notes"].append("%s = %.2g (> 0.5 %%)" % (k, v))
    out["converged"] = ok
    json.dump(out, open(os.path.join(HERE, "results.json"), "w"), indent=2)
    L = []
    L.append("Case %s  solver %s  iterations %d  converged: %s" % (INFO["name"], INFO["solver"], it, "YES" if ok else "NO"))
    if EXH and out.get("summary"):
        sm = out["summary"]
        L.append("Exhaust component: mass flow %.4f g/s of gas at %.0f K; inlet bulk velocity %.1f m/s (M %.2f), q_in %.0f Pa" %
                 (m_out * 1e3, sm["T_in_K"], sm["U_in_m_s"], sm["Mach_in"], sm["q_in_Pa"]))
        L.append("Total-pressure loss inlet -> exit face %.0f Pa = %.2f kPa = %.1f mbar ; K = %.3f (inlet dynamic heads)" %
                 (sm["dp_total_Pa"], sm["dp_total_Pa"] / 1e3, sm["dp_total_Pa"] / 100, sm["K"]))
        L.append("Inlet total pressure above ambient %.0f Pa ; K to ambient (exit dynamic head included) = %.3f ; back pressure (static) %.2f kPa = %.1f mbar" %
                 (sm["p0_in_Pa"] - P0, sm["K_to_ambient"], sm["back_pressure_Pa"] / 1e3, sm["back_pressure_Pa"] / 100))
        if len(sm["split"]) > 1:
            L.append("Flow split: " + ", ".join("%s %.1f %%" % (n, 100 * f) for n, f in sm["split"].items()) +
                     "  (set: " + ", ".join("%s %.1f %%" % (n, 100 * f) for n, f in (sm["split_set"] or {}).items()) + ")")
        L.append("Ambient p = %.1f Pa (outlet); plane table below: PR, Cd and the K column use the intake definitions and are not meaningful here" % P0)
    else:
        L.append("Mass flow (outlet faces) %.6g kg/s = %.4f g/s ; atmosphere %.6g kg/s ; imbalance %.2e" %
                 (m_out, m_out * 1e3, m_in, out["mass_imbalance_rel"] or 0))
        L.append("Ambient p0 = %.1f Pa, T0 = %.2f K" % (P0, T0))
    L.append("%-14s %9s %10s %10s %8s %8s %7s %7s %8s %8s" % ("plane", "x/pos", "PR=p0/ps", "dp_stat", "dp_tot", "K",
                                                              "Cd", "UI", "sec[deg]", "swirl"))
    for pl in INFO["planes"]:
        if pl["name"] in res:
            r = res[pl["name"]]
            L.append("%-14s %9s %10.5f %10.1f %8.1f %8.4f %7.4f %7.4f %8.3f %8.3f" % (
                pl["name"], pl.get("label", ""), r["PR_p0_over_ps"], r["dp_static_Pa"], r["dp_total_Pa"],
                r["K_total_loss"], r["Cd_flowbench"] or float("nan"), r["uniformity_index"],
                r["secondary_flow_angle_deg"], r["swirl_angle_net_deg"]))
    L.append("K = (p0_amb - p0_massavg)/(0.5 rho U_bulk^2) at the plane; Cd = mdot / isentropic mdot(p0_amb,T0 -> ps) through the plane area")
    if ref in res and res[ref].get("Cd_vena_contracta_Blair"):
        L.append("Blair/Lau 'actual' (vena-contracta) CD at %s, for 1-D wave simulations: %.4f" %
                 (ref, res[ref]["Cd_vena_contracta_Blair"]))
    for n in out["notes"]:
        L.append("NOTE: " + n)
    txt = "\n".join(L)
    open(os.path.join(HERE, "results.txt"), "w").write(txt + "\n")
    print(txt)


def watch(pid):
    """Stop the solver cleanly once the monitored quantities have settled:
    inflow mass flow and every plane's static pressure drop change less than
    stop_mdot_rel / stop_dp_rel over the last conv_window iterations."""
    import time
    win = INFO["conv_window"]
    first = INFO["ramp"] + 2 * win
    cdict = os.path.join(HERE, "system", "controlDict")

    def alive():
        if os.name == "nt":
            # os.kill(pid, 0) is not a liveness test on Windows: it calls TerminateProcess and would end the solver
            import ctypes
            k32 = ctypes.windll.kernel32
            k32.OpenProcess.restype = ctypes.c_void_p
            k32.GetExitCodeProcess.argtypes = (ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong))
            k32.CloseHandle.argtypes = (ctypes.c_void_p,)
            h = k32.OpenProcess(0x1000, False, pid)        # PROCESS_QUERY_LIMITED_INFORMATION
            if not h:
                return False
            code = ctypes.c_ulong(0)
            ok = k32.GetExitCodeProcess(h, ctypes.byref(code))
            k32.CloseHandle(h)
            return bool(ok) and code.value == 259          # STILL_ACTIVE
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    while alive():
        time.sleep(5)
        ser = series("mdot_outlet" if EXH else "mdot_atmosphere")
        if not ser or ser[-1][0] < first:
            continue
        ok = True
        d = drift(ser, win)
        if d is None or d > INFO["stop_mdot_rel"]:
            ok = False
        dref = dp_reference() if EXH else None
        for pl in INFO["planes"]:
            sp = series("p_" + pl["name"])
            if len(sp) < 3:
                ok = False
                continue
            tend = sp[-1][0]
            old = [v for (t, v) in sp if t <= tend - win]
            if not old:
                ok = False
                continue
            pv = sp[-1][1] if COMP else P0 + sp[-1][1] * RHO_INC
            po = old[-1] if COMP else P0 + old[-1] * RHO_INC
            dp = dref if EXH else P0 - pv
            if not dp or abs(pv - po) / abs(dp) > INFO["stop_dp_rel"]:
                ok = False
        if ok:
            txt = open(cdict).read()
            txt = txt.replace("stopAt          endTime;", "stopAt          writeNow;")
            # the solver re-reads controlDict when it changes: write a new file and swap it in, so that it never
            # reads a half-written one (if the swap is refused, e.g. the file is open on Windows, write in place)
            tmp = cdict + ".watch"
            open(tmp, "w").write(txt)
            try:
                os.replace(tmp, cdict)
            except OSError:
                open(cdict, "w").write(txt)
                os.remove(tmp)
            print("watch: converged at iteration %d -> stopAt writeNow" % ser[-1][0])
            sys.stdout.flush()
            return


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--watch":
        watch(int(sys.argv[2]))
    else:
        main()
'''


# --------------------------------------------------------------------------
# Allrun / Allclean / README
# --------------------------------------------------------------------------
def allrun_text(der, is3d):
    mesh = """run blockMesh
""" if not is3d else """run blockMesh
run surfaceFeatureExtract
run snappyHexMesh -overwrite
"""
    return r"""set -u
cd "$(dirname "$0")" || exit 1
NP=${1:-1}          # ./Allrun 4   -> run the solver on 4 cores

if ! command -v blockMesh >/dev/null 2>&1; then
    echo "OpenFOAM environment not loaded."
    echo "  Ubuntu/WSL (openfoam.com packages):  openfoam2412   (opens a shell with it loaded)"
    echo "  or:  source /usr/lib/openfoam/openfoam2412/etc/bashrc"
    exit 1
fi

run() {
    app=$1; shift
    echo "Running $app $*"
    if ! "$app" "$@" > "log.$app" 2>&1; then
        echo "  $app FAILED -- see log.$app"; tail -n 30 "log.$app"; exit 1
    fi
}

""" + mesh + r"""checkMesh > log.checkMesh 2>&1
if grep -q "Failed [0-9]* mesh checks" log.checkMesh; then
    echo "WARNING: checkMesh reports failed checks -- see log.checkMesh"
    grep -E "\*\*\*|Failed" log.checkMesh | head -n 20
else
    echo "checkMesh: mesh OK"
fi
run topoSet

SOLVER=$(foamDictionary -entry application -value system/controlDict)
if command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi
if [ "$NP" -gt 1 ]; then
    foamDictionary -entry numberOfSubdomains -set "$NP" system/decomposeParDict > /dev/null
    run decomposePar -force
    echo "Running $SOLVER on $NP cores"
    mpirun -np "$NP" "$SOLVER" -parallel > "log.$SOLVER" 2>&1 &
    SPID=$!
    $PY intake_report.py --watch $SPID &
    WPID=$!
    if ! wait $SPID; then echo "$SOLVER FAILED"; tail -n 30 "log.$SOLVER"; kill $WPID 2>/dev/null; exit 1; fi
    kill $WPID 2>/dev/null; wait $WPID 2>/dev/null
    run reconstructPar -latestTime
else
    echo "Running $SOLVER"
    "$SOLVER" > "log.$SOLVER" 2>&1 &
    SPID=$!
    $PY intake_report.py --watch $SPID &
    WPID=$!
    if ! wait $SPID; then echo "  $SOLVER FAILED -- see log.$SOLVER"; tail -n 30 "log.$SOLVER"; kill $WPID 2>/dev/null; exit 1; fi
    kill $WPID 2>/dev/null; wait $WPID 2>/dev/null
fi
# restore stopAt so that a restarted run continues normally
sed -i 's/stopAt          writeNow;/stopAt          endTime;/' system/controlDict

$PY intake_report.py
touch case.foam    # open this file in ParaView
"""


def allclean_text():
    return r"""cd "$(dirname "$0")" || exit 1
rm -rf processor* postProcessing log.* results.json results.txt case.foam
for d in [1-9]*; do [ -d "$d" ] && rm -rf "$d"; done
rm -rf constant/polyMesh constant/extendedFeatureEdgeMesh constant/triSurface/*.eMesh
"""


README_WINDOWS = r"""Running this case on a Windows PC
==================================

The case is a standard OpenFOAM {fv} (openfoam.com) case.  The simplest
route on Windows 10/11 is WSL2 (Windows Subsystem for Linux).

One-time setup
--------------
1. Open PowerShell as Administrator and run:
       wsl --install -d Ubuntu-24.04
   Reboot when asked, start "Ubuntu" from the Start menu, create a user.
2. In the Ubuntu window install OpenFOAM {fv} from openfoam.com:
       curl -s https://dl.openfoam.com/add-debian-repo.sh | sudo bash
       sudo apt-get update
       sudo apt-get install openfoam2412-default
3. (Optional) install ParaView for Windows from paraview.org to look at
   the results.

Each run
--------
1. Copy the case folder into your Linux home (much faster than running on
   C:\ through /mnt/c):
       cp -r /mnt/c/Users/<you>/Downloads/<case> ~/
       cd ~/<case>
2. Load OpenFOAM and run:
       openfoam2412            # opens a shell with OpenFOAM loaded
       ./Allrun                # or  ./Allrun 4   to use 4 CPU cores
   (If ./Allrun says "Permission denied":  chmod +x Allrun Allclean)
3. Results: results.txt (human readable) and results.json.  For pictures,
   open case.foam in ParaView (in Windows Explorer the WSL files are under
   \\wsl.localhost\Ubuntu-24.04\home\<you>\<case>).
4. ./Allclean removes the mesh and results so you can re-run.

Alternative without WSL: openfoam.com provides a native Windows build of
{fv} (cross-compiled with MinGW, installer from
https://www.openfoam.com/download/openfoam-installation-on-windows ); it
includes a bash shell in which ./Allrun works the same way.  WSL2 is the
better-tested route.

Expected run time on a 4-core PC: 2-D (axisymmetric sector) cases 1-5 min, 3-D cases
10-60 min depending on the mesh level.
""".replace("{fv}", FOAM_VERSION)


# --------------------------------------------------------------------------
# Case assembly
# --------------------------------------------------------------------------
def generate_case(design, out_dir, base_dir=None):
    """Write a complete OpenFOAM case for `design` into `out_dir`.
    Returns a summary dict of the derived settings."""
    base_dir = base_dir or os.getcwd()
    d = normalise(design, base_dir)
    g = d["geometry"]
    if g["kind"] in ("axisym", "3d"):
        g["profile"] = inlet_profile(g)
    exhaust = d["mode_kind"] == "exhaust"
    if g["kind"] == "stl" and exhaust:
        prepare_exhaust_geometry(g)
    elif g["kind"] == "stl":
        prepare_stl_geometry(g)
    elif g["kind"] == "3d":
        if g["mount"] == "free":
            # 3-D cases use the flange (plenum floor) arrangement; see NOTES
            g["mount_note"] = "3-D parametric cases are meshed as flange-mounted (inlet flush with a plenum wall)"
            g["mount"] = "flange"
        prepare_param3d_geometry(g)
    der = derive(d)
    is3d = g["kind"] in ("3d", "stl")
    # INTAKE_CFD_STAMP overrides the time stamp in the file headers (reproducible output for tests)
    stamp = os.environ.get("INTAKE_CFD_STAMP") or datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    os.makedirs(out_dir, exist_ok=True)
    cw = CaseWriter(out_dir, d["name"], stamp)
    lv = MESH_LEVELS[d["mesh_level"]]
    planes_info = []
    monitors = []
    conv_fields = []
    write_int = d["write_interval"] or 500
    if not is3d:
        W, minfo = build_axisym_mesh(d, der)
        # full circle / sector area: the sector's outer edges are straight chords, so its area is r^2 sin(a)/2 for the
        # sector angle a, not r^2 a/2 (0.13 % less at 5 deg); 2 pi / sin(a) instead of 360 / a keeps the bulk
        # velocity, K and Cd exact for the imposed full-circle mass flow
        der["flow_scale"] = 2.0 * math.pi / math.sin(math.radians(minfo["sector_deg"]))
        patches = {"atmosphere": "atmosphere", "outlet": "outlet", "inlet_wall": "wall", "tract_wall": "wall",
                   "extension_wall": "wall", "front": "cyclic", "back": "cyclic"}
        if minfo["free"]:
            patches["plenum_wall"] = "wall"
        prof = g["profile"]
        st = minfo["stations"]
        prov_mesh = [
            "geometry: %s" % prof.label,
            "tube D = %.3f mm, tract length (mouth plane -> tract end) = %.2f mm" % (g["D"] * 1e3, g["L"] * 1e3),
            "mount: %s%s" % (g["mount"], ", protrusion into the atmosphere %.2f mm (back wall at x = %.2f mm)" %
                             (minfo["protrusion"] * 1e3, minfo["protrusion"] * 1e3) if minfo["free"] else
                             " (inlet flush with a plane wall)"),
            "diameter change: %s" % ("to %.2f mm, cone half-angle %.1f deg, from x = %.1f mm" %
                                     (g["dc"]["D2"] * 1e3, math.degrees(g["dc"]["beta"]), g["dc"]["x0"] * 1e3)
                                     if g.get("dc") else "none"),
            "atmosphere region radius %.1f mm (= max(15 D, 8 x outer lip dia.)), total-pressure boundary" % (minfo["Rff"] * 1e3),
            "outlet extension %.1f D after the tract end so the outlet BC cannot affect the tract" % g["ext_D"],
            "2-D axisymmetric %.0f deg sector (no bend) -> blockMesh, %d cells; the sector's two sides are a rotational"
            % (minfo["sector_deg"], minfo["ncells"]),
            "  cyclic pair, not wedge patches (on wedge patches the Linux reference build gave developed pipe flow 1.25x"
            " the friction pressure drop; cfd/NOTES.md 4 (e))",
            "wall-resolved: first cell %.4g mm -> y+ ~ 1 at the estimated peak velocity %.1f m/s"
            % (minfo["h_wall"] * 1e3, der["U_peak"]),
            "body-fitted wall layer %.3f mm (0.15 R) on every wall, %d cells, grid lines wall-normal;"
            % (minfo["delta"] * 1e3, minfo["n_layer"]),
            "  'sharp' edges carry a machined-edge radius of %.3f mm (min(0.001 D, 0.05 mm))"
            % (_edge_radius(g) * 1e3),
            "mesh level '%s': %d cells across the tube radius, %d from mouth to far field" %
            (d["mesh_level"], minfo["n_r"], minfo["n_up"]),
            "stations (block faces): " + ", ".join("%s@%.2fmm" % (t, x * 1e3) for (x, t) in st)]
        cw.foam("system/blockMeshDict", "dictionary", "blockMeshDict", W.write(), prov_mesh)
        # planes: tract end + MAF + user planes
        topo = []
        for (x, tag) in st:
            names = []
            for t in tag.split("|"):
                if t == "tract_end":
                    names.append("tract_end")
                elif t.startswith("plane:"):
                    names.append(t[6:])
            for nm in names:
                r = tube_radius(g, min(x, g["L"]))
                eps = 1e-6 * g["D"]
                pt = (x + eps, 0.0, 0.0)
                nn = (1.0, 0.0, 0.0)
                # sampling keeps whole cells by their centres: the box must be
                # thicker than the cells along x, but stay inside the tube radially
                bmin, bmax = (x - 0.5 * g["D"], -1.01 * r, -1.01 * r), (x + 0.5 * g["D"], 1.01 * r, 1.01 * r)
                planes_info.append(dict(name=nm, point=[x, 0.0, 0.0], normal=[1.0, 0.0, 0.0],
                                        cut_point=list(pt), bmin=list(bmin), bmax=list(bmax),
                                        label="%.2fmm" % (x * 1e3), area_geometric_m2=math.pi * r * r,
                                        x_m=x, radius_m=r))
                topo.append("""    {
        name    %s;
        type    faceZoneSet;
        action  new;
        source  planeToFaceZone;
        point   %s;
        normal  (1 0 0);
        option  closest;
    }""" % (nm, _vec((x, 0.5 * r, 0.0))))
        cw.foam("system/topoSetDict", "dictionary", "topoSetDict", "actions\n(\n%s\n);\n" % "\n".join(topo),
                ["one faceZone per measurement plane (tract end, MAF, user planes) at the block faces",
                 "chosen by the generator; used for runtime static-pressure monitors"])
        for pl in planes_info:
            monitors.append(fo_zone("p_" + pl["name"], pl["name"], "areaAverage", ["p"]))
            monitors.append(fo_zone("mdot_" + pl["name"], pl["name"], "sum", ["phi"]))
        n_iter = d["max_iter"] or 6000
        # steep tapers give ~70 deg non-orthogonality at the cone start
        nonortho = 1 if (g["inlet"]["type"] == "taper" and g["inlet"]["alpha"] > math.radians(35)) else 0
        cells = minfo["ncells"]
        mesh_note = "2-D axisymmetric sector (rotational cyclic), %d cells" % cells
    elif exhaust:
        der["flow_scale"] = 1.0
        cells, mesh_note, prov_mesh = write_3d_mesh_exhaust(cw, d, der, g, lv)
        patches = {}
        for i in g["inlets"]:
            patches[i["name"]] = "exh_inlet"
        patches.update({"outlet": "exh_outlet", "tract_wall": "wall", "inlet_wall": "wall", "extension_wall": "wall"})
        for nm, (pp, nn, Ag, rr) in g["planes_exhaust"].items():
            # a tight box: the plane through one inlet face must not reach a neighbouring primary
            bmin, bmax = plane_bounds(pp, nn, (1.5 if Ag is None else 1.03) * rr, 0.12 * (2 * rr))
            planes_info.append(dict(name=nm, point=list(pp), normal=list(nn), cut_point=list(pp),
                                    bmin=list(bmin), bmax=list(bmax), label="3d", area_geometric_m2=Ag))
            monitors.append(fo_plane_sampled("p_" + nm, pp, nn, bmin, bmax, "areaAverage", ["p"]))
    else:
        der["flow_scale"] = 1.0
        cells, mesh_note, prov_mesh = write_3d_mesh(cw, d, der, g, lv)
        patches = {"atmosphere": "atmosphere", "outlet": "outlet", "tract_wall": "wall",
                   "extension_wall": "wall", "plenum_wall": "wall"}
        pe, te, Ae = g["tract_end"]
        rad_e = math.sqrt(Ae / math.pi)
        allpl = [("tract_end", pe, te, Ae)]
        for nm, (pp, nn) in g["planes_local"].items():
            allpl.append((nm, pp, nn, None))
        topo = []
        for (nm, pp, nn, Ag) in allpl:
            rr = rad_e if Ag is not None else 0.75 * g["Dref"]
            bmin, bmax = plane_bounds(pp, nn, 1.5 * rr if Ag is None else 1.05 * rr, 0.25 * g["Dref"])
            planes_info.append(dict(name=nm, point=list(pp), normal=list(nn), cut_point=list(pp),
                                    bmin=list(bmin), bmax=list(bmax), label="3d",
                                    area_geometric_m2=Ag))
            monitors.append(fo_plane_sampled("p_" + nm, pp, nn, bmin, bmax, "areaAverage", ["p"]))
        cw.foam("system/topoSetDict", "dictionary", "topoSetDict", "actions\n(\n);\n",
                ["3-D case: measurement planes are sampled cutting planes (no faceZones needed)"])
        n_iter = d["max_iter"] or 3000
        nonortho = 1
    if exhaust:
        cw.foam("system/topoSetDict", "dictionary", "topoSetDict", "actions\n(\n);\n",
                ["exhaust component: measurement planes are sampled cutting planes at the CAD inlet and outlet faces"])
        n_iter = d["max_iter"] or 3000
        nonortho = 1
        ref_plane = "exit"
    else:
        ref_plane = "tract_end"
    if not any(p["name"] == ref_plane for p in planes_info):
        raise DesignError("internal: %s plane missing" % ref_plane)
    # mass flow monitors
    monitors.insert(0, fo_patch_sum("mdot_outlet", "outlet"))
    if exhaust:
        for i in reversed(g["inlets"]):
            monitors.insert(0, fo_patch_sum("mdot_" + i["name"], i["name"]))
    else:
        monitors.insert(0, fo_patch_sum("mdot_atmosphere", "atmosphere"))
    monitors.append("""    yPlus
    {
        type            yPlus;
        libs            (fieldFunctionObjects);
        writeControl    writeTime;
    }
    residuals
    {
        type            solverInfo;
        libs            (utilityFunctionObjects);
        fields          (U p%s k omega);
        writeResidualFields no;
    }""" % (" h" if der["compressible"] else ""))
    sfields = ["p", "U"] + (["T", "rho"] if der["compressible"] else [])
    surf = surfaces_fo([(pl["name"], pl["cut_point"], pl["normal"], pl["bmin"], pl["bmax"]) for pl in planes_info],
                       sfields)
    # convergence stop: mass flow at the atmosphere and the tract-end pressure
    win = 300
    mref = der.get("mdot") or der.get("mdot_estimate")
    fs = der["flow_scale"]
    dpe = max(50.0, 0.5 * der["rho_amb"] * der["U_bulk"] ** 2)
    tol_m = 1e-5 * mref / fs / (1.0 if der["compressible"] else der["rho_amb"])
    tol_p = 2e-4 * dpe / (1.0 if der["compressible"] else der["rho_amb"])
    # Convergence stop: Allrun runs 'intake_report.py --watch', which applies
    # the report's own drift test (stricter limits) and requests a clean
    # stop (stopAt writeNow).  OpenFOAM's runTimeControl 'average' condition
    # was tested and found unreliable for this purpose.
    conv = ""
    control_dict(cw, d, der, monitors, surf, conv=conv, n_iter=n_iter, write_int=write_int)
    field_files(cw, d, der, patches)
    physics_files(cw, d, der)
    numerics_files(cw, d, der, is3d, monitors, nonortho)
    cw.foam("system/decomposeParDict", "dictionary", "decomposeParDict",
            "numberOfSubdomains 2;\n\nmethod          scotch;\n",
            ["numberOfSubdomains is overwritten by './Allrun N'"])
    # case_info.json for the report
    info = dict(name=d["name"], solver=der["solver"], compressible=der["compressible"], gamma=GAMMA, R_air=R_AIR,
                cp=CP_AIR, p_amb=der["p_amb"], T_amb=der["T_amb"], rho_amb=der["rho_amb"],
                flow_scale=der["flow_scale"], planes=planes_info, reference_plane=ref_plane,
                conv_window=win, ramp=RAMP_ITER, stop_mdot_rel=2e-4, stop_dp_rel=1e-3,
                mode=der["mode"], mdot_set=der.get("mdot"), p_out=der.get("p_out"),
                generator=VERSION, numerics=der["numerics"])
    if exhaust:
        info.update(kind="exhaust", inlets=[i["name"] for i in g["inlets"]], split=g["split"], T_gas=d["T_gas"],
                    A_in_total_m2=g["A_in_total"], inlet_areas_m2={i["name"]: i["A"] for i in g["inlets"]},
                    A_exit_m2=g["exit_face"][2])
    else:
        info["kind"] = "intake"
    cw.raw("case_info.json", json.dumps(info, indent=2))
    cw.text("intake_report.py", REPORT_PY.lstrip("\n"), prov=[
        "reads postProcessing/ and case_info.json (ambient p0/T0 = %.1f Pa / %.2f K, gamma %.4f)" %
        (der["p_amb"], der["T_amb"], GAMMA),
        "reference plane for K and Cd: tract_end (x = tube_length_mm, or the CAD outlet face)"],
        shebang="#!/usr/bin/env python3")
    cw.text("Allrun", allrun_text(der, is3d), prov=["mesh: %s" % mesh_note, "solver: %s" % der["solver"]],
            executable=True, shebang="#!/bin/bash")
    cw.text("Allclean", allclean_text(), prov=[], executable=True, shebang="#!/bin/bash")
    cw.text("README_WINDOWS.md", README_WINDOWS)
    summary = dict(
        name=d["name"], generator=VERSION, openfoam=FOAM_VERSION, out_dir=os.path.abspath(out_dir),
        mesh=mesh_note, cells=cells, solver=der["solver"], solver_reason=der["solver_why"],
        operating_point=der["op_source"], mode=der["mode"], mdot_kg_s=der.get("mdot"),
        pressure_ratio=der.get("PR"), M_bulk=der["M_bulk"], M_peak_est=der["M_peak"], U_bulk=der["U_bulk"],
        Re=der["Re"], f_colebrook=der["f_colebrook"], k_in=der["k_in"], omega_in=der["omega_in"],
        planes=[p["name"] for p in planes_info], files=sorted(cw.files))
    # derived floats are rounded to 12 significant digits: they pass through libm (pow, log10) and the
    # browser-side JavaScript writer must produce the same file byte for byte
    for k, v in summary.items():
        if isinstance(v, float):
            summary[k] = float("%.12g" % v)
    if g.get("mount_note"):
        summary["note"] = g["mount_note"]
    if exhaust:
        summary.update(kind="exhaust", inlets=[i["name"] for i in g["inlets"]], split=g["split"], T_gas_K=d["T_gas"],
                       inlet_diameters_mm={i["name"]: i["D"] * 1e3 for i in g["inlets"]}, exit_diameter_mm=g["Dref"] * 1e3)
    cw.raw("design_input.json", json.dumps(design, indent=2, default=str))
    cw.raw("generator_summary.json", json.dumps(summary, indent=2, default=str))
    return summary


# --------------------------------------------------------------------------
# 3-D meshing dictionaries
# --------------------------------------------------------------------------
def write_3d_mesh(cw, d, der, g, lv):
    tris = g["tris"]
    loop = g["mouth_loop"]
    Dm = g["D_mouth"]
    Dref = g["Dref"]
    bb0, bb1 = g["bbox"]
    # plenum: x in [-Xp, 0], lateral half-size B
    Xp = max(5.0 * Dm, 4.0 * Dref)
    B = max(5.0 * Dm, 4.0 * Dref)
    lo = [-Xp, min(-B, bb0[1] - 0.5 * Dref), min(-B, bb0[2] - 0.5 * Dref)]
    hi = [bb1[0] + 0.5 * Dref, max(B, bb1[1] + 0.5 * Dref), max(B, bb1[2] + 0.5 * Dref)]
    h0 = Dref / lv["bg3d"]
    level = int(d["mesh_overrides"].get("level3d", lv["level3d"]))
    nx = [max(4, int(math.ceil((hi[i] - lo[i]) / h0))) for i in range(3)]
    for i in range(3):
        hi[i] = lo[i] + nx[i] * h0
    Rfloor = 1.6 * math.sqrt(max(lo[1] ** 2, hi[1] ** 2) + max(lo[2] ** 2, hi[2] ** 2))
    floor = floor_surface(loop, Rfloor)
    tri_dir = os.path.join(cw.root, "constant", "triSurface")
    os.makedirs(tri_dir, exist_ok=True)
    write_stl_ascii(os.path.join(tri_dir, "domain.stl"),
                    [("tract_wall", tris["wall"]), ("extension_wall", tris["ext"]),
                     ("outlet", tris["outlet"]), ("plenum_wall", floor)])
    write_stl_ascii(os.path.join(tri_dir, "tract_closed.stl"),
                    [("closed", tris["wall"] + tris["ext"] + tris["outlet"] + tris["mouth"])])
    cw.files += ["constant/triSurface/domain.stl", "constant/triSurface/tract_closed.stl"]
    hcell = h0 / 2 ** level
    # wall-function layers: first layer from y+ target, total ~0.6 of the wall cell
    t1 = der["h_wall_wf"]
    er = 1.2
    nl = 1
    while nl < 8 and t1 * (er ** nl - 1) / (er - 1) < 0.6 * hcell:
        nl += 1
    if t1 > 0.6 * hcell:
        t1 = 0.4 * hcell
        nl = 2
    yplus_est = 0.5 * t1 * der["u_tau"] / der["nu_s"]
    loc = (-0.5 * Xp + 0.0123 * h0, 0.4 * B + 0.0371 * h0, 0.3 * B + 0.0217 * h0)
    bm = """scale 1;

vertices
(
    %s
    %s
    %s
    %s
    %s
    %s
    %s
    %s
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (%d %d %d) simpleGrading (1 1 1)
);

boundary
(
    atmosphere
    {
        type patch;
        faces
        (
            (0 4 7 3)
            (1 2 6 5)
            (0 1 5 4)
            (3 7 6 2)
            (0 3 2 1)
            (4 5 6 7)
        );
    }
);
""" % tuple([_vec(p) for p in [(lo[0], lo[1], lo[2]), (hi[0], lo[1], lo[2]), (hi[0], hi[1], lo[2]),
                                  (lo[0], hi[1], lo[2]), (lo[0], lo[1], hi[2]), (hi[0], lo[1], hi[2]),
                                  (hi[0], hi[1], hi[2]), (lo[0], hi[1], hi[2])]] + nx)
    prov = ["background box: plenum %.1f mm upstream of the mouth (max(5 D_mouth, 4 D)), lateral +/- %.1f mm,"
            % (Xp * 1e3, B * 1e3),
            "  plus the tract bounding box; base cell %.2f mm = D/%g (D = %.2f mm)" % (h0 * 1e3, lv["bg3d"], Dref * 1e3),
            "only the plenum part (upstream of the plenum floor plane x=0) stays in the mesh;",
            "its outer faces form the 'atmosphere' total-pressure boundary"]
    cw.foam("system/blockMeshDict", "dictionary", "blockMeshDict", bm, prov)
    sfe = """domain.stl
{
    extractionMethod    extractFromSurface;
    extractFromSurfaceCoeffs
    {
        includedAngle   150;
    }
    subsetFeatures
    {
        nonManifoldEdges    no;
        openEdges           yes;
    }
    writeObj            no;
}
"""
    cw.foam("system/surfaceFeatureExtractDict", "dictionary", "surfaceFeatureExtractDict", sfe,
            ["feature edges (lip, mouth, outlet rim) for snapping: includedAngle 150 deg"])
    shm = """castellatedMesh true;
snap            true;
addLayers       true;

geometry
{
    domain.stl
    {
        type    triSurfaceMesh;
        name    domain;
        regions
        {
            tract_wall      { name tract_wall; }
            extension_wall  { name extension_wall; }
            outlet          { name outlet; }
            plenum_wall     { name plenum_wall; }
        }
    }
    tract_closed.stl
    {
        type    triSurfaceMesh;
        name    tractClosed;
    }
    mouthRegion
    {
        type    searchableSphere;
        centre  (0 0 0);
        radius  %(rmouth)s;
    }
}

castellatedMeshControls
{
    maxLocalCells       2000000;
    maxGlobalCells      8000000;
    minRefinementCells  0;
    maxLoadUnbalance    0.10;
    nCellsBetweenLevels 3;
    features
    (
        {
            file    "domain.eMesh";
            level   %(lf)d;
        }
    );
    refinementSurfaces
    {
        domain
        {
            level   (%(l)d %(l1)d);
            regions
            {
                tract_wall      { level (%(l)d %(l1)d); patchInfo { type wall; inGroups (wall); } }
                extension_wall  { level (%(l)d %(l)d); patchInfo { type wall; inGroups (wall); } }
                outlet          { level (%(l)d %(l)d); patchInfo { type patch; } }
                plenum_wall     { level (%(lm)d %(lm)d); patchInfo { type wall; inGroups (wall); } }
            }
        }
    }
    resolveFeatureAngle 30;
    refinementRegions
    {
        tractClosed
        {
            mode    inside;
            levels  ((1e15 %(l)d));
        }
        mouthRegion
        {
            mode    inside;
            levels  ((1e15 %(l)d));
        }
    }
    locationInMesh %(loc)s;
    allowFreeStandingZoneFaces true;
}

snapControls
{
    nSmoothPatch    3;
    tolerance       2.0;
    nSolveIter      100;
    nRelaxIter      5;
    nFeatureSnapIter 10;
    implicitFeatureSnap false;
    explicitFeatureSnap true;
    multiRegionFeatureSnap true;
}

addLayersControls
{
    relativeSizes       false;
    layers
    {
        "(tract_wall|extension_wall)"
        {
            nSurfaceLayers %(nl)d;
        }
    }
    expansionRatio      %(er)g;
    firstLayerThickness %(t1)s;
    minThickness        %(tmin)s;
    nGrow               0;
    featureAngle        120;
    slipFeatureAngle    30;
    nRelaxIter          5;
    nSmoothSurfaceNormals 1;
    nSmoothNormals      3;
    nSmoothThickness    10;
    maxFaceThicknessRatio 0.5;
    maxThicknessToMedialRatio 0.3;
    minMedialAxisAngle  90;
    nBufferCellsNoExtrude 0;
    nLayerIter          50;
}

meshQualityControls
{
    #includeEtc "caseDicts/mesh/generation/meshQualityDict.cfg"
}

mergeTolerance 1e-6;
""" % dict(rmouth=_fmt(1.0 * Dm), lf=level + 1, l=level, l1=level + 1, lm=max(level - 1, 0),
                loc=_vec(loc), nl=nl, er=er, t1=_fmt(t1), tmin=_fmt(0.3 * t1))
    cw.foam("system/snappyHexMeshDict", "dictionary", "snappyHexMeshDict", shm, [
        "tract walls refined to level %d-%d (cell %.3f mm = D/%d), whole tract interior level %d," %
        (level, level + 1, hcell * 1e3, int(round(Dref / hcell)), level),
        "mouth region (sphere radius = mouth dia. %.1f mm) level %d, feature edges level %d" % (Dm * 1e3, level, level + 1),
        "wall-function layers: %d layers, first %.4g mm, expansion %.2f -> first-cell y+ ~ %.0f at bulk"
        " velocity %.1f m/s (target 30-100; nutUSpaldingWallFunction tolerates lower)" %
        (nl, t1 * 1e3, er, yplus_est, der["U_bulk"]),
        "locationInMesh is inside the plenum (atmosphere side of the floor)"])
    cw.foam("system/meshQualityDict", "dictionary", "meshQualityDict",
            '#includeEtc "caseDicts/mesh/generation/meshQualityDict.cfg"\n', ["standard snappyHexMesh quality limits"])
    est = int(nx[0] * nx[1] * nx[2] * 0.3 + math.pi * (Dref / 2) ** 2 * (bb1[0] - bb0[0] + 2 * Dref) / hcell ** 3 * 1.5)
    note = "3-D snappyHexMesh, roughly %d cells (estimate)" % est
    return est, note, prov


def write_3d_mesh_exhaust(cw, d, der, g, lv):
    """snappyHexMesh case for an exhaust component: no plenum, the background
    box is the part's bounding box, inlets and outlet are STL regions."""
    tris = g["tris"]
    Dref = g["Dref"]
    bb0, bb1 = g["bbox"]
    h0 = Dref / lv["bg3d"]
    level = int(d["mesh_overrides"].get("level3d", lv["level3d"]))
    lo = [bb0[i] - 0.75 * Dref for i in range(3)]
    hi = [bb1[i] + 0.75 * Dref for i in range(3)]
    nx = [max(4, int(math.ceil((hi[i] - lo[i]) / h0))) for i in range(3)]
    for i in range(3):
        hi[i] = lo[i] + nx[i] * h0
    tri_dir = os.path.join(cw.root, "constant", "triSurface")
    os.makedirs(tri_dir, exist_ok=True)
    regions = [("tract_wall", tris["wall"]), ("inlet_wall", tris["inlet_ext"]), ("extension_wall", tris["ext"]),
               ("outlet", tris["outlet"])]
    for nm, cap in tris["inlet_caps"].items():
        regions.append((nm, cap))
    write_stl_ascii(os.path.join(tri_dir, "domain.stl"), regions)
    closed = tris["wall"] + tris["inlet_ext"] + tris["ext"] + tris["outlet"] + [t for c in tris["inlet_caps"].values() for t in c]
    write_stl_ascii(os.path.join(tri_dir, "tract_closed.stl"), [("closed", closed)])
    cw.files += ["constant/triSurface/domain.stl", "constant/triSurface/tract_closed.stl"]
    hcell = h0 / 2 ** level
    t1 = der["h_wall_wf"]
    er = 1.2
    nl = 1
    while nl < 8 and t1 * (er ** nl - 1) / (er - 1) < 0.6 * hcell:
        nl += 1
    if t1 > 0.6 * hcell:
        t1 = 0.4 * hcell
        nl = 2
    yplus_est = 0.5 * t1 * der["u_tau"] / der["nu_s"]
    loc = g["loc_in_mesh"]
    bm = """scale 1;

vertices
(
    %s
    %s
    %s
    %s
    %s
    %s
    %s
    %s
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (%d %d %d) simpleGrading (1 1 1)
);

boundary
(
    background
    {
        type patch;
        faces
        (
            (0 4 7 3)
            (1 2 6 5)
            (0 1 5 4)
            (3 7 6 2)
            (0 3 2 1)
            (4 5 6 7)
        );
    }
);
""" % tuple([_vec(p) for p in [(lo[0], lo[1], lo[2]), (hi[0], lo[1], lo[2]), (hi[0], hi[1], lo[2]),
                                  (lo[0], hi[1], lo[2]), (lo[0], lo[1], hi[2]), (hi[0], lo[1], hi[2]),
                                  (hi[0], hi[1], hi[2]), (lo[0], hi[1], hi[2])]] + nx)
    prov = ["background box: the part's bounding box plus 0.75 D (D = outlet dia. %.2f mm); base cell %.2f mm = D/%g"
            % (Dref * 1e3, h0 * 1e3, lv["bg3d"]),
            "the box is discarded by snappyHexMesh except the part's interior (locationInMesh inside the outlet extension)",
            "inlets %s extruded upstream by %.1f D each; outlet extruded by %.1f D"
            % (", ".join(i["name"] for i in g["inlets"]), g["ext_in_D"], g["ext_D"])]
    cw.foam("system/blockMeshDict", "dictionary", "blockMeshDict", bm, prov)
    sfe = """domain.stl
{
    extractionMethod    extractFromSurface;
    extractFromSurfaceCoeffs
    {
        includedAngle   150;
    }
    subsetFeatures
    {
        nonManifoldEdges    no;
        openEdges           yes;
    }
    writeObj            no;
}
"""
    cw.foam("system/surfaceFeatureExtractDict", "dictionary", "surfaceFeatureExtractDict", sfe,
            ["feature edges (merge seams, steps, inlet and outlet rims) for snapping: includedAngle 150 deg"])
    reg_lines = ["            tract_wall      { name tract_wall; }", "            inlet_wall      { name inlet_wall; }",
                 "            extension_wall  { name extension_wall; }", "            outlet          { name outlet; }"]
    ref_lines = ["                tract_wall      { level (%(l)d %(l1)d); patchInfo { type wall; inGroups (wall); } }",
                 "                inlet_wall      { level (%(l)d %(l)d); patchInfo { type wall; inGroups (wall); } }",
                 "                extension_wall  { level (%(l)d %(l)d); patchInfo { type wall; inGroups (wall); } }",
                 "                outlet          { level (%(l)d %(l)d); patchInfo { type patch; } }"]
    for i in g["inlets"]:
        reg_lines.append("            %-15s { name %s; }" % (i["name"], i["name"]))
        ref_lines.append("                %-15s { level (%%(l)d %%(l)d); patchInfo { type patch; } }" % i["name"])
    shm = """castellatedMesh true;
snap            true;
addLayers       true;

geometry
{
    domain.stl
    {
        type    triSurfaceMesh;
        name    domain;
        regions
        {
%(regs)s
        }
    }
    tract_closed.stl
    {
        type    triSurfaceMesh;
        name    tractClosed;
    }
}

castellatedMeshControls
{
    maxLocalCells       2000000;
    maxGlobalCells      8000000;
    minRefinementCells  0;
    maxLoadUnbalance    0.10;
    nCellsBetweenLevels 3;
    features
    (
        {
            file    "domain.eMesh";
            level   %(lf)d;
        }
    );
    refinementSurfaces
    {
        domain
        {
            level   (%(l)d %(l1)d);
            regions
            {
%(refs)s
            }
        }
    }
    resolveFeatureAngle 30;
    refinementRegions
    {
        tractClosed
        {
            mode    inside;
            levels  ((1e15 %(l)d));
        }
    }
    locationInMesh %(loc)s;
    allowFreeStandingZoneFaces true;
}

snapControls
{
    nSmoothPatch    3;
    tolerance       2.0;
    nSolveIter      100;
    nRelaxIter      5;
    nFeatureSnapIter 10;
    implicitFeatureSnap false;
    explicitFeatureSnap true;
    multiRegionFeatureSnap true;
}

addLayersControls
{
    relativeSizes       false;
    layers
    {
        "(tract_wall|inlet_wall|extension_wall)"
        {
            nSurfaceLayers %(nl)d;
        }
    }
    expansionRatio      %(er)g;
    firstLayerThickness %(t1)s;
    minThickness        %(tmin)s;
    nGrow               0;
    featureAngle        120;
    slipFeatureAngle    30;
    nRelaxIter          5;
    nSmoothSurfaceNormals 1;
    nSmoothNormals      3;
    nSmoothThickness    10;
    maxFaceThicknessRatio 0.5;
    maxThicknessToMedialRatio 0.3;
    minMedialAxisAngle  90;
    nBufferCellsNoExtrude 0;
    nLayerIter          50;
}

meshQualityControls
{
    #includeEtc "caseDicts/mesh/generation/meshQualityDict.cfg"
}

mergeTolerance 1e-6;
""" % dict(regs="\n".join(reg_lines), refs="\n".join(ref_lines) % dict(l=level, l1=level + 1),
           lf=level + 1, l=level, l1=level + 1, loc=_vec(loc), nl=nl, er=er, t1=_fmt(t1), tmin=_fmt(0.3 * t1))
    cw.foam("system/snappyHexMeshDict", "dictionary", "snappyHexMeshDict", shm, [
        "walls refined to level %d-%d (cell %.3f mm = D/%d), whole interior level %d, feature edges level %d" %
        (level, level + 1, hcell * 1e3, int(round(Dref / hcell)), level, level + 1),
        "wall-function layers: %d layers, first %.4g mm, expansion %.2f -> first-cell y+ ~ %.0f at bulk"
        " velocity %.1f m/s (target 30-100; nutUSpaldingWallFunction tolerates lower)" %
        (nl, t1 * 1e3, er, yplus_est, der["U_bulk"]),
        "locationInMesh is inside the outlet extension"])
    cw.foam("system/meshQualityDict", "dictionary", "meshQualityDict",
            '#includeEtc "caseDicts/mesh/generation/meshQualityDict.cfg"\n', ["standard snappyHexMesh quality limits"])
    vol = abs(sum(v_dot(t[0], v_cross(t[1], t[2])) for t in closed)) / 6.0   # the closed surface's volume
    est = int(vol / hcell ** 3 * 1.3) if vol > 0 else nx[0] * nx[1] * nx[2]
    note = "3-D snappyHexMesh (exhaust component), roughly %d cells (estimate)" % est
    return est, note, prov


# --------------------------------------------------------------------------
# Command line
# --------------------------------------------------------------------------
EXAMPLE = {
    "name": "velocity_stack_example",
    "geometry": {
        "tube_diameter_mm": 45.0,
        "tube_length_mm": 200.0,
        "inlet": {"type": "ellipse", "length_mm": 45, "entry_diameter_mm": 90,
                  "exit_diameter_mm": 45, "corner_radius_mm": 4},
        "mount": {"type": "free", "protrusion_mm": 45},
        "maf_plane_mm": 150,
        "outlet_extension_D": 4
    },
    "operating_point": {"engine": {"displacement_cc": 600, "rpm": 12000, "ve": 1.0, "strokes": 4,
                                   "cylinders": 4, "cylinders_fed": 1}},
    "ambient": {"p_pa": 101325, "T_c": 25},
    "mesh": {"level": "medium"}
}


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__)
        return 0
    if argv[0] == "--example":
        print(json.dumps(EXAMPLE, indent=2))
        return 0
    if len(argv) != 2:
        print("usage: intake_cfd.py design.json out_case_dir")
        return 2
    with open(argv[0]) as f:
        design = json.load(f)
    try:
        s = generate_case(design, argv[1], base_dir=os.path.dirname(os.path.abspath(argv[0])))
    except DesignError as e:
        print("DESIGN ERROR: %s" % e)
        return 1
    print(json.dumps({k: v for k, v in s.items() if k != "files"}, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
