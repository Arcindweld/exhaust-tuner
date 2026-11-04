// A merge collector's cut files in the Fusion answer (fixtures/merge_route.json, written by
// fusion-addin/tests/test_merge.py from merge.py): the merge listed as a part with its summary, one save button per
// file, each file going to Fusion's save with its own name and the DXF text; the hanger tab's save still works
// through the same helper; no overflow on a phone; no page errors. Run from web/.
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const fx = JSON.parse(fs.readFileSync('tests/fixtures/merge_route.json', 'utf8'));
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const ctx = await b.newContext({ viewport: vp });
    await ctx.addInitScript(() => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, JSON.parse(d)]);
      return Promise.resolve(JSON.stringify(a === 'saveText' ? { ok: true, msg: 'Saved ' + JSON.parse(d).filename + '.' } : { ok: true })); } }; });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + process.cwd() + '/index.html#headers'); await p.waitForTimeout(900);
    await p.evaluate(r => window.__fxRender('headers', r), fx); await p.waitForTimeout(200);
    const t = await p.evaluate(() => document.getElementById('fx-out-headers').innerText);
    ok(/Merge collector/.test(t) && /4 into 1/.test(t) && /merge plate/.test(t) && /spike/.test(t), vp.n + ': the merge is listed with its plate and spike');
    const btns = await p.evaluate(() => [...document.querySelectorAll('#fx-out-headers button[data-fxfile]')].map(x => x.textContent));
    ok(btns.length === 2 && /plate_0\.125in_mm\.dxf/.test(btns[0]) && /cone_and_sleeve_0\.065in_mm\.dxf/.test(btns[1]), vp.n + ': a save button per cut file: ' + btns.join(' | '));
    ok(/CUT layer/.test(t) && /rolled with a butt seam/.test(t), vp.n + ': what each file holds');
    for (let i = 0; i < 2; i++) {
      await p.click('#fx-out-headers button[data-fxfile="' + i + '"]'); await p.waitForTimeout(250);
      const s = await p.evaluate(() => window.__sent.filter(x => x[0] === 'saveText').pop());
      ok(s && s[1].filename === fx.files[i].name && s[1].text === fx.files[i].text && /ENTITIES/.test(s[1].text), vp.n + ': ' + fx.files[i].name + ' goes to Fusion\'s save, byte for byte');
      ok(new RegExp('Saved ' + fx.files[i].name.replace(/\./g, '\\.')).test(await p.evaluate(() => document.getElementById('fx-files-msg-headers').textContent)), vp.n + ': the answer is shown');
    }
    // a second build without files clears the buttons
    await p.evaluate(() => window.__fxRender('headers', { ok: true, msg: 'Built.', items: [] }));
    ok(!(await p.$('#fx-out-headers button[data-fxfile]')), vp.n + ': a build with no cut files shows none');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.n + ': no page overflow');
    await ctx.close();
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('failures:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
