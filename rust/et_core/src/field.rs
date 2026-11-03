//! router.py's Field: a distance function sampled lazily on a grid of spacing g and blended between the eight
//! grid points round a query (trilinear), with the grid values cached. The function is either the scene's fast
//! distance (with its ignore planes) or the tube set's distance (with the owners to leave out).

use crate::geom::{ifloor, Plane};
use crate::hash::Map;
use crate::scene::Scene;
use crate::tubes::Tubes;

pub enum Source {
    Scene { scene: *const Scene, cap: f64, planes: Vec<Plane> },
    Tubes { tubes: *mut Tubes, cap: f64, skip_a: i64, skip_b: i64 },
}

pub struct Field {
    pub g: f64,
    cache: Map<(i64, i64, i64), f64>,
    src: Source,
}

impl Field {
    pub fn new(g: f64, src: Source) -> Field {
        Field { g, cache: Map::default(), src }
    }

    fn eval_fn(&self, p: [f64; 3]) -> f64 {
        // SAFETY: the Python side keeps the scene or tube set alive as long as the field (it holds a reference),
        // and everything runs on Fusion's one thread.
        match &self.src {
            Source::Scene { scene, cap, planes } => unsafe { (**scene).dist_fast(p, *cap, planes) },
            Source::Tubes { tubes, cap, skip_a, skip_b } => unsafe { (**tubes).dist(p, *cap, *skip_a, *skip_b) },
        }
    }

    #[inline]
    fn node(&mut self, i: i64, j: i64, k: i64) -> f64 {
        if let Some(&v) = self.cache.get(&(i, j, k)) {
            return v;
        }
        let g = self.g;
        let v = self.eval_fn([(i as f64) * g, (j as f64) * g, (k as f64) * g]);
        self.cache.insert((i, j, k), v);
        v
    }

    /// The blended value at p, in router.py's order of operations.
    pub fn eval(&mut self, p: [f64; 3]) -> f64 {
        let g = self.g;
        let (x, y, z) = (p[0] / g, p[1] / g, p[2] / g);
        let (i, j, k) = (ifloor(x), ifloor(y), ifloor(z));
        let (fx, fy, fz) = (x - i as f64, y - j as f64, z - k as f64);
        let c00 = self.node(i, j, k) * (1.0 - fx) + self.node(i + 1, j, k) * fx;
        let c10 = self.node(i, j + 1, k) * (1.0 - fx) + self.node(i + 1, j + 1, k) * fx;
        let c01 = self.node(i, j, k + 1) * (1.0 - fx) + self.node(i + 1, j, k + 1) * fx;
        let c11 = self.node(i, j + 1, k + 1) * (1.0 - fx) + self.node(i + 1, j + 1, k + 1) * fx;
        let c0 = c00 * (1.0 - fy) + c10 * fy;
        let c1 = c01 * (1.0 - fy) + c11 * fy;
        c0 * (1.0 - fz) + c1 * fz
    }

    pub fn cached(&self) -> usize {
        self.cache.len()
    }
}
