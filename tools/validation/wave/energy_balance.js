// Whole-engine energy balance of the page's wave model (docs/WAVE_VALIDATION_2026-11-11.md, part 7, G sections): where
// the fuel's chemical energy goes, measured from the model over one whole engine cycle (720 deg of cylinder 1's frame)
// after the run has settled, as fractions of the fuel's chemical energy (fuel inducted x LHV 44 MJ/kg):
//   brake work (gross IMEP - Heywood's tfmep, as the page reads brake), friction (net work - brake: tfmep less the model's own
//   pumping loop), wall heat in the cylinder split by phase (closed cycle IVC-EVO; gas exchange EVO-TDC, the blowdown and
//   exhaust stroke; TDC-IVC, overlap and intake), in the head's exhaust port (the first portL of each primary from the
//   valve), in the rest of the exhaust pipes and in the intake pipes (negative: heat into the charge), the sensible
//   enthalpy (+ kinetic) leaving the port and leaving the tail ends relative to the 298.15 K datum (the intake brings
//   none: the air and the fuel enter at 298.15 K), the chemical energy left unreleased (fuel x LHV - the heat the model
//   released: rich CO and H2 of the frozen products, the 2.5 % of ETA_C, fresh charge short-circuited), the storage change
//   and the residual of the sensible-energy balance (which the model conserves to rounding).
// Temperatures: the mass-averaged (enthalpy-averaged) and the time-averaged gas temperature at the port's exit (the face
// portL from the valve) and at the tail ends.
//   node energy_balance.js [cases=ls3,k24] [tag=name] [ls3rpms=3000,4600,5800] [k24rpms=3500,5550,7100] [k24port=m] [e.k=JSON ...]
//   PAGE=<copy of web/index.html> runs another version of the page (the 'before' of part 7).
// LS3: ratings.js's realistic case (whole engine, plenum, throttle, measured head flow: intake=plenum flow=benchfam), its
// 150 mm port at the primary's 44.5 mm. K24: the K24A2 build's "same pipes, no boost" run of the page's turbo plan
// (results/turbo_k24_page.json, plan.na): the turbo manifold from the head flange, no port in the plan (k24port=m adds one
// of that length at the runner's bore, an ASSUMPTION: the K24's port length is not sourced).
// Results: results/energy_<tag>.json.
'use strict';
const fs = require('fs'), path = require('path');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const R = require('./ratings.js'), WS = R.WS;
const LHV = 44e6;
const eOver = (e, a) => { for (const k of Object.keys(a)) if (k.startsWith('e.')) { const ks = k.slice(2).split('.'); let o = e; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = JSON.parse(a[k]); } return e; };

function cases() {
  const want = (args.cases || 'ls3,k24').split(','), out = [];
  if (want.includes('ls3')) {
    const c = R.lib.find(x => x.k === 'ls3');
    const spec = R.specOf(c, { intake: 'plenum', flow: 'benchfam' });
    // its 150 mm port is marked port: true (ratings.js); before part 7 the page had no port law (PAGE=<older page>)
    eOver(spec.e, args);
    out.push({ name: 'LS3 (ratings.js c_final: whole engine, plenum, measured head flow; 150 mm port)', key: 'ls3', spec, cyl: 8, portL: 0.15,
      rpms: (args.ls3rpms || '3000,4600,5800').split(',').map(Number) });
  }
  if (want.includes('k24')) {
    const cap = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'turbo_k24_page.json'), 'utf8'));
    const spec = JSON.parse(JSON.stringify(cap.plan.na));
    let portL = 0;
    if (+args.k24port > 0) { portL = +args.k24port; const d = spec.exhaust.segs[0].d0; spec.exhaust.segs.unshift({ L: portL, d0: d, d1: d, primary: true, port: true }); }
    eOver(spec.e, args);
    out.push({ name: 'K24A2 (the turbo plan without boost: plan.na, open after the manifold)' + (portL ? ', port ' + portL * 1000 + ' mm (assumed)' : ''), key: 'k24', spec, cyl: 4, portL,
      rpms: (args.k24rpms || '3500,5550,7100').split(',').map(Number) });
  }
  return out;
}

function storedSens(st, G, CVc) {
  let E = 0;
  const pipes = [].concat(...st.ins, ...st.prims, st.coll || [], ...(st.xl || []), ...(st.nets || []).map(n => [].concat(...n.lines)), st.plen ? st.plen.inlet : [], st.turb ? st.turb.down : []);
  for (const P of pipes) for (let i = 0; i < P.n; i++) E += P.q3[i] * P.dx;
  const eOf = (T, x) => G ? WS.gas.at(G, T, x).e : CVc * T;
  for (const c of st.cyls) E += c.m * eOf(c.T, c.x);
  for (const h of st.chambers) E += h.m * eOf(h.T, h.x);
  if (st.plen) { const GI = st.plenGas; E += st.plen.m * (GI ? WS.gas.at(GI, st.plen.T, st.plen.x).e : CVc * st.plen.T); }
  return { E, pipes };
}

function one(cs, rpm, state) {
  const spec = cs.spec, eng = WS.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt), G = eng.gas, N = eng.phases.length;
  if (state) state.plenGas = eng.gasIn;
  // settle: as ratings.js (8 cycles from cold, then 2-cycle runs until VE changes < 0.4 %), then 2 more cycles, then measure one
  let r = WS.runSpeed(eng, { rpm, cycles: state ? 4 : 8, dx: 0.0125, state });
  for (let x = 0; x < 6; x++) { const h = r.history, n = h.length; if (n >= 2 && Math.abs(h[n - 1].ve - h[n - 2].ve) < 0.004 * h[n - 1].ve) break; r = WS.runSpeed(eng, { rpm, cycles: 2, dx: 0.0125, state: r.state }); }
  r = WS.runSpeed(eng, { rpm, cycles: 2, dx: 0.0125, state: r.state });
  const st = r.state; st.plenGas = eng.gasIn;
  const s0 = storedSens(st, G, WS.CV);
  for (const P of s0.pipes) if (P._qc) P._qc.fill(0);
  const A = { fuel: 0, Q: 0, Wn: 0, Wg: 0, qwC: 0, qwEx: 0, qwIn: 0, Hport: 0, Mport: 0, Xport: 0, Hout: 0, Mout: 0, Xout: 0, Hin: 0, Min: 0, t: 0, TportT: 0, ToutT: 0, Hgate: 0, rev: 0 };
  const exIdx = new Set(), portFace = [];
  st.prims.forEach(line => {
    line.forEach(P => exIdx.add(P));
    let face = null;
    if (cs.portL > 0) for (const P of line) { const x = cs.portL - P.start; if (x > 1e-9 && x <= P.n * P.dx + 1e-9) { face = { P, j: Math.round(x / P.dx) }; break; } }
    else face = { P: line[0], j: 0 };
    portFace.push(face);
  });
  const inPipes = new Set([].concat(...st.ins, st.plen ? st.plen.inlet : []));
  // the port's heat split by whether that cylinder's exhaust valve is open (the time-averaged correlation's h is held over
  // the whole cycle, so it also acts on the gas standing in the port while the valve is shut)
  const portCells = st.prims.map(line => line.filter(P => P.np > 0).map(P => ({ P, n: P.np, last: 0 })));
  let qOpen = 0, qShut = 0;
  const hook = c => {
    const dt = c.dt; A.t += dt;
    for (const cy of c.cyls) {
      A.fuel += cy._fuel || 0; A.rev += cy._rev || 0; A.Q += cy._Q; A.Wn += cy._pdV; const tk = cy.th; if (tk >= 540 || tk < 180) A.Wg += cy._pdV;
      if (tk < eng.evo || tk > eng.ivc) A.qwC += cy._qw; else if (tk < 360) A.qwEx += cy._qw; else A.qwIn += cy._qw;
    }
    c.cyls.forEach((cy, k) => { let q = 0; for (const pc of portCells[k]) { let t = 0; for (let i = 0; i < pc.n; i++) t += pc.P._qc[i]; q += t - pc.last; pc.last = t; }
      if (eng.CdAex(cy.th) > 0) qOpen -= q; else qShut -= q; });
    for (const f of portFace) {
      // the face portL from the valve; at portL 0 the valve face itself (the left end of the primary: flux into the pipe)
      const P = f.P, j = f.j; A.Hport += P.f3[j] * dt; A.Mport += P.f1[j] * dt; A.Xport += P.f4[j] * dt;
      const i = Math.min(P.n - 1, j); A.TportT += P.p[i] / (P.Rm[i] * P.r[i]) * dt / portFace.length;
    }
    for (const P of c.outs) { A.Hout += P.f3[P.n] * dt; A.Mout += P.f1[P.n] * dt; A.Xout += P.f4[P.n] * dt; A.ToutT += P.p[P.n - 1] / (P.Rm[P.n - 1] * P.r[P.n - 1]) * dt / c.outs.length; }
    if (c.PL) { const I = c.PL.inlet[0]; A.Hin += I.f3[0] * dt; A.Min += I.f1[0] * dt; }
    else for (const L of c.ins) { A.Hin += L[0].f3[0] * dt; A.Min += L[0].f1[0] * dt; }
  };
  const th0 = st.th;
  r = WS.runSpeed(eng, { rpm, cycles: 1, dx: 0.0125, state: st, hook });
  if (Math.abs(r.state.th - th0 - 720) > 1) throw new Error('measurement window is not one cycle');
  const s1 = storedSens(r.state, G, WS.CV);
  let qPort = 0, qExh = 0, qIn = 0;
  for (const P of s1.pipes) { if (!P._qc) continue;
    for (let i = 0; i < P.n; i++) { const q = P._qc[i];
      if (inPipes.has(P)) qIn += q;
      else if (exIdx.has(P) && cs.portL > 0 && P.start + (i + 0.5) * P.dx < cs.portL) qPort += q;
      else qExh += q; } }
  // the pipes' _qc is heat INTO the gas: losses are its negative
  const Vd = eng.Vd, fm = WS.tfmep(rpm), brake = A.Wg - fm * Vd * N, F = A.fuel * LHV;
  // A.rev: the sensible enthalpy of the fuel pushed back into the intake that the port injector takes out of the model (portFuel)
  const dE = s1.E - s0.E, sensRes = A.Q - (A.Wn + A.qwC + A.qwEx + A.qwIn - qPort - qExh - qIn + A.Hout - A.Hin + dE + A.rev);
  const hT = (H, M, X) => M > 0 ? (G ? WS.gas.T(G, H / M, Math.min(1, Math.max(0, X / M)), 900, true) : H / (M * WS.CP)) : NaN;
  const fr = v => v / F;
  const row = {
    rpm, ve: r.ve, fuelJ: F, brake: fr(brake), friction: fr(A.Wn - brake), net: fr(A.Wn), gross: fr(A.Wg), tfmep: fm, pump: (A.Wg - A.Wn) / (N * Vd),
    cylClosed: fr(A.qwC), cylExh: fr(A.qwEx), cylInt: fr(A.qwIn), port: fr(-qPort), exPipes: fr(-qExh), inPipes: fr(-qIn),
    Hport: fr(A.Hport), Htail: fr(A.Hout - A.Hin), chem: fr(F - A.Q), released: fr(A.Q), dE: fr(dE), rev: fr(A.rev), residual: sensRes / A.Q,
    closure: fr(brake) + fr(A.Wn - brake) + fr(A.qwC + A.qwEx + A.qwIn) + fr(-qPort - qExh - qIn) + fr(A.Hout - A.Hin) + fr(F - A.Q) + fr(dE) + fr(A.rev),
    TportMass: hT(A.Hport, A.Mport, A.Xport), TportTime: A.TportT / A.t, TtailMass: hT(A.Hout, A.Mout, A.Xout), TtailTime: A.ToutT / A.t,
    portOpen: fr(qOpen), portShut: fr(qShut), mPortPerCyl: A.Mport / (A.t * N), tEx: r.tEx, brakeTq: brake / (4 * Math.PI) * cs.cyl / N, imep: r.imep, gimep: r.gimep
  };
  return { row, state: r.state };
}

const out = { page: path.relative(path.resolve(__dirname, '..', '..', '..'), process.env.PAGE || path.join(__dirname, '..', '..', '..', 'web', 'index.html')), args, cases: [] };
const t0 = Date.now();
for (const cs of cases()) {
  const rows = []; let state = null;
  for (const rpm of cs.rpms) { const o = one(cs, rpm, state); state = o.state; rows.push(o.row);
    const q = o.row, p = v => (100 * v).toFixed(1);
    process.stderr.write(cs.key + ' ' + rpm + ': brake ' + p(q.brake) + ' fric ' + p(q.friction) + ' cyl ' + p(q.cylClosed) + '+' + p(q.cylExh) + '+' + p(q.cylInt) + ' port ' + p(q.port) + ' exPipes ' + p(q.exPipes) +
      ' inPipes ' + p(q.inPipes) + ' Hport ' + p(q.Hport) + ' Htail ' + p(q.Htail) + ' chem ' + p(q.chem) + ' dE ' + p(q.dE) + ' | closure ' + p(q.closure) + ' resid ' + q.residual.toExponential(1) +
      ' | T port ' + q.TportMass.toFixed(0) + '/' + q.TportTime.toFixed(0) + ' tail ' + q.TtailMass.toFixed(0) + '/' + q.TtailTime.toFixed(0) + ' K (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)\n'); }
  out.cases.push({ key: cs.key, name: cs.name, portL: cs.portL, rows });
}
const f = path.join(__dirname, 'results', 'energy_' + (args.tag || 'run') + '.json');
fs.writeFileSync(f, JSON.stringify(out, null, 1));
process.stderr.write('wrote ' + f + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)\n');
