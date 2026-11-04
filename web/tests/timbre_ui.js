// Mufflers tab, Timbre tube bundle (Borla's timbre scaled exhaust, US 10,808,584 B2): the parallel-tube transfer-matrix
// model against known cases (one tube the pipe's size, two equal tubes, a two-path Herschel-Quincke notch at
// c / (2 dL)), the sizing to harmonics of the firing tone, inputs, desk and phone.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const p = await b.newPage({ viewport: vp }); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + process.cwd() + '/index.html#mufflers'); await p.waitForTimeout(800); await p.click('#u-met'); await p.waitForTimeout(300);
    const r = await p.evaluate(() => { const T = window.__tt, c = 343, rho = 1.2, D = 76.2, S = Math.PI * (D / 2000) ** 2, dh = D / Math.SQRT2, fN = c / 0.4;
      return { one: Math.max(...[100, 500, 1500, 3000].map(f => T.ttMatrix([{ L: 300, d: D }], c, rho, S, f))),
        same: Math.max(...[200, 900, 2500].map(f => T.ttMatrix([{ L: 250, d: dh }, { L: 250, d: dh }], c, rho, S, f))),
        notch: T.ttMatrix([{ L: 300, d: dh }, { L: 500, d: dh }], c, rho, S, fN), off: T.ttMatrix([{ L: 300, d: dh }, { L: 500, d: dh }], c, rho, S, 0.5 * fN) }; });
    ok(r.one < 1e-9 && r.same < 1e-9, vp.n + ': a tube the pipe’s size, or two equal ones, remove nothing');
    ok(r.notch === 40 && r.off < r.notch - 10, vp.n + ': two paths 200 mm apart: the notch at c ÷ (2 × 0.2 m) = 857.5 Hz (' + r.off.toFixed(1) + ' dB at half of it)');
    const t = await p.evaluate(() => { const h = [...document.querySelectorAll('.sec h3')].find(x => x.textContent === 'Timbre tube bundle'); return h ? h.parentElement.innerText : ''; });
    ok(/US 10,808,584 B2/.test(t) && /\(on the 8th\)/.test(t) && /\(on the 16th\)/.test(t), vp.n + ': tubes sized on harmonics 8, 10, 12, 16 of the firing tone by default');
    ok(/Flow area, tubes ÷ pipe/.test(t) && /plane-wave limit|Plane waves hold below/.test(t), vp.n + ': flow area and the plane-wave limit shown');
    await p.evaluate(() => { const s = document.querySelector('select.ttsel'); s.value = '3'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.querySelectorAll('input.ttx[data-k="L"]').length === 3), vp.n + ': three tubes');
    await p.evaluate(() => { const i = document.querySelector('input.ttx[data-k="L"][data-i="0"]'); i.value = '120'; i.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(200);
    ok(await p.evaluate(() => Math.abs(window.__tt.TT.L[0] - 120) < 1e-9), vp.n + ': a length typed in is used');
    await p.click('#tt-tune'); await p.waitForTimeout(200);
    const tuned = await p.evaluate(() => { const L = window.__tt.TT.last; return L.tubes.map(t => L.c / (2 * (t.L + 0.6 * t.d) / 1000) / L.f0); });
    ok(tuned.every((h, i) => Math.abs(h - [8, 10, 12][i]) < 1e-9), vp.n + ': sizing puts them back on harmonics ' + tuned.map(x => x.toFixed(2)).join(', '));
    ok(await p.evaluate(() => document.getElementById('tt-svg').querySelectorAll('polyline').length === 1), vp.n + ': the curve is drawn');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.n + ': no page overflow');
    await p.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('FAILS:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
