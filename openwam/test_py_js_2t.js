// test_py_js_2t.js - byte-for-byte comparison of wam2t_export.js against make_wam2t.py, and of the results summary.
//   node test_py_js_2t.js          (needs python3 on PATH)
// Cases: the two test engines of tests/test_2t.py (125 MX reed, Maico 490) with run settings and spec variations
// (piston-port intake, 0-D reed with a stop, silencer, two cylinders, geometric CR, crankcase volume, no closing fix,
// two transfers, round exhaust window), then randomised specs. The summary is compared on the finished runs in
// runs2t/ when they are there.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const W2 = require('./wam2t_export.js');

const HERE = __dirname;
function python(jobs) {
  const code = [
    'import json, sys, os',
    'sys.path.insert(0, ' + JSON.stringify(HERE) + ')',
    'sys.path.insert(0, ' + JSON.stringify(path.join(HERE, 'tests')) + ')',
    'import make_wam2t as m2, test_2t',
    'jobs = json.load(sys.stdin)',
    'out = []',
    'for j in jobs:',
    '    try:',
    '        if j["kind"] == "case":',
    '            spec = getattr(test_2t, j["fn"])()',
    '            out.append({"spec": spec})',
    '        elif j["kind"] == "wam":',
    '            out.append({"text": m2.make_wam2t(j["spec"], j["run"])})',
    '        else:',
    '            model = m2.model_from_spec(j["spec"], j["run"])',
    '            s = m2.wam2t_summary(j["folder"], model)',
    '            out.append({"sum": s})',
    '    except Exception as ex:',
    '        out.append({"error": "%s: %s" % (type(ex).__name__, ex)})',
    'json.dump(out, sys.stdout, allow_nan=True)',
  ].join('\n');
  const r = spawnSync('python3', ['-c', code], { input: JSON.stringify(jobs), maxBuffer: 1 << 30, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout.replace(/\bNaN\b/g, 'null'));
}
const clone = o => JSON.parse(JSON.stringify(o));
const [s125, sMaico] = python([{ kind: 'case', fn: 'example_125' }, { kind: 'case', fn: 'example_maico' }]).map(x => x.spec);

const cases = [];
const add = (label, spec, run) => cases.push({ label, spec, run });
add('125 reed', s125, { rpm: 11500.0, name: 'mx125' });
add('125 reed 7000, 25 cycles, 5 mm', s125, { rpm: 7000.0, cycles: 25, cell_mm: 5.0, name: 'a' });
add('maico', sMaico, { rpm: 6500.0, name: 'maico' });
add('maico no closing fix', sMaico, { rpm: 5000.0, closing_fix: 0, name: 'b' });
{ const s = clone(s125); s.intake = { type: 'port', segs: s.intake.segs, Tw: 318.15, port: { open_btdc: 75.0, width: 0.04, r_top: 0.005, r_bot: 0.004, cd: 0.62 } }; add('125 piston port', s, { rpm: 10000.0, name: 'pp' }); }
{ const s = clone(s125); s.intake.reed.model = '0d'; s.intake.reed.lift_stop = 0.009; add('125 0-D reed', s, { rpm: 12000.0, name: 'r0' }); }
{ const s = clone(s125); s.exhaust.silencer = { V_m3: 0.0025, segs: [{ L: 0.15, d0: 0.024, d1: 0.024 }, { L: 0.1, d0: 0.03, d1: 0.03 }] }; add('125 silencer', s, { rpm: 11000.0, name: 'sil' }); }
{ const s = clone(s125); s.e.ncyl = 2; add('twin 180', s, { rpm: 11000.0, name: 'twin' }); }
{ const s = clone(s125); s.e.ncyl = 2; s.e.phases = [0.0, -90.0]; add('twin phases', s, { rpm: 9000.0, name: 'tw2' }); }
{ const s = clone(sMaico); delete s.e.cr_trapped; s.e.cr_geom = 11.5; delete s.e.ccr; s.e.Vcc_min = 0.0011; s.e.combEff = 0.9; add('maico cr_geom Vcc', s, { rpm: 6000.0, name: 'cg' }); }
{ const s = clone(s125); s.transfers.push({ dur: 124.0, width: 0.02, r_top: 0.002, r_bot: 0.0, cd: 0.6, height: 0.008, duct: { L: 0.07, d: 0.02 } }); s.exhaust_port.height = 0.03; add('125 two transfers', s, { rpm: 11000.0, name: 'tr2' }); }
{ const s = clone(s125); delete s.e.Twall; delete s.e.burn.a; delete s.e.burn.m; delete s.exhaust_port.cd; delete s.transfers[0].cd; delete s.intake.reed.cd; add('125 defaults', s, { rpm: 11000.0, name: 'df' }); }

// randomised
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const U = (a, b) => a + (b - a) * rnd();
for (let i = 0; i < 40; i++) {
  const base = clone(i % 2 ? s125 : sMaico), S = base.e.stroke;
  base.e.bore *= U(0.85, 1.15); base.e.stroke *= U(0.85, 1.15); base.e.rod = base.e.stroke * U(1.7, 2.2);
  base.e.cr_trapped = U(6, 9.5); base.e.ccr = U(1.25, 1.6); base.e.afr = U(11.5, 14.5);
  base.e.burn = { start: U(10, 35), dur: U(35, 70), a: U(4, 6), m: U(1.5, 2.5) };
  base.exhaust_port.dur = U(170, 205); base.transfers[0].dur = U(115, base.exhaust_port.dur - 30);
  base.exhaust_port.width = base.e.bore * U(0.5, 0.75); base.exhaust_port.r_top = U(0.001, 0.008); base.exhaust_port.r_bot = U(0.0, 0.004);
  delete base.exhaust_port.height;
  base.transfers[0].width = base.e.bore * U(0.6, 1.2);
  base.transfers[0].duct = { L: S * U(1, 1.6), d: base.e.bore * U(0.4, 0.7) };
  base.exhaust.segs = base.exhaust.segs.map(sg => ({ L: sg.L * U(0.9, 1.1), d0: sg.d0, d1: sg.d1 }));
  base.exhaust.Tw = U(600, 800);
  base.intake.reed.petals = 2 + Math.floor(U(0, 6)); base.intake.reed.t = U(0.0003, 0.0007);
  if (i % 5 === 0) base.intake.reed.model = '0d';
  if (i % 7 === 0) { base.e.ncyl = 2 + (i % 3); }
  add('random ' + i, base, { rpm: Math.round(U(4000, 13000)), cycles: 20 + (i % 15), cell_mm: U(5, 10), name: 'r' + i, courant: U(0.6, 0.9) });
}

const py = python(cases.map(c => ({ kind: 'wam', spec: c.spec, run: c.run })));
let fails = 0, same = 0;
cases.forEach((c, i) => {
  let js;
  try { js = { text: W2.makeWam(c.spec, c.run) }; } catch (e) { js = { error: e.message }; }
  const p = py[i];
  if (p.error || js.error) {
    const ok = !!(p.error && js.error);
    if (!ok) { fails++; console.log('FAIL ' + c.label + ': python ' + (p.error || 'ok') + ' / js ' + (js.error || 'ok')); }
    else console.log('both refuse ' + c.label + ': ' + js.error);
    return;
  }
  if (p.text === js.text) { same++; return; }
  fails++;
  const a = p.text.split('\n'), b = js.text.split('\n');
  const k = a.findIndex((l, j) => l !== b[j]);
  console.log('FAIL ' + c.label + ' line ' + (k + 1) + '\n  py: ' + a[k] + '\n  js: ' + b[k]);
});
console.log(same + ' of ' + cases.length + ' cases the same bytes');

// the model's warnings and geometry helpers
{
  const m = W2.modelFromSpec(sMaico, { rpm: 6500.0 });
  console.log('maico: exhaust opens ' + m.eng.ex_open_atdc.toFixed(2) + ' ATDC, warnings: ' + (m.warnings.join('; ') || 'none'));
}

// summary on finished runs
const R = path.join(HERE, 'runs2t');
const sums = [];
if (fs.existsSync(R)) {
  for (const d of fs.readdirSync(R)) {
    const m = d.match(/^(mx125|maico490)_(chamber|straight)_(\d+)$/);
    if (!m || !fs.existsSync(path.join(R, d, d + 'AVG.DAT'))) continue;
    const spec = clone(m[1] === 'mx125' ? s125 : sMaico);
    if (m[2] === 'straight') { const L = spec.exhaust.segs.reduce((a, s) => a + s.L, 0); spec.exhaust.segs = [{ L, d0: spec.exhaust.segs[0].d0, d1: spec.exhaust.segs[0].d0 }]; }
    sums.push({ d, spec, run: { rpm: +m[3], name: d, cycles: 30, cell_mm: 8.0 } });
  }
}
if (sums.length) {
  const ps = python(sums.map(s => ({ kind: 'sum', folder: path.join(R, s.d), spec: s.spec, run: s.run })));
  let worst = 0, bad = 0;
  sums.forEach((s, i) => {
    const model = W2.modelFromSpec(s.spec, s.run);
    const f = n => { const p = path.join(R, s.d, n); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
    const js = W2.summary(model, { avg: f(s.d + 'AVG.DAT'), ins: f(s.d + 'INS.DAT'), log: f('run.log') });
    const p = ps[i].sum;
    if (!p) { bad++; console.log('FAIL summary ' + s.d + ': ' + ps[i].error); return; }
    for (const k of Object.keys(p)) {
      if (k === 'NMEP_history' || typeof p[k] !== 'number') continue;
      const a = p[k], b = js[k], rel = Math.abs(a - b) / Math.max(1e-30, Math.abs(a));
      if (!(rel < 1e-12)) { if (!(a === null && Number.isNaN(b))) { bad++; console.log('FAIL summary ' + s.d + ' ' + k + ': ' + a + ' vs ' + b); } }
      else worst = Math.max(worst, rel);
    }
    if (p.finished !== js.finished) { bad++; console.log('FAIL summary ' + s.d + ' finished'); }
  });
  console.log('summary: ' + sums.length + ' runs, ' + (bad ? bad + ' differences' : 'the same numbers') + ' (worst relative difference ' + worst.toExponential(1) + ')');
  fails += bad;
}
process.exit(fails ? 1 : 0);
