// Updates inside the desktop program, end to end on any OS: the real page and its program menu, the real injected
// bridge, the real request handling (exhaust-tuner-host, the same C# code the Windows program uses, Updater.cs) and a
// stand-in for api.github.com that serves one release with an installer and SHA256SUMS.txt and redirects downloads to
// a second path like GitHub's storage host. The installer is not started: EXHAUST_TUNER_UPDATE_DRYRUN=1 makes the host
// print the command it would run. Needs a dotnet-built app/ExhaustTuner.HostCli (HOST_CLI to override); without it the
// test says so and exits 0, unless REQUIRE_ALL=1.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const http = require('http'), crypto = require('crypto');
const fs = require('fs'), path = require('path'), os = require('os'), { pathToFileURL } = require('url');
const ROOT = path.resolve(__dirname, '..', '..');
const CLI = process.env.HOST_CLI || path.join(ROOT, 'app', 'ExhaustTuner.HostCli', 'bin', 'Release', 'net8.0', process.platform === 'win32' ? 'exhaust-tuner-host.exe' : 'exhaust-tuner-host');
const TOKEN = 'github_pat_11TESTTOKEN0000000000_abcdefghijklmnopqrstuvwxyz0123456789';
(async () => {
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  if (!fs.existsSync(CLI)) {
    console.log('update_ui: host program not built (' + CLI + ')');
    if (process.env.REQUIRE_ALL === '1') { console.log('FAIL required'); process.exit(1); }
    console.log('skipped'); process.exit(0);
  }
  // ---- the stand-in GitHub: one release, v0.1.999, with the installer and its checksum
  const setup = Buffer.from('MZ pretend installer ' + 'x'.repeat(200000));
  const setupName = 'ExhaustTuner-Setup-0.1.999.exe';
  const sums = crypto.createHash('sha256').update(setup).digest('hex') + '  ' + setupName + '\n';
  const seen = [];
  const srv = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization || null });
    const base = 'http://127.0.0.1:' + srv.address().port;
    if (req.url === '/repos/owner/repo/releases?per_page=20') {
      if (req.headers.authorization !== 'Bearer ' + TOKEN) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"message":"Bad credentials"}'); return; }
      const asset = (id, name, size) => ({ id, name, size, url: base + '/repos/owner/repo/releases/assets/' + id });
      const exp = new Date(Date.now() + 5.5 * 86400e3).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
      res.writeHead(200, { 'Content-Type': 'application/json', 'GitHub-Authentication-Token-Expiration': exp });
      res.end(JSON.stringify([{ tag_name: 'v0.1.999', name: 'Exhaust Tuner 0.1.999', draft: false, prerelease: false, published_at: '2026-11-01T20:00:00Z',
        html_url: 'https://github.com/owner/repo/releases/tag/v0.1.999', body: 'Changes since v0.1.998:\n- Updates: the program checks its releases',
        assets: [asset(1, setupName, setup.length), asset(2, 'SHA256SUMS.txt', sums.length)] }]));
      return;
    }
    const m = req.url.match(/^\/repos\/owner\/repo\/releases\/assets\/(\d)$/);
    if (m) { res.writeHead(302, { Location: base + '/storage/' + m[1] + '?sig=abc' }); res.end(); return; }
    if (req.url.startsWith('/storage/1')) { res.writeHead(200, { 'Content-Length': setup.length }); res.end(setup); return; }
    if (req.url.startsWith('/storage/2')) { res.writeHead(200); res.end(sums); return; }
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));

  // ---- the program's host, installed copy (unins000.exe in its folder), solvers absent
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'et-upd-'));
  const appRoot = path.join(tmp, 'app'); fs.mkdirSync(appRoot); fs.writeFileSync(path.join(appRoot, 'unins000.exe'), '');
  const env = Object.assign({}, process.env, { EXHAUST_TUNER_APPROOT: appRoot, EXHAUST_TUNER_DATA: path.join(tmp, 'data'),
    EXHAUST_TUNER_FUSION_ADDINS: path.join(tmp, 'fusion'), EXHAUST_TUNER_UPDATE_API: 'http://127.0.0.1:' + srv.address().port,
    EXHAUST_TUNER_UPDATE_REPO: 'owner/repo', EXHAUST_TUNER_UPDATE_DRYRUN: '1' });
  const bridge = execFileSync(CLI, ['--bridge'], { env }).toString();
  const host = spawn(CLI, [], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let hostErr = ''; host.stderr.on('data', d => { hostErr += d.toString(); });
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  let current = host;            // the second phase swaps in a new host process (a start after an update)
  await pg.exposeBinding('__toHost', (_src, json) => { current.stdin.write(json + '\n'); });
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
  const txt = id => pg.$eval('#' + id, e => e.textContent);
  const until = (fn, arg, ms = 15000) => pg.waitForFunction(fn, arg, { timeout: ms });

  // not set up: the menu says so and the Updates section asks for a token
  await pg.click('#host-btn');
  await until(() => /not set up/.test(document.getElementById('hm-updline').textContent));
  ok(true, 'menu line: ' + await txt('hm-updline'));
  await pg.click('[data-hm="update"]');
  ok(await pg.isVisible('#hm-upd-tokbox') && await pg.isVisible('#hm-upd-save'), 'Updates opens the token box');
  ok(/Only select repositories/.test(await txt('hm-upd-tokbox')) && /Developer settings/.test(await txt('hm-upd-tokbox')), 'the box says how to make a read-only token');
  const link = new URL(await pg.$eval('#hm-upd-toklink', a => a.href));
  ok(link.origin + link.pathname === 'https://github.com/settings/personal-access-tokens/new' && link.searchParams.get('target_name') === 'owner' &&
     link.searchParams.get('contents') === 'read' && link.searchParams.get('expires_in') === '366' && link.searchParams.get('name').length <= 40,
     'the token link opens GitHub\'s form filled in: ' + link.search.slice(0, 120));

  // a malformed token is refused by the program; a token GitHub refuses is reported
  await pg.fill('#hm-upd-tok', 'abc'); await pg.click('#hm-upd-save');
  await until(() => /does not look like a GitHub token/.test(document.getElementById('hm-upd-msg').textContent));
  ok(true, 'a malformed token is refused before anything is sent');
  await pg.fill('#hm-upd-tok', 'github_pat_11WRONGTOKEN00000000000_zyxwvutsrqponmlkjihgfedcba'); await pg.click('#hm-upd-save');
  await until(() => /did not accept the token/.test(document.getElementById('hm-upd-msg').textContent));
  ok(true, 'a token GitHub refuses: ' + (await txt('hm-upd-msg')).slice(0, 110));
  ok(await pg.isVisible('#hm-upd-tokchange') && !(await pg.isVisible('#hm-upd-tokbox')), 'after saving, the box closes and Change token is offered');

  // the right token: the check finds 0.1.999, downloads it in the background and checks it
  await pg.click('#hm-upd-tokchange');
  await pg.fill('#hm-upd-tok', TOKEN); await pg.press('#hm-upd-tok', 'Enter');
  await until(() => /is ready to install/.test(document.getElementById('hm-updline').textContent), null, 30000);
  ok(true, 'new version found and downloaded: ' + await txt('hm-updline'));
  ok(/downloaded and checked/.test(await txt('hm-upd-msg')) && await pg.isVisible('#hm-upd-install'), 'Restart and update is offered: ' + (await txt('hm-upd-msg')).slice(0, 90));
  ok(/checks its releases/.test(await txt('hm-upd-notes')), 'the release notes are shown');
  ok(/token stops working on \d{4}-\d\d-\d\d \(in 5 days\)/.test(await txt('hm-upd-msg')), 'the token expiry GitHub reports is a warning: ' + (await txt('hm-upd-msg')).replace(/^.*(The GitHub token)/, '$1').slice(0, 90));
  ok(await pg.isVisible('#host-dot') && await pg.isVisible('#hm-badge'), 'the menu button and the Updates item show that an update is ready');
  const dl = path.join(env.EXHAUST_TUNER_DATA, 'updates', setupName);
  ok(fs.existsSync(dl) && fs.readFileSync(dl).equals(setup), 'the installer is in the data folder, byte for byte');
  const api = seen.filter(s => s.url.startsWith('/repos/')), store = seen.filter(s => s.url.startsWith('/storage/'));
  ok(api.length >= 3 && store.length === 2, 'requests: ' + api.length + ' to the API, ' + store.length + ' to the storage host');
  ok(store.every(s => s.auth === null), 'the token never goes to the storage host the downloads are redirected to');
  const tokFile = path.join(env.EXHAUST_TUNER_DATA, 'update-token.bin');
  ok(fs.existsSync(tokFile) && (process.platform !== 'win32' || !fs.readFileSync(tokFile).toString('latin1').includes(TOKEN)),
    'the token is kept in the data folder' + (process.platform === 'win32' ? ', encrypted (DPAPI)' : ''));
  const statusJson = await pg.evaluate(() => window.exhaustTunerHost.call('updateStatus', {}).then(s => JSON.stringify(s)));
  ok(!statusJson.includes(TOKEN), 'the page never gets the token back');

  // the menu reopens on the ready update
  await pg.keyboard.press('Escape'); await pg.click('#host-btn');
  ok(await pg.isVisible('#hm-upd-install'), 'opening the menu again shows the update straight away');

  // install: the program starts the installer silently over itself and closes (here: printed, not started)
  await pg.click('#hm-upd-install');
  await until(() => /^Installing 0\.1\.999/.test(document.getElementById('hm-upd-msg').textContent));
  await pg.waitForTimeout(500);
  const cmd = (hostErr.match(/update installer \(not started\): (.*)/) || [])[1] || '';
  ok(cmd.includes(setupName) && /\/VERYSILENT/.test(cmd) && /\/RELAUNCH=1/.test(cmd) && /\/WAITPID=\d+/.test(cmd) && /\/SUPPRESSMSGBOXES/.test(cmd),
    'the installer command: ' + cmd.replace(/^.*[\\/]/, '').slice(0, 140));
  ok(!/MERGETASKS/.test(cmd), 'no Fusion add-in installed here, so the installer is not asked to add it');
  ok(/quit requested/.test(hostErr), 'the program closes so the installer can replace it');

  // the next start, after the installer ran: the start record held an older version, so the menu shows what changed once
  host.kill();
  fs.writeFileSync(path.join(env.EXHAUST_TUNER_DATA, 'updates', 'ExhaustTuner-Setup-' + (JSON.parse(statusJson).version) + '.exe.notes.txt'), '- the version you now have\n');
  const host2 = spawn(CLI, [], { env: Object.assign({}, env, { EXHAUST_TUNER_UPDATE_PREVIOUS: '0.0.9' }), stdio: ['pipe', 'pipe', 'pipe'] });
  host2.stdout.on('data', d => {
    buf += d.toString(); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (line.trim()) pg.evaluate(m => window.__fromHost(m), JSON.parse(line)).catch(() => {});
    }
  });
  current = host2;
  await pg.reload();
  await pg.waitForFunction(() => document.documentElement.classList.contains('in-desktop'), null, { timeout: 15000 });
  await until(() => !document.getElementById('host-dot').hidden);
  ok(/updated to/i.test(await pg.$eval('#host-btn', e => e.title)), 'after an update the menu button says so: ' + await pg.$eval('#host-btn', e => e.title));
  await pg.click('#host-btn');
  ok(/Updated to version/.test(await txt('hm-updline')) && /the version you now have/.test(await txt('hm-upd-notes')), 'the menu shows what changed in the new version');
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
  ok(await pg.$eval('#host-dot', e => e.hidden), 'once seen, the menu button is plain again');
  await pg.reload();
  await pg.waitForFunction(() => document.documentElement.classList.contains('in-desktop'), null, { timeout: 15000 }); await pg.waitForTimeout(1500);
  ok(await pg.$eval('#host-dot', e => e.hidden), 'and stays so after the page reloads');
  host2.kill();

  // a phone-width window keeps the menu inside the screen
  await pg.setViewportSize({ width: 400, height: 800 }); await pg.waitForTimeout(300);
  const sw = await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok(sw, 'no sideways scroll with the update section open at 400 px');
  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));

  await b.close(); srv.close();
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
