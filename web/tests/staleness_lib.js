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
module.exports = { PAGE_SRC, install, goTab, readAll, diffTabs };
