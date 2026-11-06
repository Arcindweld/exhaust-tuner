// Sound tab, "Hear the model (no recording needed)": the page's own wave simulation gives the sound with no recording and
// no OpenWAM file. Runs the estimate, checks the runs read like OpenWAM runs (finite order levels, the firing orders on
// top, the mass flow out what the engine breathes), that a muffler on the line takes level off, that the runs join the
// OpenWAM list, and that every play button makes sound without a page error.   node tests/wsnd_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.addInitScript(() => { window.__played = []; const AC = window.AudioContext; if (AC) { const o = AC.prototype.createBufferSource; AC.prototype.createBufferSource = function () { const s = o.call(this); const st = s.start.bind(s); s.start = (...a) => { if (s.buffer) { const d = s.buffer.getChannelData(0); let pk = 0; for (let i = 0; i < d.length; i++) pk = Math.max(pk, Math.abs(d[i])); window.__played.push({ n: s.buffer.length, sr: s.buffer.sampleRate, pk }); } else window.__played.push(null); try { st(...a); } catch (e) {} }; return s; }; } });
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(900); await pg.click('#u-met'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600);
  const sec = () => pg.evaluate(() => { const h = [...document.querySelectorAll('.sec h3')].find(x => /Hear the model/.test(x.textContent)); return h ? h.parentElement.innerText : ''; });
  ok(/no recording needed/i.test(await sec()) && /Estimate the sound/.test(await sec()), 'the Sound tab offers the estimate with no file loaded');
  const run = async rp => { await pg.evaluate(() => { window.__wsndLast = null; }); await pg.fill('#wsnd-rpms', rp); await pg.dispatchEvent('#wsnd-rpms', 'change'); await pg.click('button[data-wsnd="run"]'); await pg.waitForFunction(() => window.__wsndLast, null, { timeout: 300000 }); return pg.evaluate(() => window.__wsndLast.map(x => ({ rpm: x.rpm, err: x.err, spl: x.spl24, str: x.strongest, spread: x.spread, kf: x.kf, cyc: x.cyc && x.cyc.reduce((a, v) => a + v, 0) / x.cyc.length, src: x.src }))); };
  const open = await run('2500 4500');
  ok(open.length === 2 && open.every(x => !x.err && x.spl && x.spl.every(Number.isFinite)), 'two speeds, finite order levels (' + open.map(x => x.rpm).join(', ') + ')');
  ok(open.every(x => Number.isInteger(x.str) && x.str % 2 === 0), 'the strongest order is a firing order of the 4-into-1 (' + open.map(x => x.str).join(', ') + ')');
  const q = await pg.evaluate(() => { const i = window.__sim.inp(); return { cc: i.cc, cyl: i.cyl }; });
  const exp = r => 4 * q.cc / q.cyl * 1e-6 * 1.18 * (r / 120);   // one bank's swept air at VE 1
  ok(open.every(x => x.cyc > 0.5 * exp(x.rpm) && x.cyc < 1.4 * exp(x.rpm)), 'the mean flow out is what the cylinders breathe (' + open.map(x => x.cyc.toFixed(3) + ' kg/s vs ' + exp(x.rpm).toFixed(3)).join(', ') + ')');
  ok(open.every(x => x.kf === 2 && x.src === 'wave'), 'one 4-into-1 collector: 2 firing pulses a revolution, marked as the wave model');
  const listed = await pg.evaluate(() => window.__wamIns().filter(x => x.src === 'wave').length);
  ok(listed === 2, 'the runs join the OpenWAM runs list (' + listed + ')');
  const t1 = await sec();
  ok(/dB\(A\)/.test(t1) && /Play A/.test(t1) && !/NaN|undefined/.test(t1), 'levels table and the A / B player, no NaN');
  for (const k of ['hold', 'pass', 'pull', 'pullpass']) { const n0 = await pg.evaluate(() => window.__played.length); await pg.selectOption('#wsnd-how', k); await pg.waitForTimeout(200); await pg.click('button[data-wsnd="playA"]'); await pg.waitForTimeout(k === 'pull' || k === 'pullpass' ? 2500 : 1200);
    const p = await pg.evaluate(() => window.__played[window.__played.length - 1]), n1 = await pg.evaluate(() => window.__played.length);
    if (n1 <= n0) console.log('   message: ' + await pg.evaluate(() => (document.getElementById('wsnd-play-msg') || {}).textContent));
    ok(n1 > n0 && p && p.n > 48000 && p.pk > 0.001 && p.pk <= 1, k + ': plays ' + (p ? (p.n / p.sr).toFixed(1) + ' s, peak ' + p.pk.toFixed(3) : 'nothing')); }
  // a muffler on the line: a plain chamber from the Mufflers tab
  await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(500);
  await pg.selectOption('select.wamline[data-k="on"]', '1'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(500);
  const line = await run('2500 4500');
  await pg.evaluate(() => { location.hash = 'mufflers'; }); await pg.waitForTimeout(400);
  await pg.evaluate(() => { for (const [id, v] of [['m-dch', '230'], ['m-lch', '400']]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }); await pg.waitForTimeout(200);
  await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400);
  await pg.selectOption('select.wamline[data-k="mufKind"]', 'chamber').catch(() => {}); await pg.waitForTimeout(200);
  const kind = await pg.evaluate(() => window.__wamLine ? window.__wamLine.W().mufKind : null);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(500);
  const muf = await run('2500 4500');
  const aw = f => { const f2 = f * f, n = 12194 ** 2 * f2 * f2, d = (f2 + 20.6 ** 2) * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2); return 20 * Math.log10(n / d) + 2; };
  const LA = x => 10 * Math.log10(x.spl.reduce((a, L, i) => a + Math.pow(10, (L + aw((i + 1) / 2 * x.rpm / 60)) / 10), 0));
  const dL = line.map((x, i) => LA(x) - LA(muf[i]));
  ok(kind === 'chamber' && dL.every(v => v > 3), 'a 230 x 400 mm chamber on the line takes ' + dL.map(v => v.toFixed(1)).join(' and ') + ' dB(A) off (line ' + line.map(x => LA(x).toFixed(1)).join(', ') + ')');
  // a packed straight-through on the line: the packing takes the upper band down and leaves the low end
  const setv = kv => pg.evaluate(kv => { for (const [id, v] of kv) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }, kv);
  await setv([['m-por', '10'], ['m-ph', '3.5'], ['m-pw', '1.2']]);
  await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400); await pg.selectOption('select.wamline[data-k="mufKind"]', 'packed'); await pg.waitForTimeout(200);
  const band = (x, lo, hi) => 10 * Math.log10(x.spl.reduce((a, L, i) => { const f = (i + 1) / 2 * x.rpm / 60; return a + (f >= lo && f < hi ? Math.pow(10, L / 10) : 0); }, 1e-30));
  const pk = {};
  for (const rho of ['0', '150']) { await setv([['m-pack', rho]]); await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(400); pk[rho] = await run('2500'); await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(300); }
  const hi0 = band(pk['0'][0], 300, 1000), hi1 = band(pk['150'][0], 300, 1000), lo0 = band(pk['0'][0], 0, 150), lo1 = band(pk['150'][0], 0, 150);
  ok(pk['0'][0].spl.every(Number.isFinite) && hi0 - hi1 > 5 && Math.abs(lo0 - lo1) < 3, 'packing (150 kg/m³ against none) takes ' + (hi0 - hi1).toFixed(1) + ' dB off 300-1000 Hz, ' + (lo1 - lo0).toFixed(1) + ' dB change below 150 Hz');
  const wamPk = await pg.evaluate(() => { const t = window.__wamLine.lineUi ? window.__wamLine.lineUi() : document.getElementById('panel-four').innerText; return /bare core/.test(t); });
  ok(wamPk, 'the OpenWAM panel says its case runs the bare core');
  await pg.selectOption('select.wamline[data-k="mufKind"]', 'chamber'); await pg.waitForTimeout(200);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(400);
  // every addition heard on its own: extended tubes on the chamber and a J-pipe on the line, then "Hear each part
  await pg.evaluate(() => { for (const [id, v] of [['m-lin', '150'], ['m-lout', '75']]) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }); await pg.waitForTimeout(200);
  await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400);
  await pg.selectOption('select.wamline[data-k="fix"]', 'jpipe'); await pg.waitForTimeout(300);
  const fixOn = await pg.evaluate(() => window.__wamLine.W().fix);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(500);
  const ext = await pg.evaluate(() => window.__wsnd.wsndExt());
  ok(ext.branches.length === 3 && ext.branches.filter(b => /pocket/.test(b.what)).length === 2 && ext.branches.some(b => b.what === 'J-pipe'), 'the pockets and the J-pipe go into the line as side branches (' + ext.branches.map(b => b.what).join(', ') + ')');
  await pg.evaluate(() => { window.__wsndSets = null; }); await pg.click('button[data-wsnd="parts"]'); await pg.waitForFunction(() => window.__wsndSets, null, { timeout: 600000 });
  const sets = await pg.evaluate(() => window.__wsndSets.map(s => ({ key: s.key, label: s.label, runs: s.runs.map(x => ({ rpm: x.rpm, err: x.err, spl: x.spl24 })) })));
  ok(fixOn === 'jpipe' && sets.map(s => s.key).join() === 'open,line,muf,fix', 'Hear each part: the open headers, + line, + muffler, + J-pipe (' + sets.map(s => s.key).join(', ') + ')');
  const LAs = sets.map(s => s.runs.map(LA));
  console.log('   dB(A) at 1 m by step: ' + sets.map((s, k) => s.key + ' ' + LAs[k].map(v => v.toFixed(1)).join('/')).join(', '));
  const dSpec = (a, c) => Math.max(...a.spl.map((v, i) => Math.abs(v - c.spl[i])));
  ok(sets.every(s => s.runs.every(x => !x.err && x.spl.every(Number.isFinite))), 'every step ran at every speed');
  ok(sets.slice(1).every((s, k) => s.runs.every((x, i) => dSpec(x, sets[k].runs[i]) > 1)), 'every addition changes the sound (largest order change per step, at each speed: ' + sets.slice(1).map((s, k) => s.runs.map((x, i) => dSpec(x, sets[k].runs[i]).toFixed(0)).join('/')).join(', ') + ' dB)');
  ok(LAs[2].every((v, i) => v < LAs[1][i]), 'the muffler takes level off the line and tailpipe');
  // the extended tubes are heard: the same can without them
  const plainVsExt = await pg.evaluate(() => { const W = document.getElementById('m-lin'), Z = document.getElementById('m-lout'); const a = window.__wsnd.wsndExt().branches.length; W.value = '0'; W.dispatchEvent(new Event('input', { bubbles: true })); Z.value = '0'; Z.dispatchEvent(new Event('input', { bubbles: true })); const b = window.__wsnd.wsndExt().branches.length; return [a, b]; });
  ok(plainVsExt[0] === 3 && plainVsExt[1] === 1, 'without the extended tubes the pockets go (branches ' + plainVsExt.join(' -> ') + ')');
  // A / B between two steps, and every row in order
  const txt = await sec();
  ok(/Headers and collector, open/.test(txt) && /\+ the muffler/.test(txt) && /\+ the J-pipe/.test(txt) && /\([+-]\d/.test(txt), 'the table shows each step with what its addition changed');
  for (const k of ['ab', 'steps']) { await pg.selectOption('#wsnd-how', 'hold'); await pg.waitForTimeout(150); const n0 = await pg.evaluate(() => window.__played.length); await pg.click('button[data-wsnd="' + k + '"]'); await pg.waitForTimeout(2500);
    const p = await pg.evaluate(() => window.__played[window.__played.length - 1]), n1 = await pg.evaluate(() => window.__played.length), m = await pg.evaluate(() => document.getElementById('wsnd-play-msg').textContent);
    ok(n1 > n0 && p && p.n > (k === 'ab' ? 2 : 4) * 4 * 48000, k + ': plays ' + (p ? (p.n / 48000).toFixed(1) + ' s' : 'nothing') + ' (' + m.slice(0, 90) + ')'); }
  // keep the design, change the primaries, estimate again: both on show
  await pg.click('button[data-wsnd="keep"]'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(500);
  const p0 = await pg.evaluate(() => { const el = document.getElementById('f-ex1') || document.querySelector('#panel-four input[data-kind="len"]'); return el ? el.id : null; });
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(500);
  await pg.evaluate(() => { window.__wsndLast = null; }); await pg.click('button[data-wsnd="run"]'); await pg.waitForFunction(() => window.__wsndLast, null, { timeout: 300000 });
  const kept = await pg.evaluate(() => ({ n: window.__wsnd.WSND.kept.length, rows: document.querySelectorAll('input[name="wsnd-a"]').length, t: [...document.querySelectorAll('.sec h3')].find(x => /Hear the model/.test(x.textContent)).parentElement.innerText }));
  ok(kept.n === 1 && kept.rows === 2 && /Kept 1: primaries/.test(kept.t), 'a kept design stays beside the new estimate (' + kept.rows + ' rows)');
  await pg.setViewportSize({ width: 400, height: 800 }); await pg.waitForTimeout(300);
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(sw <= 0, 'phone width: no sideways scroll (' + sw + ' px)');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'wsnd_ui: ' + fails.length + ' FAIL' : 'wsnd_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
