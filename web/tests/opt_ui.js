// Header optimiser (4-Stroke tab, under Run it in OpenWAM): the candidates around a Headers-tab 8-4-1 on a stock LS3,
// each turned into an OpenWAM case, and (when an OpenWAM build is here: EXHAUST_TUNER_OPENWAM or ext/OpenWAM) the
// as-designed case run for real.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const { skipPart, openwam } = require('./skip.js');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await pg.goto('file://' + process.cwd() + '/index.html#headers'); await pg.waitForTimeout(400);
  await pg.click('#m-expert');
  await setv('h-eng', 'ls'); await setv('h-grp', 'all'); await setv('h-merge', 'triy'); await setv('h-dp', '1.875'); await pg.waitForTimeout(250);
  await pg.evaluate(() => { location.hash = 'four-stroke'; }); await pg.waitForTimeout(400);
  await setv('f-camlib', 'ls3'); await pg.waitForTimeout(200);
  for (const [id, v] of [['#f-rpm', '6000'], ['#f-dp', '1.875'], ['#f-trq', '4600']]) { await pg.fill(id, v); await pg.dispatchEvent(id, 'input'); }
  await pg.waitForTimeout(400);
  const r = await pg.evaluate(() => {
    const H = window.__hdrLast ? window.__hdrLast() : null;
    if (!H) return { err: 'no Headers layout' };
    const q = window.__sim.inp(), sp = window.__sim.simSpec(q), O = window.__opt;
    const cands = O.optCandidates(H.p, H.r);
    const out = cands.map(c => { const rr = window.__hdr.calcLayout(c.p), w = O.hdrWamSpec(rr, c.p, sp); if (w.err) return { label: c.label, err: w.err };
      let text = ''; try { text = window.WamExport.makeWam(w.spec, { rpm: 5000, cycles: 12, name: 'opt' }); } catch (e) { return { label: c.label, err: e.message }; }
      const col = w.spec.opt.collectors[0], prim = w.spec.exhaust.segs.reduce((a, s) => a + s.L, 0), sec = col.stages ? col.stages[0].segs.reduce((a, s) => a + s.L, 0) : 0;
      return { label: c.label, groups: col.stages ? col.stages[0].groups.length : 0, toColl: (prim + sec) * 1000, total: rr.total, text }; });
    const sec = [...document.querySelectorAll('#four-details .sec h3')].find(x => /Optimise the Headers tab/.test(x.textContent));
    return { n: cands.length, labels: cands.map(c => c.label), out, sec: sec ? sec.parentElement.innerText : '' };
  });
  ok(!r.err, 'a Headers-tab layout is there (' + (r.err || 'ok') + ')');
  if (!r.err) {
    ok(r.n === 10, '10 designs around an 8-4-1: as designed, 4 lengths, 2 Y positions, 2 secondary sizes, the other pairing (' + r.labels.join(' / ') + ')');
    ok(r.out.every(x => !x.err), 'every candidate makes an OpenWAM case ' + r.out.filter(x => x.err).map(x => x.label + ': ' + x.err).join('; '));
    ok(r.out.every(x => x.groups === 4), 'each case has the 8-4-1 first merge: 4 pairs');
    ok(r.out.every(x => Math.abs(x.toColl - x.total) < 1), 'valve to collector in the case equals the layout\'s tuned length (' + r.out.map(x => Math.round(x.toColl)).join(', ') + ' mm)');
    ok(/Optimise the Headers tab/.test(r.sec) && /needs the Exhaust Tuner program or the Fusion panel/.test(r.sec), 'the section is there; in a browser it says it needs the desktop program');
    const exe = openwam();
    if (fs.existsSync(exe)) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opt_ui_'));
      fs.writeFileSync(path.join(dir, 'opt.wam'), r.out[0].text);
      const run = spawnSync(exe, ['opt.wam'], { cwd: dir, encoding: 'utf8', timeout: 600000 });
      const log = (run.stdout || '') + (run.stderr || '');
      ok(/SIMULATION FINISHED CORRECTLY/.test(log) && fs.existsSync(path.join(dir, 'optAVG.DAT')), 'the as-designed 8-4-1 case runs in OpenWAM');
      fs.rmSync(dir, { recursive: true, force: true });
    } else skipPart('no OpenWAM build at ' + exe + ' (EXHAUST_TUNER_OPENWAM), the case is not run');
  }
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
