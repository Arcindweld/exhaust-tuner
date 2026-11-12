// Cylinder 1 of the page's wave model, step by step over the last cycle of a run, for the like-for-like experiments
// against OpenWAM (docs/WAVE_VALIDATION_2026-11-11.md, part 3, C6; cyl_expts.py drives it):
//   node cyl_trace.js job.json out.json     job: {spec, rpm, dx, cycles, [starts: [{p, T, m, x, label}]]}
// Writes the trace (crank angle in the cylinder's frame, p, T, m, x, burned fraction, the valves' effective areas), the
// state at intake closing, the closed-cycle work (p dV from IVC to EVO), and, for each state in job.starts, the same
// closed cycle run again from that state by a copy of runSpeed's cylinder step (valves shut: the burn, Woschni's wall heat
// and p dV only, with the run's own time steps). The copy is checked against the run itself: from the run's own IVC state it
// must give the run's closed-cycle work (to rounding), else the script refuses.
'use strict';
const fs = require('fs');
const { load } = require('./lib');
const job = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const WS = load({ hook: true });
const spec = job.spec, eng = WS.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt), G = eng.gas, e = eng.e;
const gas = WS.gas, eOf = (T, x) => gas.at(G, T, x).e, Rof = x => gas.at(G, 300, x).R;
const nCyc = job.cycles || 12, dx = job.dx || 0.01, rpm = job.rpm;
const st = WS.freshState(eng, dx);
let thStart = null; const tr = { th: [], dth: [], dt: [], p: [], T: [], m: [], x: [], xb: [], cdaIn: [], cdaEx: [], qw: [], Q: [], pdV: [] };
let ivc = null;
const hook = c => {
  if (thStart === null) thStart = c.th;
  const cyc = Math.floor((c.th - thStart) / 720 + 1e-9);
  if (cyc !== nCyc - 1) return;
  const cy = c.cyls[0];
  // the step just taken: cy.th is its start angle; cy.* now hold the state after it
  tr.th.push(cy.th); tr.dth.push(c.dth); tr.dt.push(c.dt); tr.p.push(cy.p); tr.T.push(cy.T); tr.m.push(cy.m); tr.x.push(cy.x); tr.xb.push(cy.xb);
  tr.cdaIn.push(eng.CdAin(cy.th)); tr.cdaEx.push(eng.CdAex(cy.th)); tr.qw.push(cy._qw); tr.Q.push(cy._Q); tr.pdV.push(cy._pdV);
  if (!ivc && cy.started && cy.fresh != null && Math.abs(cy.th - eng.ivc) < c.dth + 1e-9 && cy.th >= eng.ivc)
    ivc = { p: cy.ivcP, T: cy.ivcT, V: cy.ivcV, m: cy.m, x: cy.fresh / cy.m, fresh: cy.fresh, burnQ: cy.burnQ, k: tr.th.length - 1 };
};
const r = WS.runSpeed(eng, { rpm, cycles: nCyc, dx, state: st, hook });
// the run's own closed cycle: from the IVC step to EVO
const evo = eng.evo, k0 = ivc.k;
let Wrun = 0, Qrun = 0, qwRun = 0;
for (let k = k0; k < tr.th.length && !(tr.th[k] >= evo && tr.th[k] < eng.ivc); k++) { Wrun += tr.pdV[k]; Qrun += tr.Q[k]; qwRun += tr.qw[k]; }
// a copy of runSpeed's cylinder step with the valves shut (the same formulas, in the same order)
function closed(s0) {
  const cy = { m: s0.m, T: s0.T, x: s0.x, xb: 0, burning: false, burnt: false };
  cy.fresh = cy.m * cy.x; cy.burnQ = s0.burnQ != null ? s0.burnQ : cy.fresh * G.qx * (e.etaC != null ? e.etaC : gas.ETA_C);
  cy.ivcP = cy.m * Rof(cy.x) * cy.T / eng.vol(tr.th[k0]); cy.ivcT = cy.T; cy.ivcV = eng.vol(tr.th[k0]);
  let W = 0, Q = 0, qwS = 0, pmax = 0;
  for (let k = k0; k < tr.th.length; k++) {
    const tk = tr.th[k]; if (tk >= evo && tk < eng.ivc) break;
    const dt = tr.dt[k], dth = tr.dth[k];
    const a0 = gas.at(G, cy.T, cy.x); cy.p = cy.m * a0.R * cy.T / eng.vol(tk);
    const a = ((tk - eng.ign) % 720 + 720) % 720;
    let xb = cy.xb;
    if (!cy.burnt) { if (a <= e.burn.dur && (cy.burning || a < 3)) { cy.burning = true; xb = WS.wiebe(a, e.burn.dur); } else if (cy.burning) { xb = 1; cy.burnt = true; } }
    const dxb = Math.max(0, xb - cy.xb); cy.xb = xb;
    const V = eng.vol(tk), dV = eng.dvol(tk) * Math.PI / 180 * dth;
    let qw = 0;
    if (e.woschni !== false) {
      const isC = tk < eng.evo || tk > eng.ivc, Sp = 2 * e.stroke * rpm / 60, pm = cy.ivcP * Math.pow(cy.ivcV / V, 1.32);
      const wv = (isC ? 2.28 : 6.18) * Sp + (isC && cy.burning ? 3.24e-3 * eng.Vd * cy.ivcT / (cy.ivcP * cy.ivcV) * Math.max(0, cy.p - pm) : 0);
      const hc = 3.26 * Math.pow(e.bore, -0.2) * Math.pow(cy.p / 1000, 0.8) * Math.pow(cy.T, -0.55) * Math.pow(wv, 0.8);
      const Aw = 2 * eng.Ap + 4 * (V - eng.Vc) / e.bore + 4 * eng.Vc / e.bore;
      qw = hc * Aw * (cy.T - (e.Twall || 450)) * dt;
    }
    const U = cy.m * eOf(cy.T, cy.x) - cy.p * dV + cy.burnQ * dxb - qw;
    const mf = cy.m * cy.x - cy.fresh * dxb;
    cy.x = Math.min(1, Math.max(0, mf / cy.m)); cy.T = Math.max(200, gas.T(G, U / cy.m, cy.x, cy.T, false));
    W += cy.p * dV; Q += cy.burnQ * dxb; qwS += qw; if (cy.p > pmax) pmax = cy.p;
  }
  return { W, Q, qw: qwS, pmax };
}
const self = closed(ivc);
if (Math.abs(self.W / Wrun - 1) > 1e-6) throw new Error('the closed-cycle copy does not reproduce the run: ' + self.W + ' vs ' + Wrun);
const starts = (job.starts || []).map(s => Object.assign({ label: s.label }, closed(Object.assign({ burnQ: s.burnQ }, s))));
fs.writeFileSync(process.argv[3], JSON.stringify({ rpm, ve: r.ve, imep: r.imep, gimep: r.gimep, Vd: eng.Vd, ivcDeg: eng.ivc, evoDeg: evo, ivoDeg: eng.ivo, evoOpen: eng.evo,
  ign: eng.ign, ivc, closedRun: { W: Wrun, Q: Qrun, qw: qwRun }, closedSelf: self, starts, qx: G.qx, Rfresh: Rof(1), Rburnt: Rof(0), trace: tr }));
process.stderr.write(rpm + ' rpm: VE ' + r.ve.toFixed(4) + ', closed-cycle work ' + Wrun.toFixed(2) + ' J (copy ' + self.W.toFixed(2) + ')\n');
