// Turbo build, step by step; exhaust after the turbine (downpipe, back pressure at the turbine outlet); turbo build sheet
// (Intake tab, boosted; 2026-11-12).   node tests/turboguide_ui.js   (from web/)
//
// Back pressure by hand (case A below: tab defaults in metric, Turbocharged, 450 hp, Precision GEN2 PT5862 with its 0.63 A/R
// T3 / 4-bolt housing (2.5 in, 63.5 mm discharge, so a 60.198 mm bore at the 1.651 mm wall), Use these sizes pressed, downpipe
// 609.6 mm with no bends, no converters, the Mufflers tab's straight-through chamber (152.4 mm) on a 72.898 mm pipe, the Sound
// tab set to one turbo with a 76.2 mm OD, 1.651 mm wall pipe 2500 mm from the turbine outlet to the tip). The page's documented
// formulas, each part at the absolute pressure at its downstream end, marching from the tip back (gas: air's R 287.05 J/kg K,
// Sutherland's viscosity, Haaland on 0.0015 mm drawn tube; the whole exhaust through every part):
//   gas: me = 0.4331842 x (1 + 1/12) = 0.4692829 kg/s; compressor work Wc = m x 1004.675 x (t2 - 30 °C) with the page's
//   route t2 (96.753 °C on this build) = 29051.56 W; cp of the burned gas at 950 °C 1310.856 J/kg K (gamma 1.279849, EXH_GAS, as
//   turboar_ui states); T4 = 950 - 29051.56 / (0.4692829 x 1310.856) = 902.7742 °C; speed of sound there (sosExh) 657.464 m/s.
//   tip: rho = 101325 / (287.05 x 1175.924) = 0.300179 kg/m³, v = 0.4692829 / (rho x 4173.7 mm²) = 374.571 m/s, Mach 0.569721,
//     H = 1.4 x 101325 x M² / 2 = 23021.76 Pa, loss 0.4 H = 9208.70 Pa (Munjal's free jet);
//   pipe after the downpipe: 1890.4 mm at 72.898 mm, f = 0.0159528 (Re 179338), v 343.365 m/s, f L/d rho v²/2 = 7985.72 Pa;
//   muffler: n = (72.898/152.4)² = 0.228803, ((1 - n)² + (1 - n)/2) H, H at that pipe's Mach 0.487067 = 19681.83 Pa: 19294.96 Pa;
//   downpipe: 609.6 mm at 72.898 mm, v 275.395 m/s: 2065.41 Pa;
//   cone 60.198 -> 72.898 mm: Rennels' diffuser 8.30 tan(a/2)^1.75 (1 - beta²)² plus friction f (1 - beta^4) / (8 sin(a/2)),
//     f 0.0154206 at the small end, least at a = 8.0 deg, K 0.022768, length (72.898 - 60.198) / (2 tan 4 deg) = 90.81 mm, on
//     the small section's head 32802.98 Pa: 746.87 Pa;
//   total 39301.66 Pa = 5.700 psi. The test recomputes every line above from these formulas (only R.m, R.t2 and the speed of
//   sound are taken from the page) and checks the first method's breakdown (exhAfterTurbine) against it. Since 2026-11-12 part 2
//   the page's figure is the cooled, compressible march (exhMarch: 7716.37 Pa static at the turbine outlet for this build, checked
//   in xflow_ui.js against tools/validation/boost/xflow.py); this first-method figure is its "First method" row, and the filled
//   input is the march's figure (pin changed: 39301.66 -> 7716.37 Pa; the reasons are listed in xflow_ui.js and the audit).
// Downpipe size: COBB Tuning (cobbtuning.com/different-types-of-downpipes-explained), 2.5 in for 300-350 hp, 3 in for 500-600 hp,
//   the lower end of each range per downpipe, size as tube OD: 280 hp -> 2.5 in, 450 hp -> 3 in, 600 hp -> none; twins at 560 hp
//   -> 280 each -> 2.5 in; a T4 housing's 3 5/8 in V-band outlet at 450 hp -> 3.625 in (not narrower than the outlet).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.abs(want), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(8) : a) + ', hand ' + (+want.toPrecision(8)));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
  // pg.$eval / pg.$$eval read in one call after the page has stopped re-rendering (tests/settle.js; audit F1)
  require('./settle').reads(pg);
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const setv = async (id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await pg.waitForTimeout(120); };
  const tso = async (k, v) => { await pg.evaluate(([k, v]) => { const el = document.querySelector('select.tsox[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]); await pg.waitForTimeout(150); };
  const steps = () => pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('#tg-steps > li')].map(li => [li.dataset.step, { state: li.dataset.state, text: li.innerText }])));
  const secTxt = k => pg.$eval('#i-details .sec[data-sec="' + k + '"]', e => e.innerText).catch(() => '');
  await pg.click('#u-met'); await pg.waitForTimeout(300);
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(300);

  // simple mode (the page's default): the checklist is there and readable
  ok(await pg.evaluate(() => document.body.classList.contains('simple') && !!document.getElementById('tg') && !!document.getElementById('tg').offsetParent), 'simple mode shows the checklist');
  let s = await steps();
  ok(Object.keys(s).join(',') === 'engine,air,turbo,ar,pipes,ic,oil,valves,exh,scan,sheet', 'eleven steps in the builder’s order (oil cooling and turbo oil lines after the intercooler): ' + Object.keys(s).join(', '));
  ok(s.engine.state === 'todo' && /target power not entered/.test(s.engine.text), 'no power target: step 1 open and says so');
  ok(s.air.state === 'todo' && /per compressor at pressure ratio/.test(s.air.text), 'no power target: step 2 gives the tab’s airflow');
  await setv('i-hp', '450');
  s = await steps();
  const G = await pg.evaluate(() => window.__tg.TG().G);
  ok(s.engine.state === 'ok' && /target 336 kW \(450 hp\)/.test(s.engine.text), 'power target entered: step 1 done: ' + s.engine.text.split('\n').pop());
  ok(s.air.state === 'ok' && s.air.text.includes('needs ' + (G.wa / (60 / 0.45359237)).toFixed(3) + ' kg/s (' + G.wa.toFixed(1) + ' lb/min) per compressor at pressure ratio ' + G.pr.toFixed(2)), 'step 2 reads Garrett’s result from the sizing section: ' + s.air.text.split('\n').pop());
  ok(s.turbo.state === 'todo' && /not chosen yet/.test(s.turbo.text) && s.ar.state === 'todo', 'turbo and A/R: not chosen yet');
  await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });

  // pick a turbo, a housing, the sizes
  const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862')));
  await tso('turbo', String(ti)); s = await steps();
  ok(s.turbo.state === 'ok' && /PT5862/.test(s.turbo.text) && /inside the maker’s range|rating covers this build/.test(s.turbo.text), 'turbo picked: step 3 done with the options table’s verdict');
  const hs4 = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.outlet === '4-bolt'), ti);
  await tso('hs', String(hs4)); s = await steps();
  ok(s.ar.state === 'ok' && /0\.63 A\/R/.test(s.ar.text) && /T3 inlet, 4-bolt outlet/.test(s.ar.text), 'housing picked: step 4 shows the A/R and housing: ' + s.ar.text.split('\n').pop());
  ok((s.pipes.state === 'todo' || s.pipes.state === 'warn') && /Use these sizes/.test(s.pipes.text), 'sizes not the recommended ones yet: step 5 open (' + s.pipes.state + ': ' + s.pipes.text.split('\n').pop() + ')');
  await pg.click('button[data-tsuse]'); await pg.waitForTimeout(300); s = await steps();
  ok(s.pipes.state === 'ok' && /the recommended sizes/.test(s.pipes.text), 'after Use these sizes: step 5 done');
  ok(s.valves.state === 'ok' && /blow-off valve on the cold side/.test(s.valves.text) && /wastegate/.test(s.valves.text), 'step 7: valve positions from the placement section');
  const ex0 = await pg.evaluate(() => { const x = window.__tsx.last(); return x && x.G.miss; });
  ok(s.exh.state === 'todo' && ex0 && ex0.some(m => /Sound tab’s Induction is not a turbo/.test(m)), 'step 8 open; the exhaust section names what is missing (the Sound tab’s pipe starts at the valve)');
  ok(/Not counted:.*Sound tab’s Induction is not a turbo/.test(await secTxt('exhaust-after-the-turbine')), 'the missing part is said in the section, not guessed');

  // existing outputs do not move with the new inputs (back pressure input left blank)
  const before = await pg.evaluate(() => ['ts-turb', 'ts-place', 'ts-demand', 'tso-hs'].map(id => (document.getElementById(id) || {}).innerText).join('|'));
  await setv('i-dpd', '80'); await setv('i-dpl', '900'); await setv('i-xcat', 'none'); await setv('i-xmuf', 'plug'); await setv('i-dpb', '3');
  const after = await pg.evaluate(() => ['ts-turb', 'ts-place', 'ts-demand', 'tso-hs'].map(id => (document.getElementById(id) || {}).innerText).join('|'));
  ok(before === after && before.length > 200, 'turbine, placement, demand and housing tables unchanged by the downpipe inputs while back pressure is blank');
  await setv('i-dpd', ''); await setv('i-dpl', '609.6'); await setv('i-xmuf', 'chamber'); await setv('i-dpb', '0');

  // case A, by hand
  await setv('s-ind', 'turbo1'); await setv('m-dp', '72.898'); await setv('s-od', '76.2'); await setv('s-len', '2500'); await setv('i-xcat', 'none');
  await setv('i-dpb', '0');
  // the hand case checks the first method (exhAfterTurbine, kept on the page as the start of "What each change moved"); the
  // page's figure is now the cooled, compressible march (xflow_ui.js checks that one against xflow.py)
  const A = await pg.evaluate(() => { const X = window.__tsx.last(), R = window.__tsLast(); if (!X) return null; const G = X.G;
    const O = window.__tsx.exhAfterTurbine({ me: G.me, nt: G.nt, xn: G.xn, t4: G.t4, dOut: G.dOut, d: G.d, L: G.L, n90: G.n90, xb: G.xb, cat: G.cat, muf: G.muf, tail: G.tail });
    return { rows: O.rows.map(x => ({ k: x.k, d: x.d, L: x.L, dp: x.dp, alpha: x.cone && x.cone.alpha, len: x.cone && x.cone.len, K: x.cone && x.cone.Kcone })), bp: O.bp, c: O.c, t4: G.t4, me: G.me, miss: G.miss, Rm: R.m, t2: R.t2, bpNew: X.X.bp, first: X.X.S.v0 }; });
  ok(!!A && A.miss.length === 0, 'case A: every part read from the tabs (nothing missing)');
  if (A) {
    const RA = 287.05, PA = 101325, cpe = 1310.8562261020516, me = A.Rm * (1 + 1 / 12), Wc = A.Rm * (1.4 * RA / 0.4) * (A.t2 - 30), T4 = 950 - Wc / (me * cpe), T = T4 + 273.15, c = A.c;
    const mu = 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4), hz = (Re, D) => Re < 2300 ? 64 / Re : 1 / Math.pow(-1.8 * Math.log10(Math.pow(1.5e-6 / D / 3.7, 1.11) + 6.9 / Re), 2);
    const st = (P, d) => { const rho = P / (RA * T), A_ = Math.PI * (d / 2000) ** 2, v = me / (rho * A_), Re = rho * v * d / 1000 / mu; return { rho, v, q: rho * v * v / 2, f: hz(Re, d / 1000), M: v / c }; };
    near(T4, 902.7742, 2e-6, 'gas after the turbine, °C'); near(A.t4, T4, 1e-9, 'page T4 against the hand T4');
    let P = PA; const h = {};
    let g = st(P, 72.898); h.tip = 0.4 * 1.4 * P * g.M * g.M / 2; P += h.tip;
    g = st(P, 72.898); h.tail = g.f * 1890.4 / 72.898 * g.q; P += h.tail;
    g = st(P, 72.898); const n = (72.898 / 152.4) ** 2, H = 1.4 * P * g.M * g.M / 2; h.muf = ((1 - n) ** 2 + (1 - n) / 2) * H; P += h.muf;
    g = st(P, 72.898); h.dp = g.f * 609.6 / 72.898 * g.q; P += h.dp;
    g = st(P, 60.198); const beta = 60.198 / 72.898, Kof = a => 8.30 * Math.pow(Math.tan(a * Math.PI / 360), 1.75) * (1 - beta * beta) ** 2 + g.f * (1 - beta ** 4) / (8 * Math.sin(a * Math.PI / 360));
    let am = 2, Km = Kof(2); for (let a = 2.5; a <= 20; a += 0.5) { const k = Kof(a); if (k < Km) { Km = k; am = a; } }
    h.cone = Km * g.q; P += h.cone;
    console.log('  hand: m ' + A.Rm + ', t2 ' + A.t2 + ', Wc ' + Wc.toFixed(2) + ', T4 ' + T4.toFixed(4) + ', c ' + c.toFixed(3) + ', ' + Object.entries(h).map(([k, v]) => k + ' ' + v.toFixed(2)).join(', ') + ', cone ' + am + ' deg K ' + Km.toFixed(6) + ', total ' + (P - PA).toFixed(2));
    const byK = k => (A.rows.find(r => r.k === k) || {}).dp;
    near(byK('tip'), h.tip, 1e-9, 'tip, 0.4 H, Pa'); near(byK('tail'), h.tail, 1e-9, 'pipe after the downpipe, Pa'); near(byK('muf'), h.muf, 1e-9, 'muffler chamber, Pa');
    near(byK('dp'), h.dp, 1e-9, 'downpipe, Pa'); near(byK('cone'), h.cone, 1e-9, 'cone from the turbine outlet, Pa');
    const cone = A.rows.find(r => r.k === 'cone');
    ok(cone && cone.alpha === am && Math.abs(cone.len - (72.898 - 60.198) / 2 / Math.tan(am * Math.PI / 360)) < 1e-9 && Math.abs(cone.K - Km) < 1e-12, 'cone: least-loss angle ' + am + '°, K ' + Km.toFixed(6) + ', length ' + (cone && cone.len.toFixed(2)) + ' mm by hand');
    near(A.bp, P - PA, 1e-9, 'back pressure after the turbine, Pa (' + ((P - PA) / 6894.757).toFixed(3) + ' psi)');
    near(A.rows.reduce((a, r) => a + r.dp, 0), A.bp, 1e-12, 'the breakdown adds up to the total');
    near(A.first, P - PA, 1e-9, 'the section’s “First method” row is this hand figure');
    await pg.click('button[data-tsx="use"]'); await pg.waitForTimeout(300);
    const tobp = await pg.evaluate(() => document.getElementById('i-tobp')._b);
    near(tobp * 1000, A.bpNew, 1e-9, '“Use my exhaust’s back pressure” fills Back pressure after the turbine with the march’s figure (' + (A.bpNew / 1000).toFixed(2) + ' kPa)');
    const t = await secTxt('turbo-and-intercooler-sizing');
    const kp = (A.bpNew / 1000).toFixed(2) + ' kPa (' + (A.bpNew / 6894.757).toFixed(2) + ' psi)';
    ok(t.includes('plus your ' + kp + ' back pressure after the turbine'), 'the turbine balance uses it (its caption states ' + kp + ')');
    s = await steps(); ok(s.exh.state === 'ok' && /used in the turbine balance/.test(s.exh.text), 'step 8 done once the back pressure is in use: ' + s.exh.text.split('\n').pop());
    ok(await pg.evaluate(() => /39\.30 kPa \(5\.70 psi\)/.test((document.querySelector('#tsx-steps tr[data-st="old"]') || {}).innerText || '')), 'the first method’s 39.30 kPa (5.70 psi) is shown as the comparison’s start (the parts past Mach 0.3 are now worked compressibly)');
    await setv('i-tobp', ''); s = await steps(); ok(s.exh.state === 'todo', 'cleared by hand: manual entry stays possible, the step reopens');
  }
  // the size rule
  const rule = async () => pg.evaluate(() => { const x = window.__tsx.last(); return x ? { rec: x.G.recOD, d: x.G.d, why: x.G.dWhy, rule: x.G.rule } : null; });
  await setv('i-hp', '280'); let r = await rule(); ok(r && Math.abs(r.rec - 63.5) < 1e-9 && r.why === 'recommended', '280 hp: 2.5 in (63.5 mm) OD downpipe');
  await setv('i-hp', '450'); r = await rule(); ok(r && Math.abs(r.rec - 76.2) < 1e-9, '450 hp: 3 in (76.2 mm) OD');
  await setv('i-hp', '600'); r = await rule(); ok(r && r.rec === null && r.why === 'outlet' && Math.abs(r.d - 60.198) < 1e-9 && /no source size above 500 hp a downpipe/.test(await secTxt('exhaust-after-the-turbine')), '600 hp: no source size, the downpipe stays at the turbine outlet’s size and the page says so');
  await setv('i-nt', '2'); await setv('i-hp', '560'); r = await rule(); ok(r && Math.abs(r.rec - 63.5) < 1e-9, 'twins at 560 hp: 280 a downpipe, 2.5 in');
  await setv('i-nt', '1'); await setv('i-hp', '450');
  const t4i = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.flange === 'T4 tangential'), ti);
  await tso('hs', String(t4i)); r = await rule(); ok(r && Math.abs(r.rec - 3.625 * 25.4) < 1e-9, 'T4 housing with a 3 5/8 in outlet at 450 hp: the downpipe starts at the outlet’s size, not narrower');
  await tso('hs', String(hs4));

  // a deliberately bad build: warnings appear
  await setv('i-hp', '900'); await setv('i-mani', 'div'); await setv('i-cpd', '30'); await setv('i-wgcl', '20');
  s = await steps();
  ok(s.turbo.state === 'warn' && /rating is below this build’s target/.test(s.turbo.text), 'bad case: 900 hp on a 700 hp turbo is flagged');
  ok(s.ar.state === 'warn' && /divided manifold/.test(s.ar.text), 'bad case: undivided housing on a divided manifold is flagged');
  ok(s.pipes.state === 'warn' && /Mach 0\.4/.test(s.pipes.text), 'bad case: charge pipe past Bell’s Mach 0.4 is flagged');
  ok(s.valves.state === 'warn' && /collector is too short/.test(s.valves.text), 'bad case: collector too short for the gate branch is flagged');
  ok(await pg.evaluate(() => [...document.querySelectorAll('#tg-steps > li[data-state="warn"]')].every(li => /⚠/.test(li.textContent))), 'each flagged step carries the warning mark');
  await setv('i-hp', '450'); await setv('i-mani', 'tube'); await setv('i-cpd', '72.898'); await setv('i-wgcl', '152.4');

  // the build sheet
  await setv('i-xcat', 'cat'); await setv('c-type', 'hf200');
  await pg.click('button[data-tsheet]'); await pg.waitForTimeout(500);
  const sh = await pg.evaluate(() => { const f = window.__tgSheet; if (!f) return null;
    const d = new DOMParser().parseFromString(f.text, 'application/xml'), bad = d.getElementsByTagName('parsererror').length;
    const rows = [...d.getElementsByTagName('tr')].map(tr => [...tr.getElementsByTagName('td')].map(td => td.textContent)).filter(r => r.length);
    const texts = [...d.getElementsByTagName('text')].map(t => t.textContent);
    return { name: f.name, bad, rows, texts, svgs: d.getElementsByTagName('svg').length, all: d.documentElement.textContent, len: f.text.length, msg: (document.getElementById('tg-msg') || {}).textContent }; });
  ok(sh && sh.name === 'turbo_build_sheet.html' && sh.bad === 0, 'build sheet saved as ' + (sh && sh.name) + ', well-formed (parsed as XML, ' + (sh && sh.len) + ' characters): ' + (sh && sh.msg));
  if (sh) {
    const names = sh.rows.map(r => r[0]);
    ['Turbo', 'Turbine housing', 'Compressor inlet / outlet', 'Inlet tube', 'Hot side pipe', 'Cold side pipe', 'Intercooler', 'Blow-off valve', 'Wastegate', 'Cone, turbine outlet → downpipe', 'Downpipe', 'Converters (Cats tab)', 'Muffler (Mufflers tab)', 'Pipe after the downpipe (Sound tab)', 'Tip'].forEach(n =>
      ok(names.includes(n), 'sheet lists ' + n + ': ' + ((sh.rows.find(r => r[0] === n) || []).slice(1).join(' | '))));
    ok(names.filter(n => /^Cone, /.test(n) && !/turbine/.test(n)).length >= 1, 'the intake side’s cones are listed: ' + names.filter(n => /^Cone, /.test(n)).join('; '));
    const INCH = /\d\s?(in|″)(?![a-z²³])/, MM = /\d\s?mm(?![a-z²³])/;
    const one = sh.rows.flat().concat(sh.texts).filter(c => (INCH.test(c) || MM.test(c)) && !(INCH.test(c) && MM.test(c)));
    ok(one.length === 0, 'every length in the sheet’s tables and drawings in both inches and mm' + (one.length ? ': ' + one.slice(0, 3).join(' / ') : ''));
    ok(/psi/.test(sh.all) && /kPa/.test(sh.all) && /°F/.test(sh.all) && /°C/.test(sh.all) && /lb\/min/.test(sh.all) && /kg\/s/.test(sh.all), 'pressures, temperatures and flows in both units');
    ok(sh.svgs === 2 && sh.texts.some(t => /Downpipe/.test(t)) && sh.texts.some(t => /Inlet tube/.test(t)) && !/var\(--/.test(JSON.stringify(sh.texts)), 'both route drawings, intake and exhaust side, colours fixed for paper');
    ok(/Assumptions and unsourced items/.test(sh.all) && /COBB Tuning/.test(sh.all) && /cooled along the pipe by the steady-flow heat transfer/.test(sh.all) && /compressible 1-D relations/.test(sh.all) && /filter’s own loss/.test(sh.all), 'assumptions that apply: downpipe rule, exhaust gas (cooled, compressible), filter');
    ok(/Pressure ratio|pressure ratio/.test(sh.all) && /Back pressure after the turbine, worked out/.test(sh.all) && /static at the turbine outlet/.test(sh.all) && /Gas at the tip/.test(sh.all), 'key numbers: pressure ratio, back pressure (static at the turbine outlet), gas at the tip');
  }
  // the converter row by hand (Cats tab at High-flow 200 cpsi, 2 mil, its default substrate, pipe and cones): catDp's documented
  // formulas, Shah and London's apparent f Re for a square channel, the faces 0.5 (1 - OFA) + (1 - OFA)², and the cones as
  // Rennels' conical diffuser and contraction with their friction on the pipe's head, each at T4 and the converter's own
  // downstream pressure, the whole exhaust split over the converters side by side
  const Cc = await pg.evaluate(() => { const X = window.__tsx.last(), G = X.G, O = window.__tsx.exhAfterTurbine({ me: G.me, nt: G.nt, xn: G.xn, t4: G.t4, dOut: G.dOut, d: G.d, L: G.L, n90: G.n90, xb: G.xb, cat: G.cat, muf: G.muf, tail: G.tail }), r = O.rows.find(x => x.k === 'cat');
    return r && { g: X.G.cat.g, count: X.G.cat.count, series: X.G.cat.series, p: r.p, dp: r.dp, t4: X.G.t4, me: X.G.me }; });
  if (Cc) { const T = Cc.t4 + 273.15, g = Cc.g, rho = Cc.p / (287.05 * T), mu = 1.716e-5 * Math.pow(T / 273.15, 1.5) * (273.15 + 110.4) / (T + 110.4), Q = Cc.me / Cc.count / rho;
    const v = Q / (g.Asub * g.ofa), Re = rho * v * g.w / mu, xp = g.len / (g.w * Re), fRe = 3.44 / Math.sqrt(xp) + (14.227 + 1.43 / (4 * xp) - 3.44 / Math.sqrt(xp)) / (1 + 0.00029 / (xp * xp)), qch = rho * v * v / 2;
    const vp = Q / g.Apipe, qp = rho * vp * vp / 2, dP = Math.sqrt(4 * g.Apipe / Math.PI), dS = Math.sqrt(4 * g.Asub / Math.PI), bC = Math.min(1, dP / dS), aC = g.cone > 0 ? 2 * Math.atan((dS - dP) / 2 / g.cone) * 180 / Math.PI : 180;
    const fP = (Re2 => Re2 < 2300 ? 64 / Re2 : 1 / Math.pow(-1.8 * Math.log10(Math.pow(4.5e-5 / dP / 3.7, 1.11) + 6.9 / Re2), 2))(rho * vp * dP / mu);
    const e = (1 - bC * bC) ** 2, b4 = bC ** 4, kD = aC <= 20 ? 8.30 * Math.pow(Math.tan(aC * Math.PI / 360), 1.75) * e : aC <= 60 ? (1.366 * Math.sqrt(Math.sin(2 * Math.PI * (aC - 15) / 180)) - 0.170 - (bC < 0.5 ? 3.28 * (0.0625 - b4) * Math.sqrt((aC - 20) / 40) : 0)) * e : (bC < 0.5 ? 1.205 - 3.28 * (0.0625 - b4) - 12.8 * b4 * bC * bC * Math.sqrt((aC - 60) / 120) : 1.205 - 0.20 * Math.sqrt((aC - 60) / 120)) * e;
    const fr = aC > 0 && aC <= 60 ? fP * (1 - b4) / (8 * Math.sin(aC * Math.PI / 360)) : 0, lam = 1 + 0.622 * Math.pow(Math.min(aC, 180) / 180, 0.8) * (1 - 0.215 * bC * bC - 0.785 * bC ** 5);
    const kC = 0.0696 * Math.sin(Math.min(aC, 180) * Math.PI / 360) * (1 - bC ** 5) * lam * lam + (lam - 1) ** 2 + (aC < 180 ? fP * (1 - b4) / (8 * Math.sin(aC * Math.PI / 360)) : 0);
    const dp = (4 * (fRe / Re) * (g.len / g.w) * qch + (0.5 * (1 - g.ofa) + (1 - g.ofa) ** 2) * qch + (kD + fr + kC) * qp) * Cc.series;
    near(Cc.dp, dp, 1e-9, 'converters (2 side by side, 200 cpsi) by hand at T4 and their own pressure, Pa (cone ' + aC.toFixed(1) + '° included)'); }
  else ok(false, 'converter row present with the Cats tab on');
  // drawing of the exhaust side
  const xs = await pg.$eval('#ts-xsvg', e => e.textContent).catch(() => '');
  ok(/Collector to the turbine flange/.test(xs) && /Turbine, 0\.63 A\/R/.test(xs) && /Downpipe/.test(xs) && /gate dump re-entry: a branch/.test(xs) && /Back pressure/.test(xs), 'exhaust drawing: collector, turbine with A/R, downpipe, gate branch, total');
  ok(/ID 72\.9 mm \(2\.87 in\)/.test(xs), 'exhaust drawing: dual units');

  // phone width
  const ph = await b.newPage({ viewport: { width: 400, height: 800 } }); ph.on('pageerror', e => errs.push(e.message));
  await ph.goto('file://' + process.cwd() + '/index.html#intake'); await ph.waitForTimeout(900);
  await ph.evaluate(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); };
    set('i-ind', 'turbo'); set('i-hp', '450'); set('s-ind', 'turbo1'); }); await ph.waitForTimeout(600);
  ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && !!document.getElementById('tg') && !!document.getElementById('ts-xsvg') && !!document.getElementById('tsx-bp')),
    '400 px: no sideways page scroll with the checklist, the exhaust tables and drawing');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  if (fails.length) { console.log(fails.length + ' FAILED'); process.exit(1); }
  console.log('turboguide_ui: all pass');
})();
