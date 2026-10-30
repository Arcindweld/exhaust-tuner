// OpenWAM section on the 4-Stroke tab: case files, zip, and the AVG.DAT reader
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
    const pg = await b.newPage({ viewport: vp }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + process.cwd()+'/index.html'); await pg.waitForTimeout(900);
    await pg.evaluate(() => { document.body.classList.add('expert'); location.hash = 'four-stroke'; }); await pg.waitForTimeout(600);
    let t = await pg.$eval('#panel-four', e => e.innerText);
    ok(/Run it in OpenWAM/i.test(t) && /Download OpenWAM case/i.test(t), vp.n + ': OpenWAM section present');
    const rpms = await pg.$eval('input.wamx[data-k="rpms"]', e => e.value);
    ok(/^\d{3,5}( \d{3,5})+$/.test(rpms), vp.n + ': default RPM list (' + rpms + ')');
    // build the case in page (plain browser path: anchor download) and inspect
    await pg.evaluate(() => { window.__dl = []; const a = document.createElement; });
    await pg.click('button[data-wam="dl"]'); await pg.waitForTimeout(800);
    const out = await pg.evaluate(() => window.__wamLast && { n: window.__wamLast.files.length, names: window.__wamLast.files.map(f => f.name), rpms: window.__wamLast.rpms, first: window.__wamLast.files[0].text.slice(0, 200), bat: window.__wamLast.files.find(f => /\.bat$/.test(f.name)).text.slice(0, 120) });
    ok(out && out.n === out.rpms.length + 2, vp.n + ': one .wam per speed plus bat and README (' + (out && out.names.join(', ')) + ')');
    ok(out && /OpenWAM/i.test(out.bat) && /\.wam/.test(out.names[0]), vp.n + ': bat and wam names');
    const msg = await pg.$eval('.wammsg', e => e.innerText);
    ok(/Downloaded|Saved/.test(msg), vp.n + ': message after download (' + msg.slice(0, 60) + ')');
    // results reader with a real AVG.DAT from the OpenWAM runs
    const dat = path.join(process.cwd(), 'openwam_run2', 'runs', 'i4_41_6000', 'i4_41_6000AVG.DAT');
    if (fs.existsSync(dat)) {
      await pg.setInputFiles('#wam-files', [dat]); await pg.waitForTimeout(800);
      t = await pg.$eval('#panel-four', e => e.innerText);
      ok(/i4_41_6000/.test(t) && /195\.\d N·m/.test(t) && /107%/.test(t), vp.n + ': AVG.DAT read: 195 N·m, 107% VE');
      ok(/yes|moving/.test(t), vp.n + ': settled column');
    } else console.log('  (no AVG.DAT sample found, reader not exercised)');
    ok(!/NaN|undefined|\[object/.test(t), vp.n + ': no NaN/undefined');
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok(sw, vp.n + ': no sideways scroll');
    ok(errs.length === 0, vp.n + ': no page errors ' + errs.join(' | '));
    await pg.close();
  }
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); await b.close();
})();
