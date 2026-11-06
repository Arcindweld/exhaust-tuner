// "Hear a misfire" on the Sound tab: the wave model runs the design with cylinder 1 (or collector A's cylinders) not
// burning, beside the healthy engine. A dead cylinder still pumps its charge, so the mean flow out stays close, the
// torque drops by about its share, and the half orders (once-per-cycle beats) rise against the firing order.
// node tests/wsndmis_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(900);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600);
  const opts = await pg.evaluate(() => [...document.getElementById('wsnd-dead').options].map(o => o.value));
  ok(opts[0] === 'c1', 'the misfire choice offers cylinder 1 (' + opts.join(', ') + ')');
  await pg.fill('#wsnd-rpms', '3000 5000'); await pg.dispatchEvent('#wsnd-rpms', 'change');
  await pg.evaluate(() => { window.__wsndLast = null; }); await pg.click('button[data-wsnd="misfire"]');
  await pg.waitForFunction(() => window.__wsndLast && !window.__wsnd.WSND.busy, null, { timeout: 600000 });
  const r = await pg.evaluate(() => { const W = window.__wsnd.WSND, q = window.__sim.inp();
    return { cyl: q.cyl, nSim: window.__wsnd.wsndSpec(q, {}).spec.opt.phases.length, A: W.A, B: W.B, msg: W.msg && W.msg.t, sets: W.sets.map(s => ({ key: s.key, label: s.label, runs: s.runs.map(x => ({ rpm: x.rpm, err: x.err, tq: x.tq, cyc: x.cyc && x.cyc.length ? x.cyc.reduce((a, v) => a + v, 0) / x.cyc.length : NaN, spl: x.spl24 })) })) }; });
  ok(r.sets.length === 2 && r.sets[0].key === 'dead' && r.sets[1].key === 'full' && r.A === 1 && r.B === 0, 'two designs, A all firing and B the misfire');
  ok(/once-per-cycle/.test(r.msg || ''), 'the message says what to listen for');
  const [D, F] = r.sets;
  F.runs.forEach((f, i) => { const d = D.runs[i];
    ok(!f.err && !d.err, f.rpm + ' RPM: both ran');
    if (f.err || d.err) return;
    const share = 1 - d.tq / f.tq;
    ok(share > 0.6 / r.nSim && share < 1.6 / r.nSim, f.rpm + ' RPM: torque drops by about one cylinder’s share (' + (100 * share).toFixed(0) + '%, one of the ' + r.nSim + ' simulated)');
    ok(Math.abs(+d.cyc / +f.cyc - 1) < 0.25, f.rpm + ' RPM: the dead cylinder still pumps (mean flow out ' + d.cyc.toFixed(3) + ' vs ' + f.cyc.toFixed(3) + ' kg/s)');
    const kf = r.nSim / 2, half = s => Math.max(...[0, 2, 4].map(i => s[i])), fire = s => s[2 * kf - 1];   // orders 0.5, 1.5, 2.5; the firing order (pulses a revolution) at index 2·kf − 1
    const gF = fire(f.spl) - half(f.spl), gD = fire(d.spl) - half(d.spl);
    ok(gD < gF - 6, f.rpm + ' RPM: the half orders close in on the firing order (' + gF.toFixed(1) + ' dB below it healthy, ' + gD.toFixed(1) + ' dB with the misfire)');
  });
  // the whole V8 on the Headers tab (two collectors): a dead bank
  await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(400); await pg.selectOption('#h-lenmode', 'unequal'); await pg.waitForTimeout(400);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(500);
  const o2 = await pg.evaluate(() => [...document.getElementById('wsnd-dead').options].map(o => o.value));
  ok(o2.includes('bank'), 'with two collectors the choice offers a dead bank (' + o2.join(', ') + ')');
  const bank = await pg.evaluate(() => { const q = window.__sim.inp(); return { dead: window.__wsnd.wsndDead(q, 'bank'), c0: window.__wsnd.wsndSpec(q, {}).spec.opt.collectors[0].cyls }; });
  ok(bank.dead.length === 4 && bank.dead.join() === bank.c0.join(), 'a dead bank is collector A’s four cylinders (' + bank.dead.join(', ') + ')');
  await pg.selectOption('#wsnd-dead', 'bank'); await pg.fill('#wsnd-rpms', '3000'); await pg.dispatchEvent('#wsnd-rpms', 'change');
  await pg.evaluate(() => { window.__wsndLast = null; }); await pg.click('button[data-wsnd="misfire"]');
  await pg.waitForFunction(() => window.__wsndLast && !window.__wsnd.WSND.busy, null, { timeout: 900000 });
  const v8 = await pg.evaluate(() => window.__wsnd.WSND.sets.map(s => ({ label: s.label, x: s.runs[0] && { err: s.runs[0].err, tq: s.runs[0].tq, exits: s.runs[0].exits } })));
  ok(v8.length === 2 && v8.every(s => s.x && !s.x.err && s.x.exits === 2), 'dead bank and healthy V8 both ran with both exits (' + v8.map(s => s.label).join(' / ') + ')');
  if (v8.every(s => s.x && !s.x.err)) { const sh = 1 - v8[0].x.tq / v8[1].x.tq; ok(sh > 0.35 && sh < 0.65, 'a dead bank takes about half the torque (' + (100 * sh).toFixed(0) + '%)'); }
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'wsndmis_ui: ' + fails.length + ' FAIL' : 'wsndmis_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
