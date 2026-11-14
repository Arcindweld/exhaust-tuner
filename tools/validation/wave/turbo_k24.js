// The K24A2 + Precision GEN2 PT5862 build under boost with the wave model (docs/WAVE_VALIDATION_2026-11-11.md, part 5,
// E6): a PREDICTION, not a validation (no turbocharged engine with published cam data was found to compare against).
// Input: the page's own plan, captured by `CAPTURE=1 node web/tests/turbosim_ui.js` (results/turbo_k24_page.json): the
// 4-Stroke tab's engine (the K24A2 preset; its cam is the tab's stand-in, NOT the stock K24's), the Intake tab's route
// (boost 169.918 kPa, the audit's 450 hp case), manifold, downpipe and turbine inputs. This script
//   1. reruns the page's run from that plan with the page's own WebAssembly and closure (turboSimLib, tsimRun) and checks
//      it gives the page's numbers to the last digit;
//   2. runs one change at a time: turbine efficiency 0.65 and 0.70 (the page's default is 0.75), an internal gate (into
//      the downpipe, so the tail carries all the flow), 2 psi (13.79 kPa) back pressure after the turbine, AFR 11.5;
//   3. writes results/turbo_k24.json and prints the tables of part 5.
// Run from the repository root: node tools/validation/wave/turbo_k24.js   (about 3 minutes)
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return html.slice(i, j); };
const wsSrc = cut('function wsFactory(){', '\nconst WS=wsFactory();');
const WS = new Function(wsSrc + '\nreturn wsFactory();')();
const libSrc = cut('function turboSimLib(WS,X){', '// the worker\'s Rust path');
const runSrc = cut('function tsimRun(TL,j,post){', 'function tsimStart(){');
const m = html.match(/const WAVE_WASM_B64='([A-Za-z0-9+/=]+)'/);
const X = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(m[1], 'base64')), { m: { pow: Math.pow, sin: Math.sin, cos: Math.cos, exp: Math.exp } }).exports;
const TL = new Function('WS', 'X', libSrc + '\nreturn turboSimLib(WS,X);')(WS, X);
const tsimRun = new Function(runSrc + '\nreturn tsimRun;')();
// the Intake tab's turbine power balance, from the page's own text
const TBF = new Function('wsFactory', 'const P_ATM=101325, R_AIR=287.05, GAMMA=1.4;\n' + cut('const EXH_GAS=(()=>{', 'const sosExh=') + 'const CP_AIRT=GAMMA*R_AIR/(GAMMA-1);\n' +
  cut('function turbineBalance(o){', 'function tsSizeSection(') + '\nreturn {turbineBalance,CP_AIRT};')(new Function(wsSrc + '\nreturn wsFactory;')());
const cap = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'turbo_k24_page.json'), 'utf8'));
const P = cap.plan, PATM = 101325;
const job = o => ({ spec: o.spec || P.spec, na: o.na || P.na, sc: o.sc || P.sc, rpms: P.rpms, dx: P.dx, turbo: true, A0: P.A0, At: o.At || null, Ag: null, wcPer: o.wcPer || P.wcPer });
const order = (md, rpm, k) => { const N = md.length; let re = 0, im = 0; for (let j = 0; j < N; j++) { const a = 2 * Math.PI * k * j / N; re += md[j] * Math.cos(a); im -= md[j] * Math.sin(a); }
  const amp = 2 * Math.hypot(re, im) / N, w = 2 * Math.PI * k / (120 / rpm); return 20 * Math.log10(w * amp / (4 * Math.PI) / Math.SQRT2 / 2e-5); };
function summary(out, eta, p4, afr, Pt) {
  const Vd = out.Vd, cyl = P.cyl, tq = imep => imep * Vd * cyl / (4 * Math.PI), hp = (t, r) => t * r * Math.PI / 30 / 745.7, g = x => (x - PATM) / (Pt - PATM);
  return out.rows.map((w, i) => { const r = w.res, t = r.turb, na = out.na[i], sc = out.sc ? out.sc[i] : null, f = WS.tfmep(w.rpm);
    const tb = TBF.turbineBalance({ ma: t.mAir, afr, t1: P.t1, t2: P.t2, tit: t.T3 - 273.15, p3: t.p3, p4: t.p4, eta });
    const tbA = TBF.turbineBalance({ ma: t.mAir, afr, t1: P.t1, t2: P.t2, tit: 950, p3: PATM + 2 * (Pt - PATM), p4, eta });
    const lo = Math.min(...[].concat(...t.p3bins));
    // brake as the page reads it since part 6 (F6): net IMEP - (tfmep - the pumping mep of the same pipes without boost)
    const pmNA = na.gimep - na.imep;
    return { rpm: w.rpm, At_mm2: w.At * 1e6, Ag_mm2: w.Ag * 1e6, it: w.it, short: w.short, closure: t.W / r.Wc,
      tqB_Nm: tq(r.imep - f + pmNA), tqBnet_Nm: tq(r.imep - f), tqBgross_Nm: tq(r.gimep - f), tqI_Nm: tq(r.imep), hpB: hp(tq(r.imep - f + pmNA), w.rpm), hpBnet: hp(tq(r.imep - f), w.rpm), hpBgross: hp(tq(r.gimep - f), w.rpm), pmepNA_kPa: pmNA / 1000,
      ve_amb: r.ve, ve_charge: r.ve * (PATM / 298.15) / (Pt / P.Tc), resid: r.resid, pmep_kPa: (r.gimep - r.imep) / 1000,
      p3_Pa: t.p3, p3_kPa: t.p3 / 1000, p3sk: g(t.p3s), p3pk_kPa: t.p3pk / 1000, p3min_kPa: lo / 1000, p3k: g(t.p3), p3pkk: g(t.p3pk), p3_over_p2: t.p3 / Pt, p4_kPa: t.p4 / 1000,
      T3_C: t.T3 - 273.15, T4_C: t.T4 - 273.15, W_kW: t.W / 1000, Wc_kW: r.Wc / 1000, mAir: t.mAir, share: t.mg / (t.mt + t.mg), wgAlg: tb.wg, wgPage: tbA.wg, T4alg_page_C: tbA.t4,
      naTqB_Nm: na ? tq(na.gimep - f) : NaN, naHpB: na ? hp(tq(na.gimep - f), w.rpm) : NaN, scTqB_Nm: sc ? tq(sc.imep - f) : NaN,
      ord: [2, 4, 6, 8].map(o => ({ order: o, turbo: order(t.mdBins, w.rpm, 2 * o), noTurbine: sc ? order(sc.turb.mdBins, w.rpm, 2 * o) : NaN, na: order(na.turb.mdBins, w.rpm, 2 * o) })) }; });
}
const t0 = Date.now(), res = {};
// 1. the page's run again
const base = tsimRun(TL, job({}), () => {});
{ const a = cap.sum.rows, b = summary(base, P.eta, P.p4, P.afr, P.Pt); let worst = 0;
  // the browser's Math.pow and Math.exp (which the WebAssembly imports) need not round as Node's do, and the closure's
  // secant amplifies a last-digit difference to anywhere inside its 0.5 % tolerance on the power: so the same plan agrees
  // with the page's run to that tolerance, not to the last digit (within one JavaScript engine the JS and the Rust agree
  // to the last digit, web/tests/wave_wasm.js)
  b.forEach((o, i) => { const pa = a[i]; for (const [x, y] of [[pa.tqB, o.tqB_Nm], [pa.p3, o.p3_Pa], [pa.W, o.W_kW * 1000]]) worst = Math.max(worst, Math.abs(x / y - 1)); });
  console.log((worst < 5e-3 ? 'PASS' : 'FAIL') + ' the page\'s run (Chromium) reproduced from its plan (Node): brake torque, turbine-inlet pressure and turbine power within ' + (100 * worst).toFixed(4) + ' % at all ' + b.length + ' speeds (the closure\'s tolerance 0.5 % of the power)');
  res.base = b; }
// 2. one change at a time
const variants = [
  ['eta065', 'turbine efficiency 0.65', { spec: Object.assign({}, P.spec, { exhaust: Object.assign({}, P.spec.exhaust, { turbine: Object.assign({}, P.spec.exhaust.turbine, { eta: 0.65 }) }) }) }, 0.65, P.p4, P.afr],
  ['eta070', 'turbine efficiency 0.70', { spec: Object.assign({}, P.spec, { exhaust: Object.assign({}, P.spec.exhaust, { turbine: Object.assign({}, P.spec.exhaust.turbine, { eta: 0.70 }) }) }) }, 0.70, P.p4, P.afr],
  ['gatedown', 'internal gate (into the downpipe)', { spec: Object.assign({}, P.spec, { exhaust: Object.assign({}, P.spec.exhaust, { turbine: Object.assign({}, P.spec.exhaust.turbine, { wgTo: 'down' }) }) }) }, P.eta, P.p4, P.afr],
  ['bp2psi', '2 psi back pressure after the turbine', (() => { const p4 = PATM + 13789.5; const ex = Object.assign({}, P.spec.exhaust, { turbine: Object.assign({}, P.spec.exhaust.turbine, { pOut: p4 }) });
    return { spec: Object.assign({}, P.spec, { exhaust: ex }), na: Object.assign({}, P.na, { exhaust: Object.assign({}, P.na.exhaust, { pOut: p4 }) }), sc: Object.assign({}, P.sc, { exhaust: Object.assign({}, P.sc.exhaust, { pOut: p4 }) }) }; })(), P.eta, PATM + 13789.5, P.afr],
  ['afr115', 'AFR 11.5', { spec: Object.assign({}, P.spec, { e: Object.assign({}, P.spec.e, { afr: 11.5 }) }), na: Object.assign({}, P.na, { e: Object.assign({}, P.na.e, { afr: 11.5 }) }), sc: Object.assign({}, P.sc, { e: Object.assign({}, P.sc.e, { afr: 11.5 }) }) }, P.eta, P.p4, 11.5]];
for (const [tag, label, o, eta, p4, afr] of variants) { const out = tsimRun(TL, job(o), () => {}); res[tag] = summary(out, eta, p4, afr, P.Pt); res[tag].label = label; }
fs.writeFileSync(path.join(__dirname, 'results', 'turbo_k24.json'), JSON.stringify({ note: 'tools/validation/wave/turbo_k24.js: the K24A2 + PT5862 prediction (not a validation); plan from results/turbo_k24_page.json', plan: { boost_kPa: (P.Pt - PATM) / 1000, Tc_C: P.Tc - 273.15, eta: P.eta, p4_kPa: P.p4 / 1000, afr: P.afr, A0_mm2: P.A0 * 1e6, rpms: P.rpms, t1: P.t1, t2: P.t2, src: P.src }, res }, null, 1));
// 3. the tables
const f = (x, d) => Number.isFinite(x) ? x.toFixed(d) : '–';
console.log('\nK24A2 + PT5862, boost ' + f((P.Pt - PATM) / 1000, 3) + ' kPa (' + f((P.Pt - PATM) / 6894.757, 2) + ' psi), charge ' + f(P.Tc - 273.15, 1) + ' C, eta ' + P.eta + ', p4 ' + f(P.p4 / 1000, 2) + ' kPa, AFR ' + P.afr);
console.log('| RPM | brake torque N m (lb-ft) | brake hp | gross basis hp | no boost, brake hp | p3 mean kPa (x boost) | p3 peak kPa (x boost) | p3 / p2 | pumping mep kPa | residual | VE charge | T3 / T4 C | gate share run / algebra at run p3,T3 / at 2 x boost | turbine area / gate mm2 |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const o of res.base) console.log('| ' + o.rpm + ' | ' + f(o.tqB_Nm, 0) + ' (' + f(o.tqB_Nm * 0.737562, 0) + ') | ' + f(o.hpB, 0) + ' | ' + f(o.hpBgross, 0) + ' | ' + f(o.naHpB, 0) + ' | ' + f(o.p3_kPa, 1) + ' (' + f(o.p3k, 2) + ') | ' + f(o.p3pk_kPa, 1) + ' (' + f(o.p3pkk, 2) + ') | ' + f(o.p3_over_p2, 3) + ' | ' + f(o.pmep_kPa, 1) + ' | ' + f(100 * o.resid, 1) + ' % | ' + f(o.ve_charge, 3) + ' | ' + f(o.T3_C, 0) + ' / ' + f(o.T4_C, 0) + ' | ' + f(100 * o.share, 1) + ' / ' + f(100 * o.wgAlg, 1) + ' / ' + f(100 * o.wgPage, 1) + ' % | ' + f(o.At_mm2, 0) + ' / ' + f(o.Ag_mm2, 0) + ' |');
const pk = a => a.reduce((b, o, i) => o.hpB > a[b].hpB ? i : b, 0);
console.log('\n| case | peak brake hp @ rpm | peak torque N m @ rpm | p3 mean x boost at peak hp | gate share at peak hp | T3 / T4 C at peak hp |');
console.log('|---|---|---|---|---|---|');
for (const k of ['base'].concat(variants.map(v => v[0]))) { const a = res[k], i = pk(a), j = a.reduce((b, o, q) => o.tqB_Nm > a[b].tqB_Nm ? q : b, 0);
  console.log('| ' + (k === 'base' ? 'as the page runs it' : a.label) + ' | ' + f(a[i].hpB, 0) + ' @ ' + a[i].rpm + ' | ' + f(a[j].tqB_Nm, 0) + ' @ ' + a[j].rpm + ' | ' + f(a[i].p3k, 2) + ' | ' + f(100 * a[i].share, 1) + ' % | ' + f(a[i].T3_C, 0) + ' / ' + f(a[i].T4_C, 0) + ' |'); }
console.log('\nTail orders at 1 m (downpipe end), dB: turbo - same boost no turbine / turbo - no boost');
for (const k of ['base', 'gatedown']) { console.log((k === 'base' ? 'external gate (to the air)' : 'internal gate (into the downpipe)'));
  for (const o of res[k]) console.log('  ' + o.rpm + ' rpm: ' + o.ord.map(q => 'o' + q.order + ' ' + f(q.turbo, 1) + ' (' + f(q.turbo - q.noTurbine, 1) + ' / ' + f(q.turbo - q.na, 1) + ')').join(', ')); }
console.log('\n' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
