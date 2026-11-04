// Headers tab, unequal lengths: pulse gaps at the collector and "Pair the pulses" (short gap, then a long one). An inline
// four into one 4-1 collector: equal lengths give 180° gaps; pairing to 150° at 6000 RPM moves half the difference onto
// the first pulse of each pair and off the second, the gaps there come out 150 / 210°, half as far off at 3000, and the
// orders table shows the new 1st order (the octave below the firing tone).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const p = await b.newPage({ viewport: vp }); p.on('pageerror', e => errs.push(String(e)));
    await p.goto('file://' + process.cwd() + '/index.html'); await p.waitForTimeout(800);
    const set = (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
    await p.evaluate(() => { document.getElementById('u-met').click(); location.hash = 'headers'; }); await p.waitForTimeout(400);
    await set('h-eng', 'f4'); await set('h-disp', '2000'); await set('h-grp', 'all'); await set('h-merge', 'direct'); await set('h-rpm', '6000'); await set('h-lenmode', 'unequal'); await p.waitForTimeout(300);
    const sec = () => p.evaluate(() => { const h = [...document.querySelectorAll('#h-details .sec h3, .area-details .sec h3')].find(x => x.textContent === 'Unequal primary lengths'); return h ? h.parentElement.innerText : ''; });
    let t = await sec();
    ok(/Pulse gaps at the collector/.test(t) && /180° · 180° · 180° · 180°/.test(t), vp.n + ': equal lengths, even 180° gaps');
    ok(/Pair the pulses/.test(t) && /Use these lengths/.test(t), vp.n + ': the pairing helper is there');
    await p.evaluate(() => { const g = document.querySelector('input.uelpair[data-k="pg"]'); g.value = '150'; g.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.evaluate(() => { const g = document.querySelector('input.uelpair[data-k="pr"]'); g.value = '6000'; g.dispatchEvent(new Event('change', { bubbles: true })); });
    await p.waitForTimeout(200);
    const plan = await p.evaluate(() => window.__pair.plan(150, 6000));
    const a = await p.evaluate(() => window.__pair.a());
    const dL = 30 * a / 36000 * 1000;
    ok(plan.lines && plan.lines.length === 2 && plan.lines.every(x => Math.abs(x.dL - dL) < 1e-9 && Math.abs(x.dth - 30) < 1e-9), vp.n + ': each pair differs by 30° × a ÷ (6 × 6000) = ' + dL.toFixed(1) + ' mm');
    await p.click('#h-uel-pair'); await p.waitForTimeout(300);
    const g = await p.evaluate(() => ({ g6: window.__pair.gaps(6000), g3: window.__pair.gaps(3000), mean: window.__pair.mean(), prim: window.__pair.prim() }));
    const s6 = g.g6.slice().sort((x, y) => x - y), s3 = g.g3.slice().sort((x, y) => x - y);
    ok(Math.abs(s6[0] - 150) < 1e-6 && Math.abs(s6[1] - 150) < 1e-6 && Math.abs(s6[3] - 210) < 1e-6, vp.n + ': applied, the gaps at 6000 are ' + g.g6.map(x => x.toFixed(1)).join(' / '));
    ok(Math.abs(s3[0] - 165) < 1e-6 && Math.abs(s3[3] - 195) < 1e-6, vp.n + ': at 3000 RPM half as far off (' + s3[0].toFixed(1) + ' / ' + s3[3].toFixed(1) + ')');
    ok(Math.abs(g.mean - g.prim) < 1e-9, vp.n + ': the average primary length is unchanged');
    t = await sec();
    const firstOrder = await p.evaluate(() => window.__pair.orders(6000));
    ok(Math.abs(firstOrder[1] - Math.sin(Math.PI / 12)) < 1e-9 && Math.abs(firstOrder[3] - Math.cos(Math.PI / 6)) < 1e-9, vp.n + ': ±15° shifts: order 1 sin 15° = ' + (20 * Math.log10(firstOrder[1])).toFixed(1) + ' dB against the firing order');
    ok(/Rate of the short gaps/.test(t) && /240 Hz \(150°\)/.test(t) && /171 Hz \(210°\)/.test(t), vp.n + ': the two gap rates at 6000: 240 and 171 Hz');
    ok(/1\.400, tritone \(dissonant\)/.test(t) && /144° gives a perfect fifth/.test(t), vp.n + ': 150/210 named a tritone; 144° offered for a perfect fifth');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.n + ': no page overflow');
    // an odd collector and a too-small gap are refused
    const bad = await p.evaluate(() => window.__pair.plan(200, 6000).err || '');
    ok(/under the even gap/.test(bad), vp.n + ': a short gap over 180° is refused');
    await p.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('failures:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
