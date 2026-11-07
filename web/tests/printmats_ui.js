// Intake tab, 3D printing: the added filament rows (Siraya Tech, Polymaker Fiberon, SUNLU, 3DXTech, Raise3D, QIDI) are listed by maker,
// each renders the Printing it section with no NaN/undefined, assumed figures are starred, and the X1 Carbon checks follow the sheets.
//   node tests/printmats_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await setv('i-fab', 'fdm'); await pg.waitForTimeout(300);
  const info = await pg.evaluate(() => { const M = window.__printTest.PRINT_MATS.filter(m => m.proc === 'fdm'); const sel = document.getElementById('i-pmat');
    return { n: M.length, groups: [...sel.querySelectorAll('optgroup')].map(g => g.label), ids: M.map(m => m.id), bad: M.filter(m => !(m.sz > 0 && m.hdt18 > 0 && m.tmax > 0 && m.wet > 0 && m.locs)).map(m => m.id),
      core: M.find(m => m.id === 'sy_ppacfcore'), pps: M.find(m => m.id === 'pm_ppscf10'), su: M.find(m => m.id === 'su_pa6cf'), htn: M.find(m => m.id === 'dx_htncf') }; });
  ok(info.n >= 44, 'all filaments listed (' + info.n + ')');
  ok(['Bambu', 'Polymaker', 'Siraya', 'SUNLU', 'QIDI', '3DXTech', 'Raise3D'].every(g => info.groups.includes(g)), 'grouped by maker: ' + info.groups.join(', '));
  ok(!info.bad.length, 'every row has the numbers the wall solver needs ' + info.bad.join(','));
  ok(info.core.hdt18 === 126 && info.core.zAss && Math.abs(info.core.sz - 36.3) < 1e-9 && info.core.x1c === 'ok', 'PPA-CF Core: annealed HDT 126 °C, across-layer assumed 30% of 121 MPa, prints on the X1C');
  ok(info.pps.x1c === 'no' && info.su.hdtAss && info.htn.tmax === 150, 'PPS-CF10 not on the X1C; SUNLU HDT assumed; HTN+CF capped at its 150 °C rating');
  let nan = [];
  for (const id of info.ids) { await setv('i-pmat', id); await pg.waitForTimeout(60); const t = await pg.$eval('#i-details', e => e.innerText); if (/\bNaN\b|\bundefined\b|\[object/.test(t) || !/printing it/i.test(t)) nan.push(id); }
  ok(!nan.length, 'every material renders the Printing it section cleanly ' + nan.join(','));
  await setv('i-pmat', 'pm_ppscf10'); await pg.waitForTimeout(100);
  const t = await pg.$eval('#i-details', e => e.innerText);
  ok(/cannot be printed on the X1 Carbon/.test(t) && /310–350/.test(t), 'PPS-CF10 flagged with its own nozzle range');
  await setv('i-pmat', 'su_pa6cf'); await pg.waitForTimeout(100);
  const tbl = await pg.$eval('#i-details', e => e.textContent);
  ok(/74 \* \/ 203/.test(tbl), 'SUNLU’s assumed HDT is starred in the table');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'printmats_ui: ' + fails.length + ' FAIL' : 'printmats_ui: all pass'); process.exit(fails.length ? 1 : 0); })();
