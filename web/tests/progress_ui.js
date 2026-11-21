// Progress bars on the long operations (docs/PROGRESS_BARS_2026-11-21.md). For each operation that runs in the page
// (the wave simulation, the boost simulation, the sound estimate with "Hear each part" and "Hear a misfire", reading a
// recording): the bar appears under its status line with role="progressbar" and its aria values, the value never goes
// down, the label names the operation and the step, it reaches 100 % or gives way to the result, Cancel stops it and the
// bar says so in words, typing in a field while it runs keeps the focus and the caret, nothing below it moves while it
// counts, the indeterminate stripe stands still under reduced motion, and a 400 px window has no sideways scroll. The
// operations that need the Windows program or Fusion are driven through a stand-in bridge, as the host tests do: an
// OpenWAM run (determinate, from the run's "count of of" events), an OpenFOAM run (indeterminate: its iteration figure
// is a cap), a stop and a failure, and a single Fusion call (shown only after 300 ms).   node tests/progress_ui.js
// SHOTS=dir keeps screenshots of the bar (determinate, indeterminate, cancelled, error; light and dark; 1440 and 400 px).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const { settle, uiClick } = require('./settle');
const SHOTS = process.env.SHOTS || '';
function wav(rpm, secs, sr) {   // a 16-bit mono engine-like tone (as rec_ui.js)
  const n = Math.round(secs * sr), f1 = rpm / 60, buf = Buffer.alloc(44 + 2 * n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + 2 * n, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(2 * sr, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(2 * n, 40);
  for (let i = 0; i < n; i++) { const t = i / sr; let v = 0.4 * Math.sin(2 * Math.PI * 2 * f1 * t) + 0.2 * Math.sin(2 * Math.PI * 4 * f1 * t + 1);
    for (const o of [0.5, 1, 1.5, 3]) v += 0.01 * Math.sin(2 * Math.PI * o * f1 * t + o); buf.writeInt16LE(Math.round(v * 32767), 44 + 2 * i); }
  return buf;
}
// in the page: every 25 ms, operation k's bar (value, state, label, where the next block below it is)
const MON = () => { window.__pm = {}; window.__pmOn = k => { const M = window.__pm[k] = { v: [], st: [], txt: [], below: [], seen: false, maxBars: 0 };
  M.iv = setInterval(() => { const ds = document.querySelectorAll('.prog[data-prog="' + k + '"]'); M.maxBars = Math.max(M.maxBars, ds.length); const d = ds[0]; if (!d) return; M.seen = true;
    const t = d.querySelector('[role=progressbar]'), v = t.getAttribute('aria-valuenow'); if (v != null) M.v.push(+v);
    if (M.st[M.st.length - 1] !== d.dataset.st) M.st.push(d.dataset.st); const x = d.textContent; if (M.txt[M.txt.length - 1] !== x) M.txt.push(x);
    const sec = d.closest('.sec'), nx = sec && sec.nextElementSibling; if (nx) M.below.push(Math.round(nx.getBoundingClientRect().top + scrollY)); }, 25); };
  window.__pmOff = k => { const M = window.__pm[k]; clearInterval(M.iv); return { v: M.v, st: M.st, txt: M.txt.slice(-12), below: [...new Set(M.below)], seen: M.seen, maxBars: M.maxBars, txtAll: M.txt.length }; }; };
const bar = (pg, k) => pg.evaluate(k => { const d = document.querySelector('.prog[data-prog="' + k + '"]'); if (!d) return null; const t = d.querySelector('[role=progressbar]');
  return { st: d.dataset.st, role: t.getAttribute('role'), min: t.getAttribute('aria-valuemin'), max: t.getAttribute('aria-valuemax'), now: t.getAttribute('aria-valuenow'), vt: t.getAttribute('aria-valuetext'),
    name: t.getAttribute('aria-label'), txt: d.textContent, anim: getComputedStyle(d.querySelector('.prog-fill')).animationName, w: d.getBoundingClientRect().width }; }, k);
const mono = a => a.every((x, i) => i === 0 || x >= a[i - 1]);
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const errs = [];
  const shot = async (pg, k, name) => { if (!SHOTS) return; const el = await pg.$('.prog[data-prog="' + k + '"]'); if (!el) return;
    await el.evaluate(e => e.scrollIntoView({ block: 'center' })); const r = await el.evaluate(e => { const x = (e.closest('.sec') || e.parentElement).getBoundingClientRect(), y = e.getBoundingClientRect(); return { x: Math.max(0, x.left - 8), y: Math.max(0, y.top - 90), width: Math.min(innerWidth, x.width + 16), height: 170 }; });
    await pg.screenshot({ path: path.join(SHOTS, name + '.png'), clip: r }); };
  const open = async (w, hash, o) => { const ctx = await b.newContext(Object.assign({ viewport: { width: w, height: 900 } }, o || {})); const pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/fonts|net::/.test(m.text())) errs.push(m.text()); });
    await pg.addInitScript(MON); if (o && o.init) await pg.addInitScript(o.init);
    await pg.goto('file://' + process.cwd() + '/index.html#' + hash); await pg.waitForTimeout(700); await settle(pg); return pg; };
  const setv = (pg, id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  // a 450 single (sim_ui.js): the wave simulation takes a few seconds
  const single = async pg => { await uiClick(pg, '#m-expert'); await setv(pg, 'f-n', '1');
    for (const [id, v] of [['f-rpm', '8500'], ['f-evo', '65'], ['f-dp', '1.65'], ['f-disp', '27.4'], ['f-cyl', '1'], ['f-trq', '7000'], ['f-bore', '3.74'], ['f-stroke', '2.496'], ['f-cratio', '13']]) await setv(pg, id, v);
    await settle(pg); };
  const simSecBelow = pg => pg.evaluate(() => { const s = document.querySelector('#panel-four .sec[data-sec="wave-simulation"]'); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 120); return Math.round(s.nextElementSibling.getBoundingClientRect().top + scrollY); });

  // ---- 1. the wave simulation, 1440 px, light
  {
    const pg = await open(1440, 'four-stroke'); await single(pg);
    // a first run teaches the reserved space its size at this width (the page does this on every first run)
    await pg.click('button[data-sim="run"]'); await pg.waitForFunction(() => !document.getElementById('sim-status') && document.getElementById('sim-svg'), null, { timeout: 180000 }); await settle(pg); await pg.waitForTimeout(600);
    // the results present, the run again: its bar sits under the status line above the old results
    await pg.evaluate(() => window.__pmOn('sim')); const y0 = await simSecBelow(pg);
    await pg.click('button[data-sim="run"]');
    await pg.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="sim"] [role=progressbar]'); return d && +d.getAttribute('aria-valuenow') > 0; }, null, { timeout: 60000 });
    const B = await bar(pg, 'sim');
    ok(B && B.role === 'progressbar' && B.min === '0' && B.max === '100' && /^\d+$/.test(B.now) && /^step \d+ of \d+ \(\d+ %\)$/.test(B.vt) && B.name === 'Wave simulation',
      'wave simulation: a progressbar with aria-valuemin/max/now and a value text (' + JSON.stringify(B && { now: B.now, vt: B.vt, name: B.name }) + ')');
    ok(B && /^Wave simulation: .+ · step \d+ of \d+ · \d+ %/.test(B.txt) && B.st === 'run', 'its label names the operation and the step: "' + (B && B.txt) + '"');
    await shot(pg, 'sim', 'determinate-1440-light');
    // typing in a field while it runs: focus and caret kept (the run goes on)
    const ty = await pg.evaluate(async () => { const f = document.querySelector('#panel-four input.wamx[type=text]'); f.scrollIntoView({ block: 'center' }); f.focus(); f.setSelectionRange(4, 4); return [document.activeElement.dataset.k, f.selectionStart]; });
    await pg.keyboard.type('1'); await pg.waitForTimeout(400); const ta = await pg.evaluate(() => [document.activeElement.dataset.k, document.activeElement.selectionStart, document.activeElement.value]);
    await pg.keyboard.press('Backspace'); await pg.waitForTimeout(200);
    ok(ty[0] && ta[0] === ty[0] && ta[1] === 5 && /^\d{4}1 \d/.test(ta[2]), 'typing in a field while the bar moves keeps the focus and the caret (' + JSON.stringify(ta) + ')');
    await pg.evaluate(() => document.activeElement.blur());
    await pg.waitForFunction(() => !document.getElementById('sim-status') && document.getElementById('sim-svg'), null, { timeout: 180000 }); await settle(pg); await pg.waitForTimeout(300);
    const M = await pg.evaluate(() => window.__pmOff('sim')); const y1 = await simSecBelow(pg);
    const gone = await pg.evaluate(() => !document.querySelector('.prog[data-prog="sim"]'));
    ok(M.seen && mono(M.v) && M.v.length > 5 && M.maxBars === 1, 'the value never goes down (' + M.v.length + ' readings, ' + M.v[0] + ' → ' + M.v[M.v.length - 1] + ' %) and there is one bar');
    ok(gone && (M.v[M.v.length - 1] >= 90 || M.v[M.v.length - 1] === 100), 'it reaches ' + M.v[M.v.length - 1] + ' % and gives way to the result');
    ok(M.below.length >= 1 && Math.max(...M.below) - Math.min(...M.below) <= 2, 'nothing below moves while it counts (the next section at ' + M.below.join(', ') + ' px)');
    // a run with no results on show: the bar inside the reserved space, which the results then take over (its size was
    // learnt from the run above, as the page does for every first run at a width)
    await pg.evaluate(() => { const S = window.__sim.state; S.res = null; S.rpms = null; S.status = 'idle'; document.getElementById('f-evo').dispatchEvent(new Event('input', { bubbles: true })); }); await settle(pg);
    await pg.evaluate(() => window.__pmOn('sim'));
    await pg.click('button[data-sim="run"]'); await pg.waitForFunction(() => document.querySelector('.prog[data-prog="sim"]'), null, { timeout: 30000 }); await settle(pg);
    const inR = await pg.evaluate(() => !!document.querySelector('.prog[data-prog="sim"]').closest('.resv')); const z0 = await simSecBelow(pg);
    await pg.waitForFunction(() => !document.getElementById('sim-status') && document.getElementById('sim-svg'), null, { timeout: 180000 }); await settle(pg); await pg.waitForTimeout(300);
    const z1 = await simSecBelow(pg), Mz = await pg.evaluate(() => window.__pmOff('sim'));
    ok(inR && Math.abs(z1 - z0) <= 2 && Math.max(...Mz.below) - Math.min(...Mz.below) <= 2, 'no results on show: the bar sits in the reserved space and the results take it over with no jump (the section below at ' + z0 + ' px while it ran, ' + z1 + ' after; ' + Mz.below.join(', ') + ')');
    // Cancel: the bar stops and says so (a fresh page: the bar in the reserved space)
    const p3 = await open(1440, 'four-stroke'); await single(p3);
    await p3.evaluate(() => window.__pmOn('sim'));
    await p3.click('button[data-sim="run"]');
    // Cancel: the bar stops and says so
    await p3.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="sim"] [role=progressbar]'); return d && +d.getAttribute('aria-valuenow') > 0; }, null, { timeout: 60000 });
    await p3.click('button[data-runcancel="sim"]'); await settle(p3); await p3.waitForTimeout(200);
    const C = await bar(p3, 'sim'), live = await p3.evaluate(() => document.getElementById('prog-live').textContent);
    ok(C && /^stop/.test(C.st) && /Wave simulation · cancelled at step \d+ of \d+ \(\d+ %\)\. The results before it are kept\./.test(C.txt) && /cancelled/.test(C.vt) && /cancelled/.test(live),
      'Cancel: the bar stops and says "' + (C && C.txt) + '" (value text "' + (C && C.vt) + '"; read out: "' + live + '")');
    await shot(p3, 'sim', 'cancelled-1440-light');
    const M3 = await p3.evaluate(() => window.__pmOff('sim'));
    ok(mono(M3.v), 'the stopped bar keeps its value (' + M3.v.slice(-3).join(', ') + ')');
    // a new run clears the stopped bar
    await p3.click('button[data-sim="run"]'); await p3.waitForTimeout(300);
    ok(await p3.evaluate(() => document.querySelectorAll('.prog[data-prog="sim"]').length === 1 && /^run/.test(document.querySelector('.prog[data-prog="sim"]').dataset.st)), 'a new run replaces the stopped bar with a running one');
    await p3.click('button[data-runcancel="sim"]').catch(() => {});
    await p3.context().close(); await pg.context().close();
  }

  // ---- 2. the sound estimate, "Hear each part" and "Hear a misfire" (two speeds each), and the recording
  {
    const pg = await open(1440, 'four-stroke'); await single(pg);
    await pg.evaluate(() => { location.hash = 'sound'; }); await settle(pg);
    await setv(pg, 'wsnd-rpms', '4000 7000'); await settle(pg);
    await pg.evaluate(() => window.__pmOn('wsnd'));
    await pg.click('button[data-wsnd="run"]');
    await pg.waitForFunction(() => document.querySelector('.prog[data-prog="wsnd"]'), null, { timeout: 30000 });
    const B = await bar(pg, 'wsnd'), inR = await pg.evaluate(() => !!document.querySelector('.prog[data-prog="wsnd"]').closest('.resv'));
    await shot(pg, 'wsnd', 'determinate-wsnd-1440-light');
    await pg.waitForFunction(() => /^Done/.test((document.getElementById('wsnd-msg') || {}).textContent || ''), null, { timeout: 300000 }); await settle(pg);
    let M = await pg.evaluate(() => window.__pmOff('wsnd'));
    ok(B && B.role === 'progressbar' && /^Estimate the sound · step \d of \d · \d+ %/.test(B.txt) && inR, 'Estimate the sound: "' + (B && B.txt) + '", in the space its results will take (' + inR + ')');
    ok(mono(M.v) && M.v.length && Math.max(...M.v) >= 50 && await pg.evaluate(() => !document.querySelector('.prog[data-prog="wsnd"]')), 'its value never goes down (' + [...new Set(M.v)].join(', ') + ' %) and the result replaces it');
    // Hear each part: one step per design and speed, the design named
    await pg.evaluate(() => window.__pmOn('wsnd'));
    await pg.click('button[data-wsnd="parts"]');
    await pg.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="wsnd"] [role=progressbar]'); return d && +d.getAttribute('aria-valuenow') > 0; }, null, { timeout: 120000 });
    const P = await bar(pg, 'wsnd');
    ok(/^Hear each part(: design \d+ of \d+, .+)? · step \d+ of \d+ · \d+ %/.test(P.txt), 'Hear each part: "' + P.txt + '"');
    await pg.click('button[data-runcancel="wsnd"]'); await settle(pg); await pg.waitForTimeout(200);
    const Pc = await bar(pg, 'wsnd'); M = await pg.evaluate(() => window.__pmOff('wsnd'));
    ok(Pc && /^stop/.test(Pc.st) && /^Hear each part · cancelled at step \d+ of \d+ \(\d+ %\)/.test(Pc.txt) && mono(M.v), 'Cancel on Hear each part: "' + (Pc && Pc.txt) + '"');
    // Hear a misfire, to the end
    await pg.click('button[data-wsnd="misfire"]');
    await pg.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="wsnd"][data-st^="run"] [role=progressbar]'); return d && +d.getAttribute('aria-valuenow') > 0; }, null, { timeout: 120000 });
    const F = await bar(pg, 'wsnd');
    await pg.waitForFunction(() => /^Done/.test((document.getElementById('wsnd-msg') || {}).textContent || '') && !document.querySelector('.prog[data-prog="wsnd"]'), null, { timeout: 300000 });
    ok(/^Hear a misfire: design \d of 2, .+ · step \d+ of \d+ · \d+ %/.test(F.txt), 'Hear a misfire: "' + F.txt + '", gone when it is done');
    // reading a recording (12 s): "decoding" with no fraction, then a fraction of the frames
    const tmp = path.join(os.tmpdir(), 'prog_rec.wav'); fs.writeFileSync(tmp, wav(3000, 12, 44100));
    await pg.evaluate(() => window.__pmOn('rec'));
    await pg.setInputFiles('#rec-file', tmp);
    await pg.waitForFunction(() => window.__rec.REC.fr || window.__rec.REC.err, null, { timeout: 180000 }); await settle(pg);
    M = await pg.evaluate(() => window.__pmOff('rec'));
    ok(M.seen && mono(M.v) && M.txt.some(t => /^Reading the recording · \d+ %/.test(t)) && await pg.evaluate(() => !document.querySelector('.prog[data-prog="rec"]')),
      'reading a recording: "' + (M.txt.find(t => /%/.test(t)) || M.txt[0]) + '", values ' + [...new Set(M.v)].slice(0, 8).join(', ') + '…, gone when it is read');
    fs.unlinkSync(tmp);
    await pg.context().close();
  }

  // ---- 3. the boost simulation (turbo on the Intake tab): starts with no fraction, then counts its speeds; Cancel
  {
    const pg = await open(1440, 'intake');
    await setv(pg, 'i-ind', 'turbo'); await setv(pg, 'i-hp', '450'); await settle(pg);
    await pg.evaluate(() => { location.hash = 'four-stroke'; }); await settle(pg);
    await pg.evaluate(() => window.__pmOn('tsim'));
    await pg.click('button[data-tsim="run"]');
    await pg.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="tsim"] [role=progressbar]'); return d && d.getAttribute('aria-valuenow') != null; }, null, { timeout: 120000 });
    await pg.waitForTimeout(1500);
    const B = await bar(pg, 'tsim');
    await shot(pg, 'tsim', 'determinate-tsim-1440-light');
    await pg.click('button[data-runcancel="tsim"]'); await settle(pg); await pg.waitForTimeout(200);
    const C = await bar(pg, 'tsim'), M = await pg.evaluate(() => window.__pmOff('tsim'));
    ok(M.st[0] === 'run ind' && /^Boost simulation: starting · working; how far it has got is not known/.test(M.txt[0] || '') || M.st.includes('run'), 'boost simulation: starts with no fraction ("' + M.txt[0] + '"), then counts (' + M.st.join(' → ') + ')');
    ok(B && /^Boost simulation · step \d+ of \d+ · \d+ %/.test(B.txt) && mono(M.v), 'its label: "' + (B && B.txt) + '"; the value never goes down');
    ok(C && /^stop/.test(C.st) && /^Boost simulation · cancelled at step \d+ of \d+/.test(C.txt), 'Cancel: "' + (C && C.txt) + '"');
    await pg.context().close();
  }

  // ---- 4. 400 px, dark: no sideways scroll with a bar showing; the label wraps inside its box
  {
    const pg = await open(400, 'four-stroke', { colorScheme: 'dark' }); await single(pg);
    await pg.evaluate(() => document.querySelector('button[data-sim="run"]').click());
    await pg.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="sim"] [role=progressbar]'); return d && +d.getAttribute('aria-valuenow') > 0; }, null, { timeout: 60000 });
    const r = await pg.evaluate(() => { const d = document.querySelector('.prog[data-prog="sim"]'), x = d.getBoundingClientRect(); return { sw: document.scrollingElement.scrollWidth, iw: innerWidth, l: x.left, r: x.right, h: x.height }; });
    ok(r.sw <= r.iw && r.l >= 0 && r.r <= r.iw, '400 px: no sideways scroll with the bar showing (' + JSON.stringify(r) + ')');
    await shot(pg, 'sim', 'determinate-400-dark');
    await pg.evaluate(() => document.querySelector('button[data-runcancel="sim"]').click()); await settle(pg);
    await shot(pg, 'sim', 'cancelled-400-dark');
    await pg.context().close();
  }

  // ---- 5. the program's runs through a stand-in bridge: OpenWAM (determinate), OpenFOAM (indeterminate), a stop, a
  // failure; and the reduced-motion stripe
  const STUB = () => { const S = window.__stub = { fail: null, pending: [] };
    window.exhaustTunerHost = { version: 'stub',
      call(a, d, onEvent) {
        if (a === 'hostInfo') return Promise.resolve({ ok: true, version: 'stub', where: 'program', engines: { openwam: true, openfoam: true, enginesim: false } });
        if (a === 'runOpenWAM') { const ms = (d.files || []).filter(f => /\.wam$/i.test(f.name)).map(f => f.name.replace(/\.wam$/i, '')); const n = Math.max(ms.length, 4);
          return new Promise((res, rej) => { const p = { rej, t: [] }; S.pending.push(p);
            for (let i = 0; i < n; i++) { p.t.push(setTimeout(() => onEvent && onEvent({ event: 'start', model: ms[i] || 'm' + i, of: n }), 300 + i * 500));
              p.t.push(setTimeout(() => onEvent && onEvent({ event: 'done', model: ms[i] || 'm' + i, finished: true, seconds: 0.5, count: i + 1, of: n }), 700 + i * 500)); }
            p.t.push(setTimeout(() => { S.pending.splice(S.pending.indexOf(p), 1); res({ folder: 'C:\\runs\\stub', models: [] }); }, 900 + n * 500)); }); }
        if (a === 'runOpenFOAM') return new Promise((res, rej) => { const p = { rej, t: [] }; S.pending.push(p);
          p.t.push(setTimeout(() => onEvent && onEvent({ event: 'step', step: 'blockMesh' }), 100));
          p.t.push(setTimeout(() => onEvent && onEvent({ event: 'step', step: 'rhoSimpleFoam' }), 400));
          p.t.push(setTimeout(() => onEvent && onEvent({ event: 'progress', step: 'rhoSimpleFoam', iteration: 400, of: 4000, seconds: 2 }), 900));
          p.t.push(setTimeout(() => { S.pending.splice(S.pending.indexOf(p), 1); if (S.fail) res({ ok: false, msg: S.fail }); else res({ ok: true, folder: 'C:\\runs\\x', steps: [], results: {} }); }, 2600)); });
        return Promise.resolve({ ok: true });
      },
      cancel() { setTimeout(() => S.pending.splice(0).forEach(p => { p.t.forEach(clearTimeout); p.rej(new Error('Stopped.')); }), 100); } }; };
  for (const [scheme, motion] of [['light', 'no-preference'], ['dark', 'reduce']]) {
    const pg = await open(1440, 'four-stroke', { colorScheme: scheme, reducedMotion: motion, init: STUB });
    await pg.waitForFunction(() => document.documentElement.classList.contains('in-desktop'), null, { timeout: 15000 }); await settle(pg);
    await uiClick(pg, '#m-expert'); await settle(pg);
    const hasRun = await pg.evaluate(() => !!document.querySelector('button[data-wam="run"]'));
    if (scheme === 'light') {
      await pg.evaluate(() => { window.__pmOn('wam'); const s = document.querySelector('#panel-four .sec[data-sec="run-it-in-openwam"]'); if (s) s.scrollIntoView(); document.querySelector('button[data-wam="run"]').click(); });
      await pg.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="wam"] [role=progressbar]'); return d && +d.getAttribute('aria-valuenow') >= 50; }, null, { timeout: 20000 }).catch(() => {});
      const B = await bar(pg, 'wam');
      await shot(pg, 'wam', 'determinate-host-1440-light');
      await pg.waitForFunction(() => !document.querySelector('.prog[data-prog="wam"]'), null, { timeout: 20000 }).catch(() => {});
      const M = await pg.evaluate(() => window.__pmOff('wam'));
      ok(hasRun && B && /^OpenWAM run: .+ · step \d of \d · \d+ %/.test(B.txt) && M.st[0] === 'run ind' && mono(M.v) && !M.st.includes('stop'),
        'OpenWAM in the program: no fraction until the run says how many models, then "' + (B && B.txt) + '" (' + M.st.join(' → ') + '; values ' + [...new Set(M.v)].join(', ') + '), gone when it is done');
      // Stop: the run's own Stop button
      await pg.evaluate(() => document.querySelector('button[data-wam="run"]').click());
      await pg.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="wam"] [role=progressbar]'); return d && +d.getAttribute('aria-valuenow') >= 25; }, null, { timeout: 20000 }).catch(() => {});
      await pg.evaluate(() => { const s = document.querySelector('button[data-wam="stop"]'); if (s) s.click(); });
      await pg.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="wam"]'); return d && /^stop/.test(d.dataset.st); }, null, { timeout: 10000 }).catch(() => {});
      const S = await bar(pg, 'wam');
      ok(S && /^OpenWAM run · cancelled at step \d of \d \(\d+ %\)\.$/.test(S.txt), 'Stop: "' + (S && S.txt) + '"');
      await shot(pg, 'wam', 'cancelled-host-1440-light');
    }
    // OpenFOAM (the intake CFD's path: its message, then the run): no fraction, named steps and iterations; then a failure
    await pg.evaluate(() => { location.hash = 'intake'; }); await settle(pg);
    const run = () => pg.evaluate(() => { const P = window.__prog; P.cfdMsg('Running the stand-in case in OpenFOAM on this PC.'); const m = document.getElementById('cfd-msg'), dt = m && m.closest('details'); if (dt) dt.open = true; window.__pmOn('cfd'); return P.hostRun('cfd', 'runOpenFOAM', { name: 'stub', files: [] }, () => {}).then(r => { if (!r.ok) P.cfdMsg('OpenFOAM: ' + r.msg, true); return r.ok; }, e => e.message); });
    const pr = run();
    await pg.waitForFunction(() => { const d = document.querySelector('.prog[data-prog="cfd"]'); return d && /iteration/.test(d.textContent); }, null, { timeout: 10000 }).catch(() => {});
    const I = await bar(pg, 'cfd');
    await shot(pg, 'cfd', 'indeterminate-1440-' + scheme + (motion === 'reduce' ? '-reduced' : ''));
    await pr; await settle(pg);
    const Mi = await pg.evaluate(() => window.__pmOff('cfd'));
    ok(I && I.st === 'run ind' && I.now === null && /^Intake CFD in OpenFOAM: rhoSimpleFoam, iteration 400 \(at most 4,000\) · working; how far it has got is not known/.test(I.txt) && Mi.v.length === 0,
      'OpenFOAM (' + scheme + '): an indeterminate bar with no aria-valuenow and no percentage: "' + (I && I.txt) + '"');
    ok(I && (motion === 'reduce' ? I.anim === 'none' : I.anim === 'prog-run'), 'the stripe ' + (motion === 'reduce' ? 'stands still under reduced motion' : 'moves') + ' (animation ' + (I && I.anim) + ')');
    ok(await pg.evaluate(() => !document.querySelector('.prog[data-prog="cfd"]')), 'it goes when the run is done');
    await pg.evaluate(() => { window.__stub.fail = 'snappyHexMesh failed: stand-in error'; }); const pf = run(); await pf; await settle(pg); await pg.waitForTimeout(100);
    const E = await bar(pg, 'cfd');
    ok(E && /^err/.test(E.st) && /^Intake CFD in OpenFOAM · stopped by a problem: snappyHexMesh failed: stand-in error/.test(E.txt) && /stopped by a problem/.test(E.vt), 'a failure stops the bar and says so: "' + (E && E.txt) + '"');
    await shot(pg, 'cfd', 'error-1440-' + scheme);
    await pg.evaluate(() => { window.__stub.fail = null; });
    await pg.context().close();
  }

  // ---- 6. one Fusion call (no events): a bar only while it is still waiting after 300 ms, after the button pressed
  {
    const FX = () => { window.__fxDelay = 1200; window.__fxAns = { ok: true, msg: 'Built.' };
      window.adsk = { fusionSendData: (a, d) => a === 'route' ? new Promise(r => setTimeout(() => r(JSON.stringify(window.__fxAns)), window.__fxDelay)) : JSON.stringify({ ok: false, msg: 'stand-in' }) }; };
    const pg = await open(1440, 'headers', { init: FX });
    await pg.evaluate(() => { const a = document.createElement('div'); a.className = 'actions'; a.id = 't-act'; a.innerHTML = '<button type="button" class="btn" id="t-btn">Build in Fusion</button>'; document.querySelector('#panel-headers').prepend(a);
      document.getElementById('t-btn').addEventListener('click', () => { window.__fxP = window.__prog.fusionCall('route', {}); }); });
    const seen = async () => { await pg.click('#t-btn'); const t0 = Date.now(); let first = null, st = null;
      while (Date.now() - t0 < 4000) { const s = await pg.evaluate(() => { const d = document.querySelector('.prog[data-prog="fx"]'); return d ? [d.dataset.st, d.textContent, d.previousElementSibling && d.previousElementSibling.id] : null; });
        if (s && first == null) first = [Date.now() - t0, s]; if (s) st = s; if (!s && first && /^run/.test(first[1][0]) && Date.now() - t0 > 1400) break; await pg.waitForTimeout(40); }
      await pg.evaluate(() => window.__fxP); await pg.waitForTimeout(100); return { first, last: st, now: await pg.evaluate(() => { const d = document.querySelector('.prog[data-prog="fx"]'); return d ? [d.dataset.st, d.textContent] : null; }) }; };
    let r = await seen();
    ok(r.first && r.first[0] >= 250 && r.first[1][0] === 'run ind' && /^Waiting for Fusion: building the route · working/.test(r.first[1][1]) && r.first[1][2] === 't-act' && !r.now,
      'a Fusion call still waiting after 300 ms: "' + (r.first && r.first[1][1]) + '" after the button\'s row (' + (r.first && r.first[0]) + ' ms after the press), gone with the answer');
    await pg.evaluate(() => { window.__fxDelay = 80; }); r = await seen();
    ok(!r.first, 'a quick answer (80 ms) shows no bar');
    await pg.evaluate(() => { window.__fxDelay = 700; window.__fxAns = { ok: false, msg: 'Select a sketch path first.' }; }); r = await seen();
    ok(r.now && /^err/.test(r.now[0]) && /stopped by a problem: Select a sketch path first\./.test(r.now[1]), 'a refusal stops the bar and says so: "' + (r.now && r.now[1]) + '"');
    await pg.context().close();
  }
  ok(!errs.length, 'no page errors (' + errs.slice(0, 3).join(' | ') + ')');
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
})();
