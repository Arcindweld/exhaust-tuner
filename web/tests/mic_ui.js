// Sound tab, "Record with this computer's microphone": Chromium's stand-in microphone is recorded, written to a float
// WAV in the page and read like a picked file (no file saved or loaded); the WAV writer round-trips through the reader;
// a refused microphone says so.   node tests/mic_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => {
  const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#sound'); await pg.waitForTimeout(1200);
  const rt = await pg.evaluate(() => { const R = window.__rec, x = new Float32Array(4800).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 100 * i / 48000));
    const d = R.recWav(R.wavFloat(x, 48000)); let e = 0; for (let i = 0; i < x.length; i++) e = Math.max(e, Math.abs(d.x[i] - x[i])); return { sr: d.sr, n: d.x.length, e }; });
  ok(rt.sr === 48000 && rt.n === 4800 && rt.e < 1e-6, 'the float WAV the page writes reads back exactly (' + rt.n + ' samples, max error ' + rt.e + ')');
  ok(await pg.isVisible('button[data-mic="start"]'), 'the Sound tab offers to record with the microphone');
  await pg.click('button[data-mic="start"]');
  // getUserMedia answers when it answers: on a loaded machine that can be well over half a second
  await pg.waitForFunction(() => window.__rec.MIC.on || window.__rec.MIC.err, null, { timeout: 15000 }).catch(() => {}); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => window.__rec.MIC.on) && await pg.isVisible('button[data-mic="stop"]'), 'recording: a Stop button and a timer');
  await pg.waitForTimeout(4000);
  await pg.click('button[data-mic="stop"]');
  await pg.waitForFunction(() => { const R = window.__rec.REC; return R && !R.busy && (R.info || R.err); }, null, { timeout: 60000 });
  const r = await pg.evaluate(() => { const R = window.__rec.REC; return { name: R.name, err: R.err, info: R.info }; });
  ok(/^Microphone/.test(r.name) && (r.info && r.info.sr >= 44100 && r.info.dur > 3 && r.info.dur < 7 || /engine|speed|orders|shorter/i.test(r.err || '')),
    'the take is read like a loaded WAV (' + r.name + ', ' + (r.info ? r.info.sr + ' Hz, ' + r.info.dur.toFixed(1) + ' s' : r.err) + ')');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  // a refused microphone
  const p2 = await (await b.newContext()).newPage();
  await p2.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })); });
  await p2.goto('file://' + process.cwd() + '/index.html#sound'); await p2.waitForTimeout(1200);
  await p2.click('button[data-mic="start"]'); await p2.waitForTimeout(400);
  ok(/not allowed/.test(await p2.evaluate(() => document.getElementById('sound-details').innerText)), 'a refused microphone says so and offers the WAV instead');
  await b.close(); console.log(fails.length ? 'mic_ui: ' + fails.length + ' FAIL' : 'mic_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
