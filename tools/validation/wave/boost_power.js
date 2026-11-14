// How much boost for my power (docs/BOOST_AUDIT_2026-11-12.md, addendum of 2026-11-14), method (c): the page's own wave
// simulation with the turbo for the K24A2 + Precision GEN2 PT5862 (0.63 A/R T3 / 4-bolt, Use these sizes, Use this
// intercooler, tubular manifold, 93 mm port spacing) in "My boost" at typed boosts (psi), driven through the page in
// Chromium, one run each (about 25 s). Prints and writes results/boost_power.json: the run's peak brake power and RPM,
// air, BSFC, VE on the charge, the charge's absolute pressure and temperature, and Garrett's power at the same boost.
// Run from web/:  node ../tools/validation/wave/boost_power.js [15,22,29.52]
const { chromium } = require('playwright');
const fs = require('fs');
const { reads, settle } = require(require('path').join(__dirname, '..', '..', '..', 'web', 'tests', 'settle'));
const boosts = (process.argv[2] || '103.421,151.685,203.4').split(',').map(Number);
(async () => {
  const b = await chromium.launch(); const out = [];
  for (const psi of boosts) {
    const pg = reads(await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage());
    await pg.goto('file://' + require('path').join(__dirname, '..', '..', '..', 'web', 'index.html') + '#intake'); await pg.waitForTimeout(900); await settle(pg);
    const setv = async (id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await settle(pg); };
    const chg = async (s, v) => { await pg.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [s, v]); await settle(pg); };
    await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
      s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
    await settle(pg);
    await setv('i-ind', 'turbo'); await setv('i-opm', 'boost'); await setv('i-boost', String(psi)); await setv('i-hp', '');
    const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await chg('select.tsox[data-k="turbo"]', String(ti));
    const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti); await chg('select.tsox[data-k="hs"]', String(hs));
    await pg.click('button[data-tsuse]'); await settle(pg);
    const ic = await pg.$('button[data-icuse]:not([disabled])'); if (ic) { await ic.click(); await settle(pg); }
    await setv('i-mani', 'tube'); await setv('i-msp', (93 / 25.4).toFixed(3));
    const O = await pg.evaluate(() => { const O = window.__op.OP(); return { boost: O.boost, hp: O.hp, wa: O.wa, tmF: O.tmF, ve: O.ve, rpm: O.rpm }; });
    await pg.click('#tab-four'); await settle(pg);
    const t0 = Date.now(); await pg.click('button[data-tsim="run"]');
    let st = 'running'; for (let i = 0; i < 900 && st === 'running'; i++) { await pg.waitForTimeout(1000); st = await pg.evaluate(() => window.__tsim.state().status); }
    const S = await pg.evaluate(() => { const T = window.__tsim.last(); if (!T) return null; const s = T.sum, o = s.rows[s.ip];
      return { hp: s.hp, rpm: s.rpmHp, air: s.air, bsfc: s.bsfc, veC: o.veC, ve: o.ve, p3k: o.p3k, Pt: T.plan.spec.intake.source.p, Tc: T.plan.spec.intake.source.T, afr: T.plan.afr,
        rows: s.rows.map(r => ({ rpm: r.rpm, hp: r.tqB * r.rpm * Math.PI / 30 / 745.7, veC: r.veC, mAir: r.mAir })) }; });
    const rec = { psi, status: st, secs: (Date.now() - t0) / 1000, O, S }; out.push(rec); console.log(JSON.stringify(rec));
    fs.writeFileSync(require('path').join(__dirname, 'results', 'boost_power.json'), JSON.stringify(out, null, 1));
    await pg.context().close();
  }
  await b.close();
})();
