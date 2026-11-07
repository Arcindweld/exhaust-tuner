// Fusion panel, "Split the selected tube for printing": the settings (printer, lap, gap, material), the payload the add-in
// gets, and the result table.   node tests/psplit_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html');
  const RES = { ok: true, msg: 'Split INTAKE into 5 pieces.', split: { pieces: [
    { name: 'INTAKE PRINT 1', vol_cm3: 284.8, height_mm: 232.9, footprint_mm: [130.2, 129.2], base: 'start', length_mm: 197.5 },
    { name: 'INTAKE PRINT 2', vol_cm3: 81.9, height_mm: 80.4, footprint_mm: [101.6, 101.6], base: 'start', length_mm: 60.4 }],
    cuts: [{ s_mm: 197.5, grower: 'up' }], volume_cm3: 366.7, mass_g: 451, filament_m: 152, folder: 'C:/x' } };
  await pg.evaluate(R => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, d]); return Promise.resolve(JSON.stringify(a === 'printSplit' ? R : { ok: true })); } }; }, RES);
  await pg.waitForTimeout(600);
  await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(400);
  ok(await pg.$('#fx-intake button[data-fx="printSplit"]') !== null && await pg.$('#fx-headers button[data-fx="printSplit"]') !== null, 'the button is on the Intake and Headers tabs');
  ok(await pg.$('#fx-intake details.psopts') !== null, 'with its settings');
  await pg.click('#fx-intake button[data-fx="printSplit"]'); await pg.waitForTimeout(300);
  let pay = await pg.evaluate(() => { const s = window.__sent.find(x => x[0] === 'printSplit'); return s && JSON.parse(s[1]); });
  ok(pay && pay.bed_x_mm === 256 && pay.bed_z_mm === 256 && pay.lap_mm === 20 && pay.clearance_mm === 0.15 && Math.abs(pay.density - 1.23) < 1e-9 && /PPA-CF Core/.test(pay.material),
     'default payload: 256 mm bed, 20 mm lap, 0.15 mm gap, PPA-CF Core at 1.23 g/cm3');
  const out = await pg.$eval('#fx-out-intake', e => e.innerText);
  ok(/INTAKE PRINT 1/.test(out) && /9\.17 in \(233 mm\)/.test(out) && /366\.7 cm³/.test(out) && /0\.45 kg/.test(out), 'the result table: pieces, heights in both units, totals');
  await pg.evaluate(() => { const d = document.querySelector('#fx-intake details.psopts'); d.open = true; const s = d.querySelector('select[data-k="printer"]'); s.value = 'a1m'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await pg.waitForTimeout(200);
  await pg.evaluate(() => { const s = document.querySelector('#fx-intake details.psopts select[data-k="mat"]'); s.value = 'pm_pa12cf10'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await pg.evaluate(() => { window.__sent = []; }); await pg.click('#fx-intake button[data-fx="printSplit"]'); await pg.waitForTimeout(300);
  pay = await pg.evaluate(() => { const s = window.__sent.find(x => x[0] === 'printSplit'); return s && JSON.parse(s[1]); });
  ok(pay && pay.bed_x_mm === 180 && pay.bed_z_mm === 180 && Math.abs(pay.density - 1.06) < 1e-9, 'A1 mini and PA12-CF10: 180 mm bed, 1.06 g/cm3');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'psplit_ui: ' + fails.length + ' FAIL' : 'psplit_ui: all pass'); process.exit(fails.length ? 1 : 0); })();
