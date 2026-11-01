"""Writes one exhaust-mode validation case exactly as run_validation.py exhaust does (gas 650 C, inlet 100 m/s,
medium mesh), without running it:  python3 exhaust_case.py bend|expansion <case dir>"""
import json
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import run_validation as rv  # noqa: E402

kind, out = sys.argv[1], os.path.abspath(sys.argv[2])
os.makedirs(os.path.dirname(out), exist_ok=True)
stl = out + ".stl"
if kind == "bend":
    rv.tube_stl(stl, [("line", 100.0, 25.0, 25.0), ("arc", 75.0, math.pi / 2, 25.0), ("line", 500.0, 25.0, 25.0)])
else:
    rv.tube_stl(stl, [("line", 50.0, 25.0, 25.0), ("line", 1000.0, 50.0, 50.0)])
rho = rv.P0 / (rv.ic.R_AIR * (rv.T_GAS_C + 273.15))
mdot = rho * rv.U_IN * math.pi / 4 * 0.050 ** 2
rv.ic.generate_case(rv.exhaust_design("bend90_50_R75" if kind == "bend" else "expansion_50_100", stl, mdot), out)
print("wrote", out)
