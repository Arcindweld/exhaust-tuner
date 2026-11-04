// Skin temperature and clearance (Headers tab): the heat model against the research note's independent sanity run
// (docs/research/header_skin_temperature.md, 1-3/4 x 0.065 in 304, 40 C still air, CAF 2.5), the physics it has to
// show (wrap: cooler outside, hotter steel; low emissivity: less heat out, hotter tube; moving air cools), a range check
// against the NHTSA high-idle runner readings, the clearance table on the tab, and projects keeping the settings.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [], fails = []; pg.on('pageerror', e => errs.push(e.message));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  await pg.goto('file://' + process.cwd() + '/index.html#headers'); await pg.waitForTimeout(600);
  const r = await pg.evaluate(() => {
    const H = window.__heat, base = { mdot: 0.055, Tg: 850, di: 41.148, wall: 1.651, mat: '304', Ta: 40, v: 0, L: 800, caf: 2.5 };
    const f = o => H.calcSkin(Object.assign({}, base, o));
    const p0 = s => s.pts[0];
    const bare = f({ fin: 'ox' }), newT = f({ fin: 'new' }), wrap = f({ fin: 'wrap1', wrapK: 0.06 }), cruise = f({ fin: 'ox', mdot: 0.006, Tg: 650 }), fan = f({ fin: 'ox', v: 10 });
    const idle = f({ fin: 'ox', mdot: 0.0035, Tg: 600, L: 400 });
    const near = [0, 50, 100, 200].map(s => H.nearTemp(700, 44.45, s, 40, 0.9, 300, 0.85));
    return { bare: [p0(bare).Tsurf, p0(bare).q], newT: [p0(newT).Tsurf, p0(newT).q], wrap: [p0(wrap).Tsurf, p0(wrap).Tsteel, p0(wrap).q], cruise: p0(cruise).Tsurf,
      fan: p0(fan).Tsurf, gasDrop: bare.pts[0].Tg - bare.pts[bare.pts.length - 1].Tg, idle: [p0(idle).Tsurf, idle.pts[idle.pts.length - 1].Tsurf, idle.lowRe], near,
      lowEps: H.clearFor(770, 44.45, 40, 90, 300, 0.3), hiEps: H.clearFor(770, 44.45, 40, 90, 300, 0.85), err: H.calcSkin(Object.assign({}, base, { mdot: 0 })).err || '' };
  });
  ok(Math.abs(r.bare[0] - 703) < 8 && Math.abs(r.bare[1] - 7000) < 400, 'WOT bare oxidised: ' + r.bare[0].toFixed(0) + ' C skin, ' + (r.bare[1] / 1000).toFixed(2) + ' kW/m (research sanity run: 703 C, 7.0 kW/m)');
  ok(Math.abs(r.newT[0] - 770) < 8 && Math.abs(r.newT[1] - 3800) < 300, 'emissivity 0.3: hotter (' + r.newT[0].toFixed(0) + ' C) and sheds less (' + (r.newT[1] / 1000).toFixed(2) + ' kW/m; run: 770 C, 3.8)');
  ok(Math.abs(r.wrap[0] - 413) < 10 && Math.abs(r.wrap[1] - 806) < 10 && Math.abs(r.wrap[2] - 2100) < 200, 'one layer of wrap: ' + r.wrap[0].toFixed(0) + ' C outside, steel ' + r.wrap[1].toFixed(0) + ' C (run: 413 / 806)');
  ok(Math.abs(r.cruise - 409) < 10, 'cruise 6 g/s at 650 C: ' + r.cruise.toFixed(0) + ' C (run: 409)');
  ok(r.fan < r.bare[0] - 20, 'air moving past at 10 m/s cools it (' + r.fan.toFixed(0) + ' C)');
  ok(r.gasDrop > 30 && r.gasDrop < 150, 'the gas cools along 800 mm of bare tube: ' + r.gasDrop.toFixed(0) + ' C');
  ok(r.idle[0] > 300 && r.idle[0] < 560 && r.idle[2], 'high idle (3.5 g/s at 600 C): ' + r.idle[0].toFixed(0) + ' C at the port, inside the NHTSA runner readings (282 to 521 C), flagged as below Gnielinski’s range');
  ok(r.near.every((t, i) => i === 0 || t < r.near[i - 1]) && r.near[3] > 40, 'a nearby part cools with distance: ' + r.near.map(t => t.toFixed(0)).join(' > ') + ' C');
  ok(r.lowEps < r.hiEps, 'a low-emissivity tube at the same skin temperature needs less gap (' + r.lowEps.toFixed(0) + ' vs ' + r.hiEps.toFixed(0) + ' mm)');
  ok(/Needs the tube size/.test(r.err), 'no flow refused');
  // the tab
  await pg.click('#m-expert');
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  await setv('h-eng', 'ls'); await pg.waitForTimeout(300);
  const sec = await pg.evaluate(() => { const h = [...document.querySelectorAll('#h-details .sec h3')].find(x => /Skin temperature/.test(x.textContent)); return h ? h.parentElement.innerText : ''; });
  ok(/At the port/.test(sec) && /At the collector/.test(sec) && /Nylon fuel line/.test(sec) && /GM: 5 in/.test(sec) && !/NaN|undefined/.test(sec), 'the Headers tab shows the temperatures along the primary and the clearance table');
  await pg.selectOption('select.heatx[data-k="fin"]', 'wrap2'); await pg.waitForTimeout(300);
  const sec2 = await pg.evaluate(() => { const h = [...document.querySelectorAll('#h-details .sec h3')].find(x => /Skin temperature/.test(x.textContent)); return h ? h.parentElement.innerText : ''; });
  ok(/Wrap outside/.test(sec2) && /runs the steel hotter/.test(sec2), 'wrapped: the table shows the wrap outside and warns about the steel');
  const snap = await pg.evaluate(() => window.__proj.snapshot('x').ui.heat);
  ok(snap && snap.fin === 'wrap2', 'projects keep the heat settings');
  ok(errs.length === 0, 'no page errors ' + errs.join('|'));
  console.log(fails.length ? 'FAILS: ' + fails.length : 'all passed');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
