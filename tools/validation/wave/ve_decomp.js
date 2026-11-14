// Volumetric efficiency of the page's wave model taken apart (docs/WAVE_VALIDATION_2026-11-11.md, part 8, H sections).
// The engines are ratings.js's realistic case (whole engine, plenum, throttle, measured head flow, 150 mm exhaust port:
// intake=plenum flow=benchfam), every ratings.js argument passes through (e.* overrides, fdp=, back=, intakeL= ...).
// The model's VE (trapped fresh air at intake closing against dry air at 298.15 K and 101.325 kPa filling the
// displacement) is the exact product
//   VE = (V_ivc / Vd) x (p_ivc / p_ref) x (T_ref / T_ivc) x (R_air / R_mix) x x_fresh x f_air
// of the cylinder's state at IVC (volume, pressure, temperature, the mixture's R, its fresh fraction x and the fresh
// charge's air fraction by mass), so each factor is one cause: the geometry and valve timing, the pressure the runner and
// its waves leave in the cylinder, the charge's heating (walls and residual), the fuel vapour's and the residual's
// effect on R, the residual's dilution, the fuel's mass. Per speed it also records, over the last settled cycle:
// the mass-averaged stagnation temperature of the air entering through the intake valve (port and runner heating), the
// heat the cylinder walls gave the charge while the intake valve was open, the air pushed back into the runner, the
// exhaust gas drawn back into the cylinder, the plenum's mean pressure, and the mass-averaged runner-end pressure while
// air flows in.
// Extra arguments (one change at a time for part 8's experiments):
//   amb=j1349, exdp=Pa, portIn=m|ls3cc, acckw=   ratings.js's (part 8: J1349's atmosphere, a tail restriction, the head's intake port)
//   inTw=K         every intake pipe's wall temperature (ratings.js: 320 K)
//   portInL=m portInTw=K   the runner's last portInL before the valve (the head's intake port) at its own wall temperature
//   chk=tappet     the cam card's 0.050 in read as tappet lift: the check lift at the valve is 0.050 in x the rocker ratio
//                  (rocker=, default 1.7)
//   fuel=air       part 1's charge (no fuel vapour in the gas)
//   fuel=premix    the fuel's vapour already in the intake's gas (fully evaporated upstream: an upper bound of its displacement; WS_PATCHES=results/patch_premix.json)
//   node ve_decomp.js [engines=ls3] [rpms=3000,4600,5800] [tag=name] [...]   -> results/ve_<tag>.json
'use strict';
const fs = require('fs'), path = require('path');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const R = require('./ratings.js'), WS = R.WS;
const engines = (args.engines || 'ls3').split(','), rpms = (args.rpms || '3000,4600,5800').split(',').map(Number);
const base = Object.assign({ intake: 'plenum', flow: 'benchfam' }, args);
function specFor(c) {
  const spec = R.specOf(c, base);
  if (+args.inTw > 0) spec.intake.Tw = +args.inTw;
  if (args.chk === 'tappet') spec.e.cam.checkLift_mm = 1.27 * +(args.rocker || 1.7);
  if (args.fuel === 'air') spec.e.fuel = 'air';
  if (args.fuel === 'premix') { if (!process.env.WS_PATCHES) throw new Error('fuel=premix needs WS_PATCHES=results/patch_premix.json'); spec.e.fuel = 'premix'; }
  if (+args.portInL > 0) {   // split the runner: the port part slightly different in bore (1e-5) so buildLine makes it its own pipe
    const s = spec.intake.segs, L = s[0].L, d = s[0].d0, pl = +args.portInL;
    spec.intake.segs = [{ L: L - pl, d0: d, d1: d }, { L: pl, d0: d * (1 + 1e-5), d1: d * (1 + 1e-5) }];
  }
  return spec;
}
function run(c) {
  const spec = specFor(c), eng = WS.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt), N = eng.phases.length, G = eng.gas, GI = eng.gasIn;
  const pRef = WS.PATM, Tref = WS.TATM, Rair = G ? G.Rair : WS.RG, fa = G ? G.fa : 1;
  let state = null; const rows = [], t0 = Date.now();
  for (let i = 0; i < rpms.length; i++) {
    const rpm = rpms[i];
    if (!state) { state = WS.freshState(eng, 0.0125);
      if (+args.portInL > 0) state.ins.forEach(L => { L[L.length - 1].Tw = +(args.portInTw || spec.intake.Tw); }); }
    let r = WS.runSpeed(eng, { rpm, cycles: i === 0 ? 8 : 3, dx: 0.0125, state });
    for (let x = 0; x < 5; x++) { const h = r.history, n = h.length; if (n >= 2 && Math.abs(h[n - 1].ve - h[n - 2].ve) < 0.004 * h[n - 1].ve) break; r = WS.runSpeed(eng, { rpm, cycles: 2, dx: 0.0125, state: r.state }); }
    // one measured cycle
    const acc = [...Array(N)].map(() => ({ mIn: 0, hIn: 0, xIn: 0, mBack: 0, qIn: 0, mExBack: 0, pv: 0, ivc: null }));
    let plP = 0, tt = 0;
    const hook = ctx => {
      tt += ctx.dt; if (ctx.PL) plP += ctx.PL.p * ctx.dt;
      ctx.cyls.forEach((cy, k) => {
        const a = acc[k], open = eng.CdAin(cy.th) > 0;
        if (cy._mIp > 0) { a.mIn += cy._mIp; a.hIn += cy._mIp * cy._hI; a.xIn += cy._mIp * cy._xIp; const ip = ctx.ins[k][ctx.ins[k].length - 1]; a.pv += cy._mIp * ip.p[ip.n - 1]; }
        else if (cy._mIp < 0) a.mBack -= cy._mIp;
        if (open) a.qIn -= cy._qw;
        if (cy._mE > 0) a.mExBack += cy._mE;
        if (cy.done && cy.done !== a.lastDone) { a.lastDone = cy.done;
          if (a.armed) a.ivc = { V: cy.ivcV, p: cy.ivcP, T: cy.ivcT, x: cy.x, R: G ? WS.gas.at(G, cy.ivcT, cy.x).R : WS.RG, m: cy.m, ve: cy.done.ve, mIn: a.mIn, hIn: a.hIn, xIn: a.xIn, mBack: a.mBack, qIn: a.qIn, mExBack: a.mExBack, pv: a.pv };
          a.armed = true; a.mIn = a.hIn = a.xIn = a.mBack = a.qIn = a.mExBack = a.pv = 0; }
      });
    };
    acc.forEach(a => { a.lastDone = null; a.armed = false; });
    // prime: mark the current done objects so the first IVC seen only arms the counters
    r.state.cyls.forEach((cy, k) => { acc[k].lastDone = cy.done; });
    r = WS.runSpeed(eng, { rpm, cycles: 2, dx: 0.0125, state: r.state, hook });
    state = r.state;
    const cs = acc.map(a => a.ivc).filter(Boolean);
    if (!cs.length) throw new Error('no full cycle measured at ' + rpm);
    const mean = f => cs.reduce((s, q) => s + f(q), 0) / cs.length;
    const fV = mean(q => q.V / eng.Vd), fp = mean(q => q.p / pRef), fT = mean(q => Tref / q.T), fR = mean(q => Rair / q.R), fx = mean(q => q.x);
    const prod = mean(q => (q.V / eng.Vd) * (q.p / pRef) * (Tref / q.T) * (Rair / q.R) * q.x * fa);
    // the same charge taken isentropically (frozen gamma at IVC) to the BDC volume Vd + Vc: the pressure and temperature it would
    // have there (p* and T*; the product with Vb / Vd is still the VE exactly, since p V / T is unchanged): the ram and wave
    // pressure net of losses, and the charge's heating, without the compression after BDC that late closing adds
    const Vb = eng.Vd + eng.Vc, gam = q => G ? WS.gas.at(G, q.T, q.x).gamma : WS.GAM;
    const fVb = Vb / eng.Vd, fpS = mean(q => q.p * Math.pow(q.V / Vb, gam(q)) / pRef), fTS = mean(q => Tref / (q.T * Math.pow(q.V / Vb, gam(q) - 1)));
    const Tin = mean(q => q.mIn > 0 ? WS.gas.T(GI, q.hIn / q.mIn, Math.min(1, q.xIn / q.mIn), 300, true) : NaN);
    const cpA = WS.gas.at(GI, 320, 1).cp;
    const row = { rpm, ve: r.ve, veIvc: mean(q => q.ve), prod, fV, fp, fT, fR, fx, fa, fVb, fpS, fTS, TS: Tref / fTS, pIvc: mean(q => q.p), Tivc: mean(q => q.T), resid: mean(q => 1 - q.x),
      TinStag: Tin, backFrac: mean(q => q.mBack / (q.m * q.x * fa)), exBackFrac: mean(q => q.mExBack / q.m), qIn: mean(q => q.qIn),
      dTwall: mean(q => q.qIn / (q.m * cpA)), pRunner: mean(q => q.mIn > 0 ? q.pv / q.mIn : NaN), pPlen: tt > 0 && plP > 0 ? plP / tt : null,
      imep: r.imep, gimep: r.gimep, tqB: WS.tfmep ? (r.gimep - WS.tfmep(rpm)) * eng.Vd * c.cyl / (4 * Math.PI) / 1.3558179 : null };
    rows.push(row);
    process.stderr.write(c.k + ' ' + rpm + ': VE ' + row.ve.toFixed(4) + ' (prod ' + row.prod.toFixed(4) + ') = V ' + fV.toFixed(4) + ' p ' + fp.toFixed(4) + ' T ' + fT.toFixed(4) + ' R ' + fR.toFixed(4) +
      ' x ' + fx.toFixed(4) + ' fa ' + fa.toFixed(4) + ' | at BDC volume: p* ' + fpS.toFixed(4) + ' T* ' + (Tref / fTS).toFixed(1) + ' K | Tin ' + Tin.toFixed(1) + ' K, dTwall ' + row.dTwall.toFixed(1) + ' K, back ' + (100 * row.backFrac).toFixed(1) + ' %, exBack ' + (100 * row.exBackFrac).toFixed(1) +
      ' %, pRun ' + (row.pRunner / 1000).toFixed(2) + ' kPa, pPlen ' + (row.pPlen ? (row.pPlen / 1000).toFixed(2) : '-') + ' | brake ' + (row.tqB ? row.tqB.toFixed(1) : '-') + ' lb-ft (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)\n');
  }
  return { name: c.name, rows };
}
const out = { args, rpms, engines: {} };
for (const k of engines) { const c = R.lib.find(x => x.k === k); if (!c) throw new Error('no CAM_LIB entry ' + k); out.engines[k] = run(c); }
const f = path.join(__dirname, 'results', 've_' + (args.tag || 'run') + '.json');
fs.writeFileSync(f, JSON.stringify(out, null, 1));
process.stderr.write('wrote ' + f + '\n');
