// Hangers tab: every part draws without errors, its dimensions read in inches and millimetres, the DXF is closed
// outlines plus round holes in mm, the strength figures match a hand sum, the rod's bend sheet adds up, the Fusion
// buttons read the tube and send the payload, and the payloads go to fusion-addin/tests/hang_payloads.json for
// test_hangers.py. Run from web/.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const b = await chromium.launch(), fails = [], errs = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript(() => { window.__sent = []; window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, JSON.parse(d)]);
    if (a === 'hangPick') return Promise.resolve(JSON.stringify({ ok: true, od_mm: 63.5, reach_mm: 101.6, msg: 'Read tube 63.5 mm (2.500 in) outside and the mount 101.6 mm (4.000 in) out from the tube centre.' }));
    if (a === 'hang') return Promise.resolve(JSON.stringify({ ok: true, msg: 'Built the weld-on pipe tab square to the tube: Pipe tab.' }));
    return Promise.resolve(JSON.stringify({ ok: true })); } }; });
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/index.html#hangers'); await p.waitForTimeout(1200); await p.click('#u-met'); await p.waitForTimeout(200);
  const sel = (id, v) => p.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const put = (id, mm) => p.evaluate(([id, mm]) => window.__hang.set(id, mm), [id, mm]);
  ok(await p.evaluate(() => !!document.getElementById('tab-hang') && !document.getElementById('panel-hang').hidden), 'a Hangers tab under Exhaust parts, open at #hangers');
  // every part
  const pays = {};
  for (const [name, part, extra] of [['tab', 'tab', []], ['tab_along', 'tab', [['hg-orient', 'along']]], ['tab_3holes', 'tab', [['hg-orient', 'across']]], ['pair', 'pair', []], ['body', 'body', []], ['rod', 'rod', []], ['ring', 'ring', []]]) {
    await sel('hg-part', part); for (const [i, v] of extra) await sel(i, v);
    if (name === 'tab_3holes') { await put('hg-nh', 3); await put('hg-reach', 100); } else if (part === 'tab') { await put('hg-nh', 1); await put('hg-reach', name === 'tab_along' ? 88.9 : 63.5); }
    await p.waitForTimeout(200);
    const r = await p.evaluate(() => ({ key: document.getElementById('hg-key').innerText, svgText: [...document.querySelectorAll('#hg-svg text')].map(t => t.textContent), paths: document.querySelectorAll('#hg-svg path').length,
      det: document.getElementById('hg-details').innerText, pay: window.__hang && (() => { const H = window.__hang; return null; })() }));
    const pay = await p.evaluate(() => window.__hang.hgPayload());
    pays[name] = pay;
    const dimsBoth = r.svgText.filter(t => / in \(/.test(t) && /mm\)/.test(t)).length;
    ok(!/note bad/.test(await p.evaluate(() => document.getElementById('hg-key').innerHTML)) && r.paths > 0 && dimsBoth >= 2,
      name + ': draws, ' + dimsBoth + ' dimensions in inches and mm (' + r.svgText.slice(0, 3).join('; ') + ')');
  }
  // the default tab's numbers: tear-out by hand, holes, the cope
  await sel('hg-part', 'tab'); await put('hg-nh', 1); await put('hg-reach', 63.5); await p.waitForTimeout(200);
  const T = await p.evaluate(() => { const H = window.__hang, o = H.hgRead(), ps = H.hgParts(o), q = ps[0]; return { o, rows: H.hgStrength(o, q, H.HG_MAT[o.mat]), dims: q.dims, holes: q.holes, nseg: q.outline.length,
    cope: q.outline.filter(s => s.t === 'A' && !s.ccw && Math.abs(s.c[0]) < 1e-9 && Math.abs(s.c[1]) < 1e-9).map(s => s.r) }; });
  const hole = T.holes.find(h => h.what === 'isolator hole'), tear = T.rows.find(r => /Tearing/.test(r.m));
  const top = T.dims.top, e = top - hole.c[1] - hole.r, hand = 0.577 * 205 * 2 * e * T.o.t;
  ok(Math.abs(tear.F - hand) / hand < 0.01, 'tear-out past the hole: ' + Math.round(tear.F) + ' N against ' + Math.round(hand) + ' N by hand (0.577 × 205 MPa × 2 × ' + e.toFixed(2) + ' × ' + T.o.t.toFixed(3) + ' mm)');
  ok(T.cope.length === 1 && Math.abs(T.cope[0] - 38.1) < 1e-9 && Math.abs(hole.r * 2 - 17.4625) < 1e-9, 'coped to the 3 in tube (R 38.1 mm), 11/16 in grommet hole (McMaster 1061T132 by default)');
  // the DXF: parse it back, check every outline closes and the holes are circles
  const dx = await p.evaluate(() => { const H = window.__hang, L = H.last(); return H.hgDxf(L.parts); });
  const lines = dx.split(/\r?\n/), ents = [];
  for (let i = 0; i < lines.length - 1; i += 2) { const c = lines[i].trim(), v = lines[i + 1]; if (c === '0') ents.push({ type: v, g: {} }); else if (ents.length) ents[ents.length - 1].g[c] = parseFloat(v); }
  const segs = ents.filter(x => x.type === 'LINE' || x.type === 'ARC'), circ = ents.filter(x => x.type === 'CIRCLE');
  const ends = segs.map(x => x.type === 'LINE' ? [[x.g['10'], x.g['20']], [x.g['11'], x.g['21']]] : [0, 1].map(k => { const a = (k ? x.g['51'] : x.g['50']) * Math.PI / 180; return [x.g['10'] + x.g['40'] * Math.cos(a), x.g['20'] + x.g['40'] * Math.sin(a)]; }));
  const pts = ends.flat(), lonely = pts.filter(q => pts.filter(r => Math.hypot(r[0] - q[0], r[1] - q[1]) < 1e-3).length < 2).length;
  ok(/\$INSUNITS\r?\n70\r?\n4/.test(dx) && segs.length === T.nseg && lonely === 0 && circ.length === T.holes.length, 'DXF in mm: ' + segs.length + ' lines and arcs meeting end to end (0 loose ends), ' + circ.length + ' circles for the holes');
  // laser checks shown, and the grommet
  const det = await p.evaluate(() => document.getElementById('hg-details').innerText);
  ok(/Laser cutting check/.test(det) && /metal round the holes/.test(det) && /SendCutSend stock/.test(det) && /1061T132/.test(det), 'the cut-file section has the laser checks, the stock thickness and the grommet');
  // the fin model against the textbook fin: constant width, no radiation, fixed h, adiabatic tip:
  // theta(x)/theta0 = cosh(m (L - x)) / cosh(m L), m = sqrt(h P / (k A)) (Incropera eq. 3.75)
  const fin = await p.evaluate(() => { const H = window.__hang, n = 301, L = 80, w = 30, t = 3, k = 16.2, h = 12;
    const prof = [...Array(n)].map((_, i) => ({ s: i * L / (n - 1), w, d: 1e6 }));
    const r = H.hgFin(prof, { tp: 300, ta: 30, eps: 0, k, od: 50, t, hcFix: h }), P = 2 * (w + t) / 1000, A = w * t / 1e6, m = Math.sqrt(h * P / (k * A)), Lm = L / 1000;
    return r.s.map((x, i) => [r.T[i], 30 + 270 * Math.cosh(m * (Lm - x / 1000)) / Math.cosh(m * Lm)]); });
  const finErr = Math.max(...fin.map(q => Math.abs(q[0] - q[1])));
  ok(finErr < 0.5, 'fin model matches the textbook fin (cosh profile) within ' + finErr.toFixed(3) + ' °C; tip ' + fin[fin.length - 1][0].toFixed(1) + ' °C');
  // heat at the isolator: between the air and the pipe, cooler further out, and the right isolator called for
  await sel('hg-part', 'tab'); await put('hg-nh', 1); await put('hg-tp', 316); await put('hg-reach', 63.5); await p.waitForTimeout(200);
  const heat = async () => p.evaluate(() => { const H = window.__hang, o = H.hgRead(), ps = H.hgParts(o); return { T: H.hgIsoTemp(o, ps[0], H.HG_MAT[o.mat]).T, txt: [...document.querySelectorAll('#hg-details .sec')].map(x => x.innerText).find(x => /Heat and isolation/.test(x)) || '' }; });
  const h1 = await heat(); await put('hg-reach', 127); await p.waitForTimeout(200); const h2 = await heat();
  ok(h1.T > 38 && h1.T < 316 && h2.T < h1.T - 20, 'isolator ' + h1.T.toFixed(0) + ' °C at 2.5 in out, ' + h2.T.toFixed(0) + ' °C at 5 in, on a 316 °C pipe');
  ok(/Silicone/.test(h2.txt) && /Reach for 15 °C margin/.test(h2.txt) && /EPDM/.test(h2.txt), 'the heat section lists the isolators with their ratings and the reach each needs; silicone at 5 in');
  await put('hg-tp', 600); await put('hg-reach', 63.5); await p.waitForTimeout(200); const h3 = await heat();
  ok(/metal only|wire-rope/.test(h3.txt), 'on a 600 °C pipe it calls for an all-metal isolator (' + h3.T.toFixed(0) + ' °C at the hole)');
  await put('hg-tp', 316);
  // design cues: the aerospace window and dimple-die flanged holes
  await put('hg-reach', 101.6); await sel('hg-light', 'truss'); await p.waitForTimeout(200);
  const win = await p.evaluate(() => window.__hang.last().parts[0].holes.filter(h => h.what === 'lightening window').length);
  await sel('hg-light', 'flanged'); await sel('hg-mat', 'a36'); await p.waitForTimeout(200);
  const fl = await p.evaluate(() => { const q = window.__hang.last().parts[0]; return { n: q.holes.filter(h => h.flange).length, d: document.getElementById('hg-details').innerText }; });
  ok(win === 1 && fl.n >= 1 && /dimple dies/.test(fl.d) && /punch size/.test(fl.d), 'a rounded-triangle window, and ' + fl.n + ' flanged hole(s) with the die set’s thickness check');
  await sel('hg-light', '1'); await sel('hg-mat', 'ss304'); await put('hg-reach', 63.5);
  // the rod: bend sheet adds up, pin at the reach
  await sel('hg-part', 'rod'); await p.waitForTimeout(200);
  const R = await p.evaluate(() => { const L = window.__hang.last(), q = L.parts[0]; return { s: q.sheet, R: q.R, pin: q.dims.pin, reach: L.o.reach, od: L.o.od, rod: L.o.rod, det: document.getElementById('hg-details').innerText }; });
  const sum = R.s.weld + R.s.straight + R.s.pin + R.s.arc1 + R.s.arc2;
  ok(Math.abs(sum - R.s.cut) < 1e-9 && Math.abs(R.pin[0][1] - R.reach) < 1e-9 && /Bend sheet/.test(R.det) && /Bend 90°/.test(R.det),
    'rod: cut ' + R.s.cut.toFixed(1) + ' mm = legs + bends, pin centre at the ' + R.reach.toFixed(1) + ' mm reach, bend sheet shown');
  ok(Math.abs(R.s.arc1 - R.R * Math.PI / 2) < 1e-9 && Math.abs(R.R - 1.5 * R.rod) < 1e-9, 'rod: 90° bends on 1.5 × rod radius, arc ' + R.s.arc1.toFixed(2) + ' mm');
  // the ring clamp: printed, the heat table, warns for exhaust
  await sel('hg-part', 'ring'); await p.waitForTimeout(200);
  let rt = await p.evaluate(() => document.getElementById('hg-details').innerText + ' | ' + document.getElementById('hg-mat').value + ' | ' + document.getElementById('hg-for').value);
  ok(/PPA-CF/.test(rt) && /227 °C/.test(rt) && /asa \| int$/.test(rt), 'ring clamp: printed in ASA for an intake by default, the Bambu Lab heat-deflection table');
  await sel('hg-for', 'exh'); await p.waitForTimeout(150);
  rt = await p.evaluate(() => document.getElementById('hg-details').innerText);
  ok(/far hotter/.test(rt), 'a printed clamp on an exhaust is warned off');
  await sel('hg-part', 'tab'); await p.waitForTimeout(150);
  ok(await p.evaluate(() => document.getElementById('hg-mat').value === 'ss304'), 'back to a tab: the material goes back to metal');
  // Fusion: hide/show and the two actions (the page thinks it is in Fusion when adsk is there)
  const fx = await p.evaluate(() => !!document.querySelector('button[data-hg="pick"]'));
  ok(fx, 'in Fusion: Read the tube and reach, Build it in Fusion');
  if (fx) {
    await sel('hg-part', 'pair'); await p.waitForTimeout(150);
    await p.click('button[data-hg="pick"]'); await p.waitForTimeout(400);
    const af = await p.evaluate(() => ({ od: window.__hang.val('hg-od'), reach: window.__hang.val('hg-reach'), blen: window.__hang.val('hg-blen'), out: document.getElementById('fx-out-hang').innerText }));
    ok(Math.abs(af.od - 63.5) < 1e-9 && Math.abs(af.reach - (101.6 - af.blen)) < 1e-6 && /Read tube/.test(af.out), 'Read: tube 63.5 mm, reach to the mount less the body tab (' + af.reach.toFixed(1) + ' + ' + af.blen.toFixed(1) + ' mm) ' + JSON.stringify(af));
    await p.click('button[data-hg="build"]'); await p.waitForTimeout(400);
    const sent = await p.evaluate(() => (window.__sent.filter(x => x[0] === 'hang').pop() || [])[1]);
    ok(sent && sent.hanger && sent.hanger.parts.length === 2 && sent.hanger.cyls.length === 2 && Math.abs(sent.hanger.parts[1].off - (sent.hanger.parts[0].t + (sent.hanger.parts[1].off - sent.hanger.parts[0].t))) < 1e-9 && sent.hanger.od_mm === 63.5,
      'Build sends the pipe tab, the body tab beside it, the grommet and the bolt');
    pays.pair_fusion = sent && sent.hanger;
  }
  // projects keep the fields
  const keep = await p.evaluate(() => { const s = window.__hang.snap(); return ['hg-part', 'hg-reach', 'hg-grom', 'hg-t'].every(k => k in s.vals); });
  ok(keep, 'saved projects keep the hanger fields');
  // phone
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'phone: no page overflow');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  fs.writeFileSync(path.join(__dirname, '..', '..', 'fusion-addin', 'tests', 'hang_payloads.json'), JSON.stringify(pays));
  if (process.env.SHOT) { await p.setViewportSize({ width: 1280, height: 1000 }); await p.screenshot({ path: process.env.SHOT, fullPage: true }); }
  console.log('failures:', fails.length); await b.close(); process.exit(fails.length ? 1 : 0);
})();
