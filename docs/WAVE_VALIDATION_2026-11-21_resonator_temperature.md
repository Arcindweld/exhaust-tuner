# Side-branch gas temperature, and the Y-merge, in the 1-D wave model, 2026-11-21

Branch `agent43/restemp`. Solver core only: `wsFactory` in `web/index.html` (JS), `rust/et_wave/src/lib.rs` (Rust), the
embedded WebAssembly (`tools/build_wave_wasm.sh`). The Sound tab's builders (`wsndExt` and the rest) are not touched.

## 1. The finding (docs/SOUND_REALISM_2026-11-21.md, section 5)

A Helmholtz can on the line ran at 920-946 K in the simulation against the 316 K the Mufflers tab tunes it for, so its
note sat near 77 Hz instead of 45 Hz, and moving it did not change the sound the way the page's transfer matrix says.

## 2. Sources consulted

- C. Q. Howard and R. A. Craig, "Adaptive-passive quarter-wave tube resonator silencer", Proc. Acoustics 2011, Gold
  Coast, paper 64 (https://www.acoustics.asn.au/conference_proceedings/AAS2011/papers/p64.pdf). A quarter-wave tube on a
  running engine's exhaust, 507 C just after the catalyst, thermocouples along the tube: about 30 C at its closed end, "a
  significant temperature gradient", the tube's 1.29 m length for 75 Hz equivalent to a 95 C mean. Measured dead-leg data:
  the gas at the closed end stays near ambient; the mouth region is hot.
- B. Schuermans and M. R. Bothien, US 9970659 B2 (2018, priority EP 13180355.3, 2013), damper for a gas turbine
  (https://patents.google.com/patent/US9970659). Hot gas ingested into a Helmholtz damper's neck reaches the cavity only
  if its penetration l_max = integral of the neck velocity over the inflow exceeds the neck length; if it does, the
  cavity's temperature and so its resonance change ("hot gas ingestion"); conventionally prevented by purge air, or by
  making the neck longer than l_max. This is the contact-surface criterion used here.
- J. Holman, Y. Utturkar, R. Mittal, B. L. Smith and L. Cattafesta, "Formation criterion for synthetic jets", AIAA J. 43
  (2005) 2110-2116: a puff pushed out of a round orifice leaves as a jet (is not drawn back by the return stroke) when
  Re/S^2 = L0/(2 pi d) > 0.16, i.e. a stroke longer than about one orifice diameter. Cited from the paper's stated result
  (not re-read in full here).
- The page's own design side: the Mufflers tab's "Gas temp inside the resonator" (`m-tres`, default 43.333 C = 316.48 K,
  hint "Side branches hold still gas and run far cooler than the main pipe"), used by `calcHelm` and `calcQW` through
  `sosExh`; the build sheet's Helmholtz uses the same 43.333 C (`QUICK_TBRANCH`). No citation is given on the page for
  that number; it lies inside Howard and Craig's measured 30 C (closed end) to 95 C (acoustic mean).
- Munjal (Acoustics of Ducts and Mufflers) and Davies treat a side branch's medium as stationary at a stated temperature;
  neither gives a measured dead-leg temperature (from memory of those texts, not re-read for this round). No SAE paper with
  a measured resonator gas temperature was found in the searches made.

## 3. Why the can heats (experiment: the can on its own, the page before this change)

One bank of a cross-plane V8 (`fixtures/wave_jobs.json` "four on one collector", fired at 0, 270, 450, 540), its
collector into a 2.5 in (63.5 mm) line 2.3 m long; a 45 Hz can (1.5 x 6 in neck, 10.1 L) 0.9 m down the line;
1800 rpm full throttle, 16 cycles, dx 20 mm.

| variant (old model) | can gas, cycle 1 / 6 / 16 |
|---|---|
| as it was (started at 600 K) | 637 / 946 / 1046 K |
| started at 316 K | 371 / 795 / 1041 K |
| inflow at the can's own enthalpy (no pipe gas ever reaches the can) | 319 / 318 / 318 K |

So it is not the starting temperature and not the can's energy equation: it is the exchange. The old branch was a
perfectly mixed volume whose every inflow was pipe gas carried straight in, with no wall. The stroke was 1.5-1.9 L per
cycle against the 0.20 L the neck holds, neck speeds to 260 m/s, can pressure 94-119 kPa: about 1.3 g of 1000 K pipe gas in
and out of a 3.5 g can every cycle, all of it mixed and kept.

## 4. What was changed (JS `branchOf` / `branchStep`, Rust `branch_of` / `branch_step`, bit parity)

- The neck's gas is a slug of fixed volume CdA Le moved by the pressure difference, written in the volume flow Q:
  (M / CdA) dQ/dt = CdA (p - pc) - rho Q|Q| / (2 CdA) (- Rp Q CdA for a packed slice), M the mass in the neck. With one
  gas throughout this is the old equation in mdot; with hot pipe gas in the neck the inertance falls and the note rises.
- Contact surface: a tracked length Le + Dn (Dn the bore of area CdA) holds two well-mixed parcels, the gas that came in
  from the pipe and the gas that came out of the can. Toward the can the can-side parcel goes in first; pipe gas reaches
  the can only when a stroke carries the contact surface past the neck (Schuermans and Bothien) and one bore beyond it
  (Holman et al.); the like the other way. Mass, energy (parcels store m h) and fresh fraction move exactly.
- Wall: the parcels and the can lose heat to the shell at Tw by the solver's pipe law (Reynolds' analogy, St = f/2 =
  0.0025, as stepPipe): neck q = 2 f rho cp |Q| (Le/Dn)(T - Tw) shared by volume; can q = 8 (f/2) rho cp |Q| (T - Tw)
  (the flow spread over the cross-section of the page's equivalent volume can, 1.5 diameters long: wall / cross-section
  8). Implicit. No coefficient is fitted: f is the solver's FANNING, 8 is geometry, the extra bore is Holman's criterion.
- Shell temperature `Tw` (new optional field on `exhaust.chambers[]` and `collector(s).branches[]`, K) is the shell and
  the gas's starting temperature (a can's lasting temperature takes minutes, a run under a second; a 1.2 mm steel shell
  holds about 100 times its gas's heat). Defaults: line branches 316.48 K (`BRANCH_TW`, the Mufflers tab's design value);
  header chambers `exhaust.Tw` (the 4-Stroke tab tunes them at the header temperature; 700 K as the old start).
- Hand-off for the Sound tab's builder (not changed here, owned elsewhere): pass `Tw` on pockets and packed slices inside a
  muffler shell (the line's Tw) and the Mufflers tab's `m-tres` on the Helmholtz can and J-pipe; today they all take 316 K.

## 5. Before and after

The page's 45 Hz Helmholtz (Mufflers defaults: 2 x 3 in neck, 29.3 L) and quarter-wave tube (2 in, 1958 mm acoustic), on
a 2.5 in line (`web/tests/restemp_ui.js`, `tools/validation/wave/branch_harness.js`, `resonator_temp.js`):

| check | before | after |
|---|---|---|
| Helmholtz alone on 900 K pipe gas, its resonance (small multisine) | (not separable in the old model) | 47.0 Hz (+4.4 %); 46.0 Hz at a third of the drive; 45.5 Hz with 318 K pipe gas |
| quarter-wave, the same | - | 47.0 Hz (+4.4 %) |
| gas in them | - | 318.0 / 316.5 K |
| engine, cruise 35 kPa, 1800 rpm, 8 cycles: can gas at 0.3 / 0.9 / 1.5 m | 708 / 679 / 648 K | 361 / 351 / 335 K |
| engine, full throttle 1800 rpm, 8 cycles | 879 / 871 / 762 K | 560 / 538 / 422 K |
| order 1.5 (45 Hz) at the tip, cruise, IL at 0.3 / 0.9 / 1.5 m | 10.8 / 6.0 / 1.5 dB | 10.2 / 4.7 / 1.3 dB |
| order 2 (60 Hz), cruise, IL at 0.3 / 0.9 | 14.2 / 18.3 dB | 4.2 / 11.9 dB |

The residual +2 % at vanishing drive is the gas: the solver's burned gas at AFR 12.8 (R 294) against `sosExh`'s
stoichiometric products (R 287), c 358.7 against 352.5 m/s at 316 K (45.8 Hz expected). The rest grows with the drive:
hot pipe gas in the neck's mouth lightens the slug (Howard and Craig's hot mouth). The old model put its strongest effect
on the 60 Hz order (a can at ~700 K is tuned near 45 x sqrt(700/316) = 67 Hz); the new one does not.

Full throttle is a real effect, not a residue: at 1800 rpm the 45 Hz order drives the can at resonance, the neck speed
reaches 200 m/s and the stroke is several necks long, so pipe gas reaches the can every cycle, as Schuermans and Bothien
describe for dampers; a real can would warm too (its shell over minutes). The design rule that follows: a neck longer than
its stroke keeps the can at its design temperature. Cruise ingests little (the can 20-45 K over its shell in 8 cycles).

An insertion loss of one order across a speed sweep (`notch_sweep.js`) is shaped by the line's own resonances in both
models and shows no clean notch at 45 Hz (peak at the 36 Hz end in both); the branch's own resonance (table) is the
clean measure.

## 6. Position against the transfer matrix (restemp_ui 3)

Same layout, plane waves, closed at the valve, the line at the run's mean tip temperature (761 K), the can at 316 K, the
neck's exit loss linearised at the run's peak neck speed (4 rho u / 3 pi A, Rienstra and Hirschberg 8.3, as `branchPeak`),
unflanged open end. Cruise: wave model 10.2 / 4.7 / 1.3 dB at 0.3 / 0.9 / 1.5 m; matrix 21.6 / 16.4 / 5.7 dB. The same
order of the three positions; steps -5.4 and -3.5 dB against -5.2 and -10.7 dB. Tolerance used: same ranking, each step
within 8 dB (the matrix is linear, single-frequency and isothermal along the line; the wave model's pulses are not). Full
throttle: 8.4 / 3.9 / 1.5 against 15.0 / 9.4 / 0.6 dB, same ranking. Before: 10.8 / 6.0 / 1.5 at cruise, also ranked
right at these three places; the old mistuning showed at the other orders (60 Hz), not in this ranking.

## 7. Y-merge (opt.merge)

`opt.merge = {pos: [m along each collector's line], segs: [the one pipe, from the merge], Tw, branches}`: with exactly two
`opt.collectors`, each line is cut at its pos (the rest replaced), both lines and the one pipe meet at one `junctionN`
node (the collectors' own law: one static pressure, flows summed, inflows mixed; it has no loss term), the one pipe is the
only tail (turbine entry, recording). Not with `opt.crossover`; branches/pieces on the two lines must lie before pos.
JS `mergeOf`/`collectorNets`, Rust `MergeSpec`/`split_segs`/`collector_nets`; `merge.branches` is JS-only (`jsOnly`
refuses it, as other line branches). The Crossover tab's "Y-pipe / single exit" choice can be wired to it next round
(`wsndSpec` would set `spec.opt.merge` where it now notes that a Y-pipe is not a crossover).

Checks (restemp_ui 6-8): mass into the node equals mass out at every step (8.5e-15 of the largest flow); a cross-plane V8
(1-8-4-3-6-5-7-2, banks 1-3-5-7 and 2-4-6-8) at 2500 rpm full throttle merged 0.7 m after the collectors into one
3 in pipe: order 4 strongest at the tip (38.4 dB re the d(mdot)/dt unit, then order 3 at 32.6); the orders other than 2
and 4 against order 4 are -5.7 dB merged against +12.2 dB in one bank's own pipe (the half orders that make the
cross-plane burble cancel where the banks meet, as the Crossover tab's sources say of joining the banks); two identical
banks firing in phase merged into a pipe of twice the area behave as one bank into one pipe (no friction or wall heat,
which scale with the bore): VE 0.9563 both, orders 2 / 4 / 6 within 0.00 / -0.33 / 0.06 dB.

## 8. Parity, pins, ABI

- JS / Rust / WebAssembly: `web/tests/wave_wasm.js` (QUICK) all JS-vs-WASM comparisons bit for bit, with two new jobs:
  "chamber shell" (header chamber with Tw 450 K; and the constant gas) and "Y-merge" (two banks merged; the same into a
  turbine with the constant gas and a merge Tw).
- Pins moved (all are specs with side volumes): `fixtures/wave_const_ref.json`, the constant-gamma reference rows of
  "single with a chamber" (As entered, Primaries 10 % shorter, 10 % longer; 12 speeds each), re-pinned by
  `tools/validation/wave/constref_chambers.js`, which touches only rows whose spec has `exhaust.chambers`. Size: VE within
  0.08 %, IMEP within 0.25 % (e.g. As entered 4250 rpm VE 0.9100 -> 0.9099, IMEP 13.117 -> 13.148 bar; 4950 rpm VE
  0.9758 -> 0.9750). The full list (36 rows, old -> new): `tools/validation/wave/results/constref_chambers_2026-11-21.txt`. Reason: the header
  chamber's bleed holes (Le 8.5 mm) now exchange through a tracked neck at the header's 700 K shell instead of mixing
  freely. No other pin was touched.
- Specs without side volumes or a merge: unchanged to the last digit (every other wave_wasm.js job and the
  constant-gamma rows are byte-identical; the solver paths differ only inside `branchStep` and `collectorNets` with a
  merge).
- `WS.rustSpec` / field coverage (`specparity_lib.js`): Rust now reads `exhaust.chambers[].Tw` and `opt.merge.{pos, segs,
  Tw}` (receiver `mg` placed in RUST_RECV, `opt.merge.segs[]` in RUST_CALLS); `opt.merge.branches` is ALLOWed as refused.
- ABI: `et_core.dll` (Fusion add-in, Windows program; `ABI_VERSION` 2 in rust/et_core) does not contain the wave model,
  so its ABI is unchanged. The WebAssembly's exports are unchanged; its results change only for specs with side volumes.

## 9. Not done, uncertain

- The can's lasting temperature is a boundary condition (Tw), not computed from a shell heat balance over minutes.
- The tracked bore beyond the neck rests on Holman et al.'s formation criterion (cited, not re-derived), and a perfectly
  mixed can beyond it; real cans keep a cooler far end.
- The outer end correction (pipe side) is filled with can gas at the start; physically it holds pipe gas.
- `cargo test -p et_wave` not run (the crate has no tests of its own; its parity is wave_wasm.js), to save disk.

## 10. Tests run (2026-11-21, final code)

One at a time: restemp_ui (new) all pass; wave_wasm QUICK all JS/WASM comparisons pass (the three chamber const-ref rows
failed until re-pinned, as listed); wavegas_ui 136; multi_ui 18; wsndpar_ui 8; wsnd_ui 26; wsndxo_ui 7; wsndreal_ui 26;
specparity_ui 44; sim_ui, chamber_ui, incremental_ui pass. A check of the new page against the base commit (3026098) on
every captured wave job without side volumes (first two speeds, default gas): 96 of 96 results identical.
Suite once: `python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`: 151 tests, 144 passed,
0 failed, 7 skipped (host program not built, OpenWAM / F-100 runs absent; expected), wave_wasm full in it passes.
