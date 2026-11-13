// Boost audit 2026-11-12 (docs/BOOST_AUDIT_2026-11-12.md): one check per fix, each pinned to an independent value.
// node tests/boostaudit_ui.js   (from web/)
//
// Independent values (tools/validation/boost/, none ported from the page):
//  B9  cross-flow, both unmixed, exact series (thermo.py eps_exact, Mason / Kays & London; python-ht 'crossflow' agrees
//      to 1e-15): eps(NTU 6, Cr 1) = 0.7721094795; NTU for eps 0.77 at Cr 1 = 5.888005 (the old closed form: 0.7671166 and
//      6.189259, 5.1 % high). Large NTU: eps(800, 0.5) -> 1 (closed form above NTU 500).
//  B13 back pressure after the turbine 2 psi (13789.514 Pa), eta 0.75, p3 = 101325 + 2 x 55158 Pa, T3 1223.15 K,
//      burned-gas gamma 1.279849 / cp 1310.856 (GRI-Mech 3.0 via Cantera gri30.yaml): turbine share
//      Wc / (eta me cp T3 (1 - (p4/p3)^k)) = 0.4427248, gate 0.5572752 of 0.4692829 kg/s = 0.2615197 kg/s; p4/p3 0.5439 is
//      under the critical 0.5494, choked: Cd A = 1102.559 mm² (thermo.py bp_case).
//  B15 curtain area pi D L (Kirkpatrick, Colorado State, "Intake Flow"): the default gate's 1244.373 mm² through a 40 mm
//      valve needs L = 1244.373 / (pi x 40) = 9.902 mm at Cd 1; 38 mm seat 1134.1 mm² < 1244.4: short even fully open.
//      Blow-off valve 1255.089 mm² on a 50 mm valve: 7.990 mm.
//  B19 Charge pipes in both units: 429 ft/s = 131 m/s (Garrett method, defaults); 2.11 psi = 14.5 kPa.
//  B23 a 200 mm hot side with 2 x 90 deg bends at 1.5 x 60.198 mm: arcs 2 x pi/2 x 90.297 = 283.7 mm > 200 mm.
//  Zero gate flow: k 0.5, eta 0.55: the turbine needs share x = 0.0591372 x (0.70/0.55) / (1 - (101325/128904)^k) > 1.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.abs(want), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(8) : a) + ', independent ' + (+want.toPrecision(8)));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  // pg.$eval / pg.$$eval read in one call after the page has stopped re-rendering (tests/settle.js; audit F1)
  require('./settle').reads(pg);
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const sec = k => pg.$eval('#i-details .sec[data-sec="' + k + '"]', e => e.innerText).catch(() => '');
  await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(500);

  // B9: exact cross-flow series
  const x = await pg.evaluate(() => { const T = window.__turbo; return { e6: T.epsXflow(6, 1), n77: T.ntuFor(0.77, 1), big: T.epsXflow(800, 0.5), z: T.epsXflow(0, 0.5), c0: T.epsXflow(2, 0) }; });
  near(x.e6, 0.7721094795, 1e-9, 'B9 eps at NTU 6, Cr 1 (exact series)'); near(x.n77, 5.888005, 1e-6, 'B9 NTU for eps 0.77, Cr 1');
  ok(x.big > 0.9999999 && x.big <= 1 && x.z === 0 && Math.abs(x.c0 - (1 - Math.exp(-2))) < 1e-15, 'B9 limits: NTU 800 -> 1, NTU 0 -> 0, Cr 0 -> 1 - e^-NTU');

  // B13: back pressure after the turbine
  let t = await sec('turbo-and-intercooler-sizing');
  ok(/no back pressure after the turbine entered/.test(t), 'B13 default: the caption says no back pressure was entered');
  const tb = await pg.evaluate(() => window.__turbo.turbineBalance({ ma: 0.43318420652130163, afr: 12, t1: 30, t2: 101.56982099150139, tit: 950, p3: 101325 + 2 * 55158, p4: 101325 + 2 * 6894.757, eta: 0.75 }));
  near(tb.wg, 0.5572752, 1e-6, 'B13 gate share with 2 psi after the turbine');
  await setv('i-tobp', '2'); await setv('i-teff', '75'); await pg.waitForTimeout(500);
  t = await sec('turbo-and-intercooler-sizing'); ok(/plus your 2\.00 psi \(13\.79 kPa\) back pressure after the turbine/.test(t), 'B13 the turbine caption carries the typed back pressure');
  let pl = await sec('where-to-put-them-on-this-build');
  ok(/1103 mm²/.test(pl) && /56% of the exhaust/.test(pl) && /out at atmosphere plus 2\.00 psi/.test(pl), 'B13 the gate is sized at the back pressure: 1103 mm², 56%');
  const pa = await pg.evaluate(() => window.__turbo.orificeArea(0.2615197186042856, 101325 + 2 * 55158, 1223.15, 101325 + 2 * 6894.757, 1.2798492247905318, 286.6291525445435));
  near(pa.A * 1e6, 1102.559, 1e-5, 'B13 gate area, choked, mm²'); ok(pa.choked, 'B13 choked at p4/p3 0.544');
  await setv('i-tobp', ''); await setv('i-teff', ''); await pg.waitForTimeout(400);

  // B15: valve lift instead of "passes"
  pl = await sec('where-to-put-them-on-this-build');
  ok(/1\.57 in \(40\.0 mm\) needs at least 0\.39 in \(9\.9 mm\) of lift/.test(pl) && /1\.50 in \(38\.0 mm\) is short even fully open/.test(pl) && !/mm\) passes/.test(pl),
    'B15 gate: 40 mm needs 9.9 mm of lift, 38 mm short, no bare "passes"');
  ok(/1\.97 in \(50\.0 mm\) needs at least 0\.31 in \(8\.0 mm\) of lift/.test(pl) && /no maker sizing method was found/.test(pl), 'B15 blow-off valve: 50 mm needs 8.0 mm of lift; the full-flow basis is labelled an assumption');
  ok(/π × diameter × lift/.test(pl) && /Kirkpatrick/.test(pl), 'B15 curtain-area caption with its source');

  // zero gate flow
  await setv('i-tipk', '0.5'); await setv('i-teff', '55'); await pg.waitForTimeout(500);
  pl = await sec('where-to-put-them-on-this-build');
  ok(/no gate flow at peak power on these assumptions/.test(pl) && /none at peak power/.test(pl) && !/0\.00 in² \(0 mm²\) \(Cd·A\)/.test(pl), 'zero gate flow: said in words, no 0 mm² valve pick');
  await setv('i-tipk', ''); await setv('i-teff', ''); await pg.waitForTimeout(400);

  // B19: Charge pipes in both units; consistency notes
  t = await sec('charge-pipes');
  ok(/429 ft\/s \(131 m\/s\)/.test(t) && /2\.11 psi \(14\.5 kPa\)/.test(t) && /°F \(\d+ °C\)/.test(t) && /cu in\)/.test(t), 'B19 Charge pipes: speeds, pressures, temperatures and volume in both units');
  ok(/no pipe losses, so its temperatures are lower/.test(t), 'B19 Charge pipes says it works at the throttle ratio, without losses');
  t = await sec('boosted-intake'); ok(/no pipe losses \(Inlet and charge pipes above gives the compressor’s real ratio/.test(t), 'Boosted intake points to the real ratio');
  // the same pressure ratio in the route summary, the demand table and the drawing
  const r1 = await sec('inlet-and-charge-pipes-design-and-sizing'), r2 = await sec('turbo-and-intercooler-sizing');
  const svg = await pg.$eval('#i-details .sec[data-sec="inlet-and-charge-pipes-design-and-sizing"] svg', e => e.textContent).catch(() => '');
  ok(/Compressor pressure ratio\s+1\.708/.test(r1) && /5,600\s+57\.3 lb\/min \(0\.433 kg\/s\)\s+55\.1 lb\/min \(0\.417 kg\/s\)\s+1\.708/.test(r2) && /pressure ratio 1\.708/.test(svg), 'one pressure ratio, 1.708, in the summary, the demand line and the drawing');

  // B23: bends longer than the run (the tab is in inches by default: 7.874 in = 200 mm)
  await setv('i-cph', '7.874'); await pg.waitForTimeout(500);
  t = await sec('inlet-and-charge-pipes-design-and-sizing');
  ok(/hot side’s bends take [^:]*284 mm[^:]*of centre line but the side is [^:]*200 mm/.test(t), 'B23 bends longer than the hot side, 283.7 mm of arcs on 200 mm: ' + (t.match(/hot side’s bends take [^:]*/) || ['(no message)'])[0]);
  await setv('i-cph', '36'); await pg.waitForTimeout(400);

  // wording and catalogue
  const lib = await pg.evaluate(() => window.__tso.TURBO_LIB.find(t => /GTX3076R/.test(t.model)).wg);
  ok(/free float/.test(lib) && /internal on the 771300/.test(lib), 'GTX3076R GEN II: Garrett states free-float kits and internal 771300 assemblies');
  t = await sec('inlet-and-charge-pipes-design-and-sizing'); ok(/names no density for the cfm/.test(t), 'Garrett speed: the density is said to be this page’s reading');
  await pg.evaluate(() => { const T = window.__tso.TSO; T.ictype = 'w2a'; T.wf = '30'; });
  await pg.evaluate(() => { const el = document.querySelector('select.tsox[data-k="ictype"]'); el.value = 'w2a'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__tso.TSO.wf = '30'; const el = document.querySelector('select.tsox[data-k="ic"]'); el.value = String(window.__tso.IC_LIB.findIndex(c => c.pn === 'EC120-4073-3')); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await pg.waitForTimeout(400);
  t = await sec('intercooler-options-and-cooling-capacity');
  ok(/With UA scaled for the charge flow/.test(t) && /posted as a preprint, not a journal paper/.test(t) && /Eq\. 7/.test(t), 'UA bounds: the preprint status and its turbulent fit are said');
  // B30: a turbine inlet multiple with more than four decimals stopped the page (the range table could not find its own row)
  await setv('i-tipk', '2.123456'); await pg.waitForTimeout(500);
  ok(/2\.12 × boost, [^\n]*\(yours\)/.test(await sec('where-to-put-them-on-this-build')), 'B30 an unrounded multiple, 2.123456: the range table marks it as yours');
  await setv('i-tipk', ''); await pg.waitForTimeout(300);
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'boostaudit_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
