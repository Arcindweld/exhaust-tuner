// Sound tab: "Save the last sound (WAV)" writes what was just played as a 16-bit, 48 kHz mono WAV (a download in a
// browser; Fusion's and the program's own file dialogs through saveBase64).   node tests/wsndwav_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(900);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600);
  await pg.fill('#wsnd-rpms', '2500'); await pg.dispatchEvent('#wsnd-rpms', 'change');
  await pg.evaluate(() => { window.__wsndLast = null; }); await pg.click('button[data-wsnd="run"]');
  await pg.waitForFunction(() => window.__wsndLast && !window.__wsnd.WSND.busy, null, { timeout: 600000 });
  ok(await pg.isDisabled('button[data-wsnd="savewav"]'), 'nothing to save before a sound has played');
  await pg.click('button[data-wsnd="playA"]'); await pg.waitForTimeout(1500);
  ok(!(await pg.isDisabled('button[data-wsnd="savewav"]')), 'the save button wakes up once a sound has played');
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 30000 }), pg.click('button[data-wsnd="savewav"]')]);
  const p = await dl.path(), buf = require('fs').readFileSync(p), name = dl.suggestedFilename();
  const tag = o => buf.toString('ascii', o, o + 4);
  ok(/^Exhaust sound .*\.wav$/.test(name), 'the file is named for what it is (' + name + ')');
  ok(tag(0) === 'RIFF' && tag(8) === 'WAVE' && buf.readUInt16LE(20) === 1 && buf.readUInt16LE(22) === 1 && buf.readUInt32LE(24) === 48000 && buf.readUInt16LE(34) === 16, 'a 16-bit PCM, mono, 48 kHz WAV');
  const n = buf.readUInt32LE(40) / 2; let pk = 0; for (let i = 0; i < n; i += 7) pk = Math.max(pk, Math.abs(buf.readInt16LE(44 + 2 * i)));
  ok(n > 48000 && pk > 1000 && pk <= 32767, 'it holds the sound (' + (n / 48000).toFixed(1) + ' s, peak ' + pk + ')');
  const rt = await pg.evaluate(() => { const x = new Float32Array([0, 0.5, -0.5, 1.2, -1.2]); const v = new DataView(window.__wsnd.wavPcm16(x, 48000)); return [1, 2, 3, 4].map(i => v.getInt16(44 + 2 * i, true)); });
  ok(rt.join() === '16384,-16383,32767,-32767', 'samples scale to 16 bits and clip at full scale (' + rt.join(', ') + ')');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'wsndwav_ui: ' + fails.length + ' FAIL' : 'wsndwav_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
