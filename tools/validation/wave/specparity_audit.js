// The spec parity audit's differential run at the page boundary (docs/SPEC_PARITY_AUDIT_2026-11-16.md): the page's own
// specs for engine presets and a seeded fuzz of its inputs, each run the two ways the page runs it (the JavaScript model
// on a structured clone, the WebAssembly through rustBackend = JSON of WS.rustSpec), and the JavaScript once more by the
// validation scripts' direct call (lib.js, instrumented as the scripts load it). Every number must agree to the last digit.
//   node tools/validation/wave/specparity_audit.js [presets=1] [fuzz=N] [seed=S] [dx=m] [out=file] [only=regex]
// Writes results/specparity_audit.json (each case: its inputs, the specs' tags, the differences found) and prints a line
// per case. Also records the paths the JavaScript model read (Proxy), for the coverage table.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const L = require(path.join(__dirname, '..', '..', '..', 'web', 'tests', 'specparity_lib.js'));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const PAGE = path.join(L.ROOT, 'web', 'index.html');
const rc = { dx: args.dx ? +args.dx : 0.02, cyc: 1, firstCyc: 2, extra: 1 };

async function runCase(b, c) {
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + PAGE + '#intake'); await pg.waitForTimeout(700);
  await L.installPage(pg, true);
  await pg.evaluate(() => { document.getElementById('u-met').click(); document.body.classList.add('expert'); document.body.classList.remove('simple'); });
  const info = await pg.evaluate(c => { const SP = window.__sp, r = {};
    if (c.preset) r.preset = SP.preset(c.preset);
    if (c.camlib) { location.hash = 'four-stroke'; }
    return r; }, c);
  if (c.preset && !info.preset) { await pg.close(); return { name: c.name, skip: 'preset not found: ' + c.preset }; }
  await require(path.join(L.ROOT, 'web', 'tests', 'settle.js')).typedPoint(pg);
  // the Intake tab's inputs on the Intake tab, then the 4-Stroke tab's there
  const ui = c.ui || [];
  await pg.evaluate(ui => { document.getElementById('tab-intake').click(); const SP = window.__sp;
    for (const [id, v] of ui) { if (id === '$turbo') { const s = document.querySelector('select.tsox[data-k="turbo"]'); if (s && s.options.length > 1) { s.value = s.options[1 + (+v % (s.options.length - 1))].value; s.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (/^i-/.test(id)) SP.set(id, v); } }, ui);
  await pg.waitForTimeout(100);
  await pg.evaluate(([ui, camlib]) => { document.getElementById('tab-four').click(); const SP = window.__sp;
    if (camlib) SP.set('f-camlib', camlib);
    for (const [id, v] of ui) if (/^f-/.test(id)) SP.set(id, v); }, [ui, c.camlib || null]);
  await pg.waitForTimeout(100);
  const specs = await pg.evaluate(() => window.__sp.collect());
  const out = { name: c.name, preset: info.preset || null, camlib: c.camlib || null, ui, specs: [], errs };
  for (const s of specs) {
    if (s.err) { out.specs.push({ tag: s.tag, err: s.err }); continue; }
    if (c.trace) s.trace = true;
    const r = await pg.evaluate(([s, rc]) => window.__sp.run(s, rc), [s, rc]);
    const d = L.sameRows(r.js, r.wasm);
    let dd = { ok: true };
    if (Array.isArray(r.js)) { const dr = await pg.evaluate(([s, rc]) => { try { return window.__sp.direct(s, rc); } catch (e) { return { err: e.message }; } }, [s, rc]); dd = L.sameRows(r.js, dr); }
    out.specs.push({ tag: s.tag, ok: d.ok, why: d.why, direct: dd.ok, whyDirect: dd.why, n: Array.isArray(r.js) ? r.js.reduce((a, x) => a + x.length, 0) : 0,
      ve: Array.isArray(r.js) ? r.js.map(x => x[0]) : null, veW: Array.isArray(r.wasm) ? r.wasm.map(x => x[0]) : null, cam: s.spec.e.cam, keys: Object.keys(s.spec.e) });
    if (args.reads !== '0') out.reads = (out.reads || []).concat(await pg.evaluate(([s, rc]) => window.__sp.reads([s], rc), [s, rc]));
  }
  if (out.reads) out.reads = [...new Set(out.reads)];
  await pg.close();
  return out;
}
(async () => {
  const b = await chromium.launch();
  let list = [];
  if (args.presets !== '0') {
    list.push(...L.PRESET_CASES.map(p => ({ name: 'preset ' + p, preset: p })));
    list.push(...['ls3', 'ls9', 'ls7', 'ls6', 'ls1', 'lt1'].map(k => ({ name: 'camlib ' + k, camlib: k })));
    list.push({ name: 'default page' });
  }
  if (+args.fuzz > 0) list.push(...L.cases(+(args.seed || 1), +args.fuzz));
  if (args.only) list = list.filter(c => new RegExp(args.only).test(c.name));
  const res = [], t0 = Date.now(); const reads = new Set();
  for (const c of list) {
    const t1 = Date.now(); let r;
    try { r = await runCase(b, c); } catch (e) { r = { name: c.name, fail: String(e.message || e) }; }
    res.push(r); (r.reads || []).forEach(p => reads.add(p));
    const bad = (r.specs || []).filter(s => !s.err && (!s.ok || !s.direct));
    console.log((r.fail ? 'ERROR ' : bad.length ? 'DIFF ' : r.skip ? 'SKIPPED ' : 'same ') + r.name + (r.preset ? ' [' + r.preset.slice(0, 50) + ']' : '') + ': ' +
      (r.specs || []).map(s => s.tag + (s.err ? ' (no spec: ' + s.err.slice(0, 60) + ')' : s.ok && s.direct ? ' ' + s.n : ' DIFF ' + (s.why || '') + ' | direct ' + (s.whyDirect || 'same'))).join('; ') +
      (r.fail || r.skip || '') + (r.errs && r.errs.length ? ' PAGEERRORS ' + r.errs.join(' | ').slice(0, 200) : '') + ' (' + ((Date.now() - t1) / 1000).toFixed(1) + ' s)');
  }
  await b.close();
  const rust = L.rustReads(), cov = L.coverage([...reads], rust);
  const sum = { cases: res.length, specs: res.reduce((a, r) => a + (r.specs || []).filter(s => !s.err).length, 0),
    diffs: res.reduce((a, r) => a + (r.specs || []).filter(s => !s.err && !s.ok).length, 0), directDiffs: res.reduce((a, r) => a + (r.specs || []).filter(s => !s.err && !s.direct).length, 0),
    noSpec: res.reduce((a, r) => a + (r.specs || []).filter(s => s.err).length, 0), seconds: (Date.now() - t0) / 1000, rc,
    jsReads: [...reads].sort(), missInWasm: cov.miss, allowed: cov.allow };
  console.log(JSON.stringify({ cases: sum.cases, specs: sum.specs, diffs: sum.diffs, directDiffs: sum.directDiffs, noSpec: sum.noSpec, seconds: sum.seconds, missInWasm: sum.missInWasm }));
  const file = args.out || path.join(__dirname, 'results', 'specparity_audit.json');
  fs.writeFileSync(file, JSON.stringify({ sum, res }, null, 1));
})();
