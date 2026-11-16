// Shared by specparity_ui.js and tools/validation/wave/specparity_audit.js (docs/SPEC_PARITY_AUDIT_2026-11-16.md): the
// spec parity checks AT THE PAGE BOUNDARY. Not a test itself (tools/run_all_tests.py NOT_TESTS).
//
// Why: JS-vs-WASM parity used to be tested on specs already translated for the engine (wave_wasm.js feeds both engines
// the same object), so a field the page's translation for the WebAssembly (WS.rustSpec) dropped went unseen: the cam's
// check lift ran seat to seat in the browser from 2026-11-03 to 2026-11-15. Here the specs are the ones the page itself
// builds from its inputs (simPlan / simEntries for the 4-Stroke tab and the Headers layout, tsimPlan for the boosted
// run), and each is run the two ways the page runs it: the JavaScript model on a structured clone (what a worker's
// postMessage hands it) and the WebAssembly through the page's own rustBackend (JSON of WS.rustSpec(spec)).
//
//   rustReads(src)          the JSON paths rust/et_wave/src/lib.rs reads from the spec (static, from its ["key"] reads,
//                           each receiver resolved by RUST_RECV below; an unresolved one throws, so a new read in Rust
//                           has to be placed here before the test passes)
//   jsReadsSrc              in-page: the paths the JavaScript model reads during a run (a Proxy on the spec)
//   coverage(js, rust)      the JS-read paths the WASM does not read, less ALLOW (each with its reason)
//   PAGE_SRC                in-page helpers (window.__sp): apply inputs, collect the page's specs, run both ways
//   cases(seed, n)          the seeded fuzz of UI inputs; PRESET_CASES the stratified preset sample
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------------------------- the Rust side (static)
// receivers of ["key"] reads per Rust function: name -> JSON path; [name, regex] entries apply only on lines matching it
const RUST_RECV = {
  segs_of: { s: '$SEG' }, line_of: { v: '$LINE' }, flow_tab_of: { v: '$FLOW' },
  source_of: { intake: 'spec.intake', q: 'spec.intake.source' },
  turbine_of: { exhaust: 'spec.exhaust', t: 'spec.exhaust.turbine', d: 'spec.exhaust.turbine.down', b: 'spec.exhaust.turbine.bsr' },
  plenum_of: { intake: 'spec.intake', q: 'spec.intake.plenum', t: 'spec.intake.plenum.throttle', f: 'spec.intake.plenum.filter' },
  port_law: { e: 'spec.e' }, port_in_law: { e: 'spec.e' },
  make_engine: { spec: 'spec', e: 'spec.e', cam: 'spec.e.cam', o: 'spec.opt', intake: 'spec.intake', exhaust: 'spec.exhaust',
    s: 'spec.opt.collectors[].stages[]', c: [['spec.exhaust.chambers[]', /\[num\(&c\["x"\]\)/], ['spec.opt.collectors[]', /./]] }
};
// where the generic readers are called: the container whose elements (segs_of) or which line (line_of) they read
const RUST_CALLS = {
  $SEG: ['spec.exhaust.turbine.down.segs[]', 'spec.intake.plenum.inlet[]', 'spec.opt.collectors[].stages[].segs[]', 'spec.opt.collectors[].stages[].segs_by_group[][]',
    'spec.opt.collectors[].segs[]', 'spec.exhaust.per_cyl[][]'],
  $LINE: ['spec.opt.collector', 'spec.intake', 'spec.exhaust'],
  $FLOW: ['spec.e.flowIn', 'spec.e.flowEx']
};
function rustReads(src) {
  src = src || fs.readFileSync(path.join(ROOT, 'rust', 'et_wave', 'src', 'lib.rs'), 'utf8');
  const lines = src.split('\n'), reads = new Set(), gen = { $SEG: new Set(), $LINE: new Set(), $FLOW: new Set() }, unresolved = [];
  let fn = null;
  lines.forEach((ln, i) => {
    const m = /^\s*(?:pub )?(?:extern "C" )?fn ([a-z_0-9]+)/.exec(ln); if (m) fn = m[1];
    // a chain recv["a"]["b"]...
    const re = /([A-Za-z_][A-Za-z_0-9]*)((?:\["[A-Za-z_0-9]+"\])+)/g; let k;
    while ((k = re.exec(ln))) {
      const recv = k[1], keys = k[2].match(/"([A-Za-z_0-9]+)"/g).map(x => x.slice(1, -1));
      const tab = RUST_RECV[fn]; let base = tab && tab[recv];
      if (Array.isArray(base)) { const hit = base.find(([, r]) => r.test(ln)); base = hit ? hit[0] : null; }
      if (!base) { unresolved.push((i + 1) + ': ' + fn + ' ' + recv + k[2]); continue; }
      let p = base; for (const key of keys) { p += '.' + key; if (gen[base]) gen[base].add(p.slice(base.length)); else reads.add(p); }
    }
  });
  if (unresolved.length) throw new Error('rustReads: receivers not in RUST_RECV (place them there): ' + unresolved.join('; '));
  // the generic readers at their call sites; segs_of's elements of every line_of's segs too
  for (const L of RUST_CALLS.$LINE) for (const s of gen.$LINE) reads.add(L + s);
  const segC = RUST_CALLS.$SEG.concat(RUST_CALLS.$LINE.map(L => L + '.segs[]'));
  for (const c of segC) for (const s of gen.$SEG) reads.add(c + s);
  for (const c of RUST_CALLS.$FLOW) for (const s of gen.$FLOW) reads.add(c + s);
  // every prefix of a read path is read too (the containers)
  for (const p of [...reads]) { const parts = p.split('.'); for (let j = 2; j < parts.length; j++) reads.add(parts.slice(0, j).join('.').replace(/\[\]$/, '')); }
  for (const p of [...reads]) { if (/\[\]/.test(p)) reads.add(p.replace(/(\[\])+$/, '')); }
  return reads;
}

// ---------------------------------------------------------------------------------------------- coverage
// read by the JavaScript model and not by the WebAssembly, on purpose. Each entry: the path (a prefix: everything
// below it too) and why it may stay JavaScript-only. 'translated': WS.rustSpec turns it into fields the Rust reads;
// 'refused': WS.rustSpec throws on a spec that carries it, so every caller falls back to the JavaScript model (the
// sweep worker's catch, the turbo worker's rustBackend), never a silent drop.
const ALLOW = [
  ['spec.e.cam.checkLift_mm', 'translated: rustSpec hands the Rust camSeat\'s seat-to-seat events (the defect of 2026-11-03 to 2026-11-15)'],
  ['spec.opt.crossover', 'refused: an H or X crossover between two collectors (opt.crossover) is JavaScript-only (collectorNets); only the sound prediction builds it, and its worker runs the JavaScript'],
  ['spec.opt.collector.pieces', 'refused: in-line pieces (resonators, pockets, an auger) on the collector line: JavaScript-only (lineWithPieces); the sound prediction only'],
  ['spec.opt.collector.parallel', 'refused: as pieces'],
  ['spec.opt.collector.branches', 'refused: side branches (Helmholtz and quarter-wave): JavaScript-only; the sound prediction only'],
  ['spec.opt.collectors[].pieces', 'refused: as opt.collector.pieces'],
  ['spec.opt.collectors[].parallel', 'refused: as pieces'],
  ['spec.opt.collectors[].branches', 'refused: as opt.collector.branches'],
  ['spec.e.dead', 'refused: cylinders that do not fire (the sound prediction\'s misfire comparison) are JavaScript-only'],
];
const allowed = p => ALLOW.find(([a]) => p === a || p.startsWith(a + '.') || p.startsWith(a + '['));
function coverage(jsPaths, rust) {
  const miss = [], allow = [];
  for (const p of jsPaths) { if (rust.has(p)) continue; const a = allowed(p); if (a) allow.push([p, a[1]]); else miss.push(p); }
  return { miss: miss.sort(), allow };
}

// ---------------------------------------------------------------------------------------------- in-page helpers
// window.__sp: set(id, v) (input or change event as the element takes), preset(text prefix), collect() the page's specs,
// run(specs, rc) both ways, reads(specs, rc) the Proxy-recorded JS reads. Evaluated in the page once (installPage).
const PAGE_SRC = function () {
  const SP = {};
  SP.set = (id, v) => { const el = document.getElementById(id); if (!el) return false; el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return true; };
  SP.preset = txt => { SP.set('v-mode', 'eng'); const o = [...document.getElementById('v-pick').options].find(o => o.text.startsWith(txt)); if (!o) return false; SP.set('v-pick', o.value); return o.text; };
  SP.X = () => { if (SP._X) return SP._X; const s = atob(window.__b64()), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    SP._X = new WebAssembly.Instance(new WebAssembly.Module(b), { m: { pow: Math.pow, sin: Math.sin, cos: Math.cos, exp: Math.exp } }).exports; return SP._X; };
  SP.TL = () => SP._TL || (SP._TL = window.__tsim.lib()(window.__sim.WS, SP.X()));
  // the page's specs for its current inputs: the 4-Stroke tab's plan (its first design, the low profile's entry, one
  // cam-advance variant), the boosted plan's three (boosted, without boost, the boost with no turbine). Each with the speeds
  // the page would run first and last and, for a turbine, the plan's first-guess areas.
  SP.collect = (o) => {
    o = o || {}; const S = window.__sim, out = [], q = S.inp();
    const err = q ? S.simCheck(q) : 'no inputs';
    if (!err) {
      const plan = S.simPlan(q);
      if (plan.err) out.push({ tag: 'plan', err: plan.err });
      else {
        const rp = S.simRpms(q.tune), en = S.simEntries(plan.variants, rp);
        // the design as entered (both parts with two profiles), the first cam advance other than 0, the Headers layout's twin
        const pick = en.filter((v, i) => v.g === 0 || (/^vtc/.test(v.key) && v.key !== 'vtc0' && !en.slice(0, i).some(w => /^vtc/.test(w.key) && w.key !== 'vtc0')) || (plan.hdr && v.g === 1 && !v.part));
        for (const v of pick.slice(0, o.max || 4)) { const r = v.rpms || rp; out.push({ tag: (plan.hdr ? 'hdr:' : 'four:') + v.key + (v.part ? ':' + v.part : ''), spec: v.spec, rpms: [r[0], r[r.length - 1]], dx: plan.n > 1 ? 0.0125 : 0.01 }); }
      }
    } else out.push({ tag: 'four', err });
    const P = window.__tsim.plan();
    if (P && !P.err) {
      const t = P.spec.exhaust.turbine;
      out.push({ tag: 'tsim:' + (P.turbo ? 'turbo' : 'centri'), spec: P.spec, rpms: [P.rpms[0], P.rpms[P.rpms.length - 1]], dx: P.dx, turb: t ? [t.CdA, t.wgCdA > 0 ? t.wgCdA : 0.3 * t.CdA] : null, trace: !!(P.knock && P.knock.ON > 0) });
      out.push({ tag: 'tsim:na', spec: P.na, rpms: [P.rpms[0], P.rpms[P.rpms.length - 1]], dx: P.dx });
      if (P.sc) out.push({ tag: 'tsim:sc', spec: P.sc, rpms: [P.rpms[0]], dx: P.dx });
    } else if (P && P.err) out.push({ tag: 'tsim', err: P.err });
    return JSON.parse(JSON.stringify(out.map(c => Object.assign({}, c, { spec: c.spec ? structuredClone(c.spec) : undefined }))));
  };
  // one step's numbers, flat: the 8 results, each cylinder's VE and IMEP, the turbine summary, the trace (when on)
  SP.flat = r => [].concat([r.ve, r.imep, r.pmax, r.resid, r.pEvo, r.tEx, r.overlapPort, r.gimep], ...(r.perCyl || []).map(c => [c.ve, c.imep]),
    r.turb ? window.__tsim.lib()(window.__sim.WS, null).flat(r.turb) : [], r.trace || []);
  // run a collected case both ways (rc: {dx, cyc, firstCyc, extra}; the WebAssembly reads 0 as its default, so all > 0)
  SP.run = (c, rc) => {
    rc = rc || {}; const TL = SP.TL(), dx = rc.dx || c.dx, res = {};
    for (const how of ['js', 'wasm']) {
      let B = null; const rows = [];
      try {
        B = how === 'js' ? TL.jsBackend(structuredClone(c.spec), dx) : TL.rustBackend(c.spec, dx);
        if (c.trace || rc.trace) B.trace(true);
        c.rpms.forEach((rpm, i) => { if (c.turb) B.set(c.turb[0], i === 0 ? 0 : c.turb[1]); rows.push(SP.flat(B.step(rpm, i === 0, rc.cyc || 1, rc.firstCyc || 2, rc.extra || 1))); });
        res[how] = rows;
      } catch (e) { res[how] = { err: String(e && e.message || e) }; }
      finally { if (B) B.drop(); }
    }
    return res;
  };
  // the paths the JavaScript model reads from the spec in a run (Proxy on a clone; array indices as [])
  SP.reads = (specs, rc) => {
    const seen = new Set(), SKIP = new Set(['length', 'constructor', 'toJSON', 'then', 'valueOf', 'toString']);
    const wrap = (o, p) => (o === null || typeof o !== 'object') ? o : new Proxy(o, {
      get(t, k, r) { const v = Reflect.get(t, k, r); if (typeof k === 'symbol') return v;
        if (Array.isArray(t)) { if (/^\d+$/.test(k)) return wrap(v, p + '[]'); return typeof v === 'function' ? v.bind(r) : v; }
        if (SKIP.has(k)) return v; seen.add(p + '.' + k); return wrap(v, p + '.' + k); },
      has(t, k) { if (typeof k === 'string' && !Array.isArray(t)) seen.add(p + '.' + k); return Reflect.has(t, k); } });
    const WS = window.__sim.WS;
    for (const c of specs) { if (!c.spec) continue;
      try { const s = wrap(structuredClone(c.spec), 'spec'); const eng = WS.makeEngine(s.e, s.intake, s.exhaust, s.opt);
        if (c.turb) WS.setTurbine(eng, c.turb[0], c.turb[1]);
        WS.runSpeed(eng, { rpm: c.rpms[0], cycles: 1, dx: (rc && rc.dx) || 0.02, trace: !!c.trace }); } catch (e) { seen.add('ERROR ' + e.message); } }
    return [...seen];
  };
  // the validation scripts' direct call (tools/validation/wave/lib.js, instrumented as the scripts load it: SP.loadDirect(its
  // source)), run in this page so the maths library is the page's; the same steps as jsBackend, on the spec's JSON
  SP.loadDirect = src => { SP.WSd = new Function(src + '\nreturn wsFactory();')(); return typeof SP.WSd.makeEngine; };
  SP.direct = (c, rc) => {
    rc = rc || {}; const W = SP.WSd, dx = rc.dx || c.dx, spec = JSON.parse(JSON.stringify(c.spec)), rows = [], tr = !!(c.trace || rc.trace);
    const eng = W.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt); let state = null;
    const fl = window.__tsim.lib()(W, null).flat;
    c.rpms.forEach((rpm, i) => {
      if (c.turb) W.setTurbine(eng, c.turb[0], i === 0 ? 0 : c.turb[1]);
      const first = i === 0, extra = rc.extra || 1; if (first) state = null;
      let r = W.runSpeed(eng, { rpm, cycles: first ? (rc.firstCyc || 2) : (rc.cyc || 1), dx, state, trace: tr }), k = 0;
      while (k < extra) { const h = r.history, n = h.length; if (n >= 2 && Math.abs(h[n - 1].ve - h[n - 2].ve) < 0.004 * h[n - 1].ve) break; r = W.runSpeed(eng, { rpm, cycles: 2, dx, state: r.state, trace: tr }); k++; }
      state = r.state;
      rows.push([].concat([r.ve, r.imep, r.pmax, r.resid, r.pEvo, r.tEx, r.overlapPort, r.gimep], ...(r.perCyl || []).map(q => [q.ve, q.imep]), r.turb ? fl(r.turb) : [], tr ? Array.from(r.trace || []) : []));
    });
    return rows;
  };
  // the page's state at its boundary: every saved input (the project snapshot's vals: base values in mm, degC, cc...), the
  // specs collected as above, and the two run keys (a result is shown as current only while its key matches)
  SP.refresh = () => { document.getElementById('tab-intake').click(); document.getElementById('tab-four').click(); };
  SP.state = () => { const S = window.__sim, q = S.inp(), P = window.__tsim.plan();
    return JSON.parse(JSON.stringify({ vals: window.__proj.snapshot('x').vals, specs: SP.collect().map(c => ({ tag: c.tag, err: c.err, spec: c.spec, rpms: c.rpms, turb: c.turb })),
      key: q ? S.simKey(q) : null, tkey: P && !P.err ? P.key : null })); };
  window.__sp = SP;
};
// with direct: also the validation scripts' model (tools/validation/wave/lib.js build({hook: true})) for SP.direct
// the page's state after both tabs have rendered (a tab renders on the next frame after its click)
// visit false: as the page stands (a user who loaded a project and went straight on), only waiting for the render
async function pageState(pg, visit) {
  const { settle } = require('./settle');
  if (visit === false) { await settle(pg); return pg.evaluate(() => window.__sp.state()); }
  await pg.evaluate(() => document.getElementById('tab-intake').click()); await settle(pg);
  await pg.evaluate(() => document.getElementById('tab-four').click()); await settle(pg);
  return pg.evaluate(() => window.__sp.state());
}
async function installPage(pg, direct) {
  await pg.evaluate('(' + PAGE_SRC.toString() + ')()');
  if (direct) await pg.evaluate(src => window.__sp.loadDirect(src), require(path.join(ROOT, 'tools', 'validation', 'wave', 'lib.js')).build({ hook: true }));
}

// ---------------------------------------------------------------------------------------------- compare
// every number to the last digit (Object.is: NaN equals NaN, -0 differs from +0)
function sameRows(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return { ok: false, why: 'error: ' + JSON.stringify(a && a.err || a).slice(0, 160) + ' / ' + JSON.stringify(b && b.err || b).slice(0, 160) };
  if (a.length !== b.length) return { ok: false, why: 'speeds ' + a.length + ' / ' + b.length };
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return { ok: false, why: 'speed ' + i + ': ' + a[i].length + ' / ' + b[i].length + ' numbers' };
    for (let j = 0; j < a[i].length; j++) if (!Object.is(a[i][j], b[i][j])) return { ok: false, why: 'speed ' + i + ' number ' + j + ': ' + a[i][j] + ' / ' + b[i][j], i, j, a: a[i][j], b: b[i][j] };
  }
  return { ok: true };
}
// ---------------------------------------------------------------------------------------------- cases
// a small seeded generator (mulberry32)
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// stratified engine presets (text prefixes of the engine list; resolved in the page, a missing one is reported)
const PRESET_CASES = ['2.0 L K20A2', '2.0 L K20Z1', '1.8 L B18C1', '1.7 L B17A1', 'N54B30', 'S54B32', 'S65B40', 'S85B50', 'S62B50', 'S52B32', 'S38B36', 'B58B30M0',
  '2.5 TFSI', '5.2 FSI V10', '4.0 TFSI', 'Buick 3.8 turbo', 'LF4 3.6', '7.5 L Classic GM', '690T 2.9', '4.3 L AJ37', '5.9 L AM28', '2.3 L S14', '3.0 L S50B30US', '4.9 L S62B50'];
// the fuzz: each case a list of [id, value] in metric (applied after a preset or none), the tab inputs the spec reads
function cases(seed, n) {
  const R = rng(seed), pick = a => a[Math.floor(R() * a.length)], num = (lo, hi, d) => +(lo + (hi - lo) * R()).toFixed(d == null ? 1 : d), out = [];
  for (let i = 0; i < n; i++) {
    const ui = [], cyl = pick([1, 2, 3, 4, 4, 6, 6, 8, 8]), boosted = R() < 0.3;
    const bore = num(70, 104), stroke = num(65, 100), disp = Math.PI / 4 * bore * bore * stroke / 1000 * cyl;
    ui.push(['f-cyl', String(cyl)], ['f-disp', disp.toFixed(1)]);
    if (R() < 0.7) ui.push(['f-bore', String(bore)]); if (R() < 0.5) ui.push(['f-stroke', String(stroke)]);
    ui.push(['f-cratio', String(num(8.5, 13))], ['f-valves', pick(['2', '4'])], ['f-rpm', String(Math.round(num(4500, 8500, 0) / 100) * 100)]);
    const nP = Math.min(cyl, pick([1, 2, 3, 4, 4, 8].filter(x => x <= cyl)));
    ui.push(['f-n', String(nP)]);
    if (nP > 1 && R() < 0.3) { const g = nP === 4 ? [90, 270, 180, 180] : Array(nP).fill(720 / nP); ui.push(['f-gaps', g.join(', ')]); }
    ui.push(['f-evo', String(num(40, 75, 0))], ['f-port', String(R() < 0.6 ? num(60, 150, 0) : 0)], ['f-dp', String(num(32, 52))]);
    if (R() < 0.3) { const sh = pick(['round', 'ellipse', 'stadium', 'rrect']); ui.push(['f-pshape', sh], ['f-pw', String(num(30, 50))], ['f-ph', String(num(25, 40))], ['f-pr', String(num(2, 8))]); }
    if (R() < 0.25) { ui.push(['f-ch', pick(['can', 'wrap', 'bulge'])], ['f-chx', String(num(100, 300, 0))]); }
    // the cam: a convention, events typed (or blank: estimated), lifts, valves
    const conv = pick(['seat', '050', '1mm', 'seat', '050']);
    if (conv !== 'seat' || R() < 0.7) { const base = conv === 'seat' ? 25 : conv === '050' ? -5 : 5;
      ui.push(['f-ivo', String(num(base - 10, base + 15, 0))], ['f-ivc', String(num(base + 20, base + 50, 0))], ['f-evc', String(num(base - 12, base + 12, 0))]); }
    ui.push(['f-camat', conv]);
    if (R() < 0.6) ui.push(['f-lin', String(num(8, 14))], ['f-lex', String(num(7.5, 13))]);
    if (R() < 0.5) ui.push(['f-vdi', String(num(0.36, 0.5, 3) * bore)], ['f-vde', String(num(0.3, 0.42, 3) * bore)]);
    if (R() < 0.2) ui.push(['f-vcd', String(num(0.55, 0.85, 2))]);
    if (R() < 0.4) ui.push(['f-rod', String(+(stroke * num(1.5, 1.9, 2)).toFixed(2))]);
    ui.push(['f-intl', String(num(150, 450, 0))]);
    if (R() < 0.4) ui.push(['f-pin', String(num(60, 120, 0))]);
    if (R() < 0.3) ui.push(['f-ird', String(num(30, 55))]);
    if (R() < 0.35) { ui.push(['f-intk', 'plenum'], ['f-plv', String(num(1000, 6000, 0))], ['f-tbd', String(num(50, 95, 0))], ['f-itl', String(num(200, 800, 0))], ['f-itd', String(num(60, 110, 0))]);
      if (R() < 0.5) ui.push(['f-tcd', String(num(0.7, 0.9, 2))]); if (R() < 0.4) ui.push(['f-fdp', String(num(0.5, 3, 2))]); }
    if (R() < 0.25) ui.push(['f-vtc', String(num(-5, 25, 0))]);
    if (R() < 0.12) ui.push(['f-vtcmode', 'best'], ['f-vtcmax', String(pick([25, 50]))]);
    if (R() < 0.15) ui.push(['f-vtec', 'two'], ['f-vrpm', String(Math.round(num(4500, 6500, 0) / 100) * 100)], ['f-livo', String(num(-5, 10, 0))], ['f-livc', String(num(20, 40, 0))], ['f-levo', String(num(25, 45, 0))], ['f-levc', String(num(-10, 5, 0))], ['f-llin', String(num(6, 10))]);
    // the Intake tab: fuel, mixture, evaporation, the boosted source and the turbine options
    const fuel = pick(['pump', 'pump', 'race', 'e10', 'e85', 'e100', 'm100']); ui.push(['i-fuel', fuel]);
    if (fuel === 'e85' && R() < 0.5) ui.push(['i-eth', String(num(51, 83, 0))]);
    if (R() < 0.4) ui.push(['i-lam', String(num(0.78, 0.95, 3))]);
    ui.push(['i-evap', pick(['none', 'none', 'port', 'di', 'all'])]);
    if (boosted) {
      ui.push(['i-ind', pick(['turbo', 'turbo', 'centri'])], ['i-boost', String(num(40, 150, 0))], ['i-hp', String(Math.round(disp / 1000 * num(80, 160, 0)))]);
      if (R() < 0.4) ui.push(['i-tsa', String(num(600, 2000, 0))]); if (R() < 0.3) ui.push(['i-tsw', String(num(0, 300, 0))]);
      ui.push(['i-wgtype', pick(['ext', 'int'])], ['i-mani', pick(['tube', 'log', 'div'])], ['i-teffm', pick(['bsr', 'watson', 'const'])]);
      if (R() < 0.4) ui.push(['i-teff', String(num(60, 80, 0))]); if (R() < 0.4) ui.push(['i-tobp', String(num(5, 30, 0))]);
      if (R() < 0.3) ui.push(['i-kon', 'on']);
      ui.push(['$turbo', String(Math.floor(R() * 1e6))]);   // a turbo from the library (its wheels: bsr), resolved in the page
    }
    out.push({ name: 'fuzz' + seed + '-' + i, ui, trace: R() < 0.2 });
  }
  return out;
}
module.exports = { ROOT, RUST_RECV, RUST_CALLS, rustReads, ALLOW, coverage, PAGE_SRC, installPage, pageState, sameRows, rng, cases, PRESET_CASES };
