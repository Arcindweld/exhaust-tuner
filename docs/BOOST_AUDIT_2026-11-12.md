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

## Open

- Wire the Mufflers / Headers back-pressure results into i-tobp (B13) rather than typing them.
- Bell's figures (Mach 0.4, 2-2.5 x boost, pages) were not re-read; the book is not online.
- Hooper's 45 deg mitres could be offered for 45 deg pie cuts (data in hand, not used: B17).
- A rich-mixture burned-gas composition for the turbine properties (B8).
