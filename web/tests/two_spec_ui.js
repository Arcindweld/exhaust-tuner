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
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
