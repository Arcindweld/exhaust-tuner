// OpenWAM sound results with two exits (a dual exhaust with an X): every exit read, their flows added at the microphone
// with the far one's delay and level, against sound/wam_sound.py synthesize_multi on the same F-100 run
const { chromium } = require('playwright');
const { skip } = require('./skip.js');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
(async () => {
  const run = path.resolve('../validation/f100-302/model/runs/ho_venom_plenum_x400_p900_5800');
  const insF = path.join(run, 'ho_venom_plenum_x400_p900_5800INS.DAT');
  if (!fs.existsSync(insF)) skip('the F-100 run is not here (validation/f100-302/model: python3 f100.py run ho_venom_plenum_x400_p900_5800, needs OpenWAM)');
  const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  // the file is about 100 MB: keep the header and the last three cycles (an Angle drop marks a cycle start)
  const all = fs.readFileSync(insF, 'utf8').split(/\r?\n/).filter(l => l.trim() !== ''), hd = all[0].split('\t'), ai = hd.findIndex(h => /^Angle/i.test(h));
  let st = [], prev = null; for (let i = 1; i < all.length; i++) { const a = parseFloat(all[i].split('\t', ai + 1)[ai]); if (prev !== null && a < prev - 180) st.push(i); prev = a; }
  const from = st.length >= 3 ? st[st.length - 3] : 1, trimmed = path.join(require('os').tmpdir(), 'f100_ins_trim.dat');
  fs.writeFileSync(trimmed, [all[0]].concat(all.slice(from)).join('\n') + '\n');
  // the Python reference: near exit 4 m, far 5.8 m, relative order levels 0.5-12
  const py = JSON.parse(execFileSync('python3', ['-c', `
import sys, json; sys.path.insert(0, ${JSON.stringify(path.resolve('../openwam'))}); sys.path.insert(0, ${JSON.stringify(path.resolve('../sound'))})
import make_wam, wam_sound, numpy as np
sp = json.load(open(${JSON.stringify(path.join(run, 'spec.json'))})); m = make_wam.model_from_spec(sp, {'rpm': 5800.0, 'cycles': 1, 'name': 'x', 'ins_outlet': 1})
t = open(${JSON.stringify(trimmed)}).read(); b = make_wam.read_ins(t, keep_cycles=2, model=m)
S = [{'ins': make_wam.read_ins(t, pipe=pn, keep_cycles=2, model=m), 'r': 4.0 + 1.8 * k, 'theta_deg': None, 'd_tip_m': None} for k, pn in enumerate(b['outlets'])]
out = {}
for nm, src in (('both', S), ('near', S[:1])):
    r = wam_sound.synthesize_multi(src, 5800.0, orders_max=12); d = np.array(r['spl_dB']); out[nm] = (d - d.max()).tolist()
out['spec'] = sp; print(json.dumps(out))`], { maxBuffer: 1 << 26 }).toString());
  const b = await chromium.launch(); const pg = await b.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html');
  const t = fs.readFileSync(trimmed, 'utf8');
  const r = await pg.evaluate(({ t, spec }) => {
    const mdl = window.WamExport.modelFromSpec(spec, { rpm: 5800, cycles: 5, name: 'x', ins_outlet: 1 }), M = window.__wamMic, o = {};
    M.layout = 'side'; M.r = 4.0; M.sep = 1.8; o.side = window.__wamMore(t, 5800, mdl);
    M.layout = 'centre'; o.centre = window.__wamMore(t, 5800, mdl);
    o.none = window.__wamMore(t, 5800, null);
    // settled: each exit against its own cycle before, the worse of the two (not the summed flow against one exit)
    const W = window.WamExport, ins = W.readIns(t, { keepCycles: 2, model: mdl }), each = ins.outlets.map(pn => window.__wamInsOrders(W.readIns(t, { keepCycles: 2, model: mdl, pipe: pn }), 24, [], 5800).per);
    o.perEach = each; o.per = o.side.per;
    return o;
  }, { t, spec: py.spec });
  const rel = a => { const top = Math.max(...a); return a.map(v => v - top); };
  const dS = rel(r.side.db).map((v, i) => Math.abs(v - py.both[i])).filter((_, i) => py.both[i] > -40);
  ok(r.side.exits === 2 && Math.max(...dS) < 0.7, 'beside the car (exits 4 and 5.8 m away): both exits added, order levels within ' + Math.max(...dS).toFixed(2) + ' dB of wam_sound.synthesize_multi (' + dS.length + ' orders above -40 dB)');
  const dC = rel(r.centre.db).map((v, i) => Math.abs(v - py.near[i])).filter((_, i) => py.near[i] > -40);
  ok(Math.max(...dC) < 0.7, 'between the exits: in step, the same relative levels as one exit (the two are the same here), within ' + Math.max(...dC).toFixed(2) + ' dB');
  ok(r.none.exits === 1, 'without a matching model the reader falls back to one outlet');
  const half = i => r.side.db[i] - r.centre.db[i];
  ok(Math.abs(half(1) - half(7)) > 3, 'beside the car the half and odd orders change against the firing order (order 1 ' + half(1).toFixed(1) + ' dB, order 4 ' + half(7).toFixed(1) + ' dB against between the exits)');
  ok(r.perEach.length === 2 && Math.abs(r.per - Math.max(...r.perEach)) < 1e-9, 'two exits: settling is the worse exit against its own previous cycle (' + r.perEach.map(v => (100 * v).toFixed(1) + '%').join(', ') + ' -> ' + (100 * r.per).toFixed(1) + '%)');
  ok(!errs.length, 'no page errors ' + errs.join('; '));
  await b.close(); console.log('failures:', fails.length); process.exit(fails.length ? 1 : 0);
})();
