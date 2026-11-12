//! intake_cfd.py's case generator in Rust, for the cases the program generates itself: 3-D intake tracts (a bend,
//! or an STL from CAD) and exhaust components from an STL, meshed with snappyHexMesh. The browser writes 2-D
//! (axisymmetric sector) cases itself (cfd/intake_cfd.js), so the 2-D sector mesh is not here.
//!
//! Line for line from the Python, in its order of operations, so a case comes out byte for byte as
//! `python3 intake_cfd.py design.json case` writes it (cfd/gen_rs_vs_py.py checks that): the Python's own text
//! templates (cfd_templates.rs, extracted from intake_cfd.py) filled in by a printf-style formatter, its float
//! formatting (repr, %g, %e), its dict orders, round() to even, the compensated sum() of Python 3.12 and later, and
//! min/max in Python's argument order. The C library's sin, cos, atan2, sqrt and pow are the ones Python calls.

#![allow(clippy::too_many_arguments, clippy::type_complexity, clippy::needless_range_loop)]

use crate::cfd_templates as T;
use crate::pyfmt::{dumps, gen, pct, pct_named, pmax, pmin, psum, Dict, Py, A};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

type R<T> = Result<T, String>;
type V3 = [f64; 3];
type Tri = [V3; 3];

const PI: f64 = std::f64::consts::PI;
const DEG2RAD: f64 = PI / 180.0;
const R_UNIV: f64 = 8.314462618;
const M_AIR: f64 = 28.9647e-3;
const R_AIR: f64 = R_UNIV / M_AIR;
const CP_AIR: f64 = 1004.5;
const GAMMA: f64 = CP_AIR / (CP_AIR - R_AIR);
const SUTH_AS: f64 = 1.458e-6;
const SUTH_TS: f64 = 110.4;
const PR_T: f64 = 0.85;
const MACH_COMPRESSIBLE: f64 = 0.20;
const MACH_TRANSONIC: f64 = 0.60;
const RAMP_ITER: i64 = 300;
const WALL_CELLS_3D: f64 = 2.5;
const LIP_CELLS_3D: f64 = 2.0;

fn derr(m: String) -> String {
    format!("DESIGN ERROR: {}", m)
}
macro_rules! bail {
    ($($t:tt)*) => { return Err(derr(format!($($t)*))) };
}

fn radians(x: f64) -> f64 {
    x * DEG2RAD
}
/// Python's round(x) to an int: halves to even.
fn pround(x: f64) -> i64 {
    x.round_ties_even() as i64
}

// ------------------------------------------------------------------------------------------- vectors

fn v_add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn v_sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn v_mul(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn v_dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn v_cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn v_norm(a: V3) -> V3 {
    let m = v_dot(a, a).sqrt();
    if m > 0.0 {
        [a[0] / m, a[1] / m, a[2] / m]
    } else {
        [0.0, 0.0, 0.0]
    }
}
fn v_len(a: V3) -> f64 {
    v_dot(a, a).sqrt()
}
fn rotate_about(v: V3, axis: V3, ang: f64) -> V3 {
    let (c, s) = (ang.cos(), ang.sin());
    v_add(v_add(v_mul(v, c), v_mul(v_cross(axis, v), s)), v_mul(axis, v_dot(axis, v) * (1.0 - c)))
}
fn fmt9(v: f64) -> String {
    gen(v, 9)
}
fn vec9(v: V3) -> String {
    format!("({} {} {})", fmt9(v[0]), fmt9(v[1]), fmt9(v[2]))
}
/// Python's min() / max() over a non-empty sequence: the first smallest (largest).
fn seq_min(it: impl IntoIterator<Item = f64>) -> f64 {
    let mut i = it.into_iter();
    let first = i.next().unwrap_or(f64::NAN);
    i.fold(first, pmin)
}
fn seq_max(it: impl IntoIterator<Item = f64>) -> f64 {
    let mut i = it.into_iter();
    let first = i.next().unwrap_or(f64::NAN);
    i.fold(first, pmax)
}
fn pts_of(tris: &[Tri]) -> impl Iterator<Item = V3> + '_ {
    tris.iter().flat_map(|t| t.iter().copied())
}
fn bbox(tris: &[&[Tri]]) -> ([f64; 3], [f64; 3]) {
    let all: Vec<V3> = tris.iter().flat_map(|t| pts_of(t)).collect();
    let mut lo = [0.0; 3];
    let mut hi = [0.0; 3];
    for i in 0..3 {
        lo[i] = seq_min(all.iter().map(|p| p[i]));
        hi[i] = seq_max(all.iter().map(|p| p[i]));
    }
    (lo, hi)
}
fn py_list_repr(v: &[String]) -> String {
    format!("[{}]", v.iter().map(|s| format!("'{}'", s)).collect::<Vec<_>>().join(", "))
}

// ------------------------------------------------------------------------------------------- Python values

fn get<'a>(d: &'a Py, k: &str) -> Option<&'a Py> {
    match d {
        Py::Dict(m) => m.get(k).filter(|v| **v != Py::None),
        _ => None,
    }
}
fn has(d: &Py, k: &str) -> bool {
    matches!(d, Py::Dict(m) if m.contains(k))
}
fn raw<'a>(d: &'a Py, k: &str) -> Option<&'a Py> {
    match d {
        Py::Dict(m) => m.get(k),
        _ => None,
    }
}
/// float(x)
fn fl(v: &Py) -> R<f64> {
    match v {
        Py::Int(i) => Ok(*i as f64),
        Py::Float(f) => Ok(*f),
        Py::Bool(b) => Ok(if *b { 1.0 } else { 0.0 }),
        Py::Str(s) => {
            let t = s.trim().to_lowercase().replace('_', "");
            t.parse::<f64>().map_err(|_| derr(format!("could not convert string to float: '{}'", s)))
        }
        _ => Err(derr("float() argument must be a string or a real number".into())),
    }
}
/// int(x)
fn int(v: &Py) -> R<i64> {
    match v {
        Py::Int(i) => Ok(*i),
        Py::Float(f) if f.is_finite() => Ok(f.trunc() as i64),
        Py::Bool(b) => Ok(*b as i64),
        Py::Str(s) => s.trim().replace('_', "").parse::<i64>().map_err(|_| derr(format!("invalid literal for int() with base 10: '{}'", s))),
        _ => Err(derr("int() argument must be a string or a real number".into())),
    }
}
fn fget(d: &Py, k: &str, def: f64) -> R<f64> {
    get(d, k).map(fl).unwrap_or(Ok(def))
}
fn sget(d: &Py, k: &str, def: &str) -> String {
    get(d, k).map(|v| v.str()).unwrap_or_else(|| def.to_string())
}
fn fkey(d: &Py, k: &str) -> R<f64> {
    fl(raw(d, k).ok_or_else(|| derr(format!("KeyError: '{}'", k)))?)
}
fn items(d: Option<&Py>) -> Vec<(String, Py)> {
    match d {
        Some(Py::Dict(m)) => m.0.clone(),
        _ => Vec::new(),
    }
}
fn safe_name(s: &str) -> String {
    let mut out: String = s.chars().map(|c| if c.is_alphanumeric() || c == '_' { c } else { '_' }).collect();
    if out.is_empty() || !out.chars().next().unwrap().is_alphabetic() {
        out = format!("p_{}", out);
    }
    out
}
fn set_ordered<V>(v: &mut Vec<(String, V)>, k: String, x: V) {
    if let Some(e) = v.iter_mut().find(|e| e.0 == k) {
        e.1 = x;
    } else {
        v.push((k, x));
    }
}

// ------------------------------------------------------------------------------------------- the design

/// The inlet piece; the plain pipe's wall and the ellipse's rim only shape the 2-D sector's cap (not here).
#[derive(Clone)]
#[allow(dead_code)]
enum Inlet {
    Plain { t: f64 },
    Radius { rc: f64 },
    Ellipse { l: f64, di: f64, de: f64, rc: f64, t: f64 },
    Taper { di: f64, alpha: f64, rl: f64 },
    Profile { pts: Vec<(f64, f64)>, t: f64 },
}
#[derive(Clone)]
struct Dc {
    d2: f64,
    beta: f64,
    x0: f64,
}
#[derive(Clone)]
struct Bend {
    clr: f64,
    angle: f64,
    s0: f64,
    plane: f64,
}
/// The outside of a free-standing tube (free_mount_surface): its triangles (patch inlet_wall), the outer ring at the
/// plenum wall x = p, the thinnest wall between bore and outside, the outer radius.
struct Free3d {
    tris: Vec<Tri>,
    lp: Vec<V3>,
    p: f64,
    gap: f64,
    r_out: f64,
    rlip: Option<f64>,
}
struct InletExh {
    name: String,
    a: f64,
    d: f64,
    centre: V3,
    normal: V3,
    ext: Vec<Tri>,
    cap: Vec<Tri>,
}

#[derive(Default)]
struct Geo {
    kind: String,
    exhaust: bool,
    ext_in_d: f64,
    inlet_split: Option<Vec<(String, f64)>>,
    scale: f64,
    stl: Py,
    base_dir: PathBuf,
    planes3d: Vec<(String, (V3, V3))>,
    ext_d: f64,
    mount: String,
    mount_given: bool,
    protrusion: Option<f64>,
    // parametric
    d: f64,
    l: f64,
    inlet: Option<Inlet>,
    dcs: Vec<Dc>,
    bends: Vec<Bend>,
    planes: Vec<(String, f64)>,
    // filled in by the geometry preparation
    profile_inner: Vec<(f64, f64)>,
    profile_front_r: f64,
    profile_cap: Vec<(f64, f64)>,
    profile_r_out: f64,
    free3d: Option<Free3d>,
    tris: HashMap<&'static str, Vec<Tri>>,
    inlet_caps: Vec<(String, Vec<Tri>)>,
    mouth_loop: Vec<V3>,
    dref: f64,
    amin: f64,
    d_mouth: f64,
    tract_end: (V3, V3, f64),
    bbox: ([f64; 3], [f64; 3]),
    planes_local: Vec<(String, (V3, V3))>,
    inlets: Vec<InletExh>,
    a_in_total: f64,
    exit_face: (V3, V3, f64),
    loc_in_mesh: V3,
    planes_exhaust: Vec<(String, (V3, V3, Option<f64>, f64))>,
    split: Vec<(String, f64)>,
    mount_note: Option<String>,
}

struct Design {
    name: String,
    p_amb: f64,
    t_amb: f64,
    mode_kind: String,
    t_gas: f64,
    t_air: Option<f64>,
    afr: f64,
    g: Geo,
    op_in: Py,
    mesh_level: String,
    mesh_overrides: Py,
    solver_force: Option<String>,
    max_iter: i64,
    turbulence_in: Py,
    write_interval: i64,
}

/// A measured mouth profile (intake_cfd.profile_points): points_mm [[x, r], ...] from the mouth plane into the tube.
fn profile_points(pts: Option<&Py>, d: f64) -> R<Vec<(f64, f64)>> {
    let mm = 1e-3;
    let list = match pts {
        Some(Py::List(a)) if a.len() >= 3 => a,
        _ => bail!("profile inlet needs points_mm: [[x, r], ...] in mm, at least 3 points"),
    };
    let mut p: Vec<(f64, f64)> = Vec::new();
    for q in list {
        match q {
            Py::List(xy) if xy.len() >= 2 => match (fl(&xy[0]), fl(&xy[1])) {
                (Ok(x), Ok(r)) => p.push((x * mm, r * mm)),
                _ => bail!("profile points_mm must be [x, r] pairs of numbers (mm)"),
            },
            _ => bail!("profile points_mm must be [x, r] pairs of numbers (mm)"),
        }
    }
    let r = d / 2.0;
    if p[0].0.abs() > 1e-9 {
        bail!("profile points_mm must start at x = 0 (the mouth plane), not {} mm", pct("%.3f", &[A::F(p[0].0 / mm)]));
    }
    for i in 0..p.len() - 1 {
        if p[i + 1].0 <= p[i].0 {
            bail!("{}", pct("profile points_mm: x must rise from point to point (point %d at %.3f mm, point %d at %.3f mm)", &[A::I(i as i64 + 1), A::F(p[i].0 / mm), A::I(i as i64 + 2), A::F(p[i + 1].0 / mm)]));
        }
        if p[i + 1].1 > p[i].1 + 1e-12 {
            bail!("{}", pct("profile points_mm: r must fall (or stay) toward the bore (point %d at r %.3f mm, point %d at %.3f mm)", &[A::I(i as i64 + 1), A::F(p[i].1 / mm), A::I(i as i64 + 2), A::F(p[i + 1].1 / mm)]));
        }
    }
    let n = p.len();
    if (p[n - 1].1 - r).abs() > 1e-6 {
        bail!("{}", pct("profile points_mm must end at the tube bore, r = %.3f mm (it ends at %.3f mm)", &[A::F(r / mm), A::F(p[n - 1].1 / mm)]));
    }
    if p[0].1 <= r + 1e-6 {
        bail!("{}", pct("profile points_mm must flare: the first radius (%.3f mm) must exceed the bore (%.3f mm)", &[A::F(p[0].1 / mm), A::F(r / mm)]));
    }
    let a0 = (p[0].1 - p[1].1).atan2(p[1].0 - p[0].0) * (180.0 / PI);
    if a0 < 45.0 {
        bail!("{}", pct("profile points_mm: the first segment is at %.1f degrees to the axis; the mouth must leave its plane at 45 degrees or more (a rounded rim)", &[A::F(a0)]));
    }
    p[n - 1] = (p[n - 1].0, r);
    Ok(p)
}

fn normalise(design: &Py, base_dir: &Path) -> R<Design> {
    if !matches!(design, Py::Dict(_)) {
        bail!("design must be a dict");
    }
    let name = sget(design, "name", "intake").trim().to_string();
    let name = if name.is_empty() { "intake".to_string() } else { name };
    let g_in = match raw(design, "geometry") {
        Some(g @ Py::Dict(_)) => g.clone(),
        _ => bail!("design['geometry'] is required"),
    };
    let amb = match raw(design, "ambient") {
        Some(a) if a.truthy() => a.clone(),
        _ => Py::Dict(Dict::new()),
    };
    let p_amb = fget(&amb, "p_pa", 101325.0)?;
    let mut t_amb = if has(&amb, "T_c") || has(&amb, "T_k") {
        if has(&amb, "T_k") {
            fl(raw(&amb, "T_k").unwrap())?
        } else {
            fl(raw(&amb, "T_c").unwrap())? + 273.15
        }
    } else {
        298.15
    };
    if !(20e3 < p_amb && p_amb < 200e3) {
        bail!("ambient pressure {} Pa is outside 20-200 kPa", pct("%.0f", &[A::F(p_amb)]));
    }
    if !(200.0 < t_amb && t_amb < 400.0) {
        bail!("ambient temperature {} K is outside 200-400 K", pct("%.1f", &[A::F(t_amb)]));
    }
    let mode_kind = sget(design, "mode", "intake").to_lowercase();
    if mode_kind != "intake" && mode_kind != "exhaust" {
        bail!("mode must be 'intake' or 'exhaust'");
    }
    let (mut t_gas, mut t_air, mut afr) = (0.0, None, 0.0);
    if mode_kind == "exhaust" {
        let gas = match raw(design, "gas") {
            Some(a) if a.truthy() => a.clone(),
            _ => Py::Dict(Dict::new()),
        };
        t_gas = if has(&gas, "T_k") { fl(raw(&gas, "T_k").unwrap())? } else { fget(&gas, "T_c", 650.0)? + 273.15 };
        if !(250.0 < t_gas && t_gas < 1400.0) {
            bail!("gas temperature {} K is outside 250-1400 K", pct("%.0f", &[A::F(t_gas)]));
        }
        t_air = Some(t_amb);
        t_amb = t_gas;
        afr = fget(&gas, "afr", 12.5)?;
        if !has(&g_in, "stl") {
            bail!("exhaust mode needs geometry.stl (an STL from CAD with faces named inlet / inlet1..N and outlet)");
        }
    }
    let mm = 1e-3;
    let mut g = Geo::default();
    if has(&g_in, "stl") {
        g.kind = "stl".into();
        g.exhaust = mode_kind == "exhaust";
        g.ext_in_d = fget(&g_in, "inlet_extension_D", 2.0)?;
        let op0 = match raw(design, "operating_point") {
            Some(a) if a.truthy() => a.clone(),
            _ => Py::Dict(Dict::new()),
        };
        g.inlet_split = match get(&op0, "inlet_split") {
            Some(Py::Dict(m)) => Some(m.0.iter().map(|(k, v)| Ok((k.clone(), fl(v)?))).collect::<R<Vec<_>>>()?),
            _ => None,
        };
        let units = sget(&g_in, "stl_units", "mm").to_lowercase();
        g.scale = match units.as_str() {
            "mm" => 1e-3,
            "m" => 1.0,
            "cm" => 1e-2,
            "in" | "inch" => 0.0254,
            _ => bail!("stl_units must be mm, cm, m or in"),
        };
        g.stl = raw(&g_in, "stl").unwrap().clone();
        g.base_dir = base_dir.to_path_buf();
        for (nm, pl) in items(get(&g_in, "planes").filter(|p| p.truthy())) {
            let coords = |k: &str, s: f64| -> R<V3> {
                match raw(&pl, k) {
                    Some(Py::List(a)) if a.len() >= 3 => Ok([fl(&a[0])? * s, fl(&a[1])? * s, fl(&a[2])? * s]),
                    _ => Err(derr(format!("plane '{}' needs {} as three numbers", nm, k))),
                }
            };
            let pt = if has(&pl, "point_mm") {
                coords("point_mm", g.scale)?
            } else {
                coords("point_m", 1.0)?
            };
            let nn = match raw(&pl, "normal") {
                Some(Py::List(a)) if a.len() >= 3 => v_norm([fl(&a[0])?, fl(&a[1])?, fl(&a[2])?]),
                _ => bail!("plane '{}' needs a normal", nm),
            };
            set_ordered(&mut g.planes3d, safe_name(&nm), (pt, nn));
        }
        g.ext_d = fget(&g_in, "outlet_extension_D", 4.0)?;
        g.mount = "flange".into();
    } else {
        let d = fget(&g_in, "tube_diameter_mm", 0.0)? * mm;
        let lt = fget(&g_in, "tube_length_mm", 0.0)? * mm;
        if d <= 0.0 || lt <= 0.0 {
            bail!("tube_diameter_mm and tube_length_mm must be > 0");
        }
        g.d = d;
        g.l = lt;
        let inl = get(&g_in, "inlet").cloned().unwrap_or_else(|| Py::Dict(Dict(vec![("type".into(), Py::Str("plain".into()))])));
        let t = sget(&inl, "type", "plain").to_lowercase();
        g.inlet = Some(match t.as_str() {
            "plain" => Inlet::Plain { t: fget(&inl, "wall_thickness_mm", pmax(1.5, 0.06 * d / mm))? * mm },
            "radius" => {
                let rc = fget(&inl, "lip_radius_mm", 0.15 * d / mm)? * mm;
                if rc <= 0.0 {
                    bail!("radius inlet needs lip_radius_mm > 0");
                }
                Inlet::Radius { rc }
            }
            "ellipse" => {
                let l = fget(&inl, "length_mm", d / mm)? * mm;
                let di = fget(&inl, "entry_diameter_mm", 2.0 * d / mm)? * mm;
                let de = fget(&inl, "exit_diameter_mm", d / mm)? * mm;
                let rc = fget(&inl, "corner_radius_mm", 0.0)? * mm;
                let t = fget(&inl, "rim_thickness_mm", 1.5)? * mm;
                if (de - d).abs() > 1e-6 {
                    bail!("ellipse exit_diameter_mm must equal tube_diameter_mm");
                }
                if di <= de || l <= 0.0 {
                    bail!("ellipse needs entry_diameter > exit_diameter and length > 0");
                }
                Inlet::Ellipse { l, di, de, rc, t }
            }
            "taper" => {
                let di = fget(&inl, "entry_diameter_mm", 1.6 * d / mm)? * mm;
                let alpha = radians(fget(&inl, "wall_half_angle_deg", 10.0)?);
                let rl = fget(&inl, "lip_radius_mm", 0.1 * d / mm)? * mm;
                if di <= d {
                    bail!("taper entry_diameter_mm must exceed tube_diameter_mm");
                }
                if !(radians(1.0) <= alpha && alpha <= radians(60.0)) {
                    bail!("taper wall_half_angle_deg must be 1..60");
                }
                if rl < 0.2e-3 {
                    bail!("taper lip_radius_mm must be >= 0.2 mm");
                }
                Inlet::Taper { di, alpha, rl }
            }
            "profile" => Inlet::Profile { pts: profile_points(raw(&inl, "points_mm"), d)?, t: fget(&inl, "rim_thickness_mm", 1.5)? * mm },
            _ => bail!("inlet type must be plain, radius, ellipse, taper or profile"),
        });
        let mount = get(&g_in, "mount").cloned().unwrap_or_else(|| Py::Dict(Dict(vec![("type".into(), Py::Str("free".into()))])));
        g.mount = sget(&mount, "type", "free").to_lowercase();
        if g.mount != "free" && g.mount != "flange" {
            bail!("mount type must be free or flange");
        }
        g.protrusion = if has(&mount, "protrusion_mm") { Some(fl(raw(&mount, "protrusion_mm").unwrap())? * mm) } else { None };
        g.mount_given = raw(&g_in, "mount").is_some_and(|v| v.truthy());
        // one dict, or an ordered list of them; each cone starts from the bore the one before it left (cone_spans)
        let dcl: Vec<Py> = match raw(&g_in, "diameter_change") {
            Some(Py::List(a)) => a.clone(),
            Some(v) if v.truthy() => vec![v.clone()],
            _ => Vec::new(),
        };
        for dc in &dcl {
            let dcv = Dc { d2: fkey(dc, "to_diameter_mm")? * mm, beta: radians(fget(dc, "cone_half_angle_deg", 7.0)?), x0: fkey(dc, "start_mm")? * mm };
            if !(0.0 < dcv.beta && dcv.beta <= radians(60.0)) {
                bail!("cone_half_angle_deg must be in (0, 60]");
            }
            if dcv.d2 <= 0.0 {
                bail!("diameter_change to_diameter_mm must be > 0");
            }
            g.dcs.push(dcv);
        }
        if let Some(bd) = raw(&g_in, "bend").filter(|v| v.truthy()) {
            let bl: Vec<Py> = match bd {
                Py::List(a) => a.clone(),
                other => vec![other.clone()],
            };
            for b in &bl {
                g.bends.push(Bend { clr: fkey(b, "clr_mm")? * mm, angle: radians(fkey(b, "angle_deg")?), s0: fkey(b, "start_mm")? * mm, plane: radians(fget(b, "plane_deg", 0.0)?) });
            }
        }
        if raw(&g_in, "maf_plane_mm").is_some_and(|v| *v != Py::None) {
            set_ordered(&mut g.planes, "maf".into(), fl(raw(&g_in, "maf_plane_mm").unwrap())? * mm);
        }
        for (nm, x) in items(get(&g_in, "planes_mm").filter(|p| p.truthy())) {
            set_ordered(&mut g.planes, safe_name(&nm), fl(&x)? * mm);
        }
        g.ext_d = fget(&g_in, "outlet_extension_D", 4.0)?;
        let force = sget(&g_in, "force_3d", "False").to_lowercase() == "true" || raw(&g_in, "force_3d") == Some(&Py::Bool(true));
        g.kind = if !g.bends.is_empty() || force { "3d".into() } else { "axisym".into() };
    }
    let op = match raw(design, "operating_point") {
        Some(o @ Py::Dict(_)) => o.clone(),
        _ => bail!("design['operating_point'] is required"),
    };
    let m = match raw(design, "mesh") {
        Some(a) if a.truthy() => a.clone(),
        _ => Py::Dict(Dict::new()),
    };
    let lvl = sget(&m, "level", "medium").to_lowercase();
    if !["coarse", "medium", "fine"].contains(&lvl.as_str()) {
        bail!("mesh level must be coarse, medium or fine");
    }
    let sv = match raw(design, "solver") {
        Some(a) if a.truthy() => a.clone(),
        _ => Py::Dict(Dict::new()),
    };
    let solver_force = match get(&sv, "force") {
        None => None,
        Some(Py::Str(s)) if s == "compressible" || s == "incompressible" => Some(s.clone()),
        _ => bail!("solver.force must be compressible, incompressible or null"),
    };
    let max_iter = get(&sv, "max_iterations").map(int).unwrap_or(Ok(0))?;
    let turbulence_in = match raw(design, "turbulence") {
        Some(a) if a.truthy() => a.clone(),
        _ => Py::Dict(Dict::new()),
    };
    let write_interval = get(&sv, "write_interval").map(int).unwrap_or(Ok(0))?;
    Ok(Design {
        name,
        p_amb,
        t_amb,
        mode_kind,
        t_gas,
        t_air,
        afr,
        g,
        op_in: op,
        mesh_level: lvl,
        mesh_overrides: m,
        solver_force,
        max_iter,
        turbulence_in,
        write_interval,
    })
}

struct Lv {
    level3d: i64,
    bg3d: f64,
}
fn mesh_level(name: &str) -> Lv {
    match name {
        "coarse" => Lv { level3d: 2, bg3d: 2.0 },
        "fine" => Lv { level3d: 3, bg3d: 3.0 },
        _ => Lv { level3d: 3, bg3d: 2.0 },
    }
}

// ------------------------------------------------------------------------------------------- physics

fn mu_air(t: f64) -> f64 {
    SUTH_AS * t.sqrt() / (1.0 + SUTH_TS / t)
}
fn ideal_mass_flux(p0: f64, t0: f64, p: f64) -> f64 {
    let g = GAMMA;
    let pr_crit = (2.0 / (g + 1.0)).powf(g / (g - 1.0));
    let pr = pmax(pmin(p / p0, 1.0), pr_crit);
    p0 * (2.0 * g / ((g - 1.0) * R_AIR * t0)).sqrt() * pr.powf(1.0 / g) * pmax(0.0, 1.0 - pr.powf((g - 1.0) / g)).sqrt()
}
fn mach_from_mass_flux(gf: f64, p0: f64, t0: f64) -> R<f64> {
    let g = GAMMA;
    let flux = |m: f64| p0 * (g / (R_AIR * t0)).sqrt() * m * (1.0 + 0.5 * (g - 1.0) * m * m).powf(-(g + 1.0) / (2.0 * (g - 1.0)));
    if gf >= flux(1.0) {
        bail!(
            "requested mass flow exceeds the choked (sonic) limit of the smallest cross-section ({} kg/s/m^2 > {})",
            pct("%.1f", &[A::F(gf)]),
            pct("%.1f", &[A::F(flux(1.0))])
        );
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    for _ in 0..80 {
        let mid = 0.5 * (lo + hi);
        if flux(mid) < gf {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    Ok(0.5 * (lo + hi))
}
fn friction_factor_haaland(re: f64, rel: f64) -> f64 {
    if re < 2300.0 {
        return 64.0 / pmax(re, 1.0);
    }
    (-1.8 * ((rel / 3.7).powf(1.11) + 6.9 / re).log10()).powf(-2.0)
}
fn friction_factor_colebrook(re: f64) -> f64 {
    let rel = 0.0;
    if re < 2300.0 {
        return 64.0 / pmax(re, 1.0);
    }
    let mut f = friction_factor_haaland(re, rel);
    for _ in 0..60 {
        f = (-2.0 * (rel / 3.7 + 2.51 / (re * f.sqrt())).log10()).powf(-2.0);
    }
    f
}

struct Engine {
    vd: f64,
    rpm: f64,
    ve: f64,
    strokes: i64,
    cylinders: i64,
    cylinders_fed: i64,
    flow_factor: f64,
}
fn engine_mass_flow(eng: &Py, rho_amb: f64) -> R<(f64, Engine)> {
    let vd = if has(eng, "displacement_cc") {
        fkey(eng, "displacement_cc")? * 1e-6
    } else if has(eng, "displacement_l") {
        fkey(eng, "displacement_l")? * 1e-3
    } else {
        bail!("engine needs displacement_cc or displacement_l");
    };
    let rpm = fkey(eng, "rpm")?;
    let mut ve = fget(eng, "ve", 0.9)?;
    if ve > 3.0 {
        ve /= 100.0;
    }
    let strokes = get(eng, "strokes").map(int).unwrap_or(Ok(4))?;
    if strokes != 2 && strokes != 4 {
        bail!("strokes must be 2 or 4");
    }
    let ncyl = get(eng, "cylinders").map(int).unwrap_or(Ok(1))?;
    let nfed = get(eng, "cylinders_fed").map(int).unwrap_or(Ok(ncyl))?;
    let peak = fget(eng, "flow_factor", 1.0)?;
    let revs = if strokes == 4 { 2.0 } else { 1.0 };
    if ncyl == 0 {
        return Err("ZeroDivisionError: float division by zero".into());
    }
    let mdot = ve * rho_amb * vd * rpm / 60.0 / revs * nfed as f64 / ncyl as f64 * peak;
    Ok((mdot, Engine { vd, rpm, ve, strokes, cylinders: ncyl, cylinders_fed: nfed, flow_factor: peak }))
}

#[derive(Default)]
struct Der {
    p_amb: f64,
    t_amb: f64,
    rho_amb: f64,
    mu_amb: f64,
    nu_amb: f64,
    d_re: f64,
    mode: String,
    op_source: String,
    mdot: Option<f64>,
    mdot_estimate: Option<f64>,
    pr: Option<f64>,
    p_out: Option<f64>,
    m_bulk: f64,
    u_bulk: f64,
    m_peak: f64,
    u_peak: f64,
    compressible: bool,
    solver: String,
    solver_why: String,
    transonic: bool,
    re: f64,
    f_colebrook: f64,
    u_tau: f64,
    nu_s: f64,
    h_wall_wf: f64,
    k_in: f64,
    omega_in: f64,
    i_in: f64,
    nut_ratio_in: f64,
    flow_scale: f64,
    numerics: Option<Dict>,
}

/// The diameter changes in order: (x0, length, radius from, radius to), each from the bore the one before it left.
fn cone_spans(g: &Geo) -> Vec<(f64, f64, f64, f64)> {
    let mut out = Vec::new();
    let mut r = g.d / 2.0;
    for dc in &g.dcs {
        let r2 = dc.d2 / 2.0;
        out.push((dc.x0, (r2 - r).abs() / dc.beta.tan(), r, r2));
        r = r2;
    }
    out
}
fn tube_radius(g: &Geo, x: f64) -> f64 {
    let mut r = g.d / 2.0;
    for (x0, lc, _r1, r2) in cone_spans(g) {
        if x <= x0 {
            return r;
        }
        if x >= x0 + lc {
            r = r2;
            continue;
        }
        return r + (r2 - r) * (x - x0) / lc;
    }
    r
}

fn derive(d: &Design) -> R<Der> {
    let (p0, t0) = (d.p_amb, d.t_amb);
    let rho0 = p0 / (R_AIR * t0);
    let mu0 = mu_air(t0);
    let g = &d.g;
    let op = &d.op_in;
    let mut der = Der { p_amb: p0, t_amb: t0, rho_amb: rho0, mu_amb: mu0, nu_amb: mu0 / rho0, ..Default::default() };
    let (_dref, amin, peak_factor) = if g.kind == "stl" {
        (g.dref, g.amin, 1.3)
    } else {
        let mut rs = vec![g.d / 2.0];
        rs.extend(cone_spans(g).iter().map(|c| tube_radius(g, pmin(c.0 + c.1, g.l))));
        rs.push(tube_radius(g, g.l));
        let rmin = seq_min(rs);
        let amin = PI * rmin.powf(2.0);
        let mut pf = match g.inlet.as_ref().unwrap() {
            Inlet::Plain { .. } => 1.6,
            Inlet::Taper { .. } => 1.2,
            Inlet::Radius { .. } => 1.1,
            Inlet::Ellipse { .. } => 1.05,
            Inlet::Profile { .. } => 1.05,
        };
        if !g.bends.is_empty() {
            pf *= 1.15;
        }
        (g.d, amin, pf)
    };
    der.d_re = if g.kind == "stl" && !g.inlets.is_empty() && amin >= g.a_in_total * (1.0 - 1e-9) {
        (4.0 * amin / (PI * g.inlets.len() as f64)).sqrt()
    } else {
        (4.0 * amin / PI).sqrt()
    };
    let mode;
    let mut mdot: Option<f64>;
    let mut src;
    if has(op, "mass_flow_kg_s") {
        mode = "mass_flow";
        let m = fkey(op, "mass_flow_kg_s")?;
        mdot = Some(m);
        src = pct("mass_flow_kg_s = %.6g kg/s (given)", &[A::F(m)]);
    } else if has(op, "engine") {
        mode = "mass_flow";
        let rho_eng = p0 / (R_AIR * d.t_air.unwrap_or(t0));
        let (m, info) = engine_mass_flow(raw(op, "engine").unwrap(), rho_eng)?;
        src = pct(
            "engine: VE %.3f x rho_amb %.4f kg/m3 x Vd %.1f cc x %.0f rpm / 60 / %d rev/cycle x %d/%d cyl x %.2f = %.6g kg/s",
            &[
                A::F(info.ve),
                A::F(rho_eng),
                A::F(info.vd * 1e6),
                A::F(info.rpm),
                A::I(if info.strokes == 4 { 2 } else { 1 }),
                A::I(info.cylinders_fed),
                A::I(info.cylinders),
                A::F(info.flow_factor),
                A::F(m),
            ],
        );
        let mut m = m;
        if d.mode_kind == "exhaust" {
            m *= 1.0 + 1.0 / d.afr;
            src += &pct(" of air; exhaust = air x (1 + 1/AFR %.1f) = %.6g kg/s", &[A::F(d.afr), A::F(m)]);
        }
        mdot = Some(m);
    } else if has(op, "pressure_ratio") {
        mode = "pressure_ratio";
        let pr = fkey(op, "pressure_ratio")?;
        if pr <= 1.0 {
            bail!("pressure_ratio must be > 1 (p0_ambient / p_outlet)");
        }
        der.pr = Some(pr);
        der.p_out = Some(p0 / pr);
        mdot = None;
        src = pct("pressure_ratio p0/p_out = %.5g -> p_out = %.1f Pa", &[A::F(pr), A::F(p0 / pr)]);
    } else {
        bail!("operating_point needs mass_flow_kg_s, engine or pressure_ratio");
    }
    der.mode = mode.into();
    der.op_source = src;
    let m_bulk;
    if mode == "mass_flow" {
        let m = mdot.unwrap();
        if m <= 0.0 {
            bail!("mass flow must be > 0");
        }
        m_bulk = mach_from_mass_flux(m / amin, p0, t0)?;
        der.mdot = Some(m);
    } else {
        let pr = der.pr.unwrap();
        m_bulk = (2.0 / (GAMMA - 1.0) * (pr.powf((GAMMA - 1.0) / GAMMA) - 1.0)).sqrt();
        mdot = Some(0.85 * ideal_mass_flux(p0, t0, p0 / pr) * amin);
        der.mdot_estimate = mdot;
    }
    let t_s = t0 / (1.0 + 0.5 * (GAMMA - 1.0) * m_bulk.powf(2.0));
    let a_s = (GAMMA * R_AIR * t_s).sqrt();
    let u_bulk = m_bulk * a_s;
    let m_peak = pmin(0.99, m_bulk * peak_factor);
    der.m_bulk = m_bulk;
    der.u_bulk = u_bulk;
    der.m_peak = m_peak;
    der.u_peak = m_peak * a_s;
    let (comp, why) = if d.mode_kind == "exhaust" {
        (true, "exhaust mode: hot gas with a temperature field, always compressible".to_string())
    } else if let Some(f) = &d.solver_force {
        (f == "compressible", "forced by design['solver']['force']".to_string())
    } else {
        let comp = m_peak >= MACH_COMPRESSIBLE;
        (
            comp,
            pct(
                "estimated peak Mach %.3f %s %.2f (density change ~M^2/2 = %.1f %%)",
                &[A::F(m_peak), A::S((if comp { ">=" } else { "<" }).into()), A::F(MACH_COMPRESSIBLE), A::F(50.0 * m_peak.powf(2.0))],
            ),
        )
    };
    der.compressible = comp;
    der.solver = (if comp { "rhoSimpleFoam" } else { "simpleFoam" }).into();
    der.solver_why = why;
    der.transonic = comp && m_peak >= MACH_TRANSONIC;
    if m_peak >= 0.95 {
        bail!("estimated peak Mach {}: flow would choke; steady subsonic RANS case generation refused", pct("%.2f", &[A::F(m_peak)]));
    }
    let rho_s = p0 / (R_AIR * t0) * (t_s / t0).powf(1.0 / (GAMMA - 1.0));
    let re = rho_s * u_bulk * der.d_re / mu_air(t_s);
    let f = friction_factor_colebrook(re);
    let utau_bulk = u_bulk * (f / 8.0).sqrt();
    let nu_s = mu_air(t_s) / rho_s;
    der.re = re;
    der.f_colebrook = f;
    der.u_tau = utau_bulk;
    der.nu_s = nu_s;
    der.h_wall_wf = 2.0 * 50.0 * nu_s / utau_bulk;
    let tu = &d.turbulence_in;
    let iin = match raw(tu, "intensity") {
        Some(v) => fl(v)?,
        None => 0.01,
    };
    let vr = match raw(tu, "viscosity_ratio") {
        Some(v) => fl(v)?,
        None => 1.0,
    };
    let k_in = 1.5 * (iin * u_bulk).powf(2.0);
    der.k_in = k_in;
    der.omega_in = k_in / (vr * der.nu_amb);
    der.i_in = iin;
    der.nut_ratio_in = vr;
    Ok(der)
}

// ------------------------------------------------------------------------------------------- inlet profile, 3-D path

fn arc_pts(cx: f64, cr: f64, rad: f64, a0: f64, a1: f64, n: usize) -> Vec<(f64, f64)> {
    (0..=n)
        .map(|i| {
            let a = a0 + (a1 - a0) * i as f64 / n as f64;
            (cx + rad * a.cos(), cr + rad * a.sin())
        })
        .collect()
}
fn edge_radius(g: &Geo) -> f64 {
    pmin(1e-3 * g.d, 0.05e-3)
}
/// The flow-side surface of the inlet piece (x, r) from the front to the tube start, the mouth radius, the lip's
/// outer face (the cap, front point F -> O, for a free-standing tube) and the outer radius behind it.
fn inlet_profile(g: &Geo) -> (Vec<(f64, f64)>, f64, Vec<(f64, f64)>, f64) {
    let r = g.d / 2.0;
    let re_ = edge_radius(g);
    match g.inlet.as_ref().unwrap() {
        Inlet::Plain { .. } | Inlet::Radius { .. } => {
            let rc = match g.inlet.as_ref().unwrap() {
                Inlet::Radius { rc } => *rc,
                _ => re_,
            };
            let (cx, cr) = (rc, r + rc);
            let a = arc_pts(cx, cr, rc, PI, 1.25 * PI, 24);
            let b = arc_pts(cx, cr, rc, 1.25 * PI, 1.5 * PI, 24);
            let mut inner = a;
            inner.extend_from_slice(&b[1..]);
            if let Some(Inlet::Plain { t: tw }) = g.inlet {
                let face_top = r + tw - re_;
                let mut cap: Vec<(f64, f64)> = (0..21).map(|i| (0.0, r + re_ + (face_top - r - re_) * i as f64 / 20.0)).collect();
                cap.extend_from_slice(&arc_pts(re_, face_top, re_, PI, 0.5 * PI, 12)[1..]);
                (inner, r, cap, r + tw)
            } else {
                let cap = arc_pts(cx, cr, rc, PI, 0.5 * PI, 36);
                (inner, r + rc, cap, r + 2.0 * rc)
            }
        }
        Inlet::Ellipse { l, di, de, rc, t } => {
            let (a, b) = (*l, (di - de) / 2.0);
            let (cx, cr) = (*l, di / 2.0);
            let tm = b.atan2(a);
            let p = |tt: f64| (cx - a * tt.cos(), cr - b * tt.sin());
            let (n1, n2) = (24usize, 48usize);
            let mut inner: Vec<(f64, f64)> = (0..=n1).map(|i| p(tm * i as f64 / n1 as f64)).collect();
            inner.extend((1..=n2).map(|i| p(tm + (0.5 * PI - tm) * i as f64 / n2 as f64)));
            if *rc > 0.0 {
                let cap = arc_pts(*rc, cr, *rc, PI, 0.5 * PI, 24);
                return (inner, cr, cap, cr + rc);
            }
            let face_top = cr + t - re_;
            let mut cap: Vec<(f64, f64)> = (0..17).map(|i| (0.0, cr + (face_top - cr) * i as f64 / 16.0)).collect();
            cap.extend_from_slice(&arc_pts(re_, face_top, re_, PI, 0.5 * PI, 12)[1..]);
            (inner, cr, cap, cr + t)
        }
        Inlet::Taper { di, alpha, rl } => {
            let (al, rl, ri) = (*alpha, *rl, di / 2.0);
            let (cx, cr) = (rl, ri + rl * al.cos());
            let s = (cx - rl * al.sin(), ri);
            let t = (s.0 + (ri - r) / al.tan(), r);
            let a_end = 1.5 * PI - al;
            let mut arc = if al < radians(45.0) {
                let mut a = arc_pts(cx, cr, rl, PI, 1.25 * PI, 16);
                let b = arc_pts(cx, cr, rl, 1.25 * PI, a_end, 12);
                a.extend_from_slice(&b[1..]);
                a
            } else {
                arc_pts(cx, cr, rl, PI, a_end, 24)
            };
            let ncone = 40usize;
            arc.extend((1..=ncone).map(|i| (s.0 + (t.0 - s.0) * i as f64 / ncone as f64, s.1 + (t.1 - s.1) * i as f64 / ncone as f64)));
            let cap = arc_pts(cx, cr, rl, PI, 0.5 * PI, 24);
            (arc, cr, cap, cr + rl)
        }
        Inlet::Profile { pts, t } => {
            // the points as given; the rim square, rim_thickness_mm thick (intake_cfd.inlet_profile)
            let inner = pts.clone();
            let cr = inner[0].1;
            let face_top = cr + t - re_;
            let mut cap: Vec<(f64, f64)> = (0..17).map(|i| (0.0, cr + (face_top - cr) * i as f64 / 16.0)).collect();
            cap.extend_from_slice(&arc_pts(re_, face_top, re_, PI, 0.5 * PI, 12)[1..]);
            (inner, cr, cap, cr + t)
        }
    }
}

enum Seg {
    Line(f64),
    Arc(f64, f64, f64, f64), // length, radius, angle, plane
}
struct Path3D {
    segs: Vec<Seg>,
}
impl Path3D {
    fn straight(&mut self, l: f64) {
        if l > 1e-12 {
            self.segs.push(Seg::Line(l));
        }
    }
    fn arc(&mut self, radius: f64, angle: f64, plane: f64) {
        self.segs.push(Seg::Arc(radius * angle, radius, angle, plane));
    }
    fn frame(&self, s: f64) -> (V3, V3, V3, V3) {
        let (mut p, mut t, mut n1, mut n2) = ([0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]);
        let mut rem = s;
        for sg in &self.segs {
            let l = match sg {
                Seg::Line(l) => *l,
                Seg::Arc(l, ..) => *l,
            };
            let ds = pmin(rem, l);
            match sg {
                Seg::Line(_) => p = v_add(p, v_mul(t, ds)),
                Seg::Arc(_, radius, _angle, plane) => {
                    let k = rotate_about(n1, t, *plane);
                    let axis = v_norm(v_cross(t, k));
                    let centre = v_add(p, v_mul(k, *radius));
                    let ang = ds / radius;
                    let rel = v_sub(p, centre);
                    p = v_add(centre, rotate_about(rel, axis, ang));
                    t = rotate_about(t, axis, ang);
                    n1 = rotate_about(n1, axis, ang);
                    n2 = rotate_about(n2, axis, ang);
                }
            }
            rem -= ds;
            if rem <= 1e-15 {
                break;
            }
        }
        if rem > 1e-9 {
            p = v_add(p, v_mul(t, rem));
        }
        (p, t, n1, n2)
    }
}

fn tri_area_vec(t: &Tri) -> V3 {
    v_mul(v_cross(v_sub(t[1], t[0]), v_sub(t[2], t[0])), 0.5)
}

struct Surf {
    wall: Vec<Tri>,
    ext: Vec<Tri>,
    outlet: Vec<Tri>,
    mouth: Vec<Tri>,
    mouth_loop: Vec<V3>,
    path: Path3D,
    s_end: f64,
    free: Option<Free3d>,
}

fn build_param_3d_surface(g: &Geo, inner: &[(f64, f64)], nphi: usize) -> R<Surf> {
    let mut path = Path3D { segs: Vec::new() };
    let mut bends = g.bends.clone();
    bends.sort_by(|a, b| a.s0.partial_cmp(&b.s0).unwrap_or(std::cmp::Ordering::Equal));
    let mut s_cur = 0.0;
    let lin = inner.last().unwrap().0;
    for b in &bends {
        if b.s0 < lin - 1e-9 {
            bail!("bend must start after the inlet piece (s >= {} mm)", pct("%.1f", &[A::F(lin * 1e3)]));
        }
        path.straight(b.s0 - s_cur);
        path.arc(b.clr, b.angle, b.plane);
        s_cur = b.s0 + b.clr * b.angle;
    }
    if s_cur > g.l + 1e-9 {
        bail!("bend ends beyond the tract end (tube_length_mm)");
    }
    let spans = cone_spans(g);
    for (i, &(x0, lc, _, _)) in spans.iter().enumerate() {
        if i > 0 && (x0 < spans[i - 1].0 + spans[i - 1].1 - 1e-9 || x0 + lc > g.l + 1e-9) {
            bail!(
                "diameter change {} must start where change {} ends or after it (x >= {} mm) and end before the tract end",
                i + 1,
                i,
                pct("%.1f", &[A::F((spans[i - 1].0 + spans[i - 1].1) * 1e3)])
            );
        }
    }
    // a cone may overlap a bend (cfd/NOTES.md 4 (k)): its two ends are stations of their own
    let cone_on_bend: Vec<(f64, f64)> = spans
        .iter()
        .filter(|&&(x0, lc, _, _)| bends.iter().any(|b| !(x0 + lc <= b.s0 || x0 >= b.s0 + b.clr * b.angle)))
        .map(|&(x0, lc, _, _)| (x0, x0 + lc))
        .collect();
    let dout = 2.0 * tube_radius(g, g.l);
    let s_end = g.l;
    let s_out = g.l + g.ext_d * dout;
    path.straight(s_out - s_cur);
    let prof_x: Vec<f64> = inner.iter().map(|p| p.0).collect();
    let rad = |s: f64| -> f64 {
        if s <= lin {
            for i in 0..prof_x.len() - 1 {
                if prof_x[i] <= s && s <= prof_x[i + 1] {
                    let (x0, x1) = (prof_x[i], prof_x[i + 1]);
                    let w = if x1 == x0 { 0.0 } else { (s - x0) / (x1 - x0) };
                    return inner[i].1 * (1.0 - w) + inner[i + 1].1 * w;
                }
            }
            return inner.last().unwrap().1;
        }
        tube_radius(g, pmin(s, s_end))
    };
    let mut ss: Vec<f64> = inner.iter().map(|p| p.0).filter(|x| *x > 1e-12).collect();
    ss.push(0.0);
    let ds = g.d / 10.0;
    let mut s = lin;
    while s < s_out {
        ss.push(s);
        s += ds;
    }
    for b in &bends {
        let n = 8.max((b.angle / radians(5.0)).ceil() as i64);
        for i in 0..=n {
            ss.push(b.s0 + b.clr * b.angle * i as f64 / n as f64);
        }
    }
    for &(c0, c1) in &cone_on_bend {
        ss.push(c0);
        ss.push(c1);
    }
    ss.push(s_end);
    ss.push(s_out);
    let mut svals: Vec<f64> = ss.into_iter().filter(|x| *x <= s_out + 1e-12).collect();
    svals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    svals.dedup_by(|a, b| a == b);
    let mut rings: Vec<(f64, Vec<V3>, V3, V3)> = Vec::new();
    for &s in &svals {
        let (p, t, n1, n2) = path.frame(s);
        let r = rad(s);
        let ring: Vec<V3> = (0..nphi)
            .map(|j| {
                let a = 2.0 * PI * j as f64 / nphi as f64;
                v_add(p, v_add(v_mul(n1, r * a.cos()), v_mul(n2, r * a.sin())))
            })
            .collect();
        rings.push((s, ring, p, t));
    }
    let (mut wall, mut ext) = (Vec::new(), Vec::new());
    for k in 0..rings.len() - 1 {
        let s0 = rings[k].0;
        let (a, b) = (&rings[k].1, &rings[k + 1].1);
        let tgt = if s0 >= s_end - 1e-12 { &mut ext } else { &mut wall };
        for j in 0..nphi {
            let j1 = (j + 1) % nphi;
            tgt.push([a[j], a[j1], b[j1]]);
            tgt.push([a[j], b[j1], b[j]]);
        }
    }
    let (_, ring_o, po, to) = rings.last().unwrap();
    let outlet: Vec<Tri> = (0..nphi)
        .map(|j| {
            let (a, b, c) = (*po, ring_o[(j + 1) % nphi], ring_o[j]);
            if v_dot(tri_area_vec(&[a, b, c]), *to) < 0.0 {
                [a, c, b]
            } else {
                [a, b, c]
            }
        })
        .collect();
    let mouth_ring = rings[0].1.clone();
    let mouth: Vec<Tri> = (0..nphi).map(|j| [[0.0, 0.0, 0.0], mouth_ring[j], mouth_ring[(j + 1) % nphi]]).collect();
    let free = if g.mount == "free" { Some(free_mount_surface(g, &path, nphi, &bends, &rad, &rings, lin)?) } else { None };
    Ok(Surf { wall, ext, outlet, mouth, mouth_loop: mouth_ring, path, s_end, free })
}

/// The outside of a free-standing tube, as the 2-D free mount draws it (intake_cfd.free_mount_surface): the lip's
/// outer face and the outer wall back to the plenum wall at x = p, the protrusion.
fn free_mount_surface(g: &Geo, path: &Path3D, nphi: usize, bends: &[Bend], rad: &dyn Fn(f64) -> f64, rings: &[(f64, Vec<V3>, V3, V3)], lin: f64) -> R<Free3d> {
    let d = g.d;
    let r = d / 2.0;
    let o = *g.profile_cap.last().unwrap();
    let (mut limit, mut what) = (g.l, "the tract end");
    for b in bends {
        if b.s0 < limit {
            limit = b.s0;
            what = "the first bend";
        }
    }
    for c in cone_spans(g) {
        if c.0 < limit {
            limit = c.0;
            what = "the first diameter change";
        }
    }
    let p_min = o.0 + pmax(0.1 * d, 0.3 * r);
    let mut p = match g.protrusion {
        Some(v) => v,
        None => pmin(pmax(lin, d), limit),
    };
    p = pmax(p, p_min);
    if p > limit + 1e-9 {
        bail!(
            "free mount: the tube stands {} mm proud of the plenum wall, but {} is at {} mm; the outside of the tube is modelled straight up to that wall, so the protrusion must end before it (at least {} mm is needed for this lip), or use mount type flange",
            pct("%.1f", &[A::F(p * 1e3)]),
            what,
            pct("%.1f", &[A::F(limit * 1e3)]),
            pct("%.1f", &[A::F(p_min * 1e3)])
        );
    }
    for (s, ring, _, _) in rings {
        if *s > p + 1e-9 && seq_min(ring.iter().map(|q| q[0])) <= p + 1e-9 {
            bail!(
                "free mount: the tube comes back through the plenum-wall plane x = {} mm (at {} mm along it); use mount type flange",
                pct("%.1f", &[A::F(p * 1e3)]),
                pct("%.1f", &[A::F(s * 1e3)])
            );
        }
    }
    let n = 2.max(((p - o.0) / (d / 10.0)).ceil() as i64);
    let mut prof_o = g.profile_cap.clone();
    for i in 1..=n {
        prof_o.push((o.0 + (p - o.0) * i as f64 / n as f64, g.profile_r_out));
    }
    let gap = seq_min(prof_o.iter().filter(|q| q.0 >= o.0 - 1e-12).map(|q| q.1 - rad(q.0)));
    let rr: Vec<Vec<V3>> = prof_o
        .iter()
        .map(|&(x, rq)| {
            let (pp, _t, n1, n2) = path.frame(x);
            (0..nphi)
                .map(|j| {
                    let a = 2.0 * PI * j as f64 / nphi as f64;
                    v_add(pp, v_add(v_mul(n1, rq * a.cos()), v_mul(n2, rq * a.sin())))
                })
                .collect()
        })
        .collect();
    let mut tris = Vec::new();
    for k in 0..rr.len() - 1 {
        let (a, b) = (&rr[k], &rr[k + 1]);
        for j in 0..nphi {
            let j1 = (j + 1) % nphi;
            tris.push([a[j], a[j1], b[j1]]);
            tris.push([a[j], b[j1], b[j]]);
        }
    }
    // a rounded lip's radius (intake_cfd.free_mount_surface): radius, ellipse with a corner radius, taper
    let rlip = match g.inlet.as_ref().unwrap() {
        Inlet::Radius { rc } => Some(*rc),
        Inlet::Taper { rl, .. } => Some(*rl),
        Inlet::Ellipse { rc, .. } if *rc > 0.0 => Some(*rc),
        _ => None,
    };
    Ok(Free3d { tris, lp: rr.last().unwrap().clone(), p, gap, r_out: g.profile_r_out, rlip })
}

fn prepare_param3d_geometry(g: &mut Geo) -> R<Path3D> {
    let inner = g.profile_inner.clone();
    let surf = build_param_3d_surface(g, &inner, 64)?;
    let path = surf.path;
    let (pe, te, _, _) = path.frame(surf.s_end);
    let rend = tube_radius(g, g.l);
    g.tract_end = (pe, te, PI * rend.powf(2.0));
    g.dref = g.d;
    g.d_mouth = 2.0 * g.profile_front_r;
    let free_tris: Vec<Tri> = surf.free.as_ref().map(|f| f.tris.clone()).unwrap_or_default();
    g.bbox = bbox(&[&surf.wall, &surf.ext, &surf.outlet, &free_tris]);
    g.planes_local = g.planes.iter().map(|(nm, s)| {
        let (p, t, _, _) = path.frame(*s);
        (nm.clone(), (p, t))
    }).collect();
    g.tris.insert("wall", surf.wall);
    g.tris.insert("ext", surf.ext);
    g.tris.insert("outlet", surf.outlet);
    g.tris.insert("mouth", surf.mouth);
    g.mouth_loop = surf.mouth_loop;
    if surf.free.is_some() {
        g.tris.insert("inlet_wall", free_tris);
    }
    g.free3d = surf.free;
    Ok(path)
}

// ------------------------------------------------------------------------------------------- STL

fn py_isspace(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\r' | '\u{b}' | '\u{c}' | '\u{1c}' | '\u{1d}' | '\u{1e}' | '\u{1f}' | '\u{85}' | '\u{a0}')
}
fn py_strip(s: &str) -> &str {
    s.trim_matches(py_isspace)
}
fn py_split(s: &str) -> Vec<&str> {
    s.split(py_isspace).filter(|x| !x.is_empty()).collect()
}
/// str.splitlines() for text decoded from latin-1.
fn py_splitlines(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let b: Vec<(usize, char)> = s.char_indices().collect();
    let mut start = 0usize;
    let mut i = 0usize;
    while i < b.len() {
        let (pos, c) = b[i];
        if matches!(c, '\n' | '\r' | '\u{b}' | '\u{c}' | '\u{1c}' | '\u{1d}' | '\u{1e}' | '\u{85}') {
            out.push(&s[start..pos]);
            let mut next = pos + c.len_utf8();
            if c == '\r' && i + 1 < b.len() && b[i + 1].1 == '\n' {
                next += 1;
                i += 1;
            }
            start = next;
        }
        i += 1;
    }
    if start < s.len() {
        out.push(&s[start..]);
    }
    out
}

fn read_stl(path: &Path, scale: f64) -> R<Vec<(String, Vec<Tri>)>> {
    let data = std::fs::read(path).map_err(|e| format!("{}: {}", path.display(), e))?;
    let mut regions = Vec::new();
    let head: Vec<u8> = data[..data.len().min(256)].iter().copied().skip_while(|b| b" \t\n\r\x0b\x0c".contains(b)).map(|b| b.to_ascii_lowercase()).collect();
    let low2048: Vec<u8> = data[..data.len().min(2048)].iter().map(|b| b.to_ascii_lowercase()).collect();
    let is_ascii = head.starts_with(b"solid") && low2048.windows(5).any(|w| w == b"facet");
    if is_ascii {
        let text: String = data.iter().map(|&b| b as char).collect();
        let (mut name, mut tris, mut verts): (String, Vec<Tri>, Vec<V3>) = ("wall".into(), Vec::new(), Vec::new());
        for rawl in py_splitlines(&text) {
            let ln = py_strip(rawl);
            let low = ln.to_lowercase();
            if low.starts_with("solid") {
                let rest = py_strip(&ln[5..]);
                name = if rest.is_empty() { "wall".into() } else { py_split(rest)[0].to_string() };
                tris = Vec::new();
                verts = Vec::new();
            } else if low.starts_with("vertex") {
                let p = py_split(ln);
                let c: Vec<f64> = p.iter().skip(1).take(3).map(|x| fl(&Py::Str(x.to_string())).map(|v| v * scale)).collect::<R<_>>()?;
                if c.len() < 3 {
                    return Err(derr("an STL vertex with fewer than three coordinates".into()));
                }
                verts.push([c[0], c[1], c[2]]);
                if verts.len() == 3 {
                    tris.push([verts[0], verts[1], verts[2]]);
                    verts.clear();
                }
            } else if low.starts_with("endsolid") {
                regions.push((name.clone(), std::mem::take(&mut tris)));
            }
        }
        if !tris.is_empty() {
            regions.push((name, tris));
        }
    } else {
        if data.len() < 84 {
            return Err(derr("the STL is too short to be a binary STL".into()));
        }
        let n = u32::from_le_bytes(data[80..84].try_into().unwrap()) as usize;
        let mut tris = Vec::with_capacity(n);
        let mut off = 84usize;
        for _ in 0..n {
            if off + 48 > data.len() {
                return Err(derr("unpack requires a buffer of 48 bytes".into()));
            }
            let v = |k: usize| f32::from_le_bytes(data[off + 4 * k..off + 4 * k + 4].try_into().unwrap()) as f64;
            tris.push([[v(3) * scale, v(4) * scale, v(5) * scale], [v(6) * scale, v(7) * scale, v(8) * scale], [v(9) * scale, v(10) * scale, v(11) * scale]]);
            off += 50;
        }
        regions.push(("wall".into(), tris));
    }
    Ok(regions)
}

fn stl_ascii(regions: &[(&str, &[Tri])]) -> String {
    let mut out = String::new();
    for (name, tris) in regions {
        out.push_str(&pct(T::STL_SOLID, &[A::S(name.to_string())]));
        for t in tris.iter() {
            let n = v_norm(v_cross(v_sub(t[1], t[0]), v_sub(t[2], t[0])));
            out.push_str(&pct(T::STL_FACET, &[A::F(n[0]), A::F(n[1]), A::F(n[2])]));
            for p in t {
                out.push_str(&pct(T::STL_VERTEX, &[A::F(p[0]), A::F(p[1]), A::F(p[2])]));
            }
            out.push_str(T::STL_ENDFACET);
        }
        out.push_str(&pct(T::STL_ENDSOLID, &[A::S(name.to_string())]));
    }
    out
}

fn region_stats(tris: &[Tri]) -> (f64, V3, V3) {
    let mut a_sum = 0.0;
    let mut c = [0.0; 3];
    let mut nvec = [0.0; 3];
    for t in tris {
        let av = tri_area_vec(t);
        let a = v_len(av);
        a_sum += a;
        c = v_add(c, v_mul(v_mul(v_add(v_add(t[0], t[1]), t[2]), 1.0 / 3.0), a));
        nvec = v_add(nvec, av);
    }
    (a_sum, if a_sum > 0.0 { v_mul(c, 1.0 / a_sum) } else { c }, v_norm(nvec))
}

/// An insertion-ordered map, as Python's dict keeps its keys.
struct OMap<K, V> {
    idx: HashMap<K, usize>,
    v: Vec<(K, V)>,
}
impl<K: std::hash::Hash + Eq + Clone, V> OMap<K, V> {
    fn new() -> Self {
        OMap { idx: HashMap::new(), v: Vec::new() }
    }
    fn entry(&mut self, k: K, def: impl FnOnce() -> V) -> &mut V {
        let i = match self.idx.get(&k) {
            Some(&i) => i,
            None => {
                self.v.push((k.clone(), def()));
                self.idx.insert(k, self.v.len() - 1);
                self.v.len() - 1
            }
        };
        &mut self.v[i].1
    }
    fn get(&self, k: &K) -> Option<&V> {
        self.idx.get(k).map(|&i| &self.v[i].1)
    }
}

/// Ordered boundary loop of a triangulated planar cap.
fn boundary_loop(tris: &[Tri], tol: f64) -> R<Vec<V3>> {
    type K = (i64, i64, i64);
    let key = |p: V3| -> K { (pround(p[0] / tol), pround(p[1] / tol), pround(p[2] / tol)) };
    let mut pts: OMap<K, V3> = OMap::new();
    let mut cnt: OMap<(K, K), i64> = OMap::new();
    for t in tris {
        let ks: Vec<K> = t.iter().map(|&p| key(p)).collect();
        for (p, k) in t.iter().zip(&ks) {
            *pts.entry(*k, || *p) = *p;
        }
        for i in 0..3 {
            let (a, b) = (ks[i], ks[(i + 1) % 3]);
            let ek = if a <= b { (a, b) } else { (b, a) };
            *cnt.entry(ek, || 0) += 1;
        }
    }
    let bedges: Vec<(K, K)> = cnt.v.iter().filter(|e| e.1 == 1).map(|e| e.0).collect();
    if bedges.is_empty() {
        bail!("inlet face has no boundary edges (is it a closed surface?)");
    }
    let mut adj: OMap<K, Vec<K>> = OMap::new();
    for (a, b) in &bedges {
        adj.entry(*a, Vec::new).push(*b);
        adj.entry(*b, Vec::new).push(*a);
    }
    let start = bedges[0].0;
    let mut lp = vec![start];
    let (mut prev, mut cur): (Option<K>, K) = (None, start);
    loop {
        let nxt: Vec<K> = adj.get(&cur).unwrap().iter().filter(|n| Some(**n) != prev).copied().collect();
        if nxt.is_empty() {
            break;
        }
        prev = Some(cur);
        cur = nxt[0];
        if cur == start {
            break;
        }
        lp.push(cur);
        if lp.len() > adj.v.len() + 1 {
            break;
        }
    }
    if lp.len() < adj.v.len() {
        bail!("inlet face boundary is not a single closed loop ({} of {} edge points)", lp.len(), adj.v.len());
    }
    Ok(lp.iter().map(|k| *pts.get(k).unwrap()).collect())
}

fn floor_surface(lp: &[V3], rfloor: f64) -> R<Vec<Tri>> {
    floor_surface_at(lp, rfloor, 0.0)
}
/// floor_surface in the plane x = x0 (a free-standing tube's plenum wall).
fn floor_surface_at(lp: &[V3], rfloor: f64, x0: f64) -> R<Vec<Tri>> {
    let n = lp.len() as f64;
    let cy = psum(lp.iter().map(|p| p[1])) / n;
    let cz = psum(lp.iter().map(|p| p[2])) / n;
    let ang: Vec<f64> = lp.iter().map(|p| (p[2] - cz).atan2(p[1] - cy)).collect();
    let mut order: Vec<usize> = (0..lp.len()).collect();
    order.sort_by(|&a, &b| ang[a].partial_cmp(&ang[b]).unwrap_or(std::cmp::Ordering::Equal));
    let mut pos = vec![0usize; lp.len()];
    for (k, &i) in order.iter().enumerate() {
        pos[i] = k;
    }
    let m = lp.len();
    let steps: Vec<usize> = (0..m).map(|i| (pos[(i + 1) % m] + m - pos[i]) % m).collect();
    if !(steps.iter().all(|&s| s == 1) || steps.iter().all(|&s| s == m - 1)) {
        bail!("inlet mouth outline is not star-shaped about its centre; the plenum floor cannot be generated automatically");
    }
    let inner: Vec<V3> = order.iter().map(|&i| lp[i]).collect();
    let outer: Vec<V3> = order.iter().map(|&i| [x0, cy + rfloor * ang[i].cos(), cz + rfloor * ang[i].sin()]).collect();
    let mut tris = Vec::new();
    for j in 0..m {
        let j1 = (j + 1) % m;
        let (a, b, c, e) = (inner[j], inner[j1], outer[j1], outer[j]);
        for t in [[a, b, c], [a, c, e]] {
            let t = if tri_area_vec(&t)[0] < 0.0 { [t[0], t[2], t[1]] } else { t };
            tris.push(t);
        }
    }
    Ok(tris)
}

fn sum_pts(pts: &[V3]) -> V3 {
    let (mut x, mut y, mut z) = (0.0, 0.0, 0.0);
    for p in pts {
        x += p[0];
        y += p[1];
        z += p[2];
    }
    [x, y, z]
}

enum Rot {
    Id,
    Flip,
    About(V3, f64),
}
impl Rot {
    fn apply(&self, p: V3) -> V3 {
        match self {
            Rot::Id => p,
            Rot::Flip => [-p[0], -p[1], p[2]],
            Rot::About(axis, ang) => rotate_about(p, *axis, *ang),
        }
    }
}

fn load_regions(g: &Geo) -> R<Vec<(String, Vec<Tri>)>> {
    let open = |f: &str| -> PathBuf {
        let p = Path::new(f);
        if p.is_absolute() {
            p.to_path_buf()
        } else {
            g.base_dir.join(f)
        }
    };
    let mut regions = Vec::new();
    match &g.stl {
        Py::Dict(m) => {
            for (role, f) in &m.0 {
                for (_, tris) in read_stl(&open(&f.str()), g.scale)? {
                    regions.push((role.to_lowercase(), tris));
                }
            }
        }
        other => {
            for (nm, tris) in read_stl(&open(&other.str()), g.scale)? {
                regions.push((nm.to_lowercase(), tris));
            }
        }
    }
    Ok(regions)
}

fn prepare_stl_geometry(g: &mut Geo) -> R<()> {
    let regions = load_regions(g)?;
    let mut names: Vec<String> = regions.iter().map(|r| r.0.clone()).collect();
    names.sort();
    names.dedup();
    if !names.iter().any(|n| n == "inlet") || !names.iter().any(|n| n == "outlet") {
        bail!("STL must contain solids/files named 'inlet' and 'outlet' (found {})", py_list_repr(&names));
    }
    // orient: the inlet face centre at the origin, inflow along +x
    let inl: Vec<Tri> = regions.iter().filter(|r| r.0 == "inlet").flat_map(|r| r.1.iter().copied()).collect();
    let (_area, c, mut n) = region_stats(&inl);
    let allpts: Vec<V3> = regions.iter().flat_map(|r| pts_of(&r.1).collect::<Vec<_>>()).collect();
    let cen = v_mul(sum_pts(&allpts), 1.0 / allpts.len() as f64);
    if v_dot(v_sub(cen, c), n) > 0.0 {
        n = v_mul(n, -1.0);
    }
    let flow = v_mul(n, -1.0);
    let ex = [1.0, 0.0, 0.0];
    let mut axis = v_cross(flow, ex);
    let s = v_len(axis);
    let cth = v_dot(flow, ex);
    let rot = if s < 1e-12 {
        if cth > 0.0 {
            Rot::Id
        } else {
            Rot::Flip
        }
    } else {
        axis = v_mul(axis, 1.0 / s);
        Rot::About(axis, s.atan2(cth))
    };
    let regions: Vec<(String, Vec<Tri>)> =
        regions.into_iter().map(|(nm, tris)| (nm, tris.iter().map(|t| [rot.apply(v_sub(t[0], c)), rot.apply(v_sub(t[1], c)), rot.apply(v_sub(t[2], c))]).collect())).collect();
    let pick = |f: &dyn Fn(&str) -> bool| -> Vec<Tri> { regions.iter().filter(|r| f(&r.0)).flat_map(|r| r.1.iter().copied()).collect() };
    let inlet = pick(&|n| n == "inlet");
    let outlet = pick(&|n| n == "outlet");
    let wall = pick(&|n| n != "inlet" && n != "outlet");
    let (ai, _ci, _ni) = region_stats(&inlet);
    let (ao, co, mut no) = region_stats(&outlet);
    let size = pmax(ai.sqrt(), ao.sqrt());
    let dev = seq_max(pts_of(&inlet).map(|p| p[0].abs()));
    if dev > 0.01 * size {
        bail!("inlet face is not planar (deviation {} m)", gen(dev, 3));
    }
    let xmin = seq_min(pts_of(&wall).chain(pts_of(&outlet)).map(|p| p[0]));
    if xmin < -0.02 * size {
        bail!("the tract passes upstream of its own inlet plane; the plenum would intersect it");
    }
    let wpts: Vec<V3> = pts_of(&wall).collect();
    let cen = v_mul(sum_pts(&wpts), 1.0 / wpts.len() as f64);
    if v_dot(v_sub(co, cen), no) < 0.0 {
        no = v_mul(no, -1.0);
    }
    let do_ = (4.0 * ao / PI).sqrt();
    let di = (4.0 * ai / PI).sqrt();
    let loop_o = boundary_loop(&outlet, 1e-6 * size)?;
    let lext = g.ext_d * do_;
    let shift = v_mul(no, lext);
    let mut ext = Vec::new();
    let nl = loop_o.len();
    for j in 0..nl {
        let (a, b) = (loop_o[j], loop_o[(j + 1) % nl]);
        let (a2, b2) = (v_add(a, shift), v_add(b, shift));
        ext.push([a, b, b2]);
        ext.push([a, b2, a2]);
    }
    let new_out: Vec<Tri> = outlet.iter().map(|t| [v_add(t[0], shift), v_add(t[1], shift), v_add(t[2], shift)]).collect();
    let fixed: Vec<Tri> = ext
        .iter()
        .map(|t| {
            let cc = v_mul(v_add(v_add(t[0], t[1]), t[2]), 1.0 / 3.0);
            let radial = v_sub(cc, v_add(co, v_mul(no, v_dot(v_sub(cc, co), no))));
            if v_dot(tri_area_vec(t), radial) < 0.0 {
                [t[0], t[2], t[1]]
            } else {
                *t
            }
        })
        .collect();
    g.mouth_loop = boundary_loop(&inlet, 1e-6 * size)?;
    g.dref = do_;
    g.amin = pmin(ai, ao);
    g.d_mouth = di;
    g.tract_end = (co, no, ao);
    g.bbox = bbox(&[&wall, &fixed, &new_out]);
    g.planes_local = g.planes3d.iter().map(|(nm, (pt, nn))| (nm.clone(), (rot.apply(v_sub(*pt, c)), v_norm(rot.apply(*nn))))).collect();
    g.tris.insert("wall", wall);
    g.tris.insert("ext", fixed);
    g.tris.insert("outlet", new_out);
    g.tris.insert("mouth", inlet);
    Ok(())
}

fn extrude_face(tris: &[Tri], co: V3, no: V3, l: f64) -> R<(Vec<Tri>, Vec<Tri>)> {
    let size = psum(tris.iter().map(|t| v_len(tri_area_vec(t)))).sqrt();
    let lp = boundary_loop(tris, 1e-6 * size)?;
    let shift = v_mul(no, l);
    let mut ext = Vec::new();
    let n = lp.len();
    for j in 0..n {
        let (a, b) = (lp[j], lp[(j + 1) % n]);
        let (a2, b2) = (v_add(a, shift), v_add(b, shift));
        for t in [[a, b, b2], [a, b2, a2]] {
            let cc = v_mul(v_add(v_add(t[0], t[1]), t[2]), 1.0 / 3.0);
            let radial = v_sub(cc, v_add(co, v_mul(no, v_dot(v_sub(cc, co), no))));
            ext.push(if v_dot(tri_area_vec(&t), radial) < 0.0 { [t[0], t[2], t[1]] } else { t });
        }
    }
    let cap = tris.iter().map(|t| [v_add(t[0], shift), v_add(t[1], shift), v_add(t[2], shift)]).collect();
    Ok((ext, cap))
}

fn prepare_exhaust_geometry(g: &mut Geo) -> R<()> {
    let regions = load_regions(g)?;
    let names: Vec<String> = regions.iter().map(|r| r.0.clone()).collect();
    let mut inlet_names: Vec<String> = names
        .iter()
        .filter(|n| *n == "inlet" || (n.starts_with("inlet") && n.len() > 5 && n[5..].chars().all(|c| c.is_ascii_digit())))
        .cloned()
        .collect();
    inlet_names.sort();
    inlet_names.dedup();
    inlet_names.sort_by(|a, b| (a.chars().count(), a).cmp(&(b.chars().count(), b)));
    if inlet_names.is_empty() || !names.iter().any(|n| n == "outlet") {
        let mut s = names.clone();
        s.sort();
        s.dedup();
        bail!("exhaust STL must contain solids/files named inlet (or inlet1, inlet2, ...) and outlet (found {})", py_list_repr(&s));
    }
    let wall: Vec<Tri> = regions.iter().filter(|r| !inlet_names.contains(&r.0) && r.0 != "outlet").flat_map(|r| r.1.iter().copied()).collect();
    let outlet: Vec<Tri> = regions.iter().filter(|r| r.0 == "outlet").flat_map(|r| r.1.iter().copied()).collect();
    if wall.is_empty() {
        bail!("exhaust STL has no wall faces");
    }
    let wpts: Vec<V3> = pts_of(&wall).collect();
    let cen = v_mul(sum_pts(&wpts), 1.0 / wpts.len() as f64);
    let (ao, co, mut no) = region_stats(&outlet);
    if v_dot(v_sub(co, cen), no) < 0.0 {
        no = v_mul(no, -1.0);
    }
    let do_ = (4.0 * ao / PI).sqrt();
    let mut inlets = Vec::new();
    for nm in &inlet_names {
        let tris: Vec<Tri> = regions.iter().filter(|r| &r.0 == nm).flat_map(|r| r.1.iter().copied()).collect();
        let (ai, ci, mut ni) = region_stats(&tris);
        if v_dot(v_sub(ci, cen), ni) < 0.0 {
            ni = v_mul(ni, -1.0);
        }
        let di = (4.0 * ai / PI).sqrt();
        let dev = seq_max(pts_of(&tris).map(|p| v_dot(v_sub(p, ci), ni).abs()));
        if dev > 0.02 * di {
            bail!("inlet face '{}' is not planar (deviation {} m)", nm, gen(dev, 3));
        }
        let (ext, cap) = extrude_face(&tris, ci, ni, g.ext_in_d * di)?;
        inlets.push(InletExh { name: nm.clone(), a: ai, d: di, centre: ci, normal: ni, ext, cap });
    }
    let (ext_o, cap_o) = extrude_face(&outlet, co, no, g.ext_d * do_)?;
    let inlet_ext: Vec<Tri> = inlets.iter().flat_map(|i| i.ext.iter().copied()).collect();
    g.dref = do_;
    g.a_in_total = psum(inlets.iter().map(|i| i.a));
    g.amin = pmin(g.a_in_total, ao);
    g.d_mouth = seq_max(inlets.iter().map(|i| i.d));
    g.exit_face = (co, no, ao);
    g.loc_in_mesh = v_add(co, v_mul(no, 0.5 * g.ext_d * do_));
    g.bbox = bbox(&[&wall, &ext_o, &cap_o, &inlet_ext]);
    let mut pl: Vec<(String, (V3, V3, Option<f64>, f64))> = Vec::new();
    for i in &inlets {
        set_ordered(&mut pl, i.name.clone(), (i.centre, v_mul(i.normal, -1.0), Some(i.a), 0.5 * i.d));
    }
    set_ordered(&mut pl, "exit".into(), (co, no, Some(ao), 0.5 * do_));
    for (nm, (pt, nn)) in &g.planes3d {
        set_ordered(&mut pl, nm.clone(), (*pt, *nn, None, 0.75 * do_));
    }
    g.planes_exhaust = pl;
    g.split = match g.inlet_split.as_ref().filter(|s| !s.is_empty()) {
        Some(sp) => {
            let missing: Vec<String> = inlets.iter().filter(|i| !sp.iter().any(|e| e.0 == i.name)).map(|i| i.name.clone()).collect();
            if !missing.is_empty() {
                bail!("operating_point.inlet_split must name every inlet; missing {}", py_list_repr(&missing));
            }
            let val = |n: &str| sp.iter().find(|e| e.0 == n).unwrap().1;
            let tot = psum(inlets.iter().map(|i| val(&i.name)));
            inlets.iter().map(|i| (i.name.clone(), val(&i.name) / tot)).collect()
        }
        None => {
            let n = inlets.len() as f64;
            inlets.iter().map(|i| (i.name.clone(), 1.0 / n)).collect()
        }
    };
    g.inlet_caps = inlets.iter().map(|i| (i.name.clone(), i.cap.clone())).collect();
    g.tris.insert("wall", wall);
    g.tris.insert("ext", ext_o);
    g.tris.insert("outlet", cap_o);
    g.tris.insert("inlet_ext", inlet_ext);
    g.tris.insert("exit", outlet);
    g.inlets = inlets;
    Ok(())
}

// ------------------------------------------------------------------------------------------- the case files

struct CaseWriter {
    root: PathBuf,
    name: String,
    stamp: String,
    files: Vec<String>,
}
impl CaseWriter {
    fn provenance(&self, lines: &[String], comment: &str) -> String {
        let mut out = vec![
            pct(T::PV_GEN, &[A::from(comment), A::from(T::GENERATOR), A::from(T::VERSION), A::from(&self.stamp), A::from(&self.name)]),
            pct(T::PV_INPUTS, &[A::from(comment)]),
        ];
        for ln in lines {
            out.push(pct(T::PV_LINE, &[A::from(comment), A::from(ln)]));
        }
        out.push(pct(T::PV_DONOT, &[A::from(comment)]));
        out.join("\n") + "\n"
    }
    fn write(&self, rel: &str, s: &str) -> R<()> {
        let path = self.root.join(rel);
        if let Some(d) = path.parent() {
            std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, s).map_err(|e| format!("{}: {}", path.display(), e))
    }
    fn foam(&mut self, rel: &str, cls: &str, obj: &str, body: &str, prov: &[String], location: Option<&str>) -> R<()> {
        let mut hdr = String::from(T::FOAM_BANNER) + &self.provenance(prov, "//") + &pct(T::FOAM_HDR, &[A::from(cls)]);
        if let Some(l) = location {
            hdr += &pct(T::FOAM_LOC, &[A::from(l)]);
        }
        hdr += &pct(T::FOAM_OBJ, &[A::from(obj)]);
        hdr += T::FOAM_SEP;
        self.write(rel, &(hdr + body.trim_end_matches(py_isspace) + T::FOAM_END))?;
        self.files.push(rel.into());
        Ok(())
    }
    fn text(&mut self, rel: &str, body: &str, prov: Option<&[String]>, comment: &str, executable: bool, shebang: Option<&str>) -> R<()> {
        let mut s = String::new();
        if let Some(sb) = shebang {
            s += sb;
            s += "\n";
        }
        if let Some(p) = prov {
            s += &self.provenance(p, comment);
            s += "\n";
        }
        s += body;
        self.write(rel, &s)?;
        #[cfg(unix)]
        if executable {
            use std::os::unix::fs::PermissionsExt;
            let path = self.root.join(rel);
            if let Ok(m) = std::fs::metadata(&path) {
                let mut p = m.permissions();
                p.set_mode(p.mode() | 0o111);
                let _ = std::fs::set_permissions(&path, p);
            }
        }
        #[cfg(not(unix))]
        let _ = executable;
        self.files.push(rel.into());
        Ok(())
    }
    fn raw(&mut self, rel: &str, data: &str) -> R<()> {
        self.write(rel, data)?;
        self.files.push(rel.into());
        Ok(())
    }
}

fn bc_block(entries: &[(String, String)]) -> String {
    entries
        .iter()
        .map(|(patch, body)| {
            let lines: Vec<String> = body.trim_matches(py_isspace).split('\n').map(|ln| format!("        {}", ln)).collect();
            format!("    {}\n    {{\n{}\n    }}", patch, lines.join("\n"))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

enum Rule {
    S(String),
    In,
}

fn field_files(cw: &mut CaseWriter, d: &Design, der: &mut Der, patches: &[(String, String)]) -> R<()> {
    let comp = der.compressible;
    let (p0, t0) = (der.p_amb, der.t_amb);
    let (mut k_in, mut om_in) = (der.k_in, der.omega_in);
    let mdot = der.mdot;
    let rho = der.rho_amb;
    let mut prov_common = vec![
        pct(T::FF_PROV_AMB, &[A::F(p0), A::F(t0)]),
        pct(T::FF_PROV_OP, &[A::from(&der.op_source)]),
        pct(T::FF_PROV_TURB, &[A::F(100.0 * der.i_in), A::F(der.u_bulk), A::F(k_in), A::F(der.nut_ratio_in), A::F(om_in)]),
    ];
    let ramp = RAMP_ITER;
    let s = |x: &str| x.to_string();
    let make = |cw: &mut CaseWriter, prov_common: &[String], name: &str, cls: &str, dims: &str, internal: String, rules: &[(&str, Rule)], extra: Vec<String>, in_u: &dyn Fn(&str) -> String| -> R<()> {
        let mut ents = Vec::new();
        for (pn, role) in patches {
            if role == "cyclic" {
                ents.push((pn.clone(), T::FF_CYCLIC.to_string()));
            } else {
                let rule = &rules.iter().find(|r| r.0 == role).ok_or_else(|| format!("KeyError: '{}'", role))?.1;
                ents.push((pn.clone(), match rule {
                    Rule::S(t) => t.clone(),
                    Rule::In => in_u(pn),
                }));
            }
        }
        let body = pct(T::FF_BODY, &[A::from(dims), A::from(internal), A::S(bc_block(&ents))]);
        let mut prov = prov_common.to_vec();
        prov.extend(extra);
        cw.foam(&format!("0/{}", name), cls, name, &body, &prov, Some("0"))
    };
    let no_in = |_: &str| String::new();
    let (mut out_u, out_p, mut prov_out);
    if der.mode == "mass_flow" {
        let fs = der.flow_scale;
        let m = mdot.unwrap();
        out_u = if comp { pct(T::FF_OUT_U_COMP, &[A::I(ramp), A::F(m / fs)]) } else { pct(T::FF_OUT_U_INC, &[A::I(ramp), A::F(m / rho / fs)]) };
        out_p = s(T::FF_ZEROGRAD);
        prov_out = vec![pct(T::FF_PROV_OUT_MASS, &[A::F(m), A::S(if fs != 1.0 { pct(T::FF_PROV_SECTOR, &[A::F(fs)]) } else { String::new() }), A::I(ramp)])];
    } else {
        out_u = s(T::FF_OUT_U_PR);
        let p_out = der.p_out.unwrap();
        let pout = if comp { p_out } else { (p_out - p0) / rho };
        let pstart = if comp { p0 } else { 0.0 };
        out_p = pct(T::FF_OUT_P_PR, &[A::F(pstart), A::I(ramp), A::F(pout), A::F(pstart)]);
        prov_out = vec![pct(T::FF_PROV_OUT_PR, &[A::F(p_out), A::S(if comp { s("absolute") } else { pct(T::FF_KIN_GAUGE, &[A::F(pout)]) }), A::I(ramp)])];
    }
    if d.mode_kind == "exhaust" {
        let split = d.g.split.clone();
        let tg = d.t_gas;
        let k_x = 1.5 * (0.05 * der.u_bulk).powf(2.0);
        let om_x = k_x / (10.0 * der.nu_amb);
        der.k_in = k_x;
        der.omega_in = om_x;
        k_in = k_x;
        om_in = om_x;
        let m = mdot.unwrap();
        let in_u = |pn: &str| pct(T::FF_IN_U_EXH, &[A::I(ramp), A::F(m * split.iter().find(|e| e.0 == pn).map(|e| e.1).unwrap_or(f64::NAN))]);
        out_u = s(T::FF_OUT_U_EXH);
        let out_p = pct(T::FF_FIXED_9G, &[A::F(p0)]);
        let items: Vec<String> = split.iter().map(|(k, v)| pct(T::FF_SPLIT_ITEM, &[A::from(k), A::F(*v)])).collect();
        prov_out = vec![pct(T::FF_PROV_IN_EXH, &[A::F(m), A::S(items.join(", ")), A::I(ramp), A::F(tg)]), pct(T::FF_PROV_OUT_EXH, &[A::F(p0)])];
        prov_common[2] = pct(T::FF_PROV_TURB_EXH, &[A::F(k_x), A::F(om_x)]);
        let pc = prov_common.clone();
        make(cw, &pc, "U", "volVectorField", "[0 1 -1 0 0 0 0]", s(T::FF_UNIFORM_V0), &[("exh_inlet", Rule::In), ("exh_outlet", Rule::S(out_u)), ("wall", Rule::S(s(T::FF_NOSLIP)))], prov_out.clone(), &in_u)?;
        let mut pp = prov_out.clone();
        pp.push(s(T::FF_P_ABS));
        make(cw, &pc, "p", "volScalarField", "[1 -1 -2 0 0 0 0]", pct(T::FF_UNIFORM_9G, &[A::F(p0)]), &[("exh_inlet", Rule::S(s(T::FF_ZEROGRAD))), ("exh_outlet", Rule::S(out_p)), ("wall", Rule::S(s(T::FF_ZEROGRAD)))], pp, &no_in)?;
        make(
            cw,
            &pc,
            "T",
            "volScalarField",
            "[0 0 0 1 0 0 0]",
            pct(T::FF_UNIFORM_9G, &[A::F(tg)]),
            &[("exh_inlet", Rule::S(pct(T::FF_FIXED_9G, &[A::F(tg)]))), ("exh_outlet", Rule::S(pct(T::FF_INOUT_9G, &[A::F(tg), A::F(tg)]))), ("wall", Rule::S(s(T::FF_ADIABATIC)))],
            vec![pct(T::FF_PROV_TGAS, &[A::F(tg)])],
            &no_in,
        )?;
        make(
            cw,
            &pc,
            "alphat",
            "volScalarField",
            "[1 -1 -1 0 0 0 0]",
            s(T::FF_UNIFORM_0),
            &[("exh_inlet", Rule::S(s(T::FF_CALC0))), ("exh_outlet", Rule::S(s(T::FF_CALC0))), ("wall", Rule::S(pct(T::FF_ALPHAT_WALL, &[A::F(PR_T)])))],
            vec![pct(T::FF_PROV_PRT, &[A::F(PR_T)])],
            &no_in,
        )?;
        make(
            cw,
            &pc,
            "k",
            "volScalarField",
            "[0 2 -2 0 0 0 0]",
            pct(T::FF_UNIFORM_6G, &[A::F(k_in)]),
            &[("exh_inlet", Rule::S(pct(T::FF_FIXED_6G, &[A::F(k_in)]))), ("exh_outlet", Rule::S(pct(T::FF_INOUT_6G, &[A::F(k_in), A::F(k_in)]))), ("wall", Rule::S(pct(T::FF_KQR, &[A::F(k_in)])))],
            vec![],
            &no_in,
        )?;
        make(
            cw,
            &pc,
            "omega",
            "volScalarField",
            "[0 0 -1 0 0 0 0]",
            pct(T::FF_UNIFORM_6G, &[A::F(om_in)]),
            &[("exh_inlet", Rule::S(pct(T::FF_FIXED_6G, &[A::F(om_in)]))), ("exh_outlet", Rule::S(pct(T::FF_INOUT_6G, &[A::F(om_in), A::F(om_in)]))), ("wall", Rule::S(pct(T::FF_OMEGA_WALL, &[A::F(om_in)])))],
            vec![],
            &no_in,
        )?;
        make(
            cw,
            &pc,
            "nut",
            "volScalarField",
            "[0 2 -1 0 0 0 0]",
            s(T::FF_UNIFORM_0),
            &[("exh_inlet", Rule::S(s(T::FF_CALC0))), ("exh_outlet", Rule::S(s(T::FF_CALC0))), ("wall", Rule::S(s(T::FF_NUT_WALL)))],
            vec![s(T::FF_PROV_NUT_EXH)],
            &no_in,
        )?;
        return Ok(());
    }
    let pc = prov_common.clone();
    make(cw, &pc, "U", "volVectorField", "[0 1 -1 0 0 0 0]", s(T::FF_UNIFORM_V0), &[("atmosphere", Rule::S(s(T::FF_ATM_U))), ("outlet", Rule::S(out_u)), ("wall", Rule::S(s(T::FF_NOSLIP)))], prov_out.clone(), &no_in)?;
    if comp {
        let atm_p = pct(T::FF_ATM_P_COMP, &[A::F(p0), A::F(p0)]);
        let mut pp = prov_out.clone();
        pp.push(s(T::FF_P_ABS));
        make(cw, &pc, "p", "volScalarField", "[1 -1 -2 0 0 0 0]", pct(T::FF_UNIFORM_9G, &[A::F(p0)]), &[("atmosphere", Rule::S(atm_p)), ("outlet", Rule::S(out_p)), ("wall", Rule::S(s(T::FF_ZEROGRAD)))], pp, &no_in)?;
        make(
            cw,
            &pc,
            "T",
            "volScalarField",
            "[0 0 0 1 0 0 0]",
            pct(T::FF_UNIFORM_9G, &[A::F(t0)]),
            &[("atmosphere", Rule::S(pct(T::FF_ATM_T, &[A::F(t0), A::F(GAMMA), A::F(t0)]))), ("outlet", Rule::S(pct(T::FF_INOUT_9G, &[A::F(t0), A::F(t0)]))), ("wall", Rule::S(s(T::FF_ADIABATIC)))],
            vec![],
            &no_in,
        )?;
        make(
            cw,
            &pc,
            "alphat",
            "volScalarField",
            "[1 -1 -1 0 0 0 0]",
            s(T::FF_UNIFORM_0),
            &[("atmosphere", Rule::S(s(T::FF_CALC0))), ("outlet", Rule::S(s(T::FF_CALC0))), ("wall", Rule::S(pct(T::FF_ALPHAT_WALL, &[A::F(PR_T)])))],
            vec![pct(T::FF_PROV_PRT, &[A::F(PR_T)])],
            &no_in,
        )?;
    } else {
        let mut pp = prov_out.clone();
        pp.push(pct(T::FF_PROV_P_INC, &[A::F(rho)]));
        make(cw, &pc, "p", "volScalarField", "[0 2 -2 0 0 0 0]", s(T::FF_UNIFORM_0), &[("atmosphere", Rule::S(s(T::FF_ATM_P_INC))), ("outlet", Rule::S(out_p)), ("wall", Rule::S(s(T::FF_ZEROGRAD)))], pp, &no_in)?;
    }
    make(
        cw,
        &pc,
        "k",
        "volScalarField",
        "[0 2 -2 0 0 0 0]",
        pct(T::FF_UNIFORM_6G, &[A::F(k_in)]),
        &[("atmosphere", Rule::S(pct(T::FF_INOUT_6G, &[A::F(k_in), A::F(k_in)]))), ("outlet", Rule::S(pct(T::FF_INOUT_6G, &[A::F(k_in), A::F(k_in)]))), ("wall", Rule::S(pct(T::FF_KQR, &[A::F(k_in)])))],
        vec![],
        &no_in,
    )?;
    make(
        cw,
        &pc,
        "omega",
        "volScalarField",
        "[0 0 -1 0 0 0 0]",
        pct(T::FF_UNIFORM_6G, &[A::F(om_in)]),
        &[("atmosphere", Rule::S(pct(T::FF_INOUT_6G, &[A::F(om_in), A::F(om_in)]))), ("outlet", Rule::S(pct(T::FF_INOUT_6G, &[A::F(om_in), A::F(om_in)]))), ("wall", Rule::S(pct(T::FF_OMEGA_WALL, &[A::F(om_in)])))],
        vec![],
        &no_in,
    )?;
    make(
        cw,
        &pc,
        "nut",
        "volScalarField",
        "[0 2 -1 0 0 0 0]",
        s(T::FF_UNIFORM_0),
        &[("atmosphere", Rule::S(s(T::FF_CALC0))), ("outlet", Rule::S(s(T::FF_CALC0))), ("wall", Rule::S(s(T::FF_NUT_WALL)))],
        vec![s(T::FF_PROV_NUT)],
        &no_in,
    )
}

fn physics_files(cw: &mut CaseWriter, der: &Der) -> R<()> {
    let prov = vec![
        pct(T::PH_PROV_AIR, &[A::F(R_AIR), A::F(M_AIR * 1e3), A::F(CP_AIR), A::F(GAMMA)]),
        pct(T::PH_PROV_SUTH, &[A::F(SUTH_AS), A::F(SUTH_TS), A::F(der.t_amb), A::F(der.mu_amb)]),
    ];
    if der.compressible {
        let body = pct(T::PH_THERMO, &[A::F(M_AIR * 1e3), A::F(CP_AIR), A::F(SUTH_AS), A::F(SUTH_TS)]);
        cw.foam("constant/thermophysicalProperties", "dictionary", "thermophysicalProperties", &body, &prov, Some("constant"))?;
    } else {
        let body = pct(T::PH_TRANSPORT, &[A::F(der.nu_amb), A::F(der.rho_amb)]);
        let mut p = prov.clone();
        p.push(pct(T::PH_PROV_INC, &[A::F(der.nu_amb), A::F(der.rho_amb)]));
        cw.foam("constant/transportProperties", "dictionary", "transportProperties", &body, &p, Some("constant"))?;
    }
    let prov = vec![T::PH_PROV_T1.to_string(), T::PH_PROV_T2.into(), T::PH_PROV_T3.into(), pct(T::PH_PROV_RE, &[A::F(der.re), A::F(der.d_re * 1e3), A::F(der.u_bulk)])];
    cw.foam("constant/turbulenceProperties", "dictionary", "turbulenceProperties", T::PH_TURB, &prov, Some("constant"))
}

fn numerics_files(cw: &mut CaseWriter, der: &mut Der, is3d: bool, nonortho: i64) -> R<()> {
    let comp = der.compressible;
    let psolver = if is3d { T::NU_PSOLVER_3D } else { T::NU_PSOLVER_2D };
    let lim = if is3d { T::NU_LIM_3D } else { "corrected" };
    let mut div = vec![T::NU_DIV_U];
    if comp {
        div.extend([T::NU_DIV_H, T::NU_DIV_K, T::NU_DIV_EKP, T::NU_DIV_PHID, T::NU_DIV_RHONU]);
    } else {
        div.push(T::NU_DIV_NU);
    }
    div.extend([T::NU_DIV_KK, T::NU_DIV_OMEGA]);
    let divs: Vec<String> = div.iter().map(|x| format!("    {}", x)).collect();
    let schemes = pct(T::NU_SCHEMES, &[A::S(divs.join("\n")), A::from(lim), A::S(lim.replace("Gauss linear ", ""))]);
    cw.foam(
        "system/fvSchemes",
        "dictionary",
        "fvSchemes",
        &schemes,
        &[
            pct(T::NU_PROV1, &[A::from(if comp { " and enthalpy" } else { "" })]),
            T::NU_PROV2.to_string(),
            pct(T::NU_PROV3, &[A::from(lim), A::from(if is3d { "snappyHexMesh 3-D" } else { "structured 2-D sector" })]),
        ],
        None,
    )?;
    let mut sol = if comp {
        pct(T::NU_SOL_COMP, &[A::I(nonortho), A::from(if der.transonic { "yes" } else { "no" })]).replace("@PSOLVER@", psolver)
    } else {
        pct(T::NU_SOL_INC, &[A::I(nonortho)]).replace("@PSOLVER@", psolver)
    };
    // 3-D cases (intake and exhaust-component mode) cache grad(U), so that the explicit viscous-stress term is not taken
    // from a reused temporary (the conda-forge Linux build gets it wrong there: pipe friction 1.25x, exhaust bend K +6 %);
    // cfd/NOTES.md 4(c4), 4(f)
    let cache_grad = is3d;
    if cache_grad {
        sol.push_str(T::NU_CACHE_GRADU);
    }
    let mut nm = Dict::new();
    nm.set("algorithm", Py::Str("SIMPLE".into()));
    nm.set("relaxation", Py::Str((if comp { T::NU_RELAX_COMP } else { T::NU_RELAX_INC }).into()));
    nm.set("p_solver", Py::Str((if is3d { "GAMG" } else { "PCG/DIC" }).into()));
    nm.set("mesh", Py::Str((if is3d { "3-D snappyHexMesh" } else { "2-D sector, rotational cyclic sides" }).into()));
    der.numerics = Some(nm);
    cw.foam(
        "system/fvSolution",
        "dictionary",
        "fvSolution",
        &sol,
        &[
            pct(T::NU_SOLVER, &[A::from(&der.solver), A::from(&der.solver_why)]),
            String::from(if comp { T::NU_SP_COMP } else { T::NU_SP_INC }) + &pct(T::NU_PSOLV, &[A::from(if is3d { "GAMG (3-D)" } else { "PCG/DIC (2-D sector)" })]),
            pct(T::NU_TRANSONIC, &[A::from(if der.transonic { "on" } else { "off" }), A::F(der.m_peak)]),
            T::NU_RESID.to_string(),
            T::NU_WATCHDOG.to_string(),
        ]
        .into_iter()
        .chain(if cache_grad { vec![T::NU_CACHE_PROV1.to_string(), T::NU_CACHE_PROV2.to_string()] } else { vec![] })
        .collect::<Vec<String>>(),
        None,
    )
}

fn control_dict(cw: &mut CaseWriter, der: &Der, monitors: &[String], surfaces: &str, n_iter: i64, write_int: i64, conv: &str) -> R<()> {
    let body = pct(T::CD_BODY, &[A::from(&der.solver), A::I(n_iter), A::I(write_int), A::S(monitors.join("\n")), A::from(surfaces), A::from(conv)]);
    cw.foam(
        "system/controlDict",
        "dictionary",
        "controlDict",
        &body,
        &[
            pct(T::CD_PROV1, &[A::from(&der.solver), A::from(&der.solver_why)]),
            pct(T::CD_PROV2, &[A::I(n_iter), A::I(write_int)]),
            T::CD_PROV3.into(),
            T::CD_PROV4.into(),
            T::CD_PROV5.into(),
            T::CD_PROV6.into(),
        ],
        None,
    )
}

fn fo_patch_sum(name: &str, patch: &str) -> String {
    pct(T::FO_PATCH_SUM, &[A::from(name), A::from(patch), A::from("phi"), A::I(10)])
}
fn fo_plane_sampled(name: &str, pt: V3, nn: V3, bmin: V3, bmax: V3, op: &str, fields: &[&str]) -> String {
    pct(
        T::FO_PLANE_SAMPLED,
        &[A::from(name), A::from(name), A::S(vec9(pt)), A::S(vec9(nn)), A::S(vec9(bmin)), A::S(vec9(bmax)), A::from(op), A::S(fields.join(" ")), A::I(10)],
    )
}
fn plane_bounds(pt: V3, nn: V3, radius: f64, margin: f64) -> (V3, V3) {
    let half: Vec<f64> = (0..3).map(|i| radius * pmax(0.0, 1.0 - nn[i].powf(2.0)).sqrt() + margin).collect();
    ([pt[0] - half[0], pt[1] - half[1], pt[2] - half[2]], [pt[0] + half[0], pt[1] + half[1], pt[2] + half[2]])
}
fn surfaces_fo(planes: &[(String, V3, V3, V3, V3)], fields: &[&str]) -> String {
    let lines: Vec<String> = planes
        .iter()
        .map(|(nm, pt, nn, bmin, bmax)| pct(T::SURF_PLANE, &[A::from(nm), A::S(vec9(*pt)), A::S(vec9(*nn)), A::S(vec9(*bmin)), A::S(vec9(*bmax))]))
        .collect();
    pct(T::SURF_FO, &[A::S(fields.join(" ")), A::S(lines.join("\n"))])
}
fn allrun_text(is3d: bool) -> String {
    String::from(T::ALLRUN_HEAD) + if is3d { T::ALLRUN_MESH_3D } else { T::ALLRUN_MESH_2D } + T::ALLRUN_TAIL
}

/// Wall-function layers from the y+ target: (layers, first layer, expansion, y+ estimate).
fn layers(der: &Der, hcell: f64) -> (i64, f64, f64, f64) {
    let mut t1 = der.h_wall_wf;
    let er: f64 = 1.2;
    let mut nl = 1i64;
    while nl < 8 && t1 * (er.powf(nl as f64) - 1.0) / (er - 1.0) < 0.6 * hcell {
        nl += 1;
    }
    if t1 > 0.6 * hcell {
        t1 = 0.4 * hcell;
        nl = 2;
    }
    let yplus = 0.5 * t1 * der.u_tau / der.nu_s;
    (nl, t1, er, yplus)
}
fn level3d(d: &Design, lv: &Lv) -> R<i64> {
    match raw(&d.mesh_overrides, "level3d") {
        Some(v) => int(v),
        None => Ok(lv.level3d),
    }
}
fn box_vertices(lo: &[f64], hi: &[f64]) -> Vec<A> {
    [[lo[0], lo[1], lo[2]], [hi[0], lo[1], lo[2]], [hi[0], hi[1], lo[2]], [lo[0], hi[1], lo[2]], [lo[0], lo[1], hi[2]], [hi[0], lo[1], hi[2]], [hi[0], hi[1], hi[2]], [lo[0], hi[1], hi[2]]]
        .iter()
        .map(|p| A::S(vec9(*p)))
        .collect()
}

fn write_3d_mesh(cw: &mut CaseWriter, d: &Design, der: &Der, lv: &Lv) -> R<(i64, String, Vec<String>)> {
    let g = &d.g;
    let tris = &g.tris;
    let (dm, dref) = (g.d_mouth, g.dref);
    let (bb0, bb1) = g.bbox;
    let xp = pmax(5.0 * dm, 4.0 * dref);
    let b = pmax(5.0 * dm, 4.0 * dref);
    let lo = [-xp, pmin(-b, bb0[1] - 0.5 * dref), pmin(-b, bb0[2] - 0.5 * dref)];
    let mut hi = [bb1[0] + 0.5 * dref, pmax(b, bb1[1] + 0.5 * dref), pmax(b, bb1[2] + 0.5 * dref)];
    let h0 = dref / lv.bg3d;
    let level = level3d(d, lv)?;
    let nx: Vec<i64> = (0..3).map(|i| 4.max(((hi[i] - lo[i]) / h0).ceil() as i64)).collect();
    for i in 0..3 {
        hi[i] = lo[i] + nx[i] as f64 * h0;
    }
    let rfloor = 1.6 * (pmax(lo[1].powf(2.0), hi[1].powf(2.0)) + pmax(lo[2].powf(2.0), hi[2].powf(2.0))).sqrt();
    let free = g.free3d.as_ref();
    // free mount: the plenum wall is the plane x = p behind the mouth, its inner edge the tube's outer wall
    let floor = match free {
        Some(f) => floor_surface_at(&f.lp, rfloor, f.p)?,
        None => floor_surface(&g.mouth_loop, rfloor)?,
    };
    let t = |k: &str| tris.get(k).map(|v| v.as_slice()).unwrap_or(&[]);
    let mut regs: Vec<(&str, &[Tri])> = vec![("tract_wall", t("wall")), ("extension_wall", t("ext")), ("outlet", t("outlet")), ("plenum_wall", &floor)];
    if free.is_some() {
        regs.push(("inlet_wall", t("inlet_wall")));
    }
    cw.write("constant/triSurface/domain.stl", &stl_ascii(&regs))?;
    let closed: Vec<Tri> = [t("wall"), t("ext"), t("outlet"), t("mouth")].concat();
    cw.write("constant/triSurface/tract_closed.stl", &stl_ascii(&[("closed", &closed)]))?;
    cw.files.push("constant/triSurface/domain.stl".into());
    cw.files.push("constant/triSurface/tract_closed.stl".into());
    let hcell = h0 / 2f64.powf(level as f64);
    let (mut geo_rg, mut geo_x, mut rs_x, mut rr_x) = (String::new(), String::new(), String::new(), String::new());
    let mut free_prov: Vec<String> = Vec::new();
    let (mut hlip, mut band) = (0.0, 0.0);
    if let Some(f) = free {
        // the protruding wall and its lip: cells of at most gap / WALL_CELLS_3D across the thinnest wall
        // and at least LIP_CELLS_3D across a rounded lip's radius
        let mut hmax = f.gap / WALL_CELLS_3D;
        if let Some(rl) = f.rlip {
            hmax = pmin(hmax, rl / LIP_CELLS_3D);
        }
        let mut klip = level + 1;
        while h0 / 2f64.powf(klip as f64) > hmax && klip < level + 4 {
            klip += 1;
        }
        hlip = h0 / 2f64.powf(klip as f64);
        if hlip > f.gap / WALL_CELLS_3D * (1.0 + 1e-9) {
            bail!("{}", pct(T::M3_FREE_ERR, &[A::F(f.gap * 1e3), A::S(d.mesh_level.clone()), A::F(f.gap / WALL_CELLS_3D * 1e3), A::F(WALL_CELLS_3D)]));
        }
        if hlip > hmax * (1.0 + 1e-9) {
            bail!(
                "{}",
                pct(
                    "free mount: the lip radius %.2f mm is too small for the 3-D mesh at level '%s' (it needs %.3f mm cells, %g across it); use mesh level fine, a larger lip or mount type flange",
                    &[A::F(f.rlip.unwrap_or(0.0) * 1e3), A::S(d.mesh_level.clone()), A::F(hmax * 1e3), A::F(LIP_CELLS_3D)]
                )
            );
        }
        band = f.gap + 2.0 * hlip;
        cw.write("constant/triSurface/inlet_wall.stl", &stl_ascii(&[("inlet_wall", t("inlet_wall"))]))?;
        cw.files.push("constant/triSurface/inlet_wall.stl".into());
        geo_rg = T::M3_FREE_GEO_RG.to_string();
        geo_x = T::M3_FREE_GEO_X.to_string();
        rs_x = pct(T::M3_FREE_RS_X, &[A::I(klip), A::I(klip)]);
        rr_x = pct(T::M3_FREE_RR_X, &[A::S(fmt9(band)), A::I(klip)]);
        free_prov = vec![
            pct(T::M3_FREE_PROV1, &[A::F(f.p * 1e3), A::F(f.p * 1e3), A::F(f.r_out * 1e3)]),
            pct(T::M3_FREE_PROV2, &[A::I(klip), A::F(hlip * 1e3), A::F(f.gap / hlip), A::F(f.gap * 1e3), A::F(band * 1e3)]),
        ];
        if let Some(rl) = f.rlip {
            if rl / LIP_CELLS_3D < f.gap / WALL_CELLS_3D {
                free_prov.push(pct("  set by the rounded lip: %.1f cells across its %.2f mm radius (at least %g)", &[A::F(rl / hlip), A::F(rl * 1e3), A::F(LIP_CELLS_3D)]));
            }
        }
    }
    let (nl, t1, er, yplus_est) = layers(der, hcell);
    let loc = [-0.5 * xp + 0.0123 * h0, 0.4 * b + 0.0371 * h0, 0.3 * b + 0.0217 * h0];
    let mut a = box_vertices(&lo, &hi);
    a.extend(nx.iter().map(|&n| A::I(n)));
    let bm = pct(T::M3_BLOCKMESH, &a);
    let prov = vec![
        pct(T::M3_BPROV1, &[A::F(xp * 1e3), A::F(b * 1e3)]),
        pct(T::M3_BPROV2, &[A::F(h0 * 1e3), A::F(lv.bg3d), A::F(dref * 1e3)]),
        T::M3_BPROV3.to_string(),
        T::M3_BPROV4.to_string(),
    ];
    let mut prov = prov;
    if let Some(f) = free {
        prov.push(pct(T::M3_FREE_BPROV, &[A::F(f.p * 1e3)]));
    }
    cw.foam("system/blockMeshDict", "dictionary", "blockMeshDict", &bm, &prov, None)?;
    cw.foam("system/surfaceFeatureExtractDict", "dictionary", "surfaceFeatureExtractDict", T::M3_SFE, &[T::M3_SFE_PROV.to_string()], None)?;
    let shm = pct_named(
        T::M3_SHM,
        &[
            ("rmouth", A::S(fmt9(1.0 * dm))),
            ("lf", A::I(level + 1)),
            ("l", A::I(level)),
            ("l1", A::I(level + 1)),
            ("lm", A::I(0.max(level - 1))),
            ("loc", A::S(vec9(loc))),
            ("nl", A::I(nl)),
            ("er", A::F(er)),
            ("t1", A::S(fmt9(t1))),
            ("tmin", A::S(fmt9(0.3 * t1))),
            ("geo_rg", A::S(geo_rg)),
            ("geo_x", A::S(geo_x)),
            ("rs_x", A::S(rs_x)),
            ("rr_x", A::S(rr_x)),
        ],
    );
    cw.foam(
        "system/snappyHexMeshDict",
        "dictionary",
        "snappyHexMeshDict",
        &shm,
        &[
            pct(T::M3_PROV1, &[A::I(level), A::I(level + 1), A::F(hcell * 1e3), A::I(pround(dref / hcell)), A::I(level)]),
            pct(T::M3_PROV2, &[A::F(dm * 1e3), A::I(level), A::I(level + 1)]),
            pct(T::M3_PROV3, &[A::I(nl), A::F(t1 * 1e3), A::F(er), A::F(yplus_est), A::F(der.u_bulk)]),
            T::M3_PROV4.to_string(),
            T::M3_PROV5.to_string(),
        ]
        .into_iter()
        .chain(free_prov)
        .collect::<Vec<String>>(),
        None,
    )?;
    cw.foam("system/meshQualityDict", "dictionary", "meshQualityDict", T::MQ_INCLUDE, &[T::MQ_PROV.to_string()], None)?;
    let mut est = ((nx[0] * nx[1] * nx[2]) as f64 * 0.3 + PI * (dref / 2.0).powf(2.0) * (bb1[0] - bb0[0] + 2.0 * dref) / hcell.powf(3.0) * 1.5) as i64;
    if let Some(f) = free {
        est += (2.0 * PI * f.r_out * (f.p + f.r_out - dref / 2.0) * (band + 6.0 * hlip) / hlip.powf(3.0)) as i64;
    }
    let note = pct(T::M3_NOTE, &[A::I(est)]);
    Ok((est, note, prov))
}

fn write_3d_mesh_exhaust(cw: &mut CaseWriter, d: &Design, der: &Der, lv: &Lv) -> R<(i64, String, Vec<String>)> {
    let g = &d.g;
    let tris = &g.tris;
    let dref = g.dref;
    let (bb0, bb1) = g.bbox;
    let h0 = dref / lv.bg3d;
    let level = level3d(d, lv)?;
    let lo: Vec<f64> = (0..3).map(|i| bb0[i] - 0.75 * dref).collect();
    let mut hi: Vec<f64> = (0..3).map(|i| bb1[i] + 0.75 * dref).collect();
    let nx: Vec<i64> = (0..3).map(|i| 4.max(((hi[i] - lo[i]) / h0).ceil() as i64)).collect();
    for i in 0..3 {
        hi[i] = lo[i] + nx[i] as f64 * h0;
    }
    let t = |k: &str| tris.get(k).map(|v| v.as_slice()).unwrap_or(&[]);
    let mut regions: Vec<(&str, &[Tri])> = vec![("tract_wall", t("wall")), ("inlet_wall", t("inlet_ext")), ("extension_wall", t("ext")), ("outlet", t("outlet"))];
    for (nm, cap) in &g.inlet_caps {
        regions.push((nm.as_str(), cap.as_slice()));
    }
    cw.write("constant/triSurface/domain.stl", &stl_ascii(&regions))?;
    let mut closed: Vec<Tri> = [t("wall"), t("inlet_ext"), t("ext"), t("outlet")].concat();
    for (_, cap) in &g.inlet_caps {
        closed.extend_from_slice(cap);
    }
    cw.write("constant/triSurface/tract_closed.stl", &stl_ascii(&[("closed", &closed)]))?;
    cw.files.push("constant/triSurface/domain.stl".into());
    cw.files.push("constant/triSurface/tract_closed.stl".into());
    let hcell = h0 / 2f64.powf(level as f64);
    let (nl, t1, er, yplus_est) = layers(der, hcell);
    let loc = g.loc_in_mesh;
    let mut a = box_vertices(&lo, &hi);
    a.extend(nx.iter().map(|&n| A::I(n)));
    let bm = pct(T::MX_BLOCKMESH, &a);
    let names: Vec<&str> = g.inlets.iter().map(|i| i.name.as_str()).collect();
    let prov = vec![
        pct(T::MX_BPROV1, &[A::F(dref * 1e3), A::F(h0 * 1e3), A::F(lv.bg3d)]),
        T::MX_BPROV2.to_string(),
        pct(T::MX_BPROV3, &[A::S(names.join(", ")), A::F(g.ext_in_d), A::F(g.ext_d)]),
    ];
    cw.foam("system/blockMeshDict", "dictionary", "blockMeshDict", &bm, &prov, None)?;
    cw.foam("system/surfaceFeatureExtractDict", "dictionary", "surfaceFeatureExtractDict", T::MX_SFE, &[T::MX_SFE_PROV.to_string()], None)?;
    let mut reg_lines = vec![T::MX_REG_TRACT.to_string(), T::MX_REG_INLET.into(), T::MX_REG_EXT.into(), T::MX_REG_OUTLET.into()];
    let mut ref_lines = vec![T::MX_REF_TRACT.to_string(), T::MX_REF_INLET.into(), T::MX_REF_EXT.into(), T::MX_REF_OUTLET.into()];
    for i in &g.inlets {
        reg_lines.push(pct(T::MX_REG_FMT, &[A::from(&i.name), A::from(&i.name)]));
        ref_lines.push(pct(T::MX_REF_FMT, &[A::from(&i.name)]));
    }
    let refs = pct_named(&ref_lines.join("\n"), &[("l", A::I(level)), ("l1", A::I(level + 1))]);
    let shm = pct_named(
        T::MX_SHM,
        &[
            ("regs", A::S(reg_lines.join("\n"))),
            ("refs", A::S(refs)),
            ("lf", A::I(level + 1)),
            ("l", A::I(level)),
            ("l1", A::I(level + 1)),
            ("loc", A::S(vec9(loc))),
            ("nl", A::I(nl)),
            ("er", A::F(er)),
            ("t1", A::S(fmt9(t1))),
            ("tmin", A::S(fmt9(0.3 * t1))),
        ],
    );
    cw.foam(
        "system/snappyHexMeshDict",
        "dictionary",
        "snappyHexMeshDict",
        &shm,
        &[
            pct(T::MX_PROV1, &[A::I(level), A::I(level + 1), A::F(hcell * 1e3), A::I(pround(dref / hcell)), A::I(level), A::I(level + 1)]),
            pct(T::MX_PROV2, &[A::I(nl), A::F(t1 * 1e3), A::F(er), A::F(yplus_est), A::F(der.u_bulk)]),
            T::MX_PROV3.to_string(),
        ],
        None,
    )?;
    cw.foam("system/meshQualityDict", "dictionary", "meshQualityDict", T::MQ_INCLUDE, &[T::MQ_PROV.to_string()], None)?;
    let vol = psum(closed.iter().map(|t| v_dot(t[0], v_cross(t[1], t[2])))).abs() / 6.0;
    let est = if vol > 0.0 { (vol / hcell.powf(3.0) * 1.3) as i64 } else { nx[0] * nx[1] * nx[2] };
    let note = pct(T::MX_NOTE, &[A::I(est)]);
    Ok((est, note, prov))
}

/// A plane for case_info.json and the samplers.
struct PlaneInfo {
    name: String,
    point: V3,
    normal: V3,
    bmin: V3,
    bmax: V3,
    area: Option<f64>,
}
fn v3py(v: V3) -> Py {
    Py::List(v.iter().map(|x| Py::Float(*x)).collect())
}
fn round12(v: f64) -> f64 {
    gen(v, 12).parse::<f64>().unwrap_or(v)
}

/// generate_case(design, out_dir, base_dir) for the 3-D and exhaust paths: writes the case and returns the summary
/// that intake_cfd.py prints (and writes to generator_summary.json).
pub fn generate_case(design_text: &str, out_dir: &Path, base_dir: &Path) -> R<Py> {
    let v: serde_json::Value = serde_json::from_str(design_text).map_err(|e| format!("design.json: {}", e))?;
    let design = Py::from_json(&v);
    let mut d = normalise(&design, base_dir)?;
    if d.g.kind == "axisym" {
        return Err(derr("a straight (2-D axisymmetric) tract: the page writes these cases itself; only 3-D designs are generated here".into()));
    }
    if d.g.kind == "3d" {
        let (inner, front, cap, r_out) = inlet_profile(&d.g);
        d.g.profile_inner = inner;
        d.g.profile_front_r = front;
        d.g.profile_cap = cap;
        d.g.profile_r_out = r_out;
    }
    let exhaust = d.mode_kind == "exhaust";
    if d.g.kind == "stl" && exhaust {
        prepare_exhaust_geometry(&mut d.g)?;
    } else if d.g.kind == "stl" {
        prepare_stl_geometry(&mut d.g)?;
    } else {
        if d.g.mount == "free" && !d.g.mount_given {
            d.g.mount_note = Some(T::GC_MOUNT_NOTE.to_string());
            d.g.mount = "flange".into();
        }
        prepare_param3d_geometry(&mut d.g)?;
    }
    let mut der = derive(&d)?;
    let is3d = true;
    let stamp = std::env::var("INTAKE_CFD_STAMP").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| chrono::Local::now().format("%Y-%m-%d %H:%M").to_string());
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;
    let mut cw = CaseWriter { root: out_dir.to_path_buf(), name: d.name.clone(), stamp, files: Vec::new() };
    let lv = mesh_level(&d.mesh_level);
    let mut planes_info: Vec<PlaneInfo> = Vec::new();
    let mut monitors: Vec<String> = Vec::new();
    let write_int = if d.write_interval != 0 { d.write_interval } else { 500 };
    let (cells, mesh_note, mut n_iter, nonortho, patches): (i64, String, i64, i64, Vec<(String, String)>);
    if exhaust {
        der.flow_scale = 1.0;
        let (c, note, _prov) = write_3d_mesh_exhaust(&mut cw, &d, &der, &lv)?;
        cells = c;
        mesh_note = note;
        let mut p: Vec<(String, String)> = d.g.inlets.iter().map(|i| (i.name.clone(), "exh_inlet".to_string())).collect();
        for (k, r) in [("outlet", "exh_outlet"), ("tract_wall", "wall"), ("inlet_wall", "wall"), ("extension_wall", "wall")] {
            set_ordered(&mut p, k.into(), r.into());
        }
        patches = p;
        for (nm, (pp, nn, ag, rr)) in &d.g.planes_exhaust {
            let (bmin, bmax) = plane_bounds(*pp, *nn, (if ag.is_none() { 1.5 } else { 1.03 }) * rr, 0.12 * (2.0 * rr));
            planes_info.push(PlaneInfo { name: nm.clone(), point: *pp, normal: *nn, bmin, bmax, area: *ag });
            monitors.push(fo_plane_sampled(&format!("p_{}", nm), *pp, *nn, bmin, bmax, "areaAverage", &["p"]));
        }
        cw.foam("system/topoSetDict", "dictionary", "topoSetDict", T::GC_TOPO_EMPTY, &[T::GC_TOPO_PROV_EXH.to_string()], None)?;
        n_iter = if d.max_iter != 0 { d.max_iter } else { 3000 };
        nonortho = 1;
    } else {
        der.flow_scale = 1.0;
        let (c, note, _prov) = write_3d_mesh(&mut cw, &d, &der, &lv)?;
        cells = c;
        mesh_note = note;
        let mut p: Vec<(String, String)> = [("atmosphere", "atmosphere"), ("outlet", "outlet"), ("tract_wall", "wall"), ("extension_wall", "wall"), ("plenum_wall", "wall")]
            .iter()
            .map(|(a, b)| (a.to_string(), b.to_string()))
            .collect();
        if d.g.free3d.is_some() {
            p.push(("inlet_wall".into(), "wall".into()));
        }
        patches = p;
        let (pe, te, ae) = d.g.tract_end;
        let rad_e = (ae / PI).sqrt();
        let mut allpl: Vec<(String, V3, V3, Option<f64>)> = vec![("tract_end".into(), pe, te, Some(ae))];
        for (nm, (pp, nn)) in &d.g.planes_local {
            allpl.push((nm.clone(), *pp, *nn, None));
        }
        for (nm, pp, nn, ag) in &allpl {
            let rr = if ag.is_some() { rad_e } else { 0.75 * d.g.dref };
            let (bmin, bmax) = plane_bounds(*pp, *nn, if ag.is_none() { 1.5 * rr } else { 1.05 * rr }, 0.25 * d.g.dref);
            planes_info.push(PlaneInfo { name: nm.clone(), point: *pp, normal: *nn, bmin, bmax, area: *ag });
            monitors.push(fo_plane_sampled(&format!("p_{}", nm), *pp, *nn, bmin, bmax, "areaAverage", &["p"]));
        }
        cw.foam("system/topoSetDict", "dictionary", "topoSetDict", T::GC_TOPO_EMPTY, &[T::GC_TOPO_PROV_3D.to_string()], None)?;
        n_iter = if d.max_iter != 0 { d.max_iter } else { 3000 };
        nonortho = 1;
    }
    let _ = &mut n_iter;
    let ref_plane = if exhaust { "exit" } else { "tract_end" };
    if !planes_info.iter().any(|p| p.name == ref_plane) {
        bail!("internal: {} plane missing", ref_plane);
    }
    monitors.insert(0, fo_patch_sum("mdot_outlet", "outlet"));
    if exhaust {
        for i in d.g.inlets.iter().rev() {
            monitors.insert(0, fo_patch_sum(&format!("mdot_{}", i.name), &i.name));
        }
    } else {
        monitors.insert(0, fo_patch_sum("mdot_atmosphere", "atmosphere"));
    }
    monitors.push(pct(T::GC_YPLUS_RES, &[A::from(if der.compressible { " h" } else { "" })]));
    let sfields: Vec<&str> = if der.compressible { vec!["p", "U", "T", "rho"] } else { vec!["p", "U"] };
    let surf = surfaces_fo(&planes_info.iter().map(|p| (p.name.clone(), p.point, p.normal, p.bmin, p.bmax)).collect::<Vec<_>>(), &sfields);
    control_dict(&mut cw, &der, &monitors, &surf, n_iter, write_int, "")?;
    field_files(&mut cw, &d, &mut der, &patches)?;
    physics_files(&mut cw, &der)?;
    numerics_files(&mut cw, &mut der, is3d, nonortho)?;
    cw.foam("system/decomposeParDict", "dictionary", "decomposeParDict", T::GC_DECOMPOSE, &[T::GC_DECOMP_PROV.to_string()], None)?;
    // case_info.json for the report
    let mut info = Dict::new();
    info.set("name", Py::Str(d.name.clone()));
    info.set("solver", Py::Str(der.solver.clone()));
    info.set("compressible", Py::Bool(der.compressible));
    info.set("gamma", Py::Float(GAMMA));
    info.set("R_air", Py::Float(R_AIR));
    info.set("cp", Py::Float(CP_AIR));
    info.set("p_amb", Py::Float(der.p_amb));
    info.set("T_amb", Py::Float(der.t_amb));
    info.set("rho_amb", Py::Float(der.rho_amb));
    info.set("flow_scale", Py::Float(der.flow_scale));
    info.set(
        "planes",
        Py::List(
            planes_info
                .iter()
                .map(|p| {
                    let mut m = Dict::new();
                    m.set("name", Py::Str(p.name.clone()));
                    m.set("point", v3py(p.point));
                    m.set("normal", v3py(p.normal));
                    m.set("cut_point", v3py(p.point));
                    m.set("bmin", v3py(p.bmin));
                    m.set("bmax", v3py(p.bmax));
                    m.set("label", Py::Str("3d".into()));
                    m.set("area_geometric_m2", p.area.map(Py::Float).unwrap_or(Py::None));
                    Py::Dict(m)
                })
                .collect(),
        ),
    );
    info.set("reference_plane", Py::Str(ref_plane.into()));
    info.set("conv_window", Py::Int(300));
    info.set("ramp", Py::Int(RAMP_ITER));
    info.set("stop_mdot_rel", Py::Float(2e-4));
    info.set("stop_dp_rel", Py::Float(1e-3));
    info.set("mode", Py::Str(der.mode.clone()));
    info.set("mdot_set", der.mdot.map(Py::Float).unwrap_or(Py::None));
    info.set("p_out", der.p_out.map(Py::Float).unwrap_or(Py::None));
    info.set("generator", Py::Str(T::VERSION.into()));
    info.set("numerics", der.numerics.clone().map(Py::Dict).unwrap_or(Py::None));
    let split_py = Py::Dict(Dict(d.g.split.iter().map(|(k, v)| (k.clone(), Py::Float(*v))).collect()));
    if exhaust {
        info.set("kind", Py::Str("exhaust".into()));
        info.set("inlets", Py::List(d.g.inlets.iter().map(|i| Py::Str(i.name.clone())).collect()));
        info.set("split", split_py.clone());
        info.set("T_gas", Py::Float(d.t_gas));
        info.set("A_in_total_m2", Py::Float(d.g.a_in_total));
        info.set("inlet_areas_m2", Py::Dict(Dict(d.g.inlets.iter().map(|i| (i.name.clone(), Py::Float(i.a))).collect())));
        info.set("A_exit_m2", Py::Float(d.g.exit_face.2));
    } else {
        info.set("kind", Py::Str("intake".into()));
    }
    cw.raw("case_info.json", &dumps(&Py::Dict(info), Some(2)))?;
    cw.text(
        "intake_report.py",
        T::REPORT_PY.trim_start_matches('\n'),
        Some(&[pct(T::GC_REPORT_PROV1, &[A::F(der.p_amb), A::F(der.t_amb), A::F(GAMMA)]), T::GC_REPORT_PROV2.to_string()]),
        "#",
        false,
        Some("#!/usr/bin/env python3"),
    )?;
    cw.text("Allrun", &allrun_text(is3d), Some(&[format!("mesh: {}", mesh_note), format!("solver: {}", der.solver)]), "#", true, Some("#!/bin/bash"))?;
    cw.text("Allclean", T::ALLCLEAN, Some(&[]), "#", true, Some("#!/bin/bash"))?;
    cw.text("README_WINDOWS.md", T::README_WINDOWS, None, "#", false, None)?;
    let mut files = cw.files.clone();
    files.sort();
    let f = |x: f64| Py::Float(round12(x));
    let mut s = Dict::new();
    s.set("name", Py::Str(d.name.clone()));
    s.set("generator", Py::Str(T::VERSION.into()));
    s.set("openfoam", Py::Str(T::FOAM_VERSION.into()));
    s.set("out_dir", Py::Str(crate::paths::full_path(out_dir).to_string_lossy().into_owned()));
    s.set("mesh", Py::Str(mesh_note));
    s.set("cells", Py::Int(cells));
    s.set("solver", Py::Str(der.solver.clone()));
    s.set("solver_reason", Py::Str(der.solver_why.clone()));
    s.set("operating_point", Py::Str(der.op_source.clone()));
    s.set("mode", Py::Str(der.mode.clone()));
    s.set("mdot_kg_s", der.mdot.map(f).unwrap_or(Py::None));
    s.set("pressure_ratio", der.pr.map(f).unwrap_or(Py::None));
    s.set("M_bulk", f(der.m_bulk));
    s.set("M_peak_est", f(der.m_peak));
    s.set("U_bulk", f(der.u_bulk));
    s.set("Re", f(der.re));
    s.set("f_colebrook", f(der.f_colebrook));
    s.set("k_in", f(der.k_in));
    s.set("omega_in", f(der.omega_in));
    s.set("planes", Py::List(planes_info.iter().map(|p| Py::Str(p.name.clone())).collect()));
    s.set("files", Py::List(files.into_iter().map(Py::Str).collect()));
    if let Some(n) = &d.g.mount_note {
        s.set("note", Py::Str(n.clone()));
    }
    if d.g.dcs.len() > 1 {
        // several bores: each plane's K and Cd are referred to the bore at that plane (intake_cfd.py)
        let pb: Vec<(String, Py)> = planes_info
            .iter()
            .map(|p| {
                let x = if p.name == "tract_end" { d.g.l } else { d.g.planes.iter().find(|(n, _)| *n == p.name).map(|(_, x)| *x).unwrap_or(d.g.l) };
                (p.name.clone(), Py::Float(round12(2e3 * tube_radius(&d.g, pmin(x, d.g.l)))))
            })
            .collect();
        s.set("plane_bore_mm", Py::Dict(Dict(pb)));
        s.set("plane_K_reference", Py::Str("each plane's K and Cd use the bulk velocity in the bore at that plane".into()));
    }
    if exhaust {
        s.set("kind", Py::Str("exhaust".into()));
        s.set("inlets", Py::List(d.g.inlets.iter().map(|i| Py::Str(i.name.clone())).collect()));
        s.set("split", split_py);
        s.set("T_gas_K", Py::Float(d.t_gas));
        s.set("inlet_diameters_mm", Py::Dict(Dict(d.g.inlets.iter().map(|i| (i.name.clone(), Py::Float(i.d * 1e3))).collect())));
        s.set("exit_diameter_mm", Py::Float(d.g.dref * 1e3));
    }
    cw.raw("design_input.json", &dumps(&design, Some(2)))?;
    cw.raw("generator_summary.json", &dumps(&Py::Dict(s.clone()), Some(2)))?;
    Ok(Py::Dict(s))
}

/// What `python3 intake_cfd.py design.json case` prints when it succeeds: the summary without its file list.
pub fn summary_text(s: &Py) -> String {
    match s {
        Py::Dict(m) => dumps(&Py::Dict(Dict(m.0.iter().filter(|e| e.0 != "files").cloned().collect())), Some(2)),
        other => dumps(other, Some(2)),
    }
}

/// generate_case for a design.json file: STL paths in it are relative to its folder, as intake_cfd.py's main() has it.
pub fn generate_file(design: &Path, out_dir: &Path) -> R<Py> {
    let text = std::fs::read_to_string(design).map_err(|e| format!("{}: {}", design.display(), e))?;
    let full = crate::paths::full_path(design);
    let base = full.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    generate_case(&text, out_dir, &base)
}
