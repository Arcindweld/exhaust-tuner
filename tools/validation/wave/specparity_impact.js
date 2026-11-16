// What the defects found by the spec parity audit did to the results the page showed (docs/SPEC_PARITY_AUDIT_2026-11-16.md).
//   node tools/validation/wave/specparity_impact.js [which=checklift,headers,chamber] [out=file]
// checklift  D1: the WebAssembly (the browser's path when it loads, 2026-11-03 to 2026-11-15) handed the cam card's events
//            as typed, without WS.rustSpec's seat-to-seat translation, so a card at 0.050 in ran as if seat to seat. For
//            every cam library entry (all 0.050 in cards), the 4-Stroke tab's own run (its default header, the design as
//            entered, the page's speeds, grid and cycles: 3 / 8 / up to 5 extra pairs) with the spec as the WebAssembly got
//            it then (the raw spec) and as it gets it now (rustSpec), both on the page's embedded WebAssembly.
// headers    D2: the Headers tab's unequal-length layout (uelLayoutSpec) without and with the exhaust-port law on its ports
//            (the Tri-Y 4-2-1 of uel_sim_ui.js), on the JavaScript model.
// chamber    D4: a supercharged run of a header with a chamber on its primaries, without and with the chamber.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const L = require(path.join(__dirname, '..', '..', '..', 'web', 'tests', 'specparity_lib.js'));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const which = (args.which || 'checklift,headers,chamber').split(',');
const PAGE = path.join(L.ROOT, 'web', 'index.html');
// in the page: a whole sweep as the sweep worker runs it (simWaveRust's steps: 3 cycles, 8 first, up to 5 extra pairs)
const SWEEP = function ([spec, rpms, dx, raw, js]) {
  const WS = window.__sim.WS, SP = window.__sp, TL = SP.TL();
  let res;
  if (js) { const eng = WS.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt); res = WS.sweep(eng, rpms, { dx, cycles: 3, firstCycles: 8, maxExtra: 5 }); res.Vd = eng.Vd; }
  else {
    const X = SP.X(), t = new TextEncoder().encode(JSON.stringify(raw ? spec : WS.rustSpec(spec))), p = X.wave_alloc(t.length);
    new Uint8Array(X.memory.buffer, p, t.length).set(t); const id = X.wave_new(p, t.length); X.wave_free(p, t.length);
    res = rpms.map((rpm, i) => { const n = X.wave_step(id, rpm, i === 0 ? 1 : 0, dx, 3, 8, 5, NaN); const v = new Float64Array(X.memory.buffer, X.wave_out(), n); return { rpm, ve: v[0], imep: v[1] }; });
    res.Vd = X.wave_vd(id); X.wave_drop(id);
  }
  return { rpm: res.map(r => r.rpm), ve: res.map(r => r.ve), imep: res.map(r => r.imep), Vd: res.Vd };
};
const summ = (r, cyl) => { const tq = r.imep.map(m => m * r.Vd / (4 * Math.PI) * cyl), i = tq.indexOf(Math.max(...tq)), hp = tq.map((t, k) => t * r.rpm[k] * 2 * Math.PI / 60 / 745.7), j = hp.indexOf(Math.max(...hp));
  return { tq, peakTq: tq[i], tqRpm: r.rpm[i], peakHp: hp[j], hpRpm: r.rpm[j], ve: r.ve }; };
(async () => {
  const b = await chromium.launch(), out = {};
  const open = async () => { const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); await pg.goto('file://' + PAGE + '#four-stroke'); await pg.waitForTimeout(700); await L.installPage(pg);
    await pg.evaluate(() => { document.getElementById('u-met').click(); document.body.classList.add('expert'); }); return pg; };
  if (which.includes('checklift')) {
    out.checklift = {};
    for (const k of ['ls3', 'ls9', 'ls7', 'ls6', 'ls1', 'lt1']) {
      const pg = await open();
      const c = await pg.evaluate(k => { const SP = window.__sp; SP.refresh(); SP.set('f-camlib', k); SP.refresh(); const S = window.__sim, q = S.inp(), v = S.simVariants(q)[0];
        return { spec: v.spec, rpms: S.simRpms(q.tune), dx: q.n > 1 ? 0.0125 : 0.01, cyl: q.cyl, n: q.n, seat: S.WS.rustSpec(v.spec).e.cam }; }, k);
      const t0 = Date.now();
      const now = await pg.evaluate(SWEEP, [c.spec, c.rpms, c.dx, false, false]), then = await pg.evaluate(SWEEP, [c.spec, c.rpms, c.dx, true, false]);
      const A = summ(now, c.cyl), B = summ(then, c.cyl);
      const rel = A.tq.map((t, i) => B.tq[i] / t - 1), dve = A.ve.map((v, i) => then.ve[i] - v);
      out.checklift[k] = { card: c.spec.e.cam, seat: c.seat, rpms: c.rpms, n: c.n, now: { peakTq: A.peakTq, tqRpm: A.tqRpm, peakHp: A.peakHp, hpRpm: A.hpRpm }, then: { peakTq: B.peakTq, tqRpm: B.tqRpm, peakHp: B.peakHp, hpRpm: B.hpRpm },
        tqNow: A.tq, tqThen: B.tq, veNow: now.ve, veThen: then.ve, relMin: Math.min(...rel), relMax: Math.max(...rel), dveMin: Math.min(...dve), dveMax: Math.max(...dve) };
      const o = out.checklift[k];
      console.log(k + ': card ' + JSON.stringify(o.card) + ' -> seat ' + JSON.stringify(o.seat) + '; peak torque ' + o.then.peakTq.toFixed(1) + ' N m at ' + o.then.tqRpm + ' (as the browser ran it) vs ' + o.now.peakTq.toFixed(1) + ' at ' + o.now.tqRpm +
        ' (correct); peak power ' + o.then.peakHp.toFixed(1) + ' hp at ' + o.then.hpRpm + ' vs ' + o.now.peakHp.toFixed(1) + ' at ' + o.now.hpRpm + '; torque speed by speed ' + (100 * o.relMin).toFixed(1) + ' to ' + (100 * o.relMax).toFixed(1) + ' %; VE ' + o.dveMin.toFixed(3) + ' to ' + o.dveMax.toFixed(3) + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
      await pg.close();
    }
  }
  if (which.includes('headers')) {
    const pg = await open();
    await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(400);
    for (const [id, v] of [['h-eng', 'f4'], ['h-disp', '2457'], ['h-grp', 'all'], ['h-merge', 'triy'], ['h-pairs', '1,3 | 2,4'], ['h-lenmode', 'unequal'], ['h-port', '100']]) { await pg.evaluate(([id, v]) => window.__sp.set(id, v), [id, v]); await pg.waitForTimeout(150); }
    for (const [id, v] of [['#h-len-c1', '430'], ['#h-len-c2', '600'], ['#h-len-c3', '430'], ['#h-len-c4', '600'], ['#h-sec-g1', '350'], ['#h-sec-g2', '650']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
    await pg.waitForTimeout(300); await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400);
    const c = await pg.evaluate(() => { const SP = window.__sp; SP.set('f-disp', '2457'); SP.set('f-cyl', '4'); SP.set('f-port', '100'); SP.refresh();
      const S = window.__sim, q = S.inp(), p = S.simPlan(q); return { err: p.err, hdr: p.hdr, specs: p.variants.map(v => v.spec), rpms: S.simRpms(q.tune).filter((r, i) => i % 3 === 0), cyl: q.cyl }; });
    if (!c.hdr || c.err) out.headers = { err: c.err || 'no Headers layout' };
    else {
      out.headers = {};
      for (const [i, key] of [[0, 'laid out'], [1, 'equal']]) {
        const s = c.specs[i], marked = JSON.parse(JSON.stringify(s)), plain = JSON.parse(JSON.stringify(s));
        marked.exhaust.per_cyl.forEach(p => { if (p.length > 1) p[0].port = true; }); plain.exhaust.per_cyl.forEach(p => { delete p[0].port; });
        const A = summ(await pg.evaluate(SWEEP, [marked, c.rpms, 0.0125, false, true]), c.cyl), B = summ(await pg.evaluate(SWEEP, [plain, c.rpms, 0.0125, false, true]), c.cyl);
        const rel = A.tq.map((t, j) => B.tq[j] / t - 1);
        out.headers[key] = { rpms: c.rpms, tqWith: A.tq, tqWithout: B.tq, relMin: Math.min(...rel), relMax: Math.max(...rel), peak: [B.peakTq, A.peakTq] };
        console.log('Headers Tri-Y (' + key + '): torque without the port law / with it, speed by speed ' + (100 * Math.min(...rel)).toFixed(2) + ' to ' + (100 * Math.max(...rel)).toFixed(2) + ' %; peak ' + B.peakTq.toFixed(1) + ' / ' + A.peakTq.toFixed(1) + ' N m');
      }
    }
    await pg.close();
  }
  if (which.includes('chamber')) {
    const pg = await open();
    await require(path.join(L.ROOT, 'web', 'tests', 'settle.js')).typedPoint(pg);
    const c = await pg.evaluate(() => { const SP = window.__sp; document.getElementById('tab-intake').click(); SP.set('i-ind', 'centri'); SP.set('i-boost', '50'); SP.set('i-hp', '500');
      document.getElementById('tab-four').click(); SP.set('f-ch', 'can'); SP.set('f-chx', '200'); SP.refresh();
      const P = window.__tsim.plan(), q = window.__sim.inp(); return { err: P && P.err, spec: P && P.spec, four: window.__sim.simSpec(q).exhaust.chambers, rpms: P && P.rpms.filter((r, i) => i % 2 === 0), cyl: P && P.nSim, dx: P && P.dx }; });
    if (c.err || !c.spec) out.chamber = { err: c.err || 'no plan' };
    else {
      const w = JSON.parse(JSON.stringify(c.spec)), wo = JSON.parse(JSON.stringify(c.spec)); w.exhaust.chambers = c.four; wo.exhaust.chambers = [];
      const A = summ(await pg.evaluate(SWEEP, [w, c.rpms, c.dx, false, false]), c.cyl), B = summ(await pg.evaluate(SWEEP, [wo, c.rpms, c.dx, false, false]), c.cyl);
      const rel = A.tq.map((t, j) => B.tq[j] / t - 1);
      out.chamber = { rpms: c.rpms, chambers: c.four, tqWith: A.tq, tqWithout: B.tq, relMin: Math.min(...rel), relMax: Math.max(...rel) };
      console.log('supercharged, can chamber at 200 mm: torque without the chamber / with it (the cylinders on the simulated collector) ' + (100 * Math.min(...rel)).toFixed(2) + ' to ' + (100 * Math.max(...rel)).toFixed(2) + ' %');
    }
    await pg.close();
  }
  await b.close();
  const file = args.out || path.join(__dirname, 'results', 'specparity_impact.json');
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {}
  fs.writeFileSync(file, JSON.stringify(Object.assign(prev, out), null, 1));   // one part at a time keeps the others
})();
