// node tools/perf/load.js FILE[,FILE2] [runs=5] [throttle=1]
// First load to interactive (navigation start to the end of the first render, and to a quiet page: no long task for
// 500 ms) and tab switches (the tab's hash set to the tab drawn and laid out: the render, its passes and the layout),
// median over runs, same font as ui_ui. Several files are measured interleaved.
const { chromium } = require('playwright');
const files = process.argv[2].split(','), runs = +(process.argv[3] || 5), thr = +(process.argv[4] || 1);
const font = ":root{--f-ui:'Liberation Sans',Arial,sans-serif!important;--f-display:'Liberation Sans',Arial,sans-serif!important}";
const TABS = ['quick', 'four-stroke', 'two-stroke', 'sound', 'intake', 'headers', 'crossover', 'mufflers', 'cats', 'boom-tubes', 'hangers', 'parts', 'options'];
const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
(async () => {
  const b = await chromium.launch(); const R = files.map(() => ({ first: [], quiet: [], tabs: {} }));
  for (let r = 0; r < runs; r++) for (let fi = 0; fi < files.length; fi++) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(f => { let c = 0; window.__t1 = null; window.__lt = [];
      Object.defineProperty(window, '__renderCount', { configurable: true, get: () => c, set: v => { c = v; if (window.__t1 == null) window.__t1 = performance.now(); } });
      try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(e.startTime + e.duration); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
      document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = f; document.head.appendChild(s); }); }, font);
    const pg = await ctx.newPage();
    if (thr > 1) { const cdp = await ctx.newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr }); }
    await pg.goto('file://' + files[fi] + '#quick');
    await pg.waitForFunction(() => window.__t1 != null, null, { timeout: 60000 });
    // quiet: the end of the last long task, once none has started for 500 ms
    await pg.waitForFunction(() => { const n = performance.now(), l = window.__lt; return n - (l.length ? Math.max(...l) : window.__t1) > 500; }, null, { timeout: 60000, polling: 100 });
    const t = await pg.evaluate(() => ({ first: window.__t1, quiet: Math.max(window.__t1, ...window.__lt) }));
    R[fi].first.push(t.first); R[fi].quiet.push(t.quiet);
    for (const tab of TABS.slice(1).concat(['quick'])) {
      const ms = await pg.evaluate(tab => new Promise(res => { const t0 = performance.now();
        addEventListener('hashchange', () => { void document.body.offsetHeight; res(performance.now() - t0); }, { once: true }); location.hash = tab; }), tab);
      (R[fi].tabs[tab] = R[fi].tabs[tab] || []).push(ms);
      await pg.waitForTimeout(150);
    }
    await ctx.close();
  }
  for (let fi = 0; fi < files.length; fi++) { const x = R[fi];
    console.log(require('path').basename(files[fi]), 'first render', med(x.first).toFixed(0), 'ms, quiet', med(x.quiet).toFixed(0), 'ms; tab switch',
      JSON.stringify(Object.fromEntries(Object.entries(x.tabs).map(([k, v]) => [k, +med(v).toFixed(1)])))); }
  await b.close();
})();
