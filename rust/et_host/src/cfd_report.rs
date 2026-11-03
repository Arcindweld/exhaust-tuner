//! intake_report.py (the REPORT_PY text in cfd/intake_cfd.py) in Rust, so the program needs no Python to run a case:
//! the results of an OpenFOAM intake or exhaust case (mass flow, pressure drops, loss coefficient K, discharge
//! coefficients, and for each sampled plane the uniformity index, secondary-flow and swirl angles), written to
//! results.json and results.txt byte for byte as the script writes them, and the convergence watchdog that asks the
//! solver for a clean stop once the monitors have settled.
//!
//! Line for line from the Python, in its order of operations: sums are Python 3.12's compensated sum(), min and max
//! keep Python's argument order, the C library's pow, atan2 and sqrt are the ones Python calls, and a division by zero
//! or a missing field ends the report with an error where the script would raise. The case folder still gets
//! intake_report.py, for running a case by hand.

// NaN must fail a comparison the way it does in the script, so `!(x > y)` stays as written
#![allow(clippy::neg_cmp_op_on_partial_ord, clippy::type_complexity)]

use crate::pyfmt::{exp, fix, gen, int_of, lj, pmax, pmin, psum, repr, rj, text_mode, universal_newlines, Dict, Py};
use std::path::{Path, PathBuf};

const RAD2DEG: f64 = 180.0 / std::f64::consts::PI;
const PI: f64 = std::f64::consts::PI;

type R<T> = Result<T, String>;

fn div(a: f64, b: f64) -> R<f64> {
    if b == 0.0 {
        Err("float division by zero".into())
    } else {
        Ok(a / b)
    }
}

struct Info {
    raw: Dict,
    g: f64,
    r: f64,
    p0: f64,
    t0: f64,
    comp: bool,
    rho_inc: f64,
    scale: f64,
    scale_py: Py,
    exh: bool,
    inflow: Vec<String>,
    planes: Vec<Dict>,
}
fn key<'a>(d: &'a Dict, k: &str) -> R<&'a Py> {
    d.get(k).ok_or_else(|| format!("KeyError: '{}'", k))
}
fn fnum(d: &Dict, k: &str) -> R<f64> {
    key(d, k)?.f().ok_or_else(|| format!("{} is not a number", k))
}
fn strs(v: &Py) -> Vec<String> {
    match v {
        Py::List(a) => a.iter().map(|x| x.str()).collect(),
        _ => Vec::new(),
    }
}

impl Info {
    fn load(here: &Path) -> R<Info> {
        let t = std::fs::read_to_string(here.join("case_info.json")).map_err(|e| format!("case_info.json: {}", e))?;
        let v: serde_json::Value = serde_json::from_str(&t).map_err(|e| format!("case_info.json: {}", e))?;
        let Py::Dict(raw) = Py::from_json(&v) else { return Err("case_info.json is not an object".into()) };
        let exh = raw.get("kind").is_some_and(|k| *k == Py::Str("exhaust".into()));
        let inflow = if exh { raw.get("inlets").map(strs).unwrap_or_default() } else { vec!["atmosphere".to_string()] };
        let planes = match key(&raw, "planes")? {
            Py::List(a) => a.iter().filter_map(|p| if let Py::Dict(d) = p { Some(d.clone()) } else { None }).collect(),
            _ => return Err("case_info.json: planes is not a list".into()),
        };
        Ok(Info {
            g: fnum(&raw, "gamma")?,
            r: fnum(&raw, "R_air")?,
            p0: fnum(&raw, "p_amb")?,
            t0: fnum(&raw, "T_amb")?,
            comp: key(&raw, "compressible")?.truthy(),
            rho_inc: fnum(&raw, "rho_amb")?,
            scale: fnum(&raw, "flow_scale")?,
            scale_py: key(&raw, "flow_scale")?.clone(),
            exh,
            inflow,
            planes,
            raw,
        })
    }
}

fn ideal_flux(i: &Info, p0: f64, t0: f64, p: f64) -> R<f64> {
    let (g, r) = (i.g, i.r);
    let prc = (2.0 / (g + 1.0)).powf(g / (g - 1.0));
    let pr = pmax(pmin(div(p, p0)?, 1.0), prc);
    Ok(p0 * div(2.0 * g, (g - 1.0) * r * t0)?.sqrt() * pr.powf(1.0 / g) * pmax(0.0, 1.0 - pr.powf((g - 1.0) / g)).sqrt())
}

fn blair_cd(i: &Info, p0: f64, t0: f64, ps: f64, mdot: f64, a: f64) -> R<Option<f64>> {
    let (g, r) = (i.g, i.r);
    let cp = g * r / (g - 1.0);
    let gf = div(mdot, a)?;
    let mut ts = t0;
    for _ in 0..50 {
        let us = div(gf, div(ps, r * ts)?)?;
        ts = t0 - us * us / (2.0 * cp);
    }
    let us = div(gf, div(ps, r * ts)?)?;
    let uc = |pc: f64| -> R<f64> { Ok(pmax(0.0, 2.0 * cp * t0 * (1.0 - div(pc, p0)?.powf((g - 1.0) / g))).sqrt()) };
    let f = |pc: f64| -> R<f64> { Ok(pc - ps + gf * (uc(pc)? - us)) };
    let mut lo = p0 * (2.0 / (g + 1.0)).powf(g / (g - 1.0));
    let mut hi = ps;
    if f(lo)? > 0.0 || f(hi)? < 0.0 {
        return Ok(None);
    }
    for _ in 0..100 {
        let mid = 0.5 * (lo + hi);
        if f(mid)? > 0.0 {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    let pc = 0.5 * (lo + hi);
    let tc = t0 * div(pc, p0)?.powf((g - 1.0) / g);
    Ok(Some(div(div(mdot, div(pc, r * tc)? * uc(pc)?)?, a)?))
}

/// Python's float() of a token: the forms it reads that Rust's parser reads too.
fn pfloat(s: &str) -> Option<f64> {
    s.parse::<f64>().ok()
}

/// (header, rows) of a function object's .dat files, the time folders in order.
fn last_rows(here: &Path, fo: &str) -> R<(Option<Vec<String>>, Vec<Vec<f64>>)> {
    let base = here.join("postProcessing").join(fo);
    let mut files: Vec<(f64, PathBuf)> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&base) {
        let mut dirs: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
        dirs.sort();
        for d in dirs {
            let name = d.file_name().unwrap_or_default().to_string_lossy().into_owned();
            let mut dats: Vec<PathBuf> = std::fs::read_dir(&d)
                .map(|r| r.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "dat") && p.is_file()).collect())
                .unwrap_or_default();
            if dats.is_empty() {
                continue;
            }
            let t = name.trim().parse::<f64>().map_err(|_| format!("could not convert string to float: '{}'", name))?;
            dats.sort();
            for f in dats {
                files.push((t, f));
            }
        }
    }
    files.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let (mut rows, mut header) = (Vec::new(), None);
    for (_, f) in files {
        let text = universal_newlines(&String::from_utf8_lossy(&std::fs::read(&f).map_err(|e| e.to_string())?));
        for ln in text.split_inclusive('\n') {
            if let Some(rest) = ln.strip_prefix('#') {
                if ln.contains("Time") {
                    header = Some(rest.split_whitespace().map(|s| s.to_string()).collect());
                }
                continue;
            }
            let parts: Vec<&str> = ln.split_whitespace().collect();
            if !parts.is_empty() {
                let v: Option<Vec<f64>> = parts.iter().map(|x| pfloat(x)).collect();
                if let Some(v) = v {
                    rows.push(v);
                }
            }
        }
    }
    Ok((header, rows))
}

fn series(here: &Path, fo: &str) -> R<Vec<(f64, f64)>> {
    let (_, rows) = last_rows(here, fo)?;
    Ok(rows.iter().filter(|r| r.len() > 1).map(|r| (r[0], r[1])).collect())
}

fn drift(ser: &[(f64, f64)], window: f64) -> R<Option<f64>> {
    if ser.len() < 3 {
        return Ok(None);
    }
    let (tend, last) = ser[ser.len() - 1];
    let old: Vec<f64> = ser.iter().filter(|(t, _)| *t <= tend - window).map(|(_, v)| *v).collect();
    let Some(&o) = old.last() else { return Ok(None) };
    let rf = if last.abs() > 0.0 { last.abs() } else { 1.0 };
    Ok(Some(div((last - o).abs(), rf)?))
}

enum Field {
    S(Vec<f64>),
    V(Vec<Vec<f64>>),
}
type Vtk = (Vec<[f64; 3]>, Vec<Vec<usize>>, Vec<(String, Field)>);

/// Minimal legacy-ASCII VTK POLYDATA reader: points, polygons, cell fields.
fn read_vtk(path: &Path) -> R<Vtk> {
    let text = String::from_utf8_lossy(&std::fs::read(path).map_err(|e| e.to_string())?).into_owned();
    let tok: Vec<&str> = text.split_whitespace().collect();
    let at = |i: usize| -> R<&str> { tok.get(i).copied().ok_or_else(|| "IndexError: list index out of range".to_string()) };
    let int = |i: usize| -> R<usize> {
        let s = at(i)?;
        s.parse::<usize>().map_err(|_| format!("invalid literal for int() with base 10: '{}'", s))
    };
    let fl = |i: usize| -> R<f64> {
        let s = at(i)?;
        pfloat(s).ok_or_else(|| format!("could not convert string to float: '{}'", s))
    };
    let (mut pts, mut polys, mut fields): (Vec<[f64; 3]>, Vec<Vec<usize>>, Vec<(String, Field)>) = (Vec::new(), Vec::new(), Vec::new());
    let set = |fields: &mut Vec<(String, Field)>, name: String, f: Field| {
        if let Some(e) = fields.iter_mut().find(|e| e.0 == name) {
            e.1 = f;
        } else {
            fields.push((name, f));
        }
    };
    let mut ncell = 0usize;
    let mut i = 0usize;
    while i < tok.len() {
        match tok[i] {
            "POINTS" => {
                let n = int(i + 1)?;
                i += 3;
                pts = (0..n).map(|k| Ok([fl(i + 3 * k)?, fl(i + 3 * k + 1)?, fl(i + 3 * k + 2)?])).collect::<R<_>>()?;
                i += 3 * n;
            }
            "POLYGONS" => {
                let n = int(i + 1)?;
                i += 3;
                for _ in 0..n {
                    let m = int(i)?;
                    let mut p = Vec::with_capacity(m);
                    for q in 0..m {
                        p.push(int(i + 1 + q)?);
                    }
                    polys.push(p);
                    i += m + 1;
                }
            }
            "CELL_DATA" => {
                ncell = int(i + 1)?;
                i += 2;
            }
            "POINT_DATA" => break,
            "FIELD" if ncell > 0 => {
                let nf = int(i + 2)?;
                i += 3;
                for _ in 0..nf {
                    let name = at(i)?.to_string();
                    let (nc, nt) = (int(i + 1)?, int(i + 2)?);
                    i += 4;
                    let vals = (0..nc * nt).map(|k| fl(i + k)).collect::<R<Vec<f64>>>()?;
                    i += nc * nt;
                    let f = if nc > 1 { Field::V((0..nt).map(|k| vals[k * nc..(k + 1) * nc].to_vec()).collect()) } else { Field::S(vals) };
                    set(&mut fields, name, f);
                }
            }
            "SCALARS" if ncell > 0 => {
                let name = at(i + 1)?.to_string();
                i += 3;
                if at(i)? == "LOOKUP_TABLE" {
                    i += 2;
                }
                let v = (0..ncell).map(|k| fl(i + k)).collect::<R<Vec<f64>>>()?;
                i += ncell;
                set(&mut fields, name, Field::S(v));
            }
            "VECTORS" if ncell > 0 => {
                let name = at(i + 1)?.to_string();
                i += 3;
                let v = (0..3 * ncell).map(|k| fl(i + k)).collect::<R<Vec<f64>>>()?;
                i += 3 * ncell;
                set(&mut fields, name, Field::V((0..ncell).map(|k| v[3 * k..3 * k + 3].to_vec()).collect()));
            }
            _ => i += 1,
        }
    }
    Ok((pts, polys, fields))
}

type V3 = [f64; 3];
fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
fn mag(a: V3) -> f64 {
    dot(a, a).sqrt()
}
fn v3(v: &[f64]) -> R<V3> {
    if v.len() < 3 {
        return Err("IndexError: tuple index out of range".into());
    }
    Ok([v[0], v[1], v[2]])
}
fn sval(f: Option<&Field>, k: usize) -> R<f64> {
    match f {
        Some(Field::S(v)) => v.get(k).copied().ok_or_else(|| "IndexError: list index out of range".to_string()),
        Some(Field::V(_)) => Err("TypeError: a vector field where a scalar was expected".into()),
        None => Err("TypeError: 'NoneType' object is not subscriptable".into()),
    }
}

fn plane_metrics(i: &Info, path: &Path, centre: V3, n: V3) -> R<Option<Dict>> {
    let (pts, polys, f) = read_vtk(path)?;
    let get = |k: &str| f.iter().find(|e| e.0 == k).map(|e| &e.1);
    let (uf, pf) = (get("U"), get("p"));
    if uf.is_none() || pf.is_none() {
        return Ok(None);
    }
    let (tf, rf) = (get("T"), get("rho"));
    let (g, r) = (i.g, i.r);
    let (mut a_sum, mut mdot) = (0.0, 0.0);
    let (mut sp, mut st) = (0.0, 0.0);
    let (mut p0w, mut tw) = (0.0, 0.0);
    let mut un_list: Vec<(f64, f64)> = Vec::new();
    let (mut sec_w, mut swl_w, mut swl_abs_w) = (0.0, 0.0, 0.0);
    let (mut ang_mom, mut mom) = (0.0, 0.0);
    for (k, poly) in polys.iter().enumerate() {
        let p: Vec<V3> = poly.iter().map(|&j| pts.get(j).copied().ok_or_else(|| "IndexError: list index out of range".to_string())).collect::<R<_>>()?;
        let np = p.len() as f64;
        if p.is_empty() {
            return Err("float division by zero".into());
        }
        let c = [psum(p.iter().map(|q| q[0])) / np, psum(p.iter().map(|q| q[1])) / np, psum(p.iter().map(|q| q[2])) / np];
        let mut s = [0.0f64; 3];
        for j in 0..p.len() {
            let cr = cross(p[j], p[(j + 1) % p.len()]);
            s = [s[0] + cr[0] * 0.5, s[1] + cr[1] * 0.5, s[2] + cr[2] * 0.5];
        }
        let a = dot(s, n).abs();
        if a <= 0.0 {
            continue;
        }
        let u = match uf {
            Some(Field::V(v)) => v3(v.get(k).ok_or("IndexError: list index out of range")?)?,
            _ => return Err("TypeError: U is not a vector field".into()),
        };
        let (pk, tk, rk, p0k, t0k);
        if i.comp {
            pk = sval(pf, k)?;
            tk = sval(tf, k)?;
            rk = sval(rf, k)?;
            let m2 = div(dot(u, u), g * r * tk)?;
            p0k = pk * (1.0 + 0.5 * (g - 1.0) * m2).powf(g / (g - 1.0));
            t0k = tk * (1.0 + 0.5 * (g - 1.0) * m2);
        } else {
            rk = i.rho_inc;
            pk = i.p0 + sval(pf, k)? * i.rho_inc;
            tk = i.t0;
            p0k = pk + 0.5 * i.rho_inc * dot(u, u);
            t0k = i.t0;
        }
        let un = dot(u, n);
        let ut = sub(u, [un * n[0], un * n[1], un * n[2]]);
        let mut r_vec = sub(c, centre);
        let rn = dot(r_vec, n);
        r_vec = sub(r_vec, [rn * n[0], rn * n[1], rn * n[2]]);
        let rr = mag(r_vec);
        let mut et = cross(n, r_vec);
        et = if rr > 1e-12 { [et[0] / rr, et[1] / rr, et[2] / rr] } else { [0.0, 0.0, 0.0] };
        let uth = dot(u, et);
        let dm = rk * un * a;
        a_sum += a;
        mdot += dm;
        sp += pk * a;
        st += tk * a;
        p0w += p0k * dm;
        tw += t0k * dm;
        un_list.push((un, a));
        sec_w += (mag(ut).atan2(un.abs()) * RAD2DEG) * dm.abs();
        swl_w += (uth.atan2(un.abs()) * RAD2DEG) * dm.abs();
        swl_abs_w += (uth.atan2(un.abs()) * RAD2DEG).abs() * dm.abs();
        ang_mom += rk * un * uth * rr * a;
        mom += rk * un * un * a;
    }
    if a_sum <= 0.0 || mdot == 0.0 {
        return Ok(None);
    }
    let ubar = div(psum(un_list.iter().map(|(x, a)| x * a)), a_sum)?;
    let ui = if ubar != 0.0 { 1.0 - div(psum(un_list.iter().map(|(x, a)| (x - ubar).abs() * a)), 2.0 * ubar.abs() * a_sum)? } else { f64::NAN };
    let req = (a_sum / PI).sqrt();
    let mut d = Dict::new();
    d.set("area_m2", Py::Float(a_sum * i.scale));
    d.set("mdot_kg_s", Py::Float(mdot * i.scale));
    d.set("p_static_avg_Pa", Py::Float(sp / a_sum));
    d.set("T_static_avg_K", Py::Float(st / a_sum));
    d.set("p0_massavg_Pa", Py::Float(p0w / mdot));
    d.set("T0_massavg_K", Py::Float(tw / mdot));
    d.set("U_normal_avg_m_s", Py::Float(ubar));
    d.set("uniformity_index", Py::Float(ui));
    d.set("secondary_flow_angle_deg", Py::Float(sec_w / mdot.abs()));
    d.set("swirl_angle_net_deg", Py::Float(swl_w / mdot.abs()));
    d.set("swirl_angle_abs_deg", Py::Float(swl_abs_w / mdot.abs()));
    d.set("swirl_number", Py::Float(if mom != 0.0 { div(ang_mom, mom * req)? } else { 0.0 }));
    d.set("n_faces", Py::Int(polys.len() as i64));
    Ok(Some(d))
}

fn pname(pl: &Dict) -> String {
    pl.get("name").map(|x| x.str()).unwrap_or_default()
}

fn dp_reference(i: &Info, here: &Path) -> R<f64> {
    let mut best = 0.0;
    for pl in &i.planes {
        let ser = series(here, &format!("p_{}", pname(pl)))?;
        if let Some(&(_, v)) = ser.last() {
            let pv = if i.comp { v } else { i.p0 + v * i.rho_inc };
            best = pmax(best, (pv - i.p0).abs());
        }
    }
    Ok(best)
}

fn vec3(v: Option<&Py>) -> R<V3> {
    match v {
        Some(Py::List(a)) if a.len() >= 3 => Ok([a[0].f().unwrap_or(f64::NAN), a[1].f().unwrap_or(f64::NAN), a[2].f().unwrap_or(f64::NAN)]),
        _ => Err("a plane's point or normal is not a vector".into()),
    }
}
fn fget(d: &Dict, k: &str) -> R<f64> {
    d.get(k).and_then(|x| x.f()).ok_or_else(|| format!("KeyError: '{}'", k))
}
fn opt_f(v: Option<f64>) -> Py {
    v.map(Py::Float).unwrap_or(Py::None)
}

/// What the report run gives back: the text it printed (results.txt without the last newline) and results.json's
/// content as the program's reply carries it.
pub struct Report {
    pub text: String,
    pub results: serde_json::Value,
}

/// intake_report.py's main(): writes results.json and results.txt in the case folder.
pub fn report(here: &Path) -> R<Report> {
    let i = Info::load(here)?;
    let info = &i.raw;
    let mut out = Dict::new();
    out.set("case", key(info, "name")?.clone());
    out.set("solver", key(info, "solver")?.clone());
    out.set("notes", Py::List(vec![]));
    out.set("kind", info.get("kind").cloned().unwrap_or(Py::Str("intake".into())));
    out.set("generator", info.get("generator").cloned().unwrap_or(Py::None));
    out.set("numerics", info.get("numerics").cloned().unwrap_or(Py::None));
    out.set("flow_scale", i.scale_py.clone());
    let (_, rows) = last_rows(here, "mdot_outlet")?;
    let Some(last) = rows.last() else {
        return Err("no results yet (postProcessing/mdot_outlet missing)".into());
    };
    let it = last[0];
    let fac = if i.comp { 1.0 } else { i.rho_inc };
    let m_out = last.get(1).copied().ok_or("IndexError: list index out of range")? * fac * i.scale;
    let mut m_in = 0.0;
    let mut m_each = Dict::new();
    for nm in &i.inflow {
        let (_, rows2) = last_rows(here, &format!("mdot_{}", nm))?;
        if let Some(l2) = rows2.last() {
            let v = -l2.get(1).copied().ok_or("IndexError: list index out of range")? * fac * i.scale;
            m_each.set(nm, Py::Float(v));
            m_in += v;
        } else {
            m_in = f64::NAN;
        }
    }
    out.set("iterations", Py::Float(it));
    out.set("mdot_outlet_kg_s", Py::Float(m_out));
    out.set("mdot_atmosphere_kg_s", Py::Float(m_in));
    if i.exh {
        out.set("mdot_inlets_kg_s", Py::Dict(m_each));
    }
    let imb = if m_out != 0.0 { Some(div((m_in - m_out).abs(), m_out.abs())?) } else { None };
    out.set("mass_imbalance_rel", opt_f(imb));
    // convergence evidence
    let win_py = key(info, "conv_window")?.clone();
    let win = win_py.f().ok_or("conv_window is not a number")?;
    let mut conv = Dict::new();
    conv.set("window_iterations", win_py);
    conv.set("mdot_atmosphere_rel_change", opt_f(drift(&series(here, if i.exh { "mdot_outlet" } else { "mdot_atmosphere" })?, win)?));
    let dref = if i.exh { Some(dp_reference(&i, here)?) } else { None };
    for pl in &i.planes {
        let k = format!("p_{}_rel_change_of_dp", pname(pl));
        conv.set(&k, Py::None);
        let ser = series(here, &format!("p_{}", pname(pl)))?;
        if ser.len() > 2 {
            let (tend, lastv) = ser[ser.len() - 1];
            let old: Vec<f64> = ser.iter().filter(|(t, _)| *t <= tend - win).map(|(_, v)| *v).collect();
            if let Some(&o) = old.last() {
                let pv = if i.comp { lastv } else { i.p0 + lastv * i.rho_inc };
                let po = if i.comp { o } else { i.p0 + o * i.rho_inc };
                let dp = if i.exh { dref.unwrap() } else { i.p0 - pv };
                conv.set(&k, if dp != 0.0 { Py::Float(div((pv - po).abs(), dp.abs())?) } else { Py::None });
            }
        }
    }
    out.set("convergence", Py::Dict(conv.clone()));
    // sampled planes: the newest time folder of postProcessing/planes
    let mut tdirs: Vec<(f64, String, PathBuf)> = std::fs::read_dir(here.join("postProcessing").join("planes"))
        .map(|r| {
            r.flatten()
                .map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let digits = name.replace('.', "");
                    let k = if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()) { name.parse::<f64>().unwrap_or(-1.0) } else { -1.0 };
                    (k, name, e.path())
                })
                .collect()
        })
        .unwrap_or_default();
    tdirs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
    let mut planes: Vec<(String, Dict)> = Vec::new();
    if let Some((_, name, td)) = tdirs.last() {
        out.set("sample_time", Py::Str(name.clone()));
        for pl in &i.planes {
            let f = td.join(format!("{}.vtk", pname(pl)));
            if f.exists() {
                if let Some(m) = plane_metrics(&i, &f, vec3(pl.get("point"))?, vec3(pl.get("normal"))?)? {
                    let nm = pname(pl);
                    if let Some(e) = planes.iter_mut().find(|e| e.0 == nm) {
                        e.1 = m;
                    } else {
                        planes.push((nm, m));
                    }
                }
            }
        }
    }
    let rf = key(info, "reference_plane")?.clone();
    let ref_name = rf.str();
    let mut res: Vec<(String, Dict)> = Vec::new();
    let (p0, t0, g, r) = (i.p0, i.t0, i.g, i.r);
    for (nm, mut m) in planes {
        let a = fget(&m, "area_m2")?;
        let pl = i.planes.iter().find(|x| pname(x) == nm).ok_or("IndexError: list index out of range")?;
        let a_geo_py = match pl.get("area_geometric_m2") {
            Some(v) if v.truthy() => v.clone(),
            _ => Py::Float(a),
        };
        let a_geo = a_geo_py.f().ok_or("area_geometric_m2 is not a number")?;
        let ps = fget(&m, "p_static_avg_Pa")?;
        let ts = fget(&m, "T_static_avg_K")?;
        let p0m = fget(&m, "p0_massavg_Pa")?;
        let rho_s = if i.comp { div(ps, r * ts)? } else { i.rho_inc };
        let ub = div(m_out, rho_s * a_geo)?;
        let q = 0.5 * rho_s * ub * ub;
        let mid = if i.comp { ideal_flux(&i, p0, t0, ps)? * a_geo } else { a_geo * (2.0 * i.rho_inc * pmax(p0 - ps, 0.0)).sqrt() };
        let pr = div(p0, ps)?;
        let k_loss = div(p0 - p0m, q)?;
        let cd = if mid > 0.0 { Some(div(m_out, mid)?) } else { None };
        let blair = blair_cd(&i, p0, t0, ps, m_out, a_geo)?;
        let mvo = if m_out != 0.0 { Some(div(fget(&m, "mdot_kg_s")?, m_out)?) } else { None };
        let mach = div(ub, (g * r * ts).sqrt())?;
        m.set("PR_p0_over_ps", Py::Float(pr));
        m.set("dp_static_Pa", Py::Float(p0 - ps));
        m.set("dp_total_Pa", Py::Float(p0 - p0m));
        m.set("U_bulk_m_s", Py::Float(ub));
        m.set("q_dyn_Pa", Py::Float(q));
        m.set("K_total_loss", Py::Float(k_loss));
        m.set("Cd_flowbench", opt_f(cd));
        m.set("area_geometric_m2", a_geo_py);
        m.set("Cd_vena_contracta_Blair", opt_f(blair));
        m.set("mdot_plane_vs_outlet", opt_f(mvo));
        m.set("Mach_bulk", Py::Float(mach));
        res.push((nm, m));
    }
    let has = |res: &Vec<(String, Dict)>, n: &str| res.iter().any(|e| e.0 == n);
    let getr = |res: &Vec<(String, Dict)>, n: &str, k: &str| -> R<f64> { fget(&res.iter().find(|e| e.0 == n).unwrap().1, k) };
    let mut summary: Option<Dict> = None;
    if i.exh {
        let ins: Vec<String> = info.get("inlets").map(strs).unwrap_or_default().into_iter().filter(|n| has(&res, n)).collect();
        if !ins.is_empty() && has(&res, "exit") {
            let areas = match key(info, "inlet_areas_m2")? {
                Py::Dict(d) => d.clone(),
                _ => return Err("inlet_areas_m2 is not an object".into()),
            };
            let area = |n: &str| -> R<f64> { fget(&areas, n) };
            let mt = psum(ins.iter().map(|n| getr(&res, n, "mdot_kg_s")).collect::<R<Vec<_>>>()?);
            let p0_in = div(psum(ins.iter().map(|n| Ok(getr(&res, n, "p0_massavg_Pa")? * getr(&res, n, "mdot_kg_s")?)).collect::<R<Vec<_>>>()?), mt)?;
            let a_in = fnum(info, "A_in_total_m2")?;
            let ps_in = div(psum(ins.iter().map(|n| Ok(getr(&res, n, "p_static_avg_Pa")? * area(n)?)).collect::<R<Vec<_>>>()?), a_in)?;
            let t_in = div(psum(ins.iter().map(|n| Ok(getr(&res, n, "T_static_avg_K")? * area(n)?)).collect::<R<Vec<_>>>()?), a_in)?;
            let rho_in = div(ps_in, r * t_in)?;
            let u_in = div(m_out, rho_in * a_in)?;
            let q_in = 0.5 * rho_in * u_in * u_in;
            let ex_p0 = getr(&res, "exit", "p0_massavg_Pa")?;
            let ex_ps = getr(&res, "exit", "p_static_avg_Pa")?;
            let ex = &res.iter().find(|e| e.0 == "exit").unwrap().1;
            let mut s = Dict::new();
            s.set("mdot_kg_s", Py::Float(m_out));
            s.set("T_in_K", Py::Float(t_in));
            s.set("rho_in_kg_m3", Py::Float(rho_in));
            s.set("U_in_m_s", Py::Float(u_in));
            s.set("q_in_Pa", Py::Float(q_in));
            s.set("p0_in_Pa", Py::Float(p0_in));
            s.set("ps_in_Pa", Py::Float(ps_in));
            s.set("p0_exit_Pa", Py::Float(ex_p0));
            s.set("ps_exit_Pa", Py::Float(ex_ps));
            s.set("dp_total_Pa", Py::Float(p0_in - ex_p0));
            s.set("dp_static_Pa", Py::Float(ps_in - ex_ps));
            s.set("K", Py::Float(div(p0_in - ex_p0, q_in)?));
            s.set("K_to_ambient", Py::Float(div(p0_in - p0, q_in)?));
            s.set("back_pressure_Pa", Py::Float(ps_in - p0));
            let mut split = Dict::new();
            for n in &ins {
                split.set(n, Py::Float(div(getr(&res, n, "mdot_kg_s")?, mt)?));
            }
            s.set("split", Py::Dict(split));
            s.set("split_set", info.get("split").cloned().unwrap_or(Py::None));
            s.set("exit_uniformity_index", ex.get("uniformity_index").cloned().unwrap_or(Py::None));
            s.set("exit_swirl_angle_deg", ex.get("swirl_angle_abs_deg").cloned().unwrap_or(Py::None));
            s.set("Mach_in", Py::Float(div(u_in, (g * r * t_in).sqrt())?));
            for n in &ins {
                let k = div(getr(&res, n, "p0_massavg_Pa")? - ex_p0, q_in)?;
                res.iter_mut().find(|e| &e.0 == n).unwrap().1.set("K_inlet_to_exit", Py::Float(k));
            }
            summary = Some(s);
        }
    } else if has(&res, &ref_name) {
        let rr = &res.iter().find(|e| e.0 == ref_name).unwrap().1;
        let mut s = Dict::new();
        s.set("mdot_kg_s", Py::Float(m_out));
        for (k, from) in [("PR", "PR_p0_over_ps"), ("dp_static_Pa", "dp_static_Pa"), ("dp_total_Pa", "dp_total_Pa"), ("K", "K_total_loss"), ("Cd", "Cd_flowbench"), ("Cd_vena_contracta_Blair", "Cd_vena_contracta_Blair")] {
            s.set(k, rr.get(from).cloned().unwrap_or(Py::None));
        }
        summary = Some(s);
    }
    out.set("planes", Py::Dict(Dict(res.iter().map(|(n, d)| (n.clone(), Py::Dict(d.clone()))).collect())));
    out.set("reference_plane", rf.clone());
    if let Some(s) = &summary {
        out.set("summary", Py::Dict(s.clone()));
    }
    // y+: the newest yPlus.dat, its last time's rows
    let ydir = here.join("postProcessing").join("yPlus");
    let mut yp: Vec<PathBuf> = std::fs::read_dir(&ydir)
        .map(|r| r.flatten().map(|e| e.path().join("yPlus.dat")).filter(|p| p.is_file()).collect())
        .unwrap_or_default();
    yp.sort();
    if let Some(f) = yp.last() {
        let text = universal_newlines(&String::from_utf8_lossy(&std::fs::read(f).map_err(|e| e.to_string())?));
        let lines: Vec<Vec<&str>> = text.split_inclusive('\n').filter(|l| !l.starts_with('#') && !l.trim().is_empty()).map(|l| l.split_whitespace().collect()).collect();
        let last_t = lines.last().map(|l| l[0]);
        let mut y = Dict::new();
        for l in &lines {
            if Some(l[0]) == last_t {
                let at = |q: usize| -> R<f64> {
                    let s = l.get(q).ok_or("IndexError: list index out of range")?;
                    pfloat(s).ok_or_else(|| format!("could not convert string to float: '{}'", s))
                };
                let name = l.get(1).ok_or("IndexError: list index out of range")?;
                let mut e = Dict::new();
                e.set("min", Py::Float(at(2)?));
                e.set("max", Py::Float(at(3)?));
                e.set("avg", Py::Float(at(4)?));
                y.set(name, Py::Dict(e));
            }
        }
        out.set("yPlus", Py::Dict(y));
    }
    let mut ok = true;
    let mut notes: Vec<String> = Vec::new();
    if imb.is_none_or(|v| v > 1e-3) {
        ok = false;
        notes.push("mass imbalance > 0.1 %".into());
    }
    match conv.get("mdot_atmosphere_rel_change") {
        Some(Py::Float(v)) if !(*v > 1e-3) => {}
        _ => {
            ok = false;
            notes.push("mass flow still changing > 0.1 % over the last window".into());
        }
    }
    for (k, v) in &conv.0 {
        if let (true, Py::Float(v)) = (k.starts_with("p_"), v) {
            if *v > 5e-3 {
                ok = false;
                notes.push(format!("{} = {} (> 0.5 %)", k, gen(*v, 2)));
            }
        }
    }
    out.set("notes", Py::List(notes.iter().map(|n| Py::Str(n.clone())).collect()));
    out.set("converged", Py::Bool(ok));
    let json = crate::pyfmt::dumps(&Py::Dict(out.clone()), Some(2));
    std::fs::write(here.join("results.json"), text_mode(&json)).map_err(|e| format!("results.json: {}", e))?;

    // results.txt
    let mut l: Vec<String> = Vec::new();
    let it_d = int_of(it).ok_or("ValueError: cannot convert float NaN to integer")?;
    l.push(format!("Case {}  solver {}  iterations {}  converged: {}", key(info, "name")?.str(), key(info, "solver")?.str(), it_d, if ok { "YES" } else { "NO" }));
    if let (true, Some(sm)) = (i.exh, summary.as_ref()) {
        let s = |k: &str| fget(sm, k);
        l.push(format!(
            "Exhaust component: mass flow {} g/s of gas at {} K; inlet bulk velocity {} m/s (M {}), q_in {} Pa",
            fix(m_out * 1e3, 4),
            fix(s("T_in_K")?, 0),
            fix(s("U_in_m_s")?, 1),
            fix(s("Mach_in")?, 2),
            fix(s("q_in_Pa")?, 0)
        ));
        let dpt = s("dp_total_Pa")?;
        l.push(format!(
            "Total-pressure loss inlet -> exit face {} Pa = {} kPa = {} mbar ; K = {} (inlet dynamic heads)",
            fix(dpt, 0),
            fix(dpt / 1e3, 2),
            fix(dpt / 100.0, 1),
            fix(s("K")?, 3)
        ));
        let bp = s("back_pressure_Pa")?;
        l.push(format!(
            "Inlet total pressure above ambient {} Pa ; K to ambient (exit dynamic head included) = {} ; back pressure (static) {} kPa = {} mbar",
            fix(s("p0_in_Pa")? - p0, 0),
            fix(s("K_to_ambient")?, 3),
            fix(bp / 1e3, 2),
            fix(bp / 100.0, 1)
        ));
        if let Some(Py::Dict(split)) = sm.get("split") {
            if split.0.len() > 1 {
                let fmt = |d: &Dict| d.0.iter().map(|(n, f)| format!("{} {} %", n, fix(100.0 * f.f().unwrap_or(f64::NAN), 1))).collect::<Vec<_>>().join(", ");
                let set = match sm.get("split_set") {
                    Some(Py::Dict(d)) => fmt(d),
                    _ => String::new(),
                };
                l.push(format!("Flow split: {}  (set: {})", fmt(split), set));
            }
        }
        l.push(format!("Ambient p = {} Pa (outlet); plane table below: PR, Cd and the K column use the intake definitions and are not meaningful here", fix(p0, 1)));
    } else {
        let imb_v = match imb {
            Some(v) if v != 0.0 => v,
            _ => 0.0,
        };
        l.push(format!(
            "Mass flow (outlet faces) {} kg/s = {} g/s ; atmosphere {} kg/s ; imbalance {}",
            gen(m_out, 6),
            fix(m_out * 1e3, 4),
            gen(m_in, 6),
            exp(imb_v, 2)
        ));
        l.push(format!("Ambient p0 = {} Pa, T0 = {} K", fix(p0, 1), fix(t0, 2)));
    }
    l.push(format!(
        "{} {} {} {} {} {} {} {} {} {}",
        lj("plane", 14),
        rj("x/pos", 9),
        rj("PR=p0/ps", 10),
        rj("dp_stat", 10),
        rj("dp_tot", 8),
        rj("K", 8),
        rj("Cd", 7),
        rj("UI", 7),
        rj("sec[deg]", 8),
        rj("swirl", 8)
    ));
    for pl in &i.planes {
        let nm = pname(pl);
        if let Some((_, m)) = res.iter().find(|e| e.0 == nm) {
            let v = |k: &str| fget(m, k);
            let cd = match m.get("Cd_flowbench") {
                Some(x) if x.truthy() => x.f().unwrap_or(f64::NAN),
                _ => f64::NAN,
            };
            let label = pl.get("label").map(|x| x.str()).unwrap_or_default();
            l.push(format!(
                "{} {} {} {} {} {} {} {} {} {}",
                lj(&nm, 14),
                rj(&label, 9),
                rj(&fix(v("PR_p0_over_ps")?, 5), 10),
                rj(&fix(v("dp_static_Pa")?, 1), 10),
                rj(&fix(v("dp_total_Pa")?, 1), 8),
                rj(&fix(v("K_total_loss")?, 4), 8),
                rj(&fix(cd, 4), 7),
                rj(&fix(v("uniformity_index")?, 4), 7),
                rj(&fix(v("secondary_flow_angle_deg")?, 3), 8),
                rj(&fix(v("swirl_angle_net_deg")?, 3), 8)
            ));
        }
    }
    l.push("K = (p0_amb - p0_massavg)/(0.5 rho U_bulk^2) at the plane; Cd = mdot / isentropic mdot(p0_amb,T0 -> ps) through the plane area".into());
    if let Some((_, m)) = res.iter().find(|e| e.0 == ref_name) {
        if let Some(b) = m.get("Cd_vena_contracta_Blair").filter(|b| b.truthy()) {
            l.push(format!("Blair/Lau 'actual' (vena-contracta) CD at {}, for 1-D wave simulations: {}", ref_name, fix(b.f().unwrap_or(f64::NAN), 4)));
        }
    }
    for n in &notes {
        l.push(format!("NOTE: {}", n));
    }
    let txt = l.join("\n");
    std::fs::write(here.join("results.txt"), text_mode(&format!("{}\n", txt))).map_err(|e| format!("results.txt: {}", e))?;
    Ok(Report { text: txt, results: Py::Dict(out).to_json() })
}

/// intake_report.py --watch: once the inflow mass flow and every plane's static pressure drop change less than
/// stop_mdot_rel / stop_dp_rel over the last conv_window iterations, controlDict's stopAt becomes writeNow and the
/// solver stops cleanly. Runs while `running()` says the solver is; `say` gets the lines the script prints.
pub fn watch(here: &Path, pid: u32, running: &dyn Fn() -> bool, say: &mut dyn FnMut(&str)) -> R<()> {
    let i = Info::load(here)?;
    let info = &i.raw;
    let win = fnum(info, "conv_window")?;
    let first = fnum(info, "ramp")? + 2.0 * win;
    let cdict = here.join("system").join("controlDict");
    let fo = if i.exh { "mdot_outlet" } else { "mdot_atmosphere" };
    let stop_m = fnum(info, "stop_mdot_rel")?;
    let stop_dp = fnum(info, "stop_dp_rel")?;
    let d_int = |x: f64| int_of(x).map(|v| v.to_string()).unwrap_or_else(|| "nan".into());
    say(&format!(
        "watch: solver PID {} {}; stops it once {} drifts less than {} and every plane's pressure less than {} of its drop over {} iterations, from iteration {}",
        pid,
        if running() { "running" } else { "NOT FOUND" },
        fo,
        gen(stop_m, 6),
        gen(stop_dp, 6),
        d_int(win),
        d_int(first)
    ));
    let mut last_say = std::time::Instant::now();
    while running() {
        // time.sleep(5), in steps, so a solver that ends is noticed at once
        let t = std::time::Instant::now();
        while t.elapsed() < std::time::Duration::from_secs(5) && running() {
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        if !running() {
            break;
        }
        let ser = series(here, fo)?;
        if last_say.elapsed() >= std::time::Duration::from_secs(60) {
            last_say = std::time::Instant::now();
            let d = if ser.last().is_some_and(|l| l.0 >= first) { drift(&ser, win)? } else { None };
            say(&format!(
                "watch: {} rows of postProcessing/{}, last iteration {}, drift {}",
                ser.len(),
                fo,
                ser.last().map(|l| repr(l.0)).unwrap_or_else(|| "-".into()),
                d.map(|d| exp(d, 2)).unwrap_or_else(|| "-".into())
            ));
        }
        if ser.last().is_none_or(|l| l.0 < first) {
            continue;
        }
        let mut ok = true;
        let d = drift(&ser, win)?;
        if d.is_none_or(|d| d > stop_m) {
            ok = false;
        }
        let dref = if i.exh { Some(dp_reference(&i, here)?) } else { None };
        for pl in &i.planes {
            let sp = series(here, &format!("p_{}", pname(pl)))?;
            if sp.len() < 3 {
                ok = false;
                continue;
            }
            let (tend, lastv) = sp[sp.len() - 1];
            let old: Vec<f64> = sp.iter().filter(|(t, _)| *t <= tend - win).map(|(_, v)| *v).collect();
            let Some(&o) = old.last() else {
                ok = false;
                continue;
            };
            let pv = if i.comp { lastv } else { i.p0 + lastv * i.rho_inc };
            let po = if i.comp { o } else { i.p0 + o * i.rho_inc };
            let dp = if i.exh { dref.unwrap() } else { i.p0 - pv };
            if dp == 0.0 || div((pv - po).abs(), dp.abs())? > stop_dp {
                ok = false;
            }
        }
        if ok {
            let txt = universal_newlines(&std::fs::read_to_string(&cdict).map_err(|e| e.to_string())?);
            let txt = text_mode(&txt.replace("stopAt          endTime;", "stopAt          writeNow;"));
            // the solver re-reads controlDict when it changes: write a new file and swap it in, so that it never reads a
            // half-written one (if the swap is refused, e.g. the file is open on Windows, write in place)
            let tmp = here.join("system").join("controlDict.watch");
            std::fs::write(&tmp, &txt).map_err(|e| e.to_string())?;
            if std::fs::rename(&tmp, &cdict).is_err() {
                std::fs::write(&cdict, &txt).map_err(|e| e.to_string())?;
                let _ = std::fs::remove_file(&tmp);
            }
            say(&format!("watch: converged at iteration {} -> stopAt writeNow", d_int(ser[ser.len() - 1].0)));
            return Ok(());
        }
    }
    say("watch: the solver is no longer running");
    Ok(())
}
