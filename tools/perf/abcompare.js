// A/B: the page before and after a change given the same seeded edits on one tab; every panel's innerHTML compared after
// each edit (the u2 pass run first on both).   node tools/perf/abcompare.js OLD.html NEW.html TAB [edits=60] [seed=1]
// (development check for the bit-exact kernels of docs/PERF_2026-11-18.md; web/tests/incremental_ui.js is the permanent
// guard)
const { chromium } = require('playwright');
const { settle } = require('../../web/tests/settle');
const [A, B, tab, N = '60', SEED = '1'] = process.argv.slice(2);
const PANEL = { quick: 'panel-quick', 'four-stroke': 'panel-four', 'two-stroke': 'panel-two', sound: 'panel-sound', headers: 'panel-headers', crossover: 'panel-cross', mufflers: 'panel-muf', cats: 'panel-cat', 'boom-tubes': 'panel-boom', hangers: 'panel-hang', intake: 'panel-intake', parts: 'panel-parts', options: 'panel-opt' };
function rng(s) { return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }
(async () => {
  const b = await chromium.launch();
  const open = async f => { const pg = await b.newPage({ viewport: { width: 1440, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + f + '#' + tab); await pg.waitForTimeout(700); await settle(pg); return [pg, errs]; };
  const [pa, ea] = await open(A), [pb, eb] = await open(B);
  if (process.env.K24) for (const pg of [pa, pb]) { await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); s('i-ind', 'turbo'); }); await settle(pg); }
  const r = rng(+SEED); let bad = 0;
  const snap = pg => pg.evaluate(async id => { await new Promise(res => requestIdleCallback(res, { timeout: 500 })); await new Promise(res => setTimeout(res, 80));
    return [...document.querySelectorAll('[role=tabpanel]')].map(p => p.id + '\n' + p.innerHTML).join('\n\u0000'); }, PANEL[tab]);
  for (let i = 0; i < +N; i++) {
    const pick = r(), f = r();
    const act = await pa.evaluate(([panel, pick, f]) => { const p = document.getElementById(panel);
      const els = [...p.querySelectorAll('.area-inputs input[id], .area-inputs select[id]')].filter(e => e.getClientRects().length && !e.disabled && e.type !== 'file' && e.type !== 'checkbox' && e.type !== 'button');
      const e = els[Math.floor(pick * els.length)]; if (!e) return null;
      if (e.tagName === 'SELECT') { const o = [...e.options].filter(o => !o.disabled); return [e.id, 'sel', o[Math.floor(f * o.length)].value]; }
      const v = parseFloat(e.value); return [e.id, 'num', String(Number.isFinite(v) ? +(v * (0.6 + 0.8 * f)).toPrecision(4) : +(10 * f + 1).toFixed(2))]; }, [PANEL[tab], pick, f]);
    if (!act) continue;
    for (const pg of [pa, pb]) { await pg.evaluate(([id, k, v]) => { const e = document.getElementById(id); if (!e) return; e.value = v; e.dispatchEvent(new Event(k === 'sel' ? 'change' : 'input', { bubbles: true })); }, act); await settle(pg); }
    const [x, y] = [await snap(pa), await snap(pb)];
    if (x !== y) { bad++; let k = 0; while (k < x.length && x[k] === y[k]) k++; console.log('DIFF after', i, act.join(' '), '\n  A:', x.slice(Math.max(0, k - 120), k + 120), '\n  B:', y.slice(Math.max(0, k - 120), k + 120)); if (bad > 3) break; }
  }
  console.log(tab, 'edits', N, 'differences', bad, 'page errors', ea.length, eb.length, ea.concat(eb).slice(0, 3));
  await b.close(); process.exit(bad ? 1 : 0);
})();
