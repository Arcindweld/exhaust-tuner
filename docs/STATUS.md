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
  designs generated with the bundled Python first; checkMesh aspect-ratio-only flags are a note), request
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
- OPEN (owner decisions / later): primary-length reference point when a port length is entered (Stainless Headers is
  ambiguous); Tri-Y first section measured from the port vs the valve; Helmholtz neck end correction 0.6133 d (two
  unflanged ends) vs 0.85 d flanged; hot-gas sound speed uses air (gamma 1.4) in the empirical formulas while the wave
  simulation uses 1.35 (~2 %); RS 660 length sweep rows to rerun at second-pass settings; desktop/Fusion load the
  page without a doctype (quirks mode; renders the same, but the artifact host is standards mode).
