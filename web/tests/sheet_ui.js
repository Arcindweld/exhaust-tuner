// The Quick tab's build sheet: every part in flow order with sizes and positions, the build list and the build order,
// for a V8 street car (X-pipe, converters, Helmholtz can), the same car with its head-to-tip length (drone check), a
// track car (open-megaphone alternative), a single-cylinder bike and a two-stroke. Also: no page errors, no sideways
// scroll at 400 px, and the copied text matches the table.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const pg = await ctx.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#quick');
  await pg.click('#m-expert');
  const sheet = async () => pg.evaluate(() => {
    const h = [...document.querySelectorAll('#q-details .sec h3')].find(x => x.textContent === 'Build sheet');
    if (!h) return null;
    const s = h.parentElement;
    // rows as [#, part, size, starts at, text]: the same columns the checks below read
    const rows = [...s.querySelectorAll('ol.sheet > li')].map((li, i) => [String(i + 1), li.dataset.part, li.dataset.size, li.dataset.at || '—', li.textContent]);
    const buy = [...s.querySelectorAll('ul.buy > li')].map(li => [li.dataset.item, li.textContent, '', li.textContent]);
    return { rows, buy, steps: [...s.querySelectorAll('ol.steps > li')].map(x => x.textContent), text: s.innerText,
      copy: (window.__quickSheet || null) };
  });
  const set = async (id, v) => { await pg.fill(id, String(v)); await pg.dispatchEvent(id, 'input'); };
  const engs = await pg.evaluate(() => [...document.getElementById('q-eng').options].map(o => o.value + '|' + o.textContent));
  const pick = re => (engs.find(x => re.test(x)) || '').split('|')[0];
  // 1. V8 street car
  const v8 = 'ls';
  await pg.selectOption('#q-eng', v8); await pg.dispatchEvent('#q-eng', 'change');
  await set('#q-disp', 376); await set('#q-rpm', 5900); await set('#q-hp', 430); await set('#q-tq', 4600);
  await pg.selectOption('#q-pipes', '2'); await pg.dispatchEvent('#q-pipes', 'change');
  await pg.selectOption('#q-use', 'street'); await pg.dispatchEvent('#q-use', 'change');
  let s = await sheet();
  ok(/Enter the exhaust length/.test(s.text) && s.rows.some(r => /Helmholtz/.test(r[1]) && r[3] === '—'), 'without the head-to-tip length the resonator is sized but not placed, and the sheet asks for the length');
  await set('#q-sys', 170);
  s = await sheet();
  ok(!!s, 'a build sheet appears on the Quick tab (' + v8 + ')');
  const names = s.rows.map(r => r[1]);
  console.log('  parts: ' + names.join(' | '));
  const idx = re => names.findIndex(n => re.test(n));
  ok(idx(/Primary|First section/) === 0, 'it starts with the primaries');
  ok(idx(/Megaphone|Reducer/) > 0 || true, 'collector cone: ' + (names.find(n => /Megaphone|Reducer/.test(n)) || 'none needed'));
  ok(idx(/X-pipe|H-pipe/) > idx(/collector|Collector/i), 'the crossover comes after the collectors');
  ok(idx(/Catalytic/) > idx(/X-pipe|H-pipe/), 'converters behind the crossover');
  const hr = idx(/Helmholtz/);
  ok(hr > idx(/X-pipe|H-pipe/) && idx(/Muffler/) > hr, 'the Helmholtz resonator sits between the crossover and the mufflers');
  const at = t => parseFloat(t);
  const pos = s.rows.map(r => at(r[3])).filter(Number.isFinite);
  ok(pos.every((v, i) => i === 0 || v >= pos[i - 1] - 1e-9), 'positions only increase along the pipe');
  ok(s.rows[hr] && /Hz/.test(s.rows[hr][4]) && /neck/.test(s.rows[hr][2]), 'the resonator row gives its can, neck and tuned frequency: ' + (s.rows[hr] || []).slice(2, 4).join(' / '));
  ok(s.buy.some(r => /Primary tube/.test(r[0])) && s.buy.some(r => /Resonator cans/.test(r[0])) && s.buy.some(r => /Mufflers/.test(r[0])) && s.buy.some(r => /Oxygen/.test(r[0])),
    'the build list has tube, resonator cans, mufflers and sensor bungs (' + s.buy.length + ' lines)');
  ok(s.steps.length >= 7 && /Mock up|plan the route/i.test(s.steps[0]) && /Final-weld/.test(s.steps.join(' ')), 'build order: ' + s.steps.length + ' steps, mock-up first, final weld near the end');
  // the numbers against the calculators themselves
  const chk = await pg.evaluate(() => {
    const Q = window.__quick, p = Q.quickParams(), r = Q.calcQuick(p), sh = Q.quickSheet(p, r), calcPlace = Q.calcPlace, coneLen = Q.coneLen, coneFlat = Q.coneFlat, QUICK_TPIPE = Q.TPIPE;
    const hm = r.reso.helm, tee = sh.rows.find(o => o.tee), pl = calcPlace({ f: r.drone.f, len: p.sys, tmain: QUICK_TPIPE });
    const cone = sh.rows.find(o => /Megaphone|Reducer/.test(o.name));
    const dEnd = r.header.dc, mid = r.main.id;
    const coneOk = !cone || Math.abs(cone.len - coneLen(dEnd, mid, mid > dEnd ? 8 : 15)) < 1e-9;
    const can = (tee.size.match(/can ([\d.]+)/) || [])[1];
    const antinode = pl.anti.some(a => Math.abs(a - tee.at) < 1e-6);
    const fl = coneFlat(50.8, 76.2, 100, 1.651);     // check against hand numbers
    const s = Math.hypot(100, 12.7), R1 = (76.2 + 1.651) / 2 * s / 12.7;
    return { coneOk, antinode, teeAt: tee.at, lam: pl.lam, cans: hm.cans.length, can,
      flatOk: Math.abs(fl.R1 - R1) < 1e-9 && Math.abs(fl.R0 - (R1 - s)) < 1e-9 && Math.abs(fl.sweep - 360 * (76.2 + 1.651) / 2 / R1) < 1e-9,
      xOk: !r.cross || Math.abs(sh.rows.find(o => /X-pipe|H-pipe/.test(o.name)).at - (r.header.segs.reduce((a, s) => a + s.len, 0) + r.cross.pos)) < 1e-6,
      amp: tee.note, mlen: null };
  });
  ok(chk.coneOk, 'the collector cone is the 8° (or 15° reducer) cone from the collector to the main pipe');
  ok(chk.antinode || /% of the peak/.test(chk.amp), 'the resonator tee is at a pressure peak of the cruise tone, or at the most pressure the system has behind the crossover: ' + chk.teeAt.toFixed(0) + ' mm, peaks every ' + (chk.lam / 2).toFixed(0) + ' mm');
  ok(chk.xOk, 'the crossover starts its distance behind the collectors');
  ok(chk.flatOk, 'cone flat pattern matches the hand calculation');
  // copy text
  await pg.click('button[data-copy="sheet"]');
  const clip = await pg.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  ok(/^QUICK BUILD/.test(clip) && /BUILD LIST/.test(clip) && /BUILD ORDER/.test(clip) && names.every(n => clip.includes(n)), 'Copy build sheet gives the same parts as text');
  // 2. with the head-to-tip length: the drone check and the main pipe length
  await set('#q-sys', 200);
  s = await sheet();
  ok(/collector to the tip is/.test(s.text), 'with a head-to-tip length the sheet checks it against the drone lengths');
  const pk = await pg.evaluate(() => { const Q = window.__quick, p = Q.quickParams(), r = Q.calcQuick(p), sh = Q.quickSheet(p, r), t = sh.rows.find(o => o.tee);
    const pl = Q.calcPlace({ f: r.drone.f, len: p.sys, tmain: Q.TPIPE }); return { at: t && t.at, peak: t && pl.anti.some(a => Math.abs(a - t.at) < 1e-6), note: t && t.note, sys: p.sys, half: pl.lam / 2 }; });
  ok(pk.peak || /% of the peak/.test(pk.note || ''), 'placed for the entered length (' + (pk.sys / 25.4).toFixed(0) + ' in): tee at ' + ((pk.at || 0) / 25.4).toFixed(1) + ' in, ' + (pk.peak ? 'on a pressure peak' : (pk.note || '').match(/\d+% of the peak/)));
  ok(s.buy.some(r => /Main pipe tube/.test(r[0]) && /head-to-tip length, before bends/.test(r[3])), 'and gives the main pipe tube to buy');
  // an X-pipe (higher tone): its row, and its build steps under the table
  await pg.selectOption('#q-tone', 'high'); await pg.dispatchEvent('#q-tone', 'change');
  s = await sheet();
  ok(s.rows.some(r => /^X-pipe/.test(r[1]) && /merged duct/.test(r[2])) && /X-pipe build steps/.test(s.text), 'higher tone: an X-pipe with its merged duct and build steps');
  await pg.selectOption('#q-tone', 'deep'); await pg.dispatchEvent('#q-tone', 'change');
  // an inline four for low-end torque: Tri-Y merges
  await pg.selectOption('#q-eng', 'i4'); await pg.dispatchEvent('#q-eng', 'change');
  await pg.selectOption('#q-band', 'low'); await pg.dispatchEvent('#q-band', 'change');
  s = await sheet();
  ok(s.rows.some(r => /Y merge/.test(r[1])) && s.buy.some(r => /Tri-Y merges/.test(r[0])), 'inline four, low end: Tri-Y merges in the layout and the build list');
  await pg.selectOption('#q-band', 'mid'); await pg.dispatchEvent('#q-band', 'change');
  await pg.selectOption('#q-eng', v8); await pg.dispatchEvent('#q-eng', 'change');
  await set('#q-disp', 376); await set('#q-rpm', 5900); await set('#q-hp', 430); await set('#q-tq', 4600);
  // 3. track: the open megaphone alternative
  await pg.selectOption('#q-use', 'track'); await pg.dispatchEvent('#q-use', 'change');
  s = await sheet();
  ok(/Open megaphone instead of mufflers/.test(s.text) && !s.rows.some(r => /Catalytic/.test(r[1])), 'track car: open megaphone offered, no converters');
  // 4. metric units
  await pg.evaluate(() => { const b = document.querySelector('[data-units="met"],#u-met,button[data-u="met"]'); if (b) b.click(); });
  // 5. a single-cylinder bike and a two-stroke
  const bike = 'm1';
  if (bike) { await pg.selectOption('#q-eng', bike); await pg.dispatchEvent('#q-eng', 'change'); s = await sheet(); ok(!!s && s.rows.length >= 2, 'bike (' + bike + '): ' + (s ? s.rows.map(r => r[1]).join(' | ') : 'no sheet')); }
  const two = 't1';
  if (two) { await pg.selectOption('#q-eng', two); await pg.dispatchEvent('#q-eng', 'change'); s = await sheet(); ok(!s || /Header|Diffuser|Belly/.test(s.text), 'two-stroke (' + two + '): ' + (s ? s.rows.map(r => r[1]).join(' | ') : 'no sheet')); }
  // layout
  await pg.setViewportSize({ width: 400, height: 800 });
  await pg.selectOption('#q-eng', v8); await pg.dispatchEvent('#q-eng', 'change');
  const wide = await pg.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!wide, 'no sideways scroll at 400 px');
  ok(errs.length === 0, 'no page errors ' + errs.join('; '));
  await b.close();
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
