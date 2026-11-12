// Known answers of the wave model's building blocks (wsFactory in web/index.html, loaded as wave_wasm.js loads it), the
// checks of docs/WAVE_VALIDATION_2026-11-11.md that guard the fixes made there and the textbook limits around them:
// Sod's shock tube, a closed pipe's modes, closed ends (walls and shut valves may not make a wave grow), the open end (small waves of either sign come back at -1 with the node at the
// pipe's end, steady inflow is steady, isentropic and adiabatic, choked outflow passes A p0 psi*/sqrt(R T0)), the sudden
// area change (a contraction passes no more than the isentropic flow and makes no entropy, an expansion loses
// Borda-Carnot's stagnation pressure) and one engine cycle's mass and energy balance. The full set with the numbers is
// tools/validation/wave/kat.js. Runs in Node, about 20 s.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const a0 = html.indexOf('function wsFactory(){'), z0 = html.indexOf('\nconst WS=wsFactory();');
let src = html.slice(a0, z0);
const inviscid = src.replace('const FANNING=0.005;', 'const FANNING=0;');
const hooked = src.replace('const U=cy.m*CV*cy.T-cy.p*dV+', 'cy._pdV=cy.p*dV; cy._qw=qw; cy._Q=cy.burnQ*dxb;\n        const U=cy.m*CV*cy.T-cy.p*dV+')
  .replace('      st.th+=dth;\n', '      if(opts.hook) opts.hook({st,all,dt,cyls,ins,outs});\n      st.th+=dth;\n');
ok(inviscid !== src && hooked.indexOf('opts.hook') > 0, 'the model loads with friction off and with a step hook (the texts the checks rely on are there)');
const W = new Function(inviscid + '\nreturn wsFactory();')(), WH = new Function(hooked + '\nreturn wsFactory();')();
const G = W.GAM, R = W.RG, CP = W.CP, PATM = W.PATM, TATM = W.TATM;
let T = 0;
const pipe = (L, dx, A, T0) => W.makePipe({ L, dx, area: typeof A === 'function' ? A : () => A, T0, Tw: T0, x0: 1 });
const set = (P, f) => { for (let i = 0; i < P.n; i++) { const s = f((i + 0.5) * P.dx), A = P.A[i];
  P.q1[i] = s.r * A; P.q2[i] = s.r * s.u * A; P.q3[i] = (s.p / (G - 1) + 0.5 * s.r * s.u * s.u) * A; P.q4[i] = s.r * A; } };
function run(pipes, tEnd, joins, each) { T = 0;
  while (T < tEnd) { let s = 0; for (const P of pipes) { W.prim(P); s = Math.max(s, W.maxSpeed(P)); }
    const dt = Math.min(0.8 * pipes[0].dx / s, tEnd - T); if (joins) joins(); for (const P of pipes) W.stepPipe(P, dt); T += dt; if (each) each(); }
  for (const P of pipes) W.prim(P); }
const ramp = (p0, tr) => () => PATM + (p0 - PATM) * Math.min(1, T / tr);
const stag = (r, u, p) => { const t = p / (R * r), t0 = t + 0.5 * u * u / CP; return { T0: t0, p0: p * Math.pow(t0 / t, G / (G - 1)), s: CP * Math.log(t) - R * Math.log(p), M: Math.abs(u) / Math.sqrt(G * p / r) }; };
const isenM = (A, p0, T0, pe) => { const M = Math.sqrt(2 / (G - 1) * (Math.pow(pe / p0, -(G - 1) / G) - 1));
  return A * p0 / Math.sqrt(R * T0) * Math.sqrt(G) * M * Math.pow(1 + (G - 1) / 2 * M * M, -(G + 1) / (2 * (G - 1))); };

// Sod (gamma 1.35): star pressure 30,526 Pa, shock speed 548.59 m/s (exact Riemann solution)
{ const P = pipe(1, 1 / 400, 1e-3, TATM); set(P, x => x < 0.5 ? { r: 1, u: 0, p: 1e5 } : { r: 0.125, u: 0, p: 1e4 });
  P.left = W.wallEnd(-1); P.right = W.wallEnd(+1); run([P], 0.2 / Math.sqrt(1e5));
  const pm = P.p[Math.round(0.62 * 400)]; let xs = 0; for (let i = 300; i < 400; i++) if (P.r[i - 1] > 0.2 && P.r[i] <= 0.2) xs = i * P.dx;
  ok(Math.abs(pm / 30526 - 1) < 0.005, 'Sod: star pressure ' + pm.toFixed(0) + ' Pa against the exact 30,526 Pa');
  ok(Math.abs((xs - 0.5) / (0.2 / Math.sqrt(1e5)) / 548.59 - 1) < 0.01, 'Sod: shock speed ' + ((xs - 0.5) / (0.2 / Math.sqrt(1e5))).toFixed(1) + ' m/s against 548.59'); }

// closed-closed 1 m pipe at 298 K, 10 mm cells: first mode at c/2L
{ const c = Math.sqrt(G * R * TATM), r0 = PATM / (R * TATM), P = pipe(1, 0.01, 1e-3, TATM);
  set(P, x => { const p = PATM * (1 + 1e-3 * Math.cos(Math.PI * x)); return { r: r0 * Math.pow(p / PATM, 1 / G), u: 0, p }; });
  P.left = W.wallEnd(-1); P.right = W.wallEnd(+1); let last = 0, zc = [];
  run([P], 10 / (c / 2), null, () => { const v = P.p[0] - PATM; if (last > 0 && v <= 0) zc.push(T); last = v; });
  const f = (zc.length - 1) / (zc[zc.length - 1] - zc[0]);
  ok(Math.abs(f / (c / 2) - 1) < 0.002, 'closed-closed pipe: first mode ' + f.toFixed(2) + ' Hz against c/2L = ' + (c / 2).toFixed(2) + ' Hz'); }

// closed ends: a closed-closed pipe's fourth mode over 40 periods, ends as dead-end walls and as shut valves (fedEnd with
// no flow): in an inviscid gas it may only decay, and the entropy may only rise (before 2026-11-11 it grew 8.3 %)
for (const kind of ['wall', 'shut valve']) {
  const c = Math.sqrt(G * R * TATM), r0 = PATM / (R * TATM), k = 4 * Math.PI, P = pipe(1, 0.01, 1e-3, TATM), shut = () => ({ m: 0, h: 0, x: 1, uj: 0 });
  set(P, x => { const p = PATM * (1 + 1e-3 * Math.cos(k * x)); return { r: r0 * Math.pow(p / PATM, 1 / G), u: 0, p }; });
  if (kind === 'wall') { P.left = W.wallEnd(-1); P.right = W.wallEnd(1); } else { P.left = W.fedEnd(-1, shut); P.right = W.fedEnd(1, shut); }
  const amp = () => { let a = 0; for (let i = 0; i < P.n; i++) a += (P.p[i] - PATM) * Math.cos(k * (i + 0.5) * 0.01) * 0.01; return a * 2; };
  const ent = () => { let e = 0; for (let i = 0; i < P.n; i++) e += P.q1[i] * 0.01 * Math.log(P.p[i] / Math.pow(P.r[i], G)); return e; };
  W.prim(P); const a0 = amp(), s0 = ent(), per = 2 / (4 * c); let last = 0;
  run([P], 40 * per, null, () => { if (T > 39 * per) last = Math.max(last, Math.abs(amp())); });
  ok(last / a0 <= 1 && ent() >= s0, 'closed ends (' + kind + '): fourth mode after 40 periods ' + (last / a0).toFixed(4) + ' of its start, entropy change ' + (ent() - s0).toExponential(2) + ' (may not grow / fall)');
}

// steady flow fed into a pipe through a valve end: the end face carries the stream's own pressure (a version of the
// 2026-11-11 fix that set the face speed of incoming gas to 0 put it rho c u, 6.7 kPa, too low and halved the flow)
{ const A = Math.PI * 0.04 ** 2 / 4, P = pipe(1, 0.01, A, 300), src = { m: 0.05, h: W.CP * 300, x: 1, uj: 0 };
  P.left = W.fedEnd(-1, () => { src.uj = P.u[0]; return src; }); P.right = W.openEnd(1, PATM, 300, 1); run([P], 0.5);
  const pf = (P.f2[0] - P.f1[0] * src.uj) / P.Af[0], rcu = P.r[0] * Math.sqrt(G * P.p[0] / P.r[0]) * P.u[0];
  ok(Math.abs(pf - P.p[0]) < 0.05 * rcu, 'steady inflow through a valve end: face pressure - cell pressure ' + (pf - P.p[0]).toExponential(2) + ' Pa (rho c u ' + rcu.toFixed(0) + ' Pa)'); }

// open end: a 100 Pa pulse of either sign comes back inverted at full size (no gain on a dip), the node at the end
for (const amp of [1e-3, -1e-3]) {
  const c = Math.sqrt(G * R * TATM), r0 = PATM / (R * TATM), dx = 0.01, P = pipe(6, dx, Math.PI * 0.05 ** 2 / 4, TATM);
  set(P, x => { const p = PATM * (1 + amp * Math.exp(-0.5 * ((x - 3) / 0.04) ** 2)), r = r0 * Math.pow(p / PATM, 1 / G);
    return { r, u: 2 / (G - 1) * (Math.sqrt(G * p / r) - c), p }; });
  P.left = W.wallEnd(-1); P.right = W.openEnd(+1, PATM, TATM, 1);
  const ip = 449, xp = (ip + 0.5) * dx, ts = [], ps = [];
  run([P], 5.4 / c, null, () => { ts.push(T); ps.push(P.p[ip] - PATM); });
  const split = ((xp - 3) / c + (xp - 3) / c + 2 * (6 - xp) / c) / 2, f = 250, k = 2 * Math.PI * f / c;
  const dft = (lo, hi) => { let re = 0, im = 0; for (let i = 1; i < ts.length; i++) if (ts[i] >= lo && ts[i] < hi) { const d = ts[i] - ts[i - 1];
    re += ps[i] * Math.cos(2 * Math.PI * f * ts[i]) * d; im -= ps[i] * Math.sin(2 * Math.PI * f * ts[i]) * d; } return [re, im]; };
  const A = dft(0, split), B = dft(split, 1e9), mag = Math.hypot(B[0], B[1]) / Math.hypot(A[0], A[1]);
  let ph = Math.atan2(B[1], B[0]) - Math.atan2(A[1], A[0]) + 2 * k * (6 - xp); ph = ((ph % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  const delta = -(ph > 0 ? ph - Math.PI : ph + Math.PI) / (2 * k);
  ok(Math.abs(mag - 1) < 0.02 && Math.abs(ph) > 0.9 * Math.PI, 'open end, ' + (amp > 0 ? '+' : '-') + '100 Pa pulse: |R| at 250 Hz ' + mag.toFixed(4) +
    ', phase ' + (ph * 180 / Math.PI).toFixed(1) + ' deg (inverted: +-180; before 2026-11-11 a dip came back 7.7 times larger)');
  ok(Math.abs(delta) < 0.25 * dx, 'open end, ' + (amp > 0 ? '+' : '-') + '100 Pa pulse: reflects at ' + (1000 * delta).toFixed(2) + ' mm from the pipe end (no end correction in the model)');
}

// steady inflow through an open end, then a smooth cone to the atmosphere: steady, isentropic, adiabatic
{ const d = x => x < 0.2 ? 0.06 : x > 0.8 ? 0.04 : 0.06 - 0.02 * (x - 0.2) / 0.6, p0 = 1.15e5, T0 = 300;
  const P = pipe(1, 0.01, x => Math.PI * d(x) ** 2 / 4, T0); P.left = W.openEnd(-1, ramp(p0, 0.15), T0, 1); P.right = W.openEnd(+1, PATM, T0, 1);
  const f0 = []; run([P], 1.5, null, () => { f0.push(P.f1[0]); if (f0.length > 2) f0.shift(); });
  const m = P.f1[50], mI = isenM(Math.PI * 0.04 ** 2 / 4, p0, T0, PATM), te = stag(P.r[P.n - 1], P.u[P.n - 1], P.p[P.n - 1]).T0;
  ok(Math.abs(f0[1] - f0[0]) < 1e-4 * m, 'steady inflow: the inflow face carries ' + f0[0].toFixed(5) + ' then ' + f0[1].toFixed(5) + ' kg/s (before: 0.1196 and 0.3147 on alternate steps)');
  ok(Math.abs(m / mI - 1) < 0.01, 'steady inflow: mass flow ' + m.toFixed(4) + ' kg/s against the isentropic ' + mI.toFixed(4) + ' (before -3.1 %)');
  ok(Math.abs(te - T0) < 0.1, 'steady inflow: exit stagnation temperature ' + te.toFixed(2) + ' K against the reservoir 300 K (before 303.5 K)'); }

// sudden area change 4:1 through the two-pipe junction, from a reservoir at 1.08 bar to the atmosphere
for (const dir of ['contraction', 'expansion']) {
  const dA = dir === 'expansion' ? 0.04 : 0.08, dB = dir === 'expansion' ? 0.08 : 0.04, p0 = 1.08e5, T0 = 300;
  const a = pipe(1, 0.01, Math.PI * dA * dA / 4, T0), b = pipe(1, 0.01, Math.PI * dB * dB / 4, T0);
  a.left = W.openEnd(-1, ramp(p0, 0.15), T0, 1); a.right = () => {}; b.left = () => {}; b.right = W.openEnd(+1, PATM, T0, 1);
  run([a, b], 0.8, () => W.junction(a, b));
  const s1 = stag(a.r[a.n - 3], a.u[a.n - 3], a.p[a.n - 3]), s2 = stag(b.r[2], b.u[2], b.p[2]), m = a.f1[a.n];
  if (dir === 'contraction') {
    const mI = isenM(Math.PI * dB * dB / 4, p0, T0, PATM);
    ok(m <= mI * 1.002, 'sudden contraction: mass flow ' + m.toFixed(4) + ' kg/s, no more than the isentropic ' + mI.toFixed(4) + ' (before 0.5528, sonic)');
    ok(s2.s - s1.s > -1e-3, 'sudden contraction: entropy change ' + (s2.s - s1.s).toExponential(2) + ' J/kg/K, not negative (before -163)');
  } else {
    const r1 = a.r[a.n - 3], u1 = a.u[a.n - 3], p1 = a.p[a.n - 3], A1 = a.A[0], A2 = b.A[0], mf = r1 * u1 * A1, h0 = G / (G - 1) * p1 / r1 + 0.5 * u1 * u1;
    const res = v => { const p2 = p1 + (mf * u1 - mf * v) / A2; return G / (G - 1) * p2 * v * A2 / mf + 0.5 * v * v - h0; };
    let lo = 1e-3, hi = u1; for (let it = 0; it < 200; it++) { const mid = 0.5 * (lo + hi); if (res(lo) * res(mid) <= 0) hi = mid; else lo = mid; }
    const v2 = 0.5 * (lo + hi), p2 = p1 + (mf * u1 - mf * v2) / A2, bc = s1.p0 - stag(mf / (v2 * A2), v2, p2).p0, dp0 = s1.p0 - s2.p0;
    ok(Math.abs(dp0 / bc - 1) < 0.03, 'sudden expansion: stagnation-pressure loss ' + dp0.toFixed(0) + ' Pa against compressible Borda-Carnot ' + bc.toFixed(0) + ' Pa (before 1.56 times it)');
  }
}

// choked outflow from 3 bar: A p0 psi* / sqrt(R T0)
{ const p0 = 3e5, T0 = 300, A = Math.PI * 0.04 ** 2 / 4, P = pipe(1, 0.01, A, T0);
  P.left = W.openEnd(-1, ramp(p0, 0.05), T0, 1); P.right = W.openEnd(+1, PATM, T0, 1); run([P], 0.3);
  const psi = Math.sqrt(G) * Math.pow(2 / (G + 1), (G + 1) / (2 * (G - 1))), mT = A * p0 / Math.sqrt(R * T0) * psi;
  ok(Math.abs(P.f1[P.n] / mT - 1) < 0.01, 'choked outflow: ' + P.f1[P.n].toFixed(4) + ' kg/s against ' + mT.toFixed(4)); }

// one engine (single cylinder, plain 0.8 m pipe, 6000 rpm, 6 cycles): mass and energy balance of the last cycle
{ const e = { bore: 0.084, stroke: 0.089, rod: 0.1513, cr: 11.5, cd: 0.7, nIn: 2, dIn: 0.0336, liftIn: 0.008736, nEx: 2, dEx: 0.02856, liftEx: 0.0079968,
    cam: { ivo: 32, ivc: 44, evo: 48, evc: 20 }, burn: { start: 18, dur: 55 }, afr: 12.8, eta: 0.72 };
  const eng = WH.makeEngine(e, { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320 }, { segs: [{ L: 0.4, d0: 0.0445, d1: 0.0445 }, { L: 0.2, d0: 0.09, d1: 0.09 }, { L: 0.2, d0: 0.0445, d1: 0.0445 }], Tw: 700 }, { phases: [0] });
  const st = WH.freshState(eng, 0.01), FAN = 0.005;
  const stored = s => { let M = 0, E = 0; for (const P of [].concat(...s.ins, ...s.prims)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += P.q3[i] * P.dx; }
    for (const c of s.cyls) { M += c.m; E += c.m * WH.CV * c.T; } return { M, E }; };
  let prev = stored(st), th0 = null; const B = { mIn: 0, mOut: 0, eIn: 0, eOut: 0, src: 0, dM: 0, dE: 0, Q: 0 };
  const r = WH.runSpeed(eng, { rpm: 6000, cycles: 6, dx: 0.01, state: st, hook: c => {
    if (th0 === null) th0 = c.st.th; const last = c.st.th - th0 >= 5 * 720 - 1e-9, now = stored(c.st);
    if (last) { const dt = c.dt; for (const L of c.ins) { B.mIn += L[0].f1[0] * dt; B.eIn += L[0].f3[0] * dt; } for (const P of c.outs) { B.mOut += P.f1[P.n] * dt; B.eOut += P.f3[P.n] * dt; }
      for (const cy of c.cyls) { B.src += cy._Q - cy._qw - cy._pdV; B.Q += cy._Q; }
      for (const P of c.all) for (let i = 0; i < P.n; i++) B.src += dt * 2 * FAN * P.r[i] * Math.abs(P.u[i]) * P.A[i] / P.D[i] * CP * (P.Tw - P.p[i] / (R * P.r[i])) * P.dx;
      B.dM += now.M - prev.M; B.dE += now.E - prev.E; }
    prev = now; } });
  const mr = (B.dM - (B.mIn - B.mOut)) / B.mIn, er = (B.dE - (B.eIn - B.eOut + B.src)) / B.Q;
  ok(Number.isFinite(r.ve) && r.ve > 0.5 && r.ve < 1.5, 'engine with a stepped line runs: VE ' + r.ve.toFixed(4));
  ok(Math.abs(mr) < 1e-9, 'engine cycle mass balance: (stored change - (in - out)) / in = ' + mr.toExponential(2));
  ok(Math.abs(er) < 1e-9, 'engine cycle energy balance: residual / heat released = ' + er.toExponential(2)); }

console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
process.exit(fails.length ? 1 : 0);
