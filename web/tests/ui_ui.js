// The interface checks of the UI pass (2026-11-16, docs/UI_REDESIGN_2026-11-16.md).   node tests/ui_ui.js  (from web/)
// On every tab in its default state, and on the Intake tab after the K24 turbo journey (Honda K24A2, Turbocharged,
// 450 hp, PT5862 0.63 A/R, Use these sizes, Use this intercooler, tubular manifold at 93 mm port spacing):
//   - no sideways page scroll at 1440, 420 (Fusion's palette) and 400 px (a phone), and no element sticking out past
//     the page's edge unless it sits in a box that scrolls or clips (tables, the tab strip)
//   - text contrast in the light and the dark theme, from computed styles: at least 4.5:1 for body text and 3:1 for
//     large text (24 px, or 18.66 px bold), against the first opaque background behind it (a sample of text on every
//     tab, the app bar and the vehicle picker; the drawings' SVG labels are left out)
//   - every visible control (button, link, field, select, summary, tab) has an accessible name and a visible keyboard
//     focus style (an outline, or the field's ring)
//   - at 400 px every visible control is at least 40 px tall (a box, or the label round a check box); links inside a
//     run of text are left out (WCAG 2.5.8's inline exception)
//   - the tabs by keyboard: arrow keys move between them, Enter opens one; the "All" list on the narrow strip opens,
//     lists all 13 and opens one; Escape closes it
//   - no console errors
//   - field edits: the median synchronous time of a field edit (input event to layout) on the busiest tabs against the
//     page before the UI pass (git show 5000fb8:web/index.html), and against the page before pass two (6f0c694), both
//     with the same font so that the comparison is of the code and the styles: not more than 20 % (plus 5 ms) slower.
//     Skipped as a part when git or those commits are not here (a shallow clone).
// Pass two (folding sections, the input column's explanations, the Settings panel, the sections list, layout stability):
//   - every fold control is a button with aria-expanded, opened and closed by Enter and Space, and moves focus nowhere
//   - on every tab and the K24 journey, with nothing stored: no section with a warning, a problem or an out-of-date note
//     starts folded, and no warning or problem note sits in a folded section or a folded explanation
//   - nothing lost: on every tab and the K24 journey, with everything opened (expandAll), the page's text (innerText of the
//     vehicle bar and the tab, which only counts what is drawn) holds every word of the page before pass two, as many
//     times as it had it; and its textContent with nothing opened does too
//   - the Settings panel at 400 px: the app bar is one row, the panel opens with its controls, Escape closes it and focus
//     goes back to its button; at 1440 px the controls show and the button does not
//   - the sections list follows the section in view (1440 px), and on a phone is a "Jump to" list that scrolls to it
//   - a field edit that re-renders the tab moves neither the field nor the caret (1440 and 400 px; the page's own scroll
//     keeping, which is what a WebKit view without scroll anchoring gets)
//   - print: every folded section and explanation is drawn in full
const { chromium } = require('playwright');
const { settle, expandAll } = require('./settle');
const { skipPart } = require('./skip');
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const TABS = ['quick', 'four-stroke', 'two-stroke', 'sound', 'intake', 'headers', 'crossover', 'mufflers', 'cats', 'boom-tubes', 'hangers', 'parts', 'options'];
const BASE = '5000fb8', BASE2 = '6f0c694';   // before the UI pass; before pass two

async function k24(pg) {
  const setv = async (id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await settle(pg); };
  const chg = async (s, v) => { await pg.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [s, v]); await settle(pg); };
  await pg.evaluate(() => { location.hash = 'intake'; }); await settle(pg);
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
  await settle(pg);
  await setv('i-ind', 'turbo'); await setv('i-hp', '450');
  const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await chg('select.tsox[data-k="turbo"]', String(ti));
  const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti); await chg('select.tsox[data-k="hs"]', String(hs));
  await pg.evaluate(() => document.querySelector('button[data-tsuse]').click()); await settle(pg);
  await pg.evaluate(() => { const b = document.querySelector('button[data-icuse]:not([disabled])'); if (b) b.click(); }); await settle(pg);
  await setv('i-mani', 'tube'); await setv('i-msp', (93 / 25.4).toFixed(3));
}

// --- in the page: layout, contrast, names, focus styles, target sizes of the active tab (and the shell around it)
const PAGE_CHECKS = (opt) => {
  const out = { hscroll: document.documentElement.scrollWidth - innerWidth, overflow: [], contrast: [], noname: [], nofocus: [], small: [], nText: 0, nCtl: 0 };
  const panel = document.querySelector('[role=tabpanel]:not([hidden])');
  const roots = [panel, document.querySelector('.top'), document.querySelector('.navbar'), document.getElementById('vbar')].filter(Boolean);
  const vis = e => { if (!e.getClientRects().length) return false; const s = getComputedStyle(e); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const desc = e => (e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '')) + ' "' + (e.textContent || e.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40) + '"';
  // scroll / clip boxes
  const clipCache = new Map();
  const clipped = e => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { let c = clipCache.get(a);
      if (c === undefined) { const s = getComputedStyle(a); c = s.overflowX !== 'visible' && s.overflowX !== 'clip' ? true : s.overflowX === 'clip'; clipCache.set(a, c); }
      if (c) return true; } return false; };
  const all = roots.flatMap(r => [...r.querySelectorAll('*')]).filter(e => !(e instanceof SVGElement) || e.tagName === 'svg');
  const W = document.documentElement.clientWidth;
  for (const e of all) { const r = e.getBoundingClientRect(); if (!r.width) continue; if (r.right > W + 1 && !clipped(e) && vis(e)) out.overflow.push(desc(e) + ' right ' + Math.round(r.right) + ' > ' + W); }
  // contrast
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bgOf = e => { const stack = []; for (let a = e; a; a = a.parentElement) { const c = parse(getComputedStyle(a).backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } }
    let col = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1]; for (let i = stack.length - 1; i >= 0; i--) col = over(stack[i], col); return col; };
  const textEls = all.filter(e => !(e instanceof SVGElement) && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && vis(e) && !e.closest('svg,[disabled],.btn[disabled],option'));
  const step = Math.max(1, Math.floor(textEls.length / opt.sample));
  const seen = new Set();
  for (let i = 0; i < textEls.length; i += step) { const e = textEls[i]; const s = getComputedStyle(e); if (+s.opacity < 1) continue;
    let op = 1; for (let a = e; a; a = a.parentElement) op *= +getComputedStyle(a).opacity; if (op < 0.99) continue;
    const fg = parse(s.color); if (!fg || fg[3] === 0 || parseFloat(s.fontSize) < 1) continue; const bg = bgOf(e), f = over(fg, bg);
    const L1 = lum(f), L2 = lum(bg), cr = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const px = parseFloat(s.fontSize), bold = +s.fontWeight >= 700, large = px >= 24 || (px >= 18.66 && bold), need = large ? 3 : 4.5;
    out.nText++;
    if (cr < need - 0.01) { const k = s.color + '|' + bg.join(','); if (seen.has(k)) continue; seen.add(k); out.contrast.push(desc(e) + ' ' + cr.toFixed(2) + ':1 (needs ' + need + ', ' + s.color + ' on rgb(' + bg.slice(0, 3).map(Math.round).join(',') + '), ' + px + 'px)'); } }
  // controls
  const ctl = all.filter(e => e.matches('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=tab],[tabindex]:not([tabindex="-1"])') && vis(e) && !e.closest('[hidden],svg'));
  const nameOf = e => { if (e.getAttribute('aria-label')) return e.getAttribute('aria-label');
    const lb = e.getAttribute('aria-labelledby'); if (lb) return lb.split(/\s+/).map(i => (document.getElementById(i) || {}).textContent || '').join(' ');
    if (e.matches('input,select,textarea')) { if (e.id) { const l = document.querySelector('label[for="' + CSS.escape(e.id) + '"]'); if (l) return l.textContent; }
      const l = e.closest('label'); if (l) return l.textContent; return e.title || e.placeholder || ''; }
    return (e.textContent || '').trim() || e.title || ((e.querySelector('img[alt]') || {}).alt || ''); };
  for (const e of ctl) { out.nCtl++; if (!nameOf(e).trim()) out.noname.push(desc(e) + (e.outerHTML.slice(0, 80))); }
  // target sizes (narrow widths only)
  if (opt.targets) for (const e of ctl) { if (clipped(e) && e.closest('.tblwrap')) { const r0 = e.getBoundingClientRect(); if (r0.bottom < 0) continue; }
    let box = e;
    if (e.matches('a[href]')) { const p = e.parentElement; if (p && [...p.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue; }   // a link in a run of text
    if (e.matches('input[type=checkbox],input[type=radio]')) box = e.closest('label') || e;
    else if (e.matches('input,select') && e.parentElement.classList.contains('inp')) box = e.parentElement;
    const h = box.getBoundingClientRect().height; if (h < 39.5) out.small.push(desc(e) + ' ' + Math.round(h) + ' px'); }
  out.ctlSel = ctl.length;
  return out;
};

// focus styles: focus a sample of each kind of control after a key press (so :focus-visible applies) and read the style
const FOCUS_CHECK = () => {
  const panel = document.querySelector('[role=tabpanel]:not([hidden])');
  const roots = [panel, document.querySelector('.top'), document.querySelector('.navbar'), document.getElementById('vbar')].filter(Boolean);
  const ctl = roots.flatMap(r => [...r.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary')]).filter(e => e.getClientRects().length && !e.disabled && !e.closest('[hidden]'));
  const kinds = new Map(); for (const e of ctl) { const k = e.tagName + (e.type ? ':' + e.type : '') + '.' + (typeof e.className === 'string' ? e.className : '') + '/' + (e.parentElement.className || ''); if (!kinds.has(k)) kinds.set(k, e); }
  const bad = [];
  for (const [k, e] of kinds) { e.focus({ preventScroll: true }); if (document.activeElement !== e) continue;
    const s = getComputedStyle(e), wrap = e.closest('.inp');
    const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 1) || (s.boxShadow && s.boxShadow !== 'none') || (wrap && getComputedStyle(wrap).boxShadow !== 'none');
    if (!ring) bad.push(k + ' "' + (e.textContent || e.id || '').trim().slice(0, 30) + '"'); e.blur(); }
  return { n: kinds.size, bad };
};

async function timeEdits(b, file, font) {
  const out = {};
  for (const [t, id, vals] of [['mufflers', 'm-f', null], ['intake', 'i-hp', ['440', '450']], ['hangers', 'hg-od', null], ['four-stroke', 'f-rpm', ['6400', '6500']]]) {
    const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await pg.goto('file://' + file + '#' + t); await pg.waitForTimeout(600);
    await pg.addStyleTag({ content: font }); await settle(pg);
    if (t === 'intake') { await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
      s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); s('i-ind', 'turbo'); }); await settle(pg); }
    const ms = [];
    for (let i = 0; i < 15; i++) {
      ms.push(await pg.evaluate(([id, v, i]) => { const el = document.getElementById(id); el.value = v ? v[i % 2] : String((parseFloat(el.value) || 1) * (i % 2 ? 1 / 1.01 : 1.01));
        const t0 = performance.now(); el.dispatchEvent(new Event('input', { bubbles: true })); void document.body.offsetHeight; return performance.now() - t0; }, [id, vals, i]));
      await settle(pg);
    }
    ms.sort((a, c) => a - c); out[t] = ms[7];
    await pg.close();
  }
  return out;
}

(async () => {
  const b = await chromium.launch(); const fails = []; const errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const list = (a, n = 6) => a.length ? ' — ' + a.slice(0, n).join('; ') + (a.length > n ? ' … (' + a.length + ')' : '') : '';
  for (const theme of ['light', 'dark']) for (const width of [1440, 420, 400]) {
    const ctx = await b.newContext({ viewport: { width, height: width < 600 ? 860 : 900 }, colorScheme: theme, hasTouch: width < 600 });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(width + ' ' + theme + ': ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(width + ' ' + theme + ' console: ' + m.text()); });
    await pg.goto('file://' + process.cwd() + '/index.html#quick'); await pg.waitForTimeout(800); await settle(pg);
    const layout = theme === 'light';   // layout, names and targets do not depend on the theme
    const views = TABS.concat(['k24']);
    for (const t of views) {
      if (t === 'k24') await k24(pg); else { await pg.evaluate(t => { location.hash = t; }, t); await settle(pg); }
      await pg.evaluate(() => window.scrollTo(0, 0));
      const r = await pg.evaluate(PAGE_CHECKS, { sample: 260, targets: layout && width === 400 });
      const tag = t + ' ' + width + ' ' + theme;
      if (layout) {
        ok(r.hscroll <= 0, tag + ': no sideways page scroll (' + r.hscroll + ' px)');
        ok(!r.overflow.length, tag + ': nothing sticks out past the page edge' + list(r.overflow));
        ok(!r.noname.length, tag + ': every control has an accessible name (' + r.nCtl + ' controls)' + list(r.noname));
        if (width === 400) ok(!r.small.length, tag + ': every control at least 40 px tall' + list(r.small, 10));
      }
      if (width !== 420) ok(!r.contrast.length, tag + ': text contrast (' + r.nText + ' text elements sampled)' + list(r.contrast, 8));
      if (layout && width === 1440) { await pg.keyboard.press('Shift'); const f = await pg.evaluate(FOCUS_CHECK); ok(!f.bad.length, tag + ': visible focus style on every kind of control (' + f.n + ' kinds)' + list(f.bad)); }
    }
    // keyboard on the tabs; the "All" list on the narrow strip
    if (layout) {
      await pg.evaluate(() => { location.hash = 'four-stroke'; }); await settle(pg);
      await pg.focus('#tab-four'); await pg.keyboard.press('ArrowRight');
      const f1 = await pg.evaluate(() => document.activeElement.id); await pg.keyboard.press('Enter'); await settle(pg);
      const h1 = await pg.evaluate(() => [location.hash, !document.getElementById('panel-two').hidden]);
      await pg.keyboard.press('End'); const f2 = await pg.evaluate(() => document.activeElement.id); await pg.keyboard.press('Home'); const f3 = await pg.evaluate(() => document.activeElement.id);
      ok(f1 === 'tab-two' && h1[0] === '#two-stroke' && h1[1] && f2 === 'tab-opt' && f3 === 'tab-quick', width + ': tabs by keyboard: arrow to 2-Stroke (' + f1 + '), Enter opens it (' + h1 + '), End (' + f2 + '), Home (' + f3 + ')');
      const narrow = width < 1180;
      const all = await pg.evaluate(() => { const b = document.getElementById('tabsall'); return { shown: !!b.getClientRects().length }; });
      ok(all.shown === narrow, width + ': the "All" button ' + (narrow ? 'is on the narrow strip' : 'is not on the wide rail'));
      if (narrow) {
        await pg.click('#tabsall'); await pg.waitForTimeout(100);
        const p = await pg.evaluate(() => ({ open: !document.getElementById('tabpop').hidden, n: document.querySelectorAll('#tabpop button[data-gotab]').length, cur: (document.querySelector('#tabpop [aria-current]') || {}).dataset, focus: document.activeElement.dataset.gotab,
          inView: (() => { const r = document.getElementById('tabpop').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })() }));
        ok(p.open && p.n === 13 && p.cur && p.cur.gotab === 'two-stroke' && p.focus === 'two-stroke' && p.inView, width + ': the All list opens with all 13, the current one marked and focused, inside the page (' + JSON.stringify(p) + ')');
        await pg.keyboard.press('Escape'); const closed = await pg.evaluate(() => document.getElementById('tabpop').hidden && document.activeElement.id === 'tabsall');
        ok(closed, width + ': Escape closes the All list and returns to its button');
        await pg.click('#tabsall'); await pg.click('#tabpop button[data-gotab="hangers"]'); await settle(pg);
        const h2 = await pg.evaluate(() => [location.hash, !document.getElementById('panel-hang').hidden, document.getElementById('tabpop').hidden, (() => { const n = document.querySelector('.tabs'), s = n.querySelector('[aria-selected="true"]').getBoundingClientRect(), r = n.getBoundingClientRect(); return s.left >= r.left - 1 && s.right <= r.right + 1; })()]);
        ok(h2[0] === '#hangers' && h2[1] && h2[2] && h2[3], width + ': a choice in the All list opens that tab, closes the list, and the strip shows it (' + h2 + ')');
      }
    }
    await ctx.close();
  }
  ok(!errs.length, 'no console errors' + list(errs));

  // ---------- pass two ----------
  let old2 = null;
  try { old2 = execFileSync('git', ['show', BASE2 + ':web/index.html'], { cwd: __dirname, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { old2 = null; }
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'et-ui2-')), f2 = path.join(dir2, 'before2.html'); if (old2) fs.writeFileSync(f2, old2);
  const TEXT = () => document.getElementById('vbar').innerText + '\n' + document.querySelector('[role=tabpanel]:not([hidden])').innerText;
  const TC = () => document.getElementById('vbar').textContent + '\n' + document.querySelector('[role=tabpanel]:not([hidden])').textContent;
  // words: runs of letters and figures (a full stop or a lowercase-to-capital join, where two blocks meet with no space in
  // one page's text and a line break in the other's, is a boundary)
  const words = t => { const m = new Map(); for (const w of t.replace(/([a-z])([A-Z])/g, '$1 $2').match(/[\p{L}\p{N}]+/gu) || []) m.set(w, (m.get(w) || 0) + 1); return m; };
  const missing = (a, b) => { const A = words(a), B = words(b), out = []; for (const [w, n] of A) if ((B.get(w) || 0) < n) out.push(w + ' ×' + (n - (B.get(w) || 0))); return out; };
  {
    const ctxN = await b.newContext({ viewport: { width: 1440, height: 900 } }), pn = await ctxN.newPage();
    pn.on('pageerror', e => errs.push('pass two: ' + e.message));
    await pn.goto('file://' + process.cwd() + '/index.html#quick'); await pn.waitForTimeout(800); await settle(pn);
    let po = null; if (old2) { const ctxO = await b.newContext({ viewport: { width: 1440, height: 900 } }); po = await ctxO.newPage(); await po.goto('file://' + f2 + '#quick'); await po.waitForTimeout(800); await settle(po); }
    else skipPart('ui_ui: the full-text comparison needs the page before pass two from git (commit ' + BASE2 + ')');
    for (const t of TABS.concat(['k24'])) {
      if (t === 'k24') { await k24(pn); if (po) await k24(po); } else { for (const g of po ? [pn, po] : [pn]) { await g.evaluate(t => { location.hash = t; }, t); await settle(g); } }
      // warnings never folded by default (nothing stored in this context)
      const w = await pn.evaluate(() => { const p = document.querySelector('[role=tabpanel]:not([hidden])');
        const hotFolded = [...p.querySelectorAll('.sec.fc')].filter(x => /warn|bad|stale/.test(x.dataset.st || '')).map(x => x.dataset.sec);
        const notes = [...p.querySelectorAll('.note.warn,.note.bad,.note[id$="-stale"]')].filter(n => !n.closest('[hidden]') && (n.closest('.sec.fc') || n.closest('.hfold:not(.hopen)'))).map(n => n.textContent.slice(0, 50));
        const btns = [...p.querySelectorAll('.sec > h3 > .fbtn, button.hmore')], noaria = btns.filter(x => !/^(true|false)$/.test(x.getAttribute('aria-expanded') || '')).length;
        return { hotFolded, notes, n: btns.length, noaria, folded: p.querySelectorAll('.sec.fc').length, secs: p.querySelectorAll('.sec > h3 > .fbtn').length }; });
      ok(!w.hotFolded.length && !w.notes.length && !w.noaria, t + ': no warning, problem or out-of-date section starts folded, and every fold control has aria-expanded (' + w.n + ' controls, ' + w.folded + ' of ' + w.secs + ' sections folded)' + list(w.hotFolded.concat(w.notes)));
      if (po) {
        const oldText = await po.evaluate(TEXT), oldTc = await po.evaluate(TC), tcN = await pn.evaluate(TC);
        await expandAll(pn); const newText = await pn.evaluate(TEXT); await expandAll(pn, false);
        const m1 = missing(oldText, newText), m2 = missing(oldTc, tcN);
        ok(!m1.length && !m2.length, t + ': every word of the page before pass two is still there (' + words(oldText).size + ' distinct words drawn with everything open; textContent too)' + list(m1.concat(m2), 12));
      }
    }
    // disclosures by keyboard
    await pn.evaluate(() => { location.hash = 'mufflers'; }); await settle(pn);
    const kb = [];
    for (const sel of ['.sec.fc > h3 > .fbtn', '.sec:not(.fc) > h3 > .fbtn']) {
      await pn.focus('#panel-muf ' + sel); const id0 = await pn.evaluate(() => document.activeElement.getAttribute('aria-controls'));
      const a0 = await pn.evaluate(() => document.activeElement.getAttribute('aria-expanded'));
      await pn.keyboard.press('Enter'); await settle(pn);
      const a1 = await pn.evaluate(id => { const x = document.getElementById(id); return [x.querySelector(':scope>h3>.fbtn').getAttribute('aria-expanded'), x.classList.contains('fc'), document.activeElement === x.querySelector(':scope>h3>.fbtn'), [...x.children].filter(c => c.tagName !== 'H3').every(c => c.hasAttribute('inert') === x.classList.contains('fc'))]; }, id0);
      await pn.keyboard.press(' '); await settle(pn);
      const a2 = await pn.evaluate(id => document.getElementById(id).querySelector(':scope>h3>.fbtn').getAttribute('aria-expanded'), id0);
      kb.push(a0 !== a1[0] && a1[1] === (a1[0] === 'false') && a1[2] && a1[3] && a2 === a0 ? '' : sel + ' ' + JSON.stringify([a0, a1, a2]));
    }
    ok(!kb.join(''), 'a section heading folds and opens by Enter and Space, keeps focus, and its blocks are inert only while folded' + list(kb.filter(Boolean)));
    // a folded explanation in the input column
    await k24(pn);
    const h = await pn.evaluate(() => { const b = document.querySelector('#panel-intake button.hmore[aria-controls="i-opm-out"]'), e = document.getElementById('i-opm-out'), ro = e && e.previousElementSibling;
      return { b: !!b, label: b && b.textContent, exp: b && b.getAttribute('aria-expanded'), h: e && e.getBoundingClientRect().height, ro: ro && ro.classList.contains('hro') ? ro.textContent : '', len: e && e.textContent.length }; });
    await pn.focus('#panel-intake button.hmore[aria-controls="i-opm-out"]'); await pn.keyboard.press('Enter'); await settle(pn);
    const h2 = await pn.evaluate(() => { const b = document.querySelector('#panel-intake button.hmore[aria-controls="i-opm-out"]'), e = document.getElementById('i-opm-out'); return { exp: b.getAttribute('aria-expanded'), h: e.getBoundingClientRect().height, label: b.textContent, focus: document.activeElement === b }; });
    await pn.keyboard.press('Enter'); await settle(pn);
    ok(h.b && h.exp === 'false' && h.h < 2 && /^Boost worked out/.test(h.ro) && h.len > 600 && h2.exp === 'true' && h2.h > 100 && h2.focus, 'K24: the boost reasoning (' + h.len + ' characters) folds under "' + h.label + '" with the readout "' + h.ro + '" above it; Enter opens it (' + JSON.stringify(h2) + ')');
    // print draws everything
    await pn.emulateMedia({ media: 'print' });
    const pr = await pn.evaluate(() => { const p = document.querySelector('[role=tabpanel]:not([hidden])'); const bad = [];
      for (const x of p.querySelectorAll('.sec.fc')) for (const c of x.children) if (c.tagName !== 'H3' && c.textContent.trim() && c.getBoundingClientRect().height < 1) bad.push(x.dataset.sec);
      for (const e of p.querySelectorAll('.hfold:not(.hopen)')) if (!e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.scrollHeight > e.clientHeight + 2) bad.push(e.id);
      return { bad, n: p.querySelectorAll('.sec.fc').length + p.querySelectorAll('.hfold:not(.hopen)').length }; });
    await pn.emulateMedia({ media: 'screen' });
    ok(pr.n > 0 && !pr.bad.length, 'print: every folded section and explanation is drawn in full (' + pr.n + ' folded on screen)' + list(pr.bad));
    // the sections list follows the section in view
    const toc = [];
    for (const k of [6, 14, 22]) {
      await pn.evaluate(k => { const x = document.querySelectorAll('#panel-intake .sec[data-sec]')[k]; window.scrollTo(0, x.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stick')) || 0) - 70); }, k); await pn.waitForTimeout(250);
      toc.push(await pn.evaluate(k => { const x = document.querySelectorAll('#panel-intake .sec[data-sec]')[k], c = document.querySelector('#panel-intake .toc button[aria-current="true"]'), n = document.querySelector('#panel-intake .toc');
        const r = n.getBoundingClientRect(), cr = c && c.getBoundingClientRect(), row = c && c.parentElement.getBoundingClientRect();
        return { want: x.dataset.sec, got: c && c.dataset.toc, stuck: r.top >= 0 && r.top < 120, inRow: !!cr && cr.left >= row.left - 1 && cr.right <= row.right + 1 }; }, k));
    }
    ok(toc.every(x => x.want === x.got && x.stuck && x.inRow), 'K24 at 1440: the sections list stays under the app bar and marks the section in view, scrolled into its row' + list(toc.map(x => JSON.stringify(x))));
    await ctxN.close(); if (po) await po.context().close();
  }
  // phone: the Settings panel, the Jump to list, field edits that keep their place
  for (const width of [400, 1440]) {
    const ctx = await b.newContext({ viewport: { width, height: width < 600 ? 860 : 900 }, hasTouch: width < 600 }), pg = await ctx.newPage();
    await pg.goto('file://' + process.cwd() + '/index.html#mufflers'); await pg.waitForTimeout(800); await settle(pg);
    const st = await pg.evaluate(() => { const b = document.getElementById('set-btn'), p = document.getElementById('set-panel'), t = document.querySelector('.top');
      return { btn: !!b.getClientRects().length, panel: !!p.getClientRects().length, h: Math.round(t.getBoundingClientRect().height) }; });
    if (width === 400) {
      await pg.click('#set-btn'); await pg.waitForTimeout(80);
      const o = await pg.evaluate(() => { const p = document.getElementById('set-panel'), r = p.getBoundingClientRect(); const vis = id => !!document.getElementById(id).getClientRects().length;
        return { open: !!p.getClientRects().length, exp: document.getElementById('set-btn').getAttribute('aria-expanded'), focusIn: p.contains(document.activeElement), inView: r.left >= 0 && r.right <= innerWidth,
          ctl: ['m-simple', 'm-expert', 'u-imp', 'u-met', 'f-16', 'f-32', 'f-64', 'proj-btn', 'theme-btn'].every(vis), labels: [...p.querySelectorAll('.seglab')].filter(l => l.getClientRects().length).length }; });
      await pg.click('#u-met'); await settle(pg); const unit = await pg.evaluate(() => [document.getElementById('u-met').getAttribute('aria-pressed'), !!document.getElementById('set-panel').getClientRects().length]);
      await pg.keyboard.press('Escape'); await pg.waitForTimeout(50);
      const c = await pg.evaluate(() => ({ closed: !document.getElementById('set-panel').getClientRects().length, back: document.activeElement.id, exp: document.getElementById('set-btn').getAttribute('aria-expanded') }));
      await pg.click('#set-btn'); await pg.click('#u-imp'); await settle(pg); await pg.mouse.click(200, 700); await settle(pg);
      const out = await pg.evaluate(() => !document.querySelector('.top').classList.contains('setopen') && !document.getElementById('set-panel').getClientRects().length);
      ok(st.btn && !st.panel && st.h < 70 && o.open && o.exp === 'true' && o.focusIn && o.inView && o.ctl && o.labels === 3 && unit[0] === 'true' && unit[1] && c.closed && c.back === 'set-btn' && c.exp === 'false' && out,
        '400: the app bar is one row (' + st.h + ' px) with a Settings button; its panel opens with every control and their labels, stays open while a unit is picked, Escape closes it and focus goes back, a click outside closes it' + ' ' + JSON.stringify([o, unit, c, out]));
      // the Jump to list
      await pg.evaluate(() => { location.hash = 'mufflers'; }); await settle(pg);
      const j = await pg.evaluate(() => { const s = document.querySelector('#panel-muf .toc select[data-tocsel]'), row = document.querySelector('#panel-muf .tocrow'); return { sel: !!s && !!s.getClientRects().length, chips: !!row && !!row.getClientRects().length, n: s ? s.options.length - 1 : 0 }; });
      const want = await pg.evaluate(() => document.querySelector('#panel-muf select[data-tocsel]').options[6].value);
      await pg.selectOption('#panel-muf select[data-tocsel]', { index: 6 }); await settle(pg); await pg.waitForTimeout(200);
      const j2 = await pg.evaluate(want => { const x = document.querySelector('#panel-muf .sec[data-sec="' + want + '"]'), r = x.getBoundingClientRect();
        return { want, top: Math.round(r.top), open: !x.classList.contains('fc'), focus: document.activeElement === x.querySelector(':scope>h3>.fbtn') }; }, want);
      ok(j.sel && !j.chips && j.n >= 7 && j2.top >= 0 && j2.top < 160 && j2.open && j2.focus, '400: the sections list is a "Jump to" list (' + j.n + ' sections) that scrolls to the section, opens it and focuses its heading (' + JSON.stringify(j2) + ')');
    } else ok(!st.btn && st.panel, '1440: the app bar shows its controls and no Settings button');
    // a field edit keeps the field where it is, with its caret
    const shifts = [];
    for (const [hash, id, v] of [['mufflers', 'm-f', '9'], ['hangers', 'hg-od', '3'], ['intake', 'i-rpm', '1']]) {
      await pg.evaluate(h => { location.hash = h; }, hash); await settle(pg);
      await pg.evaluate(id => { const e = document.getElementById(id); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - innerHeight * 0.5); }, id); await settle(pg);
      await pg.focus('#' + id); await pg.evaluate(id => { const e = document.getElementById(id); try { e.setSelectionRange(e.value.length, e.value.length); } catch (x) {} }, id);
      const r0 = await pg.evaluate(id => document.getElementById(id).getBoundingClientRect().top, id);
      await pg.keyboard.type(v); await settle(pg); await pg.keyboard.press('Backspace'); await settle(pg);
      const r1 = await pg.evaluate(id => { const e = document.getElementById(id); return [e.getBoundingClientRect().top, document.activeElement === e]; }, id);
      if (Math.abs(r1[0] - r0) > 1 || !r1[1]) shifts.push(hash + ' ' + id + ' moved ' + Math.round(r1[0] - r0) + ' px, focus ' + r1[1]);
    }
    // a field inside the results that the render replaces (the K24 compressor-map pick keeps focus and place)
    if (width === 1440) {
      await k24(pg); const sel = 'select.tsox[data-k="hs"]';
      await pg.evaluate(s => { const e = document.querySelector(s); window.scrollTo(0, e.getBoundingClientRect().top + scrollY - innerHeight * 0.5); e.focus(); }, sel); await settle(pg);
      const r0 = await pg.evaluate(s => document.querySelector(s).getBoundingClientRect().top, sel);
      await pg.keyboard.press('ArrowDown'); await settle(pg); await pg.keyboard.press('ArrowUp'); await settle(pg);
      const r1 = await pg.evaluate(s => { const e = document.querySelector(s); return [e.getBoundingClientRect().top, document.activeElement === e]; }, sel);
      if (Math.abs(r1[0] - r0) > 1 || !r1[1]) shifts.push('k24 turbo housing select moved ' + Math.round(r1[0] - r0) + ' px, focus ' + r1[1]);
    }
    ok(!shifts.length, width + ': a field edit that re-renders the tab leaves the field in place with its focus and caret' + list(shifts));
    await ctx.close();
  }
  fs.rmSync(dir2, { recursive: true, force: true });

  // field-edit timing against the page before the UI pass, same font in both
  let old = null;
  try { old = execFileSync('git', ['show', BASE + ':web/index.html'], { cwd: __dirname, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { old = null; }
  if (!old || !old2) skipPart('ui_ui: the field-edit timing comparison needs the pages before the UI passes from git (commits ' + BASE + ', ' + BASE2 + '; not in a shallow clone)');
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'et-ui-')), f0 = path.join(dir, 'before.html'), f1 = path.join(dir, 'before2.html'); fs.writeFileSync(f0, old); fs.writeFileSync(f1, old2);
    const font = ":root{--f-ui:'Liberation Sans',Arial,sans-serif!important;--f-display:'Liberation Sans',Arial,sans-serif!important}";
    const A = [], A2 = [], B = [];
    for (let k = 0; k < 2; k++) { A.push(await timeEdits(b, f0, font)); A2.push(await timeEdits(b, f1, font)); B.push(await timeEdits(b, path.join(process.cwd(), 'index.html'), font)); }
    for (const t of Object.keys(A[0])) { const a = Math.min(A[0][t], A[1][t]), a2 = Math.min(A2[0][t], A2[1][t]), n = Math.min(B[0][t], B[1][t]);
      ok(n <= a * 1.2 + 5, t + ': a field edit takes ' + n.toFixed(1) + ' ms against ' + a.toFixed(1) + ' ms before the UI pass (limit +20 % + 5 ms)');
      ok(n <= a2 * 1.2 + 5, t + ': a field edit takes ' + n.toFixed(1) + ' ms against ' + a2.toFixed(1) + ' ms before pass two (limit +20 % + 5 ms)'); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await b.close();
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
