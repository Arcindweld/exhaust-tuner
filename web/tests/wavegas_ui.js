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
//  9. friction: Heywood's tfmep by hand, and the brake torque's gross loop against p dV integrated here.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const a0 = html.indexOf('function wsFactory(){'), z0 = html.indexOf('\nconst WS=wsFactory();');
const src = html.slice(a0, z0);
const anchor = 'const U=(G?cy.m*gasE(G,cy.T,cy.x):cy.m*CV*cy.T)-cy.p*dV+';
const hooked = src.replace(anchor, 'cy._pdV=cy.p*dV; cy._qw=qw; cy._Q=cy.burnQ*dxb;\n        ' + anchor)
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
function superExit(G) {
  const A = Math.PI * 0.04 ** 2 / 4, T = 600, p = 50000, x = 0, R = G ? GS.at(G, T, x).R : W.RG, g = G ? GS.at(G, T, x).gamma : W.GAM;
  const r = p / (R * T), c = Math.sqrt(g * p / r), u = 1.6 * c, E = G ? r * GS.at(G, T, x).e + 0.5 * r * u * u : p / (g - 1) + 0.5 * r * u * u;
  const P = W0.makePipe({ L: 0.5, dx: 0.01, area: () => A, T0: T, Tw: T, x0: x, gas: G || undefined });
  for (let i = 0; i < P.n; i++) { P.q1[i] = r * A; P.q2[i] = r * u * A; P.q3[i] = E * A; P.q4[i] = r * x * A; }
  P.left = Q => { Q.f1[0] = r * u * A; Q.f2[0] = (r * u * u + p) * A; Q.f3[0] = u * (E + p) * A; Q.f4[0] = r * u * x * A; };   // the stream enters supersonic: all its state given
  P.right = W0.openEnd(+1, W0.PATM, 298.15, 1);
  let t = 0, bad = false;
  while (t < 0.01) { W0.prim(P); const s = W0.maxSpeed(P); if (!(s < 1e5)) { bad = true; break; } const dt = 0.8 * P.dx / s; W0.stepPipe(P, dt); t += dt; }
  W0.prim(P);
  let dp = 0; for (let i = 0; i < P.n; i++) dp = Math.max(dp, Math.abs(P.p[i] / p - 1));
  const shock = p * (1 + 2 * g / (g + 1) * (1.6 * 1.6 - 1));
  return { bad, dp, out: P.f1[P.n] / (r * u * A) - 1, shock };
}
for (const [name, G] of [['constant gamma', null], ['the engine\'s gas', G128]]) {
  const s = superExit(G);
  ok(!s.bad && s.dp < 1e-9 && Math.abs(s.out) < 1e-9, name + ': a Mach 1.6 stream at 50 kPa (a normal shock would hold ' + (s.shock / 1000).toFixed(0) + ' kPa) leaves into 101.3 kPa unchanged: pressure spread ' +
    s.dp.toExponential(1) + ', outflow / inflow - 1 = ' + s.out.toExponential(1) + (s.bad ? ' (ran away)' : '')); }

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
{ const eng = W.makeEngine(ENG, { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320 }, { segs: [{ L: 0.4, d0: 0.0445, d1: 0.0445 }, { L: 0.2, d0: 0.09, d1: 0.09 }, { L: 0.2, d0: 0.0445, d1: 0.0445 }], Tw: 700 }, { phases: [0] });
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
  const eng = W.makeEngine(ENG, { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320 }, { segs: [{ L: 0.4, d0: 0.0445, d1: 0.0445 }, { L: 0.2, d0: 0.09, d1: 0.09 }, { L: 0.2, d0: 0.0445, d1: 0.0445 }], Tw: 700 }, { phases: [0] });
  const G = eng.gas, qx = G.qx, st = W.freshState(eng, 0.01), FAN = 0.005;
  const stored = s => { let E = 0; for (const P of [].concat(...s.ins, ...s.prims)) for (let i = 0; i < P.n; i++) E += (P.q3[i] + P.q4[i] * qx) * P.dx;
    for (const c of s.cyls) E += c.m * (GS.at(G, c.T, c.x).e + c.x * qx); return E; };
  let prev = stored(st), th0 = null; const B = { flow: 0, sink: 0, dE: 0, Q: 0, lost: 0, g: 0 };
  const r = W.runSpeed(eng, { rpm: 6000, cycles: 6, dx: 0.01, state: st, hook: c => {
    if (th0 === null) th0 = c.st.th; const last = c.st.th - th0 >= 5 * 720 - 1e-9, now = stored(c.st);
    if (last) { const dt = c.dt; for (const L of c.ins) B.flow += (L[0].f3[0] + L[0].f4[0] * qx) * dt; for (const P of c.outs) B.flow -= (P.f3[P.n] + P.f4[P.n] * qx) * dt;
      for (const cy of c.cyls) { B.sink += cy._qw + cy._pdV + cy._Q * (1 - GS.ETA_C) / GS.ETA_C; B.Q += cy._Q; B.lost += cy._Q * (1 - GS.ETA_C) / GS.ETA_C; if (cy.th >= 540 || cy.th < 180) B.g += cy._pdV; }
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

console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
process.exit(fails.length ? 1 : 0);
