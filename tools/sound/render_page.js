// render_page.js - the page's own "Hear the model" sound for a validation engine, written to a WAV in a temp folder, for
// tools/sound/analyze.py. Runs the page's wave model (wsndSpeedRun, no load) on an OpenWAM validation spec and plays it
// through the page's sound path (window.__wsnd.render, or the old wsndSound hold when --old is given).
//   node tools/sound/render_page.js SPEC.json OUT_DIR rpm[,rpm...] [--old] [--how hold|show] [--seconds 6]
// SPEC.json: an OpenWAM spec (validation/*/model/runs/*/spec.json). Its tail goes onto the collector as plain segments:
// a volume (V_litres) as a straight bore 330 mm long of that volume (as validation/outback-2004/wave_noload.js does), a
// muffler's "outlets" list as one pipe of the outlets' summed area and their length.
// Also: node tools/sound/render_page.js default OUT_DIR 2500 [--old]   (the default page, Sound tab, Estimate, Play A)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2), flag = k => argv.includes(k), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [specArg, outDir, rpmArg] = argv;
function wav16(x, sr) {
  const b = Buffer.alloc(44 + 2 * x.length); b.write('RIFF', 0); b.writeUInt32LE(36 + 2 * x.length, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(2 * sr, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(2 * x.length, 40);
  let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); const k = pk > 0 ? 0.9 / pk : 1;
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i] * k)) * 32767), 44 + 2 * i); return b;
}
function wav16st(L, R, sr) {
  const n = L.length, b = Buffer.alloc(44 + 4 * n); b.write('RIFF', 0); b.writeUInt32LE(36 + 4 * n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(sr, 24); b.writeUInt32LE(4 * sr, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(4 * n, 40);
  let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); const k = pk > 0 ? 0.9 / pk : 1;
  for (let i = 0; i < n; i++) { b.writeInt16LE(Math.round(L[i] * k * 32767), 44 + 4 * i); b.writeInt16LE(Math.round(R[i] * k * 32767), 46 + 4 * i); } return b;
}
module.exports = { wav16, wav16st };
if (require.main === module) (async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const rpms = String(rpmArg).split(',').map(Number), old = flag('--old');
  const b = await chromium.launch(); const pg = await (await b.newContext()).newPage();
  pg.on('pageerror', e => console.log('page error:', e.message));
  await pg.goto('file://' + path.join(ROOT, 'web', 'index.html') + '#four-stroke'); await pg.waitForTimeout(900);
  let res;
  if (specArg === 'default') {
    await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600);
    res = await pg.evaluate(async ([rpms, old]) => {
      const X = window.__wsnd;
      if (old) { X.WSND.rpms = rpms.join(' '); X.wsndRun(); }
      else X.wsndListen ? X.wsndListen() : X.wsndRun();
      await new Promise(r => { const t = setInterval(() => { if (!X.WSND.busy && X.WSND.sets.length) { clearInterval(t); r(); } }, 200); });
      X.wsndPlay('playA'); const L = X.WSND.lastWav; return { x: Array.from(L.x), r: L.xr ? Array.from(L.xr) : null, sr: L.sr, label: L.label, what: X.WSND.sets[0].what };
    }, [rpms, old]);
    console.log(res.what); console.log(res.label);
    fs.writeFileSync(path.join(outDir, 'default_' + (old ? 'old' : 'new') + '.wav'), res.r ? wav16st(res.x, res.r, res.sr) : wav16(res.x, res.sr));
  } else {
    const spec = JSON.parse(fs.readFileSync(specArg, 'utf8')); delete spec.notes;
    const c = spec.opt.collectors[0];
    for (const t of c.tail || []) {
      if (t.V_litres) { const L = 0.33, d = Math.sqrt(4 * t.V_litres / 1000 / L / Math.PI); c.segs.push({ L, d0: d, d1: d }); }
      else if (t.outlets) { const g = t.outlets[0][0], n = t.outlets.length, d = g.d0_mm / 1000 * Math.sqrt(n); c.segs.push({ L: g.L_mm / 1000, d0: d, d1: d }); }
      else c.segs.push({ L: t.L_mm / 1000, d0: t.d0_mm / 1000, d1: t.d1_mm / 1000 });
    }
    delete c.tail; if (spec.intake) delete spec.intake.reservoir;
    res = await pg.evaluate(([spec, rpms, old, how, secs]) => {
      const X = window.__wsnd, eng = X.WS.makeEngine(spec.e, spec.intake, spec.exhaust, spec.opt); let st = null; const runs = [];
      const ncyl = spec.opt.phases.length;
      for (const rpm of rpms) { const o = X.wsndSpeedRun(X.WS, eng, rpm, { dx: 0.02, load: 'none' }, st); st = o.y.state;
        runs.push(X.wsndEntry({ rec: o.y.rec, rpm, pIn: o.pIn, imep: o.y.imep, Vd: eng.Vd }, { cyl: ncyl }, { nIn: ncyl, whole: true, pack: null, spec: { opt: { phases: spec.opt.phases } } }, 'v')); }
      const P = Object.assign({}, X.WSND.play, { rpm: rpms[0], ft: 3.3 });
      if (old) return { x: Array.from(X.wsndSound(runs, 'hold', Object.assign(P, { old: true }))), sr: 48000 };
      const R = X.wsndRender(runs, how, Object.assign(P, { seconds: how === 'hold' ? secs : undefined }));
      return { x: Array.from(R.x), r: R.xr ? Array.from(R.xr) : null, sr: R.sr, info: R.info };
    }, [spec, rpms, old, opt('--how', 'hold'), +opt('--seconds', 6)]);
    const name = path.basename(path.dirname(specArg)) + '_' + rpms.join('-') + (old ? '_old' : '_new') + '.wav';
    fs.writeFileSync(path.join(outDir, name), res.r ? wav16st(res.x, res.r, res.sr) : wav16(res.x, res.sr)); console.log(name, res.info ? JSON.stringify(res.info) : '');
  }
  await b.close();
})();
