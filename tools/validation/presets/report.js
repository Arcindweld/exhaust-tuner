// Markdown tables for docs/PRESET_DATA_2026-11-18.md from research.json, worklist.json (the car and truck engine list as
// the page lists it now) and results/effect.json.   node tools/validation/presets/report.js > fragment.md
'use strict';
const fs = require('fs'), path = require('path');
const R = require('./research.json'), W = require('./worklist.json');
const E = fs.existsSync(path.join(__dirname, 'results', 'effect.json')) ? require('./results/effect.json') : null;
const BIKE = new Set(['bike', 'bikec', 'mx', 'bike2t']);
const ours = new Set(Object.values(R.engines).flatMap(e => e.targets.filter(t => !t.had).map(t => t.name)));
const car = W.items.filter(r => r.picker && !BIKE.has(r.g) && r.cyc === '4');
const out = [];
// coverage by maker (the car and truck engine list, four-strokes)
const by = {};
for (const r of car) { const m = by[r.maker] = by[r.maker] || { n: 0, before: 0, after: 0 }; m.n++; if (r.bore && r.stroke) { m.after++; if (!ours.has(r.name)) m.before++; } }
out.push('| Maker | Presets | With bore and stroke before | After |', '|---|---:|---:|---:|');
Object.entries(by).sort((a, b) => b[1].n - a[1].n).forEach(([m, x]) => out.push('| ' + m + ' | ' + x.n + ' | ' + x.before + ' | ' + x.after + ' |'));
const tot = Object.values(by).reduce((a, x) => ({ n: a.n + x.n, before: a.before + x.before, after: a.after + x.after }), { n: 0, before: 0, after: 0 });
out.push('| **All** | **' + tot.n + '** | **' + tot.before + '** | **' + tot.after + '** |', '');
// per quality label: engine entries, preset entries written
const q = {};
for (const e of Object.values(R.engines)) { const x = q[e.q] = q[e.q] || { ent: 0, pre: 0, car: 0 }; x.ent++; x.pre += e.targets.length; }
out.push('| Quality label | Source entries | Preset entries given the source |', '|---|---:|---:|');
Object.entries(q).sort((a, b) => b[1].pre - a[1].pre).forEach(([k, x]) => out.push('| ' + k + ' | ' + x.ent + ' | ' + x.pre + ' |'));
out.push('');
// the source table summary
out.push('| Entry | Bore x stroke (mm) | Other fields | Quality | Source | Presets |', '|---|---|---|---|---|---:|');
for (const [id, e] of Object.entries(R.engines).sort()) out.push('| ' + id + ' | ' + e.bore + ' x ' + e.stroke + ' | ' + [e.cr ? 'CR ' + e.cr : '', e.valves ? e.valves + ' valves' : '', e.red ? 'redline ' + e.red : ''].filter(Boolean).join(', ') + ' | ' + e.q + ' | ' + e.src + ' | ' + e.targets.length + ' |');
out.push('');
if (E) {
  const g = E.geo.slice().sort((a, b) => Math.abs(b.upReal - b.upEst) - Math.abs(a.upReal - a.upEst));
  out.push('| Preset | Estimate B x S | Sourced B x S | Stroke | Piston speed at redline | Intake valve (scaled) | Rod (1.7 x S) |', '|---|---|---|---:|---|---|---|');
  g.slice(0, 20).forEach(x => out.push('| ' + x.name + ' | ' + x.est.B.toFixed(1) + ' x ' + x.est.S.toFixed(1) + ' | ' + x.bore + ' x ' + x.stroke + ' | ' + (x.dS > 0 ? '+' : '') + x.dS + ' % | ' + x.upEst.toFixed(1) + ' -> ' + x.upReal.toFixed(1) + ' m/s at ' + x.redline + ' | ' + x.vInEst + ' -> ' + x.vInReal + ' mm | ' + x.rodEst + ' -> ' + x.rodReal + ' mm |'));
  out.push('');
  const ds = E.geo.map(x => x.dS).sort((a, b) => a - b), med = ds[Math.floor(ds.length / 2)];
  out.push('Stroke error of the estimate over the ' + ds.length + ' changed presets: ' + ds[0] + ' to +' + ds[ds.length - 1] + ' %, median ' + med + ' %; |error| above 10 %: ' + ds.filter(x => Math.abs(x) > 10).length + '.', '');
  const w = Object.entries(E.wave).filter(([, x]) => x.dPeakTq != null);
  out.push('| Preset (picker) | Stroke | Peak torque before -> after (N m, rpm) | Change | VE at the peak | Highest VE |', '|---|---:|---|---:|---|---|');
  w.sort((a, b) => Math.abs(b[1].dPeakTq) - Math.abs(a[1].dPeakTq)).forEach(([k, x]) => out.push('| ' + k + ' | ' + (x.dS > 0 ? '+' : '') + x.dS + ' % | ' + x.before.peakTq + ' @ ' + x.before.peakRpm + ' -> ' + x.after.peakTq + ' @ ' + x.after.peakRpm + ' | ' + (x.dPeakTq > 0 ? '+' : '') + x.dPeakTq + ' % | ' + x.before.veAtPeak + ' -> ' + x.after.veAtPeak + ' | ' + x.before.veMax + ' -> ' + x.after.veMax + ' |'));
  const dt = w.map(([, x]) => Math.abs(x.dPeakTq)).sort((a, b) => a - b);
  out.push('', w.length + ' presets run; |peak torque change| median ' + (dt[Math.floor(dt.length / 2)] || 0) + ' %, largest ' + (dt[dt.length - 1] || 0) + ' %.', '');
}
// needs review, tried
out.push('Needs review:', ...Object.entries(R.review).map(([k, x]) => '- ' + k + ': ' + (x.why || '') + (x.found && typeof x.found === 'string' ? ' (' + x.found + ')' : '')), '');
out.push('Searched without a usable source:', ...Object.entries(R.tried).map(([k, x]) => '- ' + k + ': ' + x));
console.log(out.join('\n'));
