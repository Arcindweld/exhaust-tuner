// The J-pipe in Fusion: the auto-route has to carry the cut length (the length is what tunes a J-pipe),
// the page has to say where the markers go, and a measured or routed J-pipe is read back as a frequency
// with the same formula the Mufflers tab uses (calcQW: L = c / 4f - 0.3 d). The page script is private,
// so everything is read from what it sends to the stand-in Fusion and from what it shows.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    window.__sent = []; window.__reply = null; window.__delay = 0;
    window.adsk = { fusionSendData: (a, d) => {
      window.__sent.push([a, JSON.parse(d)]);
      const r = JSON.stringify(window.__reply || { ok: true, msg: 'stub', items: [] });
      return new Promise(res => setTimeout(() => res(r), window.__delay));
    } };
  });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers'); await pg.waitForTimeout(700);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const lastRoute = () => pg.evaluate(() => (window.__sent.filter(s => s[0] === 'route').pop() || [])[1]);
  ok(await pg.$('#fx-muf button[data-fx="routeSingleMuf"]') !== null, 'the Mufflers tab has the J-pipe auto-route');
  const f = +(await pg.$eval('#m-f', e => e.value));

  // the auto-route: target length sent, the marker note shown while Fusion works
  await pg.evaluate(() => { window.__sent = []; window.__delay = 800; window.__reply = null; });
  await pg.click('#fx-muf button[data-fx="routeSingleMuf"]'); await pg.waitForTimeout(150);
  const during = await pg.$eval('#fx-out-muf', e => e.innerText);
  const pay = await lastRoute();
  const L = pay && pay.target_mm, db = pay && pay.od_mm - 2 * pay.wall_mm, end = 0.3 * db;
  ok(pay && pay.mode === 'single' && pay.title === 'J-pipe', 'a single route named J-pipe is sent');
  ok(L > 0, 'the route carries a target length (' + (L && L.toFixed(1)) + ' mm)');
  ok(pay && pay.od_mm > 0 && pay.wall_mm > 0 && db > 0, 'tube size sent (ID ' + (db && db.toFixed(2)) + ' mm)');
  ok(pay && !['c', 'end', 'f', 'L'].some(k => k in pay), 'tuning numbers are kept out of what goes to Fusion');
  const m = /The route comes out (.+?) long, the cut length from the pipe wall to the cap/.exec(during);
  const det = await pg.$eval('#m-details', e => e.innerText);
  ok(/J-pipe: draw the start marker on the main pipe wall/.test(during) && /far end gets a cap plate/.test(during) && /coped to the main pipe/.test(during) && m, 'the note says where the markers go, how long the route comes out, and that it is capped and coped');
  ok(pay && pay.cap === true && pay.tee === true && Math.abs(pay.cap_mm - 3.175) < 1e-9 && Math.abs(pay.main_od_mm - (60.198 + 2 * 1.651)) < 1e-9,
     'the route asks for the cap (1/8 in plate) and the tee, with the main pipe size for reading it from a scan (' + (pay && pay.main_od_mm) + ' mm)');
  // the note gives both units, "24.0 in (610 mm)"; the row shows the same two figures, the second under the first
  const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), mu = m && /^(.+?) \((.+)\)$/.exec(m[1]);
  ok(mu && new RegExp('Cut length, capped end to pipe wall\\s*' + esc(mu[1]) + '\\s*' + esc(mu[2])).test(det), 'and its length is the cut length the tab shows (' + (m && m[1]) + ')');

  // the reply: a route at the cut length reads "on length" and tunes to the target
  await pg.evaluate(L => { window.__reply = { ok: true, msg: 'Built j-pipe along a route that clears the scan.', items: [{ kind: 'path', name: 'J-pipe', length: L / 10, ok: true, min_gap: 1.4 }] }; }, L);
  await pg.click('#fx-muf button[data-fx="routeSingleMuf"]'); await pg.waitForTimeout(1100);
  let res = await pg.$eval('#fx-out-muf', e => e.innerText);
  ok(/Against the J-pipe cut length\s*on length/.test(res), 'a route at the cut length reads "on length"');
  const hz = Math.round(f);
  ok(new RegExp('As a J-pipe, tunes to\\s*' + hz + ' Hz').test(res), 'and tunes to the target ' + hz + ' Hz');

  // a measured path 40 mm longer reads as long, and tunes lower by the same formula: f (L + e) / (L + 40 + e)
  await pg.evaluate(L => { window.__delay = 0; window.__reply = { ok: true, items: [{ kind: 'path', name: 'J-pipe path', length: L / 10 + 4 }] }; }, L);
  await pg.click('#fx-muf button[data-fx="measure"]'); await pg.waitForTimeout(250);
  res = await pg.$eval('#fx-out-muf', e => e.innerText);
  const fLong = f * (L + end) / (L + 40 + end), shown = /As a J-pipe, tunes to\s*(\d+) Hz/.exec(res);
  ok(/Against the J-pipe cut length\s*\+/.test(res) && /long: trim it to tune up/.test(res), 'a longer path reads as long, to trim');
  ok(shown && Math.abs(+shown[1] - fLong) <= 0.51 && fLong < f, 'and tunes lower: ' + (shown && shown[1]) + ' Hz (formula ' + fLong.toFixed(1) + ')');

  // a tube body gets no J-pipe rows
  await pg.evaluate(() => { window.__reply = { ok: true, items: [{ kind: 'body', name: 'Tube', od: [6.35], id: [5.99], length: 40 }] }; });
  await pg.click('#fx-muf button[data-fx="measure"]'); await pg.waitForTimeout(250);
  res = await pg.$eval('#fx-out-muf', e => e.innerText);
  ok(!/J-pipe cut length/.test(res), 'a tube body gets no J-pipe rows');

  // with an error on the tab there is no cut length: no target, no note, no read-back
  await setv('m-f', '0'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__sent = []; window.__reply = { ok: false, msg: 'The tube size from the page is not valid.' }; });
  await pg.click('#fx-muf button[data-fx="routeSingleMuf"]'); await pg.waitForTimeout(250);
  const pay2 = await lastRoute();
  ok(pay2 && !('target_mm' in pay2) && !('od_mm' in pay2), 'no target or stale size is sent when the tab has an error');
  await pg.evaluate(() => { window.__reply = { ok: true, items: [{ kind: 'path', name: 'J-pipe path', length: 50 }] }; });
  await pg.click('#fx-muf button[data-fx="measure"]'); await pg.waitForTimeout(250);
  res = await pg.$eval('#fx-out-muf', e => e.innerText);
  ok(!/J-pipe cut length/.test(res) && /Centerline length/.test(res), 'and a measured path shows its length without J-pipe rows');
  await setv('m-f', String(f)); await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__sent = []; window.__reply = null; });
  await pg.click('#fx-muf button[data-fx="routeSingleMuf"]'); await pg.waitForTimeout(250);
  const pay3 = await lastRoute();
  ok(pay3 && Math.abs(pay3.target_mm - L) < 1e-9, 'the cut length comes back when the error is fixed');

  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  console.log(fails.length ? 'FAILS: ' + fails.join('; ') : 'all J-pipe checks passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
