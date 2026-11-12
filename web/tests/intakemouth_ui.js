// The intake's mouth recorded in the page's own OpenWAM case (ins_intake) and read back as its own column with a roadside
// level. Runs OpenWAM on a 6-cycle case when the solver is here (a few seconds); otherwise skips the run part.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { skipPart, openwam } = require('./skip.js');
(async () => {
  const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke'); await pg.waitForTimeout(300);
  await pg.selectOption('#wam-insmouth', '1'); await pg.waitForTimeout(200);
  await pg.fill('input.wamx[data-k="rpms"]', '4000'); await pg.dispatchEvent('input.wamx[data-k="rpms"]', 'input');
  await pg.fill('input.wamx[data-k="cycles"]', '6'); await pg.dispatchEvent('input.wamx[data-k="cycles"]', 'input');
  await pg.click('button[data-wam="dl"]'); await pg.waitForTimeout(800);
  const f = await pg.evaluate(() => window.__wamLast.files.filter(x => /\.wam$/.test(x.name)).map(x => [x.name, x.text]));
  ok(f.length === 1 && /intake's open end/.test(f[0][1]) && /ins_intake|INS/.test(f[0][1]), 'the case carries the intake open-end point');
  const exe = openwam();   // EXHAUST_TUNER_OPENWAM, as the other OpenWAM tests (this one used to look in ext/ only)
  if (!fs.existsSync(exe)) { skipPart('the OpenWAM run: no OpenWAM build at ' + exe + ' (EXHAUST_TUNER_OPENWAM)'); await b.close(); console.log('failures:', fails.length); process.exit(fails.length ? 1 : 0); }
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mouth-')); fs.writeFileSync(path.join(dir, f[0][0]), f[0][1]);
  execFileSync(exe, [f[0][0]], { cwd: dir, stdio: 'ignore', timeout: 600000 });
  const insF = path.join(dir, f[0][0].replace(/\.wam$/, 'INS.DAT'));
  ok(fs.existsSync(insF), 'OpenWAM wrote the INS file');
  await pg.setInputFiles('#wam-ins', insF); await pg.waitForTimeout(2000);
  const txt = await pg.evaluate(() => document.getElementById('panel-four').innerText);
  ok(/intake mouth/.test(txt), 'an intake mouth column appears');
  const cols = await pg.evaluate(() => [...document.querySelectorAll('#panel-four thead th')].map(t => t.textContent).filter(t => /4000/.test(t)));
  ok(cols.length === 2, 'two columns for the one run: outlet and intake mouth (' + cols.length + ')');
  { const lv = (txt.replace(/\n/g, ' ').match(/Level at 50 ft, hard ground.{0,200}/) || [''])[0]; ok((lv.match(/dB\(A\)/g) || []).length >= 2, 'both get a roadside level: ' + lv.slice(0, 160)); }
  ok(!/\bNaN\b/.test(txt) && !errs.length, 'no NaN, no page errors ' + errs.join(' | '));
  await b.close(); console.log('failures:', fails.length); process.exit(fails.length ? 1 : 0);
})();
