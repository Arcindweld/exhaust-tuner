// Boost audit 3 (docs/BOOST_AUDIT_2026-11-12.md, Part 2): one check per fix, each pinned to an independent value, and the
// independent recomputations of what was found correct. node tests/boostaudit2_ui.js   (from web/)
//
// Independent values (tools/validation/boost/, written for this audit from the sources; none ported from the page):
//  mounts.py  M1 three mounts at (-200, 0, -100), (300, 0, -100), (-100, 0, 250) mm under 10 kg at the centre: statics
//             (three equations, three unknowns) 36.4247 / 33.6228 / 28.0190 N; the 6 x 6 rigid body on equal springs gives
//             the same, and with 25 g sideways and the mass 80 mm up the first mount carries (838.726645, 355.8413, -36.867105) N.
//             M2 damped transmissibility 0.2 at r = 2.507488 (brentq, z 0.07): 7 kg on four at 28.333 Hz -> 11.29949 Hz,
//             8.820948 N/mm (the page had the undamped r = 2.4495: 9.244 N/mm, whose damped T is 21.09 %).
//             M3 3/16 in x 54 mm strap, 63.5 mm reach, 25 g forward on 7 kg / 4: von Mises 134.3146 MPa; side 25 g with a 20 mm
//             offset: 42.6303 MPa. M4 3/4 x 0.065 in steel stay 300 mm: L/k 48.55 < 127.74, Johnson 20764.06 N (the page
//             took yield, 22380.66 N). M5 M8 8.8: 21228 N proof, 15763.70 N shear (minor area, d3 6.46641 mm). M6 strap welded
//             both faces, forward case: 106.4523 N/mm.
//  conflux.py C2 UA from the tabulated effectiveness (cross-flow both unmixed: the series checked against a direct 600 x 600
//             2-D solution to 3e-7), 100012 at 0.40 kg/s, cp 1004.675 J/kg K (ideal air at gamma 1.4, the page's stated
//             constant): cross 992.0958, counter 910.9411 W/K; drop at 0.50 kg/s scaled to 170984.5 Pa,
//             101.57 °C: 16.0 x 1.621134 = 25.9381 kPa (by pressure alone it would be x 2.046969).
//             O2 100218 at 130 L/min, 110 / 70 °C: one unit 67588.57 W, 86.2 kPa; O3 effectiveness at the maker's 50 and
//             150 L/min with oil as Cmin: 0.674149, 0.373531.
//  xflow.py   X7 two new exhaust cases (xflow_page2.js): near choking (57.15 mm OD tail, chamber on 53.848 mm, tip Mach 0.956):
//             back pressure 141021.777 Pa (page 141090.102, +0.05 %); plug 150 mm 20 %, 63.5 mm OD tail, black, 100 mph,
//             Wendland: 83212.416 Pa (page 83262.376, +0.06 %).
//  O1 Engineering ToolBox engine oil 320 K 872 kg/m³ 1.99 kJ/kg K, 340 K 860 / 2.08: at 50 °C (323.15 K) 870.11 / 2004.18.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.abs(want), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(9) : a) + ', independent ' + (+want.toPrecision(9)));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  // one evaluate per read (a $eval is two round trips, and the page re-renders on the next animation frame: see turbosize_ui)
  const txt = sel => pg.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText : ''; }, sel);
  const setv = async (id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await pg.waitForTimeout(120); };
  const tso = async (k, v) => { await pg.evaluate(([k, v]) => { const el = document.querySelector('select.tsox[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]); await pg.waitForTimeout(150); };
  const G = 9.80665;

  // ---------------------------------------------------------------- Mounts (Hangers tab)
  await pg.goto('file://' + process.cwd() + '/index.html#hangers'); await pg.waitForTimeout(1200);
  const M = await pg.evaluate(G => { const T = window.__mounts, W = 10 * G, P3 = [[-200, 0, -100], [300, 0, -100], [-100, 0, 250]];
    const S = T.mtSec([{ u0: -27, u1: 27, f0: -4.7498 / 2, f1: 4.7498 / 2 }]), Ff = 25 * 7 * G / 4, Fd = 7 * G / 4;
    return { v: T.mtShares(P3, [0, -W, 0]).F.map(f => -f[1]), s: T.mtShares(P3, [25 * W, -W, 0], [0, 80, 0]).F[0],
      fw: T.mtSecStress(S, Fd, 63.5 * Ff, 0, 0, Ff).vm, sd: T.mtSecStress(S, Fd, 0, 63.5 * Ff, 20 * Ff, Ff).vm,
      bc: T.mtBoltCap({ bolt: 'm8', cls: '88' }), wg: T.mtWeldGroup([{ u0: -27, u1: 27, f0: -4.7498 / 2, f1: 4.7498 / 2 }], Fd, 63.5 * Ff, 0, 0, Ff).fr }; }, G);
  [36.4247, 33.6228, 28.0190].forEach((x, i) => near(M.v[i], x, 1e-6, 'M1 asymmetric three mounts, vertical load: mount ' + (i + 1) + ' (statics), N'));
  near(M.s[0], 838.726645, 1e-8, 'M1 25 g sideways, mass 80 mm up: mount 1 side force (rigid body on equal springs), N');
  near(M.s[1], 355.8413, 1e-8, 'M1 the same: mount 1 vertical, N');
  near(M.fw, 134.3146, 1e-6, 'M3 strap root von Mises, forward 25 g, MPa'); near(M.sd, 44.697311, 1e-6, 'M3 side 25 g with a 20 mm offset (torsion), MPa');
  // M3 torsion (2026-11-13): Saint-Venant's series for each rectangle in place of the thin-wall b t³/3. Hand (tools/validation/
  // boost/mounts.py, its own series and Roark's closed forms, Young and Budynas 7th ed. ch. 10 p. 401 as quoted by amesweb.info):
  // strap 54 × 4.7498 mm, side case: tau 24.879544 MPa (series), 24.892393 (Roark), 23.639413 (thin wall, the page before);
  // von Mises 44.697311 (series; Roark 44.718768, 0.05% apart; was 42.6303). Coefficients J = beta b t³, tau = T/(alpha b t²):
  // b/t 1: beta 0.14058, alpha 0.20817; 2: 0.22868, 0.24588; 10: 0.31233, 0.31233 (series); Roark 0.14083 0.20785,
  // 0.22888 0.24547, 0.31233 0.31208
  { const tc = await pg.evaluate(() => [1, 2, 10].map(r => { const T = window.__mounts.mtRectTor(r, 1); return [T.J / r, T.J / (T.k * r)]; }));
    [[0.14058, 0.20817], [0.22868, 0.24588], [0.31233, 0.31233]].forEach(([be, al], i) => { near(tc[i][0], be, 5e-5, 'M3 torsion beta at b/t ' + [1, 2, 10][i]); near(tc[i][1], al, 5e-5, 'M3 torsion alpha at b/t ' + [1, 2, 10][i]); }); }
  near(M.bc.T, 21228, 1e-9, 'M5 M8 8.8 proof load, N'); near(M.bc.V, 15763.70, 1e-6, 'M5 M8 8.8 shear on the minor area, N');
  near(M.wg, 106.4523, 1e-6, 'M6 fillet welds on both faces of the strap, line method, N/mm');
  const set = (id, v) => pg.evaluate(([id, v]) => window.__mounts.set(id, v), [id, v]);
  const sel = (id, v) => pg.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const R = () => pg.evaluate(() => JSON.parse(JSON.stringify(window.__mounts.last())));
  await set('mt-rpm', 850); await set('mt-cyl', 4); await pg.waitForTimeout(150);
  let r = await R();
  near(r.iso.fnMax, 11.29949, 1e-5, 'M2 bounce limit from the damped transmissibility (20 %, z 0.07), Hz');
  near(r.iso.kMax, 8.820948, 1e-5, 'M2 stiffness per mount at most, N/mm (was 9.244 from the undamped inversion)');
  await set('mt-h1', 300); await sel('mt-type', 'stay'); await pg.waitForTimeout(150); r = await R();
  const comp = r.designs[0].best.checks.rows.find(x => /compression/.test(x.what));
  near(comp.cap, 20764.06, 1e-6, 'M4 stay in compression: Johnson’s parabola below L/k 127.7, N (was yield 22380.66)');
  ok(/Johnson’s parabola/.test(comp.what) && /L\/k 48\.6 below the 127\.7/.test(comp.how), 'M4 the row names the column formula and the slenderness: ' + comp.what + ' / ' + comp.how);
  await sel('mt-type', 'strap'); await sel('mt-light', 'round'); await set('mt-h1', 150); await pg.waitForTimeout(150); r = await R();
  const lh = r.designs[0].best.checks.rows.find(x => /lightening hole/.test(x.what));
  ok(lh && /no stress concentration factor/.test(lh.how) && /fatigue, which is not checked/.test(lh.how), 'M8 the net-section row says Kt is not applied and why');
  await sel('mt-light', 'none'); await sel('mt-mat', 'al6061'); await sel('mt-att', 'weld'); await pg.waitForTimeout(150); r = await R();
  const wr = r.designs[0].best.checks.rows.find(x => /Fillet welds at the foot/.test(x.what));
  ok(wr && /a typical breaking strength, not an allowable/.test(wr.how) && /safety factor is on failure/.test(wr.how), 'M6 the aluminium weld row states that its figure is a typical failure strength');
  await sel('mt-mat', 'a36'); await sel('mt-att', 'bolt'); await set('mt-h1', 63.5); await pg.waitForTimeout(100);

  // ---------------------------------------------------------------- S1: the build sheet's mount rows
  // a fresh page: opening the Hangers tab alone must not put the designer's example on the turbo build sheet
  const pg2 = await b.newPage({ viewport: { width: 1280, height: 900 } }); pg2.on('pageerror', e => errs.push(e.message));
  await pg2.goto('file://' + process.cwd() + '/index.html#hangers'); await pg2.waitForTimeout(1200);
  await pg2.evaluate(() => { location.hash = 'intake'; }); await pg2.waitForTimeout(600);
  await pg2.evaluate(() => { const el = document.getElementById('i-ind'); el.value = 'turbo'; el.dispatchEvent(new Event('change', { bubbles: true })); }); await pg2.waitForTimeout(500);
  let sh = await pg2.evaluate(() => { const s = window.__tg.sheet(); return s && s.parts.filter(x => /^Mount|^Isolators/.test(x[0])).length; });
  ok(sh === 0, 'S1 the untouched Mounts designer adds no rows to the turbo build sheet (got ' + sh + ')');
  // set it up for the intercooler picked on the Intake tab; then change the pick: the sheet follows the new pick
  await pg2.evaluate(() => { location.hash = 'hangers'; }); await pg2.waitForTimeout(500);
  await pg2.evaluate(() => { const s = document.getElementById('mt-part'); s.value = 'build'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await pg2.waitForTimeout(300);
  await pg2.evaluate(() => { location.hash = 'intake'; }); await pg2.waitForTimeout(500);
  const ics = await pg2.evaluate(() => { const L = window.__tso.IC_LIB; return [L.findIndex(c => c.pn === '100012'), L.findIndex(c => c.pn === '100013')]; });
  await pg2.evaluate(k => window.__tso.icApply(k), String(ics[0])); await pg2.waitForTimeout(300);
  await pg2.evaluate(() => { location.hash = 'hangers'; }); await pg2.waitForTimeout(500);
  await pg2.evaluate(() => { location.hash = 'intake'; }); await pg2.waitForTimeout(500);
  await pg2.evaluate(k => window.__tso.icApply(k), String(ics[1])); await pg2.waitForTimeout(300);
  sh = await pg2.evaluate(() => { const s = window.__tg.sheet(); return s ? s.parts.filter(x => /^Mount/.test(x[0])).map(x => x[0]) : null; });
  ok(sh && sh.length >= 2 && sh.every(n => /Conflux Technology 100013/.test(n)), 'S1 after changing the pick to 100013 without revisiting the Hangers tab the sheet’s brackets are for 100013: ' + (sh || []).join('; '));
  await pg2.close();

  // ---------------------------------------------------------------- Intake tab
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(300);

  // R1: the intercooler order with an unknown value (Infinity) does not depend on the list order, and the reason is right
  const rec = await pg.evaluate(() => { const T = window.__tso;
    const core = (pn, extra) => Object.assign({ maker: 'Test', pn, type: 'a2a', hp: 500, hpAlt: null, kw: null, model: 'test core', inD: null, outD: null, dims: [[24, 609.6], [12, 304.8], [3.5, 88.9]], dp: null, pub: {}, mass: null }, extra || {});
    const base = { hpCore: 450, m: 1, Qreq: 20000, Ch: 450, thi: 100, tamb: 30, mc: 0.45, mh: 0.45, rec: null, w: 1.65, step: false, P2: 170000, Pt: 160000, t3: 40, a2a: true, therm: () => null, lim: null, ice: 0.75 };
    // A publishes more (five items) but no drop; B publishes a drop: the drop key comes before published data
    const A = core('A', { pub: { cons: 'bar and plate', tanks: 'cast', ptest: '50 psi', boost: '30 psi', warranty: 'lifetime' } }), B = core('B', { dp: { kPa: 5, kgmin: 27 } });
    const one = l => { const r = T.icRecommend(Object.assign({}, base, { list: l })); return r.ok.map(x => x.c.pn + ': ' + x.why); };
    return { ab: one([[A, 'a'], [B, 'b']]), ba: one([[B, 'b'], [A, 'a']]) }; });
  ok(rec.ab[0].startsWith('B:') && rec.ba[0].startsWith('B:'), 'R1 the core with a published drop ranks first whichever comes first in the list: ' + rec.ab[0].slice(0, 3) + ' / ' + rec.ba[0].slice(0, 3));
  ok(/^A: .*higher or unpublished pressure drop/.test(rec.ab[1]) && /^A: .*higher or unpublished pressure drop/.test(rec.ba[1]), 'R1 and the reason for the second names the drop, not “less published data”');

  // C2: Conflux model against conflux.py
  const C = await pg.evaluate(() => { const T = window.__tso, c = T.IC_LIB.find(x => x.pn === '100012'), Mm = T.cfxModel(c);
    return { ux: Mm.pts[0].UAx, uc: Mm.pts[0].UAc, cp: Mm.pts[0].Ch / 0.40, dp: T.cfxDp(c, 0.50, 170984.534, 101.5698).dp }; });
  near(C.ux, 992.0958, 2e-7, 'C2 100012 UA at 0.40 kg/s, cross-flow both unmixed, W/K');
  near(C.uc, 910.9411, 2e-7, 'C2 the same, counter-flow');
  near(C.cp, 1004.675, 1e-9, 'C2 the air cp the page states (gamma 1.4 ideal air), J/kg K');
  near(C.dp, 25938.1, 2e-6, 'C2 drop at 0.50 kg/s scaled by the density ratio to 170984.5 Pa and 101.57 °C, Pa');
  // Bell: both readings stated
  const bell = await pg.evaluate(() => window.__tso.IC_LIB.find(c => c.pn === 'A350097240').hpBasis);
  ok(/read as actual cfm at its 10 psig the core moves 24\.696 ÷ 14\.696 = 1\.68 × the mass, 510 hp/.test(bell) && /2\.82 × lower/.test(bell), 'Bell: the rating line gives both readings (303 hp as standard cfm, 510 hp as actual at 10 psig; drop 2.82 × lower)');

  // O1-O3: oil
  const O = await pg.evaluate(() => { const T = window.__tso, c = T.OIL_LIB.find(x => x.pn === '100218'), S = T.oilSize(c, 130, 20221, 110, 70);
    return { p50: T.oilProps(50), Q: S.ok.Qtot, dp: S.ok.dp, n: S.ok.n, e0: T.oilEps(c, 0), e4: T.oilEps(c, 4) }; });
  near(O.p50.rho, 870.11, 1e-6, 'O1 engine oil density at 50 °C from the ToolBox rows 320 / 340 K (was clamped to 860)'); near(O.p50.cp, 2004.175, 1e-6, 'O1 specific heat at 50 °C, J/kg K');
  ok(O.p50.clamped === false, 'O1 50 °C is inside the table (260-400 K)');
  ok(O.n === 1, 'O2 one 100218 at 130 L/min'); near(O.Q, 67588.571, 1e-7, 'O2 its heat at 110 / 70 °C, W'); near(O.dp, 86200, 1e-9, 'O2 its oil drop, Pa');
  near(O.e0, 0.674149, 1e-5, 'O3 effectiveness at the maker’s 50 L/min, oil the smaller capacity rate'); near(O.e4, 0.373531, 1e-5, 'O3 at 150 L/min');

  // R2: a space limit that rules out every core says so; R3: twin turbos into one core are rated against the whole engine
  const setx = async (k, v) => { await pg.evaluate(([k, v]) => { const e = document.querySelector('.tsox[data-k="' + k + '"]'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]); await pg.waitForTimeout(300); };
  await setv('i-hp', '450');
  for (const [k, v] of [['lmL', '100'], ['lmH', '100'], ['lmT', '30']]) await setx(k, v);
  const none = await txt('#tso-icrec-none-a2a'), nA2a = await pg.evaluate(() => window.__tso.IC_LIB.filter(c => c.type === 'a2a').length);
  ok(new RegExp('Your space rules out ' + nA2a + ' of the ' + nA2a + ' \\(\\d+ on size alone').test(none) && /more space/.test(none), 'R2 a 100 x 100 x 30 mm space rules out every air-to-air core, and the note says so: ' + none.slice(0, 160));
  for (const k of ['lmL', 'lmH', 'lmT']) await setx(k, '');
  await setv('i-nt', '2'); await pg.evaluate(() => { const s = document.getElementById('i-cpy'); s.value = 'ic'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await pg.waitForTimeout(400);
  const tw = await pg.evaluate(() => { const r = window.__tso.TG().icrec.a2a.pick, L = window.__tsLast(); return { merged: L.merged, ratio: r.ratio, r: r.r, mc: L.mc, m: L.m }; });
  ok(tw.merged && Math.abs(tw.ratio - tw.r / 450) < 1e-12 && Math.abs(tw.mc - 2 * tw.m) < 1e-12, 'R3 twins into one core: the pick is rated against the whole 450 hp (' + tw.r + ' hp, ' + tw.ratio.toFixed(3) + ' ×) and the core carries both turbos’ air');
  await setv('i-nt', '1');

  // X7: two new exhaust cases (xflow_page2.js's settings) against xflow.py
  await pg.click('#u-met'); await pg.waitForTimeout(300); await setv('i-hp', '450');
  const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862')));
  await tso('turbo', String(ti));
  const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.outlet === '4-bolt'), ti);
  await tso('hs', String(hs)); await pg.click('button[data-tsuse]'); await pg.waitForTimeout(300);
  await setv('s-ind', 'turbo1'); await setv('m-dp', '53.848'); await setv('s-od', '57.15'); await setv('s-len', '2500'); await setv('i-xcat', 'none'); await setv('i-dpb', '0');
  await pg.waitForTimeout(300);
  let X = await pg.evaluate(() => { const m = window.__tsx.last().X; const tip = m.rows.find(r => r.k === 'tip'); return { bp: m.bp, choke: !!m.choke, M: tip && tip.sOut.M }; });
  near(X.bp, 141021.777, 1e-3, 'X7 near choking (tip Mach ' + (X.M || 0).toFixed(3) + '): back pressure at the turbine outlet, Pa (xflow.py)');
  ok(!X.choke && X.M > 0.95 && X.M < 0.96, 'X7 not reported choked at Mach 0.956');
  await setv('s-od', '50.8'); await setv('m-dp', '47.498'); await pg.waitForTimeout(300);
  X = await pg.evaluate(() => { const m = window.__tsx.last().X; return { choke: m.choke && m.choke.k }; });
  ok(X.choke === 'tip', 'X7 a 2.0 in OD tail chokes at the tip and says so');
  await setv('i-dpb', '2'); await setv('i-xmuf', 'plug'); await setv('m-dp', '72.898'); await setv('m-plugl', '150'); await setv('m-por', '20'); await setv('s-od', '63.5');
  await setv('i-xfin', 'black'); await setv('i-xv', '44.704'); await setv('i-xcaf', 'w'); await pg.waitForTimeout(300);
  X = await pg.evaluate(() => window.__tsx.last().X.bp);
  near(X, 83212.416, 1e-3, 'X7 plug muffler, 63.5 mm tail, black, 100 mph, Wendland: back pressure, Pa (xflow.py)');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails.length ? 'boostaudit2_ui: ' + fails.length + ' failed' : 'boostaudit2_ui: all pass');
  process.exit(fails.length ? 1 : 0);
})();
