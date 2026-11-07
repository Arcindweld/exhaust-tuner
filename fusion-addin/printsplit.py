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
        st.append({'p': tuple(p), 't': _unit(_sub(b, a)), 's': s, 'run': run if run == prev else None})
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


def plan(st, r_out, keepouts=(), bed=(256.0, 256.0, 256.0), L=20.0, edge=3.0, step=STEP):
    """The cuts and which side of each grows the outer tongue. Returns {'ok', 'cuts': [{i, s, p, t, grower:'up'|'down'}],
    'pieces': [{i0, i1, s0, s1, base, height, w, h, spin_deg, grow_start, grow_end}], 'notes'}. 'up' means the upstream
    piece (lower s) carries the outer tongue across the cut. bed is usable size (x, y, z) less an edge allowance."""
    usable = tuple(b - 2 * edge for b in bed[:2]) + (bed[2] - edge,)
    rr = r_out + 0.5
    rings = _rings(st, rr)
    N = len(st) - 1
    whole = fit_piece(st, rings, 0, N, False, False, L, rr, usable)
    if whole:
        return {'ok': True, 'cuts': [], 'pieces': [dict(whole, i0=0, i1=N, s0=0.0, s1=st[N]['s'], grow_start=False, grow_end=False)],
                'notes': ['It fits the bed in one piece.']}
    cands = candidates(st, L, keepouts, step=step)
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
            if st[ci]['s'] - st[pi]['s'] + L * (gs + ge) > reach:
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
    return {'ok': True, 'cuts': cuts, 'pieces': pieces, 'notes': []}


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
