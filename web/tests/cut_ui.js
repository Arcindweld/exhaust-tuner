// Cut list from stock mandrel bends: a routed tube's bend schedule as pieces (straights and bend pieces with their
// outside / inside marks and clocking), bends packed into the fewest stock bends of the same OD and centerline radius,
// both units; a radius nobody stocks is flagged with the stocked radii; the Fusion results show it under each tube.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, d]); return Promise.resolve(JSON.stringify(window.__reply || { ok: true, items: [], msg: 'stub' })); } }; });
  const pg = await ctx.newPage(); const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html'); await pg.waitForTimeout(600);
  const r = await pg.evaluate(() => {
    const C = window.__cut, clr = 2.62 * 25.4;   // Stainless Bros 1.75 in 1.5D 90, 601-04556-8150
    const rows = [{ L: 100, R: null, A: 90, CLR: clr }, { L: 50, R: 30, A: 45, CLR: clr }, { L: 0, R: -90, A: 40, CLR: clr }, { L: 200, R: 0, A: 30, CLR: clr }, { L: 80, R: null, A: null, CLR: null }];
    const c = C.cutList(rows, 1.75, '304');
    const bad = C.cutList([{ L: 10, R: null, A: 60, CLR: 3.1 * 25.4 }, { L: 10, R: null, A: null, CLR: null }], 1.75, '304');
    return { c: { pieces: c.pieces.map(p => [p.kind, p.kind === 'bend' ? +p.A.toFixed(1) : +p.L.toFixed(1), p.from || 0, p.stock ? p.stock.pn : null, p.outer ? +p.outer.toFixed(2) : null, p.inner ? +p.inner.toFixed(2) : null]),
      buy: c.buy.map(b => [b.s.pn, b.count, b.bins.map(x => x.cuts.map(p => p.A))]), st: +c.straightTotal.toFixed(1) },
      html: C.cutListHtml(c, 'Primary 1'), buyHtml: C.cutBuyHtml([c, c]), bad: C.cutListHtml(bad), badMissing: bad.missing.length,
      f: [C.inMm(47.625), C.inMm(100), C.inMm(1.6)] };
  });
  const P = r.c.pieces;
  ok(JSON.stringify(P.map(p => p[0])) === JSON.stringify(['straight', 'bend', 'straight', 'bend', 'bend', 'straight', 'bend', 'straight']), 'pieces in order, a zero straight left out: ' + P.map(p => p[0][0]).join(''));
  ok(P.filter(p => p[0] === 'bend').every(p => p[3] === '601-04596-1150'), 'every bend from the Stainless Bros 1.75 in 1.5D (2.62 in) 16 ga U-bend');
  ok(JSON.stringify(r.c.buy) === JSON.stringify([['601-04596-1150', 2, [[90, 45, 40], [30]]]]), 'packed into 2 stock U-bends: 90+45+40 (two kerfs) | 30 (' + JSON.stringify(r.c.buy) + ')');
  const R = Math.PI / 180, od = 1.75 * 25.4, cl = 2.62 * 25.4;
  ok(Math.abs(P[1][4] - (cl + od / 2) * 90 * R) < 0.01 && Math.abs(P[1][5] - (cl - od / 2) * 90 * R) < 0.01, 'outside and inside marks on the 90: ' + P[1][4] + ' / ' + P[1][5] + ' mm');
  ok(Math.abs(r.c.st - (100 + 50 + 200 + 80 + 4 * 1.6)) < 0.05, 'straight tube with kerf: ' + r.c.st + ' mm');
  ok(JSON.stringify(r.f) === JSON.stringify(['1 7/8 in (47.5 mm)', '3 15/16 in (100.0 mm)', '1/16 in (1.5 mm)']), 'both units, inches to 1/16: ' + r.f.join(' | '));
  ok(/Cut list · Primary 1/.test(r.html) && /Clock from last bend/.test(r.html) && /-90°/.test(r.html), 'the cut list table, with clocking');
  ok(/>4<\/td>/.test(r.buyHtml) && /601-04596-1150/.test(r.buyHtml) && /straight tube/.test(r.buyHtml), 'to buy over two tubes: 4 U-bends and the straight tube');
  ok(r.badMissing === 1 && /no stock bend at this radius/.test(r.bad) && /stocked radii for this OD: \d/.test(r.bad), 'an unstocked radius is flagged with the stocked ones');
  // in the Fusion results
  await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__reply = { ok: true, msg: 'Routed', route_ok: true, items: [
    { kind: 'path', name: 'Primary 1', length: 80, od: [4.445], lra: [{ L: 10, R: null, A: 90, CLR: 6.6548 }, { L: 5, R: 45, A: 30, CLR: 6.6548 }, { L: 20, R: null, A: null, CLR: null }] },
    { kind: 'path', name: 'Primary 2', length: 80, od: [4.445], lra: [{ L: 12, R: null, A: 60, CLR: 6.6548 }, { L: 18, R: null, A: null, CLR: null }] }] }; });
  const btn = await pg.$('#fx-headers button[data-fx="measure"]');
  if (btn) { await btn.click(); await pg.waitForTimeout(500); }
  const out = await pg.evaluate(() => { const o = document.getElementById('fx-out-headers'); return o ? o.innerText : ''; });
  ok(/Cut list/.test(out) && /To buy, all tubes/.test(out) && /601-04596-1150/.test(out), 'the Headers tab Fusion results show the cut list and what to buy' + (btn ? '' : ' (no Fusion button found)'));
  // the tack jig button sends the tab's tube OD and its own title
  await pg.evaluate(() => { window.__reply = { ok: true, msg: 'Built 4 cradles for the tubes the last auto-route built: Primary 1: 2, Primary 2: 2.' }; window.__sent.length = 0; });
  await pg.click('#fx-headers button[data-fx="jig"]'); await pg.waitForTimeout(300);
  const sent = await pg.evaluate(() => window.__sent.map(([a, d]) => [a, JSON.parse(d)]));
  const js = sent.find(x => x[0] === 'jig');
  ok(js && js[1].title === 'Fabrication jig' && js[1].od_mm > 40, 'Build tack jig sends the tube OD (' + (js ? js[1].od_mm : '-') + ' mm) and titles the component');
  ok(/Built 4 cradles/.test(await pg.$eval('#fx-out-headers', e => e.innerText)), 'and shows what Fusion built');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
