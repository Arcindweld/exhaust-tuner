// node bench.js FILE [runs] [throttle]  -> median field-edit ms per tab (same font as ui_ui), best of runs
const { chromium } = require('playwright');
const { settle } = require('../../web/tests/settle');
const file = process.argv[2], runs = +(process.argv[3] || 3), thr = +(process.argv[4] || 1), only = process.argv[5];
const font = ":root{--f-ui:'Liberation Sans',Arial,sans-serif!important;--f-display:'Liberation Sans',Arial,sans-serif!important}";
const CASES = [['hangers', 'hg-od', null], ['intake', 'i-hp', ['440', '450']], ['mufflers', 'm-f', null], ['four-stroke', 'f-rpm', ['6400', '6500']], ['headers', 'h-rpm', ['6400', '6500']], ['sound', 's-red', ['6400', '6500']]];
(async () => {
  const b = await chromium.launch();
  const best = {};
  for (let r = 0; r < runs; r++) for (const [t, id, vals] of CASES) {
    if (only && !only.split(',').includes(t)) continue;
    const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
    pg.on('pageerror', e => console.log('PAGEERROR', t, e.message));
    await pg.goto('file://' + file + '#' + t); await pg.waitForTimeout(600);
    await pg.addStyleTag({ content: font + (process.env.CSS || '') }); await settle(pg);
    if (t === 'intake') { await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
      s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); s('i-ind', 'turbo'); }); await settle(pg); }
    let cdp = null; if (thr > 1) { cdp = await pg.context().newCDPSession(pg); await cdp.send('Emulation.setCPUThrottlingRate', { rate: thr }); }
    const ms = [];
    for (let i = 0; i < 15; i++) {
      ms.push(await pg.evaluate(([id, v, i]) => { const el = document.getElementById(id); el.value = v ? v[i % 2] : String((parseFloat(el.value) || 1) * (i % 2 ? 1 / 1.01 : 1.01));
        const t0 = performance.now(); el.dispatchEvent(new Event('input', { bubbles: true })); void document.body.offsetHeight; return performance.now() - t0; }, [id, vals, i]));
      await settle(pg);
    }
    ms.sort((a, c) => a - c); const m = ms[7];
    best[t] = Math.min(best[t] ?? Infinity, m);
    console.log('run', r, t, m.toFixed(1));
    await pg.close();
  }
  console.log(JSON.stringify(Object.fromEntries(Object.entries(best).map(([k, v]) => [k, +v.toFixed(1)]))));
  await b.close();
})();
