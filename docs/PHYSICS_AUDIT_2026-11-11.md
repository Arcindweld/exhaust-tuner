# Physics audit of the closed-form results, 2026-11-11

Scope: the closed-form (non-solver) results of the Headers, 4-Stroke, 2-Stroke, Mufflers, Sound, Boom tube, Crossover,
Cats (back pressure) tabs, the collector, tailpipe/back-pressure, charge/boost and heat estimates. Not audited: the 1-D
wave solver (`runSpeed` and the `wsFactory` model), the embedded `/* intake_cfd.js` block, and the Intake tab's
`calcIntake` / `craneEntryK` / `bendK` (owned elsewhere). The question asked: is there the same class of slip the Intake
audit found (a coefficient for the wrong geometry, a roughness for the wrong material, friction counted twice, an end
correction or a dynamic head taken at the wrong place, a wrong temperature basis, wrong units)?

Method. Each formula was read in `web/index.html` (line numbers below are the file after this audit's edits), checked for
units, physical basis, double counting, validity range and source, and recomputed independently in a plain Python
script written from the sources (not from the page's code); the page was then driven with Playwright through a test
hook (`window.__physAudit`) and through its own result rows. Every worked example is asserted in
`web/tests/physaudit_ui.js`. "Verified" below means checked against a source read during this audit; "memory" means
checked against the standard textbook form from memory; "page" means only the page's own transcription of a source not
reachable here (the owner's copies of Munjal 1987, Blair, Morse and Ingard and others are not online).

Sources read during this audit: Stainless Headers' primary-length and primary-sizing pages (Bell's 850 ED / rpm - 3
and the 88,200 rule); Southampton APAC 2018 paper 615 (eprints.soton.ac.uk/455667: alpha = 0.6133 x neck diameter after
Selamet, Kim and Huff 2009); the IJEMS 20(5) back-pressure paper (eprints.soton.ac.uk/435591: cross-flow element drops
in dynamic heads against the open-area ratio OAR, after Munjal et al. 2013); Calton and Sommerfeldt (physics.byu.edu
publication 2821: Ji 2005's side-branch end-correction coefficients, eq. 3); and the repository's
docs/research/duct_acoustics_check.md (Rienstra and Hirschberg end corrections, read 2026-11-04).

Sound speed: `sos(t) = 20.05 sqrt(t + 273.15)` everywhere: air, gamma 1.4, R 287.05 (sqrt = 20.046, the constant
rounded 0.02 % high). See Q1.

## Defects found and fixed

| # | Formula, where | Inputs | Page before | Page after | Independent | Error before | Source | Verified |
|---|---|---|---|---|---|---|---|---|
| D1 | Plug (cross-flow) muffler back pressure, Mufflers tab, renderMuf (index.html ~14721); `mufBackPressure` 'crossflow' | 60.198 mm pipe, 152.4 mm shell, 100 mm perforate each side, 10 % porosity, Mach 0.15 | 4.52 H, 7.2 kPa | 2.81 H, 4.5 kPa | open area / pipe area n = 4 x 0.10 x 100 / 60.198 = 0.664; 2.25 + 2[(1-n)^2 + (1-n)/2] = 2.811 H = 4.485 kPa | +61 % | Munjal 1987, 8.3 eq. 8.7 as transcribed in the function's own comment: n = perforate open area / pipe area; the call passed the chamber ratio (d/D)^2 = 0.156 | page (Munjal not online); that OAR is the governing variable is verified in the IJEMS paper. See Q7: newer measurements run much higher |
| D2 | Baffled-chamber back pressure, Mufflers tab, renderMuf (~14734) | 60.198 mm pipe, 152.4 mm shell, 3 chambers, 50 mm holes, Mach 0.10 | 3.62 H, 2.6 kPa | 4.5 kPa (holes at Mach 0.14) | each hole's contraction 0.5(1-n) and expansion (1-n)^2 in the hole's own dynamic head = pipe head x (A_pipe / A_hole)^2 = 2.10: 6.355 H = 4.508 kPa | -43 % (-74 % with 40 mm holes at Mach 0.15: 6.1 against 23.6 kPa) | Munjal 1987 eq. 8.4 (losses in dynamic heads of the narrow section); Borda-Carnot / Crane sudden expansion and contraction | memory (textbook: loss coefficients are referred to the smaller section's velocity); the code had computed the hole/pipe area ratio and left it unused |
| D3 | Sound tab "J-pipe cut length, as an alternative", `calcSound` (6619) | 38.1 mm branch, 60.198 mm pipe, 120 Hz, 43.3 C (defaults) | 731.5 mm (flat 0.3 d end correction) | 732.7 mm | Ji 2005 end correction a(0.9326 - 0.6196 x), x = 0.633: 10.30 mm; L = 743.0 - 10.30 = 732.7 mm | -1.1 mm (0.15 %) | the page's own `calcQW` (Mufflers tab) uses Ji 2005 and states the flat 0.3 d is twice too much at x = 1; the Sound tab still used it | coefficients verified (Calton and Sommerfeldt eq. 3); the definition of x as branch / main diameter is from memory of Ji 2005 (Calton's wording is neck / branch) |
| D4 | Charge-pipe pressure loss, Intake tab boosted, `calcCharge` (19538) | Q 0.2 m3/s at outside density, 60.198 mm ID, 914 mm hot and cold, 4 bends, PR 2, 70 % compressor, 75 % intercooler, 7 kPa core | pipe friction 1,059 Pa (f 0.0197), total 9.48 kPa | 818 Pa (f 0.0154), 9.24 kPa | Haaland with 0.0015 mm: 818.2 Pa, total 9,238.6 Pa | pipe friction +29 % (total +2.6 % here; more where the core loss is small) | commercial steel 0.045 mm (the page-wide ROUGH, Moody's commercial steel pipe) on the 6061/6063 aluminium or 304 stainless 0.065 in tube the same section tells the owner to build from; drawn tubing 0.0015 mm (Moody 1944, Crane TP-410 A-23): the Intake tab's smooth-tube slip again | memory (Moody / Crane table values; the Intake tab carries the same citation) |
| D5 | "Check against Stone's chart" text, Intake tab boosted, `b5BoostSections` (~11731) | PR 2 and 3 | "the formula lands within 0.03 of the chart" | within about 0.03 at eta 0.7-0.8 and with the intercooler; 0.035 low at eta 0.6, 0.06 low at eta 0.5, 0.07 high on PR 3 "about 1.9" | Stone: PR / [1 + (PR^0.2857 - 1)/eta]: 1.570, 1.523, 1.465, 1.391 at eta 0.8-0.5; with IC 1.778, 1.828, 1.882; PR 3 1.965 | a claim, not a number | the page's own chart readings | page |

Validity note added (step 5): the baffled-chamber row now says when its total exceeds 10 % of the pressure that the
incompressible loss coefficients no longer stand (Crane TP-410, ch. 1, the 10 % / 40 % rule for using incompressible
formulas on gas; memory) and to read the figure as a lower bound.

Test expectations changed: none. No existing test encoded any of these values (perfflow_ui.js checks the chamber
expansion/contraction/tail coefficients, which were right and are unchanged). The new physaudit_ui.js fails 8 checks on
the page before these edits (run against `git show HEAD:web/index.html` with only the test hook added) and passes after.

## Questionable (left unchanged, for decision)

| # | Item | Numbers | Recommendation |
|---|---|---|---|
| Q1 | `sos()` is air (gamma 1.4, R 287) for exhaust gas everywhere: 2-stroke tuned lengths, round-trip times, every resonance and branch length, Helmholtz volumes | burned gas near 1.34-1.35 / 289-290 J/kg K gives c 1.3-1.8 % lower: lengths that scale with c 1.3-1.8 % long, Helmholtz volumes 2.6-3.7 % big. The page's Yasuda caption already shows the effect (252 against 247 Hz). Smaller than the uncertainty in the gas temperature itself (100 C moves c 5-7 %) | an exhaust-gas sos (gamma(T), R 289) for exhaust-side results, with the source (Heywood ch. 4 burned-gas properties) and the tests' numbers moved together; or say on the Method page that c is air at the entered temperature |
| Q2 | Boom tube friction uses ROUGH = commercial steel 0.045 mm (`calcBoom`, 8285) | at Re 1-2e5 on a 50 mm hydraulic diameter f is 20-31 % above drawn tube (0.0216 against 0.0179 at 1e5); welded/flattened mild or stainless sheet is between (0.015 mm: 0.0192) | a finish select as on the Intake tab, or 0.015 mm for formed sheet with a source; not changed because a fabricated, welded sheet-steel tube is not plainly "smooth" |
| Q3 | Boom flare loss is zero below an 8 degree equivalent cone (`phi`, 8310) and the transition K 0.05 (8312) is uncited | a conical diffuser at 8 deg still loses about 0.1-0.2 (1 - A1/A2)^2 of the inlet head (Idelchik diagram 5-2; Gibson; memory) | use a cited diffuser loss (Idelchik 5-2 or Rennels) and cite the transition K |
| Q4 | Charge-pipe bends: 0.2 velocity heads per 90 deg on top of friction over the full lengths, uncited (19547) | if 0.2 is read as Idelchik's local loss (A1 B1 C1 = 0.21/sqrt(R/D), 0.17 at R/D 1.5) there is no double count; if read as a handbook total K (Crane 14 fT = 0.21-0.25) the arc friction (about 0.045 per 1.5D bend) is counted twice, 20 % of the bend loss | cite it as Idelchik's local term, or reuse the Intake tab's `bendK` convention |
| Q5 | Helmholtz neck end correction 0.6133 x d (`HELM_END`, calcHelm, calcSound) | verified against its cited source (APAC 2018 after Selamet et al. 2009, a concentric resonator; the same paper uses 0.8271 d for side necks). Rienstra's per-end values (0.85 a flanged into the cavity + about 0.82 a on the duct side, Ji) give about 0.83 d: f 3-4 % lower on a 50 x 76 mm neck | keep (sourced); note on the row that the correction is geometry-dependent and the neck should be trimmed by ear, as the J-pipe text already says |
| Q6 | Yasuda end corrections 0.61 x d per open pipe end (twice Levine and Schwinger's 0.6133 a), two on the return pipe | on the paper's specimen the page gives 252 Hz (paper 241 Hz); 0.6133 a per end would give 286 Hz, further from the paper | keep: the larger value reproduces the paper better; the paper (Applied Acoustics 74, 2013) could not be read here to confirm its wording |
| Q7 | Plug-muffler back pressure itself: Munjal 1987's 2-2.5 H (+ the hole term) | the cross-flow correlations of Munjal et al. 2013 (as given in the IJEMS paper: expansion 3.136 OAR^-1.391, contraction 2.208 OAR^-1.5818, OAR 0.3-2.2) give 9.7 H at OAR 0.66 against the corrected 2.8 H (and the old 4.5 H) | adopt the 2013 correlations for the plug row (they are measured and state their range), after reading the 2013 paper itself |
| Q8 | Shell ovaling of a long round tube uses the thin-ring formula with E (`calcShell`, 6666) | an infinitely long cylinder in plane strain has E / (1 - nu^2) (Blevins, Formulas for Natural Frequency, table 12-2; memory): 3.9 % (304), 4.5 % (mild), 7.6 % (titanium) higher | use E / (1 - nu^2) for the long-tube case after checking Blevins; `ringModes` (non-round) would need the same |
| Q9 | Baffled chain filter counts N hole inertances for N chambers (`calcBaffles`), while the back-pressure row (and the can) has N - 1 baffles | f0 and the per-chamber attenuation assume the inlet pipe acts as the first hole | check against Morse and Ingard 9.1's boundary conditions |
| Q10 | Catalyst inlet cone is a sudden expansion (Borda) whatever its length and angle (`catDp`, 8138) | conservative for a real cone | use the cone angle (Idelchik diffuser) |
| Q11 | Exhaust density and volume flow at atmospheric pressure (`engineFlow`, 8072) for every Mach, velocity and loss downstream of the engine; intake density at 25 C | at a few kPa of back pressure 2-5 % in density; small | keep; say so where Mach is shown |
| Q12 | Boom panel mode `fBase + kp / a^2` when the base is the ring mode (8324) | an additive rule, not a plate solution | note as an estimate |

## Inventory and checks, by tab

Legend: OK = units, basis, double counting and source checked with no fault; the worked example is in
physaudit_ui.js unless marked "-".

### 4-Stroke and Headers

| Result | Function (line) | Formula as coded | Source cited | Checks | Worked example (independent / page) | Verdict |
|---|---|---|---|---|---|---|
| Tuned primary length | calcFour (6339), calcLayout (6787), calcQuick (9394) | (850 (180 + EVO) / rpm - 3) in x 25.4; port length taken off the tube | A. Graham Bell, Four-Stroke Performance Tuning | inch/mm right; ED = 180 + EVO; empirical, no c | 4-cyl 6500 rpm EVO 60: 720.969 / 720.969 mm | OK (verified, Stainless Headers' page) |
| Collector diameter | calcFour, calcLayout | d sqrt(n x ratio); Tri-Y secondary d sqrt(k x ratio) | page rule (area ratio) | area basis consistent; uses ID | 44.45 mm, 4 x 0.8: 79.515 / 79.515 | OK |
| Merge cone, megaphone lengths | coneLen (6336) | abs(d2 - d1) / 2 / tan(angle/2) | geometry | included angle | - | OK |
| Wave round trip | calcFour | 2 L / c, x 6 rpm for degrees | - | c at the entered EGT | 92.328 / 92.313 deg (sos rounding) | OK |
| Primary ID from the engine | calcPrimarySize (6893) | rpm x CID per cylinder / 88,200 in^2; ID = sqrt(1.273 A) | Stainless Headers | cc / 16.387 per cylinder; peak-torque rpm | 5.7 L V8 at 4500: 42.688 / 42.684 mm (1.273 for 4/pi) | OK (verified) |
| Collector area growth, Cone bands, Sanderson | collectorGrowth (8589) | (D_out/D_in)^2 - 1; ratio = (1 + g)/n | Cone Engineering table, Sanderson 2007 | ID basis; 1.75^2 - 1 = 206 % | b4_ui.js (+220 % at 0.8) | OK (page) |
| Vizard Fig. 5-8 length, Smith and Wenner pipe | vizardPrimary (8600), smithPipe (8608) | table interpolation; A S D^2 / (1400 d^2) ft | Vizard 1983; Smith and Wenner 1977 | units in/ft/mm right | b5_ui.js | OK (page; books not online) |
| Header skin, steel and wrap temperature | calcSkin (13702), outerH (13694) | Gnielinski with Petukhov f x CAF; wall ln(r2/r1)/(2 pi k); Churchill-Chu natural + Churchill-Bernstein forced, cubed sum; grey radiation | Gnielinski; Konstantinidis 1997 / Daniel CAF | per-primary mean flow = engine flow / cylinders; gas cools by q dx / (m cp); air properties for the gas (k 3 % high at 1000 K) | 0.02 kg/s at 760 C in 44.45 mm: Re 13,531 / 13,531, h_i 149.37 / 149.37 W/m2 K | OK (memory: standard forms) |
| Clearance to nearby parts | nearTemp (13726), clearFor | view factor r/h x (2/pi) atan(L/2h); eps_t eps_s exchange; one face cooled | page | conservative by design | - | OK |
| Hanger isolator temperature | hgFin (13294) | 1-D fin, Churchill-Chu vertical plate, view (1 - cos b)/2 | page | perimeter counts edges (small) | hang_ui.js | OK |
| Header resonance can (holes) | calcHdrChamber (8675) | f0 = c/2pi sqrt(nA / (V (t + 0.85 d))); 3 dB band as calcHelm | Rienstra 0.85 a per flanged side | 0.85 d = both sides of a hole in a wall; n holes in parallel | 4 x 6 mm holes, 76.2 x 100 mm can, 500 C: 537.70 / 537.79 Hz | OK (verified via duct_acoustics_check.md) |
| Heat growth | heatGrowth (6642) | alpha (T - 20) L | nsxprime table, Atlas | per-F values x 1.8 checked | - | OK |
| Collector exhaust CFD, UEL, OpenWAM feeds | - | solver side | - | not in scope | - | - |

### 2-Stroke

| Result | Function (line) | Formula | Source | Checks | Worked example | Verdict |
|---|---|---|---|---|---|---|
| Jennings tuned length | calcTwo (6371) | ed c / (12 rpm) x 1000 | Jennings 1973 | = Jennings' E Vs / N in with Vs in ft/s; c at EGT | 9000 rpm, 190 deg, 500 C: 980.63 / 980.79 mm | OK (memory) |
| Diffuser, belly, baffle, stinger | calcTwo | cone lengths from angles; stinger 12 d | Jennings | geometry | - | OK |
| Blair tuned length and sections | calcTwoBlair (6419), calcTwoSpec (6460), blairAt (6453) | Lt = 83.3 a0 theta / rpm; shares 0.10/0.41/0.14/0.11/0.24; D2 = D3 (L1/(L1+L2))^1.33; BMEP = P / (Vs rev/s) | Blair 1996 via "How Two-Stroke Expansion Chambers Work" | 83.3 = 1000/12; one power stroke per rev; temperature by class | GP 12000 rpm 195 deg: 824.80 / 824.61 mm | OK for Lt (memory); D2 exponent and class table page only |
| Exhaust period in ms | calcTwo | ed / (6 rpm) | - | deg per s = 6 rpm | - | OK |

### Mufflers

| Result | Function (line) | Formula | Source | Checks | Worked example | Verdict |
|---|---|---|---|---|---|---|
| Helmholtz volume and band | calcHelm (6961) | V = A c^2 / (w^2 Le), Le = l + 0.6133 d; TL 10 log[1 + (K/(f/f0 - f0/f))^2], K = sqrt(A V / Le) / 2S | Munjal; APAC 2018 / Selamet | branch gas at tres; band from TL = 3 dB | 50.8 x 76.2 mm neck, 120 Hz: 4.2238 / 4.2252 L, band 188.26 / 188.29 Hz | OK (Q5) |
| Real peak with neck loss | branchPeak (6955) | R = (4K / 3pi) rho u; quadratic for u | Rienstra and Hirschberg 8.3 | the stable root form | - | OK (page) |
| J-pipe (quarter wave) | calcQW (6975), branchEndCorr | L = c/4f - Ji end correction; TL 10 log(1 + (Ab/2S tan kL)^2) | Ji 2005 / Calton and Sommerfeldt | tres | 60.198 on 60.198, 120 Hz: end 9.421 / 9.421 mm, L 733.56 / 733.68 | OK (verified coefficients) |
| Plain, extended-tube, reverse-flow chamber | calcChamber (7007) | 10 log(1 + 0.25 (m - 1/m)^2 sin^2 kL); pockets as closed shunts; fCut 1.8412 c / (pi D) | Munjal 1987 2.13-2.14, 3.7 | tmain | 152.4 x 355.6 chamber: 10.324 / 10.324 dB at 349.93 / 349.99 Hz | OK (memory: standard) |
| Chamber back pressure | mufBackPressure (6994) | H = gamma p M^2 / 2; (1-n)^2 H in, (1-n)/2 H out; reversal 1 H + 0.5 H | Munjal 1987 eq. 8.4 | H = rho U^2 / 2 identically; n = smaller / larger; pipe velocity is the narrow one | Mach 0.15, 2.37 in into 6 in: 1810.16 / 1810.16 Pa | OK |
| Plug back pressure | renderMuf (~14721) | 2.25 H + 2[(1-n)^2 + (1-n)/2] H for n < 1 | Munjal 1987 8.3 eq. 8.7 | **n was the chamber ratio** | see D1 | DEFECT, fixed; Q7 |
| Baffled-chamber back pressure | renderMuf (~14734) | as eq. 8.4 per hole | Munjal 1987 | **hole losses on the pipe's head** | see D2 | DEFECT, fixed |
| Packed can, plug muffler TL | calcAbsorb (8402), calcPlug (8437), perfZ | coupled two-duct plane waves (Sullivan and Crocker), Antebas fibre fits, Rao-Munjal / Sullivan perforate impedance | as cited | transfer-matrix conventions consistent; flow term 7.337e-3 x 72.23 M | perfflow_ui.js, plug_ui.js | OK (page) |
| Baffled chain filter | calcBaffles (8480) | L = rho (D0 / 4 S0 + t / S0), C = V / rho c^2, f0 = 1 / 2pi sqrt(LC), 8.686 acosh(w^2/2w0^2 - 1) per section | Morse and Ingard 9.1 | D0/4 S0 = 1/d = Rayleigh's conductivity 2a of a thin hole | 3 chambers, 40 mm holes: 335.43 / 335.48 Hz | OK (memory: Rayleigh conductivity); Q9 |
| Installed attenuation, insertion loss | installedAL (8499), insertionLoss (8517) | Davies R0(ka), l0(ka); Munjal 2.15-2.16 | as cited | open-end impedance from r = -R0 e^-2ikl0 | installed_ui.js | OK (page) |
| Davies rules | calcDavies (8535) | l1 = c/4f; 3^(-1/m) set; l0/a = 0.6133 - 0.1168 (ka)^2; e21 | Davies 1996 | l1 is quoted as c/4f, the end correction listed beside it | b4_ui.js | OK (page) |
| Yasuda sizing | calcYasuda (8554) | f_TP = c/2pi sqrt(S / (V l)), f_RT, hole terms; 0.61 d per open end, 0.85 d per hole | Yasuda et al. 2013 | per-end correction twice Levine-Schwinger (Q6) | specimen 251.63 / 251.63 Hz; equal halves 246.71 / 246.71; f_TP 56.384 / 56.384 | OK (Q6) |
| Auger, timbre bundle | augCalc (14469), ttMatrix (14507), ttTune (14522) | parallel-duct admittance; 0.3 d per tube end | US patents (no formula) | 0.3 d = 0.6 a, unflanged; an assumption, stated | auger_ui.js, timbre_ui.js | OK |

### Sound (closed-form parts)

| Result | Function (line) | Formula | Source | Checks | Worked example | Verdict |
|---|---|---|---|---|---|---|
| Firing frequency, pulse orders | calcSound (6558), pulseOrders (6536), pathPulses | k = cyl x (0.5 four-stroke, 1 two-stroke and rotor) per rev; Fourier amplitude of the pulse train | - | rotor fires once per shaft rev; 720/360 deg cycles | sound_ui.js | OK |
| Pipe modes (one pipe) | calcSound | (2n - 1) c / 4 (L + 0.6133 a) | Levine and Schwinger | c by Simpson's rule through the cooling profile (gasProfile) | 2.5 m, 60.198 mm, 343 C: 49.409 / 49.417 Hz | OK |
| Pipe modes (sections) | pipeModes (8218), chainReal | transfer matrices, tip end correction | - | closed-end condition D = 0 | sound_ui.js | OK |
| Peak height and width | calcSound | R0 (Davies fit, ka < 1.5) and Kirchhoff wall loss (1/ac) sqrt(w nu / 2)(1 + 0.4 / sqrt 0.7); delta = 2 sum aL + 1 - R0; width delta c / 2 pi L | Davies 1996, Rienstra 4.5.3 | round-trip amplitude loss; air gamma, Pr | - (first six modes stay under ka 1.5 on the defaults) | OK |
| Helmholtz volume, J-pipe | calcSound | as calcHelm; J-pipe **0.3 d** | - | see D3 | Helmholtz 3.4391 / 3.4402 L; J-pipe see D3 | DEFECT (J-pipe), fixed |
| Mean-flow shift | renderSound | (1 - M^2) | Morse and Ingard 11.1 | Mach from engineFlow at EGT | - | OK |
| Pipe span, ovaling, ring, panels | calcShell (6658) | beam beta^2 / 2pi L^2 sqrt(EI/m); ring n(n^2-1)/sqrt(n^2+1) sqrt(E t^2 / 3 rho) / pi dm^2; ring c_L / pi dm; plate pi/2 (i^2/a^2 + j^2/b^2) sqrt(D / rho h) | ASME B31.1 moduli | E for a long tube (Q8) | - | OK, Q8 |
| Induction tones | calcInduction (6677) | blade-pass = shaft x blades; Roots 2 x lobes x rotor; screw male lobes | - | rev/min to Hz | - | OK |
| Flex whistle | calcFlex (8353) | St 0.25-0.38 x v / groove | Energies 2018 | - | - | OK (page) |
| Sportiness lean | sportyLean (8577), aWeight | Yang 2024 weights on A-weighted orders | Yang 2024 | IEC A-weighting +2.0 dB form | b4_ui.js | OK |

### Crossover, Boom tube, Cats, Quick

| Result | Function (line) | Formula | Source | Checks | Worked example | Verdict |
|---|---|---|---|---|---|---|
| H, X, Y, Z geometry | calcCross (6908) | X merge d sqrt 2; Y d sqrt(2 ratio); H ratio^2 | geometry / page rules | area basis | x_ui.js | OK |
| Boom tube losses | calcBoom (8287) | Darcy with Haaland (ROUGH 0.045 mm), transition 0.05 q, flare phi (1 - r)^2 q, exit 1 q | - | f is Darcy; exit head 1.0 right | - | Q2, Q3 |
| Boom jet noise | calcBoom | 70 log(v_out / v_in) | Lighthill U^8 at fixed mass flow -> U^7 | right | - | OK |
| Boom panels | calcBoom | simply supported strip, ring mode | - | Q12 | - | OK |
| Catalyst drop | catDp (8131) | Shah-London apparent f Re (square, K(inf) 1.43, C 0.00029); 4 f L/Dh q; face 0.5(1-s) + (1-s)^2; cone Borda + 0.05 | Shah and London | Fanning x 4; Dh = cell width | 400/6, 0.1 m, 3 m/s, 500 C: Re 43.152 / 43.152, fRe 14.399 / 14.399, 245.36 / 245.36 Pa | OK (memory), Q10 |
| Catalyst TL | catTL (8141), narrowTube | Stinson narrow tube, r = 0.530 w for the square cell | Stinson 1991 | 0.530 = sqrt(8 / 28.454), equal laminar resistance | - | OK |
| Davis dyno loss | davisLoss | interpolation | one dyno test | - | - | OK |
| Engine flow | engineFlow (8072) | swept / 120 (4-stroke) or / 60; x VE x rho; exhaust at EGT, atmospheric | - | rotary once per shaft turn right | - | OK, Q11 |
| Quick main pipe, drone lengths | mainPipeSize (9353), calcQuick | 2.2 cfm/hp / 115 cfm per in^2 on the inside area; (2k-1) c / 4f - 0.6133 a | Stainless Headers, SMSP, Morris | inside area | quick tests | OK |

### Charge and boost (Intake tab, boosted)

| Result | Function (line) | Formula | Source | Checks | Worked example | Verdict |
|---|---|---|---|---|---|---|
| Compressor outlet temperature | compOut (19533) | T1 (1 + (PR^0.286 - 1) / eta) | ideal gas | K basis right | - | OK |
| Charge-pipe speeds and loss | calcCharge (19538) | Garrett's cfm / area; actual rho and v; Darcy (Haaland) + 0.2 q per bend + core | Garrett | **wall roughness**; bend K (Q4) | see D4 | DEFECT, fixed; Q4 |
| Fill volume and time | calcCharge | V (rho_avg - rho_amb) / m | - | - | - | OK |
| Surge check | surgeCheck (8629), b5BoostSections | map interpolation; inlet cfm x T1 / T3 | Vizard Fig. 11-1A | correction direction right | b5_ui.js | OK |
| Density ratio | densRatio (8639) | PR / (1 + x/eta); with IC T3 = T1 (1 + (1 - eps) x / eta) | Stone | gamma 1.4 | PR 2: 1.5701, 1.5234, 1.4652, 1.3908 / same | OK; claim text D5 |
| Taylor Mach index, Vizard hp per cfm | machIndex (8653), VIZ_HP28 | Z = (pi/4 B^2 Up) / (Af ci); 1.05 / 4 / sqrt(28/25) | Taylor via K&F; Vizard | Up = 2 S N / 60 | b5_ui.js | OK |

## Counts

| Tab / area | Formulas checked | Defects | Questionable |
|---|---|---|---|
| 4-Stroke and Headers (incl. collector, heat) | 13 | 0 | 0 |
| 2-Stroke | 4 | 0 | (Q1) |
| Mufflers (incl. resonators, back pressure) | 14 | 2 (D1, D2) | Q5, Q6, Q7, Q9 |
| Sound (closed form) | 10 | 1 (D3) | Q1, Q8 |
| Crossover, Boom, Cats, Quick | 10 | 0 | Q2, Q3, Q10, Q11, Q12 |
| Charge and boost | 6 | 2 (D4, D5 text) | Q4 |
| Total | 57 | 5 | 12 |
