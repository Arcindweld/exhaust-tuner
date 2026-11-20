// Writes the sourced bore and stroke of tools/validation/presets/research.json into the engine presets of web/index.html
// (docs/PRESET_DATA_2026-11-18.md). Deterministic, re-runnable and idempotent: each preset is one source line, found by
// its name; the fields are written in the list's own style (bore:..,stroke:.. after cc, cr and valves after them when the
// same source states them and the preset has none) and the source as bsSrc:'URL',bsQ:'quality label' before src.
// A preset that already has a bore and stroke of its own (no bsSrc) is left as it is unless the figures agree, when only
// the source is added; one that disagrees is reported, never overwritten.
//   node tools/validation/presets/apply.js [--check]   (--check: report what would change, write nothing)
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..'), PAGE = path.join(ROOT, 'web', 'index.html');
const R = JSON.parse(fs.readFileSync(path.join(__dirname, 'research.json'), 'utf8'));
const check = process.argv.includes('--check');
const src = fs.readFileSync(PAGE, 'utf8'), lines = src.split('\n');
const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const num = x => String(+(+x).toFixed(3));
const byName = {};
lines.forEach((l, i) => { const m = l.match(/^\s*\{.*?name:'((?:[^'\\]|\\.)*)'/); if (m) (byName[m[1].replace(/\\'/g, "'")] = byName[m[1].replace(/\\'/g, "'")] || []).push(i); });
const log = { changed: 0, same: 0, sourceOnly: 0, conflict: [], missing: [], would: [] };
const ids = Object.keys(R.engines).sort();
for (const id of ids) {
  const e = R.engines[id];
  for (const t of e.targets) {
    const at = byName[t.name];
    if (!at || at.length !== 1) { log.missing.push(id + ': ' + t.name + (at ? ' (name on ' + at.length + ' lines)' : ' (not found)')); continue; }
    const i = at[0], old = lines[i];
    let l = old;
    const has = k => new RegExp('[{,]' + k + ':').test(l);
    const get = k => { const m = l.match(new RegExp('[{,]' + k + ':([0-9.]+)')); return m ? +m[1] : null; };
    const set = (k, v, after) => {   // replace the value, or insert "k:v," after the field named in after
      if (has(k) && Math.abs(get(k) - +v) < 1e-9) return;
      if (has(k)) l = l.replace(new RegExp('([{,]' + k + ':)[^,}]*'), '$1' + v);
      else { const m = l.match(new RegExp('[{,]' + after + ':[^,}]*,')); if (!m) throw new Error('no ' + after + ' on ' + t.name); l = l.replace(m[0], m[0] + k + ':' + v + ','); }
    };
    const ours = /[{,]bsSrc:'/.test(l);
    if (has('bore') && !ours) {
      if (Math.abs(get('bore') - e.bore) < 0.06 && Math.abs(get('stroke') - e.stroke) < 0.06) log.sourceOnly++;
      else { log.conflict.push(id + ': ' + t.name + ' has ' + get('bore') + ' x ' + get('stroke') + ', the source ' + e.bore + ' x ' + e.stroke); continue; }
    } else if (!(has('bore') && Math.abs(get('bore') - e.bore) < 0.06 && Math.abs(get('stroke') - e.stroke) < 0.06)) { set('bore', num(e.bore), 'cc'); set('stroke', num(e.stroke), 'bore'); }
    // (a line given only the source on an earlier run keeps its own figures when they agree to 0.06 mm: idempotent)
    // compression and valves: written when the preset has none; an existing figure is kept (a differing one reported)
    if (e.cr) { if (!has('cr')) set('cr', num(e.cr), 'stroke'); else if (Math.abs(get('cr') - e.cr) > 0.05) log.conflict.push(id + ': ' + t.name + ' keeps its compression ' + get('cr') + ', the source ' + e.cr); }
    if (e.valves) { if (!has('valves')) set('valves', String(e.valves), has('cr') ? 'cr' : 'stroke'); else if (get('valves') !== e.valves) log.conflict.push(id + ': ' + t.name + ' keeps its valves ' + get('valves') + ', the source ' + e.valves); }
    if (e.red && /[{,]red:null/.test(l)) l = l.replace(/([{,]red:)null/, '$1' + e.red);
    const tag = "bsSrc:'" + esc(e.src) + "',bsQ:'" + esc(e.q) + "'";
    if (ours) l = l.replace(/bsSrc:'(?:[^'\\]|\\.)*',bsQ:'(?:[^'\\]|\\.)*'/, tag);
    else if (/[{,]src:/.test(l)) l = l.replace(/([{,])src:/, '$1' + tag + ',src:');
    else l = l.replace(/\}(,?)\s*$/, ',' + tag + '}$1');
    if (l !== old) { lines[i] = l; log.changed++; if (check) log.would.push(id + ': ' + t.name); } else log.same++;
  }
}
if (!check && log.changed) fs.writeFileSync(PAGE, lines.join('\n'));
console.log((check ? '[check] ' : '') + log.changed + ' preset lines ' + (check ? 'would change' : 'changed') + ', ' + log.same + ' already up to date, ' + log.sourceOnly + ' had the same figures (source added)');
for (const w of log.would) console.log('WOULD CHANGE ' + w);
for (const c of log.conflict) console.log('CONFLICT ' + c);
for (const m of log.missing) console.log('MISSING ' + m);
process.exitCode = log.missing.length ? 1 : 0;
