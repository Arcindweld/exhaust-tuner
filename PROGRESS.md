# PROGRESS (agent19/turbine) - delete in final commit
Task: turbine capacity from published flow -> effective area; predict mode; tests turbine_ui.js; docs.
- [ ] read docs/code
- [ ] research (sources list below)
- [ ] physics + page
- [ ] tests
- [ ] docs
## Sources found
- Garrett G40 launch article (garrettmotion.com/knowledge-center-category/racing-and-performance/garrett-performance-product-launch-g-series-g40-900-g40-1150): "G40 1.19 A/R has a max flow of 43 lbs/min", "GTX4088R 1.19 A/R peaks at 37lbs", "16% increase in peak turbine flow", G40 wheel 77/70 mm 84 trim, max turbine wheel eff 76% vs GTX4088R 66%. No reference state.
- Garrett G25-660 page: Turbine Flow Map + Exhaust Flow Chart IMAGES only; "flows 15-20% more than GTX and has peak efficiency of 74%"; 54/49 mm trim 84. G30-770 page: "flows 5% more than GTX ... peak efficiency of 74%", 60/55 trim 84; exhaust flow chart image only. G35-900: 15-20% more, 74%, 68/62. G-Series II G30-825 same. Installer guide 2025: no turbine flow.
- Turbo Tech 103 (both PDFs): compressor only.
- MotoIQ "Turbo Tech: Compressor and Turbine Map Details" p3 (Turbo by Garrett): "corrected turbine mass flow is a function of actual mass flow divided by turbine pressure ratio"; "exhaust manifold pressure is one bar higher than intake" ; U/C0 ~0.7.
- MotoIQ GTX Gen2 calc p2: "we assumed 70% as 72% is the maximum stated on the map" (GTX3071R 0.83 V-band); turbine PR 2.96 vs 2.82; dP -9.5 -> -7.3 psi.
- MotoIQ Nerd-o-scope G-series p2: GT/GTX28 "stated peak efficiency of 69%"; G25 "74%". No turbine flow numbers.
- BorgWarner perf catalogue (turbozentrum PDF) p.17 Match-Bot example: rows quoted (EMP 3.2..21.4 psi, dP 2..-4, PR 1.36..2.23, Turbine corrected flow @59F 9.2..20.5 lb/min, PHI .0219..0.0287, WG area @CF0.8 .03..1.11 in2, power 71.5..376.5 hp). No displacement/turbo named. Model output.
- Precision 5862 page: no turbine flow. EFR datasheets: no turbine flow text.
- Blocked/not on allowlist: riunet (Anubis), motoiq gtx p3, garrett g25 (one URL variant), images.truckid.
- Linkoping (Andersson): turbine flow model k1 sqrt(1-PR^k2), no numbers.
