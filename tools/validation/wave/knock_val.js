// The knock estimate's validation (docs/WAVE_VALIDATION_2026-11-11.md part 12, L4-L7): the page's wave model and knockLib
// on (b) two naturally aspirated stock engines (the K24A2 with the turbo build's pipes open to the air, the LS3 as ratings.js
// builds it), (c) trends (charge temperature, compression ratio, boost, octane, retard), (d) the K24A2 + PT5862 jobs of
// knock_k24.js: the integral at the page's timing per speed, the timing retard that brings it to 1 and its cost, and the
// knock-limited boost from scaling the 18 psi trace against full runs at 10 and 25.9 psi.
//   node tools/validation/wave/knock_val.js [parts=b,c,d]      writes results/knock_val.json
'use strict';
const fs = require('fs'), path = require('path');
const { WS, KN, runOne, withStart } = require('./knock_run');
const parts = (process.argv[2] || 'parts=b,c,d').replace('parts=', '').split(',');
const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'knock_k24_jobs.json'), 'utf8'));
const out = fs.existsSync(path.join(__dirname, 'results', 'knock_val.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'knock_val.json'), 'utf8')) : {};
const save = () => fs.writeFileSync(path.join(__dirname, 'results', 'knock_val.json'), JSON.stringify(out, null, 1));
// octane numbers (L1): 91 AKI pump premium as RON 95 (ORNL/TM-2016/42's 93 AKI / 97 RON pair, S = 8 held), 93 AKI RON 97,
// E85 RON 104 (Sunoco E85-R; Kasseris's fitted effective number 115 as the other end)
const ON = { p91: 95, p93: 97, e85: 104, e85eff: 115 };
const f = WS.tfmep;
const ev = (spec, rpm, o, start) => { const s = start != null ? withStart(spec, start) : spec, { eng, r } = runOne(s, rpm, o);
  const c = {}; for (const k of Object.keys(ON)) c[k] = KN.check(r.trace, eng, rpm, { ON: ON[k] });
  return { rpm, start: s.e.burn.start, imep: r.imep, bmep: r.imep - f(rpm), ve: r.ve, I: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.I])), ca50: c.p91.ca50, Tivc: c.p91.Tivc, pIvc: c.p91.pIvc, TuEnd: c.p91.TuEnd, pMax: c.p91.pMax, knockAt91: c.p91.knockAt, trace: r.trace, eng }; };
const strip = x => { const o = Object.assign({}, x); delete o.trace; delete o.eng; return o; };
// the latest start of burn (deg BTDC) that keeps I(key) below thr: bisection in [s0 - 40, s0]
function retard(spec, rpm, o, key, thr, s0) {
  const base = ev(spec, rpm, o, s0); if (base.I[key] < thr) return { base: strip(base), lim: strip(base), dCA: 0, loss: 0 };
  let lo = s0 - 40, hi = s0, rl = ev(spec, rpm, o, lo); if (rl.I[key] >= thr) return { base: strip(base), lim: null };
  for (let i = 0; i < 9; i++) { const m = 0.5 * (lo + hi), r = ev(spec, rpm, o, m); if (r.I[key] < thr) { lo = m; rl = r; } else hi = m; }
  return { base: strip(base), lim: strip(rl), dCA: s0 - lo, loss: 1 - rl.bmep / base.bmep };
}
// MBT: the start of burn of the most net IMEP (a parabola through the best of a 4-degree sweep and its neighbours)
function mbt(spec, rpm, o) {
  const st = [6, 10, 14, 18, 22, 26, 30, 34], rs = st.map(s => ev(spec, rpm, o, s)), i = rs.reduce((b, r, k) => r.imep > rs[b].imep ? k : b, 0);
  if (i === 0 || i === st.length - 1) return { start: st[i], edge: true, sweep: rs.map(strip) };
  const [a, b, c] = [rs[i - 1].imep, rs[i].imep, rs[i + 1].imep], d = 0.5 * (a - c) / (a - 2 * b + c), s = st[i] + 4 * d;
  const at = ev(spec, rpm, o, s); return { start: s, ca50: at.ca50, at: strip(at), sweep: rs.map(strip) };
}
const naOf = sp => ({ e: sp.e, intake: Object.assign({}, sp.intake, { source: { p: 101325, T: 298.15 } }),
  exhaust: { segs: sp.exhaust.segs, Tw: sp.exhaust.Tw, pOut: sp.exhaust.turbine.pOut },
  opt: { phases: sp.opt.phases, collector: { segs: sp.opt.collector.segs.concat(sp.exhaust.turbine.down.segs), Tw: sp.opt.collector.Tw } } });
const J = (psi, fuel) => jobs.find(j => Math.abs(j.psi - psi) < 0.01 && j.fuel === fuel).S;
const log = (...a) => console.log(...a);
if (parts.includes('b')) {
  out.b = {};
  const R = require('./ratings.js'), ls3 = R.specOf(R.lib.find(c => c.k === 'ls3'), {});
  for (const [name, spec, rpms, dx] of [['K24A2 (the build\'s pipes open to the air, CR ' + J(18, 'pump').spec.e.cr + ')', naOf(J(18, 'pump').spec), [2500, 3500, 4500, 5500, 6500, 7000], J(18, 'pump').dx], ['LS3 (ratings.js, CR 10.7)', ls3, [2500, 3500, 4600, 5500, 5900], 0.0125]]) {
    const rows = rpms.map(rpm => strip(ev(spec, rpm, { dx }))); rows.forEach(r => log(name, r.rpm, 'I91', r.I.p91.toFixed(3), 'I93', r.I.p93.toFixed(3), 'Tivc', r.Tivc.toFixed(0), 've', r.ve.toFixed(3)));
    const w = rows.reduce((b, r) => r.I.p91 > b.I.p91 ? r : b, rows[0]), m = mbt(spec, w.rpm, { dx });
    log(name, 'worst', w.rpm, 'MBT start', m.start.toFixed(1), 'CA50', m.ca50 && m.ca50.toFixed(1), 'I91 at MBT', m.at && m.at.I.p91.toFixed(3));
    out.b[name] = { rows, worst: w.rpm, mbt: m }; save(); }
}
if (parts.includes('c')) {
  const S = J(18, 'pump'), w = S.rows.reduce((b, r) => r.tqB > b.tqB ? r : b, S.rows[0]), o = { At: w.At, Ag: w.Ag, dx: S.dx }, base = ev(S.spec, w.rpm, o);
  out.c = { rpm: w.rpm, base: strip(base), T: [], cr: [], on: [], retard: [] };
  // the charge temperature (the intake source's T, the turbine areas held)
  for (const dT of [-20, -10, 10, 20]) { const sp = Object.assign({}, S.spec, { intake: Object.assign({}, S.spec.intake, { source: { p: S.spec.intake.source.p, T: S.spec.intake.source.T + dT } }) }), r = ev(sp, w.rpm, o);
    // the octane number that gives the base integral at this temperature (I ~ ON^-3.402)
    const onEq = ON.p91 * Math.pow(r.I.p91 / base.I.p91, 1 / 3.402); out.c.T.push({ dT, I: r.I.p91, Tivc: r.Tivc, onEq, perK: (onEq - ON.p91) / dT }); log('dT', dT, 'I91', r.I.p91.toFixed(3), 'ON eq', onEq.toFixed(2), 'ON/K', ((onEq - ON.p91) / dT).toFixed(3)); }
  for (const cr of [9.0, 9.5, 10.0, 11.0]) { const sp = Object.assign({}, S.spec, { e: Object.assign({}, S.spec.e, { cr }) }), r = ev(sp, w.rpm, o);
    out.c.cr.push({ cr, I: r.I.p91, imep: r.imep }); log('cr', cr, 'I91', r.I.p91.toFixed(3)); }
  for (const s of [10, 14, 22]) { const r = ev(S.spec, w.rpm, o, s); out.c.retard.push({ start: s, ca50: r.ca50, I: r.I.p91, bmep: r.bmep }); log('start', s, 'ca50', r.ca50.toFixed(1), 'I91', r.I.p91.toFixed(3), 'bmep', (r.bmep / 1e5).toFixed(2)); }
  out.c.on = [80, 90, 95, 100, 110].map(n => ({ ON: n, I: KN.check(base.trace, base.eng, w.rpm, { ON: n }).I }));
  out.c.xEnd = [0.85, 0.9, 0.95].map(x => ({ xEnd: x, I: KN.check(base.trace, base.eng, w.rpm, { ON: ON.p91, xEnd: x }).I }));
  out.c.K = [0, -0.38, -0.9].map(K => ({ K, ONp91: KN.octaneIndex(95, 87, K), ONe85: KN.octaneIndex(104, 94, K) }));
  log(JSON.stringify(out.c.on), JSON.stringify(out.c.xEnd)); save();
}
if (parts.includes('d')) {
  out.d = { rows: {}, retard: {}, scale: {} };
  for (const psi of [10, 18, 25.9124]) for (const fuel of ['pump', 'e85']) {
    const S = J(psi, fuel), k = psi + '|' + fuel, key = fuel === 'pump' ? 'p91' : 'e85';
    out.d.rows[k] = S.rows.filter(r => !r.below).map(r => { const x = ev(S.spec, r.rpm, { At: r.At, Ag: r.Ag, dx: S.dx }); return Object.assign(strip(x), { hpPage: r.hp }); });
    const w = out.d.rows[k].reduce((b, r) => r.I[key] > b.I[key] ? r : b, out.d.rows[k][0]), row = S.rows.find(r => r.rpm === w.rpm);
    log(k, out.d.rows[k].map(r => r.rpm + ':' + r.I[key].toFixed(2)).join(' '));
    // the retard to the integral 1 (and the band's 0.7 and 1.3) at the speed of the largest integral
    out.d.retard[k] = {}; for (const thr of [0.7, 1, 1.3]) { out.d.retard[k][thr] = retard(S.spec, w.rpm, { At: row.At, Ag: row.Ag, dx: S.dx }, key, thr, 18); const q = out.d.retard[k][thr];
      log(k, 'thr', thr, 'rpm', w.rpm, q.lim ? 'retard ' + q.dCA.toFixed(1) + ' deg, CA50 ' + q.lim.ca50.toFixed(1) + ', loss ' + (100 * q.loss).toFixed(1) + ' %' : 'not reached in 40 deg'); }
    save();
  }
  // the knock-limited boost estimate from one trace (the page's method) against the full runs: the cylinder pressure scaled
  // by s, the IVC temperature shifted by the charge's change (the captured runs' charge temperatures, interpolated in boost)
  const cap = [10, 18, 25.9124].map(p => ({ psi: p, Tc: J(p, 'pump').Tc, Pt: J(p, 'pump').Pt }));
  const TcAt = Pt => { const a = cap; if (Pt <= a[1].Pt) return a[0].Tc + (a[1].Tc - a[0].Tc) * (Pt - a[0].Pt) / (a[1].Pt - a[0].Pt); return a[1].Tc + (a[2].Tc - a[1].Tc) * (Pt - a[1].Pt) / (a[2].Pt - a[1].Pt); };
  for (const fuel of ['pump', 'e85']) { const S = J(18, fuel), key = fuel === 'pump' ? 'p91' : 'e85', rows = out.d.rows['18|' + fuel], w = rows.reduce((b, r) => r.I[key] > b.I[key] ? r : b, rows[0]), row = S.rows.find(r => r.rpm === w.rpm);
    const x = ev(S.spec, w.rpm, { At: row.At, Ag: row.Ag, dx: S.dx }), r = {};
    // scaling check: predicted integral at 10 and 25.9 psi (s = Pt'/Pt) vs the full runs' (same speed if run there)
    r.check = [10, 25.9124].map(p => { const Sp = J(p, fuel), s = Sp.Pt / S.Pt, pr = KN.integral(KN.closedPeriod(x.trace, x.eng), KN.unburned(KN.closedPeriod(x.trace, x.eng), x.eng.gas, TcAt(Sp.Pt) - S.Tc), x.eng, w.rpm, { ON: ON[key], pScale: s }).I;
      const full = out.d.rows[p + '|' + fuel].find(q => q.rpm === w.rpm); return { psi: p, s, predicted: pr, full: full ? full.I[key] : null }; });
    for (const [kk, on] of fuel === 'pump' ? [['p91', ON.p91], ['p93', ON.p93]] : [['e85', ON.e85], ['e85eff', ON.e85eff]]) r[kk] = [0.7, 1, 1.3].map(thr => { const s = KN.limitScale(x.trace, x.eng, w.rpm, { ON: on }, thr, s => TcAt(s * S.Pt) - S.Tc); return { thr, s, psi: s == null ? null : (s * S.Pt - 101325) / 6894.757 }; });
    out.d.scale[fuel] = Object.assign({ rpm: w.rpm }, r); log(fuel, JSON.stringify(r)); save(); }
}
save();
