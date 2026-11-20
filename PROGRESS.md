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
