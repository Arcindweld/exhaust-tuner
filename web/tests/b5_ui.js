// Books batch 5 UI check: Vizard Fig. 5-8 and Smith rule (4-Stroke, Headers), Tri-Y averages (Headers), rotary port-timing card (Headers),
// surge check / density / boost chart / A/R / Olmeda (Intake, boosted), head and valve rules and the IVC hint (4-Stroke), runner families (Intake), Method notes.
// node b5_ui.js [page.html]   (default exhaust-calculator.b5base.html in the current directory)
const { chromium } = require('playwright');
const path = require('path');
const file = path.resolve(process.argv[2] || 'exhaust-calculator.b5base.html');
(async () => { const b = await chromium.launch(); const fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); console.log((c?'PASS ':'FAIL ')+m); };
  const badText = t => (t.match(/.{0,40}(\bNaN\b|\bundefined\b|\[object|Infinity).{0,40}/) || [null])[0];
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
  const pg = await b.newPage({ viewport: vp }); const errs=[]; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + file);
  await pg.waitForTimeout(600);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const txt = sel => pg.$eval(sel, el => el.innerText);
  const go = async h => { await pg.evaluate(h => { location.hash = h; }, h); await pg.waitForTimeout(400); };
  await pg.evaluate(() => { document.body.classList.remove('simple'); document.body.classList.add('expert'); });
  // ---- math hooks
  const mth = await pg.evaluate(() => { const T = window.__b5Test; if(!T) return null;
    const a = T.surgeCheck(400, 2.35), bb = T.surgeCheck(490, 2.35), v1 = T.vizardPrimary(5500), v2 = T.vizardPrimary(9500), v3 = T.vizardPrimary(6500), v4 = T.vizardPrimary(4000);
    const u10 = T.rotaryEvents(T.ROT_PORTS[0]), u5 = T.rotaryEvents(T.ROT_PORTS[1]), d = T.densRatio(2, 0.7, 0), di = T.densRatio(2, 0.7, 0.7), b100 = T.boostAtCR(T.VIZ_BOOST[2][1], 8), b95 = T.boostAtCR(T.VIZ_BOOST[0][1], 8.3), bOut = T.boostAtCR(T.VIZ_BOOST[0][1], 13);
    const sm = T.smithPipe(280, 3.03 * 25.4, 3.575 * 25.4, 1.42 * 25.4), bs = T.boreStroke(2000, 4, 0, 0), mi = T.machIndex({ B: 0.103, S: 0.0859, rpm: 6500, dIn: 0.0453, nIn: 1, cf: 0.45, ci: 343 });
    return { a, bb, v1, v2, v3, v4, u10, u5, d, di, b100, b95, bOut, sm, bs, mi, hp: T.vizardHeadHp(150 * 1.058, 4) }; });
  ok(!!mth, vp.n + ': window.__b5Test exposed');
  if (mth) {
    ok(mth.a.inSurge === true && Math.abs(mth.a.surgeCfm - 430) < 1, vp.n + ': Vizard point A (400 cfm, PR 2.35) is in surge, line at ' + mth.a.surgeCfm.toFixed(0) + ' cfm');
    ok(mth.bb.inSurge === false && mth.bb.island === 75 && mth.bb.margin > 0.1, vp.n + ': point B (490 cfm) clear of surge in the 75% island (margin ' + (mth.bb.margin * 100).toFixed(0) + '%)');
    ok(Math.abs(mth.v1.len / 25.4 - 33.5) < 1e-9 && mth.v1.dyno === true && Math.abs(mth.v2.len / 25.4 - 22) < 1e-9 && mth.v2.dyno === false && Math.abs(mth.v3.len / 25.4 - 31 - (29 - 31) * 100 / 600) < 1e-6 && mth.v4.len === null, vp.n + ': Vizard Fig. 5-8 ends, interpolation and out-of-range');
    ok(Math.abs(mth.u10.c.ovl - 111) < 0.5 && Math.abs(mth.u10.c.ipo - 65) < 0.5 && Math.abs(mth.u10.c.epc - 46) < 0.5 && Math.abs(mth.u5.c.ovl - 10) < 0.5 && Math.abs(mth.u5.c.ipo + 29) < 0.5 && Math.abs(mth.u5.c.inDur - 171) < 1, vp.n + ': RC2-60 U10/U5 crank-equivalent events (overlap 111 / 10, IPO 65 BTDC / 29 ATDC)');
    ok(Math.abs(mth.d.noIC - 1.52) < 0.03 && Math.abs(mth.di.ic - 1.82) < 0.04, vp.n + ': Stone density ratio at PR 2, η 0.7: ' + mth.d.noIC.toFixed(2) + ' / intercooled ' + mth.di.ic.toFixed(2));
    ok(Math.abs(mth.b100 - 9.5) < 1e-9 && Math.abs(mth.b95 - 2.9) < 0.01 && mth.bOut === null, vp.n + ': Vizard boost chart: 9.5 psi at 8:1 on 100 RON, 2.9 at 8.3:1 on 95, null outside');
    ok(Math.abs(mth.sm / 25.4 - 46) < 1, vp.n + ': Smith formula gives 46 in for the Ford 2.0 (' + (mth.sm / 25.4).toFixed(1) + ' in)');
    ok(mth.bs.est && Math.abs(mth.bs.B / mth.bs.S - 1.2) < 1e-9 && Math.abs(Math.PI / 4 * mth.bs.B ** 2 * mth.bs.S / 1000 - 500) < 0.5, vp.n + ': bore/stroke estimate keeps the displacement');
    ok(mth.mi.Z > 0.55 && mth.mi.Z < 0.7 && Math.abs(mth.mi.rpm06 * mth.mi.Z / 0.6 - 6500) < 1, vp.n + ': Mach index on a 103 × 86 mm cylinder at 6,500 is ' + mth.mi.Z.toFixed(2));
    ok(Math.abs(mth.hp - 157.4) < 0.5, vp.n + ': Vizard head-flow rule: 150 cfm at 25 in on a four = ' + mth.hp.toFixed(0) + ' bhp');
  }
  // ---- 4-Stroke tab
  await go('four-stroke');
  let f = await txt('#four-details');
  ok(/Other published primary lengths/i.test(f) && /Vizard’s dyno curve, 2 L four, at 6,500 RPM/.test(f) && /between his dyno points/.test(f) && /His primary ID band at that RPM/.test(f), vp.n + ': 4-Stroke shows the Vizard comparison row at 6,500 RPM');
  ok(/Smith’s 1950s open-pipe rule/.test(f) && /no rpm term/.test(f) && /upper bound/.test(f), vp.n + ': Smith rule shown as an upper bound');
  ok(/Esslinger dyno test/.test(f) && /\+8 to 10 hp/.test(f) && /extrapolated/.test(f), vp.n + ': caption carries the Esslinger A/B result and marks extrapolated points');
  ok(/Head and valve rules \(Taylor, Stone, Vizard\)/i.test(f) && /Taylor’s valve sizes for a flat head, two valves/.test(f) && /Taylor’s Mach index Z/.test(f) && /RPM where Z reaches 0\.6/.test(f) && /Vizard’s head-flow rule/.test(f) && /0\.45/.test(f) && /0\.58/.test(f), vp.n + ': head and valve rules with the Cf table');
  ok(!badText(f), vp.n + ': 4-Stroke details have no NaN/undefined' + (badText(f) ? ' -> ' + badText(f) : ''));
  await setv('f-rpm', '9500'); await pg.waitForTimeout(250);
  f = await txt('#four-details');
  ok(/at 9,500 RPM/.test(f) && /\(extrapolated\)/.test(f) && /beyond his last dyno point/.test(f) && !badText(f), vp.n + ': 9,500 RPM uses the extrapolated end of the curve');
  await setv('f-rpm', '4000'); await pg.waitForTimeout(250);
  f = await txt('#four-details');
  ok(/no figure: his chart runs 5,500 to 9,500 RPM/.test(f) && !badText(f), vp.n + ': 4,000 RPM says the chart does not reach');
  await setv('f-rpm', '6500');
  await setv('f-valves', '4'); await pg.waitForTimeout(250);
  f = await txt('#four-details');
  ok(/four valves/.test(f) && /two .* intake \(0\.33 × bore\)/.test(f) && !badText(f), vp.n + ': four-valve Taylor fractions');
  await setv('f-valves', '2');
  await setv('f-ivo', '30'); await setv('f-ivc', '70'); await setv('f-evc', '30'); await pg.waitForTimeout(250);
  const hint = await txt('#f-cam-hint');
  ok(/Stone’s VE-against-closing chart puts the best intake closing near \d+° ABDC/.test(hint) && /your cam closes at 70°/.test(hint) && !badText(hint), vp.n + ': IVC rule beside the cam card');
  await setv('f-ivo', ''); await setv('f-ivc', ''); await setv('f-evc', ''); await pg.waitForTimeout(200);
  // ---- Headers tab
  await setv('h-eng', 'sbc'); await setv('h-grp', 'bank'); await setv('h-merge', 'direct'); await go('headers');
  let h = await txt('#h-details');
  ok(/Other published primary lengths/i.test(h) && /Vizard’s dyno curve/.test(h) && /Smith’s 1950s open-pipe rule/.test(h) && /estimated from the displacement/.test(h) && !/Tri-Y/.test(h.split(/other published primary lengths/i)[1].split(/sections along one runner/i)[0]), vp.n + ': Headers shows Vizard and Smith, no Tri-Y rows on a direct collector');
  await setv('h-merge', 'triy'); await pg.waitForTimeout(300);
  h = await txt('#h-details');
  ok(/Smith’s “good average” Tri-Y/.test(h) && /18\.0 in \(457 mm\) to the first junction, 24\.0 in \(610 mm\) on to the second|457 mm \(18\.0 in\) to the first junction/.test(h) && /Stone’s four-cylinder example, 1-3-4-2/.test(h) && !badText(h), vp.n + ': Tri-Y averages from Smith and Stone beside the first-section result');
  await setv('h-merge', 'direct');
  await setv('h-eng', 'r2'); await pg.waitForTimeout(300);
  h = await txt('#h-details');
  ok(/Port timing: what a rotary’s “cam” looks like/i.test(h) && /× 2\/3/.test(h) && /one per rotor per shaft turn/.test(h) && /Sound tab/.test(h), vp.n + ': rotary port-timing card with the 2/3 rule and the pulse statement');
  ok(/65° BTDC/.test(h) && /20° ABDC/.test(h) && /37° BBDC/.test(h) && /46° ATDC/.test(h) && /111°/.test(h) && /29° ATDC/.test(h) && /10°/.test(h), vp.n + ': U10 and U5 crank-equivalent events in the table');
  ok(/\+20 to 30% peak power/.test(h) && /high-overlap piston engine/.test(h) && /separate silencer train per rotor/.test(h) && /1,700 to 1,900 °F/.test(h) && /Side ports cannot overlap/.test(h), vp.n + ': peripheral vs side, NSU silencers, reactor temperatures');
  ok(!badText(h), vp.n + ': rotary details have no NaN/undefined' + (badText(h) ? ' -> ' + badText(h) : ''));
  await setv('h-eng', 'r3'); await pg.waitForTimeout(250); h = await txt('#h-details');
  ok(/Port timing/i.test(h) && !badText(h), vp.n + ': three-rotor engine also gets the card');
  await setv('h-eng', 'sbc'); await pg.waitForTimeout(200);
  // ---- Intake tab, boosted
  await go('intake');
  let it = await txt('#i-details');
  ok(/Heywood’s single-runner family at/.test(it) && /Smith’s Jaguar XK trumpets at/.test(it) && /780 mm peaked at 3,200/.test(it) && !badText(it), vp.n + ': runner-length families on the naturally aspirated intake');
  ok(!/Compressor surge check/i.test(it) && !/Boost against compression ratio/i.test(it), vp.n + ': no boosted sections while naturally aspirated');
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(400);
  it = await txt('#i-details');
  ok(/Compressor surge check, on one map/i.test(it) && /Engine demand, the tab’s airflow/.test(it) && /Corrected for the charge temperature/.test(it) && /TO4B V-1/.test(it) && /point A, 400 cfm/.test(it) && /306 bhp/.test(it), vp.n + ': surge check with Vizard’s example');
  const dots = await pg.$$eval('#i-b5map circle', c => c.length), poly = await pg.$$eval('#i-b5map polyline', c => c.length);
  ok(dots === 4 && poly >= 1, vp.n + ': compressor map drawn (' + dots + ' points, ' + poly + ' surge line)');
  ok(/Charge density after the compressor \(Stone\)/i.test(it) && /Density ratio, no intercooler/.test(it) && /With the intercooler at \d+% effectiveness/.test(it) && /1\.55 at 0\.7/.test(it), vp.n + ': Stone density ratio rows with the chart check');
  ok(/Boost against compression ratio and octane \(Vizard, 1983\)/i.test(it) && /100 RON/.test(it) && /One grade of discrepancy/.test(it) && /Boost at 10\.0:1/i.test(it), vp.n + ': boost-CR-octane table marked 1983 with the discrepancy note');
  ok(/Turbine housing A\/R/i.test(it) && /0\.96 on a V-1/.test(it) && /one or two housing sizes smaller/.test(it), vp.n + ': A/R rules on the turbo');
  ok(/Heat into the turbine case/.test(it) && /45% of the available exhaust energy/.test(it) && /Olmeda, Dolz, Arnau and Reyes-Belmonte/.test(it), vp.n + ': Olmeda note in the turbo section');
  ok(!badText(it), vp.n + ': boosted intake details have no NaN/undefined' + (badText(it) ? ' -> ' + badText(it) : ''));
  const sum = await pg.evaluate(() => { const T = window.__b5Test; const t = document.getElementById('i-details').innerText; const m = t.match(/Engine demand, the tab’s airflow\n(\d+) cfm at PR ([\d.]+)/); return m ? { cfm: +m[1], pr: +m[2] } : null; });
  ok(sum && sum.cfm > 0 && sum.pr > 1, vp.n + ': demand point read back (' + JSON.stringify(sum) + ')');
  await setv('i-boost', '25'); await pg.waitForTimeout(300); it = await txt('#i-details');
  ok(/above it\)/.test(it) && !badText(it), vp.n + ': 25 psi flagged above the chart’s allowance');
  await setv('i-boost', '8'); await setv('i-cr', '20'); await pg.waitForTimeout(300); it = await txt('#i-details');
  ok(/Boost at 20\.0:1/i.test(it) && /—/.test(it) && !badText(it), vp.n + ': CR outside the chart shows a dash, no crash');
  await setv('i-cr', '10');
  await setv('i-ind', 'centri'); await pg.waitForTimeout(300); it = await txt('#i-details');
  ok(/Compressor surge check/i.test(it) && !/Turbine housing A\/R/i.test(it) && !badText(it), vp.n + ': centrifugal gets the surge check but no A/R');
  await setv('i-ind', 'pd'); await pg.waitForTimeout(300); it = await txt('#i-details');
  ok(!/Compressor surge check/i.test(it) && /Charge density after the compressor/i.test(it) && !/With the intercooler/.test(it) && /Boost against compression ratio/i.test(it) && !badText(it), vp.n + ': Roots gets density and the boost table, no surge map');
  await setv('i-ind', 'na'); await pg.waitForTimeout(200);
  // ---- Method
  const meth = await pg.$eval('details.method', el => el.textContent);
  ok(/Norbye, The Wankel Engine \(1971\)\./.test(meth) && /Smith and Wenner, The Design and Tuning of Competition Engines, 6th ed\. \(1977\)\./.test(meth) && /Vizard, How to Modify Ford S\.O\.H\.C\. Engines \(1983\), chapters 2, 3, 11 and 14/.test(meth) && /Rohrauer, “Induction and Exhaust” lecture deck/.test(meth) && /Mathematical and Computer Modelling 57 \(2013\), the engine papers\./.test(meth), vp.n + ': five Method notes present');
  ok(/backwards for gas pressure waves/.test(meth) && /critical pressure ratio of about 3/.test(meth) && /no rpm term/.test(meth) && /110 to 115%/.test(meth) && /one octane grade/.test(meth) && /6\.7 bhp/.test(meth) && /text layer/.test(meth), vp.n + ': rejected claims and corrections named');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), vp.n + ': no sideways scroll');
  ok(errs.length===0, vp.n + ': no page errors '+errs.join('|')); await pg.close(); }
  console.log(fails.length?'FAILED: '+fails.length:'all passed'); await b.close(); })();
