#!/usr/bin/env python3
"""The 3-D case generator in Rust (rust/et_host/src/cfd_gen.rs, what the program runs) against intake_cfd.py's
generate_case, byte for byte: every file of the case, its executable bits, and what each prints (the summary, or the
DESIGN ERROR line), for 3-D intake tracts (bends, every inlet type, a diameter change, sampled planes, each operating
point and solver), intakes from a CAD STL, and exhaust components from an STL with one or two inlets.

    python3 cfd/gen_rs_vs_py.py [path to exhaust-tuner-host]

Needs Python 3.12 or later (sum() of floats with Neumaier's compensation, as the Rust does)."""
import copy, json, math, os, shutil, stat, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "validation"))
import intake_cfd as ic  # noqa: E402

if sys.version_info < (3, 12):
    print("TEST SKIPPED: gen_rs_vs_py: Python %d.%d adds sums without compensation; needs 3.12 or later" % sys.version_info[:2])
    sys.exit(0)
host = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "rust", "target", "release",
                                                          "exhaust-tuner-host" + (".exe" if os.name == "nt" else ""))
if not os.path.isfile(host):
    print("TEST SKIPPED: gen_rs_vs_py: host program not built (%s)" % host)
    sys.exit(0)
host = os.path.abspath(host)
tmp = tempfile.mkdtemp(prefix="gen_rs_vs_py_")
STAMP = "2026-01-01 00:00"


# ------------------------------------------------------------------------- inputs
def tube_stl(path, segs, nphi=48, shift=(0.0, 0.0, 0.0), names=("inlet", "outlet", "wall")):
    """A round tube as STL regions (mm), as validation/run_validation.py's tube_stl builds it."""
    P = ic.Path3D()
    rings = [(0.0, segs[0][2])]
    s = 0.0
    for sg in segs:
        if sg[0] == "line":
            _, L, R0, R1 = sg
            if abs(R0 - rings[-1][1]) > 1e-9:
                rings.append((s, R0))
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
    mv = lambda p: (p[0] + shift[0], p[1] + shift[1], p[2] + shift[2])
    pts = []
    for (sv, R) in rings:
        p, t, n1, n2 = P.frame(sv)
        pts.append([mv(ic.v_add(p, ic.v_add(ic.v_mul(n1, R * math.cos(2 * math.pi * j / nphi)),
                                            ic.v_mul(n2, R * math.sin(2 * math.pi * j / nphi))))) for j in range(nphi)])
    wall = []
    for k in range(len(pts) - 1):
        A, B = pts[k], pts[k + 1]
        for j in range(nphi):
            j1 = (j + 1) % nphi
            wall.append((A[j], A[j1], B[j1])); wall.append((A[j], B[j1], B[j]))
    p0 = mv(P.frame(0.0)[0])
    inlet = [(p0, pts[0][(j + 1) % nphi], pts[0][j]) for j in range(nphi)]
    pe = mv(P.frame(s)[0])
    outlet = [(pe, pts[-1][j], pts[-1][(j + 1) % nphi]) for j in range(nphi)]
    return [(names[0], inlet), (names[1], outlet), (names[2], wall)]


def write_binary_stl(path, tris):
    import struct
    with open(path, "wb") as f:
        f.write(b"binary stl from gen_rs_vs_py".ljust(80, b"\0"))
        f.write(struct.pack("<I", len(tris)))
        for t in tris:
            f.write(struct.pack("<12fH", 0, 0, 0, *t[0], *t[1], *t[2], 0))


inp = os.path.join(tmp, "inputs")
os.makedirs(inp)
# the CAD intake tract (tests/make_stl_test.py writes it next to itself)
os.makedirs(os.path.join(inp, "tests"))
shutil.copy(os.path.join(HERE, "tests", "make_stl_test.py"), os.path.join(inp, "tests"))
shutil.copy(os.path.join(HERE, "intake_cfd.py"), inp)
subprocess.run([sys.executable, os.path.join(inp, "tests", "make_stl_test.py")], check=True, capture_output=True)
shutil.move(os.path.join(inp, "tests", "cad_tract_mm.stl"), os.path.join(inp, "cad_tract_mm.stl"))
stl_design = json.load(open(os.path.join(HERE, "tests", "stl_straight.json")))
# exhaust: a sudden expansion 50 -> 100 mm, and two pipes into one (inlet1, inlet2)
ic.write_stl_ascii(os.path.join(inp, "expansion.stl"), tube_stl(None, [("line", 50.0, 25.0, 25.0), ("line", 600.0, 50.0, 50.0)]))
a = tube_stl(None, [("line", 300.0, 25.0, 25.0)], names=("inlet1", "outlet", "wall"))
b = tube_stl(None, [("line", 200.0, 20.0, 20.0)], shift=(100.0, 0.0, 0.0), names=("inlet2", "x", "wall2"))
ic.write_stl_ascii(os.path.join(inp, "two_inlets.stl"), a + [b[0], b[2]])
# the same tract as files per role, binary
reg = dict((n, t) for n, t in tube_stl(None, [("line", 50.0, 25.0, 25.0), ("line", 600.0, 50.0, 50.0)]))
for role in reg:
    write_binary_stl(os.path.join(inp, "bin_%s.stl" % role), reg[role])

bend = json.load(open(os.path.join(HERE, "tests", "bend.json")))
exh = {"name": "expansion_50_100", "mode": "exhaust",
       "geometry": {"stl": "expansion.stl", "stl_units": "mm", "inlet_extension_D": 2, "outlet_extension_D": 2},
       "operating_point": {"mass_flow_kg_s": 0.075}, "gas": {"T_c": 650}, "ambient": {"p_pa": 101325, "T_c": 25},
       "mesh": {"level": "medium"}}


def with_(base, **kw):
    d = copy.deepcopy(base)
    for path, v in kw.items():
        node = d
        keys = path.split("__")
        for k in keys[:-1]:
            node = node.setdefault(k, {})
        if v is None:
            node.pop(keys[-1], None)
        else:
            node[keys[-1]] = v
    return d


# a bellmouth as a CAD reader would measure it (mm, x from the mouth plane, r falling to the 50 mm bore)
PROFILE_PTS = [[0.0, 45.0], [0.2, 41.0], [1.0, 37.0], [3.0, 33.0], [6.0, 30.0], [10.0, 28.0], [16.0, 26.5], [24.0, 25.6], [32.0, 25.1], [40.0, 25.0]]
DESIGNS = [
    ("bend, radius inlet, flange", bend),
    ("bend, free mount", with_(bend, geometry__mount={"type": "free"})),
    ("bend, plain inlet", with_(bend, geometry__inlet={"type": "plain"})),
    ("bend, ellipse inlet", with_(bend, geometry__inlet={"type": "ellipse", "length_mm": 40, "entry_diameter_mm": 90, "exit_diameter_mm": 50})),
    ("bend, taper inlet", with_(bend, geometry__inlet={"type": "taper", "entry_diameter_mm": 80, "wall_half_angle_deg": 10, "lip_radius_mm": 5})),
    ("bend, steep taper", with_(bend, geometry__inlet={"type": "taper", "entry_diameter_mm": 70, "wall_half_angle_deg": 50, "lip_radius_mm": 4})),
    ("two bends out of plane, diameter change", with_(bend, geometry__bend=[{"clr_mm": 75, "angle_deg": 45, "start_mm": 100},
                                                                            {"clr_mm": 100, "angle_deg": 60, "start_mm": 220, "plane_deg": 90}],
                                                      geometry__tube_length_mm=500,
                                                      geometry__diameter_change={"to_diameter_mm": 60, "cone_half_angle_deg": 7, "start_mm": 380},
                                                      geometry__planes_mm={"mid plane": 200, "9x": 450})),
    ("bend, mass flow, incompressible forced", with_(bend, operating_point={"mass_flow_kg_s": 0.05}, solver={"force": "incompressible"})),
    ("bend, pressure ratio", with_(bend, operating_point={"pressure_ratio": 1.02}, solver={"max_iterations": 1500, "write_interval": 100})),
    ("bend, pressure ratio, incompressible", with_(bend, operating_point={"pressure_ratio": 1.005}, solver={"force": "incompressible"})),
    ("bend, fine, level3d, turbulence, hot day", with_(bend, mesh={"level": "fine", "level3d": 2}, turbulence={"intensity": 0.05, "viscosity_ratio": 10},
                                                       ambient={"p_pa": 85000, "T_k": 310.5})),
    ("bend, low flow (incompressible by Mach)", with_(bend, operating_point={"engine": {"displacement_l": 0.6, "rpm": 3000, "ve": 85, "cylinders": 2, "cylinders_fed": 1}})),
    ("non-ASCII names, string numbers", with_(bend, name="café “bend”", geometry__planes_mm={"café²": "200", "Ωmega 2": 250.5, "_x": 90},
                                               geometry__tube_diameter_mm="50", operating_point={"mass_flow_kg_s": "0.06"})),
    ("force_3d straight tube", with_(bend, geometry__bend=None, geometry__force_3d=True)),
    ("intake STL from CAD", stl_design),
    ("intake STL, coarse, PR", with_(stl_design, mesh={"level": "coarse"}, operating_point={"pressure_ratio": 1.01})),
    ("exhaust expansion", exh),
    ("exhaust expansion, engine and AFR, a plane", with_(exh, operating_point={"engine": {"displacement_cc": 1600, "rpm": 7000, "ve": 0.95, "cylinders": 4}},
                                                         gas={"T_k": 900, "afr": 13.2},
                                                         geometry__planes={"mid": {"point_mm": [0, 0, 300], "normal": [0, 0, 1]}})),
    ("exhaust, two inlets, even split", with_(exh, geometry__stl="two_inlets.stl", name="merge")),
    ("exhaust, two inlets, split given", with_(exh, geometry__stl="two_inlets.stl", operating_point={"mass_flow_kg_s": 0.1, "inlet_split": {"inlet2": 1, "inlet1": 3}})),
    ("exhaust, binary STL files per role", with_(exh, geometry__stl={"inlet": "bin_inlet.stl", "outlet": "bin_outlet.stl", "wall": "bin_wall.stl"}, mesh={"level": "coarse"})),
    # free-standing mouth in 3-D (mount free given), cone lists, measured mouth profiles
    ("bend, free mount, plain 2 mm wall, protrusion 40", with_(bend, geometry__mount={"type": "free", "protrusion_mm": 40},
                                                             geometry__inlet={"type": "plain", "wall_thickness_mm": 2.0})),
    ("force_3d, free mount, plain 1 mm wall (finest lip level)", with_(bend, geometry__bend=None, geometry__force_3d=True, mesh={"level": "medium"},
                                                                       geometry__mount={"type": "free", "protrusion_mm": 25},
                                                                       geometry__inlet={"type": "plain", "wall_thickness_mm": 1.0})),
    ("bend, free mount, ellipse sharp rim", with_(bend, geometry__mount={"type": "free", "protrusion_mm": 60},
                                                  geometry__inlet={"type": "ellipse", "length_mm": 40, "entry_diameter_mm": 90, "exit_diameter_mm": 50})),
    ("bend, free mount, ellipse rounded rim, default protrusion", with_(bend, geometry__mount={"type": "free"},
                                                  geometry__inlet={"type": "ellipse", "length_mm": 30, "entry_diameter_mm": 80, "exit_diameter_mm": 50, "corner_radius_mm": 3})),
    ("bend, free mount, taper", with_(bend, geometry__mount={"type": "free", "protrusion_mm": 70},
                                      geometry__inlet={"type": "taper", "entry_diameter_mm": 80, "wall_half_angle_deg": 10, "lip_radius_mm": 5})),
    ("mount absent: flange as before", with_(bend, geometry__mount=None)),
    ("two diameter changes: reducer mid-run, cone at the end", with_(bend, geometry__tube_length_mm=600,
                                                  geometry__diameter_change=[{"to_diameter_mm": 44, "cone_half_angle_deg": 5, "start_mm": 300},
                                                                             {"to_diameter_mm": 56, "cone_half_angle_deg": 6, "start_mm": 450}],
                                                  geometry__planes_mm={"reducer_out": 380, "throttle": 560})),
    ("diameter change as a one-item list", with_(bend, geometry__tube_length_mm=500,
                                                 geometry__diameter_change=[{"to_diameter_mm": 60, "cone_half_angle_deg": 7, "start_mm": 380}])),
    ("free mount and two diameter changes", with_(bend, geometry__tube_length_mm=600, geometry__mount={"type": "free", "protrusion_mm": 50},
                                                  geometry__diameter_change=[{"to_diameter_mm": 44, "cone_half_angle_deg": 5, "start_mm": 300},
                                                                             {"to_diameter_mm": 56, "cone_half_angle_deg": 6, "start_mm": 450}])),
    ("bend, measured mouth profile", with_(bend, geometry__inlet={"type": "profile", "points_mm": PROFILE_PTS})),
    ("bend, measured mouth profile, free mount", with_(bend, geometry__mount={"type": "free", "protrusion_mm": 60},
                                                       geometry__inlet={"type": "profile", "points_mm": PROFILE_PTS, "rim_thickness_mm": 2.5})),
    ("cone on a bend (92.6 -> 105 mm over a 60 deg bend, 127 mm clr)", with_(bend, geometry__tube_diameter_mm=92.6, geometry__tube_length_mm=600,
                                                  geometry__inlet={"type": "plain", "wall_thickness_mm": 4.76}, geometry__mount={"type": "flange"},
                                                  geometry__bend={"clr_mm": 127, "angle_deg": 60, "start_mm": 200, "plane_deg": 0},
                                                  geometry__diameter_change={"to_diameter_mm": 105.0, "cone_half_angle_deg": 2.669117, "start_mm": 200},
                                                  geometry__planes_mm={"bend_in": 190, "bend_out": 345}, operating_point={"mass_flow_kg_s": 0.3694})),
    ("reducer, then a cone half on a bend, free mount", with_(bend, geometry__tube_length_mm=600, geometry__mount={"type": "free", "protrusion_mm": 50},
                                                  geometry__diameter_change=[{"to_diameter_mm": 44, "cone_half_angle_deg": 5, "start_mm": 80},
                                                                             {"to_diameter_mm": 52, "cone_half_angle_deg": 4, "start_mm": 200}])),
    ("error: second diameter change past the tract end", with_(bend, geometry__tube_length_mm=500,
                                                  geometry__diameter_change=[{"to_diameter_mm": 44, "cone_half_angle_deg": 5, "start_mm": 300},
                                                                             {"to_diameter_mm": 80, "cone_half_angle_deg": 3, "start_mm": 400}])),
    ("force_3d, free mount, 2 mm lip (the lip sets the refinement)", with_(bend, geometry__bend=None, geometry__force_3d=True, mesh={"level": "medium"},
                                                                      geometry__mount={"type": "free", "protrusion_mm": 25},
                                                                      geometry__inlet={"type": "radius", "lip_radius_mm": 2.0})),
    ("bend, free mount, ellipse rounded rim 1 mm", with_(bend, geometry__mount={"type": "free", "protrusion_mm": 40},
                                                     geometry__inlet={"type": "ellipse", "length_mm": 30, "entry_diameter_mm": 80, "exit_diameter_mm": 50, "corner_radius_mm": 1})),
    ("error: free mount, lip radius too small", with_(bend, geometry__mount={"type": "free", "protrusion_mm": 40},
                                                      geometry__inlet={"type": "radius", "lip_radius_mm": 0.5})),
    ("error: free mount past the bend", with_(bend, geometry__mount={"type": "free", "protrusion_mm": 120})),
    ("error: free mount, wall too thin", with_(bend, geometry__mount={"type": "free", "protrusion_mm": 40},
                                               geometry__inlet={"type": "plain", "wall_thickness_mm": 0.2})),
    ("error: free mount, tube comes back", with_(bend, geometry__mount={"type": "free", "protrusion_mm": 60}, geometry__tube_length_mm=900,
                                                 geometry__bend={"clr_mm": 100, "angle_deg": 180, "start_mm": 80})),
    ("error: diameter changes overlap", with_(bend, geometry__tube_length_mm=600,
                                              geometry__diameter_change=[{"to_diameter_mm": 44, "cone_half_angle_deg": 5, "start_mm": 300},
                                                                         {"to_diameter_mm": 56, "cone_half_angle_deg": 6, "start_mm": 320}])),
    ("error: profile not from the mouth plane", with_(bend, geometry__inlet={"type": "profile", "points_mm": [[1.0, 40.0], [5.0, 30.0], [20.0, 25.0]]})),
    ("error: profile not ending at the bore", with_(bend, geometry__inlet={"type": "profile", "points_mm": [[0.0, 40.0], [5.0, 30.0], [20.0, 26.0]]})),
    ("error: profile leaving the mouth shallow", with_(bend, geometry__inlet={"type": "profile", "points_mm": [[0.0, 30.0], [10.0, 28.0], [20.0, 25.0]]})),
    ("error: profile x falling", with_(bend, geometry__inlet={"type": "profile", "points_mm": [[0.0, 40.0], [5.0, 30.0], [4.0, 28.0], [20.0, 25.0]]})),
    # refusals
    ("error: ambient pressure", with_(bend, ambient={"p_pa": 5000})),
    ("error: choked", with_(bend, operating_point={"mass_flow_kg_s": 5.0})),
    ("error: bend in the inlet piece", with_(bend, geometry__bend={"clr_mm": 75, "angle_deg": 90, "start_mm": 1})),
    ("error: bend past the end", with_(bend, geometry__bend={"clr_mm": 300, "angle_deg": 90, "start_mm": 100})),
    ("error: split missing an inlet", with_(exh, geometry__stl="two_inlets.stl", operating_point={"mass_flow_kg_s": 0.1, "inlet_split": {"inlet1": 1}})),
    ("error: exhaust without an STL", with_(bend, mode="exhaust")),
    ("error: pressure ratio below 1", with_(bend, operating_point={"pressure_ratio": 0.9})),
    ("error: mesh level", with_(bend, mesh={"level": "huge"})),
]


def snapshot(d):
    out = {}
    for root, _, fs in os.walk(d):
        for f in fs:
            p = os.path.join(root, f)
            rel = os.path.relpath(p, d).replace(os.sep, "/")
            out[rel] = (open(p, "rb").read(), os.name == "nt" or bool(os.stat(p).st_mode & stat.S_IXUSR))
    return out


fails = []
# PYTHONUTF8: the Rust writes UTF-8; Windows Python otherwise writes the file headers in the ANSI code page (cp1252)
# and stops with UnicodeEncodeError on a name outside it
env = dict(os.environ, INTAKE_CFD_STAMP=STAMP, PYTHONUTF8="1")
for k, (tag, design) in enumerate(DESIGNS):
    dj = os.path.join(inp, "design_%02d.json" % k)
    json.dump(design, open(dj, "w"), indent=1)
    case = os.path.join(tmp, "case_%02d" % k)
    res = {}
    for who in ("py", "rs"):
        if os.path.isdir(case):
            shutil.rmtree(case)
        cmd = [sys.executable, os.path.join(HERE, "intake_cfd.py"), dj, case] if who == "py" else [host, "--cfd-generate", dj, case]
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", env=env)
        res[who] = (r.returncode, r.stdout, r.stderr, snapshot(case) if os.path.isdir(case) else {})
        if who == "py":
            os.rename(case, case + "_py") if os.path.isdir(case) else None
    py, rs = res["py"], res["rs"]
    bad = []
    if py[0] != rs[0]:
        bad.append("exit %s vs %s" % (py[0], rs[0]))
    if py[1] != rs[1]:
        bad.append("printed: %r vs %r" % (py[1][-300:], rs[1][-300:]))
    if py[0] == 0:
        for f in sorted(set(py[3]) | set(rs[3])):
            if f not in rs[3]:
                bad.append(f + " missing")
            elif f not in py[3]:
                bad.append(f + " extra")
            elif py[3][f][0] != rs[3][f][0]:
                bad.append(f + " differs")
            elif py[3][f][1] != rs[3][f][1]:
                bad.append(f + " mode differs")
    print(("PASS " if not bad else "FAIL ") + tag + (": %d files, the same bytes" % len(py[3]) if not bad and py[0] == 0 else
                                                     (": " + py[1].strip()[:90] if not bad else "")))
    for b in bad[:12]:
        print("     " + b)
    if py[2].strip():
        print("     python stderr: " + py[2].strip().splitlines()[-1])
    if bad:
        fails.append(tag)
if os.environ.get("GEN_KEEP"):
    print("kept " + tmp)
else:
    shutil.rmtree(tmp, ignore_errors=True)
print("FAILS: %s" % fails if fails else "all passed")
sys.exit(1 if fails else 0)
