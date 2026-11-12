"""The router's Rust core against its Python, number for number.

The scene, tube set and fields: the same scene stats and the same answers to every query, on scenes that exercise
each part of the build (small triangles, triangles big enough to be sampled, a scan thinned by voxels, triangles
outside the box). route()'s parts: free_at, los, the lattice search, the residuals, Levenberg-Marquardt and
certify, each run both ways on the same clearance and compared exactly. The scan fit (templates.fit_main_pipe)
both ways. Then whole routes (single pipes with and
without a length target, no scan, a header of four primaries keeping clear of each other) with every Rust part
on against an all-Python run: the same corners to the last bit. Then timings, and last what happens when the Rust
core fails part way (the work carries on in Python with the same answers). --quick (for CI, about half a minute)
routes two of the header's four primaries and leaves out the slowest timing.

Prints "TEST SKIPPED: <why>" when the Rust core is not built (cargo build --release in rust/et_core, or
EXHAUST_TUNER_NATIVE_DIR pointing at the library), unless --require is given (or REQUIRE_NATIVE=1): then a core
that is missing or does not load fails the run, so a build that should have it cannot pass without it."""
import math
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
if not os.environ.get('EXHAUST_TUNER_NATIVE_DIR'):
    built = os.path.join(HERE, '..', '..', 'rust', 'et_core', 'target', 'release')
    if os.path.isdir(built):
        os.environ['EXHAUST_TUNER_NATIVE_DIR'] = os.path.abspath(built)
import router as RT        # noqa: E402
import test_router as TR   # noqa: E402

if RT.NV is None:
    print('test_native: ' + RT.NATIVE_NOTE)
    if '--require' in sys.argv or os.environ.get('REQUIRE_NATIVE') == '1':
        print('FAIL the Rust core is required here and did not load')
        sys.exit(1)
    print('TEST SKIPPED: the Rust core is not built (cargo build --release in rust/et_core)')   # tools/run_all_tests.py
    sys.exit(0)
print(RT.NATIVE_NOTE + ': ' + RT.NV.WHY)

fails = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        fails.append(m)


def private_copy():
    """The library is loaded from a copy named by its content, so an update can replace the installed one while
    Fusion runs (Windows locks a loaded DLL until the program quits)."""
    import hashlib
    NV = RT.NV
    loaded = NV.WHY.split('loaded ', 1)[1]
    orig = os.path.join(os.path.dirname(os.path.dirname(loaded)), NV._names()[0])
    tag = hashlib.sha1(open(orig, 'rb').read()).hexdigest()[:12]
    ok(os.path.basename(os.path.dirname(loaded)) == 'native' and tag in os.path.basename(loaded),
       'the Rust core is loaded from its own copy (%s), not the installed file' % os.path.basename(loaded))
    stale = os.path.join(os.path.dirname(loaded), os.path.splitext(NV._names()[0])[0] + '-000000000000.old')
    open(stale, 'w').close()
    again = NV._private_copy(orig)
    ok(again == loaded and not os.path.exists(stale), 'loading again uses the same copy and clears an older one away')


def soup(rnd, n, lo, hi, size):
    """Random triangles: a scan-like mess of sizes."""
    coords, idx = [], []
    for t in range(n):
        c = [rnd.uniform(lo[k], hi[k]) for k in range(3)]
        for _ in range(3):
            coords.extend(c[k] + rnd.uniform(-size, size) for k in range(3))
        idx.extend((3 * t, 3 * t + 1, 3 * t + 2))
    return coords, idx


def both(meshes, lo, hi, pad, **kw):
    out = []
    for native in (False, None):
        sc = RT.Scene(native=native, **kw)
        for m in meshes:
            sc.add_mesh(*m)
        sc.build(lo, hi, pad)
        out.append(sc)
    return out


def same(a, b, tol=1e-12):
    return abs(a - b) <= tol * max(1.0, abs(a))


def compare(label, py, nv, rnd, box, n=1500):
    st = all(same(getattr(py, k), getattr(nv, k)) for k in ('ntri', 'npoints', 'e_cover', 'vox'))
    ok(st, '%s: same scene (%d triangles, %d points, e_cover %.4f, voxel %.3f)' % (label, nv.ntri, nv.npoints, nv.e_cover, nv.vox))
    planes = [((box[0][0] + 1.0, 0.0, 0.0), (1.0, 0.0, 0.0), 0.3), ((0.0, 0.0, box[1][2] - 2.0), (0.0, 0.0, -1.0), 0.0)]
    bad = 0
    for _ in range(n):
        p = tuple(rnd.uniform(box[0][k], box[1][k]) for k in range(3))
        for pl in (None, planes[:1], planes):
            cap = rnd.choice((3.0, 8.0, 15.0))
            if not same(py.dist_fast(p, cap, pl), nv.dist_fast(p, cap, pl)):
                bad += 1
            if not same(py.dist_exact(p, cap, pl), nv.dist_exact(p, cap, pl)):
                bad += 1
            r = rnd.choice((0.5, 1.5, 3.0, 6.0))
            if py.any_within(p, r, pl) != nv.any_within(p, r, pl):
                bad += 1
    ok(bad == 0, '%s: %d points x 3 plane sets: every distance and every "anything within" the same (%d differ)' % (label, n, bad))
    pts = [tuple(rnd.uniform(box[0][k], box[1][k]) for k in range(3)) for _ in range(300)]
    agree = all(py.min_dist(pts, cap, pl, ex) == nv.min_dist(pts, cap, pl, ex)
                for cap in (4.0, 12.0) for pl in (None, planes[:1]) for ex in (False, True))
    agree = agree and all(py.nearest(pts[i:i + 60], cap) == nv.nearest(pts[i:i + 60], cap) for i in (0, 60, 120) for cap in (2.0, 12.0))
    ok(agree, '%s: many points at once (nearest any comes, and which one is nearest): the same' % label)
    c = tuple((box[0][k] + box[1][k]) / 2.0 for k in range(3))
    a, b = sorted(py.points_near(c, 5.0)), sorted(nv.points_near(c, 5.0))
    ok(a == b, '%s: the same %d points near the middle' % (label, len(a)))
    ok(sorted(py.all_points()) == sorted(nv.all_points()), '%s: the same %d points in all' % (label, nv.npoints))


def fields(label, py, nv, rnd, box):
    s = RT._spec({'start': box[0], 'start_dir': (1, 0, 0), 'end': box[1], 'end_dir': (1, 0, 0), 'od': 4.4, 'clr': 6.6})
    Cp, Cn = RT._Clearance(py, s, None, None), RT._Clearance(nv, s, None, None)
    ok(not hasattr(Cp.f_mid, 'many') and hasattr(Cn.f_mid, 'many'), '%s: Python fields for the Python scene, Rust ones for the Rust scene' % label)
    worst = 0.0
    pts = [tuple(rnd.uniform(box[0][k], box[1][k]) for k in range(3)) for _ in range(800)]
    for fp, fn in ((Cp.f_mid, Cn.f_mid), (Cp.f_s, Cn.f_s), (Cp.f_e, Cn.f_e)):
        many = fn.many(pts)
        for p, m in zip(pts, many):
            worst = max(worst, abs(fp(p) - fn(p)), abs(fp(p) - m))
    ok(worst <= 1e-12, '%s: clearance fields agree, one point or many at once (worst %.1e)' % (label, worst))


def tubes(rnd):
    tp, tn = RT.TubeSet(native=False), RT.TubeSet(native=None)
    for i in range(6):
        pts = [tuple(rnd.uniform(-20, 20) for _ in range(3)) for _ in range(8)]
        for t in (tp, tn):
            t.add_polyline(pts, 2.0 + 0.1 * i, i)
            t.add_polyline(pts[:2], 2.0, ('lead', i))
    bad = 0
    for _ in range(1500):
        p = tuple(rnd.uniform(-25, 25) for _ in range(3))
        cap = rnd.choice((4.0, 10.0))
        own = rnd.choice((None, 0, 3, 5, 9))
        if not same(tp.dist(p, cap, own), tn.dist(p, cap, own)):
            bad += 1
        i = rnd.randrange(6)
        if not same(RT._Filtered(tp, i).dist(p, cap, None), RT._Filtered(tn, i).dist(p, cap, None)):
            bad += 1
    ok(bad == 0, 'tube set and its filtered view: the same distance every time (%d differ)' % bad)
    s = RT._spec({'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (10, 0, 0), 'end_dir': (1, 0, 0), 'od': 4.4, 'clr': 6.6})
    fp = RT._Clearance(None, s, RT._Filtered(tp, 2), 2).f_tt
    fn = RT._Clearance(None, s, RT._Filtered(tn, 2), 2).f_tt
    pts = [tuple(rnd.uniform(-25, 25) for _ in range(3)) for _ in range(800)]
    worst = max(abs(fp(p) - v) for p, v in zip(pts, fn.many(pts)))
    ok(hasattr(fn, 'many') and worst <= 1e-12, 'tube-to-tube field: the Rust one agrees (worst %.1e)' % worst)


def setup(scene, spec, tubes=None, owner=None):
    """route()'s first lines: the clearance, the search ends and grid, and the Rust context."""
    sp = RT._spec(spec)
    C = RT._Clearance(scene, sp, tubes, owner)
    A = RT.vadd(sp['start'], RT.vmul(sp['start_dir'], sp['lead_start']))
    B = RT.vsub(sp['end'], RT.vmul(sp['end_dir'], sp['lead_end']))
    h = max(0.75, min(3.0, C.req / 1.5))
    target = sp.get('target')
    semi = ((target - sp['lead_start'] - sp['lead_end'] + 2.0 * sp['clr']) / 2.0 + sp['clr']) if target else None
    los_step = min(h / 2.0, 1.0)
    nc = RT._native_route(scene, sp, C, A, B, h, semi, los_step)
    return sp, C, A, B, h, semi, los_step, nc


def py_free_at(sp, C, A, B, h, p, extra):
    ns = RT.vdist(p, sp['start']) < sp['lead_start'] + C.req + h
    ne = RT.vdist(p, sp['end']) < sp['lead_end'] + C.req + h
    ra = min(1.0, RT.vdist(p, A) / C.ramp_tt, RT.vdist(p, B) / C.ramp_tt)
    return C.point_free(p, ns, ne, ra, extra)


def py_los(sp, C, A, B, h, los_step, p, q, extra):
    L = RT.vdist(p, q)
    n = max(1, int(math.ceil(L / los_step)))
    for i in range(n + 1):
        if not py_free_at(sp, C, A, B, h, RT.vadd(p, RT.vmul(RT.vsub(q, p), i / float(n))), extra):
            return False
    return True


def route_parts(label, scene, spec, rnd, tubes=None, owner=None, box=None):
    sp, C, A, B, h, semi, los_step, nc = setup(scene, spec, tubes, owner)
    ok(nc is not None, '%s: route() takes the Rust path' % label)
    if nc is None:
        return
    lo, hi = box
    bad = 0
    for _ in range(400):
        p = tuple(rnd.uniform(lo[k], hi[k]) for k in range(3))
        q = tuple(rnd.uniform(lo[k], hi[k]) for k in range(3))
        ex = rnd.choice((0.0, 0.3 * sp['clr'], 0.6 * sp['clr']))
        if py_free_at(sp, C, A, B, h, p, ex) != nc.free_at(p, ex):
            bad += 1
        if py_los(sp, C, A, B, h, los_step, p, q, ex) != nc.los(p, q, ex):
            bad += 1
    ok(bad == 0, '%s: free_at and los agree at 400 random points and lines (%d differ)' % (label, bad))

    inside = (lambda p: True) if semi is None else (lambda p: RT.vdist(p, A) + RT.vdist(p, B) <= 2.0 * semi)
    for extra in (0.6 * sp['clr'], 0.0):
        t0 = time.time()
        fa = lambda p: py_free_at(sp, C, A, B, h, p, extra)
        lo_ = lambda p, q: py_los(sp, C, A, B, h, los_step, p, q, extra)
        if lo_(A, B):
            pp, ep = [A, B], 0
        else:
            pp, ep = RT.theta_star(A, B, h, fa, lo_, inside, max_expand=8000)
            pp = RT._simplify(pp, lo_) if pp is not None else None
        tp = time.time() - t0
        t0 = time.time()
        pn, en = nc.search(extra, 8000, 1e9)
        tn = time.time() - t0
        ok(pp == pn and ep == en, '%s: search +%.1f cm: the same %s corners, %d nodes (Python %.2f s, Rust %.3f s)' % (
            label, extra, len(pp) - 2 if pp else 'no', ep, tp, tn))

    path = pn or [A, B]
    W = [tuple(v + rnd.uniform(-0.5, 0.5) for v in q) for q in path[1:-1]]
    x0 = [sp['lead_start'] + 3.0, sp['lead_end'] + 3.0]
    for w in W:
        x0.extend(w)
    xs = [x0] + [[v + rnd.uniform(-1.0, 1.0) for v in x0] for _ in range(5)]
    anchor = [A] + path[1:-1] + [B]
    D = max(6.0, 0.2 * RT.vdist(A, B), 2.0 * h)
    bad = 0
    for x in xs:
        for target, wts, m, anc in ((None, (50.0, 50.0, 0.0, 0.3), 0.1, anchor), (sp.get('target'), (50.0, 500.0, 20.0, 0.3), 0.25, anchor),
                                    (None, (50.0, 50.0, 0.0, 0.3), 0.0, None)):
            st = dict(sp, target=target)
            rp = RT._residual_fn(st, C, 120, m, wts, anc, D)(x)
            rn = nc.residual(x, target, m, wts, anc, D, 120)
            if rp != rn:
                bad += 1
    ok(bad == 0, '%s: the residuals agree exactly at 6 centrelines x 3 weightings (%d differ, %d numbers each)' % (label, bad, len(rn)))

    bad = []
    for x in xs[:3]:
        geo = RT.chain_geometry(RT._chain(sp, x), sp['clr'])
        cp, cn = RT.certify(geo, C), nc.certify(x)
        if cp != cn:
            bad.append((cp, cn))
    ok(not bad, '%s: certify agrees exactly (slack, gap, tube gap and where) %s' % (label, bad[:1] if bad else ''))

    st = dict(sp, target=sp.get('target'))
    wts = (50.0, 50.0, 20.0 if sp.get('target') else 0.0, 0.3)
    t0 = time.time()
    xp, cp = RT._lm(st, C, None, x0, 120, 0.1, wts, anchor, D, 80, h, time.time() + 1e6)
    tp = time.time() - t0
    t0 = time.time()
    xn, cn = RT._lm(st, C, nc, x0, 120, 0.1, wts, anchor, D, 80, h, time.time() + 1e6)
    tn = time.time() - t0
    ok(xp == xn and cp == cn, '%s: Levenberg-Marquardt ends at the same x and cost %.6g (Python %.2f s, Rust %.3f s)' % (
        label, cn, tp, tn))
    xp2 = RT._prune(st, C, xp, 120, 0.1, wts, time.time() + 1e6, anchor, D)
    xn2 = RT._prune(st, C, xn, 120, 0.1, wts, time.time() + 1e6, anchor, D, nc)
    ok(xp2 == xn2, '%s: pruning straight corners: the same %d corners' % (label, (len(xn2) - 2) // 3))


def same_route(label, rp, rn):
    a, b = rp.get('corners') or [], rn.get('corners') or []
    worst = max([abs(p[k] - q[k]) for p, q in zip(a, b) for k in range(3)] or [0.0])
    ok(rp['ok'] == rn['ok'] and len(a) == len(b) and worst == 0.0 and rp.get('length') == rn.get('length'),
       '%s: the same route both ways (%s, %d corners, %.4f cm, corners differ by %.1e)' % (
           label, 'clear' if rn['ok'] else rn['msg'], len(b), rn.get('length') or 0.0, worst))


def full_routes(quick):
    blk = TR.box_mesh((20, -8, -8), (35, 8, 8), 6)
    cases = [
        ('block, no target', [blk], ((-10, -40, -40), (70, 40, 40), 8),
         {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (55, 0, 0), 'end_dir': (1, 0, 0), 'od': 4.445, 'clr': 6.67, 'gap': 1.27}),
        ('block, 80 cm target', [blk], ((-10, -40, -40), (70, 40, 40), 8),
         {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (55, 0, 0), 'end_dir': (1, 0, 0), 'od': 4.445, 'clr': 6.67, 'gap': 1.27, 'target': 80.0}),
        ('no scan, 60 cm target', [], None,
         {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (30, 10, 5), 'end_dir': (0, 1, 0), 'od': 4.445, 'clr': 6.67, 'target': 60.0}),
    ]
    for label, meshes, build, spec in cases:
        out = []
        for native in (False, None):
            sc = None
            if build:
                sc = RT.Scene(cell=1.0, native=native)
                for m in meshes:
                    sc.add_mesh(*m)
                sc.build(*build)
            out.append(RT.route(sc, dict(spec, time_budget=400.0)))
        same_route(label, out[0], out[1])
    # four primaries into a collector over a block: each keeps clear of the ones before it (the tube set's fields)
    blk2 = TR.box_mesh((10, -6, -30), (30, 6, -12), 6)
    ports = [((0, -9, 0), (0, 0, -1)), ((0, -3, 0), (0, 0, -1)), ((0, 3, 0), (0, 0, -1)), ((0, 9, 0), (0, 0, -1))]
    if quick:
        ports = ports[1:3]      # two primaries still check the second keeping clear of the first
    hs = {'od': 4.128, 'clr': 6.2, 'gap': 1.0, 'target': 70.0, 'time_budget': 400.0}
    res = []
    for native in (False, None):
        sc = RT.Scene(cell=1.0, native=native)
        sc.add_mesh(*blk2)
        sc.build((-20, -40, -70), (60, 40, 20), 8)
        t0 = time.time()
        r = RT.route_header(sc, ports, ((40, 0, -45), (1, 0, 0)), dict(hs, tubes=RT.TubeSet(native=native)))
        res.append((r, time.time() - t0))
    (rp, tp), (rn, tn) = res
    for i, (a, b) in enumerate(zip(rp['primaries'], rn['primaries'])):
        same_route('header primary %d' % (i + 1), a, b)
    print('  header: Python %.1f s, Rust core %.1f s' % (tp, tn))


def pipe_points(axis_p, axis_d, R, x0, x1, step, rnd, noise):
    """A scanned round pipe: rings of points with a little noise (test_drone_parts.py's, which runs its tests on
    import)."""
    a = RT.vunit(axis_d)
    e1, e2 = RT.perp_basis(a)
    pts = []
    n_ang = int(2 * math.pi * R / step)
    nx = int((x1 - x0) / step)
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        for k in range(n_ang):
            ph = math.radians(360.0 * k / n_ang)
            rr = R + rnd.gauss(0.0, noise)
            pts.append(RT.vadd(axis_p, RT.vadd(RT.vmul(a, x), RT.vadd(RT.vmul(e1, rr * math.cos(ph)), RT.vmul(e2, rr * math.sin(ph))))))
    return pts, e1, e2


def scan_fits():
    """templates.fit_main_pipe with its cost in Rust and in Python: the same fit, number for number."""
    import templates as TM
    rnd = random.Random(11)
    R = 3.81
    axis_p, axis_d = (10.0, -4.0, 2.0), RT.vunit((1.0, 0.35, 0.12))
    pts, e1, e2 = pipe_points(axis_p, axis_d, R, -15.0, 15.0, 0.3, rnd, 0.02)
    fl = RT.vsub(axis_p, RT.vmul(e2, R + 2.0))
    for i in range(-40, 41):
        for j in range(-40, 41):
            pts.append(RT.vadd(fl, RT.vadd(RT.vmul(axis_d, 0.4 * i), RT.vmul(e1, 0.4 * j))))
    surf = RT.vadd(axis_p, RT.vmul(e1, R))
    cases = [('a pipe with a floor under it', pts, RT.vadd(surf, RT.vmul(e1, 0.1)),
              RT.vunit(RT.vadd(e1, RT.vmul(axis_d, math.tan(math.radians(3.0))))), 3.6),
             ('a flat floor', [(x * 0.3, y * 0.3, 0.0) for x in range(-30, 31) for y in range(-30, 31)],
              (0.0, 0.0, 0.0), (0.0, 0.0, 1.0), R)]
    for label, P, start, d, R0 in cases:
        t0 = time.time()
        fp = TM.fit_main_pipe(P, start, d, R0, native=False)
        tp = time.time() - t0
        t0 = time.time()
        fn = TM.fit_main_pipe(P, start, d, R0)
        tn = time.time() - t0
        ok(fp == fn, 'scan fit, %s: the same fit both ways (%s; Python %.2f s, Rust core %.3f s)' % (
            label, 'accepted, R %.4f cm' % fn['R'] if fn['ok'] else fn['why'], tp, tn))


def timings(quick):
    rows = []
    blk = TR.box_mesh((20, -8, -8), (35, 8, 8), 6)
    wall = TR.box_mesh((-2, -30, -40), (0, 30, 20), 10)
    shelf = TR.box_mesh((10, -30, -12), (40, 30, -10), 10)
    cases = [
        ('around a block', [blk], ((-10, -40, -40), (70, 40, 40), 8),
         {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (55, 0, 0), 'end_dir': (1, 0, 0), 'od': 4.445, 'clr': 6.67, 'gap': 1.27}),
        ('block, 80 cm target', [blk], ((-10, -40, -40), (70, 40, 40), 8),
         {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (55, 0, 0), 'end_dir': (1, 0, 0), 'od': 4.445, 'clr': 6.67, 'gap': 1.27, 'target': 80.0}),
        ('off a port, under a shelf', [wall, shelf], ((-5, -40, -50), (60, 40, 30), 8),
         {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (20, 0, -35), 'end_dir': (0, 0, -1), 'od': 4.128, 'clr': 6.2, 'gap': 1.0, 'target': 75.0}),
    ]
    if quick:
        cases = cases[:2]
    for label, meshes, (lo, hi, pad), spec in cases:
        row = [label]
        for native in (False, None):
            sc = RT.Scene(cell=1.0, native=native)
            for m in meshes:
                sc.add_mesh(*m)
            t0 = time.time()
            sc.build(lo, hi, pad)
            r = RT.route(sc, dict(spec, time_budget=400.0))
            row.append((time.time() - t0, r))
        rows.append(row)
    print('route timings (scene build + route, time budget large so neither is cut short):')
    for label, (tp, rp), (tn, rn) in rows:
        print('  %-28s Python %6.2f s   Rust core %6.2f s   %5.1fx   %.2f / %.2f cm' % (
            label, tp, tn, tp / max(tn, 1e-9), rp['length'], rn['length']))
        same_route(label, rp, rn)


def fallback():
    """The Rust core failing part way: the call that failed and everything after it run in Python, with the same
    answers, and the route report says why. Runs last: it turns the core off for the rest of the run."""
    NV, note = RT.NV, RT.NATIVE_NOTE
    # a real refusal from the core comes back as CoreError with its reason
    sc = NV.Scene(1.0, 0.3, 1000)
    try:
        sc.add_mesh([0.0] * 9, [0, 1, 7])
        why = None
    except NV.CoreError as ex:
        why = str(ex)
    ok(why == 'a triangle names a node the mesh does not have', 'a mesh the core cannot use is refused with its reason (%s)' % why)
    # a NaN that is the answer is not taken for a failure
    blk = TR.box_mesh((20, -8, -8), (35, 8, 8), 6)
    py, nv = both([blk], (-10, -40, -40), (70, 40, 40), 8)
    try:
        v = nv._n.dist_fast((float('nan'), 0.0, 0.0), 5.0)
        ok(True, 'a NaN point gives an answer (%r), not a failure' % v)
    except NV.CoreError as ex:
        ok(False, 'a NaN point was taken for a failure: %s' % ex)
    other = RT.TubeSet()
    other.add_polyline([(0, 0, 0), (10, 0, 0)], 2.0, 'a')
    # a scene query that fails: answered in Python, the scene and every other Rust copy dropped
    def broken(*_a, **_k):
        raise NV.CoreError('a test failure')
    nv._n.dist_exact = broken
    p, cap = (18.0, 2.0, 1.0), 12.0
    try:
        got = nv.dist_exact(p, cap)
        ok(got == py.dist_exact(p, cap) and RT.NV is None and nv._n is None and other._n is None,
           'a failed scene query is answered in Python (%.4f), and the core is off for the session' % got)
    except Exception as ex:
        ok(False, 'a failed scene query was not answered: %r' % ex)
    ok('a test failure' in RT.NATIVE_NOTE, 'the route report says why: "%s"' % RT.NATIVE_NOTE)
    ok(nv.dist_fast(p, cap) == py.dist_fast(p, cap) and nv.any_within(p, 3.0) == py.any_within(p, 3.0)
       and other.dist((5, 3, 0), 9.0) == 1.0, 'the scene and tube set carry on in Python with the same answers')
    RT.NV, RT.NATIVE_NOTE = NV, note
    # a route whose Rust search fails part way: laid out again all in Python, the same route
    spec = {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (55, 0, 0), 'end_dir': (1, 0, 0), 'od': 4.445,
            'clr': 6.67, 'gap': 1.27, 'time_budget': 400.0}
    py, nv = both([blk], (-10, -40, -40), (70, 40, 40), 8, cell=1.0)
    rp = RT.route(py, spec)
    search = NV.Route.search
    NV.Route.search = broken
    try:
        rn = RT.route(nv, spec)
    finally:
        NV.Route.search = search
    ok(RT.NV is None and nv._n is None, 'a route whose Rust search failed turned the core off')
    same_route('a route after the Rust core failed', rp, rn)
    RT.NV, RT.NATIVE_NOTE = NV, note
    # the scan fit's cost failing part way: summed here from then on, the same fit
    import templates as TM
    rnd = random.Random(5)
    pts, e1, _e2 = pipe_points((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), 3.81, -10.0, 10.0, 0.4, rnd, 0.02)
    start, d = RT.vmul(e1, 3.91), e1
    fp = TM.fit_main_pipe(pts, start, d, 3.6, native=False)
    calls = [0]
    cost = NV.Points.cyl_cost

    def fails_later(self, *a):
        calls[0] += 1
        if calls[0] > 40:
            raise NV.CoreError('a test failure')
        return cost(self, *a)
    NV.Points.cyl_cost = fails_later
    try:
        fn = TM.fit_main_pipe(pts, start, d, 3.6)
    finally:
        NV.Points.cyl_cost = cost
    ok(fp == fn and RT.NV is None, 'a scan fit whose Rust cost failed after %d calls: the same fit' % calls[0])
    RT.NV, RT.NATIVE_NOTE = NV, note


private_copy()
rnd = random.Random(42)
blk = TR.box_mesh((20, -8, -8), (35, 8, 8), 6)
py, nv = both([blk], (-10, -40, -40), (70, 40, 40), 8)
compare('block (big triangles, sampled)', py, nv, rnd, ((-10, -20, -20), (60, 20, 20)))
fields('block', py, nv, rnd, ((-10, -20, -20), (60, 20, 20)))
spec_b = {'start': (0, 0, 0), 'start_dir': (1, 0, 0), 'end': (55, 0, 0), 'end_dir': (1, 0, 0), 'od': 4.445, 'clr': 6.67,
          'gap': 1.27, 'target': 80.0}
route_parts('block', nv, spec_b, rnd, box=((-10, -25, -25), (65, 25, 25)))
cyl = TR.cyl_mesh((-30, 0, 0), (40, 0, 0), 3.81, 48, 70)
py, nv = both([cyl], (-35, -10, -10), (45, 10, 10), 2)
compare('scanned pipe (small triangles)', py, nv, rnd, ((-30, -8, -8), (40, 8, 8)))
mess = soup(rnd, 4000, (-30, -30, -30), (30, 30, 30), 1.5)
py, nv = both([mess, blk], (-20, -20, -20), (20, 20, 20), 3, max_points=5000)
ok(nv.vox > 0, 'scan over the point budget: thinned by a %.3f cm voxel' % nv.vox)
compare('thinned scan, triangles outside the box', py, nv, rnd, ((-25, -25, -25), (25, 25, 25)))
fields('thinned scan', py, nv, rnd, ((-25, -25, -25), (25, 25, 25)))
tubes(rnd)
# a tube routed past two others (a header's third primary), its own lead left out of the tube set
ts = RT.TubeSet(native=None)
ts.add_polyline([(0, -6, 0), (0, -6, -2.54)], 2.064, ('lead', 0))
ts.add_polyline([(0, -6, -2.54), (10, -6, -20), (30, -6, -30)], 2.064, 0)
ts.add_polyline([(0, 6, 0), (0, 6, -2.54), (12, 6, -22), (30, 6, -30)], 2.064, 1)
ts.add_polyline([(0, 0, 0), (0, 0, -2.54)], 2.064, ('lead', 2))
blk3 = TR.box_mesh((8, -15, -40), (25, 15, -32), 6)
_py3, nv3 = both([blk3], (-10, -30, -60), (50, 30, 10), 8)
spec_h = {'start': (0, 0, 0), 'start_dir': (0, 0, -1), 'end': (32, 0, -26), 'end_dir': (1, 0, 0), 'od': 4.128, 'clr': 6.2,
          'gap': 1.0, 'target': 55.0}
route_parts('past two tubes', nv3, spec_h, rnd, tubes=RT._Filtered(ts, 2), owner=2, box=((-5, -15, -45), (40, 15, 5)))
full_routes('--quick' in sys.argv)
scan_fits()
timings('--quick' in sys.argv)
fallback()
print('FAILS:', fails)
sys.exit(1 if fails else 0)
