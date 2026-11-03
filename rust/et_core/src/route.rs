//! router.py's route() inner loops in Rust: the lattice search (Lazy Theta*, with its line-of-sight checks and
//! the corner simplification), the Levenberg-Marquardt fit with route()'s residuals (the centreline built from
//! the corners, sampled, and checked against the clearance fields), and the walk along the finished centreline
//! that proves the clearance (certify). route() itself stays in Python: the order of searches and fits, the
//! length stage, the scoring and the messages. It calls these through native.py's Route.
//!
//! Each function is router.py's, in its order of operations, so the two give the same numbers. Two Python details
//! matter for that: min() and max() return the first of equal values (pmin, pmax), and sum() of floats is
//! Neumaier-compensated from Python 3.12 on (psum, told which by the caller).

use crate::field::Field;
use crate::geom::{seg_d2, Plane};
use crate::hash::{Map, Set};
use crate::scene::Scene;
use crate::tubes::Tubes;
use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::time::{Duration, Instant};

pub type V3 = [f64; 3];
type Key = (i64, i64, i64);

/// math.radians: x * (pi / 180), the constant rounded once, as CPython does.
const DEG2RAD: f64 = std::f64::consts::PI / 180.0;

#[inline]
fn vadd(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
#[inline]
fn vsub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
#[inline]
fn vmul(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
#[inline]
fn vdot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
#[inline]
fn vlen(a: V3) -> f64 {
    (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt()
}
#[inline]
fn vunit(a: V3) -> V3 {
    let n = vlen(a);
    if n < 1e-12 {
        return [0.0; 3];
    }
    [a[0] / n, a[1] / n, a[2] / n]
}
#[inline]
fn vdist(a: V3, b: V3) -> f64 {
    vlen(vsub(a, b))
}

/// Python's min(a, b) on floats: a unless b is smaller.
#[inline]
pub fn pmin(a: f64, b: f64) -> f64 {
    if b < a {
        b
    } else {
        a
    }
}

/// Python's max(a, b) on floats: a unless b is larger.
#[inline]
pub fn pmax(a: f64, b: f64) -> f64 {
    if b > a {
        b
    } else {
        a
    }
}

/// Python's sum() of floats (it starts from the integer 0): Neumaier-compensated on Python 3.12 and later, a plain
/// running sum before (CPython's builtin_sum_impl).
pub fn psum<I: IntoIterator<Item = f64>>(it: I, neumaier: bool) -> f64 {
    let mut it = it.into_iter();
    let Some(first) = it.next() else { return 0.0 };
    let mut f = 0.0 + first; // the int 0 plus the first float: 0 + -0.0 is 0.0
    if !neumaier {
        for x in it {
            f += x;
        }
        return f;
    }
    let mut c = 0.0f64;
    for x in it {
        let t = f + x;
        if f.abs() >= x.abs() {
            c += (f - t) + x;
        } else {
            c += (x - t) + f;
        }
        f = t;
    }
    if c != 0.0 && c.is_finite() {
        f += c;
    }
    f
}

fn angle_between(a: V3, b: V3) -> f64 {
    let c = vdot(vunit(a), vunit(b));
    pmax(-1.0, pmin(1.0, c)).acos()
}

// ---------------------------------------------------------------- the centreline: corners rounded to the bend

/// One piece of centreline: router.py's ('line', p0, p1, length) or ('arc', p0, p1, centre, angle, length, u0, u1).
#[derive(Clone, Copy, Debug)]
pub enum Elem {
    Line { p0: V3, p1: V3, len: f64 },
    Arc { p0: V3, p1: V3, cen: V3, a: f64, len: f64, u0: V3, u1: V3 },
}

impl Elem {
    #[inline]
    pub fn len(&self) -> f64 {
        match *self {
            Elem::Line { len, .. } | Elem::Arc { len, .. } => len,
        }
    }

    /// elem_point: the point a fraction f of the way along.
    pub fn point(&self, f: f64) -> V3 {
        match *self {
            Elem::Line { p0, p1, .. } => {
                [p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f]
            }
            Elem::Arc { p0, cen, a, len, u0, u1, .. } => {
                let r = len / a;
                let s = a.sin();
                if s < 1e-9 {
                    return p0;
                }
                let w0 = ((1.0 - f) * a).sin() / s;
                let w1 = (f * a).sin() / s;
                [
                    cen[0] + r * (w0 * u0[0] + w1 * u1[0]),
                    cen[1] + r * (w0 * u0[1] + w1 * u1[1]),
                    cen[2] + r * (w0 * u0[2] + w1 * u1[2]),
                ]
            }
        }
    }
}

pub struct Geo {
    pub elems: Vec<Elem>,
    pub t: Vec<f64>,
    pub th: Vec<f64>,
    pub avail: Vec<f64>,
    pub length: f64,
}

/// chain_geometry: the corner points Q (the tube ends first and last) with every corner rounded to radius r.
pub fn chain_geometry(q: &[V3], r: f64, nm: bool) -> Geo {
    let n = q.len();
    let mut dirs: Vec<V3> = Vec::with_capacity(n);
    let mut lens: Vec<f64> = Vec::with_capacity(n);
    for i in 0..n.saturating_sub(1) {
        let d = vsub(q[i + 1], q[i]);
        let l = vlen(d);
        lens.push(l);
        let di = if l > 1e-12 {
            vmul(d, 1.0 / l)
        } else if let Some(&last) = dirs.last() {
            last
        } else {
            [1.0, 0.0, 0.0]
        };
        dirs.push(di);
    }
    let r179 = 179.0 * DEG2RAD;
    let mut t = vec![0.0f64; n];
    let mut th = vec![0.0f64; n];
    for i in 1..n.saturating_sub(1) {
        let a = angle_between(dirs[i - 1], dirs[i]);
        th[i] = a;
        t[i] = r * (pmin(a, r179) / 2.0).tan();
    }
    let avail: Vec<f64> = (0..n.saturating_sub(1)).map(|i| lens[i] - t[i] - t[i + 1]).collect();
    let mut elems: Vec<Elem> = Vec::with_capacity(2 * n);
    for i in 0..n.saturating_sub(1) {
        let s0 = vadd(q[i], vmul(dirs[i], t[i]));
        let s1 = vsub(q[i + 1], vmul(dirs[i], t[i + 1]));
        let ln = pmax(0.0, avail[i]);
        if ln > 1e-9 {
            elems.push(Elem::Line { p0: s0, p1: s1, len: ln });
        }
        let j = i + 1;
        if j + 2 <= n && th[j] > 1e-7 {
            let a = th[j];
            let (din, dout) = (dirs[i], dirs[j]);
            let b = vunit(vsub(dout, din));
            let cen = vadd(q[j], vmul(b, r / (pmin(a, r179) / 2.0).cos()));
            let p0 = vsub(q[j], vmul(din, t[j]));
            let p1 = vadd(q[j], vmul(dout, t[j]));
            let u0 = vunit(vsub(p0, cen));
            let u1 = vunit(vsub(p1, cen));
            elems.push(Elem::Arc { p0, p1, cen, a, len: r * a, u0, u1 });
        }
    }
    // two arcs back to back a hair apart: both ends snapped to the midpoint (router.py says why)
    for k in 0..elems.len().saturating_sub(1) {
        if let (Elem::Arc { p0: a0, p1: a1, cen: ac, a: aa, len: al, u0: au0, .. }, Elem::Arc { p0: b0, p1: b1, cen: bc, a: ba, len: bl, u1: bu1, .. }) =
            (elems[k], elems[k + 1])
        {
            let g = vdist(a1, b0);
            if 1e-9 < g && g < 0.05 {
                let m = vmul(vadd(a1, b0), 0.5);
                elems[k] = Elem::Arc { p0: a0, p1: m, cen: ac, a: aa, len: al, u0: au0, u1: vunit(vsub(m, ac)) };
                elems[k + 1] = Elem::Arc { p0: m, p1: b1, cen: bc, a: ba, len: bl, u0: vunit(vsub(m, bc)), u1: bu1 };
            }
        }
    }
    let length = psum(lens.iter().cloned(), nm) - psum((1..n.saturating_sub(1)).map(|i| 2.0 * t[i] - r * th[i]), nm);
    Geo { elems, t, th, avail, length }
}

/// sample_path: n points spread evenly by arc length, as (s, point).
pub fn sample_path(elems: &[Elem], total: f64, n: usize, out: &mut Vec<(f64, V3)>) {
    out.clear();
    if total <= 0.0 || elems.is_empty() {
        return;
    }
    let mut cum = 0.0f64;
    let mut k = 0usize;
    let ne = elems.len();
    for i in 0..n {
        let s = (i as f64 + 0.5) * total / n as f64;
        while k < ne - 1 && cum + elems[k].len() < s {
            cum += elems[k].len();
            k += 1;
        }
        let e = &elems[k];
        let l = e.len();
        let f = if l <= 0.0 { 0.0 } else { pmin(1.0, pmax(0.0, (s - cum) / l)) };
        out.push((s, e.point(f)));
    }
}

fn poly_dist(p: V3, poly: &[V3]) -> f64 {
    let mut best = 1e18f64;
    for w in poly.windows(2) {
        let (a, b) = (w[0], w[1]);
        let d = seg_d2(p[0], p[1], p[2], a[0], a[1], a[2], b[0], b[1], b[2]);
        if d < best {
            best = d;
        }
    }
    best.sqrt()
}

/// levenberg_marquardt's _solve: Gaussian elimination with partial pivoting (the first of equal pivots), on n x n
/// row-major a. None when a pivot is under 1e-18.
pub fn solve(a: &[f64], b: &[f64], n: usize, nm: bool) -> Option<Vec<f64>> {
    let w = n + 1;
    let mut m = vec![0.0f64; n * w];
    for i in 0..n {
        m[i * w..i * w + n].copy_from_slice(&a[i * n..(i + 1) * n]);
        m[i * w + n] = b[i];
    }
    for c in 0..n {
        let mut piv = c;
        let mut best = m[c * w + c].abs();
        for r in c + 1..n {
            let v = m[r * w + c].abs();
            if v > best {
                best = v;
                piv = r;
            }
        }
        if m[piv * w + c].abs() < 1e-18 {
            return None;
        }
        if piv != c {
            for k in 0..w {
                m.swap(c * w + k, piv * w + k);
            }
        }
        let pv = m[c * w + c];
        for r in c + 1..n {
            let f = m[r * w + c] / pv;
            if f != 0.0 {
                for k in c..w {
                    let v = f * m[c * w + k];
                    m[r * w + k] -= v;
                }
            }
        }
    }
    let mut x = vec![0.0f64; n];
    for r in (0..n).rev() {
        let s = m[r * w + n] - psum((r + 1..n).map(|k| m[r * w + k] * x[k]), nm);
        x[r] = s / m[r * w + r];
    }
    Some(x)
}

// ---------------------------------------------------------------- one tube's route

#[derive(Clone, Copy, PartialEq, Eq)]
enum Zone {
    S,
    E,
    M,
}

/// What route()'s fit asks for: the target length (None: as short as is clear), the clearance margin, the
/// weights (clearance, straights, length, bends), the corridor to keep near and how far, and the samples.
pub struct Fit<'a> {
    pub target: Option<f64>,
    pub margin: f64,
    pub w: [f64; 4],
    pub anchor: &'a [V3],
    pub d_anchor: f64,
    pub nsamp: usize,
}

/// certify's result.
#[derive(Clone, Copy, Debug)]
pub struct Cert {
    pub slack: f64,
    pub gap: f64,
    pub tt: f64,
    pub at: Option<V3>,
    pub tt_at: Option<V3>,
}

/// The heap entry: heapq pops the smallest (f, counter); BinaryHeap pops the greatest, so the order is reversed.
struct Item {
    f: f64,
    c: u64,
    n: Key,
}

impl PartialEq for Item {
    fn eq(&self, o: &Self) -> bool {
        self.f == o.f && self.c == o.c
    }
}
impl Eq for Item {}
impl Ord for Item {
    fn cmp(&self, o: &Self) -> Ordering {
        if self.f < o.f {
            Ordering::Greater
        } else if self.f > o.f {
            Ordering::Less
        } else {
            o.c.cmp(&self.c)
        }
    }
}
impl PartialOrd for Item {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}

/// The 26 lattice neighbours in router.py's order (_NB).
fn neighbours() -> [Key; 26] {
    let mut out = [(0i64, 0i64, 0i64); 26];
    let mut k = 0;
    for i in -1..=1i64 {
        for j in -1..=1i64 {
            for l in -1..=1i64 {
                if (i, j, l) != (0, 0, 0) {
                    out[k] = (i, j, l);
                    k += 1;
                }
            }
        }
    }
    out
}

/// One tube's route context: router.py's _Clearance for it (the scan, the other tubes and the fields, borrowed
/// from the Python side, which keeps them alive) and the numbers route() works with.
pub struct Route {
    scene: *mut Scene,
    tubes: *mut Tubes,
    skip_a: i64,
    skip_b: i64,
    f_mid: *mut Field,
    f_s: *mut Field,
    f_e: *mut Field,
    f_tt: *mut Field,
    start: V3,
    start_dir: V3,
    end: V3,
    end_dir: V3,
    lead_start: f64,
    lead_end: f64,
    min_straight: f64,
    max_bend_deg: f64,
    rt: f64, // tube radius (s['R'])
    rb: f64, // bend centreline radius (s['clr'])
    gap_tt: f64,
    req: f64,
    cap: f64,
    excl_s: f64,
    excl_e: f64,
    ramp_tt: f64,
    touch: f64,
    a: V3,
    b: V3,
    h: f64,
    semi: Option<f64>,
    los_step: f64,
    nm: bool,
    plane_s: [Plane; 1],
    plane_e: [Plane; 1],
    nb: [Key; 26],
    pub path: Vec<V3>,
    samples: Vec<(f64, V3)>,
}

/// The parameters, in order (all doubles): start (3), start_dir (3), end (3), end_dir (3), lead_start, lead_end,
/// min_straight, max_bend_deg, R (tube radius), clr (bend radius), gap_tt, req, cap, excl_s, excl_e, ramp_tt,
/// TOUCH, A (3), B (3), h, semi (NaN: no length target), los_step, neumaier (1: Python 3.12+ sum).
pub const NPARAMS: usize = 35;

fn v3(p: &[f64], i: usize) -> V3 {
    [p[i], p[i + 1], p[i + 2]]
}

impl Route {
    /// # Safety
    /// The pointers are null or valid for the Route's life (the Python side holds the objects).
    #[allow(clippy::too_many_arguments)]
    pub unsafe fn new(
        scene: *mut Scene,
        tubes: *mut Tubes,
        skip_a: i64,
        skip_b: i64,
        fields: [*mut Field; 4],
        p: &[f64],
        planes: &[Plane],
    ) -> Option<Route> {
        if p.len() < NPARAMS || planes.len() < 2 {
            return None;
        }
        let tubes = match tubes.as_ref() {
            Some(t) if !t.is_empty() => tubes,
            _ => std::ptr::null_mut(),
        };
        Some(Route {
            scene,
            tubes,
            skip_a,
            skip_b,
            f_mid: fields[0],
            f_s: fields[1],
            f_e: fields[2],
            f_tt: fields[3],
            start: v3(p, 0),
            start_dir: v3(p, 3),
            end: v3(p, 6),
            end_dir: v3(p, 9),
            lead_start: p[12],
            lead_end: p[13],
            min_straight: p[14],
            max_bend_deg: p[15],
            rt: p[16],
            rb: p[17],
            gap_tt: p[18],
            req: p[19],
            cap: p[20],
            excl_s: p[21],
            excl_e: p[22],
            ramp_tt: p[23],
            touch: p[24],
            a: v3(p, 25),
            b: v3(p, 28),
            h: p[31],
            semi: if p[32].is_nan() { None } else { Some(p[32]) },
            los_step: p[33],
            nm: p[34] != 0.0,
            plane_s: [planes[0]],
            plane_e: [planes[1]],
            nb: neighbours(),
            path: Vec::new(),
            samples: Vec::new(),
        })
    }

    // ------------------------------------------------------------ _Clearance

    fn zone(&self, s_pos: f64, total: f64) -> Zone {
        if s_pos < self.excl_s {
            Zone::S
        } else if total - s_pos < self.excl_e {
            Zone::E
        } else {
            Zone::M
        }
    }

    fn planes(&self, z: Zone) -> &[Plane] {
        match z {
            Zone::S => &self.plane_s,
            Zone::E => &self.plane_e,
            Zone::M => &[],
        }
    }

    fn tt_factor(&self, s_pos: f64, total: f64) -> f64 {
        let a = (s_pos - self.lead_start) / self.ramp_tt;
        let b = (total - s_pos - self.lead_end) / self.ramp_tt;
        pmax(0.0, pmin(pmin(1.0, a), b))
    }

    fn req_tt(&self, s_pos: f64, total: f64, margin: f64) -> f64 {
        let f = self.tt_factor(s_pos, total);
        self.rt + self.gap_tt * f + margin * pmin(1.0, 4.0 * f) - self.touch * (1.0 - f)
    }

    fn on_fixed_end(&self, s_pos: f64, total: f64) -> bool {
        s_pos < self.lead_start - 1e-9 || total - s_pos < self.lead_end - 1e-9
    }

    fn point_free(&mut self, p: V3, near_s: bool, near_e: bool, ramp_f: f64, extra: f64) -> bool {
        let mut ok = true;
        // SAFETY: valid for the Route's life (new); one thread.
        if let Some(sc) = unsafe { self.scene.as_ref() } {
            let planes: &[Plane] = if near_s {
                &self.plane_s
            } else if near_e {
                &self.plane_e
            } else {
                &[]
            };
            ok = !sc.any_within(p, self.req + extra * ramp_f, planes);
        }
        if ok {
            if let Some(t) = unsafe { self.tubes.as_mut() } {
                let d2 = t.dist(p, self.cap, self.skip_a, self.skip_b);
                ok = d2 >= self.rt + (self.gap_tt + extra) * ramp_f - 1e-6;
            }
        }
        ok
    }

    // ------------------------------------------------------------ the search

    /// route()'s free_at.
    pub fn free_at(&mut self, p: V3, extra: f64) -> bool {
        let ns = vdist(p, self.start) < self.lead_start + self.req + self.h;
        let ne = vdist(p, self.end) < self.lead_end + self.req + self.h;
        let ra = pmin(pmin(1.0, vdist(p, self.a) / self.ramp_tt), vdist(p, self.b) / self.ramp_tt);
        self.point_free(p, ns, ne, ra, extra)
    }

    /// route()'s los: every los_step along p to q is free.
    pub fn los(&mut self, p: V3, q: V3, extra: f64) -> bool {
        let l = vdist(p, q);
        let n = ((l / self.los_step).ceil() as i64).max(1);
        let d = vsub(q, p);
        for i in 0..=n {
            if !self.free_at(vadd(p, vmul(d, i as f64 / n as f64)), extra) {
                return false;
            }
        }
        true
    }

    fn inside(&self, p: V3) -> bool {
        match self.semi {
            None => true,
            Some(semi) => vdist(p, self.a) + vdist(p, self.b) <= 2.0 * semi,
        }
    }

    #[inline]
    fn node_p(&self, n: Key) -> V3 {
        [self.a[0] + n.0 as f64 * self.h, self.a[1] + n.1 as f64 * self.h, self.a[2] + n.2 as f64 * self.h]
    }

    fn theta_star(&mut self, extra: f64, max_expand: i64, deadline: Option<Instant>) -> (Option<Vec<V3>>, i64) {
        let weight = 1.3;
        let (b, h) = (self.b, self.h);
        let start: Key = (0, 0, 0);
        let mut g: Map<Key, f64> = Map::default();
        let mut parent: Map<Key, Key> = Map::default();
        g.insert(start, 0.0);
        parent.insert(start, start);
        let mut open = BinaryHeap::new();
        open.push(Item { f: weight * vdist(self.a, b), c: 0, n: start });
        let mut closed: Set<Key> = Set::default();
        let mut free_cache: Map<Key, bool> = Map::default();
        let mut counter: u64 = 0;
        let mut expanded: i64 = 0;
        let nbs = self.nb;
        while let Some(Item { n: s, .. }) = open.pop() {
            if closed.contains(&s) {
                continue;
            }
            let ps = self.node_p(s);
            let par = parent[&s];
            if par != s && !self.los(self.node_p(par), ps, extra) {
                // Lazy Theta*: fall back to the best closed neighbour
                let mut best: Option<(f64, Key)> = None;
                for d in nbs {
                    let nb = (s.0 + d.0, s.1 + d.1, s.2 + d.2);
                    if closed.contains(&nb) {
                        let v = g[&nb] + h * ((d.0 * d.0 + d.1 * d.1 + d.2 * d.2) as f64).sqrt();
                        if best.map_or(true, |(bv, _)| v < bv) {
                            best = Some((v, nb));
                        }
                    }
                }
                let Some((bv, bp)) = best else { continue };
                g.insert(s, bv);
                parent.insert(s, bp);
            }
            closed.insert(s);
            expanded += 1;
            if vdist(ps, b) <= 1.75 * h && self.los(ps, b, extra) {
                let mut path = vec![b];
                let mut n = s;
                loop {
                    path.push(self.node_p(n));
                    let pn = parent[&n];
                    if pn == n {
                        break;
                    }
                    n = pn;
                }
                path.reverse();
                return (Some(path), expanded);
            }
            if expanded > max_expand || deadline.is_some_and(|d| Instant::now() > d) {
                break;
            }
            for d in nbs {
                let nb = (s.0 + d.0, s.1 + d.1, s.2 + d.2);
                if closed.contains(&nb) {
                    continue;
                }
                let free = match free_cache.get(&nb) {
                    Some(&v) => v,
                    None => {
                        let p = self.node_p(nb);
                        let v = self.inside(p) && self.free_at(p, extra);
                        free_cache.insert(nb, v);
                        v
                    }
                };
                if !free {
                    continue;
                }
                let pp = parent[&s];
                let gn = g[&pp] + vdist(self.node_p(pp), self.node_p(nb));
                if gn < g.get(&nb).copied().unwrap_or(1e30) {
                    g.insert(nb, gn);
                    parent.insert(nb, pp);
                    counter += 1;
                    open.push(Item { f: gn + weight * vdist(self.node_p(nb), b), c: counter, n: nb });
                }
            }
        }
        (None, expanded)
    }

    fn simplify(&mut self, path: Vec<V3>, extra: f64) -> Vec<V3> {
        if path.len() <= 2 {
            return path;
        }
        let mut out = vec![path[0]];
        let mut i = 0usize;
        while i < path.len() - 1 {
            let mut j = path.len() - 1;
            while j > i + 1 && !self.los(path[i], path[j], extra) {
                j -= 1;
            }
            out.push(path[j]);
            i = j;
        }
        out
    }

    /// route()'s search(): straight through if it can, else Lazy Theta* and the corners simplified.
    pub fn search(&mut self, extra: f64, max_expand: i64, deadline: Option<Instant>) -> (Option<Vec<V3>>, i64) {
        let (a, b) = (self.a, self.b);
        if self.los(a, b, extra) {
            return (Some(vec![a, b]), 0);
        }
        let (p, ex) = self.theta_star(extra, max_expand, deadline);
        match p {
            None => (None, ex),
            Some(p) => (Some(self.simplify(p, extra)), ex),
        }
    }

    // ------------------------------------------------------------ the fit

    /// _chain: the corner points from x = [a, b, corner, corner, ...].
    fn chain(&self, x: &[f64]) -> Vec<V3> {
        let mut q = Vec::with_capacity(4 + (x.len().saturating_sub(2)) / 3);
        q.push(self.start);
        q.push(vadd(self.start, vmul(self.start_dir, x[0])));
        for c in x[2..].chunks_exact(3) {
            q.push([c[0], c[1], c[2]]);
        }
        q.push(vsub(self.end, vmul(self.end_dir, x[1])));
        q.push(self.end);
        q
    }

    /// _residual_fn's fun(x).
    pub fn residual(&mut self, x: &[f64], fp: &Fit, out: &mut Vec<f64>) {
        out.clear();
        let rb = self.rb;
        let tmax = pmin(179.0, self.max_bend_deg) * DEG2RAD;
        let [wc, wf, wl, wb] = fp.w;
        let q = self.chain(x);
        let geo = chain_geometry(&q, rb, self.nm);
        let last = geo.avail.len() - 1;
        for (i, &a) in geo.avail.iter().enumerate() {
            let need = if i == 0 {
                self.lead_start
            } else if i == last {
                self.lead_end
            } else {
                self.min_straight
            };
            out.push(wf * pmax(0.0, need + 0.01 - a));
        }
        for i in 1..q.len() - 1 {
            out.push(wf * rb * pmax(0.0, geo.th[i] - tmax));
        }
        let total = geo.length;
        let mut samples = std::mem::take(&mut self.samples);
        sample_path(&geo.elems, total, fp.nsamp, &mut samples);
        let have_scan = !self.f_mid.is_null() && !self.f_s.is_null() && !self.f_e.is_null();
        let have_tt = !self.f_tt.is_null();
        for &(sp, p) in samples.iter() {
            // SAFETY: the fields outlive the Route (new); one thread.
            let ds = if have_scan {
                let f = match self.zone(sp, total) {
                    Zone::S => self.f_s,
                    Zone::E => self.f_e,
                    Zone::M => self.f_mid,
                };
                unsafe { (*f).eval(p) }
            } else {
                self.cap
            };
            out.push(wc * pmax(0.0, self.req + fp.margin - ds));
            if have_tt {
                let tt = unsafe { (*self.f_tt).eval(p) };
                if self.on_fixed_end(sp, total) {
                    out.push(0.0);
                } else {
                    out.push(wc * pmax(0.0, self.req_tt(sp, total, fp.margin) - tt));
                }
            }
        }
        // a trial centreline folded back on itself (no length) has no samples: zeros in their place keep the residuals
        // the same length from one trial to the next, which the fit's Jacobian needs
        for _ in samples.len()..fp.nsamp {
            out.push(0.0);
            if have_tt {
                out.push(0.0);
            }
        }
        self.samples = samples;
        match fp.target {
            Some(t) => out.push(wl * (total - t)),
            None => out.push(0.05 * total),
        }
        for i in 1..q.len() - 1 {
            out.push(wb * geo.th[i]);
        }
        if !fp.anchor.is_empty() {
            for &qi in q.iter().take(q.len().saturating_sub(2)).skip(2) {
                out.push(10.0 * pmax(0.0, poly_dist(qi, fp.anchor) - fp.d_anchor));
            }
        }
    }

    /// levenberg_marquardt on the residuals, with route()'s groups (the two straights alone, each corner's three
    /// numbers together) for step_max. Err when a residual changes length (it cannot: the sample count is fixed).
    pub fn lm(&mut self, x0: &[f64], fp: &Fit, iters: usize, step_max: Option<f64>, deadline: Option<Instant>) -> Result<(Vec<f64>, f64), String> {
        let hd = 1e-3;
        let nm = self.nm;
        let mut x = x0.to_vec();
        let n = x.len();
        if n < 2 || (n - 2) % 3 != 0 {
            return Err(format!("{} numbers is not two straights and whole corners", n));
        }
        let mut r = Vec::new();
        self.residual(&x, fp, &mut r);
        let m = r.len();
        let mut cost = psum(r.iter().map(|v| v * v), nm);
        let mut lam = 1e-3f64;
        let mut groups: Vec<Vec<usize>> = vec![vec![0], vec![1]];
        let mut i = 2;
        while i < n {
            groups.push(vec![i, i + 1, i + 2]);
            i += 3;
        }
        let mut rel = 0.0f64;
        let mut rj: Vec<f64> = Vec::with_capacity(m);
        let mut jac = vec![0.0f64; m * n];
        let mut nz: Vec<usize> = Vec::with_capacity(n);
        for _it in 0..iters {
            if deadline.is_some_and(|d| Instant::now() > d) {
                break;
            }
            for j in 0..n {
                let xj = x[j];
                x[j] = xj + hd;
                self.residual(&x, fp, &mut rj);
                x[j] = xj;
                if rj.len() != m {
                    return Err("the residuals changed length".into());
                }
                for i in 0..m {
                    jac[i * n + j] = (rj[i] - r[i]) / hd;
                }
            }
            let mut jtj = vec![0.0f64; n * n];
            let mut jtr = vec![0.0f64; n];
            for i in 0..m {
                let ji = &jac[i * n..(i + 1) * n];
                let ri = r[i];
                nz.clear();
                nz.extend((0..n).filter(|&j| ji[j] != 0.0));
                for &a in nz.iter() {
                    jtr[a] += ji[a] * ri;
                    let jia = ji[a];
                    for &b in nz.iter() {
                        jtj[a * n + b] += jia * ji[b];
                    }
                }
            }
            let mut improved = false;
            while lam < 1e10 {
                let mut am = jtj.clone();
                for j in 0..n {
                    am[j * n + j] += lam * (jtj[j * n + j] + 1e-6);
                }
                let rhs: Vec<f64> = jtr.iter().map(|v| -v).collect();
                let Some(mut dx) = solve(&am, &rhs, n, nm) else {
                    lam *= 10.0;
                    continue;
                };
                if let Some(sm) = step_max {
                    let mut big = 0.0f64;
                    for g in groups.iter() {
                        big = pmax(big, psum(g.iter().map(|&j| dx[j] * dx[j]), nm).sqrt());
                    }
                    if big > sm {
                        let s = sm / big;
                        for v in dx.iter_mut() {
                            *v *= s;
                        }
                    }
                }
                let xn: Vec<f64> = (0..n).map(|j| x[j] + dx[j]).collect();
                let mut rn = Vec::with_capacity(m);
                self.residual(&xn, fp, &mut rn);
                if rn.len() != m {
                    return Err("the residuals changed length".into());
                }
                let cn = psum(rn.iter().map(|v| v * v), nm);
                if cn < cost {
                    rel = (cost - cn) / pmax(cost, 1e-30);
                    x = xn;
                    r = rn;
                    cost = cn;
                    lam = pmax(lam * 0.3, 1e-9);
                    improved = true;
                    break;
                }
                lam *= 4.0;
            }
            if !improved || cost < 1e-12 || rel < 1e-7 {
                break;
            }
        }
        Ok((x, cost))
    }

    // ------------------------------------------------------------ the check

    /// certify: walk the finished centreline and prove the clearance with the exact triangles.
    pub fn certify(&mut self, x: &[f64]) -> Cert {
        let step_min = 0.01;
        let q = self.chain(x);
        let geo = chain_geometry(&q, self.rb, self.nm);
        let elems = &geo.elems;
        let total = psum(elems.iter().map(|e| e.len()), self.nm);
        let mut w = Cert { slack: 1e9, gap: 1e9, tt: 1e9, at: None, tt_at: None };
        if elems.is_empty() {
            return w;
        }
        let (mut pos, mut k, mut cum) = (0.0f64, 0usize, 0.0f64);
        let mut prev: Option<(f64, f64, f64)> = None;
        let have_scan = !self.scene.is_null();
        // SAFETY: valid for the Route's life (new); one thread.
        let e_cov = if have_scan { unsafe { (*self.scene).e_cover } } else { 0.0 };
        loop {
            while k < elems.len() - 1 && cum + elems[k].len() < pos {
                cum += elems[k].len();
                k += 1;
            }
            let e = &elems[k];
            let l = e.len();
            let f = if l <= 0.0 { 0.0 } else { pmin(1.0, pmax(0.0, (pos - cum) / l)) };
            let p = e.point(f);
            let z = self.zone(pos, total);
            let mut slack = 1e9;
            if have_scan {
                let sc = unsafe { &mut *self.scene };
                let planes = self.planes(z);
                let mut d = sc.dist_fast(p, self.cap, planes);
                if d - e_cov - self.req < 2.0 * step_min {
                    d = sc.dist_exact(p, self.cap, planes);
                } else {
                    d -= e_cov;
                }
                if z == Zone::M {
                    w.gap = pmin(w.gap, d - self.rt);
                }
                slack = d - self.req;
            }
            let mut tt = 1e9;
            if let Some(t) = unsafe { self.tubes.as_mut() } {
                tt = t.dist(p, self.cap, self.skip_a, self.skip_b) - self.req_tt(pos, total, 0.0);
                if self.on_fixed_end(pos, total) {
                    // fixed by the markers; only a real overlap (beyond touching) is reported
                    tt = if tt > -self.touch { pmax(tt, 0.0) } else { tt };
                }
            }
            let mut step = pmax(step_min, pmin(pmin(slack, if tt < 1e8 { tt } else { slack }), 5.0));
            if let Some((ps, ptt, pstep)) = prev {
                // 1-Lipschitz: between two samples the slack dips by at most half the spacing
                let between = (ps + slack - pstep) / 2.0;
                let between_tt = (ptt + tt - pstep) / 2.0;
                if between < w.slack {
                    w.slack = between;
                    w.at = Some(p);
                }
                if between_tt < w.tt {
                    w.tt = between_tt;
                    w.tt_at = Some(p);
                }
            }
            if pos >= total {
                break;
            }
            if total - pos > 1e-9 {
                step = pmin(step, total - pos);
            }
            prev = Some((slack, tt, step));
            pos = pmin(total, pos + step);
            if step <= 0.0 {
                break;
            }
        }
        w
    }
}

/// templates.fit_main_pipe's cost: the sum over the points of the squared distance from the cylinder (axis
/// direction a, through c, radius r), each capped at t squared, so a floor or bracket near the pipe counts little.
/// Added up in the points' order, as the Python does.
pub fn cyl_cost(pts: &[f64], a: V3, c: V3, r: f64, t: f64) -> f64 {
    let mut s = 0.0f64;
    for q in pts.chunks_exact(3) {
        let (w0, w1, w2) = (q[0] - c[0], q[1] - c[1], q[2] - c[2]);
        let tp = w0 * a[0] + w1 * a[1] + w2 * a[2];
        let res = pmax(0.0, w0 * w0 + w1 * w1 + w2 * w2 - tp * tp).sqrt() - r;
        s += if res * res < t * t { res * res } else { t * t };
    }
    s
}

/// A deadline from seconds left: None for no limit (NaN or very large), now for none left.
pub fn deadline_in(seconds: f64) -> Option<Instant> {
    if seconds.is_nan() || seconds > 1e7 {
        return None;
    }
    Some(Instant::now() + Duration::from_secs_f64(seconds.max(0.0)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn python_sum() {
        let v = [1.0, 1e100, 1.0, -1e100];
        assert_eq!(psum(v.iter().cloned(), true), 2.0);
        assert_eq!(psum(v.iter().cloned(), false), 0.0);
        assert_eq!(psum(std::iter::empty(), true), 0.0);
        assert!(psum([-0.0].iter().cloned(), true).is_sign_positive());
        assert_eq!(psum([0.1, 0.2, 0.3].iter().cloned(), false), 0.1 + 0.2 + 0.3);
    }

    #[test]
    fn solve_small() {
        // pivoting needed: the first pivot is zero
        let a = [0.0, 2.0, 1.0, 1.0, 1.0, 0.0, 2.0, 0.0, 3.0];
        let b = [5.0, 3.0, 8.0];
        let x = solve(&a, &b, 3, true).unwrap();
        for (i, row) in a.chunks(3).enumerate() {
            let s: f64 = row.iter().zip(&x).map(|(p, q)| p * q).sum();
            assert!((s - b[i]).abs() < 1e-12, "{:?}", x);
        }
        assert!(solve(&[1.0, 2.0, 2.0, 4.0], &[1.0, 2.0], 2, true).is_none());
    }

    #[test]
    fn right_angle_bend() {
        // 20 along x, 20 along y, bend radius 5: length 40 - 2 * 5 + 5 * pi / 2
        let q = [[0.0, 0.0, 0.0], [20.0, 0.0, 0.0], [20.0, 20.0, 0.0]];
        let g = chain_geometry(&q, 5.0, true);
        let want = 40.0 - 10.0 + 5.0 * std::f64::consts::FRAC_PI_2;
        assert!((g.length - want).abs() < 1e-12, "{}", g.length);
        assert_eq!(g.elems.len(), 3);
        let tot: f64 = g.elems.iter().map(|e| e.len()).sum();
        assert!((tot - want).abs() < 1e-12);
        // the arc's middle is 5 from its centre (15, 5) and on the diagonal
        let mid = g.elems[1].point(0.5);
        let r = ((mid[0] - 15.0).powi(2) + (mid[1] - 5.0).powi(2)).sqrt();
        assert!((r - 5.0).abs() < 1e-12 && (mid[0] - 15.0 - 5.0 / 2f64.sqrt()).abs() < 1e-12, "{:?}", mid);
        let mut s = Vec::new();
        sample_path(&g.elems, g.length, 10, &mut s);
        assert_eq!(s.len(), 10);
        assert!((s[0].0 - g.length / 20.0).abs() < 1e-12);
    }

    fn open_route() -> Route {
        // nothing to avoid: start at the origin heading +x, end at (40, 10, 0) heading +x
        let mut p = vec![0.0f64; NPARAMS];
        p[3] = 1.0; // start_dir
        p[6] = 40.0;
        p[7] = 10.0;
        p[9] = 1.0; // end_dir
        p[12] = 2.54;
        p[13] = 2.54;
        p[15] = 180.0;
        p[16] = 2.2;
        p[17] = 6.6;
        p[18] = 0.32;
        p[19] = 3.47;
        p[20] = 7.47;
        p[21] = 2.54 + 3.47;
        p[22] = 2.54 + 3.47;
        p[23] = 8.8;
        p[24] = 0.03;
        p[25] = 2.54;
        p[28] = 40.0 - 2.54;
        p[29] = 10.0;
        p[31] = 2.3;
        p[32] = f64::NAN;
        p[33] = 1.0;
        p[34] = 1.0;
        let pl = [Plane { o: [0.0; 3], n: [1.0, 0.0, 0.0], eps: 0.7 }, Plane { o: [40.0, 10.0, 0.0], n: [-1.0, 0.0, 0.0], eps: 0.7 }];
        let nullf = std::ptr::null_mut();
        unsafe { Route::new(std::ptr::null_mut(), std::ptr::null_mut(), i64::MIN, i64::MIN, [nullf; 4], &p, &pl).unwrap() }
    }

    #[test]
    fn open_space_route() {
        let mut r = open_route();
        let (p, ex) = r.search(0.0, 1000, None);
        assert_eq!(ex, 0);
        assert_eq!(p.unwrap().len(), 2);
        // an S from x = [a, b] and no corners would be straight; give it two corners and fit it short
        let x0 = vec![4.0, 4.0, 15.0, 0.0, 0.0, 25.0, 10.0, 0.0];
        let fit = Fit { target: None, margin: 0.1, w: [50.0, 50.0, 0.0, 0.3], anchor: &[], d_anchor: 6.0, nsamp: 60 };
        let (x, cost) = r.lm(&x0, &fit, 80, Some(2.3), None).unwrap();
        assert!(cost.is_finite() && x.len() == 8);
        let c = r.certify(&x);
        // nothing to hit: the slack stays near its 1e9 start (less half a step), and no gap or tube is found
        assert!(c.slack > 1e8 && c.gap == 1e9 && c.tt > 1e8, "{:?}", c);
        // the fit ran it straight-ish and short: no longer than the corners' polyline it started from
        let q = r.chain(&x);
        let g = chain_geometry(&q, 6.6, true);
        assert!(g.length < 45.0, "{}", g.length);
    }
}
