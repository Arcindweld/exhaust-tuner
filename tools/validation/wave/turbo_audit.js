// Independent audit of the turbine boundary (docs/WAVE_VALIDATION_2026-11-11.md, addendum part 6, F1-F2, F9).
// This script only RUNS the page's model (wsFactory from web/index.html) on rigs chosen for the audit and writes what it
// gives to results/turbo_audit_sim.json; the reference values are computed separately, from the equations, by
// turbo_audit.py (Python, its own implementation: brentq root finding, scipy quadrature of cp(T)/T, a linearised
// compact-nozzle acoustic model), which reads that file and writes results/turbo_audit.json.
//   A. the face solve on single cells (five states: unchoked, choked nozzle, pipe end choked, nozzle + external gate,
//      flow back from the downpipe): the face pressure, mass flow, split, work, outlet enthalpy;
//   B. steady rigs (inviscid adiabatic pipe from a reservoir to the turbine nozzle at a fixed outlet pressure): mass flow
//      and face pressure for an unchoked, a choked-nozzle and a choked-pipe-end case, with the constant gas and the
//      engine's gas; the rig's energy balance (reservoir enthalpy in = downpipe enthalpy out + work);
//   C. a pulsating rig (reservoir pressure 220 kPa +- 35 % at 150 Hz, 1 m pipe, choked/unchoked through the cycle):
//      mean mass flow, mean work, the face pressure's first harmonic, on dx 40/20/10/5/2.5 mm (CFL 0.8) and on dx 10 mm with
//      CFL 0.4 and 0.2 (the time step halved at a fixed grid);
//   D. acoustics: a small pressure pulse through the turbine element (6 m pipe -> nozzle -> 8 m downpipe), reflected and
//      transmitted amplitudes, a closed end as the scheme's own loss reference.
// Run from the repository root: node tools/validation/wave/turbo_audit.js   (about 2 minutes)
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const a0 = html.indexOf('function wsFactory(){'), z0 = html.indexOf('\nconst WS=wsFactory();');
const src = html.slice(a0, z0);
if (src.indexOf('const FANNING=0.005;') < 0) throw new Error('FANNING not found');
const W0 = new Function(src.replace('const FANNING=0.005;', 'const FANNING=0;') + '\nreturn wsFactory();')();   // inviscid, adiabatic pipes
const G = W0.gas.makeGas(12, true);   // the exhaust's gas of a 12:1 engine (x = 0: burned)
const out = { gas: { afr: 12, Rb: G.Rb, Rd: G.Rd, blo: G.blo, bhi: G.bhi, dlo: G.dlo, dhi: G.dhi }, A: [], B: [], C: [], D: [] };
const gat = (T, x) => W0.gas.at(G, T, x);

// ---------- A. single-cell face states
function cell(Gx, p, T, u, x, d) {
  const g = Gx ? gat(T, x) : { R: W0.RG, cp: W0.CP, gamma: W0.GAM };
  const P = { n: 1, G: Gx, r: [p / (g.R * T)], u: [u], p: [p], g: [g.gamma], Rm: [g.R], cp: [g.cp], x: [x], Af: [Math.PI * d * d / 4, Math.PI * d * d / 4],
    f1: [0, 0], f2: [0, 0], f3: [0, 0], f4: [0, 0] };
  return P;
}
const statesA = [
  { tag: 'unchoked', p: 150e3, T: 1100, u: 60, d: 0.05846, At: 8e-4, Ag: 0, pT: 110e3, pG: 110e3, eta: 0.75, gDown: true },
  { tag: 'choked nozzle', p: 260e3, T: 1050, u: 80, d: 0.05846, At: 8e-4, Ag: 0, pT: 105e3, pG: 105e3, eta: 0.75, gDown: true },
  { tag: 'pipe end choked', p: 250e3, T: 1000, u: 150, d: 0.05, At: 40e-4, Ag: 0, pT: 101325, pG: 101325, eta: 0.70, gDown: true },
  { tag: 'nozzle + external gate', p: 180e3, T: 1150, u: 40, d: 0.05846, At: 6e-4, Ag: 3e-4, pT: 130e3, pG: 101325, eta: 0.65, gDown: false },
  { tag: 'flow back from the downpipe', p: 110e3, T: 900, u: -20, d: 0.05846, At: 8e-4, Ag: 2e-4, pT: 140e3, pG: 140e3, eta: 0.75, gDown: true,
    D: { p: 140e3, T: 800, u: -5, d: 0.0729 } }];
for (const s of statesA) {
  const P = cell(G, s.p, s.T, s.u, 0, s.d), D = s.D ? cell(G, s.D.p, s.D.T, s.D.u, 0, s.D.d) : cell(G, s.pT, 800, 0, 0, 0.0729);
  W0.turbineFace(P, s.At, s.Ag, s.pT, s.pG, s.eta, D, s.gDown);
  const T = W0.TF;
  out.A.push(Object.assign({}, s, { cell: { r: P.r[0], gamma: P.g[0], R: P.Rm[0], cp: P.cp[0] }, Dcell: { r: D.r[0], gamma: D.g[0], R: D.Rm[0], cp: D.cp[0], p: D.p[0], u: D.u[0] },
    sim: { m: T.m, mt: T.mt, mg: T.mg, pb: T.pb, p0: T.p0, h0: T.h0, W: T.W, dhis: T.dhis, rev: T.rev, Ed: T.Ed, md: T.md, f2: P.f2[1], f3: P.f3[1] } }));
}

// ---------- B / C / D. rigs: reservoir -> pipe A -> turbine nozzle -> (fixed pT, or a real downpipe D -> pOut)
function rig(o) {
  const M = W0, Gx = o.G, x = 0, dx = o.dx || 0.01;
  const area = d => () => Math.PI * d * d / 4;
  const A = M.makePipe({ L: o.L || 0.6, dx, area: area(o.dA || 0.05), Tw: o.T0, T0: o.T0, x0: x, gas: Gx, p0: o.pFill || o.p0 });
  const D = M.makePipe({ L: o.LD || 0.6, dx, area: area(o.dD || 0.0762), Tw: o.T0, T0: o.T0 * 0.85, x0: x, gas: Gx, p0: o.pOut || o.pT || 101325 });
  let t = 0; const pa = () => o.p0f ? o.p0f(t) : o.p0;
  const fd = { m: 0, h: 0, x: 0, uj: 0 };
  A.left = M.openEnd(-1, pa, o.T0, x); A.right = () => {};
  const realD = !o.pT;
  if (realD) { D.left = M.fedEnd(-1, () => fd); D.right = M.openEnd(+1, o.pOut, o.T0, x); }
  const pipes = realD ? [A, D] : [A];
  const rec = { t: [], m: [], pb: [], p0: [], W: [], mt: [], probeA: [], probeD: [], Ein: [], Eout: [] };
  const cfl = o.cfl || 0.8, iA = o.probeA != null ? Math.min(A.n - 1, Math.round(o.probeA / A.dx)) : 0, iD = o.probeD != null ? Math.min(D.n - 1, Math.round(o.probeD / D.dx)) : 0;
  while (t < o.tEnd) {
    let s = 0, dm = 1; for (const P of pipes) { M.prim(P); s = Math.max(s, M.maxSpeed(P)); dm = Math.min(dm, P.dx); }
    const dt = Math.min(cfl * dm / s, o.tEnd - t + 1e-15);
    const pT = realD ? D.p[0] : o.pT;
    if (o.wall) { M.wallEnd(+1)(A); }
    else {
      M.turbineFace(A, o.At, o.Ag || 0, pT, o.gAtm ? 101325 : pT, o.eta, D, !o.gAtm);
      const T = M.TF;
      if (realD) { fd.m = T.md; if (T.md !== 0) { fd.h = T.Ed / T.md; fd.x = T.Xd / T.md; fd.uj = T.md > 0 ? T.md / (D.r[0] * D.Af[0]) : 0; } }
      if (t >= (o.tRec || 0)) { rec.t.push(t); rec.m.push(T.m); rec.mt.push(T.mt); rec.pb.push(T.pb); rec.p0.push(T.p0); rec.W.push(T.W);
        rec.probeA.push(A.p[iA]); rec.probeD.push(D.p[iD]); rec.Ein.push(A.f3[0]); rec.Eout.push(realD ? D.f3[D.n] : T.Ed); rec.dt = rec.dt || []; rec.dt.push(dt); }
    }
    if (o.wall && t >= (o.tRec || 0)) { rec.t.push(t); rec.probeA.push(A.p[iA]); }
    const keepRight = A.right; A.right = () => {}; // the face flux was set above (turbineFace / wallEnd)
    const fs1 = [A.f1[A.n], A.f2[A.n], A.f3[A.n], A.f4[A.n]];
    A.right = P => { P.f1[P.n] = fs1[0]; P.f2[P.n] = fs1[1]; P.f3[P.n] = fs1[2]; P.f4[P.n] = fs1[3]; };
    for (const P of pipes) M.stepPipe(P, dt);
    A.right = keepRight;
    t += dt;
  }
  const last = { m: rec.m[rec.m.length - 1], pb: rec.pb[rec.pb.length - 1], p0: rec.p0[rec.p0.length - 1], W: rec.W[rec.W.length - 1] };
  return { rec, last, A, D };
}
// B. steady
const casesB = [
  { tag: 'unchoked, constant gas', G: null, p0: 150e3, T0: 1000, At: 10e-4, pT: 120e3, eta: 0.75 },
  { tag: 'choked nozzle, constant gas', G: null, p0: 300e3, T0: 1000, At: 8e-4, pT: 110e3, eta: 0.75 },
  { tag: 'pipe end choked, constant gas', G: null, p0: 300e3, T0: 1000, At: 30e-4, pT: 101325, eta: 0.75 },
  { tag: 'unchoked, engine gas', G, p0: 150e3, T0: 1000, At: 10e-4, pT: 120e3, eta: 0.75 },
  { tag: 'choked nozzle, engine gas', G, p0: 300e3, T0: 1100, At: 8e-4, pT: 110e3, eta: 0.75 },
  { tag: 'pipe end choked, engine gas', G, p0: 300e3, T0: 1100, At: 30e-4, pT: 101325, eta: 0.75 }];
for (const c of casesB) {
  const r = rig(Object.assign({ tEnd: 0.08, tRec: 0.075 }, c));
  const n = r.rec.m.length, av = a => a.reduce((s, v) => s + v, 0) / a.length;
  out.B.push({ tag: c.tag, gas: c.G ? 'engine' : 'const', p0: c.p0, T0: c.T0, At: c.At, pT: c.pT, eta: c.eta, Aface: r.A.Af[r.A.n],
    sim: { m: av(r.rec.m), pb: av(r.rec.pb), p0face: av(r.rec.p0), W: av(r.rec.W), mSpread: (Math.max(...r.rec.m) - Math.min(...r.rec.m)) / av(r.rec.m), Ein: av(r.rec.Ein), Eout: av(r.rec.Eout) } });
}
// steady energy balance through a real downpipe (engine gas): reservoir stagnation enthalpy in = downpipe exit flux + work
{ const r = rig({ tag: 'energy', G, p0: 220e3, T0: 1100, At: 8e-4, Ag: 2e-4, gAtm: false, pOut: 101325, eta: 0.72, LD: 0.6, tEnd: 0.12, tRec: 0.11 });
  const av = a => a.reduce((s, v) => s + v, 0) / a.length;
  out.Benergy = { mIn: av(r.rec.m), Ein: av(r.rec.Ein), Eout: av(r.rec.Eout), W: av(r.rec.W), hRes: gat(1100, 0).h, mOut: r.D.f1[r.D.n] }; }
// C. pulsating convergence
const pulse = t => 220e3 * (1 + 0.35 * Math.sin(2 * Math.PI * 150 * t));
const per = 1 / 150, tEnd = 12 * per, tRec = 7 * per;
const fourier = (t, v, f) => { let re = 0, im = 0, s = 0; for (let i = 1; i < t.length; i++) { const d = t[i] - t[i - 1], a = 2 * Math.PI * f * t[i]; re += v[i] * Math.cos(a) * d; im += v[i] * Math.sin(a) * d; s += d; } return 2 * Math.hypot(re, im) / s; };
const tavg = (t, v) => { let a = 0, s = 0; for (let i = 1; i < t.length; i++) { const d = t[i] - t[i - 1]; a += v[i] * d; s += d; } return a / s; };
for (const gas of [null, G]) for (const [dx, cfl] of [[0.04, 0.8], [0.02, 0.8], [0.01, 0.8], [0.005, 0.8], [0.0025, 0.8], [0.01, 0.4], [0.01, 0.2]]) {
  const r = rig({ G: gas, p0f: pulse, p0: 220e3, T0: 1050, At: 8e-4, L: 1.0, pOut: 101325, LD: 0.6, eta: 0.75, dx, cfl, tEnd, tRec });
  out.C.push({ gas: gas ? 'engine' : 'const', dx, cfl, m: tavg(r.rec.t, r.rec.m), W: tavg(r.rec.t, r.rec.W), pb1: fourier(r.rec.t, r.rec.pb, 150), pb2: fourier(r.rec.t, r.rec.pb, 300), p0max: Math.max(...r.rec.p0), steps: r.rec.t.length });
}
// D. acoustics: a Gaussian pressure pulse of 0.2 % from the reservoir after the flow is steady
for (const c of [{ tag: 'unchoked', p0: 140e3, At: 12e-4, eta: 0.75 }, { tag: 'unchoked, no work', p0: 140e3, At: 12e-4, eta: 1e-9 }, { tag: 'choked', p0: 260e3, At: 6e-4, eta: 0.75 }, { tag: 'closed end', p0: 140e3, wall: true }, { tag: 'unchoked, fixed outlet pressure', p0: 140e3, At: 12e-4, eta: 0.75, pT: 115e3 }, { tag: 'unchoked, fixed outlet pressure, no work', p0: 140e3, At: 12e-4, eta: 1e-9, pT: 115e3 }]) {
  // the pulse's run minus the same run without it (linear superposition: the start-up transient cancels), the base run
  // interpolated onto the pulse run's times
  const T0 = 900, t1 = 0.12, tau = 0.4e-3, eps = 0.002;
  const go = e => rig({ G: null, p0f: t => c.p0 * (1 + e * Math.exp(-(((t - t1) / tau) ** 2))), p0: c.p0, pFill: c.wall ? c.p0 : 0.9 * c.p0, T0, At: c.At, eta: c.eta, wall: c.wall, pT: c.pT,
    L: 6, LD: 8, dA: 0.05, dD: 0.0762, pOut: 101325, dx: 0.005, cfl: 0.8, tEnd: 0.1485, tRec: 0.115, probeA: 3.0, probeD: 2.0 });
  const r = go(eps), b = go(0);
  const interp = (tq, ts, vs) => { const o = new Array(tq.length); let j = 0; for (let i = 0; i < tq.length; i++) { while (j < ts.length - 2 && ts[j + 1] < tq[i]) j++; const f = (tq[i] - ts[j]) / (ts[j + 1] - ts[j]); o[i] = vs[j] + f * (vs[j + 1] - vs[j]); } return o; };
  const noD = c.wall || c.pT, bA = interp(r.rec.t, b.rec.t, b.rec.probeA), bD = noD ? null : interp(r.rec.t, b.rec.t, b.rec.probeD);
  const iA = Math.round(3.0 / b.A.dx), iL = b.A.n - 1, iD = Math.round(2 / b.D.dx);
  out.D.push({ tag: c.tag, p0: c.p0, T0, At: c.At || 0, eta: c.eta || 0, Aface: b.A.Af[b.A.n], AD: b.D.Af[0], t1, tau, eps,
    t: r.rec.t, pA: r.rec.probeA.map((v, i) => v - bA[i]), pT: c.pT || null, pD: noD ? null : r.rec.probeD.map((v, i) => v - bD[i]),
    meanA: { p: b.A.p[iA], r: b.A.r[iA], u: b.A.u[iA], g: b.A.g[iA] }, faceA: { p: b.A.p[iL], r: b.A.r[iL], u: b.A.u[iL] },
    meanD: { p: b.D.p[iD], r: b.D.r[iD], u: b.D.u[iD], g: b.D.g[0], p0: b.D.p[0], r0: b.D.r[0], u0: b.D.u[0] } });
}
// thin the acoustic records (every 4th sample)
out.D.forEach(d => { const k = 4; d.t = d.t.filter((_, i) => i % k === 0); d.pA = d.pA.filter((_, i) => i % k === 0); if (d.pD) d.pD = d.pD.filter((_, i) => i % k === 0); });
fs.writeFileSync(path.join(__dirname, 'results', 'turbo_audit_sim.json'), JSON.stringify(out));
console.log('wrote results/turbo_audit_sim.json: A ' + out.A.length + ', B ' + out.B.length + ', C ' + out.C.length + ', D ' + out.D.length);
