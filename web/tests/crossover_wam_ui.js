// the Crossover tab's X / H design feeds the OpenWAM line between two collectors (make_wam v10)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html');
  await pg.click('#tab-cross'); await pg.waitForTimeout(300);
  const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const r = await pg.evaluate(() => {
    const out = {};
    const tail = [{ L_mm: 2000, d0_mm: 60.3, d1_mm: 60.3 }, { V_litres: 6 }, { L_mm: 500, d0_mm: 60.3, d1_mm: 60.3 }];
    document.getElementById('x-type').value = 'x'; document.getElementById('x-type').dispatchEvent(new Event('change', { bubbles: true }));
    const H = window.__wamLine, WL = H.W(); out.cl = H.cross();
    WL.xo = 'none'; out.off = window.__wamCrossover({ collectors: [{}, {}] }, tail);
    WL.xo = 'tab';
    out.x = window.__wamCrossover({ collectors: [{}, {}] }, tail);
    out.one = window.__wamCrossover({ collectors: [{}] }, tail);
    // a whole V8 model through the page's writer
    const spec = JSON.parse(JSON.stringify(window.__v8spec || null));
    document.getElementById("x-type").value = 'h'; document.getElementById("x-type").dispatchEvent(new Event('change', { bubbles: true }));
    out.clh = H.cross(); out.h = window.__wamCrossover({ collectors: [{}, {}] }, tail);
    document.getElementById("x-type").value = 'y'; document.getElementById("x-type").dispatchEvent(new Event('change', { bubbles: true }));
    out.y = window.__wamCrossover({ collectors: [{}, {}] }, tail);
    document.getElementById("x-type").value = 'x'; document.getElementById("x-type").dispatchEvent(new Event('change', { bubbles: true }));
    // write a case: a dual-bank V8 spec with the line on
    const col = { segs: [{ L: 0.3, d0: 0.07, d1: 0.07 }], Tw: 650 };
    const sp = { e: { bore: 0.1, stroke: 0.08, rod: 0.15, cr: 10, cd: 0.7, nIn: 1, dIn: 0.05, liftIn: 0.013, nEx: 1, dEx: 0.04, liftEx: 0.013, cam: { ivo: 20, ivc: 60, evo: 60, evc: 20 }, burn: { start: 20, dur: 50 }, afr: 12.8, eta: 0.72 },
      intake: { segs: [{ L: 0.25, d0: 0.045, d1: 0.045 }], Tw: 320 }, exhaust: { segs: [{ L: 0.75, d0: 0.038, d1: 0.038, primary: true }], Tw: 700 },
      opt: { phases: [0, 270, 90, 540, 450, 360, 180, 630], collectors: [Object.assign({ cyls: [0, 1, 2, 3] }, col), Object.assign({ cyls: [4, 5, 6, 7] }, col)] }, n: 8 };
    Object.assign(WL, { on: true, L: 2000, d: 60.3, muf: 6, tail: 500, fix: 'none', par: 'none', xo: 'tab' });
    const wl = H.withLine(sp); out.wlerr = wl.err; out.wlxo = wl.xo;
    if (!wl.err) { const t = H.makeWam(wl.spec, { rpm: 5000, cycles: 10, name: 't' }); out.len = t.length; out.hasX = /X-pipe junction/.test(t); out.spec = wl.spec; }
    out.ui = H.lineUi().includes('Crossover between the two collectors');
    return out;
  });
  ok(r.cl && r.cl.type === 'x' && r.cl.pos > 0, 'the Crossover tab leaves its X design and position (' + (r.cl && Math.round(r.cl.pos)) + ' mm)');
  ok(r.off === null, 'crossover off: nothing changes');
  ok(r.x && !r.x.err && r.x.crossover.type === 'x' && Math.abs(r.x.before[0].L_mm - r.cl.pos) < 1e-6 && Math.abs(r.x.crossover.tails[0][0].L_mm - (2000 - r.cl.pos)) < 1e-6 && r.x.crossover.tails[0].length === 3, 'X: the pipe splits at the tab\'s position, the muffler and tailpipe go after it on both sides');
  ok(r.one && /two collectors/.test(r.one.err), 'one collector: a clear error');
  ok(r.h && !r.h.err && r.h.crossover.type === 'h' && Math.abs(r.h.crossover.tube.L_mm - r.clh.tube) < 1e-6 && Math.abs(r.h.crossover.tube.d_mm - r.clh.dc) < 1e-6, 'H: the balance tube from the tab (' + (r.clh && Math.round(r.clh.tube)) + ' x ' + (r.clh && r.clh.dc.toFixed(1)) + ' mm)');
  ok(r.y && /Y-pipe/.test(r.y.err), 'Y-pipe: refused, it is not a crossover');
  ok(!r.wlerr && r.hasX && /X-pipe/.test(r.wlxo), 'a dual-bank V8 case writes with the X junction (' + (r.wlerr || r.wlxo) + ')');
  ok(r.ui, 'the line panel shows the crossover choice');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  require('fs').writeFileSync(require('os').tmpdir() + '/xo_spec.json', JSON.stringify(r.spec || {}));
  await b.close(); console.log('failures:', fails.length); process.exit(fails.length ? 1 : 0);
})();
