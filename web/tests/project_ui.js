// Projects (header button): save the whole build, change it, load it back exactly; compare two builds (the inputs
// that differ and OpenWAM torque speed by speed); export a file and import it again; delete with a second click.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true }); const pg = await ctx.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(500);
  await pg.evaluate(() => localStorage.removeItem('exhaust-projects-v1'));
  await pg.click('#m-expert');
  await setv('f-camlib', 'ls3'); await pg.waitForTimeout(200);
  for (const [id, v] of [['#f-rpm', '6000'], ['#f-dp', '1.875'], ['#f-trq', '4600']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
  await setv('h-eng', 'ls'); await setv('h-merge', 'triy');
  // pretend OpenWAM results and a line after the collector, then save as A
  await pg.evaluate(() => { window.__proj.wam.results = [{ name: 'a_4000', rpm: 4000, tq: 560, tqb: 520 }, { name: 'a_6000', rpm: 6000, tq: 540, tqb: 490 }]; });
  const before = await pg.evaluate(() => ({ dp: document.getElementById('f-dp')._b, ivo: document.getElementById('f-ivo')._b, lib: document.getElementById('f-camlib').value, heng: document.getElementById('h-eng').value, merge: document.getElementById('h-merge').value }));
  await pg.click('#proj-btn'); await pg.waitForTimeout(150);
  ok(await pg.$eval('#proj-dlg', d => d.open), 'the Projects dialog opens');
  await pg.fill('#proj-name', 'LS3 1-7/8 8-4-1'); await pg.click('#proj-save'); await pg.waitForTimeout(100);
  ok(/Saved “LS3 1-7\/8 8-4-1”/.test(await pg.$eval('#proj-msg', e => e.textContent)), 'saved message');
  await pg.click('#proj-close');
  // change things: bigger primaries, other cam, metric units, results changed; save as B
  await setv('f-camlib', ''); await pg.fill('#f-dp', '2'); await pg.dispatchEvent('#f-dp', 'input'); await setv('f-ivo', '-10'); await setv('h-merge', 'direct');
  await pg.evaluate(() => { window.__proj.wam.results = [{ name: 'b_4000', rpm: 4000, tq: 550, tqb: 510 }, { name: 'b_6000', rpm: 6000, tq: 560, tqb: 510 }, { name: 'b_6600', rpm: 6600, tq: 520, tqb: 470 }]; });
  await pg.click('#u-met');
  await pg.click('#proj-btn'); await pg.fill('#proj-name', '2 in primaries'); await pg.click('#proj-save'); await pg.waitForTimeout(100);
  const rows = await pg.$$eval('#proj-list .pj-row', r => r.length);
  ok(rows === 2, 'two projects listed (' + rows + ')');
  // load A back
  await pg.click('#proj-list .pj-row[data-i="0"] button[data-pj="load"]'); await pg.waitForTimeout(400);
  const after = await pg.evaluate(() => ({ dp: document.getElementById('f-dp')._b, ivo: document.getElementById('f-ivo')._b, lib: document.getElementById('f-camlib').value, heng: document.getElementById('h-eng').value, merge: document.getElementById('h-merge').value,
    imp: document.getElementById('u-imp').getAttribute('aria-pressed'), shown: document.getElementById('f-dp').value, res: window.__proj.wam.results.map(r => r.rpm) }));
  ok(Math.abs(after.dp - before.dp) < 1e-12 && after.ivo === before.ivo, 'loaded A: primary ' + after.dp + ' mm, IVO ' + after.ivo + ' exactly as saved');
  ok(after.lib === before.lib && after.heng === before.heng && after.merge === before.merge, 'loaded A: cam library, Headers engine and merge as saved (' + [after.lib, after.heng, after.merge].join(', ') + ')');
  ok(after.imp === 'true' && after.shown === '1.875', 'loaded A: inches again, the field reads 1.875');
  // the OpenWAM results come back too (the table reads WAM_UI.results)
  ok(JSON.stringify(after.res) === '[4000,6000]', 'loaded A: its OpenWAM results back (' + after.res.join(', ') + ')');
  // compare
  await pg.selectOption('#proj-a', '0'); await pg.selectOption('#proj-b', '1'); await pg.click('#proj-cmp'); await pg.waitForTimeout(150);
  const out = await pg.$eval('#proj-out', e => e.innerText);
  ok(/4-Stroke: .*primary/i.test(out) && /1\.875 in/.test(out) && /2 in/.test(out), 'compare lists the primary size, both in inches');
  ok(/Headers: /.test(out), 'compare lists the Headers-tab merge');
  ok(/6000\s+490 N·m \(361 lb-ft\)\s+510 N·m \(376 lb-ft\)\s+\+4\.1%/.test(out), 'OpenWAM brake torque side by side at 6000 (+4.1%)');
  ok(/6600\s+not run\s+470 N·m/.test(out), 'a speed only B ran shows "not run" for A');
  ok(!/NaN|undefined/.test(out), 'no NaN or undefined in the comparison');
  // export and import
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#proj-list .pj-row[data-i="1"] button[data-pj="exp"]')]);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'proj_')), dl.suggestedFilename()); await dl.saveAs(f);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  ok(j.exhaustTunerProject === 1 && j.name === '2 in primaries' && j.units === 'met' && j.vals['f-dp'].b === 50.8, 'exported file: ' + dl.suggestedFilename() + ', 50.8 mm primaries, metric');
  await pg.setInputFiles('#proj-file', f); await pg.waitForTimeout(300);
  ok(/Imported “2 in primaries \(2\)”/.test(await pg.$eval('#proj-msg', e => e.textContent)), 'import keeps both under different names');
  fs.writeFileSync(f, '{"hello":1}'); await pg.setInputFiles('#proj-file', f); await pg.waitForTimeout(300);
  ok(/not an Exhaust Tuner project/.test(await pg.$eval('#proj-msg', e => e.textContent)), 'a JSON file that is not a project is refused');
  // delete asks twice
  await pg.click('#proj-list .pj-row[data-i="2"] button[data-pj="del"]');
  ok(await pg.$$eval('#proj-list .pj-row', r => r.length) === 3, 'first Delete click only asks');
  await pg.click('#proj-list .pj-row[data-i="2"] button[data-pj="del"]'); await pg.waitForTimeout(100);
  ok(await pg.$$eval('#proj-list .pj-row', r => r.length) === 2, 'second click deletes');
  // phone width: no sideways scroll with the dialog open
  await pg.setViewportSize({ width: 390, height: 800 }); await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => { const d = document.getElementById('proj-dlg'); return d.scrollWidth <= d.clientWidth + 1 && d.getBoundingClientRect().right <= 390; }), 'the dialog fits a phone');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
