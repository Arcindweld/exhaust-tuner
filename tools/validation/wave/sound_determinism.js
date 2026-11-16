// The sound estimate's JavaScript-only path (docs/SPEC_PARITY_AUDIT_2026-11-16.md, addendum A1 (d)): it cannot be compared
// with the WebAssembly (in-line pieces, side branches, the crossover and a cylinder not firing exist only in the JavaScript
// model), so it is checked for determinism: "Hear each part" (the line, the muffler, a resonator: pieces and branches),
// "Hear a misfire" (cylinders not firing) and, on a two-collector Headers layout with an X crossover, "Estimate the sound",
// each run twice from its button in a fresh page (the page's worker) and every number of the results compared to the last
// digit (the refusal of those parts by the WebAssembly is specparity_ui.js section 2).
//   node tools/validation/wave/sound_determinism.js
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const { settle } = require(path.join(ROOT, 'web', 'tests', 'settle.js'));
const PAGE = path.join(ROOT, 'web', 'index.html');
const CASES = [
  { name: 'Hear each part: the line, a muffler and a Helmholtz can (pieces and branches)', btn: 'parts', wam: { on: true, L: 2400, d: 63.5, muf: 6, mufKind: 'volume', tail: 450, fix: 'helm', x: 700 } },
  { name: 'Hear a misfire: cylinder 1 not firing', btn: 'misfire', wam: { on: true, L: 2000, d: 63.5, muf: 4, mufKind: 'volume', tail: 400 } },
  { name: 'Estimate the sound: V8 per bank on the Headers layout, X crossover on the line', btn: 'run', v8: true, wam: { on: true, L: 2500, d: 63.5, muf: 0, tail: 500, xo: 'x' } }
];
async function once(b, c) {
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + PAGE + '#four-stroke'); await pg.waitForTimeout(600); await settle(pg);
  await pg.click('#m-expert'); await pg.click('#u-met');
  if (c.v8) {
    const set = (id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
    await set('f-cyl', '8'); await set('f-disp', '5700'); await pg.evaluate(() => { location.hash = 'headers'; }); await settle(pg);
    for (const [id, v] of [['h-eng', 'sbc'], ['h-disp', '5700'], ['h-grp', 'bank'], ['h-lenmode', 'unequal']]) { await set(id, v); await settle(pg); }
    await pg.evaluate(() => { location.hash = 'crossover'; }); await settle(pg);
    await pg.evaluate(() => { location.hash = 'four-stroke'; }); await settle(pg);
  }
  await pg.evaluate(w => { Object.assign(window.__proj.wam.line, w); }, c.wam);
  await pg.evaluate(() => { location.hash = 'sound'; }); await settle(pg);
  await pg.evaluate(() => { const e = document.getElementById('wsnd-rpms'); e.value = '3000 5000'; e.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.click('button[data-wsnd="' + c.btn + '"]');
  await pg.waitForFunction(() => { const m = document.getElementById('wsnd-msg'); return m && /^Done|did not finish|stopped|Only the open/.test(m.textContent); }, null, { timeout: 1800000 });
  const r = await pg.evaluate(() => ({ msg: document.getElementById('wsnd-msg').textContent, last: window.__wsndLast || null, sets: window.__wsndSets || null }));
  r.errs = errs; await pg.close(); return r;
}
(async () => {
  const b = await chromium.launch(), out = [];
  for (const c of CASES) {
    const A = await once(b, c), B = await once(b, c), diff = []; let n = 0;
    const walk = (a, x, p) => { if (diff.length > 4) return; if (typeof a === 'number' || typeof x === 'number') { n++; if (!Object.is(a, x)) diff.push(p + ': ' + a + ' / ' + x); return; }
      if (a === null || x === null || typeof a !== 'object' || typeof x !== 'object') { if (a !== x) diff.push(p + ': ' + JSON.stringify(a) + ' / ' + JSON.stringify(x)); return; }
      for (const k of new Set([...Object.keys(a), ...Object.keys(x)])) walk(a[k], x[k], p + '.' + k); };
    walk(A.last, B.last, 'runs'); walk(A.sets, B.sets, 'sets');
    out.push({ name: c.name, msg: A.msg, numbers: n, diff, errs: A.errs.concat(B.errs) });
    console.log((diff.length ? 'DIFF ' : 'same ') + c.name + ': ' + n + ' numbers; ' + A.msg.slice(0, 120) + (diff.length ? ' :: ' + diff.join('; ') : '') + (A.errs.length + B.errs.length ? ' PAGEERR ' + A.errs.concat(B.errs).join(' | ') : ''));
  }
  fs.writeFileSync(path.join(__dirname, 'results', 'sound_determinism.json'), JSON.stringify(out, null, 1));
  await b.close();
})();
