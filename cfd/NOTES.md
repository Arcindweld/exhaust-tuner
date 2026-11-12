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
| `cfd/validation/entrance3d.py` | the 3-D rounded-entrance sweep (§4 (g)) → `entrance3d_results.json`; `cai_bends_results.json` is the owner's CAI bend-by-bend breakdown (§4 (h)) |
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

3-D (snappyHexMesh) path, 2026-11-11, after the mouth-ledge and cached-gradient fixes (§4 (c3), (c4), (f), (g)):
developed pipe friction within 2 % of Colebrook; flush entrance K against r/D, on the handbooks' basis
(K_total + α − 1): sharp 0.392 (Crane / Idelchik 0.50; 2-D 0.396 as total pressure), r/D 0.02 0.308 (0.28 / 0.37),
0.04 0.262 (0.24 / 0.26), 0.06 0.184 (0.15 / 0.20), 0.10 0.141 (0.09 / 0.12), 0.15 0.114 (0.04 / 0.07). The
exhaust-component bend reads K 0.44839 on the conda-forge build with the cache, ESI's package 0.44838 on the same
mesh (0.47634 without it). Free-standing (re-entrant) mouth, 0.5 D proud, same basis (§4 (i)): t/D 0.02 3-D 0.639,
2-D 0.629, Idelchik 0.72; t/D 0.05 0.482 / 0.443 / 0.50; r/D 0.04 lip 0.280 / 0.289. A measured mouth profile reads
the ellipse it was taken from to ΔK 0.0003 (§4 (j)); a cone over a bend meshes checkMesh-clean (§4 (k)).


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
| `inlet.type = profile` (`points_mm` [[x, r], ...], `rim_thickness_mm`, default 1.5) | A measured mouth (since 2026-11-11): the flow-side wall as points in mm, x from the mouth plane (the first point at x = 0) rising into the tube, r falling (or level) to the bore (the last point at r = D/2 exactly, within 0.001 mm), the first radius above the bore and the first segment at 45° or more to the axis (a rim that leaves the mouth plane steeply, as a rounded lip or a bellmouth does; a counterbore is refused). The wall is the polyline through the points (2-D: a block edge through every point; 3-D: revolved). The rim is square, `rim_thickness_mm` thick, as the ellipse's without a corner radius. The 2-D mouth block corner sits where the wall turns to 45° from the axis, where the ellipse's does. Validation: §4 (j). |
| `mount.type = free` (+`protrusion_mm`) | The inlet stands in open air, as a stack in an airbox or in free air. The domain gets a spherical-dome atmosphere of radius max(15 D, 8 × outer lip diameter), and a wall plane (airbox floor) `protrusion_mm` behind the mouth. In 3-D (since 2026-11-11, when the design names the mount): the tube's outside, a straight cylinder at the lip's outer radius (plain: D/2 + wall; radius: D/2 + 2 Rc; ellipse: Di/2 + Rc, or + `rim_thickness_mm` for a square rim; taper: the lip's centre radius + its lip radius; profile: the first r + `rim_thickness_mm`), and the lip's outer face are patch `inlet_wall` (a wall), from the mouth back to the plenum wall, the plane x = `protrusion_mm`, which is `plenum_wall`. Default protrusion max(inlet piece, D), cut back to the first bend or diameter change; at least the lip's outer front point + 0.15 D; refused when the protrusion reaches the first bend or cone, or the tube comes back through that plane. The protruding wall is refined (`lipShell`, distance) to cells of at most 1/2.5 of the thinnest wall between bore and outside and, for a rounded lip (radius, taper, ellipse with a corner radius), at most 1/2 of the lip radius (§4 (i)), within that thickness + 2 cells of the outside (up to 4 levels above the tract's level; a thinner wall or smaller lip is refused: use `fine`, a thicker wall or flange). §4 (i). |
| `mount.type = flange` | The inlet is flush with a plane wall (a hole in a plenum or airbox floor). The atmosphere is a box of the same size. A 3-D design that names no mount is flange-mounted, as before 2026-11-11 (generator_summary.json's `note` says so); 2-D defaults to free. |
| `diameter_change` (`to_diameter_mm`, `cone_half_angle_deg`, `start_mm`), or an ordered list of them | Straight cone between two tube diameters. A list (since 2026-11-11) is a reducer mid-run, a cone to the throttle bore, or any number one after the other: each starts from the bore the one before it left (grow or shrink), at or after the end of the one before it, and ends before the tract end; the first starts after the inlet piece. One dict and a one-item list write the same case (only the echoed `design_input.json` differs). Outlet extension and outlet use the final bore. Every plane's K and Cd are referred to the bulk velocity in the bore at that plane (2-D: its geometric area; 3-D: the sampled area of the cut, the local bore); with more than one change `generator_summary.json` lists `plane_bore_mm`. In 3-D a cone may overlap a bend (§4 (k)): its rings follow the bend's frames with the radius at that path length. |
| `bend` (`clr_mm`, `angle_deg`, `start_mm`, optional `plane_deg`, or a list of bends) | Switches the case to 3-D. A bend breaks axisymmetry, so the generator triangulates the tract itself (lip profile revolved, tube swept along the centre-line) and meshes it with snappyHexMesh. `force_3d: true` makes a straight tract 3-D too (validation). |
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
- **Cached `grad(U)` (every 3-D case, intake and exhaust-component mode):** `fvSolution` has `cache { grad(U); }`.
  It changes no numerics; it keeps one Linux build (conda-forge) from
  evaluating the explicit viscous-stress term wrongly, which put 3-D pipe
  friction 25 % high (§4 (c4)) and the exhaust bend's K 6 % high (§4 (f)).
  The 2-D sector is not affected and has no cache.
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

### (c3) The same entrance in 3-D, and the mouth-ledge fix (2026-11-10)

The 3-D (snappyHexMesh) path had no entrance check. Run as in (c) but 3-D (`force_3d`, flange mount, D = 50 mm,
L = 25 D, total-pressure K extrapolated from 10–22 D, medium mesh, simpleFoam):

| case | 3-D before | 3-D after the fix | 2-D (c), total pressure | Crane |
|---|---|---|---|---|
| sharp, parametric | 1.005 | 0.329 | 0.396 | 0.50 |
| sharp, parametric, fine mesh | 1.031 | | 0.392 | 0.50 |
| sharp, from a CAD-style STL | 1.023 | | | 0.50 |
| r/D 0.04 | 0.194 | 0.194 | 0.141 | 0.24 |

**Cause.** The tract-wall boundary layers (layers on `tract_wall` and `extension_wall` only) met the mouth edge, where
the next patch (`plenum_wall`, the floor) has none, and with `slipFeatureAngle 30` snappyHexMesh slid the layer stack
along the floor: the stack's end faces in the mouth plane, from R minus the layer thickness to R, were given the floor
(wall) patch. That is a ledge one layer stack deep (7–8 % of R here) around the inside of the mouth, which turns a
flush sharp entrance into a slightly smaller orifice: the jet contracted to 0.53 of the tube area (sampled at
0.5 D), Borda's re-entrant value, and K came out at the re-entrant 1.0. A finer mesh keeps the same layer thickness,
so it did not help; `featureAngle` (edges between two layered patches) did not change it; a rounded lip has no
convex edge, so it was never affected. Counted as plenum faces with centres inside the bore: 396 (medium), 708 (fine),
364 (STL); 0 after the fix. **Fix (generator 1.1.0, unchanged version):** `slipFeatureAngle 100` in the intake 3-D
`snappyHexMeshDict`: the layers stop at the mouth edge instead of sliding (layer coverage 99.7 %, `checkMesh` OK).
Exhaust-component mode is unchanged (its tube ends are inlet and outlet patches, not walls).

**Remaining.** After the fix the 3-D sharp entrance reads 0.33 against the 2-D 0.40 (total pressure), and the 3-D
medium mesh's developed friction factor is 0.022–0.023 against Colebrook 0.018 (the 2-D sector is within 3–8 % of
it): the 3-D medium mesh, about D/26 at the wall with wall functions, is coarse for friction. The losses of a whole
tract are within the ±15 % class of the other checks; friction-dominated long tracts read high. *(Superseded by (c4):
the friction excess was not the mesh but the conda-forge build's explicit stress term; fixed, f now within 2 %.)*

**On the owner's CAI** (LS3, 6,600 RPM, 369 g/s, medium mesh, total-pressure loss at the tract end): see
docs/STATUS.md, 2026-11-10.

### (c4) 3-D pipe friction: the explicit stress term on the conda-forge build (2026-11-10)

The (c3) cases read developed friction 22–25 % above Colebrook on the 3-D medium mesh. Straight 50 mm tube, r/D 0.04
lip (and the sharp mouth of (c3)), flange mount, L = 25 D + 3 D extension, Re 1.0 × 10⁵, medium mesh, simpleFoam,
conda-forge build; f is the slope of the mass-averaged total pressure over 10–22 D divided by q, K the total-pressure
loss extrapolated from 10–22 D to the mouth:

| | before | after (`cache { grad(U); }`) |
|---|---|---|
| f, total pressure 10–22 D (Colebrook 0.01796) | 0.02200 (+22.5 %) | 0.01766 (−1.7 %) |
| f, static pressure 10–22 D | 0.0203 | 0.0163 |
| f from the wall shear stress, 10–22 D | 0.01712 (−4.7 %) | 0.01717 (−4.4 %) |
| static Δp 10–22 D / (wall shear + momentum-flux change) | 1.27 | 1.004 |
| y+ on `tract_wall`, 10–22 D mean (min–max) | 48.5 (44.9–51.5) | 48.5 (46.3–49.4) |
| y+ on `tract_wall`, whole patch avg | 46.1 | 45.9 |
| cells | 183,554 | 183,554 |
| iterations / solver CPU (2 shared cores, one used) | 900 / 723 s | 906 / 644 s |
| entrance K, r/D 0.04 (Crane 0.24, 2-D 0.141) | 0.194 | 0.202 |
| entrance K, sharp (Crane 0.50, 2-D 0.396) | 0.329 ((c3)) | 0.340 |
| `plenum_wall` faces with centres inside the bore (sharp / rounded) | 0 / 0 | 0 / 0 |

Sharp case after the fix: f 0.01845 (+2.7 %; the flow 10–22 D behind a sharp mouth is still developing), layer
coverage 99.7 %, 902 iterations, 614 s. The r/D 0.04 tube forced compressible (rhoSimpleFoam, M 0.09): f 0.02211
(+23.1 %) before, 0.01776 (−1.1 %) after; K 0.193 → 0.201; 902 / 905 iterations, 873 / 724 s. So the compressible
turbulence library has the same defect and the same cure.

**Diagnosis.** The mesh and wall functions were not at fault: y+ sat at 45–51 along the tube, and the wall shear
stress gave f within 5 % of Colebrook, as in 2-D (§4 (a)); the wall faces have no axial component (no form drag);
unlimited `grad(U)` with full non-orthogonal correction moved Δp by 0.5 %. The axial momentum balance did not close:
the static pressure fell 27 % faster than wall shear plus the (falling) momentum flux required, uniformly along the
tube. Laminar check on the same mesh (ν × 1000, Re 101): stock simpleFoam gives 1.247 × Hagen–Poiseuille, the same
solver source rebuilt here without the explicit term −∇·(ν_eff dev2((∇U)ᵀ)) gives 1.003. On the converged laminar
field, a small utility built against the same libraries evaluates that term with the same expression and schemes
and gets 5 × 10⁻⁵ m⁴/s² over 10–22 D (essentially zero, as it must be), while `turbulence->divDevReff(U)` from the
prebuilt turbulence library integrates to 9.101 against 7.552 for its Laplacian part alone: its explicit part is
1.55 m⁴/s², a body force of 20 % of the wall stress spread over the whole cross-section (it matches the grad(p)
integral, 9.101, so the solver is converged and the excess pressure gradient is this term). With `grad(U)` cached,
the same library call gives 7.5515 against 7.5516: the prebuilt library goes wrong only when the gradient is a
reusable temporary (most likely the transpose done in place on it; OpenFOAM's field loops declare their pointers
`__restrict__`, which an in-place pass does not honour). The utility built here with GCC 13.3 and conda-forge's
flags gets the temporary case right too, so what that build does differently is still not known. This is very likely the same defect as the wedge's 1.25 in §4 (e); the 2-D cyclic sector is not
affected (§4 (e)).

**Fix.** 3-D intake cases write `cache { grad(U); }` in `fvSolution` (Python, Rust and the page's JS generators).
Caching changes no numerics (the gradient is the same, only stored), so on a correct build the result is unchanged;
on the conda-forge build the explicit term comes out right and 3-D friction lands within 2 % of Colebrook. The
mesh, layers and wall functions are unchanged.

**Not done here** (done in §4 (f), 2026-11-11: exhaust mode was affected and now caches too; the 2-D sector is
not). The ESI package was not available on this machine, so the "after" figures are from the conda-forge
build with the workaround, not from a second build.

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

**Build dependence (3-D).** These are ESI's Ubuntu package. The conda-forge
build gives a different answer on the same mesh (`openfoam-linux-builds.yml`,
run 41317888445, fresh installs of both): bend K inlet to exit 0.47634
(0.224 for the bend itself) against ESI's 0.44838, with byte-identical
meshes (same checksums of `points` and `faces`, 92 883 cells). So it is the
solver, not snappyHexMesh. The earlier 3-D figures (generator 1.0.0, run on
the conda-forge build here) carried that difference. It is the explicit-stress defect of §4 (c4): with
`cache { grad(U); }`, which exhaust cases write since 2026-11-11, the conda-forge build gives 0.44839 (§4 (f)). ESI's package and our
Windows build compile ESI's source the same way, so the ESI figures are the
ones to use. As with the intake mode, differences between designs run the
same way are more reliable than the absolute K.

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
found, do not trust wedge-patch cases from that build. Its 3-D results
were off as well: the exhaust bend came out 6 % higher in K than on ESI's
package on a byte-identical mesh (§4 (d)); that was the uncached-gradient
defect, now worked around in every 3-D case (§4 (c4), (f)). Only the 2-D cyclic cases agree
across all three builds (within 0.05 %). So use the conda-forge build here
for 2-D work only, run 3-D validation on ESI's package
(`cfd-validation.yml`, `openfoam-linux-builds.yml`), and keep the third build
in CI (`esi_linux` job of `openfoam-diag.yml`). Future Linux references
should come from ESI's package.

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

### (f) Does the cached-gradient defect reach the other case kinds? (2026-11-11)

§4 (c4) proved the conda-forge build's explicit-stress defect on the 3-D intake path only. Each other case kind was
run here (conda-forge build, one core) with and without `cache { grad(U); }`, nothing else changed:

| case kind | check | without the cache | with the cache | reference | verdict |
|---|---|---|---|---|---|
| exhaust-component mode (always 3-D) | 90° bend, R/D 1.5, 50 mm, gas 650 °C, 100 m/s, medium, rhoSimpleFoam, `exhaust_case.py bend`: K inlet to exit | 0.47634 (900 it, 716 s) | 0.44839 (900 it, 659 s) | ESI's Ubuntu package, byte-identical mesh (92,883 cells, run 41317888445): 0.44838; the same conda-forge build there: 0.47634 | **affected, +6.2 %; fixed** |
| 2-D cyclic sector, laminar known answer | `diag/lam_pipe.py` cyclic (Re 483, 240 × 25 cells, 3000 it): developed Δp/Δx over Hagen–Poiseuille | 1.0078 | 1.0078 | ESI's package and our Windows build: 1.0078 (§4 (e)) | not affected |
| 2-D cyclic sector, generator mesh, laminar | the generator's 2-D case (D 50 mm, r/D 0.04, L 25 D) made laminar with ν × 1000 (Re 101): static drop 10–22 D at the same iteration (1100, not yet converged) | 4140.67 m²/s² | 4140.76 m²/s² | | not affected (3 × 10⁻⁵; the defect is 25 %) |
| 2-D exhaust cases | — | | | | none exist: exhaust mode needs an STL, so it is always 3-D |

The exhaust bend reproduces both builds to the fifth digit: without the cache this machine gives exactly the
conda-forge figure of the CI comparison, with it exactly ESI's. So the 6 % build difference noted in §4 (d) and (e)
was this defect, and the ESI figures in §4 (d) stand. y+ on the bend wall is unchanged (avg 33.9 / 33.7). The 2-D
sector gives the same answer on all three builds (§4 (e)) and with or without the cache, so its cases are left
byte-identical. A turbulent 2-D pair was not run; the cross-build agreement of the turbulent 2-D square-cut pipe
(within 0.05 %, §4 (e)) covers it.

**Fix (generator 1.1.0, unchanged version):** exhaust-component cases write `cache { grad(U); }` in `fvSolution`
too (Python, Rust, the page's JS; `gen_rs_vs_py.py` all passed, `cfd_js_vs_py.js` 172 files identical). 2-D and
3-D intake cases are byte-identical to before. On ESI's and our Windows builds nothing changes (caching changes
no numerics), so `exhaust_results.json` (ESI) stays as it is; the sudden expansion was not rerun here.

### (g) Rounded entrance in 3-D after both fixes (2026-11-11)

`validation/entrance3d.py run` (results `entrance3d_results.json`, each case's `results.json` in `runs/e3d_*`): straight
tube D 50 mm, L 25 D + 3 D extension, flange mount, `force_3d`, Re 1.0 × 10⁵, simpleFoam, medium mesh, generator
1.1.0 with `slipFeatureAngle 100` and `cache { grad(U); }`; sharp = plain cut (3 mm wall), else a rolled lip of radius
r. K extrapolated back to the mouth from the planes at 10, 13, 16, 19, 22 D, as in (c3) and (c4). Every run converged
by the report's criteria at 900 iterations (936–1319 s on one shared core; the generator estimates 152,804–158,960 cells, the checkMesh counts were not kept; (c4)'s r/D 0.04 mesh had 183,554), y+ on the tube
wall 45–48.

**Basis.** The CFD's tract-end figure is the mass-averaged total-pressure loss, K_total. The handbooks' K is set on
static pressure less one velocity head of the bulk velocity, read where the flow has re-developed, so it holds the
profile's kinetic-energy excess, α − 1; the like-for-like CFD figure is K_total + (α − 1), with α = (p̄0 − p̄s)/q read
from the CFD at 22 D (1.053–1.068 here; the Intake tab's ALPHA_DEV is the 1/7-power 1.058). (p0 − static line at x =
0)/q − 1 is listed too; at 10–22 D the profile is still developing (α at 10 D is 1.060–1.085), which this form folds
into the intercept.

| r/D | 3-D K_total | 3-D K_total + (α₂₂ − 1) | 3-D (p0 − static line)/q − 1 | 2-D K_total / static − 1 (§4 (c), 20–40 D) | Crane TP-410 | Idelchik (diag. 3-4) | Rennels |
|---|---|---|---|---|---|---|---|
| 0 (sharp) | 0.339 | **0.392** | 0.449 | 0.396 / 0.466 | 0.50 | 0.50 | 0.570 |
| 0.02 | 0.252 | **0.308** | 0.347 | | 0.28 | 0.37 | 0.396 |
| 0.04 | 0.202 | **0.262** | 0.292 | 0.141 / 0.239 | 0.24 | 0.26 | 0.324 |
| 0.06 | 0.119 | **0.184** | 0.194 | | 0.15 | 0.20 | 0.273 |
| 0.10 | 0.074 | **0.141** | 0.138 | 0.013 / 0.117 | 0.09 | 0.12 | 0.203 |
| 0.15 | 0.046 | **0.114** | 0.102 | | 0.04 | 0.068 | 0.148 |

Developed-flow f from the total-pressure slope over 10–22 D: 0.0185 (sharp), 0.0181, 0.0177, 0.0171, 0.0168, 0.0166
(r/D 0.15), Colebrook 0.0180: behind a well-rounded lip the boundary layer is still thinner than developed at 22 D,
so the extrapolated K of the rounder inlets carries some of the development (low f over the fit range lifts the
intercept). Handbook values: Crane's flush rounded-entrance table as the Intake tab's CRANE_ENTRY; Idelchik's as
transcribed in the fluids library (`entrance_rounded`, method Idelchik, Hamilton's data), linear between its points
(0.15 → 0.068); Rennels & Hudson, *Pipe Flow* (2012), the formula in the same library.

**Reading.** On the like-for-like basis the 3-D CFD lies between Crane and Idelchik at r/D 0.02–0.06 (0.308 / 0.262 /
0.184 against 0.28–0.37 / 0.24–0.26 / 0.15–0.20), above both from r/D 0.10 (0.141 and 0.114 against 0.09–0.12 and
0.04–0.07), and 0.11 under both at the sharp edge (0.392 against 0.50), where 2-D gives the same 0.396 total-pressure
figure: the k-ω SST vena contracta behind a sharp lip recovers with less loss than the handbook flush square edge, on
both mesh types. So the 3-D path now agrees with the 2-D sector at the sharp edge (0.339 vs 0.396 total; the 2-D tube
is 50 D long and fits 20–40 D) and is 0.06 above it at r/D 0.04 and 0.10 (the 2-D sector, y+ ≈ 1 with a near-laminar
start behind a rounded lip, reads lower, §4 (c)). For the Intake tab's lip entry K (Crane): at the owner's r/D 0.038
the CFD's straight-tube K is within 0.03 of Crane (0.267 against 0.244, both interpolated) — Crane is not the outlier there;
at the plain cut the CFD is 0.11 under Crane and Idelchik alike, so the CFD's sharp-edge figure is the outlier. In a
straight tube the CFD's gain from a 0.038 D lip is therefore 0.13 (0.339 − 0.207 in K_total), against Crane's 0.26.

### (h) The owner's CAI with a 3.5 mm lip: where the 1-D tab and the CFD part (2026-11-11)

The Intake tab's like-for-like figure ("as a CFD reads it", `r.dpEnd`) was +5 % on the CFD for the plain mouth and
+16 % with a 3.5 mm lip (r/D 0.038). To see which term carries that, the owner's tube was run with each bend in
isolation (`cai_bends_results.json`): bore 92.61 mm, 880.62 mm, flange mount, 29.5° bend from 100 mm and 84.1° from
572.08 mm (plane 139.246°, the real layout), both 127 mm centre-line radius, 0.3694 kg/s air at 25 °C, simpleFoam
(forced), medium mesh (131,120–136,233 cells), both fixes; every run converged at 900–960 iterations (543–605 s).
Configurations keep the bends where they are and drop the others. K = total-pressure loss at the tract end / q
(q 1,270 Pa); the 1-D column is the tab's calcIntake on the same subset (smooth wall, Crane entry and bends × A1,
less ALPHA_DEV − 1 = 0.058; a Python transcription, 1,089 / 764 Pa for the full tube against the page's 1,093 / 769).

| tube | CFD plain | 1-D plain | CFD 3.5 mm lip | 1-D lip | CFD lip gain | 1-D lip gain |
|---|---|---|---|---|---|---|
| straight (no bends) | 0.507 (644 Pa) | 0.580 (+14 %) | 0.354 (449 Pa) | 0.325 (−8 %) | 0.153 | 0.256 |
| bend 1 only | 0.785 (996 Pa) | 0.670 (−15 %) | 0.476 (604 Pa) | 0.415 (−13 %) | 0.309 | 0.256 |
| bend 2 only | 0.677 (859 Pa) | 0.767 (+13 %) | 0.432 (548 Pa) | 0.511 (+18 %) | 0.245 | 0.256 |
| both (the owner's tube) | 0.837 (1,063 Pa) | 0.857 (+2.4 %) | 0.535 (679 Pa) | 0.602 (+12.5 %) | 0.302 | 0.256 |

Increments (CFD; 1-D in brackets):

| term | plain | lip |
|---|---|---|
| straight tube: entry + friction | 0.507 (0.580) | 0.354 (0.325) |
| + bend 1 (29.5°, starts 1.08 D behind the mouth, 7.7 D of outlet when alone) | +0.278 (+0.090) | +0.122 (+0.090) |
| + bend 2 (84.1°, ends 1.32 D before the tract end) | +0.170 (+0.187) | +0.078 (+0.187) |
| interaction of the two (full − b1 − b2 + straight) | −0.117 (0) | −0.019 (0) |

**Reading.**
- The straight tube repeats §4 (g) at this tube's Re (2.8 × 10⁵): the CFD's plain-cut entry is 0.07 below the tab
  (CFD's sharp edge is the low one, §4 (g)), the lip's 0.03 above it, so in a straight tube the CFD gains only 0.15
  from the lip against Crane's 0.26.
- The lip's +12.5 % is carried by bend 2: behind a rounded entry it adds 0.078 at the tract end, 42 % of the 1-D
  0.187. That bend ends 1.3 D before the tract end, where the profile still holds α 1.13–1.15 (developed 1.06): most
  of a bend's loss is the mixing-out of that distorted profile downstream, which a total-pressure plane 1.3 D on
  has not seen yet. Bend 1 and the interaction are within 0.035 of the 1-D for the lip.
- The plain cut's +2.4 % is a cancellation: bend 1, starting 1.08 D behind the sharp mouth, costs 3 times the
  handbook (+0.278 against +0.090: it sits in the separated vena-contracta region, and the total-pressure loss at
  its start, 100 mm, is already 72 Pa above the straight tube's), against an entry 0.07 low and a −0.117 interaction.
  So the lip gain grows from 0.15 (straight) to 0.31 as soon as bend 1 is there: the entry-then-bend interaction is
  what makes the lip worth more in CFD than in the 1-D tab.
- Plane 139.246° against the 90° used before: 1,063 against 1,043 Pa plain (+1.9 %), 679 against 660 Pa lip
  (+2.9 %); the owner's PC (ESI-based build, rhoSimpleFoam, same layout) gave 1,085 Pa plain (+2.1 % on this).

**Sourced corrections checked; the 1-D model is unchanged.**
- Outlet-tangent correction: Miller (*Internal Flow Systems*, 2nd ed., ch. 9) multiplies a bend's K by C_o for an
  outlet shorter than about 30 D. Miller's chart was not available here; its digitisation in the fluids library
  (`Miller_bend_unimpeded_correction`, read from its source, not verified against the book) gives C_o 0.64 for
  bend 2 (Kb ≈ 0.18, L/D 1.32) and 0.57 for bend 1 (4.4 D to bend 2). Applied to bend 2 alone it would move the
  tab's full tube to 0.779 / 0.524: lip −2 %, plain −7 % (−9 % against the PC's 1,085 Pa). It is not added: the
  table values could not be checked against Miller, and the measured gap is inlet-dependent (bend 2 costs 0.170
  behind a plain cut and 0.078 behind the lip), which no inlet-independent bend factor can represent.
- Bend-to-bend interaction at 4.4 D: Miller's interaction factors for bends in series were not found in any
  accessible source; a forum summary of them (citing his ch. 10) ("C12 normally 0.8–1 for less than 4 diameters between bends") is not a citation.
  Measured: −0.117 plain, −0.019 lip.
- Entry followed by a bend 1.1 D behind it: no published coefficient found (Idelchik's and Miller's entrance data
  are for a straight run behind the mouth). Measured: bend 1 costs +0.188 (plain) and +0.032 (lip) over the 1-D.

So: on the lip the CFD is the closer one to the handbooks term by term except at the short-outlet bend, where the
CFD's tract-end plane does not yet hold the bend's whole loss and the tab charges all of it; on the plain cut the
CFD's sharp entry is low and its bend-behind-the-mouth high, and the two cancel. Both the tab's +2 / +13 % and the
CFD's own ±15 % class (§4) cover this; the tab's lip gain (0.256) is between the CFD's straight-tube 0.153 and
full-tube 0.302.

### (i) A free-standing mouth in 3-D (2026-11-11)

Until now a 3-D parametric case meshed every mouth flange-mounted. `mount: free` now gives the 3-D case the 2-D free
mount's arrangement (§2): the tube stands `protrusion_mm` proud of the plenum wall (the plane x = P), its outside
and the lip's outer face are a wall patch `inlet_wall` in the plenum, and the protruding wall is refined (`lipShell`)
so the solid wall between the bore and the outside is never bridged. A 3-D design that names no mount stays
flange-mounted (byte-identical to before).

**Validation** (`validation/freemount3d.py`, results `freemount3d_results.json`, each case's `results.json` and
`meshcheck.json` in `runs/f3_*`, `runs/f2_*`): straight tube D 50 mm, L 25 D + 3 D extension, Re 1.0 × 10⁵,
simpleFoam, medium mesh, conda-forge build, one core; the tube stands 25 mm (0.5 D) proud; K extrapolated back to the
mouth from the planes at 10, 13, 16, 19, 22 D exactly as `entrance3d.py` (§4 (g)); the 2-D free-mount cases are the
same designs without `force_3d`. Basis as §4 (g): the CFD's K_total, and K_total + (α₂₂ − 1) for the handbooks'
static-pressure basis. Idelchik: *Handbook of Hydraulic Resistance*, diagram 3-1 (a sharp-edged tube standing at
distance b from the wall, wall thickness δ), as transcribed in python-fluids (`fluids.fittings.entrance_distance`,
method `'Idelchik'`): the table (11 × 11, rows δ/D 0, 0.004 … 0.05, ∞; columns b/D 0, 0.002 … 0.5, ∞) and its
bilinear interpolation were read from the library's published source (fluids.readthedocs.io, `_modules/fluids/fittings`;
the package is not installed here) and checked against the function's two docstring examples (D 0.1 m, t 0.5 mm:
0.925; with l 20 mm: 0.8475), which `freemount3d.py` reproduces exactly. The thin-wall limit (δ → 0, b ≥ 0.5 D) is
1.0, Borda's mouthpiece; from δ/D 0.05 on it is the flush 0.5. Rennels is the same function's default formula,
1.12 − 22 t/d + 216 (t/d)² + 80 (t/d)³ (for a tube at least D/2 proud).

| mouth (free, 0.5 D proud) | 3-D K_total | 3-D K_total + (α₂₂ − 1) | 2-D K_total | 2-D K_total + (α₂₂ − 1) | Idelchik (diag. 3-1) | Rennels | flush 3-D, §4 (g) |
|---|---|---|---|---|---|---|---|
| sharp, wall 1.0 mm (t/D 0.02) | 0.594 | **0.639** | 0.571 | **0.629** | 0.72 | 0.767 | 0.392 (plain cut, 3 mm wall) |
| sharp, wall 2.5 mm (t/D 0.05) | 0.433 | **0.482** | 0.379 | **0.443** | 0.50 | 0.570 | 0.392 |
| rolled lip r/D 0.04 (2 mm), standing free | 0.224 | **0.280** | 0.220 | **0.289** | — (flush: 0.26; Crane 0.24) | — | 0.262 |

α at 10 / 22 D: 3-D 1.078–1.082 / 1.045–1.052, 2-D 1.088–1.095 / 1.058–1.070. Developed f from the total-pressure
slope over 10–22 D: 3-D 0.0191 / 0.0187 / 0.0179, 2-D 0.0186 / 0.0180 / 0.0172 (Colebrook 0.0180). Every run
converged by the report's criteria: 3-D at 900 / 900 / 950 iterations (2,766 s, 1,349 s, 1,428 s on one shared core;
498,236 / 295,622 / 323,287 cells by checkMesh, the lip refined to level 6 / 5 / 5 = 0.39 / 0.78 / 0.78 mm cells,
2.6 / 3.2 / 5.1 across the thinnest wall, 2.6 across the 2 mm lip radius), 2-D at 3,590 / 3,450 / 3,130 iterations (2,062 / 2,043 / 1,398 s; 29,441 / 29,611 /
28,000 cells, wall-resolved, y+ on the tube 0.58 / 0.58 / 0.84 average). y+ on `tract_wall` (3-D, whole patch average): 25.1 / 39.0 / 39.3.

Plenum-patch faces with centres inside the bore (the ledge count of §4 (c3), on `plenum_wall` and `inlet_wall`,
upstream of the plenum wall + 1 mm): 0 and 0 in every 3-D case here and in the owner's two free cases below.
`cache { grad(U); }` is in every 3-D `fvSolution`. The snapped `inlet_wall` area against the drawn surface (the faceted STL): −0.35 % (t/D 0.02), −0.62 % (t/D 0.05),
−0.38 % (r/D 0.04), −0.38 % and −0.09 % (the owner's plain and lip); checkMesh OK in all five.

**Lip resolution.** As first written, the free mount refined the protruding wall only by its thickness (2.5 cells
across): the 2 mm lip's 4 mm half-torus got level 4, 1.56 mm cells, 1.3 across the lip radius, and read K_total
0.372 (0.423 on the handbook basis; `runs/f3_r004_level4`, 208,347 cells, 900 iterations, 920 s), 0.13 above the
2-D sector. The same case with `inlet_wall` and `lipShell` set to level 5 by hand (0.78 mm, 2.6 across the radius;
`runs/f3_r004_l5`, 359,666 cells, 900 iterations, 1,513 s) read 0.225 / 0.281. So the generator now also asks for at
least 2 cells across a rounded lip's radius (`LIP_CELLS_3D`; radius lips, a taper's lip, an ellipse's corner
radius): the table's r/D 0.04 row is that default (level 5, 0.224 / 0.280), and 3-D and 2-D agree within 0.01
there as for the thin wall. The owner's 3.5 mm lip below was meshed at level 5 before the rule (1.447 mm, 2.4 across
its radius) and the rule leaves it there, so its case is the same mesh. A plain cut, a profile mouth and an
ellipse's square rim keep the thickness rule alone (their edges are machined-edge radii, meant as sharp).

**Reading.** On the handbooks' basis the free-standing mouths in 3-D and in the 2-D sector agree within 0.010
(t/D 0.02), 0.039 (t/D 0.05) and 0.009 (r/D 0.04 lip). Against Idelchik's re-entrant table both lie below it: by
0.08–0.09 at t/D 0.02 and by 0.02–0.06 at t/D 0.05, the same direction as the flush sharp edge of §4 (g) (0.11 under),
where the k-ω SST vena contracta recovers with less loss than the handbook square edge. The re-entrant penalty over
the flush mouth is reproduced: at t/D 0.02 the 3-D CFD gives 0.639 − 0.392 = 0.247 over its own flush sharp edge,
Idelchik 0.72 − 0.50 = 0.22. At t/D 0.05 Idelchik and Rennels have no penalty left (0.50 and 0.57, their flush
values); the CFD keeps +0.09 (3-D) and +0.05 (2-D against the 2-D flush 0.396, total pressure, 20–40 D: not quite
like for like). For the rounded lip there is no re-entrant handbook figure; standing free costs it 0.02 over the flush
3-D 0.262 (2-D: 0.289 against 0.239 static − 1 in §4 (c)).

**The owner's CAI, free-standing** (bore 92.61 mm, 880.62 mm, wall 4.76 mm, the two bends of §4 (h) at 127 mm
centre-line radius, 0.3694 kg/s, 25 °C, simpleFoam forced, medium mesh; total-pressure loss at the tract end, q
1,270 Pa). The free mount's default protrusion is one bore (92.61 mm), which ends before bend 1 at 100 mm:

| case | tract-end loss | K | cells (checkMesh) | iterations / wall time |
|---|---|---|---|---|
| (1) flange-mounted, plain cut (the §4 (h) reference, 1,063 Pa) | 1,062.8 Pa (4.267 inH2O) | 0.837 | 131,120 | 900 / 500 s |
| (2) free-standing, plain cut (4.76 mm wall) | 1,208.0 Pa (4.850 inH2O) | 0.951 | 352,344 | 900 / 1,488 s |
| (3) free-standing, 3.5 mm rolled lip | 683.2 Pa (2.743 inH2O) | 0.538 | 388,717 | 970 / 1,803 s |
| (4) flange-mounted, plain cut, 60 mm cone 92.61 → 105 mm from 880.62 mm | 1,079.9 Pa (4.335 inH2O) at the tract end (1,000 mm, in the 105 mm bore); 1,053.0 Pa (4.227 inH2O) at the tube end (880.62 mm); 1,068.9 Pa (4.291 inH2O) at the throttle face (940.62 mm) | 1.405 / 0.828 / 1.352, each on its own bore | 148,649 | 900 / 540 s |

Case (1) repeats §4 (h) to the pascal. Standing free costs the plain cut 145 Pa (+13.7 %, +0.114 in K), the size
of the straight tube's re-entrant penalty at t/D 0.05 (+0.09, table above). The flange-mounted 3.5 mm lip of §4 (h)
read 679 Pa; free-standing it reads 683 Pa (+0.6 %), as the straight tube's r/D 0.04 lip costs only 0.02 in K more
standing free than flush. The lip saves 525 Pa standing free against 384 Pa flush-mounted: a sharp re-entrant mouth
is the one that loses by standing free. Case (4): the cone's K is referred to the bore at each plane (§2): at the tract end
q is that of the 105 mm bore, 0.61 of the tube's.

### (j) A measured mouth profile against the ellipse it was taken from (2026-11-11)

Is the profile inlet (§2) the same mouth as the shape it was measured from? The 25 mm × 80 mm elliptical bellmouth of
Blair & Cahoon's kind (`ellipse`, L 25 mm, Di 80 mm, De 50 mm, square 1.5 mm rim) against the same flare given as 21
points a CAD reader would send (`profile`; x 0, 0.05, 0.15, 0.3, 0.6, 1, 1.6, 2.4 … 23.8, 25 mm, r from the ellipse,
rounded to 0.0001 mm; the ellipse itself is written with 73 points, so the two walls and the mouth block corners
differ): 2-D, flange, straight 50 mm tube, L 25 D, Re 1.0 × 10⁵, simpleFoam, medium, K from 10–22 D as (i)
(`freemount3d.py`, `runs/p2_ell`, `runs/p2_prof`):

| mouth | K_total | K_total + (α₂₂ − 1) | tract-end loss | f (10–22 D) | cells / iterations / wall time |
|---|---|---|---|---|---|
| ellipse | 0.0040 | 0.0866 | 221.52 Pa | 0.01525 | 33,581 / 3,120 / 2,876 s |
| the same flare as 21 measured points | 0.0042 | 0.0869 | 221.65 Pa | 0.01525 | 33,581 / 3,130 / 2,113 s |

ΔK 0.0003 (+0.06 % in the tract-end loss), well inside the sharp entrance's medium-to-fine mesh change of §4 (c)
(0.004). The 3-D profile path revolves the same points (Rust and Python byte-identical, `gen_rs_vs_py.py`); it was
not solved here. A first attempt fed the ellipse's own 73 generator points back: that mesh differed from the
ellipse's only in the 12th digit of one block corner, so it was not run as a test.

### (k) A cone over a bend in 3-D (2026-11-11)

Test (mesh only): bore 92.6 mm, plain cut 4.76 mm wall, flange, a 60° bend on 127 mm centre-line radius from 200 mm
and a cone 92.6 → 105 mm over exactly the bend's arc (133.0 mm, 2.669° a side), medium mesh. `checkMesh`: mesh OK,
139,692 cells, max non-orthogonality 64.5, max skewness 1.54; layers on `tract_wall` 94.3 % (3.73 of 4); the
snapped `tract_wall` area 0.18726 m² against the drawn surface's 0.18751 m² (−0.13 %); 0 plenum faces inside the
bore. So the generator now takes a cone that overlaps a bend (Python and Rust, `gen_rs_vs_py.py` designs "cone on a
bend" and "reducer, then a cone half on a bend, free mount"): the rings of the swept tube follow the bend's frames
with the radius `tube_radius` gives at that path length, and the cone's two ends are rings of their own (only when a
cone overlaps a bend, so every other design writes the same bytes as before). This case was not solved: its loss
against a cone on a straight was not measured.

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
  "fine" 3-D run was no check at all. The conda-forge Linux build gave 3-D
  losses about 6 % above ESI's build on the same mesh until every 3-D case cached grad(U) (§4 (d), (f)), and our
  Windows build has only been compared with Linux on the 2-D cases.
- **3-D mounting.** Since 2026-11-11 a parametric 3-D case honours `mount: free` (§4 (i)); a 3-D design that names
  no mount is still flange-mounted. The free-standing tube's outside is a straight cylinder from the lip to the
  plenum wall, so the protrusion must end before the first bend or diameter change (a tube that leaves its mouth in a
  bend has to be run flange-mounted), and the outside is a smooth wall (no hose clamps, beads or filter cuff). The
  protruding wall is meshed to 2.5 cells across its thinnest point: a thin wall makes the case large (the owner's
  92.61 mm tube with a 1.65 mm wall: about 2.8 million cells estimated at medium, against 0.23 million with its 4.76 mm
  wall and 0.06 million flange-mounted), and a wall too thin for four refinement levels above the wall level is refused. STL cases
  are always flange-mounted.
- **Cones and measured mouths.** A cone is straight between its two bores; an S-shaped or stepped change is the
  Fusion reader's job to approximate (fusion-addin/tubecfd.py says by how much). A measured mouth (`profile`) is the
  polyline through its points, square-rimmed; its first segment must leave the mouth plane at 45° or more.
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
