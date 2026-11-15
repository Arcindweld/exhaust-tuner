// The fuel on the page (2026-11-14, docs/WAVE_VALIDATION_2026-11-11.md part 11): one fuel for the build (Intake tab,
// Engine: Fuel) used by the steady sections and the simulation's spec.   node tests/fuelpage_ui.js   (from web/)
// Hand arithmetic (DOE/GO-102016-4854 Table 2 specific gravities: ethanol 0.794, gasoline 0.75 taken):
//   E85 by mass 0.85 x 0.794 / (0.85 x 0.794 + 0.15 x 0.75) = 0.857125; E70 0.7 x 0.794 / (0.7 x 0.794 + 0.3 x 0.75) = 0.711893
//   stoichiometric A/F by mass: w x 9.0004 (ethanol: 3 x 138.2113 / 46.06844) + (1 - w) x 14.5964 (CH1.87: 1.4675 x 138.2113 / 13.8955)
//   the A/F field's 12 read as gasoline's lambda: 12 / 14.5964 = 0.82212; E85: 0.82212 x 9.7998 = 8.0566
// Checks: the default is the page's gasoline exactly (the stoichiometric exhaust gas, the A/F field as typed, the spec
// unchanged); E85 changes the A/F used, the exhaust gas (R, cp, gamma, sound speed, density) and the turbine balance's
// exhaust flow and temperature after the turbine, each against the hand sum; the ethanol field and a typed lambda; back
// to pump gasoline gives the earlier numbers to the last digit; a project saved before (op_legacy_k24.json) loads as the
// page's gasoline whatever fuel was picked; the note in both unit systems.
const { chromium } = require('playwright');
const fs = require('fs');
const { reads, settle } = require('./settle');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const pg = await ctx.newPage(); reads(pg);
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900); await settle(pg);
  const setv = async (id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await settle(pg); };
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
  await settle(pg); await setv('i-ind', 'turbo');
  const AIRM = 3.7279 * 28.0134 + 31.9988 + 0.04459 * 39.948, stE = 3 * AIRM / 46.06844, stG = 1.4675 * AIRM / (12.0107 + 1.87 * 1.00794);
  const mass = v => v * 0.794 / (v * 0.794 + (1 - v) * 0.75), st = w => w * stE + (1 - w) * stG;
  const TB = { ma: 0.4, t1: 25, t2: 180, tit: 950, p3: 300000, p4: 130000, eta: 0.75 };
  const read = () => pg.evaluate(TB => { const F = window.__fuel, P = F.page(), E = F.exh(), a = F.afr(), T = 773.15, c = E.hi && T > 1000 ? E.hi : E.lo, cpR = c[0] + T * (c[1] + T * (c[2] + T * (c[3] + T * c[4])));
    return { k: P.k, legacy: P.legacy, afr: a, lamB: P.lamB, stoich: P.stoich, eth: P.eth, R: E.R, on: E.on, same0: E.same0, g500: cpR / (cpR - 1), sos500: F.sos(500), rho500: F.rho(500, 101325),
      tb: F.tb(Object.assign({ afr: a }, TB)), spec: F.spec({ afr: 12.8 }), note: document.getElementById('i-fuel-out').textContent, fuelHidden: document.getElementById('i-fuel-wrap').hidden, ethHidden: document.getElementById('i-eth-wrap').hidden }; }, TB);
  const r0 = await read();
  ok(r0.k === 'pump' && r0.legacy && !r0.fuelHidden && r0.ethHidden && r0.afr === 12 && r0.same0 && !r0.on && Math.abs(r0.R - 286.629) < 1e-3 && !('blend' in r0.spec) && r0.spec.afr === 12.8 && !('evap' in r0.spec),
    'default: pump gasoline, the page\'s gasoline as before: A/F 12 as typed, the stoichiometric exhaust gas (R ' + r0.R.toFixed(3) + ' J/kg K, gamma ' + r0.g500.toFixed(4) + ' at 500 C), the simulation\'s spec unchanged; the Fuel field shown, the ethanol field hidden');
  ok(/as before/.test(r0.note) && /Knock is not modelled/.test(r0.note), 'the note: ' + r0.note.slice(0, 160));
  await setv('i-fuel', 'e85'); const r1 = await read();
  const w85 = mass(0.85), afr85 = 12 / stG * st(w85);
  ok(Math.abs(r1.eth - w85) < 1e-12 && Math.abs(r1.stoich / st(w85) - 1) < 1e-12 && Math.abs(r1.afr / afr85 - 1) < 1e-12 && !r1.ethHidden && r1.on,
    'E85 (85 % by volume = ' + w85.toFixed(6) + ' by mass): stoichiometric ' + st(w85).toFixed(4) + ':1 by hand, the A/F field\'s 12 read as gasoline\'s lambda ' + (12 / stG).toFixed(5) + ': A/F ' + afr85.toFixed(4) + ':1 by hand, page ' + r1.afr.toFixed(4));
  ok(Math.abs(r1.R - 305.56) < 0.02 && Math.abs(r1.sos500 / r0.sos500 - Math.sqrt(r1.g500 * r1.R / (r0.g500 * r0.R))) < 1e-12 && Math.abs(r1.rho500 - 101325 / (r1.R * 773.15)) < 1e-12,
    'E85\'s exhaust (its products at lambda 0.822): R ' + r1.R.toFixed(2) + ' J/kg K, gamma ' + r1.g500.toFixed(4) + ' at 500 C (the stoichiometric gasoline\'s ' + r0.g500.toFixed(4) + '), sound speed ' + r1.sos500.toFixed(1) + ' against ' + r0.sos500.toFixed(1) + ' m/s (' +
    (100 * (r1.sos500 / r0.sos500 - 1)).toFixed(2) + ' %), density p / (R T)');
  { const t = r1.tb, me = 0.4 * (1 + 1 / afr85), Wc = 0.4 * (1.4 * 287.05 / 0.4) * 155, t4 = 950 - Wc / (me * t.cpe), t0 = r0.tb;
    ok(Math.abs(t.me / me - 1) < 1e-12 && Math.abs(t.t4 - t4) < 1e-9 && t.cpe > t0.cpe && t.me > t0.me,
      'the turbine balance on E85 (0.4 kg/s of air, 25 -> 180 C, 950 C at the turbine): exhaust ' + t.me.toFixed(4) + ' kg/s = 0.4 x (1 + 1/' + afr85.toFixed(3) + ') (gasoline ' + t0.me.toFixed(4) + '), cp ' + t.cpe.toFixed(1) + ' J/kg K (' + t0.cpe.toFixed(1) + '), after the turbine ' + t.t4.toFixed(1) + ' C by hand ' + t4.toFixed(1) + ' (gasoline ' + t0.t4.toFixed(1) + '); pressure needed ' + (t.p3need / 1e3).toFixed(1) + ' kPa (' + (t0.p3need / 1e3).toFixed(1) + ')'); }
  ok(Math.abs(r1.spec.afr / (12.8 / stG * st(w85)) - 1) < 1e-12 && Math.abs(r1.spec.blend.eth - w85) < 1e-12 && !('evap' in r1.spec), 'the simulation\'s spec on E85: blend ' + r1.spec.blend.eth.toFixed(6) + ' ethanol by mass, A/F ' + r1.spec.afr.toFixed(4) + ' (the 4-Stroke tab\'s 12.8 read as lambda), evaporation not counted');
  ok(/8\.06:1/.test(r1.note) && /MJ\/kg/.test(r1.note) && /BTU\/lb/.test(r1.note) && /51 to 83 %/.test(r1.note), 'the note on E85 (both unit systems): ' + r1.note.slice(0, 220));
  await setv('i-evap', 'di'); const r1d = await read();
  ok(r1d.spec.evap === 0.7 && /70 % of the latent heat/.test(r1d.note) && /°F/.test(r1d.note), 'direct injection: evap 0.7 in the spec; the note gives the cooling in K and °F: ' + (r1d.note.match(/up to [^.]*/) || [''])[0]);
  await setv('i-evap', 'none');
  await setv('i-eth', '70'); const r2 = await read();
  ok(Math.abs(r2.eth - mass(0.7)) < 1e-12 && Math.abs(r2.stoich / st(mass(0.7)) - 1) < 1e-12, 'ethanol 70 % by volume: ' + r2.eth.toFixed(6) + ' by mass, stoichiometric ' + r2.stoich.toFixed(4) + ':1 by hand ' + st(mass(0.7)).toFixed(4));
  await setv('i-eth', ''); await setv('i-lam', '0.78'); const r3 = await read();
  ok(Math.abs(r3.afr / (0.78 * st(w85)) - 1) < 1e-12 && r3.lamB === 0.78, 'a typed lambda 0.78 on E85: A/F ' + r3.afr.toFixed(4) + ' = 0.78 x ' + st(w85).toFixed(4));
  await setv('i-lam', ''); await setv('i-fuel', 'pump'); const r4 = await read();
  ok(r4.same0 && !r4.on && r4.afr === 12 && Object.is(r4.sos500, r0.sos500) && Object.is(r4.rho500, r0.rho500) && JSON.stringify(r4.tb) === JSON.stringify(r0.tb) && JSON.stringify(r4.spec) === JSON.stringify(r0.spec),
    'back to pump gasoline: the exhaust gas, the sound speed, the density, the turbine balance and the spec are the default\'s to the last digit');
  // a project saved before this loads as the page's gasoline, whatever fuel the page had
  await setv('i-fuel', 'e85'); await setv('i-evap', 'di');
  const L = JSON.parse(fs.readFileSync(__dirname + '/fixtures/op_legacy_k24.json', 'utf8'));
  await pg.evaluate(d => window.__proj.apply(d), L.snap); await settle(pg); await pg.waitForTimeout(300); await settle(pg);
  const r5 = await read(), V = L.snap.vals, afrSaved = V['i-afr'] && V['i-afr'].b > 0 ? V['i-afr'].b : 12;
  ok(r5.k === 'pump' && r5.legacy && r5.same0 && r5.afr === afrSaved && !('evap' in r5.spec) && !('blend' in r5.spec), 'op_legacy_k24.json loaded over E85 with direct injection: pump gasoline, the A/F as saved (' + r5.afr + '), the stoichiometric exhaust, nothing added to the spec');
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close();
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
