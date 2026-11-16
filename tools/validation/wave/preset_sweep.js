// Every engine preset in the page's list through the 4-Stroke tab's translation, both engines (docs/SPEC_PARITY_AUDIT_2026-11-16.md,
// addendum A2). For each preset: a fresh page, the preset chosen from the engine list, the page's own 4-Stroke specs
// (window.__sp.collect: the design as entered, and the Headers twin when there is one), each run at three of the speeds the
// page would run (first, middle, last) with the JavaScript model and with the WebAssembly (the page's rustBackend), every
// number compared to the last digit, and the results checked for plausibility: no NaN, VE 0.3 to 1.6, IMEP > 0 (positive
// torque at wide-open throttle), peak pressure and exhaust temperature in range. A preset that is not a four-stroke (two-stroke,
// rotary) fills nothing on the 4-Stroke tab: listed as not applicable.
//   node tools/validation/wave/preset_sweep.js [out=file] [from=i] [to=j] [dx=m]
// Resumable: results are written after every preset (results/preset_sweep.json by default); a rerun skips the presets already
// in the file, so a container restart loses at most the preset in progress.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const L = require(path.join(__dirname, '..', '..', '..', 'web', 'tests', 'specparity_lib.js'));
const { typedPoint } = require(path.join(L.ROOT, 'web', 'tests', 'settle.js'));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const PAGE = path.join(L.ROOT, 'web', 'index.html');
const OUT = args.out || path.join(__dirname, 'results', 'preset_sweep.json');
const RC = { dx: args.dx ? +args.dx : 0.02, cyc: 1, firstCyc: 2, extra: 1 };
const save = db => { fs.writeFileSync(OUT + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(OUT + '.tmp', OUT); };

// plausibility of one speed's numbers (SP.flat: ve, imep, pmax, resid, pEvo, tEx, overlapPort, gimep, then per cylinder)
function judge(rows, rpms) {
  const bad = [];
  rows.forEach((r, i) => {
    const [ve, imep, pmax, resid, , tEx] = r, at = ' at ' + rpms[i] + ' rpm';
    if (r.some(x => typeof x === 'number' && !Number.isFinite(x))) bad.push('non-finite number' + at);
    if (!(ve >= 0.3 && ve <= 1.6)) bad.push('VE ' + (+ve).toFixed(3) + at);
    if (!(imep > 0)) bad.push('IMEP ' + (+imep).toFixed(0) + ' Pa (torque not positive)' + at);
    if (!(pmax > 1e6 && pmax < 3e7)) bad.push('peak pressure ' + (pmax / 1e5).toFixed(1) + ' bar' + at);
    if (!(tEx > 500 && tEx < 1800)) bad.push('exhaust temperature ' + (+tEx).toFixed(0) + ' K' + at);
    if (!(resid >= 0 && resid < 0.5)) bad.push('residual ' + (+resid).toFixed(3) + at);
  });
  return bad;
}

(async () => {
  const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { rc: RC, res: {} };
  const b = await chromium.launch();
  const open = async () => { const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + PAGE + '#four-stroke'); await pg.waitForTimeout(500); await L.installPage(pg, false);
    await pg.evaluate(() => { document.getElementById('u-met').click(); document.body.classList.add('expert'); document.body.classList.remove('simple'); }); await typedPoint(pg); return [pg, errs]; };
  let [pg0] = await open();
  const list = await pg0.evaluate(() => { window.__sp.set('v-mode', 'eng'); return [...document.getElementById('v-pick').options].filter(o => o.value !== '').map(o => ({ v: o.value, t: o.text })); });
  await pg0.close();
  db.total = list.length;
  const from = +(args.from || 0), to = Math.min(list.length, +(args.to || list.length)), t0 = Date.now();
  console.log(list.length + ' engine presets; ' + Object.keys(db.res).length + ' already done');
  for (let i = from; i < to; i++) {
    const P = list[i]; if (db.res[P.v] && db.res[P.v].name === P.t && !db.res[P.v].fail) continue;
    const t1 = Date.now(); let r;
    try {
      const [pg, errs] = await open();
      const info = await pg.evaluate(v => { const SP = window.__sp; SP.set('v-mode', 'eng'); SP.set('v-pick', v);
        const note = document.getElementById('v-note').textContent; return { four: /Filled in on 4-Stroke/.test(note), cc: window.__sim.inp() && window.__sim.inp().cc }; }, P.v);
      r = { name: P.t, four: info.four, specs: [], errs };
      if (info.four) {
        const specs = await pg.evaluate(() => window.__sp.collect({ max: 2 }));
        for (const s of specs) {
          if (s.err) { r.specs.push({ tag: s.tag, err: s.err }); continue; }
          if (/^tsim/.test(s.tag)) continue;   // a preset leaves the induction as it is (naturally aspirated by default)
          const rp = await pg.evaluate(() => { const q = window.__sim.inp(); return window.__sim.simRpms(q.tune); });
          s.rpms = [rp[0], rp[Math.floor(rp.length / 2)], rp[rp.length - 1]];
          const x = await pg.evaluate(([s, rc]) => window.__sp.run(s, rc), [s, RC]);
          const d = L.sameRows(x.js, x.wasm);
          const e = s.spec.e;
          r.specs.push({ tag: s.tag, rpms: s.rpms, same: d.ok, why: d.why, bad: Array.isArray(x.js) ? judge(x.js, s.rpms) : ['JS error: ' + (x.js && x.js.err)],
            wasmErr: Array.isArray(x.wasm) ? null : x.wasm && x.wasm.err,
            ve: Array.isArray(x.js) ? x.js.map(q => +q[0].toFixed(4)) : null, imep: Array.isArray(x.js) ? x.js.map(q => Math.round(q[1])) : null,
            eng: { bore: e.bore, stroke: e.stroke, cr: e.cr, nIn: e.nIn, dIn: e.dIn, dEx: e.dEx, rod: e.rod, cam: e.cam } });
        }
      }
      await pg.close();
    } catch (e) { r = { name: P.t, fail: String(e && e.message || e) }; if (/has been closed|Target closed/.test(r.fail)) { console.log('the browser went away: stopping (rerun to resume)'); break; } }
    db.res[P.v] = r; save(db);
    const sp = r.specs || [], bad = sp.flatMap(s => s.bad || []), diff = sp.filter(s => s.same === false);
    console.log(i + ' ' + (r.fail ? 'ERROR ' + r.fail : !r.four ? 'n/a (not a four-stroke)' : (diff.length ? 'DIFF ' : '') + (bad.length ? 'IMPLAUSIBLE ' + bad.join('; ') : diff.length ? '' : 'ok')) +
      ' | ' + P.t.slice(0, 60) + ' ' + sp.map(s => s.tag + (s.err ? ' no spec: ' + s.err.slice(0, 60) : ' ve ' + (s.ve || []).join('/'))).join(', ') +
      ((r.errs || []).length ? ' PAGEERR ' + r.errs.join(' | ').slice(0, 120) : '') + ' (' + ((Date.now() - t1) / 1000).toFixed(1) + ' s)');
  }
  await b.close();
  const all = Object.values(db.res);
  db.sum = { presets: all.length, four: all.filter(r => r.four).length, fail: all.filter(r => r.fail).length,
    diff: all.filter(r => (r.specs || []).some(s => s.same === false)).length, implausible: all.filter(r => (r.specs || []).some(s => (s.bad || []).length)).length,
    noSpec: all.filter(r => (r.specs || []).some(s => s.err)).length, pageErr: all.filter(r => (r.errs || []).length).length, seconds: (Date.now() - t0) / 1000 };
  save(db); console.log(JSON.stringify(db.sum));
})();
