const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs=[]; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd()+'/index.html'); await pg.waitForTimeout(500);
  await pg.evaluate(() => { document.body.classList.add('expert'); location.hash = 'headers'; }); await pg.waitForTimeout(300);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  for (const [eng, grp] of [['i6','all'], ['m6','all'], ['f6','all'], ['i4','all'], ['sbc','bank'], ['v12','bank'], ['i6','bank']]) {
    await setv('h-eng', eng); await setv('h-grp', grp); await setv('h-merge', 'triy'); await pg.waitForTimeout(150);
    const key = await pg.$eval('#h-key', e => e.innerText.replace(/\n+/g, ' | ').slice(0, 160));
    const det = await pg.$eval('#h-details', e => e.innerText);
    const firsts = (det.match(/FIRST MERGE, THREE INTO ONE[\s\S]{0,200}|Y PAIR[\s\S]{0,160}/i) || [''])[0].replace(/\n+/g,' | ');
    console.log(eng, grp, '=>', key, '\n   ', firsts.slice(0, 220), /NaN|undefined/.test(det) ? 'NaN!' : '');
  }
  console.log('errors:', errs.join('|') || 'none'); await b.close(); })();
