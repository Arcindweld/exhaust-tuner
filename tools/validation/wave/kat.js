// Known-answer tests of the page's 1-D wave model's building blocks (wsFactory in web/index.html), each against an
// exact or textbook answer. Run: node tools/validation/wave/kat.js [a b c d e]   (default: all; about 2 minutes)
// Writes tools/validation/wave/results/kat.json. Every number printed is measured here; nothing is fitted.
//   a  Sod shock tube vs the exact Riemann solution (gamma 1.35, the model's): plateaus, wave speeds, L1 order
//   b  acoustic modes of a closed-closed and an open-closed pipe: frequency vs n c/2L and (2n-1) c/4L, and the
//      numerical dissipation per wavelength at the page's 10 mm cells; closed ends (dead-end walls and shut valves)
//      may not make a standing wave grow or the entropy fall
//   c  steady flow: a smooth cone (isentropic mass flow, constant stagnation pressure) and sudden expansion /
//      contraction (characteristic junction) against Borda-Carnot and the second law
//   d  open end: low-amplitude reflection coefficient (sign, magnitude, effective end correction) and choked outflow
//   e  pipe friction and wall heat transfer against the Fanning / Darcy and Reynolds-analogy values the model states,
//      with Blasius, Colebrook and Dittus-Boelter at the same Reynolds number for scale
'use strict';
const fs = require('fs'), path = require('path');
const { load } = require('./lib');
const WS0 = load({ fanning: 0 });          // inviscid copy for a-d
const WSF = load();                         // the page's model as it runs (Fanning 0.005)
const G = WS0.GAM, R = WS0.RG, CP = WS0.CP, PATM = WS0.PATM, TATM = WS0.TATM;
const only = process.argv.slice(2);
const want = k => !only.length || only.includes(k);
const results = {}, table = [];
function row(test, quantity, measured, reference, tol, unit, note) {
  const err = typeof reference === 'number' && reference !== 0 ? (measured - reference) / Math.abs(reference) : null;
  const pass = tol == null ? null : (typeof tol === 'function' ? tol(measured, reference) : Math.abs(err) <= tol);
  table.push({ test, quantity, measured, reference, err, pass, unit: unit || '', note: note || '' });
  console.log((pass === null ? 'INFO' : pass ? 'PASS' : 'FAIL') + '  ' + test + '  ' + quantity + ': ' + fmt(measured) +
    (reference != null ? ' vs ' + fmt(reference) : '') + (unit ? ' ' + unit : '') + (err != null ? '  (' + (100 * err).toFixed(3) + ' %)' : '') + (note ? '  ' + note : ''));
}
const fmt = v => typeof v !== 'number' ? String(v) : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(4) : (+v.toPrecision(6)).toString();

// ---------- helpers ----------
function pipe(WS, L, dx, areaFn, T0, Tw) { return WS.makePipe({ L, dx, area: areaFn, T0: T0 || TATM, Tw: Tw || T0 || TATM, x0: 1 }); }
function setState(P, f) {                 // f(x) -> {r,u,p}
  for (let i = 0; i < P.n; i++) { const x = (i + 0.5) * P.dx, s = f(x), A = P.A[i];
    P.q1[i] = s.r * A; P.q2[i] = s.r * s.u * A; P.q3[i] = (s.p / (G - 1) + 0.5 * s.r * s.u * s.u) * A; P.q4[i] = s.r * A; }
}
let CLOCK = 0;                            // time of the step being taken, for ramped boundary pressures
const ramp = (p0, tr) => () => PATM + (p0 - PATM) * Math.min(1, CLOCK / tr) ** 2 * (3 - 2 * Math.min(1, CLOCK / tr));   // smooth start
function advance(WS, pipes, tEnd, cfl, each, joins) {
  let t = 0; cfl = cfl || 0.8; CLOCK = 0;
  while (t < tEnd - 1e-15) {
    let s = 0, dmin = 1e9;
    for (const P of pipes) { WS.prim(P); s = Math.max(s, WS.maxSpeed(P)); dmin = Math.min(dmin, P.dx); }
    let dt = cfl * dmin / s; if (t + dt > tEnd) dt = tEnd - t;
    CLOCK = t;
    if (joins) joins();
    for (const P of pipes) WS.stepPipe(P, dt);
    t += dt; if (each) each(t, dt);
  }
  for (const P of pipes) WS.prim(P);
  return t;
}

// exact Riemann solver (Toro ch. 4) for an ideal gas of ratio g
function exactRiemann(g, rL, uL, pL, rR, uR, pR) {
  const cL = Math.sqrt(g * pL / rL), cR = Math.sqrt(g * pR / rR);
  const fK = (p, rK, pK, cK) => {
    if (p > pK) { const A = 2 / ((g + 1) * rK), B = (g - 1) / (g + 1) * pK, s = Math.sqrt(A / (p + B));
      return [(p - pK) * s, s * (1 - (p - pK) / (2 * (B + p)))]; }
    const e = (g - 1) / (2 * g);
    return [2 * cK / (g - 1) * (Math.pow(p / pK, e) - 1), 1 / (rK * cK) * Math.pow(p / pK, -(g + 1) / (2 * g))];
  };
  let p = 0.5 * (pL + pR);
  for (let it = 0; it < 100; it++) { const a = fK(p, rL, pL, cL), b = fK(p, rR, pR, cR);
    const d = (a[0] + b[0] + uR - uL) / (a[1] + b[1]); const np = Math.max(1e-8, p - d); if (Math.abs(np - p) < 1e-12 * p) { p = np; break; } p = np; }
  const u = 0.5 * (uL + uR) + 0.5 * (fK(p, rR, pR, cR)[0] - fK(p, rL, pL, cL)[0]);
  const rsL = p > pL ? rL * ((p / pL + (g - 1) / (g + 1)) / ((g - 1) / (g + 1) * p / pL + 1)) : rL * Math.pow(p / pL, 1 / g);
  const rsR = p > pR ? rR * ((p / pR + (g - 1) / (g + 1)) / ((g - 1) / (g + 1) * p / pR + 1)) : rR * Math.pow(p / pR, 1 / g);
  const SR = p > pR ? uR + cR * Math.sqrt((g + 1) / (2 * g) * p / pR + (g - 1) / (2 * g)) : null;
  const csL = cL * Math.pow(p / pL, (g - 1) / (2 * g));
  const sample = xi => {                 // xi = x/t, left rarefaction / right shock case (Sod)
    if (xi <= uL - cL) return { r: rL, u: uL, p: pL };
    if (xi <= u - csL) { const uu = 2 / (g + 1) * (cL + (g - 1) / 2 * uL + xi), cc = 2 / (g + 1) * (cL + (g - 1) / 2 * (uL - xi));
      return { r: rL * Math.pow(cc / cL, 2 / (g - 1)), u: uu, p: pL * Math.pow(cc / cL, 2 * g / (g - 1)) }; }
    if (xi <= u) return { r: rsL, u, p };
    if (xi <= SR) return { r: rsR, u, p };
    return { r: rR, u: uR, p: pR };
  };
  return { p, u, rsL, rsR, SR, headL: uL - cL, tailL: u - csL, sample };
}

// ---------- a: Sod ----------
if (want('a')) {
  const rL = 1, pL = 1e5, rR = 0.125, pR = 1e4, x0 = 0.5, tEnd = 0.2 / Math.sqrt(pL / rL);
  const ex = exactRiemann(G, rL, 0, pL, rR, 0, pR);
  const out = { exact: { p: ex.p, u: ex.u, rhoL: ex.rsL, rhoR: ex.rsR, shock: ex.SR }, grids: [] };
  for (const n of [100, 200, 400, 800, 1600]) {
    const P = pipe(WS0, 1, 1 / n, () => 1e-3);
    setState(P, x => x < x0 ? { r: rL, u: 0, p: pL } : { r: rR, u: 0, p: pR });
    P.left = WS0.wallEnd(-1); P.right = WS0.wallEnd(+1);
    advance(WS0, [P], tEnd);
    let L1r = 0, L1p = 0, L1u = 0;
    for (let i = 0; i < P.n; i++) { const x = (i + 0.5) * P.dx, s = ex.sample((x - x0) / tEnd);
      L1r += Math.abs(P.r[i] - s.r) * P.dx; L1p += Math.abs(P.p[i] - s.p) * P.dx; L1u += Math.abs(P.u[i] - s.u) * P.dx; }
    // plateaus: mean over the middle of each exact plateau; shock and contact: where the density crosses half way
    const mean = (a, b, arr) => { let s = 0, k = 0; for (let i = 0; i < P.n; i++) { const x = (i + 0.5) * P.dx; if (x > a && x < b) { s += arr[i]; k++; } } return s / k; };
    const xc = x0 + ex.u * tEnd, xs = x0 + ex.SR * tEnd, xt = x0 + ex.tailL * tEnd;
    const pS = mean(xt + 0.25 * (xc - xt), xc - 0.25 * (xc - xt), P.p), uS = mean(xt + 0.25 * (xs - xt), xs - 0.1 * (xs - xc), P.u);
    const rhoS2 = mean(xc + 0.25 * (xs - xc), xs - 0.25 * (xs - xc), P.r), rhoS1 = mean(xt + 0.25 * (xc - xt), xc - 0.25 * (xc - xt), P.r);
    const cross = (lev, from, to) => { for (let i = 1; i < P.n; i++) { const xa = (i - 0.5) * P.dx, xb = (i + 0.5) * P.dx;
      if (xb < from || xa > to) continue; const a = P.r[i - 1] - lev, b = P.r[i] - lev; if (a * b <= 0 && a !== b) return xa + (xb - xa) * a / (a - b); } return NaN; };
    const xShock = cross(0.5 * (ex.rsR + rR), xc + 0.02, 1), xCont = cross(0.5 * (ex.rsL + ex.rsR), xt + 0.02, xs - 0.02);
    out.grids.push({ n, L1rho: L1r, L1p, L1u, pStar: pS, uStar: uS, rhoStarL: rhoS1, rhoStarR: rhoS2,
      shockSpeed: (xShock - x0) / tEnd, contactSpeed: (xCont - x0) / tEnd });
  }
  for (let k = 1; k < out.grids.length; k++) out.grids[k].orderRho = Math.log2(out.grids[k - 1].L1rho / out.grids[k].L1rho);
  results.a = out;
  const g4 = out.grids.find(g => g.n === 400);
  row('a Sod (400 cells)', 'p* plateau', g4.pStar, ex.p, 0.005, 'Pa');
  row('a Sod (400 cells)', 'u* plateau', g4.uStar, ex.u, 0.005, 'm/s');
  row('a Sod (400 cells)', 'rho* left of contact', g4.rhoStarL, ex.rsL, 0.005, 'kg/m3');
  row('a Sod (400 cells)', 'rho* right of contact', g4.rhoStarR, ex.rsR, 0.01, 'kg/m3');
  row('a Sod (400 cells)', 'shock speed', g4.shockSpeed, ex.SR, 0.005, 'm/s');
  row('a Sod (400 cells)', 'contact speed', g4.contactSpeed, ex.u, 0.01, 'm/s');
  row('a Sod (400 cells)', 'L1 density error / (rhoL - rhoR)', g4.L1rho / (rL - rR), null, null, '', 'page claims within 0.4 %');
  out.grids.slice(1).forEach(g => row('a Sod', 'L1(rho) order ' + (g.n / 2) + '->' + g.n, g.orderRho, null, (m) => m > 0.6 && m < 1.3, '', 'expected about 1 (discontinuities limit any scheme)'));
}

// ---------- b: acoustic modes ----------
// mode amplitude by projection on the mode shape; frequency from a least-squares phase fit, decay from the envelope
function modeRun(WS, opts) {
  const { L, dx, T0, n, kind, eps, periods } = opts;
  const c = Math.sqrt(G * R * T0), rho0 = PATM / (R * T0);
  const k = kind === 'cc' ? n * Math.PI / L : (2 * n - 1) * Math.PI / (2 * L);
  const f0 = k * c / (2 * Math.PI);
  const P = pipe(WS, L, dx, () => 1e-3, T0, T0);
  setState(P, x => { const pp = PATM * (1 + eps * Math.cos(k * x)); return { r: rho0 * Math.pow(pp / PATM, 1 / G), u: 0, p: pp }; });
  P.left = WS.wallEnd(-1); P.right = kind === 'cc' ? WS.wallEnd(+1) : WS.openEnd(+1, PATM, T0, 1);
  const ts = [], as = [];
  advance(WS, [P], periods / f0, 0.8, t => { let a = 0; for (let i = 0; i < P.n; i++) a += (P.p[i] - PATM) * Math.cos(k * (i + 0.5) * P.dx) * P.dx;
    ts.push(t); as.push(a * 2 / L); });
  // frequency: zero crossings (linear interpolation), mean period over the run
  const zc = []; for (let i = 1; i < as.length; i++) if (as[i - 1] > 0 && as[i] <= 0) zc.push(ts[i - 1] + (ts[i] - ts[i - 1]) * as[i - 1] / (as[i - 1] - as[i]));
  const fm = (zc.length - 1) / (zc[zc.length - 1] - zc[0]);
  // envelope: peak |a| in the first and the last period
  const per = 1 / f0, pk = (t0, t1) => { let m = 0; for (let i = 0; i < ts.length; i++) if (ts[i] >= t0 && ts[i] < t1) m = Math.max(m, Math.abs(as[i])); return m; };
  const a0 = PATM * eps, a1 = pk(ts[ts.length - 1] - per, ts[ts.length - 1] + 1);
  const lambda = 2 * Math.PI / k, dBperPeriod = 20 * Math.log10(a0 / a1) / (periods - 0.5);
  return { f0, fm, c, lambda, cellsPerLambda: lambda / dx, dBperWavelength: dBperPeriod, a0, aEnd: a1 };
}
if (want('b')) {
  const out = { cc: [], oc: [], cc700: [] };
  for (const n of [1, 2, 4, 8, 16]) out.cc.push(Object.assign({ n }, modeRun(WS0, { L: 1, dx: 0.01, T0: TATM, n, kind: 'cc', eps: 1e-3, periods: 20 })));
  for (const n of [1, 2, 4, 8, 16]) out.cc700.push(Object.assign({ n }, modeRun(WS0, { L: 1, dx: 0.01, T0: 700, n, kind: 'cc', eps: 1e-3, periods: 20 })));
  for (const n of [1, 2, 3, 5, 9]) out.oc.push(Object.assign({ n }, modeRun(WS0, { L: 1, dx: 0.01, T0: TATM, n, kind: 'oc', eps: 1e-3, periods: 20 })));
  // dissipation at a finer grid for the same wavelengths (does it fall like a second-order scheme's?)
  out.cc5 = [4, 8, 16].map(n => Object.assign({ n }, modeRun(WS0, { L: 1, dx: 0.005, T0: TATM, n, kind: 'cc', eps: 1e-3, periods: 20 })));
  results.b = out;
  // frequency to 0.2 % where the page's 10 mm cells give 25 or more per wavelength (to 2.1 kHz in a 700 K pipe); below
  // that the scheme's phase error is reported with its order of convergence from 10 to 5 mm instead
  out.cc.forEach(m => row('b closed-closed 1 m, 10 mm', 'mode ' + m.n + ' frequency', m.fm, m.f0, m.cellsPerLambda >= 25 ? 0.002 : null, 'Hz', m.cellsPerLambda.toFixed(1) + ' cells/wavelength'));
  out.cc5.forEach(m => row('b closed-closed 1 m, 5 mm', 'mode ' + m.n + ' frequency', m.fm, m.f0, m.cellsPerLambda >= 25 ? 0.002 : null, 'Hz', m.cellsPerLambda.toFixed(1) + ' cells/wavelength'));
  out.cc5.forEach(m => { const c = out.cc.find(q => q.n === m.n), e1 = Math.abs(c.fm / c.f0 - 1), e2 = Math.abs(m.fm / m.f0 - 1);
    // the order is only meaningful while the error is well above the measurement's floor (about 0.05 % here)
    row('b closed-closed 1 m', 'mode ' + m.n + ' frequency error order 10->5 mm', Math.log2(e1 / e2), null, mm => mm > 1.5 || (e1 < 1e-3 && e2 < 1e-3), '', 'second-order scheme: about 2, or both errors under 0.1 % (errors ' + (100 * e1).toFixed(3) + ' % and ' + (100 * e2).toFixed(3) + ' %)');
    const d1 = c.dBperWavelength, d2 = m.dBperWavelength;
    row('b closed-closed 1 m', 'mode ' + m.n + ' dissipation order 10->5 mm', Math.log2(d1 / d2), null, mm => mm > 1.5, '', 'second-order scheme: about 2 (' + d1.toFixed(4) + ' and ' + d2.toFixed(4) + ' dB/wavelength)'); });
  out.oc.forEach(m => row('b open-closed 1 m, 10 mm', 'mode ' + m.n + ' frequency', m.fm, m.f0, 0.003, 'Hz', 'vs (2n-1) c/4L, no end correction'));
  out.cc.forEach(m => row('b closed-closed 1 m, 10 mm', 'mode ' + m.n + ' decay', m.dBperWavelength, null, null, 'dB/wavelength', m.cellsPerLambda.toFixed(1) + ' cells/wavelength, ' + m.f0.toFixed(0) + ' Hz at 298 K, ' + (m.f0 * Math.sqrt(700 / TATM)).toFixed(0) + ' Hz at 700 K'));
  out.oc.forEach(m => row('b open-closed 1 m, 10 mm', 'mode ' + m.n + ' decay', m.dBperWavelength, null, null, 'dB/wavelength', 'includes the open end'));
  out.cc5.forEach(m => row('b closed-closed 1 m, 5 mm', 'mode ' + m.n + ' decay', m.dBperWavelength, null, null, 'dB/wavelength', m.cellsPerLambda.toFixed(1) + ' cells/wavelength'));
}

// closed ends over a long run: a closed-closed pipe's mode in an inviscid gas may only decay, and the gas's entropy may
// only rise (sum of m ln(p / rho^gamma)). Both ends as dead-end walls (wallEnd) and as closed valves (fedEnd with no flow,
// the end every intake runner and primary has while its valve is shut)
if (want('b')) {
  const out = [];
  for (const kind of ['wallEnd', 'closed valve']) for (const n of [1, 4]) for (const dx of [0.01, 0.005]) {
    const L = 1, eps = 1e-3, T0 = TATM, c = Math.sqrt(G * R * T0), rho0 = PATM / (R * T0), k = n * Math.PI / L, per = 2 * L / (n * c);
    const P = pipe(WS0, L, dx, () => 1e-3, T0, T0);
    setState(P, x => { const pp = PATM * (1 + eps * Math.cos(k * x)); return { r: rho0 * Math.pow(pp / PATM, 1 / G), u: 0, p: pp }; });
    const shut = () => ({ m: 0, h: 0, x: 1, uj: 0 });
    if (kind === 'wallEnd') { P.left = WS0.wallEnd(-1); P.right = WS0.wallEnd(+1); } else { P.left = WS0.fedEnd(-1, shut); P.right = WS0.fedEnd(+1, shut); }
    const amp = () => { let a = 0; for (let i = 0; i < P.n; i++) a += (P.p[i] - PATM) * Math.cos(k * (i + 0.5) * P.dx) * P.dx; return a * 2 / L; };
    const ent = () => { let e = 0; for (let i = 0; i < P.n; i++) e += P.q1[i] * P.dx * Math.log(P.p[i] / Math.pow(P.r[i], G)); return e; };
    WS0.prim(P); const a0 = amp(), s0 = ent(); let last = 0;
    advance(WS0, [P], 40 * per, 0.8, t => { if (t > 39 * per) last = Math.max(last, Math.abs(amp())); });
    const g = { kind, n, dx, ampRatio: last / a0, dS: ent() - s0 };
    out.push(g);
    row('b closed ends (' + kind + '), mode ' + n + ', ' + (1000 * dx) + ' mm', 'amplitude after 40 periods / initial', g.ampRatio, null, m => m <= 1, '', 'inviscid: may not grow');
    row('b closed ends (' + kind + '), mode ' + n + ', ' + (1000 * dx) + ' mm', 'entropy change / cv, sum of m ln(p/rho^gamma)', g.dS, null, m => m >= 0, 'kg', 'second law: may not fall');
  }
  results.bClosed = out;
}

// ---------- c: steady flow, area change ----------
function steady(WS, pipes, joins, tEnd) {
  advance(WS, pipes, tEnd, 0.8, null, joins);
  return pipes;
}
const stag = (r, u, p) => { const T = p / (R * r), T0 = T + 0.5 * u * u / CP; return { T, T0, p0: p * Math.pow(T0 / T, G / (G - 1)), s: CP * Math.log(T) - R * Math.log(p), M: Math.abs(u) / Math.sqrt(G * p / r) }; };
if (want('c')) {
  const out = {};
  // smooth cone 60 -> 40 mm over 0.6 m between 0.2 m straight lengths, fed from a reservoir at p0 = 1.15 bar, 300 K
  {
    const d = x => x < 0.2 ? 0.06 : x > 0.8 ? 0.04 : 0.06 - 0.02 * (x - 0.2) / 0.6, p0 = 1.15e5, T0 = 300;
    const P = pipe(WS0, 1, 0.01, x => Math.PI * d(x) ** 2 / 4, T0, T0);
    P.left = WS0.openEnd(-1, ramp(p0, 0.15), T0, 1); P.right = WS0.openEnd(+1, PATM, T0, 1);
    const f0 = []; advance(WS0, [P], 1.5, 0.8, () => { f0.push(P.f1[0]); if (f0.length > 4) f0.shift(); });
    const fl = Array.from(P.f1).slice(1, P.n), mMean = fl.reduce((a, b) => a + b, 0) / fl.length, mSpread = (Math.max(...fl) - Math.min(...fl)) / mMean;
    const inflowFlip = Math.abs(f0[3] - f0[2]) / mMean;
    const st = []; for (let i = 0; i < P.n; i++) st.push(stag(P.r[i], P.u[i], P.p[i]));
    const p0s = st.map(s => s.p0), Ae = Math.PI * 0.04 ** 2 / 4;
    // isentropic exit at the atmosphere's pressure
    const pr = PATM / p0, Me = Math.sqrt(2 / (G - 1) * (Math.pow(pr, -(G - 1) / G) - 1));
    const mIsen = Ae * p0 / Math.sqrt(R * T0) * Math.sqrt(G) * Me * Math.pow(1 + (G - 1) / 2 * Me * Me, -(G + 1) / (2 * (G - 1)));
    const T0exit = st[P.n - 1].T0;
    out.cone = { m: mMean, mSpread, inflowFlip, inflowFaceLast: f0.slice(2), T0exit, mIsen, p0min: Math.min(...p0s), p0max: Math.max(...p0s), Mexit: st[P.n - 1].M, MexitIsen: Me };
    row('c smooth cone 60->40 mm', 'mass flow vs isentropic', mMean, mIsen, 0.01, 'kg/s');
    row('c smooth cone 60->40 mm', 'mass flow spread over the interior faces', mSpread, null, m => m < 2e-3, '', 'steady: should be ~0');
    row('c smooth cone 60->40 mm', 'inflow end face flux change from one step to the next', inflowFlip, null, m => m < 1e-3, 'of the mass flow', 'steady: should be ~0 (last two: ' + f0.slice(2).map(v => v.toFixed(4)).join(', ') + ' kg/s)');
    row('c smooth cone 60->40 mm', 'exit stagnation temperature', T0exit, T0, 0.002, 'K', 'adiabatic, inviscid: = reservoir');
    row('c smooth cone 60->40 mm', 'stagnation pressure min/max along the pipe', (out.cone.p0max - out.cone.p0min) / p0, null, m => m < 0.005, 'of p0', 'inviscid: should be ~0');
  }
  // sudden area change 40 <-> 80 mm (area ratio 4) through the characteristic junction, 1 m each side
  for (const dir of ['expansion', 'contraction']) {
    const dA = dir === 'expansion' ? 0.04 : 0.08, dB = dir === 'expansion' ? 0.08 : 0.04, p0 = 1.08e5, T0 = 300;
    const a = pipe(WS0, 1, 0.01, () => Math.PI * dA * dA / 4, T0, T0), b = pipe(WS0, 1, 0.01, () => Math.PI * dB * dB / 4, T0, T0);
    a.left = WS0.openEnd(-1, ramp(p0, 0.15), T0, 1); a.right = () => {}; b.left = () => {}; b.right = WS0.openEnd(+1, PATM, T0, 1);
    steady(WS0, [a, b], () => WS0.junction(a, b), 0.8);
    const s1 = stag(a.r[a.n - 3], a.u[a.n - 3], a.p[a.n - 3]), s2 = stag(b.r[2], b.u[2], b.p[2]);
    const r1 = a.r[a.n - 3], u1 = a.u[a.n - 3], u2 = b.u[2], r2 = b.r[2];
    const m = a.f1[a.n], A1 = a.A[0], A2 = b.A[0];
    const q1 = 0.5 * r1 * u1 * u1, q2 = 0.5 * r2 * u2 * u2;
    const dp0 = s1.p0 - s2.p0;
    // references: Borda-Carnot for the expansion (incompressible form, on the upstream head); for the contraction the
    // ideal (isentropic) limit 0 and a measured-type loss 0.5 (1 - A2/A1) on the downstream head (Idelchik / Crane)
    let bc = dir === 'expansion' ? q1 * Math.pow(1 - A1 / A2, 2) : 0;
    // compressible Borda-Carnot: mass, momentum with the step face at the upstream pressure, and energy, solved for the
    // downstream state (subsonic branch, bisection on its speed)
    if (dir === 'expansion') { const p1 = a.p[a.n - 3], mf = r1 * u1 * A1, h0 = G / (G - 1) * p1 / r1 + 0.5 * u1 * u1;
      const res = v => { const p2 = p1 + (mf * u1 - mf * v) / A2, rr2 = mf / (v * A2); return G / (G - 1) * p2 / rr2 + 0.5 * v * v - h0; };
      let lo = 1e-3, hi = u1; for (let it = 0; it < 200; it++) { const mid = 0.5 * (lo + hi); if (res(lo) * res(mid) <= 0) hi = mid; else lo = mid; }
      const v2 = 0.5 * (lo + hi), p2 = p1 + (mf * u1 - mf * v2) / A2, rr2 = mf / (v2 * A2);
      bc = s1.p0 - stag(rr2, v2, p2).p0; }
    const cpJ = q1 - q2;            // what a junction holding one static pressure on both sides gives (h0 conserved)
    out[dir] = { m, M1: s1.M, M2: s2.M, p1: a.p[a.n - 3], p2: b.p[2], dp0, q1, q2, bordaCarnot: bc, equalPressureLoss: cpJ, ds: s2.s - s1.s,
      contractionK05: dir === 'contraction' ? 0.5 * (1 - A2 / A1) * q2 : null };
    if (dir === 'expansion') row('c sudden expansion 4:1', 'stagnation-pressure loss vs compressible Borda-Carnot', dp0, bc, 0.03, 'Pa', 'one static pressure on both sides would give ' + cpJ.toFixed(1) + ' Pa; inlet Mach ' + s1.M.toFixed(2));
    else row('c sudden contraction 4:1', 'stagnation-pressure loss', dp0, null, mm => mm >= -1e-6 * p0, 'Pa', 'may not be negative; isentropic ideal 0, a sharp-edged entry measures about K = 0.5 (1 - A2/A1) = ' + (0.5 * (1 - A2 / A1) * q2).toFixed(0) + ' Pa on the downstream head; one static pressure on both sides would give ' + cpJ.toFixed(1) + ' Pa');
    { const Ae = Math.PI * (dir === 'expansion' ? 0.08 : 0.04) ** 2 / 4, pe = PATM / p0, Me = Math.sqrt(2 / (G - 1) * (Math.pow(pe, -(G - 1) / G) - 1));
      const mI = Ae * p0 / Math.sqrt(R * T0) * Math.sqrt(G) * Me * Math.pow(1 + (G - 1) / 2 * Me * Me, -(G + 1) / (2 * (G - 1)));
      out[dir].mIsentropic = mI;
      if (dir === 'contraction') row('c sudden ' + dir + ' 4:1', 'mass flow vs the isentropic (lossless) upper limit', m, mI, (mm, ref) => mm <= ref * 1.002, 'kg/s', 'no loss model may pass more than this; downstream Mach ' + s2.M.toFixed(2)); }
    row('c sudden ' + dir + ' 4:1', 'entropy change across the step', s2.s - s1.s, null, mm => mm >= -1e-3, 'J/kg/K', 'second law: must be >= 0');
    row('c sudden ' + dir + ' 4:1', 'static pressure step p2 - p1', b.p[2] - a.p[a.n - 3], null, null, 'Pa', 'Borda-Carnot recovery would be ' + (dir === 'expansion' ? (2 * q1 * (A1 / A2) * (1 - A1 / A2)).toFixed(1) : '-') + ' Pa');
  }
  // steady flow fed INTO a pipe through a valve-type end (fedEnd, 0.05 kg/s of 300 K gas into 40 mm, open far end): the
  // end face's pressure must be the gas's own pressure there (a steady stream has no wave at its end)
  {
    const A = Math.PI * 0.04 ** 2 / 4, mdot = 0.05, T0 = 300, P = pipe(WS0, 1, 0.01, () => A, T0, T0);
    const u0 = mdot / (PATM / (R * T0) * A), src = { m: mdot, h: CP * T0, x: 1, uj: u0 };
    P.left = WS0.fedEnd(-1, () => { src.uj = P.u[0]; return src; }); P.right = WS0.openEnd(+1, PATM, T0, 1);
    advance(WS0, [P], 0.5);
    const pFace = (P.f2[0] - P.f1[0] * src.uj) / P.Af[0], dyn = P.r[0] * Math.sqrt(G * P.p[0] / P.r[0]) * P.u[0];
    out.fedIn = { pFace, pCell: P.p[0], u: P.u[0], rhoCU: dyn };
    row('c steady inflow through a valve end', 'face pressure - end cell pressure', pFace - P.p[0], null, mm => Math.abs(mm) < 0.05 * dyn, 'Pa',
      'steady: about 0 (rho c u here ' + dyn.toFixed(0) + ' Pa, u ' + P.u[0].toFixed(1) + ' m/s)');
  }
  results.c = out;
}

// ---------- d: open end ----------
if (want('d')) {
  const out = {};
  // a right-running Gaussian pulse in a 6 m pipe, open at the right end (still air), probe 1.5 m before the end
  for (const [label, amp, T0, dpipe] of [['+100 Pa, 298 K', 1e-3, TATM, 0.05], ['-100 Pa, 298 K', -1e-3, TATM, 0.05], ['+100 Pa, 700 K', 1e-3, 700, 0.05], ['+10 kPa, 298 K', 0.1, TATM, 0.05], ['-10 kPa, 298 K', -0.1, TATM, 0.05]]) {
    const L = 6, dx = 0.01, c = Math.sqrt(G * R * T0), rho0 = PATM / (R * T0), sg = 0.04, xc = 3;
    const P = pipe(WS0, L, dx, () => Math.PI * dpipe * dpipe / 4, T0, T0);
    setState(P, x => { const pp = PATM * (1 + amp * Math.exp(-0.5 * ((x - xc) / sg) ** 2));
      const r = rho0 * Math.pow(pp / PATM, 1 / G), cc = Math.sqrt(G * pp / r); return { r, u: 2 / (G - 1) * (cc - c), p: pp }; });   // simple wave
    P.left = WS0.wallEnd(-1); P.right = WS0.openEnd(+1, PATM, T0, 1);
    const ip = 449, xp = (ip + 0.5) * dx, ts = [], ps = [];     // the probe is a cell centre; its own position is used below
    advance(WS0, [P], (L - xc + 1.2) / c * 1.0 + 0.6 / c, 0.8, t => { ts.push(t); ps.push(P.p[ip] - PATM); });
    // incident: the first lobe; reflected: after the pulse has been to the end and back
    const tRet = (xp - xc) / c + 2 * (L - xp) / c, split = 0.5 * ((xp - xc) / c + tRet);
    let inc = 0, ref = 0; for (let i = 0; i < ts.length; i++) { if (ts[i] < split) { if (Math.abs(ps[i]) > Math.abs(inc)) inc = ps[i]; } else if (Math.abs(ps[i]) > Math.abs(ref)) ref = ps[i]; }
    // frequency domain: DFT of each window, R(f) = P_ref/P_inc with the 2 (L - xp) travel removed, end correction from the phase
    const dft = (f, lo, hi) => { let re = 0, im = 0; for (let i = 1; i < ts.length; i++) { if (ts[i] < lo || ts[i] >= hi) continue; const dt = ts[i] - ts[i - 1];
      re += ps[i] * Math.cos(2 * Math.PI * f * ts[i]) * dt; im -= ps[i] * Math.sin(2 * Math.PI * f * ts[i]) * dt; } return [re, im]; };
    const fr = [];
    for (const f of [100, 250, 500, 1000]) {
      const a = dft(f, 0, split), b = dft(f, split, 1e9), k = 2 * Math.PI * f / c;
      const mag = Math.hypot(b[0], b[1]) / Math.hypot(a[0], a[1]);
      let ph = Math.atan2(b[1], b[0]) - Math.atan2(a[1], a[0]) + 2 * k * (L - xp);   // phase of R at the end face
      ph = ((ph % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;              // in (-pi, pi], -1 is +/-pi
      const rel = ph > 0 ? ph - Math.PI : ph + Math.PI;                                  // phase relative to -1
      fr.push({ f, mag, delta: -rel / (2 * k), deltaOverR: -rel / (2 * k) / (dpipe / 2) });
    }
    out[label] = { peakRatio: ref / inc, inc, ref, fr };
    row('d open end, ' + label + ', 50 mm, 10 mm cells', 'reflection, peak ratio (Gaussian pulse, sigma 40 mm)', ref / inc, null, null, '', 'page Method text: about -0.96');
    fr.forEach(q => row('d open end, ' + label + ', 50 mm, 10 mm cells', '|R| at ' + q.f + ' Hz', q.mag, 1, q.f <= 250 && Math.abs(amp) < 0.01 ? 0.02 : null, '',
      'effective end position ' + (1000 * q.delta).toFixed(2) + ' mm past the pipe end (' + q.deltaOverR.toFixed(3) + ' r; radiation end correction, unflanged: 0.6133 r = 15.3 mm)'));
  }
  // the same +100 Pa pulse on finer cells: how much of the fall of |R| with frequency is the scheme's dissipation over
  // the 3 m travel to the end and back, not the end (an ideal pressure-release end has |R| = 1 at every frequency)
  out.grid = [];
  for (const dx of [0.01, 0.005, 0.0025]) {
    const L = 6, T0 = TATM, c = Math.sqrt(G * R * T0), rho0 = PATM / (R * T0), sg = 0.04, xc = 3, amp = 1e-3;
    const P = pipe(WS0, L, dx, () => Math.PI * 0.05 * 0.05 / 4, T0, T0);
    setState(P, x => { const pp = PATM * (1 + amp * Math.exp(-0.5 * ((x - xc) / sg) ** 2));
      const r = rho0 * Math.pow(pp / PATM, 1 / G), cc = Math.sqrt(G * pp / r); return { r, u: 2 / (G - 1) * (cc - c), p: pp }; });
    P.left = WS0.wallEnd(-1); P.right = WS0.openEnd(+1, PATM, T0, 1);
    const ip = Math.round(4.495 / dx - 0.5), xp = (ip + 0.5) * dx, ts = [], ps = [];
    advance(WS0, [P], (L - xc + 1.2) / c + 0.6 / c, 0.8, t => { ts.push(t); ps.push(P.p[ip] - PATM); });
    const tRet = (xp - xc) / c + 2 * (L - xp) / c, split = 0.5 * ((xp - xc) / c + tRet);
    const dft = (f, lo, hi) => { let re = 0, im = 0; for (let i = 1; i < ts.length; i++) { if (ts[i] < lo || ts[i] >= hi) continue; const d = ts[i] - ts[i - 1];
      re += ps[i] * Math.cos(2 * Math.PI * f * ts[i]) * d; im -= ps[i] * Math.sin(2 * Math.PI * f * ts[i]) * d; } return [re, im]; };
    const g = { dx };
    for (const f of [500, 1000]) { const a = dft(f, 0, split), b = dft(f, split, 1e9); g['R' + f] = Math.hypot(b[0], b[1]) / Math.hypot(a[0], a[1]); }
    out.grid.push(g);
    row('d open end, +100 Pa, 298 K, 50 mm, ' + (1000 * dx) + ' mm cells', '|R| at 1000 Hz', g.R1000, null, null, '', '|R| at 500 Hz ' + g.R500.toFixed(4) + '; the loss falls with the cell size, so it is the travel, not the end');
  }
  // choked outflow: reservoir at 3 bar, 300 K, through a 1 m, 40 mm pipe to the atmosphere
  {
    const p0 = 3e5, T0 = 300, A = Math.PI * 0.04 ** 2 / 4;
    const P = pipe(WS0, 1, 0.01, () => A, T0, T0);
    setState(P, () => ({ r: PATM / (R * T0), u: 0, p: PATM }));
    P.left = WS0.openEnd(-1, ramp(p0, 0.05), T0, 1); P.right = WS0.openEnd(+1, PATM, T0, 1);
    advance(WS0, [P], 0.3);
    const PSIC = Math.sqrt(G) * Math.pow(2 / (G + 1), (G + 1) / (2 * (G - 1)));
    const mTh = A * Math.sqrt(p0 * p0 / (R * T0)) * PSIC, m = P.f1[P.n], st = stag(P.r[P.n - 1], P.u[P.n - 1], P.p[P.n - 1]);
    out.choked = { m, mTh, Mexit: st.M, pExit: P.p[P.n - 1], pCrit: p0 * Math.pow(2 / (G + 1), G / (G - 1)) };
    row('d choked outflow 3 bar', 'mass flow vs isentropic choked A p0 psi*/sqrt(R T0)', m, mTh, 0.01, 'kg/s');
    row('d choked outflow 3 bar', 'exit Mach number', st.M, 1, 0.03);
    row('d choked outflow 3 bar', 'exit static pressure vs critical', P.p[P.n - 1], out.choked.pCrit, 0.03, 'Pa');
  }
  results.d = out;
}

// ---------- e: friction and wall heat transfer ----------
if (want('e')) {
  const out = {};
  const mu = T => 1.458e-6 * Math.pow(T, 1.5) / (T + 110.4), k_ = T => mu(T) * CP / 0.709;   // Sutherland air, Pr 0.709
  // friction: reservoir 1.05 bar, 300 K, wall at the gas temperature, 4 m of 40 mm pipe
  {
    const D = 0.04, T0 = 300, P = pipe(WSF, 4, 0.01, () => Math.PI * D * D / 4, T0, 298);
    P.left = WSF.openEnd(-1, 1.05e5, T0, 1); P.right = WSF.openEnd(+1, PATM, T0, 1);
    advance(WSF, [P], 0.6);
    const i1 = Math.round(1.5 / 0.01), i2 = Math.round(2.5 / 0.01);
    const dpdx = (P.p[i2] - P.p[i1]) / (1.0), r = 0.5 * (P.r[i1] + P.r[i2]), u = 0.5 * (P.u[i1] + P.u[i2]), T = P.p[i1] / (R * P.r[i1]);
    // the momentum balance of a steady pipe also has the acceleration term d(rho u^2)/dx; take it out
    const acc = (P.r[i2] * P.u[i2] ** 2 - P.r[i1] * P.u[i1] ** 2) / 1.0;
    const fricGrad = -(dpdx + acc);
    const darcyModel = 4 * 0.005, model = darcyModel / D * 0.5 * r * u * u;
    const Re = r * u * D / mu(T), blasius = 0.316 / Math.pow(Re, 0.25);
    const colebrook = (() => { let f = 0.02; for (let it = 0; it < 50; it++) f = Math.pow(-2 * Math.log10(0.02e-3 / (3.7 * D) + 2.51 / (Re * Math.sqrt(f))), -2); return f; })();
    out.friction = { u, Re, fricGrad, model, darcyMeasured: fricGrad * D / (0.5 * r * u * u), darcyModel, blasius, colebrook };
    row('e friction 40 mm, ' + u.toFixed(0) + ' m/s, Re ' + Re.toExponential(2), 'Darcy factor from the pressure gradient', out.friction.darcyMeasured, darcyModel, 0.03, '', 'the model states Fanning 0.005 (Darcy 0.02); Blasius ' + blasius.toFixed(4) + ', Colebrook (0.02 mm, OpenWAM default roughness) ' + colebrook.toFixed(4));
  }
  // heat transfer: hot gas (700 K reservoir) through 4 m of 40 mm pipe with the wall at 400 K
  {
    const D = 0.04, T0 = 700, Tw = 400, P = pipe(WSF, 4, 0.01, () => Math.PI * D * D / 4, T0, Tw);
    P.left = WSF.openEnd(-1, 1.05e5, T0, 1); P.right = WSF.openEnd(+1, PATM, T0, 1);
    advance(WSF, [P], 0.6);
    const i1 = Math.round(1.0 / 0.01), i2 = Math.round(3.0 / 0.01), s1 = stag(P.r[i1], P.u[i1], P.p[i1]), s2 = stag(P.r[i2], P.u[i2], P.p[i2]);
    // steady energy balance: m cp dT0/dx = h pi D (Tw - T)  ->  St = h / (rho u cp) = D/4 * ln((T01-Tw)/(T02-Tw)) / dx (with T ~ T0)
    const u = 0.5 * (P.u[i1] + P.u[i2]), r = 0.5 * (P.r[i1] + P.r[i2]), Tm = 0.5 * (s1.T + s2.T);
    const St = D / 4 * Math.log((s1.T - Tw) / (s2.T - Tw)) / 2.0 * (1 + 0) ;
    const Re = r * u * D / mu(Tm), Pr = 0.709;
    const db = 0.023 * Math.pow(Re, 0.8) * Math.pow(Pr, 0.3) / (Re * Pr), dep = 0.0694 * Math.pow(Re, 0.75) / (Re * Pr);
    out.heat = { u, Re, St, StModel: 0.005 / 2, dittusBoelter: db, depcikAssanis: dep };
    row('e heat transfer 700 K gas, 400 K wall, Re ' + Re.toExponential(2), 'Stanton number', St, 0.0025, 0.03, '', 'model: Reynolds analogy St = f/2 = 0.0025; Dittus-Boelter (cooling) ' + db.toFixed(5) + ', Depcik-Assanis (OpenWAM intake) ' + dep.toFixed(5));
  }
  results.e = out;
}

const dir = path.join(__dirname, 'results'); fs.mkdirSync(dir, { recursive: true });
let prev = {}; try { prev = JSON.parse(fs.readFileSync(path.join(dir, 'kat.json'), 'utf8')); } catch (e) {}
const keep = (prev.table || []).filter(r => !table.some(q => q.test.split(' ')[0] === r.test.split(' ')[0]));
fs.writeFileSync(path.join(dir, 'kat.json'), JSON.stringify({ page: require('./lib').PAGE.replace(require('./lib').ROOT + path.sep, ''), results: Object.assign(prev.results || {}, results), table: keep.concat(table) }, null, 1));
const nf = table.filter(r => r.pass === false).length;
console.log(nf ? nf + ' known-answer check(s) failed (candidate defects; see the doc)' : 'all known-answer checks passed');
