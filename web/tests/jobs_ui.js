// Whole jobs across tabs, as a fabricator walks them (jobs QA 2026-11-20, docs/JOBS_QA_2026-11-20.md).   node tests/jobs_ui.js
// (from web/). Smoke walks of three jobs, at 1440 px and 400 px:
//   1. cat-back for a 2018-20 Mustang GT: vehicle preset, Quick tab, "Fill in every tab", Mufflers, Sound, Hangers;
//   3. turbo K24A2 at a 450 hp target: Intake tab, "Use these sizes", the glance card and the turbo build sheet;
//   8. save the project, reload, load it, every tab's text the same; inches -> mm -> inches, nothing drifts.
// Plus a regression check for each defect fixed in that round:
//   F1 no console error from the Mufflers chart at a 45 Hz target (a NaN point in the packed-can curve);
//   F2 no "null" on a part card with no material; F3 part and muffler card sizes in both units;
//   F4 "Fill in every tab" carries the head-to-tip length (Mufflers, Sound), the build sheet's resonator neck (Mufflers),
//      the drone frequency (Sound tab's resonator) and the pipe size (Hangers), so the Mufflers tab's can is the sheet's;
//   F5 the resonator's gas volume in both units on the build sheet and its copy; F6 two-digit list numbers not clipped at 400 px;
//   F7 the Intake tab's air speed, airflow and temperatures in both units, and a turbo's inlet tube explained against
//      Garrett's 300 ft/s; F8 the measurement list's "2 x boost" at the build's boost, not the typed field;
//   F9 a motorcycle's build sheet has no bumper, floor or street-car words; F10 the filter rows in both units.
// Checks also: no NaN / undefined / Infinity in the tabs walked, no sideways page scroll, no console errors.
const { chromium } = require('playwright');
const { reads, settle, expandAll, uiClick } = require('./settle');
const TABS = { quick: 'quick', 'four-stroke': 'four', 'two-stroke': 'two', sound: 'sound', intake: 'intake', headers: 'headers', crossover: 'cross',
  mufflers: 'muf', cats: 'cat', 'boom-tubes': 'boom', hangers: 'hang', parts: 'parts', options: 'opt' };
(async () => {
  const t0 = Date.now();
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const errs = [];
  const open = async (ctx, width, hash) => {
    const pg = await ctx.newPage(); reads(pg);
    pg.on('pageerror', e => errs.push(width + ': ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push(width + ' console: ' + m.text()); });
    await pg.goto('file://' + process.cwd() + '/index.html' + (hash ? '#' + hash : '')); await settle(pg);
    return pg;
  };
  const chg = async (pg, id, v) => { await pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, String(v)]); await settle(pg); };
  const pick = async (pg, mode, cls, make, re) => {
    await chg(pg, 'v-mode', mode); await chg(pg, 'v-class', cls);
    if (make) { const mk = await pg.evaluate(m => [...document.getElementById('v-make').options].find(o => new RegExp(m).test(o.value)).value, make); await chg(pg, 'v-make', mk); }
    const v = await pg.evaluate(r => { const o = [...document.getElementById('v-pick').options].find(o => new RegExp(r).test(o.text)); return o ? o.value : null; }, re);
    if (v == null) throw new Error('no preset ' + re); await chg(pg, 'v-pick', v);
  };
  const tab = async (pg, t) => { await pg.evaluate(t => { location.hash = t; }, t); await settle(pg); };
  const text = (pg, t) => pg.evaluate(id => document.getElementById('panel-' + id).innerText, TABS[t]);
  const val = (pg, id) => pg.evaluate(id => document.getElementById(id).value, id);
  const clean = async (pg, t, w) => { const s = await pg.evaluate(id => { const x = document.getElementById('panel-' + id).innerText;
      return { bad: (x.match(/\bNaN\b|\bundefined\b|Infinity|\bnull\b/g) || []).length, h: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }, TABS[t]);
    ok(!s.bad && s.h <= 0, w + ' px, ' + t + ': no NaN / undefined / Infinity / null and no sideways scroll (' + s.bad + ', ' + s.h + ' px)'); };

  for (const W of [1440, 400]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
    // ---------------- job 1: cat-back, 2018-20 Mustang GT
    let pg = await open(ctx, W, 'quick');
    await pick(pg, 'veh', 'car', '^Ford$', '2018–20 Ford Mustang GT');
    await chg(pg, 'q-sys', (180 * 25.4 / 25.4).toString());   // inches shown: 180 in head to tip
    let q = await text(pg, 'quick');
    ok(/Primaries: 1\.62 in \(41\.1 mm\)/.test(q) && /2 pipes of 2\.5 in/.test(q), W + ': job 1 Quick gives 1.62 in primaries and two 2.5 in pipes for 460 hp');
    // F3: muffler cards both units
    ok(/Inlet 2\.5 in \(64 mm\), outlet [\d.]+ in \(\d+ mm\)/.test(q) && /in \(\d+ mm\) overall/.test(q), W + ': F3 muffler cards give inlet, outlet and length in inches and mm');
    // F5: resonator gas volume in both units on the sheet
    ok(/neck \(\d+ cu in \([\d.]+ L\) of gas\)/.test(q), W + ': F5 the build sheet\'s resonator gas volume in cu in and L');
    ok(/build sheet below lengthens the neck/.test(q), W + ': the drone check says why the sheet\'s can differs from its 3 in-neck can');
    if (W === 400) {   // F6: list numbers 10 and 11 inside the page
      const clip = await pg.evaluate(() => { const ol = document.querySelector('#q-details ol.sheet'); if (!ol) return 'none'; const r = ol.getBoundingClientRect(), cs = getComputedStyle(ol);
        return parseFloat(cs.paddingLeft) >= 26 && r.left >= 0 ? 0 : 1; });
      ok(clip === 0, W + ': F6 the sheet\'s list leaves room for two-digit numbers (28 px)');
    }
    await clean(pg, 'quick', W);
    await pg.click('button[data-qapply]'); await settle(pg);
    const sheetNeck = q.match(/× ([\d.]+) in \(\d+ mm\) neck \((\d+) cu in/);
    ok(+await val(pg, 'm-len') === 180 && +await val(pg, 's-len') === 180, W + ': F4 the head-to-tip length goes to the Mufflers and Sound tabs (' + await val(pg, 'm-len') + ', ' + await val(pg, 's-len') + ' in)');
    ok(+await val(pg, 's-hf') === 45 && +await val(pg, 'm-f') === 45, W + ': F4 the 45 Hz cruise tone is the Sound tab\'s resonator target and the Mufflers tab\'s');
    ok(+await val(pg, 'hg-od') === 2.5, W + ': F4 the Hangers tab\'s tube is the 2.5 in pipe (was 3 in)');
    ok(sheetNeck && +await val(pg, 'm-ln') === +sheetNeck[1], W + ': F4 the Mufflers tab takes the sheet\'s ' + (sheetNeck && sheetNeck[1]) + ' in neck');
    await tab(pg, 'mufflers'); const m = await text(pg, 'mufflers');
    ok(sheetNeck && new RegExp('needs about ' + sheetNeck[2] + ' cu in').test(m), W + ': the Mufflers tab\'s can is the build sheet\'s (' + (sheetNeck && sheetNeck[2]) + ' cu in)');
    ok(!/· null/.test(m), W + ': F2 no "null" on the Mufflers tab\'s part cards');
    ok(/That is a [\d.]+ in \([\d.]+ mm\) can/.test(m), W + ': the Mufflers summary gives the can in both units');
    await clean(pg, 'mufflers', W);
    await tab(pg, 'sound'); ok(/Resonator for 45 Hz/.test(await text(pg, 'sound')), W + ': the Sound tab\'s resonator is for the 45 Hz drone'); await clean(pg, 'sound', W);
    await tab(pg, 'hangers'); await clean(pg, 'hangers', W);
    await tab(pg, 'parts'); const pc = await text(pg, 'parts');
    ok(/\d in \(\d+(\.\d)? mm\)/.test(pc), W + ': F3 the Parts tab\'s catalogue sizes in both units');
    // ---------------- job 3: turbo K24A2, 450 hp target
    await tab(pg, 'intake');
    await pick(pg, 'eng', 'car', null, '^K24A2 ');
    await chg(pg, 'i-ind', 'turbo'); await chg(pg, 'i-hp', '450');
    await pg.click('button[data-tsuse]'); await settle(pg);
    const ic = await pg.$('button[data-icuse]:not([disabled])'); if (ic) { await ic.click(); await settle(pg); }
    const it = await text(pg, 'intake');
    const boost = (it.match(/Boost worked out\s*([\d.]+) psi/) || [])[1];
    ok(boost && +boost > 20 && +boost < 35, W + ': job 3 the boost for 450 hp is worked out (' + boost + ' psi)');
    const sheet = await pg.evaluate(() => { const d = window.__tg.doc(), x = document.createElement('div'); x.innerHTML = d.replace(/<svg[\s\S]*?<\/svg>/g, ''); return x.textContent; });
    const p3 = (sheet.match(/page takes 2 × boost, ([\d.]+) psi/) || [])[1];
    ok(p3 && Math.abs(+p3 - 2 * +boost) < 0.06 && /boost [\d.]+ psi \([\d.]+ kPa\) at /.test(sheet), W + ': F8 the measurement list\'s 2 × boost is ' + p3 + ' psi, twice the build\'s ' + boost + ' psi (was twice the typed 8 psi)');
    ok(/Downpipe/.test(sheet) && /Intercooler/.test(sheet), W + ': job 3 the turbo build sheet lists the downpipe and the intercooler');
    ok(/\d+ ft\/s \(\d+ m\/s\)/.test(it) && /cfm<?\/?b?>? \(\d+ L\/s\)|cfm \(\d+ L\/s\)/.test(it) && /°F \(\d+ °C\) instead of/.test(it), W + ': F7 the Intake summary gives airflow, air speed and temperatures in both units');
    if (/above the 180 ft\/s/.test(it)) ok(/turbo sections size by Garrett’s at most 300 ft\/s/.test(it), W + ': F7 a turbo inlet tube over 180 ft/s is explained against Garrett\'s 300 ft/s');
    await clean(pg, 'intake', W);
    // F10: the filter rows in both units (naturally aspirated)
    await chg(pg, 'i-ind', 'na'); const na = await text(pg, 'intake');
    ok(/This filter flows\s*\d+ cfm \(\d+ L\/s\)/.test(na) && /Filter area for this engine\s*\d+ in² \(\d+ cm²\)/.test(na), W + ': F10 the filter rows in cfm and L/s, in² and cm²');
    // F9: a motorcycle's build sheet
    await tab(pg, 'quick'); await pick(pg, 'veh', 'bike', '^Aprilia$', '2021–24 Aprilia RS 660');
    const bq = await text(pg, 'quick');
    ok(!/bumper|floor has room|street car|Street cars in California/.test(bq) && /bike has room/.test(bq), W + ': F9 a motorcycle\'s build sheet has no bumper, floor or street-car words');
    await clean(pg, 'quick', W);
    // F1: the Mufflers chart at a low target
    await tab(pg, 'mufflers'); await chg(pg, 'm-f', '45');
    ok(await pg.evaluate(() => [...document.querySelectorAll('#m-tl polyline')].every(e => !/NaN/.test(e.getAttribute('points')))), W + ': F1 the Mufflers chart at 45 Hz draws no NaN point');
    await pg.close();

    // ---------------- job 8: save, reload, load; units there and back (1440 only: the same code at both widths)
    if (W === 1440) {
      pg = await open(ctx, W, 'quick');
      await pick(pg, 'veh', 'car', '^Ford$', '2018–20 Ford Mustang GT');
      await chg(pg, 'q-sys', '180'); await pg.click('button[data-qapply]'); await settle(pg);
      await tab(pg, 'intake'); await chg(pg, 'i-ind', 'turbo'); await chg(pg, 'i-hp', '650');
      const snap = async () => { const o = {}; for (const t of Object.keys(TABS)) { await tab(pg, t); await expandAll(pg); o[t] = await text(pg, t); } return o; };
      const A = await snap();
      await uiClick(pg, '#proj-btn'); await pg.fill('#proj-name', 'jobs QA'); await pg.click('#proj-save'); await settle(pg); await pg.click('#proj-close');
      await uiClick(pg, '#u-met'); await settle(pg); const M = await snap(); await uiClick(pg, '#u-imp'); await settle(pg); const A2 = await snap();
      const same = (X, Y) => Object.keys(TABS).filter(t => X[t] !== Y[t]);
      ok(!same(A, A2).length, 'job 8: inches -> mm -> inches, every tab reads as before (' + (same(A, A2).join(', ') || 'all 13 the same') + ')');
      ok(/mm/.test(M.quick) && M.quick !== A.quick, 'job 8: the mm view is a different text (the toggle took)');
      await pg.close(); pg = await open(ctx, W, 'quick');
      await uiClick(pg, '#proj-btn'); await settle(pg);
      await pg.click('#proj-list .pj-row[data-i="0"] button[data-pj="load"]'); await settle(pg);
      if (await pg.evaluate(() => document.getElementById('proj-dlg').open)) await pg.click('#proj-close');
      const B = await snap();
      ok(!same(A, B).length, 'job 8: after a reload and a load, every tab reads as saved (' + (same(A, B).join(', ') || 'all 13 the same') + ')');
      await pg.close();
    }
    await ctx.close();
  }
  ok(!errs.length, 'no page errors or console errors' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
  await b.close();
  console.log((fails.length ? 'FAILED ' + fails.length : 'ALL PASS') + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
