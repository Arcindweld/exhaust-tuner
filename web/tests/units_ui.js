// Units: switching inches / mm back and forth must not move any value, and the results must not depend on the units
// (the same input in either units gives the same answer). On every tab: each field's base value (mm, °C, cc, kPa, kg)
// before, after 5 round trips, and the tab's key figures in metric before and after.  node tests/units_ui.js  (from web/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = []; const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html'); await pg.waitForTimeout(700);
  const tabs = await pg.evaluate(() => [...document.querySelectorAll('[data-tab]')].map(x => x.dataset.tab).filter((v, i, a) => a.indexOf(v) === i));
  const snap = () => pg.evaluate(() => { const sec = document.querySelector('section.panel:not([hidden])'); if (!sec) return { ins: [], figs: '' };
    const ins = [...sec.querySelectorAll('input[data-kind]')].filter(i => i.id).map(i => [i.id, i._b, i.classList.contains('oor')]);
    const figs = [...sec.querySelectorAll('.figs, .r dd, td')].slice(0, 400).map(x => x.innerText.replace(/\s+/g, ' ')).join(' | ');
    return { ins, figs }; });
  let n = 0;
  for (const tab of tabs) {
    await pg.evaluate(t => { location.hash = t; }, tab); await pg.waitForTimeout(350);
    await pg.click('#u-met'); await pg.waitForTimeout(250);
    const a = await snap();
    for (let k = 0; k < 5; k++) { await pg.click('#u-imp'); await pg.waitForTimeout(120); await pg.click('#u-met'); await pg.waitForTimeout(120); }
    const z = await snap();
    for (const [id, v, oor] of a.ins) { const w = z.ins.find(x => x[0] === id); n++;
      if (!w) continue;
      const same = (Number.isNaN(v) && Number.isNaN(w[1])) || v === w[1] || Math.abs(v - w[1]) <= 1e-9 * Math.max(1, Math.abs(v));
      ok(same, tab + ' ' + id + ': ' + v + ' became ' + w[1] + ' after 5 round trips');
      ok(oor === w[2], tab + ' ' + id + ': out-of-range mark changed');
    }
    ok(a.figs === z.figs, tab + ': the results changed after the round trips' + (a.figs !== z.figs ? ' (first difference near "' + (() => { let i = 0; while (i < a.figs.length && a.figs[i] === z.figs[i]) i++; return a.figs.slice(Math.max(0, i - 60), i + 60); })() + '")' : ''));
    // a value typed in inches gives the same answer as the same value in mm
    await pg.click('#u-imp'); await pg.waitForTimeout(200);
    const fieldOk = await pg.evaluate(() => { const sec = document.querySelector('section.panel:not([hidden])'); if (!sec) return null; const i = [...sec.querySelectorAll('input[data-kind="len"]')].find(x => x.offsetParent && x._b > 0); if (!i) return null;
      const b0 = i._b; i.value = String(+(b0 / 25.4).toFixed(6)); i.dispatchEvent(new Event('input', { bubbles: true })); return { id: i.id, b0, b1: i._b }; });
    if (fieldOk) ok(Math.abs(fieldOk.b1 - fieldOk.b0) < 1e-3, tab + ' ' + fieldOk.id + ': typed in inches reads ' + fieldOk.b1 + ' mm, was ' + fieldOk.b0);
    await pg.click('#u-met'); await pg.waitForTimeout(150);
  }
  ok(!errs.length, 'page errors: ' + errs.join(' | '));
  fails.slice(0, 40).forEach(f => console.log('FAIL ' + f));
  console.log('units_ui: ' + n + ' fields on ' + tabs.length + ' tabs, ' + (fails.length ? fails.length + ' FAIL' : 'all pass'));
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
