// rs660_stock.js - the closest the page's wave model gets to the RS 660's stock system (validation/rs660-2026: every
// dimension is model/rs660.py's estimate; nothing is published), for the comparison only: two stepped primaries (35.5 mm
// for 225 mm, then 48 mm; 575 and 625 mm), a 58 mm x 100 mm Y, the catalyst as an 85 mm x 115 mm straight bore (its
// channels are not modelled: no cited pressure-drop law fits the solver's pipes), the 10 L underbelly box as two chambers
// of a 196 mm bore (10 L over 330 mm) joined by a 58 mm hole through a 1.5 mm plate (generic: the inside is not
// published), and its two 40 mm x 120 mm outlets as one pipe of their summed area (render_page.js's way).
//   node tools/sound/rs660_stock.js OUT_DIR [--round1] [--wav name.wav] [--metrics] [--dx 0.02]
// Writes the idle -> rev to 5,500 -> hold -> back to idle sound (sndBlip with a hold), or with --metrics holds at the
// recording's speeds heard where the recording's microphone was (on the ground about 3 ft behind), as JSON.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const { wav16 } = require('./render_page.js');
const argv = process.argv.slice(2), flag = k => argv.includes(k), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..', '..');
const B = 0.081, S = 0.06393;
function spec(round1) {
  const prim = L2 => [{ L: 0.225, d0: 0.0355, d1: 0.0355, primary: true }, { L: L2, d0: 0.048, d1: 0.048 }];
  const Db = Math.sqrt(4 * 0.010 / 0.33 / Math.PI), dOut = 0.040 * Math.sqrt(2), le = 0.0015 + 0.785 * 0.058, lc = (0.33 - le) / 2;
  const box = round1 ? [{ L: 0.33, d0: Db, d1: Db }] : [{ L: lc, d0: Db, d1: Db }, { L: le, d0: 0.058, d1: 0.058 }, { L: lc, d0: Db, d1: Db }];
  return { e: { bore: B, stroke: S, rod: 1.7 * S, cr: 13.5, cd: 0.7, nIn: 2, dIn: 0.40 * B, liftIn: 0.0095, nEx: 2, dEx: 0.33 * B, liftEx: 0.0080, cam: { ivo: 25, ivc: 55, evo: 50, evc: 20 }, burn: { start: 12, dur: 65 }, afr: 14.6, eta: 0.72, combEff: 0.72 },
    intake: { segs: [{ L: 0.25, d0: 0.046, d1: 0.046 }], Tw: 320 },
    exhaust: { segs: prim(0.35), per_cyl: [prim(0.35), prim(0.40)], Tw: 600, chambers: [] },
    opt: { phases: [0, 270], collectors: [{ cyls: [0, 1], segs: [{ L: 0.10, d0: 0.058, d1: 0.058 }, { L: 0.115, d0: 0.085, d1: 0.085 }].concat(box, [{ L: 0.12, d0: dOut, d1: dOut }]), Tw: 550 }] }, n: 2 }; }
module.exports = { spec };
if (require.main === module) (async () => {
  const out = argv[0]; fs.mkdirSync(out, { recursive: true }); const round1 = flag('--round1'), metrics = flag('--metrics');
  const b = await chromium.launch(); const pg = await b.newPage(); pg.on('pageerror', e => console.error('page error', e.message));
  await pg.goto('file://' + path.join(ROOT, 'web', 'index.html') + '#sound'); await pg.waitForTimeout(900);
  const R = await pg.evaluate(([sp, round1, metrics, dx]) => {
    const X = window.__wsnd; X.WSND.dx = dx; const mk = dead => { const s = JSON.parse(JSON.stringify(sp)); if (dead) s.e.dead = [0, 1]; return X.WS.makeEngine(s.e, s.intake, s.exhaust, s.opt); };
    const runs = [], ent = (o, rpm, mode, eng) => X.wsndEntry({ rec: o.y.rec, rpm, pIn: o.pIn, imep: o.y.imep, Vd: eng.Vd, mode }, { cyl: 2 }, { nIn: 2, whole: true, pack: null, spec: { opt: { phases: [0, 270] } } }, 'RS 660 stock (est.)');
    let e = mk(false), st = null, ref = null;
    for (const rpm of metrics || round1 ? [1442, 5460] : [1442, 5460]) { const o = X.wsndSpeedRun(X.WS, e, rpm, { dx, load: 'none' }, st); st = o.y.state; if (!ref) ref = { rpm, p: o.pIn }; runs.push(ent(o, rpm, 'idle', e)); }
    if (!metrics && !round1) { st = null; for (const rpm of [2800, 4200, 5500]) { const o = X.wsndSpeedRun(X.WS, e, rpm, { dx, load: 'wot' }, st); st = o.y.state; runs.push(ent(o, rpm, 'wot', e)); }
      const m = mk(true); st = null; for (const rpm of [3500, 5500]) { const o = X.wsndSpeedRun(X.WS, m, rpm, { dx, load: 'motor', pRef: ref }, st); st = o.y.state; runs.push(ent(o, rpm, 'motor', m)); } }
    const res = { runs: runs.map(r => ({ rpm: r.rpm, mode: r.mode, pMap: r.pMap, tq: r.tq, lim: X.sndLimit(r, dx).f })) };
    if (metrics) { // holds heard where the recording's microphone was: on the ground (2 in up) about 3 ft behind, the outlets 1 ft up
      const L = Object.assign({}, X.SND_L, { pos: 'road', earFt: 0.17, tipFt: 1.0 }, round1 ? { fine: false, pos: 'road', ground: 'mirror', idle: false, shell: false } : {});
      res.holds = [1442, 5460].map(rpm => { const P = Object.assign({}, X.WSND.play, { rpm, ft: 3, seconds: 6 }), Rr = X.wsndRender(runs, 'hold', Object.assign(P, { listen: L })); return { rpm, x: Array.from(Rr.x), info: Rr.info }; });
    } else if (round1) { const L = Object.assign({}, X.SND_L, { fine: false, pos: 'road', ground: 'mirror', idle: false, shell: false });
      const P = Object.assign({}, X.WSND.play, { rpm: 1442, ft: 25 }), Rr = X.wsndRender(runs, 'show', Object.assign(P, { listen: L })); res.x = Array.from(Rr.x); res.info = Rr.info;
    } else { // idle 2 s, full throttle to 5,500, held 2 s with no load, the fuel cut down, back to idle (the recording's shape)
      const L = Object.assign({}, X.SND_L), P = Object.assign({}, X.WSND.play, { rpm: 1442 }), ok = runs.slice().sort((a, b) => a.rpm - b.rpm), R0 = ok.map(w => X.sndPrep(w, dx, { fine: L.fine, shell: L.shell }));
      const Rr = X.sndBlip(ok, R0, P, L, X.sndListenFt(P, L) * 0.3048, { top: 5460, hold: 2 }); res.x = Array.from(Rr.x); res.info = Rr.info; }
    return res; }, [spec(round1), round1, metrics, +opt('--dx', 0.02)]);
  if (R.x) fs.writeFileSync(path.join(out, opt('--wav', round1 ? 'rs660_round1.wav' : 'rs660_round2.wav')), wav16(R.x, 48000));
  if (R.holds) R.holds.forEach(h => fs.writeFileSync(path.join(out, 'rs660_' + (round1 ? 'r1' : 'r2') + '_hold_' + h.rpm + '.wav'), wav16(h.x, 48000)));
  delete R.x; if (R.holds) R.holds.forEach(h => delete h.x); console.log(JSON.stringify(R)); await b.close();
})();
