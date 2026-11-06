// Sound tab, "Hear each part" with a crossover: the whole V8 (Headers tab, unequal lengths, two banks), the line after
// each collector, and the Crossover tab's H-pipe, then its X-pipe. The crossover is its own step; it changes the orders
// (the bank-to-bank pulse pattern) more than the level; the X and the H differ; both exits are summed.
//   node tests/wsndxo_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(900); await pg.click('#u-met'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(400); await pg.selectOption('#h-lenmode', 'unequal'); await pg.waitForTimeout(400);
  await pg.click('#tab-cross'); await pg.waitForTimeout(400); await pg.selectOption('#x-type', 'h'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400);
  await pg.selectOption('select.wamline[data-k="on"]', '1'); await pg.waitForTimeout(200); await pg.selectOption('select.wamline[data-k="xo"]', 'tab'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(500);
  await pg.fill('#wsnd-rpms', '2500'); await pg.dispatchEvent('#wsnd-rpms', 'change');
  const steps = async () => { await pg.evaluate(() => { window.__wsndSets = null; }); await pg.click('button[data-wsnd="parts"]'); await pg.waitForFunction(() => window.__wsndSets, null, { timeout: 900000 });
    return pg.evaluate(() => window.__wsndSets.map(s => ({ key: s.key, label: s.label, what: s.what, x: s.runs[0] && { err: s.runs[0].err, exits: s.runs[0].exits, spl: s.runs[0].spl24 } }))); };
  const aw = f => { const f2 = f * f, n = 12194 ** 2 * f2 * f2, d = (f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2); return 20 * Math.log10(n / d) + 2; };
  const LA = x => 10 * Math.log10(x.spl.reduce((a, L, i) => a + Math.pow(10, (L + aw((i + 1) / 2 * 2500 / 60)) / 10), 0));
  const dMax = (a, c) => Math.max(...a.spl.slice(0, 12).map((v, i) => Math.abs(v - c.spl[i])));
  const H = await steps();
  ok(H.map(s => s.key).join() === 'open,line,xo' && /H-pipe/.test(H[2].label + H[2].what), 'Hear each part: open, + line, + the H-pipe (' + H.map(s => s.label).join(' / ') + ')');
  ok(H.every(s => s.x && !s.x.err && s.x.exits === 2 && s.x.spl.every(Number.isFinite)), 'every step ran with both banks’ exits summed');
  const notes = await pg.evaluate(() => window.__wsnd.WSND.notes.join(' '));
  ok(!/crossover/i.test(notes), 'no note that the crossover was left out (' + (notes || 'none') + ')');
  const dH = dMax(H[2].x, H[1].x), lvH = LA(H[2].x) - LA(H[1].x);
  ok(dH > 5, 'the H-pipe changes the orders up to order 6 by up to ' + dH.toFixed(0) + ' dB (overall ' + (lvH >= 0 ? '+' : '') + lvH.toFixed(1) + ' dB(A))');
  await pg.click('#tab-cross'); await pg.waitForTimeout(300); await pg.selectOption('#x-type', 'x'); await pg.waitForTimeout(300); await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(400);
  const X = await steps();
  ok(/X-pipe/.test(X[2].label + X[2].what), 'with the Crossover tab on an X-pipe the step is the X (' + X[2].label + ')');
  ok(Math.abs(LA(X[1].x) - LA(H[1].x)) < 0.5 && dMax(X[2].x, H[2].x) > 3, 'the X and the H sound different (largest order difference ' + dMax(X[2].x, H[2].x).toFixed(0) + ' dB) with the same line before them');
  // the H's tube on the solver: both crossovers settle to finite flows
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'wsndxo_ui: ' + fails.length + ' FAIL' : 'wsndxo_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
