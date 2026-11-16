// The engine presets' own numbers against each other (docs/SPEC_PARITY_AUDIT_2026-11-16.md, addendum A1 (b)): every
// preset of the engine list chosen in one page, and the 4-Stroke tab's fields it fills read back: displacement against
// bore x bore x stroke x cylinders (pi/4), the valve heads against the bore, the rod against the stroke, the compression.
// Flags a preset whose numbers disagree by more than 2 % (displacement) or fall outside plain ranges.
//   node tools/validation/wave/preset_geometry.js
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const PAGE = path.join(__dirname, '..', '..', '..', 'web', 'index.html');
(async () => {
  const b = await chromium.launch(), pg = await b.newPage();
  await pg.goto('file://' + PAGE + '#four-stroke'); await pg.waitForTimeout(600);
  const rows = await pg.evaluate(() => {
    const f = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    document.getElementById('u-met').click(); f('v-mode', 'eng');
    const ops = [...document.getElementById('v-pick').options].filter(o => o.value !== ''), out = [];
    const B = id => { const e = document.getElementById(id); return Number.isFinite(e._b) ? e._b : null; };
    for (const o of ops) { f('v-pick', o.value);
      const note = document.getElementById('v-note').textContent;
      out.push({ name: o.text, four: /Filled in on 4-Stroke/.test(note), cc: B('f-disp'), cyl: B('f-cyl'), bore: B('f-bore'), stroke: B('f-stroke'), cr: B('f-cratio'), vdi: B('f-vdi'), vde: B('f-vde'), rod: B('f-rod'), valves: document.getElementById('f-valves').value, rpm: B('f-rpm') }); }
    return out; });
  const bad = [];
  for (const r of rows) { if (!r.four) continue; const w = [];
    if (r.bore && r.stroke) { const cc = Math.PI / 4 * r.bore * r.bore * r.stroke * r.cyl / 1000, d = (cc - r.cc) / r.cc; r.ccGeo = +cc.toFixed(1); r.dcc = +(100 * d).toFixed(2); if (Math.abs(d) > 0.02) w.push('displacement ' + r.cc + ' cc against ' + cc.toFixed(0) + ' cc from bore x stroke x ' + r.cyl + ' (' + (100 * d).toFixed(1) + ' %)'); }
    else w.push('no bore or stroke (estimated from the displacement)');
    if (r.bore && (r.bore / r.stroke > 1.6 || r.bore / r.stroke < 0.6)) w.push('bore/stroke ' + (r.bore / r.stroke).toFixed(2));
    if (r.vdi && r.bore && (r.vdi / r.bore > 0.6 || r.vdi / r.bore < 0.3)) w.push('intake valve ' + r.vdi + ' mm on a ' + r.bore + ' mm bore');
    if (r.vde && r.vdi && r.vde > r.vdi) w.push('exhaust valve larger than intake');
    if (r.rod && r.stroke && (r.rod / r.stroke < 1.35 || r.rod / r.stroke > 2.2)) w.push('rod/stroke ' + (r.rod / r.stroke).toFixed(2));
    if (r.cr && (r.cr < 7 || r.cr > 15)) w.push('compression ' + r.cr);
    r.flags = w; if (w.length) bad.push(r); }
  const missing = bad.filter(r => r.flags.length === 1 && /no bore/.test(r.flags[0]));
  const real = bad.filter(r => !(r.flags.length === 1 && /no bore/.test(r.flags[0])));
  console.log(rows.length + ' presets, ' + rows.filter(r => r.four).length + ' four-stroke; ' + missing.length + ' without bore or stroke; ' + real.length + ' with a disagreement:');
  for (const r of real) console.log('  ' + r.name.slice(0, 70) + ': ' + r.flags.join('; '));
  fs.writeFileSync(path.join(__dirname, 'results', 'preset_geometry.json'), JSON.stringify({ rows, flagged: real.map(r => ({ name: r.name, flags: r.flags })), noBore: missing.map(r => r.name) }, null, 1));
  await b.close();
})();
