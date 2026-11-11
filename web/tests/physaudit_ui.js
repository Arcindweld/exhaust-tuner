// Physics audit of the closed-form results, 2026-11-11 (docs/PHYSICS_AUDIT_2026-11-11.md): every expected number below
// was computed independently in plain Python from the formula's source (the audit's scratch script), not from the page,
// and the page has to land within the stated tolerance (0.1% wherever the speed of sound enters: the page's sos() uses
// 20.05 sqrt(T), sqrt(1.4 x 287.05) = 20.046 rounded, 0.02% high). The four fixed defects are checked through the page's own rows.
// node tests/physaudit_ui.js   (from web/)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers'); await pg.waitForTimeout(1200);
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol * Math.abs(want), m + ': page ' + (+a.toPrecision(6)) + ', independent ' + (+want.toPrecision(6)) + ' (within ' + (tol * 100) + '%)');
  const v = await pg.evaluate(() => {
    const P = window.__physAudit, o = {};
    const f = P.calcFour({ n: 4, rpm: 6500, evo: 60, dp: 44.45, cr: 0.8, cs: 1.5, er: 2, ang: 8, egt: 650, place: 'collector', tail: 0, port: 0 });
    o.bell = { lp: f.lp, dc: f.dc, rtDeg: f.rtDeg };
    o.jen = P.calcTwo({ rpm: 9000, ed: 190, egt: 500, dh: 40, br: 2.6, da: 8, bl: 0.5, ba: 20, sr: 0.61, rp: 50 }).lt;
    o.blair = P.calcTwoBlair({ rpm: 12000, ed: 195, exd: 40, type: 'gp', port: 0 }).lt;
    o.prim = P.calcPrimarySize({ cc: 5700, cyl: 8, rpm: 4500, wall: 1.651 }).id;
    const h = P.calcHelm({ f: 120, dn: 50.8, ln: 76.2, dpipe: 60.198, tres: 43.333 }); o.helm = { V: h.liters, band: h.band };
    const q = P.calcQW({ f: 120, db: 60.198, dpipe: 60.198, tres: 43.333 }); o.qw = { end: q.end, L: q.L };
    const c = P.calcChamber({ dpipe: 60.198, dch: 152.4, lch: 355.6, tmain: 343.333 }); o.ch = { peak: c.peakTL, f: c.fPeak };
    const n = (60.198 / 152.4) ** 2; o.bp = P.mufBackPressure(0.15, 101325, [{ kind: 'expansion', n }, { kind: 'contraction', n }]).total;
    const s = P.calcSound({ cyc: '4', cyl: 8, idle: 700, cruise: 2000, red: 6000, len: 2500, egt: 343.333, hf: 120, hd: 38.1, hl: 50.8, dpipe: 60.198, tres: 43.333 });
    o.snd = s.err ? { err: s.err } : { f1: s.res[0].f, quarter: s.resonator.quarter, helm: s.resonator.liters };
    o.yas = P.calcYasuda({ c: Math.sqrt(1.4 * 287.05 * 800), V: 0.0038 + 0.00255, d: 40.7, lTail: 500, lRet: 60 });   // equal halves: fRT checked on the paper's split below
    o.baf = P.calcBaffles({ dpipe: 60.198, dsh: 152.4, lch: 355.6, n: 3, dh: 40, t: 1, tC: 343.333 }).f0;
    o.can = P.calcHdrChamber({ type: 'can', x: 200, dp: 44.45, wall: 1.651, dc: 76.2, lc: 100, nh: 4, dh: 6, tch: 500, len: 700 }).f0;
    const sk = P.calcSkin({ mdot: 0.02, Tg: 760, di: 44.45, wall: 1.651, mat: '304', fin: 'ox', Ta: 40, v: 0, L: 800, caf: 2.5 }); o.skin = { hi: sk.pts[0].hi, Re: sk.pts[0].Re };
    const g = P.catGeom(400, 6), d = P.catDp(3 * 1 * g.ofa, Object.assign(g, { Asub: 1, len: 0.1, Apipe: 0.01, cone: 0, tC: 500 })); o.cat = { Re: d.Re, fRe: d.fRe, dpFric: d.dpFric };
    o.stone = [0.8, 0.7, 0.6, 0.5].map(e => P.densRatio(2, e, 0).noIC); o.stoneIC = [0.6, 0.7, 0.8].map(e => P.densRatio(2, 0.7, e).ic);
    const t2 = (25 + 273.15) * (1 + (Math.pow(2, 0.4 / 1.4) - 1) / 0.7) - 273.15;
    const cg = P.calcCharge({ Q: 0.2, nt: 1, d: 60.198, Lh: 914.4, Lc: 914.4, bends: 4, pr: 2, t1: 25, t2, tamb: 25, eff: 0.75, dpIC: 7 });
    o.charge = { dpPipes: cg.hot.dp + cg.cold.dp, dp: cg.dp };
    return o;
  });
  // 4-Stroke: A. Graham Bell's primary P = 850 ED / rpm - 3 in; collector d sqrt(n x ratio); wave round trip 2 L / c in crank degrees
  near(v.bell.lp, 720.96923, 1e-6, 'Bell primary length, mm'); near(v.bell.dc, 79.51458, 1e-6, 'collector diameter, mm'); near(v.bell.rtDeg, 92.3278, 1e-3, 'round trip, crank degrees (c of air at 650 C)');
  // 2-Stroke: Jennings L = ed x Vs / N (in) = c ed / (12 rpm); Blair Lt = 83.3 a0 theta / rpm, GP class at 650 C
  near(v.jen, 980.6285, 1e-3, 'Jennings tuned length, mm'); near(v.blair, 824.8046, 1e-3, 'Blair GP tuned length, mm');
  // Headers: primary area = rpm x CID per cylinder / 88,200
  near(v.prim, 42.68768, 1e-4, 'primary ID from the 88,200 rule, mm');
  // Mufflers: Helmholtz (neck + 0.6133 d), its 3 dB band (Munjal); J-pipe with Ji 2005's end correction; plain chamber
  near(v.helm.V, 4.223828, 1e-3, 'Helmholtz volume for 120 Hz, L'); near(v.helm.band, 188.255, 1e-3, 'Helmholtz 3 dB band, Hz');
  near(v.qw.end, 9.420987, 1e-6, 'J-pipe end correction at x = 1, mm'); near(v.qw.L, 733.5584, 1e-3, 'J-pipe cut length, mm');
  near(v.ch.peak, 10.32443, 1e-4, 'chamber peak TL, dB'); near(v.ch.f, 349.9303, 1e-3, 'chamber peak frequency, Hz');
  near(v.bp, 1810.164, 1e-6, 'chamber back pressure at Mach 0.15, Pa (Munjal 1987, eq. 8.4)');
  // Sound: open quarter-wave pipe with 0.6133 a at the tip; its J-pipe now with the Mufflers tab's end correction (was 0.3 d)
  ok(!v.snd.err, 'calcSound runs' + (v.snd.err ? ': ' + v.snd.err : ''));
  if (!v.snd.err) { near(v.snd.f1, 49.40926, 1e-3, 'first pipe mode, Hz'); near(v.snd.quarter, 732.6838, 1e-3, 'Sound-tab J-pipe cut length, mm (Ji 2005; 731.55 with the old flat 0.3 d)'); near(v.snd.helm, 3.439097, 1e-3, 'Sound-tab Helmholtz volume, L'); }
  // Yasuda: the page's own check on the paper's specimen (3.8 + 2.55 L): fRT with 0.61 d per end
  const fRT = await pg.evaluate(() => { const P = window.__physAudit, c = Math.sqrt(1.4 * 287.05 * 800), S = Math.PI / 4 * 0.0407 ** 2, l = 0.06 + 2 * 0.61 * 0.0407; return c / (2 * Math.PI) * Math.sqrt((1 / 0.0038 + 1 / 0.00255) * S / l); });
  near(fRT, 251.6286, 1e-4, 'Yasuda return-pipe resonance on the paper\'s specimen, Hz (paper 241)');
  near(v.yas.fRT, 246.7051, 1e-4, 'Yasuda return-pipe resonance, the same can split in equal halves, Hz'); near(v.yas.fTP, 56.38354, 1e-4, 'Yasuda low-pass cut-off with a 500 mm tailpipe, Hz');
  near(v.baf, 335.4278, 1e-3, 'baffled chain f0 (Morse and Ingard 9.1), Hz'); near(v.can, 537.6963, 1e-3, 'header can Helmholtz f0 (t + 0.85 d), Hz');
  // Heat: Gnielinski with Petukhov's f at the port, x CAF 2.5
  near(v.skin.Re, 13531.35, 1e-4, 'primary Reynolds number at the port'); near(v.skin.hi, 149.3704, 1e-3, 'inside heat transfer coefficient, W/m2 K');
  // Cats: Shah and London apparent friction in a square channel
  near(v.cat.Re, 43.152, 1e-3, 'cell Reynolds number'); near(v.cat.fRe, 14.3986, 1e-3, 'apparent f Re'); near(v.cat.dpFric, 245.358, 1e-3, 'cell friction drop, Pa');
  // Boost: Stone's density ratio, and the claim on the page now states its real agreement with Stone's chart
  [1.570146, 1.523372, 1.465177, 1.390794].forEach((w, i) => near(v.stone[i], w, 1e-5, 'Stone density ratio, PR 2, eta ' + [0.8, 0.7, 0.6, 0.5][i]));
  [1.777540, 1.828383, 1.882219].forEach((w, i) => near(v.stoneIC[i], w, 1e-5, 'Stone with intercooler, eta 0.7, eps ' + [0.6, 0.7, 0.8][i]));
  // Charge pipes, DEFECT fixed: drawn tube 0.0015 mm (pipe friction 1,059 Pa with commercial steel's 0.045 mm before)
  near(v.charge.dpPipes, 818.1744, 2e-3, 'charge-pipe friction, Pa (smooth drawn tube)'); near(v.charge.dp, 9238.618, 1e-3, 'charge-pipe total loss with 7 kPa intercooler and 4 bends, Pa');

  // ---- the fixed rows, read off the page (metric, expert)
  await pg.click('#m-expert'); await pg.click('#u-met'); await pg.waitForTimeout(200);
  const setv = (id, x) => pg.evaluate(([id, x]) => { const el = document.getElementById(id); el.value = x; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, x]);
  const secText = re => pg.evaluate(src => { const r = new RegExp(src); const s = [...document.querySelectorAll('#m-details .sec')].find(x => r.test(x.innerText)); return s ? s.innerText : ''; }, re);
  // Plug muffler, DEFECT fixed: n = perforate open area / pipe area = 4 x 0.10 x 100 / 60.198 = 0.664 -> 2.81 H = 4.49 kPa at Mach 0.15 (was 4.52 H, 7.2 kPa)
  await setv('m-mach', '0.15'); await setv('m-plugl', '100'); await pg.waitForTimeout(400);
  let t = await secText('Plug \\(cross-flow\\)');
  // Munjal et al. 2013: 3.136 x 0.6645^-1.391 + 2.208 x 0.6645^-1.5818 = 5.54 + 4.21 = 9.75 H; H = 1.4 x 101325 x 0.15^2 / 2 = 1595.9 Pa -> 15.6 kPa
  ok(/Back pressure at Mach 0\.15\s*\n\s*15\.6 kPa/.test(t) && /about 9\.[78] dynamic heads with the holes’ open area 0\.66 × the pipe’s/.test(t), 'plug back pressure 15.6 kPa, 9.75 H at open area 0.66 (Munjal et al. 2013, by hand)');
  // Baffled chambers, DEFECT fixed: the holes' losses at the hole's own dynamic head (pipe area / hole area squared)
  await setv('m-plugl', '0'); await setv('m-nbaf', '3'); await setv('m-bh', '50'); await setv('m-mach', '0.1'); await pg.waitForTimeout(400);
  t = await secText('Baffled chambers');
  ok(/Back pressure at Mach 0\.10\s*\n\s*4\.5 kPa/.test(t) && /Mach 0\.14/.test(t) && !/over 10% of the pressure/.test(t), '50 mm baffle holes at Mach 0.10: 4.5 kPa, holes at Mach 0.14 (independent 6.355 H = 4.508 kPa; 2.6 kPa before)');
  await setv('m-bh', '40'); await setv('m-mach', '0.15'); await pg.waitForTimeout(400);
  t = await secText('Baffled chambers');
  ok(/Back pressure at Mach 0\.15\s*\n\s*23\.6 kPa/.test(t) && /over 10% of the pressure/.test(t), '40 mm holes at Mach 0.15: 23.6 kPa with the Crane TP-410 validity note (independent 23.63 kPa; 6.1 kPa before)');
  // Sound tab J-pipe row on the default design: 733 mm (was 732)
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(500);
  t = await pg.$eval('#sound-details', e => e.innerText);
  ok(/J-pipe cut length, as an alternative\s*\n\s*733 mm/.test(t), 'Sound-tab J-pipe cut length 733 mm on the defaults (independent 732.7 mm)');
  // Intake, boosted: Stone agreement text
  await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(300); await setv('i-ind', 'turbo'); await pg.waitForTimeout(400);
  t = await pg.$eval('#i-details', e => e.innerText);
  ok(/0\.06 low at η 0\.5/.test(t) && !/lands within 0\.03 of the chart'/.test(t), 'Stone chart agreement stated as computed');
  ok(!/\bNaN\b|\bundefined\b/.test(t), 'no NaN on the intake tab');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'FAILED: ' + fails.length : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
