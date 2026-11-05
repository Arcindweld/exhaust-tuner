// Mufflers tab, Muffler designer, "Check the chambers in OpenWAM": the designer's chambers go into the 4-Stroke tab's
// OpenWAM line, a stand-in host runs the real OpenWAM (ext/OpenWAM; "skipped" without it), and the page scores each
// design against the line with no muffler from the outflow's half orders at 1 m.
//   node tests/mdwam_ui.js            (from web/)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');
const EXE = process.env.EXHAUST_TUNER_OPENWAM || path.resolve(__dirname, '../../ext/OpenWAM/build/bin/release/OpenWAM');

// the desktop host's ins_tail (rust/et_host/src/openwam.rs): the header and the last 4 cycles of an INS.DAT
function insTail(t, keep = 4) {
  if (!t) return t; const L = t.split(/(?<=\n)/), col = L[0].trimEnd().split('\t').indexOf('Angle(deg)'); if (col < 0) return t;
  const st = []; let prev = null; for (let i = 1; i < L.length; i++) { const a = parseFloat(L[i].split('\t')[col]); if (!Number.isFinite(a)) continue; if (prev !== null && a < prev - 180) st.push(i); prev = a; }
  return st.length < keep ? t : L[0] + L.slice(st[st.length - keep]).join('');
}
function runOne(dir, name) {
  return new Promise(res => {
    const d = path.join(dir, name); fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(path.join(dir, name + '.wam'), path.join(d, name + '.wam'));
    const t0 = Date.now(), p = spawn(EXE, [name + '.wam'], { cwd: d });
    let log = ''; p.stdout.on('data', x => { log += x; }); p.stderr.on('data', x => { log += x; });
    p.on('close', code => {
      const f = n => fs.existsSync(path.join(d, n)) ? fs.readFileSync(path.join(d, n), 'utf8') : null;
      res({ name, finished: log.includes('SIMULATION FINISHED CORRECTLY'), exitCode: code, seconds: (Date.now() - t0) / 1000, folder: d,
        avg: f(name + 'AVG.DAT'), ins: insTail(f(name + 'INS.DAT')), logTail: log.split('\n').slice(-5).join('\n') });
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
  const fails = []; pg.on('pageerror', e => fails.push('PAGEERROR ' + e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(800);
  await pg.click('#u-met'); await pg.waitForTimeout(200);
  // MDW_CFG: 'dual' (two collectors), 'xo' (two collectors joined by the Crossover tab's X), '4cyl' (an inline 4, 4-into-1)
  const cfg = process.env.MDW_CFG || '';
  // 'uel': the Headers tab's unequal-length header (two banks on the V8) is what OpenWAM runs
  if (/uel/.test(cfg)) { await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(400); await pg.selectOption('#h-lenmode', 'unequal'); await pg.waitForTimeout(400); await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400); }
  if (/xo/.test(cfg)) { await pg.click('#tab-cross'); await pg.waitForTimeout(300); await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400); }
  if (/4cyl/.test(cfg)) { await pg.fill('#f-cyl', '4'); await pg.fill('#f-disp', '2000'); await pg.dispatchEvent('#f-disp', 'input'); await pg.selectOption('#f-n', '4'); await pg.waitForTimeout(200); }
  if (/dual/.test(cfg)) { await pg.selectOption('#f-n', '4'); await pg.waitForTimeout(200); }
  await pg.selectOption('select.wamline[data-k="on"]', '1'); await pg.waitForTimeout(200);
  if (/xo/.test(cfg)) { await pg.selectOption('select.wamline[data-k="xo"]', 'tab'); await pg.waitForTimeout(200); }
  await pg.evaluate(cy => { const c = document.querySelector('input.wamx[data-k="cycles"]'); c.value = cy; c.dispatchEvent(new Event('input', { bubbles: true })); }, process.env.MDW_CYC || '8');
  await pg.evaluate(() => { location.hash = 'mufflers'; }); await pg.waitForTimeout(400);
  await pg.click('#m-expert'); await pg.waitForTimeout(200);
  await pg.selectOption('select.mdsel', 'chamber'); await pg.waitForTimeout(200);
  await pg.click('#md-run'); await pg.waitForTimeout(500);
  const floor0 = await pg.evaluate(() => window.__mdw.MDW.minCycles); ok(floor0 === 20, 'the check runs at least 20 cycles a run by default (' + floor0 + ')');
  await pg.evaluate(c => { window.__mdw.MDW.minCycles = +c; }, process.env.MDW_CYC || '8');   // the test runs short; the page's floor is 20
  if (process.env.MDW_POCKET || process.env.MDW_NECK) await pg.evaluate(([m, n]) => { if (m) window.__mdw.MDW.pocket = m; if (n) { const [L, d, K] = n.split(',').map(Number); window.__mdw.MDW.pocketNeck = Object.assign({ L }, d > 0 ? { d } : {}, K >= 0 ? { K } : {}); } }, [process.env.MDW_POCKET, process.env.MDW_NECK || '']);
  const pre = await pg.evaluate(() => { const h = [...document.querySelectorAll('.sec h3')].find(x => x.textContent === 'Muffler designer'); return h ? h.parentElement.innerText : ''; });
  ok(/Check the chambers in OpenWAM/.test(pre) && /Run them in OpenWAM/.test(pre), 'the designer offers the OpenWAM check with a run button');
  const dd = await pg.evaluate(() => { const R = window.__md.MD.res, cyl = window.__mdw.cyl(), d = window.__mdw.mdwRpmsDefault({ cyl }, R.fs[0], R.fs[8]); return { cyl, d, x: d.map(r => r * cyl / 2 / 60 / R.fs[0]) }; });
  const dflt = dd.x;
  ok(Math.abs(dflt[0] - 1) < 0.05, 'the default speeds put the firing order (' + dd.cyl + ' cylinders) at the band\'s low end (' + dflt.map(x => x.toFixed(2)).join(', ') + ' of f0)');
  if (!have) { console.log('skipped'); await b.close(); return; }
  // two speeds to keep it short: the band's ends
  const rp = process.env.MDW_RPMS || [dd.d[0], dd.d[dd.d.length - 1]].join(' ');
  await pg.fill('#mdw-rpms', rp); await pg.dispatchEvent('#mdw-rpms', 'change'); await pg.waitForTimeout(200);
  await pg.click('button[data-mdw="run"]');
  await pg.waitForFunction(() => window.__mdwLast || (document.querySelector('.mdwmsg.bad') && !/Running|runs done/.test(document.querySelector('.mdwmsg').textContent)), null, { timeout: +(process.env.MDW_WAIT || 600000) });
  const X = await pg.evaluate(() => window.__mdwLast);
  if (!X) console.log('message: ' + await pg.evaluate(() => (document.querySelector('.mdwmsg') || {}).textContent));
  if (X && process.env.MDW_DUMP) fs.writeFileSync(process.env.MDW_DUMP, JSON.stringify(X));
  ok(X && X.rows.length >= 2, 'the designs ran (' + (X ? X.rows.length : 0) + ' rows)');
  if (X) {
    console.log(JSON.stringify(X.rows.map(r => ({ l: r.label, least: r.least, said: r.d && r.d.min, la: r.la, tq: r.tq, err: r.err }))));
    const b0 = X.rows[0], ds = X.rows.slice(1);
    for (const r of X.rpms) { const B = b0.spl[r]; console.log('rpm', r, 'base', B.slice(0, 16).map(v => v.toFixed(0)).join(' ')); for (const d of ds) console.log('   ', d.spl[r].slice(0, 16).map(v => v.toFixed(0)).join(' ')); }
    ok(Number.isFinite(b0.la) && Number.isFinite(b0.tq), 'the no-muffler line has a level and a torque');
    ok(X.inBand > 0, 'orders land in the band at those speeds (' + X.inBand + ')');
    ok(ds.every(r => Number.isFinite(r.least) && r.least > -30 && r.least < 60), 'each chamber has a finite figure for what it takes off the band');
    const unset = r => Object.values(r.per || {}).some(v => v != null && v > 0.05);
    ok(ds.filter(r => !/extended/.test(r.label)).every(r => Number.isFinite(r.la) && r.la < b0.la), 'every plain chamber lowers the A-weighted sum of the orders');
    ok(ds.filter(r => /extended/.test(r.label)).every(r => r.la < b0.la || unset(r)), 'an extended-tube chamber that comes out louder is flagged as not settled');
    ok(ds.every(r => r.least >= 0 || (r.worst && r.worst.f >= X.f0 - 1 && r.worst.f <= X.f1 + 1 && r.worst.rpm > 0)), 'a chamber that makes the band louder names the order and speed, inside the band');
    const txt = await pg.evaluate(() => { const h = [...document.querySelectorAll('.sec h3')].find(x => x.textContent === 'Muffler designer'); return h.parentElement.innerText; });
    ok(/Least taken off the band \(OpenWAM\)/.test(txt) && /reference/.test(txt) && !/NaN/.test(txt), 'the results table is on the page, no NaN');
    ok(/Done\./.test(txt), 'the message says it is done');
    ok(!ds.some(unset) || /Not settled/.test(txt), 'unsettled runs get the note under the table');
    await pg.setViewportSize({ width: 400, height: 800 }); await pg.waitForTimeout(300);
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(sw <= 0, 'phone width: no sideways scroll with the results table (' + sw + ' px)');
    await pg.evaluate(() => { const h = [...document.querySelectorAll('.sec h3')].find(x => x.textContent === 'Muffler designer'); h.parentElement.querySelector('h4').scrollIntoView(); });
    await pg.screenshot({ path: process.env.SHOT || '/tmp/mdwam_phone.png' });
  }
  await b.close();
  console.log(fails.length ? 'mdwam_ui: ' + fails.length + ' FAIL' : 'mdwam_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
