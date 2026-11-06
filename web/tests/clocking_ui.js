// Headers tab: the firing-order clocking of the tubes round each n-into-1 collector (none on a Tri-Y).  node tests/clocking_ui.js
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs=[]; pg.on('pageerror', e => errs.push(e.message)); const fails=[]; const ok=(c,m)=>{ console.log((c?'PASS ':'FAIL ')+m); if(!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html'); await pg.waitForTimeout(900);
  await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(600);
  const opts = await pg.evaluate(() => [...document.getElementById('h-eng').options].map(o=>o.value));
  for (const [eng, grp] of [['ls','all'],['ls','bank'],['i4','all']]) {
    ok(opts.includes(eng), eng+' in the engine list'); if (!opts.includes(eng)) continue;
    await pg.selectOption('#h-eng', eng); await pg.waitForTimeout(300); await pg.selectOption('#h-grp', grp); await pg.waitForTimeout(400);
    const t = await pg.evaluate(() => { const e=document.getElementById('h-clock'); return e?e.innerText:''; });
    const want = {ls_all:'1 → 8 → 7 → 2 → 6 → 5 → 4 → 3', ls_bank:'A: 1 → 7 → 5 → 3; B: 8 → 2 → 6 → 4', i4_all:'1 → 3 → 4 → 2'}[eng+'_'+grp];
    ok(t.includes(want), eng+' '+grp+': clocking '+want);
  }
  await pg.selectOption('#h-merge','triy'); await pg.waitForTimeout(300);
  ok(!(await pg.evaluate(() => !!document.getElementById('h-clock'))), 'Tri-Y: no clocking line (its pairs decide the order)');
  ok(!errs.length, 'no page errors '+errs.join('; '));
  await b.close(); console.log(fails.length ? 'clocking_ui: '+fails.length+' FAIL' : 'clocking_ui: all pass'); process.exit(fails.length?1:0); })();
