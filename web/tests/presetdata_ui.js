// The engine presets' bore and stroke data (docs/PRESET_DATA_2026-11-18.md). Every preset with a bore and stroke reproduces
// its displacement (pi/4 x bore^2 x stroke x cylinders within 2 %) and names its source as a real address with a quality
// label; the sourcing round's figures (tools/validation/presets/research.json) are the page's (apply.js has nothing left to
// write) and each was within 1 % of its preset when taken; no preset note has an "undefined" link; a four-stroke preset
// without a bore and stroke says it is estimated from the displacement, with the estimate and how to do better, in its note
// and on the 4-Stroke tab's wave simulation; and a sample of the changed presets runs on both engines with the same numbers.
//   node tests/presetdata_ui.js   (from web/)
'use strict';
const path = require('path'), fs = require('fs'), { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', '..');
const L = require(path.join(__dirname, 'specparity_lib.js'));
const { typedPoint, settle } = require(path.join(__dirname, 'settle.js'));
const R = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'validation', 'presets', 'research.json'), 'utf8'));
const QUAL = ['maker data', 'reputable vendor', 'magazine test', 'enthusiast measurement', 'secondary: encyclopedia', 'secondary: enthusiast reference'];
(async () => {
  const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
  // the research file against itself and against the page source (no browser)
  const ents = Object.entries(R.engines);
  ok(ents.length >= 263 && ents.every(([, e]) => /^https?:\/\/\S+$/.test(e.src) && QUAL.includes(e.q) && e.says && /^\d{4}-\d\d-\d\d$/.test(e.seen) && e.targets.length),
    'research.json: ' + ents.length + ' sourced engine entries, each with a URL, a quality label, the figures as written and the date read');
  const tg = ents.flatMap(([id, e]) => e.targets.map(t => ({ id, e, t })));
  ok(tg.every(({ e, t }) => Math.abs(Math.PI / 4 * e.bore * e.bore * e.stroke * t.cyl / 1000 / t.cc - 1) <= 0.02 && Math.abs(t.dPct) <= 2),
    'research.json: every one of the ' + tg.length + ' targets reproduced its displacement when taken');
  const chk = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'validation', 'presets', 'apply.js'), '--check'], { encoding: 'utf8' });
  ok(/^\[check\] 0 preset lines would change/.test(chk) && !/CONFLICT|MISSING/.test(chk), 'apply.js --check: the page carries every sourced figure (' + chk.split('\n')[0] + ')');

  const b = await chromium.launch(), pg = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + path.join(ROOT, 'web', 'index.html') + '#four-stroke'); await pg.waitForTimeout(800);
  // every preset entry's own numbers (MOTORS and VEH, cars and bikes)
  const all = await pg.evaluate(() => { const { MOTORS, VEH, ENGLIB } = window.__presets;
    return MOTORS.concat(VEH).map(v => ({ name: v.name, cyc: ENGLIB[v.eng].cyc, cyl: ENGLIB[v.eng].order.length, cc: v.cc, bore: v.bore || null, stroke: v.stroke || null, cr: v.cr || null, src: v.src, bsSrc: v.bsSrc || null, bsQ: v.bsQ || null })); });
  const withBS = all.filter(v => v.bore && v.stroke), bad = withBS.filter(v => Math.abs(Math.PI / 4 * v.bore * v.bore * v.stroke * v.cyl / 1000 / v.cc - 1) > 0.02);
  ok(withBS.length >= 826 && !bad.length, withBS.length + ' preset entries with a bore and stroke reproduce their displacement within 2 %' + (bad.length ? ': ' + bad.map(v => v.name).join('; ') : ''));
  const noSrc = all.filter(v => typeof v.src !== 'string' || !/^https?:\/\/\S+$/.test(v.src));
  ok(!noSrc.length, 'every one of the ' + all.length + ' preset entries has a source that is a real address' + (noSrc.length ? ': ' + noSrc.slice(0, 5).map(v => v.name + ' (' + v.src + ')').join('; ') : ''));
  const badBs = withBS.filter(v => v.bsSrc ? !(/^https?:\/\/\S+$/.test(v.bsSrc) && QUAL.includes(v.bsQ)) : !!v.bsQ);
  ok(!badBs.length && withBS.filter(v => v.bsSrc).length >= 428, withBS.filter(v => v.bsSrc).length + ' presets carry their own bore-and-stroke source (bsSrc, a real address, with a quality label)' + (badBs.length ? ': ' + badBs.map(v => v.name).join('; ') : ''));
  const byName = Object.fromEntries(all.map(v => [v.name, v]));
  const off = tg.filter(({ e, t }) => { const v = byName[t.name]; return !v || Math.abs(v.bore - e.bore) > 0.006 || Math.abs(v.stroke - e.stroke) > 0.006 || (!t.had && v.bsSrc !== e.src); });
  ok(!off.length, 'the page has research.json’s bore, stroke and source for each of its targets' + (off.length ? ': ' + off.slice(0, 5).map(x => x.t.name).join('; ') : ''));
  // every engine preset's note (both lists: cars and trucks, motorcycles): no undefined link, the bore and stroke labelled
  const notes = await pg.evaluate(() => { const f = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); };
    document.getElementById('u-met').click(); f('v-mode', 'eng'); const out = [];
    for (const cls of ['car', 'bike']) { f('v-class', cls); f('v-mode', 'eng');
      for (const o of [...document.getElementById('v-pick').options].filter(o => o.value !== '')) { f('v-pick', o.value); const n = document.getElementById('v-note');
        out.push({ t: o.text, html: n.innerHTML, text: n.textContent, bore: document.getElementById('f-bore').value, four: /Filled in on 4-Stroke/.test(n.textContent) }); } }
    return out; });
  const und = notes.filter(n => /href="(undefined|null|)"|undefined|\bNaN\b/.test(n.html));
  ok(notes.length >= 990 && !und.length, notes.length + ' engine preset notes, none with an undefined link or NaN' + (und.length ? ': ' + und.slice(0, 5).map(n => n.t).join('; ') : ''));
  const four = notes.filter(n => n.four), est = four.filter(n => !n.bore), real = four.filter(n => n.bore);
  ok(est.length && est.every(n => /Bore and stroke: not in the sources found, so they are estimated from the displacement \(bore 1\.2 × stroke, [\d.]+ × [\d.]+ mm\)/.test(n.text) && /Measure your engine’s/.test(n.text)),
    est.length + ' four-stroke presets without a bore and stroke say they are estimated from the displacement, with the estimate and the measure-it-yourself hint');
  ok(real.length && real.every(n => /Bore and stroke [\d.]+ × [\d.]+ mm[^(]*\((source: <a href="https?:\/\/[^"]+"[^>]*>[^<]+<\/a>|from the source below: [^)]+)\)/.test(n.html) && !/not in the sources found/.test(n.text)),
    real.length + ' four-stroke presets with a bore and stroke show it with its source and label (and no estimate line)');
  // a sourced one and an estimated one on the 4-Stroke tab's wave simulation
  await L.installPage(pg, false); await typedPoint(pg);
  const tab = async txt => { await pg.evaluate(t => { window.__sp.set('v-class', 'car'); window.__sp.preset(t); document.getElementById('tab-intake').click(); document.getElementById('tab-four').click(); }, txt); await settle(pg);
    return pg.evaluate(() => { const e = document.getElementById('sim-bsest'); return { est: e ? e.textContent : null, bore: document.getElementById('f-bore').value }; }); };
  const lt = await tab('6.2 L LT1, 455 hp'), boss = await tab('7.0 L Ford 289 and 302 V8, 375 hp');   // Boss 429: still estimated (its sourced figures failed the check, docs/PRESET_DATA_2026-11-18.md round two); the Boss 302 is sourced since round two
  ok(lt.bore && !lt.est, '4-Stroke tab, Camaro SS LT1 (sourced): bore filled in (' + lt.bore + '), no estimate line');
  ok(!boss.bore && /Bore and stroke estimated from the displacement \(bore 1\.2 × stroke\): .* × .*; the valve sizes, the rod and the piston speed follow from them\. Measure your engine’s/.test(boss.est || ''),
    '4-Stroke tab, Boss 429 (no source): the wave simulation says its bore and stroke are estimated (' + (boss.est || '').slice(0, 70) + '…)');
  // changed presets on both engines: one per quality label and layout, two speeds, every number the same
  const pick = []; const seenK = new Set();
  for (const { e, t } of tg) { if (t.had) continue; const k = e.q + '|' + t.cyl; if (seenK.has(k)) continue; seenK.add(k); pick.push(t.name); if (pick.length >= 8) break; }
  for (const name of pick) {
    const r = await pg.evaluate(name => { const SP = window.__sp, { motorList } = window.__presets; const m = motorList().find(x => x.fitted === name || (x.motor && x.name === name));
      SP.set('v-class', m && ['bike', 'bikec', 'mx', 'bike2t'].includes(m.g) ? 'bike' : 'car'); SP.set('v-mode', 'eng');
      const o = m && [...document.getElementById('v-pick').options].find(o => o.text === m.name); if (!o) return { err: 'not in the picker' };
      SP.set('v-pick', o.value); const q = window.__sim.inp(), c = SP.collect({ max: 1 })[0]; if (!c || c.err) return { err: c ? c.err : 'no spec' };
      const rp = window.__sim.simRpms(q.tune); c.rpms = [rp[0], rp[rp.length - 1]]; return { c, bore: c.spec.e.bore, f: +document.getElementById('f-bore')._b }; }, name);
    if (r.err) { ok(false, name + ': ' + r.err); continue; }
    const x = await pg.evaluate(c => window.__sp.run(c, { dx: 0.02, cyc: 1, firstCyc: 2, extra: 1 }), r.c);
    const d = L.sameRows(x.js, x.wasm), fin = Array.isArray(x.js) && x.js.every(row => row.every(Number.isFinite)) && x.js.every(row => row[0] > 0.3 && row[1] > 0);
    ok(d.ok && fin && Math.abs(r.bore * 1000 - r.f) < 0.01, name.slice(0, 60) + ': runs on both engines, every number the same (' + (d.ok ? 'same' : d.why) + '), bore ' + (r.bore * 1000).toFixed(2) + ' mm in the spec');
  }
  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  await b.close(); console.log(fails.length ? 'presetdata_ui: ' + fails.length + ' FAIL' : 'presetdata_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
