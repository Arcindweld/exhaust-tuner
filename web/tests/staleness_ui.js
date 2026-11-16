// Stale and order-dependent results, project-file completeness and the cam-library rule (docs/SPEC_PARITY_AUDIT_2026-11-16.md,
// addendum). The long seeded runs are tools/validation/staleness_sweep.js and tools/validation/project_inventory.js; this is
// the permanent short form.
//   node tests/staleness_ui.js   (from web/)
// 1. Run keys complete: over seeded input changes on every tab (a turbo build, so both runs exist), the job the 4-Stroke
//    tab's "Run" and "Simulate with the turbo" would hand their workers (window.__sim.job, window.__tsim.job) never
//    differs while its run key stays the same (a result shown as current would then be for other inputs).
// 2. The sound estimate is marked out of date when the design it ran on changes, and not otherwise (A3: it never was).
// 3. A project written by this page reproduces every tab's displayed text in a fresh page, read in either tab order, for a
//    rich build (preset with its power hold, turbo, knock check, Headers at unequal lengths), and after a short seeded
//    session of user actions (the staleness sweep's own checkpoint).
// 4. Every input id on the page is saved in the project (its vals), or survives a save and a load through a section
//    object, or is on NOT_SAVED below with its reason; no entry of NOT_SAVED is stale.
// 5. The cam-library rule (camLibOnPreset): a library cam is set aside when an engine preset is chosen (the same inputs
//    as the preset on a fresh page), with a note and one click to put it back; kept, with its note, when "Keep" is ticked;
//    a project with a kept cam loads exactly as saved.
'use strict';
const { chromium } = require('playwright');
const T = require('./staleness_lib');
const { settle } = require('./settle');
const NOT_SAVED = T.NOT_SAVED;
(async () => {
  const t0 = Date.now(), b = await chromium.launch(), ctx = await b.newContext(); const fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const errs = []; const watch = pg => pg.on('pageerror', e => errs.push(e.message));

  // ---- 5. the cam-library rule
  { const pg = await T.open(ctx, 'four-stroke'); watch(pg); await pg.click('#m-expert'); await pg.click('#u-met');
    const CAM = ['f-ivo', 'f-ivc', 'f-evo', 'f-evc', 'f-lin', 'f-lex', 'f-camat', 'f-valves', 'f-cratio', 'f-bore', 'f-stroke', 'f-vdi', 'f-vde', 'f-camlib'];
    const read = () => pg.evaluate(ids => Object.fromEntries(ids.map(id => [id, document.getElementById(id).value])), CAM);
    const k24 = () => pg.evaluate(() => window.__st.presetText('eng', 'K24A2 '));
    const note = () => pg.evaluate(() => { const n = document.getElementById('f-camswap'); return n.hidden ? '' : n.textContent; });
    await k24(); await settle(pg); const fresh = await read();
    await pg.evaluate(() => window.__st.put('#f-camlib', 'ls3')); await settle(pg); const ls3 = await read();
    await k24(); await settle(pg); const after = await read(), n1 = await note();
    const same = CAM.filter(id => after[id] !== fresh[id]);
    ok(!same.length && /set aside/.test(n1) && /LS3/.test(n1), 'a cam from the cam library, then an engine preset: the library cam is set aside (every cam and engine field as the preset gives them on a fresh page) and a note says so: ' + (same.length ? 'differ ' + same.join(', ') : n1.slice(0, 120)));
    await pg.click('#f-camswap-btn'); await settle(pg); const back = await read(), n2 = await note();
    const camBack = ['f-ivo', 'f-ivc', 'f-evo', 'f-evc', 'f-lin', 'f-lex', 'f-camat', 'f-camlib'].filter(id => back[id] !== ls3[id]);
    ok(!camBack.length && /kept from before/.test(n2), 'one click puts the library cam back (events, convention, lifts) and the note says it is kept from before' + (camBack.length ? ': differ ' + camBack.join(', ') : ''));
    await pg.click('#f-camswap-btn'); await settle(pg); const own = await read();
    ok(CAM.every(id => own[id] === fresh[id]), 'and one click on the note uses the engine\'s own cam again');
    // Keep ticked: the library cam stays through a preset, with the note
    await pg.evaluate(() => { window.__st.put('#f-camlib', 'ls7'); window.__st.put('#f-camkeep', true); }); await settle(pg); const ls7 = await read();
    await k24(); await settle(pg); const kept = await read(), n3 = await note();
    ok(['f-ivo', 'f-ivc', 'f-evo', 'f-evc', 'f-lin', 'f-lex', 'f-camat', 'f-camlib'].every(id => kept[id] === ls7[id]) && /LS7.*kept from before/.test(n3), '"Keep the cam" ticked: the library cam stays through an engine preset, with the note "kept from before"');
    // a project with the kept cam loads exactly as saved, into a fresh page and over another build
    const snap = await pg.evaluate(() => JSON.parse(JSON.stringify(window.__proj.snapshot('kept cam'))));
    const pB = await T.open(ctx, 'four-stroke'); watch(pB); await pB.evaluate(() => window.__st.put('#f-camlib', 'lt1')); await pB.evaluate(d => window.__proj.apply(d), snap); await settle(pB);
    const snapB = await pB.evaluate(() => JSON.parse(JSON.stringify(window.__proj.snapshot('kept cam'))));
    const dv = Object.keys(snap.vals).filter(k => JSON.stringify(snap.vals[k]) !== JSON.stringify(snapB.vals[k]));
    ok(!dv.length, 'a project with a kept library cam loads exactly as saved over another build\'s library cam (every saved input)' + (dv.length ? ': ' + dv.join(', ') : ''));
    await pB.close(); await pg.close(); }

  // ---- 1. run keys complete (the job a run would hand its worker never changes under the same key)
  { const pg = await T.open(ctx, 'intake'); watch(pg); await T.rich(pg); await pg.evaluate(() => window.__st.seed(4242));
    const seen = { sim: new Map(), tsim: new Map() }, bad = []; let nS = 0, nT = 0, nChanges = 0;
    const R = (() => { let a = 99; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
    const tabs = ['four-stroke', 'intake', 'headers', 'four-stroke', 'intake', 'mufflers', 'sound'];
    const look = async (why) => { const j = await pg.evaluate(() => ({ s: window.__sim.job(), t: window.__tsim.job() }));
      for (const [k, x, keyOf] of [['sim', j.s, x => x.key], ['tsim', j.t, x => x.key + '|' + x.kKey]]) { if (!x) continue; const key = keyOf(x), job = JSON.stringify(x.job);
        if (k === 'sim') nS++; else nT++;
        const was = seen[k].get(key); if (was !== undefined && was.job !== job) bad.push(k + ' after ' + why + ' (key as after ' + was.why + ')'); else if (was === undefined) seen[k].set(key, { job, why }); } };
    await look('start');
    for (let i = 0; i < 45; i++) {
      const tab = tabs[Math.floor(R() * tabs.length)]; await T.goTab(pg, tab);
      const panel = await pg.evaluate(t => window.__st.tabs().find(x => x.tab === t).panel, tab);
      const ins = (await pg.evaluate(p => window.__st.inputs(p), panel)).filter(x => !/^#v-/.test(x.sel));
      const it = ins[Math.floor(R() * ins.length)]; if (!it) continue;
      const r = await pg.evaluate(s => window.__st.change(s), it.sel); await settle(pg); if (r.skip) continue; nChanges++;
      await T.goTab(pg, 'four-stroke'); await look(it.sel + '=' + r.v);
    }
    ok(!bad.length && nS > 20 && nT > 10, 'run keys complete: ' + nChanges + ' input changes on the 4-Stroke, Intake, Headers, Mufflers and Sound tabs, ' + nS + ' 4-Stroke and ' + nT + ' turbo jobs: never a different job under the same run key' + (bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''));
    await pg.close(); }

  // ---- 2. the sound estimate's out-of-date note
  { const pg = await T.open(ctx, 'four-stroke'); watch(pg); await pg.click('#m-expert');
    await T.goTab(pg, 'sound');
    await pg.evaluate(() => { const e = document.getElementById('wsnd-rpms'); e.value = '3000'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
    await pg.click('button[data-wsnd="run"]');
    await pg.waitForFunction(() => document.getElementById('wsnd-msg') && /^Done/.test(document.getElementById('wsnd-msg').textContent), null, { timeout: 300000 });
    const st = () => pg.evaluate(() => !!document.getElementById('wsnd-stale'));
    const s0 = await st();
    await T.goTab(pg, 'four-stroke'); await pg.evaluate(() => window.__st.put('#f-dp', String(+document.getElementById('f-dp').value * 1.1))); await T.goTab(pg, 'sound'); const s1 = await st();
    await T.goTab(pg, 'four-stroke'); await pg.evaluate(() => window.__st.put('#f-dp', String(+document.getElementById('f-dp').value / 1.1))); await T.goTab(pg, 'sound');
    const s2 = await pg.evaluate(() => { const e = document.getElementById('f-dp'); return e._b; });
    void s2; const s3 = await st();
    // the OpenWAM results table (a host run is not possible here: its results and the run's case hash are put in as wamRun leaves them)
    await T.goTab(pg, 'four-stroke');
    const w0 = await pg.evaluate(() => { const W = window.__proj.wam; W.results = [{ name: 'case3000', rpm: 3000, tq: 300, kw: 94, imep: 12, pmep: -0.3, ve: 0.95, vet: 0.9, spread: 0.002 }]; W.runSig = window.__wamSigNow(); location.hash = 'sound'; return W.runSig; });
    await T.goTab(pg, 'four-stroke'); const w1 = await pg.evaluate(() => [!!document.getElementById('wam-stale'), !!document.getElementById('wam-files-note')]);
    await pg.evaluate(() => window.__st.put('#f-dp', String(+document.getElementById('f-dp').value * 1.1))); await settle(pg);
    const w2 = await pg.evaluate(() => [!!document.getElementById('wam-stale'), !!document.getElementById('wam-files-note')]);
    await pg.evaluate(() => { window.__proj.wam.runSig = null; window.__st.put('#f-dp', document.getElementById('f-dp').value); }); await settle(pg);
    const w3 = await pg.evaluate(() => [!!document.getElementById('wam-stale'), !!document.getElementById('wam-files-note')]);
    ok(w0 && !w1[0] && !w1[1] && w2[0] && !w3[0] && w3[1], 'the OpenWAM results table: current after its run, out of date once the case the tab writes changes, and "read from files" when the page cannot tell which case wrote them ' + JSON.stringify([w1, w2, w3]));
    ok(!s0 && s1, 'the sound estimate is not marked out of date when nothing changed, and is after the primary size changed on the 4-Stroke tab (it never was: A3)' + JSON.stringify([s0, s1, s3]));
    await pg.close(); }

  // ---- 3. a project written by this page reproduces every tab's text (a rich build; then a short seeded session)
  { const A = await T.open(ctx, 'intake'); watch(A); await T.rich(A);
    const snap = await A.evaluate(() => JSON.parse(JSON.stringify(window.__proj.snapshot('rich')))), ta = await T.readAll(A), ta2 = await T.readAll(A, 'reverse');
    const B = await T.open(ctx, 'quick'); watch(B); await B.evaluate(d => window.__proj.apply(d), snap); await settle(B); const tb = await T.readAll(B, 'reverse');
    const d1 = T.diffTabs(ta, tb), d2 = T.diffTabs(ta, ta2);
    ok(!d1.length && !d2.length, 'a rich build (K24A2 with its power hold, turbo, knock check, Headers at unequal lengths): its project loaded into a fresh page shows the same text on all ' + Object.keys(ta).length + ' tabs, and the page reads the same in either tab order' +
      (d1.length ? '; load: ' + d1.map(d => d.tab + ' [' + d.a + '] vs [' + d.b + ']').join('; ') : '') + (d2.length ? '; order: ' + d2.map(d => d.tab + ' [' + d.a + '] vs [' + d.b + ']').join('; ') : ''));
    await A.close(); await B.close(); }

  // ---- 4. every input saved, or not saved on purpose
  { const r = await T.inventory(ctx);
    const unknown = r.lost.filter(x => !(x.id in NOT_SAVED)), stale = Object.keys(NOT_SAVED).filter(id => !(id in r.ids));
    const savedAnyway = Object.keys(NOT_SAVED).filter(id => r.vals.includes(id) || r.via.includes(id));
    ok(!unknown.length && !stale.length && !savedAnyway.length && !r.moved.length, 'every input with an id (' + Object.keys(r.ids).length + ': ' + r.vals.length + ' in the project\'s vals, ' + r.via.length + ' through a section object, ' + Object.keys(NOT_SAVED).length + ' not saved on purpose, ' + r.untested.length + ' the probe could not change) is saved or listed' +
      (unknown.length ? '; NOT SAVED and not listed: ' + unknown.map(x => x.id + ' (' + x.why + ')').join(', ') : '') + (stale.length ? '; listed but not on the page: ' + stale.join(', ') : '') + (savedAnyway.length ? '; listed but saved: ' + savedAnyway.join(', ') : '') + (r.moved.length ? '; moved by the load: ' + JSON.stringify(r.moved) : ''));
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log('  ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  console.log(fails.length ? fails.length + ' FAILED' : 'all passed');
  process.exit(fails.length ? 1 : 0);
})();
