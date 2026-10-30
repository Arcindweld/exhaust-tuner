// Browser sweep: every tab in phone/desktop, light/dark, simple/expert, imperial/metric, then every vehicle preset.
const { chromium } = require('playwright');
const FILE = process.argv[2] || 'index.html';
const SHOTS = process.argv.includes('--shots');
const TABS = ['quick', 'four-stroke', 'two-stroke', 'sound', 'headers', 'crossover', 'mufflers', 'cats', 'boom-tubes', 'options'];
(async () => {
  const b = await chromium.launch();
  const out = [];
  const badRe = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object/;
  const run = async (name, w, scheme, fn) => {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => out.push(name + ' PAGEERROR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts|net::/.test(m.text())) out.push(name + ' console ' + m.text()); });
    await pg.goto('file://' + process.cwd() + '/' + FILE);
    await pg.addStyleTag({ content: '[hidden]{display:none!important}' });
    await fn(pg, name);
    await ctx.close();
  };
  const txt = pg => pg.evaluate(() => [...document.querySelectorAll('[role=tabpanel]:not([hidden])')].map(s => s.innerText).join('\n') + '\n' + document.getElementById('v-note').innerText);
  const check = async (pg, tag) => {
    await pg.waitForTimeout(60);
    const t = await txt(pg);
    if (badRe.test(t)) { const m = t.match(/.{0,70}(NaN|undefined|Infinity|\[object).{0,40}/); out.push(`${tag} BAD TEXT: ${m && m[0].replace(/\n/g, ' / ')}`); }
    const o = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (o > 0) out.push(`${tag} overflow ${o}px`);
    const empty = await pg.evaluate(() => { const p = document.querySelector('[role=tabpanel]:not([hidden])'); return p ? p.innerText.trim().length : 0; });
    if (empty < 80) out.push(`${tag} panel looks empty (${empty} chars)`);
    return t;
  };
  let combos = 0;
  for (const [vp, w] of [['phone', 390], ['desk', 1280]]) {
    for (const scheme of ['light', 'dark']) {
      await run(`${vp}-${scheme}`, w, scheme, async (pg, name) => {
        for (const mode of ['simple', 'expert']) {
          await pg.click('#m-' + mode);
          for (const units of ['imp', 'met']) {
            await pg.click('#u-' + units);
            for (const tab of TABS) {
              await pg.evaluate(h => location.hash = h, tab);
              await check(pg, `${name} ${mode} ${units} ${tab}`);
              combos++;
              if (SHOTS && units === 'imp' && ((mode === 'expert' && scheme === 'light') || (mode === 'simple' && scheme === 'dark' && vp === 'phone'))) {
                await pg.screenshot({ path: `v5-${vp}-${scheme}-${mode}-${tab}.png`, fullPage: true });
              }
            }
          }
        }
      });
    }
  }
  out.push('tab combos checked: ' + combos);
  // every vehicle preset, desktop, expert, both unit systems
  await run('presets', 1280, 'light', async (pg) => {
    await pg.click('#m-expert');
    // the Type selector splits cars/trucks from motorcycles; sweep both lists
    const setClass = async (c) => pg.evaluate(c => { const el = document.getElementById('v-class'); el.value = c; el.dispatchEvent(new Event('change', { bubbles: true })); }, c);
    const vals = [];
    for (const c of ['car', 'bike']) {
      await setClass(c);
      const vs = await pg.$$eval('#v-pick option', os => os.map(o => [o.value, o.textContent]).filter(x => x[0] !== ''));
      out.push('presets in the picker (' + c + '): ' + vs.length);
      vs.forEach(x => vals.push([x[0], x[1], c]));
    }
    await setClass('car');
    let checked = 0;
    for (const units of ['imp', 'met']) {
      await pg.click('#u-' + units);
      // every 7th preset (880 presets × tabs × units is too slow for one run); a separate sweep applies every preset once
      const SAMPLE = process.env.ALL_PRESETS ? vals : vals.filter((_, i) => i % 7 === 0);
      await setClass('car'); let cls = 'car';
      for (const [v, label, c] of SAMPLE) {
        if (c !== cls) { await setClass(c); cls = c; }
        await pg.selectOption('#v-pick', v);
        for (const tab of ['quick', 'four-stroke', 'sound', 'headers', 'mufflers', 'cats', 'boom-tubes']) {
          await pg.evaluate(h => location.hash = h, tab);
          const t = await check(pg, `preset ${units} [${label}] ${tab}`);
          checked++;
          if (tab === 'sound' && units === 'imp') {
            const key = await pg.evaluate(() => document.getElementById('sound-key').innerText.replace(/\n+/g, ' | '));
            if (/fill in|enter|pick/i.test(key)) out.push(`preset [${label}] sound key: ${key.slice(0, 160)}`);
          }
        }
      }
    }
    out.push('preset renders checked: ' + checked);
    // spot check what a preset fills in
    await pg.click('#u-imp');
    await setClass('car');
    const pick = vals.find(x => /Chevelle/.test(x[1]));
    await pg.selectOption('#v-pick', pick[0]);
    out.push('Chevelle: s-eng=' + await pg.inputValue('#s-eng') + ' s-red=' + await pg.inputValue('#s-red') + ' s-cruise=' + await pg.inputValue('#s-cruise') + ' h-rpm=' + await pg.inputValue('#h-rpm') + ' h-trq=' + await pg.inputValue('#h-trq') + ' f-disp=' + await pg.inputValue('#f-disp') + ' c-disp=' + await pg.inputValue('#c-disp') + ' b-red=' + await pg.inputValue('#b-red') + ' f-n=' + await pg.inputValue('#f-n'));
    out.push('Chevelle note: ' + (await pg.innerText('#v-note')).replace(/\n/g, ' / '));
    const amg = vals.find(x => /AMG/.test(x[1]));
    await pg.selectOption('#v-pick', amg[0]);
    out.push('AMG: h-ports=' + await pg.inputValue('#h-ports') + ' s-ind=' + await pg.inputValue('#s-ind') + ' h-eng=' + await pg.inputValue('#h-eng'));
    const rx = vals.find(x => /RX-7/.test(x[1]));
    await pg.selectOption('#v-pick', rx[0]);
    await pg.evaluate(() => location.hash = 'headers');
    out.push('RX-7 headers key: ' + (await pg.innerText('#h-key')).replace(/\n+/g, ' | ').slice(0, 200));
    const lt6 = vals.find(x => /LT6/.test(x[1]));
    await pg.selectOption('#v-pick', lt6[0]);
    await pg.evaluate(() => location.hash = 'headers');
    const t = await txt(pg);
    out.push('LT6 headers mentions flat-plane order row: ' + /Flat-plane V8 \(Chevrolet LT6\)/.test(t));
    if (SHOTS) {
      await pg.evaluate(() => location.hash = 'sound');
      await pg.screenshot({ path: 'v5-preset-lt6-sound.png', fullPage: false });
      await setClass('bike');
      const r1 = vals.find(x => /R1/.test(x[1]));
      await pg.selectOption('#v-pick', r1[0]);
      await pg.screenshot({ path: 'v5-preset-r1-sound.png', fullPage: true });
    }
  });
  await b.close();
  console.log(out.join('\n'));
})();
