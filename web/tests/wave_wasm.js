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
const KEYS = ['ve', 'imep', 'pmax', 'resid', 'pEvo', 'tEx', 'overlapPort', 'gimep'];   // gimep (the gross loop): 2026-11-12, part 2
const KEYS7 = KEYS.slice(0, 7);   // what fixtures/wave_const_ref.json holds
function wStep(id, rpm, first, o) {
  const n = X.wave_step(id, rpm, first ? 1 : 0, o.dx, o.cycles, o.firstCycles, o.maxExtra, NaN);
  if (!n) throw new Error(new TextDecoder().decode(new Uint8Array(X.memory.buffer, X.wave_error(), X.wave_error_len())));
  const v = new Float64Array(X.memory.buffer, X.wave_out(), n), r = { rpm };
  KEYS.forEach((k, i) => { r[k] = v[i]; });
  r.perCyl = []; for (let i = KEYS.length; i + 1 < n; i += 2) r.perCyl.push({ ve: v[i], imep: v[i + 1] });
  // the turbine's and the boosted intake's summary (2026-11-13; empty for an engine with neither)
  r.turbo = X.wave_turbo_len ? Array.from(new Float64Array(X.memory.buffer, X.wave_turbo_out(), X.wave_turbo_len())) : [];
  return r;
}
const jobs = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wave_jobs.json'), 'utf8'));
// the JavaScript's turbine summary in the WebAssembly's flat order (turb_sum)
const tflat = t => t ? [t.t, t.W, t.Wis, t.mt, t.mg, t.mAir, t.p3, t.p3pk, t.p3s, t.p4, t.T3, t.T4, t.rev, t.mAtm, t.eAtm, t.nE].concat(...t.p3bins, t.mdBins) : [];
// diameter steps on both lines (docs/WAVE_VALIDATION_2026-11-11.md: the two-pipe junction's contraction and expansion
// laws and their fallback), which the page's captured jobs do not have: a stepped intake runner and a single cylinder's
// pipe through a 127 mm chamber
{ const e = jobs[0].job.variants[0].spec.e;
  jobs.push({ name: 'diameter steps', job: { dx: 0.01, rpms: [3000, 5000, 7000, 9000], variants: [{ label: 'chamber and stepped runner', spec: { e,
    intake: { segs: [{ L: 0.15, d0: 0.06, d1: 0.06 }, { L: 0.15, d0: 0.045, d1: 0.045 }], Tw: 320 },
    exhaust: { segs: [{ L: 0.5, d0: 0.0445, d1: 0.0445 }, { L: 0.3, d0: 0.127, d1: 0.127 }, { L: 0.6, d0: 0.0445, d1: 0.0445 }], Tw: 700, chambers: [] },
    opt: { phases: [0] } } }] } });
  // the heat release's lean branch (no CO or H2 in the products) and an explicit combustion efficiency (spec.e.etaC)
  jobs.push({ name: 'lean, etaC', job: { dx: 0.01, rpms: [4000, 6000, 8000], variants: [{ label: 'AFR 15.5, etaC 0.9', spec: Object.assign({}, jobs[0].job.variants[0].spec,
    { e: Object.assign({}, e, { afr: 15.5, etaC: 0.9 }) }) }] } });
  // part 1's fresh charge of air alone (spec.e.fuel 'air'; the captured jobs run the default, fuel vapour from the port
  // injector), on the four-cylinder collector
  const s1 = jobs[1].job.variants[0].spec;
  jobs.push({ name: 'air alone', job: { dx: jobs[1].job.dx, rpms: [3000, 5000, 7000], variants: [{ label: 'spec.e.fuel air, four on one collector', spec: Object.assign({}, s1,
    { e: Object.assign({}, s1.e, { fuel: 'air' }) }) }] } });
  // 2026-11-12 part 3: measured valve flow tables (e.flowIn / e.flowEx) and the intake plenum with its throttle orifice,
  // a stepped inlet tube and the air filter orifice, on the four-cylinder collector; the plenum with neither orifice (open
  // inlet mouth, inlet ending open on the plenum) with the constant gas
  const tab = (d, k) => ({ lift: [0.0013, 0.0025, 0.005, 0.0076, 0.0102, 0.0127], cdA: [0.7, 0.7, 0.75, 0.72, 0.66, 0.6].map((c, i) => c * k * Math.PI * d * [0.0013, 0.0025, 0.005, 0.0076, 0.0102, 0.0127][i]) });
  const pl = { V_m3: 0.002, inlet: [{ L: 0.4, d0: 0.08, d1: 0.08 }, { L: 0.05, d0: 0.06, d1: 0.06 }], throttle: { d: 0.06, cd: 0.83 }, filter: { dp: 1500, m: 0.15 } };
  jobs.push({ name: 'plenum and bench flow', job: { dx: jobs[1].job.dx, rpms: [3000, 5000, 7000], variants: [{ label: 'flow tables, plenum, throttle, filter, four on one collector', spec: Object.assign({}, s1,
    { e: Object.assign({}, s1.e, { flowIn: tab(s1.e.dIn, 1), flowEx: tab(s1.e.dEx, 0.9) }), intake: Object.assign({}, s1.intake, { plenum: pl }) }) }] } });
  jobs.push({ name: 'plenum, constant gas', job: { dx: jobs[1].job.dx, rpms: [3000, 6000], variants: [{ label: 'open inlet, no throttle step, spec.e.gas const', spec: Object.assign({}, s1,
    { e: Object.assign({}, s1.e, { gas: 'const' }), intake: Object.assign({}, s1.intake, { plenum: { V_m3: 0.003, inlet: [{ L: 0.5, d0: 0.07, d1: 0.07 }] } }) }) }] } });
  // 2026-11-13: the turbocharged engine (intake.source, exhaust.turbine, exhaust.pOut), the four-cylinder collector: the
  // turbine with its gate into the downpipe (areas changed between speeds, as the closure does), a divided housing with an
  // external gate, the boosted charge alone with a tail back pressure, the plenum under boost with the constant gas
  const down = { segs: [{ L: 0.3, d0: 0.0762, d1: 0.0762 }, { L: 0.3, d0: 0.07, d1: 0.07 }], Tw: 700 }, col = s1.opt.collector;
  const tur = (o) => Object.assign({ CdA: 1.1e-3, eta: 0.7, wgCdA: 2e-4, down, pOut: 112000 }, o);
  jobs.push({ name: 'turbo', job: { dx: jobs[1].job.dx, rpms: [3000, 4500, 6000, 7500], areas: [[1.1e-3, 0], [1.1e-3, 2e-4], [-1, 4e-4], [9e-4, 3e-4]], variants: [{ label: 'turbine and gate into the downpipe, 190 kPa / 320 K charge', spec: Object.assign({}, s1,
    { intake: Object.assign({}, s1.intake, { source: { p: 190000, T: 320 } }), exhaust: Object.assign({}, s1.exhaust, { turbine: tur({}) }) }) }] } });
  jobs.push({ name: 'turbo, divided', job: { dx: jobs[1].job.dx, rpms: [3500, 6000, 8000], variants: [{ label: 'two entries (1-4, 2-3), gate to the air', spec: Object.assign({}, s1,
    { intake: Object.assign({}, s1.intake, { source: { p: 210000, T: 330 } }), exhaust: Object.assign({}, s1.exhaust, { turbine: tur({ wgTo: 'atm', wgCdA: 3e-4 }) }),
      opt: { phases: s1.opt.phases, collectors: [{ cyls: [0, 3], segs: col.segs.slice(0, 2), Tw: 650 }, { cyls: [1, 2], segs: col.segs.slice(0, 2), Tw: 650 }] } }) }] } });
  jobs.push({ name: 'boost only', job: { dx: jobs[1].job.dx, rpms: [3000, 6000], variants: [{ label: 'supercharged charge 160 kPa / 340 K, tail at 108 kPa', spec: Object.assign({}, s1,
    { intake: Object.assign({}, s1.intake, { source: { p: 160000, T: 340 } }), exhaust: Object.assign({}, s1.exhaust, { pOut: 108000 }) }) }] } });
  jobs.push({ name: 'turbo, plenum, constant gas', job: { dx: jobs[1].job.dx, rpms: [4000, 7000], variants: [{ label: 'plenum and throttle under boost, spec.e.gas const', spec: Object.assign({}, s1,
    { e: Object.assign({}, s1.e, { gas: 'const' }), intake: Object.assign({}, s1.intake, { source: { p: 180000, T: 315 }, plenum: { V_m3: 0.002, inlet: [{ L: 0.4, d0: 0.07, d1: 0.07 }, { L: 0.05, d0: 0.06, d1: 0.06 }], throttle: { d: 0.06, cd: 0.83 } } }),
      exhaust: Object.assign({}, s1.exhaust, { turbine: tur({ CdA: 1.2e-3 }) }) }) }] } });
  // 2026-11-13 part 7: the head's exhaust port (segments marked port: true; the port law, e.portHeat): a 110 mm port of
  // 40 mm ahead of the four-cylinder collector's primaries (its own pipe), the default law; the single cylinder with a port
  // at the primary's own bore (inside one pipe), Meisner and Sorenson's law at a 480 K wall; the constant gas with the port
  const sp = s1.exhaust.segs, s0 = jobs[0].job.variants[0].spec, sp0 = s0.exhaust.segs;
  jobs.push({ name: 'exhaust port', job: { dx: jobs[1].job.dx, rpms: [3000, 5000, 7000], variants: [
    { label: '110 mm port of 40 mm, four on one collector, Caton-Heywood', spec: Object.assign({}, s1, { exhaust: Object.assign({}, s1.exhaust, { segs: [{ L: 0.11, d0: 0.04, d1: 0.04, port: true }].concat(sp) }) }) },
    { label: 'the same, constant gas', spec: Object.assign({}, s1, { e: Object.assign({}, s1.e, { gas: 'const' }), exhaust: Object.assign({}, s1.exhaust, { segs: [{ L: 0.11, d0: 0.04, d1: 0.04, port: true }].concat(sp) }) }) }] } });
  jobs.push({ name: 'exhaust port, single', job: { dx: jobs[0].job.dx, rpms: [4000, 7000, 9000], variants: [
    { label: '120 mm port at the primary bore, Meisner-Sorenson, 480 K wall', spec: Object.assign({}, s0, { e: Object.assign({}, s0.e, { portHeat: 'meisner', portTw: 480 }),
      exhaust: Object.assign({}, s0.exhaust, { segs: [Object.assign({}, sp0[0], { L: 0.12, d1: sp0[0].d0, port: true })].concat(sp0) }) }) }] } }); }
let tJs = 0, tW = 0;
for (const { name, job } of jobs) {
  const rpms = process.env.QUICK === '1' ? job.rpms.slice(0, 3) : job.rpms;
  const o = { dx: job.dx, cycles: 3, firstCycles: 8, maxExtra: 5 };
  for (const v of job.variants) {
    let t = Date.now();
    const eng = WS.makeEngine(v.spec.e, v.spec.intake, v.spec.exhaust, v.spec.opt);
    // job.areas: the turbine's and the gate's areas set before each speed (WS.setTurbine, wave_turbo_set)
    const js = job.areas ? (() => { const out = []; let state = null; rpms.forEach((rpm, i) => { WS.setTurbine(eng, job.areas[i][0], job.areas[i][1]);
      let r = WS.runSpeed(eng, { rpm, cycles: i === 0 ? o.firstCycles : o.cycles, dx: o.dx, state }), k = 0;
      while (k < o.maxExtra) { const h = r.history, n = h.length; if (n >= 2 && Math.abs(h[n - 1].ve - h[n - 2].ve) < 0.004 * h[n - 1].ve) break; r = WS.runSpeed(eng, { rpm, cycles: 2, dx: o.dx, state: r.state }); k++; }
      state = r.state; out.push(r); }); return out; })() : WS.sweep(eng, rpms, o);
    tJs += Date.now() - t; t = Date.now();
    const id = wNew(v.spec), ws = rpms.map((rpm, i) => { if (job.areas && !X.wave_turbo_set(id, job.areas[i][0], job.areas[i][1])) throw new Error('wave_turbo_set'); return wStep(id, rpm, i === 0, o); }); X.wave_drop(id);
    tW += Date.now() - t;
    let bad = '';
    rpms.forEach((rpm, i) => {
      for (const k of KEYS) if (!Object.is(js[i][k], ws[i][k]) && !bad) bad = rpm + ' rpm ' + k + ': JS ' + js[i][k] + ', Rust ' + ws[i][k];
      if (!bad && js[i].perCyl.length !== ws[i].perCyl.length) bad = rpm + ' rpm: ' + js[i].perCyl.length + ' cylinders vs ' + ws[i].perCyl.length;
      js[i].perCyl.forEach((c, q) => { if (!bad && !(Object.is(c.ve, ws[i].perCyl[q].ve) && Object.is(c.imep, ws[i].perCyl[q].imep))) bad = rpm + ' rpm cylinder ' + (q + 1) + ': JS ' + c.imep + ', Rust ' + ws[i].perCyl[q].imep; });
      // the turbine and boosted-intake summary, every double (bins included)
      const tj = tflat(js[i].turb), tr = ws[i].turbo;
      if (!bad && tj.length !== tr.length) bad = rpm + ' rpm: turbine summary of ' + tj.length + ' values vs ' + tr.length;
      tj.forEach((x, q) => { if (!bad && !Object.is(x, tr[q])) bad = rpm + ' rpm turbine summary value ' + q + ': JS ' + x + ', Rust ' + tr[q]; });
    });
    ok(!bad, name + ', ' + v.label + ': ' + rpms.length + ' speeds the same to the last digit' + (bad ? ' (' + bad + ')' : '') +
      ' (VE ' + js.map(r => r.ve.toFixed(3)).slice(0, 4).join(' ') + ' ...' + (js[0].turb ? '; turbine summaries ' + tflat(js[0].turb).length + ' values each, turbine ' + js.map(r => (r.turb.W / 1000).toFixed(1)).join(' ') + ' kW' : '') + ')');
  }
}
// the constant-gamma mode (spec.e.gas 'const', gamma 1.35 and R 287, the model before 2026-11-12) in Rust against the
// JavaScript's results of that model, kept in fixtures/wave_const_ref.json (tools/validation/wave/constref.js), bit for bit
{ const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'wave_const_ref.json'), 'utf8'));
  const specs = {}; for (const { name, job } of jobs) for (const v of job.variants) specs[name + '|' + v.label] = { spec: v.spec, dx: job.dx };
  for (const r of ref) {
    const j = specs[r.name + '|' + r.label], rpms = process.env.QUICK === '1' ? r.rpms.slice(0, 3) : r.rpms;
    const o = { dx: j.dx, cycles: 3, firstCycles: 8, maxExtra: 5 }, spec = Object.assign({}, j.spec, { e: Object.assign({}, j.spec.e, { gas: 'const' }) });
    const id = wNew(spec), ws = rpms.map((rpm, i) => wStep(id, rpm, i === 0, o)); X.wave_drop(id);
    let bad = '';
    rpms.forEach((rpm, i) => { for (const k of KEYS7) if (!bad && !Object.is(r.res[i][k], ws[i][k])) bad = rpm + ' rpm ' + k + ': reference ' + r.res[i][k] + ', Rust ' + ws[i][k];
      r.res[i].perCyl.forEach((c, q) => { if (!bad && !(Object.is(c[0], ws[i].perCyl[q].ve) && Object.is(c[1], ws[i].perCyl[q].imep))) bad = rpm + ' rpm cylinder ' + (q + 1); }); });
    ok(!bad, 'constant gamma: ' + r.name + ', ' + r.label + ': ' + rpms.length + ' speeds the same as the reference to the last digit' + (bad ? ' (' + bad + ')' : ''));
  } }
// a refused spec comes back as an error, not a crash
let msg = ''; try { wNew({ e: {}, intake: { segs: [] }, exhaust: { segs: [] }, opt: {} }); X.wave_step(1e6, 3000, 1, 0.01, 3, 8, 5, NaN); } catch (e) { msg = String(e.message); }
ok(/no usable length|at least one pipe|segs/.test(msg) || msg === '', 'a spec with no pipes is refused with a reason: ' + (msg || '(made, no pipes yet)'));
let msg2 = ''; try { const id = wNew({ e: {}, intake: { segs: [] }, exhaust: { segs: [] }, opt: {} }); wStep(id, 3000, true, { dx: 0.01, cycles: 3, firstCycles: 8, maxExtra: 5 }); } catch (e) { msg2 = String(e.message); }
ok(/at least one pipe/.test(msg2), 'running it says why: ' + msg2);
console.log('time: JavaScript ' + (tJs / 1000).toFixed(1) + ' s, Rust (WebAssembly) ' + (tW / 1000).toFixed(1) + ' s');
console.log(fails.length ? 'FAILS ' + fails.length : 'all passed');
process.exit(fails.length ? 1 : 0);
