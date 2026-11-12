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
  Fuel vapour is not modelled (the model counts the fresh charge as air, as before).
- Burned gas: frozen products of CH1.87 at the engine's air-fuel ratio (stoichiometric 14.596 with these atomic weights:
  C 12.0107, H 1.00794): lean CO2, H2O, O2, N2, Ar; rich CO2, CO, H2O, H2, N2, Ar with the water-gas ratio
  [CO][H2O]/([CO2][H2]) = 3.5 (Heywood, ICE Fundamentals ch. 4; MIT 2.61 lecture 4 says "3.5 to 3.7", the equilibrium
  at about 1740 K; JANAF's log Kf give 3.41 at 1700 K and 3.80 at 1800 K). No dissociation.
- Mixing by mass with the fresh-charge fraction x the model already carries in every pipe cell, cylinder and side
  volume: R(x) = Rb + x (Ra - Rb); cp(T, x) and the sensible enthalpy h(T, x) (integral of cp from 298.15 K, continuous
  at 1000 K by construction) mix the same way; e = h - R T. The burn's heat is added as before (fresh charge / AFR x
  LHV x eta), so no formation enthalpies are needed; converting fresh charge to burned gas at fixed T changes e by the
  sensible difference only, which is the right accounting with the heat added as LHV.

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
- Cost: the JavaScript takes about twice as long (wave_wasm.js: 93 s against 47 s for the page's captured jobs), the
  Rust/WebAssembly copy likewise more.

### A3 Verification

- `tools/validation/wave/kat.js`: all 66 criteria pass; `results/kat.json` is byte-identical to the one before.
- Constant-gamma mode: the page's captured worker jobs plus the diameter-step job (112 speeds) give the results of the
  page before the change to the last digit: JavaScript (`tools/validation/wave/constref.js`, and the first three speeds of
  each design in `wavegas_ui.js`) and Rust (`wave_wasm.js`, against `web/tests/fixtures/wave_const_ref.json`, written from
  commit 017cdbf). The OpenWAM matrix with `tag=const` reproduces section 4's wave numbers exactly.
- `web/tests/wavegas_ui.js` (new): 42 species values against JANAF's tables, hand-listed in the test (cp within 0.5 %,
  H - H(298) within 0.3 %, H2O above 1000 K 2 % / 1 %); the mixtures (gamma within 0.0015, cp 0.5 %, u(T) - u(300 K)
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
