// The turbine's size from the housing picked (docs/WAVE_VALIDATION_2026-11-11.md, addendum part 9). Node for the
// physics (about 2 minutes), then the page in Playwright (about 1 minute). Every reference value is worked here by hand
// from the source equation, not taken from the code under test:
//  1 a maker's corrected turbine flow -> the flow parameter -> the equivalent nozzle's area (turbAreaFromFlow), Garrett's
//    "G40 1.19 A/R has a max flow of 43 lbs/min" as the worked example; the five input units of the page agree;
//  2 the nozzle function against NASA Glenn's mass-flow equation in its Mach-number form (choked and unchoked), and the
//    area's own flow at the reference state returns the corrected flow;
//  3 the steady balance with an area (turbineAreaBalance): the nozzle passes exactly the turbine's share that
//    turbineBalance needs at that pressure; a large turbine is short (gate shut, full boost not held);
//  4 the predict mode (turboSimLib.predict) on the owner's K24 + PT5862 plan: with the closure's own area it reproduces
//    part 5's 6600 rpm row; a larger turbine (larger A/R) gives full boost later, a lower pressure before the turbine and
//    a smaller gate share; the steady balance at the run's own flow and temperature moves the same way (agreement in form);
//  5 the page: the housing table's capacity column, the "what the run takes" rows, the steady table in both unit systems,
//    the step-by-step and build-sheet rows, and a predict-mode run with its wording.
'use strict';
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return html.slice(i, j); };
const wsSrc = cut('function wsFactory(){', '\nconst WS=wsFactory();');
const WS = new Function(wsSrc + '\nreturn wsFactory();')();
const steadySrc = wsSrc + '\n' + cut('const EXH_GAS=(()=>{', 'const sosExh=') +
  'const R_AIR=287.05, GAMMA=1.4, P_ATM=101325;\nconst CP_AIRT=GAMMA*R_AIR/(GAMMA-1);\nconst LBMIN=60/0.45359237;\n' +
  cut('const ATP_TREF=', 'const corrFlow=') + cut('function turbineBalance(o){', 'function tsSizeSection(');
const ST = new Function(steadySrc + '\nreturn {turbineBalance,turbineAreaBalance,turbAreaFromFlow,nozPsi,TCAP_UNITS,exhGamma,EXH_GAS,CP_AIRT};')();
const rel = (a, b) => a / b - 1;

// ---------- 1. corrected flow -> area. By hand: 43 lb/min / (60 / 0.45359237) = 0.32507453 kg/s; x sqrt(288.15) =
// 16.974982 / 101325 Pa = 5.445975e-5 kg sqrt(K)/(s Pa); choked psi at g 1.3 = sqrt(1.3) (2/2.3)^(2.3/0.6) = 1.1401754 x
// 0.5852343 = 0.6672624; A = 5.445975e-5 x sqrt(287) (16.941074) / 0.6672624 = 1.382675e-3 m2 (1382.7 mm2, 2.143 in2)
{ const a = ST.turbAreaFromFlow({ Wc: 43 * 0.45359237 / 60, Tref: 288.15, pref: 101325 });
  ok(Math.abs(rel(a.mfp, 5.445975e-5)) < 2e-6 && Math.abs(rel(a.psi, 0.6672624)) < 2e-7 && Math.abs(rel(a.A, 1.382675e-3)) < 2e-6 && a.choked,
    '1 G40-1150 1.19 A/R, 43 lb/min at 59 F / 14.696 psia, choked: flow parameter ' + (a.mfp * 1e5).toFixed(4) + ' kg sqrt(K)/(s bar) (hand 5.4460), area ' + (a.A * 1e6).toFixed(1) + ' mm2 (hand 1382.7)');
  const U = ST.TCAP_UNITS, mfpOf = (u, v) => U[u].mfp ? U[u].mfp(v) : U[u].kgs(v) * Math.sqrt(U[u].T) / U[u].p;
  // the same flow parameter typed in each unit: kg/s at 15 C; kg sqrt(K)/(s kPa) = mfp x 1000; lb/min sqrt(R)/psia = mfp x
  // 132.277 x sqrt(1.8) x 6894.757
  const m0 = a.mfp, vals = { lb59: 43, kg15: 43 * 0.45359237 / 60, fpSI: m0 * 1000, fpUS: m0 * (60 / 0.45359237) * Math.sqrt(1.8) * 6894.757 };
  ok(Object.keys(vals).every(u => Math.abs(rel(mfpOf(u, vals[u]), m0)) < 1e-12), '1 the page\'s units give one flow parameter: ' + Object.keys(vals).map(u => u + ' ' + vals[u].toPrecision(6)).join(', '));
  // ATP's 85 F / 13.95 psia: x sqrt(302.594 / 288.15) x 101325 / 96182.86 = 1.0795 -> 1492.7 mm2
  const atp = mfpOf('lb85', 43) * Math.sqrt(287) / a.psi;
  ok(Math.abs(atp * 1e6 - 1492.7) < 0.1, '1 the same 43 lb/min at ATP\'s 85 F / 13.95 psia: ' + (atp * 1e6).toFixed(1) + ' mm2 (hand 1492.7): the reference state matters 8 %');
  // read at an expansion ratio of 1.6 (unchoked at g 1.3, critical 1.832): psi(1/1.6) by NASA's Mach form below
  const b = ST.turbAreaFromFlow({ Wc: 43 * 0.45359237 / 60, Tref: 288.15, pref: 101325, er: 1.6 });
  const g = 1.3, pr = 1 / 1.6, M = Math.sqrt(2 / (g - 1) * (Math.pow(1 / pr, (g - 1) / g) - 1)), psiM = Math.sqrt(g) * M * Math.pow(1 + (g - 1) / 2 * M * M, -(g + 1) / (2 * (g - 1)));
  ok(!b.choked && Math.abs(rel(b.psi, psiM)) < 1e-12 && b.A > a.A, '1 read at an expansion ratio of 1.6: psi ' + b.psi.toFixed(5) + ' (NASA Mach form ' + psiM.toFixed(5) + ', M ' + M.toFixed(4) + '), area ' + (b.A * 1e6).toFixed(1) + ' mm2, larger than from the peak');
}
// ---------- 2. the nozzle law: NASA Glenn, mdot = A pt / sqrt(Tt) sqrt(g / R) M (1 + (g-1)/2 M^2)^(-(g+1)/(2(g-1)))
{ const g = 1.3, R = 287, A = 1.382675e-3, nasa = (pt, Tt, M) => A * pt / Math.sqrt(Tt) * Math.sqrt(g / R) * M * Math.pow(1 + (g - 1) / 2 * M * M, -(g + 1) / (2 * (g - 1)));
  const page = (pt, Tt, pr) => A * pt * ST.nozPsi(pr, g) / Math.sqrt(R * Tt);
  const c1 = page(300e3, 1100, 0.3), n1 = nasa(300e3, 1100, 1), c0 = page(101325, 288.15, 0);
  const pr = 0.8, M = Math.sqrt(2 / (g - 1) * (Math.pow(1 / pr, (g - 1) / g) - 1)), c2 = page(150e3, 1000, pr), n2 = nasa(150e3, 1000, M);
  ok(Math.abs(rel(c1, n1)) < 1e-12 && Math.abs(rel(c2, n2)) < 1e-12 && Math.abs(rel(c0, 43 * 0.45359237 / 60)) < 2e-6,
    '2 the nozzle: choked 300 kPa / 1100 K ' + c1.toFixed(5) + ' kg/s (NASA ' + n1.toFixed(5) + '), unchoked p/p0 0.8 ' + c2.toFixed(5) + ' (NASA ' + n2.toFixed(5) + '); at 288.15 K / 101.325 kPa it passes ' + (c0 * 60 / 0.45359237).toFixed(3) + ' lb/min corrected (43)');
}
// ---------- 3. the steady balance with an area
{ const o = { ma: 0.3, afr: 12, t1: 25, t2: 160, tit: 950, p4: 101325, eta: 0.7 };
  const T3 = 1223.15, g = ST.exhGamma(T3), R = ST.EXH_GAS.R, me = 0.3 * 13 / 12;
  const b = ST.turbineAreaBalance(Object.assign({ A: 600e-6 }, o)), tb = ST.turbineBalance(Object.assign({ p3: b.p3 }, o));
  const pr = o.p4 / b.p3, prc = Math.pow(2 / (g + 1), g / (g - 1)), Mx = pr <= prc ? 1 : Math.sqrt(2 / (g - 1) * (Math.pow(1 / pr, (g - 1) / g) - 1));
  const mt = 600e-6 * b.p3 / Math.sqrt(T3) * Math.sqrt(g / R) * Mx * Math.pow(1 + (g - 1) / 2 * Mx * Mx, -(g + 1) / (2 * (g - 1)));
  ok(!b.short && Math.abs(rel(mt, b.mt)) < 1e-9 && Math.abs(rel(tb.x * me, mt)) < 1e-9 && Math.abs(b.wg - tb.wg) < 1e-9,
    '3 600 mm2 at 0.3 kg/s air, 950 C, 70 %: p3 ' + ((b.p3 - 101325) / 1000).toFixed(2) + ' kPa gauge, the nozzle passes ' + b.mt.toFixed(5) + ' kg/s (NASA ' + mt.toFixed(5) + '), turbineBalance at that p3 needs ' + (tb.x * me).toFixed(5) + ', gate ' + (100 * b.wg).toFixed(2) + ' %');
  const big = ST.turbineAreaBalance(Object.assign({ A: 5000e-6 }, o)), tbb = ST.turbineBalance(Object.assign({ p3: big.p3 }, o));
  ok(big.short && big.wg === 0 && Math.abs(big.ratio - 1 / tbb.x) < 1e-9 && big.ratio < 1, '3 a 5000 mm2 turbine passes all of the exhaust at ' + ((big.p3 - 101325) / 1000).toFixed(2) + ' kPa gauge and makes ' + (100 * big.ratio).toFixed(1) + ' % of the compressor\'s power: short, gate shut');
  const ps = [400, 600, 900, 1300].map(a => ST.turbineAreaBalance(Object.assign({ A: a * 1e-6 }, o)));
  ok(ps.every((x, i) => i === 0 || (x.p3 < ps[i - 1].p3 && x.wg < ps[i - 1].wg)), '3 steady: a larger turbine runs a lower pressure before it and a smaller gate share: ' + ps.map(x => ((x.p3 - 101325) / 1000).toFixed(1) + ' kPa / ' + (100 * x.wg).toFixed(0) + ' %').join(', '));
}
// ---------- 4. the predict mode on the K24 plan
const libSrc = cut('function turboSimLib(WS,X){', '// the worker\'s Rust path');
const m64 = html.match(/const WAVE_WASM_B64='([A-Za-z0-9+/=]+)'/);
const X = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(m64[1], 'base64')), { m: { pow: Math.pow, sin: Math.sin, cos: Math.cos, exp: Math.exp } }).exports;
const TL = new Function('WS', 'X', libSrc + '\nreturn turboSimLib(WS,X);')(WS, X);
const cap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'validation', 'wave', 'results', 'turbo_k24_page.json'), 'utf8'));
const P = cap.plan, PATM = 101325, k = 0.4 / 1.4, T1 = P.t1 + 273.15;
const comp = { Patm: PATM, Pt: P.Pt, PRc: P.R.PRc, t1: P.t1, etaC: T1 * (Math.pow(P.R.PRc, k) - 1) / (P.t2 - P.t1), eps: (P.t2 - P.R.t3) / (P.t2 - P.p.tamb), tamb: P.p.tamb, cp: ST.CP_AIRT };
const runSrc = cut('function tsimRun(TL,j,post){', 'function tsimStart(){');
const boostAt = new Function('j', runSrc.slice(runSrc.indexOf('const boostAt=(sp,s)=>{'), runSrc.indexOf('if(j.turbo&&j.Acap>0')) + '\nreturn boostAt;')({ comp });
{ const b1 = boostAt(P.spec, 1);
  ok(Math.abs(b1.Pt - P.Pt) < 1e-9 && Math.abs(b1.t2 - P.t2) < 1e-9 && Math.abs(b1.t3 - P.R.t3) < 1e-9 && Math.abs(b1.wc(0.3) - 0.3 * P.wcPer) < 1e-6,
    '4 the charge below full boost: at s = 1 it is the route\'s (' + (b1.Pt / 1000).toFixed(3) + ' kPa, ' + b1.t2.toFixed(2) + ' / ' + b1.t3.toFixed(2) + ' C, the compressor\'s power per kg as the closure\'s)'); }
const mk = s => TL.rustBackend(s, P.dx);
const pred = (A, rpms) => { const r = TL.predict(mk, P.spec, { rpms, At: A, wc: mm => mm * P.wcPer, boostAt: s => boostAt(P.spec, s) }); return r; };
const t0 = Date.now();
const A5 = cap.run.rows[0].At, R5 = cap.sum.rows.find(r => r.rpm === 6600);
const p5 = pred(A5, [6600]), w5 = p5.rows[0].res.turb;
ok(Math.abs((w5.p3 - PATM) / (P.Pt - PATM) - R5.p3k) < 0.005 * R5.p3k && Math.abs(w5.mg / (w5.mt + w5.mg) - R5.share) < 0.005,
  '4 the closure\'s own area (' + (A5 * 1e6).toFixed(1) + ' mm2) through the predict mode at 6600 rpm: p3 ' + ((w5.p3 - PATM) / (P.Pt - PATM)).toFixed(4) + ' x boost, gate ' + (100 * w5.mg / (w5.mt + w5.mg)).toFixed(2) + ' % (part 5: ' + R5.p3k.toFixed(4) + ', ' + (100 * R5.share).toFixed(2) + ' %)');
const small = pred(800e-6, [2500, 3500, 6600]), large = pred(1383e-6, [2500, 3500, 6600]);
const at = (r, rpm) => { const w = r.rows.find(x => x.rpm === rpm), t = w.res.turb, Pt = w.s < 1 ? boostAt(P.spec, w.s).Pt : P.Pt; return { w, t, Pt, k: (t.p3 - PATM) / (Pt - PATM), share: t.mg / (t.mt + t.mg) }; };
const s66 = at(small, 6600), l66 = at(large, 6600), s25 = at(small, 2500), l25 = at(large, 2500);
ok(small.fullBoost && large.fullBoost && small.fullBoost.rpm < large.fullBoost.rpm && l25.Pt <= s25.Pt && l25.w.below,
  '4 a larger turbine reaches full boost later: 800 mm2 at ' + Math.round(small.fullBoost.rpm) + ' rpm (' + small.fullBoost.at + '), 1383 mm2 at ' + Math.round(large.fullBoost.rpm) + ' rpm; boost at 2500 rpm ' + ((s25.Pt - PATM) / 1000).toFixed(1) + ' / ' + ((l25.Pt - PATM) / 1000).toFixed(1) + ' kPa');
ok(l66.k < s66.k && l66.share < s66.share && [small, large].every(r => r.rows.every(w => w.ok)), '4 and at 6600 rpm a lower pressure before it and less round the gate: ' + s66.k.toFixed(3) + ' / ' + l66.k.toFixed(3) + ' x boost, gate ' + (100 * s66.share).toFixed(1) + ' / ' + (100 * l66.share).toFixed(1) + ' %; every speed converged');
// steady balance at the run's own air, turbine-inlet temperature and outlet pressure (the same area and efficiency)
const stOf = (x, A) => ST.turbineAreaBalance({ ma: x.t.mAir, afr: P.afr, t1: P.t1, t2: P.t2, tit: x.t.T3 - 273.15, p4: x.t.p4, eta: 0.75, A });
const ss = stOf(s66, 800e-6), sl = stOf(l66, 1383e-6), rS = (ss.p3 - PATM) / (s66.t.p3 - PATM), rL = (sl.p3 - PATM) / (l66.t.p3 - PATM);
ok(sl.p3 < ss.p3 && sl.wg < ss.wg && rS > 0.75 && rS < 1.25 && rL > 0.75 && rL < 1.25 && Math.abs(ss.wg - s66.share) < 0.08 && Math.abs(sl.wg - l66.share) < 0.08,
  '4 the steady balance agrees in form: p3 gauge steady / wave ' + rS.toFixed(3) + ' (800 mm2), ' + rL.toFixed(3) + ' (1383 mm2); gate steady ' + (100 * ss.wg).toFixed(1) + ' / ' + (100 * sl.wg).toFixed(1) + ' % against the run\'s ' + (100 * s66.share).toFixed(1) + ' / ' + (100 * l66.share).toFixed(1) + ' %');
console.log('(predict runs ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');

// ---------- 5. the page
let chromium = null; try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }
(async () => {
  if (!chromium) { console.log('SKIP: the page part needs Playwright'); }
  else {
    const b = await chromium.launch(); const { reads, settle } = require('./settle');
    const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
    const pg = reads(await ctx.newPage()); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await pg.goto('file://' + path.join(__dirname, '..', 'index.html') + '#intake'); await pg.waitForTimeout(900); await pg.click('#u-met'); await settle(pg);
    await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });
    const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]).then(() => settle(pg));
    const chg = (sel, v) => pg.evaluate(([s, v]) => { const el = document.querySelector(s); if (!el) throw new Error('no ' + s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]).then(() => settle(pg));
    const intakeText = async () => { await pg.click('#tab-intake'); await settle(pg); return pg.$eval('#i-details', e => e.textContent).catch(() => ''); };
    await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.textContent)).value); });
    await settle(pg); await pg.click('#tab-intake'); await settle(pg);
    await setv('i-ind', 'turbo'); await setv('i-boost', '169.918'); await setv('i-hp', '450');
    const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await chg('select.tsox[data-k="turbo"]', String(ti));
    const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti); await chg('select.tsox[data-k="hs"]', String(hs));
    await setv('i-mani', 'tube'); await setv('i-msp', '93');
    let t = await intakeText();
    const capCol = await pg.$$eval('#tso-hs tbody tr', rs => rs.map(r => r.cells[6].getAttribute('data-cap')));
    ok(capCol.length === 10 && capCol.every(c => c === 'UNKNOWN') && /no turbine flow is published in text for the housing picked/.test(t), '5 PT5862: all 10 housings UNKNOWN in the capacity column; the sizing section says so and how to fix it');
    await pg.click('#tab-four'); await settle(pg);
    let pl = await pg.evaluate(() => { const p = window.__tsim.plan(); return { predict: p.predict, rpm0: p.rpms[0], src: p.src.map(r => r.join(' | ')) }; });
    ok(!pl.predict && pl.rpm0 === 3500 && pl.src.some(s => /^Turbine size \| found by the run/.test(s) && /type the value off the maker’s turbine flow chart/.test(s)), '5 no flow: the run finds the area from the full-boost RPM (as before) and says why');
    let t4 = await pg.$eval('#four-details', e => e.textContent);
    ok(/Turbine size: found from your full-boost RPM/.test(t4) && /a pull reaches full boost later than a steady point/.test(t4), '5 the 4-Stroke tab explains the fallback and the pull caveat');
    // a flow typed off the chart: 20 lb/min at 59 F, the peak. By hand 20 / 132.27736 x 16.974982 / 101325 x 16.941074 / 0.6672624 = 643.10 mm2
    await pg.click('#tab-intake'); await settle(pg); await setv('i-tfc', '20');
    t = await intakeText();
    const tc = await pg.evaluate(() => { const T = window.__tso.TG().tcap; return T && { A: T.A, st: T.status, pts: T.pts.map(x => ({ rpm: x.rpm, p3: x.p3, wg: x.wg, short: x.short })) }; });
    const rows = await pg.$$eval('#ts-tcap tbody tr', rs => rs.map(r => r.textContent));
    ok(tc && Math.abs(tc.A * 1e6 - 643.10) < 0.01 && tc.st === 'typed' && rows.length === 2 && /kPa/.test(rows[0]) && /psi/.test(rows[0]) && /643 mm²/.test(t) && /1\.00 in²/.test(t),
      '5 20 lb/min typed: ' + (tc ? (tc.A * 1e6).toFixed(2) : '-') + ' mm2 (hand 643.10), the steady table at ' + rows.length + ' speeds in kPa and psi: ' + rows.join(' / '));
    const step = await pg.$eval('#tg-steps li[data-step="ar"]', e => e.textContent).catch(() => '');
    ok(/turbine size from the flow you typed off its chart: 643 mm² effective/.test(step) && /× boost at peak/.test(step), '5 step by step, the housing row: ' + step.replace(/\s+/g, ' ').trim().slice(0, 160));
    const sheet = await pg.evaluate(() => { try { return JSON.stringify(tsSheet()); } catch (e) { return 'error ' + e.message; } });
    ok(/Turbine size \(flow capacity\)/.test(sheet) && /643 mm²/.test(sheet) && /from the turbine’s size: [0-9.]+ × boost at peak/.test(sheet), '5 the build sheet: the turbine\'s size and the pressure before it from that size');
    await pg.click('#tab-four'); await settle(pg);
    pl = await pg.evaluate(() => { const p = window.__tsim.plan(); return { predict: p.predict, Acap: p.Acap, rpms: p.rpms, src: p.src.map(r => r.join(' | ')) }; });
    ok(pl.predict && Math.abs(pl.Acap * 1e6 - 643.10) < 0.01 && pl.rpms[0] === 2000 && pl.src.some(s => /^Turbine size from the housing \| 643 mm²/.test(s)), '5 the run takes the turbine of the housing: ' + (pl.Acap * 1e6).toFixed(1) + ' mm2, speeds from ' + pl.rpms[0] + ' rpm');
    await pg.click('button[data-tsim="run"]');
    let st = 'running'; for (let i = 0; i < 900 && st === 'running'; i++) { await pg.waitForTimeout(1000); st = await pg.evaluate(() => window.__tsim.state().status); }
    const S = await pg.evaluate(() => { const T = window.__tsim.last(); return T && JSON.parse(JSON.stringify({ mode: T.sum.mode, fb: T.sum.fullBoost, rows: T.sum.rows.map(r => ({ rpm: r.rpm, Pt: r.Pt, below: r.below, p3k: r.p3k, share: r.share, At: r.At })), sens: T.sum.sens })); });
    t4 = await pg.$eval('#four-details', e => e.textContent);
    ok(st === 'done' && S && S.mode === 'predict' && S.rows.length === 8 && S.rows.every(r => Math.abs(r.At * 1e6 - 643.10) < 0.01) && S.sens.length === 1,
      '5 the run in predict mode: full boost ' + (S && S.fb ? Math.round(S.fb.rpm) + ' rpm (' + S.fb.at + ')' : '-') + ', p3 ' + (S ? S.rows.map(r => r.p3k.toFixed(2)).join(' ') : '') + ' x boost');
    ok(/Turbine size from the housing you picked/.test(t4) && /Where full boost arrives/.test(t4) && /Boost this turbine makes/.test(t4) && /How much rests on the efficiency/.test(t4) && /This is the model’s prediction for the turbine of the housing you picked/.test(t4) && /psi/.test(t4) && /kPa/.test(t4),
      '5 the results say the turbine is the housing\'s, where full boost arrives, the boost per speed and the efficiency\'s effect, in both units');
    ok(errs.length === 0, '5 no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    await b.close();
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
