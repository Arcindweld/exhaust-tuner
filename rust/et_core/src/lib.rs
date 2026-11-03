//! Exhaust Tuner core in Rust, stage 1 of the move: the router's scene queries, tube-to-tube distances and
//! clearance fields, and route()'s search, fit and clearance check. The Fusion add-in (Python, as Fusion requires)
//! loads this library with ctypes and falls back to its own Python when the library is missing, so the C
//! interface below is the whole contract.
//!
//! Every function takes plain doubles and pointers. Handles come from the *_new functions and are freed with the
//! matching *_free. Planes are 7 doubles each: a point on the plane, its normal and the margin (router.py).
//! Lengths are whatever the caller uses consistently (the add-in passes centimetres).
//!
//! Nothing here may take Fusion down: every function catches a panic at the boundary, returns its stated failure
//! value and leaves the reason for et_last_error. Where the failure value could also be a real answer (NaN from a
//! distance, 0 from a count), et_failed says whether the call just made on this thread failed.

// Written to read like router.py, line for line (the same order of operations gives the same numbers), so
// some of the linter's rewrites are declined.
#![allow(clippy::manual_clamp, clippy::manual_is_multiple_of, clippy::needless_range_loop, clippy::type_complexity)]
#![allow(clippy::unnecessary_map_or)]

pub mod cmath;
pub mod field;
pub mod geom;
pub mod hash;
pub mod route;
pub mod scene;
pub mod shells;
pub mod tubes;

use field::{Field, Source};
use geom::planes_from;
use route::{deadline_in, Fit, Route};
use scene::Scene;
use std::cell::{Cell, RefCell};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::slice;
use tubes::Tubes;

/// The C interface's version: the Python side refuses a library it does not know.
/// 2: route()'s search, fit and check (et_route_*), the scan fit's cost (et_cyl_cost), many points against the
/// scan at once (et_scene_min_dist, et_scene_nearest), et_last_error.
pub const ABI_VERSION: u32 = 2;

thread_local! {
    static LAST_ERR: RefCell<String> = const { RefCell::new(String::new()) };
    static FAILED: Cell<bool> = const { Cell::new(false) };
}

fn set_err(m: String) {
    LAST_ERR.with(|e| *e.borrow_mut() = m);
    FAILED.with(|f| f.set(true));
}

/// Records why and returns the failure value.
fn fail<T>(v: T, why: &str) -> T {
    set_err(why.to_string());
    v
}

/// Runs f, and on a panic records why and returns fallback instead of unwinding into the caller.
fn guard<T>(fallback: T, f: impl FnOnce() -> T) -> T {
    FAILED.with(|f| f.set(false));
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(v) => v,
        Err(e) => {
            let why = if let Some(s) = e.downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = e.downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown".to_string()
            };
            set_err(format!("the Rust core stopped: {}", why));
            fallback
        }
    }
}

unsafe fn sl<'a, T>(p: *const T, n: usize) -> &'a [T] {
    if p.is_null() || n == 0 {
        &[]
    } else {
        slice::from_raw_parts(p, n)
    }
}

unsafe fn p3(p: *const f64) -> [f64; 3] {
    if p.is_null() {
        [0.0; 3]
    } else {
        [*p, *p.add(1), *p.add(2)]
    }
}

/// Copies the last error's message (UTF-8, no terminator) into out. Returns its full length in bytes.
/// # Safety
/// out has room for cap bytes (or cap is 0).
#[no_mangle]
pub unsafe extern "C" fn et_last_error(out: *mut u8, cap: usize) -> usize {
    LAST_ERR.with(|e| {
        let e = e.borrow();
        let b = e.as_bytes();
        if !out.is_null() {
            for (i, c) in b.iter().take(cap).enumerate() {
                *out.add(i) = *c;
            }
        }
        b.len()
    })
}

/// 1 when the last call on this thread (other than this one, et_last_error and the *_new, *_free and version
/// functions) failed, 0 when it did not.
#[no_mangle]
pub extern "C" fn et_failed() -> i32 {
    FAILED.with(|f| f.get()) as i32
}

#[no_mangle]
pub extern "C" fn et_abi_version() -> u32 {
    ABI_VERSION
}

// ---------------------------------------------------------------- scene

#[no_mangle]
pub extern "C" fn et_scene_new(cell: f64, sample_len: f64, max_points: u64) -> *mut Scene {
    Box::into_raw(Box::new(Scene::new(cell, sample_len, max_points as usize)))
}

/// # Safety
/// s must come from et_scene_new and not be used after this call.
#[no_mangle]
pub unsafe extern "C" fn et_scene_free(s: *mut Scene) {
    if !s.is_null() {
        drop(Box::from_raw(s));
    }
}

/// # Safety
/// coords holds ncoords doubles (x, y, z per node), idx nidx node numbers (three per triangle).
#[no_mangle]
pub unsafe extern "C" fn et_scene_add_mesh(s: *mut Scene, coords: *const f64, ncoords: usize, idx: *const i64, nidx: usize, tol: f64) -> i32 {
    guard(0, || {
        let Some(s) = s.as_mut() else { return fail(0, "no scene") };
        let n = (ncoords / 3) as i64;
        if sl(idx, nidx).iter().any(|&i| i < 0 || i >= n) {
            return fail(0, "a triangle names a node the mesh does not have");
        }
        s.add_mesh(sl(coords, ncoords), sl(idx, nidx), tol);
        1
    })
}

/// # Safety
/// lo and hi point to three doubles each.
#[no_mangle]
pub unsafe extern "C" fn et_scene_build(s: *mut Scene, lo: *const f64, hi: *const f64, pad: f64) -> i32 {
    guard(0, || {
        let Some(s) = s.as_mut() else { return fail(0, "no scene") };
        s.build(p3(lo), p3(hi), pad);
        1
    })
}

/// Writes 13 doubles: ntri, npoints, e_cover, vox, tol, build_time, lo (3), hi (3), coarse cell.
/// # Safety
/// out has room for 13 doubles.
#[no_mangle]
pub unsafe extern "C" fn et_scene_stats(s: *const Scene, out: *mut f64) -> i32 {
    guard(0, || {
        let (Some(s), false) = (s.as_ref(), out.is_null()) else { return fail(0, "no scene") };
        let v = [
            s.ntri as f64, s.npoints as f64, s.e_cover, s.vox, s.tol, s.build_time, s.lo[0], s.lo[1], s.lo[2], s.hi[0], s.hi[1],
            s.hi[2], s.ccell,
        ];
        for (i, x) in v.iter().enumerate() {
            *out.add(i) = *x;
        }
        1
    })
}

/// 1 when a sampled point is within r of p, 0 when none is, -1 on an error.
/// # Safety
/// p points to three doubles; planes to 7 * nplanes doubles (or is null).
#[no_mangle]
pub unsafe extern "C" fn et_scene_any_within(s: *const Scene, p: *const f64, r: f64, planes: *const f64, nplanes: usize) -> i32 {
    guard(-1, || {
        let Some(s) = s.as_ref() else { return fail(-1, "no scene") };
        s.any_within(p3(p), r, &planes_from(sl(planes, 7 * nplanes))) as i32
    })
}

/// The fast distance, capped; NaN on an error (et_failed tells it from a NaN answer).
/// # Safety
/// As et_scene_any_within.
#[no_mangle]
pub unsafe extern "C" fn et_scene_dist_fast(s: *const Scene, p: *const f64, cap: f64, planes: *const f64, nplanes: usize) -> f64 {
    guard(f64::NAN, || {
        let Some(s) = s.as_ref() else { return fail(f64::NAN, "no scene") };
        s.dist_fast(p3(p), cap, &planes_from(sl(planes, 7 * nplanes)))
    })
}

/// The exact distance, capped; NaN on an error (et_failed tells it from a NaN answer).
/// # Safety
/// As et_scene_any_within.
#[no_mangle]
pub unsafe extern "C" fn et_scene_dist_exact(s: *mut Scene, p: *const f64, cap: f64, planes: *const f64, nplanes: usize) -> f64 {
    guard(f64::NAN, || {
        let Some(s) = s.as_mut() else { return fail(f64::NAN, "no scene") };
        s.dist_exact(p3(p), cap, &planes_from(sl(planes, 7 * nplanes)))
    })
}

/// Many fast distances at once: n points (3 doubles each) in, n distances out.
/// # Safety
/// pts holds 3 * n doubles, out room for n.
#[no_mangle]
pub unsafe extern "C" fn et_scene_dist_fast_many(s: *const Scene, pts: *const f64, n: usize, cap: f64, planes: *const f64, nplanes: usize, out: *mut f64) -> i32 {
    guard(0, || {
        let (Some(s), false) = (s.as_ref(), out.is_null()) else { return fail(0, "no scene") };
        let pl = planes_from(sl(planes, 7 * nplanes));
        let pts = sl(pts, 3 * n);
        for i in 0..n {
            *out.add(i) = s.dist_fast([pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]], cap, &pl);
        }
        1
    })
}

/// The nearest n points (3 doubles each) come to the scan, capped: the exact distance when exact is 1, the fast
/// one otherwise (router.Scene.min_dist). Infinity for no points, NaN on an error.
/// # Safety
/// pts holds 3 * n doubles; planes 7 * nplanes (or is null).
#[no_mangle]
pub unsafe extern "C" fn et_scene_min_dist(s: *mut Scene, pts: *const f64, n: usize, cap: f64, planes: *const f64, nplanes: usize, exact: i32) -> f64 {
    guard(f64::NAN, || {
        let Some(s) = s.as_mut() else { return fail(f64::NAN, "no scene") };
        let pl = planes_from(sl(planes, 7 * nplanes));
        s.min_dist(sl(pts, 3 * n), cap, &pl, exact != 0)
    })
}

/// The smallest exact distance from n points, capped, and which point has it (router.Scene.nearest): writes the
/// distance and the point's index (-1 when none comes within cap). Returns 1, or 0 on an error.
/// # Safety
/// pts holds 3 * n doubles; planes 7 * nplanes (or is null); out has room for 2.
#[no_mangle]
pub unsafe extern "C" fn et_scene_nearest(s: *mut Scene, pts: *const f64, n: usize, cap: f64, planes: *const f64, nplanes: usize, out: *mut f64) -> i32 {
    guard(0, || {
        let (Some(s), false) = (s.as_mut(), out.is_null()) else { return fail(0, "no scene") };
        let pl = planes_from(sl(planes, 7 * nplanes));
        let (best, at) = s.nearest(sl(pts, 3 * n), cap, &pl);
        *out = best;
        *out.add(1) = at.map_or(-1.0, |i| i as f64);
        1
    })
}

/// Sampled points within rad of c. Returns how many there are; writes at most max_pts of them (3 doubles each).
/// 0 on an error (et_failed tells it from none).
/// # Safety
/// c points to three doubles; out has room for 3 * max_pts doubles (or max_pts is 0).
#[no_mangle]
pub unsafe extern "C" fn et_scene_points_near(s: *const Scene, c: *const f64, rad: f64, out: *mut f64, max_pts: usize) -> usize {
    guard(0, || {
        let Some(s) = s.as_ref() else { return fail(0, "no scene") };
        let v = s.points_near(p3(c), rad);
        let n = v.len() / 3;
        if !out.is_null() {
            for (i, x) in v.iter().take(3 * max_pts.min(n)).enumerate() {
                *out.add(i) = *x;
            }
        }
        n
    })
}

/// Every sampled point. Returns how many; writes at most max_pts. 0 on an error (et_failed tells it from none).
/// # Safety
/// out has room for 3 * max_pts doubles (or max_pts is 0).
#[no_mangle]
pub unsafe extern "C" fn et_scene_points(s: *const Scene, out: *mut f64, max_pts: usize) -> usize {
    guard(0, || {
        let Some(s) = s.as_ref() else { return fail(0, "no scene") };
        let v = s.all_points();
        let n = v.len() / 3;
        if !out.is_null() {
            for (i, x) in v.iter().take(3 * max_pts.min(n)).enumerate() {
                *out.add(i) = *x;
            }
        }
        n
    })
}

// ---------------------------------------------------------------- tubes

#[no_mangle]
pub extern "C" fn et_tubes_new(cell: f64) -> *mut Tubes {
    Box::into_raw(Box::new(Tubes::new(cell)))
}

/// # Safety
/// t must come from et_tubes_new and not be used after this call.
#[no_mangle]
pub unsafe extern "C" fn et_tubes_free(t: *mut Tubes) {
    if !t.is_null() {
        drop(Box::from_raw(t));
    }
}

/// # Safety
/// pts holds 3 * npts doubles.
#[no_mangle]
pub unsafe extern "C" fn et_tubes_add_polyline(t: *mut Tubes, pts: *const f64, npts: usize, radius: f64, owner: i64) -> i32 {
    guard(0, || {
        let Some(t) = t.as_mut() else { return fail(0, "no tube set") };
        let flat = sl(pts, 3 * npts);
        let v: Vec<[f64; 3]> = flat.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
        t.add_polyline(&v, radius, owner);
        1
    })
}

/// skip_a / skip_b: owners to leave out, or i64::MIN for none. NaN on an error (et_failed tells it from a NaN
/// answer).
/// # Safety
/// p points to three doubles.
#[no_mangle]
pub unsafe extern "C" fn et_tubes_dist(t: *mut Tubes, p: *const f64, cap: f64, skip_a: i64, skip_b: i64) -> f64 {
    guard(f64::NAN, || {
        let Some(t) = t.as_mut() else { return fail(f64::NAN, "no tube set") };
        t.dist(p3(p), cap, skip_a, skip_b)
    })
}

// ---------------------------------------------------------------- fields

/// A field over the scene's fast distance. The scene must outlive the field. Null on an error.
/// # Safety
/// planes holds 7 * nplanes doubles (or is null).
#[no_mangle]
pub unsafe extern "C" fn et_field_new_scene(s: *const Scene, g: f64, cap: f64, planes: *const f64, nplanes: usize) -> *mut Field {
    guard(std::ptr::null_mut(), || {
        if s.is_null() {
            return fail(std::ptr::null_mut(), "no scene");
        }
        let planes = planes_from(sl(planes, 7 * nplanes));
        Box::into_raw(Box::new(Field::new(g, Source::Scene { scene: s, cap, planes })))
    })
}

/// A field over the tube set's distance. The tube set must outlive the field. Null on an error.
#[no_mangle]
pub extern "C" fn et_field_new_tubes(t: *mut Tubes, g: f64, cap: f64, skip_a: i64, skip_b: i64) -> *mut Field {
    guard(std::ptr::null_mut(), || {
        if t.is_null() {
            return fail(std::ptr::null_mut(), "no tube set");
        }
        Box::into_raw(Box::new(Field::new(g, Source::Tubes { tubes: t, cap, skip_a, skip_b })))
    })
}

/// # Safety
/// f must come from et_field_new_* and not be used after this call.
#[no_mangle]
pub unsafe extern "C" fn et_field_free(f: *mut Field) {
    if !f.is_null() {
        drop(Box::from_raw(f));
    }
}

/// n points in, n blended values out. Returns 1, or 0 on an error.
/// # Safety
/// pts holds 3 * n doubles, out room for n.
#[no_mangle]
pub unsafe extern "C" fn et_field_eval(f: *mut Field, pts: *const f64, n: usize, out: *mut f64) -> i32 {
    guard(0, || {
        let (Some(f), false) = (f.as_mut(), out.is_null()) else { return fail(0, "no field") };
        let pts = sl(pts, 3 * n);
        for i in 0..n {
            *out.add(i) = f.eval([pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]]);
        }
        1
    })
}

// ---------------------------------------------------------------- route(): search, fit and check

/// Python's truth test on an optional number: NaN (None) and 0 are "not given".
fn given(v: f64) -> Option<f64> {
    if v.is_nan() || v == 0.0 {
        None
    } else {
        Some(v)
    }
}

/// One tube's route context (router.py's route builds it from its _Clearance). scene and tubes may be null (no
/// scan, no other tubes); the fields are f_mid, f_s, f_e (null without a scan) and f_tt (null without other
/// tubes), all borrowed: they and the scene and tube set must outlive the context. params: route::NPARAMS
/// doubles (listed there); planes: 14 doubles, the start's plane then the end's. Null on bad input.
/// # Safety
/// The pointers are null or valid as above; params holds nparams doubles and planes 14.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn et_route_new(
    scene: *mut Scene,
    tubes: *mut Tubes,
    skip_a: i64,
    skip_b: i64,
    f_mid: *mut Field,
    f_s: *mut Field,
    f_e: *mut Field,
    f_tt: *mut Field,
    params: *const f64,
    nparams: usize,
    planes: *const f64,
) -> *mut Route {
    guard(std::ptr::null_mut(), || {
        let pl = planes_from(sl(planes, 14));
        match Route::new(scene, tubes, skip_a, skip_b, [f_mid, f_s, f_e, f_tt], sl(params, nparams), &pl) {
            Some(r) => Box::into_raw(Box::new(r)),
            None => {
                set_err(format!("the route needs {} numbers and two planes", route::NPARAMS));
                std::ptr::null_mut()
            }
        }
    })
}

/// # Safety
/// r must come from et_route_new and not be used after this call.
#[no_mangle]
pub unsafe extern "C" fn et_route_free(r: *mut Route) {
    if !r.is_null() {
        drop(Box::from_raw(r));
    }
}

/// route()'s search(extra, max_expand, until): straight through when it can, else Lazy Theta* with the corners
/// simplified. Returns the path's point count (0: no way through; read it with et_route_path) or -1 on an error;
/// writes the nodes expanded. seconds: time left (NaN: no limit).
/// # Safety
/// r from et_route_new; expanded null or valid.
#[no_mangle]
pub unsafe extern "C" fn et_route_search(r: *mut Route, extra: f64, max_expand: i64, seconds: f64, expanded: *mut i64) -> i64 {
    guard(-1, || {
        let Some(r) = r.as_mut() else { return fail(-1, "no route context") };
        let (p, ex) = r.search(extra, max_expand, deadline_in(seconds));
        if !expanded.is_null() {
            *expanded = ex;
        }
        r.path = p.unwrap_or_default();
        r.path.len() as i64
    })
}

/// The last search's path: returns its point count, writes at most max_pts points (3 doubles each). 0 on an error
/// (et_failed tells it from no path).
/// # Safety
/// out has room for 3 * max_pts doubles.
#[no_mangle]
pub unsafe extern "C" fn et_route_path(r: *const Route, out: *mut f64, max_pts: usize) -> usize {
    guard(0, || {
        let Some(r) = r.as_ref() else { return fail(0, "no route context") };
        if !out.is_null() {
            for (i, q) in r.path.iter().take(max_pts).enumerate() {
                for k in 0..3 {
                    *out.add(3 * i + k) = q[k];
                }
            }
        }
        r.path.len()
    })
}

unsafe fn fit_of<'a>(target: f64, margin: f64, w: *const f64, anchor: &'a [[f64; 3]], d_anchor: f64, nsamp: usize) -> Option<Fit<'a>> {
    let w = sl(w, 4);
    if w.len() < 4 {
        return None;
    }
    Some(Fit { target: given(target), margin, w: [w[0], w[1], w[2], w[3]], anchor, d_anchor, nsamp })
}

fn pts_of(flat: &[f64]) -> Vec<[f64; 3]> {
    flat.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect()
}

fn x_ok(n: usize) -> bool {
    n >= 2 && (n - 2) % 3 == 0
}

/// levenberg_marquardt on route()'s residuals, x (n doubles: the two end straights, then 3 per corner) fitted in
/// place. target: the centreline length (NaN or 0: none); w: 4 weights (clearance, straights, length, bends);
/// anchor: nanchor points of the corridor to keep within d_anchor of (0 points: none); step_max: NaN or 0 for
/// no limit; seconds: time left. Writes the cost; returns 1, or 0 on an error (et_last_error says why).
/// # Safety
/// x holds n doubles, w 4, anchor 3 * nanchor, cost one.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn et_route_lm(
    r: *mut Route,
    x: *mut f64,
    n: usize,
    target: f64,
    margin: f64,
    w: *const f64,
    anchor: *const f64,
    nanchor: usize,
    d_anchor: f64,
    nsamp: usize,
    iters: i64,
    step_max: f64,
    seconds: f64,
    cost: *mut f64,
) -> i32 {
    guard(0, || {
        let Some(r) = r.as_mut() else { return fail(0, "no route context") };
        if x.is_null() || !x_ok(n) {
            return fail(0, &format!("{} numbers is not two straights and whole corners", n));
        }
        let anchor = pts_of(sl(anchor, 3 * nanchor));
        let Some(fp) = fit_of(target, margin, w, &anchor, d_anchor, nsamp) else { return fail(0, "the fit needs four weights") };
        let x0 = sl(x as *const f64, n).to_vec();
        match r.lm(&x0, &fp, iters.max(0) as usize, given(step_max), deadline_in(seconds)) {
            Ok((xs, c)) => {
                for (i, v) in xs.iter().enumerate() {
                    *x.add(i) = *v;
                }
                if !cost.is_null() {
                    *cost = c;
                }
                1
            }
            Err(e) => {
                set_err(e);
                0
            }
        }
    })
}

/// route()'s residuals at x (as et_route_lm takes them): returns how many, writes at most cap; -1 on an error.
/// # Safety
/// As et_route_lm; out has room for cap doubles.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn et_route_residual(
    r: *mut Route,
    x: *const f64,
    n: usize,
    target: f64,
    margin: f64,
    w: *const f64,
    anchor: *const f64,
    nanchor: usize,
    d_anchor: f64,
    nsamp: usize,
    out: *mut f64,
    cap: usize,
) -> i64 {
    guard(-1, || {
        let Some(r) = r.as_mut() else { return fail(-1, "no route context") };
        if !x_ok(n) {
            return fail(-1, &format!("{} numbers is not two straights and whole corners", n));
        }
        let anchor = pts_of(sl(anchor, 3 * nanchor));
        let Some(fp) = fit_of(target, margin, w, &anchor, d_anchor, nsamp) else { return fail(-1, "the fit needs four weights") };
        let mut v = Vec::new();
        r.residual(sl(x, n), &fp, &mut v);
        if !out.is_null() {
            for (i, q) in v.iter().take(cap).enumerate() {
                *out.add(i) = *q;
            }
        }
        v.len() as i64
    })
}

/// certify at x: writes 11 doubles: slack, gap, tt, where the worst slack is (3) and 1 if there is one, where the
/// worst tube gap is (3) and 1 if there is one. Returns 1, or 0 on an error.
/// # Safety
/// x holds n doubles; out has room for 11.
#[no_mangle]
pub unsafe extern "C" fn et_route_certify(r: *mut Route, x: *const f64, n: usize, out: *mut f64) -> i32 {
    guard(0, || {
        let (Some(r), false) = (r.as_mut(), out.is_null()) else { return fail(0, "no route context") };
        if !x_ok(n) {
            return fail(0, &format!("{} numbers is not two straights and whole corners", n));
        }
        let c = r.certify(sl(x, n));
        let at = c.at.unwrap_or([0.0; 3]);
        let tt_at = c.tt_at.unwrap_or([0.0; 3]);
        let v = [
            c.slack,
            c.gap,
            c.tt,
            at[0],
            at[1],
            at[2],
            c.at.is_some() as i32 as f64,
            tt_at[0],
            tt_at[1],
            tt_at[2],
            c.tt_at.is_some() as i32 as f64,
        ];
        for (i, q) in v.iter().enumerate() {
            *out.add(i) = *q;
        }
        1
    })
}

/// route()'s free_at(p, extra): 1 free, 0 not, -1 on an error.
/// # Safety
/// p points to three doubles.
#[no_mangle]
pub unsafe extern "C" fn et_route_free_at(r: *mut Route, p: *const f64, extra: f64) -> i32 {
    guard(-1, || match r.as_mut() {
        Some(r) => r.free_at(p3(p), extra) as i32,
        None => fail(-1, "no route context"),
    })
}

/// route()'s los(p, q, extra): 1 clear all the way, 0 not, -1 on an error.
/// # Safety
/// p and q point to three doubles each.
#[no_mangle]
pub unsafe extern "C" fn et_route_los(r: *mut Route, p: *const f64, q: *const f64, extra: f64) -> i32 {
    guard(-1, || match r.as_mut() {
        Some(r) => r.los(p3(p), p3(q), extra) as i32,
        None => fail(-1, "no route context"),
    })
}

/// templates.fit_main_pipe's cost for the cylinder through c along a with radius r, over n points (3 doubles
/// each), each point's squared miss capped at t squared. NaN on an error (et_failed tells it from a NaN answer).
/// # Safety
/// pts holds 3 * n doubles; a and c three each.
#[no_mangle]
pub unsafe extern "C" fn et_cyl_cost(pts: *const f64, n: usize, a: *const f64, c: *const f64, r: f64, t: f64) -> f64 {
    guard(f64::NAN, || route::cyl_cost(sl(pts, 3 * n), p3(a), p3(c), r, t))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn box_mesh(lo: [f64; 3], hi: [f64; 3]) -> (Vec<f64>, Vec<i64>) {
        let mut c = Vec::new();
        for &x in &[lo[0], hi[0]] {
            for &y in &[lo[1], hi[1]] {
                for &z in &[lo[2], hi[2]] {
                    c.extend_from_slice(&[x, y, z]);
                }
            }
        }
        // 8 corners: index = 4 * ix + 2 * iy + iz
        let f: [[i64; 3]; 12] = [
            [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7],
            [1, 7, 3],
        ];
        (c, f.iter().flatten().cloned().collect())
    }

    #[test]
    fn scene_queries_on_a_box() {
        let mut s = Scene::new(1.0, 0.3, 1_500_000);
        let (c, i) = box_mesh([0.0, 0.0, 0.0], [4.0, 4.0, 4.0]);
        s.add_mesh(&c, &i, 0.0);
        s.build([-2.0, -2.0, -2.0], [6.0, 6.0, 6.0], 2.0);
        assert_eq!(s.ntri, 12);
        assert!(s.npoints > 8);
        let d = s.dist_exact([2.0, 2.0, 7.0], 10.0, &[]);
        assert!((d - 3.0).abs() < 1e-12, "{}", d);
        let f = s.dist_fast([2.0, 2.0, 7.0], 10.0, &[]);
        assert!(f >= d - 1e-12 && f <= d + s.e_cover + 1e-12, "{} {}", f, s.e_cover);
        assert!(s.any_within([2.0, 2.0, 6.5], 3.0, &[]));
        assert!(!s.any_within([2.0, 2.0, 9.0], 3.0, &[]));
        // a plane that ignores everything below z = 4.2: the whole box is behind it
        let pl = [geom::Plane { o: [0.0, 0.0, 4.2], n: [0.0, 0.0, 1.0], eps: 0.0 }];
        assert!(!s.any_within([2.0, 2.0, 4.5], 1.0, &pl));
        assert_eq!(s.dist_exact([2.0, 2.0, 4.5], 10.0, &pl), 10.0);
    }

    #[test]
    fn any_within_matches_the_walk() {
        // a scattered mesh; the fast search and router.py's walk give the same answer everywhere, planes or not
        let mut s = Scene::new(1.0, 0.3, 1_500_000);
        let mut seed = 12345u64;
        let mut rnd = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((seed >> 11) as f64) / ((1u64 << 53) as f64)
        };
        let (mut c, mut idx) = (Vec::new(), Vec::new());
        for t in 0..300 {
            let o = [rnd() * 40.0 - 20.0, rnd() * 40.0 - 20.0, rnd() * 40.0 - 20.0];
            for _ in 0..3 {
                c.extend_from_slice(&[o[0] + rnd() * 3.0, o[1] + rnd() * 3.0, o[2] + rnd() * 3.0]);
            }
            idx.extend_from_slice(&[3 * t, 3 * t + 1, 3 * t + 2]);
        }
        s.add_mesh(&c, &idx, 0.0);
        s.build([-15.0, -15.0, -15.0], [15.0, 15.0, 15.0], 3.0);
        let pl = [geom::Plane { o: [0.0, 0.0, 0.0], n: [0.3, 0.9, 0.1], eps: 0.4 }];
        let mut differ = 0;
        for _ in 0..20000 {
            let p = [rnd() * 40.0 - 20.0, rnd() * 40.0 - 20.0, rnd() * 40.0 - 20.0];
            let r = rnd() * 9.0;
            for planes in [&[][..], &pl[..]] {
                if s.any_within(p, r, planes) != s.any_within_walk(p, r, planes) {
                    differ += 1;
                }
            }
        }
        assert_eq!(differ, 0);
    }

    #[test]
    fn ffi_round_trip() {
        unsafe {
            let s = et_scene_new(1.0, 0.3, 1_500_000);
            let (c, i) = box_mesh([0.0, 0.0, 0.0], [4.0, 4.0, 4.0]);
            assert_eq!(et_scene_add_mesh(s, c.as_ptr(), c.len(), i.as_ptr(), i.len(), 0.0), 1);
            let lo = [-2.0, -2.0, -2.0];
            let hi = [6.0, 6.0, 6.0];
            assert_eq!(et_scene_build(s, lo.as_ptr(), hi.as_ptr(), 2.0), 1);
            let mut st = [0.0f64; 13];
            assert_eq!(et_scene_stats(s, st.as_mut_ptr()), 1);
            assert_eq!(st[0], 12.0);
            let p = [2.0, 2.0, 7.0];
            let d = et_scene_dist_exact(s, p.as_ptr(), 10.0, std::ptr::null(), 0);
            assert!((d - 3.0).abs() < 1e-12);
            let f = et_field_new_scene(s, 0.5, 10.0, std::ptr::null(), 0);
            let mut out = [0.0f64; 1];
            assert_eq!(et_field_eval(f, p.as_ptr(), 1, out.as_mut_ptr()), 1);
            assert!(out[0] > 2.5 && out[0] < 3.6);
            et_field_free(f);
            et_scene_free(s);
            assert_eq!(et_abi_version(), ABI_VERSION);
        }
    }

    #[test]
    fn a_panic_comes_back_as_an_error() {
        let v = guard(7, || -> i32 { panic!("on purpose") });
        assert_eq!(v, 7);
        let mut buf = [0u8; 64];
        let n = unsafe { et_last_error(buf.as_mut_ptr(), buf.len()) };
        assert_eq!(std::str::from_utf8(&buf[..n]).unwrap(), "the Rust core stopped: on purpose");
        assert_eq!(et_failed(), 1);
        // a call that works clears it; one that fails says why
        assert_eq!(guard(0, || 3), 3);
        assert_eq!(et_failed(), 0);
        unsafe {
            let p = [0.0f64; 3];
            assert!(et_scene_dist_fast(std::ptr::null(), p.as_ptr(), 5.0, std::ptr::null(), 0).is_nan());
            assert_eq!(et_failed(), 1);
            let n = et_last_error(buf.as_mut_ptr(), buf.len());
            assert_eq!(std::str::from_utf8(&buf[..n]).unwrap(), "no scene");
            assert_eq!(et_scene_any_within(std::ptr::null(), p.as_ptr(), 1.0, std::ptr::null(), 0), -1);
            assert!(et_field_new_tubes(std::ptr::null_mut(), 0.5, 5.0, 0, 0).is_null());
            // a triangle that names a node the mesh does not have
            let s = et_scene_new(1.0, 0.3, 1000);
            let c = [0.0f64; 9];
            let i = [0i64, 1, 3];
            assert_eq!(et_scene_add_mesh(s, c.as_ptr(), c.len(), i.as_ptr(), i.len(), 0.0), 0);
            assert_eq!(et_failed(), 1);
            et_scene_free(s);
        }
        // bad input is refused, not a crash
        unsafe {
            assert!(et_route_new(std::ptr::null_mut(), std::ptr::null_mut(), 0, 0, std::ptr::null_mut(), std::ptr::null_mut(),
                std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null(), 0, std::ptr::null()).is_null());
            assert_eq!(et_route_search(std::ptr::null_mut(), 0.0, 10, 1.0, std::ptr::null_mut()), -1);
        }
    }
}
