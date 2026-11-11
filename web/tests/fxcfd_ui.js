// Fusion panel, Intake tab, "Test this intake (CFD)" and "Use this tube in the Intake tab", with the add-in stubbed:
// cfdTube answers with the owner's reference tube as act_cfd_tube reads it (fixtures/fxcfd_tube.json, written from
// fusion-addin/tests/test_intakecfd_fusion_fake.py's run), hostCall runOpenFOAM answers through hostEvent / hostDone /
// hostChunk as hostrun.py does. Checks: the case sent (the tube's geometry, the tab's engine airflow, design.json for the
// 3-D generator, the cache key), the progress line, the result (inH2O, Pa, kPa, K, the tab's 1-D figure for the same
// tube, cells, run time, sizes in inches and mm), a second click answered from the cache with no new run, the mouth
// option, Stop, a refusal, the program not installed, and the tab filled from the tube (its own CFD case then has the
// tube's bends where they are). Then the same tube ending in a 60 mm cone to a 105 mm throttle bore
// (fixtures/fxcfd_tube_cone.json; both fixtures written by ET_WRITE_FIXTURES=1 python3 tests/test_intakecfd_fusion_fake.py):
// its geometry sent unchanged, the loss at the end of the constant tube, at the throttle face and at the tract end, the
// throttle bore filled (the tab's own case then ends its cone at the same throttle face), and a bellmouth or lip read
// setting the tab's mouth.   node tests/fxcfd_ui.js   (from web/)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => { const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html');
  const TUBE = JSON.parse(fs.readFileSync(__dirname + '/fixtures/fxcfd_tube.json', 'utf8'));
  const CONE = JSON.parse(fs.readFileSync(__dirname + '/fixtures/fxcfd_tube_cone.json', 'utf8'));   // the same tube + a 60 mm cone to a 105 mm throttle bore
  const RES = { ok: true, folder: 'C:/runs/20261110-120000_fusion_INTAKE_TUBE_93mm', case: 'C:/runs/20261110-120000_fusion_INTAKE_TUBE_93mm/case', solver: 'rhoSimpleFoam',
    iterations: 1632, endTime: 6000, meshWarning: null, meshNote: null,
    results: { planes: { tract_end: { dp_total_Pa: 1050.4, K_total_loss: 0.834, mdot_kg_s: 0.3691 } } },
    steps: [{ step: 'snappyHexMesh', exitCode: 0, seconds: 50 }, { step: 'rhoSimpleFoam', exitCode: 0, seconds: 640, stoppedBy: 'convergence' }],
    cells: 412345, seconds_total: 702.4, cached: false };
  await pg.evaluate(([TUBE, RES]) => {
    window.__sent = []; window.__runs = 0; window.__foam = true; window.__hold = false; window.__tubeReply = null; window.__pend = null;
    const H = (k, o) => window.fusionJavaScriptHandler.handle(k, JSON.stringify(o));
    window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, d]); let r = { ok: true };
      if (a === 'hostInfo') r = { ok: true, where: 'fusion', engines: { openwam: false, openfoam: window.__foam }, openfoamWhy: window.__foam ? '' : 'NOT INSTALLED SENTENCE' };
      else if (a === 'cfdTube') r = window.__tubeReply || { ok: true, msg: 'read', tube: Object.assign({}, TUBE, window.__tubeOverride || {}) };
      else if (a === 'hostCall') { const q = JSON.parse(d);
        if (q.action === 'runOpenFOAM') { window.__runs++; window.__lastRun = q; const id = q.id; window.__pend = id;
          setTimeout(() => H('hostEvent', { id, ev: { event: 'step', step: 'snappyHexMesh' } }), 40);
          setTimeout(() => { H('hostEvent', { id, ev: { event: 'progress', step: 'rhoSimpleFoam', iteration: 900, of: 6000, seconds: 40 } }); window.__progress = document.getElementById('fxcfd-msg').textContent;
            window.__stopShown = !document.querySelector('#fx-intake button[data-fxcfd="stop"]').hidden; }, 120);
          if (!window.__hold) setTimeout(() => { window.__pend = null; H('hostDone', { id, ok: true, msg: '', size: JSON.stringify(window.__resOverride || RES).length, chunk: 400000 }); }, 250);
          r = { ok: true, started: id }; }
        else r = { ok: true }; }
      else if (a === 'hostChunk') r = { ok: true, text: JSON.stringify(window.__resOverride || RES), last: true };
      else if (a === 'hostCancel') { const id = window.__pend; if (id) setTimeout(() => H('hostDone', { id, ok: false, msg: 'Stopped.', size: 0, chunk: 400000 }), 30); window.__pend = null; }
      return Promise.resolve(JSON.stringify(r)); } };
  }, [TUBE, RES]);
  await pg.waitForTimeout(700);
  await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(500);
  const sentOf = a => pg.evaluate(a => window.__sent.filter(x => x[0] === a).map(x => JSON.parse(x[1] || '{}')), a);
  ok(await pg.$('#fx-intake button[data-fxcfd="test"]') !== null && await pg.$('#fx-intake button[data-fxcfd="fill"]') !== null && await pg.$('#fx-intake select.fxcfdsel') !== null,
     'Intake tab, Fusion section: Test this intake (CFD), Use this tube in the Intake tab, and where the air goes in');
  ok(await pg.$('#fx-headers button[data-fxcfd="test"]') === null, 'not on the Headers tab');

  // ---- the test
  await pg.click('#fx-intake button[data-fxcfd="test"]'); await pg.waitForTimeout(700);
  const tubeCalls = await sentOf('cfdTube');
  ok(tubeCalls.length === 1 && tubeCalls[0].mouth === 'auto', 'the add-in is asked for the tube (mouth: auto, the default)');
  const run = await pg.evaluate(() => window.__lastRun);
  const files = run && run.data && run.data.files || [];
  const dj = files.find(f => f.name === 'design.json'); const design = dj ? JSON.parse(dj.text) : {};
  ok(run && run.action === 'runOpenFOAM' && dj && files.some(f => f.name === 'intake_cfd.py'), 'runOpenFOAM with the 3-D bundle (design.json and the generator) for the program to mesh: ' + files.map(f => f.name).join(', '));
  ok(JSON.stringify(design.geometry) === JSON.stringify(TUBE.geometry), 'the design\'s geometry is the tube from Fusion, unchanged (bends with their plane_deg)');
  const tab = await pg.evaluate(() => { const V = id => document.getElementById(id)._b; return { disp: V('i-disp'), rpm: V('i-rpm'), ve: V('i-ve') }; });
  const eng = (design.operating_point || {}).engine || {};
  ok(Math.abs(eng.displacement_cc - tab.disp) < 0.1 && eng.rpm === Math.round(tab.rpm) && Math.abs(eng.ve - tab.ve / 100) < 1e-3,
     'the airflow is the tab\'s: ' + eng.displacement_cc + ' cc, ' + eng.rpm + ' RPM, VE ' + eng.ve);
  ok(run.data.cache === dj.text || JSON.stringify(JSON.parse(run.data.cache)) === JSON.stringify(design), 'the design is sent as the cache key');
  ok(/iteration 900 \(15% of the 6,000-iteration cap/.test(await pg.evaluate(() => window.__progress || '')) && await pg.evaluate(() => window.__stopShown),
     'progress while it runs: ' + (await pg.evaluate(() => window.__progress || '')).slice(0, 110) + '…, with Stop showing');
  let out = await pg.$eval('#fxcfd-out', e => e.innerText);
  ok(/4\.2\s*inH₂O/.test(out) && /1,050 Pa/.test(out) && /1\.05 kPa/.test(out), 'the drop at the tract end in inH2O, Pa and kPa');
  ok(/0\.834/.test(out) && /1-D estimate, same tube/.test(out) && /% (above|below) the CFD/.test(out), 'K, and the tab\'s 1-D estimate for the same tube beside it');
  ok(/412,345 cells/.test(out) && /11 min 42 s/.test(out) && /stopped once the flow had settled/.test(out), 'mesh size, run time, how it stopped');
  ok(/3\.65 in \(92\.6 mm\) bore/.test(out) && /34\.67 in \(880\.6 mm\)/.test(out) && /5\.00 in \(127 mm\) radius/.test(out), 'the tube\'s sizes in inches and mm');
  ok(await pg.$eval('#fx-intake button[data-fxcfd="stop"]', e => e.hidden), 'Stop hidden again when done');
  const est = await pg.evaluate(T => window.__fxcfd.design(T).est, TUBE);
  ok(est > 500 && est < 2500, 'the 1-D estimate: ' + Math.round(est) + ' Pa');

  // ---- again: from the cache
  await pg.click('#fx-intake button[data-fxcfd="test"]'); await pg.waitForTimeout(400);
  out = await pg.$eval('#fxcfd-out', e => e.innerText);
  ok(await pg.evaluate(() => window.__runs) === 1 && /1,050 Pa/.test(out) && /earlier run of this same tube/.test(out), 'the same tube again: the result at once, no new run');

  // ---- the mouth option
  await pg.selectOption('#fx-intake select.fxcfdsel', 'other');
  await pg.click('#fx-intake button[data-fxcfd="test"]'); await pg.waitForTimeout(400);
  const tc2 = await sentOf('cfdTube');
  ok(tc2[tc2.length - 1].mouth === 'other', '"The other end" is passed to the add-in');
  await pg.selectOption('#fx-intake select.fxcfdsel', 'auto');

  // ---- Stop
  await pg.evaluate(() => { window.__hold = true; window.__tubeOverride = { name: 'TUBE B', geometry: Object.assign({}, window.__fxcfd.FXCFD.last.tube.geometry, { tube_length_mm: 900 }) }; });
  await pg.click('#fx-intake button[data-fxcfd="test"]'); await pg.waitForTimeout(300);
  ok(!(await pg.$eval('#fx-intake button[data-fxcfd="stop"]', e => e.hidden)), 'a new tube runs; Stop shows');
  await pg.click('#fx-intake button[data-fxcfd="stop"]'); await pg.waitForTimeout(300);
  ok((await sentOf('hostCancel')).length === 1 && /^Stopped/.test(await pg.$eval('#fxcfd-msg', e => e.textContent)), 'Stop: hostCancel sent, "Stopped."');
  await pg.evaluate(() => { window.__hold = false; });

  // ---- a refusal from the add-in
  await pg.evaluate(() => { window.__tubeReply = { ok: false, msg: 'The bore is not the same round size all along: 475.7 mm (18.727 in) from the mouth.' }; });
  await pg.click('#fx-intake button[data-fxcfd="test"]'); await pg.waitForTimeout(300);
  const m = await pg.$eval('#fxcfd-msg', e => ({ t: e.textContent, c: e.className }));
  ok(/not the same round size/.test(m.t) && /bad/.test(m.c), 'the add-in\'s refusal is shown as it said it');
  await pg.evaluate(() => { window.__tubeReply = null; });

  // ---- the program not installed
  await pg.evaluate(() => { const H = window.__fxcfd.host(); H.engines.openfoam = false; H.openfoamWhy = 'The Exhaust Tuner program is not installed on this PC.'; window.__tubeOverride = { name: 'TUBE C', geometry: Object.assign({}, window.__fxcfd.FXCFD.last.tube.geometry, { tube_length_mm: 910 }) }; });
  const runs0 = await pg.evaluate(() => window.__runs);
  await pg.click('#fx-intake button[data-fxcfd="test"]'); await pg.waitForTimeout(300);
  const m2 = await pg.$eval('#fxcfd-msg', e => e.textContent); out = await pg.$eval('#fxcfd-out', e => e.innerText);
  ok(m2 === 'The Exhaust Tuner program is not installed on this PC.' && await pg.evaluate(() => window.__runs) === runs0 && /quick 1-D estimate/.test(out),
     'no program: its one sentence, no run, the tube and the 1-D estimate still shown');
  await pg.evaluate(() => { window.__fxcfd.host().engines.openfoam = true; window.__tubeOverride = null; });

  // ---- fill the tab
  await pg.click('#fx-intake button[data-fxcfd="fill"]'); await pg.waitForTimeout(500);
  const f = await pg.evaluate(() => { const V = id => document.getElementById(id)._b, E = id => document.getElementById(id); return { lt: V('i-lt'), dt: V('i-dt'), n: V('i-bends'), ang: E('i-bendang').value, r: V('i-bendr'), mouth: E('i-mouth').value, bpos: window.__cfd.ui.bpos, msg: E('fxcfd-msg').textContent }; });
  ok(Math.abs(f.lt - 880.62) < 1e-9 && Math.abs(f.dt - 92.61) < 1e-9 && f.n === 2 && f.ang === '29.5, 84.1' && Math.abs(f.r - 127) < 1e-9 && f.mouth === 'plain' && f.bpos === '100, 572.1',
     'the Intake tab filled: ' + JSON.stringify(f).slice(0, 160));
  ok(/34\.67 in \(880\.6 mm\)/.test(f.msg) && /29\.5°, 84\.1°/.test(f.msg), 'and says so in inches and mm');
  const own = await pg.evaluate(() => window.__cfd.design());
  const bl = own && own.design.geometry.bend;
  ok(Array.isArray(bl) && bl.length === 2 && bl[0].angle_deg === 29.5 && bl[1].angle_deg === 84.1 && bl[0].start_mm === 100 && bl[1].start_mm === 572.1 && bl[0].clr_mm === 127,
     'the tab\'s own CFD case now has the tube\'s bends where they are (' + (bl || []).map(x => x.angle_deg + ' at ' + x.start_mm).join(', ') + ')');
  const same = await pg.evaluate(T => { const d = window.__fxcfd.design(T); return [d.est, window.__fxcfd.tabDpEnd()]; }, TUBE);
  ok(Math.abs(same[0] - same[1]) < 1e-6, 'the 1-D estimate beside the CFD is the tab\'s own figure for the tube (' + same.map(x => Math.round(x)).join(' = ') + ' Pa)');
  // ---- the owner's tube ending in a 60 mm cone to a 105 mm throttle bore: tested, then put in the tab
  const RESC = JSON.parse(JSON.stringify(RES)); RESC.results.planes = { tract_end: { dp_total_Pa: 1120.0, K_total_loss: 0.91, mdot_kg_s: 0.3691 },
    tube_end: { dp_total_Pa: 1180.0, K_total_loss: 0.94 }, throttle_face: { dp_total_Pa: 1131.0, K_total_loss: 1.71 } };
  await pg.evaluate(([C, R]) => { window.__tubeOverride = C; window.__resOverride = R; }, [CONE, RESC]);
  const runsC = await pg.evaluate(() => window.__runs);
  await pg.click('#fx-intake button[data-fxcfd="test"]'); await pg.waitForTimeout(700);
  const runC = await pg.evaluate(() => window.__lastRun); const djC = (runC.data.files || []).find(f => f.name === 'design.json'); const desC = djC ? JSON.parse(djC.text) : {};
  ok(await pg.evaluate(() => window.__runs) === runsC + 1 && JSON.stringify(desC.geometry) === JSON.stringify(CONE.geometry) && desC.geometry.diameter_change.to_diameter_mm === 105
     && desC.geometry.planes_mm.throttle_face > desC.geometry.planes_mm.tube_end, 'the cone-ended tube: run with its geometry unchanged (diameter_change to 105 mm, planes tube_end and throttle_face)');
  out = await pg.$eval('#fxcfd-out', e => e.innerText);
  ok(/end of the constant tube[^\n]*1,180 Pa/.test(out) && /throttle face[^\n]*1,131 Pa/.test(out) && /1,120 Pa/.test(out) && /half a tube bore \(1\.82 in \(46\.3 mm\)\) past the throttle face/.test(out),
     'the loss at the end of the constant tube, at the throttle face and at the tract end (half a tube bore past it, as the tab\'s case measures): ' + (out.match(/At the end[^\n]*/) || [''])[0].slice(0, 120));
  ok(/a cone from 3\.65 in \(92\.6 mm\) to 4\.13 in \(105 mm\) bore, 2\.36 in \(60 mm\) long/.test(out) && /ending at the throttle face/.test(out) && /has no cone/.test(out),
     'the cone described in inches and mm; the 1-D figure says it has no cone');
  await pg.evaluate(() => { window.__resOverride = null; });
  await pg.click('#fx-intake button[data-fxcfd="fill"]'); await pg.waitForTimeout(500);
  const fc = await pg.evaluate(() => { const V = id => document.getElementById(id)._b, E = id => document.getElementById(id); return { lt: V('i-lt'), dt: V('i-dt'), tb: V('i-tb'), tbShown: E('i-tb').value, mouth: E('i-mouth').value, cone: window.__cfd.ui.cone, msg: E('fxcfd-msg').textContent }; });
  ok(Math.abs(fc.tb - 105) < 1e-9 && Math.abs(fc.lt - CONE.fill.lt_mm) < 1e-9 && Math.abs(fc.dt - 92.61) < 1e-9 && fc.mouth === 'plain' && fc.cone === true && /throttle bore 4\.13 in \(105 mm\)/.test(fc.msg),
     'filled: throttle bore ' + fc.tb + ' mm (shown ' + fc.tbShown + '), length ' + fc.lt + ' mm, and said so: ' + fc.msg.slice(-120));
  const ownC = await pg.evaluate(() => window.__cfd.design());
  const gC = ownC && ownC.design.geometry, dcC = gC && gC.diameter_change;
  const coneEnd = dcC ? dcC.start_mm + (dcC.to_diameter_mm - gC.tube_diameter_mm) / 2 / Math.tan(dcC.cone_half_angle_deg * Math.PI / 180) : NaN;
  ok(dcC && dcC.to_diameter_mm === 105 && Math.abs(gC.tube_length_mm - CONE.geometry.tube_length_mm) < 0.01 && Math.abs(gC.tube_length_mm - 0.5 * gC.tube_diameter_mm - coneEnd) < 0.01
     && Math.abs(coneEnd - CONE.geometry.planes_mm.throttle_face) < 0.05,
     'the tab\'s own CFD case then has its cone to 105 mm ending at the same throttle face (' + coneEnd.toFixed(2) + ' mm) and its tract end at the same place (' + (gC && gC.tube_length_mm) + ' mm)');
  // a bellmouth and a lip from the add-in: the tab's mouth list follows
  await pg.evaluate(T => { window.__tubeOverride = Object.assign({}, T, { geometry: Object.assign({}, T.geometry, { inlet: { type: 'ellipse', length_mm: 40, entry_diameter_mm: 138.9, exit_diameter_mm: 92.61, corner_radius_mm: 0 } }),
    fill: Object.assign({}, T.fill, { mouth: 'ellipse', mouth_read: 'ellipse', lip_mm: null }) }); }, TUBE);
  await pg.click('#fx-intake button[data-fxcfd="fill"]'); await pg.waitForTimeout(400);
  const fe = await pg.evaluate(() => [document.getElementById('i-mouth').value, document.getElementById('fxcfd-msg').textContent]);
  await pg.evaluate(T => { window.__tubeOverride = Object.assign({}, T, { fill: Object.assign({}, T.fill, { mouth: 'radius', mouth_read: 'radius', lip_mm: 3.5 }) }); }, TUBE);
  await pg.click('#fx-intake button[data-fxcfd="fill"]'); await pg.waitForTimeout(400);
  const fr = await pg.evaluate(() => [document.getElementById('i-mouth').value, document.getElementById('i-lipr')._b, document.getElementById('i-lipr').value]);
  ok(fe[0] === 'ellipse' && /Elliptical bellmouth/.test(fe[1]) && fr[0] === 'radius' && Math.abs(fr[1] - 3.5) < 1e-9,
     'a bellmouth read: the tab\'s mouth set to Elliptical bellmouth; a 3.5 mm lip: Rolled lip, lip radius ' + fr[1] + ' mm (shown ' + fr[2] + ')');
  await pg.evaluate(() => { window.__tubeOverride = null; });
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'fxcfd_ui: ' + fails.length + ' FAIL' : 'fxcfd_ui: all pass'); process.exit(fails.length ? 1 : 0); })();
