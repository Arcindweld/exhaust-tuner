// The turbo simulation end to end, both engines (docs/SPEC_PARITY_AUDIT_2026-11-16.md, addendum A1): the job the page's
// "Simulate with the turbo" hands its worker (window.__tsim.job(): tsimJob of tsimPlan), run through the page's own
// tsimRun (the area and gate searches, the predict mode of a known turbine, the calibrations to a measured pressure before
// the turbine, the sensitivity runs, the knock check with its timing bisection, the runs without boost and without the
// turbine) once with the WebAssembly back end and once with the JavaScript one, and every number of the two outputs
// compared to the last digit (Object.is: NaN equals NaN, -0 differs from +0). One case also runs from the button itself,
// in the worker, with the WebAssembly and with window.__waveJs, and the button's result is compared with the in-page run.
//   node tools/validation/wave/turbo_closure_parity.js [only=regex] [button=0] [out=file]
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const L = require(path.join(__dirname, '..', '..', '..', 'web', 'tests', 'specparity_lib.js'));
const { typedPoint, settle } = require(path.join(L.ROOT, 'web', 'tests', 'settle.js'));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const PAGE = path.join(L.ROOT, 'web', 'index.html');
const OUT = args.out || path.join(__dirname, 'results', 'turbo_closure_parity.json');
const K24 = ['i-ind', 'turbo'], T7 = ['$turbo', '7'];
const CASES = [
  { name: 'found area, wheel-speed efficiency, pump gasoline', preset: 'K24A2 ', ui: [K24, ['i-boost', '100'], ['i-hp', '350'], T7, ['i-teffm', 'bsr'], ['i-fuel', 'pump']] },
  { name: 'found area, constant efficiency (blade speed off), E85, knock check on', preset: 'K24A2 ', ui: [K24, ['i-boost', '110'], ['i-hp', '380'], T7, ['i-teffm', 'const'], ['i-fuel', 'e85'], ['i-kon', 'on']] },
  { name: 'typed turbine flow (predict), race fuel, wheel-speed efficiency, knock check on', preset: 'K24A2 ', ui: [K24, ['i-boost', '100'], ['i-hp', '350'], T7, ['i-tfc', '28'], ['i-fuel', 'race'], ['i-kon', 'on']] },
  { name: 'measured pressure before the turbine (calibration of area and efficiency), E10, Watson', preset: 'K24A2 ', ui: [K24, ['i-boost', '100'], ['i-hp', '350'], T7, ['i-p3m', '160'], ['i-teffm', 'watson'], ['i-fuel', 'e10']] },
  { name: 'typed flow and measured pressure (calibration of the efficiency and gate), E100', preset: 'K24A2 ', ui: [K24, ['i-boost', '100'], ['i-hp', '350'], T7, ['i-tfc', '28'], ['i-p3m', '160'], ['i-fuel', 'e100']] },
  { name: 'found area, M100, knock check on, constant efficiency, internal gate', ui: [['f-cyl', '4'], ['f-disp', '2000'], ['f-n', '4'], K24, ['i-boost', '120'], ['i-hp', '330'], T7, ['i-teffm', 'const'], ['i-wgtype', 'int'], ['i-fuel', 'm100'], ['i-kon', 'on']] },
  { name: 'typed turbine and gate areas (no search), Watson, back pressure, pump', ui: [['f-cyl', '4'], ['f-disp', '2000'], ['f-n', '4'], K24, ['i-boost', '100'], ['i-hp', '300'], ['i-tsa', '1200'], ['i-tsw', '150'], ['i-teffm', 'watson'], ['i-tobp', '15'], ['$turbo', '3']] },
  { name: 'centrifugal supercharger sweep, E85', ui: [['i-ind', 'centri'], ['i-boost', '50'], ['i-hp', '300'], ['i-fuel', 'e85']] }
];
// in the page: both back ends on the same job, the outputs compared in place (no serialisation in between)
const RUN_BOTH = job => {
  const TLf = window.__tsim.lib(), WS = window.__sim.WS, X = window.__sp.X(), first = [];
  const t0 = performance.now(), A = window.__tsim.run(TLf(WS, X), structuredClone(job), () => {}), tA = performance.now() - t0;
  const t1 = performance.now(), B = window.__tsim.run(TLf(WS, null), structuredClone(job), () => {}), tB = performance.now() - t1;
  let n = 0;
  const walk = (a, b, p) => { if (first.length > 4) return;
    if (typeof a === 'number' || typeof b === 'number') { n++; if (!Object.is(a, b)) first.push(p + ': ' + a + ' / ' + b); return; }
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { if (a !== b) first.push(p + ': ' + JSON.stringify(a) + ' / ' + JSON.stringify(b)); return; }
    const ka = Object.keys(a), kb = Object.keys(b); if (ka.length !== kb.length) first.push(p + ': keys ' + ka.join(',') + ' / ' + kb.join(','));
    for (const k of ka) walk(a[k], b[k], p + '.' + k); };
  walk(A, B, 'out');
  const rows = (A.rows || []).map(r => ({ rpm: r.rpm, At: r.At, Ag: r.Ag, imep: r.res && r.res.imep, ve: r.res && r.res.ve, s: r.s, below: r.below }));
  return { diffs: first, numbers: n, ms: [Math.round(tA), Math.round(tB)], mode: A.mode || (job.turbo ? 'closure' : 'sweep'), calib: A.calib || null, knock: !!A.knock, sens: (A.sens || []).length, rows, out: A };
};
(async () => {
  const b = await chromium.launch(); const res = [], t0 = Date.now();
  const open = async () => { const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); pg._errs = []; pg.on('pageerror', e => pg._errs.push(e.message));
    await pg.goto('file://' + PAGE + '#intake'); await pg.waitForTimeout(600); await L.installPage(pg, false);
    await pg.evaluate(() => { document.getElementById('u-met').click(); document.body.classList.add('expert'); document.body.classList.remove('simple'); }); await typedPoint(pg); return pg; };
  const apply = (pg, c) => pg.evaluate(c => { const SP = window.__sp, ui = c.ui || [];
    if (c.preset && !SP.preset(c.preset)) return 'no preset ' + c.preset;
    document.getElementById('tab-intake').click();
    for (const [id, v] of ui) { if (id === '$turbo') { const s = document.querySelector('select.tsox[data-k="turbo"]'); if (s && s.options.length > 1) { s.value = s.options[1 + (+v % (s.options.length - 1))].value; s.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (/^i-/.test(id)) SP.set(id, v); }
    document.getElementById('tab-four').click();
    for (const [id, v] of ui) if (/^f-/.test(id)) SP.set(id, v);
    return ''; }, c);
  for (const c of CASES) {
    if (args.only && !new RegExp(args.only).test(c.name)) continue;
    const pg = await open(), e = await apply(pg, c); await settle(pg);
    const J = await pg.evaluate(() => window.__tsim.job());
    if (e || !J) { res.push({ name: c.name, err: e || 'no turbo plan' }); console.log('NO PLAN ' + c.name + ' ' + e); await pg.close(); continue; }
    const r = await pg.evaluate(RUN_BOTH, J.job);
    const o = { name: c.name, ui: c.ui, preset: c.preset || null, diffs: r.diffs, numbers: r.numbers, ms: r.ms, mode: r.mode, calib: r.calib, knock: r.knock, sens: r.sens, rows: r.rows, errs: pg._errs };
    // the button, both ways, for the first case: the worker's result against the in-page run
    if (args.button !== '0' && c === CASES[0]) {
      o.button = {};
      for (const js of [false, true]) {
        const pb = await open(); await apply(pb, c); await settle(pb);
        await pb.evaluate(js => { window.__waveJs = js; location.hash = 'four-stroke'; }, js); await settle(pb);
        await pb.click('button[data-tsim="run"]');
        await pb.waitForFunction(() => window.__tsim.state().status !== 'running', null, { timeout: 1800000 });
        const got = await pb.evaluate(() => ({ st: window.__tsim.state().status, out: window.__tsim.state().res, key: window.__tsim.state().key, now: window.__tsim.job().key }));
        o.button[js ? 'js' : 'wasm'] = { st: got.st, sameKey: got.key === got.now, out: got.out };
        await pb.close();
      }
      const inPage = await pg.evaluate(job => { const TLf = window.__tsim.lib(); return window.__tsim.run(TLf(window.__sim.WS, window.__sp.X()), structuredClone(job), () => {}); }, J.job);
      const cmp = (a, b, p, f) => { if (f.length > 4) return; if (typeof a === 'number' || typeof b === 'number') { if (!Object.is(a, b)) f.push(p + ': ' + a + ' / ' + b); return; }
        if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { if (a !== b && !(a === undefined && b === undefined)) f.push(p + ': ' + JSON.stringify(a) + ' / ' + JSON.stringify(b)); return; }
        for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) cmp(a[k], b[k], p + '.' + k, f); };
      for (const k of ['wasm', 'js']) { const f = []; cmp(o.button[k].out, inPage, 'out', f); o.button[k].vsInPage = f; delete o.button[k].out; }
    }
    res.push(o); await pg.close();
    console.log((r.diffs.length ? 'DIFF ' : 'same ') + c.name + ': ' + r.mode + (r.calib ? ' calib ' + JSON.stringify({ At: r.calib.At, eta: r.calib.eta, ok: r.calib.ok }) : '') + (r.knock ? ' +knock' : '') + ' sens ' + r.sens + ', ' + r.numbers + ' numbers, ' + r.rows.length + ' speeds, ' + r.ms.map(x => (x / 1000).toFixed(0) + ' s').join(' / ') +
      (r.diffs.length ? ' :: ' + r.diffs.join('; ') : '') + (o.button ? ' | button ' + JSON.stringify(o.button) : '') + (pg._errs.length ? ' PAGEERR ' + pg._errs.join(' | ') : ''));
    fs.writeFileSync(OUT, JSON.stringify({ res, seconds: (Date.now() - t0) / 1000 }, null, 1));
  }
  await b.close();
})();
