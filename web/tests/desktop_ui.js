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
  // Engine Simulator clips, when the headless runner is available (EXHAUST_TUNER_ENGINESIM)
  if (process.env.EXHAUST_TUNER_ENGINESIM) {
    await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(500);
    ok(await pg.$('button[data-es="listen"]') !== null, 'Listen on this PC button shown');
    await pg.fill('input.esrpms', '2500'); await pg.dispatchEvent('input.esrpms', 'input');
    await pg.click('button[data-es="listen"]');
    await pg.waitForFunction(() => window.__esRunLast, null, { timeout: 10 * 60 * 1000 }); await pg.waitForTimeout(500);
    const es = await pg.evaluate(async () => {
      const a = document.querySelector('.esclips audio'); if (!a) return { n: 0 };
      await new Promise(r => { a.preload = 'metadata'; a.onloadedmetadata = r; a.onerror = r; a.load(); setTimeout(r, 5000); });
      return { n: document.querySelectorAll('.esclips audio').length, dur: a.duration, label: document.querySelector('.esclips .cap').textContent, holds: window.__esRunLast.holds.map(h => [h.rpm, h.ok]) };
    });
    ok(es.n === 1 && es.dur > 3, 'Engine Simulator clip plays in the page: ' + JSON.stringify(es));
  } else console.log('  (EXHAUST_TUNER_ENGINESIM not set: Engine Simulator part not exercised)');
  // the intake CFD case with the bundled OpenFOAM, when there is one (EXHAUST_TUNER_OPENFOAM)
  if (process.env.EXHAUST_TUNER_OPENFOAM) {
    await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(800);
    await pg.click('#m-expert'); await pg.waitForTimeout(300);
    ok(await pg.$('button[data-cfd="run"]') !== null, 'Run in OpenFOAM button shown');
    // straight tube with an elliptical bellmouth: the axisymmetric case (the default two bends make a 3-D case)
    await pg.fill('#i-bends', '0'); await pg.selectOption('#i-mouth', 'ellipse'); await pg.waitForTimeout(300);
    await pg.selectOption('select.cfdx[data-k="mesh"]', 'coarse'); await pg.waitForTimeout(400);
    const t1 = Date.now();
    await pg.click('button[data-cfd="run"]');
    await pg.waitForFunction(() => window.__cfdRunLast, null, { timeout: 30 * 60 * 1000 }); await pg.waitForTimeout(500);
    const c = await pg.evaluate(() => ({ run: window.__cfdRunLast, rows: window.__cfdResults || [], msg: (document.getElementById('cfd-msg') || {}).textContent || '',
      table: !!document.getElementById('cfd-results') }));
    ok(c.run.ok, 'OpenFOAM run ok in ' + Math.round((Date.now() - t1) / 1000) + ' s: ' + (c.run.msg || c.run.solver + ', ' + c.run.iterations + ' iterations'));
    const row = c.rows[c.rows.length - 1] || {}, te = (row.rows || []).find(q => q.plane === 'tract_end') || {};
    ok(!row.err && Number.isFinite(te.K) && Number.isFinite(te.Cd) && c.table, 'CFD results in the page table: K ' + te.K + ', Cd ' + te.Cd);
    const disk = JSON.parse(fs.readFileSync(path.join(c.run.case, 'results.json'), 'utf8'));
    ok(disk.planes.tract_end.K_total_loss === te.K, 'page reads the results.json OpenFOAM wrote');
    ok(/iterations in \d+ s/.test(c.msg), 'message: ' + c.msg.slice(0, 160));
  } else console.log('  (EXHAUST_TUNER_OPENFOAM not set: OpenFOAM part not exercised)');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  host.stdin.end(); await b.close();
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
