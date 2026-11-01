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
  // load the page the way the program does: wrapped into a full document (doctype) by web/make_palette.py -> app.html
  let pageFile = path.join(ROOT, 'web', 'index.html');
  try {
    const wrapped = path.join(tmp, 'app.html');
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', [path.join(ROOT, 'web', 'make_palette.py'), pageFile, wrapped]);
    pageFile = wrapped;
  } catch (e) { console.log('SKIP: no Python to wrap the page as the program does; testing the bare page (' + String(e.message || e).slice(0, 80) + ')'); }
  await pg.goto(pathToFileURL(pageFile).href);
  await pg.waitForFunction(() => document.documentElement.classList.contains('in-desktop'), null, { timeout: 15000 });
  ok(true, 'page found the program (hostInfo answered)');
  await pg.evaluate(() => { document.body.classList.add('expert'); location.hash = 'four-stroke'; }); await pg.waitForTimeout(800);
  ok(await pg.$('button[data-wam="run"]') !== null, 'Run in OpenWAM button shown in the program');

  // the program's menu lives in the page's top bar now (the window has no menu bar): engines, runs folder, add-in status
  ok(await pg.isVisible('#host-btn'), 'program menu button shown in the program');
  await pg.click('#host-btn'); await pg.waitForTimeout(300);
  const eng = await pg.$eval('#hm-eng', e => e.innerText);
  ok(/OpenWAM ready/.test(eng) && /runs/.test(await pg.$eval('#hm-runs', e => e.innerText)), 'menu lists the engines and the runs folder (' + eng.replace(/\s+/g, ' ') + ')');
  await pg.click('[data-hm="status"]'); await pg.waitForFunction(() => /Bundled with this program/.test(document.getElementById('hm-out').textContent), null, { timeout: 15000 });
  ok(/Installed in Fusion: not installed/.test(await pg.$eval('#hm-out', e => e.textContent)), 'Fusion add-in status comes from the program');
  await pg.click('[data-hm="runs"]'); await pg.waitForFunction(() => /^Opened /.test(document.getElementById('hm-out').textContent), null, { timeout: 15000 });
  ok(fs.existsSync(path.join(env.EXHAUST_TUNER_DATA, 'runs')), 'Open the runs folder makes the folder and opens it');
  await pg.keyboard.press('Escape');
  ok(await pg.$eval('#host-menu', e => e.hidden), 'Escape closes the menu');

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
    // wait for the result, printing the page's progress line whenever it changes, and stop at once when the host
    // call itself failed (the page then shows "OpenFOAM did not run" and never sets __cfdRunLast)
    let lastMsg = '';
    for (;;) {
      const st = await pg.evaluate(() => ({ done: !!window.__cfdRunLast, msg: (document.getElementById('cfd-msg') || {}).textContent || '' }));
      if (st.msg !== lastMsg) { console.log('  [' + Math.round((Date.now() - t1) / 1000) + ' s] ' + st.msg.slice(0, 200)); lastMsg = st.msg; }
      if (st.done) break;
      if (/did not run/.test(st.msg)) throw new Error('OpenFOAM host call failed: ' + st.msg);
      if (Date.now() - t1 > 30 * 60 * 1000) throw new Error('OpenFOAM run not finished after 30 min; last message: ' + st.msg);
      await pg.waitForTimeout(20000);
    }
    await pg.waitForTimeout(500);
    const c = await pg.evaluate(() => ({ run: window.__cfdRunLast, rows: window.__cfdResults || [], msg: (document.getElementById('cfd-msg') || {}).textContent || '',
      table: !!document.getElementById('cfd-results') }));
    ok(c.run.ok, 'OpenFOAM run ok in ' + Math.round((Date.now() - t1) / 1000) + ' s: ' + (c.run.msg || c.run.solver + ', ' + c.run.iterations + ' iterations'));
    const row = c.rows[c.rows.length - 1] || {}, te = (row.rows || []).find(q => q.plane === 'tract_end') || {};
    ok(!row.err && Number.isFinite(te.K) && Number.isFinite(te.Cd) && c.table, 'CFD results in the page table: K ' + te.K + ', Cd ' + te.Cd);
    const disk = JSON.parse(fs.readFileSync(path.join(c.run.case, 'results.json'), 'utf8'));
    ok(disk.planes.tract_end.K_total_loss === te.K, 'page reads the results.json OpenFOAM wrote');
    ok(/iterations in \d+ s/.test(c.msg), 'message: ' + c.msg.slice(0, 160));
    // an exhaust part from an STL (3-D: generator + snappyHexMesh + solver), only when asked: it takes minutes
    if (process.env.EXHAUST_TUNER_TEST_EXH === '1') {
      const stl = path.join(tmp, 'tip.stl');
      execFileSync('python3', ['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import run_validation as rv; '
        + 'rv.tube_stl(sys.argv[2], [("line", 60.0, 38.0, 38.0), ("line", 400.0, 50.0, 50.0)])', path.join(ROOT, 'cfd', 'validation'), stl]);
      await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(800);
      await pg.selectOption('select.exhx[data-k="part"]', 'tip'); await pg.waitForTimeout(300);
      await pg.selectOption('select.exhx[data-k="share"]', 'half'); await pg.waitForTimeout(300);   // one bank's flow through a 76 mm tip
      await pg.selectOption('select.exhx[data-k="mesh"]', 'coarse'); await pg.waitForTimeout(300);
      ok(await pg.$('button[data-exh="run"]') !== null && await pg.$('#exh-stl') !== null, 'exhaust CFD: STL picker and run button shown');
      await pg.setInputFiles('#exh-stl', stl); await pg.waitForTimeout(1500);
      const picked = await pg.evaluate(() => (window.__exh.ui.stl || []).map(f => f.name + ' ' + f.solids.join('/')));
      ok(picked.length === 1 && /inlet/.test(picked[0]) && /outlet/.test(picked[0]), 'STL picked and read: ' + picked.join(', '));
      const t2 = Date.now();
      await pg.click('button[data-exh="run"]');
      await pg.waitForFunction(() => window.__exhRunLast, null, { timeout: 60 * 60 * 1000 }); await pg.waitForTimeout(500);
      const x = await pg.evaluate(() => ({ run: window.__exhRunLast, rows: window.__exhResults || [], msg: (document.getElementById('exh-msg') || {}).textContent || '' }));
      ok(x.run.ok, 'exhaust OpenFOAM run ok in ' + Math.round((Date.now() - t2) / 1000) + ' s: ' + (x.run.msg || x.run.solver + ', ' + x.run.iterations + ' iterations') +
        ' (' + (x.run.steps || []).map(st => st.step + ' ' + st.seconds + ' s').join(', ') + ')');
      const row = x.rows[x.rows.length - 1] || {};
      ok(!row.err && Number.isFinite(row.K), 'exhaust results in the page: K ' + row.K + ', ' + (row.mdot * 1000).toFixed(1) + ' g/s');
      ok(/iterations in \d+ s/.test(x.msg), 'message: ' + x.msg.slice(0, 160));
    }
  } else console.log('  (EXHAUST_TUNER_OPENFOAM not set: OpenFOAM part not exercised)');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  host.stdin.end(); await b.close();
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
