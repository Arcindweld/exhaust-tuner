// The trapped charge at intake closing taken apart (docs/WAVE_VALIDATION_2026-11-11.md part 13, M sections):
// tools/validation/wave/ivc_audit.js on the K24A2 + PT5862 18 psi job at 5050 RPM and the same engine without boost.
// Checks the instrumentation's identities, not the engine's numbers:
//   1. the IVC state the audit records is the model's own (cy.ivcP, cy.ivcT) to rounding
//   2. the pressure budget: p_ivc / p_src = (V_bdc / V_ivc)^gamma x (m / m_ref) x (T* / T_src) x (R / R_src), exactly
//   3. the enthalpy budget from IVO to IVC closes on the model's own energy equation (H = U + p V) to 1e-9 K
//   4. the trapped mass split (air + fuel + residual) is the trapped mass
//   5. the page's knock text no longer puts the boosted pessimism on a hot or high-pressure trapped charge, and cites part 13
// Node, about 10 s.   node web/tests/ivc_ui.js
'use strict';
const fs = require('fs'), path = require('path');
const A = require(path.join(__dirname, '..', '..', 'tools', 'validation', 'wave', 'ivc_audit.js'));
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
for (const c of ['b18', 'na']) {
  const o = A.run(c, 5050), P = o.pBudget, s = o.split;
  ok(Math.abs(o.ivc.p / o.modelIvc.p - 1) < 1e-12 && Math.abs(o.ivc.T - o.modelIvc.T) < 1e-9, c + ' 1: the recorded IVC state is the model\'s (' + (o.ivc.p / 1e5).toFixed(4) + ' bar, ' + o.ivc.T.toFixed(2) + ' K)');
  ok(Math.abs(P.product / P.pRatio - 1) < 1e-12, c + ' 2: pressure budget ' + P.compression.toFixed(4) + ' x ' + P.mass.toFixed(4) + ' x ' + P.temp.toFixed(4) + ' x ' + P.R.toFixed(4) + ' = ' + P.pRatio.toFixed(4));
  ok(Math.abs(o.closeErr) < 1e-9 && Math.abs(o.tBudgetSum - o.dT) < 1e-9, c + ' 3: enthalpy budget closes (' + o.dT.toFixed(2) + ' K, closure ' + o.closeErr.toExponential(1) + ' K)');
  ok(Math.abs((s.air + s.fuel + s.residual) / o.split0 - 1) < 1e-12, c + ' 4: air + fuel + residual = the trapped mass');
}
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
ok(h.indexOf('its charge at intake closing is hot') < 0 && h.indexOf('cylinder pressure runs high (it breathes') < 0, '5a: the old attribution is gone');
ok((h.match(/validation part 13/g) || []).length >= 2, '5b: the knock text cites part 13');
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
