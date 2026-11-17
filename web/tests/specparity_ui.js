// Spec parity at the page boundary (docs/SPEC_PARITY_AUDIT_2026-11-16.md). The page's own specs, built from its inputs,
// run the two ways the page runs them, and the page's state through a save and a load, the unit toggle and its presets.
//   node tests/specparity_ui.js   (from web/)
// 1. Field coverage: every spec path the JavaScript model reads in runs of the page's specs (a Proxy on the spec) must be
//    read by the Rust model too (rust/et_wave/src/lib.rs, its ["key"] reads resolved statically: specparity_lib.js
//    rustReads), or be on the commented allow-list (ALLOW: translated by WS.rustSpec, or refused by it); every allow-list
//    entry must still be read by the JavaScript (no stale entries). The native host (rust/et_host, et_app) and the Fusion
//    add-in build no wave spec (checked: no reference to the wave model there).
// 2. Refusal: a spec with a JavaScript-only part (crossover, pieces, branches, cylinders not firing) is never handed to the
//    WebAssembly: rustSpec throws, the page's workers check WS.jsOnly first.
// 3. Differential: fixed cases (each cam-entry convention, the cam library's 0.050 in cards, plenum and filter, two
//    profiles, best advance, fuels and evaporation, a collector with uneven gaps, the Headers Tri-Y layout, turbo with the
//    blade-speed-ratio efficiency and the knock trace, centrifugal, typed turbine areas) and a seeded fuzz: every number
//    the same to the last digit, JavaScript, WebAssembly and the validation scripts' own load of the model (lib.js), all in
//    the page. And one whole 4-Stroke run from its button, with the WebAssembly and with window.__waveJs.
// 4. Save -> load: every saved input and every spec identical after loading the project into a fresh page.
// 5. Units: inches/mm switched back and forth change no base value and no spec.
// 6. Presets: an engine preset chosen twice gives the same state; P, then Q, then P again: the fields that differ are only
//    those the rule keeps (PRESET_KEEPS: fields an engine preset does not define keep their value).
// 7. Run keys: a change of fuel, mixture or evaporation that changes the 4-Stroke tab's specs changes its run key (the
//    defect found here: the key left the Intake tab's fuel out, so a finished run stayed "current" after a fuel change).
'use strict';
const { chromium } = require('playwright');
const { uiClick } = require('./settle');
const path = require('path');
const L = require('./specparity_lib');
const { typedPoint } = require('./settle');
const PAGE = path.join(__dirname, '..', 'index.html');
const RC = { dx: 0.025, cyc: 1, firstCyc: 2, extra: 1 };
// fields an engine preset (applyVehicle) does not define and so keeps (the rule stated in the audit doc): the cam card and
// its convention, the lifts, flow coefficient, intake runner and plenum, the header's sizes, the chamber, two-profile
// and advance choices, valves and compression when the preset has none, the power field when it has none, the
// unequal-length and section settings, the Intake tab's other inputs
const PRESET_KEEPS = /^(f-(ivo|ivc|evc|evo|camat|camlib|lin|lex|vcd|ceff|intl|pin|ird|imani|intk|plv|tbd|tcd|fdp|itl|itd|vflow|pshape|pw|ph|pr|port|dp|wall|ch.*|vtcmode|vtec|livo|livc|levo|levc|llin|llex|cratio|valves|cdi|cde|clsa|cadv)|i-hp)$/;
(async () => {
  const t0 = Date.now(), b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const errs = [];
  const open = async (hash) => { const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + PAGE + (hash || '#intake')); await pg.waitForTimeout(700); await L.installPage(pg, true);
    await pg.evaluate(() => { document.getElementById('u-met').click(); document.body.classList.add('expert'); document.body.classList.remove('simple'); }); await typedPoint(pg); return pg; };
  const apply = async (pg, c0) => { const c = Object.assign({}, c0, { check: undefined });
    if (c.hdr) {   // the Headers tab first (its table rows appear after it renders)
      await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(400);
      for (const [id, v] of c.hdr) { if (id[0] === '#') { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); } else { await pg.evaluate(([id, v]) => window.__sp.set(id, v), [id, v]); await pg.waitForTimeout(150); } }
      await pg.waitForTimeout(300); await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400); }
    return pg.evaluate(c => { const SP = window.__sp, ui = c.ui || [];
    if (c.preset && !SP.preset(c.preset)) return 'no preset ' + c.preset;
    document.getElementById('tab-intake').click();
    for (const [id, v] of ui) { if (id === '$turbo') { const s = document.querySelector('select.tsox[data-k="turbo"]'); if (s && s.options.length > 1) { s.value = s.options[1 + (+v % (s.options.length - 1))].value; s.dispatchEvent(new Event('change', { bubbles: true })); } }
      else if (/^i-/.test(id)) SP.set(id, v); }
    document.getElementById('tab-four').click();
    if (c.camlib) SP.set('f-camlib', c.camlib);
    for (const [id, v] of ui) if (/^f-/.test(id)) SP.set(id, v);
    return ''; }, c); };

  // ---- 1. field coverage, over the page's specs of the fixed cases below (recorded while they run in 3)
  const rust = L.rustReads(), jsRead = new Set();
  ok(rust.size > 100 && rust.has('spec.e.cam.ivo') && rust.has('spec.exhaust.turbine.bsr.xo') && rust.has('spec.opt.collectors[].stages[].segs_by_group[][].L'),
    'the Rust model\'s read paths resolved from rust/et_wave/src/lib.rs (' + rust.size + ', every receiver placed)');
  const fs = require('fs');
  const others = ['rust/et_host', 'rust/et_app', 'rust/et_core', 'fusion-addin', 'app'].map(d => path.join(L.ROOT, d)).filter(d => fs.existsSync(d));
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (/^(target|node_modules|bin|obj|\.git)$/.test(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  const hits = others.flatMap(walk).filter(f => /\.(rs|py|cs|js|toml)$/.test(f)).filter(f => /makeEngine|wave_new|et_wave|checkLift_mm|rustSpec/.test(fs.readFileSync(f, 'utf8')));
  ok(!hits.length, 'the native host, the app and the Fusion add-in build no wave spec of their own (nothing to keep in step)' + (hits.length ? ': ' + hits.join(', ') : ''));

  // ---- 3. differential: fixed cases and a seeded fuzz
  const FIXED = [
    { name: 'default page (cam estimated from the exhaust opening)' },
    { name: 'cam library LS3, 0.050 in card, its flow bench', camlib: 'ls3' },
    { name: 'cam library LS7 (straight up, 0.050 in)', camlib: 'ls7', ui: [['f-n', '4'], ['f-gaps', '90, 270, 180, 180']] },
    { name: 'cam library LT1, plenum with a filter', camlib: 'lt1', ui: [['f-intk', 'plenum'], ['f-plv', '4500'], ['f-tbd', '87'], ['f-itl', '600'], ['f-itd', '101.6'], ['f-fdp', '1.5']] },
    { name: 'K24A2: 1 mm cam, two profiles, best advance, E85 with port evaporation', preset: 'K24A2 ', ui: [['f-camat', '1mm'], ['f-ivo', '5'], ['f-ivc', '35'], ['f-evc', '5'], ['f-evo', '40'],
      ['f-vtec', 'two'], ['f-vrpm', '6000'], ['f-livo', '-5'], ['f-livc', '25'], ['f-levo', '30'], ['f-levc', '-10'], ['f-vtcmode', 'best'], ['f-vtcmax', '25'], ['i-fuel', 'e85'], ['i-evap', 'port']] },
    { name: 'seat-to-seat card, rod, runner bore, port, chamber, methanol direct', ui: [['f-camat', 'seat'], ['f-ivo', '30'], ['f-ivc', '70'], ['f-evc', '28'], ['f-rod', '150'], ['f-ird', '42'], ['f-pin', '90'], ['f-port', '100'], ['f-ch', 'can'], ['f-chx', '200'], ['i-fuel', 'm100'], ['i-evap', 'di'], ['i-lam', '0.85']] },
    { name: 'Headers tab Tri-Y 4-2-1 at unequal lengths, 100 mm port (its port law: D2)', check: sp => sp.filter(s => /^hdr/.test(s.tag)).length === 2 && sp.filter(s => /^hdr/.test(s.tag)).every(s => s.spec.exhaust.per_cyl.every(p => p[0].port === true && p.length === 2)), ui: [['f-disp', '2457'], ['f-cyl', '4']],
      hdr: [['h-eng', 'f4'], ['h-disp', '2457'], ['h-grp', 'all'], ['h-merge', 'triy'], ['h-pairs', '1,3 | 2,4'], ['h-lenmode', 'unequal'], ['h-port', '100'], ['#h-len-c1', '430'], ['#h-len-c2', '600'], ['#h-len-c3', '430'], ['#h-len-c4', '600'], ['#h-sec-g1', '350'], ['#h-sec-g2', '650']] },
    { name: 'turbo K24A2, wheel-speed efficiency, knock trace, 0.050 in cam', preset: 'K24A2 ', ui: [['i-ind', 'turbo'], ['i-boost', '120'], ['i-hp', '400'], ['i-kon', 'on'], ['i-teffm', 'bsr'], ['$turbo', '7'], ['f-camat', '050'], ['f-ivo', '0'], ['f-ivc', '30'], ['f-evc', '0']] },
    { name: 'turbo, typed turbine and gate areas, Watson, internal gate, back pressure', ui: [['f-cyl', '4'], ['f-disp', '2000'], ['f-n', '4'], ['i-ind', 'turbo'], ['i-boost', '100'], ['i-hp', '300'], ['i-tsa', '1200'], ['i-tsw', '150'], ['i-teffm', 'watson'], ['i-wgtype', 'int'], ['i-tobp', '15'], ['$turbo', '3']] },
    { name: 'centrifugal supercharger, plenum, E10, a can on the primary (kept: D4)', ui: [['i-ind', 'centri'], ['i-boost', '50'], ['i-hp', '500'], ['i-fuel', 'e10'], ['f-intk', 'plenum'], ['f-ch', 'can'], ['f-chx', '200']],
      check: sp => { const f = sp.find(s => s.tag === 'four:base'), t = sp.filter(s => /^tsim/.test(s.tag)); return f && f.spec.exhaust.chambers.length === 1 && t.length >= 2 && t.every(s => JSON.stringify(s.spec.exhaust.chambers) === JSON.stringify(f.spec.exhaust.chambers)); } }
  ].concat(L.cases(20261116, 2));
  const diffs = []; let nNum = 0, nSpec = 0; const tags = new Set();
  for (const c of FIXED) {
    const pg = await open(); const e = await apply(pg, c);
    if (e) { ok(false, c.name + ': ' + e); await pg.close(); continue; }
    await L.pageState(pg); const specs = await pg.evaluate(() => window.__sp.collect());
    const bad = [];
    if (c.check && !c.check(specs)) bad.push('the specs are not as this case expects (' + specs.map(s => s.tag).join(', ') + ')');
    for (const s of specs) {
      if (s.err) { if (!/^fuzz/.test(c.name)) bad.push(s.tag + ': no spec (' + s.err.slice(0, 80) + ')'); continue; }
      s.rpms = s.tag.startsWith('tsim:turbo') ? s.rpms : s.rpms.slice(0, 1);
      if (c.trace) s.trace = true;
      const r = await pg.evaluate(([s, rc]) => window.__sp.run(s, rc), [s, RC]);
      const dr = await pg.evaluate(([s, rc]) => { try { return window.__sp.direct(s, rc); } catch (e) { return { err: e.message }; } }, [s, RC]);
      const d1 = L.sameRows(r.js, r.wasm), d2 = Array.isArray(r.js) ? L.sameRows(r.js, dr) : d1;
      nSpec++; tags.add(s.tag.split(':')[0] + ':' + s.tag.split(':')[1]); if (Array.isArray(r.js)) nNum += r.js.reduce((a, x) => a + x.length, 0);
      if (!d1.ok) bad.push(s.tag + ' JS/WASM ' + d1.why); if (!d2.ok) bad.push(s.tag + ' JS/validation ' + d2.why);
      (await pg.evaluate(([s, rc]) => window.__sp.reads([s], rc), [s, RC])).forEach(p => jsRead.add(p));
    }
    const camAt = specs.filter(s => s.spec).map(s => s.spec.e.cam.checkLift_mm || 'seat');
    ok(!bad.length && specs.some(s => s.spec), c.name + ': ' + specs.filter(s => s.spec).map(s => s.tag).join(', ') + ' (cam at ' + [...new Set(camAt)].join('/') + ') the same to the last digit' + (bad.length ? ': ' + bad.join('; ') : ''));
    if (bad.length) diffs.push(c.name);
    await pg.close();
  }
  console.log('  ' + nSpec + ' specs, ' + nNum + ' numbers compared; kinds ' + [...tags].join(' '));
  const cov = L.coverage([...jsRead].filter(p => !/^ERROR/.test(p)), rust);
  ok(!cov.miss.length, 'every spec path the JavaScript model reads (' + jsRead.size + ') is read by the WebAssembly or on the allow-list' + (cov.miss.length ? ': MISSING ' + cov.miss.join(', ') : ''));
  ok(![...jsRead].some(p => /^ERROR/.test(p)), 'the Proxy runs had no error' + [...jsRead].filter(p => /^ERROR/.test(p)).join(' '));
  // allow-list entries the JavaScript still reads (their spec parts appear only in the sound prediction: read in its source)
  const html = fs.readFileSync(PAGE, 'utf8'), wsrc = html.slice(html.indexOf('function wsFactory(){'), html.indexOf('\nconst WS=wsFactory();'));
  const stale = L.ALLOW.filter(([p]) => { const k = p.split('.').pop().replace(/\[\]$/, ''); return !new RegExp('\\.' + k + '\\b').test(wsrc); });
  ok(!stale.length, 'every allow-list entry is still read by the JavaScript model (' + L.ALLOW.length + ')' + (stale.length ? ': stale ' + stale.map(x => x[0]).join(', ') : ''));

  // ---- 2. refusal
  { const pg = await open(); await apply(pg, {});
    const r = await pg.evaluate(() => { const c = window.__sp.collect()[0], WS = window.__sim.WS, TL = window.__sp.TL(), out = {};
      const mod = { crossover: s => { s.opt = { phases: [0, 360], collectors: [{ cyls: [0], segs: s.exhaust.segs }, { cyls: [1], segs: s.exhaust.segs }], crossover: { type: 'x', pos: [0.1, 0.1] } }; },
        pieces: s => { s.opt = { phases: [0], collector: { segs: [{ L: 0.5, d0: 0.05, d1: 0.05 }], Tw: 650, pieces: [{ x: 0.2, paths: [[{ L: 0.1, d0: 0.03, d1: 0.03 }], [{ L: 0.1, d0: 0.03, d1: 0.03 }]] }] } }; },
        branches: s => { s.opt = { phases: [0], collector: { segs: [{ L: 0.5, d0: 0.05, d1: 0.05 }], Tw: 650, branches: [{ x: 0.2, V: 1e-4, CdA: 1e-4, Le: 0.02 }] } }; },
        dead: s => { s.e.dead = [0]; } };
      for (const k in mod) { const s = JSON.parse(JSON.stringify(c.spec)); mod[k](s); let thr = null; try { TL.rustBackend(s, 0.03).drop(); } catch (e) { thr = e.jsOnly ? 'jsOnly' : e.message; } out[k] = [WS.jsOnly(s).length > 0, thr]; }
      out.plain = [WS.jsOnly(c.spec).length, (() => { try { TL.rustBackend(c.spec, 0.03).drop(); return 'ran'; } catch (e) { return e.message; } })()];
      return out; });
    ok(['crossover', 'pieces', 'branches', 'dead'].every(k => r[k][0] && r[k][1] === 'jsOnly') && r.plain[0] === 0 && r.plain[1] === 'ran',
      'JavaScript-only parts (crossover, pieces, branches, cylinders not firing) are refused by rustSpec, never run without them; the page\'s own spec is not: ' + JSON.stringify(r));
    const src = await pg.evaluate(() => [window.__sim.WS.jsOnly.toString().length > 0, /RW&&!WS\.jsOnly\(v\.spec\)\.length/.test(document.documentElement.innerHTML)]);
    ok(src[1], 'the sweep worker checks WS.jsOnly before the WebAssembly');
    await pg.close(); }

  // ---- 3b. one whole 4-Stroke run from its button, WebAssembly and JavaScript (window.__waveJs): the same results
  { const runIt = async js => { const pg = await open('#four-stroke'); await apply(pg, { camlib: 'ls3', ui: [['f-rpm', '4000']] });
      const n = await pg.evaluate(js => { window.__waveJs = js; const q = window.__sim.inp(); return window.__sim.simRpms(q.tune).length; }, js);
      await pg.click('button[data-sim="run"]');
      await pg.waitForFunction(() => window.__sim.state.status !== 'running', null, { timeout: 600000 });
      const r = await pg.evaluate(() => JSON.parse(JSON.stringify({ st: window.__sim.state.status, res: window.__sim.state.res, rust: null })));
      await pg.close(); return Object.assign(r, { n }); };
    const t1 = Date.now(), A = await runIt(false), B = await runIt(true);
    const flat = R => JSON.stringify((R || []).map(o => [o.key, o.tq, o.tqg, o.ve, o.ov, o.pc]));
    ok(A.st === 'done' && B.st === 'done' && A.res && A.res.length > 0 && flat(A.res) === flat(B.res),
      'the LS3 card (0.050 in) run from the 4-Stroke tab\'s button: the WebAssembly and the JavaScript (window.__waveJs) give the same torque, VE and per-cylinder IMEP at every speed (' + A.res.length + ' designs x ' + A.n + ' speeds, ' + ((Date.now() - t1) / 1000).toFixed(0) + ' s)'); }

  // ---- 4-7. save and load, units, presets, run keys
  let pL = null;
  const SL = [{ name: 'LS3 card', camlib: 'ls3' }, FIXED[4], FIXED[6], FIXED[7], FIXED[8]].concat(L.cases(77, 2));
  for (const c of SL) {
    const pg = await open(); await apply(pg, c);
    const A = await L.pageState(pg), snap = await pg.evaluate(() => JSON.parse(JSON.stringify(window.__proj.snapshot('parity'))));
    // units: imperial and back
    await uiClick(pg, '#u-imp'); const Bi = await L.pageState(pg); await uiClick(pg, '#u-met'); const Bm = await L.pageState(pg);
    const dv = (X, Y) => Object.keys(X.vals).filter(k => JSON.stringify(X.vals[k]) !== JSON.stringify(Y.vals[k]) && !(X.vals[k] && 'v' in X.vals[k] && k === 'v-pick'));
    const du = dv(A, Bi).concat(dv(A, Bm)).filter(k => A.vals[k] && 'b' in A.vals[k]);
    ok(!du.length && JSON.stringify(A.specs) === JSON.stringify(Bi.specs) && JSON.stringify(A.specs) === JSON.stringify(Bm.specs),
      c.name + ': inches and back to mm change no base value and no spec' + (du.length ? ': ' + [...new Set(du)].slice(0, 8).map(k => k + ' ' + JSON.stringify(A.vals[k]) + ' -> ' + JSON.stringify(Bi.vals[k]) + '/' + JSON.stringify(Bm.vals[k])).join(', ') : ''));
    await pg.close();
    // save -> load into a fresh page
    // save -> load: into one page kept on the 4-Stroke tab, each project on top of the one before (the first into a fresh page),
    // read as it stands, without visiting the other tabs (D5: their results were the build before's)
    if (!pL) pL = await open('#four-stroke');
    await pL.evaluate(d => window.__proj.apply(d), snap); const C = await L.pageState(pL, false);
    const dl = dv(A, C), ds = A.specs.map((s, i) => JSON.stringify(s) === JSON.stringify(C.specs[i]) ? null : s.tag).filter(Boolean);
    ok(!dl.length && !ds.length && A.specs.length === C.specs.length && A.key === C.key && A.tkey === C.tkey,
      c.name + ': save, load (on top of the project before, not visiting the other tabs): every saved input (' + Object.keys(A.vals).length + '), every spec (' + A.specs.map(s => s.tag).join(', ') + ') and both run keys the same' +
      (dl.length ? '; inputs ' + dl.slice(0, 8).map(k => k + ' ' + JSON.stringify(A.vals[k]) + ' -> ' + JSON.stringify(C.vals[k])).join(', ') : '') + (ds.length ? '; specs ' + ds.join(', ') : '') + (A.key !== C.key ? '; 4-Stroke key differs' : '') + (A.tkey !== C.tkey ? '; turbo key differs' : ''));
  }
  if (pL) await pL.close();
  // presets: twice, and P -> Q -> P
  for (const [P, Q] of [['K24A2 ', 'LS3 6.2 V8'], ['N54B30', '2.0 L K20A2'], ['S65B40', '7.5 L Classic GM'], ['2.5 TFSI', 'S54B32']]) {
    const pg = await open(); const s1 = await pg.evaluate(P => window.__sp.preset(P), P); const A = await L.pageState(pg);
    await pg.evaluate(P => window.__sp.preset(P), P); const B = await L.pageState(pg);
    const s2 = await pg.evaluate(Q => window.__sp.preset(Q), Q); await pg.evaluate(P => window.__sp.preset(P), P); const C = await L.pageState(pg);
    const d = (X, Y) => Object.keys(X.vals).filter(k => JSON.stringify(X.vals[k]) !== JSON.stringify(Y.vals[k]));
    const dAB = d(A, B), dAC = d(A, C), notKept = dAC.filter(k => !PRESET_KEEPS.test(k));
    ok(s1 && s2 && !dAB.length && JSON.stringify(A.specs) === JSON.stringify(B.specs), P + ' chosen twice: the same inputs and specs' + (dAB.length ? ': ' + dAB.join(', ') : ''));
    ok(s1 && s2 && !notKept.length, P + ', then ' + Q + ', then ' + P + ': only fields the preset does not define keep ' + Q + '\'s values (' + (dAC.join(', ') || 'none') + ')' + (notKept.length ? '; NOT BY THE RULE: ' + notKept.join(', ') : ''));
    await pg.close();
  }
  // run keys: a fuel change that changes the specs changes the key
  { const pg = await open(); await apply(pg, {}); const A = await L.pageState(pg); const bad = [];
    for (const [id, v] of [['i-fuel', 'e85'], ['i-evap', 'di'], ['i-lam', '0.8'], ['i-eth', '70']]) {
      await pg.evaluate(([id, v]) => { document.getElementById('tab-intake').click(); window.__sp.set(id, v); }, [id, v]);
      const B = await L.pageState(pg);
      if (JSON.stringify(A.specs) !== JSON.stringify(B.specs) && A.key === B.key) bad.push(id); A.specs = B.specs; A.key = B.key; }
    ok(!bad.length, 'a fuel, evaporation, lambda or ethanol change that changes the 4-Stroke tab\'s specs changes its run key, so a finished run is shown as stale' + (bad.length ? ': key unchanged after ' + bad.join(', ') : ''));
    await pg.close(); }

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log('  ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  console.log(fails.length ? fails.length + ' FAILED' : 'all passed');
  process.exit(fails.length ? 1 : 0);
})();
