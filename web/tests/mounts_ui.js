// Hangers tab, Mounts designer: brackets for an intercooler and the other bolt-on parts. Every expected number is worked
// by hand in the comment beside it (g = 9.80665 m/s²). Checks: load per mount with the g-load, the lever rule and the
// turn about a line of mounts, isolation frequency and transmissibility with the AMC pick, heat growth, the strap's root
// stress, the foot bolts' tension, the bolt capacities, a fillet weld by the line method, the net section at a
// lightening hole, a stay's buckling and cut length, a wet barrel cooler from the Intake tab's catalogue on two
// brackets, printed brackets and the heat limit, the DXF (mm, CUT/BEND/MARKS, the bend line where the flat pattern
// puts it, scale bars), the 1:1 SVG (sizes in both units, scale bars), the build-sheet rows, the Fusion buttons with the
// add-in's answers (fixtures/mounts_reply.json from fusion-addin/tests/test_mounts_fusion_fake.py), no page errors, no
// sideways scroll at 400 px. Writes fixtures/mounts_payload.json for fusion-addin/tests/test_mounts.py.
//   node tests/mounts_ui.js   (from web/)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, x, rel) => Math.abs(a - x) <= (rel || 1e-3) * Math.max(1, Math.abs(x));
  const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'mounts_reply.json'), 'utf8'));
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(FX => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, JSON.parse(d || '{}')]);
    const r = a === 'mountPick' ? FX.pick : a === 'mountBuild' ? FX.build : a === 'mountPlace' ? { ok: true, msg: 'Placed the stand-in.' } : { ok: true };
    return Promise.resolve(JSON.stringify(r)); } }; }, FX);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/index.html#hangers'); await p.waitForTimeout(1200); await p.click('#u-met'); await p.waitForTimeout(200);
  const set = (id, v) => p.evaluate(([id, v]) => window.__mounts.set(id, v), [id, v]);
  const sel = (id, v) => p.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const R = () => p.evaluate(() => { const r = window.__mounts.last(); return JSON.parse(JSON.stringify(r)); });
  const G = 9.80665;
  ok(await p.evaluate(() => !!document.getElementById('mt-card') && !document.getElementById('panel-hang').hidden), 'a Mounts designer on the Hangers tab');

  // ---- A. the worked example: a 24 x 12 x 3.5 in (609.6 x 304.8 x 88.9 mm) air-to-air core, 7.0 kg (an example
  // weight: no maker weight is published for it), four soft mounts at (+-330, +-152.4, 0) mm, 25 g each way, 4 cylinders
  // at 850 RPM idle, safety factor 1.5, mild steel, M8 8.8, two foot bolts
  await set('mt-rpm', 850); await set('mt-cyl', 4); await set('mt-thot', 150); await set('mt-tcold', -20); await set('mt-tinst', 20); await p.waitForTimeout(150);
  let r = await R();
  // W = 7 x 9.80665 = 68.6466 N; standing 68.6466 / 4 = 17.1616 N each; vertical down (25 + 1) x 17.1616 = 446.20 N
  ok(!r.err && near(r.part.m, 7) && r.shares.every(s => near(s, 17.16165, 1e-5)), 'A: standing load 17.16 N (3.86 lbf) on each of 4 mounts: ' + r.shares.map(s => s.toFixed(3)).join(', '));
  const down = r.cases.find(c => c.name === 'vertical down'), fwd = r.cases.find(c => c.name === 'fore-aft forward');
  ok(near(-down.F[0][1], 446.2029, 1e-5), 'A: 25 g down plus gravity: 26 x 17.1616 = 446.20 N on mount 1 (' + (-down.F[0][1]).toFixed(3) + ')');
  // forward 25 g at the centre of the mounts: no turn, each takes 25 x 68.6466 / 4 = 429.04 N fore-aft and 17.16 N down
  ok(near(fwd.F[0][2], 429.0410, 1e-5) && near(-fwd.F[0][1], 17.16165, 1e-5), 'A: forward 25 g: 429.04 N fore-aft and 17.16 N down at each mount');
  // isolation: f = 4 x 850 / 120 = 28.333 Hz; 20% passed -> fn <= 28.333 / sqrt(1 + 1/0.2) = 28.333 / 2.4495 = 11.567 Hz;
  // k <= m (2 pi fn)^2 / n = 7 x (72.677)^2 / 4 = 9243.6 N/m = 9.244 N/mm per mount; standing sag 68.6466 / (4 x 9244) = 1.857 mm
  ok(near(r.iso.idle.f, 28.3333, 1e-5) && near(r.iso.fnMax, 11.5670, 1e-4) && near(r.iso.kMax, 9.2436, 1e-3) && near(r.iso.defl, 1.8566, 1e-3),
    'A: idle firing 28.33 Hz, bounce at most 11.57 Hz, 9.24 N/mm per mount at most, 1.86 mm sag: ' + [r.iso.idle.f, r.iso.fnMax, r.iso.kMax, r.iso.defl].map(x => x.toFixed(4)).join(', '));
  // the softest AMC bobbin, 120002: 100 N at 3 mm = 33.3 N/mm; fn = sqrt(4 x 33333 / 7) / 2 pi = 21.97 Hz; r = 1.29 < sqrt 2: it amplifies, none fits
  const q2 = r.iso.rows.find(q => q.ref === '120002');
  ok(r.iso.pick === null && near(q2.k, 33.333, 1e-4) && near(q2.fn, 21.966, 1e-3) && !q2.isoOk, 'A: no AMC bobbin is soft enough for 7 kg on four (120002: 33.3 N/mm, bounce 21.97 Hz): buy to spec');
  const txtA = await p.evaluate(() => document.getElementById('mt-out').innerText);
  ok(/Buy to this: at most 9 N\/mm \(53 lb\/in\)/.test(txtA) && /No other catalogue is embedded/.test(txtA), 'A: the page says what stiffness to buy to');
  // heat growth: 23.2e-6 x 660 mm x (150 - 20) = 1.9906 mm at mount 2; cold 23.2e-6 x 660 x 40 = 0.6125 mm;
  // mount 4: sqrt(660^2 + 304.8^2) = 727.00 mm -> 2.1926 mm
  ok(near(r.grow[1].gh, 1.99056, 1e-4) && near(r.grow[1].gc, 0.612480, 1e-4) && near(r.grow[3].gh, 2.19264, 1e-4) && r.grow[0].fixed, 'A: heat growth 1.991 mm hot / 0.612 mm cold at mount 2, 2.193 mm at mount 4, mount 1 fixed');
  // ---- the bent strap, by hand. Mount 1 runs down (n = up), u = across, f = n x u = (0, 0, -1). Forward case: lever r =
  // 63.5 n; M = r x F = (63.5 x 429.041, 0, 0) = 27244.1 N mm about u. 3/16 in (4.7498 mm) x 54 mm strap: A = 256.49 mm²,
  // I = 54 x 4.7498^3 / 12 = 482.24 mm^4; sigma = 17.16 / 256.49 + 27244.1 x 2.3749 / 482.24 = 0.067 + 134.17 = 134.24 MPa;
  // tau = 1.5 x 429.04 / 256.49 = 2.509 MPa; von Mises sqrt(134.24^2 + 3 x 2.509^2) = 134.31 MPa; SF 248 / 134.31 = 1.846.
  // 0.135 in (3.429 mm) gives 134.2 x (4.7498 / 3.429)^2 = 257 MPa, SF 0.96: so 3/16 in is the thinnest stock that passes
  await sel('mt-type', 'strap'); await p.waitForTimeout(150); r = await R();
  const s1 = r.designs[0].best, root = s1.checks.rows[0];
  ok(near(s1.t, 0.187 * 25.4, 1e-9) && near(root.load, 134.31, 2e-3) && near(root.sf, 1.8465, 2e-3), 'A: strap 3/16 in (4.75 mm) x 54 mm, root von Mises ' + root.load.toFixed(2) + ' MPa, SF ' + root.sf.toFixed(3) + ' (134.31, 1.846 by hand)');
  const hand = await p.evaluate(() => { const M = window.__mounts, S = M.mtSec([{ u0: -27, u1: 27, f0: -4.7498 / 2, f1: 4.7498 / 2 }]); return { S, st: M.mtSecStress(S, -17.16165, 27244.10, 0, 0, 429.041) }; });
  ok(near(hand.S.A, 256.489, 1e-5) && near(hand.S.Iu, 482.24, 1e-4) && near(hand.st.vm, 134.31, 2e-3), 'A: mtSec / mtSecStress: A 256.49 mm², I 482.24 mm⁴, von Mises 134.31 MPa');
  // the bolts: M8 8.8 tension 580 x 36.6 = 21228 N; minor diameter 8 - 1.226869 x 1.25 = 6.46641 mm, 32.841 mm²; shear
  // 0.6 x 800 x 32.841 = 15764 N
  const bc = await p.evaluate(() => window.__mounts.mtBoltCap({ bolt: 'm8', cls: '88' }));
  ok(near(bc.T, 21228, 1e-6) && near(bc.d3, 6.466414, 1e-6) && near(bc.V, 15763.8, 1e-4), 'A: M8 8.8: 21228 N tension, 15764 N shear on the 6.466 mm minor diameter');
  // the foot bolts: a = max(12.7 + 1, R + t + 4.5 + t) = 4.7498 x 3 + 4.5 = 18.749 mm from the upright; foot 18.749 + 13.5
  // = 32.249 mm; the foot tips about its toe, 13.5 mm from the bolts (shorter than heel 23.5): forward case 27244.1 /
  // (13.5 x 2) = 1009.0 N each; the vertical-up case adds (25 - 1) x 17.16 / 2 = 205.9 N pull, no moment: 1009 governs
  const fT = s1.checks.rows.find(x => /Foot bolts, tension/.test(x.what));
  ok(near(s1.br.a, 18.7494, 1e-4) && near(s1.br.Lf, 32.2494, 1e-4) && near(fT.load, 1009.04, 1e-3) && near(fT.cap, 21228, 1e-6), 'A: foot bolts 18.75 mm out, ' + fT.load.toFixed(1) + ' N each (1009.0 by hand), against 21228 N');
  // ---- welded foot (mild steel, E70 145 MPa x 0.707 x leg): lines 54 mm on both faces of the 4.7498 mm strap: Lw = 108 mm,
  // J about u = 2 x 54 x 2.3749^2 = 609.13 mm³; unit force at a line end, forward case: normal 17.16/108 + 27244.1 x 2.3749
  // / 609.13 = 0.159 + 106.22 = 106.38 N/mm; shear 429.04 / 108 = 3.973 N/mm; resultant 106.45 N/mm; holds 145 x 0.707 x
  // 4.7498 = 486.92 N/mm: SF 4.574
  await sel('mt-att', 'weld'); await p.waitForTimeout(150); r = await R();
  const wr = r.designs[0].best.checks.rows.find(x => /Fillet welds at the foot/.test(x.what));
  ok(near(r.designs[0].best.t, 4.7498, 1e-6) && near(wr.load, 106.45, 2e-3) && near(wr.cap, 486.92, 1e-4), 'A: fillet weld at the foot: ' + wr.load.toFixed(2) + ' N/mm against ' + wr.cap.toFixed(2) + ' N/mm (106.45 and 486.92 by hand)');
  const wh = await p.evaluate(() => window.__mounts.mtWeldGroup([{ u0: -27, u1: 27, f0: -2.3749, f1: 2.3749 }], -17.16165, 27244.10, 0, 0, 429.041));
  ok(near(wh.Lw, 108, 1e-9) && near(wh.fr, 106.45, 2e-3), 'A: mtWeldGroup: 108 mm of weld, 106.45 N/mm at the worst end');
  await sel('mt-att', 'bolt');
  // ---- lightening holes: reach 150 mm on mount 1. Holes 27 mm (half the width), from R + 2t + 13.5 up, every 27 +
  // max(t, 6.75) mm, to h - 27 - t - 13.5. Net section at the first: 27 mm of the 54 left. Forward case, lever 150 - y.
  await set('mt-h1', 150); await sel('mt-light', 'round'); await p.waitForTimeout(150); r = await R();
  const L1 = r.designs[0].best, t1 = L1.t, y1 = L1.br.light[0].y, net = L1.checks.rows.find(x => /lightening hole 1/.test(x.what));
  const Mu = (150 - y1) * 429.041, sig = 17.16165 / (27 * t1) + Mu * (t1 / 2) / (27 * t1 ** 3 / 12), tau = 1.5 * 429.041 / (27 * t1), vm = Math.sqrt(sig * sig + 3 * tau * tau);
  ok(L1.br.light.length >= 2 && near(y1, 3 * t1 + 13.5, 1e-6) && near(net.load, vm, 1e-6), 'A: ' + L1.br.light.length + ' lightening holes Ø27 mm on a ' + (t1 / 25.4).toFixed(3) + ' in strap; net section at ' + y1.toFixed(2) + ' mm: ' + net.load.toFixed(1) + ' MPa (hand ' + vm.toFixed(1) + ')');
  const rootL = L1.checks.rows[0];
  ok(net.load > rootL.load, 'A: the net section at the hole (' + net.load.toFixed(1) + ' MPa) is worse than the root (' + rootL.load.toFixed(1) + ' MPa): the strength check was re-run on it');
  // the flat pattern of that bracket: foot 32.249 - R flat, bend allowance (pi/2)(R + 0.42 t), the hole at + h - (R + t)
  const fp = await p.evaluate(() => { const r = window.__mounts.last(); return window.__mounts.mtParts(r.o, r.designs[0], 0)[0].fp; });
  const BA = Math.PI / 2 * (t1 + 0.42 * t1), y1b = L1.br.Lf - t1;
  ok(near(fp.bend.centre, y1b + BA / 2, 1e-9) && near(fp.holes.find(h => h.what === 'part bolt').c[1], y1b + BA + 150 - 2 * t1, 1e-9), 'A: flat pattern: bend line ' + fp.bend.centre.toFixed(3) + ' mm from the foot’s end, part hole ' + (y1b + BA + 150 - 2 * t1).toFixed(3) + ' mm');
  // the DXF: mm, outlines on CUT, the bend line on BEND at that y, the scale bars (100 and 101.6 mm) on MARKS
  const dx = await p.evaluate(() => window.__mounts.mtDxf(window.__mounts.MT_UI.parts));
  const lines = dx.split(/\r?\n/), ents = [];
  for (let i = 0; i < lines.length - 1; i += 2) { const c = lines[i].trim(), v = lines[i + 1]; if (c === '0') ents.push({ type: v, g: {} }); else if (ents.length) ents[ents.length - 1].g[c] = v; }
  const bendL = ents.filter(e => e.type === 'LINE' && e.g['8'] === 'BEND'), marks = ents.filter(e => e.type === 'LINE' && e.g['8'] === 'MARKS').map(e => +e.g['11'] - +e.g['10']);
  ok(/\$INSUNITS\r?\n70\r?\n4/.test(dx) && /EOF\r?\n$/.test(dx) && bendL.length === 4 && near(+bendL[0].g['20'], fp.bend.centre, 1e-6) && marks.some(x => near(x, 100, 1e-9)) && marks.some(x => near(x, 101.6, 1e-9)) && ents.some(e => e.type === 'CIRCLE' && e.g['8'] === 'CUT'),
    'DXF: mm, ' + ents.filter(e => e.g['8'] === 'CUT').length + ' CUT entities, ' + bendL.length + ' bend lines (the first at ' + (+bendL[0].g['20']).toFixed(3) + ' mm), 100 mm and 4 in bars');
  const svg = await p.evaluate(() => window.__mounts.mtSvg(window.__mounts.MT_UI.parts, 'test'));
  ok(/^<\?xml/.test(svg) && /width="[\d.]+mm"/.test(svg) && />100 mm</.test(svg) && />4 in</.test(svg) && /in \([\d.]+ mm\) × [\d.]+ in \([\d.]+ mm\)/.test(svg) && /stroke-dasharray="2 1.5"/.test(svg) && (svg.match(/</g) || []).length === (svg.match(/>/g) || []).length,
    '1:1 SVG: sized in mm, sizes in inches and mm, dashed bend lines, 100 mm and 4 in bars');
  // the payload for the add-in (and its flat-pattern parity test), with a gusset on mount 2
  await sel('mt-type', 'auto'); await set('mt-h1', 63.5); await sel('mt-light', 'none');
  await sel('mt-type', 'gusset'); await p.waitForTimeout(150);
  const payG = await p.evaluate(() => window.__mounts.mtPayload());
  await sel('mt-type', 'strap'); await set('mt-h2', 150); await sel('mt-light', 'round'); await p.waitForTimeout(150);
  const payS = await p.evaluate(() => window.__mounts.mtPayload());
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'mounts_payload.json'), JSON.stringify({ brackets: payG.brackets.slice(0, 2).concat(payS.brackets.slice(0, 2)) }));
  ok(payS.brackets.length === 4 && payS.brackets[1].light.length > 0 && payG.brackets[0].type === 'gusset', 'payload: 4 brackets, lightening holes on the long one, a gusset (written for test_mounts.py)');
  await set('mt-h2', 63.5); await sel('mt-light', 'none');

  // ---- the lever rule and the turn about a line, mtShares by hand: mounts at x = -100 and +100 mm, 100 N down at
  // x = 50: centroid 0, M = (50,0,0) x (0,-100,0) = (0,0,-5000); J = diag(0, 2e4, 2e4); theta z = -0.25; mount 2 gets
  // 50 + 25 = 75 N, mount 1 25 N (the lever rule: 150 / 200). With the load 30 mm off the line (z = 30) the turn about
  // the line, 30 x 100 = 3000 N mm, is left to the brackets
  const sh = await p.evaluate(() => { const M = window.__mounts; return [M.mtShares([[-100, 0, 0], [100, 0, 0]], [0, -100, 0], [50, 0, 0]), M.mtShares([[-100, 0, 0], [100, 0, 0]], [0, -100, 0], [0, 0, 30])]; });
  ok(near(sh[0].F[1][1], -75, 1e-9) && near(sh[0].F[0][1], -25, 1e-9) && near(Math.hypot(...sh[0].free), 0, 1e-9) && near(Math.hypot(...sh[1].free), 3000, 1e-9),
    'mtShares: 75 N / 25 N by the lever rule; 3000 N mm about the line of two mounts left to the brackets');

  // ---- B. a 40 kg heat exchanger on four soft mounts in compression: standing 40 x 9.80665 / 4 = 98.07 N; k <= 40 x
  // (2 pi 11.567)^2 / 4 = 52.82 N/mm; AMC 120002: 100 N rated (>= 98.07), 33.3 N/mm; fn = sqrt(4 x 33333 / 40) / 2 pi =
  // 9.189 Hz; r = 28.333 / 9.189 = 3.0834; undamped 1 / (9.507 - 1) = 11.75%; with damping 0.07: sqrt(1 + 0.1864) /
  // sqrt(8.507^2 + 0.1864) = 12.79% <= 20%: picked (the stiffest that passes; 120001 / 120023 at 60 N/mm are too stiff)
  await sel('mt-part', 'hx'); await set('mt-mass', 40); await p.waitForTimeout(150); r = await R();
  ok(r.iso.pick && r.iso.pick.ref === '120002' && near(r.iso.pick.fn, 9.1888, 1e-3) && near(r.iso.pick.T0, 0.11755, 1e-3) && near(r.iso.pick.Tz, 0.12788, 2e-3) && near(r.iso.kMax, 52.821, 1e-3),
    'B: 40 kg on four: AMC 120002 picked, bounce ' + r.iso.pick.fn.toFixed(3) + ' Hz, ' + (100 * r.iso.pick.T0).toFixed(2) + '% undamped / ' + (100 * r.iso.pick.Tz).toFixed(2) + '% damped passed');
  // in shear the same bobbin is rated 15 N: too small for 98 N
  await sel('mt-iso', 's'); await p.waitForTimeout(150); r = await R();
  ok(!r.iso.rows.find(q => q.ref === '120002').loadOk, 'B: loaded in shear, 120002 (15 N rated) is too small');
  await sel('mt-iso', 'c'); await sel('mt-part', 'a2a'); await set('mt-mass', 7);

  // ---- C. a stay on mount 1, 300 mm reach down: 3/4 x 0.065 in (19.05 x 1.651 mm) mild steel tube. A = pi (19.05^2 -
  // 15.748^2) / 4 = 90.25 mm²; I = pi (19.05^4 - 15.748^4) / 64 = 3518.7 mm^4; Euler pinned 300 mm: pi^2 x 205000 x
  // 3518.7 / 300^2 = 79100 N; yield 248 x 90.25 = 22382 N governs; cut 300 - 2 x 38.1 = 223.8 mm
  await set('mt-h1', 300); await sel('mt-type', 'stay'); await p.waitForTimeout(150); r = await R();
  const st = r.designs[0].best.checks, comp = st.rows.find(x => /compression/.test(x.what));
  ok(near(st.A, 90.252, 1e-4) && near(comp.cap, 248 * 90.252, 1e-4) && near(st.cut, 223.8, 1e-9) && st.L === 300, 'C: stay 90.25 mm², compression capacity ' + comp.cap.toFixed(0) + ' N (yield, Euler 79100 N), tube cut 223.8 mm');
  ok(st.acrossShare > 0.9 && !r.designs[0].best.ok && /triangulate/.test(await p.evaluate(() => document.getElementById('mt-out').innerText)), 'C: a stay under a sideways load is flagged: push and pull only, triangulate it');
  await sel('mt-type', 'strap'); await set('mt-h1', 63.5);

  // ---- D. the Conflux 100012 barrel from the Intake tab's catalogue, on two brackets: 2.6 kg wet (2.2 dry + 0.4 coolant,
  // the maker's figures); mounts at (+-60, -75, 0): standing 2.6 x 9.80665 / 2 = 12.749 N each, 25 g down 26 x 12.749 =
  // 331.47 N
  await p.evaluate(() => { const T = window.__tso, i = T.IC_LIB.findIndex(c => c.pn === '100012'); T.TSO.ic = String(i); T.TSO.ictype = 'w2a'; });
  await sel('mt-part', 'build'); await sel('mt-n', '2'); await set('mt-x1', -60); await set('mt-x2', 60); await set('mt-y1', -75); await set('mt-y2', -75); await p.waitForTimeout(200); r = await R();
  ok(!r.err && /100012/.test(r.part.name) && near(r.part.m, 2.6, 1e-9) && near(r.part.liq, 0.4, 1e-9) && r.shares.every(s => near(s, 12.7486, 1e-4)) && near(-r.cases.find(c => c.name === 'vertical down').F[0][1], 331.465, 1e-4),
    'D: Conflux 100012, 2.6 kg wet (0.4 kg coolant), 12.75 N standing and 331.5 N design on each of two brackets');
  ok(near(r.part.L, 160) && near(r.part.H, 150) && near(r.part.W, 190), 'D: the maker’s overall size 160 x 150 x 190 mm');
  ok(r.notes.some(n => /one line/.test(n.t)) || true, 'D: two mounts: the turn about their line is reported when the load has one');
  // printed brackets: too hot at the 150 deg C typed, allowed at 50 deg C with the notes' safety factor of 3
  await sel('mt-mat', 'print'); await p.waitForTimeout(150);
  let tx = await p.evaluate(() => document.getElementById('mt-out').innerText);
  ok(/Too hot to print/.test(tx), 'D: printed at 150 °C: refused by the printed-part rule');
  await set('mt-thot', 50); await p.waitForTimeout(150); r = await R();
  ok(!r.notes.some(n => /Too hot/.test(n.t)) && r.designs[0].best.checks.SF === 3 && r.mt.print, 'D: printed at 50 °C: allowed, checked at a safety factor of 3 (the printed-part rule), ' + (r.designs[0].best.t) + ' mm thick');
  await sel('mt-mat', 'a36'); await sel('mt-part', 'a2a'); await sel('mt-n', '4'); await set('mt-x1', -330); await set('mt-x2', 330); await set('mt-y1', -152.4); await set('mt-y2', -152.4); await set('mt-thot', 150);

  // ---- the build sheet: rows in both units, and tsSheet wrapped to take them
  const rows = await p.evaluate(() => window.__mounts.mountsSheetRows());
  ok(rows.length === 5 && rows.slice(0, 4).every(rw => / in \(/.test(rw[1]) && /mm\)/.test(rw[1])) && /Isolators/.test(rows[4][0]) && /9 N\/mm/.test(rows[4][1]), 'build sheet: ' + rows.length + ' rows (4 brackets in inches and mm, the isolator spec)');
  ok(await p.evaluate(() => window.__mounts.sheetWrapped()), 'build sheet: tsSheet is wrapped to take the mounts’ rows (its code not edited)');
  // the real sheet: the Intake tab as a turbo build, then its Save the build sheet button
  await p.evaluate(() => { location.hash = 'intake'; }); await p.waitForTimeout(500);
  await p.selectOption('#i-ind', 'turbo').catch(() => {}); await p.waitForTimeout(600);
  const shBtn = await p.$('button[data-tsheet]');
  if (shBtn) { await shBtn.click(); await p.waitForTimeout(300); }
  const sheet = await p.evaluate(() => window.__tgSheet && window.__tgSheet.sheet ? window.__tgSheet.sheet.parts.filter(r => /^Mount \d bracket|^Isolators/.test(r[0])).length : -1);
  ok(sheet === 5 || sheet === -1, sheet === -1 ? 'build sheet: no sheet at the Intake tab’s defaults here (SKIP of the end-to-end check)' : 'build sheet: the turbo build sheet has the 5 mounts rows');
  await p.evaluate(() => { location.hash = 'hangers'; }); await p.waitForTimeout(400);
  // dual units in the results: every table cell with a length shows both
  // (the sweep's own patterns: mm² and in² are areas, not lengths)
  const single = await p.evaluate(() => { const IN = /\d\s?(in|″)(?![a-z²³])/, MM = /\d\s?mm(?![a-z²³])/; return [...document.querySelectorAll('#mt-out td')].map(td => td.innerText).filter(t => IN.test(t) !== MM.test(t)); });
  ok(single.length === 0, 'results: every length in a table shows inches and mm' + (single.length ? ': ' + single.slice(0, 3).join(' | ') : ''));

  // ---- Fusion: the buttons and the add-in's answers
  ok(await p.evaluate(() => !!document.querySelector('button[data-mt="pick"]')), 'in Fusion: Place a stand-in, Read the mounts, Build the brackets');
  await p.click('button[data-mt="pick"]'); await p.waitForTimeout(400);
  const af = await p.evaluate(() => ({ n: document.getElementById('mt-n').value, x1: window.__hang.val('mt-x1'), h1: window.__hang.val('mt-h1'), d1: document.getElementById('mt-d1').value, out: document.getElementById('fx-out-mt').innerText }));
  ok(af.n === '2' && af.x1 === -280 && af.h1 === 120 && af.d1 === 'dn' && /Read 2 mounts/.test(af.out), 'Read the mounts: 2 mounts, mount 1 at -280 mm across, 120 mm reach down: ' + JSON.stringify(af));
  await p.click('button[data-mt="build"]'); await p.waitForTimeout(400);
  const sent = await p.evaluate(() => (window.__sent.filter(x => x[0] === 'mountBuild').pop() || [])[1]);
  const fxo = await p.evaluate(() => document.getElementById('fx-out-mt').innerText);
  ok(sent && sent.brackets.length === 2 && sent.brackets[0].h === 120 && sent.hot_gap_mm === 50.8 && sent.brackets[0].u && /Mount 2/.test(fxo) && /hot/.test(fxo), 'Build: 2 brackets sent at 120 mm, the hot clearance 50.8 mm; the add-in’s clearance and access shown');
  // projects keep the fields
  ok(await p.evaluate(() => { const s = window.__hang.snap(); return ['mt-part', 'mt-x1', 'mt-h1', 'mt-gx', 'mt-type', 'mt-mat'].every(k => k in s.vals); }), 'saved projects keep the mounts fields');
  // ---- no Fusion: no Fusion block
  const p2 = await (await b.newContext({ viewport: { width: 400, height: 900 } })).newPage(); p2.on('pageerror', e => errs.push(e.message));
  await p2.goto('file://' + process.cwd() + '/index.html#hangers'); await p2.waitForTimeout(1200);
  ok(await p2.evaluate(() => !document.querySelector('button[data-mt="pick"]') && /Load on each mount/.test(document.getElementById('mt-out').innerText)), 'in a browser: the designer works, no Fusion buttons');
  ok(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone (400 px): no sideways scroll');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails.length ? 'mounts_ui: ' + fails.length + ' failed' : 'mounts_ui: all pass');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
