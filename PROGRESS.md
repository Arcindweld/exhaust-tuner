# K24 support (branch agent5/k24) — progress, 2026-11-12
Scope: engine data tables + small hooks only. Not touching: wave solver / rust/et_wave, fab tools, turbo wastegate input, catDp.

## Step 1 audit (in progress)
- Preset mechanism found: VEH (stock vehicles), MOTORS_NEW (engine-only, `code/maker/family/...`), applyVehicle() fills
  s-/h-/f-/c-/b-/i-/q- fields (engine layout, cc, rpm, hp, bore/stroke/cr/valves).
- CAM_LIB (4-Stroke tab "stock engine and cam"): per-engine bore/stroke/cr/cam events/lift/valve sizes with CAM_SRC.
- Existing K entries: VEH 2012-15 Civic Si K24Z7, MOTORS K20A2/K20A/K20Z3/K24A2/K24Z7 (src Wikipedia Honda_K_engine).
