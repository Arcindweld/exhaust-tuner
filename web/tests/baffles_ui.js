// Morse chain-of-chambers low-pass filter on the Mufflers tab: f0, cut-off, dB per chamber, UI section, no NaN.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = []; let fails = 0; const chk = (ok, m) => { if (!ok) { out.push('FAIL ' + m); fails++; } };
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  pg.on('pageerror', e => { out.push('PAGEERROR ' + e.message); fails++; });
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers'); await pg.click('#m-expert'); await pg.click('#u-met');
  const r = await pg.evaluate(() => {
    // Morse's worked example reading: 2.5 in pipe, 1.5 in holes, 150 mm chambers, c 500 m/s -> f0 ~ 713 Hz (thin baffle)
    const c500 = (() => { let lo = -50, hi = 1500; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (window.__sosExh(m) < 500) lo = m; else hi = m; } return lo; })();
    const b = window.__baffles({ dpipe: 63.5, dsh: 101.6, lch: 300, n: 2, dh: 38.1, t: 0, tC: c500 });
    return { f0: b.f0, fc: b.fc, below: b.tl(0.8 * b.f0), at2: b.per(2 * b.f0), at3: b.per(3 * b.f0), err: b.err, bad: window.__baffles({ dpipe: 63.5, dsh: 101.6, lch: 300, n: 2, dh: 120, t: 0, tC: 400 }).err || '' };
  });
  out.push(JSON.stringify(r));
  // f0 = (c/pi) sqrt(S0/(D0 S l)) with S the shell: 101.6 mm shell here, so compute the expected value directly
  const S0 = Math.PI / 4 * 0.0381 ** 2, D0 = Math.PI * 0.0381, S = Math.PI / 4 * 0.1016 ** 2, l = 0.15;
  const f0exp = 500 / Math.PI * Math.sqrt(S0 / (D0 * S * l));
  chk(Math.abs(r.f0 - f0exp) / f0exp < 0.01, 'f0 matches Morse formula: ' + r.f0.toFixed(0) + ' vs ' + f0exp.toFixed(0));
  chk(Math.abs(r.fc - 2 * r.f0) < 1e-6, 'cut-off is 2 f0');
  // Physics audit follow-up 2026-11-11 (Q9): the curve is now the lumped chain between the pipes, 2 chambers and 1 hole (chamber
  // first and last), so below the cut-off it is small but not zero (it was N x Morse's image attenuation, 0 there); the
  // independent Python value of the matrix chain at 0.8 f0 is 2.937 dB (the bisection finds the exhaust-gas temperature for c 500 m/s)
  chk(Math.abs(r.below - 2.937128) < 1e-3 * 2.937128, 'lumped chain TL at 0.8 f0: ' + r.below.toFixed(4) + ' vs 2.9371 dB');
  chk(Math.abs(r.at2 - 8.686 * Math.acosh(1)) < 1e-9 && r.at3 > 15, 'per-chamber dB: 0 at the cut-off, large above');
  chk(/hole smaller/.test(r.bad), 'bad hole errors');
  await pg.fill('#m-nbaf', '3'); await pg.dispatchEvent('#m-nbaf', 'input'); await pg.waitForTimeout(150);
  const txt = await pg.evaluate(() => document.getElementById('m-details').innerText), leg = await pg.evaluate(() => document.getElementById('m-legend').innerText);
  chk(/Baffled chambers \(low-pass filter\)/.test(txt) && /Cut-off/.test(txt), 'section shown');
  chk(/Baffled chambers/.test(leg), 'legend');
  chk(!/\bNaN\b|undefined/.test(txt), 'no NaN');
  await pg.fill('#m-nbaf', '0'); await pg.dispatchEvent('#m-nbaf', 'input'); await pg.waitForTimeout(100);
  chk(!/Baffled chambers \(low-pass/.test(await pg.evaluate(() => document.getElementById('m-details').innerText)), 'hidden at 0');
  await b.close(); console.log(out.join('\n')); console.log(fails ? 'baffles_ui: ' + fails + ' FAIL' : 'baffles_ui: all pass'); process.exit(fails ? 1 : 0);
})();
