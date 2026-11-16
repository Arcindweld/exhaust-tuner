// K-series sourced data and the cam models of 2026-11-15 (docs/WAVE_VALIDATION_2026-11-11.md part 14, N sections).
//   node tests/kseries_ui.js   (from web/)
// Cited figures the presets must carry (read 2026-11-15; labels as on the page):
//   rod 152.019 mm (5.985 in) "stock K24 length", any K24A / K24Z bottom end (reputable vendor):
//     https://www.hybrid-racing.com/products/speedfactory-h-beam-connecting-rods-k24
//   VTC range: "The K24A2 in the TSX came with 25 degrees." "The K20A2, K20A3, K20Z1, and K20Z3 got the 50 degree
//     actuator." (reputable vendor) https://hybrid-racing.com/products/honda-k20z-a-50-degree-vtc-intake-cam-gear-14310-rbc-003
//     Honda R&D Technical Review 20-1 (2008 Accord K24A): VTC widened "from 25° to 50°" (maker data)
//     https://global.honda/en/technical-review/PDF/020-1/20-1_25e.pdf
//   VTEC changeover: K24A2 above 6,000 RPM, K24Z7 above 5,000, K24W1 above 4,800 (Honda, the presets' existing kd.vtec)
//   K20 bore x stroke 86 x 86 mm: Honda R&D Technical Review 12-2 (K20A) https://global.honda/en/technical-review/PDF/012-2/012-2_45e.pdf
//     and EngineLabs https://www.enginelabs.com/?p=8104
//   Manifolds: Skunk2 Ultra Street 6.85 in runners, 1.8 L, 71 mm; Ultra Race "6.0 in tapered runners", 3.5 L; K-Tuned side
//     feed 5.75 in, 4.78 L (vendors with the maker's copy); RBC 18.5 cm, 1720 cc, 62 mm; RRC ~19.0 cm, 64 mm; Skunk2 Pro
//     19.5 cm without stacks, 2950 cc, 64 mm (a forum spec list, enthusiast measurement): see K_MANI_SRC on the page.
// Checks: the presets fill these figures and blank them for other engines; the manifold list fills only its figures (both
// unit systems), with the head's port as a labelled stand-in; simSpec: rod, runner bore, advance, the low profile; the
// two-profile split and its merge; the best-advance set; the WebAssembly gets the seat events of a check-lift cam (the
// defect found here: it read a 0.050 in card as seat events), bit for bit against the JavaScript model; non-K set-ups give
// the same specs as the page before part 14 (fixtures/kseries_specs_before.json); a project saved before keeps its values.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { specsOf } = require('./kseries_specs');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const errs = [];
  const open = async () => { const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + path.join(__dirname, '..', 'index.html')); await pg.waitForTimeout(700); return pg; };
  const pick = (pg, code) => pg.evaluate(code => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('v-mode', 'eng'); const o = [...document.getElementById('v-pick').options].find(o => o.text.startsWith(code + ' ')); if (!o) return null; set('v-pick', o.value);
    const B = id => document.getElementById(id)._b;
    return { rod: B('f-rod'), vtcMax: B('f-vtcmax'), vrpm: B('f-vrpm'), vtc: B('f-vtc'), vtec: document.getElementById('f-vtec').value, bore: B('f-bore'), stroke: B('f-stroke'),
      note: document.getElementById('v-note').textContent }; }, code);
  const same = (a, w) => w === null ? !Number.isFinite(a) : Math.abs(a - w) < 1e-9;
  let pg = await open();
  // ---- 1. presets
  const want = { K24A2: { rod: 152.019, vtcMax: 25, vrpm: 6000 }, K24A4: { rod: 152.019, vtcMax: null, vrpm: null }, K24A8: { rod: 152.019 }, K24Z3: { rod: 152.019 },
    K24Z7: { rod: 152.019, vrpm: 5000 }, K24W1: { rod: null, vrpm: 4800 }, K20A2: { rod: null, vtcMax: 50, bore: 86, stroke: 86 }, K20Z3: { rod: null, vtcMax: 50, bore: 86, stroke: 86 } };
  for (const [code, w] of Object.entries(want)) {
    const r = await pick(pg, code); if (!r) { ok(false, code + ' in the list'); continue; }
    const bad = Object.entries(w).filter(([k, v]) => !same(r[k], v)).map(([k, v]) => k + ' ' + r[k] + ' (want ' + v + ')');
    ok(!bad.length && !Number.isFinite(r.vtc) && r.vtec === 'one', code + ': fills ' + JSON.stringify(w) + ', no advance, one profile' + (bad.length ? '; ' + bad.join(', ') : ''));
  }
  let r = await pick(pg, 'K24A2');
  ok(/Connecting rod 152\.019 mm \(5\.985 in\)/.test(r.note) && /reputable vendor/.test(r.note) && /range 25°/.test(r.note) && /from 25° to 50°/.test(r.note) && /changeover 6,000 RPM/.test(r.note) && /Not published in the sources found: stock cam timing/.test(r.note),
    'K24A2 note: rod in both units with its label, VTC 25° (vendor) and Honda\'s 25 to 50°, the changeover, cam timing still not published');
  r = await pick(pg, 'K20A2'); ok(/Bore and stroke 86 × 86 mm/.test(r.note) && /maker data/.test(r.note) && /magazine/.test(r.note), 'K20A2 note: 86 x 86 with maker data and magazine labels');
  r = await pick(pg, 'K24A2'); r = await pick(pg, '6.2 LS3') || await pick(pg, 'LS3');
  ok(r && !Number.isFinite(r.rod) && !Number.isFinite(r.vtcMax) && !Number.isFinite(r.vrpm), 'a non-K engine after the K24A2 blanks the rod, the phaser range and the changeover' + (r ? '' : ' (no LS3 found)'));
  // ---- 2. manifolds, both unit systems
  await pick(pg, 'K24A2'); await pg.click('[data-tab="four-stroke"]'); await pg.waitForTimeout(400);
  const mani = (k, units) => pg.evaluate(([k, units]) => { document.getElementById(units === 'met' ? 'u-met' : 'u-imp').click();
    const s = document.getElementById('f-imani'); s.value = k; s.dispatchEvent(new Event('change', { bubbles: true }));
    const B = id => document.getElementById(id)._b, V = id => document.getElementById(id).value;
    return { intl: B('f-intl'), pin: B('f-pin'), intk: V('f-intk'), plv: B('f-plv'), tbd: B('f-tbd'), ird: B('f-ird'), intlTxt: V('f-intl'), hint: document.getElementById('f-imani-hint').textContent }; }, [k, units]);
  const setB = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]);
  let m = await mani('rbc', 'imp');
  ok(Math.abs(m.intl - 285) < 0.01 && m.pin === 100 && m.intk === 'plenum' && m.plv === 1720 && m.tbd === 62 && !Number.isFinite(m.ird) && /^11\.22$/.test(m.intlTxt) && /stand-in: measure yours/.test(m.hint) && /enthusiast measurement/.test(m.hint) && /\(185 mm\)/.test(m.hint),
    'RBC (inches): runner 185 + the 100 mm stand-in port = 285 mm (11.22 in), plenum 1720 cc, 62 mm, no diameter, labels in the hint');
  await pg.click('#u-met'); await setB('f-pin', '120'); m = await mani('sk2us', 'met');
  ok(Math.abs(m.intl - (6.85 * 25.4 + 120)) < 0.01 && m.pin === 120 && m.plv === 1800 && m.tbd === 71 && /^294/.test(m.intlTxt) && /as you typed it/.test(m.hint) && /maker’s copy/.test(m.hint),
    'Skunk2 Ultra Street (mm): 174.0 + the typed 120 mm port = 294.0 mm, 1.8 L, 71 mm; the typed port kept' + (fails.length ? ' ' + JSON.stringify(m) : ''));
  m = await mani('sk2ur', 'met');
  ok(Math.abs(m.intl - (152.4 + 120)) < 0.01 && m.plv === 3500 && m.tbd === 71 && /throttle left as typed/.test(m.hint), 'Skunk2 Ultra Race: 152.4 mm runner, 3.5 L, the throttle left as it was (bore not published)');
  m = await mani('ktsf', 'imp'); ok(Math.abs(m.intl - (146.05 + 120)) < 0.01 && m.plv === 4780, 'K-Tuned side feed: 146.05 mm runner, 4.78 L');
  m = await mani('rrc', 'imp'); ok(Math.abs(m.intl - 310) < 0.01 && m.plv === 4780 && m.tbd === 64 && /plenum left as typed/.test(m.hint), 'RRC: 190 mm runner, 64 mm, the plenum left as it was (not given)');
  // ---- 3. simSpec: rod, runner bore, advance, the low profile
  const sp = await pg.evaluate(() => { const S = window.__sim, q = S.inp(), a = S.simSpec(q);
    const b = S.simSpec(Object.assign({}, q, { vtc: 10, ird: 45 })), c = S.simSpec(Object.assign({}, q, { useLo: true, lo: { ivo: 5, ivc: 30, evo: 40, evc: 0, lin: 8, lex: NaN } }));
    return { rod: a.e.rod, cam: a.e.cam, d: a.intake.segs[0].d0, segs: a.intake.segs.length, plen: !!a.intake.plenum, camB: b.e.cam, dB: b.intake.segs[0].d0, camC: c.e.cam, liftC: [c.e.liftIn, c.e.liftEx], lift: [a.e.liftIn, a.e.liftEx], err: S.simCheck(q) }; });
  ok(!sp.err && sp.rod === 152.019 / 1000 && JSON.stringify(sp.cam) === '{"ivo":20,"ivc":60,"evo":60,"evc":20}' && sp.segs === 2 && sp.plen, 'K24A2 spec: rod 0.152019 m, the stand-in cam 20/60/60/20, runner with its port, plenum');
  ok(JSON.stringify(sp.camB) === '{"ivo":30,"ivc":50,"evo":60,"evc":20}' && sp.dB === 0.045, 'advance 10°: the intake opens at 30° BTDC and closes at 50° ABDC, exhaust unchanged; runner bore 45 mm typed');
  ok(JSON.stringify(sp.camC) === '{"ivo":5,"ivc":30,"evo":40,"evc":0}' && sp.liftC[0] === 0.008 && sp.liftC[1] === sp.lift[1], 'low profile: its four events, its intake lift, the main exhaust lift when blank');
  // ---- 4. two profiles: split and merge; best advance set
  const two = await pg.evaluate(() => { const S = window.__sim, q = Object.assign({}, S.inp(), { vtec: 'two', vrpm: 6000, lo: { ivo: 5, ivc: 30, evo: 40, evc: 0 }, vtcMode: 'best', vtcMax: 25 });
    const err = S.simCheck(q), v = S.simVariants(q), rpms = S.simRpms(6800), en = S.simEntries(v, rpms);
    // a fake worker result per entry: torque = the speed, for each entry its own design index
    const out = en.map(e => ({ k: e.k, g: e.g, part: e.part, key: e.key, label: e.label, tq: e.rpms.map(r => r + (e.part === 'lo' ? 0.1 : 0.2)), tqg: e.rpms.slice(), ve: e.rpms.slice(), ov: e.rpms.slice(), pc: e.rpms.map(() => [1]), vdt: 1 }));
    const M = S.simMerge(out, v);
    return { err, keys: v.map(x => x.key), vtc: v.filter(x => x.vtc != null).map(x => x.vtc), lo: v[0].specLo && v[0].specLo.e.cam, cut: v[0].vcut, rpms, ents: en.map(e => [e.g, e.part, e.rpms.length]),
      merged: M.map(o => ({ k: o.k, n: o.tq.length, tq: o.tq, vtc: o.vtc })), set: S.simVtcSet(25), bad: S.simCheck(Object.assign({}, q, { lo: { ivo: 5, ivc: 30 } })), bad2: S.simCheck(Object.assign({}, q, { vtcMax: NaN })) }; });
  const nLo = two.rpms.filter(x => x < 6000).length;
  ok(!two.err && JSON.stringify(two.set) === '[0,5,10,15,20,25]' && JSON.stringify(two.vtc) === '[0,5,10,15,20,25]' && two.keys.length === 3 + 6, 'best advance: six runs at 0, 5, ..., 25° beside the three designs (' + two.keys.join(', ') + ')');
  ok(JSON.stringify(two.lo) === '{"ivo":5,"ivc":30,"evo":40,"evc":0}' && two.cut === 6000 && two.ents.length === 2 * two.keys.length && two.ents.every(e => e[2] === (e[1] === 'lo' ? nLo : two.rpms.length - nLo)),
    'two profiles: every design runs as two entries, the low profile at the ' + nLo + ' speeds under 6,000 RPM and the main one above');
  ok(two.merged.length === two.keys.length && two.merged.every(o => o.n === two.rpms.length && o.tq.every((t, i) => Math.abs(t - two.rpms[i] - (two.rpms[i] < 6000 ? 0.1 : 0.2)) < 1e-9)) && two.merged.slice(3).map(o => o.vtc).join() === '0,5,10,15,20,25',
    'merge: one curve per design in speed order, the low profile below the changeover, the advance carried');
  ok(/all four events of the low profile/.test(two.bad) && /phaser’s range/.test(two.bad2), 'checks: the low profile needs all four events; best advance needs the range');
  // ---- 5. the WebAssembly gets seat events (bit parity with the JavaScript model for a 0.050 in and a 1 mm card)
  // the specs from the page, the models in Node (the page's own wsFactory and its embedded WebAssembly, as wave_wasm.js)
  const base = await pg.evaluate(() => { const S = window.__sim, sp = S.simSpec(Object.assign({}, S.inp(), { intk: 'open' }));
    sp.opt = { phases: [0] }; sp.exhaust = { segs: sp.exhaust.segs.slice(0, 1), Tw: 700, chambers: [] }; return sp; });
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const WSN = new Function(html.slice(html.indexOf('function wsFactory(){'), html.indexOf('\nconst WS=wsFactory();')) + '\nreturn wsFactory();')();
  const X = new WebAssembly.Instance(new WebAssembly.Module(Buffer.from(html.match(/const WAVE_WASM_B64='([A-Za-z0-9+/=]+)'/)[1], 'base64')), { m: { pow: Math.pow, sin: Math.sin, cos: Math.cos, exp: Math.exp } }).exports;
  const rsRun = s => { const t = new TextEncoder().encode(JSON.stringify(s)), p = X.wave_alloc(t.length); new Uint8Array(X.memory.buffer, p, t.length).set(t); const id = X.wave_new(p, t.length); X.wave_free(p, t.length);
    const n = X.wave_step(id, 5000, 1, 0.0125, 3, 8, 5, NaN), v = Array.from(new Float64Array(X.memory.buffer, X.wave_out(), n)).slice(0, 2); X.wave_drop(id); return v; };
  const par = [1.27, 1.0, 0].map(h => { const sp = JSON.parse(JSON.stringify(base)); if (h) sp.e.cam = Object.assign({}, sp.e.cam, { ivo: 25, ivc: 20, evo: 30, evc: 15, checkLift_mm: h });
    const eng = WSN.makeEngine(sp.e, sp.intake, sp.exhaust, sp.opt), js = WSN.sweep(eng, [5000], { dx: 0.0125, cycles: 3, firstCycles: 8, maxExtra: 5 })[0];   // the page's sweep, as the worker's two paths run it
    return { h, js: [js.ve, js.imep], rs: rsRun(WSN.rustSpec(sp)), raw: rsRun(sp), seat: WSN.rustSpec(sp).e.cam }; });
  for (const o of par) ok(o.rs[0] === o.js[0] && o.rs[1] === o.js[1] && (o.h ? o.raw[0] !== o.js[0] && !('checkLift_mm' in o.seat) : true),
    'check lift ' + (o.h || 'none') + ' mm: the WebAssembly given rustSpec matches the JavaScript to the last digit (VE ' + o.js[0] + (o.rs[0] !== o.js[0] ? ' against ' + o.rs[0] : '') + ')' + (o.h ? '; given the raw card it did not (VE ' + o.raw[0] + ', the defect fixed)' : ''));
  // ---- 6. the page before part 14: the same specs for set-ups that are not K-series; the K24A2 only by its rod, the K20A2 by its bore and stroke
  const before = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'kseries_specs_before.json'), 'utf8'));
  const now = await specsOf(b, path.join(__dirname, '..', 'index.html'));
  for (const c of ['default', 'ls3', 'plenum']) ok(JSON.stringify(now[c]) === JSON.stringify(before[c]), c + ': every variant\'s spec identical to the page before part 14 (' + now[c].length + ' variants)');
  { const fix = JSON.parse(JSON.stringify(before.K24A2)); fix.forEach(v => { v.spec.e.rod = 152.019 / 1000; });
    ok(JSON.stringify(now.K24A2) === JSON.stringify(fix), 'K24A2: the same specs as before but for the rod, ' + before.K24A2[0].spec.e.rod.toFixed(4) + ' -> 0.152019 m'); }
  ok(now.K20A2[0].spec.e.bore === 0.086 && now.K20A2[0].spec.e.stroke === 0.086 && Math.abs(before.K20A2[0].spec.e.bore - 0.086) > 1e-4, 'K20A2: bore and stroke 86 x 86 mm now (before: estimated, ' + (before.K20A2[0].spec.e.bore * 1000).toFixed(2) + ' x ' + (before.K20A2[0].spec.e.stroke * 1000).toFixed(2) + ' mm)');
  // ---- 7. a project saved before part 14 keeps its values (the K24A2 + PT5862 journey of operatingpoint_ui)
  await pg.close(); pg = await open();
  const L = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'op_legacy_k24.json'), 'utf8'));
  await pg.evaluate(d => window.__proj.apply(d), L.snap); await pg.waitForTimeout(600); await pg.click('[data-tab="four-stroke"]'); await pg.waitForTimeout(500);
  const lg = await pg.evaluate(() => { const S = window.__sim, q = S.inp(), sp = S.simSpec(q), B = id => document.getElementById(id)._b; return { rod: sp.e.rod, S: sp.e.stroke, cam: sp.e.cam, intl: B('f-intl'), fr: B('f-rod'), vtec: document.getElementById('f-vtec').value }; });
  const savedIntl = L.snap.vals['f-intl'] && L.snap.vals['f-intl'].b;
  ok(Math.abs(lg.rod - 1.7 * lg.S) < 1e-12 && !Number.isFinite(lg.fr) && lg.vtec === 'one' && JSON.stringify(lg.cam) === '{"ivo":20,"ivc":60,"evo":60,"evc":20}' && (savedIntl == null || lg.intl === savedIntl),
    'legacy K24 project: no rod saved, so 1.7 x stroke as it ran then; one profile, the stand-in cam, the runner as saved (' + lg.intl + ' mm)' + (fails.length ? ' ' + JSON.stringify(lg) + ' saved ' + savedIntl : ''));
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'kseries_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
