// node dup.js FILE TAB fn1,fn2,... : calls per render and distinct argument lists (JSON) for named page functions
const { chromium } = require('playwright'); const serve = require('./serve'); const { settle } = require('../../web/tests/settle');
const [file, tab, fns] = process.argv.slice(2);
(async () => { const S = await serve(file); const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await pg.goto(S.url + '#' + tab); await pg.waitForTimeout(800); await settle(pg);
  if (tab === 'intake') { await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); s('i-ind', 'turbo'); }); await settle(pg); }
  console.log(await pg.evaluate(fns => { const C = {};
    for (const n of fns.split(',')) { let f; try { f = __dbg(n); __dbg(n + '=' + n); } catch (e) { continue; } C[n] = { calls: 0, keys: new Set(), ms: 0 };
      __dbg(n + '=__a', function () { C[n].calls++; let k; try { k = JSON.stringify([...arguments], (kk, v) => typeof v === 'function' ? 'fn' : v); } catch (e) { k = '?' + C[n].calls; } C[n].keys.add(k); const t = performance.now(); try { return f.apply(this, arguments); } finally { C[n].ms += performance.now() - t; } }); }
    const id = { intake: 'i-hp', mufflers: 'm-f', hangers: 'hg-od' }[location.hash.slice(1)];
    const el = document.getElementById(id); el.value = String(parseFloat(el.value) * 1.013); el.dispatchEvent(new Event('input', { bubbles: true }));
    return Object.entries(C).map(([n, c]) => n + ': ' + c.calls + ' calls, ' + c.keys.size + ' distinct, ' + c.ms.toFixed(1) + ' ms (incl. nested)').join('\n'); }, fns));
  await b.close(); S.close(); })();
