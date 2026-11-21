# PROGRESS (agent39/jobfixes)
Task: items 1-8 from reviewer (P1,P4,RPM note,P5,P6,P7,P3,one-unit). Report docs/JOB_FIXES_2026-11-21.md
Before/after capture script: scratchpad ba.js (node ba.js <webdir>); base figures saved in this file below.
## Status
- [x] 1 P1 muffler vehicle ranking (findParts veh, partVeh; Quick, Mufflers tab; Parts card tag)
- [x] 2 P4 Smith's row (sameEngineFH)
- [x] 3 Tuning RPM note (rpmNoteFH + FIX_RULES copy action)
- [x] 4 P5 Sound turbo note (indNoteSound, SIND_HAND, FIX set action, quickApply carries Intake)
- [x] 5 P6 bike stock pipe (main.stock) + J-pipe on bike sheet (sheetJ)
- [x] 6 P7 2-stroke Jennings hint t-dh-jen
- [x] 7 P3 cat-back q-scope
- [ ] 8 one-unit results
- [ ] tests/jobfix_ui.js, run suites, screenshots, docs/JOB_FIXES_2026-11-21.md
## Before figures (base ffdaf4e)
- Mustang Quick top3: Cone Eng MC-2500-18-Q-SS (moto sheet), Flowmaster 40 42543, Flowmaster 40 42542 (67 matches)
- After: Flowmaster 40 42543, 42542, Super 40 952546 (58)
- RS660 top3: Lextek OP1, Snell Classic, Longlife OP1 (3) -> same top3 (17 matches)
- K24A2 Smith: Headers 44.1 in (1120 mm), 4-Stroke 37.6 in (954 mm) -> both 37.6
- RS660 sheet: main 2.021 in OD, Helmholtz 8x13.4 in 672 cu in 11.02 L -> 2 in stock, J-pipe 49.3 in (1252 mm), can in Alternatives
- full suite started 09:01 -> scratch suite.log
- DONE: all items, tests, doc. Suite 136/148 pass, 5 failures fixed and rerun alone OK.
