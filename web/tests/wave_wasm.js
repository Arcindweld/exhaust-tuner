// The wave simulation in Rust (rust/et_wave, built to WebAssembly) against the page's JavaScript (wsFactory), on the
// jobs the page hands its workers (fixtures/wave_jobs.json, from capture_wave_jobs.js): every speed of every design,
// every result the page uses (VE, IMEP, peak pressure, residual, pressure at EVO, exhaust temperature, port pressure
// at overlap, each cylinder's VE and IMEP) must be the same double. Uses the WebAssembly embedded in the page; with
// WAVE_WASM=path, that file instead. QUICK=1 runs the first three speeds of each design only.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
const a = html.indexOf('function wsFactory(){'), z = html.indexOf('\nconst WS=wsFactory();');
const WS = new Function(html.slice(a, z) + '\nreturn wsFactory();')();
let bytes;
if (process.env.WAVE_WASM) bytes = fs.readFileSync(process.env.WAVE_WASM);
else {
  const m = html.match(/const WAVE_WASM_B64='([A-Za-z0-9+/=]+)'/);
  if (!m) { console.log('FAIL the page has no embedded wave model (WAVE_WASM_B64)'); process.exit(1); }
  bytes = Buffer.from(m[1], 'base64');
}
const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), { m: { pow: Math.pow, sin: Math.sin, cos: Math.cos, exp: Math.exp } });
const X = inst.exports;
const imports = WebAssembly.Module.imports(new WebAssembly.Module(bytes)).map(i => i.module + '.' + i.name).sort();
ok(JSON.stringify(imports) === JSON.stringify(['m.cos', 'm.exp', 'm.pow', 'm.sin']), 'the module imports only Math.pow, sin, cos and exp: ' + imports.join(' '));
const enc = new TextEncoder();
function wNew(spec) {
  const b = enc.encode(JSON.stringify(spec)), p = X.wave_alloc(b.length);
  new Uint8Array(X.memory.buffer, p, b.length).set(b);
  const id = X.wave_new(p, b.length); X.wave_free(p, b.length);
  if (!id) throw new Error(new TextDecoder().decode(new Uint8Array(X.memory.buffer, X.wave_error(), X.wave_error_len())));
  return id;
}
const KEYS = ['ve', 'imep', 'pmax', 'resid', 'pEvo', 'tEx', 'overlapPort'];
function wStep(id, rpm, first, o) {
  const n = X.wave_step(id, rpm, first ? 1 : 0, o.dx, o.cycles, o.firstCycles, o.maxExtra, NaN);
  if (!n) throw new Error(new TextDecoder().decode(new Uint8Array(X.memory.buffer, X.wave_error(), X.wave_error_len())));
  const v = new Float64Array(X.memory.buffer, X.wave_out(), n), r = { rpm };
  KEYS.forEach((k, i) => { r[k] = v[i]; });
  r.perCyl = []; for (let i = 7; i + 1 < n; i += 2) r.perCyl.push({ ve: v[i], imep: v[i + 1] });
  return r;
}
const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wave_jobs.json'), 'utf8'));
let tJs = 0, tW = 0;
for (const { name, job } of jobs) {
  const rpms = process.env.QUICK === '1' ? job.rpms.slice(0, 3) : job.rpms;
  const o = { dx: job.dx, cycles: 3, firstCycles: 8, maxExtra: 5 };
  for (const v of job.variants) {
    let t = Date.now();
    const eng = WS.makeEngine(v.spec.e, v.spec.intake, v.spec.exhaust, v.spec.opt);
    const js = WS.sweep(eng, rpms, o);
    tJs += Date.now() - t; t = Date.now();
    const id = wNew(v.spec), ws = rpms.map((rpm, i) => wStep(id, rpm, i === 0, o)); X.wave_drop(id);
    tW += Date.now() - t;
    let bad = '';
    rpms.forEach((rpm, i) => {
      for (const k of KEYS) if (!Object.is(js[i][k], ws[i][k]) && !bad) bad = rpm + ' rpm ' + k + ': JS ' + js[i][k] + ', Rust ' + ws[i][k];
      if (!bad && js[i].perCyl.length !== ws[i].perCyl.length) bad = rpm + ' rpm: ' + js[i].perCyl.length + ' cylinders vs ' + ws[i].perCyl.length;
      js[i].perCyl.forEach((c, q) => { if (!bad && !(Object.is(c.ve, ws[i].perCyl[q].ve) && Object.is(c.imep, ws[i].perCyl[q].imep))) bad = rpm + ' rpm cylinder ' + (q + 1) + ': JS ' + c.imep + ', Rust ' + ws[i].perCyl[q].imep; });
    });
    ok(!bad, name + ', ' + v.label + ': ' + rpms.length + ' speeds the same to the last digit' + (bad ? ' (' + bad + ')' : '') +
      ' (VE ' + js.map(r => r.ve.toFixed(3)).slice(0, 4).join(' ') + ' ...)');
  }
}
// a refused spec comes back as an error, not a crash
let msg = ''; try { wNew({ e: {}, intake: { segs: [] }, exhaust: { segs: [] }, opt: {} }); X.wave_step(1e6, 3000, 1, 0.01, 3, 8, 5, NaN); } catch (e) { msg = String(e.message); }
ok(/no usable length|at least one pipe|segs/.test(msg) || msg === '', 'a spec with no pipes is refused with a reason: ' + (msg || '(made, no pipes yet)'));
let msg2 = ''; try { const id = wNew({ e: {}, intake: { segs: [] }, exhaust: { segs: [] }, opt: {} }); wStep(id, 3000, true, { dx: 0.01, cycles: 3, firstCycles: 8, maxExtra: 5 }); } catch (e) { msg2 = String(e.message); }
ok(/at least one pipe/.test(msg2), 'running it says why: ' + msg2);
console.log('time: JavaScript ' + (tJs / 1000).toFixed(1) + ' s, Rust (WebAssembly) ' + (tW / 1000).toFixed(1) + ' s');
console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
process.exit(fails.length ? 1 : 0);
