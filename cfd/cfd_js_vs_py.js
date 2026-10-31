// Byte-for-byte check: cfd/intake_cfd.js (browser writer) against cfd/intake_cfd.py on the three
// Blair & Cahoon bellmouths plus a few more axisymmetric designs (flange mount, cone, taper, MAF plane,
// engine operating point, pressure-ratio operating point, incompressible, coarse/fine mesh).
//   node cfd/cfd_js_vs_py.js            (outputs in the system temp folder, cfd_js_vs_py_out)
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const CFD = fs.existsSync(path.join(__dirname, 'intake_cfd.py')) ? __dirname : path.join(__dirname, 'cfd');
const I = require(path.join(CFD, 'intake_cfd.js'));
const OUT = path.join(os.tmpdir(), 'cfd_js_vs_py_out'); fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
// the exhaust test geometry is generated (4.5 MB of ASCII STL, not kept in the repository): same call as run_validation.py
const EXP_STL = path.join(CFD, 'validation', 'runs', '_stl', 'expansion_50_100.stl');
if (!fs.existsSync(EXP_STL)) {
  fs.mkdirSync(path.dirname(EXP_STL), { recursive: true });
  execFileSync('python3', ['-c', 'import sys; sys.path.insert(0, sys.argv[1]); import run_validation as rv; '
    + 'rv.tube_stl(sys.argv[2], [("line", 50.0, 25.0, 25.0), ("line", 1000.0, 50.0, 50.0)])',
    path.join(CFD, 'validation'), EXP_STL], { stdio: 'inherit' });
}
const STAMP = '2026-10-30 12:00';
const P0 = 101325.0;
const blair = (name, inlet, L, mdot, level) => ({
  name, geometry: { tube_diameter_mm: 23.0, tube_length_mm: L, inlet, mount: { type: 'free', protrusion_mm: L }, planes_mm: { plus1D: L + 23.0, plus2D: L + 46.0 }, outlet_extension_D: 4 },
  operating_point: { mass_flow_kg_s: mdot }, ambient: { p_pa: P0, T_c: 25.0 }, mesh: { level: level || 'medium' }, solver: { force: 'compressible' } });
const designs = {
  'PP-46-23-23-0': blair('PP-46-23-23-0', { type: 'plain', wall_thickness_mm: 1.85 }, 46.0, 30.023e-3),
  'RAD-46-23-35-6': blair('RAD-46-23-35-6', { type: 'radius', lip_radius_mm: 6.0 }, 46.0, 34.83e-3),
  'ELL-23-23-49-3': blair('ELL-23-23-49-3', { type: 'ellipse', length_mm: 23.0, entry_diameter_mm: 49.0, exit_diameter_mm: 23.0, corner_radius_mm: 3.0 }, 23.0, 36.15e-3),
  'PP_fine': blair('PP-46-23-23-0', { type: 'plain', wall_thickness_mm: 1.85 }, 46.0, 29.9133e-3, 'fine'),
  'RAD_coarse': blair('RAD-46-23-35-6', { type: 'radius', lip_radius_mm: 6.0 }, 46.0, 36.2175e-3, 'coarse'),
  'stack_engine': { name: 'velocity_stack_example', geometry: { tube_diameter_mm: 45.0, tube_length_mm: 200.0, inlet: { type: 'ellipse', length_mm: 45, entry_diameter_mm: 90, exit_diameter_mm: 45, corner_radius_mm: 4 }, mount: { type: 'free', protrusion_mm: 45 }, maf_plane_mm: 150, outlet_extension_D: 4 },
    operating_point: { engine: { displacement_cc: 600, rpm: 12000, ve: 1.0, strokes: 4, cylinders: 4, cylinders_fed: 1 } }, ambient: { p_pa: 101325, T_c: 25 }, mesh: { level: 'medium' } },
  'flange_cone_taper': { name: 'airbox_taper_cone', geometry: { tube_diameter_mm: 76.2, tube_length_mm: 600, inlet: { type: 'taper', entry_diameter_mm: 110, wall_half_angle_deg: 10, lip_radius_mm: 6 }, mount: { type: 'flange' }, diameter_change: { to_diameter_mm: 88.9, cone_half_angle_deg: 7, start_mm: 250 }, maf_plane_mm: 450, outlet_extension_D: 3 },
    operating_point: { engine: { displacement_cc: 5700, rpm: 6500, ve: 0.95, strokes: 4, cylinders: 8 } }, ambient: { p_pa: 100000, T_c: 30 }, mesh: { level: 'medium' } },
  'plain_PR_incomp': { name: 'tube_pressure_ratio', geometry: { tube_diameter_mm: 60, tube_length_mm: 300, inlet: { type: 'plain' }, mount: { type: 'free' }, maf_plane_mm: 200 },
    operating_point: { pressure_ratio: 1.01 }, ambient: { p_pa: 101325, T_c: 20 }, mesh: { level: 'coarse' }, solver: { force: 'incompressible', max_iterations: 2000, write_interval: 250 } },
  'bend_3d': { name: 'bent_tube', geometry: { tube_diameter_mm: 76.2, tube_length_mm: 500, inlet: { type: 'radius', lip_radius_mm: 10 }, mount: { type: 'free' }, bend: { clr_mm: 115, angle_deg: 90, start_mm: 150 }, maf_plane_mm: 400 },
    operating_point: { engine: { displacement_cc: 2000, rpm: 7000, ve: 1.0, strokes: 4, cylinders: 4 } }, ambient: { p_pa: 101325, T_c: 25 }, mesh: { level: 'medium' } },
  'exhaust_expansion': { name: 'expansion_50_100', mode: 'exhaust', geometry: { stl: path.join(CFD, 'validation', 'runs', '_stl', 'expansion_50_100.stl'), stl_units: 'mm', inlet_extension_D: 2, outlet_extension_D: 2 },
    operating_point: { mass_flow_kg_s: 0.075 }, gas: { T_c: 650 }, ambient: { p_pa: 101325, T_c: 25 }, mesh: { level: 'medium' } },
};
function walk(dir, rel, acc) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) walk(path.join(dir, e.name), r, acc); else acc.push(r); } return acc; }
let fails = 0, files = 0;
for (const key of Object.keys(designs)) {
  const dj = path.join(OUT, key + '.json'), pyDir = path.join(OUT, key + '_py');
  const text = JSON.stringify(designs[key], null, 1);   // JSON text is the shared input (ints stay ints, floats as written)
  fs.writeFileSync(dj, text);
  let pyOk = true, pyErr = '';
  try { execFileSync('python3', [path.join(CFD, 'intake_cfd.py'), dj, pyDir], { env: Object.assign({}, process.env, { INTAKE_CFD_STAMP: STAMP }), stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { pyOk = false; pyErr = String(e.stdout || e.stderr); }
  let js;
  try { js = I.generateCase(JSON.parse(text), { stamp: STAMP, out_dir: pyDir, design_text: text }); } catch (e) { console.log('FAIL ' + key + ': JS threw ' + e.message); fails++; continue; }
  if (js.is3d) {
    const ok = js.files.map(f => f.name).sort().join() === 'README.md,README_WINDOWS.md,design.json,intake_cfd.py' && js.files.find(f => f.name === 'intake_cfd.py').text === fs.readFileSync(path.join(CFD, 'intake_cfd.py'), 'utf8')
      && js.files.find(f => f.name === 'design.json').text === fs.readFileSync(path.join(pyDir, 'design_input.json'), 'utf8');
    console.log((ok && pyOk ? 'PASS ' : 'FAIL ') + key + ': 3-D design -> design.json + intake_cfd.py + READMEs (Python wrote ' + (pyOk ? 'a snappy case' : 'nothing: ' + pyErr.slice(0, 200)) + ')'); if (!ok || !pyOk) fails++;
    continue;
  }
  if (!pyOk) { console.log('FAIL ' + key + ': python failed ' + pyErr.slice(0, 200)); fails++; continue; }
  const pyFiles = walk(pyDir, '', []).sort(), jsFiles = js.files.map(f => f.name).sort();
  let bad = [];
  if (pyFiles.join() !== jsFiles.join()) bad.push('file lists differ: py ' + pyFiles.join(' ') + ' | js ' + jsFiles.join(' '));
  for (const f of js.files) {
    const pp = path.join(pyDir, f.name); if (!fs.existsSync(pp)) continue;
    const a = fs.readFileSync(pp, 'utf8'); files++;
    if (a !== f.text) {
      const al = a.split('\n'), bl = f.text.split('\n'); let i = 0; while (i < al.length && al[i] === bl[i]) i++;
      bad.push(f.name + ' differs at line ' + (i + 1) + ':\n    py: ' + (al[i] || '').slice(0, 160) + '\n    js: ' + (bl[i] || '').slice(0, 160));
      fs.writeFileSync(path.join(OUT, key + '_js_' + f.name.replace(/\//g, '_')), f.text);
    }
    if (f.name === 'Allrun' || f.name === 'Allclean') { const mode = fs.statSync(pp).mode & 0o111; if (!mode || !f.exec) bad.push(f.name + ' executable flag mismatch'); }
  }
  console.log((bad.length ? 'FAIL ' : 'PASS ') + key + ': ' + js.files.length + ' files, ' + js.summary.cells + ' cells' + (bad.length ? '\n  ' + bad.join('\n  ') : ''));
  if (bad.length) fails++;
}
console.log(files + ' files compared; ' + (fails ? fails + ' FAILED' : 'all identical'));
process.exit(fails ? 1 : 0);
