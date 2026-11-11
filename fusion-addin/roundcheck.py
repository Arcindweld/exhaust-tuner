"""Is a round part's mesh actually round? Slice a triangle mesh (an STL, or Fusion's vertex and index arrays) at
stations along its axis, or square to a bent tube's centreline, and measure every section: the best-fit circle of each
closed loop (the outside and the bore separately), how far the loop strays from it, how many flat facets go round it
and the chord (sagitta) error those facets make. Pure Python, no Fusion: cadtools runs it on every STL it writes, and
it runs on its own from the command line on any STL made elsewhere (a CAD script, another program):

   python3 roundcheck.py part.stl [--axis x,y,z] [--point x,y,z] [--centreline pts.csv] [--stations 25]
                                  [--dev 0.05] [--sag 0.02] [--json]

Exit code 0 when every section is round, 1 when one is not, 2 when it could not be checked. Units are mm (the STL is
read as millimetres, which is what the add-in and most CAD programs write). Every length in the summary is given in
mm and inches.

Why this exists: a printed reducer (a round tube tapering between two diameters) came out "not perfectly round" in
the taper. The usual causes are (a) the mesh exported too coarsely (Fusion's 'high' mesh quality sets the surface
tolerance from the part's bounding box, about 0.04 mm on a 300 mm long 100 mm tube, which leaves about 80 flat
facets round the circle), (b) a taper made by lofting between sections instead of revolving a profile, so the
sections between drift from circular, (c) a seam or twist between loft sections. The standing rule since: tapers are
revolved, meshes are exported so the facets are finer than the printer resolves, and roundness is measured on the
exported mesh before the file is handed over. This module is the measurement.

Method, per section:
  - the plane cuts every triangle it crosses; the cut points are chained into loops through the shared triangle
    edges (vertices are welded first, so an STL's triangle soup chains too, and open chains whose ends meet within
    JOIN_MM are joined, for meshes written face by face);
  - points that lie on one straight line (one flat facet crossed through its diagonal) are merged, which leaves the
    loop's corners: one straight side per facet the slice crosses, so the side count is the facet count round it;
  - a circle is fitted to the corners (algebraic fit, then Gauss-Newton on the true distances);
  - the radial deviation is measured over the whole polygon, its corners and every point of its straight sides (a
    side's nearest point to the centre is its lowest), so a coarse mesh shows up both as a large deviation and as a
    large chord error; out-of-roundness is the largest radius less the smallest;
  - the chord (sagitta) error of each side is how far its middle sags inside the circle through its two ends,
    (r_a + r_b) / 2 - (distance from the centre to the side); for n even facets round a radius r it is
    r (1 - cos(pi / n)), so a sagitta s needs n >= pi / acos(1 - s / r) facets (facets_for);
  - the loops that enclose the axis are the ones judged, largest first: 'outer', 'bore', then any more (a double
    wall); loops beside the axis (a boss, a bracket) are counted and not judged.
A section is round when every judged loop has deviation <= DEV_TOL_MM and sagitta <= SAG_TOL_MM.

The axis, when not given (find_axis): the axis of best rotational symmetry. The surface's area-weighted second
moments give three principal directions; a body of revolution has its axis along one of them (the one whose moment
differs from the other two, which are equal). Each of the three is tried: the mesh is sliced square to it, a circle
is fitted to the outer loop of each slice, and the axis is moved onto the line through the circle centres (a tilted
slice of a cylinder is an ellipse centred on the true axis, so this converges in a step or two; a cone converges
too). The candidate whose slices come out roundest (lowest median RMS deviation over radius) wins. Limits: it finds
one straight axis, so a tube with bends needs its centreline (centreline=, --centreline) and is then sliced square to
it; big lopsided additions (a bracket, a flange off to one side) pull the moments but the circle-centre step corrects
them while the slices still enclose the axis; a part with no round section at all (a box) gets an axis but fails,
which is right. Slices sit at (i + 0.5) / N along the length, so none falls on a flat end face.

The tolerances (DEV_TOL_MM, SAG_TOL_MM, EXPORT_SAG_MM) and why: see the comments where they are set."""
import json
import math
import os
import struct
import sys

IN = 25.4

# The defaults, against what an FDM printer with a 0.4 mm nozzle can show:
#  - SAG_TOL_MM 0.02: the slicer itself redraws every outline before printing. Cura's 'Maximum Deviation'
#    (meshfix_maximum_deviation) defaults to 0.025 mm: the outline may move up to that when Cura drops vertices
#    (verified in Cura's resources/definitions/fdmprinter.def.json). PrusaSlicer's 'resolution' (input
#    simplification) defaults to 0, no simplification (verified in its manual page), so there the mesh's facets go
#    straight to the toolpath. A chord error at or under 0.02 mm stays below what Cura already allows itself, and
#    is a twentieth of the 0.4 mm nozzle: the facets cannot be the visible error. 0.02 rather than 0.025 is a
#    judgement (a margin under the slicer's own figure).
#  - DEV_TOL_MM 0.05: the shape error a section may have from a true circle (lobing, drift between loft sections, a
#    seam). A judgement: an eighth of the nozzle width and well under the 0.1 to 0.2 mm that FDM parts typically
#    hold across a diameter, so a mesh that passes adds nothing the printer would show; the 0.2 mm three-lobe taper
#    in the tests fails it by four times.
#  - EXPORT_SAG_MM 0.01: what the add-in asks Fusion's mesher for, half the check's limit, so a mesh made to it
#    passes with margin even where the mesher lands a little over its tolerance.
DEV_TOL_MM = 0.05
SAG_TOL_MM = 0.02
EXPORT_SAG_MM = 0.01
MAX_TRIANGLES = 3000000      # 150 MB as binary STL; over it the add-in relaxes to SAG_TOL_MM (still passes the check)
JOIN_MM = 0.05               # open chain ends this close are joined (meshes written face by face)
STATIONS = 25


# ------------------------------------------------------------------------------------------------ small helpers

def mm_in(v, dp=None):
    """'0.406 mm (0.0160 in)': every length the owner reads is in both units."""
    a = abs(v)
    if dp is None:
        dp = 3 if a < 10 else (2 if a < 100 else 1)
    return '%.*f mm (%.*f in)' % (dp, v, dp + 1, v / IN)


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _mul(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(a):
    n = math.sqrt(_dot(a, a))
    if n <= 0:
        raise ValueError('zero-length direction')
    return (a[0] / n, a[1] / n, a[2] / n)


def _basis(n):
    """Two unit vectors square to n and to each other (u, w, n right-handed)."""
    a = (1.0, 0.0, 0.0) if abs(n[0]) < 0.9 else (0.0, 1.0, 0.0)
    u = _unit(_cross(a, n))
    return u, _cross(n, u)


def _median(xs):
    s = sorted(xs)
    n = len(s)
    return 0.0 if not n else (s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2]))


# ------------------------------------------------------------------------------------------------ facet arithmetic

def sagitta(r, n):
    """Chord error of n even facets round a circle of radius r: r (1 - cos(pi / n))."""
    return r * (1.0 - math.cos(math.pi / n))


def facets_for(r, s):
    """Fewest even facets round radius r for a chord error no more than s: n >= pi / acos(1 - s / r)."""
    if r <= 0 or s <= 0:
        raise ValueError('radius and sagitta must be positive')
    if s >= r:
        return 3
    return max(3, int(math.ceil(math.pi / math.acos(1.0 - s / r) - 1e-9)))


def mesh_settings(r_mm, sag_mm=EXPORT_SAG_MM):
    """Fusion TriangleMeshCalculator settings for a chord error <= sag_mm round the part's largest circle r_mm:
    surfaceTolerance is the largest distance the mesh may stray from the surface, in cm (API reference); for a
    circle that distance is the sagitta. maxNormalDeviation is the largest angle between adjacent vertex normals, in
    radians (API reference); round a circle of n facets adjacent vertex normals are 2 pi / n apart, so 2 pi / n holds
    the largest circle to n facets even if the mesher were to round the tolerance up. Smaller circles get the same
    angle per facet, so more facets than their sagitta needs: a few more triangles, never fewer."""
    n = facets_for(r_mm, sag_mm)
    return {'facets': n, 'sagitta_mm': sagitta(r_mm, n), 'surface_tolerance_cm': sag_mm / 10.0,
            'max_normal_deviation_rad': 2.0 * math.pi / n, 'r_mm': r_mm, 'target_sag_mm': sag_mm}


def preset_facets(r_mm, bbox_diag_mm, lod=13):
    """Facets round radius r_mm that Fusion's setQuality preset gives: the API reference sets the surface tolerance
    to the bounding box diameter / 2^LOD (High = 13, Very high = 15). For comparison only."""
    tol = bbox_diag_mm / float(2 ** lod)
    return facets_for(r_mm, tol), tol


# ------------------------------------------------------------------------------------------------ mesh input

def _weld(points, q=1e-5):
    """Shared vertices from a list of points: (vertices, map from each input point to its vertex)."""
    key_of, verts, idx = {}, [], []
    inv = 1.0 / q
    for p in points:
        k = (round(p[0] * inv), round(p[1] * inv), round(p[2] * inv))
        j = key_of.get(k)
        if j is None:
            j = key_of[k] = len(verts)
            verts.append((float(p[0]), float(p[1]), float(p[2])))
        idx.append(j)
    return verts, idx


def _soup(points):
    """Welded mesh from a triangle soup (every three points one triangle); degenerate triangles dropped."""
    verts, idx = _weld(points)
    tris = []
    for t in range(len(idx) // 3):
        a, b, c = idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]
        if a != b and b != c and a != c:
            tris.append((a, b, c))
    return verts, tris


def read_stl(data):
    """Vertices and triangles from STL bytes, binary or ASCII (a binary file whose 80-byte header starts with 'solid'
    is told by its size: 84 + 50 bytes per triangle)."""
    if isinstance(data, str):
        data = data.encode('latin-1')
    data = bytes(data)
    if len(data) >= 84:
        n = struct.unpack_from('<I', data, 80)[0]
        if len(data) == 84 + 50 * n or (not data[:5].lower() == b'solid' and 84 + 50 * n <= len(data)):
            pts = []
            for rec in struct.iter_unpack('<12fH', data[84:84 + 50 * n]):
                pts += [rec[3:6], rec[6:9], rec[9:12]]
            return _soup(pts)
    text = data.decode('latin-1')
    pts = []
    for line in text.splitlines():
        w = line.split()
        if len(w) == 4 and w[0].lower() == 'vertex':
            pts.append((float(w[1]), float(w[2]), float(w[3])))
    if not pts:
        raise ValueError('Not an STL: no triangles found.')
    return _soup(pts)


def as_mesh(mesh):
    """(vertices, triangles) from STL bytes, a path to an STL, or (vertices, indices) where vertices are 3-tuples or
    a flat list of numbers (Fusion's nodeCoordinates) and indices are 3-tuples or a flat list (nodeIndices)."""
    if isinstance(mesh, (bytes, bytearray, memoryview)):
        return read_stl(mesh)
    if isinstance(mesh, str):
        with open(mesh, 'rb') as fh:
            return read_stl(fh.read())
    V, T = mesh
    V, T = list(V), list(T)
    if V and not hasattr(V[0], '__len__'):
        V = [(V[3 * i], V[3 * i + 1], V[3 * i + 2]) for i in range(len(V) // 3)]
    if T and not hasattr(T[0], '__len__'):
        T = [(T[3 * i], T[3 * i + 1], T[3 * i + 2]) for i in range(len(T) // 3)]
    return _soup([V[i] for t in T for i in t])


# ------------------------------------------------------------------------------------------------ moments, axis

def surface_moments(V, T):
    """Area, area centroid and central second-moment matrix of the surface (exact per triangle:
    integral of x x^T over a triangle = A/12 (sum v v^T + S S^T), S the sum of its corners)."""
    A = 0.0
    m = [0.0, 0.0, 0.0]
    M = [[0.0] * 3 for _ in range(3)]
    for a, b, c in T:
        pa, pb, pc = V[a], V[b], V[c]
        cr = _cross(_sub(pb, pa), _sub(pc, pa))
        ar = 0.5 * math.sqrt(_dot(cr, cr))
        if ar <= 0:
            continue
        A += ar
        S = _add(_add(pa, pb), pc)
        for i in range(3):
            m[i] += ar * S[i] / 3.0
            for j in range(i, 3):
                M[i][j] += ar / 12.0 * (pa[i] * pa[j] + pb[i] * pb[j] + pc[i] * pc[j] + S[i] * S[j])
    if A <= 0:
        raise ValueError('The mesh has no area.')
    c = (m[0] / A, m[1] / A, m[2] / A)
    C = [[0.0] * 3 for _ in range(3)]
    for i in range(3):
        for j in range(i, 3):
            C[i][j] = C[j][i] = M[i][j] / A - c[i] * c[j]
    return A, c, C


def eig3(M):
    """Eigenvalues and unit eigenvectors of a symmetric 3x3 (Jacobi)."""
    a = [row[:] for row in M]
    v = [[1.0 if i == j else 0.0 for j in range(3)] for i in range(3)]
    for _ in range(60):
        off = max(abs(a[0][1]), abs(a[0][2]), abs(a[1][2]))
        if off < 1e-15 * max(1e-300, abs(a[0][0]) + abs(a[1][1]) + abs(a[2][2])):
            break
        for p, q in ((0, 1), (0, 2), (1, 2)):
            if abs(a[p][q]) < 1e-300:
                continue
            th = 0.5 * math.atan2(2 * a[p][q], a[q][q] - a[p][p])
            c, s = math.cos(th), math.sin(th)
            for k in range(3):
                akp, akq = a[k][p], a[k][q]
                a[k][p], a[k][q] = c * akp - s * akq, s * akp + c * akq
            for k in range(3):
                apk, aqk = a[p][k], a[q][k]
                a[p][k], a[q][k] = c * apk - s * aqk, s * apk + c * aqk
            for k in range(3):
                vkp, vkq = v[k][p], v[k][q]
                v[k][p], v[k][q] = c * vkp - s * vkq, s * vkp + c * vkq
    vals = [a[i][i] for i in range(3)]
    vecs = [_unit((v[0][i], v[1][i], v[2][i])) for i in range(3)]
    return vals, vecs


# ------------------------------------------------------------------------------------------------ slicing

class _Axial(object):
    """Triangles bucketed by their span along a straight axis, for slicing square to it."""

    def __init__(self, V, T, p, a, nb=200):
        self.h = [_dot(_sub(q, p), a) for q in V]
        h = self.h
        lo, hi = min(h), max(h)
        self.lo, self.hi = lo, hi
        self.bw = max(1e-9, (hi - lo) / nb)
        self.nb = nb
        self.b = [[] for _ in range(nb + 1)]
        for t, (i, j, k) in enumerate(T):
            a0, a1 = min(h[i], h[j], h[k]), max(h[i], h[j], h[k])
            for bi in range(int((a0 - lo) / self.bw), min(nb, int((a1 - lo) / self.bw)) + 1):
                self.b[bi].append(t)

    def near(self, z):
        bi = int((z - self.lo) / self.bw)
        return self.b[bi] if 0 <= bi <= self.nb else []


class _Grid(object):
    """Triangles in a uniform grid of cubes by their bounding boxes, for slicing square to a curved centreline."""

    def __init__(self, V, T, cell):
        self.c = cell
        self.g = {}
        for t, (i, j, k) in enumerate(T):
            a, b, d = V[i], V[j], V[k]
            lo = [int(math.floor(min(a[x], b[x], d[x]) / cell)) for x in range(3)]
            hi = [int(math.floor(max(a[x], b[x], d[x]) / cell)) for x in range(3)]
            for gx in range(lo[0], hi[0] + 1):
                for gy in range(lo[1], hi[1] + 1):
                    for gz in range(lo[2], hi[2] + 1):
                        self.g.setdefault((gx, gy, gz), []).append(t)

    def near(self, o, reach):
        c = self.c
        lo = [int(math.floor((o[x] - reach) / c)) for x in range(3)]
        hi = [int(math.floor((o[x] + reach) / c)) for x in range(3)]
        out = set()
        for gx in range(lo[0], hi[0] + 1):
            for gy in range(lo[1], hi[1] + 1):
                for gz in range(lo[2], hi[2] + 1):
                    out.update(self.g.get((gx, gy, gz), ()))
        return out


def section(V, T, cand, o, n, join=JOIN_MM):
    """The loops where the plane through o square to the unit vector n cuts the triangles cand (indices into T), in
    the plane's own 2-D coordinates (u, w from _basis(n), origin o): [(closed, [(x, y), ...]), ...]."""
    u, w = _basis(n)
    dist = {}

    def d(i):
        v = dist.get(i)
        if v is None:
            q = V[i]
            v = dist[i] = (q[0] - o[0]) * n[0] + (q[1] - o[1]) * n[1] + (q[2] - o[2]) * n[2]
        return v
    pt, segs = {}, []
    for t in cand:
        tri = T[t]
        ds = (d(tri[0]), d(tri[1]), d(tri[2]))
        sg = (ds[0] >= 0, ds[1] >= 0, ds[2] >= 0)     # on the plane counts as above: each vertex gets one side
        if sg[0] == sg[1] == sg[2]:
            continue
        es = []
        for x, y in ((0, 1), (1, 2), (2, 0)):
            if sg[x] != sg[y]:
                a, b = tri[x], tri[y]
                key = (a, b) if a < b else (b, a)
                if key not in pt:
                    pa, pb = V[key[0]], V[key[1]]
                    da, db = d(key[0]), d(key[1])
                    f = da / (da - db)
                    p = (pa[0] + (pb[0] - pa[0]) * f - o[0], pa[1] + (pb[1] - pa[1]) * f - o[1], pa[2] + (pb[2] - pa[2]) * f - o[2])
                    pt[key] = (_dot(p, u), _dot(p, w))
                es.append(key)
        if len(es) == 2:
            segs.append(es)
    adj = {}
    for s, (a, b) in enumerate(segs):
        adj.setdefault(a, []).append(s)
        adj.setdefault(b, []).append(s)
    used = [False] * len(segs)

    def walk(chain):
        cur = chain[-1]
        while True:
            nxt = None
            for s in adj[cur]:
                if not used[s]:
                    nxt = s
                    break
            if nxt is None:
                return False
            used[nxt] = True
            a, b = segs[nxt]
            cur = b if a == cur else a
            if cur == chain[0]:
                return True
            chain.append(cur)
    chains = []
    for s0 in range(len(segs)):
        if used[s0]:
            continue
        used[s0] = True
        chain = list(segs[s0])
        closed = walk(chain)
        if not closed:
            back = [chain[0]]
            walk(back)
            chain = back[::-1][:-1] + chain
        chains.append([closed, [pt[e] for e in chain]])
    # join open chains end to end (a mesh written face by face whose edges do not share vertices exactly)
    opens = [c for c in chains if not c[0]]
    loops = [c for c in chains if c[0]]
    j2 = join * join
    close = lambda p, q: (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= j2
    while opens:
        cur = opens.pop()
        grown = True
        while grown and not cur[0]:
            grown = False
            for k, o2 in enumerate(opens):
                a, b = o2[1][0], o2[1][-1]
                if close(cur[1][-1], a):
                    cur[1] += o2[1]
                elif close(cur[1][-1], b):
                    cur[1] += o2[1][::-1]
                elif close(cur[1][0], b):
                    cur[1] = o2[1] + cur[1]
                elif close(cur[1][0], a):
                    cur[1] = o2[1][::-1] + cur[1]
                else:
                    continue
                opens.pop(k)
                grown = True
                break
            if not grown and len(cur[1]) > 2 and close(cur[1][0], cur[1][-1]):
                cur[0] = True           # closes on itself only once no other piece fits at either end
        loops.append(cur)
    return loops


# ------------------------------------------------------------------------------------------------ one loop

def _area(P):
    s = 0.0
    for i in range(len(P)):
        x0, y0 = P[i - 1]
        x1, y1 = P[i]
        s += x0 * y1 - x1 * y0
    return 0.5 * s


def _inside(P, x, y):
    c = False
    j = len(P) - 1
    for i in range(len(P)):
        xi, yi = P[i]
        xj, yj = P[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


def _line_dist(a, b, p):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    if L < 1e-12:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    return abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / L


def _seg_dist(a, b, c):
    """Distance from c to the segment a-b."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 < 1e-24 else max(0.0, min(1.0, ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / L2))
    return math.hypot(a[0] + t * dx - c[0], a[1] + t * dy - c[1])


def corners(P, eps):
    """The loop's corners: points within eps of the straight line between their neighbours on either side are
    dropped, so each straight side left is one facet. Starts at the sharpest point so no side is split in two."""
    m = len(P)
    if m < 4:
        return list(P)
    k0 = max(range(m), key=lambda i: _line_dist(P[i - 1], P[(i + 1) % m], P[i]))
    Q = P[k0:] + P[:k0] + [P[k0]]
    out, a = [Q[0]], 0
    while a < m:
        k = a + 1
        while k + 1 <= m and all(_line_dist(Q[a], Q[k + 1], Q[q]) <= eps for q in range(a + 1, k + 1)):
            k += 1
        if k >= m:
            break
        out.append(Q[k])
        a = k
    return out


def fit_circle(P):
    """Best-fit circle (cx, cy, r) through 2-D points: the algebraic (Kasa) fit, then Gauss-Newton on the geometric
    distances."""
    n = len(P)
    mx = sum(p[0] for p in P) / n
    my = sum(p[1] for p in P) / n
    Q = [(p[0] - mx, p[1] - my) for p in P]
    Sxx = sum(x * x for x, _ in Q)
    Syy = sum(y * y for _, y in Q)
    Sxy = sum(x * y for x, y in Q)
    Sxz = sum(x * (x * x + y * y) for x, y in Q)
    Syz = sum(y * (x * x + y * y) for x, y in Q)
    det = Sxx * Syy - Sxy * Sxy
    if abs(det) < 1e-300:
        raise ValueError('points on a line')
    cx = 0.5 * (Sxz * Syy - Syz * Sxy) / det
    cy = 0.5 * (Syz * Sxx - Sxz * Sxy) / det
    r = math.sqrt(max(0.0, cx * cx + cy * cy + (Sxx + Syy) / n))
    for _ in range(20):
        JtJ = [[0.0] * 3 for _ in range(3)]
        Jtr = [0.0] * 3
        for x, y in Q:
            dx, dy = x - cx, y - cy
            dd = math.hypot(dx, dy) or 1e-12
            J = (-dx / dd, -dy / dd, -1.0)
            res = dd - r
            for i in range(3):
                Jtr[i] += J[i] * res
                for j in range(3):
                    JtJ[i][j] += J[i] * J[j]
        step = _solve3(JtJ, [-v for v in Jtr])
        if step is None:
            break
        cx, cy, r = cx + step[0], cy + step[1], r + step[2]
        if abs(step[0]) + abs(step[1]) + abs(step[2]) < 1e-12 * (1.0 + r):
            break
    return cx + mx, cy + my, abs(r)


def _solve3(A, b):
    M = [A[i][:] + [b[i]] for i in range(3)]
    for c in range(3):
        p = max(range(c, 3), key=lambda r: abs(M[r][c]))
        if abs(M[p][c]) < 1e-300:
            return None
        M[c], M[p] = M[p], M[c]
        for r in range(3):
            if r != c:
                f = M[r][c] / M[c][c]
                for k in range(c, 4):
                    M[r][k] -= f * M[c][k]
    return [M[i][3] / M[i][i] for i in range(3)]


def analyse_loop(P, tol_dev=DEV_TOL_MM, tol_sag=SAG_TOL_MM):
    """One closed loop (2-D points, mm): its circle, deviation, out-of-roundness, facets and chord error."""
    Q = []
    for p in P:
        if not Q or math.hypot(p[0] - Q[-1][0], p[1] - Q[-1][1]) > 1e-7:
            Q.append(p)
    if len(Q) > 1 and math.hypot(Q[0][0] - Q[-1][0], Q[0][1] - Q[-1][1]) <= 1e-7:
        Q.pop()
    if len(Q) < 3:
        return None
    if _area(Q) < 0:
        Q.reverse()
    size = max(math.hypot(p[0] - Q[0][0], p[1] - Q[0][1]) for p in Q)
    eps = max(2e-4, 2e-6 * size)                  # float32 STL coordinates resolve about 1e-5 mm at 300 mm
    C = corners(Q, eps)
    if len(C) < 3:
        C = Q
    cx, cy, R = fit_circle(C)
    rc = [math.hypot(p[0] - cx, p[1] - cy) for p in C]
    sides = len(C)
    rmin, sag, acc, wsum = min(rc), 0.0, 0.0, 0.0
    for i in range(sides):
        a, b = C[i], C[(i + 1) % sides]
        dseg = _seg_dist(a, b, (cx, cy))
        rmin = min(rmin, dseg)
        sag = max(sag, 0.5 * (rc[i] + rc[(i + 1) % sides]) - dseg)
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        for f in (0.0, 0.25, 0.5, 0.75):
            q = (a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]))
            acc += (L / 4.0) * (math.hypot(q[0] - cx, q[1] - cy) - R) ** 2
            wsum += L / 4.0
    rmax = max(rc)
    dev = max(rmax - R, R - rmin)
    out = {'cx': cx, 'cy': cy, 'r_mm': R, 'd_mm': 2 * R, 'dev_max_mm': dev,
           'dev_rms_mm': math.sqrt(acc / wsum) if wsum > 0 else 0.0, 'oor_mm': rmax - rmin,
           'facets': sides, 'sag_mm': sag, 'sag_implied_mm': sagitta(R, sides) if sides >= 3 else R,
           'area_mm2': abs(_area(Q))}
    why = []
    if dev > tol_dev:
        why.append('deviation %s over %s' % (mm_in(dev), mm_in(tol_dev)))
    if sag > tol_sag:
        why.append('chord error %s over %s (%d facets)' % (mm_in(sag), mm_in(tol_sag), sides))
    out['round'] = not why
    out['why'] = why
    return out


# ------------------------------------------------------------------------------------------------ stations

def _judge(V, T, cand, o, n, tol_dev, tol_sag, join=JOIN_MM):
    """Slice and judge one station: status and its loops (the ones enclosing o)."""
    loops = section(V, T, cand, o, n, join)
    if not loops:
        return {'status': 'empty', 'loops': [], 'other': 0, 'open': 0}
    u, w = _basis(n)
    enc, other, opened = [], 0, 0
    for closed, P in loops:
        if not closed:
            if sum(math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) for i in range(1, len(P))) > 4 * join:
                opened += 1             # a sliver shorter than that is a meshing crumb beside a loop, not a gap in it
            continue
        if len(P) >= 3 and _inside(P, 0.0, 0.0):
            enc.append(P)
        else:
            other += 1
    res = []
    for P in enc:
        a = analyse_loop(P, tol_dev, tol_sag)
        if a is not None:
            a['centre'] = _add(o, _add(_mul(u, a['cx']), _mul(w, a['cy'])))
            res.append(a)
    res.sort(key=lambda a: -a['area_mm2'])
    for k, a in enumerate(res):
        a['role'] = 'outer' if k == 0 else ('bore' if k == 1 else 'wall %d' % (k + 1))
    if any(not a['round'] for a in res):
        st = 'not round'
    elif opened:
        st = 'open'
    elif not res:
        st = 'no section'
    else:
        st = 'round'
    return {'status': st, 'loops': res, 'other': other, 'open': opened}


def _axis_pass(V, T, p, a, n_st, tol_dev=DEV_TOL_MM, tol_sag=SAG_TOL_MM, buckets=None):
    """Slice square to the straight axis (p, a) at n_st stations; returns (stations, axial index)."""
    ax = buckets or _Axial(V, T, p, a)
    L = ax.hi - ax.lo
    out = []
    for i in range(n_st):
        z = ax.lo + (i + 0.5) / n_st * L
        o = _add(p, _mul(a, z))
        r = _judge(V, T, ax.near(z), o, a, tol_dev, tol_sag)
        r['s_mm'] = z - ax.lo
        r['point'] = o
        out.append(r)
    return out, ax


def _line_through(points, a_hint):
    """Least-squares line (point, unit direction) through 3-D points; the direction keeps a_hint's sense."""
    n = len(points)
    c = tuple(sum(p[k] for p in points) / n for k in range(3))
    C = [[sum((p[i] - c[i]) * (p[j] - c[j]) for p in points) / n for j in range(3)] for i in range(3)]
    vals, vecs = eig3(C)
    d = vecs[max(range(3), key=lambda k: vals[k])]
    if _dot(d, a_hint) < 0:
        d = _mul(d, -1.0)
    return c, d


def find_axis(V, T, stations=9, fixed_dir=None):
    """The axis of best rotational symmetry: (point, unit direction, info). See the module notes for the method."""
    A, c, C = surface_moments(V, T)
    vals, vecs = eig3(C)
    if fixed_dir is not None:
        cands = [_unit(fixed_dir)]
    else:
        # the most distinct moment first: a body of revolution has two equal moments and its axis on the third
        dist = [min(abs(vals[k] - vals[j]) for j in range(3) if j != k) for k in range(3)]
        cands = [vecs[k] for k in sorted(range(3), key=lambda k: -dist[k])]
    tried = []
    for a in cands:
        p = c
        score, good = None, 0
        for _it in range(5):
            sts, _ax = _axis_pass(V, T, p, a, stations)
            cen, rel = [], []
            for s in sts:
                if s['loops']:
                    o = s['loops'][0]
                    cen.append(o['centre'])
                    rel.append(o['dev_rms_mm'] / max(1e-9, o['r_mm']))
            good = len(cen)
            if good < 2:
                score = None
                break
            score = _median(rel)
            p2, a2 = _line_through(cen, a)
            if fixed_dir is not None:
                a2 = a
                p2 = _sub(p2, _mul(a, _dot(_sub(p2, p), a)))
            moved = math.sqrt(max(0.0, 1.0 - min(1.0, abs(_dot(a2, a))) ** 2)) + math.dist(p2, p) * 1e-3
            p, a = p2, a2
            if moved < 1e-9:
                break
        if score is not None:
            tried.append((score, -good, p, a))
            if score < 2e-4 and good >= stations - 1:
                break                           # round to 0.01 mm in 50: this is the axis
    if not tried:
        return None, None, {'why': 'no slice in any principal direction gave a closed section round the middle '
                                   '(an open mesh, or not a tube or ring at all)'}
    tried.sort(key=lambda t: (t[0], t[1]))
    score, ng, p, a = tried[0]
    return p, a, {'score': score, 'candidates': len(tried), 'moments': vals}


def _polyline(P):
    """Arc lengths and vertex tangents (bisectors at the joints) of a centreline polyline."""
    P = [tuple(float(x) for x in q) for q in P]
    Q = [P[0]]
    for q in P[1:]:
        if math.dist(q, Q[-1]) > 1e-9:
            Q.append(q)
    if len(Q) < 2:
        raise ValueError('The centreline needs at least two distinct points.')
    s = [0.0]
    for i in range(1, len(Q)):
        s.append(s[-1] + math.dist(Q[i - 1], Q[i]))
    segd = [_unit(_sub(Q[i + 1], Q[i])) for i in range(len(Q) - 1)]
    tan = [segd[0]] + [_unit(_add(segd[i - 1], segd[i])) for i in range(1, len(Q) - 1)] + [segd[-1]]
    return Q, s, tan


def _at(Q, s, tan, z):
    """Point and unit tangent at arc length z."""
    if z <= s[0]:
        return Q[0], tan[0]
    for i in range(1, len(s)):
        if z <= s[i] or i == len(s) - 1:
            L = s[i] - s[i - 1]
            f = 0.0 if L <= 0 else min(1.0, (z - s[i - 1]) / L)
            p = _add(Q[i - 1], _mul(_sub(Q[i], Q[i - 1]), f))
            t = _add(_mul(tan[i - 1], 1.0 - f), _mul(tan[i], f))
            return p, _unit(t)


def _reach(V, Q):
    """How far the mesh reaches from the centreline (a sample of vertices against a thinned polyline), plus margin."""
    step = max(1, len(V) // 2000)
    k = max(1, len(Q) // 150)
    R = Q[::k]
    if R[-1] != Q[-1]:
        R.append(Q[-1])
    thin = 0.0                       # how far the thinned polyline cuts the corners of the full one
    for i in range(len(Q)):
        j = min(len(R) - 2, i // k)
        thin = max(thin, _seg3(R[j], R[j + 1], Q[i]))
    far = 0.0
    for q in V[::step]:
        far = max(far, min(_seg3(R[i], R[i + 1], q) for i in range(len(R) - 1)))
    return 1.15 * far + 2.0 + thin


def _seg3(a, b, p):
    d = _sub(b, a)
    L2 = _dot(d, d)
    t = 0.0 if L2 <= 0 else max(0.0, min(1.0, _dot(_sub(p, a), d) / L2))
    return math.dist(_add(a, _mul(d, t)), p)


# ------------------------------------------------------------------------------------------------ the check

def check(mesh, axis=None, point=None, centreline=None, stations=STATIONS, tol_dev=DEV_TOL_MM, tol_sag=SAG_TOL_MM,
          skip=(), span=None, s_start=0.0, name=None):
    """Slice the mesh and judge every section. mesh: see as_mesh. Straight parts: axis (a direction; found when
    None) and point (on the axis; found when None). Bent tubes: centreline, a polyline (mm) along the tube's middle,
    sliced square to it. skip: (s0, s1) ranges (mm along the axis from the part's start, or along the centreline in
    the caller's own measure: the centreline's first point is at s_start) not judged, e.g. embossed lettering.
    span: (s0, s1) to place the stations in, same measure (default: the whole length). Returns the report (see
    summary for the words)."""
    V, T = as_mesh(mesh)
    rep = {'triangles': len(T), 'vertices': len(V), 'tol_dev_mm': tol_dev, 'tol_sag_mm': tol_sag, 'name': name,
           'stations': [], 'skip': [list(s) for s in skip]}
    if not T:
        rep.update(verdict='not checked', ok=False, why='The mesh has no triangles.')
        rep['summary'] = summary(rep)
        return rep
    if centreline is not None:
        Q, s, tan = _polyline(centreline)
        reach = _reach(V, Q)
        grid = _Grid(V, T, reach)
        a0, a1 = (s_start, s_start + s[-1]) if span is None else (max(s_start, span[0]), min(s_start + s[-1], span[1]))
        rep['mode'] = 'centreline'
        rep['length_mm'] = s[-1]
        for i in range(stations):
            z = a0 + (i + 0.5) / stations * (a1 - a0)
            o, t = _at(Q, s, tan, z - s_start)
            if any(lo <= z <= hi for lo, hi in skip):
                r = {'status': 'skipped', 'loops': [], 'other': 0, 'open': 0}
            else:
                r = _judge(V, T, grid.near(o, reach), o, t, tol_dev, tol_sag)
            r['s_mm'] = z
            r['point'] = o
            r['normal'] = t
            rep['stations'].append(r)
    else:
        if axis is not None and point is not None:
            p, a, info = tuple(point), _unit(axis), {'given': True}
        else:
            p, a, info = find_axis(V, T, fixed_dir=axis)
            if p is None:
                rep.update(verdict='not checked', ok=False, why='No axis found: ' + info['why'] + '. Give the axis, or '
                           'the centreline for a tube with bends.', mode='axis')
                rep['summary'] = summary(rep)
                return rep
        rep['mode'] = 'axis'
        rep['axis'] = {'point': p, 'direction': a, 'found': axis is None or point is None}
        ax = _Axial(V, T, p, a)
        L = ax.hi - ax.lo
        rep['length_mm'] = L
        a0, a1 = (0.0, L) if span is None else (max(0.0, span[0]), min(L, span[1]))
        for i in range(stations):
            sz = a0 + (i + 0.5) / stations * (a1 - a0)
            z = ax.lo + sz
            o = _add(p, _mul(a, z))
            if any(lo <= sz <= hi for lo, hi in skip):
                r = {'status': 'skipped', 'loops': [], 'other': 0, 'open': 0}
            else:
                r = _judge(V, T, ax.near(z), o, a, tol_dev, tol_sag)
            r['s_mm'] = sz
            r['point'] = o
            r['normal'] = a
            rep['stations'].append(r)
    sts = rep['stations']
    judged = [s for s in sts if s['status'] in ('round', 'not round')]
    bad = [s for s in sts if s['status'] == 'not round']
    unsure = [s for s in sts if s['status'] in ('open', 'no section')]
    loops = [lp for s in judged for lp in s['loops']]
    rep['judged'] = len(judged)
    rep['failing'] = len(bad)
    rep['unsure'] = len(unsure)
    if loops:
        rep['worst_dev_mm'] = max(lp['dev_max_mm'] for lp in loops)
        rep['worst_sag_mm'] = max(lp['sag_mm'] for lp in loops)
        rep['worst_oor_mm'] = max(lp['oor_mm'] for lp in loops)
        big = max(loops, key=lambda lp: lp['r_mm'])
        rep['largest'] = {'d_mm': big['d_mm'], 'facets': min(lp['facets'] for lp in loops if abs(lp['r_mm'] - big['r_mm']) < 0.02 * big['r_mm'] + 0.5)}
    if bad:
        rep['verdict'] = 'not round'
    elif judged and not unsure:
        rep['verdict'] = 'round'
    else:
        rep['verdict'] = 'not checked'
        rep['why'] = ('%d of the %d sections did not close round the %s (an open or broken mesh, or the %s misses the part)'
                      % (len(unsure), len(sts), 'axis' if rep['mode'] == 'axis' else 'centreline',
                         'axis' if rep['mode'] == 'axis' else 'centreline')) if unsure else 'no section to judge'
    rep['ok'] = rep['verdict'] == 'round'
    rep['summary'] = summary(rep)
    return rep


def summary(rep, most=5):
    """The report in plain words, every length in mm and inches."""
    nm = (rep.get('name') + ': ') if rep.get('name') else ''
    lim = 'limits %s from a true circle and %s chord error' % (mm_in(rep['tol_dev_mm']), mm_in(rep['tol_sag_mm']))
    if rep.get('verdict') == 'not checked' and not rep.get('stations'):
        return '%sRoundness NOT CHECKED: %s' % (nm, rep.get('why', ''))
    along = 'along the axis' if rep.get('mode') == 'axis' else 'square to the centreline'
    sts = rep['stations']
    skipped = sum(1 for s in sts if s['status'] == 'skipped')
    empty = sum(1 for s in sts if s['status'] == 'empty')
    head = '%sRoundness %s: %d section%s %s' % (nm, {'round': 'ROUND', 'not round': 'NOT ROUND'}.get(rep['verdict'], 'NOT CHECKED'),
                                              rep['judged'], '' if rep['judged'] == 1 else 's', along)
    extra = []
    if skipped:
        extra.append('%d skipped as asked' % skipped)
    if empty:
        extra.append('%d past the part' % empty)
    if extra:
        head += ' (%s)' % ', '.join(extra)
    out = [head + '.']
    if 'worst_dev_mm' in rep:
        out.append('Worst deviation from a true circle %s, worst facet chord error %s, worst out-of-roundness %s (%s).' % (
            mm_in(rep['worst_dev_mm']), mm_in(rep['worst_sag_mm']), mm_in(rep['worst_oor_mm']), lim))
        lg = rep['largest']
        out.append('%d facets round the %s circle.' % (lg['facets'], mm_in(lg['d_mm'])))
    bad = [s for s in sts if s['status'] == 'not round']
    for s in bad[:most]:
        parts = []
        for lp in s['loops']:
            if not lp['round']:
                parts.append('%s %s across, %d facets, deviation %s, chord error %s' % (
                    lp['role'], mm_in(lp['d_mm']), lp['facets'], mm_in(lp['dev_max_mm']), mm_in(lp['sag_mm'])))
        out.append('At %s: %s.' % (mm_in(s['s_mm']), '; '.join(parts)))
    if len(bad) > most:
        out.append('And %d more sections like these.' % (len(bad) - most))
    if rep['verdict'] == 'not round':
        coarse = any(lp['sag_mm'] > rep['tol_sag_mm'] for s in bad for lp in s['loops'])
        shape = any(lp['dev_max_mm'] > rep['tol_dev_mm'] and lp['sag_mm'] <= rep['tol_sag_mm'] for s in bad for lp in s['loops'])
        if coarse:
            out.append('The facets are too coarse: export the mesh finer (surface tolerance %s or less).' % mm_in(EXPORT_SAG_MM))
        if shape:
            out.append('The shape itself is out of round: if it is a taper made by lofting, revolve its profile instead.')
        out.append('Do not print this file as it is.')
    if rep['verdict'] == 'not checked' and rep.get('why'):
        out.append('Not checked: %s.' % rep['why'])
    return ' '.join(out)


# ------------------------------------------------------------------------------------------------ command line

def _vec(text):
    v = [float(x) for x in text.replace(';', ',').split(',') if x.strip()]
    if len(v) != 3:
        raise ValueError('expected x,y,z, got %r' % text)
    return tuple(v)


def _read_centreline(path):
    pts = []
    with open(path, encoding='utf-8') as fh:
        for line in fh:
            line = line.split('#')[0].strip()
            if line:
                pts.append(_vec(line.replace(' ', ',').replace('\t', ',')))
    return pts


def main(argv=None):
    import argparse
    ap = argparse.ArgumentParser(prog='roundcheck.py', description='Check that a round part\'s STL is really round '
                                 '(sections along the axis, or square to a bent tube\'s centreline). Units mm.')
    ap.add_argument('stl', help='the STL file (binary or ASCII, millimetres)')
    ap.add_argument('--axis', type=_vec, help='axis direction x,y,z (found from the mesh when left out)')
    ap.add_argument('--point', type=_vec, help='a point on the axis x,y,z in mm (found when left out)')
    ap.add_argument('--centreline', '--centerline', help='text file of x,y,z points (mm), one a line, along a bent tube\'s middle')
    ap.add_argument('--stations', type=int, default=STATIONS, help='sections to check (default %d)' % STATIONS)
    ap.add_argument('--dev', type=float, default=DEV_TOL_MM, help='largest deviation from a circle, mm (default %g)' % DEV_TOL_MM)
    ap.add_argument('--sag', type=float, default=SAG_TOL_MM, help='largest facet chord error, mm (default %g)' % SAG_TOL_MM)
    ap.add_argument('--json', action='store_true', help='print the whole report as JSON')
    a = ap.parse_args(argv)
    try:
        cl = _read_centreline(a.centreline) if a.centreline else None
        rep = check(a.stl, axis=a.axis, point=a.point, centreline=cl, stations=max(1, a.stations), tol_dev=a.dev,
                    tol_sag=a.sag, name=os.path.basename(a.stl))
    except (OSError, ValueError) as ex:
        print('roundcheck: %s' % ex, file=sys.stderr)
        return 2
    if a.json:
        print(json.dumps(rep, indent=1, default=lambda o: list(o) if isinstance(o, tuple) else str(o)))
    else:
        print(rep['summary'])
        for s in rep['stations']:
            row = '  %s  %-10s' % (mm_in(s['s_mm'], 1), s['status'])
            for lp in s['loops']:
                row += '  %s d %.3f mm, %d facets, dev %.4f mm, chord %.4f mm' % (lp['role'], lp['d_mm'], lp['facets'], lp['dev_max_mm'], lp['sag_mm'])
            print(row)
    return {'round': 0, 'not round': 1}.get(rep['verdict'], 2)


if __name__ == '__main__':
    sys.exit(main())
