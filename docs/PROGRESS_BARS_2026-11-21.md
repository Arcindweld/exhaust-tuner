# Progress bars, 2026-11-21

The owner's request: "add progress bars to the tuner". Before this, a long operation showed a line of text ("Starting",
"Running 3 designs side by side (42%)", "Reading file… 40%") with a 3 px line under it read back out of that text,
or nothing at all (a Fusion build, the update download, the program's OpenFOAM runs between their messages).

Same hard rules as the UI passes: no calculation, default, input id, project-file key, URL hash or host/bridge contract
changed; no external resource; no pinned test number changed. The host (`rust/et_host`) and the add-in
(`fusion-addin/hostrun.py`, `foamrun.py`) were only read, to see which events they send.

## The component (web/index.html, after `runPct`)

- `progSet(k, done, total, label, o)` starts or moves operation `k`'s bar; `progEnd(k, how, msg)` ends it:
  `'done'` takes the bar away (the result takes its place), `'stop'` (cancelled) and `'err'` leave it standing,
  stopped, saying so in words ("Wave simulation · cancelled at step 12 of 36 (33 %). The results before it are kept.",
  "Intake CFD in OpenFOAM · stopped by a problem: snappyHexMesh failed: …"), until the operation starts again.
- **Determinate** (`total > 0`): `<div class="prog-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
  aria-valuenow="33" aria-valuetext="step 12 of 36 (33 %)" aria-label="Wave simulation">` and one line
  "Wave simulation: 3 designs side by side · step 12 of 36 · 33 %". The value never goes down (a new figure below the
  last one shown is not shown). The percentage is rounded as the status lines above it round theirs.
- **Time left**: only once two steps have finished (a fraction: from 10 %), elapsed ÷ steps finished × steps left; held
  to a steady count-down (it goes back up only when the new estimate is more than 25 % + 2 s above it), refreshed once
  a second while shown, and left out while the last few estimates disagree by more than half the time left (the first
  speeds of a wave simulation are slower than the rest, so a short run often shows none, which is the honest answer).
  "a few seconds left" under 8 s, "about 20 s left" in steps of 5 s, "about 3 min left".
- **Indeterminate** (`total` 0): a moving diagonal stripe, no `aria-valuenow`, and words in place of a figure
  ("rhoSimpleFoam, iteration 400 (at most 4,000) · working; how far it has got is not known"). Never a percentage made
  up on a timer. Under `prefers-reduced-motion` the page's existing rule stops every animation: the stripe stands still
  and the text carries it.
- **Place**: right after the operation's status line (`PROG_DEF[k].at`, tried in order), so where the run has reserved
  space (`resvHtml`: the wave simulation, the boost simulation, the sound estimate) the bar is inside it, and the
  results take that space over with no jump. A stopped run whose status line has gone shows its stopped bar after the
  run's buttons. Width and font follow the line above it (a note's width, or a caption's).
- **Updates in place**: the bar's own nodes only (width, aria attributes, three text spans), once per animation frame
  (`requestAnimationFrame`); no render. A render that rewrote the bar's place (typing in a field re-renders the tab)
  gets it back in the same frame from `progPass()`, called with the page's other display passes after every render.
  `setHTML`'s guard (`incremental_ui.js`) finds no difference (no operation runs in it).
- **Screen readers**: a second polite live region, `#prog-live`, says how far it has got at most every 10 points and
  5 s ("Wave simulation: 40 %, step 15 of 36, about 20 s left."), and a stop or a problem at once. The existing
  `#live` region still says "<section>: running." and "…: finished; the results are updated." once per run.
- **Cancel**: only where it already existed underneath (the `data-runcancel` buttons of the wave simulation, the boost
  simulation and the sound runs; the programs' own Stop buttons, which stop that request on the bridge). None invented.
- Colours are the page's tokens only: track `--inset`, fill `--accent`, stripe `--accent` / `--accent-soft`, stopped
  `--muted`, problem `--bad` (and the words); light and dark from the same tokens.
- Fixed in passing (the status component): a program's run note (`.note` with `.runstat`, set by `hostStatAll`) lost
  its left padding and its "i" mark was overwritten by the running time, so the mark sat on the first word; the note
  keeps its padding and mark, and its running time is on the right.

## Inventory: every operation that can take more than about half a second

| Operation | Where | Progress information that existed | Bar now | What it counts | Cancel | Follow-up |
|---|---|---|---|---|---|---|
| Wave simulation (`SIM`, `simProgress`) | 4-Stroke; also Sound and Headers through it | per speed per design from each worker (`progress` k, i), "(n %)" text | determinate | speeds × designs (`SIM.total`); with "Header to simulate" = the Headers tab's unequal-length layout, its two variants × speeds; the cam / VTC phasing variants are designs in the same job | yes | — |
| Headers' unequal-length run | 4-Stroke (Header to simulate: the Headers layout) | the same job | determinate (as above) | as above | yes | — |
| Boost simulation (`TSIM`, turbo or supercharger) | 4-Stroke, from the Intake tab's boost | worker `progress` i of n with a label, after its first step | indeterminate until the first message ("starting"), then determinate | the run's own steps (speeds with the turbo, without boost, with boost and no turbine, calibration, sensitivity, knock) | yes | — |
| Estimate the sound / Hear each part / Hear a misfire (`wsndJob`) | Sound | per speed per design from the worker, "Simulated n of m…" | determinate, named after the button pressed; with more than one design "design k of m, <its label>" | designs × speeds | yes | — |
| Reading a recording (`recLoad`, `recFrames`) | Sound | `recFrames` calls back with the fraction of frames read, "Reading…  40%" | indeterminate while the browser decodes the file, then determinate (a percentage, no steps) | frames analysed | no (none underneath) | — |
| OpenWAM case run (`wam`) | 4-Stroke, in the program or the Fusion panel | host events `start` {model, of} and `done` {count, of} | indeterminate until the first `start`, then determinate | models finished of the models in the case | yes (Stop) | — |
| 2-stroke OpenWAM run (`tw`) | 2-Stroke | the same events | as above | models | yes (Stop) | — |
| Muffler check in OpenWAM (`mdw`) | Mufflers | `done` count of of | as above | runs (designs × speeds) | no (none underneath) | — |
| Dyno fit (`dyno`) | 4-Stroke | `done` count of of for the fit; the check run had no event handler | determinate for both runs (the check run's own `done` events are now counted too) | runs | no | — |
| Optimiser, "find the best" (`opt`) | 4-Stroke | `done` count of of; the combined run had none shown | determinate for both stages | runs | no | — |
| Engine Simulator (`es`) | 4-Stroke | `start` / `done` {rpm, ok} per speed, no count | determinate: the page counts `done` against the speeds it sent | speeds | no | — |
| Intake CFD (`cfd`), automatic intake test (`autocfd`), exhaust part CFD (`exh`), Fusion tube CFD (`fxcfd`) | Intake, Mufflers/parts, Fusion panel | OpenFOAM `step` {step}, `progress` {step, iteration, of = the iteration cap}, `cached` | indeterminate, naming the step and the iteration | — (the cap is not the end: the run stops once the flow settles, usually well before) | yes (Stop) | needs the host to send the step list and a convergence measure to be determinate (protocol change) |
| Fusion single calls: auto-route (all `route*`), build / pipe / boom / chamber / reverse-flow chamber / Helmholtz can, print split, fabrication jig, charge-pipe route and build, keep-outs, hanger, mount stand-in and brackets, CFD tube read, STL export (`fusionCall`) | Fusion panel | none (one call, one answer) | indeterminate after the button's row, only while it is still waiting after 300 ms; stops with the add-in's message on a refusal | — | no (none underneath) | Fusion-side progress needs new add-in events (protocol change) |
| Program actions: install the Fusion add-in, install the update (`hostCall`) | program menu | none | as above | — | no | — |
| Update download / check (`updSet`) | program menu | `progress` {done, total} bytes, polled every 1.5 s | determinate in MB while downloading; indeterminate while checking | MB | no | — |
| Saving files (`saveText`, `saveFiles`), picks in Fusion (`hangPick`, `mountPick`), Find OpenWAM.exe | | | none: these wait on a dialog or on the user, not on work | | | |
| File imports (project, OpenWAM AVG/INS files, CFD results, exhaust STL, images) | several | none | none: read and parsed in one go; with the repository's sample files each is well under half a second, and a synchronous parse cannot paint a bar | | | chunk the parse if a real file proves slow |
| WASM | | compiled inside each simulation worker at the start of a run | covered by that run's bar (step 0 while it compiles) | | | |
| Start-up | | the page's first render | none added (see "Start-up") | | | |

Not operations (each well under half a second per keystroke, measured in docs/PERF_2026-11-18.md): the renders
themselves, the Hangers isolator search, the boosted Intake back-pressure march (`BPA`).

## Start-up

TIMING_STARTUP

## Run-time overhead (the default 4-Stroke wave simulation)

TIMING_SIM

## Tests

- New `web/tests/progress_ui.js` (about 1 to 2 minutes): the wave simulation (bar in the reserved space and above
  earlier results; role and aria; the value never goes down; the label; typing in a field keeps focus and caret; the
  next section does not move while it counts or when the results take the reserved space, within 2 px; Cancel; a new
  run replaces a stopped bar), the sound estimate, Hear each part (with Cancel), Hear a misfire, reading a recording,
  the boost simulation (indeterminate start, determinate, Cancel), 400 px dark (no sideways scroll), and through a
  stand-in bridge: an OpenWAM run (determinate from the events, Stop), OpenFOAM (indeterminate, the stripe moving, and
  still under reduced motion; a failure), and a Fusion call (shown after 300 ms, not for an 80 ms answer, a refusal).
  `SHOTS=dir` keeps screenshots.
- TESTS_RESULTS
