// the perforate impedance with grazing flow (Rao and Munjal 1986, Munjal 1987 eq. 3.155): the flow raises the
// resistance by 1 + 72.23 M and leaves the reactance; the packed can's transmission loss moves with it; the input exists
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/index.html#mufflers'); await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const k0 = 2 * Math.PI * 500 / 343, fb = { Zm: { re: 1, im: 0 }, km: { re: 1, im: 0 } };
    const z0 = window.__perfZ(k0, 0.0015, 0.003, 0.1, fb, 0), z1 = window.__perfZ(k0, 0.0015, 0.003, 0.1, fb, 0.1);
    const g = z => (z.re !== undefined ? [z.re, z.im] : [z[0], z[1]]);
    const el = document.getElementById('m-mach');
    return { z0: g(z0), z1: g(z1), input: !!el, hint: /1 \+ 72/.test(document.getElementById('panel-muf') ? document.getElementById('panel-muf').innerText : document.body.innerText) };
  });
  const ratio = r.z1[0] / r.z0[0];
  ok(Math.abs(ratio - (0.006 + 0.5299 * 0.1) / 0.006) < 0.05 * ratio && Math.abs(r.z1[1] - r.z0[1]) < 1e-12, 'Mach 0.1 grazing: resistance x ' + ratio.toFixed(1) + ' (1 + 72.23 x 0.1 on 7.3e-3 against the 0.006 base: ' + ((0.006 + 0.5299 * 0.1) / 0.006).toFixed(1) + '), reactance unchanged');
  ok(r.input, 'the Mufflers tab has the mean-flow input');
  // the packed can's TL changes with the flow
  const tl = await p.evaluate(async () => {
    const set = v => { const el = document.getElementById('m-mach'); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    const read = () => { const s = [...document.querySelectorAll('#m-details .sec')].find(x => /Packed straight-through|packed can/i.test(x.innerText)); return s ? s.innerText : document.getElementById('m-details').innerText; };
    set(0); await new Promise(r => setTimeout(r, 600)); const a = read();
    set(0.1); await new Promise(r => setTimeout(r, 600)); const c = read();
    return { a: a.slice(0, 400), c: c.slice(0, 400), same: a === c };
  });
  ok(!tl.same, 'the packed-can section changes when the flow is set to Mach 0.1');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log('failures:', fails.length); process.exit(fails.length ? 1 : 0);
})();
