# agent43/restemp progress (resonator temperature + Y-merge)

## Findings so far
- Hot can cause (experiment, scratch exp1.js): side volume = perfectly mixed, inflow carries pipe enthalpy, no wall loss.
  10 L can for 45 Hz (1.5 x 6 in neck) on 2.5 in line, V8 bank WOT 1800: 637 K after cycle 1 -> 1046 K at 16; started
  at 316 K the same (1041 K): not the initial condition. Inflow at the can's own enthalpy (no pipe gas reaching the can):
  stays 318 K. Displacement range per cycle 1.5-1.9 L vs neck slug volume CdA*Le 0.20 L; neck u up to 260 m/s; can p
  94-119 kPa.
- Design temperature: m-tres default 43.333 C (316.48 K), uncited hint only. Literature: Howard & Craig AAS 2011 (QWT
  1.29 m on 507 C exhaust: closed end ~30 C, acoustic mean 95 C); Schuermans & Bothien US 9970659 B2 (hot gas penetrates
  the neck by l_max = int u dt; cavity protected when L_neck >= l_max; ingestion heats cavity, shifts resonance).
- Rust has exhaust.chambers (primary) only; collector branches + crossover are JS-only (rustSpec refuses).
- et_core.dll ABI (ABI_VERSION 2) does not contain et_wave: no ABI impact.

## Plan
1. JS: branchStep with contact-surface neck (two parcels, fixed neck mass rho0*CdA*Le), Tw field (shell T, init T),
   Reynolds-analogy wall loss in neck and can; defaults Tw: line branches 316.48 K, primary chambers exhaust.Tw.
2. Rust twin for exhaust.chambers; WASM rebuild; parity.
3. Y-merge opt.merge in collectorNets / collector_nets; rustSpec coverage.
4. Tests + doc.

## Status
- [x] 1-3 done; [x] 4 tests+doc; targeted tests pass (wavegas 136, multi 18, wsndpar 8, wsnd 26, wsndxo 7, wsndreal 26, specparity 44, incremental ok, restemp all); full suite 151: 144 pass, 0 fail, 7 skipped (expected). DONE
