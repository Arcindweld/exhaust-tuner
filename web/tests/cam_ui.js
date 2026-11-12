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
  const ip = await pg.evaluate(() => { const q = window.__sim.inp(), sp = window.__sim.simSpec(q); return { pl: sp.intake.plenum, share: Math.min(1, (q.n > 1 ? Math.round(q.n) : 1) / q.cyl), wam: window.WamExport.makeWam(sp, { rpm: 5000, cycles: 5, name: 't' }) }; });
  // since 2026-11-12 part 3 the cylinders simulated get their share of the whole engine's 6 L plenum, 90 mm throttle and tube
  // (the share of the volume and of the areas), and the wave model's throttle orifice its wide-open coefficient 0.83
  const sh = ip.share, lit = +(6 * sh).toPrecision(6);
  ok(ip.pl && Math.abs(ip.pl.V_m3 - 0.006 * sh) < 1e-12 && ip.pl.inlet.length === 2 && Math.abs(ip.pl.inlet[1].d0 - 0.09 * Math.sqrt(sh)) < 1e-12 && ip.pl.throttle.cd === 0.83 && Math.abs(ip.pl.throttle.d - 0.09 * Math.sqrt(sh)) < 1e-12 && !ip.pl.filter,
    'spec: the simulated cylinders\' share ' + sh + ' of a 6 L plenum, 90 mm throttle body (Cd 0.83 at wide open), inlet tube, no filter loss (' + JSON.stringify(ip.pl) + ')');
  ok(new RegExp('intake plenum, ' + String(lit).replace('.', '\\.') + ' litres').test(ip.wam) && /intake inlet part 2 pipe \d+, diameter step BC\d+ to plenum port/.test(ip.wam) && /cylinder 1 intake runner pipe 1, plenum port BC1 to intake valve/.test(ip.wam), 'the OpenWAM case has the plenum (' + lit + ' L), its inlet through the throttle-body step, and the runners from it');
  await setv('f-fdp', '0.2'); await pg.waitForTimeout(150);
  const fl = await pg.evaluate(() => window.__sim.simSpec(window.__sim.inp()).intake.plenum.filter);
  ok(fl && fl.dp > 1300 && fl.dp < 1450 && fl.m > 0, 'a filter loss entered (0.2 psi) reaches the wave spec in Pa with its reference airflow: ' + JSON.stringify(fl));
  await setv('f-fdp', '0');
  await setv('f-plv', ''); await pg.waitForTimeout(150);
  const perr = await pg.evaluate(() => window.__sim.simCheck(window.__sim.inp()));
  ok(/With a plenum, fill in its volume/.test(perr || ''), 'a plenum without a volume refused: ' + perr);
  // the stock engine and cam library
  await setv('f-intk', 'open'); await setv('f-plv', '366.14');
  await setv('f-camlib', 'ls3'); await pg.waitForTimeout(250);
  const ls3 = await pg.evaluate(() => { const sp = window.__sim.simSpec(window.__sim.inp()); return { e: sp.e, hint: document.getElementById('f-camlib-hint').textContent, at: document.getElementById('f-camat').value }; });
  ok(JSON.stringify([ls3.e.cam.ivo, ls3.e.cam.ivc, ls3.e.cam.evo, ls3.e.cam.evc, ls3.e.cam.checkLift_mm]) === JSON.stringify([-19, 43, 38, -7, 1.27]) && ls3.at === '050', 'LS3: GM events at 0.050 in (' + JSON.stringify(ls3.e.cam) + ')');
  ok(Math.abs(ls3.e.dIn - 0.054991) < 1e-6 && Math.abs(ls3.e.dEx - 0.040386) < 1e-6 && Math.abs(ls3.e.liftIn - 0.0139954) < 1e-6 && Math.abs(ls3.e.liftEx - 0.013335) < 1e-6, 'LS3 valves 2.165 / 1.590 in and lift .551 / .525 in');
  ok(Math.abs(ls3.e.bore - 0.103251) < 1e-6 && ls3.e.cr === 10.7, 'LS3 bore and compression');
  // 2026-11-12 part 3: the LS3's measured head flow (Hot Rod 2011, cfm at 28 in) as the wave model's valve areas
  ok(ls3.e.flowIn && ls3.e.flowIn.lift.length === 9 && ls3.e.flowEx.cdA.length === 9 && Math.abs(ls3.e.flowIn.lift[6] - 0.01524) < 1e-12 && Math.abs(ls3.e.flowIn.cdA[6] / 1.4322e-3 - 1) < 1e-3,
    'LS3: the head\'s flow-bench curve becomes the valves\' effective area (312 cfm at 0.600 in -> ' + (ls3.e.flowIn ? (ls3.e.flowIn.cdA[6] * 1e6).toFixed(0) : '?') + ' mm2)');
  ok(/as published/.test(ls3.hint) && /Corvette Action Center/.test(ls3.hint) && /204° \/ 211°/.test(ls3.hint), 'LS3 hint: as published, 204 / 211, with its source');
  await setv('f-camlib', 'ls7'); await pg.waitForTimeout(250);
  const ls7 = await pg.$eval('#f-camlib-hint', e => e.textContent);
  ok(/assumed/.test(ls7) && /210° \/ 230°/.test(ls7) && /lobe separation 120\.0°/.test(ls7), 'LS7: durations and LSA from the source, timing assumed straight up');
  // a cam card (duration, lobe separation, advance) to the four events: the formulas every cam calculator uses
  const ev = await pg.evaluate(() => [window.__camEvents(250, 250, 110, 0), window.__camEvents(224, 230, 112, 4), window.__camEvents(204, 211, 117, -4)]);
  ok(JSON.stringify(ev[0]) === JSON.stringify({ ivo: 15, ivc: 55, evo: 55, evc: 15 }), '250/250 on 110 straight up: 15 / 55 / 55 / 15');
  ok(JSON.stringify(ev[1]) === JSON.stringify({ ivo: 4, ivc: 40, evo: 51, evc: -1 }), '224/230 on 112, 4 advanced: 4 / 40 / 51 / -1');
  ok(JSON.stringify(ev[2]) === JSON.stringify({ ivo: -19, ivc: 43, evo: 38.5, evc: -7.5 }), 'LS3 204/211 on 117, 4 retarded: -19 / 43 / 38.5 / -7.5 (GM: -19 / 43 / 38 / -7; GM rounds its 116.75 lobe separation to 117)');
  await pg.evaluate(() => { document.querySelector('details.camcard').open = true; });
  for (const [id, v] of [['#f-cdi', '224'], ['#f-cde', '230'], ['#f-clsa', '112'], ['#f-cadv', '4']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
  await pg.click('#f-cfill'); await pg.waitForTimeout(200);
  const filled = await pg.evaluate(() => ['f-ivo', 'f-ivc', 'f-evo', 'f-evc', 'f-camlib'].map(id => id === 'f-camlib' ? document.getElementById(id).value : document.getElementById(id)._b));
  ok(JSON.stringify(filled) === JSON.stringify([4, 40, 51, -1, '']), 'the button fills the four events and clears the stock-cam pick: ' + JSON.stringify(filled));
  ok(/overlap 3°/.test(await pg.$eval('#f-ccard-hint', e => e.textContent)), 'and says what it filled');
  await pg.fill('#f-clsa', '150'); await pg.dispatchEvent('#f-clsa', 'input'); await pg.click('#f-cfill');
  ok(/lobe separation \(95 to 135/.test(await pg.$eval('#f-ccard-hint', e => e.textContent)), 'a lobe separation off the scale is refused');
  // the Headers tab: exhaust opening from the card
  await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(300);
  await pg.evaluate(() => { document.querySelectorAll('details.camcard').forEach(d => d.open = true); });
  for (const [id, v] of [['#h-cde', '250'], ['#h-clsa', '110'], ['#h-cadv', '0']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
  await pg.click('#h-cfill'); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => document.getElementById('h-evo')._b) === 55, 'Headers: 250° on 110 straight up opens the exhaust 55° BBDC');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
