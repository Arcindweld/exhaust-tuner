# K24 support (branch agent5/k24) — progress, 2026-11-12
Scope: engine data tables + small hooks only. Not touching: wave solver / rust/et_wave, fab tools, turbo wastegate input, catDp.

## Step 1 audit (in progress)
- Preset mechanism found: VEH (stock vehicles), MOTORS_NEW (engine-only, `code/maker/family/...`), applyVehicle() fills
  s-/h-/f-/c-/b-/i-/q- fields (engine layout, cc, rpm, hp, bore/stroke/cr/valves).
- CAM_LIB (4-Stroke tab "stock engine and cam"): per-engine bore/stroke/cr/cam events/lift/valve sizes with CAM_SRC.
- Existing K entries: VEH 2012-15 Civic Si K24Z7, MOTORS K20A2/K20A/K20Z3/K24A2/K24Z7 (src Wikipedia Honda_K_engine).

## Sourced K-series figures (read 2026-11-12) — see final table in commit; cam events/TB bore/stock pipe dia: NO source -> null
- K24A2 2004 TSX hondanews spec (release-6a2f3de8...): 87x99, 2354, 10.5, 200@6800, 166@4500, red 7100; intro kit: VTEC >6000 in+ex, rear stainless manifold
- K24A4 2005 Accord sedan hondanews (release-0a2dd347...): 87x99, 9.7, 160@5500, 161@4500, no redline
- K24A8 2006 Accord hondanews.ca (...b00023d9): 9.7, 166@5500, 160@4000 (no bore/stroke, no redline)
- 2007 Element hondanews (release-3207ea02...): 87x99, 9.7, 166@5800 LX / 5500 EX,SC, 161@4000, red 6500 (code not stated)
- K24Z3 2009 TSX acuranews (release-298ef25d...): 87x99, 11.0, 201@7000, 172@4400 6MT / 170@4300 5AT, red 7100
- K24Z7 2013 Civic Si hondanews (release-c93c7e81...): 201@7000, 170@4400, red 7000, "Stainless Steel Exhaust Manifold";
  2012 powertrain release: VTEC intake >5000; manifold integrated into head, rear of engine
- K24W1 2014 Accord hondanews (release-95eca0bb...): 2356, 87x99.1, 11.1, 185@6400 (Sport 189), 181@3900 (182), red 6800, DI
  Honda R&D Tech Review 025-2_17e: valves 36/30 (prev K24Z 36/31), FRONT exhaust, manifold integrated; Wards: VTEC intake >4800
- codes: Skunk2 36/30 valve set fitment (nipponpower): TSX 04-08 K24A2, Accord 03-05 K24A4, 06-07 K24A8, Element 03-06 K24A4, Si 06-11 K20Z3;
  Hybrid Racing water pump: 2013-17 Accord K24W1; Skunk2 header page slug 09-14 TSX k24z3
- valves 35/30 STD: Ferrea set RSP (K20A2,K20A3,K20Z1,K20Z3,K24A2); K24Z7 exhaust 31 STD (Supertech RSP); HPA: 06-08 TSX +1mm intake (conflict)
- studs M10x1.25 x5 (SpeedFactory RSP: K20A2,A3,Z1,Z3,K24A2,A4,A8); flange port 1.771 in (Stainless Headers 6181B, K20-K24 heads)
