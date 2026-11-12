# Fab audit progress (resumed agent)
Prior WIP (12e2627) reviewed: cope template inside-edge change (matches set-on branch practice: branch ID / header OD) + COPE_HOW text,
cut-list rotation to 0.1 deg + rounding statement, LRA table inMm, coneFlat note, cadtools _tee_note string only (both units; pure
string, tested via fake adsk modules -> keep, not a blind geometry edit). Both new tests PASS (py all pass, ui all pass).
## Inventory (page web/index.html)
cope 14533; cutList 12669/cutListHtml 12710/cutBuyHtml 12722; fxRender LRA 12785; FX cut files 12838; flangedHoles 13144; hgDxf 13324;
mufCutPlan 14491/mufCutDxf 14511; X-pipe sheet 14090; quickSheet/coneFlat 17559/17565; calcBaffles 8565; jigBlock 12364; collectorNets 9115
## Add-in: router.lra_schedule, templates.tee_cope, merge.*, jig.plan, hangers.plan
## Next: verify page-side rotation (cutList p.rot source), hgDxf, flangedHoles, calcBaffles, quickSheet cone inputs (ID or OD?), jigBlock, pie cuts
