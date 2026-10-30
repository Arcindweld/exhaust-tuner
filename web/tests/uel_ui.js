// Unequal-length primaries (uel_patch.py): Headers table, physics section, feeds into OpenWAM / Engine Simulator / Fusion route,
// the INS.DAT order reader, and equal mode unchanged. Desk and phone. Uses uel_runs/ (OpenWAM 2.2 Linux runs of page cases).
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const HERE = __dirname, RUNS = path.join(HERE, 'uel_runs');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  // equal mode regression: the 4-Stroke OpenWAM case for the default inputs must match the stored golden files
  // (fixtures/wam_default/, written from the V33 page; regenerate with UPDATE_GOLDEN=1 only after checking a change is intended)
  const caseOf = async (file) => {
    const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await pg.goto('file://' + file); await pg.waitForTimeout(800);
    await pg.evaluate(() => { document.body.classList.add('expert'); location.hash = 'four-stroke'; }); await pg.waitForTimeout(500);
    await pg.click('button[data-wam="dl"]'); await pg.waitForTimeout(700);
    const f = await pg.evaluate(() => window.__wamLast.files.map(x => [x.name, x.text]));
    await pg.close(); return f;
  };
  const GOLD = path.join(HERE, 'fixtures', 'wam_default');
  const wamNew = (await caseOf(path.join(HERE, '..', 'index.html'))).filter(x => /\.wam$/.test(x[0]));
  if (process.env.UPDATE_GOLDEN) { fs.mkdirSync(GOLD, { recursive: true }); wamNew.forEach(x => fs.writeFileSync(path.join(GOLD, path.basename(x[0])), x[1])); }
  const wamOld = fs.existsSync(GOLD) ? fs.readdirSync(GOLD).sort().map(n => [n, fs.readFileSync(path.join(GOLD, n), 'utf8')]) : [];
  const sortedNew = wamNew.map(x => [path.basename(x[0]), x[1]]).sort((p, q) => p[0] < q[0] ? -1 : 1);
  ok(wamOld.length && wamOld.length === sortedNew.length && wamOld.every((x, i) => x[0] === sortedNew[i][0] && x[1] === sortedNew[i][1]),
    'equal mode: the 4-Stroke OpenWAM case matches the golden files (' + sortedNew.map(x => x[0]).join(', ') + ')');

  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const ctx = await b.newContext({ viewport: vp });
    await ctx.addInitScript(() => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, JSON.parse(d)]); return Promise.resolve(JSON.stringify({ ok: true, items: [], msg: 'stub' })); } }; });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('file://' + path.join(HERE, '..', 'index.html')); await p.waitForTimeout(900);
    const set = (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
    const txt = async id => (await p.$eval(id, e => e.innerText));
    const noScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    await p.evaluate(() => { document.getElementById('u-met').click(); location.hash = 'headers'; }); await p.waitForTimeout(400);
    ok(await p.$eval('#h-lenmode', e => e.value === 'equal'), vp.n + ': Primary lengths selector defaults to equal');
    ok(await p.$eval('#h-uel-wrap', e => e.hidden), vp.n + ': per-cylinder table hidden in equal mode');
    // equal-mode route payload: no targets
    const route = async () => p.evaluate(async () => { window.__sent.length = 0; document.querySelector('button[data-fx="routeHeader"]').click(); const note = document.getElementById('fx-out-headers').innerText;
      await new Promise(r => setTimeout(r, 80)); const s = window.__sent.find(x => x[0] === 'route'); return { pay: s && s[1], note }; });
    await set('h-eng', 'f4'); await set('h-disp', '2457'); await set('h-grp', 'all'); await set('h-merge', 'triy'); await p.waitForTimeout(200);
    let rt = await route();
    ok(rt.pay && rt.pay.mode === 'header' && !('targets_mm' in rt.pay), vp.n + ': equal mode route payload has no targets_mm');
    let t = await txt('#panel-headers');
    ok(/1 \+ 2/.test(t) && /3 \+ 4/.test(t), vp.n + ': blank Y pairs keep the most even pairing (1 + 2, 3 + 4)');
    // Subaru 4-2-1 as built
    await set('h-pairs', '1,3 | 2,4'); await set('h-lenmode', 'unequal'); await p.waitForTimeout(300);
    ok(!(await p.$eval('#h-uel-wrap', e => e.hidden)), vp.n + ': per-cylinder table shown in unequal mode');
    const cells = await p.evaluate(() => ({ c: [1, 2, 3, 4].map(i => { const e = document.getElementById('h-len-c' + i); return e && e.value; }), c5: !!document.getElementById('h-len-c5'),
      g: [1, 2].map(i => { const e = document.getElementById('h-sec-g' + i); return e && e.value; }), first: document.getElementById('h-first').value, unit: document.querySelector('#h-uel-tbl em[data-u="len"]').textContent }));
    ok(cells.c.every(v => v === cells.first) && !cells.c5 && cells.g[0] && cells.g[0] === cells.g[1] && cells.unit === 'mm', vp.n + ': 4 cylinder cells prefilled with the equal design (' + cells.c.join(', ') + ' mm = first section ' + cells.first + '), 2 secondaries ' + cells.g.join(', '));
    t = (await txt('#panel-headers'));
    ok(/1 \+ 3/.test(t) && /2 \+ 4/.test(t) && /180 · 540°/.test(t), vp.n + ': pulse-spacing table shows the as-built Y pairs 1 + 3, 2 + 4 (180/540°)');
    for (const [c, v] of [[1, 430], [2, 600], [3, 430], [4, 600]]) await p.fill('#h-len-c' + c, String(v));
    await p.fill('#h-sec-g1', '350'); await p.fill('#h-sec-g2', '650'); await p.waitForTimeout(300);
    ok(await p.$eval('#h-len-c2', e => e.value === '600'), vp.n + ': typed value stays in the cell after the re-render');
    t = await txt('#panel-headers');
    // 850 x 240 / (L/25.4 + 3): 780 mm -> 6,052 RPM, 1250 mm -> 3,907 RPM
    ok(/UNEQUAL PRIMARY LENGTHS/i.test(t) && /6,052 RPM/.test(t) && /3,907 RPM/.test(t), vp.n + ': each primary’s tuned RPM from the inverted length rule (6,052 and 3,907 RPM)');
    ok(/1\.50 ms/.test(t) && /58° of crank at 6,500 RPM/.test(t), vp.n + ': spread of return times 1.50 ms = 58° at 6,500 RPM');
    const ord = await p.evaluate(() => { const tb = [...document.querySelectorAll('#h-details table')].find(x => /Equal lengths/i.test(x.innerText)); if (!tb) return null;
      return [...tb.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.innerText)); });
    ok(ord && ord[0][0] === '0.5 (half)' && ord[0][1] === '—' && /-\d+ dB/.test(ord[0][3]) && ord[3][1] === '0 dB', vp.n + ': order table: half orders absent with equal lengths, present with yours (' + (ord && ord[0].join(' | ')) + ')');
    const share = ord && ord[ord.length - 1];
    ok(share && share[1] === '0%' && parseInt(share[3]) >= 20, vp.n + ': half-order energy share 0% equal against ' + (share && share[3]) + ' unequal at 6,500 RPM');
    ok(/TOYOTA TIMES/.test(t) && /Blair/.test(t) && /No back-to-back dyno or sound test/.test(t), vp.n + ': sources and the missing comparison stated');
    ok(/430 mm\s+350 mm/.test(t) && /600 mm\s+650 mm/.test(t), vp.n + ': cut list shows each cylinder’s primary and secondary');
    ok(await noScroll(), vp.n + ': Headers tab no sideways scroll');
    // Fusion route: one target per port marker, cylinder order, primary + secondary
    rt = await route();
    ok(rt.pay && JSON.stringify(rt.pay.targets_mm) === '[780,1250,780,1250]' && rt.pay.mode === 'header', vp.n + ': route payload targets_mm ' + JSON.stringify(rt.pay && rt.pay.targets_mm));
    ok(/cylinders 1, 2, 3, 4 in that order/.test(rt.note) && /does not build the Y/.test(rt.note), vp.n + ': route note tells the marker order and the Y limitation');
    ok(/select the port markers of cylinders 1, 2, 3, 4 in that order/.test(await txt('#panel-headers')), vp.n + ': the marker order is on the tab before the click');
    // units follow the page
    await p.click('#u-imp'); await p.waitForTimeout(200);
    ok(await p.$eval('#h-len-c1', e => e.value === '16.929') && await p.$eval('#h-uel-tbl em[data-u="len"]', e => e.textContent === 'in'), vp.n + ': cells redisplay in inches (430 mm = 16.929 in)');
    await p.click('#u-met'); await p.waitForTimeout(200);
    // 4-Stroke tab: OpenWAM case of the unequal system, Engine Simulator file
    await p.evaluate(() => { document.body.classList.add('expert'); location.hash = 'four-stroke'; }); await p.waitForTimeout(400);
    await set('f-cyl', '4'); await set('f-disp', '2457'); await p.waitForTimeout(300);
    t = await txt('#panel-four');
    ok(/Header to simulate/i.test(t) && await p.$eval('#wam-src', e => e.value === 'hdr') && /Y pairs 1\+3, 2\+4/.test(t), vp.n + ': OpenWAM section offers the Headers system and describes it');
    await p.fill('input.wamx[data-k="rpms"]', '3000 5000'); await p.click('button[data-wam="dl"]'); await p.waitForTimeout(800);
    const w = await p.evaluate(() => window.__wamLast && { names: window.__wamLast.files.map(f => f.name), uel: window.__wamLast.uel, txt: window.__wamLast.files[0].text, readme: window.__wamLast.files.find(f => f.name === 'README.txt').text });
    const block = (s, c) => { const i = s.indexOf('<cylinder ' + c + ' exhaust primary'); return s.slice(i, s.indexOf('<cylinder', i + 10)); };
    ok(w && w.uel && w.names.length === 4 && /_uel_3000\.wam/.test(w.names[0]), vp.n + ': UEL case files ' + (w && w.names.join(', ')));
    ok(w && /^0\.43 0\.04445 /m.test(block(w.txt, 1)) && /^0\.6 0\.04445 /m.test(block(w.txt, 2)) && /^0\.43 0\.04445 /m.test(block(w.txt, 3)) && /^0\.6 0\.04445 /m.test(block(w.txt, 4)),
      vp.n + ': .wam has each cylinder’s own primary (430, 600, 430, 600 mm)');
    ok(w && /^0\.30527887046 /m.test(w.txt) && /^0\.60527887046 /m.test(w.txt) && /level 1 branch 2/.test(w.txt), vp.n + ': .wam has the per-pair secondaries (350 and 650 mm incl. the Y cone)');
    ok(w && /instantaneous results 2/.test(w.txt) && /Unequal-length header from the Headers tab/.test(w.readme) && /cylinder 2: primary 600\.0 mm/.test(w.readme), vp.n + ': INS output requested and the README lists the lengths');
    await p.click('button[data-es="dl"]'); await p.waitForTimeout(500);
    const es = await p.evaluate(() => window.__esLast && { L: window.__esLast.spec.exhaust.primaryL_mm, t: window.__esLast.text });
    ok(es && JSON.stringify(es.L) === '[780,1250,780,1250]' && /primary_tube_length: 780\.0 \* units\.mm/.test(es.t) && (es.t.match(/primary_length: 470\.0 \* units\.mm/g) || []).length === 2,
      vp.n + ': Engine Simulator file: primaryL_mm ' + JSON.stringify(es && es.L) + ', two cylinders +470 mm');
    t = await txt('#panel-four');
    ok(/Unequal primaries from the Headers tab/.test(t) && /primaries 780 mm, 1250 mm, 780 mm, 1250 mm/.test(t), vp.n + ': Engine Simulator section states the per-cylinder lengths');
    // results readers: OpenWAM runs of page cases (uel_gen.js), unequal against equal cells
    const ins = ['uel_uel_3000', 'uel_el_3000'].map(n => path.join(RUNS, n, n + 'INS.DAT'));
    if (ins.every(f => fs.existsSync(f))) {
      await p.setInputFiles('#wam-ins', ins); await p.waitForTimeout(1500);
      const tb = await p.evaluate(() => { const tbl = [...document.querySelectorAll('#panel-four table')].find(x => /Half orders, energy share/.test(x.innerText)); return tbl && [...tbl.rows].map(r => [...r.cells].map(c => c.innerText.replace(/\n/g, ' '))); });
      const sh = tb && tb.find(r => /^Half orders/.test(r[0])), st = tb && tb.find(r => /^Strongest/.test(r[0]));
      ok(tb && /uel_el_3000/i.test(tb[0].join(' ')) && /uel_uel_3000/i.test(tb[0].join(' ')), vp.n + ': INS order table with both runs');
      const col = tb ? tb[0].findIndex(c => /uel_uel/i.test(c)) : -1, cel = tb ? tb[0].findIndex(c => /uel_el/i.test(c)) : -1;
      ok(sh && parseInt(sh[col]) >= 20 && parseInt(sh[cel]) <= 2 && /^2\.5/.test(st[col]) && /^2 /.test(st[cel]), vp.n + ': OpenWAM outflow: half orders ' + (sh && sh[col]) + ' of the energy unequal (strongest ' + (st && st[col]) + ') against ' + (sh && sh[cel]) + ' equal (strongest ' + (st && st[cel]) + ')');
      const r05 = tb && tb.find(r => r[0] === '1.5 (half)');
      ok(r05 && /-1[0-9] dB|-[0-9] dB/.test(r05[col]) && /-[3-9][0-9] dB|—/.test(r05[cel]), vp.n + ': order 1.5: ' + (r05 && r05[col]) + ' unequal, ' + (r05 && r05[cel]) + ' equal');
      await p.setInputFiles('#wam-files', [path.join(RUNS, 'uel_uel_3000', 'uel_uel_3000AVG.DAT')]); await p.waitForTimeout(800);
      t = await txt('#panel-four');
      ok(/uel_uel_3000\s+3000/.test(t), vp.n + ': AVG.DAT of the 4-cylinder unequal run reads');
    } else console.log('  (uel_runs INS files missing: run node uel_gen.js and OpenWAM first)');
    ok(!/\bNaN\b|undefined|\[object/.test(await txt('#panel-four')), vp.n + ': 4-Stroke tab no NaN/undefined');
    ok(await noScroll(), vp.n + ': 4-Stroke tab no sideways scroll');
    // back to the tab's own collector
    await p.selectOption('#wam-src', 'four'); await p.waitForTimeout(300);
    await p.click('button[data-wam="dl"]'); await p.waitForTimeout(600);
    const w2 = await p.evaluate(() => ({ n: window.__wamLast.files[0].name, uel: window.__wamLast.uel, t: window.__wamLast.files[0].text }));
    ok(!w2.uel && !/_uel_/.test(w2.n) && !/level 1 branch/.test(w2.t) && !/instantaneous results 2/.test(w2.t), vp.n + ': "This tab" writes the equal single-collector case again (' + w2.n + ')');
    // equal mode again: feeds revert
    await p.evaluate(() => { location.hash = 'headers'; }); await p.waitForTimeout(300);
    await set('h-lenmode', 'equal'); await p.waitForTimeout(200);
    rt = await route();
    ok(rt.pay && !('targets_mm' in rt.pay), vp.n + ': back in equal mode the route has no targets_mm');
    await p.evaluate(() => { location.hash = 'four-stroke'; }); await p.waitForTimeout(300);
    await p.click('button[data-es="dl"]'); await p.waitForTimeout(400);
    ok(await p.evaluate(() => typeof window.__esLast.spec.exhaust.primaryL_mm === 'number'), vp.n + ': back in equal mode Engine Simulator gets one primary length');
    ok(!/Header to simulate/i.test(await txt('#panel-four')), vp.n + ': back in equal mode the OpenWAM source choice is gone');
    // a bad pairing is reported
    await p.evaluate(() => { location.hash = 'headers'; }); await p.waitForTimeout(300);
    await set('h-pairs', '1,2,3 | 4'); await p.waitForTimeout(200);
    ok(/Y pairs: collector A/.test(await txt('#panel-headers')), vp.n + ': a bad Y pairing gets a plain error');
    await set('h-pairs', '1,3 | 2,4');
    // a V8 per bank in unequal mode: two collectors, route picks one
    await set('h-eng', 'ls'); await set('h-grp', 'bank'); await set('h-merge', 'direct'); await set('h-lenmode', 'unequal'); await p.waitForTimeout(300);
    const v8 = await p.evaluate(() => ({ n: document.querySelectorAll('#h-uel-tbl input[id^="h-len-c"]').length, sel: !!document.getElementById('h-uel-route') }));
    ok(v8.n === 8 && v8.sel, vp.n + ': V8 per bank: 8 cells and a collector picker for the route');
    await p.selectOption('#h-uel-route', '1'); await p.waitForTimeout(200);
    rt = await route();
    ok(rt.pay && rt.pay.targets_mm && rt.pay.targets_mm.length === 4 && /collector B/.test(rt.pay.title), vp.n + ': V8 route sends the 4 targets of collector B (' + (rt.pay && rt.pay.title) + ')');
    t = await txt('#panel-headers');
    ok(/Collector B/.test(t) && !/\bNaN\b|undefined|\[object/.test(t), vp.n + ': V8 order tables per collector, no NaN');
    ok(await noScroll(), vp.n + ': V8 Headers no sideways scroll');
    ok(errs.length === 0, vp.n + ': no page errors ' + errs.join(' | '));
    await ctx.close();
  }
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); await b.close(); process.exit(fails.length ? 1 : 0);
})();
