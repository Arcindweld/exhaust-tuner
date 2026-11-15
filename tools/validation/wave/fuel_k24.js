// The fuel as a property of the engine (docs/WAVE_VALIDATION_2026-11-11.md part 11, K7): the K24A2 + Precision GEN2 PT5862
// (0.63 A/R T3 / 4-bolt, Use these sizes, Use this intercooler, tubular manifold, 93 mm port spacing; the journey of
// boost_power.js) in "My boost" at typed boosts (psi), run through the page in Chromium for each fuel and evaporation setting,
// one simulation each (about 25-40 s). For the speed of peak brake power: power, torque, VE on the charge, the turbine area
// the closure found and the mean pressure before the turbine, the exhaust-valve outflow temperature, air and fuel flow;
// and the charge's temperature at intake valve closing from the same spec rerun in the page's JavaScript model at that
// speed with the found areas (runSpeed ends at cylinder 1's IVC; 12 cycles from cold). Writes results/fuel_k24.json.
// Run from web/:  node ../tools/validation/wave/fuel_k24.js [psi list] [fuel:evap list]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { reads, settle } = require(path.join(__dirname, '..', '..', '..', 'web', 'tests', 'settle'));
const boosts = (process.argv[2] || '25.9124,18').split(',').map(Number);   // psi as the field takes them (imperial display): 25.91 psi = 178.66 kPa (the 450 hp default), 18 psi
const cases = (process.argv[3] || 'pump:none,e10:port,e85:port,e85:none,e85:di').split(',').map(s => s.split(':'));
(async () => {
  const b = await chromium.launch(); const out = [];
  const file = path.join(__dirname, 'results', 'fuel_k24.json');
  for (const kPa of boosts) for (const [fuel, evap] of cases) {
    const pg = reads(await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage());
    await pg.goto('file://' + path.join(__dirname, '..', '..', '..', 'web', 'index.html') + '#intake'); await pg.waitForTimeout(900); await settle(pg);
    const setv = async (id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await settle(pg); };
    const chg = async (s, v) => { await pg.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [s, v]); await settle(pg); };
    await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
      s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
    await settle(pg);
    await setv('i-ind', 'turbo'); await setv('i-opm', 'boost'); await setv('i-boost', String(kPa)); await setv('i-hp', '');
    await setv('i-fuel', fuel); await setv('i-evap', evap);
    const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await chg('select.tsox[data-k="turbo"]', String(ti));
    const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti); await chg('select.tsox[data-k="hs"]', String(hs));
    const use = await pg.$('button[data-tsuse]:not([disabled])'); if (use) { await use.click(); await settle(pg); }   // disabled when no size needs changing
    const ic = await pg.$('button[data-icuse]:not([disabled])'); if (ic) { await ic.click(); await settle(pg); }
    await setv('i-mani', 'tube'); await setv('i-msp', (93 / 25.4).toFixed(3));
    const FP = await pg.evaluate(() => { const F = window.__fuel, P = F.page(); return { k: P.k, lamB: P.lamB, afrB: P.afrB, stoich: P.stoich, evap: P.evap, legacy: P.legacy, R: F.exh().R, afrUsed: F.afr() }; });
    await pg.click('#tab-four'); await settle(pg);
    const t0 = Date.now(); await pg.click('button[data-tsim="run"]');
    let st = 'running'; for (let i = 0; i < 1200 && st === 'running'; i++) { await pg.waitForTimeout(1000); st = await pg.evaluate(() => window.__tsim.state().status); }
    const S = await pg.evaluate(() => { const WS = window.__fuel.WS(), T = window.__tsim.last(); if (!T) return null; const s = T.sum, o = s.rows[s.ip], sp = T.plan.spec;
      const row = T.out.rows.find(r => r.rpm === o.rpm) || T.out.rows[s.ip];
      const eng = WS.makeEngine(sp.e, sp.intake, sp.exhaust, sp.opt); WS.setTurbine(eng, row.At, row.Ag);
      const r = WS.runSpeed(eng, { rpm: row.rpm, cycles: 12, dx: T.plan.dx }), c = r.state.cyls[0];
      const tqPk = s.rows.reduce((a, q) => q.tqB > a.tqB ? q : a, s.rows[0]);
      return { hp: s.hp, rpm: s.rpmHp, tqB_Nm: o.tqB, tqPk_Nm: tqPk.tqB, tqPkRpm: tqPk.rpm, air: s.air, bsfc: s.bsfc, veC: o.veC, ve: o.ve, afr: T.plan.spec.e.afr, blend: T.plan.spec.e.blend || null, evap: T.plan.spec.e.evap,
        Pt: sp.intake.source.p, Tc: sp.intake.source.T, At: row.At, Ag: row.Ag, p3: row.res.turb ? row.res.turb.p3 : null, T3: row.res.turb ? row.res.turb.T3 : null, tEx: row.res.tEx, mAir: row.res.turb ? row.res.turb.mAir : null,
        rerun: { ve: r.ve, imep: r.imep, Tivc: c.T, pIvc: c.p, resid: 1 - c.x } }; });
    const rec = { psi: kPa, kPa: kPa * 6.894757, fuel, evap, FP, status: st, secs: (Date.now() - t0) / 1000, S }; out.push(rec); console.log(JSON.stringify(rec));
    fs.writeFileSync(file, JSON.stringify(out, null, 1));
    await pg.context().close();
  }
  await b.close();
})();
