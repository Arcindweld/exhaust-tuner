# Jobs QA round, 2026-11-20 (branch agent38/jobsqa)

Status: started. Read the three audit docs.

## Plan
1. Explore page structure (tabs, presets, ids) -> scratch driver script
2. Drive jobs 1-8 at 1440 and 400 px, record findings here
3. Fix local defects, add web/tests/jobs_ui.js
4. Run tests, write docs/JOBS_QA_2026-11-20.md

## Findings (running list)
- Scratch harness in scratchpad/qa (lib.js, alltabs.js, lone.js). Lone-unit scan of default tabs at 1440: ~100 hits over 13 tabs (many are quoted sources / table rows); Quick sheet "(701 cu in of gas)" only one unit (line ~20625 U==='imp'?..:..).
- J1 Quick: drone-check Helmholtz (3 in neck, 29 L) vs build-sheet Helmholtz (longer neck, ~12 L) look contradictory; text-only clarification candidate.
- J1 preset 2018-20 Mustang GT: note says bore/stroke not found (Gen3 Coyote 93 x 92.7 mm published) - data, report only.
- J1 F1 console error: Mufflers chart #m-tl packed-can curve (abTL) NaN at first point f=fmax/320 when target 45 Hz (fmax 150). Fix: drawTL skip non-finite points. (index.html drawTL ~16827)
- J1 F2 Mufflers parts card prints "· null" when q.mat null (line ~17784 esc(q.mat)). Fix.
- J1 F3 parts cards/Quick muffler cards one unit only (inchTxt 13655, Quick inch 20768). Fix: add second unit.
- J1 F4 quickApply (20803) does not carry head-to-tip length to m-len, nor the sheet's resonator neck (Mufflers shows 3 in neck/29 L, sheet 9 in/740 cu in), nor pipe OD to Hangers hg-od (stays 3 in vs 2.5). Fix carry-over.
- J1 F5 Quick ranks a motorcycle slip-on (Cone Eng. "Motorcycle" PDF, type chambered) first for a 460 hp car; findParts sorts shortest first. PROPOSAL (part choice changes).
- J1 F6 preset 2018-20 Coyote = 302.1 cu in (4951 cc Gen1/2); Gen3 is 5038 cc, 93x92.7 mm. PROPOSAL (preset data).
- Hand checks J1: Stainless Headers area 2.2*460/115/2=4.4 in2 -> 2.5 in (ID 2.37, 4.41 in2) = page. Primary length 850*(180+60)/5800-3=32.17 in = page 32.2. Primary ID sqrt(4600/88200*37.76*1.273)=1.583 in = page 1.58.
- J1 F7 400px: ol.list markers "10." "11." clipped at left (Quick sheet, build order). CSS ol.list padding-left 20px (line 438).
- J2 hand checks: Headers runner 850*240/8000-3=22.5 in = page; primary ID sqrt(4500/88200*35.9*1.273)=1.527 = page 1.53; merge cone (2.67-1.50)/2/tan7.5=4.44 in = page 4.5 in (114 mm).
- J2 P: Headers Smith's rule uses estimated bore/stroke and 2 valves (bore:0,stroke:0,valves:2 at index.html ~16468) -> 44.1 in; 4-Stroke same rule with 87x99 4 valves -> 37.6 in. PROPOSAL.
- J2 P: Headers tuning RPM (8000) and 4-Stroke tuning RPM (6800) independent; same engine shows 22.5 vs 27.0 in primaries. Quick: typing peak RPM clears preset torque RPM -> primary size by 0.7*rpm (1.70 in) vs Headers 1.53 (4500 torque rpm). Report.
- J3 F: Intake key in a boosted build: inlet tube "253 ft/s, most 180 ft/s" warn + Thompson throttle warn after the page's own "Use these sizes" (Garrett 300 ft/s). Contradictory; text clarification + both units (line ~27758 figT 'most 180 ft/s', explainBox spd one unit).
- J3 F8: tsMeasure (index.html ~27232) uses typed i-boost (8 psi -> "2 x boost, 16.00 psi") while the build is at the worked-out 25.99 psi (sheet elsewhere 51.99 psi). Fix: tsBoost().
- J3 P: Sound tab s-ind stays "naturally aspirated" when Intake is turbo. Proposal / hint.
- J4 RS 660 (2021-24 preset exists). Hand: f=4200/60=70 Hz = page; primary L 850*240/9500-3=18.47 = page 18.5; ID sqrt(8500/88200*20.1*1.273)=1.570 = page 1.57; QW drone c/(4f)-0.6133r with gamma 1.35 R 287 at 343 C -> 1731 mm vs page 1719 (0.7%).
- J4 F: Quick sheet for a bike says "To the bumper", "where the floor has room", "a street car needs" (index.html ~20596, 20644, 20646, 20674); "3/8 in plate" one unit (20556). Fix text.
- J4/J1 F: quickApply doesn't set Sound tab resonator target s-hf (stays 120 Hz while drone is 45/70 Hz). Fix carry-over.
- J4 P: bike Quick suggests 11 L Helmholtz can and 2.021 in OD (non-stock) main pipe; maxL 2 m for bikes. Proposal.
- J5 Camaro SS 350 (1967-69 L48 preset). Hand: SH 2.2*295/115/2=2.82 in2 -> 2.25 in (page 2.25; user wants 2.5: set on Crossover). primary ID 1.4215 = page 1.42. X: lc=3/tan20=8.24 in = page 8.2; leg 3/sin20=8.77 = page; merged 2.12*sqrt2=3.00 = page. 4x crank at 2800 = 186.7 Hz = page 187.
- J5/J1 F: quickApply doesn't carry head-to-tip q-sys to Sound s-len / Mufflers m-len. Fix.
- J6 LS3 (engine list "6.2 L LS3, 426 hp as fitted Camaro SS"): hand airflow 376*6000/3456*0.9=587.5 cfm = page 588; v=44.7 m/s=146.7 ft/s = 147; tube for 180 ft/s 80.2 mm = page; BMEP 10.3 bar = page; K&N area 376*6000/20839=108.3 in2 = page 108.
- J6 F: NA Intake explainBox and key one unit (588 cfm, 147 ft/s, 180 ft/s, 86 F/77 F); filter rows cfm/in2/in only (27830-27834). Fix.
- J6: Intake CFD needs the Windows program (OpenFOAM) - not testable here.
