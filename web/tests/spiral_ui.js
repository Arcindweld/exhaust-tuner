// Mufflers tab, "Muffler types: flow against quieting": the three types from US 5,824,972 (2.5 in at 5 in water:
// chambered 13-20 dBA / 70-100 CFM, packed 2-7 / 200, spiral traps 8-15 / 175), the inlet sizes from the square law,
// Spintech parts typed as spiral traps, and the Spintech case chart filtered by the space limits.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const p = await b.newPage({ viewport: vp }); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + process.cwd() + '/index.html#mufflers'); await p.waitForTimeout(800); await p.click('#u-met'); await p.waitForTimeout(300);
    const txt = () => p.evaluate(() => { const h = [...document.querySelectorAll('.sec h3')].find(x => x.textContent === 'Muffler types: flow against quieting'); return h ? h.parentElement.innerText : ''; });
    let t = await txt();
    const m = t.match(/drops like (\d+) CFM of cold air/), Qe = m ? +m[1] : NaN;
    const sp = t.match(/Spiral sound traps\s+8 to 15 dBA\s+175 CFM\s+([\d.]+) mm\s+([\d.]+) mm/);
    const want5 = 63.5 * Math.sqrt(Qe / 175), want1 = want5 * Math.pow(5 * 249.0889 / 6894.76, 0.25);
    ok(sp && Math.abs(+sp[1] - want5) < 0.6 && Math.abs(+sp[2] - want1) < 0.6, vp.n + ': spiral traps: ' + (sp ? sp[1] + ' / ' + sp[2] : '?') + ' mm inlet for 5 in water / 1 psi at ' + Qe + ' CFM equivalent');
    ok(/Chambered \(baffles\)\s+13 to 20 dBA\s+70 to 100 CFM/.test(t) && /Straight-through, packed\s+2 to 7 dBA\s+200 CFM/.test(t), vp.n + ': the patent’s chambered and packed figures');
    ok(/^9000\s/m.test(t.slice(t.indexOf('Spintech case sizes'))) && /7000RD\s+2¼ × 9 × 16 in \(57 × 229 × 406 mm\)/.test(t), vp.n + ': Spintech chart in its own order, inches and mm');
    const sel = (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
    await sel('m-maxh', '80'); await p.waitForTimeout(300); t = await txt();
    const part = t.slice(t.indexOf('Spintech case sizes'));
    ok(/that fit the space limits/.test(part) && /3000F\s+3 × 8½ × 13/.test(part) && !/\n9000\s/.test(part) && /7000RD/.test(part), vp.n + ': an 80 mm height limit leaves only the thin cases');
    const types = await p.evaluate(() => window.__mt.spintechTypes());
    ok(types.length >= 5 && types.every(x => x === 'spiral'), vp.n + ': Spintech parts are spiral sound traps (' + types.length + ')');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.n + ': no page overflow');
    await p.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('FAILS:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
