//! The router's keep-out scene: triangles, points sampled on them in hashed cells, and the three queries the
//! router asks thousands of times (any point within r, nearest sampled point, nearest triangle). A line-for-line
//! port of router.py's Scene, so the answers are the same doubles.

use crate::geom::{ifloor, tri_d2, Plane};
use crate::hash::{Map, Set};
use crate::shells::shell;
use std::time::Instant;

pub type Key = (i64, i64, i64);

const SQ3: f64 = 1.732_050_807_568_877_2; // math.sqrt(3.0)

struct Mesh {
    coords: Vec<f64>,
    idx: Vec<i64>,
}

pub struct Scene {
    pub cell: f64,
    pub sample_len: f64,
    pub max_points: usize,
    meshes: Vec<Mesh>,
    pub built: bool,
    pub tol: f64,
    pub lo: [f64; 3],
    pub hi: [f64; 3],
    t: Vec<f64>,
    pub ntri: usize,
    cells: Vec<Vec<f64>>, // fine cells' sampled points (x, y, z, x, y, z, ...), in insertion order
    h: Map<Key, usize>,   // fine cell -> index in cells
    pub ccell: f64,
    cf: Map<Key, Vec<(usize, f64, f64, f64)>>, // coarse cell -> (fine cell, its corner x, y, z)
    hc: Set<Key>,
    th: Option<Map<Key, Vec<u32>>>,
    stamp: Vec<u32>,
    stamp_gen: u32,
    pub e_cover: f64,
    pub vox: f64,
    pub npoints: usize,
    pub build_time: f64,
}

impl Scene {
    pub fn new(cell: f64, sample_len: f64, max_points: usize) -> Scene {
        Scene {
            cell,
            sample_len,
            max_points,
            meshes: Vec::new(),
            built: false,
            tol: 0.0,
            lo: [0.0; 3],
            hi: [0.0; 3],
            t: Vec::new(),
            ntri: 0,
            cells: Vec::new(),
            h: Map::default(),
            ccell: 4.0 * cell,
            cf: Map::default(),
            hc: Set::default(),
            th: None,
            stamp: Vec::new(),
            stamp_gen: 0,
            e_cover: 0.0,
            vox: 0.0,
            npoints: 0,
            build_time: 0.0,
        }
    }

    pub fn add_mesh(&mut self, coords: &[f64], idx: &[i64], tol: f64) {
        if idx.len() >= 3 && coords.len() >= 9 {
            self.meshes.push(Mesh { coords: coords.to_vec(), idx: idx.to_vec() });
        }
        if tol > self.tol {
            self.tol = tol;
        }
        self.built = false;
    }

    fn put(&mut self, x: f64, y: f64, z: f64, seen: &mut Option<Set<Key>>) {
        if let Some(s) = seen.as_mut() {
            let vox = self.vox;
            let vk = (ifloor(x / vox), ifloor(y / vox), ifloor(z / vox));
            if !s.insert(vk) {
                return;
            }
        }
        let c = self.cell;
        let key = (ifloor(x / c), ifloor(y / c), ifloor(z / c));
        let n = self.cells.len();
        let i = *self.h.entry(key).or_insert(n);
        if i == n {
            self.cells.push(Vec::new());
        }
        let a = &mut self.cells[i];
        a.push(x);
        a.push(y);
        a.push(z);
    }

    pub fn build(&mut self, lo: [f64; 3], hi: [f64; 3], pad: f64) {
        let t0 = Instant::now();
        let lo = [lo[0] - pad, lo[1] - pad, lo[2] - pad];
        let hi = [hi[0] + pad, hi[1] + pad, hi[2] + pad];
        self.lo = lo;
        self.hi = hi;
        let ls = self.sample_len;
        let ls2 = ls * ls;
        let mut t: Vec<f64> = Vec::new();
        let mut small2 = 0.0f64;
        let mut big: Vec<(usize, f64)> = Vec::new();
        let mut marks: Vec<Vec<u8>> = Vec::with_capacity(self.meshes.len());
        let (lx, ly, lz) = (lo[0], lo[1], lo[2]);
        let (hx, hy, hz) = (hi[0], hi[1], hi[2]);
        for m in &self.meshes {
            let coords = &m.coords;
            let n = coords.len() / 3;
            let mut code = vec![0u8; n];
            for i in 0..n {
                let (x, y, z) = (coords[3 * i], coords[3 * i + 1], coords[3 * i + 2]);
                let mut c = 0u8;
                if x < lx {
                    c = 1;
                } else if x > hx {
                    c = 2;
                }
                if y < ly {
                    c |= 4;
                } else if y > hy {
                    c |= 8;
                }
                if z < lz {
                    c |= 16;
                } else if z > hz {
                    c |= 32;
                }
                code[i] = c;
            }
            let mut mark = vec![0u8; n];
            for tri in m.idx.chunks_exact(3) {
                let (i0, i1, i2) = (tri[0], tri[1], tri[2]);
                if i0 < 0 || i1 < 0 || i2 < 0 || i0 as usize >= n || i1 as usize >= n || i2 as usize >= n {
                    continue; // a broken index: router.py would stop with an error; leave the triangle out
                }
                let (i0, i1, i2) = (i0 as usize, i1 as usize, i2 as usize);
                if code[i0] & code[i1] & code[i2] != 0 {
                    continue; // all three corners outside on the same side
                }
                let (o0, o1, o2) = (3 * i0, 3 * i1, 3 * i2);
                let (ax, ay, az) = (coords[o0], coords[o0 + 1], coords[o0 + 2]);
                let (bx, by, bz) = (coords[o1], coords[o1 + 1], coords[o1 + 2]);
                let (cx, cy, cz) = (coords[o2], coords[o2 + 1], coords[o2 + 2]);
                let e1 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az);
                let e2 = (cx - bx) * (cx - bx) + (cy - by) * (cy - by) + (cz - bz) * (cz - bz);
                let e3 = (ax - cx) * (ax - cx) + (ay - cy) * (ay - cy) + (az - cz) * (az - cz);
                let mut em = if e1 > e2 { e1 } else { e2 };
                if e3 > em {
                    em = e3;
                }
                if em > ls2 {
                    big.push((t.len(), em.sqrt()));
                } else if em > small2 {
                    small2 = em;
                }
                t.extend_from_slice(&[ax, ay, az, bx, by, bz, cx, cy, cz]);
                mark[i0] = 1;
                mark[i1] = 1;
                mark[i2] = 1;
            }
            marks.push(mark);
        }
        self.ntri = t.len() / 9;
        let mut e_tri = small2.sqrt() / SQ3;
        let mut extra: usize = 0;
        for &(_o, lm) in &big {
            let k = (lm / ls).ceil();
            let v = lm / k / SQ3;
            if v > e_tri {
                e_tri = v;
            }
            let k = k as usize;
            extra += (k + 1) * (k + 2) / 2 - 3;
        }
        let nverts: usize = marks.iter().map(|m| m.iter().map(|&b| b as usize).sum::<usize>()).sum();
        let est = nverts + extra;
        let mut vox = 0.0f64;
        if est > self.max_points {
            // thin the points evenly; every dropped point is within a voxel diagonal of a kept one
            let mut area = 0.0f64;
            for o in (0..t.len()).step_by(9) {
                let (ux, uy, uz) = (t[o + 3] - t[o], t[o + 4] - t[o + 1], t[o + 5] - t[o + 2]);
                let (vx, vy, vz) = (t[o + 6] - t[o], t[o + 7] - t[o + 1], t[o + 8] - t[o + 2]);
                let (cx, cy, cz) = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
                area += 0.5 * (cx * cx + cy * cy + cz * cz).sqrt();
            }
            let s = (area / self.max_points as f64).sqrt();
            vox = if s > ls { s } else { ls };
        }
        self.vox = vox;
        self.e_cover = e_tri + (if vox > 0.0 { vox * SQ3 } else { 0.0 }) + self.tol;
        self.cells.clear();
        self.h = Map::default();
        let mut seen: Option<Set<Key>> = if vox > 0.0 { Some(Set::default()) } else { None };
        let meshes = std::mem::take(&mut self.meshes);
        for (m, mark) in meshes.iter().zip(marks.iter()) {
            for (i, &mk) in mark.iter().enumerate() {
                if mk != 0 {
                    let (x, y, z) = (m.coords[3 * i], m.coords[3 * i + 1], m.coords[3 * i + 2]);
                    self.put(x, y, z, &mut seen);
                }
            }
        }
        self.meshes = meshes;
        for &(o, lm) in &big {
            let k = (lm / ls).ceil() as i64;
            let (ax, ay, az, bx, by, bz, cx, cy, cz) =
                (t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5], t[o + 6], t[o + 7], t[o + 8]);
            for i in 0..=k {
                for j in 0..=(k - i) {
                    if (i == 0 && j == 0) || i == k || j == k {
                        continue; // the corners are already in
                    }
                    let u = i as f64 / k as f64;
                    let v = j as f64 / k as f64;
                    let w = 1.0 - u - v;
                    self.put(w * ax + u * bx + v * cx, w * ay + u * by + v * cy, w * az + u * bz + v * cz, &mut seen);
                }
            }
        }
        self.t = t;
        self.npoints = self.cells.iter().map(|a| a.len()).sum::<usize>() / 3;
        let c = self.cell;
        self.ccell = 4.0 * c;
        let cc = self.ccell;
        let mut cf: Map<Key, Vec<(usize, f64, f64, f64)>> = Map::default();
        let mut keys: Vec<(Key, usize)> = self.h.iter().map(|(k, &v)| (*k, v)).collect();
        keys.sort_by_key(|&(_k, v)| v); // router.py walks its dict in insertion order
        for (key, i) in keys {
            let ck = (
                ((key.0 as f64) * c / cc + 1e-9).floor() as i64,
                ((key.1 as f64) * c / cc + 1e-9).floor() as i64,
                ((key.2 as f64) * c / cc + 1e-9).floor() as i64,
            );
            cf.entry(ck).or_default().push((i, (key.0 as f64) * c, (key.1 as f64) * c, (key.2 as f64) * c));
        }
        self.hc = cf.keys().cloned().collect();
        self.cf = cf;
        self.th = None;
        self.stamp = vec![0u32; self.ntri];
        self.stamp_gen = 0;
        self.built = true;
        self.build_time = t0.elapsed().as_secs_f64();
    }

    fn coarse_empty(&self, p: [f64; 3], r: f64) -> bool {
        let cc = self.ccell;
        let (ix, iy, iz) = (ifloor(p[0] / cc), ifloor(p[1] / cc), ifloor(p[2] / cc));
        let kk = ((r / cc) as i64).saturating_add(1);
        for dx in -kk..=kk {
            for dy in -kk..=kk {
                for dz in -kk..=kk {
                    if self.hc.contains(&(ix + dx, iy + dy, iz + dz)) {
                        return false;
                    }
                }
            }
        }
        true
    }

    /// Is any sampled surface point within r of p (ignoring points behind the planes)? The same answer as
    /// router.py's walk over the fine cells (any_within_walk), found faster: coarse block by coarse block, skipping
    /// every block and cell whose box is farther than r (with a hair of slack, so rounding at a cell wall cannot
    /// skip a point at exactly r). Only the order of the search differs, and the answer does not depend on it.
    pub fn any_within(&self, p: [f64; 3], r: f64, planes: &[Plane]) -> bool {
        if !(0.0..1e6).contains(&r) {
            return self.any_within_walk(p, r, planes);
        }
        #[inline]
        fn gap(v: f64, lo: f64, w: f64) -> f64 {
            if v < lo {
                lo - v
            } else if v > lo + w {
                v - lo - w
            } else {
                0.0
            }
        }
        let cc = self.ccell;
        let c = self.cell;
        let (px, py, pz) = (p[0], p[1], p[2]);
        let r2 = r * r;
        let reach = r + 1e-6 * (1.0 + r);
        let reach2 = reach * reach;
        let (cx, cy, cz) = (ifloor(px / cc), ifloor(py / cc), ifloor(pz / cc));
        let kk = ((r / cc) as i64).saturating_add(2);
        for dx in -kk..=kk {
            let ex = gap(px, ((cx + dx) as f64) * cc, cc);
            let ex2 = ex * ex;
            if ex2 > reach2 {
                continue;
            }
            for dy in -kk..=kk {
                let ey = gap(py, ((cy + dy) as f64) * cc, cc);
                let exy2 = ex2 + ey * ey;
                if exy2 > reach2 {
                    continue;
                }
                for dz in -kk..=kk {
                    let ez = gap(pz, ((cz + dz) as f64) * cc, cc);
                    if exy2 + ez * ez > reach2 {
                        continue;
                    }
                    let Some(lst) = self.cf.get(&(cx + dx, cy + dy, cz + dz)) else { continue };
                    for &(ci, fx, fy, fz) in lst {
                        let (gx, gy, gz) = (gap(px, fx, c), gap(py, fy, c), gap(pz, fz, c));
                        if gx * gx + gy * gy + gz * gz > reach2 {
                            continue;
                        }
                        let a = &self.cells[ci];
                        for q in (0..a.len()).step_by(3) {
                            let (x, y, z) = (a[q], a[q + 1], a[q + 2]);
                            let (ex, ey, ez) = (x - px, y - py, z - pz);
                            if ex * ex + ey * ey + ez * ez <= r2 && !planes.iter().any(|pl| pl.behind(x, y, z)) {
                                return true;
                            }
                        }
                    }
                }
            }
        }
        false
    }

    /// The nearest any of the points comes, by the fast or the exact distance, capped: Python's
    /// min(dist(p, cap, planes) for p in pts). Infinity for no points (the Python raises; the caller checks).
    pub fn min_dist(&mut self, pts: &[f64], cap: f64, planes: &[Plane], exact: bool) -> f64 {
        let mut best = f64::INFINITY;
        for q in pts.chunks_exact(3) {
            let p = [q[0], q[1], q[2]];
            let d = if exact { self.dist_exact(p, cap, planes) } else { self.dist_fast(p, cap, planes) };
            if d < best {
                best = d;
            }
        }
        best
    }

    /// templates.clearance's walk: the smallest exact distance from the points, capped, and which point has it
    /// (None when none comes within cap). Each point's fast distance first; the exact one only when it could beat
    /// the best so far.
    pub fn nearest(&mut self, pts: &[f64], cap: f64, planes: &[Plane]) -> (f64, Option<usize>) {
        let mut best = cap;
        let mut at = None;
        let e = self.e_cover;
        for (i, q) in pts.chunks_exact(3).enumerate() {
            let p = [q[0], q[1], q[2]];
            if self.dist_fast(p, cap, planes) - e >= best {
                continue;
            }
            let g = self.dist_exact(p, cap, planes);
            if g < best {
                best = g;
                at = Some(i);
            }
        }
        (best, at)
    }

    /// router.py's any_within, step for step: the fine cells shell by shell out to r.
    pub fn any_within_walk(&self, p: [f64; 3], r: f64, planes: &[Plane]) -> bool {
        if self.coarse_empty(p, r) {
            return false;
        }
        let c = self.cell;
        let (px, py, pz) = (p[0], p[1], p[2]);
        let (ix, iy, iz) = (ifloor(px / c), ifloor(py / c), ifloor(pz / c));
        let r2 = r * r;
        let kmax = ((r / c) as i64).saturating_add(2);
        for k in 0..kmax {
            let sh = shell(k);
            for &(dx, dy, dz) in sh.iter() {
                let Some(&ci) = self.h.get(&(ix + dx, iy + dy, iz + dz)) else { continue };
                let a = &self.cells[ci];
                for q in (0..a.len()).step_by(3) {
                    let (x, y, z) = (a[q], a[q + 1], a[q + 2]);
                    let (ex, ey, ez) = (x - px, y - py, z - pz);
                    if ex * ex + ey * ey + ez * ez <= r2 {
                        if planes.iter().any(|pl| pl.behind(x, y, z)) {
                            continue;
                        }
                        return true;
                    }
                }
            }
        }
        false
    }

    /// Distance to the nearest sampled point, capped (router.py dist_fast).
    pub fn dist_fast(&self, p: [f64; 3], cap: f64, planes: &[Plane]) -> f64 {
        let cc = self.ccell;
        let c = self.cell;
        let (px, py, pz) = (p[0], p[1], p[2]);
        let (cx, cy, cz) = (ifloor(px / cc), ifloor(py / cc), ifloor(pz / cc));
        let mut best = cap * cap;
        let kk = ((cap / cc) as i64).saturating_add(1);
        for k in 0..=kk {
            let sh = shell(k);
            for &(dx, dy, dz) in sh.iter() {
                let ck = (cx + dx, cy + dy, cz + dz);
                let Some(lst) = self.cf.get(&ck) else { continue };
                let (x0, y0, z0) = ((ck.0 as f64) * cc, (ck.1 as f64) * cc, (ck.2 as f64) * cc);
                let ex = if px < x0 { x0 - px } else if px > x0 + cc { px - x0 - cc } else { 0.0 };
                let ey = if py < y0 { y0 - py } else if py > y0 + cc { py - y0 - cc } else { 0.0 };
                let ez = if pz < z0 { z0 - pz } else if pz > z0 + cc { pz - z0 - cc } else { 0.0 };
                if ex * ex + ey * ey + ez * ez >= best {
                    continue;
                }
                for &(ci, fx, fy, fz) in lst {
                    let ex = if px < fx { fx - px } else if px > fx + c { px - fx - c } else { 0.0 };
                    let ey = if py < fy { fy - py } else if py > fy + c { py - fy - c } else { 0.0 };
                    let ez = if pz < fz { fz - pz } else if pz > fz + c { pz - fz - c } else { 0.0 };
                    if ex * ex + ey * ey + ez * ez >= best {
                        continue;
                    }
                    let a = &self.cells[ci];
                    if planes.is_empty() {
                        for q in (0..a.len()).step_by(3) {
                            let ex = a[q] - px;
                            let ey = a[q + 1] - py;
                            let ez = a[q + 2] - pz;
                            let d2 = ex * ex + ey * ey + ez * ez;
                            if d2 < best {
                                best = d2;
                            }
                        }
                    } else {
                        for q in (0..a.len()).step_by(3) {
                            let (x, y, z) = (a[q], a[q + 1], a[q + 2]);
                            let (ex, ey, ez) = (x - px, y - py, z - pz);
                            let d2 = ex * ex + ey * ey + ez * ez;
                            if d2 >= best {
                                continue;
                            }
                            if !planes.iter().any(|pl| pl.behind(x, y, z)) {
                                best = d2;
                            }
                        }
                    }
                }
            }
            let r = (k as f64) * cc;
            if best <= r * r {
                break;
            }
        }
        best.sqrt()
    }

    fn build_tri_hash(&mut self) {
        let c = self.cell;
        let t = &self.t;
        let mut th: Map<Key, Vec<u32>> = Map::default();
        let (lx, ly, lz) = (ifloor(self.lo[0] / c), ifloor(self.lo[1] / c), ifloor(self.lo[2] / c));
        let (hx, hy, hz) = (ifloor(self.hi[0] / c), ifloor(self.hi[1] / c), ifloor(self.hi[2] / c));
        for tri in 0..self.ntri {
            let o = 9 * tri;
            let mn = |a: f64, b: f64, d: f64| {
                let mut m = a;
                if b < m {
                    m = b;
                }
                if d < m {
                    m = d;
                }
                m
            };
            let mx = |a: f64, b: f64, d: f64| {
                let mut m = a;
                if b > m {
                    m = b;
                }
                if d > m {
                    m = d;
                }
                m
            };
            let (mut x0, mut x1) = (ifloor(mn(t[o], t[o + 3], t[o + 6]) / c), ifloor(mx(t[o], t[o + 3], t[o + 6]) / c));
            let (mut y0, mut y1) =
                (ifloor(mn(t[o + 1], t[o + 4], t[o + 7]) / c), ifloor(mx(t[o + 1], t[o + 4], t[o + 7]) / c));
            let (mut z0, mut z1) =
                (ifloor(mn(t[o + 2], t[o + 5], t[o + 8]) / c), ifloor(mx(t[o + 2], t[o + 5], t[o + 8]) / c));
            if (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4096 {
                // a very large triangle: register it in the cells inside the scene box only
                x0 = x0.max(lx);
                x1 = x1.min(hx);
                y0 = y0.max(ly);
                y1 = y1.min(hy);
                z0 = z0.max(lz);
                z1 = z1.min(hz);
            }
            for i in x0..=x1 {
                for j in y0..=y1 {
                    for k in z0..=z1 {
                        th.entry((i, j, k)).or_default().push(tri as u32);
                    }
                }
            }
        }
        self.th = Some(th);
    }

    /// Distance to the nearest triangle, capped, less the tessellation tolerance (router.py dist_exact).
    pub fn dist_exact(&mut self, p: [f64; 3], cap: f64, planes: &[Plane]) -> f64 {
        if self.th.is_none() {
            self.build_tri_hash();
        }
        self.stamp_gen = self.stamp_gen.wrapping_add(1);
        if self.stamp_gen == 0 {
            self.stamp.iter_mut().for_each(|s| *s = 0);
            self.stamp_gen = 1;
        }
        let gen = self.stamp_gen;
        let c = self.cell;
        let (px, py, pz) = (p[0], p[1], p[2]);
        let (ix, iy, iz) = (ifloor(px / c), ifloor(py / c), ifloor(pz / c));
        let mut best = cap * cap;
        let kmax = ((cap / c) as i64).saturating_add(1);
        let th = self.th.as_ref().unwrap();
        let t = &self.t;
        for k in 0..=kmax {
            let sh = shell(k);
            for &(dx, dy, dz) in sh.iter() {
                let Some(lst) = th.get(&(ix + dx, iy + dy, iz + dz)) else { continue };
                for &tri in lst {
                    let tu = tri as usize;
                    if self.stamp[tu] == gen {
                        continue;
                    }
                    self.stamp[tu] = gen;
                    let o = 9 * tu;
                    if !planes.is_empty() {
                        // keep the triangle if any corner is in front of every plane
                        let keep = (0..3).any(|q| {
                            let (x, y, z) = (t[o + 3 * q], t[o + 3 * q + 1], t[o + 3 * q + 2]);
                            !planes.iter().any(|pl| pl.behind(x, y, z))
                        });
                        if !keep {
                            continue;
                        }
                    }
                    let d2 = tri_d2(px, py, pz, t[o], t[o + 1], t[o + 2], t[o + 3], t[o + 4], t[o + 5], t[o + 6], t[o + 7], t[o + 8]);
                    if d2 < best {
                        best = d2;
                    }
                }
            }
            let r = (k as f64) * c;
            if best <= r * r {
                break;
            }
        }
        let d = best.sqrt() - self.tol;
        if d > 0.0 {
            d
        } else {
            0.0
        }
    }

    /// Sampled points within rad of c, in the order router.py's dict walk would give them.
    pub fn points_near(&self, c: [f64; 3], rad: f64) -> Vec<f64> {
        let cell = self.cell;
        let lo: Vec<i64> = (0..3).map(|k| ifloor((c[k] - rad) / cell)).collect();
        let hi: Vec<i64> = (0..3).map(|k| ifloor((c[k] + rad) / cell)).collect();
        let r2 = rad * rad;
        let mut out = Vec::new();
        for i in lo[0]..=hi[0] {
            for j in lo[1]..=hi[1] {
                for k in lo[2]..=hi[2] {
                    let Some(&ci) = self.h.get(&(i, j, k)) else { continue };
                    let a = &self.cells[ci];
                    for q in (0..a.len()).step_by(3) {
                        let (x, y, z) = (a[q], a[q + 1], a[q + 2]);
                        if (x - c[0]) * (x - c[0]) + (y - c[1]) * (y - c[1]) + (z - c[2]) * (z - c[2]) <= r2 {
                            out.extend_from_slice(&[x, y, z]);
                        }
                    }
                }
            }
        }
        out
    }

    /// Every sampled point, cell by cell in insertion order.
    pub fn all_points(&self) -> Vec<f64> {
        let mut out = Vec::with_capacity(self.npoints * 3);
        for a in &self.cells {
            out.extend_from_slice(a);
        }
        out
    }
}
