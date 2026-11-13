// Oil cooling and turbo oil lines (Intake tab, boosted builds, 2026-11-12).
//   node tests/oilcool_ui.js   (from web/)
//
// Sources (rows and rules as read 2026-11-12):
//   Setrab, "Application and performance suggestions" (2010), https://www.pegasusautoracing.com/pdfs/SetrabApplicationSuggestions.pdf
//     engine-oil coolers with a horsepower range and BTU/hr (wet sump low / dry sump high); 1 BTU/hr = 0.29307107 W.
//   Engineering ToolBox, engine oil density and specific heat: 340 K 860 kg/m³ 2.08 kJ/kg K; 360 K 848, 2.16; 380 K 836, 2.25; 400 K 824, 2.34.
//   Conflux Technology, "Oil Coolers" brochure v1.0 (2026), supplied by the owner (not in the repository), PDF pages 4-6:
//     100220 Ø66.3 x 203 mm, 0.31 kg, JIC -08, coolant Ø19.05 mm; oil Mobil EV Cool Drive in at 85 °C, EGW 25/75 in at 50 °C, 20 L/min
//       (0.34 kg/s); drop at 85 °C, 8 cSt. Tabulated (read from the charts): 8..40 L/min, Q 5.4 6.0 7.0 7.8 8.4 8.8 9.2 9.6 kW,
//       dp 5.2 7.8 14.8 22.7 31.6 41.6 52.5 64.3 kPa.
//     100219 Ø83.6 x 218 mm, 0.58 kg, JIC -08, coolant Ø38.10 mm; 75W-90 in at 120 °C, coolant 80 °C, 120 L/min (2 kg/s); 100 °C, 15 cSt.
//     100218 Ø126.6 x 315 mm, 1.6 kg, JIC -12, coolant Ø38.10 mm; 0W-40 in at 120 °C, coolant 85 °C, 120 L/min (2 kg/s); 100 °C, 14 cSt.
//   Precision Turbo & Engine installation recommendations: single ball bearing -4AN (1/4 in) feed; drain minimum -10AN (5/8 in).
//   Garrett (oil restrictors & oil supply; turbo system optimization): ball bearing -3AN or -4AN, 0.040 in restrictor, 40-45 psi at
//     maximum engine speed; journal -4AN (~0.25 in); drain -10AN typically sufficient, ±15° of gravity; water lines hooked up.
//   Titan Fittings thread chart: -4 7/16-20, -10 7/8-14, -8 3/4-16, -12 1 1/16-12.
//
// Hand arithmetic:
//  Heat load, 450 hp: Setrab rows whose range contains 450: 50-634 (400-475) 43,000; 50-640 (450-550) 45,000; 50-925 (400-475) 42,000;
//    50-934 (450-550) 53,100; FP634M22I (400-475) 43,000 BTU/hr wet -> 42,000 to 53,100 BTU/hr = 12,308.99 to 15,562.07 W; dry up to
//    72,100 BTU/hr = 21,130.43 W. 600 hp: the "600+" rows 50-172 40,000, 50-650 56,000, 50-660 63,000, 50-948 69,000, 172M22I D 44,000,
//    640M22I D 49,000, COM500-15 51,000, FP948M22I 65,000 -> 11,722.84 to 20,221.90 W.
//  Oil temperature drop, 40 L/min at 120 °C (393.15 K, 0.6575 of the way 380 -> 400 K): rho 836 - 12 x 0.6575 = 828.11 kg/m³,
//    cp 2250 + 90 x 0.6575 = 2309.175 J/kg K; dT = 15,562.07 / (40/60000 x 828.11 x 2309.175) = 12.207 °C.
//  Units in parallel at 40 L/min, oil in 120 °C, coolant in 85 °C (the defaults):
//    100220: temperature factor (120-85)/(85-50) = 1; one unit at 40 L/min 9.6 kW < 15.56; two at 20 L/min 2 x 7.8 = 15.6 kW >= 15.56
//      -> 2, drop 22.7 kPa each.
//    100219: factor 35/40 = 0.875; one unit at 40 L/min is above its plotted 35; two at 20: 2 x 17.2 x 0.875 = 30.1 kW -> 2, 28.6 kPa.
//    100218: 40 L/min (or less per unit) is below its plotted 50 L/min -> no prediction.
//  Effectiveness check, 100220 at 8 L/min (85 °C, 358.15 K, 0.9075 of 340 -> 360 K): rho 849.11, cp 2152.6; C_oil = 8/60000 x 849.11
//    x 2152.6 = 243.71 W/K < C_coolant 0.34 x 3917 = 1331.78; eps = 5400 / (243.71 x 35) = 0.633.
//  Oil pressure after two 100220 at 350 kPa engine oil pressure: 350 - 22.7 = 327.3 kPa (47.5 psi) >= Garrett's 40 psi (275.8 kPa).
//  Coupling into the charge-cooler loop: Q = (Th - Ta - k Qoil) / (1/e1 + k), k = 1/e2 - 1/Cw, e_i = eps_i x Cmin_i (exact cross-flow
//    series written here), with the loop's UA1, UA2, Ch, Cw, Ca, Th, Ta read from the page; charge out = Th - Q/Ch.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, w, tol, m) => ok(Number.isFinite(a) && Math.abs(a - w) <= tol, m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(8) : a) + ', hand ' + +w.toPrecision(8));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const set = (id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const setx = async (k, v) => { await pg.evaluate(([k, v]) => { const e = document.querySelector('.tsox[data-k="' + k + '"]'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]); await pg.waitForTimeout(350); };
  const sec = () => pg.evaluate(() => { const s = [...document.querySelectorAll('.sec')].find(s => s.dataset.sec === 'oil-cooling-and-turbo-oil-lines'); return s ? s.innerText : ''; });
  const W = 0.29307107;
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
  await set('i-ind', 'turbo'); await set('i-boost', '29.541'); await set('i-hp', '450'); await pg.waitForTimeout(500);
  const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await setx('turbo', String(ti));

  // rows and their sources
  const lib = await pg.evaluate(() => window.__tso.OIL_LIB.map(c => ({ pn: c.pn, dia: c.dia, len: c.len, kg: c.kg, jic: c.jic, cool: c.coolConn, r: c.rated, K: c.curve, src: c.srcName })));
  ok(lib.length === 3 && lib[0].pn === '100220' && lib[0].dia === 66.3 && lib[0].len === 203 && lib[0].kg === 0.31 && lib[0].jic === 8 && /19\.05/.test(lib[0].cool) &&
    lib[0].r.oil === 'Mobil EV Cool Drive' && lib[0].r.toi === 85 && lib[0].r.tci === 50 && lib[0].r.lpm === 20 && lib[0].r.kgs === 0.34 && lib[0].r.nu === 8 && /Oil Coolers/.test(lib[0].src), 'Conflux 100220: brochure page 4 specifications and boundary conditions');
  ok(lib[1].pn === '100219' && lib[1].dia === 83.6 && lib[1].kg === 0.58 && lib[1].r.oil === '75W-90' && lib[1].r.toi === 120 && lib[1].r.tci === 80 && lib[1].r.lpm === 120 && lib[1].r.nu === 15 &&
    lib[2].pn === '100218' && lib[2].dia === 126.6 && lib[2].len === 315 && lib[2].kg === 1.6 && lib[2].jic === 12 && lib[2].r.oil === '0W-40' && lib[2].r.tci === 85 && lib[2].r.nu === 14, 'Conflux 100219 and 100218: pages 5 and 6');
  ok(lib[0].K.Q.join() === '5.4,6,7,7.8,8.4,8.8,9.2,9.6' && lib[0].K.dp.join() === '5.2,7.8,14.8,22.7,31.6,41.6,52.5,64.3', '100220 curves as tabulated from the charts');
  const st = await pg.evaluate(() => window.__tso.SETRAB_EOC.length);
  ok(st === 28, 'Setrab engine-oil cooler rows with a horsepower range: 28');

  // heat load
  let L = await pg.evaluate(() => window.__tso.setrabLoad(450));
  near(L.lo, 42000 * W, 1e-6, '450 hp: Setrab wet-sump low (W)'); near(L.hi, 53100 * W, 1e-6, '450 hp: Setrab wet-sump high (W)'); near(L.dryHi, 72100 * W, 1e-6, '450 hp: dry-sump high (W)');
  ok(L.rows.map(r => r[0]).join() === '50-634-7612,50-640-7612,50-925-7612,50-934-7612,FP634M22I', '450 hp: the five Setrab rows whose range contains it');
  L = await pg.evaluate(() => window.__tso.setrabLoad(600));
  near(L.lo, 40000 * W, 1e-6, '600 hp: low (the "600+" rows)'); near(L.hi, 69000 * W, 1e-6, '600 hp: high'); ok(L.rows.length === 8, '600 hp: eight "600+" rows');

  // the section, with oil flow 40 L/min and the 100220 picked
  await setx('olF', '40'); await setx('olRow', '0');
  const O = await pg.evaluate(() => { const o = window.__tso.TG().oil; return { dT: o.dT, Qn: o.Qn, pick: o.pick, rows: o.rows.map(r => r.S && r.S.ok ? [r.c.pn, r.S.ok.n, r.S.ok.Qtot, r.S.ok.dp] : [r.c.pn, null]) }; });
  near(O.dT, 53100 * W / (40 / 60000 * 828.11 * 2309.175), 1e-6, 'oil temperature drop across the cooler at 40 L/min, 120 °C (°C)');
  ok(O.rows[0][1] === 2 && Math.abs(O.rows[0][2] - 15600) < 1e-6 && Math.abs(O.rows[0][3] - 22700) < 1e-6, '100220: 2 in parallel, 15.6 kW, 22.7 kPa each');
  ok(O.rows[1][1] === 2 && Math.abs(O.rows[1][2] - 2 * 17200 * 0.875) < 1e-6 && Math.abs(O.rows[1][3] - 28600) < 1e-6, '100219: 2 in parallel at 20 L/min, 2 x 17.2 x 0.875 = 30.1 kW, 28.6 kPa');
  ok(O.rows[2][1] === null && /below its plotted 13\.2 gpm \(50\.0 L\/min\)|below its plotted 50\.0 L\/min/.test(await sec()), '100218: below its plotted 50 L/min, no prediction (no extrapolation)');
  near(await pg.evaluate(() => window.__tso.oilEps(window.__tso.OIL_LIB[0], 0)), 5400 / (8 / 60000 * 849.11 * 2152.6 * 35), 1e-4, '100220 effectiveness at 8 L/min, the maker’s conditions');
  // a different coolant temperature: 95 °C in, factor (120-95)/35
  await setx('olTc', '95');
  near(await pg.evaluate(() => window.__tso.oilUnit(window.__tso.OIL_LIB[0], 20, 120, 95).Q), 7800 * 25 / 35, 1e-6, '100220 at 20 L/min with coolant at 95 °C: 7.8 kW x 25/35');
  await setx('olTc', '');
  // oil pressure after the cooler
  await setx('olP', '350');
  ok(/Oil pressure after the cooler[\s\S]*47\.47 psi \(327\.3 kPa\)|327\.3 kPa \(47\.47 psi\)/.test(await sec()) && /met/.test(await sec()), 'oil pressure after the cooler: 350 - 22.7 = 327.3 kPa, at least Garrett’s 40 psi');
  // the chart and its point
  const ch = await pg.evaluate(() => { const s = document.getElementById('oil-svg'); if (!s) return null; return { q: +s.querySelector('circle[data-op="q"]').getAttribute('cy'), d: +s.querySelector('circle[data-op="dp"]').getAttribute('cy'), x: +s.querySelector('circle[data-op="q"]').getAttribute('cx'), t: s.textContent }; });
  { const H = 216, mt = 26, mb = 42, Wd = 360, ml = 58, mr = 58, x1 = 50, qTop = 10, dTop = 80;
    ok(ch && Math.abs(ch.x - (ml + 20 / x1 * (Wd - ml - mr))) < 0.06 && Math.abs(ch.q - (H - mb - 7.8 / qTop * (H - mt - mb))) < 0.06 && Math.abs(ch.d - (H - mb - 22.7 / dTop * (H - mt - mb))) < 0.06, 'chart: the per-unit point at 20 L/min, 7.8 kW, 22.7 kPa');
    ok(/kW \(BTU\/min\)/.test(ch.t) && /kPa \(psi\)/.test(ch.t) && /L\/min \(gpm\)/.test(ch.t), 'chart axes in kW and BTU/min, kPa and psi, L/min and gpm'); }

  // turbo lines for the PT5862 (ball bearing per the dealer, Precision's own rules)
  let S = await sec();
  ok(/Oil feed[\s\S]*-4 AN \(0\.250 in \(6\.35 mm\) nominal, 7\/16-20 thread\)/.test(S) && /Oil drain[\s\S]*-10 AN \(0\.625 in \(15\.88 mm\) nominal, 7\/8-14 thread\) minimum/.test(S) && /The turbo’s maker’s own rules/.test(S) && /may be restricted but may not always be necessary/.test(S), 'PT5862: Precision’s -4AN feed, -10AN drain, restrictor rule, sizes in in and mm with threads');
  const svg = await pg.$eval('#ts-svg', e => e.textContent);
  ok(/oil feed -4 AN, drain -10 AN min\., gravity/.test(svg), 'route drawing: the oil feed and drain labelled at the compressor');
  // a BorgWarner turbo: no BorgWarner rules read -> Garrett's, both bearing types
  const bw = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => /EFR 6758/.test(t.model))); await setx('turbo', String(bw));
  S = await sec(); ok(/No oil-line rules from BorgWarner were read: Garrett’s, as the general reference/.test(S) && /0\.040” orifice/.test(S), 'BorgWarner: Garrett’s rules as the general reference, said');
  await setx('turbo', String(ti));

  // coupling into the charge-cooler loop: Conflux 100012 barrel, front exchanger UA 1500 W/K, 120 lb/min air
  await setx('ictype', 'w2a'); const i12 = await pg.evaluate(() => window.__tso.IC_LIB.findIndex(c => c.pn === '100012')); await setx('ic', String(i12));
  await setx('ua2', '1500'); await setx('fa', '120'); await setx('olLoop', 'ic');
  const LP = await pg.evaluate(() => { const t = window.__tso.TG(); return { L: t.loop, O: t.oil.loop, Qn: t.oil.Qn }; });
  { const eps = (n, cr) => { const a = n, bb = cr * n; let s = 0, ta = Math.exp(-a), tb = Math.exp(-bb), ca = ta, cb = tb; for (let k = 0; k < 400; k++) { if (k > 0) { ta *= a / k; tb *= bb / k; ca += ta; cb += tb; } s += (1 - Math.min(1, ca)) * (1 - Math.min(1, cb)); } return s / bb; };
    const L0 = LP.L, c1 = Math.min(L0.Ch, L0.Cw), c2 = Math.min(L0.Ca, L0.Cw), e1 = eps(L0.UA1 / c1, c1 / Math.max(L0.Ch, L0.Cw)) * c1, e2 = eps(L0.UA2 / c2, c2 / Math.max(L0.Ca, L0.Cw)) * c2, k = 1 / e2 - 1 / L0.Cw;
    const Q0 = (L0.th - L0.ta) / (1 / e1 + k), Q1 = (L0.th - L0.ta - k * LP.Qn) / (1 / e1 + k);
    ok(LP.O && Math.abs(LP.O.with.Q - Q1) < 1e-3 && Math.abs(LP.O.without.Q - Q0) < 1e-3 && Q1 < Q0, 'oil on the charge-cooler loop: charge cooler heat ' + (Q0 / 1000).toFixed(3) + ' -> ' + (Q1 / 1000).toFixed(3) + ' kW, charge out ' + (L0.th - Q0 / L0.Ch).toFixed(2) + ' -> ' + (L0.th - Q1 / L0.Ch).toFixed(2) + ' °C (hand)');
    ok(/On the charge cooler’s loop/.test(await sec()), 'the coupled result is shown'); }
  await setx('olLoop', 'engine');
  ok(/On the engine coolant loop[\s\S]*more for the radiator/.test(await sec()), 'default: the engine coolant loop, the added radiator load stated');

  // oil-to-air: Setrab's rows for this power
  await setx('olType', 'air'); S = await sec();
  ok(/Oil-to-air coolers Setrab suggests for this power/.test(S) && /50-934-7612/.test(S) && await pg.$$eval('#oil-air-tab tbody tr', r => r.length) === 5, 'oil-to-air: the five Setrab rows for 450 hp');
  await setx('olType', 'l2l');

  // checklist and build sheet
  const step = await pg.$eval('#tg-steps li[data-step="oil"]', e => e.innerText).catch(() => '');
  ok(/Oil cooling and turbo oil lines/.test(step) && /Conflux Technology 100220 × 2/.test(step) && /feed -4 AN, drain -10 AN minimum/.test(step), 'checklist step: ' + step.replace(/\n/g, ' '));
  await pg.click('button[data-tsheet]'); await pg.waitForTimeout(600);
  const sh = await pg.evaluate(() => { const f = window.__tgSheet; if (!f) return null; const d = new DOMParser().parseFromString(f.text, 'application/xml');
    return [...d.getElementsByTagName('tr')].map(tr => [...tr.getElementsByTagName('td')].map(td => td.textContent)).filter(r => r.length); });
  const row = n => sh && sh.find(r => r[0] === n);
  ok(row('Oil heat load') && /12\.3 kW|12\.31 kW|BTU/.test(row('Oil heat load')[1]) && row('Oil cooler') && /100220 × 2/.test(row('Oil cooler')[1]) && /mm/.test(row('Oil cooler')[1]) && /in/.test(row('Oil cooler')[1]) &&
    row('Turbo oil feed') && /-4 AN/.test(row('Turbo oil feed')[1]) && row('Turbo oil drain') && /-10 AN/.test(row('Turbo oil drain')[1]) && row('Turbo water lines'), 'build sheet: oil heat, cooler, feed, drain, water lines: ' + ['Oil cooler', 'Turbo oil feed', 'Turbo oil drain'].map(n => (row(n) || []).join(' | ')).join(' || '));

  // units, layout, errors
  S = await sec();
  ok(!/\bNaN\b|undefined|Infinity/.test(S), 'oil section renders cleanly');
  ok(/BTU\/min/.test(S) && /kW/.test(S) && /gpm/.test(S) && /L\/min/.test(S) && /psi/.test(S) && /kPa/.test(S) && /°F/.test(S) && /°C/.test(S) && /mm\)/.test(S), 'dual units: kW/BTU/min, L/min/gpm, kPa/psi, °C/°F, mm/in');
  await pg.setViewportSize({ width: 400, height: 900 }); await pg.waitForTimeout(400);
  const w = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(w[0] <= w[1] + 1, '400 px: no horizontal scroll (' + w.join(' / ') + ')');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'oilcool_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
