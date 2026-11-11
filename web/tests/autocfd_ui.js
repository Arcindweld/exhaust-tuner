// Intake tab, automatic CFD test in the desktop program ("Test automatically" in the Intake CFD section). The program's
// bridge (window.exhaustTunerHost: call(action, data, onEvent) -> Promise, cancel()) is stubbed here: runOpenFOAM sends
// step/progress events like rust/et_host/src/openfoam.rs, answers after a delay with a results.json-shaped result, and
// cancel() makes a running call fail with "Stopped." as the router does. Checks: one run after several quick edits
// (debounce), a newer design stops the running one first (supersede), a design already tested shows its result with no
// run (cache), the switch off cancels a pending run, a failure is shown once and not retried, OpenFOAM missing, the
// manual button and Stop, and the plain web page (no bridge) shows no switch.   node tests/autocfd_ui.js
const { chromium } = require('playwright');
const STUB = () => {
  const S = window.__stub = { calls: [], cancels: 0, delay: 2500, dp: 750, fail: null, pending: [] };
  const results = dp => ({ case: 'stub', solver: 'rhoSimpleFoam', iterations: 812, converged: true, notes: [], mdot_outlet_kg_s: 0.369,
    summary: {}, yPlus: {}, planes: { tract_end: { x_m: 0.88, mdot_kg_s: 0.369, PR_p0_over_ps: 1.012, dp_total_Pa: dp, dp_static_Pa: dp + 1300, K_total_loss: 0.55, Cd_flowbench: 0.8, uniformity_index: 0.95, Mach_bulk: 0.13 } } });
  window.exhaustTunerHost = {
    version: 'stub',
    call(action, data, onEvent) {
      if (action === 'hostInfo') return Promise.resolve({ ok: true, version: 'stub', where: 'program', engines: { openfoam: true, openwam: false } });
      if (action !== 'runOpenFOAM') return Promise.resolve({ ok: false, msg: 'not in the stub' });
      const files = data.files || [], dj = files.find(f => /design\.json$/.test(f.name));
      const call = { name: data.name, at: Date.now(), design: dj ? JSON.parse(dj.text) : null, n: files.length, ended: null };
      S.calls.push(call);
      return new Promise((resolve, reject) => {
        const p = { call, reject, timers: [] }; S.pending.push(p);
        if (S.fail === 'nofoam') { S.pending.splice(S.pending.indexOf(p), 1); call.ended = 'nofoam'; reject(new Error('OpenFOAM is not installed where the program expects it: C:\\stub\\openfoam')); return; }
        const ev = (t, o) => p.timers.push(setTimeout(() => onEvent && onEvent(o), t));
        ev(50, { event: 'step', step: 'blockMesh' }); ev(150, { event: 'step', step: 'snappyHexMesh' }); ev(300, { event: 'step', step: 'rhoSimpleFoam' });
        ev(S.delay * 0.5, { event: 'progress', step: 'rhoSimpleFoam', iteration: 1000, of: 4000, seconds: 3 });
        ev(S.delay * 0.8, { event: 'step', step: 'report' });
        const dp = S.dp, fail = S.fail;
        p.timers.push(setTimeout(() => { S.pending.splice(S.pending.indexOf(p), 1); call.ended = fail || 'ok';
          if (fail === 'mesh') resolve({ ok: false, folder: 'C:\\runs\\x', case: 'C:\\runs\\x\\case', steps: [], msg: 'snappyHexMesh failed: --> FOAM FATAL ERROR: stub' });
          else resolve({ ok: true, folder: 'C:\\runs\\x', case: 'C:\\runs\\x\\case', solver: 'rhoSimpleFoam', iterations: 812, endTime: 4000, steps: [{ step: 'rhoSimpleFoam', seconds: 3, stoppedBy: 'convergence' }], results: results(dp) });
        }, S.delay));
      });
    },
    cancel() { S.cancels++; setTimeout(() => { S.pending.splice(0).forEach(p => { p.timers.forEach(clearTimeout); p.call.ended = 'stopped'; p.reject(new Error('Stopped.')); }); }, 150); }
  };
};
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(STUB);
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  await pg.evaluate(() => { try { localStorage.removeItem('exhaust-autocfd-v1'); localStorage.removeItem('exhaust-autocfd-on'); } catch (e) {} });
  await pg.click('#m-expert'); await pg.waitForTimeout(300);
  const set = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const st = () => pg.evaluate(() => ({ calls: window.__stub.calls.length, cancels: window.__stub.cancels, status: (document.getElementById('cfd-auto') || {}).textContent || '',
    running: !!window.__cfdAuto.state.run, ended: window.__stub.calls.map(c => c.ended) }));
  const wait = ms => pg.waitForTimeout(ms);
  const until = async (f, ms, what) => { const t0 = Date.now(); for (;;) { const s = await st(); if (f(s)) return s; if (Date.now() - t0 > ms) { console.log('   timed out waiting for ' + what + ': ' + JSON.stringify(s)); return s; } await wait(200); } };
  // the owner's LS3 cold-air intake (tests/intake1dcal_ui.js), 3.5 mm rolled lip
  await set('i-eng', 'ls'); await set('i-ind', 'na'); await set('i-type', 'cai'); await set('i-filt', 'cone');
  for (const [id, v] of [['i-disp', '376'], ['i-rpm', '6600'], ['i-ve', '92'], ['i-lt', '34.67'], ['i-dt', '3.646'], ['i-n', '1'], ['i-bends', '2'], ['i-tb', '4.134'],
    ['i-tamb', '77'], ['i-tin', '77'], ['i-bendang', '30, 84'], ['i-bendr', '5']]) await set(id, v);
  await set('i-mouth', 'radius'); await set('i-lipr', String(3.5 / 25.4));
  ok(await pg.$('#cfd-auto-on') !== null && await pg.$eval('#cfd-auto-on', e => e.checked), 'in the program: "Test automatically" is there and on by default');
  ok(await pg.$('button[data-cfd="run"]') !== null && await pg.$('button[data-cfd="stop"]') !== null, 'the Run and Stop buttons are still there');
  let s = await st();
  ok(s.calls === 0 && /stop editing/.test(s.status), 'no run while the inputs are moving; the status says it will test: ' + s.status);
  s = await until(x => x.calls >= 1, 6000, 'the first run');
  ok(s.calls === 1, 'the first design is tested once the inputs have been idle (calls ' + s.calls + ')');
  s = await until(x => x.running && /Testing this intake… \((meshing|solving)/.test(x.status), 3000, 'progress');
  ok(/Testing this intake… \((meshing|solving)/.test(s.status), 'status while running: ' + s.status);
  s = await until(x => /solving, 25%/.test(x.status), 3000, 'percent');
  ok(/solving, 25%/.test(s.status), 'progress from the bridge as a percentage: ' + s.status);
  s = await until(x => !x.running && /^Tested/.test(x.status), 6000, 'the result');
  const est0 = await pg.evaluate(() => window.__cfdAuto.state.cache.values().next().value.est);
  console.log('   ' + s.status);
  ok(/^Tested: pressure drop 3\.0 inH₂O \(0\.75 kPa, 750 Pa\) from the mouth to the tract end\./.test(s.status), 'result in plain numbers: inH2O, kPa and Pa');
  ok(Math.abs(est0 - 769) < 3 && /quick estimate on this tab says 3\.1 inH₂O \(769 Pa\)/.test(s.status) && /2% lower, so the two agree \(within 10%\)/.test(s.status),
    'compared with the tab’s smooth-tube "as a CFD reads it" figure (769 Pa): 2% lower, agree');
  ok(await pg.$eval('#cfd-more', e => e.tagName === 'DETAILS' && !e.open) && await pg.$eval('#cfd-more', e => !!e.querySelector('#cfd-results') && !!e.querySelector('#cfd-msg')),
    'the detailed messages and the results table are kept, collapsed under Details');

  // debounce: four quick edits of the tube length, then idle -> one run, of the last value
  for (const v of ['30', '31', '32', '33']) { await set('i-lt', v); await wait(500); }
  await wait(2000); s = await st();
  ok(s.calls === 1, 'no run 2 s after the last of several quick edits (calls ' + s.calls + ')');
  s = await until(x => x.calls >= 2, 4000, 'the debounced run'); await wait(300); s = await st();
  const lastL = await pg.evaluate(() => { const c = window.__stub.calls[window.__stub.calls.length - 1]; return c.design && c.design.geometry.tube_length_mm; });
  ok(s.calls === 2 && Math.abs(lastL - 33 * 25.4) < 0.01, 'several quick edits -> one run, of the last design (' + lastL + ' mm)');

  // supersede: a newer design while that run is going -> Stop first, then one new run
  await pg.evaluate(() => { window.__stub.delay = 9000; });
  s = await until(x => !x.running, 4000, 'the debounced run to end');
  await set('i-lt', '33.5'); s = await until(x => x.calls >= 3 && x.running, 6000, 'the slow run');
  await wait(1000); await set('i-lt', '34'); await wait(600); await set('i-lt', '34.2');
  s = await until(x => x.cancels >= 1, 6000, 'the stop');
  ok(s.cancels === 1 && /Stopping the test of the earlier design/.test(s.status), 'a newer design stops the running test first: ' + s.status);
  s = await until(x => x.calls >= 4, 3000, 'the new run'); await wait(300); s = await st();
  ok(s.calls === 4 && s.ended[2] === 'stopped', 'then exactly one new run (calls ' + s.calls + ', the old one ' + s.ended[2] + ')');
  const supL = await pg.evaluate(() => window.__stub.calls[3].design.geometry.tube_length_mm);
  ok(Math.abs(supL - 34.2 * 25.4) < 0.01, 'the new run is of the latest design (' + supL + ' mm)');
  await pg.evaluate(() => { window.__stub.delay = 2500; });
  s = await until(x => !x.running, 12000, 'the new run to end');
  ok(/^Tested: /.test(s.status) && !/stopped/i.test(s.status), 'the stopped run is not reported as a failure: ' + s.status.slice(0, 60));

  // cache: back to the first design -> its result at once, no run
  await set('i-lt', '34.67'); await wait(400); s = await st();
  ok(/^Tested before \(same design\): pressure drop 3\.0 inH₂O/.test(s.status), 'back to a design already tested: result shown at once: ' + s.status.slice(0, 70));
  await wait(5000); s = await st();
  ok(s.calls === 4, 'and no rerun (calls ' + s.calls + ')');
  const stored = await pg.evaluate(() => { try { return JSON.parse(localStorage.getItem('exhaust-autocfd-v1')); } catch (e) { return null; } });
  ok(Array.isArray(stored) && stored.length === 3 && stored.every(x => x.h && Number.isFinite(x.dp)), 'summaries kept in localStorage (' + (stored || []).length + ': the 3 finished designs)');

  // the switch off cancels a pending run
  await set('i-lt', '25'); await wait(1000);
  await pg.click('#cfd-auto-on'); await wait(5000); s = await st();
  ok(s.calls === 4 && /Automatic testing is off/.test(s.status), 'switch off cancels the pending run: ' + s.status);
  ok(await pg.evaluate(() => localStorage.getItem('exhaust-autocfd-on')) === '0', 'the switch is remembered per viewer');
  // the manual button still runs with the switch off, and Stop stops it once
  await pg.click('button[data-cfd="run"]'); s = await until(x => x.calls >= 5, 2000, 'the manual run');
  ok(s.calls === 5, 'Run in OpenFOAM on this PC still runs with the switch off');
  await wait(500); await pg.click('button[data-cfd="stop"]');
  s = await until(x => !x.running, 3000, 'the stop');
  ok(s.cancels === 2 && /^Test stopped/.test(s.status), 'Stop stops it and says so in one sentence: ' + s.status);
  await pg.click('#cfd-auto-on'); await wait(5500); s = await st();
  ok(s.calls === 5 && /^Test stopped/.test(s.status), 'switching back on does not rerun a design that was stopped (calls ' + s.calls + ')');

  // a failure is shown once and not retried for that design
  await pg.evaluate(() => { window.__stub.fail = 'mesh'; });
  await set('i-lt', '26'); s = await until(x => x.calls >= 6 && !x.running && x.ended[5], 9000, 'the failing run');
  ok(/^The test could not make a mesh for this intake shape \(snappyHexMesh failed\)/.test(s.status), 'mesh failure in one sentence: ' + s.status);
  await set('i-fd', '7'); await wait(5000); await set('i-lt', '27'); await wait(800); await set('i-lt', '26'); await wait(5000); s = await st();
  ok(s.calls === 6 && /could not make a mesh/.test(s.status), 'no retry of the failed design, even after re-renders and coming back to it (calls ' + s.calls + ')');
  // OpenFOAM missing: said once, and the automatic test stands down
  await pg.evaluate(() => { window.__stub.fail = 'nofoam'; });
  await set('i-lt', '28'); s = await until(x => x.calls >= 7 && !x.running, 7000, 'the no-OpenFOAM call');
  ok(/^OpenFOAM is not installed with this program/.test(s.status), 'OpenFOAM missing: ' + s.status);
  await set('i-lt', '29'); await wait(5500); s = await st();
  ok(s.calls === 7, 'and no more automatic runs after that (calls ' + s.calls + ')');
  ok(!errs.length, 'no page errors in the program ' + errs.join('; '));
  await pg.close();

  // the plain web page: no bridge, no switch, no errors
  const pw = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs2 = []; pw.on('pageerror', e => errs2.push(e.message));
  await pw.goto('file://' + process.cwd() + '/index.html#intake'); await pw.waitForTimeout(900);
  await pw.click('#m-expert'); await pw.evaluate(() => { const el = document.getElementById('i-lt'); el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await pw.waitForTimeout(5000);
  const web = await pw.evaluate(() => ({ sw: !!document.getElementById('cfd-auto-on'), st: !!document.getElementById('cfd-auto'), more: !!document.getElementById('cfd-more'), run: !!document.querySelector('button[data-cfd="run"]'), dl: !!document.getElementById('cfd-dl') }));
  ok(!web.sw && !web.st && !web.more && !web.run && web.dl, 'plain web page: no switch, no status, no Details wrapper, no Run button; the download is there');
  ok(!errs2.length, 'no page errors on the plain web page ' + errs2.join('; '));
  await b.close(); console.log(fails.length ? 'autocfd_ui: ' + fails.length + ' FAIL' : 'autocfd_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
