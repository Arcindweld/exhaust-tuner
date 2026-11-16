// Shared by staleness_ui.js and tools/validation/staleness_sweep.js (docs/SPEC_PARITY_AUDIT_2026-11-16.md, addendum A3):
// the stale-result hunt. Not a test itself (tools/run_all_tests.py NOT_TESTS).
//
// The class of defect: a result on screen that does not correspond to the inputs on screen (D3: a run key without the
// fuel; D5: the 4-Stroke tab simulating the Headers layout and boost of the build before). The check is generic: a page A
// is driven like a user (a random tab, a random visible input there changed, now and then an engine preset, the unit
// toggle, Simple/Expert, a cam from the cam library, a project saved and loaded back, a "Use" button), and at checkpoints
// every tab's displayed text is compared with a fresh page B that was given A's final inputs from scratch (A's project
// snapshot loaded into a new page). Any difference is a stale or order-dependent result, or an input the project does not
// carry; the action list is recorded so a difference can be replayed and bisected.
//
//   PAGE_SRC            in-page helpers (window.__st): the tabs, the visible inputs of a tab, one user change, a tab's text
//   readAll(pg, order)  every tab's displayed text (each tab visited, its render settled), in that order
//   diffTabs(A, B)      the tabs whose text differs, with the first differing lines
//   actions(seed, n)    not needed: actions are drawn in the page from a seeded generator so they fit the inputs present
'use strict';
const { settle } = require('./settle');

const PAGE_SRC = function () {
  const ST = {};
  // a small seeded generator (mulberry32), state kept here so the sequence survives across evaluate calls
  ST.seed = s => { ST._a = s >>> 0; };
  ST.r = () => { let a = ST._a = (ST._a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  ST.tabs = () => [...document.querySelectorAll('.tabs button[data-tab]')].map(b => ({ tab: b.dataset.tab, panel: b.getAttribute('aria-controls') }));
  // a selector that finds the element again after a re-render: its id, or panel + tag + class + data-k (+ index)
  ST.selOf = el => {
    if (el.id) return '#' + CSS.escape(el.id);
    const p = el.closest('section[id^="panel-"]'), cls = [...el.classList].map(c => '.' + CSS.escape(c)).join(''), dk = el.dataset.k ? '[data-k="' + el.dataset.k + '"]' : '';
    const base = (p ? '#' + p.id + ' ' : '') + el.tagName.toLowerCase() + cls + dk, all = [...document.querySelectorAll(base)];
    return base + (all.length > 1 ? '@' + all.indexOf(el) : '');
  };
  // an input by its inventory key: its id, or (no id) the selector selOf gave
  ST.inp = k => { if (/^#panel-/.test(k)) return ST.find(k); const q = '#' + CSS.escape(k); return document.querySelector('input' + q + ', select' + q + ', textarea' + q); };
  ST.find = sel => { const m = /^(.*)@(\d+)$/.exec(sel); if (m) return document.querySelectorAll(m[1])[+m[2]] || null; return document.querySelector(sel); };
  const visible = el => !!(el.offsetParent || el.getClientRects().length) && !el.disabled;
  // the inputs a user can change on the tab now shown (the vehicle picker above the tabs too)
  ST.inputs = panel => {
    const root = document.getElementById(panel), list = [...root.querySelectorAll('input, select, textarea')];
    if (panel !== 'panel-quick') list.push(...document.querySelectorAll('#v-mode, #v-class, #v-make, #v-pick'));
    return list.filter(el => visible(el) && !/^(file|password|hidden|button|submit|range|color)$/.test(el.type) && !el.closest('dialog'))
      .map(el => ({ sel: ST.selOf(el), tag: el.tagName, type: el.type, kind: el.dataset.kind || '', id: el.id || '' }));
  };
  const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
  // one user change of the element: a select to another option, a checkbox toggled, a number scaled 0.75 to 1.25 (or
  // blanked now and then), a text of numbers scaled; typed in the units shown, so the page reads it back as a user's
  ST.change = sel => {
    const el = ST.find(sel); if (!el) return { sel, skip: 'gone' };
    const r = ST.r();
    if (el.tagName === 'SELECT') {
      const ops = [...el.options].filter(o => !o.disabled && o.value !== el.value); if (!ops.length) return { sel, skip: 'one option' };
      const o = ops[Math.floor(r * ops.length)]; el.value = o.value; fire(el, 'input'); fire(el, 'change'); return { sel, v: o.value };
    }
    if (el.type === 'checkbox') { el.checked = !el.checked; fire(el, 'input'); fire(el, 'change'); return { sel, v: el.checked }; }
    const t = el.value.trim();
    if (el.type === 'number' || el.dataset.kind) {
      if (t === '' || !Number.isFinite(+t)) return { sel, skip: 'blank' };
      let v;
      if (r < 0.08) v = '';
      else { const x = +t * (0.75 + 0.5 * ST.r()); v = String(Math.abs(x) >= 100 ? Math.round(x) : Math.abs(x) >= 1 ? +x.toFixed(2) : +x.toPrecision(3)); if (+t === 0) v = String(Math.round(ST.r() * 10)); }
      el.value = v; fire(el, 'input'); fire(el, 'change'); return { sel, v };
    }
    if (/\d/.test(t)) { const f = 0.8 + 0.4 * r; const v = t.replace(/\d+(\.\d+)?/g, m => String(Math.round(+m * f))); el.value = v; fire(el, 'input'); fire(el, 'change'); return { sel, v }; }
    return { sel, skip: 'text' };
  };
  // replay a recorded change exactly
  ST.put = (sel, v) => { const el = ST.find(sel); if (!el) return false;
    if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
    fire(el, 'input'); fire(el, 'change'); return true; };
  // the buttons on a tab that fill inputs from a result (data-use, data-sel): a user's "Use this"
  ST.uses = panel => [...document.getElementById(panel).querySelectorAll('button[data-use], button[data-sel]')].filter(visible).map(ST.selOf);
  ST.click = sel => { const b = ST.find(sel); if (!b) return false; b.click(); return true; };
  // an engine preset from the engine list (index drawn from r) or a vehicle
  ST.preset = (mode, r) => { const m = document.getElementById('v-mode'); if (m.value !== mode) { m.value = mode; fire(m, 'change'); }
    const ops = [...document.getElementById('v-pick').options].filter(o => o.value !== ''); const o = ops[Math.floor(r * ops.length)];
    const p = document.getElementById('v-pick'); p.value = o.value; fire(p, 'change'); return o.value; };
  ST.presetText = (mode, pre) => { const m = document.getElementById('v-mode'); if (m.value !== mode) { m.value = mode; fire(m, 'change'); }
    const o = [...document.getElementById('v-pick').options].find(o => o.text.startsWith(pre)); if (!o) return null; ST.presetPut(mode, o.value); return o.value; };
  ST.presetPut = (mode, v) => { const m = document.getElementById('v-mode'); if (m.value !== mode) { m.value = mode; fire(m, 'change'); } const p = document.getElementById('v-pick'); p.value = v; fire(p, 'change'); return true; };
  // a tab's displayed text: the panel's rendered text (input values are not in it), with the lines that are by nature
  // time-dependent left out (none known so far; listed here when found)
  ST.text = panel => document.getElementById(panel).innerText;
  window.__st = ST;
};

async function install(pg) { await pg.evaluate('(' + PAGE_SRC.toString() + ')()'); }
async function goTab(pg, tab) {
  await pg.evaluate(t => { if (location.hash !== '#' + t) location.hash = t; }, tab);
  await pg.waitForFunction(t => document.body.dataset.tab === t, tab, { timeout: 10000 }).catch(() => {});
  await settle(pg);
}
async function readAll(pg, order) {
  const tabs = await pg.evaluate(() => window.__st.tabs()), out = {};
  const seq = order === 'reverse' ? tabs.slice().reverse() : tabs;
  for (const t of seq) { await goTab(pg, t.tab); out[t.tab] = await pg.evaluate(p => window.__st.text(p), t.panel); }
  return out;
}
function diffTabs(A, B) {
  const out = [];
  for (const k of Object.keys(A)) {
    if (A[k] === B[k]) continue;
    const a = (A[k] || '').split('\n'), b = (B[k] || '').split('\n'); let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    let n = 0; for (let j = 0; j < Math.max(a.length, b.length); j++) if (a[j] !== b[j]) n++;
    out.push({ tab: k, lines: n, at: i, a: (a[i] || '').slice(0, 240), b: (b[i] || '').slice(0, 240), ctx: (a[i - 1] || '').slice(0, 120) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- project completeness
const path = require('path');
const PAGE = path.join(__dirname, '..', 'index.html');
async function open(ctx, hash) {
  const pg = await ctx.newPage({ viewport: { width: 1280, height: 900 } }); pg._errs = []; pg.on('pageerror', e => pg._errs.push(e.message));
  await pg.goto('file://' + PAGE + '#' + (hash || 'quick')); await pg.waitForTimeout(500); await install(pg); await settle(pg); return pg;
}
// a state that renders the generated inputs: expert, metric, an engine preset, a turbo build with a turbo picked and the
// knock check on, the Headers tab at unequal lengths, a muffler line; then every tab visited
async function rich(pg) {
  await pg.click('#m-expert'); await pg.click('#u-met');
  await pg.evaluate(() => window.__st.presetText('eng', 'K24A2 '));
  await goTab(pg, 'intake');
  await pg.evaluate(() => { const f = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    f('i-ind', 'turbo'); const s = document.querySelector('select.tsox[data-k="turbo"]'); if (s) { s.value = s.options[7].value; s.dispatchEvent(new Event('change', { bubbles: true })); } f('i-kon', 'on'); });
  await goTab(pg, 'headers'); await pg.evaluate(() => { const e = document.getElementById('h-lenmode'); e.value = 'unequal'; e.dispatchEvent(new Event('change', { bubbles: true })); });
  await settle(pg);
  const tabs = await pg.evaluate(() => window.__st.tabs()); for (const t of tabs) await goTab(pg, t.tab);
}
// every input with an id, with the tab it is on ('' above the tabs), its value and whether it is in the project's vals
async function idsNow(pg) {
  const tabs = await pg.evaluate(() => window.__st.tabs()), seen = {};
  for (const t of tabs) { await goTab(pg, t.tab);
    const ids = await pg.evaluate(() => [...document.querySelectorAll('input, select, textarea')].filter(el => !el.closest('dialog') && !/^(file|button|submit|hidden)$/.test(el.type) && (el.id || el.closest('section[id^="panel-"]')))
      .map(el => { const p = el.closest('section[id^="panel-"]'); return { id: el.id || window.__st.selOf(el), panel: p ? p.id : '', v: el.type === 'checkbox' ? el.checked : el.value }; }));
    for (const x of ids) if (!seen[x.id] && (x.panel === '' || x.panel === t.panel)) seen[x.id] = Object.assign({ tab: x.panel ? t.tab : '' }, x); }
  return seen;
}
async function readIds(pg, ids) {
  const tabs = await pg.evaluate(() => window.__st.tabs()), out = {};
  for (const t of tabs) { const mine = ids.filter(x => x.tab === t.tab || (!x.tab && t === tabs[0])); if (!mine.length) continue; await goTab(pg, t.tab);
    Object.assign(out, await pg.evaluate(ids => Object.fromEntries(ids.map(x => { const el = window.__st.inp(x.id); return [x.id, el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined]; })), mine)); }
  return out;
}
// a probe change of one input (a clearly different value a user could type or pick)
const PROBE = id => { const el = window.__st.inp(id); if (!el) return null; const fire = t => el.dispatchEvent(new Event(t, { bubbles: true }));
  if (el.tagName === 'SELECT') { const o = [...el.options].find(o => !o.disabled && o.value !== el.value); if (!o) return null; el.value = o.value; fire('input'); fire('change'); return el.value; }
  if (el.type === 'checkbox') { el.checked = !el.checked; fire('input'); fire('change'); return el.checked; }
  const t = el.value.trim(); let v;
  if (el.type === 'number' || el.dataset.kind) v = t === '' || !Number.isFinite(+t) ? '7' : String(+(+t * 1.1 + 1).toPrecision(4));
  else v = /\d/.test(t) ? t.replace(/\d+/, m => String(+m + 1)) : (t ? t + ' x' : '5000 6000');
  el.value = v; fire('input'); fire('change'); return el.value; };
// the inventory: vals (saved in the project's vals), via (not in vals, but its probe change survives a save and a load into
// a fresh page), lost (it does not), untested (the probe could not change it)
async function inventory(ctx, o) {
  o = o || {};
  const A = await open(ctx); await rich(A);
  const ids = await idsNow(A), snap0 = await A.evaluate(() => window.__proj.snapshot('x')), inVals = new Set(Object.keys(snap0.vals));
  const vals = Object.keys(ids).filter(id => inVals.has(id)), rest = Object.values(ids).filter(x => !inVals.has(x.id));
  const untested = [];
  for (const x of rest) { await goTab(A, x.tab || 'quick'); const v = await A.evaluate(PROBE.toString().replace(/^/, '(') + ')(' + JSON.stringify(x.id) + ')'); await settle(A); if (v === null) untested.push(x.id); }
  const after = await readIds(A, rest), snap = await A.evaluate(() => JSON.parse(JSON.stringify(window.__proj.snapshot('inventory'))));
  const B = await open(ctx); await B.evaluate(d => window.__proj.apply(d), snap); await settle(B);
  const got = await readIds(B, rest);
  // the same rich state with no probe change: a value equal to it proves nothing either way
  const C = await open(ctx); await rich(C); const def = await readIds(C, rest); await C.close();
  const via = [], lost = [];
  for (const x of rest) { if (untested.includes(x.id)) continue;
    if (after[x.id] === undefined || JSON.stringify(after[x.id]) === JSON.stringify(def[x.id])) { untested.push(x.id); continue; }
    if (JSON.stringify(after[x.id]) === JSON.stringify(got[x.id])) via.push(x.id); else lost.push({ id: x.id, tab: x.tab, why: 'set to ' + JSON.stringify(after[x.id]) + ', loaded as ' + JSON.stringify(got[x.id]) }); }
  // and the vals themselves read back (a saved field that the load then moves)
  const vAfter = await readIds(A, vals.map(id => ids[id])), vGot = await readIds(B, vals.map(id => ids[id]));
  const moved = vals.filter(id => JSON.stringify(vAfter[id]) !== JSON.stringify(vGot[id])).map(id => ({ id, a: vAfter[id], b: vGot[id] }));
  await A.close(); await B.close();
  return { vals, via, lost, untested, moved, ids };
}
// inputs that are not in the project on purpose (each: why). staleness_ui.js enumerates every input with an id in the rich state and
// fails on one that is neither saved nor here.
const NOT_SAVED = {
  // a credential: the program's update token (the host menu) must never travel in a project file
  'hm-upd-tok': 'the update token of the Windows program (host menu): a credential, never in a project file',
  // the Parts tab's catalogue filters: how the list of off-the-shelf parts is browsed, not the build (the build list is saved)
  'p-kind': 'catalogue filter (kind of part)', 'p-brand': 'catalogue filter (brand)', 'p-size': 'catalogue filter (pipe size)', 'p-q': 'catalogue search text',
  // the custom-part form: a draft until "Add"; the part added goes in the build list, which is saved
  'pc-name': 'custom-part draft', 'pc-kind': 'custom-part draft', 'pc-in': 'custom-part draft', 'pc-out': 'custom-part draft', 'pc-inpos': 'custom-part draft',
  'pc-outpos': 'custom-part draft', 'pc-off': 'custom-part draft', 'pc-shape': 'custom-part draft', 'pc-w': 'custom-part draft', 'pc-h': 'custom-part draft',
  'pc-body': 'custom-part draft', 'pc-oal': 'custom-part draft',
  // the Options tab's filter and search: how the list is browsed
  'o-cat': 'Options list filter', 'o-q': 'Options list search text'
};

// a checkpoint's fresh page gets these view settings from page A as well (they are not in the project, so B would show the
// unfiltered list: a difference by design, not a stale result)
async function copyView(A, B) {
  const v = await A.evaluate(ids => Object.fromEntries(ids.map(id => { const e = document.getElementById(id); return [id, e ? e.value : null]; })), Object.keys(NOT_SAVED));
  await B.evaluate(v => { for (const id in v) { const e = document.getElementById(id); if (!e || v[id] === null || e.value === v[id]) continue; e.value = v[id]; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } }, v);
}
module.exports = { NOT_SAVED, copyView, PAGE_SRC, install, goTab, readAll, diffTabs, open, rich, idsNow, readIds, inventory };
