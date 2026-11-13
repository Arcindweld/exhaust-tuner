# Turbo manifold designer (agent12/manifold) — progress (delete in the final commit)

Sources fetched 2026-11-12/13 (scratch copies outside the repo):
- Garrett Turbo Tech 102 PDF (manifold tips, divided pairing 1+4 / 2+3, cracking of tubular manifolds)
- AutoSpeed "Turbo Manifold Design" review quoting MacInnes, Allard, Humphries, Bell
- BorgWarner tech tip twin scroll (2021-04-12)
- Cleveland-Cliffs 304/304L and 321 data sheets (CTE in/in/F, 304 scaling 1650/1500 F)
- Atlas Steels 321 (intermittent 900 C, continuous 925 C); Rolled Alloys 347 (useful to 1500 F; CTE only to 212 F), 625 (CTE 70 F->T, oxidation to 1800 F)
- Ace Stainless Supply ASTM A403/B16.9 elbow submittal (LR/SR centre-to-face, 10S/40S ID and wall, weights)
- Precision install recommendations (support from turbine inlet flange or centre housing); SINCO turbo bracing guide
- Stainless Headers billet T4 dual inlet flange (options only; no port size); Ace T4 divided transition flange (pattern only)

Plan: web tmCalc/tmSection after "Where to put them", before "Exhaust after the turbine"; checklist step 'mani';
build-sheet rows; Mounts part 'turbo' (tiny); Fusion turbomani.py glue + tests; validation script; STATUS entry.

Status:
- [ ] web code
- [ ] tests web/tests/turbomani_ui.js
- [ ] tools/validation/boost/turbomani.py
- [ ] fusion glue + tests + live script (not run)
- [ ] existing tests green; run_all_tests once
- [ ] STATUS entry; remove this file
