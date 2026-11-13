// Boost audit part 3 (2026-11-13): checks for every fix, each failing on the merged code (5448b2d) and passing after.
//   node tests/boostaudit3_ui.js   (from web/)
// docs/BOOST_AUDIT_2026-11-12.md, "Part 3", has the findings (P1 ... P14 below are its numbers).
//
// Hand arithmetic
// P1, the open period. A runner passes its cylinder's exhaust only while the exhaust valve is open, D of the 720 crank
//   degrees: by continuity alone its mean flow over that time is 720 / D x the cycle mean. The page's default D is the
//   4-Stroke tab's valve events, 180 + EVO + EVC: the tab's EVO 60 deg BBDC and its blank EVC estimated as that tab does,
//   max(10, 60 - 40) = 20 deg ATDC -> D = 260 deg, k = 720 / 260 = 2.7692308.
//   The collector, I4 1-3-4-2 into one, pulses 180 deg apart, square waves of 260 deg: over one runner's open period
//   [0, 260) the runner opening at 540 (open to 80) and the one at 180 overlap it, so 2 are open on [0, 80) and [180, 260),
//   1 on [80, 180): mean (2 x 80 + 100 + 2 x 80) / 260 = 1.6153846, mean square (4 x 80 + 100 + 4 x 80) / 260 = 2.8461538,
//   rms 1.6870548. I6 into one (120 deg apart), D 250: n = 3, 2, 3, 2, 3 on 10, 110, 10, 110, 10 deg: mean 2.12, rms
//   sqrt(4.6) = 2.1447611. D 170 on the I4: one at a time, 1 and 1.
//   Averaging: a loss K rho v^2 / 2 goes as the square of the flow; over the open period a runner at k x its mean flow
//   loses k^2 x the steady figure at the mean flow, over the whole cycle k x (nothing while shut). The page reports the
//   open-period figure; the cycle mean beside it.
// P2, p3 as a total pressure. turbineBalance takes p3 with T3 as the inlet totals (total-to-static expansion), so the
//   manifold's march starts from p3 as the total pressure at the turbine flange (it started from p3 as the static).
//   K24 example below: at the flange's 58.46 mm bore the dynamic head of the cycle-mean flow is about 8 kPa, four times
//   the loss the page gave, so the port pressure moved by that much.
// The gas states and the march: tools/validation/boost/turbomani_open.py (its own state solver at a stagnation pressure,
//   Fanno integrated in p0, the overlap by triple intersections of arcs), with the page's gamma held constant (the
//   page's own test switch XF_GAS.g) and the page's loss coefficients (checked against python-fluids in Part 1).
// P5, corrected flow. ATP Turbo (the page's source): Wc = W sqrt((T + 460) / 545) / (P / 13.95), T in °F: the reference is
//   85 °F; in absolute temperature 544.67 °R = 302.59444 K. corrFlow and the map's "Garrett" fill both use it now.
// P6, weld elbows. Ace Stainless Supply's B16.9 sheet, 90 deg short radius tables: NPS 1 1/2 schedule 10S 0.49 lb, 40S
//   0.63 lb (long radius 0.69 / 0.88); the pipe's default bend radius is the tightest, the short-radius elbow's 1.5 in.
// P10, map clicks at a third size (viewport 731 px, device pixel ratio 1.5) on this test's own 640 x 480 grid (not a
//   maker's map): flow x = 100 px is 10 lb/min, x = 600 px is 60 lb/min -> flow = 10 + (x - 100) / 10; PR y = 420 px is
//   1.0, y = 60 px is 3.4 -> PR = 1 + (420 - y) / 150. Image pixel (350, 195): 35 lb/min at PR 2.5. The same calibration
//   typed with the top point first (y 60 = 3.4, then y 420 = 1.0) must map the same.
//   Volume axis at Garrett's reference: rho_ref = 96181.860 / (287.05 x 302.59444) = 1.1073253 kg/m³.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { reads, settle } = require('./settle');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => { want = Number(want); a = Number(a); if (!Number.isFinite(want)) return ok(false, m + ': no independent value (page ' + a + ')'); return near0(a, want, tol, m); };
  const near0 = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.max(1e-12, Math.abs(want)), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(8) : a) + ', independent ' + (+want.toPrecision(8)) + (Number.isFinite(a) ? ', difference ' + (+((a / want - 1) * 100).toPrecision(3)) + '%' : ''));
  const py = (script, c) => { try { return JSON.parse(execFileSync('python3', [path.join(process.cwd(), '..', 'tools', 'validation', 'boost', script)], { input: JSON.stringify(c), stdio: ['pipe', 'pipe', 'ignore'] }).toString()); } catch (e) { return {}; } };   // {} when the case cannot run (the merged page lacks a hook)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ba3-')), png = path.join(tmp, 'grid.png');
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = reads(await ctx.newPage()); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  // this test's own grid image
  await pg.setContent('<canvas id="c" width="640" height="480"></canvas>');
  const dataUrl = await pg.evaluate(() => { const c = document.getElementById('c'), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 480); g.strokeStyle = '#888';
    for (let f = 10; f <= 60; f += 5) { const x = 100 + (f - 10) * 10; g.beginPath(); g.moveTo(x, 60); g.lineTo(x, 420); g.stroke(); }
    for (let p = 1; p <= 3.401; p += 0.2) { const y = 420 - (p - 1) * 150; g.beginPath(); g.moveTo(100, y); g.lineTo(600, y); g.stroke(); }
    g.fillStyle = '#000'; g.fillText('audit grid (not a compressor map)', 110, 40); return c.toDataURL('image/png'); });
  fs.writeFileSync(png, Buffer.from(dataUrl.split(',')[1], 'base64'));
  const open = async P => { await P.goto('file://' + process.cwd() + '/index.html#intake'); await P.waitForTimeout(900); await P.click('#u-met'); await settle(P);
    await P.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); }); };
  const setv = (id, v, P) => (P || pg).evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]).then(() => settle(P || pg));
  const chg = (sel, v, P) => (P || pg).evaluate(([s, v]) => { const el = document.querySelector(s); if (!el) throw new Error('no ' + s); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]).then(() => settle(P || pg));
  const tso = (k, v, P) => chg('select.tsox[data-k="' + k + '"]', v, P);
  const sec = (s, P) => (P || pg).$eval('#i-details .sec[data-sec="' + s + '"]', e => e.innerText).catch(() => '');
  const secAll = (s, P) => (P || pg).$eval('#i-details .sec[data-sec="' + s + '"]', e => e.textContent).catch(() => '');   // closed <details> too
  const k24 = async P => { P = P || pg;
    await P.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
    await settle(P); await setv('i-ind', 'turbo', P); await setv('i-boost', '203.677', P); await setv('i-hp', '450', P);
    const ti = await P.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await tso('turbo', String(ti), P);
    const hs = await P.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti); await tso('hs', String(hs), P);
    await setv('i-mani', 'tube', P); await setv('i-msp', '93', P); };
  await open(pg);

  // ---- P1: the overlap of square-wave pulses (pure)
  const OV = await pg.evaluate(() => { const f = window.__mfd.overlap || (() => ({ mean: NaN, rms: NaN })); return { a: f([180, 180, 180, 180], 260, 720), b: f([120, 120, 120, 120, 120, 120], 250, 720), c: f([180, 180, 180, 180], 170, 720), d: f([270, 180, 90, 180], 240, 720) }; });
  near(OV.a.mean, 420 / 260, 1e-12, 'I4, 260°: runners open at once over an open period, mean'); near(OV.a.rms, Math.sqrt(740 / 260), 1e-12, 'I4, 260°: rms');
  near(OV.b.mean, 2.12, 1e-12, 'I6, 250°: mean'); near(OV.b.rms, Math.sqrt(4.6), 1e-12, 'I6, 250°: rms');
  ok(Math.abs(OV.c.mean - 1) < 1e-12 && Math.abs(OV.c.rms - 1) < 1e-12, 'I4, 170°: never two open at once');
  { const q = py('turbomani_open.py', { gamma: 1.3, R: 287, T0: 1200, p3: 3e5, m_run: 0.05, d_run: 40, gaps: [270, 180, 90, 180], dur: 240 });
    near(OV.d.mean, q.mean, 1e-12, 'cross-plane V8 bank 270/180/90/180, 240°: mean, against turbomani_open.py (triple intersections)'); near(OV.d.rms, q.rms, 1e-12, '… rms'); }

  // ---- the K24A2 + Precision GEN2 PT5862 build (turbomani_ui's), at its boost
  await k24();
  // P8, the S geometry by hand on an I6 (ports 100 mm apart, R 50 mm, merge in the middle): the outer ports sit 250 mm off,
  //   250 >= 2R: two 90° bends and 150 mm between, L = pi 50 + 150 = 307.0796 mm, Z = 2R = 100 mm; cylinder 3 is 50 mm off,
  //   < 2R: theta = acos(1 - 50/100) = 60°, L = 2R theta = 104.7198 mm, Z = 2R sin 60° = 86.6025 mm < 100, so it reaches the
  //   farthest runner's merge plane with straight to spare and the farthest runner sets the equal length
  { const I = await pg.evaluate(() => { const M = window.__mfd, o = Object.assign({}, M.last().o, { e: { name: 'Inline-6', key: 'i6', order: [1, 5, 3, 6, 2, 4], banks: [[1, 2, 3], [4, 5, 6]] }, nt: 1, mani: 'tube', sp: 100, off: 0, clr: 50, cand: null, L: NaN });
      const X = M.calc(o); return { Leq: X.len.Leq, Z: X.len.Z, far: X.len.far.cy, per: X.len.per.map(q => [q.cy, q.y, q.S.L, q.S.Z, q.extra]) }; });
    near(I.Leq, Math.PI * 50 + 150, 1e-12, 'P8: I6, 100 mm apart, R 50 mm: shortest equal length π R + (y − 2R), mm'); near(I.Z, 100, 1e-12, 'P8: … merge 2R out');
    const c3 = I.per.find(q => q[0] === 3);
    near(c3[2], 100 * Math.PI / 3, 1e-12, 'P8: cylinder 3, 50 mm off: 2R acos(1 − y/2R), mm'); near(c3[3], 100 * Math.sin(Math.PI / 3), 1e-12, 'P8: … its own reach 2R sin θ, under the merge plane');
    ok((I.far === 1 || I.far === 6) && I.per.every(q => q[3] <= I.Z + 1e-9 && q[4] >= -1e-9), 'P8: the farthest runner (1 or 6) sets the length; every other one reaches the plane within it'); }
  let X = await pg.evaluate(() => { const X = window.__mfd.last(); return { k: X.k, dur: X.dur, why: X.durWhy, ov: X.ov || {}, p3: X.o.p3, s3p0: X.march.s3.p0, s3p: X.march.s3.p, K: !!X.marchK }; });
  near(X.dur, 260, 1e-12, 'P1: open period from the 4-Stroke tab’s events, 180 + 60 + max(10, 60 − 40), deg'); ok(X.why === 'cam', 'P1: … said to come from the 4-Stroke tab');
  near(X.k, 720 / 260, 1e-12, 'P1: open-period factor 720 / 260'); near(X.ov.rms, Math.sqrt(740 / 260), 1e-12, 'P1: collector rms count, I4 at 260°');
  near(X.s3p0, X.p3, 1e-12, 'P2: the march starts from p3 as the total pressure at the turbine flange'); ok(X.s3p < X.p3, 'P2: … the static pressure there is lower');
  let t = await sec('turbo-manifold');
  ok(/while its valve is open \(mean over the open period\)/.test(t) && /averaged over the whole cycle/.test(t) && /by continuity alone/.test(t), 'P1: the runner table shows the open-period speed by default, the cycle mean beside it');
  ok(/needs a wave model/.test(t) && /no peak is given/.test(t), 'P1: says the blowdown peak is not computable without a wave model');
  ok(/Manifold loss, port to turbine flange, while a valve is open/.test(t) && /not K ρ⟨v⟩²\/2/.test(t), 'P1: the loss on the open-period basis, with the averaging stated');
  ok(/260° from the 4-Stroke tab’s valve events, exhaust opens 60° BBDC and closes 20° ATDC \(the closing is that tab’s estimate/.test(t), 'P1: the open period’s source and the estimate named');
  // typed period, typed closing, 0.050 in events
  await setv('i-mdur', '240'); X = await pg.evaluate(() => { const X = window.__mfd.last(); return { k: X.k, why: X.durWhy }; });
  ok(Math.abs(X.k - 3) < 1e-12 && X.why === 'typed', 'P1: a typed 240° gives × 3, said as yours'); await setv('i-mdur', '');
  await setv('f-evc', '15'); await chg('#f-camat', '050');   // the 4-Stroke tab's inputs (in the page, whichever tab shows)
  X = await pg.evaluate(() => { const X = window.__mfd.last(); return X ? { dur: X.dur, why: X.durWhy } : null; });
  ok(X && Math.abs(X.dur - 255) < 1e-12 && X.why === 'cam', 'P1: a typed exhaust closing on the 4-Stroke tab, 15°: 180 + 60 + 15 = 255° (' + (X && X.dur) + ')');
  t = await sec('turbo-manifold'); ok(/at 0\.050 in lift \(shorter than the time off the seat/.test(t) && !/that tab’s estimate/.test(t), 'P1: events at 0.050 in are said to give the mean over the main lift');
  await setv('f-evc', ''); await chg('#f-camat', 'seat');

  // ---- 450 and 600 hp: the tab's boost set so its airflow per compressor is Garrett's Wa = HP x A/F 12 x BSFC 0.55 / 60
  const cases = {};
  for (const hp of [450, 600]) {
    await setv('i-hp', String(hp));
    const want = await pg.evaluate(() => window.__tg.TG().G.wa / (60 / 0.45359237));
    let b0 = 150, b1 = 260; const ma = async kpa => { await setv('i-boost', String(kpa)); return pg.evaluate(() => window.__mfd.last().o.ma); };
    let f0 = await ma(b0) - want, f1 = await ma(b1) - want;
    for (let i = 0; i < 8 && Math.abs(f1) > 1e-9; i++) { const b2 = b1 - f1 * (b1 - b0) / (f1 - f0); b0 = b1; f0 = f1; b1 = b2; f1 = await ma(b1) - want; }
    near(want + f1, want, 1e-7, hp + ' hp: the tab’s air per compressor matched to Garrett’s ' + (want * 60 / 0.45359237).toFixed(2) + ' lb/min at ' + b1.toFixed(3) + ' kPa boost');
    const G = await pg.evaluate(() => { const T = window.__tsx, M = window.__mfd, o = M.last().o, g = T.exhGamma(o.tit + 273.15); T.XF_GAS.g = g;
      const X = M.calc(o), r = X.rows.find(x => x.cd === X.c), Kof = mr => { if (!mr || !mr.parts) return {}; const P = k => (mr.parts.find(x => x.k === k) || {}); return { K_merge: P('merge').K || 0, K_bends: P('bends').K || 0, K_port: P('port').K || 0, L_straight: P('run').L || 0 }; };
      const res = { g, R: T.EXH_GAS.R, T0: o.tit + 273.15, p3: o.p3, mr: X.mr, n: X.nPer, id: X.c.id, port: o.port, dcol: X.dcol, colL: o.colL, gaps: X.LY.mf[0].gaps, dur: X.dur, k: X.k, rms: X.ov ? X.ov.rms : NaN,
        v: r.v, M: r.M, vk: r.vk, Mk: r.Mk, dp0: X.march.dp0, dp0K: X.marchK ? X.marchK.dp0 : NaN, pPortK: X.marchK && X.marchK.sPort ? X.marchK.sPort.p : NaN, Km: Kof(X.march), Kk: Kof(X.marchK), boost: o.bst };
      T.XF_GAS.g = null; return res; });
    // the page's own numbers (burned-gas gamma(T)) for the report
    const P0 = await pg.evaluate(() => { const X = window.__mfd.last(), r = X.rows.find(x => x.cd === X.c); return { v: r.v, M: r.M, vk: r.vk, Mk: r.Mk, dp0: X.march.dp0, dp0K: X.marchK ? X.marchK.dp0 : NaN }; });
    const c = { gamma: G.g, R: G.R, T0: G.T0, p3: G.p3, m_run: G.mr, n: G.n, d_run: G.id, d_port: G.port, d_col: G.dcol, L_col: G.colL, d_eq: G.id * Math.sqrt(G.n), gaps: G.gaps, dur: G.dur,
      K_merge: G.Km.K_merge, K_bends: G.Km.K_bends, K_port: G.Km.K_port, L_straight: G.Km.L_straight, K_open: { K_merge: G.Kk.K_merge, K_bends: G.Kk.K_bends, K_port: G.Kk.K_port, L_straight: G.Kk.L_straight, d_eq: G.id * Math.sqrt(Math.min(G.n, G.rms)) } };   // open period: the merge from the bore of the runners flowing at once
    const q = py('turbomani_open.py', c);
    near(G.k, q.k, 1e-12, hp + ' hp: k'); near(G.rms, q.rms, 1e-12, hp + ' hp: collector rms count');
    near(G.v, q.v_mean, 1e-6, hp + ' hp: runner speed averaged over the cycle, m/s'); near(G.M, q.M_mean, 1e-6, hp + ' hp: … Mach');
    near(G.vk, q.v_open, 1e-6, hp + ' hp: runner speed while its valve is open, m/s'); near(G.Mk, q.M_open, 1e-6, hp + ' hp: … Mach');
    near(G.dp0, q.dp0_mean, 2e-3, hp + ' hp: manifold loss at the cycle-mean flow, Pa'); near(G.dp0K, q.dp0_open, 2e-3, hp + ' hp: manifold loss while a valve is open, Pa');
    near(G.pPortK, q.p_port_open, 1e-4, hp + ' hp: port static pressure while open, Pa');
    ok(G.dp0K > 3 * G.dp0, hp + ' hp: the open-period loss is ' + (G.dp0K / G.dp0).toFixed(2) + ' × the cycle-mean figure the page gave before');
    // the runner steel (calcSkin, both CAFs) against tools/validation/boost/skin.py
    const H = await pg.evaluate(() => { const X = window.__mfd.last(), o = X.o, h = X.heat, mean = S => S.pts.reduce((a, q) => a + q.Tsteel, 0) / S.pts.length, mx = S => Math.max(...S.pts.map(q => q.Tsteel));
      return { mdot: X.mr, Tg: o.tit, di: X.c.id, wall: X.c.wall, L: X.L, Ta: o.cool.Ta, v: o.cool.v, fin: o.cool.fin, cp: window.__tsx.xCp ? window.__tsx.xCp(o.tit + 273.15 - 10) : null, a: [mean(h.a), mx(h.a)], b: [mean(h.b), mx(h.b)], Ts: h.Ts }; });
    if (H.cp && H.fin === 'ox') { for (const [caf, pv] of [[1, H.a], [2.3, H.b]]) { const sk = py('skin.py', { mdot: H.mdot, Tg: H.Tg, di: H.di, wall: H.wall, L: H.L, caf, Ta: H.Ta, v: H.v, eps: 0.85, cp: H.cp });
        ok(Math.abs(pv[0] - sk.mean) < 0.2 && Math.abs(pv[1] - sk.max) < 0.2, hp + ' hp: runner steel, CAF ' + caf + ': page mean ' + pv[0].toFixed(2) + ' / max ' + pv[1].toFixed(2) + ' °C, skin.py ' + sk.mean.toFixed(2) + ' / ' + sk.max.toFixed(2) + ' °C'); }
      ok(Math.abs(H.Ts - Math.max(H.a[0], H.b[0])) < 1e-9, hp + ' hp: the growth uses the hotter of the two means'); }
    else ok(false, hp + ' hp: skin inputs (xCp hook, oxidised finish) not as expected: ' + JSON.stringify({ cp: H.cp, fin: H.fin }));
    cases[hp] = { boost: b1, page: P0, ind: q, steel: H.b };
    const fx = (x, d) => Number.isFinite(x) ? x.toFixed(d) : String(x);
    console.log('  ' + hp + ' hp at ' + b1.toFixed(3) + ' kPa boost, page (burned-gas gamma): runner ' + fx(P0.vk, 1) + ' m/s Mach ' + fx(P0.Mk, 4) + ' while open (' + fx(P0.v, 1) + ' m/s Mach ' + fx(P0.M, 4) + ' cycle mean); loss ' + fx(P0.dp0K / 1000, 3) + ' kPa while open (' + fx(P0.dp0 / 1000, 3) + ' kPa cycle mean)'); }
  await setv('i-boost', '203.677'); await setv('i-hp', '450');

  // ---- P2 on the page: the port pressure row
  t = await sec('turbo-manifold'); ok(/gauge total, .* static/.test(t) && /taken as a total pressure as the turbine balance takes it/.test(t), 'P2: the port pressure as total and static, p3 named a total');
  // ---- P3: MacInnes and Bell are AutoSpeed's summaries, not quotes
  ok(!/“small diameter runners with about the same internal area as the ports”/.test(t) && !/“relatively small diameter runners with large wall thicknesses”/.test(t) && !/Bell: “large wall thicknesses”/.test(t), 'P3: no quotation marks on AutoSpeed’s paraphrases of MacInnes and Bell');
  ok(/as AutoSpeed’s review sums up his book \(its own words, not a quote from MacInnes/.test(t) && /“not significantly greater than the geometric valve area at full lift”/.test(t), 'P3: said to be the review’s summary; Humphries, a real quote in the review, keeps its marks');
  // ---- checklist and sheet on the open-period basis
  let st = await pg.evaluate(() => (window.__tg.steps() || []).find(x => x.id === 'mani'));
  ok(st && /manifold loss [\d.]+ kPa \([\d.]+ psi\) while a valve is open \([\d.]+ kPa \([\d.]+ psi\) at the cycle-mean flow\)/.test(st.line), 'checklist: the loss while a valve is open, the cycle mean beside it: ' + (st && st.line.slice(-110)));
  let sh = await pg.evaluate(() => window.__tg.sheet().nums.map(n => n.join(' | ')).join('\n'));
  ok(/Manifold loss, port to turbine flange, while a valve is open \| [\d.]+ kPa/.test(sh) && /Runner gas speed at the turbine-inlet state \| .* while its valve is open/.test(sh), 'build sheet: loss and speed on the open-period basis');

  // ---- P6: weld elbows, the short-radius weight
  await chg('select.mfdx[data-k="run"]', 'p1½-10');
  let cut = await pg.evaluate(() => { const X = window.__mfd.last(); return { R: X.R, cut: X.cut, sr: X.c.sr }; });
  ok(Math.abs(cut.R - 1.5 * 25.4) < 1e-9 && cut.cut && cut.cut.lb === 0.49, 'P6: NPS 1½ 10S on its default (short-radius, 1.5 in) elbow: 0.49 lb each (was the long-radius 0.69): ' + JSON.stringify(cut.cut));
  ok(/0\.49 lb each, 90° short radius/.test(await secAll('turbo-manifold')), 'P6: … and the cut list says so');
  await chg('select.mfdx[data-k="clr"]', (2.25 * 25.4).toFixed(3));
  cut = await pg.evaluate(() => window.__mfd.last().cut); ok(cut && cut.lb === 0.69, 'P6: on the long-radius elbow, 0.69 lb');
  await chg('select.mfdx[data-k="run"]', '');

  // ---- P7: the Fusion payload's clearance and the collector shape
  const pay = await pg.evaluate(() => window.__mfd.payload());
  ok(pay && Math.abs(pay.gap_mm - 12.7) < 1e-12, 'P7: the runners keep the Fabrication tab’s 12.7 mm (0.5 in) clearance, as a header route does (was the charge pipes’ 50.8 mm hot clearance): ' + (pay && pay.gap_mm));
  t = await secAll('turbo-manifold');
  ok(/The router’s collector tapers from the runners’ ring to the turbine flange bore over that whole length/.test(t) && /this length is the planar lower bound/.test(t), 'P7: the collector shape the router builds and the length caveat are on the page');

  // ---- P5: one corrected-flow definition
  const cf = await pg.evaluate(() => ({ a: window.__turbo.corrFlow(0.43318420652130163, 30, 100109.56592394777), b: window.__cmap.corrFlowRef(0.43318420652130163, 303.15, 100109.56592394777, (85 + 459.67) / 1.8, 13.95 * 6894.757) }));
  near(cf.a, cf.b, 1e-14, 'P5: corrFlow is corrFlowRef at 85 °F = 544.67 °R and 13.95 psia');
  near(cf.a, 0.43318420652130163 * Math.sqrt((86 + 460) / 545) / (100109.56592394777 / 6894.757 / 13.95), 6e-7, 'P5: within 6e-7 of ATP’s literal (T + 460) / 545');

  // ---- the map: load the grid, Garrett's reference, calibration typed upside down, then clicks at a third size
  await pg.setInputFiles('#cm-file', png); await pg.waitForFunction(() => window.__cmap.img() && document.querySelector('#cm-svg image'), null, { timeout: 5000 }).catch(() => {}); await settle(pg);
  await chg('select.cmx[data-k="maker"]', 'garrett');
  let rf = await pg.evaluate(() => window.__cmap.ref());
  ok(rf && Math.abs(rf.T - (85 + 459.67) / 1.8) < 1e-9 && await pg.evaluate(() => window.__cmap.state.refT === '85' && window.__cmap.state.refTu === 'F'), 'P5: the Garrett fill is 85 °F (ATP Turbo), not 545 °R');
  near(rf && rf.rho, 13.95 * 6894.757 / (287.05 * (85 + 459.67) / 1.8), 1e-12, 'map: reference density for a volume axis, P / (R T)');
  for (const [k, v] of [['cal.xa.p', '100'], ['cal.xa.v', '10'], ['cal.xb.p', '600'], ['cal.xb.v', '60'], ['cal.ya.p', '60'], ['cal.ya.v', '3.4'], ['cal.yb.p', '420'], ['cal.yb.v', '1']]) await chg('input.cmx[data-k="' + k + '"]', v);
  let m = await pg.evaluate(() => { const c = window.__cmap.cal(); return c.miss ? null : { a: c.fx(350), b: c.fy(195), gx: c.gx(35), gy: c.gy(2.5), sy: c.sy }; });
  ok(m && Math.abs(m.a - 35) < 1e-12 && Math.abs(m.b - 2.5) < 1e-12 && Math.abs(m.gx - 350) < 1e-9 && Math.abs(m.gy - 195) < 1e-9 && m.sy < 0, 'map: the top point typed first (y pixels down, PR up): (350, 195) is 35 lb/min at 2.5, and back');
  await pg.close();
  const ctx3 = await b.newContext({ viewport: { width: 731, height: 900 }, deviceScaleFactor: 1.5 }); const p3 = reads(await ctx3.newPage()); const e3 = []; p3.on('pageerror', e => e3.push(e.message));
  await open(p3); await setv('i-ind', 'turbo', p3);
  await p3.setInputFiles('#cm-file', png); await p3.waitForFunction(() => window.__cmap.img() && document.querySelector('#cm-svg image'), null, { timeout: 5000 }).catch(() => {}); await settle(p3);
  for (const [k, v] of [['cal.xa.p', '100'], ['cal.xa.v', '10'], ['cal.xb.p', '600'], ['cal.xb.v', '60'], ['cal.ya.p', '420'], ['cal.ya.v', '1'], ['cal.yb.p', '60'], ['cal.yb.v', '3.4']]) await chg('input.cmx[data-k="' + k + '"]', v, p3);
  await p3.evaluate(() => document.querySelector('[data-cmtool="surge"]').click()); await settle(p3);   // the tool opens its <details>
  const rect = () => p3.evaluate(() => { const s = document.querySelector('#cm-svg').getBoundingClientRect(); return { l: s.left, t: s.top, w: s.width, h: s.height, vh: innerHeight, dpr: devicePixelRatio }; });
  let r = await rect(); await p3.evaluate(dy => window.scrollBy(0, dy), Math.round(r.t + 195 / 480 * r.h - r.vh / 2)); r = await rect();
  const cx = Math.round(r.l + 350 / 640 * r.w), cy = Math.round(r.t + 195 / 480 * r.h); await p3.mouse.click(cx, cy); await settle(p3);
  const q = await p3.evaluate(() => { const s = window.__cmap.state.surge, c = window.__cmap.cal(); const a = s[s.length - 1]; return a ? { px: a, v: [c.fx(a[0]), c.fy(a[1])] } : null; });
  const ex = (cx - r.l) / r.w * 640, ey = (cy - r.t) / r.h * 480, one = 640 / r.w + 0.01;
  ok(r.dpr === 1.5 && Math.abs(r.w / r.h - 640 / 480) < 0.01, 'P10: third size: the map drawn ' + r.w.toFixed(1) + ' × ' + r.h.toFixed(1) + ' CSS px at device pixel ratio ' + r.dpr + ', aspect kept');
  ok(q && Math.abs(q.px[0] - ex) <= 0.006 && Math.abs(q.px[1] - ey) <= 0.006, 'P10: the click recorded at image pixel (' + (q && q.px.join(', ')) + '), by hand (client − edge) ÷ size × natural (' + ex.toFixed(2) + ', ' + ey.toFixed(2) + ')');
  ok(q && Math.abs(q.px[0] - 350) <= one && Math.abs(q.px[1] - 195) <= one && Math.abs(q.v[0] - (10 + (q.px[0] - 100) / 10)) < 1e-9 && Math.abs(q.v[1] - (1 + (420 - q.px[1]) / 150)) < 1e-9, 'P10: within one screen pixel of (350, 195), reading 10 + (x − 100) ÷ 10 lb/min and 1 + (420 − y) ÷ 150');
  ok(!e3.length, 'no page errors at the third size' + (e3.length ? ': ' + e3.join(' | ') : ''));
  await ctx3.close();

  // ---- both features at once: manifold and map, mounts and oil, the checklist, the sheet, the section order, a project
  const pg2 = reads(await ctx.newPage()); const e2 = []; pg2.on('pageerror', e => e2.push(e.message)); pg2.on('console', m2 => { if (m2.type() === 'error') e2.push('console: ' + m2.text()); });
  await open(pg2); await k24(pg2); await setv('i-mkg', '10', pg2);
  await chg('#mt-part', 'turbo', pg2);   // the Mounts designer's part (Hangers tab; its inputs are in the page)
  await pg2.setInputFiles('#cm-file', png); await pg2.waitForFunction(() => window.__cmap.img() && document.querySelector('#cm-svg image'), null, { timeout: 5000 }).catch(() => {}); await settle(pg2);
  await chg('select.cmx[data-k="maker"]', 'garrett', pg2);
  for (const [k, v] of [['cal.xa.p', '100'], ['cal.xa.v', '10'], ['cal.xb.p', '600'], ['cal.xb.v', '60'], ['cal.ya.p', '420'], ['cal.ya.v', '1'], ['cal.yb.p', '60'], ['cal.yb.v', '3.4']]) await chg('input.cmx[data-k="' + k + '"]', v, pg2);
  await pg2.evaluate(() => { const d = document.querySelector('details.cm-lines'); if (d) d.open = true; });
  await chg('textarea.cmx[data-k="surge"]', '150, 420\n250, 60', pg2); await chg('textarea.cmx[data-k="choke"]', '560, 420\n600, 60', pg2); await chg('#cm-embed', true, pg2);
  const order = await pg2.evaluate(() => [...document.querySelectorAll('#i-details .sec[data-sec]')].map(e => e.dataset.sec));
  const ix = s => order.indexOf(s);
  ok(['turbo-and-intercooler-sizing', 'your-compressor-map', 'where-to-put-them-on-this-build', 'turbo-manifold', 'exhaust-after-the-turbine'].every(s => ix(s) >= 0) &&
    ix('turbo-and-intercooler-sizing') < ix('your-compressor-map') && ix('your-compressor-map') < ix('where-to-put-them-on-this-build') && ix('where-to-put-them-on-this-build') < ix('turbo-manifold') && ix('turbo-manifold') < ix('exhaust-after-the-turbine'),
    'both: sections in order sizing, your map, placement, manifold, exhaust after the turbine: ' + order.join(' > '));
  const S = await pg2.evaluate(() => (window.__tg.steps() || []).map(x => ({ id: x.id, line: x.line })));
  ok(S.map(x => x.id).join(',') === 'engine,air,turbo,ar,pipes,ic,oil,valves,mani,exh,scan,sheet', 'both: checklist steps ' + S.map(x => x.id).join(','));
  ok(/demand plotted on your map: surge margin -?[\d.]+ %, choke margin -?[\d.]+ %/.test(S.find(x => x.id === 'turbo').line) && /while a valve is open/.test(S.find(x => x.id === 'mani').line), 'both: the map margins on “Pick a turbo”, the open-period loss on “Turbo manifold”');
  const D = await pg2.evaluate(() => { const s = window.__tg.sheet(), doc = window.__tg.doc(), x = new DOMParser().parseFromString(doc, 'application/xhtml+xml');
    return { parts: s.parts.map(p => p[0]), nums: s.nums.map(n => n[0]), svg: s.svg.map(v => v.length), map: /<image href="data:image\/png;base64,/.test(s.mapSvg), xml: !x.querySelector('parsererror'), mfd: /id="mfd-svg"/.test(doc), h2: (doc.match(/<h2>/g) || []).length, copy: /may be the maker’s copyright/.test(doc) }; });
  ok(D.xml && D.mfd && D.map && D.copy, 'both: the build sheet is well-formed XHTML with the manifold drawing, the map image (ticked) and its copyright line');
  ok(D.parts.includes('Runners') && D.parts.includes('Turbo manifold') && D.parts.some(p => /^Mount 1 bracket \(Turbo \(Intake tab\)\)/.test(p)) && D.parts.includes('Turbo oil feed') && D.parts.includes('Turbo oil drain'), 'both: the sheet has the manifold, mounts (the turbo) and oil rows: ' + D.parts.filter(p => /Runner|manifold|Mount|oil/i.test(p)).join('; '));
  ok(D.nums.some(n => /^On your map: /.test(n)) && D.nums.some(n => /^Manifold loss, port to turbine flange, while a valve is open/.test(n)) && D.svg.filter(v => v > 0).length === 3, 'both: map numbers and manifold numbers together, three route drawings');
  const before = await pg2.evaluate(() => { const X = window.__mfd.last(), M = window.__cmap.compute(); return { L: X.L, dK: X.marchK ? X.marchK.dp0 : NaN, sm: M.sm, cm: M.cm, x: M.peak && M.peak.x }; });
  const snap = await pg2.evaluate(() => window.__proj.snapshot('both')), js = JSON.stringify(snap);
  ok(snap.ui.mfd && snap.ui.cmap && snap.ui.cmap.surge.length === 2 && snap.vals['i-msp'] && !/data:image/.test(js) && !/blob:/.test(js), 'both: the project holds the manifold and map settings and no image data (' + js.length + ' characters)');
  const ctx4 = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p4 = reads(await ctx4.newPage()); const e4 = []; p4.on('pageerror', e => e4.push(e.message));
  await open(p4); await p4.evaluate(s => window.__proj.apply(s), snap); await settle(p4);
  const after = await p4.evaluate(() => { const X = window.__mfd.last(), M = window.__cmap.compute(); return X && M && !M.err ? { L: X.L, dK: X.marchK ? X.marchK.dp0 : NaN, sm: M.sm, cm: M.cm, x: M.peak && M.peak.x, img: window.__cmap.img() } : null; });
  ok(after && Math.abs(after.L - before.L) < 1e-9 && Math.abs(after.dK - before.dK) < 1e-6 && Math.abs(after.sm - before.sm) < 1e-12 && Math.abs(after.cm - before.cm) < 1e-12 && Math.abs(after.x - before.x) < 1e-12 && after.img === null,
    'both: a fresh profile loads the project to the same manifold length and loss and the same margins, without the image');
  ok(!e2.length && !e4.length && !errs.length, 'no page errors' + ([...errs, ...e2, ...e4].length ? ': ' + [...errs, ...e2, ...e4].slice(0, 3).join(' | ') : ''));
  await ctx4.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  await b.close();
  console.log(JSON.stringify(cases));
  console.log(fails.length ? 'boostaudit3_ui: ' + fails.length + ' FAILED' : 'boostaudit3_ui: all pass');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
