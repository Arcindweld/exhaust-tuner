// How wrong the estimated bore and stroke were (docs/PRESET_DATA_2026-11-18.md): for every engine preset that the sourcing
// round (research.json, apply.js) gave a bore and stroke it did not have, the page's estimate (bore = 1.2 x stroke from the
// displacement, boreStroke) against the sourced figures and what follows from them on the 4-Stroke tab: mean piston speed at
// the preset's redline, the valve heads the wave simulation scales from the bore (0.40 / 0.49 x bore), the rod (1.7 x
// stroke). For a sample of changed presets (the largest stroke corrections first), the wave simulation itself: the preset
// chosen in the page before the round (OLD, the page file at the base commit) and in this page, the design as entered run
// at the 12 speeds the page runs (WebAssembly back end, short run control), peak indicated torque and VE.
//   node tools/validation/presets/effect.js old=<page before the round> [n=30]   ->  results/effect.json (resumable)
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', '..', '..');
const L = require(path.join(ROOT, 'web', 'tests', 'specparity_lib.js'));
const { typedPoint } = require(path.join(ROOT, 'web', 'tests', 'settle.js'));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const NEW = path.join(ROOT, 'web', 'index.html'), OLD = args.old, N = +(args.n || 30);
const OUT = path.join(__dirname, 'results', 'effect.json');
const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'research.json'), 'utf8'));
const save = db => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(OUT + '.tmp', OUT); };
const RC = { dx: 0.02, cyc: 1, firstCyc: 2, extra: 1 };
(async () => {
  const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { rc: RC, geo: null, wave: {} };
  const b = await chromium.launch();
  const open = async file => { const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + file + '#four-stroke'); await pg.waitForTimeout(500); await L.installPage(pg, false);
    await pg.evaluate(() => { document.getElementById('u-met').click(); document.body.classList.add('expert'); document.body.classList.remove('simple'); }); await typedPoint(pg); return [pg, errs]; };
  // 1. the geometry, every changed preset (in this page: its redline, which the round may have sourced too)
  const changed = [];
  for (const [id, e] of Object.entries(R.engines)) for (const t of e.targets) if (!t.had) changed.push({ id, name: t.name, bore: e.bore, stroke: e.stroke, q: e.q, red: e.red || null });
  {
    const [pg] = await open(NEW);
    db.geo = await pg.evaluate(ch => {
      const { MOTORS, VEH, ENGLIB, motorList, boreStroke } = window.__presets, all = MOTORS.concat(VEH), list = motorList();
      const vr = v => v.red || Math.round(Math.max(v.hpRpm * 1.05, v.hpRpm + 300) / 100) * 100;
      return ch.map(c => { const v = all.find(x => x.name === c.name), n = ENGLIB[v.eng].order.length, est = boreStroke(v.cc, n, NaN, NaN);
        const p = list.find(m => m.fitted === v.name || (m.motor && m.name === v.name)), red = vr(v), up = s => 2 * s / 1000 * red / 60, four = (v.valves || 4) === 4;
        return Object.assign(c, { picker: p ? p.name : null, cc: v.cc, cyl: n, valves: v.valves || null, redline: red,
          est: { B: +est.B.toFixed(2), S: +est.S.toFixed(2) }, dB: +(100 * (c.bore / est.B - 1)).toFixed(1), dS: +(100 * (c.stroke / est.S - 1)).toFixed(1),
          bs: +(c.bore / c.stroke).toFixed(3), upEst: +up(est.S).toFixed(2), upReal: +up(c.stroke).toFixed(2),
          vInEst: +((four ? 0.40 : 0.49) * est.B).toFixed(1), vInReal: +((four ? 0.40 : 0.49) * c.bore).toFixed(1), rodEst: +(1.7 * est.S).toFixed(1), rodReal: +(1.7 * c.stroke).toFixed(1) }); });
    }, changed);
    await pg.close(); save(db);
  }
  console.log(db.geo.length + ' changed presets; stroke error of the estimate ' + Math.min(...db.geo.map(g => g.dS)) + ' to ' + Math.max(...db.geo.map(g => g.dS)) + ' %');
  // 2. the wave simulation, a sample: the picker presets with the largest stroke corrections, one per engine entry
  if (OLD) {
    const seen = new Set(), sample = db.geo.filter(g => g.picker).sort((a, b) => Math.abs(b.dS) - Math.abs(a.dS)).filter(g => !seen.has(g.id) && seen.add(g.id)).slice(0, N);
    const runOne = async (file, pick) => {
      const [pg, errs] = await open(file);
      const r = await pg.evaluate(([pick, rc]) => {
        const SP = window.__sp; SP.set('v-mode', 'eng'); const o = [...document.getElementById('v-pick').options].find(o => o.text === pick); if (!o) return { err: 'not in the list' };
        SP.set('v-pick', o.value); const q = window.__sim.inp(), c = SP.collect({ max: 1 })[0]; if (!c || c.err) return { err: c ? c.err : 'no spec' };
        c.rpms = window.__sim.simRpms(q.tune); const TL = SP.TL(), B = TL.rustBackend(c.spec, rc.dx), rows = [];
        try { c.rpms.forEach((rpm, i) => rows.push(SP.flat(B.step(rpm, i === 0, rc.cyc, rc.firstCyc, rc.extra)))); } finally { B.drop(); }
        const vd = q.cc * 1e-6, tq = rows.map(x => x[1] * vd / (4 * Math.PI)), k = tq.indexOf(Math.max(...tq));
        return { rpms: c.rpms, ve: rows.map(x => +x[0].toFixed(4)), tq: tq.map(t => +t.toFixed(1)), peakTq: +tq[k].toFixed(1), peakRpm: c.rpms[k], veAtPeak: +rows[k][0].toFixed(4), veMax: +Math.max(...rows.map(x => x[0])).toFixed(4),
          e: { bore: c.spec.e.bore, stroke: c.spec.e.stroke, cr: c.spec.e.cr, dIn: c.spec.e.dIn, rod: c.spec.e.rod } };
      }, [pick, RC]);
      await pg.close(); if (errs.length) r.errs = errs; return r;
    };
    for (const g of sample) {
      if (db.wave[g.picker] && db.wave[g.picker].after && !db.wave[g.picker].after.err) continue;
      const t0 = Date.now(), w = { id: g.id, name: g.name, dS: g.dS };
      w.before = await runOne(OLD, g.picker); w.after = await runOne(NEW, g.picker);
      if (!w.before.err && !w.after.err) { w.dPeakTq = +(100 * (w.after.peakTq / w.before.peakTq - 1)).toFixed(1); w.dVeAtPeak = +(100 * (w.after.veAtPeak / w.before.veAtPeak - 1)).toFixed(1); w.dVeMax = +(100 * (w.after.veMax / w.before.veMax - 1)).toFixed(1); }
      db.wave[g.picker] = w; save(db);
      console.log(g.picker.slice(0, 60) + ': stroke ' + g.dS + ' %, peak torque ' + (w.dPeakTq != null ? w.dPeakTq + ' %' : 'ERR ' + (w.before.err || w.after.err)) + ', VE at peak ' + w.dVeAtPeak + ' % (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
    }
  }
  await b.close();
})();
