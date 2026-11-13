// Your compressor map (Intake tab, turbo sizing; 2026-11-13): the user's own map image, calibrated by hand, with the
// build's demand drawn on it.   node tests/compmap_ui.js   (from web/)
//
// The map image here is this test's own drawing (a grid on a canvas, no maker's artwork), written to a temporary PNG and
// given to the page through its file input, as a user would. 800 x 600 px; the axes as drawn:
//   flow: x = 80 px is 0 lb/min, x = 760 px is 80 lb/min  -> flow = (x - 80) x 80 / 680 = (x - 80) / 8.5 lb/min
//   pressure ratio: y = 540 px is 1.0, y = 60 px is 4.0     -> PR = 1 + (540 - y) x 3 / 480 = 1 + (540 - y) / 160
// So the image pixel (250, 300) is (250 - 80) / 8.5 = 20.0 lb/min at 1 + 240 / 160 = 2.5.
//
// The build is the tab's default turbo build, whose route turbosize_ui pins by independent hand arithmetic at 5600 RPM:
//   m = 0.4331842 kg/s per compressor, compressor inlet P1 = 100109.566 Pa, compressor pressure ratio PRc = 1.7079740,
//   inlet air T1 = 30 °C = 303.15 K.
// Corrected flow at a reference (ATP Turbo's definition, the one corrFlow cites, reference left to the map):
//   Wc = m sqrt(T1 / Tref) / (P1 / Pref).
//   Garrett's reference by ATP Turbo's definition, sqrt((T + 460) / 545) with T in °F: 85 °F, in absolute temperature
//   85 + 459.67 = 544.67 °R = 302.59444 K (boost audit part 3, 2026-11-13: the "Garrett" fill was 545 °R = 302.77778 K,
//   which is 85.33 °F and put the map 0.03% off ATP's own form), 13.95 psia = 13.95 x 6894.757 = 96181.860 Pa:
//   Wc = 0.4331842 x sqrt(303.15 / 302.59444) / (100109.566 / 96181.860) = 0.4165705 kg/s = 55.10285 lb/min
//   (ATP's literal form, °F + 460 over 545, gives 0.4165703: 5.5e-7 apart, the 459.67 / 460 rounding only; the old
//   545 °R fill gave 0.4164444 / 55.08616 lb/min).
//   On the image: x = 80 + 55.10285 x 8.5 = 548.374 px, y = 540 - 0.7079740 x 160 = 426.724 px.
//   Another reference, 298 K and 100 kPa: Wc' = 0.4331842 x sqrt(303.15 / 298) / (100109.566 / 100000) = 0.4364331 kg/s
//   = 57.73022 lb/min; Wc' / Wc = sqrt(302.59444 / 298) x 100000 / 96181.860 = 1.0476812. As cfm at that reference:
//   rho_ref = 100000 / (287.05 x 298) = 1.1690314 kg/m³, 0.4364331 / 1.1690314 x 2118.880 = 791.039 cfm.
// The full-boost point (3500 RPM, the tab's default): m = 5.7355e-3 m³ x 3500 / 120 x 0.90 x 1.544367 x 1.164398 kg/m³
//   = 0.2707401 kg/s (the throttle's PR (101325 + 55158) / 101325 = 1.544367, inlet density 101325 / (287.05 x 303.15));
//   its P1 and PR are the route solver's at that flow, read from the page and put through the formula above.
// Garrett's method for 450 hp: Wa = 450 x 12 x 0.55 / 60 = 49.5 lb/min = 0.3742137 kg/s, corrected at the peak point's P1.
// Margins against a surge line typed as pixels (200, 540), (300, 300), (400, 60) -> (14.1176, 1.0), (25.8824, 2.5),
//   (37.6471, 4.0) lb/min, and a choke line (700, 540), (720, 60) -> (72.9412, 1.0), (75.2941, 4.0):
//   surge flow at a PR between 1 and 2.5: s = 14.1176 + (PR - 1) / 1.5 x 11.7647; margin (x - s) / s;
//   choke flow c = 72.9412 + (PR - 1) / 3 x 2.3529; margin (c - x) / c.
// Typed island efficiency 76% at 5600 RPM: compOut = 303.15 x (1 + (1.7079740^(0.4/1.4) - 1) / 0.76) - 273.15 = 95.9196 °C,
//   against 101.5698 °C at the tab's 70%: 5.6502 °C (10.17 °F) cooler.
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const { reads, settle } = require('./settle');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, want, tol, m) => ok(Number.isFinite(a) && Math.abs(a - want) <= tol, m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(8) : a) + ', hand ' + (+want.toPrecision(8)));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compmap-')), png = path.join(tmp, 'synthetic_map.png'), pdf = path.join(tmp, 'map.pdf');
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const pg = reads(await ctx.newPage()); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  // the synthetic map, drawn on a blank page's canvas
  await pg.setContent('<canvas id="c" width="800" height="600"></canvas>');
  const dataUrl = await pg.evaluate(() => { const c = document.getElementById('c'), g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 800, 600); g.strokeStyle = '#999'; g.lineWidth = 1; g.font = '12px sans-serif'; g.fillStyle = '#000';
    for (let f = 0; f <= 80; f += 10) { const x = 80 + f * 8.5; g.beginPath(); g.moveTo(x, 60); g.lineTo(x, 540); g.stroke(); g.fillText(String(f), x - 6, 556); }
    for (let p = 1; p <= 4.001; p += 0.5) { const y = 540 - (p - 1) * 160; g.beginPath(); g.moveTo(80, y); g.lineTo(760, y); g.stroke(); g.fillText(p.toFixed(1), 50, y + 4); }
    g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(80, 60, 680, 480); g.fillText('test grid, lb/min against pressure ratio (not a real compressor)', 120, 40);
    return c.toDataURL('image/png'); });
  fs.writeFileSync(png, Buffer.from(dataUrl.split(',')[1], 'base64')); fs.writeFileSync(pdf, '%PDF-1.4\n%test\n');
  const open = async P => { await P.goto('file://' + process.cwd() + '/index.html#intake'); await P.waitForTimeout(900);
    await P.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); const el = document.getElementById('i-ind'); el.value = 'turbo'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle(P); };
  await open(pg);
  const chg = (sel, v, P) => (P || pg).evaluate(([s, v]) => { const el = document.querySelector(s); if (!el) throw new Error('no ' + s); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]).then(() => settle(P || pg));
  const setv = (id, v, P) => (P || pg).evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }, [id, v]).then(() => settle(P || pg));
  const C = (P) => (P || pg).evaluate(() => { const D = window.__cmap.compute(); return D && !D.err ? JSON.parse(JSON.stringify({ A: D.lineA, B: D.lineB, G: D.G, sm: D.sm, cm: D.cm, ref: D.ref })) : null; });
  const secText = () => pg.$eval('#i-details .sec[data-sec="your-compressor-map"]', e => e.innerText).catch(() => '');

  // the block, the instructions and the privacy line
  let t = await secText();
  ok(/1\. Load the map image\s+2\. Click two points on each axis and type their values\s+3\. Read your engine’s line/.test(t), 'plain three-step instructions');
  ok(/stays on this computer/.test(t) && /not uploaded, not added to the project file/.test(t) && /PDF is not read here/.test(t) && /screenshot/.test(t), 'says the image never leaves the browser, and to screenshot a PDF');
  ok(/total-to-total/.test(t), 'states the pressure ratio is total-to-total');
  ok(await pg.$eval('#cm-refneed', e => /needed/.test(e.textContent)).catch(() => false), 'reference conditions required before any are typed');
  ok(await pg.evaluate(() => !document.querySelector('#cm-svg')), 'no drawing before an image');
  ok(/example only/i.test(await pg.$eval('#b5-example', e => e.textContent).catch(() => '')), 'the TO4B map is labelled an example');

  // a PDF is refused with the screenshot advice
  await pg.setInputFiles('#cm-file', pdf); await pg.waitForTimeout(300); await settle(pg);
  ok(/PDF is not read here/.test(await pg.$eval('#cm-msg', e => e.textContent).catch(() => '')), 'a PDF is refused: take a screenshot');

  // load the synthetic map
  await pg.setInputFiles('#cm-file', png);
  await pg.waitForFunction(() => window.__cmap.img() && document.querySelector('#cm-svg image'), null, { timeout: 5000 }).catch(() => {}); await settle(pg);
  const im = await pg.evaluate(() => { const I = window.__cmap.img(); return I ? { w: I.w, h: I.h, url: I.url.slice(0, 5), stored: I.stored, data: I.data.slice(0, 22) } : null; });
  ok(im && im.w === 800 && im.h === 600 && im.url === 'blob:' && im.data === 'data:image/png;base64,', 'image read by FileReader (data URL), drawn from a blob URL at its natural 800 × 600: ' + JSON.stringify(im));
  ok(im && im.stored, 'a small image is kept in this browser (try/catch storage)');

  // Garrett's reference by the maker select
  await chg('select.cmx[data-k="maker"]', 'garrett');
  let rf = await pg.evaluate(() => window.__cmap.ref());
  near(rf && rf.T, (85 + 459.67) / 1.8, 1e-9, 'Garrett reference temperature 85 °F (ATP Turbo) in K'); near(rf && rf.P, 13.95 * 6894.757, 1e-6, 'Garrett reference 13.95 psia in Pa');

  // calibrate by clicking: the client position -> image pixel at this size
  // a real click lands on a whole screen pixel (Chrome's clientX / clientY are integers), so the test clicks the screen
  // pixel nearest the image point and works out by hand which image pixel that is: (client - box edge) / box size x 800
  const clickImg = async (P, ix, iy) => {
    const rect = () => P.evaluate(() => { const s = document.querySelector('#cm-svg').getBoundingClientRect(); return { l: s.left, t: s.top, w: s.width, h: s.height, vh: innerHeight }; });
    let r = await rect(); await P.evaluate(dy => window.scrollBy(0, dy), Math.round(r.t + iy / 600 * r.h - r.vh / 2)); r = await rect();
    const cx = Math.round(r.l + ix / 800 * r.w), cy = Math.round(r.t + iy / 600 * r.h);
    await P.mouse.click(cx, cy); await settle(P); r.ex = (cx - r.l) / r.w * 800; r.ey = (cy - r.t) / r.h * 600; return r; };
  await pg.click('[data-cmtool="cal-xa"]'); await settle(pg);
  const k1 = await clickImg(pg, 80, 540), k2 = await clickImg(pg, 760, 540), k3 = await clickImg(pg, 80, 540), k4 = await clickImg(pg, 80, 60), r1 = k1;
  let cal = await pg.evaluate(() => JSON.parse(JSON.stringify(window.__cmap.state.cal)));
  const one = 800 / r1.w + 0.01;   // one screen pixel in image pixels
  ok([[cal.xa.p, k1.ex], [cal.xb.p, k2.ex], [cal.ya.p, k3.ey], [cal.yb.p, k4.ey]].every(([a, e]) => Math.abs(+a - e) <= 0.006),
    'four clicks at ' + Math.round(r1.w) + ' px wide recorded as (client − edge) ÷ width × 800 by hand: ' + [cal.xa.p, cal.xb.p, cal.ya.p, cal.yb.p].join(', ') + ' against ' + [k1.ex, k2.ex, k3.ey, k4.ey].map(x => x.toFixed(2)).join(', '));
  ok(Math.abs(+cal.xa.p - 80) <= one && Math.abs(+cal.xb.p - 760) <= one && Math.abs(+cal.ya.p - 540) <= one && Math.abs(+cal.yb.p - 60) <= one, 'and within one screen pixel (' + one.toFixed(3) + ' image px) of 80, 760, 540, 60');
  ok(await pg.evaluate(() => window.__cmap.state.tool === ''), 'the clicking stops after the fourth calibration point');
  // the values, typed; then the exact pixels by the keyboard path
  for (const [k, v] of [['cal.xa.v', '0'], ['cal.xb.v', '80'], ['cal.ya.v', '1'], ['cal.yb.v', '4'], ['cal.xa.p', '80'], ['cal.xb.p', '760'], ['cal.ya.p', '540'], ['cal.yb.p', '60']]) await chg('input.cmx[data-k="' + k + '"]', v);
  const map = await pg.evaluate(() => { const c = window.__cmap.cal(); return c.miss ? null : { f420: c.fx(420), f250: c.fx(250), y300: c.fy(300), y60: c.fy(60), g40: c.gx(40), gpr: c.gy(2.5) }; });
  ok(map, 'calibrated');
  if (map) { near(map.f420, 40, 1e-9, 'x 420 px -> (420 - 80) / 8.5 = 40 lb/min'); near(map.f250, 20, 1e-9, 'x 250 px -> 20 lb/min'); near(map.y300, 2.5, 1e-9, 'y 300 px -> 1 + 240 / 160 = 2.5');
    near(map.y60, 4, 1e-9, 'y 60 px -> 4.0'); near(map.g40, 420, 1e-9, '40 lb/min -> 420 px'); near(map.gpr, 300, 1e-9, 'PR 2.5 -> 300 px'); }
  ok(/Calibrated\./.test(await pg.$eval('#cm-calstate', e => e.textContent)), 'says calibrated, with the mapping');
  ok(await pg.evaluate(() => document.querySelectorAll('#cm-svg .cm-grid line').length >= 10), 'the calibrated grid is drawn over the image');

  // the demand at Garrett's reference
  let d = await C();
  const pk = d && d.A.find(o => o.rpm === 5600), lo = d && d.A[0], rd = d && d.A[d.A.length - 1];
  ok(d && d.A.map(o => o.rpm).join(',') === '3500,4000,5000,5600,6500', 'line from full boost 3500 through peak 5600 to redline 6500 RPM: ' + (d && d.A.map(o => o.rpm).join(',')));
  near(pk && pk.m, 0.4331842, 2e-7, 'peak point air per compressor (turbosize_ui hand value)');
  near(pk && pk.P1, 100109.566, 2e-3, 'peak point compressor inlet pressure P1');
  near(pk && pk.PR, 1.7079740, 2e-7, 'peak point compressor pressure ratio, inlet and charge-side losses in');
  near(pk && pk.Wc, 0.4165705, 3e-7, 'peak corrected flow at 85 °F / 13.95 psia: m √(T1/Tref) ÷ (P1/Pref)');
  near(pk && pk.x, 55.10285, 3e-5, 'peak point on the lb/min axis');
  near(pk && pk.Wc, await pg.evaluate(() => window.__turbo.corrFlow(0.43318420652130163, 30, 100109.56592394777)), 2e-7, 'the same as the sizing table’s corrFlow (one definition, absolute temperature)');
  near(lo && lo.m, 0.2707401, 2e-7, 'full-boost point air: swept volume × RPM/120 × VE × throttle PR × inlet density');
  near(lo && lo.Wc, lo ? lo.m * Math.sqrt(303.15 / ((85 + 459.67) / 1.8)) / (lo.P1 / (13.95 * 6894.757)) : NaN, 1e-12, 'full-boost corrected flow by the definition at its own P1');
  ok(lo && lo.PR > 1.544367 && lo.PR < pk.PR, 'full-boost PR above the throttle ratio 1.544367 (losses in) and below peak’s (smaller flow, smaller losses): ' + (lo && lo.PR.toFixed(5)));
  ok(rd && rd.rpm === 6500 && rd.m > pk.m, 'redline point at the same VE and boost, more flow');
  const circ = () => pg.evaluate(() => { const c = document.querySelector('#cm-svg circle[data-cmpt="A5600"]'); return c ? [+c.getAttribute('cx'), +c.getAttribute('cy')] : null; });
  let c0 = await circ();
  near(c0 && c0[0], 548.374, 0.006, 'peak point drawn at image x 80 + 55.10285 × 8.5'); near(c0 && c0[1], 426.724, 0.006, 'peak point drawn at image y 540 − 0.707974 × 160');
  t = await secText();
  ok(/5,600 RPM \(peak power\)/.test(t) && /3,500 RPM \(full boost\)/.test(t) && /6,500 RPM \(redline\)/.test(t), 'points labelled with RPM in the table');
  ok(/lb\/min \(0\.\d{4} kg\/s\)/.test(t), 'flows in lb/min and kg/s');
  ok(/Not modelled:/.test(t) && /part throttle and the boost threshold/.test(t), 'says the part-throttle and boost-threshold region is not modelled');
  ok(/Conversion at peak power/.test(t) && /0\.41657 kg\/s/.test(t), 'shows the conversion with numbers');
  ok(await pg.evaluate(() => /5,600/.test([...document.querySelectorAll('#cm-svg text')].map(x => x.textContent).join(' '))), 'points labelled with RPM on the drawing');

  // another reference moves the points as computed by hand
  await chg('input.cmx[data-k="refT"]', '298'); await chg('select.cmx[data-k="refTu"]', 'K'); await chg('input.cmx[data-k="refP"]', '100'); await chg('select.cmx[data-k="refPu"]', 'kPa');
  d = await C(); const pk2 = d && d.A.find(o => o.rpm === 5600);
  near(pk2 && pk2.Wc, 0.4364331, 3e-7, 'peak corrected flow at 298 K / 100 kPa'); near(pk2 && pk2.Wc / pk.Wc, 1.0476812, 1e-6, 'ratio to Garrett’s reference √(302.594/298) × 100/96.18186');
  let c1 = await circ(); near(c1 && c1[0], 80 + 57.73022 * 8.5, 0.006, 'the point moves to x 80 + 57.73022 × 8.5'); near(c1 && c1[1], 426.724, 0.006, 'and keeps its pressure ratio');
  await chg('select.cmx[data-k="xu"]', 'cfm');
  d = await C(); near(d && d.A.find(o => o.rpm === 5600).x, 791.039, 0.002, 'cfm axis: corrected volume at the reference density, Wc ÷ ρref × 2118.88');
  await chg('select.cmx[data-k="xu"]', 'lbmin'); await chg('select.cmx[data-k="maker"]', 'garrett');
  d = await C(); near(d && d.A.find(o => o.rpm === 5600).Wc, 0.4165705, 3e-7, 'back to Garrett’s reference');

  // Garrett's point for 450 hp
  await setv('i-hp', '450');
  d = await C(); const G = d && d.G;
  near(G && G.m, 0.3742137, 2e-7, 'Garrett 450 hp: 450 × 12 × 0.55 ÷ 60 = 49.5 lb/min');
  near(G && G.Wc, G ? 0.3742137 * Math.sqrt(303.15 / ((85 + 459.67) / 1.8)) / (pk.P1 / (13.95 * 6894.757)) : NaN, 1e-7, 'Garrett’s point corrected at the peak point’s P1');
  ok(await pg.evaluate(() => !!document.querySelector('#cm-svg path[data-cmpt="G"]')), 'Garrett’s point drawn');

  // surge and choke lines typed as pixel pairs (the keyboard path), margins by hand
  await pg.evaluate(() => { const d = document.querySelector('details.cm-lines'); if (d) d.open = true; });
  await chg('textarea.cmx[data-k="surge"]', '200, 540\n300, 300\n400, 60');
  await chg('textarea.cmx[data-k="choke"]', '700, 540\n720, 60');
  d = await C(); const L0 = d.A[0], P0 = d.A.find(o => o.rpm === 5600);
  const sH = 120 / 8.5 + (L0.PR - 1) / 1.5 * (100 / 8.5), cH = 620 / 8.5 + (P0.PR - 1) / 3 * (20 / 8.5);
  near(d.sm, (L0.x - sH) / sH, 1e-9, 'surge margin at 3500 RPM = (demand − surge) ÷ surge at its PR ' + L0.PR.toFixed(4));
  near(d.cm, (cH - P0.x) / cH, 1e-9, 'choke margin at peak = (choke − demand) ÷ choke at PR ' + P0.PR.toFixed(4));
  t = await secText();
  ok(t.includes((d.sm * 100).toFixed(1) + '%') && t.includes((d.cm * 100).toFixed(1) + '%') && /\(demand flow − surge flow at the same pressure ratio\) ÷ surge flow/.test(t), 'margins on the page with their definitions');
  const steps = await pg.$eval('#tg-steps li[data-step="turbo"]', e => e.innerText);
  ok(steps.includes('demand plotted on your map: surge margin ' + (d.sm * 100).toFixed(1) + ' %, choke margin ' + (d.cm * 100).toFixed(1) + ' %'), 'checklist “Pick a turbo” shows the margins: ' + steps.replace(/\s+/g, ' ').slice(-90));

  // typed island efficiency
  await chg('input.cmx[data-k="eta.A5600"]', '76');
  d = await C(); const P76 = d.A.find(o => o.rpm === 5600);
  near(P76.t2U, 303.15 * (1 + (Math.pow(P76.PR, 0.4 / 1.4) - 1) / 0.76) - 273.15, 1e-9, 'outlet at 76% by compOut at the plotted PR');
  near(P76.t2U, 95.91957, 2e-4, 'outlet at 76% (hand, PR 1.707974)'); near(P76.t2 - P76.t2U, 5.65025, 2e-4, '5.65 °C cooler than at the tab’s 70%');
  ok(d.A.filter(o => o.t2U != null).length === 1, 'only the point typed uses a typed efficiency');
  t = await secText(); ok(/−5\.7 °C \(−10\.2 °F\)/.test(t), 'difference shown in °C and °F');

  // the second case
  await chg('input.cmx[data-k="caseB"]', '12');
  d = await C(); const B5 = d.B.find(o => o.rpm === 5600);
  ok(d.B.length === d.A.length && B5 && B5.PR > P0.PR && B5.m > P0.m, 'case B at 12 psi: a second line, higher ratio and flow: PR ' + (B5 && B5.PR.toFixed(4)));
  near(d && await pg.evaluate(() => +window.__cmap.state.caseB), 12 * 6.894757, 1e-9, 'case B kept in kPa');

  // the build sheet: numbers, image only when ticked
  let sh = await pg.evaluate(() => { const s = window.__tg.sheet(); return { nums: s.nums.map(x => x.join(': ')).join('\n'), map: s.mapSvg.length }; });
  ok(/On your map: 5,600 RPM: .*pressure ratio 1\.708, surge margin/.test(sh.nums) && /Surge margin at full boost \/ choke margin at peak/.test(sh.nums), 'build sheet carries the map numbers');
  ok(sh.map === 0, 'no image on the build sheet by default');
  ok(/may be the maker’s copyright/.test(t), 'the opt-in says the image may be the maker’s copyright');
  await chg('#cm-embed', true);
  sh = await pg.evaluate(() => { const s = window.__tg.sheet(), doc = window.__tg.doc(), x = new DOMParser().parseFromString(doc, 'application/xhtml+xml'); return { img: /<image href="data:image\/png;base64,/.test(s.mapSvg), xml: !x.querySelector('parsererror'), h2: /<h2>Your compressor map<\/h2>/.test(doc) }; });
  ok(sh.img && sh.h2 && sh.xml, 'ticked: the user’s image and line go into their sheet, which stays well-formed XHTML');
  await chg('#cm-embed', false);

  // two display sizes: a click at image pixel (250, 300) is 20 lb/min at PR 2.5 both ways
  const clickSurge = async (P, label) => { await P.evaluate(() => { const d = document.querySelector('details.cm-lines'); if (d) d.open = true; }); await P.click('[data-cmtool="surge"]'); await settle(P);
    const r = await clickImg(P, 250, 300); const q = await P.evaluate(() => { const s = window.__cmap.state.surge, c = window.__cmap.cal(); const a = s[s.length - 1]; return { px: a, v: [c.fx(a[0]), c.fy(a[1])] }; });
    const tl = 800 / r.w + 0.01;
    ok(Math.abs(q.px[0] - r.ex) <= 0.006 && Math.abs(q.px[1] - r.ey) <= 0.006, label + ': the click is recorded at image pixel (' + q.px.join(', ') + '), by hand (' + r.ex.toFixed(2) + ', ' + r.ey.toFixed(2) + ')');
    ok(Math.abs(q.px[0] - 250) <= tl && Math.abs(q.px[1] - 300) <= tl, label + ': within one screen pixel (' + tl.toFixed(3) + ' image px) of (250, 300)');
    near(q.v[0], (r.ex - 80) / 8.5, 0.006 / 8.5, label + ': it reads (x − 80) ÷ 8.5 lb/min (20 at 250)'); near(q.v[1], 1 + (540 - r.ey) / 160, 0.006 / 160, label + ': and PR 1 + (540 − y) ÷ 160 (2.5 at 300)');
    await P.click('[data-cmtool="surge"]'); await settle(P); return r; };
  const rA = await clickSurge(pg, 'at ' + Math.round(r1.w) + ' px');
  await pg.setViewportSize({ width: 400, height: 860 }); await pg.waitForTimeout(300); await settle(pg);
  const rB = await clickSurge(pg, 'at 400 px viewport');
  ok(rB.w < rA.w * 0.6, 'the map scales to the width: ' + Math.round(rA.w) + ' -> ' + Math.round(rB.w) + ' px');
  const sw = await pg.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
  ok(sw.s <= sw.c + 1, 'no horizontal page scroll at 400 px: ' + sw.s + ' / ' + sw.c);
  await pg.setViewportSize({ width: 1280, height: 900 }); await settle(pg);
  await chg('textarea.cmx[data-k="surge"]', '200, 540\n300, 300\n400, 60');

  // persistence: the project keeps calibration, points and typed values, not the image
  const snap = await pg.evaluate(() => window.__proj.snapshot('map test'));
  const js = JSON.stringify(snap);
  ok(snap.ui && snap.ui.cmap && snap.ui.cmap.cal.xb.p === '760' && snap.ui.cmap.surge.length === 3 && snap.ui.cmap.eta.A5600 === '76' && snap.ui.cmap.refT === '85' && snap.ui.cmap.refTu === 'F', 'project snapshot holds the calibration, points and typed values');
  ok(!/data:image/.test(js) && !/blob:/.test(js) && js.length < 400000, 'and no image (' + js.length + ' characters)');
  const before = await C(); const cx0 = await circ();
  // a fresh browser profile: no stored image
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }); const pg2 = reads(await ctx2.newPage()); const errs2 = []; pg2.on('pageerror', e => errs2.push(e.message));
  await open(pg2);
  await pg2.evaluate(s => window.__proj.apply(s), snap); await settle(pg2);
  const after = await C(pg2);
  ok(await pg2.evaluate(() => window.__cmap.img() === null), 'loaded without the image (new browser profile)');
  ok(await pg2.evaluate(() => !!document.querySelector('#cm-svg') && !document.querySelector('#cm-svg image') && /Map image not loaded/.test(document.querySelector('#cm-svg').textContent)), 'the demand is drawn on blank calibrated axes, with a note');
  ok(/The map image is not loaded/.test(await pg2.$eval('#cm-imgline', e => e.textContent)), 'asks for the image again');
  ok(after && Math.abs(after.sm - before.sm) < 1e-12 && Math.abs(after.cm - before.cm) < 1e-12 && after.A.find(o => o.rpm === 5600).t2U === before.A.find(o => o.rpm === 5600).t2U && after.B.length === before.B.length, 'margins, typed efficiency and case B the same after the round trip');
  const cx2 = await pg2.evaluate(() => { const c = document.querySelector('#cm-svg circle[data-cmpt="A5600"]'); return c ? [+c.getAttribute('cx'), +c.getAttribute('cy')] : null; });
  ok(cx2 && cx0 && Math.abs(cx2[0] - cx0[0]) < 1e-9 && Math.abs(cx2[1] - cx0[1]) < 1e-9, 'the point sits at the same place on the blank axes');
  await pg2.setViewportSize({ width: 420, height: 860 }); await pg2.waitForTimeout(300); await settle(pg2);
  await clickSurge(pg2, 'at 420 px, device pixel ratio 2, blank axes');
  ok(!errs2.length, 'no page errors in the reloaded profile' + (errs2.length ? ': ' + errs2.join(' | ') : ''));
  await ctx2.close();
  // the same profile after a reload: the small image comes back from this browser's storage with the project
  await open(pg); await pg.evaluate(s => window.__proj.apply(s), snap); await settle(pg);
  ok(await pg.evaluate(() => { const I = window.__cmap.img(); return !!(I && I.sig === window.__cmap.state.imgSig && document.querySelector('#cm-svg image')); }), 'same browser after a reload: the stored small image comes back with the project');
  await pg.click('[data-cmact="forget"]'); await settle(pg);
  ok(await pg.evaluate(k => { try { return localStorage.getItem(k) === null; } catch (e) { return false; } }, await pg.evaluate(() => window.__cmap.KEY)), '“Forget it” removes the stored image');
  // storage that throws must not break the page
  await pg.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('quota'); }; Storage.prototype.getItem = function () { throw new Error('denied'); }; });
  await pg.setInputFiles('#cm-file', png); await pg.waitForTimeout(400); await settle(pg);
  ok(await pg.evaluate(() => { const I = window.__cmap.img(); return !!(I && !I.stored && document.querySelector('#cm-svg image')); }), 'with storage throwing, the image still loads (not kept)');
  // a saved project from before this block loads cleanly and clears the map
  const old = JSON.parse(js); delete old.ui.cmap;
  await pg.evaluate(s => window.__proj.apply(s), old); await settle(pg);
  ok(await pg.evaluate(() => window.__cmap.state.imgW === 0 && window.__cmap.img() === null && !document.querySelector('#cm-svg')), 'a project without a map clears it');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
  await b.close();
  console.log(fails.length ? 'compmap_ui: ' + fails.length + ' FAILED' : 'compmap_ui: all pass');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
