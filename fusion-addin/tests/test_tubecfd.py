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

print('test_tubecfd: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
