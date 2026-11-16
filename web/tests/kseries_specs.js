// Shared by kseries_ui.js: the wave simulation's specs (every variant the 4-Stroke tab would run) for five set-ups, read
// from a copy of the page. CAPTURE=path/to/old/index.html node tests/kseries_specs.js writes fixtures/kseries_specs_before.json
// (made 2026-11-15 from the page before part 14, git 07b6b07).
'use strict';
const CASES = ['default', 'ls3', 'plenum', 'K24A2', 'K20A2'];
async function specsOf(b, file) {
  const out = {};
  for (const c of CASES) {
    const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await pg.goto('file://' + file); await pg.waitForTimeout(700);
    if (/^K2/.test(c)) await pg.evaluate(code => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
      set('v-mode', 'eng'); set('v-pick', [...document.getElementById('v-pick').options].find(o => o.text.startsWith(code + ' ')).value); }, c);
    await pg.click('[data-tab="four-stroke"]'); await pg.waitForTimeout(400);
    if (c === 'ls3') await pg.evaluate(() => { const s = document.getElementById('f-camlib'); s.value = 'ls3'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    if (c === 'plenum') await pg.evaluate(() => { const s = document.getElementById('f-intk'); s.value = 'plenum'; s.dispatchEvent(new Event('change', { bubbles: true })); });
    await pg.waitForTimeout(400);
    out[c] = await pg.evaluate(() => { const q = window.__sim.inp(); return window.__sim.simVariants(q).map(v => ({ key: v.key, spec: v.spec })); });
    await pg.close();
  }
  return out;
}
module.exports = { CASES, specsOf };
if (require.main === module) (async () => {
  const { chromium } = require('playwright'), fs = require('fs'), b = await chromium.launch();
  const o = await specsOf(b, process.env.CAPTURE); fs.writeFileSync(__dirname + '/fixtures/kseries_specs_before.json', JSON.stringify(o)); await b.close();
  console.log('wrote', Object.keys(o).map(k => k + ' ' + o[k].length).join(', '));
})();
