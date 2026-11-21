// Sound tab, "Hear the model" made like an engine (docs/SOUND_REALISM_2026-11-21.md): the objective properties that were
// wrong in the old playback, on the default V8 and on a 2018-20 Mustang GT after Quick's "Fill in every tab"; the open-
// headers warning; and the listening space (reverb) as a playback-only stage.   node tests/wsndreal_ui.js   (from web/)
// Reference figures (tools/sound/analyze.py on the owner's recordings, steady holds): the gap between the orders (median
// level of an order over the lowest point halfway to the next) 6.3 dB at the Outback's idle and 24.7 dB at its 1980 rpm
// hold, 3.2 / 17.7 dB on the RS 660 (idle / 5460 rpm); the old playback gave 12-49 dB. Accepted here: 3 to 30 dB.
const { chromium } = require('playwright');
// a plain radix-2 FFT and Welch spectrum for the checks (node side)
function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a); for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const p = i + k + len / 2, xr = re[p] * cr - im[p] * ci, xi = re[p] * ci + im[p] * cr; re[p] = re[i + k] - xr; im[p] = im[i + k] - xi; re[i + k] += xr; im[i + k] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } } }
function welch(x, sr, nper) { const P = new Float64Array(nper / 2 + 1); let m = 0; const w = Array.from({ length: nper }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / nper));
  for (let s = 0; s + nper <= x.length; s += nper / 2) { const re = new Float64Array(nper), im = new Float64Array(nper); for (let i = 0; i < nper; i++) re[i] = x[s + i] * w[i]; fft(re, im); for (let k = 0; k <= nper / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k]; m++; }
  return { P: P.map(v => v / (m || 1)), df: sr / nper }; }
function gapMedian(x, sr, rpm) { const { P, df } = welch(x, sr, 1 << 15), L = Array.from(P, v => 10 * Math.log10(v + 1e-30)), h = rpm / 120, pk = [];
  for (let k = 1; k <= 24; k++) { const i = Math.round(k * h / df); pk.push(Math.max(L[i - 1], L[i], L[i + 1])); } const top = Math.max(...pk), g = [];
  for (let k = 1; k < 24; k++) { if (pk[k - 1] < top - 30) continue; const a = Math.round(k * h / df), b = Math.round((k + 1) * h / df); let lo = 1e9; for (let i = a + Math.floor((b - a) / 4); i <= b - Math.floor((b - a) / 4); i++) lo = Math.min(lo, L[i]); g.push(pk[k - 1] - lo); }
  g.sort((p, q) => p - q); return g[Math.floor(g.length / 2)]; }
function exactFraction(x, sr, rpm) { const { P, df } = welch(x, sr, 1 << 16), h = rpm / 120; let a = 0, t = 0; for (let k = 1; k < P.length; k++) { const f = k * df; if (f < 20) continue; t += P[k]; if (Math.abs(f / h - Math.round(f / h)) * h < 1.5 * df) a += P[k]; } return a / t; }
function bandShare(x, sr, f0) { const { P, df } = welch(x, sr, 1 << 14); let a = 0, t = 0; for (let k = 1; k < P.length; k++) { t += P[k]; if (k * df > f0) a += P[k]; } return 10 * Math.log10(a / t + 1e-30); }
function slope(x, sr, f0, f1) { const { P, df } = welch(x, sr, 1 << 14), pts = []; for (let fc = 31.5; fc < 20000; fc *= Math.pow(2, 1 / 3)) { if (fc < f0 || fc > f1) continue; let s = 0; for (let k = Math.ceil(fc / Math.pow(2, 1 / 6) / df); k * df < fc * Math.pow(2, 1 / 6); k++) s += P[k]; pts.push([Math.log2(fc), 10 * Math.log10(s + 1e-30)]); }
  const n = pts.length, sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0), sxx = pts.reduce((a, p) => a + p[0] * p[0], 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0); return (n * sxy - sx * sy) / (n * sxx - sx * sx); }
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] }); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); const fails = [];
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const chg = async (id, v) => { await pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, String(v)]); await pg.waitForTimeout(250); };
  const done = () => pg.waitForFunction(() => !window.__wsnd.WSND.busy && window.__wsnd.WSND.sets.length, null, { timeout: 900000 });
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(900);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600);
  ok(!!(await pg.$('button[data-wsnd="listen"]')), 'the Sound tab has a "Hear my exhaust" button');

  // 1. the default page's "Estimate the sound" is open headers: the warning stands above the play buttons
  await chg('wsnd-rpms', '2500'); await pg.click('button[data-wsnd="run"]'); await done();
  const warn = await pg.evaluate(() => { const w = document.getElementById('wsnd-openwarn'), pb = document.querySelector('button[data-wsnd="playA"]');
    return { t: w ? w.textContent : '', above: !!(w && pb && (w.compareDocumentPosition(pb) & Node.DOCUMENT_POSITION_FOLLOWING)) }; });
  ok(/This is open headers with no exhaust system; it will sound like a race engine on open pipes/.test(warn.t) && warn.above, 'open headers: the warning is shown above the play buttons, with a one-click way to the system (' + warn.t.slice(0, 60) + ')');
  const dbBefore = await pg.evaluate(() => (() => { const t = [...document.querySelectorAll('#panel-sound table')].find(t => /dB\(A\) at/.test(t.innerText)); return t ? t.innerText : ''; })());
  // the old straight-line resampling against the band-limited sound, on these open headers (2500 RPM, jet off)
  const O = await pg.evaluate(() => { const X = window.__wsnd, runs = X.WSND.sets[0].runs, P = Object.assign({}, X.WSND.play, { rpm: 2500, seconds: 4, jet: false });
    const n = X.wsndRender(runs, 'hold', P); return { nb: Array.from(n.x), old: Array.from(X.wsndSound(runs, 'hold', Object.assign({}, P, { old: true }))), lim: n.info.fLim }; });
  const oNew = bandShare(O.nb, 48000, 1.25 * O.lim), oOld = bandShare(O.old, 48000, 1.25 * O.lim);
  ok(oNew < -45 && oOld > oNew + 15, 'open headers at 2500 RPM: above 1.25 x the ' + O.lim + ' Hz limit the old straight-line resampling put ' + oOld.toFixed(1) + ' dB re the total, the band-limited sound ' + oNew.toFixed(1) + ' dB');

  // 2. the default V8 with "Hear my exhaust": the whole engine, both banks, the Mufflers tab's system
  await pg.evaluate(() => { window.__wsnd.WSND.sets = []; }); await pg.click('button[data-wsnd="listen"]'); await done();
  const L = await pg.evaluate(() => { const X = window.__wsnd, s = X.WSND.sets[0], r = s.runs.filter(x => !x.err);
    return { what: s.what, rpms: r.map(x => x.rpm), exits: r.map(x => x.exits), ph: r[0].phases, warn: !!document.getElementById('wsnd-openwarn'), playing: (document.getElementById('wsnd-playing') || {}).textContent || '', how: X.WSND.play.how, wav: !!X.WSND.lastWav }; });
  ok(L.rpms.length === 3 && L.how === 'show' && L.wav, 'three speeds ran with no load and the main button plays idle, a rev and back (' + L.rpms.join(', ') + ' RPM)');
  ok(L.exits.every(e => e === 2) && L.ph && L.ph.length === 8, 'both banks of the V8: 8 cylinders, 2 exits heard (' + L.exits.join(', ') + ')');
  ok(/line/.test(L.what) && /chamber/.test(L.what) && /tailpipe/.test(L.what) && !L.warn && /^Playing:/.test(L.playing), 'it plays the system set on the other tabs, said above the buttons (' + L.playing.slice(0, 110) + ')');

  // 3. objective properties of the played sound, deterministic with the seed (idle hold, jet off for the band check)
  const M = await pg.evaluate(() => { const X = window.__wsnd, runs = X.WSND.sets[0].runs, P = Object.assign({}, X.WSND.play, { rpm: runs[0].rpm, seconds: 6 });
    const a = X.wsndRender(runs, 'hold', P), a2 = X.wsndRender(runs, 'hold', P), nb = X.wsndRender(runs, 'hold', Object.assign({}, P, { jet: false })), old = X.wsndSound(runs, 'hold', Object.assign({}, P, { old: true }));
    const same = a.x.length === a2.x.length && a.x.every((v, i) => v === a2.x[i]);
    const other = X.wsndRender(runs, 'hold', Object.assign({}, P, { listen: Object.assign({}, X.SND_L, { seed: 777 }) }));
    const steady = X.wsndRender(runs, 'hold', Object.assign({}, P, { listen: Object.assign({}, X.SND_L, { vary: false }) }));
    return { x: Array.from(a.x), nb: Array.from(nb.x), old: Array.from(old), steady: Array.from(steady.x), same, differs: other.x.some((v, i) => v !== a.x[i]), info: a.info, rpm: runs[0].rpm }; });
  const sr = 48000, gNew = gapMedian(M.x, sr, M.rpm), gOld = gapMedian(M.old, sr, M.rpm), gSteady = gapMedian(M.steady, sr, M.rpm);
  ok(M.same && M.differs, 'deterministic: the same seed gives the same samples, another seed another engine');
  ok(gNew >= 3 && gNew <= 30 && gOld > 30, 'the gaps between the orders: ' + gNew.toFixed(1) + ' dB (the recordings 3-25 dB; the old playback ' + gOld.toFixed(1) + ' dB)');
  ok(gSteady > gNew + 5, 'with the variation off the gaps go back toward an organ pipe (' + gSteady.toFixed(1) + ' dB)');
  const ex = exactFraction(M.x, sr, M.rpm), exOld = exactFraction(M.old, sr, M.rpm);
  ok(ex < 0.9 && exOld > 0.98, 'variability present: ' + (100 * ex).toFixed(2) + ' % of the energy on the exact orders (old ' + (100 * exOld).toFixed(2) + ' %)');
  const above = bandShare(M.nb, sr, 1.25 * M.info.fLim);
  ok(Number.isFinite(M.info.fLim) && M.info.fLim > 500 && above < -45, 'no tonal energy above the validity limit (' + M.info.fLim + ' Hz, ' + M.info.by + '): ' + above.toFixed(1) + ' dB re the total above ' + Math.round(1.25 * M.info.fLim) + ' Hz');
  const sl = slope(M.x, sr, 2 * M.rpm / 60 * 4, 0.8 * M.info.fLim);
  ok(sl < -1 && sl > -15, 'spectral slope above the firing frequency to the limit: ' + sl.toFixed(1) + ' dB per octave (the Outback recordings -3.4 to -5.1)');

  // 4. the listening space: off is the open-air sound exactly; on adds a stated, measured room
  await pg.evaluate(() => { const X = window.__wsnd; X.SND_V.on = false; X.WSND.play.how = 'hold'; X.WSND.play.rpm = X.WSND.sets[0].runs[0].rpm; X.wsndPlay('playA'); });
  const off = await pg.evaluate(() => { const X = window.__wsnd, L = X.WSND.lastWav, runs = X.WSND.sets[0].runs, y = X.wsndSound(runs, 'hold', X.WSND.play);
    const FS = 20e-6 * Math.pow(10, 135 / 20) / 0.9, fade = Math.round(0.02 * 48000); let pk = 0; const z = Float32Array.from(y, (v, i) => { const q = v / FS * Math.min(1, i / fade, (y.length - 1 - i) / fade); pk = Math.max(pk, Math.abs(q)); return q; });
    if (pk > 0.98) for (let i = 0; i < z.length; i++) z[i] *= 0.98 / pk; return { wet: L.wet, same: z.length === L.x.length && z.every((v, i) => v === L.x[i]) }; });
  ok(off.wet === null && off.same, 'Reverb off: the played samples are bit-identical to the sound without the feature');
  await pg.click('#wsnd-verb'); await pg.waitForTimeout(300);
  ok(await pg.evaluate(() => { const b = document.getElementById('wsnd-verb'); return b.getAttribute('aria-pressed') === 'true' && /on/.test(b.textContent) && b.tabIndex >= 0; }), 'the Reverb switch is a keyboard-reachable button and says its state in words');
  const V = await pg.evaluate(() => { const X = window.__wsnd, out = {};
    for (const k of ['shop', 'garage']) { const ir = X.sndSpaceIR(k, 7.62, 0.3048, 1.6, 48000), T = X.sndEyring(X.SND_SPACES[k]); out[k] = [1, 2, 3, 4].map(b => [T[b], X.sndSchroeder(ir.l, 48000, [125, 250, 500, 1000, 2000][b])]); }
    const lot = X.sndSpaceIR('lot', 7.62, 0.3048, 1.6, 48000); let first = -1; for (let i = 0; i < lot.l.length; i++) if (Math.abs(lot.l[i]) > 1e-3) { first = i; break; }
    // the lot's wall 8 m behind the car: its image 16 m back along the line (left ear 0.085 m to the side)
    const s = X.SND_SPACES.lot, dx = 0.085, rd = Math.hypot(7.62, dx, 1.6 - 0.3048), ri = Math.hypot(7.62 + 2 * s.src[1], dx, 1.6 - 0.3048);
    return { out, first: first / 48, want: (ri - rd) / 343 * 1000, d0: Math.max(...Array.from(lot.l.slice(0, 3), Math.abs)) }; });
  for (const k in V.out) ok(V.out[k].every(([T, S]) => Math.abs(S / T - 1) < 0.15), k + ': reverberation time from the generated response (Schroeder) within 15 % of the stated Eyring time, 250-2000 Hz (' + V.out[k].map(([T, S]) => S.toFixed(2) + '/' + T.toFixed(2)).join(', ') + ' s)');
  ok(Math.abs(V.first - V.want) < 1, 'open lot: the first reflection arrives ' + V.first.toFixed(2) + ' ms after the direct sound, the geometry says ' + V.want.toFixed(2) + ' ms');
  ok(V.d0 < 1e-6, 'the space adds nothing at the direct sound: its level is the dry signal’s (0 dB change)');
  await pg.evaluate(() => { const X = window.__wsnd; X.SND_V.space = 'shop'; X.wsndPlay('playA'); });
  const on = await pg.evaluate(async () => { const X = window.__wsnd, L = X.WSND.lastWav; X.wsndSaveWav(); await new Promise(r => setTimeout(r, 300));
    const ir = X.sndSpaceIR('shop', X.WSND.play.ft * 0.3048, X.SND_L.tipFt * 0.3048, X.SND_L.earFt * 0.3048, 48000), l = X.sndConvolve(L.x, ir.l), g = Math.pow(10, X.SND_V.wet / 20);
    const v = new DataView(X.wavPcm16st(L.x, L.wet, 48000)); let md = 0; for (let i = 0; i < L.x.length; i += 97) { const want = Math.round(Math.max(-1, Math.min(1, L.x[i] + g * l[i])) * 32767); md = Math.max(md, Math.abs(v.getInt16(44 + 4 * i, true) - want)); }
    return { stereo: v.getUint16(22, true), md, wet: !!L.wet, longer: L.wet.l.length > L.x.length }; });
  ok(on.wet && on.longer && on.stereo === 2 && on.md <= 1, 'Reverb on: the saved WAV is stereo and equals the dry sound plus the offline convolution with the space (largest difference ' + on.md + ' LSB)');
  // a loaded impulse response: a direct sound and one echo at 100 ms, half as loud
  const C = await pg.evaluate(async () => { const X = window.__wsnd, h = new Float32Array(9600); h[0] = 0.8; h[4800] = 0.4;
    const f = new File([X.wavPcm16(h, 48000)], 'test-ir.wav', { type: 'audio/wav' }); await X.sndLoadIR(f); X.wsndPlay('playA'); const L = X.WSND.lastWav, n = 20000;
    let e = 0, d = 0; for (let i = 0; i < n; i++) { e += L.wet.l[i + 4800] * L.x[i]; d += L.x[i] * L.x[i]; } return { k: e / d, space: X.SND_V.space }; });
  ok(C.space === 'custom' && Math.abs(C.k - 0.5) < 0.02, 'a loaded impulse response is applied with its direct sound at the model’s level (echo gain ' + C.k.toFixed(3) + ', want 0.5)');
  await pg.evaluate(() => { const X = window.__wsnd; X.SND_V.space = 'lot'; X.SND_V.on = false; window.__wsnd.WSND.A = 0; }); await pg.evaluate(() => { location.hash = 'sound'; });
  // the table's dB(A) do not move with the playback stages (the estimate's own table, before and after)
  await pg.evaluate(() => { window.__wsnd.WSND.sets = []; }); await chg('wsnd-rpms', '2500'); await chg('wsnd-load', 'wot'); await pg.click('button[data-wsnd="run"]'); await done();
  await pg.click('#wsnd-verb'); await pg.waitForTimeout(200); await chg('wsnd-vary', '0'); await chg('wsnd-path', '0');
  const dbAfter = await pg.evaluate(() => (() => { const t = [...document.querySelectorAll('#panel-sound table')].find(t => /dB\(A\) at/.test(t.innerText)); return t ? t.innerText : ''; })());
  ok(!!dbBefore && !!dbAfter && (dbBefore.match(/\d+\.\d/g) || []).join() === (dbAfter.match(/\d+\.\d/g) || ['x']).join(), 'the table’s dB(A) are the same with the reverb, variation and listening stages switched (' + (dbAfter.match(/\d+\.\d/g) || []).join(', ') + ')');
  await chg('wsnd-vary', '1'); await chg('wsnd-path', '1'); await pg.click('#wsnd-verb');

  // 5. a 2018-20 Mustang GT after Quick's "Fill in every tab" (180 in head to tip): a line and a muffler are played, and
  // they take the level and the upper orders down against open headers at the same speed
  await pg.evaluate(() => { location.hash = 'quick'; }); await pg.waitForTimeout(700);
  await chg('v-mode', 'veh'); await chg('v-class', 'car');
  const mk = await pg.evaluate(() => [...document.getElementById('v-make').options].find(o => /^Ford$/.test(o.value)).value); await chg('v-make', mk);
  const v = await pg.evaluate(() => [...document.getElementById('v-pick').options].find(o => /2018–20 Ford Mustang GT/.test(o.text)).value); await chg('v-pick', v);
  await chg('q-sys', '180'); await pg.click('button[data-qapply]'); await pg.waitForTimeout(800);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(600);
  const G = await pg.evaluate(() => { const X = window.__wsnd, q = X.simInp(), A = X.wsndAutoSys(q); return { src: A.src, notIn: A.notIn, W: A.W && { d: A.W.d, L: A.W.L, kind: A.W.mufKind, fix: A.W.fix, xo: A.W.xo } }; });
  ok(G.src === 'quick' && G.W && G.W.L > 300 && G.W.kind === 'chamber', 'the Mustang’s system comes from the Quick build: ' + JSON.stringify(G.W));
  ok(G.notIn.some(t => /catalytic/.test(t)) && G.notIn.some(t => /internal chambers/.test(t)), 'what the 1-D line cannot carry is listed as not in the sound (' + G.notIn.join(' | ').slice(0, 140) + ')');
  await pg.evaluate(() => { const X = window.__wsnd, q = X.simInp(), A = X.wsndAutoSys(q); X.WSND.sets = [];
    X.wsndJob([{ key: 'open', label: 'open', parts: { line: false, whole: true } }, { key: 'sys', label: 'sys', parts: { sys: A.W, whole: true } }], sets => { X.WSND.sets = sets; }, { rpms: [2500], load: 'none' }); });
  await done();
  const D = await pg.evaluate(() => { const X = window.__wsnd, [o, s] = X.WSND.sets.map(z => z.runs[0]), E = a => 10 * Math.log10(a.reduce((q, v) => q + Math.pow(10, v / 10), 0));
    const hi = r => E(r.spl24.filter((v, i) => (i + 1) / 2 * r.rpm / 60 > 300)); return { what: X.WSND.sets[1].what, dHi: hi(o) - hi(s), dAll: E(o.spl24) - E(s.spl24), exits: s.exits }; });
  ok(/line/.test(D.what) && /chamber/.test(D.what) && /Helmholtz/.test(D.what) && D.exits === 2, 'the played Mustang design names its line, muffler and resonator, both banks (' + D.what.slice(0, 160) + ')');
  ok(D.dHi > 6 && D.dAll > 3, 'against open headers at 2,500 RPM the system takes ' + D.dHi.toFixed(1) + ' dB off the orders above 300 Hz and ' + D.dAll.toFixed(1) + ' dB overall');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log(fails.length ? 'wsndreal_ui: ' + fails.length + ' FAIL' : 'wsndreal_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
