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
    // results reader with a real AVG.DAT: OpenWAM 2.2's output for the Core tests' single-cylinder case (a committed fixture).
    // The expected numbers are worked out here from the file itself, not taken from the page: the last cycle's net
    // (indicated) torque, and the delivered VE = intake mass / (air density at 1.01325 bar and 25 C x swept volume), the page's definition,
    // with the swept volume from Net_Work_Cyl_1 / NMEP_Cyl_1 as the file gives them.
    const dat = path.join(__dirname, '..', '..', 'app', 'ExhaustTuner.Core.Tests', 'fixtures', 'single450AVG.DAT');
    if (fs.existsSync(dat)) {
      const L = fs.readFileSync(dat, 'utf8').trim().split(/\r?\n/), H = L[0].split('\t'), R = L[L.length - 1].split('\t').map(Number);
      const c = h => R[H.indexOf(h)];
      const tq = c('Net_Torque(Nm)'), vd = c('Net_Work_Cyl_1(J)') / (c('NMEP_Cyl_1(bar)') * 1e5), rho = 101325 / (287.05 * 298.15);
      const ve = c('Intake_Mass(kg/cc)') / (rho * vd);
      await pg.setInputFiles('#wam-files', [dat]); await pg.waitForTimeout(800);
      t = await pg.$eval('#panel-four', e => e.innerText);
      ok(/single450/.test(t) && t.includes(tq.toFixed(1) + ' N·m') && t.includes(Math.round(ve * 100) + '%'),
        vp.n + ': AVG.DAT read: ' + tq.toFixed(1) + ' N·m, ' + Math.round(ve * 100) + '% VE, as worked out from the file');
      ok(/yes|moving/.test(t), vp.n + ': settled column');
    } else console.log('SKIP: AVG.DAT reader, fixture missing: ' + dat);
    // the run the Method text quotes (2.0 L four, 6,000 RPM: 195 N·m net, 107 % delivered VE), kept in openwam/ref
    const dat4 = path.join(__dirname, '..', '..', 'openwam', 'ref', 'i4_41_6000', 'i4_41_6000AVG.DAT');
    if (fs.existsSync(dat4)) {
      await pg.setInputFiles('#wam-files', [dat4]); await pg.waitForTimeout(800);
      t = await pg.$eval('#panel-four', e => e.innerText);
      ok(/i4_41_6000/.test(t) && /195\.2 N·m/.test(t) && /\b107%/.test(t), vp.n + ': the Method note\'s run reads 195.2 N·m and 107% VE');
    } else console.log('SKIP: the Method note\'s OpenWAM run is missing: ' + dat4);
    ok(!/NaN|undefined|\[object/.test(t), vp.n + ': no NaN/undefined');
    const sw = await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok(sw, vp.n + ': no sideways scroll');
    ok(errs.length === 0, vp.n + ': no page errors ' + errs.join(' | '));
    await pg.close();
  }
  console.log(fails.length ? 'FAILS ' + fails.length : 'all passed'); await b.close();
})();
