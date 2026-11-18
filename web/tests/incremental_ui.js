// The differential guard of the field-edit speed work (2026-11-18, docs/PERF_2026-11-18.md).   node tests/incremental_ui.js
// A render now writes its HTML in place (setHTML: only what changed is touched, the rest of the tab's nodes are kept). The
// rule it must keep: the page after any sequence of such updates is the page a full re-render would give. Two pages in
// lockstep, each in its own browser context (its own stored folds and hints):
//   A  the page as it is (setHTML in place)
//   B  the same page with window.__fullWrites set before it loads: every write is the plain innerHTML it was before
// A turbo build (Honda K24A2, Turbocharged), then seeded user actions, most of them on the three heaviest tabs (Hangers,
// the boosted Intake tab, Mufflers), the rest on the others: a visible input changed as a user would (staleness_lib's
// change: in the units shown, a select to another option, now and then blanked), a section folded or opened by its
// heading, Expand all / Collapse all, the unit toggle, Simple/Expert, a "Use" button, an engine preset, a look at another
// tab. The action is made in A and repeated exactly in B (same element, same value). After each: both settled and their
// idle passes run, then every panel's textContent AND innerHTML (all 13, hidden ones too) and the vehicle bar compared,
// and the state of every field in them (value, checked, the option chosen: not in the HTML);
// any difference fails with the panel and the first differing characters. No ids are generated per render (the folds'
// and hints' ids are worked out from the section and the field), so nothing is normalised.
// Also checked: A really did write in place (patched and unchanged writes counted by window.__shStat), and neither page
// had a page error.
//   N=… (actions, default 260) SEED=… (default 7) for a longer local run; tools/validation/incremental_sweep.js runs seeds.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const { settle, uiClick } = require('./settle');
const T = require('./staleness_lib');
const PAGE = path.join(__dirname, '..', 'index.html');
let N = +(process.env.N || 260), SEED = +(process.env.SEED || 7);
const HEAVY = ['hangers', 'intake', 'mufflers'];

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// everything the page shows: per panel its textContent and innerHTML (hashed in the page; the strings are fetched only to
// report a difference), after the render has settled and the idle passes (the quieter units) have run
const SNAP = async fsrc => { const FIELDS = (0, eval)('(' + fsrc + ')');
  await new Promise(r => (window.requestIdleCallback || setTimeout)(r, { timeout: 600 })); await new Promise(r => setTimeout(r, 30));
  await new Promise(r => (window.requestIdleCallback || setTimeout)(r, { timeout: 600 }));
  const h = s => { let a = 0x811c9dc5, b = 0x01000193 ^ s.length; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 16777619); b = Math.imul(b + c, 2246822519) ^ (b >>> 13); } return (a >>> 0).toString(36) + (b >>> 0).toString(36) + ':' + s.length; };
  const out = {};
  for (const p of [...document.querySelectorAll('[role=tabpanel]'), document.getElementById('vbar')]) {
    const id = p.id || p.className; out[id + ' text'] = h(p.textContent); out[id + ' html'] = h(p.innerHTML);
    out[id + ' fields'] = h(FIELDS(p)); }
  return out;
};
// the fields' state, which the HTML does not carry: value, checked, the option chosen
const FIELDS = p => [...p.querySelectorAll('input, select, textarea')].map(e => (e.id || e.name || e.dataset.k || e.tagName) + '=' + (e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.tagName === 'SELECT' ? e.selectedIndex + ':' + e.value : e.value)).join('\n');
const PART = ([id, kind, fsrc]) => { const p = document.getElementById(id); return kind === 'text' ? p.textContent : kind === 'fields' ? (0, eval)('(' + fsrc + ')')(p) : p.innerHTML; };

(async () => {
  const b = await chromium.launch();
  const fails = [], errs = [];
  const mk = async full => { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    if (full) await ctx.addInitScript(() => { window.__fullWrites = true; });
    const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push((full ? 'B: ' : 'A: ') + e.message));
    await pg.goto('file://' + PAGE + '#quick'); await pg.waitForTimeout(500); await T.install(pg); await settle(pg); return pg; };
  const A = await mk(false), B = await mk(true), both = [A, B];
  const each = async f => { for (const pg of both) { await f(pg); await settle(pg); } };
  // the turbo build
  await each(pg => pg.evaluate(() => window.__st.presetText('eng', 'K24A2 ')));
  await each(pg => T.goTab(pg, 'intake'));
  await each(pg => pg.evaluate(() => { const e = document.getElementById('i-ind'); e.value = 'turbo'; e.dispatchEvent(new Event('change', { bubbles: true })); }));
  const R = rng(SEED), tabs = await A.evaluate(() => window.__st.tabs()), count = {};
  let checks = 0;
  const compare = async (i, what) => {
    const [x, y] = [await A.evaluate(SNAP, FIELDS.toString()), await B.evaluate(SNAP, FIELDS.toString())]; checks++;
    const bad = Object.keys(x).filter(k => x[k] !== y[k]);
    if (!bad.length) return true;
    const k = bad[0], sp = k.lastIndexOf(' '), key = [k.slice(0, sp), k.slice(sp + 1), FIELDS.toString()];
    const [sa, sb] = [await A.evaluate(PART, key), await B.evaluate(PART, key)]; let j = 0; while (j < sa.length && sa[j] === sb[j]) j++;
    fails.push('after action ' + i + ' (' + what + '): ' + bad.join(', ') + ' differ; first at ' + j + ':\n    in place: …' + sa.slice(Math.max(0, j - 150), j + 150) + '\n    full:     …' + sb.slice(Math.max(0, j - 150), j + 150));
    return false;
  };
  if (!await compare(0, 'the turbo build')) N = 0;
  for (let i = 1; i <= N && fails.length < 3; i++) {
    const tab = R() < 0.72 ? HEAVY[Math.floor(R() * HEAVY.length)] : tabs[Math.floor(R() * tabs.length)].tab, panel = tabs.find(t => t.tab === tab).panel;
    const x = R(), kind = x < 0.06 ? 'fold' : x < 0.08 ? 'foldall' : x < 0.1 ? 'units' : x < 0.12 ? 'mode' : x < 0.16 ? 'use' : x < 0.18 ? 'preset' : x < 0.24 ? 'look' : 'in';
    await each(pg => T.goTab(pg, tab));
    let what = kind + ' on ' + tab;
    if (kind === 'fold') {
      const n = await A.evaluate(p => document.getElementById(p).querySelectorAll('.sec > h3 > .fbtn').length, panel); if (!n) continue;
      const k = Math.floor(R() * n); what += ' #' + k;
      await each(pg => pg.evaluate(([p, k]) => document.getElementById(p).querySelectorAll('.sec > h3 > .fbtn')[k].click(), [panel, k]));
    } else if (kind === 'foldall') {
      const v = R() < 0.5 ? '1' : '0'; what += ' ' + v;
      await each(pg => pg.evaluate(([p, v]) => { const b = document.getElementById(p).querySelector('.foldbar button[data-fold="' + v + '"]'); if (b) b.click(); }, [panel, v]));
    } else if (kind === 'units') {
      const u = (await A.evaluate(() => document.getElementById('u-imp').getAttribute('aria-pressed') === 'true')) ? 'met' : 'imp'; what += ' ' + u;
      await each(pg => uiClick(pg, '#u-' + u));
    } else if (kind === 'mode') {
      const m = (await A.evaluate(() => document.body.classList.contains('simple'))) ? 'expert' : 'simple'; what += ' ' + m;
      await each(pg => uiClick(pg, '#m-' + m));
    } else if (kind === 'use') {
      const us = await A.evaluate(p => window.__st.uses(p), panel); if (!us.length) continue;
      const sel = us[Math.floor(R() * us.length)]; what += ' ' + sel;
      await each(pg => pg.evaluate(s => window.__st.click(s), sel));
    } else if (kind === 'preset') {
      const r = R(), v = await A.evaluate(r => window.__st.preset('eng', r), r); what += ' ' + v; await settle(A);
      await B.evaluate(v => window.__st.presetPut('eng', v), v); await settle(B);
    } else if (kind === 'look') {
      const t2 = tabs[Math.floor(R() * tabs.length)].tab; what += ' then ' + t2; await each(pg => T.goTab(pg, t2));
    } else {
      const ins = await A.evaluate(p => window.__st.inputs(p), panel); if (!ins.length) continue;
      const pick = ins[Math.floor(R() * ins.length)], seed = Math.floor(R() * 1e9);
      const r = await A.evaluate(([s, seed]) => { window.__st.seed(seed); return window.__st.change(s); }, [pick.sel, seed]); await settle(A);
      if (r.skip) { await B.evaluate(([s, seed]) => { window.__st.seed(seed); return window.__st.change(s); }, [pick.sel, seed]); await settle(B); }
      else { await B.evaluate(([s, v]) => window.__st.put(s, v), [r.sel, r.v]); await settle(B); }
      what += ' ' + r.sel + ' = ' + JSON.stringify(r.v === undefined ? r.skip : r.v);
    }
    count[kind] = (count[kind] || 0) + 1;
    await compare(i, what);
  }
  const st = await A.evaluate(() => window.__shStat), stB = await B.evaluate(() => window.__shStat);
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
  console.log('actions:', JSON.stringify(count), 'checks:', checks, 'writes in A:', JSON.stringify(st), 'in B:', JSON.stringify(stB));
  ok(fails.length === 0 || !fails.some(f => f.startsWith('after')), 'in place = in full: every panel\'s textContent and innerHTML after each of ' + checks + ' checks' + (fails.length ? '\n  ' + fails.join('\n  ') : ''));
  ok(st.patch > 50 && st.same > 50, 'the page wrote in place (' + st.patch + ' patched, ' + st.same + ' unchanged, ' + st.full + ' in full)');
  ok(stB.patch === 0 && stB.same === 0, 'the full page wrote every time in full');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails.length ? '\nFAILED' : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
