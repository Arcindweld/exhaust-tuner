// The turbine's efficiency from the blade speed ratio (docs/WAVE_VALIDATION_2026-11-11.md, addendum part 10). Node for the
// physics (about 3 minutes), then the page in Playwright (about 2 minutes). Reference values are worked here by hand from
// the source equations, not taken from the code under test:
//  1 the compressor's work coefficient from Pakle and Jiang's design point; the shaft and tip speed it gives the K24 +
//    PT5862 build at full boost (turboShaft);
//  2 the blade speed ratio of a worked steady expansion, and the two efficiency forms (the parabola of NASA SP-290 eq.
//    2-88, OpenWAM's Watson polynomial) at chosen ratios;
//  3 the engine element: with the parabola and no step clipped the cycle's work is exactly
//    eta [(2 / xo) xE Wis - U^2 / (2 xo^2) m_t] (the moments the engine reports), and the Watson form stays below eta Wis;
//  4 the legacy switch: without exhaust.turbine.bsr the predict mode reproduces part 9's runs to the last digit (values
//    pinned from the page before this change); the steady balance with the curve against turbineBalance's closed form;
//  5 monotonic behaviour: bearing friction raises the pressure the steady turbine needs; the friction scales with the
//    shaft speed squared below full boost; with the curve the wave turbine reaches full boost later than at a constant
//    peak efficiency, and a larger turbine later still;
//  6 the page: the efficiency model's input, the plan's rows, the steady table's column, and a run with its row.
'use strict';
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return html.slice(i, j); };
const wsSrc = cut('function wsFactory(){', '\nconst WS=wsFactory();');
const WS = new Function(wsSrc + '\nreturn wsFactory();')();
const steadySrc = wsSrc + '\n' + cut('const EXH_GAS=(()=>{', 'const sosExh=') +
  'const R_AIR=287.05, GAMMA=1.4, P_ATM=101325;\nconst CP_AIRT=GAMMA*R_AIR/(GAMMA-1);\nconst LBMIN=60/0.45359237;\n' +
  cut('const ATP_TREF=', 'const corrFlow=') + cut('/* ----- The turbine\'s efficiency from the blade speed ratio', 'function tsSizeSection(');
const ST = new Function(steadySrc + '\nreturn {turbineBalance,turbineAreaBalance,nozPsi,exhGamma,EXH_GAS,CP_AIRT,turboShaft,bsrEff,TURBO_MU,TURBO_XO};')();
const libSrc = cut('function turboSimLib(WS,X){', '// the worker\'s Rust path');
const m = html.match(/const WAVE_WASM_B64='([A-Za-z0-9+/=]+)'/);
const X = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(m[1], 'base64')), { m: { pow: Math.pow, sin: Math.sin, cos: Math.cos, exp: Math.exp } }).exports;
const TL = new Function('WS', 'X', libSrc + '\nreturn turboSimLib(WS,X);')(WS, X);
const rel = (a, b) => a / b - 1, PATM = 101325;

// ---------- 1. the work coefficient and the shaft. Pakle and Jiang 2018: "2.5 total pressure ratio", "polytropic efficiency
// 92%", "a tip speed of 427 m/s"; inlet 288.15 K (assumed), cp 1004.675 J/kg K: the actual work cp T01 (PR^((g-1)/(g eta_p))
// - 1): (2/7) / 0.92 = 0.3105590; 2.5^0.3105590 = e^(0.9162907 x 0.3105590 = 0.2845655) = 1.3291802; dh0 = 289497.1 x
// 0.3291802 = 95296 J/kg; mu = 95296 / 427^2 (182329) = 0.52266.
// K24 + PT5862 at full boost (the page's plan): dh0 = 149434.84 J/kg (cp (T2 - T1), T2 178.74 C, T1 30 C):
// U2 = sqrt(149434.84 / 0.52266) = sqrt(285910) = 534.71 m/s; N = 534.71 / (pi x 0.0762) x 60 = 134017 rpm;
// U = 534.71 x 71 / 76.2 = 498.22 m/s
{ ok(Math.abs(ST.TURBO_MU - 0.52266) < 1e-5, '1 work coefficient from Pakle and Jiang\'s design point: ' + ST.TURBO_MU.toFixed(5) + ' (hand 0.52266)');
  const sh = ST.turboShaft({ dh0: 149434.84205445225, Dc: 76.2, Dt: 71 });
  ok(Math.abs(sh.U2 - 534.71) < 0.02 && Math.abs(sh.N - 134017) < 10 && Math.abs(sh.U - 498.22) < 0.02,
    '1 K24 + PT5862 at full boost: compressor tip ' + sh.U2.toFixed(2) + ' m/s (hand 534.71), ' + Math.round(sh.N) + ' rpm (hand 134017), turbine tip ' + sh.U.toFixed(2) + ' m/s (hand 498.22)');
  const s65 = ST.turboShaft({ dh0: 149434.84205445225, Dc: 76.2, Dt: 71, mu: 0.65 });
  ok(Math.abs(s65.U - Math.sqrt(149434.84205445225 / 0.65) * 71 / 76.2) < 1e-9 && s65.U < sh.U, '1 a larger work coefficient (0.65) turns the shaft slower: turbine tip ' + s65.U.toFixed(2) + ' m/s');
}
// ---------- 2. a worked steady expansion. Expansion ratio 2.0 at T3 1286.15 K: gamma g = exhGamma(T3) (the page's exhaust
// gas), cpe = g R / (g - 1), k = (g - 1) / g; dh = cpe T3 (1 - 2^-k); C0 = sqrt(2 dh) (SP-290 eq. 2-71); x = 498.22 / C0
{ const T3 = 1286.15, g = ST.exhGamma(T3), R = ST.EXH_GAS.R, cpe = g * R / (g - 1), k = (g - 1) / g, dh = cpe * T3 * (1 - Math.pow(2, -k)), C0 = Math.sqrt(2 * dh), x = 498.22 / C0;
  // (the page's gas: drop 237.26 kJ/kg, C0 = sqrt(474520) = 688.85 m/s, x = 498.22 / 688.85 = 0.7233)
  ok(Math.abs(x - 0.7233) < 0.0003, '2 expansion ratio 2.0 at 1286 K: gamma ' + g.toFixed(4) + ', cp ' + cpe.toFixed(1) + ' J/kg K, isentropic drop ' + (dh / 1000).toFixed(2) + ' kJ/kg, spouting velocity ' + C0.toFixed(1) + ' m/s, blade speed ratio ' + x.toFixed(4) + ' (hand 0.7233, near the 0.7 optimum)');
  // parabola: r = x / 0.7; f = r (2 - r): x 0.35 -> 0.75; 0.7 -> 1; 1.05 -> 0.75; 1.4 -> 0; 1.75 -> 0 (clipped, -1.25)
  const P = [[0.35, 0.75], [0.7, 1], [1.05, 0.75], [1.4, 0], [1.75, 0], [0.56, 0.96]];
  ok(P.every(([x, f]) => Math.abs(ST.bsrEff('parabola', x) - f) < 1e-12), '2 parabola 2r - r^2 at x 0.35, 0.7, 1.05, 1.4, 1.75, 0.56: ' + P.map(([x]) => ST.bsrEff('parabola', x).toFixed(4)).join(', ') + ' (hand 0.75, 1, 0.75, 0, 0, 0.96)');
  // Watson (OpenWAM): x = 0.5: 0.004022 + 0.77883 - 0.1279065 - 0.015224375 - 0.02786275 = 0.611858375; / 0.6951808461 = 0.88014
  // x = 1.0: 0.004022 + 1.55766 - 0.511626 - 0.121795 - 0.445804 = 0.482457 -> 0.69400; x = 1.19 and above, or 0: 0
  const w5 = ST.bsrEff('watson', 0.5), w10 = ST.bsrEff('watson', 1.0);
  ok(Math.abs(w5 - 0.611858375 / 0.6951808461322609) < 1e-12 && Math.abs(w10 - 0.482457 / 0.6951808461322609) < 1e-12 && ST.bsrEff('watson', 1.19) === 0 && ST.bsrEff('watson', 0) === 0 && Math.abs(ST.bsrEff('watson', 0.71205486642497751) - 1) < 1e-12,
    '2 Watson\'s polynomial: ' + w5.toFixed(5) + ' at 0.5 (hand 0.88014), ' + w10.toFixed(5) + ' at 1.0 (hand 0.69400), 0 at 1.19, 1 at its peak 0.71205');
}
// ---------- 3. the engine element on the owner's plan, gate shut, 3500 rpm
const cap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'validation', 'wave', 'results', 'turbo_k24_page.json'), 'utf8')), P = cap.plan;
const specWith = (tb) => Object.assign({}, P.spec, { exhaust: Object.assign({}, P.spec.exhaust, { turbine: Object.assign({}, P.spec.exhaust.turbine, tb) }) });
const one = (spec, A, rpm, back) => { const B = back === 'js' ? TL.jsBackend(spec, P.dx) : TL.rustBackend(spec, P.dx); try { B.set(A, 0); return B.step(rpm, true, 2, 8, 4).turb; } finally { B.drop(); } };
{ const U = 420, xo = 5, t = one(specWith({ bsr: { U, xo, form: 'parabola' } }), 800e-6, 3500), eta = 0.75;
  const W = eta * ((2 / xo) * t.bsrE * t.Wis - U * U / (2 * xo * xo) * t.mt);
  ok(Math.abs(rel(t.W, W)) < 1e-9 && t.bsrE > 0, '3 parabola (U 420 m/s, xo 5: no step clipped): cycle work ' + (t.W / 1000).toFixed(4) + ' kW against eta [(2/xo) xE Wis - U^2/(2 xo^2) m_t] ' + (W / 1000).toFixed(4) + ' kW (xE ' + t.bsrE.toFixed(4) + ')');
  const w = one(specWith({ bsr: { U: 498.22, form: 'watson' } }), 800e-6, 3500), l = one(specWith({}), 800e-6, 3500);
  ok(w.W < eta * w.Wis && w.W > 0.5 * eta * w.Wis && l.bsrE === 0 && Math.abs(l.W / l.Wis - eta) < 1e-12,
    '3 Watson at the build\'s tip speed: cycle efficiency ' + (w.W / w.Wis).toFixed(4) + ' below the peak 0.75 (energy-weighted ratio ' + w.bsrE.toFixed(4) + '); without bsr the efficiency is the constant ' + (l.W / l.Wis).toFixed(4) + ' and xE 0');
  const js = one(specWith({ bsr: { U: 498.22, xo: 0.7, form: 'parabola' } }), 800e-6, 3500, 'js'), rs = one(specWith({ bsr: { U: 498.22, xo: 0.7, form: 'parabola' } }), 800e-6, 3500);
  ok(Object.is(js.W, rs.W) && Object.is(js.bsrE, rs.bsrE) && Object.is(js.p3, rs.p3), '3 JavaScript and Rust agree to the last digit with the parabola: W ' + js.W + ', xE ' + js.bsrE);
}
// ---------- 4. the legacy switch: the predict mode at 800 mm2 without bsr against the page before part 10 (pinned:
// git 9301028, the same calls as turbine_ui.js 4)
const k = 0.4 / 1.4, T1 = P.t1 + 273.15;
const comp = { Patm: PATM, Pt: P.Pt, PRc: P.R.PRc, t1: P.t1, etaC: T1 * (Math.pow(P.R.PRc, k) - 1) / (P.t2 - P.t1), eps: (P.t2 - P.R.t3) / (P.t2 - P.p.tamb), tamb: P.p.tamb, cp: ST.CP_AIRT };
const runSrc = cut('function tsimRun(TL,j,post){', 'function tsimStart(){');
const mkBoost = c => new Function('j', runSrc.slice(runSrc.indexOf('const boostAt=(sp,s)=>{'), runSrc.indexOf('if(j.turbo&&j.Acap>0')) + '\nreturn boostAt;')({ comp: c });
const boostAt = mkBoost(comp), mk = s => TL.rustBackend(s, P.dx);
const PIN = require('./turbineeff_pins.json');
{ const r = TL.predict(mk, P.spec, { rpms: [2500, 3500, 6600], At: 800e-6, wc: mm => mm * P.wcPer, boostAt: s => boostAt(P.spec, s) });
  const got = r.rows.map(w => [w.rpm, w.s, w.Ag, w.res.turb.p3, w.res.turb.W, w.res.turb.mg]);
  ok(JSON.stringify(got) === JSON.stringify(PIN.legacy800) && r.fullBoost.rpm === PIN.legacy800fb,
    '4 legacy (no bsr), 800 mm2 at 2500 / 3500 / 6600 rpm: every number as the page before part 10 to the last digit (p3 at 6600 ' + got[2][3] + ' Pa, full boost ' + r.fullBoost.rpm + ' rpm, ' + r.fullBoost.at + ')'); }
{ // steady: turbineBalance with the curve at a p3 against the closed form with the efficiency taken at that p3's ratio
  const o = { ma: 0.3, afr: 12, t1: 25, t2: 175, tit: 950, p3: 250e3, p4: 101325, eta: 0.75 }, U = 480;
  const T3 = 1223.15, g = ST.exhGamma(T3), cpe = g * ST.EXH_GAS.R / (g - 1), kk = (g - 1) / g, dh = cpe * T3 * (1 - Math.pow(o.p4 / o.p3, kk)), x = U / Math.sqrt(2 * dh), e = 0.75 * ST.bsrEff('parabola', x);
  const b = ST.turbineBalance(Object.assign({ bsr: { U, form: 'parabola', xo: 0.7 } }, o)), c = ST.turbineBalance(Object.assign({}, o, { eta: e }));
  ok(Math.abs(b.wg - c.wg) < 1e-12 && Math.abs(b.eta3 - e) < 1e-15 && Math.abs(b.bsr3 - x) < 1e-12,
    '4 steady with the curve: at p3 250 kPa the ratio ' + x.toFixed(4) + ', efficiency ' + e.toFixed(4) + ', gate share ' + (100 * b.wg).toFixed(2) + ' % = turbineBalance at that constant efficiency ' + (100 * c.wg).toFixed(2) + ' %');
  const a0 = ST.turbineAreaBalance(Object.assign({ A: 700e-6 }, o)), a1 = ST.turbineAreaBalance(Object.assign({ A: 700e-6, bsr: null }, o));
  ok(Object.is(a0.p3, a1.p3) && Object.is(a0.wg, a1.wg), '4 turbineAreaBalance without the curve is unchanged (bsr null): p3 ' + a0.p3);
}
// ---------- 5. monotonic behaviour
{ const o = { ma: 0.3, afr: 12, t1: 25, t2: 175, tit: 950, p4: 101325, eta: 0.75, A: 700e-6, bsr: { U: 480, form: 'parabola', xo: 0.7 } };
  const p = [0, 500, 1000, 2000].map(f => ST.turbineAreaBalance(Object.assign({ fric: f }, o)).p3);
  ok(p.every((v, i) => i === 0 || v > p[i - 1]), '5 bearing friction 0 / 0.5 / 1 / 2 kW raises the steady p3: ' + p.map(v => ((v - PATM) / 1000).toFixed(2)).join(' / ') + ' kPa gauge');
  const c2 = Object.assign({}, comp, { mu: ST.TURBO_MU, Dc: 76.2, Dt: 71, fric: 1000, dhFb: P.wcPer }), bA = mkBoost(c2);
  const sp = specWith({ bsr: { U: 498.22, xo: 0.7, form: 'parabola' } }), h1 = bA(sp, 1), h5 = bA(sp, 0.5);
  const dh5 = ST.CP_AIRT * (h5.t2 - P.t1);
  ok(Math.abs(h1.fric - 1000 * (ST.CP_AIRT * (h1.t2 - P.t1)) / P.wcPer) < 1e-9 && Math.abs(h5.fric - 1000 * dh5 / P.wcPer) < 1e-9 && Math.abs(h5.U - Math.sqrt(dh5 / ST.TURBO_MU) * 71 / 76.2) < 1e-9 && h5.U < h1.U && h5.spec.exhaust.turbine.bsr.U === h5.U,
    '5 below full boost (half way): shaft slower, turbine tip ' + h5.U.toFixed(1) + ' m/s against ' + h1.U.toFixed(1) + ', friction ' + h5.fric.toFixed(0) + ' W against ' + h1.fric.toFixed(0) + ' W (in proportion to the shaft speed squared, the compressor\'s work)');
  const t0 = Date.now(), cb = Object.assign({}, comp, { mu: ST.TURBO_MU, Dc: 76.2, Dt: 71 }), bB = mkBoost(cb), rp = [2000, 2500, 3000, 3500, 4000];
  const run = (spec, A, bf) => TL.predict(mk, spec, { rpms: rp, At: A, wc: mm => mm * P.wcPer, boostAt: s => bf(spec, s) }).fullBoost;
  const sp7 = specWith({ bsr: { U: 498.22, xo: 0.7, form: 'parabola' } }), L8 = run(P.spec, 800e-6, boostAt), B8 = run(sp7, 800e-6, bB), B10 = run(sp7, 1000e-6, bB);
  ok(L8 && B8 && B10 && B8.rpm > L8.rpm && B10.rpm > B8.rpm, '5 full boost with the curve later than at the constant peak, and later still with a larger turbine: 800 mm2 ' + (L8 ? Math.round(L8.rpm) : '-') + ' (constant) / ' + (B8 ? Math.round(B8.rpm) : '-') + ' rpm (curve), 1000 mm2 ' + (B10 ? Math.round(B10.rpm) : '-') + ' rpm (curve) (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
}

// ---------- 6. the page
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
    const sel = await pg.$eval('#i-teffm', e => ({ v: e.value, n: e.options.length }));
    ok(sel.v === 'bsr' && sel.n === 3, '6 the efficiency model input: default from the blade speed ratio, 3 choices');
    await pg.click('#tab-four'); await settle(pg);
    let pl = await pg.evaluate(() => { const p = window.__tsim.plan(); return { bsr: p.spec.exhaust.turbine.bsr || null, N: p.shaft && p.shaft.N, src: p.src.map(r => r.join(' | ')) }; });
    ok(pl.bsr && Math.abs(pl.bsr.U - 498.22) < 0.5 && pl.bsr.xo === 0.7 && pl.src.some(s => /^Turbine efficiency through each pulse \| from the blade speed ratio/.test(s) && /Pakle and Jiang/.test(s) && /76\.2 mm compressor exducer, 71 mm turbine inducer/.test(s)),
      '6 the plan: tip speed ' + (pl.bsr ? pl.bsr.U.toFixed(1) : '-') + ' m/s (hand 498.22 from the captured plan; here the page\'s own route), shaft ' + Math.round(pl.N || 0) + ' rpm, the row and its sources');
    await pg.click('#tab-intake'); await settle(pg); await setv('i-teffm', 'const'); await pg.click('#tab-four'); await settle(pg);
    const pc = await pg.evaluate(() => { const p = window.__tsim.plan(); return { has: 'bsr' in p.spec.exhaust.turbine, src: p.src.map(r => r.join(' | ')) }; });
    ok(!pc.has && pc.src.some(s => /^Turbine efficiency through each pulse \| constant through the pulse/.test(s)), '6 "Constant through the pulse": the spec carries no bsr (the legacy engine path)');
    await pg.click('#tab-intake'); await settle(pg); await setv('i-teffm', 'bsr'); await setv('i-tfc', '20');
    const t = await intakeText(), row = await pg.$$eval('#ts-tcap tbody tr', rs => rs.map(r => r.textContent));
    ok(row.length >= 1 && /, [0-9.]+% \(shaft [0-9,]+ RPM\)/.test(row[0]) && /The efficiency is taken at the blade speed ratio of this steady expansion/.test(t),
      '6 the steady table with the housing\'s size gives the blade speed ratio and efficiency: ' + row[0].replace(/\s+/g, ' ').slice(0, 140));
    await setv('i-tfc', ''); await pg.click('#tab-four'); await settle(pg);
    await pg.click('button[data-tsim="run"]');
    let st = 'running'; for (let i = 0; i < 900 && st === 'running'; i++) { await pg.waitForTimeout(1000); st = await pg.evaluate(() => window.__tsim.state().status); }
    const S = await pg.evaluate(() => { const T = window.__tsim.last(); return T && { hp: T.sum.hp, rpmHp: T.sum.rpmHp, p3k: T.sum.rows[T.sum.ip].p3k, p3sk: T.sum.rows[T.sum.ip].p3sk, share: T.sum.rows[T.sum.ip].share, At: T.sum.rows[0].At, Agmax: Math.max(...T.sum.rows.map(r => r.Ag)), rows: T.sum.rows.map(r => ({ rpm: r.rpm, e: r.etaEff, x: r.bsrE })) }; });
    const t4 = await pg.$eval('#four-details', e => e.textContent);
    ok(st === 'done' && S && S.rows.every(r => r.e > 0.5 && r.e < 0.75 && r.x > 0.3 && r.x < 1.2) && /Turbine efficiency through the pulses/.test(t4) && /the smallest listed valve whose seat holds it/.test(t4) && /m\/s/.test(t4) && /ft\/s/.test(t4),
      '6 the run: cycle efficiency ' + (S ? S.rows.map(r => (100 * r.e).toFixed(1)).join(' ') : '-') + ' %, energy-weighted ratio ' + (S ? S.rows.map(r => r.x.toFixed(2)).join(' ') : '-') + ', the row in both units; area ' + (S ? (S.At * 1e6).toFixed(1) : '-') + ' mm2, peak ' + (S ? S.hp.toFixed(1) + ' hp @ ' + S.rpmHp : '-') + ', p3 ' + (S ? S.p3k.toFixed(3) + ' total / ' + S.p3sk.toFixed(3) + ' static x boost, gate ' + (100 * S.share).toFixed(1) + ' %, largest gate area ' + (S.Agmax * 1e6).toFixed(0) + ' mm2' : ''));
    await pg.click('#tab-intake'); await settle(pg);
    const sheet = await pg.evaluate(() => { try { return JSON.stringify(window.__tg.sheet()); } catch (e) { return 'error ' + e.message; } });
    const step = await pg.$eval('#tg-steps li[data-step="sim"]', e => e.textContent).catch(() => '');
    ok(/Turbine efficiency model/.test(sheet) && /from the blade speed ratio at each moment/.test(sheet) && /Turbine efficiency through the pulses \(wave simulation\)/.test(sheet) && /smallest listed valve/.test(sheet) && /turbine efficiency through the pulses/.test(step) && /wastegate: the most the run opens it/.test(step),
      '6 the build sheet and the step-by-step row carry the efficiency model, the run\'s efficiency and the gate valve: ' + step.replace(/\s+/g, ' ').trim().slice(0, 220));
    ok(errs.length === 0, '6 no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
    await b.close();
  }
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nALL PASS');
  process.exit(fails.length ? 1 : 0);
})();
