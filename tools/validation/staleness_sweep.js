// The stale-result hunt over the whole page (docs/SPEC_PARITY_AUDIT_2026-11-16.md, addendum A3). Sessions of seeded user
// actions on one page A (a random tab, a random visible input there changed; now and then an engine preset or vehicle, the
// unit toggle, Simple/Expert, a project saved and loaded back into the same page, a "Use" button, a look at another tab),
// and every `every` actions a checkpoint: every tab's text in A against a fresh page B given A's project from scratch, and
// against A itself read again in the reverse tab order (a result that depends on which tab was visited before).
//   node tools/validation/staleness_sweep.js [seeds=1-10] [n=40] [every=10] [out=file]
//   node tools/validation/staleness_sweep.js replay=SEED upto=K [out=file]   (replays the recorded actions 1..K of a session
//        from the results file, then one checkpoint: to bisect a difference)
// Resumable: a session's result is written when it ends (results/staleness_sweep.json); a rerun skips the sessions done.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..');
const T = require(path.join(ROOT, 'web', 'tests', 'staleness_lib.js'));
const { settle } = require(path.join(ROOT, 'web', 'tests', 'settle.js'));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const PAGE = path.join(ROOT, 'web', 'index.html');
const OUT = args.out || path.join(__dirname, 'wave', 'results', 'staleness_sweep.json');
const save = db => { fs.writeFileSync(OUT + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(OUT + '.tmp', OUT); };
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

async function open(ctx, hash) {
  const pg = await ctx.newPage({ viewport: { width: 1280, height: 900 } }); pg._errs = []; pg.on('pageerror', e => pg._errs.push(e.message));
  await pg.goto('file://' + PAGE + '#' + (hash || 'quick')); await pg.waitForTimeout(500); await T.install(pg); await settle(pg); return pg;
}
// one action: drawn (R given) or replayed (act given); returns the action as recorded
async function act(pg, R, rec) {
  const tabs = await pg.evaluate(() => window.__st.tabs());
  const k = rec ? rec.k : (x => x < 0.06 ? 'preset' : x < 0.09 ? 'units' : x < 0.12 ? 'mode' : x < 0.14 ? 'reload' : x < 0.19 ? 'use' : 'in')(R());
  const tab = rec ? rec.tab : tabs[Math.floor(R() * tabs.length)].tab, panel = tabs.find(t => t.tab === tab).panel;
  const a = { k, tab };
  if (k === 'preset') { await T.goTab(pg, tab); const mode = rec ? rec.mode : R() < 0.7 ? 'eng' : 'veh', x = rec ? rec.v : null;
    a.mode = mode; a.v = rec ? (await pg.evaluate(([m, v]) => window.__st.presetPut(m, v), [mode, x]), x) : await pg.evaluate(([m, r]) => window.__st.preset(m, r), [mode, R()]); }
  else if (k === 'units') { const u = rec ? rec.v : (await pg.evaluate(() => document.getElementById('u-imp').getAttribute('aria-pressed') === 'true')) ? 'met' : 'imp'; a.v = u; await pg.click('#u-' + u); }
  else if (k === 'mode') { const m = rec ? rec.v : (await pg.evaluate(() => document.body.classList.contains('simple'))) ? 'expert' : 'simple'; a.v = m; await pg.click('#m-' + m); }
  else if (k === 'reload') { await pg.evaluate(() => window.__proj.apply(JSON.parse(JSON.stringify(window.__proj.snapshot('roundtrip'))))); }
  else if (k === 'use') { await T.goTab(pg, tab); const us = await pg.evaluate(p => window.__st.uses(p), panel);
    if (!us.length && !rec) { a.skip = 'no Use button'; return a; }
    a.sel = rec ? rec.sel : us[Math.floor(R() * us.length)]; a.ok = await pg.evaluate(s => window.__st.click(s), a.sel); }
  else { await T.goTab(pg, tab);
    if (rec) { a.sel = rec.sel; a.v = rec.v; a.ok = await pg.evaluate(([s, v]) => window.__st.put(s, v), [rec.sel, rec.v]); }
    else { const ins = await pg.evaluate(p => window.__st.inputs(p), panel); if (!ins.length) { a.skip = 'no inputs'; return a; }
      for (let t = 0; t < 6; t++) { const it = ins[Math.floor(R() * ins.length)]; const r = await pg.evaluate(s => window.__st.change(s), it.sel); if (!r.skip) { a.sel = r.sel; a.v = r.v; break; } }
      if (a.sel === undefined) { a.skip = 'nothing changeable picked'; return a; } } }
  await settle(pg);
  // a look at another tab now and then (a result read after an input changed elsewhere)
  if (rec ? rec.look : R() < 0.4) { const lt = rec ? rec.look : tabs[Math.floor(R() * tabs.length)].tab; a.look = lt; await T.goTab(pg, lt); }
  return a;
}
async function checkpoint(ctx, pg) {
  const snap = await pg.evaluate(() => JSON.parse(JSON.stringify(window.__proj.snapshot('checkpoint'))));
  const A = await T.readAll(pg), A2 = await T.readAll(pg, 'reverse');
  const B = await open(ctx, snap.tab || 'quick'); await B.evaluate(d => window.__proj.apply(d), snap); await settle(B);
  const Bt = await T.readAll(B), errs = B._errs.slice(); await B.close();
  return { load: T.diffTabs(A, Bt), order: T.diffTabs(A, A2), errsB: errs, tabsRead: Object.keys(A).length };
}
(async () => {
  const db = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { sessions: {} };
  const b = await chromium.launch(), t0 = Date.now();
  if (args.replay) {
    const S = db.sessions[args.replay]; if (!S) throw new Error('no session ' + args.replay);
    const ctx = await b.newContext(), pg = await open(ctx); const upto = +(args.upto || S.actions.length);
    for (const a of S.actions.slice(0, upto)) { if (a.skip) continue; await act(pg, null, a); }
    const c = await checkpoint(ctx, pg); console.log(JSON.stringify(c, null, 1)); await b.close(); return;
  }
  const [s0, s1] = (args.seeds || '1-10').split('-').map(Number), n = +(args.n || 40), every = +(args.every || 10);
  for (let seed = s0; seed <= (s1 || s0); seed++) {
    if (db.sessions[seed] && db.sessions[seed].done) continue;
    const ctx = await b.newContext(), pg = await open(ctx), R = rng(seed);
    await pg.evaluate(s => window.__st.seed(s), seed);
    const S = { seed, actions: [], checks: [], done: false }; const t1 = Date.now();
    for (let i = 1; i <= n; i++) {
      let a; try { a = await act(pg, R, null); } catch (e) { a = { err: String(e.message || e).slice(0, 200) }; }
      S.actions.push(a);
      if (i % every === 0 || i === n) { const c = await checkpoint(ctx, pg); c.step = i; c.errsA = pg._errs.slice(); S.checks.push(c);
        console.log('seed ' + seed + ' step ' + i + ': load ' + (c.load.length ? 'DIFF ' + c.load.map(d => d.tab + ' (' + d.lines + ' lines) [' + d.a.slice(0, 90) + '] vs [' + d.b.slice(0, 90) + ']').join('; ') : 'same') +
          ' | order ' + (c.order.length ? 'DIFF ' + c.order.map(d => d.tab + ' [' + d.a.slice(0, 80) + '] vs [' + d.b.slice(0, 80) + ']').join('; ') : 'same') + (c.errsA.length || c.errsB.length ? ' PAGEERR ' + c.errsA.concat(c.errsB).join(' | ').slice(0, 200) : '')); }
    }
    S.done = true; S.seconds = (Date.now() - t1) / 1000; db.sessions[seed] = S; save(db); await ctx.close();
    console.log('seed ' + seed + ' done: ' + S.actions.filter(a => !a.skip && !a.err).length + ' changes in ' + S.seconds.toFixed(0) + ' s');
  }
  await b.close();
  const all = Object.values(db.sessions); db.sum = { sessions: all.length, changes: all.reduce((s, x) => s + x.actions.filter(a => !a.skip && !a.err).length, 0),
    crossTab: all.reduce((s, x) => s + x.actions.filter(a => a.look && a.look !== a.tab).length, 0), checks: all.reduce((s, x) => s + x.checks.length, 0),
    loadDiffs: all.reduce((s, x) => s + x.checks.filter(c => c.load.length).length, 0), orderDiffs: all.reduce((s, x) => s + x.checks.filter(c => c.order.length).length, 0), seconds: (Date.now() - t0) / 1000 };
  save(db); console.log(JSON.stringify(db.sum));
})();
