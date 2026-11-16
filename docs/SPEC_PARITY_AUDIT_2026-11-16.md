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

Run time: about 3.5-4 minutes (239 s in the suite at -j 2), over the 2 minutes aimed for; about 85 s of it is the whole
4-Stroke run from the button done twice. The full fuzz (251 cases, about 34 minutes) is the audit script, not the test.

Final suite (`python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`, the final code): 142 tests,
135 passed, 0 failed, 7 skipped and 7 partial skips, all expected (OpenWAM, the host program, the F-100 run not here). No
pin changed.

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

## Addendum (2026-11-16, second round): the rest of "Not covered", and stale results on every tab

The first round compared the two engines on the page's specs. This round closes what it left open (section 6) and hunts
the class of D3 and D5 (a result on screen that does not belong to the inputs on screen) on every tab, not only in the
wave runs. Numbers are from the final code of this round unless a line says otherwise.

### A1. The engines end to end, both ways

(a) **The turbo simulation, whole** (`tools/validation/wave/turbo_closure_parity.js`, results/turbo_closure_parity.json).
The job "Simulate with the turbo" hands its worker (`tsimJob(tsimPlan(q))`, now one function shared by the button and the
tests) is run through the page's own `tsimRun` twice in the page, with the WebAssembly back end and with the JavaScript
one, and the two outputs compared number by number (Object.is): the area and gate searches, the predict mode of a known
turbine with its below-full-boost compressor law, the calibrations to a measured pressure before the turbine, the
sensitivity runs, the knock check with its timing bisection, the runs without boost and without the turbine, every bin.
The first case also ran from the button itself, in the worker, with the WebAssembly and with `window.__waveJs`: both
results equal the in-page run to the last digit and their run keys match the page's.

| Case | Mode the run took | Numbers | WASM / JS |
|---|---|---|---|
| K24A2, found area, wheel-speed (blade speed ratio) efficiency, pump gasoline; and from the button both ways | closure, 2 sensitivity runs | 29,831 | the same |
| K24A2, found area, constant efficiency (blade speed off), E85, knock check on | closure + knock | 130,350 | the same |
| K24A2, typed turbine flow (predict), race fuel, wheel-speed efficiency, knock check on | predict + knock, 1 sensitivity | 45,602 | the same |
| K24A2, measured pressure before the turbine, no flow: area and efficiency calibrated (At 5.24 cm2, eta 0.383), E10, Watson | closure after calibrate | 23,911 | the same |
| K24A2, typed flow and measured pressure: efficiency and gate calibrated (eta 0.351), E100 | closure after calibrateA | 23,915 | the same |
| 2.0 L four, found area, M100, constant efficiency, internal gate (knock asked for) | closure, 2 sensitivity | 29,831 | the same |
| 2.0 L four, typed turbine and gate areas (no search), Watson, back pressure after the turbine | closure | 23,905 | the same |
| centrifugal supercharger, E85 | sweep | 12,081 | the same |

319,426 numbers, no difference. Each fuel ran in at least one case (pump, race, E10, E85, E100, M100). In the M100 case
the knock check did not run (no knock result in the output); the knock path was covered by the E85 and race cases only.

(b) **Every engine preset** (`tools/validation/wave/preset_sweep.js`, results/preset_sweep.json; resumable, it skips the
presets already in the file and stops cleanly when the browser goes away). Each preset: a fresh page, the preset chosen from the
engine list, the page's own 4-Stroke spec (the design as entered; none of the presets lays out a Headers twin), run at
the first, middle and last of the 12 speeds the page would run (0.4, about 0.85 and 1.35 times the tune RPM) with the
JavaScript model and the WebAssembly, short run control (2 first cycles, 1, 1 extra pair, 20 mm grid), every number
compared, and the results judged: no NaN, VE 0.3 to 1.6, IMEP above 0 (positive torque at wide-open throttle), peak
pressure 10 to 300 bar, exhaust temperature 500 to 1800 K, residual 0 to 0.5. Result: 598 presets; 592 four-stroke, 6
rotaries (the 13B-REW and Renesis entries) that fill nothing on the 4-Stroke tab and are not applicable; 592 specs, **no
JS/WASM difference, no error, no spec refused, no implausible value, no page error** (1,411 s for the 396 presets of the
second sitting, the first 202 in an earlier one; the file keeps both). VE over all presets and speeds 0.361 to 1.175,
IMEP 3.6 to 17.3 bar. The lowest VE are all at the top speed of high-revving engines whose valves and cam the page
estimates (Honda F22C1 0.361 and F20C 0.386, Ferrari F140 HB 0.370, the Voodoo-type flat-plane 4.5 0.374, LT6 0.376):
1.35 times their peak-power RPM (the top of simRpms' fixed range, which the 4-Stroke run does run) is above their
redline, so a low VE there is the estimated valves choking at a speed the engine never reaches; worth knowing when
reading the top of those curves, not a data defect. A second check of the presets' own numbers
(`tools/validation/wave/preset_geometry.js`, results/preset_geometry.json): of the 592, 77 carry a bore and stroke, and
for all 77 pi/4 x bore^2 x stroke x cylinders is within 2 % of the preset's displacement; valve heads, rod and
compression, where given, inside plain ranges. The other 515 have no bore or stroke in the list, so the 4-Stroke tab
estimates the bore as 1.2 x stroke from the displacement for them (stated on the page as "blank to estimate"): a gap in
the data, not an error in it, and the largest open item for the presets' wave runs.

(c) **The Headers collector shapes through the layout path** (`tools/validation/wave/headers_shapes_parity.js`,
results/headers_shapes_parity.json): unequal lengths with a direct 4-1 on an inline four, a V8 per bank (two collectors),
a V8 180 degree (alternate cylinders, two collectors crossing banks), an inline six with "My own groups" 1,2,3 | 4,5,6,
Tri-Y 6-2-1 and 8-4-1, and an inline four with stepped primaries asked for (unequal lengths keep them constant). Each: the
layout and its equal-length twin, two speeds, the JavaScript, the WebAssembly and the validation scripts' load of the
model: 576 numbers, no difference; collectors and stages as the shape says; every port segment marked as a port (D2).
It found a page defect, H1 below: "My own groups" threw on the Headers tab.

(d) **The sound estimate's JavaScript-only path** (`tools/validation/wave/sound_determinism.js`,
results/sound_determinism.json). It cannot be compared with the WebAssembly (the in-line pieces, side branches, the
crossover and a cylinder not firing exist only in the JavaScript model, and rustSpec refuses them: first round D6), so it
was checked for determinism: "Hear each part" (the line, a muffler, a Helmholtz can: pieces and branches; 4 steps),
"Hear a misfire" and "Estimate the sound" on a V8 per-bank Headers layout with an X crossover asked for on the line,
each run twice from its button in a fresh page (the page's worker): 47,115 numbers, identical. (Whether the crossover
entered that last spec was not checked separately.) Labelling: the page never named the back end; the Sound tab's
caption now says the estimate always runs the page's JavaScript wave model, that those parts exist only there, and that
the 4-Stroke tab's runs take the WebAssembly copy, which gives the same numbers for what both have.

### A2. Stale and order-dependent results on every tab

Harness (`web/tests/staleness_lib.js`, driven by `tools/validation/staleness_sweep.js`): sessions of seeded user actions
on one page A, each action a random tab and a random visible input there changed as a user would type or pick it (in the
units shown), and now and then an engine preset or a vehicle, the unit toggle, Simple/Expert, the project saved and loaded
back into the same page, or a "Use" button; after 40 % of the actions another tab is looked at (a result read after an
input changed elsewhere). Every 10 actions, a checkpoint: the displayed text of all 13 tabs in A (each tab visited, its
render settled), against (i) a fresh page B given A's project from scratch and read the same way, and (ii) A itself read
again in the reverse tab order. Any difference is a stale or order-dependent result or an input the project does not
carry; the actions are recorded, so a difference is replayed and bisected (`replay=SEED upto=K dump=TAB`). The view
filters that are not saved on purpose (A4) are copied from A to B before reading, so a filtered list is not counted.

The runs' own run keys were checked mechanically too (staleness_ui.js section 1): over seeded input changes on the
4-Stroke, Intake, Headers, Mufflers and Sound tabs of a turbo build, the job "Run" and "Simulate with the turbo" would hand
their workers (`simJob`, `tsimJob`, now the functions the buttons use) never differed while the run key stayed the same:
the keys are complete (D3 was the last gap). The muffler designer's key is the JSON of its search's own input by
construction. The sound estimate and the OpenWAM table had none (S1, S5).

Found and fixed (since: `git log -S`):

Defects of this round (S: stale or order-dependent, P: not in the project, C: the cam rule). Since: git log -S.

| # | What | Since | What the user saw | Fix | Regression |
|---|---|---|---|---|---|
| S1 | The sound estimate (Sound tab, "Estimate the sound", "Hear each part", "Hear a misfire") had no out-of-date marker | 0251181, 2026-11-05 | after any change to the engine, header, line, speeds, load or microphone the sound and its levels were still labelled "Your design" | `wsndSig` (the specs as they would be built now, the speeds, load, grid, microphone) kept with the run; a warning note `#wsnd-stale` while it differs | staleness_ui (sound note) |
| S2 | The 4-Stroke tab's simulation inputs (SIM.inp) were set only when the 4-Stroke tab rendered | 92a0fb1 (2026-10-30, the import; the sound and boosted readers came later: 0251181 11-05, 3f7ea5f 11-13) | a fresh page or a loaded project that had not opened the 4-Stroke tab: the Sound estimate said "Open the 4-Stroke tab and fill it in"; an engine preset chosen or a 4-Stroke field changed elsewhere: the Sound estimate and the Intake tab's boosted plan ran the previous engine until the 4-Stroke tab was opened; an input error on the 4-Stroke tab left the last good inputs in use | `simInpRefresh` (the same inputs computed without rendering the tab) at every other tab's render and on load or preset; an error leaves none | staleness_ui (rich build), staleness sweep |
| S3 | Results of the Headers, Crossover and Intake tabs (HDR_LAST, CROSS_LAST, TS_LAST, MFD_LAST) read by other tabs were refreshed only when their own tab rendered (D5 had added loads and presets) | the readers: cfa69f5 (2026-11-03, the optimiser), 5b92d61 (11-04, the crossover in the OpenWAM line and later the sound), eb49871 / 3f7ea5f as D5 | a page that had not opened the Headers tab: the 4-Stroke tab's optimiser said "Lay out a header on the Headers tab first" though the Headers tab has one; an input on one tab read by another tab's result left that result as it was | `refreshDeps`: any input marks them out of date, and the render of any other tab first renders the out-of-date ones off-tab | staleness sweep seed 9 |
| S4 | The Mufflers tab's early error returns kept parts of the last result: the legend and caption (the two pipe-section errors), and the Mach note in the form (every early return) | 92a0fb1 (the Mach note later) | under the error note, the legend of the previous design's curves (Helmholtz, J-pipe, chamber, packed can, 3 dB band) and "this pipe runs about Mach 0.19 at redline" for an earlier design | the error returns clear the legend, caption and summary; the Mach note is cleared at the start of every render | staleness sweep seeds 5 and 19 |
| S5 | The OpenWAM results table had no out-of-date marker | 92a0fb1 (in the project as imported) | after a change to the case, the last run's torque and VE were shown as this design's | `wamSig` of the case's .wam files kept with a host run; a warning while the case written now differs; results read from files say the page cannot tell which case wrote them | staleness_ui (OpenWAM note, a simulated host run) |
| S6 | The preset's power hold (HP_PRESET) ended on every project load | 416d184, 2026-11-14 | a turbo build with "My power target" saved while the preset's stock rating was still in the power field loaded as worked at the stock rating instead of the boost field's figure: the boosted results changed on load | the project keeps `hpPreset` when held; it is restored when the loaded power field still holds that figure | staleness_ui (rich build) |
| P1 | The Parts tab's tube for the build list (p-od, p-wall) was not saved (outside a form) | 92a0fb1 | after a load, the Fusion payload's pipe size was the page's default | in PROJ_STATIC | inventory |
| P2 | The Headers layout's gas temperature for the wave speed (h-uel-t) and the collector to route (h-uel-route) were not saved | 92a0fb1 | the unequal-length table's wave timing and the Fusion route reverted on load | huel.T, huel.route | inventory |
| P3 | The sound estimate's speeds, load and misfire choice (wsnd-rpms, wsnd-load, wsnd-dead) | 0251181 | reverted on load | PROJ_UI snd (only those three) | inventory |
| P4 | The Mufflers tab's auger designer (AUG), muffler designer targets (MD: tl, f0, f1, kinds, inst) and tuned-tube set (TT) | f5cf238 11-03, a4cf89b 11-04, 13ed6f2 11-03 | their inputs and every number they compute reverted to the defaults on load | PROJ_UI aug, md, tt; a blank (NaN) number saved as null now loads as blank | inventory, staleness sweep seed 1 |
| P5 | The Mufflers tab's "From the Sound tab" state (the pipe's start at the valve or the turbine outlet, its note) | 92a0fb1 (the turbine-outlet label later) | the label and note reverted on load | `mufFrom` in the project | |
| H1 | The Headers tab with "My own groups" threw (`gname` had no 'custom'), after the details but before its summary and HDR_LAST | 92a0fb1 | a page error; the layout never reached the 4-Stroke tab, OpenWAM or the sound estimate; the copy summary was the previous layout's | the missing entry | staleness_ui (found by A1 (c)) |
| C1 | A cam from the cam library stayed through a later engine preset, silently | 31c3a2a, 2026-11-03 | one engine's cam run on another | A3 | staleness_ui (cam rule) |

After the fixes: on the final code, 20 sessions (seeds 1 to 20, 40 actions each), 766 actions: 631 input changes (on all 13 tabs,
40 to 62 each; 71 of them on generated inputs without an id, 133 on the vehicle picker above the tabs), 56 engine presets
or vehicles, 25 unit toggles, 31 Simple/Expert switches, 17 projects saved and loaded back into the same page, 6 "Use"
buttons; 293 looks at another tab after a change; 80 checkpoints, each all 13 tabs against a fresh page given the
project and against the reverse tab order: **no difference** (results/staleness_sweep.json). Before the fixes the same
seeds showed S2/S3 (seed 9), S4 (seeds 5, 19) and P4 (seed 1); each was bisected with the replay and its case is in the
permanent test or the sweep.

### A3. The cam library and an engine preset chosen after it

The first round stated the consequence: a cam picked from the cam library (its events at 0.050 in, its lifts, its
2-valve head) stayed when another engine preset was chosen afterwards, the library's select still naming it. A first-time
user who tries the LS3 card and then picks their K24A2 runs a K24 with an LS3 cam and is told nothing (since 31c3a2a,
2026-11-03, when the library came in). Rule chosen (`camLibOnPreset`): choosing a four-stroke engine preset sets a library
cam aside: the fields the library filled that the preset does not define (the four events, the lifts, the convention,
and the valve count and compression when the preset has none) go back to a fresh page's values, so the preset gives the
same inputs whether or not a library cam was picked before (checked field by field in staleness_ui.js). A note under the
library says "Cam set aside: <name> was picked from the list above; choosing <engine> put this engine's own cam back"
with one button, "Use the <name> cam again", that puts the events, lifts, convention and the library's name back (the
note then reads "Cam: <name> (kept from before)"). A new tick box, "Keep the cam from the list above when I choose an
engine", keeps it through presets, with the same "kept from before" note and a button "Use this engine's own cam".
Why this one: the least surprising for the user who did not know the cam was the library's (the preset is the newer and
more specific choice, and every other engine field already follows it), with no loss for the user who wanted the mix
(one click back, or the box ticked first), and the mixed state is never silent. A cam typed by hand (no library entry
picked) is the builder's and stays, as before; projects load exactly as saved (the rule does not run during a load, and a
project with a kept cam loads with it, checked over another build's library cam).

### A4. Project-file completeness

`web/tests/staleness_lib.js inventory` (run by staleness_ui.js; `tools/validation/project_inventory.js` prints the
lists): a page in a state that renders the generated inputs (expert, metric, the K24A2 preset, a turbo build with a turbo
picked and the knock check on, the Headers tab at unequal lengths, every tab visited) enumerates every input, select and
textarea, with an id or, for the generated ones without, by panel, class and data-k. Each is either in the project's vals,
or its probe change (a clearly different value) survives a save and a load into a fresh page through one of the
project's section objects, or it must be on `NOT_SAVED` (staleness_lib.js) with its reason. A probe equal to the same
state's unprobed value counts as untested, so a "survives" is never trivially true.

Result (rich state, final code): 817 inputs; 638 in the vals, 139 through a section object (the OpenWAM, Engine
Simulator, dyno, optimiser, compressor map, turbo options, manifold, CFD, heat, unequal-length table, auger and the new
ones below), 19 not saved on purpose, 20 the probe could not change (the copy boxes, which are output; the "Header to
simulate" selects with one choice; the inline power box `i-hptgt`, which commits into the power field; two turbo
selects and two tube rows with one choice in this state), none lost. Not saved on purpose: the program's update token
(a credential), the Parts tab's catalogue filters and the custom-part draft (the part added goes in the saved build
list), the Options tab's filter and search. Newly saved (P1 to P5 in A2): the Parts tab's tube size, the unequal-length
table's gas temperature and collector to route, the sound estimate's speeds, load and misfire choice, the auger
designer, the muffler designer's targets, the tuned-tube set and the Mufflers tab's "From the Sound tab" state, plus
the preset's power hold (S6). A blank (NaN) number in a section object was written as null and loaded as null; it now
loads as blank. Projects from before have none of the new keys and load as before (each new key is read only when
present): the fixtures' pinned results are unchanged (the suite below).

Reproduction: a project written by the current page, loaded into a fresh page, shows the same text on all 13 tabs, read
in either tab order, for the rich build (staleness_ui.js, the rich build) and at every checkpoint of the sweep (A2).

### A5. Permanent tests and pins

`web/tests/staleness_ui.js` (helpers `web/tests/staleness_lib.js`, a runner NOT_TESTS entry), about 2 minutes:
1. the run keys are complete (45 seeded input changes on five tabs of a turbo build; the 4-Stroke and turbo jobs never
   differ under one key);
2. the sound estimate's out-of-date note (a real one-speed run from its button), and the OpenWAM table's (a host run put in
   as wamRun leaves it: current, out of date after a change, "read from files" without a run hash);
3. a rich build's project reproduces every tab's text in a fresh page, read in either order;
4. the Headers tab's "My own groups" renders and reaches the other tabs (H1);
5. the inventory: every input saved, through the vals or a section object, or on NOT_SAVED; no stale entry;
6. the cam-library rule: set aside on a preset (the same fields as the preset on a fresh page), one click back, one click
   to the engine's own, "Keep" keeps it with its note, a project with a kept cam loads exactly.

The long runs are validation scripts with checkpointing, not in the suite: `tools/validation/staleness_sweep.js` (sessions
written as they end), `tools/validation/project_inventory.js`, and under tools/validation/wave `preset_sweep.js`
(per preset), `turbo_closure_parity.js` (per case), `headers_shapes_parity.js`, `sound_determinism.js`.

Pins: none changed. No existing test needed a new expected value; the project fixtures (op_legacy_k24 and the
projects the boost, fuel, K-series and compressor-map tests write and load) load with their pinned results. The fixes
change displayed results only where the page showed a stale one (a run or section of an earlier design, an error with the
last design's legend) or where a load lost a saved setting; no pinned case was in such a state.

Final suite (`python3 tools/run_all_tests.py --suite web,parity --no-build -j 2 --skip-slow`, the final code): SUITE_COUNTS

### A6. Still not covered

- Runs that need the Windows program (OpenWAM, OpenFOAM: the OpenWAM runs and their optimiser, the dyno match, the
  intake and exhaust CFD cases, the 2-stroke OpenWAM case, the muffler designer's OpenWAM runs): not run here. Their
  results tables: OpenWAM's now carries the case hash (checked with a simulated run); the CFD tables are per named case
  (each row names its case, not "this design") and the optimiser's list is of changes around the header it ran on; neither
  got a marker in this round.
- The inventory and the stale-result sweep reach the inputs of the states they visit: the rich build and the random
  walk from the default page. Inputs generated only in states not reached (the 2-Stroke tab's Blair design rows, rotary
  engines on the Headers tab, every CFD option) are covered only as far as the sweep happened to reach them.
- The sound estimate's JavaScript-only path is checked for determinism, not against an independent model.
- Engine presets: 4-Stroke translation and the model at three speeds each, with the short run control; the presets'
  boosted builds (a preset leaves the induction as it is) were not run.
- Node and Chromium maths still differ in the last bits (first round, section 2); every comparison here is inside one
  Chromium.
