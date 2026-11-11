// Intake tab: bends by angle and centre-line radius (Crane TP-410 x Idelchik's angle factor) and a rolled lip by its
// radius (Crane's rounded entrance), checked on the owner's LS3 cold-air intake against the CFD of it (validation in
// docs/STATUS.md): 3.646 in bore, 34.67 in long, 84 and 30 degree bends on 5 in radius.   node tests/intakebend_ui.js
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const set = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await set('i-eng', 'ls'); await set('i-ind', 'na'); await set('i-type', 'cai'); await set('i-filt', 'cone');
  for (const [id, v] of [['i-disp', '376'], ['i-rpm', '6600'], ['i-ve', '92'], ['i-lt', '34.67'], ['i-dt', '3.646'], ['i-n', '1'], ['i-bends', '2'], ['i-tb', '']]) await set(id, v);
  await set('i-mouth', 'plain'); await pg.waitForTimeout(300);
  const K = await pg.evaluate(() => { const { bendK, craneEntryK } = window.__intakeK; const f = 0.0145; return { b84: bendK(84, 1.37, f), b30: bendK(30, 1.37, f), b90: bendK(90, 1.5, f), e0: craneEntryK(0), e38: craneEntryK(3.5 / 92.6), e2: craneEntryK(0.2) }; });
  ok(Math.abs(K.b90 - 14 * 0.0145) < 1e-9, '90° at 1.5 D: 14 f (Crane), K ' + K.b90.toFixed(3));
  ok(K.b84 < K.b90 * 1.1 && K.b84 > 0.9 * K.b90 && K.b30 > 0.3 * K.b84 && K.b30 < 0.6 * K.b84, 'a 30° bend costs about half an 84° one (' + K.b30.toFixed(3) + ' against ' + K.b84.toFixed(3) + ')');
  ok(K.e0 === 0.5 && Math.abs(K.e38 - 0.2444) < 0.001 && K.e2 === 0.04, 'Crane entrance: square 0.5, r/D 0.038 gives ' + K.e38.toFixed(3) + ', 0.04 from 0.15');
  const tx = async () => pg.$eval('#panel-intake', e => e.innerText);
  let t0 = await tx();
  await set('i-bendang', '84, 30'); await set('i-bendr', '5'); await pg.waitForTimeout(300);
  let t1 = await tx();
  ok(/84° K 0\.\d\d, 30° K 0\.\d\d at 1\.37 D/.test(t1), 'the loss line lists each bend and its K at the given radius');
  ok(await pg.$eval('#i-lipr-wrap', e => e.hidden), 'the lip radius only shows for a rolled lip');
  await set('i-mouth', 'radius'); await set('i-lipr', String(3.5 / 25.4)); await pg.waitForTimeout(300);
  const t2 = await tx();
  ok(!(await pg.$eval('#i-lipr-wrap', e => e.hidden)) && /lip r\/D 0\.038, K 0\.24, Crane/.test(t2), 'a 3.5 mm lip on the 92.6 mm bore: r/D 0.038, K 0.24');
  const dp = s => { const m = s.match(/Duct pressure loss at peak power\s+([\d.,]+)\s*(inH₂O|Pa|kPa)/); return m ? m[1] + ' ' + m[2] : null; };
  console.log('   plain, 2 x 90°: ' + dp(t0) + ' | plain, 84 + 30 on 5 in: ' + dp(t1) + ' | 3.5 mm lip: ' + dp(t2));
  // after the 2026-11-10 term-by-term check (square edge K 0.5, smooth-tube f, friction over the straights only), at the
  // tab's default 30 C intake air: was 5.8 and 4.1 inH2O, now 4.6 and 3.3 (tests/intake1dcal_ui.js holds it to the CFD)
  const inw = s => parseFloat(dp(s));
  ok(Math.abs(inw(t1) - 4.6) <= 0.1 && Math.abs(inw(t2) - 3.3) <= 0.1, 'totals 4.6 inH2O plain and 3.3 with the lip (' + dp(t1) + ', ' + dp(t2) + ')');
  ok(/Tube only at the tract end, as a CFD reads it\s+[\d.]+\s*inH₂O/.test(t2) && /no filter or throttle/.test(t2), 'the tube-only, tract-end figure is shown and the loss line says no filter or throttle is in it');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'intakebend_ui: ' + fails.length + ' FAIL' : 'intakebend_ui: all pass'); process.exit(fails.length ? 1 : 0); })();
