// The knock check on the page (2026-11-15, docs/WAVE_VALIDATION_2026-11-11.md part 12, L11), in Chromium: the K24A2 + PT5862
// build of part 11 (boost_power.js's journey) at 18 psi on pump gasoline, the turbo simulation run (about 40 s each, three runs):
//  1. by default the check is off: no knock text in the results or on the glance card, no changed marker;
//  2. turned on (Advanced inputs, marked as changed): the results lead with the comparison (E85 against pump gas as a ratio
//     of absolute manifold pressure, Garrett's 1.46, the octane step, the charge-temperature under-reaction, the same
//     engine without boost inside / at / beyond the limit) with no boost, degree or horsepower figure in the line; the
//     absolute figures only inside the collapsed "Assumptions and raw numbers", each labelled as far too pessimistic under
//     boost; the safety caveat; the glance card's Power row carries the short line and the caveat;
//  3. every row of the run the same doubles with the check on as off;
//  4. a changed knock input marks the line as from earlier inputs; metric units: the raw boost figures in kPa first.
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { reads, settle } = require(path.join(__dirname, 'settle'));
(async () => {
  const b = await chromium.launch();
  const kPa = 18, fuel = 'pump', evap = 'none';
    {
    const pg = reads(await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage());
    await pg.goto('file://' + path.join(__dirname, '..', 'index.html') + '#intake'); await pg.waitForTimeout(900); await settle(pg);
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
    const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
    const runSim = async () => { await pg.click('#tab-four'); await settle(pg); await pg.click('button[data-tsim="run"]');
      let st = 'running'; for (let i = 0; i < 900 && st === 'running'; i++) { await pg.waitForTimeout(1000); st = await pg.evaluate(() => window.__tsim.state().status); }
      await settle(pg); return st; };
    const grab = () => pg.evaluate(() => { const T = window.__tsim.last(), el = document.getElementById('tsim-knock');
      return { K: T.sum.knock, head: el ? el.querySelector('p b').innerText : null, txt: el ? el.innerText : null, any: /Knock check/.test(document.getElementById('panel-four').innerText),
        rows: T.out.rows.map(r => [r.res.ve, r.res.imep, r.res.pmax, r.res.gimep, r.At, r.Ag]), na: T.out.na.map(r => [r.ve, r.imep]), plan: T.plan.knock }; });
    const glance = async () => { await pg.click('#tab-intake'); await settle(pg); return pg.evaluate(() => document.getElementById('tg-glance') ? document.getElementById('tg-glance').innerText : ''); };
    const mark = () => pg.evaluate(() => { const b = document.getElementById('i-kon').closest('.advbox'); return b ? b.querySelector('.advchg').textContent : null; });
    ok(await pg.evaluate(() => document.getElementById('i-kon').value) === 'off' && !/Knock check/.test(await mark()), '1 the knock check is off by default and not marked as changed');
    let st = await runSim(); const A = await grab(); const g0 = await glance();
    ok(st === 'done' && !A.txt && !A.any && !A.K && A.plan === null && !/Knock check|knock/i.test(g0), '1 off: no knock text in the simulation results or on the glance card, no knock summary');
    await setv('i-kon', 'on');
    ok(/changed: .*Knock check in the simulation/.test(await mark()), '2 on: marked as changed in the advanced box: ' + await mark());
    st = await runSim(); const B = await grab();
    ok(st === 'done' && B.head && /^Knock check \(estimate, a comparison\): E85 tolerates about [0-9.]+ to [0-9.]+ times the absolute manifold pressure of pump gasoline, 91 AKI at the same ignition timing/.test(B.head) && /Garrett’s own pump-gas against E85 example ran 1\.46 times/.test(B.head), '2 the line leads with the fuel comparison: ' + (B.head || '').slice(0, 220));
    ok(/5 more octane numbers allow about \d+% more absolute manifold pressure/.test(B.head) && /under-reacts to the charge temperature 2 to 8 times/.test(B.head) && /the same engine without boost on pump gasoline, 91 AKI is (inside|at|beyond) the knock limit at the page’s timing \(knock integral [0-9.]+ at/.test(B.head), '2 the octane step, the charge-temperature under-reaction and the same engine without boost (' + (B.K.na ? B.K.na.I.toFixed(2) + ' at ' + B.K.na.rpm : '-') + ')');
    ok(!/psi|kPa|\bhp\b|retard|°/.test(B.head.replace(/25 °F \(14 °C\)/, '')), '2 no boost, horsepower or degree figure in the line itself');
    const det = await pg.evaluate(() => { const d = document.querySelector('#tsim-knock details'); return d ? { s: d.querySelector('summary').textContent, open: d.open, li: [...d.querySelectorAll('li')].map(l => l.textContent) } : null; });
    const rawN = det ? det.li.filter(t => /reads far too pessimistic under boost in this model \(stock naturally aspirated engines land at the limit, boosted builds do not\): not usable as a limit$/.test(t)).length : 0;
    ok(det && det.s === 'Assumptions and raw numbers' && !det.open && rawN === 3 && det.li.some(t => /^Knock-limited boost at the page’s timing .*psi/.test(t)) && det.li.some(t => /^Timing retard that brings the integral to 1 .*hp/.test(t)), '2 the raw numbers only inside the collapsed list, each of the three labelled (' + rawN + ')');
    ok(/does not replace knock monitoring and a tuner/.test(B.txt) && /never set boost or timing from this line/.test(B.txt), '2 the safety caveat');
    const g1 = await glance(), gl = g1.split('\n').find(x => /Knock check/.test(x)) || '';
    ok(/Knock check \(estimate, a comparison\): E85 tolerates about/.test(g1) && /does not replace knock monitoring and a tuner/.test(g1) && !/Assumptions and raw numbers|Band/.test(g1), '2 the glance card\'s Power row: the short comparison and the caveat');
    ok(JSON.stringify(B.rows) === JSON.stringify(A.rows) && JSON.stringify(B.na) === JSON.stringify(A.na), '3 every row with the check on is the same doubles as with it off (and the run without boost)');
    await setv('i-kaki', '93'); await pg.click('#tab-four'); await settle(pg);
    const stale = await pg.evaluate(() => (document.getElementById('tsim-knock') || {}).innerText || '');
    ok(/inputs changed since this run/.test(stale), '4 a changed knock input marks the line as from earlier inputs');
    await setv('i-kaki', ''); await pg.click('#u-met'); await settle(pg); await pg.click('#tab-four'); await settle(pg);
    const M = await pg.evaluate(() => { const d = document.querySelector('#tsim-knock details'); return d ? [...d.querySelectorAll('li')].map(l => l.textContent).find(t => /^Knock-limited boost/.test(t)) : ''; });
    ok(/ kPa \([0-9.]+ psi\)/.test(M), '4 metric: the raw boost figures in kPa first: ' + (M || '').slice(0, 120));
    await b.close();
    console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); process.exit(fails.length ? 1 : 0);
  }
})();
