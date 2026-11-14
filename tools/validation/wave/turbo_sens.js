// How much the turbocharged wave simulation's answer rests on two typed numbers (docs/WAVE_VALIDATION_2026-11-11.md,
// addendum part 6, F4): the K24A2 + Precision PT5862 build of part 5 (the page's own plan, results/turbo_k24_page.json)
// rerun with the full-boost RPM 3000 / 3500 / 4000 / 4500 / 5000 and the turbine efficiency 0.55 / 0.65 / 0.75, the
// closure (turboSimLib.closure, the page's WebAssembly) finding the turbine's effective area at the full-boost RPM with
// the gate shut and the gate's area above it, exactly as the page does. The speeds: the full-boost RPM, then the page's
// own speeds above it (so the speed of peak power, 6600 rpm, is in every run). Also: the closure's tolerance 0.5 % against
// 0.1 % (the page's case), and the calibration closure (turboSimLib.calibrate, part 6) against a measured mean
// pre-turbine pressure.
// Writes results/turbo_sens.json and prints the tables. Run from the repository root (about 5 minutes):
//   node tools/validation/wave/turbo_sens.js
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return html.slice(i, j); };
const wsSrc = cut('function wsFactory(){', '\nconst WS=wsFactory();');
const WS = new Function(wsSrc + '\nreturn wsFactory();')();
const libSrc = cut('function turboSimLib(WS,X){', '// the worker\'s Rust path');
const m = html.match(/const WAVE_WASM_B64='([A-Za-z0-9+/=]+)'/);
const X = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(m[1], 'base64')), { m: { pow: Math.pow, sin: Math.sin, cos: Math.cos, exp: Math.exp } }).exports;
const TL = new Function('WS', 'X', libSrc + '\nreturn turboSimLib(WS,X);')(WS, X);
const cap = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'turbo_k24_page.json'), 'utf8'));
const P = cap.plan, PATM = 101325, ONLY = process.env.ONLY || '';
const withEta = eta => Object.assign({}, P.spec, { exhaust: Object.assign({}, P.spec.exhaust, { turbine: Object.assign({}, P.spec.exhaust.turbine, { eta }) }) });
let VD = 0; const tq = imep => imep * VD * P.cyl / (4 * Math.PI), hp = (t, r) => t * r * Math.PI / 30 / 745.7, gx = x => (x - PATM) / (P.Pt - PATM);
function summarize(rows) {
  return rows.map(w => { const r = w.res, t = r.turb, f = WS.tfmep(w.rpm), b = tq(r.imep - f);
    return { rpm: w.rpm, At_mm2: w.At * 1e6, Ag_mm2: w.Ag * 1e6, short: w.short, it: w.it, closure: t.W / r.Wc, hpB: hp(b, w.rpm), hpGross: hp(tq(r.gimep - f), w.rpm), tqB: b,
      p3k: gx(t.p3), p3pkk: gx(t.p3pk), p3sk: gx(t.p3s), p3_kPa: t.p3 / 1000, pmep_kPa: (r.gimep - r.imep) / 1000, share: t.mg / (t.mt + t.mg), T3_C: t.T3 - 273.15, mAir: t.mAir,
      etaApp: t.W / t.Wis }; });
}
function closureRun(eta, lo, extra) {
  const rpms = [lo].concat(P.rpms.filter(r => r > lo + 200));
  const B = TL.rustBackend(withEta(eta), P.dx); VD = B.Vd;
  try { return summarize(TL.closure(B, Object.assign({ rpms, wc: mm => mm * P.wcPer, A0: P.A0, At: null, Ag: null }, extra || {}))); } finally { B.drop(); }
}
const res = { plan: { boost_kPa: (P.Pt - PATM) / 1000, eta: P.eta, rpms: P.rpms }, grid: [], tol: null, calib: null };
const t0 = Date.now();
if (!ONLY || ONLY === 'grid') for (const eta of [0.55, 0.65, 0.75]) for (const lo of [3000, 3500, 4000, 4500, 5000]) {
  const rows = closureRun(eta, lo), pk = rows.reduce((b, o, i) => o.hpB > rows[b].hpB ? i : b, 0), at = rows.find(o => o.rpm === 6600);
  res.grid.push({ eta, lo, rows, pk: rows[pk], at6600: at });
  console.log('eta ' + eta + ' full boost ' + lo + ': area ' + rows[0].At_mm2.toFixed(0) + ' mm2, p3 mean ' + rows[0].p3k.toFixed(2) + ' x at ' + lo + ', ' + at.p3k.toFixed(2) + ' x at 6600 (peak ' + at.p3pkk.toFixed(2) + '), gate ' + (100 * at.share).toFixed(1) + ' %, pmep ' + at.pmep_kPa.toFixed(0) + ' kPa, brake ' + at.hpB.toFixed(0) + ' hp; peak ' + rows[pk].hpB.toFixed(0) + ' @ ' + rows[pk].rpm + (rows.some(o => o.short) ? '; short at ' + rows.filter(o => o.short).map(o => o.rpm).join(',') : '') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
}
if (!ONLY || ONLY === 'tol') {
  const a = closureRun(0.75, 3500, { tol: 0.005 }), b = closureRun(0.75, 3500, { tol: 0.001 });
  res.tol = { t005: a, t001: b, maxd: { hp: Math.max(...a.map((o, i) => Math.abs(o.hpB / b[i].hpB - 1))), p3: Math.max(...a.map((o, i) => Math.abs(o.p3_kPa / b[i].p3_kPa - 1))), At: Math.abs(a[0].At_mm2 / b[0].At_mm2 - 1),
    share: Math.max(...a.map((o, i) => Math.abs(o.share - b[i].share))) } };
  console.log('tolerance 0.5 % vs 0.1 %: area ' + (100 * res.tol.maxd.At).toFixed(3) + ' %, brake power ' + (100 * res.tol.maxd.hp).toFixed(3) + ' %, p3 ' + (100 * res.tol.maxd.p3).toFixed(3) + ' %, gate share ' + (100 * res.tol.maxd.share).toFixed(2) + ' points');
}
if ((!ONLY || ONLY === 'calib') && TL.calibrate) {
  // the calibration: a measured mean pre-turbine pressure of 2 x boost (gauge, Bell's lower figure) at the full-boost RPM
  const target = PATM + 2 * (P.Pt - PATM), B = TL.rustBackend(P.spec, P.dx);
  try { const c = TL.calibrate(B, { rpm: P.rpms[0], p3: target, wc: mm => mm * P.wcPer, A0: P.A0, eta: P.eta });
    res.calib = { target_kPa: target / 1000, At_mm2: c.At * 1e6, eta: c.eta, p3_kPa: c.res.turb.p3 / 1000, it: c.it, ok: c.ok };
    console.log('calibration to a measured mean p3 of 2 x boost at ' + P.rpms[0] + ' rpm: area ' + (c.At * 1e6).toFixed(0) + ' mm2, p3 ' + (c.res.turb.p3 / 1000).toFixed(1) + ' kPa (target ' + (target / 1000).toFixed(1) + '), the efficiency that balances ' + c.eta.toFixed(3));
  } finally { B.drop(); }
}
fs.writeFileSync(path.join(__dirname, 'results', 'turbo_sens' + (ONLY ? '_' + ONLY : '') + '.json'), JSON.stringify(res, null, 1));
if (res.grid.length) {
  const f = (x, d) => Number.isFinite(x) ? x.toFixed(d) : '-';
  console.log('\n| eta | full-boost rpm | turbine area mm2 (in2) | p3 mean x boost at full-boost rpm | at 6600: p3 mean x | p3 peak x | gate share | pumping mep kPa | brake hp | peak brake hp @ rpm | speeds short |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const g of res.grid) { const r0 = g.rows[0], a = g.at6600;
    console.log('| ' + g.eta + ' | ' + g.lo + ' | ' + f(r0.At_mm2, 0) + ' (' + f(r0.At_mm2 / 645.16, 2) + ') | ' + f(r0.p3k, 2) + ' | ' + f(a.p3k, 2) + ' | ' + f(a.p3pkk, 2) + ' | ' + f(100 * a.share, 1) + ' % | ' + f(a.pmep_kPa, 0) + ' | ' + f(a.hpB, 0) + ' | ' + f(g.pk.hpB, 0) + ' @ ' + g.pk.rpm + ' | ' + (g.rows.filter(o => o.short).map(o => o.rpm).join(', ') || 'none') + ' |'); }
}
console.log(((Date.now() - t0) / 1000).toFixed(0) + ' s');
