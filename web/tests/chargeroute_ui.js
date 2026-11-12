// Fusion panel, Intake tab, "Charge piping from your scan", with the add-in stubbed: chargeRoute answers with the
// recommendation that fusion-addin/tests/test_chargeroute_fusion_fake.py's run produced (fixtures/chargeroute_reply.json,
// written with ET_WRITE_FIXTURES=1), chargeRouteBuild with that run's build. Checks: the note in a browser (no Fusion),
// the guide and the marker order, the request (legs, the Intake tab's tube sizes, the stocked radii from the parts list,
// the design flow from the tab), the routes listed in inches and mm, choosing one, the build, "Use this route's lengths
// and bends in the Intake tab", the clear errors, parity of the page's own bendK / visc / loss with the add-in's
// (fixtures/chargeroute_parity.json, and every routed candidate), no page errors, no sideways scroll at 400 px.
//   node tests/chargeroute_ui.js   (from web/)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => { const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const FX = JSON.parse(fs.readFileSync(__dirname + '/fixtures/chargeroute_reply.json', 'utf8'));
  const PAR = JSON.parse(fs.readFileSync(__dirname + '/fixtures/chargeroute_parity.json', 'utf8'));
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html');
  await pg.evaluate(() => { location.hash = 'intake'; }); await pg.waitForTimeout(400);
  // ---- in a browser: where it runs
  const note = await pg.$eval('#fx-intake', e => e.innerText).catch(() => '');
  ok(/runs in the Fusion add-in/.test(note) && /cannot read a scan/.test(note), 'no Fusion: the Intake tab says scan routing runs in the Fusion add-in');
  // ---- the Fusion bridge
  await pg.evaluate(([FX]) => {
    window.__sent = []; window.__reply = null;
    window.adsk = { fusionSendData: (a, d) => { window.__sent.push([a, d]); let r = { ok: true };
      if (a === 'chargeRoute') r = window.__reply || FX.reply;
      else if (a === 'chargeRouteBuild') r = FX.build;
      else if (a === 'setHotKeepouts') r = JSON.parse(d).clear ? { ok: true, msg: 'No keep-outs are marked hot now.' } : { ok: true, msg: '1 hot keep-out: Turbine box.', hot: ['Turbine box'] };
      else if (a === 'hostInfo') r = { ok: true, where: 'fusion', engines: {} };
      return Promise.resolve(JSON.stringify(r)); } };
  }, [FX]);
  await pg.waitForFunction(() => !!document.querySelector('#cr-block'), null, { timeout: 5000 });
  await pg.selectOption('#i-ind', 'turbo'); await pg.waitForTimeout(150);
  await pg.evaluate(() => { document.getElementById('cr-block').open = true; });
  const sentOf = a => pg.evaluate(a => window.__sent.filter(x => x[0] === a).map(x => JSON.parse(x[1] || '{}')), a);
  const guide = await pg.$$eval('#cr-guide li', ls => ls.map(l => l.innerText));
  ok(guide.length === 5 && /Set keep-outs/.test(guide[0]) && /Mark hot/.test(guide[1]) && /Recommend piping/.test(guide[4]), 'a five-step guide: scan, hot, markers, order, recommend');
  ok(/1\. Compressor outlet, 2\. intercooler inlet; 3\. Intercooler outlet, 4\. throttle body/.test(guide[3]), 'the marker order for the legs ticked: ' + guide[3]);
  ok(!/Charge piping from a scan<\/b> runs in the Fusion/.test(await pg.$eval('#fx-intake', e => e.innerHTML)), 'in Fusion the browser note is gone');

  // ---- the request
  await pg.click('#cr-block button[data-cr="rec"]'); await pg.waitForTimeout(300);
  const q = (await sentOf('chargeRoute'))[0] || { legs: [] };
  const tab = await pg.evaluate(() => ({ cpd: document.getElementById('i-cpd')._b, cpw: document.getElementById('i-cpw')._b, boost: document.getElementById('i-boost')._b }));
  ok(q.legs.length === 2 && q.legs[0].kind === 'hot' && q.legs[1].kind === 'cold', 'two legs sent, compressor to intercooler first');
  ok(q.legs.every(L => Math.abs(L.id_mm - tab.cpd) < 1e-9 && Math.abs(L.wall_mm - tab.cpw) < 1e-9 && L.gap_mm === 12.7),
     'each leg takes the Intake tab\'s charge pipe (' + tab.cpd + ' mm inside, ' + tab.cpw + ' mm wall) and 12.7 mm clearance');
  const od = (tab.cpd + 2 * tab.cpw) / 25.4;
  const stockWant = await pg.evaluate(od => { const s = window.__cut.bendStock().filter(x => Math.abs(x.od - od) <= 0.011 && /alum/i.test(x.mat || ''));
    return [...new Set(s.map(x => +(x.clr * 25.4).toFixed(3)))].sort((a, b) => a - b); }, od);
  const stockGot = q.legs[0].stock.map(s => s.clr_mm);
  ok(stockWant.length > 0 && JSON.stringify(stockGot) === JSON.stringify(stockWant) && q.legs[0].stock.every(s => s.angles.length && s.note),
     'stocked radii for ' + od.toFixed(3) + ' in aluminium tube from the parts list, with their angles and suppliers: ' + stockGot.join(', ') + ' mm');
  const atm = 101325, fl = q.legs.map(L => L.flow);
  ok(Math.abs(fl[0].p_Pa - (atm + tab.boost * 1000)) < 1e-6 && fl[0].T_C > fl[1].T_C && fl[0].m_kg_s > 0 && fl[0].m_kg_s === fl[1].m_kg_s && fl[0].rho_amb > 1,
     'design flow from the tab: ' + fl[0].m_kg_s.toFixed(4) + ' kg/s, ' + fl[0].T_C.toFixed(1) + ' C at ' + Math.round(fl[0].p_Pa) + ' Pa hot, ' + fl[1].T_C.toFixed(1) + ' C cold');
  ok(q.hot_gap_mm === 50.8 && q.coupler_mm === 76.2 && q.joints === 'weld' && q.min_straight_mm === 0, 'defaults sent: hot 50.8 mm, coupler 76.2 mm, welded, no minimum straight');

  // ---- the routes listed
  const tabs = await pg.$$eval('#cr-out table.crtab', ts => ts.map(t => [...t.querySelectorAll('tbody tr')].map(r => [...r.cells].map(c => c.innerText))));
  const okC = FX.reply.plan.legs.map(L => L.candidates.filter(c => c.ok));
  ok(tabs.length === 2 && tabs[0].length === okC[0].length && tabs[1].length === okC[1].length, 'every route that fits is listed: ' + tabs.map(t => t.length).join(' and '));
  const dual = /\d[\d./ ]* in \([\d.]+ mm\)/;
  ok(tabs.flat().every(r => dual.test(r[2]) && dual.test(r[3]) && dual.test(r[7]) && /Pa \([\d.]+ inH₂O\)/.test(r[5]) && /L \(\d+ in³\)/.test(r[6])),
     'radius, length and clearance in inches and mm, loss in Pa and inH2O, volume in L and cubic inches: ' + tabs[0][0].join(' | ').replace(/\n/g, ' '));
  ok(tabs[0].map(r => +r[1]).join() === okC[0].map(c => c.rank).join() && okC[0][0].rank === 1, 'listed in rank order');
  const checked = await pg.$$eval('#cr-out input[type=radio]:checked', rs => rs.map(r => +r.value));
  ok(checked.length === 2 && checked[0] === okC[0][0].id && checked[1] === okC[1][0].id, 'the lowest-loss route of each leg is picked');
  let out = await pg.$eval('#cr-out', e => e.innerText);
  ok(/Smallest clearance [\d./ ]+ in \([\d.]+ mm\) at \(/.test(out) && /to hot bodies/.test(out) && /Couplers: start/.test(out) && /Total/.test(out),
     'the chosen route: smallest clearance and where, hot clearance, couplers, cut list with its total');
  const cut = await pg.$$eval('#cr-out table:not(.crtab)', ts => [...ts[0].querySelectorAll('tbody tr')].map(r => r.innerText));
  ok(cut.some(r => /Bend [\d.]+° on .* in \([\d.]+ mm\) CLR/.test(r) && /stock bend/.test(r)) && cut.some(r => /^\d+\s+Straight\s+[\d /]+ in \([\d.]+ mm\)/.test(r)), 'cut list rows in inches and mm');
  // ---- choose the second route of leg 1, build
  await pg.check('#cr-out input[name="cr-pick-0"][value="' + okC[0][1].id + '"]'); await pg.waitForTimeout(100);
  out = await pg.$eval('#cr-out', e => e.innerText);
  ok(/Route 2: /.test(out), 'choosing route 2 shows its detail');
  await pg.click('#cr-block button[data-cr="build"]'); await pg.waitForTimeout(200);
  const bq = (await sentOf('chargeRouteBuild'))[0] || {};
  ok(JSON.stringify(bq.choice) === JSON.stringify([okC[0][1].id, okC[1][0].id]), 'the build asks for the routes chosen: ' + JSON.stringify(bq.choice));
  ok((await pg.$eval('#cr-out', e => e.innerText)).includes(FX.build.msg), 'the build\'s answer is shown');
  // ---- use in the Intake tab
  await pg.click('#cr-block button[data-cr="use"]'); await pg.waitForTimeout(200);
  const after = await pg.evaluate(() => ({ cph: document.getElementById('i-cph')._b, cpc: document.getElementById('i-cpc')._b, cpb: document.getElementById('i-cpb')._b,
    shown: document.getElementById('i-cph').value }));
  const ch = okC[0][1], cc = okC[1][0];
  const eq = await pg.evaluate(([ch, cc, id]) => { const K = window.__intakeK.bendK; return [...ch.bends, ...cc.bends].reduce((s, b) => s + K(b.angle_deg, b.clr_mm / id, 1) / K(90, 1.5, 1), 0); }, [ch, cc, tab.cpd]);
  ok(Math.abs(after.cph - ch.length_mm) < 1e-9 && Math.abs(after.cpc - cc.length_mm) < 1e-9 && after.cpb === Math.round(eq),
     'Intake tab: hot side ' + after.cph.toFixed(1) + ' mm, cold side ' + after.cpc.toFixed(1) + ' mm, ' + after.cpb + ' equivalent 90° bends (' + eq.toFixed(2) + ' by Crane K)');
  ok(/Set on the Intake tab: hot side/.test(await pg.$eval('#cr-out', e => e.innerText)) && Math.abs(+after.shown - ch.length_mm / 25.4) < 0.001, 'it says what it set, and the input shows it in inches');
  ok(await pg.evaluate(() => !!(window.CR_ROUTE_BENDS && window.CR_ROUTE_BENDS.hot && window.CR_ROUTE_BENDS.hot.length)), 'the bends are kept for per-side inputs');
  // ---- parity: the page's own formulas against the add-in's
  const par = await pg.evaluate(([PAR, legs, REQ]) => { const K = window.__intakeK.bendK, cr = window.__cr; let worst = 0, worstV = 0, worstL = 0, worstC = 0;
    PAR.bend_k.forEach(([d, rd, f, k]) => { worst = Math.max(worst, Math.abs(K(d, rd, f) - k) / Math.max(1e-12, Math.abs(k))); });
    PAR.visc.forEach(([t, mu]) => { worstV = Math.max(worstV, Math.abs(cr.visc(t) - mu) / mu); });
    PAR.leg_loss.forEach(c => { const r = cr.crLoss(c.length_mm, c.bends, c.id_mm, c.flow); worstL = Math.max(worstL, Math.abs(r.dp - c.dp_Pa) / c.dp_Pa, Math.abs(r.fill_s - c.fill_s) / c.fill_s); });
    legs.forEach((L, i) => L.candidates.filter(c => c.ok).forEach(c => { const r = cr.crLoss(c.length_mm, c.bends.map(b => [b.angle_deg, b.clr_mm]), REQ.legs[i].id_mm, REQ.legs[i].flow);
      worstC = Math.max(worstC, Math.abs(r.dp - c.dp_Pa) / c.dp_Pa, Math.abs(r.volume_L - c.volume_L) / c.volume_L); }));
    return { worst, worstV, worstL, worstC, n: PAR.bend_k.length }; }, [PAR, FX.reply.plan.legs, FX.request]).catch(e => ({ err: e.message }));
  ok(par.worst < 1e-12 && par.worstV < 1e-12, 'bendK and visc: the page and the add-in agree on ' + par.n + ' cases (worst ' + par.worst + ')');
  ok(par.worstL < 1e-9 && par.worstC < 1e-9, 'loss: the page recomputes the add-in\'s by-hand cases and every routed route to 1e-9 (worst ' + par.worstL + ', ' + par.worstC + ')');
  // ---- clear errors
  await pg.evaluate(() => { window.__reply = { ok: false, msg: '3 markers are selected; 4 are needed, a start and an end for each of the 2 legs ticked. Missing: the end marker of Intercooler outlet to throttle body.' }; });
  await pg.click('#cr-block button[data-cr="rec"]'); await pg.waitForTimeout(200);
  ok(/Missing: the end marker of Intercooler outlet to throttle body/.test(await pg.$eval('#cr-out .note.bad', e => e.innerText).catch(() => '')), 'the add-in\'s missing-marker error is shown');
  const nofit = JSON.parse(JSON.stringify(FX.reply)); nofit.route_ok = false; nofit.plan.ok = false;
  nofit.plan.legs[1] = Object.assign(nofit.plan.legs[1], { ok: false, best: null, msg: 'Intercooler outlet to throttle body: no route keeps 12.7 mm from the scan on the stocked bend radii tried (63.5 mm). Lower the clearance for this leg.' });
  nofit.plan.legs[1].candidates.forEach(c => c.ok = false);
  await pg.evaluate(r => { window.__reply = r; }, nofit);
  await pg.click('#cr-block button[data-cr="rec"]'); await pg.waitForTimeout(200);
  ok(/no route keeps 12\.7 mm .*Lower the clearance/.test(await pg.$eval('#cr-out', e => e.innerText)) && (await pg.$$('#cr-out table.crtab')).length === 1, 'a leg with no fit: its message, and the other leg still listed');
  await pg.evaluate(() => { window.__reply = null; });
  await pg.uncheck('#cr-block input.crleg-on[data-leg="hot"]'); await pg.uncheck('#cr-block input.crleg-on[data-leg="cold"]'); await pg.waitForTimeout(100);
  const n0 = (await sentOf('chargeRoute')).length;
  await pg.click('#cr-block button[data-cr="rec"]'); await pg.waitForTimeout(150);
  ok(/Tick at least one leg/.test(await pg.$eval('#cr-out', e => e.innerText)) && (await sentOf('chargeRoute')).length === n0, 'no leg ticked: says so, asks Fusion nothing');
  await pg.check('#cr-block input.crleg-on[data-leg="inlet"]'); await pg.waitForTimeout(100);
  ok(/1\. Filter, 2\. compressor inlet/.test(await pg.$eval('#cr-order', e => e.innerText)), 'the intake leg alone: the order follows');
  await pg.selectOption('#i-ind', 'na'); await pg.waitForTimeout(150);
  await pg.click('#cr-block button[data-cr="rec"]'); await pg.waitForTimeout(150);
  ok(/Set Forced induction on the Intake tab/.test(await pg.$eval('#cr-out', e => e.innerText)), 'naturally aspirated: asks for a turbo or blower');
  await pg.selectOption('#i-ind', 'turbo'); await pg.check('#cr-block input.crleg-on[data-leg="hot"]'); await pg.check('#cr-block input.crleg-on[data-leg="cold"]');
  await pg.click('#cr-block button[data-cr="hot"]'); await pg.waitForTimeout(150);
  ok(/1 hot keep-out: Turbine box/.test(await pg.$eval('#cr-out', e => e.innerText)) && (await sentOf('setHotKeepouts')).length === 1, 'Mark hot asks the add-in and shows its answer');
  // ---- units: the block is drawn again in mm, its values kept
  await pg.click('#u-met'); await pg.waitForTimeout(250);
  const met = await pg.evaluate(() => { const el = document.querySelector('#cr-block input.crx[data-k="legs.hot.gap"]'); return { v: el && el.value, u: el && el.nextElementSibling.textContent, open: document.getElementById('cr-block').open }; });
  ok(met.v === '12.7' && met.u === 'mm' && met.open, 'mm: the clearance reads 12.7 mm and the block stays open (' + JSON.stringify(met) + ')');
  await pg.click('#u-imp'); await pg.waitForTimeout(250);
  ok(await pg.evaluate(() => document.querySelector('#cr-block input.crx[data-k="legs.hot.gap"]').value) === '0.5', 'back in inches: 0.5 in');
  // ---- phone width
  await pg.click('#cr-block button[data-cr="rec"]'); await pg.waitForTimeout(250);
  await pg.setViewportSize({ width: 400, height: 860 }); await pg.waitForTimeout(250);
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '400 px: no sideways scroll (' + await pg.evaluate(() => document.documentElement.scrollWidth) + ' px)');
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? 'FAILED ' + fails.length : 'ALL PASS'); process.exit(fails.length ? 1 : 0);
})();
