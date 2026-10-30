const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); console.log((c?'PASS ':'FAIL ')+m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
  const pg = await b.newPage({ viewport: vp }); const errs=[]; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd()+'/index.html');
  await pg.evaluate(() => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, d]); return Promise.resolve(JSON.stringify({ ok: true, msg: 'stub', route_ok: true, items: [{ kind: 'fitting', name: 'BOV', ok: true, min_gap: 2.1, note: '8 cm from the end.' }] })); } }; });
  await pg.waitForTimeout(600);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await pg.evaluate(() => { location.hash = 'parts'; }); await pg.waitForTimeout(300);
  let total = 0, bad = false;
  for (const k of ['intercooler', 'bov', 'bung', 'bend', 'clamp', 'coupler']) {
    await setv('p-kind', k); await pg.waitForTimeout(80);
    const t = await pg.$eval('#panel-parts', el => el.innerText); const n = await pg.$$eval('#p-list .pcard', c => c.length); total += n;
    if (/\bNaN\b|\bundefined\b|\[object|null in/.test(t)) { bad = true; console.log('  text problem in', k, (t.match(/.{40}(NaN|undefined|\[object|null in).{40}/) || [''])[0]); }
    if (!n) { bad = true; console.log('  no cards for', k); }
  }
  ok(!bad && total > 100, vp.n + ': new part kinds render (' + total + ' cards across 6 kinds)');
  await setv('p-kind', 'bov'); await setv('p-brand', 'Turbosmart'); await pg.waitForTimeout(80);
  const bovTxt = await pg.$eval('#p-list', e => e.innerText);
  ok(/2\.91 in/.test(bovTxt) && /Add to the build list/.test(bovTxt), vp.n + ': Turbosmart RacePort card shows the body size and an add button');
  await pg.click('#p-list button[data-addpart]'); await pg.waitForTimeout(60);
  await setv('p-kind', 'bung'); await setv('p-brand', 'Vibrant'); await pg.waitForTimeout(80); await pg.click('#p-list button[data-addpart]'); await pg.waitForTimeout(60);
  await setv('p-kind', 'coupler'); await setv('p-brand', 'Vibrant'); await pg.waitForTimeout(80); await pg.click('#p-list button[data-addpart]'); await pg.waitForTimeout(60);
  const rows = await pg.$$eval('#p-build tbody tr', r => r.length); ok(rows === 3, vp.n + ': valve, bung and coupler in the build list');
  // intake tab, boosted: charge pipe rules and the route payload with fittings
  await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(300);
  await pg.evaluate(() => { document.body.classList.add('expert'); });
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(200);
  const it = await pg.$eval('#i-details', e => e.innerText);
  ok(/Building it/i.test(it) && /MS33660/.test(it) && /0\.082 in/.test(it) && /Samco/.test(it) && /not on the inside radius of a bend/.test(it) && /Haltech/.test(it) && !/NaN|undefined/.test(it), vp.n + ': charge pipe build rules present with sources');
  await pg.evaluate(() => { window.__sent = []; });
  await pg.click('#fx-intake button[data-fx="routeParts"]'); await pg.waitForTimeout(200);
  const pay = await pg.evaluate(() => window.__sent.map(s => [s[0], JSON.parse(s[1])]).find(s => s[0] === 'route'));
  const kinds = pay ? pay[1].parts.map(q => q.kind + (q.at ? '@' + q.at : '') + (q.attach ? '*' : '')) : [];
  ok(pay && pay[1].mode === 'parts' && kinds.indexOf('coupler@end') >= 0 && kinds.indexOf('bov*') >= 0 && kinds.indexOf('bung*') >= 0 && kinds.every(k => k.indexOf('filter') < 0 && k.indexOf('maf') < 0), vp.n + ': boosted route payload ' + kinds.join(', '));
  const bovP = pay && pay[1].parts.find(q => q.kind === 'bov');
  ok(bovP && bovP.tube_od_in > 2 && bovP.prefer === 'end' && Math.abs(pay[1].od_mm - bovP.tube_od_in * 25.4) < 0.01, vp.n + ': fitting carries the charge pipe OD (' + (bovP && bovP.tube_od_in.toFixed(3)) + ' in, payload ' + (pay && pay[1].od_mm.toFixed(1)) + ' mm)');
  const outTxt = await pg.$eval('#fx-out-intake', e => e.innerText);
  ok(/BOV/.test(outTxt), vp.n + ': fitting result renders');
  // natural aspiration keeps the filter and MAF behaviour
  await setv('i-ind', 'na'); await pg.waitForTimeout(200); await pg.evaluate(() => { window.__sent = []; });
  await pg.click('#fx-intake button[data-fx="routeParts"]'); await pg.waitForTimeout(200);
  const pay2 = await pg.evaluate(() => window.__sent.map(s => [s[0], JSON.parse(s[1])]).find(s => s[0] === 'route'));
  const k2 = pay2 ? pay2[1].parts.map(q => q.kind + (q.at ? '@' + q.at : '')) : [];
  ok(pay2 && k2.some(k => k.indexOf('filter') === 0) && k2.some(k => k.indexOf('maf') === 0), vp.n + ': NA payload still has the filter and MAF (' + k2.join(', ') + ')');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), vp.n + ': no sideways scroll');
  ok(errs.length===0, vp.n + ': no page errors '+errs.join('|')); await pg.close(); }
  console.log(fails.length?'FAILED: '+fails.length:'all passed'); await b.close(); })();
