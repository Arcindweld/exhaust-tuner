"""Mounts: a bracket from a mount point on a part (an intercooler's end tank, a barrel cooler, an oil cooler, a catch can)
to a point on the chassis, in plain Python (no Fusion), so it is tested on its own (tests/test_mounts.py); cadtools'
mountPick, mountBuild and mountPlace use it.

The page's Mounts designer (Hangers tab) sizes each bracket by calculation (loads, isolators, thickness, bolts, welds);
this module puts the same bracket in place against the scan and checks what only the model can check:

  bracket_axes   the bracket's own frame from the two picks: n square to the chassis face (toward the part), h the
                 reach along n, u along the bend line (toward the part's point when it is offset), s that offset, f = n x u
                 square to the upright's face.
  upright, foot  the flat outlines (the page's segment format, mm) of the plate that stands up to the part and the foot
                 that bolts to the chassis; plates() places them with hangers.plan (a frame per plate), cm out.
  flat_pattern   the bent strap laid flat: foot, bend allowance, upright; the bend line where the page puts it.
  access         a straight-line access check along a bolt axis: a cylinder of the socket's radius from just above the
                 bolt head out to the tool length, tested against sampled keep-out points (labelled as such: it is not
                 a wrench-swing check).
  clearance      the plates' sampled points against the keep-outs, hot ones at the hot clearance; the part of the bracket
                 that is meant to touch (the foot on the chassis, the boss on the part) is left out.

Frames are in Fusion's units (cm); the bracket's sizes are in mm, as the page sends them.
"""
import math

try:
    from . import hangers as HGR
except ImportError:          # loaded as a top-level module
    import hangers as HGR

_v, _sub, _dot, _cross, _unit = HGR._v, HGR._sub, HGR._dot, HGR._cross, HGR._unit


def _norm(a):
    return math.sqrt(_dot(a, a))


def _tri_dist2(p, a, b, c):
    """Squared distance from p to the triangle abc (closest point by region, as in Ericson, Real-Time Collision
    Detection, 5.1.5)."""
    ab, ac, ap = _sub(b, a), _sub(c, a), _sub(p, a)
    d1, d2 = _dot(ab, ap), _dot(ac, ap)
    if d1 <= 0 and d2 <= 0:
        q = a
    else:
        bp = _sub(p, b)
        d3, d4 = _dot(ab, bp), _dot(ac, bp)
        cp = _sub(p, c)
        d5, d6 = _dot(ab, cp), _dot(ac, cp)
        vc, vb, va = d1 * d4 - d3 * d2, d5 * d2 - d1 * d6, d3 * d6 - d5 * d4
        if d3 >= 0 and d4 <= d3:
            q = b
        elif d6 >= 0 and d5 <= d6:
            q = c
        elif vc <= 0 and d1 >= 0 and d3 <= 0:
            q = _v(a, ab, d1 / (d1 - d3))
        elif vb <= 0 and d2 >= 0 and d6 <= 0:
            q = _v(a, ac, d2 / (d2 - d6))
        elif va <= 0 and (d4 - d3) >= 0 and (d5 - d6) >= 0:
            q = _v(b, _sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)))
        else:
            den = 1.0 / (va + vb + vc)
            q = _v(_v(a, ab, vb * den), ac, vc * den)
    w = _sub(p, q)
    return _dot(w, w)


def normal_near(coords, idx, c, r):
    """The surface normal of a mesh near point c (cm): the area-weighted mean of the normals of the triangles that
    come within r of c. A mesh's triangles may be wound either way, so each is lined up with the first; the sign is
    settled by bracket_axes (toward the part). None when no triangle is near."""
    acc = [0.0, 0.0, 0.0]
    r2 = r * r
    for k in range(0, len(idx) - 2, 3):
        a, b, d = (tuple(coords[3 * idx[k + j] + q] for q in range(3)) for j in range(3))
        if _tri_dist2(c, a, b, d) > r2:
            continue
        nrm = _cross(_sub(b, a), _sub(d, a))          # length = twice the area
        if _dot(nrm, acc) < 0:
            nrm = (-nrm[0], -nrm[1], -nrm[2])
        acc = [acc[q] + nrm[q] for q in range(3)]
    if _norm(acc) < 1e-12:
        return None
    return _unit(acc)


def bracket_axes(P, C, n, u_pref=None, tol_cm=0.05):
    """The bracket frame from the part's mount point P, the chassis point C and the chassis normal n (cm). n is turned
    toward P. u: along the offset of P from C in the chassis plane when it is more than tol_cm, else u_pref (made square
    to n), else any direction square to n. Returns n, u, f (= n x u), h (cm), s (cm, >= 0) and whether u was fixed by
    the offset."""
    n = _unit(n)
    d = _sub(P, C)
    if _dot(d, n) < 0:
        n = (-n[0], -n[1], -n[2])
    h = _dot(d, n)
    v = _v(d, n, -h)
    s = _norm(v)
    fixed = s > tol_cm
    if fixed:
        u = _unit(v)
    else:
        cand = [u_pref] if u_pref is not None else []
        cand += [(1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)]
        u = None
        for q in cand:
            w = _v(q, n, -_dot(q, n))
            if _norm(w) > 0.3:
                u = _unit(w)
                break
        s = 0.0 if not fixed else s
    f = _cross(n, u)
    return {'n': n, 'u': u, 'f': f, 'h': h, 's': s if fixed else 0.0, 'u_fixed': fixed, 'P': P, 'C': C}


def _tangent(B, Q, r, side):
    """The point where a line from B touches the circle (Q, r): side -1 for the line on B's right (clockwise turn from
    B->Q), +1 on its left."""
    dx, dy = Q[0] - B[0], Q[1] - B[1]
    D = math.hypot(dx, dy)
    if D <= r + 1e-9:
        raise ValueError('The reach is too short for this width: the hole’s boss reaches the base.')
    a = side * math.asin(r / D)
    L = math.sqrt(D * D - r * r)
    ux, uy = dx / D, dy / D
    c, s = math.cos(a), math.sin(a)
    return (B[0] + L * (c * ux - s * uy), B[1] + L * (s * ux + c * uy))


def tab_outline(b, y0, s, yq, rb):
    """A tab from a straight base at y0 (x from -b/2 to b/2) to a round end of radius rb centred at (s, yq): two
    tangent lines and the arc over the top, counter-clockwise, in the page's segment format (mm)."""
    B1, B2, Q = (-b / 2.0, y0), (b / 2.0, y0), (s, yq)
    T2 = _tangent(B2, Q, rb, -1)
    T1 = _tangent(B1, Q, rb, +1)
    a0 = math.atan2(T2[1] - Q[1], T2[0] - Q[0])
    a1 = math.atan2(T1[1] - Q[1], T1[0] - Q[0])
    return [{'t': 'L', 'a': list(B1), 'b': list(B2)}, {'t': 'L', 'a': list(B2), 'b': list(T2)},
            {'t': 'A', 'c': list(Q), 'r': rb, 'a0': a0, 'a1': a1, 'ccw': True}, {'t': 'L', 'a': list(T1), 'b': list(B1)}]


def foot_holes(D):
    """The foot's bolt holes (x along the bend line, y out from the upright's inner face), mm."""
    F = D['foot']
    xs = [0.0] if int(F.get('nb', 1)) == 1 else [-F['sb'] / 2.0, F['sb'] / 2.0]
    return [(x, F['a']) for x in xs]


def flat_pattern(D):
    """The bent strap (types strap, gusset, print) laid flat, mm: y = 0 at the foot's free end, the foot, the bend
    allowance, then the upright to its hole and round end. Foot: L (inner face of the upright to the free end) less the
    setback (R + t) is flat; the bend allowance is (pi/2)(R + K t) for 90 degrees; the upright is flat from the bend's
    end to the hole for h - (R + t), h measured from the chassis face (the foot's underside) to the hole centre.
    Returns the outline, holes, the bend's start, centre and end lines (y) and the developed length."""
    t, b, R, K = D['t'], D['b'], D['R'], D['K']
    F = D['foot']
    rb = D.get('boss') or b / 2.0
    y1 = F['L'] - R
    BA = math.pi / 2.0 * (R + K * t)
    y2 = y1 + BA
    hu = D['h'] - (R + t)
    if y1 <= 0:
        raise ValueError('The foot is shorter than the bend: make it longer than the inside radius.')
    if hu <= rb:
        raise ValueError('The reach is too short for this width: the hole’s boss reaches the bend.')
    yq = y2 + hu
    up = tab_outline(b, y2, D.get('s', 0.0), yq, rb)
    outline = [{'t': 'L', 'a': [-b / 2.0, 0.0], 'b': [b / 2.0, 0.0]}, {'t': 'L', 'a': [b / 2.0, 0.0], 'b': [b / 2.0, y2]}] + up[1:3] + \
              [up[3], {'t': 'L', 'a': [-b / 2.0, y2], 'b': [-b / 2.0, 0.0]}]
    # a foot hole a from the upright's inner face is L - a from the free end, which is y1 - (a - R) (y1 = L - R)
    holes = [{'t': 'C', 'c': [x, y1 - (a - R)], 'r': F['hole'] / 2.0, 'what': 'foot bolt'} for x, a in foot_holes(D)]
    holes.append({'t': 'C', 'c': [D.get('s', 0.0), yq], 'r': D['hole'] / 2.0, 'what': 'part bolt'})
    for L in D.get('light') or []:
        holes.append({'t': 'C', 'c': [D.get('s', 0.0) * L['y'] / D['h'], y2 + L['y'] - (R + t)], 'r': L['d'] / 2.0, 'what': 'lightening hole'})
    return {'outline': outline, 'holes': holes, 'bend': {'start': y1, 'centre': y1 + BA / 2.0, 'end': y2, 'BA': BA},
            'length': yq + rb, 'width': b}


def gusset_outline(D):
    """The gusset (type gusset): a right triangle with legs hg along the foot and up the upright, measured from the
    upright's inner face and the chassis face, its corner cut back by R + t so it clears the bend, mm (x along the
    foot, y up)."""
    hg, c = D['hg'], D['R'] + D['t']
    pts = [(c, 0.0), (hg, 0.0), (0.0, hg), (0.0, c)]
    return [{'t': 'L', 'a': list(pts[i]), 'b': list(pts[(i + 1) % 4])} for i in range(4)]


def _plate_frame(O, ex, ey):
    ez = _cross(ex, ey)
    return {'S': O, 'X': ex, 'Y': ey, 'Z': ez}


def plates(ax, D, foot_side=1, plate_side=1):
    """The bracket's plates in the model (cm), each as hangers.plan gives them (loops of model points, round holes, a
    sketch plane and the thickness), from the frame ax (bracket_axes) and the design D (mm). The upright (or a
    channel's web) lies in the plane of u and n with one face on the part's point P: plate_side +1 puts the plate on
    the +f side of P (so the part is on the -f side), -1 the other way. The foot runs out along foot_side x f from the
    upright's heel. The upright is modelled from the chassis face (a sharp corner; the flat pattern has the bend)."""
    n, u, f, C = ax['n'], ax['u'], ax['f'], ax['C']
    t, b = D['t'], D['b']
    tc = t / 10.0
    h_mm, s_mm = 10.0 * ax['h'], 10.0 * ax['s']
    rb = D.get('boss') or b / 2.0
    pmin, pmax = (0.0, tc) if plate_side > 0 else (-tc, 0.0)
    heel = pmin if foot_side > 0 else pmax
    f_in = heel + foot_side * tc                       # the upright's inner face, where the foot's y = 0
    fs = (f[0] * foot_side, f[1] * foot_side, f[2] * foot_side)
    nm = D.get('name', 'Bracket')
    out = []
    kind = D['type']
    holes_u = [{'t': 'C', 'c': [s_mm, h_mm], 'r': D['hole'] / 2.0}]
    for L in D.get('light') or []:
        holes_u.append({'t': 'C', 'c': [s_mm * L['y'] / h_mm, L['y']], 'r': L['d'] / 2.0})
    Ou = _v(C, f, (pmin + pmax) / 2.0)
    out.append((_plate_frame(Ou, u, n), {'outline': tab_outline(b, 0.0, s_mm, h_mm, rb), 'holes': holes_u, 'plane': 'across',
                                         'o2': [0, 0], 'off': 0, 't': t, 'name': nm + (' web' if kind == 'channel' else ' upright')}))
    F = D['foot']
    Of = _v(_v(C, f, f_in), n, tc / 2.0)
    y_lo, y_hi = -t, F['L']
    foot = [{'t': 'L', 'a': [-b / 2.0, y_lo], 'b': [b / 2.0, y_lo]}, {'t': 'L', 'a': [b / 2.0, y_lo], 'b': [b / 2.0, y_hi]},
            {'t': 'L', 'a': [b / 2.0, y_hi], 'b': [-b / 2.0, y_hi]}, {'t': 'L', 'a': [-b / 2.0, y_hi], 'b': [-b / 2.0, y_lo]}]
    fh = [{'t': 'C', 'c': [x, a], 'r': F['hole'] / 2.0} for x, a in foot_holes(D)]
    out.append((_plate_frame(Of, u, fs), {'outline': foot, 'holes': fh, 'plane': 'across', 'o2': [0, 0], 'off': 0, 't': t,
                                          'name': nm + (' foot plate' if kind == 'channel' else ' foot')}))
    if kind == 'channel':
        # a boxed bracket: the web is the upright, two flanges hf stand off it away from the part, on a foot plate
        hf = D['hf']
        back = pmax if plate_side > 0 else pmin
        pf = (f[0] * plate_side, f[1] * plate_side, f[2] * plate_side)
        for sg in (-1, 1):
            Ofl = _v(_v(C, u, sg * (b / 2.0 - t / 2.0) / 10.0), f, back)
            fl = [{'t': 'L', 'a': [0.0, 0.0], 'b': [hf, 0.0]}, {'t': 'L', 'a': [hf, 0.0], 'b': [hf, h_mm - rb]},
                  {'t': 'L', 'a': [hf, h_mm - rb], 'b': [0.0, h_mm - rb]}, {'t': 'L', 'a': [0.0, h_mm - rb], 'b': [0.0, 0.0]}]
            out.append((_plate_frame(Ofl, pf, n), {'outline': fl, 'holes': [], 'plane': 'across', 'o2': [0, 0], 'off': 0, 't': t,
                                                   'name': nm + (' flange L' if sg < 0 else ' flange R')}))
    if kind == 'gusset':
        out.append((_plate_frame(_v(C, f, f_in), fs, n), {'outline': gusset_outline(D), 'holes': [], 'plane': 'across', 'o2': [0, 0],
                                                          'off': 0, 't': t, 'name': nm + ' gusset'}))
    res = []
    for fr, part in out:
        res += HGR.plan({'parts': [part]}, fr)['plates']
    return res


def foot_bolts(ax, D, foot_side=1, plate_side=1):
    """Where each foot bolt's axis leaves the foot's top face (cm), and the axis (n)."""
    tc = D['t'] / 10.0
    pmin, pmax = (0.0, tc) if plate_side > 0 else (-tc, 0.0)
    f_in = (pmin if foot_side > 0 else pmax) + foot_side * tc
    return [_v(_v(_v(ax['C'], ax['u'], x / 10.0), ax['f'], f_in + foot_side * a / 10.0), ax['n'], tc) for x, a in foot_holes(D)]


def stay(ax, D):
    """A welded tube stay with rod ends (type stay): a straight tube from the chassis point to the part's point, cm.
    The tube is cut D['stay']['re'] mm short of each rod-end centre."""
    S = D['stay']
    a, bpt = ax['C'], ax['P']
    L = _norm(_sub(bpt, a))
    d = _unit(_sub(bpt, a))
    re = S['re'] / 10.0
    if L <= 2 * re:
        raise ValueError('The stay is shorter than its two rod ends: pick points further apart or shorter rod ends.')
    return {'name': D.get('name', 'Bracket') + ' stay tube', 'a': _v(a, d, re), 'b': _v(bpt, d, -re), 'r': S['od'] / 20.0,
            'r_in': S['od'] / 20.0 - S['wall'] / 10.0, 'cut_mm': 10.0 * L - 2 * S['re'], 'centres_mm': 10.0 * L}


def plate_points(pl, step_cm=0.4):
    """Points spread over a plate's two faces (cm): its outline loop's polygon (arcs by their three points) filled on a
    grid, and the outline itself, both faces."""
    o, px, py = pl['plane3']
    ex, ey = _unit(_sub(px, o)), _unit(_sub(py, o))
    nz = _unit(_cross(ex, ey))
    poly = []
    for sg in pl['loops'][0]:
        for q in sg[1:]:
            d = _sub(q, o)
            poly.append((_dot(d, ex), _dot(d, ey)))
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    out = []
    # the outline itself, so an edge is never further than the grid from the points
    for k in range(len(poly)):
        a, b = poly[k], poly[(k + 1) % len(poly)]
        m = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / step_cm) + 1)
        for j in range(m):
            q = (a[0] + (b[0] - a[0]) * j / m, a[1] + (b[1] - a[1]) * j / m)
            base = _v(_v(o, ex, q[0]), ey, q[1])
            out.append(_v(base, nz, pl['t'] / 2.0))
            out.append(_v(base, nz, -pl['t'] / 2.0))
    y = min(ys) + step_cm / 2.0
    while y < max(ys):
        x = min(xs) + step_cm / 2.0
        while x < max(xs):
            if _inside((x, y), poly):
                base = _v(_v(o, ex, x), ey, y)
                out.append(_v(base, nz, pl['t'] / 2.0))
                out.append(_v(base, nz, -pl['t'] / 2.0))
            x += step_cm
        y += step_cm
    return out


def _inside(p, poly):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        a, b = poly[i], poly[j]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
        j = i
    return c


def clearance(points, cold, hot, gap_cm, hot_gap_cm, skip=None):
    """The nearest the points come to the keep-outs: (gap to the ordinary ones or None, gap to the hot ones or None,
    ok). skip(p) True leaves a point out (the foot on the chassis, the boss on the part)."""
    pts = [p for p in points if not (skip and skip(p))]
    gc = gh = None
    ok = True
    if cold is not None and pts:
        gc, _i = cold.nearest(pts, gap_cm * 4 + 5.0)
        ok &= gc >= gap_cm - 1e-9
    if hot is not None and pts:
        gh, _i = hot.nearest(pts, hot_gap_cm * 4 + 5.0)
        ok &= gh >= hot_gap_cm - 1e-9
    return gc, gh, ok


def access(o, d, r_cm, z0_cm, L_cm, obstacles):
    """Straight-line tool access along a bolt axis: a cylinder of radius r_cm round the axis from o along d, from z0_cm
    (just above the bolt head) to L_cm. obstacles: a list of point sets (lists of cm points) or objects with
    points_near(c, rad) (a router Scene). Returns (clear, the first height where something is inside the cylinder or
    None)."""
    d = _unit(d)
    first = None
    step = max(0.1, r_cm / 2.0)
    z = z0_cm
    while z <= L_cm + 1e-9:
        c = _v(o, d, z)
        rad = math.sqrt(r_cm * r_cm + step * step)
        for ob in obstacles:
            near = ob.points_near(c, rad) if hasattr(ob, 'points_near') else [q for q in ob if _dot(_sub(q, c), _sub(q, c)) <= rad * rad]
            for q in near:
                w = _sub(q, o)
                zq = _dot(w, d)
                if zq < z0_cm - 1e-9 or zq > L_cm + 1e-9:
                    continue
                rq = _norm(_v(w, d, -zq))
                if rq < r_cm - 1e-9 and (first is None or zq < first):
                    first = zq
        if first is not None and first <= z:
            break
        z += step
    return first is None, first


def box_points(lo, hi, step_cm=0.5):
    """Points over the surface of a box (cm), for the part's placeholder when it is not a keep-out."""
    out = []
    for k in range(3):
        a, b = [q for q in range(3) if q != k]
        for side in (lo[k], hi[k]):
            ua = lo[a]
            while ua <= hi[a] + 1e-9:
                ub = lo[b]
                while ub <= hi[b] + 1e-9:
                    p = [0.0, 0.0, 0.0]
                    p[k], p[a], p[b] = side, ua, ub
                    out.append(tuple(p))
                    ub += step_cm
                ua += step_cm
    return out


def check(ax, D, cold, hot, opts, part_pts=None):
    """Build the plates for one bracket on both foot sides and keep the better: clear of the keep-outs (the foot on
    the chassis and the boss on the part left out) and with straight-line tool access to its bolts. Returns the plates
    and a report."""
    t_cm = D['t'] / 10.0
    rb_cm = (D.get('boss') or D['b'] / 2.0) / 10.0
    gap, hot_gap = opts['gap_cm'], opts['hot_gap_cm']
    rs, Lt = opts['socket_r_cm'], opts['tool_cm']
    best = None
    ps = opts.get('plate_side', 1)
    for side in (1, -1):
        if D['type'] == 'stay':
            st = stay(ax, D)
            pls = []
            dd = _unit(_sub(st['b'], st['a']))
            pts = [_v(st['a'], dd, k * 0.4) for k in range(int(_norm(_sub(st['b'], st['a'])) / 0.4) + 1)]
        else:
            pls = plates(ax, D, side, ps)
            pts = [p for pl in pls for p in plate_points(pl)]

        def skip(p, C=ax['C'], P=ax['P'], n=ax['n']):
            # the foot (within its thickness and the clearance of the chassis face) and the part's boss
            if _dot(_sub(p, C), n) < 2 * t_cm + gap:
                return True
            return _norm(_sub(p, P)) < rb_cm + gap + t_cm
        gc, gh, ok = clearance(pts, cold, hot, gap, hot_gap, skip)
        obst = [o for o in (cold, hot) if o is not None]
        if part_pts:
            obst.append(part_pts)
        own = [p for pl in pls for p in plate_points(pl, 0.2)]
        acc = []
        if D['type'] != 'stay':
            for (x, a), o in zip(foot_holes(D), foot_bolts(ax, D, side, ps)):
                head = (D['foot'].get('bolt') or D['foot']['hole']) / 10.0
                clear, at = access(o, ax['n'], rs, head, Lt, obst + [own])
                acc.append({'bolt': 'foot', 'x_mm': x, 'clear': clear, 'blocked_mm': None if at is None else 10.0 * at})
            # the part's bolt: along f through the hole, either way
            o = ax['P']
            c1, a1 = access(o, ax['f'], rs, t_cm + (D.get('bolt') or D['hole']) / 10.0, Lt, obst)
            c2, a2 = access(o, (-ax['f'][0], -ax['f'][1], -ax['f'][2]), rs, t_cm + (D.get('bolt') or D['hole']) / 10.0, Lt, obst)
            acc.append({'bolt': 'part', 'clear': c1 or c2, 'blocked_mm': None if (c1 or c2) else 10.0 * min(a1, a2),
                        'side': '+f' if c1 else '-f' if c2 else None})
        score = (ok, sum(1 for a in acc if a['clear']), min(x for x in (gc, gh, 99.0) if x is not None))
        rep = {'foot_side': side, 'plate_side': ps, 'gap_mm': None if gc is None else 10.0 * gc, 'hot_gap_mm': None if gh is None else 10.0 * gh,
               'clear': ok, 'access': acc, 'h_mm': 10.0 * ax['h'], 's_mm': 10.0 * ax['s']}
        if D['type'] == 'stay':
            rep['stay'] = {k: st[k] for k in ('cut_mm', 'centres_mm')}
        if best is None or score > best[0]:
            best = (score, pls, rep)
        if D['type'] == 'stay':
            break
    return best[1], best[2]


def public_axes(ax):
    return {'h_mm': round(10.0 * ax['h'], 2), 's_mm': round(10.0 * ax['s'], 2), 'u_fixed': ax['u_fixed'],
            'n': [round(x, 6) for x in ax['n']], 'u': [round(x, 6) for x in ax['u']], 'f': [round(x, 6) for x in ax['f']]}
