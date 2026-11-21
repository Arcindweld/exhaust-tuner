// order 1.5 insertion loss over speed with the 45 Hz can at x (resonator_temp.js's layout): node notch_sweep.js pIn cycles x
const R = require('./resonator_temp.js');
const pIn = +(process.argv[2] || 35000), cycles = +(process.argv[3] || 8), x = +(process.argv[4] || 0.3), out = [];
for (let rpm = 1440; rpm <= 2240; rpm += 80) { const o = { rpm, pIn, cycles, ks: [1.5] }, b = R.run(null, o), r = R.run(x, o);
  out.push({ f: rpm / 40, il: 20 * Math.log10(b.lev[0] / r.lev[0]), T: r.ch.T }); console.log((rpm / 40).toFixed(1) + ' Hz: IL ' + out[out.length - 1].il.toFixed(1) + ' dB, can ' + r.ch.T.toFixed(0) + ' K'); }
const best = out.reduce((a, q) => q.il > a.il ? q : a); console.log('peak IL ' + best.il.toFixed(1) + ' dB at ' + best.f.toFixed(1) + ' Hz');
