// The research checkpoint for the bore-and-stroke sourcing round: tools/validation/presets/research.json.
// One engine per call, so a container restart loses nothing:
//   node tools/validation/presets/rs.js add <id> '<json>'
//     json: { sel: "<regex on the preset's engine code>" | names: [...], cc: [lo, hi] (optional, the presets' cc to take),
//             bore, stroke (mm), cr, valves, red (optional, only when the same source states them),
//             ccStated (the source's own cc, optional), src (URL), says (the figures as written), q (quality label), note }
//     Resolves the selection against worklist.json (every MOTORS and VEH entry), checks pi/4 x bore^2 x stroke x cylinders
//     against each target's displacement (1 %; or against ccStated when the preset's cc is a rounded figure, said in a
//     note) and stores the entry; a target outside 1 % is not taken (listed under review with what was found).
//   node tools/validation/presets/rs.js review <id> '<json>'   a finding parked for review (no value applied)
//   node tools/validation/presets/rs.js tried <id> '<text>'    a search that found no usable source
//   node tools/validation/presets/rs.js show [regex]           presets without bore and stroke (car list), by code
'use strict';
const fs = require('fs'), path = require('path');
const F = path.join(__dirname, 'research.json'), W = require(path.join(__dirname, 'worklist.json'));
const db = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : { about: 'bore and stroke sourcing, docs/PRESET_DATA_2026-11-18.md', engines: {}, review: {}, tried: {} };
const save = () => { fs.writeFileSync(F + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(F + '.tmp', F); };
const BIKE = new Set(['bike', 'bikec', 'mx', 'bike2t']);
const QUAL = ['maker data', 'reputable vendor', 'magazine test', 'secondary: encyclopedia'];
const [cmd, id, arg] = process.argv.slice(2);
const geo = (b, s, n) => Math.PI / 4 * b * b * s * n / 1000;
if (cmd === 'add') {
  const e = JSON.parse(arg);
  if (!QUAL.includes(e.q)) throw new Error('quality label must be one of ' + QUAL.join(' / '));
  if (!/^https?:\/\/\S+$/.test(e.src || '')) throw new Error('src must be a URL');
  if (!(e.bore > 0 && e.stroke > 0) || !e.says) throw new Error('bore, stroke and says are required');
  const re = e.sel ? new RegExp(e.sel) : null;
  const cand = W.items.filter(r => r.cyc === '4' && (e.names ? e.names.includes(r.name) : re.test(r.code || '')) && (!e.cc || (r.cc >= e.cc[0] && r.cc <= e.cc[1])));
  const ok = [], bad = [];
  for (const r of cand) {
    const g = geo(e.bore, e.stroke, r.cyl), d = (g - r.cc) / r.cc, ds = e.ccStated ? (g - e.ccStated) / e.ccStated : null;
    const row = { name: r.name, arr: r.arr, cc: r.cc, cyl: r.cyl, geo: +g.toFixed(1), dPct: +(100 * d).toFixed(2), had: r.bore ? [r.bore, r.stroke] : null };
    if (Math.abs(d) <= 0.01 || (ds !== null && Math.abs(ds) <= 0.01 && Math.abs(d) <= 0.02)) ok.push(row); else bad.push(row);
  }
  e.seen = e.seen || new Date().toISOString().slice(0, 10);
  e.targets = ok; delete e.sel_resolved;
  db.engines[id] = e;
  if (bad.length) db.review[id] = { found: { bore: e.bore, stroke: e.stroke, src: e.src, says: e.says, q: e.q }, mismatch: bad, why: 'bore x stroke x cylinders outside 1 % of the preset displacement' };
  else delete db.review[id];
  save();
  console.log(id + ': ' + ok.length + ' targets' + (ok.length ? ' (' + ok.map(r => r.name.slice(0, 40) + ' ' + r.dPct + '%').join('; ') + ')' : '') + (bad.length ? ' | REVIEW ' + bad.map(r => r.name.slice(0, 40) + ' ' + r.dPct + '%').join('; ') : ''));
} else if (cmd === 'review') { db.review[id] = Object.assign(JSON.parse(arg), { seen: new Date().toISOString().slice(0, 10) }); save(); console.log('review ' + id); }
else if (cmd === 'tried') { db.tried[id] = arg; save(); console.log('tried ' + id); }
else if (cmd === 'show') {
  const done = new Set(Object.values(db.engines).flatMap(e => e.targets.map(t => t.name)));
  const re = id ? new RegExp(id) : null;
  const left = W.items.filter(r => r.picker && !BIKE.has(r.g) && r.cyc === '4' && !(r.bore && r.stroke) && !done.has(r.name) && (!re || re.test(r.code)));
  console.log(left.length + ' car-list presets still without a sourced bore and stroke');
  if (re) left.forEach(r => console.log('  ' + r.code + ' | ' + r.cc + ' | ' + r.cyl + ' | ' + r.name));
} else console.log('usage: add | review | tried | show');
