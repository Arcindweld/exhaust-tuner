// The K24 turbo journey as a first-time builder walks it (usability audit 2026-11-14, docs/USABILITY_AUDIT_2026-11-14.md):
// Honda K24A2, Turbocharged, 450 hp target, Precision GEN2 PT5862 with the 0.63 A/R T3 / 4-bolt housing, Use these sizes,
// Use this intercooler, tubular manifold, port spacing 3.661 in (93 mm), at 1440 px and at 400 px.   node tests/easyflow_ui.js
// (from web/)
// Checks: the glance card ("Your turbo build at a glance") sits at the top of the result column, and each of its sizes is
// the value the detail sections work out (read back from the sections' own objects and from the step-by-step lines, which
// the sections fill); the advanced inputs of the boosted groups are collapsed in Simple mode, the box remembers being
// opened, and a "changed" marker names any input in it that is not at its default; every measurement in a result cell of
// the boosted sections, the glance card and the turbo build sheet is given in both unit systems (power and torque are
// left out of that check: hp with kW is shown where the page states a power, but makers' ratings are quoted as published);
// no horizontal page scroll at 400 px and every boosted table either fits or scrolls inside its own box; the measurement
// list leads to its inputs; a project saved and loaded gives the same glance card; no console errors; field edits timed.
const { chromium } = require('playwright');
const { reads, settle } = require('./settle');
// a measurement in one unit system only: number + unit with no number + unit of the same quantity in the other system within
// 70 characters in the same cell. Units of one quantity: [quantity, system]
const SYS = { 'in': ['L', 'i'], 'ft': ['L', 'i'], 'mm': ['L', 'm'], 'cm': ['L', 'm'], 'm': ['L', 'm'],
  'psi': ['P', 'i'], 'psia': ['P', 'i'], 'psig': ['P', 'i'], 'inH₂O': ['P', 'i'], 'kPa': ['P', 'm'], 'Pa': ['P', 'm'], 'bar': ['P', 'm'], 'MPa': ['P', 'm'],
  '°F': ['T', 'i'], '°R': ['T', 'i'], '°C': ['T', 'm'], 'K': ['T', 'm'],
  'lb/min': ['F', 'i'], 'lb/h': ['F', 'i'], 'kg/s': ['F', 'm'], 'g/s': ['F', 'm'], 'kg/h': ['F', 'm'],
  'cfm': ['Q', 'i'], 'gpm': ['Q', 'i'], 'L/s': ['Q', 'm'], 'L/min': ['Q', 'm'],
  'lb': ['W', 'i'], 'oz': ['W', 'i'], 'kg': ['W', 'm'], 'g': ['W', 'm'], 'lbf': ['N', 'i'], 'N': ['N', 'm'],
  'ft/s': ['V', 'i'], 'mph': ['V', 'i'], 'm/s': ['V', 'm'], 'km/h': ['V', 'm'],
  'in²': ['A', 'i'], 'mm²': ['A', 'm'], 'cm²': ['A', 'm'], 'cu in': ['C', 'i'], 'L': ['C', 'm'], 'cc': ['C', 'm'] };
const ONE = new Set(['m', 'K', 'N', 'g', 'L']);   // one-letter units: need a space before them (304L, 0W-40 are not)
const UNITS = Object.keys(SYS).sort((a, b) => b.length - a.length).map(u => u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
const RE = new RegExp('(?<![\\d./·-])(\\d[\\d,]*(?:\\.\\d+)?)(\\s?)(' + UNITS.join('|') + ')(?![A-Za-z0-9²³/·√-])', 'g');
function loneUnits(text, win = 70) {
  const t = text.replace(/[“"][^”"]*[”"]/g, '').replace(/\bbar and plate\b/g, ''), m = []; let x; RE.lastIndex = 0;
  while ((x = RE.exec(t))) { if (ONE.has(x[3]) && !x[2]) continue; m.push({ i: x.index, e: x.index + x[0].length, s: x[0], d: SYS[x[3]][0], sy: SYS[x[3]][1] }); }
  return m.filter((a, k) => !m.some((b, j) => j !== k && b.d === a.d && b.sy !== a.sy && (b.i >= a.e ? b.i - a.e : a.i - b.e) <= win))
    .map(a => a.s + ' in “…' + t.slice(Math.max(0, a.i - 50), a.e + 30).replace(/\s+/g, ' ') + '…”');
}
const BOOSTED = ['turbo-build-step-by-step', 'charge-pipes', 'inlet-and-charge-pipes-design-and-sizing', 'turbo-and-intercooler-sizing', 'intercooler-sizing',
  'your-compressor-map', 'turbo-options', 'intercooler-options-and-cooling-capacity', 'oil-cooling-and-turbo-oil-lines', 'where-to-put-them-on-this-build',
  'turbo-manifold', 'exhaust-after-the-turbine', 'boosted-intake', 'turbine-housing-a-r'];
const mmOf = s => [...String(s).matchAll(/(-?[\d.]+) mm(?!²)/g)].map(x => +x[1]);
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const errs = [];
  async function open(width, ctx) {
    ctx = ctx || await b.newContext({ viewport: { width, height: width < 600 ? 860 : 900 } });
    const pg = await ctx.newPage(); reads(pg);
    pg.on('pageerror', e => errs.push(width + ': ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(width + ' console: ' + m.text()); });
    await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900); await settle(pg);
    return { pg, ctx };
  }
  const setv = async (pg, id, v) => { const ms = await pg.evaluate(([id, v]) => { const el = document.getElementById(id), t0 = performance.now(); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); return performance.now() - t0; }, [id, v]); await settle(pg); return ms; };
  const chg = async (pg, s, v) => { await pg.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [s, v]); await settle(pg); };
  async function journey(pg) {
    await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
      s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
    await settle(pg);
    await setv(pg, 'i-ind', 'turbo'); await setv(pg, 'i-hp', '450');
    const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await chg(pg, 'select.tsox[data-k="turbo"]', String(ti));
    const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti); await chg(pg, 'select.tsox[data-k="hs"]', String(hs));
    await pg.click('button[data-tsuse]'); await settle(pg);
    const ic = await pg.$('button[data-icuse]:not([disabled])'); if (ic) { await ic.click(); await settle(pg); }
    await setv(pg, 'i-mani', 'tube'); await setv(pg, 'i-msp', (93 / 25.4).toFixed(3));
  }
  const glance = pg => pg.$$eval('#tg-glance tr[data-gl]', rs => Object.fromEntries(rs.map(r => [r.dataset.gl, { v: r.querySelector('.gl-v').textContent, n: (r.querySelector('.gl-n') || {}).textContent || '', go: (r.querySelector('[data-tgo]') || {}).dataset ? r.querySelector('[data-tgo]').dataset.tgo : '' }])));

  // ---- desktop, Simple mode (the default), imperial (the default)
  let { pg, ctx } = await open(1440);
  ok(await pg.evaluate(() => document.body.classList.contains('simple')), 'starts in Simple mode');
  await journey(pg);
  const top = await pg.evaluate(() => { const g = document.getElementById('tg-glance'); return g ? { first: g.parentElement.id === 'i-key' && g === g.parentElement.firstElementChild, y: g.getBoundingClientRect().top + window.scrollY } : null; });
  ok(top && top.first && top.y < 900, 'the glance card is the first thing in the result column and starts on the first screen (top at ' + (top && Math.round(top.y)) + ' px of 900)');
  const order = await pg.$$eval('#i-details .sec', s => s.map(x => x.dataset.sec));
  ok(order[0] === 'turbo-build-step-by-step' && order.indexOf('exhaust-after-the-turbine') < order.indexOf('airflow-and-tube-size'), 'the turbo sections come straight after the step-by-step list, before the inlet tube’s (' + order.slice(0, 4).join(', ') + ' …)');
  const G = await glance(pg);
  const want = ['power', 'turbo', 'hsg', 'comp', 'co', 'inlet', 'hot', 'ic', 'cold', 'tb', 'bov', 'wg', 'run', 'col', 'dp', 'oil'];
  ok(want.every(k => G[k]), 'glance rows: ' + Object.keys(G).join(', ') + (want.filter(k => !G[k]).length ? ' (missing ' + want.filter(k => !G[k]).join(', ') + ')' : ''));
  ok(Object.keys(G).filter(k => k !== 'power').every(k => G[k].go), 'every size row has a Go button to its section');
  // the glance card against the sections' own results (single source: the card reads the build sheet's rows)
  const S = await pg.evaluate(() => { const L = window.__tsLast(), X = window.__tsx.last(), M = window.__mfd.last(), T = window.__tg.TG(), w = document.getElementById('i-cpw')._b > 0 ? document.getElementById('i-cpw')._b : 1.651;
    const steps = Object.fromEntries([...document.querySelectorAll('#tg-steps > li')].map(li => [li.dataset.step, li.querySelector('.tg-line').textContent]));
    const sheet = window.__tg.sheet();
    const B = id => document.getElementById(id)._b;
    return { dh: B('i-cpd'), dc: L.dc, dco: B('i-cod'), w, dpOD: X ? X.G.d + 2 * X.G.w : null, run: M ? { id: M.c.id, od: M.c.od, L: M.L, dcol: M.dcol } : null, steps,
      parts: Object.fromEntries(sheet.parts.map(p => [p[0], p[1] + ' | ' + p[2]])), G: T.G ? { boost: T.G.boost, map: T.G.map, wa: T.G.wa } : null }; });
  const has = (s, mm, tol = 0.051) => mmOf(s).some(x => Math.abs(x - mm) <= tol);
  ok(has(G.hot.v, S.dh) && has(G.hot.v, S.dh + 2 * S.w) && has(S.steps.pipes, S.dh), 'hot side pipe: ID ' + S.dh.toFixed(1) + ' mm in the card and in step 5 (Inlet and charge pipes): ' + G.hot.v);
  ok(has(G.cold.v, S.dc) && has(S.steps.pipes, S.dc), 'cold side pipe: ID ' + S.dc.toFixed(1) + ' mm in the card and in step 5: ' + G.cold.v);
  ok(has(G.comp.v, S.dco) && has(G.co.v, S.dco), 'compressor outlet ' + S.dco.toFixed(1) + ' mm in the card (and its cone): ' + G.co.v);
  ok(S.dpOD && has(G.dp.v, S.dpOD) && has(S.steps.exh, S.dpOD), 'downpipe OD ' + (S.dpOD || 0).toFixed(1) + ' mm in the card and in the exhaust step: ' + G.dp.v);
  ok(S.run && has(G.run.v, S.run.id) && has(G.run.v, S.run.L, 0.51) && has(S.steps.mani, S.run.L, 0.51) && has(G.col.v, S.run.dcol), 'manifold runners ID ' + (S.run ? S.run.id.toFixed(1) : '?') + ' mm × ' + (S.run ? S.run.L.toFixed(0) : '?') + ' mm, collector ' + (S.run ? S.run.dcol.toFixed(1) : '?') + ' mm: card and Turbo manifold step agree');
  const bovMm = mmOf(G.bov.v)[0], wgMm = mmOf(G.wg.v)[0];
  ok(bovMm > 0 && has(S.steps.valves, bovMm) && mmOf(G.bov.n).every(x => has(S.steps.valves, x, 0.51)), 'blow-off valve size and position in the card are the placement section’s (step 7): ' + G.bov.v + '; ' + G.bov.n);
  ok(wgMm > 0 && has(S.steps.valves, wgMm) && mmOf(G.wg.n).slice(0, 2).every(x => has(S.steps.valves, x, 0.51)), 'wastegate size and position in the card are the placement section’s: ' + G.wg.v + '; ' + G.wg.n);
  ok(/-4 AN/.test(G.oil.v) && /-10 AN/.test(G.oil.v) && /feed -4 AN, drain -10 AN/.test(S.steps.oil), 'oil feed / drain in the card match the oil step: ' + G.oil.v.replace(/\s+/g, ' '));
  ok(/PT5862/.test(G.turbo.v) && /0\.63 A\/R/.test(G.hsg.v), 'turbo and housing: ' + G.turbo.v + '; ' + G.hsg.v);
  ok(Object.entries({ hot: 'Hot side pipe', cold: 'Cold side pipe', dp: 'Downpipe', bov: 'Blow-off valve', wg: 'Wastegate', col: 'Collector' }).every(([k, n]) => S.parts[n] && S.parts[n].startsWith(G[k].v)), 'every size in the card is the build sheet’s row, word for word');
  // the power row: the target against the boost, Garrett's boost read from the sizing section
  const sizing = await pg.$eval('#i-details .sec[data-sec="turbo-and-intercooler-sizing"]', e => e.innerText);
  const gb = (G.power.n.match(/needs about ([\d.]+) psi/) || [])[1], mp = (sizing.match(/manifold pressure needed ([\d.]+) psia/) || [])[1];
  ok(gb && mp && Math.abs(+gb + 14.696 - +mp) < 0.06 && /do not match/.test(G.power.n), 'power row: 450 hp needs about ' + gb + ' psi boost (the sizing section’s ' + mp + ' psia manifold pressure, less the atmosphere) and says the 8 psi typed does not match');
  ok(/No power estimate yet/.test(G.power.n), 'no simulation run: the card says where the power estimate comes from');

  // ---- both unit systems in every result cell of the boosted sections, the card and the sheet
  for (const u of ['imp', 'met']) {
    await pg.click(u === 'imp' ? '#u-imp' : '#u-met'); await settle(pg);
    const cells = await pg.evaluate(B => { const r = [];
      document.querySelectorAll('#i-details .sec, #tg-glance').forEach(s => { if (s.id !== 'tg-glance' && (!B.includes(s.dataset.sec) || !s.offsetParent)) return;
        s.querySelectorAll('td, th, dd, .tg-line, .gl-v, .gl-n').forEach(c => { if (!c.closest('.cap')) r.push([s.id || s.dataset.sec, c.innerText]); }); });
      const d = window.__tg.doc(), x = document.createElement('div'); x.innerHTML = d.replace(/<svg[\s\S]*?<\/svg>/g, '');
      x.querySelectorAll('td, h1 + p').forEach(c => r.push(['sheet', c.textContent]));
      return r; }, BOOSTED);
    const lone = []; cells.forEach(([s, t]) => loneUnits(t).forEach(z => lone.push(s + ': ' + z)));
    ok(cells.length > 500 && !lone.length, (u === 'imp' ? 'inches' : 'mm') + ' first: ' + cells.length + ' result cells, every measurement in both unit systems' + (lone.length ? '; one system only: ' + lone.join(' | ') : ''));
  }
  await pg.click('#u-imp'); await settle(pg);
  // the checker itself finds a lone unit and passes a pair
  ok(loneUnits('runner 2.12 in long').length === 1 && !loneUnits('runner 2.12 in (53.8 mm) long').length && !loneUnits('oil 0W-40, 304L, EGW 25/75 in').length, 'the lone-unit checker: finds “2.12 in” alone, passes “2.12 in (53.8 mm)”, ignores 0W-40, 304L, 25/75');

  // ---- the advanced inputs
  const adv = () => pg.$$eval('.advbox', bs => bs.map(b => ({ k: b.dataset.advbox, open: b.classList.contains('open'), chg: b.querySelector('.advchg').textContent, vis: [...b.querySelectorAll('.advin > label')].filter(l => l.offsetParent).length, n: b.querySelectorAll('.advin > label').length })));
  let A = await adv();
  ok(A.map(a => a.k).join() === 'cp,mf,dp' && A.every(a => !a.open && a.vis === 0 && a.n > 3), 'three advanced boxes (charge pipes and turbo ' + A[0].n + ', manifold ' + A[1].n + ', exhaust ' + A[2].n + ' inputs), collapsed in Simple mode, nothing inside visible');
  ok(await pg.evaluate(() => ['i-teffm', 'i-tmu', 'i-tfric', 'i-tsa', 'i-tfc', 'i-p3m', 'i-tipk', 'i-xcaf', 'i-mdur'].every(id => document.getElementById(id).closest('.advbox'))), 'turbine efficiency model, work coefficient, bearing friction, turbine size, turbine flow, measured pressure, pressure multiple, pulsing heat transfer, valve period are in the advanced boxes');
  ok(/changed: Turbine housing picked under Turbo options/.test(A[0].chg) && !A[1].chg && !A[2].chg, 'the housing picked under Turbo options shows as changed in its box: “' + A[0].chg + '”');
  const t0 = await pg.evaluate(() => document.getElementById('tg-glance').innerText);
  await setv(pg, 'i-tmu', '0.6');
  await pg.evaluate(() => { const e = document.getElementById('i-xcaf'); e.value = [...e.options].find(o => !o.defaultSelected).value; e.dispatchEvent(new Event('change', { bubbles: true })); }); await settle(pg);
  A = await adv();
  ok(/Compressor work coefficient/.test(A[0].chg) && /Heat transfer, pulsing exhaust/.test(A[2].chg), 'a collapsed box marks the inputs set away from their defaults: “' + A[0].chg + '”, “' + A[2].chg + '”');
  await setv(pg, 'i-tmu', ''); await pg.evaluate(() => { const e = document.getElementById('i-xcaf'); e.value = [...e.options].find(o => o.defaultSelected).value; e.dispatchEvent(new Event('change', { bubbles: true })); }); await settle(pg);
  A = await adv();
  ok(!/work coefficient/.test(A[0].chg) && !A[2].chg && t0 === await pg.evaluate(() => document.getElementById('tg-glance').innerText), 'back to the defaults: the marks go and the card is as before');
  // the measurement list leads to its inputs
  const meas = await pg.$$eval('#tg-measure li', ls => ls.map(l => ({ f: l.dataset.meas, t: l.textContent })));
  ok(meas.map(m => m.f).join() === 'i-p3m,i-lorpm,i-mdur,i-msp,i-tfc,i-tobp' && meas.every(m => /Now: /.test(m.t) && /Goes in “/.test(m.t)), 'what to measure: pressure before the turbine, full-boost RPM, cam events, port spacing, turbine flow, pressure after the turbine; each says what the page uses now and where it goes');
  await pg.evaluate(() => { document.getElementById('tg-measure').open = true; }); await settle(pg);
  await pg.click('#tg-measure li[data-meas="i-p3m"] a[data-field]'); await pg.waitForTimeout(400);
  A = await adv();
  ok(A[0].open && A[0].vis > 3 && await pg.evaluate(() => document.activeElement && document.activeElement.id === 'i-p3m'), '“type it in” opens the advanced box and puts the cursor in the measured pressure field');
  const tm = await setv(pg, 'i-p3m', '18'); A = await adv();
  ok(/Measured pressure before the turbine/.test(A[0].chg), 'typed: marked as changed');
  const sh = await pg.evaluate(() => window.__tg.doc());
  ok(/What to measure on the car to firm this up/.test(sh) && /measured 18\.00 psi/.test(sh), 'the build sheet carries the measurement list, with the measured value');
  await setv(pg, 'i-p3m', '');
  // remembered: a new page in the same browser opens with the box open
  const p2 = (await open(1440, ctx)).pg;
  ok(await p2.evaluate(() => document.querySelector('.advbox[data-advbox="cp"]').classList.contains('open') && !document.querySelector('.advbox[data-advbox="mf"]').classList.contains('open')), 'the box opened stays open in a new page; the others stay shut');
  await p2.close();
  // Expert mode: every input shown
  await pg.click('#m-expert'); await settle(pg); A = await adv();
  ok(A.every(a => a.vis === a.n), 'Expert mode shows every advanced input');
  await pg.click('#m-simple'); await settle(pg);
  // timing: a field edit re-renders the tab synchronously
  const times = []; for (const v of ['8.5', '8', '8.5', '8']) times.push(await setv(pg, 'i-boost', v));
  times.push(tm); const tmax = Math.max(...times);
  console.log('field edit times (ms): ' + times.map(t => t.toFixed(0)).join(', '));
  ok(tmax < 1500, 'a field edit renders in ' + tmax.toFixed(0) + ' ms at most (the audit’s target is 300 ms on a quiet machine)');

  // ---- project save and load: the same card
  const card = await pg.evaluate(() => document.getElementById('tg-glance').innerText);
  const snap = await pg.evaluate(() => window.__proj.snapshot('K24 turbo'));
  await ctx.close();
  ({ pg, ctx } = await open(1440));
  await pg.evaluate(d => window.__proj.apply(d), snap); await settle(pg); await pg.waitForTimeout(300); await settle(pg);
  const card2 = await pg.evaluate(() => { const g = document.getElementById('tg-glance'); return g ? g.innerText : ''; });
  ok(card2 === card, 'a project saved and loaded into a fresh page gives the same glance card' + (card2 === card ? '' : ': ' + card2.slice(0, 300)));
  await ctx.close();

  // ---- phone, 400 px: no page scroll sideways; every boosted table fits or scrolls in its own box
  for (const theme of ['light', 'dark']) {
    const c = await b.newContext({ viewport: { width: 400, height: 860 }, colorScheme: theme });
    ({ pg } = await open(400, c)); await journey(pg);
    const lay = await pg.evaluate(B => { const de = document.documentElement, bad = [];
      document.querySelectorAll('#i-details .sec, #tg-glance').forEach(s => { if (s.id !== 'tg-glance' && !B.includes(s.dataset.sec)) return;
        s.querySelectorAll('table').forEach(t => { if (!t.offsetParent) return; const w = t.parentElement, ox = getComputedStyle(w).overflowX;
          if (t.getBoundingClientRect().width > w.clientWidth + 1 && !(ox === 'auto' || ox === 'scroll')) bad.push((s.id || s.dataset.sec) + ' ' + Math.round(t.getBoundingClientRect().width) + ' px in ' + w.clientWidth); }); });
      const g = document.getElementById('tg-glance');
      return { sw: de.scrollWidth, iw: window.innerWidth, bad, g: g ? Math.round(g.getBoundingClientRect().right) : 0 }; }, BOOSTED);
    ok(lay.sw <= lay.iw && !lay.bad.length && lay.g <= lay.iw, '400 px, ' + theme + ': page ' + lay.sw + ' px wide in ' + lay.iw + ', glance card inside, every boosted table fits or scrolls in its own box' + (lay.bad.length ? ': ' + lay.bad.join('; ') : ''));
    await c.close();
  }

  ok(!errs.length, 'no page or console errors' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  await b.close();
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
