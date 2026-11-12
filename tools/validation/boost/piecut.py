#!/usr/bin/env python3
"""Independent pie-cut (lobster-back) geometry for two cases, compared with the Headers tab's pieCut (boost audit 2026-11-12).

Built numerically, not from the page's closed forms: each piece's axis is placed in the bend plane, its surface lines at
offsets -r, 0, +r are intersected with the weld planes by solving the line-plane intersection (numpy), the weld is the
plane section of the cylinder, an ellipse of semi-axes r / cos(a) and r whose perimeter is 4 A E(m), m = 1 - B^2/A^2,
from scipy.special.ellipe, and the stock length is laid out piece by piece with the blade's slab (thickness k square to
the cut plane, k / cos(a) along the axis). Hooper 2-K figures are read from python-fluids' fittings.Hooper table.
Usage: PYTHONPATH=<fluids checkout> python3 piecut.py
"""
import json, math
import numpy as np
from scipy.special import ellipe


def plane_hit(p0, d, n, q):
    """Line p0 + s d against the plane through q with normal n: s."""
    return float(np.dot(q - p0, n) / np.dot(d, n))


def radial_plane(phi):
    # plane containing the bend's centre axis (z) at angle phi in the x-y plane; normal in-plane, square to the radius
    return np.array([-math.sin(phi), math.cos(phi), 0.0]), np.zeros(3)


def piece_lengths(R, r, th_mid, phi_a, phi_b, axis_at):
    """Axis of the piece: direction square to the radius at th_mid, through the point axis_at (in the bend plane)."""
    t = np.array([-math.sin(th_mid), math.cos(th_mid), 0.0])
    u = np.array([math.cos(th_mid), math.sin(th_mid), 0.0])
    out = {}
    for name, rho in (('i', -r), ('c', 0.0), ('o', r)):
        p0 = axis_at + rho * u
        na, qa = radial_plane(phi_a)
        nb, qb = radial_plane(phi_b)
        out[name] = plane_hit(p0, t, nb, qb) - plane_hit(p0, t, na, qa)
    return out


def case(od, clr, T, n, ends, kerf):
    r, R = od / 2, clr
    if ends == 'square':
        nW = n - 1
        d = math.radians(T) / nW
        a = d / 2
        th = d                                   # first full piece, middle at d, welds at d/2 and 3d/2
        full = piece_lengths(R, r, th, th - d / 2, th + d / 2, R * np.array([math.cos(th), math.sin(th), 0]))
        half = piece_lengths(R, r, 0.0, -1e-12, d / 2, np.array([R, 0, 0]))   # the straight's end, square at angle 0
        half = {k: v for k, v in half.items()}
        pieces = [half['c']] + [full['c']] * (n - 2) + [half['c']]
        ncuts = nW
        lead = 0.0
    else:
        nW = n + 1
        p = math.radians(T) / n
        a = p / 2
        th = p / 2                               # chord from angle 0 to p: middle direction p/2, axis at R cos(a)
        full = piece_lengths(R, r, th, 0.0, p, R * math.cos(a) * np.array([math.cos(th), math.sin(th), 0]))
        half = None
        pieces = [full['c']] * n
        ncuts = n + 1
        lead = r * math.tan(a)                   # a cut whose short side is at the stick's end: its centre r tan(a) in
    A, B = r / math.cos(a), r
    weld = 4 * A * ellipe(1 - (B / A) ** 2)
    kax = kerf / math.cos(a)
    # stock: lay the pieces out with a slab of kerf between them, each cut's mark at the blade's near face
    x, marks = lead, []
    if ends == 'square':
        x = pieces[0]
        for pc in pieces[1:]:
            marks.append(x); x += kax + pc
        stock = x
    else:
        for pc in pieces:
            marks.append(x); x += kax + pc
        marks.append(x); stock = x + kax + lead
    res = dict(alpha_deg=math.degrees(a), full=full, half=half, weld=weld, stock=stock, first_marks=marks[:3], n_cuts=len(marks),
               tpl_h=r * math.tan(a))
    try:
        from fluids.fittings import Hooper
        if ends == 'square' and abs(T - 90) < 1e-9:
            key = [k for k in Hooper if k.startswith('Elbow, 90°, Mitered') and k.split('), ')[1].startswith('%d weld' % nW)]
            K1, Kinf = Hooper[key[0]]
            Din = (od - 2 * 1.651) / 25.4
            res['hooper'] = dict(key=key[0], K1=K1, Kinf=Kinf, K_highRe=Kinf * (1 + 1 / Din),
                                 lr=Hooper['Elbow, 90°, Long-radius (R/D = 1.5), All types'][1] * (1 + 1 / Din))
    except ImportError:
        pass
    return res


out = {'A_square_3in_4p5in_90deg_5pc_kerf1_16': case(76.2, 114.3, 90, 5, 'square', 1.5875),
       'B_full_2p5in_3p75in_60deg_4pc_kerf2mm': case(63.5, 95.25, 60, 4, 'full', 2.0)}
print(json.dumps(out, indent=1))
