// Match a dyno curve (4-Stroke tab, under Run it in OpenWAM): the parser, the least-squares fit of the valve flow
// coefficient and combustion efficiency on synthetic results with known answers, and the inputs it fills.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(400);
  await pg.click('#m-expert');
  const r = await pg.evaluate(() => {
    const D = window.__dyno;
    const pts = D.dynoParse('3000 380\n4600, 425\n5900: 383\nnot a line\n100 5', false);
    // synthetic model: base torque at cd0 0.7, ce0 0.86; the true engine has cd 0.78, ce 0.80
    const base = [470, 560, 520], s = [0.02, 0.05, 0.11];
    const pert = base.map((t, i) => t * (1 + s[i]));
    const truth = base.map((t, i) => t * (1 + s[i] * (0.78 - 0.7) / 0.1) * 0.80 / 0.86);
    const fit = D.dynoFit(pts.map((p, i) => ({ rpm: p.rpm, Nm: truth[i] })), base, pert, 0.7, 0.86);
    const clamp = D.dynoFit([{ rpm: 3000, Nm: 2000 }, { rpm: 5000, Nm: 2100 }], [400, 420], [410, 440], 0.7, 0.86);
    return { pts, fit: { cd: fit.cd, ce: fit.ce, rms: fit.rms }, clamp: { ce: clamp.ce } };
  });
  ok(r.pts.length === 3 && r.pts[0].rpm === 3000 && Math.abs(r.pts[1].Nm - 425 * 1.3558179483) < 1e-9, 'dyno points parsed (lb-ft to N·m, bad lines skipped)');
  ok(Math.abs(r.fit.cd - 0.78) < 0.0051 && Math.abs(r.fit.ce - 0.80) < 0.002 && r.fit.rms < 1, 'fit recovers cd 0.78 and ce 0.80 from synthetic runs (' + JSON.stringify(r.fit) + ')');
  ok(r.clamp.ce === 1, 'combustion efficiency held at or below 1.0 when the dyno is out of reach');
  // the section and the inputs it fills
  for (const [id, v] of [['#f-rpm', '6000'], ['#f-evo', '60'], ['#f-dp', '1.875'], ['#f-disp', '376'], ['#f-cyl', '8'], ['#f-trq', '4600'], ['#f-bore', '4.065'], ['#f-stroke', '3.622'], ['#f-cratio', '10.7']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
  await pg.waitForTimeout(400);
  const sec = await pg.evaluate(() => { const h = [...document.querySelectorAll('#four-details .sec h3')].find(x => /Match a dyno curve/.test(x.textContent)); return h ? h.parentElement.innerText : ''; });
  ok(/Match a dyno curve/.test(sec) && /needs the Exhaust Tuner program or the Fusion panel/.test(sec), 'the section is there; in a browser it says fitting needs the desktop program');
  await pg.fill('#f-vcd', '0.78'); await pg.dispatchEvent('#f-vcd', 'input'); await pg.fill('#f-ceff', '0.8'); await pg.dispatchEvent('#f-ceff', 'input'); await pg.waitForTimeout(200);
  const e = await pg.evaluate(() => { const sp = window.__sim.simSpec(window.__sim.inp()); return { cd: sp.e.cd, ce: sp.e.combEff, wam: /0\.8\s+<[^>]*combustion efficiency/.test(window.WamExport.makeWam(sp, { rpm: 4000, cycles: 5, name: 't' })) }; });
  ok(e.cd === 0.78 && e.ce === 0.8 && e.wam, 'the fitted values reach the spec and the OpenWAM case (' + JSON.stringify(e) + ')');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
