// ablate.js - ablation of the played V8 sound (docs/SOUND_REALISM_ROUND2_2026-11-21.md, section 2): a 2018-20 Mustang GT
// after Quick's "Fill in every tab" (180 in head to tip), the system the Sound tab plays, with each exhaust part off in turn
// (the wave model rerun) and each playback stage off in turn (the same runs replayed). Prints JSON: octave bands re the
// total of the played signal, the orders at the tip (free field, 1 m), per variant x stage x speed.
//   node tools/sound/ablate.js OUT.json [--rpms 750,2500] [--load none|wot] [--variants full,nofix,nomuf,noxo,open] [--wav DIR]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const { wav16 } = require('./render_page.js');
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k + len / 2, xr = re[p] * cr - im[p] * ci, xi = re[p] * ci + im[p] * cr; re[p] = re[i + k] - xr; im[p] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
function welch(x, nper) { const P = new Float64Array(nper / 2 + 1); let m = 0; const w = Array.from({ length: nper }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nper));
  for (let s = 0; s + nper <= x.length; s += nper / 2) { const re = new Float64Array(nper), im = new Float64Array(nper); for (let i = 0; i < nper; i++) re[i] = x[s + i] * w[i]; fft(re, im); for (let k = 0; k <= nper / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; m++; } return P; }
// octave bands as the reviewer quoted them: 20-60, 60-125, 125-250, 250-500, 500-1k, 1-2k, 2-4k, 4-8k, 8k+ (dB re total)
const EDGES = [20, 60, 125, 250, 500, 1000, 2000, 4000, 8000, 24000];
function octs(x, sr) { const n = 1 << 15, P = welch(x, n), df = sr / n; let t = 0; const b = EDGES.slice(1).map(() => 0);
  for (let k = 1; k < P.length; k++) { const f = k * df; if (f < 20) continue; t += P[k]; for (let j = 0; j < b.length; j++) if (f >= EDGES[j] && f < EDGES[j + 1]) { b[j] += P[k]; break; } }
  return b.map(v => +(10 * Math.log10(v / t + 1e-30)).toFixed(1)); }
module.exports = { octs, EDGES, welch, fft };
async function mustang(pg, chg) {
  await pg.evaluate(() => { location.hash = 'quick'; }); await pg.waitForTimeout(700);
  await chg('v-mode', 'veh'); await chg('v-class', 'car');
  const mk = await pg.evaluate(() => [...document.getElementById('v-make').options].find(o => /^Ford$/.test(o.value)).value); await chg('v-make', mk);
  const v = await pg.evaluate(() => [...document.getElementById('v-pick').options].find(o => /2018–20 Ford Mustang GT/.test(o.text)).value); await chg('v-pick', v);
  await chg('q-sys', '180'); await pg.click('button[data-qapply]'); await pg.waitForTimeout(800);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600);
}
module.exports.mustang = mustang;
if (require.main === module) (async () => {
  const out = argv[0], rpms = opt('--rpms', '750,2500').split(',').map(Number), load = opt('--load', 'none'), wavDir = opt('--wav', null);
  const vk = opt('--variants', 'full,nofix,nomuf,noxo,open').split(',');
  const b = await chromium.launch(); const pg = await (await b.newContext()).newPage();
  pg.on('pageerror', e => console.error('page error:', e.message));
  const chg = async (id, v) => { await pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, String(v)]); await pg.waitForTimeout(250); };
  await pg.goto('file://' + path.join(ROOT, 'web', 'index.html') + '#four-stroke'); await pg.waitForTimeout(900);
  if (opt('--engine', 'mustang') === 'mustang') await mustang(pg, chg); else { await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600); }
  const t0 = Date.now();
  const info = await pg.evaluate(async ([vk, rpms, load]) => {
    const X = window.__wsnd, q = X.simInp(), A = X.wsndAutoSys(q), W = A.W, cp = o => Object.assign(JSON.parse(JSON.stringify(W)), o);
    const V = { full: { sys: W, whole: true }, nofix: { sys: cp({ fix: 'none' }), whole: true }, nomuf: { sys: W, whole: true, muf: false }, noxo: { sys: W, whole: true, xo: false }, open: { line: false, whole: true } };
    const vars = vk.map(k => ({ key: k, label: k, parts: V[k] }));
    X.WSND.sets = []; await new Promise(r => X.wsndJob(vars, sets => { X.WSND.sets = sets; r(); }, { rpms, load }));
    return { notIn: A.notIn, what: X.WSND.sets.map(s => s.what), W };
  }, [vk, rpms, load]);
  console.error('runs done in', ((Date.now() - t0) / 1000).toFixed(0), 's');
  const stages = JSON.parse(opt('--stages', JSON.stringify({ all: {}, nopath: { path: false }, nojet: { jet: false }, noband: { band: false }, novary: { vary: false } })));
  const res = { info, rows: [] };
  for (let vi = 0; vi < vk.length; vi++) for (const rpm of rpms) for (const sk in stages) {
    const R = await pg.evaluate(([vi, rpm, st]) => { const X = window.__wsnd, s = X.WSND.sets[vi], runs = s.runs, run = runs.find(r => r.rpm === rpm);
      const P = Object.assign({}, X.WSND.play, { rpm, seconds: 6, jet: st.jet !== false, ft: st.ft || X.WSND.play.ft }, st.P || {});
      const L = Object.assign({}, X.SND_L, st); delete L.jet; delete L.P; delete L.ft;
      const R = X.wsndRender(runs, 'hold', Object.assign(P, { listen: L }));
      return { x: Array.from(R.x), info: R.info, spl24: run && run.spl24 ? run.spl24.map(v => +v.toFixed(1)) : null }; }, [vi, rpm, stages[sk]]);
    const row = { variant: vk[vi], rpm, stage: sk, oct: octs(R.x, 48000), spl24: sk === 'all' ? R.spl24 : undefined, fLim: R.info.fLim };
    res.rows.push(row); console.error(vk[vi], rpm, sk, row.oct.join(' '));
    if (wavDir && sk === 'all') fs.writeFileSync(path.join(wavDir, 'abl_' + vk[vi] + '_' + rpm + '.wav'), wav16(R.x, 48000));
  }
  fs.writeFileSync(out, JSON.stringify(res, null, 1)); await b.close();
})();
