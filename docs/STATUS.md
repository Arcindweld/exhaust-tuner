# Exhaust Tuner project — status (keep current; read after any context reset)

Standing rules: accurate, science-based, sourced; everything must actually compute (no decorative output);
do not drop features across sessions; parametric + manufacturable models; flag complex geometry / metal printing.
Target architecture (asked 2026-10-30): ONE standalone Windows app (C#/.NET + WebView2 hosting the calculator page) that bundles
OpenWAM, engine-sim fork, the CFD generator/solver and installs the Fusion add-in; only "our app + Fusion" needed. Needs a new
private GitHub repo from the owner (only Arcindweld/engine-sim is in scope now).

## Pieces and where they live (SP = this scratchpad)
- Calculator page: SP/exhaust-calculator.html → artifact https://claude.ai/artifact/SkHkuxV2hTacf4KHsCDmmW (Version 33: + unequal-length primaries on the Headers tab (uel_patch.py, uel_ui.js; feeds OpenWAM per_cyl/segs_by_group,
  engine-sim primaryL array, Fusion targets_mm), 2025+ RS 660 preset (rs660_25_patch.py)). Palette on PC rebuilt from V33.
  Patches are scripts SP/*_patch.py; tests SP/*_ui.js (run_all_tests.sh, full_ui.js). Type selector (cars/trucks vs bikes) added V30.
- Fusion add-in: /home/claude/ExhaustTuner (cadtools.py, router.py, templates.py, README 4.10.0) mirrored to the PC AddIns folder
  (palette.html = make_palette.py of the current page). 4.10.0: route mode 'bundle180' (templates.Bundle180, 8 port markers in
  cylinder order + 2 collector markers; bay frame from markers; stub-tested in SP/ls3_180/fake/test_bundle_mode.py, NOT yet run
  live in Fusion - needs the add-in restarted) and saveFiles with sub-folders/exec bit for CFD cases. Live checks
  pass (MAF pad with the Nissan STEP; route builds need occurrence-context proxies — fixed 4.9.1).
- Rust core: rust/et_core (stage 1 of the move to Rust, add-in 4.13.0, C ABI 2): the router's queries, fields, search, fit,
  check and the scan fit's cost; fusion-addin/native.py loads it (Python fallback, also when a core call fails part way).
  fusion-addin/tests/test_native.py checks it against the Python, exactly. CI builds et_core.dll on the Windows runner,
  runs test_native --require there (Python 3.12) and on Linux (3.11, the plain-sum path), bundles it.
- Windows program: rust/et_host (requests, solvers, add-in install, updater; exhaust-tuner-host CLI) + rust/et_app (the
  window: wry/tao WebView2, rfd dialogs), stage 2, replacing app/ (C#, kept as reference only, no longer built). Builds
  need Rust 1.88+ (locked crates); NOT yet built or run on Windows (CI billing).
- OpenWAM: SP/openwam_run2 (wam_export.js = make_wam.py port; START_SHIFT_DEG 45 fixes LS3 NaN/crash). Windows batch path proven
  on the PC (calc_ls3_v2): two banks give 440 lb-ft @4600 / 426 hp net vs GM 424 / 430.
- engine-sim fork: /home/claude/engine-sim (main has 1-D exhaust); headless harness SP/x1d/out/es_harness (--wav, --gain, --hold-rpm).
  Exporter SP/enginesim_work/export_es.js has exhaust.grouping 'bank' | '180'.
- CFD: cfd/ (intake_cfd.py 1.1.0, OpenFOAM v2412; JS port intake_cfd.js byte-identical on 172 files). 2-D cases on a
  cyclic sector since 2026-11-01 (the wedge patches carried a 25 % spurious pressure gradient on the conda-forge
  build, NOTES 4 (e)). Validation (medium mesh, tract end): PP 30.34 vs 30.02 g/s (+1.1 %), RAD 36.30 vs 34.83
  (+4.2 %), ELL 38.06 vs 36.15 (+5.3 %); pipe friction 5-6 % below Colebrook, dp vs tau_w within 0.3 %; entrance
  K (static convention) sharp 0.466 vs 0.50, r/D 0.04 0.239 vs 0.24; exhaust: expansion K 0.635 vs Borda-Carnot
  0.562, 90-deg bend 0.196 vs 0.20-0.30 (ESI build). The conda-forge build used here gives 3-D losses 6 % higher on
  a byte-identical mesh (bend K 0.4763 vs 0.4484, run 41317888445): use it for 2-D only; 3-D on ESI's package (CI).
  Page: Intake tab #intake-cfd, Headers tab #headers-cfd (expert mode), Method bullets with the 1.1.0 numbers (page v40;
  cfd_ui.js checks the 1.1.0 validation results).
- LS3 180° system: SP/ls3_180 (layout.py = hand lane plan + numeric checks → ls3_180.json; build_fusion.py staged; Fusion design
  saved "LS3 180-degree headers-back (Exhaust Tuner)"; report doc https://claude.ai/artifact/GPdXc3KgsfKBDxGPH8q9BA;
  sound clips SP/ls3_180/deliver). 53.9 in primaries; 56 bends; parts list sourced.

- Outback recordings (the owner's 2004 Outback 2.5i, 2.5 in stainless + Spintech 3331 after the rear diff): SP/outback_rec/*.wav,
  rpm_track.py (harmonic-comb tracker), order_spectrum.py -> recording_orders.json. Fixed-gain file full_idle_revs.wav: idle 735,
  holds 1980/2585/2955, rising 3550. Mic on the ground 3 ft behind, 1.5 ft right of the downturned tip (ground-plane, ~1.0 m).

- Unequal-length (asked 2026-10-30 14:04): router.route_header spec['targets'] + add-in targets_mm DONE (rt/test_header_uel.py);
  OpenWAM writers v4 DONE; page UI + feeds DONE (V33). Two page-written Subaru cases ran in OpenWAM: UEL 63% half-order
  energy vs EL 0%. Limits: router does not build Y junctions; 4-Stroke tab wave sim still equal length.
  Minor: router chains show a 0.02 mm element gap on one primary (pre-existing; rt/test_header.py P2) - find and fix.
- Second validation vehicle: 2026 Aprilia RS 660 stock (659 cc 270-deg twin, 81 x 63.93, 13.5:1, 105 hp @10,500 / 67 Nm @8,500
  per 1000ps.com 2026 page; Wikipedia: 2025 engine update to 105 hp). Preset exists (2021+ 100 hp entry) - add 2025+ note.
  Stock exhaust geometry (2-1, cat, underbelly silencer, FULL STAINLESS, outlets both sides) needs sourced dimensions.
  RESEARCH DONE: SP/rs660_rec/stock_exhaust_research.md (US MY2026 = Euro 5+ engine, EPA TPVMC0.65XGU: 105 PS @10,400,
  70 Nm @8,400, 52 mm throttle bodies, idle 1400+-100; two stainless headers Y into one underbelly cat+silencer box,
  3 lambdas; NO published pipe/cat/box dimensions -> 14-item measurement list sec. 6). 2025+ preset ADDED (V33).
  Recording SP/rs660_rec/idle_to_5500.wav (gain locked 0 dB) (+ rpm_track.py with NCYL=2, recording_orders.json): idle ~1440 rpm, hold 5460 rpm
  24.2-26.4 s; half-order series dominant (1.5, 1, 2.5). Idle before the rev 10 dB louder than after (AGC or fan?) - asked.

## Open items (in order)
1. Live-test 'bundle180' in Fusion after the add-in restarts (markers from ls3_180_build.py). Then 'per-bank 4-1' and 'Tri-Y'.
2. Outback04 DONE (SP/wamtest/outback04: outback04.py calib|run|sound, results.json). Writers v4 (tail chains, plenum
   muffler, INS output, per_cyl/segs_by_group UEL, intake reservoir), parity 90/90. wam_sound.py (monopole, ground plane),
   order_compare.py. Result vs fixed-gain recording: integer orders 2-6 RMS 3.8-7.2 dB; all half orders 9.7-12.9 dB;
   UEL 1.5-order over-predicted 13-26 dB with PLACEHOLDER manifold lengths (1&3 430, 2&4 600 mm est). Model too bright
   above order 6 (cat = plain pipe, muffler = plain volume) and level trend off. NEXT: the owner's measured runner lengths;
   cat as a substrate (many small channels / porous loss), muffler internals; then RS 660 case.
   Page UEL work running as a separate agent (brief SP/briefs/uel_page.md).
3. OpenWAM-based sound: synthesize from tailpipe INS.DAT outflow (monopole), validate order spectra vs recordings
   (Swartz Garage samples, YouTube stock LS3 / 180° Corvettes, the owner's own car). Today's clips are qualitative only.
4. Desktop app + single repo + installer (GitHub Actions).
5. Videos f72BMpmoGMY, 2fHcBdFX87s never covered (no captions).

## Windows program (branch windows-app), 2026-10-31
- Installer builds green on GitHub (ExhaustTuner-Setup-0.1.0, ~68 MB): desktop app (WPF + WebView2), OpenWAM built
  from CMT-UPV 25f46f2 (matches the Linux build within 0.1 %), Engine Simulator headless (fork PR 1 merged; build
  kept on branch engine-sim-build, refresh with tools/publish_engine_sim.sh), Fusion add-in installed by the setup.
- CFD on Windows NOT shipped. ESI's v2412 Windows package (SourceForge, NSIS around msys64.7z, needs Microsoft MPI):
  meshing works; rhoSimpleFoam fails ("failed lookup of thermo:psi", fields are named thermo_psi on Windows);
  simpleFoam runs but on the same mesh (identical points) gives K 6-9 % lower and Cd 1.4-1.8 % higher than Linux
  v2412 at the same 6,000 iterations. The report script is not the cause (Linux report on the Windows output gives
  the Windows numbers). CORRECTED 2026-11-01: the Linux reference was the one in error, not ESI's package. Those
  cases used OpenFOAM wedge patches, and on the conda-forge Linux build wedge cases carry a 25 % spurious pressure
  gradient in developed pipe flow; the Windows wedge numbers equal the Linux numbers on a cyclic sector within
  0.04 % (cfd/NOTES.md 4 (e); the generator now writes the cyclic sector). The thermo:psi failure is real, so our
  own build is still needed. The Windows binaries report "Build: 34e226dfe3-20211220" (a git commit dated 2021-12-20,
  next to API 2412; the v2412 tarball says _8dbc61e11c-20241220), so what they were built from is unclear.
  Decision (the owner, "rebuild it"): build v2412 for Windows ourselves - see below.
- CAD: cad/parts (CadQuery) and cad/fusion (Fusion script) rough Holley 112-583; K&N filter waits for its part number.

## 2026-10-31, later: OpenFOAM for Windows, CFD in the program, RS 660 model
- OpenFOAM v2412 for Windows, built by us (.github/workflows/openfoam-windows.yml, tools/openfoam/): ESI's v2412 source
  tarball (SHA-256 pinned) + one patch (patch_v2412_windows.sh: 11 files hard-code "thermo:psi"/"thermo:mu" while
  Windows scoped names use '_' -> IOobject::scopedName), MinGW-w64 cross build on Ubuntu (WM_COMPILER=Mingw, dummy
  Pstream, serial), 57 libraries + 8 programs (libs_for_apps.py), ccache. First run: 4 compile-only parts in parallel
  fill one cache, then one job links, packages (package_mingw.sh: bin/ with exes + DLLs + MinGW runtime, etc/,
  SOURCE.txt + build-scripts/ for GPL-3.0 sec. 6) and a Windows job validates (validate_windows.ps1 +
  compare_results.py): both square-cut-pipe cases (rhoSimpleFoam and simpleFoam) at 6000 iterations against the Linux
  runs in cfd/validation/reference/*_6000it_results.json, limit 0.2 % on every plane quantity. Generator 1.1.0
  (cyclic sector, 2026-11-01): our build within 0.015-0.021 % / 0.039-0.051 % of Linux (diag run 41289680200), ESI's Ubuntu package within 0.016 % /
  0.051 %; the earlier 5-9 % "miss" (ours and ESI's Windows package alike) was the Linux build's wedge artifact.
  Run 1 found two include problems (header-only TurbulenceModels/phaseCompressible; surfaceFeatureExtract's own
  library) -> fixed (9353ed3). STATUS: second run queued behind the first.
- Program CFD on Windows, 2026-11-01: the first installer build that bundled the validated OpenFOAM (generator 1.1.0)
  failed its program test. The coarse elliptical-bellmouth case ran simpleFoam to the 6000-iteration cap (the watchdog
  printed nothing; on Linux, through the same host and page, it stops at 1632 iterations, 661 s, test passes), then
  the report step never returned to the page although results.json was written. Fixes in place: the runner streams
  every step's log and log.watch to disk as it runs, stops a report that runs over 10 min and says so; the watchdog
  prints status lines (PID found or not, rows seen, drift each minute, "no longer running"); the program test prints
  the page's progress and stops at once on a host error; windows.yml uploads the runs folder (artifact desk-runs) when
  it fails. Replaying the watchdog on the Windows postProcessing files gives the same stop at iteration 1620 as on
  Linux, so the solver output is right and the watchdog did not see or act on it during the run. The second build's
  logs: log.watch and log.report EMPTY (not even the watchdog's start-up line) and the report stopped by the new
  10-min limit, so both Python processes hung at start-up. Cause (as far as the evidence goes): they inherited the
  host's stdin, the pipe the host's request loop keeps a synchronous ReadLine pending on, and Python's start-up
  fstat of fd 0 (GetFileInformationByHandle) waits for that read on Windows; OpenFOAM's and OpenWAM's C runtimes
  only call GetFileType and were not held. The Core test passes (no pending read there), so did Linux. Fix: the
  runner gives every child its own stdin pipe, closed at once.
- Program CFD: Core/OpenFoamRunner.cs (Allrun without bash; watchdog = the case's intake_report.py --watch PID; 3-D
  designs generated first (bundled Python then; in Rust since stage 5); checkMesh aspect-ratio-only flags are a note), request
  runOpenFOAM, page "Run in OpenFOAM on this PC" / Stop in the intake CFD section. windows.yml bundles the newest
  PASSED openfoam-windows run's zip (90-day artifact) and python.org's embeddable Python 3.13.17 (SHA-256 pinned);
  REQUIRE_OPENFOAM then makes the Core test, the page test and an installed-program CFD run mandatory. Linux checks:
  Core 10/10, desktop page test runs the intake case end to end (926 iterations, stopped once settled).
- intake_report.py watchdog bug fixed: os.kill(pid, 0) is TerminateProcess on Windows (would have killed the solver);
  now OpenProcess/GetExitCodeProcess there. intake_cfd.js rebuilt (172 files identical), page artifact Version 34.
- windows.yml: paths-ignore for notes/CAD/validation/OpenFOAM-build pushes, cancel-in-progress, artifact retention.
- OpenWAM writers: tail element {"outlets": [[segments], ...]} after the last plenum = muffler box with several exits
  (parity 98/98; OpenWAM runs it). wam_sound.synthesize_multi(): outlets summed coherently at one mic.
- RS 660 stock: validation/rs660-2026/model (rs660.py, NOTES.md). All exhaust dimensions estimated. Idle RMS 10.1 dB,
  5460 rpm hold 8.0 dB, idle->hold level +13.9 vs +12.0 dB. Needs the owner's measurements (research doc sec. 6).
- Outback: Subaru service-manual valve events + real valve sizes adopted; high orders moved < 1 dB, so the remaining
  error is the placeholder pipe lengths (per-order structure), not the cam. WOT torque 17 % under rating (intake and
  combustion defaults).
- Exhaust-part CFD in the program (282f5b1): Headers tab picks the part's STL (one ASCII file with named faces, or one
  file per face), checks the faces, runs generator + snappyHexMesh + solver here (Linux check: 76 mm tip, rhoSimpleFoam
  926 iterations, K 0.217). Case files carry base64 bytes. "Open the case folder" after runs.
- Fusion add-in 4.11.0 (6b3121f): "Export the STL from Fusion" (cadtools.act_export_cfd_stl + stl_ascii; select the
  gas-space body's flat caps in the page's order). The page had claimed the add-in did this before it existed - fixed.
  NOT yet run live in Fusion (device was offline): test it there (one solid body, caps selected in order).
- K&N "B047C6": a code printed on K&N cone filters (eBay: cones pulled off BMW E46 intakes, one listed 3.75 in); not a
  catalogue number. cad/parts/kn_round_tapered.py needs flange ID, flange length, base OD, top OD, length.

## 2026-11-01: new interface, independent audit
- UI redesign (5be9d05; artifact Version 37, same URL): app bar (mark, Simple/Expert, units, colour-theme button,
  program menu in the Windows program), calculators in a grouped rail >= 1180 px / sticky strip below, readout strip,
  CAD-style drawing well, Archivo embedded (OFL). All IDs/hooks unchanged. Windows program: no WPF menu/status bar;
  DWM dark/caption colour follows the page (request uiTheme), page menu does runs folder (openRunsFolder), add-in
  install/status, reload, devTools, engines and licences. Build scripts for the redesign: SP/ui/build_ui.py (applied to
  the pre-redesign page SP/ui/index_orig.html; from now on edit web/index.html directly).
- Two independent audit agents (claims/baselines/tests; physics/units). Confirmed and FIXED (5be9d05, 9061c52): VR6
  manifolds 1-3/4-6, R1 270-180-90-180, Viper 54/90, Roark long-panel plate beta (0.75/0.50), Smith uses the whole
  exhaust period, UEL layout port size from the engine tab, Method text (98 writer cases; Yasuda 252/243 Hz),
  test runner now fails on exit codes and problem markers, wam_ui reads committed fixtures (openwam/ref/i4_41_6000),
  print_ui hand-worked values, Fusion tests exit non-zero -> exposed router failure (UEL P3 straight 0.2 mm short),
  fixed by refitting with heavier straight weights, bundle test checks against ls3_180.json, sound scripts' imports,
  run_models EXHAUST_TUNER_OPENWAM, openFolder restricted to runs/saved folders, Core tests on Linux in CI (15 tests),
  version consistency test. RS 660 notes corrected (orders within 3 dB at the hold: 1, 4, 4.5, 7; second-pass RMS
  7.8 dB, idle->hold +13.7 dB; length-table rows other than "as estimated" are first-pass).
- IN PROGRESS: CFD fork on branch cfd-cyclic-sector (worktree /home/claude/et-cyclic): wedge -> rotational cyclic
  sector, friction_f momentum term, exhaust-mode friction subtraction (bend K 0.224 in band, expansion K +14 % not +6 %),
  fine mesh no-op in 3-D, openfoam-windows triggers/provenance, NOTES. Page CFD Method text waits for its wording.
  Preset agent: 29 presets violate hp*5252/hpRpm <= tq (list SP/presets/inconsistent.json), sourcing corrections.
  Outback rerun at 64 kHz / 28-48 cycles: done 2026-11-01 for 10 of the 11 jobs (see the Outback rerun line below);
  the order figures held.
- engine-sim (Arcindweld/engine-sim main, all merged 2026-11-01 with green Windows CI):
  PR #2: convergent port coupling. The old port <-> primary coupling did not converge (I4 at 6000 rpm 148.7 / 183.6 /
  118.5 / -6.7 N m on 4 / 2 / 1 / 0.5 cm). Now a valve-type characteristic boundary at each primary inlet solved
  after every fluid sub-step, port volume by the midpoint rule, junction receiving ends take the mixed state, port
  energy/momentum exact; tests: Sod/blowdown vs exact Riemann, junction temperature front, port energy, steady
  orifice flow, coupled-port convergence + chatter, 4 cm vs 2 cm tuning agreement; CI runs the 1-D tests and a 1-D
  smoke run. PR #3: port face search without pow (19-41 % faster, same roots to six digits) and
  Synthesizer::m_latency initialized (upstream bug: the first frame's step count came from the heap, so the
  engine-level tests depended on run order). PR #4: pipes held between their own CFL steps while the ports keep
  every fluid sub-step (2.0-2.2 pipe steps per simulation step at 20 kHz on 4 cm instead of 8; less numerical
  diffusion, coarse grids nearer the fine one). Now: I4 at 6000 rpm 140.7 / 138.1 / 137.5 / 136.9 N m on 4 / 2 /
  1 / 0.5 cm, 140.2 / 138.1 / 139.4 at 15 / 20 / 40 kHz (seeds spread about 3 N m); 4 vs 2 cm agree on every
  primary-length change at 4000-7000 rpm, single runs within 4.6 %; legacy bit-identical to upstream (fresh
  processes). Cost on 4 cm cells, CPU s per simulated s: LS V8 at 10 kHz 2.0 (2.8x legacy; 3.8 after PR #2),
  EJ25 at 20 kHz 2.0 (2.8x; 6.3), I4 at 20 kHz 1.5 (2.2x; 3.5); 2 cm costs 1.5-2.2x the 4 cm time. Mechanism of
  the 4-1 low-rpm hole traced (neighbour's blowdown at 1.5 bar at overlap TDC, exhaust pushed into the lumped
  intake runner). Windows build of main published to the engine-sim-build branch (tools/publish_engine_sim.sh
  steps) after each merge.
- Exporter (61b6778): fork-target files get simulation_frequency = max(donor, 3 x redline rounded up to 5 kHz)
  (engine-sim needs <= ~2 deg of crank per step: the I4 lost a third of its torque at 3.6 deg/step in both
  models); the page's exporter copy had drifted from enginesim/export_es.js (no exhaust.grouping) - synced, and
  es_ui.js now checks they stay identical.
- Presets (b3f307d): 2.5 TFSI 400 PS (power 5,850-7,000 / torque 1,700-5,850 rpm, Audi) and 2015 RS 3 8V
  (5,550-6,800 / 1,625-5,550) were 8.3 % / 2.7 % inconsistent; Hayabusa 2008-20 now Suzuki's crank figures
  (194 hp @ 9,500, 155 N m @ 7,200). tests/presets_ui.js: hp*5252/hpRpm <= 1.03 tq for all 1033 presets.
- Outback rerun (64 kHz INS rows, 48 cycles at the holds, 16 at WOT), 2026-11-01: 10 of 11 jobs finished (runs/ not
  committed; results.json, runs_summary.json, sound/*_orders.json are). No-load holds land within -3.7..+2.1 N m of zero
  brake torque, so the calibration holds; WOT 180 / 178 / 188 / 191 / 183 N m at 2000 / 2800 / 4000 / 4800 / 5600 rpm
  (133-141 lb-ft, 144 hp at 5600; rated 166 lb-ft / 165 hp: still 15-17 % under), 479 sonic messages at 5600.
  Relative order levels against the recording: RMS 10.5 / 10.3 / 12.3 / 9.9 dB at the 1980 / 2585 / 2955 / 3550 holds
  and 11.7 dB at the 1915 AGC clip, within 0.2 dB of the stored runs; level trend vs the 1980 hold: recording -1.8 /
  -1.4 / -0.1 dB, model -8.1 / 0.0 / +1.1 dB. So the earlier conclusions stand (placeholder runner lengths, plain-pipe
  cat and plain-volume muffler). idle_735 (28 cycles) did not finish inside the 2 h run limit, twice (88 % at
  1 h 55 min of CPU; the throttled idle is far slower per cycle); not restarted as-is. It needs a run without that
  limit (a CI job, or a shell left running), or fewer cycles; its 24-cycle result is in git history (230b1aa).
- RS 660 header-length table rerun at the main settings (64 kHz rows, 72 cycles; rs660.py sweep, sweep.json),
  2026-11-01: RMS against the recording 4.6 / 7.8 / 9.2 / 6.3 dB at -50 / as estimated / +50 / +100 mm (first-pass
  rows were 5.4 / - / 6.2 / 6.9); a 50 mm change moves single orders by up to 11 dB, so the lengths still have to be
  measured before the order balance means anything.
- OpenWAM's mean pipe flows are no mass balance (found checking the sweep's settling figures, 36ff407): its
  boundary conditions do not conserve mass at closed valves and open ends. RS 660 model: the runner gas next to a
  closed intake valve drifts into it at 1.2 m/s (5460 rpm) / 3.6 m/s (1442 rpm) without reversing, runner means
  read 11 % above / 3.7 times the cylinders' intake, the outlets' open-end node 19 % below mid-pipe; 5 mm cells do
  not remove it. The RS 660 notes and the sound docs had used the tail/intake station ratio as a settling test:
  corrected. Settling now comes from the boxes' own density and temperature drift (run_models plenum_settling;
  box_settling in both validation summaries: RS 660 hold 0.02 %/cycle and 1.2 K over 10 cycles, idle still
  warming 6.7 K; Outback holds 0.01-0.05 %/cycle). Runners rerun a model when its .wam text changed or its last
  run did not finish (run_models.write_and_run; --no-run re-summarises); non-finite results no longer count as
  finished (LW+FCT went NaN on the RS 660 model while OpenWAM printed SIMULATION FINISHED CORRECTLY). Cell-size
  check at the RS 660 hold (72 cycles): 5 vs 10 mm moves orders 1-2.5 by 1-2 dB but orders in or next to a dip by
  up to 15 dB (5.8 dB RMS over orders 1-7; RMS against the recording 7.8 -> 8.8 dB); 7.07 mm agrees with 5 mm
  within 1 dB on every order but order 4, so 10 mm is the outlier; NMEP 1.593 / 1.567 / 1.527 bar at 10 / 7.07 /
  5 mm has not settled. A 14-cycle check had shown less (3.5 dB RMS). So the order balance conclusions (orders
  1-2.5) stand; single high orders at 10 mm do not; the RS 660 reruns with measured dimensions should use 5 mm.
  At wide-open throttle the page's 10 mm cells are fine for torque: net torque and VE within 0.4 % of 5 mm for
  i4_41 at 4000 / 6000 rpm and 1.0 % for v8_dual at 5500 rpm (30 cycles; make_wam DEFAULTS comment). Outback
  2585 rpm hold (48 cycles), 7.5 vs the model's 15 mm: RMS against the recording 10.3 -> 10.9 dB, orders 2-5.5
  within 2.6 dB, single orders above the 5th up to 8 dB (outback04.py docstring). Page artifact Version 42 (Version 47 adds the build sheet, 48 sizes the main pipe by inside area): the
  OpenWAM Method paragraph and the order-spectrum caption state both limits.
- Program updates (2026-11-01): each push to windows-app that passes the Windows build becomes GitHub release
  v0.1.<run number> (installer + SHA256SUMS.txt, notes = commits since the previous release, newest 6 kept; job
  "release" in windows.yml). Versions: 0.1.0 on a PC (app/Directory.Build.props), CI stamps APP_VERSION into the
  program, the host and the installer; HostDispatcher.Version reads the assembly. The program (Updater.cs) checks the
  releases 4 s after start and every 6 h, downloads a newer one in the background, verifies size + SHA-256, and the
  page's program menu shows "Restart and update" (dot on the menu button). Install = the installer silently over the
  same folder and tasks (/MERGETASKS=addin when the add-in is in Fusion), /WAITPID makes it wait for the program to
  close, /RELAUNCH=1 opens it again; blocked while a solver run is going and for copies not set up by the installer.
  The repo is private: the program needs a fine-grained token (Contents read-only on exhaust-tuner), saved in the
  menu, DPAPI-encrypted in %LOCALAPPDATA%\ExhaustTuner\update-token.bin, sent only with the first request to
  api.github.com (never with redirects; the page test caught a same-host redirect carrying it, fixed). Tests:
  UpdaterTests (13, incl. a stalled download giving up), web/tests/update_ui.js (page + host + stand-in GitHub),
  CI reinstall with /WAITPID + /RELAUNCH.
  the owner: install the first release by hand once, then save the token under Updates.
  Found by the new CI start check: in every installer so far the window itself did not start ("Could not load
  WindowsBase 8.0.0.0"): staging copied the self-contained host's DLLs over the program's, and the plain runtime's
  6 KB WindowsBase.dll shim (4.0.0.0) replaced WPF's (8.0.0.0). CI had only ever run the installed host, never
  the window. Fixed (host files no longer overwrite the program's; staging checks WindowsBase is WPF's; CI starts the
  installed window and checks it records its start and loads the page). v0.1.43 and v0.1.45 are withdrawn
  (installer/withdrawn.txt: the release job marks them pre-release, which the update check skips).
  BLOCKED 2026-11-01 22:32 UTC: run 41357646058 (85ca179, the window fix) was not started by GitHub: "recent account
  payments have failed or your spending limit needs to be increased" (Billing & plans). Re-run it once billing is
  sorted; it builds the first good release (0.1.4x) and withdraws 0.1.43 / 0.1.45. One program build costs about
  15 Windows minutes (openwam 2, app 13; counted double on a private repo) + 1 Linux minute: ~32 billable minutes.
  This session cannot edit or delete releases (403); the release job does it.
- Updates and build cost, 2026-11-02 (while CI waits for billing): the update menu warns from 14 days before the
  token's expiry (GitHub's GitHub-Authentication-Token-Expiration header), links GitHub's new-token form filled in
  (name, owner, 366 days, contents=read; only the repository is picked by hand), shows what changed once after an
  update (notes saved with the download; StartRecord gives the previous version), and retries in 30 min after a
  network error. UpdaterTests 16, update_ui.js 27 checks (incl. a second start after an update). CI: OpenWAM built in
  the app job only on a cache miss (the openwam job is gone), Playwright's browser cached, and the page's full
  OpenFOAM run (about 6 of the app job's ~13 min) only when cfd/, Core, tools/openfoam, desktop_ui.js or
  windows.yml changed since the last release (the install step runs a short OpenFOAM case every build). Expected:
  ~7 Windows minutes a build (~15 billable with the Linux jobs) instead of ~15 (~32). Not yet run in CI.
- Fusion add-in 4.11.1, 2026-11-02 (page change; add-in Python unchanged): "Auto-route the J-pipe through the scan"
  deleted target_mm (in the page since the import, d65cc48), so the routed J-pipe was untuned. It now carries the cut
  length (calcQW L, pipe wall to cap) with a note on where the markers go; Mufflers-tab path results show the miss
  against the cut length and the frequency it tunes to (f = c / 4(L + 0.3 d)). jpipe_ui.js 16 checks (8 fail on the old
  page); test_router.py scene 3: a J-pipe off a 3 in main pipe in the scan, 60.120 cm exactly, 2.5 cm clear. Add-in
  manifest 4.11.1 so the program shows the installed panel as older.
- Fusion add-in 4.12.0, 2026-11-02: drone-fix parts, NOT yet run in Fusion (the owner: "build them, we can test later").
  J-pipes (path and route builds) get a cap plate (m-jc, 1/8 in) and a coped tee end; act_helmholtz builds a neck
  (coped) and a can along it (templates.helm_can: inside length keeps the gas volume when the neck runs in, m-nin;
  wall m-cw, 16 ga). Main pipe: selected round face > a solid under the marker (_pipe_under, 2 mm) > a 5-number
  cylinder fit to the keep-out scan (templates.fit_main_pipe: refuses non-round, <60 deg coverage, rms > 1.5 mm).
  Cope = TemporaryBRep ring minus the main pipe's outside, joined to the tube (CombineFeature); hole = hidden tool
  body. Moved components handled (_comp_frame). Also fixed: _cone_shell and _part_bodies were called in fallbacks
  but never defined (NameError after the tubes were built), and _add_bodies named bodies inside the base feature
  edit (came back "BodyN"). Tests: test_drone_parts.py (closed form / brute force / fit), test_drone_fusion_mock.py
  (30 checks against a recording stand-in for the API), helm_ui.js 15, jpipe_ui.js 17, page suite 36/36; live script
  fusion-addin/tests/fusion_live_drone_parts.py (can, path, route, tilt, hole, scan) to run in Fusion. A separate
  review (fresh agent, 2026-11-02) found: off-square markers left the tube's first mm inside the main pipe (now cut
  with the main pipe's outside after the join; tee_cope 'top', brute-force checked: 2 deg 1.11 mm, 3 deg 1.66, 10 deg
  5.60), the hole tool stopped at the start (tee_hole now spans the wall), a same-size J-pipe on a scan read a hair
  small was never coped (snap within 1 %), _pipe_of_face took a coaxial flange's radius (now the face the start is
  on), offset part stubs ran at an angle, the live scan test used a hollow mesh and could not tell coped from not.
  All fixed and tested; tip trims 2.5 mm (no knife edges), 20 micron overlap at the joint. Fusion API names checked
  against Autodesk's docs (TemporaryBRepManager.createCylinderOrCone / booleanOperation, CombineFeatures.createInput,
  SurfaceEvaluator.getParameterAtPoint / isParameterOnFace, BRepBody.volume).
  Live run in the owner's Fusion (2026-11-02, the 4.13 files staged in %TEMP%\et_live_4_13; his installed add-in is
  4.11.0 and was not touched): all six pass. Helmholtz can 181.73 cm^3 built for 181.73 asked, neck meets the main
  pipe with no gap or overlap, can 49 mm clear, hole tool cuts 3.75 cm^3 of wall; the four hole tools cut 21.1 cm^3
  together. It found three test bugs (measure/boolean need assembly-context proxies; exportManager is on the Design;
  the route test's end marker gave the bends no room) and two add-in bugs, both fixed: overlapping bends / a 0.1 mm
  bend at a corner made a centreline Fusion would not sweep (cadtools._buildable folds a bend under 0.5 mm and 0.5
  deg into its straight; overlapping bends are refused with the overlap and what to change), and a same-size J-pipe
  on a scan was left square because the fitted axis is a hair off square to the marker, so one side passed beside
  the main pipe (templates._graze: a side within the same-size allowance counts as touching; a farther lean gets
  why='side'). Main pipe sizing on the Quick tab (2026-11-02): Stainless Headers' 2.2 cfm/hp and 115 cfm/in^2 now
  apply to the tube's inside (OD less two 0.065 in walls, 2 % rounding); their own example rounds 400 hp duals to
  2.25 in, 8 % short on inside area, while their chart lists 2.5 in, which is what the page now gives.
  Installed on the owner's PC (2026-11-02, he asked "install the newest"): 4.13.0 into AddIns\ExhaustTuner (4.11.0 kept as
  AddIns\ExhaustTuner_4.11.0.zip beside his older zips; ls3_180 files untouched), palette.html written by
  exhaust-tuner-host --install-addin, et_core.dll cross-built here (Windows CI is stopped by billing):
  `pip install ziglang cargo-zigbuild` (through the proxy: NO_PROXY=localhost), then in rust/et_core
  `cargo zigbuild --release --target x86_64-pc-windows-gnu`. The first build failed test_native on Windows (block
  scene: residuals, certify, LM, two routes off by up to 1.9 cm): MinGW's sin/cos/tan differ from the UCRT that
  Python calls. et_core/src/cmath.rs imports them from api-ms-win-crt-math (raw-dylib) on windows-gnu; then
  test_native.py --require passes on his PC in Fusion's Python 3.14.7, run out of process (header: Python 141.6 s,
  core 1.0 s), and still on Linux. He has to Stop/Run the add-in or restart Fusion to load it.
  He reloaded Fusion: the add-in runs 4.13.0 (cadtools._buildable, templates._graze present) and router.NATIVE_NOTE
  is "Rust router core" with native/et_core-4364a4b466a8.dll (the UCRT-maths build).
- Repositories public (the owner, 2026-11-02): Actions run again (public repos' standard runners are free; the earlier
  runs were stopped by billing). The first real run failed: .gitignore's bin/ (meant for .NET) had kept
  rust/et_host/src/bin/exhaust-tuner-host.rs out of git since 4742263, so cargo found no host binary; now
  !rust/*/src/bin/. The updater (rust/et_host/src/updater.rs) needs no token any more: without one it asks GitHub
  anonymously (60 requests/h per address; a check is 1, a download 2); a 404 without a token means private again ->
  state not-configured with that reason, and the page shows the token box. The page always checks (4 s after start,
  every 6 h); Change token reads Add a token when none is saved. Tests: tests/updater.rs (public no-token check +
  download with no Authorization anywhere; private 404 -> not-configured), update_ui.js (private first, then a fresh
  install against a public stand-in). Releases are public downloads now. app/ExhaustTuner.Core/Updater.cs (C#, not
  built or shipped) still wants a token. Public-content check of both repos (history included): only made-up test
  tokens, no keys, no scanner model; visible: the commit email, the Windows user name in default paths
  (C:/Users/<you>/...), the engine recordings under validation/, the Header Wizard comparison text.
- Identifying data removed (asked 2026-11-02, "rewrite all history", Header Wizard comparison kept without the licence
  line): git filter-repo over both repos (mailmap to 350119910+Arcindweld@users.noreply.github.com; replace-text and
  replace-message for the owner's name, user-folder paths, location and the licence wording), every branch force-pushed.
  Binary blobs unchanged; tests pass on the rewritten tree. Commits from now on use the noreply address. Backups of the
  old history: scratchpad scrub/backup/*.bundle (this session only). Not reachable from here: the release tags v0.1.43
  and v0.1.45 (tag push refused, 403) and their installers, the old Actions runs, engine-sim's PR refs and GitHub's
  cached views of old commits.
- 8-4-1 headers (2026-11-03, "Research concept 841 headers designs and learn from them"): Concept 841 (Lodi, CA;
  C5-C8 Corvettes, S550/S650 Mustangs) publishes only sizes: C7 2.00 in primaries, 2.25 in secondaries, a 4-1 with
  2.25 in inlets and a 4.5 in outlet; Mustang GT 1.875 / 2.125 in, a flat 4-1 on manuals; secondaries "split at the
  headers", the 4-1 at the rear on a C8; designed in EngMod4T; one power claim (+37 whp / +32 lb-ft, C6 LS3 with a
  cam). Their C8 Z06 (flat-plane LT6) gets per-bank equal-length 4-1s instead. Headers tab: the two-stage merge now
  takes all eight of a V8 (8-4-1): pairs on their own bank 180 deg apart (pairs841), four secondaries, the collector
  from four secondaries; typed pairs (any 4 x 2); per-bank Tri-Y, 6-2-1 and 8-1 unchanged. web/tests/h841_ui.js.
  openwam/v8_841_study.py (results in openwam/ref/v8_841/): 6.2 L LS3-like V8 (stated parameters), Concept's C7
  tube sizes, 36 in valve to collector, 6 layouts x 3000-6600 rpm (7.07 mm cells, 40 cycles; 5500-6600 again at
  5 mm, 50 cycles: within 1-4 %). Torque vs per-bank 4-1: 180 deg same-bank 8-4-1 within 4.4 % everywhere (0 %
  at 6600); 270/450 deg pairs +6.5 % at 3000, -8 % at 5000, -28 % at 6600; 360 deg cross-bank +9 % at 5500, -35 % at
  6600; 8-1 and 180-degree headers within 4 %. Sound at 5000 rpm (open pipe): per-bank 4-1 half orders 8-16 dB below
  the strongest; every 8-4-1 and the 8-1 24-66 dB (180 deg pairs 55-66). The model's absolute torque falls off
  faster above 5000 rpm than a real LS3's (crude intake: open 0.3 m runners), so read differences, not levels.
- Upgrades (2026-11-03, "I want all of these upgrades", from the list of 11): DONE so far:
  cam events at 0.050 in (checkLift_mm; the sin^2 lift stretched to pass the check lift at the card's angles; make_wam
  seat_events = page camSeat), GM's LS3 events (ivo -19, ivc 43, evo 38, evc -7 at 0.050 in); intake plenum with
  throttle body and inlet tube (make_wam v5, 4-Stroke inputs); combustion efficiency 0.98 min(1, 1/phi) (v6; Woschni
  already takes the wall heat, the old 0.72 counted it twice; rs660/outback04 pin 0.72 to keep their documented
  results; tests/fixtures/wam_default regenerated for it) -> stock LS3 brake 423 lb-ft @ 4600 (GM 425), 461 hp @ 5900
  (GM 430, LSX Mag dyno 461.5); cam library (LS3, LS9 card; LS7/LS6/LS1/LT1 straight up, marked assumed); dyno fit
  (valve Cd and combustion efficiency fitted to measured brake torque, two runs per point and a check run); header
  optimiser (10 designs around the Headers-tab layout, ranked by mean brake torque in OpenWAM); side-branch chambers on
  primaries (v7) and J-pipes / Helmholtz cans on the line after the collector (closed-end BC); Projects (header
  button: save the whole build by name, load it back exactly, export/import .exhaust.json, compare two: inputs that
  differ in the units chosen and OpenWAM brake torque speed by speed; tests/project_ui.js). All done since except
  code signing (needs the owner's SignPath or Azure Trusted Signing account): cut list from stock mandrel bends under every routed tube (tests/cut_ui.js); tack jig
  cradles in Fusion (jig.py, act_jig, tests/test_jig.py, checked live: one lump each, no overlap with the tubes); cam
  card entry (duration, lobe separation, advance -> the four events, camEvents = inverse of camCard) on the 4-Stroke
  tab and exhaust opening from a card on the Headers tab, prompted by the CamCalc Wizard sheet (BuildAndClick, sent by
  the owner 2026-11-03; standard cam-card arithmetic, the sheet itself not copied into the repo); mandrel bend research
  (web/data/mandrel_bends_research.json: 152 JMD, 60 Vibrant, no Alucon found) merged into the parts list as PARTS_BENDS2 (209 new; the cut list and the Parts tab use them).
  CFD merge losses into OpenWAM (make_wam v8, wam_export.js the same, test_py_js 106 cases): collector loss_K and
  stage loss_K put a quadratic pressure-loss BC (TCCPerdidadePresion, type 10) on every line into that merge, 3
  cells before it; an LS3 dual 4-1 at 5000 rpm with K 0.6 lost 0.5 % torque (PMEP 0.79 -> 0.84 bar). Page: K inputs
  under the line after the collector, and "Use K in OpenWAM" under the exhaust CFD results (collector / secondary).
  8-4-1 study re-run on the calibrated LS3 (v4, openwam/ref/v8_841/results_v4*.json): against per-bank 4-1s the
  180 deg pairs are within 3 %, 270/450 pairs within 2 %, 360 deg cross-bank within 1.4 % to 6000 rpm and -4.9 % at
  6600; first merge 250/500 mm and secondary 0.8/1.0 area ratio move torque 2 % or less. The old (pre-fix) -28 % /
  -35 % figures were an artefact of the wrong cam timing; Headers-tab note updated. Sound at 5000: per-bank 4-1 half
  orders 1-14 dB below the strongest, 8-4-1s 28-55 dB (180 pairs 52-55), 8-1 67+.
  2-Stroke tab "From the engine" (Blair by BMEP, 2/3 stage), compared with 2 Stroke Wizard 8 and Dual Power (method
  notes; the Wizard's test file Test125.d2t was saved in the owner's Documents folder).
  Skin temperature and clearance (Headers tab, heatSection/calcSkin, tests/heat_ui.js): Gnielinski x CAF inside,
  wall/coat/wrap conduction, Churchill-Chu + Churchill-Bernstein + grey radiation outside, gas marched along the
  primary; nearby-part gap from a facing strip (finite-tube view factor, eps_tube x eps_part) against part limits and
  GM rules. Matches the research note's independent sanity run (703 C bare WOT, 413/806 C wrapped). Research:
  docs/research/header_skin_temperature.md.
  Two-stage header routing (router.route_triy, cadtools act_route mode 'triy', page button "Auto-route a two-stage
  header"): primaries of each group into a Y merge at its marker, then the secondaries into the collector, one
  TubeSet across both stages; each Y is lengthened to bring the tubes together at 15 deg and the extra comes off the
  secondary. tests/test_header_triy.py, the mock glue test, web/tests/triy_route_ui.js. Not run in Fusion yet.
  2-Stroke tab "Run it in OpenWAM" (2026-11-03, "add whatevers needed for the 2 stroke tab"): openwam/wam2t_export.js,
  a byte-identical JS port of make_wam2t.py plus wam2t_summary (test_py_js_2t.js: 52 specs incl. piston port, 0-D reed,
  silencer, twins, 40 random; the summary equal to 3e-16 on the 30 runs2t folders; in CI), embedded in the page
  (tools/sync_wam_export.py checks both writers). Fields for rod, trapped CR, crankcase CR, AFR, ignition/burn,
  exhaust window (rectangle with radii or round, Cd), one equivalent transfer (duration, width, duct, Cd), reed (petals,
  size, material, block window, moving or quasi-steady with a stop) or piston-port intake; blank = listed assumptions.
  One .wam per speed for the designed chamber and a straight pipe of the same length; download, run on this PC (host
  runOpenWAM), or pick AVG/INS files; brake hp curve, BMEP, IMEP, crankcase work, DR, TE, CE. web/tests/two_wam_ui.js
  runs real OpenWAM through a stand-in host: 125 MX 31.2 hp chamber vs 14.3 straight at 12000 (20 cycles). The dual
  power insert (2026-11-03) is a second path between two junctions (TCCRamificacion, BC 12) from the belly end x0 to
  the end of its pipe, the cone annulus as an equivalent diameter sqrt(Do^2 - Di^2); perforation not modelled (solid
  wall). make_wam2t dual_lines + the JS port (test_py_js_2t: 55 of 56 the same bytes, 1 both refuse). With an insert
  designed, the tab writes a third set of models; 125 MX: 25.0 -> 25.5 hp at 10000, 31.2 -> 29.7 at 12000.
  Headers tab "Pulse gaps at the collector" and "Pair the pulses" (the owner's sound-engineering note, 2026-11-03):
  arrival gaps L/a at several RPMs with the short- and long-gap rates; pairing helper puts +dL/2 on the first pulse of
  each pair and -dL/2 on the second (dL = (even - short gap) a / (6 rpm)), mean length unchanged. web/tests/pair_ui.js.
  Videos 2026-11-03 (captions; frames refused 403, Gemini 503, retrying): stepped primaries (step halfway = our 50/50;
  4A-GE test: smaller section out of the head a small gain), Borla Polyphonic (+ David Borla: asymmetric duals a fifth
  apart) -> Sound tab "Two notes on true duals" (tests/duo_ui.js) and interval names in the pulse-gap table, a truck
  J-pipe drone cure (2.5 x 28 7/8 in, 117 Hz; best at 2000-2100 RPM = branch near 150 C) -> J-pipe hot start length.
  DDP intake dyno sheet (+2.8 % peak, one pull each) and AirRam stacks: docs/research/datadrivenperf_intake.md.
  Timbre tube bundle (Mufflers tab, "research Timbre scaled exhaust system"): Borla US10808584B2 (3-5 parallel
  tubes 1-1.5 in x 1-8 in between collectors, sized from the root note; no formula in the patent) modelled as parallel
  plane-wave ducts (admittance sum, 0.3 d end allowance each end); checks: one tube / equal tubes 0 dB, HQ notch at
  c/(2 dL); sizing to harmonics 8/10/12/16 of the firing tone; plane-wave limit 1.8412 c/(pi D). tests/timbre_ui.js.
  Spintech (owner's cutaway photo + case chart): spiral traps = US 5,824,972 (Butler 1997; Spintech link unconfirmed);
  Mufflers tab "Muffler types: flow against quieting" (patent's 2.5 in / 5 inH2O figures scaled by area and the square law
  to redline flow; inlet for 5 inH2O and 1 psi) + Spintech case chart vs the space limits; Spintech parts retyped
  'spiral'. tests/spiral_ui.js. Lobak (research agent): auger muffler, no primary source; Moroso Spiral Flow; US
  3,963,092. Mufflers tab "Auger muffler": core tube + helical channel as two ttMatrix paths. tests/auger_ui.js.
  LIVE in Fusion (2026-11-03 21:10, owner's PC, add-in updated in place from this tree): two-stage route (4 primaries,
  2 Y merges 12.1 cm at 15 deg, 2 secondaries 40.3 cm, collector) built in 1.5 s with the Rust core, all clear of a
  frame-rail keep-out; tack jig 25 cradles in 2.9 s. Fixes from it: Part Design documents (new_component reads
  design.designIntent first: a failed addNewComponent leaves Fusion's error set and the next
  TemporaryBRepManager.get() re-raises it); saddle cuts that hit near-coincident faces (ASM_BAD_CONTAINMENT) retried
  0.03 mm larger / 0.1 mm longer, else listed; a cradle slid to clear a crossing tube no longer lands on a steep
  stretch and the note gives the real reason. Fusion MCP scripts must define run(context) or their changes roll back.
  Fabrication jig generator (owner's photos, 2026-11-03): jig.plan_fab (styles cradles / base / plate / saddle / frame;
  layout model / flat via best-fit plane; mount free / table on a System 16/28/5-8in/custom grid with tabs; flange
  locators at free ends; weld gaps; bed check) -> primitives -> cadtools.fab_body; page "Fabrication jig" options in
  the Fusion panel (jigBlock, jigPayload, projects keep them). Live on the owner's PC: Tri-Y base frame on System 16
  (19 s), plate laid flat (tallest 635 -> 171 mm, 6 s), flange frame on a crossover. tests/test_fabjig.py,
  web/tests/fabjig_ui.js, mock glue (saddle on a table). Instagram example post not reachable (robots).
  Two-stroke OpenWAM writer openwam/make_wam2t.py (tests/test_2t.py; nm2T block, TLumbrera ports from timing,
  TDepVolVariable crankcase, reed TLamina or piston-port intake, chamber segs). 125 with our chamber: 31.7 hp peak at
  12000 (straight pipe 15-20 hp); Maico 490 with the Wizard's chamber: 35 hp peak at 5500 (claimed 53 at 6500).
  Low power from assumed port widths, Cd and a reed without a lift stop; a dummy port moves OpenWAM's end of gas
  exchange from transfer closing to exhaust closing. Not wired into the page yet (needs a JS port like wam_export.js).
  v8_841_study.py now resumes (finished runs of the same case text are kept; fresh=1 forces);
  the v4 rerun on the calibrated engine is in openwam/runs/v8_841/*_v4*.
- Install made simpler (2026-11-03, "write instructions and simplify install"): INSTALL.md (download link, the
  SmartScreen screen, options, Fusion add-in, updates, where files go, uninstall, troubleshooting); README and every
  release's notes point at it. The installer is one click ("one click install like a proper software"): no page
  at all (no install-for-whom dialog, licence screen, folder, options, ready or finish page); it installs per user
  with a desktop shortcut and the add-in when Fusion is on the PC (its per-user folder or webdeploy), then opens
  the program. /TASKS= and /CURRENTUSER still work on the command line. CI opens it with no switches after
  uninstalling the test copy and fails if it waits for a click (3 min), checks the default folder, shortcut, add-in. Each release also carries ExhaustTuner-Setup.exe without
  the version, so releases/latest/download/ExhaustTuner-Setup.exe is one fixed link (the release job checks it).
  The add-in (4.13.1) runs on startup, so it is in Fusion with no Add-Ins dialog. Not fixable without buying a
  code-signing certificate: the "Windows protected your PC" screen (More info, Run anyway).
- Rust, stage 5 (2026-11-03, "continue 3d generator"): intake_cfd.py's generate_case for 3-D designs in Rust,
  rust/et_host/src/cfd_gen.rs: normalise/derive, inlet profiles (all four), Path3D, the bend surface, STL read
  (ASCII latin-1, binary, one file per role), the CAD intake orientation and plenum floor, the exhaust extrusions
  and inlet split, boundary_loop with Python's dict order, field/physics/numerics/controlDict files, both
  snappyHexMesh writers, case_info.json, generator_summary.json and design_input.json. Text templates are pulled from
  intake_cfd.py by cfd/gen_rust_templates.py (165 consts, cfd_templates.rs; --check in CI) and filled by pyfmt::pct
  (Python %-formatting). cfd/gen_rs_vs_py.py: 29 designs the same bytes (every file, executable bits, printed
  summary or DESIGN ERROR): bends with each inlet type, two out-of-plane bends + diameter change + planes, mass
  flow / engine / pressure ratio, compressible / incompressible / forced, fine + level3d + turbulence, non-ASCII and
  string-valued inputs, force_3d, the CAD STL (two levels), exhaust expansion (engine + AFR + a plane), two inlets
  (even and given split), binary per-role STLs, 8 refusals. The 2-D sector stays the page's (intake_cfd.js); an
  axisymmetric design given to the Rust generator is refused. The runner's generate step runs it in-process
  (log.generate = what the Python prints); exhaust-tuner-host --cfd-generate design.json DIR. Python is no longer
  bundled: windows.yml drops the embeddable 3.13, the installer removes engines\python on update, NOTICE drops it.
  CI: core-linux and the Windows job run gen_rs_vs_py (Windows: the program's static UCRT against Windows Python).
  Windows CI: 28 of 29 the same bytes on the first run (the static UCRT's math matches Windows Python); the 29th,
  non-ASCII names, stopped Windows Python itself (UnicodeEncodeError: it writes the headers in cp1252), so the test
  runs Python in UTF-8 mode (PYTHONUTF8=1), which is what the Rust writes; report_rs_vs_py likewise (its café
  variant: Windows Python wrote results.txt in cp1252).
- Rust, stage 4 (2026-11-02, "Port it to Rust" for the CFD Python): intake_report.py (REPORT_PY) in Rust,
  rust/et_host/src/cfd_report.rs (+ pyfmt.rs: repr, %f %e %g, json.dump indent=2 with NaN, Neumaier sum, Python
  min/max order, text-mode newlines). The program's report step and the convergence watchdog (a thread beside the
  solver, no PID polling) run it; Python is now needed only to generate a 3-D case (intake_cfd.py). Same bytes as the
  script (results.json, results.txt, printed text) on 10 real runs here and on cfd/report_rs_vs_py.py's 7 variants
  of tests/report_case (a real 2-D run, 9 planes): incompressible, exhaust with one/two inlets and a missing one, no
  planes, label/area types, no results. exhaust-tuner-host --cfd-report DIR. Next: the 3-D generator.
- Rust, stage 3 (2026-11-02, "finish the conversion to rust now"): the page's wave model in Rust, rust/et_wave
  (cdylib, wasm32-unknown-unknown; serde_json with float_roundtrip), line for line from wsFactory; pow/sin/cos/exp
  imported from the page's Math, JS min/max/round rules kept; results the same doubles (web/tests/wave_wasm.js on
  fixtures/wave_jobs.json from capture_wave_jobs.js: a single with a chamber, a four on one collector, the Tri-Y UEL
  layout, 9 designs x 12 speeds). tools/build_wave_wasm.sh embeds it as WAVE_WASM_B64 (226 KB); the sim workers run
  it (simWaveRust) and fall back to the JS per design (no WebAssembly, a CSP without wasm, a refused spec). Times:
  quick set JS 40 s vs Rust 22 s in Node; the default 4-cylinder page run 25.8 s -> 17.1 s. CI core-linux builds it
  and runs wave_wasm.js on both the fresh build and the embedded copy. Windows-only test fixes from the first real
  Windows run: paths test used Unix roots; make_palette.py wrote CRLF on Windows (now newline='\n').
- Rust, stage 1 (the owner 2026-11-02: "reprogram everything and all features in Rust"; chose "staged, slow parts first"):
  rust/et_core (std only, cdylib, C ABI v2, panics caught at every entry point and reported via et_last_error) holds
  the router's Scene queries, TubeSet, Fields, route()'s Lazy Theta* search (free_at, los, simplify), the residuals,
  Levenberg-Marquardt (+ _solve), _prune's fits, certify, fit_main_pipe's cost, and batched min_dist / nearest for
  part placement, the collector check and _mesh_gap. Ported line for line in router.py's order of operations, with
  Python's min/max tie rules (pmin/pmax) and sum() (Neumaier from 3.12; router.NEUMAIER tells the core which), so
  routes are bit-identical: test_native.py compares queries, fields, 400 free_at/los, both searches, residual
  vectors, certify, LM, prune, whole routes (block, 80 cm target, no scan, 4-primary header) and the scan fit, all
  exact (== on floats); CI runs it on Linux and on the Windows runner against the built DLL (Windows Python vs the
  DLL, both on the UCRT's sin/cos: the DLL is linked to the DLL runtime, not crt-static, for that reason).
  Two exact speedups beyond the port: any_within by coarse blocks with box pruning (same boolean; checked against
  router.py's walk on 20,000 random queries) and TubeSet.dist by 4-cell blocks nearest-first (the walk's result is
  min(cap, min over all segments), so a pruned search gives the same bits; 20,000 queries, to_bits equal).
  Timings, Python -> Rust core (this container, 2 CPUs): block route 2.4 s -> 0.05; block 80 cm 1.5 -> 0.04; shelf
  75 cm 77 -> 0.8; 4-primary header + collector 137 -> 1.0; scan fit 0.64 -> 0.020. Suites: test_router 30 -> 3 s,
  test_header 46 -> 10, test_header_uel 63 -> 10 (the rest is the tests' own brute-force checks), ls3 template
  10 -> 3. The add-in falls back to the Python (same answers) without the DLL; the route report names the core.
  Windows locks a loaded DLL until Fusion quits (ctypes never unloads it), so native.py loads a content-named copy
  from native/ beside the add-in; FusionAddIn.Install can then always overwrite et_core.dll. router.NATIVE_ABI
  refuses a native.py left loaded from another version. Also fixed in this stage (4.13.0): with a length target,
  route() stopped at the widest corridor's clear route even when it was longer than the target (the length stage
  only adds length), and whether the wide search finished in its time slice decided the corridor; now longer routes
  lead on to narrower corridors and seeds are ordered by length (under the target longest first, then over
  shortest first). NOT yet: the DLL built or run on Windows (CI billing), run inside Fusion. Next stages: the
  Windows program (Tauri) and the calculator's math (WebAssembly, if the artifact host allows it).
  Independent review of stage 1 (10 findings, all fixed 2026-11-02): (1) a trial centreline with no length has no
  samples, so _residual_fn returned a shorter vector: Python's LM indexed past it or paired wrong entries, Rust's LM
  refused (27 of 400 random routes raised in Rust); both now pad with zeros to nsamp. (2) CI could pass without the DLL
  loading: test_native --require (or REQUIRE_NATIVE=1) fails then; both CI calls use it. (3) x ** 2 goes through libm
  pow (can differ from x * x by an ulp, and between systems): Scene.build's edge and area squares are products in both.
  (4) a mesh too small to use was not passed to the core, so its tolerance was missing from e_cover there: always
  passed now. (5) native.py's private copy: makedirs race, os.replace retried (virus scanners hold new files);
  fusion_addin.rs moves a DLL Fusion holds aside (et_core.dll.N.old, cleared by the next install) instead of failing,
  and removes native/ when the bundle has no core. (6) shell counts from huge radii could overflow i64: saturating_add.
  (7) failures without a reason: every failing entry point now sets et_last_error; et_failed() tells a failure's NaN or
  0 from a real one; native.py checks every return and raises CoreError; router.core_failed then turns the core off for
  the session (NATIVE_NOTE says why), every live Scene/TubeSet drops its Rust copy (a built scene is built again in
  Python from its meshes), and route() lays a tube that failed part way out again all in Python; fit_main_pipe's cost
  carries on in Python (same sums). (8) stated Rust versions were wrong: et_core needs 1.78 (Cargo.lock v4; builds with
  1.78, checked), et_host/et_app 1.88 (locked icu 2.4 via ureq/url/idna; builds with 1.88, checked). (9) CI Python
  pinned: 3.12 on Windows, 3.11 on Linux, so both sum() paths are compared (3.11 run locally: all pass). (10) docs:
  "the same routes" holds when the Python run is not stopped by the time limit (40 s a tube by default; the 75 cm shelf
  pipe takes Python 77 s).
- Build sheet (the owner 2026-11-02: "setup recommendations with megaphone, Helmholtz resonators, X pipe etc like a build
  sheet as a calculator output, with dimensions and build list and placement and order"): Quick tab, section "Build
  sheet" (quickSheet / sheetHtml / sheetText in the page, tests/sheet_ui.js). Every part in flow order from the head
  flange with size, start position and length: primaries and merges (calcLayout segs), the collector-to-main-pipe cone
  (8° Jennings megaphone when the pipe is bigger than the collector, 15° reducer when smaller) with its sheet flat
  pattern, X/H pipe at the Crossover tab's 12 in (calcCross; X build steps from xBuildSheet), converters and O2 bungs
  (street), the drone Helmholtz can (calcHelm on a 3-12 in neck, the shortest neck that fits an 8 in x 2.5 D can)
  placed at the cruise tone's first pressure peak behind the crossover (calcPlace, closed end at the valve), or where
  the pressure is highest when no peak fits; J-pipe alternative; mufflers (parts list) and tailpipes without positions
  (no rule). New input "Exhaust length, head flange to tip": without it the can is sized but not placed. Build list
  (tube, collectors, cones, cans, necks, bungs, V-bands, hangers) and build order. Open megaphone (twice the collector
  area, 8°) offered for track/off-road. Copy build sheet button. Two-strokes list the chamber sections; rotaries none.
  Rust stage 3 (calculator math to WebAssembly) paused for this; the wave model (wsFactory, 428 lines) is the part
  worth porting (a 4-design sweep takes 7.4 s in the page here).
- Rust, stage 2 (the Windows program): rust/et_host ports app/ExhaustTuner.Core line for line (dispatcher, OpenWAM /
  Engine Simulator / OpenFOAM runners with watchdog, stop and restore, case files, palette, Fusion add-in install,
  updater with SHA-256 check, release notes, DPAPI token with the C# program's entropy so a saved token still reads)
  and HostCli as the exhaust-tuner-host binary (--info, --bridge, --install-addin, --token-sha256). rust/et_app is the
  window: wry 0.57.1 + tao 0.37.2, the page served by a custom protocol at https://app.exhaust-tuner/ (WebView2's https
  scheme), the bridge script injected before the page loads (window.ipc, same window.exhaustTunerHost API), rfd
  folder/save dialogs, WebView2Loader linked statically, the icon embedded; a self-test mode the CI install step drives
  (--selftest FILE: "ok <version> desktop=true"). Tests: 33 Rust tests (9 core, 11 updater, 13 unit) incl. the real
  OpenWAM when EXHAUST_TUNER_OPENWAM is set; web/tests/update_ui.js and desktop_ui.js drive the real page through the
  Rust host. The Windows window type-checks from Linux (x86_64-pc-windows-msvc); NOT yet built or run on Windows (CI
  billing). The installer ships ExhaustTuner.exe + exhaust-tuner-host.exe and removes the C# program's files on update.
  app/ stays as the port's reference until the owner has run the Rust program, then goes.
- Flange presets for the jig locators (2026-11-03): 51 in web/index.html FLANGE_PRESETS from published dimensions
  (docs/research/flange_dimensions.md): Vibrant 2-bolt and 3-bolt, V-bands by brand (Ace Standard and Quick Release,
  male = 4 mm pocket for the lip, female = 1.2 mm boss in the recess; Vibrant by OD as a rim pocket), Tial and Garrett
  turbo V-bands, T25/T3/T4/T6 4-stud inlets, Garrett/Vibrant bolted outlets, Tial wastegates, Wiggins (measured OD).
  Not published anywhere found: V-band lip heights and recess depths, Wiggins ferrules, 5-bolt outlet coordinates.
  Round plates now stand on legs under the rim (on the square's corners they floated: "more than one piece" in Fusion).
  Live in Fusion: Ace 3 in male and QR female, T3 inlet locators each one piece. test_fabjig checks every preset.
- Hangers tab (2026-11-03, the owner: "generate good looking exhaust and intake hangers and brackets", like Deeds,
  ProTouring/Ultimate Headers, Stainless Works, GSI): weld-on pipe tab (across the tube, coped to it, or along it as a
  fin; 1 or more adjustment holes), body-side tab (weld edge or 1-2 bolts, slots), a tab pair with the grommet between,
  a bent rod hanger with its bend sheet, and a split ring clamp (printed or machined). Outlines are circles joined by
  tangents or concave fillets (styles sculpted / clean / minimal), checked closed and simple with metal round every hole.
  Drawing to scale in inches and mm, DXF (R12, mm), SendCutSend checks and stock thicknesses, strength (net section,
  tear-out with 0.577 fy, sideways bending scan; rod bending at the weld) as load to yield and multiple of the weight it
  carries. No published hanger load factor was found, so no verdict. Data: docs/research/hangers_brackets.md (grommets:
  Stainless Works, McMaster 1061T13x, Deeds; strap isolators EPMAN, COBB, GrimmSpeed, LLRacing; Bambu filament HDT;
  yields). Fusion: "Read the tube and reach" (cylinder face clicked + optional mount pick) and "Build it" (sketch +
  symmetric extrude per plate, rod swept, grommet/bolt bodies, ring bolt holes cut), fusion-addin/hangers.py places it.
  Live: all seven parts built on a 3 in tube, each one piece; a pick toward a mount point read 108.5 mm and pointed the
  pair at it. Tests: web/tests/hang_ui.js (writes fusion-addin/tests/hang_payloads.json), tests/test_hangers.py.
- OPEN (owner decisions / later): primary-length reference point when a port length is entered (Stainless Headers is
  ambiguous); Tri-Y first section measured from the port vs the valve; Helmholtz neck end correction 0.6133 d (two
  unflanged ends) vs 0.85 d flanged; hot-gas sound speed uses air (gamma 1.4) in the empirical formulas while the wave
  simulation uses 1.35 (~2 %); desktop/Fusion load the
  page without a doctype (quirks mode; renders the same, but the artifact host is standards mode).
