// Part 8 (docs/WAVE_VALIDATION_2026-11-11.md, H sections): the turbocharged K24A2 + PT5862 case of parts 5-7 with the head's
// INTAKE port law. The page's own plan (results/turbo_k24_page.json) has no intake port marked (the 4-Stroke tab's intake
// port length was blank), so the page's case is unchanged by part 8; here the runner's last portL before the valve is
// marked as the port at the runner's bore (an ASSUMED length: the K24's intake port length is not sourced), with the law
// off (the runs before) and on (Depcik-Assanis, the default; Shayler et al., the largest of the three). For each: the closure of part 5 (the
// turbine's effective area for full boost at 3500 rpm with the gate shut at 75 %, then 6600 rpm with that area) and the
// calibration of part 6 (the area that gives a measured mean static pre-turbine pressure of 1.0 / 1.5 / 2.0 x boost at
// 3500 rpm, and the efficiency that then balances the compressor), with the page's WebAssembly and turboSimLib.
//   node tools/validation/wave/turbo_portin.js [portL=0.1]      (about 4 minutes)      -> results/turbo_portin.json
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const cut = (a, b) => { const i = html.indexOf(a), j = html.indexOf(b, i); if (i < 0 || j < 0) throw new Error('not found: ' + a); return html.slice(i, j); };
const WS = new Function(cut('function wsFactory(){', '\nconst WS=wsFactory();') + '\nreturn wsFactory();')();
const m = html.match(/const WAVE_WASM_B64='([A-Za-z0-9+/=]+)'/);
const X = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(m[1], 'base64')), { m: { pow: Math.pow, sin: Math.sin, cos: Math.cos, exp: Math.exp } }).exports;
const TL = new Function('WS', 'X', cut('function turboSimLib(WS,X){', '// the worker\'s Rust path') + '\nreturn turboSimLib(WS,X);')(WS, X);
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const cap = JSON.parse(fs.readFileSync(path.join(__dirname, 'results', 'turbo_k24_page.json'), 'utf8'));
const P = cap.plan, PATM = 101325, L = +(args.portL || 0.1), gx = x => (x - PATM) / (P.Pt - PATM);
const withPort = (law) => { const s = JSON.parse(JSON.stringify(P.spec)); if (law === null) return s;
  const g = s.intake.segs, z = g[g.length - 1]; if (!(z.L > L && Math.abs(z.d0 - z.d1) < 1e-12)) throw new Error('the runner\'s last segment must be straight and longer than the port');
  g.splice(g.length - 1, 1, Object.assign({}, z, { L: z.L - L }), { L, d0: z.d1, d1: z.d1, port: true }); s.e.portInHeat = law; return s; };
const cases = [['as the page (no intake port)', null], [L * 1000 + ' mm intake port, law off (the runs before part 8)', 'off'], [L * 1000 + ' mm intake port, Depcik-Assanis (default)', 'depcik'], [L * 1000 + ' mm intake port, Shayler et al.', 'shayler']];
const out = { portL: L, plan: { boost_kPa: (P.Pt - PATM) / 1000, eta: P.eta }, cases: [] }, t0 = Date.now();
for (const [label, law] of cases) {
  const spec = withPort(law), o = { label, law, closure: null, calib: [] };
  { const B = TL.rustBackend(spec, P.dx);
    try { const rows = TL.closure(B, { rpms: [3500, 6600], wc: mm => mm * P.wcPer, A0: P.A0, At: null, Ag: null });
      o.closure = rows.map(w => { const t = w.res.turb; return { rpm: w.rpm, At_mm2: w.At * 1e6, Ag_mm2: w.Ag * 1e6, p3k: gx(t.p3), p3sk: gx(t.p3s), p3pkk: gx(t.p3pk), T3_C: t.T3 - 273.15, T4_C: t.T4 - 273.15, W_kW: t.W / 1000, share: t.mg / (t.mt + t.mg), ve: w.res.ve, imep: w.res.imep, mAir_gs: t.mAir * 1000 }; }); }
    finally { B.drop(); } }
  for (const K of [1.0, 1.5, 2.0]) {
    const c = TL.calibrate(sp => TL.rustBackend(sp, P.dx), spec, { rpm: 3500, p3: PATM + K * (P.Pt - PATM), wc: mm => mm * P.wcPer, A0: P.A0, eta: P.eta });
    try { const t = c.res.turb; o.calib.push({ K, At_mm2: c.At * 1e6, eta: c.eta, p3s_kPa: t.p3s / 1000, T3_C: t.T3 - 273.15, ok: c.ok, over: c.over, it: c.it }); } finally { c.B.drop(); }
  }
  out.cases.push(o);
  const a = o.closure[0], b = o.closure[1];
  console.log(label + ': VE ' + a.ve.toFixed(4) + ' / ' + b.ve.toFixed(4) + ', NMEP ' + (a.imep / 1e5).toFixed(2) + ' / ' + (b.imep / 1e5).toFixed(2) + ' bar, air ' + a.mAir_gs.toFixed(1) + ' / ' + b.mAir_gs.toFixed(1) + ' g/s (simulated cylinders); closure area ' + a.At_mm2.toFixed(0) + ' mm2, T3 ' + a.T3_C.toFixed(0) + ' C, p3 mean ' + a.p3k.toFixed(2) + ' x boost at 3500; at 6600 p3 ' + b.p3k.toFixed(2) + ' x (static ' + b.p3sk.toFixed(2) + '), T3 ' + b.T3_C.toFixed(0) + ' C, gate ' + (100 * b.share).toFixed(1) +
    ' %; calibration eta at 1.0 / 1.5 / 2.0 x: ' + o.calib.map(c => c.eta.toFixed(3) + (c.ok ? '' : '?')).join(' / ') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
}
fs.writeFileSync(path.join(__dirname, 'results', 'turbo_portin.json'), JSON.stringify(out, null, 1));
