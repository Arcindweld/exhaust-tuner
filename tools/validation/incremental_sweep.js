// The long run of the differential guard (docs/PERF_2026-11-18.md): web/tests/incremental_ui.js for several seeds.
//   node tools/validation/incremental_sweep.js [seeds=1-10] [n=400]
// Each seed: the page writing in place against the page writing in full, in lockstep, n seeded actions; any difference
// stops that seed with the panel and the first differing characters (the test's own report). Prints one line per seed.
'use strict';
const path = require('path'), { spawnSync } = require('child_process');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.split('=')));
const [s0, s1] = (args.seeds || '1-10').split('-').map(Number), n = args.n || '400';
const web = path.resolve(__dirname, '..', '..', 'web');
let bad = 0;
for (let s = s0; s <= (s1 || s0); s++) {
  const r = spawnSync(process.execPath, ['tests/incremental_ui.js'], { cwd: web, env: Object.assign({}, process.env, { SEED: String(s), N: n }), encoding: 'utf8', maxBuffer: 64 << 20 });
  const out = (r.stdout || '') + (r.stderr || ''), ok = r.status === 0; if (!ok) bad++;
  console.log('seed ' + s + ': ' + (ok ? 'no difference' : 'FAILED') + ' | ' + (out.match(/actions:.*$/m) || [''])[0]);
  if (!ok) console.log(out.split('\n').filter(l => /FAIL|after action|in place:|full:/.test(l)).slice(0, 8).join('\n'));
}
process.exit(bad ? 1 : 0);
