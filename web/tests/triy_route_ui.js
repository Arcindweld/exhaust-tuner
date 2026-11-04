// "Auto-route a two-stage header" (Headers tab, Fusion): for the LS 8-4-1 the page sends the add-in mode 'triy',
// the four pairs as port indices in cylinder order, the primary length to the Y, the Y merge and secondary lengths,
// the secondary OD and the collector, and tells the user the order to select the markers in.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, JSON.parse(d)]); return new Promise(() => {}); } }; });
  const pg = await ctx.newPage(); const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#headers'); await pg.waitForTimeout(700);
  await pg.click('#m-expert');
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await setv('h-eng', 'ls'); await setv('h-grp', 'all'); await setv('h-merge', 'triy'); await pg.waitForTimeout(300);
  ok(!!(await pg.$('#fx-headers button[data-fx="routeTriY"]')), 'the two-stage route button is there');
  await pg.click('#fx-headers button[data-fx="routeTriY"]'); await pg.waitForTimeout(300);
  const sent = await pg.evaluate(() => window.__sent.filter(x => x[0] === 'route').map(x => x[1]));
  const d = sent[0] || {};
  ok(d.mode === 'triy' && JSON.stringify(d.groups) === JSON.stringify([[0, 6], [4, 2], [7, 1], [5, 3]]), 'mode triy, pairs 1+7, 5+3, 8+2, 6+4 as indices of cylinders 1..8: ' + JSON.stringify(d.groups));
  const r = await pg.evaluate(() => window.__hdrLast());
  const seg = n => r.r.segs.find(x => x.name === n).len;
  ok(Math.abs(d.target_mm - seg('First section')) < 1e-9 && Math.abs(d.sec_target_mm - seg('Secondary')) < 1e-9 && Math.abs(d.y_len_mm - seg('Y merge')) < 1e-9, 'lengths: primary to the Y, Y merge, secondary from the layout');
  ok(Math.abs(d.sec_od_mm - (r.r.dsec + 2 * 1.651)) < 0.01 && d.collector_len_mm > 0 && Math.abs(d.collector_out_mm - (r.r.dc + 2 * 1.651)) < 0.01, 'secondary OD and collector from the layout');
  const note = await pg.$eval('#fx-out-headers', e => e.innerText);
  ok(/cylinders 1, 2, 3, 4, 5, 6, 7, 8 in that order/.test(note) && /1 \+ 7, 5 \+ 3, 8 \+ 2, 6 \+ 4/.test(note), 'the note gives the selection order');
  // a 4-1 refuses
  await setv('h-merge', 'direct'); await pg.waitForTimeout(300);
  await pg.click('#fx-headers button[data-fx="routeTriY"]'); await pg.waitForTimeout(200);
  ok(/two-stage one/.test(await pg.$eval('#fx-out-headers', e => e.innerText)), 'without a two-stage merge it says what to set');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
