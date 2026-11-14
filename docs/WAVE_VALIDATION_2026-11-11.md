# Cross-validation of the 1-D wave model, 2026-11-11

Scope: the page's 1-D engine gas-dynamics model (`wsFactory` in `web/index.html`: `runSpeed`, the pipe scheme, its
ends, junctions, valves and cylinders; the Rust/WebAssembly copy in `rust/et_wave`), checked (1) against exact or
textbook answers for its building blocks and (2) against OpenWAM (CMT, UPV; the patched build in `ext/OpenWAM`) on whole
engines, like for like. Defects were fixed only where a known-answer test failed for a reason that could be named, and
each fix has a test that fails before it and passes after it. Nothing was tuned towards OpenWAM.

This work was started by one session that was stopped by a machine restart and finished by a second one, which reviewed
the first one's solver changes as an outside pull request (section 2) before building on them.

Scripts: `tools/validation/wave/` (`lib.js` loads the page's model into Node with optional read-only instrumentation;
`kat.js` known answers; `engine.js` one engine at several speeds with per-cycle mass and energy balances and traces;
`compare.py` the OpenWAM matrix; `gridconv.py` grid convergence; `report.py` the tables below). Result files:
`tools/validation/wave/results/*.json`. Regression test: `web/tests/wavekat_ui.js` (Node, about 20 s).

## 1. History: accepted model differences between the wave model and OpenWAM (from docs/STATUS.md and the code)

| Area | Wave model (page) | OpenWAM as the page writes it | Where recorded |
|---|---|---|---|
| Gas properties | ideal gas, constant gamma 1.35, R 287 | gamma from composition and temperature (gamma_model 2) | code; this document, section 4.3 |
| Combustion | Wiebe `1 - exp(-5 (a/dur)^3)` (a 5, m 2), heat = fresh charge / AFR x LHV 44 MJ/kg x eta | the same Wiebe (a 5, m 2, start, duration); heat = fuel x LHV x combustion efficiency; the page's own OpenWAM cases now use 0.98 min(1, 1/phi) because Woschni already takes the wall heat (v6, 2026-11-03) | STATUS 2026-11-03 "Upgrades" |
| Cylinder wall heat | Woschni with a combustion term, one wall temperature | Woschni per surface (liner, head, piston) | code |
| Valve flow | quasi-steady orifice from the pipe cell's stagnation state (or the cylinder's), area n Cd min(pi d l, 0.85 pi d^2/4), sin^2 lift | the same area law written as a CD table referred to the pipe area (make_wam `cd_table`), solved with the pipe's characteristic (Benson) | make_wam.py `cd_table`, `CALC_CURTAIN_CAP` |
| Pipe friction and heat | constant Fanning 0.005 (Darcy 0.02) and Reynolds' analogy St = f/2 | Colebrook-type friction from roughness; intake heat transfer after Depcik-Assanis, exhaust its own correlation | kat.js e |
| Open end | no radiation end correction (pressure-release end at the pipe's end) | the writer's default adds 0.6133 r (make_wam v14); this comparison writes `open_end_corr 0` | make_wam.py v14 |
| Junctions | n-pipe: one static pressure, mixed inflow; two-pipe diameter steps: see section 2 | BC 12 (TCCRamificacion) n-pipe junctions; TCCUnionEntreTubos for diameter steps | STATUS 2026-11-05 "Sound with no file" |
| Discretisation | MUSCL-Hancock with minmod and HLLC, 10 mm cells (12.5 mm with a collector), CFL 0.8 | TVD scheme, 10 mm cells here | STATUS (cell-size check at the RS 660 hold) |
| Mass conservation | exact to rounding (section 4.2: 2e-14 per cycle) | OpenWAM's closed valves and open ends do not conserve mass (runner gas drifts into a closed valve) | STATUS "OpenWAM's mean pipe flows are no mass balance" |
| Sound | monopole p = (1/4 pi r) d mdot/dt of the tail ends' face flux | the same law applied to OpenWAM's INS.DAT tail flow | STATUS "Sound with no file" |
| Earlier engine-level checks | default V8, 2.5 m line: firing orders within 1-9 dB of OpenWAM, between-firing orders 20-40 dB weaker (OpenWAM's last cycles still changing) | | STATUS 2026-11-05 |

## 2. Defects fixed (each with a test that fails before and passes after)

The first session changed two boundary conditions; the second session reviewed both as an outside pull request, then
found and fixed a third. For each: the known-answer rows were rerun on the page before (commit c18496b) and after, the
Rust copy was compared line by line, the WebAssembly was rebuilt from a clean target directory (byte-identical to the
embedded copy) and `web/tests/wave_wasm.js` passed bit-identically. That test was edited only to ADD a job (a stepped
intake runner and a single cylinder's pipe through a 127 mm chamber, 3000-9000 rpm), so the junction's new laws and
their fallback are covered by the parity check; no existing comparison was removed or loosened.

### D1 Open end (`openGhost` + HLLC -> `openState`, characteristic method). KEPT.

Before: a ghost cell at the outside pressure for outflow and, for inflow, at the cell's pressure with a Bernoulli speed
sqrt(2 dp / rho), fed through HLLC. Known answers on the page before (`kat.js` d, c; `wavekat_ui.js`):

| Check | Before | After | Exact |
|---|---|---|---|
| -100 Pa Gaussian pulse at a 50 mm open end: abs(R) at 100 / 250 Hz | 7.97 / 7.72 (a dip came back eight times larger) | 0.998 / 0.990 | 1 |
| +100 Pa pulse: abs(R) at 100 / 250 Hz | 0.997 / 0.987 | 0.998 / 0.989 | 1 |
| reflection node from the pipe end (+100 / -100 Pa) | +4.75 / -5.76 mm | -0.07 / +0.01 mm | 0 (no end correction in a 1-D pressure-release end) |
| open-closed 1 m pipe, mode decay (modes 1, 2, 3, 5, 9) | -2.5 to -0.95 dB per wavelength (the modes GREW) | +0.004 to +0.11 | >= 0 |
| open-closed mode 2 frequency | 253.99 Hz (-0.36 %) | 254.90 Hz (-0.003 %) | 254.91 Hz |
| steady inflow from 1.15 bar through a 60 -> 40 mm cone: inflow face mass flux on successive steps | 0.3147 / 0.1196 kg/s (flips every step) | 0.2227 / 0.2227 | steady |
| same: mass flow / isentropic | -2.8 % | -0.49 % | 0 |
| same: exit stagnation temperature | 303.5 K | 300.00 K | 300 K (adiabatic) |
| same: stagnation-pressure spread along the pipe | 4.1 % of p0 | 0.28 % | 0 (inviscid) |
| choked outflow from 3 bar: mass flow / A p0 psi* / sqrt(R T0) | -0.007 % | -0.007 % | 0 |

The new end is Benson's: the pipe's arriving Riemann invariant meets the outside; outflow leaves at the outside pressure
(sonic at most), inflow comes from still air at pa, Ta isentropically (no entrance loss, as before), at most sonic,
solved in closed form; the face flux is the flux of that end state. JS `openState` and Rust `open_state` were compared
term by term (same operations in the same order).

### D2 Two-pipe junction (diameter steps; one static pressure -> two pressures). KEPT.

Before: both sides of a diameter step held one static pressure. With the stagnation enthalpy kept, that makes a
contraction GAIN stagnation pressure (the downstream dynamic head is larger at the same static pressure), against the
second law, and an expansion lose the whole difference of the dynamic heads. Now (Benson; OpenWAM's
TCCUnionEntreTubos): into the smaller pipe the flow contracts isentropically, into the larger it expands with
Borda-Carnot's momentum balance (step face at the upstream pressure); a 2x2 Newton solve, with the old one-pressure
solve kept as the fallback when it fails or an end would be sonic. At no flow both laws give one pressure, so small
waves split as linear acoustics says.

| Check (4:1 area step, reservoir 1.08 bar, 300 K, 1 m each side) | Before | After | Reference |
|---|---|---|---|
| contraction: stagnation-pressure change | +82.9 kPa gained | -6e-8 Pa | >= 0 lost (isentropic ideal 0) |
| contraction: mass flow / isentropic limit | 0.553 / 0.157 kg/s (3.5 times, sonic) | 0.15694 / 0.15694 | <= 1 |
| contraction: entropy change | -163 J/kg/K | -1e-12 | >= 0 |
| expansion: stagnation-pressure loss / compressible Borda-Carnot | 6261 / 3819 Pa (1.64 times) | 6052 / 6052 Pa | 1 |
| expansion: entropy change | +17.1 J/kg/K | +16.6 J/kg/K | > 0 |

The contraction is modelled as lossless (as OpenWAM's step); a real sharp-edged contraction loses about
K = 0.5 (1 - A2/A1) of the downstream head (here 2444 Pa). That is a modelling choice shared with OpenWAM, not a defect;
see the recommendations.

### D3 Closed ends and valve ends (`wallEnd`, `fedEnd`): the end cell's pressure -> the characteristic end pressure. NEW.

Found by this review: the closed-closed check of section 3 b showed a standing wave's amplitude GROWING in an inviscid
pipe. A wall (`wallEnd`, used for dead-end stubs) and every valve end (`fedEnd`, every intake runner and primary at its
valve, which is a wall whenever the valve is shut) put the end cell's own pressure on the end face. The physical face
pressure is where the pipe's arriving wave meets the end: p + rho c u for a small wave moving into a wall. Without that
term the end does work on the wave. Experiment (`kat.js` b, closed ends; inviscid, 1 m, 40 periods, eps 1e-3):

| Ends, mode, cells | Amplitude after 40 periods / start, before | after | Entropy change (sum m ln(p/rho^gamma)), before | after |
|---|---|---|---|---|
| wall, mode 1, 10 mm | 1.0463 | 0.9756 | -7.6e-12 | +3.6e-12 |
| wall, mode 1, 5 mm | 1.0102 | 0.9928 | -1.8e-12 | +0.9e-12 |
| wall, mode 4, 10 mm | 1.0831 | 0.8216 | -1.4e-11 | +2.5e-11 |
| wall, mode 4, 5 mm | 1.0202 | 0.9518 | -3.4e-12 | +7.2e-12 |
| shut valve (`fedEnd`, no flow) | identical to the wall rows | identical | | |

A mirror ghost cell through HLLC (the textbook reflecting wall, tried as an independent check) gives the same "after"
numbers to four digits. The growth was independent of the amplitude (eps 1e-3 and 1e-4 the same), so it was linear, not
a nonlinear effect. Fix (`endP` in the page, `end_p` in Rust): the face pressure is the isentropic end state on the
arriving characteristic at the face speed vn = m / (rho A) implied by the mass flux (the sound speed there clipped at
5 % of the cell's). It reduces to the reflecting wall at no flow, gives the stream's own pressure in steady flow either
way, and changes continuously with the flow, so a closing valve has no jump. Two intermediate versions failed tests and
were not kept: (1) vn from the mass flux also for gas coming IN made `web/tests/wsndload_ui.js` (a throttled engine,
manifold 56 kPa) fail, indicated torque NaN at 2000 rpm and 140.7 N m at 3000 rpm instead of the friction torque
(20.5 / 25.6 N m on the page before): the incoming gas is the cylinder's hot jet, and its face speed taken with the cold
runner gas's density passes the sound speed; (2) vn = 0 for gas coming in passed that test but put a steady incoming
stream's face pressure rho c u (6.7 kPa) below its own pressure and halved the flow (the new row "c steady inflow through
a valve end"). Kept: for gas coming in, vn is held between 0 and the end cell's own speed (wsndload 20.3 / 25.1 N m;
steady inflow face pressure within 1e-10 Pa of the stream's). Mass and energy fluxes are unchanged (exactly conservative as before). With the masking removed the
scheme's own dissipation is now measured cleanly: 0.043 / 0.149 / 0.58 dB per wavelength at 50 / 25 / 12.5 cells per
wavelength, falling 4.0-4.2 times per halving of the cells (second order).

Engine-level effect on all 48 engine runs of section 4 (`results/inherited.json` against `results/base.json`): VE
changes by -4.0 % to +2.9 % (single_L800 at 3000 rpm, single_muffler at 3000 rpm), mostly about -1 %; the mean
exhaust-port pressure rises by 1.2 kPa (median; +0.5 to +2.1 kPa), towards OpenWAM's. Agreement with OpenWAM was not the reason for
the change (section 4.4: the VE correlation rose on 7 of 8 configurations, by 0.02-0.08 on the single 0.8 m pipe and the
V8s); the reason is the second-law test above.

## 3. Known answers of the building blocks (the page after D1-D3)

`node tools/validation/wave/kat.js` (about 10 s; writes `results/kat.json`): 105 rows, 66 with a pass criterion, all pass; the rest are reported numbers.
Pipes a-d run inviscid (Fanning set to 0 in a copy of the model; the page is not modified), e runs the model as the page
does. Gamma is the model's 1.35 throughout.

### a. Sod shock tube (rho 1 / 0.125, p 1e5 / 1e4 Pa, walls far away) against the exact Riemann solution (Toro ch. 4)

| Quantity (400 cells) | Model | Exact | Error |
|---|---|---|---|
| p* plateau | 30,525 Pa | 30,526 Pa | -0.004 % |
| u* plateau | 299.35 m/s | 299.34 m/s | +0.005 % |
| rho* left / right of the contact | 0.41515 / 0.27511 | 0.41522 / 0.27512 | -0.016 % / -0.002 % |
| shock speed | 549.06 m/s | 548.59 m/s | +0.086 % |
| contact speed (half-density crossing) | 298.0 m/s | 299.3 m/s | -0.44 % |
| L1(rho) error / (rhoL - rhoR) | 0.21 % | | |
| L1(rho) convergence order, 100->200->400->800->1600 cells | 0.81, 0.89, 0.82, 0.81 | about 1 (discontinuities limit any scheme) | |

### b. Acoustic modes (1 m pipe, 298 K, 10 mm cells unless stated; eps 1e-3)

| Case | Measured | Exact | Note |
|---|---|---|---|
| closed-closed, modes 1 / 2 / 4 / 8 | 169.938 / 339.868 / 679.677 / 1359.01 Hz | n c / 2L: 169.940 / 339.880 / 679.759 / 1359.52 | -0.001 % to -0.038 % (200 to 25 cells per wavelength) |
| closed-closed, mode 16 (12.5 cells per wavelength) | 2717.59 Hz | 2719.04 | -0.053 %; 5 mm: -0.040 % |
| open-closed, modes 1 / 2 / 3 / 5 / 9 | 84.970 / 254.905 / 424.828 / 764.616 / 1443.91 Hz | (2n-1) c / 4L: 84.970 / 254.910 / 424.850 / 764.729 / 1444.49 | the model's open end has no end correction: the node is at the pipe's end (D1 table) |
| dissipation of a standing wave | 0.005 / 0.014 / 0.043 / 0.149 / 0.58 dB per wavelength at 200 / 100 / 50 / 25 / 12.5 cells per wavelength | 0 | second order: 4.0-4.2 times less per halving of the cells |
| closed ends may not make a wave grow nor the entropy fall | all 16 rows pass | | D3 |

What the page's cells mean for an engine: at 10 mm and 700 K exhaust gas, 1 kHz has 53 cells per wavelength
(about 0.04 dB per wavelength), 2 kHz 26 (0.15 dB), 4 kHz 13 (0.6 dB); in 298 K intake air 1 kHz has 35. A sharp
pulse loses more than a pure tone: a 40 mm Gaussian pulse travelling 3 m to the open end and back keeps
abs(R) = 0.960 / 0.854 at 500 / 1000 Hz at 10 mm cells, 0.988 / 0.954 at 5 mm and 0.996 / 0.988 at 2.5 mm (an ideal
pressure-release end has abs(R) = 1 at every frequency), so this loss is the travel through the cells, not the end.

### c. Steady flow: smooth cone and sudden area change

Smooth 60 -> 40 mm cone from a 1.15 bar, 300 K reservoir to the atmosphere: mass flow 0.2227 kg/s against the
isentropic 0.2238 (-0.49 %), interior face fluxes within 0.084 %, exit stagnation temperature 300.00 K, stagnation
pressure within 0.28 % of p0 along the pipe. Sudden 4:1 contraction and expansion: D2 table. Steady flow fed into a
40 mm pipe through a valve-type end (0.05 kg/s, 300 K): end face pressure equal to the stream's to 1e-10 Pa (rho c u
there 13.6 kPa; D3).

### d. Open end

Low amplitude (+-100 Pa, 50 mm pipe): abs(R) 0.998 at 100 Hz, 0.990 at 250 Hz, inverted (phase 180.0 deg), node at
the pipe end (within 0.1 mm); at 700 K abs(R) 0.999 / 0.995. The model's end is a 1-D pressure-release end: no radiation
loss and no end correction (an unflanged pipe's would be 0.6133 r = 15.3 mm, Levine and Schwinger). The page's acoustic
tools add that correction; the wave model does not, and neither does OpenWAM as compared here (`open_end_corr 0`).
Large amplitude (+-10 kPa): abs(R) 0.94 / 0.99 at 100 Hz for a positive / negative pulse (nonlinear steepening and the
outflow/inflow asymmetry; no exact reference). Choked outflow from 3 bar through 40 mm: 0.8686 kg/s against
A p0 psi* / sqrt(R T0) = 0.8687 (-0.007 %), exit Mach 1.013, exit pressure 1.426 % below the critical pressure (the
end cell is half a cell from the face).

### e. Friction and wall heat transfer

| Check | Model | Stated law | For scale |
|---|---|---|---|
| Darcy factor from the pressure gradient, 40 mm, 45 m/s, Re 1.2e5 | 0.019999 | Fanning 0.005 = Darcy 0.02 (-0.004 %) | Blasius 0.0171, Colebrook (0.02 mm roughness) 0.0199 |
| Stanton number, 700 K gas, 400 K wall, Re 5.6e4 | 0.002483 | Reynolds' analogy f/2 = 0.0025 (-0.7 %) | Dittus-Boelter (cooling) 0.0033, Depcik-Assanis 0.0064 |

The model does what it states. The constant friction factor is close to Colebrook at this Reynolds number; the
Reynolds-analogy wall heat is 25 % under Dittus-Boelter and 60 % under the Depcik-Assanis correlation that OpenWAM uses
for intakes (a modelling difference, section 5).

## 4. Engine level against OpenWAM

### 4.1 Set-up (like for like)

Each configuration is one engine spec in the page's `simSpec` form, read by both the wave model (`engine.js`) and
OpenWAM's writer (`openwam/make_wam.py`, the same writer the page's OpenWAM export mirrors), so geometry, valve lift
law and flow area, cam timing, Wiebe burn, heat released per unit of fresh charge (OpenWAM's combustion efficiency set
to the wave model's eta 0.72), cylinder and pipe wall temperatures and initial gas temperatures are the same. OpenWAM:
10 mm cells, TVD, 30 cycles, `open_end_corr 0`, INS output every 0.5 deg. Wave model: the page's grid (10 mm; 12.5 mm
with a collector), 12 cycles from a cold start per speed. Engine: the calculator's default inline 4 cylinder
(84 x 89 mm, CR 11.5, 2 x 33.6 mm intake and 2 x 28.6 mm exhaust valves, Cd 0.7, cam 32/44/48/20 at the seat,
Wiebe from 18 deg BTDC over 55 deg, AFR 12.8, 0.3 m intake runner open to the air).

| Configuration | Exhaust | Speeds (rpm) |
|---|---|---|
| single_L400 / L800 / L1200 | one cylinder, a plain 44.5 mm pipe 0.4 / 0.8 / 1.2 m long, open | 3000-8000, step 1000 |
| single_muffler | one cylinder, 0.5 m of 44.5 mm, a 0.3 m x 127 mm chamber (diameter steps), 0.6 m of 44.5 mm | 3000-8000 |
| i4_41 | inline 4, 4-1 (0.68 m primaries, collector cone and megaphone to 113 mm), firing 0-180-360-540 | 2500-7500, step 1000 |
| v8_2x41 | cross-plane V8 (firing 1-8-4-3-6-5-7-2), each bank's 4-1 open after its collector | 2000-6500, step 900 |
| v8_line | as v8_2x41, each collector into a 63.5 mm line (150 mm cone, 1.5 m) | 2000-6500 |
| v8_line_X | as v8_line with an X joining the two lines 650 mm after the merges (one four-way node) | 2000-6500 |

Not run: a 2-stroke with an expansion chamber. OpenWAM's 2-stroke writer exists (`make_wam2t.py`), but the page's wave
model has no 2-stroke cycle (`makeEngine` is 4-stroke only), so there is nothing to compare.

Remaining input differences (not removable without changing either code): the gas properties, the pipe friction and
heat-transfer laws, the valve boundary's method and the in-cylinder wall heat split (section 1). Metrics (`compare.py`):
VE = trapped fresh charge per cycle over the displaced mass at 298 K and 1 atm; port pressure 10 mm from the exhaust
valve; tailpipe sound as the monopole of the summed open-end mass flows at 1 m; OpenWAM's heat released = its fuel mass
x 44 MJ/kg x 0.72 (its Combustion_Heat column is 0 in this build).

### 4.2 Results (the page after D1-D3; `results/base.json`)

All 48 wave-model runs balance mass and energy over the last cycle to 2.5e-14 and 1.4e-14 of the inflow and of the heat
released (the energy budget counts the pipe-wall heat and the cylinder wall heat and work): known-answer check f, conservation over an engine cycle.

| configuration | speeds (rpm) | VE corr | VE peak wave / OpenWAM | VE mean ratio | max |dVE| | port p corr (median) | port p-p amplitude ratio (median) | mean port p wave - OpenWAM (kPa, mean) | NMEP ratio (mean) | indicated eff. of heat released wave / OpenWAM (mean) |
|---|---|---|---|---|---|---|---|---|---|---|
| single_L400 | 3000-8000 | 0.988 | 5000 / 5000 | 1.051 | 0.073 | 0.85 | 0.93 | -3.5 | 1.271 | 0.479 / 0.396 |
| single_L800 | 3000-8000 | 0.987 | 5000 / 5000 | 1.036 | 0.062 | 0.35 | 1.00 | -1.4 | 1.255 | 0.472 / 0.390 |
| single_L1200 | 3000-8000 | 0.985 | 5000 / 5000 | 1.043 | 0.081 | 0.89 | 1.03 | -1.5 | 1.264 | 0.472 / 0.389 |
| single_muffler | 3000-8000 | 0.984 | 5000 / 5000 | 1.025 | 0.070 | 0.61 | 1.00 | -1.1 | 1.237 | 0.471 / 0.390 |
| i4_41 | 2500-7500 | 0.995 | 5500 / 5500 | 1.054 | 0.071 | 0.57 | 1.07 | -3.0 | 1.275 | 0.481 / 0.398 |
| v8_2x41 | 2000-6500 | 0.986 | 5600 / 5600 | 1.031 | 0.050 | 0.09 | 1.32 | -1.7 | 1.220 | 0.479 / 0.405 |
| v8_line | 2000-6500 | 0.929 | 5600 / 5600 | 1.051 | 0.079 | 0.25 | 1.02 | -2.9 | 1.248 | 0.477 / 0.402 |
| v8_line_X | 2000-6500 | 0.956 | 5600 / 5600 | 1.049 | 0.091 | 0.29 | 1.09 | -3.2 | 1.244 | 0.478 / 0.403 |

Read: the VE curve's shape and its peak speed agree on every configuration (same peak speed in all 8; correlation
0.93-1.00); the wave model's VE level is 2.5-5.4 % higher; its exhaust-port pressure is 1.1-3.5 kPa lower on average;
its net IMEP is 22-28 % higher, because it turns 47-48 % of the heat released into net work where OpenWAM turns
39-40 %. Port-pressure traces agree in amplitude (median ratio 0.93-1.09, the per-bank V8 1.32) but their phase often
does not (median correlation 0.1-0.9): see 4.3.

Tailpipe order levels, wave minus OpenWAM, at 0.5, 1, 1.5, 2 and the firing order's multiples:

| Configuration | Firing orders and multiples | Other orders |
|---|---|---|
| single cylinder (4 configurations, orders 0.5-2) | median 1.2-1.4 dB, 21-22 of 24 within 3 dB | - |
| i4_41 (orders 2, 4, 8) | median 3.7 dB, 8 of 18 within 3 dB | 0.5, 1, 1.5, 3: 50+ dB below the firing orders in OpenWAM (median -53 dB); both are numerical floor, differences meaningless |
| v8_2x41 (4, 8, 16) | median 3.5 dB, 9 of 18 within 3 dB | 0.5-2, 6 (a bank's 4-1 on a cross-plane crank fires unevenly, so 1 and 2 are real): median 7.6 dB |
| v8_line | median 6.9 dB, 4 of 18 | median 8.5 dB |
| v8_line_X | median 7.3 dB, 6 of 18 | median 9.9 dB |

Per speed (dB, wave - OpenWAM):


**single_L400** (orders: 0.5, 1.0, 1.5, 2.0)

| rpm | 0.5 | 1.0 | 1.5 | 2.0 | VE wave / OpenWAM |
|---|---|---|---|---|---|
| 3000 | -0.4 | -1.4 | -1.8 | -0.9 | 0.987 / 0.930 |
| 4000 | -0.7 | -1.1 | -1.0 | -0.9 | 1.067 / 1.014 |
| 5000 | -0.0 | -0.3 | -0.4 | -1.7 | 1.147 / 1.074 |
| 6000 | -1.0 | -0.8 | -0.8 | -2.3 | 1.081 / 1.038 |
| 7000 | -1.6 | -2.4 | -3.0 | -3.8 | 0.985 / 0.960 |
| 8000 | -1.4 | -2.2 | -2.6 | -6.7 | 0.869 / 0.821 |

median |difference| 1.4 dB, 21 of 24 within 3 dB

**single_L800** (orders: 0.5, 1.0, 1.5, 2.0)

| rpm | 0.5 | 1.0 | 1.5 | 2.0 | VE wave / OpenWAM |
|---|---|---|---|---|---|
| 3000 | -0.3 | -1.3 | -1.3 | -0.5 | 0.985 / 0.931 |
| 4000 | -1.8 | -1.9 | -1.7 | -1.1 | 0.960 / 0.964 |
| 5000 | -1.1 | -0.8 | -0.1 | +12.3 | 1.156 / 1.095 |
| 6000 | -0.3 | -0.3 | +0.3 | -1.1 | 1.121 / 1.076 |
| 7000 | -0.8 | +1.2 | +15.2 | +1.2 | 0.998 / 0.966 |
| 8000 | -0.6 | +1.5 | +1.4 | +1.4 | 0.796 / 0.774 |

median |difference| 1.2 dB, 22 of 24 within 3 dB

**single_L1200** (orders: 0.5, 1.0, 1.5, 2.0)

| rpm | 0.5 | 1.0 | 1.5 | 2.0 | VE wave / OpenWAM |
|---|---|---|---|---|---|
| 3000 | -2.0 | -2.7 | -2.5 | +3.6 | 0.955 / 0.925 |
| 4000 | -0.7 | -1.3 | +1.1 | -1.2 | 1.083 / 1.035 |
| 5000 | -0.8 | +0.9 | -2.3 | +0.9 | 1.163 / 1.082 |
| 6000 | +0.1 | +1.9 | +2.4 | +1.4 | 1.068 / 1.038 |
| 7000 | +0.2 | +1.8 | +0.4 | -0.6 | 0.950 / 0.935 |
| 8000 | -0.1 | +3.6 | -3.1 | +1.2 | 0.833 / 0.790 |

median |difference| 1.3 dB, 21 of 24 within 3 dB

**single_muffler** (orders: 0.5, 1.0, 1.5, 2.0)

| rpm | 0.5 | 1.0 | 1.5 | 2.0 | VE wave / OpenWAM |
|---|---|---|---|---|---|
| 3000 | -0.8 | +1.7 | +2.0 | -0.8 | 0.978 / 0.943 |
| 4000 | +0.2 | +1.8 | +5.6 | -0.7 | 1.064 / 1.024 |
| 5000 | +1.3 | +1.5 | +0.3 | +2.7 | 1.139 / 1.069 |
| 6000 | +1.1 | +0.3 | +1.6 | -0.1 | 1.006 / 1.000 |
| 7000 | +1.3 | +0.7 | +2.4 | -0.5 | 0.883 / 0.898 |
| 8000 | +1.7 | +1.4 | +0.8 | -9.9 | 0.791 / 0.783 |

median |difference| 1.3 dB, 22 of 24 within 3 dB

**i4_41** (orders: 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 8.0)

| rpm | 0.5 | 1.0 | 1.5 | 2.0 | 3.0 | 4.0 | 8.0 | VE wave / OpenWAM |
|---|---|---|---|---|---|---|---|---|
| 2500 | +13.5 | +12.9 | +9.7 | -3.2 | +14.0 | +1.2 | -2.1 | 0.927 / 0.877 |
| 3500 | -46.9 | -48.3 | -61.0 | +2.3 | -58.1 | +1.5 | +6.2 | 1.042 / 0.997 |
| 4500 | -70.2 | -63.4 | -64.0 | +7.3 | -83.9 | +4.0 | -0.6 | 1.106 / 1.043 |
| 5500 | -7.5 | -13.8 | +3.6 | -0.3 | -19.9 | -3.7 | -4.0 | 1.129 / 1.058 |
| 6500 | -60.9 | -66.5 | -65.5 | +5.4 | -65.9 | +6.7 | -8.1 | 1.053 / 1.008 |
| 7500 | -11.7 | +10.4 | -25.6 | +0.6 | +1.7 | -2.8 | -4.4 | 0.918 / 0.875 |

median |difference| 9.7 dB, 9 of 42 within 3 dB

**v8_2x41** (orders: 0.5, 1.0, 1.5, 2.0, 4.0, 6.0, 8.0, 16.0)

| rpm | 0.5 | 1.0 | 1.5 | 2.0 | 4.0 | 6.0 | 8.0 | 16.0 | VE wave / OpenWAM |
|---|---|---|---|---|---|---|---|---|---|
| 2000 | -7.6 | +3.9 | -34.8 | +19.6 | +3.0 | +3.9 | +14.8 | +4.1 | 0.952 / 0.918 |
| 2900 | -22.1 | +0.9 | -4.1 | +0.5 | -1.0 | +5.8 | +11.3 | +14.1 | 0.921 / 0.920 |
| 3800 | -46.7 | +5.7 | -54.8 | +14.2 | +0.1 | -2.9 | +7.4 | +1.9 | 1.021 / 0.994 |
| 4700 | -43.3 | +2.3 | -51.8 | -18.1 | +1.6 | +6.6 | -3.5 | -2.1 | 1.090 / 1.040 |
| 5600 | -19.9 | +2.4 | -19.5 | +3.6 | +2.1 | +9.6 | -0.3 | -10.8 | 1.095 / 1.057 |
| 6500 | -40.5 | -5.8 | -44.5 | -0.8 | +1.5 | +2.7 | -3.7 | -12.9 | 1.041 / 1.006 |

median |difference| 5.8 dB, 16 of 48 within 3 dB

**v8_line** (orders: 0.5, 1.0, 1.5, 2.0, 4.0, 6.0, 8.0, 16.0)

| rpm | 0.5 | 1.0 | 1.5 | 2.0 | 4.0 | 6.0 | 8.0 | 16.0 | VE wave / OpenWAM |
|---|---|---|---|---|---|---|---|---|---|
| 2000 | -16.7 | +5.2 | -11.1 | +2.3 | -3.2 | -8.8 | -7.9 | -12.1 | 0.982 / 0.921 |
| 2900 | -40.0 | +5.7 | -41.8 | -0.3 | +11.5 | -8.2 | -6.6 | -17.0 | 0.966 / 0.936 |
| 3800 | -16.2 | -3.8 | -8.5 | -2.5 | -5.4 | -10.5 | -10.4 | +7.5 | 1.048 / 0.969 |
| 4700 | -32.4 | -3.3 | -22.2 | +0.9 | +2.7 | +6.0 | +2.0 | +6.9 | 1.075 / 1.021 |
| 5600 | -63.8 | +8.5 | -62.7 | -6.8 | -0.8 | +0.2 | +6.9 | -13.2 | 1.088 / 1.050 |
| 6500 | -51.6 | +13.6 | -67.2 | +5.5 | +2.0 | +2.8 | +18.5 | +4.8 | 1.026 / 0.989 |

median |difference| 7.9 dB, 10 of 48 within 3 dB

**v8_line_X** (orders: 0.5, 1.0, 1.5, 2.0, 4.0, 6.0, 8.0, 16.0)

| rpm | 0.5 | 1.0 | 1.5 | 2.0 | 4.0 | 6.0 | 8.0 | 16.0 | VE wave / OpenWAM |
|---|---|---|---|---|---|---|---|---|---|
| 2000 | -27.2 | -4.4 | -25.3 | -0.2 | -2.3 | +7.4 | -9.9 | +7.9 | 0.926 / 0.895 |
| 2900 | -28.1 | +14.9 | -23.7 | -9.8 | +5.4 | -12.0 | +11.4 | +5.4 | 0.943 / 0.925 |
| 3800 | -1.8 | +1.2 | -19.4 | +4.0 | -1.3 | +14.3 | -16.7 | +7.3 | 1.073 / 0.982 |
| 4700 | -30.8 | -1.4 | -30.4 | -2.7 | -3.4 | +8.5 | -9.2 | -13.0 | 1.083 / 1.025 |
| 5600 | -31.5 | +1.0 | -70.7 | +2.4 | -0.3 | -3.5 | -0.9 | +7.3 | 1.110 / 1.064 |
| 6500 | -72.2 | -9.9 | -60.0 | -1.3 | +0.6 | +0.5 | -0.8 | -8.6 | 1.041 / 0.997 |

median |difference| 7.9 dB, 15 of 48 within 3 dB



### 4.3 Mechanisms of the systematic differences (targeted experiments, single_L800 and i4_41)

Each experiment switches one thing (tags in `compare.py`; `results/<tag>.json`):

| Experiment | single_L800: VE corr / VE mean ratio / port corr (median) / NMEP ratio | i4_41: the same |
|---|---|---|
| base | 0.987 / 1.036 / 0.35 / 1.255 | 0.995 / 1.054 / 0.57 / 1.275 |
| `nofric`: no pipe friction and no pipe wall heat in either code | 0.991 / 1.002 / 0.99 / 1.211 | 0.978 / 1.016 / 0.33 / 1.223 |
| `endcorr`: OpenWAM with its 0.6133 r open-end correction | 0.984 / 1.038 / 0.66 / 1.261 | 0.985 / 1.056 / 0.32 / 1.278 |
| `gamma14`: OpenWAM gamma_model 0 | 0.991 / 1.033 / 0.69 / 1.235 | 0.991 / 1.049 / 0.70 / 1.255 |
| `gamma14b`: OpenWAM gamma_model 0 and the wave model at gamma 1.4 | 0.971 / 1.033 / 0.70 / 1.324 | 0.990 / 1.043 / 0.68 / 1.329 |
| `gamma130w`: the wave model at gamma 1.30 | 0.992 / 1.034 / 0.33 / 1.143 | 0.990 / 1.063 / 0.60 / 1.174 |

Explained:

- VE level (+2.5-5.4 %) and the port-pressure phase: the pipe friction and wall heat laws. With both switched off, the
  single cylinder's VE agrees to +0.2 % on average (ratio 1.002, correlation 0.991) and its port-pressure trace to a
  median correlation of 0.99 (0.96-0.99 at 5 of 6 speeds); the i4 to +1.6 %. The wave model's constant Fanning 0.005 is
  close to Colebrook (section 3 e), but its Reynolds-analogy wall heat is 25-60 % below the correlations OpenWAM uses
  (Depcik-Assanis in the intake): more heat into the intake air lowers OpenWAM's charge density; in the exhaust it
  changes the gas temperature and so the wave speed and the return timing. The time-mean exhaust-port gas temperature
  differs by -66 to +120 K between the codes (wave mostly hotter; single_L1200, single_muffler, i4_41, measured on the page with D1-D2). So on the single
  cylinder the port-trace phase difference is a modelling difference of the wall laws, not a wave-propagation error:
  with equal (zero) wall laws the traces coincide. On the i4 4-1 they do not (median correlation 0.57 -> 0.33 without
  friction): see the open items.
- Net IMEP (+22-28 %): about half is the gas properties. The wave model's constant gamma 1.35 overstates the expansion
  work of burnt gas (OpenWAM's composition-temperature gamma is near 1.25-1.3 at combustion temperatures); at gamma
  1.30 the wave model's NMEP ratio falls from 1.26 to 1.14 (single) and 1.28 to 1.17 (i4), at 1.4 it rises to 1.32 /
  1.33. OpenWAM's "constant gamma" switch (gamma_model 0) is not a clean counterpart: its cylinder still computes the
  mixture's gamma from composition at the initial temperature (TCilindro4T.cpp, the nmGammaConstante branch), so its
  NMEP moved only +1-3 % (single: ratio 1.255 -> 1.235). Heat released per unit of trapped charge is identical in both codes (1445 J per unit VE,
  single cylinder), so the gap is in the conversion, not in the fuel.
- The open-end correction is not the cause of any systematic difference (VE ratio and NMEP unchanged, trace phase
  better at some speeds and worse at others).

Not explained (open):

- the remaining ~14-17 % of the net-IMEP gap after gamma; the cylinder wall heat is not it (the wave model loses MORE
  heat to the wall: 242 against 159 J per cycle at 5000 rpm, single_L1200);
- the i4 4-1's port-pressure phase: still uncorrelated with both wall laws off (median 0.57 -> 0.33). The 4-into-1
  junction laws differ (one static pressure in `junctionN`; OpenWAM's BC 12, TCCRamificacion, its own law); not tested
  further;
- the V8s with a line after the collector: VE correlation 0.93 / 0.96 (peaks agree; the low-speed points differ, 2000
  rpm 0.982 against 0.921) and firing-order differences of about 7 dB median (the per-bank 4-1 alone: 3.5 dB). STATUS
  (2026-11-05) records that OpenWAM's multi-cylinder runs are still changing in their last cycles (4.8 % on the default
  V8) and that its open ends and closed valves do not conserve mass; both affect its order levels, so these are not
  attributed to the wave model without a further test (OpenWAM at 60 cycles and at 5 mm would separate them).

### 4.4 What the fixes did to the engine numbers (same OpenWAM runs)

The page now against the page with only D1 and D2 (`results/inherited.json`, before D3):

| configuration | VE corr inherited -> now | VE mean ratio inherited -> now | max |VE change| | median |order change| (dB) |
|---|---|---|---|---|
| single_L400 | 0.977 -> 0.988 | 1.062 -> 1.051 | 0.029 | 0.1 |
| single_L800 | 0.956 -> 0.987 | 1.048 -> 1.036 | 0.041 | 0.1 |
| single_L1200 | 0.981 -> 0.985 | 1.049 -> 1.043 | 0.014 | 0.1 |
| single_muffler | 0.984 -> 0.984 | 1.027 -> 1.025 | 0.028 | 0.1 |
| i4_41 | 0.991 -> 0.995 | 1.056 -> 1.054 | 0.025 | 2.9 |
| v8_2x41 | 0.946 -> 0.986 | 1.041 -> 1.031 | 0.032 | 0.7 |
| v8_line | 0.846 -> 0.929 | 1.062 -> 1.051 | 0.039 | 0.8 |
| v8_line_X | 0.934 -> 0.956 | 1.060 -> 1.049 | 0.036 | 0.7 |

The page now against the page before this validation (`results/before.json`, commit c18496b):

| configuration | VE corr before -> now | VE mean ratio before -> now | max |VE change| | median |order change| (dB) |
|---|---|---|---|---|
| single_L400 | 0.980 -> 0.988 | 1.061 -> 1.051 | 0.026 | 0.2 |
| single_L800 | 0.942 -> 0.987 | 1.045 -> 1.036 | 0.042 | 0.2 |
| single_L1200 | 0.985 -> 0.985 | 1.051 -> 1.043 | 0.014 | 0.1 |
| single_muffler | 0.982 -> 0.984 | 1.028 -> 1.025 | 0.030 | 1.8 |
| i4_41 | 0.990 -> 0.995 | 1.056 -> 1.054 | 0.028 | 5.9 |
| v8_2x41 | 0.945 -> 0.986 | 1.041 -> 1.031 | 0.033 | 0.6 |
| v8_line | 0.857 -> 0.929 | 1.062 -> 1.051 | 0.037 | 1.1 |
| v8_line_X | 0.942 -> 0.956 | 1.060 -> 1.049 | 0.033 | 1.1 |

## 5. Grid and time-step convergence (known-answer check g; `gridconv.py`, `results/gridconv.json`)

The page's grid times 2, 1, 1/2, 1/4 (the time step follows through CFL 0.8), against the finest:

| Configuration (speeds) | Page grid | max abs(VE change) vs finest at grid x2 / x1 / x1/2 | firing-order levels, median / max change vs finest at x1 | cost per speed at x1 / x1/2 / x1/4 |
|---|---|---|---|---|
| single_L800 (4000, 6000, 8000) | 10 mm | 2.9 / 1.6 / 0.5 % (all at 4000 rpm; 0.02 % at 6000, 0.75 % at 8000) | 0.05 / 0.46 dB | 0.4-0.9 / 1.1-2.1 / 4.7-6.8 s |
| single_muffler (4000, 6000, 8000) | 10 mm | 0.59 / 0.24 / 0.08 % | 0.14 / 2.2 dB | 0.7-1.6 / 2.3-2.9 / 7-13 s |
| i4_41 (3500, 5500, 7500) | 12.5 mm | 0.82 / 0.28 / 0.07 % | 0.34 / 2.5 dB (the 2.5 dB: order 8 at 5500 rpm) | 1.7-3.4 / 5.5-9.5 / 18-29 s |

Net IMEP at the page grid is within 0.5 % of the finest except single_L800 (1.3 % at 4000 rpm). The i4's non-firing
orders (0.5, 1, 1.5, 3) change by up to 12 dB with the grid, but they sit 48-110 dB below the firing orders (a symmetric
engine has none; this is numerical floor), so they carry no information in either code. Conclusion: the page's default
cells are converged for VE and torque to about 0.3 % (1.6 % at the single cylinder's 4000 rpm point) and for the
firing orders to a fraction of a dB up to order 4; order 8 of the i4 moves 2.5 dB at 5500 rpm. No change of the default
is needed for VE; a 6.25 mm option would cost about 3 times the time for the high orders. Not changed.

## 6. Differences: summary

| Difference | Status | Evidence |
|---|---|---|
| Open end amplified dips, flipped steady inflow (D1) | defect, fixed | section 2 |
| Diameter step gained stagnation pressure in a contraction (D2) | defect, fixed | section 2 |
| Closed ends and shut valves amplified standing waves (D3) | defect, fixed | section 2 |
| VE 2.5-5.4 % above OpenWAM | explained: pipe friction and wall-heat laws | 4.3 `nofric` |
| Port-pressure phase, single cylinder | explained: wall laws (gas temperature) | 4.3 `nofric` |
| Net IMEP 22-28 % above OpenWAM | about half explained by constant gamma 1.35; rest unexplained | 4.3 `gamma130w` |
| No open-end correction in the wave model | accepted modelling choice (1-D pressure-release end); OpenWAM compared without it; effect on VE nil | 3 d, 4.3 `endcorr` |
| Lossless contraction at a diameter step | accepted modelling choice, as OpenWAM | 2 D2 |
| i4 4-1 port-pressure phase | unexplained (junction law suspected, not tested) | 4.3 |
| V8 with lines: VE correlation 0.93-0.96, firing-order differences about 7 dB median | unexplained; OpenWAM's own settling and mass non-conservation (STATUS) not yet excluded | 4.2, 4.3 |
| Numerical dissipation 0.04 dB per wavelength at 50 cells, 0.15 at 25 | property of the scheme, second order, now measured cleanly | 3 b |

## 7. Recommendations

1. Gas properties: a two-zone or temperature-dependent gamma in the cylinder (burnt gas about 1.25-1.30) would remove
   about half of the net-IMEP gap; it changes torque levels everywhere, so it is a modelling decision for the owner,
   not a defect fix. The VE and tuning (peak speeds, order spectra) are much less sensitive (gamma130w: VE ratio 1.036
   -> 1.034 single, 1.054 -> 1.063 i4).
2. Pipe wall heat: Reynolds' analogy St = f/2 sits 25 % under Dittus-Boelter; a Dittus-Boelter (or Depcik-Assanis in the
   intake) term would bring VE and the exhaust gas temperature closer to OpenWAM. Modelling choice; measure against a
   dyno curve before changing.
3. Contraction loss: both codes treat a diameter step into a smaller pipe as lossless; a sharp-edged step loses about
   K = 0.5 (1 - A2/A1) of the downstream head (2.4 kPa in the 4:1 test). Worth adding to both if steps matter.
4. Settle the open items with OpenWAM at 60 cycles and 5 mm cells on v8_line (whether its order levels move), and a
   known-answer test of `junctionN` (N equal pipes meeting, a small pulse in one: linear acoustics gives the reflection
   (2 - N) / N and the transmission 2 / N into each other pipe), which would separate the i4 4-1's phase difference.
5. Keep 10 mm / 12.5 mm as the default (section 5).

## 8. Tests run (the page after D1-D3)

`web/tests/wave_wasm.js` (all passed, bit-identical, including the added diameter-step job), `web/tests/wavekat_ui.js`
(all passed; fails on the page before), `tools/validation/wave/kat.js` (all 66 criteria pass), and the page's wave and
sound tests one at a time: sim_ui, sound_ui, uel_sim_ui, multi_ui, extremes_ui (282 settings), fuzz_ui (13 tabs x 12
rounds), wsnd_ui, wsndload_ui, wsndmis_ui, wsndpar_ui, wsndwav_ui, wsndxo_ui: all pass, no page errors. No assertion was
changed or loosened. wsndload_ui is the one that caught the first version of D3 (section 2).

## 9. How to rerun

```
node tools/validation/wave/kat.js                       # known answers, ~10 s, results/kat.json
node web/tests/wavekat_ui.js                            # regression guard of D1-D3, ~20 s
cd web && node tests/wave_wasm.js                       # JS vs WebAssembly, bit-identical, ~2 min
export EXHAUST_TUNER_OPENWAM=<path to the OpenWAM binary>; export WAMVAL_SCRATCH=<scratch folder>
python3 tools/validation/wave/compare.py tag=base       # 8 configurations x 6 speeds; OpenWAM runs are cached per
                                                        # model text in WAMVAL_SCRATCH (first run ~45 min, V8s ~1 min each)
python3 tools/validation/wave/compare.py tag=before page=<a copy of web/index.html at c18496b>
python3 tools/validation/wave/compare.py configs=single_L800,i4_41 tag=nofric   # also gamma14, gamma14b, gamma130w, endcorr
python3 tools/validation/wave/gridconv.py               # ~3 min
python3 tools/validation/wave/report.py tag=base vs=before
```

## Addendum 2026-11-12: temperature- and composition-dependent gas properties

The constant gamma 1.35 and R 287 of every gas in the model (section 1, first row; section 4.3 "about half of the
net-IMEP gap") is replaced by thermally perfect gases whose properties follow the temperature and the composition. The
old gas stays available as `spec.e.gas = 'const'`, bit for bit; the building blocks used on their own (`makePipe` without
`spec.gas`, as `kat.js` uses them) also stay at it, so the 66 known-answer criteria of section 3 are untouched.

### A1 The property model and its sources

- Species: N2, O2, Ar, CO2, H2O, CO, H2, each with the NASA 7-coefficient polynomial of GRI-Mech 3.0 (cp/R = a1 + a2 T
  + ... + a5 T^4, 200 (N2, Ar 300) to 1000 K and 1000 to 3500 K (N2, Ar 5000 K)). Verified digit for digit against
  Cantera's `data/gri30.yaml` (https://raw.githubusercontent.com/Cantera/cantera/main/data/gri30.yaml, fetched
  2026-11-12); the CO2, H2O, N2 and Ar rows are the ones the page's `sosExh` already used (physics audit 2026-11-11),
  so the page keeps one table: `sosExh` now reads it from the wave model (its numbers unchanged to the last digit;
  `physaudit_ui.js` passes unchanged). Outside 200-3500 K cp is held at the end value (h linear), so the energy
  equation stays monotonic in T.
- Checked against the NIST-JANAF tables (https://janaf.nist.gov/tables/N-023.txt, O-029, Ar-001, C-095, H-064, C-093,
  H-050, fetched 2026-11-12), 200-3500 K: cp within 0.12 % for CO2, CO, Ar and H2O up to 1000 K, 0.26 % for N2, 0.33 %
  for H2, 0.45 % for O2; H2O above 1000 K is 1.1 % / 1.9 % above JANAF at 2000 / 3000 K. That last one is not a fit
  error: NASA TM-4513's polynomial (McBride, Gordon and Reno 1993; Caltech SDToolbox `nasa7.dat` and Cantera
  `nasa_gas.yaml`, both fetched and identical) shows the same 1.0 % / 2.0 %, its water being Gurvich's 1989 analysis.
  TM-4513 was the alternative considered: its N2 below 1000 K is closer to JANAF (0.05 % against 0.26 %), but adopting
  it would move `sosExh` by up to 0.03 % and with it pinned acoustic and turbo numbers unrelated to this work; kept as
  a possible follow-up. In the mixtures the difference to JANAF is at most 0.001 in gamma.
- Fresh charge: dry air, O2 + 3.7279 N2 + 0.04459 Ar (the split of Heywood's 3.773 by NOAA's dry air, as `sosExh`).
  Fuel vapour is not modelled (the model counts the fresh charge as air, as before). [Part 2, B6: now it is.]
- Burned gas: frozen products of CH1.87 at the engine's air-fuel ratio (stoichiometric 14.596 with these atomic weights:
  C 12.0107, H 1.00794): lean CO2, H2O, O2, N2, Ar; rich CO2, CO, H2O, H2, N2, Ar with the water-gas ratio
  [CO][H2O]/([CO2][H2]) = 3.5 (Heywood, ICE Fundamentals ch. 4; MIT 2.61 lecture 4 says "3.5 to 3.7", the equilibrium
  at about 1740 K; JANAF's log Kf give 3.41 at 1700 K and 3.80 at 1800 K). No dissociation.
- Mixing by mass with the fresh-charge fraction x the model already carries in every pipe cell, cylinder and side
  volume: R(x) = Rb + x (Ra - Rb); cp(T, x) and the sensible enthalpy h(T, x) (integral of cp from 298.15 K, continuous
  at 1000 K by construction) mix the same way; e = h - R T. The burn's heat is added as before (fresh charge / AFR x
  LHV x eta), so no formation enthalpies are needed; converting fresh charge to burned gas at fixed T changes e by the
  sensible difference only, which is the right accounting with the heat added as LHV. [Part 2, B1: the heat is now the
  heat of reaction from formation enthalpies, on the same sensible datum.]

Spot values (model / the same mixture of JANAF's cp; `web/tests/wavegas_ui.js`):

| T (K) | air gamma | burned, AFR 12.8 (lambda 0.877) gamma | burned, stoichiometric gamma |
|---|---|---|---|
| 300 | 1.4007 / 1.4000 | 1.3758 / 1.3752 | 1.3721 / 1.3715 |
| 500 | 1.3860 / 1.3867 | 1.3530 / 1.3536 | 1.3472 / 1.3478 |
| 1000 | 1.3355 / 1.3363 | 1.3001 / 1.3007 | 1.2938 / 1.2944 |
| 1500 | 1.3110 / 1.3108 | 1.2731 / 1.2731 | 1.2674 / 1.2674 |
| 2000 | 1.2979 / 1.2982 | 1.2589 / 1.2596 | 1.2537 / 1.2543 |
| 2500 | 1.2901 / 1.2905 | 1.2511 / 1.2521 | 1.2461 / 1.2471 |

R: air 287.10, burned at AFR 12.8 294.40, stoichiometric 286.63 J/kg K.

### A2 How it enters the equations

- Cylinder (single zone): U = m e(T, x); each step U_new = m e(T, x) - p dV + the enthalpy through the valves + the burn
  - the wall heat, then x_new from the composition balance, then T_new by Newton on m_new e(T, x_new) = U_new
  (converged to 1e-9 relative); p = m R(x) T / V; the valve orifice and jet use the cylinder gas's gamma and cp at the
  step's start. tEx is the temperature of the mass-averaged exhaust enthalpy at its mass-averaged x.
- Pipes (per cell, not per pipe): the conserved variables are unchanged (rho A, rho u A, rho E A, rho x A); the cell's T
  comes from e = E/rho - u^2/2 by Newton on e(T, x), then p = rho R(x) T and the frozen gamma = cp / (cp - R). The
  MUSCL-Hancock predictor uses the cell's gamma (dp/dt + u dp/dx + rho c^2 du/dx = 0 holds for any equation of state
  with frozen composition); the HLLC flux takes each face state's own e(T, x) and gamma (its formula does not depend on
  the equation of state, Toro ch. 10). The Reynolds-analogy wall heat uses the cell's cp.
- Boundaries and junctions (open ends, valve ends, walls, two-pipe steps, n-pipe nodes): the closed-form
  characteristic solutions use the end cell's gamma, frozen over the half-cell isentropic step they solve, each side
  of a junction its own; every enthalpy that crosses is h(T, x) of the crossing state (inflow at an open end: the still
  outside air's h(Ta), exactly). Mass and energy remain conserved to rounding.
- Side volumes (chambers, branches): m e(T, x), T by Newton.
- Cost: the JavaScript takes about twice as long (the page's captured jobs: 93 s with the gas, 47 s with the constant
  gas, on an otherwise lightly loaded machine); the Rust/WebAssembly copy's slowdown was not measured separately.

### A3 Verification

- `tools/validation/wave/kat.js`: all 66 criteria pass; `results/kat.json` is byte-identical to the one before.
- Constant-gamma mode: the page's captured worker jobs plus the diameter-step job (112 speeds) give the results of the
  page before the change to the last digit: JavaScript (`tools/validation/wave/constref.js`, and the first three speeds of
  each design in `wavegas_ui.js`) and Rust (`wave_wasm.js`, against `web/tests/fixtures/wave_const_ref.json`, written from
  commit 017cdbf). The OpenWAM matrix with `tag=const` reproduces section 4's wave numbers exactly.
- `web/tests/wavegas_ui.js` (new): 42 species values against JANAF's tables, hand-listed in the test (cp within 0.5 %,
  H - H(298) within 0.3 % (2 % at 300 K, where it is a few tens of J/mol), H2O above 1000 K 2 % / 1 %); the mixtures (gamma within 0.0015, cp 0.5 %, u(T) - u(300 K)
  0.4 %); atom balances and the water-gas ratio; the temperature solve (inverse to 3e-16); a closed adiabatic cylinder
  through a whole cycle against its isentrope found independently in the test (entropy integral by Simpson, bisection):
  -0.42 % largest temperature error at the page's step, -0.21 % at half the step, first order, the same as the
  constant gas against T V^(gamma-1) = const (-0.36 % / -0.18 %): the error is the cylinder's explicit p dV, not the
  properties; steady inflow through an open end with the gas: every face flux carries the outside air's stagnation
  temperature to 3e-13 K; an engine cycle's mass and energy balances with the gas (3e-15, 7e-15).
- `tools/validation/wave/engine.js` balances with the gas on the OpenWAM matrix: mass and energy residuals 1e-15-1e-14.
- JS-Rust: `wave_wasm.js` bit-identical with the gas on all captured jobs, and the Rust constant-gamma mode against the
  reference.

### A4 A defect found on the way (D4): supersonic exit below the outside pressure

Running a warm-started sweep with the new gas, the single cylinder with a megaphone (fixture "single with a chamber")
went to NaN at 9000 rpm: its cone's exit was supersonic (Mach about 2) at 20-25 kPa. `openState` kept the cell's state
for a supersonic exit only when the exit was above the outside pressure; below it the subsonic solution returned the
sonic state on the cell's characteristic, which passes more mass than any supersonic state on it, and the end cell
emptied. The constant-gamma runs reached Mach 1.9 inside that cone too but not in the end cell. Fix (JS `openState`,
Rust `open_state`): a supersonic exit keeps the cell's state whenever a normal shock at the exit could hold the outside
pressure (pa <= p (1 + 2 gamma / (gamma + 1) (M^2 - 1))); the shock then stands at or outside the exit, as in the
inviscid steady solution. Test (`wavegas_ui.js` 5): a uniform Mach 1.6, 50 kPa stream into 101.3 kPa leaves unchanged
(pressure spread 0, outflow = inflow); on the page of commit 017cdbf the same case runs away (end cell at 1 Pa).
None of the 112 constant-gamma reference speeds passes through the new branch (they are unchanged to the last digit).

### A5 A defect in the comparison itself: OpenWAM's traces were 360 degrees out of phase in 23 of 48 runs

`compare.py` found OpenWAM's firing TDC as the highest pressure among the INS samples within 1e-6 of the smallest
volume. INS is written every 0.5 deg; when that grid missed the firing TDC by a fraction of a degree (the volume there
is 2.6e-4 above its minimum at 0.5 deg), only the gas-exchange TDC qualified, and the OpenWAM traces (port pressure,
cylinder pressure, outlet flow) were compared 360 deg out of phase. Found while splitting the work (A6): OpenWAM's
cylinder-pressure peak sat at 374-376 deg instead of 14-16 deg in 23 of the 48 base runs. Now the firing TDC is the
smallest volume within 90 deg of the cycle's pressure peak. VE, NMEP and the order levels (magnitudes) were not
affected; the port-pressure correlation, its amplitude ratio's phase partner `returnShiftDeg`, and the traces were.

| configuration | median port-pressure correlation, section 4.2 -> same runs aligned (constant gas) | runs that were shifted |
|---|---|---|
| single_L400 | 0.85 -> 0.86 | 1 |
| single_L800 | 0.35 -> 0.96 | 5 |
| single_L1200 | 0.89 -> 0.93 | 3 |
| single_muffler | 0.61 -> 0.76 | 3 |
| i4_41 | 0.57 -> 0.62 | 2 |
| v8_2x41 | 0.09 -> 0.46 | 4 |
| v8_line | 0.25 -> 0.55 | 3 |
| v8_line_X | 0.29 -> 0.52 | 2 |

So section 4.3's "port-pressure phase, single cylinder: explained by the wall laws" does not stand: aligned, the single
cylinder's traces already agree (median correlation 0.86-0.96 with the wall laws on; with both off, `nofricconst`, 0.99).
The i4 4-1 (0.62 aligned; 0.73 with the wall laws off) and the V8s (0.46-0.55) remain only partly correlated; that is
still open, and no longer to be read as a 180-degree phase error.

### A6 Engine level against OpenWAM, before and after (`gas_report.py`, the corrected alignment for both)

Before = `tag=const` (the constant gas; its wave and OpenWAM numbers are those of section 4.2 to the last digit),
after = `tag=base` (the new default gas); the same OpenWAM runs. Means over each configuration's six speeds.

| configuration | NMEP ratio wave / OpenWAM | indicated eff. of heat released, wave (OpenWAM) | VE mean ratio | VE corr | mean port gas T, wave - OpenWAM (K) | exhaust-valve outflow T, wave (K) | port p corr (median) | firing orders: median abs diff (dB), within 3 dB |
|---|---|---|---|---|---|---|---|---|
| single_L400 | 1.271 -> 1.110 | 0.479 -> 0.421 (0.396) | 1.051 -> 1.045 | 0.988 -> 0.994 | +34 -> +102 | 1130 -> 1207 | 0.86 -> 0.86 | 1.4, 21/24 -> 1.3, 22/24 |
| single_L800 | 1.255 -> 1.091 | 0.472 -> 0.414 (0.390) | 1.036 -> 1.028 | 0.987 -> 0.972 | +55 -> +120 | 1141 -> 1215 | 0.96 -> 0.96 | 1.2, 22/24 -> 0.9, 22/24 |
| single_L1200 | 1.264 -> 1.105 | 0.472 -> 0.414 (0.389) | 1.043 -> 1.039 | 0.985 -> 0.992 | +41 -> +107 | 1144 -> 1219 | 0.93 -> 0.92 | 1.3, 21/24 -> 1.1, 20/24 |
| single_muffler | 1.237 -> 1.072 | 0.471 -> 0.413 (0.390) | 1.025 -> 1.014 | 0.984 -> 0.990 | +38 -> +108 | 1136 -> 1211 | 0.76 -> 0.70 | 1.3, 22/24 -> 1.5, 20/24 |
| i4_41 | 1.275 -> 1.115 | 0.481 -> 0.425 (0.398) | 1.054 -> 1.044 | 0.995 -> 0.982 | +68 -> +135 | 1115 -> 1191 | 0.62 -> 0.57 | 3.7, 8/18 -> 4.7, 7/18 |
| v8_2x41 | 1.220 -> 1.063 | 0.479 -> 0.425 (0.405) | 1.031 -> 1.013 | 0.986 -> 0.982 | +78 -> +150 | 1094 -> 1172 | 0.46 -> 0.46 | 3.5, 9/18 -> 3.6, 9/18 |
| v8_line | 1.248 -> 1.088 | 0.477 -> 0.423 (0.402) | 1.051 -> 1.033 | 0.929 -> 0.921 | +10 -> +78 | 1099 -> 1176 | 0.55 -> 0.51 | 6.9, 4/18 -> 4.4, 6/18 |
| v8_line_X | 1.244 -> 1.082 | 0.478 -> 0.424 (0.403) | 1.049 -> 1.029 | 0.956 -> 0.948 | +41 -> +113 | 1096 -> 1174 | 0.52 -> 0.46 | 7.3, 6/18 -> 5.1, 8/18 |

(Single cylinder orders 0.5-2; i4 2, 4, 8; V8 4, 8, 16.) Read: the net-IMEP surplus falls from 22-28 % to 6-12 %
(the wave model's own NMEP falls by 11-16 %, mean 13 %); VE moves by -3 to +2 % (mean -1.2 %), slightly towards
OpenWAM on every configuration; the VE curve shapes and peak speeds are unchanged (all 8 peaks still agree). The
exhaust gets hotter: the burned gas's lower gamma cools less in the expansion, so the exhaust-valve outflow is 74-78 K
hotter and the mean port gas now 78-150 K above OpenWAM's (before 10-80 K). Part of that is the wall laws: with pipe
friction and wall heat off in both codes (`nofric`, single_L800 / i4_41) the port difference is +59 / +66 K (before
-8 / -3 K). The tailpipe firing orders change by about a dB, mixed in sign: no systematic effect.

### A7 The remaining 6-12 %: what was tested (one change at a time)

`work_split.py` splits each code's indicated work, from the cylinder-pressure traces with the same 2-degree trapezoid
(its net agrees with each code's own NMEP within 1 % except at the motored points), into the gross loop
(compression and expansion strokes) and the pumping loop:

| experiment (single_L800 / i4_41) | NMEP ratio | gross ratio | pumping difference / OpenWAM net | peak pressure ratio | compression exponent 60 -> 20 deg BTDC, wave / OpenWAM |
|---|---|---|---|---|---|
| const (before) | 1.255 / 1.275 | 1.226 / 1.256 | +0.004 / +0.010 | 1.252 / 1.275 | 1.342 / 1.284 |
| base (after) | 1.091 / 1.115 | 1.078 / 1.105 | -0.000 / +0.008 | 1.117 / 1.131 | 1.358 / 1.286 |
| `nofric` (no pipe friction or wall heat, both codes) | 1.052 / 1.063 | 1.047 / 1.054 | +0.002 / +0.007 | 1.087 / 1.094 | |
| `eta085` (85 % of the fuel heat released in both, not 72 %) | 1.079 / 1.110 | 1.074 / 1.106 | -0.000 / +0.006 | 1.110 / 1.134 | |
| `motored` (no heat released in either) | | | | 1.069 / 1.080 | 1.358 / 1.282 |
| `motoredconst` | | | | 1.010 / 1.016 | 1.343 / 1.284 |

Demonstrated:
- The rest of the gap is in the gross loop: the pumping loops agree to within 1 % of the net work in every
  configuration (before and after).
- About a third to half of it goes with the pipe wall laws: with friction and wall heat off in both codes the NMEP
  ratio falls from 1.091 / 1.115 to 1.052 / 1.063 (and VE agrees to -0.6 % / -0.1 %). The model's Reynolds-analogy wall
  heat is the known difference (section 3 e, recommendation 2); it is not changed here.
- Not the representation of the 72 %: releasing 85 % of the fuel's heat in both codes leaves the ratio where it was
  (1.079 / 1.110).

Seen but not demonstrated as a cause: OpenWAM's compression is markedly softer. Its compression exponent between 60 and
20 deg BTDC is 1.28-1.29 (fired and motored) against the wave model's 1.36 (1.34 with the constant gas), with the same
geometry and Woschni law, and the wave model loses more heat to the walls (section 4.3), so it is not the wall heat.
OpenWAM's own cylinder output gives R = p V / (m T) = 272 J/kg K during compression and 283 after the burn (a constant
283 J/kg K for its burned gas, against the wave model's 294.4 at AFR 12.8): its unburned charge carries the fuel vapour
(M about 30.6, with a far higher cp than air), which the wave model leaves out. With no heat released the peak pressure
is 7-8 % above OpenWAM's with the new gas (1-2 % with the constant 1.35, which happened to sit closer to a fuel-laden
charge). Adding fuel vapour (a sourced cp for gasoline vapour) to the fresh charge is the next one-change experiment; it
was not made here, so its share of the 6-12 % is not known.

### A8 What this changes on the page

- Full-throttle torque from the wave simulation: 11-16 % lower (the 48 runs above); VE -3 to +2 %. The page's eta 0.72
  ("calibration that brings full-throttle torque into the range of real engines") was set with the old gas and was not
  retuned (it is a calibration input, and no dyno curve is in hand here); the method text says so and points to the
  dyno fit. The page tests that run the simulation check ranges and relations, not torque values: all of them (sim_ui,
  sound_ui, uel_sim_ui, multi_ui, extremes_ui, fuzz_ui, dyno_ui, wsnd*_ui) pass unchanged, and no pinned value was
  changed.
- Sound: the orders change by about a dB, both ways; the exhaust gas in the pipes is hotter and so faster.
- `sosExh` and everything acoustic that uses it: unchanged (same species table, same numbers).
- Cost: about twice the computing time.

### A9 Summary rows (section 6, as of 2026-11-12)

| Difference | Status | Evidence |
|---|---|---|
| Net IMEP 22-28 % above OpenWAM | 16 points of it removed by the gas properties; 6-12 % left, all in the gross loop, a third to half of it the pipe wall laws; OpenWAM's softer compression (fuel vapour in its charge) seen, not yet tested | A6, A7 |
| Port-pressure phase, single cylinder | was a comparison artefact (OpenWAM traces 360 deg out of phase in 23 of 48 runs); aligned, median correlation 0.86-0.96 | A5 |
| i4 4-1 and V8 port-pressure correlation | 0.46-0.62 aligned; open | A5 |
| Supersonic exit below the outside pressure emptied the end cell (D4) | defect, fixed | A4 |
| Exhaust gas temperature | now 78-150 K above OpenWAM at the port (hotter burned gas; OpenWAM's stronger pipe wall heat) | A6 |

### A10 How to rerun (additions)

```
node tools/validation/wave/constref.js          # constant-gamma mode against fixtures/wave_const_ref.json, ~50 s
node web/tests/wavegas_ui.js                    # the gas: JANAF, isentrope, D4, balances, constant-gamma reference, ~40 s
python3 tools/validation/wave/compare.py tag=const       # and tag=base; configs=single_L800,i4_41 tag=nofric /
                                                         # nofricconst / motored / motoredconst / eta085
python3 tools/validation/wave/gas_report.py              # A6 (before=const after=base)
python3 tools/validation/wave/work_split.py tag=base     # A7
```

## Addendum 2026-11-12, part 2: heat release from chemistry, fuel vapour, friction, and real engines

Part 1 left the cylinder releasing "72 % of the fuel's heat" (`eta` 0.72), a number tuned when every gas had gamma 1.35;
with the new gas the model's torque dropped 11-16 % and the 72 % could no longer be defended. It is replaced here by the
heat the model's own chemistry gives and one named, cited residual; the fuel's vapour joins the charge (part 1's next
experiment, adopted); and a cited friction law gives the page brake torque and power. Nothing was fitted to OpenWAM or
to the ratings. `spec.e.gas = 'const'` (the model before part 1) is unchanged bit for bit; `spec.e.fuel = 'air'` keeps
part 1's charge of air alone with the new heat release.

### B1 Heat release from enthalpies of formation

Datum. e(T, x) is sensible (h = integral of cp from 298.15 K, A1), so the chemical energy rides on the fresh fraction x:
the conserved quantity is the total internal energy m (e(T, x) + x qx), qx the heat of reaction per kg of fresh charge at
298.15 K. Burning dm of fresh charge moves dm qx from the second term into the first, so the cylinder's energy equation
keeps its form with the source cy.fresh qx dxb (`burnHeat`). No constant-volume correction (the "minus delta-n R T"
between constant-pressure and constant-volume heating values) is needed: e = h - R(x) T follows R(x) as fresh charge
turns into products. Shown to rounding over whole engine cycles, with and without fuel vapour (B8).

Enthalpies at 298.15 K: the model's own GRI-Mech 3.0 polynomials (Cantera `data/gri30.yaml`, fetched 2026-11-12), H(298.15)
from a1..a5 and a6 below 1000 K (a6 now in `SPEC`), against NIST-JANAF's enthalpies of formation (janaf.nist.gov tables
C-095, H-064, C-093, fetched 2026-11-12):

| species | GRI-Mech 3.0 H(298.15), kJ/mol | NIST-JANAF dfH(298.15), kJ/mol |
|---|---|---|
| CO2 | -393.508 | -393.522 |
| H2O (gas) | -241.825 | -241.826 |
| CO | -110.529 | -110.527 |
| N2 | +0.0014 | 0 |
| O2, Ar, H2 | 0.0000 | 0 |

The fuel: CH1.87 with LHV 44.0 MJ/kg, Heywood's gasoline (MIT 2.61, spring 2017, lecture 4, fetched: "Gasoline CnH1.87n
44 MJ/kg"; the page's value before). Heywood's Table D.4 itself could not be fetched. M = 12.0107 + 1.87 x 1.00794 =
13.8955 g/mol. Its formation enthalpy follows from the LHV: CH1.87 + 1.4675 O2 -> CO2 + 0.935 H2O(g) releases
44.0 MJ/kg x 13.8955 g/mol = 611.404 kJ/mol, so dfH(CH1.87) = -393.522 + 0.935 x (-241.826) + 611.404 = -8.225 kJ/mol
(JANAF values; -8.210 with the GRI ones the model uses). The LHV is a liquid-fuel value; the evaporation enthalpy (well
under 1 % of it) is neither charged to the charge nor credited (B6).

Products: the model's own frozen composition (A1). Q = dfH(fuel) + lambda 1.4675 (3.7279 dfH(N2) + dfH(O2) + 0.04459
dfH(Ar)) - sum n_i dfH(i), per mol of CH1.87. Worked by hand (JANAF values; the model's GRI values agree to 1e-4):
- AFR 14.6 (lambda 1.00025; stoichiometric is 14.5964): products CO2 1, H2O 0.935, O2 0.0004 (N2 and Ar as in the air).
  Q = -8.225 + 393.522 + 0.935 x 241.826 = 611.40 kJ = 44.00 MJ/kg of fuel. Air per mol of fuel: 1.00025 x 1.4675 x
  138.212 g = 202.88 g; mixture 216.78 g: 2.8205 MJ/kg of mixture (3.0137 MJ per kg of air).
- AFR 12.8 (lambda 0.8769): O atoms for C and H, S = 2 lambda 1.4675 - 1 = 1.5739; with a = n_CO2, n_H2O = S - a,
  n_CO = 1 - a, n_H2 = 0.935 - S + a and (1 - a)(S - a) = 3.5 a (0.935 - S + a): a = 0.7287, CO 0.2713, H2O 0.8451,
  H2 0.0899. Q = -8.225 + 0.7287 x 393.522 + 0.2713 x 110.527 + 0.8451 x 241.826 = 512.88 kJ = 36.91 MJ/kg of fuel
  (0.839 of the LHV); 2.6746 MJ/kg of mixture (2.8836 MJ per kg of air).
Rich mixtures need no "combustion efficiency for richness": the CO and H2 left over do it. Against Heywood's rich-mixture
combustion efficiency (his Fig. 3-9): not verifiable here (the book could not be fetched; MIT 2.61 lecture 4's slide
"Gasoline fuel-rich combustion" plots "combustion efficiency or relative energy released" against the equivalence ratio,
but its values cannot be read from the PDF). What can be said: at AFR 12.8 (phi 1.140) the chemistry releases 0.839 of
the LHV, below the oxygen-limited bound 1/phi = 0.877, because part of the oxygen goes to CO rather than CO2 at the
water-gas ratio; the page's OpenWAM cases use 0.98 min(1, 1/phi) = 0.860.

The residual, `ETA_C` = 0.975, named and cited, not fitted: "for an SI engine eta_c ~ 97-98 %; H2 and CO ~ 1 to 2 % of
fuel energy, HC ~ 1 % of fuel energy" (MIT 2.61, spring 2017, lecture 6, "Real cycle effects", fetched), the midpoint, for
unburned hydrocarbons (crevices, blow-by, quench) and the CO and H2 a real flame leaves beyond the frozen products.
Heywood's "0.95-0.98 for lean and stoichiometric" (from the brief) could not be fetched; it brackets the same value
(0.95 costs 2.8 % of torque, B5). spec.e.etaC overrides it (0 = motored).

Net effect at AFR 12.8: 0.975 x 0.839 = 0.818 of "fresh / AFR x 44 MJ/kg" released, against the old 0.72: 13.6 % more
heat. JS (`heatRelease`, `burnHeat`) and Rust (`heat_release`, `burn_heat`) line for line.

### B2 Dissociation: the size of the frozen-products assumption

`tools/validation/wave/dissociation.py` (independent of the model: GRI-Mech 3.0 with a6 and a7, minimum Helmholtz energy
over N2, O2, Ar, CO2, H2O, CO, H2, OH, H, O, NO, N; element and energy balances asserted): an adiabatic constant-volume
burn from an unburned state at TDC, then isentropic expansion to 8 times the volume, frozen products against shifting
equilibrium.

| AFR, unburned state | peak T frozen / equilibrium (K) | peak p frozen / equilibrium (bar) | expansion work frozen / equilibrium (MJ/kg) |
|---|---|---|---|
| 14.6, 750 K 25 bar | 3293 / 2956 | 102.5 / 93.9 | 1.540 / 1.487 (+3.6 %) |
| 14.6, 800 K 35 bar | 3329 / 2992 | 136.0 / 124.7 | 1.558 / 1.503 (+3.6 %) |
| 12.8, 750 K 25 bar | 3159 / 2989 | 100.1 / 95.7 | 1.509 / 1.494 (+1.0 %) |
| 12.8, 800 K 35 bar | 3195 / 3025 | 132.9 / 127.1 | 1.526 / 1.511 (+1.0 %) |

So the frozen products overstate the peak temperature by 170 K at AFR 12.8 (340 K at stoichiometric), the peak pressure
by 4-5 % (8-9 %), and the expansion work by about 1 % (3.6 %). These are upper estimates (the real burn is spread over 55
degrees and loses heat to the walls, so its peak is lower and dissociates less); no allowance was added for them.

### B3 Wall heat: Woschni as implemented, against the published form

Published (Woschni, SAE 670931, 1967, in Heywood's units; reproduced in FAMU-FSU propulsion lecture notes, "Convective
Heat Transfer", fetched 2026-11-12): h = 3.26 B^-0.2 p^0.8 T^-0.55 w^0.8 W/m2 K (B in m, p in kPa, T in K, w in m/s);
w = C1 Sp + C2 (Vd Tr / (pr Vr)) (p - pm), with Tr, pr, Vr at intake valve closing and pm the motored pressure; gas
exchange C1 = 6.18, C2 = 0; compression C1 = 2.28, C2 = 0; combustion and expansion C1 = 2.28, C2 = 3.24e-3.
The model (`runSpeed`, Rust the same): 3.26 bore^-0.2 (p/1000)^0.8 T^-0.55 w^0.8; 6.18 Sp with a valve open, 2.28 Sp
with both shut, plus 3.24e-3 Vd T_ivc / (p_ivc V_ivc) max(0, p - pm) from the start of the burn to EVO (cy.burning stays
set through the expansion); the reference state at IVC; pm = p_ivc (V_ivc / V)^1.32 (a polytropic motored pressure, the
exponent libICEpost also defaults to). Area: piston and head as flat discs plus the liner over the swept and clearance
heights; one wall temperature, 450 K. It matches the published form term for term; not changed.
Heat to the walls as a share of the fuel's chemical energy, full load: LS3 (B5) 11.0 % at 3000 rpm, 9.5 % at 4600, 9.2 %
at 5800 (of the heat released: 13.4, 11.6, 11.2 %); single_L800 / i4_41 12-16 % of the heat released, where OpenWAM's
own Woschni on the same engines gives 10-12 %. Heywood's chapter 12 ranges for SI engines at full load (named in the
brief) could not be fetched, so the check against them is not made here; the values are reported, not tuned. If the
published range is higher, the model's torque surplus (B5) is partly here.

### B4 Friction and brake torque

Law: total friction mean effective pressure of SI engines, tfmep (bar) = 0.97 + 0.15 (N/1000) + 0.05 (N/1000)^2, N in
rpm (`tfmep` in wsFactory): 1.87 bar at 3000 rpm, 2.72 at 4600, 3.67 at 6000. Source: Heywood 1988, ch. 13 (the brief
gives it as eq. 13.6, from motored four-cylinder SI engines at wide-open throttle); verified by fetch only through a
secondary source that states the same coefficients for "the friction under motoring mode for 4-cylinder SI engines"
(Marwaha and Subramanian, Int. J. Automotive Science and Technology 6 (2022) 39-48, eq. 2). Heywood's own page, its
equation number and its data set could not be fetched.
Pumping, handled explicitly: motored at wide-open throttle, that total includes the engine's pumping loop, so it is taken
off the GROSS indicated mean effective pressure (compression and expansion strokes, BDC to BDC through firing TDC; a new
model output, `gimep`, JS and Rust): brake mep = gimep - tfmep. Taking it off the net IMEP would count pumping twice. The
consequence, stated on the page: the brake figure's pumping is that of Heywood's motored engines, not the model's own
fired loop (0.15-1.6 bar on the LS3 at full throttle with open pipes, B5); the page's design comparisons stay on indicated
(net) torque, which keeps the header's own pumping. "net - tfmep" is reported in B5 as the low bracket.
Not used: Chen-Flynn (a + b pmax + c Sp + d Sp^2): its published constants are for diesels, and the SI constants found
(x-engineer.org) are a worked example, not a published fit; Patton-Nitschke-Heywood / Sandoval-Heywood (SAE 890836,
2003-01-0725; Sandoval's MIT thesis was fetched but its equations do not survive the scan) needs bearing dimensions the
page does not have. Heywood's law dates from 1980s engines of 0.85-2 L; a modern V8 likely has less friction per litre,
which would raise the brake figures below.
On the page: the 4-Stroke tab's wave simulation shows, for the first design, indicated and brake torque and power per
speed, their peaks, and a dotted brake line on the chart, with the friction method named; the comparison columns stay
indicated. The Sound tab's wave runs report no torque to the user.

### B5 Real engines: the published ratings (the truth test)

The page's cam library (`CAM_LIB`) has full cam data only for GM V8s: the LS3 with GM's published events (ivo -19, ivc 43,
evo 38, evc -7 at 0.050 in), the LS7 and LT1 with durations and lobe separation only (placed straight up, the library
marks them "assumed"; the LT1 also has a cam phaser, here one fixed position, and direct injection), the LS9 (rated with
its supercharger; not comparable) and the LS6 and LS1 (ratings without rpm). No stock engine of another layout in the
library has cam data (the Honda K-series presets carry ratings but no cam events), so three engines of one layout are
compared. Ratings: LS3 430 hp @ 5900, 425 lb-ft @ 4600 (Chevrolet Performance crate engine sheet 19435098, fetched: its
test procedure page was not in the fetched text); LS7 505 hp @ 6300, 470 lb-ft @ 4800; LT1 455 hp @ 6000, 460 lb-ft @
4600 (the library's sources).

How each is run (`tools/validation/wave/ratings.js`, the 4-Stroke tab's simSpec assumptions): rod 1.7 x stroke, valve Cd
0.7, Wiebe 18 deg BTDC / 55 deg, AFR 12.8, one 300 mm intake runner per cylinder open to the air (diameter sqrt(0.6) x the
intake valve), one bank of four cylinders at the cross-plane bank's firing gaps (0, 180, 450, 630 deg) on a long-tube 4-1
header: 150 mm port + 610 mm primary at 44.5 mm (1-7/8 in tube), a 130 mm cone from 89 to 76 mm and a 300 mm 3 in
collector, open; 3000-6600 rpm in 200 rpm steps, the page's sweep settings; torque = the bank's mean IMEP x 6.2 L / 4 pi.
`ratings_report.py` makes the table. Before = the page at commit dc9878f (eta 0.72; it had no brake torque, so the same
friction law is applied here to its gross loop); chem = the heat release of B1 with part 1's air charge; after = the page
now (B1 and the fuel vapour of B6).

| engine | rating | page | indicated torque, lb-ft @ rpm | indicated power, hp @ rpm | brake torque | brake power | bracket: net - tfmep, torque / power |
|---|---|---|---|---|---|---|---|
| LS3 | 425 @ 4600, 430 hp @ 5900 | before | 489 @ 5000 (+15 %) | 510 @ 5800 (+19 %) | 414 @ 5000 (-3 %) | 421 @ 5800 (-2 %) | 382 (-10 %) / 373 (-13 %) |
| LS3 | | chem | 553 @ 5000 (+30 %) | 581 @ 6000 (+35 %) | 480 @ 5000 (+13 %) | 494 @ 5800 (+15 %) | 446 (+5 %) / 441 (+2 %) |
| LS3 | | after | 568 @ 5000 (+34 %) | 593 @ 5800 (+38 %) | **497 @ 5000 (+17 %)** | **510 @ 5800 (+19 %)** | 461 (+8 %) / 454 (+6 %) |
| LS7 (cam assumed) | 470 @ 4800, 505 hp @ 6300 | before | 559 @ 5000 (+19 %) | 568 @ 5800 (+12 %) | 471 @ 5000 (+0 %) | 465 @ 5600 (-8 %) | 444 (-6 %) / 421 (-17 %) |
| LS7 | | chem | 634 @ 5000 (+35 %) | 647 @ 5800 (+28 %) | 546 @ 5000 (+16 %) | 545 @ 5600 (+8 %) | 515 (+10 %) / 496 (-2 %) |
| LS7 | | after | 650 @ 5000 (+38 %) | 660 @ 5800 (+31 %) | **565 @ 5000 (+20 %)** | **563 @ 5600 (+11 %)** | 532 (+13 %) / 511 (+1 %) |
| LT1 (cam assumed) | 460 @ 4600, 455 hp @ 6000 | before | 489 @ 5000 (+6 %) | 492 @ 5600 (+8 %) | 412 @ 4400 (-10 %) | 404 @ 5600 (-11 %) | 391 (-15 %) / 366 (-19 %) |
| LT1 | | chem | 553 @ 5000 (+20 %) | 559 @ 5600 (+23 %) | 478 @ 5000 (+4 %) | 473 @ 5600 (+4 %) | 455 (-1 %) / 431 (-5 %) |
| LT1 | | after | 569 @ 5000 (+24 %) | 572 @ 5600 (+26 %) | **496 @ 5000 (+8 %)** | **489 @ 5600 (+8 %)** | 469 (+2 %) / 444 (-2 %) |

Read: the tuned 0.72 had (with this friction law) put brake torque within -10 to 0 % of the ratings; with the heat the
chemistry gives, brake torque reads 8-20 % high and brake power 8-19 % high, the torque peak at 5000 rpm (rated 4600-4800)
and the power peak at 5600-5800 (rated 5900-6300). The error is systematic (all three high), so it was investigated one
change at a time on "after" (LS3; the LS7 and LT1 move alike, `results/ratings_s_*.json`):

| one change | LS3 brake torque | LS3 brake power | what it says |
|---|---|---|---|
| none (after) | 497 @ 5000 (+17 %) | 510 @ 5800 (+19 %) | |
| valve Cd 0.7 -> 0.6 | 468 @ 4400 (+10 %) | 450 @ 5600 (+5 %) | the largest lever; also moves the torque peak |
| 3 kPa intake loss (mouth at 98.3 kPa: filter, throttle, plenum) | 478 @ 5000 (+13 %) | 491 @ 5800 (+14 %) | -4 %: the model's open runners have none |
| intake runner 300 -> 450 mm | 540 @ 4200 (+27 %) | 476 @ 5000 (+11 %) | moves both peaks 800 rpm: the runner, not the header, sets them |
| burn 55 -> 45 deg | 509 @ 5000 (+20 %) | 523 @ 5800 (+22 %) | +2.4 % |
| ignition 18 -> 25 deg BTDC | 504 @ 5000 (+19 %) | 518 @ 5800 (+20 %) | +1.4 % |
| ETA_C 0.975 -> 0.95 | 483 @ 5000 (+14 %) | 495 @ 5800 (+15 %) | -2.8 % (the cited range's low end) |
| 2 m tail pipe after the collector | 494 @ 5000 (+16 %) | 509 @ 5800 (+18 %) | -0.6 % |
| primaries 610 -> 300 mm | 498 @ 5000 (+17 %) | 510 @ 5800 (+18 %) | none |
| wall temperature 450 -> 500 K | 494 @ 5000 (+16 %) | 508 @ 5800 (+18 %) | -0.6 % |

What the remaining surplus is made of, as far as shown: (1) the breathing: VE peaks at 1.13 (LS3 5000 rpm) with open
300 mm runners and no intake losses, while the rated BMEP (11.75 bar at 4600) with this friction needs a gross IMEP of
about 14.5 bar where the model has 16.1; the intake as the stock engine has it (plenum, throttle body, filter, the real
runner length) is not modelled, and the model is most sensitive to the valve Cd and the runner; (2) the model itself:
run like for like against OpenWAM (B7) its indicated work is 10-14 % higher, about a third to half of it the pipe wall
laws (A7); (3) the frozen products overstate the expansion work by about 1 % at AFR 12.8 (B2). Pulling the other way: a
modern V8's friction is likely below Heywood's 1980s law. Not changed: none of these was tuned; the cams of the LS7 and
LT1 are assumed; the stock exhaust (catalysts, mufflers) and the rating's test conditions are not known here.

### B6 Fuel vapour in the charge (part 1's next one-change experiment): adopted

Property: gasoline vapour CH1.87 as 0.62608 isooctane + 0.37392 toluene by mole (H/C 1.87 exactly; 7.62608 C per molecule,
M 105.9685 g/mol), each from NASA's 9-coefficient fits (McBride, Zehe and Gordon 2002, NASA TP-2002-211556; NASA CEA
`data/thermo.inp`, github.com/nasa/cea, fetched 2026-11-12: "C8H18,isooctane 2,2,4-Trimethylpentane TRC(4/85)" and "C7H8
TRC(4/98)"), mixed and refitted to the model's 7-term form: within 0.24 % over 300-1000 K, 0.83 % over 1000-3500 K
(`SPEC[7]`; `wavegas_ui.js` 10 evaluates NASA's fits itself). cp 1486 J/kg K at 300 K, 2333 at 500 K, 3208 at 800 K.
Heywood's gasoline-vapour polynomial (named in the brief) could not be fetched; NASA's data are primary. Mixture at AFR
12.8: R 271.98 J/kg K (OpenWAM's own cylinder output during compression: 272, A7), gamma 1.355 at 300 K and 1.319 at 500 K
(air 1.401 / 1.386). Its formation enthalpy is the fuel's (B1), so the heat of reaction is unchanged, now per kg of
mixture.
Where the fuel enters: at the intake valve, as a port injector (`portFuel`, JS; `port_fuel`, Rust): the air flowing into
the cylinder brings 1/AFR of its mass as vapour at 298.15 K (the energy datum; its evaporation is taken from the port, not
the charge: no charge cooling is modelled); gas pushed back into the port leaves its fuel at the valve (the injector meters
the net air). The cylinder and the exhaust carry air-fuel mixture as their fresh charge, the intake pipes air, so the
runner acoustics stay those of air (a premixed runner would lower its sound speed by about 4 %, right only for a
carburettor). The fuel's chemical energy rides on the intake's air (qx per kg of air there = qx per kg of mixture x the
mixture per kg of air), so the total energy stays conserved; only the sensible enthalpy of fuel pushed back out leaves.
Approximation: outside air drawn back into a tail pipe counts as fresh mixture there (exhaust side only).

The experiment, one change, both codes as base (`compare.py tag=chem` = the heat of B1 with an air charge, `tag=fuelvap`;
OpenWAM releasing the same heat, its combustion efficiency set by `compare.comb_eff` to etaC x q_f / 44 MJ/kg = 0.818 at
AFR 12.8; `work_split.py`, `gas_report.py before=chem after=fuelvap`):

| single_L800 / i4_41 | chem (air charge) | fuelvap (adopted) |
|---|---|---|
| compression exponent 60 -> 20 deg BTDC, wave (OpenWAM 1.286 / 1.287) | 1.358 / 1.361 | **1.300 / 1.302** |
| peak pressure ratio wave / OpenWAM | 1.113 / 1.135 | 1.052 / 1.073 |
| exhaust port gas T, wave - OpenWAM (K) | +177 / +194 | +113 / +137 |
| VE correlation with OpenWAM | 0.963 / 0.896 | 0.983 / 0.979 |
| firing orders: median abs diff to OpenWAM (dB) | 1.3 / 6.2 | 1.6 / 3.6 |
| NMEP ratio wave / OpenWAM | 1.082 / 1.113 | 1.105 / 1.138 |
| gross-loop ratio | 1.076 / 1.106 | 1.103 / 1.133 |

Verified: OpenWAM's softer compression (A7) is the fuel vapour (the exponent gap 0.072 -> 0.014); the peak pressure and
the exhaust temperatures move to OpenWAM's. Adopted on that basis (sourced, and it removes a known inconsistency: the
charge used to burn the fuel's heat without its mass). It raises the work (NMEP +2-3 %: the same heat in 7.8 % more mass
runs cooler, so the burned gas's gamma is higher and less heat reaches the walls) and so the gap to OpenWAM, which
therefore sits elsewhere in the gross loop (the expansion and the pipe wall laws) and stays open. Its share of the
ratings' error: +3.5 % (B5, chem -> after).

### B6b A defect found on the way (D5): a supersonic exit beyond a normal shock's reach

With the chemistry's heat (stronger blowdown), the page's captured job "single with a chamber" (a single cylinder whose
pipe ends in a 127 mm megaphone cone, open) never finished its sweep: at 7850 rpm the cone's exit ran at Mach 1.97 and
24 kPa, and once a normal shock at the exit could no longer hold the outside pressure (pa > p (1 + 2 gamma / (gamma + 1)
(M^2 - 1)), the D4 limit), `openState` applied its subsonic solution to the supersonic state itself: the sonic state on
the cell's characteristic, which passes more mass than the cell brings (the end flux jumped 17 % in one step). The end
cell emptied in ten steps (1 Pa, -4.4e8 m/s) and the time step fell to 1.8e-11 s, so the run never ended (this is what
held up `wave_wasm.js` and part of the first suite run). Fix (JS `openState`, Rust `open_state`): in that case the end
takes the state behind a normal shock (Rankine-Hugoniot with the cell's frozen gamma: subsonic, the same mass flux) and
solves the subsonic exit from there, so the shock moves into the pipe, as in the inviscid steady solution of an
over-expanded nozzle. Test (`wavegas_ui.js` 5, D5): that job swept to 8600 rpm with a guard on the time step; on the page
before the fix the guard trips (at 7150 rpm from that sweep's cold start), after it the smallest step is 4.5e-6 s. A
uniform Mach 1.6-2.0 stream at 20-30 kPa does not show the defect (it recovers either way), so it is not the test.
Unaffected: the constant-gamma reference (112 speeds, bit for bit), kat.js (66 of 66), and the runs of B5-B7 that were
rerun after the fix (the ratings, tag after; the OpenWAM cross-check, tag fuelvap) gave the same numbers to the last
digit (the branch is not reached there); the chem and sensitivity runs were made before it and not rerun.

### B7 Engine level against OpenWAM (the cross-check), part 1 -> now

single_L800 / i4_41 (the OpenWAM runs rerun with the new heat release): NMEP ratio 1.091 / 1.115 (part 1, both codes at
0.72) -> 1.082 / 1.113 (chem, both codes at the chemistry's heat) -> 1.105 / 1.138 (after). The heat release change by
itself leaves the like-for-like gap where it was (as part 1's eta085 run predicted). The other six configurations were
not rerun (about 45 minutes of OpenWAM); `results/base.json` is part 1's, `chem.json` and `fuelvap.json` hold these two.

### B8 What changed on the page, tests, pinned values

- Torque from the wave simulation: +13.6 % heat released (B1) and +2-3 % from the vapour: on the LS3 the indicated torque
  rises 16 % (489 -> 568 lb-ft peak); VE changes by -0.8 to +0.2 % (the three V8s, every speed); exhaust-valve outflow +39 K on the OpenWAM matrix
  engines against part 1 (+110 K from the heat, -71 K from the vapour). The method text says what the heat is, names
  the friction law and gives the ratings comparison; the 72 % sentence is gone.
- Sound: the wave model's tailpipe firing orders against part 1, single_L800 / i4_41 (24 / 18 order-speed points): median
  change +0.9 / +0.9 dB, median absolute 1.3 / 1.2 dB. The strong orders rise 0.5-2 dB at every speed, in step with the
  stronger blowdown (NMEP +15 %); the large moves (-4.7 dB, -6.9 dB) are weak orders at interference minima (single
  5000 rpm 2nd order, i4 2500 rpm 8th), whose level depends on phase. The port gas temperature, and so the sound speed,
  ends within 8-12 K of part 1's, so no order moved for a sound-speed reason.
- `web/tests/wavegas_ui.js`: 5 (D5, B6b), 8 (formation enthalpies against JANAF hand-listed; the fuel's from the LHV by hand; the heat
  per kg of mixture at AFR 14.6 and 12.8 by hand, products by bisection; total energy, sensible + chemical, over an engine
  cycle: residual / heat released -7.9e-15), 9 (tfmep by hand at 3000, 4600, 6000, 7500 rpm; the gross loop against p dV
  integrated in the test, cycle by cycle), 10 (the vapour's cp against NASA's fits; the mixture's R; an engine cycle with
  the injector: mass residual 5e-15 with 7.88 % fuel per air drawn in, total energy residual 4e-15). Sections 6 and 8 use
  spec.e.fuel 'air' (part 1's balances), 10 the default.
- `web/tests/wave_wasm.js`: the gross IMEP is compared too (the WebAssembly's output gains it: ve, imep, pmax, resid,
  pEvo, tEx, overlapPort, gimep, then each cylinder's ve, imep; the page's reader follows); two jobs added (a lean AFR
  15.5 with etaC 0.9: the lean branch and the override; spec.e.fuel 'air'); nothing removed or loosened.
- Pinned values changed: one count. `web/tests/multi_ui.js` "four lines drawn" counted every polyline on the wave
  chart; the chart now adds a fifth, the first design's brake torque (class `brake`), so the test counts the design lines
  (still 4) and the brake line (1) separately. No numeric value was re-pinned: the page tests check ranges and relations, not torque values; the captured jobs are
  compared JS against Rust, which both changed; the constant-gamma reference (`fixtures/wave_const_ref.json`) is
  unchanged and still met bit for bit (JS `constref.js`, 112 speeds; Rust in `wave_wasm.js`); `kat.js` 66 of 66, its
  results file byte-identical.

### B9 Summary rows (section 6, as of 2026-11-12, part 2)

| Difference | Status | Evidence |
|---|---|---|
| Heat release (eta 0.72, tuned) | replaced: enthalpies of formation to the model's own products, fuel from its LHV, ETA_C 0.975 cited | B1 |
| Dissociation | not modelled; frozen products overstate expansion work by about 1 % at AFR 12.8, 3.6 % at stoichiometric | B2 |
| Woschni | matches the published form; wall heat 9-11 % of fuel energy at full load (LS3), above OpenWAM's own | B3 |
| Brake torque | Heywood's tfmep off the gross loop | B4 |
| Against real ratings (LS3, LS7, LT1) | brake torque +8 to +20 %, power +8 to +19 %; torque peak 200-400 rpm late, power peak 100-700 rpm early; most sensitive to the valve Cd and the intake | B5 |
| OpenWAM's softer compression | the fuel vapour (exponent 1.30 against 1.29); adopted | B6 |
| Net IMEP above OpenWAM | 10-14 %, in the gross loop; open | B6, B7, A7 |
| Supersonic exit beyond a normal shock's reach emptied the end cell (D5) | defect, fixed | B6b |

### B10 How to rerun (additions)

```
node web/tests/wavegas_ui.js                               # + heat release, total energy, friction, fuel vapour, ~40 s
QUICK=1 node web/tests/wave_wasm.js                         # JS / Rust / WebAssembly, 3 speeds per job (full: ~10+ min)
node tools/validation/wave/ratings.js tag=after             # LS3, LS7, LT1, ~1 min; tag=before with PAGE=<page at dc9878f>
node tools/validation/wave/ratings.js tag=s_cd06 e.cd=0.6   # one change: e.*=<JSON>, intakeL=, primL=, coll=, tail=, pIn=
python3 tools/validation/wave/ratings_report.py before chem after
python3 tools/validation/wave/compare.py configs=single_L800,i4_41 tag=chem      # and tag=fuelvap (= base now)
python3 tools/validation/wave/work_split.py tag=fuelvap configs=single_L800,i4_41  # + compression exponent column
python3 tools/validation/wave/gas_report.py before=chem after=fuelvap
curl -sSLO https://raw.githubusercontent.com/Cantera/cantera/main/data/gri30.yaml
python3 tools/validation/wave/dissociation.py gri30.yaml
```

Test run (2026-11-12, part 2, `python3 tools/run_all_tests.py -j 2`, with cargo_test_rust (the et_host/et_app workspace,
untouched here) left out): 146 tests, 143 passed, 2 skipped and 4 partial skips, all expected, 1 failed: multi_ui, the
polyline count above. It passes after that change, and sim_ui and uel_sim_ui were rerun on the final page. In that run
wave_wasm and wave_wasm_built (full, every speed) passed bit for bit; mdwam_ui and jpipe_ui did not time out.

## Addendum 2026-11-12, part 3: measured valve flow, the intake system, and the cylinder against OpenWAM

Part 2 left the wave model 8-20 % high on brake torque against three GM V8 ratings, with three places named for the surplus:
the breathing (open 300 mm runners, no plenum, throttle or filter, valve Cd 0.7), the model's indicated work 10-14 % above
OpenWAM like for like, and the frozen products (about 1 %). Here the valve flow and the intake are made as real as the
sources allow and the cylinder is compared with OpenWAM part by part. Nothing was fitted to the ratings or to OpenWAM. The
old behaviour stays the default where no new data is given: open runners (no `intake.plenum`) and the 0.7 law (no
`e.flowIn`/`e.flowEx`) run bit for bit as before (C8).

### C1 Valve flow: the reference area, and why measured flow replaces a Cd(L/D) map

The model's valve (`makeEngine` `area`, Rust `Engine::area`): effective area = n_valves x Cd x min(pi D L, 0.85 pi D^2 / 4),
Cd = 0.7: the curtain area pi D L (D the valve head diameter, L the lift) as reference, capped at 0.85 of the seat area
pi D^2 / 4 at high lift. OpenWAM's writer gives OpenWAM the same table (`cdTable`, Cd referred to the pipe-end area, clipped
at 1, which none of the runs here reaches; C6).

A published Cd(L/D) map was looked for (Heywood ch. 6 via open course notes, Annand and Roe, Blair, SAE tables). Found and
read: FAMU-FSU propulsion notes "Valve Flows" (web1.eng.famu.fsu.edu/~shih/propulsion/lecture%20notes/Valve%20Flows.pdf,
fetched 2026-11-12), which defines the discharge coefficient on the curtain, C_D = A_f / (pi D L), and the flow coefficient
on the seat, C_f = A_f / (pi D^2 / 4), and shows the three lift regimes (markers at L/D 0.09, 0.2, 0.25), but gives no
values. No source with tabulated values could be fetched. What could be fetched instead is better for these engines:
measured flow-bench curves of the stock heads themselves, which give each engine's own effective area at every lift.

Conversion (`benchCdA`, JS; the tables reach Rust as data): a bench draws air through port and valve at a fixed lift and a
fixed depression dp (28 in H2O = 28 x 249.089 = 6974.5 Pa) and reports the volume flow Q in cfm at its reference air state.
With the isentropic orifice law the model's valves obey (`orifice`): m = Cd A sqrt(p0 rho0) psi(p/p0, gamma),
psi = sqrt(2 gamma / (gamma - 1) ((p/p0)^(2/gamma) - (p/p0)^((gamma+1)/gamma))), Q = m / rho0, so
Cd A = Q / (sqrt(R T0) psi). Reference state taken as 101.325 kPa, 288.71 K (60 F), dry air (R 287.10, gamma 1.4006 from
the model's gas): an assumption, since neither source states it; at 68 F the areas would be 0.8 % smaller. Worked: p/p0 =
94350.5 / 101325 = 0.93117, psi = 0.35702 (gamma 1.4), sqrt(R T0) = 287.9 m/s; 312 cfm = 0.147248 m3/s -> Cd A = 1.4322e-3 m2.
Intake: flowed into the cylinder (the engine's direction). Exhaust: flowed out of the cylinder (the engine's direction).
Reverse flow uses the same area (a bench measures one direction; OpenWAM's writer also gives one table for both).

Sources (both in `CAM_LIB`, `flow`):
- LS3: Holdener, "LS3/L92 rectangle-port cylinder heads test", Hot Rod, February 2011 (PDF reprint:
  https://cache.nebula.phx3.secureserver.net/b443dbc4abe481862a65b4c1f1b178ab?AccessKeyId=0BDEF12C755C415CB626&disposition=0&alloworigin=1),
  "Test 1, stock LS3/L92 (0821 casting)", intake valve 2.165, exhaust 1.59 in (the library's), "FLOW DATA: CFM AT 28 INCHES"
  (the unit "of water" is the bench convention, not printed). Bench, bore adapter, radius plate and exhaust pipe not stated.
- LT1: EngineLabs, "The direct injection flow path: porting factory LT1 DI heads" (https://www.enginelabs.com/?p=249650),
  stock head, "All tests performed at 28 inches of water test depression", "on a 4.065-inch bore", West Coast Racing
  Cylinder Heads' bench; valves 2.120 / 1.59 in (the library has 2.126 / 1.590: the page's valve sizes stay the library's).
- LS7: no stock curve with its test pressure and exhaust was found (a forum porter's intake-only figures,
  ls1tech.com thread 280923 page 3, "@ 28"" without units, were not used). Runs use the LS3's Cd on the curtain against L/D
  at the LS7's valve sizes (`ratings.js flow=family`): an assumption.

LS3 (C1 table; `wavegas_ui.js` 11 lists the source and checks every point):

| lift (in) | intake cfm | L/D | Cd A (mm2) | Cd on curtain | 0.7 law (mm2) | exhaust cfm | L/D | Cd A (mm2) | Cd on curtain | Cd on seat | 0.7 law (mm2) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.050 | 34 | 0.023 | 156 | 0.711 | 154 | 24 | 0.031 | 110 | 0.684 | 0.086 | 113 |
| 0.100 | 67 | 0.046 | 308 | 0.701 | 307 | 59 | 0.063 | 271 | 0.840 | 0.211 | 226 |
| 0.200 | 147 | 0.092 | 675 | 0.769 | 614 | 116 | 0.126 | 533 | 0.826 | 0.416 | 451 |
| 0.300 | 211 | 0.139 | 969 | 0.736 | 922 | 157 | 0.189 | 721 | 0.745 | 0.563 | 677 |
| 0.400 | 259 | 0.185 | 1189 | 0.677 | 1229 | 188 | 0.252 | 863 | 0.669 | 0.674 | 762 |
| 0.500 | 297 | 0.231 | 1363 | 0.621 | 1413 | 207 | 0.315 | 950 | 0.590 | 0.742 | 762 |
| 0.600 | 312 | 0.277 | 1432 | 0.544 | 1413 | 216 | 0.377 | 992 | 0.513 | 0.774 | 762 |
| 0.650 | 312 | 0.300 | 1432 | 0.502 | 1413 | 219 | 0.409 | 1005 | 0.480 | 0.785 | 762 |
| 0.700 | 314 | 0.323 | 1441 | 0.469 | 1413 | 223 | 0.440 | 1024 | 0.454 | 0.799 | 762 |

LT1 (WCCH): intake Cd on the curtain 0.68 / 0.71 / 0.74 / 0.69 / 0.63 / 0.59 / 0.52 / 0.45 at 0.1 / 0.2 / 0.3 / 0.4 / 0.5 /
0.55 / 0.6 / 0.7 in; exhaust 0.64 / 0.86 / 0.72 / 0.66 / 0.60 / 0.55 / 0.53 / 0.46 (Cd A 207 ... 1047 mm2).

Read: the 0.7 law on the curtain capped at 0.85 of the seat is, for the LS3's intake, within 10 % of the measured area at
every lift (the measured Cd on the curtain falls from 0.77 to 0.47 with L/D, which the cap imitates). The LS3's exhaust flows
up to 34 % more than the law at full lift (0.80 of the seat against 0.595). So the measured heads do not support part 2's
"Cd 0.7 -> 0.6" lever; they open the exhaust a little.

### C2 The intake system (`plenumOf`, `plenEnd`; Rust `plenum_of`, `Bnd::Plen`)

`spec.intake.plenum = {V_m3, inlet: [segs, filter to plenum], throttle: {d, cd}, filter: {dp, m}}` (the OpenWAM writer's
form, which already had `V_m3` and `inlet`):
- Plenum: one well-mixed volume of the intake's gas (m, e(T, x), x); every runner's mouth and the inlet's end are open ends
  on it (`openState` with the plenum's p, T, x: isentropic outflow from it, a Borda-Carnot dump into it). Its mass, energy and
  fresh charge change by exactly the end fluxes the pipes were given (`wavegas_ui.js` 11 e: mass residual -2.8e-15, total
  energy 2.7e-14 of the heat released, over a cycle with plenum, filter, stepped inlet, throttle and valve tables).
- Throttle body: the inlet's last 50 mm at the effective area cd x pi d^2 / 4; the two-pipe junction contracts the flow into
  it without loss and the plenum port dumps its dynamic head: an orifice of that Cd A into a large volume (`wavegas_ui.js`
  11 c: at 2.001 kPa, the compressible orifice law by hand for the LS3's 0.3587 kg/s at 5900 rpm, VE 1, the model passes
  0.3587 kg/s). A first version coupled an explicit orifice law between the inlet's end cell and the plenum; at a throttle's
  small pressure drop (dm/dp large) the end cell flipped between 72 and 120 kPa every step (the explicit coupling's gain,
  estimated as dm/dp x dt x c^2 / V_cell, is about 2.4 there, above the 2 at which such a step goes unstable), so it was replaced before any result was used.
  Cd at wide open: 0.828 of the bore area, from a measurement: a stock GM LT1/LT4 87 mm throttle body flowed 916 cfm at
  20 in H2O wide open, on a radius inlet plate (Mamo Motorsports, a vendor, Corvette Forum thread 4018317, 2017-07-22,
  https://www.corvetteforum.com/forums/c7-z06-discussion/4018317-throttle-body-flow-testing-results-inside.html); by C1's law
  Cd A = 4.920e-3 m2, 0.828 of pi 0.087^2 / 4. Heywood's throttle-area relation (eq. 7.21, as reproduced in Carlsson,
  "Flow through a throttle body", Linkoping University LIU-IEI-TEK-A--07/0071-SE, 2007,
  https://www.therangerstation.com/tech_library/pdf_documents/flow_through_a_throttle_body.pdf) at wide open reduces to the
  bore less the shaft's strip, (D^2 / 2)(b sqrt(1 - b^2) + asin b), b = shaft / D: with an assumed 10 mm shaft that is 0.969 of
  the open area. The same 0.828 is used for the LS3/LS7's 90 mm bodies (assumed similar).
- Air filter: the Intake tab has no sourced filter loss ("the filter's own loss is not modelled (no published loss curve to
  hand)"), so it is an input: a 50 mm step at sigma = 1 / (1 + sqrt(dp / q)) of the inlet's mouth area, q = m^2 / (2 rho A^2),
  rho 1.1839 kg/m3, whose sudden expansion loses dp at the flow m and scales with m^2. Steady check (`wavegas_ui.js` 11 d):
  2.5 kPa at 0.35 kg/s on 101.6 mm gives 2.544 kPa at 0.337 kg/s against 2.320 by the m^2 scaling (+9.7 %) and 1.148 against
  1.101 at 0.232 kg/s (+4 %): the step runs at Mach 0.3-0.35 and the sizing is incompressible. Stated, not corrected.
- On the page (4-Stroke tab, "Runners breathe from: A plenum fed through a throttle body"): plenum volume (whole engine, cu in /
  cc), throttle bore, wide-open throttle coefficient (0.83), filter loss at full power (psi / kPa, 0 = none; referred to the
  simulated cylinders' air at VE 1 at the top speed swept), inlet tube length and diameter. The cylinders simulated (n of the
  engine's cylinders) get their share n / cyl of the volume and of the throttle's and the tube's areas (diameters x
  sqrt(share)); the OpenWAM case is written from the same spec (its throttle stays the 50 mm step at the bore). Open air
  stays the default and is unchanged.

### C3 Stock dimensions used, with sources or as assumptions

| item | value | basis |
|---|---|---|
| LS3 / LS7 throttle bore | 90 mm | GM 12605109 / Chevrolet Performance 19420707, "LS3/LS7 90mm" (e.g. https://www.jegs.com/i/chevrolet-performance-809-19420707-throttle-body-drive-by-wire-gm-ls3-ls7-l99-l77-6-0l-6-2l-7-0l, https://www.michiganmotorsports.com/intake-throttle-body-fuel-injectors/90mm-ls3-throttle-body-genuine-gm-12605109-19420707-ls7-l99-l76-217-3153-gold-blade). LSX Magazine's intake test (https://www.lsxmag.com/tech-stories/dyno-testing-four-popular-ls3-bolt-on-intake-manifolds/) says the stock LS3 intake "is designed for the stock 92 mm unit": sensitivity run at 92 |
| LT1 throttle bore | 87 mm | GM 12729495, "87mm Throttle Body LT1 / LT2 / LT4 / L86" (https://sdparts.com/i-19880009-genuine-gm-parts-12733469-87mm-throttle-body-lt1-lt2-lt4-l86.html) |
| throttle Cd at wide open | 0.828 of the bore area | measured, C2 (an LT body; for the 90 mm bodies an assumption) |
| plenum volume | 0.5 x displacement (LS3 3.08 L, LS7 3.50 L, LT1 3.08 L) | ASSUMPTION: no published figure found; the Intake tab's own rule for an unknown plenum. Sensitivity 1.55 / 6.2 L |
| runner length, valve to plenum | 300 mm | ASSUMPTION: not published; the page's default and part 2's value. Sensitivity 250 / 350 / 450 mm |
| runner diameter | sqrt(0.6) x the intake valve | the 4-Stroke tab's rule (as part 2) |
| inlet tube, filter to throttle | 600 mm x 101.6 mm | ASSUMPTION: the page's defaults. Sensitivity 300 / 1200 mm |
| air filter loss | 0 | ASSUMPTION (not published; the rating's test set-up is not known). Sensitivity 2.5 kPa at the rated-power airflow at VE 1 |
| valve flow | LS3, LT1 measured (C1); LS7 the LS3's Cd(L/D) | C1 |

Whole engine (`ratings.js whole=1`, implied by `intake=plenum`): both banks, cylinders 1-8 firing 1-8-7-2-6-5-4-3 at 90 deg,
odd cylinders on the left bank, each bank on part 2's long-tube 4-1. With open runners the banks are independent and the
whole engine gives part 2's one-bank numbers within 1 lb-ft (`c_whole`).

### C4 Ratings, before and after (`ratings.js`, `ratings_report.py after c_bench c_plen c_final`)

after = part 2 (open runners, 0.7 law, one bank); c_bench = measured valve flow only; c_plen = whole engine with plenum,
throttle and inlet, 0.7 law; c_final = both (the realistic case). Brake = gross IMEP - Heywood tfmep (B4).

| engine | rating | case | indicated torque | indicated power | brake torque | brake power | VE peak; at the rated torque speed | gross IMEP at the rated torque speed (bar) |
|---|---|---|---|---|---|---|---|---|
| LS3 | 425 lb-ft @ 4600, 430 hp @ 5900 | after | 568 @ 5000 (+34 %) | 593 @ 5800 (+38 %) | 497 @ 5000 (+17 %) | 510 @ 5800 (+19 %) | 1.130 @ 5000; 1.088 | 16.08 |
| LS3 | | c_bench | 576 @ 5000 (+35 %) | 629 @ 6600 (+46 %) | 495 @ 5000 (+16 %) | 520 @ 5800 (+21 %) | 1.125; 1.080 | 15.95 |
| LS3 | | c_plen | 553 @ 5000 (+30 %) | 575 @ 5800 (+34 %) | 481 @ 5000 (+13 %) | 491 @ 5800 (+14 %) | 1.100; 1.059 | 15.65 |
| LS3 | | **c_final** | 560 @ 5000 (+32 %) | 608 @ 6600 (+41 %) | **479 @ 5000 (+13 %)** | **499 @ 5800 (+16 %)** | 1.096; 1.051 | 15.52 |
| LS7 (cam assumed) | 470 lb-ft @ 4800, 505 hp @ 6300 | after | 650 @ 5000 (+38 %) | 660 @ 5800 (+31 %) | 565 @ 5000 (+20 %) | 563 @ 5600 (+11 %) | 1.126; 1.116 | 16.53 |
| LS7 | | c_bench (family) | 663 @ 5000 (+41 %) | 702 @ 6400 (+39 %) | 565 @ 5000 (+20 %) | 576 @ 5800 (+14 %) | 1.127; 1.112 | 16.46 |
| LS7 | | c_plen | 630 @ 4800 (+34 %) | 637 @ 5800 (+26 %) | 546 @ 4800 (+16 %) | 539 @ 5600 (+7 %) | 1.091; 1.088 | 16.10 |
| LS7 | | **c_final** | 641 @ 5000 (+36 %) | 674 @ 6400 (+34 %) | **543 @ 5000 (+16 %)** | **549 @ 5800 (+9 %)** | 1.092; 1.084 | 16.03 |
| LT1 (cam assumed) | 460 lb-ft @ 4600, 455 hp @ 6000 | after | 569 @ 5000 (+24 %) | 572 @ 5600 (+26 %) | 496 @ 5000 (+8 %) | 489 @ 5600 (+8 %) | 1.107; 1.084 | 16.28 |
| LT1 | | c_bench | 578 @ 5000 (+26 %) | 599 @ 5800 (+32 %) | 496 @ 5000 (+8 %) | 500 @ 5600 (+10 %) | 1.107; 1.081 | 16.24 |
| LT1 | | c_plen | 553 @ 4800 (+20 %) | 555 @ 5600 (+22 %) | 480 @ 4800 (+4 %) | 471 @ 5600 (+3 %) | 1.077; 1.054 | 15.83 |
| LT1 | | **c_final** | 561 @ 5000 (+22 %) | 580 @ 5800 (+27 %) | **479 @ 4800 (+4 %)** | **480 @ 5600 (+6 %)** | 1.076; 1.052 | 15.79 |

Read: brake torque +4 to +16 % (part 2: +8 to +20 %), brake power +6 to +16 % (+8 to +19 %); the torque peak still 200-400
rpm late (LS3 5000 against 4600; LT1 now 4800 against 4600); VE at peak 1.08-1.10 (1.11-1.13). The intake system takes
3-4 % of torque; the measured valve flow under 1 % of torque and adds top-end power (the exhaust valve flows more than the
0.7 law). Part 2 estimated the LS3 needs about 14.5 bar of gross IMEP at 4600 rpm; it has 15.5 (16.1 before). The rest is
mostly the model's own indicated work (C6).

Sensitivity (LS3, c_final, one change at a time; `results/ratings_cs_*.json`):

| one change | LS3 brake torque | LS3 brake power | |
|---|---|---|---|
| none (c_final) | 479 @ 5000 (+13 %) | 499 @ 5800 (+16 %) | |
| plenum 1.55 L / 6.2 L (0.5x / 2x) | 478 @ 5000 / 479 @ 5000 | 498 / 499 | under 0.3 %: the assumed volume does not matter here |
| throttle 92 mm | 480 @ 5000 | 500 | +0.2 % |
| throttle Cd 1.0 / 0.7 | 482 / 474 @ 5000 | 504 / 493 | +0.6 / -1.0 % |
| runner 250 / 350 / 450 mm | 449 @ 5600 / 491 @ 4400 / 520 @ 4200 | 501 @ 6200 / 489 @ 5800 / 464 @ 5000 | the runner sets the peaks: -6 % to +9 % and 600-800 rpm. 350-400 mm would put the torque peak at the rating's 4600 rpm, but the length is not known and was not picked |
| filter 2.5 kPa at the rated airflow | 464 @ 5000 (+9 %) | 478 (+11 %) | -3.1 % / -4.2 % |
| inlet tube 300 / 1200 mm | 481 / 476 | 500 / 496 | under 0.7 % |
| LS3 with the "family" law (its own curve by L/D; check) | 479 | 499 | identical, as it must be |
| ETA_C 0.95 | 465 (+9 %) | 484 (+13 %) | -2.9 % |

### C5 What the rating comparison now rests on

Measured: the LS3's and LT1's head flow; the 87 mm body's flow; the throttle bores. Assumed (each with its sensitivity):
plenum volume (no effect), runner length (the largest single effect on the curve's shape: unknown, and the stock LS3 runner
with its head port is likely longer than 300 mm, which would raise the torque and move its peak toward the rating), inlet
tube, filter loss (each kPa about -1.3 %), the LS7's flow and the LS7/LT1 cams. Not modelled: the stock exhaust (catalysts,
mufflers; the rating's set-up is not known), the friction of a modern V8 (likely below Heywood's), the LT1's direct
injection and phaser.

### C6 The cylinder against OpenWAM, like for like (`cyl_expts.py`, `cyl_trace.js`, `results/cyl_c6.json`)

Same geometry, both codes, part 1's matrix engines single_L800 and i4_41 (12 speeds), OpenWAM releasing the wave model's
heat per kg of charge (compare.comb_eff). Each experiment changes one thing.

1. Valve flow areas actually used (OpenWAM's instantaneous `Inflow_Discharge_Coef` / `Outflow_Discharge_Coef` x the
   pipe-end area against the wave model's CdA(theta)): peaks equal to 5 digits (intake 1.055e-3 m2, exhaust 7.623e-4 m2;
   OpenWAM's table is the same law, not clipped); where the flow keeps its direction through the valve event (6000 rpm
   single, 6500 rpm i4) the curves agree within 0.6-1.2 % of peak and the opening and closing angles within 1.3 deg. At other
   speeds OpenWAM's reported coefficient follows the flow's direction (it reports the inflow coefficient only while gas
   flows in), so its "edges" there are not the valve's. Ruled out: lift-dependent Cd, a different reference area, clipping,
   valve timing convention.
2. Burn: the crank angles of 10, 50 and 90 % burned agree within 0.4 deg at every speed (wave 15.19 / 28.47 / 42.47 deg after
   ignition; OpenWAM 15.05-15.49 / 28.33-28.77 / 42.33-42.78, its heat release law output `HRL`). Ruled out: the Wiebe a, m,
   start, duration as applied.
3. Heat per charge: the wave cylinder run from its own IVC state but with OpenWAM's heat per kg of charge gives its own work
   to 0.03 % (`wave_ivc_openwam_heat_per_charge`). Ruled out: the heat release.
4. Trapped charge (IVC): the wave model traps more. VE (trapped fresh) wave / OpenWAM 0.966 / 0.935 ... 1.112 / 1.053 (ratio
   0.97-1.06, mean 1.03); total mass at IVC 6-13 % more, of which about 7.7 % is the fuel vapour the wave model puts into the
   charge at the valve and OpenWAM's cylinder mass does not yet hold at IVC (OpenWAM's R = p V / (m T) at IVC is 282.6 J/kg K in
   every run, against the wave mixture's 272.0; part 1 found 272 in OpenWAM later in compression, so its fuel enters after
   IVC). Residual: OpenWAM 1.8-4.8 %, wave 1.5-5.2 %.
5. The closed cycle (IVC to EVO): wave / OpenWAM work 1.044-1.173 (mean 1.12). The wave cylinder run again from OpenWAM's own
   pressure and temperature at IVC, with OpenWAM's heat (`openwam_pT`; the copy of the cylinder step reproduces the wave run's
   own closed-cycle work to 1e-6 first): 1.057-1.098 (mean 1.078); from OpenWAM's mass plus its fuel at OpenWAM's temperature
   (`openwam_ivc`): 1.063-1.103. So of the closed-cycle surplus about two thirds (7-8 points) stays with the same charge and
   the same heat: it is the cylinder's thermodynamics during compression, burn and expansion, not the valves, the burn law or
   the trapped mass; the other third (3-5 points) is the larger trapped charge. Wall heat in the closed cycle (wave, from
   OpenWAM's state) 103-194 J against OpenWAM's whole-cycle 139-176 J: the same size; not separated further here.
   Candidates left: the gas properties in the closed cycle (OpenWAM's own species model with R 285.4 for its burned gas and
   its fuel added during compression, against the wave model's frozen GRI products and premixed vapour), and the in-cylinder
   wall heat's split by phase. Not tested here; no model change was made for this item, since no defect was found.
   Not modelled in either code: crevices and blow-by (OpenWAM's writer sets its blow-by area 0).

### C7 Pinned values and tests changed

- `web/tests/cam_ui.js`: the plenum spec now holds the simulated cylinders' share of the 6 L plenum, the 90 mm throttle and the
  tube (V_m3 0.006 x share, diameters x sqrt(share)) and the throttle's cd 0.83; the OpenWAM case's "intake plenum, 6 litres"
  becomes the share in litres. Reason: the cylinders simulated breathe from their share of the engine's plenum (before, the
  OpenWAM case gave the whole plenum to one bank). The plenum volume input moved from litres (num) to the page's
  displacement unit (cu in / cc), so the test types 366.14 cu in where it typed 6. New: filter loss reaches the spec; the
  LS3's head curve reaches the spec (312 cfm -> 1432 mm2).
- `web/tests/wavegas_ui.js` 11 (new), `web/tests/wave_wasm.js` (two jobs added: tables + plenum + stepped inlet + throttle
  + filter on the four-cylinder collector; plenum with the constant gas). Nothing removed or loosened.
- No numeric pin of the existing tests changed: open runners and the 0.7 law are bit for bit as before (C8).

### C8 Verification

- `kat.js` 66 of 66, `results/kat.json` byte-identical; `constref.js` 112 speeds identical (constant gamma).
- `ratings.js tag=c_open` reproduces part 2's `after` to the last printed digit.
- `wavegas_ui.js` 11: the source table in the page; benchCdA within 0.013 % of a hand formula (gamma 1.4) on 18 points; the
  LS3's Cd values; flowTab's interpolation; a steady numerical flow bench of the model's own pipe and valve at 0.600 in and
  28 in H2O gives 312.0 cfm (source 312); the throttle by hand and in steady flow (0.3587 kg/s both); the filter's loss in
  steady flow (C2); plenum mass and total energy over a cycle to 1e-14.
- `wave_wasm.js`: JS and Rust/WebAssembly bit for bit on every job, the two new ones included.
- Suite (`python3 tools/run_all_tests.py -j 2`, 2026-11-12 part 3): 148 tests, 145 passed, 2 skipped and 4 partial skips,
  all expected, 1 failed: wavegas_ui, a quote in one of its new messages (a syntax error in the test file, no check reached);
  fixed and rerun alone: 121 checks, all pass. wave_wasm_built (every speed, JS against Rust) and cam_ui, sim_ui, multi_ui,
  sound_ui, dyno_ui, mdwam_ui, jpipe_ui, test_header_uel passed in the run; build_wave_wasm left the page's embedded
  WebAssembly byte-identical.

### C9 Summary rows (section 6, as of 2026-11-12, part 3)

| Difference | Status | Evidence |
|---|---|---|
| Valve Cd 0.7 constant | measured head flow for the LS3 and LT1 (cfm at 28 in H2O -> Cd A by the orifice law); 0.7 law kept as the default and for heads without data; it is within 10 % of the LS3's measured intake, the LS3's exhaust flows up to 34 % more | C1 |
| No plenum, throttle, filter | modelled (plenum volume, throttle step at its measured wide-open Cd A, filter loss as an input); page inputs | C2 |
| Against real ratings | brake torque +4 to +16 %, power +6 to +16 % (part 2: +8 to +20 %, +8 to +19 %); torque peak 200-400 rpm late; most sensitive to the (unknown) runner length | C4 |
| Indicated work above OpenWAM | not the valve areas, timing, Wiebe or heat: about 3-5 points trapped charge, 6-10 points closed-cycle thermodynamics from the same IVC state and heat; open | C6 |

### C10 How to rerun (additions)

```
node web/tests/wavegas_ui.js                       # 11: valve tables, flow bench, throttle, filter, plenum balances
QUICK=1 node web/tests/wave_wasm.js
node tools/validation/wave/ratings.js tag=c_final intake=plenum flow=benchfam      # whole engines, ~5 min
node tools/validation/wave/ratings.js engines=ls3 tag=cs_rl350 intake=plenum flow=benchfam intakeL=0.35   # and plv=, tbd=, tcd=, fdp=, itl=
python3 tools/validation/wave/ratings_report.py after c_bench c_plen c_final
python3 tools/validation/wave/cyl_expts.py configs=single_L800,i4_41 tag=c6          # OpenWAM, ~5 min
```

## Addendum 2026-11-12, part 4: the closed cycle against OpenWAM and against an independent calculation

Part 3 (C6) left the wave model's cylinder doing 6-10 % more work than OpenWAM's from intake closing (IVC) to exhaust
opening (EVO), even from OpenWAM's own IVC pressure, temperature and heat, with the valves, the burn law, the heat per kg and
the trapped mass ruled out. Here both cylinders are instrumented, an independent closed-cycle calculation is written from
first principles, and each code's choices are priced one at a time against it. Engine: part 1's single_L800 (single cylinder,
95 x 63.4 mm, rod 107.8 mm, CR 13, AFR 12.8, Wiebe 18 deg BTDC / 55 deg, a 5, m 2, wall 450 K) at 3000, 5000 and 7000 rpm.
Result: the wave model's closed cycle is what first principles give for its assumptions (within 0.06 %); OpenWAM's lower work
comes from simplifications in its gas model that are not better physics. No change was made to the model.

### D1 Instrumentation

- OpenWAM: its own instantaneous outputs, no rebuild. The writer (`openwam/make_wam.py`) gained the run option
  `cyl_ins_extra` (default 0: files unchanged; `test_py_js.js` 150 of 150 unchanged): 1 adds the cylinder's Woschni
  coefficient (output 14), its mass fractions of burnt gas, fuel and air (28), gamma (29) and the wall heat rates to head,
  liner and piston (30-32, W) to INS.DAT (`TCilindro.cpp` 1342-1448, 1882-1928), every 0.5 deg.
- Wave model: `lib.js` (hook mode, read-only) also exposes the step's Woschni coefficient, area and velocity; `cyl_trace.js`
  records per step p dV, heat released, wall heat with hc, area and velocity, and gamma, cp, R.
- `cyl_phase.py` runs both and splits the closed cycle into compression (IVC 584 deg to ignition 702 deg), burn (the
  Wiebe's 55 deg) and expansion (to EVO 132 deg); `results/cyl_d.json`.

### D2 Phase by phase (each code from its own run; J per cycle)

| rpm | phase | p dV wave / OpenWAM | wall heat wave / OpenWAM |
|---|---|---|---|
| 3000 | compression | -183.4 / -184.3 | 1.6 / 2.7 |
| | burn | 316.0 / 291.8 | 104.3 / 67.2 |
| | expansion | 542.3 / 500.9 | 80.3 / 56.3 |
| | closed cycle | **674.9 / 608.4 (1.109)** | 186.2 / 126.2 |
| 5000 | compression | -211.8 / -221.6 | 1.8 / 3.4 |
| | burn | 370.8 / 347.8 | 87.2 / 63.3 |
| | expansion | 653.1 / 590.8 | 77.0 / 59.2 |
| | closed cycle | **812.2 / 716.9 (1.133)** | 166.0 / 125.9 |
| 7000 | compression | -192.6 / -201.6 | 2.0 / 3.3 |
| | burn | 325.0 / 295.7 | 64.7 / 50.5 |
| | expansion | 576.9 / 539.1 | 61.2 / 51.8 |
| | closed cycle | **709.3 / 633.2 (1.120)** | 127.9 / 105.6 |

The extra p dV is in the burn and the expansion; the compression agrees within 0.5-4.5 % (OpenWAM's slightly higher
compression work is its fuel entering after IVC, D4). The wave model loses 20-48 % MORE heat to the walls than OpenWAM in
the closed cycle, so the wall heat cannot explain its higher work; it pulls the other way (D4).
Heat released: wave 1586.5 / 1872.6 / 1623.1 J, OpenWAM 1534.6 / 1795.7 / 1586.6 J (its Qcomb) at the three speeds: per kg of
charge the same (C6, item 3), the totals differ with the trapped charge.

### D3 The independent calculation (`tools/validation/wave/closed_cycle.py`)

Shares no code and no property data with either code:
- properties: NASA's 9-coefficient polynomials (McBride, Zehe and Gordon 2002, NASA TP-2002-211556; NASA CEA
  `data/thermo.inp`, https://raw.githubusercontent.com/nasa/cea/main/data/thermo.inp, fetched 2026-11-12), not the GRI-Mech
  3.0 fits of the model, for N2, O2, Ar, CO2, H2O, CO, H2, OH, H, O, NO, N, and the fuel vapour as 0.62608 isooctane + 0.37392
  toluene from their own NASA fits (not the model's refit); absolute enthalpies, the fuel's formation enthalpy from its
  44.0 MJ/kg LHV with NASA's CO2 and H2O (as B1 defines the fuel);
- products frozen (the model's rule: complete when lean, water-gas ratio 3.5 when rich) or in chemical equilibrium over the
  12 species at the zone's temperature and the cylinder's pressure, by the element-potential Newton method of Gordon and
  McBride (NASA RP-1311, 1994, eqs. 2.24-2.26, with its damping); the unburned part frozen;
- energy dU = -p dV - dQw with U = sum n_i (h_i(T) - R T) absolute, so the heat of combustion follows from the composition;
  the combustion inefficiency (frozen chemistry minus the heat the case releases) leaves with the burned fraction; RK4 in
  crank angle at 0.1 deg (0.25 deg with equilibrium; 0.5 against 0.1 deg changes the work by 1e-5), steps ending on the
  burn's start and end; energy balance to 1e-15 of the heat;
- Woschni in a chosen form (D5), the motored pressure from a motored run of the same charge (the published definition) or
  the codes' polytropic stand-ins;
- options that copy each code's choices: `gas='openwam'` (OpenWAM's simple species model, `Globales.h` 1609-1660: its cv
  polynomials for air, burnt gas and gasoline, R 287 / 285.4 / 72.42, and its energy equation `TCilindro4T.cpp` 911-913,
  dlnT = (gamma-1)(-dV/V + dm/m) + dQ/(m cv T), with the fuel injected from IVC + 2 deg over (720 - IniComb - IVC) / 2 deg,
  lines 180-181, burnt gas formed as stoichiometric products of the fuel burned Q / LHV, line 641); `woschni='openwam'`;
  `euler_wave`: the wave model's own explicit step on the wave run's time steps.
Self-checks (`python3 closed_cycle.py thermo.inp gri30.yaml`, all pass): stoichiometric AFR 14.5964 (model 14.596); the heat
per kg of mixture 2.8205 / 2.6747 MJ/kg at AFR 14.6 / 12.8 (B1 by hand: 2.8205 / 2.6746); cp against NIST-JANAF
(janaf.nist.gov tables C-095, H-064, N-023, fetched 2026-11-12) for CO2 at 1000 and 3000 K, H2O at 1000 K, N2 at 1500 and
3000 K within 0.12 % (H2O at 2000 K 1.1 % above JANAF: NASA's water, as A1 found); the equilibrium constants of
CO2 = CO + 1/2 O2 and H2O = OH + 1/2 H2 hold to 1.4e-14 in ln K (AFR 12.8 / 14.6, 2000-3000 K, 20-120 bar); run on GRI data
the solver agrees with `dissociation.py` within 1.8 % on every mole fraction above 1e-3 where dissociation.py's own
optimiser converged. Found on the way: dissociation.py's SLSQP minimum stops short at 2000 K (H2 or H set to zero; its
ln K residuals 340-1000) and is 0.0066 off in ln K elsewhere. B2's table is not affected: rerun with this solver
(`closed_cycle.py thermo.inp b2`) the expansion work frozen / equilibrium is +3.46 / +3.45 % at AFR 14.6 and +1.02 / +1.03 %
at 12.8 (B2: +3.6 and +1.0 %); its peak pressures are 12 % higher than B2's, which counted the fuel as one mole per C atom
(B2's comparison of frozen against equilibrium is unchanged by that).

Verification against each code (the work from IVC to EVO):

| from the wave model's IVC state and heat | 3000 | 5000 | 7000 rpm |
|---|---|---|---|
| independent, frozen products, the model's Woschni (pm 1.32) / wave run | 0.9997 | 1.0001 | 0.9996 |
| the same with the true motored pressure | 0.9994 | 0.9999 | 0.9994 |
| the wave model's explicit step on its own time steps (NASA data) / RK4 | 1.0002 | 0.9998 | 1.0003 |
| from OpenWAM's IVC state and heat: the OpenWAM copy / OpenWAM run | 1.0013 | 1.0000 | 1.0015 |

So the independent calculation reproduces both codes from their own states, the wave model to 0.06 % and OpenWAM to 0.15 %,
and the wave model's explicit p dV costs nothing measurable (part 1's -0.42 % temperature error over a whole adiabatic cycle
cancels between compression and expansion in the work).

### D4 Where OpenWAM's lower work comes from (from OpenWAM's own IVC state and heat; ratios to OpenWAM's closed-cycle work)

One change at a time, cumulative, from the OpenWAM copy towards the model's physics:

| step | 3000 | 5000 | 7000 rpm | step's share |
|---|---|---|---|---|
| OpenWAM copy (its gas, its Woschni, fuel injected after IVC) | 1.0013 | 1.0000 | 1.0015 | |
| + the fuel premixed in the charge at IVC (as the model) | 1.0036 | 1.0021 | 1.0033 | +0.2 % |
| + the composition term of the energy equation | 1.0375 | 1.0371 | 1.0390 | +3.4-3.6 % |
| + the Wiebe's last 0.67 % of the heat | 1.0445 | 1.0441 | 1.0460 | +0.7 % |
| + NASA-9 properties for the same composition | 1.0463 | 1.0462 | 1.0479 | +0.2 % |
| + rich products CO and H2 (the model's frozen products) | 1.0960 | 1.0970 | 1.0995 | +4.7-4.9 % |
| + the model's Woschni (Heywood form, combustion term to EVO, pm 1.32) | 1.0681 | 1.0822 | 1.0898 | -0.9 to -2.5 % |
| (instead: + equilibrium products) | 1.0652 | 1.0785 | 1.0854 | -0.3 to -0.4 % |
| the wave model from its own IVC state | 1.1094 | 1.1329 | 1.1201 | IVC state: +2.8 to +4.7 % |

Each item, judged against independent physics, not against the other code:
1. Composition term (+3.5 %). OpenWAM integrates m cv dT = dQ - p dV - dQw with cv switched to the new composition; the
   internal energy of a mixture is m sum Y_i u_i(T), so converting dm of air and fuel into burnt gas at T also changes U by
   dm (u_burnt(T) - u_unburned(T)), which its equation leaves out. With its own cv polynomials (sensible from 298.15 K, the
   LHV's datum) that difference is negative (its gasoline cv is 3-5 times air's), so the omission discards about 3.5 % of
   the work's worth of energy. This is an energy-conservation error in OpenWAM, not physics the model lacks.
2. Rich products (+4.7-4.9 %). OpenWAM's simple species model burns Q / LHV of fuel to stoichiometric products and keeps the
   rest of the fuel (18 % of it at AFR 12.8 with its combustion efficiency 0.818) as gasoline vapour and the rest of the air
   as air, to EVO, at 2000-2800 K. A rich flame leaves CO and H2 (Heywood ch. 4; the water-gas ratio, which equilibrium
   confirms, D5): unburned fuel and oxygen do not coexist at those temperatures. The model's products (R 294.4 against 285.4,
   more moles per kg) are the physical ones. OpenWAM's simplification.
3. The Wiebe's tail (+0.7 %): OpenWAM's burn stops at 1 - exp(-5) = 0.9933 of the heat it was given (its HRL ends at
   0.992-0.993); the wave model releases the rest at the end of the duration. A convention (the wave model releases the heat
   it is given); with it, `compare.comb_eff` makes OpenWAM release 0.67 % less than the wave model.
4. Fuel injection (+0.2 %): OpenWAM injects the port fuel during compression with the mixture's enthalpy cp T (the mass term
   of its energy equation); the model premixes it at the valve. Small either way.
5. Property fits (+0.2 %): OpenWAM's cv polynomials against NASA's for the same composition: equivalent.
6. Wall heat (-0.9 to -2.5 %, the other way): OpenWAM's Woschni (`TCilindro4T.cpp` 549-577) has 1.2e-2 p(Pa)^0.8 T^-0.53,
   a combustion term C2 = 0.001 ("antes 3.24e-3 (ahora 0.001)", line 549) only between the start and the end of the burn,
   pm with exponent 1.36 and R 287; the model has the published form (D5). OpenWAM's is lighter: 20-48 % less closed-cycle
   wall heat. Its change of the published C2 is OpenWAM's own choice; not adopted.
So the model has nothing to take from OpenWAM here: of the 11-13 % closed-cycle surplus, 6.8-9.0 points are OpenWAM's
simplifications net of its lighter wall heat, and 2.8-4.7 points the larger charge the wave model traps at IVC (C6 item 4:
VE and residual; that part is not explained here).

### D5 What first principles say about the model's own assumptions

- Dissociation (single zone, the products in equilibrium at the mean temperature and the cylinder's pressure, the same
  burn and wall heat; `cyl_phase.py`, `closed_cycle.py thermo.inp afr results/cyl_d.json`): -0.29 / -0.30 / -0.41 % of
  the closed-cycle work at AFR 12.8 (3000 / 5000 / 7000 rpm); without wall heat -0.47 / -0.49 / -0.53 %; at AFR 14.6
  (5000 rpm state) -1.81 % (-2.57 % adiabatic). A two-zone burn (hotter burned gas) would dissociate more; B2's adiabatic
  constant-volume burn (+1.0 / +3.5 %) is the upper bound. OpenWAM has no dissociation either, so it explains none of the
  difference. Not added: 0.3-0.4 % at the AFR of every validation and rating run here; at stoichiometric about 2 %, which
  is named on the page as left out (a fast equilibrium for the page is a possible follow-up; this script's solver is the
  verified reference for it).
- Woschni's constants: the model uses 3.26 B^-0.2 p(kPa)^0.8 T^-0.55 w^0.8 (Heywood's form; reproduced with T^-0.55 and
  attributed to SAE 670931 in the FAMU-FSU propulsion notes "Convective Heat Transfer",
  https://web1.eng.famu.fsu.edu/~shih/propulsion/lecture%20notes/Convective%20Heat%20Transfer.pdf, fetched 2026-11-12).
  Woschni's own units, 110 kcal/(m2 h K) with p in at (kp/cm2), convert to 3.264 with p in kPa, the same constant, but his
  exponent of T is -0.53: so given by NASA CR (NTRS 19880003963, https://ntrs.nasa.gov/api/citations/19880003963/downloads/19880003963.pdf,
  fetched: "110 ... p^0.8 T^-0.53", OCR-damaged) and used with 3.26 and T^-0.53 by libICEpost
  (https://libice-post.readthedocs.io/en/stable/autoapi/libICEpost/src/engineModel/HeatTransferModel/Woschni/index.html,
  fetched; C2 3.24e-3 combustion/expansion, motored exponent 1.32). SAE 670931 itself could not be fetched. The factor T^0.02
  is 14-17 % on h at 800-2500 K: with T^-0.53 the closed-cycle wall heat is 15 % higher and the work 0.8-1.3 % lower
  (`woschni67` rows). Both forms are published; the model's stays (an uncertainty of about 1 % of the work, stated on the
  page). OpenWAM's 1.2e-2 p(Pa)^0.8 is 120 in bar units against Woschni's 129.8 (3.26 kPa): 8 % lower.
- The motored pressure: the polytropic pm with exponent 1.32 against a true motored run of the same charge changes the work
  by 0.02-0.03 %.
- Integration: D3.

### D6 What was changed

- Model (`wsFactory`, `rust/et_wave`, WebAssembly): nothing. The page's simulation is byte-identical to part 3's; the only
  change in `web/index.html` is the method text of the wave simulation (the OpenWAM gap, measured: "not a surplus of this
  model's cylinder", with the split above).
- Tools: `closed_cycle.py` and `cyl_phase.py` (new), `cyl_trace.js` (more columns), `lib.js` (exposes hc, area, velocity),
  `openwam/make_wam.py` (`cyl_ins_extra`, default off).

### D7 Re-validation

- Since the model did not change, the ratings table (C4: brake torque +4 to +16 %, power +6 to +16 %), the OpenWAM
  cross-check ratios (B7, C6), the sound orders and the run time are those of part 3, unchanged; they were not rerun
  (`git diff` of the model's code is empty). kat.js, constant-gamma mode, wavegas_ui and JS/Rust/WASM parity: in the suite
  run below.
- Rerun to confirm: `kat.js` 66 of 66 (`results/kat.json` byte-identical); `constref.js` 112 constant-gamma speeds identical;
  `ratings.js engines=ls3 intake=plenum flow=benchfam` reproduces part 3's `c_final` LS3 entry exactly (479 lb-ft @ 5000,
  499 hp @ 5800 brake).
- Suite (`python3 tools/run_all_tests.py -j 2`, 2026-11-12 part 4, the machine shared with two other agents, load 6-7 on 2
  cores): 153 tests, 149 passed, 2 skipped and 4 partial skips (all expected), 2 failed: `test_header_uel` (P3 short of
  its gap by 0.85 cm) and `test_native` (a route differing between its two directions), both Fusion tube-routing tests in
  `fusion-addin/tests` that use none of the files changed here (fusion-addin and rust are untouched); both also failed
  when rerun alone under that load. wavegas_ui, wavekat_ui, wave_wasm and wave_wasm_built (JS / Rust / WebAssembly bit for
  bit), cam_ui, sim_ui, multi_ui, sound_ui, dyno_ui, mdwam_ui, jpipe_ui and openwam test_py_js (150 of 150) passed.
- No pinned value was changed.

### D8 The stock intake runner length (searched again)

Not found. Searched: GM / SAE papers on the Gen IV and Gen V small-block intake (none with a dimension found), LSX Magazine's
LS3 intake dyno test (https://www.lsxmag.com/tech-stories/dyno-testing-four-popular-ls3-bolt-on-intake-manifolds/: no
length, only "designed for the stock 92 mm unit"), its LS/LT intake design feature (https://www.lsxmag.com/?p=25093: no stock
lengths; the LT6's 5.5 L plenums only), EngineLabs' FAST LSXR test (https://www.enginelabs.com/?p=196083: the FAST runners
8 / 6.25 / 3.5 in, not stock), and LS1Tech threads (https://ls1tech.com/forums/generation-iv-internal-engine/426226-intake-runner-length.html:
the LS7 manifold's runners "measured ... rather crudely ... 7.25", manifold only, no head port; an LS1 "~16 in" complete
runner given as a belief; https://ls1tech.com/forums/advanced-engineering-tech/1347488-looking-factory-intake-runner-specs.html:
no measurement). None is a sourced valve-to-plenum length for the LS3, LS7 or LT1, so the 300 mm stays an assumption, with
part 3's sensitivity (250 mm -6 %, 450 mm +9 % on LS3 brake torque).

### D9 Summary rows (section 6, as of 2026-11-12, part 4)

| Difference | Status | Evidence |
|---|---|---|
| Closed-cycle work above OpenWAM, 11-13 % (single_L800) | explained: OpenWAM's energy equation omits the composition term (3.5 %), its rich products are burnt + air + unburned fuel (4.7-4.9 %), its burn stops at 99.33 % of the heat (0.7 %), fuel and property details (0.4 %); its lighter Woschni the other way (0.9-2.5 %); the rest, 2.8-4.7 %, the larger trapped charge (open) | D4 |
| The model's closed cycle | reproduced by an independent first-principles calculation within 0.06 %; explicit step error under 0.03 % | D3 |
| Dissociation | not modelled: -0.3 to -0.4 % of the work at AFR 12.8, -1.8 % at 14.6 (single zone) | D5 |
| Woschni's T exponent | -0.55 (Heywood's form, the model) against -0.53 (Woschni's units): about 1 % of the work; both published | D5 |
| Stock runner length | not found; 300 mm assumed | D8 |

### D10 How to rerun (additions)

```
curl -sSL -o thermo.inp https://raw.githubusercontent.com/nasa/cea/main/data/thermo.inp
curl -sSLO https://raw.githubusercontent.com/Cantera/cantera/main/data/gri30.yaml
python3 tools/validation/wave/closed_cycle.py thermo.inp gri30.yaml      # self-checks and the equilibrium cross-check, ~2 s
python3 tools/validation/wave/cyl_phase.py thermo.inp rpms=3000,5000,7000 tag=d   # OpenWAM + wave + independent, ~6 min
python3 tools/validation/wave/closed_cycle.py thermo.inp afr tools/validation/wave/results/cyl_d.json   # dissociation at 14.6, ~1 min
python3 tools/validation/wave/closed_cycle.py thermo.inp b2              # B2 again with this solver, ~7 min
```

## Addendum 2026-11-13, part 5: the turbocharged engine (boosted intake, turbine, wastegate)

Until now the wave model ran naturally aspirated engines only: every runner mouth (or the plenum's inlet) was an open end
on still air at 101325 Pa and 298.15 K (`openEnd(-1, mouthP, TATM, 1)`; `opts.pIn` lowered the mouth's pressure for a part
throttle, in the JavaScript only), and every tail end discharged to the same atmosphere. Nothing on the page could put a
turbocharged engine through it: the Intake tab's boosted sections (`calcTurboRoute`, `turbineBalance`, `mfdCalc`) are
steady-flow algebra, and the turbo manifold section said its blowdown peak "needs a wave model". This part adds the
boosted charge, the turbine and the wastegate to the model (JS `wsFactory` and Rust `rust/et_wave` in bit parity), a
closure that finds the turbine's effective area from the Intake tab's own power balance, and "Simulate with the turbo" on
the 4-Stroke tab. Nothing was tuned to a rating or to OpenWAM. Every naturally aspirated result is unchanged to the last
digit (E5).

### E1 The boundary elements and their sources

- **Boosted charge** (`intake.source = {p, T}`, `sourceOf`): the runner mouths (or the plenum's inlet) are open ends on the
  charge after the compressor and the intercooler instead of the air: the same `openState` (Benson's characteristic open
  end; gas coming in isentropically from the still source at p, T, at most sonic) with the source's p and T, and the
  intake pipes, the plenum and the cylinders filled at it (`makePipe` takes a fill pressure, absent = 101325 Pa). The page
  takes p = the route's throttle-inlet pressure (`R.Pt`, boost + atmosphere) and T = its intercooler outlet temperature
  (`R.t3`); the gas properties are already those of air at T. The compressor is a boundary only: steady boost at each
  speed, no map, no surge, no compressor or turbo speed, no inertia (steady full-load points only).
- **Tail back pressure** (`exhaust.pOut`): the open tail ends discharge into that static pressure (used for the runs
  without a turbine that the page compares with).
- **Turbine** (`exhaust.turbine = {CdA, eta, wgCdA, wgTo, down, pOut}`, `turbineFace`): every tail end that would be open
  becomes a turbine entry (one for a single collector; two for a divided manifold on a divided housing), the entries
  sharing the effective area equally. The quasi-steady equivalent nozzle of 1-D engine codes: the turbine passes what an
  isentropic nozzle of one effective area passes from the turbine-inlet stagnation state to the turbine-outlet static
  pressure, m = A_eff sqrt(p0 rho0) psi(p4 / p0), psi = sqrt(2 g / (g - 1) ((p4/p0)^(2/g) - (p4/p0)^((g+1)/g))), choked
  below (2 / (g + 1))^(g / (g - 1)) at sqrt(g) (2 / (g + 1))^((g + 1) / (2 (g - 1))) (the orifice law the valves already use;
  NASA Glenn, Beginner's Guide, "Mass flow choking", grc.nasa.gov/WWW/K-12/BGP/mflchk.html, fetched 2026-11-13:
  mdot = (A pt / sqrt(Tt)) sqrt(g / R) M (1 + 0.5 (g - 1) M^2)^(-(g + 1) / (2 (g - 1))), at M = 1 choked). The area is
  constant: "Watson and Janota [Turbocharging the Internal Combustion Engine, 1982] and Benson [1982] used a constant Aeff
  for all conditions" and "Payri et al [Energy Convers. Manag. 55 (2012) 149-163] allowed for changes in Aeff with Nred and
  PR" (SAE 2017-24-0019, accepted version, spiral.imperial.ac.uk/bitstream/10044/1/53778, fetched 2026-11-13, which also
  writes the restriction's flow as the isentropic orifice equation, its Eq. 3). Watson and Janota's and Heywood's books
  (ch. 6, compressible flow through a restriction) were not fetched; the equation used is the NASA one above.
  Where it enters the scheme: Benson's partly open end, like the junctions, before the pipes are stepped. The pipe's
  arriving wave fixes the end state as a function of the face pressure pb (its Riemann invariant J = u + 2c / (g - 1) and its
  entropy, frozen gamma: c_b = c (pb / p)^((g - 1) / 2g), u_b = J - 2 c_b / (g - 1), rho_b = rho (pb / p)^(1 / g)); the face
  stagnation state T0 = T_b + u_b^2 / 2cp, p0 = pb (T0 / T_b)^(g / (g - 1)) (as `valveFlow`); the root of
  rho_b u_b A_face = m_nozzle(p0, T0, p4) + m_gate(p0, T0, p_gate) by bisection on [the pipe end's sonic pressure, its
  stalled pressure] (the first falls and the second rises with pb). If the nozzle could take more than the pipe's sonic
  flux the end chokes; a supersonic stream arriving keeps its state. The face flux is that end state's (mass, momentum
  m u_b + pb A, energy m (h(T_b, x) + u_b^2 / 2), fresh fraction).
  Work: W = eta m_t (h0 - h(T_is, x)), h0 = h(T_b, x) + u_b^2 / 2, T_is on the gas's own isentrope from (T_b, pb) to p4
  (`isenT`: ds = cp(T) dT / T - R dp / p = 0, p2 / p1 = (T2 / T1)^(c0 / R) exp((c1 dT + c2 d(T^2) / 2 + c3 d(T^3) / 3 +
  c4 d(T^4) / 4) / R) on each polynomial range, written with pow and exp because the Rust imports no logarithm); eta is the
  total-to-static efficiency (the Intake tab's input, 75 % when blank, the top of its sweep; no source for a typical value).
  The downpipe's first cell takes m h0 - W through a fed end (`fedEnd`), so the gas after the turbine has the stagnation
  temperature the work leaves; its static pressure at the step's start is p4. Gas flowing back (p4 above the pipe's stalled
  pressure) comes in from the downpipe's first cell through the same nozzle with no work.
  Divided housing: two nozzles in parallel with their own inlet states on one wheel (their work summed), as "two separate
  parallel equivalent nozzles" for a double-entry turbine (Galindo, Serrano, De La Morena, Samala, Guilain, Batard, Frontiers
  in Mechanical Engineering 6 (2021), doi 10.3389/fmech.2020.601368, fetched 2026-11-13). Ignored: any interaction of the
  two entries at the wheel (partial admission, flow between the scrolls at the rotor); both see the same outlet pressure.
- **Wastegate**: an orifice of area wgCdA in parallel with the turbine on the same face solve, to the turbine outlet
  (internal: its flow joins the downpipe with h0) or to the atmosphere (external: it leaves the model, counted as an
  outflow); no work. Its share of the exhaust is reported per cycle.
- **Implementation reference, OpenWAM** (`ext/OpenWAM/Source/ODModels/TTurbinaSimple.cpp`, `CalculaCondicionTurbina`
  142-385; `Connections/TEstatorTurbina.cpp`, `TRotorTurbina.cpp`): OpenWAM's turbine is a 0-D volume between two
  nozzle-type connections (stator, rotor) whose effective areas are fixed or come from a map, the work taken out of the
  volume's energy (`FTrabajoFluido`, line 368). Followed: the isentropic total-to-static enthalpy drop from the inlet's
  stagnation state (its T0 = T + v^2 / 2cp, p0 = p (T0 / T)^(g / (g - 1)), lines 236-237) to the outlet pressure times an
  efficiency. Different here: one nozzle and no volume (the single equivalent nozzle, not the two-nozzle stator/rotor form);
  the isentrope with variable cp exactly, where OpenWAM uses gamma at the inlet temperature and cp at a mean (line 284);
  the efficiency a constant input, where OpenWAM computes it from the blade-speed ratio (Watson's polynomial, a fitted
  polynomial or a map, lines 312-348), which needs the turbo's speed and a shaft with a compressor.

### E2 The closure: the effective area from the power balance

No maker publishes a turbine's flow as an effective area (the boost audit found one text figure, Garrett G40-1150's
"43 LBS/MIN", with no reference state), and no source turns a housing's A/R into a flow area (audit, "Turbine housing
A/R"), so the model finds the area itself (`turboSimLib.closure`, page JS, used with either back end): cycle-averaged
turbine power = compressor power, the balance of `turbineBalance` (whose efficiency holds the mechanical losses), with the
compressor power m_air cp (T2 - T1) from the air the engine drew from the charge in that cycle and the route's T2 and T1
(the route's pressure ratio held). At the first speed (the Intake tab's full-boost RPM) the gate is shut and the turbine's
area is found; at every faster speed that area is kept and the gate's is found (a secant in ln(area) or area inside its
bracket, to 0.5 % of the power; 3-5 runs of 2+ cycles per speed). A speed where the shut gate leaves the turbine short is
marked (the boost could not be held there; this steady model still holds it). A typed area replaces the search.
So the turbine-inlet pressure is an output of the simulation, and the efficiency and the housing's A/R enter only through
the effective area; with the page's 2 x boost (and Bell's 2-2.5 x, as the Intake tab cites it) it is compared in E7.

### E3 Known answers (`web/tests/waveturbo_ui.js`, 16 checks, about 40 s)

| check | model | reference | difference |
|---|---|---|---|
| source at 101325 Pa / 298.15 K and tail at 101325 Pa against no source, four-cylinder engine, 2 speeds x 8 outputs | | the plain run | 0 of 16 differ (bit for bit) |
| choked nozzle, 5 cm2, reservoir 300 kPa / 1100 K, burned gas (p4/p0 0.338) | 0.177633 kg/s | NASA Glenn choked flow at the end cell's frozen gamma 1.2873: 0.177633 | -0.0001 % (+0.006 % with gamma at T0) |
| unchoked nozzle, 150 kPa into 120 kPa (p4/p0 0.800) | 0.074104 kg/s | NASA Glenn's flow at the throat Mach number | -0.0000 % |
| nozzle 40 cm2 on a 60 -> 50 mm cone (end 19.6 cm2) | 0.70089 kg/s, the pipe end sonic | the cone end's choked flow 0.70197 | -0.15 % (the face area is the last cell's) |
| work, constant gas: W / (eta m), 250 kPa / 1150 K to 110 kPa | 244069.21 J/kg | cp T0 (1 - (p4/p0)^((g-1)/g)) by hand: 244069.21 | -0.0000 % |
| gas after the turbine, constant gas | 991.26 K | T0 - eta dh / cp: 991.26 K | 0.00 K |
| work, the engine's gas, cp(T) | 247218.70 J/kg | the isentrope from the entropy integral (Simpson in ln T, bisection) found in the test: 247218.71 | -0.0000 % (frozen gamma at T0 would give 243380.55, -1.6 %) |
| gas after the turbine, the engine's gas | 1011.01 K | h(T04) = h(T0) - eta dh: 1011.01 K | 0.00 K |
| steady-flow limit: turbine 4 cm2 + gate 3 cm2 to one outlet, 220 kPa, 950 °C, 110 kPa; turbineBalance (the page's own source) at the rig's p3, T3 with Wc set to the rig's W | gate share 0.4286 | the algebra's 0.4290 | 0.04 points |
| the same: the rig's turbine power against m_t cp T3 eta (1 - (p4/p3)^k) | 15.5583 kW | 15.5691 kW | -0.07 % (its constant cp at T3, its stoichiometric gas) |
| engine cycle with source, turbine and internal gate, 5000 rpm | mass residual -6.4e-16, total energy residual / heat released -4.0e-15 | 0 | turbine work 685.5 J per cycle as the sink |
| the same, external gate | 3.1e-15, -2.8e-14 | 0 | |
| the source's inflow enthalpy | h(T_source) to 3.6e-12 J/kg of 21949 | exactly | rounding |
| isentrope helper | isenT inverts isenRatio to 6.7e-16; above 3500 K (cp held) the ratio is (T2/T1)^(cp/R) to 0 | | |

### E4 JS / Rust / WebAssembly parity

`web/tests/wave_wasm.js` gains four jobs, compared as before (every output double) and now also the turbine and intake
summary (`wave_turbo_out`: 16 scalars, 720 one-degree bins of turbine-inlet total pressure per entry, 720 of the tail's mass
flow): the four-cylinder collector with turbine and internal gate, the areas changed before each speed (`wave_turbo_set`,
as the closure does); a divided turbine (two entries) with an external gate; the boosted charge alone with a tail back
pressure; the plenum and throttle under boost with the constant gas. All identical to the last digit (QUICK and full).
The page's run in Chromium against the same plan in Node: within 0.023 % (E7): the WebAssembly imports the host's Math.pow
and Math.exp, which need not round alike in two JavaScript engines, and the closure's secant then lands anywhere inside its
0.5 % tolerance. Within one engine JS and Rust agree to the last digit.

### E5 The naturally aspirated model is unchanged

`kat.js` 66 of 66 criteria, `results/kat.json` byte-identical; `constref.js` 112 constant-gamma speeds identical to the
reference; `wavegas_ui.js` 121 checks, `wavekat_ui.js`, and `wave_wasm.js` on every existing job (default gas and constant
gamma) bit for bit. The new paths run only when `intake.source`, `exhaust.pOut` or `exhaust.turbine` is given; a source at
the atmosphere reproduces the plain run to the last digit (E3, first row). No pinned value was changed.

### E6 OpenWAM cross-check: not made

OpenWAM's turbine cannot be driven from the existing writer with modest effort: its turbine is a 0-D volume with stator
and rotor connections (`TEstatorTurbina`, `TRotorTurbina`), its efficiency comes only from the blade-speed ratio (Watson's
polynomial or a fitted one, both needing the turbo's speed and wheel diameter), an external controller, or a map
(`TTurbina::LeeTurbina`); a constant efficiency is not an option, so a like-for-like case needs a turbocharger shaft with a
compressor (a map file) or a fixed speed chosen to give the efficiency, and the writer (`openwam/make_wam.py`) writes none
of these blocks (it counts zero turbines and axes). Skipped; the known answers of E3 stand instead.

### E7 Real engines: none buildable from sourced data; the K24A2 + Precision GEN2 PT5862 as a prediction

No turbocharged production engine in the page's library has cam data (`CAM_LIB` holds GM V8s only; the turbo presets, e.g.
Buick 3.8, 2JZ-GTE, B58, 4G63T, M178, carry ratings, bore, stroke and compression but no cam events). The library's only
boosted engine with a cam card, the LS9 (Lingenfelter's copy of GM 12638427), is supercharged by a positive-displacement
blower: it could test the boosted charge only, with its charge temperature and its blower's drive power unpublished; not
done. So the whole run is not tested against a rating.

The owner's build as a **prediction** (`tools/validation/wave/turbo_k24.js`, from the page's own plan captured by
`CAPTURE=1 node web/tests/turbosim_ui.js`, `results/turbo_k24_page.json`, `results/turbo_k24.json`). Every input and its basis:
- engine: the 4-Stroke tab with the K24A2 preset: 87 x 99 mm, CR 10.5 (Honda's sheet, audit B28), 2 x 35 / 2 x 30 mm valves
  and lifts 9.1 / 8.4 mm (the tab's estimates from the bore), rod 1.7 x stroke (assumed), valve Cd 0.7 (the model's law), cam
  IVO 20 / IVC 60 / EVO 60 / EVC 20 deg seat to seat: **the tab's stand-in, not the K24's stock events (not sourced)**; one
  300 mm runner per cylinder from the charge, no plenum; burn 18 deg BTDC over 55 deg, AFR 12 (the Intake tab's), ETA_C 0.975;
- charge: boost 169.918 kPa (24.64 psi; the audit's 450 hp case: the tab's airflow per compressor set to Garrett's
  Wa = HP x 12 x 0.55 / 60), throttle-inlet 271.243 kPa absolute, intercooler outlet 63.4 °C (the route at the tab's 75 %
  intercooler, 70 % compressor efficiency);
- manifold: the Turbo manifold section, tubular, ports 93 mm apart (the audit's typed example; not a cited K-series
  spacing): four runners 44.32 mm x 193.9 mm (the shortest equal length), a 20 deg merge cone to the 58.46 mm collector
  (the T3 flange port's equivalent bore), 152.4 mm to the flange; wall 794 °C (the section's steel temperature);
- turbine: Precision GEN2 PT5862, 0.63 A/R T3 housing (picked; the A/R enters only through the area found), efficiency 75 %
  (blank on the tab), external wastegate to the air, downpipe 72.9 mm x 610 mm (Exhaust after the turbine), no back pressure
  after it (none entered: cats and mufflers not counted); speeds 3500 (the tab's full-boost RPM) to 7100 rpm;
- brake = net IMEP (the turbo's pumping loop included) - Heywood's tfmep (B4); "gross basis" = gross IMEP - tfmep (as the
  plain wave simulation reads brake); Heywood's motored friction holds an NA wide-open pumping loop, so the first counts
  pumping twice and the second ignores the turbo's back pressure.

| RPM | brake torque N m (lb-ft) | brake hp | gross basis hp | same pipes, no boost, brake hp | p3 mean kPa abs (x boost, gauge) | p3 peak (x boost) | p3 / p2 | pumping mep kPa | residual | VE on the charge | T3 / T4 °C | gate share: run / algebra at the run's p3, T3 / page at 2 x boost | turbine / gate area mm2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 3500 | 626 (462) | 308 | 301 | 99 | 170.3 (0.41) | 240.1 (0.82) | 0.628 | -70.0 | 2.3 % | 1.013 | 940 / 836 | 0.0 / 0.0 / 58.3 % | 1185 / 0 |
| 4000 | 651 (480) | 366 | 362 | 121 | 182.0 (0.48) | 253.2 (0.89) | 0.671 | -32.7 | 2.2 % | 1.066 | 955 / 839 | 9.6 / 0.3 / 58.3 % | 1185 / 125 |
| 4550 | 678 (500) | 433 | 436 | 151 | 195.7 (0.56) | 271.8 (1.00) | 0.722 | 19.5 | 2.1 % | 1.129 | 970 / 842 | 18.4 / 11.9 / 58.3 % | 1185 / 267 |
| 5050 | 686 (506) | 486 | 496 | 177 | 206.9 (0.62) | 282.6 (1.07) | 0.763 | 70.3 | 2.1 % | 1.161 | 983 / 847 | 24.0 / 18.9 / 58.3 % | 1185 / 375 |
| 5550 | 687 (507) | 535 | 553 | 191 | 218.6 (0.69) | 290.3 (1.11) | 0.806 | 117.9 | 2.2 % | 1.183 | 994 / 849 | 28.3 / 24.6 / 58.3 % | 1185 / 469 |
| 6050 | 670 (494) | 569 | 598 | 198 | 228.5 (0.75) | 292.8 (1.13) | 0.842 | 179.5 | 2.2 % | 1.184 | 1006 / 855 | 31.6 / 28.8 / 58.3 % | 1185 / 548 |
| 6600 | 616 (455) | **571** | 608 | 195 | 232.2 (0.77) | 285.7 (1.09) | 0.856 | 212.2 | 2.4 % | 1.122 | 1013 / 859 | 33.0 / 30.6 / 58.3 % | 1185 / 583 |
| 7100 | 571 (421) | 569 | 617 | 186 | 234.5 (0.78) | 279.5 (1.05) | 0.864 | 256.0 | 2.8 % | 1.075 | 1022 / 864 | 34.6 / 32.3 / 58.3 % | 1185 / 627 |

(Pumping mep: gross minus net IMEP, positive a loss. T4: the turbine's own flow (the external gate's leaves at T3); the
Intake tab's mixed t4 at its assumed 950 °C TIT is 845 °C. Turbine / compressor power 0.996-1.001 at every speed.)

Read, as the model's prediction and no more:
- Peak brake power 571 hp at 6600 rpm (608 hp on the gross basis), torque 687 N m (507 lb-ft) at 5550 rpm, at the boost the
  page sizes for 450 hp: the model's air at 6600 rpm is 0.408 kg/s (53.9 lb/min) where Garrett's method takes 49.5 lb/min
  for 450 hp, and its fuel per hp is 0.47 lb/hp h where that method assumes 0.55. On the three NA V8 ratings the model reads
  brake torque +4 to +16 % high (C4); the same pipes without boost give 198 hp at 6050 rpm and 250 N m (184 lb-ft) at
  5050 rpm here, against the K24A2's 200 hp @ 6800 and 166 lb-ft @ 4500 (with the stand-in cam, not a validation).
- The turbine-inlet pressure is far below the page's assumed 2 x boost and Bell's 2-2.5 x: its mean is 0.41-0.78 x boost
  gauge (p3 / p2 0.63-0.86 absolute), its blowdown peak 0.82-1.13 x; with eta 0.65 the mean at peak power is 0.96 x (below).
  So the pumping loop is a gain at 3500-4000 rpm (p3 under p2 through the exhaust stroke) and a loss above, rising to 2.6 bar
  at 7100 rpm, where the valves (lifts 9.1 / 8.4 mm, the tab's estimate) restrict the boosted flow. The model's exhaust is
  known to run hot (A6: 78-150 K above OpenWAM at the port; here T3 940-1022 °C), which raises the turbine's energy per kg
  and so lowers the p3 it needs.
- The gate's share: 0-35 % in the run, 0-32 % from the algebra at the run's own mean p3 and T3 (the 2-3 points between are
  the pulsating flow: in the steady limit they agree to 0.04 points, E3), and 58 % from the algebra at the page's assumed
  2 x boost and 950 °C. The page's assumption overstates the gate's share for this build.
- The full-boost RPM's effective area, 1185 mm2 (1.84 in2), is the model's result for a 75 % turbine at 1022-940 °C; it is
  not the 0.63 A/R housing's measured flow (none is published).

One change at a time (`turbo_k24.js`):

| case | peak brake hp @ rpm | peak torque N m @ rpm | p3 mean x boost at peak hp | gate share at peak hp | T3 / T4 °C at peak hp |
|---|---|---|---|---|---|
| as the page runs it | 571 @ 6600 | 687 @ 5550 | 0.77 | 33.0 % | 1013 / 859 |
| turbine efficiency 0.65 | 565 @ 6600 | 680 @ 5050 | 0.96 | 33.1 % | 1013 / 858 |
| turbine efficiency 0.70 | 569 @ 6600 | 684 @ 5550 | 0.85 | 33.0 % | 1013 / 858 |
| internal gate (into the downpipe) | 571 @ 6600 | 686 @ 5550 | 0.78 | 32.5 % | 1013 / 910 |
| 2 psi back pressure after the turbine | 565 @ 6600 | 680 @ 5550 | 0.95 | 33.8 % | 1013 / 856 |
| AFR 11.5 | 566 @ 6600 | 681 @ 5550 | 0.78 | 33.1 % | 987 / 832 |

The power hardly depends on the turbine efficiency (the closure moves p3 instead: a less efficient turbine needs a higher
inlet pressure for the same work), so p3 is the number the efficiency input sets.

Sound after the turbine (the model's result; not validated): the firing orders at 1 m from the downpipe's end (monopole of
its mass flow, as the Sound tab), before cats and mufflers, against (a) the same pipes at the same boost with no turbine
(the collector running on into the downpipe: the turbine's own effect at the same flow) and (b) the engine without boost:

| rpm | order 2: level, (a), (b) dB | order 4 | order 6 | order 8 |
|---|---|---|---|---|
| 3500 | 110.1, -12.6, -11.3 | 112.4, -11.7, -9.4 | 92.9, -32.3, -22.8 | 98.5, -27.2, -14.7 |
| 4550 | 113.3, -6.8, -6.8 | 110.2, -8.8, -13.2 | 102.0, -12.1, -19.5 | 102.3, -7.0, -17.4 |
| 5550 | 116.2, -1.2, -1.0 | 109.1, -6.3, -6.4 | 104.3, -6.4, -10.7 | 105.7, +4.7, -10.6 |
| 6600 | 117.9, +1.8, +4.2 | 109.3, -5.9, +3.5 | 107.2, -2.7, +12.9 | 98.7, -5.7, +1.1 |
| 7100 | 117.9, +2.4, +5.6 | 107.4, -7.7, +3.8 | 107.5, -0.7, +14.1 | 102.9, +1.0, +19.7 |

With the gate shut (3500 rpm) the turbine takes 12 dB off the firing order and 27-32 dB off orders 6 and 8 against the same
flow without it; as the gate opens the attenuation falls (an external gate takes a third of the flow out of the downpipe,
whose own sound, the gate's dump, is not counted). With an internal gate the firing order at 6600 rpm is within 0.1 dB of
no turbine (`turbo_k24.json`, `gatedown`). Against the engine without boost (b) the turbo is quieter at low speed and
louder at high speed; at every speed it flows 2.5-2.7 times the air.

### E8 What changed on the page; tests; pinned values; run time

- Model: `wsFactory` (`sourceOf`, `turbineOf`, `setTurbine`, `isenRatio`, `isenT`, `turbineFace`, per-cycle sums `turbAcc` /
  `turbSum`; `makePipe` fill pressure) and `rust/et_wave` line for line (`Bnd::OpenAt`, `Src::Turb`, `turbine_face`,
  `turb_sum`; exports `wave_turbo_set`, `wave_turbo_out`, `wave_turbo_len`); the WebAssembly rebuilt and embedded.
- Page: `turboSimLib` (back ends and closure), "Wave simulation with the turbo" (or "with the supercharger") on the 4-Stroke
  tab when the Intake tab's induction is turbo or centrifugal: what the run takes and from where (11 rows), the button, the
  torque chart (under boost brake and indicated, without boost brake), a table per speed in both unit systems, peak power,
  the pressure before the turbine against the assumed multiple, the area, the gate against the algebra, the tail orders,
  the pressure before the turbine over a cycle, the method and its limits; two Intake inputs (turbine and gate effective
  areas, blank = found); the Turbo manifold section gives the blowdown peak "from the wave simulation" when a run with its
  manifold exists (and its old sentence otherwise); "Turbo build, step by step" gains "Simulated under boost" when a run
  exists, marked out of date when the boost inputs change.
- Tests: `web/tests/waveturbo_ui.js` (new, Node, 16 checks), `web/tests/turbosim_ui.js` (new, Playwright, 20 checks;
  CAPTURE=1 writes the K24 plan), `web/tests/wave_wasm.js` (four jobs added and the turbine summary compared; nothing
  removed or loosened). Scripts: `tools/validation/wave/turbo_k24.js`.
- Pinned values changed: none.
- Suite (`python3 tools/run_all_tests.py -j 2 --no-build --suite rust,web,fusion,parity`, 2026-11-13, part 5; cargo_test_rust
  (the et_host/et_app workspace, untouched here) left out because its build needs about 1.2 GB of a 1.6 GB free disk):
  162 tests, 153 passed, 0 flaky, 0 failed, 9 skipped and 7 partial skips, all expected, 1944 s. wave_wasm and
  wave_wasm_built (every speed, the turbo jobs included), cargo_test_et_wave, waveturbo_ui, turbosim_ui, wavegas_ui,
  wavekat_ui, the boost and turbo page tests passed.
- Run time: the K24 build's run on the page (8 speeds with the closure, then 8 without boost and 8 with the boost and no
  turbine; WebAssembly in a worker) about 20 s on this machine; the JavaScript back end (the page's fallback) takes 1.2-1.4 times as long (scratch timing and wave_wasm.js).

### E9 Not modelled

Knock, mixture enrichment for cooling and ignition retard under boost: the power figures assume the engine can run the
modelled burn (18 deg BTDC, 55 deg, the Intake tab's AFR) at this boost. The compressor's map, surge, the turbo's speed and
inertia, spool-up and transients (steady full-load points). The turbine's map: its effective area and efficiency are
constant over the cycle and across speeds (Payri et al. vary both), and the two-nozzle stator/rotor form is not used. Heat
lost in the turbine housing. Work of a turbine flowing backwards. Interaction of a divided housing's entries at the wheel.
The external gate's own discharge noise.

### E10 Summary rows (section 6, as of 2026-11-13, part 5)

| Difference | Status | Evidence |
|---|---|---|
| Naturally aspirated only | boosted charge, turbine (equivalent nozzle, exact isentrope), wastegate, divided entries added; NA unchanged bit for bit | E1, E5 |
| Turbine flow area unknown | found by the model from the Intake tab's power balance; p3 an output | E2 |
| Known answers | nozzle flow to 1e-6, work and outlet temperature to 1e-6, the algebra's steady limit to 0.04 points of gate share, mass and energy to 1e-14 | E3 |
| OpenWAM's turbine | not compared: needs a shaft, a compressor map or speed, and blocks the writer lacks | E6 |
| A rated turbocharged engine | none buildable from sourced data; the K24 build is a prediction | E7 |
| Pressure before the turbine | the K24 run gives 0.4-0.8 x boost mean (1.0-1.1 x peak) at 75 % against the page's assumed 2 x | E7 |

### E11 How to rerun (additions)

```
node web/tests/waveturbo_ui.js                         # known answers of the new elements, ~40 s
QUICK=1 node web/tests/wave_wasm.js                    # JS / Rust / WebAssembly incl. the turbo jobs (from web/)
cd web && CAPTURE=1 node tests/turbosim_ui.js          # the page's run of the K24 build, writes results/turbo_k24_page.json
node tools/validation/wave/turbo_k24.js                # reproduce it in Node and the one-change runs, ~3 min
```

## Addendum 2026-11-13, part 6: independent audit of the turbocharged simulation (part 5)

Scope: everything part 5 merged: `intake.source`, `exhaust.turbine` (`turbineFace`, `isenT`, the fed end into the
downpipe, the wastegate), the closure (`turboSimLib.closure`), "Wave simulation with the turbo" on the 4-Stroke tab and
how it reads the Intake tab (`tsimPlan`, `calcTurboRoute`, `turbineBalance`), the tests and `turbo_k24.js`. Method: every
reference value is recomputed by this audit's own code from the source equations, not ported from the page:
`tools/validation/wave/turbo_audit.py` (Python: brentq root finding on the arriving characteristic, scipy quadrature of
cp(T)/T for the thermally perfect gas's isentrope and enthalpy, NASA Glenn's nozzle equation, a linearised compact-nozzle
acoustic model) reading what the page's model gives on rigs chosen for the audit (`turbo_audit.js` ->
`results/turbo_audit_sim.json`, `results/turbo_audit.json`); `turbo_sens.js` for the sensitivity and the calibration
(`results/turbo_sens_grid.json`, `turbo_sens_tol.json`, `turbo_sens_calib.json`, `turbo_sens_page.json`). Equations:
NASA Glenn Beginner's Guide, "Mass flow choking" and "Isentropic flow" (mdot = A pt / sqrt(Tt) sqrt(g/R) M (1 + (g-1)/2
M^2)^(-(g+1)/(2(g-1))), choked at M = 1); ds = cp(T) dT / T - R dp / p; the turbine's total-to-static isentropic drop
h(T0) - h(T_is) at the outlet's static pressure; Benson's characteristic at an end; Marble and Candel (J. Sound Vib. 55
(1977) 225-243) for the choked compact nozzle's reflection (1 - (g-1)M/2) / (1 + (g-1)M/2), which the linear model
reproduces to 4 digits as its own check. Verdicts as in the boost audit: CORRECT, FIXED, LIMITATION, UNSOURCED. Every fix
has a check in `web/tests/turboaudit_ui.js` (new) or `web/tests/turbosim_ui.js` (edited) that fails on the code before and
passes after (run against the merge commit 3380685: 5 of the 16 new checks fail there, the rest pass).

### F1 The nozzle, the work, the gas after the turbine, flow back, the bookkeeping: CORRECT

Five single-cell face states (burned gas of a 12:1 engine, frozen gamma of the cell), re-derived by brentq:

| state | m model kg/s | m re-derived | face p kPa | dm, dp | work W, dW | frozen-gamma nozzle vs exact variable-cp nozzle |
|---|---|---|---|---|---|---|
| unchoked (150 kPa, 1100 K, 60 m/s, 8 cm2 to 110 kPa) | 0.113758 | 0.113758 | 138.923 | 9e-13, -2e-13 | 6670.89, 2e-13 | -0.036 % |
| choked nozzle (260 kPa, 1050 K, 80 m/s to 105 kPa) | 0.237983 | 0.237983 | 243.287 | 1e-12, -3e-13 | 43159.35, 7e-13 | -0.186 % |
| pipe end choked (40 cm2 on a 50 mm pipe) | 0.460720 | 0.460720 | 101.073 | 2e-16 | 50626.07, 3e-15 | +0.003 % |
| nozzle 6 cm2 + external gate 3 cm2 | 0.142610 | 0.142610 | 155.978 | -2e-13, 4e-14 (split -1e-13) | 3787.75, 4e-14 | -0.067 % |
| flow back from the downpipe (140 kPa behind) | -0.111514 | -0.111514 | 128.292 | 1e-12, 2e-13 | 0 | - |

The critical ratio and psi use the end cell's own frozen gamma (CORRECT); against an exact variable-cp nozzle from the same
face state the frozen-gamma law reads at most 0.19 % low (choked), a stated simplification of no consequence. The work is
the exact variable-cp isentrope (the quadrature agrees to 1e-12); the face's static state and its total state lie on one
isentrope, so taking T_is from (T_b, p_b) is the total-to-static drop exactly. The downpipe's stagnation enthalpy
(m h0 - W): the steady rig through a real downpipe (internal gate) balances reservoir enthalpy in = downpipe out + work to
2.8e-15, mass to 1.3e-14. Mass and total energy on the audit's own engine case (four cylinders on two collectors into a
divided turbine, the gate dumping to the air, 6200 rpm): residuals 4.0e-15 and 1.1e-15 of the heat released, gate dump
included (`turboaudit_ui.js`). Flow back is a no-work orifice from the downpipe's first cell through the turbine (and an
internal gate): reproduced to 1e-12; that a reversed turbine does no work is a stated LIMITATION, and so is one corner:
with an external gate, a downpipe above the collector's stalled pressure and the collector above the atmosphere, the
face takes the forward branch (the gate dumps) and the turbine's back flow is not admitted (rare; not seen in the K24 run,
whose reverse-flow counter is 0 at every speed).

### F2 The face solve against closed forms and its convergence: CORRECT (one LIMITATION at a sonic face)

Steady rig (inviscid adiabatic 0.6 m x 50 mm pipe from a reservoir, the nozzle at a fixed outlet pressure):

| case | m model | m closed form | dm | face p model kPa | closed form | dp | work per kg vs eta dh_is |
|---|---|---|---|---|---|---|---|
| unchoked, constant gas (150 kPa, 1000 K, 10 cm2, 120 kPa) | 0.156286 | 0.156286 | -0.000 % | 143.640 | 143.640 | 0.000 % | -0.000 % |
| choked nozzle, constant gas (300 kPa, 8 cm2, 110 kPa) | 0.302908 | 0.302908 | -0.000 % | 288.091 | 288.091 | -0.000 % | -0.000 % |
| pipe end choked, constant gas (30 cm2 on 19.6 cm2) | 0.743416 | 0.743447 | -0.004 % | 160.077 | 161.055 | -0.61 % | -0.002 % |
| unchoked, engine gas (exact variable cp reference) | 0.152563 | 0.152586 | -0.015 % | 143.687 | 143.685 | +0.001 % | -0.000 % |
| choked nozzle, engine gas, 1100 K | 0.279216 | 0.279601 | -0.138 % | 288.415 | 288.382 | +0.012 % | -0.000 % |
| pipe end choked, engine gas | 0.685772 | 0.686244 | -0.069 % | 162.226 | 163.284 | -0.65 % | -0.054 % |

(Against the frozen-gamma NASA law at the reservoir's gamma the engine-gas mass flows agree to +0.007 to +0.086 %.) The
sonic face's pressure is 0.6 % low where the whole pipe runs sonic (the scheme's known first-order error at a sonic point;
the mass flow is right to 0.004 %): LIMITATION, irrelevant to the engine (no pipe runs sonic end to end).

Pulsating rig (reservoir 220 kPa +- 35 % at 150 Hz, 1 m pipe, 8 cm2, choked through part of the cycle, downpipe to the
atmosphere; frictionless): grid dx 40/20/10/5/2.5 mm at CFL 0.8, and the time step halved twice at dx 10 mm:

| quantity (engine gas) | dx 40 | 20 | 10 | 5 | 2.5 mm | observed order | dt halved (10 mm): change |
|---|---|---|---|---|---|---|---|
| mean mass flow kg/s | 0.206879 | 0.206493 | 0.206504 | 0.206499 | 0.206502 | (converged to 1e-5) | 2.2e-4, 2.2e-4 |
| mean turbine work W | 44346 | 44581 | 44702 | 44748 | 44768 | 0.95, 1.41, 1.20 | 1.1e-4, 1.4e-4 |
| face pressure, 1st harmonic Pa | 151365 | 151761 | 152044 | 152084 | 152088 | 0.5, 2.8, 3.4 | 2.4e-4, 6e-5 |
| peak face total pressure Pa | 389357 | 390073 | 390443 | 390642 | 390766 | 0.95, 0.89, 0.68 | 2.3e-4, 1.1e-4 |

(Constant gas alike: work orders 1.2-1.6, peak 0.8-0.95.) At the engine's 10-12.5 mm cells the mean work is about 0.15 %
and the peak pressure about 0.1-0.3 % below the fine-grid values; the time step (fixed CFL 0.8) contributes 1-2e-4. First
order at peaks and in the work (the limiter clips extrema), as the solver's other boundaries: CORRECT for its purpose.

### F3 The closure: CORRECT

Cycle-averaged turbine power = compressor power is the steady balance `turbineBalance` uses, and the efficiency is applied
the same way in both (W = eta x the isentropic power; `turbineBalance` labels eta "thermo-mechanical", and a map's turbine
efficiency is "turbine efficiency times turbocharger mechanical efficiency", Le Guyader et al., HEFAT 2008,
core.ac.uk/download/80903955.pdf). Units: W from J per cycle / cycle time; Wc = the air drawn by the simulated cylinders
(kg/s, the mouths' net face flux, the fuel added at the port excluded as the compressor sees air only) x 1004.7 J/kg K x
(T2 - T1) of the route. Per turbo: the simulated cylinders are one turbo's manifold (`mfdLayout` mf[0]: all cylinders for
one turbo, one bank or every second cylinder for twins), and both the turbine's work and the compressor's air come from
those cylinders, so the balance is per turbo; a divided housing sums its two entries on one wheel. Tolerance: rerunning
the K24 case at 0.1 % instead of 0.5 % moves the area by 0.000 % (the first secant step already lands inside), the brake
power by at most 0.074 %, p3 by 0.16 %, the gate share by 0.13 points: insensitive. The page now says the efficiency is
turbine x mechanical (cycle-averaged).

### F4 The key judgement: the turbine's size is the typed full-boost RPM and efficiency, not the turbo: LIMITATION, page FIXED (UNSOURCED default)

The closure finds the turbine's effective area that gives exactly full boost at the full-boost RPM with the gate shut, at
the typed efficiency (75 % when blank), in the model's (hot) exhaust; at faster speeds that area is held and the gate opens.
So the area is the LARGEST turbine that still makes full boost there, and the pressure before it the lowest consistent with
that; it says nothing about the PT5862's own housing. The K24A2 + PT5862 case of part 5 rerun with the full-boost RPM and
the efficiency changed (`turbo_sens.js`, the page's WebAssembly and closure; the speeds: the full-boost RPM, then the page's
own speeds above it; brake on part 5's net - tfmep basis so the rows compare with E7):

| eta | full-boost rpm | turbine area mm2 (in2) | p3 mean x boost at full-boost rpm | at 6600: p3 mean x boost | p3 peak x | gate share | pumping mep kPa | brake hp | peak brake hp @ rpm |
|---|---|---|---|---|---|---|---|---|---|
| 0.55 | 3000 | 734 (1.14) | 0.66 | 1.40 | 1.74 | 37.3 % | 254 | 541 | 544 @ 6050 |
| 0.55 | 3500 | 881 (1.37) | 0.67 | 1.23 | 1.52 | 32.0 % | 237 | 551 | 552 @ 6050 |
| 0.55 | 4000 | 1077 (1.67) | 0.66 | 1.06 | 1.34 | 25.3 % | 224 | 560 | 560 @ 6600 |
| 0.55 | 4500 | 1275 (1.98) | 0.67 | 0.93 | 1.23 | 18.8 % | 217 | 566 | 566 @ 6600 |
| 0.55 | 5000 | 1434 (2.22) | 0.70 | 0.85 | 1.16 | 13.7 % | 214 | 569 | 569 @ 6600 |
| 0.65 | 3000 | 862 (1.34) | 0.50 | 1.10 | 1.38 | 38.7 % | 226 | 558 | 558 @ 6600 |
| 0.65 | 3500 | 1032 (1.60) | 0.51 | 0.96 | 1.26 | 33.1 % | 218 | 565 | 565 @ 6600 |
| 0.65 | 4000 | 1251 (1.94) | 0.51 | 0.83 | 1.14 | 26.1 % | 213 | 569 | 569 @ 6600 |
| 0.65 | 4500 | 1456 (2.26) | 0.53 | 0.74 | 1.05 | 19.7 % | 212 | 572 | 572 @ 6600 |
| 0.65 | 5000 | 1625 (2.52) | 0.56 | 0.68 | 0.99 | 14.5 % | 212 | 573 | 573 @ 6600 |
| 0.75 | 3000 | 1008 (1.56) | 0.39 | 0.87 | 1.18 | 38.6 % | 214 | 568 | 568 @ 6600 |
| **0.75** | **3500** | **1185 (1.84)** | **0.41** | **0.77** | **1.09** | **33.0 %** | **212** | **571** | **571 @ 6600** (part 5) |
| 0.75 | 4000 | 1415 (2.19) | 0.42 | 0.67 | 0.99 | 25.9 % | 212 | 573 | 573 @ 6600 |
| 0.75 | 4500 | 1622 (2.51) | 0.44 | 0.61 | 0.91 | 19.6 % | 212 | 574 | 574 @ 6600 |
| 0.75 | 5000 | 1789 (2.77) | 0.47 | 0.56 | 0.86 | 14.7 % | 212 | 574 | 574 @ 6600 |

Read: the area spans 734-1789 mm2 (x 2.4) and the mean pressure before the turbine at 6600 rpm 0.56-1.40 x boost (x 2.5)
over inputs nobody can type with confidence, while the brake power moves 541-574 hp (6 %) and the gate's share at 6600 rpm
is set by the full-boost RPM (14-39 %) and hardly by the efficiency. The pressure before the turbine is the number these
inputs set; the power is not. (The static mean, what a pressure tap reads, is lower again: 0.62 x at 6600 rpm in the base
case against the total 0.77 x; the page now gives both.)

Plausibility against published data (read 2026-11-13):
- Logged pre-turbine against intake pressure, gauge: a Honda 1.5 L with a drop-in turbo at 36.2 psi boost, 68.1 psi before
  the turbine with the gate shut (ratio 1.88), 58.2 psi at 35.2 psi with it slightly open (1.65) (PRL Motorsports,
  prlmotorsports.com/blogs/news/pushing-the-limits-prl-1-5t-drop-in-turbo-max-effort-testing); a 1.5 L GDI, 41 psi in the
  turbine scroll at 21.5 psi boost at 5651 rpm (1.9); a 5.0 L V8 with one GTX3582R Gen 2, 270 kPa against 170 kPa at
  4500 rpm (reference not stated: 1.6 if gauge) (HP Academy forum, hpacademy.com/forum/boost-control/show/turbocharger-
  exhaust-back-pressure-values-what-is-a-good-to-see); factory turbo engines about 2 x, dedicated drag engines below 1 x
  (HP Academy, hpacademy.com/blog/emap-exhaust-pressure-and-turbochargers, no numbers logged); "the exhaust manifold
  pressure is one bar higher than the intake manifold pressure" for a street car (MotoIQ, motoiq.com/turbo-tech-
  compressor-and-turbine-map-details). No measured figure for a PT5862 or a ~60 mm wheel on a 2.4 L was found. The model's
  0.77 x (total, 0.62 x static) at peak power is below every logged street figure; only the race-turbine regime is as low.
- Turbine efficiency on an engine: no source read gives a number. Westin and Angstrom (SAE 2005-01-3812, abstract): the
  on-engine efficiency, from measured and simulated data, "gave lower values for the first, most energetic, part of the
  exhaust pulse" than the steady-rig-calibrated models; SwRI (2018 internal research, swri.org, "Characterization of high
  pulse energy turbochargers"): turbocharger performance on the engine "much better than the cycle simulations had
  predicted"; Deng et al. (Proc. IMechE D 2020, core.ac.uk/download/334409971.pdf) cite Kosuge et al.: under the
  quasi-steady assumption "averaged mass flow and power are under-estimated"; Yang, Martinez-Botas et al. (Energy Convers.
  Manag. 105 (2015) 167-177): turbine behaviour under pulsating flow "deviates from its equivalent steady performance";
  Marelli and Capobianco (Energy 36 (2011) 459-465) compare steady and pulsating efficiency (numbers not readable without
  the paper). So the sign of the on-engine departure is not settled and no on-engine value can be cited: the 75 % default
  stays UNSOURCED and is now shown with its sensitivity, not lowered to an unsourced 65 %.
- The effective area against a published flow figure: none comparable. The page's one text figure, Garrett G40-1150's
  43 lb/min for the 1.19 A/R T4, has no reference state and is a larger turbine; no turbine flow parameter for a ~60 mm
  wheel was found in open literature. The page now gives the found area also as a choked flow parameter, A sqrt(g/R)
  (2/(g+1))^((g+1)/(2(g-1))) at g 1.3 (1185 mm2 -> 4.67 kg/s sqrt(K)/bar), so an owner with a turbine map can compare.
- The calibration's own verdict on the model (`turbo_sens.js calib`): if the K24 build were measured at 1.0 / 1.5 / 2.0 x
  boost (static mean) at 3500 rpm with the gate shut, the area would be 664 / 486 / 381 mm2 and the turbine x mechanical
  efficiency that balances the compressor 0.42 / 0.34 / 0.30. A real turbine is not that poor; so where the model's p3 is
  low against logs, the model's exhaust carries more usable energy than a real one (its exhaust runs 78-150 K hot at the
  port, A6; no heat is lost in the turbine housing; a quasi-steady turbine uses every pulse at the full efficiency) as well
  as the efficiency being optimistic. That is the honest reading: the run's p3 is a lower bound, not a forecast.

What the page now does (`tsimSection`, `tsimRun`, `turboSimLib.calibrate`):
- "Turbine effective area" reads "what the turbine would have to be to give full boost at <the full-boost RPM> with the
  gate shut at <eta> efficiency ... the largest turbine that still makes full boost there (a turbine that reaches it earlier
  is smaller and runs a higher pressure before it); not the housing's measured flow", with the choked flow parameter.
- "How much rests on the typed numbers": the run adds two closures at the speed of peak power, 10 points less efficient and
  full boost 1000 RPM later (the area found again each time; about 50 % more run time, 31 s for the K24 build): K24 at
  65 %: 1034 mm2, 0.96 x boost mean (1.26 x peak), gate 33 %, 581 hp; full boost at 4500: 1620 mm2, 0.61 x, gate 20 %,
  590 hp; with the sources above for why the efficiency is uncertain.
- "Pressure before the turbine": total and static means; that it is the consequence of the typed full-boost RPM, the
  efficiency and the model's hot exhaust, not of the turbo picked; the logged street figures (1.6-1.9 x, factory about 2 x,
  below 1 x only on very large race turbines) against which a low figure means optimistic inputs; which to trust for what
  (a measurement over both; the Intake tab's multiple for the A/R and gate choices its algebra is written for; this run for
  the pulse's shape and its trend with speed).
- Calibration to a measured pressure (Intake tab `i-p3m`, gauge, no typed area): `turboSimLib.calibrate` finds, at the
  full-boost RPM with the gate shut, the area that gives the measured time-mean STATIC pressure at the turbine's face and
  the efficiency that then balances the compressor (eta_new = eta Wc / W, the flow depending on eta only through the gas
  after the turbine; the area searched again until eta changes by less than 0.5 %; above 100 % it is held at 100 % and
  the page says the measurement or the model's exhaust is off); the closure then holds both and finds the gate. A small
  extension of the driver only (page JavaScript, used with either back end): the solver, the Rust and the WebAssembly are
  unchanged, so parity holds by construction. Test: a run at a known 0.62 efficiency gives a static p3; calibrating to it
  from 0.75 returns 0.6202 and the area to 0.06 % (`turboaudit_ui.js`); the run with a measured 60 kPa calibrates and
  holds the area (same file); the page's plan carries the target (`turbosim_ui.js`).

### F5 The boosted intake source: CORRECT (one LIMITATION)

p = the route's `Pt` (boost + atmosphere at the throttle, downstream of the route's throttle step, whose loss the route
adds upstream), T = its intercooler outlet; the 4-Stroke tab's plenum filter is deleted (the filter is upstream of the
compressor, in the route's inlet loss) and `fdp` is 0. With open runners (the K24 case) nothing is counted twice. With the
4-Stroke tab's plenum, its inlet tube (`itl`, `itd`) and throttle stay in the line from the source: the throttle's
contraction is isentropic in the model (no second loss) and the expansion into the plenum is downstream of `Pt` (not in
the route), so only the inlet tube's friction is counted twice, about 0.1 kPa at 0.4 kg/s in a 76 mm tube of 300 mm
(4 f L / D x rho v^2 / 2, f 0.005, rho 2.8 kg/m3, v 31 m/s): negligible. The charge side's acoustics (the charge pipe and
the intercooler's volume) are not represented, the NA inlet tube standing in: LIMITATION (stated on the page as "the
compressor is a boundary"). Fuel: `e` is the 4-Stroke tab's with the Intake tab's AFR; the port injector, the vapour and
the burned-gas treatment are untouched (`portFuel`, `makeGas(afr, vap)`); `turboaudit_ui.js`'s conservation check covers it.

### F6 Brake power under boost: FIXED

Part 5 read brake as net IMEP - tfmep (Heywood's motored total friction) and showed gross - tfmep beside it, saying "the
truth is between". Heywood's tfmep was measured motored at wide-open throttle, so it contains an NA pumping loop; the NA
path therefore takes it off the gross loop. Under boost: net - tfmep counts that NA loop twice; gross - tfmep ignores the
turbo's own loop; and "between" is false wherever the turbo's pumping is a gain (3500-4000 rpm in the K24 run, pumping
mep -70 and -33 kPa: the consistent value is then above both). The consistent reading, now the page's brake: net IMEP -
(tfmep - the NA pumping mep of the same engine and pipes, from the run beside it). On an engine without boost this is
exactly gross - tfmep (an identity; `turboaudit_ui.js` checks it to 1e-9, and that the page's number is the hand value
for a mock run). The NA run's firing pumping loop stands in for Heywood's motored one (LIMITATION, stated).
K24A2 + PT5862, before / after (`turbo_sens.js page`): peak brake 571 hp @ 6600 (net - tfmep) / **589 hp @ 7100**
(587 hp at 6600; the NA pumping mep is 13-110 kPa over 3500-7100 rpm); gross - tfmep 617 hp @ 7100.

### F7 "Why 571 hp at a 450 hp boost": FIXED (explanation added)

The page now has "Against the Intake tab's <hp> hp": Garrett's airflow hp x AFR x BSFC / 60 (49.5 lb/min for 450 hp at
12 and 0.55) against the run's air at peak power (55.6 lb/min, 0.420 kg/s, at 7100 rpm; 53.9 at 6600) and its BSFC
(0.47 lb/hp h); the reasons: no knock limit, no enrichment beyond the typed AFR, no retard, the model reading brake torque
4-16 % high on the three NA ratings (part 3), and its VE on the charge against the tab's; plan on the target, read the run
as the ceiling of an engine that could hold this burn. (`turbosim_ui.js` checks the row.)

### F8 Parity and conservation on the audit's own jobs: CORRECT

JS against Rust (WebAssembly) through the closure over two speeds, every result and turbine double compared: a divided
turbine on two collectors with an internal gate (engine gas, AFR 12.3), 0 of 2930 differ; the constant gas with the gate to
the air, 0 of 1490. The solver, `et_wave` and the embedded WebAssembly are not changed by this part (`git diff 3380685` touches neither `wsFactory` nor
`WAVE_WASM_B64`), so the naturally aspirated results cannot move: kat.js rerun, 66 of 66 criteria, `results/kat.json`
byte-identical; wave_wasm (every job, the turbo jobs included) passed in the suite (F10); constref not rerun. Conservation: F1.

### F9 Sound after the turbine: the coupling CORRECT, the attenuation numbers LIMITATION (caveat strengthened)

A 0.2 % Gaussian pulse (0.4 ms) from the reservoir through 6 m of pipe, the nozzle (75 %), 8 m of downpipe, read as the
difference of two runs (with and without the pulse; constant gas), against the linearised compact nozzle (mass in = mass
through = mass into the downpipe, stagnation enthalpy less the work = the downpipe's, plane waves either side and an
entropy wave downstream; pulse areas, a closed end gives 1.000):

| case | reflected: model / linear | transmitted: model / linear |
|---|---|---|
| unchoked (140 kPa, 12 cm2, face M 0.35) | 0.4674 / 0.4403 (+6 %) | 0.3907 / 0.3857 (+1.3 %) |
| unchoked, no work | 0.4722 / 0.4619 (+2 %) | 0.4305 / 0.4250 (+1.3 %) |
| choked (260 kPa, 6 cm2, face M 0.19) | 0.9286 / 0.9385 (Marble-Candel 0.9385) (-1 %) | 0.1471 / 0.1480 (-0.6 %) |
| outlet pressure held | -0.0230 / -0.0249 | - |

So the element neither spuriously absorbs nor reflects: what it passes is within 1.3 % (0.1 dB) of the linear nozzle,
what it reflects within 6 % (0.5 dB; the work's coupling through the gas after the turbine is the largest difference,
not traced further). The attenuation part 5 reports (12 dB on the firing order, 27-32 dB on orders 6 and 8 with the gate
shut) is the quasi-steady equivalent nozzle's honestly; but a real turbine has a volute and wheel volume and does not
respond quasi-steadily at the higher orders (Deng et al. above: the quasi-steady assumption under-estimates averaged flow
and power as frequency rises), so the page now says the turbine is a compact quasi-steady nozzle with no volume and that
the difference is the nozzle's effect on the firing pulses, with this check's agreement.

### F10 What changed; tests; verification

- Page: `turboSimLib.calibrate` (and `WS` exported from the library for `tsimRun`); `tsimRun` (calibration when a measured
  pressure is entered and no area typed, the two sensitivity closures otherwise, efficiency read from the spec; progress
  labels); `tsimPlan` (`p3m`, its row, the efficiency row's wording); `tsimSummary` (brake as F6 with the two one-sided
  readings, static p3, BSFC and air at peak power, the sensitivity rows, the calibration, the run's efficiency in the
  algebra); `tsimSection` (the rows of F4, F6, F7 and the sound caveat of F9). Solver, Rust, WebAssembly: unchanged.
- Tests: `web/tests/turboaudit_ui.js` (new, Node, 16 checks, about 80 s; 5 fail on the merge commit); `web/tests/turbosim_ui.js`
  (4 checks added: the area's wording and the sensitivity, the pressure rows, the brake and target rows, the measured
  pressure reaching the plan); `tools/validation/wave/turbo_k24.js` reads brake as the page now does.
- Scripts and results: `tools/validation/wave/turbo_audit.js`, `turbo_audit.py`, `turbo_sens.js`; `results/turbo_audit*.json`,
  `turbo_sens_*.json`, `turbo_k24_page.json` and `turbo_k24.json` recaptured (`CAPTURE=1 node web/tests/turbosim_ui.js`).
- Pinned values changed: none in the solver's tests; E7's brake column is superseded by F6 (589 hp @ 7100 rpm).
- Suite (`python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`, 2026-11-13, part 6): 130 tests,
  123 passed, 0 flaky, 0 failed, 7 skipped, 7 partial skips, 0 unexpected, 1315 s (turboaudit_ui 84 s, turbosim_ui 41 s,
  waveturbo_ui, wave_wasm, wavekat_ui passed). `cargo test -p et_wave` not run (the solver is unchanged).

### F11 Not verified

No turbocharged engine with measured cam events, pre-turbine pressure and power could be built, so the whole run is still a
prediction; no on-engine turbine efficiency number could be read; no flow figure for the PT5862's housings exists; the
acoustic check is linear (small pulses) and of the model's own element, not of a real turbine; OpenWAM's turbine was not
run (E6 stands).

### F12 Summary rows (section 6, as of 2026-11-13, part 6)

| Difference | Status | Evidence |
|---|---|---|
| Nozzle, work, gas after the turbine, flow back | re-derived independently to 1e-12; frozen gamma within 0.19 % of the exact nozzle | F1 |
| Face solve | closed forms to 1e-6 (0.6 % in p at a fully sonic pipe); pulsating rig first order at peaks, 0.15 % at engine cells | F2 |
| Closure | right balance, efficiency consistent with turbineBalance, tolerance immaterial | F3 |
| Turbine area and p3 | set by the typed full-boost RPM and efficiency (area x 2.4, p3 x 2.5 over the grid); page says so, shows the sensitivity, calibrates to a measured p3; default efficiency unsourced | F4 |
| Brake under boost | net - (tfmep - NA pumping): 571 -> 589 hp for the K24 build | F6 |
| Tail sound after the turbine | coupling within 1.3 % (passed) and 6 % (reflected) of the linear nozzle; quasi-steady, no volume: caveat on the page | F9 |

### F13 How to rerun (additions)

```
node tools/validation/wave/turbo_audit.js && python3 tools/validation/wave/turbo_audit.py   # F1, F2, F9, ~1 min
node tools/validation/wave/turbo_sens.js            # F3, F4, F6 (ONLY=grid|tol|calib|page for one part), ~5 min
node web/tests/turboaudit_ui.js                     # the audit's checks, ~80 s
```

## Addendum 2026-11-13, part 7: the whole-engine energy balance, and heat loss in the exhaust port

Question. Parts 2-6 left three signs that the model's exhaust might carry too much energy: brake torque 4-16 % above three
GM V8 ratings (C4) with the closed cycle verified from first principles (D3); the exhaust-port gas 78-150 K hotter than
OpenWAM's (A6); and, in the turbo audit, a turbine that would need a turbine x mechanical efficiency of only 0.30-0.42 to
reproduce logged pre-turbine pressures (F4). Hypothesis tested here (not assumed): the model loses too little heat in the
exhaust port and during the gas exchange, so its exhaust enthalpy is too high and its coolant share too low. Method: the
whole-engine energy balance measured from the model, compared with the published balance; then the model's heat transfer
term by term against published laws; one piece changed (the head's exhaust port), with published constants and nothing
fitted; then every check rerun. Nothing was tuned to the ratings, to OpenWAM or to the turbo figures.

### G1 The energy balance, measured (`tools/validation/wave/energy_balance.js`, `results/energy_*.json`)

Over one whole engine cycle after the run has settled (ratings.js's settling, then two more cycles), as fractions of the
fuel's chemical energy (fuel inducted by the port injector x LHV 44 MJ/kg): brake (gross IMEP - Heywood's tfmep, the page's
brake), friction (net work - brake: tfmep less the model's own pumping loop, so the rows add up), the cylinder's wall heat by
phase, the wall heat in the port (the first `portL` of each primary from the valve), in the header and collector, in the
intake pipes (negative: into the charge), the sensible + kinetic enthalpy leaving the port and leaving the tail (datum
298.15 K, where the air and the fuel enter, so the intake brings none), and the chemical energy not released (fuel x LHV -
the heat released: the rich products' CO and H2, the 2.5 % of ETA_C, fresh charge short-circuited). Pipe heat is what each
cell's step actually added (read-only instrumentation in `lib.js`, the same expression evaluated again). The sensible-energy
balance closes to 3e-16 ... 1.4e-14 of the heat released at every point (including the storage change and the sensible
enthalpy of fuel pushed back into the intake, which the port injector takes out of the model: B6); the columns add to 100.0 %.

Engines: LS3 as ratings.js's realistic case (c_final: whole engine, plenum, throttle, measured head flow, long-tube 4-1 with
its 150 mm port at 44.5 mm, 700 K header wall, 650 K collector) at 3000, 4600 (rated torque) and 5800 rpm (near rated
power); K24A2 as the turbo plan's "same pipes, no boost" run (`results/turbo_k24_page.json` plan.na: the Turbo manifold from
the head flange at its 794 C wall, the 4-Stroke tab's stand-in cam, AFR 12) at 3500, 5550 and 7100 rpm; its plan has no
port, so a 100 mm port at the runner's bore was added for the port rows (an ASSUMPTION: the K24's port length is not
sourced). Percent of the fuel's chemical energy:

| engine, rpm | case | brake | friction (tfmep - own pumping) | cylinder wall: closed / EVO-TDC / TDC-IVC | port wall (valve open / shut) | header + collector wall | intake pipes | exhaust enthalpy leaving the port | ... leaving the tail | chemical energy left (rich CO, H2; ETA_C) | coolant-type sum (cylinder + port) | T port exit mass-avg / time-avg (K) | T tail mass-avg (K) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LS3 3000 | before (page before part 7) | 30.5 | 4.9 | 8.2 / 3.1 / -0.3 | 0.8 | 5.2 | -0.1 | 34.7 | 29.5 | 18.2 | 11.8 | 1217 / 1018 | 1090 |
| LS3 3000 | after (Caton-Heywood) | 30.5 | 4.9 | 8.2 / 3.1 / -0.3 | 2.4 (1.2 / 1.3) | 4.8 | -0.1 | 33.1 | 28.3 | 18.2 | 13.4 | 1179 / 949 | 1062 |
| LS3 3000 | Hires-Pochmara (upper bound) | 30.5 | 4.9 | 8.2 / 3.1 / -0.3 | 7.2 (4.9 / 2.4) | 3.5 | -0.1 | 28.3 | 24.8 | 18.2 | 18.1 | 1062 / 784 | 975 |
| LS3 4600 | before | 29.9 | 5.0 | 6.5 / 3.2 / -0.2 | 0.9 | 5.3 | -0.1 | 36.6 | 31.3 | 18.2 | 10.3 | 1264 / 1048 | 1136 |
| LS3 4600 | after (Caton-Heywood) | 29.9 | 5.0 | 6.5 / 3.2 / -0.2 | 2.1 (1.0 / 1.1) | 5.1 | -0.1 | 35.4 | 30.4 | 18.2 | 11.6 | 1235 / 984 | 1112 |
| LS3 4600 | Hires-Pochmara | 29.9 | 5.1 | 6.5 / 3.2 / -0.2 | 7.0 (4.7 / 2.3) | 3.8 | -0.1 | 30.5 | 26.6 | 18.2 | 16.5 | 1115 / 825 | 1020 |
| LS3 5800 | before | 28.5 | 5.7 | 5.8 / 3.4 / -0.2 | 0.9 | 5.4 | -0.1 | 37.9 | 32.4 | 18.2 | 9.9 | 1293 / 1083 | 1163 |
| LS3 5800 | after (Caton-Heywood) | 28.5 | 5.7 | 5.8 / 3.4 / -0.2 | 2.1 (1.0 / 1.1) | 5.2 | -0.1 | 36.7 | 31.5 | 18.2 | 11.1 | 1266 / 1022 | 1141 |
| LS3 5800 | Hires-Pochmara | 28.5 | 5.7 | 5.8 / 3.4 / -0.2 | 7.3 (4.7 / 2.6) | 4.0 | -0.1 | 31.5 | 27.5 | 18.2 | 16.3 | 1140 / 876 | 1041 |
| K24 3500 | page plan, no port (before) | 27.7 | 5.1 | 7.4 / 3.2 / -0.3 | - | -0.8 | -0.1 | 31.7 (at the valve) | 32.6 | 25.2 | 10.3 | 1187 / 986 (at the valve) | 1209 |
| K24 3500 | 100 mm port, law off | 27.8 | 5.0 | 7.3 / 3.2 / -0.3 | 0.1 | -0.2 | -0.1 | 31.7 | 32.0 | 25.2 | 10.4 | 1187 / 1026 | 1193 |
| K24 3500 | 100 mm port, Caton-Heywood | 27.8 | 5.0 | 7.3 / 3.2 / -0.3 | 1.5 (0.7 / 0.8) | -0.5 | -0.1 | 30.3 | 30.8 | 25.2 | 11.8 | 1151 / 958 | 1164 |
| K24 3500 | 100 mm port, Hires-Pochmara | 27.9 | 5.0 | 7.3 / 3.2 / -0.3 | 4.8 (3.0 / 1.8) | -1.1 | -0.1 | 27.1 | 28.2 | 25.1 | 15.0 | 1067 / 854 | 1096 |
| K24 5550 | page plan, no port (before) | 26.8 | 5.4 | 5.8 / 3.3 / -0.2 | - | 0.9 | -0.1 | 33.8 (at the valve) | 33.0 | 25.2 | 8.9 | 1241 / 1029 (at the valve) | 1218 |
| K24 5550 | 100 mm port, law off | 26.9 | 5.4 | 5.8 / 3.2 / -0.2 | 0.1 | 0.9 | -0.1 | 33.8 | 32.9 | 25.2 | 8.9 | 1240 / 1027 | 1216 |
| K24 5550 | 100 mm port, Caton-Heywood | 26.9 | 5.4 | 5.8 / 3.2 / -0.2 | 1.2 (0.6 / 0.7) | 0.7 | -0.1 | 32.7 | 32.0 | 25.2 | 10.0 | 1211 / 967 | 1192 |
| K24 5550 | 100 mm port, Hires-Pochmara | 26.9 | 5.4 | 5.8 / 3.2 / -0.2 | 4.3 (2.8 / 1.5) | 0.2 | -0.1 | 29.5 | 29.4 | 25.2 | 13.1 | 1131 / 861 | 1125 |
| K24 7100 | page plan, no port (before) | 23.2 | 8.1 | 5.4 / 3.6 / -0.2 | - | 1.1 | -0.1 | 34.8 (at the valve) | 33.9 | 25.1 | 8.8 | 1267 / 1072 (at the valve) | 1240 |
| K24 7100 | 100 mm port, law off | 23.2 | 8.0 | 5.4 / 3.6 / -0.2 | 0.1 | 1.1 | -0.1 | 34.8 | 33.8 | 25.2 | 8.9 | 1264 / 1068 | 1237 |
| K24 7100 | 100 mm port, Caton-Heywood | 23.2 | 8.0 | 5.4 / 3.6 / -0.2 | 1.3 (0.6 / 0.7) | 0.9 | -0.1 | 33.6 | 32.9 | 25.2 | 10.0 | 1234 / 1014 | 1212 |
| K24 7100 | 100 mm port, Hires-Pochmara | 23.2 | 8.0 | 5.4 / 3.6 / -0.2 | 4.7 (2.9 / 1.8) | 0.3 | -0.1 | 30.2 | 30.0 | 25.2 | 13.4 | 1147 / 924 | 1139 |

(The K24's manifold wall at 794 C is hotter than much of its gas, so its "header" heat is near zero or negative: the wall
heats the gas. LS3 "before": the same 150 mm of pipe under the header's Reynolds' analogy at 700 K, counted as port by
position. Malchow et al. and Meisner-Sorenson in place of Caton-Heywood on the LS3: port 1.9-2.0 % and 2.4-2.6 %, port-exit
temperature 1189-1270 K and 1174-1256 K; `results/energy_after_malchow.json`, `_meisner.json`.)

### G2 The published balance (sources read 2026-11-13)

- Heywood, Internal Combustion Engine Fundamentals, Table 12.1, "Energy balance for automotive engines at maximum power",
  percent of the fuel's heating value, as reproduced on slide 7 of MIT 2.61 (spring 2017) lecture 18, "Engine heat
  transfer" (https://ocw.mit.edu/courses/2-61-internal-combustion-engines-spring-2017/df96f507776900c0dde50a4b50f422ce_MIT2_61S17_lec18.pdf,
  fetched): SI engine brake power 25-28, coolant 17-26, miscellaneous 3-10, incomplete combustion 2-5, exhaust sensible
  enthalpy 34-45 (sources there: Khovakh, Sitkei, Burke et al.); the slide adds "Update for modern engines: SI engine in the
  low 30's" for the brake share. The table's air-fuel ratio and where the exhaust enthalpy was taken are not stated there.
- The same lecture, slide 8: Gruden, Kuper and Porsche's heat balance of a 2 L SI engine at 2000 rpm against BMEP (figure
  only; not read off here).
- How the port shares the gas-side heat in a published engine thermal model: PROMETS (Shayler et al.), as used in T. J.
  Morgan's PhD thesis (University of Nottingham, 2003, "The modelling of internal combustion engine thermal systems and
  behaviour", https://repository.nottingham.ac.uk/bitstreams/e84e6a01-0a2d-4692-b4fb-001a1aadbd6a/download, fetched): 50.8 %
  of the gas-side heat to the cylinder and 49.2 % to the exhaust port (Table 5.3b; its port term "includes heat transfer to
  the exhaust manifold", section 3.8), for that engine with constants fitted to measured heat rejection.

Comparison. Like for like with Heywood's table is limited by the mixture: the model runs these engines at AFR 12.8 / 12
(lambda 0.88 / 0.82), whose frozen products keep 16 % / 20 % of the fuel's energy as CO and H2 (B1), so its "chemical
energy left" (18.2 / 25.2 %) is far above Heywood's 2-5 %, and every other share is smaller by that much. On the fuel basis
the model's brake (28.5-30.5 % LS3, 23-28 % K24) sits at or just above 25-28 % ("low 30s" modern); its exhaust enthalpy at the
port (33-38 %) inside 34-45 %; its coolant-type sum (cylinder + port, 9-13 %, plus some of the 5-8 % friction) below 17-26 %.
On the basis of the heat actually released (dividing by 81.8 % / 74.8 %), the LS3 at 5800 rpm reads brake 34.8 %,
cylinder + port 13.5 % (before: 12.1 %), port-exit exhaust 44.9 % (before: 46.3 %); Heywood's shares of the 95-98 % his
engines released are brake 26-29, coolant 17-27, exhaust 35-47 %. So: the coolant-type loss is low in both readings, the
exhaust enthalpy is at the top of the published range on the released basis and inside it on the fuel basis, and the
brake share is high only on the released basis. Neither reading is decisive for "the exhaust carries too much energy".

### G3 What the model does, term by term, against the published laws

| term | model (before part 7) | published | verdict |
|---|---|---|---|
| cylinder, closed cycle | Woschni, 2.28 Sp + the combustion term to EVO, 3.26 B^-0.2 p^0.8 T^-0.55 w^0.8, 450 K wall | Woschni (SAE 670931) as B3 and D5 | as published (B3, D5); 5.4-8.2 % of fuel here |
| cylinder, gas exchange (EVO-IVC) | Woschni's gas-exchange constant C1 = 6.18 with the mean piston speed whenever a valve is open, C2 = 0 | the same (Woschni's gas-exchange period, B3) | applied as published: 3.1-3.6 % of fuel from EVO to TDC, -0.2 to -0.3 % from TDC to IVC (the wall heats the cool charge) |
| exhaust port | none: the first 150 mm of the LS3's header (the page: the 4-Stroke tab's port length, if typed) as pipe, Reynolds' analogy St = f/2 = 0.0025 at the header's 700 K wall (zero heat transfer when the gas stands still) | measured time-averaged port correlations Nu = C Re^n (Morgan 2003, Table 2.1): Hires and Pochmara 0.258 Re^0.8 (SAE 760767), Malchow, Sorenson and Buckius 0.0483 Re^0.783 (SAE 790309; also in A. Kirkpatrick's Colorado State notes, https://www.engr.colostate.edu/~allan/heat_trans/page9/page9.html, equation image: 0.048 Re^0.78, "the characteristic length ... is the exhaust port diameter"), Meisner and Sorenson 0.0774 Re^0.769 (SAE 860242), Caton and Heywood 0.35 Re^0.6 (Int. J. Heat Mass Transfer 24 (1981) 581-595); Malchow et al. found steady pipe-flow correlations under-predict the port by up to 50 % (Morgan; Kirkpatrick: pulsing flow "about 50% greater than given by steady flow correlations"); wall: the coolant-cooled head | MIS-SET: 0.8-0.9 % of fuel where the published correlations give 1.9-2.6 % (7 % the near-valve Hires-Pochmara); changed (G4) |
| header, collector, other pipes | Reynolds' analogy St = 0.0025 at the line's wall temperature (header 700 K, collector 650 K; the Turbo manifold section's 794 C) | Dittus-Boelter St about 0.0033 (kat.js e), pulsating exhaust flow above steady correlations (above) | below the published steady and pulsating values (known since part 1, recommendation 2); NOT changed here: no published exhaust-pipe correlation with constants was read in this part, and the wall temperatures are inputs |

Fetched but not usable here: Caton and Heywood's paper itself (not openly readable: its definition of Re and of the gas
temperature in Nu, and its four-period instantaneous correlation, are unknown here; MIT's summary report, Heywood, Keck and
Rife 1980, https://core.ac.uk/download/4398386.pdf, says only that "a simple correlation based on the gas velocity at the valve
seat" and "a four time period heat transfer correlation ... for low and high valve lift" were found); Shayler et al. SAE
971851 (abstract only: a correlation with separate cylinder and port terms, two constants calibrated to measured heat
rejection); the PROMETS port equation in Morgan's thesis (its equations are images that did not survive extraction). Morgan
reports Meisner and Sorenson's comment that Hires-Pochmara and Caton-Heywood were developed for the curved part of the port
near the valve and over-predict a whole port's average; at the LS3's Re of 2-4 x 10^4 Caton-Heywood and Malchow agree
within 10 %.

### G4 What was changed: the head's exhaust port (JS `wsFactory` and Rust `et_wave`, bit parity; WebAssembly rebuilt)

- A pipe segment marked `port: true` at the start of a primary is the head's port (`markPort`: the cells whose centres lie
  within the leading port segments; one pipe or several). The 4-Stroke tab's "Exhaust port length, valve to flange" makes
  that segment (`simSpec`, as before, now marked); the turbo plan inherits it (`tsimPlan` takes the 4-Stroke tab's port);
  `ratings.js` marks its 150 mm.
- Its cells lose q = h (T - Tw) per unit wall area (`stepPipe`: `dt h pi D (Tw - T)` in place of Reynolds' analogy; friction
  unchanged), with h = Nu k / D, Nu = 0.35 Re^0.6 (Caton-Heywood, default; `e.portHeat` 'malchow', 'meisner', 'hires'
  select the others with their published constants). The correlations are time-averaged, so Re = 4 m / (pi D mu) takes
  the port's mean flow over the last cycle: the net exhaust-valve outflow from one IVC to the next x rpm / 120 (`cy.exN`),
  and the gas properties at that cycle's mass-averaged outflow temperature (the existing `tEx`); h is held for the next
  cycle; 0 before the first cycle is known. mu and k: Sutherland's law for air (1.716e-5 Pa s, S 111 K; 0.0241 W/m K,
  S 194 K, both at 273 K: COMSOL CFD Module, High Mach Number Flow, tables 5-2 and 5-3,
  https://doc.comsol.com/6.3/doc/com.comsol.help.cfd/cfd_ug_fluidflow_high_mach.08.43.html, fetched; burned gas taken as
  air: an approximation). D: the port cell's bore.
- Tw: `e.portTw`, else the cylinder's wall temperature `e.Twall` (450 K). Sources for its size: PROMETS's exhaust-port
  element at 137-144 C fully warm (at 1000 rpm / 120 N m and 3000 rpm / 5 N m; Morgan Table 5.4c), Heywood's Fig. 12-1 on
  MIT lecture 18 slide 11 (combustion-chamber wall about 480 K on the gas side over 360 K coolant). Full-load port metal
  temperatures were not found.
- Legacy: `e.portHeat` false or 'off', or no segment marked, gives the model before part 7 bit for bit (G6).
- What "held over the cycle" means (stated on the page): the time-averaged h also acts on gas standing in the port while the
  valve is shut. About half of the port's heat goes then (LS3 1.0-1.3 of 2.1-2.4 %, K24 0.7-0.8 of 1.2-1.5 %: the columns
  of G1); the time-averaged port temperature falls far more than the mass-averaged one (LS3 5800 rpm: -61 K against
  -27 K). Whether Caton-Heywood's Nu was formed with the time- or the mass-averaged gas temperature is not known here; with
  the mass-averaged one the same correlation would remove more heat. Caton (SAE 820050, abstract,
  https://saemobilus.sae.org/papers/comparisons-thermocouple-time-averaged-mass-averaged-exhaust-gas-temperatures-a-spark-ignited-engine-820050):
  the energy from time-averaged exhaust temperatures is "about 10% lower" than from mass-averaged ones, and a 0.76 mm
  thermocouple reads "about 20 K lower" than the time average.

### G5 Before and after, the measures this part is about

(a) Energy balance (G1): the port's share 0.8-0.9 % -> 2.1-2.4 % of fuel (LS3), 0 -> 1.2-1.5 % (K24 with the assumed 100 mm
port); the exhaust enthalpy leaving the port 34.7-37.9 -> 33.1-36.7 % (LS3); the coolant-type sum 9.9-11.8 -> 11.1-13.4 %
(LS3), still below Heywood's 17-26 %. Brake unchanged to 0.1 % of fuel.

(b) GM ratings (ratings.js, intake=plenum flow=benchfam, the c_final case; `results/ratings_g_legacy.json` with
`e.portHeat="off"` reproduces part 3's c_final to the printed digit; `ratings_g_final.json`):

| engine | rating | brake torque before -> after | brake power before -> after | VE at 4600 / 5800 rpm after | exhaust-valve outflow T at 5800, before -> after |
|---|---|---|---|---|---|
| LS3 | 425 lb-ft @ 4600, 430 hp @ 5900 | 478.6 @ 5000 -> 478.3 @ 5000 (+13 %) | 499.1 @ 5800 -> 499.2 @ 5800 (+16 %) | 1.051 / 1.079 | 1314 -> 1315 K |
| LS7 (cam assumed) | 470 @ 4800, 505 @ 6300 | 543.2 -> 543.2 @ 5000 (+16 %) | 549.3 -> 549.0 @ 5800 (+9 %) | 1.063 / 1.049 | 1304 -> 1305 K |
| LT1 (cam assumed) | 460 @ 4600, 455 @ 6000 | 479.5 -> 479.3 @ 4800 (+4 %) | 480.2 -> 479.9 @ 5600 (+5.5 %) | 1.051 / 1.025 | 1293 -> 1293 K |

The port's heat is taken after the valve, so the cylinder's work does not change: the rating surplus is not explained by it.

(c) Exhaust temperature against OpenWAM (`compare.py configs=single_L800,i4_41`: tag `g_base` = the page as it now is, no
port; tag `port` = the same with the first 100 mm of each primary marked as port, an ASSUMED port, these engines having none;
OpenWAM unchanged, no port; `gas_report.py before=g_base after=port`):

| configuration | crank-angle mean gas T at 10 mm from the valve, wave - OpenWAM | wave at 100 mm (mean) | exhaust-valve outflow T, wave | NMEP ratio | VE corr | firing orders: median abs diff to OpenWAM |
|---|---|---|---|---|---|---|
| single_L800 | +113 -> +18 K | 1036 -> 988 K | 1254 -> 1255 K | 1.105 -> 1.103 | 0.983 -> 0.985 | 1.6 -> 1.5 dB |
| i4_41 | +137 -> +40 K | 1020 -> 956 K | 1230 -> 1229 K | 1.138 -> 1.136 | 0.979 -> 0.984 | 3.6 -> 3.6 dB |

Read with G4: most of the change at 10 mm is the gas standing in the port while the valve is shut (a crank-angle mean is a
time mean); the outflow at the valve is unchanged, so the gas leaving the cylinder is as hot as before (78-150 K above
OpenWAM's in part 1, A6). No measured full-load exhaust temperature with its station and averaging stated could be read in
this session (open sources found gave only qualitative statements or forum readings); the comparison with a published EGT
is therefore not made. Caton's 20 K thermocouple offset and the 10 % time/mass-average energy gap (G4) are what a measured
"EGT" would have to be corrected by before such a comparison.

(d) The turbo case, K24A2 + PT5862 (`tools/validation/wave/turbo_port.js`, `results/turbo_port.json`; the page's closure and
calibration with the WebAssembly; the plan has no port, so a 100 mm port at the runner's bore is assumed):

| case | closure: turbine area mm2 | T3 at 3500 / 6600 rpm (C) | p3 mean x boost at 6600 (static) | efficiency that balances the compressor with a measured static mean p3 of 1.0 / 1.5 / 2.0 x boost at 3500 rpm |
|---|---|---|---|---|
| the page's plan (no port) | 1185 | 940 / 1013 | 0.77 (0.62) | 0.421 / 0.340 / 0.296 (part 6: 0.42 / 0.34 / 0.30) |
| 100 mm port, law off | 1158 | 940 / 1010 | 0.78 (0.63) | 0.423 / 0.342 / 0.297 |
| 100 mm port, Caton-Heywood | 1132 | 920 / 992 | 0.80 (0.65) | 0.432 / 0.351 / 0.305 |
| 100 mm port, Hires-Pochmara (upper bound) | 1053 | 862 / 918 | 0.87 (0.74) | 0.463 / 0.380 / 0.336 |

The port moves the efficiency the calibration needs at 1.5 x boost from 0.340 to 0.351 (0.380 with the largest published
correlation): a real turbine (well above 0.5) is still far away, so the turbine's implausible calibration is not mainly the
port. What is left for it is named in part 6 (quasi-steady turbine using every pulse at full efficiency, no heat loss in the
turbine housing, the model's hot outflow at the valve) and the charge the model traps (G7).

Sound: the tailpipe firing orders with the port law against without, on the same OpenWAM matrix runs (wave side): single
cylinder (orders 0.5-2) median +0.39 dB, median absolute 0.43, range -1.0 to +1.3 dB; i4 (orders 2, 4, 8) median -0.08,
median absolute 0.47, range -1.3 to +4.6 dB (the +4.6 dB: order 8 at 2500 rpm, a weak order). The cooler port gas is slower
by about 2-3 % over its length, too short to move a resonance noticeably.

Run time: unchanged within the timing noise (ratings.js, whole engines, 19 speeds: LS3 71 -> 73 s, LS7 72 -> 72 s, LT1 72 ->
72 s; energy_balance.js 32 s either way).

### G6 Verification

- `kat.js`: 66 of 66, `results/kat.json` byte-identical. `constref.js`: 112 constant-gamma speeds identical.
- `ratings.js ... e.portHeat="off"` reproduces part 3's c_final (LS3 479 / 499, LS7 543 / 549, LT1 479 / 480 to the digit).
- `web/tests/wavegas_ui.js` 12 (new): the four correlations' constants; Sutherland's law by hand at 273-2000 K; h by hand
  (0.04 kg/s, 1150 K, 40 mm: Re 28182, Nu 163.7, h 296.3 W/m2 K); unknown law refused; the port cells for a port at the
  primary's bore (12 of 62 within 120 mm) and at its own bore (its whole pipe, none after); after a 6000 rpm run, the port's
  h equals the law evaluated in the test at the last cycle's measured net outflow and mass-averaged temperature (to 1e-9);
  one cycle's mass and total energy residuals -2.7e-15 and 2.7e-15 of the heat released with the port's 38.7 J as a sink
  (Reynolds' analogy at 700 K would take 13.9 J from the same cells); `e.portHeat` 'off' with the port marked equals the
  run without a port to the last digit.
- `web/tests/wave_wasm.js`: three port jobs added (a 110 mm port of 40 mm ahead of the four-cylinder collector's primaries,
  default law and constant gas; a single cylinder's 120 mm port at the primary's bore with Meisner-Sorenson at a 480 K wall):
  JS and Rust/WebAssembly identical to the last digit; nothing removed or loosened.
- `energy_balance.js`: sensible-energy residual 3e-16 to 1.4e-14 of the heat released at all 21 points (G1).
- `engine.js` now reads the pipe heat the step added (instrumented) instead of recomputing Reynolds' analogy, so its energy
  balance holds with port cells. (Its mass residual of 7.8 % and energy residual of about 1e-8 on the default gas are the
  fuel vapour and its chemical energy, which its balance has not counted since part 2: unchanged, not this part's.)

### G7 The rating surplus: what else was tested (the hypothesis does not explain it)

The energy balance says where to look. At the LS3's rated-power speed the model's brake efficiency is 28.5 % of the fuel's
LHV (BSFC 0.473 lb/hp h at AFR 12.8), at Heywood's 25-28 % / "low 30s"; it is the airflow that is high. What the rating
implies at the model's own efficiency: 430 hp at 28.5 % needs 0.0256 kg/s of fuel, 0.327 kg/s of air at AFR 12.8, VE 0.91
at 5900 rpm (displaced air 0.3587 kg/s at 298 K, 1 atm); 425 lb-ft at 4600 rpm at 29.9 % needs VE 0.97. The model has 1.08
and 1.05. No measured VE or BSFC of a stock LS3 could be found in an open source (searched: forum VE tables only; crate and
dyno articles without BSFC), so this is an inference from the model's own efficiency, not a measurement.

One change at a time (LS3, c_final with the port law):

| change | brake torque | brake power | note |
|---|---|---|---|
| none | 478.3 @ 5000 | 499.2 @ 5800 | |
| 5 kPa back pressure at the collectors' ends (`back=5000`) | 476.8 (-0.3 %) | 497.5 (-0.3 %) | a stand-in for catalysts and mufflers; no sourced figure for the stock LS3 exhaust |
| 10 kPa (`back=10000`) | 475.2 (-0.6 %) | 495.6 (-0.7 %) | the model's pumping rises only 3-5 kPa (the header's waves take part of it); on the page's brake (gross - tfmep) pumping does not enter at all, so on a net basis subtract about another 0.3 % |

- SAE J1349 net ratings are taken "with stock ignition timing, carburetion/fuel delivery, exhaust systems, and accessories"
  (Ate Up With Motor, "Understanding gross versus net horsepower ratings",
  https://ateupwithmotor.com/automotive-terms/47-gross-versus-net-horsepower.html, fetched; the standard's own text,
  https://saemobilus.sae.org/standards/j1349_202511-engine-power-test-code-spark-ignition-compression-ignition-installed-net-power-torque-rating,
  shows only its purpose); historical gross-net gaps of 5-25 % are quoted there. The model has no accessories, no air
  cleaner (0 kPa filter loss assumed, part 3: 2.5 kPa costs 3-4 %) and no stock exhaust; what the crate engine sheet's test
  used is not known. These lower a real rating against the model; the back pressure alone is small (above).
- Friction: Heywood's 1980s law (B4); Sandoval and Heywood (SAE 2003-01-0725) could not be read (part 2: the thesis's
  equations did not survive the scan). A modern V8's friction is likely lower, which would raise the model's brake further.
- Residual and trapped charge: the wave model's residual on part 3's single cylinder and i4 was 1.5-5.2 % (C6); part 3's like-for-like comparison put
  2.8-4.7 points of the indicated surplus over OpenWAM on the larger charge the wave model traps (C6, D4), still unexplained.
  Not resolved here.

So the open question moves from "too much exhaust energy" to "too much air": the model's VE of 1.05-1.10 at full throttle
with the realistic intake, against the 0.91-0.97 the ratings imply at the model's efficiency. The intake runner length
(unknown, 300 mm assumed; part 3: -6 % to +9 %) and the ratings' accessories and exhaust are the largest named suspects.

### G8 What changed on the page; tests; pinned values

- Model: `wsFactory` (`PORT_NU`, `muAir`, `kAir`, `portLaw`, `portH`, `markPort`; `makePipe` np / hp / Twp; `stepPipe`'s heat
  term; `makeEngine` port; `freshState` marks the port; `runSpeed` cy.exN and the port's h each cycle; `port` exported) and
  `rust/et_wave` line for line (`Seg.port`, `port_law`, `mu_air`, `k_air`, `port_h`, `Pipe.np/hp/twp`, `Cyl.ex_n`); the
  WebAssembly rebuilt and embedded (`tools/build_wave_wasm.sh`).
- Page: `simSpec` marks the 4-Stroke tab's port segment (and keeps the mark when a bulge chamber splits it); the method text
  states the port law, its source, what it does and does not change, and this part's energy balance.
- Default page runs: unchanged where no port length is typed (the 4-Stroke tab's port length is blank by default); with a port
  typed the port law applies.
- Tests: `web/tests/wavegas_ui.js` 12 (new), `web/tests/wave_wasm.js` (three port jobs added). Scripts:
  `tools/validation/wave/energy_balance.js` (new), `turbo_port.js` (new), `ratings.js` (the port marked; `back=`; importable),
  `compare.py` (tags `port`, `g_base`), `engine.js` (instrumented pipe heat; 100 mm temperature trace), `lib.js` (pipe heat,
  fuel and reverted-fuel enthalpy instrumentation, read-only).
- Pinned values changed: none. No existing check was edited or loosened; wavegas_ui, wavekat_ui, waveturbo_ui, turboaudit_ui
  and turbosim_ui pass unchanged (the K24 plan has no port, so its numbers do not move).
- Suite (`python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`, 2026-11-13, part 7): 130 tests, 123
  passed, 0 flaky, 0 failed, 7 skipped, 7 partial skips (all expected: no host build, no OpenWAM build in the worktree, F-100
  runs absent), 0 unexpected, 1299 s (wave_wasm 321 s, wavegas_ui 44 s, turboaudit_ui 81 s, turbosim_ui 40 s).
  `cargo test -p et_wave --release` (in rust/et_wave): builds, 0 tests in the crate (its parity is wave_wasm.js). A fresh
  `tools/build_wave_wasm.sh` leaves the embedded WebAssembly byte-identical.

### G9 Summary rows (section 6, as of 2026-11-13, part 7)

| Difference | Status | Evidence |
|---|---|---|
| Exhaust energy too high (hypothesis) | partly: the port lost too little (0.8-0.9 % of fuel against 1.9-2.6 % from published port correlations; fixed, Caton-Heywood); the exhaust enthalpy at the port is inside Heywood's 34-45 % of fuel; the outflow at the valve is unchanged by the port | G1-G5 |
| Coolant-type loss | 11-13 % of fuel (cylinder + port) against Heywood's 17-26 % (which includes some friction); low | G1, G2 |
| Pipe wall heat (Reynolds' analogy) | below Dittus-Boelter and pulsating-flow data; unchanged (no constants read for exhaust pipes) | G3 |
| Rating surplus | not the exhaust side: brake efficiency 28.5-30.5 % of fuel is ordinary; the airflow (VE 1.05-1.10) is above what the ratings imply (0.91-0.97); back pressure 10 kPa -0.6 %; accessories not modelled | G7 |
| Turbo calibration efficiency at 1.5 x boost | 0.340 -> 0.351 with a 100 mm port (0.380 at the largest correlation): not mainly the port | G5 d |

### G10 How to rerun (additions)

```
node tools/validation/wave/energy_balance.js tag=after k24port=0.1          # LS3 + K24, ~40 s; PAGE=<older page> for 'before'
node tools/validation/wave/energy_balance.js tag=after_hires 'e.portHeat="hires"' k24port=0.1
node tools/validation/wave/ratings.js tag=g_final intake=plenum flow=benchfam   # and 'e.portHeat="off"' (legacy), back=10000
node tools/validation/wave/turbo_port.js                                    # ~2 min
python3 tools/validation/wave/compare.py configs=single_L800,i4_41 tag=g_base   # then tag=port; OpenWAM ~2 min
python3 tools/validation/wave/gas_report.py before=g_base after=port
node web/tests/wavegas_ui.js                                                # 12: the port law
```

## Addendum 2026-11-13, part 8: why the model breathes too well (its volumetric efficiency taken apart)

Question. Part 7 (G7) put the 4-16 % brake-torque surplus against the GM V8 ratings on the airflow: the model's VE is
1.05-1.08 for the LS3 with the realistic intake, where the ratings at the model's own brake efficiency imply 0.91-0.97.
Here the VE is taken apart exactly, each named candidate (ram and waves, valve flow, charge heating, fuel vapour, residual,
intake and exhaust losses, cam events) is priced by one change at a time, the published data that could be read are
listed, and the pieces that are real and missing with a published basis are added. Nothing was tuned to the ratings.
Result in short: the model's VE above 1 is the 300 mm runner's ram (an assumed length); two missing pieces with a
published basis were added or made explicit: heat from the head's intake port into the charge (a model change, active where a
port is marked) and the rating's reference air (J1349's 99 kPa of dry air: a comparison input). With both the surplus is
LS3 +8 % torque / +11 % power, LS7 +11 / +5 %, LT1 0 / +1 %; the rest is within what the unpublished stock air cleaner,
exhaust and runner length can do, which are left as labelled inputs.

### H1 The VE taken apart (`tools/validation/wave/ve_decomp.js`, `results/ve_h_*.json`)

The model's VE (trapped fresh air at IVC against dry air at 101.325 kPa and 298.15 K filling the displacement) is exactly
VE = (V_ivc / Vd) (p_ivc / p_ref) (T_ref / T_ivc) (R_air / R_mix) x f_air of the cylinder's state at IVC. Because the
intake closes 60-70 deg after BDC (seat), V_ivc is 0.84-0.90 Vd and the charge is already compressed there, so the table
gives the same charge taken isentropically (its frozen gamma at IVC) to the BDC volume Vd + Vc: p* and T* are the pressure
and temperature it would have there; the product (Vb / Vd) (p* / p_ref) (T_ref / T*) (R_air / R_mix) x f_air is still the
VE exactly (checked: "prod" equals the model's VE to the printed digit in every run). p* is the ram and wave pressure net
of every loss; T* the charge's temperature, raised from the 298 K air by the runner's walls, the residual, the walls during
induction and the filling itself (gas pushed into a cylinder that is still filling is compressed by what follows; its
stagnation temperature at the valve is the inflow T0 column). R_air / R_mix and f_air are the fuel vapour (2.3 % net),
x the residual's dilution. Over the last settled cycle of ratings.js's realistic case (part 7's c_final), whole engines:

| engine, rpm | VE | Vb / Vd | p* / p_ref | T_ref / T* (T*, K) | R_air / R_mix | x (residual %) | f_air | inflow T0 at the valve (K) | wall heat into the charge while the intake is open (K) | air pushed back into the runner (% of trapped) | plenum mean (kPa) | brake torque (lb-ft) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LS3 3000 | 0.8745 | 1.1031 | 0.9629 | 0.8750 (340.7) | 1.0524 | 0.9638 (3.6) | 0.9275 | 309.0 | 8.6 | 14.3 | 100.91 | 392.3 |
| LS3 4600 | 1.0512 | 1.1031 | 1.2270 | 0.8179 (364.5) | 1.0532 | 0.9721 (2.8) | 0.9275 | 305.8 | 5.7 | 4.5 | 99.87 | 462.7 |
| LS3 5800 | 1.0792 | 1.1031 | 1.2971 | 0.7932 (375.9) | 1.0533 | 0.9733 (2.7) | 0.9275 | 303.3 | 4.7 | 0.3 | 98.91 | 452.0 |
| LS7 3000 | 0.8697 | 1.1000 | 0.9734 | 0.8670 (343.9) | 1.0521 | 0.9599 (4.0) | 0.9275 | 311.7 | 7.9 | 14.7 | 100.79 | 443.1 |
| LS7 4600 | 1.0630 | 1.1000 | 1.2433 | 0.8162 (365.3) | 1.0534 | 0.9746 (2.5) | 0.9275 | 305.1 | 6.2 | 3.6 | 99.40 | 534.3 |
| LS7 5800 | 1.0490 | 1.1000 | 1.2642 | 0.7933 (375.8) | 1.0533 | 0.9733 (2.7) | 0.9275 | 303.2 | 4.9 | 0.2 | 98.36 | 497.1 |
| LT1 3000 | 0.8994 | 1.0952 | 0.9948 | 0.8755 (340.6) | 1.0526 | 0.9658 (3.4) | 0.9275 | 307.7 | 8.3 | 10.7 | 100.82 | 413.3 |
| LT1 4600 | 1.0507 | 1.0952 | 1.2590 | 0.8082 (368.9) | 1.0526 | 0.9656 (3.4) | 0.9275 | 307.4 | 4.2 | 3.0 | 99.67 | 472.2 |
| LT1 5800 | 1.0247 | 1.0952 | 1.2626 | 0.7868 (378.9) | 1.0525 | 0.9647 (3.5) | 0.9275 | 305.3 | 3.1 | 0.3 | 98.85 | 432.4 |

Read: at the speeds that set the ratings the charge is held at 1.23-1.30 atm (p* at 4600 and 5800 rpm) and 365-379 K
(T*), so VE 1.02-1.08. Of its 66-81 K of heating, the air arriving at the valve brings 5-9 K (runner walls at 320 K; at
3000 rpm 10-14 K with the hot gas pushed back), the walls while the intake is open 3-6 K; the rest (about 50-70 K) is the
2.5-4.0 % residual's heat and the filling, not separated here.
The runner's ram is the lever: one change, the runner 300 -> 100 mm (`h_short`): LS3 VE 0.866 / 0.868 /
0.911 (p* 0.945 / 0.966 / 1.042), torque -1 / -21 / -20 %; 300 -> 450 mm (`h_long`): 0.911 / 1.123 / 0.999. The runner's
length is not published (D8: 300 mm assumed). The 0.7 law in place of the measured head flow (`h_law07`): VE 0.870 / 1.059 / 1.065
(-0.6 / +0.7 / -1.4 %).

The same after part 8, "as rated" (the intake port law on the stock port, H5, and J1349's air, H2; VE still referred to
101.325 kPa, so J1349's 99 kPa alone takes 2.3 % off it):

| engine, rpm | VE | Vb / Vd | p* / p_ref | T_ref / T* (T*, K) | R_air / R_mix | x (residual %) | f_air | inflow T0 at the valve (K) | wall heat into the charge while the intake is open (K) | air pushed back into the runner (% of trapped) | plenum mean (kPa) | brake torque (lb-ft) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| LS3 3000 | 0.8450 | 1.1031 | 0.9400 | 0.8669 (343.9) | 1.0524 | 0.9630 (3.7) | 0.9275 | 313.0 | 8.0 | 14.4 | 98.60 | 376.3 |
| LS3 4600 | 1.0165 | 1.1031 | 1.1970 | 0.8112 (367.5) | 1.0531 | 0.9715 (2.8) | 0.9275 | 309.6 | 5.3 | 4.6 | 97.60 | 443.7 |
| LS3 5800 | 1.0462 | 1.1031 | 1.2687 | 0.7865 (379.1) | 1.0532 | 0.9729 (2.7) | 0.9275 | 307.1 | 4.3 | 0.4 | 96.68 | 433.9 |
| LS7 3000 | 0.8416 | 1.1000 | 0.9501 | 0.8601 (346.6) | 1.0521 | 0.9593 (4.1) | 0.9275 | 315.3 | 7.4 | 14.8 | 98.49 | 425.8 |
| LS7 4600 | 1.0286 | 1.1000 | 1.2131 | 0.8099 (368.2) | 1.0533 | 0.9742 (2.6) | 0.9275 | 308.7 | 5.8 | 3.6 | 97.15 | 512.9 |
| LS7 5800 | 1.0181 | 1.1000 | 1.2373 | 0.7869 (378.9) | 1.0532 | 0.9730 (2.7) | 0.9275 | 306.8 | 4.5 | 0.2 | 96.14 | 477.7 |
| LT1 3000 | 0.8685 | 1.0952 | 0.9710 | 0.8667 (344.0) | 1.0526 | 0.9651 (3.5) | 0.9275 | 312.0 | 7.8 | 10.8 | 98.52 | 396.3 |
| LT1 4600 | 1.0155 | 1.0952 | 1.2286 | 0.8011 (372.2) | 1.0525 | 0.9649 (3.5) | 0.9275 | 311.5 | 3.7 | 3.1 | 97.42 | 452.6 |
| LT1 5800 | 0.9948 | 1.0952 | 1.2363 | 0.7803 (382.1) | 1.0525 | 0.9644 (3.6) | 0.9275 | 309.2 | 2.8 | 0.3 | 96.61 | 415.6 |

### H2 Published data: what could be read (2026-11-13)

Volumetric efficiency or airflow of these engines:
- No measured VE, airflow or BSFC of a stock LS3, LS7 or LT1 could be read in an open source. GM's Gen V combustion-system
  paper (SAE 2013-01-1732, https://saemobilus.sae.org/papers/development-combustion-system-general-motors-fifth-generation-small-block-engine-family-2013-01-1732)
  has a qualitative abstract only (airflow testing and CFD named, no values); Hib Halverson's GM-sourced LS7 series
  (https://corvetteactioncenter.com/specs/c6/corvette-ls7-engine/ls7-engine15.html, page 15 of 26) gives the 90 mm throttle,
  the 1.8:1 rocker, "shorty header" stainless exhaust manifolds (four primaries meeting at the outlet flange) and "low
  back-pressure", but no airflow, VE or back-pressure figure (other pages of the 26 were not read). A Corvette owner's
  "0.47 lb/hp h" at WOT on a forum (corvetteforum.com thread 4989772, method and speed not stated) was not used. Typical VE
  of 2-valve pushrod V8s with a citable number was not found; MIT 2.61 lecture 8 (spring 2017,
  https://mitocw.ups.edu.ec/courses/mechanical-engineering/2-61-internal-combustion-engines-spring-2017/lecture-notes/MIT2_61S17_lec8.pdf)
  lists the mechanisms only (slide 6: "Loss in [VE] because intake charge is heated up by the hot walls", "prominent at low
  speed"; slide 3: for fuel evaporation "in practice, most heat from the wall unless direct injection is used").
  So the comparison stays with G7's inference: at the model's own brake efficiency the ratings imply VE 0.91-0.97.
The rating's atmosphere:
- SAE J1349 net ratings are corrected to a reference atmosphere of 99 kPa of dry air at 25 C: "the newer SAE J1349
  standard of 77 F (25 C) day with 0% humidity and a barometric pressure of 29.234 in-Hg (99 KPa)" (Mike Chaney's Tech
  Corner, DDI software, https://ddisoftware.com/tech/tt-dyno/the-ambient-correction-factors), and "990mBar and 25 degrees
  Celsius as the nominal conditions", pressure "dry" (https://bikeboy.org/dynocorrectionfactors.html). Both are secondary;
  the standard itself (saemobilus J1349) could not be read. The model's atmosphere is 101.325 kPa dry air at 298.15 K:
  2.35 % denser in dry air than the rating's.
Residual gas:
- The Fox, Cheng and Heywood model (SAE 931025) as written in Oberg and Eriksson's comparison of residual-gas models
  (https://www.fs.isy.liu.se/Publications/Articles/SAE_06_POLE.pdf, their eq. 3, "model A"):
  x_r = C1 (p_em/p_im)^((gamma+1)/(2 gamma)) (OF/N) sqrt(p_em - p_im) + C2 (1/(lambda r_c)) (p_im/p_em)^(1/gamma), with their
  refit C1 = 0.4205, C2 = 0.5869 for their engine (Fox et al.'s own constants could not be read). At wide-open throttle with
  p_em about p_im the second term dominates: 0.5869 / (0.877 x 10.7) = 6.3 % for the LS3 at AFR 12.8. The model has 2.5-4.0 %
  (H1) with its open long-tube headers, which scavenge. A correlation fitted on another engine, so only a pointer.
Intake port heat transfer:
- Published time-averaged correlations Nu = C Re^m (Pr^n) for the intake system, as tabulated by Rahman, Hamada and Kadirgama,
  "Heat transfer of intake port for hydrogen fueled port injection engine: a steady state approach", Int. J. Physical
  Sciences 6(16), 2011, Table 1 (https://core.ac.uk/download/268871449.pdf): Dittus-Boelter 0.023 Re^0.8 Pr^0.4; Bauer et al.
  1998 straight manifold 0.062 Re^0.73, curved manifold 0.140 Re^0.66; Depcik and Assanis 2002 0.0694 Re^0.75 ("valid for
  1500 < Re < 40000"); Shayler et al. 1996 0.135 Re^0.713. Depcik and Assanis's own paper (SAE 2002-01-0372, "A universal
  heat transfer correlation for intake and exhaust flows in a spark-ignition internal combustion engine") gives in its
  abstract a correlation coefficient of 0.845 with all intake data; its equations could not be read there. At the LS3's
  runner (42.6 mm, 0.045 kg/s, about 310 K: Re 7.1 x 10^4) they give Nu 302 (Depcik), 388 (Shayler), 223 (Bauer curved), 152 (Dittus-Boelter),
  against 0.0025 Re Pr = 125 for the model's Reynolds' analogy at the same mean flow.
- Intake-port or intake-valve wall temperatures at full load: not found as numbers (SAE 971729's abstract: the intake valve's
  temperature rises with load, speed and coolant temperature, "coolant temperature was the single most important correlating
  variable"; Riggs et al. 1991, a GM 2.0 L engine: differences only). The coolant's 360 K of Heywood's Fig. 12-1 (MIT 2.61
  lecture 18, slide 11, as part 7) is taken for the port wall: an ASSUMPTION, sensitivity 340 and 400 K.
- The LS3's intake port volume: "260cc Intake Runner" (GM Performance 12629063, LS3 head, as listed by VPW,
  https://www.vpw.com.au/gm-performance-cylinder-head-ls3-aluminum-assemble): at the model's runner bore (sqrt(0.6) x the
  2.165 in valve, 1425 mm2) that is 182.5 mm of the 300 mm runner. Used for all three engines (an ASSUMPTION for the LS7, LT1).
Stock exhaust back pressure:
- No figure for these engines (above). Measured on other production cars by AutoSpeed (Julian Edgar, "Frank's Exhaust,
  Part 1", https://autospeed.com.au/cms/a_108185/article): a Ford Falcon EF six with its standard exhaust "measured maximum
  was 8.7 psi" (60 kPa) at the oxygen-sensor position accelerating at full throttle to the redline; 5.9-9.3 psi on three
  other standard systems (one after the catalyst). Gauge readings (a mean), not a V8, not stated at rated power: they show
  the size only, so the stock exhaust stays an input (exdp=).
Cam events:
- "The new way of measuring Duration is .050 of lift on the Tappet" (Performance Trends,
  https://performancetrends.com/Definitions/Camshaft-Duration.htm); a community-college cam glossary
  (https://www.austincc.edu/wkibbe/camterminology.pdf) says the valve. GM's LS3 card (204 / 211 deg at 0.050 in) does not say
  which; the LS rocker is 1.7:1 (the LS7's 1.8:1, Halverson above). The model forces its sin² lift through 0.050 in of
  VALVE lift at the card's angles (camSeat); at the tappet it would be 0.085 in at the valve.

### H3 The valve flow conversion and the valve events, checked against the standard treatment

- Flow-bench conversion (`benchCdA`, part 3 C1): m = Cd A p0 / sqrt(R T0) (p/p0)^(1/gamma) {2 gamma / (gamma - 1)
  [1 - (p/p0)^((gamma-1)/gamma)]}^(1/2), the compressible orifice equation of Heywood ch. 6 for poppet valves (the form
  in the FAMU-FSU "Valve Flows" notes, part 3 C1), algebraically the same as the model's psi, and the same law the valves
  then obey (`orifice`), choked below the critical ratio. Because the bench gives Cd A directly, the reference area (curtain
  or seat) drops out, and the pressure-ratio dependence is the law's; the only free choice is the bench's reference state
  (60 F, 1 atm, as part 3 stated; at 68 F the areas would be 0.8 % smaller). The flow is isentropic up to the measured
  effective area, as in the standard treatment. Verdict: correct; not changed. Its size here: H1 (`h_law07`), under 1.4 %
  of VE.
- Valve events: the LS3's are GM's card (IVO -19, IVC 43, EVO 38, EVC -7 deg at 0.050 in: 204 / 211 deg); the LS7 and LT1 cams
  are assumed straight up (B5). The lift is sin² over a seat-to-seat duration stretched so that it passes the check lift
  at the card's angles (`camSeat`, 0.050 in = 1.27 mm at the VALVE). If the card's 0.050 in is tappet lift (H2), the real
  valve is at 0.085 in at those angles (1.7:1): one change, the check lift 2.159 mm (`h_chk`; `ratings_h_s_chk`): VE
  -5.8 / -2.0 / +2.0 % at 3000 / 4600 / 5800 rpm, LS3 as rated 453 lb-ft @ 5000 (+7 %), 497 hp @ 6200 (+16 %): the curve
  moves up the speed range and the power surplus grows. So the convention does not explain the surplus either way. Not
  changed: which convention GM's card uses could not be verified, and a sin² is not the real lobe (no measured LS3 lift
  profile was found; the page imports one for OpenWAM when the user has it, `e.camProfile`).

### H4 One change at a time (LS3, part 7's c_final, `ve_decomp.js`; results/ve_<tag>.json; brake = gross - Heywood tfmep)

| one change from part 7 (LS3, c_final) | VE 3000 / 4600 / 5800 rpm | VE change (%) | brake torque (lb-ft) | torque change (%) | residual (%) | inflow T0 at the valve (K) |
|---|---|---|---|---|---|---|
| none (part 7) | 0.8745 / 1.0512 / 1.0792 | | 392.3 / 462.7 / 452.0 | | 3.6 / 2.8 / 2.7 | 309.0 / 305.8 / 303.3 |
| the rating's air: J1349, 99 kPa dry air at 25 C (tails at 100 kPa) | 0.8536 / 1.0264 / 1.0539 | -2.4 / -2.4 / -2.3 | 381.1 / 449.3 / 438.3 | -2.8 / -2.9 / -3.0 | 3.7 / 2.8 / 2.7 | 309.1 / 305.9 / 303.3 |
| intake port law, Depcik-Assanis, the stock port's 182.5 mm, 360 K wall (adopted, H5) | 0.8657 / 1.0411 / 1.0714 | -1.0 / -1.0 / -0.7 | 387.3 / 457.0 / 447.5 | -1.3 / -1.2 / -1.0 | 3.7 / 2.8 / 2.7 | 312.9 / 309.5 / 307.0 |
|   the same, Shayler et al. | 0.8626 / 1.0372 / 1.0680 | -1.4 / -1.3 / -1.0 | 385.6 / 454.8 / 445.6 | -1.7 / -1.7 / -1.4 | 3.7 / 2.8 / 2.7 | 314.3 / 310.8 / 308.4 |
|   the same, Bauer et al. curved | 0.8678 / 1.0447 / 1.0748 | -0.8 / -0.6 / -0.4 | 388.5 / 459.0 / 449.5 | -1.0 / -0.8 / -0.6 | 3.6 / 2.8 / 2.7 | 312.0 / 308.3 / 305.6 |
|   the same, wall 340 K | 0.8704 / 1.0469 / 1.0758 | -0.5 / -0.4 / -0.3 | 390.0 / 460.3 / 450.0 | -0.6 / -0.5 / -0.4 | 3.6 / 2.8 / 2.7 | 310.7 / 307.5 / 305.1 |
|   the same, wall 400 K | 0.8563 / 1.0297 / 1.0627 | -2.1 / -2.0 / -1.5 | 382.0 / 450.6 / 442.5 | -2.6 / -2.6 / -2.1 | 3.7 / 2.8 / 2.7 | 317.4 / 313.4 / 310.8 |
| (pipe law) the runner's last 120 mm at 370 K, Reynolds' analogy | 0.8612 / 1.0312 / 1.0637 | -1.5 / -1.9 / -1.4 | 384.8 / 451.5 / 443.2 | -1.9 / -2.4 / -2.0 | 3.7 / 2.8 / 2.7 | 314.7 / 311.5 / 309.0 |
| (pipe law) every intake pipe at 360 K instead of 320 K | 0.8581 / 1.0268 / 1.0611 | -1.9 / -2.3 / -1.7 | 383.1 / 449.1 / 441.7 | -2.3 / -3.0 / -2.3 | 3.7 / 2.9 / 2.7 | 315.8 / 312.7 / 310.2 |
| cylinder wall 450 -> 500 K | 0.8612 / 1.0416 / 1.0741 | -1.5 / -0.9 / -0.5 | 385.8 / 458.2 / 449.9 | -1.6 / -1.0 / -0.5 | 3.7 / 2.8 / 2.6 | 310.0 / 306.1 / 303.3 |
| no in-cylinder wall heat (Woschni off) | 0.8795 / 1.0646 / 1.0808 | +0.6 / +1.3 / +0.2 | 429.4 / 502.6 / 482.6 | +9.5 / +8.6 / +6.8 | 3.1 / 2.2 / 2.2 | 310.3 / 305.4 / 303.5 |
| no fuel vapour in the charge (part 1's air charge) | 0.8723 / 1.0511 / 1.0782 | -0.3 / -0.0 / -0.1 | 376.7 / 444.9 / 432.9 | -4.0 / -3.9 / -4.2 | 3.9 / 2.8 / 2.7 | 310.7 / 306.4 / 303.5 |
| fuel vapour premixed in the intake (displacement's upper bound) | 0.8731 / 1.0740 / 1.0426 | -0.2 / +2.2 / -3.4 | 391.3 / 474.6 / 432.3 | -0.2 / +2.6 / -4.4 | 3.6 / 2.7 / 2.7 | 308.8 / 305.1 / 302.9 |
| air filter 2.5 kPa at the rated flow | 0.8690 / 1.0325 / 1.0437 | -0.6 / -1.8 / -3.3 | 389.3 / 452.6 / 432.8 | -0.8 / -2.2 / -4.2 | 3.6 / 2.8 / 2.7 | 309.1 / 306.0 / 303.5 |
| 10 kPa static back pressure at the tails (part 7) | 0.8657 / 1.0452 / 1.0732 | -1.0 / -0.6 / -0.6 | 387.6 / 459.5 / 448.8 | -1.2 / -0.7 / -0.7 | 4.0 / 3.1 / 2.9 | 310.2 / 306.3 / 303.5 |
| tail restriction 30 kPa at the rated flow (~ flow squared) | 0.8912 / 1.0200 / 1.0533 | +1.9 / -3.0 / -2.4 | 401.0 / 445.9 / 438.1 | +2.2 / -3.6 / -3.1 | 2.9 / 4.2 / 3.6 | 307.4 / 310.0 / 304.9 |
| tail restriction 50 kPa at the rated flow | 0.8883 / 1.0073 / 1.0293 | +1.6 / -4.2 / -4.6 | 399.5 / 439.0 / 425.1 | +1.9 / -5.1 / -5.9 | 3.0 / 4.7 / 4.5 | 307.6 / 312.7 / 307.6 |
| 0.050 in check lift read at the tappet (0.085 in at the valve) | 0.8235 / 1.0299 / 1.1008 | -5.8 / -2.0 / +2.0 | 363.1 / 449.3 / 461.9 | -7.4 / -2.9 / +2.2 | 4.9 / 2.6 / 2.1 | 317.3 / 307.7 / 304.0 |
| runner 300 -> 100 mm | 0.8658 / 0.8676 / 0.9108 | -1.0 / -17.5 / -15.6 | 388.0 / 365.5 / 362.2 | -1.1 / -21.0 / -19.9 | 3.7 / 3.4 / 3.1 | 305.5 / 305.1 / 304.2 |
| runner 300 -> 450 mm | 0.9113 / 1.1228 / 0.9992 | +4.2 / +6.8 / -7.4 | 411.2 / 500.7 / 409.1 | +4.8 / +8.2 / -9.5 | 3.5 / 2.6 / 2.9 | 311.8 / 305.7 / 304.7 |
| 0.7 law in place of the measured head flow | 0.8696 / 1.0587 / 1.0646 | -0.6 / +0.7 / -1.4 | 389.8 / 466.8 / 444.3 | -0.6 / +0.9 / -1.7 | 3.7 / 2.8 / 3.4 | 309.2 / 305.8 / 304.2 |

Read, against the published basis of each:
- Fuel vapour: in the model the vapour joins at the valve, on top of the air the orifice passed, so it hardly displaces air
  (VE -0.0 to -0.3 % against an air charge); its effect on torque (-4 %) is the closed cycle (part 2, B6). Fully evaporated
  in the runner (premixed, the upper bound of displacement for a port injector) it changes the runner's sound speed and so
  the tuning (+2.2 / -3.4 %), not a clean displacement. MIT's lecture 8 (H2): with port injection most of the evaporation
  heat comes from the walls; neither bound is clearly the real one, so the model's choice (part 2) stays.
- In-cylinder wall heat during induction: Woschni's gas-exchange term as published (part 7, G3); off, VE +0.2 to +1.3 %.
  The charge-heating loss in the cylinder is already in the model and small.
- Intake heating upstream of the cylinder: with the runner's pipe law (Reynolds' analogy at 320 K) the air reached the
  valve 5-14 K above ambient. Published intake-port correlations give 1.8-3.1 times the pipe law's heat transfer at the same
  mean flow (H2), and the port is coolant-backed: missing physics with a published basis: added (H5): -0.7 to -1.0 % VE,
  -1.0 to -1.3 % torque (Shayler's law -1.4 to -1.7 %; wall 340 / 400 K -0.4 / -2.6 %).
- Residual: 2.5-4.0 % in the model (open long-tube headers) against 6.3 % from the Fox-Cheng-Heywood form at p_e = p_i (H2;
  a correlation fitted on another engine). A stock exhaust (shorty manifolds, catalysts, mufflers) raises p_e: the tail
  restriction raises the residual to 4.2-4.7 % at 4600 rpm, and VE -2.4 to -4.6 % at 4600-5800 (at 3000 rpm +2 %: the
  restriction moves the wave timing). The size of the stock restriction is not published for these engines (H2): left as
  an input (`exdp=`), not a default. The page's brake (gross - tfmep) does not see the extra pumping; its net bracket
  ("net - tfmep", ratings_report) does, twice over: the truth lies between (H6).
- Intake losses upstream: the plenum's mean pressure is 0.4-3.0 kPa below the outside air at full load with the 90 mm
  throttle and the open filter mouth (H1 table). An air cleaner, duct and MAF of 2.5 kPa at the rated flow (part 3's size;
  not published for these engines) take -0.6 / -1.8 / -3.3 % of VE: an input (`fdp=`, as part 3), not a default.
- The rating's air: J1349 corrects to 99 kPa of dry air (H2); the model breathed 101.325 kPa: -2.3 to -2.4 % of VE,
  -2.8 to -3.0 % of brake torque (friction does not shrink with the air). This is the definition of the rating, not
  physics of the engine: it becomes a labelled comparison input (`amb=j1349`), and the as-rated tables use it.

### H5 What was changed

1. The head's intake port (model; JS `wsFactory`, Rust `et_wave` line for line, WebAssembly rebuilt and embedded):
   - Intake segments marked `port: true` at the valve end of a runner are the head's intake port (`markPortIn`: the cells
     whose centres lie beyond the runner's length less the port's; Rust: the same loop). Those cells gain
     q = h (Tw - T) per unit wall area in `stepPipe` (`dt hp pi D (Twp - T)` in place of Reynolds' analogy; friction
     unchanged; the exhaust port's term, now over the cells npa..np-1: npa = 0 for an exhaust port, so its arithmetic is
     unchanged).
   - h = Nu k / D, Nu = 0.0694 Re^0.75 (Depcik and Assanis 2002, intake, the default; `e.portInHeat` 'shayler' 0.135
     Re^0.713, 'bauer' 0.140 Re^0.66; constants as tabulated by Rahman et al. 2011, H2; OpenWAM's intake pipes also use
     Depcik-Assanis, part 1 section 3 e). Re = 4 m / (pi D mu) with m the cylinder's mean net intake-valve inflow over the
     last cycle (runner side, air) x rpm / 120 (`cy.inN`), mu and k by Sutherland's law (part 7's constants) at that
     inflow's mass-averaged stagnation temperature (`cy.inM`, `cy.inH`, `cy.inX`); h held for the next cycle, 0 on the first.
     The correlation is time-averaged (like the exhaust port's), so it also acts on air standing in the port while the
     valve is shut. Depcik and Assanis's stated range ends at Re 4 x 10^4; the V8 runners reach 6-7 x 10^4 at full load:
     extrapolated (stated on the page).
   - Tw = `e.portInTw`, else 360 K (the coolant of Heywood's Fig. 12-1; ASSUMPTION, H2).
   - Legacy: `e.portInHeat` false or 'off', or no intake segment marked, gives the model before part 8 bit for bit (H7).
2. The page: "Of that, the intake port in the head, valve to manifold flange" on the 4-Stroke tab under the runner length
   (blank by default: nothing changes); a typed length becomes the runner's last segment, marked (`simSpec`); longer than
   the runner is refused (`simCheck`). The turbo plan takes the 4-Stroke tab's intake, so it inherits the mark. The
   method text states the law, its source, its size and its limits, and this part's findings in plain words.
3. The comparison (`ratings.js`, labelled inputs; none on by default): `portIn=m|ls3cc` (the runner's last part marked as
   port; ls3cc = 182.5 mm from the LS3's published 260 cc), `amb=j1349` (intake.source 99 kPa / 298.15 K, tails 100 kPa),
   `exdp=Pa` (a tail exit restriction losing exdp at the rated flow, ~ flow squared), `acckw=kW` (accessory power off the
   brake; not used in the tables: no sourced figure). `ve_decomp.js` (new) and `turbo_portin.js` (new); `lib.js` exposes
   the intake valve's runner-side flow to hooks and can apply experiment-only patches (`WS_PATCHES`, used for the premixed
   fuel run only; the page is never modified).

### H6 Before and after

(a) GM ratings, whole engines, 19 speeds (`ratings_report.py h_legacy h_port h_asrated`; h_legacy is the page after part 8
with no intake port marked, identical to part 7's `g_final` in every row, VE, IMEP, gross IMEP, tEx, pmax and brake):

| engine | rating | part 7 (= h_legacy) | + intake port law on the stock port (h_port) | + J1349's air: as rated (h_asrated) | VE at the rated torque speed: part 7 -> as rated (referred to 101.325 kPa) |
|---|---|---|---|---|---|
| LS3 | 425 lb-ft @ 4600, 430 hp @ 5900 | 478 @ 5000 (+13 %), 499 hp @ 5800 (+16 %) | 473 @ 5000 (+11 %), 494 @ 5800 (+15 %) | **459 @ 5000 (+8 %), 479 @ 5800 (+11 %)** | 1.051 -> 1.017 |
| LS7 (cam assumed) | 470 @ 4800, 505 @ 6300 | 543 @ 5000 (+16 %), 549 @ 5800 (+9 %) | 537 (+14 %), 544 (+8 %) | **522 @ 5000 (+11 %), 528 @ 5800 (+5 %)** | 1.085 -> 1.050 |
| LT1 (cam assumed) | 460 @ 4600, 455 @ 6000 | 479 @ 4800 (+4 %), 480 @ 5600 (+5 %) | 473 (+3 %), 475 (+4 %) | **460 @ 4800 (-0 %), 461 @ 5600 (+1 %)** | 1.051 -> 1.015 |

The VE curves are in results/ratings_h_*.json (rows[].ve); peak VE LS3 1.095 -> 1.060, LS7 1.092 -> 1.058, LT1 1.076 ->
1.041 (all at 5000 rpm). The torque peaks stay 200-400 rpm late (the runner, H1).

LS3 as rated, one more change at a time (`ratings_h_s_*.json`; inputs of unpublished size, not defaults):

| one change on h_asrated | brake torque | brake power | net bracket (net - tfmep) | VE at 4600 |
|---|---|---|---|---|
| none | 459 @ 5000 (+8 %) | 479 @ 5800 (+11 %) | 434 / 439 | 1.017 |
| tail restriction 30 kPa at rated flow | 443 @ 5000 (+4 %) | 465 @ 6000 (+8 %) | 415 / 419 | 0.987 |
| tail restriction 50 kPa | 436 @ 5000 (+2 %) | 452 @ 5800 (+5 %) | 402 / 401 | 0.976 |
| air filter 2.5 kPa at rated flow | 446 @ 5000 (+5 %) | 459 @ 5800 (+7 %) | 421 / 420 | 0.999 |
| check lift at the tappet (H3) | 453 @ 5000 (+7 %) | 497 @ 6200 (+16 %) | 434 / 460 | 0.997 |
| filter 2.5 kPa + tail 30 kPa | 431 @ 5000 (+1 %) | 446 @ 5800 (+4 %) | 403 / 402 | 0.972 |

(b) The turbo case, K24A2 + PT5862 (`turbo_portin.js`, results/turbo_portin.json, the page's WebAssembly): the page's plan
has no intake port marked, so its results are those of part 7 to the last digit (closure area 1185.32 mm2, mean p3 0.406
/ 0.770 x boost at 3500 / 6600 rpm, T3 940 / 1013 C, turbine work 29.2 / 60.9 kW, calibration efficiency 0.421 / 0.340 /
0.296 at 1.0 / 1.5 / 2.0 x boost: the same numbers as results/turbo_port.json's first case). With an ASSUMED 100 mm intake
port (Depcik-Assanis): VE 2.402 -> 2.394 / 2.660 -> 2.653 (-0.3 %), air 195.3 -> 194.7 / 407.7 -> 406.7 g/s (the simulated
cylinders), NMEP 35.54 -> 35.43 / 37.02 -> 36.93 bar, closure area 1185 -> 1182 mm2, calibration efficiencies 0.421 /
0.340 / 0.296 -> 0.422 / 0.340 / 0.296. The intercooled charge (337 K) is close to the 360 K wall, so the port does little.

(c) Run time: ratings.js whole engines, three engines x 19 speeds: 214 s (no port), 214 s (port), 217 s (as rated);
part 7 214 s for the same job (71-73 s per engine). Unchanged.

### H7 Verification

- Legacy: ratings.js without `portIn` (h_legacy) equals part 7's g_final in every printed and stored field; every job of the
  page captured in web/tests/fixtures/wave_jobs.json, run on the page before part 8 (commit 18fe321) and after, identical in every result (VE, IMEP, gross IMEP, tEx, pmax, pEvo) at their first three speeds, all 9 variants;
  wavegas_ui.js 13 d: the port marked with `e.portInHeat` 'off' = no port, to the last digit.
- `kat.js` 66 of 66, results/kat.json byte-identical; `constref.js` 112 constant-gamma speeds identical.
- `web/tests/wavegas_ui.js` 13 (new, 7 checks): the three correlations' constants and the 360 K default; h by hand (0.045
  kg/s, 310 K, 42.6 mm: Re 71015, Nu 301.9, h 191.5 W/m2 K); an unknown law refused; the port cells (18..29 of 30 for a
  120 mm port at the runner's bore, the whole last pipe at its own bore); after a 6000 rpm run, the port's h equals the law
  evaluated in the test at the last cycle's measured net inflow (31.45 g/s) and mass-averaged stagnation temperature
  (303.3 K) to 1e-9; one cycle's mass and total-energy residuals 7.7e-16 and 1.6e-14 of the heat released with the port's
  2.80 J into the charge as a source (the pipe law would put 0.75 J into the same cells); the legacy switch.
- `web/tests/wave_wasm.js`: three intake-port jobs added (100 mm at the runner's bore on the plenum with the exhaust port,
  the default law; the same with open runners and the constant gas; a single cylinder's 90 mm port of its own bore,
  Shayler at 380 K): JS and Rust/WebAssembly identical to the last digit; nothing removed or loosened.
- `web/tests/cam_ui.js`: three checks added (a typed intake port reaches the spec marked, a port longer than the runner is
  refused, none typed gives one segment as before).
- OpenWAM cross-check configurations (part 1's matrix): their specs mark no intake port, so the wave side is unchanged
  (covered by the identity above); OpenWAM itself was not run (no build here; nothing on its side changed).
- Conservation: wavegas_ui.js 13 c above; energy_balance.js and the suite's wavegas_ui 6, 11, 12 unchanged.
- Suite (`python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`, 2026-11-13, part 8): 130 tests, 123
  passed, 0 flaky, 0 failed, 7 skipped, 7 partial skips (all expected: no host build, no OpenWAM build in the worktree, F-100
  runs absent), 0 unexpected, 1330 s (wave_wasm 354 s, wavegas_ui 48 s, cam_ui 7 s). `cargo test --release` in rust/et_wave
  builds (0 tests in the crate; its parity is wave_wasm.js). A fresh `tools/build_wave_wasm.sh` leaves the embedded
  WebAssembly byte-identical.

### H8 What remains unexplained, and what was not done

- As rated, LS3 +8 % torque / +11 % power and LS7 +11 / +5 % (its cam assumed) remain. Inside what the unpublished stock
  pieces can do (a 2.5 kPa air cleaner and a 30 kPa exhaust restriction: +1 / +4 %), but those sizes are guesses, so this
  part does not claim the gap is closed. The LT1 sits on its rating (0 / +1 %), with an assumed cam and its direct
  injection (in-cylinder evaporation cools the charge; not modelled) and phaser not modelled.
- The largest single lever is still the runner length (H1: 100 mm -21 %, 450 mm +7 % at 4600 rpm), not published for these
  engines (part 4 D8). With the stock port's 182.5 mm inside the 300 mm assumed, the manifold's runner would be 117.5 mm,
  against the 7.25 in (184 mm) a forum member measured "rather crudely" on an LS7 manifold (part 4 D8): if the real runner is
  longer than 300 mm, the torque peak moves toward the rating's 4600 rpm and peak torque rises (part 3: 350 mm +2.5 %,
  450 mm +9 %), which would widen the torque surplus, not close it; not changed (unknown).
- The residual (2.5-4.0 %) is below the 6.3 % the Fox-Cheng-Heywood form gives at p_e = p_i; most of the difference goes
  with the open long-tube headers (H4); a stock "shorty" manifold exhaust was not modelled (its geometry is not published).
- The friction law (Heywood's 1980s four-cylinder fit, B4) and the accessories of a net rating were not changed: no
  sourced figure for these engines.
- Charge heating by the hot intake valve's back face is not separated from the port's wall (one wall temperature); the
  heating of the manifold runner (outside the head) stays on the pipe law at 320 K.
- The 0.050 in convention of GM's card and the real lobe shape (H3) are open.

### H9 Summary rows (section 6, as of 2026-11-13, part 8)

| Difference | Status | Evidence |
|---|---|---|
| VE above the ratings' 0.91-0.97 | taken apart: the 300 mm runner's ram holds the charge at 1.23-1.30 atm at 4600-5800 rpm, heated to 365-379 K; valve flow, fuel vapour and in-cylinder wall heat each under 1.5 % | H1, H4 |
| Intake port heating | was the runner's pipe law (1.8-3.1 x below published intake-port correlations); added: Depcik-Assanis toward a 360 K wall where a port is marked; LS3 stock port -1.0 to -1.3 % torque | H2, H5 |
| The rating's air | J1349's 99 kPa dry air against the model's 101.325 kPa: -2.8 to -3.0 % of brake torque; a comparison input | H2, H4 |
| Against real ratings, as rated | LS3 +8 / +11 %, LS7 +11 / +5 %, LT1 0 / +1 % (part 7: +13 / +16, +16 / +9, +4 / +5 %) | H6 |
| Stock air cleaner, exhaust, accessories | not published; inputs (fdp=, exdp=, acckw=); 2.5 kPa + 30 kPa would leave LS3 +1 / +4 % | H4, H6 |
| Flow-bench conversion | the standard compressible orifice law; correct | H3 |
| Cam check lift (valve or tappet) | open; at the tappet the LS3's curve moves up the range, the surplus does not fall | H3 |

### H10 How to rerun (additions)

```
node tools/validation/wave/ve_decomp.js tag=h_base engines=ls3,ls7,lt1      # the factor table, ~1.5 min
node tools/validation/wave/ve_decomp.js tag=h_final engines=ls3,ls7,lt1 portIn=ls3cc amb=j1349
node tools/validation/wave/ve_decomp.js tag=h_pin portIn=ls3cc              # and amb=, fdp=, exdp=, back=, inTw=, chk=tappet, fuel=air, intakeL=, flow=
WS_PATCHES=tools/validation/wave/results/patch_premix.json node tools/validation/wave/ve_decomp.js tag=h_premix fuel=premix
node tools/validation/wave/ratings.js tag=h_asrated intake=plenum flow=benchfam portIn=ls3cc amb=j1349   # ~3.6 min
python3 tools/validation/wave/ratings_report.py h_legacy h_port h_asrated
node tools/validation/wave/turbo_portin.js                                   # ~2 min
node web/tests/wavegas_ui.js                                                 # 13: the intake port law
```

## Addendum 2026-11-13, part 9: the turbine's size from the housing picked (published flow, predict mode)

Question (part 6, F4; parts 7-8 ruled out the exhaust's energy as the main cause): the closure sizes the turbine as the
largest nozzle that makes full boost at the typed full-boost RPM with the gate shut, and at the default (K24A2 + PT5862,
75 %, 3500 rpm) the time-mean pressure before it at peak power is 0.77 x boost (total; 0.62 x static) against logged street
figures of 1.5-2 x. Does sizing the turbine from the actual wheel and housing remove the gap? Method: read what the makers
publish about turbine flow; convert it to the model's equivalent nozzle; add a mode that holds that area and PREDICTS the
boost threshold, the gate's share and p3; run the owner's build and a generic four through it. The wave engine (wsFactory,
et_wave, the WebAssembly) is not changed: parity holds by construction; everything is in the driver around it.

### I1 Published turbine flow (read 2026-11-13; numbers stated in text only, no map image read or digitised)

| source | what it gives |
|---|---|
| Garrett, G40 launch article (garrettmotion.com/knowledge-center-category/racing-and-performance/garrett-performance-product-launch-g-series-g40-900-g40-1150) | "G40 1.19 A/R has a max flow of 43 lbs/min"; "the GTX4088R 1.19 A/R peaks at 37lbs"; "16% increase in peak turbine flow"; "Max turbine wheel efficiency of the G40 turbine wheel is 76% compared to the GTX4088R at 66%"; wheel 77 / 70 mm, 84 trim. No reference state or expansion ratio. |
| Garrett G25-660, G30-770, G35-900, G-Series II G30-825 product pages (garrettmotion.com/racing-and-performance/performance-catalog/turbo/...) | turbine flow map and "exhaust flow chart" as images only; text: "flows 15-20% more than GTX" (G25, G35) / "5% more" (G30) "and has peak efficiency of 74%"; wheels 54/49, 60/55, 68/62 mm. |
| Garrett Turbo Tech 103 (garrettmotion.com/wp-content/uploads/2018/06/Turbo-Tech-103.pdf and 2019/10/GAM_Turbo-Tech-103_Expert-1.pdf); G-Series II installer guide (2025/03) | compressor only; no turbine flow. |
| MotoIQ, "Turbo Tech: Compressor and Turbine Map Details" p. 3 (Turbo by Garrett) | "Corrected turbine mass flow is a function of actual mass flow divided by turbine pressure ratio" (no units); "the exhaust manifold pressure is one bar higher than the intake manifold pressure" (a street sizing rule). |
| MotoIQ, GTX Gen2 calculation p. 2; Nerd-O-Scope G-series p. 2 | "we assumed 70% as 72% is the maximum stated on the map" (GTX3071R); "stated peak efficiency of 69%" (GT/GTX28), "74%" (G25). |
| BorgWarner performance catalogue (turbozentrum.de copy, the page's BWCAT), Match-Bot example p. 17 | a matching tool's output, engine unnamed: "Turbine Corrected Flow @ 59F lb/min 9.2 15.2 18.4 19 20.2 20.5", "Exhaust Manifold Pressure psi 3.2 6.6 10.9 14.4 17.7 21.4", "Engine Delta Pressure (dP) psi 2 3 4 3 -1 -4", "Wastegate Flow Area @ CF=0.8 in2 0.03 ... 1.11": the label fixes BorgWarner's reference temperature (59 F), not Garrett's. |
| Precision Turbo, PT5862 page (precisionturbo.com/p372175-...) | "a 62mm CEA turbine wheel" and an A/R list; no turbine flow in text; the data-sheet map is an image. |
| BorgWarner EFR 7064 data sheets (turbozentrum.de, shop.strato.de copies) | no turbine flow in text. |
| Not read (blocked or not on the allowlist, not worked around): riunet.upv.es (Payri et al.), MotoIQ GTX Gen2 p. 3, Watson and Janota, Heywood ch. 6. | |

So: one library housing is PUBLISHED (Garrett G40-1150 1.19 A/R T4, 43 lb/min, basis unstated), none SCALED (no published
pair of A/Rs on one wheel; the page does not assume capacity in proportion to A/R), the other housings of the 22 turbos
UNKNOWN (table I6). For the K24 + PT5862: **no citable turbine flow figure exists for its turbine or any of its housings.**

### I2 The conversion (page `turbAreaFromFlow`, `nozPsi`)

A map's corrected flow Wc = m sqrt(T03 / Tref) / (p03 / pref) gives the flow parameter m sqrt(T03) / p03 = Wc sqrt(Tref) / pref.
The equivalent nozzle (NASA Glenn, "Mass flow choking") passes m = A p03 psi(p4/p03) / sqrt(R T03), so

    A = Wc sqrt(Tref) / pref x sqrt(R) / psi(1/ER),   psi_choked = sqrt(g) (2/(g+1))^((g+1)/(2(g-1)))

at g 1.3, R 287 J/kg K (the page's flow-parameter convention). Worked: 43 lb/min = 0.3250745 kg/s; x sqrt(288.15) = 16.97498,
/ 101325 Pa = 5.44598e-5 kg sqrt(K)/(s Pa) (5.446 kg sqrt(K)/(s bar)); psi_choked = 1.140175 x 0.585234 = 0.667262;
A = 5.44598e-5 x 16.94107 / 0.667262 = 1.38267e-3 m2 = **1382.7 mm2 (2.143 in2)**. Sensitivities (`turbine_cap.js conv`): at
ATP's 85 F / 13.95 psia 1492.7 mm2 (+8 %); at g 1.35 1364.5 mm2 (-1.3 %). GTX4088R 1.19 A/R, 37 lb/min: 1189.7 mm2.
Caveat stated on the page: one nozzle is choked by an expansion ratio of 1.83 (g 1.3) and passes 99.6 % of its peak at 1.7,
while a radial turbine's corrected flow keeps rising to much higher ratios; an area from the PEAK therefore overstates the
flow at the 1.5-2.5 a street engine runs. The input takes the expansion ratio the value was read at; read it there.

### I3 What was built

- `turboSimLib.predict` (page JS, either back end): the area held; at each speed the gate shut at full boost first; if the
  turbine makes more than the compressor needs, the gate's area that balances (the closure's search, now the shared
  `secant`, the same steps as before); if less, the boost it can hold: the charge a fraction s of the way to full boost at
  which the shut-gate turbine drives the compressor (secant in s in [0, 1], a fresh engine at each try). The charge below
  full boost (`tsimRun` boostAt): the compressor's ratio scaled with the charge pressure (losses in proportion to density),
  its efficiency from the route's own outlet temperature (compOut's law; 0.700 for the K24 route), the intercooler's
  effectiveness the route's (0.75) - approximations, stated on the page. Full-boost RPM: the zero of ln(W/Wc) with the gate
  shut at full boost, linear between speeds. Speeds: 1500 rpm below the typed full-boost RPM (not below 2000) to the redline.
- `turboSimLib.calibrateA`: a measured static p3 at the full-boost RPM with the area known: the gate's area that gives it,
  then the efficiency that balances (eta Wc / W); if the shut gate already leaves the face below the measurement, the page
  says the measured turbine flows less than this one and falls back to part 6's calibration (area found).
- Steady path (`turbineAreaBalance`): the same nozzle law and turbineBalance's work law; p3 from W(p3) = Wc by bisection,
  the gate share 1 - m_t/m_e, or short when all of the exhaust is not enough. Shown at peak and at the full-boost RPM under
  "Turbine size from the housing you picked"; at its p3, turbineBalance returns the same share (to 1e-9, turbine_ui 3).
- Inputs (Intake tab, advanced): "Turbine flow off the maker's turbine flow chart" (value; unit: lb/min corrected at 59 F /
  14.696 psia, kg/s at 15 C / 101.325 kPa, lb/min at 85 F / 13.95 psia, kg/s sqrt(K)/kPa, lb/min sqrt(R)/psia; the expansion
  ratio it was read at, blank = peak, choked). Precedence: typed area > typed flow > published housing flow > found.
- Turbo options' housing table: a "Turbine flow capacity" column (PUBLISHED with its area, or UNKNOWN with what to do).

### I4 The owner's build: K24A2 + PT5862 0.63 T3 (`turbine_cap.js k24`, part 5's plan, 75 % unless stated; brake here on
the net - tfmep basis of part 5 for comparison; the page's brake is part 6's)

| turbine area mm2 | eta | full boost (steady) rpm | boost at 3500 kPa | p3 at 3500 x boost | p3 at 6600: total / static / peak x boost | gate share at 6600 | hp at 6600 |
|---|---|---|---|---|---|---|---|
| 1185.4 (part 5's closure) | 0.75 | 3499 | 169.9 | 0.41 | 0.770 / 0.620 / 1.085 | 33.0 % | 571 |
| 1383 (G40-1150 1.19's published peak, comparison only) | 0.75 | 3947 | 98.5 | 0.35 | 0.685 / 0.520 / 0.998 | 26.8 % | 573 |
| 1000 | 0.75 | 2963 | 169.9 | 0.46 | 0.876 / 0.741 / 1.186 | 38.8 % | 568 |
| 800 | 0.75 | 2305 | 169.9 | 0.55 | 1.036 / 0.919 / 1.325 | 45.3 % | 561 |
| 600 | 0.75 | <= 2000 | 169.9 | 0.70 | 1.285 / 1.189 / 1.594 | 52.0 % | 547 |
| 450 | 0.75 | <= 2000 | 169.9 | 0.88 | 1.596 / 1.517 / 1.961 | 57.4 % | 529 |
| 800 | 0.65 | 2747 | 169.9 | 0.62 | 1.159 / 1.053 / 1.433 | 40.8 % | 554 |
| 600 | 0.65 | 2175 | 169.9 | 0.78 | 1.434 / 1.347 / 1.781 | 47.8 % | 538 |

Read:
- The predict mode reproduces the closure exactly where they should agree (1185.4 mm2 -> full boost 3499 rpm, 0.770 x,
  33.0 %: part 5's 0.770, 33.0 %). Monotonic as physics requires: a larger turbine (larger A/R) reaches full boost later
  and runs a lower p3 and a smaller gate share at peak.
- **The K24 + PT5862 is unchanged on the page** (before = after: 1185 mm2 found, 0.77 x total, 589 hp page brake), because
  no flow is published for any of its housings: the page now says so plainly in the sizing section, in "what the run takes"
  and in the housing table, and offers the chart reading as the way to use the actual housing.
- The comparison is telling but not the PT5862's data: the area the closure needs for full boost at 3500 rpm (1185 mm2)
  equals the PUBLISHED peak capacity of Garrett's GTX4088R 1.19 A/R (1190 mm2), a 77-mm-class turbine for far more power
  than a 62 mm wheel on a 0.63 housing. A 0.63 A/R 62 mm turbine is very probably smaller. In this model a smaller turbine
  does raise p3 toward the logs: 1.5 x boost (static, the tap's reading) at peak power needs about 450 mm2 at 75 % or roughly
  500-550 mm2 at 65 % (between the 600 mm2 run and an extrapolation) - but such a turbine reaches full boost below 2000 rpm here, which is not what K24s with turbines of this
  size do (no cited spool figure for this pairing; Garrett's GTX3076R on a 1.9 L Honda reached "full spool" at 5,250 rpm on
  a dyno, as on the page). So sizing the turbine by its housing does not, in this model, give both the logged p3 and a
  realistic spool: the turbine still gets more work per kg of exhaust than a real one (a quasi-steady nozzle using every
  pulse at full efficiency, no housing heat loss, the model's hot exhaust of part 2, a peak-flow area at low expansion
  ratio). The size hypothesis is necessary but not sufficient; the remaining gap is the turbine's on-engine work.
- What removes the guess for the owner: (a) a pre-turbine pressure log at one RPM (a tap at the flange; already supported:
  with an area known the run finds the gate and the efficiency, without one the area and the efficiency); (b) the value
  read off Precision's turbine flow chart for the 0.63 T3 housing, at the expansion ratio the engine runs; (c) the RPM at
  which full boost arrives on a pull, which the existing mode already uses: physically sound as a quasi-steady point only
  for a slow sweep; a pull reaches full boost later than steady by the spool-up time, more in lower gears, so the area found
  from a pull's RPM is an upper bound and p3 a lower bound (said on the page). A gear input was not added: a gear does not
  enter a steady model, and no source read gives the turbo's inertia to turn a sweep rate into a lag.

### I5 Validation: generic four, the two published Garrett turbines (`turbine_cap.js generic`, steady, 6500 rpm, VE 0.95,
50 C charge, compressor 70 %, 10 kPa loss, AFR 12, 950 C, no back pressure)

| turbine (published peak) | area mm2 | 2.0 L, 1.0 bar | 2.0 L, 1.5 bar | 2.4 L, 1.0 bar | 2.4 L, 1.5 bar |
|---|---|---|---|---|---|
| G40-1150 1.19 A/R (43 lb/min) | 1382.7 | p3 0.49-0.54 x, gate 3-8 % | 0.49-0.55 x, 5-11 % | 0.56-0.63 x, 13-18 % | 0.57-0.65 x, 15-20 % |
| GTX4088R 1.19 A/R (37 lb/min) | 1189.7 | 0.55-0.62 x, 11-16 % | 0.56-0.63 x, 14-18 % | 0.64-0.72 x, 21-25 % | 0.65-0.74 x, 22-27 % |

(range over turbine x mechanical efficiency 0.76-0.66, Garrett's stated peaks.) These are large race turbines on a small
engine and the prediction is below 1 x boost, which is what HP Academy describes for very large turbines (part 6) and the
opposite of the 1.5-2 x street logs, which come from much smaller turbines. No published engine was found with both the
turbine's flow and a measured p3 (or boost threshold), so this is the only validation available, and it is qualitative:
the model's direction is right, its absolute level cannot be checked against a measurement.

### I6 The library's turbine capacity

| turbo | housings | status |
|---|---|---|
| Precision PT5558, PT5862, PT6062, PT6266, PT6466 | all listed | UNKNOWN (no turbine flow in text; data-sheet maps are images) |
| Garrett G25-550, GTX2867R GEN II, G25-660, GTX3076R GEN II, G30-770, GTX3582R GEN II, G35-900, G35-1050, G42-1200 | all | UNKNOWN (flow charts are images; text gives only "15-20 % / 5 % more than GTX") |
| Garrett G40-1150 | 1.19 A/R T4 divided | PUBLISHED: 43 lb/min peak, basis unstated -> 1383 mm2 at 59 F / 14.696 psia, choked |
| Garrett G40-1150 | 0.85, 0.95, 1.06 (T4), all V-band | UNKNOWN (no published pair to scale from) |
| BorgWarner EFR 6758, 7163, 8374, 9180 | all | UNKNOWN (catalogue and data sheets: no turbine flow in text) |
| BorgWarner AirWerks S200SX-R, S300SX-R 64 / 68 | none listed (super-cores) | no housing |

### I7 Tests, pinned values, verification

- `web/tests/turbine_ui.js` (new; Node + Playwright, 23 checks, about 3 minutes): the conversion by hand (5.4460 kg
  sqrt(K)/(s bar), 1382.7 mm2; ATP basis 1492.7; five units agree to 1e-12); the nozzle function against NASA's Mach form
  (choked and unchoked, 1e-12); the steady balance against turbineBalance (1e-9) and the short case; the predict mode on
  the K24 plan: part 5's 6600 rpm row reproduced (0.7701 / 32.97 %), 800 against 1383 mm2 (full boost 2500 (first) / 4067
  rpm, p3 1.036 / 0.685 x, gate 45.3 / 26.9 %), the steady balance at the run's own flow and T3 within 1.6 % of the run's
  p3 gauge and 1.4-1.8 points of its gate share; the page: capacity column, fallback wording and the pull caveat, 20 lb/min
  typed -> 643.10 mm2 by hand, the steady table in kPa and psi, the step-by-step and build-sheet rows, a predict-mode run.
- Pinned values changed: none. turbosim_ui, turboaudit_ui, waveturbo_ui, turboar_ui, turbolib_ui, turbosize_ui,
  boostaudit_ui/2/3, turboguide_ui, sheet_ui, k24_ui, turbomani_ui pass unchanged (the K24 default has no housing flow, so
  it takes the old path; the closure's secant was moved out of the closure with the same steps).
- Solver, Rust, WebAssembly: not changed.
- Suite (`python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`, 2026-11-13, part 9): 131 tests,
  124 passed, 0 flaky, 0 failed, 7 skipped, 7 partial skips (all expected), 0 unexpected, 1431 s.

### I8 Not done, unknown

The PT5862's turbine flow (not published); turbine maps beyond one nozzle (a flow that keeps rising with expansion
ratio, Payri et al.'s variable area); the turbine's on-engine efficiency under pulsing flow (no number in any source
read); turbo inertia and transient spool; any measured engine with turbine flow and p3 together.

### I9 How to rerun

```
node tools/validation/wave/turbine_cap.js          # ONLY=conv|k24|generic; k24 about 6 min
node web/tests/turbine_ui.js                       # from web/, about 3 min
```

## Addendum 2026-11-13, part 10: the turbine's efficiency through the pulse (blade speed ratio), bearing loss, housing heat, compressor off its island

Question (part 9, I4): with a constant 75 % turbine efficiency the model says that a turbine small enough to give the
logged 1.5-2 x boost before the turbine (about 450 mm2 on the K24) reaches full boost below 2000 rpm, which no real
62 mm-class turbo does, and the area that gives a realistic spool (1185 mm2) equals the published capacity of a much
larger turbine. Five candidate reasons were tested with published forms and constants only, nothing tuned to a log:
A the efficiency is not constant but follows the blade speed ratio U/C0; B it must be applied to the instantaneous
expansion of each pulse, not to the cycle mean; C bearing friction; D heat lost in the turbine housing before the rotor;
E the compressor's efficiency at low flow and high pressure ratio.

### J1 Sources read (2026-11-13; text only, no map image read or digitised)

| source | what it gave |
|---|---|
| NASA SP-290, Glassman (ed.), "Turbine Design and Application" (1994), ntrs.nasa.gov/api/citations/19950015924/downloads/19950015924.pdf | ch. 2, p. 48, eq. 2-71: jet (spouting) speed "corresponding to the ideal expansion from inlet total to exit static conditions", V_j^2 = 2 g J dh_id; eq. 2-70/2-72 nu = U / V_j; pp. 49-51, eq. 2-88: for an ideal impulse stage eta = 4 nu sin(a1) - 4 nu^2, a parabola with its optimum at nu = sin(a1) / 2 (so eta / eta_max = 2 r - r^2, r = nu / nu_opt); p. 52: blade-jet speed ratio "a very good correlating parameter" for real turbines. ch. 10 (radial inflow), p. 302: the variation with blade-jet speed ratio "is very similar to that for an axial-flow turbine", the decrease from the peak "slightly more rapid". (The radial optimum's figure 10-11 is not legible in the text; no 0.7 is printed in the parts read.) |
| Luddecke, Filsinger, Ehrhard (IHI), "On Mixed Flow Turbines for Automotive Turbocharger Applications", Int. J. Rotating Machinery 2012, 589720 (abstract via doaj.org/article/3eff1c8cd6514b36b9ea8495b7ae1fb6; the full text's host was not on the allowlist and was not worked around) | "radial turbines provide peak efficiency at speed ratios of 0.7"; at high pressure ratio and low speed "the blade speed ratio will be low" |
| Morrison, Spence, Kim, Filsinger, Leonard, International Turbocharging Seminar 2016 (core.ac.uk/download/74406752.pdf) | the velocity ratio "represents the relationship between blade tip velocity and flow isentropic sprouting velocity"; for radial turbines "peak efficiency is typically achieved at the relatively high velocity ratio of 0.7" |
| OpenWAM (CMT-Motores Termicos, open source), Source/ODModels/TTurbinaSimple.cpp lines 312-348 (local copy) | the standard quasi-steady treatment in a 1-D engine code: at every time step the blade speed ratio from the inlet's stagnation state, BSR = N pi D / sqrt(2 (h0 - h_is)); "nmWatson": eta = 0.004022 + 1.55766 x - 0.511626 x^2 - 0.121795 x^3 - 0.445804 x^4 for 0 < x < 1.19, else 0, times an adjustment factor (FAjustRendTurb); "nmPolinomio": a cubic through 0 with its peak at a given optimum and zero at a given maximum ratio |
| Pakle and Jiang, "Design of a high-performance centrifugal compressor with new surge margin improvement technique for high speed turbomachinery", Propulsion and Power Research 2018 (research.birmingham.ac.uk/files/54164459/...pdf) | a turbocharger compressor "targeted for turbochargers applicable to 1.6 - 2 liter diesel engines": "a tip speed of 427 m/s having 44 mm exducer diameter", "polytropic efficiency 92% and total pressure ratio 2.5 has been taken as design point attributes", "2.5 total pressure ratio and 18 lb/min mass flow rate at 185 kRPM"; CFD "peak efficiency around 87% at 110 kRPM"; "stage efficiency can be about 81%" with the volute; its eq. 2 the backswept work input I_B = sigma (1 - lambda C_m2 cot(beta2) / U2) |
| Deligant, Podevin, Clenci, "Mechanical Power Losses of Turbocharger at Low Speeds", Univ. Pitesti Scientific Bulletin, Automotive series XVI no. 20 (www.automotive.upit.ro/index_files/2010/2010_B_5_.pdf) | "mechanical efficiency is considered as a constant (0.8 to 0.9)" in common practice; at low speed "much lower"; at the crossing of air power and loss "mechanical efficiency is equal to 0.5"; "At lower speed more power is given to overcome friction than to compress air"; semi-floating journal bearings; the loss values are in figures only (not read) |
| MotoIQ, "Turbo Tech: Turbo Bearings" p. 3 (Turbo by Garrett), motoiq.com/turbo-tech-turbo-bearings/3 | "the thrust bearing alone can eat up over 1000 watts of power" (no speed); a ball-bearing turbo "spools up in 75% of the time of the journal bearing turbo" (a transient, not a steady loss) |
| Deligant, Podevin, Descombes, Energy 39 (2012) 388-394 (abstract only, ideas.repec.org) | friction measured on a torquemeter bench; no number in the abstract |
| Garrett Turbo Tech 103 (garrettmotion.com/wp-content/uploads/2018/06/Turbo-Tech-103.pdf) | compressor efficiency falls from the islands "until the surge and choke limits are reached"; choke "where the efficiency drops below 58%"; no speed-line numbers in text |
| Not readable or not found: Watson and Janota's book, GT-Power / Ricardo documentation (not open), HAL copy of Deligant et al. (bot check), the Hindawi full text (not on the allowlist), Precision's maps (images); no published shaft speed, work coefficient, bearing loss or turbine map for the PT5862; no reputable tuner page stating a full-boost RPM for a 62 mm-class turbo on a K24 (the forum and kit pages searched give boost and power but no RPM). | |

### J2 What the closure assumed for A-E before this part

| | before | where |
|---|---|---|
| A efficiency vs blade speed ratio | constant: the Intake tab's efficiency (75 % blank) at every moment and every speed; no shaft speed anywhere | `turbineFace` W = eta m_t dh_is; `turbineBalance`, `turbineAreaBalance` |
| B pulse | the work was already integrated step by step (W = sum eta m_t dh_is dt per cycle, an energy integral of the instantaneous flow), so a constant efficiency gave the same as an energy-weighted mean; the steady path uses the cycle-mean state | `turbAcc`, `turbSum` |
| C bearing loss | none beyond what the efficiency holds ("turbine x mechanical", part 6 F3) | closure `wc` |
| D housing heat | the turbine face is the last cell of the collector, after the runners' and collector's wall heat transfer at the Turbo manifold section's steel temperature (the K24: 794 C); the volute itself loses nothing. The steady sizing uses the typed TIT (950 C blank, Garrett's design figure), and the manifold skin model takes that TIT as its gas temperature: it gives the wall, not an outlet temperature | `tsimPlan` (Ts), `mfdCalc` |
| E compressor | one efficiency (the route's, 70 % for the K24) at every speed, at full boost and below it (`boostAt` holds the route's efficiency), i.e. the full-boost point at low RPM, near surge, is as efficient as peak power | `tsimPlan` comp, `tsimRun` boostAt |

### J3 What was built

- Engine (JS `wsFactory` and Rust `et_wave`, bit parity; WebAssembly rebuilt): `exhaust.turbine.bsr = {U, xo, form}`. At
  each step with forward turbine flow: x = U / sqrt(2 dh_is) (dh_is the same total-to-static isentropic drop as the work),
  eta_step = eta x f(x), f the parabola r (2 - r) with r = x / xo, held at 0 where negative, or Watson's polynomial / its
  peak 0.6951808461322609 (at x 0.71205), 0 outside 0 < x < 1.19 as OpenWAM. W = eta_step m_t dh_is; the gas after the
  turbine takes the rest (unchanged law). New output, appended to the turbine summary: the energy-weighted blade speed
  ratio xE = sum x m_t dh_is dt / sum m_t dh_is dt. Without `bsr` the expressions are the old ones: legacy bit for bit
  (turbineeff_ui 4 against values pinned from git 9301028; wave_wasm every existing job identical).
- Shaft speed (page `turboShaft`): Euler's work on the impeller, dh0 = mu U2^2, dh0 = cp (T2 - T1) of the route (the
  compressor's actual work), U2 = sqrt(dh0 / mu), N = U2 / (pi D_c2); the turbine's tip U = U2 D_t / D_c2 (one shaft).
  mu = 0.5227 from Pakle and Jiang's design point (PR 2.5 at 427 m/s, polytropic 92 %, inlet taken at 288.15 K: assumed):
  1004.675 x 288.15 x (2.5^(0.2857143 / 0.92) - 1) / 427^2. Wheel sizes from TURBO_LIB (PT5862: 76.2 mm compressor
  exducer, 71 mm turbine inducer, the dealer's listing). mu is held constant over flow (the Imperial group's SAE
  2017-24-0023: the loading coefficient at a given flow coefficient "is a weak function of speed"; its change with flow is
  not modelled). Below full boost (`boostAt`) U follows that charge's compressor work.
- Closure and predict mode: unchanged algorithms; the spec carries `bsr` (U at full boost; U(s) below it). The steady
  path in the same form: `turbineBalance` / `turbineAreaBalance` with `o.bsr` take the efficiency at the steady expansion
  ratio's x (constant cp at T3 as their work law); `turbineBalanceBsr` finds the all-exhaust expansion ratio by bisection
  (the work per kg grows with C0 for both forms). The Intake tab's "Turbine size from the housing you picked" table gains
  the ratio and efficiency column (`tsBsrSteady`).
- C as an option: "Bearing friction at the full-boost shaft speed" (W, blank none), added to the compressor's power, in
  proportion to N^2 below full boost (hydrodynamic shear: the Petroff form, torque in proportion to speed; with mu
  constant N^2 is in proportion to dh0). No default: no source read gives a number for this turbo at a speed.
- D, E: experiments only (J4); no page option (no sourced constants); the page says both are not modelled and points the
  owner to the surge line on "Your compressor map".
- Inputs (Intake tab, advanced): "Turbine efficiency through each exhaust pulse" (from the blade speed ratio, parabola:
  default; Watson; constant: the page before), "Compressor work coefficient" (blank 0.523), "Bearing friction". Default ON
  where the picked turbo publishes both wheel sizes; otherwise the constant efficiency, and the plan's row says why.

### J4 Worked numbers (`turbine_eff.js hand`; `turbineeff_ui.js` 1-2)

- Work coefficient: (2/7) / 0.92 = 0.3105590; 2.5^0.3105590 = 1.3291802; dh0 = 1004.675 x 288.15 x 0.3291802 = 95296 J/kg;
  mu = 95296 / 427^2 = **0.52266**.
- K24 + PT5862 at full boost (the page's plan: PR 2.810, T2 178.74 C, T1 30 C, dh0 = 149434.8 J/kg): U2 = sqrt(149434.8 /
  0.52266) = 534.71 m/s; N = 534.71 / (pi x 0.0762) x 60 = **134 017 rpm**; turbine tip U = 534.71 x 71 / 76.2 =
  **498.2 m/s** (1635 ft/s). (No maker's speed for this turbo was found to check it against.)
- A steady expansion at T3 1286 K (the page's exhaust gas: gamma 1.2766, cp 1322.8 J/kg K):

| expansion ratio | dh_is kJ/kg | C0 m/s | x = U / C0 | parabola f | Watson f |
|---|---|---|---|---|---|
| 1.3 | 94.02 | 433.6 | 1.149 | 0.589 | 0.226 |
| 1.6 | 164.74 | 574.0 | 0.868 | 0.942 | 0.918 |
| 2.0 | 237.26 | 688.9 | 0.723 | 0.999 | 1.000 |
| 2.3 | 280.94 | 749.6 | 0.665 | 0.998 | 0.993 |
| 2.8 | 340.21 | 824.9 | 0.604 | 0.981 | 0.967 |
| 3.5 | 404.45 | 899.4 | 0.554 | 0.957 | 0.931 |

  So at this shaft speed the turbine is near its optimum for the mean expansion of a street build (2-2.5) and loses most
  in the low-pressure tail of each pulse (ratio 1.3: x 1.15, 59 % of peak on the parabola, 23 % on Watson's), not at the
  pulse peak: the hypothesis "the shaft is slow against the pulse" is the wrong way round for this build, because the
  compressor sets the shaft speed and it needs full boost's work at every speed.
- Parabola: x 0.35 / 0.7 / 1.05 / 1.4 / 1.75 -> 0.75 / 1 / 0.75 / 0 / 0. Watson: 0.5 -> 0.611858375 / 0.6951808 = 0.88014;
  1.0 -> 0.482457 / 0.6951808 = 0.69400.
- The engine's moments (turbineeff_ui 3): with the parabola and no step clipped, W = eta [(2 / xo) xE Wis - U^2 / (2 xo^2)
  m_t] because dh_is x = U sqrt(dh_is / 2) and dh_is x^2 = U^2 / 2; the run gives 9.0140 kW both ways (U 420, xo 5).
- Bearing friction scaling: half way to full boost on the K24 the compressor's work is 60.2 % of full boost's, so 1000 W
  at full boost becomes 602 W; the tip 386.5 m/s against 498.2.

### J5 Controlled experiments (`turbine_eff.js`; the page's plan of the K24A2 + PT5862 0.63 T3, results/turbo_k24_page.json;
predict mode, speeds 2000-7100; brake on part 5's net - tfmep basis, so these compare with part 9's I4; one change at a time)

The illustrative values for the options without a sourced constant: C 1000 W at the full-boost shaft speed (MotoIQ /
Garrett: the thrust bearing alone "over 1000 watts", no speed); D a 0.2 m extension of the collector at its own diameter
and the manifold's wall temperature (794 C) standing for the volute's wetted path (about half the circumference of a
120 mm scroll; an assumption); E 62 % compressor efficiency instead of the route's 70 %, applied at every speed (so its
effect on the full-boost RPM, where the compressor is at low flow, is what it says; its effect at peak power overstates
an efficiency that falls only near surge).

| case | 600 mm2: full boost rpm | 600: p3 at 6600 static x boost | 1000 mm2: full boost rpm | 1000: p3 at 6600 static x boost |
|---|---|---|---|---|
| constant 75 % (before; legacy) | <= 2000 | 1.189 | 2963 | 0.741 |
| A parabola (default; mu 0.523) | 2086 | 1.233 | 3232 | 0.749 |
| A Watson | 2136 | 1.263 | 3330 | 0.756 |
| A parabola, mu 0.45 / 0.65 | 2115 / 2068 | 1.210 / 1.283 | 3289 / 3197 | 0.744 / 0.771 |
| C alone (1 kW) | 2034 | 1.207 | 3099 | 0.754 |
| A + C | 2169 | 1.253 | 3311 | 0.763 |
| D alone (0.2 m volute) | <= 2000 | 1.184 | 3056 | 0.738 |
| A + D | 2120 | 1.226 | 3263 | 0.746 |
| E alone (62 %) | 2149 | 1.315 | 3371 | 0.836 |
| A + E | 2286 | 1.348 | 3565 | 0.840 |
| A + C + D + E | 2362 | 1.358 | 3611 | 0.848 |

B, the pulse's own share (`turbine_eff.js pulse`; gate shut, full boost held, the same run read two ways: the work
integrated step by step with eta(x(t)), against eta at the cycle's mass-mean spouting velocity sqrt(2 Wis / m_t)):

| area | rpm | x mass-mean | x energy-weighted | eta step by step | eta at the mean | ratio |
|---|---|---|---|---|---|---|
| 600 mm2, parabola | 2500 / 3500 / 5000 / 6600 | 0.699 / 0.593 / 0.493 / 0.464 | 0.686 / 0.591 / 0.492 / 0.464 | 0.722 / 0.728 / 0.684 / 0.665 | 0.750 / 0.732 / 0.684 / 0.665 | 0.963 / 0.994 / 1.000 / 1.000 |
| 1000 mm2, parabola | same | 0.847 / 0.751 / 0.584 / 0.532 | 0.794 / 0.734 / 0.583 / 0.532 | 0.670 / 0.709 / 0.725 / 0.707 | 0.717 / 0.746 / 0.730 / 0.707 | 0.934 / 0.950 / 0.994 / 1.000 |
| 1000 mm2, Watson | same | 0.846 / 0.751 / 0.585 / 0.532 | 0.794 / 0.733 / 0.583 / 0.532 | 0.635 / 0.678 / 0.711 / 0.684 | 0.705 / 0.747 / 0.716 / 0.684 | 0.901 / 0.908 / 0.993 / 0.999 |

Read:
- A is real but small here: the cycle efficiency falls to 69-73 % at the full-boost RPM and 70-75 % at peak power (peak
  75 %), full boost moves 90-270 rpm later (parabola; 140-390 Watson) and p3 at peak power rises 0-5 %. The work
  coefficient's spread (0.45-0.65) moves full boost by 50-90 rpm: the result does not hinge on it.
- B: the model already integrated the turbine's work step by step (so with a constant efficiency it was exact for that
  assumption); the instantaneous efficiency matters only at low engine speed with a larger turbine, where the pulses are
  distinct: 3-10 % less work than the cycle-mean ratio would give, nothing above 5000 rpm (four cylinders on one
  collector, nearly steady flow at the turbine). So averaging would have hidden up to a third of A's effect at 2500-3500
  rpm, and none at peak power.
- C: 1 kW is 3-4 % of the compressor's power at full boost low down (about 28 kW at 3500 rpm); 30-140 rpm.
- D: a volute's extra wall changes little: the gas is already near the wall temperature's pull in the collector; the
  extra volume damps the pulses slightly (p3 lower, not higher); 0-90 rpm.
- E is the largest single lever: 8 points of compressor efficiency at low flow move full boost 150-400 rpm and p3 at
  peak 10-13 % (the latter overstated, see above). It is also the one with a hard limit the model lacks: near surge a
  real compressor cannot hold the pressure at all.
- All four together: full boost 360-710 rpm later at 600-1185 mm2, p3 at peak +14-16 %.

Generic four (`turbine_eff.js generic`, steady, part 9's case, G40-1150 wheels 88 / 77 mm, eta_max 0.76): the steady
expansion at peak power puts x at 0.66-0.75, so the efficiency is 75.5-76 % against 76 %, p3 and the gate's share
unchanged to 0.004 x boost and 0.2 points. The steady path agrees in form with the wave closure and confirms that the
curve matters through the pulses and at low speed, not at peak power in steady flow.

### J6 Part 9's question again: a 62 mm-class turbine on the K24, with the curve

No Precision turbine data exists in text (part 9, I1), so the area is a range. Predict mode, parabola (the page's
default), K24 + PT5862 plan; brake on the net - tfmep basis:

| turbine area mm2 | full boost rpm (before / now) | p3 at 6600 total / static x boost (static gauge) | gate at 6600 | hp at 6600 | cycle efficiency at 6600 | largest gate area mm2 |
|---|---|---|---|---|---|---|
| 450 | <= 2000 / <= 2000 | 1.672 / 1.598 (271.5 kPa, 39.4 psi) (before 1.596 / 1.518) | 55.7 % (57.4) | 523.8 (528.5) | 70.5 % | 581 @ 7100 (623) |
| 600 | <= 2000 / 2086 | 1.327 / 1.233 (209.6 kPa, 30.4 psi) (1.285 / 1.189) | 50.9 % (52.1) | 544.8 (547.1) | 72.0 % | 642 (674) |
| 800 | 2305 / 2576 | 1.054 / 0.939 (159.5 kPa, 23.1 psi) (1.036 / 0.919) | 44.6 % (45.3) | 559.8 (560.6) | 73.4 % | 674 (693) |
| 1000 | 2963 / 3232 | 0.883 / 0.749 (127.3 kPa, 18.5 psi) (0.876 / 0.741) | 38.5 % (38.8) | 567.2 (567.5) | 74.3 % | 659 (672) |
| 1185 | 3499 / 3695 | 0.773 / 0.623 (105.9 kPa, 15.4 psi) (0.771 / 0.620) | 32.8 % (32.9) | 570.9 (570.9) | 74.7 % | 622 (624) |

With everything (A + C + D + E at the illustrative values): 450 mm2 <= 2000 rpm, 1.748 static x; 600: 2362, 1.358;
800: 3016, 1.045; 1000: 3611, 0.848; 1185: 4058, 0.718.

The closure (the area found for full boost at a typed RPM, `turbine_eff.js closure`):

| full boost at | area: constant / parabola / Watson mm2 | p3 at 6600 static x boost: constant / parabola / Watson |
|---|---|---|
| 3500 rpm | 1185 / 1091 / 1053 | 0.620 / 0.681 / 0.713 |
| 4000 rpm | 1415 / 1339 / 1310 | 0.506 / 0.541 / 0.557 |
| 4500 rpm | 1622 / 1557 / 1534 | 0.427 / 0.448 / 0.459 |

Against the references:
- (a) the logged 1.5-2 x boost before the turbine (part 6, static, street builds): reached only by 450-500 mm2, which
  still makes full boost at or below 2000 rpm with or without the curve.
- (b) Garrett's street rule (MotoIQ, part 9): exhaust manifold about one bar above the intake: at 170 kPa boost, p3 about
  270 kPa gauge, 1.59 x boost: the same 450 mm2 class.
- (c) a full-boost speed of about 4000-4500 rpm for this class (the brief's figure; no reputable tuner source stating an
  RPM for a 62 mm-class turbo on a K24 was found this session; part 9's Garrett GTX3076R on a 1.9 L Honda: "full spool"
  at 5,250 rpm on a dyno): needs 1340-1560 mm2 with the curve, giving p3 0.45-0.54 x boost static at peak power, a third
  of the logs.

**The gap partly closes, and only a little.** The efficiency through the pulse is the right physics and is now in, but
it moves full boost 100-300 rpm and p3 by up to 5 %; with generous bearing loss, a volute and a poorer compressor at low
flow it reaches 360-710 rpm and 15 %, against the 2000+ rpm and 2-3 x in p3 the logs ask for. The remaining causes must
lie elsewhere; the candidates, none tested here for want of sources: (1) the compressor's surge line (a 58 mm wheel at
PR 2.8 below 3000 rpm is very likely left of it: the boost the model "holds" there is not available, whatever the
turbine); (2) transient spool on a pull (turbo inertia, part 9); (3) the turbine's flow capacity against expansion ratio
and speed (one equivalent nozzle chokes at 1.83, a radial turbine's flow keeps rising; Payri et al.'s variable area),
which would make a turbine whose peak area is small pass less at low expansion; (4) the model's hot exhaust (part 2, A6).

### J7 The K24 guidance, before / after (the page's default: no housing flow, so the closure finds the area for full boost at
the typed 3500 rpm; turbineeff_ui 6, the page's own run, page brake as part 6 F6)

- Turbine effective area 1185 -> **1091 mm2** (1.69 in2): a less efficient turbine low down needs a smaller one for the
  same full-boost RPM.
- Peak brake power 589 hp @ 7100 rpm -> **588.5 hp @ 7100** (after pumping loss; 439 kW).
- Pressure before the turbine at peak power 0.78 -> **0.84 x boost** mean total (**0.69 x** static), 1.10 x at the
  blowdown peak.
- Wastegate share at peak power 34.6 % -> **37.2 %**; the most the gate opens 627 -> **647 mm2** (1.00 in2), 28.7 mm
  (1.13 in) at Cd 1: the smallest listed valve whose seat holds it is still **38 mm** (TS_WG_MM; the Intake tab's own
  gate sizing at its assumed 2 x boost is unchanged: it does not use the curve). A real valve needs more lift by 1 / Cd.
- Cycle efficiency through the pulses 68.9 % at 3500 rpm rising to 74.5 % at 6600-7100 rpm (peak 75 %); energy-weighted
  ratio 0.76 -> 0.65.
- A/R advice: unchanged in direction (a smaller A/R still reaches full boost sooner and runs a higher p3); the page adds
  that the curve moves full boost only about 100-300 rpm.

### J8 Tests, pinned values

- `web/tests/turbineeff_ui.js` (new; Node + Playwright, 22 checks, about 3-5 minutes): the work coefficient and the K24's
  shaft and tip speed by hand; the blade speed ratio of a worked expansion; the parabola and Watson values; the engine's
  moments identity (1e-9); JS / Rust parity with the curve; the legacy switch: predict mode at 800 mm2 without `bsr`
  equal to the last digit to values pinned from git 9301028 (`turbineeff_pins.json`); the steady balance with the curve
  against turbineBalance at that efficiency; friction monotonic and scaled with N^2; full boost later with the curve and
  later with a larger turbine; the page (input, plan rows, steady column, a run, the build sheet and the step row).
- `web/tests/wave_wasm.js`: two jobs added (the parabola with areas changed between speeds; Watson on a divided housing
  with the gate to the air); the turbine summary's new last value compared; every existing job identical.
- Pinned values changed: none (see the suite line below; the existing turbo tests check the captured plan, which has no
  `bsr`, or qualitative behaviour of the page's run).
- Engine: JS and Rust changed in parity, WebAssembly rebuilt; every naturally aspirated and constant-efficiency job bit for
  bit (wave_wasm, turbineeff_ui 4).
- Suite (`python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`, 2026-11-13, part 10): 132 tests,
  125 passed, 0 flaky, 0 failed, 7 skipped, 7 partial skips (all expected), 0 unexpected, 1566 s (turbineeff_ui 191 s;
  turbine_ui, turbosim_ui, turboaudit_ui, waveturbo_ui, wave_wasm passed unchanged).

### J9 Not done, unknown

The PT5862's turbine map, its shaft speed at any point and its compressor's work coefficient, blade count and backsweep
(the 0.523 is one published wheel's design point); turbo bearing loss for this turbo at a speed (no readable number);
the volute's heat loss (no source with a number); compressor efficiency off the island and the surge line (makers' maps
are images; the owner can mark them on "Your compressor map"); a radial turbine's efficiency at x above about 1.2 (the
parabola holds 0 there, Watson's is 0 above 1.19; neither lets the rotor absorb work, which a real one can); the shaft
speed's swing over a cycle; on-engine efficiency measurements under pulsing flow.

### J10 How to rerun

```
node tools/validation/wave/turbine_eff.js          # ONLY=hand|k24|closure|pulse|generic; all about 35 min
node web/tests/turbineeff_ui.js                    # from web/, about 5 min
QUICK=1 node web/tests/wave_wasm.js                # parity incl. the two blade-speed-ratio jobs
```
