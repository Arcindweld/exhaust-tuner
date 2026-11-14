// How much boost for my power (2026-11-14; docs/BOOST_AUDIT_2026-11-12.md, addendum "How much boost for my power").
// The K24A2 + Precision GEN2 PT5862 journey of operatingpoint_ui (0.63 A/R T3 / 4-bolt, Use these sizes, Use this
// intercooler, tubular manifold, 93 mm port spacing).   node tests/boostpower_ui.js   (from web/)
//
// Hand arithmetic (Garrett, Turbo Tech 103: Wa = HP x A/F x BSFC / 60 lb/min; MAP = Wa x 639.6 x (460 + Tm) /
// (VE x N/2 x Vd) psia; the K24A2: 2354 cc / 16.387064 = 143.650 cu in, 6800 RPM (Honda's peak power RPM, the preset)):
//   air per hp, A/F x BSFC lb per hp-hour (/ 60: lb/min per hp; x 0.45359237 / 60 x 1000 / 60: g/s per hp):
//     pump gasoline  12 x 0.55 = 6.60 lb/hp h = 0.11000 lb/min = 0.832 g/s per hp (9.09 hp per lb/min)
//     race gasoline  12 x 0.50 = 6.00 lb/hp h = 0.10000 lb/min = 0.756 g/s per hp (10.0 hp per lb/min)
//     E85            8.0 x 0.75 = 6.00 lb/hp h = 0.10000 lb/min = 0.756 g/s per hp
//   (a) Garrett's text figures (A/F 12, BSFC 0.55, VE 0.97 the middle of "95%-99% for modern 4-valve heads", Tm 130 F
//       the top of "100 - 130 degrees F" intercooled, atmosphere 14.696 psia):
//     MAP per hp = 0.11 x 639.6 x 590 / (0.97 x 3400 x 143.650) = 41510.04 / 473757.7 = 0.087619 psia per hp
//     350 hp: 30.667 - 14.696 = 15.97 psi; 450 hp: 39.428 - 14.696 = 24.73 psi; 550 hp: 48.190 - 14.696 = 33.49 psi
//   (b) the page's default now (pump gasoline, VE 0.97, the route's own intercooler-outlet air, iterated): pinned below
//       against the page; the page's earlier default (Garrett's conservative figures as typed: the VE field's 90 %) gave
//       18.53 / 29.52 / 40.95 psi, now (b) 15.84 / 25.91 / 36.38 psi, race gasoline and E85 12.72 / 21.74 / 31.10 psi.
//   (c) the wave simulation run at the point: its power follows the absolute manifold pressure, so for the target
//       boost = Pt x target x k / hp_sim - atmosphere, k = 1.04 to 1.16 (its stated bias).
// Checks: the air per hp by fuel; (a) by hand and (b) against the page; (c) the run at the 450 hp point started from the
// glance card in one click, its implied boost and the range that holds all three; the preset trap (a vehicle preset's
// stock power held: the build is worked at the boost field's 8 psi, the target asked inline, the hold ends when a target
// is typed); the crank / wheel selector; Garrett's conservative figures selectable and the default for projects saved
// before (op_legacy_k24.json loads with them and the same Garrett figures); both unit systems.
const { chromium } = require('playwright');
const fs = require('fs');
const { reads, settle } = require('./settle');
const PATM = 101325, PSI = 6894.757, CI = 2354 / 16.387064;
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const errs = [];
  async function open() {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const pg = await ctx.newPage(); reads(pg);
    pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900); await settle(pg);
    return { pg, ctx };
  }
  const setv = async (pg, id, v, ev) => { await pg.evaluate(([id, v, ev]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(ev || (el.tagName === 'SELECT' ? 'change' : 'input'), { bubbles: true })); }, [id, v, ev]); await settle(pg); };
  const chg = async (pg, s, v) => { await pg.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [s, v]); await settle(pg); };
  const pick = pg => pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); }).then(() => settle(pg));
  const OPof = pg => pg.evaluate(() => { const O = window.__op.OP(); return JSON.parse(JSON.stringify({ mode: O.mode, boost: O.boost, hp: O.hp, hpT: O.hpT, wa: O.wa, tmF: O.tmF, ve: O.ve, afr: O.afr, bsfc: O.bsfc, rpm: O.rpm, range: O.range, stock: O.stock, wheel: O.wheel, loss: O.loss, low: O.low,
    out: document.getElementById('i-opm-out').innerText, stockBox: !document.getElementById('i-hpstock').hidden, stockTxt: document.getElementById('i-hpstock-txt').innerText,
    hpField: document.getElementById('i-hp').value, boostHidden: document.getElementById('i-boost-wrap').hidden, dtlHidden: document.getElementById('i-dtl-wrap').hidden, fuelHidden: document.getElementById('i-fuel-wrap').hidden,
    hpLab: document.getElementById('i-hp-lab').textContent })); });
  const glance = pg => pg.evaluate(() => { const r = document.querySelector('#tg-glance tr[data-gl="power"]'); return r ? { v: r.querySelector('.gl-v').textContent, n: (r.querySelector('.gl-n') || {}).textContent || '', btn: !!r.querySelector('button[data-glsim]') } : null; });
  const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));

  // ---- 1. the preset trap: K24A2 (200 hp, naturally aspirated) switched to a turbo with "My power target"
  let { pg, ctx } = await open();
  await pick(pg);
  ok(await pg.evaluate(() => window.__op.preset()) === 200, 'the K24A2 preset holds its stock 200 hp in the power field');
  await setv(pg, 'i-ind', 'turbo');
  let O = await OPof(pg);
  ok(O.mode === 'boost' && O.stock && O.stock.hp === 200 && Math.abs(O.boost - 55.158) < 1e-6 && !O.boostHidden && O.stockBox && /stock 200 hp/.test(O.stockTxt) && /K24A2/.test(O.stockTxt) && /without boost/.test(O.stockTxt) && /Power target not typed yet/.test(O.out),
    'switched to a turbo with the stock figure still there: worked at the boost field’s 8 psi (' + O.boost.toFixed(3) + ' kPa) with the power worked out (' + O.hp.toFixed(1) + ' hp), the target asked for inline: ' + O.stockTxt.slice(0, 160));
  // the suggestion is a statement of the relation at 5 and 20 psi, by hand at the build's manifold air
  { const h = b => ((b + PATM / 1000) / 6.894757) * O.ve * O.rpm / 2 * CI / (639.6 * (460 + O.tmF)) * 60 / (O.afr * O.bsfc);
    const lo = Math.round(h(34.474)), hi = Math.round(h(137.895));
    ok(O.stockTxt.includes(lo + ' hp') && O.stockTxt.includes(hi + ' hp') && /5\.00 psi/.test(O.stockTxt) && /20\.00 psi/.test(O.stockTxt) && /not a recommendation/.test(O.stockTxt), 'the suggestion range is the relation at 5 and 20 psi: ' + lo + ' to ' + hi + ' hp (by hand), stated, not recommended'); }
  // typing the target in the inline box commits it (on change) and ends the hold
  await setv(pg, 'i-hptgt', '450', 'change');
  O = await OPof(pg);
  ok(O.mode === 'hp' && !O.stock && !O.stockBox && +O.hpField === 450 && O.boostHidden && await pg.evaluate(() => window.__op.preset()) === null, 'a target typed in the inline box goes to the power field (450), the hold ends and the boost is worked out (' + (O.boost / 6.894757).toFixed(2) + ' psi)');
  // picking the preset again holds its figure again; typing in the power field itself ends it too
  await setv(pg, 'i-ind', 'na'); await pick(pg); await setv(pg, 'i-ind', 'turbo');
  O = await OPof(pg); const held = O.mode === 'boost' && O.stockBox;
  await setv(pg, 'i-hp', '200'); O = await OPof(pg);
  ok(held && O.mode === 'hp' && !O.stockBox && O.hpT === 200, 'the preset picked again holds its figure; 200 typed in the power field is the builder’s: the boost is then worked out for it (' + (O.boost / 6.894757).toFixed(2) + ' psi)');
  await ctx.close();

  // ---- 2. the journey, 450 hp at the crank
  ({ pg, ctx } = await open());
  await pick(pg); await setv(pg, 'i-ind', 'turbo'); await setv(pg, 'i-hp', '450');
  const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await chg(pg, 'select.tsox[data-k="turbo"]', String(ti));
  const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti); await chg(pg, 'select.tsox[data-k="hs"]', String(hs));
  await pg.click('button[data-tsuse]'); await settle(pg);
  const ic = await pg.$('button[data-icuse]:not([disabled])'); if (ic) { await ic.click(); await settle(pg); }
  await setv(pg, 'i-mani', 'tube'); await setv(pg, 'i-msp', (93 / 25.4).toFixed(3));
  await pg.click('#tab-four'); await settle(pg); await pg.click('#tab-intake'); await settle(pg);
  O = await OPof(pg);
  const defs = await pg.evaluate(() => ['i-opfig', 'i-fuel', 'i-hpat'].map(id => document.getElementById(id).value).join());
  ok(defs === 'src,pump,crank' && !O.fuelHidden && O.dtlHidden && /at the crank/.test(O.hpLab), 'defaults: figures for the fuel and the head, pump gasoline, target at the crank (' + defs + '); the drivetrain loss is hidden until "the wheels" is picked');
  // air per hp by fuel, by hand, and as the page states it
  const fuels = await pg.evaluate(() => window.__op.fuel());
  const want = { pump: [12, 0.55, 6.6], race: [12, 0.5, 6.0], e85: [8, 0.75, 6.0] };
  ok(Object.entries(want).every(([k, [a, s, p]]) => fuels[k].afr === a && fuels[k].bsfc === s && Math.abs(fuels[k].afr * fuels[k].bsfc - p) < 1e-12),
    'A/F × BSFC by fuel: pump 12 × 0.55 = 6.60, race 12 × 0.50 = 6.00, E85 8.0 × 0.75 = 6.00 lb of air per hp-hour');
  ok(Math.abs(0.858 * 9.0 + 0.142 * 14.6 - 9.8) < 0.01 && Math.abs(8 / 9.8 - 12 / 14.7) < 0.003 && Math.abs(44.0 / 14.6 - 26.9 / 9.0) < 0.03,
    'E85: stoichiometric 0.858 × 9.0 + 0.142 × 14.6 = ' + (0.858 * 9.0 + 0.142 * 14.6).toFixed(2) + ', A/F 8.0 is λ ' + (8 / 9.8).toFixed(3) + ' (pump: 12 / 14.7 = ' + (12 / 14.7).toFixed(3) + '); heat per kg of air 44.0 / 14.6 = ' + (44 / 14.6).toFixed(2) + ' against 26.9 / 9.0 = ' + (26.9 / 9).toFixed(2) + ' MJ');
  ok(/6\.60 lb of air per hp-hour, 0\.1100 lb\/min \(0\.832 g\/s\) per hp/.test(O.out) && /VE 97% \(Garrett’s “95%-99% for modern 4-valve heads”, its middle/.test(O.out), 'the result names the air per hp and the VE with their sources: ' + O.out.slice(O.out.indexOf('For pump'), O.out.indexOf('For pump') + 170));
  // (b) by hand at the page's own manifold air
  const mapH = 49.5 * 639.6 * (460 + O.tmF) / (0.97 * 6800 / 2 * CI), bH = (mapH - PATM / PSI) * 6.894757;
  ok(O.mode === 'hp' && O.ve === 0.97 && O.afr === 12 && O.bsfc === 0.55 && rel(O.boost, bH) < 1e-9 && Math.abs(O.boost / 6.894757 - 25.912) < 0.005,
    '(b) 450 hp: ' + (O.boost / 6.894757).toFixed(3) + ' psi (' + O.boost.toFixed(2) + ' kPa) worked out, by hand ' + (bH / 6.894757).toFixed(3) + ' psi at the route’s ' + O.tmF.toFixed(2) + ' °F (was 29.52 psi at the VE field’s 90 %)');
  // (a) Garrett's text figures by hand
  const gA = hp => hp * 0.11 * 639.6 * 590 / (0.97 * 3400 * CI) - PATM / PSI;
  ok([[350, 15.97], [450, 24.73], [550, 33.49]].every(([h, v]) => Math.abs(gA(h) - v) < 0.005), '(a) Garrett’s text figures (A/F 12, BSFC 0.55, VE 97%, 130 °F): 350 / 450 / 550 hp need ' + [350, 450, 550].map(h => gA(h).toFixed(2)).join(' / ') + ' psi');
  // (b) for each fuel and Garrett's conservative figures as typed, against the page
  const tab = {};
  for (const [fig, fuel] of [['typed', 'pump'], ['src', 'pump'], ['src', 'race'], ['src', 'e85']]) {
    await setv(pg, 'i-opfig', fig); await setv(pg, 'i-fuel', fuel);
    for (const hp of [350, 450, 550]) { await setv(pg, 'i-hp', String(hp)); const o = await OPof(pg); tab[fig + ' ' + fuel + ' ' + hp] = o.boost / 6.894757; } }
  const pin = { 'typed pump 350': 18.532, 'typed pump 450': 29.522, 'typed pump 550': 40.945, 'src pump 350': 15.838, 'src pump 450': 25.912, 'src pump 550': 36.377,
    'src race 350': 12.724, 'src race 450': 21.741, 'src race 550': 31.099, 'src e85 350': 12.724, 'src e85 450': 21.741, 'src e85 550': 31.099 };
  const off = Object.keys(pin).filter(k => Math.abs(tab[k] - pin[k]) > 0.005);
  ok(!off.length, 'boost for 350 / 450 / 550 hp: Garrett’s conservative figures as typed ' + [350, 450, 550].map(h => tab['typed pump ' + h].toFixed(2)).join(' / ') + ' psi (the page before), pump gasoline ' + [350, 450, 550].map(h => tab['src pump ' + h].toFixed(2)).join(' / ') + ', race gasoline and E85 ' + [350, 450, 550].map(h => tab['src race ' + h].toFixed(2)).join(' / ') + (off.length ? '; off: ' + off.join(', ') : ''));
  await setv(pg, 'i-opfig', 'src'); await setv(pg, 'i-fuel', 'pump'); await setv(pg, 'i-hp', '450');

  // ---- 3. crank or wheels
  await setv(pg, 'i-hpat', 'wheel'); O = await OPof(pg);
  const hpC = 450 / (1 - 0.125), mapW = hpC * 6.6 / 60 * 639.6 * (460 + O.tmF) / (0.97 * 3400 * CI);
  ok(O.wheel && !O.dtlHidden && Math.abs(O.hpT - 514.2857142857) < 1e-6 && rel(O.boost, (mapW - PATM / PSI) * 6.894757) < 1e-9 && /at the wheels/.test(O.hpLab) && /514 hp \(384 kW\) at the crank \(450 hp \(336 kW\) at the wheels, 12\.5% drivetrain loss\)/.test(O.out),
    'at the wheels: 450 ÷ (1 − 0.125) = ' + O.hpT.toFixed(3) + ' hp at the crank, ' + (O.boost / 6.894757).toFixed(2) + ' psi; the loss field shows');
  // the range spreads by the loss, 2.5 points either side: at 10 % the low end, at 15 % the high end
  { const lo10 = 450 / 0.9 * 6.0 / 60 * 639.6 * (460 + Math.min(O.tmF, 100)) / (0.99 * 3400 * CI), hi15 = 450 / 0.85 * 7.2 / 60 * 639.6 * (460 + Math.max(O.tmF, 130)) / (0.95 * 3400 * CI);
    ok(rel(O.range.lo, (lo10 - PATM / PSI) * 6.894757) < 1e-9 && rel(O.range.hi, (hi15 - PATM / PSI) * 6.894757) < 1e-9, 'range at the wheels: ' + (O.range.lo / 6.894757).toFixed(2) + ' to ' + (O.range.hi / 6.894757).toFixed(2) + ' psi (by hand: 10 % loss, BSFC 0.50, VE 99 %, 100 °F; 15 %, 0.60, 95 %, ' + Math.max(O.tmF, 130).toFixed(0) + ' °F)'); }
  await setv(pg, 'i-dtl', '20'); O = await OPof(pg);
  ok(Math.abs(O.hpT - 562.5) < 1e-6, 'a typed 20 % loss: 450 ÷ 0.8 = ' + O.hpT.toFixed(2) + ' hp at the crank');
  await setv(pg, 'i-dtl', '12.5'); await setv(pg, 'i-hpat', 'crank'); O = await OPof(pg);
  ok(!O.wheel && O.hpT === 450 && Math.abs(O.boost / 6.894757 - 25.912) < 0.005, 'back to the crank: 450 hp, ' + (O.boost / 6.894757).toFixed(2) + ' psi');

  // ---- 4. (c) the simulation at this boost, one click on the glance card
  let G = await glance(pg);
  ok(G && G.btn && /No simulation at this boost yet/.test(G.n) && /target 450 hp \(336 kW\) at the crank \(typed\); boost 25\.91 psi \(178\.66 kPa\) at the throttle, worked out \(likely 18\.64 psi/.test(G.v), 'glance, before a run: ' + (G ? G.v : '?') + ' | the run is offered at this boost');
  await pg.click('#tg-glance tr[data-gl="power"] button[data-glsim]');
  let st = 'running'; for (let i = 0; i < 600 && st === 'running'; i++) { await pg.waitForTimeout(1000); st = await pg.evaluate(() => window.__tsim.state().status); }
  await settle(pg);
  const T = await pg.evaluate(() => { const T = window.__tsim.last(); return T ? { hp: T.sum.hp, rpm: T.sum.rpmHp, Pt: T.plan.Pt } : null; });
  O = await OPof(pg); G = await glance(pg);
  const loH = (T.Pt * 450 * 1.04 / T.hp - PATM) / 1000, hiH = (T.Pt * 450 * 1.16 / T.hp - PATM) / 1000;
  ok(st === 'done' && T && Math.abs(T.Pt - PATM - O.boost * 1000) < 1e-6, 'one click on the glance card runs the simulation at the worked-out boost (' + ((T.Pt - PATM) / PSI).toFixed(2) + ' psi): ' + (T ? T.hp.toFixed(1) + ' hp at ' + T.rpm + ' RPM' : '?'));
  ok(O.range.sim && rel(O.range.sim.lo, loH) < 1e-9 && rel(O.range.sim.hi, hiH) < 1e-9 && O.range.lo <= Math.min(O.range.gLo, loH) + 1e-9 && O.range.hi >= Math.max(O.range.gHi, hiH) - 1e-9 && O.range.lo < O.boost && O.range.hi > O.boost,
    '(c) the simulation implies ' + (loH / 6.894757).toFixed(2) + ' to ' + (hiH / 6.894757).toFixed(2) + ' psi for 450 hp (Pt × 450 × 1.04 to 1.16 ÷ its power, less the atmosphere); the range holds Garrett’s spreads (' + (O.range.gLo / 6.894757).toFixed(2) + ' to ' + (O.range.gHi / 6.894757).toFixed(2) + ') and it: ' + (O.range.lo / 6.894757).toFixed(2) + ' to ' + (O.range.hi / 6.894757).toFixed(2) + ' psi');
  ok(G && !G.btn && G.n.includes('The simulation says ' + Math.round(T.hp) + ' hp (') && G.n.includes(Math.round(T.hp / 1.16) + ' hp') && G.n.includes(Math.round(T.hp / 1.04) + ' hp') && /reads about 4 to 16 % high/.test(G.n) && /for the target it implies/.test(G.n) && /likely 1\d\.\d\d psi/.test(G.v),
    'glance after the run: ' + G.n.slice(G.n.indexOf('The simulation'), G.n.indexOf('The simulation') + 260));
  // in mm and kPa, the same row leads with kPa
  await pg.click('#u-met'); await settle(pg); G = await glance(pg); O = await OPof(pg);
  ok(/boost 178\.66 kPa \(25\.91 psi\)/.test(G.v) && /kPa \(\d+\.\d\d psi\) of boost/.test(G.n) && /°C \(\d+ °F\)/.test(O.out) && /g\/s/.test(O.out), 'metric: kPa first with psi beside it, °C first: ' + G.v);
  await pg.click('#u-imp'); await settle(pg);
  // "My boost" at the worked-out boost: the power range now holds the simulation's power over 1.16 to 1.04
  await setv(pg, 'i-opm', 'boost'); await setv(pg, 'i-boost', String(25.9118 + 0)); O = await OPof(pg);
  ok(O.mode === 'boost' && Math.abs(O.hp - 450) < 0.1 && (!O.range.sim || (O.range.lo <= T.hp / 1.16 + 1e-6 && O.range.hi >= T.hp / 1.04 - 1e-6)), 'my boost at the same point: ' + O.hp.toFixed(1) + ' hp, range ' + O.range.lo.toFixed(0) + ' to ' + O.range.hi.toFixed(0) + ' hp' + (O.range.sim ? ' (holds the simulation’s ' + (T.hp / 1.16).toFixed(0) + ' to ' + (T.hp / 1.04).toFixed(0) + ')' : ' (the run is for the earlier, unrounded boost)'));
  await ctx.close();

  // ---- 5. projects saved before: Garrett's conservative figures, the same results
  const L = JSON.parse(fs.readFileSync(__dirname + '/fixtures/op_legacy_k24.json', 'utf8'));
  ({ pg, ctx } = await open());
  await pg.evaluate(d => window.__proj.apply(d), L.snap); await settle(pg); await pg.waitForTimeout(300); await settle(pg);
  const lg = await pg.evaluate(() => { const G = window.__tg.TG().G; return { set: ['i-opm', 'i-opfig', 'i-hpat'].map(id => document.getElementById(id).value).join(), G: G ? { wa: G.wa, map: G.map, pr: G.pr } : null, stock: document.getElementById('i-hpstock').hidden }; });
  ok(lg.set === 'both,typed,crank' && lg.G && rel(lg.G.wa, L.G.wa) < 1e-7 && rel(lg.G.map, L.G.map) < 1e-7 && rel(lg.G.pr, L.G.pr) < 1e-7 && lg.stock,
    'op_legacy_k24.json loads with both typed, Garrett’s figures as typed, the target at the crank (' + lg.set + '): Garrett’s ' + (lg.G ? lg.G.wa.toFixed(3) + ' lb/min, ' + lg.G.map.toFixed(3) + ' psia' : '?') + ' as saved; no preset hold');
  // a project saved by the build before this in "My power target" (no i-opfig): its 29.52 psi, as worked out then
  await pg.evaluate(() => { const e = document.getElementById('i-opm'); e.value = 'hp'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await settle(pg);
  const snap = await pg.evaluate(() => { const s = window.__proj.snapshot('old hp'); delete s.vals['i-opfig']; delete s.vals['i-fuel']; delete s.vals['i-hpat']; delete s.vals['i-dtl']; delete s.vals['i-opve']; return s; });
  await ctx.close();
  ({ pg, ctx } = await open());
  await pg.evaluate(d => window.__proj.apply(d), snap); await settle(pg); await pg.waitForTimeout(300); await settle(pg);
  O = await OPof(pg);
  const handB = (ve, air) => (450 * air / 60 * 639.6 * (460 + O.tmF) / (ve * 3400 * CI) - PATM / PSI) * 6.894757;
  ok(O.mode === 'hp' && O.ve === 0.9 && O.bsfc === 0.55 && rel(O.boost, handB(0.9, 6.6)) < 1e-9 && await pg.evaluate(() => document.getElementById('i-opfig').value) === 'typed',
    'a project saved before this in "My power target" loads with Garrett’s figures as typed: ' + (O.boost / 6.894757).toFixed(3) + ' psi at VE ' + O.ve + ' (by hand at its ' + O.tmF.toFixed(1) + ' °F manifold air: ' + (handB(0.9, 6.6) / 6.894757).toFixed(3) + ')');
  const b0 = O.boost; await setv(pg, 'i-opfig', 'src'); O = await OPof(pg);
  ok(O.ve === 0.97 && rel(O.boost, handB(0.97, 6.6)) < 1e-9 && O.boost < b0, 'switched to the sourced figures it moves to VE 97 %: ' + (O.boost / 6.894757).toFixed(3) + ' psi (by hand ' + (handB(0.97, 6.6) / 6.894757).toFixed(3) + ')');
  await ctx.close();

  ok(!errs.length, 'no page or console errors' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  await b.close();
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
