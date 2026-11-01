#!/usr/bin/env python3
"""Generate a matrix of parametric designs and check that each mesh is valid
(blockMesh + checkMesh), without running the solver."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)
import intake_cfd as ic

INLETS = {
    "plain": {"type": "plain", "wall_thickness_mm": 2.0},
    "radius": {"type": "radius", "lip_radius_mm": 8},
    "ellipse": {"type": "ellipse", "length_mm": 40, "entry_diameter_mm": 90, "exit_diameter_mm": 45, "corner_radius_mm": 4},
    "ellipse_sharp": {"type": "ellipse", "length_mm": 30, "entry_diameter_mm": 80, "exit_diameter_mm": 45, "corner_radius_mm": 0},
    "taper10": {"type": "taper", "entry_diameter_mm": 70, "wall_half_angle_deg": 10, "lip_radius_mm": 3},
    "taper50": {"type": "taper", "entry_diameter_mm": 70, "wall_half_angle_deg": 50, "lip_radius_mm": 2},
}
base = {"operating_point": {"engine": {"displacement_cc": 1000, "rpm": 10000, "ve": 1.0, "cylinders": 4,
                                       "cylinders_fed": 1}},
        "ambient": {"p_pa": 101325, "T_c": 25}, "mesh": {"level": "coarse"}}
out = os.path.join(HERE, "matrix")
os.makedirs(out, exist_ok=True)
env = ". %s" % (os.environ.get("FOAMENV") or os.path.join(ROOT, "foamenv.sh"))   # a script that puts OpenFOAM v2412 on PATH
rows = []
for iname, inlet in INLETS.items():
    for mount in ({"type": "free", "protrusion_mm": 60}, {"type": "flange"}):
        for cone in (None, {"to_diameter_mm": 38, "cone_half_angle_deg": 8, "start_mm": 100}):
            name = "%s_%s%s" % (iname, mount["type"], "_cone" if cone else "")
            geo = {"tube_diameter_mm": 45, "tube_length_mm": 200, "inlet": inlet, "mount": mount,
                   "maf_plane_mm": 160, "outlet_extension_D": 3}
            if cone:
                geo["diameter_change"] = cone
            des = dict(base, name=name, geometry=geo)
            cdir = os.path.join(out, name)
            subprocess.run(["rm", "-rf", cdir])
            try:
                s = ic.generate_case(des, cdir)
            except ic.DesignError as e:
                rows.append((name, "DESIGN ERROR: %s" % e)); continue
            r = subprocess.run(["bash", "-c", "%s && blockMesh > log.blockMesh 2>&1 && checkMesh > log.checkMesh 2>&1;"
                                " grep -E 'Mesh OK|Failed' log.checkMesh; grep -E 'non-orthogonality Max|skewness' log.checkMesh"
                                % env], cwd=cdir, capture_output=True, text=True)
            rows.append((name, "%6d cells %s | %s" % (s["cells"], s["solver"], " ".join(r.stdout.split()))))
for n, t in rows:
    print("%-28s %s" % (n, t))
