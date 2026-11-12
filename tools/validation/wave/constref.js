// The constant-gamma reference (2026-11-12): every result the page's worker uses (VE, IMEP, peak pressure, residual,
// pressure at EVO, exhaust temperature, port pressure at overlap, each cylinder's VE and IMEP) for the page's captured
// worker jobs (web/tests/fixtures/wave_jobs.json) and wave_wasm.js's diameter-step job, run with spec.e.gas = 'const'
// (gamma 1.35, R 287, the model before temperature- and composition-dependent gas properties).
//   node tools/validation/wave/constref.js write   writes web/tests/fixtures/wave_const_ref.json (run on the page of
//                                                  commit 017cdbf, before the change, where e.gas is not read)
//   node tools/validation/wave/constref.js         compares the page's constant-gamma mode with the file, bit for bit
'use strict';
const fs = require('fs'), path = require('path');
const { load, ROOT } = require('./lib');
const WS = load();
const FIX = path.join(ROOT, 'web', 'tests', 'fixtures', 'wave_const_ref.json');
const KEYS = ['ve', 'imep', 'pmax', 'resid', 'pEvo', 'tEx', 'overlapPort'];
function jobs() {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'tests', 'fixtures', 'wave_jobs.json'), 'utf8'));
  const e = j[0].job.variants[0].spec.e;
  j.push({ name: 'diameter steps', job: { dx: 0.01, rpms: [3000, 5000, 7000, 9000], variants: [{ label: 'chamber and stepped runner', spec: { e,
    intake: { segs: [{ L: 0.15, d0: 0.06, d1: 0.06 }, { L: 0.15, d0: 0.045, d1: 0.045 }], Tw: 320 },
    exhaust: { segs: [{ L: 0.5, d0: 0.0445, d1: 0.0445 }, { L: 0.3, d0: 0.127, d1: 0.127 }, { L: 0.6, d0: 0.0445, d1: 0.0445 }], Tw: 700, chambers: [] },
    opt: { phases: [0] } } }] } });
  return j;
}
function run(quick) {
  const out = [];
  for (const { name, job } of jobs()) for (const v of job.variants) {
    const rpms = quick ? job.rpms.slice(0, quick) : job.rpms;
    const e = Object.assign({}, v.spec.e, { gas: 'const' });
    const eng = WS.makeEngine(e, v.spec.intake, v.spec.exhaust, v.spec.opt);
    const res = WS.sweep(eng, rpms, { dx: job.dx, cycles: 3, firstCycles: 8, maxExtra: 5 });
    out.push({ name, label: v.label, rpms, res: res.map(r => { const o = {}; KEYS.forEach(k => { o[k] = r[k]; }); o.perCyl = r.perCyl.map(c => [c.ve, c.imep]); return o; }) });
  }
  return out;
}
if (require.main === module) {
  if (process.argv[2] === 'write') { fs.writeFileSync(FIX, JSON.stringify(run())); console.log('wrote ' + FIX); }
  else {
    const ref = JSON.parse(fs.readFileSync(FIX, 'utf8')), now = run();
    let bad = 0;
    ref.forEach((r, k) => r.res.forEach((x, i) => { const y = now[k].res[i];
      for (const q of KEYS) if (!Object.is(x[q], y[q])) { bad++; console.log('DIFF ' + r.name + ' / ' + r.label + ' ' + r.rpms[i] + ' rpm ' + q + ': ' + x[q] + ' -> ' + y[q]); }
      x.perCyl.forEach((c, j) => { if (!Object.is(c[0], y.perCyl[j][0]) || !Object.is(c[1], y.perCyl[j][1])) { bad++; console.log('DIFF perCyl ' + j); } }); }));
    console.log(bad ? 'FAIL ' + bad + ' differences' : 'PASS constant-gamma mode identical to the reference, ' + ref.reduce((a, r) => a + r.res.length, 0) + ' speeds');
    process.exit(bad ? 1 : 0);
  }
}
module.exports = { run, jobs, KEYS, FIX };
