//! Tubes already laid out (other primaries) as centreline segments with radii: router.py's TubeSet, with the
//! owners as integers (the Python side numbers whatever owner objects it is given).

use crate::geom::{ifloor, seg_d2};
use crate::hash::Map;
use crate::shells::shell;

/// No owner to skip.
pub const NONE: i64 = i64::MIN;

pub struct Tubes {
    pub cell: f64,
    h: Map<(i64, i64, i64), Vec<u32>>,
    blocks: Map<(i64, i64, i64), Vec<u32>>, // the same segments in blocks 4 cells a side, for dist
    segs: Vec<([f64; 3], [f64; 3], f64, i64)>,
    pub rmax: f64,
    stamp: Vec<u32>,
    stamp_gen: u32,
}

impl Tubes {
    pub fn new(cell: f64) -> Tubes {
        Tubes { cell, h: Map::default(), blocks: Map::default(), segs: Vec::new(), rmax: 0.0, stamp: Vec::new(), stamp_gen: 0 }
    }

    pub fn len(&self) -> usize {
        self.segs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.segs.is_empty()
    }

    pub fn add_polyline(&mut self, pts: &[[f64; 3]], radius: f64, owner: i64) {
        let c = self.cell;
        let bc = 4.0 * c;
        for w in pts.windows(2) {
            let (a, b) = (w[0], w[1]);
            let sid = self.segs.len() as u32;
            self.segs.push((a, b, radius, owner));
            self.stamp.push(0);
            let lo = [a[0].min(b[0]), a[1].min(b[1]), a[2].min(b[2])];
            let hi = [a[0].max(b[0]), a[1].max(b[1]), a[2].max(b[2])];
            for x in ifloor(lo[0] / c)..=ifloor(hi[0] / c) {
                for y in ifloor(lo[1] / c)..=ifloor(hi[1] / c) {
                    for z in ifloor(lo[2] / c)..=ifloor(hi[2] / c) {
                        self.h.entry((x, y, z)).or_default().push(sid);
                    }
                }
            }
            for x in ifloor(lo[0] / bc)..=ifloor(hi[0] / bc) {
                for y in ifloor(lo[1] / bc)..=ifloor(hi[1] / bc) {
                    for z in ifloor(lo[2] / bc)..=ifloor(hi[2] / bc) {
                        self.blocks.entry((x, y, z)).or_default().push(sid);
                    }
                }
            }
        }
        if radius > self.rmax {
            self.rmax = radius;
        }
    }

    fn next_gen(&mut self) -> u32 {
        self.stamp_gen = self.stamp_gen.wrapping_add(1);
        if self.stamp_gen == 0 {
            self.stamp.iter_mut().for_each(|s| *s = 0);
            self.stamp_gen = 1;
        }
        self.stamp_gen
    }

    /// Smallest (distance to a centreline - that tube's radius), capped, leaving out the owners skip_a and skip_b:
    /// router.py's TubeSet.dist. Its walk (dist_walk) gives min(cap, the smallest over every segment left in), since
    /// a segment it never reaches is farther than cap and it stops only when no farther segment can be nearer; this
    /// finds the same minimum over blocks of 4 cells, nearest shells first, skipping a block whose box is farther
    /// than the best so far (a segment's nearest point lies in a block it is listed in, and that block is not
    /// skipped while the segment could still be nearer).
    pub fn dist(&mut self, p: [f64; 3], cap: f64, skip_a: i64, skip_b: i64) -> f64 {
        if self.segs.is_empty() {
            return cap;
        }
        let bc = 4.0 * self.cell;
        let kb_f = (cap + self.rmax) / bc;
        if !(0.0..64.0).contains(&kb_f) {
            return self.dist_walk(p, cap, skip_a, skip_b);
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
        let gen = self.next_gen();
        let (px, py, pz) = (p[0], p[1], p[2]);
        let (bx, by, bz) = (ifloor(px / bc), ifloor(py / bc), ifloor(pz / bc));
        let kb = (kb_f as i64).saturating_add(1);
        let rmax = self.rmax;
        let slack = 1e-9 * (1.0 + cap + rmax);
        let mut best = cap;
        for k in 0..=kb {
            let sh = shell(k);
            for &(dx, dy, dz) in sh.iter() {
                let key = (bx + dx, by + dy, bz + dz);
                let (gx, gy, gz) =
                    (gap(px, (key.0 as f64) * bc, bc), gap(py, (key.1 as f64) * bc, bc), gap(pz, (key.2 as f64) * bc, bc));
                let reach = best + rmax + slack;
                if gx * gx + gy * gy + gz * gz > reach * reach {
                    continue;
                }
                let Some(lst) = self.blocks.get(&key) else { continue };
                for &sid in lst {
                    let si = sid as usize;
                    if self.stamp[si] == gen {
                        continue;
                    }
                    self.stamp[si] = gen;
                    let (a, b, r, owner) = self.segs[si];
                    if (skip_a != NONE && owner == skip_a) || (skip_b != NONE && owner == skip_b) {
                        continue;
                    }
                    let d = seg_d2(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2]).sqrt() - r;
                    if d < best {
                        best = d;
                    }
                }
            }
            // every block not yet seen is more than k blocks away: nothing in it can be nearer
            if best + slack <= (k as f64) * bc - rmax {
                break;
            }
        }
        best
    }

    /// router.py's walk, step for step: cells shell by shell until no farther segment can be nearer.
    pub fn dist_walk(&mut self, p: [f64; 3], cap: f64, skip_a: i64, skip_b: i64) -> f64 {
        if self.segs.is_empty() {
            return cap;
        }
        let gen = self.next_gen();
        let c = self.cell;
        let (px, py, pz) = (p[0], p[1], p[2]);
        let (ix, iy, iz) = (ifloor(px / c), ifloor(py / c), ifloor(pz / c));
        let mut best = cap;
        let kmax = (((cap + self.rmax) / c) as i64).saturating_add(1);
        for k in 0..=kmax {
            let sh = shell(k);
            for &(dx, dy, dz) in sh.iter() {
                let Some(lst) = self.h.get(&(ix + dx, iy + dy, iz + dz)) else { continue };
                for &sid in lst {
                    let si = sid as usize;
                    if self.stamp[si] == gen {
                        continue;
                    }
                    self.stamp[si] = gen;
                    let (a, b, r, owner) = self.segs[si];
                    if (skip_a != NONE && owner == skip_a) || (skip_b != NONE && owner == skip_b) {
                        continue;
                    }
                    let d = seg_d2(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2]).sqrt() - r;
                    if d < best {
                        best = d;
                    }
                }
            }
            if best <= (k as f64) * c - self.rmax {
                break;
            }
        }
        best
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_and_skip() {
        let mut t = Tubes::new(2.0);
        t.add_polyline(&[[0.0, 0.0, 0.0], [10.0, 0.0, 0.0]], 1.0, 7);
        t.add_polyline(&[[0.0, 5.0, 0.0], [10.0, 5.0, 0.0]], 1.0, 8);
        let d = t.dist([5.0, 2.0, 0.0], 20.0, NONE, NONE);
        assert!((d - 1.0).abs() < 1e-12);
        let d7 = t.dist([5.0, 2.0, 0.0], 20.0, 7, NONE);
        assert!((d7 - 2.0).abs() < 1e-12);
        assert_eq!(t.dist([5.0, 2.0, 0.0], 20.0, 7, 8), 20.0);
    }

    #[test]
    fn blocks_match_the_walk() {
        let mut seed = 99u64;
        let mut rnd = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((seed >> 11) as f64) / ((1u64 << 53) as f64)
        };
        let mut t = Tubes::new(2.0);
        for o in 0..8 {
            let mut pts = Vec::new();
            let mut q = [rnd() * 40.0 - 20.0, rnd() * 40.0 - 20.0, rnd() * 40.0 - 20.0];
            for _ in 0..60 {
                pts.push(q);
                q = [q[0] + rnd() - 0.5, q[1] + rnd() - 0.5, q[2] + rnd() - 0.5];
            }
            t.add_polyline(&pts, 1.5 + 0.1 * o as f64, o);
        }
        let mut differ = 0;
        for i in 0..20000 {
            let p = [rnd() * 50.0 - 25.0, rnd() * 50.0 - 25.0, rnd() * 50.0 - 25.0];
            let cap = [3.0, 7.0, 12.0][i % 3];
            let (sa, sb) = [(NONE, NONE), (2, NONE), (3, 5)][i % 3];
            if t.dist(p, cap, sa, sb).to_bits() != t.dist_walk(p, cap, sa, sb).to_bits() {
                differ += 1;
            }
        }
        assert_eq!(differ, 0);
    }
}
