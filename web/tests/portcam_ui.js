const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); console.log((c?'PASS ':'FAIL ')+m); };
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
  const pg = await b.newPage({ viewport: vp, acceptDownloads: true }); const errs=[]; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd()+'/index.html'); await pg.waitForTimeout(500);
  await pg.evaluate(() => { document.body.classList.add('expert'); location.hash = 'four-stroke'; }); await pg.waitForTimeout(300);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  let hint = await pg.$eval('#f-cam-hint', e => e.textContent);
  ok(/Blank: the wave simulation assumes/.test(hint), vp.n+': cam hint explains the estimate');
  await setv('f-pshape', 'stadium'); await pg.waitForTimeout(100);
  ok(await pg.$eval('#f-ph-wrap', e => !e.hidden) && await pg.$eval('#f-pr-wrap', e => e.hidden), vp.n+': racetrack shows width and height only');
  const unit = await pg.$eval('#f-pw', e => e.nextElementSibling.textContent);
  const inch = /in/.test(unit);
  await setv('f-pw', inch ? String(43/25.4) : '43'); await setv('f-ph', inch ? String(31/25.4) : '31'); await pg.waitForTimeout(150);
  hint = await pg.$eval('#f-pshape-hint', e => e.textContent);
  ok(/1\.49 in|37\.9 mm/.test(hint), vp.n+': racetrack 43 x 31 mm gives 37.88 mm equivalent ('+hint.slice(0,120)+')');
  await setv('f-ivo', '32'); await setv('f-ivc', '44'); await setv('f-evc', '20'); await setv('f-evo', '48'); await pg.waitForTimeout(150);
  hint = await pg.$eval('#f-cam-hint', e => e.textContent);
  ok(/intake 256°/.test(hint) && /exhaust 248°/.test(hint) && /overlap 52°/.test(hint) && /lobe separation 100\.0°/.test(hint) && /4\.0° advanced/.test(hint), vp.n+': cam card 32/44/48/20 gives 256/248/52, LSA 100, 4° advanced');
  // the sim and the export use them
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('button[data-es="dl"]')]);
  const last = await pg.evaluate(() => window.__esLast);
  ok(last.spec.cam.ivo === 32 && last.spec.cam.ivc === 44 && last.spec.cam.evo === 48 && last.spec.cam.evc === 20, vp.n+': Engine Simulator file uses the cam card '+JSON.stringify(last.spec.cam));
  const cap = await pg.$eval('#four-details', e => e.innerText);
  ok(/cam 32-44 intake and 48-20 exhaust/i.test(cap), vp.n+': wave simulation states the cam it uses');
  // incomplete card is caught
  await setv('f-evc', ''); await pg.waitForTimeout(150);
  const t2 = await pg.$eval('#four-details', e => e.innerText);
  ok(/Enter all three cam events/i.test(t2), vp.n+': incomplete cam card is flagged');
  await setv('f-pshape', 'rrect'); await setv('f-pr', inch ? String(20/25.4) : '20'); await pg.waitForTimeout(150);
  hint = await pg.$eval('#f-pshape-hint', e => e.textContent);
  ok(/at most half the smaller side/.test(hint), vp.n+': corner radius too big is flagged');
  const all = await pg.$eval('#panel-four', e => e.innerText);
  ok(!/NaN|undefined/.test(all), vp.n+': no NaN or undefined');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), vp.n+': no sideways scroll');
  ok(errs.length===0, vp.n+': no page errors '+errs.join('|')); await pg.close(); }
  console.log(fails.length?'FAILED: '+fails.length:'all passed'); await b.close(); })();
