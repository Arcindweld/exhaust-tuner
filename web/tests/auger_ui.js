// Mufflers tab, Auger muffler (Lobak-style): two parallel paths through ttMatrix, the helix length, the dip near
// c / (2 dL), equal areas giving the full Herschel-Quincke notch, the capped tube, desk and phone.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const p = await b.newPage({ viewport: vp }); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + process.cwd() + '/index.html#mufflers'); await p.waitForTimeout(800); await p.click('#u-met'); await p.waitForTimeout(300);
    const r = await p.evaluate(() => { const A = window.__aug, R = A.augCalc({ tmain: 400, dpipe: 76.2 });
      const Dm = (101.6 + 50.8) / 2, Lh = 610 / 101.6 * Math.sqrt((Math.PI * Dm) ** 2 + 101.6 ** 2);
      // equal path areas: the notch is full at c / (2 dL)
      const T = window.__tt, c = 500, S = Math.PI * 0.0381 ** 2, Ae = Math.PI * 0.025 ** 2;
      const eq = T.ttMatrix([{ L: 300, d: 50 }, { L: 800, A: Ae, d: 50 }], c, 0.6, S, c / (2 * 0.5));
      return { Lh: R.Lh, want: Lh, pk: R.peak, f1: R.f1, eq }; });
    ok(Math.abs(r.Lh - r.want) < 1e-9, vp.n + ': helix path N √((π Dm)² + p²) = ' + r.Lh.toFixed(0) + ' mm');
    ok(r.pk && r.pk.f > 0.8 * r.f1 && r.pk.f < 1.2 * r.f1 && r.pk.v > 6, vp.n + ': the strongest dip ' + Math.round(r.pk.f) + ' Hz, ' + r.pk.v.toFixed(1) + ' dB, near c ÷ 2ΔL = ' + Math.round(r.f1));
    ok(r.eq === 40, vp.n + ': equal areas: the full notch at c ÷ 2ΔL');
    const t = await p.evaluate(() => { const h = [...document.querySelectorAll('.sec h3')].find(x => x.textContent === 'Auger muffler'); return h ? h.parentElement.innerText : ''; });
    ok(/US 3,963,092/.test(t) && /6\.0 turns/.test(t) && /Strongest dip/.test(t), vp.n + ': the section with its defaults (24 in, 4 in shell, 2 in tube, 4 in pitch)');
    await p.evaluate(() => { const s = document.querySelector('select.augsel'); s.value = '1'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(200);
    const cap = await p.evaluate(() => window.__aug.AUG.last.tubes.length);
    ok(cap === 1, vp.n + ': capped tube: one path, round the spiral');
    await p.evaluate(() => { const s = document.querySelector('select.augsel'); s.value = '0'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    ok(await p.evaluate(() => document.getElementById('aug-svg').querySelectorAll('polyline').length === 1), vp.n + ': curve drawn');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.n + ': no page overflow');
    await p.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('FAILS:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
