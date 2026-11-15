// The tables of docs/WAVE_VALIDATION_2026-11-11.md part 13 (M sections) from ivc_audit.js's results.
//   node tools/validation/wave/ivc_report.js
'use strict';
const fs = require('fs'), path = require('path');
const R = t => JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'ivc_' + t + '.json'), 'utf8')).rows;
const f = (x, n) => x == null || !isFinite(x) ? '-' : x.toFixed(n), bar = x => f(x / 1e5, 3), g = x => f(1000 * x, 3);
const name = c => c === 'na' ? 'NA' : '18 psi';
const base = R('m_base');
console.log('\nM1 trapped state\n');
console.log('| case, rpm | source bar / K | BDC bar / K | IVC bar / K | p*, T* at the BDC volume | p_ivc / p_src = compression x mass x T* x R | air / fuel / residual (mg; residual %) | fresh delivered / short-circuited (mg) | trapping | port during inflow, static / total bar | overlap: exhaust port / cylinder / intake port bar | VE on the charge | knock I (ON 95) |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const o of base) { const P = o.pBudget, s = o.split, w = o.flows, m = o.means;
  console.log('| ' + name(o.case) + ' ' + o.rpm + ' | ' + bar(o.src.p) + ' / ' + f(o.src.T, 1) + ' | ' + bar(o.bdc.p) + ' / ' + f(o.bdc.T, 1) + ' | ' + bar(o.ivc.p) + ' / ' + f(o.ivc.T, 1) + ' | ' + bar(o.star.p) + ' / ' + f(o.star.T, 1) +
    ' | ' + f(P.pRatio, 3) + ' = ' + f(P.compression, 3) + ' x ' + f(P.mass, 3) + ' x ' + f(P.temp, 3) + ' x ' + f(P.R, 3) + ' | ' + f(1e6 * s.air, 1) + ' / ' + f(1e6 * s.fuel, 1) + ' / ' + f(1e6 * s.residual, 1) + ' (' + f(100 * s.residualFrac, 2) + ') | ' +
    f(1e6 * (w.freshIn - w.freshBack), 1) + ' / ' + f(1e6 * w.freshShort, 3) + ' | ' + f(w.trapping, 4) + ' | ' + bar(m.pPortIn) + ' / ' + bar(m.p0PortIn) + ' | ' + bar(m.pExOverlap) + ' / ' + bar(m.pCylOverlap) + ' / ' + bar(m.pPortOverlap) + ' | ' + f(o.veCharge, 3) + ' | ' + f(o.knock.I, 3) + ' |'); }
console.log('\nM2 temperature budget, IVO to IVC (K)\n');
const K = ['residualAtIvo', 'exOut', 'exIn', 'airIn', 'fuel', 'pushedBack', 'wall', 'VdpToBdc', 'VdpBdcIvc'];
console.log('| case, rpm | T_ivc - T_src | residual at IVO | gas out by the exhaust valve | gas back from the exhaust | air above the source (runner walls) | fuel vapour at 298 K | charge pushed back | cylinder wall | int V dp IVO-BDC (filling) | int V dp BDC-IVC | sum | closure |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const o of base) console.log('| ' + name(o.case) + ' ' + o.rpm + ' | ' + f(o.dT, 1) + ' | ' + K.map(k => f(o.tBudget[k], 1)).join(' | ') + ' | ' + f(o.tBudgetSum, 1) + ' | ' + o.closeErr.toExponential(0) + ' |');
console.log('\nM3 intake closing moved (opening held)\n');
console.log('| case, rpm | IVC deg ABDC (seat) | V_bdc / V_ivc | IVC bar / K | p*, T* | VE on the charge | knock I | brake hp |');
console.log('|---|---|---|---|---|---|---|---|');
for (const c of ['b18', 'na']) for (const rpm of [5050, 6600]) for (const t of ['m_ivc-20', 'm_ivc-10', 'm_base', 'm_ivc10', 'm_ivc20']) { const o = R(t).find(q => q.case === c && q.rpm === rpm);
  console.log('| ' + name(c) + ' ' + rpm + ' | ' + o.cam.ivcABDC + ' | ' + f(o.Vratio, 3) + ' | ' + bar(o.ivc.p) + ' / ' + f(o.ivc.T, 1) + ' | ' + bar(o.star.p) + ' / ' + f(o.star.T, 1) + ' | ' + f(o.veCharge, 3) + ' | ' + f(o.knock.I, 3) + ' | ' + f(o.hpPage, 1) + ' |'); }
console.log('\nM4 the pressure before the turbine calibrated (time-mean static p3 = K x boost, gauge, gate shut, at each speed)\n');
console.log('| rpm | p3 | p3 static / total x boost | turbine area mm2 (gate) | IVC bar / K | residual % | VE on the charge | brake hp (page basis) | pumping mep bar | knock I (ON 95) | end gas K at 90 % burned | peak bar |');
console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const rpm of [3500, 5050, 6600, 7100]) for (const [t, lab] of [['m_base', 'model'], ['m_p3x1.5', '1.5 x'], ['m_p3x2', '2 x']]) { const o = R(t).find(q => q.case === 'b18' && q.rpm === rpm);
  console.log('| ' + rpm + ' | ' + lab + ' | ' + f(o.turb.p3sx, 2) + ' / ' + f(o.turb.p3x, 2) + ' | ' + f(o.turb.At * 1e6, 0) + ' (' + f(o.turb.Ag * 1e6, 0) + ') | ' + bar(o.ivc.p) + ' / ' + f(o.ivc.T, 1) + ' | ' + f(100 * o.split.residualFrac, 2) + ' | ' + f(o.veCharge, 3) + ' | ' + f(o.hpPage, 1) + ' | ' + f((o.gimep - o.imep) / 1e5, 2) + ' | ' + f(o.knock.I, 3) + ' | ' + f(o.knock.TuEnd, 0) + ' | ' + f(o.knock.pMax / 1e5, 1) + ' |'); }
console.log('\nM5 runner length (one change; turbine and gate areas held)\n');
console.log('| case, rpm | runner mm (bore 38.3 mm unless stated) | p* / T* | mass / m_ref | VE on the charge | IVC bar / K | knock I | brake hp |');
console.log('|---|---|---|---|---|---|---|---|');
for (const c of ['b18', 'na']) for (const rpm of [5050, 6600]) for (const [t, L] of [['m_run0.15', '150'], ['m_base', '300'], ['m_run0.45', '450'], ['m_rund45', '300, bore 45 mm']]) { const o = R(t).find(q => q.case === c && q.rpm === rpm);
  console.log('| ' + name(c) + ' ' + rpm + ' | ' + L + ' | ' + bar(o.star.p) + ' / ' + f(o.star.T, 1) + ' | ' + f(o.pBudget.mass, 3) + ' | ' + f(o.veCharge, 3) + ' | ' + bar(o.ivc.p) + ' / ' + f(o.ivc.T, 1) + ' | ' + f(o.knock.I, 3) + ' | ' + f(o.hpPage, 1) + ' |'); }
console.log('\nM6 what the knock integral rests on (ON 95; the same trace, one thing changed)\n');
console.log('| case, rpm | I as run | trapped mass at Garrett\'s 97 % VE on the charge (pressures x 0.97 / VE) | every pressure halved | IVC charge without its heating at BDC volume (T_ivc - (T* - T_src)), pressure held |');
console.log('|---|---|---|---|---|');
for (const o of base) console.log('| ' + name(o.case) + ' ' + o.rpm + ' | ' + f(o.knock.I, 3) + ' | ' + f(o.knock.I_ve97, 3) + ' | ' + f(o.knock.I_halfP, 3) + ' | ' + f(o.knock.I_noHeat, 3) + ' (' + f(o.star.T - o.src.T, 1) + ' K less) |');
