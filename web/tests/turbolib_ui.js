// Turbo options and intercooler options / cooling capacity (Intake tab, 2026-11-12).   node tests/turbolib_ui.js   (from web/)
//
// Sourced rows (read 2026-11-12):
//   Precision GEN2 PT5862 CEA, maker: https://www.precisionturbo.com/p372175-turbochargers-street-race-gen-2-gen-2-pt5862-s-20730207239
//     "rated to support up to 700 horsepower", "hp rating: 700 HP", "compressor inducer: 58.0 MM", "a 62mm CEA® turbine wheel".
//   and its dealer listing (exducer, turbine wheel, couplers, bearing; not on the maker's 5862 pages):
//     https://www.full-race.com/precision-turbo-58mm-gen-2-pte-5862-cea-turbo
//     "Compressor Wheel Exducer: 76.2mm"; "Turbine Wheel Inducer: 71mm"; "Turbine Wheel Exducer: 61.9mm"; "Inlet: 4.0″ Hose Coupler";
//     "Outlet: 2.5" Hose Coupler (CCS)"; "Gen 2 Turbos are Ball Bearing CHRA only". Wastegate and flow: not stated (null).
//   Precision GEN2 PT6266 "HP Rating: 800", "62.0 MM" inducer, "Ported S" cover 4.0" inlet/2.5" outlet:
//     https://www.precisionturbo.com/p372178-turbochargers-street-race-gen-2-gen-2-pt6266-s-21104210149
//   Garrett GTX3076R GEN II "Horsepower: 400 - 750", 58/76 mm compressor, 60/55 mm turbine:
//     https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/gtx3076r-gen-ii/
//   Garrett G40-1150 "Horsepower: 500 - 1150", 71/88 mm, turbine 77/70 mm:
//     https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/g-series-g40-1150-71mm
//   BorgWarner EFR 8374 "475 - 750 HP Turbo", "Comp. Wheel Inducer Dia. (mm) 62", "Comp. Wheel Outer Dia. (mm) 83",
//     "Turbine Wheel Outer Dia. (mm) 74": https://www.turbozentrum.de/mediafiles/pdf/BorgWarner/bwts_performanceturbosgeneral_1880_2103.pdf
//   BorgWarner S300SX-R 64mm 13767105022 "400 to 950 HP", wheel O.D. 84.00, inducer 64.00, turbine O.D. 76.20, exducer 67.56:
//     https://borgwarner.com/aftermarket/boosting-technologies/performance-turbochargers/airwerks-series-turbochargers
//   No maker publishes a maximum compressor flow in text, so every row's flow is null; the comparison is tested on a synthetic row.
//   Mishimoto MMINT-UR 24 x 12 x 4 in core, 3 in inlet/outlet, "Maximum Recommended Horsepower" 1000:
//     https://www.mishimoto.com/mishimoto-universal-front-mount-intercooler-r-line.html
//   CSF 8045 25 x 12 x 3.5 in, HP Rating 1000: https://csfrace.com/product/intercooler-cores/
//   EJ Bowman EC120-4073-3, "Typical performance ... based on an air inlet temperature of 180ºC at 1.75 bar g and cooling water at
//     30ºC": charge air flow 2.5 kg/min, air pressure drop 2.1 kPa, air outlet 53.1 ºC, heat rejection 5.3 kW, water flow 30 l/min,
//     water pressure drop 4.0 kPa, typical engine power 50 kW:
//     https://lancingmarine.com/Uploaded/1/Documents/ProductData/Bowman/Charge-Air-Cooler-Brochure-G21.pdf
//   Garrett G25-660 350-660 hp, 54/67 mm compressor: https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/g-series-g25-660/
//   Garrett G30-770 475-770 hp, 58/71 mm: https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/g-series-g30-770
//   Garrett G35-900 550-900 hp, 62/76 mm: https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/g-series-G35-900
//   Garrett cores, "Supported Horsepower": https://www.garrettmotion.com/racing-and-performance/performance-catalog/intercoolers
//     703520-6009 air/air 500 hp, 24.0 x 6.4 x 3.5 in (610 x 163 x 89 mm); 717874-6008 air/liquid 750 hp, 3.8 x 3.7 x 11.7 in (97 x 95 x 297 mm)
//
// Flags (per turbo, one turbo), rows in library order: 5558 650, 5862 700, 6062 750, 6266 800, 6466 900 (top figure only: this page's
//   rule, far larger if the target is under half); G25-550 300-550, GTX2867R 275-550, G25-660 350-660, GTX3076R 400-750, G30-770 475-770,
//   GTX3582R 450-900, G35-900 550-900, G35-1050 700-1050, G40-1150 500-1150, G42-1200 475-1200, EFR 6758 250-500, EFR 7163 300-550,
//   EFR 8374 475-750, EFR 9180 600-1000, S200SX-R 300-775, S300SX-R 64 400-950, S300SX-R 68 500-1100 (maker's lower figure).
//   200 hp: every rating is over 400 (rule) or its lower figure over 200 -> all far larger.
//   450 hp: lower figures above 450: G30 475, G35-900 550, G35-1050 700, G40 500, G42 475, EFR 8374 475, 9180 600, S300SX-R 68 500 -> large.
//   800 hp: below: 5558, 5862, 6062, G25-550, GTX2867R, G25-660, GTX3076R, G30-770, EFR 6758, 7163, 8374, S200SX-R (775).
// Bowman EC120 point (cp 1004.675): Ch = 2.5/60 x cp = 41.86146 W/K, Cw = 30/60/1000 x 992 x 4183 = 2074.768 W/K, Cr 0.02017645;
//   Q = 41.86146 x (180 - 53.1) = 5312.219 W (the brochure: 5.3 kW); eps = 5312.219 / (41.86146 x 150) = 0.846;
//   NTU by bisection of the cross-flow relation = 1.902140, UA = 79.62634 W/K.
//   Prediction at 3.5 kg/min charge, 30 L/min water, 180 °C in, 30 °C water: UA held -> NTU 1.358671, eps 0.7367335, charge out 69.48998 °C.
//   UA scaled, all resistance on the charge side: 79.62634 x 1.4^0.4764 = 93.46998 W/K -> eps 0.7904729, charge out 61.42907 °C.
//   (independent script, not the page's code)
// Route A round trip (cp = 1.4 x 287.05 / 0.4 = 1004.675 J/kg K; lb/min = kg/s x 132.277):
//   UA 800 W/K, charge 30 lb/min (Ch 227.8565 W/K), air 45 lb/min (Cc 341.7847), Cr 0.666667, NTU 800 / 227.8565 = 3.51097,
//   eps = 1 - exp((1/Cr) NTU^0.22 (exp(-Cr NTU^0.78) - 1)) = 0.8064903; charge 150 -> 49.18871 °C with air in at 25 °C, Q 22970.50 W.
//   Inverted back: UA 800. Prediction at 40 lb/min charge, 60 lb/min air, 160 °C in, 30 °C air, UA held: eps 0.7550899,
//   Q 29822.36 W, charge out 61.83832 °C.
// Water-to-air loop: UA1 900, UA2 1200 W/K, charge 30 lb/min at 150 °C, water 20 L/min at 992 kg/m³ and 4183 J/kg K
//   (Cw 1383.179 W/K), front air 60 lb/min at 25 °C: e1 = eps1 Cmin1 = 217.9505 W/K, e2 = 387.0592 W/K;
//   Q = 125 / (1/217.9505 + 1/387.0592 - 1/1383.179) = 19383.42 W; a fixed-point iteration of the two exchangers
//   (independent script) gives the same 19383.42 W, coolant 61.0650 °C into the charge cooler, 75.0787 °C out, charge out 64.9314 °C.
//   Transient, 8 L of water (7.936 kg): b = e1 + e2 - e1 e2 / Cw = 543.98 W/K, tau = 7.936 x 4183 / 543.98 = 61.02 s,
//   90% after tau ln 10 = 140.5 s (a numerical integration at 0.01 s steps gives 140.5 s).
//   Soak, no front exchanger: 8 L x 0.992 x 4183 x 10 K / 20000 W = 16.60 s. Coolant flow for 20 kW at 10 K: 20000 / (4183 x 10)
//   = 0.478126 kg/s = 28.919 L/min (7.64 gpm).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, w, tol, m) => ok(Number.isFinite(a) && Math.abs(a - w) <= tol * Math.abs(w), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(7) : a) + ', hand ' + w);
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const TL = await pg.evaluate(() => window.__tso.TURBO_LIB);
  const row = re => TL.find(t => re.test(t.maker + ' ' + t.model)), i5862 = TL.findIndex(t => /5862/.test(t.model));
  const lib = TL[i5862];
  ok(TL.length === 22 && TL.every(t => /^https:\/\//.test(t.src) && t.seen === '2026-11-12' && t.flow === null && t.hp > 0), '22 turbo rows, each with a source URL and read date, no max flow published (' + TL.length + ')');
  ok(Math.min(...TL.map(t => t.hp)) === 500 && Math.max(...TL.map(t => t.hp)) === 1200, 'top ratings span 500 to 1200 hp per turbo');
  ok(/GEN2/.test(lib.model) && lib.hp === 700 && lib.cInd === 58 && lib.cExd === 76.2 && lib.tInd === 71 && lib.tExd === 61.9 && lib.inlet.d_in === 4.0 && lib.outlet.d_in === 2.5 && lib.wg === null &&
    /precisionturbo\.com/.test(lib.src) && /full-race\.com/.test(lib.src2) && /62mm/.test(lib.tWheel), 'Precision GEN2 5862: maker page for rating, inducer and turbine wheel, dealer for the rest, unknowns null');
  const p66 = row(/PT6266/), gtx = row(/GTX3076R/), g40 = row(/G40-1150/), e83 = row(/EFR 8374/), s64 = row(/S300SX-R 64/);
  ok(p66.hp === 800 && p66.hpLo === null && p66.cInd === 62 && p66.cExd === null && p66.inlet.d_in === 4.0 && p66.outlet.d_in === 2.5, 'PT6266 as the maker lists it');
  ok(gtx.hp === 750 && gtx.hpLo === 400 && gtx.cInd === 58 && gtx.cExd === 76 && gtx.tInd === 60 && gtx.tExd === 55 && gtx.inlet === null, 'GTX3076R GEN II 400-750 hp, 58/76, 60/55; no cover sizes');
  ok(g40.hp === 1150 && g40.hpLo === 500 && g40.cInd === 71 && g40.cExd === 88 && g40.tInd === 77 && g40.tExd === 70, 'G40-1150 500-1150 hp, 71/88, 77/70');
  ok(e83.hp === 750 && e83.hpLo === 475 && e83.cInd === 62 && e83.cExd === 83 && e83.tOD === 74 && e83.tInd === null, 'EFR 8374 475-750 hp, inducer 62, wheel OD 83, turbine OD 74');
  ok(s64.hp === 950 && s64.hpLo === 400 && s64.cInd === 64 && s64.cExd === 84 && s64.tOD === 76.2 && s64.tExd === 67.56, 'S300SX-R 64mm 400-950 hp, 64/84, turbine OD 76.20 exducer 67.56');
  // pure functions
  const f = await pg.evaluate(() => { const T = window.__tso, cp = 1.4 * 287.05 / 0.4, LB = 60 / 0.45359237;
    const Ch = 30 / LB * cp, Cc = 45 / LB * cp, P0 = T.icPredict({ UA: 800, Ch, Cc, thi: 150, tci: 25 });
    const A = T.icFromPoint({ Ch, Cc, thi: 150, tho: P0.tho, tci: 25 });
    const P1 = T.icPredict({ UA: A.UA, Ch: 40 / LB * cp, Cc: 60 / LB * cp, thi: 160, tci: 30 });
    const L = T.w2aLoop({ UA1: 900, UA2: 1200, Ch, Cw: 20 / 60 / 1000 * 992 * 4183, Ca: 60 / LB * cp, th: 150, ta: 25 });
    return { tho0: P0.tho, Q0: P0.Q, UA: A.UA, eps1: P1.eps, Q1: P1.Q, tho1: P1.tho, L }; });
  near(f.tho0, 49.18871, 1e-6, 'route A point: charge out at UA 800'); near(f.Q0, 22970.50, 1e-6, 'route A point: heat');
  near(f.UA, 800, 1e-6, 'route A round trip: UA recovered');
  near(f.eps1, 0.7550899, 1e-6, 'prediction at new flows: effectiveness'); near(f.Q1, 29822.36, 1e-6, 'prediction: heat'); near(f.tho1, 61.83832, 1e-6, 'prediction: charge out');
  near(f.L.Q, 19383.42, 1e-6, 'w2a loop heat against the iterative solve'); near(f.L.tw1, 61.0650, 1e-5, 'loop: coolant into the charge cooler'); near(f.L.tw2, 75.0787, 1e-5, 'loop: coolant out');
  near(f.L.tho, 64.9314, 1e-5, 'loop: charge out'); near(f.L.twSteady, 61.0650, 1e-5, 'transient steady state = loop solution');
  near(7.936 * 4183 / f.L.b * Math.LN10, 140.5, 2e-3, 'warm-up to 90%: tau ln 10 against the numerical integration');
  // the UI: a K24A2, turbo, 15 psi
  const set = (id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const setx = (k, v) => pg.evaluate(([k, v]) => { const e = document.querySelector('.tsox[data-k="' + k + '"]'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
  await set('i-ind', 'turbo'); await set('i-boost', '15'); await pg.waitForTimeout(300);
  const flags = async hp => { await set('i-hp', String(hp)); await pg.waitForTimeout(400); return pg.$$eval('#tso-turbos tbody tr', rs => rs.map(r => r.dataset.v)); };
  const C = 'covers', L = 'large', B = 'below';
  let v = await flags(200); ok(JSON.stringify(v) === JSON.stringify(Array(22).fill(L)), '200 hp: every listed turbo far larger (' + v + ')');
  const basis = await pg.$$eval('#tso-turbos tbody tr', rs => rs.map(r => r.dataset.basis));
  ok(JSON.stringify(basis) === JSON.stringify(['rule', 'rule', 'rule', 'rule', 'rule'].concat(Array(17).fill('maker'))), 'flag basis: Precision rows by this page’s rule of thumb, the rest by the maker’s lower figure');
  v = await flags(450); ok(JSON.stringify(v) === JSON.stringify([C, C, C, C, C, C, C, C, C, L, C, L, L, L, L, C, C, L, L, C, C, L]), '450 hp flags (' + v + ')');
  v = await flags(800); ok(JSON.stringify(v) === JSON.stringify([B, B, B, C, C, B, B, B, B, B, C, C, C, C, C, B, B, B, C, B, C, C]), '800 hp flags (' + v + ')');
  const cap = await pg.$eval('#tso-flag-cap', e => e.textContent);
  ok(/rule of thumb/.test(cap) && /not a sourced threshold/.test(cap) && /maker’s own lower figure/.test(cap), 'flag caption says which flags are sourced and which are this page’s rule');
  // flow comparison on a synthetic row (no maker publishes a flow): 800 hp x 12 x 0.55 / 60 = 88 lb/min = 0.665282 kg/s against 1.0 kg/s -> 67%
  await pg.evaluate(() => { const T = window.__tso.TURBO_LIB; T.push(Object.assign({}, T[0], { model: 'TEST ROW', flow: 1.0 })); });
  await set('i-hp', '800'); await pg.waitForTimeout(400);
  const fc = await pg.evaluate(() => [...document.querySelectorAll('#tso-turbos tbody tr')].pop().cells[5].innerText);
  await pg.evaluate(() => { window.__tso.TURBO_LIB.pop(); });
  ok(/67% of it/.test(fc) && /132\.3 lb\/min/.test(fc), 'flow comparison works where a max flow is given (synthetic row): ' + fc.replace(/\n/g, ' '));
  await set('i-hp', '450'); await pg.waitForTimeout(300);
  await setx('turbo', String(i5862)); await pg.waitForTimeout(400);
  const cid = await pg.evaluate(() => [document.getElementById('i-cid')._b, document.getElementById('i-cod')._b, document.getElementById('i-cid').value]);
  ok(Math.abs(cid[0] - 101.6) < 1e-9 && Math.abs(cid[1] - 63.5) < 1e-9, 'choosing the 5862 fills the compressor inlet 101.6 mm and outlet 63.5 mm (' + cid.join(', ') + ')');
  const tn = await pg.$eval('#tso-turbo-note', e => e.textContent);
  ok(/rated to support up to 700 horsepower/.test(tn) && /hose/.test(tn) && /dealer’s listing only/.test(tn) && /Full-Race \(dealer\)/.test(tn), 'turbo note: the rating as written, hose sizes, which figures are the dealer’s');
  const tt = await pg.$eval('#tso-turbos', e => e.innerText);
  ok(/2\.28 in \(58\.0 mm\)/.test(tt) && /101\.6 mm/.test(tt) && /522 kW/.test(tt), 'turbo table in inches and mm, hp and kW');
  // intercoolers: type filter, route B
  let ics = await pg.$$eval('#tso-ics tbody tr', rs => rs.map(r => r.cells[0].innerText.split('\n')[0]));
  ok(ics.length === 12 && ics.filter(x => /^Garrett 7035/.test(x)).length === 5 && ics.indexOf('Mishimoto MMINT-UR') >= 0 && ics.indexOf('CSF 8045') >= 0, 'air-to-air list: 5 Garrett, 2 Mishimoto, 5 CSF (' + ics.join(', ') + ')');
  const ur = await pg.evaluate(() => window.__tso.IC_LIB.find(c => c.pn === 'MMINT-UR')), c45 = await pg.evaluate(() => window.__tso.IC_LIB.find(c => c.pn === '8045'));
  ok(ur.hp === 1000 && ur.inD === 3 && ur.dims[0][0] === 24 && ur.dims[1][0] === 12 && ur.dims[2][0] === 4 && ur.dims[2][1] === 101.6 && ur.point === null, 'Mishimoto MMINT-UR 24 x 12 x 4 in (101.6 mm), 3 in tanks, 1000 hp, no thermal point');
  ok(c45.hp === 1000 && c45.dims.map(x => x[0]).join() === '25,12,3.5', 'CSF 8045 25 x 12 x 3.5 in, 1000 hp');
  const t1 = await pg.$eval('#tso-ics', e => e.innerText);
  ok(/610 × 163 × 89 mm/.test(t1) && /24\.0 in × 6\.4 in × 3\.5 in/.test(t1), '703520-6009 size in inches and mm as Garrett lists it');
  await setx('ic', '1'); await pg.waitForTimeout(400);
  const rb = await pg.$eval('#tso-routeb', e => e.textContent);
  ok(/gives no cooling capacity/.test(rb) && /nothing was filled in/.test(rb), 'route B: hp-only core says no capacity can be computed');
  await setx('ictype', 'w2a'); await pg.waitForTimeout(400);
  ics = await pg.$$eval('#tso-ics tbody tr', rs => rs.map(r => r.cells[0].innerText.split('\n')[0]));
  ok(ics.length === 14 && ics.indexOf('Garrett 717874-6008') >= 0 && ics.filter(x => /^EJ Bowman/.test(x)).length === 6, 'water-to-air list: 3 Garrett, 2 Mishimoto, 3 CSF, 6 Bowman (' + ics.join(', ') + ')');
  const t2 = await pg.$eval('#tso-ics', e => e.innerText);
  ok(/conflict/.test(t2) && /typical engine power 50 kW \(67 hp\)/.test(t2) && /¾ in BSP/.test(t2), 'w2a table: Mishimoto’s conflicting sizes said, Bowman kW rating, water ports');
  // route A on the page, water-to-air, with the loop
  for (const [k, x] of [['pm', '30'], ['pTi', '150'], ['pTo', '60'], ['pcf', '20'], ['pTc', '30'], ['wf', '20'], ['wTi', '35'], ['wdT', '10'], ['wV', '8'], ['ua2', '1200'], ['fa', '200']]) { await setx(k, x); await pg.waitForTimeout(150); }
  await pg.waitForTimeout(400);
  const g = await pg.evaluate(() => [...document.querySelectorAll('.sec')].find(s => s.dataset.sec === 'intercooler-options-and-cooling-capacity').innerText);
  ok(/At the point/.test(g) && /This core at this build, UA held/.test(g) && /Whole loop, steady state/.test(g) && /Coolant warm-up/.test(g) && /Soak time/.test(g) && /Front exchanger must reject/.test(g), 'water-to-air: point, prediction, loop, warm-up, soak and front-exchanger rows');
  ok(/gpm/.test(g) && /L\/min/.test(g) && /US gal/.test(g) && /BTU\/min/.test(g) && /kW/.test(g) && /°F/.test(g) && /°C/.test(g), 'dual units: gpm and L/min, US gal and L, BTU/min and kW, °F and °C');
  ok(/understates the capacity/.test(g), 'constant-UA caveat on the page');
  // a core with a published thermal point fills the capacity calculation: Bowman EC120
  const iEC = await pg.evaluate(() => window.__tso.IC_LIB.findIndex(c => c.pn === 'EC120-4073-3'));
  const ec = await pg.evaluate(i => window.__tso.IC_LIB[i], iEC);
  ok(ec.point.m_kgmin === 2.5 && ec.point.thi === 180 && ec.point.tho === 53.1 && ec.point.Q_kW === 5.3 && ec.point.cool_lpm === 30 && ec.point.tci === 30 && ec.dp.kPa === 2.1 && ec.point.wdp_kPa === 4.0 && ec.kw === 50 && /lancingmarine/.test(ec.src),
    'Bowman EC120 row holds the brochure’s point as printed');
  await setx('ic', String(iEC)); await pg.waitForTimeout(500);
  const tso = await pg.evaluate(() => Object.assign({}, window.__tso.TSO));
  ok(tso.pm === '5.511556555' && tso.pTi === '180' && tso.pTo === '53.1' && tso.pcf === '30' && tso.pTc === '30', 'picking EC120 fills the known point: 2.5 kg/min = 5.511556555 lb/min, 180 -> 53.1 °C, 30 L/min water at 30 °C');
  const g2 = await pg.evaluate(() => [...document.querySelectorAll('.sec')].find(s => s.dataset.sec === 'intercooler-options-and-cooling-capacity').innerText);
  ok(/filled from the maker’s typical-performance point/.test(g2) && /5\.3 kW/.test(g2) && /UA 80 W\/K/.test(g2) && /effectiveness 84\.6%/.test(g2), 'the page’s point row: 5.3 kW, effectiveness 84.6%, UA 80 W/K (hand 79.63)');
  ok(/This core at this build, UA held/.test(g2) && /With UA scaled for the charge flow/.test(g2) && /h ∝ ṁ0\.4764/.test(g2) && /300 ≤ Re ≤ 1500/.test(g2), 'prediction rows: UA held and the scaled range with its source and validity');
  const h2 = await pg.evaluate(() => { const T = window.__tso, cp = 1.4 * 287.05 / 0.4, P = T.IC_LIB.find(c => c.pn === 'EC120-4073-3').point, Cw = P.cool_lpm / 60 / 1000 * 992 * 4183;
    const A = T.icFromPoint({ Ch: P.m_kgmin / 60 * cp, Cc: Cw, thi: P.thi, tho: P.tho, tci: P.tci }), Ch2 = 3.5 / 60 * cp;
    const H = T.icPredict({ UA: A.UA, Ch: Ch2, Cc: Cw, thi: 180, tci: 30 }), S = T.icScaleUA({ UA: A.UA, mh0: 2.5, mh: 3.5 }), K = T.icPredict({ UA: S.chargeSide, Ch: Ch2, Cc: Cw, thi: 180, tci: 30 });
    return { Q: A.Q, ntu: A.ntu, UA: A.UA, thoH: H.tho, UAs: S.chargeSide, thoS: K.tho, exp: T.UA_EXP }; });
  near(h2.Q, 5312.219, 1e-6, 'EC120 point heat'); near(h2.ntu, 1.902140, 1e-5, 'EC120 point NTU'); near(h2.UA, 79.62634, 1e-5, 'EC120 UA');
  near(h2.thoH, 69.48998, 1e-6, 'EC120 at 3.5 kg/min, UA held: charge out'); near(h2.exp, 0.4764, 1e-12, 'UA exponent 1 - 0.5236');
  near(h2.UAs, 93.46998, 1e-6, 'scaled UA, all resistance on the charge side'); near(h2.thoS, 61.42907, 1e-6, 'scaled-UA bound: charge out');
  ok(!/\bNaN\b|undefined|Infinity/.test(g), 'intercooler section renders cleanly');
  await pg.setViewportSize({ width: 400, height: 900 }); await pg.waitForTimeout(400);
  const w = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(w[0] <= w[1] + 1, '400 px: no horizontal scroll (' + w.join(' / ') + ')');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'turbolib_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
