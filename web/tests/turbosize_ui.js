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
// Phase 2, turbo and intercooler sizing (hand script hand2.py, same rules):
//   Garrett Turbo Tech 103 known answers: 400 hp x A/F 12 x BSFC 0.55 / 60 = 44.0 lb/min; MAP = 44 x 639.6 x (460+130) /
//   (0.92 x 7200/2 x 122) = 41.0925 psia (Garrett: 41.1), PR (41.0925 + 2) / (14.7 - 1) = 3.1454 (Garrett: 3.14); 5.0 L,
//   302 cu in, 6000 RPM, VE 0.85: 21.5609 psia (Garrett: 21.6), PR 1.7198 (Garrett: 1.72).
//   Corrected flow, defaults: 0.4331842 kg/s x sqrt((86 + 460)/545) / (100109.566 Pa = 14.51972 psia / 13.95) = 0.416570 kg/s.
//   Compressor power 0.4331842 x 1004.675 (1.4 x 287.05 / 0.4) x (101.5698 - 30) = 31147.85 W.
//   Exhaust at 950 °C, CH1.87 products (NASA polynomials): R 286.629, gamma 1.279849, cp 1310.856 J/kg K;
//   exhaust flow 0.4331842 x (1 + 1/12) = 0.4692829 kg/s. At eta 0.70: Wc / (me cp T3 eta) = 0.0591372,
//   ER = (1 - 0.0591372)^(-gamma/(gamma-1)) = 1.321519; at p3 = 101325 + 2 x 55158: turbine share 0.397550,
//   wastegate 0.602450; flow parameter 0.4692829 x 0.397550 x sqrt(1223.15) / 2.12641 bar = 3.082948. At eta 0.55: ER 1.430263, wastegate 0.494028.
//   Intercooler heat 0.4331842 x 1004.675 x (101.5698 - 44.1425) = 24992.93 W (1421.3 BTU/min). With 60 lb/min
//   (0.4535924 kg/s) of outside air: Cr = 435.215 / 455.716 = 0.955008, eps on Cmin 0.75, cross-flow unmixed NTU 4.446118,
//   UA 1934.99 W/K (boost audit 2026-11-12: the exact series, tools/validation/boost/ic_cases.py; the closed-form
//   approximation the page used before gave NTU 4.45237, UA 1937.71). Core drop rated 1.5 psi at 40 lb/min scaled to 57.30046 lb/min: 10342.1 x 1.432512^2 = 21222.99 Pa.
// Phase 3, valve placement and size (hand3.py). Flow through a restriction (Heywood app. C):
//   m = A p0 sqrt(2g/((g-1) R T0) (r^(2/g) - r^((g+1)/g))), r = max(p/p0, (2/(g+1))^(g/(g-1))).
//   Blow-off valve, defaults (cold side, recirculating): m 0.4331842 kg/s from Pt 156483 Pa, 317.292 K to P1 100109.57 Pa:
//   r 0.639747 (> critical 0.528282, not choked) -> Cd A = 1255.089 mm² (39.98 mm at Cd 1); 25, 32, 38 mm short, 50 mm passes.
//   Wastegate at eta 0.75: share 0.6289536 of 0.4692829 kg/s = 0.2951572 kg/s, p3 211641 Pa, 1223.15 K, gamma 1.279849,
//   R 286.629, to 101325 Pa: choked (r = critical 0.549396) -> Cd A = 1244.373 mm²; 38 mm (1134.1 mm²) short, 40 mm
//   (1256.6 mm²) passes. At eta 0.55: 0.2318387 kg/s -> 977.425 mm², 38 mm passes.
//   45° branch of 40 mm along the collector: 40 / sin 45° = 56.569 mm, so on a 152.4 mm collector its centre sits 28.284
//   to 124.116 mm from the flange; on a 50 mm collector it does not fit.
//   Blow-off valve position: cold side, the coupler's 38.1 mm + half the valve from the throttle face; final straight
//   (blank) = 914.4 - 2 x pi/2 x 1.5 x 60.198 = 630.724 mm. Blow-through MAF: 254 + 76.2 = 330.2 mm (+ half the valve);
//   with a 300 mm straight it no longer fits, so the page moves it to the hot side, 38.1 mm after the compressor outlet.
//   A 60 mm valve: cold 38.1 + 30 = 68.1 mm; the return window becomes 68.1 to 254 - 76.2 - 30 = 147.8 mm.
//   Cold side 500 mm with 6 bends (3 a side): straight 500 - 3 x pi/2 x 90.297 = 74.485 mm; a 60 mm valve needs 98.1 mm -> hot side.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.abs(want), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(7) : a) + ', hand ' + (+want.toPrecision(7)));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900); await require('./settle').typedPoint(pg);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  // One evaluate per read: pg.$eval queries the element and then reads it in a second round trip, and the page's
  // ResizeObserver re-renders #i-details on the next animation frame (requestAnimationFrame(renderActive)), so on a busy
  // machine the read could land on the replaced, detached node, whose innerText has no line breaks (the "1.775 with the
  // small inlet tube" check then missed its "\n" while the number was right). Querying and reading in one call is atomic.
  const q = (sel, fn) => pg.evaluate(([s, f]) => { const e = document.querySelector(s); if (!e) throw new Error('no element ' + s); return (0, eval)('(' + f + ')')(e); }, [sel, fn.toString()]);
  const secText = () => q('#i-details .sec[data-sec="inlet-and-charge-pipes-design-and-sizing"]', e => e.innerText).catch(() => '');
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
  const cp = await q('#i-details .sec[data-sec="charge-pipes"]', e => e.innerText);
  ok(/Pressure lost, compressor to throttle\s*\n\s*2\.11 psi/.test(cp), 'existing Charge pipes section still 2.11 psi (14,533.6 Pa)');
  const rec = await pg.evaluate(() => ['ts-tbl-in', 'ts-tbl-hot', 'ts-tbl-cold'].map(id => { const r = document.querySelector('#' + id + ' tr[data-rec]'); return r ? r.dataset.od : null; }));
  ok(rec.join() === '3.00,3.00,3.00', 'size tables recommend 3.00 in for inlet, hot and cold (' + rec.join() + ')');
  const tblTxt = await q('#ts-tbl-hot', e => e.innerText);
  ok(/2\.87 in \(72\.9 mm\)/.test(tblTxt) && /292 ft\/s \(89 m\/s\)/.test(tblTxt) && /0\.26 psi \(1\.76 kPa\)/.test(tblTxt), 'hot table row: ID, speed and loss in both units');
  const svgTxt = await q('#ts-svg', e => e.textContent);
  ok(/ID 3\.50 in \(88\.9 mm\)/.test(svgTxt) && /24\.0 in \(610 mm\) long/.test(svgTxt) && /ID 2\.37 in \(60\.2 mm\)/.test(svgTxt) && /cone 5\.2 in \(131 mm\)/.test(svgTxt), 'schematic: every diameter and length in inches and mm');
  ok(/pressure ratio 1\.708/.test(svgTxt) && /Total 2\.28 psi/.test(svgTxt), 'schematic: pressure ratio and total');
  // metric display gives both units too
  await pg.click('#u-met'); await pg.waitForTimeout(300); t = await secText();
  ok(/15\.72 kPa \(2\.28 psi\)/.test(t) && /88\.9 mm \(3\.50 in\)/.test(await q('#ts-svg', e => e.textContent)), 'metric: dual units kept');
  await pg.click('#u-imp'); await pg.waitForTimeout(300);
  // transitions on the page
  await setv('i-cid', '3'); await setv('i-cod', '2'); await setv('i-ici', '2.5'); await setv('i-ico', '2.5'); await pg.waitForTimeout(300);
  const steps = await q('#ts-steps', e => e.innerText);
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
  ok(/Compressor pressure ratio\s*\n\s*1\.687/.test(t) && /ID 2\.87 in \(72\.9 mm\)/.test(await q('#ts-svg', e => e.textContent)), 'page: separate cold side (1.687)');
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
  // phase 2: turbo and intercooler sizing
  const g = await pg.evaluate(() => { const T = window.__turbo;
    const a = T.garrettMatch({ hp: 400, afr: 12, bsfc: 0.55, tmF: 130, ve: 0.92, rpm: 7200, ci: 122, loss: 2, dep: 1 }), c = T.garrettMatch({ hp: 400, afr: 12, bsfc: 0.55, tmF: 130, ve: 0.85, rpm: 6000, ci: 302, loss: 2, dep: 1 });
    const tb7 = T.turbineBalance({ ma: 0.43318420652130163, afr: 12, t1: 30, t2: 101.56982099150139, tit: 950, p3: 101325 + 2 * 55158, p4: 101325, eta: 0.70 });
    const tb5 = T.turbineBalance({ ma: 0.43318420652130163, afr: 12, t1: 30, t2: 101.56982099150139, tit: 950, p3: 101325 + 2 * 55158, p4: 101325, eta: 0.55 });
    return { a, c, cor: T.corrFlow(0.43318420652130163, 30, 100109.56592394777), tb7, tb5, ntu: T.ntuFor(0.75, 0.9550077011244735), eps: T.epsXflow(4.446118391212853, 0.9550077011244735) }; });
  near(g.a.wa, 44, 1e-12, 'Garrett: 400 hp, A/F 12, BSFC 0.55 -> 44 lb/min'); near(g.a.map, 41.0925, 1e-5, 'Garrett 2.0 L MAP psia (published 41.1)');
  near(g.a.pr, 3.14544, 1e-5, 'Garrett 2.0 L PR (published 3.14)'); near(g.c.map, 21.56086, 1e-5, 'Garrett 5.0 L MAP psia (published 21.6)'); near(g.c.pr, 1.71977, 1e-5, 'Garrett 5.0 L PR (published 1.72)');
  near(g.cor, 0.416570, 1e-5, 'corrected flow, kg/s'); near(g.tb7.g, 1.279849, 1e-6, 'exhaust gamma at 950 °C'); near(g.tb7.cpe, 1310.856, 1e-6, 'exhaust cp');
  near(g.tb7.Wc, 31147.85, 1e-6, 'compressor power, W'); near(g.tb7.ER, 1.321519, 1e-6, 'turbine expansion ratio at eta 0.70'); near(g.tb7.wg, 0.602450, 1e-5, 'wastegate share at 2 x boost, eta 0.70');
  near(g.tb7.Ft, 3.082948, 1e-5, 'turbine flow parameter'); near(g.tb5.ER, 1.430263, 1e-6, 'expansion ratio at eta 0.55'); near(g.tb5.wg, 0.494028, 1e-5, 'wastegate share at eta 0.55');
  near(g.ntu, 4.446118, 1e-6, 'NTU for eps 0.75 at Cr 0.955 (cross-flow unmixed, exact series)'); near(g.eps, 0.75, 1e-9, 'and back');
  await setv('i-hp', '450'); await setv('i-icam', '60'); await setv('i-icrdp', '1.5'); await setv('i-icrf', '40'); await pg.waitForTimeout(400);
  t = await q('#i-details .sec[data-sec="turbo-and-intercooler-sizing"]', e => e.innerText);
  ok(/5,600\s+57\.3 lb\/min \(0\.433 kg\/s\)\s+55\.1 lb\/min \(0\.417 kg\/s\)\s+1\.708/.test(t) && /3,500\s+35\.8 lb\/min/.test(t), 'demand line: two points with corrected flow and PR');
  ok(/41\.8 hp \(31\.1 kW\)/.test(t) && /70%\s+1\.32\s+4\.73 psi/.test(t) && /60%\s+65%\s+[\d.]+ lb\/min·√°R\/psi \(3\.083 kg√K\/\(s·bar\)\)/.test(t), 'compressor power and turbine sweep rows on the page');
  const icx = await q('#i-details .sec[data-sec="intercooler-sizing"]', e => e.innerText);
  ok(/1421 BTU\/min \(25\.0 kW\)/.test(icx) && /0\.955/.test(icx) && /4\.45/.test(icx) && /1935 W\/K/.test(icx) && /3\.08 psi \(21\.22 kPa\)/.test(icx), 'intercooler: heat, Cr, NTU, UA, scaled core drop');
  await setv('i-teff', '68'); await pg.waitForTimeout(300);
  ok(await q('#ts-turb', e => /68% \(yours\)/.test(e.innerText)), 'a typed turbine efficiency is added and marked');
  for (const id of ['i-hp', 'i-icam', 'i-icrdp', 'i-icrf', 'i-teff']) await setv(id, '');
  // phase 3: where the valves go on this build
  const pl = await pg.evaluate(() => { const T = window.__turbo, g = 1.279849224790532, Re = 286.6291525445435;
    return { bov: T.orificeArea(0.43318420652130163, 156483, 44.14245524787535 + 273.15, 100109.56592394777, 1.4, 287.05), wg: T.orificeArea(0.29515717246448986, 211641, 1223.15, 101325, g, Re), wg55: T.orificeArea(0.23183872957954924, 211641, 1223.15, 101325, g, Re) }; });
  near(pl.bov.A * 1e6, 1255.089, 1e-5, 'blow-off valve effective area, mm²'); ok(!pl.bov.choked, 'blow-off valve flow not choked (r 0.6397)');
  near(pl.wg.A * 1e6, 1244.373, 1e-5, 'wastegate effective area at eta 0.75, mm²'); ok(pl.wg.choked, 'wastegate flow choked'); near(pl.wg55.A * 1e6, 977.425, 1e-5, 'wastegate area at eta 0.55, mm²');
  const place = async () => { await pg.waitForTimeout(250); return pg.evaluate(() => { const r = id => { const e = document.querySelector('#ts-place tr[data-place="' + id + '"]'); return e ? e.innerText : ''; }; return { bov: r('bov'), vent: r('vent'), ret: r('ret'), wg: r('wg'), wgsize: r('wgsize'), wgint: r('wgint'), maf: r('maf'), svg: document.getElementById('ts-svg').textContent }; }); };
  let P = await place();
  ok(/cold side, centre 1\.5 in \(38 mm\) before the throttle face, on the straight/.test(P.bov) && /24\.8 in \(631 mm\)/.test(P.bov), 'BOV: cold side 38 mm before the throttle, straight 631 mm');
  ok(/recirculates/.test(P.vent) && /1\.5 in \(38 mm\) and 7\.0 in \(178 mm\) from the compressor inlet/.test(P.ret), 'MAF draw-through: recirculate, return 38 to 178 mm from the compressor');
  ok(/1\.57 in \(40\.0 mm\) valve/.test(P.wgsize) && /1244 mm²/.test(P.wgsize) && /collector after the last merge/.test(P.wg) && /1\.1 in \(28 mm\) and 4\.9 in \(124 mm\)/.test(P.wg), 'wastegate: 40 mm on the collector, 28 to 124 mm from the flange');
  ok(/blow-off valve, before throttle:1\.5 in \(38 mm\)/.test(P.svg) && /return port, from the compressor:1\.5 in \(38 mm\) to 7\.0 in \(178 mm\)/.test(P.svg) && /wastegate 1\.57 in \(40\.0 mm\), 45°/.test(P.svg), 'drawing marks the valve, the return port and the gate in in and mm');
  await setv('i-bovd', String(60 / 25.4)); P = await place();
  ok(/centre 2\.7 in \(68 mm\) before/.test(P.bov) && /2\.7 in \(68 mm\) and 5\.8 in \(148 mm\)/.test(P.ret), 'a 60 mm valve: 68 mm from the throttle, return window 68 to 148 mm');
  await setv('i-mafpos', 'blow'); await setv('i-bovd', ''); P = await place();
  ok(/cold side, centre 13\.0 in \(330 mm\) before the throttle/.test(P.bov) && /may vent: it sits ahead of the MAF/.test(P.vent) && !P.ret && /10\.0 in \(254 mm\)/.test(P.maf), 'MAF blow-through: valve 330 mm before the throttle, upstream of the MAF, may vent');
  await setv('i-cpst', String(300 / 25.4)); P = await place();
  ok(/hot side, centre 1\.5 in \(38 mm\) after the compressor outlet/.test(P.bov) && /Garrett/.test(P.bov) && /blow-off valve, from compressor:1\.5 in \(38 mm\)/.test(P.svg), 'blow-through with a 300 mm final straight: moved to the hot side, 38 mm after the compressor');
  await setv('i-cpst', ''); await setv('i-mafpos', 'draw'); await setv('i-maf', 'sd'); P = await place();
  ok(/may vent: the engine meters by manifold pressure/.test(P.vent) && /Garrett/.test(P.vent) && !P.ret && /cold side, centre 1\.5 in/.test(P.bov), 'speed density: vent allowed, no return port');
  await setv('i-maf', 'card'); await setv('i-cpc', String(500 / 25.4)); await setv('i-cpb', '6'); await setv('i-bovd', String(60 / 25.4)); P = await place();
  ok(/hot side, centre 2\.7 in \(68 mm\) after the compressor outlet/.test(P.bov), 'short cold side with 3 bends (74.5 mm straight): a 60 mm valve goes to the hot side');
  await setv('i-cpc', '36'); await setv('i-cpb', '4'); await setv('i-bovd', '');
  await setv('i-mani', 'div'); P = await place(); ok(/one gate per scroll/.test(P.wg) && /common practice/.test(P.wg), 'twin-scroll: one gate per scroll, labelled common practice');
  await setv('i-mani', 'tube'); await setv('i-wgcl', String(50 / 25.4)); P = await place(); ok(/too short/.test(P.wg), 'a 50 mm collector is too short for a 45° 40 mm branch');
  await setv('i-wgcl', '6'); await setv('i-teff', '55'); P = await place(); ok(/1\.50 in \(38\.0 mm\) valve/.test(P.wgsize) && /977 mm²/.test(P.wgsize), 'turbine efficiency 55%: a 38 mm gate passes (977 mm²)');
  await setv('i-teff', ''); await setv('i-wgtype', 'int'); P = await place(); ok(/1244 mm²/.test(P.wgint) && /boost creep/.test(P.wgint) && !P.wg, 'internal gate: area and the boost-creep note');
  await setv('i-wgtype', 'ext');
  await setv('i-ind', 'centri'); await pg.waitForTimeout(300); P = await place(); ok(!P.wg && !P.wgint && /cold side/.test(P.bov), 'centrifugal blower: blow-off valve only, no wastegate');
  await setv('i-ind', 'turbo');
  t = await q('#i-details', e => e.innerText);
  // 2026-11-12: turbine inlet pressure as a multiple of boost (i-tipk, default 2 = the figures above). By hand, eta 0.75,
  // from the 2 x case: the turbine's need Wc / (me cp T3 eta) = 0.3710464 x (1 - (101325 / 211641)^0.218658) = 0.0551947
  // ((g - 1) / g = 0.279849 / 1.279849). At k: p3 = 101325 + k 55158; share = 1 - 0.0551947 / (1 - (101325 / p3)^0.218658);
  // gate flow = share x 0.4692829; choked (p4 / p3 under 0.549396 at every k here), so Cd A = flow / flux(p3) with the
  // flux as above, proportional to p3:
  //   k 2    p3 211641   avail 0.148754  share 0.628954  0.2951572 kg/s  1244.373 mm²  (39.80 mm at Cd 1)
  //   k 2.25 p3 225430.5 avail 0.160422  share 0.655941  0.3078219 kg/s  1218.383 mm²  (39.39 mm)
  //   k 2.5  p3 239220   avail 0.171251  share 0.677697  0.3180318 kg/s  1186.234 mm²  (38.86 mm)
  //   k 3    p3 266799   avail 0.190790  share 0.710704  0.3335212 kg/s  1115.415 mm²  (37.69 mm)
  // so the share rises with k and the area falls: the largest area in Bell's 2 to 2.5 is at 2 x.
  const wgk = async () => { await pg.waitForTimeout(300); return pg.evaluate(() => ({ rows: [...document.querySelectorAll('#ts-wgk tbody tr')].map(r => [+r.dataset.k, r.dataset.rec === '1', r.innerText]),
    cap: (document.getElementById('ts-wgk-cap') || {}).innerText || '', size: (document.querySelector('#ts-place tr[data-place="wgsize"]') || {}).innerText || '',
    flow: [...document.querySelectorAll('#i-details .r')].map(x => x.innerText).find(x => /Wastegate flow at peak power/.test(x)) || '', turb: document.getElementById('ts-turb').innerText.split('\n')[0] })); };
  let W = await wgk();
  ok(await q('#i-tipk', e => e._b === 2), 'turbine inlet pressure input defaults to 2 x boost');
  ok(W.rows.map(r => r[0]).join() === '2,2.25,2.5' && W.rows[0][1] && /1244 mm²/.test(W.rows[0][2]) && /63%/.test(W.rows[0][2]) && /1218 mm²/.test(W.rows[1][2]) && /66%/.test(W.rows[1][2]) && /1186 mm²/.test(W.rows[2][2]) && /68%/.test(W.rows[2][2]),
    'range table at 2, 2.25, 2.5 x boost: share 63 / 66 / 68 %, area 1244 / 1218 / 1186 mm² (yours: 2): ' + W.rows.map(r => r[2].replace(/\s+/g, ' ')).join(' | ').slice(0, 200));
  ok(/upper-side estimate/.test(W.cap) && /largest area in that range is at 2 × boost/.test(W.cap) && /inlet at 2 × boost \(Bell’s lower figure\)/.test(W.flow), 'the page says the gate size is an upper-side estimate under the 2 x assumption, largest at 2 x');
  await setv('i-tipk', '2.5'); W = await wgk();
  ok(/1186 mm²/.test(W.size) && W.rows.find(r => r[0] === 2.5)[1] && /Bell’s upper figure/.test(W.flow), 'at 2.5 x: the gate needs 1186 mm², the 2.5 row marked yours');
  await setv('i-tipk', '3'); W = await wgk();
  ok(W.rows.map(r => r[0]).join() === '2,2.25,2.5,3' && /1115 mm²/.test(W.rows[3][2]) && /71%/.test(W.rows[3][2]) && /at 3\.00 × boost \(yours\)/.test(W.turb) && /yours; Bell gives about 2 to 2\.5/.test(W.flow),
    'a typed 3 x: its own row (71 %, 1115 mm²) and its own column in the turbine table');
  await setv('i-tipk', '2');
  ok(!/\bNaN\b|\bundefined\b/.test(t), 'no NaN or undefined on the tab');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await pg.close();
  // phone width
  const ph = await b.newPage({ viewport: { width: 400, height: 860 } }); const e2 = []; ph.on('pageerror', e => e2.push(e.message));
  await ph.goto('file://' + process.cwd() + '/index.html#intake'); await ph.waitForTimeout(900); await require('./settle').typedPoint(ph);
  await ph.evaluate(() => { const el = document.getElementById('i-ind'); el.value = 'turbo'; el.dispatchEvent(new Event('change', { bubbles: true })); }); await ph.waitForTimeout(400);
  ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && !!document.getElementById('ts-svg')), '400 px: no sideways page scroll with the tables and schematic');
  ok(!e2.length, '400 px: no page errors ' + e2.join('; '));
  await b.close();
  console.log(fails.length ? 'turbosize_ui: ' + fails.length + ' failing' : 'turbosize_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
