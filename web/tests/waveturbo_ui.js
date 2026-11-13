// The wave model's turbocharged engine (wsFactory, 2026-11-13: intake.source, exhaust.pOut, exhaust.turbine) against
// closed-form and independently computed answers. Runs in Node (no browser), about a minute:
//  1. the default is untouched: a source at the atmosphere (101325 Pa, 298.15 K) and a tail back pressure of 101325 Pa give
//     the run without them to the last digit; an engine without them reports no turbine summary;
//  2. the equivalent nozzle in steady flow (inviscid pipes, a reservoir feeding the pipe, the turbine at its end, a downpipe
//     to a back pressure): the mass flow against NASA Glenn's compressible flow equation from the reservoir's total pressure
//     and temperature, choked and unchoked; the pipe end choking when the nozzle is larger than the pipe;
//  3. the work and the gas after the turbine: with the constant gas, W / (eta m) against cp T0 (1 - (p4 / p0)^((g-1)/g))
//     by hand; with the engine's gas, against the isentrope found here from the entropy integral (Simpson, bisection) and
//     the downpipe's stagnation temperature against h(T04) = h(T0) - eta dh_is;
//  4. the steady-flow limit against the Intake tab's turbineBalance (its own source, taken from the page): at the rig's
//     turbine-inlet pressure and temperature, with the compressor power set to the rig's turbine power, the algebra's
//     wastegate share against the rig's (a turbine and a gate to one outlet);
//  5. an engine cycle with the boosted source, the turbine and the gate (into the downpipe, and dumping to the air):
//     mass and total energy (sensible + chemical) conserved to rounding with the turbine's work as a sink; the source's
//     inflow carries h(T_source) exactly;
//  6. the isentrope helper against the frozen-gamma relation where cp is constant (below 200 K and above 3500 K pieces
//     excluded) and its own inverse.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const a0 = html.indexOf('function wsFactory(){'), z0 = html.indexOf('\nconst WS=wsFactory();');
const src = html.slice(a0, z0);
const anchor = 'const U=(G?cy.m*gasE(G,cy.T,cy.x):cy.m*CV*cy.T)-cy.p*dV+';
const hooked = src.replace(anchor, 'cy._pdV=cy.p*dV; cy._qw=qw; cy._Q=cy.burnQ*dxb; cy._mC=vInC[k].m*dt; cy._mP=vIn[k].m*dt; cy._eC=vInC[k].m*vInC[k].h*dt; cy._eP=vIn[k].m*vIn[k].h*dt;\n        ' + anchor)
  .replace('      st.th+=dth;\n', '      if(opts.hook) opts.hook({st,all,dt,dth,cyls,ins,outs,chambers,AC});\n      st.th+=dth;\n');
ok(hooked.indexOf('cy._pdV') > 0 && hooked.indexOf('opts.hook') > 0, 'the model loads with a step hook');
const W = new Function(hooked + '\nreturn wsFactory();')(), GS = W.gas;
const W0 = new Function(src.replace('const FANNING=0.005;', 'const FANNING=0;') + '\nreturn wsFactory();')();   // inviscid, adiabatic pipes
// the Intake tab's turbine power balance, from the page's own text
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return html.slice(i, j); };
const TBsrc = 'const P_ATM=101325, R_AIR=287.05, GAMMA=1.4;\n' + cut('const EXH_GAS=(()=>{', 'const sosExh=') + 'const CP_AIRT=GAMMA*R_AIR/(GAMMA-1);\n' + cut('function turbineBalance(o){', 'function tsSizeSection(');
const TBF = new Function('wsFactory', TBsrc + '\nreturn {turbineBalance,exhGamma,EXH_GAS,CP_AIRT};')(new Function(src + '\nreturn wsFactory;')());

const ENG = { bore: 0.087, stroke: 0.099, rod: 0.1683, cr: 9.6, cd: 0.7, nIn: 2, dIn: 0.035, liftIn: 0.0105, nEx: 2, dEx: 0.03, liftEx: 0.0098,
  cam: { ivo: 10, ivc: 40, evo: 45, evc: 10 }, burn: { start: 15, dur: 55 }, afr: 12, eta: 0.72 };
const INT = { segs: [{ L: 0.3, d0: 0.038, d1: 0.038 }], Tw: 320 };
const EXH = { segs: [{ L: 0.45, d0: 0.0445, d1: 0.0445 }], Tw: 900 };
const OPT = { phases: [0, 180, 360, 540], collector: { segs: [{ L: 0.05, d0: 0.077, d1: 0.058 }, { L: 0.15, d0: 0.058, d1: 0.058 }], Tw: 900 } };
const DOWN = { segs: [{ L: 0.6, d0: 0.0762, d1: 0.0762 }], Tw: 700 };

// ---------- 1. the default untouched
{ const keys = ['ve', 'imep', 'gimep', 'pmax', 'resid', 'pEvo', 'tEx', 'overlapPort'];
  const run = (intake, exhaust) => { const eng = W.makeEngine(ENG, intake, exhaust, OPT); return W.sweep(eng, [4000, 6500], { dx: 0.0125, cycles: 3, firstCycles: 4, maxExtra: 1 }); };
  const a = run(INT, EXH), b = run(Object.assign({}, INT, { source: { p: 101325, T: 298.15 } }), Object.assign({}, EXH, { pOut: 101325 }));
  let d = 0; a.forEach((r, i) => keys.forEach(k => { if (!Object.is(r[k], b[i][k])) d++; }));
  ok(d === 0 && !a[0].turb && b[0].turb && b[0].turb.nE === 0, 'a boosted source at the atmosphere and a tail back pressure of 101325 Pa give the plain run to the last digit (' + d + ' of ' + (2 * keys.length) + ' values differ); only the run with a source reports the cycle\'s air (' +
    (b[1].turb ? (b[1].turb.mAir * 1000).toFixed(2) + ' g/s at 6500 rpm' : 'none') + ')'); }

// ---------- 2-4. the steady rig: reservoir (p0, T0, x) -> pipe A (dA, 0.5 m) -> turbine nozzle (and gate) -> downpipe D (0.5 m) -> pOut
function rig(o) {
  const M = o.M || W0, G = o.G === undefined ? M.gas.makeGas(14.6, true) : o.G, x = 0;
  const mk = (d0, d1, L) => M.makePipe({ L, dx: 0.01, area: y => { const d = d0 + (d1 - d0) * y / L; return Math.PI * d * d / 4; }, Tw: o.T0, T0: o.T0, x0: x, gas: G, p0: o.p0 * 0.9 });
  const A = mk(o.dA0 || o.dA || 0.05, o.dA || 0.05, 0.5), D = mk(o.dD || 0.0762, o.dD || 0.0762, 0.5), fd = { m: 0, h: 0, x: 0, uj: 0 };
  A.left = M.openEnd(-1, o.p0, o.T0, x); A.right = () => {}; D.left = M.fedEnd(-1, () => fd); D.right = M.openEnd(+1, o.pOut, 298.15, 1);
  let t = 0, TF = M.TF, last = null;
  for (let it = 0; it < (o.steps || 60000); it++) {
    M.prim(A); M.prim(D);
    const dt = 0.8 * 0.01 / Math.max(M.maxSpeed(A), M.maxSpeed(D));
    const pT = D.p[0], pG = o.gAtm ? 101325 : pT;
    M.turbineFace(A, o.At, o.Ag || 0, pT, pG, o.eta || 0.7, D, !o.gAtm);
    fd.m = TF.md; fd.h = TF.md !== 0 ? TF.Ed / TF.md : 0; fd.x = TF.x; fd.uj = TF.md / (D.r[0] * D.Af[0]);
    last = { m: TF.m, mt: TF.mt, mg: TF.mg, W: TF.W, dhis: TF.dhis, p0f: TF.p0, pb: TF.pb, h0: TF.h0, pT, mIn: 0 };
    M.stepPipe(A, dt); M.stepPipe(D, dt); t += dt;
    last.mIn = A.f1[0];
  }
  M.prim(D); const i = 5, gD = D.g[i], Td = D.p[i] / (D.Rm[i] * D.r[i]);
  const h0D = G ? M.gas.at(G, Td, D.x[i]).h + 0.5 * D.u[i] * D.u[i] : M.CP * Td + 0.5 * D.u[i] * D.u[i];
  return Object.assign(last, { G, A, D, t, T04: G ? M.gas.T(G, h0D, D.x[i], 900, true) : h0D / M.CP, gEnd: A.g[A.n - 1], REnd: A.Rm[A.n - 1] });
}
const nasa = (Aeff, p0, T0, p4, g, R) => { const pr = p4 / p0, prc = Math.pow(2 / (g + 1), g / (g - 1));
  if (pr <= prc) return Aeff * p0 / Math.sqrt(T0) * Math.sqrt(g / R) * Math.pow((g + 1) / 2, -(g + 1) / (2 * (g - 1)));
  const M2 = 2 / (g - 1) * (Math.pow(pr, -(g - 1) / g) - 1), Ma = Math.sqrt(M2);   // the Mach number at the throat from the pressure ratio
  return Aeff * p0 / Math.sqrt(T0) * Math.sqrt(g / R) * Ma * Math.pow(1 + 0.5 * (g - 1) * M2, -(g + 1) / (2 * (g - 1))); };
{ // 2a choked: 300 kPa, 1100 K into 101.3 kPa, a 5 cm2 nozzle on a 50 mm pipe
  const r = rig({ p0: 300000, T0: 1100, pOut: 101325, At: 5e-4 }), g0 = GS.at(r.G, 1100, 0).gamma;
  const mN = nasa(5e-4, 300000, 1100, r.pT, r.gEnd, r.REnd), mN0 = nasa(5e-4, 300000, 1100, r.pT, g0, r.REnd);
  ok(Math.abs(r.m / mN - 1) < 2e-4 && Math.abs(r.mIn / r.m - 1) < 1e-6 && r.pT / r.p0f < 0.54, 'choked nozzle (p4/p0 ' + (r.pT / r.p0f).toFixed(3) + '): ' + r.m.toFixed(6) + ' kg/s against NASA Glenn\'s choked mass flow from the reservoir ' + mN.toFixed(6) +
    ' (' + (100 * (r.m / mN - 1)).toFixed(4) + ' %, the gas\'s gamma at the pipe end ' + r.gEnd.toFixed(4) + ' as the model freezes it; with gamma at T0 ' + g0.toFixed(4) + ': ' + (100 * (r.m / mN0 - 1)).toFixed(3) + ' %); the pipe\'s inflow ' + r.mIn.toFixed(6) + ' (steady); face total pressure ' + (r.p0f / 1000).toFixed(2) + ' kPa');
  // 2b unchoked: 150 kPa into 120 kPa
  const u = rig({ p0: 150000, T0: 1100, pOut: 120000, At: 5e-4 }), mU = nasa(5e-4, 150000, 1100, u.pT, u.gEnd, u.REnd);
  ok(Math.abs(u.m / mU - 1) < 2e-4 && u.pT / u.p0f > 0.6, 'unchoked nozzle (p4/p0 ' + (u.pT / u.p0f).toFixed(4) + ', p4 the downpipe\'s first cell): ' + u.m.toFixed(6) + ' kg/s against NASA Glenn\'s mass flow at the throat Mach number ' + mU.toFixed(6) + ' (' + (100 * (u.m / mU - 1)).toFixed(4) + ' %)');
  // 2c a nozzle larger than the pipe's end: the pipe (a 60 -> 50 mm cone) chokes at its end face and passes its own choked flow
  const c = rig({ p0: 300000, T0: 1100, pOut: 101325, At: 4e-3, dA0: 0.06, dA: 0.05 }), Ap = c.A.Af[c.A.n], mP = nasa(Ap, 300000, 1100, 1, c.gEnd, c.REnd);
  ok(Math.abs(c.m / mP - 1) < 5e-3, 'nozzle (40 cm2) larger than the end of a 60 -> 50 mm cone (19.6 cm2): the pipe end chokes and passes ' + c.m.toFixed(5) + ' kg/s against the pipe\'s own choked flow ' + mP.toFixed(5) + ' (' + (100 * (c.m / mP - 1)).toFixed(3) + ' %)');
}
{ // 3a the work with the constant gas, by hand
  const r = rig({ G: null, p0: 250000, T0: 1150, pOut: 110000, At: 6e-4, eta: 0.72 }), CP = W0.CP, GAM = W0.GAM;
  const hand = CP * 1150 * (1 - Math.pow(r.pT / 250000, (GAM - 1) / GAM));
  ok(Math.abs(r.W / (0.72 * r.mt) / hand - 1) < 2e-4, 'turbine work, constant gas (gamma 1.35): W / (eta m) ' + (r.W / (0.72 * r.mt)).toFixed(2) + ' J/kg against cp T0 (1 - (p4/p0)^((g-1)/g)) by hand from the reservoir ' + hand.toFixed(2) + ' (' + (100 * (r.W / (0.72 * r.mt) / hand - 1)).toFixed(4) + ' %)');
  const T04 = 1150 - 0.72 * hand / CP;
  ok(Math.abs(r.T04 - T04) < 0.5, 'the gas after the turbine: downpipe stagnation temperature ' + r.T04.toFixed(2) + ' K against T0 - eta dh_is / cp = ' + T04.toFixed(2) + ' K');
  // 3b the engine's gas: the isentrope from the entropy integral (Simpson in ln T, bisection), independent of isenT
  const q = rig({ p0: 250000, T0: 1150, pOut: 110000, At: 6e-4, eta: 0.72 }), G = q.G, R = GS.at(G, 1000, 0).R;
  const sInt = (Ta, Tb) => { const n = 400, h = (Math.log(Tb) - Math.log(Ta)) / n; let s = 0; for (let k = 0; k <= n; k++) { const T = Math.exp(Math.log(Ta) + k * h), f = GS.at(G, T, 0).cp; s += (k === 0 || k === n ? 1 : k % 2 ? 4 : 2) * f; } return s * h / 3; };
  const target = R * Math.log(250000 / q.pT); let lo = 500, hi = 1150; for (let k = 0; k < 80; k++) { const m = 0.5 * (lo + hi); if (sInt(m, 1150) > target) lo = m; else hi = m; }
  const Tis = 0.5 * (lo + hi), hInt = (Ta, Tb) => { const n = 400, h = (Tb - Ta) / n; let s = 0; for (let k = 0; k <= n; k++) s += (k === 0 || k === n ? 1 : k % 2 ? 4 : 2) * GS.at(G, Ta + k * h, 0).cp; return s * h / 3; };
  const dh = hInt(Tis, 1150), wm = q.W / (0.72 * q.mt);
  ok(Math.abs(wm / dh - 1) < 3e-4, 'turbine work, the engine\'s gas (burned, AFR 14.6, cp(T)): W / (eta m) ' + wm.toFixed(2) + ' J/kg against the isentrope integrated here, T_is ' + Tis.toFixed(3) + ' K, dh ' + dh.toFixed(2) + ' (' + (100 * (wm / dh - 1)).toFixed(4) + ' %); frozen gamma at T0 would give ' +
    (hInt(1150 * Math.pow(q.pT / 250000, (GS.at(G, 1150, 0).gamma - 1) / GS.at(G, 1150, 0).gamma), 1150)).toFixed(2));
  const h04 = GS.at(G, 1150, 0).h - 0.72 * dh, T04g = GS.T(G, h04, 0, 1000, true);
  ok(Math.abs(q.T04 - T04g) < 0.5, 'the gas after the turbine, the engine\'s gas: downpipe stagnation temperature ' + q.T04.toFixed(2) + ' K against h(T04) = h(T0) - eta dh_is: ' + T04g.toFixed(2) + ' K');
}
{ // 4 the steady limit of turbineBalance: turbine 4 cm2 and gate 3 cm2 to one outlet at 950 C, 220 kPa
  const r = rig({ p0: 220000, T0: 1223.15, pOut: 110000, At: 4e-4, Ag: 3e-4, eta: 0.7, steps: 80000 }), afr = 14.6;
  const ma = r.m / (1 + 1 / afr), t1 = 25, t2 = t1 + r.W / (ma * TBF.CP_AIRT);
  const tb = TBF.turbineBalance({ ma, afr, t1, t2, tit: 1223.15 - 273.15, p3: r.p0f, p4: r.pT, eta: 0.7 }), share = r.mg / r.m;
  ok(Math.abs(tb.wg - share) < 2e-3 && Math.abs(tb.me / r.m - 1) < 1e-12, 'steady-flow limit: with the compressor power set to the rig\'s turbine power (' + (r.W / 1000).toFixed(3) + ' kW) turbineBalance at the rig\'s p3 ' + (r.p0f / 1000).toFixed(2) + ' kPa (total), T3 950 C, p4 ' + (r.pT / 1000).toFixed(2) +
    ' kPa gives a wastegate share ' + tb.wg.toFixed(4) + ' against the rig\'s ' + share.toFixed(4) + ' (difference ' + (tb.wg - share).toFixed(4) + ': its constant cp at T3, its stoichiometric gas against the model\'s AFR 14.6 products, the model\'s frozen gamma at the pipe end)');
  const per = tb.me * tb.cpe * 1223.15 * 0.7 * (1 - Math.pow(r.pT / r.p0f, (tb.g - 1) / tb.g));
  ok(Math.abs(r.W / (per * (1 - share)) - 1) < 3e-3, 'the same: the rig\'s turbine power ' + (r.W / 1000).toFixed(4) + ' kW against the algebra\'s m_t cp T3 eta (1 - (p4/p3)^k) at the rig\'s turbine share ' + (per * (1 - share) / 1000).toFixed(4) + ' kW (' + (100 * (r.W / (per * (1 - share)) - 1)).toFixed(3) + ' %)');
}

// ---------- 5. an engine cycle: mass and total energy with the source, the turbine and the gate
for (const gAtm of [false, true]) {
  const intake = Object.assign({}, INT, { source: { p: 200000, T: 320 } }), exhaust = Object.assign({}, EXH, { turbine: { CdA: 9e-4, eta: 0.7, wgCdA: 3e-4, wgTo: gAtm ? 'atm' : 'down', down: DOWN, pOut: 115000 } });
  const eng = W.makeEngine(ENG, intake, exhaust, OPT), G = eng.gas, GI = eng.gasIn, st = W.freshState(eng, 0.0125), FAN = 0.005, Hsrc = GS.at(GI, 320, 1).h;
  const stored = s => { let M = 0, E = 0;
    for (const P of [].concat(...s.ins)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * GI.qx) * P.dx; }
    for (const P of [].concat(...s.prims, s.coll, s.turb.down)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * G.qx) * P.dx; }
    for (const c of s.cyls) { M += c.m; E += c.m * (GS.at(G, c.T, c.x).e + c.x * G.qx); } return { M, E }; };
  let prev = stored(st), th0 = null, pW = 0, pMa = 0, pEa = 0, worstH = 0; const B = { mIn: 0, mOut: 0, fuel: 0, flow: 0, sink: 0, dM: 0, dE: 0, Q: 0, inj: 0, W: 0 };
  const r = W.runSpeed(eng, { rpm: 5000, cycles: 5, dx: 0.0125, state: st, hook: c => {
    if (th0 === null) th0 = c.st.th; const last = c.st.th - th0 >= 4 * 720 - 1e-9, now = stored(c.st), A = c.AC;
    if (A.W < pW) { pW = 0; pMa = 0; pEa = 0; }   // the sums start again at each cycle's end
    if (last) { const dt = c.dt;
      for (const L of c.ins) { const P = L[0]; B.mIn += P.f1[0] * dt; B.flow += (P.f3[0] + P.f4[0] * GI.qx) * dt; if (P.f1[0] > 0) worstH = Math.max(worstH, Math.abs(P.f3[0] / P.f1[0] - Hsrc)); }
      for (const P of c.outs) { B.mOut += P.f1[P.n] * dt; B.flow -= (P.f3[P.n] + P.f4[P.n] * G.qx) * dt; }
      B.mOut += A.Matm - pMa; B.flow -= A.Eatm - pEa; B.W += A.W - pW; B.sink += A.W - pW;
      for (const cy of c.cyls) { B.fuel += cy._mC - cy._mP; B.inj += cy._eC - cy._eP; B.sink += cy._qw + cy._pdV + cy._Q * (1 - GS.ETA_C) / GS.ETA_C; B.Q += cy._Q; }
      for (const P of c.all) for (let i = 0; i < P.n; i++) B.sink -= dt * 2 * FAN * P.r[i] * Math.abs(P.u[i]) * P.A[i] / P.D[i] * P.cp[i] * (P.Tw - P.p[i] / (P.Rm[i] * P.r[i])) * P.dx;
      B.dM += now.M - prev.M; B.dE += now.E - prev.E; }
    pW = A.W; pMa = A.Matm; pEa = A.Eatm; prev = now; } });
  const mr = (B.dM - (B.mIn - B.mOut + B.fuel)) / B.mIn, er = (B.dE - (B.flow + B.inj - B.sink)) / B.Q, T = r.turb;
  ok(Math.abs(mr) < 1e-9 && Math.abs(er) < 1e-9 && B.W > 0 && T.mg > 0, 'engine cycle at 5000 rpm, 200 kPa / 320 K charge, turbine 9 cm2 and gate 3 cm2 ' + (gAtm ? 'dumping to the air' : 'into the downpipe') + ': mass residual ' + mr.toExponential(2) + ', total energy residual / heat released ' + er.toExponential(2) +
    ' (turbine work ' + B.W.toFixed(2) + ' J in the cycle, ' + (T.W / 1000).toFixed(2) + ' kW; gate share ' + (T.mg / (T.mt + T.mg)).toFixed(3) + '; turbine inlet ' + (T.p3 / 1000).toFixed(1) + ' kPa mean, ' + (T.p3pk / 1000).toFixed(1) + ' peak; ' + T.T3.toFixed(0) + ' K before, ' + T.T4.toFixed(0) + ' K after)');
  ok(worstH < 1e-14 * Hsrc, 'the source\'s inflow carries h(T_source) to rounding (largest difference ' + worstH.toExponential(1) + ' J/kg of ' + Hsrc.toFixed(1) + ')');
}

// ---------- 6. the isentrope helper
{ const G = W.gas.makeGas(14.6, true); let worst = 0;
  for (const [T1, p1, p2] of [[1200, 2.5e5, 1.1e5], [900, 1.8e5, 1.0e5], [600, 1.2e5, 1.0e5], [1500, 3e5, 1e5]]) {
    const g = GS.at(G, T1, 0).gamma, T2 = W.isenT(G, T1, p1, p2, 0, g), back = W.isenRatio(G, T1, T2, 0) * p1;
    worst = Math.max(worst, Math.abs(back / p2 - 1)); }
  // where cp is held constant (above 3500 K) the ratio is exactly (T2 / T1)^(cp / R)
  const cpH = GS.at(G, 3500, 0).cp, R = GS.at(G, 3500, 0).R, rc = W.isenRatio(G, 3600, 4000, 0), want = Math.pow(4000 / 3600, cpH / R);
  ok(worst < 1e-12 && Math.abs(rc / want - 1) < 1e-13, 'isentrope: isenT inverts isenRatio to ' + worst.toExponential(1) + '; above 3500 K (cp held) the ratio is (T2/T1)^(cp/R) to ' + Math.abs(rc / want - 1).toExponential(1));
}

console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
process.exit(fails.length ? 1 : 0);
