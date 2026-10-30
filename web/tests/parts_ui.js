// Parts tab, intake velocity-stack section and the auto-route payloads, with a stand-in Fusion bridge
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const pg = await b.newPage({ viewport: { width: vp.width, height: vp.height } });
    const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + process.cwd()+'/index.html');
    await pg.evaluate(() => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, d]); return Promise.resolve(JSON.stringify({ ok: true, msg: 'stub', route_ok: true, items: [{ kind: 'path', name: 'P1', length: 76.2, ok: true, min_gap: 1.5, lra: [{ L: 2.54, R: null, A: 90, CLR: 6.2 }, { L: 3, R: null, A: null, CLR: null }], fab: { bends: 1, turn_deg: 90, min_clr: 6.2, min_between: null, pieces: 1, flags: ['A bend radius is under one tube diameter.'], print: 'Metal 3D printing note.' } }, { kind: 'part', name: 'Muffler', ok: true, min_gap: 4.2, note: 'Placed 30 cm along the route.' }] })); } }; });
    await pg.waitForTimeout(600);
    await pg.evaluate(() => { location.hash = 'parts'; }); await pg.waitForTimeout(300);
    const kinds = await pg.$$eval('#p-kind option', o => o.map(x => x.value));
    ok(kinds.length >= 10, vp.n + ': parts kinds listed (' + kinds.join(',') + ')');
    let bad = false, total = 0;
    for (const k of kinds) {
      await pg.selectOption('#p-kind', k); await pg.waitForTimeout(80);
      const t = await pg.$eval('#panel-parts', el => el.innerText);
      const n = await pg.$$eval('#p-list .pcard', c => c.length);
      total += n;
      if (/\bNaN\b|\bundefined\b|\[object|null in|\?\s(in|mm)\b/.test(t)) { bad = true; console.log('  text problem in', k, (t.match(/.{40}(NaN|undefined|\[object|null in|\? (in|mm)).{40}/) || [''])[0]); }
      if (!n) { bad = true; console.log('  no cards for', k); }
    }
    ok(!bad, vp.n + ': every kind shows cards with no NaN/undefined (' + total + ' cards)');
    // brand and size filters
    await pg.selectOption('#p-kind', 'muffler'); await pg.waitForTimeout(80);
    const brands = await pg.$$eval('#p-brand option', o => o.map(x => x.value).filter(Boolean));
    ok(['Flowmaster', 'Borla', 'MagnaFlow', 'Spintech', 'Black Widow', 'Vibrant'].every(x => brands.indexOf(x) >= 0), vp.n + ': muffler brands include the ones asked for (' + brands.join(', ') + ')');
    await pg.selectOption('#p-brand', 'Flowmaster'); await pg.waitForTimeout(80);
    const fm = await pg.$$eval('#p-list .pcard .ph b', bs => bs.map(x => x.textContent));
    ok(fm.length > 0 && fm.every(x => x.indexOf('Flowmaster') === 0), vp.n + ': brand filter (' + fm.length + ' Flowmaster)');
    // add to build list, reorder, custom part
    await pg.click('#p-list button[data-addpart]'); await pg.waitForTimeout(80);
    await pg.selectOption('#p-kind', 'flex'); await pg.waitForTimeout(80);
    await pg.click('#p-list button[data-addpart]'); await pg.waitForTimeout(80);
    let rows = await pg.$$eval('#p-build tbody tr', r => r.length);
    ok(rows === 2, vp.n + ': two parts in the build list');
    await pg.click('#p-build button[data-bmove="1"][data-d="-1"]'); await pg.waitForTimeout(50);
    const first = await pg.$eval('#p-build tbody tr td:nth-child(2)', e => e.textContent);
    ok(/Vibrant|Walker|Stainless|Ticon/.test(first), vp.n + ': reorder moved the flex pipe first (' + first + ')');
    await pg.evaluate(() => { document.getElementById('p-custom').open = true; });
    await pg.fill('#pc-name', 'My scanned muffler'); await pg.click('#pc-add'); await pg.waitForTimeout(80);
    rows = await pg.$$eval('#p-build tbody tr', r => r.length);
    ok(rows === 3, vp.n + ': custom part added');
    // route payload for the parts tab
    await pg.evaluate(() => { window.__sent = []; });
    await pg.click('#fx-parts button[data-fx="routeParts"]'); await pg.waitForTimeout(150);
    const sent = await pg.evaluate(() => window.__sent.map(s => [s[0], JSON.parse(s[1])]));
    const pay = sent.find(s => s[0] === 'route');
    ok(pay && pay[1].mode === 'parts' && pay[1].parts.length === 3 && pay[1].od_mm > 0 && pay[1].wall_mm > 0 && pay[1].gap_mm > 0, vp.n + ': parts route payload ' + (pay ? JSON.stringify({ mode: pay[1].mode, n: pay[1].parts.length, od: pay[1].od_mm }) : 'missing'));
    const outTxt = await pg.$eval('#fx-out-parts', e => e.innerText);
    ok(/clear and buildable/.test(outTxt) && /Smallest gap/.test(outTxt) && /under one tube diameter/.test(outTxt) && /Metal 3D printing/.test(outTxt), vp.n + ': route results render');
    // headers payload
    await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(250);
    await pg.evaluate(() => { window.__sent = []; });
    await pg.click('#fx-headers button[data-fx="routeHeader"]'); await pg.waitForTimeout(150);
    const hp = await pg.evaluate(() => window.__sent.map(s => [s[0], JSON.parse(s[1])]).find(s => s[0] === 'route'));
    ok(hp && hp[1].mode === 'header' && hp[1].target_mm > 0 && hp[1].od_mm > hp[1].wall_mm && hp[1].collector_len_mm > 0 && hp[1].collector_out_mm > 0, vp.n + ': header payload ' + (hp ? JSON.stringify({ t: Math.round(hp[1].target_mm), od: hp[1].od_mm.toFixed(2), cl: Math.round(hp[1].collector_len_mm), co: Math.round(hp[1].collector_out_mm) }) : 'missing'));
    // route settings sync and units
    await pg.evaluate(() => { document.querySelectorAll('details.fxroute').forEach(d => d.open = true); });
    const clr = await pg.$('#fx-headers .fxr[data-k="clr_mm"]');
    await clr.fill('2.5'); await clr.dispatchEvent('input'); await pg.waitForTimeout(50);
    await pg.evaluate(() => { window.__sent = []; });
    await pg.click('#fx-headers button[data-fx="routeHeader"]'); await pg.waitForTimeout(100);
    const rset = await pg.evaluate(() => { const s = window.__sent.find(x => x[0] === 'route'); return s ? JSON.parse(s[1]).clr_mm : null; });
    ok(Math.abs(rset - 63.5) < 0.01, vp.n + ': bend radius setting read in inches (' + rset + ' mm)');
    // intake: stack section and intake route payload with filter, MAF, coupler
    await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(300);
    await pg.evaluate(() => { document.body.classList.add('expert'); });
    const it = await pg.$eval('#i-details', e => e.innerText);
    ok(/Velocity stack or bellmouth/i.test(it) && /2\.13/.test(it) && /Fig\. 6\.4/.test(it) && /What the makers say/.test(it) && !/NaN|undefined/.test(it), vp.n + ': intake stack section and MAF guidance');
    await pg.evaluate(() => { location.hash = 'parts'; }); await pg.waitForTimeout(200);
    await pg.selectOption('#p-kind', 'coupler'); await pg.waitForTimeout(80);
    await pg.click('#p-list button[data-addpart]'); await pg.waitForTimeout(50);
    await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(300);
    await pg.evaluate(() => { window.__sent = []; });
    await pg.click('#fx-intake button[data-fx="routeParts"]'); await pg.waitForTimeout(150);
    const ip = await pg.evaluate(() => window.__sent.map(s => [s[0], JSON.parse(s[1])]).find(s => s[0] === 'route'));
    const kindsSent = ip ? ip[1].parts.map(q => q.kind + (q.at ? '@' + q.at : '')) : [];
    ok(ip && ip[1].mode === 'parts' && kindsSent.indexOf('filter@start') >= 0 && kindsSent.some(k => k.indexOf('maf') === 0) && kindsSent.indexOf('coupler@end') >= 0, vp.n + ': intake payload ' + kindsSent.join(', '));
    const maf = ip && ip[1].parts.find(q => q.kind === 'maf');
    ok(maf && maf.lead_in_in > 0 && maf.lead_out_in > 0, vp.n + ': MAF straight runs sent (' + (maf ? maf.lead_in_in + ' / ' + maf.lead_out_in + ' in' : '-') + ')');
    // layout
    const wide = await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    ok(wide, vp.n + ': no sideways scroll');
    await pg.evaluate(() => { location.hash = 'parts'; }); await pg.waitForTimeout(200);
    const wide2 = await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    ok(wide2, vp.n + ': parts tab fits the width');
    await pg.screenshot({ path: 'parts-' + vp.n + '.png', fullPage: false });
    ok(errs.length === 0, vp.n + ': no page errors ' + errs.join(' | '));
    await pg.close();
  }
  console.log(fails.length ? 'FAILED: ' + fails.length : 'all passed');
  await b.close();
})();
