#!/usr/bin/env python3
"""Fill the {{VALIDATION}} / {{VALIDATION_DETAIL}} placeholders in ../NOTES.md
with the tables from make_tables.py plus the narrative below."""
import json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
NOTES = os.path.join(os.path.dirname(HERE), "NOTES.md")
tables = subprocess.run([sys.executable, os.path.join(HERE, "make_tables.py")], capture_output=True, text=True, check=True).stdout.strip()
B = json.load(open(os.path.join(HERE, "blair_results.json")))
pp, rad, ell = B["PP-46-23-23-0"], B["RAD-46-23-35-6"], B["ELL-23-23-49-3"]
e = lambda x: 100 * (x["mdot_cfd"] / x["mdot_pub"] - 1)

summary = """## Validation summary

Blair & Cahoon's three bellmouths (*Race Engine Technology*, Sept. 2006; a
FLUENT study matched to QUB flow-bench tests on a 23 mm pipe) were run as a
user would run them, 1 atm / 25 °C inflow, mass flow set, pressure ratio read
at the tract-end station, medium mesh, then the mass flow re-targeted to the
published PR and interpolated (two converged runs per case).

| case | published ṁ at PR | this generator | error |
|---|---|---|---|
| PP-46-23-23-0, square-cut pipe | %.3f g/s at 1.039 | %.3f g/s | %+.1f %% |
| RAD-46-23-35-6, 6 mm radius lip | %.3f g/s at 1.037 | %.3f g/s | %+.1f %% |
| ELL-23-23-49-3, elliptical bellmouth | %.3f g/s at 1.039 | %.3f g/s | %+.1f %% |

The sharp-edged pipe, where the result is set by the vena contracta, agrees
within 0.4 %%, and Blair's "actual" (vena-contracta) CD for it comes out
%.4f against his %.4f. The two rounded inlets flow 4-5 %% more than Blair's
figures. Their result depends on where the static-pressure station is (about
1 %% per diameter downstream, see the station table in §4), and the article
does not say how far downstream of the bellmouth FLUENT's "Ps measuring
station" was; our station is the end of the 46 mm pipe. The ranking and the
spacing of the three shapes are reproduced: RAD/PP %.3f against the published
%.3f, ELL/RAD %.3f against %.3f. Mesh refinement from medium to fine moves the
mass flow by %+.2f %% (PP), %+.2f %% (RAD) and %+.2f %% (ELL). Details, run
costs and the mesh and station sensitivity tables are in §4.
""" % (pp["mdot_pub"] * 1e3, pp["mdot_cfd"] * 1e3, e(pp), rad["mdot_pub"] * 1e3, rad["mdot_cfd"] * 1e3, e(rad),
       ell["mdot_pub"] * 1e3, ell["mdot_cfd"] * 1e3, e(ell), pp["CD_actual_cfd"], pp["CD_actual_pub"],
       rad["mdot_cfd"] / pp["mdot_cfd"], rad["mdot_pub"] / pp["mdot_pub"], ell["mdot_cfd"] / rad["mdot_cfd"], ell["mdot_pub"] / rad["mdot_pub"],
       100 * (pp["mesh"]["fine"]["mdot_at_PRpub"] / pp["mesh"]["medium"]["mdot_at_PRpub"] - 1),
       100 * (rad["mesh"]["fine"]["mdot_at_PRpub"] / rad["mesh"]["medium"]["mdot_at_PRpub"] - 1),
       100 * (ell["mesh"]["fine"]["mdot_at_PRpub"] / ell["mesh"]["medium"]["mdot_at_PRpub"] - 1))

detail = tables + """

**How the cases were set up.** `validation/run_validation.py blair` builds
each design with `generate_case()` exactly as the web page or the add-in
would (free-standing stack, protrusion = pipe length, 4 D outlet extension,
solver forced compressible), runs `Allrun`, and reads `results.json`. Pass 1
imposes the published mass flow and reads PR at the tract end; pass 2
re-targets the mass flow so that PR lands on the published value; the
reported ṁ is the linear interpolation between the two converged runs. The
two fine runs were interrupted by a container restart and resumed from their
last written time step (`resume_fine.sh`); their wall times are the solver
CPU time of both segments.

**What the comparison shows.**

- The square-cut pipe is the demanding case (vena contracta at M ≈ 0.35,
  lip separation, pressure recovery) and it agrees with Blair's FLUENT/QUB
  figure within 0.4 % in mass flow and 0.7 % in the vena-contracta CD that a
  1-D engine code needs. That is the number the 1-D wave model on this page
  uses for a pipe end.
- The rounded inlets flow 4–5 % more than the published values. For these
  the loss is small and the pressure ratio is almost all dynamic pressure, so
  the answer depends on the exact position of the static-pressure tapping:
  the station table shows the flow-bench Cd falling by about 1 % per pipe
  diameter downstream of the tract end (wall friction). The article gives
  the pipe as 46 mm long but not where FLUENT's "Ps measuring station" sat;
  a station 3–5 D further downstream would close the gap. The published
  caption values also mix PRs (RAD at 1.037, ELL at 1.039), and Blair's own
  text puts the RAD-over-PP gain at "near constant 16 %" and ELL over RAD at
  "a mere 1.5 %"; the generator gives 21 % and 2.3 % at a common PR of 1.039.
  Ranking and spacing are therefore right; absolute Cd for a well-rounded
  inlet should be read as ±5 % until the station convention is pinned down.
- Mesh independence: coarse → medium → fine changes the mass flow by at most
  0.4 % (coarse to medium, PP) and 0.2 % (medium to fine, PP); the rounded
  inlets move by less than 0.05 % from medium to fine. Medium is the
  default.
- Convergence: every run met the report's criteria (mass imbalance
  < 0.1 %, mass-flow drift < 0.1 % and tract-end pressure drift < 0.5 % of
  Δp over 300 iterations); 900–1700 iterations, 1–8 min per run on one core
  of this machine.

**Not yet run.** `run_validation.py friction` (fully developed pipe
friction against Colebrook / McKeon) and `run_validation.py entrance`
(entrance K of a flush inlet against Crane / Idelchik / Rennels) are coded
but have not been run here; the tables appear automatically when their
results files exist."""

s = open(NOTES, encoding="utf-8").read()
assert "{{VALIDATION}}" in s and "{{VALIDATION_DETAIL}}" in s, "placeholders already filled"
s = s.replace("{{VALIDATION}}", summary).replace("{{VALIDATION_DETAIL}}", detail)
open(NOTES, "w", encoding="utf-8").write(s)
print("NOTES.md updated")
