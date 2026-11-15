// Shared by the knock scripts (docs/WAVE_VALIDATION_2026-11-11.md part 12): the page's wave model (lib.js) and its knockLib,
// and one speed run as the page's backends run it (firstCycles, then pairs until the VE of the last two agrees within
// 0.4 %), with cylinder 1's trace.
'use strict';
const fs = require('fs');
const { load, PAGE } = require('./lib');
const WS = load();
function knockSrc() { const h = fs.readFileSync(PAGE, 'utf8'), a = h.indexOf('function knockLib(WS){'), z = h.indexOf('\nfunction turboSimLib(WS,X){');
  if (a < 0 || z < 0) throw new Error('knockLib not found'); return h.slice(a, z); }
const KN = new Function('WS', knockSrc() + '\nreturn knockLib(WS);')(WS);
function runOne(spec, rpm, o) {
  o = o || {}; const eng = WS.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt);
  if (o.At != null) WS.setTurbine(eng, o.At, o.Ag == null ? -1 : o.Ag);
  const dx = o.dx || 0.01; let r = WS.runSpeed(eng, { rpm, cycles: o.firstCycles || 8, dx, trace: true }), k = 0;
  while (k < (o.extra == null ? 4 : o.extra)) { const h = r.history, n = h.length; if (n >= 2 && Math.abs(h[n - 1].ve - h[n - 2].ve) < 0.004 * h[n - 1].ve) break; r = WS.runSpeed(eng, { rpm, cycles: 2, dx, state: r.state, trace: true }); k++; }
  return { eng, r };
}
const withStart = (spec, start) => Object.assign({}, spec, { e: Object.assign({}, spec.e, { burn: Object.assign({}, spec.e.burn, { start }) }) });
module.exports = { WS, KN, runOne, withStart };
