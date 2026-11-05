// Every numeric field on every tab, one at a time, set to 1e9, -1e9 and 1e-9: the page must not crash or hang (a field
// that takes more than EXT_SLOW ms to recompute is reported), and no NaN / Infinity / undefined may show. Each field goes
// back to its own value before the next one.  node tests/extremes_ui.js   (from web/; EXT_TABS=a,b to limit)
const { chromium } = require('playwright');
(async () => {
  const slowMs = +(process.env.EXT_SLOW || 4000), vals = (process.env.EXT_VALS || '1e9,-1e9,1e-9').split(',');
  const b = await chromium.launch(); const errs = []; const fails = [];
  const fresh = async tab => { const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + process.cwd() + '/index.html#' + tab); await p.waitForTimeout(500); return p; };
  let pg = await fresh('quick');
  const tabs = (await pg.evaluate(() => [...document.querySelectorAll('[data-tab]')].map(x => x.dataset.tab).filter((v, i, a) => a.indexOf(v) === i))).filter(t => !process.env.EXT_TABS || process.env.EXT_TABS.split(',').includes(t));
  await pg.context().close();
  let n = 0;
  for (const tab of tabs) {
    pg = await fresh(tab);
    const ids = await pg.evaluate(() => [...document.querySelectorAll('section.panel:not([hidden]) input')].filter(i => i.id && i.offsetParent && !i.disabled && (i.type === 'number' || /decimal|numeric/.test(i.inputMode))).map(i => i.id));
    for (const id of ids) for (const v of vals) {
      n++; const e0 = errs.length; let res;
      const t0 = Date.now();
      try {
        res = await Promise.race([pg.evaluate(([id, v]) => { const el = document.getElementById(id); if (!el || !el.offsetParent) return { gone: 1 }; const old = el.value;
            el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
            const sec = document.querySelector('section.panel:not([hidden])'), re = /\b(NaN|Infinity|undefined|\[object \w+\])\b/, w = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT); let nd, bad = '';
            while ((nd = w.nextNode())) { if (!re.test(nd.textContent) || !nd.parentElement.offsetParent) continue; const p = nd.parentElement, s = p.closest('.sec'), h = s && s.querySelector('h3'); bad = (h ? h.textContent + ' | ' : '') + (p.closest('tr') || p).innerText.replace(/\s+/g, ' ').slice(0, 140); break; }
            const e2 = document.getElementById(id); if (e2) { e2.value = old; e2.dispatchEvent(new Event('input', { bubbles: true })); e2.dispatchEvent(new Event('change', { bubbles: true })); }
            return { bad }; }, [id, v]), new Promise((_, rej) => setTimeout(() => rej(new Error('hang')), 60000))]);
      } catch (e) { fails.push(tab + ' ' + id + '=' + v + ': ' + (/hang/.test(e.message) ? 'HANG (over 60 s)' : 'CRASH ' + e.message.split('\n')[0])); await pg.context().close().catch(() => {}); pg = await fresh(tab); continue; }
      const ms = Date.now() - t0, pe = errs.slice(e0);
      if (res.gone) continue;
      if (pe.length || res.bad || ms > slowMs) fails.push(tab + ' ' + id + '=' + v + ': ' + (pe.length ? 'PAGEERROR ' + pe[0] + ' ' : '') + (res.bad ? 'TEXT "' + res.bad + '" ' : '') + (ms > slowMs ? 'SLOW ' + ms + ' ms' : ''));
    }
    await pg.context().close();
  }
  fails.forEach(f => console.log('FAIL ' + f));
  console.log('extremes_ui: ' + n + ' settings on ' + tabs.length + ' tabs, ' + (fails.length ? fails.length + ' FAIL' : 'all pass'));
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
