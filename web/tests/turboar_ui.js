// Turbine housing A/R in the turbo sizing (Intake tab, Turbo options; 2026-11-12, the owner's "Make sure to consider the
// turbo A/R").   node tests/turboar_ui.js   (from web/)
//
// Housings as the makers list them (read 2026-11-12):
//   Precision GEN2 PT5862, https://www.precisionturbo.com/p372175-turbochargers-street-race-gen-2-gen-2-pt5862-s-20730207239,
//     Details: "T3 .63 or .82 A/R with 4 bolt (2.5") discharge", "T3 .63 A/R with 5 bolt discharge (with or without wastegate
//     hole)", "T3 .63 or .82 A/R with 3" V-Band discharge", "T4 Tangential .58 or .68 A/R with 3 5/8" V-Band discharge",
//     "T4 Divided .84 A/R with 3 5/8" V-Band discharge", "V-Band inlet/outlet .64 or .82 A/R".
//   Garrett GTX3076R GEN II, https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/gtx3076r-gen-ii/:
//     T3 / V-band free float 0.63 (740902-0009), 0.82 (-0008), 1.06 (-0007); V-band / V-band free float 0.61 (-0036), 0.83
//     (-0035), 1.01 (-0034); T3 / 5-bolt internal 0.63, 0.82, 1.06 (771300-0006/-0005/-0004); all "Divided N".
//   Garrett G25-660, https://www.garrettmotion.com/racing-and-performance/performance-catalog/turbo/g-series-g25-660/:
//     0.49 T25 / V-band, 0.72 and 0.92 V-band / V-band, internal (877895-5002S/-5005S/-5006S) and free float 0.72 / 0.92.
//   Garrett G40-1150: "The largest 1.19 A/R T4 turbine housing flows 43 LBS/MIN of air" (no reference conditions).
//
// Verdict for a housing with a published flow, by hand (tab defaults, one turbo; turbine efficiency 75%, inlet 2 x boost,
//   outlet at atmosphere; burned gas at 950 °C gamma 1.279849, cp 1310.856 J/kg K; tools/validation/boost/thermo.py):
//   me = 0.4331842 x (1 + 1/12) = 0.4692829 kg/s; compressor work 31147.85 W; turbine share
//   x = 31147.85 / (0.75 x 0.4692829 x 1310.856 x 1223.15 x (1 - (101325/211641)^(0.27985/1.27985))) = 0.3710464,
//   so the turbine needs 0.1741257 kg/s; flow parameter of all the exhaust me sqrt(T3) / p3 = 0.4692829 x 34.9736 / 2.11641
//   = 7.754875 kg sqrt(K) / (s bar), of the part through the turbine 2.877418 (the sweep table's 2.877 at 75%).
//   Caps (maker's lb/min / 132.277): 10 lb/min = 0.0755987 kg/s < 0.1741 -> at its flow limit; 30 lb/min = 0.2267962 kg/s
//   -> the gate must bypass at least 1 - 0.2267962 / 0.4692829 = 51.67%; 70 lb/min = 0.5291911 > 0.4693 -> passes it all.
//   G40-1150 1.19 T4, 43 lb/min = 0.3250745 kg/s: at peak 1 - 0.3250745 / 0.4692829 = 30.73% round the gate.
// Measured pressure before the turbine at 8 psi boost (Bell: over 2.5 x too small, near 1 x race size; "near 1" read as
//   <= 1.25 x): 22 psi = 2.75 x -> one step up; from the 0.82 T3 / V-band housing, the next A/R on the same flange is 1.06;
//   9 psi = 1.125 x -> one step down, to 0.63 T3 / V-band; 18 psi = 2.25 x -> keep.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.abs(want), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(8) : a) + ', hand ' + (+want.toPrecision(8)));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const tso = (k, v) => pg.evaluate(([k, v]) => { const el = document.querySelector('select.tsox[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
  const sec = k => pg.$eval('#i-details .sec[data-sec="' + k + '"]', e => e.innerText).catch(() => '');
  await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(400); await setv('i-hp', '450'); await pg.waitForTimeout(300);
  const idx = m => pg.evaluate(m => window.__tso.TURBO_LIB.findIndex(t => t.model === m), m);

  // data, against the makers' lists
  const d = await pg.evaluate(() => { const L = window.__tso.TURBO_LIB, f = m => L.find(t => t.model.startsWith(m)).hs.map(h => [h.ar, h.flange, h.outlet, h.outletIn, h.divided, h.wg, h.pn]);
    return { p58: f('GEN2 PT5862'), gtx: f('GTX3076R'), g25: f('G25-660'), g40: L.find(t => t.model.startsWith('G40')).hs.filter(h => h.flow).map(h => [h.ar, h.flange, h.flow.v, h.flow.unit, h.flow.basis]), aw: L.filter(t => /AirWerks/.test(t.model)).map(t => t.hs.length) }; });
  ok(JSON.stringify(d.p58.map(h => [h[0], h[1], h[2], h[3], h[4]])) === JSON.stringify([[0.63, 'T3', '4-bolt', 2.5, false], [0.82, 'T3', '4-bolt', 2.5, false], [0.63, 'T3', '5-bolt (with or without wastegate hole)', null, false],
    [0.63, 'T3', 'V-band', 3, false], [0.82, 'T3', 'V-band', 3, false], [0.58, 'T4 tangential', 'V-band', 3.625, false], [0.68, 'T4 tangential', 'V-band', 3.625, false], [0.84, 'T4 divided', 'V-band', 3.625, true], [0.64, 'V-band', 'V-band', null, false], [0.82, 'V-band', 'V-band', null, false]]),
    'PT5862: ten housings exactly as Precision lists them');
  ok(d.gtx.length === 9 && d.gtx.filter(h => h[1] === 'V-band').map(h => h[0]).join() === '0.61,0.83,1.01' && d.gtx.every(h => h[4] === false) && d.gtx.filter(h => h[2] === '5-bolt').every(h => h[5] === 'internal' && /^771300/.test(h[6])),
    'GTX3076R GEN II: T3, V-band and 5-bolt housings, all undivided as Garrett lists them');
  ok(d.g25.map(h => h[0] + ' ' + h[1] + ' ' + h[5]).join('; ') === '0.49 T25 internal; 0.72 V-band internal; 0.92 V-band internal; 0.72 V-band free float (external); 0.92 V-band free float (external)', 'G25-660: 0.49 T25 and 0.72 / 0.92 V-band, internal and free float');
  ok(JSON.stringify(d.g40) === JSON.stringify([[1.19, 'T4 divided', 43, 'lb/min', 'unstated']]) && d.aw.every(n => n === 0), 'the only published housing flow: G40-1150 1.19 T4, 43 lb/min, basis unstated; AirWerks super-cores have none');

  // verdict logic, synthetic flows on the default build (hand values above)
  const v = await pg.evaluate(() => { const O = window.__tso, P = { ma: 0.43318420652130163, afr: 12, t1: 30, t2: 101.56982099150139, tit: 950, p3: 101325 + 2 * 55158, p4: 101325, eta: 0.75 }, pk = O.arDemand(P);
    const H = c => ({ ar: 1, flange: 'X', divided: false, flow: { v: c, unit: 'lb/min', basis: 'stated' } });
    return { pk, a: O.arFlowVerdict(H(10), pk, null), b: O.arFlowVerdict(H(30), pk, null), c: O.arFlowVerdict(H(70), pk, pk), none: O.arFlowVerdict({ ar: 1 }, pk, null) }; });
  near(v.pk.me, 0.4692829, 1e-6, 'exhaust per turbine, kg/s'); near(v.pk.x, 0.3710464, 1e-6, 'turbine share of it'); near(v.pk.need, 0.1741257, 1e-6, 'flow the turbine needs, kg/s');
  near(v.pk.FPall, 7.754875, 1e-6, 'flow parameter, all of the exhaust'); near(v.pk.FPneed, 2.877418, 1e-6, 'flow parameter through the turbine');
  ok(v.a.pk === 'limit' && v.b.pk === 'gate' && v.c.pk === 'all' && v.c.lo === 'all' && v.none === null, 'verdicts: 10 lb/min at its limit, 30 needs the gate, 70 passes it all, none without a flow');
  near(v.b.bypass, 0.5167176, 1e-6, '30 lb/min: least share round the gate'); near(v.b.cap, 0.2267962, 1e-6, '30 lb/min in kg/s');

  // the page: GTX3076R, ordering only (no published flow)
  await tso('turbo', String(await idx('GTX3076R GEN II'))); await pg.waitForTimeout(400);
  let t = await sec('turbo-options');
  ok(/0\.61\s+V-band\s+V-band\s+free float \(external\)\s+740902-0036\s+smallest A\/R listed: the response end/.test(t) && /1\.06\s+T3\s+V-band\s+free float \(external\)\s+740902-0007\s+largest A\/R listed: the top-end end/.test(t), 'ordering: 0.61 the response end, 1.06 the top-end end');
  ok(/No maker prints a turbine flow for these housings in text, so the page orders them by A\/R and does not size one/.test(t) && /63% goes round the gate/.test(t) && /at 3,500 RPM \(full boost\) it needs 35% of the exhaust/.test(t), 'the build tie: 63% round the gate at peak, 35% needed at 3,500 RPM, no invented capacity');
  ok(/tan α = 2π b ÷ \(A\/R\)/.test(t) && /600 whp and 400 lb-ft/.test(t) && /almost 6,000 RPM/.test(t) && /one engine, not a rule/.test(t), 'A/R caption: the volute relation, Garrett’s GTX3076R result as one engine');
  await tso('hs', '1'); await pg.waitForTimeout(400);
  const f = await pg.evaluate(() => [document.getElementById('i-tar')._b, document.getElementById('i-thsg').value]);
  ok(f[0] === 0.82 && /GTX3076R GEN II: 0\.82 A\/R, T3 inlet, V-band outlet/.test(f[1]), 'picking the 0.82 T3 housing sets the build’s A/R field and housing');
  const r = await sec('inlet-and-charge-pipes-design-and-sizing');
  ok(/Turbine housing\s+0\.82 A\/R\s+Garrett GTX3076R GEN II/.test(r) && /Turbine side, housing 0\.82 A\/R/.test(r), 'the A/R in the route summary and on the drawing');
  t = await sec('where-to-put-them-on-this-build'); ok(/from the turbine flange \(T3, the picked housing\)/.test(t) && /Downpipe start\s+the picked housing’s V-band outlet, size not stated by the maker/.test(t), 'placement: the housing’s flange and outlet');
  const snap = await pg.evaluate(() => { const s = window.__proj.snapshot('x'); return [s.vals['i-tar'], s.vals['i-thsg'], s.vals['i-p3m']]; });
  ok(snap[0] && snap[0].b === 0.82 && snap[1] && /0\.82 A\/R, T3/.test(snap[1].v) && snap[2], 'A/R, housing and measured pressure are saved with the project');

  // measured pressure before the turbine: one step up / down / keep
  await setv('i-p3m', '22'); await pg.waitForTimeout(400); t = await sec('turbo-options');
  ok(/22\.00 psi \(151\.7 kPa\) gauge, 2\.75 × boost/.test(t) && /above Bell’s 2\.5 × boost/.test(t) && /one A\/R step up on this turbo’s list: 1\.06 A\/R \(T3\)/.test(t), 'measured 2.75 x boost: one step up, 0.82 -> 1.06 on the T3 flange');
  let w = await sec('where-to-put-them-on-this-build'); ok(/your measured one, 2\.75 × the boost/.test(w), 'the measured ratio replaces the assumed multiple in the gate sizing');
  await setv('i-p3m', '9'); await pg.waitForTimeout(400); t = await sec('turbo-options');
  ok(/1\.13 × boost/.test(t) && /near 1 × boost/.test(t) && /one A\/R step down on this turbo’s list: 0\.63 A\/R \(T3\)/.test(t), 'measured 1.125 x: one step down to 0.63 T3');
  await setv('i-p3m', '18'); await pg.waitForTimeout(400); t = await sec('turbo-options'); ok(/inside Bell’s range/.test(t) && /keep the 0\.82 A\/R/.test(t), 'measured 2.25 x: keep');
  await setv('i-p3m', ''); await pg.waitForTimeout(300);

  // divided housing against the manifold
  await tso('turbo', String(await idx('G40-1150 (71 mm, 2.80 in, inducer)'))); await pg.waitForTimeout(300);
  const g40 = await pg.evaluate(() => window.__tso.TURBO_LIB.find(t => t.model.startsWith('G40')).hs.findIndex(h => h.flow));
  await tso('hs', String(g40)); await setv('i-mani', 'tube'); await pg.waitForTimeout(400); t = await sec('turbo-options');
  ok(/maker’s flow 43\.0 lb\/min \(0\.325 kg\/s\): at peak needs the gate to bypass at least 31%/.test(t) && /indicative: the maker states no reference conditions/.test(t), 'G40-1150 1.19 T4: 43 lb/min, at least 31% round the gate at peak (indicative)');
  ok(/a divided \(twin-scroll\) housing needs a divided manifold/.test(t), 'divided housing on a tubular manifold: warned');
  await setv('i-mani', 'div'); await pg.waitForTimeout(400); t = await sec('turbo-options'); ok(!/housing needs a divided manifold, cylinders/.test(t), 'divided housing on a divided manifold: no warning');
  await tso('hs', '0'); await pg.waitForTimeout(400); t = await sec('turbo-options'); ok(/an undivided housing on a divided manifold joins the scrolls/.test(t), 'undivided housing on a divided manifold: the pulse separation is lost');
  await setv('i-mani', 'tube');
  // dual units on the housing outlet sizes
  await tso('turbo', String(await idx('GEN2 PT5862 CEA® (Gen 2 5862, ball bearing)'))); await pg.waitForTimeout(400); t = await sec('turbo-options');
  ok(/T4 divided\s+V-band 3\.625 in \(92\.1 mm\) OD/.test(t) && /4-bolt 2\.5 in \(63\.5 mm\) discharge/.test(t), 'outlet sizes in inches and mm');
  ok(!/NaN|undefined/.test(t), 'no NaN or undefined in Turbo options');
  t = await pg.$eval('#i-details .sec[data-sec="turbine-housing-a-r"]', e => e.innerText).catch(() => '');
  ok(/the radius from the turbo centerline to the centroid of that area/.test(t) && /0\.83 → 1\.01 A\/R/.test(t) && !/lecture deck/.test(t), 'Turbine housing A/R section: Garrett’s own definition and result, no second-hand citation');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'turboar_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
