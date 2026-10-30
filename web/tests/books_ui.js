// Browser checks for the features added from the Books folder
const { chromium } = require('playwright');
const FILE = process.argv[2] || 'index.html';
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
  const bad = /\bNaN\b|\bundefined\b|\bInfinity\b|\[object/;
  for (const [vp, w] of [['phone', 390], ['desk', 1280]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(e.message));
    await pg.goto('file://' + process.cwd() + '/' + FILE);
    await pg.click('#m-expert');
    const panel = () => pg.evaluate(() => document.querySelector('[role=tabpanel]:not([hidden])').innerText);
    const wide = () => pg.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    // 2-Stroke: Jennings with the Blair check, then Blair's shape
    await pg.evaluate(() => location.hash = 'two-stroke');
    await pg.waitForTimeout(80);
    let t = await panel();
    ok(/Check against Blair/i.test(t) && /Motocross, 9 to 10 bar/.test(t), vp + ': Jennings view shows the Blair check table');
    await pg.selectOption('#t-shape', 'blair');
    await pg.waitForTimeout(80);
    t = await panel();
    ok(/First diffuser/i.test(t) && /Second diffuser/i.test(t) && /F · Stinger/i.test(t), vp + ': Blair view lists the six sections');
    ok(!/Check against Blair/i.test(t), vp + ': Blair view drops the cross-check');
    ok(await pg.isHidden('#t-br') && await pg.isHidden('#t-egt') && await pg.isVisible('#t-type'), vp + ': Jennings-only inputs hidden, engine type shown');
    ok((await pg.textContent('#t-dh-lab')) === 'Port equivalent diameter', vp + ': header input relabelled for Blair');
    ok(!bad.test(t), vp + ': Blair view has no NaN or undefined');
    ok(await wide() <= 0, vp + ': Blair view fits the width');
    await pg.screenshot({ path: 'books-' + vp + '-blair.png', fullPage: true });
    await pg.selectOption('#t-type', 'gp');
    await pg.waitForTimeout(60);
    t = await panel();
    ok(/Grand Prix racer, 11\+ bar/.test(t) && /K0 0\.6/.test(t), vp + ': Grand Prix constants shown');
    // a port inside the cylinder shows the pipe to build
    await pg.fill('#t-port', '2');
    await pg.waitForTimeout(60);
    t = await panel();
    ok(/Pipe to build, flange to diffuser/.test(t), vp + ': port length gives a pipe-to-build row');
    await pg.fill('#t-port', '0');
    await pg.selectOption('#t-shape', 'jen');
    await pg.waitForTimeout(60);
    ok(await pg.isVisible('#t-br') && (await pg.textContent('#t-dh-lab')) === 'Header inside diameter', vp + ': back to Jennings restores the inputs');

    // Sound: heat growth and the idle check
    await pg.evaluate(() => location.hash = 'sound');
    await pg.waitForTimeout(100);
    t = await panel();
    ok(/Heat growth, valve to tip/.test(t), vp + ': Sound tab shows heat growth');
    ok(/At idle: no strong|Boom at idle/.test(t), vp + ': Sound tab runs the idle check');
    ok(/slip joint/.test(t), vp + ': slip-joint guidance shown');
    await pg.selectOption('#s-mat', 'mild');
    await pg.fill('#s-twall', '1100');
    await pg.waitForTimeout(80);
    t = await panel();
    ok(/Too hot for mild or aluminized steel/.test(t), vp + ': 1,100 °F mild steel wall warns');
    ok(!bad.test(t), vp + ': Sound tab has no NaN or undefined');

    // Cats: the dyno-test estimate
    await pg.evaluate(() => location.hash = 'cats');
    await pg.waitForTimeout(100);
    t = await panel();
    ok(/Power lost in a dyno test at this back pressure/.test(t) && /Kevin Davis/.test(t), vp + ': Cats tab shows the dyno-test estimate');
    ok(!bad.test(t), vp + ': Cats tab has no NaN or undefined');

    // Mufflers: cut-on and the length rule
    await pg.evaluate(() => location.hash = 'mufflers');
    await pg.waitForTimeout(100);
    t = await panel();
    ok(/Curve holds up to about/.test(t), vp + ': plain chamber shows where the plane-wave curve stops');
    ok(/Yoshimura RS-3/.test(t) && /Shell noise/.test(t), vp + ': muffler guide has the measured silencer and shell notes');

    // Quick: other published rules for a car
    await pg.evaluate(() => location.hash = 'quick');
    await pg.waitForTimeout(100);
    const vals = await pg.$$eval('#q-eng option', os => os.map(o => o.value));
    await pg.selectOption('#q-eng', vals.includes('sbc') ? 'sbc' : vals[0]);
    await pg.fill('#q-disp', '5735'); await pg.fill('#q-rpm', '5500'); await pg.fill('#q-hp', '350');
    await pg.waitForTimeout(120);
    t = await panel();
    ok(/Other published rules: .*SMSP/.test(t), vp + ': Quick lists the SMSP size');
    ok(!bad.test(t), vp + ': Quick has no NaN or undefined');

    // Options: the passive valve entry
    await pg.evaluate(() => location.hash = 'options');
    await pg.waitForTimeout(100);
    t = await panel();
    ok(/Passive \(spring-loaded\) bypass valve/.test(t), vp + ': Options lists the passive bypass valve');
    ok(errs.length === 0, vp + ': no page errors' + (errs.length ? ' (' + errs.join(' | ') + ')' : ''));
    await ctx.close();
  }
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})();
