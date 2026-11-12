// Pie-cut (lobster-back) bend calculator on the Headers tab, the true-scale wrap-around templates (pie cut and cope:
// scale bars, quarter and flank marks, SVG and DXF saved through the page's save path) and the inch-fraction setting.
// Every expected value is worked by hand below from the geometry, not read off the page.   node tests/piecut_ui.js  (from web/)
//
// Case 1, ends square (the usual lobster back): 3 in OD (76.2 mm, r = 38.1), 4.5 in CLR (R = 114.3 mm), 90 deg in 5 pieces:
//   2 half pieces + 3 full, n = 4 welds, each turning 90 / 4 = 22.5 deg, cut a = 11.25 deg from square;
//   tan 11.25 = 0.198912367, cos 11.25 = 0.980785280.
//   full piece: centre 2 R tan a = 2 x 114.3 x 0.198912367 = 45.471367 mm; inside (throat) 2 (R - r) tan a = 2 x 76.2 x
//   0.198912367 = 30.314245; outside (back) 2 (R + r) tan a = 2 x 152.4 x 0.198912367 = 60.628490. Half piece: half of each,
//   22.735684 / 15.157122 / 30.314245.
//   template height (OD/2) tan a = 38.1 x 0.198912367 = 7.578561 mm each side of the mark; strip pi x 76.2 = 239.389 mm.
//   weld: ellipse, semi-axes A = 38.1 / 0.980785280 = 38.846423, B = 38.1; Gauss-Kummer series (independent of the page's
//   integral) h = ((A - B)/(A + B))^2 = 9.410080e-5, P = pi (A + B)(1 + h/4 + h^2/64 + ...) = 241.740004 mm; 4 welds 966.960018.
//   stock, one stick, kerf 1/16 in = 1.5875 mm (k / cos a = 1.618601 along the tube): 2 n R tan a + n k / cos a
//   = 8 x 114.3 x 0.198912367 + 4 x 1.618601 = 181.885468 + 6.474405 = 188.359873 mm.
//   cut marks (centre line): x1 = R tan a = 22.735684; x2 = x1 + 1.618601 + 45.471367 = 69.825652; x3 = 116.915620;
//   x4 = 164.005588; end 164.005588 + 1.618601 + 22.735684 = 188.359873. Line A = x + s r tan a, s = +1, -1, +1, -1:
//   cut 1 on A 30.314245, on B 15.157122; cut 2 on A 69.825652 - 7.578561 = 62.247091, on B 77.404213.
//   radii: inside R - r = 76.2 at a piece's middle, 76.2 / cos a = 77.692846 at a weld; outside 152.4 and 155.385693.
//   pressure loss, Hooper 2-K (python-fluids Hooper2K), ID = 76.2 - 2 x 1.651 = 72.898 mm = 2.87 in, 1 + 1/2.87 = 1.348432:
//   4 welds 0.27 x 1.348432 = 0.364077; long radius 0.20 x 1.348432 = 0.269686; ratio 1.35.
// Case 2, every piece the same (pie-cut kit): same tube, 90 deg in 5 pieces: each turns 18 deg, cut 9 deg; welds 4 + 2 = 6;
//   sin 9 = 0.156434465, cos 9 = 0.987688341, tan 9 = 0.158384440; middle R cos a = 112.892777;
//   centre 2 R sin a = 35.760919; inside 2 (112.892777 - 38.1) tan a = 23.692024; outside 2 (112.892777 + 38.1) tan a = 47.829813;
//   stock 2 r tan a + 5 x 35.760919 + 6 x 1.5875 / cos a = 12.068894 + 178.804594 + 9.643728 = 200.517216;
//   the square tube meets the piece's ellipse: OD (1 / cos a - 1) = 0.949843 mm across the bend.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const near = (a, w, tol, m) => ok(Number.isFinite(a) && Math.abs(a - w) <= tol, m + ': page ' + (+(+a).toFixed(6)) + ', by hand ' + w);
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { window.__sent = []; if (window.__fusionStub) return; });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#headers'); await pg.waitForTimeout(900);
  const P = await pg.evaluate(() => window.__pie.pieCut({ od: 76.2, wall: 1.651, clr: 114.3, ang: 90, n: 5, kerf: 1.5875, ends: 'square' }));
  near(P.alpha, 11.25, 1e-12, 'square ends, 5 pieces: cut angle'); ok(P.nW === 4 && P.nFull === 3, '4 welds, 3 full pieces and 2 half');
  near(P.full.c, 45.471367, 1e-5, 'full piece, centre line, mm'); near(P.full.i, 30.314245, 1e-5, 'full piece, inside (throat) 2 (CLR - OD/2) tan(cut)');
  near(P.full.o, 60.628490, 1e-5, 'full piece, outside (back) 2 (CLR + OD/2) tan(cut)');
  near(P.half.c, 22.735684, 1e-5, 'half piece, centre line'); near(P.half.i, 15.157122, 1e-5, 'half piece, inside'); near(P.half.o, 30.314245, 1e-5, 'half piece, outside');
  near(P.tplH, 7.578561, 1e-5, 'template height (OD/2) tan(cut)');
  near(P.weld, 241.740004, 1e-4, 'weld per joint, exact ellipse perimeter'); near(P.weldTotal, 966.960018, 4e-4, 'weld, 4 joints');
  near(P.stock, 188.359873, 1e-5, 'stock from one stick with 1/16 in kerf');
  near(P.cuts[0].x, 22.735684, 1e-5, 'cut 1 centre-line mark'); near(P.cuts[1].x, 69.825652, 1e-5, 'cut 2 centre-line mark'); near(P.cuts[3].x, 164.005588, 1e-5, 'cut 4 mark');
  near(P.cuts[0].A, 30.314245, 1e-5, 'cut 1 on line A'); near(P.cuts[0].B, 15.157122, 1e-5, 'cut 1 on line B'); near(P.cuts[1].A, 62.247091, 1e-5, 'cut 2 on line A (alternating)'); near(P.cuts[1].B, 77.404213, 1e-5, 'cut 2 on line B');
  near(P.rad.inWeld, 77.692846, 1e-5, 'throat radius at a weld'); near(P.rad.outWeld, 155.385693, 1e-5, 'back radius at a weld');
  ok(P.hooper && Math.abs(P.hooper.K - 0.364077) < 1e-5 && Math.abs(P.hooper.lr - 0.269686) < 1e-5, 'Hooper 2-K: 4-weld mitre K 0.364077 against a long-radius bend 0.269686 (' + (P.hooper && P.hooper.K.toFixed(6)) + ', ' + (P.hooper && P.hooper.lr.toFixed(6)) + ')');
  const Q = await pg.evaluate(() => window.__pie.pieCut({ od: 76.2, wall: 1.651, clr: 114.3, ang: 90, n: 5, kerf: 1.5875, ends: 'full' }));
  near(Q.alpha, 9, 1e-12, 'every piece the same: cut 9 deg'); ok(Q.nW === 6 && Q.cuts.length === 6, '6 welds (4 between pieces, 2 to the straights), 6 cuts');
  near(Q.full.c, 35.760919, 1e-5, 'equal pieces: centre line 2 R sin(cut)'); near(Q.full.i, 23.692024, 1e-5, 'equal pieces: inside'); near(Q.full.o, 47.829813, 1e-5, 'equal pieces: outside');
  near(Q.stock, 200.517216, 1e-5, 'equal pieces: stock with the two end wedges'); near(Q.mismatch, 0.949843, 1e-5, 'equal pieces: ellipse against the square tube');
  ok(!Q.hooper, 'no pressure-loss figure for the equal-piece layout (none verified)');
  const S = await pg.evaluate(() => window.__pie.pieCut({ od: 76.2, wall: 1.651, clr: 114.3, ang: 90, seg: 30, kerf: 1.6, ends: 'square' }));
  ok(S.N === 4 && S.nW === 3 && Math.abs(S.alpha - 15) < 1e-12, 'a segment angle of 30 deg instead of a count: 3 welds, 4 pieces, cut 15 deg');
  const E1 = await pg.evaluate(() => window.__pie.pieCut({ od: 76.2, wall: 1.651, clr: 30, ang: 90, n: 5, kerf: 1.6, ends: 'square' }));
  ok(!!E1.err && /too tight/.test(E1.err), 'a CLR under half the OD is refused with a reason');
  const E2 = await pg.evaluate(() => window.__pie.pieCut({ od: 76.2, wall: 1.651, clr: 114.3, ang: 60, n: 4, kerf: 1.6, ends: 'square' }));
  ok(!E2.hooper, 'a 60 deg bend: no Hooper figure (his mitred elbows are 90 deg)');

  // the page: default inputs are case 1 with the page's 1.6 mm kerf
  const pageOut = await pg.$eval('#pc-out', e => e.innerText);
  ok(/11\.25/.test(pageOut) && /1 3\/16 in \(30\.5 mm\)/.test(pageOut) && /2 3\/8 in \(60\.5 mm\)/.test(pageOut) && /1 13\/16 in \(45\.5 mm\)/.test(pageOut), 'the tab shows the pieces in fractions and mm');
  ok(/Hooper/.test(pageOut) && /1\.35 × a smooth bend/.test(pageOut), 'and the Hooper comparison, 1.35 x a smooth bend');
  ok(await pg.$('#pc-svg') && await pg.$('#pc-piece') && await pg.$('#pc-tpl'), 'drawings: the assembled bend, one piece, the template');
  ok(/inside \(throat\) 1\.19 in \/ 30\.3 mm/.test(await pg.$eval('#pc-piece', e => e.textContent)), 'the piece drawing is dimensioned in in and mm');

  // template files: DXF (mm, closed CUT outline, MARKS with the bars) and SVG at true scale
  const parse = txt => { const t = txt.split(/\r\n/), ents = [], hdr = {};
    for (let i = 0; i < t.length - 1; i += 2) { if (t[i] === '9') hdr[t[i + 1]] = t[i + 3]; }
    for (let i = 0; i < t.length - 1; i += 2) if (t[i] === '0' && /^(LINE|TEXT)$/.test(t[i + 1])) { const e = { type: t[i + 1] }; let j = i + 2; while (j < t.length - 1 && t[j] !== '0') { e[t[j]] = t[j + 1]; j += 2; } ents.push(e); }
    return { hdr, ents }; };
  const files = await pg.evaluate(() => { const P = window.__pie.last(), T = window.__pie.pieTpl(P), c = window.__cope(50.8, 50.8, null, 1.651), c3 = window.__cope(76.2, 76.2, null, 1.651);
    return { dxf: window.__pie.tplDxf(T), svg: window.__pie.tplSvg(T), W: T.W, cdxf: c.text, csvg: c.svg, c3svg: c3.svg, rise: c.rise }; });
  const checkDxf = (txt, what, W) => { const { hdr, ents } = parse(txt), cut = ents.filter(e => e.type === 'LINE' && e['8'] === 'CUT'), mk = ents.filter(e => e['8'] === 'MARKS');
    ok(hdr.$INSUNITS === '4', what + ': DXF in mm');
    const pts = []; cut.forEach(l => { pts.push([+l['10'], +l['20']], [+l['11'], +l['21']]); });
    ok(pts.every((p, i) => pts.some((q, j) => j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3)) && Math.abs(Math.max(...pts.map(p => p[0])) - W) < 1e-3, what + ': the CUT outline is closed and ' + W.toFixed(3) + ' mm long');
    const bars = mk.filter(e => e.type === 'LINE' && Math.abs(+e['20'] - +e['21']) < 1e-9 && +e['10'] === 0).map(e => +e['11'] - +e['10']).sort((a, c) => a - c);
    ok(bars.length === 2 && Math.abs(bars[0] - 100) < 1e-9 && Math.abs(bars[1] - 101.6) < 1e-9, what + ': scale bars 100 mm and 4 in (101.6 mm) on MARKS');
    const ticks = mk.filter(e => e.type === 'LINE' && +e['10'] === +e['11']).map(e => +e['10']);
    ok([0, W / 4, W / 2, 3 * W / 4, W].every(x => ticks.filter(t => Math.abs(t - x) < 1e-3).length >= 2), what + ': ticks at 0, 90, 180, 270 and 360 deg across the cut line and at the straight edge');
    return mk.filter(e => e.type === 'TEXT').map(e => e['1']); };
  const pt = checkDxf(files.dxf, 'pie template', files.W);
  ok(pt.some(t => /^peak 0/.test(t)) && pt.some(t => /low point 180/.test(t)), 'pie template: peak and low-point labels');
  // the cut line's height: y = 20 + h (1 + cos(2 pi s / W)), so peak - low point = 2 h = 15.157122 mm
  const cl = parse(files.dxf).ents.filter(e => e.type === 'LINE' && e['8'] === 'CUT').slice(0, 144).map(e => +e['20']);
  near(Math.max(...cl) - Math.min(...cl), 15.157122, 1e-4, 'pie template (DXF to 4 decimals): the curve rises 2 (OD/2) tan(cut) from low point to peak');
  const ct = checkDxf(files.cdxf, 'cope 2 in on 2 in', Math.PI * 50.8);
  ok(ct.some(t => /flank 90/.test(t)) && ct.some(t => /flank 270/.test(t)) && ct.some(t => /in line 0/.test(t)), 'cope: flank and in-line marks labelled');
  const svgIn = (s, what, pieces) => { const m = s.match(/<svg[^>]*width="([\d.]+)mm" height="([\d.]+)mm" viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    ok(m && +m[1] === +m[3] && +m[2] === +m[4] && +m[1] <= 200, what + ': SVG sized in mm with a mm viewBox (1 unit = 1 mm), ' + (m ? m[1] : '?') + ' mm wide, fits a letter or A4 sheet');
    ok(/100 mm<\/text>/.test(s) && /4 in<\/text>/.test(s) && (s.match(/<line x1="12" y1="[\d.]+" x2="(112|113\.6)"/g) || []).length === 2, what + ': a 100 mm and a 4 in bar');
    ok(pieces === 1 ? !/Piece 1 of/.test(s) : new RegExp('Piece ' + pieces + ' of ' + pieces).test(s), what + ': ' + pieces + ' piece(s) (strip over 160 mm splits)'); };
  svgIn(files.csvg, 'cope 2 in (strip 159.6 mm)', 1); svgIn(files.svg, 'pie 3 in (strip 239.4 mm)', 2); svgIn(files.c3svg, 'cope 3 in', 2);
  ok(/flank 90/.test(files.csvg) && /in line 180/.test(files.csvg), 'cope SVG: flank marks');

  // saving goes through the page's save path (Fusion stub: saveText with the SVG / DXF text)
  const pg2 = await ctx.newPage(); const e2 = []; pg2.on('pageerror', e => e2.push(e.message));
  await pg2.addInitScript(() => { window.__saved = []; window.adsk = { fusionSendData: (a, d) => { if (a === 'saveText') window.__saved.push(JSON.parse(d)); return Promise.resolve(JSON.stringify(a === 'saveText' ? { ok: true, msg: 'Saved C:/x' } : { ok: true })); } }; });
  await pg2.goto('file://' + process.cwd() + '/index.html#headers'); await pg2.waitForTimeout(900);
  await pg2.click('button[data-pc="svg"]'); await pg2.click('button[data-pc="dxf"]'); await pg2.waitForTimeout(300);
  let sv = await pg2.evaluate(() => window.__saved.map(x => [x.filename, x.text.slice(0, 60)]));
  ok(sv.length === 2 && /^piecut_76p2mm_11p25deg\.svg$/.test(sv[0][0]) && /<\?xml/.test(sv[0][1]) && /\.dxf$/.test(sv[1][0]) && /SECTION/.test(sv[1][1]), 'pie template saved as SVG and DXF through saveText: ' + sv.map(x => x[0]).join(', '));
  await pg2.evaluate(() => { location.hash = 'mufflers'; }); await pg2.waitForTimeout(400);
  const nb = await pg2.$$eval('button[data-cope][data-fmt="svg"]', x => x.length);
  if (nb) { await pg2.click('button[data-cope][data-fmt="svg"]'); await pg2.waitForTimeout(300); }
  sv = await pg2.evaluate(() => window.__saved.map(x => [x.filename, x.text]));
  ok(nb >= 1 && /^cope_.*\.svg$/.test(sv[2] && sv[2][0]) && /width="[\d.]+mm"/.test(sv[2] && sv[2][1]), 'Mufflers tab: the cope Print 1:1 (SVG) button saves the SVG (' + (sv[2] ? sv[2][0] : 'none') + ')');
  ok(!e2.length, 'no page errors with the Fusion stub ' + e2.join('; '));

  // inch fractions: 1/16 (default), 1/32, 1/64, kept across a reload
  // by hand: 47.625 mm = 1.875 in = 1 7/8 exactly; 30.314245 mm = 1.193474 in: x 16 = 19.096 -> 19/16 = 1 3/16;
  // x 32 = 38.191 -> 38/32 = 1 3/16; x 64 = 76.382 -> 76/64 = 1 3/16; 37.3 mm = 1.468504 in: x 32 = 46.992 -> 47/32 = 1 15/32,
  // x 64 = 93.984 -> 94/64 = 1 15/32; 7.578561 mm = 0.298369 in: x 64 = 19.096 -> 19/64.
  const fr = async () => pg.evaluate(() => { const C = window.__cut; return [C.inchDen(), C.inMm(47.625), C.inMm(30.314245), C.inMm(37.3), C.inMm(7.578561)]; });
  let f = await fr();
  ok(f.join(' | ') === '16 | 1 7/8 in (47.5 mm) | 1 3/16 in (30.5 mm) | 1 7/16 in (37.5 mm) | 5/16 in (7.5 mm)', 'default 1/16, mm to 0.5: ' + f.join(' | '));
  await pg.click('#f-32'); await pg.waitForTimeout(200); f = await fr();
  ok(f.join(' | ') === '32 | 1 7/8 in (47.6 mm) | 1 3/16 in (30.3 mm) | 1 15/32 in (37.3 mm) | 5/16 in (7.6 mm)', '1/32, mm to 0.1: ' + f.join(' | '));
  await pg.click('#f-64'); await pg.waitForTimeout(200); f = await fr();
  ok(f.join(' | ') === '64 | 1 7/8 in (47.6 mm) | 1 3/16 in (30.3 mm) | 1 15/32 in (37.3 mm) | 19/64 in (7.6 mm)', '1/64: ' + f.join(' | '));
  ok(/Inches to the nearest 1\/64, mm to 0\.1/.test(await pg.$eval('#pc-out', e => e.innerText)) && await pg.$eval('#f-64', e => e.getAttribute('aria-pressed') === 'true'), 'the tab re-renders and says 1/64');
  await pg.reload(); await pg.waitForTimeout(900);
  ok((await fr())[0] === 64, 'the setting is kept after a reload');
  await pg.click('#f-16'); await pg.waitForTimeout(200); ok((await fr())[0] === 16, 'and set back to 1/16');

  // phone width: no sideways page scroll
  const ph = await b.newPage({ viewport: { width: 400, height: 860 } }); const e3 = []; ph.on('pageerror', e => e3.push(e.message));
  await ph.goto('file://' + process.cwd() + '/index.html#headers'); await ph.waitForTimeout(900);
  ok(await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && !!document.getElementById('pc-svg')), '400 px: no sideways page scroll');
  ok(!errs.length && !e3.length, 'no page errors ' + errs.concat(e3).join('; '));
  await b.close(); console.log(fails.length ? 'piecut_ui: ' + fails.length + ' FAIL' : 'piecut_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
