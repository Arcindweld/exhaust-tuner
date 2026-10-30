// Sound tab: engines, feeds, induction, sections, tube shapes, hangers and flex, in phone and desktop
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = [];
  for (const [name, w, scheme] of [['phone', 390, 'light'], ['desk', 1280, 'dark']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => out.push(name + ' PAGEERROR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts|net::/.test(m.text())) out.push(name + ' console ' + m.text()); });
    await pg.goto('file://' + process.cwd()+'/index.html#sound'); await pg.click('#m-expert');
    const txt = async () => pg.evaluate(() => document.querySelector('#panel-sound').innerText);
    const chk = async tag => {
      await pg.waitForTimeout(80); const t = await txt();
      const m = t.match(/.{0,50}(\bNaN\b|\bundefined\b|\bInfinity\b).{0,30}/); if (m) out.push(name + ' ' + tag + ' BAD ' + m[0]);
      const o = await pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) out.push(name + ' ' + tag + ' overflow ' + o);
      return t;
    };
    const key = async () => (await pg.innerText('#sound-key')).replace(/\n+/g, ' | ').slice(0, 170);
    const setv = async (id, v) => { await pg.fill('#' + id, String(v)); await pg.dispatchEvent('#' + id, 'input'); };
    let t = await chk('default');
    out.push(name + ' default: ' + await key());
    // engines across the library
    for (const eng of ['sbc', 'fp8', 'ls', 'v10v', 'v12', 'i4', 'f4', 'mv45', 'm4x', 'mv4d', 'r2', 't2']) {
      await pg.selectOption('#s-eng', eng); t = await chk('eng ' + eng);
      out.push(`${name} ${eng}: ${await key()}`);
    }
    await pg.selectOption('#s-eng', 'sbc');
    // feeds and induction
    for (const [feed, ind] of [['a', 'na'], ['a', 'turbo2'], ['all', 'turbo1'], ['a', 'turbo1'], ['all', 'roots'], ['all', 'screw'], ['all', 'centri']]) {
      await pg.selectOption('#s-feed', feed); await pg.selectOption('#s-ind', ind); t = await chk(feed + '/' + ind);
      const hint = await pg.isVisible('#s-ind-hint') ? await pg.textContent('#s-ind-hint') : '';
      out.push(`${name} ${feed}/${ind}: lenlab="${await pg.textContent('#s-len-lab')}" hint="${hint.slice(0, 50)}" | ${await key()}`);
    }
    await pg.selectOption('#s-feed', 'list'); await pg.fill('#s-feedlist', '1,3,5,7'); await pg.dispatchEvent('#s-feedlist', 'input'); await pg.selectOption('#s-ind', 'na'); await chk('list');
    out.push(name + ' list 1,3,5,7: ' + await key());
    await pg.selectOption('#s-feed', 'all');
    // a bank pick on an engine without banks gives a clear message
    await pg.selectOption('#s-eng', 'm4x'); await pg.selectOption('#s-feed', 'a'); await chk('m4x bank a');
    out.push(name + ' m4x bank A: ' + await key()); await pg.selectOption('#s-feed', 'all'); await pg.selectOption('#s-eng', 'sbc');
    // sections and shapes
    await pg.selectOption('#s-lay', 'secs'); t = await chk('secs');
    out.push(name + ' sections: ' + await key());
    for (const n of ['2', '6']) { await pg.selectOption('#s-nsec', n); await chk('nsec ' + n); }
    await pg.selectOption('#s-nsec', '5'); await pg.selectOption('#s-sh1', 'oval'); await pg.selectOption('#s-sh3', 'flat'); t = await chk('oval sections');
    out.push(name + ' oval sections: ' + await key());
    await pg.selectOption('#s-lay', 'one');
    for (const sh of ['oval', 'flat']) { await pg.selectOption('#s-shape', sh); t = await chk('shape ' + sh); out.push(name + ' shell ' + sh + ': ' + ((t.match(/Shell mode 1[^\n]*\n?[^\n]*/i) || t.match(/ovaling[^\n]*/i) || ['(no shell row)'])[0]).replace(/\s+/g, ' ').slice(0, 120)); }
    await pg.selectOption('#s-shape', 'round');
    // hangers and flex
    for (const hg of ['soft', 'firm', 'poly', 'solid']) { await pg.selectOption('#s-hang', hg); t = await chk('hang ' + hg); out.push(name + ' hang ' + hg + ': ' + ((t.match(/(Good isolation|Some isolation|No isolation)[^\n]*/) || ['?'])[0]).slice(0, 70)); }
    await pg.selectOption('#s-hang', 'soft');
    await setv('s-mass', ''); t = await chk('mass empty'); out.push(name + ' empty weight: ' + ((t.match(/Fill in the weight[^\n]*/) || ['(no msg)'])[0]));
    await setv('s-mass', 40);
    for (const fx of ['bare', 'lined']) { await pg.selectOption('#s-flex', fx); t = await chk('flex ' + fx); out.push(name + ' flex ' + fx + ': ' + ((t.match(/(An unlined corrugated flex can whistle|A lined flex keeps)[^\n]*/) || ['?'])[0]).slice(0, 60) + ' | ' + ((t.match(/whistle band[^\n]*/) || [''])[0]).slice(0, 60)); }
    await pg.selectOption('#s-flex', 'none');
    for (const sup of ['fix', 'cant', 'flex']) { await pg.selectOption('#s-sup', sup); await chk('sup ' + sup); }
    await pg.selectOption('#s-sup', 'pin');
    for (const mat of ['mild', 'ss409', 'ti2']) { await pg.selectOption('#s-mat', mat); await chk('mat ' + mat); }
    await setv('s-twall', 1500); t = await chk('hot'); out.push(name + ' hot note: ' + ((t.match(/The wall temperature is above[^\n]*/) || ['(none)'])[0]).slice(0, 80));
    await setv('s-wall', 2); t = await chk('thick'); out.push(name + ' thick wall: ' + ((t.match(/The wall[^\n]*/) || ['(no err)'])[0]).slice(0, 70));
    await setv('s-wall', 0.065); await setv('s-twall', 400);
    // firing order editor
    await pg.selectOption('#s-eng', 'ls'); await pg.click('#s-edit'); await chk('edit');
    out.push(name + ' after edit: eng=' + await pg.inputValue('#s-eng') + ' order=' + await pg.inputValue('#s-order') + ' bank=' + await pg.inputValue('#s-bank'));
    await pg.click('#u-met'); await chk('metric'); await pg.click('#u-imp');
    if (name === 'desk') await pg.screenshot({ path: 'snd5-desk.png', fullPage: true });
    await ctx.close();
  }
  console.log(out.join('\n')); await b.close();
})();
