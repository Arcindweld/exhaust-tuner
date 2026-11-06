// Sound tab, Load "No load (a free-rev hold)": the wave model closes the throttle (the intake mouth held at a manifold
// pressure) until the net IMEP meets the friction law, so the engine makes no torque; against full throttle the manifold
// is well below the air outside, the flow out is a fraction, and the tailpipe is quieter.   node tests/wsndload_ui.js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(900);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600);
  const run = async load => { await pg.selectOption('#wsnd-load', load); await pg.fill('#wsnd-rpms', '2000 3000'); await pg.dispatchEvent('#wsnd-rpms', 'change');
    await pg.evaluate(() => { window.__wsndLast = null; }); await pg.click('button[data-wsnd="run"]');
    await pg.waitForFunction(() => window.__wsndLast && !window.__wsnd.WSND.busy, null, { timeout: 900000 });
    return pg.evaluate(() => ({ msg: window.__wsnd.WSND.msg.t, runs: window.__wsndLast.map(x => ({ rpm: x.rpm, err: x.err, pMap: x.pMap, tq: x.tq, cyc: x.cyc.reduce((a, v) => a + v, 0) / x.cyc.length, L: window.__wsndLA ? null : null, spl: x.spl24 })) })); };
  const W = await run('wot'), N = await run('none');
  const q = await pg.evaluate(() => { const i = window.__sim.inp(); return { cc: i.cc, cyl: i.cyl }; });
  ok(W.runs.every(x => !x.err && x.pMap == null) && N.runs.every(x => !x.err && x.pMap > 0), 'both loads ran; only the no-load runs carry a manifold pressure');
  N.runs.forEach((x, i) => { const w = W.runs[i], pk = x.pMap / 1000;
    ok(pk > 12 && pk < 70, x.rpm + ' RPM: the manifold sits at ' + pk.toFixed(0) + ' kPa absolute (a closed throttle)');
    ok(x.cyc < 0.6 * w.cyc, x.rpm + ' RPM: the flow out is a fraction of full throttle’s (' + x.cyc.toFixed(4) + ' vs ' + w.cyc.toFixed(4) + ' kg/s)');
    ok(x.tq < 0.35 * w.tq, x.rpm + ' RPM: the indicated torque is only what friction takes (' + x.tq.toFixed(1) + ' vs ' + w.tq.toFixed(1) + ' N·m)');
    const E = s => 10 * Math.log10(s.reduce((a, L) => a + Math.pow(10, L / 10), 0));
    ok(E(x.spl) < E(w.spl) - 4, x.rpm + ' RPM: quieter with no load (' + (E(x.spl) - E(w.spl)).toFixed(1) + ' dB, all orders)');
  });
  ok(/no load/.test(N.msg) && /kPa/.test(N.msg), 'the message gives the manifold pressure (' + N.msg.slice(0, 140) + ')');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'wsndload_ui: ' + fails.length + ' FAIL' : 'wsndload_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
