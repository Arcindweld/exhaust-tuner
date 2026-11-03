// 8-4-1 headers on the Headers tab: a V8 all into one with the two-stage merge. Pairs on their own bank, 180 deg apart
// (openwam/v8_841_study.py), four secondaries into one 4-1 collector sized from them; typed pairs;
// the per-bank Tri-Y and the 6-2-1 unchanged; the page's notes and the unequal-length table with four secondaries.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html'); await pg.waitForTimeout(500);
  // the layout itself: GM LS 1-8-7-2-6-5-4-3, odd cylinders left; Concept 841's C7 sizes (16-gauge wall)
  const r = await pg.evaluate(() => {
    const base = { order: [1, 8, 7, 2, 6, 5, 4, 3], banks: [[1, 3, 5, 7], [2, 4, 6, 8]], cycle: 720, rpm: 6500, evo: 60,
      dp: 47.5, cr: 1.062, cs: 1.5, prof: 'const', port: 0, wall: 1.65, first: 368.3, yr: 0.643, ypairs: [] };
    const L = (o) => { const x = window.__hdr.calcLayout(Object.assign({}, base, o)); return x.err ? { err: x.err } :
      { triy: x.triy, Ng: x.Ng, nColl: x.nColl, dsec: x.dsec, dc: x.dc, pairs: x.pairs ? x.pairs.map(q => q.pairs.map(y => [y.a, y.b, Math.round(y.min)])) : null,
        sameBank: !!(x.pairs && x.pairs[0].sameBank), notes: x.notes.map(n => n.t).join(' || '), minGap: x.minGap }; };
    return {
      c841: L({ mode: 'all', merge: 'triy' }),
      typed: L({ mode: 'all', merge: 'triy', ypairs: [[1, 5], [7, 3], [8, 6], [2, 4]] }),
      typedBad: L({ mode: 'all', merge: 'triy', ypairs: [[1, 7], [5, 3, 8], [2, 6, 4]] }),
      noBanks: L({ mode: 'all', merge: 'triy', banks: [[1, 2, 3, 4, 5, 6, 7, 8]] }),
      bankTriY: L({ mode: 'bank', merge: 'triy' }),
      all81: L({ mode: 'all', merge: 'direct' }),
      i6: window.__hdr.calcLayout(Object.assign({}, base, { order: [1, 5, 3, 6, 2, 4], banks: [[1, 2, 3, 4, 5, 6]], mode: 'all', merge: 'triy' })).err || 'ok',
    };
  });
  const c = r.c841;
  ok(!c.err && c.triy && c.Ng === 8 && c.nColl === 1, '8-4-1 accepted on a V8 all into one (' + (c.err || 'one collector') + ')');
  const pairs = (c.pairs || [[]])[0].map(p => p.slice(0, 2).sort((x, y) => x - y).join('+')).sort();
  ok(JSON.stringify(pairs) === JSON.stringify(['1+7', '2+8', '3+5', '4+6']), 'pairs on their own bank, 180 deg apart: ' + pairs.join(', '));
  ok(c.sameBank && (c.pairs[0] || []).every(p => p[2] === 180), 'each pair 180 deg apart');
  ok(Math.abs(c.dsec - 47.5 * Math.sqrt(2 * 0.643)) < 1e-9 && Math.abs(c.dsec - 53.87) < 0.05, 'secondary from the area ratio: ' + (c.dsec || 0).toFixed(2) + ' mm (Concept 841: 2.25 in, 53.85 mm inside)');
  ok(Math.abs(c.dc - c.dsec * Math.sqrt(4 * 1.062)) < 1e-9 && Math.abs(c.dc - 111.0) < 0.2, 'collector from four secondaries: ' + (c.dc || 0).toFixed(1) + ' mm (Concept 841: 4.5 in, 111.0 mm inside)');
  ok(c.minGap === 90, 'the collector takes a pulse every 90 deg (' + c.minGap + ')');
  ok(/8-4-1: the eight primaries join in pairs/.test(c.notes) && /Concept 841/.test(c.notes) && !/^8-into-1: all eight/.test(c.notes), 'the 8-4-1 note, not the 8-into-1 one');
  const t = r.typed;
  ok(!t.err && JSON.stringify(t.pairs[0].map(p => p.slice(0, 2).sort((x, y) => x - y).join('+')).sort()) === JSON.stringify(['1+5', '2+4', '3+7', '6+8']), 'typed pairs as built (1,5 | 7,3 | 8,6 | 2,4): ' + (t.err || 'taken'));
  ok(t.pairs && t.pairs[0].every(p => p[2] === 270), 'typed pairs 270 deg apart');
  ok(r.typedBad.err && /needs 4 groups of 2/.test(r.typedBad.err), 'wrong typed pairs refused: ' + r.typedBad.err);
  const nb = r.noBanks;
  ok(!nb.err && !nb.sameBank && nb.pairs[0].every(p => p[2] === 360), 'without two banks of four: the most evenly spaced pairs over all (360 deg)');
  const bt = r.bankTriY;
  ok(!bt.err && bt.nColl === 2 && bt.pairs.every(q => q.length === 2 && q.every(p => p[2] === 270)), 'per-bank Tri-Y unchanged: 2 collectors, pairs 270 deg');
  ok(!r.all81.err && /8-into-1: all eight/.test(r.all81.notes), '8-into-1 unchanged');
  ok(r.i6 === 'ok', '6-2-1 still accepted');
  // the tab itself
  await pg.evaluate(() => { document.body.classList.add('expert'); location.hash = 'headers'; }); await pg.waitForTimeout(300);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await setv('h-eng', 'ls'); await setv('h-grp', 'all'); await setv('h-merge', 'triy'); await pg.waitForTimeout(250);
  const key = await pg.$eval('#panel-headers', e => e.innerText);
  ok(/an 8-4-1/.test(key) && /8-4-1: join each pair first/.test(key), 'the tab says 8-4-1 (an 8-4-1, join each pair first)');
  const det = await pg.$eval('#h-details', e => e.innerText);
  ok(!/NaN|undefined/.test(det + key), 'no NaN or undefined on the tab');
  await setv('h-lenmode', 'unequal'); await pg.waitForTimeout(250);
  const secs = await pg.$$eval('#h-uel-tbl input[data-g]', els => els.map(e => e.dataset.g));
  ok(secs.length === 4, 'unequal lengths: four secondaries to enter (' + secs.join(', ') + ')');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
