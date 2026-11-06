// The LS and LT engines by name in every engine picker (an LS3 or LT4 can be picked as such), each giving exactly what
// the GM LS / LT family entry gives: the same firing order, banks and Headers-tab results.  node tests/engnames_ui.js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html'); await pg.waitForTimeout(800);
  const lists = await pg.evaluate(() => ['q-eng', 's-eng', 'i-eng', 'h-eng'].map(id => { const o = [...document.getElementById(id).options]; return { id, ls3: o.find(x => /LS3/.test(x.textContent)), lt4: o.find(x => /LT4/.test(x.textContent)) }; }).map(x => ({ id: x.id, ls3: x.ls3 && x.ls3.value, lt4: x.lt4 && x.lt4.value, grp: x.lt4 && x.lt4.parentElement.label })));
  for (const l of lists) ok(l.ls3 && l.lt4 && /Chevrolet \/ GM/.test(l.grp), l.id + ': LS3 and LT4 listed by name under Chevrolet / GM (' + l.ls3 + ', ' + l.lt4 + ')');
  await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(500);
  const same = [];
  for (const k of ['ls', 'gm_ls3', 'gm_lt4']) { await pg.selectOption('#h-eng', k); await pg.waitForTimeout(400); same.push(await pg.evaluate(() => document.getElementById('h-key').innerText + '|' + document.getElementById('h-details').innerText.slice(0, 3000))); }
  const strip = t => t.replace(/GM [^·\n]*V8 · 1-8-7-2-6-5-4-3|GM LS and LT V8 · 1-8-7-2-6-5-4-3/g, 'ENGINE');
  if (strip(same[0]) !== strip(same[2])) { const a = strip(same[0]), c = strip(same[2]); let i = 0; while (a[i] === c[i]) i++; console.log('first difference: ' + JSON.stringify(a.slice(Math.max(0, i - 80), i + 80)) + ' vs ' + JSON.stringify(c.slice(Math.max(0, i - 80), i + 80))); }
  ok(strip(same[0]) === strip(same[1]) && strip(same[0]) === strip(same[2]) && same[0].length > 100, 'Headers tab: LS3, LT4 and the family entry give the same results');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'engnames_ui: ' + fails.length + ' FAIL' : 'engnames_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
