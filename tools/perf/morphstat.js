// node morphstat.js FILE TAB : what setHTML replaced on one edit (by tag and the reason) and how many texts/attributes it set
const { chromium } = require('playwright'); const serve = require('./serve'); const { settle } = require('../../web/tests/settle');
const [file, tab] = process.argv.slice(2);
(async () => { const S = await serve(file); const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await pg.goto(S.url + '#' + tab); await pg.waitForTimeout(800); await settle(pg);
  if (tab === 'intake') { await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); s('i-ind', 'turbo'); }); await settle(pg); }
  for (let k = 0; k < 2; k++) console.log(await pg.evaluate(k => { const R = {}; const f = __dbg('shRepl'); __dbg('shRepl=__a', function (n, lp, l) { const key = n.nodeName + (n.id ? '#' + n.id : '') + ' in ' + (lp.id || lp.className || lp.nodeName); R[key] = (R[key] || 0) + (n.querySelectorAll ? n.querySelectorAll('*').length + 1 : 1); return f.apply(this, arguments); });
    let tx = 0, at = 0; const d1 = Object.getOwnPropertyDescriptor(Node.prototype, 'nodeValue'); Object.defineProperty(Node.prototype, 'nodeValue', { configurable: true, get: d1.get, set(v) { tx++; d1.set.call(this, v); } });
    const sa = Element.prototype.setAttribute; Element.prototype.setAttribute = function () { at++; return sa.apply(this, arguments); };
    const id = { intake: 'i-hp', mufflers: 'm-f', hangers: 'hg-od' }[location.hash.slice(1)];
    const el = document.getElementById(id); el.value = String(parseFloat(el.value) * (k ? 0.99 : 1.013)); el.dispatchEvent(new Event('input', { bubbles: true }));
    Object.defineProperty(Node.prototype, 'nodeValue', d1); Element.prototype.setAttribute = sa; __dbg('shRepl=__a', f);
    return 'texts set ' + tx + ', setAttribute calls (all) ' + at + '\n' + Object.entries(R).sort((a, c) => c[1] - a[1]).slice(0, 25).map(([k, v]) => '  ' + v + ' nodes  ' + k).join('\n'); }, k));
  await b.close(); S.close(); })();
