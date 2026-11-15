// The two-zone reference's input (docs/WAVE_VALIDATION_2026-11-11.md part 12, L3; knock_ref.py reads it): the K24A2 + PT5862
// 18 psi pump-gas job at its speed of the largest integral, run by the page's model with the wall heat off (spec.e.woschni
// false; the reference is adiabatic) and on (the page's run): cylinder 1's closed period (crank angle after IVC, p, the single
// zone's T, V), the Wiebe's ignition and duration, the gas's e, cp and R at the trapped mixture's x and at x = 0 (the burned
// products) on a 1 K grid, and knockLib's own unburned temperatures and integral for the comparison.
//   node tools/validation/wave/knock_refdump.js      writes results/knock_ref_in.json
'use strict';
const fs = require('fs'), path = require('path');
const { WS, KN, runOne } = require('./knock_run');
const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'knock_k24_jobs.json'), 'utf8'));
const S = jobs.find(j => Math.abs(j.psi - 18) < 0.01 && j.fuel === 'pump').S, row = S.rows.find(r => r.rpm === 5050);
const out = { rpm: row.rpm, ON: 95, cases: {} };
for (const [k, wo] of [['adiabatic', false], ['page', undefined]]) {
  const spec = wo === false ? Object.assign({}, S.spec, { e: Object.assign({}, S.spec.e, { woschni: false }) }) : S.spec;
  const { eng, r } = runOne(spec, row.rpm, { At: row.At, Ag: row.Ag, dx: S.dx }), pts = KN.closedPeriod(r.trace, eng), Tu = KN.unburned(pts, eng.gas, 0), I = KN.integral(pts, Tu, eng, row.rpm, { ON: 95 });
  const x0 = pts[0].x, G = eng.gas, tab = { T: [], eu: [], cpu: [], Ru: [], eb: [], cpb: [], Rb: [], emid: [] };
  for (let T = 250; T <= 3600; T += 1) { const a = WS.gas.at(G, T, x0), b = WS.gas.at(G, T, 0), m = WS.gas.at(G, T, 0.5 * x0); tab.T.push(T); tab.eu.push(a.e); tab.cpu.push(a.cp); tab.Ru.push(a.R); tab.eb.push(b.e); tab.cpb.push(b.cp); tab.Rb.push(b.R); tab.emid.push(m.e); }
  const th0 = eng.ivc;
  out.cases[k] = { ivc: eng.ivc, ign: eng.ign, dur: eng.e.burn.dur, x0, u: pts.map(q => q.u), p: pts.map(q => q.p), T: pts.map(q => q.T), V: pts.map(q => eng.vol((th0 + q.u) % 720)),
    TuJS: Tu, IJS: I, tab };
  console.log(k, 'I', I.I.toFixed(4), 'TuEnd', I.TuEnd.toFixed(2), 'caEnd', I.caEnd.toFixed(2), 'n', pts.length);
}
fs.writeFileSync(path.join(__dirname, 'results', 'knock_ref_in.json'), JSON.stringify(out));
