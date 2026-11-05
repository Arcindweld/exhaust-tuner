// Every tab with random inputs: numbers drawn around each field's own value (0.3x to 3x), plus hostile values
// (0, negative, huge, blank, text), selects at random. After each round: no page error, and no NaN / Infinity /
// undefined / [object in the visible results. Seeded, so a failure repeats: FUZZ_SEED=n, FUZZ_ROUNDS=n.
//   node tests/fuzz_ui.js            (from web/)
const { chromium } = require('playwright');
(async () => {
  const seed = +(process.env.FUZZ_SEED || 20261105), rounds = +(process.env.FUZZ_ROUNDS || 12);
  const b = await chromium.launch(); const errs = [];
  const fresh = async () => { const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.on('pageerror', e => errs.push(e.message)); if (process.env.FUZZ_LOG) { p.on('console', m => { if (/^SET /.test(m.text())) console.log('   ' + m.text()); }); await p.addInitScript(() => { window.__fuzzLog = 1; }); } await p.goto('file://' + process.cwd() + '/index.html'); await p.waitForTimeout(600); return p; };
  const metric = process.env.FUZZ_UNITS === 'met';
  const fresh0 = fresh; const fresh2 = async () => { const p = await fresh0(); if (metric) { await p.click('#u-met'); await p.waitForTimeout(150); } return p; };
  let pg = await fresh2();
  const tabs = (await pg.evaluate(() => [...document.querySelectorAll('[data-tab]')].map(x => x.dataset.tab).filter((v, i, a) => a.indexOf(v) === i))).filter(t => !process.env.FUZZ_TABS || process.env.FUZZ_TABS.split(',').includes(t));
  const fails = [];
  for (const tab of tabs) {
    await pg.evaluate(t => { location.hash = t; }, tab); await pg.waitForTimeout(400);
    for (let r = 0; r < rounds; r++) {
      const e0 = errs.length; if (process.env.FUZZ_LOG) console.log('.. ' + tab + ' ' + r);
      const did = await pg.evaluate(([tab, s]) => {
        let x = s >>> 0; const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
        const sec = document.querySelector('section.panel:not([hidden])') || document.body, log = [];
        const ins = [...sec.querySelectorAll('input[type=number],input[inputmode=decimal],input[inputmode=numeric]')].filter(i => i.offsetParent && !i.disabled);
        const sels = [...sec.querySelectorAll('select')].filter(i => i.offsetParent && !i.disabled && i.options.length > 1);
        const pick = a => a[Math.floor(rnd() * a.length)];
        const n = Math.min(ins.length, 2 + Math.floor(rnd() * 5));
        for (let k = 0; k < n; k++) {
          const i = pick(ins), v0 = parseFloat(i.value), u = rnd(); let v;
          if (u < 0.08) v = '0'; else if (u < 0.13) v = '-' + (Number.isFinite(v0) ? Math.abs(v0) || 1 : 1); else if (u < 0.17) v = '1e9';
          else if (u < 0.21) v = ''; else if (u < 0.23) v = 'abc';
          else v = String(+((Number.isFinite(v0) && v0 !== 0 ? v0 : 1) * (0.3 + 2.7 * rnd())).toPrecision(4));
          if (window.__fuzzLog) console.log('SET ' + (i.id || i.dataset.k) + '=' + v); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true }));
          log.push((i.id || i.dataset.k || i.className) + '=' + v);
        }
        const cbs = [...sec.querySelectorAll('input[type=checkbox]')].filter(i => i.offsetParent && !i.disabled);
        if (cbs.length && rnd() < 0.35) { const c = pick(cbs); c.click(); log.push((c.id || c.className) + '=' + c.checked); }
        if (sels.length && rnd() < 0.6) { const s2 = pick(sels), o = pick([...s2.options].filter(o => !o.disabled)); if (o) { if (window.__fuzzLog) console.log('SET ' + (s2.id || s2.dataset.k) + '=' + o.value); s2.value = o.value; s2.dispatchEvent(new Event('change', { bubbles: true })); log.push((s2.id || s2.dataset.k || s2.className) + '=' + o.value); } }
        return log;
      }, [tab, seed + 7919 * r + tab.length * 104729]);
      if (process.env.FUZZ_LOG) console.log('   ' + did.join(', '));
      await pg.waitForTimeout(150);
      const bad = await pg.evaluate(() => { const sec = document.querySelector('section.panel:not([hidden])') || document.body;
        const re = /\b(NaN|Infinity|undefined|\[object \w+\])\b/, w = document.createTreeWalker(sec, NodeFilter.SHOW_TEXT); let n;
        while ((n = w.nextNode())) { if (!re.test(n.textContent) || !n.parentElement.offsetParent) continue; const p = n.parentElement, s = p.closest('.sec'), h = s && s.querySelector('h3');
          return (h ? h.textContent + ' | ' : '') + (p.closest('tr') || p).innerText.replace(/\s+/g, ' ').slice(0, 160); }
        return ''; });
      const pe = errs.slice(e0);
      const state = (bad || pe.length) ? await pg.evaluate(() => { const sec = document.querySelector('section.panel:not([hidden])'); return [...sec.querySelectorAll('input,select')].filter(i => i.id && i.offsetParent).map(i => i.id + '=' + i.value).join(' '); }) : '';
      if (bad || pe.length) { fails.push(tab + ' round ' + r + ': ' + (pe.length ? 'PAGEERROR ' + pe.join(' | ') : '') + (bad ? ' TEXT "' + bad + '"' : '') + '\n    after ' + did.join(', ') + '\n    state ' + state); }
    }
    // the next tab starts from the defaults, in a fresh context (nothing saved carries over)
    await pg.context().close(); pg = await fresh2();
  }
  fails.forEach(f => console.log('FAIL ' + f));
  console.log('fuzz_ui' + (metric ? ' (metric)' : '') + ': ' + tabs.length + ' tabs x ' + rounds + ' rounds, ' + (fails.length ? fails.length + ' FAIL' : 'all pass'));
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
