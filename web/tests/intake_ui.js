const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const bad = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object/;
  for (const [vp, w] of [['phone', 390], ['desk', 1280]]) {
    const pg = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + process.cwd()+'/index.html#intake'); await pg.click('#m-expert'); await pg.waitForTimeout(200);
    const t0 = await pg.evaluate(() => document.querySelector('#panel-intake').innerText);
    ok(/Airflow and tube size/i.test(t0) && /Inlet end and bellmouth/i.test(t0) && /Induction sound/i.test(t0) && /Cold air layout/i.test(t0), vp + ': intake sections shown');
    ok(!bad.test(t0), vp + ': no NaN');
    for (const ind of ['turbo', 'centri', 'pd', 'na']) { await pg.selectOption('#i-ind', ind); await pg.waitForTimeout(80); const t = await pg.evaluate(() => document.querySelector('#panel-intake').innerText); ok(!bad.test(t) && (ind === 'na' || /Boosted intake/i.test(t)), vp + ': induction ' + ind + ' renders'); }
    for (const mf of ['housing', 'sd', 'card']) { await pg.selectOption('#i-maf', mf); await pg.waitForTimeout(80); const t = await pg.evaluate(() => document.querySelector('#panel-intake').innerText); ok(!bad.test(t) && /Mass airflow sensor placement/i.test(t), vp + ': MAF ' + mf + ' renders'); }
    for (const fl of ['cyl', 'oval', 'panel', 'cone']) { await pg.selectOption('#i-filt', fl); await pg.waitForTimeout(60); const t = await pg.evaluate(() => document.querySelector('#panel-intake').innerText); ok(!bad.test(t) && /This filter flows/.test(t), vp + ': filter ' + fl + ' renders'); }
    for (const ty of ['cone', 'box', 'itb', 'cai']) { await pg.selectOption('#i-type', ty); await pg.waitForTimeout(80); const t = await pg.evaluate(() => document.querySelector('#panel-intake').innerText); ok(!bad.test(t) && /Induction sound/i.test(t), vp + ': type ' + ty + ' renders'); }
    await pg.selectOption('#i-filt', 'panel'); await pg.waitForTimeout(60); ok((await pg.textContent('#i-fd-lab')) === 'Filter length', vp + ': panel filter labels');
    await pg.click('#u-met'); await pg.waitForTimeout(80); let t = await pg.evaluate(() => document.querySelector('#panel-intake').innerText); ok(!bad.test(t), vp + ': metric fine');
    const v = await pg.$$eval('#v-pick option', os => os.map(o => [o.value, o.textContent]));
    await pg.selectOption('#v-pick', v.find(x => /Civic Type R/.test(x[1]))[0]); await pg.waitForTimeout(150);
    t = await pg.evaluate(() => document.querySelector('#panel-intake').innerText); ok(!bad.test(t), vp + ': after preset fine');
    ok(await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, vp + ': fits width');
    if (vp === 'phone') await pg.screenshot({ path: 'intake-phone.png', fullPage: true });
    ok(errs.length === 0, vp + ': no page errors ' + errs.join('|'));
  }
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();
