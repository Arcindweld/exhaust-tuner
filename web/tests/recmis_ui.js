// Sound tab, a recording's misfire check (recMisfire): the orders below the firing order much stronger than the healthy
// model at a hold are flagged; an engine like the model is not; quiet (noise-level) orders do not count.
// node tests/recmis_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext()).newPage(); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#sound'); await pg.waitForTimeout(900);
  const r = await pg.evaluate(() => { const f = window.__rec.recMisfire;
    const model = { 0.5: -40, 1: -35, 1.5: -38, 2: 0, 2.5: -30, 3: -20, 4: -6 };
    const mk = (l05, l1, l15, snr) => ({ lev: { 0.5: l05, 1: l1, 1.5: l15, 2: 0, 2.5: -29, 3: -21, 4: -5 }, snr: { 0.5: snr, 1: snr, 1.5: snr, 2: 30, 2.5: 20, 3: 20, 4: 20 } });
    return { dead: f(mk(-12, -10, -14, 15), model, 0, 2), fine: f(mk(-38, -33, -37, 15), model, 0, 2), noise: f(mk(-12, -10, -14, 3), model, 0, 2), one: f(mk(-12, -33, -37, 15), model, 0, 2), nomodel: f(mk(-12, -10, -14, 15), null, 0, 2) }; });
  ok(r.dead && r.dead.orders.join() === '0.5,1,1.5' && /misfire/.test(r.dead.t), 'strong half orders against the model are flagged (' + (r.dead && r.dead.t.slice(0, 70)) + ')');
  ok(r.fine === null, 'an engine like the healthy model is not');
  ok(r.noise === null, 'orders at the noise floor do not count');
  ok(r.one === null, 'one strong order alone is not enough');
  ok(r.nomodel === null, 'without a model to compare there is no verdict');
  await b.close(); console.log(fails.length ? 'recmis_ui: ' + fails.length + ' FAIL' : 'recmis_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
