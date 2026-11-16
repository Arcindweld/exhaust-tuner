# PROGRESS (spec parity audit, round 2) — delete in the final commit
Branch agent30/specparity2. Never two heavy (chromium) jobs at once.
- [~] 1b preset sweep: 202/598 done in tools/validation/wave/results/preset_sweep.json; resume: node tools/validation/wave/preset_sweep.js (skips done)
- [ ] 1a turbo closure both ways: tools/validation/wave/turbo_closure_parity.js (written, not run)
- [ ] 1c Headers shapes: tools/validation/wave/headers_shapes_parity.js (written, not run)
- [ ] 1d sound: label added to Sound caption; determinism check TODO
- [~] 2 staleness: tools/validation/staleness_sweep.js seeds=1-8 running -> results/staleness_sweep.json; web/tests/staleness_ui.js passes (66 s)
- [x] 3 cam keep rule (camLibOnPreset, f-camkeep, #f-camswap note)
- [x] 4 inventory (project_inventory.js; NOT_SAVED in staleness_ui)
- [ ] 5 runner NOT_TESTS entry for staleness_lib.js; 6 docs; final suite
Findings so far (fixed):
- S1 sound estimate never marked stale (since 0251181 2026-11-05): wsndSig/wsndStale
- S2 SIM.inp only set by renderFour (Sound "Open the 4-Stroke tab" on fresh load; Intake plan used old engine after preset on other tab): simInpRefresh in renderActive/refreshTabResults
- S3 preset power hold (HP_PRESET) lost on project load (since 416d184 2026-11-14): hpPreset saved
- P1 not saved: p-od/p-wall (Parts tube), HUEL.T/route (h-uel-t, h-uel-route), wsnd-rpms/load/dead
- cam library kept across preset (since 31c3a2a 2026-11-03): rule implemented
- S3 producers refreshed off-tab (refreshDeps, INPUT_GEN) — measure perf (scratch perf.js)
- S4 mufflers error legend; S5 OpenWAM stale; P4 AUG/MD/TT; P5 mufFrom
- Sweep round 1 seeds 1-8 (309 changes) saved at /tmp/claude-0/scratch/stale_round1.json; round 2 seeds 9-16 running
- TODO after: perf, turbo_closure_parity, headers_shapes_parity, sound_determinism, preset_sweep resume, final sweep, docs, suite
