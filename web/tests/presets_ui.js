// Vehicle and engine presets: the power figure cannot imply more torque at the power peak than the stated peak torque.
// P = T * rpm / 5252 (hp, lb-ft), so hp * 5252 / hpRpm <= tq, with 3 % for rounding and hp/PS conversions in the
// sources. (A 400 PS 2.5 TFSI entry once had its power at 5,400 rpm instead of Audi's 5,850, 8 % over.)
// Reads the preset lines from the page source; no browser needed.
const fs = require('fs'), path = require('path');
const page = fs.readFileSync(path.resolve(process.argv[2] || 'index.html'), 'utf8');
const fails = [];
let n = 0, worst = { r: 0 };
for (const line of page.split('\n')) {
  const m = line.match(/name:'([^']+)'.*?hp:([\d.]+),hpRpm:([\d.]+),tq:([\d.]+),tqRpm:([\d.]+)/);
  if (!m) continue;
  const [, name, hp, hpRpm, tq] = m;
  const r = (+hp * 5252 / +hpRpm) / +tq;
  n++;
  if (r > worst.r) worst = { r, name };
  if (r > 1.03) fails.push(name + ': ' + hp + ' hp at ' + hpRpm + ' rpm implies ' + (+hp * 5252 / +hpRpm).toFixed(1) + ' lb-ft > ' + tq);
}
console.log((n > 900 ? 'PASS ' : 'FAIL ') + 'found ' + n + ' presets with power and torque figures');
for (const f of fails) console.log('FAIL ' + f);
if (!fails.length) console.log('PASS power and torque agree within 3 % for every preset (worst ' + (100 * (worst.r - 1)).toFixed(2) + ' %: ' + worst.name + ')');
console.log(fails.length || n <= 900 ? 'FAILED: ' + (fails.length + (n <= 900 ? 1 : 0)) : 'all passed');
process.exitCode = fails.length || n <= 900 ? 1 : 0;
