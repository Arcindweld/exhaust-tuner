// Runs the page's wave model (wsFactory) on one engine spec (the page's simSpec form, the one OpenWAM's writer reads)
// at several speeds, each from a cold start, and writes what the comparison needs: VE (trapped fresh charge and
// delivered), net IMEP, the last cycle's traces (cylinder 1's pressure, its exhaust port 10 mm from the valve, the first
// collector cell after the merge, each open end's mass flow), and per-cycle mass and energy balances of the whole system
// (in through the intake mouths, out of the tail ends, stored in pipes, cylinders and side volumes, released by the burn,
// lost to the walls, done as work), so conservation is measured, not assumed.
//   node engine.js job.json out.json      job: {spec, rpms, dx (m), cycles, [fanning], [gamma], [gas]}
// gas: 'const' runs the constant gamma 1.35, R 287 model (spec.e.gas), else the page's default (the NASA gas, 2026-11-12).
'use strict';
const fs = require('fs');
const { load } = require('./lib');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const FAN = job.fanning != null ? job.fanning : 0.005;
const WS = load({ hook: true, fanning: job.fanning, gamma: job.gamma });
const { GAM, RG, CV, CP, PATM, TATM } = WS;
const spec = job.spec, dx = job.dx || 0.01, nCyc = job.cycles || 12;
const e = job.gas ? Object.assign({}, spec.e, { gas: job.gas }) : spec.e;
const eng = WS.makeEngine(e, spec.intake, spec.exhaust, spec.opt), G = eng.gas;
const eOf = (T, x) => G ? WS.gas.at(G, T, x).e : CV * T;   // internal energy per kg on the model's own datum
const rhoRef = PATM / ((G ? (G.Rair || G.Ra) : RG) * TATM), N = eng.phases.length, FA = G && G.fa ? G.fa : 1;   // VE: air (fa: its share of the fresh charge)

function pipesOf(st) {
  return [].concat(...st.ins, ...st.prims, st.coll || [], ...(st.xl || []), ...(st.nets || []).map(n => [].concat(...n.lines)));
}
function stored(st) {
  let M = 0, E = 0;
  for (const P of pipesOf(st)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += P.q3[i] * P.dx; }
  for (const c of st.cyls) { M += c.m; E += c.m * eOf(c.T, c.x); }
  for (const h of st.chambers) { M += h.m; E += h.m * eOf(h.T, h.x); }
  return { M, E };
}
const out = { spec: job.spec, dx, cycles: nCyc, fanning: FAN, gas: G ? 'nasa' : 'const', page: require('./lib').PAGE, runs: [] };
for (const rpm of job.rpms) {
  const t0 = Date.now();
  const st = WS.freshState(eng, dx);
  let prev = stored(st), thStart = null, cyc = -1;
  const bal = [];
  let tr = null;
  const firstAfter = st.coll ? st.coll[0] : st.nets ? st.nets[0].lines[0][0] : null;
  const hook = ctx => {
    if (thStart === null) thStart = ctx.th;
    const c = Math.floor((ctx.th - thStart) / 720 + 1e-9);
    if (c !== cyc) { cyc = c; bal.push({ mIn: 0, mOut: 0, eIn: 0, eOut: 0, Q: 0, qw: 0, pdV: 0, qPipe: 0, dM: 0, dE: 0, mValveIn: 0, mValveEx: 0 }); }
    const B = bal[bal.length - 1], dt = ctx.dt;
    for (const L of ctx.ins) { B.mIn += L[0].f1[0] * dt; B.eIn += L[0].f3[0] * dt; }
    for (const P of ctx.outs) { B.mOut += P.f1[P.n] * dt; B.eOut += P.f3[P.n] * dt; }
    for (const cy of ctx.cyls) { B.Q += cy._Q; B.qw += cy._qw; B.pdV += cy._pdV; B.mValveIn += cy._mI; B.mValveEx -= cy._mE; }
    // pipe wall heat, from the same pre-step state the step used
    for (const P of ctx.all) for (let i = 0; i < P.n; i++) {
      const fr = 2 * FAN * P.r[i] * Math.abs(P.u[i]) * P.A[i] / P.D[i];
      B.qPipe += dt * fr * P.cp[i] * (P.Tw - P.p[i] / (P.Rm[i] * P.r[i])) * P.dx;
    }
    const now = stored(ctx.st); B.dM += now.M - prev.M; B.dE += now.E - prev.E; prev = now;
    if (c === nCyc - 1) {
      if (!tr) tr = { th: [], t: [], pCyl: [], pPort: [], tPort: [], pAfter: [], pIn: [], mOut: ctx.outs.map(() => []), mEx: [], mIv: [] };
      const cy = ctx.cyls[0], ep = ctx.prims[0][0], w = Math.min(1, Math.max(0, (0.01 - 0.5 * ep.dx) / ep.dx));
      tr.th.push(cy.th); tr.t.push(ctx.th); tr.pCyl.push(cy.p);
      tr.pPort.push(ep.p[0] + (ep.p[1] - ep.p[0]) * w);
      tr.tPort.push(ep.p[0] / (ep.Rm[0] * ep.r[0]));
      const ip = ctx.ins[0][ctx.ins[0].length - 1], wi = Math.min(1, Math.max(0, (0.01 - 0.5 * ip.dx) / ip.dx));   // 10 mm before the intake valve
      tr.pIn.push(ip.p[ip.n - 1] + (ip.p[ip.n - 2] - ip.p[ip.n - 1]) * wi);
      tr.mIv.push(cy._mI / dt);
      if (firstAfter) { const wa = Math.min(1, Math.max(0, (0.01 - 0.5 * firstAfter.dx) / firstAfter.dx)); tr.pAfter.push(firstAfter.p[0] + (firstAfter.p[1] - firstAfter.p[0]) * wa); }
      ctx.outs.forEach((P, j) => tr.mOut[j].push(P.f1[P.n]));
      tr.mEx.push(-cy._mE / dt);
    }
  };
  let r, err = null;
  try { r = WS.runSpeed(eng, { rpm, cycles: nCyc, dx, state: st, hook }); } catch (e) { err = String(e.message || e); }
  const h = r ? r.history : [];
  const last = h[h.length - 1] || {};
  const B = bal.slice(0, nCyc);
  const balances = B.map(b => ({
    massResidual: (b.dM - (b.mIn - b.mOut)) / Math.max(1e-12, Math.abs(b.mIn)),
    energyResidual: (b.dE - (b.eIn - b.eOut + b.Q - b.qw - b.pdV + b.qPipe)) / Math.max(1e-12, Math.abs(b.Q)),
    mIn: b.mIn, mOut: b.mOut, dM: b.dM, Q: b.Q, qw: b.qw, pdV: b.pdV, qPipe: b.qPipe, eIn: b.eIn, eOut: b.eOut, dE: b.dE,
    veDelivered: b.mValveIn * FA / (N * rhoRef * eng.Vd)
  }));
  out.runs.push({ rpm, err, seconds: (Date.now() - t0) / 1000, ve: last.ve, imep: last.imep, resid: last.resid, pEvo: last.pEvo, tEx: last.tEx,
    veHistory: h.map(x => x.ve), veDelivered: balances.length ? balances[balances.length - 1].veDelivered : NaN, balances, trace: tr });
  process.stderr.write(rpm + ' rpm: VE ' + (last.ve || NaN).toFixed(4) + ' (' + ((Date.now() - t0) / 1000).toFixed(1) + ' s)\n');
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
