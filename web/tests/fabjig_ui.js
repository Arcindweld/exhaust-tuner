// Fusion panel, "Fabrication jig" options: styles, layout, mount (System 16 / 28 / 5/8 in / custom grid), flange
// locators, weld gap, bed; the payload the page sends with the jig action, and the parts table from the answer.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const ctx = await b.newContext({ viewport: vp });
    await ctx.addInitScript(() => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, JSON.parse(d)]);
      return Promise.resolve(JSON.stringify({ ok: true, msg: 'Built a fabrication jig', jig: { parts: [{ name: 'Plate', size_mm: [744.8, 170.7, 493.1], holes: 6 }, { name: 'Cradle 1', size_mm: [20, 64, 120], holes: 2 }] } })); } }; });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + process.cwd() + '/index.html#headers'); await p.waitForTimeout(900); await p.click('#u-met'); await p.waitForTimeout(200);
    const sel = (k, v) => p.evaluate(([k, v]) => { const s = document.querySelector('#jigopts-headers select[data-k="' + k + '"]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
    const txt = () => p.evaluate(() => document.getElementById('jigopts-headers').innerText);
    ok(await p.evaluate(() => ['headers', 'intake', 'muf', 'parts'].every(t => !!document.getElementById('jigopts-' + t))), vp.n + ': the options on every tab with the jig button');
    const styles = await p.evaluate(() => [...document.querySelectorAll('#jigopts-headers select[data-k="style"] option')].map(o => o.value));
    ok(JSON.stringify(styles) === JSON.stringify(['cradles', 'base', 'plate', 'saddle', 'frame']), vp.n + ': five styles');
    await sel('style', 'plate'); await sel('layout', 'flat'); await sel('mount', 'table'); await sel('table', 's28');
    let t = await txt();
    ok(/plate with cradles, laid flat, fixture table/.test(t) && /Grid hole at X/.test(t) && /flat printed plate/.test(t), vp.n + ': summary line, grid origin, the style’s description');
    await sel('flange', 'both'); t = await txt();
    ok(/Bolt circle \(PCD\)/.test(t), vp.n + ': flange fields when locators are on');
    await p.evaluate(() => { const i = document.querySelector('#jigopts-headers input[data-k="fpcd"]'); i.value = '80'; i.dispatchEvent(new Event('input', { bubbles: true }));
      const n = document.querySelector('#jigopts-headers input[data-k="fn"]'); n.value = '3'; n.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.evaluate(() => document.querySelector('#fx-headers button[data-fx="jig"]').click()); await p.waitForTimeout(400);
    const pay = await p.evaluate(() => (window.__sent.filter(x => x[0] === 'jig').pop() || [])[1]);
    const j = pay && pay.jig;
    ok(j && j.style === 'plate' && j.layout === 'flat' && j.mount === 'table' && j.grid_pitch_mm === 100 && j.grid_hole_mm === 28.5 && j.flange_ends === 'both' &&
       Math.abs(j.flange_pcd_mm - 80) < 1e-9 && j.flange_n === 3 && j.weld_gap_mm === 20 && j.bed_mm === 256, vp.n + ': payload: plate, flat, System 28, flanges 3 on 80 mm');
    // flange presets: grouped by type and brand, male and female V-bands, turbo flanges; applying one fills the fields
    const pre = await p.evaluate(() => [...document.querySelectorAll('#jigopts-headers select[data-k="fpreset"] optgroup')].map(g => [g.label, [...g.querySelectorAll('option')].map(o => [o.value, o.textContent])]));
    const find = (g, re) => { const G = pre.find(x => x[0] === g); const o = G && G[1].find(x => re.test(x[1])); return o && o[0]; };
    ok(pre.length >= 9 && ['2-bolt exhaust flanges', '3-bolt exhaust flanges', 'V-band, Ace Standard (304)', 'V-band, Ace Quick Release', 'V-band, Vibrant 14xx', 'Turbo inlets', 'Turbo outlets (V-band)', 'Turbo outlets (bolted)', 'Wastegates', 'Wiggins (Eaton) quick disconnect'].every(g => pre.some(x => x[0] === g)), vp.n + ': flange presets grouped: 2-bolt, 3-bolt, V-band by brand, turbo, wastegate, Wiggins');
    const jigNow = async () => { await p.evaluate(() => document.querySelector('#fx-headers button[data-fx="jig"]').click()); await p.waitForTimeout(300); return (await p.evaluate(() => (window.__sent.filter(x => x[0] === 'jig').pop() || [])[1].jig)); };
    await sel('fpreset', find('V-band, Ace Standard (304)', /^3\.0 in, male/)); t = await txt(); let q = await jigNow();
    ok(/lip drops into a 77\.2 mm pocket/.test(t) && /Source/.test(t) && q.flange_shape === 'round' && q.flange_seat && q.flange_seat.kind === 'pocket' && Math.abs(q.flange_seat.d_mm - 77.19) < 0.01 && q.flange_seat.depth_mm === 4 && Math.abs(q.flange_size_mm - 107) < 0.1, vp.n + ': Ace Standard 3 in male: round plate, 77.2 mm pocket 4 mm deep');
    await sel('fpreset', find('V-band, Ace Quick Release', /^3\.0 in, female/)); q = await jigNow();
    ok(q.flange_seat && q.flange_seat.kind === 'boss' && Math.abs(q.flange_seat.d_mm - 80.67) < 0.01 && q.flange_seat.depth_mm === 1.2, vp.n + ': Ace Quick Release 3 in female: 80.7 mm boss 1.2 mm tall');
    await sel('fpreset', find('Turbo inlets', /^T3 \(Ace\)/)); q = await jigNow();
    ok(q.flange_shape === 'rect' && q.flange_w_mm === 110 && q.flange_holes.length === 4 && Math.abs(q.flange_holes[1][0] - 42.86) < 0.01 && Math.abs(q.flange_holes[1][1] + 22.225) < 0.01 && q.flange_holes[0][2] === 11 && !q.flange_seat, vp.n + ': T3 inlet: 110 × 69 plate, studs 85.7 × 44.5 mm, 11 mm holes');
    await sel('fpreset', find('2-bolt exhaust flanges', /^2\.5 in/)); q = await jigNow();
    ok(q.flange_holes.length === 2 && Math.abs(q.flange_holes[1][0] - 50.8) < 0.01 && q.flange_n === 0, vp.n + ': 2-bolt 2.5 in: bolts 4 in apart on the level line');
    await sel('fpreset', find('Turbo outlets (bolted)', /Garrett 4-bolt/)); q = await jigNow();
    ok(q.flange_n === 4 && q.flange_pcd_mm === 89 && q.flange_angle_deg === 45 && q.flange_holes.length === 0, vp.n + ': Garrett 4-bolt outlet: 4 on 89 mm turned 45°');
    const out = await p.evaluate(() => document.getElementById('fx-out-headers').innerText);
    ok(/Plate\s+29\.32 in \(745 mm\) × 19\.41 in \(493 mm\) × 6\.72 in \(171 mm\)\s+6/.test(out), vp.n + ': parts table, largest side first, inches and mm');
    await sel('style', 'frame'); t = await txt();
    ok(!/Flange locators/.test(t) && /Bolt circle/.test(t) && /held at the flanges/i.test(t), vp.n + ': flange frame: flange fields always, no locator switch');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.n + ': no page overflow');
    await ctx.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('FAILS:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
