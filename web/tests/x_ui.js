const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const bad = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object/;
  for (const [vp, w] of [['phone', 390], ['desk', 1280]]) {
    const pg = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + process.cwd()+'/index.html');
    await pg.evaluate(() => location.hash = 'crossover'); await pg.click('#m-expert');
    await pg.selectOption('#x-type', 'x'); await pg.waitForTimeout(100);
    let t = await pg.evaluate(() => document.querySelector('#panel-cross').innerText);
    ok(/X-pipe build sheet/i.test(t) && /First bend, toward the centre/.test(t) && /How the crossing angle changes the build/i.test(t), vp + ': build sheet and angle table shown');
    ok(/mirror images/.test(t) && /Shared opening/.test(t), vp + ': symmetry and shared opening noted');
    ok(!bad.test(t), vp + ': no NaN');
    await pg.fill('#x-ang', '35'); await pg.waitForTimeout(80); t = await pg.evaluate(() => document.querySelector('#panel-cross').innerText);
    ok(/turns hard into the cross/.test(t), vp + ': steep angle warns');
    await pg.fill('#x-ang', '20'); await pg.fill('#x-mrg', '0'); await pg.waitForTimeout(80); t = await pg.evaluate(() => document.querySelector('#panel-cross').innerText);
    ok(/cross straight through/.test(t) && /Crossing\s+straight through/.test(t), vp + ': no-merge crossing explained');
    ok(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, vp + ': fits width');
    if (vp === 'phone') { await pg.fill('#x-mrg', '1'); await pg.waitForTimeout(80); await pg.locator('#x-details .sec').filter({ has: pg.locator('h3', { hasText: /build sheet/i }) }).screenshot({ path: 'x-sheet-phone.png' }); }
    ok(errs.length === 0, vp + ': no page errors ' + errs.join('|'));
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();
