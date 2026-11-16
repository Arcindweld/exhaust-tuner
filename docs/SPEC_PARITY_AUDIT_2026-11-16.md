# Spec parity audit at the page boundary (2026-11-16)

Why: the previous round found by accident that the browser's WebAssembly path ignored the cam's check lift (a card entered
at 0.050 in or 1 mm ran seat to seat). JS-vs-WASM parity tests had passed all along because `wave_wasm.js` fed both
engines the same, already translated spec: parity was tested at the engine boundary, not where the user lives. This audit
maps every path from the page's inputs to an engine spec, runs the page's own specs both ways, and adds a permanent test
(`web/tests/specparity_ui.js`) that fails when the JavaScript reads a spec field the WebAssembly does not.

## 1. The paths from inputs to an engine spec

| Builder | Where | Consumers | Engine it runs on |
|---|---|---|---|
| `simSpec(q)` from `simInputs()` (4-Stroke tab, + Intake tab fuel via `fuelSpec`) | web/index.html | 4-Stroke wave simulation (`simVariants` / `simEntries`: as entered, without the chamber, primaries -10 / +10 %, evenly fed, cam advances, low profile) | sweep worker: WebAssembly (`simWaveRust`, JSON of `WS.rustSpec(spec)`) when it loads, else the JavaScript in the worker, else `simLocal` on the page |
| `uelLayoutSpec(q, simSpec(q), eq)` (Headers tab unequal lengths, "Header to simulate") | web/index.html | the same sweep worker (`simPlan` hdr), the sound prediction | as above; sound: JavaScript only |
| `tsimPlan(q)` (Intake tab boost, turbo manifold, turbine, downpipe; starts from `simSpec`) | web/index.html | Simulate with the turbo: boosted spec, the same pipes without boost (`na`), the boost with no turbine (`sc`) | turbo worker: `turboSimLib.rustBackend` (WS.rustSpec) when it loads, else `jsBackend` |
| `wsndSpec(q, parts)` (simSpec or uelLayoutSpec + the Mufflers line: pieces, branches, crossover, dead cylinders) | web/index.html | sound prediction | its worker runs the JavaScript only (`wsndWorkerSrc`) |
| `esSpecFrom`, `wamSource` / `uelWamSpec`, `twSpec` | web/index.html | Engine Simulator export, OpenWAM files (4-stroke and 2-stroke) | not the wave model (other programs) |
| `ratings.js specOf`, `engine.js` (job.spec), `kseries_val.js`, the turbo scripts | tools/validation/wave | validation runs | the JavaScript model loaded by `lib.js` in Node (direct call, no translation) |
| native host (rust/et_host, et_app), C# app/, Fusion add-in | | | none of them builds a wave spec or references the model (checked by the test, statically); they host the same page |

The translation for the WebAssembly is one function, `WS.rustSpec`: a deep copy with the check-lift card turned into
`camSeat`'s seat events (since the part-14 fix), and now a refusal of the JavaScript-only parts (D6). The Rust reads the
spec by key (`serde_json::Value`), so a key it does not read is dropped silently and a missing one takes its default:
exactly the class of gap this audit is about.

### 1.1 Field matrix (engine input: who sets it, from what, unit, default)

Units: the page's base values are mm, cc, degrees, kPa; the spec is SI (m, m3, Pa, K). "4S" simSpec, "H" uelLayoutSpec,
"T" tsimPlan, "S" wsndSpec, "V" validation scripts. JS default / Rust default: what the engine takes when absent.

| Spec field | 4S (from input, conversion) | H | T | S | V | JS reads / Rust reads | Flag |
|---|---|---|---|---|---|---|---|
| e.bore, e.stroke | f-bore, f-stroke mm /1000; blank: from f-disp/f-cyl (B = 1.2 S, or the other given) | from 4S | from 4S | from 4S | inch x 0.0254 (CAM_LIB) | both | estimate (d) |
| e.rod | f-rod /1000, blank 1.7 x S | 4S | 4S | 4S | 1.7 x S | both | |
| e.cr | f-cratio | 4S | 4S | 4S | CAM_LIB cr | both | |
| e.cd | f-vcd, blank 0.7 | 4S | 4S | 4S | 0.7 | both | hidden 0.7 (d) |
| e.nIn, e.nEx | f-valves 4 -> 2, else 1 | 4S | 4S | 4S | 1 | both | |
| e.dIn, e.dEx | f-vdi, f-vde /1000; blank 0.49 / 0.40 B (2 valves), 0.40 / 0.34 B (4) | 4S | 4S | 4S | CAM_LIB valves | both | hidden scale (d) |
| e.liftIn, e.liftEx | f-lin, f-lex /1000; blank 0.26 dIn, 0.28 dEx; low profile f-llin/f-llex | 4S | 4S | 4S | CAM_LIB lift | both | hidden (d) |
| e.cam.{ivo,ivc,evo,evc} | f-ivo/ivc/evc/evo deg; blank: evc = max(10, evo-40), ivo = evc, ivc = evo; + f-vtc advance; low profile f-livo.. | 4S | 4S | 4S | CAM_LIB | both | estimate (d) |
| e.cam.checkLift_mm | f-camat: 050 -> 1.27, 1mm -> 1.0, seat -> absent | 4S | 4S | 4S | ratings.js 1.27 | JS reads; Rust NOT: translated by rustSpec (camSeat) | **(a) D1** before 2026-11-15 |
| e.burn.start, e.burn.dur | constant 18 deg BTDC, 55 deg | 4S | 4S | 4S | 18 / 55 | both | hidden (d), no input |
| e.afr | 12.8 (gasoline); fuels: lambda (i-lam, else 12.8 / 14.596) x stoichiometric | 4S | i-afr / fuel lambda (fuelAfr: the boost's A/F) | 4S | 12.8 | both | by design two A/F (stated on page) |
| e.blend.{eth,meth}, e.evap | i-fuel, i-eth (vol % -> mass), i-evap (port 0, di 0.7, all 1, none absent) | 4S | 4S | 4S | absent | both | |
| e.eta | 0.72 (read only with e.gas 'const') | 4S | 4S | 4S | 0.72 | both | hidden (d) |
| e.flowIn, e.flowEx | CAM_LIB flow bench (cfm at 28 in H2O -> Cd A, benchCdA) while the library's valves are kept and f-vflow is auto; f-vcd takes over | 4S | 4S | 4S | flow=bench | both | |
| e.camProfile, e.combEff | measured lift profiles (OpenWAM import), f-ceff | 4S | 4S | 4S | | neither (OpenWAM writer only) | (c) UI reaches OpenWAM, not the wave model (stated) |
| e.dead | | | | sound misfire | | JS only | refused by rustSpec (D6) |
| e.gas, e.fuel, e.etaC, e.woschni, e.Twall, e.portHeat, e.portTw, e.portInHeat, e.portInTw | never set by the page | | | | some scripts | both (same defaults: NASA gas, fuel vapour, 0.975, Woschni on, 450 K, Caton-Heywood, Twall, Depcik-Assanis, 360 K) | hidden (d) |
| intake.segs [{L,d0,d1,port}] | f-intl (blank 300 mm), f-pin (port: true), f-ird or sqrt(0.6 nIn) dIn | 4S | 4S | 4S | | both | |
| intake.Tw | 320 K | 4S | 4S | 4S | 320 | both | hidden (d) |
| intake.plenum {V_m3, inlet, throttle {d, cd}, filter {dp, m}} | f-intk plenum, f-plv cc (x share of cylinders run), f-tbd, f-tcd (blank 0.83), f-itl, f-itd (areas x share), f-fdp kPa x 1000 at 1.1839 x Vd x share x top rpm / 120 | 4S | 4S without the filter (the route has it) | 4S | intake=plenum | both | |
| intake.source {p, T} | | | route's throttle-inlet pressure, intercooler outlet; na/sc 101325 Pa, 298.15 K | | amb=j1349 | both | ambient i-tamb never reaches the NA runs (d) |
| exhaust.segs [{L,d0,d1,port,primary}] | f-port (port: true) at the port shape's equivalent d (f-pshape), sections of the header calc (calcFour) | per_cyl[0] | turbo manifold runner, or 4S | 4S + line | | both (primary is not read: a label) | |
| exhaust.per_cyl | | Headers lengths, the port segment | | | | both | **(b) D2**: the port segment was not marked port: true |
| exhaust.chambers [{x,V,A,Le}] | f-ch can/wrap (V from f-chd, f-chl, wall; holes f-chn, f-chh with HOLE_END 0.85) | none | **dropped (D4)**, now kept with the 4S primaries | 4S | | both | **(a) D4** |
| exhaust.Tw | 700 K | 700 | manifold steel temperature or 900 K | 4S | 700 | both | hidden (d) |
| exhaust.pOut | | | back pressure after the turbine (p4) on na | | back= | both | |
| exhaust.turbine {CdA, eta, wgCdA, wgTo, down{segs,Tw}, pOut, bsr{U,xo,form}} | | | i-tsa / found, i-teff (blank 0.75), i-tsw / found, i-wgtype, downpipe (i-dpd/i-dpl or 3 in / 24 in), p4, wheel speed from the picked turbo (TURBO_MU 0.523, TURBO_XO 0.7) | | | both | |
| opt.phases | firing gaps f-gaps or even | Headers firing angles | manifold firing order | 4S | | both | |
| opt.collector {segs, Tw 650} | merge cone (d0 = dp sqrt n) and collector | | turbo collector at Ts | 4S + line | | both | |
| opt.collectors [{cyls, stages [{groups, segs, segs_by_group, Tw}], segs, Tw}] | | Headers collectors, Tri-Y | divided manifold scrolls | H + line | whole=1 | both | |
| opt.crossover; collector(s).pieces, .parallel, .branches | | | | sound line, crossover | | JS only | refused by rustSpec (D6) |

Engine read paths compared mechanically: the JavaScript's by a Proxy on the spec during runs of the page's specs, the
Rust's from rust/et_wave/src/lib.rs (`rustReads` in web/tests/specparity_lib.js resolves every `x["key"]` receiver per
function; an unknown receiver fails the test). Result: every path the JavaScript read in 498 page specs is read by
the Rust, except the allow-list (checkLift_mm translated; crossover, pieces, parallel, branches, dead refused).

### 1.2 Hidden constants (read by the engine, set by no input)

cd 0.7 (unless typed or fitted); burn start 18 deg BTDC, duration 55 deg (Wiebe a 5, m 2); A/F 12.8 for the
4-Stroke tab's gasoline runs; eta 0.72 (constant gas only); intake runner wall 320 K, primaries 700 K, collector 650 K,
turbo downpipe 700 K, manifold 900 K when no steel temperature; cylinder wall 450 K (Twall); exhaust port wall = Twall;
intake port wall 360 K; combustion efficiency 0.975 (ETA_C); Woschni on; Fanning friction 0.005; NASA gas with fuel vapour in
the charge; port laws Caton-Heywood (exhaust) and Depcik-Assanis (intake); the intake mouth's air 101325 Pa / 298.15 K for
every naturally aspirated run (the Intake tab's ambient temperature does not reach it); throttle Cd 0.83 when blank;
chamber hole end correction 0.85 d, wall 1.651 mm when blank; estimates when blank: bore 1.2 x stroke, valve and lift
fractions of the bore, rod 1.7 x stroke, runner 300 mm, runner bore sqrt(0.6 n) x valve, the cam from the exhaust
opening; turbine efficiency 0.75; downpipe 72.9 mm x 609.6 mm; the speeds simRpms (12 from 0.4 to 1.35 x the tune rpm).
Each was already stated on the page or in docs/WAVE_VALIDATION_2026-11-11.md; none is a defect, they are listed because
no input reaches them.

## 2. Defects

Each: what, since when (`git log -S`), what the user saw and by how much, the fix, the regression check. Numbers from
`tools/validation/wave/specparity_impact.js` (results/specparity_impact.json).

**D1. The WebAssembly ran a check-lift cam card seat to seat** (found in part 14, fixed in f5ce4c3, 2026-11-15; quantified
here). `e.cam.checkLift_mm` entered the page in 4938758 (2026-11-03, "events at 0.050 in lift"); the JavaScript stretched
the sin² lift to pass the card's angles at that lift (`camSeat`), the Rust read the four angles as seat events. The
browser takes the WebAssembly whenever it loads, so from 2026-11-03 to 2026-11-15 every 4-Stroke run (and, from 2026-11-13, every turbo run) with
"Cam events at" 0.050 in (and, from part 14, 1 mm) ran a much shorter cam. Every cam library entry is a 0.050 in card
(picking one sets the convention), so every cam-library run was affected; a typed card at 0.050 in too. Seat-to-seat
entry and blank (estimated) cams were not. The 4-Stroke tab's own run (its default header: 4 cylinders on a collector of
the 8, the design as entered, 12 speeds 2,500-8,750 rpm, the page's grid and cycles), on the page's WebAssembly, the spec
as it was handed then and now:

| Engine (CAM_LIB) | card -> seat events (IVO/IVC/EVO/EVC) | peak torque, browser then / correct | peak power, then / correct | torque speed by speed | VE then - correct |
|---|---|---|---|---|---|
| LS3 | -19/43/38/-7 -> 5.7/67.7/64.3/19.3 | 708.9 N m at 4,200 / 781.8 at 5,350 | 487.1 hp at 5,350 / 631.2 at 6,500 | -50.5 to +9.2 % | -0.320 to +0.088 |
| LS7 | -15/45/55/-5 -> 9.2/69.2/81.7/21.7 | 808.8 at 4,200 / 882.6 at 4,750 | 515.0 at 4,750 / 657.9 at 5,900 | -53.2 to +12.2 % | -0.336 to +0.100 |
| LT1 | -16.5/36.5/40/-13 -> 7.7/60.7/65.9/12.9 | 688.3 at 4,200 / 788.4 at 4,750 | 449.9 at 5,350 / 601.5 at 5,900 | -60.6 to +8.0 % | -0.345 to +0.078 |
| LS9 | | 676.9 / 740.4 | 450.2 / 588.0 | -52.8 to +11.2 % | |
| LS6 | | 638.6 / 714.8 | 410.4 / 541.0 | -55.9 to +10.7 % | |
| LS1 | | 595.7 at 3,050 / 680.9 at 4,750 | 358.7 / 490.1 | -65.3 to +10.9 % | |

Plainly: in the browser the LS3, LS7 and LT1 cam cards showed 8-13 % less peak torque at a lower speed and 22-25 % less
peak power (LS3 -144 hp, LS7 -143 hp, LT1 -152 hp at peak; these are the model's net indicated torque and power on the
tab's default header, not ratings), torque up to 8-12 % higher around 3,000 rpm and 50-61 % lower at 8,000 rpm and above.
VE at the top end was low by up to 0.35. The validation runs of WAVE_VALIDATION part 3 onwards (ratings.js: the direct
JavaScript call, `checkLift_mm: 1.27`) were not affected (section 7 there). Fix (f5ce4c3): `WS.rustSpec` hands the Rust
`camSeat`'s events. Regression: every cam-library and check-lift case of the differential (section 3), and specparity_ui's
field coverage (checkLift_mm is read by the JavaScript only, so it must be on the allow-list as "translated").

**D2. The Headers tab's layout ran its ports without the head's port law** (since e444050, 2026-11-13, part 7).
`simSpec` marks the 4-Stroke tab's port segment `port: true` (the exhaust-port heat law); `uelLayoutSpec` (the Headers tab's
unequal-length layout and its equal-length twin, used by the 4-Stroke tab's simulation when "Header to simulate" picks it
and by the sound prediction) built the same port segment without the flag, so those runs had Reynolds' analogy in the port.
Only with a port length typed on the Headers tab (blank 0: no port segment, not affected). Impact, the Tri-Y 4-2-1 of
uel_sim_ui.js with a 100 mm port: torque -0.10 to +0.12 % speed by speed (as laid out), -0.04 to +0.01 % (equal
length); peak 297.5 against 297.8 N m: small, because the port law mostly moves the exhaust temperature. Fix: the flag.
Regression: specparity_ui's Tri-Y case checks every per_cyl port segment is marked.

**D3. The 4-Stroke tab's run key left out the fuel** (since 2535ec0, 2026-11-14, part 11). `fuelSpec` adds the Intake
tab's fuel, mixture (lambda) and evaporation to the spec, but `simKey` was the JSON of the 4-Stroke inputs only, so a
finished run stayed on screen as current (not marked out of date) after the fuel, lambda, ethanol share or evaporation
changed: the curve shown was the previous fuel's. No number was computed wrongly; the label was. Fix: `simKey` adds
`fuelSig()` (empty for the page's gasoline without evaporation, so earlier keys are unchanged). Regression: specparity_ui
section 7.

**D4. The boosted plan dropped the 4-Stroke tab's chamber** (since 3f7ea5f, 2026-11-13). When the boosted run takes the
4-Stroke tab's primaries (a centrifugal supercharger always; a turbo without the Turbo manifold section filled),
`tsimPlan` copied their segments but not `exhaust.chambers` (a can or wrap on the primary); the bulge kind is a segment and
was kept. Impact: a supercharged 4-cylinder with a can at 200 mm: torque -0.14 to +0.03 %. Fix: the chambers come with
the primaries (and the key only when there is one, so other specs are unchanged). Regression: specparity_ui's
centrifugal case checks the boosted, the without-boost and the no-turbine specs carry the 4-Stroke tab's chamber.

**D5. After a project load or an engine preset, the 4-Stroke tab simulated the previous build's Headers layout and
boost** (Headers layout since eb49871, 2026-10-31; the boosted plan since 3f7ea5f, 2026-11-13). The 4-Stroke tab's runs
read the Headers and Intake tabs' last results (`HDR_LAST`, `TS_LAST`, `MFD_LAST`), refreshed only when those tabs render.
Loading a project while on the 4-Stroke tab left them as they were: a project with an unequal-length Headers layout loaded
into a fresh page ran the 4-Stroke tab's own design instead of its layout; a boosted project loaded over another took the
other's route (boost pressure and charge temperature), turbine first guess and manifold, until the Intake tab was opened.
Found by the save -> load check (section 4), not by the differential (the specs agreed between engines; they were the wrong
specs). The same holds for an engine preset chosen on another tab (it sets Headers and Intake fields). Numbers: the run was
of a different build, so the error is whatever the two builds differ by; no single figure. Fix: `refreshTabResults()`
(renders the Headers and Intake computations off-tab, as tsimPlan already did when TS_LAST was empty), called by
`projApply` and `applyVehicle`. Regression: specparity_ui section 4 loads each project on top of the one before into one
page kept on the 4-Stroke tab and reads it without visiting the other tabs (with the fix switched off it fails on the
Tri-Y and on all three boosted projects; checked).

**D6 (latent). JavaScript-only spec parts would have been dropped silently by the WebAssembly.** The JavaScript model has
an H/X crossover between two collectors, in-line pieces and parallel paths, side branches and cylinders that do not fire;
the Rust has none of them and would run such a spec without them. Today only the sound prediction builds them and its
worker runs the JavaScript, so no result was affected. Fix: `WS.jsOnly(spec)`; `rustSpec` throws on such a spec; the sweep
worker and the turbo worker check `jsOnly` before choosing the WebAssembly. Regression: specparity_ui section 2.

**D7 (latent). The two back ends read a zero cycle count differently.** `wave_step` takes 0 (or NaN) cycles, first
cycles or extra pairs as its defaults (3, 6, 4); `turboSimLib.jsBackend` ran 0. The page always passes non-zero counts, so
no result was affected; found because the audit's own harness passed 0. Fix: jsBackend takes the same defaults.

Not a defect, but stated because it limits "to the last digit": Node's Math.pow, exp, sin, cos, log ... differ from
Chromium's in the last bits for up to 18 % of random arguments (pow 9 %, exp 10 %, atan2 18 %; hypot never) (Node 22's V8 12.4 against Chromium 153). The validation
scripts run the model in Node, so their numbers differ from the browser's at about 1e-9 relative (VE 0.90457998335 against
0.90457998263 for the K20A2), and differences can grow over many cycles. The direct comparison is therefore made with the
scripts' own load of the model (`lib.js build()`, instrumented as they use it) run inside the page: bit for bit there.

## 3. Differential test at the page boundary

`tools/validation/wave/specparity_audit.js` (results/specparity_audit.json: each case's inputs and verdicts). Each case
is a fresh page in Chromium: metric units, expert mode, a preset or the cam library or neither, then the inputs (Intake tab
first, then the 4-Stroke tab); the page's own specs are collected (`window.__sp.collect`: the 4-Stroke plan's design as
entered with both profiles, the first cam advance other than 0, the Headers twin; the boosted plan's boosted, without-boost
and no-turbine specs, with the plan's first-guess turbine area and, at the second speed, a gate area). Each spec is run at
the first and last speed the page would run, three ways in the page: the JavaScript model on a structured clone (what a
worker's postMessage gives), the WebAssembly through the page's own `rustBackend` (JSON of `WS.rustSpec`), and the
validation scripts' load of the model on the spec's JSON. Run control 2 first cycles, 1, up to 1 extra pair, grid 20 mm
(parity does not depend on these; the page's own settings are used in the whole-run check of specparity_ui and the
impact runs).

Coverage: 31 stratified presets (24 engine presets across I4/I5/I6/V6/V8/V10/V12, 2- and 4-valve, NA and turbo
engines; the 6 cam library cards; the default page) and 220 seeded fuzz cases (seed 20261116): cylinders 1-8, primaries
per collector 1-8 with even and uneven gaps, port lengths and shapes, chambers (can, wrap, bulge), cam conventions (seat
192 specs, 0.050 in 200, 1 mm 106), typed or estimated events, lifts, valve sizes, flow coefficient, rod, runner length,
port and bore, plenum with throttle Cd and filter (79 cases), cam advance (fixed, and best advance: 24), two profiles (27),
fuels pump / race / E10 / E85 (with its ethanol share) / E100 / M100, lambda, evaporation none / port / DI / all, boosted
(turbo 56, centrifugal 14) with typed or found turbine and gate areas, external or internal gate, tube / log / divided
manifold, efficiency by blade speed ratio (parabola), Watson's curve or constant, typed efficiency, back pressure after
the turbine, the knock trace on (24) and the trace on other runs.

Result: 251 cases, 498 specs (278 4-Stroke designs, 24 cam-advance variants, 56 turbo, 14 centrifugal, 70 without boost,
56 no-turbine), 4,072,147 numbers (the 8 results per speed, each cylinder's VE and IMEP, the turbine summary with its 720
bins per entry, the trace): **no difference** between the JavaScript, the WebAssembly and the validation load; no case
without a spec; no page error. The Proxy recorded 108 distinct spec paths read by the JavaScript in these runs; all are
read by the Rust or on the allow-list. Run after D1 was fixed, so it shows the translation is now complete for every path
the fuzz reaches; with the check-lift defect in place, every 0.050 in and 1 mm spec (306 of 498) would have differed.
Not in this run: the Headers layout (it needs the Headers tab's table; it is in specparity_ui, both ways and with the
validation load).

## 4. Save and load, units, presets

In specparity_ui.js (all pass on the final code):
- Save -> load: 7 projects (the LS3 card, K24A2 with two profiles, best advance and E85, the Tri-Y layout, two turbo builds,
  2 fuzz cases), each loaded on top of the one before into one page kept on the 4-Stroke tab and read without visiting
  other tabs: all 635 saved inputs, every spec and both run keys identical to the page it was saved from. This found D5.
- Units: in each of those, inches and back to mm: no base value (the project snapshot's `b`) and no spec changes. The
  toggle is one control (in / degF / psi against mm / degC / kPa).
- Presets: K24A2, N54B30, S65B40, 2.5 TFSI each chosen twice: identical inputs and specs; P, then another, then P again:
  only fields of the stated rule may keep the other's value, and in these four none did. The rule (applyVehicle): an
  engine preset sets the engine (displacement, cylinders, RPMs, firing order, primaries per collector and gaps), bore and
  stroke (or blanks them), compression and valves when it has them, valve heads, rod, phaser range and VTEC changeover
  (or blanks them) and the cam advance (blank); it keeps everything it does not define: the cam card and its convention,
  lifts, flow coefficient, intake runner and plenum, the header's sizes and chamber, the two-profile and advance choices,
  and compression and valves when it has none (PRESET_KEEPS in the test). Consequence worth knowing: a cam picked from the
  cam library stays (with its 0.050 in convention and lifts) when another engine preset is chosen after it; the library
  select still names it, so the source of those events stays visible.
- Run keys: a fuel, evaporation, lambda or ethanol change that changes the 4-Stroke tab's specs changes its key (D3).

## 5. What the permanent test enforces

`web/tests/specparity_ui.js` (helpers `web/tests/specparity_lib.js`, a runner NOT_TESTS entry):
1. the Rust model's read paths from its source (every receiver resolved); every path the JavaScript model reads in the
   page's specs of the fixed cases is read by the Rust or on the commented allow-list; no allow-list entry is stale; the
   native host, the app and the Fusion add-in build no wave spec (static scan).
2. rustSpec refuses the JavaScript-only parts and the sweep worker checks `WS.jsOnly` before the WebAssembly.
3. fixed cases (each cam convention, the cam library cards, plenum and filter, two profiles, best advance, fuels and
   evaporation, uneven gaps, the Headers Tri-Y, turbo with the blade-speed-ratio efficiency and the knock trace, typed
   turbine areas with Watson's curve and an internal gate, centrifugal) plus 2 seeded fuzz cases, every number equal
   between the JavaScript, the WebAssembly and the validation scripts' load of the model, all in the page; and one whole
   4-Stroke run from its button with the WebAssembly and with `window.__waveJs` (the test-only switch added here).
4. save -> load (each project on top of the one before, read without visiting other tabs), units there and back, presets
   twice and P -> Q -> P against the stated rule, the run key changing with the fuel, and the D2 / D4 spec shapes.

## 6. Not covered

- The differential compares the two engines on the page's specs at two speeds with short run control and one whole
  4-Stroke run from its button (the LS3 card) with the page's own control; the turbo closure (area and gate searches) and
  the calibrations were not run end to end both ways (their engine calls are the same `step` / `set` the fuzz checks).
- The OpenWAM, Engine Simulator and 2-stroke exports build their own inputs from `simSpec` / `twSpec`; they are not the
  wave model and were not checked here (their own tests compare them with their writers).
- Inputs the fuzz does not reach: measured cam lift profiles (OpenWAM only), the Mufflers line, crossover and misfire of the
  sound prediction (JavaScript only, refused by the WebAssembly), the cam calculator helpers (f-cdi, f-cde, f-clsa, f-cadv
  fill the event fields), the Headers tab's collector shapes other than the Tri-Y.
- The native host, the C# app and the Fusion add-in were checked statically only (no reference to the wave model or its
  spec); no workspace build.
- Engine presets: 24 of 599 in the differential (stratified) and 4 in the idempotence check.
