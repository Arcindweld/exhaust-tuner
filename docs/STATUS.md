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
- CFD: SP/cfd (intake_cfd.py OpenFOAM v2412; JS port intake_cfd.js byte-identical on 172 files). Validation vs Blair & Cahoon
  (medium mesh, tract end): PP 29.9 vs 30.0 g/s (-0.4%), RAD 36.2 vs 34.8 (+4.0%), ELL 38.0 vs 36.15 (+5.1%); exhaust mode:
  sudden expansion K 0.60 vs 0.562, 90-deg bend K 0.14 vs 0.20-0.30 (low by a third, documented). Page: Intake tab #intake-cfd,
  Headers tab #headers-cfd (expert mode), Method bullets. NOTES.md filled. friction/entrance suites un-run.
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
