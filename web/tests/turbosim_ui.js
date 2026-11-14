// "Simulate with the turbo" on the 4-Stroke tab (2026-11-13; docs/WAVE_VALIDATION_2026-11-11.md, part 5): the wave
// simulation under boost takes its charge, turbine, manifold and downpipe from the Intake tab, says what it took and from
// where, runs the closure (the turbine's area at the full-boost RPM, the wastegate above it) in a worker, shows torque,
// power, the pressure before the turbine and the gas temperatures, and feeds the blowdown peak to the Turbo manifold
// section and a line to "Turbo build, step by step". The build: the K24A2 preset, Precision GEN2 PT5862 on its 0.63 A/R T3
// housing, a tubular manifold at 93 mm port spacing (the audit's example), boost 169.918 kPa (the audit's 450 hp case).
// CAPTURE=1 also writes the plan and the run to tools/validation/wave/results/turbo_k24_page.json (for turbo_k24.js).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { reads, settle } = require('./settle');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = reads(await ctx.newPage()); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900); await pg.click('#u-met'); await settle(pg);
  await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]).then(() => settle(pg));
  const chg = (sel, v) => pg.evaluate(([s, v]) => { const el = document.querySelector(s); if (!el) throw new Error('no ' + s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]).then(() => settle(pg));
  const fourText = async () => { await pg.click('#tab-four'); await settle(pg); return pg.$eval('#four-details', e => e.textContent).catch(() => ''); };
  const intakeText = async () => { await pg.click('#tab-intake'); await settle(pg); return pg.$eval('#i-details', e => e.textContent).catch(() => ''); };

  // naturally aspirated: no section
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
  await settle(pg);
  let t4 = await fourText();
  ok(t4.indexOf('Wave simulation') >= 0 && t4.indexOf('Wave simulation with the') < 0, 'naturally aspirated on the Intake tab: the 4-Stroke tab has its wave simulation and no "with the turbo" section');

  // the turbo build
  await pg.click('#tab-intake'); await settle(pg);
  await setv('i-ind', 'turbo'); await setv('i-boost', '169.918'); await setv('i-hp', '450');
  const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await chg('select.tsox[data-k="turbo"]', String(ti));
  const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti); await chg('select.tsox[data-k="hs"]', String(hs));
  await setv('i-mani', 'tube'); await setv('i-msp', '93');
  t4 = await fourText();
  ok(t4.indexOf('Wave simulation with the turbo') >= 0 && t4.indexOf('Simulate with the turbo') >= 0, 'turbocharged: the 4-Stroke tab shows "Wave simulation with the turbo" and its button');
  const P = await pg.evaluate(() => { const p = window.__tsim.plan(), R = window.__tsLast(), X = window.__mfd.last();
    return { p: JSON.parse(JSON.stringify(p)), R: { Pt: R.Pt, t3: R.t3, t2: R.t2, m: R.m }, X: { id: X.c.id, L: X.L, dcol: X.dcol, colL: X.o.colL } }; });
  const sp = P.p.spec, tr = sp.exhaust.turbine;
  ok(!P.p.err && Math.abs(sp.intake.source.p - P.R.Pt) < 1e-9 && Math.abs(sp.intake.source.T - (P.R.t3 + 273.15)) < 1e-9, 'the charge is the route\'s: ' + (sp.intake.source.p / 1000).toFixed(3) + ' kPa absolute (boost ' + ((P.R.Pt - 101325) / 1000).toFixed(3) + ' kPa), ' + (sp.intake.source.T - 273.15).toFixed(2) + ' °C after the intercooler');
  ok(Math.abs(sp.exhaust.segs[sp.exhaust.segs.length - 1].d0 * 1000 - P.X.id) < 1e-9 && Math.abs(sp.exhaust.segs[sp.exhaust.segs.length - 1].L * 1000 - P.X.L) < 1e-9 && Math.abs(sp.opt.collector.segs[1].d0 * 1000 - P.X.dcol) < 1e-9 && Math.abs(sp.opt.collector.segs[1].L * 1000 - P.X.colL) < 1e-9,
    'the exhaust is the Turbo manifold section\'s: runners ' + P.X.id.toFixed(2) + ' mm x ' + P.X.L.toFixed(1) + ' mm, collector ' + P.X.dcol.toFixed(2) + ' mm x ' + P.X.colL.toFixed(1) + ' mm');
  ok(tr && tr.eta === 0.75 && tr.wgTo === 'atm' && tr.wgCdA === 0 && tr.CdA === P.p.A0 && P.p.rpms.length === 8 && P.p.rpms[0] === 3500, 'the turbine: 75 % (blank on the Intake tab), external gate to the air, first guess ' + (P.p.A0 * 1e6).toFixed(1) + ' mm2 from the algebra at ' + P.p.k + ' x boost; speeds ' + P.p.rpms.join(', '));
  const src = await pg.$$eval('#tsim-src tbody tr', rs => rs.map(r => r.textContent));
  ok(src.some(s => /169\.92 kPa/.test(s) && /Intake tab/.test(s)) && src.some(s => /44\.3 mm/.test(s)) && src.some(s => /Downpipe/.test(s)) && src.some(s => /75%/.test(s)) && src.some(s => /A\/R/.test(s)), 'the "what the run takes" table names each value and where it came from (' + src.length + ' rows)');

  // the run
  const t0 = Date.now();
  await pg.click('button[data-tsim="run"]');
  let st = 'running'; for (let i = 0; i < 900 && st === 'running'; i++) { await pg.waitForTimeout(1000); st = await pg.evaluate(() => window.__tsim.state().status); }
  const secs = (Date.now() - t0) / 1000;
  const S = await pg.evaluate(() => { const T = window.__tsim.last(); return T ? JSON.parse(JSON.stringify({ sum: T.sum, plan: T.plan, out: { Vd: T.out.Vd, rows: T.out.rows.map(r => ({ rpm: r.rpm, At: r.At, Ag: r.Ag, it: r.it, short: r.short, ok: r.ok })) } })) : null; });
  ok(st === 'done' && S && S.sum.rows.length === 8, 'the run finishes (' + secs.toFixed(0) + ' s, ' + st + ')');
  if (S) { const R = S.sum.rows, o = R[S.sum.ip];
    ok(R.every(r => r.ok && Math.abs(r.W / r.Wc - 1) < 0.006), 'closure at every speed: turbine / compressor power ' + R.map(r => (r.W / r.Wc).toFixed(4)).join(' '));
    ok(R[0].Ag === 0 && R.every(r => r.At === R[0].At) && R.slice(1).every(r => r.Ag > 0), 'the turbine\'s area is found at ' + R[0].rpm + ' RPM with the gate shut (' + (R[0].At * 1e6).toFixed(1) + ' mm2) and held; the gate opens above it (' + R.map(r => (r.Ag * 1e6).toFixed(0)).join(' ') + ' mm2)');
    ok(R.every(r => Number.isFinite(r.p3) && r.p3pk > r.p3 && Number.isFinite(r.T3) && r.T4 < r.T3 && Number.isFinite(r.tqB)), 'every speed reports the turbine inlet mean and peak, the gas before and after the turbine and the torque');
    ok(o && S.sum.hp > 0, 'peak power ' + S.sum.hp.toFixed(1) + ' hp at ' + o.rpm + ' RPM; turbine inlet ' + o.p3k.toFixed(3) + ' x boost mean, ' + o.p3pkk.toFixed(3) + ' x peak; gate ' + (100 * o.share).toFixed(1) + ' % (algebra at the run\'s p3, T3 ' + (100 * o.wgAlg).toFixed(1) + ' %, at 2 x boost ' + (100 * o.wgPage).toFixed(1) + ' %)');
    ok(R.every(r => r.ord && r.naOrd && r.scOrd && [].concat(r.ord, r.naOrd, r.scOrd).every(x => Number.isFinite(x.L))), 'tail orders after the turbine, with the boost and no turbine, and without boost, at every speed (peak power, turbine against no turbine: ' + o.ord.map((x, i) => 'order ' + x.k / 2 + ' ' + (x.L - o.scOrd[i].L).toFixed(1) + ' dB').join(', ') + ')');
    if (process.env.CAPTURE === '1') { const out = path.join(process.cwd(), '..', 'tools', 'validation', 'wave', 'results', 'turbo_k24_page.json');
      const d = Object.keys(P.p).filter(k => JSON.stringify(P.p[k]) !== JSON.stringify(S.plan[k])); console.log('the plan before the click and the run\'s differ in: ' + (d.join(', ') || 'nothing'));
      fs.writeFileSync(out, JSON.stringify({ note: 'written by web/tests/turbosim_ui.js with CAPTURE=1: the plan the page\'s run used for the K24A2 + PT5862 build, and the run', plan: S.plan, route: P.R, mfd: P.X, run: S.out, sum: S.sum }, null, 1)); console.log('wrote ' + out); } }
  t4 = await pg.$eval('#four-details', e => e.textContent).catch(() => '');
  const drawn = await pg.evaluate(() => ({ a: document.querySelectorAll('#tsim-svg polyline').length, b: document.querySelectorAll('#tsim-p3 polyline').length, rows: document.querySelectorAll('#tsim-tbl tbody tr').length }));
  ok(drawn.a === 3 && drawn.b >= 1 && drawn.rows === 8 && /Peak power under boost/.test(t4) && /× boost/.test(t4) && /Not modelled/.test(t4) && /knock/.test(t4), 'results drawn: torque chart (3 lines), the pressure before the turbine over a cycle, the table (8 speeds), the lines and the limits (knock, enrichment, retard not modelled)');
  ok(/lb-ft/.test(t4) && /N·m/.test(t4) && /psi/.test(t4) && /kPa/.test(t4) && /°F/.test(t4) && /°C/.test(t4), 'both unit systems in the results');
  // audit part 6 (F4, F6, F7): the area presented as what the turbine would have to be, the sensitivity beside it, the
  // comparison with the tab's assumed multiple explained, the brake's definition exact, the gap to the tab's target explained
  ok(/would have to be to give full boost at/.test(t4) && /How much rests on the typed numbers/.test(t4) && /at 65% efficiency/.test(t4) && /full boost at 4,500 RPM/.test(t4) && S && S.sum.sens && S.sum.sens.length === 2,
    'the turbine\'s area reads as what it would have to be at the typed full-boost RPM and efficiency, with the sensitivity (' + (S && S.sum.sens ? S.sum.sens.map(c => 'eta ' + c.eta + ' / ' + c.lo + ' rpm: ' + c.p3k.toFixed(2) + ' x, ' + c.hp.toFixed(0) + ' hp').join('; ') : 'none') + ')');
  ok(/static mean \(what a pressure tap reads\)/.test(t4) && /Logged pre-turbine pressures/.test(t4) && /Trust a measured pressure/.test(t4) && !/the truth is between/.test(t4), 'the pressure before the turbine: total and static, set against logged figures and the tab\'s assumption, which to trust for what');
  ok(/Heywood’s motored friction with its own wide-open pumping loop taken out/.test(t4) && /Against the Intake tab’s 450 hp/.test(t4) && /lb\/hp·h/.test(t4) && /knock/.test(t4) && /4 to 16 %/.test(t4), 'brake defined exactly; the gap to the 450 hp target explained (Garrett\'s airflow and BSFC against the run\'s, knock and enrichment, the NA ratings)');
  // fed back to the Intake tab
  let ti2 = await intakeText();
  ok(/from the wave simulation/.test(ti2), 'the Turbo manifold section gives the blowdown peak "from the wave simulation"');
  const step = await pg.$eval('#tg-steps li[data-step="sim"]', e => e.textContent).catch(() => '');
  ok(/Simulated under boost/.test(step) && /× boost/.test(step) && /RPM/.test(step), 'Turbo build, step by step: ' + step.replace(/\s+/g, ' ').trim().slice(0, 200));
  // stale after a change of boost
  await setv('i-boost', '150'); ti2 = await intakeText();
  const step2 = await pg.$eval('#tg-steps li[data-step="sim"]', e => e.textContent).catch(() => '');
  t4 = await fourText();
  ok(/changed since the run/.test(step2) && /inputs changed since this run/.test(t4) && !/from the wave simulation/.test(ti2), 'after the boost changes: the step says the run is out of date, the 4-Stroke tab says so, the manifold section no longer quotes it');
  // typed areas, and a centrifugal supercharger
  await pg.click('#tab-intake'); await settle(pg); await setv('i-tsa', '1100'); await setv('i-tsw', '0');
  const P2 = await pg.evaluate(() => { const p = window.__tsim.plan(); return { At: p.Aty, Ag: p.Agy, CdA: p.spec.exhaust.turbine.CdA, wg: p.spec.exhaust.turbine.wgCdA }; });
  ok(Math.abs(P2.At - 1.1e-3) < 1e-15 && P2.Ag === 0 && P2.CdA === P2.At && P2.wg === 0, 'typed turbine area 1100 mm2 and gate 0 reach the run');
  // a measured pressure before the turbine (gauge) asks the run for the calibration (turboSimLib.calibrate) when no area is typed
  await setv('i-tsa', ''); await setv('i-tsw', ''); await setv('i-p3m', '300');
  const P2m = await pg.evaluate(() => { const p = window.__tsim.plan(); return { p3m: p.p3m, src: p.src.map(r => r.join(' | ')) }; });
  ok(Math.abs(P2m.p3m - (101325 + 300e3)) < 1e-6 && P2m.src.some(r => /Measured pressure before the turbine/.test(r) && /calibration/.test(r)), 'a measured 300 kPa before the turbine reaches the run as the calibration target (' + (P2m.p3m / 1000).toFixed(3) + ' kPa absolute)');
  await setv('i-p3m', '');
  await setv('i-tsa', ''); await setv('i-tsw', ''); await setv('i-ind', 'centri');
  const P3 = await pg.evaluate(() => { const p = window.__tsim.plan(); return { t: !!p.spec.exhaust.turbine, pOut: p.spec.exhaust.pOut, src: p.spec.intake.source }; });
  t4 = await fourText();
  ok(!P3.t && P3.pOut === 101325 && P3.src && /Wave simulation with the supercharger/.test(t4) && /Simulate with the supercharger/.test(t4), 'centrifugal supercharger: the boosted charge, no turbine, the 4-Stroke tab\'s header to the back pressure');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
  process.exit(fails.length ? 1 : 0);
})();
