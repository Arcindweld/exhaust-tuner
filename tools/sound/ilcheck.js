// ilcheck.js - the wave model's insertion loss of a muffler layout (sndMufLayout) against the page's own transfer-matrix
// insertion loss of the same chain (insertionLoss, Munjal 1987 2.15-2.16), at a low level: the default page's 4-Stroke
// engine (one collector) firing at a fixed 35 kPa manifold (so the source is the same with and without the muffler) at low speeds, the Mufflers tab's pipe and tailpipe, the case 6 x 14 in.
//   node tools/sound/ilcheck.js [--rpms 800,1200]      prints JSON
const { chromium } = require('playwright'); const path = require('path');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
async function ilcheck(pg, rpms) {
  return pg.evaluate(async (rpms) => {
    const X = window.__wsnd, q = X.simInp(), A = X.wsndAutoSys(q), W0 = A.W, cp = o => Object.assign(JSON.parse(JSON.stringify(W0)), o);
    const case_ = { D: 152.4, L: 355.6, la: 0, lb: 0, rev: false };
    const V = { none: cp({ mufKind: 'chamber', mufDims: case_ }), baffle: cp({ mufKind: 'chamber', mufDims: Object.assign({}, case_, { type: 'chambered', says: '' }) }), pass3: cp({ mufKind: 'chamber', mufDims: Object.assign({}, case_, { type: 'turbo' }) }) };
    const vars = [{ key: 'none', label: 'none', parts: { sys: V.none, muf: false }, load: 'fixed' }, { key: 'baffle', label: 'baffle', parts: { sys: V.baffle }, load: 'fixed' }, { key: 'pass3', label: 'pass3', parts: { sys: V.pass3 }, load: 'fixed' }];
    X.WSND.sets = []; await new Promise(r => X.wsndJob(vars, sets => { X.WSND.sets = sets; r(); }, { rpms, load: 'none', pFix: 0.35 * 101325 }));
    const sets = X.WSND.sets, out = { what: sets.map(s => s.what), rows: [] };
    for (const key of ['baffle', 'pass3']) {
      const W = V[key], lay = X.sndMufLayout(W, W.mufDims, +W.d);
      for (const rpm of rpms) {
        const r0 = sets[0].runs.find(r => r.rpm === rpm), r1 = sets[key === 'baffle' ? 1 : 2].runs.find(r => r.rpm === rpm); if (!r0 || !r1 || r0.err || r1.err) continue;
        const Tg = r1.jet.T.reduce((a, b) => a + b, 0) / r1.jet.T.length, c = Math.sqrt(1.35 * 287 * Tg), rho = 101325 / (287 * Tg), d = +W.d / 1000, S = Math.PI * d * d / 4;
        const fCut = 1.8412 * c / (Math.PI * W.mufDims.D / 1000), Lu = +W.L / 1000 + 0.7, Lt = +W.tail / 1000;
        for (let k = 1; k <= 24; k++) { const f = k / 2 * rpm / 60; if (f > Math.min(fCut, 0.8 * r1.jet && X.sndLimit(r1, X.WSND.dx).f)) break;
          const il = r0.spl24[k - 1] - r1.spl24[k - 1], Tf = ff => X.sndMufTm(lay.tm, ff, c, rho);
          out.rows.push({ key, rpm, order: k / 2, f: +f.toFixed(1), lvl: +r0.spl24[k - 1].toFixed(1), wave: +il.toFixed(1), tmVel: +X.insertionLoss(Tf, f, Lt, Lu, d / 2, c, rho, S, Infinity).toFixed(1), tmAn: +X.insertionLoss(Tf, f, Lt, Lu, d / 2, c, rho, S, 1).toFixed(1) }); } } }
    return out; }, rpms);
}
module.exports = { ilcheck };
if (require.main === module) (async () => {
  const b = await chromium.launch(); const pg = await b.newPage(); pg.on('pageerror', e => console.error('page error', e.message));
  await pg.goto('file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html') + '#four-stroke'); await pg.waitForTimeout(900);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(500);
  const r = await ilcheck(pg, opt('--rpms', '800,1200').split(',').map(Number)); console.log(JSON.stringify(r, null, 0)); await b.close();
})();
