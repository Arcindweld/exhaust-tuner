// Cam events at 0.050 in (4-Stroke tab, "Cam events measured at"): the simulations stretch the sin² lift so it passes
// 0.050 in at the card's angles. Seat timing (the default) leaves the spec as it was. The page's arithmetic matches
// make_wam.py seat_events (LS3: 204/211 at 0.050 in, 117 LSA, 4 deg advanced -> seat 13.7 / 59.7 / 72.9 / 10.9).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html'); await pg.waitForTimeout(500);
  const seat = await pg.evaluate(() => window.__sim.camSeat({ ivo: -11, ivc: 35, evo: 46.5, evc: -15.5, checkLift_mm: 1.27 }, 14.0, 13.26));
  ok(JSON.stringify(seat) === JSON.stringify({ ivo: 13.7, ivc: 59.7, evo: 72.9, evc: 10.9 }), 'LS3 0.050 in events to seat events, as make_wam.py: ' + JSON.stringify(seat));
  const same = await pg.evaluate(() => window.__sim.camSeat({ ivo: 32, ivc: 44, evo: 48, evc: 20 }, 8.7, 8.0));
  ok(JSON.stringify(same) === JSON.stringify({ ivo: 32, ivc: 44, evo: 48, evc: 20 }), 'no check lift: the events unchanged');
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(400);
  await pg.click('#m-expert');
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  // a 6.2 L LS3, 4 primaries per collector
  await pg.selectOption('#f-n', '4');
  for (const [id, v] of [['#f-rpm', '6000'], ['#f-evo', '60'], ['#f-dp', '1.875'], ['#f-disp', '376'], ['#f-cyl', '8'], ['#f-trq', '4600'], ['#f-bore', '4.065'], ['#f-stroke', '3.622'], ['#f-cratio', '10.7']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
  await pg.waitForTimeout(300);
  const spec = () => pg.evaluate(() => { const q = window.__sim.inp ? window.__sim.inp() : null; const sp = q ? window.__sim.simSpec(q) : null; return { q: q && { camAt: q.camAt }, cam: sp && sp.e && sp.e.cam }; });
  let s = await spec();
  ok(s.q && s.q.camAt === 'seat' && s.cam && !('checkLift_mm' in s.cam), 'default seat timing: no check lift in the spec (results unchanged)');
  await setv('f-evo', '46.5'); await setv('f-ivo', '-11'); await setv('f-ivc', '35'); await setv('f-evc', '-15.5'); await setv('f-camat', '050'); await pg.waitForTimeout(200);
  s = await spec();
  ok(s.q.camAt === '050' && s.cam && s.cam.checkLift_mm === 1.27, '0.050 in: checkLift_mm 1.27 in the spec (' + JSON.stringify(s.cam) + ')');
  const hint = await pg.$eval('#f-cam-hint', e => e.textContent);
  ok(/passes 0\.050 in at these angles/.test(hint), 'the cam hint says how 0.050 in timing is used');
  await setv('f-ivo', ''); await setv('f-ivc', ''); await setv('f-evc', ''); await pg.waitForTimeout(150);
  const err = await pg.evaluate(() => window.__sim.inp ? window.__sim.simCheck(window.__sim.inp()) : null);
  ok(/0\.050 in lift, enter all four/.test(err || ''), 'blank intake events refused at 0.050 in: ' + err);
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
