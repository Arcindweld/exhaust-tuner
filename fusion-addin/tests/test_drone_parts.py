"""The drone-fix geometry in templates.py, without Fusion: the tee's fishmouth against closed-form and brute-force
answers, the Helmholtz can's volume with and without the neck run in, the clearance samples, the main-pipe fit
from scan points (with noise, a floor beside the pipe, a marker drawn off the surface and off square, and scans
that should be refused), and the clearance check against a real router Scene."""
import math
import os
import random
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import router as RT        # noqa: E402
import templates as T      # noqa: E402
import test_router as TR   # noqa: E402  (box_mesh, cyl_mesh)

fails = []


def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        fails.append(msg)


def brute_depth(main, start, d, r, n=96, dt=2e-4):
    """Step down each line of the branch outline until it is inside the main pipe's outside."""
    d = RT.vunit(d)
    e1, e2 = RT.perp_basis(d)
    a = RT.vunit(main['d'])
    worst = 0.0
    for k in range(n):
        ph = 2 * math.pi * k / n
        q = RT.vadd(start, RT.vadd(RT.vmul(e1, r * math.cos(ph)), RT.vmul(e2, r * math.sin(ph))))
        t = 0.0
        while t < 3 * main['R']:
            x = RT.vsub(RT.vsub(q, RT.vmul(d, t)), main['p'])
            rho = math.sqrt(max(0.0, RT.vdot(x, x) - RT.vdot(x, a) ** 2))
            if rho <= main['R']:
                break
            t += dt
        worst = max(worst, t)
    return worst


def inside_above(main, start, d, r, n=720, dt=2e-4):
    """Brute force: how far up the branch (along +d) its outline is still inside the main pipe's outside."""
    d = RT.vunit(d)
    e1, e2 = RT.perp_basis(d)
    a = RT.vunit(main['d'])
    worst = 0.0
    for k in range(n):
        ph = 2 * math.pi * k / n
        q = RT.vadd(start, RT.vadd(RT.vmul(e1, r * math.cos(ph)), RT.vmul(e2, r * math.sin(ph))))
        s = 0.0
        last_in = None
        while s < 6.0:
            x = RT.vsub(RT.vadd(q, RT.vmul(d, s)), main['p'])
            if math.sqrt(max(0.0, RT.vdot(x, x) - RT.vdot(x, a) ** 2)) < main['R']:
                last_in = s
            s += dt
        if last_in is not None:
            worst = max(worst, last_in)
    return worst


def tees():
    R = 3.81                                  # 3 in OD main pipe along X, branch up Z from its top
    main = {'p': (0.0, 0.0, 0.0), 'd': (1.0, 0.0, 0.0), 'R': R}
    start, up = (5.0, 0.0, R), (0.0, 0.0, 1.0)
    r = 3.175                                 # 2.5 in OD branch
    c = T.tee_cope(main, start, up, r)
    want = R - math.sqrt(R * R - r * r)
    ok(abs(c['depth'] - want) < 1e-9, 'square tee: fishmouth depth %.4f cm = R - sqrt(R^2 - r^2) %.4f' % (c['depth'], want))
    ok(abs(c['room'] - (R + math.sqrt(R * R - r * r))) < 1e-9 and abs(c['axis'] - R) < 1e-9, 'square tee: room to the far wall and the axis distance')
    ok(c['full'] and abs(c['stub'] - (want + 0.05)) < 1e-9 and c['trim'] == 0.0 and c['top'] == 0.0, 'square tee: full cope, stub 0.5 mm past the deepest point, nothing above the start')
    b = brute_depth(main, start, up, r)
    ok(abs(b - c['depth']) < 2e-4, 'square tee: brute force agrees (%.4f)' % b)

    same = T.tee_cope({'p': (0, 0, 0), 'd': (1, 0, 0), 'R': r}, (0, 0, r), up, r)
    ok(same['full'] and abs(same['depth'] - r) < 1e-6 and abs(same['stub'] - (r - 0.25)) < 1e-6 and abs(same['trim'] - 0.25) < 1e-6,
       'same-size T: the tips meet the main pipe tangentially at its centreline; they end 2.5 mm short in a flat (stub %.3f)' % same['stub'])
    scan = T.tee_cope({'p': (0, 0, 0), 'd': (1, 0, 0), 'R': r - 0.00054}, (0, 0, r), up, r)
    ok(scan['full'] and abs(scan['R'] - r) < 1e-12, 'same-size T on a scan that reads a hair under: taken as the same size (R %.5f)' % scan['R'])

    for deg, want_full in ((0.01, True), (0.3, True), (2.0, False)):
        tt = math.radians(deg)
        lean = T.tee_cope({'p': (0, 0, 0), 'd': (1, 0, 0), 'R': r - 0.0005}, (0, 0, r - 0.0005), (0.0, math.sin(tt), math.cos(tt)), r)
        ok(lean['full'] == want_full and (want_full or lean['why'] == 'side'),
           'same-size T leaning %.2f deg across the pipe: %s (%s)' % (deg, 'coped, the side grazes within 0.5 mm' if want_full
                                                                     else 'left square, its side overhangs', lean['why'] or 'full'))
    wide = T.tee_cope({'p': (0, 0, 0), 'd': (1, 0, 0), 'R': 2.54}, (0, 0, 2.54), up, 3.175)
    ok(not wide['full'] and wide['why'] == 'wider' and wide['stub'] == 0.0, 'branch wider than the main pipe: no automatic cope (%s)' % wide['why'])
    along = T.tee_cope(main, start, (1.0, 0.0, 0.0), r)
    ok(not along['full'] and along['why'] == 'along', 'branch running along the main pipe: no cope (%s)' % along['why'])
    into = T.tee_cope(main, start, (0.0, 0.0, -1.0), r)
    ok(not into['full'] and into['why'] == 'into', 'marker pointing into the main pipe: refused (%s)' % into['why'])

    lat = RT.vunit((1.0, 0.0, 1.0))           # a 45 degree lateral
    c45 = T.tee_cope(main, start, lat, 2.54)
    b45 = brute_depth(main, start, lat, 2.54)
    ok(c45['full'] and abs(c45['depth'] - b45) < 2e-4, '45 deg lateral: depth %.4f, brute force %.4f' % (c45['depth'], b45))
    ok(abs(c45['axis'] - R * math.sqrt(2.0)) < 1e-9, '45 deg lateral: the centreline crosses the axis %.3f cm down the branch' % c45['axis'])
    t45 = inside_above(main, start, lat, 2.54)
    ok(abs(c45['top'] - t45) < 5e-4, '45 deg lateral: its outline stays inside the main pipe %.2f mm up the branch (brute force %.2f)' % (10 * c45['top'], 10 * t45))
    for deg in (2.0, 3.0, 10.0):
        dd = RT.vunit((math.sin(math.radians(deg)), 0.0, math.cos(math.radians(deg))))
        cc = T.tee_cope({'p': (0, 0, 0), 'd': (1, 0, 0), 'R': 3.175}, (20.0, 0.0, 3.175), dd, 3.175)
        tb = inside_above({'p': (0, 0, 0), 'd': (1, 0, 0), 'R': 3.175}, (20.0, 0.0, 3.175), dd, 3.175)
        ok(cc['full'] and abs(cc['top'] - tb) < 5e-4 and cc['top'] > 0,
           'same-size J-pipe %.0f deg off square: %.2f mm of it inside the main pipe above the start (brute force %.2f), for the builder to cut' % (deg, 10 * cc['top'], 10 * tb))

    tilt = RT.vunit((0.0, 0.0, 1.0))
    off = T.tee_cope(main, (5.0, 0.0, R + 0.2), tilt, r)   # marker drawn 2 mm above the surface
    ok(abs(off['depth'] - (want + 0.2)) < 1e-9, 'marker 2 mm off the surface: the coped piece fills the gap')


def holes():
    R, RIN = 3.81, 3.645
    main = {'p': (0.0, 0.0, 0.0), 'd': (1.0, 0.0, 0.0), 'R': R}
    start, up = (5.0, 0.0, R), (0.0, 0.0, 1.0)
    ri = 3.0099
    h = T.tee_hole(main, start, up, ri, RIN)
    want = R - math.sqrt(RIN ** 2 - ri ** 2)
    ok(h is not None and abs(h['bottom'] - (want + 0.05)) < 1e-9 and abs(h['top'] - 0.05) < 1e-12,
       'hole tool, square tee: through the wall at its deepest (%.3f cm) and just past the outside' % h['bottom'])

    def covers(main, start, d, ri, RIN, h, n=360):
        """Every line of the bore: the tool spans its wall, and stops short of the far wall."""
        d = RT.vunit(d)
        e1, e2 = RT.perp_basis(d)
        for k in range(n):
            ph = 2 * math.pi * k / n
            q = RT.vadd(start, RT.vadd(RT.vmul(e1, ri * math.cos(ph)), RT.vmul(e2, ri * math.sin(ph))))
            ho = T._hits(q, d, main['p'], main['d'], main['R'])
            hi = T._hits(q, d, main['p'], main['d'], RIN)
            if -h['top'] > ho[0] + 1e-9:
                return False
            if hi is not None and (h['bottom'] < hi[0] - 1e-9 or h['bottom'] >= hi[1]):
                return False
        return True
    ok(covers(main, start, up, ri, RIN, h), 'hole tool, square tee: covers the wall all round, clear of the far wall')
    for deg in (3.0, 10.0, 30.0):
        dd = RT.vunit((math.sin(math.radians(deg)), 0.0, math.cos(math.radians(deg))))
        hh = T.tee_hole(main, start, dd, ri, RIN)
        ok(hh is not None and hh['top'] > 0.05 and covers(main, start, dd, ri, RIN, hh),
           'hole tool %.0f deg off square: runs %.2f mm above the start to cover the wall, still clear of the far wall' % (deg, 10 * hh['top']))
    m2 = {'p': (0.0, 0.0, 0.0), 'd': (1.0, 0.0, 0.0), 'R': 3.175}
    same = T.tee_hole(m2, (0.0, 0.0, 3.175), up, 3.0099, 3.0099)
    ok(same is not None and abs(same['bottom'] - (3.175 - 0.25)) < 1e-6, 'hole tool, same-size bore: stops 2.5 mm short where the bores meet tangentially')
    ok(T.tee_hole(m2, (0.0, 0.0, 3.175), up, 3.3, 3.0) is None, 'hole tool: a bore wider than the main pipe gets none')


def cans():
    neck_id, nw, ln, can_id, V, cw = 5.08, 0.1651, 7.62, 15.24, 5000.0, 0.1519
    a = T.helm_can(neck_id, nw, ln, can_id, V, cw)
    Rc, Rco, rno = can_id / 2, can_id / 2 + cw, neck_id / 2 + nw
    ok(abs(a['gas'] - V) < 1e-9 and abs(a['L_in'] - V / (math.pi * Rc ** 2)) < 1e-9, 'flush neck: inside length %.3f cm holds %.1f cm^3' % (a['L_in'], a['gas']))
    ok(abs(a['z_in'] - ln) < 1e-12 and abs(a['gap'] - (ln - cw)) < 1e-12, 'flush neck: the can starts where the neck ends')
    shell = math.pi * Rco ** 2 * (a['z1'] - a['z0']) - math.pi * Rc ** 2 * a['L_in'] - math.pi * rno ** 2 * cw
    ok(abs(T.revolved_volume(a['section']) - shell) < 1e-6, 'can half-section revolves to the shell volume (%.2f cm^3 of steel)' % shell)
    ok(abs(T.revolved_volume(a['neck']) - math.pi * (rno ** 2 - (neck_id / 2) ** 2) * ln) < 1e-9, 'neck half-section revolves to the tube')
    ok(T.section_area(a['section']) > 0 and len(a['section']) == 8, 'can half-section is one closed loop')
    b = T.helm_can(neck_id, nw, ln, can_id, V, cw, neck_into=3.0)
    grow = math.pi * rno ** 2 * 3.0 / (math.pi * Rc ** 2)
    ok(abs(b['gas'] - V) < 1e-9 and abs(b['L_in'] - a['L_in'] - grow) < 1e-9 and abs(b['grow'] - grow) < 1e-9,
       'neck 3 cm into the can: the can grows %.3f cm and still holds %.1f cm^3' % (grow, b['gas']))
    ok(abs(b['z_in'] - (ln - 3.0)) < 1e-12, 'neck run in: the can sits 3 cm lower on the neck')
    for args, why in (((neck_id, nw, ln, can_id, V, cw, ln), 'run in by its whole length'),
                      ((neck_id, nw, 0.1, can_id, V, cw, 0.0), 'too short for the end plate'),
                      ((14.9, nw, ln, can_id, V, cw, 0.0), 'as wide as the can'),
                      ((neck_id, nw, 30.0, can_id, 500.0, cw, 29.0), 'reaching the far end'),
                      ((float('nan'), nw, ln, can_id, V, cw, 0.0), 'not filled in')):
        try:
            T.helm_can(*args)
            ok(False, 'refused: neck ' + why)
        except ValueError as e:
            ok(True, 'refused: neck %s (%s)' % (why, e))


def samples():
    lay = T.helm_can(5.08, 0.1651, 7.62, 15.24, 5000.0, 0.1519)
    start, d = (1.0, 2.0, 3.0), RT.vunit((0.3, -0.2, 1.0))
    pts, err = T.helm_samples(start, d, lay, step=0.5)
    a = d

    def on_surface(p):
        w = RT.vsub(p, start)
        z = RT.vdot(w, a)
        rho = math.sqrt(max(0.0, RT.vdot(w, w) - z * z))
        side = abs(rho - lay['R_out']) < 1e-6 and lay['z0'] - 1e-6 <= z <= lay['z1'] + 1e-6
        far = abs(z - lay['z1']) < 1e-6 and rho <= lay['R_out'] + 1e-6
        near = abs(z - lay['z0']) < 1e-6 and lay['r_hole'] - 1e-6 <= rho <= lay['R_out'] + 1e-6
        neck = abs(rho - lay['r_hole']) < 1e-6 and 1.5 - 1e-6 <= z <= lay['z0'] + 1e-6
        return side or far or near or neck
    ok(all(on_surface(p) for p in pts), '%d samples, all on the outside of the can or the neck' % len(pts))
    rnd = random.Random(7)
    e1, e2 = RT.perp_basis(a)
    worst = 0.0
    for _ in range(400):
        ph = rnd.uniform(0, 2 * math.pi)
        kind = rnd.random()
        if kind < 0.5:
            r, z = lay['R_out'], rnd.uniform(lay['z0'], lay['z1'])
        elif kind < 0.75:
            r, z = lay['R_out'] * math.sqrt(rnd.random()), lay['z1']
        else:
            r, z = rnd.uniform(lay['r_hole'], lay['R_out']), lay['z0']
        p = RT.vadd(start, RT.vadd(RT.vmul(a, z), RT.vadd(RT.vmul(e1, r * math.cos(ph)), RT.vmul(e2, r * math.sin(ph)))))
        worst = max(worst, min(RT.vdist(p, q) for q in pts))
    ok(worst <= err, 'no point on the can is further than %.3f cm from a sample (worst %.3f)' % (err, worst))


def pipe_points(axis_p, axis_d, R, x0, x1, step, rnd, noise, arc=(0.0, 360.0)):
    a = RT.vunit(axis_d)
    e1, e2 = RT.perp_basis(a)
    pts = []
    n_ang = int(2 * math.pi * R / step)
    nx = int((x1 - x0) / step)
    for i in range(nx + 1):
        x = x0 + (x1 - x0) * i / nx
        for k in range(n_ang):
            ang = 360.0 * k / n_ang
            if not (arc[0] <= ang <= arc[1]):
                continue
            ph = math.radians(ang)
            rr = R + rnd.gauss(0.0, noise)
            p = RT.vadd(axis_p, RT.vadd(RT.vmul(a, x), RT.vadd(RT.vmul(e1, rr * math.cos(ph)), RT.vmul(e2, rr * math.sin(ph)))))
            pts.append(p)
    return pts, e1, e2


def fits():
    rnd = random.Random(11)
    R = 3.81
    axis_p, axis_d = (10.0, -4.0, 2.0), RT.vunit((1.0, 0.35, 0.12))
    pts, e1, e2 = pipe_points(axis_p, axis_d, R, -15.0, 15.0, 0.3, rnd, 0.02)
    # a floor 2 cm below the pipe, in the scan too
    fl = RT.vsub(axis_p, RT.vmul(e2, R + 2.0))
    for i in range(-40, 41):
        for j in range(-40, 41):
            pts.append(RT.vadd(fl, RT.vadd(RT.vmul(axis_d, 0.4 * i), RT.vmul(e1, 0.4 * j))))
    surf = RT.vadd(axis_p, RT.vmul(e1, R))          # the tee on the e1 side
    start = RT.vadd(surf, RT.vmul(e1, 0.1))         # drawn 1 mm off the surface
    d = RT.vunit(RT.vadd(e1, RT.vmul(axis_d, math.tan(math.radians(3.0)))))   # and 3 deg off square
    t0 = __import__('time').time()
    f = T.fit_main_pipe(pts, start, d, 3.6)        # the page says 2.83 in OD; the scan shows 3 in
    print('  fit took %.1f s on %d points' % (__import__('time').time() - t0, f['n']))
    ang = math.degrees(RT.angle_between(f['d'], axis_d))
    ang = min(ang, 180.0 - ang)
    w = RT.vsub(f['p'], axis_p)
    miss = math.sqrt(max(0.0, RT.vdot(w, w) - RT.vdot(w, axis_d) ** 2))
    ok(f['ok'], 'fit: accepted (%s)' % (f['why'] or 'rms %.2f mm, %.0f %% of points, %.0f deg round' % (10 * f['rms'], 100 * f['frac'], f['cover'])))
    ok(ang < 0.5 and miss < 0.03 and abs(f['R'] - R) < 0.02, 'fit: axis within %.2f deg and %.2f mm, radius %.3f cm (true %.3f)' % (ang, 10 * miss, f['R'], R))
    ok(abs(f['off'] - 0.1) < 0.03, 'fit: the marker is %.2f mm off the surface (drawn 1 mm off)' % (10 * f['off']))

    patch, _e1, _e2 = pipe_points(axis_p, axis_d, R, -2.0, 2.0, 0.2, rnd, 0.01, arc=(0.0, 20.0))
    p0 = RT.vadd(axis_p, RT.vmul(_e1, R * 0 + R))
    g = T.fit_main_pipe(patch, p0, _e1, R)
    ok(not g['ok'] and ('round the pipe' in g['why'] or 'round pipe' in g['why']), 'fit: a small patch is refused (%s)' % g['why'])

    plane = [(x * 0.3, y * 0.3, 0.0) for x in range(-30, 31) for y in range(-30, 31)]
    h = T.fit_main_pipe(plane, (0.0, 0.0, 0.0), (0.0, 0.0, 1.0), R)
    ok(not h['ok'], 'fit: a flat floor is refused (%s)' % h['why'])

    few = T.fit_main_pipe(pts[:10], start, d, R)
    ok(not few['ok'] and 'too few' in few['why'], 'fit: too few points refused')


def scene_checks():
    m = TR.box_mesh((12.0, -10.0, -10.0), (22.0, 10.0, 10.0), 8)   # a block whose near face is x = 12
    sc = RT.Scene(cell=1.0)
    sc.add_mesh(*m)
    sc.build((-5, -30, -30), (60, 30, 30), 8)
    lay = T.helm_can(5.08, 0.1651, 7.62, 15.24, 5000.0, 0.1519)
    start, d = (0.0, 0.0, -lay['z1'] / 2.0), (0.0, 0.0, 1.0)      # can standing up, centred on x = 0
    pts, err = T.helm_samples(start, d, lay, step=0.4)
    gap, at = T.clearance(sc, pts, err)
    true_gap = 12.0 - lay['R_out']
    ok(gap is not None and gap <= true_gap + 1e-9 and gap >= true_gap - err - 0.01,
       'clearance to a block: %.3f cm, true %.3f (never more)' % (gap if gap is not None else -1, true_gap))
    far, _ = T.clearance(sc, [(-30.0, 0.0, 0.0)], 0.0, cap=5.0)
    ok(far is None, 'clearance: nothing within reach reads as clear')
    near = T.scene_points_near(sc, (12.0, 0.0, 0.0), 1.0)
    ok(near and all(RT.vdist(p, (12.0, 0.0, 0.0)) <= 1.0 + 1e-9 for p in near), 'scene points near a spot: %d, all within reach' % len(near))


tees()
holes()
cans()
samples()
fits()
scene_checks()
print('FAILS:', fails)
sys.exit(1 if fails else 0)
