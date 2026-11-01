// Intake CFD (OpenFOAM) section on the Intake tab: design from the tab's inputs, case files written in the
// browser (checked against a Python-generated case), the zip download message, and the results.json reader.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const bad = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object/;
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const pg = await b.newPage({ viewport: vp }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + process.cwd()+'/index.html#intake'); await pg.waitForTimeout(900);
    // simple mode hides the section; expert shows it
    await pg.click('#m-simple'); await pg.waitForTimeout(200);
    let vis = await pg.$eval('#intake-cfd', e => e.offsetParent !== null && e.getBoundingClientRect().height > 0);
    ok(!vis, vp.n + ': section hidden in simple mode');
    await pg.click('#m-expert'); await pg.waitForTimeout(300);
    let t = await pg.$eval('#panel-intake', e => e.innerText);
    ok(/Intake CFD \(OpenFOAM\)/i.test(t) && /Download OpenFOAM case/.test(t), vp.n + ': section present in expert mode');
    ok(!bad.test(t), vp.n + ': no NaN/undefined in the panel');
    // the design from the default inputs (radius mouth, 2 bends -> 3-D) and from a straight bellmouth tube
    let d = await pg.evaluate(() => { const o = window.__cfd.design(); return { g: o.design.geometry, op: o.design.operating_point, notes: o.notes }; });
    ok(d.g.tube_diameter_mm > 0 && d.g.tube_length_mm > 0 && d.g.inlet && d.g.inlet.type === 'radius', vp.n + ': design from the tab (' + d.g.tube_diameter_mm + ' mm x ' + d.g.tube_length_mm + ' mm, ' + d.g.inlet.type + ')');
    ok(d.op.engine && d.op.engine.cylinders === 8 && d.op.engine.strokes === 4 && d.op.engine.rpm > 0, vp.n + ': engine operating point (' + JSON.stringify(d.op.engine) + ')');
    ok(Array.isArray(d.g.bend) && d.g.bend.length === 2 && d.g.maf_plane_mm > 0, vp.n + ': two 90 deg bends and a MAF plane (' + JSON.stringify(d.g.bend) + ', maf ' + d.g.maf_plane_mm + ')');
    await pg.click('#cfd-dl'); await pg.waitForTimeout(800);
    let out = await pg.evaluate(() => window.__cfdLast && { n: window.__cfdLast.files.length, names: window.__cfdLast.files.map(f => f.name), is3d: window.__cfdLast.is3d });
    ok(out && out.is3d && out.names.some(n => /intake_cfd\.py$/.test(n)) && out.names.some(n => /design\.json$/.test(n)), vp.n + ': 3-D (bent) design ships design.json + intake_cfd.py (' + (out && out.names.join(', ')) + ')');
    // straight tube, elliptical bellmouth, no bends: the case is written in the browser
    await pg.fill('#i-bends', '0'); await pg.selectOption('#i-mouth', 'ellipse'); await pg.waitForTimeout(200);
    await pg.fill('.cfdx[data-k="name"]', 'ui_test'); await pg.selectOption('select.cfdx[data-k="mesh"]', 'coarse'); await pg.waitForTimeout(200);
    await pg.click('#cfd-dl'); await pg.waitForTimeout(1200);
    out = await pg.evaluate(() => window.__cfdLast && { n: window.__cfdLast.files.length, names: window.__cfdLast.files.map(f => f.name), is3d: window.__cfdLast.is3d, cells: window.__cfdLast.summary.cells, solver: window.__cfdLast.summary.solver, design: window.__cfdLast.design, bmd: window.__cfdLast.files.find(f => /blockMeshDict$/.test(f.name)).text.slice(0, 1200) });
    ok(out && !out.is3d && out.n >= 20 && out.names.every(n => n.startsWith('ui_test/')) && out.names.some(n => n === 'ui_test/Allrun') && out.names.some(n => n === 'ui_test/README_WINDOWS.md'), vp.n + ': axisymmetric case written in the browser (' + (out && out.n) + ' files, ' + (out && out.cells) + ' cells, ' + (out && out.solver) + ')');
    ok(out && /elliptical bellmouth/.test(out.bmd) && out.design.geometry.inlet.type === 'ellipse' && out.design.geometry.diameter_change, vp.n + ': bellmouth and cone to the throttle in the case');
    const msg = await pg.$eval('#cfd-msg', e => e.innerText);
    ok(/Downloaded|Saved/.test(msg) && /cells/.test(msg), vp.n + ': message after download (' + msg.slice(0, 70) + ')');
    // the same design through the Python generator must give the same bytes
    if (vp.n === 'desk') {
      const { execFileSync } = require('child_process'); const tmp = path.join(process.cwd(), 'cfd_ui_tmp'); fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp);
      fs.writeFileSync(path.join(tmp, 'd.json'), JSON.stringify(out.design));
      const stamp = (await pg.evaluate(() => window.__cfdLast.files.find(f => /blockMeshDict$/.test(f.name)).text.match(/ on (\d{4}-\d\d-\d\d \d\d:\d\d) for/)[1]));
      execFileSync('python3', [path.join(__dirname, '..', '..', 'cfd', 'intake_cfd.py'), path.join(tmp, 'd.json'), path.join(tmp, 'case')], { env: Object.assign({}, process.env, { INTAKE_CFD_STAMP: stamp }), stdio: 'ignore' });
      const files = await pg.evaluate(() => window.__cfdLast.files.map(f => [f.name, f.text]));
      let same = 0, diff = [];
      for (const [nm, text] of files) { const rel = nm.replace(/^ui_test\//, ''); if (/^(design_input|generator_summary)\.json$/.test(rel)) continue; const pyT = fs.readFileSync(path.join(tmp, 'case', rel), 'utf8'); if (pyT === text) same++; else diff.push(rel); }
      ok(diff.length === 0 && same >= 18, vp.n + ': browser case files identical to the Python generator (' + same + ' files' + (diff.length ? '; differ: ' + diff.join(' ') : '') + ')');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    // results reader with the validation runs
    const res = ['RAD-46-23-35-6_m2', 'PP-46-23-23-0_m2'].map(n => path.join(__dirname, '..', '..', 'cfd', 'validation', 'runs', n, 'results.json')).filter(fs.existsSync);
    if (res.length === 2) {
      await pg.setInputFiles('#cfd-files', res); await pg.waitForTimeout(800);
      t = await pg.$eval('#panel-intake', e => e.innerText);
      // generator 1.1.0 validation runs (cyclic sector): RAD PR 1.0370, K 0.0459, Cd 0.9628; PP PR 1.0390, K 0.3769, Cd 0.7856
      ok(/RAD-46-23-35-6/.test(t) && /PP-46-23-23-0/.test(t) && /1\.0370/.test(t) && /1\.0390/.test(t) && /0\.046/.test(t) && /0\.377/.test(t) && /0\.963/.test(t) && /0\.786/.test(t), vp.n + ': results table shows PR, K, Cd of both cases');
      const rd = await pg.$eval('#cfd-reading', e => e.innerText);
      ok(/sharp lip/.test(rd) && /well-rounded/.test(rd) && /vena-contracta CD/.test(rd), vp.n + ': one-line interpretation per case (' + rd.slice(0, 80).replace(/\n/g, ' ') + ')');
      ok(/36\.3 g\/s/.test(t) && /30\.3 g\/s/.test(t) && /converged/.test(t), vp.n + ': mass flow and convergence shown');
    } else console.log('  (validation results.json not found, reader not exercised)');
    t = await pg.$eval('#panel-intake', e => e.innerText);
    ok(!bad.test(t), vp.n + ': no NaN/undefined after results');
    // Headers tab: exhaust component section
    await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(400);
    t = await pg.$eval('#panel-headers', e => e.innerText);
    ok(/Exhaust component CFD \(OpenFOAM\)/i.test(t) && /Download exhaust CFD case/.test(t), vp.n + ': exhaust CFD section on the Headers tab');
    ok(!bad.test(t), vp.n + ': headers panel no NaN/undefined');
    let x = await pg.evaluate(() => { const o = window.__exh.design(); return { d: o.design, nIn: o.nIn, fed: o.fed, T: o.T_c, mEx: o.mEx, uIn: o.uIn }; });
    ok(x.d.mode === 'exhaust' && x.d.geometry.stl && x.d.operating_point.engine.cylinders === 8 && x.fed === 4 && x.nIn === 4 && x.T > 300 && x.mEx > 0.05 && x.uIn > 20, vp.n + ': collector design: 4 inlets, 4 of 8 cylinders, ' + Math.round(x.T) + ' C, ' + (x.mEx * 1000).toFixed(0) + ' g/s, ' + Math.round(x.uIn) + ' m/s');
    await pg.selectOption('select.exhx[data-k="part"]', 'xpipe'); await pg.waitForTimeout(300);
    x = await pg.evaluate(() => { const o = window.__exh.design(); return { nIn: o.nIn, fed: o.fed, T: o.T_c }; });
    ok(x.nIn === 2 && x.fed === 8 && x.T === 400, vp.n + ': X-pipe: 2 inlets, whole engine, 400 C default');
    await pg.selectOption('select.exhx[data-k="part"]', 'collector'); await pg.waitForTimeout(300);
    await pg.click('#exh-dl'); await pg.waitForTimeout(800);
    out = await pg.evaluate(() => window.__exhLast && { names: window.__exhLast.files.map(f => f.name), dj: window.__exhLast.files.find(f => /design\.json$/.test(f.name)).text });
    ok(out && out.names.some(n => /intake_cfd\.py$/.test(n)) && out.names.some(n => /README\.md$/.test(n)) && /"mode": "exhaust"/.test(out.dj) && /inlet_extension_D/.test(out.dj), vp.n + ': exhaust zip holds design.json (mode exhaust), intake_cfd.py, README');
    const em = await pg.$eval('#exh-msg', e => e.innerText);
    ok(/Downloaded|Saved/.test(em) && /inlet1, inlet2, inlet3, inlet4/.test(em), vp.n + ': message names the STL faces (' + em.slice(0, 60) + ')');
    const xres = ['EXH-expansion-50-100', 'EXH-bend90-50-R75'].map(n => path.join(__dirname, '..', '..', 'cfd', 'validation', 'runs', n, 'results.json')).filter(fs.existsSync);
    if (xres.length) {
      await pg.setInputFiles('#exh-files', xres); await pg.waitForTimeout(800);
      t = await pg.$eval('#panel-headers', e => e.innerText);
      ok(/expansion_50_100|bend90/.test(t) && /kPa/.test(t) && /mbar/.test(t) && /K to ambient/i.test(t), vp.n + ': exhaust results table (kPa, mbar, K)');
      const rd = await pg.$eval('#exh-reading', e => e.innerText);
      ok(/K \d\.\d\d/.test(rd), vp.n + ': exhaust one-line reading (' + rd.slice(0, 90).replace(/\n/g, ' ') + ')');
      ok(!bad.test(t), vp.n + ': headers panel no NaN after results');
    } else console.log('  (exhaust validation results.json not found yet, reader not exercised)');
    // intake results file on the headers reader is refused with a message
    await pg.setInputFiles('#exh-files', res.slice(0, 1)); await pg.waitForTimeout(600);
    t = await pg.$eval('#panel-headers', e => e.innerText); ok(/intake results file/.test(t), vp.n + ': intake results refused on the Headers reader');
    // other tabs still render
    for (const tab of ['four-stroke', 'headers', 'quick']) { await pg.evaluate(h => { location.hash = h; }, tab); await pg.waitForTimeout(300); const tt = await pg.evaluate(() => document.querySelector('[role=tabpanel]:not([hidden])').innerText); ok(tt.length > 500 && !bad.test(tt), vp.n + ': ' + tab + ' tab fine'); }
    await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(300);
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok(sw, vp.n + ': no sideways scroll');
    ok(errs.length === 0, vp.n + ': no page errors ' + errs.join(' | '));
    if (vp.n === 'phone') await pg.screenshot({ path: 'cfd-phone.png', fullPage: false });
    await pg.close();
  }
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); await b.close(); process.exit(fails.length ? 1 : 0);
})();
