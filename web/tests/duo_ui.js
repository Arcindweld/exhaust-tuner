// Sound tab, "Two notes on true duals" (Borla's polyphonic idea): the other side's length for a fifth, fourth, major
// third above and a fifth below, from the acoustic length (pipe + 0.6133 r open end) divided by the ratio.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const p = await b.newPage({ viewport: vp }); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + process.cwd() + '/index.html#sound'); await p.waitForTimeout(800); await p.click('#u-met'); await p.waitForTimeout(300);
    const set = (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
    await set('s-len', '2400'); await p.waitForTimeout(300);
    const t = await p.evaluate(() => { const h = [...document.querySelectorAll('.sec h3')].find(x => x.textContent === 'Two notes on true duals'); return h ? h.parentElement.innerText : ''; });
    const m = t.match(/acoustic (\d+) mm/), Lac = m ? +m[1] : NaN, end = Lac - 2400;
    const want = Math.round(Lac / 1.5 - end), got = (t.match(/Perfect fifth above\s+3:2\s+\d+ Hz\s+(\d+) mm/) || [])[1];
    ok(Lac > 2400 && Lac < 2450 && Math.abs(+got - want) <= 1, vp.n + ': fifth above: ' + got + ' mm (acoustic ' + Lac + ' ÷ 1.5 − ' + end + ' end)');
    const f1 = +(t.match(/lowest resonance is (\d+) Hz/) || [])[1], f5 = +(t.match(/3:2\s+(\d+) Hz/) || [])[1];
    ok(Math.abs(f5 - 1.5 * f1) <= 1, vp.n + ': its note ' + f5 + ' Hz = 1.5 × ' + f1);
    ok(/Perfect fifth below\s+2:3/.test(t) && /4 : 5 : 6/.test(t), vp.n + ': a fifth below and the major chord');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.n + ': no page overflow');
    await p.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('FAILS:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
