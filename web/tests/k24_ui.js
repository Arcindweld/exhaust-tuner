// Honda K-series presets (2026-11-12): picking an engine fills the form with Honda's published figures, every tab renders
// for a K24, the inline-four header wording and pairing, header length and primary size by the page's documented formulas,
// and Garrett's turbo mass flow by hand.   node tests/k24_ui.js   (from web/)
//
// Sourced values the presets must carry (all read 2026-11-12):
//   K24A2 (2004 TSX)  https://hondanews.com/en-US/releases/release-6a2f3de869ef0af45df662004c34c653-2004-acura-tsx-specifications
//                     2354 cc, 87 x 99 mm, 10.5:1, 200 hp @ 6800, 166 lb-ft @ 4500, redline 7100
//     valves 35 / 30 mm standard: https://www.realstreetperformance.com/ferrea-6000-series-std-size-valves-kit-acura-honda-k20-k24.html
//     rear stainless manifold, VTEC above 6000 RPM: https://hondanews.com/en-US/releases/release-a5f8332c8f3611c3080cca004c34c61b-2004-acura-tsx-introduction
//   K24A4 (2005 Accord) https://hondanews.com/en-US/releases/release-0a2dd3473dddece266be83004c34c361-2005-honda-accord-sedan-specifications
//                     2354 cc, 87 x 99, 9.7:1, 160 hp @ 5500, 161 lb-ft @ 4500, no redline given
//   K24A8 (2006 Accord) https://hondanews.ca/en-CA/hci-automobiles/releases/release-ca54ead83e3667d0b2045585b00023d9-2006-accord-sedan-specifications
//                     2354 cc, 9.7:1, 166 hp @ 5500, 160 lb-ft @ 4000 (no bore/stroke, no redline)
//   K24Z3 (2009 TSX)  https://acuranews.com/en-US/releases/release-298ef25d75ac84938aca39004c34bd5b-2009-acura-tsx-specifications
//                     2354 cc, 87 x 99, 11.0:1, 201 hp @ 7000, 172 lb-ft @ 4400 (6MT), redline 7100
//   K24Z7 (2013 Civic Si) https://hondanews.com/en-US/honda-automobiles/releases/release-c93c7e8146714964a03663394bcf5e40-2013-honda-civic-si-specifications
//                     2354 cc, 87 x 99, 11.0:1, 201 hp @ 7000, 170 lb-ft @ 4400, redline 7000; exhaust valve 31 mm std:
//                     https://www.realstreetperformance.com/supertech-s2000-00-09-f20c-f22c-civic-si-12-15-k24z7-31mm-std-dish-exhaust-valves-set.html
//   K24W1 (2014 Accord) https://hondanews.com/en-US/releases/release-95eca0bb681b47f0a7e6c85311c0f401-2014-honda-accord-specifications-and-features
//                     2356 cc, 87 x 99.1, 11.1:1, 185 hp @ 6400, 181 lb-ft @ 3900, redline 6800;
//                     valves 36 / 30 mm, front exhaust cast into the head: https://global.honda/en/technical-review/PDF/025-2/025-2_17e.pdf
//
// Hand arithmetic (the page's documented formulas):
//   Header runner (calcLayout): total = 850 x (180 + EVO) / RPM - 3 in. K24A2 at 6800 RPM, EVO 60 (tab default):
//     850 x 240 / 6800 - 3 = 30.0 - 3 = 27.0 in (685.8 mm).
//   Primary size (calcPrimarySize): area = RPM_torque / 88200 x cu in per cylinder; ID = sqrt(area x 1.273).
//     2354 cc / 16.387064 / 4 = 35.9122 cu in; 4500 / 88200 x 35.9122 = 1.83226 in²; ID = sqrt(2.33247) = 1.5272 in (38.8 mm).
//   Garrett: Wa = HP x A/F x BSFC / 60 = 450 x 12 x 0.55 / 60 = 49.5 lb/min (0.3742 kg/s).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.goto('file://' + process.cwd() + '/index.html'); await pg.waitForTimeout(800);
  const pick = code => pg.evaluate(code => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('v-mode', 'eng'); const o = [...document.getElementById('v-pick').options].find(o => o.text.startsWith(code + ' ')); if (!o) return null; set('v-pick', o.value);
    const B = id => { const el = document.getElementById(id); return el._b; };
    return { name: o.text, cc: B('s-disp'), red: B('s-red'), eng: document.getElementById('s-eng').value, cyl: B('s-cyl'), hpRpm: B('h-rpm'), tqRpm: B('h-trq'), hp: B('q-hp'),
      bore: B('f-bore'), stroke: B('f-stroke'), cr: B('f-cratio'), valves: document.getElementById('f-valves').value, vdi: B('f-vdi'), vde: B('f-vde'), boreTxt: document.getElementById('f-bore').value,
      note: document.getElementById('v-note').textContent }; }, code);
  const want = {
    K24A2: { cc: 2354, bore: 87, stroke: 99, cr: 10.5, hp: 200, hpRpm: 6800, tqRpm: 4500, red: 7100, vdi: 35, vde: 30 },
    K24A4: { cc: 2354, bore: 87, stroke: 99, cr: 9.7, hp: 160, hpRpm: 5500, tqRpm: 4500, vdi: NaN, vde: NaN },
    K24A8: { cc: 2354, bore: NaN, stroke: NaN, cr: 9.7, hp: 166, hpRpm: 5500, tqRpm: 4000 },
    K24Z3: { cc: 2354, bore: 87, stroke: 99, cr: 11.0, hp: 201, hpRpm: 7000, tqRpm: 4400, red: 7100 },
    K24Z7: { cc: 2354, bore: 87, stroke: 99, cr: 11.0, hp: 201, hpRpm: 7000, tqRpm: 4400, red: 7000, vdi: NaN, vde: 31 },
    K24W1: { cc: 2356, bore: 87, stroke: 99.1, cr: 11.1, hp: 185, hpRpm: 6400, tqRpm: 3900, red: 6800, vdi: 36, vde: 30 } };
  const same = (a, w) => Number.isNaN(w) ? !Number.isFinite(a) : Math.abs(a - w) < 1e-9;
  for (const [code, w] of Object.entries(want)) {
    const r = await pick(code);
    ok(r, code + ' is in the engine list');
    if (!r) continue;
    const bad = Object.entries(w).filter(([k, v]) => !same(r[k], v)).map(([k, v]) => k + ' ' + r[k] + ' (want ' + v + ')');
    ok(!bad.length && r.eng === 'i4' && r.cyl === 4 && r.valves === '4', code + ': ' + (bad.length ? bad.join(', ') : 'fills ' + JSON.stringify(w)));
    ok(/Source/.test(r.note) && /Not published in the sources found: stock cam timing/.test(r.note), code + ': note links the source and says what is not published');
  }
  let r = await pick('K24W1');
  ok(/Exhaust on the front of the engine/.test(r.note) && /intake only/.test(r.note), 'K24W1: front exhaust and intake-only VTEC in the note');
  r = await pick('K24A2');
  ok(/Exhaust on the rear of the engine \(toward the firewall/.test(r.note) && /5 × M10 × 1.25 studs/.test(r.note) && /1\.771 in \(45\.0 mm\)/.test(r.note), 'K24A2: rear exhaust, M10 studs, flange port in both units');
  ok(/3\.425/.test(r.boreTxt), 'K24A2 bore shown in inches on the 4-Stroke tab: ' + r.boreTxt);
  // every tab for the K24A2
  const tabs = ['quick', 'headers', 'crossover', 'mufflers', 'cats', 'sound', 'boom-tubes', 'intake', 'four-stroke', 'hangers', 'parts'];
  const tabText = async t => { await pg.click('[data-tab="' + t + '"]'); await pg.waitForTimeout(500);
    return pg.evaluate(() => { document.querySelectorAll('select').forEach(x => x.style.display = 'none'); const pn = [...document.querySelectorAll('section')].find(s => s.offsetParent !== null && s.textContent.length > 500);
      const t = (pn || document.body).innerText; document.querySelectorAll('select').forEach(x => x.style.display = ''); return t; }); };
  for (const t of tabs) { const txt = await tabText(t); const m = txt.match(/.{0,40}(\bNaN\b|undefined|Infinity|\bnull\b).{0,30}/);
    ok(!m && txt.length > 500, 'K24A2 ' + t + ' tab renders without NaN / undefined / null' + (m ? ': …' + m[0].replace(/\s+/g, ' ') + '…' : '')); }
  // headers: inline-four wording and pairing, lengths by hand
  let h = await tabText('headers');
  ok(/Cut every runner to about 27\.0 in \(686 mm\)/.test(h), 'header runner 27.0 in (686 mm): 850 x 240 / 6800 - 3');
  ok(/about 1\.53 in \(38\.8 mm\) inside/.test(h), 'primary ID 1.53 in (38.8 mm) by the sizing rule');
  ok(/1 @ 0° · 4 @ 360°/.test(h) && /3 @ 180° · 2 @ 540°/.test(h) && /cylinders 1 and 4, 2 and 3 each into their own collector/.test(h), 'default split pairs 1-4 and 2-3, explained for an inline engine');
  ok(!/Ports facing/.test(h) && await pg.$eval('#h-ports-wrap', e => e.hidden), 'no V-engine port-direction section or input on an inline-four');
  ok(!/on a V8, but the tubes/.test(h) && /An inline-four at 1-3-4-2 already fires evenly every 180°/.test(h), '180° guide names the V8 case and the inline-four');
  await pg.evaluate(() => { const e = document.getElementById('h-merge'); e.value = 'triy'; e.dispatchEvent(new Event('change', { bubbles: true })); }); await pg.waitForTimeout(300);
  h = await tabText('headers');
  ok(/You get 1 collector \(4-into-1\)/.test(h) && /1 \+ 4/.test(h) && /3 \+ 2/.test(h) && /Tri-Y: join each pair first/.test(h), 'Tri-Y with the default grouping: a 4-2-1 pairing 1+4 and 3+2, no error');
  await pg.evaluate(() => { const e = document.getElementById('h-grp'); e.value = 'all'; e.dispatchEvent(new Event('change', { bubbles: true })); const m = document.getElementById('h-merge'); m.value = 'direct'; m.dispatchEvent(new Event('change', { bubbles: true })); }); await pg.waitForTimeout(300);
  h = await tabText('headers');
  ok(/You get 1 collector \(4-into-1\)/.test(h) && /180 · 180 · 180 · 180°/.test(h), '4-1: one collector, a pulse every 180°');
  ok(/27\.0 in/.test(h) && /686 mm/.test(h), 'header lengths in inches and mm');
  // intake: turbo, 15 psi, 450 hp
  await pg.click('[data-tab="intake"]'); await pg.waitForTimeout(300);
  await pg.evaluate(() => { const s = (i, v) => { const e = document.getElementById(i); e.value = v; e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }; s('i-ind', 'turbo'); s('i-boost', '15'); s('i-hp', '450'); });
  await pg.waitForTimeout(800);
  const it = await tabText('intake');
  ok(/Garrett’s method for 450 hp\s*49\.5 lb\/min \(0\.374 kg\/s\) per compressor/.test(it), 'Garrett 450 x 12 x 0.55 / 60 = 49.5 lb/min (0.374 kg/s)');
  ok(!/\bNaN\b|undefined/.test(it), 'turbo K24 intake renders cleanly');
  // 400 px: no sideways scroll on any tab
  await pg.setViewportSize({ width: 400, height: 900 });
  for (const t of tabs) { await pg.click('[data-tab="' + t + '"]'); await pg.waitForTimeout(300);
    const w = await pg.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]); ok(w[0] <= w[1] + 1, '400 px ' + t + ': no horizontal scroll (' + w.join(' / ') + ')'); }
  ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(fails.length ? fails.length + ' FAILED' : 'k24_ui: all pass'); process.exit(fails.length ? 1 : 0);
})();
