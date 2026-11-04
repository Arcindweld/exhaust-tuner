// Sound tab, "Compare a recording": a synthetic WAV with known orders comes back at its speed and levels; the owner's
// Outback and RS 660 recordings give the steady holds where the Python tools found them and the same order levels
// (validation/*/recording_orders.json, sound/order_spectrum.py), with OpenWAM's outflow spectrum compared when
// loaded; the JSON export; no page errors. Run from web/.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');
// a 16-bit mono WAV: orders 2, 4, 6 of `rpm` at 0, -6, -12 dB, white noise at -50 dB under the strongest
function wav(rpm, secs, sr) {
  const n = Math.round(secs * sr), f1 = rpm / 60, buf = Buffer.alloc(44 + 2 * n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + 2 * n, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(2 * sr, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(2 * n, 40);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let i = 0; i < n; i++) { const t = i / sr;
    // and every other half order 30 dB down, as a real engine has (an engine with nothing between its firing orders
    // cannot be told from one at half the speed by any order comb)
    let v = 0.4 * Math.sin(2 * Math.PI * 2 * f1 * t) + 0.4 * Math.pow(10, -6 / 20) * Math.sin(2 * Math.PI * 4 * f1 * t + 1) + 0.4 * Math.pow(10, -12 / 20) * Math.sin(2 * Math.PI * 6 * f1 * t + 2) + 0.4 * Math.pow(10, -50 / 20) * 3.46 * rnd();
    for (const o of [0.5, 1, 1.5, 2.5, 3, 3.5, 4.5, 5, 5.5, 6.5, 7, 7.5, 8, 9, 10]) v += 0.4 * Math.pow(10, -30 / 20) * Math.sin(2 * Math.PI * o * f1 * t + o);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + 2 * i); }
  return buf;
}
(async () => {
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } }); p.on('pageerror', e => errs.push(e.message)); if (process.env.DBG) p.on('console', m => console.log('console: ' + m.text()));
  await p.goto('file://' + process.cwd() + '/index.html#sound'); await p.waitForTimeout(1500);
  if (process.env.DBG) await p.evaluate(() => { ['input', 'change'].forEach(t => window.addEventListener(t, e => { if (e.target.type === 'file') console.log(t + ' ' + e.target.id + ' ' + (e.target.files[0] && e.target.files[0].name) + ' conn ' + e.target.isConnected); }, true)); });
  // the page re-renders on the next frame after its height changes (ResizeObserver): let that settle before picking a file
  const eng = async v => { await p.evaluate(E => { const s = document.getElementById('s-eng'); s.value = E; s.dispatchEvent(new Event('change', { bubbles: true })); }, v); await p.waitForTimeout(700); };
  const load = async f => { await p.evaluate(() => { window.__rec.REC.fr = null; window.__rec.REC.err = null; }); await p.waitForTimeout(400);
    await p.setInputFiles('#rec-file', f); await p.waitForFunction(() => window.__rec.REC.fr || window.__rec.REC.err, null, { timeout: 180000 }).catch(async e => { console.log('load stuck:', await p.evaluate(() => JSON.stringify({ busy: window.__rec.REC.busy, err: window.__rec.REC.err, name: window.__rec.REC.name, hasInput: !!document.getElementById('rec-file'), hash: location.hash }))); throw e; }); await p.waitForTimeout(300); };
  ok(await p.evaluate(() => [...document.querySelectorAll('#sound-details .sec h3')].some(h => h.textContent === 'Compare a recording')), 'the Sound tab has a Compare a recording section');
  // synthetic: an inline-4 at 2400 RPM
  await eng('i4');
  const tmp = path.join(os.tmpdir(), 'rec_synth.wav'); fs.writeFileSync(tmp, wav(2400, 6, 44100));
  await load(tmp);
  const sy = await p.evaluate(() => { const R = window.__rec.REC, H = R.holds[0], ol = H && window.__rec.recOrderLevels(R.F, H, R.ctx); return { err: R.err, n: R.holds.length, rpm: H && H.rpm, lev: ol && ol.lev, info: R.info }; });
  ok(!sy.err && sy.n === 1 && Math.abs(sy.rpm - 2400) / 2400 < 0.01, 'synthetic: one hold found at ' + sy.rpm + ' RPM (2400)');
  ok(sy.lev && Math.abs(sy.lev[2]) < 0.3 && Math.abs(sy.lev[4] + 6) < 0.5 && Math.abs(sy.lev[6] + 12) < 0.5 && Math.abs(sy.lev[3] + 30) < 1,
    'synthetic: orders 2, 4, 6 at ' + [sy.lev[2], sy.lev[4], sy.lev[6]].join(', ') + ' dB (0, -6, -12), order 3 at ' + sy.lev[3] + ' dB (-30)');
  ok(sy.info.sr === 44100 && sy.info.bits === 16 && !sy.info.decoded && sy.info.clip === 0, 'the WAV is read as recorded: 44.1 kHz, 16-bit, no clipping');
  // the owner's recordings against the Python tools
  for (const [name, e, file, ref, want] of [
    ['Outback', 'f4', '../validation/outback-2004/recordings/full_idle_revs.wav', '../validation/outback-2004/recording_orders.json', ['full_idle', 'full_hold_2000', 'full_hold_2600', 'full_hold_2950']],
    ['RS 660', 'p2_270', '../validation/rs660-2026/recordings/idle_to_5500.wav', '../validation/rs660-2026/recording_orders.json', ['idle_warm', 'hold_5400']]]) {
    await eng(e); await load(path.resolve(file));
    const P = JSON.parse(fs.readFileSync(path.resolve(ref), 'utf8'));
    const R = await p.evaluate(() => window.__rec.REC.holds.map(h => ({ t0: h.t0, t1: h.t1, rpm: h.rpm })));
    for (const k of want) { const q = P[k];
      const H = R.find(h => Math.abs(h.rpm - q.rpm) / q.rpm < 0.04 && h.t0 < q.t[1] && h.t1 > q.t[0]);
      const lev = await p.evaluate(([t0, t1, rpm]) => { const R = window.__rec.REC; return window.__rec.recOrderLevels(R.F, { t0, t1, rpm }, R.ctx).lev; }, [q.t[0], q.t[1], q.rpm]);
      const ds = Object.keys(q.orders_dB_rel).filter(o => +o <= 12 && Number.isFinite(lev[+o])).map(o => lev[+o] - q.orders_dB_rel[o]);
      const rms = Math.sqrt(ds.reduce((a, d) => a + d * d, 0) / ds.length);
      ok(!!H && rms < (k.indexOf('idle') >= 0 ? 2 : 1), name + ' ' + k + ': hold found (' + (H ? Math.round(H.rpm) + ' RPM, ' + H.t0.toFixed(1) + '-' + H.t1.toFixed(1) + ' s' : 'none') + ' against ' + q.rpm + ' RPM, ' + q.t.join('-') + ' s); order levels within ' + rms.toFixed(2) + ' dB RMS of order_spectrum.py');
    }
  }
  // OpenWAM: the Outback's 1980 RPM hold against its run (validation/outback-2004/model/runs/hold_1980), loaded on the
  // 4-Stroke tab; the Python order_compare.py gave 10.5 dB RMS over orders 2-12 for this pair
  const ins = path.resolve('../validation/outback-2004/model/runs/hold_1980/hold_1980INS.DAT');
  if (fs.existsSync(ins)) {
    await p.evaluate(() => { location.hash = 'four-stroke'; }); await p.waitForTimeout(800);
    await p.setInputFiles('#wam-ins', ins);
    await p.waitForFunction(() => /Half orders, energy share/.test(document.getElementById('panel-four').innerText), null, { timeout: 240000 });
    await p.evaluate(() => { location.hash = 'sound'; }); await p.waitForTimeout(800);
    await eng('f4'); await load(path.resolve('../validation/outback-2004/recordings/full_idle_revs.wav'));
    const hi = await p.evaluate(() => window.__rec.REC.holds.findIndex(h => Math.abs(h.rpm - 1980) < 80));
    await p.evaluate(i => { const s = document.getElementById('rec-hold'); s.value = String(i); s.dispatchEvent(new Event('change', { bubbles: true })); }, hi); await p.waitForTimeout(500);
    const t = await p.evaluate(() => [...document.querySelectorAll('#sound-details .sec')].find(x => /Compare a recording/.test(x.innerText)).innerText);
    const m = t.match(/RMS over (\d+) firing-and-above orders: ([\d.]+) dB/);
    ok(/OpenWAM \(hold_1980\)/.test(t) && m && +m[2] > 5 && +m[2] < 15, 'OpenWAM hold_1980 compared order by order: ' + (m ? m[2] + ' dB RMS over ' + m[1] + ' orders (Python: 10.5 dB)' : 'no RMS'));
    const tl = t.match(/tilts by ([-+−\d.]+) dB per octave/), L = await p.evaluate(() => window.__rec.REC.last);
    ok(tl && L.tilt < 0 && L.tilt > -12 && L.rmsT <= +m[2] && (L.tilt <= -3 ? /falls off faster than the model/.test(t) : /no steady tilt/.test(t)),
       'the difference tilts ' + (L ? L.tilt.toFixed(1) : '?') + ' dB per octave over the orders above the noise (the Python check over orders 2-12: -4.4 at this hold), ' + (L ? L.rmsT.toFixed(1) : '?') + ' dB RMS with it out');
  } else console.log('SKIP: OpenWAM comparison, hold_1980INS.DAT not here');
  // the page: spectrogram, table, export
  const ui = await p.evaluate(() => { const s = [...document.querySelectorAll('#sound-details .sec')].find(x => /Compare a recording/.test(x.innerText)); const cv = document.getElementById('rec-cv');
    return { txt: s.innerText, cv: cv && cv.width > 0, rows: s.querySelectorAll('table tbody tr').length }; });
  ok(ui.cv && /Steady holds/.test(ui.txt) && ui.rows >= 20 && /Above the noise/.test(ui.txt), 'spectrogram drawn, holds listed, an order table with the noise check');
  await p.evaluate(() => { window.__recJson = null; }); await p.click('button[data-rec="save"]').catch(() => {}); await p.waitForTimeout(400);
  const js = await p.evaluate(() => window.__recJson);
  let parsed = null; try { parsed = JSON.parse(js); } catch (e) {}
  ok(parsed && Object.keys(parsed).some(k => /^hold_19\d\d_/.test(k)) && Object.values(parsed)[0].orders_dB_rel, 'Save the order levels writes recording_orders.json-style JSON (' + (parsed ? Object.keys(parsed).join(', ') : 'none') + ')');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: no page overflow');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('failures:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
