// 2-Stroke tab, "From the engine", Run it in OpenWAM: the page writes the two-stroke case (wam2t_export.js), a stand-in
// host runs the real OpenWAM on it (EXHAUST_TUNER_OPENWAM or ext/OpenWAM; without it that part is skipped, and counted as a skip), and the page reads the results back: the
// chamber against a straight pipe on the 125 cc MX engine of openwam/tests/test_2t.py.
//   node tests/two_wam_ui.js            (from web/)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const { skipPart, openwam } = require('./skip.js');
const EXE = openwam();

function runOne(dir, name) {
  return new Promise(res => {
    const d = path.join(dir, name); fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(path.join(dir, name + '.wam'), path.join(d, name + '.wam'));
    const t0 = Date.now(), p = spawn(EXE, [name + '.wam'], { cwd: d });
    let log = ''; p.stdout.on('data', x => { log += x; }); p.stderr.on('data', x => { log += x; });
    p.on('close', code => {
      const f = n => fs.existsSync(path.join(d, n)) ? fs.readFileSync(path.join(d, n), 'utf8') : null;
      res({ name, finished: log.includes('SIMULATION FINISHED CORRECTLY'), exitCode: code, seconds: (Date.now() - t0) / 1000, folder: d,
        avg: f(name + 'AVG.DAT'), ins: f(name + 'INS.DAT'), logTail: log.split('\n').slice(-5).join('\n') });
    });
  });
}
(async () => {
  const have = fs.existsSync(EXE);
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const runs = [];
  await ctx.exposeFunction('__runWam', async json => {
    const d = JSON.parse(json), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw_'));
    for (const f of d.files) fs.writeFileSync(path.join(dir, f.name), f.text);
    const names = d.files.filter(f => /\.wam$/.test(f.name)).map(f => f.name.replace(/\.wam$/, ''));
    runs.push({ names, dir });
    const out = [], q = names.slice(), jobs = Math.max(2, Math.min(8, os.cpus().length));
    await Promise.all(Array.from({ length: jobs }, async () => { while (q.length) out.push(await runOne(dir, q.shift())); }));
    return JSON.stringify({ folder: dir, models: out });
  });
  await ctx.addInitScript(() => {
    window.exhaustTunerHost = { call: (a, d, ev) => a === 'hostInfo' ? Promise.resolve({ engines: { openwam: true, openfoam: false, enginesim: false } })
      : a === 'runOpenWAM' ? window.__runWam(JSON.stringify(d)).then(JSON.parse) : Promise.resolve({ ok: true }), cancel() {} };
  });
  const pg = await ctx.newPage();
  const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#two-stroke'); await pg.waitForTimeout(600);
  await pg.click('#u-met');
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await setv('t-shape', 'spec');
  for (const [id, v] of [['t-rpm', 11500], ['t-ed', 194], ['t-bore', 54], ['t-stroke', 54.5], ['t-cyl', 1], ['t-hp', 38], ['t-td', 130], ['t-pw', 38], ['t-port', 0]]) await setv(id, v);
  await setv('t-pshape', 'round');
  await pg.waitForTimeout(300);
  const sec = await pg.evaluate(() => { const h = [...document.querySelectorAll('#two-details .sec h3')].find(x => x.textContent === 'Run it in OpenWAM'); return h ? h.parentElement.innerText : ''; });
  ok(/Run in OpenWAM on this PC/.test(sec) && /Exhaust opens · transfers open/.test(sec), 'the 2-Stroke tab has a Run it in OpenWAM section with a run button');
  // the inputs as test_2t.py's 125: 110 rod, CR 8.8, CCR 1.40, AFR 12.5, ignition 20 / 50, 39 mm exhaust window, 62 mm transfers, 75 x 34 duct, 38 carb 250 long, 4 carbon petals 38 x 24 x 0.45, 2600 mm2 block
  const fill = { rod: 110, crt: 8.8, ccr: 1.4, afr: 12.5, ign: 20, burn: 50, exw: 39, exrt: 6, exrb: 3, excd: 0.7, trw: 62, trL: 75, trd: 34, trcd: 0.65, carb: 38, inL: 250, pet: 4, petL: 38, petW: 24, petT: 0.45, blk: 2600 };
  for (const [k, v] of Object.entries(fill)) await pg.evaluate(([k, v]) => { const el = document.querySelector('input.twam[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
  await pg.evaluate(() => { const el = document.querySelector('input.twx[data-k="rpms"]'); el.value = '9500 11000 12000 13000'; el.dispatchEvent(new Event('input', { bubbles: true }));
    const c = document.querySelector('input.twx[data-k="cycles"]'); c.value = '20'; c.dispatchEvent(new Event('input', { bubbles: true })); });
  const sv = await pg.evaluate(() => { const T = window.__tw, o = JSON.parse(JSON.stringify(T.twSave())); T.twLoad({ v: {} }); const blank = T.TW_UI.v.rod; T.twLoad(o); return { o, blank, rod: T.TW_UI.v.rod, cyc: T.TW_UI.cycles }; });
  ok(sv.o.v.rod === 110 && sv.o.v.blk === 2600 && sv.blank === undefined && sv.rod === 110 && sv.cyc === 20, 'a project keeps the fields and run settings (and loads them back)');
  // the page's spec against test_2t.py's example_125 (its chamber is the page's own design, so the exhaust segs differ)
  const cmp = await pg.evaluate(() => { const L = window.__tw.TW_UI.last, s = window.__tw.twSpec(L.p, L.r).spec; return s; });
  const e = cmp.e, ex = cmp.exhaust_port, tr = cmp.transfers[0], rd = cmp.intake.reed;
  ok(Math.abs(e.rod - 0.110) < 1e-12 && e.cr_trapped === 8.8 && e.ccr === 1.4 && Math.abs(ex.width - 0.039) < 1e-12 && Math.abs(tr.width - 0.062) < 1e-12 && Math.abs(tr.duct.d - 0.034) < 1e-12 &&
     rd.petals === 4 && Math.abs(rd.t - 0.00045) < 1e-12 && Math.abs(rd.A_block - 2600e-6) < 1e-12 && ex.dur === 194 && tr.dur === 130,
    'the fields go into the spec in SI (rod 0.110 m, 39 mm window, 62 mm transfers, 4 petals 0.45 mm, 2600 mm² block)');
  ok(Math.abs(cmp.exhaust.segs.reduce((a, s) => a + s.L, 0) * 1000 - (await pg.evaluate(() => window.__tw.TW_UI.last.r.total))) < 1e-6, 'the exhaust line is the chamber designed above, port face to stinger tip');
  const files = await pg.evaluate(() => { const L = window.__tw.TW_UI.last, o = window.__tw.twFiles(L.p, L.r); return { names: o.files.map(f => f.name), wam: o.files[0].text, models: o.models.length }; });
  ok(files.models === 8 && files.names.includes('run_all.bat') && files.names.includes('README.txt') && files.names.includes('twostroke_straight_13000.wam'), '8 models (4 speeds, chamber and straight), run_all.bat and README');
  ok(/cycle type 1 = two-stroke nm2T/.test(files.wam) && /reed 1-D/.test(files.wam), 'a two-stroke .wam with the reed');
  // the moving reed with a lift stop (our OpenWAM's TLamina model 2): the stop field appears and reaches the .wam
  await pg.evaluate(() => { const s = document.querySelector('select.twsel[data-k="reedModel"]') || [...document.querySelectorAll('#two-details select')].find(x => [...x.options].some(o => o.value === '1d_stop'));
    s.value = '1d_stop'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const el = document.querySelector('input.twam[data-k="stop"]'); el.value = '7.5'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  const fs2 = await pg.evaluate(() => { const L = window.__tw.TW_UI.last, o = window.__tw.twFiles(L.p, L.r); return { wam: o.files[0].text, model: window.__tw.twSpec(L.p, L.r).spec.intake.reed }; });
  ok(fs2.model.model === '1d_stop' && Math.abs(fs2.model.lift_stop - 0.0075) < 1e-12 && /model 2 = 1-D mass-spring-damper with a lift stop/.test(fs2.wam) && /reed 1-D with a 7\.5 mm lift stop/.test(fs2.wam),
    'the moving reed with a 7.5 mm lift stop goes into the .wam as TLamina model 2');
  await pg.evaluate(() => { const s = [...document.querySelectorAll('#two-details select')].find(x => [...x.options].some(o => o.value === '1d_stop')); s.value = '1d'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await pg.waitForTimeout(300);
  if (!have) { skipPart('the OpenWAM runs: no OpenWAM build at ' + EXE + ' (EXHAUST_TUNER_OPENWAM)'); await b.close(); process.exit(fails.length ? 1 : 0); }
  await pg.click('button[data-tw="run"]');
  const t0 = Date.now();
  await pg.waitForFunction(() => window.__twResults && window.__twResults.length, null, { timeout: 1500000 });
  console.log('OpenWAM: ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  await pg.waitForTimeout(400);
  const R = await pg.evaluate(() => window.__twResults.map(x => ({ pipe: x.pipe, rpm: x.rpm, err: x.err, hp: x.s && x.s.P_brake_hp, dr: x.s && x.s.DR, cc: x.s && x.s.crankcase_MEP_bar, fin: x.s && x.s.finished })));
  R.forEach(x => console.log('  ' + x.pipe + ' ' + x.rpm + ': ' + (x.err || x.hp.toFixed(1) + ' hp, DR ' + x.dr.toFixed(2) + ', crankcase ' + x.cc.toFixed(3) + ' bar')));
  ok(R.length === 8 && R.every(x => !x.err && x.fin), 'all 8 runs finished and were read (AVG and INS)');
  const at = (pipe, rpm) => (R.find(x => x.pipe === pipe && x.rpm === rpm) || {}).hp;
  ok(at('chamber', 12000) > 1.3 * at('straight', 12000) && at('chamber', 11000) > 1.3 * at('straight', 11000), 'the chamber makes far more than the straight pipe at 11,000-12,000 (' + at('chamber', 12000).toFixed(1) + ' against ' + at('straight', 12000).toFixed(1) + ' hp at 12,000)');
  ok(R.every(x => x.cc < 0), 'the crankcase pumping work is a loss at every speed');
  const ui = await pg.evaluate(() => { const svg = document.getElementById('tw-svg'); return { lines: svg ? svg.querySelectorAll('polyline').length : 0, figs: document.querySelector('#two-details .sec .figs') ? 1 : 0,
    txt: [...document.querySelectorAll('#two-details .sec h3')].find(x => x.textContent === 'Run it in OpenWAM').parentElement.innerText }; });
  ok(ui.lines === 2 && /Peak power, chamber/.test(ui.txt) && /Delivery ratio/.test(ui.txt), 'power curves for both pipes, the peak and the table on the tab');
  if (process.env.SHOT) { const h = await pg.evaluateHandle(() => [...document.querySelectorAll('#two-details .sec h3')].find(x => x.textContent === 'Run it in OpenWAM').parentElement);
    await h.asElement().screenshot({ path: process.env.SHOT + '_desk.png' }); await pg.setViewportSize({ width: 390, height: 844 }); await pg.waitForTimeout(300);
    const h2 = await pg.evaluateHandle(() => [...document.querySelectorAll('#two-details .sec h3')].find(x => x.textContent === 'Run it in OpenWAM').parentElement);
    await h2.asElement().screenshot({ path: process.env.SHOT + '_phone.png' });
    console.log('page overflow ' + await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)); await pg.setViewportSize({ width: 1280, height: 900 }); }
  // reading the same files back from disk through the file picker gives the same numbers
  const pick = runs[0].names.flatMap(n => [path.join(runs[0].dir, n, n + 'AVG.DAT'), path.join(runs[0].dir, n, n + 'INS.DAT')]).filter(f => fs.existsSync(f));
  await pg.evaluate(() => { window.__twResults = null; });
  await pg.setInputFiles('#tw-files', pick);
  await pg.waitForFunction(() => window.__twResults && window.__twResults.length, null, { timeout: 30000 });
  const R2 = await pg.evaluate(() => window.__twResults.map(x => ({ pipe: x.pipe, rpm: x.rpm, hp: x.s && x.s.P_brake_hp })));
  ok(R2.length === 8 && R2.every(x => Math.abs(x.hp - at(x.pipe, x.rpm)) < 1e-9), 'the files picked from disk read the same');
  // the dual power insert runs as a third set of models
  await setv('t-dual', '1');
  await pg.waitForTimeout(300);
  await pg.evaluate(() => { const el = document.querySelector('input.twx[data-k="rpms"]'); el.value = '10000 12000'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  const f3 = await pg.evaluate(() => { const L = window.__tw.TW_UI.last, o = window.__tw.twFiles(L.p, L.r); return { names: o.files.map(f => f.name), models: o.models.length, wam: (o.files.find(f => /_insert_/.test(f.name)) || {}).text || '' }; });
  ok(f3.models === 6 && f3.names.includes('twostroke_insert_10000.wam') && /dual power insert/.test(f3.wam), 'with the insert: 6 models (chamber, insert, straight at 2 speeds), the insert .wam has the second path');
  await pg.evaluate(() => { window.__twResults = null; });
  await pg.click('button[data-tw="run"]');
  await pg.waitForFunction(() => window.__twResults && window.__twResults.length, null, { timeout: 1500000 });
  await pg.waitForTimeout(400);
  const R3 = await pg.evaluate(() => window.__twResults.map(x => ({ pipe: x.pipe, rpm: x.rpm, err: x.err, hp: x.s && x.s.P_brake_hp, fin: x.s && x.s.finished })));
  R3.forEach(x => console.log('  ' + x.pipe + ' ' + x.rpm + ': ' + (x.err || x.hp.toFixed(1) + ' hp')));
  ok(R3.length === 6 && R3.every(x => !x.err && x.fin), 'all 6 runs with the insert finished');
  const u3 = await pg.evaluate(() => { const svg = document.getElementById('tw-svg'); return { lines: svg ? svg.querySelectorAll('polyline').length : 0, txt: [...document.querySelectorAll('#two-details .sec h3')].find(x => x.textContent === 'Run it in OpenWAM').parentElement.innerText }; });
  ok(u3.lines === 3 && /With the dual power insert/.test(u3.txt) && /second set of models/.test(u3.txt), 'three power curves with the insert line and its caption');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('failures:', fails.length);
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
