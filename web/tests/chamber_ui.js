const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = []; const bad = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object/;
  for (const [w, scheme] of [[390, 'dark'], [1280, 'light']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    const pg = await ctx.newPage(); pg.on('pageerror', e => out.push('PAGEERROR ' + e.message));
    await pg.goto('file://' + process.cwd()+'/index.html#four-stroke');
    await pg.addStyleTag({ content: '[hidden]{display:none!important}' });
    for (const mode of ['simple', 'expert']) {
      await pg.click('#m-' + mode);
      for (const u of ['imp', 'met']) {
        await pg.click('#u-' + u);
        for (const n of ['1', '4']) {
          await pg.selectOption('#f-n', n);
          for (const t of ['can', 'wrap', 'bulge', 'none']) {
            await pg.selectOption('#f-ch', t); await pg.waitForTimeout(40);
            const txt = await pg.evaluate(() => document.getElementById('panel-four').innerText);
            const tag = `${w} ${mode} ${u} n=${n} ${t}`;
            if (bad.test(txt)) out.push(tag + ' BAD ' + (txt.match(/.{0,60}(NaN|undefined|Infinity|\[object).{0,30}/) || [''])[0]);
            const o = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
            if (o > 0) out.push(tag + ' overflow ' + o);
            const has = await pg.evaluate(() => [...document.querySelectorAll('#four-details .sec h3')].some(h => /Resonance chamber/i.test(h.textContent)));
            if ((t !== 'none') !== has) out.push(tag + ' chamber section ' + (has ? 'shown' : 'missing'));
            const err = await pg.evaluate(() => [...document.querySelectorAll('#four-details .note.bad')].map(e => e.innerText).join(' | '));
            if (err) out.push(tag + ' error note: ' + err);
          }
        }
      }
    }
    if (w === 1280) {
      await pg.click('#m-expert'); await pg.click('#u-imp'); await pg.selectOption('#f-n', '1');
      await pg.selectOption('#f-ch', 'can');
      for (const [id, v] of [['#f-rpm', '8500'], ['#f-dp', '1.62'], ['#f-wall', '0.039'], ['#f-chf', '450']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
      await pg.waitForTimeout(80);
      const sec = await pg.evaluate(() => { const h = [...document.querySelectorAll('#four-details .sec h3')].find(x => /Resonance chamber/.test(x.textContent)); return h ? h.parentElement.innerText : 'none'; });
      out.push('CAN SECTION: ' + sec.replace(/\n+/g, ' | ').slice(0, 1500));
      await pg.screenshot({ path: 'ch-can-desk.png', fullPage: true });
    }
    await ctx.close();
  }
  await b.close(); console.log(out.join('\n') || 'clean');
})();
