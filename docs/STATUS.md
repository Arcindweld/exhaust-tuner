# Exhaust Tuner project — status (keep current; read after any context reset)

Standing rules: accurate, science-based, sourced; everything must actually compute (no decorative output);
do not drop features across sessions; parametric + manufacturable models; flag complex geometry / metal printing.
Target architecture (asked 2026-10-30): ONE standalone Windows app (C#/.NET + WebView2 hosting the calculator page) that bundles
OpenWAM, engine-sim fork, the CFD generator/solver and installs the Fusion add-in; only "our app + Fusion" needed. Needs a new
private GitHub repo from the owner (only Arcindweld/engine-sim is in scope now).

## Pieces and where they live (SP = this scratchpad)
- Calculator page: SP/exhaust-calculator.html (a copy of web/index.html) → artifact https://claude.ai/artifact/SkHkuxV2hTacf4KHsCDmmW
  (Version 53, 2026-11-04: web/index.html as of the crossover export; every page test passes. Version 33: + unequal-length primaries on the Headers tab (uel_patch.py, uel_ui.js; feeds OpenWAM per_cyl/segs_by_group,
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
  Router element gap: rechecked 2026-11-06 (fusion-addin/tests/test_header.py): every primary's chain has 0 gap; P2 keeps a
  0.02 degree kink and 76.202 against 76.200 in its brute-force length, inside the test's tolerances.
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
- Turbo exhaust side, step-by-step checklist, turbo build sheet (2026-11-12, branch agent7/guide; web/tests/turboguide_ui.js):
  (1) Intake tab, turbocharged, new section "Exhaust after the turbine": the back pressure at the turbine outlet at peak power
  as the sum of the page's existing losses for the parts the other tabs describe, at the gas after the turbine, each at the
  pressure at its downstream end from the tip back: Munjal's free jet 0.4 H at the tip, the Sound tab's pipe (when its
  Induction is a turbo, less the downpipe) and the downpipe by chargeSide (Darcy on drawn tube + Crane bends), the Mufflers
  tab's chamber / plug / baffled chamber with that tab's mufBackPressure items, the Cats tab's converters by catDp (new
  optional g.p for the density; blank = atmosphere as before), the cone from the turbine outlet by tsStep (Rennels diffuser
  at its least-loss angle, length shown; the turbine's swirl is not captured, said on the page). Gas: the whole exhaust per
  turbo at T4 = T3 - Wc / (me cp) (turbineBalance now returns t4: the wastegate's share mixed back in, cp at T3). No cooling
  along the pipe and all of the exhaust through the downpipe, both on the high side, said; parts past Mach 0.3 or a tenth
  of the local pressure flagged (the Cats tab's 30% and Crane's 10%). What a tab does not give in a usable form is named
  ("Not counted: ..."), not guessed. "Use my exhaust's back pressure" sets i-tobp (still editable). Worked example in the
  test header: 39301.66 Pa (5.70 psi) on the case there, every part re-derived by hand, converters too.
  (2) Downpipe block: start = the picked housing's listed outlet (taken as the mating tube's OD, less the wall: labelled) or
  a typed bore (i-tod); size by COBB Tuning's blog (cobbtuning.com/different-types-of-downpipes-explained, read this
  session): 2.5 in for 300-350 hp, 3 in for 500-600 hp; the lower end per downpipe, taken as tube OD (COBB does not say OD
  or crank/wheel), never narrower than the turbine outlet (this page's choice); above 500 hp no source size, the table of
  sizes with gas speed, Mach, downpipe + cone loss and the total is shown instead. Garrett's Turbo System Optimization,
  Turbo Tech 103, its 2021 catalogue (read in full) and BorgWarner's EFR installation guidelines give no downpipe rule.
  Wastegate dump: no re-entry distance (COBB's divorced layout has none either), drawn as a branch only. New inputs (in the
  form, saved with projects): i-dpd, i-dpl, i-dpb, i-dpw, i-tod, i-xcat, i-xmuf, i-xb, i-xn.
  (3) Drawing #ts-xsvg under the exhaust section, same style as the intake schematic: collector with the gate take-off
  window, turbine with A/R and housing, cone, downpipe with the gate branch, converters, muffler, pipe, tip, total; dual units.
  (4) "Turbo build, step by step" at the top of the Intake tab (turbo or centrifugal; shown in Simple mode): engine and
  power, airflow (Garrett), turbo, housing A/R, pipe sizes, intercooler, valves, exhaust side, scan routing (Fusion), build
  sheet; each line read from what the sections stored while drawing (TG, TS_REC, TS_PLACE, TS_X), with a mark for a problem
  the section reports (rating below target, Mach over Bell's 0.4 / a route "Needs a change", divided/undivided mismatch,
  measured pressure outside Bell's range, a housing at its published flow limit, valve or branch that does not fit, a
  typed downpipe narrower than the outlet or the rule). Horsepower is no longer an Advanced-only input.
  (5) "Save the turbo build sheet": one XHTML file (well-formed, parsed as XML in the test) through saveTextFile, for letter
  and A4: both route drawings (theme colours fixed for paper), every chosen part and size (OD / ID / wall / length / bends,
  cones with lengths, intercooler, valves with positions, downpipe, converters, muffler, pipe, tip), the key numbers and the
  assumptions and unsourced items that apply, in inches and mm, psi and kPa, °F and °C, lb/min and kg/s.
  Tests: turboguide_ui (new); turbosize_ui, turbolib_ui, turboar_ui, boostaudit_ui, charge_ui, k24_ui, sweep_ui (intake) pass
  unchanged. Not done: the gas cooling along the exhaust (the Sound tab's profile starts at its own temperature, not T4),
  the steps between the parts' different pipe sizes (said on the page when they differ), a split exhaust on the Sound tab.
- Boost audit (2026-11-12, branch agent6/audit2; docs/BOOST_AUDIT_2026-11-12.md, tools/validation/boost/, web/tests/boostaudit_ui.js):
  an independent review of the 2026-11-11/12 boosted-intake, pie-cut, cat-cone, scan-routing and K-series work, every
  function recomputed in Python from its source (python-fluids, python-ht and Cantera's gri30.yaml read from source; maker
  pages re-read) against the page through Playwright. Correct as merged: the route march (two cases to 1e-9), cones,
  Garrett's airflow/MAP (25.893 psia against Garrett's printed 26.025 on part 2's example), corrected flow, turbine
  balance (constant cp at T3 within 0.05% of a variable-cp expansion; the same GRI-Mech property set as sosExh), orifice
  flow, pie-cut geometry (two layouts, numeric intersections), catDp's Rennels cones, chargeroute parity, the K24A2 / K24Z7
  / K24W1 figures, 12 turbo and 24 intercooler rows. Fixed: cross-flow effectiveness is now the exact series (the closed
  form's inverse was up to 5% high in NTU at eps 0.77, Cr 1; pins in turbosize_ui / turbolib_ui recomputed, old and new
  values in the audit); a back-pressure-after-the-turbine input (i-tobp, blank 0) feeds the power balance and the gate;
  valve sizes are given as the lift a valve needs (curtain pi D L, Kirkpatrick) instead of "passes" on seat area; the BOV
  full-flow basis is labelled an assumption; zero gate flow is said in words; the Charge pipes section prints both units
  and, with Boosted intake, says it works at the throttle ratio without losses; scan-routing legs take the route's
  converged air and the merged cold flow of twins (it was one turbo's flow); bends longer than their run are flagged;
  GTX3076R GEN II wastegate filled from Garrett; Hooper's 45 deg mitres acknowledged; Garrett's cfm density and the
  preprint's status stated. Open: wire the exhaust tabs' back pressure into i-tobp; Bell's figures not re-read (book).
  Then the owner's "make sure to consider the turbo A/R" (web/tests/turboar_ui.js; audit doc, own section): every
  TURBO_LIB row's turbine housings structured from the maker pages (flange, A/R, outlet size, divided, gate, part number);
  the housing A/R is a build field (i-tar, i-thsg, saved with projects) shown in Turbo options, the route summary, the
  drawing and the placement rows; Garrett's own A/R definition and the GTX3076R 0.83 -> 1.01 result (one engine) replace
  a second-hand citation; housings are put in A/R order (no capacity scaled: no source for it) and tied to the build's
  turbine balance at peak and full-boost RPM; the one published housing flow (G40-1150 1.19 T4, 43 lb/min, no basis) gets
  an indicative verdict; a measured pre-turbine pressure (i-p3m) replaces the assumed multiple and moves one A/R step by
  Bell's rule; divided housings are checked against the manifold (BorgWarner). Also fixed: the gate range table threw on
  a multiple with more than four decimals (B30).
- Turbo and intercooler catalogue (2026-11-12, branch agent6/catalogue; web/tests/turbolib_ui.js, sound_ui.js): every figure
  read this session on the page in each row's src, makers' own pages only (a maker's document on a dealer's site is labelled
  so). Turbos 4 -> 22 rows, 500 to 1200 hp top ratings: Precision is at precisionturbo.com (the .net address was the dead
  end); its PT5862 page confirms 700 hp, the 58.0 mm inducer and "a 62mm CEA® turbine wheel", but not the exducer, turbine
  inducer/exducer, bearing or couplers, which stay on the dealer listing and are labelled as the dealer's; added PT5558,
  PT6062, PT6266, PT6466 (maker: hp, inducer, turbine wheel, "Ported S" cover 4.0 in / 2.5 in, housings). Garrett G25-550,
  GTX2867R/GTX3076R/GTX3582R GEN II, G35-1050, G40-1150, G42-1200 (hp ranges, wheels, housing kits; Garrett publishes no
  cover inlet/outlet sizes, so those stay null). BorgWarner EFR 6758/7163/8374/9180 (BorgWarner's undated catalogue, copy on
  Turbozentrum: hp range, inducer, wheel OD, turbine OD, housings) and AirWerks S200SX-R 58, S300SX-R 64/68 (borgwarner.com).
  Not added: S300SX-E (only a family range, 320 - 1000 HP), Xona and Turbonetics (dealer pages only). No maker prints a
  maximum compressor flow in text, so the flow column says so; its comparison is tested on a synthetic row. "Far larger":
  the maker's lower figure where one exists (Garrett, BorgWarner), else this page's rule of thumb (under half the rating,
  Precision), now said per row (data-basis) and in the caption. Intercoolers 8 -> 26: Mishimoto MMINT-UM/UR, MMUIC-W3/W4
  (the W3/W4 pages contradict themselves on size, so no size is used), CSF 8 cores (hp and size only), and EJ Bowman's
  water-cooled charge air coolers EC120 to JK190 from its brochure (G21, copy on Lancing Marine): the one maker found
  that publishes thermal performance (charge flow, outlet temperature, heat rejection, air and water drop, water flow, at
  180 °C, 1.75 bar g, water 30 °C; energy balance checks to 2-3%). Picking a Bowman cooler fills route A. Vibrant,
  Treadstone, Bell, PWR, Wagner, Frozenboost, Spearco/Turbonetics, Laminova, AFCO, Chargecooler: no maker page or data
  sheet found (caption lists them). UA against flow: Samanta, Tavva and Ranganayakulu (engrXiv preprint 5664 v2, 2025),
  Eq. 6, offset strip fins, j ∝ Re^-0.5236 for 300 <= Re <= 1500, so h ∝ m^0.4764; the page shows the charge-outlet range
  between UA held and all resistance on the charge side (bounds, not a fit; Re not checkable without fin geometry; a
  change in the other stream is not scaled). Kays & London, Incropera and Shah & Sekulic were not obtained as text;
  Manglik & Bergles (1995) was found only quoted with a garbled exponent (Chemical Engineering Transactions 71, 2018), not used.
  K-series cams: Kelford (179-A spec card), Drag Cartel and Skunk2 pages give their own cams, none the stock profile, so
  still no K row in CAM_LIB. Sound tab: the general sentence now uses the selected engine (a V8 4x, a four 2x).
- Fabrication tools and follow-ups (2026-11-12, branch agent5/fab; web/tests/piecut_ui.js): (1) Headers tab, "Pie-cut
  bend (lobster back)": tube OD, wall, CLR, bend angle, pieces (or the angle a full piece turns), how the bend ends
  (square: a half piece at each end, the usual lobster back; or every piece the same, butting square-cut tube, with the
  OD (1/cos a - 1) ellipse step stated), kerf. Out: cut angle (half the turn per weld), inside / centre-line / outside
  length of each piece (2 (R -+ r) tan a; equal pieces 2 (R cos a -+ r) tan a), radii at a piece's middle and at a
  weld, centre-line length against the mandrel arc, weld length (exact ellipse perimeter 4 a E(sin^2 a) as its
  arc-length integral), cut marks on the centre line and lines A and B for alternating cuts from one stick with kerf
  (k / cos a along the tube) and the stock length, a wrap template (height (OD/2) tan a cos theta, derived on the page),
  drawings of the bend and one piece; pressure loss against a mandrel bend only for 90 deg ending square with 1-5 welds
  (Hooper 2-K as python-fluids Hooper2K tabulates it; nothing else verified, said on the page). Geometry worked by hand
  in the test (3 in OD, 4.5 in CLR, 90 deg in 5 pieces: 11.25 deg, 30.314 / 45.471 / 60.628 mm, weld 241.740 mm,
  stock 188.360 mm with 1/16 in kerf). (2) Templates at true scale (tplDxf / tplSvg, shared): cope and pie cut get
  quarter / flank marks and 100 mm and 4 in scale bars (DXF layer MARKS, the CUT outline unchanged and first) and an
  SVG in mm (strips over 160 mm split into butted pieces), saved through saveTextFile (Fusion / desktop saveText, the
  artifact's save capability, or a download); Mufflers tab "Print 1:1 (SVG)" beside each cope DXF. (3) Header setting
  1/16 · 1/32 · 1/64 for inch fractions (inMm; mm to 0.5 at 1/16, 0.1 finer; localStorage exhaust-inch-den; default
  1/16). (4a) the Intake method note's "0.2 velocity heads per bend" now states Crane TP-410's bend K as the code uses
  it. (4b) Intake tab, advanced: turbine inlet pressure as a multiple of boost (i-tipk, default 2, Bell's 2-2.5); the
  turbine table adds a typed multiple, a range table (ts-wgk: 2, 2.25, 2.5 and yours) shows the gate share, flow and
  Cd A, and the page says the gate size is an upper-side estimate under its assumptions (area falls as the multiple
  rises: 1244 / 1218 / 1186 mm^2 on the test build). (4c) Fusion "Test this intake (CFD)": Mouth stands flange
  (default, unchanged) / free / auto sent as mount, the thin-wall warning shared with the Intake CFD panel
  (cfdThinWallNote). (5a) et_host AppPaths::without_engine_env(); the router cancel tests use it, so they pass with
  EXHAUST_TUNER_OPENWAM set, and the runner no longer unsets it for cargo test. (5b) layouts/ls3-180 bundle test
  repaired (the merge solids stubbed like the tubes, merge.plan still run and checked) and back in the runner. (5c)
  catDp: the outlet cone's uncited 0.05 is now Rennels' conical contraction with its friction (python-fluids
  contraction_conical); physaudit_ui cat cone loss 399.80 -> 468.15 Pa (outlet K 0.1835 by hand). Not run here:
  Fusion (mount choice live), a printed template on tube.
- Honda K-series, turbo options, intercooler options (2026-11-12, branch agent5/k24; web/tests/k24_ui.js, turbolib_ui.js):
  engine-only presets K20A2, K20Z3, K24A2, K24A4, K24A8, K24Z3, K24Z7, K24W1 with Honda's published bore/stroke, compression,
  ratings and redlines (hondanews/acuranews spec sheets), plus a `kd` block per engine (valve heads, exhaust side and
  manifold, VTEC, head studs, flange port, each with its own URL; K24W exhausts at the FRONT, cast into the head, per Honda
  R&D Technical Review 025-2). Stock cam events, throttle bores and stock pipe sizes: no source found, left null, so no
  CAM_LIB row for a K (the wave model then runs on the tab's default cam; K24A2 indicated 257 hp @ 6,800 against Honda's
  200 hp brake, not tuned). Headers: inline engines no longer get the V-engine "ports face" input/section, per-bank +
  Tri-Y on an inline is the 4-2-1 (was an error), split-pair wording for 1-4 / 2-3. Mufflers: "null in" fixed on part rows.
  Intake tab: Turbo options (Precision GEN2 PT5862 CEA via dealer listings, precisionturbo.net not reachable; Garrett
  G25-660, G30-770, G35-900 from Garrett) compared on hp rating only; picking one fills the compressor inlet/outlet with the
  published cover sizes. Intercooler options (Garrett air/air and air/liquid cores: hp and size only, so no capacity from
  the rating), cooling capacity from a known point (eps-NTU inversion, UA held constant, caveat on the page), water-to-air
  coolant flow, front-exchanger UA requirement, soak time, coupled loop closed form and its lumped warm-up.
- Charge piping from a scan (2026-11-11, branch agent4/scanroute; offline only, no Fusion here): Intake tab, Fusion
  section, "Charge piping from your scan". Legs filter -> compressor inlet, compressor outlet -> intercooler inlet,
  intercooler outlet -> throttle body (any subset; a start and an end marker each, selected in leg order; each leg its
  own ID, wall, clearance). fusion-addin/chargeroute.py routes each leg with router.route once per stocked centre-line
  radius for the tube OD and material (from the page's parts list, every bend sourced; the 3 nearest 1.5 D, none under
  1 D) with no bend over the largest stocked angle at that radius, plus once at twice the clearance; ranks the routes the
  router proves clear (certify on the exact triangles) by the Intake tab's 1-D loss at the tab's design flow
  (friction over the straights + Crane bendK per bend, ported with parity tested against the page), then volume, bends,
  clearance. Hot keep-outs (setHotKeepouts): a second scene whose distance counts hot_gap - gap less (UnionScene; the
  route then runs its search and fit in Python). Output: cut list from stocked bends (in and mm), couplers at each end
  (+ an optional joint in the longest straight a coupler long), smallest clearance and where, chargeRouteBuild builds
  the chosen routes with _build_route; "Use this route's lengths and bends in the Intake tab" sets i-cph / i-cpc /
  i-cpb (equivalent 90s at 1.5 D by Crane K, rounded) and i-cpah / i-cpac / i-cpr when present. Defaults: 12.7 mm
  clearance (the auto-route's), 50.8 mm hot clearance (ASSUMPTION, no source found), 76.2 mm couplers (HPS HTSC-300-BLK,
  Vibrant 2714 on the parts list). router.py: repair() takes seed_min_straight (default min_straight, so other modes are
  unchanged); chargeroute passes 0, as a lattice path with a long minimum straight could otherwise lose every corner.
  The browser page and the Windows program cannot read a mesh: the tab says scan routing runs in the add-in.
  Tests: test_chargeroute.py, test_chargeroute_fusion_fake.py, web/tests/chargeroute_ui.js; NOT RUN live:
  fusion-addin/tests/fusion_live_chargeroute.py (for the owner's PC).
- Turbo inlet, charge pipe, turbo, intercooler and valve design (2026-11-11; Intake tab, boosted; web/tests/turbosize_ui.js):
  the request "add turbo intake and charge piping design and sizing", plus the owner's later additions (turbo and
  intercooler sizing; wastegate and blow-off valve location per design). New sections: "Inlet and charge pipes: design
  and sizing" (route filter -> inlet tube -> compressor -> hot pipe -> intercooler -> cold pipe -> throttle per turbo,
  every section at its own density and temperature, the throttle-to-compressor march iterated on the outlet temperature;
  the compressor's real ratio (throttle + losses after) / (atmosphere - inlet loss) and its outlet temperature with and
  without the inlet loss; size changes as Rennels cones at the least-loss angle against sudden steps (Borda-Carnot /
  Rennels sharp contraction); size tables over 1.75-5 in OD tube with Garrett speed, actual speed, Mach, loss, volume,
  fill, a recommended size (smallest <= 300 ft/s by Garrett's method and <= Mach 0.4, inlet tube >= compressor inlet) and
  "Use these sizes"; a dimensioned schematic in inches and mm), "Turbo and intercooler sizing" (demand at peak power and
  the full-boost RPM, corrected flow to 85 °F / 13.95 psia per ATP, Garrett's HP x A/F x BSFC / 60 and required MAP,
  compressor power, turbine power balance swept over turbine efficiency 55-75% since no typical value was sourced,
  turbine flow parameter, wastegate share at Bell's 2 and 2.5 x boost), "Intercooler sizing" (heat to remove, density
  gain, cross-flow both-unmixed NTU and UA when the outside-air flow is typed, core drop scaled with flow squared from
  a typed rating) and "Where to put them on this build" (blow-off valve side and distance from the throttle or the
  compressor outlet, kept on the final straight and behind a blow-through MAF; recirculation window on the inlet tube;
  wastegate take-off window on the collector for a 45° branch, valve size from the effective area by isentropic
  orifice flow; drawn on the schematic). New inputs: i-cpd2 i-cid i-cod i-ici i-ico i-cpr i-cpah i-cpac i-cpstep i-cpy
  i-lorpm i-afr i-bsfc i-tit i-teff i-icam i-icrdp i-icrf i-mafpos i-bovside i-bovd i-cpst i-wgtype i-mani i-wgcl
  (all inside the tab's form, so projects save them). calcCharge takes optional cold ID, bend radius, angle lists and a
  twin merge; with them blank its results are unchanged (charge_ui, physaudit_ui pass). Sources verified online this
  session: Garrett Turbo System Optimization and How to Size Charge Air Tubing, Garrett Turbo Tech 103 and "How to select
  a turbo, part 2", ATP Turbo definitions, Garrett VNT gasoline paper (950 °C), python-fluids fittings (Rennels),
  python-ht effectiveness_from_NTU, Turbosmart GenV wastegate instructions, Marelli et al. SAE 2019-01-0324 (abstract
  page text). Not re-checked online: Heywood appendix C (orifice flow), Bell's page numbers (already cited in the page).
  Left out, no source found: filter loss, a Y-junction loss, a wastegate or blow-off valve discharge coefficient (the page
  gives Cd x A), a typical turbine efficiency, surge/choke margins, inducer/exducer sizing, a turbo model table, a
  charge-air core UA, air-to-water cores, a dump-tube re-entry distance; "gate after the last merge / one per scroll" is
  labelled common practice on the page.
- Fabrication audit (2026-11-11; docs/FAB_AUDIT_2026-11-11.md): every cut, bend, print and template output recomputed
  from geometry (marched cylinders, a centreline rebuilt from the bend table, sampled solids). Fixed: F1 the page's cope
  template is worked from the branch's inside edge (a square-to-wall cut from the outside line left the inside edge
  9 mm into the main pipe on two 2 in tubes); F2 jig.py cradle and saddle tops now stop at the lowest centreline point
  under the block's whole footprint (on slopes the downhill end stood up to 6 mm above it, so a 1 in tube at 55 deg
  would not lift out); F3 the two-stroke build sheet gets a flat blank per cone (it pointed at a layout that does not
  exist). Statements added: cope wrap, scale, seam, margin and square-branch scope; cut-list rounding, 0.1 deg clocking,
  feed-direction right-hand rule; X-pipe build lengths to 0.01 in / 0.1 mm. Bend table round trip, tee cope depth,
  merge plates and flat patterns, X-pipe mitres, muffler wraps (round and oval), cone blanks and hanger tabs all OK.
  Open: Q6-Q11 in the doc; a printed template and a steep jig to try in the shop; jig, merge and hanger solids in Fusion.
- Wave model cross-validation (2026-11-11; docs/WAVE_VALIDATION_2026-11-11.md, tools/validation/wave/): known answers
  (Sod within 0.09 %, closed/open pipe modes within 0.05 %, second-order dissipation, isentropic cone flow -0.5 %, choked
  flow -0.007 %, Borda-Carnot exact, friction and Reynolds-analogy heat as stated; 105 rows) and OpenWAM on 8
  configurations x 6 speeds (single cylinder 0.4/0.8/1.2 m and with a chamber, i4 4-1, V8 per-bank 4-1, with lines, with
  an X; no 2-stroke: the wave model has none). Three boundary defects fixed (JS + Rust, WebAssembly rebuilt,
  wave_wasm.js bit-identical, web/tests/wavekat_ui.js guards them): the open end (a -100 Pa dip came back 8 times
  larger, steady inflow flipped every step), diameter steps (a contraction gained 83 kPa of stagnation pressure; now
  isentropic contraction / Borda-Carnot expansion as OpenWAM), closed ends and valve ends (a closed pipe's standing wave
  grew 8 % in 40 periods; now the characteristic end pressure). Engine VE moved by -4.1 % to +3.4 %. Against OpenWAM:
  VE peak speed the same on all 8, VE correlation 0.93-1.00, VE 2.5-5.4 % higher (explained: pipe friction and
  wall-heat laws; with both off 1.002), net IMEP 22-28 % higher (about half from constant gamma 1.35; rest open),
  single-cylinder tail orders within 1.2-1.4 dB median; V8-with-line firing orders about 7 dB median (open). Default
  cells converged for VE to 0.3 % (1.6 % at one point); not changed. All wave/sound page tests pass.
- Whole test suite in one command and in CI (2026-11-11): tools/run_all_tests.py runs, from a clean Linux checkout,
  the Rust builds the tests need, cargo test for every crate under rust/, every web/tests/*.js (index.html for the ones
  that take the page path), every fusion-addin/tests/test_*.py (test_native on the built core with --require, the
  router once more on it), and the parity checks (cfd/*_vs_py, openwam/test_*.js, sound/test_*.py, layouts/*/test_*.py,
  the generator's templates, the embedded OpenWAM writer), all found by globbing; per-test time limit, results table
  as text/JSON/Markdown, exit 1 on any failure. Skips are counted with their reason ("TEST SKIPPED: <why>" for a test,
  "SKIP: <why>" for a part, web/tests/skip.js) and checked against tests/expected_skips.txt, so a test that stops
  running fails the run; tests/flaky.txt (empty) for the one retry. New workflow .github/workflows/tests.yml (Linux, on
  push to main/windows-app and on pull requests): builds once (with OpenWAM for Linux from the commit windows.yml
  uses), Rust tests, three shards balanced on tools/test_timings.json, one merged table in the job summary; it does not
  touch the Windows build or releases. First full local run (one at a time, 2 shared cores): 135 tests, 46 min, all
  pass after the fixes below; skips: wamlevel_ui and dualexit_ui (git-ignored F-100 OpenWAM run), parts of rec_ui and
  uel_ui (git-ignored runs), desktop_ui's OpenFOAM part. Found by it: autocfd_ui failed under load on "a newer design
  stops the running test first" (the "Stopping" status lasts only until the stand-in's cancel rejects, 150 ms, and the
  test polled every 200 ms): it now logs every status as it is shown and holds the stopped run until the status is
  read, so it waits on conditions; rust/et_host/tests/core.rs's router cancel tests fail when EXHAUST_TUNER_OPENWAM is
  set (paths.rs reads it before the test's sleeping stand-in; the runner runs them without it and the real-solver test
  separately; the test itself still to be fixed); layouts/ls3-180/fake/test_bundle_mode.py is stale (its Fusion stub
  has no TemporaryBRepManager), listed as not run in the runner until the stub is extended. web/tests/run_all_tests.sh
  now runs the runner's web suite. README "Running the tests".
- CFD generator gaps closed (2026-11-11; generator 1.1.0, unchanged version: existing designs write byte-identical
  cases; cfd/NOTES.md §2, 4 (i)-(k), 5; add-in 4.21.0). (A) `mount: free` in 3-D: the tube's outside and lip face are
  a wall patch (inlet_wall) back to a plenum wall at x = protrusion, the protruding wall refined to 2.5 cells across
  its thinnest point; no mouth ledge (0 plenum/inlet_wall faces inside the bore in every case), `cache { grad(U); }`
  kept. Validated on the 50 mm straight tube (Re 1e5, medium, K from 10-22 D as entrance3d.py, handbook basis
  K_total + alpha - 1): t/D 0.02 sharp 3-D 0.639, 2-D 0.629, Idelchik (diag. 3-1 via python-fluids, l/D 0.5) 0.72;
  t/D 0.05 0.482 / 0.443 / 0.50; r/D 0.04 lip standing free 0.280 / 0.289 (with at least 2 cells across a rounded lip's radius, now a
  generator rule: at 1.3 cells it read 0.423). (B)
  `diameter_change` as an ordered list (each cone from the previous bore; one dict = one-item list, same bytes);
  K at each plane on its own bore, listed as plane_bore_mm when there are several. (C) a cone may overlap a bend in
  3-D: 92.6 -> 105 mm over a 60 deg bend on 127 mm clr meshes checkMesh OK (139,692 cells, non-orth 64.5, layers 94 %,
  wall area -0.13 %); not solved. (D) `inlet: {type: profile, points_mm}` (2-D and 3-D): the 80 mm ellipse given as 21 measured points reads K 0.0042 against the ellipse's 0.0040 (2-D, medium; tract-end loss +0.06 %). (E) the Fusion
  reader sends several cones as the list, a cone into a bend, a measured profile when no fitted mouth is within
  0.15 mm (or 5 % of the flare), and takes mount flange (default) / free / auto. (F) the Intake tab's CFD panel: a 3-D
  case keeps the panel's mount (free cut back to the first bend, or flange when the bend is too close, with a note).
  The owner's CAI (92.61 mm, 880.62 mm, 4.76 mm wall, bends 29.5 deg at 100 mm and 84.1 deg at 572.08 mm, 127 mm clr,
  0.3694 kg/s, 25 C, simpleFoam, medium; tract-end total-pressure loss): flange plain 1,062.8 Pa (4.267 inH2O; the
  reference 1,063), free plain 1,208.0 Pa (4.850 inH2O), free with the 3.5 mm lip 683.2 Pa (2.743 inH2O; flange lip
  679), flange plain + 60 mm cone 92.61 -> 105 mm 1,079.9 Pa (4.335 inH2O) at the tract end, 1,053.0 Pa at the tube
  end. Parity: gen_rs_vs_py all passed (new designs: free mounts, cone lists, cones on bends, profiles, refusals),
  cfd_js_vs_py 254 files identical; the WIP's generated cfd/tests/cad_tract_mm.stl is untracked and git-ignored.
  Not done: the ESI build was not run; the cone-on-bend case was meshed only; a free-standing mouth with a bend inside
  the protrusion is refused (the outside is modelled straight).
- Physics audit follow-up (2026-11-11; docs/PHYSICS_AUDIT_2026-11-11.md, "Follow-up"): the conductor's decisions on
  the questionable items. Q1: exhaust acoustics use burned-gas c (sosExh: stoichiometric CH1.87 products, NASA/GRI-Mech
  polynomials, R 286.6, gamma 1.37-1.30), 1-4 % below the old air c; intake, ambient, Blair and the Jennings default stay
  air. Q2: Boom tab "Tube finish" (commercial steel default kept, no sourced value for welded tube). Q3/Q10: Rennels'
  conical diffuser/contraction for the boom flare and transition and the catalyst inlet cone (K 0.05 and the 8-30 deg
  blend gone). Q4: charge-pipe bends via bendK (14 f at r/D 1.5), arcs off the straights (D4 example 9,238.6 -> 9,072.5
  Pa). Q8: ovaling in plane strain, E/(1 - nu^2) (Leissa SP-288). Q9: baffled chain has N - 1 holes, TL of the lumped
  chain between the pipes. Tests: physaudit_ui (new values), baffles_ui, uel_ui expectations moved; full suite run.
- Physics audit of the closed-form results (2026-11-11; docs/PHYSICS_AUDIT_2026-11-11.md): 57 formulas on the Headers,
  4-Stroke, 2-Stroke, Mufflers, Sound, Crossover, Boom, Cats and boost/heat sections checked for units, basis, double
  counting, validity and source, each with an independent worked example (tests/physaudit_ui.js, hook window.__physAudit).
  FIXED: (D1) plug-muffler back pressure took the chamber area ratio where Munjal's eq. 8.7 wants the perforate's open area
  over the pipe's (4.5 H against 2.8 H, +61 %); (D2) baffled-chamber back pressure charged the holes the pipe's dynamic head,
  not the hole's (2.6 against 4.5 kPa on 50 mm holes at Mach 0.10), with a note past 10 % of the pressure (Crane TP-410);
  (D3) the Sound tab's J-pipe kept the flat 0.3 d end correction the Mufflers tab had replaced with Ji 2005 (1 mm);
  (D4) charge pipes used commercial-steel roughness for the aluminium/stainless tube the tab specifies (pipe friction +29 %),
  now drawn tube 0.0015 mm; (D5) the Stone-chart agreement text overstated the fit. No existing expectation changed.
  FOR DECISION (unchanged): air's gamma and R for exhaust-gas sound speed (c 1.3-1.8 % high); boom-tube roughness and
  no diffuser loss below 8 deg; charge-pipe bend K 0.2 uncited; Munjal et al. 2013 cross-flow correlations give ~9.7 H
  where the 1987 rule gives 2.8 H; long-tube ovaling without 1/(1 - nu^2) (4-8 % low); others in the audit file.
- Intake CFD from Fusion reads real intakes (2026-11-11, add-in 4.19.0; offline only, no Fusion here): the owner's
  CAI ends in a 60 mm (2.36 in) cone from the 92.61 mm (3.646 in) tube to a 105 mm (4.134 in) throttle body and was
  refused. The bore is now probed from the centreline (tubecfd.probe_bore: 8 rays per station out to the first solid,
  so only the bore counts; beads, hose barbs and filter cuffs on the outside never refuse), with the path run on
  straight 3 D past both ends so a cone, cuff or bellmouth joined on past the Pipe path is found, and read against
  what cfd/intake_cfd.py models (tubecfd.analyse_bore). The generator takes ONE diameter_change (normalise, a single
  dict; tube_radius: a straight cone, growing or shrinking, its length from the half-angle, 0-60 deg), in 2-D after
  the inlet piece and before the tract end (tract_stations), in 3-D not overlapping a bend (build_param_3d_surface);
  its mouths are plain, radius, ellipse (exit = tube bore) and taper (lip >= 0.2 mm). Accepted: the cone to the
  throttle bore (tract end half a tube bore past the throttle face, as the page's cfdDesign puts it, with planes_mm
  tube_end and throttle_face so the loss at the end of the constant tube and at the throttle face come back too); a
  reducer mid-run (planes reducer_in / reducer_out); a lip (torus face exact, or fitted), an elliptical bellmouth or a
  straight flare with a lip (fitted; the nearest model, with its largest difference stated, when none is close).
  Approximated, said with the size: an S-shaped reducer as the straight cone of the same length and end diameters, a
  sudden step up as a 60 deg cone, a step under 0.5 mm as one bore, a square flare rim as 0.2 mm. Refused in one
  sentence: two diameter changes, a cone in a bend, a bore that narrows and opens again, a step down over 60 deg, a
  mouth narrower than the tube or unlike any model, an oval bore. "Use this tube in the Intake tab" also fills i-tb
  (the cone's large end, CFD cone on), i-mouth (Elliptical bellmouth for a bellmouth or flare) and i-lipr; the tab's
  own case then ends its cone at the same throttle face. The panel lists the extra planes. Tests:
  tests/test_tubecfd.py (the owner's tube + the cone past its Pipe path; a mid-run reducer straight and S-shaped; an
  elliptical bellmouth and a 10 deg flare; a 3.5 mm lip probed and from its torus; beads, barbs, cuff; refusals; each
  accepted design generated by `python3 cfd/intake_cfd.py design.json out`, case only, and its centreline and bore
  checked against the generator's Path3D, inlet_profile and tube_radius: the owner's cone within 0.003 mm / 0.0002 mm),
  tests/test_intakecfd_fusion_fake.py (the same through act_cfd_tube), web/tests/fxcfd_ui.js (new fixture
  fxcfd_tube_cone.json). Not run live: tests/fusion_live_intakecfd.py now builds a revolved tube with a lip arc and a
  cone past its centreline line, and the 3-D CAI with a cone joined on (section 5; ET_RUN_CFD_CONE=1 runs it). The
  probe costs ~6,800 point containments for the plain 880 mm tube, ~12,600 with bends and the cone (the old reader's
  loops come to at most ~4,000; counted here, not timed in Fusion): the live run reports probes and read_s.
  Generator gaps worth closing (cfd/intake_cfd.py and its ports; not touched here): diameter_change as a list (a
  reducer and a throttle cone), a cone on a bend (build_param_3d_surface's rad(s) already varies along s; only the
  overlap check stops it), a measured mouth profile (inlet type 'profile' with (x, r) points instead of fitting
  ellipse/taper), a step (cone over 60 deg, a counterbored cuff), a named reference plane in place of the
  half-bore extension.
- Stop per request (2026-11-10): the bridge's Stop was global (router.rs and MessageRouter.cs flagged every request in
  flight, hostrun.py stopped every job), so the automatic intake CFD superseding an older run, or any Stop button, also
  ended an OpenWAM run started on another tab. Now window.exhaustTunerHost.call() returns a promise with .id and
  .cancel() (that request only), cancel(id) stops one request and cancel() with no id still stops all; the bridge says
  cancelsById. The page sends {id: 0, action: 'cancel', data: {id}}; router.rs and MessageRouter.cs stop only that
  request (an id not running stops nothing else; a stop that arrives before its request, each message being handled on
  its own thread, is kept 2 s and applied when it starts). Fusion: hostrun.host_cancel({id}) stops that job only,
  hostInfo says cancelsById, and the page's Fusion bridge (FHOST) gives its promises .cancel() only then. Page:
  hostRun(kind, ...) / hostStop(kind) next to hostCall; the CFD Stop stops the intake CFD runs (button and automatic),
  the supersede only the automatic run, the 4-Stroke and 2-Stroke OpenWAM Stops and the exhaust CFD Stop only their own.
  Older programs and add-ins (call() without .cancel()): the page falls back to the global HOST.cancel(), as before.
  Tests: rust/et_host/tests/core.rs router_cancel_* (by id, without id, unknown id, a stop before its request),
  fusion-addin/tests/test_hostrun.py (by id, unknown id, all), web/tests/cancelid_ui.js (the real host_bridge.js over a
  stand-in channel, then an old-style bridge), web/tests/fusionhost_ui.js (two runs at once in the Fusion panel, each
  Stop ends its own). The C# MessageRouter.cs / HostBridge.js got the same change but could not be compiled here (no
  .NET SDK); only a live run on Windows and in Fusion can confirm the real WebView2 / palette channels.
- Automatic intake CFD and tube finish (2026-11-10). (A) Windows program, Intake tab, CFD section: "Test automatically"
  (on by default, remembered per viewer in localStorage; absent without the program's bridge). When the design the case
  is built from changes (window.__cfd.design(): geometry, operating point, air temperature, mesh level, as a stable hash)
  and the inputs are idle 4 s, the page runs the case through cfdRun (runOpenFOAM, the same path as the button); a run
  for an older design is stopped first with HOST.cancel() (the program's Stop, which stops every running request, an
  OpenWAM run on another tab included); one waiting run at most. Results per design in memory plus the last 10
  summaries in localStorage (exhaust-autocfd-v1): a design already tested shows its result with no rerun. Status line:
  "Testing this intake… (meshing / solving, N% of the iteration cap / reading the results)", then the tract-end total
  pressure loss in inH2O, kPa and Pa against the tab's smooth-tube "as a CFD reads it" figure (x flow factor squared)
  with a verdict (within 10% agree, 25% roughly, else check the details); failures (design not meshable, mesh step
  failed, OpenFOAM not installed, Stop) are one sentence and that design is not retried; OpenFOAM missing stands the
  automatic test down until reload. The run messages and results table sit under a collapsed Details. The Run button
  goes through the same queue; no host change. tests/autocfd_ui.js (stubbed bridge). NOT yet run in the real program.
  (B) "Tube finish" select: smooth 0.0015 mm (default, numbers unchanged); 3D printed as printed, 0.2 mm layers
  0.099 mm and 0.3 mm layers 0.136 mm; sand/bead blasted 0.015 mm; wet sanded to 600+ grit 0.0042 mm; commercial
  steel 0.045 mm. Printed rows = measured Ra (Kocisko et al., Materials 18 (2025) 4672, PLA) x 5.863 (Adams, Grant and
  Watson, IJMEM 1 (2012) 008), a rule checked on metal pipes, not layer lines: good to about a factor of 2 (Botros's
  Rq rule gives a half to two thirds). No friction test of a printed tube at intake Reynolds numbers was found (Harmon
  et al. 2026 saw no change at Re 6,300 only); coated/primed prints left out (no measured Ra found). The owner's CAI as
  printed at 0.2 mm: f 0.0209 against 0.0147, +224 Pa (0.9 inH2O); the bends take the same f. The "as a CFD reads it"
  row stays smooth-walled (the CFD case is). tests/intakefinish_ui.js.
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
  code signing (the workflow signs with signtool once the owner adds the CODESIGN_PFX_BASE64 + _PASSWORD secrets, INSTALL.md; the certificate is theirs to buy): cut list from stock mandrel bends under every routed tube (tests/cut_ui.js); tack jig
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
  Heat and isolation (the owner: "the best high temp vibration isolation method... as well as looking good"): the tab
  or rod as a fin from the pipe (k from Cleveland-Cliffs / Elgin / AA, Churchill-Chu vertical plate, radiation out and
  in from the pipe with view factor (1 - cos b)/2), checked against the textbook cosh fin within 0.004 °C. Isolators by
  continuous rating (lowest source): PU 82, NR 70, EPDM 121, FKM 205, silicone 232 (260 for the 500 °F-rated
  grommets), stainless wire rope 260 (Enidine WR), knitted stainless mesh 300 (Vibratec; VTCI 600); the reach each
  needs for 15 °C margin; best = silicone grommet where it fits, else wire rope, else mesh. Wire-rope picks (WR2/WR3)
  with bounce frequency and the share of idle shake passed (Sound tab engine, else the MEIC 22-28 Hz idle band).
  Design cues: rounded-triangle aerospace window; dimple-die flanged holes (McMaster 3423N61 / SWAG and Eastwood
  21316 sizes, thickness by material), placed biggest first down the web so long parts get a graduated row.
  Data: docs/research/hanger_isolation_lightening.md (de Havilland DS 11 is proprietary-marked: cited, not copied).
- Sound tab "Compare a recording" (2026-11-03, the owner: "refine the sound until I have more real world data"): WAV read
  as recorded (8/16/24/32-bit PCM, float, extensible; else the browser decodes at 48 kHz), Hann 0.5 s frames 0.1 s apart,
  RPM from rpm_track.py's harmonic comb joined over time by Viterbi (15 dB per unit log ratio, at most 1.6x per frame;
  bikes blip fast), holds within 4% for 1.5 s, order levels as order_spectrum.py (Welch, ±0.15 order) with a noise
  check per order, AGC and clipping checks, half/double correction buttons, a sweep's firing-order level against
  frequency with its resonance peaks and the sound-speed scale (gas temperature) that fits the model's modes, and order
  by order against OpenWAM's outflow spectrum when INS.DAT is loaded on the 4-Stroke tab (now to order 12; the page's
  INS orders already carry the monopole's d/dt, the first draft added it twice). Checked: synthetic WAV comes back at
  its speed and levels within 0.5 dB; the Outback and RS 660 recordings give the Python tools' holds and order levels
  within 0.3-0.6 dB RMS (idle 1.6 dB, the idle's half order sits in 2 Hz); Outback hold_1980 vs its OpenWAM run 8.7 dB
  RMS over 14 orders above the noise (Python 10.5 over 2-12). web/tests/rec_ui.js. Note for later refinement: the
  recording's odd orders 1, 3, 5 are 13-31 dB above the tailpipe model (intake and engine-structure noise reach the
  microphone, cylinder-to-cylinder spread), and the model is 20 dB too bright at order 12 (cat as a plain pipe,
  muffler as a plain volume; a capillary-substrate cat adds only about 2 dB at 400 Hz by the narrow-tube estimate).
- Save the estimated sound (2026-11-06): "Save the last sound (WAV)" writes what was last played as 16-bit 48 kHz mono (wavPcm16): a download, the artifact viewer's downloads, or saveBase64 in the add-in (act_save_base64) and the desktop host (dispatcher saveBase64). tests/wsndwav_ui.js. Add-in 4.15.1.
- No-load sound estimate (2026-11-06): the Sound tab's Load choice "No load (a free-rev hold in the driveway)" holds
  the intake mouth at a manifold pressure (runSpeed opts.pIn; validation/outback-2004's fixed-pressure plenum) found so
  the net IMEP meets FMEP = 0.5 + 0.012 rpm/60 bar (the page's OpenWAM default law): two runs and secant steps per
  speed (wsndSpeedRun, shared by the worker and the page fallback). Default engine: 21-22 kPa at 2,000-3,000 RPM (the
  OpenWAM Outback calibration gave 24 kPa at 1,980), flow out 10-18% of full throttle, 6 dB quieter
  (tests/wsndload_ui.js). The recording comparison asks for a no-load run when the model was at full throttle.
  rust/et_wave does not carry opts.pIn or e.dead (the sound estimate runs the JavaScript solver; the 4-Stroke tab's
  wasm runs use neither, so parity holds).
- No-load wave estimate on the Outback (validation/outback-2004/wave_noload.js -> wave_noload.json, 2026-11-06): the
  page's solver on the OpenWAM spec (tail as segments, the Spintech case as a 7.24 L straight volume) finds the manifold
  at 22.9 / 22.1 / 23.4 / 24.9 kPa at 1,980 / 2,585 / 2,955 / 3,550 RPM, against OpenWAM's calibrated 24 kPa: the
  no-load method agrees. Order levels 2-12 against the recording, offset out: wave 12.4 / 14.6 / 13.2 / 13.3 dB RMS (13.4 / 15.9 / 13.7 / 13.2 before the choked-inflow fix),
  OpenWAM 10.5 / 10.3 / 12.3 / 9.8. Both models put the half orders (2.5, 3.5, 4.5) 10-20 dB above the recording, which
  has strong whole orders: the placeholder unequal-length manifold lengths, not the method, are the first suspect;
  the owner's measured EJ251 manifold (primaries, secondaries, cross-pipe) is what would settle it.
- Test this intake (CFD) from Fusion (2026-11-10, add-in 4.18.0; offline only, Fusion and Windows not on this machine):
  Intake tab, Fusion section: select the intake tube, click "Test this intake (CFD)", the tract-end total-pressure
  drop comes back in the panel (inH2O, Pa, kPa), with K, the tab's own 1-D tube-only figure for the same tube, the
  airflow, cells and run time; every dimension in inches and mm; a second click on an unchanged tube answers from the
  cache (page memory, and Documents/Exhaust Tuner/cfd-cache keyed by sha256 of the design + the program build).
  "Use this tube in the Intake tab" fills length, bore, bend angles (from the mouth), bend radius (mean, said so, when
  they differ), mouth and the CFD panel's bend starts. Chain: page fxCfdTest -> fusionCall cfdTube ->
  cadtools.act_cfd_tube (the print-split helpers _ps_chain/_ps_find_path/_ps_radii; the centreline sampled, trimmed to
  the body by bisection, the bore probed all along at 12 angles; Selection.point picks the mouth end, or "the other
  end") -> tubecfd.py (pure: lines/arcs, joins, plane_deg, refusals) -> the page puts the Intake tab's operating point
  on it (cfdDesign with the tube in place of the tab's), writes the case with IntakeCFD.generateCase (2-D straight /
  3-D bundle) -> FHOST hostCall runOpenFOAM -> hostrun -> foamrun.py, which starts the installed program's
  exhaust-tuner-host.exe and speaks its stdin/stdout JSON-line protocol (the program generates, meshes, solves with
  the watchdog and reports; Stop = its "cancel" line, then a tree kill after 20 s). The installed program carries no
  Python (installer [InstallDelete] engines\python; generator and report are in Rust), so nothing Python runs outside
  Fusion. plane_deg: the bend direction measured in the generator's carried (rotation-minimising) frame, which starts
  as n1 = +y at the mouth and turns with each arc; positive from n1 toward n2 = t x n1; bend 1 is 0. Proved by
  rebuilding with the generator's own build_param_3d_surface path: the owner's CAI (29.50 deg at 100.0 mm, 84.10 deg
  at 572.1 mm, 880.6 mm, bend 2 at 139.25 deg) within 0.0024 mm / 0.0003 deg, 185 random 3-D tubes within 0.017 mm.
  Also in Fusion: the Intake CFD panel's own "Run in OpenFOAM on this PC" now runs there through the same path.
  Tests: fusion-addin/tests/test_tubecfd.py (+ `python3 cfd/intake_cfd.py design.json out` accepts 3-D, straight 2-D
  and lip designs; generation only), test_intakecfd_fusion_fake.py, test_foamrun.py (stand-in host), web
  tests/fxcfd_ui.js; all pass, as do the other add-in tests and the psplit/intake/cfd/intakecfdbend page tests. NOT
  yet run: Fusion (tests/fusion_live_intakecfd.py; ET_RUN_CFD=1 also runs the coarse 3-D case) and the real host.
- Intake 1-D pressure loss, term by term against the CAI CFD (2026-11-10): the tab read ~30% high (5.8 / 4.1 inH2O
  plain / 3.5 mm lip against the CFD's 4.2-4.4 / 2.8). Same inputs as the CFD (376 cu in, 6,600 RPM, VE 92%, 25 C,
  369 g/s, 92.61 mm bore, 880.6 mm, 30 + 84 deg on 127 mm): velocity 46.3 m/s, q 1,268 Pa (CFD 1,260-1,300), Re 2.76e5,
  Mach 0.13, so flow, density and velocity were right. The tab's total has no filter and no throttle term (friction,
  bends, inlet only), so the comparison was already tube against tube. Pa:

  | term | before | after | why |
  |---|---|---|---|
  | friction | 218 (f 0.0181, 880.6 mm) | 126 (f 0.0147, 627.9 mm) | page-wide steel roughness 0.045 mm -> drawn tubing 0.0015 mm (Crane A-23, Moody); bend arcs (66 + 186 mm) were counted twice, Crane's bend K already holds them |
  | bends | 501 (K 0.127 + 0.268) | 407 (K 0.103 + 0.218) | same Crane x Idelchik A1, with the smooth tube's f; cross-checks 0.31 Rennels, 0.29 Idelchik B1 0.21 (R/D)^-0.5 |
  | inlet, plain | 740 (K 0.583, Blair Cd 0.567) | 634 (K 0.50) | flush square edge: Crane, Idelchik 3-1, Blevins 0.5 (Rennels 0.57); Blair's plain pipe is not a flush mouth |
  | inlet, 3.5 mm lip | 310 (K 0.244) | 310 | Crane r/D 0.038, unchanged (Swamee 0.29, Rennels 0.33: Crane is the lowest handbook value) |
  | total, plain / lip (25 C) | 1,458 / 1,029 (5.9 / 4.1 inH2O; 5.8 / 4.1 at the default 30 C) | 1,167 / 843 (4.7 / 3.4) | handbook basis: static less one head, flow re-developed |
  | tube only at the tract end (CFD basis) | not shown | 1,093 / 769 (4.4 / 3.1) | less (alpha - 1) q = 74 Pa, alpha 1.058 of a developed 1/7-power profile: the CFD's mass-weighted total pressure still holds it |
  | CFD | 1,050-1,106 / 700-709 | | +1.4% / +9.2% of the band middles |

  New row "Tube only at the tract end, as a CFD reads it"; the loss line says no filter or throttle is in it and how long
  the straights are (mm and in). Not applied, no verified source to hand: Miller's interaction factor for two bends 4.4 D
  apart, Miller's outlet-tangent correction (the 84 deg bend ends 1.3 D before the tract end; it would lower the CFD-basis
  figure further), any effect of the 30 deg bend sitting 1.1 D after a sharp mouth, a printed tube's roughness (taken as
  drawn tubing). The lip case's remaining +9% sits with Crane's rounded-entrance K (the 3-D CFD reads 0.19 at r/D 0.04 on
  a straight tube, total-pressure basis) and the missing outlet correction. tests/intake1dcal_ui.js (within 12% of each
  CFD band middle), tests/intakebend_ui.js (4.6 / 3.3 inH2O at the default 30 C).
- Split for printing audited offline (2026-11-10, add-in 4.17.0): Fusion still offline, so act_print_split was checked
  against the Fusion API reference and its glue put under tests. Fixed: SurfaceEvaluator.parametricRange returns a bare
  BoundingBox2D, so the old `ok, rng =` unpack threw inside a try and every keep-out was silently dropped (cuts could
  land in the lettering); the selected-body test used `is` on API wrappers (always false: "curves do not run inside this
  tube"); embossed lettering adds a coaxial cylinder outside the tube, which the old radius pick took for the outside;
  the outer tongue was a Join extrude, which participantBodies does not limit (cut/intersect only), so it would fuse the
  receiver whose shoulder its tip touches: now a new body combined into the grower; the extrude side now from the
  sketch's own x/y axes; the cut plane uses setByPath (setByDistanceOnPath retired September 2026), is checked and
  re-placed from the other end if the path runs backwards; pieces re-found after every feature and checked distinct;
  chamfer edges by curveType (circles and split arcs); a refused chamfer is a note, a failure part way leaves a
  "Print split (incomplete)" group and says where; a moved occurrence is refused; messages in mm and inches.
  printsplit.py: the reach prune used arc length (a U bend that fits spun 45 degrees was refused outright), now the
  chord; clear notes for no straight, straights too short for the lap, keep-outs over every straight, a tube wider than
  the bed; a wall whose tongues would be under 0.8 mm (0.031 in, two 0.4 mm perimeters) is refused, under 1.2 mm
  (0.047 in) warned; gluing check list (piece order, which end carries which tongue, bond area cm2/in2, bond-line mL:
  0.92 mL a joint on the owner's 4 in tube). tests/test_printsplit_edges.py (planner edge cases, beds 180 cubed,
  350 x 320 x 325, 256 cubed, 256 x 180 x 300), tests/test_printsplit_fusion_fake.py (the _ps_* helpers against an
  adsk stand-in). tests/fusion_live_printsplit.py fixed: Pipe via the add-in's _pipe (diameter check), sketch curves
  joined by SketchPoints, probes kept off the cut planes, wall continuity, volume loss with the chamfers, STL on the
  bed. Still only a live run can confirm the Fusion features themselves (see the audit report in the commit).
- Regression sweep of the page (2026-11-10): all 90 web/tests/*.js run one at a time: 79 pass, 6 skip (need OpenWAM or
  the built host), 5 failed. Stale tests fixed: dyno_ui and opt_ui looked for "needs the desktop program" (the wording
  is "needs the Exhaust Tuner program or the Fusion panel" since 2026-11-05); rec_ui's save check wanted the Outback
  hold, which is only the last recording loaded when the git-ignored OpenWAM run is present (else the RS 660's);
  mic_ui waited a fixed 0.5 s for getUserMedia (flaky on a loaded machine; it now waits for the microphone). Left for
  decision: wave_wasm (rust/et_wave's open-end inflow has no choke at the critical pressure, the JS got it 2026-11-06;
  the single-with-chamber design at 7150 rpm differs in the 5th digit, so the 4-Stroke tab's WebAssembly runs and the
  JS solver no longer agree to the last digit). New tests/sweep_ui.js (every tab: defaults in both units, unit round
  trips, tiny/huge engine with 1/16 cylinders at low/high RPM, every select option, custom engine at 1/16 cylinders,
  boost 0/40 psi, optional fields blank and zero; no page/console error, NaN, Infinity, undefined, negative length,
  lone empty cell, or length in one unit only in a results table or drawing label; 400 px: no sideways scroll, every
  control on screen and usable). Fixed from it: the Intake tab threw on "Custom firing order" (engineFrom read the
  order/gaps/bank fields the Intake tab does not have); table cells and drawing labels showed lengths in one unit only
  (clen and cdim now give "28.4 in (721 mm)", the profile and crossover scale bars both units, the 2-Stroke length
  table, the Headers temperature rows and GM clearance rules, the Helmholtz can sizes, the hanger stock list and the
  motorcycle silencer names); b5_ui, jpipe_ui, spiral_ui and uel_ui read the new two-unit text. Light and dark themes:
  no text under 3:1 contrast on any tab (expert mode); every download button builds its file (.mr, OpenWAM, OpenFOAM
  intake and exhaust zips, cope and chamber DXFs, hanger DXF) without an error.
- CFD validation round (2026-11-11, conda-forge build here, one core, 20 solver runs; cfd/NOTES.md 4(f)-(h)).
  (A) The uncached-grad(U) defect also hit exhaust-component mode: the 90 deg R/D 1.5 bend reads K 0.47634 without
  the cache and 0.44839 with it, against 0.44838 from ESI's package on the byte-identical mesh (92,883 cells), so the
  6% build difference was this defect. Exhaust cases now write cache { grad(U); } too (Python, Rust, page JS; parity
  all passed / 172 files identical). Not affected: the 2-D cyclic sector (laminar pipe 1.0078 x Hagen-Poiseuille with
  and without the cache, as on ESI's builds; the generator's 2-D case made laminar: same static drop to 3e-5);
  2-D and 3-D intake cases byte-identical to before. No 2-D exhaust cases exist. (B) 3-D rounded entrance, straight
  50 mm tube, Re 1e5 (cfd/validation/entrance3d.py, entrance3d_results.json), on the handbooks' basis
  K_total + (alpha - 1): sharp 0.392 (Crane/Idelchik 0.50), r/D 0.02 0.308 (0.28/0.37), 0.04 0.262 (0.24/0.26), 0.06 0.184
  (0.15/0.20), 0.10 0.141 (0.09/0.12), 0.15 0.114 (0.04/0.07); total-pressure K 0.339, 0.252, 0.202, 0.119, 0.074, 0.046
  (2-D: sharp 0.396, 0.04 0.141, 0.10 0.013). Crane's lip K is not the outlier at the owner's r/D 0.038 (CFD 0.267 vs
  0.244); the CFD's sharp edge is 0.11 low on both handbooks. (C) The owner's CAI bend by bend (real layout, plane
  139.246, cai_bends_results.json): plain 1,063 Pa, 3.5 mm lip 679 Pa (tab 1,093 / 769: +2.8% / +13%). The lip's gap
  is bend 2, ending 1.3 D before the tract end: +0.078 in K behind the lip against the tab's +0.187 (profile alpha
  1.13-1.15 still to mix out). The plain cut's agreement is a cancellation: bend 1, 1.08 D behind the sharp mouth,
  costs +0.278 against +0.090, the CFD's sharp entry is 0.07 low and the two bends interact by -0.117. Miller's
  outlet-tangent factor (only as digitised in the fluids library, C_o 0.64 for bend 2) would give lip -2% but plain
  -7%; not applied (unverified against the book, and the gap depends on the inlet). 1-D model unchanged.
- 3-D intake pipe friction fixed (2026-11-10): the 3-D cases read developed friction 22-25% above Colebrook. Not the
  mesh or wall functions (y+ 45-51, wall shear within 5% of Colebrook as in 2-D): the conda-forge Linux build's
  turbulence library evaluates the explicit stress term -div(nuEff dev2(T(grad U))) wrongly when grad(U) is a
  temporary, a body force of ~20% of the wall stress (laminar pipe on the same mesh 1.247x Hagen-Poiseuille, 1.003x
  without the term). Fix: 3-D intake cases write cache { grad(U); } in fvSolution (Python, Rust, page JS; no numerics
  change). Straight 50 mm tube, Re 1e5, medium: f 0.0220 -> 0.0177 (Colebrook 0.0180, -1.7%); entrance K r/D 0.04
  0.194 -> 0.202, sharp 0.329 -> 0.340; rhoSimpleFoam the same (f 0.0221 -> 0.0178); no floor faces in the bore;
  same 183,554 cells, ~900 iterations, 11-18 min on one shared core. Exhaust-component mode unchanged (its 6% bend difference between builds fits the same defect;
  not proven). cfd/NOTES.md 4(c4).
- Plug muffler back pressure (2026-11-11, conductor's review of the physics audit): measured cross-flow losses of
  Munjal, Vijayasree and Chaitanya 2013 (3.136 OAR^-1.391 out + 2.208 OAR^-1.5818 back in, OAR = open area / pipe
  area, clamped to the measured 0.31-1.66 with a note) in place of the 1987 2-2.5 H rule: the audit's example reads
  9.75 H, 15.6 kPa at Mach 0.15 (7.2 kPa before the audit with the wrong ratio; 4.5 kPa with the old rule and the
  right one). tests/physaudit_ui.js.
- Round parts come out round (2026-11-11, add-in 4.19.0; offline only, Fusion not on this machine): the owner's printed
  reducer was out of round in the taper. Cause found in the add-in: every STL it wrote used setQuality(High) alone,
  which the API reference defines as tolerance = bounding-box diameter / 2^13, ~0.04 mm on a 300 mm long 100 mm tube =
  79 facets round 100 mm (62 round 95 mm on a 500 mm box; the CFD export's 0.05 mm gave 71). Now (fusion-addin/
  roundcheck.py, new, pure): every add-in STL is meshed to 0.01 mm chord error (surfaceTolerance 0.001 cm; print
  pieces also maxNormalDeviation 2 pi / n for the tube's OD: 158 facets round 100 mm; cap 3M triangles, then 0.02 mm)
  and measured on what was written: slices square to the axis (found: principal moments, then the line through the
  section circle centres, roundest candidate) or to the centreline (print pieces, bends), best-fit circle per loop
  (outer and bore), deviation, out-of-roundness, facet count and chord error; round = dev <= 0.05 mm and chord
  <= 0.02 mm (under Cura's default Maximum Deviation 0.025 mm). Failing pieces say "Do not print" and the panel note
  turns to a warning. Boom tube pieces between two round sections are revolved (the loft kept for flat ovals and as
  the fallback); every other taper (megaphones, cones, merge collectors, chambers) was already revolved or an exact
  cone primitive. The page writes no printable mesh (its DXFs use true ARC/CIRCLE entities). Tests: test_roundcheck.py
  (straight, cone, quintic, bent pass; 3-lobe 0.2 mm cone reads 0.205-0.208 mm deviation, 24-facet cone 0.380 mm chord
  error, both fail), test_roundcheck_fusion_fake.py; all fusion-addin tests pass. NOT yet run in Fusion: needs a live
  print split and CFD export to confirm Fusion's mesher honours the tolerance (the check will say if not) and a boom
  tube with a round-to-round piece to confirm the revolve. CLI: python3 fusion-addin/roundcheck.py part.stl.
- First live runs on the owner's PC (2026-11-11, Fusion 2706.1.17, program 0.1.67, add-in 4.18.0 put there by script):
  print split PASSES (fusion_live_printsplit.py: 3 pieces, no overlap, bore and outside flush, volume lost 1.929 cm3 =
  expected, STLs fit and sit on the bed) after one fix: a Pipe's path can only be read with the timeline rolled to before
  the feature ("Didn't roll editing feature back"); the roll clears the selection, so it is put back and the owner's real
  click is kept for "the other end". Intake CFD from Fusion PASSES its read checks (flat and 3-D tubes, both ends,
  plane_deg 139.246, program found and answering, OpenFOAM present; the test's 3-D tube is now one 3-D sketch) and a
  coarse run through foamrun finished in 164 s (27,519 cells, rhoSimpleFoam, 908 iterations). Its number is NOT valid
  yet: the installed 0.1.67 still writes slipFeatureAngle 30 and no grad(U) cache, so the square mouth read 3,561 Pa
  (K 2.68) against 1,043 here with both fixes. Needs the next installer on the PC, then the same run again.
  DONE with program 0.1.203 (same tube, medium mesh, started from Fusion's Python through foamrun): 131,430 cells,
  rhoSimpleFoam, 905 iterations, 743 s; 1,085 Pa (4.35 inH2O), K 0.84, against 1,043 Pa here (simpleFoam, bend 2 at 90
  deg where the PC's is at the CAD's 139) and the tab's 1,093.
- The owner's CAI re-run here with the friction fix (medium, CAD layout, simpleFoam): plain 1,043 Pa (1,050 before the
  fix), 3.5 mm lip 660 Pa. The tab's "as a CFD reads it" figure: 1,093 (+5%) and 769 (+16%).
- Intake CFD case takes the tab's bends (2026-11-10): the case the Intake tab writes now uses the tab's bend angles
  (listed from the mouth end), its centre-line radius and its rolled-lip radius (it placed every bend as 90 degrees at
  its own radius); the CFD panel can still override the radius and can say where each bend starts (mm from the mouth;
  blank spreads them evenly; bad lists fall back with a note); radii under 0.6 D are raised to 0.6 D with a note.
  tests/intakecfdbend_ui.js. Run on the owner's LS3 CAI (6,600 RPM, medium mesh): the parametric 3-D case with a
  3.5 mm lip gives 709 Pa total loss at the tract end against 700 for the CFD of the CAD STL (2.8 inH2O both).
  FOUND AND FIXED: every 3-D intake case (parametric or CAD STL) read a sharp flush mouth as re-entrant. The tract-wall
  boundary layers slid along the plenum floor (slipFeatureAngle 30), and their end faces in the mouth plane became floor
  (wall) faces: a ledge one layer stack deep (7-8% of R) inside the mouth. A straight 50 mm tube read K 1.00-1.03
  (medium, fine and STL alike) against 0.40 in 2-D and 0.5 in Crane; the jet contracted to 0.53 (Borda). Rounded lips
  were unaffected. Fix: slipFeatureAngle 100 in the intake 3-D snappyHexMeshDict (Python and Rust generators, the
  page's embedded copy; parity tests pass): sharp K 0.33, r/D 0.04 K 0.19 (unchanged), 0 floor faces in the bore,
  99.7% layer coverage. cfd/NOTES.md 4(c3). The owner's CAI, plain end, after the fix: 1,106 Pa (4.4 inH2O) from the
  CAD STL (was 1,177) and 1,050 Pa (4.2) from the parametric case laid out as the CAD (30 deg at 100 mm, 84 deg at
  572 mm, no cone), 5% apart; the 3.5 mm lip 700-709 Pa (2.8). The 1-D tab (5.8 and 4.1 inH2O) runs about 30% high
  against these. The 3-D medium mesh's pipe friction ~25% above Colebrook was not the mesh (fixed the same day, see
  the entry above); the CAI figures above were run before that fix, so their friction share reads high.
- Intake bends and lip radius (2026-11-09): Intake tab takes each bend's angle ("84, 30") and the centre-line radius,
  and a rolled lip's radius. Bend K = Crane TP-410's 90 degree bend (multiples of f against r/D: 20, 14, 12, 12, 14, 17,
  24, 30 at 1 to 10 D) x Idelchik's angle factor A1 (replaces the fixed 0.2 per bend); lip K from Crane's rounded
  entrance against r/D (0.5, 0.28, 0.24, 0.15, 0.09, 0.04 at 0 to 0.15). On the owner's LS3 CAI at 6,600 RPM the 1-D
  total is 5.8 inH2O plain and 4.1 with a 3.5 mm lip, against the CFD's 4.7 and 2.8 (medium mesh): the 1-D runs ~20%
  high (its dynamic pressure ~9% above the CFD's, Blair's plain-cut Cd 0.567 a little lossier than CFD's flush square
  edge), and the lip's gain matches (K down 0.34 in 1-D, 0.38 in CFD). tests/intakebend_ui.js.
- Split for printing (2026-11-07, add-in 4.16.0): Fusion panel button "Split the selected tube for printing" (Intake,
  Headers, Muffler, Parts, Boom tabs) with printer presets (Bambu, Prusa, Creality, Voron, custom), lap length, epoxy
  gap and material. fusion-addin/printsplit.py plans (pure Python, tests/test_printsplit.py: the owner's 4 in CAI
  splits into 5 pieces on a 256 mm bed in ~5 s, cuts in straights clear of the lettering, every piece standing on an
  end with no outer tongue); cadtools.act_print_split finds the Pipe path (or selected curves), the bore and OD from the
  straight's cylinders, keep-outs from any face that is not plain wall, then builds planes, split bodies, flush lap
  joints (inner tongue to r_mid - gap/2, outer from r_mid + gap/2, 45 degree shoulder/tip chamfers), a "Print split"
  timeline group, clash check, and upright STLs to Documents/Exhaust Tuner/prints/<design>. Done by hand on the owner's
  intake first (Fusion + Bambu Studio slice: 500 m / 1.52 kg PLA-equivalent, ~40 h). Live test written
  (tests/fusion_live_printsplit.py), not yet run: Fusion was not connected. web/tests/psplit_ui.js.
- More printing filaments (2026-11-06): Intake tab, 3D printed (FDM): 31 more rows from the makers' own TDS, read by a research pass
  and transcribed with their sources: Siraya Tech Fibreheart (PPA-CF Core, PPA-CF, PPA, PPA-GF, PET-CF, PET-GF, ABS-CF, ABS-CF Core,
  ABS-GF, ASA-GF, PETG-CF Pro), Polymaker Fiberon (PA6-GF25, PA12-CF10, PA612-CF15, PET-CF17, PET-GF15, PETG-rCF08, ASA-CF08,
  PPS-CF10, PPS-GF20; PA6-CF20's print settings and density corrected from its V1.1 sheet), SUNLU (PA12-CF, PA6-CF, PA6-GF, ABS-GF,
  PETG-CF, PC, ASA), 3DXTech (CarbonX HTN+CF, ThermaX PPS), Raise3D (PPA CF, PPS CF), QIDI (PAHT-CF, PAHT-GF, UltraPA-CF25, UltraPA,
  PPS-CF10). Annealed figures where the sheet gives them. Gaps filled by stated rules and starred (PRINT_MORE comment: Z = 30% of XY,
  nylon HDT1.8 73.5 C, amorphous HDT1.8 = HDT0.45 - 8); tmax, boost, locations and X1C fit derived the same way for every added row
  (printDerive). The material list is grouped by maker. tests/printmats_ui.js.
- Stationary road-noise test (California 95 dB(A)) added and then removed 2026-11-06 at the owner's request (the
  builds are off-road vehicles). Kept from it:
  a solver fix: a run continued from a state left at another intake-mouth pressure (the no-load secant's
  0.30 -> 0.55 atm step) sent a compression into a shut intake valve that broke the scheme (NaN state, empty record);
  runSpeed now moves the mouth pressure to the new value over the first cycle (st.pMouth), wsndSpeedRun redoes a broken
  run from a cold start, and open-end inflow is held at the critical pressure (choked) instead of past it.
- Recording misfire check (2026-11-06): recMisfire flags a hold whose orders below the firing order are 10 dB or more
  over the healthy model at two or more orders (each 6 dB above the noise) and points to Hear a misfire; also names a
  leak before the collector or more unequal headers as causes (tests/recmis_ui.js).
- Record from the microphone (2026-11-05): the Sound tab's "Compare with a recording" can take a take straight from a mic (getUserMedia with echo cancelling, noise suppression and AGC off; 48 kHz ScriptProcessor; written to a float WAV, wavFloat, and read by recLoad), so no file is saved and loaded. tests/mic_ui.js (Chromium's fake mic; WAV round trip; refused mic).
- OpenWAM inside the Fusion panel (2026-11-05, add-in 4.15.0; the owner asked for one clean program with no files to
  carry between programs): fusion-addin/hostrun.py runs the page's OpenWAM cases on the PC the way et_host does
  (each model in its own folder, finished only on OpenWAM's marker, INS.DAT cut to 4 cycles, CRLF inputs, half the
  cores at once, Stop kills the solver). The page's FHOST (HOST_INFO.where 'fusion') talks to it through
  fusionSendData: hostCall answers at once, progress and the end come back as hostEvent / hostDone panel messages
  (cadtools posts them from a custom event on Fusion's main thread), the result is fetched in 400 kB pieces
  (hostChunk). Every run button gated on hostHas('openwam') now works in Fusion; where OpenWAM is not found the panel
  offers "Find OpenWAM.exe" (settings.json). OpenWAM search: EXHAUST_TUNER_OPENWAM, engines/openwam/OpenWAM.exe in the
  add-in folder, the program's copy (Program Files or LocalAppData\Programs), Desktop / Downloads / Documents up to
  three folders down. With a host the AVG/INS pickers fold under "Load files from a run done elsewhere". Tests:
  fusion-addin/tests/test_hostrun.py (stand-in solver), web/tests/fusionhost_ui.js (the page, hostrun.py through a
  stand-in bridge, the real OpenWAM build: 5 models, results and Sound tab orders). Releases now also carry the
  patched OpenWAM as OpenWAM-win-x64.exe for the add-in folder (v0.1.187 is the first; its copy, sha256 a0521446..., is in
  the owner's AddIns\ExhaustTuner\engines\openwam with the GPL text). Not yet run live in Fusion (its MCP was down).
- Hear a misfire (2026-11-05): the Sound tab's estimate can run the design with cylinder 1 (index 0) or collector A's cylinders not burning (engine e.dead, cylinder indices; runSpeed sets burnQ 0, the cylinder still pumps) beside the healthy one as A/B. Checked (tests/wsndmis_ui.js): torque drops by one cylinder's share (24 to 26% of 4 simulated; 54% for a dead V8 bank), mean flow out within 3%, and the half orders rise from 80 and 14 dB below the firing order to 10 and 1 dB below. Prompted by Maisteer's V12, whose bad sound was a dead bank.
- Headers tab clocking (2026-11-05): each n-into-1 collector (not a Tri-Y) lists its tubes in firing order for builders who clock them round the collector (#h-clock; tests/clocking_ui.js). The note says no test of it is known and the wave model cannot show it. Shop videos added to Sources as checks (back pressure 0.4 to 18 psi, megaphone angles, 4A-GE 4-2-1 vs 4-1, turbo bend test, explainers).
- Live in Fusion 2026-11-05 (the owner's PC, add-in 4.14.1 installed): fusion_live_chambers.py all ok (the inline
  chamber with extended tubes, the same with two baffles, the flat-oval reverse-flow case: every body's volume within
  0.2 % of its section by Pappus, the tubes and baffles clear of each other, the reverse case's holes cut through
  the plate, the reported gas exact) and fusion_live_drone_parts.py all ok again. The run found the baffles reaching
  0.5 mm into the shell wall and the reported gas not taking them off; both fixed in 4.14.1 (templates.ext_chamber).
- Live in Fusion 2026-11-03 (the owner's PC, add-in files from today): fusion_live_drone_parts.py all ok (can, path,
  route on the Rust core, tilt, scan, hole: every tool cuts), fusion_live_cfd_stl.py ok (196 triangles, inlet/outlet/wall).
- Merge collectors and Y merges as one welded part (2026-11-04, task 95, "fully featured"): fusion-addin/merge.py
  plans in plain Python, cadtools _merge_collector builds it at every merge (header, Tri-Y Ys and collector, 180-degree
  bundle): a 3/4 in slip sleeve (ID = the bundle envelope), a merge plate inside it with one BORE-size hole per tube end
  (OD holes would touch at points: neither cuttable nor weldable; bore holes leave two walls between holes, one to the
  rim), plate from 1/8, 3/16 or 1/4 in stock (thinnest >= 1.5 x tube wall), the cone to the outlet OD, and a centre
  spike when the void is >= 0.15 OD (n >= 4) whose length keeps the open area from growing (Ls >= r_b^2/(R0|R'|), x1.15,
  at least 3 r_b; capped at 0.9 of the cone). Spikes 1.5 in across or wider are hollow rolled cones, smaller ones solid
  (turned bar). Features: shell + spike revolved from one half section, plate extruded, joined, one lump; else a fixed
  body (TBM); tube ends off one ring -> the old plain cone with a note. The cone's included angle is reported against
  Burns Stainless (15 deg recommended, 7 to 18 deg best). Each merge is listed as a part with its weight, and the
  answer carries cut files (DXF R12 mm, CUT layer): the plate on its own; the cone, the sleeve and a rolled spike as
  flat patterns at mid-wall in the tube gauge. Page: "Cut files" save buttons on any Fusion answer (saveTextFile shared
  with the Hangers tab). Tests: fusion-addin/tests/test_merge.py (plan, area rule, ligaments, DXF read back, writes
  web/tests/fixtures/merge_route.json), test_drone_fusion_mock.py merge_glue + triy checks (stand-in now has extrudes,
  circles, real profile counts), web/tests/merge_files_ui.js. LIVE in Fusion 2026-11-04 (the owner's PC, add-in 4.13.1 files from this tree):
  4-into-1 as features: one body, one lump, volume = the plan's to 2e-14; the same as a fixed body: one lump, 1e-15;
  2-into-1 Y merge as features: one lump, 2e-13 (its 2.4 in test cone is 33.7 deg included, and the note says so). Honest limit: a flat plate is a step (open area 1.5-2.4 x the bores at the plate); a formed (pie-cut)
  merge is smoother but needs press tooling.
- OpenWAM 4-stroke line: parallel paths (2026-11-04, task 105): make_wam.py / wam_export.js tail element
  {"parallel": [[segs], [segs], ...]} (two or more paths between two TCCRamificacion junctions, each path its own
  segments and Tw; must follow and be followed by a pipe segment); page copy synced (tools/sync_wam_export.py);
  test_py_js.js 120 cases identical (bundle, auger + muffler, side branch then parallel, V8 pair, 4 errors, 6 random).
  RUN on OpenWAM (i4_41, 30 cycles, scratchpad par/run_hq.py): an equal-area Herschel-Quincke pair (two 40 mm tubes,
  300 and 1500 mm) against one 56.6 mm pipe: finished, no warnings, NMEP unchanged (13.38 bar at 3000 rpm); outflow
  d(mdot)/dt order 4 (200 Hz) -40.3 dB at 3000 rpm and order 3 (210 Hz) -25.5 dB at 4200 rpm, against the predicted
  notch c/(2 dL) = 210 / 222 Hz (outlet gas 658 / 733 K). The third-harmonic notch (630-666 Hz) shows only 4 dB at the
  nearest orders. Page: "In line on the pipe" on the line after the collector: the Mufflers tab's auger (centre tube +
  spiral as a round pipe of the channel's area; capped = spiral alone) or timbre tube bundle, at a distance from the
  collector; wamline_ui.js. Limits: no junction end allowance, no swirl or spiral friction beyond the pipe's own.
- Reed lift stop in OpenWAM (2026-11-04, task 104): openwam/patches/0001-reed-lift-stop.patch (TLamina model 2 =
  model 1 plus a lift stop in m; held at the stop, no rebound; the old 1e5 m cap is now FLevMax, unchanged for the
  other models). CI applies openwam/patches/*.patch before the MinGW build (cache key includes their hash); the local
  build in ext/OpenWAM is patched and rebuilt. Writers: intake.reed.model "1d_stop" (make_wam2t.py, wam2t_export.js,
  page synced; test_py_js_2t.js 57 of 60 identical, the other 3 refused by both). 2-Stroke tab: "Petal mass and
  spring, with a lift stop" (two_wam_ui.js). Checked on the Maico 490 (30 cycles): a 15 mm stop gives model 1's
  numbers exactly (31.0 hp at 6500, 27.6 at 8000), 6 mm the same, 4 mm 30.0 / 20.1 hp (8000 not settled: NMEP spread
  37 %), 2 mm 28.8 / 26.1 hp: the model's free petal opens between 4 and 6 mm. A stock OpenWAM 2.2 rejects model 2.
- Published V8 header comparisons (task 89, docs/research/v8_header_comparisons.md): back-to-back long-tube tests
  differ 0.5-2 % on peak figures (LSX Mag LS3, Engine Masters 400 SBC primaries), the same order as the model's
  layout spread (within 3 %); no published numbers put 180-degree or 8-4-1 headers against per-bank 4-1s.
- Measured lift profiles (2026-11-04, the last open part of upgrades 6-10): make_wam v9 / wam_export.js
  spec.e.camProfile.in / .ex {deg from the lobe centreline (crank), mm at the valve, [cl]}: the valve opens and closes
  where the profile leaves and returns to the seat (whole degrees, outward), its peak lift sets the CD table, the
  table is the profile linearly resampled at the lift step. A sin^2 profile sampled every degree reproduces the
  built-in curve byte for byte (only the comment differs); OpenWAM runs it (i4_41 6000 rpm). test_py_js.js 132
  cases. Page: 4-Stroke "Run it in OpenWAM", "Measured lift profiles": paste or a file, crank or cam degrees, valve
  or lobe lift x rocker ratio, page units; kept in projects (WAM_UI); wamline_ui.js.
- Muffler designer (2026-11-04, task 106 with the recording fit done earlier): Mufflers tab "Muffler designer": the
  smallest packed straight-through (calcAbsorb, 80/100/130 kg/m3, 10/20 % core) or plain chamber (calcChamber) that
  takes at least N dB off a band (9 frequencies, even in ratio; default the tab's target -20 % / +25 %), 3.5-10 in
  across and 4-36 in long inside the space limits, leaving out any whose band passes its first cross mode; "Use" puts
  the design into the tab's fields; an impossible goal gives the closest. tests/mdesign_ui.js (the tab's own packed-can
  figure at the target matches the designer's).
- Outback brightness diagnosed (2026-11-04, docs/research/outback_tilt.md): recording minus model tilts -4 to -10 dB
  per octave at every hold (orders 2-12); the RS 660 with the same synthesis shows none (-0.5..+1.8 at idle), so it is
  the Outback's hardware after the engine (the owner's Spintech 3331 modelled as an empty box, the cat as plain pipe),
  not the method. A -7.2 dB/octave tilt fitted leave-one-out lowers every hold's RMS (10.8 -> 9.5 dB overall). The
  Spintech's inside is unpublished (US 5,824,972 layout only). Page: Compare a recording reports the tilt and the RMS
  without it (rec_ui.js).
  The Spintech's traps, modelled from the owner's cutaway as three Helmholtz volumes (slot or vents) between end spaces,
  make it worse, not better (RMS 12.3 / 12.6 dB against the empty box's 10.5 at 1980 rpm); the loss is most likely
  friction at the slots, which a lossless model leaves out. The empty box stays.
- F-100 302 validation (2026-11-04, validation/f100-302): a built 302 with long tubes, a 2.5 in X-pipe and chambered
  mufflers against roadside pass-bys, the first case with a crossover (make_wam v10, Python and page). The recording is
  order 4 on top, then 8 and 12, with everything else at the floor. A chambered muffler layout matches best (4.7-7.0 dB
  RMS with both sides clipped at -25 dB); a 0-D 6.5 L box makes order 1 the loudest, which the recording rules out.
  Still open: the model's integer orders 1-3 and 5-7 sit at -8..-15 dB against <= -18 in the recording, from an
  18-26 % NMEP spread across cylinders (scavenging by bank with a 315 deg cam), which the model probably overstates.
  Header and pipe lengths are placeholders. With the X 250-400 mm behind the collectors (not 1000) the spread falls to
  7.6 % and the low orders to the recording's level (clipped RMS 3.8-6.2 dB); what is left is orders 8 and 12, 5-20 dB
  weak in the model.
- Merge cut files reviewed independently (2026-11-04, a separate agent with its own scripts): no defects; plate,
  section, spike area rule, hollow spike, volume (within 0.03 % of a numerical integration), flat patterns rolled
  back up, DXF entities all check. Its four minor points fixed: the sleeve bore now clears the bundle by 0.4 mm on the
  diameter (SLEEVE_FIT_CM; the plate is 0.15 mm under that), $ACADVER AC1009 in the DXF header and _mm in the file
  names, the ligament between holes measured from the actual hole centres and overlapping tubes refused, and the
  spike note says which rule cut it.
- Sound realism, step 1 (2026-11-04, the owner: "make the sound example as close as possible to real life"):
  sound/realism.py turns OpenWAM's one cycle into a running engine: each firing's pulse x (1 + spread + cov N(0,1))
  in smooth windows that add to one, and each cycle stretched to an engine-speed track (rpm_walk, or the
  recording's own); measured as order_spectrum.py plus the quarter-order floor. On the Outback 1980 rpm hold the
  recording's floor between orders is -41/-42 dB (orders 2-6/6-12); the model held exactly -50/-63, with the hold's
  own speed track (1.2 % sd) and 2-4 % cov -46..-42/-41..-40: speed wander and normal combustion variation account for
  the space between the orders. Odd integer orders 3 and 5 (13-17 dB short) do not move with cov: not combustion
  variation. sound/test_realism.py. Page: Compare a recording, "Listen: the recording against the model" (play the
  hold, the model, or one then the other; cycle-to-cycle variation %, wander as recorded or held; "Compare the gaps
  between the orders" runs the tab's own analysis on the model's sound); rec_ui.js (held exactly with no variation
  the played model has OpenWAM's order levels to 0.01 dB at the recording's loudness).
- Munjal elements on the Mufflers tab (2026-11-04, from the owner's copy of Acoustics of Ducts and Mufflers, 1987):
  expansion chamber with extended inlet and outlet tubes (2.13-2.14, 3.7: the pocket behind each tube a closed
  quarter-wave shunt of area S2 - S1; the double-tuned L/2 and L/4 set by a button; with both at 0 the plain-chamber
  curve to 1e-6 dB), the reverse-flow end chamber (reversal elements back to back; hard cut at c/4L, pass at c/2L,
  back pressure 1 H + 0.5 H) and the plug (cross-flow) muffler (3.8.1, the packed can's coupled equations with eqs
  3.120/3.122 boundary conditions and Sullivan's cross-flow perforate impedance 3.153). exttube_ui.js, plug_ui.js.
- Drive and book reading pass (2026-11-04, four reader agents over the Drive folder and the extracted books; reports in
  the session scratchpad, findings folded in): the pipe's Mach number at the muffler now computed from the Sound tab's
  engine (Liu, Hao and Liu 2012 measured 0.13-0.30, the old hint said 0.05-0.15); a flat-oval pipe's plane-wave limit
  c/2W (Joseph, ISVR); Inconel 625 in the pipe materials and a 304 sensitisation-window note (427-866 C); the elliptical
  bell's Cd against pressure ratio (Blair and Cahoon fit via the Perth College thesis, lip radius corrected to 0.06 of
  the entry); Engelman's k shown as the 2.0-2.5 band; Vizard's runner bore as a check on a four; rotary EGT by load;
  baffle-hole back-pressure ratios from the KTM 390 study.
- F-100 length fit (2026-11-05, validation/f100-302/model/fit.py, writers v13/v14): one step each way from X 400 /
  exit 600 / primary 762 mm at 5,800 rpm. X flat 250-400, worse past 550; exit 600 beats 300 and 900; primaries best at
  860-960 mm (-0.5 to -0.6 dB on a 0.9 dB spread, base 4.82 dB clipped RMS) and 2.6 dB worse at 1060: the recording pins
  the primary length to about 33-39 in. Table in the case README. The four pull speeds rerun with 900 mm primaries: every hold
  0.8-1.0 dB better, the pass-by 6.1 -> 5.8 dB; orders 8 and 12 remain the gap.
- Pass-by in the page and jet directivity (2026-11-05): Compare a recording has "Drive the model past" (speed and
  microphone distance; Doppler by emission-to-arrival time, 1/r from the hold's level at the closest point, the tip's
  jet with a jet's directivity, Morse and Ingard 11.4); sound/sweep.py passby() takes the jet apart the same way
  (pull(split=True)); rec_ui.js checks the Doppler ratio and the level law. The muffler designer also searches Munjal's
  double-tuned extended-tube chamber. Page V56.
- F-100 muffler inside (2026-11-05, from the owner's photos into Black Widow mufflers: a square channel straight through
  the oval case to an end plate with the outlet, the case a separate volume through a small hole): modelled as a 79 mm
  round channel the recording is too bright (orders 8/12 at -5/-10 against -14/-22), as closed chambers too dull
  (-17/-28); the case as one small-hole Helmholtz barely dulls it; as three big openings it swallows order 4. The real
  one is a sealed channel plus losses the plane-wave model lacks. Table in the case README. Needs: the channel's
  inside width and its openings measured.
- Installed attenuation and the chamber builder (2026-11-05): the Mufflers chart has a second mode, Davies' attenuation
  with the real tailpipe and the open end's reflection worked back from the tip (every element now carries a [p; v]
  transfer matrix; bare tailpipe 0 dB, half-wave chamber transparent, the tail-length average of a chamber's installed
  cut returns its TL to 0.3 dB: installed_ui.js); the designer can score that way too. Fusion add-in 4.14.0 builds the
  expansion chamber with extended tubes (templates.ext_chamber, act_chamber; mock-tested, live test pending the PC).
  Page V58.
- Chamber to metal (2026-11-05): the Mufflers tab writes cut files for its chamber (shell wrap, end plates, baffles as
  R12 DXF; tube list; a flat-oval case of the same inside area at a given height; reverse-flow plate with both tubes),
  mufcut_ui.js; the OpenWAM line can carry the Mufflers tab's chamber in 1-D (open chamber at its bore, extended-tube
  pockets as quarter-wave branches of the annulus area) instead of a 0-D volume, wamchamber_ui.js. Quick tab rounds
  mid-band primaries down to the stock size unless the larger is within 3 % (Sanderson). Two-stroke header length in
  diameters against Jennings. Page V59.
- Roadside level and quiet target (2026-11-05): the 4-Stroke tab's INS table gives each run's absolute level at a
  roadside distance (monopole, 1/r, hard ground +6, A-weighted, summed; to 0.4 dB of wam_sound.py per order) and,
  with a target dB(A), Davies' per-order cuts (N orders within 15 dB of the loudest to L_T - 10 log N). wamlevel_ui.js
  (uses the kept F-100 p900 run; dualexit_ui.js moved to it). Page V60.
- Intake mouth from the page (2026-11-05): the 4-Stroke OpenWAM section can write the case with the intake's open end
  recorded (ins_intake, writer v12) and reads it back as an "intake mouth" column with its own roadside level (no jet
  for an inflow); intakemouth_ui.js runs OpenWAM on a 6-cycle case end to end (6 s). The quiet target's job list goes
  to the muffler designer with one button (installed scoring on). Fusion chamber builder takes baffles. Page gets a
  jump list of sections on long results columns.
- Muffler designer checked in OpenWAM (2026-11-05): "Check the chambers in OpenWAM" under the designer (desktop
  program) puts its top four chambers (plain and extended-tube; packed cans have no 1-D model) into the 4-Stroke tab's
  OpenWAM line ahead of its tailpipe (MDW_OVR in wamChamberEls / wamLineTail), plus the same line with no muffler, at
  speeds that put the firing order at the band's ends and middle. Score: no-muffler minus design, per half order at 1 m
  (wamInsOrders monopole), over the orders in the band within 20 dB of the loudest; also the A-weighted sum of the first
  12 orders and the mean brake torque. mdwam_ui.js runs it end to end with the real OpenWAM (10 runs, 8 cycles). First
  result on the default V8 (2.5 m line, 500 mm tailpipe, band 117-183 Hz, 1750 and 2700 RPM): every TL-scored can
  (designer: 10 dB) makes order 6 at 1750 RPM 8-12 dB LOUDER (chamber ringing with the pipes around it) while taking
  10-20 dB off at 2700 RPM; installed-scored cans are 2-6 dB better at the worst order (-5 to -7 dB) and cost no torque.
  The page names the order and speed that got worse, and flags a designer tailpipe that differs from the line's.
  Golden wam_default fixtures regenerated (only the INS recording lines differ); uel_ui's equal-case check no longer
  expects the INS recording to be absent.
  Follow-up the same day: at 25 cycles plain chambers settle (about 1 %) and still make order 6 at 1750 RPM 6.5 dB
  louder; extended-tube chambers never settle (1-D side branches wider than deep), now flagged on the page. No linear
  model (TL, anechoic or constant-velocity insertion loss, Munjal 2.15-2.16, `insertionLoss`, one- or two-temperature
  line) predicts the run's overall result across speeds within about 8 dB; details in docs/research/duct_acoustics_check.md.
  Build/score split (mdwBuild, mdwScore). Desktop host: ins_tail passes the last 4 cycles of each INS.DAT (ten 25-cycle
  runs were 100 MB and crashed the page); cargo test covers it, the test stand-in host does the same.
  Extended-tube pockets in the OpenWAM line are now lumped volumes (V = A l) on a neck 4 l / pi^2 long, so the volume
  rings at the tube's quarter wave c / 4 l, with a sharp-edge mouth loss K = 1 (MDW.pocket 'volume', default; 'quarter'
  keeps the old side tube). Without the loss the pocket self-excited at its neck frequency (409 Hz) in the run. Now
  every run settles under 5 % at 25 cycles and the double-tuned cans come out 6-7 dB(A) under plain chambers of the
  same size (91.5 / 93.5 vs 98.5 / 97.6; no muffler 105.7), worst in-band order about level instead of -6.5 dB.
- Input robustness (2026-11-05): two new tests. fuzz_ui.js feeds every tab seeded random values (0.3-3x each
  field, plus 0, negative, 1e9, blank, text, random selects and checkboxes; FUZZ_SEED, FUZZ_ROUNDS, FUZZ_UNITS=met,
  FUZZ_TABS, FUZZ_LOG) and fails on a page error or NaN / Infinity / undefined on screen, printing the section, the
  row and the whole tab's inputs. extremes_ui.js sets every numeric field alone to 1e9, -1e9 and 1e-9 and fails on a
  crash, a hang (60 s), a recompute over 4 s, or bad text. First pass: 17 failures in 273 settings (5 hangs, 4 crashes:
  e.g. exhaust opening 1e9 deg, muffler length 1e9, cat RPM 1e9, hanger reach 1e9). Fixes: readInput rejects values
  outside a plausible range per field kind (IN_RANGE: length 100 m, temperature -273.15 to 3000 C, displacement 1e6 cc,
  numbers 1e6, nonzero magnitudes under a micron / 1e-6; data-min / data-max narrow a field), marks the field
  (input.oor, aria-invalid, a title); exhaust opening range-checked 0-180 deg BBDC on the 4-Stroke and Headers tabs;
  branchPeak in the cancellation-free root form (Infinity dB at a huge neck), capped at the chart's limit; the ring
  clamp's tear-out row read the form's hole as `mhole` (undefined: always NaN) and now reads the part's hole; zero
  hanger weight no longer gives an infinite bounce frequency; a pipe or air temperature past absolute zero or 5000 C is
  asked again; boom-tube panels and the hanger strength caption no longer print NaN with an empty field.
- OpenWAM muffler check on other layouts (2026-11-05): inline 4 (needs 25 cycles; extended-tube cans 14 dB(A) under
  plain ones there too; one can at 5400 RPM keeps a free tone near 413 Hz that neither more mouth loss nor a smaller
  pocket volume settles, flagged on the page) and the unequal-length header with the H-pipe (builds with both
  junctions and a chamber on each bank). The check now runs at least 20 cycles a run (MDW.minCycles) and says so.
- Dual-exit settling fix (2026-11-05): wamInsOrders compared the summed flow of two exits in the last cycle with the
  first exit alone in the cycle before, so every dual-exit OpenWAM run read as unsettled (the H-pipe V8: 68-205 %
  where the exits differ 2-6 %). Each exit is now held against its own previous cycle and the worse reported, as
  wam_sound.synthesize_multi does; dualexit_ui.js checks it. Crossover results in duct_acoustics_check.md.
- Sound with no file (2026-11-05): Sound tab "Hear the model (no recording needed)". The page's own wave simulation
  (wsFactory, JS, in a worker) runs the 4-Stroke tab's engine and header at full throttle (the whole engine when the
  Headers tab has unequal lengths), with the OpenWAM panel's line after each collector (pipe, the Mufflers tab's
  chamber as a plain one or a can of the stated volume, tailpipe). runSpeed opts.record / recordCycles records each open
  end's face flux, gas speed, temperature and density from the start of the window (cycles 0-720), six cycles averaged
  after resampling (the solver's open end varies 10-20 % RMS between cycles at either grid and does not settle further;
  kept as the spread). The runs are read as INS.DAT runs (wamInsOrders, monopole p = (1/4 pi r) d mdot/dt), join
  WAM_UI.ins (src 'wave'), and play held, driving past, pulled through the speeds, or both, at the model's own level at
  the microphone distance (135 dB peak at full scale), with no recording loaded: recSynth takes o.sr / o.kf / o.noRec,
  recPlay a sample rate. The levels table on the 4-Stroke tab marks wave runs. Checked against OpenWAM (default V8,
  2.5 m line, no muffler, 25 cycles): firing orders within 1-9 dB, A-weighted sum of 12 orders +4 dB at 1750 and -9.5
  dB at 2700 rpm. Between-firing orders 20-40 dB weaker than OpenWAM's at 1750 rpm: both models fire the four cylinders
  evenly into one symmetric 5-way junction (OpenWAM BC type 12), so a settled run has only the firing orders; OpenWAM's
  there come from its last cycles still changing (4.8 %), which one analysed cycle spreads over every order. A 230 x 400 mm chamber on
  the line takes 15 and 5 dB(A) off at 2500 and 4500 rpm. wsnd_ui.js.
- Hear each part (2026-11-05): the no-file sound estimate now carries every addition on the line: the Mufflers tab's
  chamber with its extended tubes' pockets as tuned side volumes (V = A l, neck 4 l / pi^2, the same as the OpenWAM
  case), the J-pipe (closed tube as a tuned volume, mouth end correction 0.6133 r) or Helmholtz can at its place, a can
  of the stated volume, the tailpipe; freshState puts collector.branches on the collector's line (any pipe, ch.P).
  "Hear each part" runs the exhaust built up one addition at a time (open headers, + line and tailpipe, + muffler, +
  resonator) at the same speeds; the table shows each step's dB(A) and what its addition changed; any two rows play as
  A and B (held, driving past, pulled through the speeds, or both), or every row in order, on one level scale.
  "Keep this design" holds a design's runs (with a one-line description) beside later estimates (up to 6). Default V8,
  2500 / 4500 RPM, dB(A) at 1 m: open 106.6 / 121.1, + 2.5 m line 105.1 / 106.6, + 230 x 400 mm extended-tube chamber
  92.6 / 98.3, + J-pipe 93.3 / 95.4; every step moves some order by 10-41 dB. Still left out (noted on the page):
  parallel auger / bundle paths, the crossover, packing, the reverse-flow layout (runs straight through).
- Packed straight-through in the sound estimate (2026-11-05): the OpenWAM panel's muffler can be the Mufflers tab's
  packed can (mufKind 'packed'). The estimate runs it as the bare perforated core (the core straight through, the
  annulus in ~50 mm slices as side volumes through each slice's holes, neck = wall + 0.85 hole) and applies the
  packing's extra loss to the outflow afterwards, harmonic by harmonic: calcAbsorb's packed TL less its bare TL
  (lumped slices with a Darcy loss moved the level under 1 dB from 0 to 150 kg/m3 where the transfer-matrix model gives
  9-26 dB more at 1 kHz; the slices drop that loss). 230 x 400 mm can, 10 % open core, 2500 RPM: 300-1000 Hz band
  83.4 / 78.6 / 74.4 dB at 0 / 60 / 150 kg/m3, below 150 Hz within 1.6 dB. OpenWAM has no packing: its case runs the
  bare core, and the panel says so. Solver: an optional per-branch linear resistance Rp, taken implicitly.
- Crossovers, in-line pieces and reverse-flow cans in the sound estimate (2026-11-05): the wave solver now carries
  opt.crossover {type 'h' | 'x', pos [per collector], tube} between two banks' lines (collectorNets cuts each line;
  an H is a balance tube between two three-way nodes, an X one four-way node; a Z runs as an X), and pieces along any
  collector line (lineWithPieces): parallel paths between two nodes (the auger's centre tube and spiral, a tube
  bundle, from wamParPaths as the OpenWAM case has them; a capped auger as one path) and dead-end stubs closed at their
  far end (a reverse-flow can: the chamber off the end plate's node, Munjal 3.7; its tube extensions left out).
  Hear each part adds a step for each (+ the H-pipe / X-pipe, + the auger / tube bundle). Default V8, two banks, 2500
  RPM: the H-pipe moves orders by up to 34 dB at -0.4 dB(A) overall; the X and the H differ by up to 36 dB; the
  auger takes the firing orders 15-25 dB down (its two paths 950 mm apart in length), the bundle moves them up to 9 dB;
  reverse flow against straight through in the same 230 x 400 mm shell: up to 23 dB. wsndxo_ui.js, wsndpar_ui.js.
- Engine pickers list the LS and LT engines by name (GM_LS_NAMED, engFam); OpenWAM check: Use buttons, winner marked,
  the tab's straight-through chamber runs alongside.
- OPEN (owner decisions / later): primary-length reference point when a port length is entered (Stainless Headers is
  ambiguous); Tri-Y first section measured from the port vs the valve; Helmholtz neck end correction 0.6133 d (two
  unflanged ends) vs 0.85 d flanged; hot-gas sound speed uses air (gamma 1.4) in the empirical formulas while the wave
  simulation uses 1.35 (~2 %); desktop/Fusion load the
  page without a doctype (quirks mode; renders the same, but the artifact host is standards mode).

## 2026-11-12: wave model gas properties (temperature and composition), comparison fix

- The 1-D wave model (wsFactory in web/index.html and rust/et_wave, WebAssembly rebuilt) no longer uses one gas of
  gamma 1.35, R 287: air and its burned products at the engine's AFR (rich: water-gas ratio 3.5), mixed by the
  fresh-charge tracer per pipe cell, cylinder and side volume, thermally perfect with GRI-Mech 3.0's NASA polynomials
  (the table sosExh already used, now shared; sosExh unchanged to the last digit), checked against NIST-JANAF.
  spec.e.gas = 'const' keeps the old model bit for bit (fixtures/wave_const_ref.json; JS and Rust).
- Against OpenWAM (8 configurations x 6 speeds): net IMEP 22-28 % -> 6-12 % above; the wave model's own torque falls
  11-16 %; VE -3 to +2 %; exhaust port gas 78-150 K above OpenWAM's. The page's eta 0.72 calibration was set with the
  old gas and is not retuned (method text says so).
- Fixed on the way: a supersonic exit below the outside pressure emptied the end cell (NaN at 9000 rpm on a megaphone);
  compare.py aligned OpenWAM's traces to the gas-exchange TDC in 23 of 48 runs, so the "port-pressure phase"
  difference of 2026-11-11 was largely an artefact (aligned, single cylinder median correlation 0.86-0.96).
- Left open: the remaining 6-12 % sits in the gross loop; a third to half goes with the pipe wall laws (nofric);
  OpenWAM's compression is softer (exponent 1.28 vs 1.36; its charge carries fuel vapour) - not yet tested. Cost of the
  gas: about twice the computing time. Details: docs/WAVE_VALIDATION_2026-11-11.md, addendum 2026-11-12; tests
  web/tests/wavegas_ui.js, wave_wasm.js (constant-gamma check added), wavekat_ui.js (anchor).

## 2026-11-12, part 2: wave model heat release from chemistry, fuel vapour, friction, real-engine check

- The cylinder's "72 % of the fuel heat" (eta 0.72, tuned under gamma 1.35) is gone: the burn releases the heat of
  reaction from enthalpies of formation (GRI-Mech 3.0 a6, checked against NIST-JANAF) to the model's own frozen
  products at the engine's AFR, the fuel CH1.87's formation enthalpy set by its 44.0 MJ/kg LHV (AFR 12.8: 0.839 of the
  LHV, CO and H2 left over), times ETA_C 0.975 (MIT 2.61 lecture 6: SI combustion efficiency 97-98 %). Sensible energy
  datum, chemical energy carried by the fresh fraction; total energy conserved to 1e-14 over engine cycles.
- Fuel vapour in the charge, adopted (part 1's next experiment): isooctane/toluene at H/C 1.87 from NASA CEA's
  thermo data, added at the intake valve as a port injector (intake pipes stay air). It explains OpenWAM's softer
  compression (exponent 1.36 -> 1.30, OpenWAM 1.29) and moves peak pressure and exhaust temperatures to OpenWAM's; the
  net-IMEP surplus over OpenWAM is now 10-14 % (gross loop; open). spec.e.fuel 'air' keeps the air-only charge;
  spec.e.gas 'const' the pre-part-1 model, bit for bit.
- Brake torque and power on the 4-Stroke tab (first design; chart dotted line, table, peaks): gross IMEP (new model
  output, JS and Rust/WASM) less Heywood's SI tfmep 0.97 + 0.15 N/1000 + 0.05 (N/1000)^2 bar, which includes pumping,
  so it is taken off the gross, not the net loop. Woschni checked term by term against the published form (unchanged).
- Real ratings (tools/validation/wave/ratings.js, LS3 with GM's cam, LS7/LT1 cams assumed, long-tube header, the page's
  open 300 mm runners): brake torque +8 to +20 %, brake power +8 to +19 % (with the tuned 0.72 it was -10 to 0 %); the
  model is most sensitive to valve Cd and intake runner/losses (VE 1.13 at the LS3's peak). Not tuned. Dissociation
  (not modelled) overstates expansion work by ~1 % at AFR 12.8 (dissociation.py). Sound: firing orders +0.9 dB median.
- Fixed on the way (D5): a supersonic exit that a normal shock at the exit could not bring up to the outside pressure
  emptied the end cell (a megaphone at 7850 rpm never finished); the end now takes the post-shock state.
- Details: docs/WAVE_VALIDATION_2026-11-11.md, addendum 2026-11-12 part 2; tests wavegas_ui.js 8-10, wave_wasm.js (gross
  IMEP, lean/etaC and air-only jobs).

## 2026-11-12, part 3: measured valve flow, intake plenum / throttle / filter, cylinder against OpenWAM

- Valve flow: a head's flow-bench curve (cfm at 28 in H2O) becomes each valve's effective area against lift by the
  isentropic orifice law (wsFactory benchCdA, flowTab; Rust flow_tab), for the LS3 (Hot Rod Feb 2011, stock 0821 heads)
  and LT1 (WCCH via EngineLabs) in CAM_LIB.flow; the page uses it when the engine comes from the list ("Valve flow"
  selector; a coefficient entered or fitted takes over; OpenWAM keeps the 0.7 law). The 0.7 law (curtain, capped at 0.85
  seat) is within 10 % of the LS3's measured intake at every lift; its exhaust flows up to 34 % more. No tabulated Cd(L/D)
  map could be fetched.
- Intake system in the wave model (JS and Rust, bit parity): spec.intake.plenum {V_m3, inlet, throttle {d, cd}, filter
  {dp, m}}: a well-mixed plenum (runner mouths and the inlet as open ends on it; mass and energy to 1e-14), the throttle as
  a 50 mm step at its wide-open Cd A (0.828 of the bore, measured on a stock GM 87 mm body) dumping into the plenum, the
  filter loss as a Borda-Carnot step (an input; no sourced filter loss exists on the page). An explicit orifice coupling
  was tried first and flipped between two states every step at a throttle's small pressure drop; replaced. 4-Stroke tab:
  plenum volume (cu in / cc), throttle bore and coefficient, filter loss, inlet tube; simulated cylinders get their share.
- Ratings (whole engines, plenum + throttle + measured head flow; plenum volume, runner length, inlet tube and filter loss
  are assumptions with sensitivity runs): brake torque +4 to +16 % (was +8 to +20), brake power +6 to +16 %; torque peak
  still 200-400 rpm late; the unknown runner length moves torque -6 to +9 % and the peak 600-800 rpm.
- OpenWAM like for like (cyl_expts.py): valve areas, timing, Wiebe and heat per charge agree; the wave model traps ~3 %
  more and, from OpenWAM's own IVC p, T and heat, still does 6-10 % more closed-cycle work: open (gas properties /
  in-cylinder heat by phase are the candidates left). No model change for it.
- Details: docs/WAVE_VALIDATION_2026-11-11.md, addendum part 3 (C1-C10); tests wavegas_ui.js 11, wave_wasm.js (two jobs),
  cam_ui.js (plenum share, head curve).
## 2026-11-12, part 3: exhaust after the turbine with cooling, compressible flow, size steps, one muffler model

- Intake tab, Exhaust after the turbine: the back pressure is now `exhMarch`: the gas cooled along each pipe run by the
  Headers tab's tube-skin model (`calcSkin`: Gnielinski x CAF, Churchill-Chu / Churchill-Bernstein, radiation; new option
  `cpGas`, the burned gas's cp in the energy balance), then marched from the tip back with the compressible 1-D relations
  (Shapiro's influence coefficients with friction and heat loss, RK4; minor losses as total-pressure losses on the local
  head; compressible Borda-Carnot for widenings; tip at the outside pressure plus Munjal's 0.4 H), steps between parts of
  different bore (abrupt or cones), choking reported in words with no number. The figure is the static pressure at the
  turbine outlet (a turbine map's outlet pressure), the total pressure beside it, and the cone taken as fully separated as
  the other end. New inputs: cooling on/off, air temperature, air speed, outside finish, CAF (steady by default, Wendland's
  measured factors), steps abrupt/cones. A table shows what each change moved against the first method.
- Case A (turboguide_ui, 450 hp PT5862): first method 39.30 kPa (5.70 psi) -> 7.72 kPa (1.12 psi) static at the turbine
  outlet (total 52.39 kPa / 7.60 psi; cone separated 16.30 kPa); of the 31.6 kPa: the head as ½ rho v² -2.22, cooling -0.66,
  compressible -0.05, the turbine-outlet cone's static-pressure recovery and steps -28.66. Independent check
  tools/validation/boost/xflow.py: 7700.13 Pa (0.21%), and 120749.90 against 120752.07 Pa on a second case.
- Fixed on the way: the muffler and tip head took 1.4 p M²/2 with the exhaust's Mach number (8% high at 900 °C) in the turbo
  sum; Wendland's CAF values were credited to "Daniel" (his first name). The muffler elements are one function for the
  Mufflers tab and the turbo sum (`mufElems`, `mufElemLoss`; the hand copy `xMuffler` now calls it).
- Open: the twin-downpipe Y (no symmetric-wye coefficient read), the Mufflers tab's own 1.4 head for its typed Mach (7% high
  for hot exhaust; moves physics-audit pins), the Headers tab's air cp, CAF at full-power Re, the cone's real recovery
  behind a turbine, double-wall pipe, aluminised emissivity. No NA whole-exhaust back-pressure sum exists to apply this to.
  Details: docs/BOOST_AUDIT_2026-11-12.md, "Exhaust after the turbine, part 2"; tests web/tests/xflow_ui.js, turboguide_ui.js.

## 2026-11-12: a recommended intercooler and turbo for the build (Intake tab)

- The owner's "Can you recommend a specific intercooler in these design circumstances as well?" and "From reputable brands
  ideally". Intercooler options now pick one core per type (one of each, with what decides, while the type is "Not decided",
  the new default) by rules stated on the page (icRecommend): (a) the maker's rating, the lower where two are stated
  (Mishimoto MMINT-UM 800 / "Rated to 600 whp": 600), at least a margin input (default 1 = none) × the target per core
  (twins into one core: the whole engine); (b) end-tank necks not smaller than the recommended charge pipe OD (smaller:
  rejected with the sudden-step loss tsStep gives; unknown or core-only: flagged); (c) Bell's 6 in² per 100 hp / 45% open
  face as a flag, air-to-air only, charge face per maker (Garrett labels the hot flow; Mishimoto tanks on the length ends;
  CSF assumed along the length, the height for its vertical-flow rows); (d) a row with a thermal point (EJ Bowman, or the
  user's own measured core) predicted at this build's flow (UA held) must remove at least the margin × the heat needed.
  Order: smallest rating, then published drop at this flow, core volume, exact tank match, more published data (the
  owner's tie rule), list order. Top three with the reason each ranks there, the rest collapsible with what ruled each
  out, and a specification block always shown (heat in kW and BTU/min, rating, NTU/UA for the target, Bell area and face,
  tank necks, Bell's 2 psi drop budget). "Use this intercooler" and picking from the list do the same: type, core, necks
  less twice the pipe wall into the intercooler inlet/outlet, the maker's drop and flow into i-icrdp / i-icrf, a thermal
  point into the cooling-capacity inputs. Checklist step 6 and the build sheet (part number, size, source link) show it.
- Turbo options: the same kind of pick (turboRecommend): not flagged in the table, rating at least a margin × the target
  per turbo; smallest rating, then smaller compressor inducer, then a maker with a lower figure; "Use this turbo"; the
  page says it is a rating match, not a compressor-map match.
- Catalogue (makers' own pages, read 2026-11-12): Garrett's full core table (31 air-to-air, 4 air-to-liquid; was 8),
  Mishimoto MMINT-UZ (no hp rating; 22 psi), MMINT-UG (700 hp), MMINT-US (800 hp), CSF 8040, 8048, 8054, 8055, 8063, 8067,
  8068, 8173, 8174, 8085, 8086. Each row has "What the maker publishes" (construction, end tanks, drop, thermal point,
  pressure test or rated boost, warranty; null where the page does not say) - not a quality rating; a pick with fewer than
  3 of 6 gets "Little published data for this core — check it in hand" with a workshop checklist labelled as common
  practice. Not verified (dealer or marketplace pages only, searched again): Treadstone, Vibrant, PWR, Wagner, Bell.
- The user's own core (name, size, necks, rating, measured drop and point), recommended alongside the list; TSO is now
  saved with projects (PROJ_UI.tso).
- Note: the heat and pipe sizes come from the tab's airflow at the boost entered, not the power target; the page says so
  when Garrett's method differs by more than 10%. Garrett advises the largest core that fits the packaging; this page picks
  the smallest that covers the target (the margin leans toward Garrett's advice), said on the page.
- Review change (same day): air-to-air order is now Bell first. Among rows passing (a) and (b): those whose charge face
  meets Bell's face for the target × the margin (6 in² per 100 hp ÷ 0.45 = 13.33 in² per 100 hp), then face unknown, then
  failing; the old keys within each group. A pick that does not meet Bell says "no listed core meets Bell's face area for
  this power; this is the closest by rating" with the shortfall; a pass that rests on the CSF flow-direction assumption
  says so. New optional "Largest core that fits" (length × height × thickness, mm with inches shown; Garrett's advice):
  cores are checked on the maker's overall size where published (Mishimoto, with tanks; `over`) else the core as
  published (length and height may swap), and with a limit the largest charge face that fits comes first (stated on the
  page). Water-to-air keeps its order; the limit applies to it too. icrec_ui.js updated (Bell arithmetic per candidate in
  its comments; size-limit cases; a 1300 hp case where nothing meets Bell).
- Tests: web/tests/icrec_ui.js (new); turbolib_ui.js row counts updated (type starts undecided; 50 + 17 rows) and the
  Bowman water ports now read "BSP size ¾" (a thread designation; the sweep found "1 in" with no mm once the water-to-air
  rows are listed by default).

## 2026-11-12: Conflux barrel intercoolers with the maker's performance curves (Intake tab)

- Source: Conflux Technology, "Barrel Intercoolers" brochure, version 1.0 (2026), supplied by the owner; maker site
  confluxtechnology.com. Copyrighted ("may not be reproduced, in whole or in part"): only facts and figures with attribution
  are in the page; the PDF and its images are not in the repository. The first maker data on the page that gives
  effectiveness and air pressure drop against charge flow for automotive charge coolers.
- Three water-to-air rows (additively manufactured AlSi10Mg, hose barbs): 100011 4.5 in / 114 mm, "Optimised for engines up
  to 400kW", 140 × 133 × 155 mm, 1.5/1.8 kg dry/wet, air 114.3 mm, coolant 19 mm (¾ in); 100012 5.0 in / 127 mm, 300-600 kW,
  160 × 150 × 190 mm, 2.2/2.6 kg, air 127 mm, coolant 25.4 mm (1 in); 100013 6.0 in / 152 mm, 500-900 kW, 177 × 171 × 225 mm,
  3.4/4.0 kg, air 152.4 mm, coolant 25.4 mm. Test conditions: air in 120 / 200 / 250 °C at 250 / 350 / 500 kPa(a), EGW 25/75 in
  at 30 °C, 20 / 35 / 50 L/min (0.34 / 0.60 / 0.86 kg/s). "What the maker publishes": 6 of 6, plus CFD and calorimetric
  testing, burst/pressure and fatigue testing statements, ISO 9001, lead times (1-3 weeks production-ready, no NRE; 2-6
  weeks configured), warranty terms on request. Rating = the top kW figure in hp (crank or wheel not stated); a target
  under a lower figure is flagged.
- Curves: vector paths in the PDF, read with pdfplumber against each chart's own gridlines. Each curve is two cubic Bezier
  segments through three nodes at round flows and near-whole values (taken as the maker's points; flow axes re-anchored on
  the end nodes, offsets up to 0.003 kg/s). Tabulated at five flows to 0.1 (path reading about ±0.05 units; points between
  nodes are the plotting program's smoothing). The two drop curves of a part agree within 0.04 kPa; effectiveness against
  (T_in − T_out)/(T_in − T_c) from the outlet chart within 0.78 points (largest at the 100011 end node).
- Model (comment above cfxModel): UA at each tabulated point by inverting the exact cross-flow series (counter-flow beside
  it: UA 7-14% lower, predictions within 0.1 °C at the maker's coolant flow; the bracket is shown); UA(m) is the maker's
  flow dependence (replaces the preprint bounds for these rows), linear inside the range, a power law fitted to the five
  points outside it, flagged (UA ∝ m^0.508 / 0.525 / 0.527 cross-flow). Coolant-side dependence not published: UA held
  at the maker's coolant flow, flagged beyond a factor 1.25. Drop: dp ∝ 1/rho at equal mass flow (inlet density at the
  compressor outlet), dp ∝ m^n outside the range, n = 1.763 / 1.819 / 1.846.
- Fed into: the recommendation (thermal check from the curve, drop at this flow scaled to density), the table (dual units),
  a chart per barrel with the build's point, the cooling-capacity block (curve at this flow, prediction, bracket, scaled
  drop, density gain), icApply (barb less twice the wall into i-ici / i-ico, so the size-change table shows the widening;
  the scaled drop into i-icdp and the rated-drop inputs, iterated with the route; the maker's coolant and flow when none is
  entered; UA from the curve feeds the loop), checklist step 6 and the build sheet. New coolant EGW 25/75 (taken by mass:
  cp 3917 J/kg K, 1029.5 kg/m³ at 40 °C, interpolated from the Engineering ToolBox page the page already cites).
- Open / future: the owner also supplied Conflux's liquid-to-liquid Oil Cooler brochure (part 100220, Ø66.3 × 203 mm,
  0.31 kg, AlSi10Mg, curves of heat transfer and oil pressure drop against oil flow). The page has no oil-cooling section,
  so nothing was added; a possible future feature.
- Tests: web/tests/conflux_ui.js (new); icrec_ui.js (water-to-air orders now include Conflux 100011 / 100012 where the rules
  put them) and turbolib_ui.js (70 rows, 20 water-to-air) updated.
- Review change (same day): the intercooler order rewards evidence. Among rows passing the rating and tank checks (inside
  each Bell group for air-to-air): (0) thermal data (a maker's curve or point, or the user's measured point) evaluated at
  this build's flow that meets the target × margin inside the data's flow range (a single point: within ±10% of its
  charge flow, IC_PT_RANGE); (1) meets it only by extrapolation (flagged); (2) rating only, with the line "rating only:
  the maker publishes no thermal data for this core, so the page cannot check it against your target". Groups 0 and 1:
  smallest capacity margin that meets the target, then drop at this flow and density, volume, weight, rating; group 2 the
  old keys. The rule is stated next to the pick. A core whose thermal data misses by under 5% of the heat needed is listed
  as "just short" with the target it does reach and, water-to-air, the coolant temperature into the core that would make it
  pass (tci' = t2 − (t2 − tci) × margin ÷ capacity margin; effectiveness is independent of temperatures at fixed flows).
  K24 + PTE 5862, water-to-air: 450 hp (29.541 psi, 0.4208 kg/s) Conflux 100012, EJ Bowman JK190, Conflux 100013; 100011
  just short (72.0% against 75%, passes with coolant at about 18 °C); 600 hp (46.945 psi, 0.5863 kg/s) Conflux 100012,
  100013, then the rating-only Garrett 717874-6008. icrec_ui.js and conflux_ui.js expectations recomputed by hand.

## 2026-11-12: Mounts designer: brackets for the intercooler and the other bolt-on parts (Hangers tab, Fusion)

- The owner's "Be able to figure out mounting solutions if possible as well". A Mounts designer under the Hangers tab's
  hanger designer (its own block, "Mounts designer"; the hanger code is untouched except one call in renderHang): the
  part (typed: air-to-air core, barrel charge cooler, front heat exchanger, oil cooler, catch can, valve support; or the
  intercooler picked on the Intake tab, with the maker's size and, where published, its dry and wet weights: Conflux
  100012 2.2 / 2.6 kg), the liquid it holds (litres × the page's COOLANT densities, or the oil's typed density), 2 to 6
  mounts by position from the part's centre, each bracket's direction, reach and offset; loads, isolators, heat growth,
  brackets sized by calculation, a dimensioned side view of each bracket and a front view of the part with its mounts,
  a cut list, DXF (mm; CUT via the Hangers tab's hgDxf, BEND lines, MARKS names and 100 mm / 4 in bars) and a 1:1 SVG
  (both units, scale bars); rows on the turbo build sheet (tsSheet is wrapped from the new block, its code not edited;
  mountsSheetRows() is the hook).
- Sources read 2026-11-12 (and what could not be): FIA Appendix J Art. 253-7.2.2 / 7.3.6 (extinguisher mountings
  "withstand a deceleration of 25 g": the default design acceleration, each way, as a reference class); Bosch Motorsport's
  vibration-profile sheet ("Shock: 50gn 6mSec ISO 16750-3", the 50 g preset: a 6 ms test pulse); ISO 16750-3 and SAE J1455
  previews give no levels (paywalled), so the g-load is an input; 14 CFR 25.303 (1.5 on limit load: the safety-factor
  default, held against yield); Garrett (cores "typically soft-mounted" on rubber isolation grommets for vibration and
  thermal expansion: soft is the default); University of Iowa 58:153 lecture 9 (isolation above r = sqrt 2); AMC
  Mecanocaucho Type A bobbins (RS datasheet: maximum static load and its deflection, compression and shear, 16 sizes;
  column letters read from the drawing); AmesWeb after ASM (3003 aluminium 23.2 µm/m °C); Fastenal metric and inch
  property tables (8.8 / 10.9, Grade 5 / 8, stress areas); Portland Bolt (shear ~60% of minimum tensile, minor area);
  AWS D1.1 study guide (0.30 FEXX on the throat, E70 145 MPa); AlcoTec filler chart (typical fillet shear, 4043 11.5 /
  5356 17.0 ksi longitudinal); Protolabs 6061-T6 (68.3 GPa). Not verified: Eurocode 9 / Aluminum Design Manual fatigue
  categories (so static + g-load only, said on the page), SendCutSend's bend radii and K-factors (its calculator is
  script-only: inside radius and K-factor are inputs, defaults t and 0.42 as assumptions), a filler figure for 308L
  (304 brackets' welds use the base metal's shear yield), tensile strengths for bearing (bearing not checked, said).
- Method (comment above MT_G): six load cases (each axis each way, gravity added); shares on equal mounts about their
  centroid, F/n + (J+ M) x s (a line of mounts reports the turn the brackets must clamp); bounce sqrt(n k / m) / 2 pi,
  T = 1/|1 - r²| shown and the page's rubber damping (0.07) used for pass/fail; root section of rectangles (strap, a
  gusseted T, a U channel), |N|/A + |Mu| c/I + |Mf| c/I at the worst corner with shear and torsion in von Mises, the
  thinnest SendCutSend stock that passes; net section re-checked at each lightening hole; tear-out as the Hangers tab;
  foot bolts by the foot tipping about its nearer edge (no prying); welds by the line method; a stay as a pinned
  two-force member (yield or Euler) that flags any sideways load ("triangulate"); printed brackets by the Intake tab's
  rules (printWall, safety factor at least 3, the filament's suggested maximum temperature). Heat growth α L ΔT from the
  fixed mount; with soft mounts the rubber's rated shear deflection must take it, hard mounts get slots.
- Worked examples (mounts_ui.js comments): a 24 × 12 × 3.5 in core, 7.0 kg (example weight), four mounts, 25 g: 17.16 N
  standing, 446.2 N design each; 28.33 Hz idle (4 cyl, 850 RPM), 20% passed -> bounce ≤ 11.57 Hz, ≤ 9.24 N/mm per mount:
  no AMC bobbin is that soft, so the page gives the spec to buy to; 3/16 in mild-steel strap 54 mm wide at 63.5 mm reach:
  134.3 MPa, SF 1.85. A 40 kg heat exchanger on four: AMC 120002 (12.8% passed, damped). The Conflux 100012 on two
  brackets: 12.75 N standing, 331.5 N design each.
- Fusion: mounts.py (pure Python: the bracket frame from a part point and a chassis point with the face's or scan's
  normal, the upright's tangent outline, the flat pattern, plates placed through hangers.plan, clearance to ordinary and
  hot keep-outs with the foot and boss left out, a straight-line socket-access check along each bolt axis, the foot
  turned the way that keeps access); cadtools mountPlace (a stand-in box or cylinder), mountPick (part, then pairs),
  mountBuild (plates by _hang_plate, the stay as a tube; refuses a reach that disagrees with the picks).
- Tests: web/tests/mounts_ui.js (new, 41 checks), fusion-addin/tests/test_mounts.py (geometry by hand; the page's flat patterns from
  fixtures/mounts_payload.json), test_mounts_fusion_fake.py (writes fixtures/mounts_reply.json with ET_WRITE_FIXTURES=1);
  fusion-addin/tests/fusion_live_mounts.py for the owner's machine, NOT RUN here.
