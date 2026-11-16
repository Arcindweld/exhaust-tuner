// K-series sourced data (docs/WAVE_VALIDATION_2026-11-11.md, part 14, N sections): the K24A2 runs of parts 12-13 again with
// what part 14 could cite, one change at a time, on the page's own wave model (lib.js through knock_run.js) and knockLib.
//   na:    the K24A2 without boost (part 12's naOf: the 18 psi build's pipes open to the air), brake torque and power the
//          page's way (gross indicated less Heywood's tfmep) against Honda's 200 hp @ 6800 / 166 lb-ft @ 4500:
//          before (rod 1.7 x stroke, the 300 mm open runner), rod 152.019 mm, + the RBC manifold (185 mm runner + the
//          100 mm stand-in port, 1720 cc plenum, 62 mm throttle at 0.83, the page's placeholder 600 x 101.6 mm inlet tube),
//          + the best intake cam advance of 0, 5, ..., 25 deg at each speed (the K24A2's 25 deg phaser);
//   turbo: the 18 psi pump-gas job of part 12 (results/knock_k24_jobs.json, the turbine's and gate's areas held per speed)
//          before / with the rod: VE on the charge, the IVC state, the knock integral (ON 95), gross-less-friction power; and
//          the same without boost (the integral "at the limit" in part 13).
//   node tools/validation/wave/kseries_val.js part=na|turbo [rpms=...]   -> results/kseries_<part>.json
'use strict';
const fs = require('fs'), path = require('path');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const { WS, KN, runOne } = require('./knock_run');
const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'knock_k24_jobs.json'), 'utf8'));
const J18 = jobs.find(j => Math.abs(j.psi - 18) < 0.01 && j.fuel === 'pump').S;
const naOf = sp => ({ e: sp.e, intake: Object.assign({}, sp.intake, { source: { p: 101325, T: 298.15 } }),
  exhaust: { segs: sp.exhaust.segs, Tw: sp.exhaust.Tw, pOut: sp.exhaust.turbine.pOut },
  opt: { phases: sp.opt.phases, collector: { segs: sp.opt.collector.segs.concat(sp.exhaust.turbine.down.segs), Tw: sp.opt.collector.Tw } } });
const ROD = 0.152019, ON = 95, LBFT = 0.737562, HP = 745.7;
const clone = x => JSON.parse(JSON.stringify(x));
const withRod = sp => { const s = clone(sp); s.e.rod = ROD; return s; };
const withVtc = (sp, a) => { const s = clone(sp); s.e.cam.ivo += a; s.e.cam.ivc -= a; return s; };
// the RBC on the page (kManiFill + simSpec): runner 185 + 100 mm (the last 100 mm the head's port), the plenum fed through the throttle
function withRbc(sp) { const s = clone(sp), d = s.intake.segs[0].d0;
  s.intake.segs = [{ L: 0.185, d0: d, d1: d }, { L: 0.100, d0: d, d1: d, port: true }];
  s.intake.plenum = { V_m3: 1720e-6, inlet: [{ L: 0.6, d0: 0.1016, d1: 0.1016 }, { L: 0.05, d0: 0.062, d1: 0.062 }], throttle: { d: 0.062, cd: 0.83 } };
  return s; }
const ncyl = sp => sp.opt.phases.length;
function one(sp, rpm, o) {
  const { eng, r } = runOne(sp, rpm, o || { dx: J18.dx }), Vd = eng.Vd * ncyl(sp), f = WS.tfmep(rpm);
  const tqB = (r.gimep - f) * Vd / (4 * Math.PI), k = KN.check(r.trace, eng, rpm, { ON });
  const Pt = sp.intake.source.p, Tc = sp.intake.source.T;
  return { rpm, ve: r.ve, veCharge: r.ve * (101325 / 298.15) / (Pt / Tc), resid: r.resid, imep: r.imep, gimep: r.gimep, tqB_Nm: tqB, tqB_lbft: tqB * LBFT, hpB: tqB * rpm * Math.PI / 30 / HP,
    pIvc: k && k.pIvc, Tivc: k && k.Tivc, I: k && k.I, pMax: r.pmax };
}
const out = {}, file = p => path.join(__dirname, 'results', 'kseries_' + p + '.json');
const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(0) + ' s', ...a);
const pk = rows => { const p = rows.reduce((b, r) => r.hpB > b.hpB ? r : b, rows[0]), t = rows.reduce((b, r) => r.tqB_Nm > b.tqB_Nm ? r : b, rows[0]);
  return { hp: p.hpB, hpRpm: p.rpm, tq_lbft: t.tqB_lbft, tqRpm: t.rpm }; };
if (args.part === 'na') {
  const rpms = (args.rpms || '2500,3500,4500,5000,5500,6000,6500,6800,7100').split(',').map(Number);
  const base = naOf(J18.spec), cases = [['before', base], ['rod', withRod(base)], ['rod_rbc', withRbc(withRod(base))]];
  for (const [k, sp] of cases) { out[k] = rpms.map(r => one(sp, r)); out[k + '_peak'] = pk(out[k]); log(k, JSON.stringify(out[k + '_peak'])); fs.writeFileSync(file('na'), JSON.stringify(out, null, 1)); }
  // the best advance at each speed (rod + RBC), as the page's "best advance" option: 0, 5, ..., 25 deg
  const set = [0, 5, 10, 15, 20, 25]; out.vtc = {};
  for (const a of set) { out.vtc[a] = rpms.map(r => one(withVtc(withRbc(withRod(base)), a), r)); log('vtc', a, JSON.stringify(pk(out.vtc[a]))); fs.writeFileSync(file('na'), JSON.stringify(out, null, 1)); }
  out.vtc_best = rpms.map((r, i) => { let b = set[0]; set.forEach(a => { if (out.vtc[a][i].tqB_Nm > out.vtc[b][i].tqB_Nm) b = a; }); return Object.assign({ adv: b }, out.vtc[b][i]); });
  out.vtc_best_peak = pk(out.vtc_best); log('vtc best', JSON.stringify(out.vtc_best_peak), out.vtc_best.map(x => x.rpm + ':' + x.adv).join(' '));
  fs.writeFileSync(file('na'), JSON.stringify(out, null, 1));
}
if (args.part === 'turbo') {
  const rpms = (args.rpms || '3500,5050,6600,7100').split(',').map(Number), row = rpm => J18.rows.find(r => r.rpm === rpm);
  for (const [k, sp] of [['b18_before', J18.spec], ['b18_rod', withRod(J18.spec)], ['na_before', naOf(J18.spec)], ['na_rod', withRod(naOf(J18.spec))]]) {
    out[k] = rpms.map(r => { const w = row(r), o = /^b18/.test(k) ? { At: w.At, Ag: w.Ag, dx: J18.dx } : { dx: J18.dx }; const x = one(sp, r, o); log(k, r, 'VEc', x.veCharge.toFixed(3), 'IVC', (x.pIvc / 1e5).toFixed(3), x.Tivc.toFixed(1), 'I', x.I.toFixed(3), 'hp', x.hpB.toFixed(1)); return x; });
    fs.writeFileSync(file('turbo'), JSON.stringify(out, null, 1)); }
}
