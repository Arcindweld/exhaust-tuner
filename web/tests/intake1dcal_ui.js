// Intake tab, 1-D pressure loss against the CFD of the owner's LS3 cold-air intake (docs/STATUS.md, 2026-11-10):
// 376 cu in, 6,600 RPM, VE 92%, air at 25 C (369 g/s), 3.646 in (92.61 mm) bore, 34.67 in (880.6 mm), bends from the
// mouth 30 and 84 deg on 5 in (127 mm) centre-line radius, 105 mm throttle, no cone filter in the CFD. OpenFOAM (medium
// mesh, mass-weighted total pressure at the tract end): plain square cut 1,050-1,106 Pa, 3.5 mm rolled lip 700-709 Pa.
// The tab's "tube only at the tract end" figure must land within 12% of the middle of each CFD band (the CFD's own pipe
// friction runs ~25% high on that mesh, so it is not tightened further).   node tests/intake1dcal_ui.js
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const set = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await set('i-eng', 'ls'); await set('i-ind', 'na'); await set('i-type', 'cai'); await set('i-filt', 'cone');
  for (const [id, v] of [['i-disp', '376'], ['i-rpm', '6600'], ['i-ve', '92'], ['i-lt', '34.67'], ['i-dt', '3.646'], ['i-n', '1'], ['i-bends', '2'], ['i-tb', '4.134'],
    ['i-tamb', '77'], ['i-tin', '77'], ['i-bendang', '30, 84'], ['i-bendr', '5']]) await set(id, v);
  await pg.click('#u-met'); await pg.waitForTimeout(100);                       // read the figures in Pa
  const tx = () => pg.$eval('#panel-intake', e => e.innerText);
  const num = (s, re) => { const m = s.match(re); return m ? +m[1].replace(/,/g, '') : NaN; };
  const read = s => ({ tot: num(s, /Duct pressure loss at peak power\s+([\d,]+)\s*Pa/), end: num(s, /Tube only at the tract end, as a CFD reads it\s+([\d,]+)\s*Pa/),
    fr: num(s, /friction ([\d,]+) Pa/), bends: num(s, /bends ([\d,]+) Pa/), inlet: num(s, /inlet ([\d,]+) Pa/) });
  await set('i-mouth', 'plain'); await pg.waitForTimeout(300); const t0 = await tx(), P = read(t0);
  await set('i-mouth', 'radius'); await set('i-lipr', '3.5'); await pg.waitForTimeout(300); const t1 = await tx(), R = read(t1);
  console.log('   plain: total ' + P.tot + ' Pa (friction ' + P.fr + ', bends ' + P.bends + ', inlet ' + P.inlet + '), tract end ' + P.end + ' Pa; CFD 1,050-1,106');
  console.log('   lip:   total ' + R.tot + ' Pa (friction ' + R.fr + ', bends ' + R.bends + ', inlet ' + R.inlet + '), tract end ' + R.end + ' Pa; CFD 700-709');
  ok(/no filter or throttle/.test(t0), 'the loss line says it is the tube alone (no filter, no throttle term)');
  ok(Math.abs(P.fr + P.bends + P.inlet - P.tot) <= 2 && Math.abs(R.fr + R.bends + R.inlet - R.tot) <= 2, 'the terms add up to the total');
  ok(/over the 628 mm \(24\.7 in\) of straights/.test(t0), 'friction runs over the straights only: 880.6 mm less the 66 + 186 mm arcs, mm and inches');
  ok(/square edge, K 0\.50, Crane/.test(t0) && /lip r\/D 0\.038, K 0\.24, Crane/.test(t1), 'inlet K: square edge 0.50, 3.5 mm lip 0.24 (Crane)');
  ok(/f 0\.014[5-9]/.test(t0), 'smooth-tube friction factor at Re 2.8e5 (Colebrook/Haaland about 0.0147)');
  const mid0 = (1050 + 1106) / 2, mid1 = (700 + 709) / 2, tol = 0.12;
  ok(Math.abs(P.end / mid0 - 1) <= tol, 'plain mouth, tube only at the tract end ' + P.end + ' Pa within 12% of the CFD (' + (100 * (P.end / mid0 - 1)).toFixed(1) + '%)');
  ok(Math.abs(R.end / mid1 - 1) <= tol, '3.5 mm lip, tube only at the tract end ' + R.end + ' Pa within 12% of the CFD (' + (100 * (R.end / mid1 - 1)).toFixed(1) + '%)');
  ok(Math.abs((P.end - R.end) - (mid0 - mid1)) <= 0.25 * (mid0 - mid1), 'the lip saves ' + (P.end - R.end) + ' Pa against the CFD\'s ' + Math.round(mid0 - mid1));
  ok(!errs.length && !/NaN/.test(t0 + t1), 'no page errors or NaN ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'intake1dcal_ui: ' + fails.length + ' FAIL' : 'intake1dcal_ui: all pass'); process.exit(fails.length ? 1 : 0); })();
