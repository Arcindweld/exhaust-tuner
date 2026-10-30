// Engine Simulator export on the 4-Stroke tab: the block renders, the download matches the Node exporter byte for byte,
// and a manifest is written so check.js can compile every downloaded file with engine-sim's own script compiler.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const E = require('../../enginesim/export_es.js');
const OUT = path.join(process.cwd(), 'es_page_gen');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const fails = [], manifest = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd()+'/index.html');
  await pg.waitForTimeout(500);
  await pg.evaluate(() => { document.body.classList.add('expert'); location.hash = 'four-stroke'; });
  await pg.waitForTimeout(400);
  const setEngine = async (cyl, cc, n) => {
    await pg.fill('#f-cyl', String(cyl)); await pg.dispatchEvent('#f-cyl', 'input');
    const u = await pg.$eval('#f-disp', e => e.nextElementSibling.textContent);
    await pg.fill('#f-disp', String(/cu/.test(u) ? +(cc / 16.387064).toFixed(3) : cc)); await pg.dispatchEvent('#f-disp', 'input');
    await pg.selectOption('#f-n', String(n)); await pg.waitForTimeout(120);
  };
  const cases = [
    // [cyl, cc, per collector, engine key, target, extra]
    [8, 5735.5, 4, 'sbc', 'ce'], [8, 5967, 4, 'ls', 'upstream'], [8, 5000, 4, 'coy', 'ce'], [8, 5200, 8, 'fp8', 'ce'],
    [4, 1998, 4, 'i4', 'ce'], [4, 1998, 2, 'i4', 'ce'], [6, 2998, 3, 'i6', 'ce'], [6, 3600, 3, 'v6a', 'ce'], [6, 3800, 3, 'v6c', 'ce'],
    [6, 3600, 3, 'f6', 'ce'], [4, 2457, 2, 'f4', 'ce'], [10, 8400, 5, 'v10v', 'ce'], [12, 6496, 6, 'v12', 'upstream'],
    [1, 450, 1, 'm1', 'ce'], [2, 1200, 2, 'mv45', 'ce'], [2, 900, 2, 'm2c', 'ce'], [3, 1000, 3, 'm3t', 'ce'], [4, 1000, 4, 'm4x', 'ce'],
  ];
  for (const [cyl, cc, n, key, target] of cases) {
    const tag = key + '_' + cyl + 'c_' + n + 'pc_' + target;
    await setEngine(cyl, cc, n);
    const has = await pg.$('select.esx[data-k="eng"]');
    if (!has) { const t = await pg.$eval('#four-details', e => e.innerText.slice(-600)); ok(false, tag + ': export block present ' + t); continue; }
    await pg.selectOption('select.esx[data-k="eng"]', key); await pg.waitForTimeout(80);
    await pg.selectOption('select.esx[data-k="target"]', target); await pg.waitForTimeout(40);
    const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('button[data-es="dl"]')]);
    const file = path.join(OUT, tag + '.mr');
    await dl.saveAs(file);
    const last = await pg.evaluate(() => window.__esLast);
    const text = fs.readFileSync(file, 'utf8');
    const node = E.toEngineSimDetailed(last.spec, last.options);
    ok(text === node.text, tag + ': download matches the Node exporter (' + text.length + ' chars, ' + dl.suggestedFilename() + ')');
    ok(/MIT-licensed engine-sim example/.test(text) && /ROUGH LISTENING PREVIEW/.test(text), tag + ': attribution and preview label in the file');
    if (last.spec.cylinders >= 7) ok(/audio_volume: 4\.0/.test(text) && /tire_radius: 10 \* units\.inch/.test(text) && /max_clutch_torque: 500 \* units\.lb_ft/.test(text), tag + ': GM LS donor uses the MIT upstream values');
    const s = last.spec;
    ok(s.cylinders === cyl && s.firingOrder.length === cyl && s.exhaust.primaryD_mm > 0 && s.exhaust.systemL_mm > 0, tag + ': spec ' + JSON.stringify({ lay: s.layout, bank: s.bankAngle_deg, num: s.cylNumbering, dual: s.exhaust.dual, fa: s.firingAngles_deg }));
    manifest.push({ key: tag, target, file, spec: s, options: last.options, derived: node.derived });
  }
  // units: the pipe-length input follows the unit setting and feeds the spec
  await setEngine(8, 5735.5, 4);
  const inp = await pg.$('input.esl');
  await inp.fill('100'); await inp.dispatchEvent('input');
  const [dl2] = await Promise.all([pg.waitForEvent('download'), pg.click('button[data-es="dl"]')]);
  const sl = await pg.evaluate(() => window.__esLast.spec.exhaust.systemL_mm);
  const unitIsIn = await pg.evaluate(() => /in/.test(document.querySelector('input.esl').nextElementSibling.textContent));
  ok(Math.abs(sl - (unitIsIn ? 2540 : 100)) < 0.01, 'pipe length typed as 100 ' + (unitIsIn ? 'in' : 'mm') + ' reaches the file as ' + sl + ' mm');
  const txt = await pg.$eval('#four-details', e => e.innerText);
  ok(/Listen in Engine Simulator/i.test(txt) && !/NaN|undefined/.test(txt), 'block text has no NaN or undefined ' + (txt.match(/.{0,120}(NaN|undefined).{0,60}/g) || []).join(' || '));
  await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'phone: no sideways scroll');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
  console.log(fails.length ? 'FAILED: ' + fails.length : 'all passed');
  await b.close();
})();
