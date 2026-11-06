// The page's own wave model (the Sound tab's estimate, no load) on the Outback's OpenWAM spec, against the owner's
// recording and against OpenWAM: order levels 2 to 12 relative to the strongest, at the four no-load holds. The spec's
// tail (cat as plain pipe, the 2 in mid pipe, the 2.5 in section, the Spintech case as a 7.24 L volume, the tailpipe)
// goes onto the collector as segments; the case is a straight 167 mm bore 330 mm long (13 in, the case's length, and
// its volume), as the page's line does for a can. The intake mouth's pressure is found by wsndSpeedRun, not taken from
// OpenWAM's calibration.   node validation/outback-2004/wave_noload.js   (from the repository root; writes wave_noload.json)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const HERE = __dirname, ROOT = path.resolve(HERE, '..', '..');
const rec = JSON.parse(fs.readFileSync(path.join(HERE, 'recording_orders.json'), 'utf8'));
const res = JSON.parse(fs.readFileSync(path.join(HERE, 'model', 'results.json'), 'utf8'));
const HOLDS = [['hold_1980', 1980, 'full_hold_2000'], ['hold_2585', 2585, 'full_hold_2600'], ['hold_2955', 2955, 'full_hold_2950'], ['hold_3550', 3550, 'full_hold_3500']];
(async () => {
  const specFile = path.join(HERE, 'model', 'runs', 'hold_2585', 'spec.json');
  if (!fs.existsSync(specFile)) { console.log('skipped: no OpenWAM spec at ' + specFile + ' (run model/outback04.py first)'); process.exit(0); }
  const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));
  const c = spec.opt.collectors[0];
  for (const t of c.tail) {
    if (t.V_litres) { const L = 13 * 0.0254, d = Math.sqrt(4 * t.V_litres / 1000 / L / Math.PI); c.segs.push({ L, d0: d, d1: d }); }
    else c.segs.push({ L: t.L_mm / 1000, d0: t.d0_mm / 1000, d1: t.d1_mm / 1000 });
  }
  delete c.tail; delete spec.intake.reservoir;
  const b = await chromium.launch(); const pg = await (await b.newContext()).newPage();
  await pg.goto('file://' + path.join(ROOT, 'web', 'index.html')); await pg.waitForTimeout(800);
  const out = [];
  for (const [name, rpm, rk] of HOLDS) {
    const r = await pg.evaluate(([spec, rpm]) => {
      const X = window.__wsnd, eng = X.WS.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt);
      const o = X.wsndSpeedRun(X.WS, eng, rpm, { dx: 0.02, load: 'none' }, null), A = X.wsndAvg(o.y.rec), z = X.wamInsOrders(A.outs[0], 24, [], rpm);
      const top = Math.max(...z.db); return { pIn: o.pIn, imep: o.y.imep, rel: z.db.map(v => v - top) };
    }, [spec, rpm]);
    const R = rec[rk].orders_dB_rel, W = res.cases.find(x => x.name === name).compare;
    const ords = W.orders.filter((o, i) => W.compared[i]);
    const dm = ords.map(o => r.rel[Math.round(o * 2) - 1] - R[o.toFixed(1)]), dw = ords.map(o => W.model_dB_rel[W.orders.indexOf(o)] - R[o.toFixed(1)]);
    const rms = d => { const m = d.reduce((a, v) => a + v, 0) / d.length; return { off: m, rms: Math.sqrt(d.reduce((a, v) => a + (v - m) ** 2, 0) / d.length) }; };
    const lo = ords.filter(o => o <= 6), dml = lo.map(o => r.rel[Math.round(o * 2) - 1] - R[o.toFixed(1)]), dwl = lo.map(o => W.model_dB_rel[W.orders.indexOf(o)] - R[o.toFixed(1)]);
    const row = { name, rpm, pMap_kPa: +(r.pIn / 1000).toFixed(1), imep_bar: +(r.imep / 1e5).toFixed(3), wave: rms(dm), openwam: rms(dw), wave_2to6: rms(dml), openwam_2to6: rms(dwl),
      orders: ords, wave_rel: ords.map(o => +r.rel[Math.round(o * 2) - 1].toFixed(1)), rec_rel: ords.map(o => R[o.toFixed(1)]) };
    out.push(row);
    console.log(name + ': manifold ' + row.pMap_kPa + ' kPa; RMS against the recording (orders 2-12, offset out): wave ' + row.wave.rms.toFixed(1) + ' dB, OpenWAM ' + row.openwam.rms.toFixed(1) + ' dB; orders 2-6: wave ' + row.wave_2to6.rms.toFixed(1) + ', OpenWAM ' + row.openwam_2to6.rms.toFixed(1));
  }
  fs.writeFileSync(path.join(HERE, 'wave_noload.json'), JSON.stringify({ note: 'page wave model, no load, on the OpenWAM spec; see wave_noload.js', cases: out }, null, 1));
  await b.close();
})();
