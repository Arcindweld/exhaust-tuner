# Fab audit progress (resumed agent)
Prior WIP (12e2627) reviewed: cope template inside-edge change (matches set-on branch practice: branch ID / header OD) + COPE_HOW text,
cut-list rotation to 0.1 deg + rounding statement, LRA table inMm, coneFlat note, cadtools _tee_note string only (both units; pure
string, tested via fake adsk modules -> keep, not a blind geometry edit). Both new tests PASS (py all pass, ui all pass).
## Inventory (page web/index.html)
cope 14533; cutList 12669/cutListHtml 12710/cutBuyHtml 12722; fxRender LRA 12785; FX cut files 12838; flangedHoles 13144; hgDxf 13324;
mufCutPlan 14491/mufCutDxf 14511; X-pipe sheet 14090; quickSheet/coneFlat 17559/17565; calcBaffles 8565; jigBlock 12364; collectorNets 9115
## Add-in: router.lra_schedule, templates.tee_cope, merge.*, jig.plan, hangers.plan
## Next: verify page-side rotation (cutList p.rot source), hgDxf, flangedHoles, calcBaffles, quickSheet cone inputs (ID or OD?), jigBlock, pie cuts
## Verdicts so far (resumed agent)
- cope (page): inside-edge line matches set-on-branch practice; UI test 3 cases worst 0.000 mm. OK after prior fix. Added to COPE_HOW: square/on-centre only, 25 mm margin lost at longest side (QUESTIONABLE -> stated).
- tee_cope (add-in) depth: 4 cases marched, OK.
- bend table round trip (router.lra_schedule): 3 paths 0.00000 mm; sign pinned; OK.
- cut list (page): arcs (CLR, CLR+-OD/2)xA, kerf; inches 1/16 (<=0.8 mm off) mm 0.5: QUESTIONABLE (stated).
- X-pipe: miter a/2, window, opening sampled OK; build-step lengths moved clen (0.1 in/1 mm) -> bothL (0.01 in/0.1 mm). 
- merge (add-in): plate holes, outlet area, cone/spike/sleeve flats: 4 cases OK.
- jig.plan: 2 paths OK.
- coneFlat (page): 3 cases OK. Two-stroke quick sheet pointed to a non-existent '2-Stroke tab layout' -> added blanks to build list (QUESTIONABLE -> fixed).
- muffler cut (page): round + oval (W=206.23, area preserved 18241.5 mm2, wrap 529.75 = 2(W-H)+pi(H+cw)) OK by probe.
- hangers (page): across foot arc r = OD/2 at the axis; along edge at sqrt(Ro^2-(t/2)^2): OK (probe, 4 parts).
- flange presets: in-note inch->mm conversions all consistent (read).
- pie cuts/lobster: no calculator on page or add-in (parts catalogue category only). perforation layout: none (porosity input only).
## Next: add tests for 2-stroke blanks + X sheet units + oval wrap + hanger foot; run test suite; write doc + STATUS.
- DEFECT FIXED jig.py _cradle + saddle loop: block top sampled over arc length +-half, but the block is half long LEVEL; on a slope
  the block's downhill end stood above the centreline: before fix worst +6.07 mm (1 in tube, 55 deg, cradles), +4.96 mm saddles,
  +4.04 mm steep path; h cos(slope) 3.48 mm > lift-out limit sqrt((r+c)^2-r^2)=2.53 mm -> binds. After: <= +0.009 mm.
  New helper _top_under; test_jig rising-tube expectation corrected: top at s - 1/cos20 (not s - 1) along tube, same 1e-6 tol.
- Previous agent's jig test compared top with the same arc-length rule (not independent) -> replaced by footprint reference.
## Next: grep miter in add-in; run full test list; doc + STATUS.
