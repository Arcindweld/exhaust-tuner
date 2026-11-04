/* wam2t_export.js - OpenWAM 2.2 input files (.wam) for a piston-ported, crankcase-scavenged two-stroke, in the browser.
 *
 * A line-for-line port of make_wam2t.py (same folder; its docstring says what is modelled and why): for the same spec
 * and run settings, Wam2T.makeWam(spec, run) returns exactly the text make_wam2t.make_wam2t() writes
 * (test_py_js_2t.js checks this byte for byte), and Wam2T.summary() gives the numbers make_wam2t.wam2t_summary() gives
 * from the same AVG.DAT / INS.DAT. It uses wam_export.js's writer, number formatting and line splitter (WamExport,
 * loaded first in the page; require()d in Node).
 *
 * API
 *   Wam2T.makeWam(spec, run)                 -> .wam text (spec in SI units, see make_wam2t.py SPEC)
 *   Wam2T.modelFromSpec(spec, run), Wam2T.writeModel(model)   -> the two layers underneath; model.warnings lists
 *                                                what make_wam2t.py prints to stderr (CD clipped at 1)
 *   Wam2T.summary(model, {avg, ins, log | finished}, fmepCoef)  -> make_wam2t.wam2t_summary's dict (keys the same)
 *   Wam2T.portTopForDuration, openingAngle, crownAboveBdc, windowArea, timeArea, reedLumped: the geometry helpers
 *   Wam2T.RUN_DEFAULTS, CD_EXHAUST, CD_TRANSFER, CD_REED, CD_INTAKE_PORT, FMEP_COEF_PA
 *   exhaust.dual = {x0, Li, Dm, di, Lp} [m]: the dual power insert as a second path between two junctions (dualLines)
 */
(function (root) {
  'use strict';
  const WX = (typeof module !== 'undefined' && module && module.exports && typeof require === 'function')
    ? require('./wam_export.js') : root.WamExport;
  const { Writer, splitRuns, splitSegsAt, FS_GASOLINE_SIMPLE, COMB_COMPLETE, fmtG, pyRound } = WX;

  const pctG = x => fmtG(x, 6);                        // Python "%g"
  const pctF = (x, n) => pyRound(x, n).toFixed(n);     // Python "%.nf" (half to even on the exact value)
  const pctD = x => String(Math.trunc(x));
  function pmod(a, b) { let r = a % b; if (r !== 0 && (r < 0) !== (b < 0)) r += b; return r; }   // Python float %
  const radians = x => x * (Math.PI / 180.0);
  const num = x => Number(x);

  const K0 = 273.15;
  const ENGINE_START_DEG = 256.0;
  const FMEP_COEF_PA = 100.0;
  const RUN_DEFAULTS = {
    name: 'twostroke', rpm: 11000.0, cycles: 30, out_step_deg: 1.0, p_amb_bar: 1.01325, T_amb_C: 25.0, gamma_model: 2,
    cell_mm: 8.0, courant: 0.8, roughness_mm: 0.02, end_loss: 1.0, pipe_htc_mult: 1.0, pipe_fric_mult: 1.0,
    cd_points: 41, closing_fix: 1, exhaust_Tgas0_C: 500.0, crankcase_T0_C: 40.0, lhv_J_kg: 44.0e6, fuel_density: 740.0,
  };
  const CD_EXHAUST = 0.70, CD_TRANSFER = 0.65, CD_REED = 0.60, CD_INTAKE_PORT = 0.65;

  // ------------------------------------------------------------------ geometry
  function crownAboveBdc(thetaDeg, S, L) {
    const c = radians(thetaDeg), q = S * Math.sin(c) / 2.0;
    return S - (L + S * (1.0 - Math.cos(c)) / 2.0 - Math.sqrt(L * L - q * q));
  }
  function portTopForDuration(dur, S, L) {
    if (!(0.0 < dur && dur < 360.0)) throw new Error('port duration ' + pctG(dur) + ' must lie in (0, 360)');
    return crownAboveBdc(180.0 - dur / 2.0, S, L);
  }
  function openingAngle(H, S, L) {
    let a0 = 0.0, a1 = 180.0;
    for (let i = 0; i < 60; i++) {
      const a = (a0 + a1) / 2.0;
      if (H - crownAboveBdc(a, S, L) > 0.0) a1 = a; else a0 = a;
    }
    return (a0 + a1) / 2.0;
  }
  function windowWidth(y, W, Hw, rt, rb) {
    if (y < 0.0 || y > Hw) return 0.0;
    let w = W;
    if (rt > 0.0 && y < rt) { const q = rt - y; w -= 2.0 * (rt - Math.sqrt(Math.max(0.0, rt * rt - q * q))); }
    const yb = Hw - y;
    if (rb > 0.0 && yb < rb) { const q = rb - yb; w -= 2.0 * (rb - Math.sqrt(Math.max(0.0, rb * rb - q * q))); }
    return Math.max(0.0, w);
  }
  function windowArea(h, W, Hw, rt, rb, n) {
    n = n === undefined ? 200 : n;
    h = Math.min(Math.max(h, 0.0), Hw);
    if (h <= 0.0) return 0.0;
    n += n % 2;
    const dy = h / n;
    let s = windowWidth(0.0, W, Hw, rt, rb) + windowWidth(h, W, Hw, rt, rb);
    for (let i = 1; i < n; i++) s += (i % 2 ? 4.0 : 2.0) * windowWidth(i * dy, W, Hw, rt, rb);
    return s * dy / 3.0;
  }
  const rTop = p => (p.r_top !== undefined && p.r_top !== null ? num(p.r_top) : 0.0);
  const rBot = p => (p.r_bot !== undefined && p.r_bot !== null ? num(p.r_bot) : 0.0);
  const winArea = (h, p) => windowArea(h, p.width, p.Hw, rTop(p), rBot(p));
  function checkWindow(port, what) {
    const W = port.width, rt = rTop(port), rb = rBot(port), Hw = port.Hw;
    if (!(W > 0.0 && Hw > 0.0)) throw new Error(what + ': width and window height must be positive');
    if (2.0 * Math.max(rt, rb) > W + 1e-12 || rt + rb > Hw + 1e-12)
      throw new Error(what + ': corner radii ' + pctG(rt * 1e3) + '/' + pctG(rb * 1e3) + ' mm do not fit a ' + pctG(W * 1e3) + ' x ' + pctG(Hw * 1e3) + ' mm window');
  }
  function portCdTable(port, H, aRef, cd, npts, clip) {
    clip = clip === undefined ? 1.0 : clip;
    const opens = [], cds = [];
    for (let i = 0; i < npts; i++) {
      const h = H * i / (npts - 1);
      const a = winArea(h, port);
      opens.push(pyRound(h, 9));
      cds.push(pyRound(Math.min(clip, cd * a / aRef), 6));
    }
    return [opens, cds];
  }
  function timeArea(port, H, S, L, rpm, Vd, cd) {
    cd = cd === undefined ? 1.0 : cd;
    const aOpen = openingAngle(H, S, L), n = 720;
    let tot = 0.0;
    for (let i = 0; i < n; i++) {
      const th = aOpen + (360.0 - 2.0 * aOpen) * (i + 0.5) / n;
      tot += winArea(H - crownAboveBdc(th, S, L), port);
    }
    const dth = (360.0 - 2.0 * aOpen) / n;
    return cd * tot * dth / (6.0 * rpm) / Vd;
  }
  function reedLumped(r) {
    const n = Math.trunc(num(r.petals)), L = num(r.L), w = num(r.w), t = num(r.t);
    const E = num(r.E), rho = num(r.rho), zeta = num(r.zeta !== undefined && r.zeta !== null ? r.zeta : 0.15);
    const I = w * Math.pow(t, 3) / 12.0;
    const k1 = 3.0 * E * I / Math.pow(L, 3);
    const m1 = 0.2357 * rho * w * t * L;
    const a1 = 3.0 / 8.0 * w * L;
    const k = n * k1, m = n * m1, A = n * a1;
    const c = 2.0 * zeta * Math.sqrt(k * m);
    const f1 = 3.516 / (2.0 * Math.PI * L * L) * Math.sqrt(E * I / (rho * w * t));
    return { m, c, k, A, f_n_Hz: f1, perimeter: n * (w + L) };
  }

  // ------------------------------------------------------------------ model
  const BC_DESC = { open: 'open end', closed: 'closed end', step: 'diameter step', plenum: 'plenum port', eport: 'exhaust port', tport: 'transfer port', branch: 'junction' };
  const BC_ENDS = { open: [1, 1], closed: [1, 1], step: [2, 2], plenum: [1, 1], eport: [1, 1], tport: [1, 1], branch: [3, 3] };
  // make_wam2t.dual_lines: exhaust segs and a dual power insert {x0, Li, Dm, di, Lp} [m] -> [before, annulus, insert, after]
  function dualLines(segs, d) {
    const x0 = num(d.x0), Li = num(d.Li), Dm = num(d.Dm), di = num(d.di), Lp = num(d.Lp);
    const x2 = x0 + Li + Lp;
    let total = 0; for (const sg of segs) total += num(sg.L);
    if (!(Li > 0.0 && Lp >= 0.0 && Dm > di && di > 0.0 && 0.0 < x0 && x0 < x2 && x2 < total))
      throw new Error('the dual power insert must lie inside the chamber, its mouth wider than its pipe');
    const [before, rest] = splitSegsAt(segs, x0);
    const [mid, after] = splitSegsAt(rest, x2 - x0);
    const cuts = []; let a = 0.0;
    for (const sg of mid) { a += num(sg.L); cuts.push(a); }
    let xs = Array.from(new Set([0.0, Li].concat(cuts))).sort((p, q) => p - q);
    xs = xs.filter(x => x <= x2 - x0 + 1e-12);
    const inner = x => (x <= Li ? Dm + (di - Dm) * x / Li : di);
    const ann = [];
    for (let k = 0; k + 1 < xs.length; k++) {
      const a0 = xs[k], b0 = xs[k + 1];
      if (b0 - a0 <= 1e-9) continue;
      const m = 0.5 * (a0 + b0);
      let acc = 0.0, o0 = NaN, o1 = NaN;
      for (const sg of mid) {
        const L = num(sg.L);
        if (acc <= m && m <= acc + L) {
          o0 = num(sg.d0) + (num(sg.d1) - num(sg.d0)) * (a0 - acc) / L;
          o1 = num(sg.d0) + (num(sg.d1) - num(sg.d0)) * (b0 - acc) / L;
          break;
        }
        acc += L;
      }
      const i0 = m <= Li ? inner(a0) : di, i1 = m <= Li ? inner(b0) : di;
      if (!(o0 > i0 && o1 > i1)) throw new Error('the dual power insert touches the chamber wall');
      ann.push({ L: b0 - a0, d0: Math.sqrt(o0 * o0 - i0 * i0), d1: Math.sqrt(o1 * o1 - i1 * i1) });
    }
    const ins = [{ L: Li, d0: Dm, d1: di }].concat(Lp > 1e-6 ? [{ L: Lp, d0: di, d1: di }] : []);
    return [before, ann, ins, after];
  }
  function numberModel(pipes, bcs) {
    const n = new Map(), order = [], ends = new Map();
    pipes.forEach((pp, i) => {
      if (pp.left === pp.right) throw new Error('pipe ' + (i + 1) + ' has the same BC at both ends');
      for (const side of ['left', 'right']) {
        const k = pp[side];
        if (!bcs.has(k)) throw new Error('pipe ' + (i + 1) + ' refers to unknown BC ' + k);
        if (!n.has(k)) { order.push(k); n.set(k, order.length); }
        if (!ends.has(k)) ends.set(k, []);
        ends.get(k).push([i, side]);
      }
    });
    for (const k of bcs.keys()) {
      if (!n.has(k)) throw new Error('BC ' + k + ' is not attached to any pipe');
      const [lo, hi] = BC_ENDS[bcs.get(k).type], c = ends.get(k).length;
      if (!(lo <= c && c <= hi)) throw new Error('BC ' + k + ' of type ' + bcs.get(k).type + ' has ' + c + ' pipe ends');
    }
    return { num: n, order, ends };
  }
  const given = v => v !== undefined && v !== null;

  function modelFromSpec(spec, run) {
    run = Object.assign({}, run || {});
    for (const k in run) if (!(k in RUN_DEFAULTS)) throw new Error('unknown run setting ' + k);
    const p = Object.assign({}, RUN_DEFAULTS, run);
    const e = spec.e;
    const B = num(e.bore), S = num(e.stroke), L = num(e.rod);
    const Ap = Math.PI / 4.0 * B * B, Vd = Ap * S;
    const ncyl = Math.trunc(num(given(e.ncyl) ? e.ncyl : 1));
    const ph0 = (e.phases && e.phases.length) ? e.phases : Array.from({ length: ncyl }, (_, c) => 360.0 * c / ncyl);
    const phases = ph0.map(x => pmod(num(x), 360.0));
    if (phases.length !== ncyl) throw new Error('e.phases must list one firing angle per cylinder');
    const warnings = [];

    const ex = Object.assign({}, spec.exhaust_port);
    const Hex = portTopForDuration(num(ex.dur), S, L);
    ex.H = Hex; ex.Hw = num(ex.height) || Hex;
    checkWindow(ex, 'exhaust port');
    const trs = [];
    spec.transfers.forEach((t0, j) => {
      const t = Object.assign({}, t0);
      t.H = portTopForDuration(num(t.dur), S, L);
      t.Hw = num(t.height) || t.H;
      checkWindow(t, 'transfer ' + (j + 1));
      if (t.H >= Hex) throw new Error('transfer ' + (j + 1) + ' opens before the exhaust port (top ' + pctG(t.H * 1e3) + ' >= ' + pctG(Hex * 1e3) + ' mm)');
      trs.push(t);
    });

    let crg, Vc;
    if (given(e.cr_geom)) { crg = num(e.cr_geom); Vc = Vd / (crg - 1.0); }
    else if (given(e.cr_trapped)) { const Vtr = Ap * (S - Hex); Vc = Vtr / (num(e.cr_trapped) - 1.0); crg = (Vc + Vd) / Vc; }
    else throw new Error('give e.cr_trapped or e.cr_geom');
    const crTrapped = (Vc + Ap * (S - Hex)) / Vc;
    let ccr;
    if (given(e.ccr)) ccr = num(e.ccr);
    else if (given(e.Vcc_min)) ccr = (num(e.Vcc_min) + Vd) / num(e.Vcc_min);
    else throw new Error('give e.ccr (crankcase compression ratio) or e.Vcc_min (m3)');
    if (!(ccr > 1.0)) throw new Error('crankcase compression ratio must exceed 1');
    const afr = num(e.afr), phi = (1.0 / afr) / FS_GASOLINE_SIMPLE;
    const combEff = given(e.combEff) ? num(e.combEff) : COMB_COMPLETE * Math.min(1.0, 1.0 / phi);
    const burn = e.burn, tw = e.Twall || {};
    const dflt = (o, k, v) => (given(o[k]) ? num(o[k]) : v);
    const eng = {
      B, S, L, Ap, Vd, Vc, cr_geom: crg, cr_trapped: crTrapped, ccr, Vcc_min: Vd / (ccr - 1.0), afr, phi, comb_eff: combEff,
      burn_start: num(burn.start), burn_dur: num(burn.dur), wiebe_a: dflt(burn, 'a', 5.0), wiebe_m: dflt(burn, 'm', 2.0),
      T_piston: dflt(tw, 'piston', 280.0), T_head: dflt(tw, 'head', 220.0), T_liner: dflt(tw, 'liner', 180.0),
      ex_open_atdc: openingAngle(Hex, S, L),
    };

    const pipes = [], bcs = new Map(), plenums = [], vtypes = [];
    const vtype = d => { vtypes.push(d); return vtypes.length; };
    function addLine(segs, left, right, role, Twc, Tgc, comp, ht) {
      const runs = splitRuns(segs), keys = [left];
      for (let j = 1; j < runs.length; j++) {
        const sk = role + '/step' + j;
        bcs.set(sk, { type: 'step', note: role + ' diameter step ' + pctG(runs[j - 1].d1 * 1e3) + ' to ' + pctG(runs[j].D0 * 1e3) + ' mm' });
        keys.push(sk);
      }
      keys.push(right);
      runs.forEach((rn, j) => {
        pipes.push({ role: runs.length === 1 ? role : role + ' part ' + (j + 1), left: keys[j], right: keys[j + 1],
          D0: rn.D0, secs: rn.secs.map(s => s.slice()), Tw_C: Twc, Tg_C: Tgc, comp, ht });
      });
    }

    const cdfix = vtype({ kind: 'cdfix', cd: 1.0, note: 'fixed CD 1, transfer ducts and silencer into their plenums' });
    const exh = spec.exhaust, intake = spec.intake;
    const air = [0.0, 0.0, 1.0], burnt = [1.0, 0.0, 0.0];
    const Tex = num(exh.Tw) - K0;
    const Tin = (num(intake.Tw) || (p.T_amb_C + K0)) - K0;
    const info = { cyl: [] };
    let vePipe = 0;
    for (let c = 0; c < ncyl; c++) {
      const C = c + 1;
      plenums.push({ kind: 'crankcase', cyl: C, desfase: pmod(180.0 + phases[c], 360.0), ccr, p_bar: p.p_amb_bar, T_C: p.crankcase_T0_C, comp: air,
        note: 'cylinder ' + C + ' crankcase, CCR ' + pctF(ccr, 3) + ', ' + pctF(eng.Vcc_min * 1e6, 1) + ' cm3 at BDC' });
      const nplCc = plenums.length;
      let segs = intake.segs;
      const Din = num(segs[segs.length - 1].d1), aIn = Math.PI / 4.0 * Din * Din;
      const ok = 'c' + C + '/in/open', ck = 'c' + C + '/in/cc';
      bcs.set(ok, { type: 'open', note: 'cylinder ' + C + ' intake inlet, open end to atmosphere' });
      let infoIn;
      if ((intake.type || 'reed') === 'reed') {
        const r = intake.reed, lp = reedLumped(r), model = r.model || '1d';
        const cdr = num(given(r.cd) ? r.cd : CD_REED);
        const area = lift => pyRound(Math.min(1.0, cdr * Math.min(lp.perimeter * lift, num(r.A_block)) / aIn), 6);
        const nlift = 31;
        const desc = pctD(num(r.petals)) + ' petals ' + pctG(num(r.L) * 1e3) + 'x' + pctG(num(r.w) * 1e3) + 'x' + pctG(num(r.t) * 1e3) + ' mm, k ' +
          pctF(lp.k, 0) + ' N/m, m ' + fmtG(lp.m, 3) + ' kg, f_n ' + pctF(lp.f_n_Hz, 0) + ' Hz';
        let vt;
        if (model === '1d') {
          const lmax = num(given(r.lift_table_max) ? r.lift_table_max : 0.015);
          const lifts = Array.from({ length: nlift }, (_, i) => lmax * i / (nlift - 1));
          vt = vtype({ kind: 'reed', model: 1, lp, step: lmax / (nlift - 1), cds: lifts.map(area), note: 'reed 1-D (no lift stop in OpenWAM), ' + desc });
        } else if (model === '0d') {
          const stop = num(given(r.lift_stop) ? r.lift_stop : 0.010);
          const dpStop = stop * lp.k / lp.A / 1e5;
          const dps = Array.from({ length: nlift }, (_, i) => 1.5 * dpStop * i / (nlift - 1));
          vt = vtype({ kind: 'reed', model: 0, lp, step: dps[1], cds: dps.map(d => area(Math.min(stop, d * 1e5 * lp.A / lp.k))),
            note: 'reed quasi-steady 0-D: static lift dp*A/k, stop ' + pctG(stop * 1e3) + ' mm reached at ' + pctF(dpStop, 3) + ' bar, ' + desc });
        } else throw new Error('intake.reed.model must be 0d or 1d');
        bcs.set(ck, { type: 'plenum', plenum: nplCc, vt, note: 'cylinder ' + C + ' reed valve into the crankcase' });
        infoIn = { type: 'reed', lumped: lp };
      } else if (intake.type === 'port') {
        const ip = Object.assign({}, intake.port);
        const aO = 360.0 - num(ip.open_btdc);
        const hOpen = crownAboveBdc(aO, S, L);
        ip.Hw = num(ip.height) || (S - hOpen);
        checkWindow(ip, 'intake port');
        const cdv = num(given(ip.cd) ? ip.cd : CD_INTAKE_PORT);
        const angs = [], cdt = [];
        for (let i = 0; i < 361; i++) {
          const phiBc = i;
          const th = pmod(phiBc - phases[c], 360.0);
          const h = crownAboveBdc(th, S, L) - hOpen;
          const aa = winArea(h, ip);
          angs.push(phiBc);
          cdt.push(pyRound(Math.min(1.0, cdv * aa / aIn), 6));
        }
        const vt = vtype({ kind: 'disc', angles: angs, cds: cdt, note: 'piston-controlled intake port, opens ' + pctG(num(ip.open_btdc)) + ' BTDC, as a rotary-disc CD(angle) table' });
        bcs.set(ck, { type: 'plenum', plenum: nplCc, vt, note: 'cylinder ' + C + ' piston-controlled intake port into the crankcase' });
        infoIn = { type: 'port', open_btdc: num(ip.open_btdc) };
      } else throw new Error('intake.type must be reed or port');
      addLine(segs, ok, ck, 'cylinder ' + C + ' intake', Tin, p.T_amb_C, air, 1);
      if (c === 0) vePipe = pipes.length;
      let aTrMax = 0.0;
      trs.forEach((t, j) => {
        const d = num(t.duct.d), aDuct = Math.PI / 4.0 * d * d;
        const cdT = num(given(t.cd) ? t.cd : CD_TRANSFER);
        const [opens, cds] = portCdTable(t, t.H, aDuct, cdT, Math.trunc(p.cd_points));
        const amax = winArea(t.H, t);
        aTrMax += amax;
        if (amax * cdT > aDuct) warnings.push('transfer ' + (j + 1) + ' effective window area exceeds its duct area: CD clipped at 1');
        const vt = vtype({ kind: 'port', port: t, opens, cdin: cds, cdout: cds,
          note: 'transfer ' + (j + 1) + ': ' + pctG(num(t.dur)) + ' deg, top ' + pctF(t.H * 1e3, 2) + ' mm above BDC crown, ' + pctG(t.width * 1e3) + ' mm wide, opens ' + pctF(openingAngle(t.H, S, L), 1) + ' ATDC' });
        const pk = 'c' + C + '/tr' + (j + 1) + '/cc', tk = 'c' + C + '/tr' + (j + 1) + '/port';
        bcs.set(pk, { type: 'plenum', plenum: nplCc, vt: cdfix, note: 'cylinder ' + C + ' transfer duct ' + (j + 1) + ' from the crankcase' });
        bcs.set(tk, { type: 'tport', cyl: C, vt, note: 'cylinder ' + C + ' transfer port ' + (j + 1) });
        addLine([{ L: num(t.duct.L), d0: d, d1: d }], pk, tk, 'cylinder ' + C + ' transfer duct ' + (j + 1), p.crankcase_T0_C, p.crankcase_T0_C, air, 1);
      });
      if (Math.trunc(p.closing_fix) === 1) {
        const dfix = 0.01;
        const vt = vtype({ kind: 'port', port: { width: ex.width, Hw: ex.Hw, r_top: 0.0, r_bot: 0.0, H: Hex }, opens: [0.0, Hex], cdin: [0.0, 0.0], cdout: [0.0, 0.0],
          note: 'CD-0 port with the exhaust port\'s height: makes OpenWAM close the cycle at exhaust closing' });
        const fk = 'c' + C + '/fix/port', fc = 'c' + C + '/fix/closed';
        bcs.set(fk, { type: 'tport', cyl: C, vt, note: 'cylinder ' + C + ' cycle-closing port, never flows' });
        bcs.set(fc, { type: 'closed', note: 'cylinder ' + C + ' cycle-closing stub, closed end' });
        const Lstub = 3.0 * p.cell_mm / 1000.0;
        addLine([{ L: Lstub, d0: dfix, d1: dfix }], fk, fc, 'cylinder ' + C + ' cycle-closing stub', Tin, p.T_amb_C, air, 1);
      }
      segs = exh.segs;
      const Dex = num(segs[0].d0), aEx = Math.PI / 4.0 * Dex * Dex;
      const cdE = num(given(ex.cd) ? ex.cd : CD_EXHAUST);
      const [opens, cds] = portCdTable(ex, Hex, aEx, cdE, Math.trunc(p.cd_points));
      const aExMax = winArea(Hex, ex);
      if (aExMax * cdE > aEx) warnings.push('exhaust effective window area exceeds the header area: CD clipped at 1');
      const vt = vtype({ kind: 'port', port: ex, opens, cdin: cds, cdout: cds,
        note: 'exhaust port: ' + pctG(num(ex.dur)) + ' deg, top ' + pctF(Hex * 1e3, 2) + ' mm above BDC crown, ' + pctG(ex.width * 1e3) + ' mm wide, opens ' + pctF(eng.ex_open_atdc, 1) + ' ATDC' });
      const ek = 'c' + C + '/ex/port', xk = 'c' + C + '/ex/open';
      bcs.set(ek, { type: 'eport', cyl: C, vt, note: 'cylinder ' + C + ' exhaust port' });
      bcs.set(xk, { type: 'open', note: 'cylinder ' + C + ' exhaust outlet, open end to atmosphere' });
      const sil = exh.silencer, dual = exh.dual;
      let ekk = ek;
      if (dual) {
        const [before, ann, ins, after] = dualLines(segs, dual);
        const j1 = 'c' + C + '/dual/j1', j2 = 'c' + C + '/dual/j2';
        bcs.set(j1, { type: 'branch', note: 'cylinder ' + C + ' dual power insert, junction at its mouth' });
        bcs.set(j2, { type: 'branch', note: 'cylinder ' + C + ' dual power insert, junction at the end of its pipe' });
        addLine(before, ekk, j1, 'cylinder ' + C + ' exhaust chamber', Tex, p.exhaust_Tgas0_C, burnt, 2);
        addLine(ann, j1, j2, 'cylinder ' + C + ' chamber round the insert', Tex, p.exhaust_Tgas0_C, burnt, 2);
        addLine(ins, j1, j2, 'cylinder ' + C + ' dual power insert', Tex, p.exhaust_Tgas0_C, burnt, 2);
        segs = after;
        ekk = j2;
      }
      const tailRole = dual ? 'cylinder ' + C + ' stinger after the insert' : 'cylinder ' + C + ' exhaust chamber';
      if (sil) {
        plenums.push({ kind: 'const', V_m3: num(sil.V_m3), p_bar: p.p_amb_bar, T_C: p.exhaust_Tgas0_C, comp: burnt,
          note: 'cylinder ' + C + ' silencer, ' + pctG(num(sil.V_m3) * 1e3) + ' litres' });
        const si = 'c' + C + '/sil/in', so = 'c' + C + '/sil/out';
        bcs.set(si, { type: 'plenum', plenum: plenums.length, vt: cdfix, note: 'cylinder ' + C + ' silencer inlet' });
        bcs.set(so, { type: 'plenum', plenum: plenums.length, vt: cdfix, note: 'cylinder ' + C + ' silencer outlet' });
        addLine(segs, ekk, si, tailRole, Tex, p.exhaust_Tgas0_C, burnt, 2);
        addLine(sil.segs, so, xk, 'cylinder ' + C + ' tailpipe', Tex, p.exhaust_Tgas0_C, burnt, 2);
      } else {
        addLine(segs, ekk, xk, tailRole, Tex, p.exhaust_Tgas0_C, burnt, 2);
      }
      info.cyl.push({ intake: infoIn, A_ex_max_mm2: aExMax * 1e6, A_tr_max_mm2: aTrMax * 1e6, A_header_mm2: aEx * 1e6 });
    }
    eng.H_ex = Hex;
    eng.H_tr = trs.map(t => t.H);
    eng.tr_open_atdc = trs.map(t => openingAngle(t.H, S, L));
    return { p, eng, phases, pipes, bcs, plenums, vtypes, ve_pipe: vePipe, info, spec, warnings };
  }

  // ------------------------------------------------------------------ writer
  function writeModel(m) {
    const p = m.p, g = m.eng, pipes = m.pipes, bcs = m.bcs, plenums = m.plenums, vtypes = m.vtypes, phases = m.phases;
    const ncyl = phases.length;
    const { num: N, order } = numberModel(pipes, bcs);
    const w = new Writer();
    const T = 'TOpenWAM.cpp', E = 'TBloqueMotor.cpp', U = 'TTubo.cpp';
    w.comment('OpenWAM 2.2 two-stroke input written by make_wam2t.py - ' + p.name + ', ' + pctG(p.rpm) + ' rpm');
    w.comment('labels give the reader source file:line; units as used by that reader');
    w.comment('geometric CR ' + pctF(g.cr_geom, 3) + ', trapped CR ' + pctF(g.cr_trapped, 3) + ', crankcase CR ' + pctF(g.ccr, 3) + ', exhaust opens ' + pctF(g.ex_open_atdc, 2) + ' ATDC');

    w.section('HEADER  TOpenWAM::ReadInputData');
    w.v(2200, T + ':477 version, must equal vers 2200 Globales.h:53');
    w.v(0, T + ':485 Independent 0 = common time step for all pipes');

    w.section('GENERAL DATA  TOpenWAM::ReadGeneralData');
    w.v(num(p.out_step_deg), T + ':606 agincr, instantaneous output interval deg');
    w.v(Math.trunc(p.cycles), T + ':606 SimulationDuration = number of engine cycles');
    w.v(num(p.p_amb_bar), T + ':607 ambient pressure bar');
    w.v(num(p.T_amb_C), T + ':607 ambient temperature degC');
    w.v(0, T + ':608 species model 0 = simple: burnt gas, fuel, air');
    w.v(Math.trunc(p.gamma_model), T + ':608 gamma 0 const, 1 f-composition, 2 f-composition-temperature');
    w.v(1, T + ':622 engine block present');
    w.v(1, T + ':627 cycle type 1 = two-stroke nm2T, 360 deg cycle TBloqueMotor.cpp:138');
    w.v(0, T + ':627 simulation type 0 = steady speed');
    w.v(0, T + ':627 EGR transport 0 = no');
    w.v(1, T + ':743 fuel present');
    w.v(1, T + ':745 fuel type 1 = gasoline');
    w.row([0.0, 0.0, 1.0], T + ':802 atmosphere mass fractions burnt, fuel, air; sum must be exactly 1');

    w.section('ENGINE  TBloqueMotor::LeeMotor');
    w.v(0, E + ':117 ACT combustion model 0 = off, Wiebe law used');
    w.v(ncyl, E + ':134 number of cylinders');
    w.v(num(p.rpm), E + ':148 engine speed rpm');
    w.v(num(p.p_amb_bar), E + ':149 initial cylinder pressure at closing bar');
    const m0 = p.p_amb_bar * 1e5 * (g.Vd + g.Vc) / (287.0 * (p.T_amb_C + K0 + 35.0));
    w.v(pyRound(m0, 9), E + ':150 initial cylinder mass kg, start-up guess only');
    w.v(0, E + ':153 impose composition at exhaust opening 0 = no');
    w.row([0.0, 0.0, 1.0], E + ':156 initial cylinder mass fractions burnt, fuel, air');
    w.v(0, E + ':176 pressure at exhaust opening 0 = calculated');
    w.v(1, E + ':185 combustion type 1 = spark ignition, fuel from trapped air TCilindro2T.cpp:430,497');
    w.v(pyRound(g.phi, 10), E + ':196 relative fuel-air ratio = (1/AFR)/0.068468349, TCilindro.cpp:2735');
    w.v(pyRound(g.comb_eff, 6), E + ':199 combustion efficiency, multiplies released heat TCilindro2T.cpp:630');
    w.v(num(p.lhv_J_kg), E + ':200 lower heating value J/kg');
    w.v(num(p.fuel_density), E + ':201 fuel density kg/m3, not used');
    w.v(m.ve_pipe, E + ':203 pipe used for volumetric efficiency = cylinder 1 intake pipe at the reed / port');
    w.v(g.T_piston, E + ':209 piston wall temperature degC');
    w.v(g.T_head, E + ':210 head wall temperature degC');
    w.v(g.T_liner, E + ':211 liner wall temperature degC');
    w.v(pyRound(g.Ap, 9), E + ':213 piston heat-transfer area m2');
    w.v(pyRound(g.Ap + 4.0 * g.Vc / g.B, 9), E + ':214 head heat-transfer area m2 = bore area + 4 Vc/B');
    w.row([0.01, 150.0, 2700.0, 900.0], E + ':216 piston wall thickness m, k W/mK, rho, cp; unused, walls fixed');
    w.row([0.01, 150.0, 2700.0, 900.0], E + ':218 head wall thickness m, k, rho, cp; unused');
    w.row([0.01, 150.0, 2700.0, 900.0], E + ':220 liner wall thickness m, k, rho, cp; unused');
    w.row([1.0, 1.0, 10.0, 90.0], E + ':223 HT multipliers intake, exhaust (CI Woschni only), torque at max power Nm, coolant degC');
    w.v(2, E + ':225 wall temperature 2 = fixed');
    w.v(2.28, E + ':241 Woschni cw1, not used for SI two-strokes TCilindro2T.cpp:521-531');
    w.v(0.308, E + ':242 Woschni cw2, not used for SI');
    w.v(0.0, E + ':243 Woschni xpe, read but not used');
    w.v(g.L, E + ':249 connecting rod length m');
    w.v(g.S, E + ':250 stroke m');
    w.v(g.B, E + ':251 bore m');
    w.v(pyRound(g.cr_geom, 9), E + ':252 geometric compression ratio, Vc = Vd/(CR-1) :266; trapped CR ' + pctF(g.cr_trapped, 3));
    w.v(0.0, E + ':253 bowl diameter m, 0 = flat');
    w.v(0.0, E + ':254 bowl height m');
    w.v(g.B, E + ':255 distance between valves m, four-stroke short-circuit model only');
    w.v(0.0, E + ':256 blow-by area');
    w.v(0.0, E + ':257 blow-by CD, 0 = no blow-by TCilindro2T.cpp:343');
    w.v(0.0, E + ':258 piston pin offset mm');
    w.v(0.015, E + ':259 pin diameter m, deformation only');
    w.v(0.02, E + ':260 piston crown height m, deformation only');
    w.v(0.2, E + ':261 rod mass kg, deformation only');
    w.v(0.2, E + ':262 piston+rings+pin mass kg, deformation only');
    w.v(2.1e11, E + ':263 elastic modulus Pa, deformation only');
    w.v(0.0, E + ':264 deformation coefficient 0 = rigid');
    w.row([0.0, 0.0, 0.0, 0.0], E + ':274 FMEP coefficients all 0: OpenWAM torque = indicated; friction applied in wam2t_summary');
    w.v(1, E + ':358 number of burn laws');
    w.row([pyRound(m0, 9), pyRound(m0 / g.afr, 12), num(p.rpm)], E + ':360 law reference air mass kg, fuel kg, rpm; blending only');
    w.v(1, E + ':367 number of Wiebe functions');
    w.row([g.wiebe_m, g.wiebe_a, 1.0, g.burn_dur, g.burn_start], E + ':369 Wiebe m, C=a, share, duration deg, start deg BTDC entered positive :371');
    w.v(0, E + ':384 injection data 0 = none');
    if (ncyl > 1) {
      w.v(0, E + ':446 firing angles 0 = one angle per cylinder, read at 457');
      phases.forEach((ph, c) => w.v(num(ph), E + ':457 cylinder ' + (c + 1) + ' firing angle deg in the 360 deg engine cycle'));
    }
    w.v(0, E + ':485 engine controllers');
    for (let c = 0; c < ncyl; c++) w.v(0, E + ':503 controllers for cylinder ' + (c + 1));

    w.section('PIPES  TOpenWAM::ReadPipes');
    w.v(pipes.length, T + ':852 number of pipes');
    pipes.forEach((pp, i) => {
      const nl = N.get(pp.left), nr = N.get(pp.right);
      w.comment(pp.role + ' pipe ' + (i + 1) + ', ' + BC_DESC[bcs.get(pp.left).type] + ' BC' + nl + ' to ' + BC_DESC[bcs.get(pp.right).type] + ' BC' + nr);
      w.row([nl, nr, pp.secs.length, 1], U + ':546 left BC, right BC, number of sections, number of identical ducts');
      w.v(num(p.roughness_mm), U + ':547 wall roughness mm');
      w.row([num(pp.Tw_C), num(pp.Tg_C), num(p.p_amb_bar), 0.0], U + ':548 initial wall T degC, gas T degC, pressure bar, velocity m/s');
      w.row([Math.trunc(pp.ht), num(p.pipe_htc_mult), num(p.pipe_fric_mult)], U + ':549 HT type 1 intake 2 exhaust, HT multiplier, friction multiplier');
      w.row(pp.comp.map(num), U + ':568 initial mass fractions burnt, fuel, air');
      w.row([p.cell_mm / 1000.0, 2], U + ':590 mesh size m, wall T 2 = constant');
      w.v(2, U + ':604 solver 2 = TVD');
      w.v(num(p.courant), U + ':665 Courant number');
      w.v(num(pp.D0), U + ':710 diameter at section start m');
      for (const sec of pp.secs) w.row([num(sec[0]), num(sec[1])], U + ':712 section length m, diameter at section end m');
    });

    w.section('VALVE TYPES  TOpenWAM::ReadValves');
    w.v(vtypes.length, T + ':956 number of valve types');
    const LU = 'TLumbrera.cpp', LA = 'TLamina.cpp', DR = 'TDiscoRotativo.cpp';
    vtypes.forEach((vt, j) => {
      w.comment('valve type ' + (j + 1) + ': ' + vt.note);
      const k = vt.kind;
      if (k === 'cdfix') {
        w.v(0, T + ':976 valve type 0 = TCDFijo fixed CD');
        w.row([vt.cd, vt.cd, 0], 'TCDFijo.cpp:85 CD pipe to plenum, CD plenum to pipe, 0 = referred to the pipe-end area');
      } else if (k === 'port') {
        const pt = vt.port;
        w.v(4, T + ':996 valve type 4 = TLumbrera piston-controlled port');
        w.row([pyRound(pt.H, 9), pyRound(pt.width, 9), pyRound(rTop(pt), 9), pyRound(rBot(pt), 9), 0.0, 0.0],
          LU + ':103 height m (port top above BDC crown, opening = this - crown height :138), width, top radius, ' +
          'bottom radius (read, unused), position above BDC 0, reference diameter 0 = pipe end');
        w.v(vt.opens.length, LU + ':104 number of CD points');
        w.row(vt.opens, LU + ':111 opening m');
        w.row(vt.cdin, LU + ':114 CD pipe to cylinder = Cd x exposed window area / pipe-end area');
        w.row(vt.cdout, LU + ':117 CD cylinder to pipe');
      } else if (k === 'reed') {
        const lp = vt.lp;
        w.v(2, T + ':986 valve type 2 = TLamina reed valve');
        if (vt.model === 1) {
          w.row([1, 0.0, 0], LA + ':158 model 1 = 1-D mass-spring-damper, reference diameter 0 = pipe end, 0 = opens when pipe p exceeds plenum p');
          w.row([pyRound(lp.m, 9), pyRound(lp.c, 9), pyRound(lp.k, 6), pyRound(lp.A, 9)],
            LA + ':186 mass kg, damping N s/m, stiffness N/m, pressure area m2 (lumped petals, reed_lumped)');
        } else {
          w.row([0, 0.0, 0], LA + ':158 model 0 = 0-D, CD from the pressure difference, closed (both CD 0) when it is negative, GetCDin :333-338, GetCDout :420-425; ' +
            'reference diameter 0 = pipe end; 0 = opens when pipe p exceeds plenum p');
        }
        w.row([vt.cds.length, vt.cds.length], LA + ':191 CD points inflow, outflow');
        w.v(pyRound(vt.step, 9), LA + ':198 table step, ' + (vt.model === 1 ? 'lift m' : 'pressure difference bar'));
        w.row([1.0, 1.0], LA + ':199 CD multipliers inflow, outflow');
        w.row(vt.cds, LA + ':202 CD pipe to plenum = Cd x min(perimeter x lift, block window) / pipe-end area');
        w.row(vt.cds, LA + ':206 CD plenum to pipe');
      } else if (k === 'disc') {
        w.v(3, T + ':991 valve type 3 = TDiscoRotativo, CD vs angle');
        w.v(0.0, DR + ':113 reference diameter 0 = pipe end');
        w.row([1.0, 0.0, 1.0], DR + ':114 CD multiplier 1 (the outflow loop multiplies the inflow table again :132), shift, duration factor');
        w.v(vt.angles.length, DR + ':116 number of points');
        w.row(vt.angles, DR + ':123 angle deg on the pipe-to-plenum BC clock = cylinder-1 angle, measured, see notes');
        w.row(vt.cds, DR + ':127 CD pipe to plenum');
        w.row(vt.cds, DR + ':131 CD plenum to pipe');
        w.v(1, DR + ':135 speed control 1 = engine');
        w.v(1.0, DR + ':149 speed ratio to the engine');
      } else throw new Error(k);
    });

    w.section('PLENUMS  TOpenWAM::ReadPlenums');
    w.v(plenums.length, T + ':1063 number of plenums');
    w.row([0, 0, 0], T + ':1065 WAMer counts turbines, venturis, directional junctions');
    const DV = 'TDepVolVariable.cpp';
    plenums.forEach((pl, j) => {
      w.comment('plenum ' + (j + 1) + ': ' + pl.note);
      if (pl.kind === 'crankcase') {
        w.v(1, T + ':1089 plenum type 1 = TDepVolVariable, variable volume');
        w.row(pl.comp.map(num), 'TDeposito.cpp:161 initial mass fractions burnt, fuel, air');
        w.row([num(pl.p_bar), num(pl.T_C)], 'TDeposito.cpp:209 initial pressure bar, temperature degC');
        w.row([g.L, g.S, g.B], DV + ':65 rod m, stroke m, bore m');
        w.row([pyRound(pl.ccr, 9), num(pl.desfase), 0.0],
          DV + ':66 compression ratio = crankcase CR, Vdead = A S/(CR-1) :91; phase deg = 180 + firing angle, ' +
          'minimum volume at BDC IniciaVolumen :221; offset unused');
        w.v(1, DV + ':68 speed control 1 = engine');
        w.v(1.0, DV + ':82 speed ratio to the engine');
      } else {
        w.v(0, T + ':1085 plenum type 0 = TDepVolCte constant volume, adiabatic');
        w.row(pl.comp.map(num), 'TDeposito.cpp:161 initial mass fractions burnt, fuel, air');
        w.row([num(pl.V_m3), num(pl.p_bar), num(pl.T_C)], 'TDeposito.cpp:185 volume m3, initial pressure bar, temperature degC');
      }
    });
    w.section('COMPRESSORS  TOpenWAM::ReadCompressors');
    w.v(0, T + ':1181 number of compressors');

    w.section('CONNECTIONS  TOpenWAM::ReadConnections');
    w.v(order.length, T + ':1242 number of boundary conditions');
    w.row([0, 0, 0, 0, 0, 0, 0, 0, 0], T + ':1244 nine WAMer-only counts, read and ignored');
    let firstOpen = true;
    for (const k of order) {
      const b = bcs.get(k), t = b.type;
      w.comment('BC' + N.get(k) + ': ' + b.note);
      if (t === 'open') {
        w.v(0, T + ':1260 BC type 0 = open end to atmosphere');
        w.v(num(p.end_loss), 'TCCDescargaExtremoAbierto.cpp:141 inflow velocity coefficient' + (firstOpen ? ', 1 = no loss' : ''));
        firstOpen = false;
      } else if (t === 'closed') {
        w.v(3, T + ':1294 BC type 3 = closed end, reads no data');
      } else if (t === 'step') {
        w.v(6, T + ':1314 BC type 6 = pipe-to-pipe connection TCCUnionEntreTubos');
        w.row([0.0, 0.0], 'TCCUnionEntreTubos.cpp:200 wall thickness m, conductivity W/mK; unused');
      } else if (t === 'eport' || t === 'tport') {
        w.v(t === 'eport' ? 8 : 7, T + (t === 'eport' ? ':1335 BC type 8 = exhaust valve BC' : ':1324 BC type 7 = intake valve BC, here a transfer / closing port'));
        w.v(0, 'TCCCilindro.cpp:169 WAMer id, ignored');
        w.v(Math.trunc(b.cyl), 'TCCCilindro.cpp:171 cylinder number');
        w.v(Math.trunc(b.vt), T + ':1460 valve type index 1-based');
      } else if (t === 'branch') {
        w.v(12, T + ':1376 BC type 12 = branch TCCRamificacion, takes every pipe end with this number, ' +
          'reads no data TCCRamificacion.cpp:94-147');
      } else if (t === 'plenum') {
        w.v(11, T + ':1366 BC type 11 = pipe-to-plenum connection TCCDeposito');
        w.v(0, 'TCCDeposito.cpp:204 WAMer id, ignored');
        w.v(Math.trunc(b.plenum), 'TCCDeposito.cpp:206 plenum number');
        w.v(Math.trunc(b.vt), T + ':1460 valve type index 1-based');
      } else throw new Error(t);
    }

    w.section('TURBOCHARGERS, SENSORS, CONTROLLERS');
    w.v(0, T + ':1669 turbocharger axes');
    w.v(0, T + ':1699 sensors');
    w.v(0, T + ':1720 controllers');

    const O = 'TOutputResults.cpp';
    const portBcs = order.filter(k => (bcs.get(k).type === 'eport' || bcs.get(k).type === 'tport') && k.indexOf('/fix/') < 0);
    w.section('AVERAGE RESULTS  TOutputResults::ReadAverageResults');
    w.v(0, O + ':37 instantaneous results 0 = last cycle only');
    w.v(pipes.length, O + ':63 pipes with average results');
    w.v(0, O + ':64 WAMer number, ignored');
    pipes.forEach((pp, i) => {
      let Lp = 0; for (const s of pp.secs) Lp += s[0];
      w.v(i + 1, O + ':66 pipe ' + (i + 1));
      w.v(1, U + ':2465 points');
      w.row([Lp / 2.0, 3, 0, 1, 3], U + ':2508 distance m, n vars; vars 0 T, 1 p, 3 mass flow');
    });
    w.v(ncyl, O + ':78 cylinders with average results');
    const cylAvg = [0, 1, 4, 5, 6, 7, 8, 9, 20, 22, 23, 24, 25, 27];
    for (let c = 0; c < ncyl; c++) {
      w.v(c + 1, O + ':80 cylinder ' + (c + 1));
      w.v(cylAvg.length, 'TCilindro.cpp:738 number of variables');
      w.row(cylAvg, 'TCilindro.cpp:740 0 Wnet 1 NMEP 4 Qcomb 5-7 Q liner head piston 8 IMEP 9 trapped 20 AFR 22 intake ' +
        '23 exhaust 24 short-circuit 25 mean T 27 VE');
    }
    w.v(1, O + ':92 engine average results on');
    const engAvg = Array.from({ length: 23 }, (_, i) => i).concat([25, 26]);
    w.v(engAvg.length, E + ':648 number of variables');
    w.row(engAvg, E + ':650 0-22 torque, work, MEPs, power, masses, rpm, VE, efficiencies, BSFC; 25 F/A; 26 AFR', 25);
    w.v(plenums.length, O + ':105 plenums');
    plenums.forEach((_, j) => { w.v(j + 1, O + ':107 plenum ' + (j + 1)); w.row([2, 0, 1], 'TDeposito.cpp:791 n vars, 0 pressure, 1 temperature'); });
    w.v(0, O + ':119 turbocharger axes');
    w.v(0, O + ':133 compressors');
    w.v(0, O + ':147 turbines');
    w.v(portBcs.length, O + ':161 valves');
    for (const k of portBcs) {
      w.v(N.get(k), O + ':163 BC' + N.get(k) + ' ' + bcs.get(k).note);
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
    plenums.forEach((_, j) => { w.v(j + 1, O + ':556 plenum ' + (j + 1)); w.row([4, 0, 1, 2, 3], 'TDeposito.cpp:746 n vars, 0 pressure 1 temperature 2 volume 3 mass'); });
    const insPts = [], cell = p.cell_mm / 1000.0;
    pipes.forEach((pp, i) => { if (bcs.get(pp.left).type === 'eport') insPts.push([i, cell]); });
    w.v(insPts.length, O + ':568 pipes');
    w.v(0, O + ':571 WAMer number, ignored');
    for (const [i, x] of insPts) {
      w.v(i + 1, O + ':573 pipe ' + (i + 1));
      w.v(1, U + ':2700 points');
      w.row([x, 3, 0, 1, 2], U + ':2737 distance m one cell from the exhaust port, n vars; vars 0 p 1 u 2 T');
    }
    w.v(0, O + ':585 venturis');
    const insValves = portBcs.concat(order.filter(k => k.endsWith('/in/cc')));
    w.v(insValves.length, O + ':599 valves');
    for (const k of insValves) {
      w.v(N.get(k), O + ':601 BC' + N.get(k) + ' ' + bcs.get(k).note);
      w.row([2, 0, 1], 'TTipoValvula.cpp:134 n vars, 0 CD in 1 CD out');
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
    w.v(0, T + ':531 external DLL 0 = none');
    return w.text();
  }

  function makeWam(spec, run) { return writeModel(modelFromSpec(spec, run)); }

  // ------------------------------------------------------------------ results
  function pyFloat(s) {
    const t = String(s).trim();
    if (/^[+-]?nan$/i.test(t)) return NaN;
    if (/^[+-]?inf(inity)?$/i.test(t)) return t[0] === '-' ? -Infinity : Infinity;
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) throw new Error('not a number');
    return Number(t);
  }
  function readTable(text) {
    const rows = String(text).split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim()).map(l => l.split('\t'));
    if (!rows.length) throw new Error('the file is empty');
    const head = rows[0].map(h => h.trim()), data = [];
    for (const r of rows.slice(1)) {
      try { data.push(r.slice(0, head.length).map(pyFloat)); } catch (e) { /* a text row */ }
    }
    return [head, data];
  }
  function col(head, ...keys) {
    for (let i = 0; i < head.length; i++) if (keys.every(k => head[i].indexOf(k) >= 0)) return i;
    throw new Error('no column with ' + keys.join(', ') + ' in the file');
  }
  // files: {avg, ins, log} texts (ins optional: without it the crankcase pumping work is left out, as Python does on
  // a missing INS.DAT); files.finished may stand in for the log
  function summary(model, files, fmepCoef) {
    fmepCoef = fmepCoef === undefined ? FMEP_COEF_PA : fmepCoef;
    const p = model.p, g = model.eng, name = p.name, ncyl = model.phases.length;
    const finished = files.log !== undefined && files.log !== null ? String(files.log).indexOf('SIMULATION FINISHED CORRECTLY') >= 0 : !!files.finished;
    const [head, data] = readTable(files.avg);
    const rho = p.p_amb_bar * 1e5 / (287.0 * (p.T_amb_C + K0));
    const Vd = g.Vd, rpm = p.rpm, omega = 2.0 * Math.PI * rpm / 60.0;
    const hasSc = head.some(h => h.indexOf('Short_Circuit') >= 0);
    const rows = data.map(r => {
      const cyc = [];
      for (let c = 1; c <= ncyl; c++) {
        cyc.push({ NMEP: r[col(head, 'NMEP_Cyl_' + c)], intake: r[col(head, 'Intake_Mass_Cyl_' + c)], trapped: r[col(head, 'Trapped_Mass_Cyl_' + c)],
          short_circuit: hasSc ? r[col(head, 'Short_Circuit_Mass_Cyl_' + c)] : NaN });
      }
      return { cycle: Math.trunc(r[col(head, 'Cycle')]), cyl: cyc, fuel: r[col(head, 'Fuel_Mass')] };
    });
    if (!rows.length) throw new Error('no cycles in the AVG.DAT file');
    const last = rows[rows.length - 1];
    const out = { name, rpm, finished, cycles: rows.length };
    const sumN = cs => { let s = 0; for (const c of cs) s += c.NMEP; return s; };
    const nm = rows.map(r => sumN(r.cyl) / ncyl);
    const tail = nm.length >= 5 ? nm.slice(-5) : nm;
    let ts = 0; for (const x of tail) ts += x;
    out.NMEP_spread_last5_pct = tail.length && ts ? 100.0 * (Math.max(...tail) - Math.min(...tail)) / Math.abs(ts / tail.length) : NaN;
    out.NMEP_history = nm;
    const c1 = last.cyl[0];
    const airTrapped = last.fuel * g.afr;
    out.IMEP_bar = sumN(last.cyl) / ncyl;
    out.DR = c1.intake / (rho * Vd);
    out.TE = c1.intake > 0 ? airTrapped / c1.intake : NaN;
    out.SE = c1.trapped > 0 ? airTrapped / c1.trapped : NaN;
    out.CE = airTrapped / (rho * Vd);
    out.short_circuit_kg = c1.short_circuit;
    const pmepCc = [];
    try {
      if (files.ins === undefined || files.ins === null) throw new Error('no INS.DAT');
      const [ih, idata] = readTable(files.ins);
      model.plenums.forEach((pl, k) => {
        if (pl.kind !== 'crankcase') return;
        const ip = col(ih, 'Pressure_plenum_' + (k + 1)), iv = col(ih, 'Volume_plenum_' + (k + 1));
        let W = 0.0;
        for (let i = 0; i + 1 < idata.length; i++) { const a = idata[i], b = idata[i + 1]; W += 0.5 * (a[ip] + b[ip]) * 1e5 * (b[iv] - a[iv]); }
        pmepCc.push(W / Vd / 1e5);
      });
    } catch (exc) { out.ins_error = exc.message; }
    let sc = 0; for (const x of pmepCc) sc += x;
    out.crankcase_MEP_bar = pmepCc.length ? sc / pmepCc.length : NaN;
    const fmep = fmepCoef * g.S * rpm / 1e5;
    out.FMEP_bar = fmep;
    out.BMEP_bar = out.IMEP_bar + (pmepCc.length ? out.crankcase_MEP_bar : 0.0) - fmep;
    const mep2kw = mep => mep * 1e5 * Vd * ncyl / (2.0 * Math.PI) * omega / 1000.0;
    out.T_ind_Nm = out.IMEP_bar * 1e5 * Vd * ncyl / (2.0 * Math.PI);
    out.P_ind_kW = mep2kw(out.IMEP_bar);
    out.T_brake_Nm = out.BMEP_bar * 1e5 * Vd * ncyl / (2.0 * Math.PI);
    out.P_brake_kW = mep2kw(out.BMEP_bar);
    out.P_ind_hp = out.P_ind_kW / 0.7457;
    out.P_brake_hp = out.P_brake_kW / 0.7457;
    const fuelDeliv = c1.intake / g.afr * ncyl * rpm / 60.0;
    out.BSFC_g_kWh = out.P_brake_kW > 0 ? fuelDeliv * 3.6e6 / out.P_brake_kW : NaN;
    return out;
  }

  const Wam2T = {
    makeWam, modelFromSpec, writeModel, summary, readTable, dualLines,
    crownAboveBdc, portTopForDuration, openingAngle, windowWidth, windowArea, timeArea, reedLumped,
    RUN_DEFAULTS, CD_EXHAUST, CD_TRANSFER, CD_REED, CD_INTAKE_PORT, FMEP_COEF_PA, ENGINE_START_DEG,
  };
  if (typeof module !== 'undefined' && module && module.exports) module.exports = Wam2T;
  if (root) root.Wam2T = Wam2T;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : this));
