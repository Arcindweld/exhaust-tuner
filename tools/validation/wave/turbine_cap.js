// The turbine's size from a published flow (docs/WAVE_VALIDATION_2026-11-11.md, addendum part 9). Run from the
// repository root (about 6 minutes on two cores):
//   node tools/validation/wave/turbine_cap.js            (ONLY=conv|k24|generic for one part)
// 1. conv: the published text figures (Garrett) as effective nozzle areas, turbAreaFromFlow, at two reference states.
// 2. k24: the owner's K24A2 + Precision PT5862 build (the page's plan, results/turbo_k24_page.json) through the predict
//    mode (turboSimLib.predict, the page's WebAssembly): the turbine's area held at a series of values, and at each speed
//    the boost it can hold, the gate's share and the pressure before it; and the closure's own area (part 5) as the check
//    that the predict mode reproduces it.
// 3. generic: the steady balance with the area (turbineAreaBalance) for the two Garrett turbines with a published flow on
//    a generic 2.0 and 2.4 L four at 1.0 and 1.5 bar boost, against the logged 1.5-2 x boost of part 6.
// Writes results/turbine_cap.json.
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
// the page's steady functions (no DOM): the exhaust gas, the corrected-flow references, turbineBalance and the part 9 block
const steadySrc = wsSrc + '\n' + cut('const EXH_GAS=(()=>{', 'const sosExh=') +
  'const R_AIR=287.05, GAMMA=1.4, P_ATM=101325;\nconst CP_AIRT=GAMMA*R_AIR/(GAMMA-1);\nconst LBMIN=60/0.45359237;\n' +
  cut('const ATP_TREF=', 'const corrFlow=') + cut('function turbineBalance(o){', 'function tsSizeSection(');
const ST = new Function(steadySrc + '\nreturn {turbineBalance,turbineAreaBalance,turbAreaFromFlow,nozPsi,TCAP_UNITS,exhGamma,EXH_GAS,CP_AIRT,LBMIN,ATP_TREF,ATP_PREF};')();
const ONLY = process.env.ONLY || '', PATM = 101325, res = {};
const mm2 = A => +(A * 1e6).toFixed(1);

// ---------- 1. the published figures as areas
if (!ONLY || ONLY === 'conv') {
  const figs = [['Garrett G40-1150, 1.19 A/R T4 (77 / 70 mm wheel)', 43], ['Garrett GTX4088R, 1.19 A/R (Garrett: "peaks at 37lbs")', 37]];
  res.conv = figs.map(([n, lb]) => {
    const Wc = lb / ST.LBMIN, std = ST.turbAreaFromFlow({ Wc, Tref: 288.15, pref: 101325 }), atp = ST.turbAreaFromFlow({ Wc, Tref: ST.ATP_TREF, pref: ST.ATP_PREF });
    const g135 = ST.turbAreaFromFlow({ Wc, Tref: 288.15, pref: 101325, g: 1.35 }), er2 = ST.turbAreaFromFlow({ Wc, Tref: 288.15, pref: 101325, er: 2.0 });
    return { turbine: n, lb_min: lb, kg_s: Wc, mfp_std_kg_sqrtK_s_bar: std.mfp * 1e5, psi_choked: std.psi, A_std_mm2: mm2(std.A), A_atp_mm2: mm2(atp.A), A_g135_mm2: mm2(g135.A), A_std_if_read_at_ER2_mm2: mm2(er2.A) };
  });
  console.log('\n1. Published turbine flow as an effective area (g 1.3, R 287 unless stated)'); console.table(res.conv);
}

// ---------- 2. the K24 + PT5862 build, predict mode
if (!ONLY || ONLY === 'k24') {
  const cap = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'turbo_k24_page.json'), 'utf8'));
  const P = cap.plan, R = P.R, k = 0.4 / 1.4, T1 = P.t1 + 273.15, etaC = T1 * (Math.pow(R.PRc, k) - 1) / (P.t2 - P.t1), eps = (P.t2 - R.t3) / (P.t2 - P.p.tamb);
  const comp = { Patm: PATM, Pt: P.Pt, PRc: R.PRc, t1: P.t1, etaC, eps, tamb: P.p.tamb, cp: ST.CP_AIRT };
  // the page's boostAt (tsimRun) with this comp
  const runSrc = cut('function tsimRun(TL,j,post){', 'function tsimStart(){');
  const boostSrc = runSrc.slice(runSrc.indexOf('const boostAt=(sp,s)=>{'), runSrc.indexOf('if(j.turbo&&j.Acap>0'));
  const boostAt = new Function('j', boostSrc + '\nreturn boostAt;')({ comp });
  const withEta = (sp, eta) => Object.assign({}, sp, { exhaust: Object.assign({}, sp.exhaust, { turbine: Object.assign({}, sp.exhaust.turbine, { eta }) }) });
  const rpms = [2000, 2500, 3000, 3500, 4000, 4550, 5550, 6600];
  const mk = s => TL.rustBackend(s, P.dx);
  let VD = 0; { const B = mk(P.spec); VD = B.Vd; B.drop(); }
  const one = (A, eta) => { const sp = withEta(P.spec, eta), t0 = Date.now();
    const pr = TL.predict(mk, sp, { rpms, At: A, wc: mm => mm * P.wcPer, boostAt: s => boostAt(sp, s) });
    const rows = pr.rows.map(w => { const t = w.res.turb, Pt = w.s < 1 ? boostAt(sp, w.s).Pt : P.Pt, g = x => (x - PATM) / (Pt - PATM);
      return { rpm: w.rpm, boost_kPa: +((Pt - PATM) / 1000).toFixed(1), below: w.below, p3k_total: +g(t.p3).toFixed(3), p3k_static: +g(t.p3s).toFixed(3), p3pk: +g(t.p3pk).toFixed(3), gate_share: +(t.mg / (t.mt + t.mg)).toFixed(3), Ag_mm2: mm2(w.Ag), W_Wc: +(t.W / w.res.Wc).toFixed(4), it: w.it, ok: w.ok,
        hp_net_tfmep: +((w.res.imep - WS.tfmep(w.rpm)) * VD * P.cyl / (4 * Math.PI) * w.rpm * Math.PI / 30 / 745.7).toFixed(1), T3_C: +(t.T3 - 273.15).toFixed(0) }; });
    return { A_mm2: mm2(A), eta, fullBoost_rpm: pr.fullBoost ? Math.round(pr.fullBoost.rpm) : null, fullBoost_at: pr.fullBoost ? pr.fullBoost.at : null, secs: (Date.now() - t0) / 1000, rows }; };
  res.k24 = [];
  const cases = [[1185.4125, 0.75], [1383, 0.75], [1000, 0.75], [800, 0.75], [600, 0.75], [450, 0.75], [600, 0.65], [800, 0.65]];
  for (const [a, e] of cases) { const r = one(a * 1e-6, e); res.k24.push(r);
    const r66 = r.rows.find(x => x.rpm === 6600);
    console.log('\n2. K24 + PT5862 build, turbine ' + a + ' mm2, eta ' + e + ': full boost ' + (r.fullBoost_rpm || '-') + ' rpm (' + r.fullBoost_at + '), 6600 rpm: p3 ' + r66.p3k_total + ' x boost total, ' + r66.p3k_static + ' static, gate ' + r66.gate_share + ' (' + r.secs.toFixed(0) + ' s)');
    console.table(r.rows.map(x => ({ rpm: x.rpm, boost: x.boost_kPa, p3k: x.p3k_total, p3s: x.p3k_static, gate: x.gate_share, hp: x.hp_net_tfmep, WWc: x.W_Wc, ok: x.ok }))); }
}

// ---------- 3. generic four, steady balance with the published areas
if (!ONLY || ONLY === 'generic') {
  // a generic four at peak power: 6500 rpm, VE 0.95 on the charge at the intercooler outlet (50 C), compressor 70 %,
  // inlet 25 C at the atmosphere, charge-side loss 10 kPa, AFR 12, turbine inlet 950 C (the page's default), outlet the
  // atmosphere, turbine x mechanical efficiency 0.66 / 0.70 / 0.76 (Garrett's stated peaks span 66-76 %)
  const out = [];
  for (const lb of [43, 37]) { const A = ST.turbAreaFromFlow({ Wc: lb / ST.LBMIN, Tref: 288.15, pref: 101325 }).A;
    for (const L of [2.0, 2.4]) for (const bar of [1.0, 1.5]) for (const eta of [0.66, 0.70, 0.76]) {
      const Pt = PATM + bar * 1e5, Tc = 323.15, ma = 0.95 * L / 1000 * 6500 / 120 * Pt / (287.05 * Tc), PR = (Pt + 10e3) / PATM;
      const t2 = 25 + 298.15 * (Math.pow(PR, 0.4 / 1.4) - 1) / 0.70;
      const b = ST.turbineAreaBalance({ ma, afr: 12, t1: 25, t2, tit: 950, p4: PATM, eta, A });
      out.push({ turbine_lb_min: lb, A_mm2: mm2(A), litres: L, boost_bar: bar, eta, air_kg_s: +ma.toFixed(4), p3_gauge_kPa: +((b.p3 - PATM) / 1000).toFixed(1), p3_x_boost: +((b.p3 - PATM) / (bar * 1e5)).toFixed(3), gate_share: +b.wg.toFixed(3), short: b.short });
    } }
  res.generic = out;
  console.log('\n3. Generic four at 6500 rpm, steady balance with the published areas'); console.table(out);
}
fs.writeFileSync(path.join(__dirname, 'results', 'turbine_cap' + (ONLY ? '_' + ONLY : '') + '.json'), JSON.stringify(res, null, 1));
