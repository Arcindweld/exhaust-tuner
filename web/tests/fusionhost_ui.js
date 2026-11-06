// The Fusion panel runs OpenWAM itself: the page talks to the add-in's hostrun.py (here through a stand-in for
// Fusion's bridge, fusion-addin/tests/hostrun_bridge.py, with the real OpenWAM build; "skipped" without it), so
// "Run in OpenWAM on this PC" shows in the panel, the results land in the tables and the Sound tab with no files saved
// or loaded, the file pickers fold away, and the desktop program's menu stays hidden.   node tests/fusionhost_ui.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const EXE = process.env.EXHAUST_TUNER_OPENWAM || path.resolve(__dirname, '../../ext/OpenWAM/build/bin/release/OpenWAM');
(async () => {
  if (!fs.existsSync(EXE)) { console.log('fusionhost_ui: skipped (no OpenWAM build at ' + EXE + ')'); process.exit(0); }
  const py = spawn('python3', [path.resolve(__dirname, '../../fusion-addin/tests/hostrun_bridge.py')], { env: Object.assign({}, process.env, { EXHAUST_TUNER_OPENWAM: EXE, HOME: fs.mkdtempSync('/tmp/fh_') }) });
  let seq = 0, buf = ''; const wait = {}; let pg = null; const events = [];
  py.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch (e) { continue; }
    if (m.seq != null && wait[m.seq]) { wait[m.seq](m.reply); delete wait[m.seq]; }
    else if (m.kind && pg) { events.push(m.kind); pg.evaluate(([k, p]) => window.fusionJavaScriptHandler.handle(k, p), [m.kind, m.payload]).catch(() => {}); } } });
  py.stderr.on('data', d => process.stderr.write(d));
  const ask = (action, data) => new Promise(r => { const s = ++seq; wait[s] = r; py.stdin.write(JSON.stringify({ seq: s, action, data }) + '\n'); });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeFunction('__fsend', async (action, json) => {
    if (/^host/.test(action)) return JSON.stringify(await ask(action, JSON.parse(json || '{}')));
    return JSON.stringify({ ok: true });
  });
  await ctx.addInitScript(() => { window.adsk = { fusionSendData: (a, j) => window.__fsend(a, j) }; });
  pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(1500);
  const info = await pg.evaluate(() => ({ fusion: window.__fhost && window.__fhost.info(), desk: document.documentElement.classList.contains('in-desktop') }));
  ok(info.fusion && info.fusion.where === 'fusion' && info.fusion.engines.openwam, 'the panel found OpenWAM through the add-in (' + (info.fusion && info.fusion.openwam) + ')');
  ok(!info.desk, 'the desktop program’s menu stays hidden in Fusion');
  await pg.evaluate(() => { const c = document.querySelector('input.wamx[data-k="cycles"]'); c.value = '8'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(300);
  const ui = await pg.evaluate(() => ({ run: !!document.querySelector('button[data-wam="run"]'), fold: !!document.querySelector('details.files-else #wam-files') && !!document.querySelector('details.files-else #wam-ins') }));
  ok(ui.run, '“Run in OpenWAM on this PC” shows in the Fusion panel');
  ok(ui.fold, 'the AVG / INS file pickers are folded away under “a run done elsewhere”');
  await pg.evaluate(() => { window.__wamResults = null; }); await pg.click('button[data-wam="run"]');
  await pg.waitForFunction(() => window.__wamResults && window.__wamResults.length, null, { timeout: 900000 });
  const r = await pg.evaluate(() => ({ res: window.__wamResults.map(x => ({ name: x.name, rpm: x.rpm, tq: x.tq, err: x.err })), ins: window.__wamIns().filter(x => x.src !== 'wave').map(x => ({ rpm: x.rpm, err: x.err, n: (x.spl24 || []).length })), msg: document.querySelector('.wammsg') && document.querySelector('.wammsg').textContent }));
  ok(r.res.length >= 2 && r.res.every(x => !x.err && x.tq > 0), 'OpenWAM’s results are in the table (' + r.res.map(x => Math.round(x.rpm) + ' rpm ' + Math.round(x.tq) + ' N·m').join(', ') + ')');
  ok(r.ins.length === r.res.length && r.ins.every(x => !x.err && x.n === 24), 'every run’s outflow orders are in the Sound tab’s list (' + r.ins.length + ')');
  ok(/finished/.test(r.msg || ''), 'the message says the models finished (' + (r.msg || '').slice(0, 90) + ')');
  ok(events.includes('hostEvent') && events.includes('hostDone'), 'progress and the end came back as panel messages');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); py.kill(); console.log(fails.length ? 'fusionhost_ui: ' + fails.length + ' FAIL' : 'fusionhost_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
