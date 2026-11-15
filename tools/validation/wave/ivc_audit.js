// The trapped charge at intake closing under boost, taken apart (docs/WAVE_VALIDATION_2026-11-11.md, part 13, M sections).
// The K24A2 + PT5862 18 psi pump-gas job of part 12 (results/knock_k24_jobs.json: the page's plan, the turbine's and the
// gate's areas as the closure found them per speed) and the same engine with its pipes open to the air (knock_val.js's naOf),
// one settled cycle of cylinder 1 instrumented (lib.js hook, read only):
//   - crank-angle traces (1 deg bins): cylinder p, T, m, x; intake valve flow forward / back (cylinder side); exhaust valve
//     flow; the runner's end cell (the port) static and total pressure; the runner's mouth; the exhaust port's first cell;
//   - the trapped mass at IVC split into air, fuel, residual; the fresh charge delivered through the intake valve, the fresh
//     charge short-circuited through the exhaust valve during overlap (and drawn back), the trapping ratio;
//   - the state at BDC, at IVC, and the IVC state taken isentropically to the BDC volume (p*, T*, as ve_decomp.js);
//   - the pressure budget p_ivc / p_src = (V_bdc / V_ivc)^gamma x (m_ivc / m_ref) x (T* / T_src) x (R / R_src), m_ref the
//     source's density in the BDC volume;
//   - the enthalpy budget from IVO to IVC, exact by the model's own energy equation (H = U + p V):
//       H_ivc - m_ivc h_s = m_ivo (h_ivo - h_s) + sum_in dm (h_in - h_s) + sum_ex dm (h_ex - h_s) - Q_wall + int V dp
//     with h_s the fresh mixture's enthalpy at the source temperature; int V dp = Delta(pV) - sum p dV, split at BDC;
//     each term in K = term / (m_ivc cp_eff), cp_eff = (h(T_ivc, x_ivc) - h(T_s, x_ivc)) / (T_ivc - T_s).
//   node tools/validation/wave/ivc_audit.js [cases=b18,na] [rpms=5050,6600,7100] [tag=m_base] [At=,Ag=,eta= (mm2, for b18)]
//     [ivcShift=deg (the intake closing moved, the opening held: a longer or shorter seat duration)] [runnerL=m] [psi=18]
//     [p3x=K (the turbine's area, gate shut, for a time-mean static p3 of K x boost at each speed)]
//     [traces=1 (the 1-degree traces in the output)]
//   -> results/ivc_<tag>.json
'use strict';
const fs = require('fs'), path = require('path');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const { load } = require('./lib');
const WS = load({ hook: true });
const h = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'web', 'index.html'), 'utf8');
const kSrc = h.slice(h.indexOf('function knockLib(WS){'), h.indexOf('\nfunction turboSimLib(WS,X){'));
const KN = new Function('WS', kSrc + '\nreturn knockLib(WS);')(WS);
const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'knock_k24_jobs.json'), 'utf8'));
const psi = +(args.psi || 18), job = jobs.find(j => Math.abs(j.psi - psi) < 0.01 && j.fuel === 'pump').S;
const naOf = sp => ({ e: sp.e, intake: Object.assign({}, sp.intake, { source: { p: 101325, T: 298.15 } }),
  exhaust: { segs: sp.exhaust.segs, Tw: sp.exhaust.Tw, pOut: sp.exhaust.turbine.pOut },
  opt: { phases: sp.opt.phases, collector: { segs: sp.opt.collector.segs.concat(sp.exhaust.turbine.down.segs), Tw: sp.opt.collector.Tw } } });
const cases = (args.cases || 'b18,na').split(','), rpms = (args.rpms || '5050,6600,7100').split(',').map(Number);
const ON = 95;   // 91 AKI (part 12)
function specOf(c) {
  let sp = JSON.parse(JSON.stringify(c === 'na' ? naOf(job.spec) : job.spec));
  if (+args.ivcShift) sp.e.cam.ivc += +args.ivcShift;
  if (+args.runnerL > 0) sp.intake.segs = sp.intake.segs.map((q, i) => i === 0 ? Object.assign({}, q, { L: +args.runnerL }) : q);
  if (c !== 'na' && args.eta) sp.exhaust.turbine.eta = +args.eta;
  return sp;
}
function run(c, rpm) {
  const sp = specOf(c), eng = WS.makeEngine(sp.e, sp.intake, sp.exhaust, sp.opt), G = eng.gas, GI = eng.gasIn;
  const row = job.rows.find(r => r.rpm === rpm);
  const dx = job.dx;
  const settle = () => { let r = WS.runSpeed(eng, { rpm, cycles: 8, dx }), k = 0;
    while (k < 6) { const hh = r.history, n = hh.length; if (n >= 2 && Math.abs(hh[n - 1].ve - hh[n - 2].ve) < 0.004 * hh[n - 1].ve) break; r = WS.runSpeed(eng, { rpm, cycles: 2, dx, state: r.state }); k++; }
    return r; };
  let At = null, Ag = null, search = null;
  if (c !== 'na') { At = args.At ? +args.At / 1e6 : row.At; Ag = args.Ag != null ? +args.Ag / 1e6 : row.Ag;
    // p3x=K: the turbine's area (gate shut) for which the time-mean STATIC pressure at the turbine's face is K x boost (gauge)
    // at this speed, the efficiency held (the engine side does not depend on it beyond the gas after the turbine): the
    // calibration of part 6 (turboSimLib.calibrate) made at this speed instead of the full-boost RPM
    if (+args.p3x > 0) { Ag = 0; const tgt = 101325 + (+args.p3x) * (sp.intake.source.p - 101325), f = a => { WS.setTurbine(eng, a, 0); const q = settle(); return { e: Math.log((q.turb.p3s - 101325) / (tgt - 101325)), q }; };
      let a0 = At, a1 = At * 0.7, f0 = f(a0), f1 = f(a1), it = 2;
      while (Math.abs(f1.e) > 0.002 && it < 14) { const a2 = Math.exp(Math.log(a1) - f1.e * (Math.log(a1) - Math.log(a0)) / (f1.e - f0.e)); a0 = a1; f0 = f1; a1 = Math.min(3 * a0, Math.max(a0 / 3, a2)); f1 = f(a1); it++; }
      At = a1; search = { target: tgt, it, err: f1.e }; }
    WS.setTurbine(eng, At, Ag); }
  let r = settle();
  const src = sp.intake.source, Ts = src.T, ps = src.p;
  const at = (T, x) => WS.gas.at(G, T, x), hs = at(Ts, 1).h, hsA = WS.gas.at(GI, Ts, 1).h;
  // per step of cylinder 1 (index 0), from one IVC crossing to the next
  let rec = null, done = null, prevDone = r.state.cyls[0].done, armed = false;
  const bins = () => [...Array(720)].map(() => ({ n: 0, p: 0, T: 0, m: 0, x: 0, mIf: 0, mIb: 0, mE: 0, pPort: 0, p0Port: 0, pMouth: 0, pEx: 0, t: 0 }));
  const newRec = () => ({ steps: [], bins: bins() });
  const hook = ctx => {
    const cy = ctx.cyls[0];
    if (cy.done !== prevDone) { prevDone = cy.done; if (armed && rec) { done = rec; ctx.stop = true; } armed = true; rec = newRec(); }
    if (!rec || done) return;
    const ip = ctx.ins[0][ctx.ins[0].length - 1], i = ip.n - 1, ep = ctx.prims[0][0], mp = ctx.ins[0][0];
    const Tp = ip.p[i] / (ip.Rm[i] * ip.r[i]), u = ip.u[i], T0 = Tp + 0.5 * u * u / ip.cp[i], p0 = ip.p[i] * Math.pow(T0 / Tp, ip.g[i] / (ip.g[i] - 1));
    const th = cy.th, V1 = eng.vol((th + ctx.dth) % 720);
    rec.steps.push({ th, dt: ctx.dt, m: cy.m, T: cy.T, x: cy.x, V1, p0c: cy._p0, pdV: cy._pdV, qw: cy._qw, mI: cy._mI, hIC: cy._hIC, xIC: cy._xIC, mIp: cy._mIp, hI: cy._hI, xIp: cy._xIp,
      mE: cy._mE, hE: cy._hE, xE: cy._xE, Q: cy._Q });
    const b = rec.bins[Math.floor(th) % 720]; b.n++; b.t += ctx.dt; b.p += cy._p0 * ctx.dt; b.T += cy.T * ctx.dt; b.m += cy.m * ctx.dt; b.x += cy.x * ctx.dt;
    if (cy._mI > 0) b.mIf += cy._mI; else b.mIb -= cy._mI; b.mE += cy._mE;
    b.pPort += ip.p[i] * ctx.dt; b.p0Port += p0 * ctx.dt; b.pMouth += mp.p[0] * ctx.dt; b.pEx += ep.p[0] * ctx.dt;
  };
  // one more run with the hook until a full IVC-to-IVC cycle of cylinder 1 is recorded
  r = WS.runSpeed(eng, { rpm, cycles: 2, dx, state: r.state, hook });
  if (!done) throw new Error('no full cycle recorded at ' + rpm);
  const S = done.steps, ivo = eng.ivo, ivc = eng.ivc, bdc = 540, evc = (eng.evo + eng.evdur) % 720;
  // the state before step j (j = 0: the IVC state the cycle started from = the previous step's end state)
  const endOf = j => ({ m: S[j].m, T: S[j].T, x: S[j].x, V: S[j].V1 });
  const uOf = a => ((a - eng.ivc) % 720 + 720) % 720, idx = a => S.findIndex(s => uOf(s.th) >= uOf(a));   // first step starting at or after angle a (the cycle runs from IVC)
  const jIvo = idx(ivo), jBdc = idx(bdc), jEvc = idx(evc);
  const Hof = q => q.m * at(q.T, q.x).h, pOf = q => q.m * at(q.T, q.x).R * q.T / q.V;
  const sIvo = endOf(jIvo - 1), sBdc = endOf(jBdc - 1), sIvc = endOf(S.length - 1), sEvc = endOf(jEvc - 1);
  // sums over [ja, jb)
  const sum = (ja, jb, f) => { let s = 0; for (let j = ja; j < jb; j++) s += f(S[j]); return s; };
  const seg = (ja, jb, qa, qb) => {
    const inF = sum(ja, jb, s => s.mI > 0 ? s.mIp * (s.hI - hsA) : 0) ;               // the air (runner side) above the source's enthalpy
    const fuelT = sum(ja, jb, s => s.mI > 0 ? s.mIp * hsA - s.mI * hs : 0);          // the fuel's vapour entering at its 298.15 K datum
    const inB = sum(ja, jb, s => s.mI < 0 ? s.mI * (s.hIC - hs) : 0);                // charge pushed back into the runner
    const exO = sum(ja, jb, s => s.mE < 0 ? s.mE * (s.hE - hs) : 0), exI = sum(ja, jb, s => s.mE > 0 ? s.mE * (s.hE - hs) : 0);
    const Qw = sum(ja, jb, s => s.qw), pdV = sum(ja, jb, s => s.pdV), Qb = sum(ja, jb, s => s.Q);
    const pV = pOf(qb) * qb.V - pOf(qa) * qa.V, Vdp = pV - pdV;
    const lhs = Hof(qb) - qb.m * hs - (Hof(qa) - qa.m * hs);
    const rhs = inF + fuelT + inB + exO + exI - Qw + Vdp + Qb;
    return { inF, fuelT, inB, exO, exI, Qw, Vdp, Qb, lhs, rhs };
  };
  const A = seg(jIvo, jBdc, sIvo, sBdc), B = seg(jBdc, S.length, sBdc, sIvc), m = sIvc.m, xI = sIvc.x;
  const cpe = (at(sIvc.T, xI).h - at(Ts, xI).h) / (sIvc.T - Ts), comp = m * (at(Ts, xI).h - hs), K = v => v / (m * cpe);
  const res0 = sIvo.m * (at(sIvo.T, sIvo.x).h - hs);
  const budget = { residualAtIvo: K(res0), exOut: K(A.exO + B.exO), exIn: K(A.exI + B.exI), airIn: K(A.inF + B.inF), fuel: K(A.fuelT + B.fuelT), pushedBack: K(A.inB + B.inB),
    wall: K(-(A.Qw + B.Qw)), VdpToBdc: K(A.Vdp), VdpBdcIvc: K(B.Vdp), burn: K(A.Qb + B.Qb), composition: -K(comp) };
  const total = Object.values(budget).reduce((s, v) => s + v, 0), dT = sIvc.T - Ts;
  // closure of the exact budget (the discrete energy equation against H = U + pV): lhs = rhs per segment
  const closeErr = K((A.lhs - A.rhs) + (B.lhs - B.rhs));
  // masses: fresh delivered (net through the intake, cylinder side), short-circuited (fresh leaving by the exhaust valve), drawn back
  const fIn = sum(jIvo, S.length, s => s.mI > 0 ? s.mI * s.xIC : 0), fBack = sum(jIvo, S.length, s => s.mI < 0 ? -s.mI * s.xIC : 0);
  const fExOut = sum(0, S.length, s => s.mE < 0 ? -s.mE * s.xE : 0), fExIn = sum(0, S.length, s => s.mE > 0 ? s.mE * s.xE : 0);
  const exOutAll = sum(jIvo, S.length, s => s.mE < 0 ? -s.mE : 0), exInAll = sum(jIvo, S.length, s => s.mE > 0 ? s.mE : 0);
  const afr = sp.e.afr, fFuel = 1 / (1 + afr), fresh = m * xI, Rm = at(sIvc.T, xI).R, Rs = at(Ts, 1).R, gm = at(sIvc.T, xI).gamma;
  const Vb = eng.Vd + eng.Vc, pIvc = pOf(sIvc), pS = pIvc * Math.pow(sIvc.V / Vb, gm), TS = sIvc.T * Math.pow(sIvc.V / Vb, gm - 1);
  const mRef = ps * Vb / (Rs * Ts);
  // the knock integral from the model's own IVC, and from the isentropic back-projection is the same state (no change)
  const tr = [];   // a trace for knockLib: [th, p, T, x] of every step from this record (one cycle from IVC) twice over
  S.forEach(s => tr.push(s.th, s.p0c, null, s.x));
  // knockLib needs T at each step's start: the previous step's end
  for (let j = 0; j < S.length; j++) tr[4 * j + 2] = j ? S[j - 1].T : S[S.length - 1].T;
  const tr2 = tr.concat(tr);
  let kn = null; try { kn = KN.check(tr2, eng, rpm, { ON }); } catch (e) { kn = { err: String(e) }; }
  // 1-degree traces
  const B1 = done.bins.map((b, a) => b.n ? { a, p: b.p / b.t, T: b.T / b.t, m: b.m / b.t, x: b.x / b.t, mIf: b.mIf, mIb: b.mIb, mE: b.mE, pPort: b.pPort / b.t, p0Port: b.p0Port / b.t, pMouth: b.pMouth / b.t, pEx: b.pEx / b.t } : null).filter(Boolean);
  const mean = (f, a0, a1) => { let s = 0, t = 0; done.bins.forEach((b, a) => { const ok = a0 <= a1 ? (a >= a0 && a < a1) : (a >= a0 || a < a1); if (ok && b.t) { s += b[f]; t += b.t; } }); return s / t; };
  const ovl = [ivo, evc];   // overlap (local frame)
  const t = r.turb || null;
  const out = {
    case: c, rpm, ve: r.ve, imep: r.imep, gimep: r.gimep, bmep: r.imep - WS.tfmep(rpm), src: { p: ps, T: Ts },
    cam: { ivo: sp.e.cam.ivo, ivc: sp.e.cam.ivc, evo: sp.e.cam.evo, evc: sp.e.cam.evc, ivcLocal: ivc, ivcABDC: ivc - 540, ivoLocal: ivo, evcLocal: evc },
    Vratio: Vb / sIvc.V, ivc: { p: pIvc, T: sIvc.T, m, x: xI, R: Rm, gamma: gm }, bdc: { p: pOf(sBdc), T: sBdc.T, m: sBdc.m, x: sBdc.x },
    star: { p: pS, T: TS }, mRef, veCharge: fresh / (1 + 1 / afr) / (ps * eng.Vd / (WS.gas.at(GI, Ts, 1).R * Ts)),
    pBudget: { compression: Math.pow(Vb / sIvc.V, gm), mass: m / mRef, temp: TS / Ts, R: Rm / Rs, product: Math.pow(Vb / sIvc.V, gm) * (m / mRef) * (TS / Ts) * (Rm / Rs), pRatio: pIvc / ps },
    split: { air: fresh * (1 - fFuel), fuel: fresh * fFuel, residual: m * (1 - xI), residualFrac: 1 - xI },
    flows: { freshIn: fIn, freshBack: fBack, freshShort: fExOut, freshDrawnBack: fExIn, exOutAfterIvo: exOutAll, exInAfterIvo: exInAll, trapping: fresh / (fIn - fBack), shortFrac: fExOut / (fIn - fBack) },
    tBudget: budget, tBudgetSum: total, dT, closeErr,
    means: { pPortIn: mean('pPort', ivo, ivc), p0PortIn: mean('p0Port', ivo, ivc), pMouth: mean('pMouth', 0, 720), pPortCycle: mean('pPort', 0, 720), pExOverlap: mean('pEx', ovl[0], ovl[1]), pCylOverlap: mean('p', ovl[0], ovl[1]), pPortOverlap: mean('pPort', ovl[0], ovl[1]) },
    knock: kn && !kn.err ? { I: kn.I, Tivc: kn.Tivc, pIvc: kn.pIvc, TuEnd: kn.TuEnd, pMax: kn.pMax } : kn,
    turb: t ? { p3: t.p3, p3s: t.p3s, T3: t.T3, W: t.W, mAir: t.mAir, At, Ag, search, p3sx: (t.p3s - 101325) / (ps - 101325), p3x: (t.p3 - 101325) / (ps - 101325) } : null,
    trace: args.traces === '1' ? B1.map(q => Object.fromEntries(Object.entries(q).map(([k, v]) => [k, k === 'a' ? v : +v.toPrecision(5)]))) : undefined
  };
  return out;
}
const res = { args, job: { psi, Pt: job.Pt, Tc: job.Tc }, rows: [] };
const f = path.join(__dirname, 'results', 'ivc_' + (args.tag || 'run') + '.json');
const naP = {};
for (const c of cases) for (const rpm of rpms) {
  const t0 = Date.now(), o = run(c, rpm); res.rows.push(o);
  // brake as the page reads it under boost (part 6, F6): net IMEP - (tfmep - the NA pumping mep of the same engine and pipes)
  if (c === 'na') naP[rpm] = o.gimep - o.imep;
  if (naP[rpm] == null) { const sv = args.p3x; delete args.p3x; const q = run('na', rpm); naP[rpm] = q.gimep - q.imep; if (sv != null) args.p3x = sv; }
  const sp0 = specOf(c), e0 = sp0.e, Vd = Math.PI * e0.bore * e0.bore / 4 * e0.stroke;
  o.pmepNA = naP[rpm]; o.bmepPage = o.imep - (WS.tfmep(rpm) - naP[rpm]); o.hpPage = o.bmepPage * Vd * 4 * rpm / 120 / 745.7;
  const b = o.tBudget, P = o.pBudget;
  console.log(c + ' ' + rpm + ': IVC ' + (o.ivc.p / 1e5).toFixed(3) + ' bar ' + o.ivc.T.toFixed(1) + ' K (src ' + (o.src.p / 1e5).toFixed(3) + ' bar ' + o.src.T.toFixed(1) + ' K), IVC ' + o.cam.ivcABDC + ' ABDC, Vb/Vivc ' + o.Vratio.toFixed(4) +
    ' | BDC ' + (o.bdc.p / 1e5).toFixed(3) + ' bar ' + o.bdc.T.toFixed(1) + ' K | p* ' + (o.star.p / 1e5).toFixed(3) + ' T* ' + o.star.T.toFixed(1) +
    ' | p budget: compr ' + P.compression.toFixed(4) + ' x mass ' + P.mass.toFixed(4) + ' x T ' + P.temp.toFixed(4) + ' x R ' + P.R.toFixed(4) + ' = ' + P.product.toFixed(4) + ' (p ratio ' + P.pRatio.toFixed(4) + ')');
  console.log('   dT ' + o.dT.toFixed(1) + ' K = ' + Object.entries(b).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ') + ' (sum ' + o.tBudgetSum.toFixed(1) + ', closure ' + o.closeErr.toExponential(1) + ')');
  console.log('   resid ' + (100 * o.split.residualFrac).toFixed(2) + ' %, trapping ' + o.flows.trapping.toFixed(4) + ', short-circuit ' + (100 * o.flows.shortFrac).toFixed(2) + ' %, VE charge ' + o.veCharge.toFixed(4) + ', VE ' + o.ve.toFixed(4) +
    ' | port p in-flow ' + (o.means.pPortIn / 1e5).toFixed(3) + ' (total ' + (o.means.p0PortIn / 1e5).toFixed(3) + '), mouth ' + (o.means.pMouth / 1e5).toFixed(3) + ', overlap: exh port ' + (o.means.pExOverlap / 1e5).toFixed(3) + ' cyl ' + (o.means.pCylOverlap / 1e5).toFixed(3) + ' int port ' + (o.means.pPortOverlap / 1e5).toFixed(3) +
    (o.turb ? ' | p3 static ' + o.turb.p3sx.toFixed(3) + ' x boost, total ' + o.turb.p3x.toFixed(3) + ' x, At ' + (o.turb.At * 1e6).toFixed(0) + ' mm2, Ag ' + (o.turb.Ag * 1e6).toFixed(0) : '') + ' | hp ' + o.hpPage.toFixed(1) +
    ' | I ' + (o.knock && o.knock.I != null ? o.knock.I.toFixed(3) : '-') + ' bmep ' + (o.bmep / 1e5).toFixed(2) + ' bar (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
  fs.writeFileSync(f, JSON.stringify(res));
}
console.log('wrote ' + f);
