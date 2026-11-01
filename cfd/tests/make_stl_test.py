#!/usr/bin/env python3
"""Build a CAD-like STL of a straight intake tract (rounded flush entrance,
D = 50 mm, L = 10 D) in an arbitrary position/orientation, with solids named
wall / inlet / outlet in millimetres -- exactly what a Fusion export would give
-- plus the matching 2-D (axisymmetric sector) and 3-D (STL) design files, so the 3-D path
can be checked against the 2-D path (whose validation is in cfd/NOTES.md section 4)."""
import json, math, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import intake_cfd as ic

D, L, rc = 50.0, 500.0, 10.0
mdot = 1e5 * ic.mu_air(298.15) * math.pi * D * 1e-3 / 4      # Re = 1e5
geo = {"tube_diameter_mm": D, "tube_length_mm": L, "inlet": {"type": "radius", "lip_radius_mm": rc},
       "mount": {"type": "flange"}, "outlet_extension_D": 0.0001}
d = ic.normalise({"name": "x", "geometry": dict(geo), "operating_point": {"mass_flow_kg_s": mdot}})
g = d["geometry"]
g["profile"] = ic.inlet_profile(g)
surf = ic.build_param_3d_surface(g, g["profile"], nphi=96)
# CAD placement: rotate 35 deg about z then 20 deg about x, translate
def place(p):
    p = ic.rotate_about(p, (0.0, 0.0, 1.0), math.radians(35))
    p = ic.rotate_about(p, (1.0, 0.0, 0.0), math.radians(20))
    return ((p[0] + 0.30) * 1e3, (p[1] - 0.12) * 1e3, (p[2] + 0.05) * 1e3)
regions = [("wall", [tuple(place(q) for q in t) for t in surf["wall"] + surf["ext"]]),
           ("inlet", [tuple(place(q) for q in t) for t in surf["mouth"]]),
           ("outlet", [tuple(place(q) for q in t) for t in surf["outlet"]])]
ic.write_stl_ascii(os.path.join(HERE, "cad_tract_mm.stl"), regions)
# MAF plane at x = 6 D in CAD coordinates
maf_pt = place((0.30, 0.0, 0.0))
maf_n = ic.rotate_about(ic.rotate_about((1.0, 0.0, 0.0), (0, 0, 1), math.radians(35)), (1, 0, 0), math.radians(20))
op = {"mass_flow_kg_s": mdot}
amb = {"p_pa": 101325, "T_c": 25}
d3 = {"name": "stl_straight", "geometry": {"stl": "cad_tract_mm.stl", "stl_units": "mm", "outlet_extension_D": 3,
                                          "planes": {"maf": {"point_mm": list(maf_pt), "normal": list(maf_n)}}},
      "operating_point": op, "ambient": amb, "mesh": {"level": "medium"}}
d2 = {"name": "axisym_straight", "geometry": dict(geo, outlet_extension_D=3, maf_plane_mm=300.0),
      "operating_point": op, "ambient": amb, "mesh": {"level": "medium"}}
json.dump(d3, open(os.path.join(HERE, "stl_straight.json"), "w"), indent=2)
json.dump(d2, open(os.path.join(HERE, "axisym_straight.json"), "w"), indent=2)
print("mdot %.6g kg/s; wrote cad_tract_mm.stl, stl_straight.json, axisym_straight.json" % mdot)
