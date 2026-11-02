import os
"""Tests for router.py on made-up scenes, checked by brute force against every triangle."""
import math
import sys
import time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import router as RT


def box_mesh(lo, hi, n=1):
    """Closed box surface, each face split n x n (two triangles per square)."""
    coords, idx = [], []

    def face(o, u, v):
        base = len(coords) // 3
        for i in range(n + 1):
            for j in range(n + 1):
                p = [o[k] + u[k] * i / n + v[k] * j / n for k in range(3)]
                coords.extend(p)
        for i in range(n):
            for j in range(n):
                a = base + i * (n + 1) + j
                b = a + (n + 1)
                idx.extend((a, b, a + 1, b, b + 1, a + 1))

    x0, y0, z0 = lo
    x1, y1, z1 = hi
    dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
    face((x0, y0, z0), (dx, 0, 0), (0, dy, 0))
    face((x0, y0, z1), (dx, 0, 0), (0, dy, 0))
    face((x0, y0, z0), (dx, 0, 0), (0, 0, dz))
    face((x0, y1, z0), (dx, 0, 0), (0, 0, dz))
    face((x0, y0, z0), (0, dy, 0), (0, 0, dz))
    face((x1, y0, z0), (0, dy, 0), (0, 0, dz))
    return coords, idx


def cyl_mesh(a, b, r, nr=24, nl=20):
    """Closed round tube surface from a to b (along X, Y or Z in these tests), with flat ends."""
    ax = [b[k] - a[k] for k in range(3)]
    L = math.sqrt(sum(v * v for v in ax))
    w = [v / L for v in ax]
    u = (0.0, 1.0, 0.0) if abs(w[1]) < 0.9 else (1.0, 0.0, 0.0)
    v = (w[1] * u[2] - w[2] * u[1], w[2] * u[0] - w[0] * u[2], w[0] * u[1] - w[1] * u[0])
    u = (v[1] * w[2] - v[2] * w[1], v[2] * w[0] - v[0] * w[2], v[0] * w[1] - v[1] * w[0])
    coords, idx = [], []
    for i in range(nl + 1):
        for j in range(nr):
            t = 2 * math.pi * j / nr
            c = [a[k] + ax[k] * i / nl + r * (math.cos(t) * u[k] + math.sin(t) * v[k]) for k in range(3)]
            coords.extend(c)
    for i in range(nl):
        for j in range(nr):
            p, q = i * nr + j, i * nr + (j + 1) % nr
            idx.extend((p, p + nr, q, q, p + nr, q + nr))
    for end, row in ((a, 0), (b, nl)):          # fan each end onto its centre
        ci = len(coords) // 3
        coords.extend(end)
        for j in range(nr):
            idx.extend((ci, row * nr + j, row * nr + (j + 1) % nr))
    return coords, idx


def brute_min(scene_meshes, pts, planes_for=None):
    """Exact smallest distance from each point to every triangle (no hashing)."""
    tris = []
    for coords, idx in scene_meshes:
        for t in range(len(idx) // 3):
            a, b, c = idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]
            tris.append(tuple(coords[3 * a:3 * a + 3]) + tuple(coords[3 * b:3 * b + 3]) + tuple(coords[3 * c:3 * c + 3]))
    out = []
    for k, p in enumerate(pts):
        planes = planes_for(k) if planes_for else None
        best = 1e18
        for T in tris:
            if planes:
                keep = False
                for q in range(3):
                    x, y, z = T[3 * q:3 * q + 3]
                    if all((x - o[0]) * nn[0] + (y - o[1]) * nn[1] + (z - o[2]) * nn[2] >= e for o, nn, e in planes):
                        keep = True
                        break
                if not keep:
                    continue
            d2 = RT.tri_d2(p[0], p[1], p[2], *T)
            if d2 < best:
                best = d2
        out.append(math.sqrt(best))
    return out


def check_route(res, meshes, spec, label):
    """Independent check: dense points along the result vs every triangle."""
    s = RT._spec(spec)
    req = s['R'] + s['gap']
    elems = res['elems']
    total = sum(RT.elem_len(e) for e in elems)
    pts, pos = [], []
    n = int(total / 0.1) + 1
    for i in range(n + 1):
        sp = total * i / n
        pts.append(RT._point_at(elems, sp))
        pos.append(sp)
    C = RT._Clearance(None, s, None, None)
    excl_s, excl_e = s['lead_start'] + req, s['lead_end'] + req
    eps = req * math.sin(math.radians(10.0)) + 0.1

    def planes_for(k):
        if pos[k] < excl_s:
            return [(s['start'], s['start_dir'], eps)]
        if total - pos[k] < excl_e:
            return [(s['end'], RT.vmul(s['end_dir'], -1.0), eps)]
        return None
    d = brute_min(meshes, pts, planes_for)
    worst = min(dd - req for dd in d)
    # continuity and tangency
    gaps = 0.0
    turn = 0.0
    for i in range(len(elems) - 1):
        a, b = elems[i], elems[i + 1]
        gaps = max(gaps, RT.vdist(a[2], b[1]))
        ta = RT.elem_tangent(a, 1.0)
        tb = RT.elem_tangent(b, 0.0)
        turn = max(turn, math.degrees(RT.angle_between(ta, tb)))
    t0 = RT.elem_tangent(elems[0], 0.0)
    t1 = RT.elem_tangent(elems[-1], 1.0)
    end_err = max(RT.vdist(elems[0][1], s['start']), RT.vdist(elems[-1][2], s['end']))
    dir_err = max(math.degrees(RT.angle_between(t0, s['start_dir'])), math.degrees(RT.angle_between(t1, s['end_dir'])))
    radii = [e[5] / e[4] for e in elems if e[0] == 'arc']
    print('%-28s ok=%s L=%.3f (len %.3f) slack_router=%.3f slack_brute=%.3f gaps=%.1e kink=%.2fdeg '
          'ends=%.1e/%.2fdeg bends=%d radii=%s t=%.1fs' % (
              label, res['ok'], res['length'], total, res['slack'], worst, gaps, turn, end_err, dir_err,
              len(radii), sorted(set(round(r, 4) for r in radii)), res['time']))
    return worst, gaps, turn, end_err, dir_err, total


def main():
    fails = []
    # Scene 1: a block in the way of a straight run
    m1 = box_mesh((20, -8, -8), (35, 8, 8), 6)
    sc = RT.Scene().add_mesh if False else None
    scene = RT.Scene(cell=1.0)
    scene.add_mesh(*m1)
    scene.build((-10, -40, -40), (70, 40, 40), 8)
    print('scene: %d tris, %d pts, e_cover %.3f, %.2fs' % (scene.ntri, scene.npoints, scene.e_cover, scene.build_time))
    spec = {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (55, 0, 0), 'end_dir': (1, 0, 0),
            'od': 4.445, 'clr': 6.67, 'gap': 1.27}
    r = RT.route(scene, spec, log=print)
    w, gaps, turn, ee, de, tot = check_route(r, [m1], spec, 'around a block')
    if not (r['ok'] and w >= -0.01 and gaps < 1e-6 and turn < 0.01 and ee < 1e-6 and de < 0.01):
        fails.append('block')
    # Scene 1b: same, with a target length (has to wander)
    spec2 = dict(spec, target=80.0)
    r = RT.route(scene, spec2, log=print)
    w, gaps, turn, ee, de, tot = check_route(r, [m1], spec2, 'block + target 80')
    if not (r['ok'] and w >= -0.01 and abs(tot - 80.0) <= 0.05 and abs(r['length'] - tot) < 1e-6):
        fails.append('block target')
    # Scene 2: start on a wall (port face), go down past a shelf
    wall = box_mesh((-2, -30, -40), (0, 30, 20), 10)       # the head face is x = 0
    shelf = box_mesh((10, -30, -12), (40, 30, -10), 10)    # something to clear underneath
    scene2 = RT.Scene(cell=1.0)
    scene2.add_mesh(*wall)
    scene2.add_mesh(*shelf)
    scene2.build((-5, -40, -50), (60, 40, 30), 8)
    spec3 = {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (20, 0, -35), 'end_dir': (0, 0, -1),
             'od': 4.128, 'clr': 6.2, 'gap': 1.0, 'target': 75.0}
    r = RT.route(scene2, spec3, log=print)
    w, gaps, turn, ee, de, tot = check_route(r, [wall, shelf], spec3, 'off a port, under a shelf')
    if not (r['ok'] and w >= -0.01 and abs(tot - 75.0) <= 0.05):
        fails.append('port shelf')
    print('LRA:', [(round(x['L'], 2), x['R'] and round(x['R'], 1), x['A'] and round(x['A'], 1)) for x in r['lra']])
    # Scene 3: a J-pipe off the top of a 3 in main pipe that is part of the scan. The page sends the cut length
    # (pipe wall to cap) as the target: 601.2 mm for 144 Hz with a 2.37 in ID branch, the Mufflers tab's default.
    main = cyl_mesh((-30, 0, 0), (70, 0, 0), 3.81, 24, 25)
    scene3 = RT.Scene(cell=1.0)
    scene3.add_mesh(*main)
    scene3.build((-35, -40, -30), (80, 40, 50), 8)
    spec4 = {'start': (10, 0, 3.81), 'start_dir': (0, 0, 1), 'end': (55, 0, 12), 'end_dir': (1, 0, 0),
             'od': 6.35, 'clr': 9.525, 'gap': 1.27, 'target': 60.12}
    r = RT.route(scene3, spec4, log=print)
    if r.get('elems'):
        w, gaps, turn, ee, de, tot = check_route(r, [main], spec4, 'J-pipe off the main pipe')
        if not (r['ok'] and w >= -0.01 and abs(tot - 60.12) <= 0.05 and gaps < 1e-6 and turn < 0.01 and ee < 1e-6 and de < 0.01):
            fails.append('j-pipe')
    else:
        print('J-pipe off the main pipe: no route:', r.get('msg'))
        fails.append('j-pipe')
    # the same markers with a cut length the markers are too far apart for: never passed as ok, and the
    # message gives the length it could do against the target (the add-in builds that and flags it)
    r = RT.route(scene3, dict(spec4, target=30.0), log=None)
    msg = r.get('msg') or ''
    print('J-pipe, cut length too short: ok=%s length=%s msg=%s' % (r['ok'], r.get('length'), msg))
    if r['ok'] or not ('shorter than the straight-line distance' in msg or
                       ('the target is 30.00 cm' in msg and (r.get('length') or 0) > 30.0)):
        fails.append('j-pipe short')
    print('FAILS:', fails)
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())   # a failing check fails the run
