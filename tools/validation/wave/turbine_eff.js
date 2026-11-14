// The turbine's efficiency from the blade speed ratio (docs/WAVE_VALIDATION_2026-11-11.md, addendum part 10). Run from
// the repository root (about 25 minutes on two cores; ONLY=hand|k24|closure|pulse|generic for one part):
//   node tools/validation/wave/turbine_eff.js
// 1. hand: the shaft speed and tip speed of the K24 + PT5862 build from the compressor's work (turboShaft), the blade
//    speed ratio at a steady expansion ratio, the two efficiency forms.
// 2. k24: the owner's build (the page's plan, results/turbo_k24_page.json) through the predict mode at a series of
//    turbine areas, one change at a time (and all together, A+C+D+E): A the efficiency from the blade speed ratio (parabola, Watson; the work
//    coefficient), C bearing friction, D a turbine volute's heat loss (an extra pipe at the manifold wall), E a lower
//    compressor efficiency; the constant efficiency (legacy) as the reference.
// 3. closure: the area found for full boost at 3500 / 4000 / 4500 rpm with each efficiency model (part 9's question).
// 4. pulse: B, the pulse's own effect at one area: the cycle's instantaneous integration against the efficiency taken
//    at the cycle's mass-mean spouting velocity, from the same run.
// 5. generic: the steady balance with the area (turbineAreaBalance) on part 9's generic four with the efficiency from the
//    blade speed ratio at the steady expansion ratio (G40-1150 wheels).
// Writes results/turbine_eff.json.
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
const steadySrc = wsSrc + '\n' + cut('const EXH_GAS=(()=>{', 'const sosExh=') +
  'const R_AIR=287.05, GAMMA=1.4, P_ATM=101325;\nconst CP_AIRT=GAMMA*R_AIR/(GAMMA-1);\nconst LBMIN=60/0.45359237;\n' +
  cut('const ATP_TREF=', 'const corrFlow=') + cut('/* ----- The turbine\'s efficiency from the blade speed ratio', 'function tsSizeSection(');
const ST = new Function(steadySrc + '\nreturn {turbineBalance,turbineAreaBalance,turbAreaFromFlow,nozPsi,exhGamma,EXH_GAS,CP_AIRT,LBMIN,turboShaft,bsrEff,TURBO_MU,TURBO_XO};')();
const ONLY = process.env.ONLY || '', PATM = 101325, OUT = path.join(__dirname, 'results', 'turbine_eff.json');
const res = fs.existsSync(OUT) && ONLY ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const save = () => fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
const mm2 = A => +(A * 1e6).toFixed(1);
const cap = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'turbo_k24_page.json'), 'utf8'));
const P = cap.plan, R = P.R, kc = 0.4 / 1.4, T1 = P.t1 + 273.15;
// the PT5862's wheels (TURBO_LIB; the dealer's listing): compressor exducer 76.2 mm, turbine inducer 71 mm
const DC = 76.2, DT = 71;
const etaC0 = T1 * (Math.pow(R.PRc, kc) - 1) / (P.t2 - P.t1), eps = (P.t2 - R.t3) / (P.t2 - P.p.tamb);
const runSrc = cut('function tsimRun(TL,j,post){', 'function tsimStart(){');
const boostSrc = runSrc.slice(runSrc.indexOf('const boostAt=(sp,s)=>{'), runSrc.indexOf('if(j.turbo&&j.Acap>0'));
const mkBoostAt = comp => new Function('j', boostSrc + '\nreturn boostAt;')({ comp });
const mk = s => TL.rustBackend(s, P.dx);
let VD = 0; { const B = mk(P.spec); VD = B.Vd; B.drop(); }
const hp = (r) => +((r.res.imep - WS.tfmep(r.rpm)) * VD * P.cyl / (4 * Math.PI) * r.rpm * Math.PI / 30 / 745.7).toFixed(1);

// a case: o = {eta, form: null (constant) | 'parabola' | 'watson', mu, fric W at full boost, volute m, etaC}
function caseOf(o) {
  const etaC = o.etaC || etaC0, t2 = P.t1 + T1 * (Math.pow(R.PRc, kc) - 1) / etaC, t3 = t2 - eps * (t2 - P.p.tamb), wcPer = ST.CP_AIRT * (t2 - P.t1);
  const mu = o.mu || ST.TURBO_MU, sh = ST.turboShaft({ dh0: wcPer, Dc: DC, Dt: DT, mu });
  const tb = Object.assign({}, P.spec.exhaust.turbine, { eta: o.eta || 0.75 });
  if (o.form) tb.bsr = o.form === 'watson' ? { U: sh.U, form: 'watson' } : { U: sh.U, xo: ST.TURBO_XO, form: 'parabola' };
  const opt = JSON.parse(JSON.stringify(P.spec.opt));
  if (o.volute > 0) { const sg = opt.collector.segs, d = sg[sg.length - 1].d1; sg.push({ L: o.volute, d0: d, d1: d }); }
  const spec = Object.assign({}, P.spec, { exhaust: Object.assign({}, P.spec.exhaust, { turbine: tb }), opt,
    intake: Object.assign({}, P.spec.intake, { source: { p: P.Pt, T: (o.etaC ? t3 : R.t3) + 273.15 } }) });
  const comp = { Patm: PATM, Pt: P.Pt, PRc: R.PRc, t1: P.t1, etaC, eps, tamb: P.p.tamb, cp: ST.CP_AIRT };
  if (o.form) Object.assign(comp, { mu, Dc: DC, Dt: DT });
  if (o.fric > 0) Object.assign(comp, { fric: o.fric, dhFb: wcPer });
  const wc = o.fric > 0 ? mm => mm * wcPer + o.fric : mm => mm * wcPer;
  return { spec, comp, wc, wcPer, sh, boostAt: mkBoostAt(comp), t2 };
}
const RPMS = [2000, 2500, 3000, 3500, 4000, 4500, 5000, 5550, 6600, 7100];
function predictCase(A, o) {
  const C = caseOf(o), t0 = Date.now();
  const pr = TL.predict(mk, C.spec, { rpms: RPMS, At: A, wc: C.wc, boostAt: s => C.boostAt(C.spec, s) });
  const rows = pr.rows.map(w => { const t = w.res.turb, Pt = w.s < 1 ? C.boostAt(C.spec, w.s).Pt : P.Pt, g = x => (x - PATM) / (Pt - PATM);
    return { rpm: w.rpm, boost_kPa: +((Pt - PATM) / 1000).toFixed(1), below: w.below, p3k_total: +g(t.p3).toFixed(3), p3k_static: +g(t.p3s).toFixed(3), p3pk: +g(t.p3pk).toFixed(3),
      p3s_gauge_kPa: +((t.p3s - PATM) / 1000).toFixed(1), gate_share: +(t.mg / (t.mt + t.mg)).toFixed(3), Ag_mm2: mm2(w.Ag), etaEff: +(t.W / t.Wis).toFixed(4), bsrE: +t.bsrE.toFixed(4),
      xMass: +(C.sh.U * (w.s < 1 ? Math.sqrt((C.boostAt(C.spec, w.s).t2 - P.t1) / (C.t2 - P.t1)) : 1) / Math.sqrt(2 * t.Wis / t.mt)).toFixed(4), ok: w.ok, hp: hp(w), T3_C: +(t.T3 - 273.15).toFixed(0) }; });
  return { A_mm2: mm2(A), o, U: +C.sh.U.toFixed(1), N_rpm: Math.round(C.sh.N), fullBoost_rpm: pr.fullBoost ? Math.round(pr.fullBoost.rpm) : null, fullBoost_at: pr.fullBoost ? pr.fullBoost.at : null, secs: (Date.now() - t0) / 1000, rows };
}
const brief = r => { const pk = r.rows.reduce((b, x) => x.hp > b.hp ? x : b, r.rows[0]), r66 = r.rows.find(x => x.rpm === 6600);
  return 'full boost ' + (r.fullBoost_rpm || '-') + ' (' + r.fullBoost_at + '); 6600: p3 ' + r66.p3k_total + ' tot / ' + r66.p3k_static + ' static x boost, gate ' + r66.gate_share + ', ' + r66.hp + ' hp, etaEff ' + r66.etaEff + ', xE ' + r66.bsrE + '; peak ' + pk.hp + ' hp @ ' + pk.rpm + ' (' + r.secs.toFixed(0) + ' s)'; };

// ---------- 1. hand
if (!ONLY || ONLY === 'hand') {
  const sh = ST.turboShaft({ dh0: P.wcPer, Dc: DC, Dt: DT }), T3 = 1013 + 273.15, g = ST.exhGamma(T3), cpe = g * ST.EXH_GAS.R / (g - 1), k = (g - 1) / g;
  const er = [1.3, 1.6, 2.0, 2.3, 2.8, 3.5].map(e => { const dh = cpe * T3 * (1 - Math.pow(e, -k)), C0 = Math.sqrt(2 * dh), x = sh.U / C0; return { ER: e, dh_kJ: +(dh / 1000).toFixed(2), C0: +C0.toFixed(1), x: +x.toFixed(4), parabola: +ST.bsrEff('parabola', x).toFixed(4), watson: +ST.bsrEff('watson', x).toFixed(4) }; });
  res.hand = { mu: ST.TURBO_MU, dh0_J_kg: P.wcPer, PRc: R.PRc, t2_C: P.t2, U2: sh.U2, N_rpm: sh.N, U_turbine: sh.U, T3_K: T3, gamma: g, cpe, er };
  console.log('\n1. K24 + PT5862 at full boost: mu ' + ST.TURBO_MU.toFixed(4) + ', dh0 ' + P.wcPer.toFixed(1) + ' J/kg -> U2 ' + sh.U2.toFixed(1) + ' m/s, ' + Math.round(sh.N) + ' rpm, turbine tip ' + sh.U.toFixed(1) + ' m/s');
  console.table(er); save();
}

// ---------- 2. k24, predict mode, one change at a time
if (!ONLY || ONLY === 'k24') {
  res.k24 = res.k24 || [];
  const plan = [];
  for (const a of [450, 600, 800, 1000, 1185.4125]) plan.push([a, { eta: 0.75 }, 'legacy'], [a, { eta: 0.75, form: 'parabola' }, 'A parabola'], [a, { eta: 0.75, form: 'watson' }, 'A watson']);
  for (const a of [600, 1000]) plan.push([a, { eta: 0.75, form: 'parabola', mu: 0.65 }, 'A parabola mu 0.65'], [a, { eta: 0.75, form: 'parabola', mu: 0.45 }, 'A parabola mu 0.45'],
    [a, { eta: 0.75, form: 'parabola', fric: 1000 }, 'A + C friction 1 kW'], [a, { eta: 0.75, form: 'parabola', volute: 0.2 }, 'A + D volute 0.2 m'],
    [a, { eta: 0.75, form: 'parabola', etaC: 0.62 }, 'A + E compressor 62 %'], [a, { eta: 0.75, fric: 1000 }, 'C alone'], [a, { eta: 0.75, volute: 0.2 }, 'D alone'], [a, { eta: 0.75, etaC: 0.62 }, 'E alone']);
  // all of A, C, D, E together (C, D, E at their illustrative values): the most this part's physics moves the build
  for (const a of [450, 600, 800, 1000, 1185.4125]) plan.push([a, { eta: 0.75, form: 'parabola', fric: 1000, volute: 0.2, etaC: 0.62 }, 'A+C+D+E']);
  for (const [a, o, name] of plan) {
    if (res.k24.some(r => r.name === name && r.A_mm2 === mm2(a * 1e-6))) continue;
    const r = Object.assign({ name }, predictCase(a * 1e-6, o)); res.k24.push(r); save();
    console.log('2. ' + name + ', ' + a + ' mm2: ' + brief(r)); }
}

// ---------- 3. closure: the area found for full boost at a given rpm
if (!ONLY || ONLY === 'closure') {
  res.closure = res.closure || [];
  for (const lo of [3500, 4000, 4500]) for (const [name, o] of [['legacy', { eta: 0.75 }], ['A parabola', { eta: 0.75, form: 'parabola' }], ['A watson', { eta: 0.75, form: 'watson' }]]) {
    if (res.closure.some(r => r.name === name && r.lo === lo)) continue;
    const C = caseOf(o), B = mk(C.spec), t0 = Date.now();
    try { const rows = TL.closure(B, { rpms: [lo, 6600], wc: C.wc, A0: P.A0 }), r0 = rows[0], r1 = rows[1], t = r1.res.turb, g = x => (x - PATM) / (P.Pt - PATM);
      const out = { name, lo, A_mm2: mm2(r0.At), p3k_lo_static: +g(r0.res.turb.p3s).toFixed(3), p3k_6600_total: +g(t.p3).toFixed(3), p3k_6600_static: +g(t.p3s).toFixed(3), gate_6600: +(t.mg / (t.mt + t.mg)).toFixed(3), hp_6600: hp(r1), etaEff_lo: +(r0.res.turb.W / r0.res.turb.Wis).toFixed(4), etaEff_6600: +(t.W / t.Wis).toFixed(4), secs: (Date.now() - t0) / 1000 };
      res.closure.push(out); save(); console.log('3. closure', JSON.stringify(out)); } finally { B.drop(); } }
}

// ---------- 4. pulse: B at one area, gate shut, full boost: instantaneous against the mass-mean
if (!ONLY || ONLY === 'pulse') {
  res.pulse = [];
  for (const form of ['parabola', 'watson']) for (const a of [600, 1000]) {
    const C = caseOf({ eta: 0.75, form }), B = mk(C.spec);
    try { B.set(a * 1e-6, 0); [2500, 3500, 5000, 6600].forEach((rpm, i) => { const r = B.step(rpm, i === 0, 2, 8, 4), t = r.turb;
      const xM = C.sh.U / Math.sqrt(2 * t.Wis / t.mt), etaMean = 0.75 * ST.bsrEff(form, xM, ST.TURBO_XO);
      const o = { form, A_mm2: a, rpm, U: +C.sh.U.toFixed(1), x_massmean: +xM.toFixed(4), x_energy: +t.bsrE.toFixed(4), eta_inst: +(t.W / t.Wis).toFixed(4), eta_at_mean: +etaMean.toFixed(4), ratio_inst_mean: +((t.W / t.Wis) / etaMean).toFixed(4), W_Wc: +(t.W / C.wc(t.mAir)).toFixed(4) };
      res.pulse.push(o); console.log('4. pulse', JSON.stringify(o)); }); } finally { B.drop(); } }
  save();
}

// ---------- 5. generic four, steady, G40-1150 wheels (TURBO_LIB: 71 / 88 mm compressor, 77 / 70 mm turbine)
if (!ONLY || ONLY === 'generic') {
  const out = [];
  for (const lb of [43, 37]) { const A = ST.turbAreaFromFlow({ Wc: lb / ST.LBMIN, Tref: 288.15, pref: 101325 }).A;
    for (const L of [2.0, 2.4]) for (const bar of [1.0, 1.5]) for (const form of [null, 'parabola', 'watson']) {
      const Pt = PATM + bar * 1e5, Tc = 323.15, ma = 0.95 * L / 1000 * 6500 / 120 * Pt / (287.05 * Tc), PR = (Pt + 10e3) / PATM;
      const t2 = 25 + 298.15 * (Math.pow(PR, 0.4 / 1.4) - 1) / 0.70, sh = ST.turboShaft({ dh0: ST.CP_AIRT * (t2 - 25), Dc: 88, Dt: 77 });
      const b = ST.turbineAreaBalance({ ma, afr: 12, t1: 25, t2, tit: 950, p4: PATM, eta: 0.76, A, bsr: form ? { U: sh.U, form, xo: ST.TURBO_XO } : null });
      out.push({ turbine_lb_min: lb, A_mm2: mm2(A), litres: L, boost_bar: bar, form: form || 'constant', U: +sh.U.toFixed(1), N_rpm: Math.round(sh.N), p3_x_boost: +((b.p3 - PATM) / (bar * 1e5)).toFixed(3), gate_share: +b.wg.toFixed(3), eta3: +(b.eta3 || 0.76).toFixed(4), bsr3: b.bsr3 ? +b.bsr3.toFixed(4) : null, short: b.short });
    } }
  res.generic = out; console.log('\n5. generic four, steady, G40-1150 wheels, eta_max 0.76'); console.table(out); save();
}
