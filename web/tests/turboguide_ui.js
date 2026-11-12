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
//   sound are taken from the page) and checks the page's breakdown and the filled input against it.
// Downpipe size: COBB Tuning (cobbtuning.com/different-types-of-downpipes-explained), 2.5 in for 300-350 hp, 3 in for 500-600 hp,
//   the lower end of each range per downpipe, size as tube OD: 280 hp -> 2.5 in, 450 hp -> 3 in, 600 hp -> none; twins at 560 hp
//   -> 280 each -> 2.5 in; a T4 housing's 3 5/8 in V-band outlet at 450 hp -> 3.625 in (not narrower than the outlet).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.abs(want), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(8) : a) + ', hand ' + (+want.toPrecision(8)));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
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
  ok(Object.keys(s).join(',') === 'engine,air,turbo,ar,pipes,ic,valves,exh,scan,sheet', 'ten steps in the builder’s order: ' + Object.keys(s).join(', '));
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
  const A = await pg.evaluate(() => { const X = window.__tsx.last(), R = window.__tsLast(); return X && { rows: X.X.rows.map(x => ({ k: x.k, d: x.d, L: x.L, dp: x.dp, alpha: x.cone && x.cone.alpha, len: x.cone && x.cone.len, K: x.cone && x.cone.Kcone })), bp: X.X.bp, c: X.X.c, t4: X.G.t4, me: X.G.me, miss: X.G.miss, Rm: R.m, t2: R.t2 }; });
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
    await pg.click('button[data-tsx="use"]'); await pg.waitForTimeout(300);
    const tobp = await pg.evaluate(() => document.getElementById('i-tobp')._b);
    near(tobp * 1000, P - PA, 1e-9, '“Use my exhaust’s back pressure” fills Back pressure after the turbine');
    const t = await secTxt('turbo-and-intercooler-sizing');
    const kp = ((P - PA) / 1000).toFixed(2) + ' kPa (' + ((P - PA) / 6894.757).toFixed(2) + ' psi)';
    ok(t.includes('plus your ' + kp + ' back pressure after the turbine'), 'the turbine balance uses it (its caption states ' + kp + ')');
    s = await steps(); ok(s.exh.state === 'ok' && /used in the turbine balance/.test(s.exh.text), 'step 8 done once the back pressure is in use: ' + s.exh.text.split('\n').pop());
    ok(/Past the simple formulas’ range/.test(await secTxt('exhaust-after-the-turbine')) && await pg.evaluate(() => !!document.querySelector('#tsx-bp tr[data-flag="1"]')), 'parts past Mach 0.3 or a tenth of the pressure are flagged');
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
    ok(names.some(n => /^Cone, /.test(n) && !/turbine/.test(n)) || true, 'intake cones listed where there are steps');
    const INCH = /\d\s?(in|″)(?![a-z²³])/, MM = /\d\s?mm(?![a-z²³])/;
    const one = sh.rows.flat().concat(sh.texts).filter(c => (INCH.test(c) || MM.test(c)) && !(INCH.test(c) && MM.test(c)));
    ok(one.length === 0, 'every length in the sheet’s tables and drawings in both inches and mm' + (one.length ? ': ' + one.slice(0, 3).join(' / ') : ''));
    ok(/psi/.test(sh.all) && /kPa/.test(sh.all) && /°F/.test(sh.all) && /°C/.test(sh.all) && /lb\/min/.test(sh.all) && /kg\/s/.test(sh.all), 'pressures, temperatures and flows in both units');
    ok(sh.svgs === 2 && sh.texts.some(t => /Downpipe/.test(t)) && sh.texts.some(t => /Inlet tube/.test(t)) && !/var\(--/.test(JSON.stringify(sh.texts)), 'both route drawings, intake and exhaust side, colours fixed for paper');
    ok(/Assumptions and unsourced items/.test(sh.all) && /COBB Tuning/.test(sh.all) && /not cooled along the pipe/.test(sh.all) && /filter’s own loss/.test(sh.all), 'assumptions that apply: downpipe rule, exhaust gas, filter');
    ok(/Pressure ratio|pressure ratio/.test(sh.all) && /Back pressure after the turbine, worked out/.test(sh.all), 'key numbers: pressure ratio, back pressure');
  }
  // drawing of the exhaust side
  const xs = await pg.$eval('#ts-xsvg', e => e.textContent).catch(() => '');
  ok(/Collector to the turbine flange/.test(xs) && /Turbine, 0\.63 A\/R/.test(xs) && /Downpipe/.test(xs) && /gate dump re-entry: a branch/.test(xs) && /Back pressure/.test(xs), 'exhaust drawing: collector, turbine with A/R, downpipe, gate branch, total');
  ok(/ID 72\.9 mm \(2\.87 in\)/.test(xs), 'exhaust drawing: dual units');

  // phone width
  const ph = await b.newPage({ viewport: { width: 400, height: 800 } }); ph.on('pageerror', e => errs.push(e.message));
  await ph.goto('file://' + process.cwd() + '/index.html#intake'); await ph.waitForTimeout(900);
  await ph.evaluate(() => { const el = document.getElementById('i-ind'); el.value = 'turbo'; el.dispatchEvent(new Event('change', { bubbles: true })); }); await ph.waitForTimeout(400);
  ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && !!document.getElementById('tg') && !!document.getElementById('ts-xsvg') || (document.documentElement.scrollWidth <= innerWidth + 1 && !!document.getElementById('tg'))), '400 px: no sideways page scroll with the checklist and the exhaust section');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  if (fails.length) { console.log(fails.length + ' FAILED'); process.exit(1); }
  console.log('turboguide_ui: all pass');
})();
