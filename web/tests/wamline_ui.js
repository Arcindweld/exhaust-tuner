// The line after the collector for the OpenWAM case (4-Stroke tab, Run it in OpenWAM): pipe, J-pipe or Helmholtz can,
// muffler and tailpipe reach the case as make_wam tail elements; off by default (the case unchanged).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(400); await pg.click('#m-expert');
  await pg.selectOption('#f-n', '4');
  for (const [id, v] of [['#f-rpm', '6000'], ['#f-evo', '60'], ['#f-dp', '1.875'], ['#f-disp', '376'], ['#f-cyl', '8'], ['#f-trq', '4600'], ['#f-bore', '4.065'], ['#f-stroke', '3.622'], ['#f-cratio', '10.7']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
  await pg.waitForTimeout(400);
  const wam = () => pg.evaluate(() => { try { const q = window.__sim.inp(); return window.__wamFiles(q, window.__sim.simSpec(q)).files[0].text; } catch (e) { return 'ERR ' + e.message; } });
  let t = await wam();
  ok(!/side branch|muffler|closed end/.test(t) && !/^ERR/.test(t), 'off: the case ends at the collector as before');
  await pg.selectOption('select.wamline[data-k="on"]', '1'); await pg.waitForTimeout(250);
  await pg.selectOption('select.wamline[data-k="fix"]', 'jpipe'); await pg.waitForTimeout(250);
  await pg.fill('input.wamline[data-k="muf"]', '6'); await pg.dispatchEvent('input.wamline[data-k="muf"]', 'input');
  await pg.fill('input.wamline[data-k="qL"]', '24'); await pg.dispatchEvent('input.wamline[data-k="qL"]', 'input');
  t = await wam();
  ok(/side branch 1, quarter-wave tube/.test(t) && /side branch 1 closed end|closed end/.test(t) && /muffler 1 as a 6 litre expansion volume/.test(t), 'J-pipe and a 6 L muffler in the case');
  ok(/609\.6|0\.6096/.test(t), 'the J-pipe is 24 in (609.6 mm) long');
  await pg.selectOption('select.wamline[data-k="fix"]', 'helm'); await pg.waitForTimeout(250);
  t = await wam();
  ok(/Helmholtz 2 litres/.test(t) && /Helmholtz neck/.test(t), 'Helmholtz can (2 L) on its neck in the case');
  await pg.fill('input.wamline[data-k="x"]', '200'); await pg.dispatchEvent('input.wamline[data-k="x"]', 'input');
  t = await wam();
  ok(/^ERR .*has to sit on the pipe/.test(t), 'a drone fix past the pipe is refused: ' + t.slice(0, 120));
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
