# Intake-tract CFD generator (`intake_cfd.py`) — notes

`intake_cfd.py` is a single, standard-library-only Python 3 file. It takes one
design dictionary and writes a complete OpenFOAM case for an engine intake
tract (ESI/openfoam.com **v2412**). The Fusion add-in and the web page can both
import it (`intake_cfd.generate_case(design, out_dir)`), or it can be run from
the command line (`python intake_cfd.py design.json out_dir`;
`--example` prints a sample design). Every generated file starts with a comment
that says which design inputs set which values in that file.

Files (paths from the repository root):

| file | what |
|---|---|
| `cfd/intake_cfd.py` | the generator (stdlib only; about 3,600 lines including the embedded report script); intake mode and exhaust-component mode (§8); `VERSION` changes whenever generated cases change numerically |
| `cfd/intake_cfd_js_src.js`, `cfd/build_intake_cfd_js.py`, `cfd/intake_cfd.js` | the browser port of the axisymmetric writer (§9); the build script splices the report script, the Windows README and the Python source into the template |
| `cfd/cfd_js_vs_py.js` | the byte-for-byte JS-vs-Python test (`node cfd/cfd_js_vs_py.js`) |
| `cfd/NOTES.md` | this file |
| `cfd/validation/run_validation.py` | runs every validation case through the generator plus `Allrun` (`blair`, `friction`, `entrance`, `exhaust`, `all`, `table`) |
| `cfd/validation/make_tables.py`, `cfd/validation/write_notes.py` | Markdown tables for this file; `write_notes.py` filled the validation sections once |
| `cfd/validation/*_results.json` | validation results |
| `cfd/validation/runs/*/results.json` | each validation case's own result (the case folders themselves are not kept in the repository) |
| `cfd/validation/reference/` | Linux reference runs for the Windows build check (`make_references.sh` regenerates them; required after every `VERSION` change) |
| `cfd/validation/diag/` | build-comparison tools: case variants, Linux re-runs of a Windows round, the laminar-pipe known-answer check (`lam_pipe.py`), `to_wedge.py` |
| `cfd/validation/resume_fine.sh` | resumes the two fine Blair runs after an interruption |
| `cfd/tests/` | development tests: geometry matrix (24 meshes), 3-D bend case, CAD-STL round trip |
| `tools/openfoam/` | the Windows OpenFOAM build, its validation (`validate_windows.ps1`) and `compare_results.py` |
| `web/tests/cfd_ui.js` | the page's Playwright test of the CFD sections |

The Linux runs here use conda-forge's `openfoam 2412` (build h946d6a9_1, GCC 13.3, `-O2 -march=nocona -ftree-vectorize`
appended to wmake's flags), installed with micromamba.

Reproducible output: the time stamp in every file header can be fixed with the
environment variable `INTAKE_CFD_STAMP="2026-10-30 12:00"`, and the derived
floats in `generator_summary.json` are rounded to 12 significant digits, so the
Python and JavaScript writers produce identical files.

## Validation summary

Generator 1.1.0 (2-D cases on a cyclic sector, §4 (e)); every figure below was rerun on 2026-11-01.

Blair & Cahoon's three bellmouths (*Race Engine Technology*, Sept. 2006; a
FLUENT study matched to QUB flow-bench tests on a 23 mm pipe) were run as a
user would run them, 1 atm / 25 °C inflow, mass flow set, pressure ratio read
at the tract-end station, medium mesh, then the mass flow re-targeted to the
published PR and interpolated (two converged runs per case).

| case | published ṁ at PR | this generator | error |
|---|---|---|---|
| PP-46-23-23-0, square-cut pipe | 30.023 g/s at 1.039 | 30.344 g/s | +1.1 % |
| RAD-46-23-35-6, 6 mm radius lip | 34.830 g/s at 1.037 | 36.298 g/s | +4.2 % |
| ELL-23-23-49-3, elliptical bellmouth | 36.150 g/s at 1.039 | 38.055 g/s | +5.3 % |

The sharp-edged pipe, where the result is set by the vena contracta, agrees
within 1.1 %, and Blair's "actual" (vena-contracta) CD for it comes out
0.5722 against his 0.5672. The two rounded inlets flow 4–5 % more than
Blair's figures; their result depends on where the static-pressure station is
(1.0–1.2 % per diameter downstream, station table in §4), which the article
does not give. Ranking and spacing are reproduced: RAD/PP 1.196 against the
published 1.160, ELL/RAD 1.048 against 1.038. Medium to fine moves the mass
flow by +0.15 % (PP), +0.03 % (RAD), +0.01 % (ELL).

Fully developed pipe friction (§4 (a)) is 5–6 % below Colebrook and McKeon,
with the momentum balance closed to 0.3 %; the entrance-loss and exhaust
known-answer checks are in §4 (c) and (d). Until generator 1.0.0 the 2-D
cases used wedge patches, which on the Linux build used here carried a
spurious 25 % pressure gradient in developed flow (§4 (e)); the PP figure was
then 29.913 g/s (−0.4 %), a closer match that was partly that artifact.


## 1. What a generated case contains

```
Allrun  Allclean  README_WINDOWS.md  intake_report.py  case_info.json
design_input.json  generator_summary.json
0/        U p T k omega nut alphat      (T, alphat only when compressible)
constant/ thermophysicalProperties | transportProperties, turbulenceProperties
          triSurface/*.stl              (3-D only)
system/   blockMeshDict  [snappyHexMeshDict surfaceFeatureExtractDict meshQualityDict]
          controlDict fvSchemes fvSolution topoSetDict decomposeParDict
```

Running `./Allrun` (or `./Allrun 4` for 4 cores) runs, in order: meshing,
`checkMesh`, `topoSet`, the solver, and then `intake_report.py`. The report
writes `results.txt` and `results.json`.

## 2. How the design inputs become case settings

### Geometry → mesh

| design input | effect |
|---|---|
| `tube_diameter_mm`, `tube_length_mm` | Tube radius, and the axial position of the **tract-end plane**. The tract-end plane is the reference station for PR, K and Cd. `x = 0` is the front-most plane of the mouth. |
| `inlet.type = plain` (+`wall_thickness_mm`) | Square-cut pipe end. Its "sharp" edges are given a machined-edge radius of `min(0.001 D, 0.05 mm)`. Idelchik's entrance data change by less than 1 % below r/D ≈ 0.002, so this behaves as sharp, and it lets one body-fitted mesh topology serve every inlet. |
| `inlet.type = radius` (`lip_radius_mm` = Rc) | Semi-toroidal ("half-ball") lip, as in Blair's RAD bellmouth. Entry diameter = D + 2 Rc. |
| `inlet.type = ellipse` (`length_mm` L, `entry_diameter_mm` Di, `exit_diameter_mm` De, `corner_radius_mm` Rc) | Quarter-ellipse flare with centre (L, Di/2) and semi-axes L and (Di−De)/2: radial at the lip, axial at the exit. This is Blair & Cahoon's ELL definition, and it matches their Fig. 7 within the pixel accuracy of the figure. Rc rounds the rim. Rc = 0 gives a square rim `rim_thickness_mm` thick (default 1.5 mm). |
| `inlet.type = taper` (`entry_diameter_mm`, `wall_half_angle_deg`, `lip_radius_mm`) | Straight cone from Di down to D, with a rolled lip of the given radius. |
| `mount.type = free` (+`protrusion_mm`) | The inlet stands in open air, as a stack in an airbox or in free air. The domain gets a spherical-dome atmosphere of radius max(15 D, 8 × outer lip diameter), and a wall plane (airbox floor) `protrusion_mm` behind the mouth. |
| `mount.type = flange` | The inlet is flush with a plane wall (a hole in a plenum or airbox floor). The atmosphere is a box of the same size. |
| `diameter_change` (`to_diameter_mm`, `cone_half_angle_deg`, `start_mm`) | Straight cone between two tube diameters. Outlet and planes use the final diameter. |
| `bend` (`clr_mm`, `angle_deg`, `start_mm`, optional `plane_deg`, or a list of bends) | Switches the case to 3-D. A bend breaks axisymmetry, so the generator triangulates the tract itself (lip profile revolved, tube swept along the centre-line) and meshes it with snappyHexMesh. |
| `maf_plane_mm`, `planes_mm` | Named measurement planes. In 2-D they are also block faces, so the plane is exact. |
| `outlet_extension_D` (default 4) | A straight pipe added after the tract end, so the outlet condition cannot influence the measured tract. |
| `stl` (+`stl_units`, `planes`) | 3-D from CAD. The STL needs solids (or separate files) named `inlet` (the open mouth face) and `outlet`; everything else is wall. The part is moved so the mouth centre is at the origin and the inflow direction is +x. A plenum (atmosphere box with a floor in the mouth plane) is added ahead of the mouth, and the outlet face is extruded by `outlet_extension_D`. |
| `mesh.level` coarse / medium / fine | About a 1.5× change in cell size per level in every direction. |

**2-D mesh (blockMesh, 5° sector with rotational cyclic sides).** This is used
whenever the geometry is axisymmetric (no bend, no STL). The mesh is one cell
thick around the axis; its two sides are a rotational cyclic pair (axis x), not
OpenFOAM `wedge` patches, because on wedge patches developed pipe flow carries a
spurious 25 % extra pressure gradient (§4 (e)). A wall layer of thickness 0.15 R follows every
wall: lip, bellmouth, tube, outer body. Grid lines in the layer are exactly
wall-normal. Points along the lip are placed with one-cell multi-grading
sections, so wall and layer edge correspond point by point.

The first cell height is set for **y+ ≈ 1 at the estimated peak velocity**:
`h = 2 ν / u_τ`, with `u_τ = U_peak √(f/8)` and the Colebrook f at the
Reynolds number of the smallest section, formed with that section's own
diameter (until 1.1.0 the tube or outlet diameter was paired with the
smallest section's velocity). This is a wall-resolved, low-Re treatment.

Core blocks fill the tube. The atmosphere blocks fan out from the mouth to the
far field. Block corners with non-90° angles are only found on the layer edge,
never on a wall.

A test matrix of 6 inlet variants × 2 mounts × with/without a cone (24 meshes)
all pass `checkMesh`. Maximum non-orthogonality is 46–61° for the
plain, radius, ellipse and taper-10° inlets, and 67–73° for a 50° taper.

**3-D mesh (blockMesh background + snappyHexMesh).**
- Background cell size is D/2 (coarse, medium) or D/3 (fine).
- Refinement levels (`level3d`):
  - coarse: tract interior D/8, walls D/16;
  - medium: tract interior D/16, walls D/32;
  - fine: medium's levels on the finer background, tract interior D/24,
    walls D/48 (until generator 1.1.0 fine had medium's exact mesh, so a
    "fine" 3-D run was no mesh check at all).
- The mouth region and feature edges get one level more.
- Walls use **wall functions**: `nutUSpaldingWallFunction`, which is valid from
  y+ ≈ 1 into the log layer.
- The first layer is sized for y+ ≈ 50 at the bulk velocity. Layers are
  added (expansion 1.2) until they fill about 60 % of the wall cell.
- The predicted y+ is written in the header of `snappyHexMeshDict`, and the
  achieved y+ is in `results.json`.

### Operating point → boundary conditions

| design input | boundary conditions |
|---|---|
| `ambient.p_pa`, `ambient.T_c` | Atmosphere far field: `totalPressure` p0 = p_amb, `totalTemperature` T0 = T_amb, `pressureInletOutletVelocity`. Dry air: R = 287.05 J/kgK, cp = 1004.5, γ = 1.400, Sutherland μ (As = 1.458e-6, Ts = 110.4 K). |
| `operating_point.mass_flow_kg_s` | Outlet `flowRateOutletVelocity` (mass flow, ramped from 0 over the first 300 iterations); outlet pressure is zero-gradient. The tract pressure drop is the result. |
| `operating_point.engine` | `mdot = VE · ρ_amb · V_d · (rpm/60) / (2 for 4-stroke, 1 for 2-stroke) · cylinders_fed / cylinders · flow_factor`. This is the **cycle-mean** flow. Use `cylinders_fed` for a runner that feeds one cylinder. `flow_factor` > 1 can represent the peak of the induction pulse (see §6). |
| `operating_point.pressure_ratio` | Outlet static pressure = p_amb / PR (ramped). The mass flow is the result. |
| (derived) | Inflow turbulence: intensity 1 % of the tract bulk velocity, and νt/ν = 1 (quiet atmosphere). |

### Solver choice (automatic, recorded in `controlDict` and `fvSolution`)

The generator estimates the **peak local Mach number**. It starts from the bulk
Mach number at the smallest section (isentropic mass-flux relation), or the
ideal Mach number for a given PR. It then multiplies by a lip factor: 1.6 for a
square-cut pipe (vena contracta, Cc ≈ 0.62), 1.2 for a taper, 1.1 for a
radius, 1.05 for an ellipse, and ×1.15 if there is a bend.

- If M_peak ≥ 0.20, it uses **rhoSimpleFoam** (compressible, perfect gas,
  hePsiThermo, enthalpy). At M = 0.2 the density change is already about 2 %
  (≈ M²/2), and the incompressible dynamic-pressure error is about 1 %.
- Otherwise it uses **simpleFoam** (incompressible), with ρ and ν at ambient
  conditions.
- Above M_peak = 0.6 the transonic formulation is switched on. Above 0.95 the
  generator refuses the case: the flow would choke.
- You can override the choice with `"solver": {"force": "compressible"}` or
  `{"force": "incompressible"}`.

Intake tubes at engine flow often exceed 0.2 at a sharp lip. Every Blair
validation case was run compressible.

### Turbulence model and wall treatment

- **k-ω SST** (Menter): k-ω near the wall, k-ε away from it, plus the
  shear-stress limiter. It is the standard RANS choice for adverse pressure
  gradients and separation, which are exactly what intakes have: vena
  contracta behind a sharp lip, diffusers, bends.
- Wall functions:
  - ω: `omegaWallFunction` (blended viscous/log);
  - k: `kqRWallFunction`;
  - νt: `nutUSpaldingWallFunction`;
  - αt: `compressible::alphatWallFunction` (Prt 0.85).
- These are correct both for the y+ ≈ 1 sector mesh (achieved y+ ≈ 0.4–0.9 on
  the tube walls) and for the y+ ≈ 30–100 snappy layers.

### Numerics and convergence controls

- **Convection:** second-order bounded `linearUpwindV` (U) and `linearUpwind`
  (h, K) with cell-limited gradients; `limitedLinear` (TVD) for k and ω.
- **Pressure–velocity coupling:**
  - compressible: classic **SIMPLE** with relaxation p 0.3, ρ 0.05, U/h/k/ω 0.7;
  - incompressible: classic **SIMPLE** with relaxation p 0.3, U/k/ω 0.7
    (until 2026-10-31 SIMPLEC with U 0.8, which diverged on the 80 D friction
    pipes at Re 10⁵; on the square-cut pipe both give the same converged
    answer within 0.03 %).
- I tested alternatives on the hardest case, the sharp-edged pipe at
  M_vc ≈ 0.35 (validation runs listed in §4):
  - SIMPLEC with p 1 / ρ 1 oscillated and diverged;
  - SIMPLEC with ρ 0.05 oscillated;
  - lower U relaxation diverged;
  - first-order turbulence convection diverged;
  - SIMPLE with p 0.3 / ρ 0.05 converged smoothly.
- **Pressure linear solver:** PCG/DIC on the small, strongly graded 2-D
  meshes (GAMG needed hundreds of sweeps there); GAMG in 3-D.
- **Start-up:** the outlet mass flow or pressure is ramped linearly over the
  first 300 iterations.
- **Stop criteria:**
  - `Allrun` runs `intake_report.py --watch` next to the solver; from
    iteration 900 (the 300-iteration ramp plus two windows) it checks every
    5 s whether the inflow mass flow has drifted by less than 2 × 10⁻⁴
    (relative) and every plane's static pressure by less than 10⁻³ of the
    pressure drop over the last 300 iterations, and then sets
    `stopAt writeNow` (OpenFOAM's `runTimeControl` average condition was
    tried for this and found unreliable);
  - iteration cap 6000 (2-D) or 3000 (3-D);
  - `residualControl` is set but cannot trigger on the 2-D sector, because the
    residual of the circumferential velocity Uz (zero to round-off) stays high.
- **Report check:** `intake_report.py` declares the run converged only if:
  - the mass imbalance is < 0.1 %;
  - the mass-flow change over the last 300 iterations is < 0.1 %;
  - the tract-end pressure change is < 0.5 % of Δp.

  Otherwise it says "converged: NO" and lists the reasons.

## 3. Outputs: `results.txt` / `results.json`

Every quantity is given for each plane (`tract_end`, `maf`, user planes).
"Ambient" means p0 = p_amb, T0 = T_amb.

- **Mass flow:** summed from the outlet face fluxes, so it is exact. Each
  sampled plane re-integrates ρU·dA; the plane-to-outlet ratio is reported as
  a check.
- **PR = p0 / p̄s**, where p̄s is the area-averaged static pressure on the
  plane. This is Blair's flow-bench definition.
- **Δp_static** = p0 − p̄s; **Δp_total** = p0 − p̄0, where p̄0 is the
  mass-averaged total pressure (compressible: isentropic total pressure from
  the local Mach number).
- **K** = Δp_total / (½ ρ̄ U_b²) at the plane, with U_b = ṁ / (ρ̄ A).
- **Cd (flow bench)** = ṁ / ṁ_ideal, where ṁ_ideal is the isentropic mass flow
  from (p0, T0) to p̄s through the geometric plane area.
- **Cd "actual" (Blair & Lau, SAE 952138).** This is the vena-contracta area
  ratio that a 1-D wave-action engine simulation needs at a pipe end. Flow is
  isentropic from p0 to the vena contracta, then a momentum balance, with pc
  acting on the full area, recovers to p̄s. Fed with Blair's own published ṁ
  and PR, this reconstruction gives his published CDs within 0.2–0.8 %
  (PP 0.5654 vs 0.5672, RAD 0.7176 vs 0.719, ELL 0.7370 vs 0.743).
- **Uniformity index** γ = 1 − Σ|u_n − ū_n| A_i / (2 |ū_n| A). 1 means
  perfectly uniform; MAF makers usually want ≳ 0.95.
- **Secondary-flow angle:** mass-weighted mean of atan(|u_t| / |u_n|).
  **Swirl angle:** mass-weighted mean of atan(u_θ / u_n) about the plane
  centre, both net (signed) and absolute. **Swirl number**
  S = ∫ρ u_n u_θ r dA / (R ∫ρ u_n² dA).
- **y+** min / avg / max for each wall patch.
- **Convergence evidence**, as listed in §2.

## 4. Validation

All runs: generator 1.1.0. The Blair suite ran on the conda-forge Linux build used for the references; the friction,
entrance and exhaust suites on ESI's Ubuntu package (`cfd-validation.yml`, run 41296667345). The two builds agree on
2-D cyclic cases within 0.05 % (§4 (e)).

### (b) Blair & Cahoon bellmouths, De = 23 mm, inflow from 1 atm / 25 °C

Mass flow at the published pressure ratio (PR = p0 / area-averaged static pressure at the tract-end station). Our value is interpolated between two converged runs that bracket the PR (medium mesh).

| case | PR (published) | ṁ published [g/s] | ṁ CFD [g/s] | error | Blair 'actual' CD pub. / CFD | flow-bench Cd pub. / CFD |
|---|---|---|---|---|---|---|
| PP-46-23-23-0 | 1.039 | 30.023 | 30.344 | +1.1 % | 0.5672 / 0.5722 | 0.7773 / 0.7856 |
| RAD-46-23-35-6 | 1.037 | 34.830 | 36.298 | +4.2 % | 0.7190 / 0.7892 | 0.9239 / 0.9628 |
| ELL-23-23-49-3 | 1.039 | 36.150 | 38.055 | +5.3 % | 0.7430 / 0.8577 | 0.9359 / 0.9852 |

| ratio | published | CFD | difference |
|---|---|---|---|
| RAD / PP, caption values (RAD at PR 1.037, PP at 1.039) | 1.160 | 1.196 | +3.1 % |
| ELL / RAD, caption values (ELL at 1.039, RAD at 1.037) | 1.038 | 1.048 | +1.0 % |
| RAD / PP at the same PR = 1.039 | 1.189 (RAD caption value scaled to 1.039 at constant Cd; text: "near constant 16 %") | 1.226 | |
| ELL / RAD at the same PR = 1.039 | 1.013 (same scaling; Fig. 12: ≈ +1.9 % at PR ≈ 1.04; text: "a mere 1.5 %") | 1.023 | |

Mesh sensitivity (ṁ at the published PR):

| case | coarse | medium | fine | fine vs medium |
|---|---|---|---|---|
| PP-46-23-23-0 | 30.219 g/s (5350 cells) | 30.344 g/s (10377 cells) | 30.390 g/s (19204 cells) | +0.15 % |
| RAD-46-23-35-6 | 36.282 g/s (6534 cells) | 36.298 g/s (12557 cells) | 36.308 g/s (23497 cells) | +0.03 % |
| ELL-23-23-49-3 | 38.042 g/s (6927 cells) | 38.055 g/s (13690 cells) | 38.060 g/s (25579 cells) | +0.01 % |

Sensitivity to where the static-pressure station is (flow-bench Cd, medium mesh):

| case | station at L | L + 1 D | L + 2 D |
|---|---|---|---|
| PP-46-23-23-0 | 0.7856 | 0.7935 | 0.7946 |
| RAD-46-23-35-6 | 0.9628 | 0.9531 | 0.9444 |
| ELL-23-23-49-3 | 0.9852 | 0.9734 | 0.9630 |

Run cost: PP-46-23-23-0 1880+1890 it / 1863 s; RAD-46-23-35-6 1840+1860 it / 2405 s; ELL-23-23-49-3 1370+1410 it / 1368 s

**How the cases were set up.** `validation/run_validation.py blair` builds
each design with `generate_case()` exactly as the web page or the add-in
would (free-standing stack, protrusion = pipe length, 4 D outlet extension,
solver forced compressible), runs `Allrun`, and reads `results.json`. Pass 1
imposes the published mass flow and reads PR at the tract end; pass 2
re-targets the mass flow so that PR lands on the published value; the
reported ṁ is the linear interpolation between the two converged runs.

**What the comparison shows.**

- The square-cut pipe is the demanding case (vena contracta at M ≈ 0.35,
  lip separation, pressure recovery): +1.1 % in mass flow and +0.9 % in the
  vena-contracta CD that a 1-D engine code needs.
- The rounded inlets flow 4–5 % more than the published values. For these
  the loss is small and the pressure ratio is almost all dynamic pressure, so
  the answer depends on the position of the static-pressure tapping: the
  station table shows the flow-bench Cd falling 1.0–1.2 % per pipe diameter
  downstream of the tract end. Developed-pipe friction at this Reynolds number
  (Colebrook, Re ≈ 10⁵) would give 0.84 % per diameter; the boundary layer just
  behind a bellmouth is thinner than in developed flow, so the wall shear there
  is higher. The published figures would be met by a station about 4–5 D
  further downstream; the article gives the pipe as 46 mm long but not where
  FLUENT's "Ps measuring station" sat. The caption values also mix PRs (RAD at
  1.037, ELL at 1.039), and Blair's text puts RAD over PP at "near constant
  16 %" and ELL over RAD at "a mere 1.5 %"; the generator gives 22.6 % and
  2.3 % at a common PR of 1.039. Ranking and spacing are right; absolute Cd for
  a well-rounded inlet should be read as ±5 % until the station convention is
  pinned down.
- Mesh independence: coarse → medium changes the mass flow by +0.41 % (PP),
  medium → fine by +0.15 % (PP); the rounded inlets move by less than 0.05 %.
  Medium is the default.
- Convergence: every run met the report's criteria (mass imbalance < 0.1 %,
  mass-flow drift < 0.1 % and tract-end pressure drift < 0.5 % of Δp over
  300 iterations), in 1370–1890 iterations (910–1270 on the old wedge cases).
- Against generator 1.0.0 (wedge patches): PP +1.44 % in mass flow (Cd
  0.7744 → 0.7856), of which +0.13 % is the flow-scale correction and the
  rest the wedge artifact, which acted most strongly in the separated flow
  behind the sharp lip; RAD +0.17 % and ELL +0.13 %, about the flow-scale
  correction alone.

### (a) Fully developed turbulent pipe flow (D = 50 mm, L = 80 D, f from Δp between 50 D and 70 D)

f CFD is the Darcy factor from the static-pressure drop between 50 D and 70 D (compressible runs: the momentum-flux change of the accelerating gas taken off); f wall is 8 τw / (ρ U²) from the wall shear stress on the same stretch. The two must agree in developed flow (a momentum balance).

| case | Re | f CFD (Δp) | f wall (τw) | Δp / τw | Colebrook | error | Haaland | McKeon 2005 | error | y+ avg/max | run |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pipe_Re5e+04 | 5e+04 | 0.01978 | 0.01972 | 1.003 | 0.02089 | -5.3 % | 0.02071 | 0.02093 | -5.5 % | 0.86/0.94 | 3690 it, 3056 s |
| pipe_Re1e+05 | 1e+05 | 0.01694 | 0.01693 | 1.001 | 0.01799 | -5.8 % | 0.01782 | 0.01811 | -6.4 % | 0.87/0.94 | 4160 it, 4578 s |
| pipe_Re1e+05_coarse | 1e+05 | 0.01688 | 0.01688 | 1.000 | 0.01799 | -6.1 % | 0.01782 | 0.01811 | -6.7 % | 0.86/0.94 | 3680 it, 2154 s |
| pipe_Re1e+05_fine | 1e+05 | 0.01699 | 0.01695 | 1.003 | 0.01799 | -5.5 % | 0.01782 | 0.01811 | -6.1 % | 0.87/0.95 | 4290 it, 5721 s |
| pipe_Re2e+05 | 2e+05 | 0.01463 | 0.01468 | 0.997 | 0.01564 | -6.4 % | 0.01550 | 0.01580 | -7.4 % | 0.87/0.96 | 3890 it, 5199 s |

**Reading.** The momentum balance closes: f from the pressure drop and f
from the wall shear stress agree within 0.3 % at every Reynolds number.
f is 5–6 % below Colebrook and McKeon et al. from Re 5 × 10⁴ to 2 × 10⁵;
coarse and fine meshes move it by −0.35 % and +0.3 %, with y+ ≈ 0.9 at the
wall, so the shortfall belongs to the turbulence model on this setup, not to
the mesh. Read friction pressure drops in long runners as about 6 % low. On
the conda-forge build the cyclic pipe at Re 2 × 10⁵ gave f 0.01465 from Δp
and 0.01443 from τw. Before 1.1.0 only the Re 2 × 10⁵ case had been run, on
wedge patches: f 0.01951 as reported (+24.8 %); 0.01841 (+17.7 %) once the
gas acceleration the script said it removed was removed; against 0.01472
from its own wall shear stress, which is the 1.25× wedge artifact.

### (c) Entrance loss coefficient, inlet flush with a wall (D = 50 mm, Re = 1e5)

K from total pressure: the mass-averaged total-pressure loss of the fully developed region (20–40 D) extrapolated back to the inlet plane; K from static pressure − 1: (p0 − extrapolated static pressure)/q − 1, the way entrance losses are usually measured. Both in dynamic heads of the bulk velocity.

| case | K CFD, total pressure | K CFD, static pressure − 1 | Crane TP-410 | Idelchik | Rennels | run |
|---|---|---|---|---|---|---|
| entrance_r0.04D | 0.141 | 0.239 | 0.24 | 0.26 | 0.324 | 3800 it, 3104 s |
| entrance_r0.10D | 0.013 | 0.117 | 0.09 | 0.12 | 0.203 | 3410 it, 2001 s |
| entrance_r0.20D | -0.010 | 0.091 | 0.04 | 0.03 | 0.115 | 3950 it, 3319 s |
| entrance_sharp | 0.396 | 0.466 | 0.50 | 0.50 | 0.570 | 3570 it, 3178 s |
| entrance_sharp_coarse | 0.401 | 0.471 | 0.50 | 0.50 | 0.570 | 3210 it, 1866 s |
| entrance_sharp_fine | 0.392 | 0.463 | 0.50 | 0.50 | 0.570 | 3990 it, 4830 s |

**Reading.** The two conventions differ by the kinetic-energy flux of the
velocity profile in the 20–40 D region (α − 1 = 0.07–0.10 here). The
handbooks do not say which they tabulate. The static-pressure form agrees
with Crane and Idelchik for the sharp edge (0.466 against 0.50; mesh coarse /
medium / fine 0.471 / 0.466 / 0.463), for r/D 0.04 (0.239 against
0.24–0.26) and for r/D 0.10 (0.117 against 0.09–0.12). For r/D 0.20 it is
high (0.091 against 0.03–0.04). The total-pressure K of the well-rounded inlet
comes out slightly negative (−0.010): the loss in the first 20 D is less than
the developed-flow line predicts. A likely reason is that the boundary layer
behind a well-rounded inlet starts nearly laminar, since the inflow is quiet
air (I = 1 %, νt/ν = 1). The developed-flow f from the 20–40 D slope is 3–8 %
below Colebrook, consistent with (a). Before 1.1.0 every entrance case had
failed: SIMPLEC with U relaxation 0.8 diverged (a floating-point exception in
the pressure solver at about iteration 140), so `entrance_results.json` was
empty, although these notes called the suite "not yet run". The incompressible
cases now run classic SIMPLE.

### (d) Exhaust-component mode: known-answer checks (gas 650 °C, inlet 100 m/s, medium mesh)

K is the total-pressure loss from the part's inlet face to its exit face in dynamic heads of the inlet velocity. The part's own straight pipes between those faces (inlet 1 D or 2 D, outlet 10 D; the 2 D extensions the generator adds lie outside the measured section) add wall friction, estimated with Colebrook at the run's Reynolds number and taken off to give the component's own K.

| case | K CFD, inlet to exit | friction of the straights (est.) | K of the component | reference | run |
|---|---|---|---|---|---|
| EXH-expansion-50-100 | 0.671 | 0.037 | **0.635** | 0.562 (Borda-Carnot (1 - A1/A2)^2) | converged, 900 it, 437 s, 51780 cells |
| EXH-bend90-50-R75 | 0.448 | 0.253 | **0.196** | 0.20–0.30 (Idelchik diag. 6-1 / Crane TP-410 (14 f_T = 0.27, 2 in), R/D = 1.5) | converged, 900 it, 545 s, 76792 cells |

**Reading.** K is measured between the part's own inlet and exit faces, so
only the part's own straights are taken off. Until 2026-11-01 the friction of
the 2 D extensions that the generator adds outside the measured section was
taken off too. That gave 0.60 and 0.14 and the reading "bend losses low by
about a third", which was wrong.

- **Sudden expansion.** 0.635 is 12.8 % above Borda–Carnot's ideal, which
  assumes flat profiles and complete mixing. Idelchik's form with the inlet
  profile's momentum and energy coefficients (ζ = N − 2M/n + 1/n², diagram
  4-1) gives 0.61 for a developed 1/7-power profile. The inlet profile here,
  3 D after a uniform inflow, lies between flat and developed, so the CFD
  sits about 5–10 % above the handbook. The friction estimate for the 10 D
  outlet straight, where the flow is still re-developing, is the least
  certain part of the correction.
- **Bend.** 0.196 for the bend itself (the arc's own friction, about 0.05,
  is still in it, as it is in the handbook values) sits at the bottom of the
  0.20–0.30 band: Idelchik's diagram 6-1 with its Reynolds-number correction
  at Re ≈ 5 × 10⁴, and Crane TP-410's 14 f_T = 0.27 for a 2 in pipe
  (tabulated f_T = 0.019).

The exit velocity profile after 10 D of straight pipe is 96 % uniform. Both
runs converged by the report's criteria at 900 iterations.

**Build dependence (3-D).** These are ESI's Ubuntu package. The same bend
case files (the OpenFOAM inputs are byte-identical between generator 1.0.0
and 1.1.0) gave K 0.4763 inlet to exit (0.224 for the bend itself) on the
conda-forge build. `openfoam-linux-builds.yml` reruns the bend on both
builds to separate a meshing difference from a solver difference. Until
that is settled, read 3-D losses to about ±6 %. As with the intake mode,
differences between designs run the same way are more reliable than the
absolute K.

### (e) Why the 2-D cases are a cyclic sector, not a wedge (generator 1.1.0, 2026-11-01)

**What was wrong.** Until generator 1.0.0 the 2-D cases were a 5° wedge with
OpenFOAM `wedge` patches for sides. On the Linux build that made every
reference and validation run here (conda-forge `openfoam 2412`, build
h946d6a9_1), those cases carry a spurious pressure gradient: fully developed
pipe flow needs 1.25× the pressure gradient that its own wall shear stress
balances.

| check, on the conda-forge Linux build | wedge sides | rotational cyclic sides |
|---|---|---|
| laminar pipe, Re 483 (`diag/lam_pipe.py`): developed Δp/Δx over Hagen–Poiseuille | 1.2515 | 1.0078 |
| turbulent pipe, Re 2 × 10⁵, k-ω SST, rhoSimpleFoam: f from Δp (gas acceleration taken off) / f from τw | 0.01841 / 0.01472 = 1.251 | 0.01465 / 0.01443 = 1.015 |
| same turbulent pipe: mass-averaged total temperature at 50–80 D (inflow 298.15 K) | 298.6–299.3 K | 298.15–298.18 K |

The wall shear stress was right on the wedge too (laminar: Hagen–Poiseuille;
turbulent: 6 % under Colebrook, the usual k-ω SST result), so the extra was
a pressure gradient with nothing to balance it, and the work it did showed up
as heat. On that build's wedge mesh icoFoam (no explicit stress term) is
exact, and so is a SIMPLE loop built against the same libraries that leaves
out the explicit part of the viscous stress, −∇·(ν_eff dev2((∇U)ᵀ)) (1.0023);
with that term it is 1.25 again, carried by an axial odd-even velocity mode.

**Only that build.** The same laminar-pipe case on the other builds
(`openfoam-diag.yml`, run 41285699898):

| build | wedge sides | rotational cyclic sides |
|---|---|---|
| conda-forge `openfoam 2412` (Linux, used here) | 1.2515 | 1.0078 |
| our MinGW build of ESI's v2412 source (Windows, `tools/openfoam`) | 1.0023 | 1.0078 |
| ESI's own Ubuntu package (`openfoam2412-default`, Build _b8cf4d35-20260127) | 1.0023 | 1.0078 |

So the wedge results of the Windows builds were the right ones all along: on
the square-cut pipe (6000 iterations, tract end) our Windows build on wedge
patches gave K 0.3779 and Cd 0.7846 where the conda-forge build gave 0.3994
and 0.7745, and the conda-forge build itself gives 0.3778 and 0.7846 on the
cyclic sector (same flow scale 72). That 5–9 % "Windows K error" is what
started the search for a fault in the Windows build (and before that, in
ESI's Windows package): there was none. What the conda-forge build does
differently on wedge patches is not known; it applies no source patches
(its recipe only appends conda's flags to wmake's: `-fvisibility-inlines-hidden
-march=nocona -mtune=haswell -ftree-vectorize -fno-plt -O2 -ffunction-sections`,
linked with `-Wl,--gc-sections -Wl,--as-needed`; GCC 13.3). Until that is
found, do not trust wedge-patch cases from that build, and keep the third
build (ESI's Ubuntu package, `esi_linux` job of `openfoam-diag.yml`) in CI.

**The cyclic sector.** The mesh is the same 5° sector; its two sides are a
rotational cyclic pair (`transform rotational; rotationAxis (1 0 0)`), so the
solver sees an ordinary 3-D mesh one cell thick whose sides are coupled, and
no wedge code is involved. checkMesh: the coupled points match to
4 × 10⁻¹² m. With it the three builds agree: square-cut pipe, generator
1.1.0, 6000 iterations, every plane quantity — our Windows build within
0.015–0.021 % (compressible) and 0.039–0.051 % (incompressible) of the
conda-forge Linux reference (two runs on different runners, diag runs
41285699898 and 41289680200; Windows' C runtime picks its maths routines by
CPU, so runs on different machines differ in the fifth digit), ESI's Ubuntu package within 0.016 % and 0.051 %, and ESI's Ubuntu
package on wedge sides within 0.005 % of the cyclic result.

What the sector does at the axis: the cells there are prisms whose third face
has collapsed onto the axis (blockMesh's `mergeType points`), and the cyclic
coupling sees them as ordinary thin cells. On the laminar pipe, with 25 cells
across the radius, the cyclic sector's centreline velocity comes out 1.5 %
low and the profile slightly blunt. That is where its +0.8 % on the pressure
gradient comes from, on every build; a correct wedge gives +0.2 %. The
conda-forge wedge is different again: its profile matches Hagen–Poiseuille
within 0.16 %, but along the axis the velocity alternates from cell to cell
(61 sign changes in 61 steps over 2.0–2.8 m), and its pressure gradient is
25 % high. In turbulent flow, with its flat core, and in the intake cases the
axis matters less: on the square-cut pipe ESI's wedge and cyclic results agree
within 0.005 %, and in the turbulent pipe Δp and τw agree within 0.3 %.

Generator 1.1.0 also scales the sector's flow to the full circle by its true
area: the sector's outer edges are straight chords, so it holds
sin(5°)/(5° in rad) = 0.99873 of a true 5° sector, and the flow scale is
2π / sin 5° = 72.091 instead of 360/5 = 72. With 72 the solved velocity was
0.13 % above the reported bulk velocity, K 0.25 % high and Cd 0.13 % low.

**Earlier conclusions this overturns.**
- "ESI's Windows package misses Linux v2412 by 6–9 % on K" (STATUS, the
  validation scripts): the Linux reference was the one in error. ESI's
  package still cannot run rhoSimpleFoam ("failed lookup of thermo:psi",
  patch 1 in `tools/openfoam/patch_v2412_windows.sh`), so our own build stays.
- The -O2 rebuild (patch 4) changed nothing; what it chased was this.
- Every validation figure from the wedge cases (§4 (a)–(c), the summary at
  the top, the page's Method notes) carried the artifact; they are rerun on
  the cyclic sector.
- One Windows diagnostic round (run 41227130686) was compared with Linux
  variants generated before the incompressible cases moved from SIMPLEC to
  SIMPLE, so every difference in that comparison was the settings change.
  Redone with the identical case files (`diag/linux_rerun.sh`): with ν ≈ 0
  the two builds agree to every digit, wedge variants part at iteration 2 by
  about 3 × 10⁻⁴, cyclic ones at iteration 3 by about 10⁻⁵.
- `run_validation.py friction` said it took the momentum-flux change of the
  accelerating gas off the pressure drop but did not (5.6 % of the drop at
  Re 2 × 10⁵).

## 5. Limitations

- **The flow is steady RANS.** An engine intake is pulsating. Wave action
  (ram tuning, reflections, back-flow and spit-back) is outside the case.
  That is the job of the 1-D wave simulation. Use this CFD for steady-flow
  coefficients (K, Cd, the Blair "actual" CD for the 1-D model's pipe-end
  boundary, MAF uniformity), and to compare shapes at the same operating
  point.
- **Cycle-mean versus peak flow.** Losses scale with U², so a
  cycle-averaged loss is larger than the loss at the cycle-mean flow. Run a
  single runner at its peak flow (`flow_factor`, typically 2–3 for one
  cylinder) for the worst case.
- **The k-ω SST model is not exact.** Lip separation, the vena contracta and
  recovery after a sharp edge are where RANS models disagree most. On the
  sharp-edged pipe the 2-D result needed the SIMPLE/relaxation settings above
  to converge. Absolute Cd at the 3–5 % level is the realistic accuracy for
  sharp-edged inlets; differences between designs computed the same way are
  more reliable than absolute values. In developed pipe flow the model gives
  friction 5–6 % below Colebrook and McKeon (§4 (a)).
- **Other physics left out:** dry air (humidity changes R by < 0.5 %);
  adiabatic smooth walls (no wall roughness, no under-hood heating); no
  filter element, throttle plate or MAF sensor body (model them in the STL
  if needed); no fuel.
- **3-D is coarser than 2-D.** It uses wall functions and default-level
  meshes. Check the y+ and the convergence notes in `results.txt`. If the
  answer matters, run `fine` and compare: from generator 1.1.0 on, `fine`
  puts medium's refinement levels on a background cell of D/3 instead of D/2,
  about 3.4 times the cells. Before that it gave medium's exact mesh, so a
  "fine" 3-D run was no check at all. 3-D results also depend on the OpenFOAM
  build by up to about 6 % (§4 (d)), and our Windows build has only been
  compared with Linux on the 2-D cases.
- **3-D mounting.** Parametric 3-D cases (with a bend) are meshed
  flange-mounted (mouth flush with the plenum floor). A "free"-standing stack
  is only modelled in 2-D.
- **STL mouth outline.** The mouth outline in an STL must be planar and
  star-shaped about its centre (round, oval and rounded-rectangle mouths are
  fine), and the tract must not pass upstream of its own mouth plane.

## 6. Running a case on Windows

The case folder also contains these instructions as `README_WINDOWS.md`.

1. One-time setup (PowerShell as Administrator): `wsl --install -d Ubuntu-24.04`,
   then reboot and open "Ubuntu".
2. In Ubuntu, install OpenFOAM v2412:
   ```
   curl -s https://dl.openfoam.com/add-debian-repo.sh | sudo bash
   sudo apt-get update
   sudo apt-get install openfoam2412-default
   ```
3. Copy the case into the Linux home folder. This is much faster than running
   it on `/mnt/c`:
   `cp -r /mnt/c/Users/<you>/Downloads/<case> ~/ && cd ~/<case>`
4. Run it: `openfoam2412` (this opens a shell with OpenFOAM loaded), then
   `./Allrun`, or `./Allrun 4` to use 4 cores. If you get "Permission
   denied", run `chmod +x Allrun Allclean` first.
5. Read `results.txt`. For pictures, open `case.foam` in ParaView for Windows,
   via `\\wsl.localhost\Ubuntu-24.04\home\<you>\<case>`.
6. `./Allclean` resets the case so it can be run again.

Alternative: openfoam.com also publishes a native Windows (MinGW) build of
v2412 that includes a bash shell. WSL2 is the better-tested route.

## 7. Using it from the Fusion add-in / web page

```python
import intake_cfd
summary = intake_cfd.generate_case(design_dict, out_dir, base_dir=folder_with_stl)
# summary: solver, reason, cells, M_peak, Re, planes, file list ...
```

- `intake_cfd.DesignError` is raised with a plain-English message for
  impossible or unsupported inputs, for example: a choked operating point, a
  plane outside the tract, a bend that overlaps a cone, or an STL without
  `inlet`/`outlet` solids. Show that message to the user.
- From Fusion, export the **fluid volume** as STL in mm. That is a body whose
  outer surface is the tract wall plus a cap on the mouth and a cap on the
  outlet. Name the faces/bodies `inlet` and `outlet`, either as separate STL
  files or as solids in one ASCII STL.
- For the web page, zip `out_dir` and offer it as a download. The case is
  self-contained.

## 8. Exhaust-component mode

`"mode": "exhaust"` turns the generator round: instead of an open mouth
drawing from the atmosphere, the case is one exhaust part from CAD with one or
more inlets fed at a set mass flow of hot gas and an outlet at ambient static
pressure. It is meant for the parts where a steady RANS loss coefficient is a
useful number: merge collectors (4-1, 4-2-1 secondaries), X-pipe and H-pipe
sections, muffler and resonator shells, tailpipe tips.

- **Geometry.** An STL of the fluid volume with solids (or separate files)
  named `inlet` or `inlet1`…`inletN` and `outlet`; everything else is wall.
  Each inlet face is extruded upstream by `inlet_extension_D` (default 2)
  diameters and the outlet downstream by `outlet_extension_D` (default 2), so
  the boundary conditions sit away from the part. The original faces become
  the measurement planes (`inlet1`…, `exit`). CAD coordinates are kept. The
  background box is the part's bounding box plus 0.75 D; snappyHexMesh with
  the same refinement, feature-edge and layer settings as the intake 3-D path
  (`write_3d_mesh_exhaust`). `locationInMesh` is inside the outlet extension.
- **Operating point.** `mass_flow_kg_s` is the total exhaust flow, or
  `engine` gives the air flow of `cylinders_fed` cylinders (density at the
  intake-air temperature) and the exhaust flow is air × (1 + 1/AFR),
  `gas.afr` default 12.5. The flow is split equally between the inlets unless
  `operating_point.inlet_split` gives per-inlet weights.
- **Gas.** `gas.T_c` (default 650 °C; the page uses 400 °C for parts
  downstream of the header) sets the inlet total temperature and the
  reservoir state for density, viscosity, Mach and wall spacing. Properties
  are air's (R, cp, γ, Sutherland) at that temperature; exhaust gas has a few
  per cent more cp and about the same R and μ, and K is a pressure ratio, so
  the error is small. Always compressible (a temperature field is needed).
- **Boundary conditions.** Inlets `flowRateInletVelocity` (mass flow per
  inlet, ramped over 300 iterations), T fixed, p zero-gradient, k and ω fixed
  for 5 % intensity and ν_t/ν = 10 (turbulent flow from the ports). Outlet p
  fixed at ambient, U/T/k/ω `inletOutlet`. Walls as in intake mode.
- **Report (`summary` in `results.json`).** Mass-averaged total pressure
  over the inlet faces minus the exit face: `dp_total_Pa`; `K` = that over
  ½ ρ_in U_in² with U_in = ṁ / (ρ_in Σ A_inlet); `K_to_ambient` = (p0_in −
  p_amb)/q_in, which adds the exit dynamic head (what the engine feels when the
  part dumps to the air); `back_pressure_Pa` = p̄s_in − p_amb; `split` per
  inlet; `exit_uniformity_index`, `exit_swirl_angle_deg`; per inlet
  `K_inlet_to_exit`. The intake columns (PR, Cd) are still printed for each
  plane but mean nothing here. Convergence drift is measured against the
  largest plane-to-ambient pressure difference, and the watchdog tracks the
  outlet mass flow.
- **Validation** (§4 (d), `run_validation.py exhaust`): a sudden expansion
  against Borda–Carnot and a 90° R/D 1.5 bend against Idelchik / Crane.
- **Not modelled**: pulsation, scavenging and wave tuning between primaries
  (OpenWAM), sound, wall heat loss. A cycle-mean run understates the loss at
  the pulse peak (∝ ṁ²). Rank shapes with it; do not read torque from it.

## 9. Browser port and page integration

`intake_cfd.js` (built from `intake_cfd_js_src.js` by `build_intake_cfd_js.py`)
is a line-for-line port of the axisymmetric path: `normalise`, `derive`,
`inlet_profile`, `tract_stations`, `Dist`, `Sector`, `build_axisym_mesh`, the
field/physics/numerics/controlDict writers, `Allrun`, `Allclean`, the report
script and the Windows README (the last three spliced in verbatim). Python's
number formatting is reproduced exactly: `%g/%f/%e` through an exact
decimal expansion of the double with round-half-even, `repr()` for the JSON
floats, `json.dumps(indent=2)`, `round()`, `sum()` with CPython 3.12+'s
Neumaier compensation and `math.hypot`'s 3.13 algorithm. `cfd_js_vs_py.js`
runs both writers on ten designs (the three Blair cases, fine/coarse
variants, an engine operating point with a MAF plane, a flange-mounted taper
with a cone, an incompressible pressure-ratio case, a bent tube and an
exhaust part) and finds 172 files byte-identical; the bent tube and the
exhaust part are shipped as `design.json` + `intake_cfd.py` + README because
snappyHexMesh dictionaries are not ported. (A browser-written case, 3.5 in
tube with an elliptical bellmouth and a cone to a 3 in throttle, was run to
convergence on 2026-10-30 on the old wedge mesh; its result file was not
kept, so no figure from it is quoted.)

On the page (`cfd_patch.py`): the Intake tab's "Intake CFD (OpenFOAM)"
section (`#intake-cfd`, expert mode) builds the design from the tab's tube,
mouth, bends, throttle bore, MAF choice and engine, writes the case in the
browser, zips it (or saves through the Fusion add-in with
`fusionCall('saveFiles', {files, title, folder})`; file names carry the case
folder) and reads `results.json` files back (`#cfd-files`, `#cfd-results`,
`#cfd-reading`). The Headers tab's "Exhaust component CFD (OpenFOAM)" section
(`#headers-cfd`) does the same for the exhaust mode with `design.json` +
`intake_cfd.py` and the user's STL (`#exh-dl`, `#exh-files`, `#exh-results`,
`#exh-reading`). `window.__cfd` and `window.__exh` expose `design()`,
`build()`, `download()` and the UI state for the add-in.

## References

- G.P. Blair, W.M. Cahoon, "Best bell", *Race Engine Technology*, Sept. 2006
  (FLUENT study of bellmouths; Figs. 4, 6, 7 captions give PR, CD and ṁ).
- G.P. Blair, H.B. Lau et al., "Coefficients of discharge at the apertures of
  engines", SAE 952138 (1995).
- C.F. Colebrook (1939); S.E. Haaland (1983); B.J. McKeon et al., *J. Fluid
  Mech.* 538 (2005) (smooth-pipe friction).
- Crane Co., *Flow of Fluids*, TP-410, A-29 (entrance K: 0.5 sharp, 0.24 at
  r/D 0.04, 0.09 at 0.10, 0.04 at ≥ 0.15).
- I.E. Idelchik, *Handbook of Hydraulic Resistance*, Diagram 3-4 (0.5, 0.26,
  ≈0.12, 0.03 at r/D 0, 0.04, 0.10, 0.20).
- D.C. Rennels, H.M. Hudson, *Pipe Flow* (2012) (sharp entrance 0.57).
- F.R. Menter, "Two-equation eddy-viscosity turbulence models for engineering
  applications", *AIAA J.* 32 (1994).
