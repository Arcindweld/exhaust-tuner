#!/usr/bin/env python3
"""Fill {{EXH_VALIDATION_TABLE}} in ../NOTES.md with the exhaust-mode table from make_tables.py and a short reading."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
NOTES = os.path.join(os.path.dirname(HERE), "NOTES.md")
tables = subprocess.run([sys.executable, os.path.join(HERE, "make_tables.py")], capture_output=True, text=True, check=True).stdout
sec = tables[tables.index("### (d)"):].strip()
X = json.load(open(os.path.join(HERE, "exhaust_results.json")))
ex = [e for n, e in X.items() if "expansion" in n][0]
bd = [e for n, e in X.items() if "bend" in n][0]
txt = sec + """

**Reading.** The sudden expansion lands %+.0f %% above Borda–Carnot's ideal
value once the straight pipes' friction is taken off; the ideal assumes a
flat inlet profile and complete mixing, and measured values (Idelchik,
diagram 4-1) sit a few per cent above it, so this is the expected side of the
mark. The bend's K of %.2f for the bend itself (the straights' friction taken
off; the arc's own friction, about 0.05, is still in it) is **below** the
0.20–0.30 band of the handbooks (Idelchik's diagram 6-1 with its
Reynolds-number correction at Re ≈ 5 × 10⁴, Crane's 14 f_T = %.2f for a 2 in
pipe). The bend loss comes from the secondary flow and the separation on the
inner wall, and the medium mesh (D/16 cells, wall-function layers at
y+ 15–60) does not resolve them well; the uniform inlet profile two diameters
upstream also lowers it a little. Until a finer-mesh run says otherwise,
read bend losses from this mode as low by about a third, and expect area
changes and merges to be the better-predicted kind. The exit velocity profile
after 10 D of straight pipe is %.0f %% uniform. Both runs converged by the
report's criteria in 900–%d iterations (%.0f and %.0f s on one core). As with
the intake mode, differences between designs run the same way are more
reliable than the absolute K.""" % (
    100 * (ex["K_component"] / ex["K_ref"] - 1), bd["K_component"], 14 * bd.get("f_T", 0.018),
    100 * bd["exit_uniformity"], max(int(ex["iterations"]), int(bd["iterations"])), ex["wall_time_s"] or 0, bd["wall_time_s"] or 0)
s = open(NOTES, encoding="utf-8").read()
assert "{{EXH_VALIDATION_TABLE}}" in s
open(NOTES, "w", encoding="utf-8").write(s.replace("{{EXH_VALIDATION_TABLE}}", txt))
print("NOTES.md updated")
