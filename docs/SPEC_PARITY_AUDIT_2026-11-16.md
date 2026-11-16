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
function; an unknown receiver fails the test). Result: every path the JavaScript read in {{NSPECS}} page specs is read by
the Rust, except the allow-list (checkLift_mm translated; crossover, pieces, parallel, branches, dead refused).

### 1.2 Hidden constants (read by the engine, set by no input)

cd 0.7 (unless typed or fitted); burn start 18 deg BTDC, duration 55 deg (Wiebe a 5, m 3 in the engine); A/F 12.8 for the
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

{{DEFECTS}}

## 3. Differential test at the page boundary

{{DIFF}}

## 4. Save and load, units, presets

{{BOUNDARY}}

## 5. What the permanent test enforces

`web/tests/specparity_ui.js` (helpers `web/tests/specparity_lib.js`, a runner NOT_TESTS entry):
1. the Rust model's read paths from its source (every receiver resolved); every path the JavaScript model reads in the
   page's specs of the fixed cases is read by the Rust or on the commented allow-list; no allow-list entry is stale; the
   native host, the app and the Fusion add-in build no wave spec (static scan).
2. rustSpec refuses the JavaScript-only parts and the sweep worker checks `WS.jsOnly` before the WebAssembly.
3. fixed cases (each cam convention, the cam library cards, plenum and filter, two profiles, best advance, fuels and
   evaporation, uneven gaps, the Headers Tri-Y, turbo with the blade-speed-ratio efficiency and the knock trace, typed
   turbine areas with Watson's curve and an internal gate, centrifugal) plus 4 seeded fuzz cases, every number equal
   between the JavaScript, the WebAssembly and the validation scripts' load of the model, all in the page; and one whole
   4-Stroke run from its button with the WebAssembly and with `window.__waveJs` (the test-only switch added here).
4. save -> load into a fresh page, units there and back, presets twice and P -> Q -> P against the stated rule, and the
   run key changing with the fuel.

## 6. Not covered

{{NOTCOVERED}}
