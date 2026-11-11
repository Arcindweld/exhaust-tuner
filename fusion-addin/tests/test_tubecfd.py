"""tubecfd.py, a selected intake tube turned into the CFD generator's parametric design, offline:
  - the owner's reference tube (two 127 mm bends, 4 in bore): bends at the right places and angles, the right length,
  - plane_deg round trip: the design rebuilt with the generator's own path (intake_cfd.build_param_3d_surface's
    Path3D, from the design as intake_cfd.normalise reads it) lies on the tube, point by point and tangent by tangent,
    for the reference tube, 3-D S and U bends and 200 random tubes (compound bends, bends past 90, either mouth end),
  - the design is accepted by `python3 cfd/intake_cfd.py design.json out` (case generation only, no solve),
  - what is refused and how it is said, the mouth lip from a fillet, the Intake tab's inputs.
   python3 tests/test_tubecfd.py"""
import json
import math
import os
import random
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ADDIN = os.path.dirname(HERE)
CFD = os.path.join(os.path.dirname(ADDIN), 'cfd')
sys.path.insert(0, ADDIN)
sys.path.insert(0, CFD)
import tubecfd as TC     # noqa: E402
import intake_cfd as IC  # noqa: E402

FAILS = []


def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


add, sub, mul, dot, cross, unit, rot = TC._add, TC._sub, TC._mul, TC._dot, TC._cross, TC._unit, TC.rotate
dist = lambda a, b: TC._len(sub(a, b))


# ---------------------------------------------------------------- building exact tubes and sampling them as Fusion would
class Builder(object):
    """A tangent-continuous centreline from straights and arcs; .curves holds what cadtools samples from each curve."""
    def __init__(self, p, t):
        self.p, self.t, self.curves, self.exact = tuple(p), unit(t), [], []

    def line(self, L):
        a = self.p
        b = add(a, mul(self.t, L))
        self.curves.append({'pts': [add(a, mul(self.t, L * i / 8.0)) for i in range(9)], 'length': L})
        self.exact.append(('line', a, b, self.t, self.t))
        self.p = b

    def arc(self, R, deg, k):
        """Turn deg degrees on radius R toward the direction k (square to the tangent)."""
        k = unit(sub(k, mul(self.t, dot(k, self.t))))
        n = unit(cross(self.t, k))
        c = add(self.p, mul(k, R))
        th = math.radians(deg)
        pts = [add(c, rot(sub(self.p, c), n, th * i / 8.0)) for i in range(9)]
        t1 = rot(self.t, n, th)
        self.curves.append({'pts': pts, 'length': R * th})
        self.exact.append(('arc', self.p, pts[-1], self.t, t1))
        self.p, self.t = pts[-1], t1


def owner_tube():
    """The owner's reference CAI tube, made exactly tangent from its corner points (mm): the mouth, a straight, a 127 mm
    radius bend, a straight, a 127 mm bend, a straight."""
    I = (-673.7, -493.2, -233.9)
    A1, B1 = (-592.8, -456.0, -188.4), (-532.6, -441.9, -169.7)
    A2, B2 = (-128.7, -421.5, -126.6), (-10.5, -302.2, -99.3)
    O = (-5.7, -181.26, -83.14)
    d0, d1, d2 = unit(sub(A1, I)), unit(sub(A2, B1)), unit(sub(O, B2))
    b = Builder(I, d0)
    b.line(dist(I, A1))
    b.arc(127.0, math.degrees(math.acos(dot(d0, d1))), d1)
    b.line(dist(B1, A2))
    b.arc(127.0, math.degrees(math.acos(dot(d1, d2))), d2)
    b.line(dist(B2, O))
    return b, (I, A1, B1, A2, B2, O)


def generator_path(geometry):
    """The generator's own centreline for this geometry: normalise() then build_param_3d_surface()'s Path3D (m)."""
    d = IC.normalise({'geometry': geometry, 'operating_point': {'mass_flow_kg_s': 0.1}})
    g = d['geometry']
    g['profile'] = IC.inlet_profile(g)
    return IC.build_param_3d_surface(g, g['profile'], nphi=8)['path'], g


def round_trip(segs, geometry, info, mouth):
    """Largest distance (mm) and tangent angle (deg) between the generator's path and the tube, sampled every 2 mm."""
    path, g = generator_path(json.loads(json.dumps(geometry)))
    t0, n1 = info['frame']
    n2 = cross(t0, n1)
    L = TC.total(segs)
    worst_p, worst_t = 0.0, 0.0
    n = max(10, int(L / 2.0))
    for i in range(n + 1):
        s = L * i / n
        pw, tw = TC.point_at(segs, s)
        q = sub(pw, mouth)
        loc = (dot(q, t0), dot(q, n1), dot(q, n2))
        tl = (dot(tw, t0), dot(tw, n1), dot(tw, n2))
        pg, tg, _, _ = path.frame(s * 1e-3)
        worst_p = max(worst_p, dist(loc, mul(pg, 1e3)))
        worst_t = max(worst_t, math.degrees(math.acos(max(-1.0, min(1.0, dot(tl, tg))))))
    return worst_p, worst_t, g


# ---------------------------------------------------------------- 1. the owner's tube
b, corners = owner_tube()
geo, info, segs = TC.tube_design(b.curves, 92.61, 4.76)
bl = info['bends']
ok(len(segs) == 5 and [s['kind'] for s in segs] == ['line', 'arc', 'line', 'arc', 'line'], 'five curves read: straight, bend, straight, bend, straight')
ok(len(bl) == 2 and abs(bl[0]['angle_deg'] - 30) < 1.0 and abs(bl[0]['start_mm'] - 100) < 2.0,
   'bend 1: %.2f deg starting %.1f mm from the mouth (about 30 at about 100)' % (bl[0]['angle_deg'], bl[0]['start_mm']))
ok(abs(bl[1]['angle_deg'] - 84) < 1.0 and abs(bl[1]['start_mm'] - 572) < 3.0,
   'bend 2: %.2f deg starting %.1f mm (about 84 at about 572)' % (bl[1]['angle_deg'], bl[1]['start_mm']))
ok(abs(info['length_mm'] - 880.6) < 2.0, 'centreline %.1f mm long (about 880.6)' % info['length_mm'])
ok(all(abs(x['clr_mm'] - 127.0) < 1e-6 for x in bl) and abs(bl[0]['plane_deg']) < 1e-9,
   'both on 127 mm, bend 1 sets the frame (plane_deg 0), bend 2 at plane_deg %.2f' % bl[1]['plane_deg'])
ok(geo['inlet'] == {'type': 'plain', 'wall_thickness_mm': 4.76} and geo['mount'] == {'type': 'flange'} and geo['tube_diameter_mm'] == 92.61,
   'plain mouth with the real 4.76 mm wall, flush (flange) mount, 92.61 mm bore')
wp, wt, g = round_trip(segs, geo, info, corners[0])
ok(wp < 0.01 and wt < 0.01, 'round trip through the generator\'s own path: within %.4f mm and %.4f deg everywhere' % (wp, wt))
pe, te, _, _ = generator_path(geo)[0].frame(g['L'])
t0, n1 = info['frame']
end_loc = (dot(sub(corners[5], corners[0]), t0), dot(sub(corners[5], corners[0]), n1), dot(sub(corners[5], corners[0]), cross(t0, n1)))
ok(dist(mul(pe, 1e3), end_loc) < 1.0, 'the generator\'s tract end lands %.2f mm from the owner\'s end point (-5.7, -181.26, -83.14) (the corners are given to 0.1 mm)' % dist(mul(pe, 1e3), end_loc))

# the same tube read from the far end: the bends come in the other order, the length is the same
geo_r, info_r, segs_r = TC.tube_design(b.curves, 92.61, 4.76, mouth_at_end=True)
ok([round(x['angle_deg']) for x in info_r['bends']] == [84, 30] and abs(info_r['length_mm'] - info['length_mm']) < 1e-6,
   'read from the other end: 84 then 30 deg, the same %.1f mm' % info_r['length_mm'])
wp, wt, _ = round_trip(segs_r, geo_r, info_r, b.exact[-1][2])
ok(wp < 0.01 and wt < 0.01, 'and that round trip holds too (%.4f mm, %.4f deg)' % (wp, wt))

# the corner points as given (to 0.1 mm, so the straights are a hair off tangent): still read, the same within 0.1 deg
I, A1, B1, A2, B2, O = corners
raw = Builder(I, unit(sub(A1, I)))
raw.curves = []
for a_, b_ in ((I, A1), (B1, A2), (B2, O)):
    raw.curves.append({'pts': [add(a_, mul(sub(b_, a_), i / 8.0)) for i in range(9)], 'length': dist(a_, b_)})


def arc_between(a_, b_, ta):
    """The arc leaving a_ along ta that passes through b_ (its radius set by those)."""
    ab = sub(b_, a_)
    w = sub(ab, mul(ta, dot(ab, ta)))
    R = dot(ab, ab) / (2 * TC._len(w))
    k = unit(w)
    n = unit(cross(ta, k))
    c = add(a_, mul(k, R))
    th = math.atan2(dot(cross(sub(a_, c), sub(b_, c)), n), dot(sub(a_, c), sub(b_, c)))
    return {'pts': [add(c, rot(sub(a_, c), n, th * i / 8.0)) for i in range(9)], 'length': R * th}, R


a1c, R1 = arc_between(A1, B1, unit(sub(A1, I)))
a2c, R2 = arc_between(A2, B2, unit(sub(A2, B1)))
raw.curves.insert(1, a1c)
raw.curves.insert(3, a2c)
try:
    _g, info_raw, _s = TC.tube_design(raw.curves, 92.61, 4.76)
    ok(all(abs(x['angle_deg'] - y['angle_deg']) < 0.6 for x, y in zip(info_raw['bends'], bl)),
       'the corner points as given (arcs through them leaving each straight tangent: radii %.1f and %.1f mm): %s deg' % (R1, R2, ', '.join('%.2f' % x['angle_deg'] for x in info_raw['bends'])))
except TC.Refused as e:
    ok(False, 'the corner points as given are read: ' + str(e))

# ---------------------------------------------------------------- 2. the plane_deg convention, case by case
def two_bends(turn2):
    """100 straight, 90 deg toward +y, 150 straight, 90 deg toward turn2, 100 straight (tangent +x at the mouth)."""
    bb = Builder((0, 0, 0), (1, 0, 0))
    bb.line(100)
    bb.arc(100, 90, (0, 1, 0))
    bb.line(150)
    bb.arc(100, 90, turn2)
    bb.line(100)
    return bb


# bend 1 turns +x -> +y (to the left seen from +z); toward -x after it turns left again (a U), toward +x right (an S)
for turn2, want, what in (((-1, 0, 0), 0.0, 'a U (both bends the same way, in one plane)'), ((1, 0, 0), 180.0, 'an S (one plane, opposite ways)'),
                          ((0, 0, 1), None, 'out of the plane toward +z'), ((0, 0, -1), None, 'out of the plane toward -z')):
    bb = two_bends(turn2)
    g2, i2, s2 = TC.tube_design(bb.curves, 50.0, 1.6)
    ph = i2['bends'][1]['plane_deg']
    wp, wt, _ = round_trip(s2, g2, i2, (0, 0, 0))
    good = (abs(abs(ph) - 90.0) < 1e-6) if want is None else abs(ph - want) < 1e-6
    ok(good and wp < 0.01 and wt < 0.01, '%s: bend 2 plane_deg %.1f, rebuilt within %.4f mm' % (what, ph, wp))
up = TC.tube_design(two_bends((0, 0, 1)).curves, 50.0, 1.6)[1]['bends'][1]['plane_deg']
dn = TC.tube_design(two_bends((0, 0, -1)).curves, 50.0, 1.6)[1]['bends'][1]['plane_deg']
# after bend 1 the flow runs +y and the carried n1 (first bend's direction, +y at the mouth) has turned to -x; n2 = t x n1
# = +z, so a turn toward +z is +90 and toward -z is -90 (right-handed about the flow)
ok(abs(up - 90) < 1e-6 and abs(dn + 90) < 1e-6, 'sign: toward +z is +90, toward -z is -90 (right-handed about the flow, from the carried frame)')

# ---------------------------------------------------------------- 3. random tubes
rng = random.Random(20261110)
worst = (0.0, 0.0)
n_comp, n_done, n_mouth = 0, 0, 0
for trial in range(200):
    p0 = tuple(rng.uniform(-500, 500) for _ in range(3))
    t0 = unit(tuple(rng.gauss(0, 1) for _ in range(3)))
    bb = Builder(p0, t0)
    bb.line(rng.uniform(5, 150))
    for k in range(rng.randint(1, 5)):
        bb.arc(rng.uniform(40, 250), rng.uniform(5, 175), tuple(rng.gauss(0, 1) for _ in range(3)))
        if rng.random() < 0.75:
            bb.line(rng.uniform(1, 300))
        else:
            n_comp += 1
    if rng.random() < 0.5:
        bb.line(rng.uniform(1, 100))
    flip = rng.random() < 0.5
    try:
        g3, i3, s3 = TC.tube_design(bb.curves, 40.0, 1.5, mouth_at_end=flip)
    except TC.Refused as e:
        if 'right at the mouth' in str(e):
            n_mouth += 1
            continue
        ok(False, 'random tube %d read: %s' % (trial, e))
        continue
    m = bb.exact[-1][2] if flip else bb.exact[0][1]
    wp, wt, _ = round_trip(s3, g3, i3, m)
    worst = (max(worst[0], wp), max(worst[1], wt))
    n_done += 1
ok(n_done >= 150 and worst[0] < 0.02 and worst[1] < 0.01, '%d random tubes (1 to 5 bends of 5 to 175 deg, %d back-to-back compound bends, either end the mouth; '
   '%d that start in a bend refused): the generator\'s path within %.4f mm and %.4f deg of each' % (n_done, n_comp, n_mouth, worst[0], worst[1]))

# ---------------------------------------------------------------- 4. the generator takes the design
tmp = tempfile.mkdtemp()
design = {'name': 'fusion_owner_cai', 'geometry': geo,
          'operating_point': {'engine': {'displacement_cc': 6162.0, 'rpm': 6600, 've': 0.92, 'strokes': 4, 'cylinders': 8, 'cylinders_fed': 8, 'flow_factor': 1.0}},
          'ambient': {'p_pa': 101325, 'T_c': 25.0}, 'mesh': {'level': 'medium'}}
dj = os.path.join(tmp, 'design.json')
with open(dj, 'w') as f:
    json.dump(design, f, indent=1)
out = os.path.join(tmp, 'case')
pr = subprocess.run([sys.executable, os.path.join(CFD, 'intake_cfd.py'), dj, out], capture_output=True, text=True, timeout=600)
ok(pr.returncode == 0 and os.path.isfile(os.path.join(out, 'system', 'snappyHexMeshDict')) and os.path.isfile(os.path.join(out, 'Allrun')),
   'python3 cfd/intake_cfd.py design.json case writes the 3-D (snappyHexMesh) case: exit %d %s' % (pr.returncode, (pr.stdout + pr.stderr).strip().splitlines()[-1:] if pr.returncode else ''))
try:
    summ = json.load(open(os.path.join(out, 'generator_summary.json')))
except Exception:
    summ = {}
ok(bool(summ), 'its generator_summary.json: solver %s, %s' % (summ.get('solver'), summ.get('mesh') or summ.get('cells')))
# a straight tube: a 2-D (axisymmetric sector) case
bs = Builder((0, 0, 0), (0, 0, 1))
bs.line(600.0)
gs, is_, ss = TC.tube_design(bs.curves, 76.2, 1.65)
ok('bend' not in gs and abs(is_['length_mm'] - 600) < 1e-9, 'a straight 600 mm tube: no bends')
design2 = dict(design, name='fusion_straight', geometry=gs, mesh={'level': 'coarse'})
with open(dj, 'w') as f:
    json.dump(design2, f)
out2 = os.path.join(tmp, 'case2')
pr = subprocess.run([sys.executable, os.path.join(CFD, 'intake_cfd.py'), dj, out2], capture_output=True, text=True, timeout=600)
ok(pr.returncode == 0 and os.path.isfile(os.path.join(out2, 'system', 'blockMeshDict')) and not os.path.isfile(os.path.join(out2, 'system', 'snappyHexMeshDict')),
   'and the generator writes it as a 2-D sector case (blockMesh only): exit %d' % pr.returncode)
# a lip radius
geo_l, info_l, _ = TC.tube_design(b.curves, 92.61, 4.76, lip_mm=3.5)
design3 = dict(design, name='fusion_lip', geometry=geo_l)
with open(dj, 'w') as f:
    json.dump(design3, f)
pr = subprocess.run([sys.executable, os.path.join(CFD, 'intake_cfd.py'), dj, os.path.join(tmp, 'case3')], capture_output=True, text=True, timeout=600)
ok(pr.returncode == 0 and geo_l['inlet'] == {'type': 'radius', 'lip_radius_mm': 3.5}, 'with a 3.5 mm lip fillet: a radius inlet, accepted (exit %d)' % pr.returncode)
subprocess.run(['rm', '-rf', tmp])

# ---------------------------------------------------------------- 5. refusals, in plain words
def refused(fn, want, what):
    try:
        fn()
        ok(False, what + ' is refused')
    except TC.Refused as e:
        ok(want in str(e), what + ': "' + str(e) + '"')


spl = Builder((0, 0, 0), (1, 0, 0))
spl.line(100)
spl.curves.append({'pts': [(100 + 10 * i, 3.0 * math.sin(i), 0.0) for i in range(9)], 'length': 82.0})
refused(lambda: TC.tube_design(spl.curves, 50, 1.6), 'neither a straight line nor a circular arc', 'a spline in the centreline')
kink = [{'pts': [(10.0 * i, 0, 0) for i in range(9)], 'length': 80.0}, {'pts': [(80.0, 10.0 * i, 0) for i in range(9)], 'length': 80.0}]
refused(lambda: TC.tube_design(kink, 50, 1.6), 'corner', 'a mitre (two straights at 90 deg)')
gap = [{'pts': [(10.0 * i, 0, 0) for i in range(9)], 'length': 80.0}, {'pts': [(90.0 + 10.0 * i, 0, 0) for i in range(9)], 'length': 80.0}]
refused(lambda: TC.tube_design(gap, 50, 1.6), 'gap', 'curves that do not meet')
tight = Builder((0, 0, 0), (1, 0, 0))
tight.line(100)
tight.arc(25.0, 90, (0, 1, 0))
tight.line(100)
refused(lambda: TC.tube_design(tight.curves, 50, 1.6), 'under 0.6 times', 'a 25 mm radius bend on a 50 mm bore')
atmouth = Builder((0, 0, 0), (1, 0, 0))
atmouth.arc(100.0, 45, (0, 1, 0))
atmouth.line(200)
refused(lambda: TC.tube_design(atmouth.curves, 50, 1.6), 'starts in a bend right at the mouth', 'a bend right at the mouth')
short = Builder((0, 0, 0), (1, 0, 0))
short.line(30)
refused(lambda: TC.tube_design(short.curves, 50, 1.6), 'too short', 'a 30 mm stub of 50 mm bore')

# ---------------------------------------------------------------- 6. trim, merge, the lip, the Intake tab
segs6 = TC.join([TC.classify(c['pts'], c['length']) for c in b.curves])
tr = TC.trim(segs6, 20.0, TC.total(segs6) - 30.0)
ok(abs(TC.total(tr) - (TC.total(segs6) - 50.0)) < 1e-6 and dist(tr[0]['a'], TC.point_at(segs6, 20.0)[0]) < 1e-6,
   'trimmed to the part the body covers: 20 mm off the start and 30 off the end')
halves = Builder((0, 0, 0), (1, 0, 0))
halves.line(50)
halves.line(50)
halves.arc(100, 40, (0, 1, 0))
halves.arc(100, 50, (0, 1, 0))
halves.line(80)
gh, ih, sh = TC.tube_design(halves.curves, 50, 1.6)
ok(len(sh) == 3 and len(ih['bends']) == 1 and abs(ih['bends'][0]['angle_deg'] - 90) < 1e-6,
   'a straight in two pieces and a bend in two arcs on one circle come out as one straight and one 90 deg bend')
tori = [((0.0, 0.0, 3.5), (0, 0, 1), 46.305 + 3.5, 3.5), ((0.0, 0.0, 300.0), (0, 0, 1), 127.0, 50.8)]
ok(TC.mouth_lip(tori, (0, 0, 0), (0, 0, 1), 46.305) == 3.5 and TC.mouth_lip(tori[1:], (0, 0, 0), (0, 0, 1), 46.305) is None,
   'a 3.5 mm fillet on the mouth\'s inside edge is read as the lip; a bend\'s torus is not')
tf = TC.tab_fill(info)
ok(tf['lt_mm'] == round(info['length_mm'], 2) and tf['dt_mm'] == 92.61 and tf['bend_angles'] == [round(bl[0]['angle_deg'], 1), round(bl[1]['angle_deg'], 1)]
   and tf['bend_r_mm'] == 127.0 and len(tf['bend_starts_mm']) == 2 and tf['mouth'] == 'plain',
   'the Intake tab gets %s mm, %s bore, bends %s at %s mm, radius %s' % (tf['lt_mm'], tf['dt_mm'], tf['bend_angles'], tf['bend_starts_mm'], tf['bend_r_mm']))
txt = TC.describe(info, 'INTAKE')
ok('92.61 mm (3.6461 in)' in txt and 'in)' in txt and 'clocked' in txt, 'the description gives mm and inches: ' + txt)

# ---------------------------------------------------------------- 7. the bore probed: cones, reducers, mouths, beads
def solid_of(segs, bore, outer):
    """inside(p) for a tube round the exact path segs (mm): solid between bore(s) and outer(s), s along the path from
    its start; nothing past either end. A ray square to the path at s stays at s, as in a real tube."""
    def near(p):
        best, at = None, 0.0
        for k, g in enumerate(segs):
            if g['kind'] == 'line':
                u = dot(sub(p, g['a']), g['t0'])
                if (k == 0 and u < 0) or (k == len(segs) - 1 and u > g['length']):
                    cand = (1e9, None)
                else:
                    u = max(0.0, min(g['length'], u))
                    cand = (dist(p, add(g['a'], mul(g['t0'], u))), at + u)
            else:
                v = sub(p, g['c'])
                vp = sub(v, mul(g['n'], dot(v, g['n'])))
                ra = sub(g['a'], g['c'])
                th = g['length'] / g['R']
                an = math.atan2(dot(cross(ra, vp), g['n']), dot(ra, vp)) % (2 * math.pi)
                an = an if an <= th else (th if an - th < 2 * math.pi - an else 0.0)
                cand = (dist(p, add(g['c'], rot(ra, g['n'], an))), at + g['R'] * an)
            if best is None or cand[0] < best[0]:
                best = cand
            at += g['length']
        return best
    count = [0]

    def inside(p):
        count[0] += 1
        d, s = near(p)
        return s is not None and bore(s) < d < outer(s)
    inside.count = count
    return inside


def segs_of(b):
    return TC.join([TC.classify(c['pts'], c['length']) for c in b.curves])


def read(body, bore, outer, path=None, at_end=False, lip=None, wall=None):
    """probe_bore + tube_from_probe, as act_cfd_tube does, on the analytic tube."""
    inside = solid_of(body, bore, outer)
    path = path or body
    L = TC.total(path)
    r_in = bore(0.5 * TC.total(body))
    pr = TC.probe_bore(path, inside, r_in, wall if wall is not None else outer(0.5 * TC.total(body)) - r_in)
    g, i, s = TC.tube_from_probe(pr, 2 * r_in, wall if wall is not None else outer(0.5 * TC.total(body)) - r_in, at_end, lip)
    return g, i, s, pr, inside.count[0]


def generate(geometry, name, three_d):
    """python3 cfd/intake_cfd.py design.json case (case generation only): (accepted, the generator's last words)."""
    tmp = tempfile.mkdtemp()
    dj = os.path.join(tmp, 'design.json')
    with open(dj, 'w') as f:
        json.dump(dict(design, name=name, geometry=geometry, mesh={'level': 'coarse'}), f)
    out = os.path.join(tmp, 'case')
    pr = subprocess.run([sys.executable, os.path.join(CFD, 'intake_cfd.py'), dj, out], capture_output=True, text=True, timeout=600)
    good = pr.returncode == 0 and os.path.isfile(os.path.join(out, 'system', 'snappyHexMeshDict' if three_d else 'blockMeshDict'))
    if good and not three_d:
        good = not os.path.isfile(os.path.join(out, 'system', 'snappyHexMeshDict'))
    planes = []
    try:
        planes = [p['name'] for p in json.load(open(os.path.join(out, 'case_info.json'))).get('planes', [])]
    except Exception:
        pass
    subprocess.run(['rm', '-rf', tmp])
    return good, (pr.stdout + pr.stderr).strip().splitlines()[-1:] if pr.returncode else planes


def radius_trip(geometry, bore, s_to):
    """Largest difference (mm) between the generator's own bore (intake_cfd.inlet_profile over the inlet piece,
    tube_radius after it, as build_param_3d_surface takes them) and the real bore, every 0.25 mm from the mouth to s_to."""
    d = IC.normalise({'geometry': json.loads(json.dumps(geometry)), 'operating_point': {'mass_flow_kg_s': 0.1}})
    g = d['geometry']
    prof = IC.inlet_profile(g)
    xs = [p[0] * 1e3 for p in prof.inner]
    worst, at = 0.0, 0.0
    s = 0.05
    while s < s_to - 0.05:
        if s <= prof.length * 1e3:
            k = max(i for i in range(len(xs) - 1) if xs[i] <= s) if s >= xs[0] else 0
            w = (s - xs[k]) / (xs[k + 1] - xs[k]) if xs[k + 1] > xs[k] else 0.0
            rg = (prof.inner[k][1] * (1 - w) + prof.inner[k + 1][1] * w) * 1e3
        else:
            rg = IC.tube_radius(g, s * 1e-3) * 1e3
        if abs(rg - bore(s)) > worst:
            worst, at = abs(rg - bore(s)), s
        s += 0.25
    return worst, at


R0, W0 = 92.61 / 2, 4.76
plain_out = lambda s: R0 + W0


# (a) the owner's tube with a 60 mm cone, 92.61 -> 105 mm, at the engine end, past the end of its Pipe path
ba, _c = owner_tube()
L_own = TC.total(segs_of(ba))
ba.line(60.0)
body_a = segs_of(ba)
path_a = TC.trim(body_a, 0.0, L_own)
cone_r = lambda s: R0 + (52.5 - R0) * min(1.0, max(0.0, (s - L_own) / 60.0))
ga, ia, sa_, pra, na = read(body_a, cone_r, lambda s: cone_r(s) + W0, path_a)
dc = ga.get('diameter_change') or {}
ok(dc.get('to_diameter_mm') == 105.0 and abs(dc.get('start_mm', 0) - L_own) < 0.05 and abs(dc.get('cone_half_angle_deg', 0) - math.degrees(math.atan(6.195 / 60.0))) < 0.02,
   '(a) the owner\'s tube + a 60 mm cone past its Pipe path: diameter_change to %s mm from %.2f mm (path ends at %.2f), %.3f deg a side (%d probes)'
   % (dc.get('to_diameter_mm'), dc.get('start_mm', 0), L_own, dc.get('cone_half_angle_deg', 0), na))
Lc_a = 6.195 / math.tan(math.radians(dc.get('cone_half_angle_deg', 1)))
ok(abs(ga['tube_length_mm'] - (L_own + 60.0 + 0.5 * 92.61)) < 0.06 and abs(ga['planes_mm']['throttle_face'] - (L_own + 60)) < 0.06
   and ga['planes_mm']['tube_end'] == dc.get('start_mm') and ga['tube_diameter_mm'] == 92.61 and ga['inlet']['type'] == 'plain',
   '(a) the tract end half a tube bore past the throttle face (%.2f mm, as the Intake tab\'s own case puts it); planes tube_end %.2f, throttle_face %.2f'
   % (ga['tube_length_mm'], ga['planes_mm']['tube_end'], ga['planes_mm']['throttle_face']))
ok([round(b['angle_deg'], 1) for b in ga['bend']] == [29.5, 84.1] and all(abs(x['plane_deg'] - y['plane_deg']) < 0.01 for x, y in zip(ga['bend'], geo['bend'])),
   '(a) its bends as read without the cone')
wp, wt, _ = round_trip(sa_, ga, ia, corners[0])
wr, at = radius_trip(ga, cone_r, L_own + 60.0)
ok(wp < 0.01 and wt < 0.01 and wr < 0.02, '(a) round trip through the generator: centreline within %.4f mm and %.4f deg, bore within %.4f mm (worst at %.1f mm)' % (wp, wt, wr, at))
fa = TC.tab_fill(ia)
ok(fa['tb_mm'] == 105.0 and fa['lt_mm'] == round(ga['tube_length_mm'], 2) and fa['dt_mm'] == 92.61 and fa['mouth'] == 'plain',
   '(a) the Intake tab gets the throttle bore %s mm and the case\'s length %s mm' % (fa['tb_mm'], fa['lt_mm']))
txt = TC.describe(ia, 'CAI')
ok('105.00 mm (4.1339 in)' in txt and 'throttle face' in txt and '60.0 mm (2.362 in) long' in txt, '(a) said in mm and inches: ' + txt[-330:])
good, last = generate(ga, 'owner_cone', True)
ok(good and 'tube_end' in last and 'throttle_face' in last and 'tract_end' in last, '(a) the generator writes the 3-D case with planes %s' % last)
# the same tube with the air entering at the throttle end: the cone is then a straight flare at the mouth (square rim)
gr, ir, _s = TC.tube_from_probe(pra, 92.61, W0, True)
ok(gr['inlet']['type'] == 'taper' and abs(gr['inlet']['entry_diameter_mm'] - 105.0) < 0.1 and abs(gr['inlet']['wall_half_angle_deg'] - 5.895) < 0.02
   and 'square' in ' '.join(ir['notes']) and 'diameter_change' not in gr,
   '(a) read with the air entering at the throttle end: a straight flare mouth, %s; %s' % (gr['inlet'], ' '.join(ir['notes'])))
# the cone inside the Pipe path (one body, its path the whole length): the same design
ga2, ia2, _s, _p, _n = read(body_a, cone_r, lambda s: cone_r(s) + W0)
ok(ga2 == ga, '(a) with the Pipe path running the whole length (cone included): the same design')
# and with a 3.5 mm lip at the mouth
cone_lip = lambda s: (R0 + 3.5 - math.sqrt(max(0.0, 3.5 ** 2 - (3.5 - s) ** 2))) if s < 3.5 else cone_r(s)
gl, il, sl, _p, _n = read(body_a, cone_lip, lambda s: cone_r(s) + W0, path_a)
ok(gl['inlet']['type'] == 'radius' and abs(gl['inlet']['lip_radius_mm'] - 3.5) < 0.05 and gl['diameter_change'] == ga['diameter_change'],
   '(a)+(d) the cone with a 3.5 mm lip probed (no torus face): lip %.3f mm, the same cone' % gl['inlet']['lip_radius_mm'])
gl2 = read(body_a, cone_lip, lambda s: cone_r(s) + W0, path_a, lip=3.5)[0]
ok(gl2['inlet'] == {'type': 'radius', 'lip_radius_mm': 3.5}, '(d) with the fillet\'s torus face read (mouth_lip): exactly 3.5 mm')
wr, at = radius_trip(gl2, cone_lip, L_own + 60.0)
good, last = generate(gl2, 'owner_cone_lip', True)
ok(wr < 0.02 and good, '(d) its bore round trip within %.4f mm, and the generator takes it (%s)' % (wr, last))

# (b) a mid-run reducer, 92.61 -> 76.2 mm over 40 mm on the straight between two bends
bb_ = Builder((10, 20, 30), unit((1, 1, 0)))
bb_.line(150)
bb_.arc(150, 90, (0, 0, 1))
bb_.line(300)
bb_.arc(150, 45, (1, -1, 0))
bb_.line(100)
body_b = segs_of(bb_)
s_red = 150 + 150 * math.pi / 2 + 100
red = lambda s: R0 + (38.1 - R0) * min(1.0, max(0.0, (s - s_red) / 40.0))
gb_, ib, sb_, prb, nb_ = read(body_b, red, lambda s: red(s) + 1.65, wall=1.65)
dcb = gb_.get('diameter_change') or {}
ok(dcb.get('to_diameter_mm') == 76.2 and abs(dcb.get('start_mm', 0) - s_red) < 0.05 and abs(gb_['tube_length_mm'] - TC.total(body_b)) < 0.01
   and gb_['planes_mm'] == {'reducer_in': dcb['start_mm'], 'reducer_out': round(dcb['start_mm'] + 8.205 / math.tan(math.radians(dcb['cone_half_angle_deg'])), 4)},
   '(b) a reducer mid-run: to %s mm at %.2f mm (true %.2f), the tract end at the real end, planes %s' % (dcb.get('to_diameter_mm'), dcb.get('start_mm', 0), s_red, gb_.get('planes_mm')))
wp, wt, _ = round_trip(sb_, gb_, ib, (10, 20, 30))
wr, at = radius_trip(gb_, red, TC.total(body_b))
fb = TC.tab_fill(ib)
ok(wp < 0.01 and wt < 0.01 and wr < 0.02 and fb['tb_mm'] is None and fb['reducer']['to_mm'] == 76.2,
   '(b) round trip: centreline %.4f mm, %.4f deg, bore %.4f mm; the tab gets no throttle bore from it (a reducer, not the throttle cone)' % (wp, wt, wr))
good, last = generate(gb_, 'reducer', True)
ok(good and 'reducer_in' in last, '(b) the generator takes it: %s' % last)
# an S-shaped reducer: the straight cone of the same length and end diameters, the difference stated
sred = lambda s: R0 + (38.1 - R0) * (0.5 - 0.5 * math.cos(math.pi * min(1.0, max(0.0, (s - s_red) / 40.0))))
gs_, is2, ss2, _p, _n = read(body_b, sred, lambda s: sred(s) + 1.65, wall=1.65)
dcs = gs_['diameter_change']
Ls = 8.205 / math.tan(math.radians(dcs['cone_half_angle_deg']))
true_dev = max(abs(sred(s) - (R0 + (38.1 - R0) * min(1.0, max(0.0, (s - dcs['start_mm']) / Ls)))) for s in [s_red - 5 + 0.1 * k for k in range(500)])
note = ' '.join(is2['notes'])
said = re.search(r'up to ([0-9.]+) mm', note)
ok(abs(dcs['start_mm'] - s_red) < 1.1 and abs(Ls - 40.0) < 2.2 and dcs['to_diameter_mm'] == 76.2 and 'not a straight cone' in note
   and said is not None and abs(float(said.group(1)) - true_dev) < 0.05,
   '(b) an S-shaped reducer: modelled as a %.1f mm straight cone from %.1f mm (true 40 from %.1f); "%s" (true deviation %.2f mm)' % (Ls, dcs['start_mm'], s_red, note, true_dev))
good, last = generate(gs_, 'reducer_s', True)
ok(good, '(b) the generator takes it: %s' % last)

# (c) a bellmouth: an elliptical flare 40 mm long from a 1.5 D entry, ahead of the Pipe path, on a straight 400 mm tube
bc = Builder((0, 0, 0), (0, 1, 0))
bc.line(440.0)
body_c = segs_of(bc)
path_c = TC.trim(body_c, 40.0, 440.0)
hc_ = 0.25 * 92.61
ell = lambda s: (R0 + hc_ - hc_ * math.sqrt(max(0.0, 1 - ((40.0 - s) / 40.0) ** 2))) if s < 40 else R0
gc, ic, sc_, prc, nc = read(body_c, ell, lambda s: R0 + hc_ + 3.0, path_c)
inl = gc['inlet']
ok(inl['type'] == 'ellipse' and abs(inl['length_mm'] - 40) < 0.5 and abs(inl['entry_diameter_mm'] - 1.5 * 92.61) < 0.5 and inl['exit_diameter_mm'] == 92.61
   and abs(gc['tube_length_mm'] - 440) < 0.01 and 'diameter_change' not in gc,
   '(c) an elliptical bellmouth past the path start: ellipse %.2f mm long from %.2f mm entry (true 40, %.2f), the tube %.2f mm' % (inl['length_mm'], inl['entry_diameter_mm'], 1.5 * 92.61, gc['tube_length_mm']))
wr, at = radius_trip(gc, ell, 440.0)
good, last = generate(gc, 'bellmouth', False)
ok(wr < 0.25 and good and TC.tab_fill(ic)['mouth'] == 'ellipse', '(c) bore round trip within %.3f mm (worst at %.1f mm); the generator writes it as a 2-D case; the tab gets "Elliptical bellmouth"' % (wr, at))
# a straight flare, 10 deg a side from a 120 mm entry, with a 4 mm lip radius on its rim
tri = TC.mouth_model('taper', R0, alpha=10.0, rl=4.0, ri=60.0)
tap_r, tap_len = tri
gt, it, st_, _p, _n = read(body_c, tap_r, lambda s: 66.0, path_c)
it_ = gt['inlet']
wr, at = radius_trip(gt, tap_r, 440.0)
good, last = generate(gt, 'flare', False)
ok(it_['type'] == 'taper' and abs(it_['wall_half_angle_deg'] - 10) < 0.1 and abs(it_['entry_diameter_mm'] - 120) < 0.3 and abs(it_['lip_radius_mm'] - 4) < 0.4 and wr < 0.1 and good,
   '(c) a straight 10 deg flare with a 4 mm lip: taper %.2f deg, entry %.2f mm, lip %.2f mm; bore round trip %.3f mm; the generator takes it' % (it_['wall_half_angle_deg'], it_['entry_diameter_mm'], it_['lip_radius_mm'], wr))

# (e) beads, hose barbs and a filter cuff on the outside: the same design as the plain tube
beads = lambda s: R0 + W0 + (3.0 if (s % 200.0) < 6.0 else 0.0) + (2.0 * ((s - 820) % 8.0) / 8.0 if s > 820 else 0.0) + (6.0 if s < 25 else 0.0)
body_o = segs_of(owner_tube()[0])
g_plain = read(body_o, lambda s: R0, plain_out)[0]
g_bead, i_bead, _s, _p, n_bead = read(body_o, lambda s: R0, beads)
ok(g_bead == g_plain and g_plain == geo, '(e) beads every 200 mm, hose barbs over the last 60 mm and a 25 mm filter cuff on the outside: the same design as the plain tube (and as the constant-bore read)')
ok(n_bead < 20000, '(e) %d point probes for the 880 mm tube' % n_bead)


# (f) refusals
def refused_read(want, what, *a, **k):
    try:
        read(*a, **k)
        ok(False, what + ' is refused')
    except TC.Refused as e:
        ok(want in str(e) and 'mm (' in str(e), what + ': "' + str(e) + '"')


two = lambda s: (R0 + (52.5 - R0) * min(1.0, (s - L_own) / 60.0)) if s > L_own else (40.0 if s > 330 else (R0 - (R0 - 40.0) * (s - 300) / 30.0 if s > 300 else R0))
refused_read('changes size 2 times', '(f) a reducer mid-run and a cone at the end (two diameter changes)', body_a, two, lambda s: two(s) + W0, path_a)
inb = lambda s: R0 + 0.02 * max(0.0, s - 620)
refused_read('inside bend 2', '(f) a cone inside a bend', body_o, inb, lambda s: inb(s) + W0)
ring = lambda s: R0 - (2.0 if 300 < s < 306 else 0.0)
refused_read('narrows to', '(f) an inside ring (a bore that narrows and opens again)', body_o, ring, plain_out)
restr = lambda s: R0 - 3.0 if s < 4 else R0
refused_read('narrower than the tube', '(f) a restrictor ring at the mouth', body_o, restr, plain_out)
cbore = lambda s: R0 + 5.0 if s < 20 else R0
refused_read('steps down', '(f) a counterbore at the mouth (a step down 20 mm in)', body_c, cbore, lambda s: R0 + 9.0, path_c)
cb6 = lambda s: R0 + 8.0 if s < 6 else R0
refused_read('no model for', '(f) a 6 mm deep counterbore at the mouth (a shape the case has no model for)', body_c, cb6, lambda s: R0 + 12.0, path_c)
horn = lambda s: R0 + 8.0 * (1 - s / 30.0) ** 3 if s < 30 else R0
gh_, ih_, _s, _p, _n = read(body_c, horn, lambda s: R0 + 12.0, path_c)
said = re.search(r'up to ([0-9.]+) mm', ' '.join(ih_['notes']))
wr, at = radius_trip(gh_, horn, 440.0)
ok(said is not None and abs(float(said.group(1)) - wr) < 0.05 and generate(gh_, 'horn', False)[0],
   '(f) a cubic horn at the mouth: the nearest model, the difference stated (%.2f mm by the round trip): %s' % (wr, ' '.join(ih_['notes'])))
# a tiny step (two tubes of nearly one bore) is let go, with a note; a sudden step up at the end is a 60 deg cone, with a note
tiny = lambda s: R0 + (0.15 if s > 300 else 0.0)
gtn, itn, _s, _p, _n = read(body_c, tiny, lambda s: R0 + 6.0, path_c)
ok('diameter_change' not in gtn and 'one bore' in ' '.join(itn['notes']), '(f) a 0.3 mm step in the bore: one bore, with a note: ' + ' '.join(itn['notes']))
stepup = lambda s: R0 + (6.195 if s > 420 else 0.0)
gsu, isu, _s, _p, _n = read(body_c, stepup, lambda s: stepup(s) + 4.0, path_c)
ok(abs(gsu['diameter_change']['cone_half_angle_deg'] - 60.0) < 1e-6 and '60 degree cone' in ' '.join(isu['notes']) and generate(gsu, 'stepup', False)[0],
   '(f) a sudden step up to 105 mm 20 mm before the end: a 60 deg cone, with a note: ' + ' '.join(isu['notes']))
# an oval bore (6 % past 500 mm)
e_ov = unit(cross(body_o[-1]['t1'], (0.0, 0.0, 1.0)))
try:
    def oval(p):
        s = TC.nearest_s(body_o, p, 20.0)
        q, t = TC.point_at(body_o, s)
        rv = sub(p, q)
        if s > 500:
            x = dot(rv, e_ov)
            rv = add(sub(rv, mul(e_ov, x)), mul(e_ov, x / 1.06))
        d = TC._len(rv)
        return 0 < s < TC.total(body_o) and R0 < d < R0 + W0
    pr_ov = TC.probe_bore(body_o, oval, R0, W0, step=20.0)
    TC.tube_from_probe(pr_ov, 92.61, W0)
    ok(False, '(f) an oval bore is refused')
except TC.Refused as e:
    ok('not round' in str(e), '(f) an oval bore: "%s"' % e)

print('test_tubecfd: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
