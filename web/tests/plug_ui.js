// Plug (cross-flow) muffler on the Mufflers tab (Munjal 1987, 3.8.1): curve, section, errors, no NaN.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = []; let fails = 0; const chk = (ok, m) => { if (!ok) { out.push('FAIL ' + m); fails++; } };
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  pg.on('pageerror', e => { out.push('PAGEERROR ' + e.message); fails++; });
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers');
  await pg.click('#m-expert'); await pg.click('#u-met');
  const r = await pg.evaluate(() => {
    const base = { dpipe: 50, dsh: 150, lperf: 100, lch: 300, dh: 3, tw: 1, rho: 0, sigma: 0.1, tC: 400, M: 0 };
    const pl = window.__plug(base), plM = window.__plug({ ...base, M: 0.15 }), packed = window.__plug({ ...base, rho: 100 });
    const fs = [60, 120, 250, 400, 600, 900];
    const t = fs.map(f => pl.tl(f)), tM = fs.map(f => plM.tl(f)), tP = fs.map(f => packed.tl(f));
    return { t: t.map(x => +x.toFixed(1)), tM: tM.map(x => +x.toFixed(1)), tP: tP.map(x => +x.toFixed(1)), fin: [...t, ...tM, ...tP].every(Number.isFinite),
      long: window.__plug({ ...base, lperf: 200 }).err || '', mid: t[2] };
  });
  out.push(JSON.stringify(r));
  chk(r.fin, 'finite TL');
  chk(r.mid > 5 && r.mid < 40, 'mid-band TL of a plug muffler is a real cut');
  chk(r.tM.reduce((a, x) => a + x, 0) >= r.t.reduce((a, x) => a + x, 0), 'flow through the holes adds damping, more TL on average');
  chk(/half the chamber/.test(r.long), 'too-long perforate errors');
  await pg.fill('#m-plugl', '100'); await pg.dispatchEvent('#m-plugl', 'input'); await pg.waitForTimeout(150);
  const txt = await pg.evaluate(() => document.getElementById('m-details').innerText);
  const leg = await pg.evaluate(() => document.getElementById('m-legend').innerText);
  chk(/Plug \(cross-flow\) muffler/.test(txt), 'plug section shown');
  chk(/Plug muffler/.test(leg), 'plug curve in the legend');
  chk(!/\bNaN\b|undefined/.test(txt), 'no NaN');
  await pg.fill('#m-plugl', '0'); await pg.dispatchEvent('#m-plugl', 'input'); await pg.waitForTimeout(100);
  const txt0 = await pg.evaluate(() => document.getElementById('m-details').innerText);
  chk(!/Plug \(cross-flow\) muffler/.test(txt0), 'plug section hidden at 0');
  await b.close();
  console.log(out.join('\n')); console.log(fails ? 'plug_ui: ' + fails + ' FAIL' : 'plug_ui: all pass'); process.exit(fails ? 1 : 0);
})();
