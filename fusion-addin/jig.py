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
            'foot_t': 0.6, 'foot_ext': 2.4, 'hole_d': 0.66, 'max_height': 24.0, 'max_tilt_deg': 60.0, 'chord': 0.4}


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
            for shift in (0.0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0):
                s = min(max(s0 + shift * o['block_len'], o['end_margin']), t.total - o['end_margin'])
                c = _cradle(t, s, o, up, base, chains)
                if c is None or not blocked(t, s, c):
                    break
            else:
                skipped.append({'tube': t.name, 's': s0, 'why': 'another tube runs under it here'})
                continue
            if c is None:
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
