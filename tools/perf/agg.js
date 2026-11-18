// node agg.js profile.json [N] : self and total time by function (name@line)
const p = JSON.parse(require('fs').readFileSync(process.argv[2])); const N = +(process.argv[3] || 40);
const byId = new Map(p.nodes.map(n => [n.id, n])); const parent = new Map();
for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
const dt = new Map(); for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) || 0) + (p.timeDeltas[i + 1] || 0) / 1000);
const key = n => (n.callFrame.functionName || '(anon)') + '@' + (n.callFrame.lineNumber + 1);
const self = {}, tot = {};
for (const [id, t] of dt) { let n = byId.get(id); self[key(n)] = (self[key(n)] || 0) + t; const seen = new Set();
  for (let x = id; x != null; x = parent.get(x)) { const k = key(byId.get(x)); if (seen.has(k)) continue; seen.add(k); tot[k] = (tot[k] || 0) + t; } }
const all = Object.values(self).reduce((a, b) => a + b, 0);
console.log('total sampled ms', all.toFixed(0));
console.log('--- self'); for (const [k, v] of Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, N)) console.log(v.toFixed(1).padStart(8), k);
console.log('--- total'); for (const [k, v] of Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, N)) console.log(v.toFixed(1).padStart(8), k);
