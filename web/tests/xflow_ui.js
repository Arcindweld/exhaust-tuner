// Exhaust after the turbine, part 2 (2026-11-12): cooling along the pipe, compressible flow, size steps, one muffler model.
// node tests/xflow_ui.js   (from web/)
//
// Known answers (each worked here from its source, not from the page):
//  Fanno, gamma 1.4, Darcy f (Powers, Notre Dame AME 30332 notes, eq. 4.492): f L*/D = (1 - M^2)/(gamma M^2) + (gamma + 1)/(2 gamma)
//    ln[(gamma + 1) M^2 / (2 + (gamma - 1) M^2)]; the published Fanno table (gamma 1.4; e.g. Anderson, Modern Compressible Flow,
//    Table A.4, "4 f L*/D" with the Fanning f, = Darcy f L*/D): M 0.2 14.533, 0.3 5.2993, 0.5 1.0691, 0.8 0.07229; p/p* =
//    (1/M) sqrt((gamma + 1)/(2 + (gamma - 1) M^2)): 0.3 3.6191, 0.5 2.1381, 0.8 1.2893. A pipe from M 0.3 to 0.8 at f 0.02,
//    D 50 mm: L = D (5.2993 - 0.07229)/f = 13.0675 m and p1/p2 = 3.6191/1.2893 = 2.8070.
//  Heat loss at a fixed overall coefficient U on the bore (constant cp): T(L) = Ta + (T0 - Ta) exp(-U pi D L / (m cp)); 0.2 kg/s,
//    60 mm, 3 m, U 50 W/m2 K, cp 1200, 800 °C in 30 °C air: 30 + 770 exp(-0.117810) = 714.4262 °C.
//  Compressible sudden enlargement (momentum on the step with the jet's static pressure over the large section, continuity,
//    T0 held), gamma 1.4: p1 M1 a sqrt(psi1) = p2 M2 sqrt(psi2) and p1 (1 + gamma M1^2 a) = p2 (1 + gamma M2^2), a = A1/A2,
//    solved forward for M2 here; the page solves it backward by bisection on the speed. Low Mach: Borda-Carnot (1 - a)^2 q1.
//  Rennels' sharp contraction (python-fluids contraction_sharp 'Rennels'): lambda = 1 + 0.622 (1 - 0.215 b^2 - 0.785 b^5),
//    K = 0.0696 (1 - b^5) lambda^2 + (lambda - 1)^2 on the small section's head, as a loss of total pressure.
//  Incompressible limit: below Mach 0.1 the march reproduces the first method's formulas within 0.5% (pipes) and 1% (with the
//    muffler and tip, against the first method with the head as 1/2 rho v^2).
//  The whole turbo case (turboguide_ui case A) and a second case against tools/validation/boost/xflow.py (its own solution of
//    the equations: solve_ivp on the primitive equations, brentq states; run 2026-11-12):
//    case 1 back pressure 7700.128 Pa (page 7716.365), total 52380.103 (52389.500), tip T0 1127.4973 K (1127.4880);
//    case 2 (one bend, plug muffler, 88.9 mm tail pipe, wrap, 60 mph, Wendland's factors) 120749.896 Pa (page 120752.065).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.abs(want), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(9) : a) + ', known ' + (+want.toPrecision(9)));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = [];
  // pg.$eval / pg.$$eval read in one call after the page has stopped re-rendering (tests/settle.js; audit F1)
  require('./settle').reads(pg);
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers'); await pg.waitForTimeout(900); await require('./settle').typedPoint(pg);
  const setv = async (id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await pg.waitForTimeout(150); };

  // ---- Fanno: the formula against the published table, then the page's pipe march against both
  const g = 1.4, Fz = M => (1 - M * M) / (g * M * M) + (g + 1) / (2 * g) * Math.log((g + 1) * M * M / (2 + (g - 1) * M * M)), pps = M => Math.sqrt((g + 1) / (2 + (g - 1) * M * M)) / M;
  [[0.2, 14.533], [0.3, 5.2993], [0.5, 1.0691], [0.8, 0.07229]].forEach(([M, t]) => near(Fz(M), t, 6e-5, 'Fanno f L*/D at M ' + M + ' (formula against the table)'));
  [[0.3, 3.6191], [0.5, 2.1381], [0.8, 1.2893]].forEach(([M, t]) => near(pps(M), t, 5e-5, 'Fanno p/p* at M ' + M));
  const fan = await pg.evaluate(([F03, F08, F05]) => { const T = window.__tsx; T.XF_GAS.g = 1.4; const g = 1.4, R = T.EXH_GAS.R, psi = M => 1 + (g - 1) / 2 * M * M;
    const run = (M1, M2, Fa, Fb) => { const m = 0.3, d = 50, A = Math.PI * 0.025 ** 2, T0 = 1000, p2 = m * Math.sqrt(R * T0) / (A * Math.sqrt(g) * M2 * Math.sqrt(psi(M2))), f = 0.02, L = d * (Fa - Fb) / f;
      const r = T.xPipeBack({ m, d, L, n90: 0, prof: null, fixF: f }, T.xSt(m, A, p2, T0)); return { L, M1: r.su.M, ratio: r.su.p / p2, p0r: r.su.p0 / T.xSt(m, A, p2, T0).p0 }; };
    const a = run(0.3, 0.8, F03, F08), c = run(0.5, 0.8, F05, F08);
    const m = 0.3, A = Math.PI * 0.025 ** 2, sd = T.xSt(m, A, m * Math.sqrt(R * 1000) / (A * Math.sqrt(g) * 0.997 * Math.sqrt(psi(0.997))), 1000), ch = T.xPipeBack({ m, d: 50, L: 100, n90: 0, prof: null, fixF: 0.02 }, sd);
    T.XF_GAS.g = null; return { a, c, ch: ch.choke || null }; }, [Fz(0.3), Fz(0.8), Fz(0.5)]);
  near(fan.a.L, 13067.53, 1e-4, 'Fanno pipe 0.3 -> 0.8 at f 0.02, D 50 mm: length, mm');
  near(fan.a.M1, 0.3, 1e-6, 'Fanno pipe: the page’s march finds M 0.3 upstream'); near(fan.a.ratio, pps(0.3) / pps(0.8), 1e-6, 'Fanno pipe: p1/p2 = (p/p*)(0.3) / (p/p*)(0.8) (table 3.6191 / 1.2893 = 2.8070)');
  near(fan.c.M1, 0.5, 1e-6, 'Fanno pipe 0.5 -> 0.8: M 0.5 upstream'); near(fan.c.ratio, pps(0.5) / pps(0.8), 1e-6, 'Fanno pipe 0.5 -> 0.8: p1/p2');
  const p0ps = M => Math.pow((2 + (g - 1) * M * M) / (g + 1), (g + 1) / (2 * (g - 1))) / M;
  near(fan.c.p0r, p0ps(0.5) / p0ps(0.8), 1e-6, 'Fanno pipe 0.5 -> 0.8: stagnation pressure ratio p01/p02 (table p0/p0* 1.3398 / 1.0382)');
  ok(!!fan.ch && fan.ch.M > 0.995, 'a pipe whose exit is at Mach 0.997 is reported as choked (' + (fan.ch && fan.ch.M.toFixed(3)) + ')');

  // ---- heat loss: the closed-form exponential at a fixed U (calcSkin's own march, test hook U)
  const ht = await pg.evaluate(() => { const T = window.__tsx;
    const a = T.calcSkin({ mdot: 0.2, Tg: 800, di: 60, wall: 1.651, mat: '304', fin: 'ox', Ta: 30, v: 0, L: 3000, caf: 1, U: 50, cpGas: () => 1200 });
    const b = T.calcSkin({ mdot: 0.2, Tg: 800, di: 60, wall: 1.651, mat: '304', fin: 'ox', Ta: 30, v: 0, L: 3000, caf: 1, U: 50, cpGas: T.xCp });
    const c = T.calcSkin({ mdot: 0.2, Tg: 800, di: 60, wall: 1.651, mat: '304', fin: 'ox', Ta: 30, v: 0, L: 3000, caf: 1 });
    const d = T.calcSkin({ mdot: 0.2, Tg: 800, di: 60, wall: 1.651, mat: '304', fin: 'ox', Ta: 30, v: 0, L: 3000, caf: 1, cpGas: T.xCp });
    // the burned gas's cp(T): RK4 on dT/dx = -U pi D (T - Ta) / (m cp(T)), 3000 steps
    let Tk = 1073.15; const f = t => -50 * Math.PI * 0.06 * (t - 303.15) / (0.2 * T.xCp(t)), h = 0.001;
    for (let i = 0; i < 3000; i++) { const k1 = f(Tk), k2 = f(Tk + h / 2 * k1), k3 = f(Tk + h / 2 * k2), k4 = f(Tk + h * k3); Tk += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6; }
    return { a: a.pts[a.pts.length - 1].Tg, b: b.pts[b.pts.length - 1].Tg, rk: Tk - 273.15, air: c.pts[c.pts.length - 1].Tg, gas: d.pts[d.pts.length - 1].Tg, cpA: 1005 + 0.195 * (1073.15 - 300), cpG: T.xCp(1073.15) }; });
  const Tx = 30 + 770 * Math.exp(-50 * Math.PI * 0.06 * 3 / (0.2 * 1200));
  // calcSkin steps 10 mm explicitly (Euler): its error in the exponent is about (dx / lambda)^2 / 2 a step, lambda = m cp / (U pi D)
  // = 25.5 m, so 2.3e-5 of (T - Ta) over the 300 steps; the tolerance is 5e-5 of the drop's driving difference
  near(ht.a - 30, Tx - 30, 5e-5, 'heat loss at U 50 W/m² K, cp 1200: outlet T − Ta against (T0 − Ta) e^(−U π D L / (m cp)), T = ' + Tx.toFixed(4) + ' °C');
  near(ht.b - 30, ht.rk - 30, 5e-5, 'the same with the burned gas’s cp(T): calcSkin’s march against an RK4 integration');
  ok(ht.gas > ht.air && Math.abs((ht.gas - 30) / (ht.air - 30) - 1) < 0.2, 'the burned gas’s cp (' + ht.cpG.toFixed(0) + ' against air’s ' + ht.cpA.toFixed(0) + ' J/kg K at 800 °C) cools the gas less: ' + ht.gas.toFixed(1) + ' against ' + ht.air.toFixed(1) + ' °C at the outlet; the Headers tab keeps air’s (no cpGas)');

  // ---- compressible sudden enlargement, forward closed form against the page's backward solution
  const ex = await pg.evaluate(() => { const T = window.__tsx; T.XF_GAS.g = 1.4; const g = 1.4, R = T.EXH_GAS.R, psi = M => 1 + (g - 1) / 2 * M * M;
    const fwd = (M1, a) => { const lhs = (1 + g * M1 * M1 * a) / (M1 * a * Math.sqrt(psi(M1))); let lo = 1e-6, hi = 1; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2, v = (1 + g * mid * mid) / (mid * Math.sqrt(psi(mid))); if (v > lhs) lo = mid; else hi = mid; } return (lo + hi) / 2; };
    const one = (M1, a) => { const d1 = 50, A1 = Math.PI * (d1 / 2000) ** 2, A2 = A1 / a, T0 = 1100, p1 = 150000, m = p1 * A1 * M1 * Math.sqrt(g / (R * T0 / psi(M1)));
      const M2 = fwd(M1, a), p2 = p1 * M1 * a * Math.sqrt(psi(M1)) / (M2 * Math.sqrt(psi(M2))), s1 = T.xExpandBack(m, A1, A2, T.xSt(m, A2, p2, T0)), q1 = T.xSt(m, A1, p1, T0);
      return { M2, p2, p1: s1 && s1.p, M1p: s1 && s1.M, dp0: s1 && (s1.p0 - T.xSt(m, A2, p2, T0).p0), q1: q1.q, bc: (1 - a) ** 2 * q1.q }; };
    const r = { hi: one(0.6, 0.5), lo: one(0.04, 0.5) };
    // past the limit: the downstream state an upstream Mach 0.9995 would give, made a little faster: no subsonic upstream state
    const a = 0.3, M2c = fwd(0.9995, a), A1 = Math.PI * 0.025 ** 2, A2 = A1 / a, T0 = 1100, m = 0.4;
    const p2c = m * Math.sqrt(R * T0) / (A2 * Math.sqrt(g) * (M2c * 1.05) * Math.sqrt(psi(M2c * 1.05)));
    r.choke = T.xExpandBack(m, A1, A2, T.xSt(m, A2, p2c, T0)) === null; T.XF_GAS.g = null; return r; });
  near(ex.hi.p1, 150000, 1e-7, 'sudden enlargement, M 0.6, area ratio 0.5: upstream static pressure from the downstream state (forward M2 ' + ex.hi.M2.toFixed(5) + ')');
  near(ex.hi.M1p, 0.6, 1e-6, 'sudden enlargement: upstream Mach 0.6 recovered');
  near(ex.lo.dp0, ex.lo.bc, 2e-3, 'sudden enlargement at Mach 0.04: total-pressure loss → Borda-Carnot (1 − a)² q₁');
  ok(ex.hi.dp0 > ex.hi.bc, 'at Mach 0.6 the compressible loss (' + ex.hi.dp0.toFixed(0) + ' Pa) is above Borda-Carnot’s incompressible ' + ex.hi.bc.toFixed(0) + ' Pa');
  ok(ex.choke, 'a downstream state no subsonic upstream flow can feed: the step is reported as choked (null)');

  // ---- incompressible limit: the march against the first method's formulas at Mach < 0.1
  const lim = await pg.evaluate(() => { const T = window.__tsx;
    const base = { me: 0.04, nt: 1, xn: 1, t4: 600, dOut: 0, d: 72.898, L: 3000, n90: 2, xb: 0, cat: null, muf: null, tail: null };
    const n = (72.898 / 152.4) ** 2, muf = { d: 72.898, items: [{ kind: 'expansion', n }, { kind: 'contraction', n }], holes: [], nHole: 1 };
    const full = Object.assign({}, base, { muf, tail: { secs: [{ d: 72.898, L: 2000 }], dExit: 72.898 }, xb: 1 });
    const a = T.exhMarch(base), a0 = T.exhAfterTurbine(base), c = T.exhMarch(full), c0 = T.exhAfterTurbine(Object.assign({}, full, { H2: true })), c1 = T.exhAfterTurbine(full);
    return { a: a.bp, a0: a0.bp, c: c.bp, c0: c0.bp, c1: c1.bp, M: Math.max(...c.rows.map(x => Math.max(x.sIn.M, x.sOut.M))) }; });
  near(lim.a, lim.a0, 5e-3, 'Mach < 0.1, downpipe with 2 bends only: the march against the first method (' + ((lim.a / lim.a0 - 1) * 100).toFixed(3) + '%)');
  near(lim.c, lim.c0, 1e-2, 'Mach ' + lim.M.toFixed(3) + ', downpipe, chamber, tail pipe, tip: against the first method with the head as ½ ρ v² (' + ((lim.c / lim.c0 - 1) * 100).toFixed(3) + '%; the first method as it was: ' + ((lim.c / lim.c1 - 1) * 100).toFixed(2) + '%, its 1.4 ÷ gamma head)');

  // ---- one muffler model: the Mufflers tab's rows and the turbo exhaust use the same function
  await pg.click('#m-expert').catch(() => {}); await pg.click('#u-met'); await pg.waitForTimeout(200);
  ok(await pg.evaluate(() => /mufElems/.test(window.__tsx.xMuffler.toString()) && !/reversal_expansion/.test(window.__tsx.xMuffler.toString())), 'xMuffler calls mufElems (no copy of the elements left in it)');
  const cases = [['chamber', 'straight-through chamber', [['m-chlay', 'through'], ['m-mach', '0.15']], (d, dch) => { const n = (d / dch) ** 2; return (1 - n) ** 2 + (1 - n) / 2; }],
    ['chamber', 'reverse-flow chamber', [['m-chlay', 'reverse'], ['m-mach', '0.12']], () => 1.5],
    ['plug', 'plug muffler', [['m-chlay', 'through'], ['m-plugl', '100'], ['m-mach', '0.15']], (d, dch, por) => { const x = Math.min(1.66, Math.max(0.31, 4 * por / 100 * 100 / d)); return 3.136 * Math.pow(x, -1.391) + 2.208 * Math.pow(x, -1.5818); }],
    ['baffle', 'baffled chambers', [['m-plugl', '0'], ['m-nbaf', '3'], ['m-bh', '50'], ['m-mach', '0.1']], null]];
  for (const [kind, name, sets, Kof] of cases) {
    for (const [id, v] of sets) await setv(id, v);
    await pg.waitForTimeout(250);
    const r = await pg.evaluate(kind => { const T = window.__tsx, M = +document.getElementById('m-mach').value, E = T.xMuffler(kind), q = T.mufInputs();
      return { tab: T.mufBP()[kind], shared: E.err ? null : T.mufElemLoss(E, 1.4 * 101325 * M * M / 2).total, H: 1.4 * 101325 * M * M / 2, d: q.d, dch: q.dch, por: q.por, nHole: E.nHole, N: E.N, dh: E.dh }; }, kind);
    ok(r.tab === r.shared && r.tab > 0, name + ': the Mufflers tab’s row and the turbo exhaust’s muffler give the same ' + (r.tab && r.tab.toFixed(3)) + ' Pa');
    if (Kof) near(r.tab, Kof(r.d, r.dch, r.por) * r.H, 1e-12, name + ': by hand (Munjal 1987 eq. 8.4 / Table 3.1; Munjal et al. 2013)');
    else { const nc = (r.d / r.dch) ** 2, nh = Math.min(1, (r.dh / r.dch) ** 2), K = (1 - nc) ** 2 + (1 - nc) / 2 + (r.N - 1) * ((1 - nh) / 2 + (1 - nh) ** 2) * r.nHole * r.nHole;
      near(r.tab, K * r.H, 1e-12, name + ': by hand, the chamber’s in and out plus each hole’s contraction and expansion at the hole’s head (' + (r.N - 1) + ' holes)'); }
  }
  await setv('m-nbaf', '0'); await setv('m-bh', ''); await setv('m-mach', '0');

  // ---- the turbo build (turboguide_ui case A)
  await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(600);
  const tso = async (k, v) => { await pg.evaluate(([k, v]) => { const el = document.querySelector('select.tsox[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]); await pg.waitForTimeout(150); };
  const secTxt = () => pg.$eval('#i-details .sec[data-sec="exhaust-after-the-turbine"]', e => e.innerText).catch(() => '');
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(300); await setv('i-hp', '450');
  await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });
  const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862')));
  await tso('turbo', String(ti));
  const hs4 = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.outlet === '4-bolt'), ti);
  await tso('hs', String(hs4)); await pg.click('button[data-tsuse]'); await pg.waitForTimeout(300);
  await setv('s-ind', 'turbo1'); await setv('m-dp', '72.898'); await setv('s-od', '76.2'); await setv('s-len', '2500'); await setv('i-xcat', 'none'); await setv('i-dpb', '0'); await setv('i-xmuf', 'chamber');
  await pg.waitForTimeout(300);
  const A = await pg.evaluate(() => { const X = window.__tsx.last(); return X && { bp: X.X.bp, bp0: X.X.bp0, S: [X.X.S.v0, X.X.S.v1, X.X.S.v2, X.X.S.v3, X.X.S.v4], T0tip: X.X.T0tip, sep: X.X.sep && X.X.sep.bp,
    rows: X.X.rows.map(r => ({ k: r.k, dp: r.dp, dp0: r.dp0, Tin: r.sIn.T, Min: r.sIn.M, Mout: r.sOut.M })) }; });
  ok(!!A, 'case A: the march ran');
  if (A) {
    near(A.bp, 7700.128, 3e-3, 'case A back pressure (static at the turbine outlet) against xflow.py');
    near(A.bp0, 52380.103, 1e-3, 'case A total pressure at the turbine outlet against xflow.py');
    near(A.T0tip, 1127.4973, 2e-5, 'case A gas at the tip (K) against xflow.py (solve_ivp)');
    near(A.S[0], 39301.66, 1e-6, 'the first method’s figure for case A is kept as the comparison’s start (turboguide_ui by hand: 39301.66 Pa)');
    // pinned so a later change shows: the page's own values, 2026-11-12
    [[37083.220, 'with the head ½ ρ v²'], [36427.596, '+ cooling'], [36377.417, '+ compressible'], [7716.365, '+ size changes (the turbine-outlet cone’s recovery)']].forEach(([v, m], i) => near(A.S[i + 1], v, 1e-7, 'what each change moved, ' + m));
    ok(A.S.every((v, i) => i === 0 || v < A.S[i - 1]), 'each change lowers case A’s figure (head, cooling, compressible, size changes)');
    ok(A.rows.map(r => r.k).join(',') === 'cone,dp,muf,tail,tip' && A.rows.every(r => r.Mout >= r.Min || r.k === 'cone'), 'rows turbine outlet to tip; Mach rises along every part but the widening cone');
    near(A.rows.reduce((a, r) => a + r.dp, 0), A.bp, 1e-12, 'the static rises add up to the back pressure');
    ok(A.sep > A.bp, 'the cone taken as separated (sudden widening) gives the higher ' + (A.sep / 1000).toFixed(2) + ' kPa');
    const t = await secTxt();
    ok(/Total pressure there/.test(t) && /If the flow separates in the cone/.test(t) && /What each change moved/.test(t) && /First method/.test(t), 'the section shows the total pressure, the separated-cone figure and what each change moved');
    await pg.click('button[data-tsx="use"]'); await pg.waitForTimeout(300);
    near(await pg.evaluate(() => document.getElementById('i-tobp')._b * 1000), A.bp, 1e-9, '“Use my exhaust’s back pressure” puts the new figure in the turbine balance');
    const st = await pg.evaluate(() => { const li = document.querySelector('#tg-steps > li[data-step="exh"]'); return li && { s: li.dataset.state, t: li.innerText }; });
    ok(st && st.s === 'ok' && /static at the turbine outlet/.test(st.t) && /compressible flow/.test(st.t), 'checklist step 8 done, with the new basis: ' + (st && st.t.split('\n').pop()));
    await setv('i-tobp', '');
  }
  // dual units in the exhaust tables
  const one = await pg.evaluate(() => { const cells = [...document.querySelectorAll('#tsx-bp td, #tsx-steps td')].map(td => td.innerText);
    const bad = []; cells.forEach(c => { if (/\d\s?mm\b/.test(c) && !/\d\s?in\b/.test(c)) bad.push(c); if (/kPa/.test(c) !== /psi/.test(c)) bad.push(c); if (/°C/.test(c) !== /°F/.test(c)) bad.push(c); if (/m\/s/.test(c) !== /ft\/s/.test(c)) bad.push(c); }); return bad; });
  ok(one.length === 0, 'every size, pressure, temperature and speed in the exhaust tables in both units' + (one.length ? ': ' + one.slice(0, 2).join(' / ') : ''));

  // ---- a contraction step (Sound tab pipe 63.5 mm OD after the 72.9 mm muffler pipe): Rennels' sharp contraction
  await setv('s-od', '63.5'); await pg.waitForTimeout(300);
  const C = await pg.evaluate(() => { const X = window.__tsx.last(), r = X.X.rows.find(x => x.k === 'step'); return r && { K: r.K, d1: r.d1, d2: r.d2, dp0: r.dp0, q2: r.sOut.q, exp: r.exp }; });
  if (C) { const bt = C.d2 / C.d1, lam = 1 + 0.622 * (1 - 0.215 * bt * bt - 0.785 * bt ** 5), K = 0.0696 * (1 - bt ** 5) * lam * lam + (lam - 1) ** 2;
    near(C.K, K, 1e-12, 'contraction 72.9 → 60.2 mm: Rennels’ sharp K by hand'); near(C.dp0, K * C.q2, 1e-6, 'contraction: total-pressure loss K × the small pipe’s ½ ρ v²'); }
  else ok(false, 'a step row for the contraction');
  // ---- choking: a 1.5 in tail pipe at 450 hp
  await setv('s-od', '38.1'); await pg.waitForTimeout(300);
  let t = await secTxt();
  const ch = await pg.evaluate(() => { const X = window.__tsx.last(); return { c: X.X.choke, dis: document.querySelector('button[data-tsx="use"]').disabled, st: document.querySelector('#tg-steps > li[data-step="exh"]').dataset.state }; });
  ok(ch.c && ch.c.k === 'tip' && /This exhaust chokes at the tip/.test(t) && /the pipe or part is too small/.test(t) && !/Back pressure after the turbine at peak power/.test(t), 'a 38.1 mm OD tail pipe chokes at the tip: said in words, no back pressure given');
  ok(ch.dis && ch.st === 'warn', 'choked: the Use button is off and checklist step 8 warns');
  // a downpipe narrower than the pipe after it chokes at its exit into the wider pipe
  await setv('s-od', '76.2'); await setv('i-dpd', '36'); await pg.waitForTimeout(300); t = await secTxt();
  const ch2 = await pg.evaluate(() => window.__tsx.last().X.choke);
  ok(ch2 && /chokes at/.test(t) && (ch2.k === 'step' || ch2.k === 'dp'), 'a 36 mm downpipe into the 72.9 mm muffler pipe chokes (' + (ch2 && ch2.k + ': ' + ch2.why) + ')');
  await setv('i-dpd', '');
  // ---- twins into one pipe: the Y is a size change that is not counted
  await setv('i-nt', '2'); await setv('i-hp', '450'); await pg.waitForTimeout(400); t = await secTxt();
  const y = await pg.evaluate(() => { const X = window.__tsx.last(); return X && X.X.rows && X.X.rows.filter(r => r.k === 'step').map(r => ({ y: r.y, dp: r.dp })); });
  ok(y && y.some(r => r.y && r.dp === 0) && /the Y where they meet is not counted/.test(t), 'twin downpipes into one pipe: the step at the Y is shown as not counted');
  await setv('i-nt', '1');
  // ---- the cooling inputs move the result the right way
  const bpOf = async () => pg.evaluate(() => window.__tsx.last().X.bp);
  const b0 = await bpOf(); await setv('i-xcool', 'off'); const bOff = await bpOf(); await setv('i-xcool', 'on'); await setv('i-xcaf', 'w'); const bW = await bpOf(); await setv('i-xcaf', '1');
  await setv('i-xfin', 'wrap2'); const bWr = await bpOf(); await setv('i-xfin', 'ox');
  ok(bOff > b0 && bW < b0 && bWr > b0, 'no cooling raises the back pressure (' + bOff.toFixed(0) + ' Pa), Wendland’s factors lower it (' + bW.toFixed(0) + '), two layers of wrap raise it (' + bWr.toFixed(0) + ') against ' + b0.toFixed(0) + ' Pa');

  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  if (fails.length) { console.log(fails.length + ' FAILED'); process.exit(1); }
  console.log('xflow_ui: all pass');
})();
