// Turbo options and intercooler options / cooling capacity (Intake tab, 2026-11-12).   node tests/turbolib_ui.js   (from web/)
//
// Sourced rows (read 2026-11-12):
//   Precision GEN2 PT5862 CEA, dealer listing of the maker's product (precisionturbo.net could not be fetched):
//     https://www.full-race.com/precision-turbo-58mm-gen-2-pte-5862-cea-turbo
//     "rated to support up to 700 horsepower"; "Compressor Wheel Inducer: 58mm"; "Compressor Wheel Exducer: 76.2mm";
//     "Turbine Wheel Inducer: 71mm"; "Turbine Wheel Exducer: 61.9mm"; "Inlet: 4.0″ Hose Coupler"; "Outlet: 2.5" Hose Coupler (CCS)";
//     "Gen 2 Turbos are Ball Bearing CHRA only". Wastegate and flow: not stated (null).
//   Garrett G25-660 350-660 hp, 54/67 mm compressor: https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/g-series-g25-660/
//   Garrett G30-770 475-770 hp, 58/71 mm: https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/g-series-g30-770
//   Garrett G35-900 550-900 hp, 62/76 mm: https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/g-series-G35-900
//   Garrett cores, "Supported Horsepower": https://www.garrettmotion.com/racing-and-performance/performance-catalog/intercoolers
//     703520-6009 air/air 500 hp, 24.0 x 6.4 x 3.5 in (610 x 163 x 89 mm); 717874-6008 air/liquid 750 hp, 3.8 x 3.7 x 11.7 in (97 x 95 x 297 mm)
//
// Flags (per turbo, one turbo): 200 hp target: 5862 rated 700 > 2 x 200 -> far larger; G25 lower figure 350 > 200 -> far larger.
//   450 hp: 5862 700 >= 450 and 450 >= 350 -> covers; G25 350 <= 450 <= 660 -> covers; G30 450 < 475 -> far larger.
//   800 hp: 5862 700 < 800 -> below; G25, G30 below; G35 550 <= 800 <= 900 -> covers.
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
  const lib = await pg.evaluate(() => window.__tso.TURBO_LIB[0]);
  ok(/5862/.test(lib.model) && /GEN2/.test(lib.model) && lib.hp === 700 && lib.cInd === 58 && lib.cExd === 76.2 && lib.tInd === 71 && lib.tExd === 61.9 && lib.inlet.d_in === 4.0 && lib.outlet.d_in === 2.5 && lib.wg === null && lib.flow === null &&
    /full-race\.com/.test(lib.src), 'Precision GEN2 5862 is the first row with the dealer-quoted figures, unknowns null');
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
  let v = await flags(200); ok(JSON.stringify(v) === JSON.stringify(['large', 'large', 'large', 'large']), '200 hp: every listed turbo far larger (' + v + ')');
  v = await flags(450); ok(JSON.stringify(v) === JSON.stringify(['covers', 'covers', 'large', 'large']), '450 hp: 5862 and G25 cover, G30 and G35 far larger (' + v + ')');
  v = await flags(800); ok(JSON.stringify(v) === JSON.stringify(['below', 'below', 'below', 'covers']), '800 hp: only the G35 covers (' + v + ')');
  await set('i-hp', '450'); await pg.waitForTimeout(300);
  await setx('turbo', '0'); await pg.waitForTimeout(400);
  const cid = await pg.evaluate(() => [document.getElementById('i-cid')._b, document.getElementById('i-cod')._b, document.getElementById('i-cid').value]);
  ok(Math.abs(cid[0] - 101.6) < 1e-9 && Math.abs(cid[1] - 63.5) < 1e-9, 'choosing the 5862 fills the compressor inlet 101.6 mm and outlet 63.5 mm (' + cid.join(', ') + ')');
  const tn = await pg.$eval('#tso-turbo-note', e => e.textContent);
  ok(/rated to support up to 700 horsepower/.test(tn) && /hose/.test(tn) && /could not be fetched/.test(tn), 'turbo note: the rating as written, hose sizes, the source caveat');
  const tt = await pg.$eval('#tso-turbos', e => e.innerText);
  ok(/2\.28 in \(58\.0 mm\)/.test(tt) && /101\.6 mm/.test(tt) && /522 kW/.test(tt), 'turbo table in inches and mm, hp and kW');
  // intercoolers: type filter, route B
  let ics = await pg.$$eval('#tso-ics tbody tr', rs => rs.map(r => r.cells[0].innerText.split('\n')[0]));
  ok(ics.length === 5 && ics.every(x => /^Garrett 70352|^Garrett 703518/.test(x)), 'air-to-air list: five Garrett cores (' + ics.join(', ') + ')');
  const t1 = await pg.$eval('#tso-ics', e => e.innerText);
  ok(/610 × 163 × 89 mm/.test(t1) && /24\.0 in × 6\.4 in × 3\.5 in/.test(t1), '703520-6009 size in inches and mm as Garrett lists it');
  await setx('ic', '1'); await pg.waitForTimeout(400);
  const rb = await pg.$eval('#tso-routeb', e => e.textContent);
  ok(/gives no cooling capacity/.test(rb) && /nothing was filled in/.test(rb), 'route B: hp-only core says no capacity can be computed');
  await setx('ictype', 'w2a'); await pg.waitForTimeout(400);
  ics = await pg.$$eval('#tso-ics tbody tr', rs => rs.map(r => r.cells[0].innerText.split('\n')[0]));
  ok(ics.length === 3 && ics.indexOf('Garrett 717874-6008') >= 0, 'water-to-air list: three air/liquid cores (' + ics.join(', ') + ')');
  // route A on the page, water-to-air, with the loop
  for (const [k, x] of [['pm', '30'], ['pTi', '150'], ['pTo', '60'], ['pcf', '20'], ['pTc', '30'], ['wf', '20'], ['wTi', '35'], ['wdT', '10'], ['wV', '8'], ['ua2', '1200'], ['fa', '200']]) { await setx(k, x); await pg.waitForTimeout(150); }
  await pg.waitForTimeout(400);
  const g = await pg.evaluate(() => [...document.querySelectorAll('.sec')].find(s => s.dataset.sec === 'intercooler-options-and-cooling-capacity').innerText);
  ok(/At the point/.test(g) && /This core at this build, UA held/.test(g) && /Whole loop, steady state/.test(g) && /Coolant warm-up/.test(g) && /Soak time/.test(g) && /Front exchanger must reject/.test(g), 'water-to-air: point, prediction, loop, warm-up, soak and front-exchanger rows');
  ok(/gpm/.test(g) && /L\/min/.test(g) && /US gal/.test(g) && /BTU\/min/.test(g) && /kW/.test(g) && /°F/.test(g) && /°C/.test(g), 'dual units: gpm and L/min, US gal and L, BTU/min and kW, °F and °C');
  ok(/understates the capacity/.test(g), 'constant-UA caveat on the page');
  ok(!/\bNaN\b|undefined|Infinity/.test(g), 'intercooler section renders cleanly');
  await pg.setViewportSize({ width: 400, height: 900 }); await pg.waitForTimeout(400);
  const w = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(w[0] <= w[1] + 1, '400 px: no horizontal scroll (' + w.join(' / ') + ')');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'turbolib_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
