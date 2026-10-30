const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const pg = await b.newPage({ viewport: vp }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + process.cwd()+'/index.html'); await pg.waitForTimeout(900);
    const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
    await pg.evaluate(() => { location.hash = 'intake'; document.body.classList.add('expert'); }); await pg.waitForTimeout(300);
    await setv('i-tb', '3.5'); await pg.waitForTimeout(300);
    let t = await pg.$eval('#panel-intake', e => e.innerText);
    ok(/Throttle body size/i.test(t) && /140 ft\/s/.test(t) && /Air speed through your/.test(t), vp.n + ': single-throttle sizing section');
    ok(/Catalogue bodies near/.test(t) && /mm/.test(t), vp.n + ': catalogue bodies listed');
    ok(!/NaN|undefined/.test(t), vp.n + ': no NaN/undefined');
    await setv('i-type', 'itb'); await setv('i-hp', '200'); await pg.waitForTimeout(300);
    t = await pg.$eval('#panel-intake', e => e.innerText);
    ok(/Rule of thumb 0\.8/.test(t) && /Jenvey/.test(t), vp.n + ': ITB sizing section');
    ok(!/NaN|undefined/.test(t), vp.n + ': no NaN/undefined (ITB)');
    await pg.evaluate(() => { location.hash = 'parts'; }); await pg.waitForTimeout(300);
    await setv('p-kind', 'tb'); await setv('p-brand', ''); await pg.waitForTimeout(200);
    const n = await pg.$$eval('#p-list .pcard', c => c.length); const pt = await pg.$eval('#p-list', e => e.innerText);
    ok(n === 109, vp.n + ': 109 throttle body cards (' + n + ')');
    ok(/mm bore/.test(pt) && /Fits:/.test(pt) && !/NaN|undefined/.test(pt), vp.n + ': card text');
    ok(errs.length === 0, vp.n + ': no page errors ' + errs.join('|'));
    await pg.close();
  }
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); await b.close();
})();
