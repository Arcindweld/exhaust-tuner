// Fabrication audit, 2026-11-11 (docs/FAB_AUDIT_2026-11-11.md): the page's cut, bend and flat-pattern outputs checked
// against references written here from the geometry (brute force: bisection on the surfaces, sampling of the solids),
// not from the page's formulas. Tolerances: 0.05 mm on template points, 0.25 mm on lengths, 0.1 deg on angles.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = []; let fails = 0;
  const chk = (ok, m) => { out.push((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fails++; };
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  pg.on('pageerror', e => { out.push('PAGEERROR ' + e.message); fails++; });
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers'); await pg.click('#m-expert'); await pg.click('#u-met'); await pg.waitForTimeout(300);

  // ---------------------------------------------------------------- 1. cope (fishmouth) wrap template
  // Reference: the main pipe's top surface over a point at lateral offset y is found by bisection on y^2 + z^2 = R^2;
  // a cut square to the branch wall has one height across the wall at each angle, so it must stop at the highest main
  // surface under any point of the wall (radii ri..ro). x runs round the branch's outside, ro * theta.
  const surf = (y, R) => { let lo = 0, hi = R; for (let k = 0; k < 80; k++) { const m = (lo + hi) / 2; if (y * y + m * m < R * R) lo = m; else hi = m; } return lo; };
  const copeRef = (d, D, w, th) => { const ro = d / 2, ri = ro - w, R = D / 2; let top = 0;
    for (let k = 0; k <= 40; k++) top = Math.max(top, surf((ri + (ro - ri) * k / 40) * Math.sin(th), R)); return R - top; };
  const parse = txt => { const t = txt.split(/\r\n/), ents = [], hdr = {};
    for (let i = 0; i < t.length - 1; i += 2) { if (t[i] === '9') hdr[t[i + 1]] = t[i + 3]; }
    for (let i = 0; i < t.length - 1; i += 2) if (t[i] === '0' && /^(LINE|CIRCLE|ARC)$/.test(t[i + 1])) { const e = { type: t[i + 1] }; let j = i + 2;
      while (j < t.length - 1 && t[j] !== '0') { e[t[j]] = t[j + 1]; j += 2; } ents.push(e); }
    return { hdr, ents }; };
  const cases = [[41.402, 63.5, 1.651, 'a 1.5 in ID neck on a 2.5 in pipe, 16 ga'], [50.8, 50.8, 1.651, 'same size, two 2 in tubes'], [25.4, 76.2, 3.05, 'small d/D, thick wall (1 in on 3 in, 0.120 in)']];
  for (const [d, D, w, what] of cases) {
    const c = await pg.evaluate(a => { const c = window.__cope(a[0], a[1], null, a[2]); return { text: c.text, rise: c.rise, width: c.width }; }, [d, D, w]);
    const { hdr, ents } = parse(c.text), lines = ents.filter(e => e.type === 'LINE');
    chk(hdr.$INSUNITS === '4' && hdr.$MEASUREMENT === '1', what + ': DXF in millimetres ($INSUNITS 4, $MEASUREMENT 1)');
    let worst = 0;
    for (let i = 0; i < 72; i++) { const x = +lines[i]['10'], y = +lines[i]['20'], z = copeRef(d, D, w, x / (d / 2)); worst = Math.max(worst, Math.abs(y - z)); }
    const end = +lines[71]['11'];
    chk(worst < 0.05, what + ': every point of the cut line within 0.05 mm of the inside-edge contact curve (worst ' + worst.toFixed(3) + ' mm)');
    chk(Math.abs(end - Math.PI * d) < 0.01 && Math.abs(c.width - Math.PI * d) < 1e-9, what + ': the strip is the outside circumference, ' + (Math.PI * d).toFixed(2) + ' mm');
    const odRise = D / 2 - Math.sqrt(D * D / 4 - d * d / 4);
    out.push('     ' + what + ': rise ' + c.rise.toFixed(2) + ' mm; a line from the outside radius rises ' + odRise.toFixed(2) + ' mm and leaves the inside edge ' + (odRise - c.rise).toFixed(2) + ' mm into the main pipe at the flanks');
    // closed outline: every line end meets another line's end
    const pts = []; lines.forEach(l => { pts.push([+l['10'], +l['20']], [+l['11'], +l['21']]); });
    chk(pts.every((p, i) => pts.some((q, j) => j !== i && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3)), what + ': the strip outline is closed');
  }
  const c0 = await pg.evaluate(() => { const c = window.__cope(54.1, 63.5); return c.rise; });
  chk(Math.abs(c0 - (63.5 / 2 - Math.sqrt((63.5 / 2) ** 2 - (54.1 / 2) ** 2))) < 1e-9, 'no wall given: the outside-edge line, as before');
  const shown = await pg.evaluate(() => { const det = document.getElementById('m-details'); const btns = [...document.querySelectorAll('button[data-cope]')].map(x => x.dataset.wall); return { t: det ? det.innerText : '', btns }; });
  chk(/wrap it round the outside of the branch/.test(shown.t) && /inside edge, which then touches the main pipe/.test(shown.t) && /Print it 1:1/.test(shown.t), 'the Mufflers tab says which surface the paper wraps, which edge touches, the scale check and the orientation');
  chk(shown.btns.length >= 1 && shown.btns.every(v => +v > 0), 'its DXF buttons carry the wall (' + shown.btns.join(', ') + ' mm)');

  // ---------------------------------------------------------------- 2. cone / megaphone flat pattern (coneFlat)
  // A developed frustum must give: outer arc = the big end's mid-wall circumference, inner arc = the small end's, and
  // R1 - R0 = the slant measured between the two rims in 3-D.
  const cones = [[50.8, 76.2, 181.6, 1.651, '8 deg megaphone, 2 to 3 in'], [76.2, 63.5, 48.3, 1.651, '15 deg reducer'], [63.5, 127, 25, 1.2, 'short steep flare, over 180 deg of sweep']];
  for (const [d0, d1, len, w, what] of cones) {
    const f = await pg.evaluate(a => window.__quick.coneFlat(a[0], a[1], a[2], a[3]), [d0, d1, len, w]);
    const ra = (Math.min(d0, d1) + w) / 2, rb = (Math.max(d0, d1) + w) / 2, slant = Math.hypot(len, rb - ra), sw = f.sweep * Math.PI / 180;
    chk(Math.abs(f.R1 * sw - 2 * Math.PI * rb) < 0.25 && Math.abs(f.R0 * sw - 2 * Math.PI * ra) < 0.25 && Math.abs(f.R1 - f.R0 - slant) < 0.25,
      what + ': arcs ' + f.R0.toFixed(1) + ' / ' + f.R1.toFixed(1) + ' mm over ' + f.sweep.toFixed(1) + ' deg close round both rims at mid-wall, slant ' + slant.toFixed(1) + ' mm');
  }

  // ---------------------------------------------------------------- 3. X-pipe: miter, legs, shared opening, window
  // Reference by sampling: the two pipes as cylinders of diameter Dp crossing at +-a to the car's axis in one plane;
  // the window is the extent along pipe 1 of its wall that lies inside pipe 2, the opening the extent along the car of
  // the region inside both.
  for (const ang of [20, 30, 12]) {
    const r = await pg.evaluate(a => window.__physAudit.calcCross({ type: 'x', d: 63.5, dplan: 63.5, s: 200, pos: 250, ang: a, mrg: 0 }), ang);
    const A = r.strokes[0].pts, dx = A[2][0] - A[1][0], dy = A[2][1] - A[1][1];
    const turn = Math.atan2(-dy, dx) * 180 / Math.PI, leg = Math.hypot(dx, dy), rr = 63.5 / 2, t = ang * Math.PI / 180;
    // pipe 1 axis through the origin along (cos t, sin t, 0), pipe 2 along (cos t, -sin t, 0)
    const u2 = [Math.cos(t), -Math.sin(t), 0]; let smin = 1e9, smax = -1e9, xmin = 1e9, xmax = -1e9;
    for (let i = -4000; i <= 4000; i++) { const s = i * 0.05;
      for (let k = 0; k < 360; k += 2) { const ps = k * Math.PI / 180, n1 = [-Math.sin(t), Math.cos(t), 0];
        const p = [s * Math.cos(t) + rr * Math.cos(ps) * n1[0], s * Math.sin(t) + rr * Math.cos(ps) * n1[1], rr * Math.sin(ps)];
        const pr = p[0] * u2[0] + p[1] * u2[1], d2 = Math.hypot(p[0] - pr * u2[0], p[1] - pr * u2[1], p[2]);
        if (d2 < rr) { smin = Math.min(smin, s); smax = Math.max(smax, s); } } }
    for (let i = -4000; i <= 4000; i++) { const x = i * 0.05;       // on the car's axis between the pipes: inside both?
      const in1 = Math.abs(x * Math.sin(t)) < rr; if (in1) { xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); } }
    chk(Math.abs(turn - ang) < 0.1 && Math.abs(r.g.miter - ang / 2) < 0.1 && Math.abs(leg - r.g.leg) < 0.25,
      'X-pipe ' + ang + ' deg: bend ' + turn.toFixed(2) + ' deg, miter ' + r.g.miter.toFixed(2) + ' deg a side (half the turn), leg ' + r.g.leg.toFixed(1) + ' mm');
    chk(Math.abs((smax - smin) - r.g.window) < 0.25 && Math.abs((xmax - xmin) - r.g.open) < 0.25,
      'X-pipe ' + ang + ' deg: window ' + r.g.window.toFixed(1) + ' mm (sampled ' + (smax - smin).toFixed(1) + '), shared opening ' + r.g.open.toFixed(1) + ' mm (sampled ' + (xmax - xmin).toFixed(1) + ')');
  }

  // ---------------------------------------------------------------- 4. cut list: marks, kerf, clocking to 0.1 deg
  const cl = await pg.evaluate(() => { const C = window.__cut, clr = 2.62 * 25.4;
    const rows = [{ L: 100, R: null, A: 90, CLR: clr }, { L: 37.3, R: 33.33, A: 47.25, CLR: clr }, { L: 0, R: -121.46, A: 30, CLR: clr }, { L: 80, R: null, A: null, CLR: null }];
    const c = C.cutList(rows, 1.75, '304'); return { p: c.pieces.map(p => ({ k: p.kind, arc: p.arc, outer: p.outer, inner: p.inner, A: p.A, CLR: p.CLR, L: p.L })), html: C.cutListHtml(c, 'T'), st: c.straightTotal, f: [C.inMm(37.3), C.inMm(101.6)] }; });
  const odm = 1.75 * 25.4, cr = 2.62 * 25.4;
  const bends = cl.p.filter(p => p.k === 'bend');
  chk(bends.every(p => Math.abs(p.arc - cr * p.A * Math.PI / 180) < 0.01 && Math.abs(p.outer - (cr + odm / 2) * p.A * Math.PI / 180) < 0.01 && Math.abs(p.inner - (cr - odm / 2) * p.A * Math.PI / 180) < 0.01),
    'bend pieces: centreline, outside and inside arc lengths = (CLR, CLR + OD/2, CLR - OD/2) x angle');
  chk(/33\.3°/.test(cl.html) && /-121\.5°/.test(cl.html) && /47\.3° on/.test(cl.html), 'clocking and bend angles shown to 0.1 deg (33.3, -121.5; 47.3)');
  chk(Math.abs(cl.st - (100 + 37.3 + 80 + 3 * 1.6)) < 1e-9, 'straight stock = the straights plus one 1.6 mm kerf each');
  chk(cl.f[0] === '1 7/16 in (37.5 mm)' && cl.f[1] === '4 in (101.5 mm)', 'inches to the nearest 1/16, mm to 0.5: ' + cl.f.join(' | '));
  chk(/inches to the nearest 1\/16|Inches are rounded to the nearest 1\/16/.test(cl.html + await pg.evaluate(() => window.__cut.cutBuyHtml([window.__cut.cutList([{ L: 10, R: null, A: 90, CLR: 2.62 * 25.4 }, { L: 10, R: null, A: null, CLR: null }], 1.75, '304')]))), 'the rounding is stated');

  // ---------------------------------------------------------------- 5. muffler chamber cut file: sizes and closed outlines
  const mc = await pg.evaluate(() => { const pl = window.__mufCut.plan({ dpipe: 60.198, dch: 152.4, lch: 355.6 }); return { pl: { wrap: pl.wrap, cw: pl.cw, od: pl.od, plates: pl.plates.map(q => ({ w: q.w, h: q.h, holes: q.holes })), oval: pl.oval }, dxf: window.__mufCut.dxf(pl) }; });
  const md = parse(mc.dxf), cw = mc.pl.cw;
  chk(md.hdr.$INSUNITS === '4' && Math.abs(mc.pl.wrap.w - Math.PI * (152.4 + cw)) < 0.01 && Math.abs(mc.pl.wrap.h - (355.6 + 2 * cw)) < 0.01, 'chamber wrap: pi x (inside + wall) by the length plus two plates, mm');
  const circ = md.ents.filter(e => e.type === 'CIRCLE').map(e => 2 * e['40']);
  chk(circ.filter(v => Math.abs(v - (152.4 - 0.3)) < 0.01).length === mc.pl.plates.length && circ.filter(v => Math.abs(v - (mc.pl.od + 0.5)) < 0.01).length >= 2,
    'end plates 0.3 mm under the inside diameter, holes the pipe OD + 0.5 mm (' + (mc.pl.od + 0.5).toFixed(2) + ' mm)');

  // packing into stock bends, worked by hand: kerf 1.6 mm on a 2.62 in CLR is 1.378 deg of arc; 90 + 47.25 + 30 deg
  // fit one 180 deg U-bend (90, then 47.25 + kerf, then 30 + kerf: 9.99 deg left) but take two 90s (47.25 + kerf + 30 + kerf = 79.98)
  const pk = await pg.evaluate(() => { const C = window.__cut, clr = 2.62 * 25.4, rows = [{ L: 100, R: null, A: 90, CLR: clr }, { L: 37.3, R: 33.33, A: 47.25, CLR: clr }, { L: 0, R: -121.46, A: 30, CLR: clr }, { L: 80, R: null, A: null, CLR: null }];
    const st = a => [{ supplier: 'T', od: 1.75, clr: 2.62, angle: a, mat: '304 stainless', pn: 'U' + a }];
    const u = C.cutList(rows, 1.75, '304', { stock: st(180) }), n = C.cutList(rows, 1.75, '304', { stock: st(90) });
    return { u: u.buy.map(x => [x.count, x.bins.map(q => q.left)]), n: n.buy.map(x => [x.count, x.bins.map(q => q.left)]) }; });
  const kd = 1.6 / (2.62 * 25.4) * 180 / Math.PI;
  chk(pk.u[0][0] === 1 && Math.abs(pk.u[0][1][0] - (180 - 167.25 - 2 * kd)) < 1e-6 && pk.n[0][0] === 2 && Math.abs(pk.n[0][1][1] - (90 - 77.25 - kd)) < 1e-6,
    'stock packing: one U-bend (' + pk.u[0][1][0].toFixed(2) + ' deg left) or two 90s (' + pk.n[0][1].map(v => v.toFixed(2)).join(', ') + ' deg left), kerf ' + kd.toFixed(3) + ' deg between pieces of one arc');

  // ---------------------------------------------------------------- 6. oval chamber: the same inside area, the wrap at mid-wall
  const ov = await pg.evaluate(() => { document.getElementById('m-case').value = 'oval'; const pl = window.__mufCut.plan({ dpipe: 60.198, dch: 152.4, lch: 355.6 });
    document.getElementById('m-case').value = 'round'; return { W: pl.W, H: pl.H, cw: pl.cw, wrap: pl.wrap, plates: pl.plates.map(q => [q.w, q.h]) }; });
  const ovA = (ov.W - ov.H) * ov.H + Math.PI * ov.H * ov.H / 4, ovP = 2 * (ov.W - ov.H) + Math.PI * (ov.H + ov.cw);
  chk(Math.abs(ovA - Math.PI / 4 * 152.4 ** 2) < 0.5 && Math.abs(ov.wrap.w - ovP) < 0.01 && ov.plates.every(q => Math.abs(q[0] - (ov.W - 0.3)) < 1e-9 && Math.abs(q[1] - (ov.H - 0.3)) < 1e-9),
    'flat-oval case ' + ov.W.toFixed(1) + ' x ' + ov.H.toFixed(1) + ' mm inside holds the 6 in round area (' + ovA.toFixed(0) + ' mm^2); wrap ' + ov.wrap.w.toFixed(2) + ' mm = 2 (W - H) + pi (H + wall); plates 0.3 mm under');

  // ---------------------------------------------------------------- 7. X-pipe build sheet lengths to 0.01 in / 0.1 mm
  await pg.evaluate(() => location.hash = 'crossover'); await pg.selectOption('#x-type', 'x'); await pg.waitForTimeout(200);
  const xs = await pg.evaluate(() => { const sec = [...document.querySelectorAll('#panel-cross .sec')].find(x => /X-pipe build sheet/.test(x.innerText)); return sec ? sec.innerText : ''; });
  const xm = xs.match(/([\d.]+) in \(([\d.]+) mm\) of tube \(([\d.]+) in \(([\d.]+) mm\) along the car\)/);
  chk(!!xm && /^\d+\.\d\d$/.test(xm[1]) && /^\d+\.\d$/.test(xm[2]) && Math.abs(xm[1] * 25.4 - xm[2]) < 0.2 && Math.abs(xm[3] * 25.4 - xm[4]) < 0.2,
    'X-pipe build sheet gives the leg to 0.01 in and 0.1 mm: ' + (xm ? xm[0] : 'not found'));

  // ---------------------------------------------------------------- 8. two-stroke build sheet: a flat blank for every cone
  await pg.goto('file://' + process.cwd() + '/index.html#quick'); await pg.waitForTimeout(300);
  await pg.selectOption('#q-eng', 't1'); await pg.dispatchEvent('#q-eng', 'change'); await pg.waitForTimeout(300);
  const ts = await pg.evaluate(() => { const p = window.__quick.quickParams(), r = window.__quick.calcQuick(p), sh = window.__quick.quickSheet(p, r);
    return { segs: r.two.segs, buy: sh.buy, steps: sh.steps, W: 1.651 }; });   // the sheet's 0.065 in wall
  const tcones = ts.segs.filter(s => s.d0 !== s.d1);
  chk(tcones.length >= 2 && tcones.every(s => { const row = ts.buy.find(b => b[0] === s.name + ' blank'); if (!row) return false;
      const m = row[3].match(/arcs of ([\d.]+) in \(([\d.]+) mm\) and ([\d.]+) in \(([\d.]+) mm\) radius over ([\d.]+)°/); if (!m) return false;
      const ra = (Math.min(s.d0, s.d1) + ts.W) / 2, rb = (Math.max(s.d0, s.d1) + ts.W) / 2, sl = Math.hypot(s.len, rb - ra), R0 = +m[2], R1 = +m[4], sw = +m[5] * Math.PI / 180;
      return /from 0\.065 in \(1\.65 mm\) sheet/.test(row[3]) && Math.abs(R1 * sw - 2 * Math.PI * rb) < 0.5 && Math.abs(R0 * sw - 2 * Math.PI * ra) < 0.5 && Math.abs(R1 - R0 - sl) < 0.25 && Math.abs(+m[1] * 25.4 - R0) < 0.15; })
    && !ts.steps.some(t => /2-Stroke tab’s layout/.test(t)),
    'two-stroke sheet: ' + tcones.map(s => s.name).join(' and ') + ' each get a blank whose arcs close round both rims at mid-wall (' + tcones.map(s => (ts.buy.find(b => b[0] === s.name + ' blank') || [, , , '?'])[3].replace(/ \(mid-wall.*/, '')).join('; ') + ')');

  // ---------------------------------------------------------------- 9. hanger tabs: coped foot and fin edge on the tube
  await pg.goto('file://' + process.cwd() + '/index.html#hangers'); await pg.waitForTimeout(300);
  const hg = await pg.evaluate(() => { const H = window.__hang, o = H.hgRead(), res = [];
    for (const [orient, od] of [['across', 50.8], ['across', 76.2], ['along', 50.8], ['along', 25.4]]) {
      const q = H.hgParts(Object.assign({}, o, { orient, od, part: 'tab' }))[0];
      res.push({ orient, od, t: q.t, foot: q.outline.filter(s => s.t === 'A' && Math.hypot(s.c[0], s.c[1]) < 1e-9).map(s => s.r),
        low: Math.min(...q.outline.flatMap(s => s.t === 'L' ? [s.a[1], s.b[1]] : [])) }); }
    return res; });
  chk(hg.every(h => h.orient === 'across' ? h.foot.length === 1 && Math.abs(h.foot[0] - h.od / 2) < 1e-9 : Math.abs(h.low - Math.sqrt((h.od / 2) ** 2 - (h.t / 2) ** 2)) < 1e-9),
    'hanger tabs: across the tube the foot is an arc of the tube radius on its axis; along it the weld edge sits where both faces meet the tube, sqrt(R^2 - (t/2)^2) (' + hg.map(h => h.orient + ' ' + h.od + ' mm').join(', ') + ')');

  await b.close(); console.log(out.join('\n')); console.log(fails ? 'fabaudit_ui: ' + fails + ' FAIL' : 'fabaudit_ui: all pass'); process.exit(fails ? 1 : 0);
})();
