// The page's wave model on stock engines from its cam library (CAM_LIB in web/index.html) against their published
// ratings (the truth test of the absolute torque; OpenWAM is only a cross-check). Each engine is run the way the
// 4-Stroke tab runs it (simSpec's assumptions: rod 1.7 x stroke, valve Cd 0.7, a 300 mm open intake runner of
// sqrt(0.6 n) x the valve diameter, Wiebe 18 deg BTDC / 55 deg, AFR 12.8), one bank of four cylinders of the cross-plane
// V8 (firing 1-8-7-2-6-5-4-3: the left bank fires at 0, 180, 450, 630 deg) on a long-tube 4-1 header open to the air:
// 150 mm port (marked port: true since part 7: the head's port law; e.portHeat='"off"' gives the runs before) + 610 mm
// primary at 44.5 mm (1-3/4 in ID, 1-7/8 in tube), a 130 mm cone from 89 mm (four primaries' area)
// to a 76 mm (3 in) collector 300 mm long. Torque = the bank's mean IMEP x the engine's displacement / 4 pi.
//   node ratings.js [engines=ls3,ls7,lt1] [tag=name] [rpms=3000:6600:200] [k=v ...]   k: e.* overrides (JSON values),
//        intakeL=m  primL=m  coll=m  pIn=Pa (the intake mouth's pressure: an intake loss)  tail=m (a 63.5 mm tail pipe after
//        the 76 mm collector)  (one change at a time for the sensitivity runs)
// 2026-11-12 part 3 (docs/WAVE_VALIDATION_2026-11-11.md, C sections):
//   flow=bench    the valves' effective areas from the engine's own flow-bench curve (CAM_LIB flow: cfm at 28 in H2O ->
//                 Cd A by the isentropic orifice law, WS.benchCdA); flow=family: the LS3's measured Cd on the curtain
//                 pi D L against L/D, applied at this engine's valve sizes (for an engine with no curve of its own)
//   whole=1       the whole engine: both banks (8 cylinders, firing 1-8-7-2-6-5-4-3, odd cylinders on the left bank), each
//                 bank on its own 4-1 header as above; with open runners the banks do not interact
//   intake=plenum every runner from one plenum fed through a throttle body from an inlet tube (implies whole=1):
//                 plv=L (plenum volume; default half the displacement, the Intake tab's rule for an unknown plenum: an
//                 ASSUMPTION), tbd=mm (throttle bore; default the stock bore from STOCK_TB), tcd= (Cd x bore area at wide
//                 open; default 0.828, measured on a stock GM 87 mm LT throttle body: 916 cfm at 20 in H2O), itl=mm itd=mm
//                 (inlet tube, filter to throttle; default the page's 600 and 101.6: ASSUMPTIONS), fdp=Pa (air filter loss at
//                 the flow fm=kg/s; default 0 = no filter, an open mouth; fm default: the engine's air at VE 1 at the rated
//                 power speed)
// Per speed it records net IMEP (the model's own), gross IMEP (p dV from BDC before firing to BDC after: 540-720 and
// 0-180 deg of each cylinder's frame), the pumping loop (gross - net), the heat released and the in-cylinder wall heat
// (Woschni) per cycle, the fuel's chemical energy (trapped air / AFR x 44 MJ/kg), and, when the page has it, the brake
// torque from WS.tfmep (the friction law on the page, taken off the gross loop). Results: results/ratings_<tag>.json.
'use strict';
const fs = require('fs'), path = require('path');
const { load, PAGE } = require('./lib');
let args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const WS = load({ hook: true });
const html = fs.readFileSync(PAGE, 'utf8');
const lib = (() => {
  const a = html.indexOf('const CAM_LIB=['), z = html.indexOf('];', a);
  const camEvents = (di, de, lsa, adv) => { adv = adv || 0; const icl = lsa - adv, ecl = lsa + adv; return { ivo: di / 2 - icl, ivc: icl + di / 2 - 180, evo: ecl + de / 2 - 180, evc: de / 2 - ecl }; };
  const straightUp = (di, de, lsa) => camEvents(di, de, lsa, 0);
  return new Function('camEvents', 'straightUp', 'return ' + html.slice(a + 'const CAM_LIB='.length, z + 1) + ';')(camEvents, straightUp);
})();
// the ratings (crank, SAE): from the library's own 'rated' text, checked by hand against it here
const RATED = {
  ls3: { hp: 430, hpRpm: 5900, lbft: 425, tqRpm: 4600 },
  ls7: { hp: 505, hpRpm: 6300, lbft: 470, tqRpm: 4800 },
  lt1: { hp: 455, hpRpm: 6000, lbft: 460, tqRpm: 4600 }
};
const engines = (args.engines || 'ls3,ls7,lt1').split(',');
const [r0, r1, rs] = (args.rpms || '3000:6600:200').split(':').map(Number);
const rpms = []; for (let r = r0; r <= r1 + 1e-9; r += rs) rpms.push(r);
const IN = 0.0254;
// stock throttle bores (mm): LS3 and LS7 90 mm (GM 12605109 / Chevrolet Performance 19420707, "LS3/LS7 90mm"), LT1 87 mm
// (GM 12729495, "87mm Throttle Body LT1"); URLs in docs/WAVE_VALIDATION_2026-11-11.md C4
const STOCK_TB = { ls3: 90, ls7: 90, lt1: 87 };
// the bench law: a table of {lift (m), cdA (m2 per valve)} from cfm at dp in H2O
const benchTab = (lift, cfm, dp) => ({ lift: lift.map(l => l * IN), cdA: cfm.map(q => WS.benchCdA(q, dp)) });
// the LS3's measured Cd on the curtain (pi D L) against L/D, applied at another valve diameter (flow=family)
function familyTab(D, which) {
  const ls3 = lib.find(x => x.k === 'ls3'), d3 = ls3.valves[which === 'in' ? 0 : 1] * IN, t = benchTab(ls3.flow.lift, ls3.flow[which], ls3.flow.dp);
  return { lift: t.lift.map(l => l * D / d3), cdA: t.cdA.map((a, i) => a / (Math.PI * d3 * t.lift[i]) * Math.PI * D * (t.lift[i] * D / d3)) };
}
function specOf(c) {
  const B = c.bore * IN, S = c.stroke * IN, dIn = c.valves[0] * IN, dEx = c.valves[1] * IN;
  const e = { bore: B, stroke: S, rod: 1.7 * S, cr: c.cr, cd: 0.7, nIn: 1, dIn, liftIn: c.lift[0] * IN, nEx: 1, dEx, liftEx: c.lift[1] * IN,
    cam: Object.assign({}, c.cam, { checkLift_mm: 1.27 }), burn: { start: 18, dur: 55 }, afr: 12.8, eta: 0.72 };
  if (args.flow === 'bench') {
    if (!c.flow) throw new Error(c.k + ' has no flow-bench curve in CAM_LIB (try flow=family)');
    e.flowIn = benchTab(c.flow.lift, c.flow.in, c.flow.dp); e.flowEx = benchTab(c.flow.lift, c.flow.ex, c.flow.dp);
  } else if (args.flow === 'family') { e.flowIn = familyTab(dIn, 'in'); e.flowEx = familyTab(dEx, 'ex'); }
  else if (args.flow === 'benchfam') {     // the engine's own curve where it has one, else the LS3's Cd(L/D)
    if (c.flow) { e.flowIn = benchTab(c.flow.lift, c.flow.in, c.flow.dp); e.flowEx = benchTab(c.flow.lift, c.flow.ex, c.flow.dp); }
    else { e.flowIn = familyTab(dIn, 'in'); e.flowEx = familyTab(dEx, 'ex'); }
  } else if (args.flow) throw new Error('flow= bench, family or benchfam');
  for (const k of Object.keys(args)) if (k.startsWith('e.')) { const ks = k.slice(2).split('.'); let o = e; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = JSON.parse(args[k]); }
  const dI = Math.sqrt(0.6) * dIn, pl = +(args.primL || 0.61), cl = +(args.coll || 0.3);
  const csegs = [{ L: 0.13, d0: 0.089, d1: 0.0762 }, { L: cl, d0: 0.0762, d1: 0.0762 }].concat(args.tail ? [{ L: +args.tail, d0: 0.0635, d1: 0.0635 }] : []);
  const spec = { e, intake: { segs: [{ L: +(args.intakeL || 0.3), d0: dI, d1: dI }], Tw: 320 },
    exhaust: { segs: [{ L: 0.15, d0: 0.0445, d1: 0.0445, primary: true, port: true }, { L: pl, d0: 0.0445, d1: 0.0445, primary: true }], Tw: 700, chambers: [] },
    opt: { phases: [0, 180, 450, 630], collector: { segs: csegs, Tw: 650 } } };
  if (args.whole === '1' || args.intake === 'plenum') {
    // cylinders 1..8 fire at 90 deg x their place in 1-8-7-2-6-5-4-3; odd cylinders (indices 0, 2, 4, 6) on the left bank
    const order = [1, 8, 7, 2, 6, 5, 4, 3], ph = new Array(8);
    order.forEach((cy, slot) => { ph[cy - 1] = 90 * slot; });
    spec.opt = { phases: ph, collectors: [{ cyls: [0, 2, 4, 6], segs: csegs, Tw: 650 }, { cyls: [1, 3, 5, 7], segs: JSON.parse(JSON.stringify(csegs)), Tw: 650 }] };
  }
  // back=Pa (part 7): the tail ends discharge into the atmosphere + back (a stand-in for the stock exhaust's catalysts and mufflers)
  if (+args.back > 0) spec.exhaust.pOut = 101325 + +args.back;
  if (args.intake === 'plenum') {
    const Vtot = Math.PI / 4 * B * B * S * c.cyl, tbd = (+args.tbd || STOCK_TB[c.k]) / 1000, itd = (+args.itd || 101.6) / 1000;
    const R = RATED[c.k], fm = +args.fm || (R ? 1.1839 * Vtot * R.hpRpm / 120 : 0);   // dry air at 298.15 K, 1 atm, VE 1
    spec.intake.plenum = { V_m3: args.plv ? +args.plv / 1000 : 0.5 * Vtot, inlet: [{ L: (+args.itl || 600) / 1000, d0: itd, d1: itd }],
      throttle: { d: tbd, cd: args.tcd ? +args.tcd : 0.828 } };
    if (+args.fdp > 0) spec.intake.plenum.filter = { dp: +args.fdp, m: fm };
  }
  return spec;
}
function main() {
const out = { page: path.relative(path.resolve(__dirname, '..', '..', '..'), PAGE), args, rpms, engines: {} };   // relative: no local paths in the results
for (const k of engines) {
  const c = lib.find(x => x.k === k); if (!c) throw new Error('no CAM_LIB entry ' + k);
  const spec = specOf(c), eng = WS.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt), N = eng.phases.length;
  const Vtot = eng.Vd * c.cyl, t0 = Date.now(), rows = [];
  let state = null;
  for (let i = 0; i < rpms.length; i++) {
    const rpm = rpms[i];
    // per cycle (cylinder 1's frame, from IVC): gross work, heat released, wall heat, fuel energy of each cylinder
    let acc = null; const cyc = [];
    const hook = ctx => {
      if (!acc) acc = ctx.cyls.map(() => ({ g: 0, Q: 0, qw: 0 }));
      ctx.cyls.forEach((cy, j) => { const a = acc[j]; const tk = cy.th; if (tk >= 540 || tk < 180) a.g += cy._pdV; a.Q += cy._Q; a.qw += cy._qw;
        if (cy._lastDone !== cy.done && cy.done) { cy._lastDone = cy.done; cyc.push({ j, g: a.g, Q: a.Q, qw: a.qw, fuel: cy.done.ve * (WS.PATM / (287.1 * WS.TATM)) * eng.Vd / spec.e.afr * 44e6, imep: cy.done.imep }); a.g = 0; a.Q = 0; a.qw = 0; } });
    };
    const pIn = args.pIn ? +args.pIn : undefined;
    let r = WS.runSpeed(eng, { rpm, cycles: i === 0 ? 8 : 3, dx: 0.0125, state, hook, pIn });
    for (let x = 0; x < 5; x++) { const h = r.history, n = h.length; if (n >= 2 && Math.abs(h[n - 1].ve - h[n - 2].ve) < 0.004 * h[n - 1].ve) break; r = WS.runSpeed(eng, { rpm, cycles: 2, dx: 0.0125, state: r.state, hook, pIn }); }
    state = r.state;
    const last = cyc.slice(-N), mean = f => last.reduce((s, q) => s + q[f], 0) / last.length;
    const gross = mean('g') / eng.Vd, Q = mean('Q'), qw = mean('qw'), fuel = mean('fuel');
    // brake: the page's friction law (WS.tfmep, off the gross loop; the model's own gross IMEP when it reports one)
    const tq = r.imep * Vtot / (4 * Math.PI), fm = WS.tfmep ? { fmep: WS.tfmep(rpm) } : null, g = r.gimep != null ? r.gimep : gross;
    const brk = fm ? (g - fm.fmep) * Vtot / (4 * Math.PI) : null;
    rows.push({ rpm, ve: r.ve, imep: r.imep, gross, gimep: r.gimep, pump: gross - r.imep, Q, qw, fuel, qwFrac: qw / fuel, qFrac: Q / fuel, tEx: r.tEx, pmax: r.pmax,
      tq, kw: tq * rpm * Math.PI / 30 / 1000, fmep: fm ? fm.fmep : null, tqB: brk, kwB: brk == null ? null : brk * rpm * Math.PI / 30 / 1000 });
    process.stderr.write(k + ' ' + rpm + ': VE ' + r.ve.toFixed(3) + ' NMEP ' + (r.imep / 1e5).toFixed(2) + ' bar, gross ' + (gross / 1e5).toFixed(2) + ', wall heat ' + (100 * qw / fuel).toFixed(1) + ' % of fuel (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)\n');
  }
  const pk = (f, g) => rows.reduce((b, q) => (q[f] != null && (b == null || q[f] > b[f]) ? q : b), null);
  const R = RATED[k] || null, LB = 1 / 1.3558179, HP = 1 / 0.74569987;
  const sum = { rated: R, indicated: { tq: pk('tq'), pw: pk('kw') }, brake: rows[0].tqB == null ? null : { tq: pk('tqB'), pw: pk('kwB') } };
  out.engines[k] = { name: c.name, assumed: !!c.assumed, spec, rows, summary: {
    tqInd: sum.indicated.tq.tq * LB, tqIndRpm: sum.indicated.tq.rpm, hpInd: sum.indicated.pw.kw * 1000 * HP / 1000, hpIndRpm: sum.indicated.pw.rpm,
    tqBrk: sum.brake ? sum.brake.tq.tqB * LB : null, tqBrkRpm: sum.brake ? sum.brake.tq.rpm : null,
    hpBrk: sum.brake ? sum.brake.pw.kwB * HP : null, hpBrkRpm: sum.brake ? sum.brake.pw.rpm : null, rated: R } };
  const s = out.engines[k].summary;
  process.stderr.write(k + ': indicated ' + s.tqInd.toFixed(0) + ' lb-ft @ ' + s.tqIndRpm + ', ' + s.hpInd.toFixed(0) + ' hp @ ' + s.hpIndRpm +
    (s.tqBrk != null ? '; brake ' + s.tqBrk.toFixed(0) + ' lb-ft @ ' + s.tqBrkRpm + ', ' + s.hpBrk.toFixed(0) + ' hp @ ' + s.hpBrkRpm : '') +
    (R ? '; rated ' + R.lbft + ' lb-ft @ ' + R.tqRpm + ', ' + R.hp + ' hp @ ' + R.hpRpm : '') + '\n');
}
const f = path.join(__dirname, 'results', 'ratings_' + (args.tag || 'run') + '.json');
fs.writeFileSync(f, JSON.stringify(out));
process.stderr.write('wrote ' + f + '\n');
}
// energy_balance.js (part 7) builds the same engines: specOf with its own arguments
if (require.main === module) main();
else module.exports = { specOf: (c, a) => { const keep = args; args = a; try { return specOf(c); } finally { args = keep; } }, lib, RATED, WS };
