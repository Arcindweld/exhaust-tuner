# PROGRESS (agent22/point) - delete in final commit
Task: one operating point for the boosted build (C1-C8), see brief.
- [x] before snapshot (scratchpad before.json, legacy fixture)
- [x] mode select i-opm (hp/boost/both), opSolve, p.qd in calcIntake, tsHp()
- [x] back pressure auto (i-tobpsrc), sim pOut at downpipe end
- [x] wastegate range sizing (i-wgbasis)
- [x] C1-C3 single set; inlet coupler OD rule; runner text
- [ ] tests operatingpoint_ui.js; update others
- [ ] docs
- before capture: scratchpad/capture.js -> before.json (old build), after2.json
- tests: operatingpoint_ui passes; section tests get typedPoint (settle.js): boostaudit, boostaudit2, chargeroute, compmap, conflux, icrec so far
- easyflow pins updated (power row, p3 row, timing edits on i-hp)
- docs: usability follow-up + boost addendum drafted; STATUS entry todo; final suite todo
