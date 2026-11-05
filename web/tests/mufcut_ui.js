// Muffler cut files: the wrap, plates and baffles of the chamber as DXF; sizes check out; reverse flow and oval cases.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const out = []; let fails = 0; const chk = (ok, m) => { if (!ok) { out.push('FAIL ' + m); fails++; } };
  const pg = await (await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })).newPage();
  pg.on('pageerror', e => { out.push('PAGEERROR ' + e.message); fails++; });
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers'); await pg.click('#m-expert'); await pg.click('#u-met'); await pg.waitForTimeout(200);
  const r = await pg.evaluate(() => {
    const p = { dpipe: 60.198, dch: 152.4, lch: 355.6 }, pl = window.__mufCut.plan(p), dxf = window.__mufCut.dxf(pl);
    return { pl: { oval: pl.oval, W: pl.W, H: pl.H, wrap: pl.wrap, plates: pl.plates.map(q => [q.name, q.w, q.h, q.holes.length]), tubes: pl.tubes, od: pl.od, cw: pl.cw }, circles: (dxf.match(/CIRCLE/g) || []).length, lines: (dxf.match(/LINE/g) || []).length, arcs: (dxf.match(/\bARC\b/g) || []).length, hasEOF: /EOF/.test(dxf) };
  });
  out.push(JSON.stringify(r));
  chk(!r.pl.oval && Math.abs(r.pl.wrap.w - (Math.PI * 152.4 + Math.PI * r.pl.cw)) < 1e-6 && Math.abs(r.pl.wrap.h - (355.6 + 2 * r.pl.cw)) < 1e-6, 'round wrap = mid-wall circumference x (length + 2 plates)');
  chk(r.pl.plates.length === 2 && r.circles === 4 && r.lines === 4 && r.arcs === 0 && r.hasEOF, 'two round plates with one hole each: 4 circles, the wrap 4 lines');
  chk(Math.abs(r.pl.tubes[0].L - (50.8 + r.pl.cw + 0)) < 1e-6, 'plain chamber tube = stub + plate');
  await pg.selectOption('#m-case', 'oval'); await pg.fill('#m-caseh', '101.6'); await pg.dispatchEvent('#m-caseh', 'input');
  await pg.fill('#m-nbaf', '2'); await pg.dispatchEvent('#m-nbaf', 'input'); await pg.selectOption('#m-chlay', 'reverse'); await pg.fill('#m-lin', '177.8'); await pg.dispatchEvent('#m-lin', 'input'); await pg.waitForTimeout(200);
  const r2 = await pg.evaluate(() => { const p = { dpipe: 60.198, dch: 152.4, lch: 355.6 }, pl = window.__mufCut.plan(p), dxf = window.__mufCut.dxf(pl);
    return { oval: pl.oval, W: pl.W, H: pl.H, area: Math.PI * pl.H * pl.H / 4 + (pl.W - pl.H) * pl.H, want: Math.PI / 4 * 152.4 ** 2, plates: pl.plates.map(q => [q.name, q.holes.length]), arcs: (dxf.match(/\bARC\b/g) || []).length, tubes: pl.tubes, err: pl.err }; });
  out.push(JSON.stringify(r2));
  chk(r2.oval && Math.abs(r2.area - r2.want) < 1e-6 && r2.H > 90 && r2.W > r2.H, 'oval case keeps the chamber area at the asked height');
  chk(r2.plates.length === 4 && r2.plates[0][1] === 2 && r2.plates[1][1] === 0 && r2.plates[2][1] === 1 && r2.arcs === 8, 'reverse flow: two holes in one plate, blank far plate, two baffles; stadium arcs drawn');
  chk(Math.abs(r2.tubes[0].L - r2.tubes[1].L) < 1e-9 && r2.tubes[0].L > 50.8 + 177, 'reverse flow: both tubes the same, run in by the inlet figure');
  const txt = await pg.evaluate(() => document.getElementById('m-details').innerText);
  chk(/Cut files for this chamber/.test(txt) && /Shell wrap/.test(txt) && !/\bNaN\b/.test(txt), 'section rendered');
  const [dl] = await Promise.all([pg.waitForEvent('download', { timeout: 5000 }).catch(() => null), pg.click('#m-cut-dxf')]);
  chk(!!dl && /muffler_chamber_152x356_reverse_mm\.dxf/.test(dl.suggestedFilename()), 'download named for the chamber: ' + (dl && dl.suggestedFilename()));
  const cp = await pg.evaluate(() => { const c = window.__cope(54.1, 63.5); return { rise: c.rise, want: 63.5 / 2 - Math.sqrt((63.5 / 2) ** 2 - (54.1 / 2) ** 2), width: c.width, lines: (c.text.match(/LINE/g) || []).length, none: window.__cope(70, 63.5) }; });
  chk(Math.abs(cp.rise - cp.want) < 1e-9 && Math.abs(cp.width - Math.PI * 54.1) < 1e-9 && cp.lines === 75 && cp.none === null, 'cope template: rise R - sqrt(R^2 - r^2), strip pi d wide, 72 cut segments + 3 edges, refused when the branch is larger');
  await pg.selectOption('#m-chlay', 'through'); await pg.selectOption('#m-case', 'round'); await pg.fill('#m-nbaf', '0'); await pg.dispatchEvent('#m-nbaf', 'input'); await pg.waitForTimeout(100);
  await b.close(); console.log(out.join('\n')); console.log(fails ? 'mufcut_ui: ' + fails + ' FAIL' : 'mufcut_ui: all pass'); process.exit(fails ? 1 : 0);
})();
