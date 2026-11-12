// Absolute roadside level and Davies' quiet target from an OpenWAM INS file on the 4-Stroke tab; the per-order level at 1 m
// against sound/wam_sound.py on the same run.
const { chromium } = require('playwright');
const { skip } = require('./skip.js');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
(async () => {
  const run = path.resolve('../validation/f100-302/model/runs/ho_venom_plenum_x400_p900_5800'), insF = path.join(run, 'ho_venom_plenum_x400_p900_5800INS.DAT');
  if (!fs.existsSync(insF)) skip('the F-100 p900 run is not here (validation/f100-302/model: python3 f100.py run ho_venom_plenum_x400_p900_5800, needs OpenWAM)');
  const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  const all = fs.readFileSync(insF, 'utf8').split(/\r?\n/).filter(l => l.trim() !== ''), hd = all[0].split('\t'), ai = hd.findIndex(h => /^Angle/i.test(h));
  let st = [], prev = null; for (let i = 1; i < all.length; i++) { const a = parseFloat(all[i].split('\t', ai + 1)[ai]); if (prev !== null && a < prev - 180) st.push(i); prev = a; }
  const from = st.length >= 3 ? st[st.length - 3] : 1, dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'wamlvl-')), trimmed = path.join(dir, 'ho_venom_plenum_x400_p900_5800INS.DAT');
  fs.writeFileSync(trimmed, [all[0]].concat(all.slice(from)).join('\n') + '\n');
  const py = JSON.parse(execFileSync('python3', ['-c', `
import sys, json; sys.path.insert(0, ${JSON.stringify(path.resolve('../openwam'))}); sys.path.insert(0, ${JSON.stringify(path.resolve('../sound'))})
import make_wam, wam_sound
sp = json.load(open(${JSON.stringify(path.join(run, 'spec.json'))})); m = make_wam.model_from_spec(sp, {'rpm': 5800.0, 'cycles': 1, 'name': 'x', 'ins_outlet': 1})
t = open(${JSON.stringify(trimmed)}).read(); b = make_wam.read_ins(t, keep_cycles=2, model=m)
S = [{'ins': make_wam.read_ins(t, pipe=b['outlets'][0], keep_cycles=2, model=m), 'r': 1.0, 'theta_deg': None, 'd_tip_m': None}]
print(json.dumps({'spl': wam_sound.synthesize_multi(S, 5800.0, orders_max=12)['spl_dB'], 'spec': sp}))`], { maxBuffer: 1 << 26 }).toString());
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html#four-stroke');
  const t = fs.readFileSync(trimmed, 'utf8');
  const r = await pg.evaluate(({ t, spec }) => {
    const mdl = window.WamExport.modelFromSpec(spec, { rpm: 5800, cycles: 5, name: 'x', ins_outlet: 1 });
    const ins = window.WamExport.readIns(t, { keepCycles: 2, model: mdl }), base = window.WamExport.readIns(t, { keepCycles: 2, model: mdl, pipe: ins.outlets[0] });
    return window.__wamInsOrders(base, 24, [], 5800).spl1;
  }, { t, spec: py.spec });
  const d = py.spl.slice(0, 8).map((v, i) => Math.abs(r[i] - v));
  ok(Math.max(...d) < 0.6, 'per-order level at 1 m matches wam_sound.py on orders 0.5-4 (largest difference ' + Math.max(...d).toFixed(2) + ' dB)');
  // through the file input: the level row and the quiet target
  await pg.setInputFiles('#wam-ins', trimmed); await pg.waitForTimeout(1500);
  let txt = await pg.evaluate(() => document.getElementById('panel-four').innerText);
  const m = txt.match(/Level at 50 ft, hard ground\s+(\d+) dB\(A\), (\d+) dB/);
  ok(!!m, 'level row shown: ' + (m ? m[0].replace(/\s+/g, ' ') : 'missing'));
  if (m) { const want = py.spl.slice(0, 24).reduce((a, v) => a + Math.pow(10, (v - 20 * Math.log10(15.24) + 6) / 10), 0);   // unweighted sum at 50 ft from the Python orders
    ok(Math.abs(+m[2] - 10 * Math.log10(want)) <= 1, 'unweighted level at 50 ft = the orders summed with 1/r and +6 (' + m[2] + ' vs ' + (10 * Math.log10(want)).toFixed(1) + ')'); }
  await pg.fill('#wam-lv-t', '80'); await pg.dispatchEvent('#wam-lv-t', 'change'); await pg.waitForTimeout(500);
  txt = await pg.evaluate(() => document.getElementById('panel-four').innerText);
  ok(/To reach 80 dB\(A\): take off\s+(order [\d.]+ \d+ dB|nothing)/.test(txt), 'quiet-target row lists the orders to cut');
  const hadBtn = await pg.$('button[data-wamjob]');
  if (hadBtn) { await hadBtn.click(); await pg.waitForTimeout(400);
    const md = await pg.evaluate(() => ({ hash: location.hash, f0: window.__md.MD.f0, f1: window.__md.MD.f1, tl: window.__md.MD.tl }));
    ok(md.hash === '#mufflers' && md.f1 > md.f0 && md.tl >= 1, 'job list goes to the muffler designer: ' + JSON.stringify(md)); }
  ok(!/\bNaN\b/.test(txt) && !errs.length, 'no NaN, no page errors ' + errs.join(' | '));
  await b.close(); console.log('failures:', fails.length); process.exit(fails.length ? 1 : 0);
})();
