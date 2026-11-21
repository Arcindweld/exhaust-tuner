// deliver.js - the round-two listening files (docs/SOUND_REALISM_ROUND2_2026-11-21.md, section 9): a 2018-20 Mustang GT after
// Quick's "Fill in every tab" (180 in head to tip), the page's own wave model and sound path, written as 48 kHz 16-bit mono
// WAVs peak-normalised to the same level (0.9 of full scale), reverb off.
//   node tools/sound/deliver.js OUT_DIR STEP [--dx 0.02]
//   STEP: mustang_r1 | mustang_r2 | v8_xo | v8_muf
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const { wav16 } = require('./render_page.js'), { mustang } = require('./ablate.js');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const [out, step] = argv, dx = +opt('--dx', 0.02);
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch(); const pg = await (await b.newContext()).newPage(); pg.on('pageerror', e => console.error('page error:', e.message));
  const chg = async (id, v) => { await pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, String(v)]); await pg.waitForTimeout(250); };
  await pg.goto('file://' + path.resolve(__dirname, '..', '..', 'web', 'index.html') + '#four-stroke'); await pg.waitForTimeout(900); await mustang(pg, chg);
  const t0 = Date.now();
  const res = await pg.evaluate(async ([step, dx]) => {
    const X = window.__wsnd, q = X.simInp(), A = X.wsndAutoSys(q), W = A.W, cp = o => Object.assign(JSON.parse(JSON.stringify(W)), o); X.WSND.dx = dx;
    const job = (vars, o) => new Promise(r => X.wsndJob(vars, sets => r(sets), o));
    const R1 = { fine: false, pos: 'road', ground: 'mirror', idle: false, shell: false }, files = [];
    const nc = X.wsndSpec(q, { sys: W, whole: true }).spec.opt.phases.length, all = Array.from({ length: nc }, (_, i) => i);
    const blipVars = (sys, lab) => { const pl = X.wsndBlipPlan(q); return [{ key: 'idle', label: lab, parts: { sys, whole: true }, rpms: [pl.idle], load: 'none', mode: 'idle' }, { key: 'wot', label: lab, parts: { sys, whole: true }, rpms: pl.wot, load: 'wot', mode: 'wot' }, { key: 'motor', label: lab, parts: { sys, whole: true }, rpms: pl.motor, load: 'motor', mode: 'motor', dead: all }]; };
    const revR = [X.wsndListenRpms(q)[0], 1500, 2500, 4000];
    const render = (runs, how, L, P) => { const RR = X.wsndRender(runs, how, Object.assign({}, X.WSND.play, { rpm: runs[0].rpm, ft: 25 }, P || {}, { listen: Object.assign({}, X.SND_L, L || {}) })); return RR; };
    if (step === 'mustang_r1') { const s = await job([{ key: 'r1', label: 'round one', parts: { sys: cp({ mufLay: false }), whole: true } }], { rpms: X.wsndListenRpms(q), load: 'none' });
      const R = render(s[0].runs, 'show', R1); files.push({ name: 'mustang_gt_round1.wav', x: Array.from(R.x), info: R.info, what: s[0].what, runs: s[0].runs }); }
    if (step === 'mustang_r2') { const s = await job(blipVars(W, 'round two'), { rpms: [X.wsndBlipPlan(q).idle], load: 'none' }), runs = [].concat(...s.map(z => z.runs));
      const R = render(runs, 'blip', {}); files.push({ name: 'mustang_gt_round2.wav', x: Array.from(R.x), info: R.info, what: s[0].what, plan: X.wsndBlipPlan(q), runs }); }
    if (step === 'v8_xo') { const xo = W.xoC, pos = xo.pos, v = [['v8_true_duals_r2.wav', cp({ xo: 'none' })], ['v8_h_pipe_r2.wav', cp({ xo: 'cmp', xoC: { type: 'h', pos, dc: xo.dc, tube: xo.tube, name: 'H-pipe' } })], ['v8_x_pipe_r2.wav', cp({ xo: 'cmp', xoC: { type: 'x', pos, dc: xo.dc, tube: xo.tube, name: 'X-pipe' } })]];
      const s = await job(v.map(([k, sys]) => ({ key: k, label: k, parts: { sys, whole: true } })), { rpms: revR, load: 'none' });
      s.forEach((z, i) => { const R = render(z.runs, 'rev', {}); files.push({ name: v[i][0], x: Array.from(R.x), info: R.info, what: z.what, runs: z.runs }); }); }
    if (step === 'v8_muf') { const M = W.mufDims, v = [['v8_flowmaster_style.wav', cp({})], ['v8_straight_through.wav', cp({ mufKind: 'packed', mufDims: Object.assign({}, M, { type: 'straight' }) })]];
      const s = await job(v.map(([k, sys]) => ({ key: k, label: k, parts: { sys, whole: true } })), { rpms: revR, load: 'none' });
      s.forEach((z, i) => { const R = render(z.runs, 'rev', {}); files.push({ name: v[i][0], x: Array.from(R.x), info: R.info, what: z.what, runs: z.runs }); }); }
    return { files, notIn: A.notIn, runs: files.map(f => f.runs || null) }; }, [step, dx]);
  for (const f of res.files) { fs.writeFileSync(path.join(out, f.name), wav16(f.x, 48000)); delete f.x;
    if (f.runs) fs.writeFileSync(path.join(opt('--runs', out), f.name.replace(/\.wav$/, '_runs.json')), JSON.stringify(f.runs)); delete f.runs; }
  delete res.runs;
  fs.writeFileSync(path.join(out, step + '.json'), JSON.stringify(res, null, 1)); console.log(step, 'done in', ((Date.now() - t0) / 1000).toFixed(0), 's'); await b.close();
})();
