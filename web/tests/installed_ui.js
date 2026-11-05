// Installed attenuation on the Mufflers tab (Davies 1996): bare tailpipe 0 dB, a chamber transparent at its half-wave note,
// the chart mode switch renders without errors or NaN.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = []; let fails = 0; const chk = (ok, m) => { if (!ok) { out.push('FAIL ' + m); fails++; } };
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  pg.on('pageerror', e => { out.push('PAGEERROR ' + e.message); fails++; });
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers'); await pg.click('#m-expert'); await pg.click('#u-met'); await pg.waitForTimeout(200);
  const r = await pg.evaluate(() => {
    const Cx = window.__Cx, I = f => [Cx(1, 0), Cx(0, 0), Cx(0, 0), Cx(1, 0)], S = Math.PI * 0.0635 ** 2 / 4;
    const bare = [80, 250, 600, 1200].map(f => window.__installedAL(I, f, 0.67, 0.03175, 500, 0.7, S));
    const ch = window.__md.calcChamber({ dpipe: 63.5, dch: 152.4, lch: 355.6, tmain: 227 });
    const atZero = window.__installedAL(ch.T, ch.fZero, 0.67, 0.03175, ch.c, 0.7, S);
    // a very long tailpipe averages the termination away: installed at the TL peak within a few dB of TL when averaged over tail lengths
    let s = 0, n = 0; for (let L = 0.3; L <= 3.0; L += 0.025) { s += window.__installedAL(ch.T, ch.fPeak, L, 0.03175, ch.c, 0.7, S); n++; }
    return { bare, atZero, meanPeak: s / n, tlPeak: ch.tl(ch.fPeak) };
  });
  out.push(JSON.stringify(r));
  chk(r.bare.every(v => Math.abs(v) < 1e-6), 'bare tailpipe is 0 dB at every frequency');
  chk(Math.abs(r.atZero) < 1e-6, 'a chamber a half wave long is transparent installed too');
  chk(r.meanPeak > 2 && r.meanPeak < r.tlPeak + 3, 'averaged over tail lengths the installed cut at the TL peak is positive and near TL (' + r.meanPeak.toFixed(1) + ' vs ' + r.tlPeak.toFixed(1) + ')');
  await pg.selectOption('#m-tlmode', 'inst'); await pg.waitForTimeout(400);
  const leg = await pg.evaluate(() => document.getElementById('m-legend').innerText), cap = await pg.evaluate(() => document.getElementById('m-cap').textContent);
  chk(/Bare tailpipe/.test(leg) && /installed/.test(cap), 'installed mode legend and caption');
  const pts = await pg.evaluate(() => [...document.querySelectorAll('#m-tl polyline')].map(p => p.getAttribute('points')).join(' '));
  chk(pts.length > 100 && !/NaN/.test(pts), 'curves drawn without NaN');
  await pg.selectOption('#m-tlmode', 'tl'); await pg.waitForTimeout(200);
  chk(/dB removed/.test(await pg.evaluate(() => document.getElementById('m-tl').textContent)), 'back to transmission loss');
  await b.close(); console.log(out.join('\n')); console.log(fails ? 'installed_ui: ' + fails + ' FAIL' : 'installed_ui: all pass'); process.exit(fails ? 1 : 0);
})();
