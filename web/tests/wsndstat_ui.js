// Sound tab: "Estimate the stationary test" (California's 95 dB(A) test, 13 CCR 1036 / SAE J1169): one no-load run at
// three-quarters of the maximum speed, the outlet's orders brought to 20 in with the ground's reflection, A-weighted,
// plus the tip's jet noise.   node tests/wsndstat_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(900);
  // the arithmetic on a made-up run: one order at 90 dB at 1 m
  const u = await pg.evaluate(() => { const X = window.__wsnd, sp = new Array(48).fill(-300); sp[1] = 90;   // order 1 (i = 1), 100 Hz at 6000 RPM
    const L = X.statLevel({ spl24x1: sp, rpm: 6000 }, 0.3048);
    const r1 = 0.508, r2 = Math.hypot(r1, 0.6096), g = r1 / r2, k = 2 * Math.PI * 100 / 343, ph = k * (r2 - r1);
    const G = (1 + g * Math.cos(ph)) ** 2 + (g * Math.sin(ph)) ** 2, f2 = 100 * 100;
    const Ra = 12194 ** 2 * f2 * f2 / ((f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2)), A = 20 * Math.log10(Ra) + 2.0;
    return { got: L.pulse, want: 90 - 20 * Math.log10(r1) + 10 * Math.log10(G) + A, jet: L.jet, none: X.statLevel({}, 0.3) }; });
  ok(Math.abs(u.got - u.want) < 0.05, 'one order: 1 m to 20 in, the ground image, A weighting (' + u.got.toFixed(2) + ' against ' + u.want.toFixed(2) + ' dB(A))');
  ok(u.jet === null && u.none === null, 'no jet without a tip; nothing without a run');
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600);
  ok(await pg.isVisible('#wsnd-rmax') && await pg.isVisible('#wsnd-hout'), 'the maximum speed and outlet height are asked for');
  await pg.fill('#wsnd-rmax', '6000'); await pg.dispatchEvent('#wsnd-rmax', 'change');
  await pg.fill('#wsnd-hout', '12'); await pg.dispatchEvent('#wsnd-hout', 'change');
  await pg.click('button[data-wsnd="stat"]');
  await pg.waitForFunction(() => window.__wsnd.WSND.stat && !window.__wsnd.WSND.busy, null, { timeout: 600000 });
  const r = await pg.evaluate(() => { const W = window.__wsnd.WSND; return { s: W.stat, msg: W.msg.t, tbl: (document.getElementById('wsnd-stat') || {}).textContent || '', load: document.getElementById('wsnd-load').value }; });
  ok(r.s.rpm === 4500, 'run at three-quarters of 6000 RPM (' + r.s.rpm + ')');
  ok(isFinite(r.s.total) && r.s.total > 70 && r.s.total < 130, 'a level in the range real cars read (' + r.s.total.toFixed(1) + ' dB(A); pulses ' + r.s.pulse.toFixed(1) + ', jet ' + (r.s.jet == null ? '-' : r.s.jet.toFixed(1)) + ')');
  ok(r.s.total >= r.s.pulse - 1e-9 && (r.s.jet == null || r.s.total >= r.s.jet), 'the total is the energy sum');
  ok(/95 dB\(A\)/.test(r.msg) && /13 CCR 1036/.test(r.msg) && /20 in \(508 mm\)/.test(r.msg), 'the message gives the limit, the rule and the distance in both units');
  ok(/Total/.test(r.tbl) && /95\.0/.test(r.tbl), 'the result table shows the total against 95');
  ok(r.load === 'wot', 'the Load choice is left as it was (' + r.load + ')');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'wsndstat_ui: ' + fails.length + ' FAIL' : 'wsndstat_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
