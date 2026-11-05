// test_py_js.js - byte-for-byte comparison of wam_export.js against make_wam.py.
//   node test_py_js.js            (needs python3 on PATH; run from any folder)
// Cases: the v1 reference files (legacy entry point), the named specs in specs/ with several run settings
// (single cylinder, 4-1, Tri-Y, stepped primaries with both step BCs, dual-bank V8), and randomised specs
// that vary every number, so that the number formatting and rounding are exercised far from the defaults.
// It also checks readAvg() on an AVG file and prints the .bat for the user's exe.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const W = require('./wam_export.js');

const HERE = __dirname;
const spec = n => JSON.parse(fs.readFileSync(path.join(HERE, 'specs', n + '.json'), 'utf8'));

function python(jobs) {
  const code = [
    'import json, sys',
    'sys.path.insert(0, ' + JSON.stringify(HERE) + ')',
    'import make_wam',
    'jobs = json.load(sys.stdin)',
    'out = []',
    'for j in jobs:',
    '    try:',
    '        if j["kind"] == "legacy":',
    '            out.append({"text": make_wam.make_wam(j["p"])})',
    '        else:',
    '            out.append({"text": make_wam.make_wam_spec(j["spec"], j["run"])})',
    '    except Exception as ex:',
    '        out.append({"error": "%s: %s" % (type(ex).__name__, ex)})',
    'json.dump(out, sys.stdout)',
  ].join('\n');
  const r = spawnSync('python3', ['-c', code], { input: JSON.stringify(jobs), maxBuffer: 1 << 30, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
function js(j) {
  try { return { text: j.kind === 'legacy' ? W.makeWamLegacy(j.p) : W.makeWam(j.spec, j.run) }; }
  catch (ex) { return { error: ex.message }; }
}

// --- deterministic random numbers
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const U = (a, b) => a + (b - a) * rnd();
function randomSpec(base, k) {
  const s = JSON.parse(JSON.stringify(base));
  const e = s.e;
  e.bore = U(0.05, 0.11); e.stroke = U(0.045, 0.1); e.rod = e.stroke * U(1.5, 2.1); e.cr = U(8, 14);
  e.cd = U(0.55, 0.8); e.dIn = e.bore * U(0.32, 0.45); e.dEx = e.bore * U(0.28, 0.4); e.liftIn = e.dIn * U(0.2, 0.32); e.liftEx = e.dEx * U(0.2, 0.32);
  e.cam = { ivo: Math.round(U(5, 60)), ivc: Math.round(U(20, 80)) + (k % 3 === 0 ? 0.5 : 0), evo: Math.round(U(25, 80)), evc: Math.round(U(5, 50)) + (k % 3 === 0 ? 0.5 : 0) };
  if (k % 3 === 1) e.cam.checkLift_mm = U(0.15, 1.3);
  if (k % 5 === 4) e.combEff = U(0.7, 0.98);   // an explicit combustion efficiency (otherwise it follows the AFR)   // events at a check lift (0.050 in = 1.27 mm): seat events from them
  e.burn = { start: U(5, 35), dur: U(35, 70) }; e.afr = U(11.5, 14.5); e.eta = U(0.6, 0.9);
  if (k % 4 === 1) e.Twall = U(400, 520);
  const d = U(0.03, 0.06);
  s.intake = { segs: [{ L: U(0.08, 0.5), d0: d * 1.2, d1: d }, { L: U(0.05, 0.3), d0: d, d1: d }], Tw: U(300, 340) };
  if (k % 4 === 2) s.intake.plenum = { V_m3: U(0.5e-3, 6e-3), inlet: [{ L: U(0.1, 0.6), d0: d * 2.2, d1: d * 2.2 }, { L: U(0.03, 0.1), d0: d * 1.6, d1: d * 1.6 }] };   // v5 plenum, a throttle-body step
  const dp = U(0.03, 0.055);
  s.exhaust.segs = [{ L: U(0.05, 0.2), d0: dp, d1: dp }, { L: U(0.2, 0.8), d0: dp, d1: dp * (k % 2 ? 1 : U(1.0, 1.15)) }];
  if (k % 5 === 2) s.exhaust.segs.push({ L: U(0.05, 0.3), d0: dp * 1.1, d1: dp * 1.1 });   // a step
  if (k % 6 === 5) {   // v7 side-branch chambers on the primary (one, or two out of order), the second at a cone or a step
    const tot = s.exhaust.segs.reduce((a, q) => a + q.L, 0);
    s.exhaust.chambers = [{ x: tot * U(0.3, 0.9), V: U(0.1e-3, 1.5e-3), A: U(20e-6, 400e-6), Le: U(0.002, 0.06) }];
    if (k % 12 === 11) s.exhaust.chambers.unshift({ x: tot * U(0.05, 0.25), V: U(0.1e-3, 1e-3), A: U(20e-6, 200e-6), Le: U(0.03, 0.08) });
  }
  s.exhaust.Tw = U(600, 800);
  const n = s.opt.phases.length;
  if (k % 7 === 3) s.opt.phases = s.opt.phases.map((ph, i) => (i === 0 ? 0 : (ph + U(-20, 20) + 720) % 720));   // uneven firing
  const coll = s.opt.collector || (s.opt.collectors && s.opt.collectors[0]);
  if (coll) { const dc = dp * Math.sqrt(n) * U(0.8, 1.0); coll.segs = [{ L: U(0.05, 0.2), d0: dp * Math.sqrt(n), d1: dc }, { L: U(0.05, 0.4), d0: dc, d1: dc }, { L: U(0.1, 0.5), d0: dc, d1: dc * U(1.2, 1.6) }]; coll.Tw = U(550, 750); }
  return s;
}

const jobs = [];
// v1 entry point against the v1 reference files
for (const [f, over] of [['single450.wam', {}], ['single450_6000.wam', { rpm: 6000.0 }], ['single450_10000.wam', { rpm: 10000.0 }]])
  jobs.push({ label: 'v1 legacy ' + f, kind: 'legacy', p: over, ref: fs.readFileSync(path.join(HERE, 'ref', f), 'utf8') });
jobs.push({ label: 'v1 legacy lw_fct, 13 cycles, odd numbers', kind: 'legacy', p: { pipe_method: 'lw_fct', cycles: 13, bore_mm: 87.3, stroke_mm: 70.123, rpm: 7321.5, intake_len_mm: 271.3 } });
// named specs
const named = [
  ['single cylinder (simSpec n=1)', 'i4_single_cyl', { rpm: 6000.0, cycles: 30 }],
  ['4-1 at 4000', 'i4_41', { rpm: 4000.0, cycles: 30, name: 'i4_41_4000' }],
  ['4-1 at 7800, 12.5 mm cells', 'i4_41', { rpm: 7800.0, cycles: 20, cell_mm: 12.5 }],
  ['4-1, 3 average points per pipe', 'i4_41', { rpm: 6000.0, avg_points: 3 }],
  ['Tri-Y 4-2-1', 'i4_triy', { rpm: 6000.0, cycles: 30 }],
  ['stepped primaries, TCCUnionEntreTubos', 'i4_41_stepped', { rpm: 6000.0 }],
  ['stepped primaries, branch steps', 'i4_41_stepped', { rpm: 6000.0, step_bc: 'branch' }],
  ['dual-bank V8, two 4-1', 'v8_dual', { rpm: 6000.0, cycles: 30 }],
  ['open primaries', 'i4_open_primaries', { rpm: 4000.0 }],
];
for (const [label, n, run] of named) jobs.push({ label, kind: 'spec', spec: spec(n), run });
// randomised
const bases = ['i4_single_cyl', 'i4_41', 'i4_triy', 'v8_dual'];
for (let k = 0; k < 40; k++) {
  const b = bases[k % bases.length];
  jobs.push({ label: 'random ' + k + ' from ' + b, kind: 'spec', spec: randomSpec(spec(b), k),
    run: { rpm: Math.round(U(2000, 12000)) + (k % 2 ? 0.25 : 0), cycles: 10 + k, cell_mm: [10, 8, 12.5, 5][k % 4], courant: U(0.5, 0.9) } });
}
// v3: downstream chain + expansion-volume mufflers, outlet/plenum instantaneous output, concatenated cycles
function withTail(s, tail) { const c = s.opt.collector || s.opt.collectors[0]; c.tail = tail; return s; }
const TAIL1 = [{ L_mm: 1000, d0_mm: 60, d1_mm: 60, Tw_C: 350 }, { V_litres: 7.2, Tw_C: 300 }, { L_mm: 500, d0_mm: 60, d1_mm: 60, Tw_C: 250 }];
const TAIL2 = [{ L_mm: 100, d0_mm: 50.8, d1_mm: 50.8 }, { L_mm: 2400, d0_mm: 48.3, d1_mm: 48.3, Tw_C: 300 }, { L_mm: 600, d0_mm: 60.3, d1_mm: 60.3, Tw_C: 250 },
  { V_litres: 7.2 }, { L_mm: 300, d0_mm: 60.3, d1_mm: 60.3, Tw_C: 200 }, { V_litres: 3.5, Tw_C: 180 }, { L_mm: 500, d0_mm: 60.3, d1_mm: 63.5, Tw_C: 150 }];
jobs.push({ label: 'tail: pipe, 7.2 L muffler, tailpipe; ins_outlet, 3 cycles', kind: 'spec', spec: withTail(spec('i4_41'), TAIL1), run: { rpm: 3000.0, cycles: 12, ins_outlet: 1, ins_cycles: 3, out_step_deg: 0.5 } });
jobs.push({ label: 'tail: two mufflers, Tw changes, cone tip, plenum_cd 0.9', kind: 'spec', spec: withTail(spec('i4_41'), TAIL2), run: { rpm: 1915.0, cycles: 24, ins_outlet: 1, plenum_cd: 0.9 } });
jobs.push({ label: 'tail on Tri-Y', kind: 'spec', spec: withTail(spec('i4_triy'), TAIL1), run: { rpm: 6000.0, ins_outlet: 1 } });
jobs.push({ label: 'tail on both V8 banks', kind: 'spec', spec: (() => { const s = spec('v8_dual'); s.opt.collectors.forEach(c => { c.tail = TAIL1; }); return s; })(), run: { rpm: 4000.0, ins_outlet: 1, ins_cycles: 2 } });
jobs.push({ label: 'exhaust.tail on a single cylinder (no collector)', kind: 'spec', spec: (() => { const s = spec('i4_single_cyl'); s.exhaust.tail = TAIL1; return s; })(), run: { rpm: 6000.0, ins_outlet: 1 } });
jobs.push({ label: 'ins_outlet without a tail', kind: 'spec', spec: spec('i4_41'), run: { rpm: 6000.0, ins_outlet: 1 } });
// v7 side branches on the line: a quarter-wave tube, a Helmholtz can (short neck lengthened), both before a muffler
const SIDES = [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { side: { type: 'quarter', L_mm: 450, d_mm: 50 } }, { L_mm: 400, d0_mm: 60, d1_mm: 60, Tw_C: 300 },
  { side: { type: 'helmholtz', V_litres: 2.0, neck_L_mm: 12, neck_d_mm: 40, Tw_C: 280 } }, { L_mm: 500, d0_mm: 60, d1_mm: 60 }, { V_litres: 6 }, { L_mm: 400, d0_mm: 55, d1_mm: 55 }];
jobs.push({ label: 'tail: quarter-wave and Helmholtz side branches, then a muffler', kind: 'spec', spec: withTail(spec('i4_41'), SIDES), run: { rpm: 2500.0, ins_outlet: 1 } });
jobs.push({ label: 'error: a side branch at the end of the tail', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { side: { type: 'quarter', L_mm: 450, d_mm: 50 } }]), run: { rpm: 2500.0 } });
jobs.push({ label: 'error: an unknown side type', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { side: { type: 'resonator' } }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }]), run: { rpm: 2500.0 } });
for (let k = 0; k < 12; k++) {
  const s = randomSpec(spec(['i4_41', 'i4_triy'][k % 2]), 100 + k);
  const tail = [{ L_mm: U(200, 3000), d0_mm: U(45, 65), d1_mm: U(45, 65), Tw_C: U(150, 450) }];
  if (k % 3) tail.push({ V_litres: U(1, 20), Tw_C: k % 2 ? U(100, 400) : undefined });
  tail.push({ L_mm: U(200, 800), d0_mm: U(45, 65), d1_mm: U(45, 65) });
  if (k % 5 === 1) tail.push({ side: k % 2 ? { type: 'quarter', L_mm: U(100, 900), d_mm: U(30, 70) } : { type: 'helmholtz', V_litres: U(0.5, 5), neck_L_mm: U(5, 150), neck_d_mm: U(20, 60) } }, { L_mm: U(100, 600), d0_mm: U(45, 65), d1_mm: U(45, 65) });
  if (k % 4 === 0) tail.push({ V_litres: U(1, 20) }, { L_mm: U(100, 600), d0_mm: 55, d1_mm: 55, Tw_C: U(100, 300) });
  jobs.push({ label: 'random tail ' + k, kind: 'spec', spec: withTail(s, JSON.parse(JSON.stringify(tail))), run: { rpm: Math.round(U(700, 7000)), cycles: 10 + k, ins_outlet: k % 2, ins_cycles: 1 + (k % 3), out_step_deg: U(0.05, 1) } });
}
// unequal-length primaries (exhaust.per_cyl) on a Tri-Y, with a tail
jobs.push({ label: 'per-cylinder primaries 430/600 mm on a Tri-Y with a tail', kind: 'spec', spec: (() => {
  const s = withTail(spec('i4_triy'), TAIL2);
  const pr = L => [{ L: 0.05, d0: 0.038, d1: 0.038 }, { L, d0: 0.038, d1: 0.038 }];
  s.exhaust.per_cyl = [pr(0.38), null, pr(0.38), pr(0.55)];
  s.opt.collectors[0].stages[0].segs_by_group = [null, [{ L: 0.08, d0: 0.0445 * Math.SQRT2, d1: 0.05 }, { L: 0.61, d0: 0.05, d1: 0.05 }]]; return s; })(), run: { rpm: 735.0, cycles: 24, ins_outlet: 1, cell_mm: 15.0 } });
for (let k = 0; k < 6; k++) {
  const s = randomSpec(spec('i4_41'), 200 + k);
  s.exhaust.per_cyl = s.opt.phases.map(() => [{ L: U(0.05, 0.15), d0: 0.04, d1: 0.04 }, { L: U(0.2, 0.7), d0: 0.04, d1: k % 2 ? 0.04 : U(0.04, 0.046) }]);
  jobs.push({ label: 'random per_cyl ' + k, kind: 'spec', spec: s, run: { rpm: Math.round(U(700, 7000)), cycles: 8, ins_outlet: k % 2 } });
}
// throttled intake: runner inlets into a reservoir at manifold pressure (BC type 1)
jobs.push({ label: 'intake reservoir 0.35 bar (throttled), tail, per_cyl', kind: 'spec', spec: (() => { const s = withTail(spec('i4_41'), TAIL1); s.intake.reservoir = { p_bar: 0.35 }; return s; })(), run: { rpm: 735.0, cycles: 14, ins_outlet: 1 } });
jobs.push({ label: 'intake reservoir with T_C', kind: 'spec', spec: (() => { const s = spec('i4_triy'); s.intake.reservoir = { p_bar: 0.6, T_C: 40 }; return s; })(), run: { rpm: 2000.0 } });
for (let k = 0; k < 4; k++) { const s = randomSpec(spec('i4_41'), 300 + k); s.intake.reservoir = { p_bar: U(0.25, 0.95), T_C: k % 2 ? U(20, 60) : undefined }; jobs.push({ label: 'random reservoir ' + k, kind: 'spec', spec: JSON.parse(JSON.stringify(s)), run: { rpm: Math.round(U(700, 4000)), cycles: 8 } }); }
// error paths must agree too (both raise)
// a muffler box with several exits ("outlets" after the last plenum): two side outlets, three outlets with a Tw
// change and a cone, on a twin, and the error cases
const BOX2 = [{ L_mm: 120, d0_mm: 55, d1_mm: 55, Tw_C: 450 }, { V_litres: 9.0 },
  { outlets: [[{ L_mm: 130, d0_mm: 38, d1_mm: 38, Tw_C: 200 }], [{ L_mm: 150, d0_mm: 38, d1_mm: 40, Tw_C: 200 }]] }];
const BOX3 = [{ L_mm: 800, d0_mm: 50.8, d1_mm: 50.8 }, { V_litres: 12.5, T0_C: 300 },
  { outlets: [[{ L_mm: 200, d0_mm: 50, d1_mm: 50, Tw_C: 180 }, { L_mm: 100, d0_mm: 50, d1_mm: 63, Tw_C: 120 }], [{ L_mm: 260, d0_mm: 50, d1_mm: 50 }], [{ L_mm: 90, d0_mm: 44, d1_mm: 44, Tw_C: 150 }]] }];
jobs.push({ label: 'tail: box with two outlets on a 4-1', kind: 'spec', spec: withTail(spec('i4_41'), BOX2), run: { rpm: 5460.0, cycles: 12, ins_outlet: 1, ins_cycles: 2 } });
jobs.push({ label: 'tail: box with three outlets, Tw change, cone', kind: 'spec', spec: withTail(spec('i4_triy'), BOX3), run: { rpm: 1440.0, ins_outlet: 1 } });
jobs.push({ label: 'tail: box outlets on both V8 banks', kind: 'spec', spec: (() => { const s = spec('v8_dual'); s.opt.collectors.forEach(c => { c.tail = BOX2; }); return s; })(), run: { rpm: 4000.0, ins_outlet: 1 } });
jobs.push({ label: 'exhaust.tail box with two outlets, single cylinder', kind: 'spec', spec: (() => { const s = spec('i4_single_cyl'); s.exhaust.tail = BOX2; return s; })(), run: { rpm: 6000.0, ins_outlet: 1 } });
jobs.push({ label: 'error: outlets not after a plenum', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 500, d0_mm: 50, d1_mm: 50 }, { outlets: [[{ L_mm: 100, d0_mm: 40, d1_mm: 40 }]] }]), run: {} });
jobs.push({ label: 'error: outlets not last', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 500, d0_mm: 50, d1_mm: 50 }, { V_litres: 5 }, { outlets: [[{ L_mm: 100, d0_mm: 40, d1_mm: 40 }]] }, { L_mm: 100, d0_mm: 40, d1_mm: 40 }]), run: {} });
jobs.push({ label: 'error: empty outlet', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 500, d0_mm: 50, d1_mm: 50 }, { V_litres: 5 }, { outlets: [[{ L_mm: 100, d0_mm: 40, d1_mm: 40 }], []] }]), run: {} });
jobs.push({ label: 'error: outlet segment without d1_mm', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 500, d0_mm: 50, d1_mm: 50 }, { V_litres: 5 }, { outlets: [[{ L_mm: 100, d0_mm: 40 }]] }]), run: {} });
jobs.push({ label: 'error: per_cyl count', kind: 'spec', spec: (() => { const s = spec('i4_41'); s.exhaust.per_cyl = [s.exhaust.segs, s.exhaust.segs]; return s; })(), run: {} });
jobs.push({ label: 'error: segs_by_group count', kind: 'spec', spec: (() => { const s = spec('i4_triy'); s.opt.collectors[0].stages[0].segs_by_group = [null]; return s; })(), run: {} });
// v12 the intake's open end recorded (ins_intake): with a plenum (its air-filter inlet) and with open runners
jobs.push({ label: 'v12: ins_intake with an intake plenum', kind: 'spec', spec: (() => { const s = withTail(spec('i4_41'), TAIL1); s.intake.plenum = { V_m3: 2e-3, inlet: [{ L: 0.2, d0: 0.08, d1: 0.08 }] }; return s; })(), run: { rpm: 4000.0, ins_outlet: 1, ins_intake: 1 } });
jobs.push({ label: 'v12: ins_intake on open runners, both V8 banks', kind: 'spec', spec: spec('v8_dual'), run: { rpm: 5000.0, ins_outlet: 1, ins_intake: 1 } });
jobs.push({ label: 'v12: ins_intake without ins_outlet', kind: 'spec', spec: spec('i4_41'), run: { rpm: 3000.0, ins_intake: 1 } });
// v11 losses: a quadratic loss between two segments (a slot or baffle), a Helmholtz neck with a loss, and the errors
const LOSS1 = [{ L_mm: 400, d0_mm: 60, d1_mm: 60 }, { loss_K: 1.8 }, { L_mm: 200, d0_mm: 60, d1_mm: 60 }, { V_litres: 5 }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }, { loss_K: 0.45 }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }];
const LOSS2 = [{ L_mm: 500, d0_mm: 60, d1_mm: 60 }, { side: { type: 'helmholtz', V_litres: 0.75, neck_L_mm: 59, neck_d_mm: 54.4, loss_K: 2.5 } }, { L_mm: 500, d0_mm: 60, d1_mm: 60 }];
jobs.push({ label: 'v11: losses between segments and after a muffler', kind: 'spec', spec: withTail(spec('i4_41'), LOSS1), run: { rpm: 3000.0, ins_outlet: 1 } });
jobs.push({ label: 'v11: a Helmholtz trap with a lossy neck', kind: 'spec', spec: withTail(spec('i4_41'), LOSS2), run: { rpm: 2000.0, ins_outlet: 1 } });
jobs.push({ label: 'v11: a lossy neck on both V8 banks into an X', kind: 'spec', spec: (() => { const s = spec('v8_dual'); s.opt.collectors.forEach(c => { c.tail = [{ L_mm: 400, d0_mm: 63.5, d1_mm: 63.5 }]; }); s.opt.crossover = { cols: [0, 1], type: 'x', tails: [LOSS2, LOSS1] }; return s; })(), run: { rpm: 5000.0, ins_outlet: 1, cell_mm: 10.0 } });
jobs.push({ label: 'error: a loss at the end of the tail', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { loss_K: 1 }]), run: {} });
jobs.push({ label: 'error: a loss right after a muffler', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { V_litres: 4 }, { loss_K: 1 }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }]), run: {} });
jobs.push({ label: 'error: a zero loss', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { loss_K: 0 }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }]), run: {} });
jobs.push({ label: 'error: a negative neck loss', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { side: { type: 'helmholtz', V_litres: 1, neck_L_mm: 50, neck_d_mm: 40, loss_K: -1 } }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }]), run: {} });
// v10 crossover between the two banks: an X-pipe (one junction, both lines through it) and an H-pipe (a balance tube),
// each side then to its own exit through a muffler; and the errors
const XT = [{ L_mm: 400, d0_mm: 63.5, d1_mm: 63.5, Tw_C: 300 }];
const XO = [{ L_mm: 500, d0_mm: 63.5, d1_mm: 63.5, Tw_C: 250 }, { V_litres: 6.0 }, { L_mm: 600, d0_mm: 63.5, d1_mm: 63.5, Tw_C: 150 }];
const xSpec = (xo, tail) => { const s = spec('v8_dual'); s.opt.collectors.forEach(c => { if (tail) c.tail = tail; }); s.opt.crossover = xo; return s; };
jobs.push({ label: 'v10: X-pipe between the V8 banks, a muffler each side', kind: 'spec', spec: xSpec({ cols: [0, 1], type: 'x', tails: [XO, XO] }, XT), run: { rpm: 4000.0, ins_outlet: 1 } });
jobs.push({ label: 'v10: H-pipe, no collector tails, unequal outlets', kind: 'spec', spec: xSpec({ cols: [1, 0], type: 'h', tube: { L_mm: 180, d_mm: 50.8, Tw_C: 280 }, tails: [XO, [{ L_mm: 900, d0_mm: 60, d1_mm: 63.5 }]] }, null), run: { rpm: 2500.0, ins_outlet: 1 } });
jobs.push({ label: 'error: crossover with one collector', kind: 'spec', spec: xSpec({ cols: [0, 0], type: 'x', tails: [XO, XO] }, XT), run: {} });
jobs.push({ label: 'error: crossover type', kind: 'spec', spec: xSpec({ cols: [0, 1], type: 'y', tails: [XO, XO] }, XT), run: {} });
jobs.push({ label: 'error: H-pipe without a tube', kind: 'spec', spec: xSpec({ cols: [0, 1], type: 'h', tails: [XO, XO] }, XT), run: {} });
jobs.push({ label: 'error: collector tail into the crossover ends in a muffler box with outlets', kind: 'spec', spec: xSpec({ cols: [0, 1], type: 'x', tails: [XO, XO] }, [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { V_litres: 4 }, { outlets: [[{ L_mm: 100, d0_mm: 50, d1_mm: 50 }]] }]), run: {} });
// v8 parallel paths between two junctions: a 4-tube timbre bundle, an auger's centre tube and spiral channel (with a
// Tw change on one path), parallel paths after a side branch's line and before a muffler, a V8 pair, and the errors
const BUNDLE = [{ L_mm: 400, d0_mm: 63.5, d1_mm: 63.5 }, { parallel: [[{ L_mm: 76, d0_mm: 31.75, d1_mm: 31.75 }], [{ L_mm: 127, d0_mm: 31.75, d1_mm: 31.75 }],
  [{ L_mm: 127, d0_mm: 31.75, d1_mm: 31.75 }], [{ L_mm: 178, d0_mm: 38.1, d1_mm: 38.1 }]] }, { L_mm: 600, d0_mm: 63.5, d1_mm: 63.5 }];
const AUGER = [{ L_mm: 300, d0_mm: 63.5, d1_mm: 63.5 }, { parallel: [[{ L_mm: 610, d0_mm: 50.8, d1_mm: 50.8 }],
  [{ L_mm: 900, d0_mm: 40, d1_mm: 40, Tw_C: 250 }, { L_mm: 900, d0_mm: 40, d1_mm: 40, Tw_C: 200 }]] }, { L_mm: 400, d0_mm: 63.5, d1_mm: 63.5 }, { V_litres: 8 }, { L_mm: 300, d0_mm: 63.5, d1_mm: 63.5 }];
jobs.push({ label: 'v8: tail with a four-tube timbre bundle', kind: 'spec', spec: withTail(spec('i4_41'), BUNDLE), run: { rpm: 3000.0, ins_outlet: 1, cell_mm: 15.0 } });
jobs.push({ label: 'v8: tail with an auger (centre tube and spiral) then a muffler', kind: 'spec', spec: withTail(spec('i4_triy'), AUGER), run: { rpm: 4500.0, ins_outlet: 1 } });
jobs.push({ label: 'v8: side branch, then parallel paths', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { side: { type: 'quarter', L_mm: 450, d_mm: 50 } },
  { L_mm: 300, d0_mm: 60, d1_mm: 60 }, { parallel: [[{ L_mm: 200, d0_mm: 40, d1_mm: 40 }], [{ L_mm: 350, d0_mm: 40, d1_mm: 40 }]] }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }]), run: { rpm: 2500.0 } });
jobs.push({ label: 'v8: bundles on both V8 banks', kind: 'spec', spec: (() => { const s = spec('v8_dual'); s.opt.collectors.forEach(c => { c.tail = BUNDLE; }); return s; })(), run: { rpm: 4000.0, ins_outlet: 1, cell_mm: 15.0 } });
jobs.push({ label: 'error: one parallel path', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { parallel: [[{ L_mm: 200, d0_mm: 40, d1_mm: 40 }]] }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }]), run: {} });
jobs.push({ label: 'error: parallel paths at the end', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { parallel: [[{ L_mm: 200, d0_mm: 40, d1_mm: 40 }], [{ L_mm: 300, d0_mm: 40, d1_mm: 40 }]] }]), run: {} });
jobs.push({ label: 'error: parallel right after a plenum', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { V_litres: 4 }, { parallel: [[{ L_mm: 200, d0_mm: 40, d1_mm: 40 }], [{ L_mm: 300, d0_mm: 40, d1_mm: 40 }]] }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }]), run: {} });
jobs.push({ label: 'error: parallel segment without L_mm', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 300, d0_mm: 60, d1_mm: 60 }, { parallel: [[{ d0_mm: 40, d1_mm: 40 }], [{ L_mm: 300, d0_mm: 40, d1_mm: 40 }]] }, { L_mm: 300, d0_mm: 60, d1_mm: 60 }]), run: {} });
for (let k = 0; k < 6; k++) {
  const s = randomSpec(spec(['i4_41', 'i4_triy'][k % 2]), 400 + k), np = 2 + (k % 4);
  const paths = [];
  for (let i = 0; i < np; i++) { const pa = [{ L_mm: U(60, 900), d0_mm: U(25, 50), d1_mm: U(25, 50), Tw_C: k % 2 ? U(150, 400) : undefined }]; if (i % 2) pa.push({ L_mm: U(60, 400), d0_mm: U(25, 50), d1_mm: U(25, 50) }); paths.push(pa); }
  const tail = [{ L_mm: U(200, 1500), d0_mm: U(45, 65), d1_mm: U(45, 65) }, { parallel: paths }, { L_mm: U(200, 800), d0_mm: U(45, 65), d1_mm: U(45, 65) }];
  if (k % 3 === 0) tail.push({ V_litres: U(1, 15) }, { L_mm: U(100, 600), d0_mm: 55, d1_mm: 55 });
  jobs.push({ label: 'random parallel ' + k, kind: 'spec', spec: withTail(s, JSON.parse(JSON.stringify(tail))), run: { rpm: Math.round(U(700, 7000)), cycles: 8 + k, ins_outlet: k % 2, cell_mm: 12.0 } });
}
// v9 measured lift profiles (spec.e.camProfile): an asymmetric intake lobe every 2 deg (a faster closing ramp), an
// exhaust lobe every 4 deg with a centreline given, both, with a run-set lift step, and the errors
const lobe = (span, Lmax, skew, step) => { const deg = [], mm = []; for (let a = -span / 2 - 6; a <= span / 2 + 6 + 1e-9; a += step) { deg.push(+a.toFixed(3)); const x = (a + span / 2) / span; const y = x <= 0 || x >= 1 ? 0 : Math.pow(Math.sin(Math.PI * Math.pow(x, skew)), 2); mm.push(+(Lmax * y).toFixed(4)); } return { deg, mm }; };
{ const s = spec('i4_41'); s.e.camProfile = { in: lobe(250, 11.2, 0.9, 2) }; jobs.push({ label: 'v9: measured intake profile', kind: 'spec', spec: s, run: { rpm: 6000.0 } }); }
{ const s = spec('i4_triy'); s.e.camProfile = { ex: Object.assign(lobe(262, 10.4, 1.1, 4), { cl: 112.5 }) }; jobs.push({ label: 'v9: measured exhaust profile, centreline 112.5 BTDC', kind: 'spec', spec: s, run: { rpm: 4500.0 } }); }
{ const s = spec('v8_dual'); s.e.camProfile = { in: lobe(244.3, 12.7, 1.0, 1), ex: lobe(252.7, 12.3, 1.0, 1.5) }; jobs.push({ label: 'v9: both profiles on a V8, half-degree lift step', kind: 'spec', spec: s, run: { rpm: 5000.0, lift_step_deg: 0.5 } }); }
{ const s = spec('i4_41'); s.e.camProfile = { in: { deg: [0, 10, 5], mm: [0, 1, 0] } }; jobs.push({ label: 'error: profile degrees not increasing', kind: 'spec', spec: s, run: {} }); }
{ const s = spec('i4_41'); s.e.camProfile = { ex: { deg: [0, 10, 20], mm: [0, 0, 0] } }; jobs.push({ label: 'error: a profile with no lift', kind: 'spec', spec: s, run: {} }); }
{ const s = spec('i4_41'); s.e.camProfile = { in: { deg: [0, 10], mm: [0, 1] } }; jobs.push({ label: 'error: a profile of two points', kind: 'spec', spec: s, run: {} }); }
for (let k = 0; k < 6; k++) {
  const s = randomSpec(spec(['i4_41', 'i4_triy', 'v8_dual'][k % 3]), 500 + k);
  s.e.camProfile = {}; if (k % 3 !== 1) s.e.camProfile.in = lobe(U(200, 290), U(8, 14), U(0.8, 1.2), [0.5, 1, 2, 3][k % 4]); if (k % 3 !== 2) s.e.camProfile.ex = Object.assign(lobe(U(200, 290), U(8, 14), U(0.8, 1.2), [1, 2, 0.75][k % 3]), k % 2 ? { cl: U(100, 120) } : {});
  jobs.push({ label: 'random profile ' + k, kind: 'spec', spec: JSON.parse(JSON.stringify(s)), run: { rpm: Math.round(U(1500, 7000)), cycles: 8 } });
}
// v8: merge losses from CFD (a quadratic pressure loss on each line into the junction)
{ const sp = spec('i4_41'); sp.opt.collector.loss_K = 0.55; jobs.push({ label: 'v8: 4-1 merge loss K 0.55', kind: 'spec', spec: sp, run: { rpm: 6000.0 } }); }
{ const sp = spec('i4_triy'); sp.opt.collectors[0].stages[0].loss_K = 0.3; sp.opt.collectors[0].loss_K = 0.45; jobs.push({ label: 'v8: Tri-Y, both merges with a loss', kind: 'spec', spec: sp, run: { rpm: 6000.0 } }); }
{ const sp = spec('v8_dual'); sp.opt.collectors[1].loss_K = 0.123456789; jobs.push({ label: 'v8: dual 4-1, one collector with a loss', kind: 'spec', spec: sp, run: { rpm: 5000.0, step_bc: 'branch' } }); }
{ const sp = spec('i4_41'); sp.opt.collector.loss_K = 0.5; jobs.push({ label: 'error: a primary too short for the merge loss', kind: 'spec', spec: sp, run: { rpm: 6000.0, cell_mm: 300 } }); }
{ const sp = spec('i4_41'); sp.opt.collector.loss_K = -1; jobs.push({ label: 'error: a negative merge loss', kind: 'spec', spec: sp, run: { rpm: 6000.0 } }); }
jobs.push({ label: 'error: chambers', kind: 'spec', spec: Object.assign(spec('i4_41'), { exhaust: Object.assign(spec('i4_41').exhaust, { chambers: [{ x: 0.1, V: 1e-4, A: 1e-5, Le: 0.002 }] }) }), run: {} });
jobs.push({ label: 'error: tail ends in a plenum', kind: 'spec', spec: withTail(spec('i4_41'), [{ L_mm: 500, d0_mm: 60, d1_mm: 60 }, { V_litres: 5 }]), run: {} });
jobs.push({ label: 'error: tail starts with a plenum', kind: 'spec', spec: withTail(spec('i4_41'), [{ V_litres: 5 }, { L_mm: 500, d0_mm: 60, d1_mm: 60 }]), run: {} });
jobs.push({ label: 'error: ins_cycles 0', kind: 'spec', spec: spec('i4_41'), run: { ins_cycles: 0 } });

const py = python(jobs);
let ok = 0, bad = 0;
jobs.forEach((j, i) => {
  const a = py[i], b = js(j);
  let pass, why = '';
  if (a.error || b.error) { pass = !!(a.error && b.error); why = 'py: ' + (a.error || 'ok') + ' | js: ' + (b.error || 'ok'); }
  else if (a.text !== b.text) {
    pass = false;
    const la = a.text.split('\n'), lb = b.text.split('\n');
    const n = la.findIndex((x, q) => x !== lb[q]);
    why = 'first difference at line ' + (n + 1) + ':\n    py ' + JSON.stringify(la[n]) + '\n    js ' + JSON.stringify(lb[n]);
  } else {
    pass = true;
    if (j.ref !== undefined) { pass = a.text === j.ref; why = pass ? 'identical to the v1 file' : 'differs from the v1 file'; }
    else why = a.text.split('\n').length + ' lines identical';
  }
  if (pass) ok++; else bad++;
  if (a.error && j.label.startsWith("random")) console.log("  (both raised) " + j.label + ": " + a.error);
  if (!pass || !j.label.startsWith("random")) console.log((pass ? 'PASS ' : 'FAIL ') + j.label + ': ' + why);
});
console.log('random cases: ' + jobs.filter((j, i) => j.label.startsWith('random')).length + ' compared');
console.log(ok + ' passed, ' + bad + ' failed');

// formatting spot checks against Python
const nums = [0.15, 0.1 + 0.2, 1e-5, 2.5e-5, 123456789012.5, 3.814697265625e-06, 0.0078125, 1e21, 299.99999999999994, 2.1e11, 44e6, 0.000643562, 1234.5];
const pyfmt = spawnSync('python3', ['-c', 'import json,sys; xs=json.load(sys.stdin); print(json.dumps([["%.12g"%x, "%g"%x, repr(round(x,6)), repr(round(x,2))] for x in xs]))'],
  { input: JSON.stringify(nums), encoding: 'utf8' });
const pf = JSON.parse(pyfmt.stdout);
let fbad = 0;
nums.forEach((x, i) => {
  const jsv = [W.fmtG(x, 12), W.fmtG(x, 6), W.pyRound(x, 6), W.pyRound(x, 2)];
  const pyv = [pf[i][0], pf[i][1], Number(pf[i][2]), Number(pf[i][3])];
  if (jsv.some((v, q) => v !== pyv[q])) { fbad++; console.log('FORMAT MISMATCH', x, jsv, pyv); }
});
console.log('number formatting spot checks: ' + (nums.length - fbad) + '/' + nums.length + ' agree');

// readAvg on a real file, if one exists
const avgPath = path.join(HERE, 'runs', 'i4_41_6000', 'i4_41_6000AVG.DAT');
if (fs.existsSync(avgPath)) {
  const r = W.readAvg(fs.readFileSync(avgPath, 'utf8'));
  const c = r.cycles[r.cycles.length - 1];
  console.log('readAvg: ' + r.cycles.length + ' cycles, ' + r.nCyl + ' cylinders, Vd ' + (r.vdCyl_m3 * 1e6).toFixed(2) + ' cc; last: torque_net ' +
    c.torque_net_Nm.toFixed(1) + ' Nm, IMEP ' + c.imep_bar.toFixed(3) + ' bar, NMEP ' + c.nmep_bar.toFixed(3) + ', VE delivered ' + c.ve_delivered.toFixed(4) +
    ', VE trapped ' + c.ve_trapped.toFixed(4) + ', power ' + c.power_kW.toFixed(1) + ' kW');
}
// readIns against make_wam.read_ins on a real INS file with an outlet point and a plenum, if one exists
let ibad = 0;
const insPath = path.join(HERE, 'runs', 'tail_V7.2_3000', 'tail_V7.2_3000INS.DAT');
if (fs.existsSync(insPath)) {
  const txt = fs.readFileSync(insPath, 'utf8');
  const tailRun = { rpm: 3000.0, cycles: 12, name: 'tail_V7.2_3000', ins_outlet: 1, ins_cycles: 2, out_step_deg: W.outStepForRate(3000, 20000.0) };
  const j = W.readIns(txt, { keepCycles: 2, model: W.modelFromSpec(withTail(spec('i4_41'), TAIL1.map(e => Object.assign({}, e))), tailRun) });
  const pyr = spawnSync('python3', ['-c', 'import json,sys; sys.path.insert(0,' + JSON.stringify(HERE) + '); import make_wam, tail_test; ' +
    'm=make_wam.model_from_spec(tail_test.tail_spec(7.2), ' + JSON.stringify(tailRun) + '); ' +
    'r=make_wam.read_ins(open(sys.argv[1]).read(), keep_cycles=2, model=m); ' +
    'print(json.dumps({"n":len(r["time"]),"cycles":r["cycles"],"pipe":r["pipe"],"x_m":r["x_m"],"outlets":r["outlets"],"sum_p":sum(r["p"]),"sum_u":sum(r["u"]),"sum_T":sum(r["T"]),"sum_mdot":sum(r["mdot"]),"sum_rho":sum(r["rho"]),' +
    '"pl":{k:[sum(v["p"]),sum(v["T"]),sum(v["m"])] for k,v in r["plenums"].items()},"ports":{"%d/%s"%(k,s):[w["pipe"],w["x_m"],sum(w["mdot"]),sum(w["p"]),sum(w["T"])] for k,v in r["ports"].items() for s,w in v.items()}}))', insPath], { encoding: 'utf8' });
  if (pyr.status !== 0) throw new Error(pyr.stderr);
  const py = JSON.parse(pyr.stdout);
  const sum = a => a.reduce((s, x) => s + x, 0);
  const jsv = { n: j.time.length, cycles: j.cycles, pipe: j.pipe, x_m: j.x_m, outlets: j.outlets, sum_p: sum(j.p), sum_u: sum(j.u), sum_T: sum(j.T), sum_mdot: sum(j.mdot), sum_rho: sum(j.rho),
    pl: Object.fromEntries(Object.entries(j.plenums).map(([k, v]) => [k, [sum(v.p), sum(v.T), sum(v.m)]])),
    ports: Object.fromEntries(Object.entries(j.ports).flatMap(([k, v]) => Object.entries(v).map(([s, w]) => [k + '/' + s, [w.pipe, w.x_m, sum(w.mdot), sum(w.p), sum(w.T)]]))) };
  const same = (a, b) => typeof a === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) : JSON.stringify(a) === JSON.stringify(b);
  for (const k of ['n', 'cycles', 'pipe', 'x_m', 'outlets', 'sum_p', 'sum_u', 'sum_T', 'sum_mdot', 'sum_rho']) if (!same(jsv[k], py[k])) { ibad++; console.log('READINS MISMATCH', k, jsv[k], py[k]); }
  for (const k in py.pl) for (let q = 0; q < 3; q++) if (!same(jsv.pl[k][q], py.pl[k][q])) { ibad++; console.log('READINS plenum MISMATCH', k, q, jsv.pl[k][q], py.pl[k][q]); }
  if (JSON.stringify(Object.keys(py.ports).sort()) !== JSON.stringify(Object.keys(jsv.ports).sort())) { ibad++; console.log('READINS ports MISMATCH', Object.keys(jsv.ports), Object.keys(py.ports)); }
  for (const k in py.ports) for (let q = 0; q < 5; q++) if (!jsv.ports[k] || !same(jsv.ports[k][q], py.ports[k][q])) { ibad++; console.log('READINS port MISMATCH', k, q, jsv.ports[k] && jsv.ports[k][q], py.ports[k][q]); }
  console.log('readIns vs read_ins on ' + path.basename(insPath) + ': ' + (ibad ? ibad + ' mismatches' : 'identical') + ' (' + j.time.length + ' rows, ' + j.cycles + ' cycles, pipe ' + j.pipe + ', plenums ' + Object.keys(j.plenums) + ', ports ' + Object.keys(jsv.ports) + ')');
}
fs.writeFileSync(path.join(HERE, 'example_run_all.bat'), W.batFile(['i4_41_4000', 'i4_41_6000', 'i4_41_7800'], W.USER_EXE));
console.log('wrote example_run_all.bat');
process.exit(bad || fbad || ibad ? 1 : 0);
