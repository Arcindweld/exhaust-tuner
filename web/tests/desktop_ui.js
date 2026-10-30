// The page inside the desktop program, end to end on any OS: the real page, the real injected bridge
// (HostBridge.js), the real request handling (exhaust-tuner-host, the same C# code the Windows program uses) and the
// real OpenWAM solver. WebView2's message channel is replaced by a shim that carries the same JSON over stdin/stdout.
// Needs: dotnet-built app/ExhaustTuner.HostCli (HOST_CLI to override), an OpenWAM build (EXHAUST_TUNER_OPENWAM).
// Without them the test says so and exits 0, unless REQUIRE_ALL=1.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const CLI = process.env.HOST_CLI || path.join(ROOT, 'app', 'ExhaustTuner.HostCli', 'bin', 'Release', 'net8.0', process.platform === 'win32' ? 'exhaust-tuner-host.exe' : 'exhaust-tuner-host');
(async () => {
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  if (!fs.existsSync(CLI) || !process.env.EXHAUST_TUNER_OPENWAM) {
    console.log('desktop_ui: host program or OpenWAM not available (' + CLI + ', EXHAUST_TUNER_OPENWAM=' + (process.env.EXHAUST_TUNER_OPENWAM || '') + ')');
    if (process.env.REQUIRE_ALL === '1') { console.log('FAIL required'); process.exit(1); }
    console.log('skipped'); process.exit(0);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'et-desk-'));
  const env = Object.assign({}, process.env, { EXHAUST_TUNER_APPROOT: ROOT, EXHAUST_TUNER_DATA: path.join(tmp, 'data'),
    EXHAUST_TUNER_FUSION_ADDINS: path.join(tmp, 'fusion'), EXHAUST_TUNER_PICK_FOLDER: path.join(tmp, 'picked') });
  fs.mkdirSync(env.EXHAUST_TUNER_PICK_FOLDER, { recursive: true });
  const bridge = execFileSync(CLI, ['--bridge'], { env }).toString();
  const host = spawn(CLI, [], { env, stdio: ['pipe', 'pipe', 'inherit'] });
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.exposeBinding('__toHost', (_src, json) => { host.stdin.write(json + '\n'); });
  let buf = '';
  host.stdout.on('data', d => {
    buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.trim()) pg.evaluate(m => window.__fromHost(m), JSON.parse(line)).catch(() => {});
    }
  });
  await pg.addInitScript(() => {
    const ls = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: o => window.__toHost(JSON.stringify(o)), addEventListener: (t, f) => { if (t === 'message') ls.push(f); } };
    window.__fromHost = m => ls.forEach(f => f({ data: m }));
  });
  await pg.addInitScript(bridge);
  await pg.goto(pathToFileURL(path.join(ROOT, 'web', 'index.html')).href);
  await pg.waitForFunction(() => document.documentElement.classList.contains('in-desktop'), null, { timeout: 15000 });
  ok(true, 'page found the program (hostInfo answered)');
  await pg.evaluate(() => { document.body.classList.add('expert'); location.hash = 'four-stroke'; }); await pg.waitForTimeout(800);
  ok(await pg.$('button[data-wam="run"]') !== null, 'Run in OpenWAM button shown in the program');

  // save through the program's folder dialog
  await pg.click('button[data-wam="dl"]'); await pg.waitForTimeout(1500);
  const saved = fs.readdirSync(env.EXHAUST_TUNER_PICK_FOLDER);
  ok(saved.some(f => /\.wam$/.test(f)) && saved.includes('run_all.bat'), 'Download writes the case through the program (' + saved.length + ' files)');

  // run every model with the real solver and read the results back into the page
  const t0 = Date.now();
  await pg.click('button[data-wam="run"]');
  await pg.waitForFunction(() => window.__wamRunLast && (window.__wamResults || []).length > 0, null, { timeout: 30 * 60 * 1000 });
  await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => ({ run: window.__wamRunLast, rows: window.__wamResults, msg: (document.querySelector('.wammsg') || {}).textContent || '' }));
  const ms = r.run.models;
  ok(ms.length >= 1 && ms.every(m => m.finished), 'all ' + ms.length + ' models finished in ' + Math.round((Date.now() - t0) / 1000) + ' s (' + ms.map(m => m.name + ' ' + m.seconds + ' s').join(', ') + ')');
  ok(r.rows.length === ms.length && r.rows.every(x => !x.err && Number.isFinite(x.tq) && Number.isFinite(x.ve)),
    'results read into the page: ' + r.rows.map(x => Math.round(x.rpm) + ' rpm ' + (x.tq != null ? x.tq.toFixed(1) : x.err) + ' N·m').join(', '));
  // the page's reading of the program's output equals its reading of the same files from disk
  const one = ms[0], disk = fs.readFileSync(path.join(one.folder, one.name + 'AVG.DAT'), 'utf8');
  ok(disk === one.avg, 'AVG text returned to the page is the file OpenWAM wrote');
  ok(/All \d+ models finished/.test(r.msg), 'message: ' + r.msg.slice(0, 120));
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  host.stdin.end(); await b.close();
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
