"""A selected intake tube -> the parametric design cfd/intake_cfd.py takes (and the Intake tab's inputs). Pure geometry,
no Fusion: cadtools.act_cfd_tube samples the tube's centreline curves and probes its bore, then hands the samples here.
Units are mm and degrees.

What it takes: a constant-bore round tube whose centreline is straights and circular arcs, joined end to end and
tangent (a Pipe along a sketch of lines and arcs, or a bent tube modelled that way). Anything else is refused with a
sentence saying why (a spline, a kink, a bend tighter than the mesher takes, a bend right at the mouth).

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


def design_geometry(segs, bore_mm, wall_mm, lip_mm=None):
    """The 'geometry' block of a design for intake_cfd.py, and what was read (for the panel)."""
    L = total(segs)
    bends, frame = bends_from_path(segs)
    D = bore_mm
    if lip_mm:
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
    geometry['outlet_extension_D'] = 4
    return geometry, {'length_mm': L, 'bore_mm': D, 'wall_mm': wall_mm, 'lip_mm': lip_mm, 'bends': bends, 'frame': frame}


def tab_fill(info):
    """The Intake tab's inputs for this tube: length, bore, bend angles from the mouth, the bend radius when every bend
    has the same one, the CFD bend starts, the mouth (plain cut or a lip radius)."""
    bends = info['bends']
    radii = [b['clr_mm'] for b in bends]
    same = bool(radii) and max(radii) - min(radii) <= 0.5
    return {'lt_mm': round(info['length_mm'], 2), 'dt_mm': round(info['bore_mm'], 3), 'wall_mm': round(info['wall_mm'], 3),
            'bend_angles': [round(b['angle_deg'], 1) for b in bends], 'bend_count': len(bends),
            'bend_r_mm': round(sum(radii) / len(radii), 2) if same else None,
            'bend_r_mean_mm': round(sum(radii) / len(radii), 2) if radii else None,
            'bend_starts_mm': [round(b['start_mm'], 1) for b in bends],
            'mouth': 'radius' if info.get('lip_mm') else 'plain', 'lip_mm': round(info['lip_mm'], 2) if info.get('lip_mm') else None}


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
    parts.append('mouth: %s' % ('a %s radius on the inside edge' % mm_in(info['lip_mm'], 2) if info.get('lip_mm') else 'square cut'))
    return '; '.join(parts) + '.'


def tube_design(curves, bore_mm, wall_mm, lip_mm=None, mouth_at_end=False, cover=None):
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
    geometry, info = design_geometry(segs, bore_mm, wall_mm, lip_mm)
    return geometry, info, segs
