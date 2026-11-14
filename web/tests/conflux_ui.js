// Conflux Technology barrel intercoolers with the maker's performance curves (Intake tab, Intercooler options, 2026-11-12).
//   node tests/conflux_ui.js   (from web/)
//
// Source: Conflux Technology, "Barrel Intercoolers" brochure, version 1.0 (2026), supplied by the owner (not in the repository).
// Key specifications, PDF page 4 (printed 3) part 100011, page 5 (printed 4) part 100012, page 6 (printed 5) part 100013:
//   100011  4.5"/114mm  "Optimised for engines up to 400kW"   140 x 133 x 155 mm  1.5/1.8 kg  air 114.3 mm (4.5")  coolant 19 mm (3/4")
//   100012  5.0"/127mm  "Optimised for engines 300-600kW"     160 x 150 x 190 mm  2.2/2.6 kg  air 127 mm (5.0")    coolant 25.4 mm (1")
//   100013  6.0"/152mm  "Optimised for engines 500-900kW"     177 x 171 x 225 mm  3.4/4.0 kg  air 152.4 mm (6.0")  coolant 25.4 mm (1")
//   boundary conditions (same pages): air in 120 / 200 / 250 °C, 250 / 350 / 500 kPa(a), EGW 25/75 in at 30 °C, 20 / 35 / 50 L/min
//   (0.34 / 0.60 / 0.86 kg/s). Hose barbs, AlSi10Mg. Lead times page 3 (printed 2); tests and ISO 9001 page 7 (printed 6).
// Curves read from the PDF's vector paths (see the comment above `conflux` in index.html), tabulated at 5 flows each.
//
// Hand checks below (independent of the page's functions where it matters):
//  - interpolation: 100011 at 0.225 kg/s, half way between 86.0 and 82.4 -> 84.2%; at 0.30 kg/s exactly 79.0%.
//  - consistency: eff - (Tin - Tout)/(Tin - 30) for 100011 at 0.40: 73.0 - 65/90*100 = +0.78 points.
//  - UA: the exact cross-flow series written here; 100011 at 0.30 kg/s: Ch = 0.30 x 1004.675 = 301.40 W/K,
//    Cc = 0.34 x 3917 = 1331.78 W/K, Cr = 0.22632, eps 0.790 -> NTU, UA = NTU x Ch (the page's 572.6 W/K); counter-flow
//    NTU = ln((1 - eps Cr)/(1 - eps))/(1 - Cr) = ln(0.821207/0.21)/0.773678 = 1.7623 -> UA 531.2 W/K.
//  - round trip: predicting at the maker's own conditions returns the curve's effectiveness and Tout = Tin - eps (Tin - 30).
//  - density scaling: 100012 at 0.50 kg/s into 300 kPa abs. at 150 °C: 16.0 x (350/473.15)/(300/423.15) = 16.6936 kPa.
//  - warmer coolant: at the maker's coolant flow the effectiveness does not change, so 100013 at 0.70 kg/s with coolant at 40 °C:
//    Tout = 250 - 0.90 x 210 = 61.0 °C, Q = 0.90 x 0.70 x 1004.675 x 210 = 132.92 kW.
// K24 builds (Honda K24A2, single turbo, Garrett's manifold pressure for each power entered as boost). Water-to-air order on the
// evidence (reviewer, 2026-11-12): rows passing the rating and tank checks, grouped 0 thermal data meeting the target inside its flow
// range (a single point: within +-10% of its flow), 1 meeting it only by extrapolation, 2 rating only; groups 0 and 1 by the smallest
// capacity margin (heat removed / heat needed), group 2 by rating. Coolant in at the outside 25 °C (none entered), the makers' own
// coolant flows, target 75%: heat needed 0.75 x Ch x (t2 - 25); a core with effectiveness e (on Ch, the smaller stream) removes
// e x Ch x (t2 - 25), so its margin is e / 0.75, whatever t2.
//  450 hp, 29.541 psi: the tab's charge flow 0.42079 kg/s (above Garrett's 0.374: the tab's VE airflow at that boost), t2 198.54 °C.
//    Conflux 100012 (plotted 0.40-0.60: inside): UA linear between the UA inverted (here) at 0.40 and 0.45 -> e about 0.864, margin
//    about 1.154, group 0. Bowman JK190: 0.42079 / 0.50167 = 0.839 x its point's flow, UA held -> margin about 1.271, group 1.
//    Conflux 100013 (0.60-0.80: outside, power law fitted here) -> margin about 1.274, group 1. Then rating only: Garrett 717874-6009
//    (500), 717874-6008 (750). Expected: 100012, JK190, 100013, 717874-6009, 717874-6008 (margins computed below).
//    Conflux 100011 (536.4 hp >= 450) fails the thermal check: 0.42079 kg/s is outside its 0.20-0.40 plot, UA by the fitted power
//    law -> e about 0.720, margin about 0.960: within 5% of the heat needed, so it is listed as just short: it reaches
//    0.75 x 0.960 = 72.0% against the 75% target; at fixed flows e is independent of temperatures, so it passes with the coolant
//    into the core at t2 - (t2 - 25) / 0.960 = 198.54 - 180.8 = about 17.8 °C.
//  600 hp, 46.945 psi: 0.58634 kg/s, t2 259.26 °C. Conflux 100012 inside its range (margin about 1.074), group 0; 100013 (0.586 just
//    below its 0.60) extrapolated, group 1; Garrett 717874-6008 (750 hp) rating only, group 2, with the reason line. 100011 out on
//    rating (536 < 600); JK190 out on rating (489.5 < 600).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, w, tol, m) => ok(Number.isFinite(a) && Math.abs(a - w) <= tol, m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(8) : a) + ', hand ' + +w.toPrecision(8));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  // pg.$eval / pg.$$eval read in one call after the page has stopped re-rendering (tests/settle.js; audit F1)
  require('./settle').reads(pg);
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900); await require('./settle').typedPoint(pg);   // the boost typed, as these pins were worked (2026-11-14)
  const set = (id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const setx = async (k, v) => { await pg.evaluate(([k, v]) => { const e = document.querySelector('.tsox[data-k="' + k + '"]'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]); await pg.waitForTimeout(350); };
  const cp = 1.4 * 287.05 / 0.4, cpc = 3917;
  const eps = (n, cr) => { const a = n, bb = cr * n; let s = 0, ta = Math.exp(-a), tb = Math.exp(-bb), ca = ta, cb = tb; for (let k = 0; k < 400; k++) { if (k > 0) { ta *= a / k; tb *= bb / k; ca += ta; cb += tb; } s += (1 - Math.min(1, ca)) * (1 - Math.min(1, cb)); } return s / bb; };
  const ntuOf = (e, cr) => { let lo = 0, hi = 50; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (eps(mid, cr) < e) lo = mid; else hi = mid; } return (lo + hi) / 2; };

  // 1. the rows and the brochure's key specifications
  const rows = await pg.evaluate(() => window.__tso.IC_LIB.filter(c => c.maker === 'Conflux Technology').map(c => ({ pn: c.pn, type: c.type, kw: c.kw, kwLo: c.kwLo, dims: c.dims.map(x => x[1]), mass: c.mass, inD: c.inD, outD: c.outD, barb: c.barb, coolMm: c.coolMm, coolIn: c.coolIn, rated: c.rated, curve: c.curve, cons: c.pub.cons, pubN: window.__tso.icPubN(c), src: c.src, lead: c.pub.lead, quality: c.pub.quality, tests: c.pub.tests, warranty: c.pub.warranty })));
  const want = { '100011': [400, null, [140, 133, 155], [1.5, 1.8], 4.5, 19, [120, 250, 20, 0.34]], '100012': [600, 300, [160, 150, 190], [2.2, 2.6], 5, 25.4, [200, 350, 35, 0.60]], '100013': [900, 500, [177, 171, 225], [3.4, 4.0], 6, 25.4, [250, 500, 50, 0.86]] };
  ok(rows.length === 3, 'three Conflux barrel rows (' + rows.map(r => r.pn).join(', ') + ')');
  for (const r of rows) { const w = want[r.pn];
    ok(r.type === 'w2a' && r.kw === w[0] && r.kwLo === w[1] && r.dims.join() === w[2].join() && r.mass.join() === w[3].join() && Math.abs(r.inD - w[4]) < 1e-9 && r.outD === r.inD && r.barb && r.coolMm === w[5] &&
      r.rated.thi === w[6][0] && r.rated.p_kPa === w[6][1] && r.rated.lpm === w[6][2] && r.rated.kgs === w[6][3] && r.rated.tci === 30 && r.rated.coolant === 'egw25',
      r.pn + ': brochure specifications (rating, overall size, weight, air and coolant connectors, boundary conditions)');
    ok(/AlSi10Mg/.test(r.cons) && /ISO9001/.test(r.quality) && /1-3 weeks/.test(r.lead) && /calorimetric/.test(r.tests) && /on request/.test(r.warranty) && r.pubN === 6 && /confluxtechnology\.com/.test(r.src), r.pn + ': what the maker publishes, 6 of 6, with tests, ISO 9001, lead time');
    ok(r.curve.m.length === 5 && r.curve.eff.length === 5 && r.curve.tout.length === 5 && r.curve.dp.length === 5, r.pn + ': five tabulated points per curve'); }
  const C1 = rows.find(r => r.pn === '100011').curve;
  ok(C1.eff.join() === '86,82.4,79,75.9,73' && C1.tout.join() === '43,46,49,52,55' && C1.dp.join() === '5,7.4,10,13.4,17', '100011 tabulated: 86.0 to 73.0%, 43 to 55 °C, 5.0 to 17.0 kPa over 0.20 to 0.40 kg/s');

  // 2. interpolation
  const ev = (f, ...a) => pg.evaluate(([f, a]) => { const T = window.__tso, c = pn => T.IC_LIB.find(x => x.pn === pn);
    const A = a.map(v => typeof v === 'string' && /^1000/.test(v) ? c(v) : v); return T[f](...A); }, [f, a]);
  near(await ev('cfxEff', '100011', 0.30), 0.79, 1e-12, '100011 curve at a tabulated flow, 0.30 kg/s');
  near(await ev('cfxEff', '100011', 0.225), 0.842, 1e-12, '100011 curve at 0.225 kg/s, linear between 86.0 and 82.4');
  ok(!Number.isFinite(await ev('cfxEff', '100011', 0.45)), 'outside the plotted range the curve gives no value (no silent extrapolation)');

  // 3. consistency of the two charts, and 4. UA inversion
  const mod = await pg.evaluate(() => { const T = window.__tso; return ['100011', '100012', '100013'].map(pn => { const M = T.cfxModel(T.IC_LIB.find(x => x.pn === pn)); return { pn, resid: M.pts.map(p => p.resid), UAx: M.pts.map(p => p.UAx), UAc: M.pts.map(p => p.UAc), fx: M.fx, fd: M.fd, Cc0: M.Cc0 }; }); });
  near(mod[0].resid[4], 73.0 - 65 / 90 * 100, 1e-9, '100011 at 0.40: effectiveness against the outlet-temperature chart, residual in points');
  ok(mod.every(m => m.resid.every(r => Math.abs(r) < 0.8)), 'every tabulated point: the two charts agree within 0.8 points (' + mod.map(m => m.resid.map(r => r.toFixed(2)).join(' ')).join(' | ') + ')');
  near(mod[0].Cc0, 0.34 * cpc, 1e-9, '100011 rated coolant capacity rate 0.34 kg/s x 3917 J/kg K');
  { const Ch = 0.30 * cp, Cr = Ch / (0.34 * cpc), UAh = ntuOf(0.79, Cr) * Ch, UAch = Math.log((1 - 0.79 * Cr) / (1 - 0.79)) / (1 - Cr) * Ch;
    near(mod[0].UAx[2], UAh, 1e-6 * UAh, '100011 at 0.30 kg/s: UA, cross-flow both unmixed (exact series written here)');
    near(mod[0].UAc[2], UAch, 1e-9 * UAch, '100011 at 0.30 kg/s: UA, counter-flow'); }
  for (const pn of ['100011', '100012', '100013']) { const r = rows.find(x => x.pn === pn), K = r.curve, Rr = r.rated;
    const rt = await pg.evaluate(([pn, K, Rr]) => { const T = window.__tso, c = T.IC_LIB.find(x => x.pn === pn); return K.m.map(m => { const P = T.cfxPredict(c, { m, Cc: Rr.kgs * 3917, thi: Rr.thi, tci: Rr.tci }); return [P.x.eps, P.cf.eps, P.x.tho]; }); }, [pn, K, Rr]);
    ok(rt.every((x, i) => Math.abs(x[0] - K.eff[i] / 100) < 1e-7 && Math.abs(x[1] - K.eff[i] / 100) < 1e-7 && Math.abs(x[2] - (Rr.thi - K.eff[i] / 100 * (Rr.thi - Rr.tci))) < 1e-5), pn + ': UA inverted and re-predicted at the maker’s conditions returns the curve (both arrangements)'); }

  // 5. pressure drop scaled to density, and the exponent
  near(await pg.evaluate(() => { const T = window.__tso; return T.cfxDp(T.IC_LIB.find(x => x.pn === '100012'), 0.5, 300e3, 150).dp; }), 16000 * (350 / 473.15) / (300 / 423.15), 1e-6, '100012 at 0.50 kg/s, 300 kPa abs. and 150 °C: 16.0 kPa x density ratio');
  ok(mod.every(m => m.fd.b > 1.7 && m.fd.b < 1.9), 'air drop ∝ m^n fitted to each curve, n near 2: ' + mod.map(m => m.fd.b.toFixed(3)).join(', '));
  // 6. warmer coolant
  { const P = await pg.evaluate(() => { const T = window.__tso; return T.cfxPredict(T.IC_LIB.find(x => x.pn === '100013'), { m: 0.70, Cc: 0.86 * 3917, thi: 250, tci: 40 }); });
    near(P.x.tho, 250 - 0.9 * 210, 1e-6, '100013 at 0.70 kg/s, coolant in at 40 °C: charge out'); near(P.x.Q, 0.9 * 0.7 * cp * 210, 1e-3, '… heat removed, W'); }

  // the K24 builds
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
  await set('i-ind', 'turbo'); await set('i-boost', '29.541'); await set('i-hp', '450'); await pg.waitForTimeout(500); await setx('ictype', 'w2a');
  const rec = () => pg.evaluate(() => { const r = window.__tso.TG().icrec.w2a; return { ok: r.ok.map(x => ({ n: x.c.maker + ' ' + x.c.pn, flags: x.flags, capM: x.th ? x.th.capM : null, evG: x.evG })), out: r.out.map(x => ({ n: x.c.maker + ' ' + x.c.pn, f: x.fails.map(f => f[1]).join('; '), capM: x.th ? x.th.capM : null })) }; });
  let R = await pg.evaluate(() => window.__tsLast()), Rc = await rec();
  near(R.mc, 0.4208, 0.0001, '450 hp at 29.541 psi: the tab’s charge flow, kg/s');
  // the hand capacity margins: UA from the curve (inverted here), linear inside the plotted range, the power law fitted here outside
  const capCurve = (pn, m) => { const r = rows.find(x => x.pn === pn), K = r.curve, Cc = r.rated.kgs * cpc, U = K.m.map((q, i) => ntuOf(K.eff[i] / 100, q * cp / Cc) * q * cp);
    let ua; if (m >= K.m[0] && m <= K.m[4]) { for (let i = 0; i < 4; i++) if (m <= K.m[i + 1]) { ua = U[i] + (U[i + 1] - U[i]) * (m - K.m[i]) / (K.m[i + 1] - K.m[i]); break; } }
    else { const lx = K.m.map(Math.log), ly = U.map(Math.log), mx = lx.reduce((a, b) => a + b) / 5, my = ly.reduce((a, b) => a + b) / 5, bb = lx.reduce((q, x, i) => q + (x - mx) * (ly[i] - my), 0) / lx.reduce((q, x) => q + (x - mx) ** 2, 0); ua = Math.exp(my - bb * mx) * Math.pow(m, bb); }
    return eps(ua / (m * cp), m * cp / Cc) / 0.75; };
  const capJK = m => { const Ch0 = 30.1 / 60 * cp, Cw = 270 / 60 / 1000 * 992 * 4183, UA = ntuOf(138.5 / 150, Ch0 / Cw) * Ch0, Ch = m * cp; return eps(UA / Ch, Ch / Cw) / 0.75; };
  { const h = [['Conflux Technology 100012', capCurve('100012', R.mc), 0], ['EJ Bowman JK190-4078-3', capJK(R.mc), 1], ['Conflux Technology 100013', capCurve('100013', R.mc), 1]];
    const top = Rc.ok.slice(0, 5);
    ok(top.map(x => x.n).join() === 'Conflux Technology 100012,EJ Bowman JK190-4078-3,Conflux Technology 100013,Garrett 717874-6009,Garrett 717874-6008', '450 hp water-to-air on the evidence: ' + top.map(x => x.n).join(', '));
    ok(h.every(([n, v, g], i) => top[i].n === n && Math.abs(top[i].capM - v) < 1e-6 && top[i].evG === g) && h[0][1] < h[1][1] && h[1][1] < h[2][1] && top[3].evG === 2 && top[4].evG === 2,
      '450 hp: capacity margins by hand ' + h.map(([n, v, g]) => n.split(' ').pop() + ' ' + v.toFixed(4) + ' (group ' + g + ')').join(', ') + '; then rating only'); }
  { // 100011's thermal gate by hand: UA by the power law fitted (here) to its five UA values
    const K = C1, Cc = 0.34 * cpc, U = K.m.map((m, i) => { const Ch = m * cp, cr = Ch / Cc; return ntuOf(K.eff[i] / 100, cr) * Ch; });
    const lx = K.m.map(Math.log), ly = U.map(Math.log), mx = lx.reduce((a, b) => a + b) / 5, my = ly.reduce((a, b) => a + b) / 5;
    const bb = lx.reduce((s, x, i) => s + (x - mx) * (ly[i] - my), 0) / lx.reduce((s, x) => s + (x - mx) ** 2, 0), a = Math.exp(my - bb * mx);
    const Ch = R.mc * cp, UA = a * Math.pow(R.mc, bb), e = eps(UA / Ch, Ch / Cc), capM = e / 0.75, o11 = Rc.out.find(x => x.n === 'Conflux Technology 100011');
    ok(o11 && capM < 1 && /predicted to remove [0-9]+% of the heat the target needs/.test(o11.f) && Math.abs(o11.capM - capM) < 1e-6, '450 hp: 100011 out on the thermal check, hand ' + (capM * 100).toFixed(2) + '% (UA ' + UA.toFixed(1) + ' W/K, ∝ m^' + bb.toFixed(4) + '), page ' + (o11 ? (o11.capM * 100).toFixed(2) : '–') + '%');
    const js = await pg.$eval('#tso-icrec-short-w2a', e => e.innerText).catch(() => ''), tc = R.t2 - (R.t2 - 25) / capM;
    const want = 'Conflux Technology 100011: just short: reaches ' + (75 * capM).toFixed(1) + '% against your 75% target; lowering the target to ' + (75 * capM).toFixed(1) + '% or the coolant temperature into the core to ';
    ok(js.indexOf(want) >= 0 && new RegExp('\\(' + Math.round(tc) + ' °C\\) \\(from 77 °F \\(25 °C\\)\\) would make it pass|' + Math.round(tc) + ' °C \\([0-9]+ °F\\) \\(from 25 °C').test(js), '450 hp: 100011 just short, reaches ' + (75 * capM).toFixed(2) + '%, passes at coolant ' + tc.toFixed(2) + ' °C: ' + js.split('\n').find(l => /100011/.test(l)));
    const P = await pg.evaluate(([m, t]) => { const T = window.__tso, c = T.IC_LIB.find(x => x.pn === '100011'); return T.cfxPredict(c, { m, Cc: 0.34 * 3917, thi: t, tci: 25 }); }, [R.mc, R.t2]);
    near(P.x.tho, R.t2 - (R.t2 - 25) * capM * 0.75, 1e-6, '450 hp: 100011 predicted charge out (°C) = t2 - e (t2 - 25)'); }
  const r13 = Rc.ok.find(x => x.n === 'Conflux Technology 100013');
  ok(r13 && r13.flags.some(f => /under the maker’s optimised range \(500 to 900 kW/.test(f)) && r13.flags.some(f => /outside the maker’s plotted 0\.60-0\.80 kg\/s/.test(f)), '450 hp: 100013 flagged under its optimised range and outside its plotted flows');
  await set('i-boost', '46.945'); await set('i-hp', '600'); await pg.waitForTimeout(500);
  Rc = await rec();
  R = await pg.evaluate(() => window.__tsLast());
  ok(Rc.ok.slice(0, 3).map(x => x.n).join() === 'Conflux Technology 100012,Conflux Technology 100013,Garrett 717874-6008' && Rc.ok[0].evG === 0 && Rc.ok[1].evG === 1 && Rc.ok[2].evG === 2, '600 hp water-to-air on the evidence: ' + Rc.ok.slice(0, 3).map(x => x.n + ' (group ' + x.evG + ')').join(', '));
  near(Rc.ok[0].capM, capCurve('100012', R.mc), 1e-6, '600 hp: 100012 capacity margin by hand at ' + R.mc.toFixed(5) + ' kg/s');
  ok(/Garrett 717874-6008: rating only, so it ranks behind the cores whose thermal data meets the target[^\n]*rating only: the maker publishes no thermal data for this core, so the page cannot check it against your target/.test(await pg.$eval('#tso-icrec-top-w2a', e => e.innerText)) && /Ordered on the evidence/.test(await pg.$eval('#tso-icrec-group-w2a', e => e.innerText)), '600 hp: the rating-only Garrett says why, and the grouping rule is stated next to the pick');
  ok(/rating 536 hp below the 600 hp target/.test((Rc.out.find(x => x.n === 'Conflux Technology 100011') || {}).f || ''), '600 hp: 100011 out on its 400 kW (536 hp) rating');

  // 7. picking 100012 fills the inputs
  const i12 = await pg.evaluate(() => window.__tso.IC_LIB.findIndex(c => c.pn === '100012'));
  await setx('ic', String(i12)); await pg.waitForTimeout(400);
  R = await pg.evaluate(() => window.__tsLast());
  const ins = await pg.evaluate(() => ['i-ici', 'i-ico', 'i-icdp', 'i-icrdp', 'i-icrf'].map(i => document.getElementById(i)._b));
  const ts = await pg.evaluate(() => Object.assign({}, window.__tso.TSO));
  near(ins[0], 127 - 2 * 1.651, 1e-9, 'picking 100012: intercooler inlet = the 127 mm barb less twice the 1.651 mm pipe wall');
  near(ins[1], 127 - 2 * 1.651, 1e-9, '… and the outlet');
  const dpHand = (() => { const m = R.mc, K = rows.find(r => r.pn === '100012').curve; let d; for (let i = 0; i < 4; i++) if (m >= K.m[i] && m <= K.m[i + 1]) d = K.dp[i] + (K.dp[i + 1] - K.dp[i]) * (m - K.m[i]) / (K.m[i + 1] - K.m[i]); return d * (350 / 473.15) / (R.P2 / 1000 / (R.t2 + 273.15)); })();
  near(ins[2], dpHand, 0.01, 'core drop i-icdp (kPa) = the curve at this flow ' + R.mc.toFixed(4) + ' kg/s × the density ratio at ' + (R.P2 / 1000).toFixed(1) + ' kPa abs., ' + R.t2.toFixed(1) + ' °C');
  ok(Math.abs(ins[3] - ins[2]) < 1e-12 && Math.abs(ins[4] - R.mc * 60 / 0.45359237) < 1e-9, 'rated-drop inputs set to the same point (drop and this flow in lb/min), so the scaled row agrees');
  ok(ts.wf === '35' && ts.cool === 'egw25' && ts.ic === String(i12) && ts.ictype === 'w2a' && ts.pm === '' && ts.ua1 === '', 'coolant: the maker’s 35 L/min of EGW 25/75; no single point (the curve is used)');
  const sec = () => pg.evaluate(() => [...document.querySelectorAll('.sec')].find(s => s.dataset.sec === 'intercooler-options-and-cooling-capacity').innerText);
  let S = await sec();
  ok(/This core at this build, from the maker’s curve/.test(S) && /Flow arrangement bracket/.test(S) && /Air drop at this build/.test(S) && !(await pg.$('#tso-cfx-stale')), 'cooling capacity from the curve, the flow-arrangement bracket, the scaled drop; the drop in use is current');
  { const P = await pg.evaluate(() => window.__tso.TG().cfx.op.P), K = rows.find(r => r.pn === '100012').curve;
    const eC = (() => { for (let i = 0; i < 4; i++) if (R.mc >= K.m[i] && R.mc <= K.m[i + 1]) return (K.eff[i] + (K.eff[i + 1] - K.eff[i]) * (R.mc - K.m[i]) / (K.m[i + 1] - K.m[i])) / 100; })();
    near(P.epsCurve, eC, 1e-9, '600 hp: 100012 curve effectiveness at ' + R.mc.toFixed(4) + ' kg/s');
    const Cw = 35 / 60 / 1000 * 1029.5 * 3917; ok(Math.abs(P.cwRatio - Cw / (0.6 * 3917)) < 1e-9 && !P.farCool, 'coolant 35 L/min at 1029.5 kg/m³ = ' + (Cw / (0.6 * 3917)).toFixed(4) + ' × the maker’s 0.60 kg/s: not flagged');
    ok(P.thoHi - P.thoLo < 0.1 && P.thoLo <= P.x.tho && P.x.tho <= P.thoHi, 'cross-flow and counter-flow bracket the prediction (' + P.thoLo.toFixed(3) + ' to ' + P.thoHi.toFixed(3) + ' °C)'); }
  // transitions: the barb is larger than the pipe, so the size-change table has a widening into the core
  const hot = await pg.$eval('#ts-steps tr[data-step="hot"], tr[data-step="hot"]', e => e.innerText).catch(() => '');
  ok(/widening/.test(hot) && /123\.7 mm|4\.87 in/.test(hot), 'size-change table: hot pipe → intercooler inlet widens to the 123.7 mm estimated bore: ' + hot.replace(/\s+/g, ' '));

  // 8. the chart and its operating point
  const ch = await pg.evaluate(() => { const s = document.getElementById('tso-cfx-pick-svg'); if (!s) return null; const e = s.querySelector('circle[data-op="eff"]'), d = s.querySelector('circle[data-op="dp"]');
    return { cy: e ? +e.getAttribute('cy') : NaN, cx: e ? +e.getAttribute('cx') : NaN, dcy: d ? +d.getAttribute('cy') : NaN, txt: s.textContent, mark: !!s.querySelector('line.mark0') }; });
  { const P = await pg.evaluate(() => window.__tso.TG().cfx.op), H = 216, mt = 26, mb = 42, W = 360, ml = 40, mr = 58;
    const ye = H - mb - (P.P.x.eps * 100 - 50) / 50 * (H - mt - mb), x0 = 0.35, x1 = 0.65, xm = ml + (P.m - x0) / (x1 - x0) * (W - ml - mr), yd = H - mb - P.D.dp / 1000 / 30 * (H - mt - mb);
    ok(ch && ch.mark && Math.abs(ch.cy - ye) < 0.06 && Math.abs(ch.cx - xm) < 0.06 && Math.abs(ch.dcy - yd) < 0.06, 'chart: the build’s point drawn at its flow, predicted effectiveness and scaled drop (cx ' + (ch && ch.cx) + '/' + xm.toFixed(1) + ', cy ' + (ch && ch.cy) + '/' + ye.toFixed(1) + ', dp ' + (ch && ch.dcy) + '/' + yd.toFixed(1) + ')');
    ok(/kg\/s \(lb\/min\)/.test(ch.txt) && /kPa \(psi\)/.test(ch.txt) && /°C \([0-9]+ °F\)/.test(ch.txt) && /79\.4/.test(ch.txt), 'chart axes in kg/s and lb/min (0.60 kg/s = 79.4 lb/min), kPa and psi, the point in °C and °F'); }
  ok(await pg.$$eval('#tso-cfx-charts figure', f => f.length) === 3, 'the water-to-air list shows the three barrels’ curves with this build’s point');

  // 9. table, dual units, sheet, checklist, layout
  const tr = await pg.$eval('#tso-ics tr[data-i="' + i12 + '"]', e => e.innerText);
  ok(/160 × 150 × 190 mm|6\.3 in × 5\.9 in × 7\.5 in/.test(tr) && /overall, as the maker publishes it/.test(tr) && /2\.2 \/ 2\.6 kg|4\.9 \/ 5\.7 lb/.test(tr) && /5 in \(127\.0 mm\)|127\.0 mm \(5 in\)/.test(tr) && /25\.4 mm \(1 in\) hose barb/.test(tr) && /300 to 600 kW \(402 to 805 hp/.test(tr), 'table row: overall size in mm and in, weight in kg and lb, air and coolant connectors, rating in kW and hp');
  ok(/kPa/.test(tr) && /psi/.test(tr) && /°C/.test(tr) && /°F/.test(tr) && /kg\/s/.test(tr) && /lb\/min/.test(tr) && /L\/min/.test(tr) && /gpm/.test(tr), 'table row in dual units');
  const step = await pg.$eval('#tg-steps li[data-step="ic"]', e => e.innerText).catch(() => '');
  ok(/Conflux Technology 100012/.test(step), 'checklist step 6 shows the picked barrel: ' + step.replace(/\n/g, ' '));
  await pg.click('button[data-tsheet]'); await pg.waitForTimeout(600);
  const sh = await pg.evaluate(() => { const f = window.__tgSheet; if (!f) return null; const d = new DOMParser().parseFromString(f.text, 'application/xml');
    return [...d.getElementsByTagName('tr')].map(tr => [...tr.getElementsByTagName('td')].map(td => td.textContent)).filter(r => r.length); });
  const icRow = sh && sh.find(r => r[0] === 'Intercooler core');
  ok(icRow && /Conflux Technology 100012/.test(icRow[1]) && /overall/.test(icRow[1]) && /hose barbs/.test(icRow[1]) && /from the maker’s curves at this build/.test(icRow[1]) && /confluxtechnology\.com/.test(icRow[2]), 'build sheet: the barrel, overall size, connectors, the curve prediction and the source: ' + (icRow || []).join(' | '));
  S = await sec();
  ok(!/\bNaN\b|undefined|Infinity/.test(S), 'intercooler section renders cleanly');
  await pg.setViewportSize({ width: 400, height: 900 }); await pg.waitForTimeout(500);
  const w = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(w[0] <= w[1] + 1, '400 px: no horizontal scroll (' + w.join(' / ') + ')');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'conflux_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
