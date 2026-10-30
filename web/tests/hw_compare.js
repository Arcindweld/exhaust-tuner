const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await pg.goto('file://' + process.cwd()+'/index.html'); await pg.waitForTimeout(500);
  await pg.evaluate(() => { document.body.classList.add('expert'); location.hash = 'headers'; }); await pg.waitForTimeout(300);
  // metric units if there is a toggle
  const setv = async (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); if (el.tagName === 'SELECT') { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); } else { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } }, [id, v]);
  const u = await pg.$eval('#h-disp', e => e.nextElementSibling.textContent);
  await setv('h-eng', 'i4');
  await setv('h-disp', /cu/.test(u) ? String(1972.87 / 16.387064) : '1972.87');
  for (const [rpm, port] of [[7800, 150], [6500, 150]]) {
    await setv('h-rpm', String(rpm)); await setv('h-evo', '48');
    const pu = await pg.$eval('#h-port', e => e.nextElementSibling.textContent);
    await setv('h-port', /in/.test(pu) ? String(port / 25.4) : String(port));
    await setv('h-grp', 'all'); await setv('h-merge', 'triy'); await pg.waitForTimeout(200);
    const key = await pg.$eval('#h-key', e => e.innerText.replace(/\n+/g, ' | '));
    const det = await pg.$eval('#h-details', e => e.innerText);
    console.log('RPM', rpm, '\nKEY:', key.slice(0, 900));
    console.log('DET:', (det.match(/[^\n]*(length|Length|ID|diameter)[^\n]*\n[^\n]*/g) || []).slice(0, 30).join(' || ').slice(0, 2500));
  }
  await b.close(); })();
