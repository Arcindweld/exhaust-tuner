// Audit 3 (docs/BOOST_AUDIT_2026-11-12.md Part 2, X7): two new exhaust cases for xflow.py, not the merge's own.
//   node tools/validation/boost/xflow_page2.js > /tmp/xflow_page2.json      (from the checkout's root; Playwright needed)
//   python3 tools/validation/boost/xflow.py /tmp/xflow_page2.json path/to/cantera/data/gri30.yaml
// case1 (named so for xflow.py's gas line): NEAR CHOKING. The turboguide case A build (450 hp, PT5862 0.63 A/R 4-bolt, Use
//   these sizes), downpipe 609.6 mm no bends, no converter, the chamber muffler 152.4 mm on a 53.848 mm pipe, the Sound tab's
//   pipe 57.15 mm OD (2.25 in, 1.651 mm wall) 2500 mm from the turbine, still 30 °C air, oxidised, CAF 1: the tip leaves at
//   Mach 0.956 (2.0 in OD chokes).
// case2: the same build with two 90° bends in the downpipe, the plug muffler (150 mm perforate, 20% open) on the 72.898 mm
//   pipe, the Sound tab's pipe 63.5 mm OD (a sudden contraction after the muffler), painted black, 100 mph across,
//   Wendland's factors.
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: [path.join(__dirname, '../../../web'), process.cwd()] }));
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await pg.goto('file://' + path.join(__dirname, '../../../web/index.html') + '#intake'); await pg.waitForTimeout(900);
  const setv = async (id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await pg.waitForTimeout(120); };
  const tso = async (k, v) => { await pg.evaluate(([k, v]) => { const el = document.querySelector('select.tsox[data-k="' + k + '"]'); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]); await pg.waitForTimeout(150); };
  await pg.click('#u-met'); await pg.waitForTimeout(300);
  await setv('i-ind', 'turbo'); await pg.waitForTimeout(300); await setv('i-hp', '450');
  await pg.evaluate(() => { document.body.classList.add('expert'); document.body.classList.remove('simple'); });
  const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862')));
  await tso('turbo', String(ti));
  const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.outlet === '4-bolt'), ti);
  await tso('hs', String(hs)); await pg.click('button[data-tsuse]'); await pg.waitForTimeout(300);
  await setv('s-ind', 'turbo1'); await setv('m-dp', '53.848'); await setv('s-od', '57.15'); await setv('s-len', '2500'); await setv('i-xcat', 'none'); await setv('i-dpb', '0');
  const grab = () => pg.evaluate(() => { const T = window.__tsx, X = T.last(), G = X.G, m = X.X;
    const st = s => s && { p: s.p, p0: s.p0, M: s.M, T: s.T, T0: s.T0, v: s.v, rho: s.rho };
    return { o: { me: G.me, nt: G.nt, xn: G.xn, t4: G.t4, dOut: G.dOut, d: G.d, L: G.L, n90: G.n90, xb: G.xb, tail: G.tail, cool: G.cool, stepCone: G.stepCone,
        muf: G.muf && { kind: document.getElementById('i-xmuf').value, d: G.muf.d, n: G.muf.n, items: G.muf.items.map(i => i.kind), dch: T.mufInputs().dch, por: T.mufInputs().por, plugL: T.mufInputs().plugL } },
      R: T.EXH_GAS.R, page: { bp: m.bp, bp0: m.bp0, choke: m.choke || null, T0tip: m.T0tip, Q: m.Qlost, rows: m.rows.map(r => ({ k: r.k, d: r.d, d1: r.d1, d2: r.d2, dp: r.dp, dp0: r.dp0, sIn: st(r.sIn), sOut: st(r.sOut), K: r.K, alpha: r.t && r.t.alpha })) },
      steps: { v0: m.S.v0, v1: m.S.v1, v2: m.S.v2, v3: m.S.v3, v4: m.S.v4 } }; });
  const out = { case1: await grab() };
  await setv('i-dpb', '2'); await setv('i-xmuf', 'plug'); await setv('m-dp', '72.898'); await setv('m-plugl', '150'); await setv('m-por', '20'); await setv('s-od', '63.5');
  await setv('i-xfin', 'black'); await setv('i-xv', '44.704'); await setv('i-xcaf', 'w'); await pg.waitForTimeout(300);
  out.case2 = await grab();
  console.log(JSON.stringify(out, null, 1));
  await b.close();
})();
