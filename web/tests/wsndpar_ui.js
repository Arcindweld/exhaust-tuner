// Sound tab, "Hear each part" with an in-line auger and then a tube bundle on the line after the collector: each is its
// own step, runs in the wave model as parallel paths (wamParPaths, the same as the OpenWAM case), changes the sound,
// and the two differ; a capped auger runs as the spiral alone.   node tests/wsndpar_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(900); await pg.click('#u-met'); await pg.waitForTimeout(200);
  await pg.selectOption('select.wamline[data-k="on"]', '1'); await pg.waitForTimeout(200);
  const steps = async par => { await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400); await pg.selectOption('select.wamline[data-k="par"]', par); await pg.waitForTimeout(250);
    await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(400);
    await pg.fill('#wsnd-rpms', '3000'); await pg.dispatchEvent('#wsnd-rpms', 'change');
    await pg.evaluate(() => { window.__wsndSets = null; }); await pg.click('button[data-wsnd="parts"]'); await pg.waitForFunction(() => window.__wsndSets, null, { timeout: 900000 });
    return pg.evaluate(() => ({ notes: window.__wsnd.WSND.notes.join(' '), sets: window.__wsndSets.map(s => ({ key: s.key, label: s.label, what: s.what, x: s.runs[0] && { err: s.runs[0].err, spl: s.runs[0].spl24 } })) })); };
  const dMax = (a, c) => Math.max(...a.spl.slice(0, 16).map((v, i) => Math.abs(v - c.spl[i])));
  const A = await steps('auger');
  ok(A.sets.map(s => s.key).join().startsWith('open,line,par') && /auger/.test(A.sets[2].what), 'Hear each part with the auger: open, + line, + the auger (' + A.sets[2].what.slice(-90) + ')');
  ok(A.sets.every(s => s.x && !s.x.err && s.x.spl.every(Number.isFinite)) && !/auger/.test(A.notes), 'every step ran, nothing left out (' + (A.notes || 'no notes') + ')');
  console.log('   line  : ' + A.sets[1].x.spl.slice(0, 16).map(v => Math.round(v)).join(' ')); console.log('   auger : ' + A.sets[2].x.spl.slice(0, 16).map(v => Math.round(v)).join(' '));
  const dA = dMax(A.sets[2].x, A.sets[1].x); ok(dA > 3, 'the auger changes the orders by up to ' + dA.toFixed(0) + ' dB');
  const T = await steps('bundle');
  ok(/tube bundle/.test(T.sets[2].what), 'with the tube bundle the step is the bundle');
  const dT = dMax(T.sets[2].x, T.sets[1].x), dAT = dMax(T.sets[2].x, A.sets[2].x);
  ok(dT > 3 && dAT > 3, 'the bundle changes the orders by up to ' + dT.toFixed(0) + ' dB, and differs from the auger by up to ' + dAT.toFixed(0) + ' dB');
  // a reverse-flow can against a straight-through can of the same shell, on the same line (no in-line piece)
  const setv = kv => pg.evaluate(kv => { for (const [id, v] of kv) { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }, kv);
  await setv([['m-dch', '230'], ['m-lch', '400'], ['m-lin', '0'], ['m-lout', '0']]);
  await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(300); await pg.selectOption('select.wamline[data-k="mufKind"]', 'chamber'); await pg.waitForTimeout(200);
  const can = async lay => { await pg.evaluate(l => { const el = document.getElementById('m-chlay'); el.value = l; el.dispatchEvent(new Event('change', { bubbles: true })); }, lay); return steps('none'); };
  const S = await can('through'), R = await can('reverse');
  const muf = X => X.sets.find(s => s.key === 'muf');
  ok(muf(R) && /reverse-flow chamber/.test(muf(R).what) && muf(R).x.spl.every(Number.isFinite) && !/straight-through/.test(R.notes), 'the reverse-flow can runs as itself (' + (muf(R) ? muf(R).what.slice(-60) : 'no muffler step') + ')');
  const dR = muf(R) && muf(S) ? dMax(muf(R).x, muf(S).x) : 0;
  ok(dR > 3, 'reverse flow and straight through sound different with the same shell (up to ' + dR.toFixed(0) + ' dB)');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'wsndpar_ui: ' + fails.length + ' FAIL' : 'wsndpar_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
