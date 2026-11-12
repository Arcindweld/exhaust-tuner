// Turbo inlet tract and charge-pipe design and sizing (Intake tab, 2026-11-11).
// node tests/turbosize_ui.js   (from web/)
//
// Every expected number below was worked out independently in plain Python from the formulas' sources (Haaland,
// Crane TP-410 bend table x Idelchik's angle factor, Rennels and Hudson's cone / step coefficients as python-fluids
// codes them, ideal-gas compression), not read from the page. The arithmetic for the default case:
//
// Engine (tab defaults): 5735.5 cc, 5600 RPM, VE 0.90, boost 55.158 kPa (8 psi), inlet air 30 °C, outside 25 °C,
//   compressor efficiency 0.70, intercooler effectiveness 0.75, core drop 6.895 kPa.
//   PR at the throttle = (101325 + 55158) / 101325 = 1.544367
//   Q = 5.7355e-3 m³ x 5600 / 120 x 0.90 x 1.544367 = 0.3720241 m³/s (788.3 cfm) at the inlet's density
//   rho_in = 101325 / (287.05 x 303.15) = 1.164398 kg/m³ ; m = Q x rho_in = 0.4331842 kg/s
// Inlet tube (88.9 mm, 609.6 mm, 2 x 90° at 1.5 D, rolled lip Cd 0.719):
//   A = pi/4 x 0.0889² = 6.2072e-3 m² ; v = 0.3720241 / 6.2072e-3 = 59.935 m/s (197 ft/s)
//   q = 1.164398 x 59.935² / 2 = 2091.35 Pa ; Re = rho v D / mu(30 °C, Sutherland 1.8721e-5) = 333,415
//   f (Haaland, ks 0.0015 mm) = 0.014212 ; straights 609.6 - 2 x pi/2 x 1.5 x 88.9 = 190.669 mm
//   friction 0.014212 x 190.669/88.9 x 2091.35 = 63.75 Pa ; bends 2 x 14 f (0.19897) x q = 832.25 Pa
//   mouth K (1/0.719 - 1)² = 0.15275 x q = 319.43 Pa ; inlet tube total 1215.434 Pa
//   compressor inlet pressure P1 = 101325 - 1215.43 = 100109.566 Pa
// Route, march from the throttle (Pt = 156483 Pa) back to the compressor, repeated until the outlet pressure settles
// (6 passes): t2 = 303.15 x (1 + ((P2/P1)^(0.4/1.4) - 1)/0.7) - 273.15 = 101.570 °C, t3 = t2 - 0.75 (t2 - 25) = 44.142 °C
//   cold-pipe -> throttle 60.198 -> 76.2 mm, a widening, beta 0.79: at t3 and Pt, v 88.587 m/s, q 6741.51 Pa,
//     f 0.013468; best cone (Rennels area term + f(1-b^4)/(8 sin(a/2)), searched 2-60° by 0.5°) at 7.0°, K 0.025658,
//     173.0 Pa, 130.8 mm long; Borda-Carnot (1 - 0.79²)² = 0.141301 -> 952.6 Pa
//   cold pipe at 156656.0 Pa, 44.142 °C: rho 1.720005, v 88.489 m/s, q 6734.07, Re 475,560, f 0.013468,
//     straights 914.4 - 2 x pi/2 x 1.5 x 60.198 = 630.724 mm: friction 950.26 Pa, bends 2 x 14 f q = 2539.48 Pa
//   + core 6895 Pa ; hot pipe at 167040.7 Pa, 101.570 °C: rho 1.552952, v 98.008, q 7458.46, f 0.013742,
//     friction 1073.91 Pa, bends 2869.91 Pa
//   P2 = 170984.534 Pa ; PR = P2 / P1 = 1.7079740 ; without the inlet loss P2 / 101325 = 1.6874861
//   t2 with the inlet loss 101.570 °C, without 99.833 °C, with no losses at all (PR 1.544367) 87.258 °C
//   total filter to throttle = 1215.434 + (170984.534 - 156483) = 15716.968 Pa (2.28 psi)
// The existing Charge pipes section (calcCharge, unchanged convention: both sides at the throttle-PR t2 87.258 °C,
//   hot at 156483 Pa, cold at 156483 - 6895 Pa): hot 1097.4288 + 2932.7657, cold 982.5757 + 2625.8325, + 6895
//   = 14533.603 Pa. With a 72.898 mm cold side (3 in OD, 0.065 in wall): cold v 62.481 m/s, friction 351.2114
//   (straights 914.4 - pi x 1.5 x 72.898 = 570.876 mm), bends 1255.7415, total 12532.147 Pa; hot side unchanged.
// Size table, hot side, 3.00 in OD = 72.898 mm ID: Garrett speed Q / A = 0.3720241 / 4.17368e-3 = 89.135 m/s =
//   292.4 ft/s (in 200-300) ; Mach 0.1722 ; 2.75 in (66.548 mm) is 350.9 ft/s, over 300 -> 3.00 in recommended.
//   Inlet tube table, 3.00 in: 292.4 ft/s, Mach 0.2553 (c = 20.05 sqrt(303.15) = 349.10 m/s), loss 2722.55 Pa.
// Size changes (case B: compressor inlet 76.2, outlet 50.8, intercooler ports 63.5 mm):
//   inlet tube 88.9 -> 76.2 narrowing, beta 0.857143, q at 76.2 = 3874.49 Pa: cone 13.0°, K 0.012917 (50.05 Pa);
//     sharp contraction lambda = 1 + 0.622 (1 - 0.215 b² - 0.785 b^5) -> K 0.151705 (587.78 Pa)
//   compressor outlet 50.8 -> 60.198 widening, beta 0.843882: cone 8.0°, K 0.018399 ; Borda (1-b²)² = 0.082865
//   totals: cones 16103.964 Pa (PR 1.7121958), step couplers 18596.806 Pa (PR 1.7410921)
// Other cases from the same script: cold 72.898 mm route total 13648.845 Pa, PR 1.6873154; twins into one
//   intercooler (per-turbo m 0.2165921 kg/s, cold pipe carries both) 11981.089 Pa, PR 1.6648058; twins apart
//   9318.721 Pa, PR 1.6384433; a 63.5 mm inlet tube into a 76.2 mm compressor inlet: tube 4792.378 Pa, widening
//   cone 159.78 Pa, PR 1.7750648; bend lists hot 90+45, cold 90 at 100 mm radius: total 14037.077 Pa.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.abs(want), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(7) : a) + ', hand ' + (+want.toPrecision(7)));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const secText = () => pg.$eval('#i-details .sec[data-sec="inlet-and-charge-pipes-design-and-sizing"]', e => e.innerText).catch(() => '');
  await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(400);

  // pure functions, against the hand values
  const v = await pg.evaluate(() => {
    const T = window.__turbo, o = {}, Q = 0.372024143626943;
    const t2 = T.compOut(30, (101325 + 55158) / 101325, 0.7);
    const base = { Q, nt: 1, d: 60.198, Lh: 914.4, Lc: 914.4, bends: 4, pr: (101325 + 55158) / 101325, t1: 30, t2, tamb: 25, eff: 0.75, dpIC: 6.895 };
    const c0 = T.calcCharge(base), c1 = T.calcCharge(Object.assign({}, base, { dc: 72.898 }));
    o.c0 = { dp: c0.dp, hot: c0.hot.dp + c0.hot.dpB, cold: c0.cold.dp, coldB: c0.cold.dpB };
    o.c1 = { dp: c1.dp, hot: c1.hot.dp + c1.hot.dpB, cold: c1.cold.dp, coldB: c1.cold.dpB, v: c1.cold.v };
    const inlet = { dp: 1215.4340760522273, v: 59.93461533504205 };
    const R = q => T.calcTurboRoute(Object.assign({ Q, nt: 1, tin: 30, tamb: 25, eff: 0.7, ice: 0.75, dpIC: 6895, boost: 55158, inlet, dt: 88.9, dh: 60.198, Lh: 914.4, Lc: 914.4, bends: 4, angH: [], angC: [], dtb: 76.2, w: 1.651 }, q));
    const A = R({}); o.A = { P1: A.P1, P2: A.P2, PRc: A.PRc, PRno: A.PRnoIn, t2: A.t2, t2no: A.t2noIn, t2thr: A.t2thr, total: A.total, tbK: A.trs[0][1].Kcone, tbKs: A.trs[0][1].Kstep, tbA: A.trs[0][1].alpha, tbL: A.trs[0][1].len };
    const B = R({ dci: 76.2, dco: 50.8, dici: 63.5, dico: 63.5 }), B2 = R({ dci: 76.2, dco: 50.8, dici: 63.5, dico: 63.5, step: true });
    const co = B.trs.find(x => x[0] === 'co')[1];
    o.B = { total: B.total, PRc: B.PRc, inA: B.trIn.alpha, inK: B.trIn.Kcone, inKs: B.trIn.Kstep, inDp: B.trIn.dpCone, coA: co.alpha, coK: co.Kcone, coKs: co.Kstep, t2: B.t2, B2total: B2.total, B2PR: B2.PRc };
    const C = R({ dc: 72.898 }); o.C = { total: C.total, PRc: C.PRc };
    const D = R({ nt: 2, merge: true, inlet: { dp: 334.4772272, v: 29.967308 } }); o.D = { total: D.total, PRc: D.PRc, m: D.m };
    const D2 = R({ nt: 2, inlet: { dp: 334.4772272, v: 29.967308 } }); o.D2 = { total: D2.total, PRc: D2.PRc };
    const E = R({ dt: 63.5, dci: 76.2, inlet: { dp: 4792.377858, v: 117.471846 } }); o.E = { PRc: E.PRc, inExp: E.trIn.exp, inDp: E.trIn.dp };
    const F = R({ angH: [90, 45], angC: [90], rb: 100 }); o.F = { total: F.total };
    const hot3 = A.tbl.hot.rows.find(x => Math.abs(x.od - 76.2) < 1e-9); o.tbl = { rec: A.tbl.hot.rec.od, vG: hot3.vG, mach: hot3.mach, dp: hot3.dp };
    return o;
  });
  // defaults of the existing section are unchanged
  near(v.c0.dp, 14533.603, 1e-6, 'calcCharge defaults, compressor to throttle, Pa (unchanged)');
  near(v.c1.hot, 1097.4288 + 2932.7657, 1e-6, 'separate cold side: hot side unchanged, Pa');
  near(v.c1.cold, 351.2114, 1e-5, 'separate cold side 72.898 mm: cold friction, Pa');
  near(v.c1.coldB, 1255.7415, 1e-5, 'separate cold side: cold bends, Pa'); near(v.c1.v, 62.48086, 1e-5, 'separate cold side: cold speed, m/s');
  near(v.c1.dp, 12532.147, 1e-6, 'separate cold side: total, Pa');
  // the route
  near(v.A.P1, 100109.566, 1e-8, 'compressor inlet pressure after the inlet tube, Pa');
  near(v.A.P2, 170984.534, 1e-7, 'compressor outlet pressure, Pa');
  near(v.A.PRc, 1.7079740, 1e-6, 'compressor pressure ratio with every loss');
  near(v.A.PRno, 1.6874861, 1e-6, 'pressure ratio without the inlet loss');
  ok(v.A.PRc > v.A.PRno && v.A.PRno > 1.544367, 'the inlet loss raises the pressure ratio (' + v.A.PRc.toFixed(4) + ' > ' + v.A.PRno.toFixed(4) + ' > 1.5444)');
  near(v.A.t2, 101.570, 1e-4, 'compressor outlet °C with the inlet loss'); near(v.A.t2no, 99.833, 1e-4, 'without it'); near(v.A.t2thr, 87.258, 1e-4, 'with no losses');
  near(v.A.total, 15716.968, 1e-6, 'total loss, filter to throttle, Pa');
  near(v.A.tbK, 0.025658, 2e-4, 'cold pipe -> throttle cone K (Rennels, 7.0°)'); ok(v.A.tbA === 7, 'best cone angle 7.0° (got ' + v.A.tbA + ')');
  near(v.A.tbKs, 0.141301, 1e-5, 'cold pipe -> throttle sudden step, Borda-Carnot'); near(v.A.tbL, 130.815, 1e-4, 'cone length, mm');
  // transitions, cone against step
  ok(v.B.inA === 13 && v.B.coA === 8, 'best cones 13.0° (narrowing) and 8.0° (widening) (got ' + v.B.inA + ', ' + v.B.coA + ')');
  near(v.B.inK, 0.012917, 2e-4, 'inlet tube -> compressor, cone K'); near(v.B.inKs, 0.151705, 1e-5, 'inlet tube -> compressor, sharp contraction K');
  near(v.B.inDp, 50.047, 1e-3, 'inlet tube -> compressor, cone loss Pa'); near(v.B.coK, 0.018399, 2e-4, 'compressor outlet -> hot pipe, cone K');
  near(v.B.coKs, 0.082865, 1e-5, 'compressor outlet -> hot pipe, Borda-Carnot K');
  near(v.B.total, 16103.964, 1e-6, 'case B total with cones, Pa'); near(v.B.PRc, 1.7121958, 1e-6, 'case B pressure ratio with cones');
  near(v.B.B2total, 18596.806, 1e-6, 'case B total with step couplers, Pa'); near(v.B.B2PR, 1.7410921, 1e-6, 'case B pressure ratio with steps');
  near(v.C.total, 13648.845, 1e-6, 'route with a 72.898 mm cold side, Pa'); near(v.C.PRc, 1.6873154, 1e-6, 'its pressure ratio');
  near(v.D.m, 0.2165921, 1e-6, 'twin turbos: mass flow per turbo, kg/s'); near(v.D.total, 11981.089, 1e-6, 'twins into one intercooler, total Pa'); near(v.D.PRc, 1.6648058, 1e-6, 'its pressure ratio');
  near(v.D2.total, 9318.721, 1e-6, 'twins piped apart, total Pa'); near(v.D2.PRc, 1.6384433, 1e-6, 'its pressure ratio');
  ok(v.E.inExp === true, 'tube smaller than the compressor inlet: a widening step'); near(v.E.inDp, 159.777, 1e-3, 'its cone loss, Pa'); near(v.E.PRc, 1.7750648, 1e-6, 'its pressure ratio');
  near(v.F.total, 14037.077, 1e-6, 'bend angle lists and a 100 mm bend radius, total Pa');
  ok(Math.abs(v.tbl.rec - 76.2) < 1e-9, 'size table: hot side recommends 3.00 in OD'); near(v.tbl.vG / 0.3048, 292.4388, 1e-5, 'hot 3.00 in Garrett speed, ft/s');
  near(v.tbl.mach, 0.172197, 1e-4, 'hot 3.00 in Mach'); near(v.tbl.dp, 1758.269, 1e-5, 'hot 3.00 in loss, Pa');

  // the page, defaults
  let t = await secText();
  ok(/Compressor pressure ratio\s*\n\s*1\.708/.test(t), 'page: pressure ratio 1.708');
  ok(/Total loss, filter to throttle\s*\n\s*2\.28 psi \(15\.72 kPa\)/.test(t), 'page: total 2.28 psi (15.72 kPa)');
  ok(/Air leaving the compressor\s*\n\s*215 °F \(102 °C\)/.test(t) && /212 °F \(100 °C\) without the inlet loss/.test(t), 'page: outlet temperature with and without the inlet loss');
  const cp = await pg.$eval('#i-details .sec[data-sec="charge-pipes"]', e => e.innerText);
  ok(/Pressure lost, compressor to throttle\s*\n\s*2\.11 psi/.test(cp), 'existing Charge pipes section still 2.11 psi (14,533.6 Pa)');
  const rec = await pg.evaluate(() => ['ts-tbl-in', 'ts-tbl-hot', 'ts-tbl-cold'].map(id => { const r = document.querySelector('#' + id + ' tr[data-rec]'); return r ? r.dataset.od : null; }));
  ok(rec.join() === '3.00,3.00,3.00', 'size tables recommend 3.00 in for inlet, hot and cold (' + rec.join() + ')');
  const tblTxt = await pg.$eval('#ts-tbl-hot', e => e.innerText);
  ok(/2\.87 in \(72\.9 mm\)/.test(tblTxt) && /292 ft\/s \(89 m\/s\)/.test(tblTxt) && /0\.26 psi \(1\.76 kPa\)/.test(tblTxt), 'hot table row: ID, speed and loss in both units');
  const svgTxt = await pg.$eval('#ts-svg', e => e.textContent);
  ok(/ID 3\.50 in \(88\.9 mm\)/.test(svgTxt) && /24\.0 in \(610 mm\) long/.test(svgTxt) && /ID 2\.37 in \(60\.2 mm\)/.test(svgTxt) && /cone 5\.2 in \(131 mm\)/.test(svgTxt), 'schematic: every diameter and length in inches and mm');
  ok(/pressure ratio 1\.708/.test(svgTxt) && /Total 2\.28 psi/.test(svgTxt), 'schematic: pressure ratio and total');
  // metric display gives both units too
  await pg.click('#u-met'); await pg.waitForTimeout(300); t = await secText();
  ok(/15\.72 kPa \(2\.28 psi\)/.test(t) && /88\.9 mm \(3\.50 in\)/.test(await pg.$eval('#ts-svg', e => e.textContent)), 'metric: dual units kept');
  await pg.click('#u-imp'); await pg.waitForTimeout(300);
  // transitions on the page
  await setv('i-cid', '3'); await setv('i-cod', '2'); await setv('i-ici', '2.5'); await setv('i-ico', '2.5'); await pg.waitForTimeout(300);
  const steps = await pg.$eval('#ts-steps', e => e.innerText);
  ok(/13\.0° included/.test(steps) && /8\.0° included/.test(steps) && /K 0\.152/.test(steps) && /K 0\.083/.test(steps), 'size-change table: cones and sudden steps');
  t = await secText(); ok(/Compressor pressure ratio\s*\n\s*1\.712/.test(t) && /2\.34 psi \(16\.10 kPa\)/.test(t), 'page: transitions in the total and the ratio (1.712, 16.10 kPa)');
  await setv('i-cpstep', 'step'); await pg.waitForTimeout(300); t = await secText();
  ok(/Compressor pressure ratio\s*\n\s*1\.741/.test(t) && /2\.70 psi \(18\.60 kPa\)/.test(t) && /step couplers cost/.test(t), 'page: step couplers counted (1.741, 18.60 kPa)');
  await setv('i-cpstep', 'cone'); for (const id of ['i-cid', 'i-cod', 'i-ici', 'i-ico']) await setv(id, '');
  // inlet tube smaller than the compressor inlet
  await setv('i-dt', '2.5'); await setv('i-cid', '3'); await pg.waitForTimeout(300); t = await secText();
  ok(/Needs a change/.test(t) && /smaller than the compressor inlet/.test(t), 'warning: inlet tube smaller than the compressor inlet');
  ok(/Compressor pressure ratio\s*\n\s*1\.775/.test(t), 'page: 1.775 with the small inlet tube');
  await setv('i-dt', '3.5'); await setv('i-cid', '');
  // separate cold side on the page
  await setv('i-cpd2', '2.87'); await pg.waitForTimeout(300); t = await secText();
  ok(/Compressor pressure ratio\s*\n\s*1\.687/.test(t) && /ID 2\.87 in \(72\.9 mm\)/.test(await pg.$eval('#ts-svg', e => e.textContent)), 'page: separate cold side (1.687)');
  await setv('i-cpd2', '');
  // Use these sizes
  await pg.click('button[data-tsuse]'); await pg.waitForTimeout(400);
  const after = await pg.evaluate(() => ({ dt: document.getElementById('i-dt')._b, dh: document.getElementById('i-cpd')._b, dc: document.getElementById('i-cpd2').value }));
  ok(Math.abs(after.dt - 72.898) < 1e-6 && Math.abs(after.dh - 72.898) < 1e-6 && after.dc === '', 'Use these sizes fills 72.898 mm inlet and hot, cold left as the same (' + JSON.stringify(after) + ')');
  t = await secText(); ok(/Sized well/.test(t), 'after Use these sizes the verdict is plain: sized well');
  await setv('i-dt', '3.5'); await setv('i-cpd', '2.37');
  // twins
  await setv('i-nt', '2'); await setv('i-cpy', 'ic'); await pg.waitForTimeout(300); t = await secText();
  ok(/Compressor pressure ratio\s*\n\s*1\.665/.test(t) && /one pipe for both turbos/.test(t) && !(await pg.$('#ts-tbl-y')), 'twins into one intercooler: 1.665, combined cold pipe');
  await setv('i-cpy', 'tb'); await pg.waitForTimeout(300); t = await secText();
  ok(/Compressor pressure ratio\s*\n\s*1\.638/.test(t) && !!(await pg.$('#ts-tbl-y')) && /meet at a Y at the throttle/.test(t), 'twins apart: 1.638, merged-pipe table shown');
  await setv('i-nt', '1');
  // persistence: the project snapshot carries the new inputs
  await setv('i-cpd2', '2.62'); await setv('i-cpah', '90, 45');
  // (projects save every 'form input[id], form select[id]', PROJ_STATIC: base value for number fields, text otherwise)
  const snap = await pg.evaluate(() => { const set = new Set([...document.querySelectorAll('form input[id], form select[id]')].map(e => e.id));
    return ['i-cpd2', 'i-cid', 'i-cod', 'i-ici', 'i-ico', 'i-cpr', 'i-cpah', 'i-cpac', 'i-cpstep', 'i-cpy'].filter(id => !set.has(id)).concat([document.getElementById('i-cpd2')._b, document.getElementById('i-cpah').value]); });
  ok(snap.length === 2 && Math.abs(snap[0] - 66.548) < 1e-6 && snap[1] === '90, 45', 'every new input is in the project snapshot set, base values read back (' + JSON.stringify(snap) + ')');
  await setv('i-cpd2', ''); await setv('i-cpah', '');
  t = await pg.$eval('#i-details', e => e.innerText);
  ok(!/\bNaN\b|\bundefined\b/.test(t), 'no NaN or undefined on the tab');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await pg.close();
  // phone width
  const ph = await b.newPage({ viewport: { width: 400, height: 860 } }); const e2 = []; ph.on('pageerror', e => e2.push(e.message));
  await ph.goto('file://' + process.cwd() + '/index.html#intake'); await ph.waitForTimeout(900);
  await ph.evaluate(() => { const el = document.getElementById('i-ind'); el.value = 'turbo'; el.dispatchEvent(new Event('change', { bubbles: true })); }); await ph.waitForTimeout(400);
  ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && !!document.getElementById('ts-svg')), '400 px: no sideways page scroll with the tables and schematic');
  ok(!e2.length, '400 px: no page errors ' + e2.join('; '));
  await b.close();
  console.log(fails.length ? 'turbosize_ui: ' + fails.length + ' failing' : 'turbosize_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
