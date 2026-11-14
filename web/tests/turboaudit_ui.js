// Independent audit of the turbocharged wave simulation (docs/WAVE_VALIDATION_2026-11-11.md, addendum part 6). Node, no
// browser, about 2 minutes. Every reference value is this audit's own (tools/validation/wave/turbo_audit.py: brentq on the
// characteristic, scipy quadrature of cp(T)/T, NASA Glenn's nozzle equation, a linearised compact-nozzle acoustic model),
// pinned here with its derivation; none comes from the code under test.
//  F1 the face solve on single cells: mass flow, face pressure and work against the re-derivation (5 states);
//  F2 steady rig (inviscid pipe from a reservoir to the nozzle at a fixed outlet pressure) against the closed form;
//  F9 a small pulse through the element: reflection and transmission against the linearised nozzle;
//  F4 the calibration to a measured pre-turbine pressure (turboSimLib.calibrate) recovers a known efficiency and area;
//     the run carries the sensitivity closures (tsimRun: 10 points less efficient, full boost 1000 RPM later);
//  F6 the brake under boost: net IMEP - (tfmep - the same pipes' NA pumping mep), which on an unboosted run is exactly the
//     plain simulation's gross - tfmep;
//  F8 JS and Rust (WebAssembly) bit for bit on this audit's own jobs (a divided turbine with an internal gate; the constant
//     gas with an external gate), and mass and total energy conserved on this audit's own turbo case.
'use strict';
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return html.slice(i, j); };
const src = cut('function wsFactory(){', '\nconst WS=wsFactory();');
const anchor = 'const U=(G?cy.m*gasE(G,cy.T,cy.x):cy.m*CV*cy.T)-cy.p*dV+';
const hooked = src.replace(anchor, 'cy._pdV=cy.p*dV; cy._qw=qw; cy._Q=cy.burnQ*dxb; cy._mC=vInC[k].m*dt; cy._mP=vIn[k].m*dt; cy._eC=vInC[k].m*vInC[k].h*dt; cy._eP=vIn[k].m*vIn[k].h*dt;\n        ' + anchor)
  .replace('      st.th+=dth;\n', '      if(opts.hook) opts.hook({st,all,dt,dth,cyls,ins,outs,chambers,AC});\n      st.th+=dth;\n');
const WS = new Function(src + '\nreturn wsFactory();')(), WH = new Function(hooked + '\nreturn wsFactory();')();
const W0 = new Function(src.replace('const FANNING=0.005;', 'const FANNING=0;') + '\nreturn wsFactory();')();
const m64 = html.match(/const WAVE_WASM_B64='([A-Za-z0-9+/=]+)'/);
const X = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(m64[1], 'base64')), { m: { pow: Math.pow, sin: Math.sin, cos: Math.cos, exp: Math.exp } }).exports;
const libSrc = cut('function turboSimLib(WS,X){', '// the worker\'s Rust path');
const TL = new Function('WS', 'X', libSrc + '\nreturn turboSimLib(WS,X);')(WS, X);
const TLjs = new Function('WS', 'X', libSrc + '\nreturn turboSimLib(WS,X);')(WS, null);
const tsimRun = new Function(cut('function tsimRun(TL,j,post){', 'function tsimStart(){') + '\nreturn tsimRun;')();
const rel = (a, b) => a / b - 1;

// ---------- F1. the face solve (tools/validation/wave/turbo_audit.py, part A; burned gas of a 12:1 engine)
{ const G = W0.gas.makeGas(12, true);
  const cell = (p, T, u, d) => { const g = W0.gas.at(G, T, 0); return { n: 1, G, r: [p / (g.R * T)], u: [u], p: [p], g: [g.gamma], Rm: [g.R], cp: [g.cp], x: [0], Af: [Math.PI * d * d / 4, Math.PI * d * d / 4], f1: [0, 0], f2: [0, 0], f3: [0, 0], f4: [0, 0] }; };
  // [state, m kg/s, pb Pa, W W] from the re-derivation: brentq on rho_b u_b A = the NASA nozzle flow along the arriving
  // characteristic (frozen gamma), the work eta m_t (h0 - h(T_is)) with T_is from the quadrature of cp/T
  const S = [
    ['unchoked', [150e3, 1100, 60, 0.05846, 8e-4, 0, 110e3, 110e3, 0.75, true], 0.113758, 138923, 6670.89],
    ['choked nozzle', [260e3, 1050, 80, 0.05846, 8e-4, 0, 105e3, 105e3, 0.75, true], 0.237983, 243287, 43159.35],
    ['nozzle + external gate', [180e3, 1150, 40, 0.05846, 6e-4, 3e-4, 130e3, 101325, 0.65, false], 0.142610, 155978, 3787.75]];
  for (const [tag, a, mR, pR, WR] of S) {
    const P = cell(a[0], a[1], a[2], a[3]), D = cell(a[6], 800, 0, 0.0729);
    W0.turbineFace(P, a[4], a[5], a[6], a[7], a[8], D, a[9]); const T = W0.TF;
    ok(Math.abs(rel(T.m, mR)) < 5e-6 && Math.abs(rel(T.pb, pR)) < 5e-6 && Math.abs(rel(T.W, WR)) < 5e-6, 'F1 face solve, ' + tag + ': m ' + T.m.toFixed(6) + ' kg/s (re-derived ' + mR + '), face ' + (T.pb / 1000).toFixed(3) + ' kPa (' + (pR / 1000).toFixed(3) + '), work ' + T.W.toFixed(2) + ' W (' + WR + ')');
  }
}

// ---------- F2. steady rig against the closed form (NASA Glenn; constant gas 1.35, R 287; inviscid, adiabatic pipe)
function rig(o) {
  const M = W0, dx = 0.01, ar = d => () => Math.PI * d * d / 4;
  const A = M.makePipe({ L: o.L || 0.6, dx, area: ar(o.dA || 0.05), Tw: o.T0, T0: o.T0, x0: 0, gas: o.G || null, p0: o.pFill || o.p0 });
  const D = M.makePipe({ L: o.LD || 0.6, dx, area: ar(0.0762), Tw: o.T0, T0: o.T0 * 0.85, x0: 0, gas: o.G || null, p0: o.pOut || o.pT || 101325 });
  let t = 0; const fd = { m: 0, h: 0, x: 0, uj: 0 }, realD = !o.pT, rec = { t: [], pA: [], pD: [], m: [] };
  A.left = M.openEnd(-1, () => o.p0f ? o.p0f(t) : o.p0, o.T0, 0); A.right = () => {};
  if (realD) { D.left = M.fedEnd(-1, () => fd); D.right = M.openEnd(+1, o.pOut, o.T0, 0); }
  const pipes = realD ? [A, D] : [A], iA = o.probeA != null ? Math.round(o.probeA / A.dx) : 0, iD = o.probeD != null ? Math.round(o.probeD / D.dx) : 0;
  while (t < o.tEnd) {
    let s = 0; for (const P of pipes) { M.prim(P); s = Math.max(s, M.maxSpeed(P)); }
    const dt = Math.min(0.8 * dx / s, o.tEnd - t + 1e-15);
    M.turbineFace(A, o.At, 0, realD ? D.p[0] : o.pT, realD ? D.p[0] : o.pT, o.eta, D, true); const T = M.TF;
    if (realD) { fd.m = T.md; if (T.md !== 0) { fd.h = T.Ed / T.md; fd.x = T.Xd / T.md; fd.uj = T.md > 0 ? T.md / (D.r[0] * D.Af[0]) : 0; } }
    if (t >= (o.tRec || 0)) { rec.t.push(t); rec.m.push(T.m); rec.pA.push(A.p[iA]); rec.pD.push(D.p[iD]); rec.pb = T.pb; }
    for (const P of pipes) M.stepPipe(P, dt);
    t += dt;
  }
  return { rec, A, D };
}
{ // [p0, T0, At, pT, m closed form, pb closed form]: m = At p0 / sqrt(T0) sqrt(g/R) M (1 + (g-1)/2 M^2)^(-(g+1)/(2(g-1))) at the
  // throat (M = 1 when choked), the face's Mach number from the same law on the pipe's area, p = p0 (1 + (g-1)/2 M^2)^(-g/(g-1))
  for (const [tag, p0, T0, At, pT, mR, pR] of [['unchoked', 150e3, 1000, 10e-4, 120e3, 0.156286, 143640], ['choked nozzle', 300e3, 1000, 8e-4, 110e3, 0.302908, 288091]]) {
    const r = rig({ p0, T0, At, pT, eta: 0.75, tEnd: 0.08, tRec: 0.0799 }), m = r.rec.m[r.rec.m.length - 1];
    ok(Math.abs(rel(m, mR)) < 2e-5 && Math.abs(rel(r.rec.pb, pR)) < 2e-5, 'F2 steady rig, ' + tag + ' (constant gas): m ' + m.toFixed(6) + ' kg/s against the closed form ' + mR + ', face ' + (r.rec.pb / 1000).toFixed(3) + ' kPa against ' + (pR / 1000).toFixed(3));
  }
}

// ---------- F9. a 0.2 % pulse through the element (the pulse's run minus the same run without it)
{ const go = (e, c) => rig({ p0f: t => c.p0 * (1 + e * Math.exp(-(((t - 0.12) / 0.4e-3) ** 2))), p0: c.p0, pFill: 0.9 * c.p0, T0: 900, At: c.At, eta: 0.75, L: 6, LD: 8, pOut: 101325, tEnd: 0.1485, tRec: 0.115, probeA: 3.0, probeD: 2.0 });
  // linear compact nozzle (turbo_audit.py, linear_RT): mass into the nozzle = mass out of the pipe = mass into the downpipe,
  // stagnation enthalpy less the work = the downpipe's; incident and reflected plane waves upstream, a transmitted wave and
  // an entropy wave downstream. Unchoked: R 0.4403, T 0.3857; choked: R 0.9385 (Marble and Candel's (1 - (g-1)M/2) / (1 + (g-1)M/2)
  // at the face's M 0.189), T 0.1480
  for (const [tag, c, RL, TLn] of [['unchoked', { p0: 140e3, At: 12e-4 }, 0.4403, 0.3857], ['choked', { p0: 260e3, At: 6e-4 }, 0.9385, 0.1480]]) {
    const a = go(0.002, c), b = go(0, c), j0 = (t, ts) => { let j = 0; while (j < ts.length - 2 && ts[j + 1] < t) j++; return j; };
    const sig = (key) => a.rec.t.map((t, i) => { const j = j0(t, b.rec.t), f = (t - b.rec.t[j]) / (b.rec.t[j + 1] - b.rec.t[j]); return a.rec[key][i] - (b.rec[key][j] + f * (b.rec[key][j + 1] - b.rec[key][j])); });
    const sA = sig('pA'), sD = sig('pD'), iA = Math.round(3 / b.A.dx), c1 = Math.sqrt(1.35 * b.A.p[iA] / b.A.r[iA]), u1 = b.A.u[iA], iD = Math.round(2 / b.D.dx), cD = Math.sqrt(1.35 * b.D.p[iD] / b.D.r[iD]), uD = b.D.u[iD];
    const area = (s, tc) => { let v = 0; for (let i = 1; i < a.rec.t.length; i++) if (Math.abs(a.rec.t[i] - tc) < 1.6e-3) v += s[i] * (a.rec.t[i] - a.rec.t[i - 1]); return v; };
    const inc = area(sA, 0.12 + 3 / (c1 + u1)), refl = area(sA, 0.12 + 6 / (c1 + u1) + 3 / (c1 - u1)), tra = area(sD, 0.12 + 6 / (c1 + u1) + 2 / (cD + uD));
    const R = refl / inc, T = tra / inc;
    ok(Math.abs(T / TLn - 1) < 0.03 && Math.abs(R / RL - 1) < 0.10, 'F9 small pulse, ' + tag + ': transmitted ' + T.toFixed(4) + ' (linear nozzle ' + TLn + '), reflected ' + R.toFixed(4) + ' (linear ' + RL + '; the scheme loses about 1 % over the 6 m return, a closed end gives 0.991 by peak, 1.000 by area)');
  }
}

// ---------- the audit's own engine (three cylinders on one collector; and four on a divided manifold)
const ENG = { bore: 0.082, stroke: 0.09, rod: 0.15, cr: 9.8, cd: 0.7, nIn: 2, dIn: 0.032, liftIn: 0.0095, nEx: 2, dEx: 0.027, liftEx: 0.0088,
  cam: { ivo: 12, ivc: 48, evo: 52, evc: 12 }, burn: { start: 20, dur: 50 }, afr: 11.8, eta: 0.72 };
const INT = { segs: [{ L: 0.28, d0: 0.036, d1: 0.036 }], Tw: 330, source: { p: 230000, T: 328 } };
const DOWN = { segs: [{ L: 0.7, d0: 0.0635, d1: 0.0635 }], Tw: 700 };
const spec3 = { e: ENG, intake: INT, exhaust: { segs: [{ L: 0.35, d0: 0.04, d1: 0.04 }], Tw: 950, turbine: { CdA: 6e-4, eta: 0.7, wgCdA: 0, wgTo: 'down', down: DOWN, pOut: 108000 } },
  opt: { phases: [0, 240, 480], collector: { segs: [{ L: 0.04, d0: 0.069, d1: 0.05 }, { L: 0.12, d0: 0.05, d1: 0.05 }], Tw: 950 } } };
const specDiv = { e: Object.assign({}, ENG, { afr: 12.3 }), intake: INT, exhaust: { segs: [{ L: 0.3, d0: 0.04, d1: 0.04 }], Tw: 950, turbine: { CdA: 7e-4, eta: 0.66, wgCdA: 1.5e-4, wgTo: 'down', down: DOWN, pOut: 104000 } },
  opt: { phases: [0, 180, 360, 540], collectors: [{ cyls: [0, 3], segs: [{ L: 0.15, d0: 0.045, d1: 0.045 }], Tw: 950 }, { cyls: [1, 2], segs: [{ L: 0.15, d0: 0.045, d1: 0.045 }], Tw: 950 }] } };
const specConst = { e: Object.assign({}, ENG, { gas: 'const' }), intake: INT, exhaust: Object.assign({}, spec3.exhaust, { turbine: Object.assign({}, spec3.exhaust.turbine, { wgCdA: 2e-4, wgTo: 'atm' }) }), opt: spec3.opt };
const WCPER = 1004.5 * 95;   // the compressor's J per kg of air for these jobs (cp (T2 - T1), T2 - T1 = 95 K)

// ---------- F4. calibration: a run at a known efficiency gives a static mean p3; calibrating to it from 0.75 recovers it
{ const eta0 = 0.62, rpm = 4500, dx = 0.0125;
  const B = TL.rustBackend(Object.assign({}, spec3, { exhaust: Object.assign({}, spec3.exhaust, { turbine: Object.assign({}, spec3.exhaust.turbine, { eta: eta0 }) }) }), dx);
  let rows; try { rows = TL.closure(B, { rpms: [rpm], wc: m => m * WCPER, A0: 6e-4, tol: 0.001 }); } finally { B.drop(); }
  const p3s = rows[0].res.turb.p3s, A1 = rows[0].At;
  ok(typeof TL.calibrate === 'function', 'F4 turboSimLib has the calibration to a measured pressure before the turbine');
  if (TL.calibrate) { const c = TL.calibrate(s => TL.rustBackend(s, dx), spec3, { rpm, p3: p3s, wc: m => m * WCPER, A0: 6e-4, eta: 0.75, tol: 0.001 }); c.B.drop();
    ok(c.ok && Math.abs(c.eta / eta0 - 1) < 0.004 && Math.abs(c.At / A1 - 1) < 0.01 && Math.abs(c.res.turb.p3s / p3s - 1) < 0.0015, 'F4 calibrated to the static mean p3 ' + (p3s / 1000).toFixed(2) + ' kPa that a ' + eta0 + ' turbine of ' + (A1 * 1e6).toFixed(1) + ' mm2 gives at ' + rpm + ' rpm, starting from 0.75: efficiency ' + c.eta.toFixed(4) + ', area ' + (c.At * 1e6).toFixed(1) + ' mm2 (' + c.it + ' runs)'); }
}
// the run carries the sensitivity closures, and the first is the closure at 10 points less efficiency
{ const job = { spec: spec3, na: Object.assign({}, spec3, { intake: Object.assign({}, INT, { source: { p: 101325, T: 298.15 } }), exhaust: { segs: spec3.exhaust.segs, Tw: 950, pOut: 108000 } }), sc: null,
    rpms: [3500, 5500], dx: 0.0125, turbo: true, A0: 6e-4, At: null, Ag: null, wcPer: WCPER, eta: 0.7, p3m: null };
  const out = tsimRun(TL, job, () => {});
  const s = out.sens && out.sens[0];
  let same = false;
  if (s) { const B = TL.rustBackend(Object.assign({}, spec3, { exhaust: Object.assign({}, spec3.exhaust, { turbine: Object.assign({}, spec3.exhaust.turbine, { eta: 0.6 }) }) }), 0.0125);
    try { const r = TL.closure(B, { rpms: [3500, s.rpm], wc: m => m * WCPER, A0: out.rows[0].At }); same = Object.is(r[0].At, s.rows[0].At) && Object.is(r[1].Ag, s.rows[1].Ag); } finally { B.drop(); } }
  ok(!!s && s.eta === 0.6 && s.lo === 3500 && same && out.sens.length === 2 && out.sens[1].lo === 4500 && out.sens[1].eta === 0.7, 'F4 the run carries the sensitivity: ' + (s ? out.sens.map(c => 'eta ' + c.eta + ', full boost ' + c.lo + ' rpm: area ' + (c.rows[0].At * 1e6).toFixed(1) + ' mm2').join('; ') + ' (main run ' + (out.rows[0].At * 1e6).toFixed(1) + ' mm2)' : 'none'));
}

// ---------- F6. the brake under boost
{ const P_ATM = 101325, R_AIR = 287.05;
  const TBsrc = 'const P_ATM=101325, R_AIR=287.05, GAMMA=1.4;\n' + cut('const EXH_GAS=(()=>{', 'const sosExh=') + 'const CP_AIRT=GAMMA*R_AIR/(GAMMA-1);\n' + cut('function turbineBalance(o){', 'function tsSizeSection(');
  const turbineBalance = new Function('wsFactory', TBsrc + '\nreturn turbineBalance;')(new Function(src + '\nreturn wsFactory;')());
  const sumSrc = cut('function tsimOrder(md,rpm,k){', '// the run in numbers, per speed') + cut('function tsimSummary(P,out){', '// the manifold section\'s line from the run');
  const tsimSummary = new Function('WS', 'turbineBalance', 'val', 'P_ATM', 'R_AIR', sumSrc + '\nreturn tsimSummary;')(WS, turbineBalance, () => NaN, P_ATM, R_AIR);
  const Vd = 0.0006, rpm = 6000, f = WS.tfmep(rpm), tq = imep => imep * Vd * 4 / (4 * Math.PI);
  const turb = { p3: 2.2e5, p3pk: 2.9e5, p3s: 2.1e5, p4: 1.05e5, T3: 1250, T4: 1120, W: 2e4, mt: 0.3, mg: 0.1, mAir: 0.35, p3bins: [[1, 2]], mdBins: null };
  const P = { cyl: 4, nSim: 4, Pt: 2.5e5, Tc: 330, afr: 12, t1: 25, t2: 120, eta: 0.75, k: 2, p4: 1.05e5, turbo: true };
  // the boosted run: net 2.0e6, gross 2.25e6 (pumping 250 kPa); beside it the same pipes without boost: net 1.15e6, gross 1.2e6 (50 kPa)
  const S = tsimSummary(P, { Vd, rows: [{ rpm, At: 1e-3, Ag: 2e-4, res: { imep: 2.0e6, gimep: 2.25e6, ve: 1.0, resid: 0.02, Wc: 2e4, turb } }], na: [{ rpm, imep: 1.15e6, gimep: 1.2e6 }], sc: null });
  const want = tq(2.0e6 - f + 0.05e6);
  ok(Math.abs(S.rows[0].tqB / want - 1) < 1e-12 && Math.abs(S.rows[0].tqBn - tq(2.0e6 - f)) < 1e-9 && Math.abs(S.rows[0].tqBg - tq(2.25e6 - f)) < 1e-9, 'F6 brake under boost = net IMEP - (tfmep - the NA run\'s pumping mep): ' + S.rows[0].tqB.toFixed(2) + ' N m (by hand ' + want.toFixed(2) + '); one-sided: net - tfmep ' + Number(S.rows[0].tqBn).toFixed(2) + ', gross - tfmep ' + Number(S.rows[0].tqBg).toFixed(2));
  const S2 = tsimSummary(P, { Vd, rows: [{ rpm, At: 1e-3, Ag: 0, res: { imep: 1.15e6, gimep: 1.2e6, ve: 1.0, resid: 0.02, Wc: 2e4, turb } }], na: [{ rpm, imep: 1.15e6, gimep: 1.2e6 }], sc: null });
  ok(Object.is(S2.rows[0].tqB, S2.rows[0].tqBg) || Math.abs(S2.rows[0].tqB - S2.rows[0].tqBg) < 1e-9 * S2.rows[0].tqBg, 'F6 on an unboosted run (the boosted run equal to the one without boost) the brake is the plain simulation\'s gross - tfmep: ' + S2.rows[0].tqB.toFixed(4) + ' and ' + S2.rows[0].tqBg.toFixed(4) + ' N m');
}

// ---------- F8. JS and Rust bit for bit on this audit's own jobs (closure over two speeds)
for (const [tag, spec] of [['divided turbine, two collectors, internal gate', specDiv], ['constant gas, gate to the air', specConst]]) {
  const run = L => { const B = L === 'rust' ? TL.rustBackend(spec, 0.0125) : TLjs.jsBackend(spec, 0.0125); try { return TL.closure(B, { rpms: [4000, 6000], wc: m => m * WCPER, A0: 6e-4 }); } finally { B.drop(); } };
  const a = run('js'), b = run('rust'); let n = 0, d = 0;
  const cmp = (x, y) => { n++; if (!Object.is(x, y)) d++; };
  a.forEach((r, i) => { const s = b[i]; cmp(r.At, s.At); cmp(r.Ag, s.Ag); for (const k of ['ve', 'imep', 'gimep', 'pmax', 'resid', 'pEvo', 'tEx', 'overlapPort']) cmp(r.res[k], s.res[k]);
    for (const k of ['t', 'W', 'Wis', 'mt', 'mg', 'mAir', 'p3', 'p3pk', 'p3s', 'p4', 'T3', 'T4', 'rev', 'mAtm', 'eAtm']) cmp(r.res.turb[k], s.res.turb[k]);
    r.res.turb.p3bins.forEach((v, q) => v.forEach((x, j) => cmp(x, s.res.turb.p3bins[q][j]))); });
  ok(d === 0 && a[0].res.turb.nE === (spec === specDiv ? 2 : 1), 'F8 JS and Rust identical, ' + tag + ': ' + d + ' of ' + n + ' doubles differ (areas ' + a.map(r => (r.At * 1e6).toFixed(1) + '/' + (r.Ag * 1e6).toFixed(1)).join(', ') + ' mm2)');
}

// ---------- F8. mass and total energy on this audit's own turbo case (the divided turbine, the gate to the air)
{ const intake = INT, exhaust = Object.assign({}, specDiv.exhaust, { turbine: Object.assign({}, specDiv.exhaust.turbine, { wgTo: 'atm' }) });
  const eng = WH.makeEngine(specDiv.e, intake, exhaust, specDiv.opt), G = eng.gas, GI = eng.gasIn, GS = WH.gas, st = WH.freshState(eng, 0.0125), FAN = 0.005;
  const lines = s => [].concat(...s.prims, ...(s.nets || []).map(n => [].concat(...n.lines)), s.turb.down);
  const stored = s => { let M = 0, E = 0;
    for (const P of [].concat(...s.ins)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * GI.qx) * P.dx; }
    for (const P of lines(s)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * G.qx) * P.dx; }
    for (const c of s.cyls) { M += c.m; E += c.m * (GS.at(G, c.T, c.x).e + c.x * G.qx); } return { M, E }; };
  let prev = stored(st), th0 = null, pW = 0, pMa = 0, pEa = 0; const B = { mIn: 0, mOut: 0, fuel: 0, flow: 0, sink: 0, dM: 0, dE: 0, Q: 0, inj: 0, W: 0, dump: 0 };
  const r = WH.runSpeed(eng, { rpm: 6200, cycles: 4, dx: 0.0125, state: st, hook: c => {
    if (th0 === null) th0 = c.st.th; const last = c.st.th - th0 >= 3 * 720 - 1e-9, now = stored(c.st), A = c.AC;
    if (A.W < pW) { pW = 0; pMa = 0; pEa = 0; }
    if (last) { const dt = c.dt;
      for (const L of c.ins) { const P = L[0]; B.mIn += P.f1[0] * dt; B.flow += (P.f3[0] + P.f4[0] * GI.qx) * dt; }
      for (const P of c.outs) { B.mOut += P.f1[P.n] * dt; B.flow -= (P.f3[P.n] + P.f4[P.n] * G.qx) * dt; }
      B.mOut += A.Matm - pMa; B.dump += A.Matm - pMa; B.flow -= A.Eatm - pEa; B.W += A.W - pW; B.sink += A.W - pW;
      for (const cy of c.cyls) { B.fuel += cy._mC - cy._mP; B.inj += cy._eC - cy._eP; B.sink += cy._qw + cy._pdV + cy._Q * (1 - GS.ETA_C) / GS.ETA_C; B.Q += cy._Q; }
      for (const P of c.all) for (let i = 0; i < P.n; i++) B.sink -= dt * 2 * FAN * P.r[i] * Math.abs(P.u[i]) * P.A[i] / P.D[i] * P.cp[i] * (P.Tw - P.p[i] / (P.Rm[i] * P.r[i])) * P.dx;
      B.dM += now.M - prev.M; B.dE += now.E - prev.E; }
    pW = A.W; pMa = A.Matm; pEa = A.Eatm; prev = now; } });
  const mr = (B.dM - (B.mIn - B.mOut + B.fuel)) / B.mIn, er = (B.dE - (B.flow + B.inj - B.sink)) / B.Q;
  ok(Math.abs(mr) < 1e-9 && Math.abs(er) < 1e-9 && B.W > 0 && B.dump > 0 && r.turb.nE === 2, 'F8 own case (two entries, gate to the air, 6200 rpm): mass residual ' + mr.toExponential(2) + ', energy residual / heat ' + er.toExponential(2) + ' (turbine ' + B.W.toFixed(1) + ' J, gate dump ' + (1000 * B.dump).toFixed(3) + ' g in the cycle)');
}

console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
process.exit(fails.length ? 1 : 0);
