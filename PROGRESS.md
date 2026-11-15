# PROGRESS (agent24/e85) - delete in final commit
Sources gathered (see final report draft below). Plan: JS engine fuel (done, gasoline bit-identical vs old Rust QUICK),
Rust twin, WASM, fuel_ui.js, wave_wasm jobs, steady paths, page wiring, K24 script, docs.
- [x] JS wsFactory: fuelOf, burnedMoles/heatRelease/makeGas(F), portFuel cool, SPEC[8] ethanol SPEC[9] methanol
- [ ] Rust et_wave twin + WASM
Sources: CEA thermo.inp (C2H5OH gas -234950 liq -277510; CH3OH -200940/-238910; isooct -224010/-259160; tol 50170/12180),
GRI CH3OH NASA7, DOE/GO-102016-4854 Table 2 (SG eth 0.794, gas 0.72-0.78, AFR 9/14.7/10; 51-83 vol%), AFDC ethanol-blends,
US 8,468,983 (PFI negligible charge cooling; Table 3 dT -28 K gas, -138 K eth), SAE 2012-01-1275 abstract (DI 70 % of max; 14 K gas, 49 K E85),
HPA AFR cheat sheet (high boost 0.80-0.75, med 0.85-0.80 lambda), Haltech flex guide ("target made slightly leaner"),
Garrett pump vs E85 (16 psi 241 hp vs 30 psi 401 hp), EngineeringToolbox Tad ethanol 2238 K methanol 2222 K.
