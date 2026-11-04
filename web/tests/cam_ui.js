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
  // the intake: runners from a plenum through a throttle body, in the OpenWAM case
  await setv('f-ivo', '-11'); await setv('f-ivc', '35'); await setv('f-evc', '-15.5');
  ok(await pg.$eval('#f-intk-wrap', e => e.hidden), 'plenum inputs hidden for open runners');
  await setv('f-intk', 'plenum'); await pg.waitForTimeout(200);
  ok(!(await pg.$eval('#f-intk-wrap', e => e.hidden)), 'plenum inputs shown');
  const ip = await pg.evaluate(() => { const sp = window.__sim.simSpec(window.__sim.inp()); return { pl: sp.intake.plenum, wam: window.WamExport.makeWam(sp, { rpm: 5000, cycles: 5, name: 't' }) }; });
  ok(ip.pl && Math.abs(ip.pl.V_m3 - 0.006) < 1e-12 && ip.pl.inlet.length === 2 && Math.abs(ip.pl.inlet[1].d0 - 0.09) < 1e-12, 'spec: 6 L plenum, 90 mm throttle body, inlet tube (' + JSON.stringify(ip.pl) + ')');
  ok(/intake plenum, 6 litres/.test(ip.wam) && /intake inlet part 2 pipe \d+, diameter step BC\d+ to plenum port/.test(ip.wam) && /cylinder 1 intake runner pipe 1, plenum port BC1 to intake valve/.test(ip.wam), 'the OpenWAM case has the plenum, its inlet through the throttle-body step, and the runners from it');
  await setv('f-plv', ''); await pg.waitForTimeout(150);
  const perr = await pg.evaluate(() => window.__sim.simCheck(window.__sim.inp()));
  ok(/With a plenum, fill in its volume/.test(perr || ''), 'a plenum without a volume refused: ' + perr);
  // the stock engine and cam library
  await setv('f-intk', 'open'); await setv('f-plv', '6');
  await setv('f-camlib', 'ls3'); await pg.waitForTimeout(250);
  const ls3 = await pg.evaluate(() => { const sp = window.__sim.simSpec(window.__sim.inp()); return { e: sp.e, hint: document.getElementById('f-camlib-hint').textContent, at: document.getElementById('f-camat').value }; });
  ok(JSON.stringify([ls3.e.cam.ivo, ls3.e.cam.ivc, ls3.e.cam.evo, ls3.e.cam.evc, ls3.e.cam.checkLift_mm]) === JSON.stringify([-19, 43, 38, -7, 1.27]) && ls3.at === '050', 'LS3: GM events at 0.050 in (' + JSON.stringify(ls3.e.cam) + ')');
  ok(Math.abs(ls3.e.dIn - 0.054991) < 1e-6 && Math.abs(ls3.e.dEx - 0.040386) < 1e-6 && Math.abs(ls3.e.liftIn - 0.0139954) < 1e-6 && Math.abs(ls3.e.liftEx - 0.013335) < 1e-6, 'LS3 valves 2.165 / 1.590 in and lift .551 / .525 in');
  ok(Math.abs(ls3.e.bore - 0.103251) < 1e-6 && ls3.e.cr === 10.7, 'LS3 bore and compression');
  ok(/as published/.test(ls3.hint) && /Corvette Action Center/.test(ls3.hint) && /204° \/ 211°/.test(ls3.hint), 'LS3 hint: as published, 204 / 211, with its source');
  await setv('f-camlib', 'ls7'); await pg.waitForTimeout(250);
  const ls7 = await pg.$eval('#f-camlib-hint', e => e.textContent);
  ok(/assumed/.test(ls7) && /210° \/ 230°/.test(ls7) && /lobe separation 120\.0°/.test(ls7), 'LS7: durations and LSA from the source, timing assumed straight up');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
