"""Hangers and brackets: where the page's flat parts go on the tube, in plain Python (no Fusion), so it is tested on
its own (tests/test_hangers.py); cadtools.act_hang builds them.

The page (Hangers tab) works each part out flat, in millimetres, in the tube's own frame: x across the tube, y out
from its centre toward the mount. Here that frame is put on the tube where the user clicked:
  S  the point on the tube's axis level with the click
  Z  along the axis
  Y  square to the axis, out through the clicked point, or toward the mount point when one is selected too
  X  = Y x Z, so X, Y, Z are right-handed
A part 'across' the tube lies in the X-Y plane (its 2-D x -> X, y -> Y), coped to the tube's curve; one 'along' the
tube lies in the Z-Y plane (x -> Z, y -> Y), a fin. Each plate is extruded its thickness, centred on that plane, or on
a plane `off` mm along its normal (a body tab beside the pipe tab). A rod's path lies in the Z-Y plane. Units out are
Fusion's: cm.
"""
import math


def _v(a, b, k=1.0):
    return (a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2])


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _unit(a):
    n = math.sqrt(_dot(a, a))
    if n < 1e-12:
        raise ValueError('zero vector')
    return (a[0] / n, a[1] / n, a[2] / n)


def frame(axis_p, axis_d, click, mount=None, up=None):
    """The tube frame at the click (all cm). mount: a point the part should point at (its reach is measured);
    up: a fallback direction when the click sits on the axis (a centreline was clicked)."""
    Z = _unit(axis_d)
    S = _v(axis_p, Z, _dot(_sub(click, axis_p), Z))
    toward = mount if mount is not None else click
    r = _sub(toward, S)
    r = _v(r, Z, -_dot(r, Z))
    reach = math.sqrt(_dot(r, r))
    if reach < 1e-6:
        if up is None:
            raise ValueError('Pick a point off the tube axis: click the pipe’s outside face where the hanger goes.')
        r = _v(up, Z, -_dot(up, Z))
    Y = _unit(r)
    X = _cross(Y, Z)
    return {'S': S, 'X': X, 'Y': Y, 'Z': Z, 'reach_cm': reach if mount is not None else None}


def to3(fr, plane, q, o2=(0.0, 0.0), off=0.0):
    """A page point q (mm, in the part) to the model (cm)."""
    x, y = (q[0] + o2[0]) / 10.0, (q[1] + o2[1]) / 10.0
    if plane == 'along':
        return _v(_v(_v(fr['S'], fr['Z'], x), fr['Y'], y), fr['X'], off / 10.0)
    return _v(_v(_v(fr['S'], fr['X'], x), fr['Y'], y), fr['Z'], off / 10.0)


def normal(fr, plane):
    return fr['X'] if plane == 'along' else fr['Z']


def _sweep(s):
    if s['t'] != 'A':
        return 0.0
    sw = s['a1'] - s['a0']
    tau = 2 * math.pi
    if s.get('ccw'):
        sw = sw % tau
    else:
        sw = -((-sw) % tau)
    return sw


def at(s, u):
    """A point along a page segment (mm): u = 0 at its start, 1 at its end."""
    if s['t'] == 'L':
        return (s['a'][0] + (s['b'][0] - s['a'][0]) * u, s['a'][1] + (s['b'][1] - s['a'][1]) * u)
    a = s['a0'] + _sweep(s) * u
    return (s['c'][0] + s['r'] * math.cos(a), s['c'][1] + s['r'] * math.sin(a))


def seg3(fr, plane, s, o2=(0.0, 0.0), off=0.0):
    """('L', a, b) or ('A', start, middle, end) in the model (cm)."""
    T = lambda q: to3(fr, plane, q, o2, off)
    if s['t'] == 'L':
        return ('L', T(s['a']), T(s['b']))
    return ('A', T(at(s, 0.0)), T(at(s, 0.5)), T(at(s, 1.0)))


def plan(h, fr):
    """Everything to build for the page's payload h, placed on frame fr."""
    out = {'plates': [], 'rods': [], 'cyls': [], 'cuts': []}
    for p in h.get('parts') or []:
        plane, o2, off = p.get('plane') or 'across', tuple(p.get('o2') or (0.0, 0.0)), float(p.get('off') or 0.0)
        if not p.get('outline'):
            continue
        loops = [[seg3(fr, plane, s, o2, off) for s in p['outline']]]
        circles = []
        for q in p.get('holes') or []:
            if q['t'] == 'C':
                circles.append((to3(fr, plane, q['c'], o2, off), q['r'] / 10.0))
            else:
                loops.append([seg3(fr, plane, s, o2, off) for s in q['segs']])
        # the sketch plane: three points of the part's own plane (origin, +x, +y), offset like the part
        pl = (to3(fr, plane, (0.0, 0.0), o2, off), to3(fr, plane, (10.0, 0.0), o2, off), to3(fr, plane, (0.0, 10.0), o2, off))
        out['plates'].append({'name': p.get('name') or 'Bracket', 't': float(p['t']) / 10.0, 'loops': loops, 'circles': circles,
                              'plane3': pl, 'normal': normal(fr, plane)})
    for r in h.get('rods') or []:
        path = [seg3(fr, 'along', s) for s in r['path']]
        pl = (to3(fr, 'along', (0.0, 0.0)), to3(fr, 'along', (10.0, 0.0)), to3(fr, 'along', (0.0, 10.0)))
        out['rods'].append({'name': r.get('name') or 'Rod hanger', 'd': float(r['d']) / 10.0, 'path': path, 'plane3': pl})
    for c in h.get('cyls') or []:
        plane = c.get('plane') or 'across'
        out['cyls'].append({'name': c['name'], 'a': to3(fr, plane, c['c2'], off=c['z0']), 'b': to3(fr, plane, c['c2'], off=c['z1']),
                            'r': c['r'] / 10.0})
    for c in h.get('cuts') or []:
        out['cuts'].append({'name': c['name'], 'a': to3(fr, 'across', (c['x'], c['y0'])), 'b': to3(fr, 'across', (c['x'], c['y1'])),
                            'r': c['r'] / 10.0})
    return out
