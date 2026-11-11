// Stop per request: an intake CFD Stop or the automatic test's supersede stops only its own OpenFOAM run, not an
// OpenWAM run started on the 2-Stroke tab. The page runs with the program's real bridge (rust/et_host/src/host_bridge.js)
// over a stand-in for WebView2's channel, answered by a stand-in program that keeps requests as the router does
// (cancel {id} stops that request, cancel {} all of them). Then the same with an OLD bridge and program (call() returns
// a plain promise, cancel() only stops everything): the page falls back to that global Stop and still works.
//   node tests/cancelid_ui.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const NEW_BRIDGE = fs.readFileSync(path.join(__dirname, '../../rust/et_host/src/host_bridge.js'), 'utf8').replace('__VERSION__', 'stub');
// the bridge as the programs installed before this change have it (app/ExhaustTuner.Core/HostBridge.js then)
const OLD_BRIDGE = `(function () {
  if (!window.chrome || !window.chrome.webview || window.exhaustTunerHost) return;
  var wv = window.chrome.webview, seq = 0, pending = {}, listeners = {};
  wv.addEventListener('message', function (e) {
    var m = e.data; if (!m || m.id == null) return;
    if (m.event) { var l = listeners[m.id]; if (l) { try { l(m); } catch (err) { console.error(err); } } return; }
    var p = pending[m.id]; if (!p) return;
    delete pending[m.id]; delete listeners[m.id];
    if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error || 'The request failed.'));
  });
  window.exhaustTunerHost = {
    version: 'old',
    call: function (action, data, onEvent) {
      var id = ++seq;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        if (onEvent) listeners[id] = onEvent;
        wv.postMessage({ id: id, action: action, data: data || {} });
      });
    },
    cancel: function () { wv.postMessage({ id: 0, action: 'cancel', data: {} }); }
  };
})();`;
// the stand-in program behind window.chrome.webview; mode 'new' cancels by id as router.rs now does, 'old' stops all
const HOSTSIM = ([mode, bridge]) => {
  const S = window.__stub = { calls: [], cancels: [], delay: 2500, pending: [] }, L = [];
  const send = m => setTimeout(() => L.forEach(f => f({ data: m })), 0);
  const end = (p, why, msg) => { p.timers.forEach(clearTimeout); S.pending.splice(S.pending.indexOf(p), 1); p.call.ended = why; send(msg); };
  const results = { case: 'stub', solver: 'rhoSimpleFoam', iterations: 812, converged: true, notes: [], mdot_outlet_kg_s: 0.369, summary: {}, yPlus: {},
    planes: { tract_end: { x_m: 0.88, mdot_kg_s: 0.369, PR_p0_over_ps: 1.012, dp_total_Pa: 750, dp_static_Pa: 2050, K_total_loss: 0.55, Cd_flowbench: 0.8, uniformity_index: 0.95, Mach_bulk: 0.13 } } };
  window.chrome = { webview: { addEventListener: (t, f) => { if (t === 'message') L.push(f); }, postMessage(m) {
    if (m.action === 'cancel') {
      S.cancels.push(m.data);
      const id = mode === 'new' && m.data && m.data.id != null ? m.data.id : null;
      setTimeout(() => S.pending.filter(p => id == null || p.id === id).forEach(p => end(p, 'stopped', { id: p.id, ok: false, error: 'Stopped.' })), 150);
      return;
    }
    if (m.action === 'hostInfo') { send({ id: m.id, ok: true, result: { app: 'Exhaust Tuner', version: 'stub', engines: { openfoam: true, openwam: true, enginesim: false } } }); return; }
    if (m.action !== 'runOpenWAM' && m.action !== 'runOpenFOAM') { send({ id: m.id, ok: false, error: 'not in the stub' }); return; }
    const call = { id: m.id, action: m.action, ended: null }, p = { id: m.id, call, timers: [] };
    S.calls.push(call); S.pending.push(p);
    if (m.action === 'runOpenWAM') return;   // runs until it is stopped
    const ev = (t, o) => p.timers.push(setTimeout(() => send(Object.assign({ id: m.id }, o)), t));
    ev(50, { event: 'step', step: 'blockMesh' }); ev(300, { event: 'step', step: 'rhoSimpleFoam' });
    ev(S.delay * 0.5, { event: 'progress', step: 'rhoSimpleFoam', iteration: 1000, of: 4000, seconds: 3 });
    p.timers.push(setTimeout(() => end(p, 'ok', { id: m.id, ok: true, result: { ok: true, folder: 'C:\\runs\\x', case: 'C:\\runs\\x\\case', solver: 'rhoSimpleFoam', iterations: 812,
      endTime: 4000, steps: [{ step: 'rhoSimpleFoam', seconds: 3, stoppedBy: 'convergence' }], results } }), S.delay));
  } } };
  (0, eval)(bridge);
};

async function scenario(b, mode, ok) {
  console.log('--- ' + mode + ' bridge');
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(HOSTSIM, [mode, mode === 'new' ? NEW_BRIDGE : OLD_BRIDGE]);
  await pg.goto('file://' + process.cwd() + '/index.html#two-stroke'); await pg.waitForTimeout(800);
  ok(await pg.evaluate(() => !!window.exhaustTunerHost && typeof window.exhaustTunerHost.cancel === 'function'), 'the bridge is there');
  const st = () => pg.evaluate(() => ({ calls: window.__stub.calls.map(c => ({ ...c })), cancels: window.__stub.cancels.slice(), status: (document.getElementById('cfd-auto') || {}).textContent || '',
    running: !!(window.__cfdAuto && window.__cfdAuto.state.run) }));
  const wait = ms => pg.waitForTimeout(ms);
  const until = async (f, ms, what) => { const t0 = Date.now(); for (;;) { const s = await st(); if (f(s)) return s; if (Date.now() - t0 > ms) { console.log('   timed out waiting for ' + what + ': ' + JSON.stringify(s)); return s; } await wait(200); } };
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const press = sel => pg.evaluate(sel => { const [k, v] = sel.split('='), b = document.createElement('button'); b.type = 'button'; b.dataset[k] = v; document.body.appendChild(b); b.click(); b.remove(); }, sel);
  const wams = s => s.calls.filter(c => c.action === 'runOpenWAM'), cfds = s => s.calls.filter(c => c.action === 'runOpenFOAM');

  // an OpenWAM run on the 2-Stroke tab (the inputs of tests/two_wam_ui.js)
  const startWam = async () => {
    await pg.evaluate(() => { location.hash = 'two-stroke'; }); await wait(500);
    await setv('t-shape', 'spec');
    for (const [id, v] of [['t-rpm', 11500], ['t-ed', 194], ['t-bore', 54], ['t-stroke', 54.5], ['t-cyl', 1], ['t-hp', 38], ['t-td', 130], ['t-pw', 38], ['t-port', 0]]) await setv(id, v);
    await setv('t-pshape', 'round'); await wait(300);
    const fill = { rod: 110, crt: 8.8, ccr: 1.4, afr: 12.5, ign: 20, burn: 50, exw: 39, exrt: 6, exrb: 3, excd: 0.7, trw: 62, trL: 75, trd: 34, trcd: 0.65, carb: 38, inL: 250, pet: 4, petL: 38, petW: 24, petT: 0.45, blk: 2600 };
    for (const [k, v] of Object.entries(fill)) await pg.evaluate(([k, v]) => { const el = document.querySelector('input.twam[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
    const n = wams(await st()).length;
    await pg.click('button[data-tw="run"]');
    return until(x => wams(x).length > n, 3000, 'the OpenWAM call');
  };
  await pg.click('#u-met');
  let s = await startWam();
  const wam = wams(s).slice(-1)[0];
  ok(!!wam && wam.ended === null, 'an OpenWAM run is going on the 2-Stroke tab');

  // the Intake tab: the automatic test starts, then a newer design supersedes it
  await pg.evaluate(() => { location.hash = 'intake'; }); await wait(600);
  await pg.click('#m-expert'); await wait(300);
  await pg.evaluate(() => { window.__stub.delay = 9000; });
  await setv('i-eng', 'ls'); await setv('i-ind', 'na'); await setv('i-type', 'cai'); await setv('i-filt', 'cone');
  for (const [id, v] of [['i-disp', '376'], ['i-rpm', '6600'], ['i-ve', '92'], ['i-lt', '34.67'], ['i-dt', '3.646'], ['i-n', '1'], ['i-bends', '2'], ['i-tb', '4.134'],
    ['i-tamb', '77'], ['i-tin', '77'], ['i-bendang', '30, 84'], ['i-bendr', '5']]) await setv(id, v);
  s = await until(x => cfds(x).length >= 1 && x.running, 9000, 'the automatic CFD run');
  ok(cfds(s).length === 1 && s.running, 'the automatic intake test is running alongside');
  const c0 = s.cancels.length;
  await wait(800); await setv('i-lt', '30');
  s = await until(x => x.cancels.length > c0 && cfds(x)[0].ended, 6000, 'the supersede');
  s = await until(x => cfds(x).length >= 2, 8000, 'the new run');
  const cf = cfds(s), w1 = wams(s).find(c => c.id === wam.id);
  ok(cf[0].ended === 'stopped' && cf.length === 2 && /Testing this intake/.test(s.status), 'a newer design stops the running test and starts one new run: ' + s.status);
  if (mode === 'new') {
    ok(s.cancels.length === c0 + 1 && s.cancels[c0].id === cf[0].id, 'the supersede stops only that request (cancel {id: ' + (s.cancels[c0] || {}).id + '})');
    ok(w1.ended === null, 'the OpenWAM run on the other tab keeps going');
  } else {
    ok(s.cancels.length === c0 + 1 && s.cancels[c0].id === undefined, 'old bridge: the supersede falls back to the global Stop');
    ok(w1.ended === 'stopped', 'old bridge: as before, that Stop ends the OpenWAM run too');
  }

  // the CFD Stop button
  const c1 = s.cancels.length;
  await wait(600); await pg.click('button[data-cfd="stop"]');
  s = await until(x => cfds(x)[1].ended && !x.running, 4000, 'the Stop');
  ok(cfds(s)[1].ended === 'stopped' && /^Test stopped/.test(s.status), 'Stop stops the intake test: ' + s.status);
  if (mode === 'new') {
    ok(s.cancels.length === c1 + 1 && s.cancels[c1].id === cfds(s)[1].id && wams(s).find(c => c.id === wam.id).ended === null, 'only that request: the OpenWAM run still keeps going');
    // the 2-Stroke Stop stops the OpenWAM run, by its id
    await press('tw=stop');
    s = await until(x => wams(x).find(c => c.id === wam.id).ended, 3000, 'the OpenWAM Stop');
    ok(wams(s).find(c => c.id === wam.id).ended === 'stopped' && s.cancels.slice(-1)[0].id === wam.id, 'the 2-Stroke Stop stops its OpenWAM run (cancel {id: ' + s.cancels.slice(-1)[0].id + '})');
    // a Stop with nothing of its own running sends nothing (before, it stopped every run)
    s = await startWam(); const w2 = wams(s).slice(-1)[0], c2 = s.cancels.length;
    for (const k of ['exh=stop', 'wam=stop', 'cfd=stop']) await press(k);
    await wait(800); s = await st();
    ok(s.cancels.length === c2 && wams(s).find(c => c.id === w2.id).ended === null, 'Stops of other tabs with nothing of their own running leave the OpenWAM run alone');
    await press('tw=stop'); s = await until(x => wams(x).find(c => c.id === w2.id).ended, 3000, 'the second OpenWAM Stop');
    ok(wams(s).find(c => c.id === w2.id).ended === 'stopped', 'and its own Stop ends it');
  } else {
    ok(s.cancels.length === c1 + 1 && s.cancels[c1].id === undefined, 'old bridge: the Stop button sends the global Stop, as before');
    s = await startWam(); const w2 = wams(s).slice(-1)[0];
    ok(w2.ended === null, 'old bridge: a new OpenWAM run starts');
    await press('tw=stop'); s = await until(x => wams(x).find(c => c.id === w2.id).ended, 3000, 'the OpenWAM Stop');
    ok(wams(s).find(c => c.id === w2.id).ended === 'stopped' && s.cancels.slice(-1)[0].id === undefined, 'old bridge: the 2-Stroke Stop still stops it (global Stop)');
  }
  // the automatic test still works after all that: a new design is tested to a result
  await pg.evaluate(() => { window.__stub.delay = 1500; });
  await pg.evaluate(() => { location.hash = 'intake'; }); await wait(600);
  await setv('i-lt', '31');
  s = await until(x => /^Tested: /.test(x.status), 12000, 'a result');
  ok(/^Tested: pressure drop 3\.0 inH₂O/.test(s.status), 'the automatic test still gives a result: ' + s.status.slice(0, 60));
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await pg.close();
}

(async () => {
  const b = await chromium.launch(); const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  await scenario(b, 'new', ok);
  await scenario(b, 'old', ok);
  await b.close();
  console.log('cancelid_ui: ' + (fails.length ? fails.length + ' FAIL' : 'all pass'));
  process.exit(fails.length ? 1 : 0);
})();
