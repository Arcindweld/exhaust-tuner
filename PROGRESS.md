# PROGRESS (agent28/kseries) - delete in final commit
- [x] read docs/code: simSpec (web/index.html ~10490) rod=1.7*S, runner d=sqrt(0.6*nIn)*dIn, cam blank -> ivo=evc, ivc=evo (stand-in 20/60/60/20)
  applyVehicle ~19780 fills f-bore/stroke/cr/valves/vdi/vde from preset + kd; CAM_LIB ~16194 (no K row); kdNote ~19805
- [ ] research (sources list below)
- [ ] model VTEC/VTC (preset/closure only)
- [ ] presets, manifold dropdown, measure guide
- [ ] rerun K24 validation; tests kseries_ui.js; docs part 14
## sources found
- VTC: Hybrid Racing 50deg gear page "The K24A2 in the TSX came with 25 degrees." "K20A2, K20A3, K20Z1, K20Z3 got the 50 degree" https://hybrid-racing.com/products/honda-k20z-a-50-degree-vtc-intake-cam-gear-14310-rbc-003 (tegiwa says 25deg on K24A3 https://www.tegiwa.com/products/genuine-honda-25deg-vtc-actuator-intake-cam-gear-k-series)
- Honda R&D TR 20-1 (2008 Accord K24A): VTC widened 25->50 deg; valves 36/31; 87x99; 142 kW@7000, 220 Nm@4400 https://global.honda/en/technical-review/PDF/020-1/20-1_25e.pdf
- Honda R&D TR 12-2 (K20A lean burn, 86x86, valves 35/30) https://global.honda/en/technical-review/PDF/012-2/012-2_45e.pdf
- Hondata VTC: "0 to 45 or 0 to 50 degrees", 0 = fully retarded (implied), NA: max advance after VTEC to 6500-7000 then retard ~25; turbo "less than stock"; "higher the back pressure the more cam retard" https://hondata.mobi/help/flashpro/tuning_for_vtc.htm
- Rod 152.019 mm (5.985 in) "stock K24 length" SpeedFactory via Hybrid Racing https://www.hybrid-racing.com/products/speedfactory-h-beam-connecting-rods-k24 ; Skunk2 Alpha K24 152.00 mm evasive
- Kelford 179-A: rocker 1.7, 258/246 @1mm, EVO 49 BBDC EVC 19 ATDC @1mm, intake CL "VARI", ex CL 105 https://kelfordcams.com/product/honda-k-series-camshaft (intake events blank)
- Skunk2 Ultra Street: 6.85 in runners, 1.8 L plenum, 71 mm TB opening (evasive) https://www.evasivemotorsports.com/store/product/skunk2-ultra-series-intake-manifold-honda-k-series-street/
- Skunk2 Ultra Race: "6.0 in tapered runners", 3.5 L, 90mm flange https://www.evasivemotorsports.com/store/product/skunk2-ultra-race-intake-manifold-honda-acura-k20a2-style/
- K-Tuned side feed: 5.75 in runners, 1.875 in large dia, 4.78 L, 90 mm flange https://speedscience.co.nz/products/k-tuned-side-feed-intake-manifold
- hondatalk.ro thread (forum spec list, origin unstated): RBC 18.5 cm, 4.8/5.1 cm width, 1720 cc, 62 mm; RRC ~19.0, 64 mm; RBB(Endyn ported) 31.0 cm 1650cc 60mm; Skunk2 Pro 19.5 cm w/o stacks 2950 cc 64 mm https://www.hondatalk.ro/Thread-K-Series-Intake-Manifolds-TEST
- NOT FOUND: stock cam events/lift (k20a.org, clubrsx, 8thcivic blocked), head flow, bore spacing, stock K24A2 manifold dims
- [x] implemented: f-rod, f-ird, f-imani (K_MANI), f-vtc/f-vtcmax/f-vtcmode, f-vtec + low profile, 1 mm check lift, rustSpec (WASM ignored checkLift_mm: DEFECT fixed)
- [x] kseries_val.js results: NA before 191.9hp@6000 180.2lbft@5000; rod 192.3/180.4; rod+RBC 183.9@6000 166.1@5500; VTC best=0 everywhere
  turbo 18psi 5050: before I 4.343 IVC 3.741/410.7 -> rod I 4.312 3.714/410.3; NA 5050 I 1.105 -> 1.098
- boost_power (page, new rod): 15psi 428.2->428.9 @6050; 22psi 529.7->529.6 @7100; 29.52 pending (OUT=kseries_boost_power.json)
- [ ] fixture: CAPTURE=old.html node tests/kseries_specs.js ; run kseries_ui
