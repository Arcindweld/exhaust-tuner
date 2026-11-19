// The engine presets as a work list for the bore-and-stroke sourcing round (docs/PRESET_DATA_2026-11-18.md).
// Every entry of the page's MOTORS and VEH arrays (each one source line of web/index.html), with what the engine picker
// shows (motorList: the 598 engine presets, standalone motors and one entry per distinct engine among the vehicles),
// grouped by engine family and ranked for the research.
//   node tools/validation/presets/export.js   ->  tools/validation/presets/worklist.json
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', '..', '..');
const PAGE = path.join(ROOT, 'web', 'index.html');
(async () => {
  const b = await chromium.launch(), pg = await b.newPage();
  await pg.goto('file://' + PAGE); await pg.waitForTimeout(500);
  const out = await pg.evaluate(() => {
    const { MOTORS, VEH, ENGLIB, motorList, vehCode, vehMaker } = window.__presets;
    const pick = (v, arr) => { const e = ENGLIB[v.eng] || {};
      return { arr, name: v.name, code: arr === 'MOTORS' ? v.code : vehCode(v), maker: arr === 'MOTORS' ? (v.maker || vehMaker(v)) : vehMaker(v),
        family: v.family || null, years: v.years || null, g: v.g, eng: v.eng, engName: e.name || null, cyc: e.cyc, cyl: (e.order || []).length,
        cc: v.cc, hp: v.hp, hpRpm: v.hpRpm, red: v.red || null, ind: v.ind, bore: v.bore || null, stroke: v.stroke || null, cr: v.cr || null,
        valves: v.valves || null, src: v.src || null, src2: v.src2 || null, note: v.note || null }; };
    const all = MOTORS.map(v => pick(v, 'MOTORS')).concat(VEH.map(v => pick(v, 'VEH')));
    const list = motorList().map(m => ({ name: m.name, from: m.fitted ? m.fitted : m.name, motor: !!m.motor, code: m.code, cc: m.cc, cyc: (ENGLIB[m.eng] || {}).cyc, bore: m.bore || null }));
    return { all, list };
  });
  await b.close();
  // the page's source line of each entry (apply.js edits by name; names must be unique within an array)
  const lines = fs.readFileSync(PAGE, 'utf8').split('\n');
  const where = {};
  lines.forEach((l, i) => { const m = l.match(/^\s*\{.*?name:'((?:[^'\\]|\\.)*)'/); if (m) (where[m[1].replace(/\\'/g, "'")] = where[m[1].replace(/\\'/g, "'")] || []).push(i + 1); });
  const pickerOf = {}; out.list.forEach(p => { pickerOf[p.from] = p.name; });
  const items = out.all.map(r => Object.assign(r, { lines: where[r.name] || [], picker: pickerOf[r.name] || null }));
  const four = out.list.filter(p => p.cyc === '4');
  const sum = { entries: items.length, picker: out.list.length, pickerFour: four.length, pickerFourWithBore: four.filter(p => p.bore).length,
    entriesWithBore: items.filter(r => r.bore).length, dupNames: items.filter(r => r.lines.length !== 1).map(r => r.name) };
  fs.writeFileSync(path.join(__dirname, 'worklist.json'), JSON.stringify({ made: new Date().toISOString().slice(0, 10), sum, items }, null, 1));
  console.log(JSON.stringify(sum));
})();
