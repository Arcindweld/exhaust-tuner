// The knock check on the page (2026-11-15, docs/WAVE_VALIDATION_2026-11-11.md part 12), in Chromium: the K24A2 + PT5862
// build of part 11 (boost_power.js's journey) at 18 psi on pump gasoline, the turbo simulation run (about 40 s each, three runs):
//  1. the results' "Knock check (estimate)" line: the fuel and its octane number, the boost in both units, beyond or inside
//     the limit, the retard and its cost, the knock-limited boost for pump gas and E85, the band, the caveat (knock
//     monitoring and a tuner), the assumptions one click away; the numbers the same as the run's own knock summary;
//  2. the glance card's Power row carries the short line and the caveat;
//  3. an advanced input (the pump's octane) shows the changed marker and marks the line as from earlier inputs; run again,
//     the 93 AKI pump gas sits closer to the limit than 91;
//  4. the check off: no line, and every row's results the same doubles as with it (the trace changes nothing);
//  5. metric units: the boost in kPa first.
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
      return { K: T.sum.knock, txt: el ? el.innerText : null, rows: T.out.rows.map(r => [r.res.ve, r.res.imep, r.res.pmax, r.res.gimep, r.At, r.Ag]), plan: T.plan.knock }; });
    let st = await runSim(); const A = await grab();
    ok(st === 'done' && A.txt && /^Knock check \(estimate\): on pump gasoline, 91 AKI \(octane number 95\.0\) at 18\.00 psi \(124\.11 kPa\) boost this build is (beyond|inside) the knock limit/.test(A.txt), '1 the line: ' + (A.txt || '').slice(0, 200));
    const K = A.K, r1 = K.ret && K.ret[1];
    ok(K.I > 1 && r1 && !r1.none && A.txt.indexOf('retarding the timing about ' + Math.round(r1.deg) + '°') > 0 && A.txt.indexOf('(' + (100 * r1.loss).toFixed(0) + '%)') > 0,
      '1 beyond at 18 psi on 91 (integral ' + K.I.toFixed(2) + ' at ' + K.rpm + ' RPM), the retard ' + (r1 ? r1.deg.toFixed(1) : '?') + ' deg and its cost ' + (r1 ? (100 * r1.loss).toFixed(1) : '?') + ' % as the run\'s summary says');
    ok(K.lim.length === 2 && K.lim[1].g[1] > K.lim[0].g[1] && /knock-limited boost for pump gasoline, 91 AKI near .* and for E85 near /.test(A.txt), '1 the knock-limited boost: pump ' + (K.lim[0].g[1] / 6894.757).toFixed(2) + ' psi, E85 ' + (K.lim[1].g[1] / 6894.757).toFixed(2) + ' psi');
    ok(/Band \(knock taken at an integral of 0\.7 to 1\.3 instead of 1\)/.test(A.txt) && /does not replace knock monitoring and a tuner/.test(A.txt) && /never set boost or timing from this line/.test(A.txt) && /pessimistic/.test(A.txt), '1 the band, the caveat and the pessimism under boost are stated');
    const det = await pg.evaluate(() => { const d = document.querySelector('#tsim-knock details'); return d ? { s: d.querySelector('summary').textContent, open: d.open, li: d.querySelectorAll('li').length, txt: d.innerText } : null; });
    ok(det && det.s === 'Assumptions of the knock check' && !det.open && det.li >= 6, '1 the assumptions one click away (' + (det ? det.li : 0) + ' items, closed)');
    await pg.click('#tab-intake'); await settle(pg);
    const gl = await pg.evaluate(() => [...document.querySelectorAll('.glance td')].map(x => x.innerText).find(x => /Knock check/.test(x)) || null);
    ok(gl && /Knock check \(estimate\): on pump gasoline/.test(gl) && /does not replace knock monitoring and a tuner/.test(gl) && gl.indexOf('Band') < 0, '2 the glance card\'s Power row carries the short line and the caveat');
    await setv('i-kaki', '93');
    const mark = await pg.evaluate(() => { const b = document.getElementById('i-kaki').closest('.advbox'); return b ? b.querySelector('.advchg').textContent : null; });
    ok(mark && /Pump gasoline octane at the pump/.test(mark), '3 the changed marker: ' + mark);
    await pg.click('#tab-four'); await settle(pg);
    const stale = await pg.evaluate(() => (document.getElementById('tsim-knock') || {}).innerText || '');
    ok(/inputs changed since this run/.test(stale), '3 the line says its inputs changed since the run');
    st = await runSim(); const B = await grab();
    ok(st === 'done' && B.K.I < A.K.I && /91|93/.test(B.txt) && /93 AKI \(octane number 97\.0\)/.test(B.txt) && JSON.stringify(B.rows) === JSON.stringify(A.rows), '3 at 93 AKI (ON 97) the integral ' + B.K.I.toFixed(3) + ' < ' + A.K.I.toFixed(3) + ', the rows unchanged');
    await setv('i-kon', 'off'); st = await runSim(); const C = await grab();
    ok(st === 'done' && !C.txt && !C.K && C.plan === null && JSON.stringify(C.rows) === JSON.stringify(A.rows), '4 the check off: no line, no knock summary, every row the same doubles as with it');
    await setv('i-kon', 'on'); await setv('i-kaki', '');
    st = await runSim(); await pg.click('#u-met'); await settle(pg);
    const M = await pg.evaluate(() => (document.getElementById('tsim-knock') || {}).innerText || '');
    ok(/at 124\.11 kPa \(18\.00 psi\) boost/.test(M) || /at 124\.1 kPa \(18\.0+ psi\) boost/.test(M), '5 metric: ' + M.slice(0, 140));
    await b.close();
    console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); process.exit(fails.length ? 1 : 0);
  }
})();
