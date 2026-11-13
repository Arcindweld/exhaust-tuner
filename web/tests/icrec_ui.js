// Recommended intercooler and turbo for the build (Intake tab, Intercooler options / Turbo options, 2026-11-12).
//   node tests/icrec_ui.js   (from web/)
//
// The rules (stated on the page, coded in icRecommend / turboRecommend):
//   intercooler (a) maker's rating (the lower figure where two are stated) >= margin x target per core; (b) tank necks not smaller
//   than the recommended charge pipe OD (unknown: flagged, not rejected); (c) Bell's face area, air-to-air, a flag only; (d) a row
//   with a thermal point must remove >= margin x the heat the target effectiveness needs (UA held). Order: rating, published drop
//   at this flow, core volume, exact tank match, published data, list order.
//   turbo: not flagged in the table (below / far larger), rating >= margin x target per turbo; smallest rating, then smaller
//   compressor inducer, then a maker with a lower figure.
//
// Build: Honda K24A2 from the engine list, single turbo, 15 psi. The tab's airflow at that boost is the same for every power target
// (the targets below change the ratings compared, not the flow); the recommended charge pipes are 2.5 in (63.5 mm) OD hot and cold.
//
// Ratings in the list (from the makers' pages read 2026-11-12):
//   air-to-air: Garrett 300, 310, 375, 410, 425, 450, 475, 500, 510, 550, 600 (x4), 660, 750 (x5), 785, 800 (x2), 900, 925, 950 (x2),
//   1000, 1100, 1260, 1275; Mishimoto MMINT-UZ none, UG 700, US 800, UM min(800, 600 whp) = 600, UR 1000; CSF 8056 700, 8047 850,
//   8053 800, 8045 1000, 8046 1200, 8068 800, 8063 850, 8067 850, 8174 900, 8048 1000, 8173 1000, 8054 1100, 8040 1300, 8055 1400.
//   water-to-air: Garrett 500, 750, 980, 1000; Mishimoto W3 1000, W4 1500; CSF 8134 800, 8113 1000, 8084 1000, 8085 1500, 8086 2000;
//   EJ Bowman typical engine power 50, 90, 120, 175, 280, 365 kW = 67.05, 120.69, 160.92, 234.68, 375.49, 489.47 hp (÷ 0.7457).
//
// Air-to-air order (reviewer, 2026-11-12): among rows passing (a) and (b), first those whose charge face meets Bell's face for the
//   target x margin, then face unknown, then failing; within each group the old order. Bell face = 6 in² per 100 hp / 0.45 =
//   13.33 in² per 100 hp. Charge face: Garrett height (no flow) x width (cold flow); Mishimoto core height x thickness; CSF height x
//   width, or length x width on its vertical-flow rows (assumptions). Faces of the rows that matter (in²):
//   Garrett 703521-6003 (375) 12.3 x 4.5 = 55.35; 703518-6016 (410) 8.0 x 3.0 = 24; 703520-6025 (425) 8.0 x 3.5 = 28;
//   848054-6013 (450) 8.6 x 5.5 = 47.30; 703518-6018 (475) 6.4 x 3.0 = 19.2; 848054-6037 (750, vertical, Garrett labels L as hot flow)
//   24.0 x 3.5 = 84; 858893-6001 (750) 22.1 x 4.0 = 88.4; 703522-6008 (750) 11.2 x 4.5 = 50.4; 848054-6015 (750) 9.4 x 5.3 = 49.82;
//   703522-6004 (785) 12.1 x 4.5 = 54.45; 703520-6011 (800) 10.5 x 3.5 = 36.75; 848054-6020 (800) 7.8 x 4.3 = 33.54;
//   848054-6039 (1100) 22.4 x 4.5 = 100.8; 701596-6001 (1260) 12.7 x 5.1 = 64.77; 858893-6003 (1275) 22.1 x 4.5 = 99.45;
//   Mishimoto UG (700) 11.75 x 2.76 = 32.43, US (800) 12 x 3 = 36, UR (1000) 12 x 4 = 48; CSF 8056 (700) 12 x 3 = 36, 8053 (800, vertical)
//   24 x 3.5 = 84, 8068 (800, vertical) 27 x 3 = 81, 8063 (850) 12 x 4 = 48, 8054 (1100, vertical) 27 x 4.5 = 121.5, 8040 (1300) 12 x 6 = 72,
//   8055 (1400, vertical) 27 x 6 = 162.
// Bell Intercoolers cores (catalogue and item pages, 2026-11-12; Bell rates CFM at 1 psi loss and 10 psig; hp = CFM / 1.5, Corky Bell's
//   1.5 cfm per hp, the page's conversion; charge face A x B, Bell's diagrams): A350097240 455 CFM -> 303.3 hp, 3.5 x 9.7 = 33.95 in²;
//   A350130240 609 -> 406.0, 45.5; A350143240 670 -> 446.7, 50.05; A350169240 792 -> 528.0, 59.15; A300227240 912 -> 608.0, 3 x 22.7 = 68.1;
//   A350240240 1125 -> 750.0, 84; A350280240 1312 -> 874.7, 98. Each publishes a drop (1 psi at its rated CFM), so it wins a rating tie.
// Build 1, 350 hp, air-to-air, margin 1: Bell face 46.67 in². Rated >= 350 and passing Bell, by rating: 703521-6003 (375, 55.35),
//   Bell A350143240 (446.7, 50.05), 848054-6013 (450, 47.30). (Bell A350130240, 406, face 45.5: fails Bell's face, a later group.)
//   Out: 848054-6012 (300), 703518-6015 (310), MMINT-UZ (no rating), Bell A350097240 (303.3) = 4. Margin 1.2 (420 hp, Bell face 56 in²):
//   Bell A350169240 (528, 59.15), A300227240 (608, 68.1), A350240240 (750, 84: ties Garrett 848054-6037 at 750 and 84 in², ahead on its
//   published drop); out 7 (adds 375, 410 and Bell A350130240 at 406).
//   Own core 380 hp, 600 x 300 x 102 mm (23.62 x 11.81 x 4.016 in): face 11.81 x 4.016 = 47.43 >= 46.67 -> second, ahead of Bell 446.7.
// Build 3, 800 hp, air-to-air, margin 1: Bell face 106.67 in². Passing: CSF 8054 (1100, 121.5), CSF 8055 (1400, 162), both only on the
//   vertical-flow assumption; then the failing group by rating and volume: CSF 8068 (800, 486 cu in; 81 in², 25.67 in² short).
//   MMINT-UM out (600 whp is its lower figure).
// Nothing passes Bell: 1300 hp air-to-air, Bell face 173.33 in²: >= 1300 are CSF 8040 (72) and 8055 (162) -> 8040 by rating, with
//   "no listed core meets Bell's face area" and 101.3 in² short.
// Size limit 610 x 305 x 89 mm (24.02 x 12.01 x 3.504 in; length and height may swap; Mishimoto checked on its overall size with
//   tanks, Garrett and CSF on the core): at 450 hp the rows covering 450 that fit are Garrett 475 (19.2), 500 (22.4), 510 (31.5), 600
//   487085-6002 (33.6), 600 703520-6010 (28), 750 848054-6037 (84), 800 703520-6011 (36.75); CSF 8056 (36), 8047 (42), 8053 (84), 8067 (36);
//   largest face first: 848054-6037 and CSF 8053 tie at 84 -> rating -> 848054-6037, CSF 8053, then CSF 8047 (42). Mishimoto US
//   (overall 31 in) does not fit. Limit 610 x 305 x 77 mm (thickness 3.031 in): 3 in cores only: CSF 8056 (36, 700) and 8067
//   (36, 850) tie -> 8056, 8067, then 487085-6002 (33.6).
// Water-to-air order (reviewer, 2026-11-12): on the evidence. Rows passing the rating and tank checks are grouped: 0 thermal data
//   (a maker's curve or point) evaluated at this build's flow that meets the target inside the data's flow range (a single point:
//   within +-10% of its charge flow); 1 meets it only by extrapolation; 2 rating only. Groups 0 and 1 by the smallest capacity
//   margin (heat removed / heat needed), then drop at this flow, volume, weight, rating; group 2 by rating, drop, volume.
//   This build (15 psi): charge mc = 0.28247 kg/s (from the route), t2 = 134.33 °C, coolant in at the outside 25 °C (no coolant
//   temperature entered), maker's coolant flows (none entered), target 75% -> heat needed 0.75 x mc x cp x (t2 - 25), so the
//   capacity margin of a core with effectiveness e on Cmin = Ch is e / 0.75 (the coolant is always the larger stream here).
//   Conflux 100011 (0.20-0.40 kg/s plotted: inside): UA by linear interpolation of the UA inverted (here, exact series) at 0.25 and
//   0.30 kg/s; Ch = 0.28247 x 1004.675 = 283.79 W/K, Cc = 0.34 x 3917 = 1331.78 W/K -> e about 0.801, margin about 1.068 -> group 0.
//   Conflux 100012 (0.40-0.60) and 100013 (0.60-0.80): outside, UA by the power law fitted (here) to the five UA values -> margins
//   about 1.225 and 1.306, group 1. Bowman JK190: 0.28247 / (30.1/60) = 0.563 x its point's flow, UA held -> margin about 1.319,
//   group 1. The rest (Garrett 717874-6009 500 hp, 717874-6008 750, CSF 8134 800, ...) rating only, group 2.
//   Computed below and compared with the page: 450 hp: Conflux 100011, 100012, 100013 (then JK190, then the rating-only rows).
//   Size limit 305 x 150 x 305 mm (12.01 x 5.91 x 12.01 in), 450 hp: 100011 (140 x 133 x 155 mm) and 100012 (160 x 150 x 190) fit,
//   100013 (177 x 171: neither 177 nor 171 within 150) does not; Bowman out (size not published) -> 100011, 100012, then the
//   rating-only Garrett 717874-6009 (500).
// JK190 thermal gate, its point 30.1 kg/min, 180 -> 41.5 °C, 270 L/min water at 30 °C (water 992 kg/m³,
//   Out: the five smaller Bowman coolers. Margin 1.2 (540 hp, margin 1.2 on the heat too): JK190 (489.5) and Conflux 100011 (536.4) out
//   on rating; 100012 (1.225 >= 1.2) and 100013 (1.306), both group 1, then the rating-only Garrett 717874-6008 (750).
// Build 3, 800 hp, air-to-air, margin 1: rated exactly 800: Garrett 703520-6011 (24 x 10.5 x 3.5 = 882.0 cu in), 848054-6020
//   (26.3 x 7.8 x 4.3 = 882.102), CSF 8053 (24 x 6 x 3.5 = 504), CSF 8068 (27 x 6 x 3 = 486), Mishimoto MMINT-US (23 x 12 x 3 = 828,
//   3 in necks >= the 2.5 in pipes); MMINT-UM out (600 whp is its lower figure). No pressure drop is published for any of them,
//   so the core volume decides: CSF 8068, CSF 8053, MMINT-US.
// No core: 1500 hp air-to-air (largest listed 1400, CSF 8055). Specification, outside air 120 lb/min (0.907194 kg/s) at 25 °C:
//   Q = 0.75 x mc x 1004.675 x (t2 - 25), Ch = mc x cp, Cc = 120/132.277 x cp, eps = Q/(Cmin (t2 - 25)), NTU by the exact series;
//   Bell 6 x 1500/100 = 90 in² (580.6 cm²) of flow area, face 90/0.45 = 200 in² (1290.3 cm²).
// Turbo, 450 hp per turbo, margin 1: not flagged and >= 450: EFR 6758 (500), then the 550 hp pair by inducer G25-550 (48 mm),
//   GTX2867R GEN II (50 mm); margin 1.15 (517.5 hp): G25-550, GTX2867R GEN II, EFR 7163 (57 mm). 600 hp: PT5558 (650), G25-660 (660),
//   PT5862 (700).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const near = (a, w, tol, m) => ok(Number.isFinite(a) && Math.abs(a - w) <= tol * Math.abs(w), m + ': page ' + (Number.isFinite(a) ? +a.toPrecision(7) : a) + ', hand ' + w);
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  // pg.$eval / pg.$$eval read in one call after the page has stopped re-rendering (tests/settle.js; audit F1)
  require('./settle').reads(pg);
  await pg.goto('file://' + process.cwd() + '/index.html#intake'); await pg.waitForTimeout(900);
  const set = (id, v) => pg.evaluate(([id, v]) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const setx = async (k, v) => { await pg.evaluate(([k, v]) => { const e = document.querySelector('.tsox[data-k="' + k + '"]'); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]); await pg.waitForTimeout(350); };
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }; s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
  await set('i-ind', 'turbo'); await set('i-boost', '15'); await pg.waitForTimeout(300);
  const hp = async x => { await set('i-hp', String(x)); await pg.waitForTimeout(450); };
  const top = t => pg.$$eval('#tso-icrec-top-' + t + ' li', ls => ls.map(l => l.textContent.split(/[:(—]/)[0].trim()));
  const outN = t => pg.$$eval('#tso-icrec-out-' + t + ' li', ls => ls.length);
  const TSO = () => pg.evaluate(() => Object.assign({}, window.__tso.TSO));
  const rec = await pg.evaluate(() => window.__tso.rec());
  ok(Math.abs(rec.odh - 63.5) < 1e-6 && Math.abs(rec.odc - 63.5) < 1e-6, 'build: recommended charge pipes 63.5 mm (2.5 in) OD hot and cold (' + rec.odh + ', ' + rec.odc + ')');

  // Bell rows: figures and sources as read 2026-11-12
  const bellR = await pg.evaluate(() => window.__tso.IC_LIB.filter(c => c.maker === 'Bell Intercoolers').map(c => ({ pn: c.pn, abc: c.bellABC, cfm: c.cfm, hp: c.hp, lb: c.lb, price: c.price, src: c.src, dp: c.dp, face: window.__tso.icFace(c).a, pub: window.__tso.icPubN(c) })));
  const bellW = { A350097240: [[3.5, 9.7, 24], 455, 34, 'USD 496.00', '30005642'], A350130240: [[3.5, 13, 24], 609, 43, 'USD 626.00', '30005647'], A350143240: [[3.5, 14.3, 24], 670, 47, 'USD 678.00', '30005649'],
    A350169240: [[3.5, 16.9, 24], 792, 54, 'USD 780.00', '30005653'], A300227240: [[3, 22.7, 24], 912, 62, 'USD 990.00', '30005302'], A350240240: [[3.5, 24, 24], 1125, 73, 'USD 1060.00', '30005664'], A350280240: [[3.5, 28, 24], 1312, 84, 'USD 1218.00', '30005670'] };
  ok(bellR.length === 7 && bellR.every(r => { const w = bellW[r.pn]; return w && r.abc.join() === w[0].join() && r.cfm === w[1] && r.lb === w[2] && r.price === w[3] && r.src === 'https://bellintercoolers.com/i-' + w[4] + '-bar-and-plate-cores-air-cooled-peak-efficiency.html' &&
    Math.abs(r.hp - +(w[1] / 1.5).toFixed(1)) < 1e-9 && Math.abs(r.face - w[0][0] * w[0][1]) < 1e-9 && Math.abs(r.dp.kPa - 6.894757) < 1e-9 && Math.abs(r.dp.kgmin - +(w[1] * 0.028316846592 * 101325 / (287.05 * 298.15)).toFixed(4)) < 1e-9; }),
    'Bell rows: A x B x C, CFM, weight, price and item page as read; hp = CFM / 1.5; face A x B; 1 psi at the rated CFM (standard air, 1.1839 kg/m³)');
  // type not decided: one of each, and what decides
  await hp(350);
  ok(await pg.$('#tso-icrec-a2a') && await pg.$('#tso-icrec-w2a') && await pg.$('#tso-icrec-decide'), 'type not decided: an air-to-air and a water-to-air recommendation, and what decides between them');
  const dec = await pg.$eval('#tso-icrec-decide', e => e.innerText);
  ok(/Charge pipes: [0-9.]+ L \([0-9]+ cu in\), [0-9]+ ms/.test(dec) && /frontal opening/.test(dec) && /each litre \(0\.26 US gal\)/.test(dec) && /common practice, not a sourced rule/.test(dec), 'what decides: pipe volume and fill time, front area, hold time per litre, labelled as common practice');

  // build 1
  await setx('ictype', 'a2a');
  let t = await top('a2a'); ok(t.join() === 'Garrett 703521-6003,Bell Intercoolers A350143240,Garrett 848054-6013', 'build 1, 350 hp air-to-air, Bell first: ' + t.join(', '));
  ok(await outN('a2a') === 4, 'build 1: four not recommended (300, 310, no rating, Bell A350097240 at 303 hp)');
  const n1 = await pg.$eval('#tso-icrec-a2a', e => e.innerText);
  ok(/1\.07 × the target per core/.test(n1) && /core only: weld end tanks/.test(n1) && /Bell’s 47 in² \(301 cm²\)/.test(n1), 'build 1 pick: ratio 375/350 = 1.07, tank flag for a core sold without tanks, Bell face 6 x 350/100/0.45 = 46.7 in² (301.1 cm²)');
  ok(await pg.$('#tso-icrec-little-a2a') && /common workshop practice, not sourced claims/.test(await pg.$eval('#tso-icrec-little-a2a', e => e.innerText)), 'Garrett publishes 1 of 6 items: “little published data — check it in hand” with the workshop checklist, labelled');
  await setx('icm', '1.2');
  t = await top('a2a'); ok(t.join() === 'Bell Intercoolers A350169240,Bell Intercoolers A300227240,Bell Intercoolers A350240240', 'build 1, margin 1.2 (Bell face 56 in²): ' + t.join(', '));
  ok(await outN('a2a') === 7, 'build 1, margin 1.2: seven not recommended');
  await setx('icm', '1');

  // End tanks and mounting (Garrett, "Intercooler Sizing And End Tank Design With Rob Dahm", 2020): the block with its citation, and
  // the ducting check: a compressor outlet larger than the hot pipe (here 80 mm against the pipe's inside diameter) fires it
  let et = await pg.$eval('#tso-ic-tanks', e => e.innerText);
  const etH = await pg.$eval('#tso-ic-tanks', e => e.innerHTML);
  ok(/use the largest core that will fit within the packaging constraints/.test(et) && /starve the top tubes/.test(et) && /rubber isolation grommets/.test(et) && /8\.30 in² \(53\.5 cm²\)/.test(et) && /one-dimensional estimates/.test(et) &&
    etH.indexOf('garrettmotion.com/news/newsroom/article/intercooler-sizing-and-end-tank-design-with-rob-dahm') >= 0, 'End tanks and mounting: Garrett’s points with the article linked, the 1-D caveat, dual units');
  const cod0 = await pg.evaluate(() => document.getElementById('i-cod')._b), dh0 = await pg.evaluate(() => window.__tso.TG().route.dco.dh);
  await pg.evaluate(x => { const e = document.getElementById('i-cod'), u = e.parentNode.querySelector('em').textContent.trim(); e.value = String(u === 'in' ? x / 25.4 : x); e.dispatchEvent(new Event('input', { bubbles: true })); }, dh0 + 10); await pg.waitForTimeout(500);
  et = await pg.$eval('#tso-ic-tanks', e => e.innerText);
  const verdict = await pg.evaluate(() => window.__tso.TG().route.warn.join(' | '));
  ok(/is smaller than the compressor outlet/.test(et) && /the hot pipe \([0-9.]+ (mm|in) \(?[0-9.]* ?(in|mm)?\)? ?inside\) is smaller than the compressor outlet[^|]*should never be smaller than[^|]*in², [0-9.]+ against [0-9.]+ cm²/.test(verdict), 'a compressor outlet ' + (dh0 + 10).toFixed(1) + ' mm over the ' + dh0.toFixed(1) + ' mm hot pipe: the ducting check fires (verdict and block): ' + verdict);
  await pg.evaluate(x => { const e = document.getElementById('i-cod'), u = e.parentNode.querySelector('em').textContent.trim(); e.value = x == null || !Number.isFinite(x) ? '' : String(u === 'in' ? x / 25.4 : x); e.dispatchEvent(new Event('input', { bubbles: true })); }, cod0); await pg.waitForTimeout(400);
  ok(!(await pg.evaluate(() => window.__tso.TG().route.dco.bad)), 'back to the compressor outlet as it was: no ducting warning');
  // own core, recommended alongside the list: 380 hp, 63.5 mm necks -> second; 2 in necks -> out with the step loss
  for (const [k, v] of [['oName', 'Shop core A'], ['oL', '600'], ['oH', '300'], ['oW', '102'], ['oIn', '63.5'], ['oOut', '63.5'], ['oHp', '380']]) await setx(k, v);
  t = await top('a2a'); ok(t.join() === 'Garrett 703521-6003,Your core Shop core A,Bell Intercoolers A350143240', 'own core (380 hp, face 47.43 in²) ranks between 375 and 446.7: ' + t.join(', '));
  await setx('oIn', '50.8');
  const o2 = await pg.$eval('#tso-icrec-out-a2a', e => e.textContent);
  ok(/Shop core A: inlet neck 50\.8 mm under the 63\.5 mm hot pipe \(a sudden step there loses [0-9.]+ (psi|kPa)/.test(o2), 'own core with 2 in necks: rejected, with the step loss shown');
  await setx('oIn', '63.5');
  await setx('ic', 'own');
  const ici = await pg.evaluate(() => document.getElementById('i-ici')._b);
  near(ici, 63.5 - 2 * 1.651, 1e-9, 'picking your own core fills the intercooler inlet with the neck less twice the 1.651 mm pipe wall');
  const snap = await pg.evaluate(() => window.__proj ? window.__proj.snapshot('x').ui.tso : null);
  ok(snap && snap.oName === 'Shop core A' && snap.oHp === '380' && snap.ic === 'own', 'own core saved with the project (ui.tso)');
  await setx('oName', ''); await setx('ic', '');

  // build 3
  await hp(800);
  t = await top('a2a'); ok(t.join() === 'CSF 8054,CSF 8055,CSF 8068', 'build 3, 800 hp air-to-air, Bell first: ' + t.join(', '));
  const top3 = await pg.$eval('#tso-icrec-top-a2a', e => e.innerText);
  ok(/CSF 8055: a larger rating than the one above; its charge face meets Bell’s 106\.7 in² \(688 cm²\) only on this page’s assumption/.test(top3) &&
    /CSF 8068: fails Bell’s face area[^—]*81\.0 in² \(523 cm²\), is 25\.7 in² \(166 cm²\) short of Bell’s 106\.7 in²/.test(top3), 'build 3: a pass on the CSF flow-direction assumption says so; the failing row shows its shortfall');
  await hp(1300);
  t = await top('a2a'); ok(t[0] === 'CSF 8040', '1300 hp: nothing meets Bell, the pick is CSF 8040 by rating (' + t.join(', ') + ')');
  const n13 = await pg.$eval('#tso-icrec-a2a', e => e.innerText);
  ok(/no listed core meets Bell’s face area for this power; this is the closest by rating; its charge face, 72\.0 in² \(465 cm²\), is 101\.3 in² \(654 cm²\) short of Bell’s 173\.3 in²/.test(n13), '1300 hp: the pick says no core meets Bell and gives the shortfall');
  await hp(800);
  const um = await pg.$eval('#tso-icrec-out-a2a', e => e.textContent);
  ok(/Mishimoto MMINT-UM: rating 600 hp below/.test(um), 'MMINT-UM: the lower of its two figures (600 whp) is used and it is out');

  // size limit (Garrett: the largest core that fits)
  await hp(450);
  for (const [k, v] of [['lmL', '610'], ['lmH', '305'], ['lmT', '89']]) await setx(k, v);
  t = await top('a2a'); ok(t.join() === 'Garrett 848054-6037,CSF 8053,CSF 8047', 'size limit 610 x 305 x 89 mm, 450 hp: largest face that fits first: ' + t.join(', '));
  ok(/largest charge face/.test(await pg.$eval('#tso-lim-echo', e => e.innerText)) && /24\.02 × 12\.01 × 3\.50 in \(610 × 305 × 89 mm\)/.test(await pg.$eval('#tso-lim-echo', e => e.innerText)), 'the switch of rule is stated, the space in in and mm');
  ok(/Mishimoto MMINT-US: overall size 31 × 12 × 3 in \(787 × 305 × 76 mm\) does not fit your space/.test(await pg.$eval('#tso-icrec-out-a2a', e => e.textContent)), 'Mishimoto checked on its overall size with tanks');
  await setx('lmT', '77');
  t = await top('a2a'); ok(t.join() === 'CSF 8056,CSF 8067,Garrett 487085-6002', 'size limit 610 x 305 x 77 mm: ' + t.join(', '));
  await setx('ictype', 'w2a');
  for (const [k, v] of [['lmL', '305'], ['lmH', '150'], ['lmT', '305']]) await setx(k, v);
  t = await top('w2a'); ok(t.join() === 'Conflux Technology 100011,Conflux Technology 100012,Garrett 717874-6009', 'water-to-air, size limit 305 x 150 x 305 mm: thermal data first, 100013 does not fit: ' + t.join(', '));
  ok(/EJ Bowman JK190-4078-3: size not published: cannot be checked against your space/.test(await pg.$eval('#tso-icrec-out-w2a', e => e.textContent)), 'water-to-air: a core with no published size is out under a limit');
  for (const k of ['lmL', 'lmH', 'lmT']) await setx(k, '');
  await setx('ictype', 'a2a');

  // build 2
  await hp(450); await setx('ictype', 'w2a');
  t = await top('w2a'); ok(t.join() === 'Conflux Technology 100011,Conflux Technology 100012,Conflux Technology 100013', 'build 2, 450 hp water-to-air, on the evidence: ' + t.join(', '));
  ok(await outN('w2a') === 5, 'build 2: the five smaller Bowman coolers not recommended');
  // the JK190 thermal gate, by hand (exact cross-flow series written here, not the page's)
  const R = await pg.evaluate(() => window.__tsLast());
  const cp = 1.4 * 287.05 / 0.4;
  const eps = (n, cr) => { const a = n, bb = cr * n; let s = 0, ta = Math.exp(-a), tb = Math.exp(-bb), ca = ta, cb = tb; for (let k = 0; k < 400; k++) { if (k > 0) { ta *= a / k; tb *= bb / k; ca += ta; cb += tb; } s += (1 - Math.min(1, ca)) * (1 - Math.min(1, cb)); } return s / bb; };
  const ntuOf = (e, cr) => { let lo = 0, hi = 50; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (eps(mid, cr) < e) lo = mid; else hi = mid; } return (lo + hi) / 2; };
  const Ch0 = 30.1 / 60 * cp, Cw0 = 270 / 60 / 1000 * 992 * 4183, e0 = 138.5 / 150, UA = ntuOf(e0, Ch0 / Cw0) * Ch0;
  const Ch = R.mc * cp, tamb = 25, Qneed = 0.75 * Ch * (R.t2 - tamb), Qp = eps(UA / Ch, Ch / Cw0) * Ch * (R.t2 - tamb), capM = Qp / Qneed;
  const W2 = await pg.evaluate(() => window.__tso.TG().icrec.w2a.ok.map(x => ({ pn: x.c.pn, evG: x.evG, capM: x.th ? x.th.capM : null })));
  const jk = W2.find(x => x.pn === 'JK190-4078-3');
  ok(capM >= 1 && jk && Math.abs(jk.capM - capM) < 1e-6 && jk.evG === 1, 'JK190 thermal gate: hand capacity margin ' + capM.toFixed(4) + ' (UA ' + UA.toFixed(1) + ' W/K), page ' + (jk && jk.capM.toFixed(4)) + ', group 1 (0.563 x its point’s flow)');
  { // the Conflux margins by hand: UA from the curve (inverted here), linear inside the plotted range, a power law fitted here outside it
    const CF = await pg.evaluate(() => window.__tso.IC_LIB.filter(c => c.curve).map(c => ({ pn: c.pn, K: c.curve, kgs: c.rated.kgs })));
    const capOf = c => { const Cc = c.kgs * 3917, U = c.K.m.map((m, i) => ntuOf(c.K.eff[i] / 100, m * cp / Cc) * m * cp), m = R.mc, n = 4;
      let ua; if (m >= c.K.m[0] && m <= c.K.m[n]) { for (let i = 0; i < n; i++) if (m <= c.K.m[i + 1]) { ua = U[i] + (U[i + 1] - U[i]) * (m - c.K.m[i]) / (c.K.m[i + 1] - c.K.m[i]); break; } }
      else { const lx = c.K.m.map(Math.log), ly = U.map(Math.log), mx = lx.reduce((a, b) => a + b) / 5, my = ly.reduce((a, b) => a + b) / 5, bb = lx.reduce((q, x, i) => q + (x - mx) * (ly[i] - my), 0) / lx.reduce((q, x) => q + (x - mx) ** 2, 0); ua = Math.exp(my - bb * mx) * Math.pow(m, bb); }
      const Ch = m * cp; return eps(ua / Ch, Ch / Cc) / 0.75; };
    const hand = CF.map(c => [c.pn, capOf(c)]), pg2 = hand.map(([pn]) => W2.find(x => x.pn === pn));
    ok(hand.every(([pn, v], i) => pg2[i] && Math.abs(pg2[i].capM - v) < 1e-6) && pg2[0].evG === 0 && pg2[1].evG === 1 && pg2[2].evG === 1 && hand[0][1] < hand[1][1] && hand[1][1] < hand[2][1] && hand[2][1] < capM,
      'Conflux capacity margins by hand ' + hand.map(([pn, v]) => pn + ' ' + v.toFixed(4)).join(', ') + ' (100011 inside its range, group 0; the others extrapolated, group 1, ordered by margin, ahead of JK190 ' + capM.toFixed(4) + ')'); }
  ok(W2.filter(x => x.evG === 2).map(x => x.pn).slice(0, 2).join() === '717874-6009,717874-6008', 'rating-only rows after the thermal ones, by rating: ' + W2.filter(x => x.evG === 2).map(x => x.pn).slice(0, 3).join(', '));
  await setx('icm', '1.2');
  t = await top('w2a'); ok(t.join() === 'Conflux Technology 100012,Conflux Technology 100013,Garrett 717874-6008', 'build 2, margin 1.2 (540 hp): ' + t.join(', '));
  ok(/Garrett 717874-6008: rating only, so it ranks behind the cores whose thermal data meets the target[^\n]*rating only: the maker publishes no thermal data for this core, so the page cannot check it against your target/.test(await pg.$eval('#tso-icrec-top-w2a', e => e.innerText)), 'the rating-only row says why it ranks there');
  await setx('icm', '1');
  // Use this intercooler: the pick, Conflux 100011
  await pg.click('[data-icrec="w2a"] button[data-icuse]'); await pg.waitForTimeout(500);
  const i11 = await pg.evaluate(() => window.__tso.IC_LIB.findIndex(c => c.pn === '100011'));
  let ts = await TSO();
  ok(ts.ic === String(i11) && ts.ictype === 'w2a' && ts.wf === '20' && ts.cool === 'egw25', 'Use this intercooler: Conflux 100011 picked, the maker’s 20 L/min of EGW 25/75 filled');
  ok(/In use on this build/.test(await pg.$eval('#tso-icrec-w2a', e => e.innerText)), 'the recommendation says it is in use');
  const step = await pg.$eval('#tg-steps li[data-step="ic"]', e => e.innerText);
  ok(/recommended Conflux Technology 100011 \(in use\)/.test(step), 'checklist step 6 shows the recommendation and that it is applied: ' + step.replace(/\n/g, ' '));
  await pg.click('button[data-tsheet]'); await pg.waitForTimeout(600);
  const sh = await pg.evaluate(() => { const f = window.__tgSheet; if (!f) return null; const d = new DOMParser().parseFromString(f.text, 'application/xml');
    return [...d.getElementsByTagName('tr')].map(tr => [...tr.getElementsByTagName('td')].map(td => td.textContent)).filter(r => r.length); });
  const icRow = sh && sh.find(r => r[0] === 'Intercooler core');
  ok(icRow && /Conflux Technology 100011/.test(icRow[1]) && /confluxtechnology\.com/.test(icRow[2]) && /the page’s recommendation/.test(icRow[2]), 'build sheet: the chosen core, its source link, and that it is the recommendation: ' + (icRow || []).join(' | '));
  // picking JK190 from the list: its point and drop filled (the same path as Use this intercooler)
  const iJK = await pg.evaluate(() => window.__tso.IC_LIB.findIndex(c => c.pn === 'JK190-4078-3'));
  await setx('ic', String(iJK)); await pg.waitForTimeout(300); ts = await TSO();
  const ins = await pg.evaluate(() => [document.getElementById('i-icrdp')._b, document.getElementById('i-icrf')._b]);
  ok(ts.ic === String(iJK) && ts.ictype === 'w2a' && ts.pm === String(+(30.1 / 0.45359237).toPrecision(10)) && ts.pTi === '180' && ts.pTo === '41.5' && ts.pcf === '270' && ts.pTc === '30', 'JK190 picked: its thermal point filled (30.1 kg/min = ' + ts.pm + ' lb/min, 180 -> 41.5 °C, 270 L/min at 30 °C)');
  ok(Math.abs(ins[0] - 7.4) < 1e-9 && Math.abs(ins[1] - 30.1 / 0.45359237) < 1e-9, 'JK190 picked: the maker’s air drop 7.4 kPa at 66.36 lb/min into the rated-drop inputs');
  await setx('ic', ''); await setx('wf', ''); await setx('cool', 'water');

  // no core: 1500 hp air-to-air, the specification by hand
  await setx('ictype', 'a2a'); await set('i-icam', '120'); await hp(1500);
  ok(await pg.$('#tso-icrec-none-a2a') !== null, '1500 hp air-to-air: no listed core qualifies, said');
  const R2 = await pg.evaluate(() => window.__tsLast()), Chh = R2.mc * cp, Cc = 120 / (60 / 0.45359237) * cp, Cmin = Math.min(Chh, Cc), Cr = Cmin / Math.max(Chh, Cc);
  const Q = 0.75 * Chh * (R2.t2 - tamb), e = Q / (Cmin * (R2.t2 - tamb)), N = ntuOf(e, Cr);
  const spec = await pg.$eval('#tso-icspec', el => el.innerText);
  const kwP = +(spec.match(/\(([0-9.]+) kW\)/) || [])[1], ntuP = +(spec.match(/NTU ([0-9.]+), UA/) || [])[1], uaP = +(spec.match(/UA ([0-9]+) W\/K/) || [])[1];
  ok(Math.abs(kwP - +(Q / 1000).toFixed(1)) < 0.051, 'spec: heat to reject ' + (Q / 1000).toFixed(2) + ' kW by hand, page ' + kwP + ' kW');
  ok(Math.abs(ntuP - +N.toFixed(2)) < 0.006 && Math.abs(uaP - Math.round(N * Cmin)) <= 1, 'spec: NTU ' + N.toFixed(4) + ', UA ' + (N * Cmin).toFixed(1) + ' W/K by hand; page NTU ' + ntuP + ', UA ' + uaP);
  ok(/90 in² \(581 cm²\) internal/.test(spec) && /charge face of 200 in² \(1290 cm²\)/.test(spec), 'spec: Bell 90 in² (581 cm²) flow area, 200 in² (1290 cm²) face');
  ok(/Tank necks at least/.test(spec) && /2\.00 psi \(13\.8 kPa\)/.test(spec) && /BTU\/min/.test(spec), 'spec: tank necks, pressure-drop budget in psi and kPa, heat in BTU/min and kW');
  await set('i-icam', '');

  // turbo recommendation
  await hp(450);
  const tt = () => pg.$$eval('#tso-turbrec-top li', ls => ls.map(l => l.textContent.split(',')[0]));
  t = await tt(); ok(t.join() === 'BorgWarner EFR 6758,Garrett G25-550,Garrett GTX2867R GEN II', 'turbo, 450 hp: ' + t.join(', '));
  ok(/not a compressor-map match/.test(await pg.$eval('#tso-turbrec', e => e.innerText)), 'turbo pick says it is a rating match, not a map match');
  await setx('tm', '1.15'); t = await tt(); ok(t.join() === 'Garrett G25-550,Garrett GTX2867R GEN II,BorgWarner EFR 7163', 'turbo, margin 1.15: ' + t.join(', '));
  await setx('tm', '1'); await hp(600);
  t = await tt(); ok(/PT5558/.test(t[0]) && /G25-660/.test(t[1]) && /PT5862/.test(t[2]), 'turbo, 600 hp: ' + t.join(', '));
  await pg.click('button[data-turuse]'); await pg.waitForTimeout(500);
  const tu = await pg.evaluate(() => [window.__tso.TSO.turbo, window.__tso.TURBO_LIB.findIndex(t => /PT5558/.test(t.model))]);
  ok(tu[0] === String(tu[1]), 'Use this turbo picks the PT5558');
  const st = await pg.$eval('#tg-steps li[data-step="turbo"]', e => e.innerText);
  ok(/recommended Precision Turbo & Engine GEN2 PT5558 CEA® \(650 hp rating, in use\)/.test(st), 'checklist turbo step: the recommendation, in use');

  // dual units, layout, clean render
  const all = await pg.evaluate(() => [...document.querySelectorAll('.sec')].find(s => s.dataset.sec === 'intercooler-options-and-cooling-capacity').innerText);
  ok(!/\bNaN\b|undefined|Infinity/.test(all), 'intercooler section renders cleanly');
  ok(/hp \([0-9]+ kW\)/.test(all) && /in² \([0-9]+ cm²\)/.test(all) && /cu in \([0-9.]+ L\)/.test(all) && /lb\/min \([0-9.]+ kg\/s\)/.test(all), 'recommendation in hp and kW, in² and cm², cu in and L, lb/min and kg/s');
  await pg.setViewportSize({ width: 400, height: 900 }); await pg.waitForTimeout(400);
  const w = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(w[0] <= w[1] + 1, '400 px: no horizontal scroll (' + w.join(' / ') + ')');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'icrec_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
