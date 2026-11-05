/* wam_export.js - OpenWAM 2.2 input files (.wam) from the exhaust calculator's simSpec(), in the browser.
 *
 * A line-for-line port of make_wam.py v2 (same folder): for the same spec and run settings,
 * WamExport.makeWam() returns exactly the text make_wam.make_wam_spec() writes (test_py_js.js checks
 * this byte for byte). Numbers are formatted like Python's "%.12g" / "%g" and rounded like Python's
 * round(x, n): both are done here on the exact binary value of the double (BigInt), half to even.
 *
 * API (plain browser JavaScript, no require/fs; the module.exports at the end is guarded):
 *   WamExport.makeWam(spec, run)        -> .wam text. spec = simSpec() result {e, intake, exhaust, opt, n};
 *                                          optional spec.opt.collectors for Tri-Y or several collectors.
 *                                          run = {rpm, cycles, name, ...any make_wam.py DEFAULTS key}.
 *   WamExport.makeWamLegacy(p)          -> v1 single-cylinder file from the flat DEFAULTS-style dict.
 *   WamExport.modelFromSpec(spec, run), WamExport.writeModel(model)  -> the two layers underneath.
 *   WamExport.readAvg(text, opts)       -> per-cycle rows from an <name>AVG.DAT file.
 *   WamExport.readIns(text, opts)       -> {time, p, u, T, mdot, rho, ...} at the open-end node from <name>INS.DAT
 *                                          (needs run.ins_outlet = 1); opts {pipe, keepCycles}.
 *   WamExport.outStepForRate(rpm, fs)   -> out_step_deg that gives fs rows per second.
 *   WamExport.batFile(models, exePath)  -> Windows .bat that runs each model in its own subfolder in turn.
 *   WamExport.DEFAULTS, WamExport.EXTRA_DEFAULTS
 *   WamExport.Writer, splitRuns, FS_GASOLINE_SIMPLE, COMB_COMPLETE, fmtG, pyRound: shared with wam2t_export.js
 *
 * v3 (sound): collector.tail / exhaust.tail = the line after the collector as a list of
 *   {L_mm, d0_mm, d1_mm, [Tw_C]} pipe segments and {V_litres, [T0_C]} expansion-volume mufflers (constant-volume
 *   plenum TDepVolCte between two pipes, joined by TCCDeposito ports with a fixed CD of 1). The plenum captures the
 *   low-frequency expansion-chamber behaviour of a chambered muffler, not its internal baffles; it is adiabatic in
 *   OpenWAM 2.2, so T0_C is only its initial gas temperature (default: the exhaust pipes' initial gas T). Run settings
 *   ins_outlet (instantaneous p, u, T, mass flow at the open-end node of every exhaust outlet and at the pipe nodes on
 *   both sides of every plenum, plus plenum p, T, mass) and ins_cycles (1 = OpenWAM's one-cycle
 *   INS file, N > 1 = all cycles concatenated, readIns keeps the last N). See make_wam.py's docstring.
 * v4 (unequal length): exhaust.per_cyl = [segs or null, ...] (cylinder index order, null = exhaust.segs) gives each
 *   cylinder its own primary; a stage's segs_by_group = [segs or null, ...] (one per group, null = stage.segs) gives
 *   each junction group its own branch: Subaru/Porsche-style unequal-length 4-2-1 manifolds, whose firing phases and
 *   lengths produce the half-order (1.5, 2.5 ...) content a symmetric model cannot. intake.reservoir = {p_bar, [T_C]}
 *   opens the runner inlets into a space at fixed pressure (BC type 1) = the throttled plenum at manifold pressure.
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ number formatting
  // x = 0.S x 10^K exactly, S without leading/trailing zeros (x > 0, finite)
  function decompose(x) {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setFloat64(0, x);
    const hi = dv.getUint32(0), lo = dv.getUint32(4);
    const E = (hi >>> 20) & 0x7ff;
    let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), e;
    if (E === 0) e = -1074; else { m |= 1n << 52n; e = E - 1075; }
    let S, K;
    if (e >= 0) { S = (m << BigInt(e)).toString(); K = S.length; }
    else { S = (m * 5n ** BigInt(-e)).toString(); K = S.length + e; }
    S = S.replace(/0+$/, '');
    return { S, K };
  }
  // keep P significant digits, round half to even on the exact digits
  function roundSig(S, K, P) {
    if (S.length <= P) return { S, K };
    let head = S.slice(0, P);
    const rest = S.slice(P);
    let up;
    if (rest[0] > '5') up = true;
    else if (rest[0] < '5') up = false;
    else up = /[1-9]/.test(rest.slice(1)) || (Number(head[head.length - 1]) % 2 === 1);
    if (up) {
      let h = (BigInt(head) + 1n).toString();
      if (h.length > head.length) { K += 1; h = h.slice(0, P); }
      head = h;
    }
    head = head.replace(/0+$/, '');
    return { S: head, K };
  }
  // C/Python "%.<P>g"
  function fmtG(x, P) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('not a finite number: ' + x);
    if (x === 0) return Object.is(x, -0) ? '-0' : '0';
    const neg = x < 0;
    let { S, K } = decompose(neg ? -x : x);
    ({ S, K } = roundSig(S, K, P));
    const X = K - 1;
    let out;
    if (X < -4 || X >= P) {
      out = (S.length > 1 ? S[0] + '.' + S.slice(1) : S) + 'e' + (X < 0 ? '-' : '+') + String(Math.abs(X)).padStart(2, '0');
    } else if (X >= 0) {
      const ip = S.length > X + 1 ? S.slice(0, X + 1) : S + '0'.repeat(X + 1 - S.length);
      const fp = S.slice(X + 1);
      out = fp ? ip + '.' + fp : ip;
    } else {
      out = '0.' + '0'.repeat(-X - 1) + S;
    }
    return (neg ? '-' : '') + out;
  }
  // Python round(x, n), n >= 0: nearest double to x correctly rounded to n decimals, half to even
  function pyRound(x, n) {
    if (!Number.isFinite(x) || x === 0) return x;
    const neg = x < 0;
    const { S, K } = decompose(neg ? -x : x);
    const keep = K + n;
    let v;
    if (keep < 0) v = 0;
    else if (keep === 0) v = (S[0] > '5' || (S[0] === '5' && /[1-9]/.test(S.slice(1)))) ? Number('1e-' + n) : 0;
    else if (S.length <= keep) v = neg ? -x : x;
    else { const r = roundSig(S, K, keep); v = Number(r.S + 'e' + (r.K - r.S.length)); }
    return neg ? -v : v;
  }
  // Python round(x) to an int, half to even
  function pyRoundInt(x) {
    const f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  const pctG = x => fmtG(x, 6);                 // Python "%g"
  const pctD = x => String(Math.trunc(x));      // Python "%d"

  // ------------------------------------------------------------------ defaults (make_wam.py)
  const FS_GASOLINE_SIMPLE = 0.068468349;
  const DEFAULTS = {
    name: 'single450', rpm: 8000.0, cycles: 25, out_step_deg: 1.0, p_amb_bar: 1.013, T_amb_C: 25.0, gamma_model: 2,
    bore_mm: 95.0, stroke_mm: 63.4, rod_mm: 110.0, cr: 13.0,
    n_int: 2, d_int_mm: 40.0, lift_int_mm: 11.0, n_exh: 2, d_exh_mm: 33.0, lift_exh_mm: 9.5,
    ivo_btdc: 35.0, ivc_abdc: 65.0, evo_bbdc: 65.0, evc_atdc: 35.0,
    valve_cd: 0.7, curtain_cap: 0.85, lift_step_deg: 1.0, cd_step_mm: 0.25, cd_clip: 1.0, valve_spacing_mm: 40.0,
    burn_start_btdc: 18.0, burn_dur_deg: 55.0, wiebe_a: 5.0, wiebe_m: 2.0, afr: 12.8, lhv_J_kg: 44.0e6, comb_eff: 0.72,
    fuel_density: 740.0, T_piston_C: 176.85, T_head_C: 176.85, T_liner_C: 176.85, woschni_cw1: 2.28, woschni_cw2: 0.308,
    A_piston_m2: null, A_head_m2: null, fmep_c0: 0.5, fmep_c1: 0.012, fmep_c2: 0.0, fmep_c3: 0.0,
    intake_len_mm: 300.0, intake_d_mm: 44.0, intake_Twall_C: 46.85, exhaust_len_mm: 800.0, exhaust_d_mm: 42.0,
    exhaust_Twall_C: 426.85, exhaust_Tgas0_C: 426.85, roughness_mm: 0.02, cell_mm: 10.0, courant: 0.8,
    pipe_method: 'tvd', fct_option: 1, end_loss: 1.0, pipe_htc_mult: 1.0, pipe_fric_mult: 1.0,
  };
  const EXTRA_DEFAULTS = { step_bc: 'union', avg_points: 1, ins_outlet: 0, ins_cycles: 1, plenum_cd: 1.0 };
  const CALC_P_ATM_BAR = 1.01325, CALC_T_ATM_C = 25.0, CALC_T0_EXHAUST_K = 700.0, CALC_TWALL_CYL_K = 450.0,
    CALC_CURTAIN_CAP = 0.85, CALC_TATM_K = 298.15, K0 = 273.15;
  const R_BURNT = 285.4;    // Constantes.h:71 __R::Burnt
  function outStepForRate(rpm, fsHz) { return 6.0 * Number(rpm) / Number(fsHz); }

  // ------------------------------------------------------------------ writer
  function Writer() { this.lines = []; }
  function clean(label) {
    if (label.indexOf('<') >= 0 || label.indexOf('>') >= 0) throw new Error('label may not contain angle brackets: ' + label);
    return label;
  }
  function fmt(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('unsupported value ' + x);
    return x === 0 ? '0' : fmtG(x, 12);
  }
  Writer.prototype.section = function (title) { this.lines.push(''); this.lines.push('<' + clean('==== ' + title + ' ====') + '>'); };
  Writer.prototype.comment = function (text) { this.lines.push('<' + clean(text) + '>'); };
  Writer.prototype.v = function (value, label) { this.lines.push(fmt(value).padEnd(18) + ' <' + clean(label) + '>'); };
  Writer.prototype.row = function (values, label, perLine) {
    perLine = perLine || 10;
    for (let i = 0; i < values.length; i += perLine) {
      const chunk = values.slice(i, i + perLine).map(fmt).join(' ');
      this.lines.push(i === 0 ? chunk + ' <' + clean(label) + '>' : chunk);
    }
  };
  Writer.prototype.text = function () {
    for (const ln of this.lines) if (ln.length >= 790) throw new Error('line too long for CleanLabelsX (char line[800]): ' + ln.slice(0, 60));
    return this.lines.join('\n') + '\n';
  };

  // ------------------------------------------------------------------ engine and valve tables
  function engineDerived(p) {
    const d = {};
    const B = p.bore_mm / 1000.0, S = p.stroke_mm / 1000.0;
    d.B = B; d.S = S; d.rod = p.rod_mm / 1000.0;
    d.Ap = Math.PI / 4.0 * B * B;
    d.Vd = d.Ap * S;
    d.Vc = d.Vd / (p.cr - 1.0);
    d.A_piston = p.A_piston_m2 ? p.A_piston_m2 : d.Ap;
    d.A_head = p.A_head_m2 ? p.A_head_m2 : d.Ap + 4.0 * d.Vc / B;
    d.ivo = 360.0 - p.ivo_btdc;
    d.ivc = 540.0 + p.ivc_abdc;
    d.evo = 180.0 - p.evo_bbdc;
    d.evc = 360.0 + p.evc_atdc;
    d.dur_int = d.ivc - d.ivo;
    d.dur_exh = d.evc - d.evo;
    for (const k of ['ivo', 'ivc', 'evo', 'evc'])
      if (!(0.0 < d[k] && d[k] < 720.0)) throw new Error(k + '=' + pctG(d[k]) + ' must lie inside (0,720) for TValvula4T::GetCDin');
    d.phi = (1.0 / p.afr) / FS_GASOLINE_SIMPLE;
    if (!(p.valve_spacing_mm > Math.max(p.d_int_mm, p.d_exh_mm) / 2.0))
      throw new Error('valve_spacing_mm must exceed the larger valve radius: asin(d/2/spacing) TCilindro.cpp:555');
    return d;
  }
  function liftTable(lmax, dur, step) {
    const n = pyRoundInt(dur / step);
    if (Math.abs(n * step - dur) > 1e-9) throw new Error('valve duration ' + pctG(dur) + ' is not a multiple of lift_step_deg ' + pctG(step));
    const out = [];
    for (let i = 0; i <= n; i++) out.push(pyRound(lmax * Math.pow(Math.sin(Math.PI * i / n), 2), 6));
    return out;
  }
  function cdTable(nv, dmm, lmax, stepmm, cd, cap, apipe, clip) {
    const npts = Math.ceil(lmax / stepmm - 1e-9) + 1, out = [];
    for (let i = 0; i < npts; i++) {
      const L = i * stepmm;
      const a = Math.min(Math.PI * dmm * L, cap * Math.PI / 4.0 * dmm * dmm);
      const val = nv * cd * a * 1e-6 / apipe;
      out.push(pyRound(Math.min(clip, val), 6));
    }
    return [npts, out];
  }

  // ------------------------------------------------------------------ model -> text
  const BC_DESC = { open: 'open end', closed: 'closed end', ivalve: 'intake valve', evalve: 'exhaust valve', branch: 'junction', step: 'diameter step', plenum: 'plenum port', reservoir: 'reservoir', loss: 'pressure loss' };
  const BC_ENDS = { open: [1, 1], closed: [1, 1], ivalve: [1, 1], evalve: [1, 1], step: [2, 2], branch: [2, 999], plenum: [1, 1], reservoir: [1, 1], loss: [2, 2] };
  function pipeLen(pp) { let s = 0.0; for (const sec of pp.secs) s += sec[0]; return s; }
  function endD(pp, side) { return side === 'left' ? pp.D0 : pp.secs[pp.secs.length - 1][1]; }
  function getBc(bcs, k) { return bcs instanceof Map ? bcs.get(k) : bcs[k]; }
  function bcKeys(bcs) { return bcs instanceof Map ? Array.from(bcs.keys()) : Object.keys(bcs); }

  function numberModel(m) {
    const pipes = m.pipes, bcs = m.bcs, num = new Map(), order = [], ends = new Map();
    pipes.forEach((pp, i) => {
      if (pp.left === pp.right) throw new Error('pipe ' + (i + 1) + ' has the same BC at both ends');
      if (!pp.secs.length) throw new Error('pipe ' + (i + 1) + ' has no sections');
      for (const side of ['left', 'right']) {
        const k = pp[side];
        if (!getBc(bcs, k)) throw new Error('pipe ' + (i + 1) + ' refers to unknown BC ' + k);
        if (!num.has(k)) { order.push(k); num.set(k, order.length); }
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push([i, side]);
      }
    });
    for (const k of bcKeys(bcs)) if (!num.has(k)) throw new Error('BC ' + k + ' is not attached to any pipe');
    for (const k of order) {
      const t = getBc(bcs, k).type, lim = BC_ENDS[t];
      if (!lim) throw new Error('unknown BC type ' + t);
      if (!(lim[0] <= ends.get(k).length && ends.get(k).length <= lim[1])) throw new Error('BC ' + k + ' of type ' + t + ' has ' + ends.get(k).length + ' pipe ends');
    }
    return { num, order, ends };
  }

  function writeModel(m) {
    const p = m.p, d = engineDerived(p), phases = m.phases, ncyl = phases.length, pipes = m.pipes, bcs = m.bcs;
    const B = k => getBc(bcs, k);
    const { num, order, ends } = numberModel(m);
    const pnum = k => ends.get(k)[0][0] + 1;
    for (const k of order) { const b = B(k); if ((b.type === 'ivalve' || b.type === 'evalve') && !(1 <= b.cyl && b.cyl <= ncyl)) throw new Error('valve BC ' + k + ' refers to cylinder ' + b.cyl); }
    for (let c = 1; c <= ncyl; c++) for (const t of ['ivalve', 'evalve'])
      if (!order.some(k => B(k).type === t && B(k).cyl === c)) throw new Error('cylinder ' + c + ' has no ' + BC_DESC[t]);
    for (const ph of phases) if (!(0.0 <= ph && ph < 720.0)) throw new Error('firing angle ' + pctG(ph) + ' must lie in [0, 720)');
    const plenums = m.plenums || [];
    const plenumBcs = order.filter(k => B(k).type === 'plenum');
    for (const k of plenumBcs) if (!(1 <= B(k).plenum && B(k).plenum <= plenums.length)) throw new Error('plenum BC ' + k + ' refers to plenum ' + B(k).plenum + ' of ' + plenums.length);
    plenums.forEach((pl, j) => {
      if (!plenumBcs.some(k => B(k).plenum === j + 1)) throw new Error('plenum ' + (j + 1) + ' has no pipe connected');
      if (!(pl.V_m3 > 0.0)) throw new Error('plenum ' + (j + 1) + ' volume must be positive');
    });

    const vkeys = [], vtOf = new Map();
    for (const k of order) {
      const b = B(k);
      if (b.type === 'ivalve' || b.type === 'evalve') {
        const [i, side] = ends.get(k)[0], D = endD(pipes[i], side);
        let j = vkeys.findIndex(v => v[0] === b.type && v[1] === D);
        if (j < 0) { vkeys.push([b.type, D]); j = vkeys.length - 1; }
        vtOf.set(k, j + 1);
      }
    }
    const nSide = { ivalve: 0, evalve: 0 };
    for (const v of vkeys) nSide[v[0]] += 1;

    const w = new Writer(), T = 'TOpenWAM.cpp';
    w.comment('OpenWAM 2.2 input written by make_wam.py - ' + p.name + ', ' + pctG(p.rpm) + ' rpm');
    w.comment('labels give the reader source file:line; units as used by that reader');

    w.section('HEADER  TOpenWAM::ReadInputData');
    w.v(2200, T + ':477 version, must equal vers 2200 Globales.h:53');
    w.v(0, T + ':485 Independent 0 = common time step for all pipes');

    w.section('GENERAL DATA  TOpenWAM::ReadGeneralData');
    w.v(p.out_step_deg, T + ':606 agincr, instantaneous output interval deg');
    w.v(Math.trunc(p.cycles), T + ':606 SimulationDuration = number of engine cycles');
    w.v(p.p_amb_bar, T + ':607 ambient pressure bar');
    w.v(p.T_amb_C, T + ':607 ambient temperature degC');
    w.v(0, T + ':608 species model 0 = simple: burnt gas, fuel, air');
    w.v(Math.trunc(p.gamma_model), T + ':608 gamma 0 const, 1 f-composition, 2 f-composition-temperature');
    w.v(1, T + ':622 engine block present');
    w.v(0, T + ':627 cycle type, 1 = 2T, anything else = 4T');
    w.v(0, T + ':627 simulation type 0 = steady speed');
    w.v(0, T + ':627 EGR transport 0 = no');
    w.v(1, T + ':743 fuel present');
    w.v(1, T + ':745 fuel type 1 = gasoline');
    w.row([0.0, 0.0, 1.0], T + ':802 atmosphere mass fractions burnt, fuel, air; sum must be exactly 1');

    const E = 'TBloqueMotor.cpp';
    w.section('ENGINE  TBloqueMotor::LeeMotor');
    w.v(0, E + ':117 ACT combustion model 0 = off, Wiebe law used');
    w.v(ncyl, E + ':134 number of cylinders');
    w.v(p.rpm, E + ':148 engine speed rpm');
    w.v(p.p_amb_bar, E + ':149 initial cylinder pressure at IVC bar');
    const m0 = p.p_amb_bar * 1e5 * (d.Vd + d.Vc) / (287.0 * (p.T_amb_C + 273.15 + 35.0));
    w.v(pyRound(m0, 9), E + ':150 initial cylinder mass kg, start-up guess only');
    w.v(0, E + ':153 impose composition at EVO 0 = no');
    w.row([0.0, 0.0, 1.0], E + ':156 initial cylinder mass fractions burnt, fuel, air');
    w.v(0, E + ':176 pressure at EVO 0 = calculated');
    w.v(1, E + ':185 combustion type 1 = spark ignition, fuel from trapped air');
    w.v(pyRound(d.phi, 10), E + ':196 relative fuel-air ratio = (1/AFR)/0.068468349, TCilindro.cpp:2735');
    w.v(p.comb_eff, E + ':199 combustion efficiency, multiplies released heat TCilindro4T.cpp:634');
    w.v(p.lhv_J_kg, E + ':200 lower heating value J/kg');
    w.v(p.fuel_density, E + ':201 fuel density kg/m3, not used');
    const veKeys = order.filter(k => B(k).type === 'ivalve' && B(k).cyl === 1), vep = pnum(veKeys[0]);
    w.v(vep, E + ':203 pipe used for volumetric efficiency, ' + pctD(vep) + ' = intake pipe' +
      (ncyl === 1 ? '' : ' of cylinder 1; engine VE then counts one runner, use the per-cylinder VE'));
    w.v(p.T_piston_C, E + ':209 piston wall temperature degC');
    w.v(p.T_head_C, E + ':210 head wall temperature degC');
    w.v(p.T_liner_C, E + ':211 liner wall temperature degC');
    w.v(pyRound(d.A_piston, 9), E + ':213 piston heat-transfer area m2');
    w.v(pyRound(d.A_head, 9), E + ':214 head heat-transfer area m2');
    w.row([0.01, 150.0, 2700.0, 900.0], E + ':216 piston wall thickness m, k W/mK, rho, cp; unused, walls fixed');
    w.row([0.01, 150.0, 2700.0, 900.0], E + ':218 head wall thickness m, k, rho, cp; unused');
    w.row([0.01, 150.0, 2700.0, 900.0], E + ':220 liner wall thickness m, k, rho, cp; unused');
    w.row([1.0, 1.0, 50.0, 90.0], E + ':223 HT multiplier intake stroke, exhaust stroke, torque at max power Nm, coolant degC');
    w.v(2, E + ':225 wall temperature 2 = fixed, CalculaTemperaturasPared skipped TCilindro4T.cpp:579');
    w.v(p.woschni_cw1, E + ':241 Woschni cw1 compression-expansion');
    w.v(p.woschni_cw2, E + ':242 Woschni cw2, multiplies swirl velocity, zero here');
    w.v(0.0, E + ':243 Woschni xpe, read but not used');
    w.v(d.rod, E + ':249 connecting rod length m');
    w.v(d.S, E + ':250 stroke m');
    w.v(d.B, E + ':251 bore m');
    w.v(p.cr, E + ':252 compression ratio');
    w.v(0.0, E + ':253 bowl diameter m, 0 = flat, no squish swirl');
    w.v(0.0, E + ':254 bowl height m');
    w.v(p.valve_spacing_mm / 1000.0, E + ':255 distance between valves m, short-circuit model, must exceed valve radius');
    w.v(0.0, E + ':256 blow-by area');
    w.v(0.0, E + ':257 blow-by CD, 0 = no blow-by TCilindro4T.cpp:355');
    w.v(0.0, E + ':258 piston pin offset mm, TCilindro.cpp:1951 divides by 1000');
    w.v(0.02, E + ':259 pin diameter m, used only if deformation coef non-zero');
    w.v(0.03, E + ':260 piston crown height m, deformation only');
    w.v(0.35, E + ':261 rod mass kg, deformation only');
    w.v(0.35, E + ':262 piston+rings+pin mass kg, deformation only');
    w.v(2.1e11, E + ':263 elastic modulus Pa, deformation only');
    w.v(0.0, E + ':264 deformation coefficient 0 = rigid');
    w.row([p.fmep_c0, p.fmep_c1, -p.fmep_c2, p.fmep_c3], E + ':274 FMEP bar = C0 + C1*n/60 - C2*(n/60)^2 + C3*IMEP, TBloqueMotor.cpp:1073');
    w.v(1, E + ':358 number of burn laws');
    w.row([pyRound(m0, 9), pyRound(m0 / p.afr, 12), p.rpm], E + ':360 law reference air mass kg, fuel mass kg, rpm; only used to blend several laws');
    w.v(1, E + ':367 number of Wiebe functions');
    w.row([p.wiebe_m, p.wiebe_a, 1.0, p.burn_dur_deg, p.burn_start_btdc], E + ':369 Wiebe m, C=a, share, duration deg, start deg BTDC entered positive');
    w.v(0, E + ':384 injection data 0 = none, SI default timing used TCilindro4T.cpp:179-182');
    if (ncyl > 1) {
      w.v(0, E + ':446 firing angles 0 = one angle per cylinder, in cylinder order, read at 457');
      phases.forEach((ph, c) => w.v(ph, E + ':457 cylinder ' + (c + 1) + ' fires at this engine angle deg; its angle = engine angle - this, TCilindro.cpp:2001-2004'));
    }
    w.v(0, E + ':485 engine controllers');
    for (let c = 0; c < ncyl; c++) w.v(0, E + ':503 controllers for cylinder ' + (c + 1));

    const U = 'TTubo.cpp';
    w.section('PIPES  TOpenWAM::ReadPipes');
    w.v(pipes.length, T + ':852 number of pipes');
    const method = { tvd: [2], lw: [0, 0], lw_fct: [0, 1, Math.trunc(p.fct_option)] }[p.pipe_method];
    if (!method) throw new Error('unknown pipe_method ' + p.pipe_method);
    pipes.forEach((pp, i) => {
      const nl = num.get(pp.left), nr = num.get(pp.right);
      w.comment(pp.role + ' pipe ' + (i + 1) + ', ' + BC_DESC[B(pp.left).type] + ' BC' + nl + ' to ' + BC_DESC[B(pp.right).type] + ' BC' + nr);
      w.row([nl, nr, pp.secs.length, 1], U + ':546 left BC, right BC, number of sections, number of identical ducts');
      w.v(p.roughness_mm, U + ':547 wall roughness mm, Colebrook rug/3700/D TTubo.cpp:2121');
      w.row([pp.Tw_C, pp.Tg_C, p.p_amb_bar, 0.0], U + ':548 initial wall T degC, gas T degC, pressure bar, velocity m/s');
      w.row([Math.trunc(pp.ht), p.pipe_htc_mult, p.pipe_fric_mult], U + ':549 HT type 1 intake 2 exhaust, HT multiplier, friction multiplier');
      w.row(pp.comp.slice(), U + ':568 initial mass fractions burnt, fuel, air');
      w.row([p.cell_mm / 1000.0, 2], U + ':590 mesh size m, wall T 2 = constant');
      if (method[0] === 2) w.v(2, U + ':604 solver 2 = TVD');
      else {
        w.v(0, U + ':604 solver 0 = Lax-Wendroff family');
        w.v(method[1], U + ':608 0 = plain LW, 1 = LW+FCT');
        if (method[1] === 1) w.v(method[2], U + ':626 FCT option');
      }
      w.v(p.courant, U + ':665 Courant number');
      w.v(pp.D0, U + ':710 diameter at section start m');
      for (const sec of pp.secs) w.row([sec[0], sec[1]], U + ':712 section length m, diameter at section end m');
      w.comment('TTubo.cpp:716-776 reads no wall data: wall T constant and HT type 1 or 2');
    });

    const V = 'TValvula4T.cpp';
    w.section('VALVE TYPES  TOpenWAM::ReadValves');
    const nVtypes = vkeys.length + (plenumBcs.length ? 1 : 0), cdVtype = vkeys.length + 1;
    w.v(nVtypes, T + ':956 number of valve types');
    vkeys.forEach(([vtype, Dend], j) => {
      const apipe = Math.PI / 4.0 * Dend * Dend;
      const extra = nSide[vtype] > 1 ? ', pipe end ' + pctG(Dend * 1000.0) + ' mm' : '';
      let dv, lmax, dur, ao, nv;
      if (vtype === 'ivalve') {
        w.comment('valve type ' + (j + 1) + ': intake, ' + pctD(p.n_int) + ' x ' + pctG(p.d_int_mm) + ' mm, ' + pctG(p.lift_int_mm) + ' mm lift, IVO ' +
          pctG(p.ivo_btdc) + ' BTDC IVC ' + pctG(p.ivc_abdc) + ' ABDC' + extra);
        dv = p.d_int_mm; lmax = p.lift_int_mm; dur = d.dur_int; ao = d.ivo; nv = p.n_int;
      } else {
        w.comment('valve type ' + (j + 1) + ': exhaust, ' + pctD(p.n_exh) + ' x ' + pctG(p.d_exh_mm) + ' mm, ' + pctG(p.lift_exh_mm) + ' mm lift, EVO ' +
          pctG(p.evo_bbdc) + ' BBDC EVC ' + pctG(p.evc_atdc) + ' ATDC' + extra);
        dv = p.d_exh_mm; lmax = p.lift_exh_mm; dur = d.dur_exh; ao = d.evo; nv = p.n_exh;
      }
      w.v(1, T + ':974 valve type 1 = TValvula4T poppet valve');
      const prof = vtype === 'ivalve' ? p.lift_profile_int : p.lift_profile_exh;
      const lifts = prof ? profileTable(prof, dur, p.lift_step_deg) : liftTable(lmax, dur, p.lift_step_deg);
      const [ncd, cds] = cdTable(nv, dv, lmax, p.cd_step_mm, p.valve_cd, p.curtain_cap, apipe, p.cd_clip);
      w.v(dv / 1000.0, V + ':149 valve diameter m, short-circuit model only');
      w.v(lifts.length, V + ':149 number of lift points');
      w.v(p.lift_step_deg, V + ':149 angle step deg');
      w.v(ao, V + ':149 opening angle, cylinder frame 0 = firing TDC');
      w.v(0.0, V + ':149 reference diameter 0 = CD referred to pipe-end area TTipoValvula.cpp:89,323');
      w.v(0.0, V + ':149 mean swirl coefficient');
      w.row(lifts, V + ':162 lift mm, ' + (prof ? 'measured profile, centreline ' + pctG(prof.cl) + ' deg ' + (vtype === 'ivalve' ? 'ATDC' : 'BTDC') : 'sin^2 profile') + ', closes at opening + (n-1)*step');
      w.v(ncd, V + ':165 number of CD points');
      w.v(p.cd_step_mm, V + ':165 lift step of CD table mm');
      w.row(cds, V + ':174 CD inflow pipe to cylinder');
      w.row(cds, V + ':177 CD outflow cylinder to pipe');
      w.row(new Array(ncd).fill(0.0), V + ':180 swirl coefficient vs lift');
      w.v(1, V + ':183 speed control 1 = engine');
      w.v(1.0, V + ':197 cam to engine speed ratio, angle taken from cylinder');
      w.v(0, V + ':204 VVT controllers');
    });
    if (plenumBcs.length) {
      w.comment('valve type ' + cdVtype + ': fixed discharge coefficient, used by every pipe-to-plenum port');
      w.v(0, T + ':974 valve type 0 = TCDFijo fixed CD');
      w.row([p.plenum_cd, p.plenum_cd, 0], 'TCDFijo.cpp:85 CD pipe to plenum, CD plenum to pipe, 0 = referred to the pipe-end area');
    }

    w.section('PLENUMS  TOpenWAM::ReadPlenums');
    w.v(plenums.length, T + ':1063 number of plenums');
    w.row([0, 0, 0], T + ':1065 WAMer counts turbines, venturis, directional junctions');
    plenums.forEach((pl, j) => {
      w.comment('plenum ' + (j + 1) + ': ' + pl.note);
      w.v(0, T + ':1078 plenum type 0 = TDepVolCte constant volume, adiabatic (TDeposito.cpp:111)');
      w.row(pl.comp.slice(), 'TDeposito.cpp:161 initial mass fractions burnt, fuel, air');
      w.row([pl.V_m3, pl.p_bar, pl.T_C], 'TDeposito.cpp:185 volume m3, initial pressure bar, initial gas temperature degC');
    });
    w.section('COMPRESSORS  TOpenWAM::ReadCompressors');
    w.v(0, T + ':1181 number of compressors');

    w.section('CONNECTIONS  TOpenWAM::ReadConnections');
    w.v(order.length, T + ':1242 number of boundary conditions');
    w.row(new Array(9).fill(0), T + ':1244 nine WAMer-only counts, read and ignored');
    let firstOpen = true;
    for (const k of order) {
      const b = B(k), t = b.type;
      let note = b.note;
      if (t === 'branch') note += ', joins pipes ' + ends.get(k).map(([i, s]) => (i + 1) + ' ' + s).join(', ');
      w.comment('BC' + num.get(k) + ': ' + note);
      if (t === 'open') {
        w.v(0, T + ':1256 BC type 0 = open end to atmosphere');
        w.v(p.end_loss, 'TCCDescargaExtremoAbierto.cpp:141 inflow velocity coefficient' + (firstOpen ? ', 1 = no loss' : ''));
        firstOpen = false;
      } else if (t === 'ivalve' || t === 'evalve') {
        if (t === 'ivalve') w.v(7, T + ':1256 BC type 7 = intake valve'); else w.v(8, T + ':1256 BC type 8 = exhaust valve');
        w.v(0, 'TCCCilindro.cpp:169 WAMer id, ignored');
        w.v(Math.trunc(b.cyl), 'TCCCilindro.cpp:171 cylinder number');
        w.v(vtOf.get(k), T + ':1460 valve type index 1-based = valve type ' + vtOf.get(k));
      } else if (t === 'branch') {
        w.v(12, T + ':1376 BC type 12 = branch TCCRamificacion, takes every pipe end with this number, reads no data TCCRamificacion.cpp:94-147');
      } else if (t === 'closed') {
        w.v(3, T + ':1294 BC type 3 = closed end TCCExtremoCerrado, reads no data');
      } else if (t === 'loss') {
        w.v(10, T + ':1356 BC type 10 = quadratic pressure loss TCCPerdidadePresion between two pipe ends');
        w.v(+b.K, 'TCCPerdidadePresion.cpp:134 loss coefficient K on the velocity head of the pipe the flow leaves');
      } else if (t === 'step') {
        w.v(6, T + ':1314 BC type 6 = pipe-to-pipe connection TCCUnionEntreTubos');
        w.row([0.0, 0.0], 'TCCUnionEntreTubos.cpp:200 wall thickness m, conductivity W/mK; wall conduction only, unused with constant wall T');
      } else if (t === 'reservoir') {
        w.v(1, T + ':1272 BC type 1 = open end into a reservoir at fixed pressure and temperature');
        w.row([b.p_bar, b.T_C, p.end_loss], 'TCCDescargaExtremoAbierto.cpp:144 reservoir pressure bar, temperature degC, inflow velocity coefficient');
        w.v(0, 'TCCDescargaExtremoAbierto.cpp:147 0 = this reservoir is not the engine exhaust');
        w.row(b.comp.slice(), 'TCCDescargaExtremoAbierto.cpp:154 reservoir mass fractions burnt, fuel, air');
      } else if (t === 'plenum') {
        w.v(11, T + ':1366 BC type 11 = pipe-to-plenum connection TCCDeposito');
        w.v(0, 'TCCDeposito.cpp:204 WAMer id, ignored');
        w.v(Math.trunc(b.plenum), 'TCCDeposito.cpp:206 plenum number');
        w.v(cdVtype, T + ':1460 valve type index 1-based = valve type ' + cdVtype + ', fixed CD');
      } else throw new Error('unknown BC type ' + t);
    }

    w.section('TURBOCHARGERS, SENSORS, CONTROLLERS');
    w.v(0, T + ':1669 turbocharger axes');
    w.v(0, T + ':1699 sensors');
    w.v(0, T + ':1720 controllers');

    const O = 'TOutputResults.cpp', cell = p.cell_mm / 1000.0;
    const valveBcs = order.filter(k => B(k).type === 'ivalve' || B(k).type === 'evalve');
    const cylSfx = k => ncyl === 1 ? '' : ', cylinder ' + B(k).cyl;

    w.section('AVERAGE RESULTS  TOutputResults::ReadAverageResults');
    const insCycles = Math.trunc(p.ins_cycles);
    if (insCycles < 1) throw new Error('ins_cycles must be 1 or more');
    if (insCycles === 1) w.v(0, O + ':37 instantaneous results 0 = last cycle only');
    else w.v(2, O + ':37 instantaneous results 2 = all cycles concatenated in one INS file; readIns keeps the last ' + insCycles);
    w.v(pipes.length, O + ':63 pipes with average results');
    w.v(0, O + ':64 WAMer number, ignored');
    pipes.forEach((pp, i) => {
      const L = pipeLen(pp), h = Math.min(cell, L / 2.0);
      const apts = Math.trunc(p.avg_points) === 1 ? [L / 2.0] : [h, L / 2.0, L - h];
      w.v(i + 1, O + ':66 pipe ' + (i + 1));
      w.v(apts.length, U + ':2465 points');
      apts.forEach((x, j) => w.row([x, 3, 0, 1, 3], U + ':2508 distance m, n vars; ' + (i === 0 && j === 0 ? '2511 ' : '') + 'vars 0 T, 1 p, 3 mass flow'));
    });
    w.v(ncyl, O + ':78 cylinders with average results');
    const cylAvg = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 20, 22, 23, 24, 25, 27];
    for (let c = 0; c < ncyl; c++) {
      w.v(c + 1, O + ':80 cylinder ' + (c + 1));
      w.v(cylAvg.length, 'TCilindro.cpp:738 number of variables');
      w.row(cylAvg, 'TCilindro.cpp:740 0 Wnet 1 NMEP 2 Wpump 3 PMEP 4 Qcomb 5-7 Q liner head piston 8 IMEP 9 trapped 20 AFR 22 intake 23 exhaust 24 short-circuit 25 mean T 27 VE');
    }
    w.v(1, O + ':92 engine average results on');
    const engAvg = [];
    for (let i = 0; i < 23; i++) engAvg.push(i);
    engAvg.push(25, 26);
    w.v(engAvg.length, E + ':648 number of variables');
    w.row(engAvg, E + ':650 0-22 torque, work, MEPs, power, masses, rpm, VE, efficiencies, BSFC; 25 F/A; 26 AFR', 25);
    w.v(plenums.length, O + ':105 plenums');
    for (let j = 0; j < plenums.length; j++) {
      w.v(j + 1, O + ':107 plenum ' + (j + 1));
      w.row([2, 0, 1], 'TDeposito.cpp:791 n vars, 0 pressure, 1 temperature');
    }
    w.v(0, O + ':119 turbocharger axes');
    w.v(0, O + ':133 compressors');
    w.v(0, O + ':147 turbines');
    w.v(valveBcs.length, O + ':161 valves');
    for (const k of valveBcs) {
      w.v(num.get(k), O + ':163 BC' + num.get(k) + ' ' + BC_DESC[B(k).type] + cylSfx(k));
      w.row([2, 0, 1], 'TTipoValvula.cpp:239 n vars, 0 CD in, 1 CD out');
    }
    w.v(0, O + ':184 root compressors');
    w.v(0, O + ':199 venturis');
    w.v(0, O + ':214 plenum-to-plenum connections');
    w.v(0, O + ':249 sensors');
    w.v(0, O + ':263 controllers');

    w.section('INSTANTANEOUS RESULTS  TOutputResults::ReadInstantaneousResults');
    w.v(ncyl, O + ':540 cylinders');
    const cylIns = [0, 1, 4, 5, 10, 11, 13, 25];
    for (let c = 0; c < ncyl; c++) {
      w.v(c + 1, O + ':542 cylinder ' + (c + 1));
      w.v(cylIns.length, 'TCilindro.cpp:1342 number of variables');
      w.row(cylIns, 'TCilindro.cpp:1344 0 p 1 T 4 exhaust flow 5 intake flow 10 mass 11 volume 13 burned fraction 25 torque');
    }
    w.v(plenums.length, O + ':554 plenums');
    for (let j = 0; j < plenums.length; j++) {
      w.v(j + 1, O + ':556 plenum ' + (j + 1));
      w.row([3, 0, 1, 3], 'TDeposito.cpp:746 n vars, 0 pressure 1 temperature 3 mass');
    }
    const insOutlet = Math.trunc(p.ins_outlet) === 1;
    const insPts = [];
    pipes.forEach((pp, i) => {
      const L = pipeLen(pp), h = Math.min(cell, L / 2.0), pts = [];
      const tl = B(pp.left).type, tr = B(pp.right).type;
      if (tl === 'ivalve' || tl === 'evalve') pts.push([h, 'near the valve', [0, 1, 2]]);
      else if (tl === 'branch') pts.push([h, 'after the junction', [0, 1, 2]]);
      if (tr === 'ivalve' || tr === 'evalve') pts.push([L - h, 'near the valve', [0, 1, 2]]);
      // past the end on purpose: TTubo.cpp:3155-3157 floor(x/dx) >= FNin-1 selects the last node (the open-end cell)
      if (insOutlet && tl === 'plenum') pts.push([0.0, '= first node, plenum outlet port', [0, 1, 2, 3]]);      // x = 0 -> node 0 (TTubo.cpp:3212)
      if (insOutlet && tr === 'plenum') pts.push([L + cell / 2.0, '= past the end, clamped to the last node, plenum inlet port', [0, 1, 2, 3]]);
      if (insOutlet && tr === 'open' && Math.trunc(pp.ht) === 2) pts.push([L + cell / 2.0, '= past the end, clamped to the last node at the open end', [0, 1, 2, 3]]);
      if (pts.length) insPts.push([i, pts]);
    });
    w.v(insPts.length, O + ':568 pipes');
    w.v(0, O + ':571 WAMer number, ignored');
    let first = true;
    for (const [i, pts] of insPts) {
      w.v(i + 1, O + ':573 pipe ' + (i + 1));
      w.v(pts.length, U + ':2700 points');
      for (const [x, what, vs] of pts) {
        w.row([x, vs.length].concat(vs), U + ':2737 distance m ' + what + ', n vars; ' + (first ? '2740 ' : '') + 'vars 0 p 1 u 2 T' + (vs.indexOf(3) >= 0 ? ' 3 mass flow' : ''));
        first = false;
      }
    }
    w.v(0, O + ':585 venturis');
    w.v(valveBcs.length, O + ':599 valves');
    for (const k of valveBcs) {
      w.v(num.get(k), O + ':601 BC' + num.get(k) + ' ' + BC_DESC[B(k).type] + cylSfx(k));
      if (B(k).type === 'ivalve') w.row([1, 0], 'TTipoValvula.cpp:134 n vars, 0 CD in');
      else w.row([1, 1], 'TTipoValvula.cpp:134 n vars, 1 CD out');
    }
    w.v(0, O + ':621 turbocharger axes');
    w.v(0, O + ':634 compressors');
    w.v(0, O + ':647 turbines');
    w.v(0, O + ':660 root compressors');
    w.v(0, O + ':674 plenum-to-plenum connections');
    w.v(0, O + ':695 waste-gates');
    w.v(0, O + ':721 reed valves');
    w.v(0, O + ':764 sensors');
    w.v(0, O + ':779 controllers');

    w.section('SPACE-TIME RESULTS  TOutputResults::ReadSpaceTimeResults');
    w.v(0, O + ':808 number of space-time quantities, 0 = none');

    w.section('TAIL');
    w.comment('compressor map data would follow here; there is no compressor BC, so nothing is read TOpenWAM.cpp:521-525');
    w.v(0, T + ':531 external DLL 0 = none');
    return w.text();
  }

  // ------------------------------------------------------------------ v1 layout
  function legacyModel(p) {
    const pipes = [
      { role: 'intake', left: 'in_open', right: 'ivalve', D0: p.intake_d_mm / 1000.0, secs: [[p.intake_len_mm / 1000.0, p.intake_d_mm / 1000.0]],
        Tw_C: p.intake_Twall_C, Tg_C: p.T_amb_C, comp: [0.0, 0.0, 1.0], ht: 1 },
      { role: 'exhaust', left: 'evalve', right: 'ex_open', D0: p.exhaust_d_mm / 1000.0, secs: [[p.exhaust_len_mm / 1000.0, p.exhaust_d_mm / 1000.0]],
        Tw_C: p.exhaust_Twall_C, Tg_C: p.exhaust_Tgas0_C, comp: [1.0, 0.0, 0.0], ht: 2 },
    ];
    const bcs = new Map([
      ['in_open', { type: 'open', note: 'intake pipe inlet, open end to atmosphere' }],
      ['ivalve', { type: 'ivalve', cyl: 1, note: 'intake valve' }],
      ['evalve', { type: 'evalve', cyl: 1, note: 'exhaust valve' }],
      ['ex_open', { type: 'open', note: 'exhaust pipe outlet, open end to atmosphere' }],
    ]);
    return { p, phases: [0.0], pipes, bcs };
  }
  function makeWamLegacy(over) {
    const p = Object.assign({}, DEFAULTS, over || {});
    for (const k in EXTRA_DEFAULTS) if (!(k in p)) p[k] = EXTRA_DEFAULTS[k];
    return writeModel(legacyModel(p));
  }

  // ------------------------------------------------------------------ simSpec -> model
  function splitRuns(segs) {
    const runs = [];
    let cur = null;
    for (const sg of segs) {
      const L = +sg.L, d0 = +sg.d0, d1 = +sg.d1;
      if (!(L > 1e-6)) continue;
      if (!(d0 > 0.0 && d1 > 0.0)) throw new Error('segment diameters must be positive');
      if (cur !== null && Math.abs(cur.d1 - d0) < 1e-6) { cur.secs.push([L, d1]); cur.d1 = d1; }
      else { cur = { D0: d0, secs: [[L, d1]], d1 }; runs.push(cur); }
    }
    if (!runs.length) throw new Error('a line has no segment longer than 1 micron');
    return runs;
  }
  // make_wam.py round01 / seat_events: cam events at a check lift (cam.checkLift_mm) -> seat-to-seat sin² events
  function round01(x) { return Math.floor(x * 10.0 + 0.5) / 10.0; }
  // make_wam.py split_segs_at: segs cut at x from their start, a cone cut with its diameter interpolated
  function splitSegsAt(segs, x) {
    const before = [], after = []; let a = 0.0;
    for (const sg of segs) {
      const L = Number(sg.L), d0 = Number(sg.d0), d1 = Number(sg.d1), b = a + L;
      if (b <= x) before.push(Object.assign({}, sg));
      else if (a >= x) after.push(Object.assign({}, sg));
      else {
        const dx = d0 + (d1 - d0) * (x - a) / L;
        before.push(Object.assign({}, sg, { L: x - a, d0: d0, d1: dx }));
        after.push(Object.assign({}, sg, { L: b - x, d0: dx, d1: d1 }));
      }
      a = b;
    }
    return [before, after];
  }
  // make_wam.py profile_table / profile_events (v9): a measured lift profile instead of the sin^2 curve
  function profileTable(prof, dur, step) {
    const n = pyRoundInt(dur / step);
    if (Math.abs(n * step - dur) > 1e-9) throw new Error('valve duration ' + pctG(dur) + ' is not a multiple of lift_step_deg ' + pctG(step));
    const xs = prof.deg, ys = prof.mm, out = [];
    for (let i = 0; i <= n; i++) {
      const a = prof.a0 + i * step;
      let v = 0.0;
      if (xs[0] <= a && a <= xs[xs.length - 1]) {
        let k = 0;
        while (k < xs.length - 2 && xs[k + 1] < a) k += 1;
        const t = (a - xs[k]) / (xs[k + 1] - xs[k]);
        v = ys[k] + t * (ys[k + 1] - ys[k]);
      }
      out.push(pyRound(Math.max(0.0, v), 6));
    }
    return out;
  }
  function profileEvents(cam, pr, kind) {
    const xs = pr.deg.map(Number), ys = pr.mm.map(Number);
    if (xs.length !== ys.length || xs.length < 3) throw new Error('camProfile.' + kind + ': deg and mm need the same number of points, at least 3');
    for (let i = 0; i < xs.length - 1; i++) if (!(xs[i + 1] > xs[i])) throw new Error('camProfile.' + kind + ': deg must increase');
    if (ys.some(y => y < 0) || !(Math.max(...ys) > 0)) throw new Error('camProfile.' + kind + ': lifts must be zero or more, with some lift');
    const nz = ys.map((y, i) => y > 0 ? i : -1).filter(i => i >= 0);
    const i0 = Math.max(0, nz[0] - 1), i1 = Math.min(xs.length - 1, nz[nz.length - 1] + 1);
    const a0 = Math.floor(xs[i0]), a1 = Math.ceil(xs[i1]);
    let cl, ev;
    if (kind === 'in') {
      cl = pr.cl !== undefined && pr.cl !== null ? Number(pr.cl) : (180.0 + Number(cam.ivc) - Number(cam.ivo)) / 2.0;
      ev = [round01(-(cl + a0)), round01(cl + a1 - 180.0)];
    } else {
      cl = pr.cl !== undefined && pr.cl !== null ? Number(pr.cl) : (180.0 + Number(cam.evo) - Number(cam.evc)) / 2.0;
      ev = [round01(cl - a0 - 180.0), round01(a1 - cl)];
    }
    return [ev, { a0: a0, deg: xs, mm: ys, cl, max_mm: Math.max(...ys) }];
  }
  function seatEvents(cam, liftInMm, liftExMm) {
    const h = +(cam.checkLift_mm || 0);
    const ev = { ivo: +cam.ivo, ivc: +cam.ivc, evo: +cam.evo, evc: +cam.evc };
    if (!(h > 0)) return ev;
    const out = {};
    for (const [o, c, L] of [['ivo', 'ivc', liftInMm], ['evo', 'evc', liftExMm]]) {
      if (!(L > h)) throw new Error('valve lift ' + L + ' mm must exceed the check lift ' + h + ' mm');
      const d = ev[o] + 180.0 + ev[c];
      const k = 2.0 / Math.PI * Math.asin(Math.sqrt(h / L));
      const a0 = d * k / (2.0 * (1.0 - k));
      out[o] = round01(ev[o] + a0); out[c] = round01(ev[c] + a0);
    }
    return out;
  }
  // make_wam.py comb_eff_for: OpenWAM's combustion efficiency, the share of the fuel the air can burn x 0.98 (OpenWAM
  // takes the wall heat loss itself, so the wave simulation's eta is not used), or spec.e.combEff when given
  const COMB_COMPLETE = 0.98;
  function combEffFor(e) {
    if (e.combEff !== undefined && e.combEff !== null) return Number(e.combEff);
    const phi = (1.0 / Number(e.afr)) / FS_GASOLINE_SIMPLE;
    return COMB_COMPLETE * Math.min(1.0, 1.0 / phi);
  }
  function liftStepFor(durs) {
    for (const st of [1.0, 0.5, 0.25, 0.2, 0.1])
      if (durs.every(dd => Math.abs(pyRoundInt(dd / st) * st - dd) <= 1e-9)) return st;
    throw new Error('valve durations ' + durs + ' are not multiples of 0.1 deg');
  }

  function modelFromSpec(spec, run) {
    run = Object.assign({}, run || {});
    for (const k in run) if (!(k in DEFAULTS) && !(k in EXTRA_DEFAULTS)) throw new Error('unknown run setting ' + k);
    const e = spec.e, cam = e.cam, burn = e.burn;
    const p = Object.assign({}, DEFAULTS, EXTRA_DEFAULTS);
    const twc = (e.Twall ? e.Twall : CALC_TWALL_CYL_K) - K0;
    const seat = seatEvents(cam, e.liftIn * 1000.0, e.liftEx * 1000.0);
    // a measured lift profile (v9) replaces the sin^2 curve of its valve: its events and peak lift come from it
    const profs = {};
    for (const [kind, o, c] of [['in', 'ivo', 'ivc'], ['ex', 'evo', 'evc']]) {
      const pr = (e.camProfile || {})[kind];
      if (pr) { const [ev, q] = profileEvents(cam, pr, kind); seat[o] = ev[0]; seat[c] = ev[1]; profs[kind] = q; }
    }
    Object.assign(p, {
      name: 'simspec', p_amb_bar: CALC_P_ATM_BAR, T_amb_C: CALC_T_ATM_C,
      bore_mm: e.bore * 1000.0, stroke_mm: e.stroke * 1000.0, rod_mm: e.rod * 1000.0, cr: +e.cr,
      n_int: Math.trunc(e.nIn), d_int_mm: e.dIn * 1000.0, lift_int_mm: e.liftIn * 1000.0,
      n_exh: Math.trunc(e.nEx), d_exh_mm: e.dEx * 1000.0, lift_exh_mm: e.liftEx * 1000.0,
      ivo_btdc: seat.ivo, ivc_abdc: seat.ivc, evo_bbdc: seat.evo, evc_atdc: seat.evc,
      valve_cd: +e.cd, curtain_cap: CALC_CURTAIN_CAP,
      burn_start_btdc: +burn.start, burn_dur_deg: +burn.dur, afr: +e.afr, comb_eff: combEffFor(e),
      T_piston_C: twc, T_head_C: twc, T_liner_C: twc, exhaust_Tgas0_C: CALC_T0_EXHAUST_K - K0,
    });
    if (profs.in) { p.lift_int_mm = profs.in.max_mm; p.lift_profile_int = profs.in; }
    if (profs.ex) { p.lift_exh_mm = profs.ex.max_mm; p.lift_profile_exh = profs.ex; }
    p.lift_step_deg = liftStepFor([180.0 + p.ivo_btdc + p.ivc_abdc, 180.0 + p.evo_bbdc + p.evc_atdc]);
    Object.assign(p, run);

    const opt = spec.opt || {};
    // Every cylinder's firing angle is shifted by START_SHIFT_DEG (45 by default). A steady-state cycle does not
    // care where the clock starts, but OpenWAM's initial state does: an LS3 bank at phases 0/180/450/630 starts
    // with one cylinder (phase 630) in a state that went to NaN at 3600 rpm ("no mass in the cylinder") and
    // crashed at 6400 (StudyInflowOutflowMass), with or without a finer mesh; shifting all phases by 10, 20, 45
    // or 90 deg ran clean at both speeds (45 deg gave the fewest sonic-flow warnings). The same shift is
    // applied to every cylinder so the firing intervals are unchanged.
    const shift = opt.start_shift_deg === undefined ? START_SHIFT_DEG : Number(opt.start_shift_deg);
    const phases = (opt.phases && opt.phases.length ? opt.phases : [0.0]).map(x => ((Number(x) + shift) % 720 + 720) % 720);
    const ncyl = phases.length, ex = spec.exhaust;
    const chambers = (ex.chambers || []).slice().sort((u, v) => Number(u.x) - Number(v.x));
    if (chambers.length && ex.tail && ex.tail.length) throw new Error('side-branch chambers (exhaust.chambers) with an exhaust tail are not written; give one or the other');
    let cols;
    if (opt.collectors && opt.collectors.length) cols = opt.collectors;
    else if (opt.collector) cols = [Object.assign({}, opt.collector, { cyls: phases.map((_, i) => i) })];
    else cols = [];

    const stepT = { union: 'step', branch: 'branch' }[p.step_bc];
    if (!stepT) throw new Error('step_bc must be union or branch');
    const pipes = [], bcs = new Map(), plenums = [];
    const twC = line => (line.Tw ? line.Tw : CALC_TATM_K) - K0;
    const lossAt = new Map();   // v8: junction key -> [K, what]: each line into it ends in a pressure loss
    // a line of pipes; into a junction with a loss coefficient, its last 3 cells go after a quadratic pressure-loss BC
    function addLine(segs, left, right, role, Twc, Tgc, comp, ht) {
      if (lossAt.has(right)) {
        const [K, what] = lossAt.get(right);
        let total = 0.0;
        for (const sg of segs) total += +sg.L;
        const Lk = 3.0 * p.cell_mm / 1000.0;
        if (total <= 2.0 * Lk) throw new Error(role + ' is ' + pctG(total * 1000.0) + ' mm, too short to end in the ' + what + ' loss (needs over ' + pctG(2.0 * Lk * 1000.0) + ' mm)');
        const sp = splitSegsAt(segs, total - Lk), lk = role + '/loss';
        bcs.set(lk, { type: 'loss', K, note: role + ', ' + what + ' loss K ' + pctG(K) });
        addLineRaw(sp[0], left, lk, role, Twc, Tgc, comp, ht);
        addLineRaw(sp[1], lk, right, role + ' into the ' + what, Twc, Tgc, comp, ht);
        return;
      }
      addLineRaw(segs, left, right, role, Twc, Tgc, comp, ht);
    }
    function addLineRaw(segs, left, right, role, Twc, Tgc, comp, ht) {
      const runs = splitRuns(segs), keys = [left];
      for (let j = 1; j < runs.length; j++) {
        const sk = role + '/step' + j;
        bcs.set(sk, { type: stepT, note: role + ' diameter step ' + pctG(runs[j - 1].d1 * 1000.0) + ' to ' + pctG(runs[j].D0 * 1000.0) + ' mm' });
        keys.push(sk);
      }
      keys.push(right);
      runs.forEach((rn, j) => {
        const nm = runs.length === 1 ? role : role + ' part ' + (j + 1);
        pipes.push({ role: nm, left: keys[j], right: keys[j + 1], D0: rn.D0, secs: rn.secs.map(s => s.slice()), Tw_C: Twc, Tg_C: Tgc, comp, ht });
      });
    }
    const has = (o, k) => o[k] !== undefined && o[k] !== null;
    // collector.tail / exhaust.tail (mm, litres, degC) -> [['seg', {L,d0,d1} m, Tw_C] | ['plenum', V_m3, T_C]]
    function tailItems(tail, TwcDefault, T0Default) {
      const items = [];
      tail.forEach((el, n) => {
        if (has(el, 'outlets')) {
          // a muffler box with several exits: only as the last element, right after a plenum (make_wam.py tail_items)
          if (n !== tail.length - 1 || !items.length || items[items.length - 1][0] !== 'plenum') throw new Error('tail element ' + (n + 1) + ": 'outlets' must be the last element, right after a plenum (V_litres)");
          const outs = el.outlets.map((ol, k) => {
            if (!ol || !ol.length) throw new Error('tail element ' + (n + 1) + ': outlet ' + (k + 1) + ' has no pipe segments');
            return ol.map((sg, m) => {
              for (const kk of ['L_mm', 'd0_mm', 'd1_mm']) if (!has(sg, kk)) throw new Error('tail element ' + (n + 1) + ' outlet ' + (k + 1) + ' segment ' + (m + 1) + ' needs ' + kk);
              return ['seg', { L: Number(sg.L_mm) / 1000.0, d0: Number(sg.d0_mm) / 1000.0, d1: Number(sg.d1_mm) / 1000.0 }, has(sg, 'Tw_C') ? Number(sg.Tw_C) : TwcDefault];
            });
          });
          if (!outs.length) throw new Error('tail element ' + (n + 1) + ": 'outlets' lists no outlet");
          items.push(['outlets', outs]);
          return;
        }
        if (has(el, 'parallel')) {
          // v8 (make_wam.py tail_items): two or more pipes side by side between two junctions
          const paths = el.parallel.map((pa, k) => {
            if (!pa || !pa.length) throw new Error('tail element ' + (n + 1) + ': parallel path ' + (k + 1) + ' has no pipe segments');
            return pa.map((sg, m) => {
              for (const kk of ['L_mm', 'd0_mm', 'd1_mm']) if (!has(sg, kk)) throw new Error('tail element ' + (n + 1) + ' parallel path ' + (k + 1) + ' segment ' + (m + 1) + ' needs ' + kk);
              return ['seg', { L: Number(sg.L_mm) / 1000.0, d0: Number(sg.d0_mm) / 1000.0, d1: Number(sg.d1_mm) / 1000.0 }, has(sg, 'Tw_C') ? Number(sg.Tw_C) : TwcDefault];
            });
          });
          if (paths.length < 2) throw new Error('tail element ' + (n + 1) + ": 'parallel' needs at least two paths");
          if (!items.length || items[items.length - 1][0] !== 'seg') throw new Error('tail element ' + (n + 1) + ': parallel paths must come after a pipe segment');
          items.push(['parallel', paths]);
          return;
        }
        if (has(el, 'side')) {
          // v7 side branch (make_wam.py tail_items): a quarter-wave tube to a closed end, or a Helmholtz neck and volume
          const sd = el.side, tw = has(sd, 'Tw_C') ? Number(sd.Tw_C) : TwcDefault;
          if (sd.type === 'quarter') {
            const L = Number(sd.L_mm || 0.0) / 1000.0, d = Number(sd.d_mm || 0.0) / 1000.0;
            if (!(L > 0.0 && d > 0.0)) throw new Error('tail element ' + (n + 1) + ': a quarter-wave side branch needs L_mm and d_mm');
            items.push(['side', { type: 'quarter', L, d }, tw]);
          } else if (sd.type === 'helmholtz') {
            const V = Number(sd.V_litres || 0.0) / 1000.0, L = Number(sd.neck_L_mm || 0.0) / 1000.0, d = Number(sd.neck_d_mm || 0.0) / 1000.0;
            if (!(V > 0.0 && L > 0.0 && d > 0.0)) throw new Error('tail element ' + (n + 1) + ': a Helmholtz side branch needs V_litres, neck_L_mm and neck_d_mm');
            const lk = has(sd, 'loss_K') ? Number(sd.loss_K) : 0.0;
            if (lk < 0.0) throw new Error('tail element ' + (n + 1) + ": a Helmholtz neck's loss_K must be zero or more");
            items.push(['side', { type: 'helmholtz', V, L, d, K: lk, T0: has(sd, 'T0_C') ? Number(sd.T0_C) : T0Default }, tw]);
          } else throw new Error('tail element ' + (n + 1) + ': side.type must be quarter or helmholtz');
          if (items.length < 2 || items[items.length - 2][0] !== 'seg') throw new Error('tail element ' + (n + 1) + ': a side branch must come after a pipe segment');
          return;
        }
        if (has(el, 'loss_K') && !has(el, 'L_mm') && !has(el, 'V_litres')) {
          // v11 (make_wam.py tail_items): a quadratic total-pressure loss between two pipe segments
          const K = Number(el.loss_K);
          if (!(K > 0.0)) throw new Error('tail element ' + (n + 1) + ': loss_K must be positive');
          if (!items.length || items[items.length - 1][0] !== 'seg') throw new Error('tail element ' + (n + 1) + ': a loss must come after a pipe segment');
          items.push(['loss', K]);
          return;
        }
        if (has(el, 'V_litres')) {
          const V = Number(el.V_litres);
          if (!(V > 0.0)) throw new Error('tail element ' + (n + 1) + ': V_litres must be positive');
          // adiabatic plenum: Tw_C is ignored, T0_C = initial gas temperature, default the exhaust pipes' initial gas T
          items.push(['plenum', V / 1000.0, has(el, 'T0_C') ? Number(el.T0_C) : T0Default]);
        } else {
          for (const k of ['L_mm', 'd0_mm', 'd1_mm']) if (!has(el, k)) throw new Error('tail element ' + (n + 1) + ' needs ' + k + ' (or V_litres for a plenum)');
          items.push(['seg', { L: Number(el.L_mm) / 1000.0, d0: Number(el.d0_mm) / 1000.0, d1: Number(el.d1_mm) / 1000.0 }, has(el, 'Tw_C') ? Number(el.Tw_C) : TwcDefault]);
        }
      });
      for (let n = 0; n < items.length - 1; n++) {
        if (items[n][0] === 'side' && items[n + 1][0] !== 'seg') throw new Error('a side branch must be followed by a pipe segment');
        if (items[n][0] === 'parallel' && items[n + 1][0] !== 'seg') throw new Error('parallel paths must be followed by a pipe segment');
        if (items[n][0] === 'loss' && items[n + 1][0] !== 'seg') throw new Error('a loss must be followed by a pipe segment');
      }
      if (!items.length || (items[items.length - 1][0] !== 'seg' && items[items.length - 1][0] !== 'outlets')) throw new Error('a tail must end with a pipe segment at the open end, not a plenum, a side branch, parallel paths or a loss');
      if (items[0][0] !== 'seg') throw new Error('a tail must start with a pipe segment (the collector or primary cannot open into a plenum directly)');
      return items;
    }
    // a line of pipe segments (each with its own Tw_C) and plenums from BC left to BC right (make_wam.py add_chain)
    function addChain(items, left, right, role, Tgc, comp, ht) {
      const groups = [];
      let cur = null;
      for (const it of items) {
        if (it[0] === 'plenum' || it[0] === 'outlets' || it[0] === 'side' || it[0] === 'parallel' || it[0] === 'loss') { groups.push(it); cur = null; }
        else { if (cur === null) { cur = []; groups.push(cur); } cur.push([it[1], it[2]]); }
      }
      let npl = 0, npipe = 0, nside = 0, npar = 0, nloss = 0;
      const lossKey = new Map();                            // loss group index -> its BC key
      const sideKey = new Map(), sideNum = new Map();      // side-branch group index -> its junction BC key, its number
      const parKeys = new Map();                            // parallel group index -> [junction in, junction out]
      const addGroup = (g, lk, rk) => {
        const runs = [];
        for (const [sg, tw] of g) {
          if (runs.length && Math.abs(runs[runs.length - 1][1] - tw) < 1e-9) runs[runs.length - 1][0].push(sg);
          else runs.push([[sg], tw]);
        }
        const keys = [lk];
        for (let j = 1; j < runs.length; j++) {
          const sk = role + '/tw' + (npipe + j);
          const prev = runs[j - 1][0], nxt = runs[j][0];
          bcs.set(sk, { type: stepT, note: role + ' section change, wall ' + pctG(runs[j - 1][1]) + ' to ' + pctG(runs[j][1]) + ' degC, diameter ' + pctG(prev[prev.length - 1].d1 * 1000.0) + ' to ' + pctG(nxt[0].d0 * 1000.0) + ' mm' });
          keys.push(sk);
        }
        keys.push(rk);
        runs.forEach(([segs, tw], j) => {
          npipe += 1;
          addLine(segs, keys[j], keys[j + 1], role + ' section ' + npipe, tw, Tgc, comp, ht);
        });
      };
      // v7 (make_wam.py add_side): the side branch at group gi, off the junction before the next group
      const addSide = (gi, sd, tw) => {
        const bk = sideKey.get(gi), nn = sideNum.get(gi), Lmin = 3.0 * p.cell_mm / 1000.0;
        if (sd.type === 'quarter') {
          if (sd.L < Lmin) throw new Error(role + ': a quarter-wave branch shorter than 3 cells (' + pctG(Lmin * 1000.0) + ' mm) cannot be written');
          const ck = bk + '/closed';
          bcs.set(ck, { type: 'closed', note: role + ' side branch ' + nn + ' closed end' });
          addLine([{ L: sd.L, d0: sd.d, d1: sd.d }], bk, ck, role + ' side branch ' + nn + ', quarter-wave tube', tw, Tgc, comp, ht);
        } else {
          plenums.push({ V_m3: sd.V, T_C: sd.T0, p_bar: p.p_amb_bar, comp: comp.slice(), note: role + ' side branch ' + nn + ', Helmholtz ' + pctG(sd.V * 1000.0) + ' litres' });
          const pk = bk + '/port';
          bcs.set(pk, { type: 'plenum', plenum: plenums.length, note: role + ' side branch ' + nn + ' neck into the volume' });
          let L = sd.L, A = Math.PI / 4.0 * sd.d * sd.d;
          const LminN = sd.K ? 2.0 * Lmin : Lmin;          // v11: a neck with a loss is two halves of 3 cells or more
          if (L < LminN) { A = A * LminN / L; L = LminN; }
          const dn = Math.sqrt(4.0 * A / Math.PI);
          if (sd.K) {
            const mk = bk + '/neckloss';
            bcs.set(mk, { type: 'loss', K: sd.K, note: role + ' side branch ' + nn + ', loss in the Helmholtz neck K ' + pctG(sd.K) });
            addLine([{ L: L / 2.0, d0: dn, d1: dn }], bk, mk, role + ' side branch ' + nn + ', Helmholtz neck part 1', tw, Tgc, comp, ht);
            addLine([{ L: L / 2.0, d0: dn, d1: dn }], mk, pk, role + ' side branch ' + nn + ', Helmholtz neck part 2', tw, Tgc, comp, ht);
            return;
          }
          addLine([{ L, d0: dn, d1: dn }], bk, pk, role + ' side branch ' + nn + ', Helmholtz neck', tw, Tgc, comp, ht);
        }
      };
      groups.forEach((g, gi) => {
        if (g[0] === 'side' || g[0] === 'parallel' || g[0] === 'loss') return;
        if (g[0] === 'plenum') {
          npl += 1;
          plenums.push({ V_m3: g[1], T_C: g[2], p_bar: p.p_amb_bar, comp: comp.slice(), note: role + ' muffler ' + npl + ' as a ' + pctG(g[1] * 1000.0) + ' litre expansion volume' });
          return;
        }
        if (g[0] === 'outlets') {         // every exit of the last muffler to its own open end
          g[1].forEach((osegs, k) => {
            const lk = role + '/muffler' + npl + '/out' + (k === 0 ? '' : String(k + 1));
            bcs.set(lk, { type: 'plenum', plenum: plenums.length, note: role + ' muffler ' + npl + ' outlet port' + (k === 0 ? '' : ' ' + (k + 1)) });
            let rk = right;
            if (k > 0) { rk = right + '/' + (k + 1); bcs.set(rk, Object.assign({}, bcs.get(right), { note: bcs.get(right).note + ', outlet ' + (k + 1) })); }
            addGroup(osegs.map(sg => [sg[1], sg[2]]), lk, rk);
          });
          return;
        }
        let lk, rk;
        const isSide = q => q !== undefined && q[0] === 'side';
        const isPar = q => q !== undefined && q[0] === 'parallel';
        const isLoss = q => q !== undefined && q[0] === 'loss';
        if (gi === 0) lk = left;
        else if (isSide(groups[gi - 1])) lk = sideKey.get(gi - 1);
        else if (isPar(groups[gi - 1])) lk = parKeys.get(gi - 1)[1];
        else if (isLoss(groups[gi - 1])) lk = lossKey.get(gi - 1);
        else { lk = role + '/muffler' + npl + '/out'; bcs.set(lk, { type: 'plenum', plenum: plenums.length, note: role + ' muffler ' + npl + ' outlet port' }); }
        if (gi === groups.length - 1) rk = right;
        else if (isSide(groups[gi + 1])) {
          nside += 1; rk = role + '/side' + nside;
          sideKey.set(gi + 1, rk); sideNum.set(gi + 1, nside);
          bcs.set(rk, { type: 'branch', note: role + ' side branch ' + nside + ' junction' });
        } else if (isLoss(groups[gi + 1])) {
          nloss += 1; rk = role + '/loss' + nloss;
          lossKey.set(gi + 1, rk);
          bcs.set(rk, { type: 'loss', K: groups[gi + 1][1], note: role + ' loss ' + nloss + ', K ' + pctG(groups[gi + 1][1]) });
        } else if (isPar(groups[gi + 1])) {
          npar += 1; rk = role + '/par' + npar + '/in';
          const ok = role + '/par' + npar + '/out';
          parKeys.set(gi + 1, [rk, ok]);
          bcs.set(rk, { type: 'branch', note: role + ' parallel paths ' + npar + ', inlet junction' });
          bcs.set(ok, { type: 'branch', note: role + ' parallel paths ' + npar + ', outlet junction' });
        } else { rk = role + '/muffler' + (npl + 1) + '/in'; bcs.set(rk, { type: 'plenum', plenum: plenums.length + 1, note: role + ' muffler ' + (npl + 1) + ' inlet port' }); }
        addGroup(g, lk, rk);
        if (gi + 1 < groups.length && isSide(groups[gi + 1])) addSide(gi + 1, groups[gi + 1][1], groups[gi + 1][2]);
        if (gi + 1 < groups.length && isPar(groups[gi + 1])) {
          const [jin, jout] = parKeys.get(gi + 1);
          for (const pa of groups[gi + 1][1]) addGroup(pa.map(sg => [sg[1], sg[2]]), jin, jout);
        }
      });
    }

    const primEnd = new Map(), colPlan = [];
    cols.forEach((col, ci) => {
      const cyls = col.cyls.map(c => Math.trunc(c));
      for (const c of cyls) {
        if (!(0 <= c && c < ncyl)) throw new Error('collector ' + (ci + 1) + ' lists cylinder index ' + c + ' of ' + ncyl);
        if (primEnd.has(c)) throw new Error('cylinder index ' + c + ' is on two collectors');
      }
      const levels = [];
      (col.stages || []).forEach((st, si) => {
        const groups = st.groups.map(g => g.map(x => Math.trunc(x)));
        const flat = [].concat(...groups).sort((a, b) => a - b);
        const want = si === 0 ? cyls.slice().sort((a, b) => a - b) : levels[levels.length - 1].groups.map((_, i) => i);
        if (flat.length !== want.length || flat.some((x, i) => x !== want[i])) throw new Error('collector ' + (ci + 1) + ' stage ' + (si + 1) + ' groups must split ' + want);
        for (const g of groups) if (g.length < 2) throw new Error('a junction needs at least two inlets: ' + g);
        const sbg = st.segs_by_group === undefined ? null : st.segs_by_group;
        if (sbg !== null && sbg.length !== groups.length) throw new Error('collector ' + (ci + 1) + ' stage ' + (si + 1) + ': segs_by_group must have one entry per group (' + groups.length + ", None = the stage's segs), got " + sbg.length);
        levels.push({ groups, segs: st.segs, sbg, Tw: 'Tw' in st ? st.Tw : col.Tw });
      });
      const nfinal = levels.length ? levels[levels.length - 1].groups.length : cyls.length;
      if (nfinal < 2) throw new Error('collector ' + (ci + 1) + ': the last junction needs at least two inlets');
      const jkey = 'col' + (ci + 1) + '/J';
      bcs.set(jkey, { type: 'branch', note: 'collector ' + (ci + 1) + ' junction' });
      if (has(col, 'loss_K')) {
        if (!(+col.loss_K >= 0.0)) throw new Error('collector ' + (ci + 1) + ': loss_K must be zero or more');
        if (+col.loss_K > 0.0) lossAt.set(jkey, [+col.loss_K, 'collector ' + (ci + 1) + ' merge']);
      }
      levels.forEach((lv, si) => {
        lv.jkeys = [];
        lv.groups.forEach((grp, gi) => {
          const k = 'col' + (ci + 1) + '/L' + (si + 1) + '/J' + (gi + 1);
          bcs.set(k, { type: 'branch', note: 'collector ' + (ci + 1) + ' level ' + (si + 1) + ' junction ' + (gi + 1) });
          const lk_ = (col.stages || [])[si].loss_K;
          if (lk_ !== undefined && lk_ !== null && +lk_ > 0.0) lossAt.set(k, [+lk_, 'collector ' + (ci + 1) + ' level ' + (si + 1) + ' merge ' + (gi + 1)]);
          lv.jkeys.push(k);
          if (si === 0) for (const g of grp) primEnd.set(g, k);
        });
        lv.right = new Array(lv.groups.length).fill(null);
      });
      levels.forEach((lv, si) => {
        const nxt = si + 1 < levels.length ? levels[si + 1] : null;
        for (let gi = 0; gi < lv.groups.length; gi++)
          lv.right[gi] = nxt === null ? jkey : nxt.jkeys[nxt.groups.findIndex(grp => grp.indexOf(gi) >= 0)];
      });
      if (!levels.length) for (const c of cyls) primEnd.set(c, jkey);
      colPlan.push([ci, col, levels, jkey]);
    });

    const T0x = p.exhaust_Tgas0_C;
    const perCyl = ex.per_cyl;
    if (perCyl && perCyl.length && perCyl.length !== ncyl) throw new Error('exhaust.per_cyl must list one primary per cylinder (' + ncyl + ' entries, None = exhaust.segs), got ' + perCyl.length);
    const primSegs = c => (perCyl && perCyl.length && perCyl[c] !== null && perCyl[c] !== undefined ? perCyl[c] : ex.segs);     // v4 unequal-length headers
    // v7, make_wam.py add_primary: the primary split at every side-branch chamber, each junction feeding a neck to its plenum
    const addPrimary = (segs, ev, right, c) => {
      if (!chambers.length) { addLine(segs, ev, right, 'cylinder ' + (c + 1) + ' exhaust primary', twC(ex), T0x, [1.0, 0.0, 0.0], 2); return; }
      let total = 0.0; for (const sg of segs) total += Number(sg.L);
      let rest = segs.map(sg => Object.assign({}, sg)), left = ev, done = 0.0;
      chambers.forEach((ch, k) => {
        const x = Number(ch.x);
        if (!(0.0 < x && x < total)) throw new Error('chamber ' + (k + 1) + ' at ' + pctG(x) + ' m is not inside the primary (0 to ' + pctG(total) + ' m)');
        if (!(Number(ch.V) > 0.0 && Number(ch.A) > 0.0 && Number(ch.Le) > 0.0)) throw new Error('chamber ' + (k + 1) + ' needs a positive V, A and Le');
        const sp = splitSegsAt(rest, x - done), before = sp[0]; rest = sp[1];
        const jk = 'c' + (c + 1) + '/ch' + (k + 1);
        bcs.set(jk, { type: 'branch', note: 'cylinder ' + (c + 1) + ' chamber ' + (k + 1) + ' junction, ' + pctG(x * 1000.0) + ' mm from the valve' });
        addLine(before, left, jk, 'cylinder ' + (c + 1) + ' exhaust primary part ' + (k + 1), twC(ex), T0x, [1.0, 0.0, 0.0], 2);
        plenums.push({ V_m3: Number(ch.V), T_C: T0x, p_bar: p.p_amb_bar, comp: [1.0, 0.0, 0.0], note: 'cylinder ' + (c + 1) + ' chamber ' + (k + 1) + ', ' + pctG(Number(ch.V) * 1000.0) + ' litres' });
        const pk = 'c' + (c + 1) + '/ch' + (k + 1) + '/port';
        bcs.set(pk, { type: 'plenum', plenum: plenums.length, note: 'cylinder ' + (c + 1) + ' chamber ' + (k + 1) + ' neck into the chamber' });
        let Le = Number(ch.Le), Ae = 0.75 * Number(ch.A);
        const Lmin = 3.0 * p.cell_mm / 1000.0;
        if (Le < Lmin) { Ae = Ae * Lmin / Le; Le = Lmin; }
        const dn = Math.sqrt(4.0 * Ae / Math.PI);
        addLine([{ L: Le, d0: dn, d1: dn }], jk, pk, 'cylinder ' + (c + 1) + ' chamber ' + (k + 1) + ' neck', twC(ex), T0x, [1.0, 0.0, 0.0], 2);
        left = jk; done = x;
      });
      addLine(rest, left, right, 'cylinder ' + (c + 1) + ' exhaust primary part ' + (chambers.length + 1), twC(ex), T0x, [1.0, 0.0, 0.0], 2);
    };
    const ipl = spec.intake.plenum;
    let iplN = 0;
    if (ipl) {
      // v5: every runner starts at one intake plenum (a constant volume), fed by an inlet line from an open end
      if (spec.intake.reservoir) throw new Error('intake.plenum and intake.reservoir are alternatives: give one');
      if (!(Number(ipl.V_m3 || 0) > 0)) throw new Error('intake.plenum.V_m3 must be positive');
      if (!ipl.inlet || !ipl.inlet.length) throw new Error('intake.plenum.inlet needs at least one pipe segment (air filter to plenum)');
      plenums.push({ V_m3: Number(ipl.V_m3), T_C: p.T_amb_C, p_bar: p.p_amb_bar, comp: [0.0, 0.0, 1.0], note: 'intake plenum, ' + pctG(Number(ipl.V_m3) * 1000.0) + ' litres' });
      iplN = plenums.length;
    }
    for (let c = 0; c < ncyl; c++) {
      const ik = 'c' + (c + 1) + '/in/open', iv = 'c' + (c + 1) + '/iv', ev = 'c' + (c + 1) + '/ev';
      const rsv = spec.intake.reservoir;
      if (ipl) bcs.set(ik, { type: 'plenum', plenum: iplN, note: 'cylinder ' + (c + 1) + ' intake runner inlet, from the intake plenum' });
      else if (rsv) bcs.set(ik, { type: 'reservoir', p_bar: Number(rsv.p_bar), T_C: has(rsv, 'T_C') ? Number(rsv.T_C) : p.T_amb_C, comp: [0.0, 0.0, 1.0],
        note: 'cylinder ' + (c + 1) + ' intake runner inlet, reservoir at ' + pctG(Number(rsv.p_bar)) + ' bar (throttled plenum)' });
      else bcs.set(ik, { type: 'open', note: 'cylinder ' + (c + 1) + ' intake runner inlet, open end to atmosphere' });
      bcs.set(iv, { type: 'ivalve', cyl: c + 1, note: 'intake valve, cylinder ' + (c + 1) });
      bcs.set(ev, { type: 'evalve', cyl: c + 1, note: 'exhaust valve, cylinder ' + (c + 1) });
      addLine(spec.intake.segs, ik, iv, 'cylinder ' + (c + 1) + ' intake runner', twC(spec.intake), p.T_amb_C, [0.0, 0.0, 1.0], 1);
      const segItems = (segs, tw) => segs.map(s => ['seg', { L: s.L, d0: s.d0, d1: s.d1 }, tw]);
      if (primEnd.has(c)) {
        addPrimary(primSegs(c), ev, primEnd.get(c), c);
      } else {
        const right = 'c' + (c + 1) + '/ex/open';
        bcs.set(right, { type: 'open', note: 'cylinder ' + (c + 1) + ' exhaust outlet, open end to atmosphere' });
        if (ex.tail && ex.tail.length)
          addChain(segItems(primSegs(c), twC(ex)).concat(tailItems(ex.tail, twC(ex), T0x)), ev, right, 'cylinder ' + (c + 1) + ' exhaust line', T0x, [1.0, 0.0, 0.0], 2);
        else addPrimary(primSegs(c), ev, right, c);
      }
    }
    if (ipl) {
      bcs.set('in/open', { type: 'open', note: 'intake inlet, open end to atmosphere' });
      bcs.set('in/plenum', { type: 'plenum', plenum: iplN, note: 'intake inlet into the plenum' });
      addLine(ipl.inlet, 'in/open', 'in/plenum', 'intake inlet', twC(spec.intake), p.T_amb_C, [0.0, 0.0, 1.0], 1);
    }
    // v10 (make_wam.py): a crossover between two collectors' lines; 'x' = one junction both lines run into and both
    // outlet lines leave, 'h' = a junction on each line joined by a balance tube; tails[k] runs on to outlet k
    const xo = opt.crossover;
    const xoRight = new Map();
    let xc = [];
    if (xo) {
      xc = (xo.cols || []).map(c => Math.trunc(Number(c)));
      if (xc.length !== 2 || xc[0] === xc[1] || !xc.every(c => c >= 0 && c < cols.length)) throw new Error('crossover.cols must name two different collectors (0-based), got ' + JSON.stringify(xo.cols));
      if (xo.type !== 'x' && xo.type !== 'h') throw new Error("crossover.type must be 'x' or 'h'");
      if (!xo.tails || xo.tails.length !== 2) throw new Error('crossover.tails must give the two outlet lines, one per collector in cols order');
      if (xo.type === 'x') {
        bcs.set('xo/J', { type: 'branch', note: "X-pipe junction (both banks' lines in, both outlet lines out)" });
        xoRight.set(xc[0], 'xo/J'); xoRight.set(xc[1], 'xo/J');
      } else {
        const tb = xo.tube || {};
        if (!(Number(tb.L_mm || 0) > 0 && Number(tb.d_mm || 0) > 0)) throw new Error('an H-pipe crossover needs tube: {L_mm, d_mm}');
        xc.forEach((c, k) => {
          bcs.set('xo/J' + (k + 1), { type: 'branch', note: "H-pipe junction on collector " + (c + 1) + "'s line" });
          xoRight.set(c, 'xo/J' + (k + 1));
        });
        if (3.0 * p.cell_mm > Number(tb.L_mm)) throw new Error('the H-pipe balance tube is shorter than 3 cells (' + (3.0 * p.cell_mm) + ' mm)');
        const dtb = Number(tb.d_mm) / 1000.0;
        addLine([{ L: Number(tb.L_mm) / 1000.0, d0: dtb, d1: dtb }], 'xo/J1', 'xo/J2', 'H-pipe balance tube',
          tb.Tw_C !== undefined && tb.Tw_C !== null ? Number(tb.Tw_C) : 250.0, T0x, [1.0, 0.0, 0.0], 2);
      }
    }
    for (const [ci, col, levels, jkey] of colPlan) {
      levels.forEach((lv, si) => {
        for (let gi = 0; gi < lv.groups.length; gi++) {
          const gsegs = lv.sbg !== null && lv.sbg[gi] !== null && lv.sbg[gi] !== undefined ? lv.sbg[gi] : lv.segs;
          addLine(gsegs, lv.jkeys[gi], lv.right[gi], 'collector ' + (ci + 1) + ' level ' + (si + 1) + ' branch ' + (gi + 1), twC({ Tw: lv.Tw }), T0x, [1.0, 0.0, 0.0], 2);
        }
      });
      if (xoRight.has(ci)) {
        const xk = xoRight.get(ci), role = 'collector ' + (ci + 1) + ' line to the crossover';
        if (col.tail && col.tail.length) {
          const items = col.segs.map(s => ['seg', { L: s.L, d0: s.d0, d1: s.d1 }, twC(col)]).concat(tailItems(col.tail, twC(col), T0x));
          if (items[items.length - 1][0] !== 'seg') throw new Error('collector ' + (ci + 1) + ': a tail into a crossover must end with a pipe segment');
          addChain(items, jkey, xk, role, T0x, [1.0, 0.0, 0.0], 2);
        } else addLine(col.segs, jkey, xk, role, twC(col), T0x, [1.0, 0.0, 0.0], 2);
        continue;
      }
      const ok = 'col' + (ci + 1) + '/out';
      bcs.set(ok, { type: 'open', note: 'collector ' + (ci + 1) + ' outlet, open end to atmosphere' });
      if (col.tail && col.tail.length) {
        const items = col.segs.map(s => ['seg', { L: s.L, d0: s.d0, d1: s.d1 }, twC(col)]).concat(tailItems(col.tail, twC(col), T0x));
        addChain(items, jkey, ok, 'collector ' + (ci + 1) + ' line', T0x, [1.0, 0.0, 0.0], 2);
      } else addLine(col.segs, jkey, ok, 'collector ' + (ci + 1), twC(col), T0x, [1.0, 0.0, 0.0], 2);
    }
    if (xo) {
      xc.forEach((c, k) => {
        const ok = 'xo/out' + (k + 1);
        bcs.set(ok, { type: 'open', note: 'crossover outlet ' + (k + 1) + ' (collector ' + (c + 1) + "'s side), open end to atmosphere" });
        addChain(tailItems(xo.tails[k], twC(cols[c]), T0x), xoRight.get(c), ok, 'crossover outlet ' + (k + 1) + ' line', T0x, [1.0, 0.0, 0.0], 2);
      });
    }
    return { p, phases, pipes, bcs, plenums };
  }
  function makeWam(spec, run) { return writeModel(modelFromSpec(spec, run)); }

  // ------------------------------------------------------------------ AVG.DAT reader
  /* readAvg(text, opts) -> {columns, nCyl, vdCyl_m3, rhoRef, cycles:[...]}
     One entry per engine cycle, from the columns OpenWAM actually wrote (TBloqueMotor.cpp:779-940 headers,
     TCilindro.cpp:1000-1110 per cylinder). opts: {pAmbBar, TAmbC} for the reference density of the VE
     (default: the calculator's 1.01325 bar, 25 C), vdCyl_m3 (default: Net_Work_Cyl_1 / NMEP_Cyl_1 of the last
     cycle, both in the file), afr (default: the AFR column). Per cycle:
       torque_net_Nm   Net_Torque(Nm): time-averaged indicated torque of all cylinders, pumping included
       torque_brake_Nm Cicle_Effective_Torque(Nm): from BMEP_Cycle, i.e. NMEP minus the FMEP law in the .wam
       nmep_bar, imep_bar (gross: compression + expansion), pmep_bar (positive = pumping loss), bmep_bar
       power_kW        Power_Cycle(kW) (brake); power_net_kW from torque_net_Nm
       ve_delivered    mean intake mass per cylinder / (rho_ref * Vd_cyl)
       ve_trapped      AFR * fuel mass / (rho_ref * Vd_cyl): fresh air trapped at IVC (what the calculator calls ve)
       ve_openwam_atm  Volumetric_Efficiency_Atm(-): OpenWAM's own; it uses one intake pipe, so for N cylinders
                       with separate runners it is about 1/N of the real value (TBloqueMotor.cpp:1137, 1033)
       perCyl          [{cyl, nmep_bar, imep_bar, pmep_bar, intake_kg, exhaust_kg, trapped_kg, ve_delivered}]
       raw             every column of the row by its header */
  function readAvg(text, opts) {
    opts = opts || {};
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    if (!lines.length) throw new Error('empty AVG file');
    const columns = lines[0].split('\t');
    const rows = lines.slice(1).map(l => l.split('\t').map(Number));
    const ix = {};
    columns.forEach((h, i) => { ix[h] = i; });
    const col = (r, name) => (name in ix ? r[ix[name]] : NaN);
    let nCyl = 0;
    while (('NMEP_Cyl_' + (nCyl + 1) + '(bar)') in ix) nCyl++;
    let vd = opts.vdCyl_m3;
    if (!(vd > 0)) {
      for (let k = rows.length - 1; k >= 0 && !(vd > 0); k--) {
        const wk = col(rows[k], 'Net_Work_Cyl_1(J)'), mep = col(rows[k], 'NMEP_Cyl_1(bar)');
        if (Math.abs(mep) > 1e-3) vd = wk / (mep * 1e5);
      }
    }
    const pA = opts.pAmbBar > 0 ? opts.pAmbBar : CALC_P_ATM_BAR, tA = Number.isFinite(opts.TAmbC) ? opts.TAmbC : CALC_T_ATM_C;
    const rho = pA * 1e5 / (287.0 * (tA + 273.15));          // Constantes.h:69 R = 287
    const cycles = rows.map(r => {
      const raw = {};
      columns.forEach((h, i) => { raw[h] = r[i]; });
      const afr = opts.afr > 0 ? opts.afr : col(r, 'AFR(-)');
      const tq = col(r, 'Net_Torque(Nm)'), rpm = col(r, 'Engine_Speed(rpm)');
      const perCyl = [];
      for (let c = 1; c <= nCyl; c++) {
        const im = col(r, 'Intake_Mass_Cyl_' + c + '(kg/cc)');
        perCyl.push({ cyl: c, nmep_bar: col(r, 'NMEP_Cyl_' + c + '(bar)'), imep_bar: col(r, 'IMEP_Cyl_' + c + '(bar)'),
          pmep_bar: col(r, 'PMEP_Cyl_' + c + '(bar)'), intake_kg: im, exhaust_kg: -col(r, 'Exhaust_Mass_Cyl_' + c + '(kg/cc)'),
          trapped_kg: col(r, 'Trapped_Mass_Cyl_' + c + '(kg)'), ve_delivered: im / (rho * vd) });
      }
      return {
        cycle: col(r, 'Cycle(-)'), time_s: col(r, 'Time(s)'), rpm,
        torque_net_Nm: tq, torque_brake_Nm: col(r, 'Cicle_Effective_Torque(Nm)'),
        nmep_bar: col(r, 'NMEP_Cycle(bar)'), imep_bar: col(r, 'IMEP_Cycle(bar)'), pmep_bar: -col(r, 'PMEP_Cycle(bar)'),
        bmep_bar: col(r, 'BMEP_Cycle(bar)'), power_kW: col(r, 'Power_Cycle(kW)'), power_net_kW: tq * 2 * Math.PI * rpm / 60 / 1000,
        ve_delivered: col(r, 'Intake_Mass(kg/cc)') / (rho * vd), ve_trapped: afr * col(r, 'Fuel_Mass(kg/cc)') / (rho * vd),
        ve_openwam_atm: col(r, 'Volumetric_Efficiency_Atm(-)'), fuel_kg: col(r, 'Fuel_Mass(kg/cc)'), intake_kg: col(r, 'Intake_Mass(kg/cc)'),
        afr, perCyl, raw,
      };
    });
    return { columns, nCyl, vdCyl_m3: vd, rhoRef: rho, cycles };
  }

  // ------------------------------------------------------------------ INS.DAT reader (make_wam.read_ins)
  /* readIns(text, opts) -> the open-end node of an exhaust outlet pipe (written with run.ins_outlet = 1; those points
     are the only pipe points with a mass-flow F column). opts.pipe: 1-based pipe number of the outlet; opts.model: the
     model the file was written from (modelFromSpec) - with it the outlets and the plenum ports are identified exactly
     and `ports` is filled, without it the outlet is the mass-flow point with the highest pipe number and the largest
     distance on it; opts.keepCycles: keep the last N complete cycles (cycle boundary = drop of the Angle column; a
     trailing fragment under 600 deg is dropped). Returns {time [s], angle [deg], p [Pa], u [m/s], T [K], mdot [kg/s],
     rho [kg/m3] = p/(R_BURNT T), pipe, x_m, cycles, outlets, plenums: {k: {p, T, m}},
     ports: {k: {in: {pipe, x_m, mdot, p, T}, out: {...}}} (flows positive along the line)}. With a fine out_step_deg
     the rows are the solver's own time steps and are not evenly spaced: resample on `time`. */
  function readIns(text, opts) {
    opts = opts || {};
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    if (lines.length < 2) throw new Error('INS file has no data rows');
    const head = lines[0].split('\t'), ix = {};
    head.forEach((h, i) => { ix[h] = i; });
    // OpenWAM reuses one ostringstream for a pipe's distance labels (TTubo.cpp:2575, 2822): the k-th point of a pipe
    // carries the labels of points 1..k run together ("0.01" then "0.010.49349518"); the previous label is stripped.
    const pts = new Map(), seen = {};
    head.forEach((h, i) => {
      const mm = /^([PVTF])_duct_(\d+)_at_([-0-9.eE+]+)_m\(/.exec(h);
      if (!mm) return;
      const n = Number(mm[2]), lab = mm[3], k = n + '|' + lab;
      if (!pts.has(k)) {
        const prev = seen[n] || '';
        const x = prev && lab.startsWith(prev) && lab.length > prev.length ? Number(lab.slice(prev.length)) : Number(lab);
        pts.set(k, { pipe: n, x, lab });
        seen[n] = lab;
      }
      pts.get(k)[mm[1]] = i;
    });
    const byPos = (a, b) => a.pipe - b.pipe || a.x - b.x;
    const fpts = Array.from(pts.values()).filter(v => 'F' in v && 'P' in v && 'V' in v && 'T' in v).sort(byPos);
    if (!fpts.length) throw new Error('no mass-flow point (a duct point with P, V, T and F columns) in the INS header; write the model with ins_outlet=1');
    const last = a => a[a.length - 1];
    let outlets = [];
    const ports = {};
    if (opts.model) {
      const m = opts.model, bc = k => getBc(m.bcs, k);
      m.pipes.forEach((pp, i) => {
        if (bc(pp.right).type === 'open' && Math.trunc(pp.ht) === 2) { const c = fpts.filter(k => k.pipe === i + 1); if (c.length) outlets.push(last(c)); }
        for (const [side, key] of [['in', pp.right], ['out', pp.left]]) {
          if (bc(key).type === 'plenum') {
            const c = fpts.filter(k => k.pipe === i + 1 && (side === 'in' ? k.x > 0.0 : k.x === 0.0));
            if (c.length) { if (!ports[bc(key).plenum]) ports[bc(key).plenum] = {}; ports[bc(key).plenum][side] = side === 'in' ? last(c) : c[0]; }
          }
        }
      });
    } else {
      const maxPipe = Math.max(...fpts.map(k => k.pipe));
      outlets = [last(fpts.filter(k => k.pipe === maxPipe))];
    }
    if (!outlets.length) throw new Error('no outlet point in the INS header');
    let key;
    if (opts.pipe === undefined || opts.pipe === null) key = last(outlets);
    else {
      const cand = outlets.filter(v => v.pipe === Math.trunc(opts.pipe));
      if (!cand.length) throw new Error('pipe ' + opts.pipe + ' has no outlet point; outlets are on pipes ' + outlets.map(v => v.pipe));
      key = last(cand);
    }
    const it = ix['Time'], ia = ix['Angle(deg)'];
    const plen = {};
    head.forEach(h => {
      const mm = /^(Pressure|Temperature|Mass)_plenum_(\d+)\(/.exec(h);
      if (mm) { if (!plen[mm[2]]) plen[mm[2]] = {}; plen[mm[2]][mm[1][0]] = ix[h]; }
    });
    let rows = lines.slice(1).map(l => l.split('\t')).filter(f => f.length >= head.length);
    let starts = [0];
    if (ia !== undefined) {
      let prev = null;
      rows.forEach((f, r) => { const a = Number(f[ia]); if (prev !== null && a < prev - 180.0) starts.push(r); prev = a; });
      if (starts.length > 1 && Number(last(rows)[ia]) - Number(rows[last(starts)][ia]) < 600.0) { rows = rows.slice(0, last(starts)); starts = starts.slice(0, -1); }
    }
    let ncyc = starts.length;
    if (opts.keepCycles > 0 && Math.trunc(opts.keepCycles) < ncyc) { rows = rows.slice(starts[ncyc - Math.trunc(opts.keepCycles)]); ncyc = Math.trunc(opts.keepCycles); }
    const out = { time: [], angle: [], p: [], u: [], T: [], mdot: [], rho: [], pipe: key.pipe, x_m: key.x, cycles: ncyc,
      outlets: Array.from(new Set(outlets.map(v => v.pipe))).sort((a, b) => a - b), plenums: {}, ports: {} };
    for (const k in plen) out.plenums[k] = { p: [], T: [], m: [] };
    for (const k in ports) { out.ports[k] = {}; for (const s in ports[k]) out.ports[k][s] = { pipe: ports[k][s].pipe, x_m: ports[k][s].x, mdot: [], p: [], T: [] }; }
    for (const f of rows) {
      const pPa = Number(f[key.P]) * 1e5, TK = Number(f[key.T]) + K0;
      out.time.push(Number(f[it])); out.angle.push(ia !== undefined ? Number(f[ia]) : 0.0);
      out.p.push(pPa); out.u.push(Number(f[key.V])); out.T.push(TK); out.mdot.push(Number(f[key.F])); out.rho.push(pPa / (R_BURNT * TK));
      for (const k in plen) {
        const c = plen[k];
        if ('P' in c) out.plenums[k].p.push(Number(f[c.P]) * 1e5);
        if ('T' in c) out.plenums[k].T.push(Number(f[c.T]) + K0);
        if ('M' in c) out.plenums[k].m.push(Number(f[c.M]));
      }
      for (const k in ports) for (const s in ports[k]) {
        const c = ports[k][s], o = out.ports[k][s];
        o.mdot.push(Number(f[c.F])); o.p.push(Number(f[c.P]) * 1e5); o.T.push(Number(f[c.T]) + K0);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ Windows batch file
  /* batFile(models, exePath) -> text of a .bat (CRLF). models: names or {name} objects; the model files are
     <name>.wam next to the .bat. Each is copied into its own subfolder <name>\ and run there, one after another
     (OpenWAM writes its scratch copy and results into the working folder), with the console output in
     <name>\<name>.log. The exe path sits in the OPENWAM variable at the top. */
  function batFile(models, exePath) {
    const names = (models || []).map(m => (typeof m === 'string' ? m : m.name));
    if (!names.length) throw new Error('no models');
    for (const n of names) if (!/^[A-Za-z0-9_.-]+$/.test(n)) throw new Error('model names may only use letters, digits, _ . - : ' + n);
    if (new Set(names).size !== names.length) throw new Error('model names must be unique');
    // a % in the path is doubled so cmd reads it as a %, except a leading folder variable (%USERPROFILE% and the
    // like), which cmd fills in: the default path lives under the Windows user's own folder
    const raw = String(exePath || 'OpenWAM.exe'), lead = (raw.match(/^%(USERPROFILE|LOCALAPPDATA|APPDATA|ProgramFiles|ProgramFiles\(x86\))%/i) || [''])[0];
    const exe = lead + raw.slice(lead.length).replace(/%/g, '%%');
    const L = [
      '@echo off',
      'setlocal',
      'rem OpenWAM batch written by wam_export.js: runs each model in its own subfolder, one after another.',
      'rem Keep this file next to the .wam files. Each model NAME gets a folder NAME with NAMEAVG.DAT, NAMEINS.DAT and NAME.log.',
      'set "OPENWAM=' + exe + '"',
      'if not exist "%OPENWAM%" (',
      '  echo OpenWAM not found: "%OPENWAM%"',
      '  echo Edit the OPENWAM line at the top of this file.',
      '  pause',
      '  exit /b 1',
      ')',
      'cd /d "%~dp0"',
      'set /a FAILED=0',
    ];
    for (const n of names) L.push('call :run "' + n + '"');
    L.push(
      'echo.',
      'if %FAILED%==0 (echo All ' + names.length + ' runs finished correctly.) else (echo %FAILED% run^(s^) did not finish correctly.)',
      'pause',
      'exit /b %FAILED%',
      '',
      ':run',
      'if not exist "%~1" mkdir "%~1"',
      'if exist "%~1.wam" copy /y "%~1.wam" "%~1\\%~1.wam" >nul',
      'if not exist "%~1\\%~1.wam" (',
      '  echo %~1: %~1.wam not found',
      '  set /a FAILED+=1',
      '  exit /b 0',
      ')',
      'pushd "%~1"',
      'echo Running %~1 ...',
      '"%OPENWAM%" "%~1.wam" > "%~1.log" 2>&1',
      'findstr /c:"SIMULATION FINISHED CORRECTLY" "%~1.log" >nul',
      'if errorlevel 1 (',
      '  echo   %~1 did NOT finish correctly, see %~1\\%~1.log',
      '  set /a FAILED+=1',
      ') else (',
      '  echo   %~1 finished correctly',
      ')',
      'popd',
      'exit /b 0',
      '');
    return L.join('\r\n');
  }

  const START_SHIFT_DEG = 45.0;   // see makeWam: where the engine clock starts relative to cylinder 1's firing TDC
  const WamExport = {
    makeWam, makeWamLegacy, modelFromSpec, writeModel, legacyModel, readAvg, readIns, outStepForRate, batFile,
    DEFAULTS, EXTRA_DEFAULTS, fmtG, pyRound, pyRoundInt, START_SHIFT_DEG, R_BURNT,
    Writer, splitRuns, splitSegsAt, FS_GASOLINE_SIMPLE, COMB_COMPLETE,     // for wam2t_export.js (two-strokes)
    USER_EXE: '%USERPROFILE%\\Desktop\\openwam2.2-win-x64\\openwam2.2-win-x64\\Win32_x86_64\\OpenWAM2.2-win-x64.exe',
  };
  if (typeof module !== 'undefined' && module && module.exports) module.exports = WamExport;
  if (root) root.WamExport = WamExport;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
