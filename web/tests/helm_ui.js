// The Helmholtz can in Fusion: the button sends the Mufflers tab's own neck, can and volume, and the can the add-in
// builds is read back as a frequency with the tab's Helmholtz formula (f = c / 2 pi x sqrt(A / (V Le))).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => {
    window.__sent = []; window.__reply = null; window.__delay = 0;
    window.adsk = { fusionSendData: (a, d) => {
      window.__sent.push([a, JSON.parse(d)]);
      const r = JSON.stringify(window.__reply || { ok: true, msg: 'stub', items: [] });
      return new Promise(res => setTimeout(() => res(r), window.__delay));
    } };
  });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  await pg.goto('file://' + process.cwd() + '/index.html#mufflers'); await pg.waitForTimeout(700);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const last = a => pg.evaluate(a => (window.__sent.filter(s => s[0] === a).pop() || [])[1], a);
  ok(await pg.$('#fx-muf button[data-fx="helmholtz"]') !== null, 'the Mufflers tab has Build the Helmholtz can');
  const f = +(await pg.$eval('#m-f', e => e.value));
  const det = await pg.$eval('#m-details', e => e.innerText);
  const volL = +((/Volume\s*([\d.]+) L/.exec(det) || [])[1]);
  const curIn = await pg.$eval('#m-details tr.cur td', e => e.innerText);

  await pg.evaluate(() => { window.__sent = []; window.__delay = 600; });
  await pg.click('#fx-muf button[data-fx="helmholtz"]'); await pg.waitForTimeout(120);
  const during = await pg.$eval('#fx-out-muf', e => e.innerText);
  const pay = await last('helmholtz');
  ok(/Building the can and its neck in Fusion/.test(during), 'a note shows while Fusion builds');
  ok(pay && Math.abs(pay.neck_id_mm - 50.8) < 1e-9 && Math.abs(pay.neck_len_mm - 76.2) < 1e-9 && Math.abs(pay.wall_mm - 1.651) < 1e-9,
     'the neck goes as the tab has it: 2 in ID, 3 in long, 0.065 in wall');
  ok(pay && Math.abs(pay.vol_cm3 / 1000 - volL) < 0.006, 'the volume is the tab\'s ' + volL + ' L (' + (pay && (pay.vol_cm3 / 1000).toFixed(3)) + ')');
  ok(pay && Math.abs(pay.can_id_mm / 25.4 - parseFloat(curIn)) < 0.01, 'the can is the one the tab picks: ' + curIn + ' (' + (pay && pay.can_id_mm) + ' mm)');
  ok(pay && Math.abs(pay.can_wall_mm - 1.519) < 1e-9 && pay.neck_into_mm === 0 && Math.abs(pay.main_od_mm - 63.5) < 1e-6,
     'can wall 16 ga, neck flush, main pipe 2.5 in OD for the scan fit');
  ok(pay && !('target_mm' in pay) && !('cap' in pay), 'none of the J-pipe settings go with the can');
  await pg.waitForTimeout(700);              // let that first (slow) reply land before the next ones

  // the reply: a can that holds the tab's volume tunes to the target
  const gas = pay.vol_cm3;
  await pg.evaluate(([gas, can]) => { window.__delay = 0; window.__reply = { ok: true, msg: 'Built the Helmholtz can.', items: [
    { kind: 'part', name: 'Helmholtz can', ok: true, min_gap: 2.0, helm: { gas_cm3: gas, neck_id_cm: 5.08, neck_len_cm: 7.62, can_id_cm: can / 10, can_len_cm: 30 } },
    { kind: 'neck', name: 'Helmholtz can neck', length: 7.62 }] }; }, [gas, pay.can_id_mm]);
  await pg.click('#fx-muf button[data-fx="helmholtz"]'); await pg.waitForTimeout(250);
  let res = await pg.$eval('#fx-out-muf', e => e.innerText);
  ok(new RegExp('As built, tunes to\\s*' + Math.round(f) + ' Hz').test(res) && /Gas volume as built/.test(res), 'a can holding the tab\'s volume tunes to the target ' + Math.round(f) + ' Hz');
  ok(/Smallest gap, case to scan/.test(res), 'the can\'s clearance shows');
  ok(!/J-pipe cut length/.test(res), 'the neck gets no J-pipe rows');
  ok(!/Use as pipe length|Use as space for a muffler/.test(res), 'and no buttons that would copy its length into the tab');
  // 10 % more gas tunes lower by sqrt(1.1)
  await pg.evaluate(gas => { window.__reply.items[0].helm.gas_cm3 = gas * 1.1; }, gas);
  await pg.click('#fx-muf button[data-fx="helmholtz"]'); await pg.waitForTimeout(250);
  res = await pg.$eval('#fx-out-muf', e => e.innerText);
  const fl = +((/As built, tunes to\s*(\d+) Hz/.exec(res) || [])[1]); if (!(fl > 0)) console.log('  result was: ' + res.replace(/\s+/g, ' ').slice(0, 600));
  ok(Math.abs(fl - f / Math.sqrt(1.1)) <= 0.51, '10 % more gas tunes to ' + fl + ' Hz (formula ' + (f / Math.sqrt(1.1)).toFixed(1) + ')');

  // the neck run into the can, and a heavier can wall
  await setv('m-nin', String(30 / 25.4)); await setv('m-cw', String(0.0747)); await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__sent = []; window.__reply = null; });
  await pg.click('#fx-muf button[data-fx="helmholtz"]'); await pg.waitForTimeout(250);
  const pay2 = await last('helmholtz');
  ok(pay2 && Math.abs(pay2.neck_into_mm - 30) < 0.01 && Math.abs(pay2.can_wall_mm - 0.0747 * 25.4) < 0.01, 'neck 30 mm into the can and a 14 ga can go with it');
  const det2 = await pg.$eval('#m-details', e => e.innerText);
  ok(/With the neck .* in, the .* can is .* longer to keep the volume round the neck/.test(det2), 'the tab says how much longer the can gets');

  // an error on the tab: nothing goes to Fusion
  await setv('m-dn', '0'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { window.__sent = []; });
  await pg.click('#fx-muf button[data-fx="helmholtz"]'); await pg.waitForTimeout(200);
  res = await pg.$eval('#fx-out-muf', e => e.innerText);
  const sent = await pg.evaluate(() => window.__sent.length);
  ok(sent === 0 && /Fill in the Helmholtz resonator above first/.test(res), 'with an error on the tab nothing is sent and the note says why');

  ok(errs.length === 0, 'no page errors ' + errs.join(' | '));
  console.log(fails.length ? 'FAILS: ' + fails.join('; ') : 'all Helmholtz checks passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
