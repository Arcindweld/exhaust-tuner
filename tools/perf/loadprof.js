// node loadprof.js FILE OUT.cpuprofile : a CPU profile of the page's load (to the first render and 500 ms after)
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const pg = await ctx.newPage();
  const cdp = await ctx.newCDPSession(pg); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  await pg.goto('file://' + process.argv[2] + '#quick'); await pg.waitForTimeout(1500);
  const { profile } = await cdp.send('Profiler.stop'); require('fs').writeFileSync(process.argv[3], JSON.stringify(profile)); await b.close(); })();
