// re-pin only the constant-gamma reference rows whose spec has side volumes (exhaust.chambers); print old -> new
const fs = require('fs'), path = require('path'); const { load, ROOT } = require('./lib'); const WS = load();
const FIX = path.join(ROOT, 'web/tests/fixtures/wave_const_ref.json'), ref = JSON.parse(fs.readFileSync(FIX, 'utf8'));
const jobs = JSON.parse(fs.readFileSync(path.join(ROOT, 'web/tests/fixtures/wave_jobs.json'), 'utf8'));
const KEYS = ['ve', 'imep', 'pmax', 'resid', 'pEvo', 'tEx', 'overlapPort'];
for (const r of ref) {
  const J = jobs.find(j => j.name === r.name); if (!J) continue; const v = J.job.variants.find(q => q.label === r.label);
  if (!(v.spec.exhaust.chambers || []).length) continue;
  const eng = WS.makeEngine(Object.assign({}, v.spec.e, { gas: 'const' }), v.spec.intake, v.spec.exhaust, v.spec.opt);
  const res = WS.sweep(eng, r.rpms, { dx: J.job.dx, cycles: 3, firstCycles: 8, maxExtra: 5 });
  const nw = res.map(x => { const o = {}; KEYS.forEach(k => { o[k] = x[k]; }); o.perCyl = x.perCyl.map(c => [c.ve, c.imep]); return o; });
  r.rpms.forEach((rpm, i) => console.log(r.name + ' / ' + r.label + ' ' + rpm + ' rpm: ve ' + r.res[i].ve.toFixed(4) + ' -> ' + nw[i].ve.toFixed(4) + ', imep ' + (r.res[i].imep / 1e5).toFixed(3) + ' -> ' + (nw[i].imep / 1e5).toFixed(3) + ' bar'));
  r.res = nw;
}
fs.writeFileSync(FIX, JSON.stringify(ref)); console.log('rewrote the chamber rows of ' + FIX);
