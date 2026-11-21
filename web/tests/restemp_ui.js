// Side volumes with the neck's gas tracked and a shell (2026-11-21), and the Y-merge (opt.merge), in the wave model
// (docs/WAVE_VALIDATION_2026-11-21_resonator_temperature.md). The page gives the designs (the Mufflers tab's Helmholtz and
// quarter-wave formulas at its own still-gas temperature, 43.3 C); the model runs in Node from the page's source.
//   1-2 the page's 45 Hz Helmholtz can and quarter-wave tube on a 2.5 in line, alone on the line (tools/validation/wave/
//       branch_harness.js, 900 K pipe gas, a small multisine): the branch's own resonance (the peak of can / junction
//       pressure) within 5 % of 45 Hz, the gas in it at its 316 K shell, the tip's insertion-loss peak reported;
//   3   one bank of a cross-plane V8 at a cruise load (35 kPa manifold, 1800 rpm) with the can at 0.3, 0.9 and 1.5 m: the
//       can's gas after 8 cycles (reported, under 400 K: before this change 648-708 K), and the 45 Hz order at the tip falls
//       with the can's position the way the transfer-matrix insertion loss of the same layout does (same order of the three
//       positions; each step between positions within 8 dB of the matrix's);
//   4   at full throttle the can's stroke is several times its neck: hot gas reaches the can (Schuermans and Bothien) and it
//       warms well above its shell in the run (reported);
//   5   conservation: a closed pipe with a can, no friction or wall heat: mass and energy of pipe, can and neck to rounding;
//   6-8 the Y-merge: mass through the node; a cross-plane V8 merged into one pipe has its firing order (4th) the strongest
//       and its half orders lower against its firing order than in each bank's own pipe; two identical banks in phase into
//       a pipe of twice the area behave as one bank into one pipe (VE within 0.2 %, tip orders within 0.5 dB, flow x 2);
//   9   rustSpec: opt.merge goes to the WebAssembly, branches on the merged pipe are refused (JavaScript-only).
//   node tests/restemp_ui.js   (from web/)
'use strict';
const path = require('path'), { chromium } = require('playwright');
const VW = path.join(__dirname, '..', '..', 'tools', 'validation', 'wave');
const H = require(path.join(VW, 'branch_harness.js')), RT = require(path.join(VW, 'resonator_temp.js')), lib = require(path.join(VW, 'lib.js'));
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
(async () => {
  const b = await chromium.launch(); const pg = await (await b.newContext()).newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.join(__dirname, '..', 'index.html') + '#mufflers'); await pg.waitForTimeout(900);
  const D = await pg.evaluate(() => { const A = window.__physAudit, tres = +document.getElementById('m-tres').dataset.base;
    const h = A.calcHelm({ f: 45, dn: 50.8, ln: 76.2, dpipe: 63.5, tres }), q = A.calcQW({ f: 45, db: 50.8, dpipe: 63.5, tres });
    return { tres, h: { A: h.A, Le: h.Le, V: h.V, c: h.c }, q: { Lac: q.Lac, L: q.L, c: q.c } }; });
  await b.close();
  ok(Math.abs(D.tres - 43.333) < 1e-9 && Math.abs(D.h.c - RT.V * 0 - 352.5109172070161) < 1e-6, 'the Mufflers tab designs at its still-gas temperature ' + D.tres + ' C (c ' + D.h.c.toFixed(2) + ' m/s): can ' + (D.h.V * 1000).toFixed(2) + ' L on a 2 x 3 in neck, quarter-wave ' + D.q.Lac.toFixed(0) + ' mm acoustic (' + D.q.L.toFixed(0) + ' mm cut)');
  // 1-2: alone on the line
  const peak = (r, key) => { let hb = -1, fh = 0; r[key].forEach((v, k) => { if (v > hb) { hb = v; fh = r.fs[k]; } }); return fh; };
  const O = { dx: 0.04, T: 4.5, df: 0.25, Tg: 900, m0: 0.05, eps: 0.0003 }, bare = H.run(null, O);
  const quarter = D.q.Lac / 1000, Aq = Math.PI * 0.0508 ** 2 / 4;
  for (const [nm, br] of [['Helmholtz can', { V: D.h.V, CdA: D.h.A, Le: D.h.Le }], ['quarter-wave tube (its lumped form, V = A l, Le = 4 l / pi^2)', { V: Aq * quarter, CdA: Aq, Le: 4 * quarter / Math.PI ** 2 }]]) {
    const r = H.run(br, O), fr = peak(r, 'H'), il = r.fs.map((f, k) => 20 * Math.log10(bare.amp[k] / r.amp[k])), fi = r.fs[il.indexOf(Math.max(...il))];
    ok(Math.abs(fr / 45 - 1) <= 0.05 && Math.abs(r.ch.T - 316.48) < 3, nm + ' on 900 K pipe gas: its resonance ' + fr.toFixed(2) + ' Hz (' + ((fr / 45 - 1) * 100).toFixed(1) + ' % from the 45 Hz design; within 5 %), the gas in it ' + r.ch.T.toFixed(1) + ' K (shell 316.48 K); the tip\'s insertion loss peaks at ' + fi.toFixed(2) + ' Hz (' + Math.max(...il).toFixed(1) + ' dB)');
  }
  // 3: positions at a cruise load
  const o3 = { rpm: 1800, pIn: 35000, cycles: 8, ks: [1.5] }, b3 = RT.run(null, o3), xs = [0.3, 0.9, 1.5];
  const w = xs.map(x => { const r = RT.run(x, o3); return { T: r.ch.T, il: 20 * Math.log10(b3.lev[0] / r.lev[0]), tm: RT.tmIL(45, x, b3.Ttip, 316.48, 4 * r.ch.rho * r.ch.um / (3 * Math.PI * RT.A)) }; });
  ok(w.every(q => q.T < 400), 'cruise (35 kPa, 1800 rpm, 8 cycles): the can\'s gas at 0.3 / 0.9 / 1.5 m ' + w.map(q => q.T.toFixed(0)).join(' / ') + ' K (under 400 K; the tip gas ' + b3.Ttip.toFixed(0) + ' K)');
  const rank = a => a.map((v, i) => i).sort((i, j) => a[j] - a[i]).join(), dW = [w[1].il - w[0].il, w[2].il - w[1].il], dT = [w[1].tm - w[0].tm, w[2].tm - w[1].tm];
  ok(rank(w.map(q => q.il)) === rank(w.map(q => q.tm)) && dW.every((d, i) => Math.abs(d - dT[i]) <= 8), 'moving the can changes the 45 Hz order at the tip as the transfer matrix says: wave model ' + w.map(q => q.il.toFixed(1)).join(' / ') + ' dB, matrix ' + w.map(q => q.tm.toFixed(1)).join(' / ') + ' dB; steps ' + dW.map(v => v.toFixed(1)).join(', ') + ' against ' + dT.map(v => v.toFixed(1)).join(', ') + ' dB (within 8 dB)');
  // 4: full throttle
  const r4 = RT.run(0.3, { rpm: 1800, pIn: 0, cycles: 8, ks: [1.5] });
  ok(r4.ch.T > 400, 'full throttle at 1800 rpm: neck speeds to ' + r4.ch.um.toFixed(0) + ' m/s, the stroke passes the neck, hot gas reaches the can: ' + r4.ch.T.toFixed(0) + ' K after 8 cycles (the shell 316 K); its note rises with it, as a real can that ingests');
  // 5: conservation
  { const W0 = lib.load({ fanning: 0 }), G = W0.gas.makeGas(12.8, true), line = W0.buildLine({ segs: [{ L: 2, d0: 0.0635, d1: 0.0635 }], Tw: 900 }, 0.02, 900, 0, G);
    const P = line[0]; P.left = W0.wallEnd(-1); P.right = W0.wallEnd(+1);
    for (let i = 0; i < P.n; i++) { const xx = (i + 0.5) * P.dx; if (xx < 0.3) { const f = 1.3; P.q1[i] *= f; P.q3[i] *= f; } }
    const ch = W0.branchOf({ P, cell: 60, V: D.h.V, CdA: D.h.A, Le: D.h.Le }, 316.48, G, W0.gas.at(G, 300, 0).R);
    const tot = () => { let m = 0, E = 0; for (let i = 0; i < P.n; i++) { m += P.q1[i] * P.dx; E += P.q3[i] * P.dx; } const g = W0.gas.at(G, ch.T, ch.x); return [m + ch.m + ch.pm + ch.cm, E + ch.m * g.e + ch.pm * ch.ph + ch.cm * ch.chh]; };
    const t0 = tot(); let mx = 0, ingest = 0;
    for (let s = 0; s < 8000; s++) { W0.prim(P); const dt = 0.8 * P.dx / W0.maxSpeed(P); W0.branchStep(ch, P, ch.cell, dt, G); W0.stepPipe(P, dt); if (ch.vc < ch.Vt) ingest = Math.max(ingest, ch.vp / ch.Vt); }
    const t1 = tot(); mx = Math.max(Math.abs(t1[0] / t0[0] - 1), Math.abs(t1[1] / t0[1] - 1));
    ok(mx < 1e-9, 'a closed pipe with a can, a 30 % pressure step, no friction or wall heat, 8000 steps: mass and energy of the pipe, the can and the neck\'s gas kept to ' + mx.toExponential(1) + ' (the pipe-side gas filled up to ' + (ingest * 100).toFixed(0) + ' % of the tracked neck)'); }
  // 6-8: the Y-merge
  const W = lib.load({ hook: true }), J = require('./fixtures/wave_jobs.json')[1].job.variants[0].spec, col = J.opt.collector;
  const ord = (rec, j, rpm, ks) => { const R = rec.outs[j], t = rec.time, n = t.length, T = t[n - 1] - t[0];
    return ks.map(k => { const f = k * rpm / 60; let re = 0, im = 0; for (let q = 1; q < n; q++) { const d = (R.mdot[q] - R.mdot[q - 1]); re += d * Math.cos(2 * Math.PI * f * t[q]); im += d * Math.sin(2 * Math.PI * f * t[q]); } return 2 * Math.hypot(re, im) / T; }); };
  const bankSegs = d => col.segs.concat([{ L: 0.1, d0: col.segs[col.segs.length - 1].d1, d1: d }, { L: 1.9, d0: d, d1: d }]);
  const v8 = { e: J.e, intake: J.intake, exhaust: J.exhaust, opt: { phases: [0, 630, 270, 180, 450, 360, 540, 90], collectors: [{ cyls: [0, 2, 4, 6], segs: bankSegs(0.0635), Tw: 650 }, { cyls: [1, 3, 5, 7], segs: bankSegs(0.0635), Tw: 650 }] } };
  const L0 = col.segs.reduce((a, g) => a + g.L, 0) + 0.1 + 0.6;
  const v8y = JSON.parse(JSON.stringify(v8)); v8y.opt.merge = { pos: [L0, L0], segs: [{ L: 1.3, d0: 0.0762, d1: 0.0762 }] };
  const ks = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], rpm = 2500;
  let worst = 0, amax = 0;
  const hook = c => { const Jn = c.st.nets[0].juncs[c.st.nets[0].juncs.length - 1]; let s = 0, a = 0; for (const E of Jn.ends) { s += E.side * E.P.f1[E.side > 0 ? E.P.n : 0]; a += Math.abs(E.P.f1[E.side > 0 ? E.P.n : 0]); } worst = Math.max(worst, Math.abs(s)); amax = Math.max(amax, a); };
  const rY = W.runSpeed(W.makeEngine(v8y.e, v8y.intake, v8y.exhaust, v8y.opt), { rpm, cycles: 6, dx: 0.02, record: true, recordCycles: 2, hook });
  ok(rY.rec.outs.length === 1 && worst < 1e-12 * amax, 'Y-merge: one tail; mass into the node equals mass out at every step (worst ' + (worst / amax).toExponential(1) + ' of the largest flow through it)');
  const rB = W.runSpeed(W.makeEngine(v8.e, v8.intake, v8.exhaust, v8.opt), { rpm, cycles: 6, dx: 0.02, record: true, recordCycles: 2 });
  const lY = ord(rY.rec, 0, rpm, ks), lB = ord(rB.rec, 0, rpm, ks), dB = v => 20 * Math.log10(v);
  const half = l => 10 * Math.log10([0, 1, 2, 4, 5, 6].reduce((a, i) => a + l[i] * l[i], 0)), rel = l => half(l) - dB(l[7]);
  ok(lY.indexOf(Math.max(...lY)) === 7 && rel(lY) < rel(lB), 'cross-plane V8 at 2500 rpm merged into one 3 in pipe: order 4 the strongest at the tip (' + lY.map(v => dB(v).toFixed(1)).join(' ') + ' dB for orders ' + ks.join(' ') + '); the orders other than 2 and 4 against order 4: ' + rel(lY).toFixed(1) + ' dB merged, ' + rel(lB).toFixed(1) + ' dB in one bank\'s own pipe');
  const i4 = { e: J.e, intake: J.intake, exhaust: J.exhaust, opt: { phases: [0, 180, 360, 540], collector: { segs: bankSegs(0.0635).concat([{ L: 1.3, d0: 0.0635, d1: 0.0635 }]), Tw: 650 } } };
  const Lb = bankSegs(0.0635).reduce((a, g) => a + g.L, 0), d2 = 0.0635 * Math.SQRT2;   // the merge 0.1 mm before each line's end
  const twin = { e: J.e, intake: J.intake, exhaust: J.exhaust, opt: { phases: [0, 180, 360, 540, 0, 180, 360, 540], collectors: [{ cyls: [0, 1, 2, 3], segs: bankSegs(0.0635), Tw: 650 }, { cyls: [4, 5, 6, 7], segs: bankSegs(0.0635), Tw: 650 }],
    merge: { pos: [Lb - 1e-4, Lb - 1e-4], segs: [{ L: 1.3, d0: d2, d1: d2 }], Tw: 650 } } };
  // without friction and wall heat (both scale with the bore, so a wider pipe differs by them alone in a 1-D model)
  const W0 = lib.load({ fanning: 0 });
  const r1 = W0.runSpeed(W0.makeEngine(i4.e, i4.intake, i4.exhaust, i4.opt), { rpm, cycles: 6, dx: 0.02, record: true, recordCycles: 2 });
  const r2 = W0.runSpeed(W0.makeEngine(twin.e, twin.intake, twin.exhaust, twin.opt), { rpm, cycles: 6, dx: 0.02, record: true, recordCycles: 2 });
  const l1 = ord(r1.rec, 0, rpm, [2, 4, 6]), l2 = ord(r2.rec, 0, rpm, [2, 4, 6]), dd = l1.map((v, i) => dB(l2[i] / 2) - dB(v));
  ok(Math.abs(r2.ve / r1.ve - 1) < 0.002 && dd.every(v => Math.abs(v) < 0.5), 'two identical banks firing in phase merged into a pipe of twice the area act as one bank into one pipe (no friction or wall heat): VE ' + r2.ve.toFixed(4) + ' against ' + r1.ve.toFixed(4) + '; the tip\'s orders 2, 4, 6 at half the merged flow within ' + dd.map(v => v.toFixed(2)).join(', ') + ' dB');
  // 9: rustSpec
  let refused = false; try { W.rustSpec({ e: {}, opt: { merge: { pos: [1, 1], segs: [], branches: [{ x: 0.1, V: 1e-3, CdA: 1e-4, Le: 0.05 }] } } }); } catch (e) { refused = !!e.jsOnly; }
  ok(W.rustSpec(v8y) === v8y && refused, 'rustSpec hands opt.merge to the WebAssembly and refuses side branches on the merged pipe (JavaScript-only)');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join('; ') : ''));
  console.log(fails.length ? 'FAILS ' + fails.length : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
