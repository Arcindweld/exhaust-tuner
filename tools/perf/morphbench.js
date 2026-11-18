// node morphbench.js FILE : setHTML on the boosted Intake tab's results, two consecutive renders' HTML in turn (no layout:
// the time of the parse and the patch alone), median of 30
const { chromium } = require('playwright'); const serve = require('./serve'); const { settle } = require('../../web/tests/settle');
(async () => { const S = await serve(process.argv[2]); const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await pg.goto(S.url + '#intake'); await pg.waitForTimeout(800); await settle(pg);
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); s('i-ind', 'turbo'); }); await settle(pg);
  console.log(await pg.evaluate(async () => { const H = []; const f = __dbg('setHTML'); __dbg('setHTML=__a', function (el, h) { if (el.id === 'i-details') H.push(h); return f.apply(this, arguments); });
    for (const v of ['441', '452']) { const e = document.getElementById('i-hp'); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(r => setTimeout(r, 50)); }
    __dbg('setHTML=__a', f); const det = document.getElementById('i-details'), ms = [];
    for (let i = 0; i < 30; i++) { const t = performance.now(); f(det, H[i % 2]); ms.push(performance.now() - t); void document.body.offsetHeight; }
    ms.sort((a, c) => a - c); const t2 = document.createElement('template'); const t0 = performance.now(); for (let i = 0; i < 10; i++) t2.innerHTML = H[i % 2]; const parse = (performance.now() - t0) / 10;
    return 'setHTML median ' + ms[15].toFixed(2) + ' ms (template parse alone ' + parse.toFixed(2) + ' ms), html ' + H[0].length + ' chars'; }));
  await b.close(); S.close(); })();
