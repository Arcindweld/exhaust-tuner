// Browser checks for the collector (multi-cylinder) wave simulation on the 4-Stroke tab
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); let fails = 0;
  const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
  const bad = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object/;
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd()+'/index.html');
  const secTxt = () => pg.evaluate(() => { const h = [...document.querySelectorAll('#four-details .sec h3')].find(x => /Wave simulation/i.test(x.textContent)); return h ? h.parentElement.innerText : ''; });
  // a small-block Chevy preset fills a cross-plane bank's gaps
  const v = await pg.$$eval('#v-pick option', os => os.map(o => [o.value, o.textContent]));
  const sbcCar = v.find(x => x[0] !== '' && /Camaro|Corvette|Chevelle|Nova|Z28|SS/.test(x[1]));
  await pg.selectOption('#v-pick', sbcCar[0]);
  await pg.evaluate(() => location.hash = 'four-stroke'); await pg.click('#m-expert'); await pg.waitForTimeout(100);
  const fn = await pg.inputValue('#f-n'), fg = await pg.inputValue('#f-gaps');
  console.log('preset', sbcCar[1], 'f-n', fn, 'gaps', JSON.stringify(fg));
  ok(fn === '4' && (fg === '270, 180, 90, 180' || fg === ''), 'V8 preset sets 4 primaries and fills the bank gaps');
  ok(await pg.isVisible('#f-gaps'), 'gaps input shown with a collector');
  let t = await secTxt();
  ok(/model of the 4 cylinders on this collector/.test(t), 'sim text names the 4 cylinders on the collector');
  // bad gaps give a warning
  await pg.fill('#f-gaps', '270, 180, 90'); await pg.waitForTimeout(80); t = await secTxt();
  ok(/Give one gap between firings for each of the 4 primaries/.test(t), 'wrong gap count warns');
  await pg.fill('#f-gaps', '270, 180, 90, 170'); await pg.waitForTimeout(80); t = await secTxt();
  ok(/add up to 720/.test(t), 'gaps not adding to 720 warn');
  await pg.fill('#f-gaps', '270, 180, 90, 180'); await pg.waitForTimeout(80); t = await secTxt();
  ok(/with gaps of 270, 180, 90, 180°/.test(t), 'uneven gaps described');
  const t0 = Date.now();
  await pg.click('button[data-sim="run"]');
  await pg.waitForTimeout(2500);
  const st = await pg.evaluate(() => (document.getElementById('sim-status') || {}).textContent || '');
  console.log('status', st);
  ok(/side by side|Running/.test(st), 'progress shows while running');
  await pg.waitForFunction(() => !document.getElementById('sim-status') && document.getElementById('sim-svg'), null, { timeout: 240000 });
  console.log('run took', ((Date.now() - t0) / 1000).toFixed(1), 's');
  t = await secTxt();
  console.log(t.split('\n').filter(l => /more at|less at|no gain|Cylinder to cylinder|Average/.test(l)).join('\n'));
  ok(/Cylinder to cylinder/.test(t), 'cylinder-to-cylinder note shown');
  ok(/Fed every 180°, as a 180° header does:/.test(t), 'evenly fed variant compared for a cross-plane bank');
  ok((await pg.$$eval('#sim-svg polyline:not(.brake)', ps => ps.length)) === 4, 'four lines drawn');
  ok((await pg.$$eval('#sim-svg polyline.brake', ps => ps.length)) === 1, 'and the first design\'s brake torque, dotted (2026-11-12 part 2)');
  ok(!bad.test(t), 'no NaN or undefined in the results');
  // even firing
  await pg.fill('#f-gaps', ''); await pg.waitForTimeout(80); t = await secTxt();
  ok(/evenly, every 180°/.test(t) && /inputs changed since this run/.test(t), 'blank gaps means even, and old results are marked stale');
  ok(!/fed at even gaps/.test(t), 'no evenly fed variant when the firing is already even');
  // a single hides the gaps
  await pg.selectOption('#f-n', '1'); await pg.waitForTimeout(80);
  ok(await pg.isHidden('#f-gaps'), 'gaps hidden for a single');
  t = await secTxt(); ok(/one-cylinder/.test(t), 'single keeps the one-cylinder text');
  // more primaries than cylinders
  await pg.selectOption('#f-n', '8'); await pg.fill('#f-cyl', '4'); await pg.waitForTimeout(80); t = await secTxt();
  ok(/fewer than the 8 primaries/.test(t), 'more primaries than cylinders warns');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ' (' + errs.join(' | ') + ')' : ''));
  await pg.screenshot({ path: 'multi-sim.png', fullPage: false });
  await b.close(); console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
})();
