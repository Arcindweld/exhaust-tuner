// the recording tracker's octave check: an engine whose lines run up to high orders with the half orders a little
// weaker (a cab recording, validation/f100-302) is not read at double its speed, and the same lines without the half
// orders (which is what an engine at double the speed gives) are not halved
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errs = [], fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  p.on('pageerror', e => errs.push(e.message));
  await p.goto('file://' + process.cwd() + '/index.html#sound'); await p.waitForTimeout(1500);
  await p.evaluate(() => { const s = document.getElementById('s-eng'); s.value = 'sbf'; s.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(700);
  const r = await p.evaluate(async () => {
    const R = window.__rec, sr = 22050, secs = 6, n = sr * secs;
    const make = (rpm, halfDb, top) => { const x = new Float32Array(n), f1 = rpm / 60; let seed = 9; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
      for (let i = 0; i < n; i++) { const t = i / sr; let v = 0.002 * rnd();
        for (let o = 0.5; o <= top + 1e-9; o += 0.5) { const half = Math.abs(o - Math.round(o)) > 0.25; if (half && halfDb === null) continue;
          v += 0.02 * Math.pow(10, (half ? halfDb : 0) / 20) * Math.sin(2 * Math.PI * o * f1 * t + 0.7 * o); }
        x[i] = v; } return x; };
    const med = a => { const s = a.slice().sort((p, q) => p - q); return s[s.length >> 1]; };
    const out = {};
    for (const [k, rpm, hd, top] of [['cab', 2400, -4, 24], ['double', 4800, null, 12]]) {
      const F = await R.recFrames(make(rpm, hd, top), sr, () => {}); const tr = R.recTrack(F, R.REC.ctx || { cyc: '4', kf: 4, idle: 750, red: 6500 });
      out[k] = { rpm: med(tr.slice(5, -5).map(q => q.rpmS)), oct: tr.filter(q => q.oct).length / tr.length };
    }
    return out; });
  ok(Math.abs(r.cab.rpm - 2400) / 2400 < 0.02 && r.cab.oct > 0.8, 'lines to order 24 with the half orders 4 dB weaker: read at ' + r.cab.rpm + ' RPM (2400); the comb reads it double and the octave check halves it (' + (100 * r.cab.oct).toFixed(0) + ' % of frames)');
  ok(Math.abs(r.double.rpm - 4800) / 4800 < 0.02 && r.double.oct < 0.2, 'the same lines without the half orders: read at ' + r.double.rpm + ' RPM (4800), not halved (' + (100 * r.double.oct).toFixed(0) + ' % of frames flagged)');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log('failures:', fails.length); process.exit(fails.length ? 1 : 0);
})();
