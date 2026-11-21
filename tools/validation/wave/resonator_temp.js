// The side-branch resonator in the engine run (docs/WAVE_VALIDATION_2026-11-21_resonator_temperature.md): one bank of a
// cross-plane V8 (the four-cylinder job of web/tests/fixtures/wave_jobs.json fired at 0, 270, 450, 540), its collector into
// a 2.5 in (63.5 mm) line 2.3 m long, open; the Mufflers tab's 45 Hz Helmholtz can (2 x 3 in neck, its defaults; volume
// from calcHelm's formula at 43.3 C) at a distance x from the line's start. For each case: the can's gas temperature after
// the run, the tip's order levels (d mdot / dt of the open end, the monopole the Sound tab plays) and the transfer-matrix
// insertion loss of the same layout (plane waves, closed at the valve, the line at the run's mean gas temperature, the can
// at its shell temperature, the neck's quadratic exit loss linearised at the run's neck velocity: Rienstra and Hirschberg
// 8.3 as the page's branchPeak). PAGE=<old page> runs another copy of the model (the before numbers).
//   node tools/validation/wave/resonator_temp.js [rpm] [pIn Pa or 0 for WOT] [cycles] [x m ...]
'use strict';
const fs = require('fs'), path = require('path'); const { load, ROOT } = require('./lib'); const WS = load({ hook: true });
const jobs = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/tests/fixtures/wave_jobs.json'), 'utf8'));
const C316 = 352.5109172070161;                    // the page's sosExh(43.333) (window.__sosExh), m/s
const DPIPE = 0.0635, LLINE = 2.3, DN = 0.0508, LN = 0.0762, HELM_END = 0.6133;
const A = Math.PI * DN * DN / 4, Le = LN + HELM_END * DN, V = A * C316 * C316 / ((2 * Math.PI * 45) ** 2 * Le);
function spec(x, br) {
  const s = JSON.parse(JSON.stringify(jobs[1].job.variants[0].spec)); s.opt.phases = [0, 270, 450, 540];
  const col = s.opt.collector, L0 = col.segs.reduce((a, g) => a + g.L, 0), d1 = col.segs[col.segs.length - 1].d1;
  col.segs.push({ L: 0.1, d0: d1, d1: DPIPE }, { L: LLINE - 0.1, d0: DPIPE, d1: DPIPE });
  if (x != null) col.branches = [Object.assign({ x: L0 + x, V, CdA: A, Le }, br || {})];
  return { s, L0 };
}
function orders(rec, rpm, ks) {   // amplitude of each half order of d(mdot)/dt over the recorded cycles
  const R = rec.outs[0], t = rec.time, n = t.length, T = t[n - 1] - t[0], d = [];
  for (let j = 1; j < n; j++) d.push((R.mdot[j] - R.mdot[j - 1]) / (t[j] - t[j - 1]));
  return ks.map(k => { const f = k * rpm / 60; let re = 0, im = 0; for (let j = 1; j < n; j++) { const dt = t[j] - t[j - 1]; re += d[j - 1] * Math.cos(2 * Math.PI * f * t[j]) * dt; im += d[j - 1] * Math.sin(2 * Math.PI * f * t[j]) * dt; } return 2 * Math.hypot(re, im) / T; });
}
function run(x, o) {
  const { s } = spec(x, o.br), eng = WS.makeEngine(s.e, s.intake, s.exhaust, s.opt);
  let um = 0, th0 = null; const hook = c => { const ch = c.chambers[0]; if (!ch) return; if (th0 == null) th0 = c.th; if (c.th - th0 > 720 * (o.cycles - 1)) { const u = ch.Q != null ? Math.abs(ch.Q) / ch.CdA : Math.abs(ch.mdot) / (ch.m / ch.V * ch.CdA); if (u > um) um = u; } };
  const r = WS.runSpeed(eng, { rpm: o.rpm, cycles: o.cycles, dx: o.dx || 0.02, pIn: o.pIn || undefined, record: true, recordCycles: 2, hook });
  const ch = r.state.chambers[0], R = r.rec.outs[0], Tm = R.T.reduce((a, v) => a + v, 0) / R.T.length;
  return { ve: r.ve, ch: ch ? { T: ch.T, Q: ch.Q, Tw: ch.Tw, rho: ch.m / ch.V, um } : null, lev: orders(r.rec, o.rpm, o.ks), Ttip: Tm };
}
// the transfer-matrix insertion loss at f of the can at x (m from the line's start) on the layout (primary, collector,
// line), closed at the valve, open end with the unflanged end correction 0.6133 a and its radiation resistance
function tmIL(f, x, Tg, Tc, Rn) {
  const { s, L0 } = spec(null), G = WS.gas.makeGas(12.8, true), gp = WS.gas.at(G, Tg, 0), gc = WS.gas.at(G, Tc, 0);
  const c = Math.sqrt(gp.gamma * gp.R * Tg), rho = WS.PATM / (gp.R * Tg), cc = Math.sqrt(gc.gamma * gc.R * Tc), rhoc = WS.PATM / (gc.R * Tc), k = 2 * Math.PI * f / c, w = 2 * Math.PI * f;
  const segs = s.exhaust.segs.concat(s.opt.collector.segs), cx = (a, b) => ({ re: a, im: b }), mul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re), add = (a, b) => cx(a.re + b.re, a.im + b.im), div = (a, b) => { const q = b.re * b.re + b.im * b.im; return cx((a.re * b.re + a.im * b.im) / q, (a.im * b.re - a.re * b.im) / q); };
  const mm = (P, Q) => [add(mul(P[0], Q[0]), mul(P[1], Q[2])), add(mul(P[0], Q[1]), mul(P[1], Q[3])), add(mul(P[2], Q[0]), mul(P[3], Q[2])), add(mul(P[2], Q[1]), mul(P[3], Q[3]))];
  const seg = (L, d) => { const S = Math.PI * d * d / 4, Z = rho * c / S; return [cx(Math.cos(k * L), 0), cx(0, Z * Math.sin(k * L)), cx(0, Math.sin(k * L) / Z), cx(Math.cos(k * L), 0)]; };
  const pieces = []; segs.forEach(g => { const n = Math.max(1, Math.round(g.L / 0.01)); for (let i = 0; i < n; i++) pieces.push({ L: g.L / n, d: g.d0 + (g.d1 - g.d0) * (i + 0.5) / n }); });
  const Zb = cx(Rn, rhoc * w * Le / A - rhoc * cc * cc / (w * V)), sh = [cx(1, 0), cx(0, 0), div(cx(1, 0), Zb), cx(1, 0)];   // Zb = p / volume velocity
  const tip = withB => { let T = [cx(1, 0), cx(0, 0), cx(0, 0), cx(1, 0)], at = 0; const xb = (s.exhaust.segs.reduce((a, g) => a + g.L, 0)) + L0 + x; let done = !withB;
    for (const p of pieces) { if (!done && at + p.L > xb) { const a = xb - at; T = mm(T, seg(a, p.d)); T = mm(T, sh); T = mm(T, seg(p.L - a, p.d)); done = true; } else T = mm(T, seg(p.L, p.d)); at += p.L; }
    const a = DPIPE / 2, S = Math.PI * a * a, Zr = cx(rho * c / S * (k * a) ** 2 / 4, rho * c / S * k * 0.6133 * a);
    // source: volume velocity U0 = 1 at the valve; tip volume velocity Ut from [p0; U0] = T [Zr Ut; Ut]
    const U0 = add(mul(T[2], Zr), T[3]); return 1 / Math.hypot(U0.re, U0.im); };
  return 20 * Math.log10(tip(false) / tip(true));
}
module.exports = { spec, run, tmIL, V, A, Le };
if (require.main === module) {
  const rpm = +(process.argv[2] || 1800), pIn = +(process.argv[3] || 0), cycles = +(process.argv[4] || 8), xs = process.argv.slice(5).map(Number);
  const ks = [1, 1.5, 2, 3], o = { rpm, pIn, cycles, ks };
  const b = run(null, o); console.log('no can: VE ' + b.ve.toFixed(3) + ', tip gas ' + b.Ttip.toFixed(0) + ' K, orders ' + ks.join(' ') + ': ' + b.lev.map(v => (20 * Math.log10(v)).toFixed(1)).join(' '));
  for (const x of (xs.length ? xs : [0.3, 0.9, 1.5])) { const r = run(x, o);
    const d = r.lev.map((v, i) => 20 * Math.log10(b.lev[i] / v));
    console.log('can at ' + x + ' m: can gas ' + r.ch.T.toFixed(0) + ' K; IL by order ' + d.map(v => v.toFixed(1)).join(' ') + ' dB; neck u peak ' + r.ch.um.toFixed(0) + ' m/s; TM IL at 45 Hz (can at 316 K, the exit loss linearised at that peak) ' + tmIL(45, x, b.Ttip, 316.48, 4 * r.ch.rho * r.ch.um / (3 * Math.PI * A)).toFixed(1) + ' dB, lossless ' + tmIL(45, x, b.Ttip, 316.48, 0).toFixed(1));
  }
}
