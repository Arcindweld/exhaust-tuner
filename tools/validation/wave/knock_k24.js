// The knock estimate (docs/WAVE_VALIDATION_2026-11-11.md part 12): the K24A2 + Precision GEN2 PT5862 jobs of part 11's
// fuel_k24.js (the same journey through the page in Chromium), saved for knock_val.js: the spec the page ran, dx, and each
// speed's turbine and gate areas the closure found. Writes results/knock_k24_jobs.json.
// Run from web/:  node ../tools/validation/wave/knock_k24.js [psi list] [fuel:evap list]
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { reads, settle } = require(path.join(__dirname, '..', '..', '..', 'web', 'tests', 'settle'));
const boosts = (process.argv[2] || '10,18,25.9124').split(',').map(Number);   // psi as the field takes them (imperial display): 25.91 psi = 178.66 kPa (the 450 hp default), 18 psi
const cases = (process.argv[3] || 'pump:none,e85:port').split(',').map(s => s.split(':'));
(async () => {
  const b = await chromium.launch(); const out = [];
  const file = path.join(__dirname, 'results', 'knock_k24_jobs.json');
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
    await pg.click('button[data-tsim="run"]');
    let st = 'running'; for (let i = 0; i < 1200 && st === 'running'; i++) { await pg.waitForTimeout(1000); st = await pg.evaluate(() => window.__tsim.state().status); }
    const S = await pg.evaluate(() => { const T = window.__tsim.last(); if (!T) return null; const s = T.sum;
      return { spec: T.plan.spec, dx: T.plan.dx, Pt: T.plan.Pt, Tc: T.plan.Tc, hp: s.hp, rpmHp: s.rpmHp, rows: T.out.rows.map((r, i) => ({ rpm: r.rpm, At: r.At, Ag: r.Ag, below: !!r.below, short: !!r.short, hp: s.rows[i].tqB * r.rpm * Math.PI / 30 / 745.7, tqB: s.rows[i].tqB })) }; });
    out.push({ psi: kPa, fuel, evap, FP, status: st, S }); console.log(kPa, fuel, st, S && S.hp);
    fs.writeFileSync(file, JSON.stringify(out));
    await pg.context().close();
  }
  await b.close();
})();
