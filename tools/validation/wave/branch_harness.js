// The side branch on its own (docs/WAVE_VALIDATION_2026-11-21_resonator_temperature.md): a 2.5 in line with a hot mean flow and a small multisine (30-65 Hz) fed at its start, the branch at xb, open at the far end. run(branch, opts) gives the tip's mass-flow spectrum (amp), the can-to-junction pressure ratio H (the branch's own response: its peak is its resonance) and the branch's state.
const L = require('./lib'); const WS = L.load();
function run(br, o) {
  o = o || {}; const G = WS.gas.makeGas(12.8, true), d = 0.0635, Tg = o.Tg || 900, dx = o.dx || 0.02, Ltot = o.L || 3.0, xb = o.xb || 1.0;
  const line = WS.buildLine({ segs: [{ L: xb, d0: d, d1: d }, { L: Ltot - xb, d0: d, d1: d }], Tw: Tg }, dx, Tg, 0, G);
  const A = Math.PI * d * d / 4, rho0 = WS.PATM / (WS.gas.at(G, Tg, 0).R * Tg), m0 = o.m0 == null ? 0.05 : o.m0, h0 = WS.gas.at(G, Tg, 0).h;
  const fs = []; for (let f = o.f0 || 30; f <= (o.f1 || 65) + 1e-9; f += o.df || 0.25) fs.push(f);
  const ph = fs.map((_, k) => (k * k * 0.7853981) % (2 * Math.PI)), eps = o.eps || 0.004;   // Schroeder-like phases
  let t = 0; const src = { m: m0, h: h0, x: 0, uj: m0 / (rho0 * A) };
  line[0].left = WS.fedEnd(-1, () => src); line[line.length - 1].right = WS.openEnd(+1, WS.PATM, WS.TATM, 1);
  for (let q = 0; q < line.length - 1; q++) { line[q].right = () => {}; line[q + 1].left = () => {}; }
  const Pq = line.find(P => xb >= P.start && xb < P.start + P.n * P.dx) || line[line.length - 1];
  const ch = br ? WS.branchOf(Object.assign({ P: Pq, cell: Math.min(Pq.n - 1, Math.floor((xb - Pq.start) / Pq.dx)) }, br), br.Tw, G, WS.gas.at(G, 300, 0).R) : null;
  const Tend = o.T || 4.5, Tskip = o.skip || 0.5, rec = [], tt = [], pc = [], pj = [], dts = [];
  while (t < Tend) {
    let smax = 0, dmin = 1; for (const P of line) { WS.prim(P); smax = Math.max(smax, WS.maxSpeed(P)); dmin = Math.min(dmin, P.dx); }
    const dt = 0.8 * dmin / smax;
    let s = 0; for (let k = 0; k < fs.length; k++) s += Math.sin(2 * Math.PI * fs[k] * t + ph[k]); src.m = m0 + eps * 0.05 * s; src.uj = Math.max(0, src.m) / (rho0 * A);
    for (let q = 1; q < line.length; q++) WS.junction(line[q - 1], line[q]);
    if (ch) WS.branchStep(ch, ch.P, ch.cell, dt, G);
    for (const P of line) WS.stepPipe(P, dt);
    t += dt; const E = line[line.length - 1]; if (t > Tskip) { rec.push(E.f1[E.n]); dts.push(dt); tt.push(t); if (ch) { pc.push(ch.p); pj.push(ch.P.p[ch.cell]); } }
  }
  // DFT of the tip's mass flow (rectangle rule with each step's dt)
  const dft = (y, f) => { let mu = 0, Tt = 0; for (let j = 0; j < y.length; j++) { mu += y[j] * dts[j]; Tt += dts[j]; } mu /= Tt; let re = 0, im = 0; for (let j = 0; j < y.length; j++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (tt[j] - tt[0]) / (tt[tt.length - 1] - tt[0])); re += (y[j] - mu) * w * dts[j] * Math.cos(2 * Math.PI * f * tt[j]); im += (y[j] - mu) * w * dts[j] * Math.sin(2 * Math.PI * f * tt[j]); } return Math.hypot(re, im); };
  const amp = fs.map(f => dft(rec, f)), H = ch ? fs.map(f => dft(pc, f) / dft(pj, f)) : null;
  return { fs, amp, H, ch };
}
module.exports = { run };
if (require.main === module) {
  const c = 352.5109172070161, dn = 0.0508, A = Math.PI * dn * dn / 4, Le = 0.0762 + 0.6133 * dn, V = A * c * c / ((2 * Math.PI * 45) ** 2 * Le);
  const O = { dx: 0.04, T: 2.5, df: 0.5 }; const t0 = Date.now(); const a = run(null, O), b = run({ V, CdA: A, Le }, O); console.log('s', (Date.now() - t0) / 1000);
  let best = 0, fb = 0; a.fs.forEach((f, k) => { const il = 20 * Math.log10(a.amp[k] / b.amp[k]); if (il > best) { best = il; fb = f; } });
  console.log('IL max', best.toFixed(1), 'dB at', fb, 'Hz; can T', b.ch.T.toFixed(1), 'stroke check vp/Vt', (b.ch.vp / b.ch.Vt).toFixed(2));
  let hb = 0, fh = 0; b.H.forEach((h, k) => { if (h > hb) { hb = h; fh = a.fs[k]; } }); console.log('can/junction pressure peak', hb.toFixed(1), 'at', fh, 'Hz');
  a.fs.forEach((f, k) => { if (k % 4 == 0) console.log(f, (20 * Math.log10(a.amp[k] / b.amp[k])).toFixed(1)); });
}
