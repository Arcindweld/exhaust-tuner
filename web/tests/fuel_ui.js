// The fuel as a property of the engine (2026-11-14, docs/WAVE_VALIDATION_2026-11-11.md part 11): CH_y O_z blends of the
// gasoline and the alcohols in the wave model (wsFactory "the fuel"), their evaporation, and the steady sections' exhaust
// gas for the fuel picked. Runs in Node (no browser), about a minute. Every reference value is worked here by hand from the
// sources named, not read back from the model:
//  1. composition and stoichiometric air-fuel ratio of E0, E10, E85, E100, M100 from the molecules (by volume with DOE's
//     specific gravities, Handbook DOE/GO-102016-4854 Table 2: ethanol 0.794, gasoline 0.72-0.78, taken 0.75);
//  2. lower heating values from NASA CEA's liquid formation enthalpies and NIST-JANAF's CO2 and H2O, the blends' by mass;
//  3. the rich products' atom balances with the fuel's oxygen and the water-gas ratio (found here by bisection);
//  4. the constant-pressure adiabatic check: the heat released raises the products' sensible enthalpy by exactly the
//     heat; the frozen flame temperatures reported;
//  5. the charge cooling by evaporation at the intake valve against L / AFR / cp worked here (cp held at 300 K in the hand
//     sum: within 3 %, the vapour's cp falling with the temperature);
//  6. an engine cycle on E85 with 70 % of the latent heat from the charge: mass and total energy conserved to rounding;
//  7. the gasoline as before: no blend and no evap give the earlier model's objects and results to the last digit;
//  8. the steady sections' exhaust gas (fuelExh): R, cp, gamma of the products at the mixture against the same mixture
//     worked here from the species, and the page's default gasoline left at the earlier stoichiometric gas.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const a0 = html.indexOf('function wsFactory(){'), z0 = html.indexOf('\nconst WS=wsFactory();');
const src = html.slice(a0, z0);
const anchor = 'const U=(G?cy.m*gasE(G,cy.T,cy.x):cy.m*CV*cy.T)-cy.p*dV+';
const hooked = src.replace(anchor, 'cy._mE=mE; cy._pdV=cy.p*dV; cy._qw=qw; cy._Q=cy.burnQ*dxb; cy._mC=vInC[k].m*dt; cy._mP=vIn[k].m*dt; cy._eC=vInC[k].m*vInC[k].h*dt; cy._eP=vIn[k].m*vIn[k].h*dt;\n        ' + anchor)
  .replace('      st.th+=dth;\n', '      if(opts.hook) opts.hook({st,all,dt,dth,cyls,ins,outs,chambers});\n      st.th+=dth;\n')
  .replace('\nconst NOOP=()=>{};', '\nconst NOOP=()=>{}; __x.portFuel=portFuel;');
ok(hooked.indexOf('cy._pdV') > 0 && hooked.indexOf('opts.hook') > 0 && hooked.indexOf('__x.portFuel') > 0, 'the model loads with a step hook and its port injector exposed');
const X = {}, W = new Function('__x', hooked + '\nreturn wsFactory();')(X), GS = W.gas;
const W0 = new Function(src + '\nreturn wsFactory();')();   // the page's model as it is, for 7
const rel = (a, b) => Math.abs(a / b - 1);

// ---------- 1. composition and stoichiometry
const Mc = 12.0107, Mh = 1.00794, Mo = 15.9994;
const AIRm = 3.7279 * 28.0134 + 31.9988 + 0.04459 * 39.948;      // g of air per mol of O2 (N2, O2, Ar of the model's air)
const Mg = Mc + 1.87 * Mh, Me = 2 * Mc + 6 * Mh + Mo, Mm = Mc + 4 * Mh + Mo;
const afrG = (1 + 1.87 / 4) * AIRm / Mg, afrE = 3 * AIRm / Me, afrM = 1.5 * AIRm / Mm;   // C2H5OH + 3 O2; CH3OH + 1.5 O2
const SG_E = 0.794, SG_G = 0.75, byVol = v => v * SG_E / (v * SG_E + (1 - v) * SG_G);
const FU = { E0: [0, 0], E10: [byVol(0.10), 0], E85: [byVol(0.85), 0], E100: [1, 0], M100: [0, 1] };
const F = {}; for (const k in FU) F[k] = GS.fuelOf(k === 'E0' ? null : { eth: FU[k][0], meth: FU[k][1] }, null);
ok(Math.abs(Me - 46.06844) < 1e-9 && Math.abs(Mm - 32.04186) < 1e-9, 'molar masses from the atomic weights: ethanol ' + Me.toFixed(5) + ', methanol ' + Mm.toFixed(5) + ' g/mol (NASA CEA: 46.06844, 32.04186)');
ok(Math.abs(FU.E85[0] - 0.857125) < 1e-6 && Math.abs(FU.E10[0] - 0.105249) < 1e-6, 'by volume to by mass: E85 (85 % ethanol) ' + FU.E85[0].toFixed(6) + ', E10 ' + FU.E10[0].toFixed(6) + ' ethanol by mass');
for (const k in FU) {
  const [we, wm] = FU[k], wg = 1 - we - wm, hand = wg * afrG + we * afrE + wm * afrM;     // the O2 demand per kg is additive by mass
  // H/C and O/C by hand: mol of C atoms per g of each part
  const cg = wg / Mg, ce = we * 2 / Me, cm = wm / Mm, y = (cg * 1.87 + ce * 3 + cm * 4) / (cg + ce + cm), z = (ce * 0.5 + cm) / (cg + ce + cm);
  ok(rel(F[k].afrSt, hand) < 1e-13 && Math.abs(F[k].y - y) < 1e-12 && Math.abs(F[k].z - z) < 1e-12,
    k + ': CH' + y.toFixed(4) + 'O' + z.toFixed(4) + ', stoichiometric AFR ' + hand.toFixed(4) + ' by hand (' + wg.toFixed(4) + ' x ' + afrG.toFixed(4) + ' + ' + we.toFixed(4) + ' x ' + afrE.toFixed(4) + ' + ' + wm.toFixed(4) + ' x ' + afrM.toFixed(4) + '), model ' + F[k].afrSt.toFixed(4));
}
ok(Math.abs(afrE - 9.0) < 0.01 && Math.abs(F.E85.afrSt - 9.8) < 0.01 && Math.abs(afrM - 6.47) < 0.01 && Math.abs(afrG - 14.596) < 1e-3,
  'against the published ratios: ethanol ' + afrE.toFixed(3) + ' (DOE handbook and HP Academy: 9.0), E85 ' + F.E85.afrSt.toFixed(3) + ' (HP Academy 9.8; DOE "10" for its E85), methanol ' + afrM.toFixed(3) + ' (HP Academy 6.4), gasoline ' + afrG.toFixed(3) + ' (14.6-14.7)');
ok(F.E85.y > 2.75 && F.E85.y < 2.95 && F.E0 === GS.F_GAS, 'E85\'s H/C ' + F.E85.y.toFixed(3) + ' inside DOE\'s 2.75-2.95; E0 is the gasoline object of before');

// ---------- 2. lower heating values (liquid fuel, H2O as vapour): NASA CEA liquids, NIST-JANAF CO2 -393.522, H2O(g) -241.826 kJ/mol
const hCO2 = -393.522, hH2O = -241.826;
const lhvE = (-277.510 - 2 * hCO2 - 3 * hH2O) / Me, lhvM = (-238.910 - hCO2 - 2 * hH2O) / Mm;   // MJ/kg
const lean = k => GS.heatRelease(1.25, F[k]).perFuel / 1e6;
ok(Math.abs(lean('E100') - lhvE) < 2e-3 && Math.abs(lean('M100') - lhvM) < 2e-3 && Math.abs(lean('E0') - 44.0) < 1e-6,
  'LHV by hand: ethanol (-277.510 + 2 x 393.522 + 3 x 241.826) / 46.068 = ' + lhvE.toFixed(4) + ' MJ/kg (model ' + lean('E100').toFixed(4) + '; Heywood 26.9, US 8,468,983 Table 3 26.7), methanol ' + lhvM.toFixed(4) + ' (model ' + lean('M100').toFixed(4) + '; Table 3 20.0), gasoline 44.0 (model ' + lean('E0').toFixed(4) + ')');
for (const k of ['E10', 'E85']) { const [we] = FU[k], hand = (1 - we) * lean('E0') + we * lean('E100');
  ok(rel(lean(k), hand) < 1e-12, k + ': LHV ' + lean(k).toFixed(4) + ' MJ/kg = the mass-weighted ' + (1 - we).toFixed(4) + ' x 44.0 + ' + we.toFixed(4) + ' x ' + lean('E100').toFixed(4)); }
{ const a = GS.heatRelease(0.822, F.E0).perAir, b = GS.heatRelease(0.822, F.E85).perAir, c = lean('E0') / afrG, d = lean('E85') / F.E85.afrSt;
  ok(Math.abs(c - 3.0145) < 1e-3 && Math.abs(d - 2.9862) < 1e-3, 'heat per kg of air, lean (LHV / AFR): gasoline ' + c.toFixed(4) + ', E85 ' + d.toFixed(4) + ' MJ/kg; at lambda 0.822 (the CO and H2 left over): ' + (a / 1e6).toFixed(4) + ' and ' + (b / 1e6).toFixed(4) + ' (E85 ' + (100 * (b / a - 1)).toFixed(2) + ' %)'); }
{ const FE = GS.fuelOf({ eth: 1 }, 0), L = FE.L / 1e6;
  ok(Math.abs(FE.L - 42560 / Me * 1000) < 1e-6 && Math.abs(GS.heatRelease(1.25, FE).perFuel / 1e6 - (lhvE + L)) < 2e-3,
    'with the evaporation counted the fuel is the vapour: ethanol\'s latent heat 42560 J/mol (NASA: gas -234950 - liquid -277510) = ' + (1000 * L).toFixed(2) + ' kJ/kg, its LHV as vapour ' + (lhvE + L).toFixed(4) + ' MJ/kg'); }

// ---------- 3. rich products: atom balances with the fuel's oxygen, the water-gas ratio by bisection
for (const k of ['E85', 'E100', 'M100']) {
  const f = F[k], lam = 0.822, o = 1 + f.y / 4 - f.z / 2, S = 2 * lam * o + f.z - 1;
  let lo = Math.max(0, S - f.y / 2) + 1e-15, hi = Math.min(1, S) - 1e-15;
  const res = a => (1 - a) * (S - a) - 3.5 * a * (f.y / 2 - S + a);
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; if (res(m) > 0) lo = m; else hi = m; }
  const a = (lo + hi) / 2, n = GS.burnedMoles(lam, f);
  const C = n[3] + n[5], H = 2 * n[4] + 2 * n[6], O = 2 * n[3] + n[4] + n[5] + 2 * n[1], Oin = 2 * lam * o + f.z;
  ok(Math.abs(n[3] - a) < 1e-12 && Math.abs(C - 1) < 1e-14 && Math.abs(H - f.y) < 1e-13 && Math.abs(O - Oin) < 1e-13 && Math.abs(n[5] * n[4] / (n[3] * n[6]) - 3.5) < 1e-9,
    k + ' at lambda 0.822: CO2 ' + n[3].toFixed(5) + ' (bisection ' + a.toFixed(5) + '), CO ' + n[5].toFixed(5) + ', H2O ' + n[4].toFixed(5) + ', H2 ' + n[6].toFixed(5) + ' per C atom; C, H, O (' + O.toFixed(5) + ' = 2 lambda o + z with the fuel\'s ' + f.z.toFixed(4) + ') balanced, water-gas ratio 3.5');
}

// ---------- 4. constant-pressure adiabatic check (frozen products, reactants at 298.15 K, no ETA_C)
const tad = {};
for (const k of ['E0', 'E85', 'E100', 'M100']) {
  const G = GS.makeGas(F[k].afrSt, true, F[k]), q = G.qx;          // J per kg of mixture at lambda 1
  let lo = 1000, hi = 3400; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (GS.at(G, m, 0).h < q) lo = m; else hi = m; }
  tad[k] = (lo + hi) / 2;
  const back = GS.at(G, tad[k], 0).h, perFuel = q * (1 + F[k].afrSt);
  ok(rel(back, q) < 1e-10 && rel(perFuel, lean(k) * 1e6) < 1e-12, k + ' stoichiometric: the heat ' + (q / 1e6).toFixed(4) + ' MJ/kg of mixture (x (1 + AFR) = ' + (perFuel / 1e6).toFixed(4) + ' MJ/kg of fuel, its LHV) raises the products to ' + tad[k].toFixed(0) + ' K (frozen, no dissociation)');
}
ok(tad.E100 < tad.E0 && tad.M100 < tad.E100, 'frozen flame temperatures: gasoline ' + tad.E0.toFixed(0) + ' K, E85 ' + tad.E85.toFixed(0) + ', ethanol ' + tad.E100.toFixed(0) + ', methanol ' + tad.M100.toFixed(0) +
  ' (equilibrium, tools/validation/wave/fuel_flame.py; Engineering ToolBox gives ethanol 2238 K and methanol 2222 K in air from 25 C, 1 atm)');

// ---------- 5. charge cooling at the intake valve: the injector's fuel takes the share f of its latent heat from the charge
{ const cpAir = 1006.5, cpE = 7.8890 * 8.314462618 / Me * 1000, cpG = 1486;   // J/kg K at 300 K: dry air (JANAF), ethanol vapour (NASA CEA's fit), the gasoline vapour (part 2)
  for (const [k, f] of [['E85', 1], ['E85', 0.7], ['E0', 1], ['E100', 1]]) {
    const lam = 0.822, FE = GS.fuelOf(k === 'E0' ? { eth: 0 } : { eth: FU[k][0] }, f), FN = GS.fuelOf(k === 'E0' ? { eth: 0 } : { eth: FU[k][0] }, 0);
    const afr = lam * FE.afrSt, G = GS.makeGas(afr, true, FE), GI = GS.makeGas(afr, false, FE), GN = GS.makeGas(afr, true, FN), GNI = GS.makeGas(afr, false, FN);
    const T0 = 330, Tof = (Gx, h) => { let lo = 150, hi = 400; for (let i = 0; i < 100; i++) { const m = (lo + hi) / 2; if (GS.at(Gx, m, 1).h < h) lo = m; else hi = m; } return (lo + hi) / 2; };
    const flow = Gi => [{ m: 1, h: GS.at(Gi, T0, 1).h, x: 1, uj: 0 }], cy = (Gx, Gi) => ({ G: Gx, GI: Gi, x: 1, T: 400 });
    const r = X.portFuel(flow(GI), 0, cy(G, GI)), r0 = X.portFuel(flow(GNI), 0, cy(GN, GNI));
    const dT = Tof(G, r.h) - Tof(GN, r0.h), ia = 1 / afr, cpV = k === 'E0' ? cpG : k === 'E100' ? cpE : FU.E85[0] * cpE + (1 - FU.E85[0]) * cpG;
    const hand = -f * FE.L * ia / (cpAir + ia * cpV);
    ok(Math.abs(r.fuel - ia) < 1e-15 && Math.abs(dT / hand - 1) < 0.03, k + ', lambda 0.822 (AFR ' + afr.toFixed(3) + '), ' + (100 * f).toFixed(0) + ' % from the charge: the charge ' + (-dT).toFixed(1) + ' K cooler at the valve (by hand ' +
      (f).toFixed(1) + ' x ' + (FE.L / 1000).toFixed(1) + ' kJ/kg / ' + afr.toFixed(3) + ' / (' + cpAir + ' + ' + cpV.toFixed(0) + ' / ' + afr.toFixed(3) + ') = ' + (-hand).toFixed(1) + ' K)');
  }
  const r = (GS.fuelOf({ eth: 1 }, 1).L / afrE) / (GS.fuelOf({ eth: 0 }, 1).L / afrG);
  ok(r > 4, 'ethanol against gasoline at stoichiometric, all from the charge: ' + r.toFixed(2) + ' times the heat per kg of air (US 8,468,983: "a factor of more than 4"; its Table 3, constant volume after IVC: -138 K and -28 K)');
}

// ---------- 6. an engine cycle on E85 with its evaporation counted: mass and total energy
const ENG = { bore: 0.084, stroke: 0.089, rod: 0.1513, cr: 11.5, cd: 0.7, nIn: 2, dIn: 0.0336, liftIn: 0.008736, nEx: 2, dEx: 0.02856, liftEx: 0.0079968,
  cam: { ivo: 32, ivc: 44, evo: 48, evc: 20 }, burn: { start: 18, dur: 55 }, afr: 12.8, eta: 0.72 };
const IN1 = { segs: [{ L: 0.3, d0: 0.0368, d1: 0.0368 }], Tw: 320 }, EX1 = { segs: [{ L: 0.4, d0: 0.0445, d1: 0.0445 }, { L: 0.2, d0: 0.09, d1: 0.09 }, { L: 0.2, d0: 0.0445, d1: 0.0445 }], Tw: 700 };
function balance(e, rpm) {
  const eng = W.makeEngine(e, IN1, EX1, { phases: [0] }), G = eng.gas, GI = eng.gasIn, st = W.freshState(eng, 0.01), FAN = 0.005;
  const stored = s => { let M = 0, E = 0;
    for (const P of [].concat(...s.ins)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * GI.qx) * P.dx; }
    for (const P of [].concat(...s.prims)) for (let i = 0; i < P.n; i++) { M += P.q1[i] * P.dx; E += (P.q3[i] + P.q4[i] * G.qx) * P.dx; }
    for (const c of s.cyls) { M += c.m; E += c.m * (GS.at(G, c.T, c.x).e + c.x * G.qx); } return { M, E }; };
  let prev = stored(st), th0 = null; const B = { mIn: 0, mOut: 0, fuel: 0, flow: 0, sink: 0, dM: 0, dE: 0, Q: 0, inj: 0 };
  const r = W.runSpeed(eng, { rpm, cycles: 5, dx: 0.01, state: st, hook: c => {
    if (th0 === null) th0 = c.st.th; const last = c.st.th - th0 >= 4 * 720 - 1e-9, now = stored(c.st);
    if (last) { const dt = c.dt;
      for (const L of c.ins) { B.mIn += L[0].f1[0] * dt; B.flow += (L[0].f3[0] + L[0].f4[0] * GI.qx) * dt; }
      for (const P of c.outs) { B.mOut += P.f1[P.n] * dt; B.flow -= (P.f3[P.n] + P.f4[P.n] * G.qx) * dt; }
      for (const cy of c.cyls) { B.fuel += cy._mC - cy._mP; B.inj += cy._eC - cy._eP; B.sink += cy._qw + cy._pdV + cy._Q * (1 - GS.ETA_C) / GS.ETA_C; B.Q += cy._Q; }
      for (const P of c.all) for (let i = 0; i < P.n; i++) B.sink -= dt * 2 * FAN * P.r[i] * Math.abs(P.u[i]) * P.A[i] / P.D[i] * P.cp[i] * (P.Tw - P.p[i] / (P.Rm[i] * P.r[i])) * P.dx;
      B.dM += now.M - prev.M; B.dE += now.E - prev.E; }
    prev = now; } });
  return { r, B, G, mr: (B.dM - (B.mIn - B.mOut + B.fuel)) / B.mIn, er: (B.dE - (B.flow + B.inj - B.sink)) / B.Q };
}
{ const e85 = Object.assign({}, ENG, { afr: 0.822 * F.E85.afrSt, blend: { eth: FU.E85[0] }, evap: 0.7 }), b = balance(e85, 6000);
  ok(Math.abs(b.mr) < 1e-9 && Math.abs(b.er) < 1e-9 && Math.abs(b.B.fuel / b.B.mIn * e85.afr - 1) < 0.05 && b.G.cool > 0,
    'E85, lambda 0.822, 70 % of its latent heat from the charge, one cycle at 6000 rpm: mass residual ' + b.mr.toExponential(2) + ' (fuel ' + (100 * b.B.fuel / b.B.mIn).toFixed(2) + ' % of the air; 1/AFR ' + (100 / e85.afr).toFixed(2) + ' %), total energy residual / heat released ' + b.er.toExponential(2) + '; VE ' + b.r.ve.toFixed(4) + ', IMEP ' + (b.r.imep / 1e5).toFixed(3) + ' bar');
  const m = balance(Object.assign({}, ENG, { afr: 1.1 * GS.fuelOf({ meth: 1 }, null).afrSt, blend: { meth: 1 } }), 4000);
  ok(Math.abs(m.mr) < 1e-9 && Math.abs(m.er) < 1e-9, 'methanol, lambda 1.1, evaporation not counted, one cycle at 4000 rpm: mass residual ' + m.mr.toExponential(2) + ', energy ' + m.er.toExponential(2)); }

// ---------- 7. the gasoline as before
{ const same = (a, b) => JSON.stringify(a, (k, v) => k === 'F' ? undefined : v) === JSON.stringify(b, (k, v) => k === 'F' ? undefined : v);
  ok(GS.fuelOf(null, null) === GS.F_GAS && GS.fuelOf({ eth: 0 }, '') === GS.F_GAS && same(GS.makeGas(12.8, true), GS.makeGas(12.8, true, GS.fuelOf({ eth: 0, meth: 0 }, null))) && GS.makeGas(12.8, true).cool === 0,
    'no blend and no evap: the gasoline object, the same gas to the last digit, nothing taken from the charge');
  const run = e => W0.runSpeed(W0.makeEngine(e, IN1, EX1, { phases: [0] }), { rpm: 5000, cycles: 3, dx: 0.01 });
  const r0 = run(ENG), r1 = run(Object.assign({}, ENG, { blend: { eth: 0, meth: 0 }, evap: null }));
  ok(['ve', 'imep', 'gimep', 'pmax', 'tEx', 'resid'].every(k => Object.is(r0[k], r1[k])), 'an engine run with blend {0, 0} and evap null is the run without them to the last digit (VE ' + r0.ve + ', tEx ' + r0.tEx + ')'); }

// ---------- 8. the steady sections' exhaust gas
{ const m = html.match(/\/\* ----- the exhaust gas of the fuel picked[\s\S]*?\n\/\/ end fuelExh\n/);
  if (!m) ok(false, 'fuelExh block found in the page');
  else {
    const P = new Function('wsFactory', 'EXH_GAS', 'exhGamma', m[0] + '\nreturn {fuelExh,fuelExhGas};')(() => W0, { R: 1, lo: [], hi: [] }, () => 0);
    for (const [k, lam] of [['E0', 0.822], ['E85', 0.822], ['E85', 1.0], ['E10', 0.822]]) {
      const f = F[k], n = GS.burnedMoles(lam, f), S = W0.gas.SPEC, N = n.slice(0, 7).reduce((a, b) => a + b, 0), M = n.slice(0, 7).reduce((a, b, i) => a + b * S[i][0], 0) / N;
      const T = 1200, cpR = n.slice(0, 7).reduce((a, b, i) => { const c = S[i][2]; return a + b * (c[0] + T * (c[1] + T * (c[2] + T * (c[3] + T * c[4])))); }, 0) / N;
      const R = 8.314462618 / M * 1000, g = cpR / (cpR - 1), X = P.fuelExh(f, lam, T);
      ok(Math.abs(X.R / R - 1) < 1e-12 && Math.abs(X.gamma - g) < 1e-12, k + ' at lambda ' + lam + ', 1200 K: R ' + R.toFixed(2) + ' J/kg K, gamma ' + g.toFixed(4) + ', cp ' + (g * R / (g - 1)).toFixed(1) + ' J/kg K by hand from the species (fuelExh ' + X.R.toFixed(2) + ', ' + X.gamma.toFixed(4) + ')');
    }
  } }

console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
process.exit(fails.length ? 1 : 0);
