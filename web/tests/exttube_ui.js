// Extended-tube expansion chamber on the Mufflers tab (Munjal 1987, 2.13-2.14 / 3.7): the pockets behind the extended
// inlet and outlet fill the plain chamber's troughs; with both at 0 the curve is the plain chamber's.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = []; let fails = 0;
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  pg.on('pageerror', e => { out.push('PAGEERROR ' + e.message); fails++; });
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers');
  await pg.click('#m-expert'); await pg.click('#u-met');
  const r = await pg.evaluate(() => {
    const p = { dpipe: 63.5, dch: 152.4, lch: 355.6, tmain: 400 };
    const calcChamber = window.__md.calcChamber; const plain = calcChamber(p), ext0 = calcChamber({ ...p, lin: 0, lout: 0 });
    const dt = calcChamber({ ...p, lin: 177.8, lout: 88.9 });
    const bad = calcChamber({ ...p, lin: 200, lout: 200 });
    const fz = plain.fZero, fz2 = 2 * fz;
    return { same: Math.abs(plain.tl(300) - ext0.tl(300)) + Math.abs(plain.tl(fz) - ext0.tl(fz)), plainAtZero: plain.tl(fz), extAtZero: dt.tl(fz), extAtZero2: dt.tl(fz2),
      plainAt2: plain.tl(fz2), peak: plain.tl(plain.fPeak), extPeak: dt.tl(plain.fPeak), ext: dt.ext, bad: bad.err || '', fin: [100, 250, 500, 800].every(f => Number.isFinite(dt.tl(f))) };
  });
  out.push(JSON.stringify(r));
  const chk = (ok, m) => { if (!ok) { out.push('FAIL ' + m); fails++; } };
  chk(r.same < 1e-6, 'lin=lout=0 should equal the plain chamber');
  chk(r.plainAtZero < 0.01, 'plain chamber passes at c/2L');
  chk(r.extAtZero > 6, 'double-tuned chamber should attenuate at the plain chamber first trough');
  chk(r.extAtZero2 > 6, 'double-tuned chamber should attenuate at the second trough');
  chk(Math.abs(r.peak - r.extPeak) < 6, 'peak attenuation stays of the same order');
  chk(/meet/.test(r.bad), 'tubes that meet should error');
  chk(r.fin, 'finite TL across the band');
  // the inputs and the button on the page
  await pg.fill('#m-lin', '0'); await pg.dispatchEvent('#m-lin', 'input'); await pg.waitForTimeout(60);
  let txt = await pg.evaluate(() => document.getElementById('m-details').innerText);
  chk(/Plain expansion chamber/.test(txt), 'plain heading at 0');
  await pg.click('#m-dtune'); await pg.waitForTimeout(80);
  txt = await pg.evaluate(() => document.getElementById('m-details').innerText);
  const vals = await pg.evaluate(() => ['m-lin', 'm-lout', 'm-lch'].map(id => document.getElementById(id)._b));
  out.push('after Set: ' + JSON.stringify(vals));
  chk(Math.abs(vals[0] - vals[2] / 2) < 0.01 && Math.abs(vals[1] - vals[2] / 4) < 0.01, 'Set puts inlet at L/2, outlet at L/4');
  chk(/Expansion chamber with extended tubes/.test(txt) && /inlet pocket tuned/.test(txt), 'extended heading and pocket row');
  chk(!/\bNaN\b|undefined/.test(txt), 'no NaN in the muffler details');
  const leg = await pg.evaluate(() => document.getElementById('m-legend').innerText);
  chk(/Extended-tube chamber/.test(leg), 'legend renames the curve');
  // reverse-flow layout
  await pg.selectOption('#m-chlay', 'reverse'); await pg.waitForTimeout(80);
  txt = await pg.evaluate(() => document.getElementById('m-details').innerText);
  chk(/Reverse-flow chamber/.test(txt) && /Cuts most at/.test(txt), 'reverse-flow section');
  chk(!/\bNaN\b|undefined/.test(txt), 'no NaN in reverse-flow details');
  const rv = await pg.evaluate(() => { const c = window.__md.calcChamber({ dpipe: 63.5, dch: 152.4, lch: 355.6, tmain: 400, rev: true, lin: 0 });
    const q = c.fPeak, h = c.fZero; return { atQ: c.tl(q), atH: c.tl(h), fin: [50, 120, 300, 700].every(f => Number.isFinite(c.tl(f))), narrow: window.__md.calcChamber({ dpipe: 63.5, dch: 80, lch: 300, tmain: 400, rev: true }).err || '' }; });
  out.push('reverse: ' + JSON.stringify(rv));
  chk(rv.atQ >= 39, 'reverse flow cuts hardest at its quarter wave');
  chk(rv.atH < 0.01, 'reverse flow passes at its half wave');
  chk(rv.fin && /wider/.test(rv.narrow), 'finite and narrow-chamber error');
  await pg.selectOption('#m-chlay', 'through'); await pg.waitForTimeout(40);
  await b.close();
  console.log(out.join('\n')); console.log(fails ? 'exttube_ui: ' + fails + ' FAIL' : 'exttube_ui: all pass');
  process.exit(fails ? 1 : 0);
})();
