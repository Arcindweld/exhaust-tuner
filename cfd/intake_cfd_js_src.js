/* intake_cfd.js -- browser port of the file-writing part of intake_cfd.py
 * (OpenFOAM v2412 case generator for engine intake tracts).
 *
 * Covers the 2-D axisymmetric blockMesh path completely: given the same design
 * dictionary it writes the same bytes as `python3 intake_cfd.py design.json case`
 * (checked by cfd_js_vs_py.js).  For 3-D designs (a bend, force_3d or an STL)
 * it writes design.json, a README and a copy of intake_cfd.py, so the case can
 * be generated on any machine with Python 3.
 *
 * Python-compatible number formatting (printf %g/%f/%e, repr(), json.dumps,
 * round(), sum() with Neumaier compensation, math.hypot) is implemented
 * explicitly so the output is byte-identical.  Built by build_intake_cfd_js.py,
 * which splices intake_report.py, README_WINDOWS.md and the Python source in.
 */
(function (root) {
  'use strict';
  const GENERATOR = "intake_cfd.py", VERSION = "1.1.0", FOAM_VERSION = "v2412";

  // ------------------------------------------------------------------ Python number formatting
  const DV = new DataView(new ArrayBuffer(8));
  function signBit(x) { DV.setFloat64(0, x); return (DV.getUint32(0) >>> 31) === 1; }
  function decompose(x) {            // |x| finite, > 0  ->  x = m * 2^e  (m BigInt)
    DV.setFloat64(0, Math.abs(x));
    const hi = DV.getUint32(0), lo = DV.getUint32(4), exp = (hi >>> 20) & 0x7ff;
    let m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo), e;
    if (exp === 0) e = -1074; else { m |= (1n << 52n); e = exp - 1075; }
    return { m, e };
  }
  const POW5 = [1n]; function pow5(k) { while (POW5.length <= k) POW5.push(POW5[POW5.length - 1] * 5n); return POW5[k]; }
  function exactDigits(x) {          // |x| > 0 -> {D, frac}: |x| = D * 10^-frac exactly (D decimal string)
    const { m, e } = decompose(x);
    if (e >= 0) return { D: (m << BigInt(e)).toString(), frac: 0 };
    return { D: (m * pow5(-e)).toString(), frac: -e };
  }
  function roundDigits(D, cut) {     // drop the last `cut` digits of integer string D, round half to even
    if (cut <= 0) return D + '0'.repeat(-cut);
    let keep = D.length > cut ? D.slice(0, D.length - cut) : '0';
    const dropped = D.length > cut ? D.slice(D.length - cut) : D.padStart(cut, '0');
    const half = '5' + '0'.repeat(cut - 1);
    let up = dropped > half ? true : dropped < half ? false : ((keep.charCodeAt(keep.length - 1) - 48) % 2 === 1);
    if (up) keep = (BigInt(keep) + 1n).toString();
    return keep.replace(/^0+(?=\d)/, '');
  }
  function fmtF(x, p) {              // Python '%.{p}f'
    if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : (x < 0 ? '-inf' : 'inf');
    const neg = signBit(x);
    let N;
    if (x === 0) N = '0'; else { const { D, frac } = exactDigits(x); N = roundDigits(D, frac - p); }
    N = N.padStart(p + 1, '0');
    const ip = N.slice(0, N.length - p) || '0', fp = p > 0 ? '.' + N.slice(N.length - p) : '';
    return (neg ? '-' : '') + ip + fp;
  }
  function expParts(x, sig) {        // round |x|>0 to `sig` significant digits -> {digits, ex} (digits.length === sig)
    const { D, frac } = exactDigits(x);
    let ex = D.length - 1 - frac, N = roundDigits(D, D.length - sig);
    if (N.length > sig) { ex += 1; N = N.slice(0, sig); }
    return { digits: N, ex };
  }
  function fmtE(x, p) {              // Python '%.{p}e'
    if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : (x < 0 ? '-inf' : 'inf');
    const neg = signBit(x);
    let digits, ex;
    if (x === 0) { digits = '0'.repeat(p + 1); ex = 0; } else ({ digits, ex } = expParts(x, p + 1));
    const mant = digits[0] + (p > 0 ? '.' + digits.slice(1) : '');
    return (neg ? '-' : '') + mant + 'e' + (ex < 0 ? '-' : '+') + String(Math.abs(ex)).padStart(2, '0');
  }
  function stripZeros(s) { return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s; }
  function fmtG(x, p) {              // Python '%.{p}g'
    if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : (x < 0 ? '-inf' : 'inf');
    if (p === 0) p = 1;
    const neg = signBit(x);
    if (x === 0) return (neg ? '-' : '') + '0';
    const { digits, ex } = expParts(x, p);
    if (ex >= -4 && ex < p) {
      return (neg ? '-' : '') + stripZeros(fmtF(Math.abs(x), p - 1 - ex));
    }
    const mant = stripZeros(digits[0] + (p > 1 ? '.' + digits.slice(1) : ''));
    return (neg ? '-' : '') + mant + 'e' + (ex < 0 ? '-' : '+') + String(Math.abs(ex)).padStart(2, '0');
  }
  function pyrepr(x) {               // repr(float)
    if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : (x < 0 ? '-inf' : 'inf');
    if (x === 0) return signBit(x) ? '-0.0' : '0.0';
    const neg = x < 0; x = Math.abs(x);
    const m = x.toExponential().match(/^(\d)(?:\.(\d+))?e([+-]\d+)$/);
    const digits = m[1] + (m[2] || ''), decpt = parseInt(m[3], 10) + 1;
    let s;
    if (decpt <= -4 || decpt > 16) {
      s = digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (decpt - 1 < 0 ? '-' : '+') + String(Math.abs(decpt - 1)).padStart(2, '0');
    } else if (decpt <= 0) s = '0.' + '0'.repeat(-decpt) + digits;
    else if (decpt < digits.length) s = digits.slice(0, decpt) + '.' + digits.slice(decpt);
    else s = digits + '0'.repeat(decpt - digits.length) + '.0';
    return (neg ? '-' : '') + s;
  }
  // printf-style '%' formatting with Python semantics for the conversions used by the generator
  function pf(fmt) {
    const args = Array.prototype.slice.call(arguments, 1); let i = 0;
    return fmt.replace(/%(%|([-+ 0]*)(\d+)?(?:\.(\d+))?([sdgfe]))/g, function (all, pct, flags, width, prec, conv) {
      if (pct === '%') return '%';
      const a = args[i++]; let s;
      if (conv === 's') s = String(a);
      else if (conv === 'd') s = String(Math.trunc(Number(a)));
      else {
        const p = prec === undefined ? 6 : parseInt(prec, 10), v = Number(a);
        s = conv === 'g' ? fmtG(v, p) : conv === 'f' ? fmtF(v, p) : fmtE(v, p);
        if (flags.indexOf('+') >= 0 && s[0] !== '-') s = '+' + s;
      }
      if (width) { const w = parseInt(width, 10); if (s.length < w) s = (flags.indexOf('-') >= 0) ? s + ' '.repeat(w - s.length) : ' '.repeat(w - s.length) + s; }
      return s;
    });
  }
  // json.dumps(obj, indent=2): numbers are Python floats unless wrapped in PyInt
  class PyInt { constructor(n) { this.n = n; } }
  const I = n => new PyInt(n);
  function pyjson(v, ind) {
    ind = ind || 0; const pad = ' '.repeat(ind + 2), pad0 = ' '.repeat(ind);
    if (v === null || v === undefined) return 'null';
    if (v instanceof PyInt) return String(v.n);
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return pyrepr(v);
    if (typeof v === 'string') return pystr(v);
    if (Array.isArray(v)) return v.length ? '[\n' + v.map(x => pad + pyjson(x, ind + 2)).join(',\n') + '\n' + pad0 + ']' : '[]';
    const ks = Object.keys(v); if (!ks.length) return '{}';
    return '{\n' + ks.map(k => pad + pystr(k) + ': ' + pyjson(v[k], ind + 2)).join(',\n') + '\n' + pad0 + '}';
  }
  function pystr(s) {                // json string with ensure_ascii=True
    let o = '"';
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (ch === '"') o += '\\"'; else if (ch === '\\') o += '\\\\'; else if (ch === '\n') o += '\\n'; else if (ch === '\r') o += '\\r';
      else if (ch === '\t') o += '\\t'; else if (ch === '\b') o += '\\b'; else if (ch === '\f') o += '\\f';
      else if (c < 0x20 || c > 0x7e) {
        if (c > 0xffff) { const u = c - 0x10000; o += '\\u' + (0xd800 + (u >> 10)).toString(16).padStart(4, '0') + '\\u' + (0xdc00 + (u & 0x3ff)).toString(16).padStart(4, '0'); }
        else o += '\\u' + c.toString(16).padStart(4, '0');
      } else o += ch;
    }
    return o + '"';
  }
  // Re-serialise a JSON text the way Python's json.load + json.dumps(indent=2) would (keeps int/float spelling)
  function pyjsonRoundtrip(text) {
    let i = 0;
    const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
    function val() {
      ws(); const c = text[i];
      if (c === '{') { i++; const o = {}; ws(); if (text[i] === '}') { i++; return o; }
        for (;;) { ws(); const k = str(); ws(); i++; o[k] = val(); ws(); if (text[i] === ',') { i++; continue; } i++; return o; } }
      if (c === '[') { i++; const a = []; ws(); if (text[i] === ']') { i++; return a; }
        for (;;) { a.push(val()); ws(); if (text[i] === ',') { i++; continue; } i++; return a; } }
      if (c === '"') return str();
      if (text.startsWith('true', i)) { i += 4; return true; } if (text.startsWith('false', i)) { i += 5; return false; }
      if (text.startsWith('null', i)) { i += 4; return null; }
      const m = text.slice(i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/); i += m[0].length;
      return (m[1] || m[2]) ? parseFloat(m[0]) : I(parseInt(m[0], 10));
    }
    function str() { let o = ''; i++; while (text[i] !== '"') { if (text[i] === '\\') { const n = text[i + 1]; i += 2;
          if (n === 'u') { o += String.fromCharCode(parseInt(text.substr(i, 4), 16)); i += 4; }
          else o += { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' }[n]; } else o += text[i++]; } i++; return o; }
    return pyjson(val());
  }
  // sum() of floats in CPython >= 3.12 (Neumaier compensation); round() half to even; math.hypot (3.13 algorithm)
  function pysum(arr) {
    let f = 0, c = 0, first = true;
    for (const x of arr) { if (first) { f = 0 + x; first = false; continue; } const t = f + x; if (Math.abs(f) >= Math.abs(x)) c += (f - t) + x; else c += (x - t) + f; f = t; }
    if (c !== 0 && Number.isFinite(c)) f += c;
    return f;
  }
  function pyround(x) { if (Math.abs(x - Math.trunc(x)) === 0.5) return 2 * Math.round(x / 2); return Math.round(x); }
  function frexpExp(x) { DV.setFloat64(0, x); const e = (DV.getUint32(0) >>> 20) & 0x7ff; return e === 0 ? -1022 : e - 1022; }   // normal x only
  function dlMul(x, y) {             // Dekker exact product -> [hi, lo]
    const z = x * y, C = 134217729; // 2^27 + 1
    let t = C * x; const xh = t - (t - x), xl = x - xh; t = C * y; const yh = t - (t - y), yl = y - yh;
    const zz = ((xh * yh - z) + xh * yl + xl * yh) + xl * yl;
    return [z, zz];
  }
  function pyhypot(a, b) {
    const ax = Math.abs(a), bx = Math.abs(b), max = Math.max(ax, bx);
    if (!Number.isFinite(ax) || !Number.isFinite(bx)) return (ax === Infinity || bx === Infinity) ? Infinity : NaN;
    if (max === 0) return max;
    const me = frexpExp(max), scale = Math.pow(2, -me);
    let csum = 1, frac1 = 0, frac2 = 0;
    for (const v of [ax, bx]) { const x = v * scale, pr = dlMul(x, x); const sh = csum + pr[0], sl = (csum - sh) + pr[0]; csum = sh; frac1 += pr[1]; frac2 += sl; }
    let h = Math.sqrt(csum - 1 + (frac1 + frac2));
    const pr = dlMul(-h, h); const sh = csum + pr[0], sl = (csum - sh) + pr[0]; csum = sh; frac1 += pr[1]; frac2 += sl;
    const x = csum - 1 + (frac1 + frac2);
    h += x / (2 * h);
    return h / scale;
  }
  const radians = d => d * (Math.PI / 180.0), degrees = r => r * (180.0 / Math.PI);
  const range = n => Array.from({ length: Math.max(0, n) }, (_, i) => i);
  const pymin = (...a) => a.reduce((m, x) => x < m ? x : m), pymax = (...a) => a.reduce((m, x) => x > m ? x : m);
  const lstrip_n = s => s.replace(/^\n+/, ''), rstrip = s => s.replace(/\s+$/, '');

  // ------------------------------------------------------------------ constants
  const R_UNIV = 8.314462618, M_AIR = 28.9647e-3, R_AIR = R_UNIV / M_AIR, CP_AIR = 1004.5, GAMMA = CP_AIR / (CP_AIR - R_AIR);
  const SUTH_AS = 1.458e-6, SUTH_TS = 110.4, PR_T = 0.85, MACH_COMPRESSIBLE = 0.20, MACH_TRANSONIC = 0.60;
  const MESH_LEVELS = {
    coarse: { q_r: 1.15, core: 1 / 12., q_up: 1.18, far: 1 / 10., entry: 1 / 50., q_ax: 1.12, tube: 1 / 10., bell: 1 / 50., q_cap: 1.15, out: 1 / 4., level3d: 2, bg3d: 2.0 },
    medium: { q_r: 1.10, core: 1 / 18., q_up: 1.13, far: 1 / 14., entry: 1 / 75., q_ax: 1.08, tube: 1 / 15., bell: 1 / 75., q_cap: 1.10, out: 1 / 6., level3d: 3, bg3d: 2.0 },
    fine: { q_r: 1.07, core: 1 / 27., q_up: 1.09, far: 1 / 20., entry: 1 / 110., q_ax: 1.055, tube: 1 / 22., bell: 1 / 110., q_cap: 1.07, out: 1 / 9., level3d: 3, bg3d: 3.0 },
  };
  const SECTOR_HALF_ANGLE_DEG = 2.5, RAMP_ITER = 300;   // 2-D sector: sides are a rotational cyclic pair, not wedge patches (see intake_cfd.py)
  class DesignError extends Error { constructor(m) { super(m); this.name = 'DesignError'; } }

  // ------------------------------------------------------------------ small math helpers
  function mu_air(T) { return SUTH_AS * Math.sqrt(T) / (1.0 + SUTH_TS / T); }
  function ideal_mass_flux(p0, T0, p) {
    const g = GAMMA, pr_crit = Math.pow(2.0 / (g + 1.0), g / (g - 1.0));
    const pr = pymax(pymin(p / p0, 1.0), pr_crit);
    return p0 * Math.sqrt(2.0 * g / ((g - 1.0) * R_AIR * T0)) * Math.pow(pr, 1.0 / g) * Math.sqrt(pymax(0.0, 1.0 - Math.pow(pr, (g - 1.0) / g)));
  }
  function mach_from_mass_flux(G, p0, T0) {
    const g = GAMMA;
    const flux = M => p0 * Math.sqrt(g / (R_AIR * T0)) * M * Math.pow(1 + 0.5 * (g - 1) * M * M, -(g + 1) / (2 * (g - 1)));
    if (G >= flux(1.0)) throw new DesignError(pf("requested mass flow exceeds the choked (sonic) limit of the smallest cross-section (%.1f kg/s/m^2 > %.1f)", G, flux(1.0)));
    let lo = 0.0, hi = 1.0;
    for (let k = 0; k < 80; k++) { const mid = 0.5 * (lo + hi); if (flux(mid) < G) lo = mid; else hi = mid; }
    return 0.5 * (lo + hi);
  }
  function friction_factor_haaland(Re, rel_rough) {
    rel_rough = rel_rough || 0.0;
    if (Re < 2300) return 64.0 / pymax(Re, 1.0);
    return Math.pow(-1.8 * Math.log10(Math.pow(rel_rough / 3.7, 1.11) + 6.9 / Re), -2);
  }
  function friction_factor_colebrook(Re, rel_rough) {
    rel_rough = rel_rough || 0.0;
    if (Re < 2300) return 64.0 / pymax(Re, 1.0);
    let f = friction_factor_haaland(Re, rel_rough);
    for (let k = 0; k < 60; k++) f = Math.pow(-2.0 * Math.log10(rel_rough / 3.7 + 2.51 / (Re * Math.sqrt(f))), -2);
    return f;
  }
  function _solve_ratio(L, n, h1) {
    if (n <= 1) return 1.0;
    if (Math.abs(L - n * h1) < 1e-12 * L) return 1.0;
    const S = r => Math.abs(r - 1) < 1e-12 ? n * h1 : h1 * (Math.pow(r, n) - 1) / (r - 1);
    let lo, hi;
    if (L > n * h1) { lo = 1.0; hi = 2.0; while (S(hi) < L) hi *= 1.5; } else { lo = 1e-6; hi = 1.0; }
    for (let k = 0; k < 200; k++) { const mid = 0.5 * (lo + hi); if (S(mid) < L) lo = mid; else hi = mid; }
    return 0.5 * (lo + hi);
  }
  class Dist {
    constructor(n, sections) { this.n = Math.trunc(n); this.sections = sections; }
    rev() { return new Dist(this.n, this.sections.slice().reverse().map(([a, b, c]) => [a, b, 1.0 / c])); }
    foam() {
      if (this.sections.length === 1) return pf("%.8g", this.sections[0][2]);
      return "(" + this.sections.map(s => pf("(%.10g %.10g %.8g)", s[0], s[1], s[2])).join(" ") + ")";
    }
    sizes(L) {
      const out = [];
      for (const [lf, cf, er] of this.sections) {
        const nc = Math.trunc(pyround(cf * this.n)), Ls = lf * L;
        if (nc <= 0) continue;
        const r = nc > 1 ? Math.pow(er, 1.0 / (nc - 1)) : 1.0;
        const h1 = Math.abs(r - 1) < 1e-12 ? Ls / nc : Ls * (r - 1) / (Math.pow(r, nc) - 1);
        for (let i = 0; i < nc; i++) out.push(h1 * Math.pow(r, i));
      }
      return out;
    }
    static uniform(n) { return new Dist(pymax(1, Math.trunc(n)), [[1.0, 1.0, 1.0]]); }
    static fine_start(L, h1, q, hmax, nmin) {
      nmin = nmin === undefined ? 2 : nmin;
      if (h1 >= hmax || q <= 1.0001) return Dist.uniform(pymax(nmin, Math.ceil(L / pymin(h1, hmax))));
      const k = Math.trunc(Math.floor(Math.log(hmax / h1) / Math.log(q))) + 1;
      const Lg = h1 * (Math.pow(q, k) - 1) / (q - 1);
      if (Lg >= L) {
        const n = pymax(nmin, Math.trunc(Math.ceil(Math.log(1 + L * (q - 1) / h1) / Math.log(q))));
        const r = _solve_ratio(L, n, h1);
        return new Dist(n, [[1.0, 1.0, Math.pow(r, n - 1)]]);
      }
      const nu = Math.trunc(Math.ceil((L - Lg) / hmax)), n = k + nu;
      return new Dist(n, [[Lg / L, k / n, Math.pow(q, k - 1)], [(L - Lg) / L, nu / n, 1.0]]);
    }
    static fixed_n(L, n, h1, q) {
      n = Math.trunc(n);
      if (n * h1 >= L) return Dist.uniform(n);
      let best = null;
      for (let k = 1; k < n; k++) {
        const Lg = h1 * (Math.pow(q, k) - 1) / (q - 1);
        if (Lg >= L) break;
        const hu = (L - Lg) / (n - k), err = Math.abs(Math.log(hu / (h1 * Math.pow(q, k))));
        if (best === null || err < best[0]) best = [err, k, Lg];
      }
      if (best === null || best[0] > Math.log(q) * 1.5) {
        if (best === null || (L - best[2]) / (n - best[1]) > h1 * Math.pow(q, best[1]) * q) {
          const r = _solve_ratio(L, n, h1);
          return new Dist(n, [[1.0, 1.0, Math.pow(r, n - 1)]]);
        }
      }
      const k = best[1], Lg = best[2];
      return new Dist(n, [[Lg / L, k / n, Math.pow(q, k - 1)], [(L - Lg) / L, (n - k) / n, 1.0]]);
    }
    static geometric_n(L, n, h1) { const r = _solve_ratio(L, n, h1); return new Dist(n, [[1.0, 1.0, Math.pow(r, n - 1)]]); }
  }
  function _poly_len(pts) { return pysum(range(pts.length - 1).map(i => pyhypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]))); }
  const _fmt = v => pf("%.9g", v);
  const _vec = v => "(" + _fmt(v[0]) + " " + _fmt(v[1]) + " " + _fmt(v[2]) + ")";

  // ------------------------------------------------------------------ file writing with provenance headers
  const FOAM_BANNER = "/*--------------------------------*- C++ -*----------------------------------*\\\n" +
    "  =========                 |\n" +
    "  \\\\      /  F ield         | OpenFOAM: The Open Source CFD Toolbox\n" +
    "   \\\\    /   O peration     | Version:  " + FOAM_VERSION + " (openfoam.com)\n" +
    "    \\\\  /    A nd           |\n" +
    "     \\\\/     M anipulation  |\n" +
    "\\*---------------------------------------------------------------------------*/\n";
  class CaseWriter {
    constructor(name, stamp) { this.name = name; this.stamp = stamp; this.files = []; this.out = []; }
    _provenance(lines, comment) {
      comment = comment || "//";
      const out = [pf("%s Generated by %s %s on %s for design '%s'.", comment, GENERATOR, VERSION, this.stamp, this.name), pf("%s Design inputs -> values in this file:", comment)];
      for (const ln of lines) out.push(pf("%s   %s", comment, ln));
      out.push(pf("%s Do not edit by hand unless you know why; re-generate instead.", comment));
      return out.join("\n") + "\n";
    }
    _put(rel, text, exec) { this.out.push({ name: rel, text, exec: !!exec }); this.files.push(rel); }
    foam(rel, cls, obj, body, prov, location) {
      let hdr = FOAM_BANNER + this._provenance(prov) + "\nFoamFile\n{\n    version     2.0;\n    format      ascii;\n    class       " + cls + ";\n";
      if (location) hdr += '    location    "' + location + '";\n';
      hdr += "    object      " + obj + ";\n}\n";
      hdr += "// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //\n\n";
      this._put(rel, hdr + rstrip(body) + "\n\n// ************************************************************************* //\n");
    }
    text(rel, body, prov, comment, executable, shebang) {
      let s = "";
      if (shebang) s += shebang + "\n";
      if (prov !== null && prov !== undefined) s += this._provenance(prov, comment || "#") + "\n";
      s += body;
      this._put(rel, s, executable);
    }
    raw(rel, data) { this._put(rel, data); }
  }

  // ------------------------------------------------------------------ design normalisation
  function _get(d, key, dflt) { const v = (d && typeof d === 'object' && key in d) ? d[key] : dflt; return (v === null || v === undefined) ? dflt : v; }
  function _safe_name(s) {
    let out = ""; for (const c of String(s)) out += /[A-Za-z0-9_]/.test(c) ? c : "_";
    if (!out || !/^[A-Za-z]/.test(out)) out = "p_" + out;
    return out;
  }
  function normalise(design) {
    if (!design || typeof design !== 'object') throw new DesignError("design must be a dict");
    const d = { name: String(_get(design, "name", "intake")).trim() || "intake" };
    const g_in = design.geometry;
    if (!g_in || typeof g_in !== 'object') throw new DesignError("design['geometry'] is required");
    const amb = design.ambient || {};
    const p_amb = Number(_get(amb, "p_pa", 101325.0));
    let T_amb;
    if ("T_c" in amb || "T_k" in amb) T_amb = ("T_k" in amb) ? Number(amb.T_k) : Number(amb.T_c) + 273.15; else T_amb = 298.15;
    if (!(20e3 < p_amb && p_amb < 200e3)) throw new DesignError(pf("ambient pressure %.0f Pa is outside 20-200 kPa", p_amb));
    if (!(200 < T_amb && T_amb < 400)) throw new DesignError(pf("ambient temperature %.1f K is outside 200-400 K", T_amb));
    d.p_amb = p_amb; d.T_amb = T_amb;
    const mm = 1e-3, g = {};
    if ("stl" in g_in) {
      g.kind = "stl";
    } else {
      const D = Number(_get(g_in, "tube_diameter_mm", 0)) * mm, Lt = Number(_get(g_in, "tube_length_mm", 0)) * mm;
      if (D <= 0 || Lt <= 0) throw new DesignError("tube_diameter_mm and tube_length_mm must be > 0");
      g.D = D; g.L = Lt;
      const inl = Object.assign({}, _get(g_in, "inlet", { type: "plain" }));
      const t = String(_get(inl, "type", "plain")).toLowerCase();
      if (!["plain", "radius", "ellipse", "taper"].includes(t)) throw new DesignError("inlet type must be plain, radius, ellipse or taper");
      const gi = { type: t };
      if (t === "plain") gi.t = Number(_get(inl, "wall_thickness_mm", pymax(1.5, 0.06 * D / mm))) * mm;
      else if (t === "radius") { gi.rc = Number(_get(inl, "lip_radius_mm", 0.15 * D / mm)) * mm; if (gi.rc <= 0) throw new DesignError("radius inlet needs lip_radius_mm > 0"); }
      else if (t === "ellipse") {
        gi.L = Number(_get(inl, "length_mm", D / mm)) * mm; gi.Di = Number(_get(inl, "entry_diameter_mm", 2.0 * D / mm)) * mm;
        gi.De = Number(_get(inl, "exit_diameter_mm", D / mm)) * mm; gi.rc = Number(_get(inl, "corner_radius_mm", 0.0)) * mm; gi.t = Number(_get(inl, "rim_thickness_mm", 1.5)) * mm;
        if (Math.abs(gi.De - D) > 1e-6) throw new DesignError("ellipse exit_diameter_mm must equal tube_diameter_mm");
        if (gi.Di <= gi.De || gi.L <= 0) throw new DesignError("ellipse needs entry_diameter > exit_diameter and length > 0");
      } else if (t === "taper") {
        gi.Di = Number(_get(inl, "entry_diameter_mm", 1.6 * D / mm)) * mm; gi.alpha = radians(Number(_get(inl, "wall_half_angle_deg", 10.0))); gi.rl = Number(_get(inl, "lip_radius_mm", 0.1 * D / mm)) * mm;
        if (gi.Di <= D) throw new DesignError("taper entry_diameter_mm must exceed tube_diameter_mm");
        if (!(radians(1) <= gi.alpha && gi.alpha <= radians(60))) throw new DesignError("taper wall_half_angle_deg must be 1..60");
        if (gi.rl < 0.2e-3) throw new DesignError("taper lip_radius_mm must be >= 0.2 mm");
      }
      g.inlet = gi;
      const mount = Object.assign({}, _get(g_in, "mount", { type: "free" }));
      g.mount = String(_get(mount, "type", "free")).toLowerCase();
      if (!["free", "flange"].includes(g.mount)) throw new DesignError("mount type must be free or flange");
      g.protrusion = ("protrusion_mm" in mount) ? Number(mount.protrusion_mm) * mm : null;
      const dc = g_in.diameter_change;
      if (dc) {
        g.dc = { D2: Number(dc.to_diameter_mm) * mm, beta: radians(Number(_get(dc, "cone_half_angle_deg", 7.0))), x0: Number(dc.start_mm) * mm };
        if (!(0 < g.dc.beta && g.dc.beta <= radians(60))) throw new DesignError("cone_half_angle_deg must be in (0, 60]");
      } else g.dc = null;
      const bd = g_in.bend;
      g.bends = bd ? (Array.isArray(bd) ? bd : [bd]).map(b => ({ clr: Number(b.clr_mm) * mm, angle: radians(Number(b.angle_deg)), s0: Number(b.start_mm) * mm, plane: radians(Number(_get(b, "plane_deg", 0.0))) })) : [];
      const planes = {};
      if (g_in.maf_plane_mm !== null && g_in.maf_plane_mm !== undefined) planes.maf = Number(g_in.maf_plane_mm) * mm;
      const pm = _get(g_in, "planes_mm", {}) || {};
      for (const nm of Object.keys(pm)) planes[_safe_name(nm)] = Number(pm[nm]) * mm;
      g.planes = planes;
      g.ext_D = Number(_get(g_in, "outlet_extension_D", 4.0));
      g.kind = (g.bends.length || String(_get(g_in, "force_3d", false)).toLowerCase() === "true" || g_in.force_3d === true) ? "3d" : "axisym";
    }
    d.geometry = g;
    const op = design.operating_point;
    if (!op || typeof op !== 'object') throw new DesignError("design['operating_point'] is required");
    d.op_in = op;
    const m = design.mesh || {};
    const lvl = String(_get(m, "level", "medium")).toLowerCase();
    if (!(lvl in MESH_LEVELS)) throw new DesignError("mesh level must be coarse, medium or fine");
    d.mesh_level = lvl; d.mesh_overrides = m;
    const sv = design.solver || {};
    const force = _get(sv, "force", null);
    if (![null, "compressible", "incompressible"].includes(force)) throw new DesignError("solver.force must be compressible, incompressible or null");
    d.solver_force = force;
    d.max_iter = Math.trunc(Number(_get(sv, "max_iterations", 0)));
    d.turbulence_in = design.turbulence || {};
    d.write_interval = Math.trunc(Number(_get(sv, "write_interval", 0)));
    return d;
  }
  function engine_mass_flow(eng, rho_amb) {
    let Vd;
    if ("displacement_cc" in eng) Vd = Number(eng.displacement_cc) * 1e-6;
    else if ("displacement_l" in eng) Vd = Number(eng.displacement_l) * 1e-3;
    else throw new DesignError("engine needs displacement_cc or displacement_l");
    const rpm = Number(eng.rpm); let ve = Number(_get(eng, "ve", 0.9));
    if (ve > 3) ve /= 100.0;
    const strokes = Math.trunc(Number(_get(eng, "strokes", 4)));
    if (strokes !== 2 && strokes !== 4) throw new DesignError("strokes must be 2 or 4");
    const ncyl = Math.trunc(Number(_get(eng, "cylinders", 1))), nfed = Math.trunc(Number(_get(eng, "cylinders_fed", ncyl))), peak = Number(_get(eng, "flow_factor", 1.0));
    const revs = strokes === 4 ? 2.0 : 1.0;
    const mdot = ve * rho_amb * Vd * rpm / 60.0 / revs * nfed / ncyl * peak;
    return [mdot, { Vd, rpm, ve, strokes, cylinders: ncyl, cylinders_fed: nfed, flow_factor: peak }];
  }

  // ------------------------------------------------------------------ axisymmetric inlet profiles
  function _arc_pts(cx, cr, rad, a0, a1, n) { return range(n + 1).map(i => [cx + rad * Math.cos(a0 + (a1 - a0) * i / n), cr + rad * Math.sin(a0 + (a1 - a0) * i / n)]); }
  function _edge_radius(g) { return pymin(1e-3 * g.D, 0.05e-3); }
  function profile(inner, iM, cap_free, r_out, front_r, label) { return { inner, iM, cap_free, r_out, front_r, length: inner[inner.length - 1][0], label }; }
  function inlet_profile(g) {
    const R = g.D / 2.0, gi = g.inlet, t = gi.type, re_ = _edge_radius(g);
    if (t === "plain" || t === "radius") {
      const rc = t === "radius" ? gi.rc : re_, cx = rc, cr = R + rc;
      const a = _arc_pts(cx, cr, rc, Math.PI, 1.25 * Math.PI, 24), b = _arc_pts(cx, cr, rc, 1.25 * Math.PI, 1.5 * Math.PI, 24);
      const inner = a.concat(b.slice(1));
      if (t === "radius") {
        const cap = _arc_pts(cx, cr, rc, Math.PI, 0.5 * Math.PI, 36);
        return profile(inner, 24, cap, R + 2 * rc, R + rc, pf("semi-toroidal lip, radius %.2f mm (entry dia %.2f mm)", rc * 1e3, 2 * (R + rc) * 1e3));
      }
      const tw = gi.t, face_top = R + tw - re_;
      const cap = range(21).map(i => [0.0, R + re_ + (face_top - R - re_) * i / 20]).concat(_arc_pts(re_, face_top, re_, Math.PI, 0.5 * Math.PI, 12).slice(1));
      return profile(inner, 24, cap, R + tw, R, pf("sharp-edged plain pipe, wall %.2f mm (edge radius %.3f mm)", tw * 1e3, re_ * 1e3));
    }
    if (t === "ellipse") {
      const a = gi.L, b = (gi.Di - gi.De) / 2.0, cx = gi.L, cr = gi.Di / 2.0, tM = Math.atan2(b, a);
      const P = tt => [cx - a * Math.cos(tt), cr - b * Math.sin(tt)];
      const n1 = 24, n2 = 48;
      const inner = range(n1 + 1).map(i => P(tM * i / n1)).concat(range(n2).map(j => j + 1).map(i => P(tM + (0.5 * Math.PI - tM) * i / n2)));
      if (gi.rc > 0) {
        const rc = gi.rc, cap = _arc_pts(rc, cr, rc, Math.PI, 0.5 * Math.PI, 24);
        return profile(inner, n1, cap, cr + rc, cr, pf("elliptical bellmouth L=%.1f Di=%.1f De=%.1f Rc=%.1f mm", gi.L * 1e3, gi.Di * 1e3, gi.De * 1e3, rc * 1e3));
      }
      const tw = gi.t, face_top = cr + tw - re_;
      const cap = range(17).map(i => [0.0, cr + (face_top - cr) * i / 16]).concat(_arc_pts(re_, face_top, re_, Math.PI, 0.5 * Math.PI, 12).slice(1));
      return profile(inner, n1, cap, cr + tw, cr, pf("elliptical bellmouth L=%.1f Di=%.1f De=%.1f, sharp rim %.1f mm thick", gi.L * 1e3, gi.Di * 1e3, gi.De * 1e3, tw * 1e3));
    }
    // taper
    const al = gi.alpha, rl = gi.rl, ri = gi.Di / 2.0, cx = rl, cr = ri + rl * Math.cos(al);
    const S = [cx - rl * Math.sin(al), ri], T = [S[0] + (ri - R) / Math.tan(al), R], a_end = 1.5 * Math.PI - al;
    let arc, iM;
    if (al < radians(45)) { const a = _arc_pts(cx, cr, rl, Math.PI, 1.25 * Math.PI, 16), b = _arc_pts(cx, cr, rl, 1.25 * Math.PI, a_end, 12); arc = a.concat(b.slice(1)); iM = 16; }
    else { arc = _arc_pts(cx, cr, rl, Math.PI, a_end, 24); iM = 12; }
    const ncone = 40;
    const cone = range(ncone).map(j => j + 1).map(i => [S[0] + (T[0] - S[0]) * i / ncone, S[1] + (T[1] - S[1]) * i / ncone]);
    const cap = _arc_pts(cx, cr, rl, Math.PI, 0.5 * Math.PI, 24);
    return profile(arc.concat(cone), iM, cap, cr + rl, cr, pf("tapered inlet, %.1f deg half-angle, lip radius %.2f mm, entry dia %.1f mm", degrees(al), rl * 1e3, gi.Di * 1e3));
  }
  function tube_radius(g, x) {
    const R = g.D / 2.0, dc = g.dc;
    if (!dc) return R;
    const R2 = dc.D2 / 2.0, Lc = Math.abs(R2 - R) / Math.tan(dc.beta);
    if (x <= dc.x0) return R;
    if (x >= dc.x0 + Lc) return R2;
    return R + (R2 - R) * (x - dc.x0) / Lc;
  }
  function tract_stations(g, prof) {
    const xs = new Map(); xs.set(prof.length, "inlet_end");
    if (g.dc) {
      const R = g.D / 2.0, R2 = g.dc.D2 / 2.0, Lc = Math.abs(R2 - R) / Math.tan(g.dc.beta), x0 = g.dc.x0;
      if (x0 < prof.length - 1e-9 || x0 + Lc > g.L + 1e-9) throw new DesignError(pf("diameter change must start after the inlet piece (x >= %.1f mm) and end before the tract end", prof.length * 1e3));
      xs.set(x0, "cone_start"); xs.set(x0 + Lc, "cone_end");
    }
    xs.set(g.L, "tract_end");
    const Dout = 2 * tube_radius(g, g.L), xo = g.L + g.ext_D * Dout;
    xs.set(xo, "outlet");
    for (const nm of Object.keys(g.planes)) {
      const x = g.planes[nm];
      if (x < prof.length - 1e-9 || x > xo - 0.5 * Dout) throw new DesignError(pf("plane '%s' at %.1f mm must lie between the end of the inlet piece (%.1f mm) and the outlet minus D/2 (%.1f mm)", nm, x * 1e3, prof.length * 1e3, (xo - 0.5 * Dout) * 1e3));
      xs.set(x, "plane:" + nm);
    }
    if (g.L < prof.length - 1e-9) throw new DesignError(pf("tube_length_mm (%.1f) must be at least the inlet piece length (%.1f mm)", g.L * 1e3, prof.length * 1e3));
    const out = [];
    for (const x of Array.from(xs.keys()).sort((a, b) => a - b)) {
      if (out.length && Math.abs(x - out[out.length - 1][0]) < 1e-6) out[out.length - 1] = [out[out.length - 1][0], out[out.length - 1][1] + "|" + xs.get(x)];
      else out.push([x, xs.get(x)]);
    }
    return out;
  }
  function derive(d) {
    const p0 = d.p_amb, T0 = d.T_amb, rho0 = p0 / (R_AIR * T0), mu0 = mu_air(T0), g = d.geometry, op = d.op_in;
    const der = { p_amb: p0, T_amb: T0, rho_amb: rho0, mu_amb: mu0, nu_amb: mu0 / rho0, a_amb: Math.sqrt(GAMMA * R_AIR * T0), R_air: R_AIR, cp: CP_AIR, gamma: GAMMA };
    const Dref = g.D, Rmin = pymin(g.D / 2.0, tube_radius(g, g.L)), Amin = Math.PI * Math.pow(Rmin, 2);
    let peak_factor = { plain: 1.6, taper: 1.2, radius: 1.1, ellipse: 1.05 }[g.inlet.type];
    if (g.bends.length) peak_factor *= 1.15;
    der.D_ref = Dref; der.A_min = Amin; der.peak_factor = peak_factor; der.D_Re = Math.sqrt(4.0 * Amin / Math.PI);   // Re at the smallest section, its own diameter (intake_cfd.py)
    let mode, mdot, src;
    if ("mass_flow_kg_s" in op) { mode = "mass_flow"; mdot = Number(op.mass_flow_kg_s); src = pf("mass_flow_kg_s = %.6g kg/s (given)", mdot); }
    else if ("engine" in op) {
      mode = "mass_flow"; const r = engine_mass_flow(op.engine, rho0); mdot = r[0]; const info = r[1]; der.engine = info;
      src = pf("engine: VE %.3f x rho_amb %.4f kg/m3 x Vd %.1f cc x %.0f rpm / 60 / %d rev/cycle x %d/%d cyl x %.2f = %.6g kg/s",
        info.ve, rho0, info.Vd * 1e6, info.rpm, info.strokes === 4 ? 2 : 1, info.cylinders_fed, info.cylinders, info.flow_factor, mdot);
    } else if ("pressure_ratio" in op) {
      mode = "pressure_ratio"; const PR = Number(op.pressure_ratio);
      if (PR <= 1.0) throw new DesignError("pressure_ratio must be > 1 (p0_ambient / p_outlet)");
      der.PR = PR; der.p_out = p0 / PR; mdot = null; src = pf("pressure_ratio p0/p_out = %.5g -> p_out = %.1f Pa", PR, p0 / PR);
    } else throw new DesignError("operating_point needs mass_flow_kg_s, engine or pressure_ratio");
    der.mode = mode; der.op_source = src;
    let M_bulk;
    if (mode === "mass_flow") {
      if (mdot <= 0) throw new DesignError("mass flow must be > 0");
      M_bulk = mach_from_mass_flux(mdot / Amin, p0, T0); der.mdot = mdot;
    } else {
      const PR = der.PR;
      M_bulk = Math.sqrt(2.0 / (GAMMA - 1) * (Math.pow(PR, (GAMMA - 1) / GAMMA) - 1));
      mdot = 0.85 * ideal_mass_flux(p0, T0, p0 / PR) * Amin; der.mdot_estimate = mdot;
    }
    const T_s = T0 / (1 + 0.5 * (GAMMA - 1) * Math.pow(M_bulk, 2)), a_s = Math.sqrt(GAMMA * R_AIR * T_s), U_bulk = M_bulk * a_s, M_peak = pymin(0.99, M_bulk * peak_factor);
    Object.assign(der, { M_bulk, U_bulk, M_peak, U_peak: M_peak * a_s });
    let comp, why;
    if (d.solver_force) { comp = d.solver_force === "compressible"; why = "forced by design['solver']['force']"; }
    else { comp = M_peak >= MACH_COMPRESSIBLE; why = pf("estimated peak Mach %.3f %s %.2f (density change ~M^2/2 = %.1f %%)", M_peak, comp ? ">=" : "<", MACH_COMPRESSIBLE, 50 * Math.pow(M_peak, 2)); }
    der.compressible = comp; der.solver = comp ? "rhoSimpleFoam" : "simpleFoam"; der.solver_why = why; der.transonic = comp && M_peak >= MACH_TRANSONIC;
    if (M_peak >= 0.95) throw new DesignError(pf("estimated peak Mach %.2f: flow would choke; steady subsonic RANS case generation refused", M_peak));
    const rho_s = p0 / (R_AIR * T0) * Math.pow(T_s / T0, 1 / (GAMMA - 1)), Re = rho_s * U_bulk * der.D_Re / mu_air(T_s), f = friction_factor_colebrook(Re);
    const utau_bulk = U_bulk * Math.sqrt(f / 8.0), utau_peak = der.U_peak * Math.sqrt(f / 8.0), nu_s = mu_air(T_s) / rho_s;
    Object.assign(der, { Re, f_colebrook: f, u_tau: utau_bulk, u_tau_peak: utau_peak, nu_s, rho_s });
    der.h_wall_lowRe = 2.0 * 1.0 * nu_s / utau_peak;
    der.h_wall_wf = 2.0 * 50.0 * nu_s / utau_bulk;
    const tu = d.turbulence_in || {}, Iin = Number(_get(tu, "intensity", 0.01)), vr = Number(_get(tu, "viscosity_ratio", 1.0)), k_in = 1.5 * Math.pow(Iin * U_bulk, 2);
    der.k_in = k_in; der.omega_in = k_in / (vr * der.nu_amb); der.I_in = Iin; der.nut_ratio_in = vr;
    return der;
  }

  // ------------------------------------------------------------------ 2-D axisymmetric sector mesh (rotational cyclic sides)
  class Sector {
    constructor() { this.th = radians(SECTOR_HALF_ANGLE_DEG); this.pts = []; this.ids = {}; this.xr = {}; this.blocks = []; this.edges = []; this.edge_keys = new Set(); this.curve_pts = new Map(); this.patches = new Map(); this.patch_types = {}; }
    point(name, x, r) {
      this.xr[name] = [x, r];
      if (r < 1e-12) { const i = this.pts.length; this.pts.push([x, 0.0, 0.0]); this.ids[name] = [i, i]; }
      else { const i = this.pts.length, c = Math.cos(this.th), s = Math.sin(this.th); this.pts.push([x, r * c, -r * s]); this.pts.push([x, r * c, r * s]); this.ids[name] = [i, i + 1]; }
    }
    curve(a, b, inner_xr) {
      if (!inner_xr.length) return;
      const key = a + "\u0000" + b;
      if (this.edge_keys.has(key) || this.edge_keys.has(b + "\u0000" + a)) return;
      this.edge_keys.add(key); this.curve_pts.set(key, inner_xr.slice());
      const c = Math.cos(this.th), s = Math.sin(this.th), [fa, ba] = this.ids[a], [fb, bb] = this.ids[b];
      this.edges.push([fa, fb, inner_xr.map(([x, r]) => [x, r * c, -r * s])]);
      if (ba !== fa || bb !== fb) this.edges.push([ba, bb, inner_xr.map(([x, r]) => [x, r * c, r * s])]);
    }
    _edge_pts(a, b) {
      const pa = this.xr[a], pb = this.xr[b]; let mid;
      if (this.curve_pts.has(a + "\u0000" + b)) mid = this.curve_pts.get(a + "\u0000" + b);
      else if (this.curve_pts.has(b + "\u0000" + a)) mid = this.curve_pts.get(b + "\u0000" + a).slice().reverse();
      else mid = [];
      return [pa].concat(mid, [pb]);
    }
    block(name, a, b, c, d, bottom, top, left, right) {
      const poly = this._edge_pts(a, b).slice(0, -1).concat(this._edge_pts(b, c).slice(0, -1), this._edge_pts(c, d).slice(0, -1), this._edge_pts(d, a).slice(0, -1));
      let area = 0.0;
      for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length]; area += x1 * y2 - x2 * y1; }
      if (area < 0) { [a, b, c, d] = [b, a, d, c]; [bottom, top, left, right] = [bottom.rev(), top.rev(), right, left]; }
      this.blocks.push([name, [a, b, c, d], bottom, top, left, right]);
    }
    face(patch, a, b, ptype) {
      ptype = ptype || "patch";
      const [fa, ba] = this.ids[a], [fb, bb] = this.ids[b];
      if (!this.patches.has(patch)) this.patches.set(patch, []);
      this.patches.get(patch).push([fa, fb, bb, ba]); this.patch_types[patch] = ptype;
    }
    ncells() { let n = 0; for (const bl of this.blocks) n += bl[2].n * bl[4].n; return n; }
    write() {
      const L = ["scale 1;", "", "mergeType points;   // sector: merge the collapsed points on the axis", "", "vertices", "("];
      this.pts.forEach((p, i) => L.push(pf("    %s  // %d", _vec(p), i)));
      L.push(");", "", "blocks", "(");
      const front_faces = [], back_faces = [];
      for (const [name, [a, b, c, d], bot, top, left, right] of this.blocks) {
        const [fa, ba] = this.ids[a], [fb, bb] = this.ids[b], [fc, bc] = this.ids[c], [fd, bd] = this.ids[d];
        const gr = [bot.foam(), top.foam(), top.foam(), bot.foam(), left.foam(), right.foam(), right.foam(), left.foam(), "1", "1", "1", "1"];
        L.push("    // " + name);
        L.push(pf("    hex (%d %d %d %d %d %d %d %d) (%d %d 1)", fa, fb, fc, fd, ba, bb, bc, bd, bot.n, left.n));
        L.push("    edgeGrading (" + gr.join(" ") + ")");
        front_faces.push([fa, fb, fc, fd]); back_faces.push([ba, bb, bc, bd]);
      }
      L.push(");", "", "edges", "(");
      for (const [i, j, pts] of this.edges) { L.push(pf("    polyLine %d %d", i, j), "    ("); for (const p of pts) L.push("        " + _vec(p)); L.push("    )"); }
      L.push(");", "", "boundary", "(");
      for (const [patch, faces] of this.patches) {
        L.push("    " + patch, "    {", "        type " + this.patch_types[patch] + ";");
        if (this.patch_types[patch] === "wall") L.push("        inGroups (wall);");
        L.push("        faces", "        (");
        for (const f of faces) L.push(pf("            (%d %d %d %d)", f[0], f[1], f[2], f[3]));
        L.push("        );", "    }");
      }
      for (const [nm, other, faces] of [["front", "back", front_faces], ["back", "front", back_faces]]) {
        L.push("    " + nm, "    {", "        type cyclic;", "        neighbourPatch " + other + ";", "        transform rotational;",
          "        rotationAxis (1 0 0);", "        rotationCentre (0 0 0);", "        faces", "        (");
        for (const f of faces) L.push(nm === "front" ? pf("            (%d %d %d %d)", f[0], f[3], f[2], f[1]) : pf("            (%d %d %d %d)", f[0], f[1], f[2], f[3]));
        L.push("        );", "    }");
      }
      L.push(");");
      return L.join("\n");
    }
  }
  function _bezier(P0, P1, P2, n) {
    const out = [];
    for (let i = 1; i < n; i++) { const t = i / n; out.push([Math.pow(1 - t, 2) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], Math.pow(1 - t, 2) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]]); }
    return out;
  }
  function _cumlen(pts) { const out = [0.0]; for (let i = 0; i < pts.length - 1; i++) out.push(out[out.length - 1] + pyhypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])); return out; }
  function _u_at(cum, s) {
    if (s <= 0) return 0.0;
    if (s >= cum[cum.length - 1]) return cum.length - 1;
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (cum[mid] <= s) lo = mid; else hi = mid; }
    const seg = cum[hi] - cum[lo];
    return lo + (seg <= 0 ? 0.0 : (s - cum[lo]) / seg);
  }
  function _s_at(cum, u) { const i = pymin(Math.trunc(Math.floor(u)), cum.length - 2); return cum[i] + (u - i) * (cum[i + 1] - cum[i]); }
  function _offset(poly, delta, side) {
    const out = [], n = poly.length;
    for (let i = 0; i < n; i++) {
      const p0 = poly[pymax(i - 1, 0)], p1 = poly[pymin(i + 1, n - 1)];
      let tx = p1[0] - p0[0], tr = p1[1] - p0[1]; const tl = pyhypot(tx, tr); tx = tx / tl; tr = tr / tl;
      const [nx, nr] = side === "left" ? [-tr, tx] : [tr, -tx];
      out.push([poly[i][0] + delta * nx, poly[i][1] + delta * nr]);
    }
    return out;
  }
  function _sizes_two_sided(L, ha, hb, q, hmax, nmin) {
    let n = nmin === undefined ? 2 : nmin, sz;
    for (;;) { sz = range(n).map(i => pymin(ha * Math.pow(q, i), hb * Math.pow(q, n - 1 - i), hmax)); if (pysum(sz) >= L || n > 20000) break; n += 1; }
    const f = L / pysum(sz);
    return sz.map(x => x * f);
  }
  function _fracs_from_sizes(sz) { const tot = pysum(sz), c = [0.0]; for (const x of sz) c.push(c[c.length - 1] + x / tot); c[c.length - 1] = 1.0; return c; }
  function dist_from_fracs(fr) { const n = fr.length - 1; return new Dist(n, range(n).map(i => [fr[i + 1] - fr[i], 1.0 / n, 1.0])); }
  function _mapped_pair(wall, off, sizes_on_off) {
    const cw_ = _cumlen(wall), co_ = _cumlen(off), fo = _fracs_from_sizes(sizes_on_off), fw = [0.0];
    for (const f of fo.slice(1, -1)) { const u = _u_at(co_, f * co_[co_.length - 1]); fw.push(_s_at(cw_, u) / cw_[cw_.length - 1]); }
    fw.push(1.0);
    for (let i = 1; i < fw.length; i++) if (fw[i] <= fw[i - 1]) fw[i] = fw[i - 1] + 1e-9;
    const last = fw[fw.length - 1];
    return [dist_from_fracs(fw.map(x => x / last)), dist_from_fracs(fo)];
  }
  function build_axisym_mesh(d, der) {
    const g = d.geometry, prof = g.profile, lv = Object.assign({}, MESH_LEVELS[d.mesh_level]);
    for (const k of Object.keys(lv)) if (k in d.mesh_overrides) lv[k] = Number(d.mesh_overrides[k]);
    const D = g.D, R = D / 2.0, hw = pymin(der.h_wall_lowRe, R / 50.0), stations = tract_stations(g, prof), free = g.mount === "free", delta = 0.15 * R;
    const W = new Sector(), inner = prof.inner, iM = prof.iM, M = inner[iM], T = inner[inner.length - 1];
    const L_d = Dist.fine_start(delta, hw, lv.q_r, 1e9), hL = L_d.sizes(delta).slice(-1)[0], n_L = L_d.n;
    const bell_w = inner.slice(iM), bell_o = _offset(bell_w, delta, "right"), Dm = 2.0 * prof.r_out, Rff = pymax(15.0 * D, 8.0 * Dm), h_far = lv.far * Rff;
    let P, O, cap_w, Fr, Wp, Wo, Oo;
    if (free) {
      P = g.protrusion !== null ? g.protrusion : pymax(prof.length, D);
      O = prof.cap_free[prof.cap_free.length - 1];
      P = pymax(P, O[0] + pymax(0.1 * D, 2 * delta));
      g.protrusion_used = P;
      cap_w = inner.slice(0, iM + 1).reverse().concat(prof.cap_free.slice(1));
    } else {
      g.protrusion_used = 0.0; Fr = inner[0];
      cap_w = inner.slice(0, iM + 1).reverse().concat(range(40).map(j => j + 1).map(i => [0.0, Fr[1] + (Rff - Fr[1]) * i / 40]));
    }
    const cap_o = _offset(cap_w, delta, "left"), Mo = bell_o[0];
    cap_o[0] = Mo;
    const To = [T[0], T[1] - delta]; bell_o[bell_o.length - 1] = To;
    if (free) { Oo = [O[0], O[1] + delta]; cap_o[cap_o.length - 1] = Oo; }
    else { Wp = cap_w[cap_w.length - 1]; Wo = [-delta, Rff]; cap_o[cap_o.length - 1] = Wo; }
    const iF = iM, Fw = cap_w[iF], Fo = cap_o[iF];
    W.point("M", M[0], M[1]); W.point("Mo", Mo[0], Mo[1]); W.point("F", Fw[0], Fw[1]); W.point("Fo", Fo[0], Fo[1]);
    W.point("T", T[0], T[1]); W.point("To", To[0], To[1]); W.point("A_M", Mo[0], 0.0); W.point("A_T", T[0], 0.0);
    let phi1, phiH, F0, F1, H, G, cap_end, cap_end_o;
    if (free) {
      phi1 = radians(30); phiH = radians(60);
      F0 = [-Rff, 0.0]; F1 = [-Rff * Math.cos(phi1), Rff * Math.sin(phi1)]; H = [-Rff * Math.cos(phiH), Rff * Math.sin(phiH)]; G = [O[0], Rff];
      const Bo = [P, prof.r_out], Bf = [P, Rff], Boo = [P, prof.r_out + delta];
      for (const [nm, pnt] of [["F0", F0], ["F1", F1], ["H", H], ["O", O], ["Oo", Oo], ["G", G], ["Bo", Bo], ["Boo", Boo], ["Bf", Bf]]) W.point(nm, pnt[0], pnt[1]);
      cap_end = "O"; cap_end_o = "Oo";
    } else {
      const x0 = -Rff; F0 = [x0, 0.0]; F1 = [x0, 0.5 * Rff]; H = [x0, 0.75 * Rff]; const C = [x0, Rff];
      for (const [nm, pnt] of [["F0", F0], ["F1", F1], ["H", H], ["C", C], ["Wp", Wp], ["Wo", Wo]]) W.point(nm, pnt[0], pnt[1]);
      cap_end = "Wp"; cap_end_o = "Wo";
    }
    const h_t = hL, h_bell = lv.bell * D, h_capmax = pymax(h_bell, lv.out * D * 0.5);
    const cap1_w = cap_w.slice(0, iF + 1), cap1_o = cap_o.slice(0, iF + 1), cap2_w = cap_w.slice(iF), cap2_o = cap_o.slice(iF);
    const s1 = _sizes_two_sided(_poly_len(cap1_o), h_t, h_t, lv.q_cap, h_capmax, 4);
    let s2;
    if (free) s2 = _sizes_two_sided(_poly_len(cap2_o), h_t, h_t, lv.q_cap, h_capmax, 4);
    else { const hfl = pymin(h_far, 0.5 * D); s2 = _sizes_two_sided(_poly_len(cap2_o), h_t, hfl, lv.q_cap, hfl, 4); }
    const [cap1_dw, cap1_do] = _mapped_pair(cap1_w, cap1_o, s1), [cap2_dw, cap2_do] = _mapped_pair(cap2_w, cap2_o, s2);
    const h_entry = lv.entry * D, Lbo = _poly_len(bell_o);
    const bell_sizes = _sizes_two_sided(Lbo, h_t, pymax(h_t, h_entry), lv.q_cap, h_bell, 4);
    const [bell_dw, bell_do] = _mapped_pair(bell_w, bell_o, bell_sizes);
    W.curve("M", "F", cap1_w.slice(1, -1)); W.curve("Mo", "Fo", cap1_o.slice(1, -1));
    W.curve("F", cap_end, cap2_w.slice(1, -1)); W.curve("Fo", cap_end_o, cap2_o.slice(1, -1));
    W.curve("M", "T", bell_w.slice(1, -1)); W.curve("Mo", "To", bell_o.slice(1, -1));
    const core_ref = Dist.fine_start(R - delta, hL, lv.q_r, lv.core * R), n_c = core_ref.n;
    const core_radial = Lr => Dist.fixed_n(Lr, n_c, hL, lv.q_r).rev();
    const leave_horiz = (Pa, Pb) => { const dd = pyhypot(Pb[0] - Pa[0], Pb[1] - Pa[1]); return _bezier(Pa, [Pa[0] - 0.4 * dd, Pa[1]], Pb, 60); };
    const curve = leave_horiz(Mo, F1);
    W.curve("F1", "Mo", curve.slice().reverse());
    const Lcurve = _poly_len([Mo].concat(curve, [F1]));
    const curveH = leave_horiz(Fo, H);
    W.curve("H", "Fo", curveH.slice().reverse());
    const LcurveH = _poly_len([Fo].concat(curveH, [H]));
    const up_ref = Dist.fine_start(pymax(Lcurve, LcurveH), hL, lv.q_up, h_far), n_up = up_ref.n;
    const up_to = Lu => Dist.fixed_n(Lu, n_up, hL, lv.q_up).rev();
    W.block("layer_cap1", "M", "F", "Fo", "Mo", cap1_dw, cap1_do, L_d, L_d);
    W.face("inlet_wall", "M", "F", "wall");
    W.block("layer_cap2", "F", cap_end, cap_end_o, "Fo", cap2_dw, cap2_do, L_d, free ? L_d : Dist.uniform(n_L));
    W.face("inlet_wall", "F", cap_end, "wall");
    W.block("layer_bell", "M", "T", "To", "Mo", bell_dw, bell_do, L_d, L_d);
    W.face("inlet_wall", "M", "T", "wall");
    const up_c = up_to(Lcurve), up_h = up_to(LcurveH), rad_M = core_radial(Mo[1]);
    if (free) {
      W.curve("F0", "F1", range(29).map(j => j + 1).map(i => phi1 * i / 30).map(a_ => [-Rff * Math.cos(a_), Rff * Math.sin(a_)]));
      W.curve("F1", "H", range(29).map(j => j + 1).map(i => phi1 + (phiH - phi1) * i / 30).map(a_ => [-Rff * Math.cos(a_), Rff * Math.sin(a_)]));
    }
    W.block("far_core", "F0", "A_M", "Mo", "F1", up_c, up_c, rad_M, rad_M);
    W.face("atmosphere", "F0", "F1");
    W.block("bell_core", "A_M", "A_T", "To", "Mo", bell_do, bell_do, rad_M, core_radial(To[1]));
    W.block("front_a", "F1", "Mo", "Fo", "H", up_c, up_h, cap1_do, cap1_do);
    W.face("atmosphere", "F1", "H");
    if (free) {
      const arc = range(30).map(j => j + 1).map(i => phiH + (Math.PI / 2 - phiH) * i / 30).map(a_ => [-Rff * Math.cos(a_), Rff * Math.sin(a_)]);
      W.curve("H", "G", arc.slice(0, -1).concat(G[0] > 1e-12 ? [[0.0, Rff]] : []));
      const L_GO = Rff - Oo[1];
      W.block("front_b", "H", "Fo", "Oo", "G", up_h, up_to(L_GO), cap2_do, cap2_do);
      W.face("atmosphere", "H", "G");
      const n_out = pymax(4, Math.trunc(Math.ceil((P - O[0]) / (lv.out * D))));
      const up_out = Dist.fixed_n(L_GO, n_up, hL, lv.q_up);
      W.block("layer_out", "O", "Bo", "Boo", "Oo", Dist.uniform(n_out), Dist.uniform(n_out), L_d, L_d);
      W.face("inlet_wall", "O", "Bo", "wall");
      W.face("plenum_wall", "Bo", "Boo", "wall");
      W.block("around", "Oo", "Boo", "Bf", "G", Dist.uniform(n_out), Dist.uniform(n_out), up_out, up_out);
      W.face("plenum_wall", "Boo", "Bf", "wall");
      W.face("atmosphere", "G", "Bf");
    } else {
      W.block("front_b", "H", "Fo", "Wo", "C", up_h, up_h, cap2_do, cap2_do);
      W.face("atmosphere", "H", "C"); W.face("atmosphere", "C", "Wo"); W.face("atmosphere", "Wp", "Wo");
    }
    let h_prev = bell_sizes[bell_sizes.length - 1] * (_poly_len(bell_w) / Lbo);
    h_prev = pymax(h_prev, bell_sizes[bell_sizes.length - 1] * 0.5);
    let prev_a = "A_T", prev_w = "T", prev_o = "To";
    for (let i = 1; i < stations.length; i++) {
      const x0s = stations[i - 1][0], x1s = stations[i][0], a_ = "A" + i, w_ = "W" + i, o_ = "Wo" + i, r1 = tube_radius(g, pymin(x1s, g.L));
      W.point(a_, x1s, 0.0); W.point(w_, x1s, r1); W.point(o_, x1s, r1 - delta);
      const Ls = x1s - x0s, in_ext = x0s >= g.L - 1e-12, hmax = lv.tube * D * (in_ext ? 1.5 : 1.0);
      const ax = Dist.fine_start(Ls, pymin(h_prev, hmax), lv.q_ax, hmax, 2);
      h_prev = ax.sizes(Ls).slice(-1)[0];
      const r0o = W.xr[prev_o][1];
      W.block("tube_core_" + i, prev_a, a_, o_, prev_o, ax, ax, core_radial(r0o), core_radial(r1 - delta));
      W.block("tube_layer_" + i, prev_w, w_, o_, prev_o, ax, ax, L_d, L_d);
      W.face(in_ext ? "extension_wall" : "tract_wall", prev_w, w_, "wall");
      prev_a = a_; prev_w = w_; prev_o = o_;
    }
    W.face("outlet", prev_a, prev_o); W.face("outlet", prev_o, prev_w);
    const info = { n_r: n_L + n_c, n_layer: n_L, n_up, Rff, h_wall: hw, delta, stations, ncells: W.ncells(), protrusion: g.protrusion_used, free, profile: prof.label, sector_deg: 2 * SECTOR_HALF_ANGLE_DEG };
    return [W, info];
  }

  // ------------------------------------------------------------------ OpenFOAM dictionaries
  function _bc_block(entries) { return entries.map(([patch, body]) => "    " + patch + "\n    {\n" + body.trim().split("\n").map(ln => "        " + ln).join("\n") + "\n    }").join("\n"); }
  function field_files(cw, d, der, patches) {
    const comp = der.compressible, p0 = der.p_amb, T0 = der.T_amb, k_in = der.k_in, om_in = der.omega_in, mdot = der.mdot, rho = der.rho_amb;
    const prov_common = [
      pf("ambient.p_pa = %.1f Pa, ambient T = %.2f K -> atmosphere total pressure / total temperature", p0, T0),
      "operating point: " + der.op_source,
      pf("inflow turbulence: I = %.3g %% of tract bulk velocity %.2f m/s -> k = %.4g m2/s2; nut/nu = %.3g -> omega = %.4g 1/s", 100 * der.I_in, der.U_bulk, k_in, der.nut_ratio_in, om_in)];
    const make = (name, cls, dims, internal, rules, extra_prov) => {
      const ents = Object.keys(patches).map(pn => [pn, patches[pn] === "cyclic" ? "type cyclic;" : rules[patches[pn]]]);
      const body = "dimensions      " + dims + ";\n\ninternalField   " + internal + ";\n\nboundaryField\n{\n" + _bc_block(ents) + "\n}\n";
      cw.foam("0/" + name, cls, name, body, prov_common.concat(extra_prov), "0");
    };
    const ramp = RAMP_ITER; let out_U, out_p, prov_out;
    if (der.mode === "mass_flow") {
      const fs = der.flow_scale === undefined ? 1.0 : der.flow_scale;
      if (comp) out_U = pf("type            flowRateOutletVelocity;\nmassFlowRate    table ((0 0) (%d %.9g));\nrho             rho;\nvalue           uniform (0 0 0);", ramp, mdot / fs);
      else out_U = pf("type            flowRateOutletVelocity;\nvolumetricFlowRate table ((0 0) (%d %.9g));\nvalue           uniform (0 0 0);", ramp, mdot / rho / fs);
      out_p = "type            zeroGradient;";
      prov_out = [pf("outlet: imposed mass flow %.6g kg/s%s (flowRateOutletVelocity), ramped linearly from 0 over the first %d iterations for a smooth start; pressure zeroGradient", mdot, fs !== 1 ? pf(" (x 1/%.6g for the 2-D sector)", fs) : "", ramp)];
    } else {
      out_U = "type            pressureInletOutletVelocity;\nvalue           uniform (0 0 0);";
      const pout = comp ? der.p_out : (der.p_out - p0) / rho, pstart = comp ? p0 : 0.0;
      out_p = pf("type            uniformFixedValue;\nuniformValue    table ((0 %.9g) (%d %.9g));\nvalue           uniform %.9g;", pstart, ramp, pout, pstart);
      prov_out = [pf("outlet: static pressure p0/PR = %.2f Pa (%s), ramped from ambient over the first %d iterations", der.p_out, comp ? "absolute" : pf("kinematic gauge %.6g m2/s2", pout), ramp)];
    }
    make("U", "volVectorField", "[0 1 -1 0 0 0 0]", "uniform (0 0 0)", { atmosphere: "type            pressureInletOutletVelocity;\nvalue           uniform (0 0 0);", outlet: out_U, wall: "type            noSlip;" }, prov_out);
    if (comp) {
      const atm_p = pf("type            totalPressure;\np0              uniform %.9g;\nvalue           uniform %.9g;", p0, p0);
      make("p", "volScalarField", "[1 -1 -2 0 0 0 0]", pf("uniform %.9g", p0), { atmosphere: atm_p, outlet: out_p, wall: "type            zeroGradient;" }, prov_out.concat(["p is absolute static pressure [Pa]"]));
      make("T", "volScalarField", "[0 0 0 1 0 0 0]", pf("uniform %.9g", T0), {
        atmosphere: pf("type            totalTemperature;\nT0              uniform %.9g;\ngamma           %.6g;\nvalue           uniform %.9g;", T0, GAMMA, T0),
        outlet: pf("type            inletOutlet;\ninletValue      uniform %.9g;\nvalue           uniform %.9g;", T0, T0),
        wall: "type            zeroGradient;   // adiabatic walls" }, []);
      make("alphat", "volScalarField", "[1 -1 -1 0 0 0 0]", "uniform 0", {
        atmosphere: "type            calculated;\nvalue           uniform 0;", outlet: "type            calculated;\nvalue           uniform 0;",
        wall: pf("type            compressible::alphatWallFunction;\nPrt             %.3g;\nvalue           uniform 0;", PR_T) }, [pf("turbulent Prandtl number Prt = %.2f", PR_T)]);
    } else {
      const atm_p = "type            totalPressure;\np0              uniform 0;\nvalue           uniform 0;";
      make("p", "volScalarField", "[0 2 -2 0 0 0 0]", "uniform 0", { atmosphere: atm_p, outlet: out_p, wall: "type            zeroGradient;" },
        prov_out.concat([pf("p is kinematic gauge pressure (p - p_amb)/rho [m2/s2], rho = %.5g kg/m3", rho)]));
    }
    make("k", "volScalarField", "[0 2 -2 0 0 0 0]", pf("uniform %.6g", k_in), {
      atmosphere: pf("type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;", k_in, k_in),
      outlet: pf("type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;", k_in, k_in),
      wall: pf("type            kqRWallFunction;\nvalue           uniform %.6g;", k_in) }, []);
    make("omega", "volScalarField", "[0 0 -1 0 0 0 0]", pf("uniform %.6g", om_in), {
      atmosphere: pf("type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;", om_in, om_in),
      outlet: pf("type            inletOutlet;\ninletValue      uniform %.6g;\nvalue           uniform %.6g;", om_in, om_in),
      wall: pf("type            omegaWallFunction;\nvalue           uniform %.6g;", om_in) }, []);
    make("nut", "volScalarField", "[0 2 -1 0 0 0 0]", "uniform 0", {
      atmosphere: "type            calculated;\nvalue           uniform 0;", outlet: "type            calculated;\nvalue           uniform 0;",
      wall: "type            nutUSpaldingWallFunction;\nvalue           uniform 0;" },
      ["walls: nutUSpaldingWallFunction (valid from y+~1 to the log layer, so it is correct for both the wall-resolved 2-D mesh and the wall-function 3-D mesh)"]);
  }
  function physics_files(cw, d, der) {
    const comp = der.compressible;
    const prov = [pf("dry air: R = %.3f J/kgK (M = %.4f g/mol), cp = %.1f J/kgK, gamma = %.4f", R_AIR, M_AIR * 1e3, CP_AIR, GAMMA),
      pf("Sutherland viscosity As = %.4g, Ts = %.1f K -> mu(%.1f K) = %.5g Pa s", SUTH_AS, SUTH_TS, der.T_amb, der.mu_amb)];
    if (comp) {
      const body = pf("thermoType\n{\n    type            hePsiThermo;\n    mixture         pureMixture;\n    transport       sutherland;\n    thermo          hConst;\n    equationOfState perfectGas;\n    specie          specie;\n    energy          sensibleEnthalpy;\n}\n\nmixture\n{\n    specie\n    {\n        molWeight   %.6g;\n    }\n    thermodynamics\n    {\n        Cp          %.6g;\n        Hf          0;\n    }\n    transport\n    {\n        As          %.6g;\n        Ts          %.6g;\n    }\n}\n", M_AIR * 1e3, CP_AIR, SUTH_AS, SUTH_TS);
      cw.foam("constant/thermophysicalProperties", "dictionary", "thermophysicalProperties", body, prov, "constant");
    } else {
      const body = pf("transportModel  Newtonian;\n\nnu              %.9g;\n\nrhoInf          %.9g;\n", der.nu_amb, der.rho_amb);
      cw.foam("constant/transportProperties", "dictionary", "transportProperties", body, prov.concat([pf("incompressible: nu = mu/rho at ambient p, T = %.5g m2/s, rho = %.5g kg/m3", der.nu_amb, der.rho_amb)]), "constant");
    }
    const tb = "simulationType  RAS;\n\nRAS\n{\n    RASModel        kOmegaSST;\n    turbulence      on;\n    printCoeffs     on;\n}\n";
    cw.foam("constant/turbulenceProperties", "dictionary", "turbulenceProperties", tb, [
      "k-omega SST (Menter 1994/2003): blends k-omega near walls with k-epsilon in the free stream;",
      "the shear-stress limiter makes it the standard RANS choice for adverse pressure",
      "gradients and separation (sharp lips, vena contracta, diffusers, bends).",
      pf("Estimated tract Re = %.3g (D = %.2f mm, U_bulk = %.2f m/s)", der.Re, der.D_Re * 1e3, der.U_bulk)], "constant");
  }
  function numerics_files(cw, d, der, is3d, monitors, nonortho) {
    const comp = der.compressible;
    const psolver = is3d ? "solver          GAMG;\n        smoother        GaussSeidel;" : "solver          PCG;\n        preconditioner  DIC;";
    const lim = is3d ? "limited corrected 0.5" : "corrected";
    const div = ["div(phi,U)      bounded Gauss linearUpwindV grad(U);"];
    if (comp) div.push("div(phi,h)      bounded Gauss linearUpwind limited;", "div(phi,K)      bounded Gauss linearUpwind limited;", "div(phi,Ekp)    bounded Gauss linearUpwind limited;", "div(phid,p)     Gauss limitedLinear 1;", "div(((rho*nuEff)*dev2(T(grad(U))))) Gauss linear;");
    else div.push("div((nuEff*dev2(T(grad(U))))) Gauss linear;");
    div.push("div(phi,k)      bounded Gauss limitedLinear 1;", "div(phi,omega)  bounded Gauss limitedLinear 1;");
    const schemes = "ddtSchemes\n{\n    default         steadyState;\n}\n\ngradSchemes\n{\n    default         Gauss linear;\n    limited         cellLimited Gauss linear 1;\n    grad(U)         $limited;\n    grad(h)         $limited;\n    grad(k)         $limited;\n    grad(omega)     $limited;\n}\n\ndivSchemes\n{\n    default         none;\n" +
      div.map(x => "    " + x).join("\n") + "\n}\n\nlaplacianSchemes\n{\n    default         Gauss linear " + lim + ";\n}\n\ninterpolationSchemes\n{\n    default         linear;\n}\n\nsnGradSchemes\n{\n    default         " + lim.replace("Gauss linear ", "") + ";\n}\n\nwallDist\n{\n    method          meshWave;\n}\n";
    cw.foam("system/fvSchemes", "dictionary", "fvSchemes", schemes, [
      "second-order bounded linear-upwind convection for U" + (comp ? " and enthalpy" : "") + "; limitedLinear (TVD) for k, omega",
      "cell-limited gradients for robustness at sharp lips",
      "laplacian/snGrad: " + lim + " (" + (is3d ? "snappyHexMesh 3-D" : "structured 2-D sector") + " mesh)"]);
    let sol;
    if (comp) {
      sol = "solvers\n{\n    p\n    {\n        @PSOLVER@\n        tolerance       1e-12;\n        relTol          0.01;\n    }\n    \"(U|h|k|omega)\"\n    {\n        solver          smoothSolver;\n        smoother        symGaussSeidel;\n        tolerance       1e-10;\n        relTol          0.1;\n    }\n}\n\nSIMPLE\n{\n    nNonOrthogonalCorrectors " + nonortho + ";\n    consistent      no;       // classic SIMPLE: SIMPLEC without density\n                              // relaxation oscillated/diverged on sharp-edged\n                              // inlets in testing; this setting does not\n    transonic       " + (der.transonic ? "yes" : "no") + ";\n    pMinFactor      0.5;\n    pMaxFactor      1.5;\n    residualControl\n    {\n        p               1e-6;\n        U               1e-7;\n        h               1e-7;\n        \"(k|omega)\"     1e-6;\n    }\n}\n\nrelaxationFactors\n{\n    fields\n    {\n        p               0.3;\n        rho             0.05;\n    }\n    equations\n    {\n        U               0.7;\n        h               0.7;\n        \"(k|omega)\"     0.7;\n    }\n}\n";
    } else {
      sol = "solvers\n{\n    p\n    {\n        @PSOLVER@\n        tolerance       1e-12;\n        relTol          0.01;\n    }\n    \"(U|k|omega)\"\n    {\n        solver          smoothSolver;\n        smoother        symGaussSeidel;\n        tolerance       1e-10;\n        relTol          0.1;\n    }\n}\n\nSIMPLE\n{\n    nNonOrthogonalCorrectors " + nonortho + ";\n    consistent      no;       // classic SIMPLE: SIMPLEC (U 0.8) diverged on long\n                              // flow-rate-driven pipes (80 D at Re 1e5); this gives\n                              // the same converged answer within 0.03 % on the\n                              // square-cut pipe case\n    residualControl\n    {\n        p               1e-6;\n        U               1e-7;\n        \"(k|omega)\"     1e-6;\n    }\n}\n\nrelaxationFactors\n{\n    fields\n    {\n        p               0.3;\n    }\n    equations\n    {\n        U               0.7;\n        \"(k|omega)\"     0.7;\n    }\n}\n";
    }
    sol = sol.replace("@PSOLVER@", psolver);
    // 3-D intake cases cache grad(U), so that the explicit viscous-stress term is not taken from a reused temporary
    // (the conda-forge Linux build gets it wrong there: pipe friction 1.25x); cfd/NOTES.md 4(c4)
    const cache_grad = is3d && d.mode_kind !== "exhaust";
    if (cache_grad) sol += "\ncache\n{\n    grad(U);\n}\n";
    der.numerics = { algorithm: "SIMPLE", relaxation: comp ? "p 0.3 / rho 0.05 / U, h, k, omega 0.7" : "p 0.3 / U, k, omega 0.7",
      p_solver: is3d ? "GAMG" : "PCG/DIC", mesh: is3d ? "3-D snappyHexMesh" : "2-D sector, rotational cyclic sides" };   // recorded in case_info.json (intake_cfd.py)
    cw.foam("system/fvSolution", "dictionary", "fvSolution", sol, [
      "solver " + der.solver + ": " + der.solver_why,
      (comp ? "SIMPLE, relaxation p 0.3 / rho 0.05 / U, h, k, omega 0.7 (robust for separated compressible flow)" : "SIMPLE, relaxation p 0.3 / U, k, omega 0.7") + "; p solver: " + (is3d ? "GAMG (3-D)" : "PCG/DIC (2-D sector)"),
      pf("transonic formulation: %s (estimated peak Mach %.3f)", der.transonic ? "on" : "off", der.M_peak),
      "residual targets are a secondary stop; the primary stop is the engineering-quantity",
      "watchdog run by Allrun (see controlDict header) plus the iteration cap"].concat(cache_grad ?
      ["cache grad(U): the explicit viscous-stress term then reads a registered gradient instead of a reused",
       "temporary, which one Linux build (conda-forge) evaluates wrongly (3-D pipe friction 1.25x)"] : []));
  }
  function control_dict(cw, d, der, monitors, surfaces, n_iter, write_int, conv) {
    const fo = monitors.join("\n");
    const body = "application     " + der.solver + ";\n\nstartFrom       latestTime;\nstartTime       0;\nstopAt          endTime;\nendTime         " + n_iter + ";\ndeltaT          1;\nwriteControl    timeStep;\nwriteInterval   " + write_int + ";\npurgeWrite      2;\nwriteFormat     ascii;\nwritePrecision  10;\nwriteCompression off;\ntimeFormat      general;\ntimePrecision   8;\nrunTimeModifiable true;\n\nfunctions\n{\n" + fo + "\n" + surfaces + "\n" + conv + "\n}\n";
    cw.foam("system/controlDict", "dictionary", "controlDict", body, [
      "application " + der.solver + " chosen because " + der.solver_why,
      pf("endTime %d iterations = cap; writeInterval %d", n_iter, write_int),
      "function objects: mass flow on atmosphere/outlet patches, area-averaged static pressure on",
      "each named plane, y+, solver residuals, sampled planes (VTK) for intake_report.py.",
      "Convergence stop: Allrun's watchdog (intake_report.py --watch) sets stopAt writeNow once the",
      "inflow mass flow changes < 0.02 % and every plane's static pressure drop < 0.1 % over 300 iterations"]);
  }
  const FO_TAIL = "        writeFields     false;\n        log             false;\n        writeControl    timeStep;\n        writeInterval   %d;\n    }";
  function fo_patch_sum(name, patch, field, interval) {
    field = field || "phi"; interval = interval || 10;
    return pf("    %s\n    {\n        type            surfaceFieldValue;\n        libs            (fieldFunctionObjects);\n        regionType      patch;\n        name            %s;\n        operation       sum;\n        fields          (%s);\n" + FO_TAIL, name, patch, field, interval);
  }
  function fo_zone(name, zone, op, fields, interval) {
    interval = interval || 10;
    return pf("    %s\n    {\n        type            surfaceFieldValue;\n        libs            (fieldFunctionObjects);\n        regionType      faceZone;\n        name            %s;\n        operation       %s;\n        fields          (%s);\n" + FO_TAIL, name, zone, op, fields.join(" "), interval);
  }
  function surfaces_fo(planes, fields) {
    const lines = planes.map(([nm, pt, nn, bmin, bmax]) => pf("            %s\n            {\n                type        cuttingPlane;\n                planeType   pointAndNormal;\n                pointAndNormalDict\n                {\n                    point   %s;\n                    normal  %s;\n                }\n                bounds      %s %s;\n                interpolate false;\n            }", nm, _vec(pt), _vec(nn), _vec(bmin), _vec(bmax)));
    return "    planes\n    {\n        type            surfaces;\n        libs            (sampling);\n        writeControl    writeTime;\n        surfaceFormat   vtk;\n        formatOptions\n        {\n            vtk\n            {\n                format      ascii;\n                legacy      true;\n                precision   10;\n            }\n        }\n        fields          (" + fields.join(" ") + ");\n        interpolationScheme cell;\n        surfaces\n        {\n" + lines.join("\n") + "\n        }\n    }";
  }

  // ------------------------------------------------------------------ scripts and texts spliced in from intake_cfd.py by the build script
  const REPORT_PY = /*@REPORT_PY@*/"";
  const README_WINDOWS = /*@README_WINDOWS@*/"";
  const PY_SOURCE = /*@PY_SOURCE@*/"";
  function allrun_text(der, is3d) {
    const mesh = !is3d ? "run blockMesh\n" : "run blockMesh\nrun surfaceFeatureExtract\nrun snappyHexMesh -overwrite\n";
    return "set -u\ncd \"$(dirname \"$0\")\" || exit 1\nNP=${1:-1}          # ./Allrun 4   -> run the solver on 4 cores\n\nif ! command -v blockMesh >/dev/null 2>&1; then\n    echo \"OpenFOAM environment not loaded.\"\n    echo \"  Ubuntu/WSL (openfoam.com packages):  openfoam2412   (opens a shell with it loaded)\"\n    echo \"  or:  source /usr/lib/openfoam/openfoam2412/etc/bashrc\"\n    exit 1\nfi\n\nrun() {\n    app=$1; shift\n    echo \"Running $app $*\"\n    if ! \"$app\" \"$@\" > \"log.$app\" 2>&1; then\n        echo \"  $app FAILED -- see log.$app\"; tail -n 30 \"log.$app\"; exit 1\n    fi\n}\n\n" + mesh +
      "checkMesh > log.checkMesh 2>&1\nif grep -q \"Failed [0-9]* mesh checks\" log.checkMesh; then\n    echo \"WARNING: checkMesh reports failed checks -- see log.checkMesh\"\n    grep -E \"\\*\\*\\*|Failed\" log.checkMesh | head -n 20\nelse\n    echo \"checkMesh: mesh OK\"\nfi\nrun topoSet\n\nSOLVER=$(foamDictionary -entry application -value system/controlDict)\nif command -v python3 >/dev/null 2>&1; then PY=python3; else PY=python; fi\nif [ \"$NP\" -gt 1 ]; then\n    foamDictionary -entry numberOfSubdomains -set \"$NP\" system/decomposeParDict > /dev/null\n    run decomposePar -force\n    echo \"Running $SOLVER on $NP cores\"\n    mpirun -np \"$NP\" \"$SOLVER\" -parallel > \"log.$SOLVER\" 2>&1 &\n    SPID=$!\n    $PY intake_report.py --watch $SPID &\n    WPID=$!\n    if ! wait $SPID; then echo \"$SOLVER FAILED\"; tail -n 30 \"log.$SOLVER\"; kill $WPID 2>/dev/null; exit 1; fi\n    kill $WPID 2>/dev/null; wait $WPID 2>/dev/null\n    run reconstructPar -latestTime\nelse\n    echo \"Running $SOLVER\"\n    \"$SOLVER\" > \"log.$SOLVER\" 2>&1 &\n    SPID=$!\n    $PY intake_report.py --watch $SPID &\n    WPID=$!\n    if ! wait $SPID; then echo \"  $SOLVER FAILED -- see log.$SOLVER\"; tail -n 30 \"log.$SOLVER\"; kill $WPID 2>/dev/null; exit 1; fi\n    kill $WPID 2>/dev/null; wait $WPID 2>/dev/null\nfi\n# restore stopAt so that a restarted run continues normally\nsed -i 's/stopAt          writeNow;/stopAt          endTime;/' system/controlDict\n\n$PY intake_report.py\ntouch case.foam    # open this file in ParaView\n";
  }
  function allclean_text() { return "cd \"$(dirname \"$0\")\" || exit 1\nrm -rf processor* postProcessing log.* results.json results.txt case.foam\nfor d in [1-9]*; do [ -d \"$d\" ] && rm -rf \"$d\"; done\nrm -rf constant/polyMesh constant/extendedFeatureEdgeMesh constant/triSurface/*.eMesh\n"; }

  function r12(x) { return (typeof x === 'number' && Number.isFinite(x)) ? parseFloat(fmtG(x, 12)) : x; }
  function nowStamp() { const d = new Date(), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  // ------------------------------------------------------------------ case assembly
  /** generateCase(design, opts) -> {files:[{name,text,exec}], summary, is3d, pythonNeeded}
   *  opts.stamp     'YYYY-MM-DD HH:MM' (default: now)
   *  opts.out_dir   string written into generator_summary.json (Python writes the absolute path)
   *  opts.design_text  the design as JSON text; when given, design_input.json keeps its int/float spelling like Python would */
  function generateCase(design, opts) {
    opts = opts || {};
    const stamp = opts.stamp || nowStamp();
    const modeKind = String(_get(design, "mode", "intake")).toLowerCase();
    if (modeKind === "exhaust") {
      // exhaust-component mode is STL-only (snappyHexMesh): ship the design and the Python generator
      const dtext = opts.design_text ? pyjsonRoundtrip(opts.design_text) : pyjson(design);
      const files = [{ name: "design.json", text: dtext }, { name: "intake_cfd.py", text: PY_SOURCE }, { name: "README.md", text: README_EXHAUST }, { name: "README_WINDOWS.md", text: README_WINDOWS }];
      return { files, is3d: true, pythonNeeded: true, summary: { name: String(_get(design, "name", "exhaust")), mesh: "3-D (snappyHexMesh), generated by intake_cfd.py", why: "exhaust component from an STL" } };
    }
    const d = normalise(design), g = d.geometry;
    if (g.kind === "stl" || g.kind === "3d") {
      // 3-D cases (bend, force_3d, STL) need snappyHexMesh dictionaries that are not ported: ship the design and the Python generator
      const files = [];
      const dtext = opts.design_text ? pyjsonRoundtrip(opts.design_text) : pyjson(design);
      files.push({ name: "design.json", text: dtext });
      files.push({ name: "intake_cfd.py", text: PY_SOURCE });
      files.push({ name: "README.md", text: README_3D });
      files.push({ name: "README_WINDOWS.md", text: README_WINDOWS });
      let why = g.kind === "stl" ? "STL geometry from CAD" : "a bend makes the tract three-dimensional";
      return { files, is3d: true, pythonNeeded: true, summary: { name: d.name, mesh: "3-D (snappyHexMesh), generated by intake_cfd.py", why } };
    }
    g.profile = inlet_profile(g);
    const der = derive(d), is3d = false;
    const cw = new CaseWriter(d.name, stamp);
    const planes_info = [], monitors = [], write_int = d.write_interval || 500;
    const [W, minfo] = build_axisym_mesh(d, der);
    der.flow_scale = 2.0 * Math.PI / Math.sin(radians(minfo.sector_deg));   // full circle / flat-chord sector area (intake_cfd.py)
    const patches = { atmosphere: "atmosphere", outlet: "outlet", inlet_wall: "wall", tract_wall: "wall", extension_wall: "wall", front: "cyclic", back: "cyclic" };
    if (minfo.free) patches.plenum_wall = "wall";
    const prof = g.profile, st = minfo.stations;
    const prov_mesh = [
      "geometry: " + prof.label,
      pf("tube D = %.3f mm, tract length (mouth plane -> tract end) = %.2f mm", g.D * 1e3, g.L * 1e3),
      "mount: " + g.mount + (minfo.free ? pf(", protrusion into the atmosphere %.2f mm (back wall at x = %.2f mm)", minfo.protrusion * 1e3, minfo.protrusion * 1e3) : " (inlet flush with a plane wall)"),
      "diameter change: " + (g.dc ? pf("to %.2f mm, cone half-angle %.1f deg, from x = %.1f mm", g.dc.D2 * 1e3, degrees(g.dc.beta), g.dc.x0 * 1e3) : "none"),
      pf("atmosphere region radius %.1f mm (= max(15 D, 8 x outer lip dia.)), total-pressure boundary", minfo.Rff * 1e3),
      pf("outlet extension %.1f D after the tract end so the outlet BC cannot affect the tract", g.ext_D),
      pf("2-D axisymmetric %.0f deg sector (no bend) -> blockMesh, %d cells; the sector's two sides are a rotational", minfo.sector_deg, minfo.ncells),
      "  cyclic pair, not wedge patches (on wedge patches the Linux reference build gave developed pipe flow 1.25x the friction pressure drop; cfd/NOTES.md 4 (e))",
      pf("wall-resolved: first cell %.4g mm -> y+ ~ 1 at the estimated peak velocity %.1f m/s", minfo.h_wall * 1e3, der.U_peak),
      pf("body-fitted wall layer %.3f mm (0.15 R) on every wall, %d cells, grid lines wall-normal;", minfo.delta * 1e3, minfo.n_layer),
      pf("  'sharp' edges carry a machined-edge radius of %.3f mm (min(0.001 D, 0.05 mm))", _edge_radius(g) * 1e3),
      pf("mesh level '%s': %d cells across the tube radius, %d from mouth to far field", d.mesh_level, minfo.n_r, minfo.n_up),
      "stations (block faces): " + st.map(([x, t]) => pf("%s@%.2fmm", t, x * 1e3)).join(", ")];
    cw.foam("system/blockMeshDict", "dictionary", "blockMeshDict", W.write(), prov_mesh);
    const topo = [];
    for (const [x, tag] of st) {
      const names = [];
      for (const t of tag.split("|")) { if (t === "tract_end") names.push("tract_end"); else if (t.startsWith("plane:")) names.push(t.slice(6)); }
      for (const nm of names) {
        const r = tube_radius(g, pymin(x, g.L)), eps = 1e-6 * g.D, pt = [x + eps, 0.0, 0.0], nn = [1.0, 0.0, 0.0];
        const bmin = [x - 0.5 * g.D, -1.01 * r, -1.01 * r], bmax = [x + 0.5 * g.D, 1.01 * r, 1.01 * r];
        planes_info.push({ name: nm, point: [x, 0.0, 0.0], normal: [1.0, 0.0, 0.0], cut_point: pt.slice(), bmin: bmin.slice(), bmax: bmax.slice(), label: pf("%.2fmm", x * 1e3), area_geometric_m2: Math.PI * r * r, x_m: x, radius_m: r });
        topo.push(pf("    {\n        name    %s;\n        type    faceZoneSet;\n        action  new;\n        source  planeToFaceZone;\n        point   %s;\n        normal  (1 0 0);\n        option  closest;\n    }", nm, _vec([x, 0.5 * r, 0.0])));
      }
    }
    cw.foam("system/topoSetDict", "dictionary", "topoSetDict", "actions\n(\n" + topo.join("\n") + "\n);\n", ["one faceZone per measurement plane (tract end, MAF, user planes) at the block faces", "chosen by the generator; used for runtime static-pressure monitors"]);
    for (const pl of planes_info) { monitors.push(fo_zone("p_" + pl.name, pl.name, "areaAverage", ["p"])); monitors.push(fo_zone("mdot_" + pl.name, pl.name, "sum", ["phi"])); }
    const n_iter = d.max_iter || 6000;
    const nonortho = (g.inlet.type === "taper" && g.inlet.alpha > radians(35)) ? 1 : 0;
    const cells = minfo.ncells, mesh_note = pf("2-D axisymmetric sector (rotational cyclic), %d cells", cells);
    if (!planes_info.some(p => p.name === "tract_end")) throw new DesignError("internal: tract_end plane missing");
    monitors.unshift(fo_patch_sum("mdot_outlet", "outlet"));
    monitors.unshift(fo_patch_sum("mdot_atmosphere", "atmosphere"));
    monitors.push("    yPlus\n    {\n        type            yPlus;\n        libs            (fieldFunctionObjects);\n        writeControl    writeTime;\n    }\n    residuals\n    {\n        type            solverInfo;\n        libs            (utilityFunctionObjects);\n        fields          (U p" + (der.compressible ? " h" : "") + " k omega);\n        writeResidualFields no;\n    }");
    const sfields = ["p", "U"].concat(der.compressible ? ["T", "rho"] : []);
    const surf = surfaces_fo(planes_info.map(pl => [pl.name, pl.cut_point, pl.normal, pl.bmin, pl.bmax]), sfields);
    const win = 300;
    control_dict(cw, d, der, monitors, surf, n_iter, write_int, "");
    field_files(cw, d, der, patches);
    physics_files(cw, d, der);
    numerics_files(cw, d, der, is3d, monitors, nonortho);
    cw.foam("system/decomposeParDict", "dictionary", "decomposeParDict", "numberOfSubdomains 2;\n\nmethod          scotch;\n", ["numberOfSubdomains is overwritten by './Allrun N'"]);
    const info = { name: d.name, solver: der.solver, compressible: der.compressible, gamma: GAMMA, R_air: R_AIR, cp: CP_AIR, p_amb: der.p_amb, T_amb: der.T_amb, rho_amb: der.rho_amb,
      flow_scale: der.flow_scale, planes: planes_info, reference_plane: "tract_end", conv_window: I(win), ramp: I(RAMP_ITER), stop_mdot_rel: 2e-4, stop_dp_rel: 1e-3,
      mode: der.mode, mdot_set: der.mdot === undefined ? null : der.mdot, p_out: der.p_out === undefined ? null : der.p_out, generator: VERSION, numerics: der.numerics, kind: "intake" };
    cw.raw("case_info.json", pyjson(info));
    cw.text("intake_report.py", lstrip_n(REPORT_PY), [pf("reads postProcessing/ and case_info.json (ambient p0/T0 = %.1f Pa / %.2f K, gamma %.4f)", der.p_amb, der.T_amb, GAMMA),
      "reference plane for K and Cd: tract_end (x = tube_length_mm, or the CAD outlet face)"], "#", false, "#!/usr/bin/env python3");
    cw.text("Allrun", allrun_text(der, is3d), ["mesh: " + mesh_note, "solver: " + der.solver], "#", true, "#!/bin/bash");
    cw.text("Allclean", allclean_text(), [], "#", true, "#!/bin/bash");
    cw.text("README_WINDOWS.md", README_WINDOWS);
    const summary = { name: d.name, generator: VERSION, openfoam: FOAM_VERSION, out_dir: opts.out_dir || d.name, mesh: mesh_note, cells: I(cells), solver: der.solver, solver_reason: der.solver_why,
      operating_point: der.op_source, mode: der.mode, mdot_kg_s: der.mdot === undefined ? null : r12(der.mdot), pressure_ratio: der.PR === undefined ? null : r12(der.PR),
      M_bulk: r12(der.M_bulk), M_peak_est: r12(der.M_peak), U_bulk: r12(der.U_bulk), Re: r12(der.Re), f_colebrook: r12(der.f_colebrook), k_in: r12(der.k_in), omega_in: r12(der.omega_in),
      planes: planes_info.map(p => p.name), files: cw.files.slice().sort() };
    cw.raw("design_input.json", opts.design_text ? pyjsonRoundtrip(opts.design_text) : pyjson(design));
    cw.raw("generator_summary.json", pyjson(summary));
    const plain = Object.assign({}, summary, { cells, mdot_kg_s: summary.mdot_kg_s, M_bulk: der.M_bulk, U_bulk: der.U_bulk, Re: der.Re, M_peak_est: der.M_peak, is3d: false });
    return { files: cw.out, summary: plain, is3d: false, pythonNeeded: false };
  }
  const README_3D = "Three-dimensional intake case\n=============================\n\nThis design has a bend (or CAD geometry), so the tract is three-dimensional and\nis meshed with snappyHexMesh.  The browser writes the design only; the case\nitself is generated by the Python script in this folder (standard library,\nPython 3.8 or newer, no packages needed):\n\n    python3 intake_cfd.py design.json case\n\nThat writes a complete OpenFOAM v2412 case into ./case.  Then run it:\n\n    cd case\n    ./Allrun            # or ./Allrun 4 for 4 cores\n\nand read results.txt / results.json.  README_WINDOWS.md explains how to set up\nOpenFOAM on Windows (WSL2); Python is already part of that Ubuntu install.\n\nFor an STL from CAD: export the fluid volume in mm with solids named 'inlet'\nand 'outlet' (everything else is wall), put it next to design.json and set\n\"geometry\": {\"stl\": \"tract.stl\", \"stl_units\": \"mm\"} in design.json.\n";

  const README_EXHAUST = "Exhaust component CFD case\n==========================\n\nThis folder holds the design (design.json) and the case generator (intake_cfd.py,\nstandard-library Python 3, no packages).  The part itself comes from CAD:\n\n1. In Fusion (or any CAD), make the FLUID volume of the component: the gas space\n   inside the collector / X-pipe / muffler shell / tip, capped at every inlet and at\n   the outlet.  Export it as an ASCII STL in millimetres with the cap faces as\n   separate bodies (or separate STL files) named  inlet1, inlet2, ... (one per\n   primary; a single-inlet part may use just  inlet)  and  outlet.  Everything\n   else is wall.  The Fusion add-in's export does this for you.\n2. Put the STL next to design.json and check that \"geometry\": {\"stl\": ...} names it\n   (one file with named solids, or {\"wall\": ..., \"inlet1\": ..., \"outlet\": ...}).\n3. Generate and run (Linux, or Windows via WSL2, see README_WINDOWS.md):\n\n       python3 intake_cfd.py design.json case\n       cd case && ./Allrun          # ./Allrun 4 for 4 cores\n\n4. results.txt / results.json give the total-pressure loss inlet -> exit face in\n   Pa, kPa and mbar, the loss coefficient K in dynamic heads of the inlet bulk\n   velocity, the back pressure, the flow split between the inlets and the exit\n   velocity uniformity.  Load results.json on the calculator's Headers tab to\n   read it.\n\nThe inlets are extruded upstream by 2 diameters (a uniform-velocity inlet is\nimposed there) and the outlet downstream by 2 diameters, where the static\npressure is ambient.  Steady RANS (k-omega SST, compressible): no pulsation, no\nwave tuning, no sound; it ranks shapes by their steady loss.\n";
  // ------------------------------------------------------------------ results reader helpers (results.json written by intake_report.py)
  function readResults(text) {
    const r = JSON.parse(text);
    if (!r || !r.planes || !r.summary) throw new Error("not an intake_report results.json");
    return r;
  }
  function interpretExhaustK(K, part) {
    if (!Number.isFinite(K)) return "";
    const k = K.toFixed(2);
    if (K < 0.15) return "K " + k + ": very low loss for " + (part || "this part") + "; the gas hardly notices it.";
    if (K < 0.4) return "K " + k + ": a modest loss, typical of a gentle bend or a well-made merge (a 90\u00b0 mandrel bend at R/D 1.5 is about 0.2 to 0.3).";
    if (K < 1.0) return "K " + k + ": a clear loss, as from an abrupt area change (a sudden expansion to twice the diameter costs about 0.56) or a tight merge; ease the transitions.";
    return "K " + k + ": a large loss; the part works like a sharp obstruction (a sudden exit to atmosphere alone costs 1.0). Look at the merge angle, steps and the exit.";
  }
  function interpretK(K, planeName) {
    if (!Number.isFinite(K)) return "";
    const where = planeName === "tract_end" ? "at the tract end" : "at the " + planeName + " plane";
    if (K < 0.08) return "K " + K.toFixed(3) + " " + where + ": a well-rounded entry; little to gain at the mouth.";
    if (K < 0.2) return "K " + K.toFixed(3) + " " + where + ": modest entry loss, as from a small lip radius or a short run of friction.";
    if (K < 0.35) return "K " + K.toFixed(3) + " " + where + ": a noticeable loss; a bellmouth or a larger lip radius would cut it.";
    return "K " + K.toFixed(2) + " " + where + ": a sharp lip (a square-cut pipe loses about 0.4-0.5 of a dynamic head); fit a radius or a bellmouth.";
  }
  function interpretUI(ui) {
    if (!Number.isFinite(ui)) return "";
    if (ui >= 0.97) return "Velocity profile very even (" + ui.toFixed(3) + "): good for a MAF sensor.";
    if (ui >= 0.95) return "Velocity profile even enough for a MAF (" + ui.toFixed(3) + "; makers usually want 0.95 or more).";
    return "Velocity profile uneven (" + ui.toFixed(3) + "; MAF makers usually want 0.95 or more): move the sensor further from the inlet or a bend, or add a straightener.";
  }

  const IntakeCFD = { generateCase, normalise, derive, inlet_profile, tube_radius, tract_stations, build_axisym_mesh, DesignError, pf, fmtG, fmtF, fmtE, pyrepr, pyjson, pyjsonRoundtrip, pysum, pyhypot, pyround, PyInt, I,
    readResults, interpretK, interpretUI, interpretExhaustK, MESH_LEVELS, VERSION, FOAM_VERSION, PY_SOURCE, README_WINDOWS, REPORT_PY, R_AIR, GAMMA, ideal_mass_flux, engine_mass_flow };
  if (typeof module !== 'undefined' && module.exports) module.exports = IntakeCFD;
  root.IntakeCFD = IntakeCFD;
})(typeof window !== 'undefined' ? window : globalThis);
