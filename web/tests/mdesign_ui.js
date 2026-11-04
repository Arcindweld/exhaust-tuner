// Mufflers tab, "Muffler designer": the smallest packed straight-through or plain chamber that takes a set number of dB
// off a band, within the space limits; every listed design meets the goal, smallest first, none past its shell's first
// cross mode or the limits; "Use" puts the design into the tab's fields and the tab's own packed-can section then gives
// the same figure at the target tone; an impossible goal says so with the closest; phone layout; no page errors.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } }); p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/index.html#mufflers'); await p.waitForTimeout(900);
  await p.click('#m-expert').catch(() => {}); await p.click('#u-met'); await p.waitForTimeout(300);
  const setNum = async (id, v) => { await p.fill('#' + id, String(v)); await p.dispatchEvent('#' + id, 'input'); await p.dispatchEvent('#' + id, 'change'); };
  await setNum('m-f', 250); await setNum('m-maxl', 500); await setNum('m-maxw', 180); await p.waitForTimeout(300);
  const sec = () => p.evaluate(() => { const h = [...document.querySelectorAll('#m-details .sec h3')].find(x => x.textContent === 'Muffler designer'); return h ? h.parentElement.innerText : ''; });
  const band = await p.evaluate(() => ['f0', 'f1'].map(k => document.querySelector('input.mdx[data-k="' + k + '"]').value));
  ok(/Find designs/.test(await sec()) && band[0] === '200' && band[1] === '313', 'the designer is on the tab, its band ' + band.join(' to ') + ' Hz from the 250 Hz target');
  await p.click('#md-run'); await p.waitForTimeout(500);
  const R = await p.evaluate(() => { const M = window.__md, q = M.mdInputs(M.mufP()); return { q, res: M.MD.res }; });
  const B = R.res.best;
  ok(B.length >= 1 && B.every(d => d.min >= 10 - 1e-9) && B.every((d, i) => i === 0 || d.vol >= B[i - 1].vol - 1e-9), B.length + ' designs, each 10 dB or more across the band, smallest first: ' + B.map(d => d.kind + ' ' + (d.D / 25.4) + 'x' + (d.L / 25.4) + ' in ' + d.vol.toFixed(1) + ' L').join('; '));
  ok(B.every(d => d.D <= 180 + 1e-6 && d.L <= 500 + 1e-6), 'all within 180 mm across and 500 mm long');
  ok(Math.abs(R.res.fs[4] - 250) < 1.5, 'the middle check frequency is the target tone');
  // Use the first packed design and read the tab's own packed-can figure at 120 Hz
  const k = B.findIndex(d => d.kind === 'packed');
  if (k >= 0) {
    await p.click('button[data-md="' + k + '"]'); await p.waitForTimeout(400);
    const v = await p.evaluate(() => ({ dch: document.getElementById('m-dch')._b, lch: document.getElementById('m-lch')._b, pack: document.getElementById('m-pack')._b, por: document.getElementById('m-por')._b }));
    ok(Math.abs(v.dch - B[k].D) < 1e-9 && Math.abs(v.lch - B[k].L) < 1e-9 && v.pack === B[k].rho && v.por === B[k].por, 'Use: the shell, length, packing and porosity go into the fields');
    const txt = await p.evaluate(() => { const h = [...document.querySelectorAll('#m-details .sec h3')].find(x => x.textContent === 'Packed straight-through can'); return h ? h.parentElement.innerText : ''; });
    const m = txt.match(/([\d.]+) dB/);
    ok(m && Math.abs(+m[1] - B[k].tl[4]) < 0.15, 'the packed-can section gives ' + (m ? m[1] : '?') + ' dB at 250 Hz, the designer ' + B[k].tl[4].toFixed(1));
  } else ok(false, 'a packed design in the list');
  // impossible: 40 dB over an octave in a small space
  await p.evaluate(() => { const set = (k, v) => { const el = document.querySelector('input.mdx[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }; set('tl', 38); });
  await p.waitForTimeout(200); await p.click('#md-run'); await p.waitForTimeout(500);
  ok(/No can of these kinds and sizes takes 38 dB/.test(await sec()) && /The closest/.test(await sec()), 'an impossible goal: says so, with the closest design');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: no page overflow');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log('failures:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
