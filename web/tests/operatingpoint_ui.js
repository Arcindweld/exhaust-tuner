// One operating point for the boosted build (2026-11-14; docs/USABILITY_AUDIT_2026-11-14.md C1 to C8, docs/BOOST_AUDIT
// addendum). The K24A2 + Precision GEN2 PT5862 journey of easyflow_ui (450 hp, 0.63 A/R T3 / 4-bolt, Use these sizes, Use
// this intercooler, tubular manifold, 93 mm port spacing).   node tests/operatingpoint_ui.js   (from web/)
// Checks:
//  - the default is "my power target": the boost is worked out by Garrett's relation and every boosted section, the build
//    sheet, the glance card, the step list and the simulation plan carry one mass flow, one pressure ratio, one
//    compressor-out temperature, one intercooler-out temperature and one back pressure;
//  - "my boost": the power is worked out by the same relation inverted, the same consistency; typing the boost the
//    first mode found gives back the 450 hp (the relation round-trips);
//  - "both typed" keeps the earlier behaviour and its mismatch warning;
//  - a project saved by the build before this (fixtures/op_legacy_k24.json: 450 hp and 8 psi both typed) loads with the
//    same results as that build gave (its route, Garrett's figures, the exhaust march, the manifold, and every number of
//    its build sheet's rows and glance card, in order);
//  - a project saved and loaded round-trips the mode and the card;
//  - the wastegate across the pressure before the turbine: for one gate flow the area falls as p3 rises, the share rises
//    with p3, the gate is sized at the largest area from 0.8 to 2.5 x boost, a measured p3 sizes it at that one;
//  - the back pressure after the turbine: the balance and the march agree (the iteration converges, the second pass equal
//    to the first), the turbine balance uses it, a typed figure overrides it, "none" removes it;
//  - the inlet tube matches the compressor's 4.0 in hose-coupler inlet; the runner row prints the tube once.
const { chromium } = require('playwright');
const fs = require('fs');
const { reads, settle } = require('./settle');
const LBMIN = 60 / 0.45359237, PATM = 101325;
const nums = s => [...String(s).replace(/(\d),(\d{3})/g, '$1$2').matchAll(/-?\d+(?:\.\d+)?/g)].map(x => x[0]);
// every number of a, in order, appears in b (b may add words and numbers)
const inOrder = (a, b) => { const A = nums(a), B = nums(b); let j = 0; for (const x of B) { if (j < A.length && x === A[j]) j++; } return j === A.length; };
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
  const setv = async (pg, id, v) => { await pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]); await settle(pg); };
  const chg = async (pg, s, v) => { await pg.evaluate(([s, v]) => { const el = document.querySelector(s); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [s, v]); await settle(pg); };
  async function journey(pg, mode) {
    await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
      s('v-mode', 'eng'); s('v-pick', [...document.getElementById('v-pick').options].find(o => /^K24A2 /.test(o.text)).value); });
    await settle(pg);
    await setv(pg, 'i-ind', 'turbo'); if (mode) await setv(pg, 'i-opm', mode); await setv(pg, 'i-hp', '450');
    const ti = await pg.evaluate(() => window.__tso.TURBO_LIB.findIndex(t => t.model.startsWith('GEN2 PT5862'))); await chg(pg, 'select.tsox[data-k="turbo"]', String(ti));
    const hs = await pg.evaluate(ti => window.__tso.TURBO_LIB[ti].hs.findIndex(h => h.ar === 0.63 && h.flange === 'T3' && h.outlet === '4-bolt'), ti); await chg(pg, 'select.tsox[data-k="hs"]', String(hs));
    await pg.click('button[data-tsuse]'); await settle(pg);
    const ic = await pg.$('button[data-icuse]:not([disabled])'); if (ic) { await ic.click(); await settle(pg); }
    await setv(pg, 'i-mani', 'tube'); await setv(pg, 'i-msp', (93 / 25.4).toFixed(3));
    // the 4-Stroke tab once, so that the simulation's inputs exist for its plan
    await pg.click('#tab-four'); await settle(pg); await pg.click('#tab-intake'); await settle(pg);
  }
  // everything the sections, the sheet, the card, the steps and the simulation plan say about the operating point
  const gather = pg => pg.evaluate(() => {
    const R = window.__tsLast(), T = window.__tg.TG(), O = window.__op.OP(), X = window.__tsx.last(), P = window.__op.place(), sh = window.__tg.sheet(), plan = window.__tsim.plan();
    const sec = k => { const e = document.querySelector('#i-details .sec[data-sec="' + k + '"]'); return e ? e.innerText : ''; };
    const rowsOf = re => [...document.querySelectorAll('#i-details .sec div.r')].filter(d => d.offsetParent).map(d => d.innerText.replace(/\s+/g, ' ')).filter(t => re.test(t));
    const steps = Object.fromEntries([...document.querySelectorAll('#tg-steps > li')].map(li => [li.dataset.step, li.querySelector('.tg-line').textContent]));
    const gl = Object.fromEntries([...document.querySelectorAll('#tg-glance tr[data-gl]')].map(r => [r.dataset.gl, { v: r.querySelector('.gl-v').textContent, n: (r.querySelector('.gl-n') || {}).textContent || '' }]));
    const all = [...document.querySelectorAll('#i-details .sec')].filter(s => s.offsetParent).map(s => s.innerText).join('\n');
    return { R: { m: R.m, mc: R.mc, PRc: R.PRc, t2: R.t2, t3: R.t3, Pt: R.Pt, P2: R.P2, P1: R.P1, nt: R.nt },
      G: T.G ? { wa: T.G.wa, map: T.G.map, pr: T.G.pr, boost: T.G.boost } : null, O: { mode: O.mode, boost: O.boost, hp: O.hp, wa: O.wa, qd: O.qd, iters: O.iters, range: O.range, tmF: O.tmF },
      hp: window.__op.hp(), boostUsed: window.__op.boost(), ic: T.ic ? { Qreq: T.ic.Qreq } : null, oil: T.oil ? { hp: T.oil.hp } : null,
      xme: X ? X.G.me : null, xhpT: X ? X.G.hpT : null, bp: X && X.X && !X.X.choke ? X.X.bp : null, p4: window.__op.p4(), simP4: window.__op.simP4(), bpa: window.__op.bpa(), bpUse: window.__op.bpUse(),
      bov: P && P.bov ? { m: P.bov.m, pUp: P.bov.pUp } : null, wg: P && P.wg ? { mw: P.wg.mw, Aeff: P.wg.Aeff, pick: P.wg.pick } : null, wgIn: P && P.wgIn ? { k: P.wgIn.k, kT: P.wgIn.kT, basis: P.wgIn.basis, A: P.wgIn.A, p4: P.wgIn.p4, ma: P.wgIn.ma, t2: P.wgIn.t2, tit: P.wgIn.tit, eta: P.wgIn.eta, afr: P.wgIn.afr, t1: P.wgIn.t1, bst: P.wgIn.bst } : null,
      plan: plan && !plan.err ? { sameR: plan.R === R, Pt: plan.Pt, Tc: plan.Tc, p4: plan.p4 } : (plan ? { err: plan.err } : null),
      sheetN: Object.fromEntries(sh.nums.map(n => [n[0], n[1]])), sheetP: Object.fromEntries(sh.parts.map(n => [n[0], n[1] + ' | ' + n[2]])), sub: sh.sub,
      steps, gl, all, airRows: rowsOf(/^Air leaving the compressor|^Air leaving the intercooler|^Compressor pressure ratio/),
      opOut: document.getElementById('i-opm-out').innerHTML, opHidden: document.getElementById('i-opm-wrap').hidden,
      boostHidden: document.getElementById('i-boost-wrap').hidden, hpHidden: document.getElementById('i-hp-wrap').hidden,
      rec: window.__op.rec(), q: window.__op.q() ? { dt: window.__op.q().dt, dci: window.__op.q().dci, coupler: window.__op.q().dciCoupler, w: window.__op.q().w } : null };
  });
  const rel = (a, b) => Math.abs(a - b) / Math.max(1e-12, Math.abs(b));
  const F = c => Math.round(c * 1.8 + 32);
  // one point: every place the build states it
  function onePoint(tag, S) {
    const R = S.R, G = S.G;
    ok(G && rel(G.wa / LBMIN, R.m) < 1e-6 && rel(G.pr, R.PRc) < 1e-6 && Math.abs((G.map * 6894.757) - R.Pt) < 1,
      tag + ': Garrett’s figures and the route are one point: ' + (R.m * LBMIN).toFixed(3) + ' lb/min per compressor (Garrett ' + (G ? G.wa.toFixed(3) : '?') + '), pressure ratio ' + R.PRc.toFixed(4) + ' (Garrett ' + (G ? G.pr.toFixed(4) : '?') + '), manifold ' + (R.Pt / 6894.757).toFixed(3) + ' psia (Garrett ' + (G ? G.map.toFixed(3) : '?') + ')');
    ok(rel(S.boostUsed * 1000 + PATM, R.Pt) < 1e-9 && rel(S.O.boost * 1000 + PATM, R.Pt) < 1e-9, tag + ': the boost the sections use (' + S.boostUsed.toFixed(4) + ' kPa) is the route’s throttle pressure');
    const flow = (R.m * LBMIN).toFixed(1) + ' lb/min';
    ok(S.sheetN['Air through each compressor'].startsWith(flow) && S.sheetN['Garrett’s method for ' + Math.round(S.hp) + ' hp'].startsWith(flow) && S.steps.air.startsWith(flow) && S.gl.power.n.includes(flow),
      tag + ': one mass flow, ' + flow + ', in the sheet’s air and Garrett rows, step 2 and the glance card');
    // literature figures quoted in captions (Vizard's worked example, Blair and Cahoon's bell) and the intercooler's
    // what-if row (the compressor ratio with the core drop scaled to this flow instead of the typed drop) are not this build's
    const prM = [...S.all.matchAll(/(?:pressure ratio|ratio is|PR)\s+(?:of\s+)?(\d\.\d{2,3})\b/gi)].filter(m => !/RPM and PR $|0\.740 at PR $|with it the compressor ratio is $/.test(S.all.slice(Math.max(0, m.index - 40), m.index + m[0].length - m[1].length)));
    const prs = prM.map(m => m[1]), badPr = prM.filter(m => Math.abs(+m[1] - R.PRc) > 0.5 * Math.pow(10, -(m[1].split('.')[1].length)) + 1e-9).map(m => m[1] + ' in “…' + S.all.slice(Math.max(0, m.index - 60), m.index + m[0].length).replace(/\s+/g, ' ') + '”');
    ok(prs.length >= 5 && !badPr.length, tag + ': one pressure ratio, ' + R.PRc.toFixed(3) + ': ' + prs.length + ' pressure ratios quoted in the boosted sections' + (badPr.length ? '; others: ' + badPr.join(', ') : ''));
    const t2s = S.airRows.filter(t => /^Air leaving the compressor/.test(t)).concat([S.sheetN['Air leaving the compressor / the intercooler'].split(' / ')[0]]), t3s = S.airRows.filter(t => /^Air leaving the intercooler/.test(t)).concat([S.sheetN['Air leaving the compressor / the intercooler'].split(' / ')[1]]);
    const leaves = [...S.all.matchAll(/air leaves at (\d+) °F/g)].map(m => +m[1]), itLeaves = [...S.all.matchAll(/it leaves at (\d+) °F/g)].map(m => +m[1]);
    ok(t2s.length >= 3 && t2s.every(t => t.includes(F(R.t2) + ' °F')) && leaves.length && leaves.every(x => x === F(R.t2)), tag + ': one compressor-out temperature, ' + F(R.t2) + ' °F, in ' + (t2s.length + leaves.length) + ' places (Boosted intake, Inlet and charge pipes, Stone, the sheet)');
    ok(t3s.length >= 3 && t3s.every(t => t.includes(F(R.t3) + ' °F')) && itLeaves.every(x => x === F(R.t3)), tag + ': one intercooler-out temperature, ' + F(R.t3) + ' °F, in ' + (t3s.length + itLeaves.length) + ' places (Charge pipes, Inlet and charge pipes, Stone, the sheet)');
    const cp = 1004.675 * 1.4 / 1.4;   // CP_AIRT is gamma R / (gamma - 1), 1004.7: compared as a ratio below
    ok(S.ic && rel(S.ic.Qreq / (R.mc * (R.t2 - R.t3)), 1004.7) < 1e-3, tag + ': the intercooler’s heat is this flow’s: Q / (m (T2 − T3)) = ' + (S.ic ? (S.ic.Qreq / (R.mc * (R.t2 - R.t3))).toFixed(1) : '?') + ' J/kg K');
    ok(S.bov && rel(S.bov.m, R.mc) < 1e-12 && rel(S.bov.pUp, R.Pt) < 1e-12, tag + ': the blow-off valve passes this flow from the throttle pressure');
    ok(rel(S.xme, R.m * (1 + 1 / 12)) < 1e-9 && rel(S.wgIn.ma, R.m) < 1e-12 && rel(S.wgIn.t2, R.t2) < 1e-12, tag + ': the turbine balance, the wastegate and the exhaust after the turbine carry this flow (' + (S.xme * LBMIN).toFixed(2) + ' lb/min of exhaust)');
    ok(Math.abs(S.oil.hp - S.hp) < 1e-9 && Math.abs(S.xhpT - S.hp / R.nt) < 1e-9, tag + ': the oil load and the downpipe size rule use this point’s ' + S.hp.toFixed(1) + ' hp');
    ok(S.plan && S.plan.sameR && rel(S.plan.Pt, R.Pt) < 1e-12 && Math.abs(S.plan.Tc - (R.t3 + 273.15)) < 1e-9, tag + ': the simulation plan charges the engine at this point (' + ((S.plan.Pt - PATM) / 6894.757).toFixed(2) + ' psi boost, ' + F(R.t3) + ' °F)');
    // one back pressure: the worked-out one in the balance, the wastegate, the sheet, the step and the exhaust section
    const bpT = (S.bp / 6894.757).toFixed(2) + ' psi';
    ok(S.bp > 0 && Math.abs(S.p4 - PATM - S.bp) < 1e-6 && Math.abs(S.wgIn.p4 - S.p4) < 1e-9 && S.sheetN['Back pressure in the turbine balance'].startsWith(bpT) && S.steps.exh.includes(bpT) && /used in the turbine balance \(worked out\)/.test(S.steps.exh),
      tag + ': one back pressure, ' + bpT + ': the turbine balance, the wastegate, the sheet and the step use the exhaust section’s figure');
    ok(S.plan.p4 > PATM && Math.abs(S.plan.p4 - PATM - S.bpa.pDpEnd) < 1e-9 && Math.abs(S.plan.p4 - S.simP4) < 1e-9, tag + ': the simulation ends at the march’s static pressure at the downpipe’s end, ' + ((S.plan.p4 - PATM) / 6894.757).toFixed(2) + ' psi (its own downpipe runs from the turbine to there; ' + bpT + ' is the static at the narrower turbine outlet, before the cone recovers pressure)');
    ok(!/do not match/.test(S.gl.power.n) && !/do not match/.test(S.all.slice(0, 2e5)), tag + ': no mismatch warning');
  }

  // ---- 1. power target (the default)
  let { pg, ctx } = await open();
  ok(await pg.evaluate(() => document.getElementById('i-opm').value === 'hp' && document.getElementById('i-tobpsrc').value === 'auto' && document.getElementById('i-wgbasis').value === 'range'), 'defaults: my power target, back pressure worked out, wastegate across the range');
  await journey(pg);
  let S = await gather(pg);
  ok(S.O.mode === 'hp' && !S.opHidden && S.boostHidden && !S.hpHidden && /Boost worked out: 25\.\d\d psi/.test(S.opOut) && /Likely range/.test(S.opOut) && /\(\d+\.\d+ kPa\)/.test(S.opOut),
    'power target: the boost is a result (' + S.O.boost.toFixed(2) + ' kPa, ' + (S.O.boost / 6.894757).toFixed(2) + ' psi), shown with its range in both units; the boost field is hidden');
  ok(S.O.iters > 2 && S.O.iters < 40, 'the boost and the manifold air converge in ' + S.O.iters + ' passes');
  ok(S.O.range.lo < S.O.boost && S.O.range.hi > S.O.boost && S.O.range.bsL === 0.5 && S.O.range.bsH === 0.6 && Math.abs(S.O.range.veL - 0.95) < 1e-9 && S.O.range.veH === 0.99,
    'range ' + (S.O.range.lo / 6.894757).toFixed(1) + ' to ' + (S.O.range.hi / 6.894757).toFixed(1) + ' psi from Garrett’s BSFC 0.50 to 0.60 and VE (Garrett’s 95% to 99% for a 4-valve head; the relation’s VE is its middle, 97%, since 2026-11-14 boost for power), manifold air ' + S.O.range.tmL.toFixed(0) + ' to ' + S.O.range.tmH.toFixed(0) + ' °F');
  onePoint('power target', S);
  const hpPoint = S;
  ok(S.q && S.q.coupler && Math.abs(S.rec.dt - (4 * 25.4 - 2 * S.q.w)) < 1e-9 && Math.abs(S.q.dt - S.rec.dt) < 1e-9, 'the inlet tube matches the compressor’s 4.0 in hose coupler: 4 in OD, ' + (S.rec.dt / 25.4).toFixed(3) + ' in (' + S.rec.dt.toFixed(1) + ' mm) inside (was the 5 in tube, 4.87 in inside)');
  ok((S.gl.run.v.match(/0\.065 in/g) || []).length === 1 && !/OD 1\.875/.test(S.gl.run.v), 'the runner row prints the tube once: ' + S.gl.run.v);
  ok(/sized at \d\.\d+ × boost before the turbine, where it needs the most area from 0\.8 to 2\.5 ×/.test(S.gl.wg.n), 'the wastegate row states its basis: ' + S.gl.wg.n.replace(/^.*?; /, ''));
  // the back pressure iteration
  const B = S.bpa;
  ok(B && B.iters === 2 && B.hist.length === 2 && Math.abs(B.hist[1] - B.hist[0]) < 1e-6 && Math.abs(B.bp - S.bp) < 1e-9, 'back pressure: the turbine balance and the march agree in ' + (B && B.iters) + ' passes (' + (B ? B.hist.map(x => x.toFixed(6)).join(' → ') : '?') + ' Pa): p4 does not move the flow or the gas after the turbine');
  // the wastegate across p3
  const w = S.wgIn, sw = await pg.evaluate(w => { const s = window.__op.wgSweep(w); return { best: s.best, pts: s.pts.map(x => ({ k: x.k, A: x.A, share: x.share, mw: x.mw })) }; }, w);
  const fixedA = await pg.evaluate(w => { const mw = 0.15, T3 = w.tit + 273.15, out = []; for (let k = 0.8; k <= 2.501; k += 0.1) out.push(window.__op.orificeArea(mw, 101325 + k * w.bst, T3, w.p4, 1.33, 287).A); return out; }, w);
  ok(fixedA.every((a, i) => i === 0 || a < fixedA[i - 1]), 'for one gate flow the area falls as the pressure before the turbine rises (' + (fixedA[0] * 1e6).toFixed(0) + ' → ' + (fixedA[fixedA.length - 1] * 1e6).toFixed(0) + ' mm² from 0.8 to 2.5 ×)');
  ok(sw.pts.every((x, i) => i === 0 || x.share >= sw.pts[i - 1].share - 1e-12) && sw.pts[0].share < sw.pts[sw.pts.length - 1].share, 'the share round the gate rises with the pressure before the turbine (' + (sw.pts[0].share * 100).toFixed(0) + '% at 0.8 × to ' + (sw.pts[sw.pts.length - 1].share * 100).toFixed(0) + '% at 2.5 ×)');
  const at = k => sw.pts.find(x => Math.abs(x.k - k) < 1e-9).A;
  ok(Math.abs(w.k - sw.best.k) < 1e-9 && sw.pts.every(x => x.A <= sw.best.A + 1e-15) && sw.best.A > at(2) && sw.best.A >= at(0.8) && sw.best.A >= at(2.5) && Math.abs(S.wg.Aeff - sw.best.A) / sw.best.A < 1e-9 && Math.PI / 4 * (S.wg.pick / 1000) ** 2 >= sw.best.A,
    'the gate is sized at the largest area from 0.8 to 2.5 ×: ' + (sw.best.A * 1e6).toFixed(0) + ' mm² at ' + sw.best.k + ' × (2 ×: ' + (at(2) * 1e6).toFixed(0) + ', 0.8 ×: ' + (at(0.8) * 1e6).toFixed(0) + ', 2.5 ×: ' + (at(2.5) * 1e6).toFixed(0) + ' mm²); the ' + S.wg.pick + ' mm valve holds it');
  // typed and none back pressure; measured p3
  await setv(pg, 'i-tobp', '1'); S = await gather(pg);
  ok(S.bpUse.k === 'typed' && Math.abs(S.p4 - PATM - 6894.757) < 0.01 && S.wgIn.p4 === S.p4 && Math.abs(S.plan.p4 - S.p4) < 1e-9, 'a typed back pressure (1 psi) is used as typed, in the balance and the simulation');
  await setv(pg, 'i-tobp', ''); await setv(pg, 'i-tobpsrc', 'none'); S = await gather(pg);
  ok(S.bpUse.k === 'none' && S.p4 === PATM, 'set to none: the atmosphere after the turbine');
  await setv(pg, 'i-tobpsrc', 'auto');
  await setv(pg, 'i-p3m', '40'); S = await gather(pg);
  ok(S.wgIn.basis === 'measured' && Math.abs(S.wgIn.k * S.O.boost - 40 * 6.894757) < 1e-6, 'a measured pressure before the turbine (40 psi) sizes the gate at it (' + S.wgIn.k.toFixed(3) + ' × boost)');
  await setv(pg, 'i-p3m', '');
  // saved and loaded: the same point and card
  const card = await pg.evaluate(() => document.getElementById('tg-glance').innerText), snap = await pg.evaluate(() => window.__proj.snapshot('K24 hp'));
  await ctx.close();
  ({ pg, ctx } = await open());
  await pg.evaluate(d => window.__proj.apply(d), snap); await settle(pg); await pg.waitForTimeout(300); await settle(pg);
  await pg.click('#tab-four'); await settle(pg); await pg.click('#tab-intake'); await settle(pg);
  S = await gather(pg);
  ok(S.O.mode === 'hp' && rel(S.R.m, hpPoint.R.m) < 1e-12 && rel(S.O.boost, hpPoint.O.boost) < 1e-12 && card === await pg.evaluate(() => document.getElementById('tg-glance').innerText), 'a project saved in this mode loads with the same mode, point and glance card');
  // ---- 2. my boost: the relation inverted; typing the boost the first mode found gives back 450 hp
  await setv(pg, 'i-opm', 'boost'); await setv(pg, 'i-boost', String(hpPoint.O.boost / 6.894757));
  S = await gather(pg);
  ok(S.O.mode === 'boost' && Math.abs(S.O.hp - 450) < 1e-3 && rel(S.R.m, hpPoint.R.m) < 1e-6 && S.hpHidden && !S.boostHidden && /Power worked out: 450 hp/.test(S.opOut),
    'my boost at ' + (hpPoint.O.boost / 6.894757).toFixed(3) + ' psi: the power worked out is ' + S.O.hp.toFixed(4) + ' hp and the airflow the same (the relation round-trips)');
  await setv(pg, 'i-boost', '8'); S = await gather(pg);
  ok(S.O.hp > 150 && S.O.hp < 300 && S.O.range.lo < S.O.hp && S.O.range.hi > S.O.hp && /Likely range \d+ hp \(\d+ kW\) to \d+ hp/.test(S.opOut), 'my boost at 8 psi: ' + S.O.hp.toFixed(1) + ' hp worked out (range ' + S.O.range.lo.toFixed(0) + ' to ' + S.O.range.hi.toFixed(0) + ' hp), in both units');
  onePoint('my boost, 8 psi', S);
  ok(rel(S.R.m / 0.215888085, S.O.qd) < 0.02 && Math.abs(S.O.qd / (0.97 / 0.90) - 0.9612) < 0.002, 'at 8 psi Garrett’s relation gives ' + (S.R.m * LBMIN).toFixed(2) + ' lb/min against the 28.56 the tab’s own relation gave at the VE field’s 90 % (inlet-density air, no charge heating): the factor ' + S.O.qd.toFixed(4) + ' is the relation’s VE over the field’s (0.97 / 0.90) times the charge-temperature ratio (' + (S.O.qd / (0.97 / 0.90)).toFixed(4) + ', 0.9612 before 2026-11-14)');
  // ---- 3. both typed: the earlier behaviour, with the warning
  await setv(pg, 'i-opm', 'both'); await setv(pg, 'i-hp', '450'); S = await gather(pg);
  ok(S.O.mode === 'both' && S.O.qd === 1 && Math.abs(S.R.Pt - PATM - 55158) < 10 && /do not match/.test(S.gl.power.n) && !S.boostHidden && !S.hpHidden, 'both typed: the boost’s airflow (' + (S.R.m * LBMIN).toFixed(1) + ' lb/min) against the target’s, with the mismatch warning');
  await ctx.close();

  // ---- 4. a project saved by the build before this: the same results
  const L = JSON.parse(fs.readFileSync(__dirname + '/fixtures/op_legacy_k24.json', 'utf8'));
  ({ pg, ctx } = await open());
  await pg.evaluate(d => window.__proj.apply(d), L.snap); await settle(pg); await pg.waitForTimeout(300); await settle(pg);
  S = await gather(pg);
  const sets = await pg.evaluate(() => ['i-opm', 'i-tobpsrc', 'i-wgbasis'].map(id => document.getElementById(id).value).join());
  ok(sets === 'both,none,single', 'a project saved before this loads as it was worked out then: both typed, no back pressure unless typed, the gate at the one p3 (' + sets + ')');
  const Rk = Object.keys(L.R).filter(k => k in S.R), badR = Rk.filter(k => rel(S.R[k], L.R[k]) > 1e-7);
  ok(!badR.length && rel(S.G.wa, L.G.wa) < 1e-7 && rel(S.G.map, L.G.map) < 1e-7 && rel(S.G.pr, L.G.pr) < 1e-7 && rel(S.bp, L.bp.bp) < 1e-7 && rel(S.xme, L.bp.me) < 1e-7,
    'legacy: route (' + Rk.join(', ') + '), Garrett’s figures and the exhaust march as before (' + (S.R.m * LBMIN).toFixed(3) + ' lb/min, PR ' + S.R.PRc.toFixed(4) + ', back pressure worked out ' + (S.bp / 1000).toFixed(3) + ' kPa)' + (badR.length ? '; moved: ' + badR.map(k => k + ' ' + S.R[k] + ' (was ' + L.R[k] + ')').join(', ') : ''));
  ok(S.p4 === PATM && S.wgIn.basis === 'single' && S.wgIn.k === 2, 'legacy: the turbine balance at the atmosphere after the turbine, the gate at 2 × boost, as before');
  const badP = L.parts.filter(([n, v, w]) => n !== 'Runners' && !(S.sheetP[n] && inOrder(v + ' | ' + w, S.sheetP[n])));
  const run = L.parts.find(r => r[0] === 'Runners'), runNew = S.sheetP.Runners;
  ok(!badP.length && runNew && inOrder(runNew.split(' | ')[0], run[1]), 'legacy: every number of every part row of the build sheet as before, in order (' + L.parts.length + ' rows; the runner row prints the tube once now)' + (badP.length ? '; differ: ' + badP.map(r => r[0] + ': ' + (S.sheetP[r[0]] || 'missing').slice(0, 160) + ' (was ' + r[1].slice(0, 120) + ')').join(' | ') : ''));
  const badN = L.nums.filter(([n, v]) => !(S.sheetN[n] != null ? inOrder(v, S.sheetN[n]) : n === 'Back pressure in the turbine balance' && inOrder(v, S.sheetN['Back pressure in the turbine balance'])));
  ok(!badN.length, 'legacy: every number of every key-number row of the sheet as before (' + L.nums.length + ' rows)' + (badN.length ? '; differ: ' + badN.map(r => r[0] + ': ' + (S.sheetN[r[0]] || 'missing').slice(0, 160) + ' (was ' + r[1].slice(0, 160) + ')').join(' | ') : ''));
  const badG = Object.entries(L.glance).filter(([k, v]) => { const [gv] = v.split(' || '); if (k === 'run') return !inOrder(S.gl.run.v, gv); return !(S.gl[k] && inOrder(gv, S.gl[k].v)); });
  ok(!badG.length, 'legacy: every size on the glance card as before (' + Object.keys(L.glance).length + ' rows)' + (badG.length ? '; differ: ' + badG.map(([k, v]) => k + ': ' + (S.gl[k] ? S.gl[k].v : 'missing') + ' (was ' + v.split(' || ')[0] + ')').join(' | ') : ''));
  ok(/do not match/.test(S.gl.power.n), 'legacy: the mismatch warning is still there, pointing to What you know');
  await ctx.close();

  ok(!errs.length, 'no page or console errors' + (errs.length ? ': ' + errs.slice(0, 5).join(' | ') : ''));
  await b.close();
  console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed');
  process.exit(fails.length ? 1 : 0);
})();
