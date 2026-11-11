"""Split a tube too big for the printer into pieces that each print standing upright, joined by flush bonded lap joints.

Pure geometry, no Fusion: cadtools.act_print_split samples the tube's centreline and hands the stations here, then
builds what this plans. Units are mm.

The joint (both walls thinned where they overlap, so the outside and the bore stay flush and the flow sees nothing):
  the receiver keeps the inner part of its wall for L past the cut (an inner tongue, bore to r_mid - clearance/2),
  the grower carries an outer tongue over it (r_mid + clearance/2 to the outside), L long; the gap between them is the
  epoxy line. A 45 degree chamfer fills the receiver's shoulder and clears the grower's tongue tip, so the step a
  piece prints over is never a flat ledge.

The plan:
  - cuts only in straight runs, far enough from a bend that the whole lap is straight, and clear of any keep-out
    (embossed lettering, bosses, the end lips: whatever on the tube is not plain wall),
  - every piece must stand on an end with no outer tongue (a plain end or a receiver end) with its axis there
    vertical, and fit the bed (height and footprint),
  - fewest pieces, then the smallest largest dimension (dynamic programming over the cut candidates and which side of
    each cut grows the tongue)."""
import math

STEP = 10.0          # mm between cut candidates
RING = 12            # points round each station for the size checks
SPINS = 13           # footprint orientations tried, 0 to 90 degrees


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(a):
    n = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def _perp(t):
    u = _cross(t, (0.0, 0.0, 1.0))
    if _dot(u, u) < 1e-6:
        u = _cross(t, (0.0, 1.0, 0.0))
    u = _unit(u)
    return u, _cross(t, u)


def stations_from_polyline(pts, runs):
    """Stations from centreline points (mm) in order; runs[i] is the straight-run id of segment i -> i+1 (None in a
    bend). Each station: p, t (unit, along the path), s (mm from the first), run (id of the straight it is in, or None)."""
    st, s = [], 0.0
    for i, p in enumerate(pts):
        if i:
            s += math.dist(pts[i - 1], p)
        a, b = (pts[i], pts[i + 1]) if i + 1 < len(pts) else (pts[i - 1], pts[i])
        run = runs[i] if i < len(runs) else runs[-1]
        prev = runs[i - 1] if i > 0 else run
        d = _sub(b, a)
        t = _unit(d) if _dot(d, d) > 1e-18 else (st[-1]['t'] if st else (1.0, 0.0, 0.0))   # a repeated point keeps the last direction
        st.append({'p': tuple(p), 't': t, 's': s, 'run': run if run == prev else None})
    return st


def _rings(st, r):
    out = []
    for q in st:
        u, v = _perp(q['t'])
        out.append([tuple(q['p'][k] + r * (math.cos(2 * math.pi * j / RING) * u[k] + math.sin(2 * math.pi * j / RING) * v[k])
                          for k in range(3)) for j in range(RING)])
    return out


def _piece_points(st, rings, i0, i1, grow_start, grow_end, L, r):
    pts = [p for i in range(i0, i1 + 1) for p in rings[i]]
    for flag, i, sg in ((grow_start, i0, -1.0), (grow_end, i1, 1.0)):
        if flag:
            t = st[i]['t']
            u, v = _perp(t)
            for d in (L / 2.0, L):
                c = tuple(st[i]['p'][k] + sg * d * t[k] for k in range(3))
                pts += [tuple(c[k] + r * (math.cos(2 * math.pi * j / RING) * u[k] + math.sin(2 * math.pi * j / RING) * v[k])
                              for k in range(3)) for j in range(RING)]
    return pts


def _stand(pts, base, axis, bed):
    """Height and footprint standing on `base` with `axis` up; None when something dips below the base plane."""
    zs = [_dot(_sub(p, base), axis) for p in pts]
    if min(zs) < -1.0:
        return None
    u, v = _perp(axis)
    xs = [_dot(p, u) for p in pts]
    ys = [_dot(p, v) for p in pts]
    best = None
    for k in range(SPINS):
        a = math.pi / 2 * k / (SPINS - 1)
        c, s = math.cos(a), math.sin(a)
        X = [c * x - s * y for x, y in zip(xs, ys)]
        Y = [s * x + c * y for x, y in zip(xs, ys)]
        w, h = max(X) - min(X), max(Y) - min(Y)
        fits = (w <= bed[0] and h <= bed[1]) or (w <= bed[1] and h <= bed[0])
        key = (not fits, max(w, h))
        if best is None or key < best[0]:
            best = (key, w, h, math.degrees(a))
    (nofit, _), w, h, spin = best
    H = max(zs)
    return {'height': H, 'w': w, 'h': h, 'spin_deg': spin, 'fits': (not nofit) and H <= bed[2], 'size': max(H, w, h)}


def fit_piece(st, rings, i0, i1, grow_start, grow_end, L, r, bed, plain_start=False, plain_end=False):
    """The best way to stand the piece between stations i0 and i1, or None. It stands on an end that carries no outer
    tongue: the start unless it grows one, the end likewise."""
    pts = _piece_points(st, rings, i0, i1, grow_start, grow_end, L, r)
    best = None
    for end, flag in (('start', grow_start), ('end', grow_end)):
        if flag:
            continue
        i = i0 if end == 'start' else i1
        axis = st[i]['t'] if end == 'start' else tuple(-x for x in st[i]['t'])
        o = _stand(pts, st[i]['p'], axis, bed)
        if o and o['fits'] and (best is None or o['size'] < best['size']):
            best = dict(o, base=end)
    return best


def candidates(st, L, keepouts, margin=5.0, step=STEP):
    """Station indices where a cut may go: in a straight run with the whole lap (L either side, so either piece can
    grow) and a margin inside it, clear of every keep-out interval (s0, s1) widened by L."""
    runs = {}
    for i, q in enumerate(st):
        if q['run'] is not None:
            runs.setdefault(q['run'], []).append(i)
    out = []
    for idx in runs.values():
        s0, s1 = st[idx[0]]['s'], st[idx[-1]]['s']
        last = -1e9
        for i in idx:
            s = st[i]['s']
            if s - s0 < L + margin or s1 - s < L + margin or s - last < step:
                continue
            if any(a - L - margin <= s <= b + L + margin for a, b in keepouts):
                continue
            out.append(i)
            last = s
    return sorted(out)


def plan(st, r_out, keepouts=(), bed=(256.0, 256.0, 256.0), L=20.0, edge=3.0, step=STEP, r_in=None, clearance=0.15):
    """The cuts and which side of each grows the outer tongue. Returns {'ok', 'cuts': [{i, s, p, t, grower:'up'|'down'}],
    'pieces': [{i0, i1, s0, s1, base, height, w, h, spin_deg, grow_start, grow_end}], 'notes'}. 'up' means the upstream
    piece (lower s) carries the outer tongue across the cut. bed is usable size (x, y, z) less an edge allowance."""
    usable = tuple(b - 2 * edge for b in bed[:2]) + (bed[2] - edge,)
    if len(st) < 2:
        return {'ok': False, 'cuts': [], 'pieces': [], 'notes': ['The tube centreline has fewer than two points.']}
    if min(usable[:2]) <= 2 * r_out:
        return {'ok': False, 'cuts': [], 'pieces': [], 'notes': [
            'The tube (%s outside) is wider than the bed (%s usable): no split can make it fit.' % (mm_in(2 * r_out), mm_in(min(usable[:2])))]}
    rr = r_out + 0.5
    rings = _rings(st, rr)
    N = len(st) - 1
    whole = fit_piece(st, rings, 0, N, False, False, L, rr, usable)
    if whole:
        return {'ok': True, 'cuts': [], 'pieces': [dict(whole, i0=0, i1=N, s0=0.0, s1=st[N]['s'], grow_start=False, grow_end=False)],
                'notes': ['It fits the bed in one piece.']}
    jc = None
    if r_in is not None:
        jc = check_joint(r_in, r_out, clearance)
        if not jc['ok']:
            return {'ok': False, 'cuts': [], 'pieces': [], 'notes': jc['notes']}
    cands = candidates(st, L, keepouts, step=step)
    if not cands:
        return {'ok': False, 'cuts': [], 'pieces': [], 'notes': [why_no_cuts(st, L, keepouts)]}
    nodes = [(0, 'plain')] + [(c, r) for c in cands for r in ('up', 'down')] + [(N, 'plain')]
    reach = math.sqrt(sum(x * x for x in usable))
    best = {nodes[0]: (0, 0.0, None, None)}
    cache = {}
    for k, node in enumerate(nodes[1:], 1):
        ci, role = node
        for prev in nodes[:k]:
            pi, prole = prev
            if prev not in best or pi >= ci:
                continue
            gs, ge = prole == 'down', role == 'up'
            if math.dist(st[ci]['p'], st[pi]['p']) + L * (gs + ge) > reach:   # the chord: a bent piece can be longer than the bed's diagonal and still fit
                continue
            if st[ci]['s'] - st[pi]['s'] < 2 * L + 10:
                continue
            key = (pi, ci, gs, ge)
            if key not in cache:
                cache[key] = fit_piece(st, rings, pi, ci, gs, ge, L, rr, usable)
            f = cache[key]
            if not f:
                continue
            n0, m0, _, _ = best[prev]
            cand = (n0 + 1, max(m0, f['size']), prev, f)
            if node not in best or cand[:2] < best[node][:2]:
                best[node] = cand
    end = (N, 'plain')
    if end not in best:
        return {'ok': False, 'cuts': [], 'pieces': [], 'notes': [
            'No way to cut it so every piece fits the bed standing up: the tube may be too big for the printer, or a bend '
            'too wide, or the straights too short or covered by lettering for a %.0f mm lap.' % L]}
    chain, node = [], end
    while best[node][2] is not None:
        n, m, prev, f = best[node]
        chain.append((prev, node, f))
        node = prev
    chain.reverse()
    cuts = [{'i': b[0], 's': st[b[0]]['s'], 'p': st[b[0]]['p'], 't': st[b[0]]['t'], 'grower': b[1]} for a, b, f in chain[:-1]]
    pieces = [dict(f, i0=a[0], i1=b[0], s0=st[a[0]]['s'], s1=st[b[0]]['s'], grow_start=a[1] == 'down', grow_end=b[1] == 'up')
              for a, b, f in chain]
    return {'ok': True, 'cuts': cuts, 'pieces': pieces, 'notes': list(jc['notes']) if jc else []}


def joint_radii(r_in, r_out, clearance=0.15):
    """Radii (mm) of the lap: inner tongue r_in..a, outer tongue b..r_out, and the 45 degree chamfer sizes."""
    mid = 0.5 * (r_in + r_out)
    a, b = mid - clearance / 2.0, mid + clearance / 2.0
    sh = max(0.0, min(1.5, (r_out - b) - 0.6))     # leaves the outer tongue's tip at least 0.5 mm after its own chamfer
    return {'tongue_in': a, 'tongue_out': b, 'shoulder': sh, 'tip': sh + 0.1, 'inner_t': a - r_in, 'outer_t': r_out - b}


def filament(volume_cm3, density=1.2, dia_mm=1.75):
    """Mass (g) and length (m) of filament for a solid part of this volume."""
    area = math.pi * dia_mm * dia_mm / 4.0
    return {'mass_g': volume_cm3 * density, 'length_m': volume_cm3 * 1000.0 / area / 1000.0}


# ---------------------------------------------------------------------------------------------------------------------
# Pieces cadtools.act_print_split hands over from Fusion, kept here so they are tested without it (mm throughout)
# ---------------------------------------------------------------------------------------------------------------------

MIN_TONGUE = 0.8     # mm: two perimeters of a 0.4 mm nozzle; a thinner tongue is not a solid printed wall
WARN_TONGUE = 1.2    # mm: three perimeters; between the two it prints, but only just


def mm_in(mm, dp=1):
    """'48.6 mm (1.913 in)': every length the owner reads is in both units."""
    return '%.*f mm (%.3f in)' % (dp, mm, mm / 25.4)


def why_no_cuts(st, L, keepouts, margin=5.0):
    """Why there is nowhere to cut: no straight, straights too short for the lap, or every straight covered."""
    runs = {}
    for q in st:
        if q['run'] is not None:
            runs.setdefault(q['run'], []).append(q['s'])
    need = 2 * (L + margin)
    if not runs:
        return ('The tube has no straight part to cut in (it is all bend): a cut needs %s of straight for the %s lap. '
                'Print it in one piece on a bigger bed, or add a short straight to the design.' % (mm_in(need, 0), mm_in(L, 0)))
    longest = max(v[-1] - v[0] for v in runs.values())
    if longest < need:
        return ('No straight is long enough for a cut: the longest is %s, and a %s lap needs %s (the lap both sides of the '
                'cut plus %s margins). Shorten the lap or lengthen a straight.' % (mm_in(longest, 0), mm_in(L, 0), mm_in(need, 0), mm_in(margin, 0)))
    return ('Every straight long enough for a %s lap is covered by raised or recessed detail (lettering, bosses, lips) '
            '%s: move the detail or leave a plain stretch of %s.' % (mm_in(L, 0), ', '.join('%.0f-%.0f mm' % (a, b) for a, b in keepouts),
                                                                     mm_in(need, 0)))


def check_joint(r_in, r_out, clearance=0.15):
    """Whether the wall is thick enough for the lap. Refuses when either tongue is under MIN_TONGUE (or the gap eats the
    wall), warns under WARN_TONGUE. {'ok', 'notes', 'radii'}."""
    if r_out <= r_in:
        return {'ok': False, 'notes': ['The bore (%s) is not smaller than the outside (%s).' % (mm_in(2 * r_in), mm_in(2 * r_out))], 'radii': None}
    j = joint_radii(r_in, r_out, clearance)
    thin = min(j['inner_t'], j['outer_t'])
    wall = r_out - r_in
    if thin < MIN_TONGUE:
        need = 2 * MIN_TONGUE + clearance
        return {'ok': False, 'radii': j, 'notes': [
            'The wall (%s) is too thin for a flush lap joint: each tongue would be %s, under the %s that prints as a solid '
            'wall (two 0.4 mm perimeters). It needs a wall of at least %s at this %s gap.' % (
                mm_in(wall, 2), mm_in(thin, 2), mm_in(MIN_TONGUE, 1), mm_in(need, 2), mm_in(clearance, 2))]}
    notes = []
    if thin < WARN_TONGUE:
        notes.append('The tongues are only %s thick (under %s): print them with at least 3 perimeters and 100%% infill '
                     'over the lap, or thicken the wall.' % (mm_in(thin, 2), mm_in(WARN_TONGUE, 1)))
    if j['shoulder'] <= 0:
        notes.append('The wall is too thin for the 45 degree shoulder chamfer: the step at the end of each lap is a flat ledge.')
    return {'ok': True, 'notes': notes, 'radii': j}


def chain_order(ends, tol=1e-3):
    """Curves end to end from one free end to the other. ends[k] = (start point, end point) of curve k. Returns
    [(k, flipped)] where flipped means the curve runs end -> start along the chain. ValueError if they are not one chain."""
    def near(p, q):
        return math.dist(p, q) < tol
    pts = [e[0] for e in ends] + [e[1] for e in ends]
    start = None
    for k, (a, b) in enumerate(ends):
        for side, p in ((0, a), (1, b)):
            if sum(1 for q in pts if near(q, p)) == 1:
                start = (k, side)
                break
        if start:
            break
    if not start:
        start = (0, 0)            # a closed loop: start anywhere
    chain, used = [], set()
    k, side = start
    while k is not None:
        flip = side == 1
        chain.append((k, flip))
        used.add(k)
        pos = ends[k][0] if flip else ends[k][1]
        nxt = None
        for o, (a, b) in enumerate(ends):
            if o in used:
                continue
            if near(a, pos):
                nxt = (o, 0)
                break
            if near(b, pos):
                nxt = (o, 1)
                break
        k, side = nxt if nxt else (None, None)
    if len(chain) != len(ends):
        raise ValueError('The path curves are not one connected chain: select them end to end.')
    return chain


def pick_wall_radii(radii, solid_at, probe=0.2):
    """Bore and outside radius (mm) from the coaxial cylinder radii found round a straight. Embossed lettering adds
    coaxial cylinders just outside the tube (and debossed ones just inside its outside), so the extremes are not the
    wall: the bore is the smallest radius with solid just outside it and hollow just inside, the outside the next one
    with solid just inside and hollow just outside. solid_at(r) says whether radius r (mm) is in the wall at that
    station (cadtools votes over several angles). Returns (r_in, r_out) or None."""
    rs = sorted(set(round(r, 4) for r in radii))
    r_in = next((r for r in rs if solid_at(r + probe) and not solid_at(r - probe)), None)
    if r_in is None:
        return None
    r_out = next((r for r in rs if r > r_in and solid_at(r - probe) and not solid_at(r + probe)), None)
    return (r_in, r_out) if r_out is not None else None


def scan_wall_radii(solid_at, step=0.1, r_max=160.0):
    """Bore and outside radius (mm) by stepping out from the centreline (when the faces give no cylinders)."""
    inside, r_in = False, None
    for k in range(1, int(r_max / step)):
        r = step * k
        ins = solid_at(r)
        if ins and not inside:
            r_in = r - step / 2.0
        if inside and not ins:
            return r_in, r - step / 2.0
        inside = ins
    return None


def merge_intervals(iv, join=1.0):
    out = []
    for a, b in sorted(iv):
        if out and a <= out[-1][1] + join:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def keepouts_from_samples(faces, st, r_in, r_out, tol=0.3):
    """Stretches (s0, s1 in mm along the tube) of anything but plain wall. faces is a list (one per B-Rep face) of the
    points (mm) sampled on that face; a point is plain wall when its distance from the centreline is the bore or the
    outside radius within tol. A face whose every sample is plain gives nothing."""
    out = []
    for pts in faces:
        ss = []
        for p in pts:
            i = min(range(len(st)), key=lambda k: math.dist(p, st[k]['p']))
            d = _sub(p, st[i]['p'])
            ax = _dot(d, st[i]['t'])
            rad = math.sqrt(max(0.0, _dot(d, d) - ax * ax))
            if not (abs(rad - r_in) < tol or abs(rad - r_out) < tol):
                ss.append(st[i]['s'] + ax)
        if ss:
            out.append((min(ss), max(ss)))
    return merge_intervals(out)


def joint_roles(cuts):
    """For each cut n (0-based) between piece n and piece n+1: the grower's and the receiver's piece index, and sg, the
    side of the cut plane the grower lies on along the path tangent (-1 upstream, +1 downstream). The receiver gets the
    recess, the grower the outer tongue, which runs from the plane into the receiver's side (-sg)."""
    out = []
    for n, c in enumerate(cuts):
        up = c['grower'] == 'up'
        out.append({'grower': n if up else n + 1, 'receiver': n + 1 if up else n, 'sg': -1.0 if up else 1.0})
    return out


def toward_receiver(sketch_normal, t, sg):
    """+1 when the receiver side (-sg along t) is the sketch's positive extrude direction, else -1."""
    return 1 if _dot(sketch_normal, t) * (-sg) > 0 else -1


def stand_frame(axis):
    """The print frame for a piece standing with `axis` up: (u, v, axis), right-handed, so an STL is never mirrored."""
    a = _unit(axis)
    u, v = _perp(a)
    return u, v, a


def stand_points(pts, base, axis, spin_deg):
    """Points (mm) in the print frame: standing on `base` with `axis` up, spun spin_deg about it (the planner's
    footprint spin), dropped so the lowest point is on the bed (z = 0)."""
    u, v, a = stand_frame(axis)
    c, s = math.cos(math.radians(spin_deg)), math.sin(math.radians(spin_deg))
    out = []
    for p in pts:
        d = _sub(p, base)
        x, y, z = _dot(d, u), _dot(d, v), _dot(d, a)
        out.append((c * x - s * y, s * x + c * y, z))
    z0 = min(q[2] for q in out) if out else 0.0
    return [(q[0], q[1], q[2] - z0) for q in out]


def assembly_sheet(pl, r_in, r_out, clearance=0.15, L=20.0, piece_names=None):
    """The gluing check list: pieces in order, which end is which, and for each joint the bonded area (both tongue
    faces, cm2 and in2) and the bond-line volume (mL), so the owner mixes enough epoxy. The bond is the radial gap over
    the lap; the butt faces at the bore and at the shoulder add the ring areas. Pure: from the plan."""
    j = joint_radii(r_in, r_out, clearance)
    names = piece_names or ['Piece %d' % (k + 1) for k in range(len(pl['pieces']))]
    lap_area = 2 * math.pi * (j['tongue_in'] + j['tongue_out']) * L                  # both cylinder faces, mm2
    butt = math.pi * (j['tongue_in'] ** 2 - r_in ** 2) + math.pi * (r_out ** 2 - j['tongue_out'] ** 2)   # end rings, mm2
    gap_vol = math.pi * (j['tongue_out'] ** 2 - j['tongue_in'] ** 2) * L             # mm3 = uL
    rows, steps = [], []
    for k, pc in enumerate(pl['pieces']):
        ends = []
        for end, grows, s in (('start', pc['grow_start'], pc['s0']), ('end', pc['grow_end'], pc['s1'])):
            first, last = k == 0 and end == 'start', k == len(pl['pieces']) - 1 and end == 'end'
            kind = 'plain end (the tube\'s %s)' % ('start' if first else 'end') if (first or last) else ('outer tongue' if grows else 'inner tongue (recess)')
            ends.append('%s end at %.0f mm: %s%s' % (end, s, kind, ', prints on the bed' if pc.get('base') == end else ''))
        rows.append({'name': names[k], 'length_mm': round(pc['s1'] - pc['s0'], 1), 'ends': ends})
    roles = joint_roles(pl['cuts'])
    for n, c in enumerate(pl['cuts']):
        rl = roles[n]
        area_cm2 = (lap_area + butt) / 100.0
        steps.append({'joint': n + 1, 's_mm': round(c['s'], 1),
                      'grower': names[rl['grower']], 'receiver': names[rl['receiver']],
                      'area_cm2': round(area_cm2, 1), 'area_in2': round(area_cm2 / 6.4516, 2),
                      'bond_ml': round(gap_vol / 1000.0, 2),
                      'text': 'Joint %d at %.0f mm (%.2f in): slide %s\'s outer tongue over %s\'s inner tongue; bond %.1f cm2 '
                              '(%.2f in2), gap %.2f mL of epoxy (mix about %.1f mL to allow for squeeze-out).' % (
                                  n + 1, c['s'], c['s'] / 25.4, names[rl['grower']], names[rl['receiver']], area_cm2,
                                  area_cm2 / 6.4516, gap_vol / 1000.0, max(1.0, 3 * gap_vol / 1000.0))})
    tot = sum(x['bond_ml'] for x in steps)
    return {'pieces': rows, 'joints': steps, 'total_bond_ml': round(tot, 2),
            'notes': ['Dry-fit every joint first, glue them in order from piece 1, and keep the bore aligned: the joint '
                      'is flush inside and out, so a twisted piece shows as a step.'] if steps else []}
