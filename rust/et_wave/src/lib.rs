//! The calculator page's wave simulation (wsFactory in web/index.html) in Rust, for the page's background workers
//! as WebAssembly. One cylinder or several on a collector: 1-D pipes (MUSCL-Hancock with HLLC fluxes, wall friction
//! and heat), area steps and collector junctions by the characteristic method, valves as orifices, a filling and
//! emptying cylinder with a Wiebe burn and Woschni heat loss.
//!
//! Written line for line from the JavaScript, in its order of operations, so the results are the same doubles:
//! pow, sin, cos and exp come from the page (JavaScript's Math, imported as module "m") because those are not
//! correctly rounded and engines differ; sqrt, abs, floor, trunc and % are exact everywhere. Math.min and Math.max
//! keep JavaScript's rules (NaN wins, -0 below +0), and the spec's missing or zero values fall back to the same
//! defaults the JavaScript's `||` gives. web/tests/wave_wasm.js checks the two against each other.
//!
//! The C interface (for the page's glue): wave_alloc / wave_free for the spec text, wave_new (spec JSON -> handle,
//! 0 and wave_error on a bad spec), wave_step (one speed of the sweep, warm-started from the previous one; the
//! numbers land in wave_out), wave_drop.

use serde_json::Value;

#[allow(clippy::excessive_precision)]
mod m {
    #[cfg(target_arch = "wasm32")]
    #[link(wasm_import_module = "m")]
    extern "C" {
        fn pow(a: f64, b: f64) -> f64;
        fn sin(a: f64) -> f64;
        fn cos(a: f64) -> f64;
        fn exp(a: f64) -> f64;
    }
    #[cfg(target_arch = "wasm32")]
    pub fn powf(a: f64, b: f64) -> f64 {
        unsafe { pow(a, b) }
    }
    #[cfg(target_arch = "wasm32")]
    pub fn sinf(a: f64) -> f64 {
        unsafe { sin(a) }
    }
    #[cfg(target_arch = "wasm32")]
    pub fn cosf(a: f64) -> f64 {
        unsafe { cos(a) }
    }
    #[cfg(target_arch = "wasm32")]
    pub fn expf(a: f64) -> f64 {
        unsafe { exp(a) }
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn powf(a: f64, b: f64) -> f64 {
        a.powf(b)
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn sinf(a: f64) -> f64 {
        a.sin()
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn cosf(a: f64) -> f64 {
        a.cos()
    }
    #[cfg(not(target_arch = "wasm32"))]
    pub fn expf(a: f64) -> f64 {
        a.exp()
    }
}
use m::{cosf, expf, powf, sinf};

const PI: f64 = std::f64::consts::PI;
const GAM: f64 = 1.35;
const RG: f64 = 287.0;
const G1: f64 = GAM - 1.0;
const CV: f64 = RG / (GAM - 1.0);
const CP: f64 = GAM * CV;
const PATM: f64 = 101325.0;
const TATM: f64 = 298.15;
const LHV: f64 = 44e6;
const FANNING: f64 = 0.005;

// ------------------------------------------------------------------------------------------- gas properties (2026-11-12)
// The page's "gas properties" block, line for line: air (x = 1) and its burned gas (x = 0) at the engine's air-fuel ratio,
// thermally perfect, mixed by mass with the fresh-charge fraction x; each species' cp/R from the NASA 7-coefficient
// polynomials of GRI-Mech 3.0 (Cantera's data/gri30.yaml); spec.e.gas = "const" keeps gamma 1.35, R 287.
const RU: f64 = 8.314462618;
const TREF: f64 = 298.15;
const TMAX: f64 = 3500.0;
/// GRI-Mech 3.0: M g/mol, cp/R a1..a5 below 1000 K, a1..a5 above; order N2, O2, Ar, CO2, H2O, CO, H2.
#[allow(clippy::excessive_precision)]
const SPEC: [(f64, [f64; 5], [f64; 5]); 7] = [
    (28.0134, [3.298677, 1.4082404e-3, -3.963222e-6, 5.641515e-9, -2.444854e-12], [2.92664, 1.4879768e-3, -5.68476e-7, 1.0097038e-10, -6.753351e-15]),
    (31.9988, [3.78245636, -2.99673416e-3, 9.84730201e-6, -9.68129509e-9, 3.24372837e-12], [3.28253784, 1.48308754e-3, -7.57966669e-7, 2.09470555e-10, -2.16717794e-14]),
    (39.948, [2.5, 0.0, 0.0, 0.0, 0.0], [2.5, 0.0, 0.0, 0.0, 0.0]),
    (44.0095, [2.35677352, 8.98459677e-3, -7.12356269e-6, 2.45919022e-9, -1.43699548e-13], [3.85746029, 4.41437026e-3, -2.21481404e-6, 5.23490188e-10, -4.72084164e-14]),
    (18.01528, [4.19864056, -2.0364341e-3, 6.52040211e-6, -5.48797062e-9, 1.77197817e-12], [3.03399249, 2.17691804e-3, -1.64072518e-7, -9.7041987e-11, 1.68200992e-14]),
    (28.0101, [3.57953347, -6.1035368e-4, 1.01681433e-6, 9.07005884e-10, -9.04424499e-13], [2.71518561, 2.06252743e-3, -9.98825771e-7, 2.30053008e-10, -2.03647716e-14]),
    (2.01588, [2.34433112, 7.98052075e-3, -1.9478151e-5, 2.01572094e-8, -7.37611761e-12], [3.3372792, -4.94024731e-5, 4.99456778e-7, -1.79566394e-10, 2.00255376e-14]),
];
const AIR_N2: f64 = 3.7279; // per mole of O2
const AIR_AR: f64 = 0.04459;
const FUEL_Y: f64 = 1.87;
const K_WGS: f64 = 3.5;
fn afr_st() -> f64 {
    (1.0 + FUEL_Y / 4.0) * (AIR_N2 * SPEC[0].0 + SPEC[1].0 + AIR_AR * SPEC[2].0) / (12.0107 + FUEL_Y * 1.00794)
}
/// Moles of each species per C atom in the products at relative air-fuel ratio lam (held to 0.5-4).
fn burned_moles(lam: f64) -> [f64; 7] {
    let lam = jmin(4.0, jmax(0.5, lam));
    let y = FUEL_Y;
    let o = 1.0 + y / 4.0;
    let n2 = lam * o * AIR_N2;
    let ar = lam * o * AIR_AR;
    if lam >= 1.0 {
        return [n2, (lam - 1.0) * o, ar, 1.0, y / 2.0, 0.0, 0.0];
    }
    let s = 2.0 * lam * o - 1.0;
    let qa = K_WGS - 1.0;
    let qb = K_WGS * (y / 2.0 - s) + 1.0 + s;
    let a = (-qb + (qb * qb + 4.0 * qa * s).sqrt()) / (2.0 * qa);
    [n2, 0.0, ar, a, s - a, 1.0 - a, y / 2.0 - s + a]
}
/// Per-kg polynomials of a mixture of moles n: cp a0..a4, h b1..b5 and its constant, below and above 1000 K; and R.
fn gas_poly(n: &[f64; 7]) -> (f64, [f64; 11], [f64; 11]) {
    let mut m = 0.0;
    let mut nn = 0.0;
    for k in 0..7 {
        m += n[k] * SPEC[k].0;
        nn += n[k];
    }
    let s = RU * 1000.0 / m;
    let mk = |hi: bool| {
        let mut c = [0.0; 5];
        for j in 0..5 {
            let mut t = 0.0;
            for k in 0..7 {
                t += n[k] * if hi { SPEC[k].2[j] } else { SPEC[k].1[j] };
            }
            c[j] = s * t;
        }
        [c[0], c[1], c[2], c[3], c[4], c[0], c[1] / 2.0, c[2] / 3.0, c[3] / 4.0, c[4] / 5.0, 0.0]
    };
    let mut lo = mk(false);
    let mut hi = mk(true);
    let h = |c: &[f64; 11], t: f64| t * (c[5] + t * (c[6] + t * (c[7] + t * (c[8] + t * c[9]))));
    lo[10] = -h(&lo, TREF);
    hi[10] = h(&lo, 1000.0) + lo[10] - h(&hi, 1000.0);
    (s * nn, lo, hi)
}
#[derive(Clone, Copy)]
struct Gas {
    ra: f64,
    rb: f64,
    rd: f64,
    blo: [f64; 11],
    bhi: [f64; 11],
    dlo: [f64; 11],
    dhi: [f64; 11],
}
fn make_gas(afr: f64) -> Gas {
    let (ra, alo, ahi) = gas_poly(&[AIR_N2, 1.0, AIR_AR, 0.0, 0.0, 0.0, 0.0]);
    let (rb, blo, bhi) = gas_poly(&burned_moles(afr / afr_st()));
    let d = |a: &[f64; 11], b: &[f64; 11]| {
        let mut o = [0.0; 11];
        for j in 0..11 {
            o[j] = a[j] - b[j];
        }
        o
    };
    Gas { ra, rb, rd: ra - rb, blo, bhi, dlo: d(&alo, &blo), dhi: d(&ahi, &bhi) }
}
/// cp, h, R at (T, x); cp held at its end value outside 200-3500 K (h linear there).
fn gas_at(g: &Gas, t: f64, x: f64) -> (f64, f64, f64) {
    let tc = if t > TMAX {
        TMAX
    } else if t < 200.0 {
        200.0
    } else {
        t
    };
    let (b, d) = if tc > 1000.0 { (&g.bhi, &g.dhi) } else { (&g.blo, &g.dlo) };
    let c0 = b[0] + x * d[0];
    let c1 = b[1] + x * d[1];
    let c2 = b[2] + x * d[2];
    let c3 = b[3] + x * d[3];
    let c4 = b[4] + x * d[4];
    let h1 = b[5] + x * d[5];
    let h2 = b[6] + x * d[6];
    let h3 = b[7] + x * d[7];
    let h4 = b[8] + x * d[8];
    let h5 = b[9] + x * d[9];
    let h0 = b[10] + x * d[10];
    let cp = c0 + tc * (c1 + tc * (c2 + tc * (c3 + tc * c4)));
    let h = tc * (h1 + tc * (h2 + tc * (h3 + tc * (h4 + tc * h5)))) + h0 + cp * (t - tc);
    (cp, h, g.rb + x * g.rd)
}
fn gas_r(g: &Gas, x: f64) -> f64 {
    g.rb + x * g.rd
}
fn gas_h(g: &Gas, t: f64, x: f64) -> f64 {
    gas_at(g, t, x).1
}
fn gas_e(g: &Gas, t: f64, x: f64) -> f64 {
    let (_cp, h, r) = gas_at(g, t, x);
    h - r * t
}
/// The temperature whose internal energy (by_h: enthalpy) is v, Newton from t; also cp, R of the last iterate.
fn gas_t(g: &Gas, v: f64, x: f64, t: f64, by_h: bool) -> (f64, f64, f64) {
    let mut t = t;
    let (mut cp, mut r) = (0.0, 0.0);
    for _ in 0..30 {
        let (c, h, rr) = gas_at(g, t, x);
        cp = c;
        r = rr;
        let dt = if by_h { (h - v) / c } else { (h - rr * t - v) / (c - rr) };
        t -= dt;
        if t < 100.0 {
            t = 100.0;
        }
        if !(dt.abs() > 1e-9 * t) {
            break;
        }
    }
    (t, cp, r)
}

/// JavaScript's Math.min of two numbers.
fn jmin(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a < b {
        a
    } else if b < a {
        b
    } else if a.is_sign_negative() {
        a
    } else {
        b
    }
}
/// JavaScript's Math.max of two numbers.
fn jmax(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a > b {
        a
    } else if b > a {
        b
    } else if a.is_sign_positive() {
        a
    } else {
        b
    }
}
/// JavaScript's Math.round.
fn jround(x: f64) -> f64 {
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}
/// The constants the JavaScript works out with Math.pow when the model is made.
struct K {
    prc: f64,
    psic: f64,
}
fn consts() -> K {
    let prc = powf(2.0 / (GAM + 1.0), GAM / G1);
    let psic = GAM.sqrt() * powf(2.0 / (GAM + 1.0), (GAM + 1.0) / (2.0 * G1));
    K { prc, psic }
}

// ------------------------------------------------------------------------------------------- spec (from JSON)

/// A JSON number, NaN for anything else (undefined and null act as NaN in the JavaScript's arithmetic here).
fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(f64::NAN)
}
/// JavaScript truthiness of a value used as a number default (`x || d`): missing, null, false, 0 and NaN fall back.
fn or(v: &Value, d: f64) -> f64 {
    match v.as_f64() {
        Some(x) if x != 0.0 && !x.is_nan() => x,
        _ => match v {
            Value::Bool(true) => 1.0,
            _ => d,
        },
    }
}
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|x| x != 0.0 && !x.is_nan()),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

#[derive(Clone)]
struct Seg {
    l: f64,
    d0: f64,
    d1: f64,
}
fn segs_of(v: &Value) -> Result<Vec<Seg>, String> {
    let a = v.as_array().ok_or("a line needs its segs")?;
    Ok(a.iter().map(|s| Seg { l: num(&s["L"]), d0: num(&s["d0"]), d1: num(&s["d1"]) }).collect())
}
#[derive(Clone)]
struct Line {
    segs: Vec<Seg>,
    tw: Value,
}
fn line_of(v: &Value) -> Result<Line, String> {
    Ok(Line { segs: segs_of(&v["segs"])?, tw: v["Tw"].clone() })
}

struct Stage {
    groups: Vec<Vec<f64>>,
    segs: Option<Vec<Seg>>,
    segs_by_group: Option<Vec<Option<Vec<Seg>>>>,
    tw: Value,
}
struct ColSpec {
    cyls: Vec<f64>,
    stages: Vec<Stage>,
    segs: Vec<Seg>,
    tw: Value,
}

struct Engine {
    bore: f64,
    stroke: f64,
    afr: f64,
    eta: f64,
    burn_dur: f64,
    woschni: bool,
    twall: f64,
    ap: f64,
    vd: f64,
    vc: f64,
    crank: f64,
    rod: f64,
    cd: f64,
    n_in: f64,
    d_in: f64,
    lift_in: f64,
    n_ex: f64,
    d_ex: f64,
    lift_ex: f64,
    evo: f64,
    evdur: f64,
    ivo: f64,
    ivdur: f64,
    ivc: f64,
    ign: f64,
    phases: Vec<f64>,
    collector: Option<Line>,
    collectors: Option<Vec<ColSpec>>,
    intake: Line,
    exhaust: Line,
    per_cyl: Option<Vec<Option<Vec<Seg>>>>,
    chambers: Vec<[f64; 4]>, // x, V, A, Le
    k: K,
    gas: Option<Gas>, // None: e.gas "const", gamma 1.35 and R 287
}

const fn rad(d: f64) -> f64 {
    d * PI / 180.0
}

impl Engine {
    fn vol(&self, th: f64) -> f64 {
        let t = rad(th);
        let s = sinf(t);
        let (cr, rod) = (self.crank, self.rod);
        self.vc + self.ap * (cr + rod - cr * cosf(t) - (rod * rod - cr * cr * s * s).sqrt())
    }
    fn dvol(&self, th: f64) -> f64 {
        let t = rad(th);
        let (s, c) = (sinf(t), cosf(t));
        let (cr, rod) = (self.crank, self.rod);
        self.ap * cr * (s + cr * s * c / (rod * rod - cr * cr * s * s).sqrt())
    }
    fn area(&self, th: f64, open: f64, dur: f64, lift: f64, d: f64, nv: f64) -> f64 {
        let l = lift_at(th, open, dur, lift);
        if l > 0.0 {
            nv * self.cd * jmin(PI * d * l, 0.85 * PI / 4.0 * d * d)
        } else {
            0.0
        }
    }
    fn cda_in(&self, th: f64) -> f64 {
        self.area(th, self.ivo, self.ivdur, self.lift_in, self.d_in, self.n_in)
    }
    fn cda_ex(&self, th: f64) -> f64 {
        self.area(th, self.evo, self.evdur, self.lift_ex, self.d_ex, self.n_ex)
    }
}

fn lift_at(th: f64, open: f64, dur: f64, lmax: f64) -> f64 {
    let mut a = th - open;
    a = ((a % 720.0) + 720.0) % 720.0;
    if a >= dur {
        return 0.0;
    }
    let s = sinf(PI * a / dur);
    lmax * s * s
}
fn wiebe(a: f64, dur: f64) -> f64 {
    if a <= 0.0 {
        0.0
    } else if a >= dur {
        1.0
    } else {
        1.0 - expf(-5.0 * powf(a / dur, 3.0))
    }
}

fn make_engine(spec: &Value) -> Result<Engine, String> {
    let e = &spec["e"];
    let (intake, exhaust, o) = (&spec["intake"], &spec["exhaust"], &spec["opt"]);
    let bore = num(&e["bore"]);
    let stroke = num(&e["stroke"]);
    let ap = PI * bore * bore / 4.0;
    let vd = ap * stroke;
    let vc = vd / (num(&e["cr"]) - 1.0);
    let cam = &e["cam"];
    let evo = 180.0 - num(&cam["evo"]);
    let evdur = 180.0 + num(&cam["evo"]) + num(&cam["evc"]);
    let ivo = 360.0 - num(&cam["ivo"]);
    let ivdur = 180.0 + num(&cam["ivo"]) + num(&cam["ivc"]);
    let ivc = (ivo + ivdur) % 720.0;
    let ign = (720.0 - num(&e["burn"]["start"])) % 720.0;
    let phases: Vec<f64> = match o["phases"].as_array() {
        Some(a) if !a.is_empty() => a.iter().map(num).collect(),
        _ => vec![0.0],
    };
    // collector: phases.length>1||o.collector ? o.collector : null
    let collector = if (phases.len() > 1 || truthy(&o["collector"])) && truthy(&o["collector"]) {
        Some(line_of(&o["collector"])?)
    } else {
        None
    };
    let collectors = match o["collectors"].as_array() {
        Some(a) if !a.is_empty() => {
            let mut out = Vec::new();
            for c in a {
                let mut stages = Vec::new();
                for s in c["stages"].as_array().map(|v| v.as_slice()).unwrap_or(&[]) {
                    let groups = s["groups"]
                        .as_array()
                        .ok_or("a collector stage needs its groups")?
                        .iter()
                        .map(|g| g.as_array().map(|x| x.iter().map(num).collect()).unwrap_or_default())
                        .collect();
                    let segs = if s["segs"].is_array() { Some(segs_of(&s["segs"])?) } else { None };
                    let segs_by_group = match s["segs_by_group"].as_array() {
                        Some(b) if truthy(&s["segs_by_group"]) => {
                            let mut v = Vec::new();
                            for x in b {
                                v.push(if truthy(x) { Some(segs_of(x)?) } else { None });
                            }
                            Some(v)
                        }
                        _ => None,
                    };
                    stages.push(Stage { groups, segs, segs_by_group, tw: s["Tw"].clone() });
                }
                out.push(ColSpec {
                    cyls: c["cyls"].as_array().ok_or("a collector needs its cyls")?.iter().map(num).collect(),
                    stages,
                    segs: segs_of(&c["segs"])?,
                    tw: c["Tw"].clone(),
                });
            }
            Some(out)
        }
        _ => None,
    };
    let per_cyl = match exhaust["per_cyl"].as_array() {
        Some(a) if truthy(&exhaust["per_cyl"]) => {
            let mut v = Vec::new();
            for x in a {
                v.push(if truthy(x) { Some(segs_of(x)?) } else { None });
            }
            Some(v)
        }
        _ => None,
    };
    let chambers = exhaust["chambers"]
        .as_array()
        .map(|a| a.iter().map(|c| [num(&c["x"]), num(&c["V"]), num(&c["A"]), num(&c["Le"])]).collect())
        .unwrap_or_default();
    Ok(Engine {
        bore,
        stroke,
        afr: num(&e["afr"]),
        eta: num(&e["eta"]),
        burn_dur: num(&e["burn"]["dur"]),
        woschni: e["woschni"] != Value::Bool(false),
        twall: or(&e["Twall"], 450.0),
        ap,
        vd,
        vc,
        crank: stroke / 2.0,
        rod: num(&e["rod"]),
        cd: num(&e["cd"]),
        n_in: num(&e["nIn"]),
        d_in: num(&e["dIn"]),
        lift_in: num(&e["liftIn"]),
        n_ex: num(&e["nEx"]),
        d_ex: num(&e["dEx"]),
        lift_ex: num(&e["liftEx"]),
        evo,
        evdur,
        ivo,
        ivdur,
        ivc,
        ign,
        phases,
        collector,
        collectors,
        intake: line_of(intake)?,
        exhaust: line_of(exhaust)?,
        per_cyl,
        chambers,
        k: consts(),
        gas: if e["gas"].as_str() == Some("const") { None } else { Some(make_gas(num(&e["afr"]))) },
    })
}

// ------------------------------------------------------------------------------------------- pipes

#[derive(Clone, Copy)]
enum Src {
    In(usize),
    Ex(usize),
}
#[derive(Clone, Copy)]
enum Bnd {
    Noop,
    Open(f64),
    Fed(f64, Src),
}

struct Pipe {
    n: usize,
    dx: f64,
    a: Vec<f64>,
    af: Vec<f64>,
    d: Vec<f64>,
    q1: Vec<f64>,
    q2: Vec<f64>,
    q3: Vec<f64>,
    q4: Vec<f64>,
    tw: f64,
    r: Vec<f64>,
    u: Vec<f64>,
    p: Vec<f64>,
    x: Vec<f64>,
    dr: Vec<f64>,
    du: Vec<f64>,
    dp: Vec<f64>,
    dxs: Vec<f64>,
    f1: Vec<f64>,
    f2: Vec<f64>,
    f3: Vec<f64>,
    f4: Vec<f64>,
    left: Bnd,
    right: Bnd,
    start: f64,
    jp: f64,
    jq: f64,
    // the engine's gas (None: gamma 1.35, R 287) and each cell's gamma, cp, R and temperature
    gas: Option<Gas>,
    g: Vec<f64>,
    cp: Vec<f64>,
    rm: Vec<f64>,
    t: Vec<f64>,
}

#[allow(clippy::too_many_arguments)]
fn make_pipe(l: f64, dx_want: f64, area: &dyn Fn(f64) -> f64, tw: f64, t0: f64, x0: f64, gas: Option<Gas>) -> Result<Pipe, String> {
    let nf = jmax(6.0, jround(l / dx_want));
    if !(nf.is_finite() && nf >= 1.0 && nf < 1e7) {
        return Err("a pipe in the spec has no usable length".into());
    }
    let n = nf as usize;
    let dx = l / nf;
    let mut a = vec![0.0; n];
    let mut af = vec![0.0; n + 1];
    let mut d = vec![0.0; n];
    for i in 0..n {
        a[i] = area((i as f64 + 0.5) * dx);
        d[i] = (4.0 * a[i] / PI).sqrt();
    }
    af[0] = a[0];
    af[n] = a[n - 1];
    for j in 1..n {
        af[j] = 0.5 * (a[j - 1] + a[j]);
    }
    let t0 = if t0 != 0.0 && !t0.is_nan() { t0 } else { TATM };
    let rho0 = PATM / ((match &gas { Some(g) => gas_r(g, x0), None => RG }) * t0);
    let e0 = match &gas { Some(g) => gas_e(g, t0, x0), None => 0.0 };
    let (mut q1, mut q2, mut q3, mut q4) = (vec![0.0; n], vec![0.0; n], vec![0.0; n], vec![0.0; n]);
    for i in 0..n {
        q1[i] = rho0 * a[i];
        q2[i] = 0.0;
        q3[i] = if gas.is_some() { rho0 * e0 * a[i] } else { PATM / G1 * a[i] };
        q4[i] = rho0 * x0 * a[i];
    }
    let z = || vec![0.0; n];
    let z1 = || vec![0.0; n + 1];
    Ok(Pipe {
        n,
        dx,
        a,
        af,
        d,
        q1,
        q2,
        q3,
        q4,
        tw: if tw != 0.0 && !tw.is_nan() { tw } else { TATM },
        r: z(),
        u: z(),
        p: z(),
        x: z(),
        dr: z(),
        du: z(),
        dp: z(),
        dxs: z(),
        f1: z1(),
        f2: z1(),
        f3: z1(),
        f4: z1(),
        left: Bnd::Noop,
        right: Bnd::Noop,
        start: 0.0,
        jp: 0.0,
        jq: 0.0,
        gas,
        g: vec![GAM; n],
        cp: vec![CP; n],
        rm: vec![RG; n],
        t: vec![t0; n],
    })
}

fn minmod(a: f64, b: f64) -> f64 {
    if a * b <= 0.0 {
        0.0
    } else if a.abs() < b.abs() {
        a
    } else {
        b
    }
}
fn prim(p: &mut Pipe) {
    if let Some(g) = p.gas {
        for i in 0..p.n {
            let rr = p.q1[i] / p.a[i];
            let uu = p.q2[i] / p.q1[i];
            let xx = jmin(1.0, jmax(0.0, p.q4[i] / p.q1[i]));
            let (t, cp, r) = gas_t(&g, p.q3[i] / p.q1[i] - 0.5 * uu * uu, xx, p.t[i], false);
            p.r[i] = rr;
            p.u[i] = uu;
            p.x[i] = xx;
            p.t[i] = t;
            p.rm[i] = r;
            p.cp[i] = cp;
            p.g[i] = cp / (cp - r);
            p.p[i] = jmax(1.0, rr * r * t);
        }
        return;
    }
    for i in 0..p.n {
        let rr = p.q1[i] / p.a[i];
        let uu = p.q2[i] / p.q1[i];
        let e = p.q3[i] / p.a[i];
        p.r[i] = rr;
        p.u[i] = uu;
        p.p[i] = jmax(1.0, G1 * (e - 0.5 * rr * uu * uu));
        p.x[i] = jmin(1.0, jmax(0.0, p.q4[i] / p.q1[i]));
    }
}
fn max_speed(p: &Pipe) -> f64 {
    let mut s = 0.0;
    for i in 0..p.n {
        let v = p.u[i].abs() + (p.g[i] * p.p[i] / p.r[i]).sqrt();
        if v > s {
            s = v;
        }
    }
    s
}
/// HLLC flux per unit area (Toro).
#[allow(clippy::too_many_arguments)]
fn hllc(rl: f64, ul: f64, pl: f64, xl: f64, rr: f64, ur: f64, pr: f64, xr: f64, gas: &Option<Gas>) -> [f64; 4] {
    let (cl, cr, el, er);
    if let Some(g) = gas {
        let (cp, h, r) = gas_at(g, pl / (rl * gas_r(g, xl)), xl);
        cl = (cp / (cp - r) * pl / rl).sqrt();
        el = rl * (h - pl / rl) + 0.5 * rl * ul * ul;
        let (cp, h, r) = gas_at(g, pr / (rr * gas_r(g, xr)), xr);
        cr = (cp / (cp - r) * pr / rr).sqrt();
        er = rr * (h - pr / rr) + 0.5 * rr * ur * ur;
    } else {
        cl = (GAM * pl / rl).sqrt();
        cr = (GAM * pr / rr).sqrt();
        el = pl / G1 + 0.5 * rl * ul * ul;
        er = pr / G1 + 0.5 * rr * ur * ur;
    }
    let sl = jmin(ul - cl, ur - cr);
    let sr = jmax(ul + cl, ur + cr);
    if sl >= 0.0 {
        return [rl * ul, rl * ul * ul + pl, ul * (el + pl), rl * ul * xl];
    }
    if sr <= 0.0 {
        return [rr * ur, rr * ur * ur + pr, ur * (er + pr), rr * ur * xr];
    }
    let ss = (pr - pl + rl * ul * (sl - ul) - rr * ur * (sr - ur)) / (rl * (sl - ul) - rr * (sr - ur));
    if ss >= 0.0 {
        let k = rl * (sl - ul) / (sl - ss);
        [
            rl * ul + sl * (k - rl),
            rl * ul * ul + pl + sl * (k * ss - rl * ul),
            ul * (el + pl) + sl * (k * (el / rl + (ss - ul) * (ss + pl / (rl * (sl - ul)))) - el),
            rl * ul * xl + sl * (k * xl - rl * xl),
        ]
    } else {
        let k = rr * (sr - ur) / (sr - ss);
        [
            rr * ur + sr * (k - rr),
            rr * ur * ur + pr + sr * (k * ss - rr * ur),
            ur * (er + pr) + sr * (k * (er / rr + (ss - ur) * (ss + pr / (rr * (sr - ur)))) - er),
            rr * ur * xr + sr * (k * xr - rr * xr),
        ]
    }
}
/// The state at an open end (Benson's characteristic method, the page's openState, 2026-11-11); dir = +1 if the end
/// faces +x. Outflow leaves at the outside pressure with the end cell's entropy (sonic at most; a supersonic exit above
/// the outside pressure keeps the cell's state); inflow comes in from still air at pa and ta isentropically, at most sonic.
#[allow(clippy::too_many_arguments)]
fn open_state(r: f64, u: f64, p: f64, x: f64, dir: f64, pa: f64, ta: f64, xa: f64, gm: f64, ra: f64) -> [f64; 4] {
    let k2 = 2.0 / (gm - 1.0);
    let exc = (gm - 1.0) / (2.0 * gm);
    let un = u * dir;
    let c = (gm * p / r).sqrt();
    // supersonic exit: the cell's state, when a normal shock at the exit could hold the outside pressure (2026-11-12)
    if un >= c && (p >= pa || pa <= p * (1.0 + 2.0 * gm / (gm + 1.0) * (un * un / (c * c) - 1.0))) {
        return [r, u, p, x];
    }
    let j = un + k2 * c;
    let cpa = c * powf(pa / p, exc);
    let mut ub = j - k2 * cpa;
    if ub >= 0.0 {
        let mut cb = cpa;
        if ub > cb {
            cb = j / (1.0 + k2);
            ub = cb;
        }
        let pb = p * powf(cb / c, 1.0 / exc);
        return [gm * pb / (cb * cb), dir * ub, pb, x];
    }
    let c0 = (gm * ra * ta).sqrt();
    let a = 1.0 + k2 * cpa * cpa / (c0 * c0);
    let vs = c0 * (2.0 / (gm + 1.0)).sqrt();
    let v = jmin(vs, (-j + jmax(0.0, j * j - a * (j * j - k2 * k2 * cpa * cpa)).sqrt()) / a);
    let s2 = jmax(0.0, 1.0 - v * v / (k2 * c0 * c0));
    let pb = pa * powf(s2, 0.5 / exc);
    [pb / (ra * ta * s2), -dir * v, pb, xa]
}

#[derive(Clone, Copy, Default)]
struct Flow {
    m: f64,
    h: f64,
    x: f64,
    uj: f64,
}

/// One MUSCL-Hancock step; the boundaries fill the end fluxes.
fn step_pipe(p: &mut Pipe, dt: f64, v_in: &[Flow], ex_flow: &[Flow]) {
    let n = p.n;
    for i in 0..n {
        if i == 0 || i == n - 1 {
            p.dr[i] = 0.0;
            p.du[i] = 0.0;
            p.dp[i] = 0.0;
            p.dxs[i] = 0.0;
            continue;
        }
        p.dr[i] = minmod(p.r[i] - p.r[i - 1], p.r[i + 1] - p.r[i]);
        p.du[i] = minmod(p.u[i] - p.u[i - 1], p.u[i + 1] - p.u[i]);
        p.dp[i] = minmod(p.p[i] - p.p[i - 1], p.p[i + 1] - p.p[i]);
        p.dxs[i] = minmod(p.x[i] - p.x[i - 1], p.x[i + 1] - p.x[i]);
    }
    let h = 0.5 * dt / p.dx;
    for j in 1..n {
        let (a, b) = (j - 1, j);
        let (r, u, pp, x, dr, du, dp, dxs) = (&p.r, &p.u, &p.p, &p.x, &p.dr, &p.du, &p.dp, &p.dxs);
        let mut ra = r[a] + 0.5 * dr[a];
        let mut ua = u[a] + 0.5 * du[a];
        let mut pa = pp[a] + 0.5 * dp[a];
        let mut xa = x[a] + 0.5 * dxs[a];
        ra -= h * (u[a] * dr[a] + r[a] * du[a]);
        ua -= h * (u[a] * du[a] + dp[a] / r[a]);
        pa -= h * (p.g[a] * pp[a] * du[a] + u[a] * dp[a]);
        xa -= h * u[a] * dxs[a];
        let mut rb = r[b] - 0.5 * dr[b];
        let mut ub = u[b] - 0.5 * du[b];
        let mut pb = pp[b] - 0.5 * dp[b];
        let mut xb = x[b] - 0.5 * dxs[b];
        rb -= h * (u[b] * dr[b] + r[b] * du[b]);
        ub -= h * (u[b] * du[b] + dp[b] / r[b]);
        pb -= h * (p.g[b] * pp[b] * du[b] + u[b] * dp[b]);
        xb -= h * u[b] * dxs[b];
        if !(ra > 0.0 && pa > 0.0) {
            ra = r[a];
            ua = u[a];
            pa = pp[a];
            xa = x[a];
        }
        if !(rb > 0.0 && pb > 0.0) {
            rb = r[b];
            ub = u[b];
            pb = pp[b];
            xb = x[b];
        }
        let f = hllc(ra, ua, pa, xa, rb, ub, pb, xb, &p.gas);
        let af = p.af[j];
        p.f1[j] = f[0] * af;
        p.f2[j] = f[1] * af;
        p.f3[j] = f[2] * af;
        p.f4[j] = f[3] * af;
    }
    let (left, right) = (p.left, p.right);
    boundary(p, left, -1.0, v_in, ex_flow);
    boundary(p, right, 1.0, v_in, ex_flow);
    let k = dt / p.dx;
    for i in 0..n {
        let ui = p.u[i];
        let ri = p.r[i];
        let ti = p.p[i] / (p.rm[i] * ri);
        let fr = 2.0 * FANNING * ri * ui.abs() * p.a[i] / p.d[i];
        p.q1[i] -= k * (p.f1[i + 1] - p.f1[i]);
        p.q2[i] += -k * (p.f2[i + 1] - p.f2[i]) + dt * (p.p[i] * (p.af[i + 1] - p.af[i]) / p.dx - fr * ui);
        p.q3[i] += -k * (p.f3[i + 1] - p.f3[i]) + dt * fr * p.cp[i] * (p.tw - ti);
        p.q4[i] -= k * (p.f4[i + 1] - p.f4[i]);
        if p.q1[i] < 1e-6 * p.a[i] {
            p.q1[i] = 1e-6 * p.a[i];
        }
        if p.q4[i] < 0.0 {
            p.q4[i] = 0.0;
        } else if p.q4[i] > p.q1[i] {
            p.q4[i] = p.q1[i];
        }
    }
}
/// The end flux of a pipe end set by its boundary (`which`: -1 the left end, +1 the right; the boundary's own side
/// is the one it was made with, as in the JavaScript, where P.left and P.right are separate closures).
/// The pressure on an end face that carries the speed vn (+ out of the pipe) where the cell's gas arrives at un: the
/// wave from the pipe meets the end, its Riemann invariant kept, isentropically (the page's endP, 2026-11-11). A closed
/// valve (vn = 0) feels p + rho c un for a small wave, as a reflecting end must; the end cell's own pressure, used before,
/// let a closed pipe's standing wave grow. At a valve, gas coming in sets vn between 0 and the end cell's own speed.
fn end_p(p: f64, r: f64, un: f64, vn: f64, gm: f64) -> f64 {
    let c = (gm * p / r).sqrt();
    let cb = jmax(0.05 * c, c + 0.5 * (gm - 1.0) * (un - vn));
    p * powf(cb / c, 2.0 * gm / (gm - 1.0))
}

fn boundary(p: &mut Pipe, b: Bnd, _which: f64, v_in: &[Flow], ex_flow: &[Flow]) {
    match b {
        Bnd::Noop => {}
        Bnd::Open(side) => {
            let (i, j) = if side > 0.0 { (p.n - 1, p.n) } else { (0, 0) };
            let ra = match &p.gas { Some(gs) => gas_r(gs, 1.0), None => RG };
            let g = open_state(p.r[i], p.u[i], p.p[i], p.x[i], side, PATM, TATM, 1.0, p.g[i], ra);
            let af = p.af[j];
            let m = g[0] * g[1] * af;
            p.f1[j] = m;
            p.f2[j] = m * g[1] + g[2] * af;
            // gas coming in carries the still outside air's own enthalpy h(Ta, xa) exactly (the page's openEnd)
            let h0 = match &p.gas {
                Some(gs) => {
                    if side * g[1] < 0.0 {
                        gas_h(gs, TATM, 1.0)
                    } else {
                        gas_h(gs, g[2] / (g[0] * gas_r(gs, g[3])), g[3]) + 0.5 * g[1] * g[1]
                    }
                }
                None => GAM / G1 * g[2] / g[0] + 0.5 * g[1] * g[1],
            };
            p.f3[j] = m * h0;
            p.f4[j] = m * g[3];
        }
        Bnd::Fed(side, src) => {
            let (i, j) = if side > 0.0 { (p.n - 1, p.n) } else { (0, 0) };
            let f = match src {
                Src::In(k) => v_in[k],
                Src::Ex(k) => ex_flow[k],
            };
            let af = p.af[j];
            let entering = if side > 0.0 { f.m < 0.0 } else { f.m > 0.0 };
            let uf = if entering { -side * f.uj } else { f.m / (p.r[i] * af) };
            p.f1[j] = f.m;
            let un = side * p.u[i];
            let vm = side * f.m / (p.r[i] * af);
            let vn = if vm >= 0.0 { vm } else { jmax(vm, jmin(0.0, un)) };
            p.f2[j] = f.m * uf + end_p(p.p[i], p.r[i], un, vn, p.g[i]) * af;
            p.f3[j] = f.m * f.h;
            p.f4[j] = f.m * f.x;
        }
    }
}

fn two_mut(v: &mut [Pipe], a: usize, b: usize) -> (&mut Pipe, &mut Pipe) {
    assert!(a != b);
    if a < b {
        let (x, y) = v.split_at_mut(b);
        (&mut x[a], &mut y[0])
    } else {
        let (x, y) = v.split_at_mut(a);
        (&mut y[0], &mut x[b])
    }
}

/// Junction between two pipes of different area (characteristic method, isentropic on each side): a's right end
/// meets b's left end. As the page's junction (2026-11-11): into the smaller pipe the flow contracts isentropically
/// (stagnation pressure kept), into the larger it expands with Borda-Carnot's momentum balance; the one-pressure
/// solution is the fallback if the solve fails or an end would be sonic.
fn junction(pipes: &mut [Pipe], ia: usize, ib: usize) {
    let (a, b) = two_mut(pipes, ia, ib);
    let i = a.n - 1;
    let (a1, a2) = (a.af[a.n], b.af[0]);
    let (rl, ul, pl, rr, ur, pr) = (a.r[i], a.u[i], a.p[i], b.r[0], b.u[0], b.p[0]);
    let (gl, gr) = (a.g[i], b.g[0]); // each side's gamma, frozen
    let cl = (gl * pl / rl).sqrt();
    let cr = (gr * pr / rr).sqrt();
    let k2 = 2.0 / (gl - 1.0);
    let ex = (gl - 1.0) / (2.0 * gl);
    let ig = 1.0 / gl;
    let k2r = 2.0 / (gr - 1.0);
    let exr = (gr - 1.0) / (2.0 * gr);
    let igr = 1.0 / gr;
    let jl = ul + k2 * cl;
    let jr = ur - k2r * cr;
    // each side's end state (c, r, u) at its own pressure
    let s1 = |p1: f64| {
        let s = p1 / pl;
        let c1 = cl * powf(s, ex);
        (c1, rl * powf(s, ig), jl - k2 * c1)
    };
    let s2 = |p2: f64| {
        let s = p2 / pr;
        let c2 = cr * powf(s, exr);
        (c2, rr * powf(s, igr), jr + k2r * c2)
    };
    let pt = |p: f64, r: f64, u: f64, gm: f64| p * powf(1.0 + 0.5 * (gm - 1.0) * r * u * u / (gm * p), gm / (gm - 1.0));
    let f = |p1: f64, p2: f64| -> [f64; 2] {
        let (_c1, r1, u1) = s1(p1);
        let (_c2, r2, u2) = s2(p2);
        let m = a1 * r1 * u1;
        let up = m >= 0.0;
        let contr = if up { a2 < a1 } else { a1 < a2 };
        let law = if contr {
            pt(p1, r1, u1, gl) - pt(p2, r2, u2, gr)
        } else {
            r2 * u2 * u2 * a2 + p2 * a2 - r1 * u1 * u1 * a1 - p1 * a1 - (if up { p1 } else { p2 }) * (a2 - a1)
        };
        [m - a2 * r2 * u2, law]
    };
    let mut p1 = if a.jp > 0.0 { a.jp } else { 0.5 * (pl + pr) };
    let mut p2 = if a.jq > 0.0 { a.jq } else { p1 };
    let mut ok = false;
    for _ in 0..12 {
        let r0 = f(p1, p2);
        let h1 = p1 * 1e-7;
        let h2 = p2 * 1e-7;
        let rx = f(p1 + h1, p2);
        let ry = f(p1, p2 + h2);
        let j11 = (rx[0] - r0[0]) / h1;
        let j21 = (rx[1] - r0[1]) / h1;
        let j12 = (ry[0] - r0[0]) / h2;
        let j22 = (ry[1] - r0[1]) / h2;
        let det = j11 * j22 - j12 * j21;
        if !(det.abs() > 0.0) {
            break;
        }
        let d1 = (r0[0] * j22 - r0[1] * j12) / det;
        let d2 = (r0[1] * j11 - r0[0] * j21) / det;
        let n1 = p1 - d1;
        let n2 = p2 - d2;
        if !(n1 > 0.0 && n2 > 0.0) {
            break;
        }
        let done = d1.abs() < 1e-9 * p1 && d2.abs() < 1e-9 * p2;
        p1 = n1;
        p2 = n2;
        if done {
            ok = true;
            break;
        }
    }
    if ok {
        let (c1, _r1, u1) = s1(p1);
        let (c2, _r2, u2) = s2(p2);
        ok = u1.abs() < c1 && u2.abs() < c2;
    }
    if !ok {
        let g = |ps: f64| {
            let sl = ps / pl;
            let sr = ps / pr;
            let c1 = cl * powf(sl, ex);
            let c2 = cr * powf(sr, exr);
            a1 * rl * powf(sl, ig) * (jl - k2 * c1) - a2 * rr * powf(sr, igr) * (jr + k2r * c2)
        };
        let mut ps = if a.jp > 0.0 { a.jp } else { 0.5 * (pl + pr) };
        let mut okc = false;
        for _ in 0..8 {
            let gv = g(ps);
            let h = ps * 1e-6;
            let d = (g(ps + h) - gv) / h;
            if !(d < 0.0) {
                break;
            }
            let nx = ps - gv / d;
            if !(nx > 0.0) {
                break;
            }
            if (nx - ps).abs() < 1e-7 * ps {
                ps = nx;
                okc = true;
                break;
            }
            ps = nx;
        }
        if !okc || !(g(ps).abs() <= 1e-6 * (a1 * rl * cl).abs()) {
            let mut lo = jmin(pl, pr) * 0.2;
            let mut hi = jmax(pl, pr) * 5.0;
            for _ in 0..60 {
                let m = 0.5 * (lo + hi);
                if g(m) > 0.0 {
                    lo = m;
                } else {
                    hi = m;
                }
            }
            ps = 0.5 * (lo + hi);
        }
        p1 = ps;
        p2 = ps;
    }
    a.jp = p1;
    a.jq = p2;
    let (c1, r1, u1) = s1(p1);
    let (c2, r2, u2) = s2(p2);
    let m = a1 * r1 * u1;
    let up = m >= 0.0;
    let xx = if up { a.x[i] } else { b.x[0] };
    let h0 = match &a.gas {
        Some(g) => {
            if up {
                gas_h(g, p1 / (r1 * a.rm[i]), xx) + 0.5 * u1 * u1
            } else {
                gas_h(g, p2 / (r2 * b.rm[0]), xx) + 0.5 * u2 * u2
            }
        }
        None => {
            if up {
                c1 * c1 / G1 + 0.5 * u1 * u1
            } else {
                c2 * c2 / G1 + 0.5 * u2 * u2
            }
        }
    };
    let an = a.n;
    a.f1[an] = m;
    a.f2[an] = m * u1 + p1 * a1;
    a.f3[an] = m * h0;
    a.f4[an] = m * xx;
    b.f1[0] = m;
    b.f2[0] = m * u2 + p2 * a2;
    b.f3[0] = m * h0;
    b.f4[0] = m * xx;
}

#[derive(Clone, Default)]
struct End {
    pipe: usize,
    side: f64,
    r: f64,
    u: f64,
    p: f64,
    c: f64,
    a: f64,
    j: f64,
    x: f64,
    cs: f64,
    us: f64,
    rs: f64,
    m: f64,
    k2: f64,
    ex: f64,
    ig: f64,
    rg: f64,
}
struct Junc {
    p: f64,
    ends: Vec<End>,
}
fn junc(ends: &[(usize, f64)]) -> Junc {
    Junc { p: 0.0, ends: ends.iter().map(|&(pipe, side)| End { pipe, side, ..Default::default() }).collect() }
}

/// Junction of several pipe ends, characteristic method: one pressure, flows that sum to zero, inflows mixed.
fn junction_n(jn: &mut Junc, pipes: &mut [Pipe]) {
    let n = jn.ends.len();
    let gas = pipes[jn.ends[0].pipe].gas;
    for e in jn.ends.iter_mut() {
        let p = &pipes[e.pipe];
        let i = if e.side > 0.0 { p.n - 1 } else { 0 };
        let gm = p.g[i]; // each end's gamma, frozen
        e.k2 = 2.0 / (gm - 1.0);
        e.ex = (gm - 1.0) / (2.0 * gm);
        e.ig = 1.0 / gm;
        e.rg = p.rm[i];
        e.r = p.r[i];
        e.u = p.u[i];
        e.p = p.p[i];
        e.c = (gm * e.p / e.r).sqrt();
        e.a = if e.side > 0.0 { p.af[p.n] } else { p.af[0] };
        e.j = if e.side > 0.0 { e.u + e.k2 * e.c } else { e.u - e.k2 * e.c };
        e.x = p.x[i];
    }
    let inflow = |e: &mut End, ps: f64| {
        let s = ps / e.p;
        let c = e.c * powf(s, e.ex);
        let r = e.r * powf(s, e.ig);
        let u = if e.side > 0.0 { e.j - e.k2 * c } else { e.j + e.k2 * c };
        e.cs = c;
        e.us = u;
        e.rs = r;
        e.side * r * u * e.a
    };
    let g = |ends: &mut Vec<End>, ps: f64| {
        let mut t = 0.0;
        for e in ends.iter_mut() {
            t += inflow(e, ps);
        }
        t
    };
    let mut ps = if jn.p > 0.0 {
        jn.p
    } else {
        let mut s = 0.0;
        for e in &jn.ends {
            s += e.p;
        }
        s / n as f64
    };
    let mut ok = false;
    for _ in 0..10 {
        let gv = g(&mut jn.ends, ps);
        let h = ps * 1e-6;
        let d = (g(&mut jn.ends, ps + h) - gv) / h;
        if !(d < 0.0) {
            break;
        }
        let nx = ps - gv / d;
        if !(nx > 0.0) {
            break;
        }
        if (nx - ps).abs() < 1e-8 * ps {
            ps = nx;
            ok = true;
            break;
        }
        ps = nx;
    }
    if !ok {
        let mut lo = f64::INFINITY;
        let mut hi = f64::NEG_INFINITY;
        for e in &jn.ends {
            lo = jmin(lo, e.p);
            hi = jmax(hi, e.p);
        }
        lo *= 0.2;
        hi *= 5.0;
        for _ in 0..60 {
            let m = 0.5 * (lo + hi);
            if g(&mut jn.ends, m) > 0.0 {
                lo = m;
            } else {
                hi = m;
            }
        }
        ps = 0.5 * (lo + hi);
    }
    jn.p = ps;
    g(&mut jn.ends, ps);
    let h0of = |e: &End| match &gas {
        Some(gs) => gas_h(gs, ps / (e.rs * e.rg), e.x) + 0.5 * e.us * e.us,
        None => e.cs * e.cs / G1 + 0.5 * e.us * e.us,
    };
    let (mut m_in, mut h_in, mut x_in) = (0.0, 0.0, 0.0);
    for e in jn.ends.iter_mut() {
        e.m = e.side * e.rs * e.us * e.a;
        if e.m > 0.0 {
            let h0 = h0of(e);
            m_in += e.m;
            h_in += e.m * h0;
            x_in += e.m * e.x;
        }
    }
    let h_mix = if m_in > 0.0 { h_in / m_in } else { 0.0 };
    let x_mix = if m_in > 0.0 { x_in / m_in } else { 0.0 };
    for e in &jn.ends {
        let p = &mut pipes[e.pipe];
        let j = if e.side > 0.0 { p.n } else { 0 };
        let h0 = if e.m > 0.0 { h0of(e) } else { h_mix };
        let xx = if e.m > 0.0 { e.x } else { x_mix };
        let f = e.side * e.m;
        p.f1[j] = f;
        p.f2[j] = f * e.us + ps * e.a;
        p.f3[j] = f * h0;
        p.f4[j] = f * xx;
    }
}

/// gm, r: the source gas's gamma (frozen through the orifice) and R; with the constant gas the precomputed constants.
#[allow(clippy::too_many_arguments)]
fn orifice(k: &K, cda: f64, p0: f64, t0: f64, pd: f64, gm: f64, r: f64) -> f64 {
    if !(cda > 0.0) || p0 <= pd {
        return 0.0;
    }
    let pr = pd / p0;
    let rho0 = p0 / (r * t0);
    let cg = gm == GAM;
    let prc = if cg { k.prc } else { powf(2.0 / (gm + 1.0), gm / (gm - 1.0)) };
    let psi = if pr <= prc {
        if cg {
            k.psic
        } else {
            gm.sqrt() * powf(2.0 / (gm + 1.0), (gm + 1.0) / (2.0 * (gm - 1.0)))
        }
    } else {
        (2.0 * gm / (gm - 1.0) * (powf(pr, 2.0 / gm) - powf(pr, (gm + 1.0) / gm))).sqrt()
    };
    cda * (p0 * rho0).sqrt() * psi
}
fn jet_speed(k: &K, p0: f64, t0: f64, pd: f64, gm: f64, cp: f64) -> f64 {
    let prc = if gm == GAM { k.prc } else { powf(2.0 / (gm + 1.0), gm / (gm - 1.0)) };
    (2.0 * cp * t0 * (1.0 - powf(jmax(pd / p0, prc), (gm - 1.0) / gm))).sqrt()
}

struct Cyl {
    m: f64,
    t: f64,
    x: f64,
    p: f64,
    th: f64,
    fresh: f64,
    burn_q: f64,
    ivc_p: f64,
    ivc_t: f64,
    ivc_v: f64,
    work: f64,
    pmax: f64,
    xb: f64,
    burning: bool,
    burnt: bool,
    p_evo: f64,
    ex_m: f64,
    ex_h: f64,
    ov_p: f64,
    ov_n: f64,
    ex_x: f64,
    rg: f64, // the gas's R, cp and gamma at this step's start
    cp: f64,
    gm: f64,
    done: Option<[f64; 7]>, // ve, imep, pmax, resid, pEvo, tEx, overlapPort
    started: bool,
    last_tk: Option<f64>,
}

/// Flow between the cylinder and a pipe end cell; m positive from the pipe into the cylinder.
fn valve_flow(k: &K, cda: f64, cy: &Cyl, p: &Pipe, i: usize) -> Flow {
    let hc = match &p.gas { Some(g) => gas_h(g, cy.t, cy.x), None => CP * cy.t };
    if !(cda > 0.0) {
        return Flow { m: 0.0, h: hc, x: cy.x, uj: 0.0 };
    }
    let (r, u, pp, gm) = (p.r[i], p.u[i], p.p[i], p.g[i]);
    let t = pp / (p.rm[i] * r);
    let t0 = t + 0.5 * u * u / p.cp[i];
    let p0 = pp * powf(t0 / t, gm / (gm - 1.0));
    if p0 > cy.p {
        let h = match &p.gas { Some(g) => gas_h(g, t, p.x[i]) + 0.5 * u * u, None => CP * t0 };
        return Flow { m: orifice(k, cda, p0, t0, cy.p, gm, p.rm[i]), h, x: p.x[i], uj: 0.0 };
    }
    Flow { m: -orifice(k, cda, cy.p, cy.t, pp, cy.gm, cy.rg), h: hc, x: cy.x, uj: jet_speed(k, cy.p, cy.t, pp, cy.gm, cy.cp) }
}

struct Chamber {
    cyl: usize,
    pipe: usize,
    cell: usize,
    v: f64,
    cda: f64,
    le: f64,
    m: f64,
    t: f64,
    x: f64,
    mdot: f64,
    p: f64,
}
struct Net {
    cyls: Vec<usize>,
    juncs: Vec<Junc>,
    lines: Vec<Vec<usize>>,
    main: Vec<usize>,
}
struct State {
    pipes: Vec<Pipe>,
    ins: Vec<Vec<usize>>,
    prims: Vec<Vec<usize>>,
    coll: Option<Vec<usize>>,
    nets: Option<Vec<Net>>,
    chambers: Vec<Chamber>,
    cyls: Vec<Cyl>,
    jn: Junc,
    th: f64,
}

/// Split a run of segments into pipes wherever the diameter jumps; cones stay inside a pipe.
#[allow(clippy::too_many_arguments)]
fn build_line(pipes: &mut Vec<Pipe>, segs: &[Seg], tw: &Value, dx: f64, t0: f64, x0: f64, gas: Option<Gas>) -> Result<Vec<usize>, String> {
    struct Run {
        parts: Vec<Seg>,
        l: f64,
        d1: f64,
    }
    let mut runs: Vec<Run> = Vec::new();
    for sg in segs {
        if !(sg.l > 1e-6) {
            continue;
        }
        match runs.last_mut() {
            Some(cur) if (cur.d1 - sg.d0).abs() < 1e-6 => {
                cur.parts.push(sg.clone());
                cur.l += sg.l;
                cur.d1 = sg.d1;
            }
            _ => runs.push(Run { parts: vec![sg.clone()], l: sg.l, d1: sg.d1 }),
        }
    }
    let tw = or(tw, TATM);
    let mut x0pos = 0.0;
    let mut out = Vec::new();
    for rn in &runs {
        let parts = &rn.parts;
        let area = |x: f64| {
            let mut a = 0.0;
            let last = parts.len() - 1;
            for (q, sg) in parts.iter().enumerate() {
                if x <= a + sg.l || q == last {
                    let f = jmin(1.0, jmax(0.0, (x - a) / sg.l));
                    let d = sg.d0 + (sg.d1 - sg.d0) * f;
                    return PI * d * d / 4.0;
                }
                a += sg.l;
            }
            0.0
        };
        let mut p = make_pipe(rn.l, jmin(dx, rn.l / 6.0), &area, tw, t0, x0, gas)?;
        p.start = x0pos;
        x0pos += rn.l;
        pipes.push(p);
        out.push(pipes.len() - 1);
    }
    Ok(out)
}

fn collector_nets(cols: &[ColSpec], pipes: &mut Vec<Pipe>, prims: &[Vec<usize>], dx: f64, gas: Option<Gas>) -> Result<Vec<Net>, String> {
    let mut used = std::collections::HashSet::new();
    let mut nets = Vec::new();
    for (ci, col) in cols.iter().enumerate() {
        let cyls: Vec<f64> = col.cyls.iter().map(|c| c.trunc()).collect();
        for &c in &cyls {
            if !(c >= 0.0 && c < prims.len() as f64) {
                return Err(format!("collector {} lists cylinder index {} of {}", ci + 1, fmt_num(c), prims.len()));
            }
            if !used.insert(c as usize) {
                return Err(format!("cylinder index {} is on two collectors", fmt_num(c)));
            }
        }
        let cyls: Vec<usize> = cyls.iter().map(|&c| c as usize).collect();
        let mut juncs = Vec::new();
        let mut lines: Vec<Vec<usize>> = Vec::new();
        let mut prev: Option<Vec<Vec<usize>>> = None;
        for (si, stg) in col.stages.iter().enumerate() {
            let mut want: Vec<usize> = if si == 0 { cyls.clone() } else { (0..prev.as_ref().unwrap().len()).collect() };
            want.sort();
            let mut flat: Vec<f64> = stg.groups.iter().flatten().map(|g| g.trunc()).collect();
            flat.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            if flat.len() != want.len() || flat.iter().zip(&want).any(|(g, w)| *g != *w as f64) {
                let w: Vec<String> = want.iter().map(|x| x.to_string()).collect();
                return Err(format!("collector {} stage {} groups must split {}", ci + 1, si + 1, w.join(", ")));
            }
            if let Some(b) = &stg.segs_by_group {
                if b.len() != stg.groups.len() {
                    return Err(format!("collector {} stage {}: segs_by_group needs one entry per group", ci + 1, si + 1));
                }
            }
            let mut next = Vec::new();
            for (gi, grp) in stg.groups.iter().enumerate() {
                if grp.len() < 2 {
                    return Err("a junction needs at least two inlets".into());
                }
                let segs = match stg.segs_by_group.as_ref().and_then(|b| b[gi].as_ref()) {
                    Some(s) => s.clone(),
                    None => stg.segs.clone().ok_or("a collector stage needs its segs")?,
                };
                let tw = if truthy(&stg.tw) { stg.tw.clone() } else { col.tw.clone() };
                let ln = build_line(pipes, &segs, &tw, dx, 700.0, 0.0, gas)?;
                if ln.is_empty() {
                    return Err("a collector stage has no pipe".into());
                }
                let mut ends = Vec::new();
                for &g in grp {
                    let g = g.trunc() as usize;
                    let l = if si == 0 { &prims[g] } else { &prev.as_ref().unwrap()[g] };
                    ends.push((*l.last().ok_or("an empty line")?, 1.0));
                }
                ends.push((ln[0], -1.0));
                juncs.push(junc(&ends));
                lines.push(ln.clone());
                next.push(ln);
            }
            prev = Some(next);
        }
        let feed: Vec<Vec<usize>> = match prev {
            Some(p) => p,
            None => cyls.iter().map(|&c| prims[c].clone()).collect(),
        };
        if feed.len() < 2 {
            return Err(format!("collector {}: the last junction needs at least two inlets", ci + 1));
        }
        let main = build_line(pipes, &col.segs, &col.tw, dx, 700.0, 0.0, gas)?;
        if main.is_empty() {
            return Err(format!("collector {} has no pipe after its last junction", ci + 1));
        }
        let mut ends: Vec<(usize, f64)> = Vec::new();
        for l in &feed {
            ends.push((*l.last().ok_or("an empty line")?, 1.0));
        }
        ends.push((main[0], -1.0));
        juncs.push(junc(&ends));
        lines.push(main.clone());
        nets.push(Net { cyls, juncs, lines, main });
    }
    Ok(nets)
}
fn fmt_num(x: f64) -> String {
    if x == x.trunc() && x.abs() < 1e15 {
        format!("{}", x as i64)
    } else {
        format!("{}", x)
    }
}

fn fresh_state(eng: &Engine, dx: f64) -> Result<State, String> {
    let n = eng.phases.len();
    let gas = eng.gas;
    let r0 = match &gas { Some(g) => gas_r(g, 0.0), None => RG };
    let mut pipes = Vec::new();
    let (mut ins, mut prims, mut chambers, mut cyls) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    if let Some(per) = &eng.per_cyl {
        if per.len() != n {
            return Err(format!("exhaust.per_cyl must list one primary per cylinder ({}), got {}", n, per.len()));
        }
    }
    for k in 0..n {
        let li = build_line(&mut pipes, &eng.intake.segs, &eng.intake.tw, dx, TATM, 1.0, gas)?;
        let segs = match eng.per_cyl.as_ref().and_then(|p| p[k].as_ref()) {
            Some(s) => s,
            None => &eng.exhaust.segs,
        };
        let ex = build_line(&mut pipes, segs, &eng.exhaust.tw, dx, 700.0, 0.0, gas)?;
        if li.is_empty() || ex.is_empty() {
            return Err("the intake and the exhaust each need at least one pipe".into());
        }
        for c in &eng.chambers {
            let [cx, cv, ca, cle] = *c;
            let mut q: isize = -1;
            for (qi, &pi) in ex.iter().enumerate() {
                let p = &pipes[pi];
                if cx >= p.start && cx < p.start + p.n as f64 * p.dx {
                    q = qi as isize;
                    break;
                }
            }
            if q < 0 {
                q = ex.len() as isize - 1;
            }
            let p = &pipes[ex[q as usize]];
            let cell = jmin((p.n - 1) as f64, jmax(0.0, ((cx - p.start) / p.dx).floor()));
            let cell = if cell.is_nan() { 0 } else { cell as usize };
            chambers.push(Chamber {
                cyl: k,
                pipe: q as usize,
                cell,
                v: cv,
                cda: 0.75 * ca,
                le: cle,
                m: PATM * cv / (r0 * 700.0),
                t: 700.0,
                x: 0.0,
                mdot: 0.0,
                p: 0.0,
            });
        }
        let th = ((eng.ivc - eng.phases[k]) % 720.0 + 720.0) % 720.0;
        let t = 330.0;
        let x = 0.95;
        let m = PATM * eng.vol(th) / ((match &gas { Some(g) => gas_r(g, x), None => RG }) * t);
        let fresh = m * x;
        cyls.push(Cyl {
            m,
            t,
            x,
            p: PATM,
            th: 0.0,
            fresh,
            burn_q: fresh / eng.afr * LHV * eng.eta,
            ivc_p: PATM,
            ivc_t: 330.0,
            ivc_v: eng.vol(eng.ivc),
            work: 0.0,
            pmax: 0.0,
            xb: 0.0,
            burning: false,
            burnt: false,
            p_evo: 0.0,
            ex_m: 0.0,
            ex_h: 0.0,
            ov_p: 0.0,
            ov_n: 0.0,
            ex_x: 0.0,
            rg: RG,
            cp: CP,
            gm: GAM,
            done: None,
            started: false,
            last_tk: None,
        });
        ins.push(li);
        prims.push(ex);
    }
    let coll = if eng.collectors.is_some() {
        None
    } else if let Some(c) = &eng.collector {
        let l = build_line(&mut pipes, &c.segs, &c.tw, dx, 700.0, 0.0, gas)?;
        if l.is_empty() {
            return Err("the collector needs at least one pipe".into());
        }
        Some(l)
    } else {
        None
    };
    let nets = match &eng.collectors {
        Some(cols) => Some(collector_nets(cols, &mut pipes, &prims, dx, gas)?),
        None => None,
    };
    Ok(State { pipes, ins, prims, coll, nets, chambers, cyls, jn: Junc { p: 0.0, ends: Vec::new() }, th: eng.ivc })
}

fn local_th(th: f64, ph: f64) -> f64 {
    ((th - ph) % 720.0 + 720.0) % 720.0
}

/// One speed's result: the last cycle's averages over the cylinders, and each cylinder's.
#[derive(Clone)]
pub struct Res {
    pub v: [f64; 7], // ve, imep, pmax, resid, pEvo, tEx, overlapPort
    pub per_cyl: Vec<[f64; 2]>,
}

/// Simulate engine cycles at one speed, from where cylinder 1's intake valve closes. Returns each cycle's result.
fn run_speed(eng: &Engine, rpm: f64, cycles: f64, dx: f64, state: &mut Option<State>) -> Result<Vec<Res>, String> {
    let w = rpm * 6.0;
    let dx = if dx != 0.0 && !dx.is_nan() { dx } else { 0.01 };
    let nc = eng.phases.len();
    if state.is_none() {
        *state = Some(fresh_state(eng, dx)?);
    }
    let st = state.as_mut().unwrap();
    let k = &eng.k;
    let gas = eng.gas;
    let mut all: Vec<usize> = Vec::new();
    for l in &st.ins {
        all.extend(l);
    }
    for l in &st.prims {
        all.extend(l);
    }
    if let Some(c) = &st.coll {
        all.extend(c);
    }
    if let Some(nets) = &st.nets {
        for n in nets {
            for l in &n.lines {
                all.extend(l);
            }
        }
    }
    for &p in &all {
        st.pipes[p].left = Bnd::Noop;
        st.pipes[p].right = Bnd::Noop;
    }
    let hi0 = match &gas { Some(g) => gas_h(g, TATM, 1.0), None => CP * TATM };
    let he0 = match &gas { Some(g) => gas_h(g, 700.0, 0.0), None => CP * 700.0 };
    let mut v_in = vec![Flow { m: 0.0, h: hi0, x: 1.0, uj: 0.0 }; nc];
    let mut v_ex = vec![Flow { m: 0.0, h: he0, x: 0.0, uj: 0.0 }; nc];
    let mut ex_flow = vec![Flow::default(); nc];
    for kk in 0..nc {
        let ip = *st.ins[kk].last().unwrap();
        let ep = st.prims[kk][0];
        st.pipes[st.ins[kk][0]].left = Bnd::Open(-1.0);
        st.pipes[ip].right = Bnd::Fed(1.0, Src::In(kk));
        st.pipes[ep].left = Bnd::Fed(-1.0, Src::Ex(kk));
    }
    if let Some(nets) = &st.nets {
        let mut on = std::collections::HashSet::new();
        for n in nets {
            for &c in &n.cyls {
                on.insert(c);
            }
            st.pipes[*n.main.last().unwrap()].right = Bnd::Open(1.0);
        }
        for (kk, ch) in st.prims.iter().enumerate() {
            if !on.contains(&kk) {
                st.pipes[*ch.last().unwrap()].right = Bnd::Open(1.0);
            }
        }
    } else if let Some(coll) = &st.coll {
        let mut ends: Vec<(usize, f64)> = st.prims.iter().map(|ch| (*ch.last().unwrap(), 1.0)).collect();
        ends.push((coll[0], -1.0));
        let p = st.jn.p;
        st.jn = junc(&ends);
        st.jn.p = p;
        st.pipes[*coll.last().unwrap()].right = Bnd::Open(1.0);
    } else {
        for ch in &st.prims {
            st.pipes[*ch.last().unwrap()].right = Bnd::Open(1.0);
        }
    }
    let rho_ref = PATM / ((match &gas { Some(g) => g.ra, None => RG }) * TATM);
    let mut out = Vec::new();
    let cycles = if cycles != 0.0 && !cycles.is_nan() { cycles } else { 6.0 };
    let mut c = 0.0;
    while c < cycles {
        let end = st.th + 720.0;
        while st.th < end - 1e-9 {
            let mut smax = 0.0;
            let mut dmin = 1.0;
            for &pi in &all {
                let p = &mut st.pipes[pi];
                prim(p);
                let v = max_speed(p);
                if v > smax {
                    smax = v;
                }
                if p.dx < dmin {
                    dmin = p.dx;
                }
            }
            let th = st.th % 720.0;
            let mut sj = 0.0;
            for kk in 0..nc {
                let tk = local_th(th, eng.phases[kk]);
                let ip = &st.pipes[*st.ins[kk].last().unwrap()];
                let ep = &st.pipes[st.prims[kk][0]];
                let cy = &mut st.cyls[kk];
                cy.th = tk;
                match &gas {
                    Some(g) => {
                        let (cp, _h, r) = gas_at(g, cy.t, cy.x);
                        cy.rg = r;
                        cy.cp = cp;
                        cy.gm = cp / (cp - r);
                    }
                    None => {
                        cy.rg = RG;
                        cy.cp = CP;
                        cy.gm = GAM;
                    }
                }
                cy.p = cy.m * cy.rg * cy.t / eng.vol(tk);
                v_in[kk] = valve_flow(k, eng.cda_in(tk), cy, ip, ip.n - 1);
                v_ex[kk] = valve_flow(k, eng.cda_ex(tk), cy, ep, 0);
                sj = jmax(
                    jmax(sj, v_in[kk].uj + (ip.g[ip.n - 1] * ip.p[ip.n - 1] / ip.r[ip.n - 1]).sqrt()),
                    v_ex[kk].uj + (ep.g[0] * ep.p[0] / ep.r[0]).sqrt(),
                );
            }
            let mut dt = 0.8 * dmin / jmax(smax, sj);
            let dth = jmin(dt * w, 0.5);
            dt = dth / w;
            for kk in 0..nc {
                for q in 1..st.ins[kk].len() {
                    let (a, b) = (st.ins[kk][q - 1], st.ins[kk][q]);
                    junction(&mut st.pipes, a, b);
                }
                for q in 1..st.prims[kk].len() {
                    let (a, b) = (st.prims[kk][q - 1], st.prims[kk][q]);
                    junction(&mut st.pipes, a, b);
                }
            }
            if let Some(coll) = &st.coll {
                junction_n(&mut st.jn, &mut st.pipes);
                for q in 1..coll.len() {
                    junction(&mut st.pipes, coll[q - 1], coll[q]);
                }
            }
            if let Some(nets) = st.nets.as_mut() {
                for n in nets.iter_mut() {
                    for j in n.juncs.iter_mut() {
                        junction_n(j, &mut st.pipes);
                    }
                    for l in &n.lines {
                        for q in 1..l.len() {
                            junction(&mut st.pipes, l[q - 1], l[q]);
                        }
                    }
                }
            }
            for ch in st.chambers.iter_mut() {
                let p = &mut st.pipes[st.prims[ch.cyl][ch.pipe]];
                let i = ch.cell;
                let (r, pp) = (p.r[i], p.p[i]);
                let t = pp / (p.rm[i] * r);
                ch.p = ch.m * (match &gas { Some(g) => gas_r(g, ch.x), None => RG }) * ch.t / ch.v;
                let rho_n = if pp > ch.p { r } else { ch.m / ch.v };
                ch.mdot += dt * (ch.cda * (pp - ch.p) / ch.le - ch.mdot * ch.mdot.abs() / (2.0 * rho_n * ch.cda * ch.le));
                let md = ch.mdot;
                let hh = match &gas {
                    Some(g) => {
                        if md > 0.0 {
                            gas_h(g, t, p.x[i]) + 0.5 * p.u[i] * p.u[i]
                        } else {
                            gas_h(g, ch.t, ch.x)
                        }
                    }
                    None => {
                        if md > 0.0 {
                            CP * t + 0.5 * p.u[i] * p.u[i]
                        } else {
                            CP * ch.t
                        }
                    }
                };
                let xin = if md > 0.0 { p.x[i] } else { ch.x };
                let u = (match &gas { Some(g) => ch.m * gas_e(g, ch.t, ch.x), None => ch.m * CV * ch.t }) + dt * md * hh;
                let m2 = jmax(1e-9, ch.m + dt * md);
                ch.x = jmin(1.0, jmax(0.0, (ch.m * ch.x + dt * md * xin) / m2));
                ch.m = m2;
                ch.t = jmax(200.0, match &gas { Some(g) => gas_t(g, u / m2, ch.x, ch.t, false).0, None => u / (m2 * CV) });
                p.q1[i] -= dt * md / p.dx;
                p.q3[i] -= dt * md * hh / p.dx;
                p.q4[i] -= dt * md * xin / p.dx;
                if md > 0.0 {
                    p.q2[i] -= dt * md * p.u[i] / p.dx;
                }
            }
            for kk in 0..nc {
                let f = &mut ex_flow[kk];
                let v = v_ex[kk];
                f.m = -v.m;
                f.h = v.h;
                f.x = v.x;
                f.uj = v.uj;
            }
            for &pi in &all {
                step_pipe(&mut st.pipes[pi], dt, &v_in, &ex_flow);
            }
            for kk in 0..nc {
                let ep0 = st.pipes[st.prims[kk][0]].p[0];
                let cy = &mut st.cyls[kk];
                let tk = cy.th;
                let crossed = match cy.last_tk {
                    Some(prev) => (prev < eng.ivc && tk >= eng.ivc) || (prev > tk && (tk >= eng.ivc || prev < eng.ivc)),
                    None => false,
                };
                cy.last_tk = Some(tk);
                if crossed || !cy.started {
                    if cy.started && crossed {
                        cy.done = Some([
                            cy.m * cy.x / (rho_ref * eng.vd),
                            cy.work / eng.vd,
                            cy.pmax,
                            1.0 - cy.x,
                            cy.p_evo,
                            if cy.ex_m > 0.0 {
                                match &gas {
                                    Some(g) => gas_t(g, cy.ex_h / cy.ex_m, cy.ex_x / cy.ex_m, 800.0, true).0,
                                    None => cy.ex_h / (cy.ex_m * CP),
                                }
                            } else {
                                0.0
                            },
                            if cy.ov_n != 0.0 { cy.ov_p / cy.ov_n } else { PATM },
                        ]);
                    }
                    cy.fresh = cy.m * cy.x;
                    cy.burn_q = cy.fresh / eng.afr * LHV * eng.eta;
                    cy.ivc_p = cy.m * (match &gas { Some(g) => gas_r(g, cy.x), None => RG }) * cy.t / eng.vol(tk);
                    cy.ivc_t = cy.t;
                    cy.ivc_v = eng.vol(tk);
                    cy.work = 0.0;
                    cy.pmax = 0.0;
                    cy.xb = 0.0;
                    cy.burning = false;
                    cy.burnt = false;
                    cy.ex_m = 0.0;
                    cy.ex_h = 0.0;
                    cy.ex_x = 0.0;
                    cy.ov_p = 0.0;
                    cy.ov_n = 0.0;
                    cy.started = true;
                }
                let a = ((tk - eng.ign) % 720.0 + 720.0) % 720.0;
                let mut xb = cy.xb;
                if !cy.burnt {
                    if a <= eng.burn_dur && (cy.burning || a < 3.0) {
                        cy.burning = true;
                        xb = wiebe(a, eng.burn_dur);
                    } else if cy.burning {
                        xb = 1.0;
                        cy.burnt = true;
                    }
                }
                let dxb = jmax(0.0, xb - cy.xb);
                cy.xb = xb;
                let v = eng.vol(tk);
                let dv = eng.dvol(tk) * rad(dth);
                let m_i = v_in[kk].m * dt;
                let m_e = v_ex[kk].m * dt;
                let mut qw = 0.0;
                if eng.woschni {
                    let closed = tk < eng.evo || tk > eng.ivc;
                    let sp = 2.0 * eng.stroke * rpm / 60.0;
                    let pm = cy.ivc_p * powf(cy.ivc_v / v, 1.32);
                    let wv = (if closed { 2.28 } else { 6.18 }) * sp
                        + if closed && cy.burning {
                            3.24e-3 * eng.vd * cy.ivc_t / (cy.ivc_p * cy.ivc_v) * jmax(0.0, cy.p - pm)
                        } else {
                            0.0
                        };
                    let hc = 3.26 * powf(eng.bore, -0.2) * powf(cy.p / 1000.0, 0.8) * powf(cy.t, -0.55) * powf(wv, 0.8);
                    let aw = 2.0 * eng.ap + 4.0 * (v - eng.vc) / eng.bore + 4.0 * eng.vc / eng.bore;
                    qw = hc * aw * (cy.t - eng.twall) * dt;
                }
                let u0 = match &gas { Some(g) => cy.m * gas_e(g, cy.t, cy.x), None => cy.m * CV * cy.t };
                let u = u0 - cy.p * dv + m_i * v_in[kk].h + m_e * v_ex[kk].h + cy.burn_q * dxb - qw;
                let mf = cy.m * cy.x + m_i * v_in[kk].x + m_e * v_ex[kk].x - cy.fresh * dxb;
                if let Some(g) = &gas {
                    cy.m = jmax(1e-7, cy.m + m_i + m_e);
                    cy.x = jmin(1.0, jmax(0.0, mf / cy.m));
                    cy.t = jmax(200.0, gas_t(g, u / cy.m, cy.x, cy.t, false).0);
                } else {
                    cy.m = jmax(1e-7, cy.m + m_i + m_e);
                    cy.t = jmax(200.0, u / (cy.m * CV));
                    cy.x = jmin(1.0, jmax(0.0, mf / cy.m));
                }
                cy.work += cy.p * dv;
                if cy.p > cy.pmax {
                    cy.pmax = cy.p;
                }
                if (tk - eng.evo).abs() < dth {
                    cy.p_evo = cy.p;
                }
                if m_e < 0.0 {
                    cy.ex_m -= m_e;
                    cy.ex_h -= m_e * v_ex[kk].h;
                    cy.ex_x -= m_e * v_ex[kk].x;
                }
                if tk > 345.0 && tk < 375.0 {
                    cy.ov_p += ep0;
                    cy.ov_n += 1.0;
                }
            }
            st.th += dth;
        }
        let d: Vec<[f64; 7]> = st.cyls.iter().filter_map(|cy| cy.done).collect();
        if !d.is_empty() {
            let av = |f: usize| {
                let mut s = 0.0;
                for x in &d {
                    s += x[f];
                }
                s / d.len() as f64
            };
            let mut pmax = f64::NEG_INFINITY;
            for x in &d {
                pmax = jmax(pmax, x[2]);
            }
            out.push(Res { v: [av(0), av(1), pmax, av(3), av(4), av(5), av(6)], per_cyl: d.iter().map(|x| [x[0], x[1]]).collect() });
        }
        c += 1.0;
    }
    if out.is_empty() {
        out.push(Res { v: [f64::NAN; 7], per_cyl: Vec::new() });
    }
    Ok(out)
}

/// A model with its state, run one speed at a time as the page's sweep() does.
pub struct Sim {
    eng: Engine,
    state: Option<State>,
}
impl Sim {
    pub fn new(spec_json: &str) -> Result<Sim, String> {
        let v: Value = serde_json::from_str(spec_json).map_err(|e| format!("the wave model's spec: {}", e))?;
        Ok(Sim { eng: make_engine(&v)?, state: None })
    }
    /// sweep()'s work for one speed: cycles (the first speed firstCycles), then up to maxExtra more pairs until the
    /// last two cycles' volumetric efficiency agree within tol. The arguments take the JavaScript's defaults when 0
    /// or NaN, as `||` does there.
    #[allow(clippy::too_many_arguments)]
    pub fn step(&mut self, rpm: f64, first: bool, dx: f64, cycles: f64, first_cycles: f64, max_extra: f64, tol: f64) -> Result<Res, String> {
        let d = |x: f64, def: f64| if x != 0.0 && !x.is_nan() { x } else { def };
        let n0 = if first { d(first_cycles, 6.0) } else { d(cycles, 3.0) };
        if first {
            self.state = None;
        }
        let mut h = run_speed(&self.eng, rpm, n0, dx, &mut self.state)?;
        let mut k = 0.0;
        let me = d(max_extra, 4.0);
        let tol = d(tol, 0.004);
        while k < me {
            let n = h.len();
            if n >= 2 && (h[n - 1].v[0] - h[n - 2].v[0]).abs() < tol * h[n - 1].v[0] {
                break;
            }
            h = run_speed(&self.eng, rpm, 2.0, dx, &mut self.state)?;
            k += 1.0;
        }
        Ok(h.pop().unwrap())
    }
    pub fn vd(&self) -> f64 {
        self.eng.vd
    }
}

// ------------------------------------------------------------------------------------------- C interface

use std::cell::RefCell;
thread_local! {
    static SIMS: RefCell<Vec<Option<Sim>>> = const { RefCell::new(Vec::new()) };
    static OUT: RefCell<Vec<f64>> = const { RefCell::new(Vec::new()) };
    static ERR: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}
fn set_err(m: &str) {
    ERR.with(|e| *e.borrow_mut() = m.as_bytes().to_vec());
}

#[no_mangle]
pub extern "C" fn wave_alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}
/// # Safety
/// p and n must come from wave_alloc.
#[no_mangle]
pub unsafe extern "C" fn wave_free(p: *mut u8, n: usize) {
    drop(Vec::from_raw_parts(p, 0, n.max(1)));
}
/// A model from its spec (UTF-8 JSON {e, intake, exhaust, opt}); 0 when the spec is refused (wave_error says why).
/// # Safety
/// p..p+n must be readable.
#[no_mangle]
pub unsafe extern "C" fn wave_new(p: *const u8, n: usize) -> u32 {
    let s = match std::str::from_utf8(std::slice::from_raw_parts(p, n)) {
        Ok(s) => s,
        Err(_) => {
            set_err("the spec is not UTF-8");
            return 0;
        }
    };
    match Sim::new(s) {
        Ok(sim) => SIMS.with(|v| {
            let mut v = v.borrow_mut();
            v.push(Some(sim));
            v.len() as u32
        }),
        Err(e) => {
            set_err(&e);
            0
        }
    }
}
/// One speed. Returns the number of doubles in wave_out (0 on an error): ve, imep, pmax, resid, pEvo, tEx,
/// overlapPort, then each cylinder's ve and imep.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn wave_step(id: u32, rpm: f64, first: u32, dx: f64, cycles: f64, first_cycles: f64, max_extra: f64, tol: f64) -> u32 {
    SIMS.with(|v| {
        let mut v = v.borrow_mut();
        let Some(Some(sim)) = v.get_mut((id as usize).wrapping_sub(1)) else {
            set_err("no such model");
            return 0;
        };
        match sim.step(rpm, first != 0, dx, cycles, first_cycles, max_extra, tol) {
            Ok(r) => OUT.with(|o| {
                let mut o = o.borrow_mut();
                o.clear();
                o.extend_from_slice(&r.v);
                for c in &r.per_cyl {
                    o.extend_from_slice(c);
                }
                o.len() as u32
            }),
            Err(e) => {
                set_err(&e);
                0
            }
        }
    })
}
#[no_mangle]
pub extern "C" fn wave_out() -> *const f64 {
    OUT.with(|o| o.borrow().as_ptr())
}
#[no_mangle]
pub extern "C" fn wave_vd(id: u32) -> f64 {
    SIMS.with(|v| v.borrow().get((id as usize).wrapping_sub(1)).and_then(|s| s.as_ref()).map_or(f64::NAN, |s| s.vd()))
}
#[no_mangle]
pub extern "C" fn wave_drop(id: u32) {
    SIMS.with(|v| {
        if let Some(s) = v.borrow_mut().get_mut((id as usize).wrapping_sub(1)) {
            *s = None;
        }
    });
}
#[no_mangle]
pub extern "C" fn wave_error() -> *const u8 {
    ERR.with(|e| e.borrow().as_ptr())
}
#[no_mangle]
pub extern "C" fn wave_error_len() -> usize {
    ERR.with(|e| e.borrow().len())
}
