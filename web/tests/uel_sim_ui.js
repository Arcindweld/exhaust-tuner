// The 4-Stroke tab's wave simulation runs the Headers tab's unequal-length layout (every cylinder, its own primary,
// the Headers collectors and Y pairs) against the same layout at the equal length, and the "Header to simulate"
// choice is shared with the OpenWAM case. Desk run of the simulation; phone checks the layout.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const p = await (await b.newContext({ viewport: vp })).newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto('file://' + path.join(__dirname, '..', 'index.html')); await p.waitForTimeout(900);
    const set = (id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
    const sec = () => p.evaluate(() => { const h = [...document.querySelectorAll('#four-details .sec h3')].find(x => /Wave simulation/i.test(x.textContent)); return h ? h.parentElement.innerText : ''; });
    await p.evaluate(() => { document.getElementById('u-met').click(); document.body.classList.add('expert'); location.hash = 'headers'; }); await p.waitForTimeout(400);
    // Subaru EJ25-style 4-2-1: Y pairs 1+3 and 2+4, primaries 430/600 mm, secondaries 350/650 mm
    await set('h-eng', 'f4'); await set('h-disp', '2457'); await set('h-grp', 'all'); await set('h-merge', 'triy'); await p.waitForTimeout(150);
    await set('h-pairs', '1,3 | 2,4'); await set('h-lenmode', 'unequal'); await p.waitForTimeout(300);
    for (const [c, v] of [[1, 430], [2, 600], [3, 430], [4, 600]]) await p.fill('#h-len-c' + c, String(v));
    await p.fill('#h-sec-g1', '350'); await p.fill('#h-sec-g2', '650'); await p.waitForTimeout(300);
    // the 4-Stroke tab's engine: 4 cylinders, 2457 cc
    await p.evaluate(() => { location.hash = 'four-stroke'; }); await p.waitForTimeout(400);
    await set('f-disp', '2457'); await set('f-cyl', '4'); await p.waitForTimeout(300);
    let t = await sec();
    ok(await p.$('#sim-src') !== null && await p.$eval('#sim-src', e => e.value) === 'hdr', vp.n + ': "Header to simulate" offered in the wave simulation, Headers layout picked');
    ok(/all 4 cylinders with the Headers tab’s collector and Y pairs/.test(t) && /every primary at the equal length/.test(t), vp.n + ': caption describes the Headers layout and its equal-length twin');
    ok(await p.$eval('#wam-src', e => e.value) === 'hdr', vp.n + ': OpenWAM section shows the same choice');
    ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), vp.n + ': no sideways scroll');
    if (vp.n === 'desk') {
      const t0 = Date.now();
      await p.click('button[data-sim="run"]');
      await p.waitForFunction(() => !document.getElementById('sim-status') && document.getElementById('sim-svg'), null, { timeout: 600000 });
      console.log('  run took', ((Date.now() - t0) / 1000).toFixed(1), 's');
      t = await sec();
      ok(/Lengths as laid out/.test(t) && /Every primary at the equal length/.test(t), 'desk: results compare the two layouts');
      const cyl = (t.match(/Cylinder to cylinder:[^\n]*/) || [''])[0];
      console.log('  ' + cyl.slice(0, 400));
      ok(/cylinder 1 \d+%, 2 \d+%, 3 \d+%, 4 \d+%/.test(cyl) || /within 3%/.test(cyl), 'desk: cylinder-to-cylinder note lists cylinders 1-4 by number');
      ok(!/\bNaN\b|\bundefined\b|Infinity/.test(t), 'desk: no NaN or undefined in the results');
      const st = await p.evaluate(() => window.__sim.state.res.map(o => ({ label: o.label, tq: o.tq.map(x => +x.toFixed(1)), pc: o.pc[6] })));
      console.log('  ' + JSON.stringify(st));
      ok(st.length === 2 && st.every(o => o.tq.every(x => x > 0) && o.pc.length === 4), 'desk: two runs, positive torque, 4 cylinders each');
      // equal-length twin: the Y pairs are the same pair shifted by 360 deg, so cylinders 1 and 2 (and 3 and 4) match
      const eq = st[1].pc;
      ok(Math.abs(eq[0] - eq[1]) / Math.abs(eq[0]) < 0.01 && Math.abs(eq[2] - eq[3]) / Math.abs(eq[2]) < 0.01, 'desk: equal-length twin fills cylinders 1 = 2 and 3 = 4 (symmetry of the pairs)');
      // back to this tab's design: the old variants come back and the OpenWAM choice follows
      await set('sim-src', 'four'); await p.waitForTimeout(400);
      t = await sec();
      ok(/10% shorter and 10% longer/.test(t) && await p.$eval('#wam-src', e => e.value) === 'four', 'desk: "This tab" restores the usual variants and the OpenWAM choice follows');
      ok(/inputs changed since this run/.test(t), 'desk: results from the Headers layout marked stale after switching');
    }
    ok(!errs.length, vp.n + ': no page errors ' + errs.join(' | '));
  }
  await b.close();
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
})();
