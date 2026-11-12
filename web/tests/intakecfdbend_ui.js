// Intake tab CFD case: it takes the tab's bend angles, centre-line radius and rolled-lip radius (it used to place every
// bend as 90 deg at its own radius). The owner's LS3 cold-air intake: 3.646 in bore, 34.67 in, 84 and 30 degree bends on
// 5 in, a 3.5 mm lip. Writes design.json to tests/out/ for cfd/intake_cfd.py.   node tests/intakecfdbend_ui.js
const { chromium } = require('playwright');
const fs = require('fs');
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const set = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await set('i-eng', 'ls'); await set('i-ind', 'na'); await set('i-type', 'cai'); await set('i-filt', 'cone');
  for (const [id, v] of [['i-disp', '376'], ['i-rpm', '6600'], ['i-ve', '92'], ['i-lt', '34.67'], ['i-dt', '3.646'], ['i-n', '1'], ['i-bends', '2'], ['i-tb', '4.134']]) await set(id, v);
  await set('i-mouth', 'plain'); await pg.waitForTimeout(300);
  const geo = () => pg.evaluate(() => { const d = window.__cfd.design(); return { g: d.design.geometry, notes: d.notes, name: d.design.name, design: d.design }; });
  let d = await geo(); let bl = [].concat(d.g.bend || []);
  ok(bl.length === 2 && bl.every(x => x.angle_deg === 90 && Math.abs(x.clr_mm - 1.5 * 92.61) < 0.1), 'no angles given: two 90° bends at 1.5 D, as before');
  await set('i-bendang', '84, 30'); await set('i-bendr', '5'); await pg.waitForTimeout(300);
  d = await geo(); bl = [].concat(d.g.bend || []);
  ok(bl.length === 2 && bl[0].angle_deg === 84 && bl[1].angle_deg === 30, 'the case takes the tab’s angles: ' + bl.map(x => x.angle_deg).join(', '));
  ok(bl.every(x => Math.abs(x.clr_mm - 127) < 0.01), 'at the tab’s 5 in (127 mm) centre-line radius');
  const end0 = bl[0].start_mm + 127 * 84 * Math.PI / 180;
  ok(bl[1].start_mm > end0 + 5 && bl[1].plane_deg === 90, 'the second bend starts after the first ends (' + end0.toFixed(0) + ' < ' + bl[1].start_mm.toFixed(0) + ' mm), turned 90° round');
  const last = bl[1].start_mm + 127 * 30 * Math.PI / 180;
  ok(!d.g.diameter_change || last < d.g.diameter_change.start_mm, 'the bends end before the cone to the throttle');
  ok(/_2bend/.test(d.name), 'the case name counts the bends: ' + d.name);
  await pg.evaluate(() => { window.__cfd.ui.clr = '200'; }); d = await geo();
  ok([].concat(d.g.bend)[0].clr_mm === 200, 'the CFD panel’s radius still overrides the tab’s');
  await pg.evaluate(() => { window.__cfd.ui.clr = ''; });
  await set('i-mouth', 'radius'); await set('i-lipr', String(3.5 / 25.4)); await pg.waitForTimeout(300);
  d = await geo();
  ok(d.g.inlet.type === 'radius' && Math.abs(d.g.inlet.lip_radius_mm - 3.5) < 0.01, 'the rolled lip takes the tab’s 3.5 mm radius');
  await set('i-bendr', '1'); await pg.waitForTimeout(300); d = await geo();
  ok(Math.abs([].concat(d.g.bend)[0].clr_mm - 0.6 * 92.61) < 0.1 && d.notes.some(n => /under 0\.6 D/.test(n)), 'a radius under 0.6 D is raised to 0.6 D with a note');
  await set('i-bendr', '5'); await pg.waitForTimeout(400);
  const cap = await pg.$eval('#panel-intake', e => e.textContent);
  ok(/84° and 30° bends at/.test(cap), 'the case line names the bends');
  d = await geo();
  fs.mkdirSync('tests/out', { recursive: true }); fs.writeFileSync('tests/out/cai_bends_design.json', JSON.stringify(d.design, null, 1));
  const built = await pg.evaluate(() => { const o = window.__cfd.build(); return { is3d: o.is3d, files: (o.files || []).map(f => f.name) }; });
  ok(built.is3d && built.files.some(f => /design\.json$/.test(f)), 'the download is the 3-D kind with design.json and the generator');
  // laid out as the CAD has it: 30 deg first, 100 mm from the filter end, then 84 deg from 572 mm (ends 758 mm), plain end
  await set('i-mouth', 'plain'); await set('i-bendang', '30, 84'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__cfd.ui.bpos = '100, 572'; window.__cfd.ui.cone = false; }); d = await geo(); bl = [].concat(d.g.bend || []);
  ok(bl.length === 2 && bl[0].start_mm === 100 && bl[0].angle_deg === 30 && bl[1].start_mm === 572 && bl[1].angle_deg === 84, 'the panel’s bend starts place them: 30° at 100 mm, 84° at 572 mm');
  fs.writeFileSync('tests/out/cai_cad_layout_design.json', JSON.stringify(d.design, null, 1));
  // the mouth in open air (the CAI default) is kept in the 3-D case now that the generator meshes a free-standing mouth:
  // no 'meshed as flange-mounted'; a protrusion past the first bend is cut back to it, with a note
  ok(d.g.mount.type === 'free' && !d.notes.some(n => /flush in a wall|flange/.test(n)), 'a 3-D CAI keeps its open-air mouth: mount ' + JSON.stringify(d.g.mount));
  await pg.evaluate(() => { window.__cfd.ui.protr = '150'; }); d = await geo();
  ok(d.g.mount.type === 'free' && d.g.mount.protrusion_mm === 100 && d.notes.some(n => /before the first bend/.test(n)), 'a 150 mm protrusion with the first bend at 100 mm is cut back to 100 mm, with a note: ' + JSON.stringify(d.g.mount));
  await pg.evaluate(() => { window.__cfd.ui.protr = ''; window.__cfd.ui.bpos = '10, 572'; }); d = await geo();
  ok(d.g.mount.type === 'flange' && d.notes.some(n => /too close for a free-standing mouth/.test(n)), 'a bend 10 mm behind the mouth leaves no straight for a free-standing mouth: flush in a wall, with a note');
  await pg.evaluate(() => { window.__cfd.ui.bpos = '100, 572'; window.__cfd.ui.mount = 'flange'; }); d = await geo();
  ok(d.g.mount.type === 'flange', 'flush in a wall when the panel says so');
  await pg.evaluate(() => { window.__cfd.ui.mount = ''; });
  await pg.evaluate(() => { window.__cfd.ui.bpos = '100, 150'; }); d = await geo(); bl = [].concat(d.g.bend || []);
  ok(bl.length === 2 && bl[1].start_mm !== 150 && d.notes.some(n => /spread evenly instead/.test(n)), 'overlapping starts (the 30° bend runs to 166 mm) fall back to even spacing, with a note');
  const lab = await pg.$eval('#panel-intake', e => e.textContent);
  ok(/Where each bend starts, from the mouth/.test(lab) && /Bend angles, from the mouth end/.test(lab), 'the panel asks where each bend starts; the angles read from the mouth end');
  await pg.evaluate(() => { window.__cfd.ui.bpos = ''; window.__cfd.ui.cone = true; });
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'intakecfdbend_ui: ' + fails.length + ' FAIL' : 'intakecfdbend_ui: all pass'); process.exit(fails.length ? 1 : 0); })();
