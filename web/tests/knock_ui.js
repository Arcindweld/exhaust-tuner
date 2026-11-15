// The knock estimate (2026-11-15, docs/WAVE_VALIDATION_2026-11-11.md part 12): knockLib (Douaud and Eyzat's autoignition
// delay, the unburned gas's isentropic temperature along the cylinder pressure, the Livengood-Wu integral to the burn end),
// the engine's cylinder trace, and the simulation's knock pass. Runs in Node (no browser), about a minute. Reference values
// are worked here or by tools/validation/wave/knock_ref.py (independent quadrature), not read back from the page:
//  1. tau at stated p, T, ON against the formula worked here, and the published constants (0.01768 s, 3.402, 1.7, 3800 K);
//  2. the integral on synthetic histories: constant state (t / tau exactly), linear ramps and an isentropic-like sweep
//     (knock_ref.py's Simpson values), the burn end and the knock angle; the octane index RON - K S;
//  3. the isentropic temperature with constant cp and R against T0 (p / p0)^(R / cp) exactly;
//  4. monotonic trends on an engine run: more boost, a hotter charge, more compression -> a larger integral; a higher
//     octane number -> a smaller one; retarding the timing reduces it; the pressure scale and the IVC temperature shift too;
//  5. the trace asked for changes no result, and tsimRun with the knock check gives the same rows as without it, plus
//     its own knock summary (the retard search, the limit boost per fuel).
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const slice = (from, to) => { const a = html.indexOf(from), z = html.indexOf(to, a); if (a < 0 || z < 0) throw new Error('not found: ' + from); return html.slice(a, z); };
const WS = new Function(slice('function wsFactory(){', '\nconst WS=wsFactory();') + '\nreturn wsFactory();')();
const knockSrc = slice('function knockLib(WS){', '\nfunction turboSimLib(WS,X){');
const KN = new Function('WS', knockSrc + '\nreturn knockLib(WS);')(WS);
const rel = (a, b) => Math.abs(a / b - 1), ATM = 101325;
// 1
ok(KN.DE.A === 0.01768 && KN.DE.a === 3.402 && KN.DE.n === 1.7 && KN.DE.B === 3800, 'Douaud and Eyzat constants as published: 0.01768 s, (ON/100)^3.402, p^-1.7 (atm), exp(3800 K / T)');
{ const hand = 0.01768 * Math.pow(0.95, 3.402) * Math.pow(40, -1.7) * Math.exp(3800 / 800);
  const t = KN.tau(95, 40 * ATM, 800); ok(rel(t, hand) < 1e-14 && rel(t, 0.003244104009) < 1e-9, 'tau(ON 95, 40 atm, 800 K) = ' + (t * 1000).toFixed(6) + ' ms (hand ' + (hand * 1000).toFixed(6) + ', knock_ref.py 3.244104 ms)');
  const t2 = KN.tau(100, ATM, 1000); ok(rel(t2, 0.01768 * Math.exp(3.8)) < 1e-14, 'tau(ON 100, 1 atm, 1000 K) = 17.68 ms x e^3.8 = ' + (t2 * 1000).toFixed(3) + ' ms'); }
// 2: synthetic histories in crank angle at 3000 rpm (18000 deg/s): IVC at 0, the burn end at 90 deg (Wiebe 55 deg)
const eng0 = { ivc: 0, e: { burn: { dur: 55 } }, gas: null }, bA = KN.burnAngle(55, 0.9);
eng0.ign = 90 - bA;
const mk = (n, fp, fT) => { const pts = [], Tu = []; for (let i = 0; i <= n; i++) { const u = 120 * i / n; pts.push({ u, p: fp(u), T: fT(u), x: 1 }); Tu.push(fT(u)); } return { pts, Tu }; };
ok(rel(bA, 55 * Math.pow(Math.log(10) / 5, 1 / 3)) < 1e-15 && rel(KN.burnAngle(55, 0.5), 55 * Math.pow(Math.log(2) / 5, 1 / 3)) < 1e-15, 'the Wiebe burn end: 90 % at ' + bA.toFixed(3) + ' deg, 50 % at ' + KN.burnAngle(55, 0.5).toFixed(3) + ' deg after the start (a 5, m 2)');
{ const { pts, Tu } = mk(12000, () => 40 * ATM, () => 800), r = KN.integral(pts, Tu, eng0, 3000, { ON: 95 }), hand = 0.005 / 0.003244104009;
  ok(rel(r.I, hand) < 1e-9, 'constant 40 atm, 800 K, ON 95 for 90 deg at 3000 rpm (5 ms): I = ' + r.I.toFixed(6) + ' = 5 ms / tau = ' + hand.toFixed(6));
  ok(Math.abs(r.knockAt - 0.003244104009 * 18000) < 0.01, 'it reaches 1 at tau x 18000 deg/s = ' + (0.003244104009 * 18000).toFixed(3) + ' deg after IVC: ' + r.knockAt.toFixed(3) + ' (IVC at 0 here, so firing TDC, the reference of the reported angle, is at 0 too)'); }
{ const { pts, Tu } = mk(12000, u => (20 + 40 * Math.min(u, 90) / 90) * ATM, u => 700 + 250 * Math.min(u, 90) / 90), r = KN.integral(pts, Tu, eng0, 3000, { ON: 90 });
  ok(rel(r.I, 2.772628386) < 2e-6, 'linear ramps 20 -> 60 atm, 700 -> 950 K over 5 ms, ON 90: I = ' + r.I.toFixed(7) + ' (knock_ref.py Simpson 2.7726284)'); }
{ const rr = u => 1 - 0.9 * Math.sin(Math.PI * Math.min(u, 90) / 180), { pts, Tu } = mk(24000, u => 1.5 * ATM * Math.pow(rr(u), -1.3), u => 350 * Math.pow(rr(u), -0.3)), r = KN.integral(pts, Tu, eng0, 3000, { ON: 100 });
  ok(rel(r.I, 0.05901465136) < 2e-5, 'an isentropic-like sweep (V / V0 = 1 - 0.9 sin u, p ~ V^-1.3, T ~ V^-0.3), ON 100: I = ' + r.I.toFixed(8) + ' (knock_ref.py 0.05901465)'); }
{ const { pts, Tu } = mk(12000, () => 40 * ATM, () => 800), a = KN.integral(pts, Tu, eng0, 3000, { ON: 95, xEnd: 0.5 }).I, b = KN.integral(pts, Tu, eng0, 3000, { ON: 95 }).I;
  const e50 = eng0.ign + KN.burnAngle(55, 0.5); ok(rel(a / b, e50 / 90) < 1e-6, 'the burn end convention: to 50 % burned the constant-state integral is ' + (e50 / 90).toFixed(4) + ' of the 90 % one (' + (a / b).toFixed(4) + ')'); }
ok(KN.octaneIndex(95, 87, 0) === 95 && Math.abs(KN.octaneIndex(104, 94, -0.5) - 109) < 1e-12 && Math.abs(KN.octaneIndex(95, 87, 1) - 87) < 1e-12, 'octane index: K 0 = RON 95, K 1 = MON 87, E85 104 / 94 at K -0.5 = 109');
// 3
{ const pts = []; for (let i = 0; i <= 400; i++) pts.push({ u: i, p: ATM * (1 + 50 * i / 400), T: 330, x: 1 });
  const Tu = KN.unburned(pts, null, 0), hand = 330 * Math.pow(51, WS.RG / WS.CP);
  ok(rel(Tu[400], hand) < 1e-12, 'isentropic with constant cp, R: 330 K at 1 -> 51 atm gives ' + Tu[400].toFixed(6) + ' K = 330 x 51^(R/cp) = ' + hand.toFixed(6));
  const Tu2 = KN.unburned(pts, null, 10); ok(rel(Tu2[400], 340 * Math.pow(51, WS.RG / WS.CP)) < 1e-12, 'the IVC temperature shift moves it as (T0 + dT) / T0'); }
// 4: a boosted single cylinder (the captured jobs' single with its chamber, boosted by the intake source)
const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wave_jobs.json'), 'utf8')), s0 = jobs[0].job.variants[0].spec, dx = jobs[0].job.dx;
const boosted = (p, T, cr, start) => Object.assign({}, s0, { e: Object.assign({}, s0.e, { cr: cr || 10, burn: { start: start != null ? start : 18, dur: 55 } }), intake: Object.assign({}, s0.intake, { source: { p, T } }) });
const run = (spec, rpm) => { const eng = WS.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt); let r = WS.runSpeed(eng, { rpm, cycles: 8, dx, trace: true }); return { eng, r, c: KN.check(r.trace, eng, rpm, { ON: 95 }) }; };
const base = run(boosted(160000, 320), 4000);
ok(base.c && base.c.I > 0 && Number.isFinite(base.c.TuEnd) && base.c.TuEnd > base.c.Tivc, 'an engine run: I ' + base.c.I.toFixed(3) + ', IVC ' + base.c.Tivc.toFixed(1) + ' K -> end gas ' + base.c.TuEnd.toFixed(1) + ' K at ' + Math.round(100 * 0.9) + ' % burned, CA50 ' + base.c.ca50.toFixed(2) + ' deg ATDC');
ok(Math.abs(base.c.ca50 - (-18 + KN.burnAngle(55, 0.5))) < 1e-9, 'CA50 = -18 + ' + KN.burnAngle(55, 0.5).toFixed(3) + ' deg');
const I = (o) => KN.check(base.r.trace, base.eng, 4000, Object.assign({ ON: 95 }, o)).I;
ok(I({ ON: 100 }) < base.c.I && I({ ON: 90 }) > base.c.I, 'higher octane -> smaller integral: ON 90 / 95 / 100: ' + [I({ ON: 90 }), base.c.I, I({ ON: 100 })].map(x => x.toFixed(3)).join(' / '));
ok(I({ pScale: 1.2 }) > base.c.I && I({ dT0: 10 }) > base.c.I, 'the cylinder pressure x 1.2 and the IVC 10 K hotter both raise it: ' + I({ pScale: 1.2 }).toFixed(3) + ', ' + I({ dT0: 10 }).toFixed(3));
const more = run(boosted(200000, 320), 4000), hot = run(boosted(160000, 350), 4000), cr = run(boosted(160000, 320, 11), 4000), ret = run(boosted(160000, 320, 10, 10), 4000);
ok(more.c.I > base.c.I, 'more boost (160 -> 200 kPa at the source): ' + base.c.I.toFixed(3) + ' -> ' + more.c.I.toFixed(3));
ok(hot.c.I > base.c.I, 'a hotter charge (320 -> 350 K): ' + base.c.I.toFixed(3) + ' -> ' + hot.c.I.toFixed(3));
ok(cr.c.I > base.c.I, 'more compression (10 -> 11): ' + base.c.I.toFixed(3) + ' -> ' + cr.c.I.toFixed(3));
ok(ret.c.I < base.c.I && ret.r.imep < base.r.imep, 'retarding the burn 18 -> 10 deg BTDC: ' + base.c.I.toFixed(3) + ' -> ' + ret.c.I.toFixed(3) + ', IMEP ' + (base.r.imep / 1e5).toFixed(2) + ' -> ' + (ret.r.imep / 1e5).toFixed(2) + ' bar');
{ const sl = KN.limitScale(base.r.trace, base.eng, 4000, { ON: 95 }, 1, null), at = I({ pScale: sl });
  ok(sl > 0 && Math.abs(at - 1) < 1e-9, 'the pressure factor of the limit: ' + sl.toFixed(4) + ' (I there ' + at.toFixed(9) + ')'); }
// 5: the trace changes nothing, and the knock pass leaves the rows as they were
{ const eng = WS.makeEngine(s0.e, s0.intake, s0.exhaust, s0.opt), a = WS.runSpeed(eng, { rpm: 5000, cycles: 3, dx }), e2 = WS.makeEngine(s0.e, s0.intake, s0.exhaust, s0.opt), b = WS.runSpeed(e2, { rpm: 5000, cycles: 3, dx, trace: true });
  const K8 = ['ve', 'imep', 'pmax', 'resid', 'pEvo', 'tEx', 'overlapPort', 'gimep'];
  ok(K8.every(k => Object.is(a[k], b[k])) && !('trace' in a) && b.trace.length % 4 === 0 && b.trace.length > 4000, 'the trace asked for: every result the same double, ' + b.trace.length / 4 + ' steps of (angle, p, T, x); not asked for: no trace key'); }
{ const TL = new Function('WS', 'X', knockSrc + '\n' + slice('function turboSimLib(WS,X){', '\n// the worker\'s Rust path') + '\nreturn turboSimLib(WS,X);');
  let TLo; try { TLo = TL(WS, null); } catch (e) { TLo = null; }
  const tsimRun = new Function('return ' + slice('function tsimRun(TL,j,post){', '\nfunction tsimStart(){'))();
  const sp = boosted(160000, 320), na = boosted(101325, 298.15), j0 = { spec: sp, na, rpms: [4000, 6000], dx, turbo: false, wcPer: 1000 };
  const t0 = Date.now(), A = tsimRun(TLo, j0, () => {}), Bk = tsimRun(TLo, Object.assign({}, j0, { knock: { ON: 95, xEnd: 0.9, Pt: 160000, comp: null, fuels: [{ k: 'pump', name: 'pump', ON: 95 }, { k: 'e85', name: 'E85', ON: 104 }] } }), () => {});
  const K8 = ['ve', 'imep', 'pmax', 'resid', 'pEvo', 'tEx', 'overlapPort', 'gimep'];
  const same = A.rows.every((r, i) => K8.every(k => Object.is(r.res[k], Bk.rows[i].res[k]))) && A.na.every((r, i) => K8.every(k => Object.is(r[k], Bk.na[i][k])));
  ok(same && !A.knock && !Bk.rows.some(r => 'trace' in r.res), 'tsimRun with the knock check: the same rows and the same run without boost to the last digit; without it no knock output; no trace kept');
  const K = Bk.knock;
  ok(K && !K.err && K.per.length === 2 && K.wi >= 0 && K.lim.length === 2 && K.lim[1].P[1] > K.lim[0].P[1], 'its knock summary: the integral at both speeds (' + (K && K.per.map(q => q.I.toFixed(3)).join(', ')) + '), the limit boost higher for E85 than for pump gas (' + (K && K.lim.map(f => (f.P[1] / 1000).toFixed(1) + ' kPa').join(' vs ')) + ')');
  const R = K && K.retard; ok(!R || (R.ev.length >= 2 && R.band[1] && (R.band[1].inside || R.band[1].none || (R.band[1].start < 18 && R.band[1].bmep < R.base.bmep))), 'the retard search: ' + (R ? R.ev.length + ' runs, ' + (R.band[1].start != null ? 'start ' + R.band[1].start.toFixed(2) + ' deg BTDC, bmep ' + (R.base.bmep / 1e5).toFixed(2) + ' -> ' + (R.band[1].bmep / 1e5).toFixed(2) + ' bar' : JSON.stringify(R.band[1])) : 'not needed (inside)') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)'); }
console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
process.exit(fails.length ? 1 : 0);
