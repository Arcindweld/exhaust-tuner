"""Tack jig for routed tubes: printable cradle blocks that hold every piece of every tube, so the cut pieces (straights
and bend pieces cut from stock mandrel bends) and the brackets can be tacked in one setup.

The planning here is plain Python (no Fusion), so it is tested on its own (tests/test_jig.py); cadtools.act_jig builds
the blocks. Units are Fusion's: cm.

Each cradle is an upright block standing on a common base level under all the tubes, its long side along the tube as
seen from above, cut by the tube itself (a chain of short cylinders a little bigger than the tube, following the
centreline, arcs included) so the tube lies in an open-top saddle. The block's top is the lowest point of the
centreline over the block's length, so the saddle never wraps past half the tube and the piece drops in from above.
A foot with two bolt holes (M6 clearance) screws it to the table or a base plate. Any other tube passing through the
block cuts it too.

Where: the middle of every element (each straight and each bend piece) long enough to hold, and more along long
straights (spacing), none closer than 1.5 block lengths to the last; none where the tube runs steeper than 60 degrees
from level (a flat cradle cannot hold it). Where another tube (or another part of the same one) runs under the saddle,
which would cut the block in two, the cradle slides along its tube up to three block lengths; failing that it
is left out. Places left out are listed.
"""
import math

try:
    from . import router as RT
except ImportError:            # tests import it as a plain module
    import router as RT


DEFAULTS = {'spacing': 15.0, 'block_len': 2.0, 'side': 0.8, 'clearance': 0.025, 'min_below': 1.0, 'end_margin': 2.5,
            'foot_t': 0.6, 'foot_ext': 2.4, 'hole_d': 0.66, 'max_height': 24.0, 'max_tilt_deg': 60.0, 'chord': 0.4,
            'weld_gap': 0.0}


def _v(a, b, k=1.0):
    return (a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(a):
    n = math.sqrt(_dot(a, a))
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 0.0)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def segs_to_elems(segs):
    """Measured sketch segments (cadtools._curve_seg: kind, p0, p1, t0, length, radius) to router elements."""
    out = []
    for s in segs:
        if s['kind'] == 'arc' and s.get('radius'):
            R, p0, p1, t0 = s['radius'], s['p0'], s['p1'], _unit(s['t0'])
            chord = _v(p1, p0, -1.0)
            perp = _unit(_v(chord, t0, -_dot(chord, t0)))       # toward the centre, in the bend plane
            cen = _v(p0, perp, R)
            u0, u1 = _unit(_v(p0, cen, -1.0)), _unit(_v(p1, cen, -1.0))
            a = s['length'] / R
            out.append(('arc', p0, p1, cen, a, s['length'], u0, u1))
        else:
            out.append(('line', s['p0'], s['p1'], s['length']))
    return out


class _Tube(object):
    def __init__(self, name, elems, od):
        self.name, self.elems, self.od = name, list(elems), od
        self.lens = [RT.elem_len(e) for e in self.elems]
        self.total = sum(self.lens)

    def at(self, s):
        """Point and tangent at arc length s (clamped to the tube)."""
        s = min(max(s, 0.0), self.total)
        for e, L in zip(self.elems, self.lens):
            if s <= L or e is self.elems[-1]:
                f = s / L if L > 0 else 0.0
                return RT.elem_point(e, min(f, 1.0)), RT.elem_tangent(e, min(f, 1.0))
            s -= L
        e = self.elems[-1]
        return RT.elem_point(e, 1.0), RT.elem_tangent(e, 1.0)

    def points(self, s0, s1, chord):
        s0, s1 = max(0.0, s0), min(self.total, s1)
        n = max(1, int(math.ceil((s1 - s0) / chord)))
        return [self.at(s0 + (s1 - s0) * k / n)[0] for k in range(n + 1)]


def _stations(t, o):
    """Arc lengths along a tube where cradles go."""
    lo, hi, Lb = o['end_margin'], t.total - o['end_margin'], o['block_len']
    want = []
    s = 0.0
    for e, L in zip(t.elems, t.lens):
        if L >= Lb:
            n = max(1, int(math.ceil(L / o['spacing'] - 1e-9))) if e[0] == 'line' else 1
            for k in range(n):
                want.append(s + L * (k + 0.5) / n)
        s += L
    want.sort()
    # keep each block off the weld joints between pieces (weld_gap: the torch's room either side of a joint)
    g = o.get('weld_gap', 0.0)
    if g > 0:
        js, acc = [], 0.0
        for L in t.lens[:-1]:
            acc += L
            js.append(acc)
        moved = []
        for x in want:
            for j in js:
                if abs(x - j) < Lb / 2.0 + g / 2.0:
                    x = j + (1.0 if x >= j else -1.0) * (Lb / 2.0 + g / 2.0 + 1e-3)
            moved.append(x)
        want = sorted(moved)
    out = []
    for x in want:
        x = min(max(x, lo), hi)
        if not out or x - out[-1] >= 1.5 * Lb:
            out.append(x)
    return out


def _cradle(t, s, o, up, base, chains):
    """One cradle at arc length s, or None where the tube runs too steeply for a flat cradle."""
    p, tan = t.at(s)
    if math.asin(min(1.0, abs(_dot(tan, up)))) > math.radians(o['max_tilt_deg']):
        return None
    d = _unit(_v(tan, up, -_dot(tan, up)))
    w = _unit(_cross(up, d))
    half = o['block_len'] / 2.0
    top = min(_dot(q, up) for q in t.points(s - half, s + half, o['block_len'] / 8.0))
    H = top - base
    W = t.od + 2.0 * o['side']
    hp = _v(p, up, -_dot(p, up))                    # p dropped onto the plane through the origin
    centre = _v(hp, up, base + H / 2.0)
    r = t.od / 2.0 + o['clearance']
    reach = math.sqrt(half ** 2 + (W / 2.0) ** 2 + (H / 2.0) ** 2)
    cut = []
    for tt, segs in chains:
        rr = tt.od / 2.0 + o['clearance']
        for a, b in segs:
            m = _v(a, b)
            m = (m[0] / 2.0, m[1] / 2.0, m[2] / 2.0)
            dd = _v(m, centre, -1.0)
            if math.sqrt(_dot(dd, dd)) < reach + rr + o['chord']:
                cut.append((a, b, rr))
    fw = W + 2.0 * o['foot_ext']
    foot_c = _v(hp, up, base + o['foot_t'] / 2.0)
    holes = [_v(foot_c, w, k * (W / 2.0 + o['foot_ext'] / 2.0)) for k in (-1.0, 1.0)]
    return {'tube': t.name, 's': s, 'centre': centre, 'd': d, 'w': w, 'up': up, 'length': o['block_len'],
            'width': W, 'height': H, 'top': top, 'r': r, 'cut': cut,
            'foot': {'centre': foot_c, 'width': fw, 'thick': o['foot_t'], 'holes': holes, 'hole_d': o['hole_d']}}


def plan(tubes, up=(0.0, 0.0, 1.0), opts=None):
    """tubes: [{'name', 'elems', 'od'}] in cm. Returns {'base', 'cradles': [...], 'skipped': [...], 'notes': [...]}."""
    o = dict(DEFAULTS)
    o.update({k: v for k, v in (opts or {}).items() if v is not None})
    up = _unit(up)
    T = [_Tube(t['name'], t['elems'], t['od']) for t in tubes if t.get('elems')]
    if not T:
        raise ValueError('No tubes to build a jig for.')
    # the base level: under the lowest tube surface by min_below
    low = min(min(_dot(p, up) for p in t.points(0.0, t.total, 1.0)) - t.od / 2.0 for t in T)
    base = low - o['min_below']
    # every tube as short cylinders, for cutting the saddles (each block takes the ones that pass through it)
    chains = []
    for t in T:
        pts = t.points(0.0, t.total, o['chord'])
        chains.append((t, [(a, b) for a, b in zip(pts, pts[1:])]))
    cradles, skipped, notes = [], [], []
    def blocked(t, s, c):
        """Another tube (or another part of this one) passing under the saddle, between the held tube and the foot,
        would cut the block apart; one beside it only notches a side wall (the cradle then holds both)."""
        half, rh, H = o['block_len'] / 2.0, t.od / 2.0 + o['clearance'], c['height']
        for tt, segs in chains:
            rr = tt.od / 2.0 + o['clearance']
            n = len(segs)
            for k, (a, b) in enumerate(segs):
                if tt is t and abs(tt.total * (k + 0.5) / n - s) < half + tt.od + o['chord']:
                    continue                                 # the tube this cradle holds
                for q in (a, _v(a, _v(b, a, -1.0), 0.5), b):
                    r = _v(q, c['centre'], -1.0)
                    x, y, z = abs(_dot(r, c['d'])), abs(_dot(r, c['w'])), _dot(r, up)
                    if x < half + rr and y < t.od / 2.0 + rr and -H / 2.0 + o['foot_t'] - rr < z < H / 2.0 - rh + rr:
                        return tt.name
        return None

    for t in T:
        for s0 in _stations(t, o):
            # where another tube runs through the block, slide the cradle along this tube (up to three block lengths)
            # where another tube runs through the block, slide the cradle along this tube (up to three block lengths);
            # a slid position that is too steep is passed over, not taken as the answer (seen live: a cradle slid off a
            # 16 deg run onto a 68 deg one was reported as too steep at 16 deg)
            c, was_blocked = None, False
            for shift in (0.0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0):
                s = min(max(s0 + shift * o['block_len'], o['end_margin']), t.total - o['end_margin'])
                cc = _cradle(t, s, o, up, base, chains)
                if cc is None:
                    if shift == 0.0:
                        break                                # steep where it belongs: no cradle here
                    continue
                if blocked(t, s, cc):
                    was_blocked = True
                    continue
                c = cc
                break
            if c is None:
                if was_blocked:
                    skipped.append({'tube': t.name, 's': s0, 'why': 'another tube runs under it here'})
                else:
                    tan = t.at(s0)[1]
                    skipped.append({'tube': t.name, 's': s0, 'why': 'runs %.0f deg from level here' % math.degrees(math.asin(min(1.0, abs(_dot(tan, up)))))})
                continue
            if cradles and cradles[-1]['tube'] == t.name and abs(cradles[-1]['s'] - c['s']) < 1.5 * o['block_len']:
                continue                                     # slid onto the one before
            cradles.append(c)
    tall = [c for c in cradles if c['height'] > o['max_height']]
    if tall:
        notes.append('%d cradle%s stand%s taller than %.0f cm (%.0f cm at most): print %s lying down, or raise the base '
                     'on a block.' % (len(tall), '' if len(tall) == 1 else 's', 's' if len(tall) == 1 else '',
                                      o['max_height'], max(c['height'] for c in tall), 'it' if len(tall) == 1 else 'them'))
    if skipped:
        notes.append('No cradle at %s: hold those pieces by the ones next to them, or clamp them.' % '; '.join(
            '%s %.0f mm along (%s)' % (k['tube'], 10 * k['s'], k['why']) for k in skipped))
    return {'base': base, 'cradles': cradles, 'skipped': skipped, 'notes': notes, 'opts': o}


def summary(p):
    """Plain numbers for the page."""
    cs = p['cradles']
    per = {}
    for c in cs:
        per[c['tube']] = per.get(c['tube'], 0) + 1
    return {'count': len(cs), 'per_tube': per, 'tallest': max([c['height'] for c in cs] or [0.0]),
            'base': p['base'], 'notes': p['notes']}


# ================================================================================================ fabrication jigs
# plan_fab: the jig generator behind the page's "Fabrication jig" options. Styles (the owner's reference photos):
#   'cradles'  separate cradles (plan() above), feet sized to stand on their own or tabbed to a fixture table;
#   'base'     the same cradles tied together by ribs at base level (a minimum spanning tree over their feet), one frame;
#   'saddle'   a continuous saddle block along each tube where it runs level enough, broken at the weld joints between
#              the cut pieces (torch access) and split to fit the print bed.
# Options for every style: flange locators at the tube ends (a plate square to the tube with its bore and the flange's
# bolt holes on its PCD, on two legs), and the mount: 'free' (wide feet, optional M6 holes) or 'table' (bolt holes on
# the fixture table's grid, System 16 = 50 mm pitch / 16 mm holes, System 28 = 100 mm / 28 mm, or any pitch, with
# tabs out to the nearest grid holes where a part has too few under it). Every part is returned as primitives to add
# and to cut, all in world cm, so the add-in builds them with one routine; plain Python, tested in tests/test_jig.py.

FAB_DEFAULTS = {'style': 'cradles', 'mount': 'free', 'layout': 'model', 'beam_h': 3.0, 'free_end': 16.0, 'grid_pitch': 5.0, 'grid_hole': 1.65, 'grid_origin': (0.0, 0.0),
                'grid_angle_deg': 0.0, 'free_holes': True, 'weld_gap': 2.0, 'bed': 25.6, 'saddle_step': 1.5,
                'rib_w': 3.0, 'flange_ends': 'none', 'flange_size': 0.0, 'flange_thick': 1.0, 'flange_n': 0,
                'flange_pcd': 0.0, 'flange_hole': 0.0, 'flange_angle_deg': 0.0, 'tab_rim': 1.0, 'min_holes': 2,
                'leg': 2.0}


def _frame(up):
    """Base-plane axes: u along world X projected (or Z when up is X), v = up x u."""
    ref = (1.0, 0.0, 0.0) if abs(up[0]) < 0.9 else (0.0, 0.0, 1.0)
    u = _unit(_v(ref, up, -_dot(ref, up)))
    return u, _unit(_cross(up, u))


def _box(c, d, w, L, W, H):
    return {'k': 'box', 'c': tuple(c), 'd': tuple(d), 'w': tuple(w), 'L': L, 'W': W, 'H': H}


def _rect(c2, d2, L, W, flat=True):
    """A footprint rectangle in the base plane (2-D centre, unit direction, length along it, width across)."""
    return {'c': c2, 'd': d2, 'L': L, 'W': W, 'flat': flat}


def _in_rect(r, p, m):
    dx, dy = p[0] - r['c'][0], p[1] - r['c'][1]
    a = dx * r['d'][0] + dy * r['d'][1]
    b = -dx * r['d'][1] + dy * r['d'][0]
    return abs(a) <= r['L'] / 2.0 - m and abs(b) <= r['W'] / 2.0 - m


def _tube_cuts(chains, centre, reach, o):
    out = []
    for tt, segs in chains:
        rr = tt.od / 2.0 + o['clearance']
        for a, b in segs:
            m = ((a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0, (a[2] + b[2]) / 2.0)
            dd = _v(m, centre, -1.0)
            if math.sqrt(_dot(dd, dd)) < reach + rr + o['chord']:
                out.append((a, b, rr))
    return out


def _cuts_prims(cuts):
    """Tube cuts as short cylinders with a ball at each joint (soft: the builder may retry them a hair larger)."""
    prims, seen = [], set()
    for a, b, r in cuts:
        prims.append({'k': 'cyl', 'a': a, 'b': b, 'r': r, 'soft': True})
        for q in (a, b):
            key = tuple(round(x, 5) for x in q) + (round(r, 5),)
            if key not in seen:
                seen.add(key)
                prims.append({'k': 'sph', 'p': q, 'r': r, 'soft': True})
    return prims


def _joints(t):
    out, s = [], 0.0
    for L in t.lens[:-1]:
        s += L
        out.append(s)
    return out


def plan_fab(tubes, up=(0.0, 0.0, 1.0), opts=None):
    """tubes [{'name','elems','od'}] cm -> {'base','parts':[{'name','add','cut','foot','holes','kind'}],'notes','skipped'}."""
    o = dict(DEFAULTS)
    o.update(FAB_DEFAULTS)
    o.update({k: v for k, v in (opts or {}).items() if v is not None})
    up = _unit(up)
    T = [_Tube(t['name'], t['elems'], t['od']) for t in tubes if t.get('elems')]
    if not T:
        raise ValueError('No tubes to build a jig for.')
    if o['layout'] == 'flat':
        up = lay_flat_up(T, up)
    elif o['layout'] != 'model':
        raise ValueError('Unknown layout %r.' % o['layout'])
    u, vv = _frame(up)
    to2 = lambda p: (_dot(p, u), _dot(p, vv))
    style, mount = o['style'], o['mount']
    if style == 'frame':
        o['flange_ends'] = 'both'
    if style not in ('cradles', 'base', 'plate', 'saddle', 'frame'):
        raise ValueError('Unknown jig style %r.' % style)
    if mount not in ('free', 'table'):
        raise ValueError('Unknown mount %r.' % mount)
    chains = []
    for t in T:
        pts = t.points(0.0, t.total, o['chord'])
        chains.append((t, [(a, b) for a, b in zip(pts, pts[1:])]))
    low = min(min(_dot(p, up) for p in t.points(0.0, t.total, 1.0)) - t.od / 2.0 for t in T)
    base = low - o['min_below']
    fe = o['flange_ends']

    def flange_frame(t, end):
        p0, tan = t.at(0.0 if end == 'start' else t.total)
        tin = tan if end == 'start' else _v((0.0, 0.0, 0.0), tan, -1.0)
        a1 = _v(up, tin, -_dot(up, tin))
        a1 = _unit(a1) if math.sqrt(_dot(a1, a1)) > 0.2 else _unit(_cross(tin, u if abs(_dot(u, tin)) < 0.9 else vv))
        a2 = _unit(_cross(tin, a1))
        sz = o['flange_size'] if o['flange_size'] > 0 else t.od + 6.0
        pc = _v(p0, tin, -o['flange_thick'] / 2.0)
        corners = [_v(_v(pc, a1, i * sz / 2.0), a2, j * sz / 2.0) for i in (-1.0, 1.0) for j in (-1.0, 1.0)]
        return p0, tin, a1, a2, sz, pc, corners
    ends = [(t, e) for t in T for e in (('start', 'end') if fe == 'both' else ('start',) if fe == 'start' else ())]
    if fe == 'both' and len(T) > 1:
        # only free ends: a start with no other tube's end near it (a Y merge or a step in between), an end with no other
        # tube's start near it; a header's primaries end in their Y merges, its secondaries start out of them
        def near(p, which):
            return any(math.sqrt(_dot(*(2 * [_v(p, x.at(0.0 if which == 'start' else x.total)[0], -1.0)]))) < o['free_end']
                       for x in T if x.at(0.0 if which == 'start' else x.total)[0] is not p)
        ends = [(t, e) for t, e in ends if not near(t.at(0.0 if e == 'start' else t.total)[0], 'end' if e == 'start' else 'start')]
    if ends:
        # a flange plate is wider than its tube and can reach below it: the base goes under the plates too
        plow = min(min(_dot(q, up) for q in flange_frame(t, e)[6]) for t, e in ends) - o['leg'] / 2.0
        if plow < base:
            o['min_below'] += base - plow
            base = plow
    ft = o['foot_t']
    def lift(p2, z):
        return (u[0] * p2[0] + vv[0] * p2[1] + up[0] * z, u[1] * p2[0] + vv[1] * p2[1] + up[1] * z,
                u[2] * p2[0] + vv[2] * p2[1] + up[2] * z)
    parts, notes, skipped = [], [], []

    # ---- cradles (and the base frame built on them)
    if style in ('cradles', 'base', 'plate'):
        p = plan(tubes, up, {k: o[k] for k in DEFAULTS})
        skipped = p['skipped']
        notes.extend(n for n in p['notes'] if not n.startswith('No cradle'))
        gap = o['weld_gap']
        for n, c in enumerate(p['cradles'], 1):
            t = next(x for x in T if x.name == c['tube'])
            near = min([abs(c['s'] - j) for j in _joints(t)] or [1e9])
            if near < c['length'] / 2.0 + gap / 2.0:
                c['on_joint'] = True
            H = c['height']
            fl = c['length'] if mount == 'table' else max(c['length'], 0.5 * H)       # free-standing: a cross foot
            fw = c['foot']['width'] if mount == 'table' else max(c['foot']['width'], 0.6 * H)
            fc = c['foot']['centre']
            add = [_box(c['centre'], c['d'], c['w'], c['length'], c['width'], H),
                   _box(fc, c['d'], c['w'], c['length'], fw, ft)]
            if fl > c['length'] + 1e-9:
                add.append(_box(fc, c['d'], c['w'], fl, c['width'], ft))
            d2, c2 = _unit2(to2(c['d'])), to2(c['centre'])
            foot = [_rect(c2, d2, c['length'], fw), _rect(c2, d2, fl, c['width']), _rect(c2, d2, c['length'], c['width'], False)]
            cut = _cuts_prims(c['cut'])
            holes = []
            if mount == 'free' and o['free_holes']:
                holes = [to2(q) for q in c['foot']['holes']] if fw <= c['foot']['width'] + 1e-9 else \
                    [(c2[0] + k * (-d2[1]) * (fw / 2.0 - 1.2), c2[1] + k * d2[0] * (fw / 2.0 - 1.2)) for k in (-1.0, 1.0)]
            parts.append({'name': 'Cradle %d (%s at %.0f mm)' % (n, c['tube'], 10 * c['s']), 'kind': 'cradle', 'add': add,
                          'cut': cut, 'foot': foot, 'holes': holes, 'hole_d': o['hole_d'], 'height': H, 'tube': c['tube'], 's': c['s']})
        on_j = [q['name'] for q, c in zip(parts, p['cradles']) if c.get('on_joint')]
        if on_j:
            notes.append('%d cradle%s sit%s over a weld joint between pieces (%s): tack beside %s, or move %s.' % (
                len(on_j), '' if len(on_j) == 1 else 's', 's' if len(on_j) == 1 else '', ', '.join(on_j),
                'it' if len(on_j) == 1 else 'them', 'it' if len(on_j) == 1 else 'them'))
        if style == 'base' and len(parts) > 1:
            # minimum spanning tree over the foot centres (Prim), ribs along its edges
            cs = [to2(c['foot']['centre']) for c in p['cradles']]
            inside, edges = {0}, []
            best = {j: (math.hypot(cs[j][0] - cs[0][0], cs[j][1] - cs[0][1]), 0) for j in range(1, len(cs))}
            while best:
                j = min(best, key=lambda k: best[k][0])
                dist, i = best.pop(j)
                inside.add(j)
                edges.append((i, j, dist))
                for k in best:
                    dk = math.hypot(cs[k][0] - cs[j][0], cs[k][1] - cs[j][1])
                    if dk < best[k][0]:
                        best[k] = (dk, j)
            frame = {'name': 'Base frame', 'kind': 'base', 'add': [], 'cut': [], 'foot': [], 'holes': [], 'hole_d': o['hole_d'],
                     'height': max(q['height'] for q in parts)}
            for q in parts:
                frame['add'] += q['add']; frame['cut'] += q['cut']; frame['foot'] += q['foot']; frame['holes'] += q['holes']
            for i, j, dist in edges:
                a2, b2 = cs[i], cs[j]
                d2 = _unit2((b2[0] - a2[0], b2[1] - a2[1]))
                m2 = ((a2[0] + b2[0]) / 2.0, (a2[1] + b2[1]) / 2.0)
                frame['add'].append(_box(lift(m2, base + ft / 2.0), lift(d2, 0.0), _cross(up, lift(d2, 0.0)), dist, o['rib_w'], ft))
                frame['foot'].append(_rect(m2, d2, dist, o['rib_w']))
            parts = [frame]
            notes.append('The cradles stand on one frame: %d ribs along the shortest tree between their feet.' % len(edges))
        if style == 'plate' and parts:
            # one printed plate under the tubes: a strip along each tube's footprint, cradles standing on it, strips of
            # different tubes joined where the shortest tree between the cradles crosses from one tube to another
            plate = {'name': 'Plate', 'kind': 'plate', 'add': [], 'cut': [], 'foot': [], 'holes': [], 'hole_d': o['hole_d'],
                     'height': max(q['height'] for q in parts)}
            for q in parts:
                plate['add'] += q['add']; plate['cut'] += q['cut']; plate['foot'] += q['foot']; plate['holes'] += q['holes']
            for t in T:
                W = t.od + 2.0 * o['side'] + 2.0 * o['foot_ext']
                pts = [to2(x) for x in t.points(0.0, t.total, 2.0)]
                for a2_, b2_ in zip(pts, pts[1:]):
                    dist = math.hypot(b2_[0] - a2_[0], b2_[1] - a2_[1])
                    if dist < 0.2:
                        continue
                    d2 = _unit2((b2_[0] - a2_[0], b2_[1] - a2_[1]))
                    m2 = ((a2_[0] + b2_[0]) / 2.0, (a2_[1] + b2_[1]) / 2.0)
                    plate['add'].append(_box(lift(m2, base + ft / 2.0), lift(d2, 0.0), _cross(up, lift(d2, 0.0)), dist + W * 0.3, W, ft))
                    plate['foot'].append(_rect(m2, d2, dist + W * 0.3, W))
            cs = [to2(c['foot']['centre']) for c in p['cradles']]
            tid = [c['tube'] for c in p['cradles']]
            inside, best = {0}, {j: (math.hypot(cs[j][0] - cs[0][0], cs[j][1] - cs[0][1]), 0) for j in range(1, len(cs))}
            links = 0
            while best:
                j = min(best, key=lambda k: best[k][0])
                dist, i = best.pop(j)
                if tid[i] != tid[j]:
                    a2_, b2_ = cs[i], cs[j]
                    d2 = _unit2((b2_[0] - a2_[0], b2_[1] - a2_[1]))
                    m2 = ((a2_[0] + b2_[0]) / 2.0, (a2_[1] + b2_[1]) / 2.0)
                    plate['add'].append(_box(lift(m2, base + ft / 2.0), lift(d2, 0.0), _cross(up, lift(d2, 0.0)), dist, o['rib_w'], ft))
                    plate['foot'].append(_rect(m2, d2, dist, o['rib_w']))
                    links += 1
                for k in best:
                    dk = math.hypot(cs[k][0] - cs[j][0], cs[k][1] - cs[j][1])
                    if dk < best[k][0]:
                        best[k] = (dk, j)
            parts = [plate]
            notes.append('One plate under the tubes, a strip along each with its cradles on it%s.' % (
                ', %d bridge%s between the tubes' % (links, '' if links == 1 else 's') if links else ''))

    # ---- continuous saddles
    if style == 'saddle':
        step, gap, half = o['saddle_step'], o['weld_gap'], None
        for t in T:
            js = _joints(t)
            lo, hi = o['end_margin'] * 0.4, t.total - o['end_margin'] * 0.4
            ss, s = [], lo
            while s + step <= hi + 1e-9:
                ss.append(s + step / 2.0)
                s += step
            runs, cur = [], []
            for s in ss:
                pt, tan = t.at(s)
                steep = math.asin(min(1.0, abs(_dot(tan, up)))) > math.radians(o['max_tilt_deg'])
                atj = any(abs(s - j) < gap / 2.0 + step / 2.0 for j in js)
                if steep or atj:
                    if cur:
                        runs.append(cur); cur = []
                    if steep:
                        skipped.append({'tube': t.name, 's': s, 'why': 'runs %.0f deg from level here' % math.degrees(math.asin(min(1.0, abs(_dot(tan, up)))))})
                    continue
                cur.append(s)
                # split to the print bed: the run's footprint extent
                p2 = [to2(t.at(x)[0]) for x in (cur[0], cur[-1])]
                if len(cur) > 1 and math.hypot(p2[1][0] - p2[0][0], p2[1][1] - p2[0][1]) + step > o['bed'] - o['side'] * 2:
                    runs.append(cur[:-1]); cur = [s]
            if cur:
                runs.append(cur)
            for k, run in enumerate(runs, 1):
                add, foot, hmax = [], [], 0.0
                W = t.od + 2.0 * o['side']
                for s in run:
                    pt, tan = t.at(s)
                    d = _unit(_v(tan, up, -_dot(tan, up)))
                    w = _unit(_cross(up, d))
                    top = min(_dot(q, up) for q in t.points(s - step / 2.0, s + step / 2.0, step / 4.0))
                    H = top - base
                    hmax = max(hmax, H)
                    hp = _v(pt, up, -_dot(pt, up))
                    add.append(_box(_v(hp, up, base + H / 2.0), d, w, step * 1.04, W, H))
                    add.append(_box(_v(hp, up, base + ft / 2.0), d, w, step * 1.04, W + 2.0 * o['foot_ext'], ft))
                    d2, c2 = _unit2(to2(d)), to2(hp)
                    foot.append(_rect(c2, d2, step * 1.04, W + 2.0 * o['foot_ext']))
                    foot.append(_rect(c2, d2, step * 1.04, W, False))
                mid = t.at(run[len(run) // 2])[0]
                reach = 0.5 * math.hypot(*[a - b for a, b in zip(to2(t.at(run[0])[0]), to2(t.at(run[-1])[0]))]) + step + W + hmax
                cut = _cuts_prims(_tube_cuts(chains, _v(_v(mid, up, -_dot(mid, up)), up, base + hmax / 2.0), reach, o))
                parts.append({'name': 'Saddle %s %d (%.0f to %.0f mm)' % (t.name, k, 10 * (run[0] - step / 2), 10 * (run[-1] + step / 2)),
                              'kind': 'saddle', 'add': add, 'cut': cut, 'foot': foot, 'holes': [], 'hole_d': o['hole_d'],
                              'height': hmax, 'tube': t.name, 's': run[0]})
        if not parts:
            raise ValueError('No stretch of these tubes is level enough for a saddle. Use cradles, or lay the part flatter.')
        notes.append('Continuous saddles, broken %.0f mm wide at every weld joint between the cut pieces so the torch can '
                     'reach, and split to the %.0f mm print bed.' % (10 * o['weld_gap'], 10 * o['bed']))

    # ---- flange locators
    if ends:
        for t, end in ends:
                p0, tin, a1, a2, sz, pc, corners = flange_frame(t, end)   # tin points into the tube; a2 level
                th = o['flange_thick']
                add = [_box(pc, tin, a2, th, sz, sz)]
                cut = [{'k': 'cyl', 'a': _v(p0, tin, -th - 0.2), 'b': _v(p0, tin, 0.2), 'r': t.od / 2.0 + o['clearance']}]
                if o['flange_n'] > 0 and o['flange_pcd'] > 0 and o['flange_hole'] > 0:
                    for i in range(int(o['flange_n'])):
                        ang = math.radians(o['flange_angle_deg']) + 2.0 * math.pi * i / int(o['flange_n'])
                        q = _v(_v(p0, a1, 0.5 * o['flange_pcd'] * math.cos(ang)), a2, 0.5 * o['flange_pcd'] * math.sin(ang))
                        cut.append({'k': 'cyl', 'a': _v(q, tin, -th - 0.2), 'b': _v(q, tin, 0.2), 'r': o['flange_hole'] / 2.0})
                # two legs from the plate's two lowest corners to the base, each with a pad
                corners.sort(key=lambda q: _dot(q, up))
                legs, foot = corners[:2], []
                leg = o['leg']
                for q in legs:
                    q = _v(q, tin, -leg / 2.0)                 # legs behind the plate, clear of the tube in front
                    z0, z1 = base, _dot(q, up) + leg / 2.0
                    hq = _v(q, up, -_dot(q, up))
                    dl = _unit(_v(tin, up, -_dot(tin, up))) if abs(_dot(tin, up)) < 0.95 else a2
                    wl = _unit(_cross(up, dl))
                    add.append(_box(_v(hq, up, (z0 + z1) / 2.0), dl, wl, leg, leg, max(0.5, z1 - z0)))
                    pad = max(leg + 2.0 * o['foot_ext'], 0.6 * (z1 - z0)) if mount == 'free' else leg + 2.0 * o['foot_ext']
                    add.append(_box(_v(hq, up, base + ft / 2.0), dl, wl, pad, pad, ft))
                    c2, d2 = to2(hq), _unit2(to2(dl))
                    foot += [_rect(c2, d2, pad, pad), _rect(c2, d2, leg, leg, False)]
                reach = sz + _dot(p0, up) - base
                cut += _cuts_prims(_tube_cuts([ch for ch in chains if ch[0] is not t], pc, reach, o))
                parts.append({'name': 'Flange locator, %s %s' % (t.name, end), 'kind': 'flange', 'add': add, 'cut': cut,
                              'foot': foot, 'holes': [], 'hole_d': o['hole_d'], 'height': _dot(p0, up) - base + sz / 2.0, 'tube': t.name})

    if style == 'frame':
        locs = [q for q in parts if q['kind'] == 'flange']
        if not locs:
            raise ValueError('A flange frame needs free tube ends to hold. These tubes have none.')
        frame = {'name': 'Flange frame', 'kind': 'frame', 'add': [], 'cut': [], 'foot': [], 'holes': [], 'hole_d': o['hole_d'],
                 'height': max(q['height'] for q in locs)}
        for q in locs:
            frame['add'] += q['add']; frame['cut'] += q['cut']; frame['foot'] += q['foot']
        pads = [r['c'] for r in frame['foot'] if r['flat']]
        best = {j: (math.hypot(pads[j][0] - pads[0][0], pads[j][1] - pads[0][1]), 0) for j in range(1, len(pads))}
        nb = 0
        while best:
            j = min(best, key=lambda k: best[k][0])
            dist, i = best.pop(j)
            a2_, b2_ = pads[i], pads[j]
            d2 = _unit2((b2_[0] - a2_[0], b2_[1] - a2_[1]))
            m2 = ((a2_[0] + b2_[0]) / 2.0, (a2_[1] + b2_[1]) / 2.0)
            frame['add'].append(_box(lift(m2, base + o['beam_h'] / 2.0), lift(d2, 0.0), _cross(up, lift(d2, 0.0)), dist + o['rib_w'], o['rib_w'], o['beam_h']))
            frame['foot'].append(_rect(m2, d2, dist + o['rib_w'], o['rib_w']))
            nb += 1
            for k in best:
                dk = math.hypot(pads[k][0] - pads[j][0], pads[k][1] - pads[j][1])
                if dk < best[k][0]:
                    best[k] = (dk, j)
        frame['cut'] += _cuts_prims(_tube_cuts(chains, lift(pads[0], base), 1e6, o))
        parts = [q for q in parts if q['kind'] != 'flange'] + [frame]
        notes.append('A flange frame: %d locator%s joined by %d beams %.0f mm deep at base level; the tube is held by its '
                     'flanges only.' % (len(locs), '' if len(locs) == 1 else 's', nb, 10 * o['beam_h']))

    # ---- fixture-table bolt holes and tabs
    if mount == 'table':
        pitch, hd = o['grid_pitch'], o['grid_hole']
        ga = math.radians(o['grid_angle_deg'])
        gu, gv = (math.cos(ga), math.sin(ga)), (-math.sin(ga), math.cos(ga))
        g0 = o['grid_origin']
        def grid_near(p2, radius):
            rel = (p2[0] - g0[0], p2[1] - g0[1])
            a, b = rel[0] * gu[0] + rel[1] * gu[1], rel[0] * gv[0] + rel[1] * gv[1]
            n = int(radius / pitch) + 2
            out = []
            for i in range(int(math.floor(a / pitch)) - n, int(math.floor(a / pitch)) + n + 2):
                for j in range(int(math.floor(b / pitch)) - n, int(math.floor(b / pitch)) + n + 2):
                    q = (g0[0] + i * pitch * gu[0] + j * pitch * gv[0], g0[1] + i * pitch * gu[1] + j * pitch * gv[1])
                    if math.hypot(q[0] - p2[0], q[1] - p2[1]) <= radius:
                        out.append(q)
            return out
        head = 0.75 * hd + 0.3                          # bolt head clearance from a tall block
        for q in parts:
            flats = [r for r in q['foot'] if r['flat']]
            talls = [r for r in q['foot'] if not r['flat']]
            ctr = (sum(r['c'][0] for r in flats) / len(flats), sum(r['c'][1] for r in flats) / len(flats))
            ext = max(math.hypot(r['c'][0] - ctr[0], r['c'][1] - ctr[1]) + max(r['L'], r['W']) for r in flats)
            ok_pts = [g for g in grid_near(ctr, ext) if any(_in_rect(r, g, hd / 2.0 + 0.4) for r in flats)
                      and not any(_in_rect(dict(r, L=r['L'] + 2 * head, W=r['W'] + 2 * head), g, 0.0) for r in talls)]
            # keep holes spread out: at least a pitch apart (all of them are), at most 6 per part
            ok_pts.sort(key=lambda g: -math.hypot(g[0] - ctr[0], g[1] - ctr[1]))
            holes = ok_pts[:6]
            need = max(int(o['min_holes']), 3 if q['kind'] == 'base' else 2) - len(holes)
            if need > 0:
                cand = [g for g in grid_near(ctr, ext + 3 * pitch) if g not in holes
                        and not any(_in_rect(dict(r, L=r['L'] + 2 * head, W=r['W'] + 2 * head), g, 0.0) for r in talls)]
                cand.sort(key=lambda g: min(math.hypot(g[0] - r['c'][0], g[1] - r['c'][1]) for r in flats))
                picked = []
                for g in cand:
                    if all(math.hypot(g[0] - h[0], g[1] - h[1]) > 1.5 * pitch for h in picked + holes):
                        picked.append(g)
                    if len(picked) >= need:
                        break
                for g in picked:
                    r0 = min(flats, key=lambda r: math.hypot(g[0] - r['c'][0], g[1] - r['c'][1]))
                    dx, dy = g[0] - r0['c'][0], g[1] - r0['c'][1]
                    dist = math.hypot(dx, dy)
                    d2 = (dx / dist, dy / dist) if dist > 1e-9 else (1.0, 0.0)
                    L = dist + hd / 2.0 + o['tab_rim']
                    m2 = (r0['c'][0] + d2[0] * L / 2.0, r0['c'][1] + d2[1] * L / 2.0)
                    Wt = hd + 2.0 * o['tab_rim']
                    q['add'].append(_box(lift(m2, base + ft / 2.0), lift(d2, 0.0), _cross(up, lift(d2, 0.0)), L, Wt, ft))
                    q['foot'].append(_rect(m2, d2, L, Wt))
                    holes.append(g)
                q['tabs'] = len(picked)
            q['holes'] = holes
            q['hole_d'] = hd
        notes.append('Fixture-table mount: bolt holes %.0f mm on the table’s %.0f mm grid (origin %.0f, %.0f mm, %.0f deg), '
                     'tabs out to the nearest holes where a part had too few under it.' % (
                         10 * hd, 10 * pitch, 10 * g0[0], 10 * g0[1], o['grid_angle_deg']))
    for q in parts:
        q['hole_cuts'] = [{'k': 'cyl', 'a': lift(h, base - 0.2), 'b': lift(h, base + ft + 0.2), 'r': q['hole_d'] / 2.0} for h in q['holes']]
    # ---- print bed
    big = []
    for q in parts:
        pts = []
        for b in q['add']:
            if b['k'] != 'box':
                continue
            hdir = _cross(b['d'], b['w'])
            for i in (-0.5, 0.5):
                for j in (-0.5, 0.5):
                    for k in (-0.5, 0.5):
                        pts.append(_v(_v(_v(b['c'], b['d'], i * b['L']), b['w'], j * b['W']), hdir, k * b['H']))
        ext3 = sorted([max(_dot(p_, ax) for p_ in pts) - min(_dot(p_, ax) for p_ in pts) for ax in (u, vv, up)])
        q['size'] = ext3
        if ext3[1] > o['bed'] + 1e-6:
            big.append('%s (%.0f x %.0f x %.0f mm)' % (q['name'], 10 * ext3[2], 10 * ext3[1], 10 * ext3[0]))
    if big:
        notes.append('Larger than the %.0f mm print bed even lying down: %s. Print in pieces (cut where a rib or a weld '
                     'gap leaves room) or use separate cradles.' % (10 * o['bed'], '; '.join(big)))
    if skipped:
        notes.append('Nothing under %s: hold those pieces by the parts next to them, or clamp them.' % '; '.join(
            '%s %.0f mm along (%s)' % (k['tube'], 10 * k['s'], k['why']) for k in skipped[:12]))
    if o['layout'] == 'flat':
        notes.insert(0, 'Laid flat: the jig is built under the part’s widest side (the best-fit plane through its centrelines), not as it sits in the model; print it, set the part in it on its side.')
    return {'base': base, 'parts': parts, 'notes': notes, 'skipped': skipped, 'opts': o, 'frame': (u, vv, up), 'up': up}


def _unit2(a):
    n = math.hypot(a[0], a[1])
    return (a[0] / n, a[1] / n) if n > 1e-12 else (1.0, 0.0)


def fab_summary(p):
    kinds = {}
    for q in p['parts']:
        kinds[q['kind']] = kinds.get(q['kind'], 0) + 1
    return {'count': len(p['parts']), 'kinds': kinds, 'holes': sum(len(q['holes']) for q in p['parts']),
            'tallest': max([q['height'] for q in p['parts']] or [0.0]), 'notes': p['notes']}


def lay_flat_up(T, up0):
    """'Up' for laying the part on its widest side: the normal of the best-fit plane through the centrelines (the
    smallest principal axis, 3x3 Jacobi), pointing to the side where the jig comes out lower."""
    pts = [p for t in T for p in t.points(0.0, t.total, 1.0)]
    n = len(pts)
    c = [sum(p[k] for p in pts) / n for k in range(3)]
    A = [[sum((p[i] - c[i]) * (p[j] - c[j]) for p in pts) / n for j in range(3)] for i in range(3)]
    V = [[1.0 if i == j else 0.0 for j in range(3)] for i in range(3)]
    for _ in range(50):
        off = [(abs(A[i][j]), i, j) for i in range(3) for j in range(i + 1, 3)]
        m, i, j = max(off)
        if m < 1e-12:
            break
        th = 0.5 * math.atan2(2 * A[i][j], A[j][j] - A[i][i])
        cs, sn = math.cos(th), math.sin(th)
        for k in range(3):
            aik, ajk = A[i][k], A[j][k]
            A[i][k], A[j][k] = cs * aik - sn * ajk, sn * aik + cs * ajk
        for k in range(3):
            aki, akj = A[k][i], A[k][j]
            A[k][i], A[k][j] = cs * aki - sn * akj, sn * aki + cs * akj
        for k in range(3):
            vki, vkj = V[k][i], V[k][j]
            V[k][i], V[k][j] = cs * vki - sn * vkj, sn * vki + cs * vkj
    k = min(range(3), key=lambda q: A[q][q])
    nrm = _unit((V[0][k], V[1][k], V[2][k]))
    # the side where the centreline mass sits lower over its lowest point gives the shorter cradles
    def tall(nv):
        h = [_dot(p, nv) for p in pts]
        return sum(x - min(h) for x in h)
    if tall(_v((0.0, 0.0, 0.0), nrm, -1.0)) < tall(nrm):
        nrm = _v((0.0, 0.0, 0.0), nrm, -1.0)
    return nrm
