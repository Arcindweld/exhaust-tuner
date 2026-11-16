// The Headers tab's collector shapes through the layout path (docs/SPEC_PARITY_AUDIT_2026-11-16.md, addendum A1 (c)): each
// shape laid out at unequal lengths on the Headers tab, the 4-Stroke tab's specs for it ("Header to simulate": the layout as
// laid out and its equal-length twin, uelLayoutSpec), run at two speeds with the JavaScript model, the WebAssembly (the
// page's rustBackend) and the validation scripts' load of the model, every number compared to the last digit; and each
// layout spec checked for its shape (collectors; a Tri-Y's Y stage, none for a direct merge; every port segment marked
// as a port: D2).
//   node tools/validation/wave/headers_shapes_parity.js [only=regex]
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const L = require(path.join(__dirname, '..', '..', '..', 'web', 'tests', 'specparity_lib.js'));
const { typedPoint, settle } = require(path.join(L.ROOT, 'web', 'tests', 'settle.js'));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const PAGE = path.join(L.ROOT, 'web', 'index.html');
const RC = { dx: 0.025, cyc: 1, firstCyc: 2, extra: 1 };
const lens = (n, a, b) => Array.from({ length: n }, (_, i) => ['#h-len-c' + (i + 1), String(i % 2 ? b : a)]);
const CASES = [
  { name: 'I4 direct 4-1, all into one', four: [['f-cyl', '4'], ['f-disp', '2000']], hdr: [['h-eng', 'i4'], ['h-disp', '2000'], ['h-grp', 'all'], ['h-merge', 'direct'], ['h-lenmode', 'unequal'], ['h-port', '80']].concat(lens(4, 420, 560)), coll: 1, stages: 0 },
  { name: 'V8 per bank, two 4-1 collectors', four: [['f-cyl', '8'], ['f-disp', '5700']], hdr: [['h-eng', 'sbc'], ['h-disp', '5700'], ['h-grp', 'bank'], ['h-merge', 'direct'], ['h-lenmode', 'unequal'], ['h-port', '60']].concat(lens(8, 760, 840)), coll: 2, stages: 0 },
  { name: 'V8 180 degree, alternate cylinders in firing order', four: [['f-cyl', '8'], ['f-disp', '5700']], hdr: [['h-eng', 'sbc'], ['h-disp', '5700'], ['h-grp', 'alt'], ['h-merge', 'direct'], ['h-lenmode', 'unequal']].concat(lens(8, 800, 900)), coll: 2, stages: 0 },
  { name: 'I6 my own groups 1,2,3 | 4,5,6', four: [['f-cyl', '6'], ['f-disp', '3000']], hdr: [['h-eng', 'i6'], ['h-disp', '3000'], ['h-grp', 'custom'], ['h-groups', '1,2,3 | 4,5,6'], ['h-merge', 'direct'], ['h-lenmode', 'unequal'], ['h-port', '70']].concat(lens(6, 600, 700)), coll: 2, stages: 0 },
  { name: 'I6 Tri-Y 6-2-1', four: [['f-cyl', '6'], ['f-disp', '3000']], hdr: [['h-eng', 'i6'], ['h-disp', '3000'], ['h-grp', 'all'], ['h-merge', 'triy'], ['h-lenmode', 'unequal']].concat(lens(6, 380, 450)), coll: 1, stages: 1 },
  { name: 'V8 Tri-Y 8-4-1, all into one', four: [['f-cyl', '8'], ['f-disp', '5700']], hdr: [['h-eng', 'sbc'], ['h-disp', '5700'], ['h-grp', 'all'], ['h-merge', 'triy'], ['h-lenmode', 'unequal']].concat(lens(8, 400, 470)), coll: 1, stages: 1 },
  { name: 'I4 direct, stepped primaries asked for (unequal lengths keep them constant)', four: [['f-cyl', '4'], ['f-disp', '2400']], hdr: [['h-eng', 'i4'], ['h-disp', '2400'], ['h-grp', 'all'], ['h-merge', 'direct'], ['h-prof', 'step2'], ['h-lenmode', 'unequal']].concat(lens(4, 500, 640)), coll: 1, stages: 0 }
];
(async () => {
  const b = await chromium.launch(), out = [];
  for (const c of CASES) {
    if (args.only && !new RegExp(args.only).test(c.name)) continue;
    const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + PAGE + '#four-stroke'); await pg.waitForTimeout(600); await L.installPage(pg, true);
    await pg.evaluate(() => { document.getElementById('u-met').click(); document.body.classList.add('expert'); document.body.classList.remove('simple'); }); await typedPoint(pg);
    await pg.evaluate(f => { for (const [id, v] of f) window.__sp.set(id, v); }, c.four);
    await pg.evaluate(() => { location.hash = 'headers'; }); await settle(pg);
    for (const [id, v] of c.hdr) { if (id[0] === '#') { if (await pg.$(id)) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); } } else await pg.evaluate(([id, v]) => window.__sp.set(id, v), [id, v]); await settle(pg); }
    await pg.evaluate(() => { location.hash = 'four-stroke'; }); await settle(pg);
    const specs = (await pg.evaluate(() => window.__sp.collect())).filter(s => /^hdr/.test(s.tag));
    const bad = [];
    if (specs.length !== 2) bad.push('specs ' + specs.map(s => s.tag + (s.err ? ' ' + s.err : '')).join(', '));
    let n = 0;
    for (const s of specs) {
      if (s.err) continue;
      const C = s.spec.opt.collectors || [];
      if (C.length !== c.coll) bad.push(s.tag + ': ' + C.length + ' collectors, expected ' + c.coll);
      if (!C.every(x => (x.stages || []).length === c.stages)) bad.push(s.tag + ': stages ' + C.map(x => (x.stages || []).length).join('/') + ', expected ' + c.stages);
      if (s.spec.exhaust.per_cyl.some(p => p.length > 1 && p[0].L < 0.2 && p[0].port !== true)) bad.push(s.tag + ': a port segment not marked as a port');
      const r = await pg.evaluate(([s, rc]) => window.__sp.run(s, rc), [s, RC]);
      const dr = await pg.evaluate(([s, rc]) => { try { return window.__sp.direct(s, rc); } catch (e) { return { err: e.message }; } }, [s, RC]);
      const d1 = L.sameRows(r.js, r.wasm), d2 = Array.isArray(r.js) ? L.sameRows(r.js, dr) : d1;
      if (!d1.ok) bad.push(s.tag + ' JS/WASM ' + d1.why); if (!d2.ok) bad.push(s.tag + ' JS/validation ' + d2.why);
      if (Array.isArray(r.js)) n += r.js.reduce((a, x) => a + x.length, 0);
    }
    const lensUsed = specs.filter(s => s.spec).map(s => s.spec.exhaust.per_cyl.map(p => +p.reduce((a, q) => a + q.L, 0).toFixed(3)));
    out.push({ name: c.name, ok: !bad.length && !errs.length, bad, numbers: n, lens: lensUsed, errs });
    console.log((bad.length || errs.length ? 'FAIL ' : 'same ') + c.name + ': ' + specs.map(s => s.tag).join(', ') + ', ' + n + ' numbers; primaries (m) ' + JSON.stringify(lensUsed[0] || []) + (bad.length ? ' :: ' + bad.join('; ') : '') + (errs.length ? ' PAGEERR ' + errs.join(' | ') : ''));
    await pg.close();
  }
  fs.writeFileSync(path.join(__dirname, 'results', 'headers_shapes_parity.json'), JSON.stringify(out, null, 1));
  await b.close();
})();
