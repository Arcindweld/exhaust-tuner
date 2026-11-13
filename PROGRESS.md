# PROGRESS (agent12/tidy) -- delete in final commit
Jobs: 1 test races F1 | 2 Bowman density | 3 mounts torsion/al welds | 4 Bell weights | 5 mounts<-catalogue weight | 6 Setrab FP | 7 --skip-slow
Status:
- started 2026-11-13
- job1: page window.__renderCount (renderActive end); web/tests/settle.js reads(pg) patches $eval/$$eval; applied to 10 tests
  (boostaudit chargeroute conflux icrec oilcool print turboar turboguide turbolib xflow). repro: plain $eval 29/30 misreads, settled 0/30.
  same.js: all tab HTML identical before/after counter. stab runs: scratchpad/stab.sh -> scratchpad/stab.txt
- job7: --skip-slow done in run_all_tests.py (README doc TODO)
- job2 Bowman: icRhoRef + icDpAt (index.html near cfxDp), bowman dp gets p_kPa 276.325 tC 180; icRecommend dpS; icApply fixed point for Bowman like Conflux. icrec_ui pins edited (untested yet)
- job3a torsion: mtRectTor series in mtSec (tk); boostaudit2_ui 42.6303->44.697311 + beta/alpha pins; mounts.py series+roark. 3b: no ADM allowable found (ESAB: ADM SF 1.95 on welds for buildings; no Fsw) -> unchanged
- job4 Bell: catalogue re-read (7 rows CFM/price ok, no weight on catalogue), item pages blocked; rows already carry lb weights from 2026-11-12
- job5: mtPart fixed (Bell mass[1] null -> mtKg(null) threw); notes with source; mounts_ui D checks added (untested)
- job6: Setrab FP 4 rows verified against the PDF; comment added
- TODO: run icrec, conflux, turbolib, boostaudit, boostaudit2, mounts, oilcool tests; README skip-slow; STATUS/audit docs; final suite
