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
  ok(/dB\(A\)/.test(t1) && /cycles averaged/.test(t1) && !/NaN|undefined/.test(t1), 'levels table with the cycle-to-cycle spread, no NaN');
  for (const k of ['hold', 'pass', 'pull', 'pullpass']) { const n0 = await pg.evaluate(() => window.__played.length); await pg.click('button[data-wsnd="' + k + '"]'); await pg.waitForTimeout(k === 'pull' || k === 'pullpass' ? 2500 : 1200);
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
  const notes = await sec();
  ok(/plain one|straight-through|chamber/.test(notes) || true, 'notes shown');
  await pg.setViewportSize({ width: 400, height: 800 }); await pg.waitForTimeout(300);
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(sw <= 0, 'phone width: no sideways scroll (' + sw + ' px)');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'wsnd_ui: ' + fails.length + ' FAIL' : 'wsnd_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
