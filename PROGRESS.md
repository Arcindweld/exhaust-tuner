# PROGRESS (audit part 3, delete in final commit)
Findings so far (to fix / write up):
- A1 open-period basis: runner speed/Mach/loss default open-period; dur from i-mdur else 4-stroke f-evo+180+f-evc (evc est max(10,evo-40)); loss: runner pieces k^2, collector rms count; cycle avg = phi*open
- A2 MacInnes + Bell are AutoSpeed paraphrases, not quotes: page puts them in quote marks (fix wording)
- A3 cut list elbow weight always LR; Ace SR 10S/40S weights: 1.25 .38/.45, 1.5 .49/.63, 2 .81/1.13, 2.5 1.36/2.25
- A4 p3 static vs total: turbineBalance uses p3 total; march starts static at p3 (q ~8 kPa at flange). fix: xSt0 at p3
- A5 corrFlow 460/545 vs corrFlowRef 459.67/545R: ATP source = (T+460)/545 => ref 85F; make both absolute, Garrett fill 85 F
- A6 Fusion: gap = CR hot_gap 50.8mm vs header FX.gap 12.7; page S runs outer runner at R from head -> infeasible? (check with router)
- A7 collector taper vs cone+collector mismatch only in docstring, not on page
- materials OK (304,321,625,347 re-read; 321 sheet's 871 C misprint for 1500 F); B16.9 OK (wermac LR/SR, wikipedia NPS)
- K24 bore spacing: no citable source found -> stays input
- DONE page fixes A1-A7 + corrFlow; tests: boostaudit3_ui (all pass), turbomani_ui, compmap_ui updated
- K24 open-period: 450hp@169.918kPa: 148.1 m/s M0.2219 open (52.4/0.0782 mean), loss 8.99 kPa open (2.00 mean); 600hp@260.332: 139.7/0.2092 (49.5/0.0739), 10.76 (2.39)
- TODO: run turbomani_ui, compmap_ui, turboguide, turbosize; fusion test clearance check + note; skin check py; fails-before check on 5448b2d; doc Part 3; STATUS; full suite
