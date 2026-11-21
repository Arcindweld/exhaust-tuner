// f100_orders.js - the page's wave model on the F-100 302's validation layout (validation/f100-302: long tubes, X-pipe 400 mm
// behind the collectors, chambered mufflers as front chamber, two side passages round a V baffle, rear chamber, 600 mm
// exits) at full throttle, its order levels at the microphone (both exits, the far one 1.8 m further, as the README) against
// the four roadside pulls (recording_orders.json), clipped RMS at -25 dB as the README scores it; and the same with the
// mufflers as round one ran a catalogue chambered muffler (one empty case of the same volume).
//   node tools/sound/f100_orders.js SPEC.json [--rpm 5800]      (SPEC: an OpenWAM spec.json of the F-100, read in place)
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..', '..'), rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'validation', 'f100-302', 'recording_orders.json'), 'utf8'));
const CASE_A = Math.PI / 4 * 0.178 ** 2;   // a Flowmaster 40-size case (9.75 x 4 in) as its equivalent bore, 178 mm
function build(spec, empty) {
  const s = JSON.parse(JSON.stringify(spec)); delete s.notes; const X = s.opt.crossover; delete s.opt.crossover; const pos = [];
  s.opt.collectors.forEach((c, ci) => { const L0 = c.segs.reduce((a, g) => a + g.L, 0); (c.tail || []).forEach(t => c.segs.push({ L: t.L_mm / 1000, d0: t.d0_mm / 1000, d1: t.d1_mm / 1000 })); delete c.tail;
    pos.push(c.segs.reduce((a, g) => a + g.L, 0)); const pieces = []; let x = pos[ci];
    const tl = X.tails[ci], vol = tl.filter(t => t.V_litres).reduce((a, t) => a + t.V_litres, 0);
    if (empty) { // round one: the muffler as one empty case of the chambers' and passages' volume
      let done = false; tl.forEach(t => { if (t.V_litres || t.parallel || (t.L_mm === 40)) { if (!done) { const V = vol / 1000 + 2 * Math.PI / 4 * 0.07 ** 2 * 0.28 + 2 * Math.PI / 4 * 0.0603 ** 2 * 0.04; c.segs.push({ L: V / CASE_A, d0: 0.178, d1: 0.178 }); x += V / CASE_A; done = true; } } else { c.segs.push({ L: t.L_mm / 1000, d0: t.d0_mm / 1000, d1: t.d1_mm / 1000 }); x += t.L_mm / 1000; } }); }
    else tl.forEach(t => { if (t.V_litres) { const L = t.V_litres / 1000 / CASE_A; c.segs.push({ L, d0: 0.178, d1: 0.178 }); x += L; }
      else if (t.parallel) { pieces.push({ x: x - pos[ci], paths: t.parallel.map(p => p.map(g => ({ L: g.L_mm / 1000, d0: g.d0_mm / 1000, d1: g.d1_mm / 1000 }))) }); }
      else { c.segs.push({ L: t.L_mm / 1000, d0: t.d0_mm / 1000, d1: t.d1_mm / 1000 }); x += t.L_mm / 1000; } });
    if (pieces.length) c.pieces = pieces.map(q => Object.assign({}, q, { x: q.x + pos[ci] })); });
  s.opt.crossover = { type: X.type === 'h' ? 'h' : 'x', pos: pos.map(p => p - 0.03), tube: { L: 0.1, d: 0.05 } };
  if (s.intake && s.intake.reservoir) delete s.intake.reservoir; return s; }
module.exports = { build };
if (require.main === module) (async () => {
  const spec = JSON.parse(fs.readFileSync(argv[0], 'utf8')), rpm = +opt('--rpm', 5800);
  const b = await chromium.launch(); const pg = await b.newPage(); pg.on('pageerror', e => console.error('page error', e.message));
  await pg.goto('file://' + path.join(ROOT, 'web', 'index.html') + '#sound'); await pg.waitForTimeout(900);
  const out = {};
  for (const [k, empty] of [['chambered', false], ['empty_case', true]]) {
    const s = build(spec, empty);
    out[k] = await pg.evaluate(([s, rpm]) => { const X = window.__wsnd, eng = X.WS.makeEngine(s.e, s.intake, s.exhaust, s.opt);
      const o = X.wsndSpeedRun(X.WS, eng, rpm, { dx: 0.02, load: 'wot' }, null), A = X.wsndAvg(o.y.rec);
      const more = A.outs.slice(1).map(q => ({ mdot: q.mdot, g: 1 / (1 + 1.8), dDeg: 1.8 / 343 * 6 * rpm }));   // the far exit 1.8 m further (README), mic 1 m from the near one
      const z = X.wamInsOrders(A.outs[0], 24, more, rpm), top = Math.max(...z.db); return { rel: z.db.map(v => +(v - top).toFixed(1)), imep: o.y.imep, exits: A.outs.length, per: A.spread }; }, [s, rpm]);
  }
  const ords = []; for (let k = 3; k <= 24; k++) ords.push(k / 2);   // orders 1.5-12 (the README's)
  const score = (m, R) => { const d = ords.map(o => Math.max(-25, m[o * 2 - 1]) - Math.max(-25, R[String(o)])), mu = d.reduce((a, v) => a + v, 0) / d.length; return Math.sqrt(d.reduce((a, v) => a + (v - mu) ** 2, 0) / d.length); };
  out.scores = {}; for (const k of ['chambered', 'empty_case']) out.scores[k] = Object.keys(rec).map(p => +score(out[k].rel, rec[p].orders_dB_rel).toFixed(1));
  out.rec_mean = ords.map(o => +(Object.values(rec).reduce((a, r) => a + r.orders_dB_rel[String(o)], 0) / 4).toFixed(1)); out.orders = ords;
  console.log(JSON.stringify(out)); await b.close();
})();
