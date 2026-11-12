"""A selected intake tube -> the parametric design cfd/intake_cfd.py takes (and the Intake tab's inputs). Pure geometry,
no Fusion: cadtools.act_cfd_tube samples the tube's centreline curves and probes its bore, then hands the samples here.
Units are mm and degrees.

What it takes: a round tube whose centreline is straights and circular arcs, joined end to end and tangent (a Pipe
along a sketch of lines and arcs, or a bent tube modelled that way). Its bore is read by probing (probe_bore: rays
from the centreline out to the first solid, so beads, cuffs and hose barbs on the outside never matter) and mapped to
what the generator models (analyse_bore): a mouth that is square cut, rounded (a lip: inlet 'radius'), an elliptical
bellmouth ('ellipse'), a straight flare with a rounded lip ('taper'), or, when none of those fits the probed flare
within PROFILE_FIT_MM (or 5 % of the flare's height), the measured flare itself ('profile', its points); one constant
bore after it; and any number of diameter changes one after the other (cfd/intake_cfd.py's 'diameter_change' list:
straight cones, each from the bore before it, cone_spans() and tube_radius()), e.g. a reducer mid-run and the cone to
the throttle bore. An S-shaped reducer is modelled as the straight cone of the same length and end diameters, and the
result says by how much the two differ. The mouth is flush in a plenum wall (mount 'flange', the default) or stands in
open air (mount 'free'). Anything else is refused with a sentence saying why (a spline, a kink, a bend tighter than
the mesher takes, a bend right at the mouth, an oval bore, a cone in a bend if CONE_ON_BEND is off, a bore that narrows
and opens again, a free-standing mouth with a bend or cone right behind it).

The generator's bends (Path3D in cfd/intake_cfd.py): the path starts at the mouth heading +x with a frame
(n1, n2) = (+y, +z) that is carried along the path: unchanged on a straight, turned with the tube on an arc (the arc's
own rotation, so it is the rotation-minimising frame). A bend with plane_deg = phi turns toward
k = cos(phi) n1 + sin(phi) n2 in the frame as it stands where the bend starts: phi is not relative to the previous
bend's plane and not a world angle, it is measured in that carried frame, positive from n1 toward n2 (right-handed
about the direction of flow). So for the real tube the frame is started with n1 = the first bend's turning direction
(its plane_deg is 0) and carried along the real centreline by the same rule; each later bend's plane_deg is the angle
of its turning direction in the carried frame. bends_from_path does that; tests/test_tubecfd.py rebuilds the path
with the generator's own Path3D and compares it point by point and tangent by tangent."""
import math

MIN_CLR_D = 0.6          # the tightest bend (centre-line radius over the bore) the generator's 3-D mesh takes cleanly
JOIN_TOL = 0.05          # mm: curve ends this close are joined
KINK_DEG = 1.0           # tangents at a joint further apart than this: a kink (a mitre), refused
PROFILE_FIT_MM = 0.15    # a fitted mouth (lip, ellipse, flare) further off the probed one than this (or 5 % of the
PROFILE_FIT_FRAC = 0.05  # flare's height) is replaced by the measured profile itself (inlet type 'profile')
CONE_ON_BEND = True      # the generator meshes a cone that overlaps a bend (cfd/NOTES.md 4 (k), checkMesh OK); False: refused here


class Refused(ValueError):
    """The tube is not one this test can model; the message says why in plain words."""


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


def _len(a):
    return math.sqrt(_dot(a, a))


def _unit(a):
    n = _len(a) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def rotate(v, axis, ang):
    """Rodrigues: v turned by ang (rad) about the unit axis (as intake_cfd.rotate_about)."""
    c, s = math.cos(ang), math.sin(ang)
    return _add(_add(_mul(v, c), _mul(_cross(axis, v), s)), _mul(axis, _dot(axis, v) * (1 - c)))


def perp(t):
    """Some unit vector square to t."""
    a = (1.0, 0.0, 0.0) if abs(t[0]) < 0.9 else (0.0, 1.0, 0.0)
    return _unit(_cross(t, a))


def mm_in(mm, dp=1):
    """'92.6 mm (3.646 in)': both units, inches to one more place."""
    return '%.*f mm (%.*f in)' % (dp, mm, dp + 2, mm / 25.4)


# ----------------------------------------------------------------------------------- one curve: a straight or an arc
def _circumcentre(a, b, c):
    ab, ac = _sub(b, a), _sub(c, a)
    n = _cross(ab, ac)
    nn = _dot(n, n)
    if nn < 1e-18:
        return None
    w = _add(_mul(_cross(n, ab), _dot(ac, ac)), _mul(_cross(ac, n), _dot(ab, ab)))
    return _add(a, _mul(w, 1.0 / (2.0 * nn)))


def classify(pts, length):
    """One curve from points at equal steps of arc length from its start to its end (5 or more) and its length:
    {'kind': 'line', a, b, t0, t1, length}, {'kind': 'arc', a, b, c, R, n, angle (deg), t0, t1, length} or
    {'kind': 'other'} (a spline, or anything not on one straight line or one circle)."""
    a, b = tuple(pts[0]), tuple(pts[-1])
    tol = max(0.02, 2e-5 * length)
    chord = _len(_sub(b, a))
    if abs(length - chord) <= tol and chord > 0:
        t = _unit(_sub(b, a))
        if all(_len(_cross(_sub(p, a), t)) <= tol for p in pts):
            return {'kind': 'line', 'a': a, 'b': b, 't0': t, 't1': t, 'length': chord}
        # a gentle arc can be nearly as short as its chord: tried as an arc below
    m = tuple(pts[len(pts) // 2])
    c = _circumcentre(a, m, b)
    if c is None:
        return {'kind': 'other'}
    R = _len(_sub(a, c))
    n = _unit(_cross(_sub(a, c), _sub(m, c)))
    rt = max(0.02, 1e-4 * R)
    for p in pts:
        if abs(_len(_sub(p, c)) - R) > rt or abs(_dot(_sub(p, c), n)) > rt:
            return {'kind': 'other'}
    ang = length / R
    ra, rb = _sub(a, c), _sub(b, c)
    geo = math.atan2(_dot(_cross(ra, rb), n), _dot(ra, rb)) % (2 * math.pi)
    if abs(geo - ang) > math.radians(0.5) and abs(geo - ang + 2 * math.pi) > math.radians(0.5):
        return {'kind': 'other'}
    return {'kind': 'arc', 'a': a, 'b': b, 'c': c, 'R': R, 'n': n, 'angle': math.degrees(ang),
            't0': _unit(_cross(n, ra)), 't1': _unit(_cross(n, rb)), 'length': length}


def reverse(segs):
    """The same path run from the other end."""
    out = []
    for s in reversed(segs):
        r = dict(s)
        r['a'], r['b'] = s['b'], s['a']
        r['t0'], r['t1'] = _mul(s['t1'], -1), _mul(s['t0'], -1)
        if s['kind'] == 'arc':
            r['n'] = _mul(s['n'], -1)
        out.append(r)
    return out


def total(segs):
    return sum(s['length'] for s in segs)


def _arc_point(s, d):
    """Point and tangent d mm along arc s."""
    ang = d / s['R']
    p = _add(s['c'], rotate(_sub(s['a'], s['c']), s['n'], ang))
    return p, rotate(s['t0'], s['n'], ang)


def point_at(segs, s):
    """(point, unit tangent) s mm along the path (clamped to its ends)."""
    s = max(0.0, s)
    for g in segs:
        if s <= g['length'] or g is segs[-1]:
            d = min(s, g['length'])
            if g['kind'] == 'line':
                return _add(g['a'], _mul(g['t0'], d)), g['t0']
            return _arc_point(g, d)
        s -= g['length']
    return segs[-1]['b'], segs[-1]['t1']


def nearest_s(segs, p, step=2.0):
    """The arc length of the path point nearest p (sampled every step mm, then refined)."""
    L = total(segs)
    n = max(2, int(L / step))
    best = min(range(n + 1), key=lambda i: _len(_sub(point_at(segs, L * i / n)[0], p)))
    lo, hi = L * max(0, best - 1) / n, L * min(n, best + 1) / n
    for _ in range(40):
        a, b = lo + (hi - lo) / 3, hi - (hi - lo) / 3
        if _len(_sub(point_at(segs, a)[0], p)) < _len(_sub(point_at(segs, b)[0], p)):
            hi = b
        else:
            lo = a
    return 0.5 * (lo + hi)


def _cut(g, d0, d1):
    """Piece of segment g from d0 to d1 mm along it."""
    if g['kind'] == 'line':
        a = _add(g['a'], _mul(g['t0'], d0))
        return dict(g, a=a, b=_add(g['a'], _mul(g['t0'], d1)), length=d1 - d0)
    a, t0 = _arc_point(g, d0)
    b, t1 = _arc_point(g, d1)
    return dict(g, a=a, b=b, t0=t0, t1=t1, length=d1 - d0, angle=math.degrees((d1 - d0) / g['R']))


def trim(segs, s0, s1):
    """The path between s0 and s1 mm along it (the part the tube body covers: a path often runs on into the throttle
    body or a flange)."""
    out, at = [], 0.0
    for g in segs:
        a, b = at, at + g['length']
        lo, hi = max(a, s0), min(b, s1)
        if hi - lo > 1e-6:
            out.append(_cut(g, lo - a, hi - a) if (lo > a + 1e-9 or hi < b - 1e-9) else g)
        at = b
    return out


def join(segs):
    """Check the curves run end to end and tangent; merge straights in line and arcs on one circle."""
    if not segs:
        raise Refused('No centreline curves.')
    for i, g in enumerate(segs):
        if g['kind'] == 'other':
            raise Refused('Curve %d of the centreline is neither a straight line nor a circular arc (a spline or a '
                          'conic): the CFD test takes tubes bent on a constant radius, with straights between.' % (i + 1))
    out = [dict(segs[0])]
    s = 0.0
    for g in segs[1:]:
        p = out[-1]
        s += p['length']
        gap = _len(_sub(g['a'], p['b']))
        if gap > JOIN_TOL:
            raise Refused('The centreline has a gap of %s at %s from the mouth: its curves must run end to end.' % (mm_in(gap, 2), mm_in(s)))
        kink = math.degrees(math.acos(max(-1.0, min(1.0, _dot(p['t1'], g['t0'])))))
        if kink > KINK_DEG:
            raise Refused('The centreline turns %.1f degrees in a corner at %s from the mouth (a mitre joint, not a bend): '
                          'the CFD test takes smooth bends only.' % (kink, mm_in(s)))
        if p['kind'] == g['kind'] == 'line' and kink < 0.01:
            out[-1] = dict(p, b=g['b'], length=p['length'] + g['length'])
        elif (p['kind'] == g['kind'] == 'arc' and _len(_sub(p['c'], g['c'])) < JOIN_TOL and abs(p['R'] - g['R']) < JOIN_TOL
              and _dot(p['n'], g['n']) > 0.99999):
            out[-1] = dict(p, b=g['b'], t1=g['t1'], length=p['length'] + g['length'], angle=p['angle'] + g['angle'])
        else:
            out.append(dict(g))
    return out


# ----------------------------------------------------------------------------------- the bends, in the generator's terms
def bends_from_path(segs):
    """[{clr_mm, angle_deg, start_mm, plane_deg}] from the mouth, plane_deg in the generator's carried frame (see the
    module note), and the frame at the mouth: (t0, n1) such that the generator's path, put at the mouth point with +x
    along t0 and +y along n1, lies on this one."""
    t0 = segs[0]['t0']
    first = next((g for g in segs if g['kind'] == 'arc'), None)
    u = _unit(_sub(first['c'], first['a'])) if first else perp(t0)
    # the first bend's turning direction, carried back to the mouth along the straights before it (unchanged there)
    n1 = u
    bends, s = [], 0.0
    for g in segs:
        if g['kind'] == 'arc':
            t = g['t0']
            k = _unit(_sub(g['c'], g['a']))
            phi = math.degrees(math.atan2(_dot(k, _cross(t, u)), _dot(k, u)))
            if phi <= -180.0 + 1e-9:
                phi += 360.0
            bends.append({'clr_mm': g['R'], 'angle_deg': g['angle'], 'start_mm': s, 'plane_deg': phi})
            u = rotate(u, g['n'], math.radians(g['angle']))
        s += g['length']
    return bends, (t0, n1)


def mouth_lip(tori, mouth_p, mouth_t, r_in, tol=0.15, tol_along=0.5):
    """A fillet round the inside edge of the mouth, from the body's torus faces [(origin, axis, major, minor)] (mm):
    centred on the tube's axis, its tube centre at r_in + minor from the axis, minor from the mouth plane into the
    tube. Its minor radius, or None."""
    best = None
    for o, ax, Rmaj, rmin in tori:
        ax = _unit(ax)
        if abs(abs(_dot(ax, mouth_t)) - 1.0) > 1e-3 or rmin <= 0:
            continue
        d = _sub(o, mouth_p)
        along = _dot(d, mouth_t)
        off = _len(_sub(d, _mul(mouth_t, along)))
        if off < tol and abs(along - rmin) < tol_along and abs(Rmaj - (r_in + rmin)) < tol:
            best = rmin if best is None else max(best, rmin)
    return best


# ----------------------------------------------------------------------------------- the bore, probed from the centreline
RAY_ANGLES = [0.3 + 2 * math.pi * k / 8 for k in range(8)]     # off the seams Pipe puts at angle 0 (as cadtools._PS_ANGLES)
RAY_TOL = 0.002          # mm: each ray's bore radius is bisected to this


def extend(segs, e0, e1):
    """The path with a straight e0 mm added before its start and e1 mm after its end, along its end tangents: a body
    often runs on past its Pipe path (a cone, a cuff or a bellmouth joined on), and the probe must be able to see it."""
    a, t0 = segs[0]['a'], segs[0]['t0']
    b, t1 = segs[-1]['b'], segs[-1]['t1']
    pre = {'kind': 'line', 'a': _sub(a, _mul(t0, e0)), 'b': a, 't0': t0, 't1': t0, 'length': e0}
    post = {'kind': 'line', 'a': b, 'b': _add(b, _mul(t1, e1)), 't0': t1, 't1': t1, 'length': e1}
    return ([pre] if e0 > 0 else []) + list(segs) + ([post] if e1 > 0 else [])


def frame_at(segs, s):
    """(point, tangent, u, v) s mm along the path, (u, v) square to the tangent and carried along it (unchanged on a
    straight, turned with the tube on an arc), so a ray's angle means the same place round the tube all along."""
    u = perp(segs[0]['t0'])
    s = max(0.0, s)
    for g in segs:
        if s <= g['length'] or g is segs[-1]:
            d = min(s, g['length'])
            if g['kind'] == 'line':
                p, t = _add(g['a'], _mul(g['t0'], d)), g['t0']
            else:
                p, t = _arc_point(g, d)
                u = rotate(u, g['n'], d / g['R'])
            u = _unit(_sub(u, _mul(t, _dot(u, t))))
            return p, t, u, _cross(t, u)
        if g['kind'] == 'arc':
            u = rotate(u, g['n'], g['length'] / g['R'])
        s -= g['length']
    return segs[-1]['b'], segs[-1]['t1'], u, _cross(segs[-1]['t1'], u)


def _ray(solid, g, h, reach):
    """Radius of the first solid going out from the centreline along one ray, searched from the guess g (mm): solid(r)
    says whether the point r out along the ray is in the body. h: the largest search step (under the wall, so the
    search cannot step over it); reach: how far past the guess to look. None when there is no wall near (past the end
    of the tube). Only the bore is looked for: what is on the outside (a bead, a cuff, a hose barb) is never reached.
    The bore where it was guessed costs two probes; elsewhere the step grows from 0.04 mm, then the edge is bisected."""
    dl = 0.005
    a = g - dl > 0 and solid(g - dl)
    if not a and solid(g + dl):
        return g

    def inward(r):                            # from a solid point r, in to the first air: (air, solid) or None
        st = 0.04
        while True:
            r2 = r - st
            if r2 <= 0.05 * g:
                return None
            if not solid(r2):
                return r2, r
            r, st = r2, min(h, 2.0 * st)
    if a:                                     # the guess is in the wall: inward to the bore
        found = inward(g - dl)
    else:                                     # air at the guess: out to the wall, else in to a narrower bore
        r, st, found = g + dl, 0.04, None
        while r < g + reach:
            if solid(r + st):
                found = (r, r + st)
                break
            r, st = r + st, min(h, 2.0 * st)
        if found is None:
            r, st = g - dl, 0.04
            while r > 0.2 * g:
                if solid(r - st):
                    found = inward(r - st)
                    break
                r, st = r - st, min(h, 2.0 * st)
    if found is None:
        return None
    lo, hi = found
    while hi - lo > RAY_TOL:
        m = 0.5 * (lo + hi)
        if solid(m):
            hi = m
        else:
            lo = m
    return 0.5 * (lo + hi)


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    return xs[n // 2] if n % 2 else 0.5 * (xs[n // 2 - 1] + xs[n // 2])


def probe_bore(segs, inside, r_in, wall, ext=None, step=5.0):
    """The tube's bore all along, probed from its centreline. inside(p) (p in mm) says whether a point is in the solid.
    The path is first run on straight past both ends (extend) so a cone, cuff or bellmouth beyond the Pipe path is seen.
    From the middle of the path, stations step out both ways (every `step` mm, finer where the bore changes or stops)
    until the tube ends; at each, 8 rays find the bore radius. A station is in the tube when its centre point is air
    and at least 5 of the 8 rays find a wall. Then the first 25 mm at either end are probed finely (0.25 mm to 4 mm,
    0.5 to 10, 1 to 25: the lip or flare at whichever end is the mouth) and every stretch where the bore changes at 1 mm.
    -> {'segs': the run-on path, 'e0': mm added before the path's start, 's0', 's1': where the tube body starts and ends
    on it, 'samples': [(s, median, smallest, largest radius)] sorted by s}."""
    D = 2.0 * r_in
    e = ext if ext is not None else max(150.0, 3.0 * D)
    L0 = total(segs)
    ex = extend(segs, e, e)
    Lx = total(ex)
    w = max(0.5, wall)
    h, reach = 0.4 * w, max(3.0 * w, 0.3 * r_in)
    got = {}

    def bore(s, g):
        p, t, u, v = frame_at(ex, s)
        if inside(p):
            return None
        rs, miss = [], 0
        for a in RAY_ANGLES:
            d = _add(_mul(u, math.cos(a)), _mul(v, math.sin(a)))
            r = _ray(lambda rr: inside(_add(p, _mul(d, rr))), g, h, reach)
            if r is None:
                miss += 1
                if miss > 3:
                    return None
            else:
                rs.append(r)
        got[s] = rs
        return rs

    start = None
    for f in (0.5, 0.35, 0.65, 0.2, 0.8, 0.05, 0.95):
        s = e + f * L0
        if bore(s, r_in):
            start = s
            break
    if start is None:
        raise Refused('The centreline curves do not run inside this tube: select the tube and its own centreline.')

    def walk(direction):
        s, g, hc = start, _median(got[start]), step
        while True:
            s2 = s + direction * hc
            if s2 < 0.0 or s2 > Lx:
                return max(0.0, min(Lx, s2))
            rs = bore(s2, g)
            if rs:
                s, g, hc = s2, _median(rs), min(step, 2.0 * hc)
                continue
            if hc > 0.2:
                hc /= 4.0
                continue
            a, b = s, s2
            for _ in range(8):
                m = 0.5 * (a + b)
                rs = bore(m, g)
                if rs:
                    a, g = m, _median(rs)
                else:
                    b = m
            return a
    s1, s0 = walk(1.0), walk(-1.0)

    def near(s):
        k = min(got, key=lambda x: abs(x - s))
        return _median(got[k])
    dense = [0.05, 0.1] + [0.25 * i for i in range(1, 17)] + [4.0 + 0.5 * i for i in range(1, 13)] + [10.0 + i for i in range(1, 16)]
    for d in dense:
        for s in (s0 + d, s1 - d):
            if s0 < s < s1 and not any(abs(s - x) < 0.01 for x in got):
                bore(s, near(s))
    tol = bore_tol(r_in)
    ks = sorted(got)
    for a, b in zip(ks, ks[1:]):
        if b - a > 1.2 and abs(_median(got[a]) - _median(got[b])) > tol:
            n = int(math.ceil(b - a))
            g = _median(got[a])
            for i in range(1, n):
                rs = bore(a + (b - a) * i / n, g)
                if rs:
                    g = _median(rs)
    samples = [(s, _median(got[s]), min(got[s]), max(got[s])) for s in sorted(got) if s0 - 1e-9 <= s <= s1 + 1e-9 and got[s]]
    return {'segs': ex, 'e0': e, 's0': s0, 's1': s1, 'samples': samples}


def profile_from(probe, at_end):
    """The probe's samples as (s mm from the mouth, median, smallest, largest radius), the mouth at the tube's start
    (at_end False) or end."""
    s0, s1 = probe['s0'], probe['s1']
    out = [((s1 - s) if at_end else (s - s0), m, lo, hi) for s, m, lo, hi in probe['samples']]
    return sorted(out)


def bore_tol(R):
    """How far (mm) the bore radius may wander and still be one constant bore."""
    return max(0.08, 0.0015 * R)


def _dp(pts, tol):
    """Douglas-Peucker: indices of the corners of the polyline through pts [(x, y)] within tol."""
    keep = {0, len(pts) - 1}
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x0, y0), (x1, y1) = pts[i], pts[j]
        best, k = -1.0, None
        for m in range(i + 1, j):
            x, y = pts[m]
            yl = y0 + (y1 - y0) * (x - x0) / (x1 - x0) if x1 > x0 else y0
            dv = abs(y - yl)
            if dv > best:
                best, k = dv, m
        if k is not None and best > tol:
            keep.add(k)
            stack += [(i, k), (k, j)]
    return sorted(keep)


def _line_fit(pts):
    """Least-squares y = a + b x."""
    n = float(len(pts))
    sx = sum(p[0] for p in pts)
    sy = sum(p[1] for p in pts)
    sxx = sum(p[0] * p[0] for p in pts)
    sxy = sum(p[0] * p[1] for p in pts)
    den = n * sxx - sx * sx
    b = (n * sxy - sx * sy) / den if abs(den) > 1e-12 else 0.0
    return (sy - b * sx) / n, b


def _golden(f, a, b, n=40):
    g = (math.sqrt(5) - 1) / 2
    c, d = b - g * (b - a), a + g * (b - a)
    fc, fd = f(c), f(d)
    for _ in range(n):
        if fc < fd:
            b, d, fd = d, c, fc
            c = b - g * (b - a)
            fc = f(c)
        else:
            a, c, fc = c, d, fd
            d = a + g * (b - a)
            fd = f(d)
    return (c, fc) if fc < fd else (d, fd)


def mouth_model(kind, R, **k):
    """The generator's inlet piece as r(x) (mm, x from the mouth plane), following intake_cfd.inlet_profile: 'radius'
    (rc: a quarter round, radial at the mouth), 'ellipse' (L, h: Blair's quarter ellipse, entry radius R + h),
    'taper' (alpha deg, rl, ri: a lip arc of radius rl, then a straight cone from radius ri down to R). -> (r(x), length)."""
    if kind == 'radius':
        rc = k['rc']
        return (lambda x: R if x >= rc else R + rc - math.sqrt(max(0.0, rc * rc - (rc - x) ** 2))), rc
    if kind == 'ellipse':
        Le, he = k['L'], k['h']
        return (lambda x: R if x >= Le else R + he - he * math.sqrt(max(0.0, 1.0 - ((Le - x) / Le) ** 2))), Le
    al, rl, ri = math.radians(k['alpha']), k['rl'], k['ri']
    cr = ri + rl * math.cos(al)
    Sx = rl * (1.0 - math.sin(al))
    Tx = Sx + (ri - R) / math.tan(al)

    def r(x):
        if x <= Sx:
            return cr - math.sqrt(max(0.0, rl * rl - (rl - x) ** 2))
        if x <= Tx:
            return ri - (x - Sx) * math.tan(al)
        return R
    return r, Tx


def _fit_mouth(pts, R, lip_mm, s_flat):
    """The best of the generator's mouths for the flare samples pts [(s, r)] (the bore wider at the mouth, back to R
    by s_flat). -> (kind, params, max deviation mm, model length)."""
    def dev(fn):
        return max(abs(r - fn(s)) for s, r in pts)
    cands = []
    # a rounded lip: the torus face's radius when there is one, else the best quarter round
    if lip_mm:
        fn, Lm = mouth_model('radius', R, rc=lip_mm)
        cands.append(('radius', {'rc': lip_mm}, dev(fn), Lm))
    else:
        rc, dv = _golden(lambda rc: dev(mouth_model('radius', R, rc=rc)[0]), 0.2, max(1.0, 2.5 * s_flat))
        cands.append(('radius', {'rc': rc}, dv, rc))
    # an elliptical bellmouth: its length and entry radius
    h0 = max(r for s, r in pts) - R

    def ell(Le):
        hv, dv = _golden(lambda he: dev(mouth_model('ellipse', R, L=Le, h=he)[0]), 0.5 * h0, 2.0 * h0 + 0.5, 30)
        return dv, hv
    Le, dv = _golden(lambda Le: ell(Le)[0], 0.3 * s_flat + 0.1, 2.0 * s_flat + 1.0, 30)
    he = ell(Le)[1]
    cands.append(('ellipse', {'L': Le, 'h': he}, dv, Le))
    # a straight flare with a rounded lip: the straight from a line fit through the flare's middle
    mid = [(s, r) for s, r in pts if R + 0.1 * h0 < r < R + 0.6 * h0]     # the straight, clear of the lip arc
    if len(mid) >= 3:
        a, b = _line_fit(mid)
        if b < -math.tan(math.radians(1.0)) and b > -math.tan(math.radians(60.0)):
            al = math.degrees(math.atan(-b))
            f = (1.0 - math.sin(math.radians(al))) / math.cos(math.radians(al))
            r0 = max(r for s, r in pts)

            def tap(rl):
                ri = a - rl * (1.0 - math.sin(math.radians(al))) * (-b)
                return mouth_model('taper', R, alpha=al, rl=rl, ri=ri)
            rl0 = max(0.2, (r0 - a) / f if f > 1e-9 else 0.2)
            rl, dv = _golden(lambda rl: dev(tap(rl)[0]), 0.2, max(0.4, 3.0 * rl0 + 1.0))
            ri = a - rl * (1.0 - math.sin(math.radians(al))) * (-b)
            if ri > R:
                cands.append(('taper', {'alpha': al, 'rl': rl, 'ri': ri}, dv, tap(rl)[1]))
    best = min(cands, key=lambda c: c[2])
    # a quarter round is the simplest (and a quarter ellipse with equal axes is one): it wins a tie
    return cands[0] if cands[0][2] <= best[2] + 0.02 else best


def _mouth_points(pts, R1, x_flat, tol):
    """The probed flare as the generator's measured mouth profile (inlet 'profile', cfd/intake_cfd.py profile_points):
    [[x, r]] mm from the mouth plane to where the bore is R1, r falling, the first segment at 45 degrees or more to the
    axis; thinned (Douglas-Peucker, 0.01 mm). -> (points, largest distance of a sample from them) or None when the
    flare is not one the generator takes (it leaves the mouth plane shallower than 45 degrees, e.g. a counterbore)."""
    raw = [(s, r) for s, r in pts if 0.0 < s <= x_flat + 1e-9]
    if len(raw) < 3:
        return None
    (s1, r1), (s2, r2) = raw[0], raw[1]
    r0 = max(r1, r1 + (r1 - r2) * s1 / (s2 - s1))      # the mouth plane: the probe's first ray is 0.05 mm in
    q, lo = [], float('inf')
    for s, r in [(0.0, r0)] + raw:
        lo = min(lo, r)
        if lo <= R1 + tol:
            q.append((s, R1))
            break
        q.append((s, lo))
    if q[-1][1] != R1:
        q.append((max(x_flat, q[-1][0] + 0.01), R1))
    keep = _dp(q, 0.01)
    out = []
    for i in keep:
        x, r = round(q[i][0], 4), round(q[i][1], 4)
        if not out or x > out[-1][0]:
            out.append([x, r])
    out[-1][1] = round(R1, 4)
    if len(out) < 3 or math.degrees(math.atan2(out[0][1] - out[1][1], out[1][0] - out[0][0])) < 45.0:
        return None

    def at(x):
        for (xa, ra), (xb, rb) in zip(out, out[1:]):
            if x <= xb:
                return ra + (rb - ra) * (x - xa) / (xb - xa)
        return out[-1][1]
    return out, max(abs(r - at(s)) for s, r in raw)


def analyse_bore(profile, L, R_ref, wall, lip_mm=None, bends=(), name_D=None):
    """What the probed bore is in the generator's terms. profile: [(s from the mouth, median, smallest, largest radius)]
    (mm); L: the tube's centreline length; R_ref: the bore radius read from the tube's cylinder faces (used when the
    first constant bore matches it); bends: [(start, end)] mm from the mouth. Refuses (Refused) what the generator
    cannot model; approximations go in 'notes' with how big they are.
    -> {'R': the tube bore radius after the mouth, 'mouth': {'kind', params, 'len', 'dev'}, 'change': None or
        {'x0', 'x1', 'R2', 'end': is it the cone to the throttle at the end, 'dev'}, 'notes': [...]}"""
    tol = bore_tol(R_ref)
    notes = []
    w = max(0.5, wall)
    tol_round = 2.0 * min(0.5, 0.25 * w)
    for s, m, lo, hi in profile:
        if 0.3 < s < L - 0.3 and hi - lo > tol_round:
            raise Refused('The bore is not round %s from the mouth: it measures %s to %s across there (an oval or '
                          'flattened section, a dent, a seam or a branch); the CFD test takes round bores.'
                          % (mm_in(s), mm_in(2 * lo, 2), mm_in(2 * hi, 2)))
    pts = [(s, m) for s, m, lo, hi in profile]
    ix = _dp(pts, tol)
    # pieces between the corners: flat (one bore) or a ramp; a flat must be long enough to count, except at either end
    flat_min = max(5.0, 0.1 * 2 * R_ref)
    pieces = []
    for i, j in zip(ix, ix[1:]):
        (sa, ra), (sb, rb) = pts[i], pts[j]
        # (a short stub of the end bore after a cone at the far end still counts; at the mouth a short one is the lip's)
        flat = abs(rb - ra) <= 2 * tol and (sb - sa >= flat_min or (j == len(pts) - 1 and sb - sa >= 1.0))
        pieces.append({'i': i, 'j': j, 'flat': flat})
    # runs: consecutive flats are one flat, consecutive ramps one transition
    runs = []
    for p in pieces:
        if runs and runs[-1]['flat'] == p['flat']:
            runs[-1]['j'] = p['j']
        else:
            runs.append(dict(p))
    for r_ in runs:
        seg = pts[r_['i']:r_['j'] + 1]
        r_['sa'], r_['sb'] = seg[0][0], seg[-1][0]
        if r_['flat']:
            r_['r'] = _median([q[1] for q in seg])
    flats = [r_ for r_ in runs if r_['flat']]
    if not flats:
        raise Refused('The bore never runs at one size for even %s: the CFD test takes a tube of one bore, with at most '
                      'one cone (to the throttle bore or a reducer) and a lip or bellmouth at the mouth.' % mm_in(flat_min))
    # the mouth: anything before the first flat
    F1 = flats[0]

    def snap(r):            # a bore that matches the cylinder faces' exact radius takes it (the probe is good to
        # ~0.005 mm; R_ref may come from a coarser scan when the faces do not give it, and then the probe wins)
        return R_ref if abs(r - R_ref) <= 0.012 else round(2.0 * r, 2) / 2.0     # probed: to 0.01 mm on the diameter
    R1 = snap(F1['r'])
    mouth = {'kind': 'plain', 'len': min(1e-3 * 2 * R1, 0.05), 'dev': 0.0}
    if lip_mm and runs[0]['flat']:
        mouth = {'kind': 'radius', 'rc': lip_mm, 'len': lip_mm, 'dev': 0.0}
    elif not runs[0]['flat']:
        fl = [(s, r) for s, r in pts if 0.05 <= s <= F1['sa'] + min(5.0, 0.5 * (F1['sb'] - F1['sa']))]
        rmax = max(r for s, r in fl[:max(1, len(fl) // 2 + 1)])
        rmin = min(r for s, r in fl)
        if rmin < R1 - 2 * tol:
            raise Refused('The bore at the mouth is narrower than the tube (%s at the mouth, %s bore): a ring or a lip '
                          'turned inward, which the CFD case has no model for.' % (mm_in(2 * rmin, 2), mm_in(2 * R1, 2)))
        kind, prm, dv, Lm = _fit_mouth(fl, R1, lip_mm, F1['sa'])
        hgt = rmax - R1
        what = {'radius': 'a rounded lip', 'ellipse': 'an elliptical bellmouth', 'taper': 'a straight flare with a rounded lip'}[kind]
        mp = _mouth_points(pts, R1, F1['sa'], tol) if dv > max(PROFILE_FIT_MM, PROFILE_FIT_FRAC * hgt) else None
        if mp is not None:
            # the fitted model is further off than the fit is trusted to: the measured flare itself (inlet 'profile')
            notes.append('The mouth is modelled as its measured profile (%d points, %s to %s bore over %s): the nearest '
                         'fitted shape, %s, is %s off, more than the %s (or 5 %% of the flare) a fit is taken to.'
                         % (len(mp[0]), mm_in(2 * mp[0][0][1], 2), mm_in(2 * R1, 2), mm_in(mp[0][-1][0]), what, mm_in(dv, 2),
                            mm_in(PROFILE_FIT_MM, 2)))
            mouth = {'kind': 'profile', 'points': mp[0], 'len': mp[0][-1][0], 'dev': mp[1]}
        elif dv > max(0.25, 0.25 * hgt):
            raise Refused('The mouth flares from the %s bore to %s over %s, in a shape the CFD case has no model for: it '
                          'takes a rounded lip, an elliptical bellmouth or a straight flare with a rounded lip, and the '
                          'nearest (%s) is %s off.' % (mm_in(2 * R1, 2), mm_in(2 * rmax, 2), mm_in(F1['sa']), what, mm_in(dv, 2)))
        else:
            if dv > max(0.15, 0.05 * hgt):
                notes.append('The mouth is modelled as %s; the real flare is up to %s from it.' % (what, mm_in(dv, 2)))
            mouth = dict(prm, kind=kind, len=Lm, dev=dv)
    if mouth['kind'] == 'taper' and mouth['rl'] < 0.25:
        mouth['rl'] = max(0.2, mouth['rl'])
        notes.append('The flare\'s rim is square; it is modelled with a 0.2 mm (0.008 in) radius, the smallest the CFD case takes.')
    # changes of bore after the first flat; tiny ones (a joint between two tubes of nearly one size) are let go
    k1 = runs.index(F1)
    rest = runs[k1:]
    trans = []
    cur = {'r': R1, 'sa': F1['sa'], 'sb': F1['sb'], 'len': F1['sb'] - F1['sa']}
    level = [cur]
    small = 0.0
    i = 1
    while i < len(rest):
        t = rest[i]
        nxt = rest[i + 1] if i + 1 < len(rest) else None
        r_to = nxt['r'] if nxt else pts[t['j']][1]
        seg = pts[t['i']:t['j'] + 1]
        dr = r_to - level[-1]['r']
        lo_ = min(level[-1]['r'], r_to)
        hi_ = max(level[-1]['r'], r_to)
        if any(q[1] < lo_ - 2 * tol or q[1] > hi_ + 2 * tol for q in seg):
            ext = min(q[1] for q in seg) if any(q[1] < lo_ - 2 * tol for q in seg) else max(q[1] for q in seg)
            raise Refused('%s from the mouth the bore %s to %s and back again (an inside bead, a ring, a step or a '
                          'pocket): the CFD test takes a bore that changes size at most once, along a cone.'
                          % (mm_in(seg[0][0]), 'narrows' if ext < lo_ else 'widens', mm_in(2 * ext, 2)))
        if abs(dr) <= max(0.25, 0.0025 * 2 * R1):
            small = max(small, abs(dr))
            if nxt:
                prev = level[-1]
                Lp, Ln = prev['len'], nxt['sb'] - nxt['sa']
                prev['r'] = (prev['r'] * Lp + nxt['r'] * Ln) / (Lp + Ln) if Lp + Ln > 0 else prev['r']
                prev['sb'], prev['len'] = nxt['sb'], Lp + Ln
            i += 2
            continue
        trans.append({'seg': seg, 'r_from': level[-1]['r'], 'r_to': r_to, 'run_end': nxt is None,
                      'sa': seg[0][0], 'sb': seg[-1][0]})
        if nxt:
            level.append({'r': snap(nxt['r']), 'sa': nxt['sa'], 'sb': nxt['sb'], 'len': nxt['sb'] - nxt['sa']})
        i += 2
    if small > 0:
        notes.append('The bore steps by up to %s along the tube (a joint between tubes of nearly one size); it is '
                     'modelled as one bore.' % mm_in(2 * small, 2))
    # each change of bore is one straight cone from the bore before it (the generator's diameter_change list,
    # cfd/intake_cfd.py cone_spans): a reducer mid-run and the cone to the throttle, or any number one after the other
    changes = []
    for ti, t in enumerate(trans):
        Ra, Rb = t['r_from'], snap(t['r_to'])
        seg = t['seg']
        # a straight cone: the line through the samples well clear of both bores, met with each bore (a cone that runs
        # to the very end face has no bore after it: its end is the end face, its end bore the bore there)
        core = [q for q in seg if min(abs(q[1] - Ra), abs(q[1] - Rb)) > 2 * tol]
        if t['run_end']:
            core = [q for q in seg if abs(q[1] - Ra) > 2 * tol]
        x0, x1 = t['sa'], t['sb']
        if len(core) >= 3:
            a, b = _line_fit(core)
            if abs(b) > 1e-6:
                lx0, lx1 = (Ra - a) / b, (Rb - a) / b
                if t['sa'] - 2.0 <= lx0 <= t['sb'] + 2.0:
                    x0 = lx0
                if not t['run_end'] and t['sa'] - 2.0 <= lx1 <= t['sb'] + 2.0:
                    x1 = lx1
                if t['run_end']:
                    x1 = L
                    Rb = snap(round(2.0 * (a + b * x1), 2) / 2.0)
        if x1 - x0 < 1e-3:
            x1 = x0 + 1e-3
        line = lambda s: Ra + (Rb - Ra) * min(1.0, max(0.0, (s - x0) / (x1 - x0)))
        dv = max(abs(q[1] - line(q[0])) for q in seg)
        if dv > max(0.15, 0.03 * abs(Rb - Ra)):
            # not a straight cone (an S-shaped reducer): its ends are where it leaves the one bore and reaches the
            # other, and it is taken as the straight cone between those
            near_ = [q for q in pts if t['sa'] - flat_min <= q[0] <= t['sb'] + flat_min]
            off_a = [k for k, q in enumerate(near_) if abs(q[1] - Ra) > 5 * RAY_TOL]
            off_b = [k for k, q in enumerate(near_) if abs(q[1] - Rb) > 5 * RAY_TOL]
            def cross(k0, k1, Rl):        # where |r - Rl| passes 5 RAY_TOL between two samples
                (sa_, ra_), (sb_, rb_) = near_[k0], near_[k1]
                da, db = abs(ra_ - Rl), abs(rb_ - Rl)
                return sa_ + (sb_ - sa_) * (5 * RAY_TOL - da) / (db - da) if db != da else sa_
            if off_a and off_b:
                ka, kb = off_a[0], off_b[-1]
                x0 = cross(ka - 1, ka, Ra) if ka > 0 else near_[0][0]
                x1 = (cross(kb + 1, kb, Rb) if kb + 1 < len(near_) else near_[-1][0]) if not t['run_end'] else L
            line = lambda s: Ra + (Rb - Ra) * min(1.0, max(0.0, (s - x0) / (x1 - x0)))
            dv = max(abs(q[1] - line(q[0])) for q in near_)
        ang = math.degrees(math.atan(abs(Rb - Ra) / (x1 - x0)))
        if ang > 60.0:
            if Rb < Ra:
                raise Refused('%s from the mouth the bore steps down from %s to %s (%.0f degrees a side): the CFD case '
                              'takes cones up to 60 degrees a side.' % (mm_in(x0), mm_in(2 * Ra, 2), mm_in(2 * Rb, 2), ang))
            xm = 0.5 * (x0 + x1)
            Lc = abs(Rb - Ra) / math.tan(math.radians(60.0))
            x0, x1 = xm - 0.5 * Lc, xm + 0.5 * Lc
            notes.append('The step from %s to %s bore at %s from the mouth is modelled as a 60 degree cone (%s long), the '
                         'steepest the CFD case takes; a 60 degree diffuser loses about what a sudden step does.'
                         % (mm_in(2 * Ra, 1), mm_in(2 * Rb, 1), mm_in(xm), mm_in(Lc)))
            ang, dv = 60.0, 0.0
        elif dv > max(0.15, 0.03 * abs(Rb - Ra)):
            notes.append('The %s from %s to %s bore is not a straight cone (its bore is up to %s from one): it is modelled '
                         'as the straight cone of the same length (%s) and end diameters, %.2f degrees a side.'
                         % ('reducer' if Rb < Ra else 'cone', mm_in(2 * Ra, 1), mm_in(2 * Rb, 1), mm_in(dv, 2), mm_in(x1 - x0), ang))
        for k, (b0, b1) in enumerate(bends, 1):
            if not CONE_ON_BEND and x0 < b1 - 0.05 and x1 > b0 + 0.05:
                raise Refused('The bore changes from %s to %s between %s and %s from the mouth, inside bend %d (%s to %s): '
                              'the CFD case takes a cone on a straight only.' % (mm_in(2 * Ra, 1), mm_in(2 * Rb, 1), mm_in(x0), mm_in(x1),
                                                                                 k, mm_in(b0), mm_in(b1)))
        if changes and x0 < changes[-1]['x1'] - 0.05:
            raise Refused('The bore changes size again at %s from the mouth, before the change ahead of it ends (%s): '
                          'the CFD case takes cones one after the other.' % (mm_in(x0), mm_in(changes[-1]['x1'])))
        if not changes and x0 < mouth['len'] + 0.1:
            raise Refused('The bore changes size right at the mouth (from %s, within %s of it): the CFD case needs a '
                          'stretch of one bore after the mouth.' % (mm_in(x0), mm_in(mouth['len'] + 0.1)))
        after = [b for b in bends if b[0] >= x1 - 0.05]
        end = ti == len(trans) - 1 and not after and (L - x1) <= 0.5 * 2 * R1 + 1e-6
        changes.append({'x0': x0, 'x1': x1, 'R2': Rb, 'R1': Ra, 'angle': ang, 'end': end, 'dev': dv})
    change = changes[0] if changes else None
    return {'R': R1, 'mouth': mouth, 'change': change, 'changes': changes, 'notes': notes}


def design_geometry(segs, bore_mm, wall_mm, lip_mm=None, profile=None, mount='flange'):
    """The 'geometry' block of a design for intake_cfd.py, and what was read (for the panel). profile: the probed bore
    (profile_from), read with analyse_bore; without it the bore is taken as constant. mount: 'flange' (the default: the
    mouth flush in a plenum wall, as when it is against an airbox or a filter housing) or 'free' (the tube stands in
    open air, its outside a wall: the generator's free mount, the plenum wall where the tube's first straight ends)."""
    L = total(segs)
    bends, frame = bends_from_path(segs)
    D = bore_mm
    an = None
    if profile is not None:
        spans = [(b['start_mm'], b['start_mm'] + b['clr_mm'] * math.radians(b['angle_deg'])) for b in bends]
        an = analyse_bore(profile, L, bore_mm / 2.0, wall_mm, lip_mm, spans)
        D = 2.0 * an['R']
        mo = an['mouth']
        if mo['kind'] == 'radius':
            lip_mm = mo['rc']
    if an is not None and an['mouth']['kind'] == 'ellipse':
        mo = an['mouth']
        inlet = {'type': 'ellipse', 'length_mm': round(mo['L'], 3), 'entry_diameter_mm': round(D + 2 * mo['h'], 3),
                 'exit_diameter_mm': round(D, 3), 'corner_radius_mm': 0.0}
        inlet_len = mo['L']
    elif an is not None and an['mouth']['kind'] == 'taper':
        mo = an['mouth']
        inlet = {'type': 'taper', 'entry_diameter_mm': round(2 * mo['ri'], 3), 'wall_half_angle_deg': round(mo['alpha'], 3),
                 'lip_radius_mm': round(mo['rl'], 3)}
        inlet_len = mo['len']
    elif an is not None and an['mouth']['kind'] == 'profile':
        mo = an['mouth']
        inlet = {'type': 'profile', 'points_mm': [list(p) for p in mo['points']], 'rim_thickness_mm': round(wall_mm, 3)}
        inlet['points_mm'][-1][1] = round(D, 3) / 2.0
        inlet_len = mo['len']
    elif lip_mm:
        inlet = {'type': 'radius', 'lip_radius_mm': round(lip_mm, 3)}
        inlet_len = lip_mm
    else:
        inlet = {'type': 'plain', 'wall_thickness_mm': round(wall_mm, 3)}
        inlet_len = min(1e-3 * D, 0.05)        # the generator's sharp-edge radius (intake_cfd._edge_radius)
    for i, b in enumerate(bends, 1):
        if b['clr_mm'] < MIN_CLR_D * D - 1e-6:
            raise Refused('Bend %d is on a %s centre-line radius, under 0.6 times the %s bore: tighter than the CFD mesh '
                          'takes cleanly (and than a tube bender makes).' % (i, mm_in(b['clr_mm']), mm_in(D, 2)))
    if bends and bends[0]['start_mm'] < inlet_len + 0.1:
        raise Refused('The tube starts in a bend right at the mouth: the CFD case needs a short straight at the open end '
                      '(the mouth sits flush in a flat wall), at least %s.' % mm_in(inlet_len + 0.1, 1))
    if L < inlet_len + D:
        raise Refused('The tube is %s long, shorter than its own bore (%s): too short to test.' % (mm_in(L), mm_in(D, 2)))
    geometry = {'tube_diameter_mm': round(D, 3), 'tube_length_mm': round(L, 3), 'inlet': inlet, 'mount': {'type': 'flange'}}
    if bends:
        bl = [{'clr_mm': round(b['clr_mm'], 3), 'angle_deg': round(b['angle_deg'], 3), 'start_mm': round(b['start_mm'], 3),
               'plane_deg': round(b['plane_deg'], 3)} for b in bends]
        geometry['bend'] = bl
        # a tube that ends in a bend: the rounded numbers must not put the bend's end past the rounded length (the
        # generator refuses a bend ending beyond the tract end)
        last = bl[-1]
        end = last['start_mm'] + last['clr_mm'] * math.radians(last['angle_deg'])
        if geometry['tube_length_mm'] < end:
            geometry['tube_length_mm'] = math.ceil(end * 1000.0) / 1000.0
    chs = (an.get('changes') or ([an['change']] if an.get('change') else [])) if an else []
    cone, cones = None, []
    if chs:
        # the generator's diameter_change (one dict, or a list when the bore changes more than once): start, end
        # diameter and half-angle of each straight cone, each from the bore before it (its length follows from those:
        # intake_cfd.tube_radius), worked from the rounded diameters so each cone ends where the real one does
        Dr = geometry['tube_diameter_mm']
        Dprev, prev_x1, entries = Dr, None, []
        for ch in chs:
            D2 = round(2.0 * ch['R2'], 3)
            x0 = round(ch['x0'], 3)
            if prev_x1 is not None and x0 < prev_x1:
                x0 = math.ceil(prev_x1 * 1000.0) / 1000.0
            beta = round(math.degrees(math.atan(abs(D2 - Dprev) / 2.0 / (ch['x1'] - ch['x0']))), 6)
            Lc = abs(D2 - Dprev) / 2.0 / math.tan(math.radians(beta))
            # rounding must not put a cone on a straight a hair into a bend (the generator refuses any overlap unless
            # it meshes cones on bends, CONE_ON_BEND)
            for b in ([] if CONE_ON_BEND else geometry.get('bend', [])):
                e = b['start_mm'] + b['clr_mm'] * math.radians(b['angle_deg'])
                if b['start_mm'] - 0.06 < x0 + Lc and x0 + Lc > b['start_mm'] and x0 < b['start_mm']:
                    x0 = math.floor((b['start_mm'] - Lc) * 1000.0) / 1000.0
                if e - 0.06 < x0 < e:
                    x0 = math.ceil(e * 1000.0) / 1000.0
            x1 = x0 + Lc
            entries.append({'to_diameter_mm': D2, 'cone_half_angle_deg': beta, 'start_mm': x0})
            cones.append({'start_mm': x0, 'end_mm': x1, 'from_mm': Dprev, 'to_mm': D2, 'half_angle_deg': beta, 'length_mm': Lc,
                          'at_throttle': bool(ch['end']), 'off_straight_mm': ch['dev']})
            Dprev, prev_x1 = D2, x1
        geometry['diameter_change'] = entries[0] if len(entries) == 1 else entries
        # measuring planes at each mid-run change (reducer_in / reducer_out, numbered when there are several) and,
        # for the cone to the throttle bore, the end of the constant tube and the throttle face; each plane's K is
        # referred to the bore at that plane (its own area: area_geometric_m2 in results.json)
        mids = [c for c in cones if not c['at_throttle']]
        planes = {}
        for j, c in enumerate(mids, 1):
            tag = 'reducer' if len(mids) == 1 else 'reducer%d' % j
            planes[tag + '_in'] = c['start_mm']
            planes[tag + '_out'] = round(c['end_mm'], 4)
        last = cones[-1]
        if last['at_throttle']:
            # the cone to the throttle bore: the tract-end plane half a tube bore past the throttle face, where the
            # Intake tab's own CFD case puts it (cfdDesign in web/index.html: its cone ends 0.5 D before the tract end);
            # the generator runs the throttle bore on straight past the tract end anyway, so this only places the plane
            geometry['tube_length_mm'] = math.ceil((last['end_mm'] + 0.5 * Dr) * 1000.0) / 1000.0
            planes['tube_end'] = last['start_mm']
            planes['throttle_face'] = round(last['end_mm'], 4)
        else:
            geometry['tube_length_mm'] = max(geometry['tube_length_mm'], math.ceil(last['end_mm'] * 1000.0) / 1000.0)
        geometry['planes_mm'] = planes
        cone = last if last['at_throttle'] else cones[0]
    protrusion = None
    if mount == 'free':
        # the generator's free mount (cfd/intake_cfd.py free_mount_surface): the outside is a straight cylinder from the
        # lip back to the plenum wall, which must come before the first bend or bore change; the protrusion is its
        # default, max(inlet piece, D) cut back to that straight, at least the lip + 0.15 D
        limit = geometry['tube_length_mm']
        for b in geometry.get('bend', []):
            limit = min(limit, b['start_mm'])
        for c in cones:
            limit = min(limit, c['start_mm'])
        o_x = {'radius': inlet.get('lip_radius_mm', 0.0), 'taper': inlet.get('lip_radius_mm', 0.0)}.get(inlet['type'], 0.05)
        p_min = o_x + 0.15 * geometry['tube_diameter_mm']
        if p_min > limit + 1e-6:
            raise Refused('A free-standing mouth needs %s of straight tube of one bore behind it (the outside is modelled '
                          'straight back to the plenum wall), but the first bend or change of bore is %s from the mouth: '
                          'test it flange-mounted.' % (mm_in(p_min), mm_in(limit)))
        protrusion = max(min(max(inlet_len, geometry['tube_diameter_mm']), limit), p_min)
        geometry['mount'] = {'type': 'free'}
    elif mount != 'flange':
        raise ValueError('mount must be flange or free, not %r' % (mount,))
    geometry['outlet_extension_D'] = 4
    mouth = {'kind': inlet['type']}
    if an is not None:
        mouth.update({k: v for k, v in an['mouth'].items() if k != 'kind'})
    return geometry, {'length_mm': L, 'bore_mm': D, 'wall_mm': wall_mm, 'lip_mm': lip_mm if inlet['type'] == 'radius' else None,
                      'bends': bends, 'frame': frame, 'inlet': inlet, 'mouth': mouth, 'cone': cone, 'cones': cones,
                      'notes': list(an['notes']) if an else [], 'case_length_mm': geometry['tube_length_mm'],
                      'mount': geometry['mount']['type'], 'protrusion_mm': protrusion}


def tab_fill(info):
    """The Intake tab's inputs for this tube: length, bore, bend angles from the mouth, the bend radius when every bend
    has the same one, the CFD bend starts, the mouth (plain cut or a lip radius)."""
    bends = info['bends']
    radii = [b['clr_mm'] for b in bends]
    same = bool(radii) and max(radii) - min(radii) <= 0.5
    cone = info.get('cone')
    cones = info.get('cones') or ([cone] if cone else [])
    kind = (info.get('inlet') or {}).get('type') or ('radius' if info.get('lip_mm') else 'plain')
    # the tab's mouth list: plain cut, rolled lip or radius, elliptical bellmouth (its nearest to a straight flare or a
    # measured flare)
    mouth = {'plain': 'plain', 'radius': 'radius', 'ellipse': 'ellipse', 'taper': 'ellipse', 'profile': 'ellipse'}[kind]
    tbc = next((c for c in cones if c['at_throttle']), None)
    red = next((c for c in cones if not c['at_throttle']), None)
    at_tb = tbc is not None
    return {'lt_mm': round(info['case_length_mm'] if at_tb else info['length_mm'], 2), 'dt_mm': round(info['bore_mm'], 3),
            'wall_mm': round(info['wall_mm'], 3),
            'bend_angles': [round(b['angle_deg'], 1) for b in bends], 'bend_count': len(bends),
            'bend_r_mm': round(sum(radii) / len(radii), 2) if same else None,
            'bend_r_mean_mm': round(sum(radii) / len(radii), 2) if radii else None,
            'bend_starts_mm': [round(b['start_mm'], 1) for b in bends],
            'mouth': mouth, 'mouth_read': kind, 'lip_mm': round(info['lip_mm'], 2) if mouth == 'radius' and info.get('lip_mm') else None,
            # the throttle-body bore: the cone's large end, only when the tube ends in that cone
            'tb_mm': round(tbc['to_mm'], 2) if at_tb else None,
            'reducer': {'from_mm': red['from_mm'], 'to_mm': red['to_mm'], 'start_mm': round(red['start_mm'], 1)} if red else None}


def describe_mouth(info):
    m, inl = info.get('mouth') or {}, info.get('inlet') or {}
    t = inl.get('type') or ('radius' if info.get('lip_mm') else 'plain')
    if t == 'radius':
        return 'a %s radius on the inside edge' % mm_in(info['lip_mm'] if info.get('lip_mm') else inl['lip_radius_mm'], 2)
    if t == 'ellipse':
        return 'an elliptical bellmouth %s long from a %s entry' % (mm_in(inl['length_mm']), mm_in(inl['entry_diameter_mm'], 1))
    if t == 'taper':
        return 'a straight flare, %.1f degrees a side from a %s entry, with a %s lip radius' % (
            inl['wall_half_angle_deg'], mm_in(inl['entry_diameter_mm'], 1), mm_in(inl['lip_radius_mm'], 2))
    if t == 'profile':
        pts = inl['points_mm']
        return 'a flare taken as measured (%d points), from a %s entry over %s' % (len(pts), mm_in(2 * pts[0][1], 1), mm_in(pts[-1][0]))
    return 'square cut'


def describe(info, name='The tube'):
    """One plain paragraph: what was read, every dimension in mm and inches."""
    parts = ['%s: %s bore, %s wall, %s along the centreline from the mouth to the end' % (
        name, mm_in(info['bore_mm'], 2), mm_in(info['wall_mm'], 2), mm_in(info['length_mm']))]
    for i, b in enumerate(info['bends'], 1):
        rot = ''
        if i > 1:
            r = (b['plane_deg'] - info['bends'][i - 2]['plane_deg'] + 180.0) % 360.0 - 180.0
            rot = ', clocked %.0f degrees round the tube from bend %d' % (r, i - 1)
        parts.append('bend %d: %.1f degrees on a %s centre-line radius, starting %s from the mouth%s' % (
            i, b['angle_deg'], mm_in(b['clr_mm']), mm_in(b['start_mm']), rot))
    if not info['bends']:
        parts.append('straight')
    parts.append('mouth: %s' % describe_mouth(info))
    if info.get('mount') == 'free':
        parts.append('tested free-standing: the tube stands %s proud of the plenum wall, its outside a wall' % mm_in(info['protrusion_mm']))
    for c in (info.get('cones') or ([info['cone']] if info.get('cone') else [])):
        parts.append('%s from %s to %s bore, %s long (%.2f degrees a side) from %s to %s from the mouth%s' % (
            'a cone' if c['to_mm'] > c['from_mm'] else 'a reducer', mm_in(c['from_mm'], 2), mm_in(c['to_mm'], 2), mm_in(c['length_mm']),
            c['half_angle_deg'], mm_in(c['start_mm']), mm_in(c['end_mm']),
            ', ending at the throttle face; the tract-end plane is half a tube bore past it, in the throttle bore, where the Intake '
            'tab\'s own CFD case measures' if c['at_throttle'] else ''))
    return '; '.join(parts) + '.' + ''.join(' ' + n for n in info.get('notes') or [])


def tube_design(curves, bore_mm, wall_mm, lip_mm=None, mouth_at_end=False, cover=None, mount='flange'):
    """curves: [{'pts': [...], 'length': mm}] in chain order (each from its start to its end); bore and wall (mm);
    mouth_at_end: the air enters at the chain's far end; cover: (s0, s1) mm of the chain the tube body covers.
    -> (geometry, info, segs from the mouth)."""
    segs = join([classify(c['pts'], c['length']) for c in curves])
    if cover is not None:
        segs = trim(segs, cover[0], cover[1])
        if not segs:
            raise Refused('The tube body does not cover its centreline.')
    if mouth_at_end:
        segs = reverse(segs)
    geometry, info = design_geometry(segs, bore_mm, wall_mm, lip_mm, mount=mount)
    return geometry, info, segs


def covered(probe):
    """The probed path trimmed to the tube body (from the body's start to its end, as the path runs)."""
    segs = trim(probe['segs'], probe['s0'], probe['s1'])
    if not segs:
        raise Refused('The tube body does not cover its centreline.')
    return segs


def tube_from_probe(probe, bore_mm, wall_mm, at_end=False, lip_mm=None, mount='flange'):
    """A probed tube (probe_bore) as the generator's design: trimmed to the body, the mouth at its start or (at_end)
    its end, the bore read with analyse_bore. -> (geometry, info, segs from the mouth)."""
    segs = covered(probe)
    if at_end:
        segs = reverse(segs)
    geometry, info = design_geometry(segs, bore_mm, wall_mm, lip_mm, profile=profile_from(probe, at_end), mount=mount)
    return geometry, info, segs
