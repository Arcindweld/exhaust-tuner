// Part 7 (docs/WAVE_VALIDATION_2026-11-11.md, G sections): does the head's exhaust-port heat loss move the turbocharged
// K24A2 + PT5862 case of parts 5-6 towards plausible turbine efficiencies? The page's own plan (results/turbo_k24_page.json)
// has no port (the Turbo manifold section starts at the head flange and the 4-Stroke tab's port length was blank); here a
// port is put in front of each runner at the runner's bore: an ASSUMED length (the K24's exhaust port length is not
// sourced), with the port law off (Reynolds' analogy at the manifold's 794 C wall, as any pipe before part 7) and on
// (Caton-Heywood; Hires-Pochmara as the upper bound of the published correlations). For each: the closure of part 5 (the
// turbine's effective area for full boost at 3500 rpm with the gate shut at 75 %, then 6600 rpm with that area) and the
// calibration of part 6 (the area that gives a measured mean static pre-turbine pressure of 1.0 / 1.5 / 2.0 x boost at
// 3500 rpm, and the efficiency that then balances the compressor), with the page's WebAssembly and turboSimLib.
//   node tools/validation/wave/turbo_port.js [portL=0.1]      (about 4 minutes)      -> results/turbo_port.json
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
  const d = s.exhaust.segs[0].d0; s.exhaust.segs.unshift({ L, d0: d, d1: d, primary: true, port: true }); s.e.portHeat = law; return s; };
const cases = [['as the page (no port)', null], [L * 1000 + ' mm port, law off (Reynolds analogy at the manifold wall)', 'off'], [L * 1000 + ' mm port, Caton-Heywood', 'caton'], [L * 1000 + ' mm port, Hires-Pochmara (upper bound)', 'hires']];
const out = { portL: L, plan: { boost_kPa: (P.Pt - PATM) / 1000, eta: P.eta }, cases: [] }, t0 = Date.now();
for (const [label, law] of cases) {
  const spec = withPort(law), o = { label, law, closure: null, calib: [] };
  { const B = TL.rustBackend(spec, P.dx);
    try { const rows = TL.closure(B, { rpms: [3500, 6600], wc: mm => mm * P.wcPer, A0: P.A0, At: null, Ag: null });
      o.closure = rows.map(w => { const t = w.res.turb; return { rpm: w.rpm, At_mm2: w.At * 1e6, Ag_mm2: w.Ag * 1e6, p3k: gx(t.p3), p3sk: gx(t.p3s), p3pkk: gx(t.p3pk), T3_C: t.T3 - 273.15, T4_C: t.T4 - 273.15, W_kW: t.W / 1000, share: t.mg / (t.mt + t.mg) }; }); }
    finally { B.drop(); } }
  for (const K of [1.0, 1.5, 2.0]) {
    const c = TL.calibrate(sp => TL.rustBackend(sp, P.dx), spec, { rpm: 3500, p3: PATM + K * (P.Pt - PATM), wc: mm => mm * P.wcPer, A0: P.A0, eta: P.eta });
    try { const t = c.res.turb; o.calib.push({ K, At_mm2: c.At * 1e6, eta: c.eta, p3s_kPa: t.p3s / 1000, T3_C: t.T3 - 273.15, ok: c.ok, over: c.over, it: c.it }); } finally { c.B.drop(); }
  }
  out.cases.push(o);
  const a = o.closure[0], b = o.closure[1];
  console.log(label + ': closure area ' + a.At_mm2.toFixed(0) + ' mm2, T3 ' + a.T3_C.toFixed(0) + ' C, p3 mean ' + a.p3k.toFixed(2) + ' x boost at 3500; at 6600 p3 ' + b.p3k.toFixed(2) + ' x (static ' + b.p3sk.toFixed(2) + '), T3 ' + b.T3_C.toFixed(0) + ' C, gate ' + (100 * b.share).toFixed(1) +
    ' %; calibration eta at 1.0 / 1.5 / 2.0 x: ' + o.calib.map(c => c.eta.toFixed(3) + (c.ok ? '' : '?')).join(' / ') + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + ' s)');
}
fs.writeFileSync(path.join(__dirname, 'results', 'turbo_port.json'), JSON.stringify(out, null, 1));
