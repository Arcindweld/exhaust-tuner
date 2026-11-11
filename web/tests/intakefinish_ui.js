// Intake tab "Tube finish": the friction factor follows the chosen wall (equivalent sand-grain roughness, Haaland), the
// loss line shows what the finish costs against a smooth tube, and the "as a CFD reads it" figure stays the smooth tube's
// (the CFD case has smooth walls). Same LS3 cold-air intake as tests/intake1dcal_ui.js.   node tests/intakefinish_ui.js
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const set = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await set('i-eng', 'ls'); await set('i-ind', 'na'); await set('i-type', 'cai'); await set('i-filt', 'cone');
  for (const [id, v] of [['i-disp', '376'], ['i-rpm', '6600'], ['i-ve', '92'], ['i-lt', '34.67'], ['i-dt', '3.646'], ['i-n', '1'], ['i-bends', '2'], ['i-tb', '4.134'],
    ['i-tamb', '77'], ['i-tin', '77'], ['i-bendang', '30, 84'], ['i-bendr', '5']]) await set(id, v);
  await set('i-mouth', 'plain');
  await pg.click('#u-met'); await pg.waitForTimeout(200);
  const tx = () => pg.$eval('#panel-intake', e => e.innerText);
  const num = (s, re) => { const m = s.match(re); return m ? +m[1].replace(/,/g, '') : NaN; };
  const read = s => ({ tot: num(s, /Duct pressure loss at peak power\s+([\d,]+)\s*Pa/), end: num(s, /Tube only at the tract end, as a CFD reads it\s+([\d,]+)\s*Pa/),
    fr: num(s, /friction ([\d,]+) Pa/), f: num(s, /, f (0\.\d+), over the/), add: num(s, /wall adds ([\d,]+) Pa/), addIn: num(s, /wall adds [\d,]+ Pa \(([\d.]+) inH₂O\)/) });
  ok(await pg.$eval('#i-finish', e => e.value) === 'smooth', 'default finish is smooth');
  const t0 = await tx(), S = read(t0);
  ok(Math.abs(S.f - 0.0147) < 0.0003 && S.tot === 1167 && S.end === 1093 && isNaN(S.add), 'smooth: f ' + S.f + ', total ' + S.tot + ' Pa, tract end ' + S.end + ' Pa, as before (no "adds" clause)');
  ok(/wall roughness 0\.0015 mm \(5\.9e-5 in\)|wall roughness 0\.0015 mm \(0\.000059 in\)/.test(t0), 'smooth roughness shown in mm and inches');
  // Haaland at the tab's own Re, D 92.61 mm, ks = 5.863 Ra (Adams et al.) with Ra 16.89 um (Kocisko et al., 0.22 mm layers)
  const Re = num(t0, /smooth at Re ([\d,]+)/), D = 0.0926084, hz = ks => 1 / Math.pow(-1.8 * Math.log10(Math.pow(ks / D / 3.7, 1.11) + 6.9 / Re), 2);
  ok(Re > 2.5e5 && Re < 3e5, 'Reynolds number shown: ' + Re);
  const rows = {};
  for (const fin of ['print02', 'print03', 'blasted', 'sanded', 'steel']) {
    await set('i-finish', fin); await pg.waitForTimeout(250); const t = await tx(); rows[fin] = { r: read(t), t };
  }
  const P = rows.print02.r, ks02 = 5.863 * 16.89e-6;
  console.log('   as printed 0.2 mm: f ' + P.f + ' (Haaland ' + hz(ks02).toFixed(4) + '), total ' + P.tot + ' Pa, adds ' + P.add + ' Pa (' + P.addIn + ' inH2O), tract end ' + P.end);
  ok(Math.abs(P.f - hz(ks02)) < 0.00015, 'as printed (0.2 mm layers): f ' + P.f + ' = Haaland at ks 0.099 mm (' + hz(ks02).toFixed(4) + ')');
  ok(P.tot > S.tot && Math.abs(P.add - (P.tot - S.tot)) <= 1, 'the loss line says what the printed wall adds: ' + P.add + ' Pa = ' + P.tot + ' - ' + S.tot);
  ok(Math.abs(P.addIn - P.add / 249.09) < 0.06, 'and in inH2O: ' + P.addIn);
  ok(P.end === S.end, 'the "as a CFD reads it" figure stays the smooth tube’s (' + P.end + ' Pa) and says so');
  ok(/smooth wall, as the CFD case has/.test(rows.print02.t), 'the CFD row says it uses the smooth wall');
  ok(/wall roughness 0\.099 mm \(0\.0039 in\)/.test(rows.print02.t) && /Kočiško/.test(rows.print02.t) && /Adams/.test(rows.print02.t), 'caption: 0.099 mm (0.0039 in), Kočiško Ra and the Adams conversion cited');
  ok(rows.print03.r.f > P.f && rows.print03.r.tot > P.tot, 'coarser layers lose more: f ' + rows.print03.r.f + ', ' + rows.print03.r.tot + ' Pa');
  ok(rows.sanded.r.f < 0.0150 && rows.sanded.r.tot - S.tot < 10, 'wet sanded is close to smooth: f ' + rows.sanded.r.f + ', +' + (rows.sanded.r.tot - S.tot) + ' Pa');
  ok(rows.blasted.r.f > rows.sanded.r.f && rows.blasted.r.f < P.f, 'blasted sits between: f ' + rows.blasted.r.f);
  ok(Math.abs(rows.steel.r.f - hz(4.5e-5)) < 0.00015, 'commercial steel 0.045 mm: f ' + rows.steel.r.f);
  ok(/Coated or primed prints are not listed/.test(rows.print02.t), 'the caption says why coated prints are not listed');
  await pg.click('#u-imp'); await pg.waitForTimeout(200); await set('i-finish', 'print02'); await pg.waitForTimeout(250);
  const ti = await tx();
  ok(/wall roughness 0\.0039 in \(0\.099 mm\)/.test(ti) && /wall adds [\d.]+ inH₂O \([\d,]+ Pa\)/.test(ti), 'in inches mode: roughness inches first, then mm; the extra loss in inH2O and Pa');
  await set('i-finish', 'smooth'); await pg.waitForTimeout(250);
  ok(!/wall adds/.test(await tx()), 'back to smooth: no extra-loss clause');
  ok(!errs.length && !/NaN/.test(t0 + ti + Object.values(rows).map(x => x.t).join('')), 'no page errors or NaN ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'intakefinish_ui: ' + fails.length + ' FAIL' : 'intakefinish_ui: all pass'); process.exit(fails.length ? 1 : 0); })();
