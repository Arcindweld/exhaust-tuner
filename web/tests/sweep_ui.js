// Regression sweep of every tab: (a) loads and recalculates with no page or console error at the default inputs, at
// extreme-but-legal inputs (tiny and huge displacement, 1 and 16 cylinders, very low and very high RPM, every option of
// every select, a custom engine at 1 and 16 cylinders, boost at 0 and 40 psi, optional fields blank and zero), and after inches <-> mm round trips (field values and results must
// come back the same); (b) no NaN / Infinity / undefined / [object, no negative length and no lone empty cell in any
// results table, and no NaN in any drawing's geometry; every length in a results table cell or drawing label shows
// both inches and mm; (c) at phone width (400 px) no horizontal page scroll and every control on screen and usable.
// Exits non-zero on any finding.   node tests/sweep_ui.js   (from web/; SWEEP_TABS=a,b to limit, SWEEP_SELECTS=0 to
// skip cycling the select options)
const { chromium } = require('playwright');
const FILE = process.argv[2] || 'index.html';
const ONLY = process.env.SWEEP_TABS ? process.env.SWEEP_TABS.split(',') : null;
const SELECTS = process.env.SWEEP_SELECTS !== '0';
(async () => {
  const b = await chromium.launch(); const finds = []; let errs = [];
  const find = (tab, what, m) => finds.push(tab + ' [' + what + '] ' + m);
  const open = async (w, tab) => {
    const p = await (await b.newContext({ viewport: { width: w, height: 900 } })).newPage();
    p.on('pageerror', e => errs.push(e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await p.goto('file://' + process.cwd() + '/' + FILE + '#' + tab); await p.waitForTimeout(600); return p;
  };
  const flushErrs = (tab, what) => { if (errs.length) find(tab, what, 'page/console error: ' + [...new Set(errs)].slice(0, 3).join(' | ')); errs = []; };
  // what the results and drawings of the open tab show that should never show
  const scan = pg => pg.evaluate(() => {
    const sec = document.querySelector('section.panel:not([hidden]),section.panel-wide:not([hidden])'); const out = [];
    if (!sec) return ['no panel shown'];
    const vis = e => !!(e.offsetParent || e.getClientRects().length);
    const bad = /\bNaN\b|\bInfinity\b(?! Bond)|\bundefined\b|\[object /;   // Infinity Bond: an adhesive the Intake tab names
    const negLen = /(^|[\s(=:,])[-−]\d+(\.\d+)?\s?(in|mm)\b/;
    const INCH = /\d\s?(in|″)(?![a-z²³])/, MMRE = /\d\s?mm(?![a-z²³])/;
    const txt = sec.innerText; const m = txt.match(bad);
    if (m) { const i = txt.indexOf(m[0]); out.push('shows "' + m[0] + '": …' + txt.slice(Math.max(0, i - 70), i + 30).replace(/\s+/g, ' ') + '…'); }
    for (const td of sec.querySelectorAll('td,th')) {
      if (!vis(td)) continue;
      const t = td.innerText.trim();
      if (negLen.test(t)) out.push('negative length in a table: "' + t.slice(0, 60) + '"');
      if (td.tagName === 'TD' && !t && !td.querySelector('svg,input,select,button,img,canvas,i,span[class]')) {
        const row = [...td.parentElement.children]; const filled = row.filter(c => c.innerText.trim()).length;
        // a blank cell in a row whose other cells are filled, in a table where that column is filled in other rows
        const col = row.indexOf(td), tb = td.closest('table');
        const others = [...tb.querySelectorAll('tr')].map(r => r.children[col]).filter(c => c && c !== td && c.tagName === 'TD');
        const colFilled = others.filter(c => c.innerText.trim()).length;
        if (filled >= 2 && others.length >= 2 && colFilled >= others.length - 1) out.push('empty cell in row "' + row.map(c => c.innerText.trim()).join(' | ').slice(0, 80) + '"');
      }
      // a length in one unit only: "12.3 in" with no mm in the same cell (or the reverse); a header that names both
      // units for its column (e.g. "in / mm") covers the cells under it
      // (areas and volumes, in² and mm³, are not lengths); a cell next to one giving the same in the other unit passes
      const hasIn = INCH.test(t), hasMm = MMRE.test(t);
      if (hasIn !== hasMm && td.tagName === 'TD') {
        const tb = td.closest('table');
        const hd = tb && [...tb.querySelectorAll('thead th, tr:first-child th')].map(h => h.innerText).join(' ');
        const other = c => c && c.tagName === 'TD' && (hasIn ? MMRE.test(c.innerText) && !INCH.test(c.innerText) : INCH.test(c.innerText) && !MMRE.test(c.innerText));
        const both = (hd && /\bin\b|″/.test(hd) && /\bmm\b/.test(hd)) || other(td.previousElementSibling) || other(td.nextElementSibling);
        if (!both) out.push('length in ' + (hasIn ? 'inches' : 'mm') + ' only: "' + t.slice(0, 50) + '" (row "' + td.parentElement.innerText.replace(/\s+/g, ' ').slice(0, 60) + '")');
      }
    }
    for (const svg of sec.querySelectorAll('svg')) {
      if (!vis(svg)) continue;
      for (const el of svg.querySelectorAll('*')) for (const a of el.attributes) if (/NaN|Infinity|undefined/.test(a.value)) { out.push('drawing ' + el.tagName + ' ' + a.name + '="' + a.value.slice(0, 50) + '"'); break; }
      for (const t of svg.querySelectorAll('text')) {
        const s = t.textContent;
        if (bad.test(s)) out.push('drawing label "' + s.slice(0, 50) + '"');
        if (negLen.test(' ' + s)) out.push('drawing: negative length "' + s.slice(0, 50) + '"');
        if (INCH.test(s) !== MMRE.test(s)) out.push('drawing label in ' + (INCH.test(s) ? 'inches' : 'mm') + ' only: "' + s.slice(0, 50) + '" (' + (svg.id || svg.getAttribute('class') || 'svg') + ')');
      }
    }
    return [...new Set(out)].slice(0, 12);
  });
  const fields = pg => pg.evaluate(() => {
    const sec = document.querySelector('section.panel:not([hidden]),section.panel-wide:not([hidden])');
    const lab = e => { const l = e.closest('label'); return ((l && (l.querySelector('.lab') || l).innerText) || '').replace(/\s+/g, ' ').trim(); };
    return [...sec.querySelectorAll('input,select')].filter(e => e.id && e.offsetParent && !e.disabled && e.type !== 'file' && e.type !== 'checkbox' && e.type !== 'radio')
      .map(e => ({ id: e.id, tag: e.tagName, kind: e.dataset.kind || e.type, v: e.value, lab: lab(e), opts: e.tagName === 'SELECT' ? [...e.options].filter(o => !o.disabled).map(o => o.value) : null }));
  });
  // sets fields by id (in the units on screen); a value of null blanks the field
  const setMany = (pg, kv) => pg.evaluate(kv => { for (const [id, v] of kv) { const e = document.getElementById(id); if (!e) continue;
    e.value = v == null ? '' : String(v); e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); } }, kv);
  const settle = pg => pg.waitForTimeout(250);
  const snap = pg => pg.evaluate(() => { const sec = document.querySelector('section.panel:not([hidden]),section.panel-wide:not([hidden])');
    return { ins: [...sec.querySelectorAll('input[data-kind]')].filter(i => i.id).map(i => [i.id, i._b]),
      figs: [...sec.querySelectorAll('.figs, .r dd, td')].slice(0, 400).map(x => x.innerText.replace(/\s+/g, ' ')).join(' | ') }; });

  const p0 = await open(1280, 'quick');
  let tabs = await p0.evaluate(() => [...document.querySelectorAll('.tabs [data-tab]')].map(x => x.dataset.tab));
  await p0.context().close(); errs = [];
  if (ONLY) tabs = tabs.filter(t => ONLY.includes(t));
  // role of a field from its id and label, for the extreme scenarios (values in inches / cu in, the page's default units)
  const role = f => {
    if (f.tag === 'SELECT') return null;
    const s = (f.id + ' ' + f.lab).toLowerCase();
    if (f.kind === 'disp') return 'disp';
    if (/-cyl\b|cylinders$/.test(s) && f.kind === 'num') return 'cyl';
    if (/idle/.test(s)) return 'idle';
    if (/cruise/.test(s)) return 'cruise';
    if (/redline|-red\b/.test(s)) return 'red';
    if (/rpm|-trq\b/.test(s) && f.kind === 'num') return 'rpm';
    return null;
  };
  const SCEN = {
    'tiny engine, 1 cylinder, low RPM': { disp: 3, cyl: 1, idle: 600, cruise: 1200, rpm: 2000, red: 2500 },
    'huge engine, 16 cylinders, high RPM': { disp: 1000, cyl: 16, idle: 1500, cruise: 6000, rpm: 15000, red: 16000 },
    'tiny engine, 16 cylinders, high RPM': { disp: 3, cyl: 16, idle: 1500, cruise: 6000, rpm: 15000, red: 16000 },
    'huge engine, 1 cylinder, low RPM': { disp: 1000, cyl: 1, idle: 600, cruise: 1200, rpm: 2000, red: 2500 },
  };
  let nChecks = 0;
  for (const tab of tabs) {
    const t0 = Date.now();
    // (a)+(b) defaults, in both unit systems
    let pg = await open(1280, tab); flushErrs(tab, 'load');
    for (const u of ['imp', 'met', 'imp']) { await pg.click('#u-' + u); await settle(pg); (await scan(pg)).forEach(m => find(tab, 'defaults ' + u, m)); nChecks++; }
    flushErrs(tab, 'units');
    // round trips: base values and results unchanged
    const a = await snap(pg);
    for (let k = 0; k < 3; k++) { await pg.click('#u-met'); await pg.waitForTimeout(100); await pg.click('#u-imp'); await pg.waitForTimeout(100); }
    await settle(pg); const z = await snap(pg);
    for (const [id, v] of a.ins) { const w = z.ins.find(x => x[0] === id); if (!w) continue; nChecks++;
      if (!(v === w[1] || (Number.isNaN(v) && Number.isNaN(w[1])) || Math.abs(v - w[1]) <= 1e-9 * Math.max(1, Math.abs(v)))) find(tab, 'round trip', id + ' ' + v + ' became ' + w[1]); }
    if (a.figs !== z.figs) find(tab, 'round trip', 'results changed after inches <-> mm round trips');
    const fs = await fields(pg);
    // extreme scenarios, each from the defaults
    for (const [name, sc] of Object.entries(SCEN)) {
      const kv = fs.map(f => [f.id, sc[role(f)]]).filter(x => x[1] != null);
      if (!kv.length) continue;
      await pg.close(); pg = await open(1280, tab); errs = [];
      await setMany(pg, kv); await settle(pg); nChecks++;
      (await scan(pg)).forEach(m => find(tab, name, m)); flushErrs(tab, name);
      await pg.click('#u-met'); await settle(pg); (await scan(pg)).forEach(m => find(tab, name + ' (mm)', m)); flushErrs(tab, name + ' (mm)');
    }
    // boost on and off, every select option (one select at a time, from the defaults)
    if (SELECTS) {
      await pg.close(); pg = await open(1280, tab); errs = [];
      for (const f of fs.filter(f => f.opts && f.opts.length > 1)) {
        for (const o of f.opts) { await setMany(pg, [[f.id, o]]); await pg.waitForTimeout(120); nChecks++;
          (await scan(pg)).forEach(m => find(tab, f.id + '=' + o, m)); flushErrs(tab, f.id + '=' + o); }
        await setMany(pg, [[f.id, f.v]]); await pg.waitForTimeout(80);
      }
    }
    // the fields a choice brings up: a custom engine with 1 and 16 cylinders, every boosted induction at 0 and 40 psi
    for (const f of fs.filter(f => f.opts && (/-eng$/.test(f.id) && f.opts.includes('custom') || /-ind$/.test(f.id)))) {
      for (const o of /-eng$/.test(f.id) ? ['custom'] : f.opts.filter(o => o !== f.v)) {
        await pg.close(); pg = await open(1280, tab); errs = [];
        await setMany(pg, [[f.id, o]]); await settle(pg);
        const more = (await fields(pg)).filter(g => !fs.some(h => h.id === g.id) && g.tag === 'INPUT');
        const cyl = more.filter(g => /cyl/.test(g.id)), boost = more.filter(g => /boost/.test(g.id));
        for (const [what, kv] of [['1 cylinder', cyl.map(g => [g.id, 1])], ['16 cylinders', cyl.map(g => [g.id, 16])], ['no boost', boost.map(g => [g.id, 0])], ['40 psi', boost.map(g => [g.id, 40])]]) {
          if (!kv.length) continue;
          await setMany(pg, kv); await settle(pg); nChecks++;
          (await scan(pg)).forEach(m => find(tab, f.id + '=' + o + ', ' + what, m)); flushErrs(tab, f.id + '=' + o + ', ' + what);
        }
        if (!cyl.length && !boost.length) { nChecks++; (await scan(pg)).forEach(m => find(tab, f.id + '=' + o, m)); flushErrs(tab, f.id + '=' + o); }
      }
    }
    // optional fields blank, then zero: numeric fields that are blank or 0 by default, and every field whose label
    // says blank / 0 skips or switches it off
    const opt = fs.filter(f => f.tag === 'INPUT' && f.kind !== 'text' && (f.v === '' || +f.v === 0 || /blank|\b0\b|none|skip/i.test(f.lab)));
    for (const v of [null, 0]) {
      if (!opt.length) break;
      await pg.close(); pg = await open(1280, tab); errs = [];
      await setMany(pg, opt.map(f => [f.id, v])); await settle(pg); nChecks++;
      (await scan(pg)).forEach(m => find(tab, 'optional fields ' + (v == null ? 'blank' : 'zero'), m)); flushErrs(tab, 'optional ' + v);
    }
    await pg.close();
    // (c) phone width
    pg = await open(400, tab); errs = [];
    for (const u of ['imp', 'met']) {
      await pg.click('#u-' + u).catch(e => find(tab, 'phone', 'units button not clickable: ' + e.message.split('\n')[0])); await settle(pg); nChecks++;
      const r = await pg.evaluate(() => {
        const out = []; const W = innerWidth, de = document.documentElement;
        if (de.scrollWidth > W + 1) out.push('page scrolls sideways: ' + de.scrollWidth + ' px wide in a ' + W + ' px window' +
          (() => { const w = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > W + 1 && getComputedStyle(e).position !== 'fixed'; })
            .filter(e => ![...e.children].some(c => c.getBoundingClientRect().right > W + 1)).slice(0, 3); return w.length ? ' (widest: ' + w.map(e => e.tagName.toLowerCase() + (e.id ? '#' + e.id : e.className ? '.' + String(e.className.baseVal ?? e.className).split(' ')[0] : '')).join(', ') + ')' : ''; })());
        const sec = document.querySelector('section.panel:not([hidden]),section.panel-wide:not([hidden])');
        const scrolls = e => { for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
        for (const c of sec.querySelectorAll('input,select,button,textarea')) {
          if (!c.offsetParent || c.type === 'hidden') continue;
          const r = c.getBoundingClientRect(); if (!r.width && !r.height) continue;
          const name = c.id || (c.innerText || c.name || c.type).trim().slice(0, 30);
          if (!scrolls(c) && (r.left < -1 || r.right > W + 1)) out.push('control off screen: ' + name + ' (' + Math.round(r.left) + '..' + Math.round(r.right) + ')');
          if (r.width < 16 || (r.height < 16 && c.type !== 'range')) out.push('control too small to use: ' + name + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
        }
        return [...new Set(out)].slice(0, 10);
      });
      r.forEach(m => find(tab, 'phone ' + u, m));
    }
    flushErrs(tab, 'phone'); await pg.close();
    console.log(tab + ': ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s, ' + finds.filter(f => f.startsWith(tab + ' ')).length + ' findings');
  }
  finds.forEach(f => console.log('FAIL ' + f));
  console.log('sweep_ui: ' + tabs.length + ' tabs, ' + nChecks + ' checks, ' + (finds.length ? finds.length + ' FAIL' : 'all pass'));
  await b.close(); process.exit(finds.length ? 1 : 0);
})();
