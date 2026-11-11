// The Fusion panel runs OpenWAM itself: the page talks to the add-in's hostrun.py (here through a stand-in for
// Fusion's bridge, fusion-addin/tests/hostrun_bridge.py, with the real OpenWAM build; "skipped" without it), so
// "Run in OpenWAM on this PC" shows in the panel, the results land in the tables and the Sound tab with no files saved
// or loaded, the file pickers fold away, the desktop program’s menu stays hidden, and with a 2-Stroke and a 4-Stroke
// run going at once each Stop ends only its own run (hostCancel with its id).   node tests/fusionhost_ui.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const EXE = process.env.EXHAUST_TUNER_OPENWAM || path.resolve(__dirname, '../../ext/OpenWAM/build/bin/release/OpenWAM');
(async () => {
  if (!fs.existsSync(EXE)) { console.log('fusionhost_ui: skipped (no OpenWAM build at ' + EXE + ')'); process.exit(0); }
  const py = spawn('python3', [path.resolve(__dirname, '../../fusion-addin/tests/hostrun_bridge.py')], { env: Object.assign({}, process.env, { EXHAUST_TUNER_OPENWAM: EXE, HOME: fs.mkdtempSync('/tmp/fh_') }) });
  let seq = 0, buf = ''; const wait = {}; let pg = null; const events = [], cancels = [], calls = [], dones = [];
  py.stdout.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch (e) { continue; }
    if (m.seq != null && wait[m.seq]) { wait[m.seq](m.reply); delete wait[m.seq]; }
    else if (m.kind && pg) { events.push(m.kind); if (m.kind === 'hostDone') dones.push(JSON.parse(m.payload)); pg.evaluate(([k, p]) => window.fusionJavaScriptHandler.handle(k, p), [m.kind, m.payload]).catch(() => {}); } } });
  py.stderr.on('data', d => process.stderr.write(d));
  const ask = (action, data) => new Promise(r => { const s = ++seq; wait[s] = r; py.stdin.write(JSON.stringify({ seq: s, action, data }) + '\n'); });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.exposeFunction('__fsend', async (action, json) => {
    if (action === 'hostCancel') cancels.push(JSON.parse(json || '{}'));
    if (action === 'hostCall') { const q = JSON.parse(json || '{}'); calls.push({ id: q.id, name: q.data && q.data.name }); }
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
  // Stop per run: a 2-Stroke run and a 4-Stroke run at once; the 4-Stroke Stop ends only its own (hostCancel with its
  // id), then the 2-Stroke Stop ends the other
  await pg.evaluate(() => { location.hash = 'two-stroke'; }); await pg.waitForTimeout(600);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await setv('t-shape', 'spec');
  for (const [id, v] of [['t-rpm', 11500], ['t-ed', 194], ['t-bore', 54], ['t-stroke', 54.5], ['t-cyl', 1], ['t-hp', 38], ['t-td', 130], ['t-pw', 38], ['t-port', 0]]) await setv(id, v);
  await setv('t-pshape', 'round'); await pg.waitForTimeout(300);
  const fill = { rod: 110, crt: 8.8, ccr: 1.4, afr: 12.5, ign: 20, burn: 50, exw: 39, exrt: 6, exrb: 3, excd: 0.7, trw: 62, trL: 75, trd: 34, trcd: 0.65, carb: 38, inL: 250, pet: 4, petL: 38, petW: 24, petT: 0.45, blk: 2600 };
  for (const [k, v] of Object.entries(fill)) await pg.evaluate(([k, v]) => { const el = document.querySelector('input.twam[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
  await pg.evaluate(() => { const c = document.querySelector('input.twx[data-k="cycles"]'); c.value = '400'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.click('button[data-tw="run"]'); await pg.waitForTimeout(800);
  await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(600);
  await pg.evaluate(() => { const c = document.querySelector('input.wamx[data-k="cycles"]'); c.value = '400'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  await pg.waitForTimeout(300); await pg.click('button[data-wam="run"]'); await pg.waitForTimeout(1500);
  const tw = calls.find(c => c.name === 'twostroke'), fw = calls[calls.length - 1];
  const doneOf = id => dones.find(d => d.id === id);
  ok(calls.length >= 3 && tw && fw && tw.id !== fw.id && !doneOf(tw.id) && !doneOf(fw.id), 'two runs going at once (' + [tw, fw].map(c => c && c.name).join(', ') + ')');
  cancels.length = 0; await pg.click('button[data-wam="stop"]');
  for (let k = 0; k < 100 && !doneOf(fw.id); k++) await pg.waitForTimeout(200);
  await pg.waitForTimeout(1000);
  ok(cancels.length === 1 && cancels[0].id === fw.id && /Stopped/.test((doneOf(fw.id) || {}).msg || ''), 'the 4-Stroke Stop ends its run, by id (' + JSON.stringify(cancels) + ')');
  ok(!doneOf(tw.id), 'the 2-Stroke run keeps going');
  await pg.evaluate(() => { location.hash = 'two-stroke'; }); await pg.waitForTimeout(600);
  await pg.click('button[data-tw="stop"]');
  for (let k = 0; k < 100 && !doneOf(tw.id); k++) await pg.waitForTimeout(200);
  ok(cancels.length === 2 && cancels[1].id === tw.id && /Stopped/.test((doneOf(tw.id) || {}).msg || ''), 'and the 2-Stroke Stop ends that one, by id');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); py.kill(); console.log(fails.length ? 'fusionhost_ui: ' + fails.length + ' FAIL' : 'fusionhost_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
