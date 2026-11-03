// Writes fixtures/wave_jobs.json: the jobs the page hands its wave-simulation workers for three designs (a 450 single
// with a chamber, a four on one collector, the Headers tab's unequal-length Tri-Y layout), for wave_wasm.js to run
// through the JavaScript model and the Rust (WebAssembly) one. Run again when simSpec or simVariants change.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
(async () => {
  const b = await chromium.launch();
  const page = async () => {
    const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
    await p.addInitScript(() => {
      window.__jobs = [];
      const post = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (m) { if (m && m.variants) window.__jobs.push(JSON.parse(JSON.stringify(m))); this.terminate(); };
    });
    await p.goto('file://' + path.join(__dirname, '..', 'index.html')); await p.waitForTimeout(900);
    return p;
  };
  const set = (p, id, v) => p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const grab = async (p, name) => {
    await p.click('button[data-sim="run"]'); await p.waitForFunction(() => window.__jobs.length > 0, null, { timeout: 15000 });
    const jobs = await p.evaluate(() => window.__jobs);
    const job = Object.assign({}, jobs[0], { variants: [].concat(...jobs.map(j => j.variants)) });
    return { name, job };
  };
  const out = [];
  // the 450 single with a chamber (sim_ui.js)
  let p = await page();
  await p.evaluate(() => { location.hash = 'four-stroke'; }); await p.click('#m-expert');
  await p.selectOption('#f-n', '1');
  for (const [id, v] of [['#f-rpm', '8500'], ['#f-evo', '65'], ['#f-dp', '1.65'], ['#f-disp', '27.4'], ['#f-cyl', '1'], ['#f-trq', '7000'], ['#f-bore', '3.74'], ['#f-stroke', '2.496'], ['#f-cratio', '13']]) { await p.fill(id, v); await p.dispatchEvent(id, 'input'); }
  await p.selectOption('#f-valves', '4'); await p.selectOption('#f-ch', 'can');
  out.push(await grab(p, 'single with a chamber'));
  // a four on one collector
  p = await page();
  await p.evaluate(() => { location.hash = 'four-stroke'; }); await p.click('#m-expert');
  await set(p, 'f-cyl', '4'); await set(p, 'f-n', '4'); await p.waitForTimeout(300);
  out.push(await grab(p, 'four on one collector'));
  // the Headers tab's unequal-length Tri-Y (uel_sim_ui.js)
  p = await page();
  await p.evaluate(() => { document.getElementById('u-met').click(); document.body.classList.add('expert'); location.hash = 'headers'; }); await p.waitForTimeout(400);
  await set(p, 'h-eng', 'f4'); await set(p, 'h-disp', '2457'); await set(p, 'h-grp', 'all'); await set(p, 'h-merge', 'triy'); await p.waitForTimeout(150);
  await set(p, 'h-pairs', '1,3 | 2,4'); await set(p, 'h-lenmode', 'unequal'); await p.waitForTimeout(300);
  for (const [c, v] of [[1, 430], [2, 600], [3, 430], [4, 600]]) await p.fill('#h-len-c' + c, String(v));
  await p.fill('#h-sec-g1', '350'); await p.fill('#h-sec-g2', '650'); await p.waitForTimeout(300);
  await p.evaluate(() => { location.hash = 'four-stroke'; }); await p.waitForTimeout(400);
  await set(p, 'f-disp', '2457'); await set(p, 'f-cyl', '4'); await p.waitForTimeout(300);
  out.push(await grab(p, 'unequal-length Tri-Y'));
  await b.close();
  fs.mkdirSync(path.join(__dirname, 'fixtures'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'wave_jobs.json'), JSON.stringify(out));
  out.forEach(o => console.log(o.name + ': ' + o.job.variants.length + ' designs, ' + o.job.rpms.length + ' speeds, dx ' + o.job.dx +
    ', cylinders ' + (o.job.variants[0].spec.opt && o.job.variants[0].spec.opt.phases ? o.job.variants[0].spec.opt.phases.length : 1)));
})().catch(e => { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); });
