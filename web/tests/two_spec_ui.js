// 2-Stroke tab, "From the engine": Blair's chamber sized from bore, stroke and power. BMEP from the power, Blair's
// gas temperature and constants by BMEP, two stages = calcTwoBlair exactly, three stages keep Blair's diameters at
// his stage ends, the powerband slider moves diameters only; the 125 cc case run in 2 Stroke Wizard 8 for comparison.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#two-stroke'); await pg.waitForTimeout(500);
  const r = await pg.evaluate(() => {
    const T = window.__two, base = { rpm: 11500, ed: 194, bore: 54, stroke: 54.5, cyl: 1, hp: 38, td: 130, pshape: 'round', pw: 38, port: 60, bias: 0 };
    const s3 = T.calcTwoSpec(Object.assign({}, base, { stg: 3 })), s2 = T.calcTwoSpec(Object.assign({}, base, { stg: 2 }));
    const bl = T.calcTwoBlair({ rpm: 11500, ed: 194, exd: 38, type: 'gp', port: 60 });
    const race = T.calcTwoSpec(Object.assign({}, base, { stg: 3, bias: -100 })), broad = T.calcTwoSpec(Object.assign({}, base, { stg: 3, bias: 100 }));
    const mx = T.calcTwoSpec(Object.assign({}, base, { stg: 2, hp: 30.7 }));   // 9.57 bar
    const two = T.calcTwoSpec(Object.assign({}, base, { stg: 2, cyl: 2, hp: 76 }));
    return { s3: { bmep: s3.bmep, T: s3.T, lt: s3.lt, segs: s3.segs.map(s => [s.name, s.len, s.d0, s.d1]), blow: s3.blow, D: s3.D },
      s2: { segs: s2.segs.map(s => [s.len, s.d0, s.d1]) }, bl: bl.segs.map(s => [s.len, s.d0, s.d1]),
      race: race.D, broad: broad.D, raceLt: race.lt, broadLt: broad.lt, mx: { bmep: mx.bmep, T: mx.T, k: mx.kD }, two: two.bmep,
      e1: T.calcTwoSpec(Object.assign({}, base, { hp: NaN })).err || '', e2: T.calcTwoSpec(Object.assign({}, base, { pw: NaN })).err || '' };
  });
  const s3 = r.s3;
  ok(Math.abs(s3.bmep - 11.84) < 0.01, 'BMEP from 38 hp, 124.8 cc at 11,500: ' + s3.bmep.toFixed(3) + ' bar (2 Stroke Wizard 8: 11.85)');
  ok(s3.T === 650 && Math.abs(s3.lt - 856.05) < 0.1, 'Grand Prix class: 650 °C gas, tuned length ' + s3.lt.toFixed(1) + ' mm (Wizard 868.5)');
  ok(JSON.stringify(r.s2.segs.map(x => x.map(v => +v.toFixed(6)))) === JSON.stringify(r.bl.map(x => x.map(v => +v.toFixed(6)))), 'two stages: exactly Blair’s two-stage pipe');
  const d3 = s3.segs.filter(x => /diffuser/.test(x[0]));
  ok(d3.length === 3 && Math.abs(d3[1][3] - s3.D[2]) < 1e-9 && Math.abs(d3[2][3] - s3.D[3]) < 1e-9 && d3[0][3] > s3.D[1] && d3[0][3] < s3.D[2], 'three stages: Blair’s D2 and belly kept, the split point between his D1 and D2');
  const ang = d3.map(x => 2 * Math.atan((x[3] - x[2]) / 2 / x[1]) * 180 / Math.PI);
  ok(ang[0] < ang[1] && ang[1] < ang[2], 'the cones open progressively: ' + ang.map(a => a.toFixed(1)).join(' < ') + '°');
  ok(Math.abs(s3.segs.slice(0, 6).reduce((a, x) => a + x[1], 0) - s3.lt) < 1e-6, 'header to baffle adds up to the tuned length');
  ok(Math.abs(s3.blow - 32) < 1e-9, 'blowdown (194 − 130) / 2 = 32°');
  ok(r.raceLt === r.broadLt && r.race[3] > s3.D[3] - 1e-9 && r.broad[3] < s3.D[3] && r.broad[4] > r.race[4], 'powerband: lengths fixed, race keeps the GP belly, broad a smaller belly and bigger stinger');
  ok(Math.abs(r.mx.bmep - 9.57) < 0.02 && r.mx.T > 600 && r.mx.T < 610 && Math.abs(r.mx.k.K2 - (2.75 + (r.mx.bmep - 9.5) / 1.5 * 0.5)) < 1e-9, 'between classes: temperature and constants on the line (' + r.mx.bmep.toFixed(2) + ' bar, ' + r.mx.T.toFixed(1) + ' °C)');
  ok(Math.abs(r.two - s3.bmep) < 1e-9, 'a twin at twice the power: the same BMEP');
  ok(/Fill in the RPM/.test(r.e1) && /Exhaust port at the flange/.test(r.e2), 'missing power or port refused');
  // 2 Stroke Wizard's own sample engine, a vintage Maico 490: below Blair's enduro class, the gas temperature on the line
  // toward his road engine (5 bar, 350 C), enduro diameters
  const mai = await pg.evaluate(() => window.__two.calcTwoSpec({ rpm: 6500, ed: 179, bore: 86.5, stroke: 83, cyl: 1, hp: 53, td: 123, pshape: 'round', pw: 43, port: 55, bias: 0, stg: 3 }));
  ok(Math.abs(mai.bmep - 7.48) < 0.01 && Math.abs(mai.T - 474.0) < 0.1 && Math.abs(mai.lt - 1257.2) < 0.2 && Math.abs(mai.D[3] - 96.75) < 1e-9 && Math.abs(mai.D[4] - 30.1) < 1e-9,
    'Maico 490 (the Wizard’s sample): ' + mai.bmep.toFixed(2) + ' bar, ' + mai.T.toFixed(0) + ' C, ' + mai.lt.toFixed(1) + ' mm (Wizard 1,189.2), belly ' + mai.D[3].toFixed(1) + ' (89.3), stinger ' + mai.D[4].toFixed(1) + ' (22.8)');
  // dual power insert: second tuned length at the second RPM, the cone from the belly end, its pipe end at that length,
  // fitting 3 mm inside the baffle and stinger
  const dp = await pg.evaluate(() => {
    const T = window.__two, o = { rpm: 11500, ed: 194, bore: 54, stroke: 54.5, cyl: 1, hp: 38, pshape: 'round', pw: 38, port: 60, bias: 0, stg: 3 };
    const x = T.calcTwoSpec(Object.assign({}, o, { dual: true })), y = T.calcTwoSpec(Object.assign({}, o, { dual: true, rpm2: 12000 }));
    const z = T.calcTwoSpec(Object.assign({}, o, { dual: true, rpm2: 5000 }));
    const d = x.dual, Lb = x.L[4], D3 = x.D[3], D4 = x.D[4];
    let worst = 1e9; for (const xx of [...Array(101).keys()].map(i => d.Li * i / 100).concat([Math.min(Lb, d.Li)])) { const inner = d.Dm + (d.di - d.Dm) * xx / d.Li, outer = xx <= Lb ? D3 + (D4 - D3) * xx / Lb : D4; worst = Math.min(worst, (outer - inner) / 2); }
    return { d, lt: x.lt, x0: x.L[0] + x.L[1] + x.L[2] + x.L[3], worst, D4, yNotes: y.notes.map(n => n.t).join(' '), yDual: y.dual, zNotes: z.notes.map(n => n.t).join(' '), off: T.calcTwoSpec(o).dual };
  });
  ok(Math.abs(dp.d.rpm2 - 0.89 * 11500) < 1e-9 && Math.abs(dp.d.L2 - dp.lt * 11500 / dp.d.rpm2) < 1e-6, 'second point 89% of peak (' + Math.round(dp.d.rpm2) + ' RPM), second tuned length ' + dp.d.L2.toFixed(1) + ' mm (Dual Power on this engine: 975.7)');
  ok(Math.abs(dp.d.x0 - dp.x0) < 1e-9 && Math.abs(dp.d.x0 + dp.d.Li + dp.d.Lp - dp.d.L2) < 1e-9, 'the insert starts at the belly end and its pipe ends at the second tuned length');
  ok(Math.abs(dp.d.Li / (dp.d.Li + dp.d.Lp) - 0.84) < 1e-9 && Math.abs(dp.d.di - 0.6 * dp.D4) < 1e-9, 'cone 84% of the run, pipe 0.6 of the stinger');
  ok(dp.worst > 3 - 1e-6 && dp.worst < 3 + 1e-3, 'the cone fits 3 mm inside the baffle and stinger at its tightest (' + dp.worst.toFixed(2) + ' mm)');
  ok(!dp.yDual && /below the peak/.test(dp.yNotes), 'a second point above the peak is refused');
  ok(/out of the end of the stinger/.test(dp.zNotes), 'a second point too low for the stinger is refused');
  ok(dp.off === null, 'no insert unless asked');
  // the tab
  await pg.click('#m-expert'); await pg.click('#u-met');
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await setv('t-shape', 'spec');
  for (const [id, v] of [['t-rpm', '11500'], ['t-ed', '194'], ['t-bore', '54'], ['t-stroke', '54.5'], ['t-hp', '38'], ['t-td', '130'], ['t-pw', '38'], ['t-port', '60']]) await setv(id, v);
  await pg.waitForTimeout(300);
  const key = await pg.$eval('#two-key', e => e.innerText), det = await pg.$eval('#two-details', e => e.innerText);
  ok(/856/.test(key) && /11\.84/.test(key) && /Grand Prix/.test(key), 'the tab shows the tuned length and BMEP');
  ok(/Third diffuser/.test(det) && /Blowdown/.test(det) && /Stinger/.test(det) && !/NaN|undefined/.test(det + key), 'sections, blowdown, no NaN');
  ok(await pg.$eval('#t-dh', e => e.closest('label').hidden) && !(await pg.$eval('#t-spec-wrap', e => e.hidden)), 'the engine inputs replace the port-diameter box');
  await setv('t-pshape', 'stadium'); await setv('t-ph', '30'); await pg.waitForTimeout(200);
  ok(!(await pg.$eval('#t-ph-wrap', e => e.hidden)) && /Width/.test(await pg.$eval('#t-pw-lab', e => e.textContent)), 'a racetrack port asks for width and height');
  await setv('t-dual', '1'); await pg.waitForTimeout(300);
  const det2 = await pg.$eval('#two-details', e => e.innerText);
  ok(/Dual power insert/.test(det2) && /Second tuned length/.test(det2) && !(await pg.$eval('#t-rpm2-wrap', e => e.hidden)) && !/NaN|undefined/.test(det2), 'the tab shows the insert and its inputs');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
