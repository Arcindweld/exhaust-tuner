# Boost audit, 2026-11-12

Scope: what was merged on 2026-11-11 and 2026-11-12 for boosted engines (docs/STATUS.md entries of those dates): the
Intake tab's turbo inlet / charge pipe route (`calcCharge`, `chargeSide`, `tsStep`, `calcTurboRoute`), turbo and
intercooler sizing (`garrettMatch`, `corrFlow`, `turbineBalance`, `epsXflow`, `ntuFor`), the cooling-capacity code
(`icFromPoint`, `icPredict`, `icScaleUA`, `w2aLoop` and the warm-up), valve placement and sizing (`orificeArea`,
`tsPlacement`, `tsWgRange`), the options tables (`TURBO_LIB`, `IC_LIB`), the drawing (`tsSvg`); the Headers tab's
pie-cut calculator (`pieCut`, `pieTpl`, `ellipsePerim`) and the catalytic-converter outlet cone in `catDp`; scan routing
(fusion-addin/chargeroute.py and the page's `crLoss`, `crFlows`, `crUseInIntake`); the K-series presets. Not audited:
the 1-D wave solver (`wsFactory`, rust/et_wave), `calcIntake` and `bendK` themselves (audited 2026-11-11).

Method. For each function the governing relation was taken from a source read during this audit (listed per finding),
recomputed in plain Python written from that source (tools/validation/boost/, none of it ported from the page:
`route.py`, `thermo.py`, `ic_cases.py`, `piecut.py`), and compared with the page's own result driven through Playwright
(hooks `window.__turbo`, `window.__tso`, `window.__pie`, `window.__physAudit`, `window.__cr`, `window.__tsLast`).
python-fluids and python-ht were read and run from their source (github.com/CalebBell/fluids, /ht); burned-gas NASA-7
coefficients from Cantera's data/gri30.yaml. Every fix has a check in web/tests/boostaudit_ui.js (or an edited pin, said
where) that fails on the code before and passes after.

Verdicts: CORRECT (page = independent within the stated tolerance), FIXED, LIMITATION (a stated or now-stated
simplification), UNSOURCED (an assumption with no source found; the page now says so).

## Findings

**B1. The route march, `calcTurboRoute` (each section at the pressure of its downstream end, iterated on the compressor
outlet temperature). CORRECT; LIMITATION on the pressure basis.** Independent `route.py` (ideal gas, Sutherland,
Haaland 0.0015 mm, Crane n x f x Idelchik A1, python-fluids Rennels cones, isentropic T2 with eta):
case A, the tab's defaults: P2 170984.534 Pa, PR 1.7079740, t2 101.5698 °C, total loss 15716.968 Pa, page identical to
1e-9; case B, twin turbos into one intercooler, compressor ports 76.2/50.8 mm, cooler ports 63.5 mm, hot 45 + 90 deg and
cold 90 deg at 100 mm, 12 psi, eta 0.72: P2 193671.222 Pa, PR 1.9180628, total 9961.918 Pa, page identical. Converges
in 6-7 passes. Taking each run's density at its downstream (lower) pressure overstates that run's own loss by about half
its fractional pressure drop (hot side 3.9 kPa of 167 kPa: about 1.2% of its loss): conservative and small; the page
also states the incompressible-formula limit (Crane: within about 10% while the loss is under a tenth of the pressure).

**B2. `chargeSide`: bend arcs off the straight, Crane K on the run's own f. CORRECT** (same values as B1). See B6, B23.

**B3. `tsStep`, cones and steps. CORRECT.** python-fluids `diffuser_conical` / `contraction_conical` 'Rennels' and
Borda-Carnot, searched 2-60 deg by 0.5 deg, reproduce the page inside B1's totals.

**B4. Compressor efficiency. UNSOURCED default, stated and adjustable.** 70% default (input i-eff), printed with every
outlet temperature ("at 70% efficiency"); no source for 70% as typical; a map's island value should be typed.

**B5. `garrettMatch`. CORRECT.** Garrett, "How to select a turbo, part 2" (read this session; the MAP equation is an
image, its inputs named in text, R = 639.6): 650 hp, A/F 11.5, BSFC 0.46 -> 57.308 lb/min (Garrett 57.3); 348 ci, 6000
rpm, VE 0.80, 130 °F -> 25.893 psia independent and page (Garrett prints 26.025, 0.5% higher; not explained by the
article's stated inputs); PR with 2 psi loss and 1 psi depression 2.036 (Garrett 2.046). The Turbo Tech 103 examples
pinned in turbosize_ui (41.09 / 3.145 / 21.56 / 1.720) reproduce.

**B6. Bend K basis. LIMITATION (decided 2026-11-11, kept).** Crane TP-410 defines K = n x fT, fT the fully turbulent
factor of clean commercial steel at that size (python-fluids `bend_rounded_Crane` uses `ft_Crane(Di)`); the page uses
the tube's own Haaland f on drawn tube. The n table matches Crane's for r/D 1-10; the page holds n = 30 above r/D 10
where Crane continues (34 at 12 ... 50 at 20); scan routes use 1-3 D, so no effect in practice.

**B7. `corrFlow` (ATP Turbo, 85 °F, 13.95 psia). CORRECT.** 0.4165703 kg/s page (460 / 545) vs 0.4165705 with 459.67 /
544.67.

**B8. `turbineBalance`. CORRECT; LIMITATION on composition.** Properties: `exhGamma` / `EXH_GAS` are built from the same
GRI-Mech 3.0 table as `sosExh` (one property set on the page); gamma 1.279849, cp 1310.856 J/kg K, R 286.629 at 950 °C,
reproduced from Cantera's gri30.yaml. Constant cp at T3 against a variable-cp isentropic expansion (h and s0 integrated
from the polynomials): ER at eta 0.70 1.321519 vs 1.321562, gate share at 2 x boost 0.602450 vs 0.602140 (0.05%).
Exhaust = air x (1 + 1/AFR) (fuel included); mechanical losses folded into the map efficiency as the page says (Marelli
et al.). The composition is stoichiometric products at every AFR (rich CO/H2 not modelled). Turbine outlet: see B13.

**B9. `epsXflow`, cross-flow both unmixed. FIXED.** The closed form (Incropera) against the exact series (Mason; Kays and
London; python-ht 'crossflow', which agrees with `thermo.eps_exact` to 1e-15): effectiveness within 0.6 points at Cr
0.9-1, NTU 3-6 (e.g. NTU 6, Cr 1: 0.76712 vs 0.77211), but the inverse that sizes cores is worse: NTU for eps 0.75 at Cr 1
5.0486 vs 4.9629 (+1.7%), for 0.77 6.1893 vs 5.8880 (+5.1%). At the default case (Cr 0.955, eps 0.75) 4.45237 vs 4.44612.
Now the exact series, Poisson terms in logarithms (no underflow at large NTU). Pins changed, each recomputed by
`ic_cases.py`: turbosize NTU 4.452373 -> 4.446118, UA 1937.71 -> 1934.99 W/K (1938 -> 1935 on the page); turbolib route
A 49.18871 -> 49.94955 °C, 22970.50 -> 22797.14 W, eps 0.7550899 -> 0.7481024, 29822.36 -> 29546.39 W, 61.83832 ->
62.74669 °C; loop 19383.42 -> 19227.18 W, 61.0650 / 75.0787 / 64.9314 -> 61.2785 / 75.1792 / 65.6172 °C, 90% warm-up
140.5 -> 141.58 s; Bowman EC120 NTU 1.902140 -> 1.906803, UA 79.62634 -> 79.82157, 69.48998 -> 69.42463 °C, scaled UA
93.46998 -> 93.69915, 61.42907 -> 61.41224 °C. The old values were the approximation's, not wrong arithmetic.

**B10. `ntuFor`. CORRECT.** Bisection on the (now exact) relation; unreachable targets return NaN and the page shows its
"no core reaches" message (checked: eps 0.99 at Cr 1).

**B11. Intercooler air-side flow. CORRECT.** Heat and capacity rates use the cooler's charge flow (`R.mc`: one turbo's, or
all of them when twins share one cooler); the outside-air flow is the user's input.

**B12. Water-to-air loop and warm-up. CORRECT; LIMITATION (lumped).** Q = (Th - Ta) / (1/e1 + 1/e2 - 1/Cw) checked
against a fixed-point solve of the two exchangers (UA1 600, UA2 1500 W/K, 20 L/min water, 1 kg/s front air, 6 L:
17794.005 W and 41.104 °C both, page after B9; 17843 W before, from the approximate eps); tau ln 10 = 73.70 s against an
explicit integration of the same lumped balance, 73.69 s (turbolib case 141.59 vs 141.58 s). The model is one well-mixed coolant mass,
as the page says.

**B13. Turbine outlet pressure. FIXED.** It was atmosphere, with only a caption. Now input i-tobp, "Back pressure after
the turbine (downpipe, cats, mufflers)", blank 0 (unchanged results); it sets p4 for the power balance, the gate's
discharge and the range table, and the captions state the value used. Independent at 2 psi, eta 0.75, 2 x boost: gate
share 0.5572752 (was 0.628954 at atmosphere), 0.2615197 kg/s, choked (p4/p3 0.5439 < 0.5494), Cd A 1102.559 mm²; page
identical. The page's exhaust back-pressure results live on other tabs and are not wired in (the caption says to enter
them); that wiring stays open.

**B14. `orificeArea`. CORRECT.** Isentropic nozzle with the critical ratio (2/(g+1))^(g/(g-1)) (NASA Glenn "Mass flow
choking", Wikipedia "Choked flow"); blow-off valve 1255.089 mm² unchoked (r 0.6397 > 0.5283), wastegate 1244.373 mm²
choked; page identical. Upstream conditions: the gate at p3 and T3 (turbine inlet, stagnation taken as static, low
manifold speed), the valve at the throttle pressure and intercooler-outlet temperature (cold side) or P2 and t2 (hot side).

**B15. Valve size against effective area. FIXED.** The page compared Cd A with the seat area pi D²/4 and said "passes".
A poppet valve's flow area is its curtain pi D L (A. Kirkpatrick, Colorado State University, "Intake Flow":
Ac = pi Dv Lv, Cd about 0.6 for intake valves), equal to the seat at L = D/4 (derived), so a seat that holds Cd A passes
it only with enough lift. The page now gives, per listed valve, "short even fully open" or "needs at least L of lift" at
Cd 1 (L = Cd A / (pi D)): the default gate's 40 mm valve needs 9.90 mm (D/4 = 10 mm), the blow-off valve's 50 mm 7.99
mm; a caption gives the basis and that no wastegate / BOV Cd was found.

**B16. Blow-off valve sizing basis. UNSOURCED, now labelled.** The valve is sized to pass the compressor's full flow at
the moment the throttle shuts; no maker sizing method was found; the row now says it is this page's assumption.

**B17. Hooper 2-K mitre figures. CORRECT values; FIXED wording.** The page's 90 deg mitres (1000/1.15, 800/0.35, 0.30,
0.27, 0.25) and long-radius 800/0.20 match python-fluids' `Hooper` table in source. The page said a sourced figure existed
only for 90 deg; Hooper's table also has 45 deg mitres (1 weld 500/0.25, 2 welds 500/0.15) and a 45 deg long-radius elbow
(500/0.15): the caption and comment now say they exist and are not used. LIMITATION: R/D is taken on the tube OD
(Hooper's R/D 1.5 is of the pipe size); the caption already says to read it as a guide off 1.5.

**B18. Pie-cut geometry. CORRECT.** `piecut.py` places each piece's axis, intersects its surface lines with the weld
planes numerically, takes the weld perimeter from scipy's complete elliptic integral and lays the stick out with the
blade's slab k / cos(a): 3 in OD, 4.5 in CLR, 90 deg, 5 pieces, square ends, 1/16 in kerf: cut 11.25 deg, full piece
30.3142 / 45.4714 / 60.6285 mm, half 15.1571 / 22.7357 / 30.3142, weld 241.7400 mm, stock 188.3599 mm, marks 22.7357,
69.8257, 116.9156; 2.5 in OD, 3.75 in CLR, 60 deg, 4 equal pieces, 2 mm kerf: 7.5 deg, 16.5053 / 24.8652 / 33.2252 mm,
weld 200.3528 mm, stock 117.9072 mm, first marks 4.1800, 31.0625, 57.9450; template height r tan(a) 7.5786 / 4.1800 mm.
Page equal to 1e-9. Both end conventions and the kerf handling hold.

**B19. Units and cross-section wording. FIXED.** The Charge pipes section printed one unit system only (ft/s or m/s, psi
or kPa, °F or °C, L, lbf or N, in² or cm²); every figure now carries both. It and Boosted intake work at the throttle's
pressure ratio with no pipe losses (189 °F out of the compressor, 105 °F out of the intercooler) while the route section
finds 215 °F / 111 °F with every loss; both rows now say so and point to the route section, whose figures the turbo,
intercooler and valve sections use. Other new sections were already dual-unit.

**B20. One pressure ratio. CORRECT.** 1.708 in the route summary, the demand line (with corrected flow 0.417 kg/s), the
compressor power and the drawing; the BOV on the hot side uses the route's t2; twin turbos are per turbo everywhere
except the merged cold pipe (checked in boostaudit_ui and B1 case B).

**B21. Scan-routing design flows, `crFlows`. FIXED.** The legs were given the throttle-ratio temperature (87 °C), the
throttle pressure on the hot side and one turbo's flow on the cold side even when twins share one cooler (a real error for
that layout: the merged cold pipe carries both flows). They now take the route section's converged air: hot 0.4332 kg/s at
101.570 °C and 167040.7 Pa (downstream end), cold at its own pressure, the cooler's flow. chargeroute_ui's flow check
changed accordingly (pinned to the route values above).

**B22. chargeroute.py `bend_k` / `leg_loss` / `rank` / `cut_list` / `couplers`. CORRECT.** `bend_k` is line for line
`bendK` (parity fixture passes, worst relative difference under 1e-12); straights net of every bend's arc; rank by loss
to the pascal, then volume, bends, clearance; each bend cut from the smallest stocked angle that covers it (0.5 deg
tolerance, the router's).

**B23. Bends longer than the run. FIXED.** With more bend arc than pipe the straight friction was set to zero silently;
the route verdict now says so (e.g. 2 x 90 deg at 1.5 D on a 200 mm hot side: 283.7 mm of arc).

**B24. `catDp` outlet cone (Rennels contraction with friction). CORRECT.** python-fluids `contraction_conical` 'Rennels'
and `diffuser_conical`: 6 in brick, 2.5 in pipe, 2 in cones (82.37 deg): out 0.1834570, in 0.7306830; 5 in brick, 2 in
pipe, 100 mm cones (41.71 deg): out 0.0768903, in 0.6891533; page identical.

**B25. Garrett and Bell quotes. CORRECT, one comment FIXED; Bell open.** Garrett's two pages (read this session):
"approximately 200 – 300 ft/sec", "for twin turbo setups, divide the flow rate by (2)", "bend radius 1.5 times greater
than the tubing diameter", the gate "at 90° ... reduce flow capacity by up to 50%", "ideal connection is at 45°", BOV
"close to the turbo outlet ... (if valve can handle high temp)", MAF "recirculation (bypass)", choke where "efficiency
drops below 58%" - quoted accurately. Neither page names a density for the cfm, and the "400 hp, about 40 lb/min, 526
cfm" example cited in a code comment is not in their text: comment corrected, and the page now says outside-air density
is its own reading. Bell's Mach 0.4 and 2-2.5 x boost (Maximum Boost, 1997) could not be read online: not re-verified.

**B26. UA against flow (preprint). CORRECT figures; FIXED status wording.** Samanta, Tavva and Ranganayakulu, engrXiv
5664 v2 (2025-11-03), PDF read: Eq. 6 j = 0.4988 Re^-0.5236 (t/l)^0.3860 (s/b)^-0.2837 (t/s)^-0.4424, 300 <= Re <= 1500,
as the page has it; the correlation is fitted to the authors' CFD (ANSYS Fluent); the abstract page calls v2 "the final
draft after acceptance" but names no journal. The caption now says CFD-fitted preprint and gives Eq. 7 (turbulent,
Re^-0.5424, exponent 0.4576). It is presented as bounds (UA held / all resistance on the charge side), as it should be.

**B27. Catalogue spot check. One mismatch, FIXED.** Turbos, maker pages re-read today: Precision PT5862 (700 HP, 58.0 mm,
62/66 mm turbine, six housing lines) and PT6266; Garrett G25-660, GTX3076R GEN II, G35-900; BorgWarner EFR 6758, 7163,
8374, 9180 (catalogue: hp, wheels, housings with part numbers); AirWerks S200SX-R 58, S300SX-R 64 and 68: every stored
figure matches, except GTX3076R GEN II `wg: null` ("not stated") where Garrett lists free-float kits and internal-gate
771300 T3 / 5-bolt assemblies: filled. Intercoolers: all six EJ Bowman rows (brochure G21 table, the 180 °C / 1.75 bar g /
30 °C basis, BSP ports) and their energy balances; Mishimoto MMINT-UM (23.5 x 11.75 x 3, 800 hp, "Rated to 600 whp",
32 psi) and MMUIC-W3 (title/table conflict as the page says); CSF 8056 and 8046 (and the other six listed); Garrett's eight
cores: all match. CSF also publishes an "Exact Inches" table; the page uses the rounded one, as labelled.

**B28. K-series presets. CORRECT.** Honda's sheets re-read: K24A2 (2004 TSX) 2354 cc, 87 x 99, 10.5:1, 200 hp @ 6800,
166 lb-ft @ 4500, 7100; K24Z7 (2013 Civic Si) 2354, 87 x 99, 11.0, 201 @ 7000, 170 @ 4400, 7000, "Stainless Steel Exhaust
Manifold" (the conflict the page notes); K24W1 (2014 Accord) 2356, 87 x 99.1, 11.1, 185 @ 6400 (Sport 189), 181 @ 3900
(182), 6800. The inline-engine header wording (no "ports face", 1-4 / 2-3 pairs, Tri-Y as 4-2-1) is covered by k24_ui.

**B29. Boundaries. FIXED where it misled.** With the assumed turbine inlet pressure too low for the boost (e.g. 0.5 x
boost, eta 55%) the gate's share is 0 and the page showed a 0 mm² gate with "38 mm passes"; it now says there is no gate
flow on those assumptions and why. At zero boost a dangling comma in the turbine table is gone. Checked with no NaN /
Infinity on the page: boost 0 and 200 kPa, twins, zero charge-pipe lengths, intercooler 0 and 100%, 20000 rpm.

**B30. Range-table row match. FIXED.** `tsWgRange` rounds the multiples to four decimals and then looked for the typed
one at 1e-9, so a multiple with more decimals (typed, or a measured pressure over the boost, e.g. 9 psi / 8 psi in kPa)
found no row and the section threw. It now compares at the same rounding (boostaudit_ui: 2.123456 is marked as yours).

## Turbine housing A/R (the owner's addition, after the audit fixes)

Asked for: make the turbine housing A/R part of the sizing as far as sources allow. What is on the page now, and the
basis of each statement:

Sourced (read 2026-11-12):
- Definition: Garrett, Turbocharger Catalog vol. 9, p. 7 "WHAT IS A/R?": "the inlet (or, for compressor housings, the
  discharge) cross-sectional area divided by the radius from the turbo centerline to the centroid of that area"; the same
  in Garrett's article "the difference an A/R makes" (the owner's link). This replaces the page's earlier citation of a
  Garrett graphic "as reproduced on a 2025 lecture deck".
- Effect: the same catalogue page: a smaller A/R raises gas velocity into the wheel, "quicker boost response", the flow
  enters "more tangentially, which reduces the ultimate flow capacity", more back pressure; a larger A/R "more radial",
  "increasing the wheel's effective flow capacity", lower back pressure, delayed boost.
- One engine's result: Garrett's article, GTX3076R GEN II on a 1.9 L Honda, "divided v-band .83 A/R" 600 whp / 400 lb-ft,
  full spool 5,250 RPM; 1.01 A/R +50 whp, +75 lb-ft, full spool "almost 6000rpm"; the .83 curve "dips at the end of the
  pull". G25-660 0.72 vs 0.92: "did not make as significant of a difference"; RX-7 1.44 vs 1.15: lower back pressure
  "with minimal effect on boost response". On the page as one engine, not a rule, and not made into a formula. Conflict
  noted on the page: Garrett's GTX3076R GEN II product page lists its V-band 0.83 and 1.01 housings as undivided.
- A/r sets the rotor inlet angle and the swallowing capacity for one wheel: Lee, Barrans, Jupp and Nickson, Aerospace 4
  (2017) 56 (open access, eprints.hud.ac.uk/34087), who also found 4.3% more mass flow parameter at the same A/r with a
  different volute aspect ratio, so A/R orders capacity but does not fix it.
- Housings: structured per row (`TURBO_HS`, flange, A/R, outlet and its size where printed, divided, gate type, part
  number) from the maker pages re-read today: Precision PT5558 (selector only: the page does not pair flanges with A/Rs,
  said in the row), PT5862, PT6062, PT6266, PT6466 (Details lists); Garrett G25-550, GTX2867R GEN II, G25-660, GTX3076R GEN
  II, G30-770, GTX3582R GEN II, G35-900, G35-1050, G40-1150, G42-1200 (turbine kit and assembly tables); BorgWarner EFR
  6758, 7163, 8374, 9180 (catalogue tables, twin-scroll entries as divided); AirWerks super-cores: none (sold without a
  housing, said on the page).
- Published turbine flow per housing in text: one only, Garrett G40-1150, "The largest 1.19 A/R T4 turbine housing flows
  43 LBS/MIN of air", no reference temperature, pressure or expansion ratio. Garrett's catalogue text has only wheel
  figures ("77MM INCONEL TURBINE WHEEL FLOWS UP TO 43 LBS/MIN", "89MM ... UP TO 56 LBS/MIN"), BorgWarner's catalogue
  only its Match-Bot example's "Turbine Corrected Flow @ 59F", Precision none. Maps are images and were not digitised.
- Divided housings: BorgWarner's catalogue, the channels of cylinders 1-4 and 2-3 "separated from each other" to the
  turbine and "reunited again directly at the turbine wheel", boost "1000 RPMs earlier".
- Measured pre-turbine pressure: Bell (Maximum Boost pp. 37, 169-170, as already quoted in Boosted intake; not re-read).

Derived (in the page's comment):
- tan(alpha2) = 2 pi b2 (rho2/rho) / (A/Rc), incompressible 2 pi b2 / (A/R): mass through the volute section
  m = rho A V_tc, free vortex r V_t = Rc V_tc to the rotor tip, continuity m = rho2 2 pi r2 b2 V_r2. A smaller A/R gives a
  more tangential inflow, as Garrett states. No source was found that the swallowing capacity scales in proportion to
  A/R, so no capacity is scaled with it: housings without a published flow are only put in A/R order.
- The build tie: the existing turbine balance at peak and at the full-boost RPM (i-lorpm) with the assumed (or measured)
  inlet pressure. If at full-boost RPM the turbine needs more than all of the exhaust at that pressure, the housing has to
  build more pressure there, which is the smaller-A/R direction (Garrett); if at peak it needs more than all of it, the
  larger-A/R direction; otherwise either end works on the balance and the choice is the power band (Garrett's wording).
  Default build, GTX3076R: 37% of the exhaust through the turbine at peak (63% round the gate), 35% at 3,500 RPM.
- Housing with a published flow: the maker's lb/min / 132.277 = kg/s against the exhaust per turbine; all of it ->
  "passes all the exhaust without the gate"; more than the housing's figure but the turbine's share within it -> "needs the
  gate to bypass at least 1 - cap/me"; the turbine's share above it -> "at its flow limit ... choose a larger A/R". The
  G40-1150 figure has no stated basis, so actual mass flow is compared and the verdict is labelled indicative. Hand case in
  turboar_ui.js: me 0.4692829 kg/s, turbine share 0.3710464 (0.1741257 kg/s), flow parameter 7.754875 (all) and 2.877418
  (through the turbine) kg sqrt(K)/(s bar); 10 / 30 / 70 lb/min -> limit / gate at least 51.67% / all.

Common practice / this page's own reading (labelled on the page):
- "Near 1 x boost" read as at most 1.25 x (AR_NEAR1); the step is one A/R on the picked turbo's list, the same flange and
  scroll family first.
- An undivided housing on a divided manifold loses the pulse separation (follows from BorgWarner's description); one gate
  per scroll or a divided-entry gate (as the placement rows already said).

On the page: Intake inputs "Turbine housing A/R" (i-tar), "Turbine housing picked" (i-thsg, read-only) and "Measured
pressure before the turbine" (i-p3m, which replaces the assumed multiple everywhere it is used); Turbo options shows the
picked turbo's housings in A/R order with flange, outlet (in and mm), gate, part number and the verdict, a housing select
that sets the A/R and the label (both saved with the project), the build tie, the Bell step and the divided check; the
route summary has a Turbine housing row, the drawing's turbine label the A/R, the placement rows the housing's flange and
its outlet as the downpipe start (no downpipe input exists on this tab, so none is fed); the Turbine housing A/R section
keeps Vizard's quotes, now with Garrett's own definition and the GTX3076R result, and points to the per-build result.
Tests: web/tests/turboar_ui.js.

## Open

- Wire the Mufflers / Headers back-pressure results into i-tobp (B13) rather than typing them. Done 2026-11-12 (agent7/guide):
  Intake tab, Exhaust after the turbine, "Use my exhaust's back pressure" (docs/STATUS.md, tests/turboguide_ui.js).
- Bell's figures (Mach 0.4, 2-2.5 x boost, pages) were not re-read; the book is not online.
- Hooper's 45 deg mitres could be offered for 45 deg pie cuts (data in hand, not used: B17).
- A rich-mixture burned-gas composition for the turbine properties (B8).
- Turbine flow per housing: makers print it only on map images (not digitised); the A/R verdict path for published
  flows is exercised on the one text figure (G40-1150, basis unstated) and on synthetic rows in turboar_ui.js.

## Exhaust after the turbine, part 2 (2026-11-12): cooling, compressible flow, size steps, one muffler model

The first exhaust sum (`exhAfterTurbine`, merged earlier today) was knowingly rough: gas held at the turbine-outlet
temperature to the tip, incompressible K x head losses at Mach 0.3-0.8 (flagged, still summed), no steps between pipe
sizes, and a hand copy of the Mufflers tab's muffler. It is replaced on the page by `exhMarch` and kept as the reference
("First method" row). Sources were read this session; each model's equations are in the page's comment above `exhMarch`.

**X1. Cooling along the pipe. NEW (reuses the Headers tab's model).** The page already had a tube-skin heat model,
`calcSkin` (Headers tab, docs/research/header_skin_temperature.md): Gnielinski with Petukhov's f inside, times a
pulsating-flow factor (CAF), wall / coating / wrap conduction, Churchill-Chu natural plus Churchill-Bernstein forced
convection outside (cube-root combination) and grey radiation, emissivity by finish (oxidised 0.85; NASA TM, Wade 1959,
0.87-0.91 for oxidised 347). The march runs it on each pipe run (m cp dT = -q dx), with one addition: `cpGas` puts the
burned gas's cp(T) (GRI-Mech 3.0 polynomials, the table `sosExh` uses) in the energy balance; the Headers tab is unchanged
(it keeps air's cp; at 800 °C the burned gas's is 1279 against air's 1156 J/kg K, so that tab's gas cools about 10% too fast:
open, not changed). CAF: D. W. Wendland, SAE 931085 (1993), about 2.3 manifold, 3.0 takedown pipe, 1.6 tailpipe, averaged
over Re 4,000-20,000, as given in S. A. Balasubramanian, PhD thesis, Windsor 2018 (core.ac.uk/download/215523088.pdf) and
Spyrounakos and Mavropoulos, Computation 13 (2025) 223. **FIXED:** the page attributed these to "Daniel" (Wendland's first
name, as the MDPI paper prints it); now Wendland 1993 on the Headers tab and in the research note. Alkidas et al. (2004, in
the same thesis) found much lower factors, and full-power Re here is 10-50 x Wendland's range, so the default is CAF 1 (the
steady formula: the least cooling, an upper bound on temperature); Wendland's factors are the other option. Konstantinidis
et al. 1997 (the Headers tab's 2.5) could not be opened this session and is not offered here. Inputs (Intake tab, Exhaust
after the turbine): cooling on/off, air temperature (30 °C), air speed across the pipe (0 / 30 / 60 / 100 mph: the air under a
car moves slower than the car, not sourced), outside finish (SKIN_FIN), CAF. Aluminised steel: Cleveland-Cliffs' data sheet
says only "reflecting up to 80%" of radiant heat below 427 °C; no emissivity at exhaust temperatures was found, so no entry.
Double-wall pipe: no correlation read this session, not offered. Converter, muffler, cones and steps are adiabatic (a
converter's reactions can heat the gas); the pipe after the downpipe is the Sound tab's whole length, so the converter and
muffler sit at the downpipe's outlet temperature (high side). The driving temperature is T0 (high by 0.11 v²/2cp, under
7 K at Mach 0.6).
Check: calcSkin with a test-only fixed U against the exponential T(L) = Ta + (T0 - Ta) exp(-U pi D L / m cp) (0.2 kg/s,
60 mm, 3 m, U 50, cp 1200: 714.4262 °C; page within 2.3e-5 of T - Ta, its 10 mm explicit steps), and with cp(T) against an
RK4 integration; the full model against xflow.py's solve_ivp/brentq solution: tip T0 1127.4880 K vs 1127.4973 K (case 1),
1146.8726 vs 1146.8740 K (case 2).

**X2. Compressible flow. NEW.** Pipes: the generalised 1-D influence coefficients (Shapiro 1953 ch. 8; the dimensional form
in J. M. Powers, Notre Dame AME 30332 notes, 4.1.4, eqs. 4.108-4.110; Darcy f, eq. 4.462), constant area, friction and heat
loss together: dV/V = [psi dT0/T0 + gamma M² F/2]/(1 - M²), dp/p = -gamma M² dV/V - gamma M² F/2, F = f dx/D, RK4 upstream
in steps of at most 10 mm, M from the mass flow at the local static pressure and T0, gamma of the burned gas at the local
static T, Haaland f at the local Re. Minor losses (bends, muffler elements, converters, cones, contractions, tip) are
stagnation-pressure losses K x ½ rho v² at the section's own state with p0 = p psi^(gamma/(gamma-1)) (NASA Glenn, Isentropic
Flow) and the subsonic mass-flow function. Sudden enlargement: compressible Borda-Carnot (p1 A2 + m V1 = p2 A2 + m V2, T0
held). Tip: exit static = outside pressure while subsonic, plus Munjal's measured free-jet element 0.4 x ½ rho v² (kept).
Choking (Mach 0.995 in a pipe, no subsonic state for a part, or Mach >= 1 leaving the tip at the outside pressure) stops the
march: "This exhaust chokes at X ... the pipe or part is too small", with the stagnation pressure that section would need at
Mach 1 as a lower bound, no back pressure, the Use button off, checklist step 8 warns. The march is compressible everywhere
(no switch at a Mach limit): below Mach 0.1 it agrees with the first method's formulas within 0.12% (downpipe with two bends:
-0.115%; downpipe, chamber, tail pipe and tip at Mach 0.041: -0.124% against the first method with the head as ½ rho v²).
Checks (xflow_ui.js): Powers' Fanno relation reproduces the published gamma 1.4 table (f L*/D 14.533 / 5.2993 / 1.0691 /
0.07229 at M 0.2 / 0.3 / 0.5 / 0.8; p/p* 3.6191 / 2.1381 / 1.2893); the page's pipe march from M 0.8 back over L = D (F(0.3) -
F(0.8)) / f finds M 0.3 to 1e-6 and p1/p2 = 2.807045 (closed form 2.807045), 0.5 -> 0.8: 1.658364 and p01/p02 1.290508 (both
to 1e-9); a 0.997 exit is reported choked; the enlargement against the forward closed form (M 0.6, area ratio 0.5: p1
recovered to 1e-7) and Borda-Carnot at Mach 0.04 (0.12%); a state no subsonic upstream flow can feed returns choked.
**FIXED on the way:** the first method took the muffler's and tip's head as mufBackPressure's 1.4 p M²/2 with the exhaust's
Mach number (v / c of the burned gas): 1.4 / gamma too much, about 8% at 900 °C. The march uses ½ rho v². The Mufflers tab
still uses 1.4 p M²/2 with its typed Mach number, about 7% high for hot exhaust (gamma 1.30): OPEN (changing it moves the
physics-audit pins 15.6 / 4.5 / 23.6 kPa; owner's call).

**X3. Steps and merges. NEW / UNSOURCED left out.** Consecutive parts of different bore (downpipe -> converter pipe ->
muffler pipe -> each Sound-tab section -> tip) get a step, abrupt (default) or cones (input): enlargement by X2's
Borda-Carnot, contraction by Rennels' sharp contraction (python-fluids `contraction_sharp`; K by hand in xflow_ui:
72.9 -> 60.2 mm K 0.1952269), cones by `tsStep`'s least-loss Rennels cone; the turbine-outlet cone as before. The
twin-downpipe Y is not counted: Crane's converging tee/wye (python-fluids `K_branch_converging_Crane`,
`K_run_converging_Crane`) is a straight run with one angled branch and its flow split; a Y with both legs angled is not that
fitting, and Idelchik's symmetric-wye diagrams were not read. The step at the Y shows as "not counted"; a converter count
other than the pipe count is joined without a step (listed under Not counted).

**X4. The back pressure's basis. CHANGED.** The page now gives the static pressure at the turbine outlet (the housing's
bore) over the outside air's, and the total pressure there: a turbine map's pressure ratio is "total pressure at the turbine
inlet and static pressure at the turbine outlet" (MotoIQ, Turbo Tech: Compressor and Turbine Map Details). The first method
added K x head to the static pressure everywhere, so across a size change it left out the static change of the speed
change itself; for the turbine-outlet cone (60.2 -> 72.9 mm at Mach 0.74 -> 0.42 on case A) the 1-D diffuser recovers
27.9 kPa of static pressure. That recovery is the least sure number in the sum (swirl and uneven flow after a turbine; no
source in hand), so the page also gives the figure with the cone taken as fully separated (a sudden widening, Borda-Carnot).

**X5. One muffler model. FIXED (refactor).** `mufElems(kind, inputs)` builds the elements (Munjal 1987 eq. 8.4 and
Table 3.1; Munjal, Vijayasree and Chaitanya 2013 for the plug; baffle holes on the hole's head) and `mufElemLoss(E, H, Hh)`
prices them; the Mufflers tab's four back-pressure rows and the turbo sum's `xMuffler` both call them. Equality checked on
four cases (straight chamber Mach 0.15: 1810.164 Pa; reverse 0.12: 1532.034; plug 100 mm at 10%, 0.15: 15563.710; three
baffles with 50 mm holes, 0.10: 4507.786), each also by hand; physaudit_ui and perfflow_ui pins unchanged.

**X6. Case A (turboguide_ui: 450 hp, PT5862 0.63 A/R 4-bolt, 609.6 mm downpipe, 152.4 mm chamber on 72.898 mm, 2500 mm of
76.2 mm OD pipe, still 30 °C air, oxidised, CAF 1), before and after.**

| Part | First method | Gas in -> out (static) | Mach in -> out | Static rise now | Total-pressure loss now |
|---|---|---|---|---|---|
| Cone 60.2 -> 72.9 mm, 8.0° | 746.87 | 816 -> 875 °C | 0.74 -> 0.42 | -27938.1 | 884.5 |
| Downpipe 609.6 mm | 2065.41 | 875 -> 862 °C | 0.42 -> 0.42 | 2175.2 | 2082.7 |
| Chamber muffler | 19294.96 | 862 -> 853 °C | 0.42 -> 0.48 | 17434.9 | 14956.9 |
| Pipe after, 1890.4 mm | 7985.72 | 853 -> 814 °C | 0.48 -> 0.51 | 8789.7 | 7860.9 |
| Tip | 9208.70 | 814 -> 808 °C | 0.51 -> 0.54 | 7254.7 | 5785.7 |
| **Back pressure** | **39301.66 (5.70 psi)** | | | **7716.37 (1.12 psi)** static | total 52389.50 (7.60 psi) |

Pa. Gas T0 902.77 °C at the turbine, 854.34 °C at the tip, 29.5 kW through the walls; cone fully separated: 16.30 kPa
(2.36 psi). What each change moved: first method 39301.66 -> head as ½ rho v² 37083.22 (-2218.4) -> cooling 36427.60 (-655.6)
-> compressible 36377.42 (-50.2) -> size changes and the static pressure across them 7716.37 Pa (-28661.1). The
independent xflow.py (solve_ivp on the primitive equations with cp(T), brentq states, its own Rennels and Munjal code,
NASA-7 data from Cantera's gri30.yaml): 7700.128 Pa (page -0.21%), total 52380.103 (+0.02%), parts within 0.12%. Case 2
(one bend, the plug muffler 100 mm at 10%, an 88.9 mm OD pipe after it (abrupt widening), one layer of wrap, 60 mph,
Wendland's factors): page 120752.065 Pa, xflow.py 120749.896 (-1.8e-5); the first method gave 284956.66 Pa (the plug
muffler at K 12.9 heads, incompressible) and the compressible march 137548 Pa before the steps. Neither tail differs more
than 0.12%: the residual is the page holding gamma over each 10 mm step (with gamma fixed both solvers agree to 1e-6).

**Pins changed (each old -> new, why).** turboguide_ui: the filled Back pressure after the turbine and the turbine
caption's figure 39301.66 Pa (5.70 psi) -> 7716.37 Pa (1.12 psi), X1-X4; the hand case now checks the first method
(`exhAfterTurbine`, unchanged to the last digit) and its "First method" row; "parts past Mach 0.3 are flagged" -> the first
method's 39.30 kPa shown as the comparison's start (the march works those parts compressibly); the converter-by-hand check
reads the first method's converter row (same formula as before); the build sheet's assumption "not cooled along the pipe"
-> "cooled along the pipe by the steady-flow heat transfer ... compressible 1-D relations", key numbers add the static /
total basis and the gas at the tip. No other test's pins moved.

**Not sourced / left open.** The Y merge (X3); the converter's exotherm; double-wall pipe; an aluminised-steel emissivity;
a pulsating-flow factor at full-power Reynolds numbers (default CAF 1, an upper bound on temperature); the turbine-outlet
cone's real recovery behind a turbine (both ends shown); the lumped elements' compressible split when a part loses more than
about a tenth of its pressure (the K are low-Mach measurements, taken on the inlet's head: case 2's plug muffler loses 48% of
its inlet total pressure, so its figure is indicative; such parts carry a warning mark and caption on the page); the Mufflers tab's 1.4 head (X2); the Headers tab's air cp (X1);
burned-gas transport properties (air's mu, k in the film, as before). There is no naturally aspirated whole-exhaust
back-pressure sum on the page (the Cats tab works its converter at its own typed gas temperature, the Mufflers tab at a
typed Mach number), so nothing there changed; `exhMarch` takes any exhaust and could serve one.
Tests: web/tests/xflow_ui.js (new), turboguide_ui.js (pins above); tools/validation/boost/xflow.py and xflow_page.js. Web suite
(run_all_tests.py --suite web --no-build -j 2): 108 tests, 103 passed, 0 failed, 5 skipped (expected), 7 partial skips, 0 unexpected.

## Part 2: independent audit of the rest of 2026-11-12 (intercooler and turbo picks, oil cooling, exhaust march, Mounts, build sheet)

Scope: `icRecommend`, `turboRecommend`, `icApply` and the `IC_LIB` rows (Garrett, Mishimoto, CSF, EJ Bowman, Bell, Conflux
with `cfxModel` / `cfxUA` / `cfxDp` / `cfxPredict`); the oil section (`setrabLoad`, `oilProps`, `oilUnit`, `oilSize`,
`oilEps`, `w2aLoop` with an oil load, `TURBO_OIL`, `AN_SIZES`); the exhaust march (`exhMarch`, `exhSteps`, `xTotal`) against
new cases; the Mounts designer (`mtShares`, `mtIsolators`, `mtSecStress`, `mtWeldGroup`, `mtBoltCap`, `mtStayChecks`,
`mtGrowth`, `mtFlat`, the sheet rows) and fusion-addin/mounts.py; the checklist and build sheet; three flaky tests. Not
audited: the wave solver. Method as in Part 1: equations from sources read for this audit (listed per finding),
recomputed in new scripts (tools/validation/boost/`mounts.py`, `conflux.py`, `conflux_curves.py`; `xflow.py` rerun on new
cases from the new `xflow_page2.js`), compared with the page through its hooks (`window.__mounts`, `__tso`, `__tsx`, `__tg`).
Every fix has a check in web/tests/boostaudit2_ui.js; run against the merged page (1917a1a) 14 of its checks fail, all pass
now. python-ht is not installable here (no index access): the cross-flow series was instead checked against a direct 2-D
solution of the both-unmixed exchanger (600 × 600 cells; 3e-7).

### Mounts designer

**M1. Load sharing, `mtShares` (F/n + (J+ M) × s). CORRECT, for the stated assumption.** Independent: the rigid body on n
equal isotropic springs solved as its own 6 × 6 stiffness system at an arbitrary origin (no centroid, no pseudo-inverse).
Asymmetric three mounts at (−200, 0, −100), (300, 0, −100), (−100, 0, 250) mm under 10 kg at the centre: statics (three
equations, three unknowns) 36.4247 / 33.6228 / 28.0190 N, springs the same, page the same to 1e-9. 25 g sideways with the
mass 80 mm above the mounts (statically indeterminate): mount 1 (838.726645, 355.8413, −36.867105) N both ways; ΣF and ΣM
balance the load. Four asymmetric mounts, 26 g down + 25 g forward: identical to 1e-9. Equal stiffness in every direction
is the page's assumption and is said in the load caption; real brackets are stiffer one way than another, so the shares
are a model, not statics, beyond three mounts or with sideways load.

**M2. Isolation target, `mtIsolators`. FIXED.** Transmissibility T = √(1 + (2ζr)²) ÷ √((1 − r²)² + (2ζr)²) (base
excitation; Iowa 58:153 lecture 9): CORRECT. But the bounce limit was inverted from the undamped T = 1 ÷ (r² − 1)
(r = √(1 + 1/T)) while each bobbin is then checked with the damped T (ζ 0.07): a mount bought to the page's "at most"
stiffness passed 21.09% against the 20% asked. Now the damped root above √2 (quadratic in r²; brentq in mounts.py: r =
2.507488). 7 kg on four at 28.333 Hz: 11.567 → 11.29949 Hz, 9.2436 → 8.820948 N/mm, sag 1.857 → 1.9456 mm; 40 kg:
52.821 → 50.405 N/mm (mounts_ui pins changed for this reason). The AMC pick in case B is unchanged.

**M3. Bracket root, `mtSecStress`. CORRECT; LIMITATION on torsion.** 3/16 in × 54 mm strap, 63.5 mm reach, 25 g forward
on 7 kg ÷ 4: σ 134.2443, τ 2.5091, von Mises 134.3146 MPa (page identical); side 25 g with a 20 mm offset: 42.6303 MPa.
Peak normal and peak shear are added at one corner (safe side, said on the page). Torsion uses J = Σ b t³/3, the
thin-wall limit; at b/t ≈ 11 the exact factor is about 0.31 instead of 1/3 (Roark's table), so torsional shear reads about
7% low: small next to the bending here, not changed.

**M4. Stay in compression, `mtStayChecks`. FIXED.** The page took min(Euler, yield), which overstates intermediate
columns. Johnson's parabola σcr = Sy − (Sy/2π)² (L/k)² ÷ E below (L/k)cr = √(2π²E/Sy) (Wikipedia "Johnson's parabolic
formula", raw text; MechaniCalc "Column Buckling": transition where Euler gives Sy/2). 3/4 × 0.065 in A36 stay, 300 mm:
L/k 48.55 < 127.74, 20764.06 N (was 22380.66 N at yield, 7.8% high); the row names the formula and the slenderness. The
test comment's I (3518.7 mm⁴) was an arithmetic slip: 3445.66 mm⁴ (Euler 77461 N, not 79100).

**M5. Bolts, `mtBoltCap`. CORRECT.** ISO 898-1 stress area from d2 = d − 0.649519 P, d3 = d − 1.226869 P: M8 36.6085 mm²
(Fastenal 36.6); proof 580 × 36.6 = 21228 N, shear 0.6 × 800 × π d3²/4 = 15763.70 N (Portland Bolt's 60%). Foot bolts: tipping
about the nearer edge with the farthest bolt's share M d_far ÷ (d_near² + d_far²), the pair taking the turn as a couple:
the standard bolt-group relations; prying not counted (said).

**M6. Welds, `mtWeldGroup`. CORRECT method; FIXED wording for aluminium.** Line method (Blodgett), strap welded on both
faces, forward case: 106.4523 N/mm (page identical); throat 0.707 × leg; steel 0.30 FEXX = 145 MPa for E70 (AWS D1.1
allowable). AlcoTec's 11.5 / 17.0 ksi are its "Typical Shear Strength – Fillet Welds" (re-read): breaking strengths, so the
aluminium weld rows put the page's safety factor on failure while the steel row is on an allowable and the brackets on
yield. The row now says so. LIMITATION, open: no Aluminum Design Manual allowable was verified.

**M7. Flat pattern. CORRECT.** BA = (π/2)(R + K t), flat foot = Lf − R, upright h − (R + t), hole Lf − a from the end:
mount 1 (t = R = 4.7498 mm, K 0.42) bend line 32.797 mm; the add-in's `flat_pattern` gives the same (test_mounts.py).

**M8. Net section at a lightening hole. FIXED wording.** Nominal net-section stress without Kt is the usual basis for
static yield of a ductile metal; the page did not say so. The row now states it and that the edge stress (about 2–3 ×)
matters for fatigue, which is not checked.

**M9. Heat growth, `mtGrowth`. CORRECT.** α L ΔT from the fixed mount (23.2 µm/m °C, the part taken as aluminium, said), the
others slide along the line from it; growth only when hotter than bolt-up, shrink only when colder; slots = hole + both
growths + 2 mm.

**M10. Basis texts. CORRECT.** FIA Appendix J 253-7.2.2 / 7.3.6, re-read: "must be able to withstand a deceleration of
25 g" (extinguisher mountings), on the page as a reference class, not a rule for coolers. 14 CFR 25.303 re-read: 1.5 on
limit loads unless a condition is stated in ultimate terms; the page holds 1.5 × load against yield, stricter than
25.303 + 25.305 (limit load without permanent set, ultimate without failure), as it says. Fatigue: stated as not checked
on every bracket and on the sheet.

**S1. Mount rows on the turbo build sheet. FIXED.** Opening the Hangers tab once put the designer's untouched example
(a 7 kg core on four 25 g mounts, "safety factor 1.63") on the turbo build sheet, and changing the intercooler on the
Intake tab afterwards left the sheet with the brackets of the earlier core. The rows now appear only when the designer has
been set up (an input off its default, or mounts read from Fusion) and are worked out again from its inputs when the sheet
is made.

### Oil cooling

**O1. Oil properties. FIXED.** Engineering ToolBox, re-read: 340–400 K rows as on the page, but the table runs 260–400 K
and the page clamped below 67 °C calling that "the table's" range. All eight rows now: at 50 °C 870.11 kg/m³,
2004.18 J/kg K (was 860 / 2080, clamped).

**O2. Setrab. CORRECT.** The 24 engine-oil-cooler rows re-read (power range, wet/dry drop, wet and dry BTU/hr) all match;
the four FP fan-pack rows were not in the text read and are not re-verified. Test conditions match. The page calls the
figures maker guidance, not a measured load, and sizes against the upper wet-sump figure (its choice, stated).

**O3. Conflux oil coolers. CORRECT.** Nodes re-read from oil.pdf with this audit's own extraction (axes fitted to the
charts' gridlines, conflux_curves.py): 100220 heat 5.427 / 9.594 kW at 8.0 / 40.0 L/min (table 5.4 / 9.6), drop 5.254 /
64.340 kPa (5.2 / 64.3); 100219 5.150 / 21.995 (5.2 / 22.0), 5.711 / 59.391 (5.7 / 59.4); 100218 37.632 / 62.456 (37.6 /
62.5), 23.360 / 105.012 (23.4 / 105.0). Test conditions and ports as printed (85/50 °C, 20 L/min, 0.34 kg/s; 120/80 °C and
120/85 °C, 120 L/min, 2 kg/s; JIC −08, −08, −12). The −08 / "JIC-10" note is right: 3/4-16 is the −08 thread (Titan).

**O4. Effectiveness and units in parallel. CORRECT; wording FIXED.** At fixed flows ε = f(NTU, Cr), so Q scales with the
inlet difference. Cmin is the oil at every tabulated flow (100218: 1593.5 W/K at 50 L/min against 7834 W/K coolant):
ε 0.674149 / 0.373531, page identical. n units at F/n each, page identical (130 L/min, 110 / 70 °C: one unit, 67588.57 W,
86.2 kPa). Each unit is at the maker's coolant flow, so n units need n times it: now said.

**O5. Oil heat into the charge cooler's loop. CORRECT.** A fixed-point solve of the closed loop with the oil cooler after
the charge cooler equals (Th − Ta − k Qoil) ÷ (1/e₁ + k), k = 1/e₂ − 1/Cw, and the oil cooler's coolant-in tw1 + Q/Cw.

**O6. Turbo oil-line quotes. CORRECT** (Precision's installation page and Garrett's two pages re-read). Precision's page is
script-built; two reads differ on one word of the drain sentence, so its exact wording is not certified. Garrett's
system page also mentions a 35° drain-rotation limit in its leak section beside the ±15° rule the page quotes.

### Intercoolers, turbos and the catalogue

**C1. Conflux barrel curves. CORRECT.** barrel.pdf re-read: effectiveness 100011 73.0 / 79.0 / 86.0 % at 0.40 / 0.30 /
0.20 kg/s, 100012 80.0 / 84.0 / 87.0 at 0.60 / 0.50 / 0.40, 100013 88.0 / 90.0 / 92.0 at 0.80 / 0.70 / 0.60; outlet 100011 55.07 /
49.08 / 43.10 °C; drop 100011 17.14 / 10.16 / 5.18, 100013 16.99 / 12.99 / 9.99 kPa: within the offsets the page's comment
gives. Internal check ε against (Tin − Tout)/(Tin − Tc): 100013 at 0.60 kg/s 91.8% against 92.0%. The brochures and
their images are not in the repository (git ls-files).

**C2. UA inversion. CORRECT.** Both-unmixed series against the 2-D solution: 0.807012 at NTU 2, Cr 0.214. 100012 at
0.40 kg/s with the page's cp 1004.675 J/kg K: UA cross 992.0958, counter 910.9411 W/K; the five points and two predictions
per part (e.g. 0.46 kg/s, 180 → 45 °C: 53150.13 W, 64.994 °C) equal the page to 1e-7. Counter-flow UA is 8–12% below
cross-flow; at the maker's coolant flow both predict within 0.01 °C, at 0.8 × it 0.6 °C apart (the bracket shown).

**C3. Drop at the build's density. CORRECT.** dp ∝ 1/ρ at equal mass flow, ρ from the maker's stated inlet pressure and
temperature against the compressor outlet's: 100012 at 0.50 kg/s, 350 kPa(a) / 200 °C → 170984.5 Pa / 101.57 °C:
× 1.621134 = 25.938 kPa (pressure alone would give × 2.047). LIMITATION (stated on the page): single-point drops (Garrett,
Mishimoto, Bell, Bowman) are scaled by flow² at the rating's density. For EJ Bowman, whose 1.75 bar g / 180 °C basis is
stated, the default build’s density would make the drop 1.34 × the page’s (ρ ratio (276.3 kPa ÷ 453.15 K) ÷ (171.0 kPa ÷ 374.7 K)); open.

**C4. Capacity margin and "just short". CORRECT.** capM = Q ÷ Q_needed against the margin; at fixed flows Q ∝ (thi − tci),
so the passing coolant-in is thi − (thi − tci) × margin ÷ capM.

**R1. Order with an unknown value. FIXED.** "Same" was |a − b| ≤ 1e-9 max(1, |a|): with a = Infinity (no published drop,
volume, weight or face) it held against any finite b but not the other way, so the comparator was inconsistent: two cores
of equal rating, one publishing a drop and one publishing more of everything else, ranked by list order, and the reason
named the wrong key ("less published data" or "higher or unpublished pressure drop" on the core that publishes it). Now
equality holds both ways (boostaudit2_ui: the drop-publishing core first in both orders). No catalogue order pinned in
icrec_ui / conflux_ui changed.

**R2. A size limit that excludes everything. FIXED wording.** The note now says how many cores the space rules out and how
many fail on size alone (100 × 100 × 30 mm: 57 of 57, 48 on size alone) and suggests more space.

**R3. Twins into one core. CORRECT.** Rated against the whole engine (450 hp: Bell A300227240, 608 hp, 1.351 ×) with both
turbos' air (0.43318 = 2 × 0.21659 kg/s). Ties fall to list order and say so. `turboRecommend` sorts on finite keys only.

**B1. Bell. CORRECT figures; FIXED wording.** Catalogue re-read: A350097240 455 CFM USD 496, A350130240 609 / 626,
A350143240 670 / 678, A350169240 792 / 780, A300227240 912 / 990, A350240240 1125 / 1060, A350280240 1312 / 1218; the basis
"based on 1 psig pressure loss across the intercooler core and a charge-air pressure of 10 psig", standard or actual not
said, no temperature. A, B, C follow the part numbers; weights are on item pages that could not be fetched here. Both
readings: as standard cfm (the page) A350097240 is 303 hp by 1.5 cfm per hp and 1 psi at 0.2541 kg/s; as actual cfm at
10 psig the mass is 1.68 ×, 510 hp, and the drop at a given mass flow 2.82 × lower. The page said only the drop half;
the rating line now gives both (the standard reading is the lower rating and the higher drop).

**K1. Catalogue spot check. All match.** Garrett, its core table re-read: 848054-6012, 893513-6001, 848054-6037 (vertical),
701596-6001, 858893-6003 and the air-to-liquid 734408-6005: horsepower and all three dimensions in both units. Mishimoto
MMINT-UG (17.5 × 11.75 × 2.76 core, 24.5 × 13.1 × 3 overall, 3 in, 700 hp, 32 psi, cast tanks) and MMINT-UZ (20.5 × 6.25 ×
2.5, 28 × 7.5 × 2.5, 2.5 in, no hp, 22 psi). CSF's size table: 8056, 8063, 8174, 8054 (vertical flow), 8085, 8040. EJ
Bowman EC120-4073-3, FC100-4074-2, GK190-4877-3, JK190-4078-3 (power, flow, drop, outlet, heat, water flow and drop, BSP
size; basis 180 °C, 1.75 bar g, 30 °C water). Bell seven rows (B1). Oil coolers: the three Conflux rows (O3).

### Exhaust after the turbine

**X7. Two new cases against xflow.py. CORRECT.** xflow_page2.js builds them: (1) near choking, the Sound tab's pipe 57.15 mm
OD (2.25 in) with the chamber on 53.848 mm, tip leaving at Mach 0.956: page 141090.102 Pa, xflow.py 141021.777 (+0.048%);
2.0 in OD chokes at the tip and the page says so; (2) two downpipe bends, plug muffler 150 mm at 20%, 63.5 mm OD pipe after
it (a contraction), painted black, 100 mph, Wendland's factors: 83262.376 against 83212.416 Pa (+0.060%). Parts within
0.07% except the pipe after the downpipe, 0.23% and 0.33% (the page holds gamma over each 10 mm step; the residual grows
with Mach). xflow.py had no step between the downpipe and the muffler's pipe (the merge's cases had equal bores): added.

**X8. Static and total at the turbine outlet. CORRECT.** Both buttons write the static figure (cone recovered, or the
separated-cone march) to i-tobp; `turbineBalance` takes it as p4 with p3 as a total pressure: total-to-static, the map's
definition.

**X9. Cooling. CORRECT inside its range.** Gnielinski's 3000 ≤ Re ≤ 5 × 10⁶: full-power Re here 7 × 10⁴ to 2.3 × 10⁵;
air's Pr 0.7. The driving temperature is T0 (a turbulent recovery factor near 0.89 would take 0.11 v²/2cp off), as the
page says.

**X10. A choked tip. LIMITATION.** When the tip would leave supersonic at the outside pressure the page gives no back
pressure ("too small") and a lower bound. A real pipe then chokes at its exit with the exit above the outside pressure and
does have a back pressure; the page's answer is to resize, which is the useful one, and it says so.

### Checklist and build sheet

**S2. CORRECT by construction.** `tgSteps` and `tsSheet` read the computing sections' own objects (TS_LAST, TG, TS_X,
TS_PLACE, the oil and intercooler picks; nothing worked out again), and the checklist is drawn after every section in the
same render. The mount rows were the exception (S1).

### Flaky tests

**F1. turbosize_ui "page: 1.775 with the small inlet tube". Cause found, FIXED.** Playwright's `$eval` queries the element
and reads it in a second round trip; the page's ResizeObserver re-renders #i-details on the next animation frame
(requestAnimationFrame(renderActive)), so the read can land on the replaced, detached node, whose innerText has no layout
line breaks: the number was right and the `\s*\n` in the pattern missed. Reproduced every time with a scratch sequence
(read, set the compressor inlet, read at once). The test now reads with one evaluate (query and read together).
Other tests use the same `$eval` pattern on #i-details; not changed here.

**F2. test_header_uel, test_native. Cause confirmed, FIXED.** `router._route` stops on `time.time()`: 40 s a tube by
default, the wide searches at 15% of it. With a 6 s budget (a machine about 7 × busier) test_header_uel fails (P2 0.02 cm
short of the tube gap, P4 2.92 cm short of its length). The tests now pass `time_budget` 1e9, no clock limit (the core's
`deadline_in` takes > 1e7 s as none): the searches run to their node and iteration limits. The router itself is unchanged.
Cost: test_header_uel 57 s → 220 s here. test_native needs the Rust core, which is not built here: it skips, so its change
(400 s → 1e9 s in every route it compares) is unrun. Nothing added to tests/flaky.txt.

### Open after Part 2

- Bowman's drop at the build's density (C3); an Aluminum Design Manual allowable for aluminium fillet welds (M6); exact
  torsion constants for short rectangles (M3); a choked-exit back pressure (X10); Bell's item-page weights and Setrab's
  four fan-pack rows (not re-read); test_native's change is unrun here.

Suites after Part 2 (run_all_tests.py --suite web,fusion --no-build -j 2): 140 tests, 134 passed, 0 flaky, 0 failed,
6 skipped (expected), 7 partial skips, 0 unexpected skips.
