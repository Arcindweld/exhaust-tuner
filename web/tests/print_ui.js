// Intake tab, "How it will be made": the printed options render at desktop and phone widths with no NaN/undefined and no page errors;
// the solver matches the notes' worked numbers; red flags fire where the notes say; the Fusion payload carries fab/wall_mm/section_max_mm.
// Usage: node print_ui.js [page.html]   (default exhaust-calculator.printbase.html in the current directory)
const { chromium } = require('playwright');
const PAGE = process.argv[2] || 'exhaust-calculator.printbase.html';
const path = require('path');
(async () => { const b = await chromium.launch(); const fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); console.log((c?'PASS ':'FAIL ')+m); };
  const badText = t => /\bNaN\b|\bundefined\b|\[object|null in/.test(t);
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
  const pg = await b.newPage({ viewport: vp }); const errs=[]; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.resolve(PAGE));
  await pg.evaluate(() => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, d]); return Promise.resolve(JSON.stringify({ ok: true, msg: 'stub', route_ok: true, items: [] })); } }; });
  await pg.waitForTimeout(600);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const det = () => pg.$eval('#i-details', e => e.innerText);
  const hasSec = () => pg.$$eval('#i-details .sec h3', h => h.some(x => /printing it/i.test(x.textContent)));
  const visible = sel => pg.$eval(sel, e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length)).catch(() => false);
  await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(300);
  // default: welded, nothing printed
  let t = await det();
  ok(!(await hasSec()) && await pg.$eval('#i-fab', e => e.value) === 'weld-al' && !(await visible('#i-fab-wrap')), vp.n + ': welded aluminium is the default and shows no printing section');
  // FDM on the X1C, simple mode: the section renders, fine print hidden
  await setv('i-fab', 'fdm'); await pg.waitForTimeout(200);
  t = await det();
  ok(await hasSec() && /PAHT-CF/.test(t) && /256/.test(t) && /Sculpteo|compression limiter/i.test(t) && !badText(t), vp.n + ': FDM section renders for PAHT-CF with no NaN/undefined');
  ok(await visible('#i-fab-wrap') && await pg.$eval('#i-pmat option', o => o.textContent).then(x => /PAHT-CF/.test(x)), vp.n + ': material and location inputs appear, PAHT-CF first');
  const advShown = await pg.$$eval('#i-details .adv', els => els.some(e => e.offsetHeight > 0));
  ok(!advShown && /Round section/.test(t) && /Flat panel/.test(t), vp.n + ': simple mode keeps the wall answer and hides the tables');
  // expert: the material table with every FDM grade, inserts, bellmouth caveat
  await pg.evaluate(() => { document.body.classList.remove('simple'); }); await pg.waitForTimeout(100);
  t = await det();
  const mats = ['PAHT-CF', 'PA6-GF', 'PET-CF', 'PPA-CF', 'PPS-CF', 'Bambu PC', 'Bambu ASA', 'PA6-CF20'];
  ok(mats.every(m => t.indexOf(m) >= 0) && /X1E\/H2 only/.test(t) && /1,372 N/.test(t) && /5\.7 mm/.test(t) && /to be verified against Blair 2006/.test(t) && /2\.13/.test(t) && /V-band/.test(t) && /vapour smoothing|XTC-3D/i.test(t) && !badText(t), vp.n + ': expert shows all 8 FDM materials, the insert table, bellmouth caveat and joints');
  const links = await pg.$$eval('#i-details a[href]', a => a.map(x => x.href));
  ok(links.some(u => /Bambu_PAHT-CF_Technical_Data_Sheet/.test(u)) && links.some(u => /sculpteo\.com/.test(u)) && links.some(u => /motoiq\.com/.test(u)) && links.some(u => /jlc3dp\.com/.test(u)), vp.n + ': datasheet, insert, temperature and price sources are linked');
  // red flags: PPS-CF on the X1C
  await setv('i-pmat', 'ppscf'); await pg.waitForTimeout(150); t = await det();
  ok(/X1E and H2 series only/.test(t) && /300 °C/.test(t) && await pg.$$eval('#i-details .note.bad', n => n.length) >= 1, vp.n + ': PPS-CF on the X1C is flagged (hotend 300 °C)');
  // red flags: hot-side charge pipe in plastic is metal only; in metal it passes
  await setv('i-pmat', 'paht'); await setv('i-ind', 'turbo'); await pg.waitForTimeout(150); await setv('i-ploc', 'cphot'); await pg.waitForTimeout(200); t = await det();
  ok(/metal only/i.test(t) && /201 °C/.test(t) && /not recommended here/.test(t) && !badText(t), vp.n + ': plastic charge pipe before the intercooler is metal only');
  await setv('i-fab', 'metal'); await pg.waitForTimeout(200); t = await det();
  const badN = await pg.$$eval('#i-details .note.bad', n => n.length);
  ok(/AlSi10Mg/.test(t) && badN === 0 && /\$2,500 to \$8,000/.test(t) && /placeholder/.test(t) && !badText(t), vp.n + ': AlSi10Mg hot-side charge pipe passes, with the labelled cost placeholder');
  // boosted plenum at 30 psi in PA6-CF20: wet strength, backfire and boss warnings; flat-panel wall from the solver
  await setv('i-fab', 'fdm'); await pg.waitForTimeout(100); await setv('i-pmat', 'pmpa6cf'); await setv('i-ploc', 'plenum'); await setv('i-boost', '30'); await pg.waitForTimeout(250); t = await det();
  ok(/25\.5 MPa/.test(t) && /Backfire/.test(t) && /bosses crack/i.test(t) && /safety factor to 4/.test(t) && /above the notes’ suggested 20 psi/.test(t) && !badText(t), vp.n + ': 30 psi plenum in PA6-CF20 raises the wet-strength, boss, backfire, SF and boost-limit flags');
  const calc = await pg.evaluate(() => {
    const { PRINT_MATS, printWall, last } = window.__printTest; const m = PRINT_MATS.find(x => x.id === 'pmpa6cf'); const w = printWall(m, { p: 0.2068, D: 120, b: 100, T: 100, sf: 3 });
    const ref = printWall({ proc: 'sls', sz: 20, wet: 1, hdt18: 1e9 }, { p: 0.207, D: 120, b: 100, T: 23, sf: 3 });
    const refV = printWall({ proc: 'sls', sz: 20, wet: 1, hdt18: 1e9 }, { p: 0.09, D: 120, b: 100, T: 23, sf: 3 });
    const refR = printWall({ proc: 'sls', sz: 20, wet: 1, hdt18: 1e9 }, { p: 0.207, D: 120, b: 50, T: 23, sf: 3 });
    return { tPlate: w.tPlate, sAll: w.sAll, tf: w.tf, ref: ref.tPlate, refV: refV.tPlate, refR: refR.tPlate, hoop: ref.tHoop, last: last() };
  });
  ok(Math.abs(calc.ref - 12.3) < 0.15 && Math.abs(calc.refV - 8.1) < 0.15 && Math.abs(calc.refR - 6.2) < 0.15 && calc.hoop < 2, vp.n + ': solver reproduces the notes (20 MPa, SF 3, 30 psi: 100 mm span 12.3 mm, ribbed 50 mm 6.2 mm, vacuum 8.1 mm; hoop under 2 mm) got ' + calc.ref.toFixed(2) + ', ' + calc.refR.toFixed(2) + ', ' + calc.refV.toFixed(2));
  ok(Math.abs(calc.tf - 0.692) < 0.01 && Math.abs(calc.sAll - 5.85) < 0.1 && Math.abs(calc.tPlate - 13.2) < 0.2, vp.n + ': PA6-CF20 at 100 °C: factor ' + calc.tf.toFixed(3) + ', allowable ' + calc.sAll.toFixed(2) + ' MPa, 100 mm panel ' + calc.tPlate.toFixed(1) + ' mm');
  const flatRow = await pg.$$eval('#i-details .r', rows => { const r = rows.find(x => /Flat panel/.test(x.innerText)); return r ? r.innerText : ''; });
  ok(/Flat panel/.test(flatRow) && /0\.5\d in|1[23]\.\d mm/.test(flatRow), vp.n + ': flat panel row shows the solved wall (' + flatRow.replace(/\s+/g, ' ').slice(0, 60) + ')');
  // Fusion payload: fab, wall_mm and section_max_mm ride along; none of it when welded
  await setv('i-ploc', 'cpcold'); await setv('i-boost', '8'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { window.__sent = []; });
  await pg.click('#fx-intake button[data-fx="routeSingle"]'); await pg.waitForTimeout(200);
  let pay = await pg.evaluate(() => window.__sent.map(s => [s[0], JSON.parse(s[1])]).find(s => s[0] === 'route'));
  ok(pay && pay[1].fab === 'fdm' && pay[1].section_max_mm === 256 && pay[1].wall_mm >= 3 && pay[1].wall_mm <= 8 && pay[1].fab_material === 'pmpa6cf' && Math.abs(pay[1].od_mm - (pay[1].id_mm + 2 * pay[1].wall_mm)) < 0.01, vp.n + ': FDM payload carries fab, wall_mm (' + (pay && pay[1].wall_mm) + ') and section_max_mm 256');
  await setv('i-fab', 'sls'); await pg.waitForTimeout(200); t = await det();
  ok(/MJF PA12/.test(t) && /Windform XT 2\.0/.test(t) && /PA 3200 GF/.test(t) && /PA 1101/.test(t) && /\$0\.18/.test(t) && /£0\.20/.test(t) && /Powder-bed skin/.test(t) && !badText(t), vp.n + ': SLS/MJF section lists the four powders, prices and the porosity note');
  await pg.evaluate(() => { window.__sent = []; }); await pg.click('#fx-intake button[data-fx="routeSingle"]'); await pg.waitForTimeout(200);
  pay = await pg.evaluate(() => window.__sent.map(s => [s[0], JSON.parse(s[1])]).find(s => s[0] === 'route'));
  ok(pay && pay[1].fab === 'sls' && pay[1].section_max_mm === 284 && pay[1].wall_mm >= 2.5, vp.n + ': SLS payload fab=sls, section_max_mm 284');
  await setv('i-fab', 'weld-al'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { window.__sent = []; }); await pg.click('#fx-intake button[data-fx="routeSingle"]'); await pg.waitForTimeout(200);
  pay = await pg.evaluate(() => window.__sent.map(s => [s[0], JSON.parse(s[1])]).find(s => s[0] === 'route'));
  t = await det();
  ok(pay && !('fab' in pay[1]) && !('section_max_mm' in pay[1]) && !(await hasSec()) && !(await visible('#i-fab-wrap')), vp.n + ': back to welded: no fab field, no section');
  // NA tube in ASA: vacuum case, heat and fuel cautions; charge pipe "Building it" mentions the printed route
  await setv('i-ind', 'na'); await setv('i-fab', 'fdm'); await pg.waitForTimeout(100); await setv('i-pmat', 'asa'); await setv('i-ploc', 'tubehot'); await pg.waitForTimeout(200); t = await det();
  ok(/vacuum, 13 psi/.test(t) && /above (the suggested continuous limit|this material’s 1\.8 MPa heat deflection)/.test(t) && /fuel and PCV vapour/.test(t) && !badText(t), vp.n + ': ASA tube by the exhaust: vacuum case, over its limit, fuel caution');
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(200); t = await det();
  ok(/Printed instead of welded/.test(t) && /hot side stays metal/.test(t), vp.n + ': charge pipe Building it list carries the printed note');
  const method = await pg.evaluate(() => document.body.textContent);   // the Method panel is hidden, so textContent
  ok(/Making the intake by 3D printing/.test(method) && /Data Driven Performance/.test(method) && /one product/.test(method) && /235 °C at 1\.8 MPa where Polymaker/.test(method), vp.n + ': Method note on printing and DDP with the datasheet conflicts');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), vp.n + ': no sideways scroll');
  ok(errs.length===0, vp.n + ': no page errors '+errs.join('|')); await pg.close(); }
  console.log(fails.length?'FAILED: '+fails.length:'all passed'); await b.close(); process.exit(fails.length?1:0); })();
