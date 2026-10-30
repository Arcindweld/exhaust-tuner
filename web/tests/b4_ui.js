// Books batch 4 UI check: packed can, Davies rules, Yasuda check, motorcycle card (Mufflers); collector growth (Headers); sportiness lean (Sound).
// node b4_ui.js [page.html]   (default exhaust-calculator.b4base.html in the current directory)
const { chromium } = require('playwright');
const path = require('path');
const file = path.resolve(process.argv[2] || 'exhaust-calculator.b4base.html');
(async () => { const b = await chromium.launch(); const fails=[]; const ok=(c,m)=>{ if(!c) fails.push(m); console.log((c?'PASS ':'FAIL ')+m); };
  const badText = t => (t.match(/.{0,40}(\bNaN\b|\bundefined\b|\[object|Infinity).{0,40}/) || [null])[0];
  for (const vp of [{ width: 1280, height: 900, n: 'desk' }, { width: 390, height: 844, n: 'phone' }]) {
  const pg = await b.newPage({ viewport: vp }); const errs=[]; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + file);
  await pg.waitForTimeout(600);
  const setv = (id, v) => pg.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }, [id, v]);
  const txt = sel => pg.$eval(sel, el => el.innerText);
  await pg.evaluate(() => { document.body.classList.remove('simple'); document.body.classList.add('expert'); });
  // ---- Mufflers tab
  await pg.evaluate(() => { location.hash = 'mufflers'; }); await pg.waitForTimeout(400);
  let m = await txt('#m-details');
  ok(/Packed straight-through can/i.test(m) && /Removes at the 144 Hz target/.test(m) && /flow resistivity/.test(m), vp.n + ': packed can section renders');
  ok(/Curve holds up to about/.test(m) && /At the firing tone/.test(m), vp.n + ': packed can shows the plane-wave limit and the Sound tab firing tones');
  ok(!badText(m), vp.n + ': muffler details have no NaN/undefined' + (badText(m) ? ' -> ' + badText(m) : ''));
  const absPts = await pg.$$eval('#m-abs polyline', p => p.length);
  ok(absPts >= 1, vp.n + ': packed-can chart drawn (' + absPts + ' polyline)');
  const legend = await txt('#m-legend');
  ok(/Packed can/.test(legend), vp.n + ': packed can on the main transmission-loss chart legend');
  ok(/Silencer layout rules \(Davies 1996\)/i.test(m) && /Quarter-wave side branch for 144 Hz/.test(m) && /3\^\(−1\/3\)/.test(m) && /10 to 15 × the pipe area/.test(m), vp.n + ': Davies layout rules with the branch set and folded branch');
  ok(/Production muffler sizing check \(Yasuda 2013\)/i.test(m) && /Low-pass cut-off/.test(m) && /Split into two equal chambers/.test(m) && /400 mm² hole/.test(m) && /× displacement/.test(m), vp.n + ': Yasuda sizing check renders');
  ok(!/Motorcycle silencers/i.test(m), vp.n + ': motorcycle card hidden for the default V8');
  // the packed-can TL rises with frequency and with density, and the summary carries it
  const tlNums = await pg.evaluate(() => { const t = document.getElementById('m-details').innerText; const mm = t.match(/At the firing tone\n([^\n]+)/); return mm ? mm[1] : ''; });
  ok(/dB · .*dB · .*dB/.test(tlNums), vp.n + ': firing-tone row has three TL values (' + tlNums + ')');
  await setv('m-pack', '0'); await pg.waitForTimeout(250);
  m = await txt('#m-details');
  ok(/none: bare perforated core/.test(m) && /concentric-tube resonator/.test(m) && !badText(m), vp.n + ': zero packing gives the bare-core note with no NaN');
  await setv('m-pack', '196'); await pg.waitForTimeout(250);
  m = await txt('#m-details');
  ok(/196 kg\/m³/.test(m) && !/none: bare/.test(m) && !badText(m), vp.n + ': density 196 renders');
  await setv('m-por', '0'); await pg.waitForTimeout(250);
  m = await txt('#m-details');
  ok(/porosity between 0 and 100%/.test(m) && !badText(m), vp.n + ': bad porosity gives a plain error, no crash');
  await setv('m-por', '10'); await setv('m-pack', '100'); await pg.waitForTimeout(250);
  // motorcycle engine on the Sound tab shows the Cone test card
  await setv('s-eng', 'mv90'); await pg.waitForTimeout(100);
  await pg.evaluate(() => { location.hash = 'mufflers'; }); await pg.waitForTimeout(300);
  m = await txt('#m-details');
  ok(/Motorcycle silencers: open pipe against muffler/i.test(m) && /65\.3/.test(m) && /94 · 107 · 113/.test(m) && /7 to 12 dB quieter/.test(m) && /2\.5 · 4\.0 · 5\.9 · 7\.0/.test(m), vp.n + ': Cone Bonneville test card for a motorcycle');
  ok(!badText(m), vp.n + ': motorcycle muffler details have no NaN/undefined');
  await pg.evaluate(() => { window.__clip = null; navigator.clipboard.writeText = t => { window.__clip = t; return Promise.resolve(); }; });
  await pg.click('#m-details button[data-copy="summary"]'); await pg.waitForTimeout(100);
  const copy = await pg.evaluate(() => window.__clip || '');
  ok(/Packed can: .* dB at 144 Hz/.test(copy), vp.n + ': summary carries the packed can line');
  // ---- Headers tab: collector growth
  await setv('s-eng', 'sbc'); await pg.waitForTimeout(100);
  await pg.evaluate(() => { location.hash = 'headers'; }); await pg.waitForTimeout(400);
  let h = await txt('#h-details');
  ok(/Area growth, one primary to the collector/.test(h) && /\+220%/.test(h) && /Cone Engineering’s band, 4-into-1 naturally aspirated/.test(h) && /\+100% to \+150%/.test(h) && /Sanderson’s rule/.test(h) && /\+206%/.test(h), vp.n + ': collector growth with Cone band and Sanderson rule (V8, 0.8 ratio gives +220%)');
  ok(/on the large side/.test(h) && !badText(h), vp.n + ': over-band note shown, no NaN');
  await setv('h-eng', 'mv90'); await setv('h-grp', 'all'); await pg.waitForTimeout(300);
  h = await txt('#h-details');
  ok(/2-1 motorcycle/.test(h) && /\+50% to \+75%/.test(h) && !badText(h), vp.n + ': motorcycle 2-1 band on a Ducati twin');
  await setv('h-eng', 'sbc'); await setv('h-grp', 'bank'); await setv('h-merge', 'triy'); await pg.waitForTimeout(300);
  h = await txt('#h-details');
  ok(/Area growth per step/.test(h) && /each Tri-Y step/.test(h) && /\+15% to \+30%/.test(h) && !badText(h), vp.n + ': Tri-Y step growth against the 15 to 30% band');
  await setv('h-merge', 'direct').catch(() => {});
  // ---- Sound tab: sportiness lean on a four-cylinder
  await setv('s-eng', 'i4'); await pg.waitForTimeout(100);
  await pg.evaluate(() => { location.hash = 'sound'; }); await pg.waitForTimeout(400);
  let sd = await txt('#sound-details');
  ok(/Sporty four-cylinder note/i.test(sd) && /Sportiness lean, 2,000 to 3,000 rpm/.test(sd) && /per dB/.test(sd) && /1,000 to 2,000 rpm/.test(sd) && /3,000 to 4,500 rpm/.test(sd), vp.n + ': sportiness lean table on the four-cylinder');
  const lean = await pg.evaluate(() => { const t = document.getElementById('sound-details').innerText; const mm = t.match(/Sportiness lean, 2,000 to 3,000 rpm\n([+−-]?\d+\.\d\d) points/); return mm ? +mm[1].replace('−', '-') : null; });
  ok(lean != null && Math.abs(lean) < 2, vp.n + ': lean is a small number on the 10-point scale (' + lean + ')');
  ok(/−0\.034 per dB/.test(sd) && /\+0\.015 per dB/.test(sd) && /\+0\.023 per dB/.test(sd) && /52 jurors/.test(sd), vp.n + ': Yang weights and the jury size shown');
  ok(!badText(sd), vp.n + ': sound details have no NaN/undefined');
  await setv('s-eng', 'sbc'); await pg.waitForTimeout(200);
  sd = await txt('#sound-details');
  ok(!/Sportiness lean/.test(sd), vp.n + ': lean hidden for the V8');
  // ---- Method
  const meth = await pg.$eval('details.method', el => el.textContent);
  ok(/Packed mufflers\./.test(meth) && /Davies 1996\./.test(meth) && /Yasuda 2013, Elsayed 2017, Xie 2015\./.test(meth) && /Sporty exhaust sound\./.test(meth) && /Cone Engineering\./.test(meth) && /Hobby and forum sources\./.test(meth) && /Two-stroke paper and the lecture slides\./.test(meth) && /Airbox CFD and the Clemson proposal\./.test(meth), vp.n + ': eight Method notes present');
  ok(/0\.163 kg\/s/.test(meth) && /10 psi/.test(meth) && /180 ft\/s/.test(meth) && /about 3/.test(meth) && /10 to 20 horsepower/.test(meth) && /packing adds nothing/.test(meth), vp.n + ': rejected claims named in the Method notes');
  ok(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), vp.n + ': no sideways scroll');
  ok(errs.length===0, vp.n + ': no page errors '+errs.join('|')); await pg.close(); }
  console.log(fails.length?'FAILED: '+fails.length:'all passed'); await b.close(); })();
