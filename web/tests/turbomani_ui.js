// Turbo manifold (Intake tab, boosted; 2026-11-13): layout and pairing from the firing order, the runner size against the
// port, the gas speed and Mach number in the runner, the shortest equal length, the collector and turbine flange, the loss
// (against tools/validation/boost/turbomani.py), the volume, the heat growth, the support, the wastegate, the drawing, the
// cut list, the checklist step and the build sheet; dual units, 400 px, no page errors.   node tests/turbomani_ui.js (from web/)
//
// Sources the page quotes (read 2026-11-13): Garrett Turbo Tech 102 (GAM_Turbo-Systems-102_Advanced.pdf, section 3: 1-3-4-2
// "#1 and #4 are complementary; as are cylinders #2 and #3"); AutoSpeed's review quoting MacInnes ("about the same internal
// area as the ports") and Allard (log 2 to 2.5 x one port's area, 3.0 mm wall); Cleveland-Cliffs 304/304L and 321 data sheets
// (mean expansion from 32 F, in/in/F x 1e-6: 304 9.4 / 9.9 / 10.2 / 10.4 at 212 / 600 / 1000 / 1200 F; 321 9.2 / 9.5 / 10.3 /
// 10.7 / 11.2 at 212 / 600 / 1000 / 1200 / 1500 F); Ace Stainless Supply's ASTM A403 / B16.9 elbow sheet (NPS 1 1/2: OD
// 1.900, 10S wall 0.109 ID 1.682, 40S wall 0.145 ID 1.610, LR centre to face 2 1/4, SR 1 1/2 in); turbozentrum's T3 flange
// (port 61 x 44 mm, in the Flange presets since 2026-11-03).
//
// Hand arithmetic (build: Honda K24A2 preset, metric, turbo, 203.677 kPa (29.541 psi) boost, 450 hp, Precision GEN2 PT5862 with
// its 0.63 A/R T3 4-bolt housing, tubular manifold, port spacing 93 mm typed as an example (not a sourced K24 figure)):
//  - port: the preset's 1.771 in = 44.9834 mm, area pi/4 x 44.9834^2 = 1589.25 mm^2.
//  - recommended runner: 1.875 x 0.065 in tube, ID 1.745 in = 44.323 mm, area 1542.94 mm^2, (44.323/44.9834)^2 - 1 = -2.91%
//    (the nearest stocked area; 2.0 x 0.065: ID 47.498 mm, +11.49%; NPS 1 1/2 10S: ID 42.7228 mm, -9.80%).
//  - gas: me = R.m (1 + 1/12) per turbo, runner flow me / 4; p3 = 101325 + 2 x 203677 Pa; T0 = 950 + 273.15 = 1223.15 K; with
//    gamma held at exhGamma(T0) (the test fixes it, the page's own test switch) the runner state from
//    m = p A M sqrt(gamma psi / (R T0)), psi = 1 + (gamma - 1)/2 M^2, solved by bisection here; v = M sqrt(gamma R T0 / psi).
//  - shortest equal length (planar S, R = 1.875 in = 47.625 mm): ports at 0, 93, 186, 279 mm, merge at 139.5 mm; the outer
//    runners y = 139.5 >= 2R = 95.25: L = pi R + (y - 2R) = 149.618 + 44.25 = 193.868 mm, Z = 2R = 95.25 mm; the inner
//    y = 46.5 < 2R: theta = acos(1 - 46.5/95.25) = 59.2153 deg, L = 2R theta = 98.4413 mm; add 95.4270 mm.
//  - collector bore matched to the T3 port's 61 x 44 = 2684 mm^2: sqrt(4 x 2684 / pi) = 58.4583 mm.
//  - merge cone at 20 deg included from the runners' combined bore 44.323 x sqrt(4) = 88.646 mm to 58.4583 mm:
//    (88.646 - 58.4583) / 2 / tan(10 deg) = 85.60 mm long.
//  - volume: runners 4 x 1542.94 x 193.868 = 1.19651 L; merge frustum pi x 85.60 x (r1^2 + r1 r2 + r2^2) / 3, r1 29.229,
//    r2 44.323 mm = 0.36882 L; collector pi/4 x 58.4583^2 x 152.4 = 0.40904 L; total 1.97437 L; one cylinder 2354 / 4 =
//    588.5 cc: 3.355 x.
//  - growth (strain = 1.8e-6 x (abar(T) T - abar(Ta) Ta), abar from 32 F / 0 C, linear between the sheet's points):
//    321 at 800 C from 30 C: abar(800) = 10.7 + 0.5 x (800 - 648.9)/(815.6 - 648.9) = 11.15321 -> 20.07578 um/m K;
//    abar(30) = 9.2 -> 16.56; strain = 20.07578 x 800 - 16.56 x 30 = 15563.8e-6; over 200 mm: 3.11277 mm.
//    304 at 600 C: abar = 10.2 + 0.2 x (600 - 537.8)/(648.9 - 537.8) = 10.311971 -> 18.561548; strain = 11136.93e-6 - 16.92 x 30e-6
//    = 10629.33e-6; over 200 mm: 2.125866 mm. 304 at 800 C is past its table (1200 F): the page says "at least" and uses 10.4.
//  - pairing: I4 1-3-4-2 divided: 1+4, 2+3 (360 deg each); I6 1-5-3-6-2-4 divided: 1+2+3, 4+5+6 (240 deg); I6 twin turbos:
//    1, 2, 3 and 4, 5, 6; small-block Chevy 1-8-4-3-6-5-7-2 single turbo divided: 1+4+6+7 and 2+3+5+8 (both banks, 180 deg);
//    per bank (two turbos) 1, 3, 5, 7 fire at 0, 270, 450, 540 deg: 270 / 180 / 90 / 180, uneven; LS 1-8-7-2-6-5-4-3:
//    1+4+6+7 and 2+3+5+8.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.max(1e-12, Math.abs(want)), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(8) : a) + ', hand ' + (+want.toPrecision(8)));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900); await require('./settle').typedPoint(pg);
  await pg.click('#u-met'); await pg.waitForTimeout(200);
  const setv = async (id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await pg.waitForTimeout(250); };
  const tso = async (k, v) => { await pg.evaluate(([k, v]) => { const el = document.querySelector('select.tsox[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]); await pg.waitForTimeout(300); };
  const secTxt = () => pg.$eval('#i-details .sec[data-sec="turbo-manifold"]', e => e.innerText).catch(() => '');

  // 1. pairing from the firing order (pure)
  const L = await pg.evaluate(() => { const f = window.__mfd.layout, sc = m => m.scrolls.map(s => s.join('+')).join(' / ');
    const i4 = { name: 'Inline-4', key: 'i4', order: [1, 3, 4, 2], banks: [[1, 4], [2, 3]] }, i6 = { name: 'Inline-6', key: 'i6', order: [1, 5, 3, 6, 2, 4], banks: [[1, 2, 3], [4, 5, 6]] };
    const sbc = { name: 'Classic GM V8', key: 'sbc', order: [1, 8, 4, 3, 6, 5, 7, 2], banks: [[1, 3, 5, 7], [2, 4, 6, 8]] }, ls = { name: 'GM LS V8', key: 'ls', order: [1, 8, 7, 2, 6, 5, 4, 3], banks: [[1, 3, 5, 7], [2, 4, 6, 8]] };
    const a = f(i4, 1, 'div').mf[0], c = f(i6, 1, 'div').mf[0], d = f(i6, 2, 'tube').mf, e = f(sbc, 1, 'div').mf[0], g = f(sbc, 2, 'tube').mf, h = f(ls, 1, 'div').mf[0], t4 = f(i4, 1, 'tube').mf[0];
    return { i4: sc(a), i4g: a.sg.map(s => s.gaps.join('/')), i4cross: a.cross, i4tube: t4.gaps.join('/'), i6: sc(c), i6g: c.sg.map(s => s.gaps.join('/')), i6t: d.map(m => m.cyls.join(',')),
      sbc: sc(e), sbcEven: e.sg.map(s => s.even && s.cross), sbcBank: g.map(m => m.cyls.join(',') + ':' + m.gaps.join('/') + ':' + m.even), ls: sc(h) }; });
  ok(L.i4 === '1+4 / 2+3' && L.i4g.join(' ') === '360/360 360/360' && !L.i4cross, 'I4 1-3-4-2 divided: scrolls 1+4 and 2+3, 360° apart (Garrett): ' + L.i4 + ' ' + L.i4g.join(' '));
  ok(L.i4tube === '180/180/180/180', 'I4 into one collector: a pulse every 180°');
  ok(L.i6 === '1+2+3 / 4+5+6' && L.i6g.join(' ') === '240/240/240 240/240/240', 'I6 1-5-3-6-2-4 divided: 1+2+3 and 4+5+6, 240° apart: ' + L.i6);
  ok(L.i6t.join(' | ') === '1,2,3 | 4,5,6', 'I6 with two turbos: front three and rear three: ' + L.i6t.join(' | '));
  ok(L.sbc === '1+4+6+7 / 2+3+5+8' && L.sbcEven.every(Boolean), 'small-block Chevy, one divided turbo: 1+4+6+7 and 2+3+5+8, each 180° apart and from both banks');
  ok(L.sbcBank.join(' | ') === '1,3,5,7:270/180/90/180:false | 2,4,6,8:90/180/270/180:false', 'small-block Chevy, a turbo per bank: uneven on each (1, 3, 5, 7: 270/180/90/180; 8, 4, 6, 2: 90/180/270/180): ' + L.sbcBank.join(' | '));
  ok(L.ls === '1+4+6+7 / 2+3+5+8', 'LS 1-8-7-2-6-5-4-3, one divided turbo: 1+4+6+7 and 2+3+5+8');

  // 2. growth, the shortest S, the elbow table (pure)
  const P = await pg.evaluate(() => { const M = window.__mfd; const e = M.ELS.find(x => x.nps === '1½');
    return { s321: M.strain('321', 800, 30), s304: M.strain('304', 600, 30), s304h: M.strain('304', 800, 30), s347: M.strain('347', 700, 30), far: M.smin(139.5, 47.625), near: M.smin(46.5, 47.625), e }; });
  near(P.s321.eps * 200, 3.11277, 1e-5, '321 from 30 to 800 °C over 200 mm, mm (Cleveland-Cliffs 321)');
  near(P.s304.eps * 200, 2.125866, 1e-5, '304 from 30 to 600 °C over 200 mm, mm (Cleveland-Cliffs 304)');
  ok(P.s304h.atLeast && Math.abs(P.s304h.eps - 1.8e-6 * (10.4 * 800 - 9.4 * 30)) < 1e-12, '304 at 800 °C is past the sheet’s 1200 °F: “at least”, at the last coefficient');
  ok(P.s347.none, '347: the sheet gives the coefficient to 212 °F only, so no growth at 700 °C');
  near(P.far.L, Math.PI * 47.625 + 139.5 - 95.25, 1e-12, 'farthest runner, I4 at 93 mm, R 47.625 mm: πR + (y − 2R), mm');
  near(P.near.L, 95.25 * Math.acos(1 - 46.5 / 95.25), 1e-12, 'inner runner: 2R acos(1 − y/2R), mm');
  ok(P.e.od === 1.9 && P.e.w10 === 0.109 && P.e.id10 === 1.682 && P.e.w40 === 0.145 && P.e.id40 === 1.61 && P.e.lr === 2.25 && P.e.sr === 1.5, 'NPS 1½ elbow row as Ace Stainless Supply’s B16.9 sheet');

  // 3. the K24 build
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
  await pg.waitForTimeout(400);
  near(await pg.evaluate(() => document.getElementById('i-mport')._b), 1.771 * 25.4, 1e-12, 'the K24A2 preset fills the head flange’s port (Stainless Headers, 1.771 in), mm');
  await setv('i-ind', 'turbo'); await setv('i-boost', '203.677'); await setv('i-hp', '450');
  await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });
  let s = await pg.evaluate(() => (window.__tg.steps() || []).map(x => x.id).join(','));
  ok(s === 'engine,air,turbo,ar,pipes,ic,oil,valves,mani,exh,scan,sheet', 'checklist: the manifold step between the valves and the exhaust side: ' + s);
  const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862')));
  await tso('turbo', String(ti));
  const hs4 = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti);
  await tso('hs', String(hs4)); await setv('i-mani', 'tube'); await setv('i-msp', '93');
  let txt = await secTxt();
  ok(/Turbo manifold/.test(txt) && /Layout and pairing/.test(txt) && /MacInnes/.test(txt) && /Fatigue is not calculable here/.test(txt), 'the section is there, with its sources and the fatigue statement');
  const X = await pg.evaluate(() => { const X = window.__mfd.last(); return { rec: X.rec.cd.key, ratio: X.rec.ratio, id: X.c.id, mr: X.mr, me: X.o.me, ma: X.o.ma, p3: X.o.p3, L: X.L, Z: X.len.Z, extra: X.len.per.map(q => q.extra), dcol: X.dcol,
    vol: X.vol, tamb: X.o.tamb, Ts: X.heat.Ts, ms: X.heat.ms, mergeL: X.vol.mergeL, rows: X.rows.filter(r => /^(t1\.875|t2\.000|p1½-10)$/.test(r.cd.key)).map(r => [r.cd.key, r.ratio]) }; });
  ok(X.rec === 't1.875', 'recommended runner: 1.875 × 0.065 in tube (nearest the port’s area): ' + X.rec);
  near(X.ratio - 1, (44.323 / (1.771 * 25.4)) ** 2 - 1, 1e-4, 'its area against the port');
  near(X.rows.find(r => r[0] === 'p1½-10')[1] - 1, (1.682 * 25.4 / (1.771 * 25.4)) ** 2 - 1, 1e-9, 'NPS 1½ schedule 10S against the port');
  near(X.me, X.ma * (1 + 1 / 12), 1e-12, 'exhaust per turbo = air × (1 + 1/AFR) (the turbine balance’s)'); near(X.mr, X.me / 4, 1e-12, 'flow per runner, one cylinder of four');
  near(X.p3, 101325 + 2 * 203677, 1e-9, 'turbine flange pressure: 2 × boost (Bell, the tab’s assumption), Pa abs');
  near(X.L, 193.868350, 1e-6, 'shortest equal length, mm'); near(X.Z, 95.25, 1e-9, 'merge out from the head, mm'); near(X.extra[1], 193.868350 - 95.25 * Math.acos(1 - 46.5 / 95.25), 1e-7, 'cylinder 2 takes the difference, mm');
  near(X.dcol, Math.sqrt(4 * 61 * 44 / Math.PI), 1e-9, 'collector bore from the T3 port’s 61 × 44 mm (turbozentrum), mm');
  near(X.mergeL, (44.323 * 2 - X.dcol) / 2 / Math.tan(10 * Math.PI / 180), 1e-4, '20° merge cone length, mm');
  { const A = d => Math.PI * d * d / 4, r1 = X.dcol / 2, r2 = 44.323, Vr = 4 * A(44.323) * X.L / 1e9, Vm = Math.PI * X.mergeL * (r1 * r1 + r1 * r2 + r2 * r2) / 3 / 1e9, Vc = A(X.dcol) * 152.4 / 1e9;
    near(X.vol.V, Vr + Vm + Vc, 1e-4, 'volume, valves to the turbine, m³'); near(X.vol.V / X.vol.cyl, (Vr + Vm + Vc) / (2354e-6 / 4), 1e-4, 'against one cylinder'); }
  // runner speed and Mach at a fixed gamma, by hand
  const G = await pg.evaluate(() => { const T = window.__tsx, M = window.__mfd, o = M.last().o, g = T.exhGamma(o.tit + 273.15); T.XF_GAS.g = g;
    const X2 = M.calc(o), r = X2.rows.find(x => x.cd.key === 't1.875'), pr = X2.march.parts, res = { g, R: T.EXH_GAS.R, v: r.v, Mach: r.M, march: { dp: X2.march.dp, dp0: X2.march.dp0, sPort: X2.march.sPort.p, M3: X2.march.s3.M },
      parts: pr.map(x => ({ k: x.k, K: x.K, L: x.L, d: x.d, d1: x.d1, d2: x.d2 })), m_col: X2.march.m, m_run: X2.mr, p3: o.p3, T0: o.tit + 273.15, port: o.port, dcol: X2.dcol, id: X2.c.id };
    T.XF_GAS.g = null; return res; });
  // p3 is the turbine-inlet TOTAL pressure (as turbineBalance takes it; boost audit part 3, 2026-11-13: it was taken as the
  // static pressure here, 0.37% faster): m sqrt(R T0) / (A p0) = sqrt(g) M psi^(-(g + 1) / (2 (g - 1))), by bisection
  { const g = G.g, R = G.R, T0 = G.T0, A = Math.PI * (44.323 / 2000) ** 2, m = G.m_run, p = G.p3; let lo = 0, hi = 1;
    for (let i = 0; i < 200; i++) { const M = (lo + hi) / 2, f = A * p * Math.sqrt(g) * M * Math.pow(1 + (g - 1) / 2 * M * M, -(g + 1) / (2 * (g - 1))) / Math.sqrt(R * T0) - m; if (f < 0) lo = M; else hi = M; }
    const Mh = (lo + hi) / 2, vh = Mh * Math.sqrt(g * R * T0 / (1 + (g - 1) / 2 * Mh * Mh));
    near(G.Mach, Mh, 1e-6, 'runner Mach number at the turbine flange’s state, cycle mean'); near(G.v, vh, 1e-6, 'runner gas speed, m/s, cycle mean'); }
  // the loss against the independent script
  { const K = k => (G.parts.find(x => x.k === k) || {}).K || 0, Ls = (G.parts.find(x => x.k === 'run') || {}).L || 0;
    const c = { p3_total: true, m_col: G.m_col, m_run: G.m_run, p3: G.p3, T0: G.T0, gamma: G.g, R: G.R, d_col: G.dcol, L_col: 152.4, d_eq: G.id * 2, d_run: G.id, L_straight: Ls, d_port: G.port, K_merge: K('merge'), K_bends: K('bends'), K_port: K('port'), rough: 1.5e-6 };
    let py = null; try { py = JSON.parse(execFileSync('python3', [path.join(process.cwd(), '..', 'tools', 'validation', 'boost', 'turbomani.py')], { input: JSON.stringify(c) }).toString()); } catch (e) { console.log('python: ' + e.message); }
    ok(!!py, 'tools/validation/boost/turbomani.py ran');
    if (py) { near(G.march.dp0, py.dp0, 2e-3, 'manifold loss (total pressure), page against turbomani.py, Pa'); near(G.march.dp, py.dp, 2e-3, 'static pressure rise from the turbine flange to the port, Pa');
      near(G.march.M3, py.M3, 1e-6, 'Mach number at the turbine flange');
      console.log('  turbomani.py: dp0 ' + py.dp0.toFixed(2) + ' Pa, dp ' + py.dp.toFixed(2) + ' Pa, port M ' + py.M_port.toFixed(5) + ', merge-end runner M ' + py.M_run_merge.toFixed(5)); } }
  // growth on the page: 304 and 321 rows at the page's steel temperature, by the sheets
  { const ab = (tab, T) => { if (T <= tab[0][0]) return tab[0][1]; for (let i = 1; i < tab.length; i++) if (T <= tab[i][0]) return tab[i - 1][1] + (tab[i][1] - tab[i - 1][1]) * (T - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]); return tab[tab.length - 1][1]; };
    const t321 = [[100, 9.2], [315.6, 9.5], [537.8, 10.3], [648.9, 10.7], [815.6, 11.2]], g321 = X.ms.find(x => x.mat === '321'), Ts = X.Ts;
    near(g321.dL, 1.8e-6 * (ab(t321, Ts) * Ts - 9.2 * X.tamb) * X.L, 1e-9, '321 runner growth at the page’s ' + Ts.toFixed(1) + ' °C steel, mm');
    ok(X.ms.find(x => x.mat === '304').atLeast === (Ts > 648.9), '304: “at least” exactly when the steel is past 1200 °F (649 °C)'); }
  txt = await secTxt();
  ok(/Manifold loss, port to turbine flange/.test(txt) && /Not added to the turbine balance/.test(txt), 'the loss is shown and said not to be added to the turbine balance');
  ok(/turbozentrum’s T3 manifold flange: port 61 × 44 mm/.test(txt) && await pg.evaluate(() => /port 61 × 44 mm/.test(window.__mfd.presets().find(f => f.name.startsWith('T3 (turbozentrum)')).note)), 'the T3 port as the flange preset’s source gives it');
  ok(/Wastegate take-off/.test(txt) && await pg.$('#mfd-svg') !== null, 'the wastegate row from the placement and the drawing');
  // the Fusion payload (act_route mode 'turbomani'): the runner, the bend radius, the equal length, the merge and collector, the gate
  { const pay = await pg.evaluate(() => window.__mfd.payload());
    ok(pay && pay.mode === 'turbomani' && Math.abs(pay.od_mm - 47.625) < 1e-9 && Math.abs(pay.clr_mm - 47.625) < 1e-9 && Math.abs(pay.target_mm - 193.86835) < 1e-4 && pay.scrolls === null &&
      Math.abs(pay.merge_len_mm - 85.601426) < 1e-4 && Math.abs(pay.collector_len_mm - 152.4) < 1e-9 && pay.gate && pay.gate.bore_mm > 0, 'Fusion payload: 1.875 in tube, 1 7/8 in radius, 193.87 mm, 20° merge 85.60 mm, collector 152.4 mm, the gate window');
    if (process.env.ET_WRITE_FIXTURES) { require('fs').writeFileSync(path.join(process.cwd(), 'tests', 'fixtures', 'turbomani_payload.json'), JSON.stringify(pay, null, 1) + '\n'); console.log('wrote tests/fixtures/turbomani_payload.json'); } }
  // support, the Mounts part
  await setv('i-mkg', '10'); txt = await secTxt();
  { const S = await pg.evaluate(() => window.__mfd.last().sup); near(S.W, 98.0665, 1e-9, '10 kg standing on the head flange, N'); ok(/Precision: “If it is necessary to support the weight/.test(txt), 'Precision’s support quote'); }
  ok(await pg.evaluate(() => !!document.querySelector('#mt-part option[value="turbo"]')), 'the Mounts designer lists the turbo as a part');
  // checklist step, build sheet
  s = await pg.evaluate(() => (window.__tg.steps() || []).find(x => x.id === 'mani'));
  ok(s && (s.state === 'ok' || s.state === 'warn') && /runners 1\.875 in \(47\.6 mm\) × 0\.065 in \(1\.65 mm\) stainless tube/.test(s.line) && /manifold loss/.test(s.line), 'checklist step: ' + (s && s.state + ': ' + s.line));
  const sh = await pg.evaluate(() => { const S = window.__tg.sheet(); return { parts: S.parts.map(p => p[0] + ' | ' + p[1]), nums: S.nums.map(n => n[0] + ' | ' + n[1]), svg: S.svg.length, doc: window.__tg.doc() }; });
  ok(sh.parts.some(p => /^Turbo manifold \| tubular/.test(p)) && sh.parts.some(p => /^Runners \| 1\.875 in/.test(p) && /mm/.test(p) && / in/.test(p)) && sh.parts.some(p => /^Collector/.test(p)), 'build sheet rows: manifold, runners, collector');
  ok(sh.nums.some(n => /^Manifold loss/.test(n) && /kPa/.test(n) && /psi/.test(n)) && sh.svg === 3 && /mfd-svg/.test(sh.doc), 'build sheet: the loss in both units and the manifold drawing');
  // dual units: every length in the section given both ways
  { const t = txt.replace(/ /g, ' '); const bad = [];
    const re = /(\d[\d.,]*) (mm|in)\b(?!²)/g; let m;
    while ((m = re.exec(t))) { const after = t.slice(m.index, m.index + m[0].length + 26), before = t.slice(Math.max(0, m.index - 22), m.index);
      const other = m[2] === 'mm' ? / in\b/ : / mm\b/; if (!(other.test(after.slice(m[0].length)) || other.test(before))) bad.push(t.slice(Math.max(0, m.index - 20), m.index + 30)); }
    ok(!bad.length, 'every length in the section in both units' + (bad.length ? ': ' + bad.slice(0, 4).join(' || ') : '')); }
  // divided T4 0.84: the divided housing and manifold, the collectors not sized from the flange
  const t4 = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.84 && h.divided), ti);
  await tso('hs', String(t4)); await setv('i-mani', 'div'); txt = await secTxt();
  { const D = await pg.evaluate(() => { const X = window.__mfd.last(); return { why: X.dcolWhy, d: X.dcol, flags: X.flags.map(f => f.t) }; });
    ok(D.why === 'headers' && Math.abs(D.d - 44.323 * Math.sqrt(1.6)) < 1e-6 && /No maker read gives the two port openings/.test(txt) && !D.flags.includes('div'), 'T4 divided: no port data, the Headers starting assumption, labelled; housing and manifold agree');
    await setv('i-mani', 'tube'); const f2 = await pg.evaluate(() => window.__mfd.last().flags.map(f => f.t)); ok(f2.includes('div') && /The picked housing is divided/.test(await secTxt()), 'a divided housing on an undivided manifold is flagged'); await setv('i-mani', 'div'); }
  // log: Allard's 2 to 2.5 x one port's area -> 44.9834 x sqrt 2 = 63.616 mm to 44.9834 x sqrt 2.5 = 71.125 mm
  await setv('i-mani', 'log'); txt = await secTxt();
  { const G2 = await pg.evaluate(() => window.__mfd.last().log); near(G2.lo, 1.771 * 25.4 * Math.SQRT2, 1e-9, 'log bore, Allard’s lower end, mm'); near(G2.hi, 1.771 * 25.4 * Math.sqrt(2.5), 1e-9, '… upper end, mm');
    ok(/Log bore \(Allard/.test(txt) && /as short as possible and of equal length/.test(txt) && !/Pressure lost in the manifold/.test(txt), 'log: the bore range and Allard’s stubs, no S layout or loss march'); }
  await setv('i-mani', 'div');
  // 400 px: no horizontal scroll
  await pg.setViewportSize({ width: 400, height: 900 }); await pg.waitForTimeout(400);
  { const w = await pg.evaluate(() => ({ doc: document.documentElement.scrollWidth, body: document.body.scrollWidth })); ok(w.doc <= 400 && w.body <= 400, '400 px: no horizontal scroll (' + w.doc + ', ' + w.body + ')'); }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'turbomani_ui: all pass');
  process.exit(fails.length ? 1 : 0);
})();
