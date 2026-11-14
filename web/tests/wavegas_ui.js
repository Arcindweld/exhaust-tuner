// The wave model's gas properties (wsFactory "gas properties", 2026-11-12) against tabulated and independently computed
// answers. Runs in Node (no browser), about 30 s:
//  1. each species' cp and H - H(298.15 K) from the model's GRI-Mech 3.0 polynomials against the NIST-JANAF tables
//     (Chase 1998; janaf.nist.gov/tables N-023 N2, O-029 O2, Ar-001 Ar, C-095 CO2, H-064 H2O, C-093 CO, H-050 H2), the
//     values hand-listed below;
//  2. air and burned-gas mixtures: gamma, cp, R and the internal energy change against the same mixtures of JANAF's
//     values, mixed here; the stoichiometry (air-fuel ratio, atom balances, the water-gas ratio 3.5 of rich products);
//  3. the temperature solve (energy -> temperature) inverts the energy;
//  4. a closed, adiabatic cylinder (no valve flow, no burn, no wall heat) through a whole cycle against its isentrope,
//     found here independently from the entropy (integral of cv / T dT + R ln V = constant, Simpson and bisection), with
//     the constant gas against T V^(gamma - 1) = constant; the error is the cylinder's first-order time step (p dV with
//     the pressure at the step's start: about -0.4 % at the page's step, halving with the step, the same with either gas);
//  5. a supersonic exit below the outside pressure (2026-11-12 fix of openState): a uniform supersonic stream whose normal
//     shock could hold the outside pressure leaves unchanged (before the fix the end emptied its cell and ran away);
//  6. one engine cycle's mass and energy balance with the gas;
//  7. the constant-gamma mode (spec.e.gas 'const') gives the page's results before the change to the last digit
//     (fixtures/wave_const_ref.json, first three speeds of each design);
//  8. the heat release (2026-11-12, part 2): enthalpies of formation against NIST-JANAF, the fuel's from its lower heating
//     value, the heat per kg of mixture at AFR 14.6 and 12.8 worked by hand here (products found by bisection, not the
//     model's quadratic), and the total energy (sensible + chemical) of an engine cycle conserved to rounding;
//  9. friction: Heywood's tfmep by hand, and the brake torque's gross loop against p dV integrated here;
// 10. fuel vapour (the default since part 2; spec.e.fuel 'air' leaves it out): the vapour's cp against NASA's 9-coefficient fits evaluated here, the mixture's
//     R, and an engine cycle's mass and total energy with the port injector's fuel as the only source;
// 11. measured valve flow and the intake system (part 3): the flow-bench conversion against the source table listed here
//     (Hot Rod 2011's stock LS3 heads) and a hand formula, flowTab's interpolation, a steady flow bench built from the
//     model's pipe and valve recovering the source's cfm, the throttle orifice by hand and in steady flow, the filter's
//     loss in steady flow, and an engine cycle with plenum, throttle, filter and valve tables conserving mass and energy.
// 12. the head's exhaust port (part 7): the port law's Nusselt correlations, Sutherland's air properties and the port's h
//     worked here from the last cycle's measured outflow, the port cells found for a port at the primary's bore and at its
//     own bore, the energy balance of a cycle with the port's heat as a sink, and the legacy switch (e.portHeat 'off')
//     giving the run without a port to the last digit.
// 13. the head's intake port (part 8): the intake correlations' constants as tabulated by Rahman, Hamada and Kadirgama
//     (Int. J. Physical Sciences 6(16), 2011, Table 1), h by hand, the port cells at the valve end of a runner, the port's h
//     worked here from the last cycle's measured net inflow and its mass-averaged stagnation temperature, the energy
//     balance of a cycle with the port's heat as a source, and the legacy switch (e.portInHeat 'off').
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const a0 = html.indexOf('function wsFactory(){'), z0 = html.indexOf('\nconst WS=wsFactory();');
const src = html.slice(a0, z0);
const anchor = 'const U=(G?cy.m*gasE(G,cy.T,cy.x):cy.m*CV*cy.T)-cy.p*dV+';
const hooked = src.replace(anchor, 'cy._mE=mE; cy._pdV=cy.p*dV; cy._qw=qw; cy._Q=cy.burnQ*dxb; cy._mC=vInC[k].m*dt; cy._mP=vIn[k].m*dt; cy._eC=vInC[k].m*vInC[k].h*dt; cy._eP=vIn[k].m*vIn[k].h*dt; cy._xP=vIn[k].x;\n        ' + anchor)
  .replace('      st.th+=dth;\n', '      if(opts.hook) opts.hook({st,all,dt,dth,cyls,ins,outs,chambers});\n      st.th+=dth;\n');
ok(hooked.indexOf('cy._pdV') > 0 && hooked.indexOf('opts.hook') > 0, 'the model loads with a step hook (the texts the checks rely on are there)');
const W = new Function(hooked + '\nreturn wsFactory();')(), GS = W.gas, RU = GS.RU;
const W0 = new Function(src.replace('const FANNING=0.005;', 'const FANNING=0;') + '\nreturn wsFactory();')();   // inviscid copy for 5

// ---------- 1. species against NIST-JANAF: [T K, cp J/mol/K, H - H(298.15) kJ/mol], from the tables named above
const JANAF = {
  N2: [[300, 29.125, 0.054], [500, 29.580, 5.911], [1000, 32.697, 21.463], [1500, 34.843, 38.405], [2000, 35.971, 56.137], [2500, 36.616, 74.296]],
  O2: [[300, 29.385, 0.054], [500, 31.091, 6.084], [1000, 34.870, 22.703], [1500, 36.544, 40.599], [2000, 37.741, 59.175], [2500, 38.856, 78.328]],
  Ar: [[300, 20.786, 0.038], [500, 20.786, 4.196], [1000, 20.786, 14.589], [1500, 20.786, 24.982], [2000, 20.786, 35.375], [2500, 20.786, 45.768]],
  CO2: [[300, 37.221, 0.069], [500, 44.627, 8.305], [1000, 54.308, 33.397], [1500, 58.379, 61.705], [2000, 60.350, 91.439], [2500, 61.471, 121.917]],
  H2O: [[300, 33.596, 0.062], [500, 35.226, 6.925], [1000, 41.268, 26.000], [1500, 47.090, 48.151], [2000, 51.180, 72.790], [2500, 53.904, 99.108]],
  CO: [[300, 29.142, 0.054], [500, 29.794, 5.931], [1000, 33.183, 21.690], [1500, 35.217, 38.850], [2000, 36.250, 56.744], [2500, 36.836, 75.027]],
  H2: [[300, 28.849, 0.053], [500, 29.260, 5.882], [1000, 30.205, 20.680], [1500, 32.298, 36.290], [2000, 34.280, 52.951], [2500, 35.842, 70.498]] };
const ORDER = ['N2', 'O2', 'Ar', 'CO2', 'H2O', 'CO', 'H2'];          // the model's SPEC order
const one = k => { const n = [0, 0, 0, 0, 0, 0, 0]; n[k] = 1; return n; };
const gasOf = n => { const P = GS.gasPoly(n), z = new Array(11).fill(0); return { Rb: P.R, Rd: 0, blo: P.lo, bhi: P.hi, dlo: z, dhi: z }; };
// stated deviations of GRI-Mech 3.0 from JANAF (see the page's comment): H2O above 1000 K is Gurvich's newer data
const tolCp = (sp, T) => sp === 'H2O' && T > 1000 ? 0.02 : 0.005, tolH = (sp, T) => sp === 'H2O' && T > 1000 ? 0.01 : T === 300 ? 0.02 : 0.003;
let worst = '';
ORDER.forEach((sp, k) => { const G = gasOf(one(k)), M = GS.SPEC[k][0] / 1000;
  for (const [T, cp, H] of JANAF[sp]) { const a = GS.at(G, T, 0), ec = a.cp * M / cp - 1, eh = a.h * M / (1000 * H) - 1;
    ok(Math.abs(ec) <= tolCp(sp, T) && Math.abs(eh) <= tolH(sp, T), sp + ' at ' + T + ' K: cp ' + (a.cp * M).toFixed(3) + ' vs JANAF ' + cp.toFixed(3) + ' J/mol K (' + (100 * ec).toFixed(3) +
      ' %), H - H298 ' + (a.h * M / 1000).toFixed(3) + ' vs ' + H.toFixed(3) + ' kJ/mol (' + (100 * eh).toFixed(3) + ' %)'); } });

// ---------- 2. mixtures, stoichiometry
const y = 1.87, o = 1 + y / 4, afrSt = o * (3.7279 * 28.0134 + 31.9988 + 0.04459 * 39.948) / (12.0107 + y * 1.00794);
ok(Math.abs(GS.AFR_ST / afrSt - 1) < 1e-14 && Math.abs(afrSt - 14.5964) < 1e-4, 'stoichiometric air-fuel ratio of CH1.87 with O2 + 3.7279 N2 + 0.04459 Ar: ' + GS.AFR_ST.toFixed(4) + ' (by hand ' + afrSt.toFixed(4) + ')');
function balance(lam) { const n = GS.burnedMoles(lam), O = 2 * n[1] + 2 * n[3] + n[4] + n[5], C = n[3] + n[5], H = 2 * n[4] + 2 * n[6];
  return { n, C: C - 1, H: H - y, O: O - 2 * lam * o, N: n[0] - lam * o * 3.7279 }; }
for (const lam of [0.7, 0.877, 1, 1.2]) { const b = balance(lam), K = b.n[5] * b.n[4] / (b.n[3] * b.n[6]);
  ok(Math.abs(b.C) < 1e-12 && Math.abs(b.H) < 1e-12 && Math.abs(b.O) < 1e-12 && Math.abs(b.N) < 1e-12 && (lam >= 1 ? b.n[5] === 0 && b.n[6] === 0 : Math.abs(K - 3.5) < 1e-12),
    'products at lambda ' + lam + ': C, H, O, N balance; ' + (lam >= 1 ? 'no CO or H2' : 'CO H2O / (CO2 H2) = ' + K.toFixed(12)) + '; moles per C ' + b.n.map(v => v.toFixed(4)).join(' ')); }
// the same mixtures of JANAF's values
const janafMix = (n, T) => { let cp = 0, H = 0, m = 0, N = 0;
  ORDER.forEach((sp, k) => { if (!n[k]) return; const r = JANAF[sp].find(v => v[0] === T); cp += n[k] * r[1]; H += n[k] * r[2] * 1000; m += n[k] * GS.SPEC[k][0] / 1000; N += n[k]; });
  const R = RU * N / m; return { cp: cp / m, H: H / m, R, gamma: cp / m / (cp / m - R) }; };
const AIR = [3.7279, 1, 0.04459, 0, 0, 0, 0];
const ENG = { bore: 0.084, stroke: 0.089, rod: 0.1513, cr: 11.5, cd: 0.7, nIn: 2, dIn: 0.0336, liftIn: 0.008736, nEx: 2, dEx: 0.02856, liftEx: 0.0079968,
  cam: { ivo: 32, ivc: 44, evo: 48, evc: 20 }, burn: { start: 18, dur: 55 }, afr: 12.8, eta: 0.72 };
const G128 = GS.makeGas(12.8), lam128 = 12.8 / GS.AFR_ST;
// 6 and 8 check part 1's fresh charge of air alone (spec.e.fuel 'air'); 10 the default, with the fuel's vapour
const ENGA = Object.assign({}, ENG, { fuel: 'air' });
for (const [name, n, G, x] of [['air', AIR, G128, 1], ['burned gas, AFR 12.8 (lambda ' + lam128.toFixed(3) + ')', GS.burnedMoles(lam128), G128, 0], ['burned gas, stoichiometric', GS.burnedMoles(1), GS.makeGas(GS.AFR_ST), 0]]) {
  const j300 = janafMix(n, 300), m300 = GS.at(G, 300, x);
  for (const T of [300, 500, 1000, 1500, 2000, 2500]) { const j = janafMix(n, T), m = GS.at(G, T, x);
    const du = T === 300 ? 0 : (m.e - m300.e) / ((j.H - j.R * T) - (j300.H - j.R * 300)) - 1;     // u(T) - u(300 K), u = h - R T
    ok(Math.abs(m.gamma - j.gamma) < 0.0015 && Math.abs(m.cp / j.cp - 1) < 0.005 && Math.abs(m.R / j.R - 1) < 1e-12 && Math.abs(du) < 0.004,
      name + ' at ' + T + ' K: gamma ' + m.gamma.toFixed(4) + ' vs JANAF mixture ' + j.gamma.toFixed(4) + ', cp ' + m.cp.toFixed(1) + ' vs ' + j.cp.toFixed(1) +
      ' J/kg K, R ' + m.R.toFixed(3) + ', u - u(300 K) ' + ((m.e - m300.e) / 1000).toFixed(2) + ' kJ/kg (' + (100 * du).toFixed(3) + ' %)'); } }
{ const R1 = GS.at(GS.makeGas(GS.AFR_ST), 1000, 0).R;
  ok(Math.abs(R1 - 286.6292) < 1e-3, 'stoichiometric products R ' + R1.toFixed(4) + ' J/kg K, the R sosExh uses (286.6292)'); }

// ---------- 3. the temperature solve
{ let worstT = 0;
  for (const x of [0, 0.3, 1]) for (const T of [150, 250, 298.15, 640, 999.9, 1000.1, 1800, 3200, 3600]) {
    const e = GS.at(G128, T, x).e, h = GS.at(G128, T, x).h;
    worstT = Math.max(worstT, Math.abs(GS.T(G128, e, x, 900) / T - 1), Math.abs(GS.T(G128, h, x, 900, true) / T - 1)); }
  ok(worstT < 1e-12, 'temperature from energy or enthalpy, 150-3600 K, x 0 / 0.3 / 1, from a guess of 900 K: largest relative error ' + worstT.toExponential(2)); }

// ---------- 4. closed adiabatic cylinder against its isentrope
function closedCycle(gas, dx) {
  const e = Object.assign({}, ENG, { dIn: 0, dEx: 0, woschni: false, burn: { start: 18, dur: 0 } }, gas ? { gas } : {});   // no valve area, no burn, no wall heat
  const eng = W.makeEngine(e, { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320 }, { segs: [{ L: 0.4, d0: 0.0445, d1: 0.0445 }], Tw: 700 }, { phases: [0] });
  const st = W.freshState(eng, dx), cy = st.cyls[0], m0 = cy.m, x0 = cy.x, T0 = cy.T, V0 = eng.vol(eng.ivc), G = eng.gas;
  const pts = [];
  W.runSpeed(eng, { rpm: 3000, cycles: 1, dx, state: st, hook: c => { const q = c.cyls[0]; pts.push({ th: q.th + c.dth, T: q.T, m: q.m, x: q.x }); } });
  // the isentrope through (T0, V0): the integral of cv / T from T0 to T = -R ln(V / V0), Simpson's rule, bisection on T
  const cvT = T => { const a = G ? GS.at(G, T, x0) : null; return a ? (a.cp - a.R) / T : W.CV / T; }, R = G ? GS.at(G, 300, x0).R : W.RG;
  const S = (T) => { const n = 400, h = (T - T0) / n; let s = cvT(T0) + cvT(T); for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * cvT(T0 + i * h); return s * h / 3; };
  const Tis = V => { const target = -R * Math.log(V / V0); let lo = 100, hi = 3000; for (let i = 0; i < 80; i++) { const mid = 0.5 * (lo + hi); if (S(mid) > target) hi = mid; else lo = mid; } return 0.5 * (lo + hi); };
  let err = 0, at = 0, Tmax = 0, endErr = 0, mDrift = 0;
  pts.forEach((q, i) => { const V = eng.vol(q.th % 720), Tr = Tis(V), d = q.T / Tr - 1; if (Math.abs(d) > Math.abs(err)) { err = d; at = q.th % 720; }
    if (q.T > Tmax) Tmax = q.T; mDrift = Math.max(mDrift, Math.abs(q.m / m0 - 1), Math.abs(q.x - x0)); if (i === pts.length - 1) endErr = q.T / T0 - 1; });
  const gExact = G ? null : (() => { let e2 = 0; pts.forEach(q => { const V = eng.vol(q.th % 720), Tr = T0 * Math.pow(V0 / V, W.GAM - 1); e2 = Math.max(e2, Math.abs(q.T / Tr - 1)); }); return e2; })();
  return { err, at, Tmax, endErr, mDrift, gExact, n: pts.length, T0 };
}
for (const gas of [undefined, 'const']) {
  const r1 = closedCycle(gas, 0.01), r2 = closedCycle(gas, 0.005), name = gas ? 'constant gamma 1.35' : 'the engine\'s gas (x 0.95, AFR 12.8)';
  ok(r1.mDrift < 1e-14, name + ': the closed cylinder keeps its mass and composition (drift ' + r1.mDrift.toExponential(1) + ')');
  ok(Math.abs(r1.err) < 5e-3 && Math.abs(r2.err) < 2.5e-3 && Math.abs(r1.err / r2.err - 2) < 0.2,
    name + ': temperature against the isentrope over one cycle (peak ' + r1.Tmax.toFixed(1) + ' K from ' + r1.T0.toFixed(1) + ' K): largest error ' + (100 * r1.err).toFixed(3) + ' % at ' +
    r1.at.toFixed(0) + ' deg with ' + r1.n + ' steps, ' + (100 * r2.err).toFixed(3) + ' % with ' + r2.n + ' (first order: ratio ' + (r1.err / r2.err).toFixed(2) + '); back at the start ' + (100 * r1.endErr).toFixed(4) + ' %');
  if (r1.gExact != null) ok(Math.abs(r1.gExact - Math.abs(r1.err)) < 1e-5, 'constant gamma: the entropy reference agrees with T V^(gamma-1) = constant (' + (100 * r1.gExact).toFixed(4) + ' %)');
}

// ---------- 5. supersonic exit below the outside pressure
function superExit(G, p, tEnd) {
  p = p || 50000; tEnd = tEnd || 0.01;
  const A = Math.PI * 0.04 ** 2 / 4, T = 600, x = 0, R = G ? GS.at(G, T, x).R : W.RG, g = G ? GS.at(G, T, x).gamma : W.GAM;
  const r = p / (R * T), c = Math.sqrt(g * p / r), u = 1.6 * c, E = G ? r * GS.at(G, T, x).e + 0.5 * r * u * u : p / (g - 1) + 0.5 * r * u * u;
  const P = W0.makePipe({ L: 0.5, dx: 0.01, area: () => A, T0: T, Tw: T, x0: x, gas: G || undefined });
  for (let i = 0; i < P.n; i++) { P.q1[i] = r * A; P.q2[i] = r * u * A; P.q3[i] = E * A; P.q4[i] = r * x * A; }
  P.left = Q => { Q.f1[0] = r * u * A; Q.f2[0] = (r * u * u + p) * A; Q.f3[0] = u * (E + p) * A; Q.f4[0] = r * u * x * A; };   // the stream enters supersonic: all its state given
  P.right = W0.openEnd(+1, W0.PATM, 298.15, 1);
  let t = 0, bad = false;
  while (t < tEnd) { W0.prim(P); const s = W0.maxSpeed(P); if (!(s < 1e5)) { bad = true; break; } const dt = 0.8 * P.dx / s; W0.stepPipe(P, dt); t += dt; }
  W0.prim(P);
  let dp = 0, pmin = Infinity, pmax = 0; for (let i = 0; i < P.n; i++) { dp = Math.max(dp, Math.abs(P.p[i] / p - 1)); pmin = Math.min(pmin, P.p[i]); pmax = Math.max(pmax, P.p[i]); }
  const shock = p * (1 + 2 * g / (g + 1) * (1.6 * 1.6 - 1));
  return { bad, dp, out: P.f1[P.n] / (r * u * A) - 1, shock, pmin, pmax, pEnd: P.p[P.n - 1], uEnd: P.u[P.n - 1] };
}
for (const [name, G] of [['constant gamma', null], ['the engine\'s gas', G128]]) {
  const s = superExit(G);
  ok(!s.bad && s.dp < 1e-9 && Math.abs(s.out) < 1e-9, name + ': a Mach 1.6 stream at 50 kPa (a normal shock would hold ' + (s.shock / 1000).toFixed(0) + ' kPa) leaves into 101.3 kPa unchanged: pressure spread ' +
    s.dp.toExponential(1) + ', outflow / inflow - 1 = ' + s.out.toExponential(1) + (s.bad ? ' (ran away)' : '')); }

// D5 (part 2): a supersonic exit that not even a normal shock at the exit brings to the outside pressure. Found on the
// page's captured job "single with a chamber" (a 127 mm megaphone cone open at its end) at 7850 rpm once the heat release
// was the chemistry's: the end took the sonic state on the supersonic cell's characteristic, passed more mass than the
// cell held, emptied it (1 Pa, -4e8 m/s) and the time step collapsed to 1e-11 s (the run never ended). Run here as the
// page sweeps it, with a guard on the time step; on the page before the fix the guard trips at 7850 rpm.
{ const job = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wave_jobs.json'), 'utf8'))[0].job, v = job.variants[0];
  const eng = W.makeEngine(v.spec.e, v.spec.intake, v.spec.exhaust, v.spec.opt);
  let state = null, err = '', last = null, dtMin = Infinity;
  const hook = c => { if (c.dt < dtMin) dtMin = c.dt; if (!(c.dt > 1e-9)) throw new Error('time step ' + c.dt.toExponential(2) + ' s'); };
  for (const [i, rpm] of job.rpms.slice(0, 8).entries()) {
    try { let r = W.runSpeed(eng, { rpm, cycles: i === 0 ? 8 : 3, dx: job.dx, state, hook });
      for (let k = 0; k < 5; k++) { const h = r.history, n = h.length; if (n >= 2 && Math.abs(h[n - 1].ve - h[n - 2].ve) < 0.004 * h[n - 1].ve) break; r = W.runSpeed(eng, { rpm, cycles: 2, dx: job.dx, state: r.state, hook }); }
      state = r.state; last = r; } catch (e) { err = rpm + ' rpm: ' + e.message; break; } }
  ok(!err && last && Number.isFinite(last.ve), 'D5: "single with a chamber" swept to ' + job.rpms[7] + ' rpm with the engine\'s gas: ' + (err || 'smallest time step ' + dtMin.toExponential(2) + ' s, VE ' + last.ve.toFixed(4) + ' at the last speed')); }

// ---------- 5b. steady inflow through an open end with the gas: the stream's stagnation temperature is the outside air's
{ const T0 = 300, p0 = 1.15e5, A = x => Math.PI * (0.06 - 0.02 * x / 1.0) ** 2 / 4, G = G128;
  const P = W0.makePipe({ L: 1, dx: 0.01, area: A, T0, Tw: T0, x0: 1, gas: G });
  let t = 0; const pin = () => W0.PATM + (p0 - W0.PATM) * Math.min(1, t / 0.05);
  P.left = W0.openEnd(-1, pin, T0, 1); P.right = W0.openEnd(+1, W0.PATM, T0, 1);
  while (t < 0.6) { W0.prim(P); const dt = 0.8 * P.dx / W0.maxSpeed(P); W0.stepPipe(P, dt); t += dt; }
  W0.prim(P);
  // the stagnation temperature carried by each face's energy flux (f3 / f1 = h + u^2/2), and the cells' own
  let dF = 0, dC = 0;
  for (let j = 0; j <= P.n; j++) dF = Math.max(dF, Math.abs(GS.T(G, P.f3[j] / P.f1[j], 1, 300, true) - T0));
  for (let i = 0; i < P.n; i++) dC = Math.max(dC, Math.abs(GS.T(G, GS.at(G, P.T[i], P.x[i]).h + 0.5 * P.u[i] * P.u[i], P.x[i], 300, true) - T0));
  const m0 = P.f1[0], mN = P.f1[P.n];
  ok(dF < 1e-3 && dC < 0.5 && Math.abs(mN / m0 - 1) < 2e-3 && m0 > 0.1, 'the gas, steady inflow from 1.15 bar, 300 K through a 60 -> 40 mm cone: stagnation temperature of every face flux within ' +
    dF.toExponential(2) + ' K of the outside air, of the cells within ' + dC.toFixed(3) + ' K; mass flow ' + m0.toFixed(4) + ' kg/s in, ' + mN.toFixed(4) + ' out'); }

// ---------- 6. one engine cycle's mass and energy balance with the gas (the engine of wavekat_ui.js)
{ const eng = W.makeEngine(ENGA, { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320 }, { segs: [{ L: 0.4, d0: 0.0445, d1: 0.0445 }, { L: 0.2, d0: 0.09, d1: 0.09 }, { L: 0.2, d0: 0.0445, d1: 0.0445 }], Tw: 700 }, { phases: [0] });
  const G = eng.gas, st = W.freshState(eng, 0.01), FAN = 0.005;
  const stored = s => { let M = 0, E = 0; for (const P of [].concat(...s.ins, ...s.prims)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += P.q3[i] * P.dx; }
    for (const c of s.cyls) { M += c.m; E += c.m * GS.at(G, c.T, c.x).e; } return { M, E }; };
  let prev = stored(st), th0 = null; const B = { mIn: 0, mOut: 0, eIn: 0, eOut: 0, src: 0, dM: 0, dE: 0, Q: 0 };
  const r = W.runSpeed(eng, { rpm: 6000, cycles: 6, dx: 0.01, state: st, hook: c => {
    if (th0 === null) th0 = c.st.th; const last = c.st.th - th0 >= 5 * 720 - 1e-9, now = stored(c.st);
    if (last) { const dt = c.dt; for (const L of c.ins) { B.mIn += L[0].f1[0] * dt; B.eIn += L[0].f3[0] * dt; } for (const P of c.outs) { B.mOut += P.f1[P.n] * dt; B.eOut += P.f3[P.n] * dt; }
      for (const cy of c.cyls) { B.src += cy._Q - cy._qw - cy._pdV; B.Q += cy._Q; }
      for (const P of c.all) for (let i = 0; i < P.n; i++) B.src += dt * 2 * FAN * P.r[i] * Math.abs(P.u[i]) * P.A[i] / P.D[i] * P.cp[i] * (P.Tw - P.p[i] / (P.Rm[i] * P.r[i])) * P.dx;
      B.dM += now.M - prev.M; B.dE += now.E - prev.E; }
    prev = now; } });
  const mr = (B.dM - (B.mIn - B.mOut)) / B.mIn, er = (B.dE - (B.eIn - B.eOut + B.src)) / B.Q;
  ok(Number.isFinite(r.ve) && r.ve > 0.5 && r.ve < 1.5, 'engine with the gas runs: VE ' + r.ve.toFixed(4) + ', IMEP ' + (r.imep / 1e5).toFixed(3) + ' bar, exhaust ' + r.tEx.toFixed(0) + ' K');
  ok(Math.abs(mr) < 1e-9, 'engine cycle mass balance with the gas: ' + mr.toExponential(2));
  ok(Math.abs(er) < 1e-9, 'engine cycle energy balance with the gas: residual / heat released = ' + er.toExponential(2)); }

// ---------- 7. the constant-gamma mode is the page before the change
{ const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wave_const_ref.json'), 'utf8'));
  const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wave_jobs.json'), 'utf8'));
  const spec = {}; for (const { name, job } of jobs) for (const v of job.variants) spec[name + '|' + v.label] = { s: v.spec, dx: job.dx };
  const KEYS = ['ve', 'imep', 'pmax', 'resid', 'pEvo', 'tEx', 'overlapPort'];
  for (const r of ref.filter(q => spec[q.name + '|' + q.label])) {
    const j = spec[r.name + '|' + r.label], rpms = r.rpms.slice(0, 3);
    const eng = W.makeEngine(Object.assign({}, j.s.e, { gas: 'const' }), j.s.intake, j.s.exhaust, j.s.opt);
    const res = W.sweep(eng, rpms, { dx: j.dx, cycles: 3, firstCycles: 8, maxExtra: 5 });
    let bad = ''; res.forEach((x, i) => { for (const k of KEYS) if (!bad && !Object.is(x[k], r.res[i][k])) bad = rpms[i] + ' rpm ' + k + ' ' + x[k] + ' vs ' + r.res[i][k]; });
    ok(!bad, 'constant gamma: ' + r.name + ', ' + r.label + ': ' + rpms.length + ' speeds as before the change, to the last digit' + (bad ? ' (' + bad + ')' : '')); } }

// ---------- 8. heat release from enthalpies of formation
{ // NIST-JANAF dfH(298.15 K), kJ/mol (janaf.nist.gov/tables C-095 CO2, H-064 H2O gas, C-093 CO; N2, O2, Ar, H2: 0 by definition)
  const JF = { CO2: -393.522, H2O: -241.826, CO: -110.527, N2: 0, O2: 0, Ar: 0, H2: 0 };
  ORDER.forEach((sp, k) => ok(Math.abs(GS.HFORM[k] / 1000 - JF[sp]) < 0.02, sp + ': H(298.15 K) of the GRI-Mech 3.0 polynomial (with a6) ' + (GS.HFORM[k] / 1000).toFixed(4) +
    ' kJ/mol against JANAF\'s enthalpy of formation ' + JF[sp] + ' (within 0.02)'));
  // the fuel CH1.87: LHV 44.0 MJ/kg (Heywood; MIT 2.61 lecture 4 "Gasoline CnH1.87n 44 MJ/kg"), M = 12.0107 + 1.87 x 1.00794
  const Mf = 12.0107 + 1.87 * 1.00794, LHV = 44.0e6, hfF = JF.CO2 + 0.935 * JF.H2O + LHV * Mf / 1e6;   // kJ/mol
  ok(Math.abs(Mf - 13.8955) < 1e-4 && Math.abs(hfF - (-8.2253)) < 1e-3 && Math.abs(GS.HF_FUEL / 1000 - hfF) < 0.03,
    'fuel CH1.87: M ' + Mf.toFixed(4) + ' g/mol, dfH = dfH(CO2) + 0.935 dfH(H2O) + 44.0 MJ/kg x M = ' + hfF.toFixed(4) + ' kJ/mol by hand (JANAF), model ' + (GS.HF_FUEL / 1000).toFixed(4));
  const mAirOf = lam => lam * o * (3.7279 * 28.0134 + 31.9988 + 0.04459 * 39.948) / 1000;   // kg of air per mol of fuel
  const byHand = afr => {   // products by element balance and K = n_CO n_H2O / (n_CO2 n_H2) = 3.5, the CO2 moles by bisection
    const lam = afr / GS.AFR_ST; let n;
    if (lam >= 1) n = { CO2: 1, H2O: 0.935, O2: (lam - 1) * o };
    else { const S = 2 * lam * o - 1; let lo = 0, hi = 1;   // O: 2 a + (S - a) + (1 - a) ... a = n_CO2, n_H2O = S - a, n_CO = 1 - a, n_H2 = 0.935 - S + a
      for (let it = 0; it < 200; it++) { const a = 0.5 * (lo + hi), f = (1 - a) * (S - a) - 3.5 * a * (0.935 - S + a); if (f > 0) lo = a; else hi = a; }
      const a = 0.5 * (lo + hi); n = { CO2: a, H2O: S - a, CO: 1 - a, H2: 0.935 - S + a }; }
    let hp = 0; for (const k in n) hp += n[k] * JF[k];
    const Q = hfF - hp, mA = mAirOf(lam), mix = mA + Mf / 1000;   // kJ per mol of fuel (N2, Ar, O2: zero on both sides)
    return { lam, n, Q, perMix: Q * 1e3 / mix, perFuel: Q * 1e3 / (Mf / 1000), perAir: Q * 1e3 / mA }; };
  for (const [afr, want] of [[14.6, 2.82051], [12.8, 2.67465]]) {
    const h = byHand(afr), m = GS.heatRelease(afr / GS.AFR_ST);
    ok(Math.abs(h.perMix / 1e6 - want) < 2e-4 && Math.abs(m.perMix / h.perMix - 1) < 1e-4 && Math.abs(m.perAir / h.perAir - 1) < 1e-4,
      'AFR ' + afr + ' (lambda ' + h.lam.toFixed(4) + '): products ' + Object.keys(h.n).map(k => k + ' ' + h.n[k].toFixed(4)).join(', ') + ' per mol of fuel; heat ' + h.Q.toFixed(2) +
      ' kJ/mol = ' + (h.perFuel / 1e6).toFixed(3) + ' MJ/kg of fuel (' + (100 * h.perFuel / LHV).toFixed(1) + ' % of the LHV) = ' + (h.perMix / 1e6).toFixed(4) +
      ' MJ/kg of mixture by hand; model ' + (m.perMix / 1e6).toFixed(4) + ' MJ/kg of mixture, ' + (m.perAir / 1e6).toFixed(4) + ' MJ per kg of air (the fresh charge\'s qx)');
  }
  ok(Math.abs(G128.qx - GS.heatRelease(lam128).perAir) === 0 && GS.ETA_C === 0.975, 'the engine\'s gas carries qx = the heat per kg of fresh charge (air); residual combustion efficiency ' + GS.ETA_C);
  // total energy over a cycle: sensible m e(T, x) + chemical m x qx in pipes, cylinders and side volumes; in and out at the
  // ends with h + x qx; sinks: wall heat, work, pipe wall heat, and the (1 - ETA_C) of the chemical energy that burns
  // without being released (unburned fuel, counted as leaving the model)
  const eng = W.makeEngine(ENGA, { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320 }, { segs: [{ L: 0.4, d0: 0.0445, d1: 0.0445 }, { L: 0.2, d0: 0.09, d1: 0.09 }, { L: 0.2, d0: 0.0445, d1: 0.0445 }], Tw: 700 }, { phases: [0] });
  const G = eng.gas, qx = G.qx, st = W.freshState(eng, 0.01), FAN = 0.005;
  const stored = s => { let E = 0; for (const P of [].concat(...s.ins, ...s.prims)) for (let i = 0; i < P.n; i++) E += (P.q3[i] + P.q4[i] * qx) * P.dx;
    for (const c of s.cyls) E += c.m * (GS.at(G, c.T, c.x).e + c.x * qx); return E; };
  let prev = stored(st), th0 = null; const B = { flow: 0, sink: 0, dE: 0, Q: 0, lost: 0, g: 0 };
  const r = W.runSpeed(eng, { rpm: 6000, cycles: 6, dx: 0.01, state: st, hook: c => {
    if (th0 === null) th0 = c.st.th; const last = c.st.th - th0 >= 5 * 720 - 1e-9, now = stored(c.st);
    // the gross loop of each finished cycle, IVC to IVC (cy.done is replaced at the step that starts the next one)
    for (const cy of c.cyls) { if (cy.done !== B.done) { B.done = cy.done; B.g = B.acc || 0; B.acc = 0; } if (cy.th >= 540 || cy.th < 180) B.acc = (B.acc || 0) + cy._pdV; }
    if (last) { const dt = c.dt; for (const L of c.ins) B.flow += (L[0].f3[0] + L[0].f4[0] * qx) * dt; for (const P of c.outs) B.flow -= (P.f3[P.n] + P.f4[P.n] * qx) * dt;
      for (const cy of c.cyls) { B.sink += cy._qw + cy._pdV + cy._Q * (1 - GS.ETA_C) / GS.ETA_C; B.Q += cy._Q; B.lost += cy._Q * (1 - GS.ETA_C) / GS.ETA_C; }
      for (const P of c.all) for (let i = 0; i < P.n; i++) B.sink -= dt * 2 * FAN * P.r[i] * Math.abs(P.u[i]) * P.A[i] / P.D[i] * P.cp[i] * (P.Tw - P.p[i] / (P.Rm[i] * P.r[i])) * P.dx;
      B.dE += now - prev; }
    prev = now; } });
  const er = (B.dE - (B.flow - B.sink)) / B.Q;
  ok(Math.abs(er) < 1e-9 && B.Q > 0, 'total energy (sensible + chemical, qx ' + (qx / 1e6).toFixed(4) + ' MJ/kg of fresh charge) over the last of 6 cycles at 6000 rpm: residual / heat released = ' +
    er.toExponential(2) + ' (released ' + B.Q.toFixed(1) + ' J, not released by the residual combustion efficiency ' + B.lost.toFixed(1) + ' J)');
  // ---------- 9. friction and the gross loop
  const tf = [[3000, 1.87], [4600, 2.7180], [6000, 3.67], [7500, 4.9075]];
  tf.forEach(([n, bar]) => ok(Math.abs(W.tfmep(n) / 1e5 - bar) < 1e-12, 'Heywood tfmep at ' + n + ' rpm: 0.97 + 0.15 (' + n / 1000 + ') + 0.05 (' + n / 1000 + ')^2 = ' + bar + ' bar by hand, model ' + (W.tfmep(n) / 1e5).toFixed(4)));
  ok(Math.abs(r.gimep * eng.Vd / B.g - 1) < 1e-12 && r.gimep > r.imep, 'gross IMEP (BDC to BDC through firing TDC) ' + (r.gimep / 1e5).toFixed(3) + ' bar = p dV over 540-180 deg integrated here; net ' +
    (r.imep / 1e5).toFixed(3) + ' bar, so the pumping loop costs ' + ((r.gimep - r.imep) / 1e5).toFixed(3) + ' bar; brake mep = gross - tfmep = ' + ((r.gimep - W.tfmep(6000)) / 1e5).toFixed(3) + ' bar');
}

// ---------- 10. fuel vapour
{ // NASA CEA thermo.inp (McBride, Zehe, Gordon 2002): cp/R = a1/T^2 + a2/T + a3 + a4 T + a5 T^2 + a6 T^3 + a7 T^4, 300-1000 K
  const ISO = [-1.688758565e+05, 3.126903227e+03, -2.123502828e+01, 1.489151508e-01, -1.151180135e-04, 4.473216170e-08, -5.554882070e-12];   // C8H18,isooctane
  const TOL = [-2.877962220e+05, 6.133941520e+03, -4.574706760e+01, 1.936895724e-01, -2.304305304e-04, 1.459301178e-07, -3.790796100e-11];   // C7H8
  const cp9 = (a, T) => a[0] / T / T + a[1] / T + a[2] + a[3] * T + a[4] * T * T + a[5] * T ** 3 + a[6] * T ** 4;
  const xi = (1.87 * 7 - 8) / (10 - 1.87), M = xi * 114.22852 + (1 - xi) * 92.13842;
  ok(Math.abs(xi - 0.62608) < 1e-5 && Math.abs((18 * xi + 8 * (1 - xi)) / (8 * xi + 7 * (1 - xi)) - 1.87) < 1e-12 && Math.abs(M - GS.SPEC[7][0]) < 1e-3,
    'gasoline vapour as isooctane ' + xi.toFixed(5) + ' + toluene by mole: H/C 1.87, M ' + M.toFixed(4) + ' g/mol (model ' + GS.SPEC[7][0] + ')');
  const one8 = [0, 0, 0, 0, 0, 0, 0, 1], V = GS.gasPoly(one8), Vg = { Rb: V.R, Rd: 0, blo: V.lo, bhi: V.hi, dlo: new Array(11).fill(0), dhi: new Array(11).fill(0) };
  let worst = 0; for (const T of [300, 400, 500, 600, 800, 1000]) { const ref = xi * cp9(ISO, T) + (1 - xi) * cp9(TOL, T), m = GS.at(Vg, T, 0).cp * M / 1000 / RU; worst = Math.max(worst, Math.abs(m / ref - 1)); }
  ok(worst < 2.5e-3, 'the vapour\'s cp against NASA\'s fits, 300-1000 K: largest deviation ' + (100 * worst).toFixed(3) + ' %');
  const GV12 = GS.makeGas(12.8, true), mix300 = GS.at(GV12, 300, 1), mix500 = GS.at(GV12, 500, 1);
  ok(Math.abs(GV12.Ra - 271.98) < 0.05 && Math.abs(GV12.fa - 12.8 / 13.8) < 1e-4 && Math.abs(GV12.qx / G128.qx - GV12.fa) < 1e-12,
    'air with its vapour at AFR 12.8: R ' + GV12.Ra.toFixed(2) + ' J/kg K, gamma ' + mix300.gamma.toFixed(4) + ' at 300 K, ' + mix500.gamma.toFixed(4) + ' at 500 K; air ' + GV12.fa.toFixed(5) + ' of its mass; heat per kg of mixture = per kg of air x that');
  const ENGV = ENG;   // the default: fuel vapour
  const eng = W.makeEngine(ENGV, { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320 }, { segs: [{ L: 0.4, d0: 0.0445, d1: 0.0445 }, { L: 0.2, d0: 0.09, d1: 0.09 }, { L: 0.2, d0: 0.0445, d1: 0.0445 }], Tw: 700 }, { phases: [0] });
  const G = eng.gas, GI = eng.gasIn, st = W.freshState(eng, 0.01), FAN = 0.005;
  ok(G.vap && !GI.vap && st.ins[0][0].G === GI && st.prims[0][0].G === G, 'fuel vapour: the intake pipes carry air, the cylinder and the exhaust air-fuel mixture');
  const stored = s => { let M = 0, E = 0;
    for (const P of [].concat(...s.ins)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * GI.qx) * P.dx; }
    for (const P of [].concat(...s.prims)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * G.qx) * P.dx; }
    for (const c of s.cyls) { M += c.m; E += c.m * (GS.at(G, c.T, c.x).e + c.x * G.qx); } return { M, E }; };
  let prev = stored(st), th0 = null; const B = { mIn: 0, mOut: 0, fuel: 0, flow: 0, sink: 0, dM: 0, dE: 0, Q: 0, inj: 0 };
  const r = W.runSpeed(eng, { rpm: 6000, cycles: 6, dx: 0.01, state: st, hook: c => {
    if (th0 === null) th0 = c.st.th; const last = c.st.th - th0 >= 5 * 720 - 1e-9, now = stored(c.st);
    if (last) { const dt = c.dt;
      for (const L of c.ins) { B.mIn += L[0].f1[0] * dt; B.flow += (L[0].f3[0] + L[0].f4[0] * GI.qx) * dt; }
      for (const P of c.outs) { B.mOut += P.f1[P.n] * dt; B.flow -= (P.f3[P.n] + P.f4[P.n] * G.qx) * dt; }
      for (const cy of c.cyls) { B.fuel += cy._mC - cy._mP; B.inj += cy._eC - cy._eP; B.sink += cy._qw + cy._pdV + cy._Q * (1 - GS.ETA_C) / GS.ETA_C; B.Q += cy._Q; }
      for (const P of c.all) for (let i = 0; i < P.n; i++) B.sink -= dt * 2 * FAN * P.r[i] * Math.abs(P.u[i]) * P.A[i] / P.D[i] * P.cp[i] * (P.Tw - P.p[i] / (P.Rm[i] * P.r[i])) * P.dx;
      B.dM += now.M - prev.M; B.dE += now.E - prev.E; }
    prev = now; } });
  const mr = (B.dM - (B.mIn - B.mOut + B.fuel)) / B.mIn, er = (B.dE - (B.flow + B.inj - B.sink)) / B.Q;
  ok(Math.abs(mr) < 1e-9 && Math.abs(er) < 1e-9 && Math.abs(B.fuel / (B.mIn * 1 / 12.8) - 1) < 0.05,
    'fuel vapour, one cycle at 6000 rpm: mass residual ' + mr.toExponential(2) + ' with the injector\'s ' + (B.fuel * 1e6).toFixed(2) + ' mg of fuel (' + (100 * B.fuel / B.mIn).toFixed(2) +
    ' % of the air drawn in; 1/AFR = 7.81 %), total energy residual / heat released ' + er.toExponential(2) + ' (the reverted fuel\'s sensible enthalpy ' + B.inj.toFixed(2) + ' J); VE ' + r.ve.toFixed(4) + ', IMEP ' + (r.imep / 1e5).toFixed(3) + ' bar');
}

// ---------- 11. measured valve flow, the intake plenum, the throttle and the air filter (2026-11-12, part 3)
{ const IN = 0.0254, P0 = 101325, DP28 = 28 * 249.089, TA = 298.15;
  // (a) the source table, listed here: Holdener, "LS3/L92 rectangle-port cylinder heads test", Hot Rod, February 2011,
  // stock LS3/L92 0821 castings (2.165 / 1.59 in valves), "FLOW DATA: CFM AT 28 INCHES"
  const SRC = { lift: [0.050, 0.100, 0.200, 0.300, 0.400, 0.500, 0.600, 0.650, 0.700], in: [34, 67, 147, 211, 259, 297, 312, 312, 314], ex: [24, 59, 116, 157, 188, 207, 216, 219, 223] };
  const lib = html.slice(html.indexOf('const CAM_LIB=['), html.indexOf('];', html.indexOf('const CAM_LIB=[')));
  const m3 = lib.match(/k:'ls3'[\s\S]*?flow:\{dp:28,lift:\[([^\]]*)\],in:\[([^\]]*)\],ex:\[([^\]]*)\]/), arr = s => s.split(',').map(Number);
  ok(m3 && JSON.stringify([arr(m3[1]), arr(m3[2]), arr(m3[3])]) === JSON.stringify([SRC.lift, SRC.in, SRC.ex]), 'the page\'s LS3 flow curve (CAM_LIB) is the source table, every point');
  // by hand: dry air, gamma 1.4, R 287.05, reference state 101.325 kPa and 288.7056 K (60 F); Q = cfm / 2118.88 m3/s;
  // m = Cd A p0 / sqrt(R T0) psi, Q = m / rho0, so Cd A = Q sqrt(R T0) / psi
  const psi = (pr, g) => Math.sqrt(2 * g / (g - 1) * (Math.pow(pr, 2 / g) - Math.pow(pr, (g + 1) / g)));
  const hand = (cfm, T0) => cfm / 2118.88 / (Math.sqrt(287.05 * T0) * psi((P0 - DP28) / P0, 1.4));
  let worst = 0; const cd = [];
  SRC.lift.forEach((l, i) => { for (const [k, d] of [['in', 2.165], ['ex', 1.590]]) { const a = W.benchCdA(SRC[k][i], 28), h = hand(SRC[k][i], 288.7056);
    worst = Math.max(worst, Math.abs(a / h - 1)); cd.push(k + ' ' + l.toFixed(3) + ' in: L/D ' + (l / d).toFixed(3) + ', Cd A ' + (a * 1e6).toFixed(0) + ' mm2, Cd on the curtain ' + (a / (Math.PI * d * IN * l * IN)).toFixed(3)); } });
  ok(worst < 5e-4, 'flow bench to effective area, 18 points: the model\'s benchCdA within ' + (100 * worst).toFixed(3) + ' % of the hand formula (gamma 1.4; the model\'s air has 1.4006 at 288.7 K): ' + cd.filter((s, i) => i % 4 === 0).join('; '));
  const a3 = W.benchCdA(211, 28) / (Math.PI * 2.165 * IN * 0.300 * IN), a5 = W.benchCdA(207, 28) / (Math.PI * 1.590 * IN * 0.500 * IN), a6 = W.benchCdA(312, 28) / (Math.PI / 4 * (2.165 * IN) ** 2);
  ok(Math.abs(a3 - 0.736) < 0.002 && Math.abs(a5 - 0.590) < 0.002 && Math.abs(a6 - 0.603) < 0.002, 'LS3 Cd on the curtain: intake at 0.300 in (L/D 0.139) ' + a3.toFixed(3) + ', exhaust at 0.500 in (L/D 0.314) ' + a5.toFixed(3) +
    '; intake at 0.600 in on the seat area ' + a6.toFixed(3) + ' (the legacy law: 0.7 x 0.85 = 0.595 of the seat at full lift)');
  // flowTab: the measured points exactly, linear between, from (0, 0) to the first, held beyond the last
  const t = { lift: SRC.lift.map(l => l * IN), cdA: SRC.in.map(q => W.benchCdA(q, 28)) };
  ok(t.lift.every((l, i) => W.flowTab(t, l) === t.cdA[i]) && Math.abs(W.flowTab(t, 0.25 * IN) - 0.5 * (t.cdA[2] + t.cdA[3])) < 1e-15 && W.flowTab(t, 0.025 * IN) === t.cdA[0] * 0.5 && W.flowTab(t, 1) === t.cdA[8],
    'flowTab: the table\'s points, the midpoint 0.25 in, half the first area at half its lift, the last area beyond the last lift');
  // (b) a steady flow bench made of the model's own parts: an inviscid 100 mm pipe open to still air at 298.15 K, the
  // valve at its far end with the effective area at 0.600 in, the cylinder side held at 28 in H2O below; the steady flow
  // read as a volume at the outside air must give the source's 312 cfm (benchCdA at that air state)
  const Gair = W0.gas.makeGas(14.6, false), steady = (cda, pd, L, D, left, right) => {
    const P = W0.makePipe({ L, dx: 0.01, area: () => Math.PI * D * D / 4, Tw: TA, T0: TA, x0: 1, gas: Gair });
    const sd = W0.gas.at(Gair, TA, 1), far = { p: pd, T: TA, x: 1, R: sd.R, cp: sd.cp, g: sd.gamma };
    let f = { m: 0, h: 0, x: 1, uj: 0 }; P.left = left(P); P.right = right ? right(P, far) : W0.fedEnd(+1, () => f);
    for (let s = 0, tt = 0; tt < 0.4; s++) { W0.prim(P); if (!right) f = W0.valveFlow(cda, far, P, P.n - 1); const dt = 0.8 * P.dx / W0.maxSpeed(P); W0.stepPipe(P, dt); tt += dt; }
    W0.prim(P); return { P, m: P.f1[P.n], m0: P.f1[0] }; };
  // a line of segments (W0.buildLine, its steps joined by the two-pipe junction) from still air into a plenum held at pd
  const line = (segs, pd) => { const L = W0.buildLine({ segs, Tw: TA }, 0.01, TA, 1, Gair), PLf = { p: pd, T: TA, x: 1 };
    L[0].left = W0.openEnd(-1, P0, TA, 1); L[L.length - 1].right = W0.plenEnd(+1, PLf); for (let q = 1; q < L.length; q++) { L[q - 1].right = () => {}; L[q].left = () => {}; }
    for (let tt = 0; tt < 0.5;) { let v = 0, dm = 1; for (const P of L) { W0.prim(P); v = Math.max(v, W0.maxSpeed(P)); dm = Math.min(dm, P.dx); }
      const dt = 0.8 * dm / v; for (let q = 1; q < L.length; q++) W0.junction(L[q - 1], L[q]); for (const P of L) W0.stepPipe(P, dt); tt += dt; }
    for (const P of L) W0.prim(P); return { L, m: L[L.length - 1].f1[L[L.length - 1].n], m0: L[0].f1[0] }; };
  { const ab = W0.benchCdA(312, 28, TA), s = steady(ab, P0 - DP28, 0.2, 0.1, () => W0.openEnd(-1, P0, TA, 1)), rho = P0 / (Gair.Ra * TA), q = s.m / rho * 2118.88;
    ok(Math.abs(q / 312 - 1) < 2e-3 && Math.abs(s.m / s.m0 - 1) < 1e-3, 'steady flow bench: the model\'s valve at the LS3\'s 0.600 in area (' + (ab * 1e6).toFixed(0) + ' mm2) and 28 in H2O passes ' +
      q.toFixed(1) + ' cfm (source 312; mass flow in ' + s.m0.toFixed(5) + ', out ' + s.m.toFixed(5) + ' kg/s)'); }
  // (c) the throttle by hand: the LS3's 90 mm bore at 0.828 (a stock GM 87 mm throttle body measured 916 cfm at 20 in H2O:
  // Cd A = 4.920e-3 m2 by the law above, 0.828 of its bore area) at the engine's air at 5900 rpm with VE 1
  { const cda = 0.828 * Math.PI * 0.09 * 0.09 / 4, mLS3 = 1.1839 * (Math.PI / 4 * (4.065 * IN) ** 2 * 3.622 * IN * 8) * 5900 / 120;
    const r87 = W.benchCdA(916, 20) / (Math.PI * 0.087 * 0.087 / 4);
    ok(Math.abs(cda - 5.2675e-3) < 1e-7 && Math.abs(r87 - 0.828) < 1e-3, 'throttle: Cd A = 0.828 x pi 0.09^2 / 4 = ' + (cda * 1e3).toFixed(4) + 'e-3 m2 by hand; the GM 87 mm body\'s 916 cfm at 20 in H2O gives ' + r87.toFixed(4) + ' of its bore area');
    // the pressure behind it for that flow, by hand (compressible, gamma 1.4: bisection on the orifice law from 101.325 kPa, 298.15 K)
    const rho0 = P0 / (287.05 * TA); let lo = 0.5, hi = 1; for (let i = 0; i < 200; i++) { const pr = 0.5 * (lo + hi), m = cda * Math.sqrt(P0 * rho0) * psi(pr, 1.4); if (m > mLS3) lo = pr; else hi = pr; }
    const pd = P0 * 0.5 * (lo + hi), inc = (mLS3 / cda) ** 2 / (2 * rho0);
    // the model's throttle (plenumOf): the inlet's last 50 mm at that Cd A, contracting without loss and dumping into the
    // plenum; an inviscid 101.6 mm, 300 mm tube from still air, the plenum held at the pressure found by hand
    const segs = W0.plenumOf({ plenum: { V_m3: 1, inlet: [{ L: 0.3, d0: 0.1016, d1: 0.1016 }], throttle: { d: 0.09, cd: 0.828 } } }).inlet, s = line(segs, pd);
    ok(segs.length === 2 && Math.abs(Math.PI / 4 * segs[1].d0 ** 2 - cda) < 1e-15 && Math.abs(s.m / mLS3 - 1) < 5e-3 && Math.abs(s.m / s.m0 - 1) < 1e-3, 'throttle, steady: ' + mLS3.toFixed(4) + ' kg/s (the LS3 at 5900 rpm, VE 1) needs ' + ((P0 - pd) / 1000).toFixed(3) + ' kPa across it by hand (incompressible ' + (inc / 1000).toFixed(3) +
      ' kPa); the model\'s tube and 50 mm throttle step at that plenum pressure pass ' + s.m.toFixed(4) + ' kg/s (in ' + s.m0.toFixed(4) + ')'); }
  // (d) the air filter: 2.5 kPa at 0.35 kg/s on a 101.6 mm, 600 mm inlet (plenumOf's Borda-Carnot step); the total-pressure
  // loss read in the tube after it, at two flows
  { const segs = W0.plenumOf({ plenum: { V_m3: 1, inlet: [{ L: 0.6, d0: 0.1016, d1: 0.1016 }], filter: { dp: 2500, m: 0.35 } } }).inlet, res = [];
    for (const pd of [P0 - 3300, P0 - 1500]) { const s = line(segs, pd), P = s.L[s.L.length - 1], i = 30, g = P.g[i], c = Math.sqrt(g * P.p[i] / P.r[i]), M = P.u[i] / c;
      const p0 = P.p[i] * Math.pow(1 + 0.5 * (g - 1) * M * M, g / (g - 1)); res.push({ m: s.m, loss: P0 - p0, want: 2500 * (s.m / 0.35) ** 2 }); }
    ok(segs.length === 2 && segs[0].d0 < 0.1016 && res.every(r => r.loss / r.want - 1 > 0 && r.loss / r.want - 1 < 0.12), 'air filter (sized incompressibly; the step\'s Mach 0.3-0.35 adds 4-10 %) (2.5 kPa at 0.35 kg/s: a 50 mm step to ' + (segs[0].d0 * 1000).toFixed(1) + ' mm before the 101.6 mm tube): steady total-pressure loss ' +
      res.map(r => (r.loss / 1000).toFixed(3) + ' kPa at ' + r.m.toFixed(3) + ' kg/s (dp (m / m_ref)^2 = ' + (r.want / 1000).toFixed(3) + ')').join(', ')); }
  // (e) an engine cycle with the plenum, its stepped inlet, throttle and filter and measured valve tables: mass and total
  // energy (pipes, cylinder, plenum) conserved to rounding
  { const tab = d => ({ lift: [0.002, 0.005, 0.008], cdA: [0.7, 0.7, 0.6].map((c, i) => c * Math.PI * d * [0.002, 0.005, 0.008][i]) });
    const e = Object.assign({}, ENG, { flowIn: tab(ENG.dIn), flowEx: tab(ENG.dEx) });
    const intake = { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320, plenum: { V_m3: 0.001, inlet: [{ L: 0.3, d0: 0.05, d1: 0.05 }, { L: 0.05, d0: 0.04, d1: 0.04 }], throttle: { d: 0.04, cd: 0.83 }, filter: { dp: 1000, m: 0.03 } } };
    const eng = W.makeEngine(e, intake, { segs: [{ L: 0.4, d0: 0.0445, d1: 0.0445 }, { L: 0.2, d0: 0.09, d1: 0.09 }, { L: 0.2, d0: 0.0445, d1: 0.0445 }], Tw: 700 }, { phases: [0] });
    const G = eng.gas, GI = eng.gasIn, st = W.freshState(eng, 0.01), FAN = 0.005;
    ok(st.plen && st.plen.inlet.length === 4 && eng.plenum.V === 0.001 && Math.abs(st.plen.inlet[3].D[0] - 0.04 * Math.sqrt(0.83)) < 1e-12, 'the plenum is built: inlet of ' + st.plen.inlet.length + ' pipes (filter step, tube, throttle bore, throttle\'s effective area)');
    const stored = s => { let M = 0, E = 0;
      for (const P of [].concat(...s.ins, s.plen.inlet)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * GI.qx) * P.dx; }
      for (const P of [].concat(...s.prims)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * G.qx) * P.dx; }
      for (const c of s.cyls) { M += c.m; E += c.m * (GS.at(G, c.T, c.x).e + c.x * G.qx); }
      const q = s.plen; M += q.m; E += q.m * (GS.at(GI, q.T, q.x).e + q.x * GI.qx); return { M, E }; };
    let prev = stored(st), th0 = null; const B = { mIn: 0, mOut: 0, fuel: 0, flow: 0, sink: 0, dM: 0, dE: 0, Q: 0, inj: 0, pMin: 1e9, pMax: 0 };
    const r = W.runSpeed(eng, { rpm: 6000, cycles: 6, dx: 0.01, state: st, hook: c => {
      if (th0 === null) th0 = c.st.th; const last = c.st.th - th0 >= 5 * 720 - 1e-9, now = stored(c.st);
      if (last) { const dt = c.dt, I0 = c.st.plen.inlet[0];
        B.mIn += I0.f1[0] * dt; B.flow += (I0.f3[0] + I0.f4[0] * GI.qx) * dt; B.pMin = Math.min(B.pMin, c.st.plen.p); B.pMax = Math.max(B.pMax, c.st.plen.p);
        for (const P of c.outs) { B.mOut += P.f1[P.n] * dt; B.flow -= (P.f3[P.n] + P.f4[P.n] * G.qx) * dt; }
        for (const cy of c.cyls) { B.fuel += cy._mC - cy._mP; B.inj += cy._eC - cy._eP; B.sink += cy._qw + cy._pdV + cy._Q * (1 - GS.ETA_C) / GS.ETA_C; B.Q += cy._Q; }
        for (const P of c.all) for (let i = 0; i < P.n; i++) B.sink -= dt * 2 * FAN * P.r[i] * Math.abs(P.u[i]) * P.A[i] / P.D[i] * P.cp[i] * (P.Tw - P.p[i] / (P.Rm[i] * P.r[i])) * P.dx;
        B.dM += now.M - prev.M; B.dE += now.E - prev.E; }
      prev = now; } });
    const mr = (B.dM - (B.mIn - B.mOut + B.fuel)) / B.mIn, er = (B.dE - (B.flow + B.inj - B.sink)) / B.Q;
    ok(Math.abs(mr) < 1e-9 && Math.abs(er) < 1e-9 && r.ve > 0.3, 'plenum, throttle, filter and measured valve flow, one cycle at 6000 rpm: mass residual ' + mr.toExponential(2) + ', total energy residual / heat released ' +
      er.toExponential(2) + '; plenum ' + (B.pMin / 1000).toFixed(1) + '-' + (B.pMax / 1000).toFixed(1) + ' kPa, VE ' + r.ve.toFixed(4)); }
}

// ---------- 12. the head's exhaust port (2026-11-13, part 7)
{ // (a) the correlations as published (T. J. Morgan, PhD thesis, University of Nottingham 2003, Table 2.1: Caton and
  // Heywood 0.35 Re^0.6, Malchow, Sorenson and Buckius 0.0483 Re^0.783, Meisner and Sorenson 0.0774 Re^0.769, Hires and
  // Pochmara 0.258 Re^0.8) and Sutherland's law for air (COMSOL CFD Module tables 5-2, 5-3: mu 1.716e-5 Pa s, S 111 K;
  // k 0.0241 W/m K, S 194 K; both at 273 K), written out here
  const P = W.port, LIST = { caton: [0.35, 0.6], malchow: [0.0483, 0.783], meisner: [0.0774, 0.769], hires: [0.258, 0.8] };
  ok(Object.keys(LIST).every(k => P.PORT_NU[k][0] === LIST[k][0] && P.PORT_NU[k][1] === LIST[k][1]) && Object.keys(P.PORT_NU).length === 4, 'exhaust port: the four correlations\' constants as published');
  const mu = T => 1.716e-5 * (T / 273) ** 1.5 * 384 / (T + 111), kk = T => 0.0241 * (T / 273) ** 1.5 * 467 / (T + 194);
  const Ts = [273, 300, 600, 1000, 1500, 2000];
  ok(P.muAir(273) === 1.716e-5 && P.kAir(273) === 0.0241 && Ts.every(T => Math.abs(P.muAir(T) / mu(T) - 1) < 1e-14 && Math.abs(P.kAir(T) / kk(T) - 1) < 1e-14),
    'exhaust port: Sutherland\'s air by hand at ' + Ts.join(', ') + ' K (mu ' + Ts.map(T => (P.muAir(T) * 1e5).toFixed(3)).join(', ') + 'e-5 Pa s; k ' + Ts.map(T => P.kAir(T).toFixed(4)).join(', ') + ' W/m K)');
  const L0 = P.portLaw({}), Re = 4 * 0.04 / (Math.PI * 0.04 * mu(1150)), hHand = 0.35 * Re ** 0.6 * kk(1150) / 0.04;
  ok(L0.name === 'caton' && L0.Tw === 450 && Math.abs(P.portH(L0, 0.04, 1150, 0.04) / hHand - 1) < 1e-12 && P.portLaw({ portHeat: 'off' }) === null && P.portLaw({ portHeat: false }) === null && P.portLaw({ portTw: 470 }).Tw === 470,
    'exhaust port: default Caton-Heywood at the head\'s 450 K, h by hand at 0.04 kg/s, 1150 K, 40 mm: Re ' + Re.toFixed(0) + ', Nu ' + (0.35 * Re ** 0.6).toFixed(1) + ', h ' + hHand.toFixed(1) + ' W/m2 K (model ' + P.portH(L0, 0.04, 1150, 0.04).toFixed(1) + '); off / false: none');
  let threw = ''; try { P.portLaw({ portHeat: 'x' }); } catch (e) { threw = e.message; }
  ok(/caton, malchow, meisner, hires/.test(threw), 'exhaust port: an unknown law is refused: ' + threw);
  // (b) the port cells: a 120 mm port at the primary's bore (one pipe), a 100 mm port of 40 mm (its own pipe)
  const exA = { segs: [{ L: 0.12, d0: 0.0445, d1: 0.0445, port: true }, { L: 0.5, d0: 0.0445, d1: 0.0445 }], Tw: 700 };
  const exB = { segs: [{ L: 0.1, d0: 0.04, d1: 0.04, port: true }, { L: 0.5, d0: 0.0445, d1: 0.0445 }], Tw: 700 }, IN1 = { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320 };
  const sA = W.freshState(W.makeEngine(ENG, IN1, exA, { phases: [0] }), 0.01), sB = W.freshState(W.makeEngine(ENG, IN1, exB, { phases: [0] }), 0.01);
  const pA = sA.prims[0], pB = sB.prims[0];
  ok(pA.length === 1 && pA[0].np === 12 && pA[0].Twp === 450 && pB.length === 2 && pB[0].np === pB[0].n && pB[1].np === 0 && pA[0].hp === 0,
    'exhaust port: port cells at the primary\'s bore ' + pA[0].np + ' of ' + pA[0].n + ' (centres within 120 mm at 10 mm), at its own bore ' + pB[0].np + ' of ' + pB[0].n + ' and ' + pB[1].np + ' after it; h 0 until a cycle is known');
  // (c) a run: the port's h is the law at the last cycle's net outflow and mass-averaged temperature (measured here), and
  // the cycle's mass and energy balance with the port's heat as a sink
  const eng = W.makeEngine(ENG, IN1, exA, { phases: [0] }), G = eng.gas, GI = eng.gasIn, st = W.freshState(eng, 0.01), FAN = 0.005;
  const stored = s => { let M = 0, E = 0;
    for (const Q of [].concat(...s.ins)) for (let i = 0; i < Q.n; i++) { M += Q.q1[i] * Q.dx; E += (Q.q3[i] + Q.q4[i] * GI.qx) * Q.dx; }
    for (const Q of [].concat(...s.prims)) for (let i = 0; i < Q.n; i++) { M += Q.q1[i] * Q.dx; E += (Q.q3[i] + Q.q4[i] * G.qx) * Q.dx; }
    for (const c of s.cyls) { M += c.m; E += c.m * (GS.at(G, c.T, c.x).e + c.x * G.qx); } return { M, E }; };
  let prev = stored(st), th0 = null, lastTk = null, win = null, done = null; const B = { mIn: 0, mOut: 0, fuel: 0, flow: 0, sink: 0, dM: 0, dE: 0, Q: 0, inj: 0, port: 0, portRA: 0 };
  const r = W.runSpeed(eng, { rpm: 6000, cycles: 6, dx: 0.01, state: st, hook: c => {
    const cy = c.cyls[0], tk = cy.th; if (th0 === null) th0 = c.st.th;
    if (lastTk !== null && ((lastTk < eng.ivc && tk >= eng.ivc) || (lastTk > tk && (tk >= eng.ivc || lastTk < eng.ivc)))) { done = win; win = { m: 0 }; }
    lastTk = tk; if (win) win.m -= cy._mE;
    const last = c.st.th - th0 >= 5 * 720 - 1e-9, now = stored(c.st);
    if (last) { const dt = c.dt;
      for (const L of c.ins) { B.mIn += L[0].f1[0] * dt; B.flow += (L[0].f3[0] + L[0].f4[0] * GI.qx) * dt; }
      for (const Q of c.outs) { B.mOut += Q.f1[Q.n] * dt; B.flow -= (Q.f3[Q.n] + Q.f4[Q.n] * G.qx) * dt; }
      for (const y of c.cyls) { B.fuel += y._mC - y._mP; B.inj += y._eC - y._eP; B.sink += y._qw + y._pdV + y._Q * (1 - GS.ETA_C) / GS.ETA_C; B.Q += y._Q; }
      for (const Q of c.all) for (let i = 0; i < Q.n; i++) { const T = Q.p[i] / (Q.Rm[i] * Q.r[i]), ra = dt * 2 * FAN * Q.r[i] * Math.abs(Q.u[i]) * Q.A[i] / Q.D[i] * Q.cp[i] * (Q.Tw - T) * Q.dx;
        // the h this step used: the one the previous step's cylinder update left (a new cycle's h is set after the pipes are stepped)
        if (i < Q.np) { const q = dt * Q._hp0 * Math.PI * Q.D[i] * (Q.Twp - T) * Q.dx; B.sink -= q; B.port -= q; B.portRA -= ra; } else B.sink -= ra; }
      B.dM += now.M - prev.M; B.dE += now.E - prev.E; }
    for (const Q of c.all) Q._hp0 = Q.hp;
    prev = now; } });
  const mr = (B.dM - (B.mIn - B.mOut + B.fuel)) / B.mIn, er = (B.dE - (B.flow + B.inj - B.sink)) / B.Q;
  const mBar = done.m * 6000 / 120, Tm = r.history[r.history.length - 1].tEx, D0 = pA[0].D[0], Re2 = 4 * mBar / (Math.PI * D0 * mu(Tm)), h2 = 0.35 * Re2 ** 0.6 * kk(Tm) / D0, hp = r.state.prims[0][0].hp;
  ok(Math.abs(hp / h2 - 1) < 1e-9, 'exhaust port, 6000 rpm: h of the last cycle ' + hp.toFixed(2) + ' W/m2 K = the law at its measured net outflow ' + (mBar * 1000).toFixed(2) + ' g/s and mass-averaged ' + Tm.toFixed(1) + ' K (Re ' + Re2.toFixed(0) + '): ' + h2.toFixed(2));
  ok(Math.abs(mr) < 1e-9 && Math.abs(er) < 1e-9 && B.port > 2 * B.portRA && B.port > 0,
    'exhaust port, one cycle at 6000 rpm: mass residual ' + mr.toExponential(2) + ', total energy residual / heat released ' + er.toExponential(2) + ' with the port\'s ' + B.port.toFixed(2) + ' J lost (' + (100 * B.port / B.Q).toFixed(2) +
    ' % of the heat released; Reynolds\' analogy at the header\'s 700 K wall would take ' + B.portRA.toFixed(2) + ' J from the same cells)');
  // (d) the legacy switch: the port marked but e.portHeat 'off' is the run without a port to the last digit
  const runOf = (e, ex) => W.sweep(W.makeEngine(e, IN1, ex, { phases: [0] }), [4000, 7000], { dx: 0.01, cycles: 3, firstCycles: 6, maxExtra: 3 });
  const a = runOf(Object.assign({}, ENG, { portHeat: 'off' }), exA), b = runOf(ENG, { segs: [{ L: 0.12, d0: 0.0445, d1: 0.0445 }, { L: 0.5, d0: 0.0445, d1: 0.0445 }], Tw: 700 }), c2 = runOf(ENG, exA);
  const same = a.every((x, i) => ['ve', 'imep', 'gimep', 'tEx', 'pEvo'].every(k => Object.is(x[k], b[i][k])));
  ok(same && c2.every((x, i) => x.tEx < a[i].tEx), 'exhaust port: e.portHeat off = no port, to the last digit (VE ' + a.map(x => x.ve.toFixed(4)).join(', ') + '); with the law the valve outflow\'s mean temperature ' + c2.map((x, i) => (x.tEx - a[i].tEx).toFixed(1)).join(', ') + ' K');
}

// ---------- 13. the head's intake port (2026-11-13, part 8)
{ const P = W.port, LIST = { depcik: [0.0694, 0.75], shayler: [0.135, 0.713], bauer: [0.140, 0.66] };
  ok(Object.keys(LIST).every(k => P.PORT_IN_NU[k][0] === LIST[k][0] && P.PORT_IN_NU[k][1] === LIST[k][1]) && Object.keys(P.PORT_IN_NU).length === 3 && P.PORT_IN_TW === 360,
    'intake port: the three correlations\' constants as tabulated (Depcik-Assanis 0.0694 Re^0.75, Shayler 0.135 Re^0.713, Bauer curved 0.140 Re^0.66); default wall 360 K');
  const mu = T => 1.716e-5 * (T / 273) ** 1.5 * 384 / (T + 111), kk = T => 0.0241 * (T / 273) ** 1.5 * 467 / (T + 194);
  const L0 = P.portInLaw({}), Re = 4 * 0.045 / (Math.PI * 0.0426 * mu(310)), hHand = 0.0694 * Re ** 0.75 * kk(310) / 0.0426;
  ok(L0.name === 'depcik' && L0.Tw === 360 && Math.abs(P.portH(L0, 0.045, 310, 0.0426) / hHand - 1) < 1e-12 && P.portInLaw({ portInHeat: 'off' }) === null && P.portInLaw({ portInHeat: false }) === null && P.portInLaw({ portInTw: 380 }).Tw === 380 && P.portInLaw({ portInHeat: 'shayler' }).C === 0.135,
    'intake port: default Depcik-Assanis at 360 K, h by hand at 0.045 kg/s, 310 K, 42.6 mm: Re ' + Re.toFixed(0) + ', Nu ' + (0.0694 * Re ** 0.75).toFixed(1) + ', h ' + hHand.toFixed(1) + ' W/m2 K (model ' + P.portH(L0, 0.045, 310, 0.0426).toFixed(1) + '); off / false: none');
  let threw = ''; try { P.portInLaw({ portInHeat: 'x' }); } catch (e) { threw = e.message; }
  ok(/depcik, shayler, bauer/.test(threw), 'intake port: an unknown law is refused: ' + threw);
  // (b) the port cells: a 300 mm runner whose last 120 mm is the port at its bore (one pipe), and a port of its own bore (its own pipe)
  const EX1 = { segs: [{ L: 0.5, d0: 0.0445, d1: 0.0445 }], Tw: 700 };
  const inA = { segs: [{ L: 0.18, d0: 0.0368, d1: 0.0368 }, { L: 0.12, d0: 0.0368, d1: 0.0368, port: true }], Tw: 320 };
  const inB = { segs: [{ L: 0.2, d0: 0.04, d1: 0.04 }, { L: 0.1, d0: 0.0368, d1: 0.0368, port: true }], Tw: 320 };
  const sA = W.freshState(W.makeEngine(ENG, inA, EX1, { phases: [0] }), 0.01), sB = W.freshState(W.makeEngine(ENG, inB, EX1, { phases: [0] }), 0.01);
  const qA = sA.ins[0], qB = sB.ins[0];
  ok(qA.length === 1 && qA[0].npa === 18 && qA[0].np === qA[0].n && qA[0].n === 30 && qA[0].Twp === 360 && qB.length === 2 && qB[0].np === 0 && qB[1].npa === 0 && qB[1].np === qB[1].n && qA[0].hp === 0 && sA.prims[0][0].np === 0,
    'intake port: port cells at the runner\'s bore ' + qA[0].npa + '..' + (qA[0].np - 1) + ' of ' + qA[0].n + ' (centres beyond 180 mm at 10 mm), at its own bore the whole last pipe (' + qB[1].n + ' cells) and none before it; h 0 until a cycle is known; the exhaust unmarked');
  // (c) a run: the port's h is the law at the last cycle's net inflow and its mass-averaged stagnation temperature (measured
  // here from the valve's flow on the runner's side), and the cycle's mass and energy balance with the port's heat as a source
  const eng = W.makeEngine(ENG, inA, EX1, { phases: [0] }), G = eng.gas, GI = eng.gasIn, st = W.freshState(eng, 0.01), FAN = 0.005;
  const stored = s => { let M = 0, E = 0;
    for (const Q of [].concat(...s.ins)) for (let i = 0; i < Q.n; i++) { M += Q.q1[i] * Q.dx; E += (Q.q3[i] + Q.q4[i] * GI.qx) * Q.dx; }
    for (const Q of [].concat(...s.prims)) for (let i = 0; i < Q.n; i++) { M += Q.q1[i] * Q.dx; E += (Q.q3[i] + Q.q4[i] * G.qx) * Q.dx; }
    for (const c of s.cyls) { M += c.m; E += c.m * (GS.at(G, c.T, c.x).e + c.x * G.qx); } return { M, E }; };
  let prev = stored(st), th0 = null, lastTk = null, win = null, done = null; const B = { mIn: 0, mOut: 0, fuel: 0, flow: 0, sink: 0, dM: 0, dE: 0, Q: 0, inj: 0, port: 0, portRA: 0 };
  const r = W.runSpeed(eng, { rpm: 6000, cycles: 6, dx: 0.01, state: st, hook: c => {
    const cy = c.cyls[0], tk = cy.th; if (th0 === null) th0 = c.st.th;
    if (lastTk !== null && ((lastTk < eng.ivc && tk >= eng.ivc) || (lastTk > tk && (tk >= eng.ivc || lastTk < eng.ivc)))) { done = win; win = { n: 0, m: 0, h: 0, x: 0 }; }
    lastTk = tk; if (win) { win.n += cy._mP; if (cy._mP > 0) { win.m += cy._mP; win.h += cy._eP; win.x += cy._mP * cy._xP; } }
    const last = c.st.th - th0 >= 5 * 720 - 1e-9, now = stored(c.st);
    if (last) { const dt = c.dt;
      for (const L of c.ins) { B.mIn += L[0].f1[0] * dt; B.flow += (L[0].f3[0] + L[0].f4[0] * GI.qx) * dt; }
      for (const Q of c.outs) { B.mOut += Q.f1[Q.n] * dt; B.flow -= (Q.f3[Q.n] + Q.f4[Q.n] * G.qx) * dt; }
      for (const y of c.cyls) { B.fuel += y._mC - y._mP; B.inj += y._eC - y._eP; B.sink += y._qw + y._pdV + y._Q * (1 - GS.ETA_C) / GS.ETA_C; B.Q += y._Q; }
      for (const Q of c.all) for (let i = 0; i < Q.n; i++) { const T = Q.p[i] / (Q.Rm[i] * Q.r[i]), ra = dt * 2 * FAN * Q.r[i] * Math.abs(Q.u[i]) * Q.A[i] / Q.D[i] * Q.cp[i] * (Q.Tw - T) * Q.dx;
        if (i >= Q.npa && i < Q.np) { const q = dt * Q._hp0 * Math.PI * Q.D[i] * (Q.Twp - T) * Q.dx; B.sink -= q; B.port += q; B.portRA += ra; } else B.sink -= ra; }
      B.dM += now.M - prev.M; B.dE += now.E - prev.E; }
    for (const Q of c.all) Q._hp0 = Q.hp;
    prev = now; } });
  const mr = (B.dM - (B.mIn - B.mOut + B.fuel)) / B.mIn, er = (B.dE - (B.flow + B.inj - B.sink)) / B.Q;
  const mBar = done.n * 6000 / 120, Tm = GS.T(GI, done.h / done.m, done.x / done.m, 300, true), D0 = qA[0].D[qA[0].npa], Re2 = 4 * mBar / (Math.PI * D0 * mu(Tm)), h2 = 0.0694 * Re2 ** 0.75 * kk(Tm) / D0, hp = r.state.ins[0][0].hp;
  ok(Math.abs(hp / h2 - 1) < 1e-9, 'intake port, 6000 rpm: h of the last cycle ' + hp.toFixed(2) + ' W/m2 K = the law at its measured net inflow ' + (mBar * 1000).toFixed(2) + ' g/s and mass-averaged ' + Tm.toFixed(1) + ' K (Re ' + Re2.toFixed(0) + '): ' + h2.toFixed(2));
  ok(Math.abs(mr) < 1e-9 && Math.abs(er) < 1e-9 && B.port > 0,
    'intake port, one cycle at 6000 rpm: mass residual ' + mr.toExponential(2) + ', total energy residual / heat released ' + er.toExponential(2) + ' with the port\'s ' + B.port.toFixed(2) + ' J into the charge (' + (100 * B.port / B.Q).toFixed(2) +
    ' % of the heat released; Reynolds\' analogy at the runner\'s 320 K would put ' + B.portRA.toFixed(2) + ' J into the same cells)');
  // (d) the legacy switch: the port marked but e.portInHeat 'off' is the run without a port to the last digit; the law lowers the VE
  const runOf = (e, inl) => W.sweep(W.makeEngine(e, inl, EX1, { phases: [0] }), [4000, 7000], { dx: 0.01, cycles: 3, firstCycles: 6, maxExtra: 3 });
  const a = runOf(Object.assign({}, ENG, { portInHeat: 'off' }), inA), b = runOf(ENG, { segs: [{ L: 0.18, d0: 0.0368, d1: 0.0368 }, { L: 0.12, d0: 0.0368, d1: 0.0368 }], Tw: 320 }), c2 = runOf(ENG, inA);
  const same = a.every((x, i) => ['ve', 'imep', 'gimep', 'tEx', 'pEvo'].every(k => Object.is(x[k], b[i][k])));
  ok(same && c2.every((x, i) => x.ve < a[i].ve), 'intake port: e.portInHeat off = no port, to the last digit (VE ' + a.map(x => x.ve.toFixed(4)).join(', ') + '); with the law the VE ' + c2.map((x, i) => (100 * (x.ve / a[i].ve - 1)).toFixed(2)).join(', ') + ' %');
}

console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
process.exit(fails.length ? 1 : 0);
