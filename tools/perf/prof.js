// node prof.js FILE TAB [throttle] -> per-edit breakdown (median of 15) and forced layouts with stacks
const { chromium } = require('playwright');
const { settle } = require('../../web/tests/settle');
const serve = require('./serve');
const file = process.argv[2], tab = process.argv[3], thr = +(process.argv[4] || 1), cpuprof = process.argv[5];
const font = ":root{--f-ui:'Liberation Sans',Arial,sans-serif!important;--f-display:'Liberation Sans',Arial,sans-serif!important}";
const CASES = { hangers: ['hg-od', null], intake: ['i-hp', ['440', '450']], mufflers: ['m-f', null], 'four-stroke': ['f-rpm', ['6400', '6500']], headers: ['h-rpm', ['6400', '6500']], sound: ['s-red', ['6400', '6500']] };
const INSTR = () => {
  const P = window.__P = { seg: {}, lay: [], html: 0, htmlN: 0, on: false, depth: [] };
  const now = () => performance.now();
  const wrapG = (name, getf) => { const f = getf(); if (typeof f !== 'function') return; const g = function () { if (!P.on) return f.apply(this, arguments); const t = now(); try { return f.apply(this, arguments); } finally { P.seg[name] = (P.seg[name] || 0) + now() - t; } }; return g; };
  if (!window.__NOWRAP) for (const n of ['keepBefore', 'keepAfter', 'syncShapes', 'simInpRefresh', 'refreshDeps', 'renderPieCut', 'tblPolish', 'fixPass', 'foldPass', 'hintPass', 'hostStatAll', 'u2Later', 'renderHeaders', 'renderCross', 'renderIntake', 'advMark', 'drawCompMap', 'outerH', 'fiSection']) {
    try { const g = wrapG(n, () => __dbg(n)); if (g) __dbg(n + '=__a', g); } catch (e) {} }
  const TABS = __dbg('TABS'); for (const k in TABS) { const f = TABS[k].render; TABS[k].render = function () { if (!P.on) return f.apply(this, arguments); const t = now(); try { return f.apply(this, arguments); } finally { P.seg['render:' + k] = (P.seg['render:' + k] || 0) + now() - t; } }; }
  // innerHTML / insertAdjacentHTML / outerHTML
  for (const [proto, prop] of [[Element.prototype, 'innerHTML'], [Element.prototype, 'outerHTML']]) { const d = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(proto, prop, { configurable: true, get: d.get, set(v) { if (!P.on) return d.set.call(this, v); const t = now(); d.set.call(this, v); P.html += now() - t; P.htmlN++; } }); }
  { const f = Element.prototype.insertAdjacentHTML; Element.prototype.insertAdjacentHTML = function () { if (!P.on) return f.apply(this, arguments); const t = now(); f.apply(this, arguments); P.html += now() - t; P.htmlN++; }; }
  // layout reads
  const rec = (name, t0) => { const dt = now() - t0; if (dt > 0.3) { const st = (new Error().stack || '').split('\n').slice(2, 7).map(s => s.trim().replace(/^at /, '').replace(/\(?file:\/\/[^)]*index\.html:(\d+):(\d+)\)?/, '@$1:$2')).join(' < '); P.lay.push([name, dt, st]); } };
  const lp = [[HTMLElement.prototype, ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']], [Element.prototype, ['clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight', 'scrollTop']]];
  for (const [proto, ps] of lp) for (const p of ps) { const d = Object.getOwnPropertyDescriptor(proto, p); if (!d || !d.get) continue;
    Object.defineProperty(proto, p, { configurable: true, get() { if (!P.on) return d.get.call(this); const t = now(); const v = d.get.call(this); rec(p, t); return v; }, set: d.set }); }
  for (const p of ['getBoundingClientRect', 'getClientRects']) { const f = Element.prototype[p]; Element.prototype[p] = function () { if (!P.on) return f.apply(this, arguments); const t = now(); const v = f.apply(this, arguments); rec(p, t); return v; }; }
  { const f = window.getComputedStyle; window.getComputedStyle = function () { return f.apply(this, arguments); }; }
  for (const p of ['getBBox', 'getComputedTextLength']) { const f = SVGGraphicsElement.prototype[p] || SVGTextContentElement.prototype[p]; const proto = SVGGraphicsElement.prototype[p] ? SVGGraphicsElement.prototype : SVGTextContentElement.prototype; if (!f) continue;
    proto[p] = function () { if (!P.on) return f.apply(this, arguments); const t = now(); const v = f.apply(this, arguments); rec(p, t); return v; }; }
};
(async () => {
  const b = await chromium.launch();
  const [id, vals] = CASES[tab];
  const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  pg.on('pageerror', e => console.log('PAGEERROR', e.message));
  const S = await serve(file); await pg.goto(S.url + '#' + tab); await pg.waitForTimeout(600);
  await pg.addStyleTag({ content: font }); await settle(pg);
  if (tab === 'intake') { await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); s('i-ind', 'turbo'); }); await settle(pg); }
  if (process.env.NOWRAP) await pg.evaluate(() => { window.__NOWRAP = 1; }); await pg.evaluate(INSTR);
  const cdp = await pg.context().newCDPSession(pg);
  if (thr > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr });
  if (cpuprof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
  const rows = [];
  for (let i = 0; i < 15; i++) {
    rows.push(await pg.evaluate(([id, v, i]) => { const P = window.__P; P.seg = {}; P.lay = []; P.html = 0; P.htmlN = 0; P.on = true;
      const el = document.getElementById(id); el.value = v ? v[i % 2] : String((parseFloat(el.value) || 1) * (i % 2 ? 1 / 1.01 : 1.01));
      const t0 = performance.now(); el.dispatchEvent(new Event('input', { bubbles: true })); const t1 = performance.now(); void document.body.offsetHeight; const t2 = performance.now(); P.on = false;
      return { total: t2 - t0, sync: t1 - t0, finalLayout: t2 - t1, seg: P.seg, html: P.html, htmlN: P.htmlN, lay: P.lay }; }, [id, vals, i]));
    await settle(pg);
  }
  if (cpuprof) { const { profile } = await cdp.send('Profiler.stop'); require('fs').writeFileSync(cpuprof, JSON.stringify(profile)); }
  rows.sort((a, c) => a.total - c.total); const m = rows[7];
  const med = k => { const xs = rows.map(r => k(r)).sort((a, c) => a - c); return xs[7]; };
  console.log(tab, 'thr', thr, 'median total', m.total.toFixed(1), 'sync', med(r => r.sync).toFixed(1), 'finalLayout', med(r => r.finalLayout).toFixed(1), 'innerHTML', med(r => r.html).toFixed(1), 'writes', m.htmlN);
  const keys = new Set(rows.flatMap(r => Object.keys(r.seg)));
  for (const k of keys) console.log('  ', k.padEnd(22), med(r => r.seg[k] || 0).toFixed(2));
  const L = {}; for (const r of rows) for (const [n, dt, st] of r.lay) { const k = n + ' | ' + st; (L[k] = L[k] || []).push(dt); }
  console.log('forced layouts (>0.3ms), per edit avg:');
  for (const [k, v] of Object.entries(L).sort((a, c) => c[1].reduce((x, y) => x + y) - a[1].reduce((x, y) => x + y))) console.log('   ', (v.reduce((x, y) => x + y) / 15).toFixed(2), 'ms', v.length + 'x', k.slice(0, 300));
  await b.close(); S.close();
})();
