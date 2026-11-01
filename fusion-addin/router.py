"""Tube router for Exhaust Tuner: lays out bendable tubes through a scanned space.

Pure Python (no numpy), so it runs inside Fusion's own Python. Units are whatever the caller
uses consistently; the add-in passes centimetres, Fusion's internal unit.

What it does
  Scene        Holds the keep-out surfaces as triangles (a raw scan mesh, or tessellated solid
               bodies). Answers "how far is this point from the nearest surface" two ways:
               fast, from points sampled on the surfaces (never more than e_cover too far), and
               exact, from the triangles themselves.
  TubeSet      Tubes already laid out (other primaries), as centreline segments with radii.
  route()      One tube from a start (point and direction) to an end (point and direction):
               a lattice search for a way through (Lazy Theta*), then a least-squares fit
               (Levenberg-Marquardt) of a polyline whose corners are rounded to the bender's
               centreline radius, so the tube keeps the clearance you ask for, every straight
               between bends is at least the minimum, the bends stay under the maximum angle,
               and (when asked) the centreline length hits the target. The result is then
               checked against the exact triangles all along its length.
  route_header()   Several primaries into one collector: slots around the collector axis,
               equal target length, tubes kept apart from each other.
  place_part() / route_with_parts()   Off-the-shelf parts (muffler, resonator, flex, cat) placed
               along a route where their case clears the scan, then the pipes routed to them.

Clearance model
  The tube is a swept sphere: a centreline point p is clear when every surface point is at
  least R + gap from p (R = outside radius). That is exactly "the tube surface is at least
  gap from the surface", except at the open ends where it is conservative.
  Near the start and end, surface behind the mounting face (the head flange face, the
  collector) is ignored for the first lead + R + gap of the tube, because the tube attaches
  there. Everything else counts.
"""
import math
import heapq
import time
from array import array

SQ3 = math.sqrt(3.0)


# --------------------------------------------------------------------------
# Vector helpers on 3-tuples
# --------------------------------------------------------------------------

def vadd(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vmul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def vdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vcross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def vlen(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def vunit(a):
    n = vlen(a)
    if n < 1e-12:
        return (0.0, 0.0, 0.0)
    return (a[0] / n, a[1] / n, a[2] / n)


def vdist(a, b):
    return vlen(vsub(a, b))


def perp_basis(u):
    """Two unit vectors at right angles to u and to each other."""
    a = (1.0, 0.0, 0.0) if abs(u[0]) < 0.9 else (0.0, 1.0, 0.0)
    e1 = vunit(vcross(u, a))
    e2 = vcross(u, e1)
    return e1, e2


def angle_between(a, b):
    c = vdot(vunit(a), vunit(b))
    return math.acos(max(-1.0, min(1.0, c)))


# --------------------------------------------------------------------------
# Exact distances
# --------------------------------------------------------------------------

def seg_d2(px, py, pz, ax, ay, az, bx, by, bz):
    """Squared distance from a point to a segment."""
    ux, uy, uz = bx - ax, by - ay, bz - az
    wx, wy, wz = px - ax, py - ay, pz - az
    uu = ux * ux + uy * uy + uz * uz
    t = 0.0 if uu <= 0.0 else (wx * ux + wy * uy + wz * uz) / uu
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    dx, dy, dz = wx - t * ux, wy - t * uy, wz - t * uz
    return dx * dx + dy * dy + dz * dz


def tri_d2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz):
    """Squared distance from a point to a triangle (Ericson, Real-Time Collision Detection, 5.1.5)."""
    abx, aby, abz = bx - ax, by - ay, bz - az
    acx, acy, acz = cx - ax, cy - ay, cz - az
    apx, apy, apz = px - ax, py - ay, pz - az
    d1 = abx * apx + aby * apy + abz * apz
    d2 = acx * apx + acy * apy + acz * apz
    if d1 <= 0.0 and d2 <= 0.0:
        return apx * apx + apy * apy + apz * apz
    bpx, bpy, bpz = px - bx, py - by, pz - bz
    d3 = abx * bpx + aby * bpy + abz * bpz
    d4 = acx * bpx + acy * bpy + acz * bpz
    if d3 >= 0.0 and d4 <= d3:
        return bpx * bpx + bpy * bpy + bpz * bpz
    vc = d1 * d4 - d3 * d2
    if vc <= 0.0 and d1 >= 0.0 and d3 <= 0.0:
        den = d1 - d3
        v = d1 / den if den != 0.0 else 0.0
        qx, qy, qz = ax + v * abx - px, ay + v * aby - py, az + v * abz - pz
        return qx * qx + qy * qy + qz * qz
    cpx, cpy, cpz = px - cx, py - cy, pz - cz
    d5 = abx * cpx + aby * cpy + abz * cpz
    d6 = acx * cpx + acy * cpy + acz * cpz
    if d6 >= 0.0 and d5 <= d6:
        return cpx * cpx + cpy * cpy + cpz * cpz
    vb = d5 * d2 - d1 * d6
    if vb <= 0.0 and d2 >= 0.0 and d6 <= 0.0:
        den = d2 - d6
        w = d2 / den if den != 0.0 else 0.0
        qx, qy, qz = ax + w * acx - px, ay + w * acy - py, az + w * acz - pz
        return qx * qx + qy * qy + qz * qz
    va = d3 * d6 - d5 * d4
    if va <= 0.0 and (d4 - d3) >= 0.0 and (d5 - d6) >= 0.0:
        den = (d4 - d3) + (d5 - d6)
        w = (d4 - d3) / den if den != 0.0 else 0.0
        qx, qy, qz = bx + w * (cx - bx) - px, by + w * (cy - by) - py, bz + w * (cz - bz) - pz
        return qx * qx + qy * qy + qz * qz
    den = va + vb + vc
    if den == 0.0:      # degenerate (zero-area) triangle: nearest of its edges
        return min(seg_d2(px, py, pz, ax, ay, az, bx, by, bz), seg_d2(px, py, pz, bx, by, bz, cx, cy, cz),
                   seg_d2(px, py, pz, ax, ay, az, cx, cy, cz))
    v = vb / den
    w = vc / den
    qx = ax + abx * v + acx * w - px
    qy = ay + aby * v + acy * w - py
    qz = az + abz * v + acz * w - pz
    return qx * qx + qy * qy + qz * qz


_SHELLS = {}


def _shell(k):
    """Cell offsets at Chebyshev distance exactly k."""
    s = _SHELLS.get(k)
    if s is None:
        if k == 0:
            s = [(0, 0, 0)]
        else:
            s = []
            for dx in range(-k, k + 1):
                for dy in range(-k, k + 1):
                    if abs(dx) == k or abs(dy) == k:
                        for dz in range(-k, k + 1):
                            s.append((dx, dy, dz))
                    else:
                        s.append((dx, dy, -k))
                        s.append((dx, dy, k))
        _SHELLS[k] = s
    return s


# --------------------------------------------------------------------------
# Scene: keep-out surfaces
# --------------------------------------------------------------------------

class Scene(object):
    """Keep-out surfaces as triangles.

    add_mesh(coords, indices): coords is a flat list x0, y0, z0, x1, ... ; indices a flat list of
    three node numbers per triangle (Fusion's TriangleMesh.nodeCoordinatesAsDouble and
    nodeIndices). tol is how far the triangles may be from the real surface (the tessellation
    tolerance for solid bodies; 0 for a scan, which is the surface).
    build(lo, hi, pad) keeps only triangles that can matter inside the box lo..hi grown by pad.
    """

    def __init__(self, cell=1.0, sample_len=0.3, max_points=1500000):
        self.cell = float(cell)
        self.sample_len = float(sample_len)
        self.max_points = int(max_points)
        self.meshes = []
        self.built = False
        self.tol = 0.0

    def add_mesh(self, coords, indices, tol=0.0, name='mesh'):
        if len(indices) >= 3 and len(coords) >= 9:
            self.meshes.append((coords, indices, float(tol), name))
        self.tol = max(self.tol, float(tol))
        self.built = False

    def build(self, lo, hi, pad):
        t0 = time.time()
        lo = (lo[0] - pad, lo[1] - pad, lo[2] - pad)
        hi = (hi[0] + pad, hi[1] + pad, hi[2] + pad)
        self.lo, self.hi = lo, hi
        T = array('d')
        ls = self.sample_len
        ls2 = ls * ls
        small2 = 0.0            # longest edge (squared) among triangles that need no extra points
        big = []                # triangles with an edge longer than the sample length: (offset in T, longest edge)
        marks = []
        lx, ly, lz = lo
        hx, hy, hz = hi
        for coords, idx, _tol, _name in self.meshes:
            n = len(coords) // 3
            code = bytearray(n)
            for i in range(n):
                x = coords[3 * i]
                y = coords[3 * i + 1]
                z = coords[3 * i + 2]
                c = 0
                if x < lx:
                    c = 1
                elif x > hx:
                    c = 2
                if y < ly:
                    c |= 4
                elif y > hy:
                    c |= 8
                if z < lz:
                    c |= 16
                elif z > hz:
                    c |= 32
                code[i] = c
            mark = bytearray(n)
            m = len(idx) // 3
            for t in range(m):
                i0 = idx[3 * t]
                i1 = idx[3 * t + 1]
                i2 = idx[3 * t + 2]
                if code[i0] & code[i1] & code[i2]:
                    continue                    # all three corners outside on the same side
                o0, o1, o2 = 3 * i0, 3 * i1, 3 * i2
                ax, ay, az = coords[o0], coords[o0 + 1], coords[o0 + 2]
                bx, by, bz = coords[o1], coords[o1 + 1], coords[o1 + 2]
                cx, cy, cz = coords[o2], coords[o2 + 1], coords[o2 + 2]
                e1 = (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2
                e2 = (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2
                e3 = (ax - cx) ** 2 + (ay - cy) ** 2 + (az - cz) ** 2
                em = e1 if e1 > e2 else e2
                if e3 > em:
                    em = e3
                if em > ls2:
                    big.append((len(T), math.sqrt(em)))
                elif em > small2:
                    small2 = em
                T.extend((ax, ay, az, bx, by, bz, cx, cy, cz))
                mark[i0] = 1
                mark[i1] = 1
                mark[i2] = 1
            marks.append((coords, mark))
        self.T = T
        self.ntri = len(T) // 9
        e_tri = math.sqrt(small2) / SQ3
        extra = 0
        for o, lm in big:
            k = int(math.ceil(lm / ls))
            e_tri = max(e_tri, lm / k / SQ3)
            extra += (k + 1) * (k + 2) // 2 - 3
        nverts = sum(sum(mk) for _c, mk in marks)
        est = nverts + extra
        vox = 0.0
        if est > self.max_points:
            # thin the points evenly; every dropped point is within a voxel diagonal of a kept one
            area = 0.0
            for t in range(self.ntri):
                o = 9 * t
                ux, uy, uz = T[o + 3] - T[o], T[o + 4] - T[o + 1], T[o + 5] - T[o + 2]
                vx, vy, vz = T[o + 6] - T[o], T[o + 7] - T[o + 1], T[o + 8] - T[o + 2]
                area += 0.5 * math.sqrt((uy * vz - uz * vy) ** 2 + (uz * vx - ux * vz) ** 2 + (ux * vy - uy * vx) ** 2)
            vox = max(ls, math.sqrt(area / float(self.max_points)))
        self.vox = vox
        self.e_cover = e_tri + (vox * SQ3 if vox > 0 else 0.0) + self.tol
        c = self.cell
        H = {}
        fl = math.floor
        seen = set() if vox > 0 else None

        def put(x, y, z):
            if seen is not None:
                vk = (int(fl(x / vox)), int(fl(y / vox)), int(fl(z / vox)))
                if vk in seen:
                    return
                seen.add(vk)
            key = (int(fl(x / c)), int(fl(y / c)), int(fl(z / c)))
            a = H.get(key)
            if a is None:
                a = H[key] = array('d')
            a.append(x)
            a.append(y)
            a.append(z)

        for coords, mark in marks:
            for i in range(len(mark)):
                if mark[i]:
                    put(coords[3 * i], coords[3 * i + 1], coords[3 * i + 2])
        for o, lm in big:
            k = int(math.ceil(lm / ls))
            ax, ay, az, bx, by, bz, cx, cy, cz = T[o:o + 9]
            for i in range(k + 1):
                for j in range(k + 1 - i):
                    if (i == 0 and j == 0) or (i == k) or (j == k):
                        continue                # the corners are already in
                    u = i / float(k)
                    v = j / float(k)
                    w = 1.0 - u - v
                    put(w * ax + u * bx + v * cx, w * ay + u * by + v * cy, w * az + u * bz + v * cz)
        self.H = H
        self.npoints = sum(len(a) for a in H.values()) // 3
        self.ccell = 4.0 * c
        cc = self.ccell
        CF = {}
        for key, a in H.items():
            ck = (int(math.floor(key[0] * c / cc + 1e-9)), int(math.floor(key[1] * c / cc + 1e-9)),
                  int(math.floor(key[2] * c / cc + 1e-9)))
            CF.setdefault(ck, []).append((a, key[0] * c, key[1] * c, key[2] * c))
        self.CF = CF
        self.HC = set(CF.keys())
        self.TH = None
        self.built = True
        self.build_time = time.time() - t0
        return self

    def _coarse_empty(self, p, r):
        """True when no sampled point can be within r of p (checked on the coarse grid)."""
        cc = self.ccell
        ix, iy, iz = int(math.floor(p[0] / cc)), int(math.floor(p[1] / cc)), int(math.floor(p[2] / cc))
        K = int(r / cc) + 1
        HC = self.HC
        for dx in range(-K, K + 1):
            for dy in range(-K, K + 1):
                for dz in range(-K, K + 1):
                    if (ix + dx, iy + dy, iz + dz) in HC:
                        return False
        return True

    def any_within(self, p, r, planes=None):
        """Is any sampled surface point within r of p? Stops at the first one found."""
        if self._coarse_empty(p, r):
            return False
        c = self.cell
        px, py, pz = p
        ix, iy, iz = int(math.floor(px / c)), int(math.floor(py / c)), int(math.floor(pz / c))
        r2 = r * r
        H = self.H
        for k in range(int(r / c) + 2):
            for dx, dy, dz in _shell(k):
                a = H.get((ix + dx, iy + dy, iz + dz))
                if a is None:
                    continue
                for q in range(0, len(a), 3):
                    x, y, z = a[q], a[q + 1], a[q + 2]
                    ex, ey, ez = x - px, y - py, z - pz
                    if ex * ex + ey * ey + ez * ez <= r2:
                        if planes is not None:
                            skip = False
                            for (ox, oy, oz), (nx, ny, nz), eps in planes:
                                if (x - ox) * nx + (y - oy) * ny + (z - oz) * nz < eps:
                                    skip = True
                                    break
                            if skip:
                                continue
                        return True
        return False

    # ---- fast distance from sampled points (an upper bound; true >= fast - e_cover) ----
    def dist_fast(self, p, cap, planes=None):
        """Distance to the nearest sampled point, capped. Walks coarse cells outward and skips any
        cell (coarse or fine) whose box is already farther than the best found."""
        cc = self.ccell
        c = self.cell
        px, py, pz = p
        cx, cy, cz = int(math.floor(px / cc)), int(math.floor(py / cc)), int(math.floor(pz / cc))
        best = cap * cap
        CF = self.CF
        K = int(cap / cc) + 1
        for k in range(K + 1):
            for dx, dy, dz in _shell(k):
                ck = (cx + dx, cy + dy, cz + dz)
                lst = CF.get(ck)
                if lst is None:
                    continue
                x0, y0, z0 = ck[0] * cc, ck[1] * cc, ck[2] * cc
                ex = x0 - px if px < x0 else (px - x0 - cc if px > x0 + cc else 0.0)
                ey = y0 - py if py < y0 else (py - y0 - cc if py > y0 + cc else 0.0)
                ez = z0 - pz if pz < z0 else (pz - z0 - cc if pz > z0 + cc else 0.0)
                if ex * ex + ey * ey + ez * ez >= best:
                    continue
                for a, fx, fy, fz in lst:
                    ex = fx - px if px < fx else (px - fx - c if px > fx + c else 0.0)
                    ey = fy - py if py < fy else (py - fy - c if py > fy + c else 0.0)
                    ez = fz - pz if pz < fz else (pz - fz - c if pz > fz + c else 0.0)
                    if ex * ex + ey * ey + ez * ez >= best:
                        continue
                    n = len(a)
                    if planes is None:
                        for q in range(0, n, 3):
                            ex = a[q] - px
                            ey = a[q + 1] - py
                            ez = a[q + 2] - pz
                            d2 = ex * ex + ey * ey + ez * ez
                            if d2 < best:
                                best = d2
                    else:
                        for q in range(0, n, 3):
                            x, y, z = a[q], a[q + 1], a[q + 2]
                            ex, ey, ez = x - px, y - py, z - pz
                            d2 = ex * ex + ey * ey + ez * ez
                            if d2 >= best:
                                continue
                            skip = False
                            for (ox, oy, oz), (nx, ny, nz), eps in planes:
                                if (x - ox) * nx + (y - oy) * ny + (z - oz) * nz < eps:
                                    skip = True
                                    break
                            if not skip:
                                best = d2
            r = k * cc
            if best <= r * r:
                break
        return math.sqrt(best)

    # ---- exact distance from the triangles ----
    def _build_tri_hash(self):
        c = self.cell
        TH = {}
        T = self.T
        fl = math.floor
        for t in range(self.ntri):
            o = 9 * t
            xs = (T[o], T[o + 3], T[o + 6])
            ys = (T[o + 1], T[o + 4], T[o + 7])
            zs = (T[o + 2], T[o + 5], T[o + 8])
            x0, x1 = int(fl(min(xs) / c)), int(fl(max(xs) / c))
            y0, y1 = int(fl(min(ys) / c)), int(fl(max(ys) / c))
            z0, z1 = int(fl(min(zs) / c)), int(fl(max(zs) / c))
            if (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4096:
                # a very large triangle: register it in the cells inside the scene box only
                lx, ly, lz = (int(fl(v / c)) for v in self.lo)
                hx, hy, hz = (int(fl(v / c)) for v in self.hi)
                x0, x1 = max(x0, lx), min(x1, hx)
                y0, y1 = max(y0, ly), min(y1, hy)
                z0, z1 = max(z0, lz), min(z1, hz)
            for i in range(x0, x1 + 1):
                for j in range(y0, y1 + 1):
                    for k in range(z0, z1 + 1):
                        lst = TH.get((i, j, k))
                        if lst is None:
                            lst = TH[(i, j, k)] = array('l')
                        lst.append(t)
        self.TH = TH

    def dist_exact(self, p, cap, planes=None):
        if self.TH is None:
            self._build_tri_hash()
        c = self.cell
        px, py, pz = p
        ix, iy, iz = int(math.floor(px / c)), int(math.floor(py / c)), int(math.floor(pz / c))
        best = cap * cap
        TH = self.TH
        T = self.T
        done = set()
        kmax = int(cap / c) + 1
        for k in range(kmax + 1):
            for dx, dy, dz in _shell(k):
                lst = TH.get((ix + dx, iy + dy, iz + dz))
                if lst is None:
                    continue
                for t in lst:
                    if t in done:
                        continue
                    done.add(t)
                    o = 9 * t
                    if planes is not None:
                        keep = False          # keep the triangle if any corner is in front of every plane
                        for q in range(3):
                            x, y, z = T[o + 3 * q], T[o + 3 * q + 1], T[o + 3 * q + 2]
                            front = True
                            for (ox, oy, oz), (nx, ny, nz), eps in planes:
                                if (x - ox) * nx + (y - oy) * ny + (z - oz) * nz < eps:
                                    front = False
                                    break
                            if front:
                                keep = True
                                break
                        if not keep:
                            continue
                    d2 = tri_d2(px, py, pz, T[o], T[o + 1], T[o + 2], T[o + 3], T[o + 4], T[o + 5],
                                T[o + 6], T[o + 7], T[o + 8])
                    if d2 < best:
                        best = d2
            r = k * c
            if best <= r * r:
                break
        return max(0.0, math.sqrt(best) - self.tol)


class TubeSet(object):
    """Centrelines of tubes already laid out: short segments with the tube's outside radius."""

    def __init__(self, cell=2.0):
        self.cell = float(cell)
        self.H = {}
        self.segs = []
        self.rmax = 0.0
        self.version = 0

    def add_polyline(self, pts, radius, owner):
        c = self.cell
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            sid = len(self.segs)
            self.segs.append((a, b, float(radius), owner))
            lo = [min(a[k], b[k]) for k in range(3)]
            hi = [max(a[k], b[k]) for k in range(3)]
            for x in range(int(math.floor(lo[0] / c)), int(math.floor(hi[0] / c)) + 1):
                for y in range(int(math.floor(lo[1] / c)), int(math.floor(hi[1] / c)) + 1):
                    for z in range(int(math.floor(lo[2] / c)), int(math.floor(hi[2] / c)) + 1):
                        self.H.setdefault((x, y, z), []).append(sid)
        self.rmax = max(self.rmax, float(radius))
        self.version += 1

    def dist(self, p, cap, skip_owner=None):
        """Smallest (distance to a centreline - that tube's radius), capped."""
        if not self.segs:
            return cap
        c = self.cell
        px, py, pz = p
        ix, iy, iz = int(math.floor(px / c)), int(math.floor(py / c)), int(math.floor(pz / c))
        best = cap
        kmax = int((cap + self.rmax) / c) + 1
        done = set()
        for k in range(kmax + 1):
            for dx, dy, dz in _shell(k):
                lst = self.H.get((ix + dx, iy + dy, iz + dz))
                if not lst:
                    continue
                for sid in lst:
                    if sid in done:
                        continue
                    done.add(sid)
                    a, b, r, owner = self.segs[sid]
                    if skip_owner is not None and owner == skip_owner:
                        continue
                    d = math.sqrt(seg_d2(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2])) - r
                    if d < best:
                        best = d
            if best <= k * c - self.rmax:
                break
        return best


class Field(object):
    """A distance function sampled lazily on a grid and blended between grid points (trilinear)."""

    def __init__(self, fn, g):
        self.fn = fn
        self.g = float(g)
        self.cache = {}

    def node(self, i, j, k):
        key = (i, j, k)
        v = self.cache.get(key)
        if v is None:
            g = self.g
            v = self.cache[key] = self.fn((i * g, j * g, k * g))
        return v

    def __call__(self, p):
        g = self.g
        x, y, z = p[0] / g, p[1] / g, p[2] / g
        i, j, k = int(math.floor(x)), int(math.floor(y)), int(math.floor(z))
        fx, fy, fz = x - i, y - j, z - k
        n = self.node
        c00 = n(i, j, k) * (1 - fx) + n(i + 1, j, k) * fx
        c10 = n(i, j + 1, k) * (1 - fx) + n(i + 1, j + 1, k) * fx
        c01 = n(i, j, k + 1) * (1 - fx) + n(i + 1, j, k + 1) * fx
        c11 = n(i, j + 1, k + 1) * (1 - fx) + n(i + 1, j + 1, k + 1) * fx
        c0 = c00 * (1 - fy) + c10 * fy
        c1 = c01 * (1 - fy) + c11 * fy
        return c0 * (1 - fz) + c1 * fz


# --------------------------------------------------------------------------
# Path geometry: a polyline with every corner rounded to the bend radius
# --------------------------------------------------------------------------

def chain_geometry(Q, R):
    """Q: corner points (first and last are the tube ends). R: bend centreline radius.
    Returns dict: elems (list of ('line', p0, p1, length) and ('arc', p0, p1, centre, angle, length, u0, u1)),
    t (tangent length at each corner), th (bend angle, radians), avail (straight left on each
    polyline segment after the bends take their share; negative means the bends overlap),
    length (centreline length), dirs."""
    n = len(Q)
    dirs, lens = [], []
    for i in range(n - 1):
        d = vsub(Q[i + 1], Q[i])
        L = vlen(d)
        lens.append(L)
        dirs.append(vmul(d, 1.0 / L) if L > 1e-12 else (dirs[-1] if dirs else (1.0, 0.0, 0.0)))
    t = [0.0] * n
    th = [0.0] * n
    for i in range(1, n - 1):
        a = angle_between(dirs[i - 1], dirs[i])
        th[i] = a
        t[i] = R * math.tan(min(a, math.radians(179.0)) / 2.0)
    avail = [lens[i] - t[i] - t[i + 1] for i in range(n - 1)]
    elems = []
    for i in range(n - 1):
        s0 = vadd(Q[i], vmul(dirs[i], t[i]))
        s1 = vsub(Q[i + 1], vmul(dirs[i], t[i + 1]))
        ln = max(0.0, avail[i])
        if ln > 1e-9:
            elems.append(('line', s0, s1, ln))
        j = i + 1
        if j <= n - 2 and th[j] > 1e-7:
            a = th[j]
            din, dout = dirs[i], dirs[j]
            b = vunit(vsub(dout, din))
            cen = vadd(Q[j], vmul(b, R / math.cos(min(a, math.radians(179.0)) / 2.0)))
            p0 = vsub(Q[j], vmul(din, t[j]))
            p1 = vadd(Q[j], vmul(dout, t[j]))
            u0 = vunit(vsub(p0, cen))
            u1 = vunit(vsub(p1, cen))
            elems.append(('arc', p0, p1, cen, a, R * a, u0, u1))
    # Two bends back to back whose tangents overlap by a hair (avail just under 0, within the overlap tolerance the
    # checks allow) leave a gap of that size between the arcs' endpoints. Snap both ends to the midpoint so the chain
    # is continuous (the tangency error this adds is the gap over the radius: 0.02 mm on 60 mm is 0.02 degrees).
    for k in range(len(elems) - 1):
        a, b = elems[k], elems[k + 1]
        if a[0] == 'arc' and b[0] == 'arc':
            g = vdist(a[2], b[1])
            if 1e-9 < g < 0.05:
                m = vmul(vadd(a[2], b[1]), 0.5)
                elems[k] = ('arc', a[1], m, a[3], a[4], a[5], a[6], vunit(vsub(m, a[3])))
                elems[k + 1] = ('arc', m, b[2], b[3], b[4], b[5], vunit(vsub(m, b[3])), b[7])
    length = sum(lens) - sum(2.0 * t[i] - R * th[i] for i in range(1, n - 1))
    return {'elems': elems, 't': t, 'th': th, 'avail': avail, 'length': length, 'dirs': dirs, 'lens': lens}


def elem_point(e, f):
    """Point at fraction f (0..1) along an element."""
    if e[0] == 'line':
        p0, p1 = e[1], e[2]
        return (p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f, p0[2] + (p1[2] - p0[2]) * f)
    cen, a, u0, u1 = e[3], e[4], e[6], e[7]
    R = e[5] / a
    s = math.sin(a)
    if s < 1e-9:
        return e[1]
    w0 = math.sin((1.0 - f) * a) / s
    w1 = math.sin(f * a) / s
    return (cen[0] + R * (w0 * u0[0] + w1 * u1[0]), cen[1] + R * (w0 * u0[1] + w1 * u1[1]),
            cen[2] + R * (w0 * u0[2] + w1 * u1[2]))


def elem_tangent(e, f):
    if e[0] == 'line':
        return vunit(vsub(e[2], e[1]))
    p = elem_point(e, f)
    cen = e[3]
    nrm = vunit(vcross(e[6], e[7]))
    return vunit(vcross(nrm, vsub(p, cen)))


def sample_path(elems, total, N):
    """N points spread evenly by arc length: list of (s, point)."""
    out = []
    if total <= 0 or not elems:
        return out
    cum = 0.0
    k = 0
    ne = len(elems)
    for i in range(N):
        s = (i + 0.5) * total / N
        while k < ne - 1 and cum + elems[k][-1 if elems[k][0] == 'line' else 5] < s:
            cum += elems[k][-1 if elems[k][0] == 'line' else 5]
            k += 1
        e = elems[k]
        L = e[3] if e[0] == 'line' else e[5]
        f = 0.0 if L <= 0 else min(1.0, max(0.0, (s - cum) / L))
        out.append((s, elem_point(e, f)))
    return out


def elem_len(e):
    return e[3] if e[0] == 'line' else e[5]


def path_points(elems, max_chord=0.5):
    """Dense polyline along the elements (for tube-to-tube checks and drawing)."""
    pts = []
    for e in elems:
        L = elem_len(e)
        n = max(1, int(math.ceil(L / max_chord)))
        start = 0 if not pts else 1
        if pts and vdist(pts[-1], e[1]) > 1e-6:
            start = 0
        for i in range(start, n + 1):
            pts.append(elem_point(e, i / float(n)))
    return pts


def lra_schedule(elems, tol_deg=0.5):
    """Bend schedule: straight before each bend (L), rotation of the bend plane from the previous
    one (R, degrees, right-hand rule about the feed direction), bend angle (A, degrees), CLR."""
    rows = []
    straight = 0.0
    prev_n = None
    for e in elems:
        if e[0] == 'line':
            straight += e[3]
            continue
        a = math.degrees(e[4])
        if a < tol_deg:
            straight += e[5]
            continue
        t_in = elem_tangent(e, 0.0)
        nrm = vunit(vcross(e[6], e[7]))
        if vlen(nrm) < 0.5:
            nrm = prev_n or (0.0, 0.0, 1.0)
        r = None
        if prev_n is not None:
            r = math.degrees(math.atan2(vdot(vcross(prev_n, nrm), t_in), vdot(prev_n, nrm)))
        rows.append({'L': straight, 'R': r, 'A': a, 'CLR': e[5] / e[4]})
        straight = 0.0
        prev_n = nrm
    rows.append({'L': straight, 'R': None, 'A': None, 'CLR': None})
    return rows


# --------------------------------------------------------------------------
# Small dense linear algebra for Levenberg-Marquardt
# --------------------------------------------------------------------------

def _solve(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(M[r][c]))
        if abs(M[piv][c]) < 1e-18:
            return None
        M[c], M[piv] = M[piv], M[c]
        pv = M[c][c]
        for r in range(c + 1, n):
            f = M[r][c] / pv
            if f != 0.0:
                Mr, Mc = M[r], M[c]
                for k in range(c, n + 1):
                    Mr[k] -= f * Mc[k]
    x = [0.0] * n
    for r in range(n - 1, -1, -1):
        s = M[r][n] - sum(M[r][k] * x[k] for k in range(r + 1, n))
        x[r] = s / M[r][r]
    return x


def levenberg_marquardt(fun, x0, iters=60, step_max=None, groups=None, h=1e-3, deadline=None):
    """Minimise sum(fun(x)^2). step_max limits how far any point (group of 3 values) moves per step."""
    x = list(x0)
    r = fun(x)
    cost = sum(v * v for v in r)
    lam = 1e-3
    n = len(x)
    m = len(r)
    for _it in range(iters):
        if deadline and time.time() > deadline:
            break
        J = [[0.0] * n for _ in range(m)]
        for j in range(n):
            xj = x[j]
            x[j] = xj + h
            rj = fun(x)
            x[j] = xj
            for i in range(m):
                J[i][j] = (rj[i] - r[i]) / h
        JTJ = [[0.0] * n for _ in range(n)]
        JTr = [0.0] * n
        for i in range(m):
            Ji = J[i]
            ri = r[i]
            nz = [j for j in range(n) if Ji[j] != 0.0]
            for a in nz:
                JTr[a] += Ji[a] * ri
                Jia = Ji[a]
                row = JTJ[a]
                for b in nz:
                    row[b] += Jia * Ji[b]
        improved = False
        while lam < 1e10:
            A = [row[:] for row in JTJ]
            for j in range(n):
                A[j][j] += lam * (JTJ[j][j] + 1e-6)
            dx = _solve(A, [-v for v in JTr])
            if dx is None:
                lam *= 10.0
                continue
            if step_max:
                big = 0.0
                for g in (groups or [[j] for j in range(n)]):
                    big = max(big, math.sqrt(sum(dx[j] * dx[j] for j in g)))
                if big > step_max:
                    s = step_max / big
                    dx = [v * s for v in dx]
            xn = [x[j] + dx[j] for j in range(n)]
            rn = fun(xn)
            cn = sum(v * v for v in rn)
            if cn < cost:
                rel = (cost - cn) / max(cost, 1e-30)
                x, r, cost = xn, rn, cn
                lam = max(lam * 0.3, 1e-9)
                improved = True
                break
            lam *= 4.0
        if not improved or cost < 1e-12 or rel < 1e-7:
            break
    return x, cost


# --------------------------------------------------------------------------
# Route spec helpers
# --------------------------------------------------------------------------

DEFAULTS = {
    'gap': 1.27,            # tube surface to scan, cm (0.5 in)
    'gap_tt': 0.32,         # tube to tube, cm (1/8 in)
    'lead_start': 2.54,     # straight out of the start before the first bend, cm
    'lead_end': 2.54,
    'min_straight': 0.0,    # straight between bends (0 = bends may be welded end to end)
    'max_bend_deg': 180.0,
    'tol': 0.05,            # length tolerance, cm
    'time_budget': 40.0,    # seconds per tube
}


def _spec(spec):
    s = dict(DEFAULTS)
    s.update({k: v for k, v in spec.items() if v is not None})
    s['start'] = tuple(float(v) for v in s['start'])
    s['end'] = tuple(float(v) for v in s['end'])
    s['start_dir'] = vunit(tuple(float(v) for v in s['start_dir']))
    s['end_dir'] = vunit(tuple(float(v) for v in s['end_dir']))
    s['R'] = float(s['od']) / 2.0
    s['clr'] = float(s['clr'])
    if s['clr'] < s['R']:
        raise ValueError('The bend radius is smaller than the tube radius.')
    return s


class _Clearance(object):
    """Clearance functions for one tube: the scan (with the start and end faces ignored close to
    the ends) and other tubes, each as fast fields for fitting and exact checks for the result."""

    def __init__(self, scene, s, tubes, owner, g=0.5):
        self.scene = scene
        self.s = s
        self.tubes = tubes
        self.owner = owner
        R, gap = s['R'], s['gap']
        self.req = R + gap
        self.cap = self.req + 4.0 * max(g, 1.0)
        eps = self.req * math.sin(math.radians(10.0)) + 0.1
        self.plane_s = [(s['start'], s['start_dir'], eps)]
        self.plane_e = [(s['end'], vmul(s['end_dir'], -1.0), eps)]
        self.excl_s = s['lead_start'] + self.req
        self.excl_e = s['lead_end'] + self.req
        cap = self.cap
        if scene is not None and scene.built:
            self.f_mid = Field(lambda p: scene.dist_fast(p, cap), g)
            self.f_s = Field(lambda p: scene.dist_fast(p, cap, self.plane_s), g)
            self.f_e = Field(lambda p: scene.dist_fast(p, cap, self.plane_e), g)
        else:
            self.f_mid = self.f_s = self.f_e = None
        self.ramp_tt = 2.0 * s['od']
        if tubes is not None and tubes.segs:
            self.f_tt = Field(lambda p: tubes.dist(p, cap, owner), g)
        else:
            self.f_tt = None

    def zone(self, s_pos, total):
        if s_pos < self.excl_s:
            return 's'
        if total - s_pos < self.excl_e:
            return 'e'
        return 'm'

    TOUCH = 0.03     # cm: where tubes are meant to touch (packed at the collector), this much overlap is tolerated

    def tt_factor(self, s_pos, total):
        """0 on the fixed straight ends (packed at the collector, side by side at the ports), rising to 1
        over two tube diameters, so tubes may touch where they are meant to and keep the gap elsewhere."""
        s = self.s
        a = (s_pos - s['lead_start']) / self.ramp_tt
        b = (total - s_pos - s['lead_end']) / self.ramp_tt
        return max(0.0, min(1.0, a, b))

    def req_tt(self, s_pos, total, margin=0.0):
        f = self.tt_factor(s_pos, total)
        return self.s['R'] + self.s['gap_tt'] * f + margin * min(1.0, 4.0 * f) - self.TOUCH * (1.0 - f)

    def on_fixed_end(self, s_pos, total):
        s = self.s
        return s_pos < s['lead_start'] - 1e-9 or total - s_pos < s['lead_end'] - 1e-9

    def scan_fast(self, p, zone):
        if self.f_mid is None:
            return self.cap
        return (self.f_s if zone == 's' else self.f_e if zone == 'e' else self.f_mid)(p)

    def planes(self, zone):
        return self.plane_s if zone == 's' else self.plane_e if zone == 'e' else None

    def point_free(self, p, near_s, near_e, ramp_f=1.0, extra=0.0):
        """For the lattice search: direct checks (no blending). extra widens the clearance asked for,
        so the search prefers corridors with room for the bends."""
        s = self.s
        ok = True
        if self.scene is not None and self.scene.built:
            planes = self.plane_s if near_s else (self.plane_e if near_e else None)
            ok = not self.scene.any_within(p, self.req + extra * ramp_f, planes)
        if ok and self.tubes is not None and self.tubes.segs:
            d2 = self.tubes.dist(p, self.cap, self.owner)
            ok = d2 >= s['R'] + (s['gap_tt'] + extra) * ramp_f - 1e-6
        return ok


# --------------------------------------------------------------------------
# Lattice search (Lazy Theta*): finds a way through; corners are rounded later
# --------------------------------------------------------------------------

_NB = [(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if (i, j, k) != (0, 0, 0)]


def theta_star(A, B, h, free_at, los, inside, max_expand=60000, weight=1.3, deadline=None):
    def P(n):
        return (A[0] + n[0] * h, A[1] + n[1] * h, A[2] + n[2] * h)

    start = (0, 0, 0)
    g = {start: 0.0}
    parent = {start: start}
    openh = [(weight * vdist(A, B), 0, start)]
    closed = set()
    free_cache = {}

    def is_free(n):
        v = free_cache.get(n)
        if v is None:
            p = P(n)
            v = free_cache[n] = inside(p) and free_at(p)
        return v

    counter = 0
    expanded = 0
    while openh:
        _f, _c, s = heapq.heappop(openh)
        if s in closed:
            continue
        ps = P(s)
        par = parent[s]
        if par != s and not los(P(par), ps):
            best, bp = None, None          # Lazy Theta*: fall back to the best closed neighbour
            for d in _NB:
                nb = (s[0] + d[0], s[1] + d[1], s[2] + d[2])
                if nb in closed:
                    v = g[nb] + h * math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
                    if best is None or v < best:
                        best, bp = v, nb
            if bp is None:
                continue
            g[s], parent[s] = best, bp
        closed.add(s)
        expanded += 1
        if vdist(ps, B) <= 1.75 * h and los(ps, B):
            path = [B]
            n = s
            while True:
                path.append(P(n))
                if parent[n] == n:
                    break
                n = parent[n]
            path.reverse()
            return path, expanded
        if expanded > max_expand or (deadline and time.time() > deadline):
            break
        for d in _NB:
            nb = (s[0] + d[0], s[1] + d[1], s[2] + d[2])
            if nb in closed or not is_free(nb):
                continue
            pp = parent[s]
            gn = g[pp] + vdist(P(pp), P(nb))
            if gn < g.get(nb, 1e30):
                g[nb] = gn
                parent[nb] = pp
                counter += 1
                heapq.heappush(openh, (gn + weight * vdist(P(nb), B), counter, nb))
    return None, expanded


def _simplify(path, los):
    """Drop corners that a straight line can skip."""
    if len(path) <= 2:
        return path
    out = [path[0]]
    i = 0
    while i < len(path) - 1:
        j = len(path) - 1
        while j > i + 1 and not los(path[i], path[j]):
            j -= 1
        out.append(path[j])
        i = j
    return out


# --------------------------------------------------------------------------
# One tube
# --------------------------------------------------------------------------

def _chain(s, x):
    a, b = x[0], x[1]
    Q = [s['start'], vadd(s['start'], vmul(s['start_dir'], a))]
    for i in range(2, len(x), 3):
        Q.append((x[i], x[i + 1], x[i + 2]))
    Q.append(vsub(s['end'], vmul(s['end_dir'], b)))
    Q.append(s['end'])
    return Q


def _poly_dist(p, poly):
    best = 1e18
    for i in range(len(poly) - 1):
        a, b = poly[i], poly[i + 1]
        d = seg_d2(p[0], p[1], p[2], a[0], a[1], a[2], b[0], b[1], b[2])
        if d < best:
            best = d
    return math.sqrt(best)


def _residual_fn(s, C, nsamp, margin, weights, anchor=None, D=None):
    R = s['clr']
    target = s.get('target')
    tmax = math.radians(min(179.0, float(s['max_bend_deg'])))
    wc, wf, wl, wb = weights

    def fun(x):
        Q = _chain(s, x)
        geo = chain_geometry(Q, R)
        out = []
        av = geo['avail']
        last = len(av) - 1
        for i, a in enumerate(av):
            need = s['lead_start'] if i == 0 else (s['lead_end'] if i == last else s['min_straight'])
            out.append(wf * max(0.0, need + 0.01 - a))      # a hair over, so finished bends never overlap
        for i in range(1, len(Q) - 1):
            out.append(wf * R * max(0.0, geo['th'][i] - tmax))
        total = geo['length']
        for sp, p in sample_path(geo['elems'], total, nsamp):
            z = C.zone(sp, total)
            d = C.scan_fast(p, z)
            out.append(wc * max(0.0, C.req + margin - d))
            if C.f_tt is not None:
                if C.on_fixed_end(sp, total):
                    out.append(0.0)       # the straight ends are fixed by the markers; nothing to fit there
                else:
                    out.append(wc * max(0.0, C.req_tt(sp, total, margin) - C.f_tt(p)))
        if target:
            out.append(wl * (total - target))
        else:
            out.append(0.05 * total)
        for i in range(1, len(Q) - 1):
            out.append(wb * geo['th'][i])
        if anchor:
            # stay near the corridor the search found: no wandering off to dodge a tight spot
            for i in range(2, len(Q) - 2):
                out.append(10.0 * max(0.0, _poly_dist(Q[i], anchor) - D))
        return out

    return fun


CERT_TOL = 0.01     # cm (0.1 mm): how far under the rule a result may be and still be called clear


def certify(geo, C, step_min=0.01):
    """Walk the finished centreline and prove the clearance with the exact triangles.
    Returns min slack to the scan rule (>= 0 means clear), the smallest true gap tube surface to
    scan, the min slack to other tubes, and where the worst spot is."""
    s = C.s
    elems = geo['elems']
    total = sum(elem_len(e) for e in elems)
    scene = C.scene
    worst = {'slack': 1e9, 'gap': 1e9, 'tt': 1e9, 'at': None, 'tt_at': None}
    if not elems:
        return worst
    pos = 0.0
    k = 0
    cum = 0.0
    prev = None
    have_scan = scene is not None and scene.built
    e_cov = scene.e_cover if have_scan else 0.0
    while True:
        while k < len(elems) - 1 and cum + elem_len(elems[k]) < pos:
            cum += elem_len(elems[k])
            k += 1
        e = elems[k]
        L = elem_len(e)
        f = 0.0 if L <= 0 else min(1.0, max(0.0, (pos - cum) / L))
        p = elem_point(e, f)
        z = C.zone(pos, total)
        slack = 1e9
        if have_scan:
            d = scene.dist_fast(p, C.cap, C.planes(z))
            if d - e_cov - C.req < 2.0 * step_min:
                d = scene.dist_exact(p, C.cap, C.planes(z))
                if z == 'm':
                    worst['gap'] = min(worst['gap'], d - s['R'])
            else:
                d = d - e_cov
                if z == 'm':
                    worst['gap'] = min(worst['gap'], d - s['R'])
            slack = d - C.req
        tt = 1e9
        if C.tubes is not None and C.tubes.segs:
            tt = C.tubes.dist(p, C.cap, C.owner) - C.req_tt(pos, total)
            if C.on_fixed_end(pos, total):
                # fixed by the markers; only a real overlap (beyond touching) is reported
                tt = max(tt, 0.0) if tt > -C.TOUCH else tt
        step = max(step_min, min(slack, tt if tt < 1e8 else slack, 5.0))
        if prev is not None:
            ps, ptt, pstep = prev
            # 1-Lipschitz: between two samples the slack dips by at most half the spacing
            between = (ps + slack - pstep) / 2.0
            between_tt = (ptt + tt - pstep) / 2.0
            if between < worst['slack']:
                worst['slack'] = between
                worst['at'] = p
            if between_tt < worst['tt']:
                worst['tt'] = between_tt
                worst['tt_at'] = p
        if pos >= total:
            break
        step = min(step, total - pos) if total - pos > 1e-9 else step
        prev = (slack, tt, step)
        pos = min(total, pos + step)
        if step <= 0:
            break
    return worst


def route(scene, spec, tubes=None, owner=None, log=None):
    """Lay out one tube. spec: start, start_dir (the way the tube leaves), end, end_dir (the way
    the tube is heading when it arrives), od, clr (bend centreline radius), and optionally gap,
    gap_tt, lead_start, lead_end, min_straight, max_bend_deg, target (centreline length), tol.
    Returns a dict; ok is True only when the result is proven clear and meets the length."""
    t0 = time.time()
    s = _spec(spec)
    deadline = t0 + float(s['time_budget'])
    notes = []
    R = s['R']
    rb = s['clr']
    C = _Clearance(scene, s, tubes, owner)
    A = vadd(s['start'], vmul(s['start_dir'], s['lead_start']))
    B = vsub(s['end'], vmul(s['end_dir'], s['lead_end']))
    target = s.get('target')
    direct = vdist(A, B)
    h = max(0.75, min(3.0, C.req / 1.5))
    if target:
        Lfree = target - s['lead_start'] - s['lead_end'] + 2.0 * rb
        if Lfree < direct:
            return {'ok': False, 'msg': 'The target length is shorter than the straight-line distance between the ends.',
                    'shortest': direct + s['lead_start'] + s['lead_end']}
        semi = Lfree / 2.0 + rb
    else:
        semi = None
    near_r = max(s['lead_start'], s['lead_end']) + C.req + h

    def inside(p):
        if semi is None:
            return True
        return vdist(p, A) + vdist(p, B) <= 2.0 * semi

    def free_at(p, extra=0.0):
        ns = vdist(p, s['start']) < s['lead_start'] + C.req + h
        ne = vdist(p, s['end']) < s['lead_end'] + C.req + h
        ra = min(1.0, vdist(p, A) / C.ramp_tt, vdist(p, B) / C.ramp_tt)
        return C.point_free(p, ns, ne, ra, extra)

    def clear_amount(p):
        ns = vdist(p, s['start']) < near_r
        ne = vdist(p, s['end']) < near_r
        best = 1e9
        if scene is not None and scene.built:
            planes = C.plane_s if ns else (C.plane_e if ne else None)
            best = scene.dist_fast(p, C.cap, planes) - C.req
        if tubes is not None and tubes.segs:
            ra = min(1.0, vdist(p, A) / C.ramp_tt, vdist(p, B) / C.ramp_tt)
            best = min(best, tubes.dist(p, C.cap, owner) - (R + s['gap_tt'] * ra))
        return best

    los_step = min(h / 2.0, 1.0)

    def los(p, q, extra=0.0):
        L = vdist(p, q)
        n = max(1, int(math.ceil(L / los_step)))
        for i in range(n + 1):
            if not free_at(vadd(p, vmul(vsub(q, p), i / float(n))), extra):
                return False
        return True

    def search(extra, max_expand, until):
        fa = lambda p: free_at(p, extra)
        lo = lambda p, q: los(p, q, extra)
        if lo(A, B):
            return [A, B], 0
        pth, ex = theta_star(A, B, h, fa, lo, inside, max_expand=max_expand, deadline=until)
        if pth is None:
            return None, ex
        return _simplify(pth, lo), ex

    # 2. fit: first a clear, buildable route with no length target, then (if asked) the target length
    nsamp = max(24, int(min(600, (target or (direct + 2 * rb)) / 0.5)))

    def x_from(W):
        Q0 = [s['start'], A] + list(W) + [B, s['end']]
        g0 = chain_geometry(Q0, rb)
        a = s['lead_start'] + g0['t'][1] + 0.01
        b = s['lead_end'] + g0['t'][-2] + 0.01
        x = [a, b]
        for w in W:
            x.extend(w)
        return x

    def W_of(x):
        return [(x[i], x[i + 1], x[i + 2]) for i in range(2, len(x), 3)]

    def repair(W):
        """Drop corners that sit too close together for both bends to fit."""
        W = list(W)
        for _ in range(len(W) + 1):
            Q = _chain(s, x_from(W))
            geo = chain_geometry(Q, rb)
            av = geo['avail']
            bad = None
            for i in range(1, len(av) - 1):
                if av[i] < s['min_straight'] - 1e-6:
                    bad = i
                    break
            if bad is None:
                break
            cand = [j for j in (bad, bad + 1) if 2 <= j <= len(Q) - 3]
            if not cand:
                break
            j = min(cand, key=lambda q: geo['th'][q])
            del W[j - 2]
        return W

    def violation(cert, err, geo):
        v = max(0.0, -cert['slack']) + max(0.0, -cert['tt'])
        av = geo['avail']
        last = len(av) - 1
        for i, a in enumerate(av):
            need = s['lead_start'] if i == 0 else (s['lead_end'] if i == last else s['min_straight'])
            v += max(0.0, need - a)
        return v

    D_anchor = max(6.0, 0.2 * direct, 2.0 * h)

    def fit(x, with_target, m, anchor):
        w = (50.0, 50.0, 20.0 if with_target else 0.0, 0.3)
        groups = [[0], [1]] + [[i, i + 1, i + 2] for i in range(2, len(x), 3)]
        res = None
        for _attempt in range(3):
            fun = _residual_fn(dict(s, target=target if with_target else None), C, nsamp, m, w, anchor, D_anchor)
            x, _cost = levenberg_marquardt(fun, x, iters=80, step_max=h, groups=groups, deadline=deadline + 10)
            x = _prune(dict(s, target=target if with_target else None), C, x, nsamp, m, w, deadline, anchor, D_anchor)
            groups = [[0], [1]] + [[i, i + 1, i + 2] for i in range(2, len(x), 3)]
            geo = chain_geometry(_chain(s, x), rb)
            cert = certify(geo, C)
            err = _hard_errors(s, geo, _chain(s, x))
            res = (x, geo, cert, err, m)
            if err and _attempt < 2:
                # a straight came out a hair short (the length or clearance terms pulled two bends into each other):
                # weigh the straights ten times harder and fit again from here
                w = (w[0], w[1] * 10.0, w[2], w[3])
                continue
            if cert['slack'] >= -CERT_TOL and cert['tt'] >= -CERT_TOL:
                break
            m += max(-cert['slack'], -cert['tt']) + 0.05
        return res

    def score_of(res, with_target=True):
        x, geo, cert, err, _m = res
        Lerr = abs(geo['length'] - target) if (target and with_target) else 0.0
        okc = cert['slack'] >= -CERT_TOL and cert['tt'] >= -CERT_TOL
        okl = (not (target and with_target)) or Lerr <= s['tol']
        nb = len([a for a in geo['th'][1:-1] if a > math.radians(0.5)])
        if okc and okl and not err:
            if target and with_target:
                return (0, nb, sum(geo['th']), Lerr)
            return (0, geo['length'] + 2.0 * s['od'] * nb, 0, 0)     # shortest, with each bend worth two diameters of tube
        return (1, violation(cert, err, geo) + Lerr / 10.0, 0, Lerr)

    best = None
    stageA = None
    expanded = 0
    # widen the search first so the corridor has room for the bends, then narrow it if nothing fits
    budget = float(s['time_budget'])
    for extra in (0.6 * rb, 0.3 * rb, 0.0):
        if stageA is not None and time.time() > deadline:
            break
        now = time.time()
        # the wide searches get a slice of the time; the plain one always gets a fair go
        until = now + 0.15 * budget if extra > 0 else max(deadline, now + 0.4 * budget)
        path, ex = search(extra, 8000 if extra > 0 else 60000, until)
        expanded += ex
        if path is None:
            continue
        anchor = [A] + path[1:-1] + [B]
        res = fit(x_from(repair(path[1:-1])), False, 0.1, anchor)
        if log:
            log('search width +%.1f cm: %d corners, clear route %.2f cm, slack %.3f, %.1fs' % (
                extra, len(path) - 2, res[1]['length'], res[2]['slack'], time.time() - t0))
        if stageA is None or score_of(res, False) < score_of(stageA, False):
            stageA = res
        if score_of(res, False)[0] == 0 and (target or extra == 0.0):
            break       # with a target length the clear route only seeds the next stage; without one, also try narrower
    if stageA is None:
        return {'ok': False, 'msg': 'No way through was found with this clearance. Try a smaller gap or tube, '
                'or move the ends.', 'expanded': expanded, 'time': time.time() - t0}
    candidates = [stageA]
    if target:
        xa, geoA, _c, _e, mA = stageA
        starts = [list(xa)]
        Qa = [A] + W_of(xa) + [B]
        La = geoA['length']
        need = target - La
        if need > 0.5:
            segs = sorted(range(len(Qa) - 1), key=lambda i: -vdist(Qa[i], Qa[i + 1]))
            cands = []
            for si in segs[:2]:
                p, q = Qa[si], Qa[si + 1]
                L = vdist(p, q)
                u = vunit(vsub(q, p))
                e1, e2 = perp_basis(u)
                for nb in (1, 2):
                    add = need * 1.2 / nb
                    l = L / (nb * 2.0)
                    dlt = math.sqrt(max(0.0, (l + add / 2.0) ** 2 - l * l))
                    for k in range(8):
                        ang = 2 * math.pi * k / 8.0
                        dv = vadd(vmul(e1, math.cos(ang)), vmul(e2, math.sin(ang)))
                        pts = []
                        for mm in range(nb):
                            mid = vadd(p, vmul(u, L * (2 * mm + 1) / (2.0 * nb)))
                            sign = 1.0 if mm % 2 == 0 else -1.0
                            pts.append(vadd(mid, vmul(dv, sign * dlt)))
                        sc = min(clear_amount(pp) for pp in pts)
                        if sc > -0.5 * C.req:
                            W = W_of(xa)
                            W[si:si] = pts
                            cands.append((sc, W))
            cands.sort(key=lambda c: -c[0])
            starts.extend([x_from(repair(c[1])) for c in cands[:5]])
        candidates = []
        for k, x0 in enumerate(starts):
            if k > 0 and time.time() > deadline:
                break
            res = fit(x0, True, mA, [A] + W_of(x0) + [B])
            candidates.append(res)
            if score_of(res)[0] == 0 and k >= 1:
                break
    for res in candidates:
        sc = score_of(res)
        if best is None or sc < best[0]:
            best = (sc, res)
    score, (x, geo, cert, err, _m) = best
    Q = _chain(s, x)
    L = geo['length']
    okc = cert['slack'] >= -CERT_TOL and cert['tt'] >= -CERT_TOL
    okl = (not target) or abs(L - target) <= s['tol']
    msgs = []
    if not okc:
        if cert['slack'] < -CERT_TOL:
            msgs.append('Could not keep the full gap to the scan: short by %.2f cm near (%.1f, %.1f, %.1f).' % (
                (-cert['slack'],) + tuple(cert['at'] or (0, 0, 0))))
        if cert['tt'] < -CERT_TOL:
            msgs.append('Could not keep the gap to the other tubes: short by %.2f cm.' % (-cert['tt']))
    if not okl:
        msgs.append('Length is %.2f cm; the target is %.2f cm.' % (L, target))
    msgs.extend(err)
    out = {'ok': bool(okc and okl and not err), 'corners': Q, 'elems': geo['elems'], 'length': L,
           'bend_angles': [math.degrees(a) for a in geo['th'][1:-1]],
           'lra': lra_schedule(geo['elems']), 'min_gap': cert['gap'] if cert['gap'] < 1e8 else None,
           'slack': cert['slack'], 'tt_slack': cert['tt'] if cert['tt'] < 1e8 else None,
           'msg': ' '.join(msgs) if msgs else 'Clear of the scan and the other tubes.',
           'time': time.time() - t0, 'e_cover': scene.e_cover if (scene is not None and scene.built) else 0.0,
           'notes': notes}
    return out


def _hard_errors(s, geo, Q):
    errs = []
    av = geo['avail']
    last = len(av) - 1
    for i, a in enumerate(av):
        need = s['lead_start'] if i == 0 else (s['lead_end'] if i == last else s['min_straight'])
        if a < need - 0.02:        # 0.2 mm: a bend welded end to end counts as no straight
            errs.append('A straight is %.2f cm where %.2f cm is needed.' % (a, need))
            break
    tmax = min(179.0, float(s['max_bend_deg']))
    for a in geo['th'][1:-1]:
        if math.degrees(a) > tmax + 0.5:
            errs.append('A bend is %.0f deg, over the %.0f deg limit.' % (math.degrees(a), tmax))
            break
    return errs


def _prune(s, C, x, nsamp, m, weights, deadline, anchor=None, D=None):
    """Remove corners that end up nearly straight, refitting after each removal."""
    while len(x) > 2:
        Q = _chain(s, x)
        geo = chain_geometry(Q, s['clr'])
        th = geo['th']
        # interior corners W are Q[2..-3]; their angles th[2..-3]
        idx = [i for i in range(2, len(Q) - 2) if th[i] < math.radians(1.0)]
        if not idx:
            break
        i = idx[0]
        k = 2 + 3 * (i - 2)
        xn = x[:k] + x[k + 3:]
        fun = _residual_fn(s, C, nsamp, m, weights, anchor, D)
        groups = [[0], [1]] + [[j, j + 1, j + 2] for j in range(2, len(xn), 3)]
        xn, _c = levenberg_marquardt(fun, xn, iters=30, groups=groups, deadline=deadline + 10)
        x = xn
    return x


# --------------------------------------------------------------------------
# Several primaries into one collector
# --------------------------------------------------------------------------

def collector_slots(center, axis, n, od, clock_deg=0.0):
    """Where n tubes of outside diameter od sit, touching, around the collector axis."""
    axis = vunit(axis)
    e1, e2 = perp_basis(axis)
    if n == 1:
        return [center]
    r = od / (2.0 * math.sin(math.pi / n))
    out = []
    for i in range(n):
        a = math.radians(clock_deg) + 2.0 * math.pi * i / n
        out.append(vadd(center, vadd(vmul(e1, r * math.cos(a)), vmul(e2, r * math.sin(a)))))
    return out


def _assign(ports, slots):
    """Port-to-slot assignment with the smallest total straight-line distance."""
    import itertools
    n = len(ports)
    best, bp = None, None
    if n <= 8:
        for perm in itertools.permutations(range(n)):
            c = sum(vdist(ports[i], slots[perm[i]]) for i in range(n))
            if best is None or c < best:
                best, bp = c, perm
    else:
        bp = tuple(range(n))
        best = sum(vdist(ports[i], slots[i]) for i in range(n))
    return list(bp), best


def route_header(scene, ports, collector, spec, log=None):
    """ports: list of (point, direction out of the port). collector: (point at the merge plane,
    direction the gas flows). spec: od, clr, target (primary centreline length), gap, gap_tt,
    lead_start, lead_end, clock_deg (optional), collector_len, collector_out_d; targets (optional):
    a length per port in the ports' order, for unequal-length headers (overrides target per tube)."""
    n = len(ports)
    od = float(spec['od'])
    cpt, cdir = tuple(collector[0]), vunit(tuple(collector[1]))
    lead_e = float(spec.get('lead_end') or DEFAULTS['lead_end'])
    clocks = [spec['clock_deg']] if spec.get('clock_deg') is not None else [5.0 * k for k in range(int(72 / n) + 1)]
    best = None
    for ck in clocks:
        slots = collector_slots(cpt, cdir, n, od, ck)
        leads = [vadd(p, vmul(vunit(d), float(spec.get('lead_start') or DEFAULTS['lead_start']))) for p, d in ports]
        perm, cost = _assign(leads, [vsub(sl, vmul(cdir, lead_e)) for sl in slots])
        if best is None or cost < best[0]:
            best = (cost, ck, slots, perm)
    _c, clock, slots, perm = best
    # spec['tubes'] shares one TubeSet between several headers (a 180-degree pair, say) so the second
    # header's primaries keep clear of the first's; spec['owner_base'] keeps their owner ids apart.
    tubes = spec.get('tubes') or TubeSet()
    base = int(spec.get('owner_base') or 0)
    # every tube's fixed straight ends are in place before any tube is routed
    for i, (p, d) in enumerate(ports):
        d = vunit(d)
        tubes.add_polyline([tuple(p), vadd(tuple(p), vmul(d, float(spec.get('lead_start') or DEFAULTS['lead_start'])))],
                           od / 2.0, ('lead', base + i))
        sl = slots[perm[i]]
        tubes.add_polyline([vsub(sl, vmul(cdir, lead_e)), sl], od / 2.0, ('lead', base + i))
    order = sorted(range(n), key=lambda i: -vdist(ports[i][0], slots[perm[i]]))
    if spec.get('order'):
        order = list(spec['order'])
    results = [None] * n
    for i in order:
        p, d = ports[i]
        sp = dict(spec)
        sp.pop('tubes', None)
        sp.update({'start': p, 'start_dir': d, 'end': slots[perm[i]], 'end_dir': cdir, 'lead_end': lead_e})
        # spec['targets']: one centreline length per port (unequal-length headers); None keeps spec['target']
        if spec.get('targets') and i < len(spec['targets']) and spec['targets'][i]:
            sp['target'] = float(spec['targets'][i])
        sp.pop('targets', None)

        r = route(scene, sp, tubes=_Filtered(tubes, base + i), owner=base + i, log=log)
        results[i] = r
        if r.get('elems'):
            tubes.add_polyline(path_points(r['elems'], 0.5), od / 2.0, base + i)
    out = {'primaries': results, 'slots': slots, 'assign': perm, 'clock_deg': clock, 'tubes': tubes,
           'ok': all(r and r.get('ok') for r in results)}
    if spec.get('collector_len'):
        out['collector'] = collector_body(cpt, cdir, n, od, float(spec['collector_len']),
                                          float(spec.get('collector_out_d') or od * math.sqrt(n) * 0.8), scene,
                                          float(spec.get('gap', DEFAULTS['gap'])))
    lens = [r['length'] for r in results if r and r.get('length')]
    if lens:
        out['spread'] = max(lens) - min(lens)
    return out


class _Filtered(object):
    """A TubeSet view that ignores one primary's own fixed ends."""

    def __init__(self, tubes, i):
        self.t = tubes
        self.i = i
        self.segs = tubes.segs

    def dist(self, p, cap, owner):
        t = self.t
        if not t.segs:
            return cap
        c = t.cell
        px, py, pz = p
        ix, iy, iz = int(math.floor(px / c)), int(math.floor(py / c)), int(math.floor(pz / c))
        best = cap
        kmax = int((cap + t.rmax) / c) + 1
        done = set()
        for k in range(kmax + 1):
            for dx, dy, dz in _shell(k):
                lst = t.H.get((ix + dx, iy + dy, iz + dz))
                if not lst:
                    continue
                for sid in lst:
                    if sid in done:
                        continue
                    done.add(sid)
                    a, b, r, ow = t.segs[sid]
                    if ow == self.i or ow == ('lead', self.i):
                        continue
                    d = math.sqrt(seg_d2(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2])) - r
                    if d < best:
                        best = d
            if best <= k * c - t.rmax:
                break
        return best


def collector_body(cpt, cdir, n, od, length, out_d, scene, gap):
    """The merge cone: from the circle around the bundle of primaries to the outlet diameter."""
    r_pack = 0.0 if n == 1 else od / (2.0 * math.sin(math.pi / n))
    d_in = 2.0 * r_pack + od
    end = vadd(cpt, vmul(cdir, length))
    worst = None
    if scene is not None and scene.built:
        e1, e2 = perp_basis(cdir)
        for i in range(0, 21):
            f = i / 20.0
            c = vadd(cpt, vmul(cdir, length * f))
            r = (d_in + (out_d - d_in) * f) / 2.0
            for k in range(24):
                a = 2 * math.pi * k / 24.0
                p = vadd(c, vadd(vmul(e1, r * math.cos(a)), vmul(e2, r * math.sin(a))))
                d = scene.dist_exact(p, gap + 5.0, [(cpt, cdir, 0.05)])
                worst = d if worst is None else min(worst, d)
    return {'start': cpt, 'end': end, 'd_in': d_in, 'd_out': out_d, 'min_gap': worst,
            'ok': worst is None or worst >= gap - 0.6}


# --------------------------------------------------------------------------
# Off-the-shelf parts placed along a route
# --------------------------------------------------------------------------

def part_frame(axis, rot_deg, up=None):
    """x across the case's width, y across its height, z along the axis."""
    z = vunit(axis)
    if up is not None and abs(vdot(vunit(up), z)) < 0.95:
        y0 = vunit(vsub(up, vmul(z, vdot(up, z))))
        x0 = vcross(y0, z)
    else:
        x0, y0 = perp_basis(z)
    a = math.radians(rot_deg)
    x = vadd(vmul(x0, math.cos(a)), vmul(y0, math.sin(a)))
    y = vcross(z, x)
    return x, y, z


def part_geometry(part, p_in, axis, rot_deg, up=None):
    """part: oal, body (case length), shape 'round'|'oval', w, h (case outside), in_off and out_off
    (x, y) of the inlet and outlet from the case centre line, in_d, out_d.
    The inlet stub starts at p_in; the case is centred along the overall length."""
    x, y, z = part_frame(axis, rot_deg, up)
    oal = float(part['oal'])
    body = float(part.get('body') or oal)
    ix, iy = part.get('in_off') or (0.0, 0.0)
    ox, oy = part.get('out_off') or (0.0, 0.0)
    c0 = vsub(p_in, vadd(vmul(x, ix), vmul(y, iy)))           # case centre line at the inlet end
    p_out = vadd(vadd(c0, vmul(z, oal)), vadd(vmul(x, ox), vmul(y, oy)))
    stub_in = float(part['stub_in']) if part.get('stub_in') is not None else (oal - body) / 2.0
    case0 = vadd(c0, vmul(z, stub_in))
    return {'x': x, 'y': y, 'z': z, 'p_in': p_in, 'p_out': p_out, 'case0': case0,
            'case1': vadd(case0, vmul(z, body)), 'c0': c0}


def case_points(part, g, step=0.75):
    """Points on the case surface (and the stubs) for clearance checks."""
    shape = part.get('shape', 'round')
    w = float(part.get('w') or part.get('in_d'))
    hgt = float(part.get('h') or w)
    body = float(part.get('body') or part['oal'])
    pts = []
    nl = max(2, int(math.ceil(body / step)) + 1)
    per = math.pi * (w + hgt) / 2.0
    nr = max(12, int(math.ceil(per / step)))
    w_end = float(part.get('w2') or w)              # cone: diameter at the far end of the body
    for i in range(nl):
        f = i / (nl - 1.0)
        c = vadd(g['case0'], vmul(g['z'], body * f))
        if shape == 'cone':
            wd = w + (w_end - w) * f
            for k in range(nr):
                a = 2 * math.pi * k / nr
                pts.append(vadd(c, vadd(vmul(g['x'], wd / 2.0 * math.cos(a)), vmul(g['y'], wd / 2.0 * math.sin(a)))))
            continue
        for k in range(nr):
            a = 2 * math.pi * k / nr
            if shape == 'oval' and abs(w - hgt) > 1e-6:
                # flat oval (stadium): straight sides with round ends, as most oval mufflers are built
                big, small = max(w, hgt), min(w, hgt)
                rr = small / 2.0
                flat = (big - small) / 2.0
                u, v = math.cos(a), math.sin(a)
                px = rr * u + (flat if u >= 0 else -flat)
                py = rr * v
                if w < hgt:
                    px, py = py, px
            else:
                px, py = w / 2.0 * math.cos(a), hgt / 2.0 * math.sin(a)
            pts.append(vadd(c, vadd(vmul(g['x'], px), vmul(g['y'], py))))
    # end caps
    for c, wc in ((g['case0'], w), (g['case1'], w_end if shape == 'cone' else w)):
        hc = wc if shape == 'cone' else hgt
        for fr in (0.33, 0.66):
            for k in range(nr):
                a = 2 * math.pi * k / nr
                pts.append(vadd(c, vadd(vmul(g['x'], fr * wc / 2.0 * math.cos(a)), vmul(g['y'], fr * hc / 2.0 * math.sin(a)))))
    return pts


def terminal_part(scene, part, at, point, direction, gap, up=None):
    """A part fixed at one end of the route: at='start' (a filter or bellmouth the air enters through;
    its outlet is the start marker) or 'end' (a coupler on the throttle body; its inlet faces the route and
    its outlet is the end marker). Returns the placement with the case's proven gap to the scan."""
    z = vunit(direction)
    oal = float(part['oal'])
    if at == 'start':
        p_in = vsub(point, vmul(z, oal))
    else:
        p_in = vsub(point, vmul(z, oal))
    best = None
    for rot in (0.0, 90.0):
        g = part_geometry(part, p_in, z, rot, up)
        pts = case_points(part, g, step=0.5)
        cap = gap + 6.0
        raw = min(scene.dist_exact(p, cap) for p in pts) if (scene is not None and scene.built) else cap
        d = raw - 0.5 / math.sqrt(2.0)
        if best is None or d > best['gap']:
            best = {'s': 0.0, 'rot': rot, 'axis': z, 'geom': g, 'gap': d, 'ok': d >= gap, 'at': at,
                    'gap_over': raw >= cap - 1e-9}     # nothing within the search distance: the gap is at least this
        if part.get('shape') in ('round', 'cone'):
            break                      # turning a round part changes nothing
    return best


def place_part(scene, path_elems, part, gap, s_range=None, up=None, rots=None, step=1.0, planes=None):
    """Slide the part along a route and turn it about its axis; keep the spot where the case clears
    the scan by the most. Returns the placement (with its clearance proven by exact distances)."""
    total = sum(elem_len(e) for e in path_elems)
    oal = float(part['oal'])
    lo, hi = (s_range or (0.0, total))
    hi = min(hi, total - oal)
    if hi < lo:
        return None
    rots = rots if rots is not None else [0.0, 90.0, 180.0, 270.0, 45.0, 135.0, 225.0, 315.0]
    cands = []
    sp = lo
    while sp <= hi + 1e-9:
        # the axis is the chord from here to oal further on, so the part sits on the route
        p0 = _point_at(path_elems, sp)
        p1 = _point_at(path_elems, sp + oal)
        axis = vunit(vsub(p1, p0))
        for rot in rots:
            g = part_geometry(part, p0, axis, rot, up)
            pts = case_points(part, g, step=1.5)
            d = min(scene.dist_fast(p, gap + 6.0, planes) for p in pts) - scene.e_cover
            cands.append((d, sp, rot, axis))
        sp += step
    if not cands:
        return None
    cands.sort(key=lambda c: -c[0])
    for d, sp, rot, axis in cands[:6]:
        p0 = _point_at(path_elems, sp)
        g = part_geometry(part, p0, axis, rot, up)
        pts = case_points(part, g, step=0.5)
        raw = min(scene.dist_exact(p, gap + 6.0, planes) for p in pts)
        ex = raw - 0.5 / math.sqrt(2.0)
        if ex >= gap:
            return {'s': sp, 'rot': rot, 'axis': axis, 'geom': g, 'gap': ex, 'ok': True, 'gap_over': raw >= gap + 6.0 - 1e-9}
    d, sp, rot, axis = cands[0]
    g = part_geometry(part, _point_at(path_elems, sp), axis, rot, up)
    return {'s': sp, 'rot': rot, 'axis': axis, 'geom': g, 'gap': d, 'ok': False}


def stub_points(center, axis_dir, tube_r, d, h, step=0.6):
    """Points on a cylinder standing on the tube: from the tube surface out by h along axis_dir, diameter d."""
    e1, e2 = perp_basis(axis_dir)
    pts = []
    nl = max(2, int(math.ceil(h / step)) + 1)
    nr = max(12, int(math.ceil(math.pi * d / step)))
    for i in range(nl):
        r = tube_r + h * i / (nl - 1.0)
        c = vadd(center, vmul(axis_dir, r))
        for k in range(nr):
            a = 2 * math.pi * k / nr
            pts.append(vadd(c, vadd(vmul(e1, d / 2.0 * math.cos(a)), vmul(e2, d / 2.0 * math.sin(a)))))
    top = vadd(center, vmul(axis_dir, tube_r + h))
    for fr in (0.33, 0.66):
        for k in range(nr):
            a = 2 * math.pi * k / nr
            pts.append(vadd(top, vadd(vmul(e1, fr * d / 2.0 * math.cos(a)), vmul(e2, fr * d / 2.0 * math.sin(a)))))
    return pts


def place_attachment(scene, pieces, att, gap, up=None, taken=None, planes=None, step=1.0):
    """A weld-on fitting that stands off the tube (a blow-off valve on its flange, a sensor bung): att has
    d (outside diameter, cm), h (height above the tube surface, cm), tube_r (tube outside radius, cm) and
    prefer 'end' (nearest the end of the route, e.g. close to the throttle), 'start' (nearest the start,
    e.g. close to the turbo) or 'mid' (the middle of the longest straight run, with lead / lead_out cm of
    straight tube either side and min_from_end cm from the route end: a MAF sensor pad). It goes only on straight runs, never on a bend (Turbosmart: not on the
    inside radius of a bend), clocked round the tube in 45 deg steps, and must clear the scan by gap and
    any fitting already placed (taken: [(piece, s, d)]). Returns the placement with its proven gap, or None."""
    d, h, tr = float(att['d']), float(att['h']), float(att['tube_r'])
    prefer = att.get('prefer') or 'end'
    # a MAF pad (prefer 'mid'): straight tube of lead before it and lead_out after it on the same run, the pad as
    # near the middle of the longest straight as the scan allows, and at least min_from_end from the route end
    lead = float(att.get('lead') or 0.0)
    lead_out = float(att.get('lead_out') or lead)
    min_from_end = float(att.get('min_from_end') or 0.0)
    order = list(range(len(pieces)))
    if prefer == 'end':
        order.reverse()
    best_any = None
    for pi in order:
        elems = pieces[pi].get('elems') or []
        total = sum(elem_len(e) for e in elems)
        cands = []
        cum = 0.0
        for e in elems:
            L = elem_len(e)
            if e[0] == 'line':
                m = d / 2.0 + 0.5
                u = vunit(vsub(e[2], e[1]))
                t = max(m, lead + d / 2.0)
                t_max = L - max(m, lead_out + d / 2.0)
                while t <= t_max + 1e-9:
                    s = cum + t
                    if min_from_end and total - s < min_from_end:
                        break
                    if not any(q[0] == pi and abs(q[1] - s) < (q[2] + d) / 2.0 + 1.0 for q in (taken or [])):
                        c = vadd(e[1], vmul(u, t))
                        for rot in (0.0, 45.0, 90.0, 135.0, 180.0, 225.0, 270.0, 315.0):
                            x, _y, _z = part_frame(u, rot, up)
                            pts = stub_points(c, x, tr, d, h, step=1.2)
                            df = min(scene.dist_fast(p, gap + 6.0, planes) for p in pts) - scene.e_cover
                            cands.append((df, s, rot, c, x, u, abs(t - L / 2.0) - L))
                    t += step
            cum += L
        if not cands:
            continue
        key = (lambda c: -c[1]) if prefer == 'end' else (lambda c: c[6]) if prefer == 'mid' else (lambda c: c[1])
        good = sorted([c for c in cands if c[0] >= gap], key=key)
        tried = good[:12] + sorted(cands, key=lambda c: -c[0])[:4]
        for df, s, rot, c, x, u, _mid in tried:
            pts = stub_points(c, x, tr, d, h, step=0.5)
            raw = min(scene.dist_exact(p, gap + 6.0, planes) for p in pts)
            ex = raw - 0.5 / math.sqrt(2.0)
            pl = {'piece': pi, 's': s, 'from_end': total - s, 'rot': rot, 'center': c, 'dir': x, 'axis': u,
                  'gap': ex, 'ok': ex >= gap, 'gap_over': raw >= gap + 6.0 - 1e-9}
            if pl['ok']:
                return pl
            if best_any is None or ex > best_any['gap']:
                best_any = pl
    return best_any


def _point_at(elems, s):
    cum = 0.0
    for e in elems:
        L = elem_len(e)
        if cum + L >= s:
            return elem_point(e, 0.0 if L <= 0 else (s - cum) / L)
        cum += L
    return elems[-1][2] if elems[-1][0] == 'line' else elems[-1][2]


def route_with_parts(scene, spec, parts, up=None, log=None):
    """A pipe from start to end with off-the-shelf parts. A part with at='start' sits at the start
    marker (an air filter or bellmouth; the pipe begins at its outlet), at='end' at the end marker
    (a coupler on the throttle body; the pipe ends at its inlet); the rest go in line, in order.
    Each part may ask for its own straight before and after it (lead_in, lead_out, cm), as a MAF
    sensor does; otherwise lead_part (default 2.54 cm) applies."""
    gap = float(spec.get('gap', DEFAULTS['gap']))
    lp = float(spec.get('lead_part', 2.54))
    start_parts = [p for p in parts if p.get('at') == 'start']
    end_parts = [p for p in parts if p.get('at') == 'end']
    attach = [p for p in parts if p.get('attach')]
    inline = [p for p in parts if p.get('at') not in ('start', 'end') and not p.get('attach')]
    placements = []
    S0, D0 = tuple(spec['start']), vunit(tuple(spec['start_dir']))
    E0, DE = tuple(spec['end']), vunit(tuple(spec['end_dir']))
    lead_s = float(spec.get('lead_start') or DEFAULTS['lead_start'])
    lead_e = float(spec.get('lead_end') or DEFAULTS['lead_end'])
    term = []
    for p in start_parts[:1]:
        pl = terminal_part(scene, p, 'start', S0, D0, gap, up)
        term.append((pl, p))
        lead_s = max(lead_s, float(p.get('lead_out') or 0.0))
    for p in end_parts[:1]:
        pl = terminal_part(scene, p, 'end', E0, DE, gap, up)
        term.append((pl, p))
        E0 = pl['geom']['p_in']
        lead_e = max(lead_e, float(p.get('lead_in') or 0.0))
    base = dict(spec, start=S0, start_dir=D0, end=E0, end_dir=DE, lead_start=lead_s, lead_end=lead_e, target=None)
    first = route(scene, base, log=log)
    if not first.get('elems'):
        return {'ok': False, 'msg': first.get('msg'), 'pieces': [], 'parts': [t[0] for t in term], 'part_specs': [t[1] for t in term]}
    total = first['length']
    lin = lambda p: max(lp, float(p.get('lead_in') or 0.0))
    lout = lambda p: max(lp, float(p.get('lead_out') or 0.0))
    s_lo = lead_s + 2.0 * float(spec['clr'])
    for k, part in enumerate(inline):
        s_lo_k = s_lo + lin(part)
        room_after = sum(float(p['oal']) + lin(p) + lout(p) + 2.0 * float(spec['clr']) for p in inline[k + 1:])
        s_hi = total - room_after - lead_e - lout(part) - 2.0 * float(spec['clr']) - float(part['oal'])
        pl = place_part(scene, first['elems'], part, gap, (s_lo_k, s_hi), up=up)
        if pl is None:
            return {'ok': False, 'msg': 'There is no straight enough stretch for %s on this route.' % part.get('name', 'the part'),
                    'pieces': [first], 'parts': placements + [t[0] for t in term], 'part_specs': inline[:k] + [t[1] for t in term]}
        placements.append(pl)
        s_lo = pl['s'] + float(part['oal']) + lout(part) + 2.0 * float(spec['clr'])
    pieces = []
    cur, cur_dir = S0, D0
    lead0 = lead_s
    for pl, part in zip(placements, inline):
        g = pl['geom']
        sp = dict(spec)
        sp.update({'start': cur, 'start_dir': cur_dir, 'end': g['p_in'], 'end_dir': g['z'],
                   'lead_start': lead0, 'lead_end': lin(part), 'target': None})
        pieces.append(route(scene, sp, log=log))
        cur, cur_dir = g['p_out'], g['z']
        lead0 = lout(part)
    sp = dict(spec)
    sp.update({'start': cur, 'start_dir': cur_dir, 'end': E0, 'end_dir': DE, 'lead_start': lead0, 'lead_end': lead_e, 'target': None})
    pieces.append(route(scene, sp, log=log))
    all_pl = placements + [t[0] for t in term]
    atts, taken = [], []
    for a in attach:
        pl = place_attachment(scene, pieces, a, gap, up=up, taken=taken)
        if pl is None:
            atts.append({'ok': False, 'name': a.get('name'), 'msg': 'No straight run long enough for %s.' % a.get('name', 'the fitting')})
            continue
        pl['name'] = a.get('name')
        atts.append(pl)
        taken.append((pl['piece'], pl['s'], float(a['d'])))
    ok = all(p.get('ok') for p in pieces) and all(pl['ok'] for pl in all_pl) and all(a.get('ok') for a in atts)
    return {'ok': ok, 'pieces': pieces, 'parts': all_pl, 'part_specs': inline + [t[1] for t in term],
            'attachments': atts, 'attach_specs': attach,
            'length': sum(p.get('length', 0) for p in pieces) + sum(float(p['oal']) for p in inline)}


# --------------------------------------------------------------------------
# Can it be made? A plain manufacturing report for a routed tube
# --------------------------------------------------------------------------

PRINT_NOTE = ('Metal 3D printing (laser powder-bed fusion) is the other way to make a section this tight. Protolabs '
              'lists 316L stainless, Ti-6Al-4V titanium and Inconel 718 among its printable metals, with a normal build '
              'box of 245 x 245 x 330 mm, walls under 1 mm at high risk of defects, and self-supporting surfaces no '
              'flatter than 45 deg from the build plate (55 deg for 316L). Print just the tight section and weld it to '
              'the tube: for a 304 stainless system that means a 316L print, joined with a 316 filler as ESAB '
              'recommends for 304 to 316. Printed exhaust parts are already sold: Formula Z\'s 316L Z-pipe crossovers and '
              'Ticon\'s Inconel 625 3-into-1 merge collector.')


def fab_report(elems, od, clamp=None, min_clr=None, material=''):
    """Bend count, tightest bend, shortest straight between bends, and plain flags.
    clamp: the straight your bender needs between bends (None = bends cut from mandrel U-bends and
    welded, which needs none). min_clr: the tightest centreline radius you can get or bend."""
    rows = lra_schedule(elems)
    bends = [r for r in rows if r['A'] is not None]
    between = [r['L'] for r in rows[1:-1] if r['A'] is not None]     # straight before bends 2..n
    n = len(bends)
    turn = sum(r['A'] for r in bends)
    clrs = [r['CLR'] for r in bends if r['CLR']]
    out = {'bends': n, 'turn_deg': turn, 'min_clr': min(clrs) if clrs else None,
           'min_between': min(between) if between else None, 'pieces': 1, 'flags': [], 'print': None}
    flags = out['flags']
    tight = False
    if clrs:
        c = min(clrs)
        if min_clr and c < min_clr - 1e-6:
            flags.append('A bend is tighter (%.1f mm centreline radius) than the %.1f mm you can bend.' % (10 * c, 10 * min_clr))
            tight = True
        if c < 1.0 * od - 1e-6:
            flags.append('A bend radius is under one tube diameter. The tightest mandrel bends on the parts list are '
                         '1D (Stainless Bros, JMD), so this needs pie cuts (mitred segments) or a printed elbow.')
            tight = True
    if clamp:
        short = [L for L in between if L < clamp - 1e-6]
        if short:
            out['pieces'] = 1 + len(short)
            flags.append('%d straight%s between bends %s shorter than the %.0f mm your bender clamps, so this tube '
                         'is built as %d welded pieces (cut from mandrel bends), not bent from one length.' % (
                             len(short), '' if len(short) == 1 else 's', 'is' if len(short) == 1 else 'are',
                             10 * clamp, out['pieces']))
    if n > 6 or turn > 540.0:
        flags.append('Complex: %d bends turning %.0f deg in total. Expect a lot of fitting and welding.' % (n, turn))
    if tight:
        out['print'] = PRINT_NOTE
    return out
