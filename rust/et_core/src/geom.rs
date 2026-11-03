//! Exact distances, written to match router.py operation for operation, so a query gives the same double
//! in Rust as in Python (same IEEE operations in the same order).

/// Squared distance from a point to a segment.
#[inline]
#[allow(clippy::too_many_arguments)]
pub fn seg_d2(px: f64, py: f64, pz: f64, ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64) -> f64 {
    let (ux, uy, uz) = (bx - ax, by - ay, bz - az);
    let (wx, wy, wz) = (px - ax, py - ay, pz - az);
    let uu = ux * ux + uy * uy + uz * uz;
    let mut t = if uu <= 0.0 { 0.0 } else { (wx * ux + wy * uy + wz * uz) / uu };
    if t < 0.0 {
        t = 0.0;
    } else if t > 1.0 {
        t = 1.0;
    }
    let (dx, dy, dz) = (wx - t * ux, wy - t * uy, wz - t * uz);
    dx * dx + dy * dy + dz * dz
}

/// Squared distance from a point to a triangle (Ericson, Real-Time Collision Detection, 5.1.5).
#[inline]
#[allow(clippy::too_many_arguments)]
pub fn tri_d2(
    px: f64, py: f64, pz: f64, ax: f64, ay: f64, az: f64, bx: f64, by: f64, bz: f64, cx: f64, cy: f64, cz: f64,
) -> f64 {
    let (abx, aby, abz) = (bx - ax, by - ay, bz - az);
    let (acx, acy, acz) = (cx - ax, cy - ay, cz - az);
    let (apx, apy, apz) = (px - ax, py - ay, pz - az);
    let d1 = abx * apx + aby * apy + abz * apz;
    let d2 = acx * apx + acy * apy + acz * apz;
    if d1 <= 0.0 && d2 <= 0.0 {
        return apx * apx + apy * apy + apz * apz;
    }
    let (bpx, bpy, bpz) = (px - bx, py - by, pz - bz);
    let d3 = abx * bpx + aby * bpy + abz * bpz;
    let d4 = acx * bpx + acy * bpy + acz * bpz;
    if d3 >= 0.0 && d4 <= d3 {
        return bpx * bpx + bpy * bpy + bpz * bpz;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        let den = d1 - d3;
        let v = if den != 0.0 { d1 / den } else { 0.0 };
        let (qx, qy, qz) = (ax + v * abx - px, ay + v * aby - py, az + v * abz - pz);
        return qx * qx + qy * qy + qz * qz;
    }
    let (cpx, cpy, cpz) = (px - cx, py - cy, pz - cz);
    let d5 = abx * cpx + aby * cpy + abz * cpz;
    let d6 = acx * cpx + acy * cpy + acz * cpz;
    if d6 >= 0.0 && d5 <= d6 {
        return cpx * cpx + cpy * cpy + cpz * cpz;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        let den = d2 - d6;
        let w = if den != 0.0 { d2 / den } else { 0.0 };
        let (qx, qy, qz) = (ax + w * acx - px, ay + w * acy - py, az + w * acz - pz);
        return qx * qx + qy * qy + qz * qz;
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        let den = (d4 - d3) + (d5 - d6);
        let w = if den != 0.0 { (d4 - d3) / den } else { 0.0 };
        let (qx, qy, qz) = (bx + w * (cx - bx) - px, by + w * (cy - by) - py, bz + w * (cz - bz) - pz);
        return qx * qx + qy * qy + qz * qz;
    }
    let den = va + vb + vc;
    if den == 0.0 {
        // degenerate (zero-area) triangle: nearest of its edges, in the same order as router.py's min()
        let e1 = seg_d2(px, py, pz, ax, ay, az, bx, by, bz);
        let e2 = seg_d2(px, py, pz, bx, by, bz, cx, cy, cz);
        let e3 = seg_d2(px, py, pz, ax, ay, az, cx, cy, cz);
        return py_min3(e1, e2, e3);
    }
    let v = vb / den;
    let w = vc / den;
    let qx = ax + abx * v + acx * w - px;
    let qy = ay + aby * v + acy * w - py;
    let qz = az + abz * v + acz * w - pz;
    qx * qx + qy * qy + qz * qz
}

/// Python's min(a, b, c): the first smallest (no NaN games).
#[inline]
fn py_min3(a: f64, b: f64, c: f64) -> f64 {
    let mut m = a;
    if b < m {
        m = b;
    }
    if c < m {
        m = c;
    }
    m
}

/// Python's int(math.floor(v)).
#[inline]
pub fn ifloor(v: f64) -> i64 {
    v.floor() as i64
}

/// A plane to ignore surface behind: points with (q - o) . n < eps are skipped.
#[derive(Clone, Copy, Debug)]
pub struct Plane {
    pub o: [f64; 3],
    pub n: [f64; 3],
    pub eps: f64,
}

impl Plane {
    /// router.py: (x - ox) * nx + (y - oy) * ny + (z - oz) * nz < eps
    #[inline]
    pub fn behind(&self, x: f64, y: f64, z: f64) -> bool {
        (x - self.o[0]) * self.n[0] + (y - self.o[1]) * self.n[1] + (z - self.o[2]) * self.n[2] < self.eps
    }
}

/// Planes from a flat list of 7 doubles each: ox, oy, oz, nx, ny, nz, eps.
pub fn planes_from(flat: &[f64]) -> Vec<Plane> {
    flat.chunks_exact(7)
        .map(|c| Plane { o: [c[0], c[1], c[2]], n: [c[3], c[4], c[5]], eps: c[6] })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn triangle_regions() {
        // the unit right triangle in z = 0; each Voronoi region of Ericson's test
        let t = |x: f64, y: f64, z: f64| tri_d2(x, y, z, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0);
        assert!((t(0.25, 0.25, 2.0) - 4.0).abs() < 1e-15); // face
        assert!((t(-1.0, -1.0, 0.0) - 2.0).abs() < 1e-15); // vertex a
        assert!((t(2.0, 0.0, 0.0) - 1.0).abs() < 1e-15); // vertex b
        assert!((t(0.0, 3.0, 0.0) - 4.0).abs() < 1e-15); // vertex c
        assert!((t(0.5, -2.0, 0.0) - 4.0).abs() < 1e-15); // edge ab
        assert!((t(1.0, 1.0, 0.0) - 0.5).abs() < 1e-15); // edge bc
        // a degenerate (zero-area) triangle falls back to its edges
        let d = tri_d2(0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0);
        assert!((d - 1.0).abs() < 1e-15);
    }
}
