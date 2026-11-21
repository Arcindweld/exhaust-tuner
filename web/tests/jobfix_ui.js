// Job fixes 2026-11-21 (docs/JOB_FIXES_2026-11-21.md): the reviewed proposals from the jobs QA round, one regression check
// each.   node tests/jobfix_ui.js   (from web/)
//   P1 a car is offered no motorcycle-sheet muffler (Quick, its build sheet, the Mufflers tab) and a bike no car part; a
//      part whose entry does not say is kept after the ones that do; a part is called a fit only when its inlet is the pipe's;
//   P4 the Headers tab's Smith's-rule row uses the 4-Stroke tab's bore, stroke and valves when it is the same engine, and
//      says "estimated" when it is not;
//   RPM the same engine tuned for different RPM on Headers and 4-Stroke: a note on each, and its button copies the RPM;
//   P5 a turbo on the Intake tab and "naturally aspirated" on the Sound tab: a note with "Set to turbocharged"; nothing is
//      changed on its own; "Fill in every tab" carries the Intake tab's turbo;
//   P6 a bike's build sheet: the main pipe a stock tube with the exact figure beside it, and the J-pipe as its resonator;
//   P7 the 2-Stroke tab's header field carries Jennings's area rule as a hint (the default unchanged);
//   P3 Quick's "What are you building?": cat-back and axle-back leave out the stock parts, say what is kept; the choice
//      saves in the project under its own key, and a project without the key loads as the full system;
//   8  the result rows the jobs QA listed as one-unit (temperatures, the Cats and Boom tubes tabs, the plain chamber, and
//      the rest) in both unit systems.
// Checks also: no NaN / undefined / Infinity, no sideways page scroll at 400 px, no console errors.
const { chromium } = require('playwright');
const { reads, settle } = require('./settle');
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
  const quick = pg => pg.evaluate(() => { const Q = window.__quick, p = Q.quickParams(), r = Q.calcQuick(p), sh = Q.quickSheet(p, r);
    return { parts: r.parts.map(x => ({ name: x.q.brand + ' ' + x.q.model + ' ' + x.q.pn, type: x.q.type, src: x.q.srcName || '', words: (x.q.model || '') + ' ' + (x.q.says || ''), inD: x.q.inD })),
      fit: r.partsFit, size: r.partsSize, main: r.main, sh: sh && { rows: sh.rows.map(o => o.name + ': ' + o.size + ' | ' + (o.note || '')), buy: sh.buy.map(x => x.join(' | ')), steps: sh.steps, alts: sh.alts, kept: sh.kept, scope: sh.scope } }; });
  const isMoto = q => q.type === 'moto' || /motorcycle|\bbikes?\b|motorbike/i.test(q.src + ' ' + q.words);
  const clean = async (pg, t, w) => { const s = await pg.evaluate(id => { const x = document.getElementById('panel-' + id).innerText;
      return { bad: (x.match(/\bNaN\b|\bundefined\b|Infinity|\bnull\b/g) || []).length, h: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }, TABS[t]);
    ok(!s.bad && s.h <= 0, w + ' px, ' + t + ': no NaN / undefined / Infinity / null and no sideways scroll (' + s.bad + ', ' + s.h + ' px)'); };

  for (const W of [1440, 400]) {
    const ctx = await b.newContext({ viewport: { width: W, height: 900 } });
    // ---------------- P1, P3: the Mustang GT
    let pg = await open(ctx, W, 'quick');
    await pick(pg, 'veh', 'car', '^Ford$', '2018–20 Ford Mustang GT'); await chg(pg, 'q-sys', '180');
    let Q = await quick(pg);
    ok(Q.parts.length === 3 && !Q.parts.some(isMoto) && /^Flowmaster 40 Series \(Original\) 42543/.test(Q.parts[0].name), W + ': P1 the Mustang GT\'s first three mufflers are car parts, the Flowmaster 40 first (' + Q.parts.map(x => x.name).join(' · ') + ')');
    ok(Q.fit && Q.parts.every(x => Math.abs(x.inD - 2.5) < 0.01), W + ': P1 each has the 2.5 in inlet of the 2.5 in pipe');
    ok(Q.sh.rows.some(r => /^Mufflers, each side: Flowmaster 40 Series \(Original\)/.test(r)) && !Q.sh.rows.some(r => /Cone Engineering/.test(r)), W + ': P1 the build sheet\'s muffler is the Flowmaster, not the Cone Engineering motorcycle can');
    let q = await text(pg, 'quick');
    ok(/Mufflers that fit a 2\.5 in \(64 mm\) pipe/.test(q), W + ': P1 the parts heading gives the pipe in both units');
    // P3: full / cat-back / axle-back
    ok(await val(pg, 'q-scope') === 'full' && Q.sh.scope === 'full' && !Q.sh.kept && Q.sh.rows.some(r => /^Primary/.test(r)), W + ': P3 the default is the full system, with the headers on the sheet');
    await chg(pg, 'q-scope', 'cat'); Q = await quick(pg); q = await text(pg, 'quick');
    ok(!Q.sh.rows.some(r => /^(Primary|Collector|Reducer cone|Megaphone|Catalytic)/.test(r)) && !Q.sh.buy.some(x => /^(Head flanges|Primary tube|Merge collectors|Catalytic converters|Oxygen sensor bungs|V-band)/.test(x)) &&
      Q.sh.rows.some(r => /^Mufflers/.test(r)) && Q.sh.rows.some(r => /^Helmholtz resonator/.test(r)) && Q.sh.buy.some(x => /^Clamps or flanges/.test(x)),
      W + ': P3 cat-back: no header, collector or converter rows or list items; the pipe, resonator and mufflers stay');
    ok(/Cat-back: kept from stock are the exhaust manifolds or headers, the front pipes and the catalytic converters/.test(q) && /What you build: a cat-back/.test(q) && !Q.sh.steps.some(t => /flanges to the head|primaries|collector outlet/.test(t)),
      W + ': P3 cat-back says what is kept from stock, and the build order has no header steps');
    await chg(pg, 'q-scope', 'axle'); Q = await quick(pg);
    ok(Q.sh.rows.length === 2 && /^Mufflers/.test(Q.sh.rows[0]) && /^Tailpipes/.test(Q.sh.rows[1]) && Q.sh.buy.some(x => /^Tailpipe tube/.test(x)) && !Q.sh.buy.some(x => /^(Main pipe tube|Resonator)/.test(x)) && /Axle-back: kept from stock is everything ahead of the rear axle/.test(Q.sh.kept),
      W + ': P3 axle-back: only the mufflers and tailpipes, and what is kept from stock');
    await clean(pg, 'quick', W);
    await chg(pg, 'q-scope', 'full');
    // P1 on the Mufflers tab (the Sound tab's engine is the car's)
    await tab(pg, 'mufflers'); await chg(pg, 'm-size', '2.5');
    const mcards = await pg.$$eval('#panel-muf .pcard', cs => cs.map(c => c.innerText));
    ok(mcards.length > 3 && !mcards.some(c => /Motorcycle Pre-Fabricated|Motorcycle silencer/.test(c)), W + ': P1 the Mufflers tab offers a car no motorcycle part (' + mcards.length + ' cards)');
    ok(/motorcycle parts are left out/.test(await text(pg, 'mufflers')), W + ': P1 the Mufflers tab says why');
    // ---------------- P1, P6: the RS 660
    await tab(pg, 'quick'); await pick(pg, 'veh', 'bike', '^Aprilia$', '2021–24 Aprilia RS 660'); await chg(pg, 'q-sys', '');
    Q = await quick(pg); q = await text(pg, 'quick');
    ok(Q.parts.length === 3 && Q.parts.every(isMoto), W + ': P1 the RS 660\'s first three silencers are motorcycle parts (' + Q.parts.map(x => x.name).join(' · ') + ')');
    ok(Q.main.stock && Q.main.pick === 2 && Math.abs(Q.main.exactOd / 25.4 - 2.021) < 0.002 && Q.fit, W + ': P6 the bike\'s main pipe is the 2 in stock tube (exact 2.021 in) and the 2 in silencers fit it');
    ok(Q.sh.rows.some(r => /^Main pipe: 1\.87 in \(47\.5 mm\) ID, 2 in \(50\.8 mm\) OD/.test(r)) && !Q.sh.rows.concat(Q.sh.buy).some(r => /2\.021/.test(r)) &&
      /one 2 in tube \(2 in \(50\.8 mm\) OD, 1\.87 in \(47\.5 mm\) inside\) from the collector to the silencer: the stock size nearest the 2\.021 in \(51\.3 mm\) OD/.test(q),
      W + ': P6 the sheet uses the stock tube; the build text gives the exact 2.021 in figure beside it');
    ok(Q.sh.rows.some(r => /^J-pipe \(quarter-wave side branch\): closed 1\.87 in \(47\.5 mm\) ID tube, [\d.]+ in \(\d+ mm\) long, on a tee/.test(r) && /will not fit on most bikes/.test(r)) && !Q.sh.rows.some(r => /^Helmholtz/.test(r)) &&
      Q.sh.alts.some(t => /A Helmholtz can instead of the J-pipe: .* cu in \([\d.]+ L\) of gas.*Few motorcycles have room/.test(t)) && /Silencers that fit a 2 in \(51 mm\) pipe/.test(q),
      W + ': P6 the bike\'s sheet uses the J-pipe and keeps the can as the alternative, saying why');
    await clean(pg, 'quick', W);
    await pg.close();

    // ---------------- P4, RPM: K24A2 on Headers and 4-Stroke
    pg = await open(ctx, W, 'headers'); await pick(pg, 'eng', 'car', null, '^K24A2 ');
    const smith = t => (t.match(/Smith’s 1950s open-pipe rule( \(estimated\))?\s*([\d.]+ in \(\d+ mm\))/) || []);
    let h = smith(await text(pg, 'headers')); await tab(pg, 'four-stroke'); const f = smith(await text(pg, 'four-stroke'));
    ok(h[2] && h[2] === f[2] && !h[1] && h[2] === '37.6 in (954 mm)', W + ': P4 the same K24A2 gives the same Smith figure on both tabs (' + h[2] + ', ' + f[2] + '; was 44.1 in on Headers)');
    await tab(pg, 'headers'); await chg(pg, 'h-rpm', '8000');
    let ht = await text(pg, 'headers'); await tab(pg, 'four-stroke'); let ft = await text(pg, 'four-stroke');
    ok(/The 4-Stroke tab is tuned for 6,800 RPM; this tab for 8,000, so the primary lengths differ\./.test(ht) && /The Headers tab is tuned for 8,000 RPM; this tab for 6,800, so the primary lengths differ\./.test(ft), W + ': RPM a note on each tab when the same engine is tuned for different RPM');
    await pg.click('#panel-four .fixit button'); await settle(pg);
    ft = await text(pg, 'four-stroke');
    ok(+await val(pg, 'f-rpm') === 8000 && !/so the primary lengths differ/.test(ft), W + ': RPM the 4-Stroke tab\'s button copies the Headers tab\'s 8,000 RPM, and the note goes');
    await tab(pg, 'headers'); ok(!/so the primary lengths differ/.test(await text(pg, 'headers')), W + ': RPM and the Headers tab\'s note goes too');
    await chg(pg, 'h-disp', '1000'); h = smith(await text(pg, 'headers'));
    ok(h[1] && /a two-valve head is assumed/.test(await text(pg, 'headers')) && !/so the primary lengths differ/.test(await text(pg, 'headers')), W + ': P4 another engine on Headers: the row says it is estimated and why; no RPM note');
    await clean(pg, 'headers', W);
    // ---------------- P5: Intake turbo, Sound tab
    await tab(pg, 'intake'); await chg(pg, 'i-ind', 'turbo'); await tab(pg, 'sound');
    let st = await text(pg, 'sound');
    ok(await val(pg, 's-ind') === 'na' && /The Intake tab is turbocharged; the induction here says naturally aspirated/.test(st) && /Set to turbocharged/.test(st), W + ': P5 the Sound tab notes the Intake tab\'s turbo, with a button, and changes nothing on its own');
    await pg.click('#panel-sound .fixit button'); await settle(pg);
    ok(await val(pg, 's-ind') === 'turbo1' && !/The Intake tab is turbocharged/.test(await text(pg, 'sound')), W + ': P5 "Set to turbocharged" sets the single turbo, and the note goes');
    // set by hand back to naturally aspirated (a real key press, not the page): no note again in this session
    await pg.focus('#s-ind'); await pg.keyboard.press('Home'); await settle(pg);
    if (await val(pg, 's-ind') === 'na') ok(!/The Intake tab is turbocharged/.test(await text(pg, 'sound')), W + ': P5 set back by hand: the note stays away');
    await clean(pg, 'sound', W);
    // Fill in every tab carries the Intake tab's turbo (Quick says neither)
    await pg.reload(); await settle(pg);
    await tab(pg, 'intake'); await chg(pg, 'i-ind', 'turbo'); await tab(pg, 'quick'); await chg(pg, 'q-ind', 'na'); await chg(pg, 's-ind', 'na');
    await pg.click('button[data-qapply]'); await settle(pg);
    ok(await val(pg, 's-ind') === 'turbo1' && /the Sound tab’s induction follows the Intake tab: turbocharged/.test(await pg.evaluate(() => document.getElementById('q-applied').textContent)), W + ': P5 "Fill in every tab" carries the Intake tab\'s turbo to the Sound tab and says so');
    await pg.close();

    // ---------------- P7: the 2-Stroke tab's header hint
    pg = await open(ctx, W, 'two-stroke');
    const hint = () => pg.evaluate(() => { const e = document.getElementById('t-dh-jen'); return e && !e.hidden && e.getClientRects().length ? e.textContent : ''; });
    ok(/Jennings’s Two-Stroke Tuner’s Handbook .* 10 to 15% larger in area than the exhaust port window/.test(await hint()) && Math.abs(await pg.evaluate(() => document.getElementById('t-dh')._b) - 41.275) < 1e-9,
      W + ': P7 the header field carries Jennings\'s 10 to 15% area rule; the default stays 1.625 in (41.275 mm)');
    await chg(pg, 't-shape', 'blair'); ok(!await hint(), W + ': P7 not on Blair\'s design, where the field is the port\'s own diameter');
    await chg(pg, 't-shape', 'jen'); await clean(pg, 'two-stroke', W);
    // ---------------- 8: both units in the rows the jobs QA listed
    const row = (t, lab) => (t.match(new RegExp(lab + '[^\\n]*\\n?[^\\n]*')) || [''])[0];
    ok(/Wave speed at \d+ °F \(\d+ °C\)/.test(await text(pg, 'two-stroke')), W + ': 8 temperatures in both units (the 2-Stroke tab\'s wave speed)');
    await tab(pg, 'cats'); let c = await text(pg, 'cats');
    ok(/Gas speed in the pipe\s*\d+ ft\/s \(\d+ m\/s\)/.test(c) && /Loss in the channels\s*[\d.]+ psi \([\d.]+ kPa\)/.test(c) && /Exhaust flow, all cylinders\s*[\d,]+ cfm \([\d,]+ L\/s\)/.test(c) &&
      /Race, 100 cpsi metal\s*[\d.]+ psi \([\d.]+ kPa\)/.test(c), W + ': 8 the Cats tab: speeds, back pressures (and its table) and flow in both units');
    await tab(pg, 'boom-tubes'); c = await text(pg, 'boom-tubes');
    ok(/[\d.]+ in² \([\d,]+ mm²\)/.test(c) && /\d+ ft\/s \(\d+ m\/s\)/.test(c) && /Boom tube total\s*[\d.]+ psi \([\d.]+ kPa\)/.test(c) && /Sheet weight, each tube\s*[\d.]+ lb \([\d.]+ kg\)/.test(c), W + ': 8 the Boom tubes tab: area, exit speed, loss and weight in both units');
    await tab(pg, 'mufflers'); c = await text(pg, 'mufflers');
    ok(/Chamber volume\s*[\d.]+ L \(\d+ cu in\)/.test(c) && /\d+ cfm \(\d+ L\/s\) total/.test(c), W + ': 8 the plain chamber\'s volume and the muffler flow in both units');
    await tab(pg, 'sound'); c = await text(pg, 'sound');
    ok(/Bar wave speed[^\n]*\s*\d+ m\/s \([\d,]+ ft\/s\)/.test(c) && /Stiffness at \d+ °F \(\d+ °C\)/.test(c), W + ': 8 the Sound tab\'s wave speed and temperatures in both units');
    await clean(pg, 'cats', W);
    await pg.close();

    // ---------------- P3: the project key (1440 only: the same code at both widths)
    if (W === 1440) {
      pg = await open(ctx, W, 'quick');
      await pick(pg, 'veh', 'car', '^Ford$', '2018–20 Ford Mustang GT'); await chg(pg, 'q-scope', 'cat');
      const saved = await pg.evaluate(() => { const S = window.__hang.snap(); return { has: 'q-scope' in S.vals, v: S.vals['q-scope'] && S.vals['q-scope'].v, keys: Object.keys(S.vals).length }; });
      ok(saved.has && saved.v === 'cat', 'P3 the project file holds the choice under its own key, q-scope ("cat")');
      await pg.evaluate(() => { const b = document.getElementById('proj-btn'); if (b) b.click(); }); await settle(pg);
      await pg.fill('#proj-name', 'jobfix cat-back'); await pg.click('#proj-save'); await settle(pg); await pg.click('#proj-close');
      // an older project: the same file without the key
      await pg.evaluate(() => { const K = Object.keys(localStorage).find(k => /proj/i.test(k) && /^\[/.test(localStorage.getItem(k) || '')); const a = JSON.parse(localStorage.getItem(K));
        const old = JSON.parse(JSON.stringify(a[0])); old.name = 'jobfix old'; delete old.data.vals['q-scope']; a.unshift(old); localStorage.setItem(K, JSON.stringify(a)); });
      await chg(pg, 'q-scope', 'axle');
      const loadRow = async name => { await pg.evaluate(() => document.getElementById('proj-btn').click()); await settle(pg);
        const i = await pg.evaluate(n => [...document.querySelectorAll('#proj-list .pj-row')].findIndex(r => r.textContent.includes(n)), name);
        await pg.click('#proj-list .pj-row[data-i="' + i + '"] button[data-pj="load"]'); await settle(pg);
        if (await pg.evaluate(() => document.getElementById('proj-dlg').open)) await pg.click('#proj-close'); };
      await loadRow('jobfix cat-back'); ok(await val(pg, 'q-scope') === 'cat', 'P3 loading the project brings back cat-back');
      await loadRow('jobfix old'); ok(await val(pg, 'q-scope') === 'full', 'P3 a project without the key loads as the full system');
      await pg.close();
    }
    await ctx.close();
  }
  ok(!errs.length, 'no page errors or console errors' + (errs.length ? ': ' + errs.slice(0, 4).join(' | ') : ''));
  await b.close();
  console.log((fails.length ? 'FAILED ' + fails.length : 'ALL PASS') + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
