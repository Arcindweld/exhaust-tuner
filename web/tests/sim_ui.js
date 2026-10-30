const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage(); pg.on('pageerror', e => out.push('PAGEERROR ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/fonts|net::/.test(m.text())) out.push('console ' + m.text()); });
  await pg.goto('file://' + process.cwd()+'/index.html#four-stroke');
  await pg.click('#m-expert');
  // a 450 single with a chamber
  await pg.selectOption('#f-n', '1');
  for (const [id, v] of [['#f-rpm', '8500'], ['#f-evo', '65'], ['#f-dp', '1.65'], ['#f-disp', '27.4'], ['#f-cyl', '1'], ['#f-trq', '7000'], ['#f-bore', '3.74'], ['#f-stroke', '2.496'], ['#f-cratio', '13']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
  await pg.selectOption('#f-valves', '4');
  await pg.selectOption('#f-ch', 'can');
  const t0 = Date.now();
  await pg.click('button[data-sim="run"]');
  await pg.waitForTimeout(500);
  out.push('status while running: ' + await pg.evaluate(() => (document.getElementById('sim-status') || {}).textContent));
  await pg.waitForFunction(() => !document.getElementById('sim-status') && document.getElementById('sim-svg'), null, { timeout: 120000 });
  out.push('finished in ' + (Date.now() - t0) + ' ms');
  const sec = await pg.evaluate(() => { const h = [...document.querySelectorAll('#four-details .sec h3')].find(x => /Wave simulation/i.test(x.textContent)); return h ? h.parentElement.innerText : 'none'; });
  out.push(sec.replace(/\n+/g, ' | ').slice(0, 1800));
  await pg.screenshot({ path: 'sim-desk.png', fullPage: true });
  // change an input: results should be marked stale
  await pg.fill('#f-rpm', '9000'); await pg.dispatchEvent('#f-rpm', 'input');
  out.push('stale note: ' + await pg.evaluate(() => /inputs changed/i.test(document.getElementById('four-details').innerText)));
  await b.close(); console.log(out.join('\n'));
})();
