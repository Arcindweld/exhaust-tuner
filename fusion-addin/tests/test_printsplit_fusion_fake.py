"""cadtools' print-split glue (the _ps_* helpers act_print_split runs before and around the Fusion features) against a
small stand-in for adsk that follows the API reference's return types: curve evaluators return (ok, value) tuples,
SurfaceEvaluator.parametricRange returns a BoundingBox2D (not a tuple), lengths are cm. It cannot show Fusion accepts
the feature calls (tests/fusion_live_printsplit.py does that), but it runs the real code that turns Fusion's answers
into the planner's input and the planner's output into STLs:
  - chaining and sampling the path (curves shuffled, one reversed, the bend as a NURBS) into stations in mm,
  - the bore and outside picked from the cylinders when embossed lettering adds a bigger one, and by scanning,
  - keep-outs from a lettering face and an end lip; none from plain wall or the end face (its off-face grid points skipped),
  - a picked body inside a moved occurrence refused, an unmoved one used,
  - the cut plane placed by proportion and re-placed when the path runs the other way,
  - the lap edges found for the chamfers, the extrude direction toward the receiver,
  - the STL stood on its end: on the bed, not mirrored, and the box the planner checked against the bed.
   python3 tests/test_printsplit_fusion_fake.py"""
import math
import os
import struct
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

FAILS = []


def ok(cond, msg):
    print(('PASS ' if cond else 'FAIL ') + msg)
    if not cond:
        FAILS.append(msg)


# ---------------------------------------------------------------- the stand-in (only what the helpers touch)
adsk = types.ModuleType('adsk')
core = types.ModuleType('adsk.core')
fusion = types.ModuleType('adsk.fusion')
adsk.core, adsk.fusion = core, fusion
for n in ('HTMLEventHandler', 'CommandCreatedEventHandler', 'CommandEventHandler', 'ApplicationEventHandler'):
    setattr(core, n, object)
sys.modules.update({'adsk': adsk, 'adsk.core': core, 'adsk.fusion': fusion})


class P3(object):
    def __init__(self, x, y, z=0.0):
        self.x, self.y, self.z = float(x), float(y), float(z)

    @staticmethod
    def create(x=0.0, y=0.0, z=0.0):
        return P3(x, y, z)


class P2(object):
    def __init__(self, x, y):
        self.x, self.y = float(x), float(y)

    @staticmethod
    def create(x=0.0, y=0.0):
        return P2(x, y)


class BoundingBox2D(object):
    """Returned bare by parametricRange (API reference: 'Return Value Type BoundingBox2D'); not iterable."""
    def __init__(self, a, b):
        self.minPoint, self.maxPoint = a, b


class VI(object):
    @staticmethod
    def createByReal(v):
        return ('real', v)


core.Point3D, core.Vector3D, core.Point2D, core.ValueInput = P3, P3, P2, VI
core.SurfaceTypes = types.SimpleNamespace(CylinderSurfaceType='cyl', PlaneSurfaceType='plane', TorusSurfaceType='torus')
core.Curve3DTypes = types.SimpleNamespace(Circle3DCurveType='circle', Arc3DCurveType='arc', Line3DCurveType='line')
INSIDE, OUTSIDE = 'in', 'out'
fusion.PointContainment = types.SimpleNamespace(PointInsidePointContainment=INSIDE, PointOutsidePointContainment=OUTSIDE)
fusion.ChainedCurveOptions = types.SimpleNamespace(noChainedCurves='nochain', connectedChainedCurves='chain')
fusion.PathDistanceTypes = types.SimpleNamespace(ProportionalPathDistanceType='prop', PhysicalPathDistanceType='phys')
fusion.Path = types.SimpleNamespace(create=lambda ent, opt: ('path', ent))
fusion.TriangleMeshQualityOptions = types.SimpleNamespace(HighQualityTriangleMesh='high')

import cadtools as CT     # noqa: E402
import printsplit as PS   # noqa: E402

add = lambda a, b: tuple(x + y for x, y in zip(a, b))
sub = lambda a, b: tuple(x - y for x, y in zip(a, b))
mul = lambda a, s: tuple(x * s for x in a)
dot = lambda a, b: sum(x * y for x, y in zip(a, b))


class CurveEval(object):
    """A curve's evaluator: f(param) -> point (cm), length per unit parameter (uniform), param range."""
    def __init__(self, f, t0, t1, speed):
        self.f, self.t0, self.t1, self.speed = f, t0, t1, speed

    def getParameterExtents(self):
        return True, self.t0, self.t1

    def getPointAtParameter(self, t):
        return True, P3(*self.f(t))

    def getLengthAtParameter(self, a, b):
        return True, abs(b - a) * self.speed

    def getParameterAtLength(self, a, length):
        return True, a + length / self.speed


class Curve(object):
    def __init__(self, kind, ev):
        self.objectType = 'adsk::core::' + kind
        self.evaluator = ev


class SketchEnt(object):
    def __init__(self, geo):
        self.worldGeometry = geo
        self.objectType = 'adsk::fusion::SketchLine'


def line(a, b, reverse=False):
    if reverse:
        a, b = b, a
    L = math.dist(a, b)
    return SketchEnt(Curve('Line3D', CurveEval(lambda t: add(a, mul(sub(b, a), t / L)), 0.0, L, 1.0)))


def arc_xy(c, R, a0, a1, reverse=False, kind='NurbsCurve3D'):
    """An arc in z = 0 about c from angle a0 to a1, parameter 0..2 (not its length: Fusion's NURBS are not arc-length)."""
    if reverse:
        a0, a1 = a1, a0
    f = lambda t: (c[0] + R * math.cos(a0 + (a1 - a0) * t / 2.0), c[1] + R * math.sin(a0 + (a1 - a0) * t / 2.0), 0.0)
    return SketchEnt(Curve(kind, CurveEval(f, 0.0, 2.0, R * abs(a1 - a0) / 2.0)))


# ---------------------------------------------------------------- 1. the path: chained, sampled, in mm
L1, R = 10.0, 5.0           # cm: 100 mm straight, 90 degree bend on 50 mm, 100 mm straight
l1 = line((0, 0, 0), (L1, 0, 0))
ar = arc_xy((L1, R, 0), R, -math.pi / 2, 0.0, reverse=True)         # its parameter runs from the far end
l2 = line((L1 + R, R, 0), (L1 + R, R + L1, 0))
chain = CT._ps_chain([ar, l2, l1])                                  # shuffled
ok([it['e'] for it, f in chain] in ([l1, ar, l2], [l2, ar, l1]) and chain[1][1] in (True, False),
   'the curves chain end to end whatever order they were picked in')
pts, runs, run_ent = CT._ps_stations(chain)
st = PS.stations_from_polyline(pts, runs)
want = 2 * 100.0 + math.pi / 2 * 50.0
gaps = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
ok(abs(st[-1]['s'] - want) < 0.5 and max(gaps) < 5.01 and min(gaps) > 1.0,
   'the stations run %.1f mm (%.1f mm of centreline), in steps of %.1f to %.1f mm: cm to mm, the reversed bend sampled forwards' % (st[-1]['s'], want, min(gaps), max(gaps)))
ids = [r for r in runs if r is not None]
ok(len(set(ids)) == 2 and set(run_ent) == set(ids) and all(r is None for p, r in zip(pts, runs) if 0.5 < p[0] / 10 - L1 < R - 0.5 and p[1] < R * 10 - 5),
   'two straight runs, each with its sketch line for the cut plane; the NURBS bend is not taken for a straight')
ok(all(abs(math.sqrt(dot(q['t'], q['t'])) - 1) < 1e-9 for q in st), 'every station has a unit tangent')
try:
    CT._ps_chain([l1, l2])
    ok(False, 'two curves that do not meet are refused')
except ValueError as e:
    ok('not one connected chain' in str(e), 'two curves that do not meet are refused: ' + str(e))


# ---------------------------------------------------------------- 2. the wall radii, with embossed lettering
class Cyl(object):
    def __init__(self, r_cm):
        self.surfaceType = 'cyl'
        self.axis, self.origin, self.radius = P3(1, 0, 0), P3(0, 0, 0), r_cm


class Face(object):
    def __init__(self, geo, ev=None):
        self.geometry, self.evaluator = geo, ev


class Faces(list):
    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


R_IN, R_OUT, EMB = 46.3, 50.8, 0.8          # mm; the letters stand 0.8 mm proud, x 100..237, angles 0..0.6 rad


class TubeBody(object):
    """A straight tube along x, 0..300 mm, with raised letters."""
    def __init__(self, faces):
        self.faces = Faces(faces)
        self.isSolid, self.name = True, 'TUBE'

    def pointContainment(self, p):
        x, y, z = p.x * 10, p.y * 10, p.z * 10
        r, a = math.hypot(y, z), math.atan2(z, y) % (2 * math.pi)
        if not 0 < x < 300:
            return OUTSIDE
        if R_IN < r < R_OUT or (R_OUT <= r < R_OUT + EMB and 100 < x < 237 and a < 0.6):
            return INSIDE
        return OUTSIDE


st_t = PS.stations_from_polyline([(5.0 * i, 0.0, 0.0) for i in range(61)], [0] * 61)
body = TubeBody([Face(Cyl(R_IN / 10)), Face(Cyl(R_OUT / 10)), Face(Cyl((R_OUT + EMB) / 10))])
ri, ro = CT._ps_radii(body, st_t)
ok(abs(ri - R_IN) < 1e-6 and abs(ro - R_OUT) < 1e-6,
   'bore %.2f and outside %.2f mm radius from the cylinders (the letters\' %.1f mm cylinder is not the outside)' % (ri, ro, R_OUT + EMB))
ri2, ro2 = CT._ps_radii(TubeBody([]), st_t)
ok(abs(ri2 - R_IN) < 0.06 and abs(ro2 - R_OUT) < 0.06, 'with no cylinders, scanning out finds %.2f and %.2f mm' % (ri2, ro2))


# ---------------------------------------------------------------- 3. keep-outs from the faces
class CylFaceEval(object):
    """u = angle, v = x (mm/10 = cm); on the face between the limits."""
    def __init__(self, r, u0, u1, v0, v1):
        self.r, self.u0, self.u1, self.v0, self.v1 = r, u0, u1, v0, v1

    def parametricRange(self):
        return BoundingBox2D(P2(self.u0, self.v0), P2(self.u1, self.v1))

    def isParameterOnFace(self, prm):
        return self.u0 - 1e-9 <= prm.x <= self.u1 + 1e-9 and self.v0 - 1e-9 <= prm.y <= self.v1 + 1e-9

    def getPointAtParameter(self, prm):
        return True, P3(prm.y, self.r * math.cos(prm.x), self.r * math.sin(prm.x))


class EndFaceEval(object):
    """The annular end face at x = 0, parametrised by (y, z) over its square: the corners are off the face."""
    def parametricRange(self):
        return BoundingBox2D(P2(-R_OUT / 10, -R_OUT / 10), P2(R_OUT / 10, R_OUT / 10))

    def isParameterOnFace(self, prm):
        return R_IN / 10 <= math.hypot(prm.x, prm.y) <= R_OUT / 10

    def getPointAtParameter(self, prm):
        return True, P3(0.0, prm.x, prm.y)


ok(not hasattr(BoundingBox2D(P2(0, 0), P2(1, 1)), '__iter__'), 'the stand-in parametricRange returns a bare BoundingBox2D, as the API reference says')
faces = [Face(Cyl(R_OUT / 10), CylFaceEval(R_OUT / 10, 0, 2 * math.pi, 0, 30)),
         Face(Cyl(R_IN / 10), CylFaceEval(R_IN / 10, 0, 2 * math.pi, 0, 30)),
         Face(Cyl((R_OUT + EMB) / 10), CylFaceEval((R_OUT + EMB) / 10, 0, 0.6, 10.0, 23.7)),
         Face(Cyl((R_OUT + 2) / 10), CylFaceEval((R_OUT + 2) / 10, 0, 2 * math.pi, 0, 0.4)),      # a 2 mm lip, 4 mm long
         Face(None, EndFaceEval())]
keep = CT._ps_keepouts(TubeBody(faces), st_t, R_IN, R_OUT)
ok(len(keep) == 2 and abs(keep[1][0] - 100) < 0.5 and abs(keep[1][1] - 237) < 0.5 and keep[0][0] < 0.5 and abs(keep[0][1] - 4) < 0.5,
   'keep-outs: the end lip %s and the lettering %s mm; the plain wall and the end face\'s on-face samples give none' % (
       ', '.join('%.0f-%.0f' % k for k in keep[:1]), ', '.join('%.0f-%.0f' % k for k in keep[1:])))


# ---------------------------------------------------------------- 4. a body picked through an occurrence
class Mat(object):
    def __init__(self, arr):
        self.arr = arr

    def asArray(self):
        return self.arr


class Occ(object):
    def __init__(self, arr):
        self.transform2, self.name = Mat(arr), 'intake:1'


ident = [1.0 if i % 5 == 0 else 0.0 for i in range(16)]
moved = list(ident)
moved[3] = 12.0
native = TubeBody([])
proxy = types.SimpleNamespace(assemblyContext=Occ(ident), nativeObject=native)
ok(CT._ps_native(proxy) is native and CT._ps_native(native) is native, 'a body picked through an unmoved occurrence is used as its own native body')
try:
    CT._ps_native(types.SimpleNamespace(assemblyContext=Occ(moved), nativeObject=native))
    ok(False, 'a body in a moved occurrence is refused')
except ValueError as e:
    ok('moved' in str(e), 'a body in a moved occurrence is refused: ' + str(e)[:80])
native.assemblyContext = None


# ---------------------------------------------------------------- 5. the cut plane, placed and checked
class Plane(object):
    def __init__(self, origin, normal):
        self.origin, self.normal = P3(*origin), P3(*normal)


class CPlane(object):
    def __init__(self, geo, log):
        self.geometry, self.log, self.name = geo, log, None

    def deleteMe(self):
        self.log.append('deleted')


class CPInput(object):
    def __init__(self, use_new):
        self.args = None
        if not use_new:
            self.setByPath = None
            del self.setByPath

    def setByPath(self, path, kind, dist):
        self.args = ('setByPath', path, kind, dist[1])
        return True

    def setByDistanceOnPath(self, path, dist):
        self.args = ('setByDistanceOnPath', path, None, dist[1])
        return True


class CPlanes(object):
    """Fusion places the plane by the path's own direction, which here may run against the line's parameter."""
    def __init__(self, a, b, reversed_path, use_new=True):
        self.a, self.b, self.rev, self.use_new, self.log = a, b, reversed_path, use_new, []

    def createInput(self):
        return CPInput(self.use_new) if self.use_new else _OldInput()

    def add(self, inp):
        f = inp.args[3]
        f = 1.0 - f if self.rev else f
        self.log.append(inp.args[0])
        o = add(self.a, mul(sub(self.b, self.a), f))
        return CPlane(Plane(o, sub(self.b, self.a)), self.log)


class _OldInput(object):
    """A Fusion from before September 2026: no setByPath."""
    args = None

    def setByDistanceOnPath(self, path, dist):
        self.args = ('setByDistanceOnPath', path, None, dist[1])
        return True


a, b = (2.0, 1.0, 0.0), (32.0, 1.0, 0.0)
p = (9.5, 1.0, 0.0)
for rev, new in ((False, True), (True, True), (True, False)):
    comp = types.SimpleNamespace(constructionPlanes=CPlanes(a, b, rev, new))
    pl = CT._ps_plane(comp, line(a, b), p, 1)
    on = abs(pl.geometry.origin.x - p[0]) < 1e-9
    ok(on and comp.constructionPlanes.log[0] == ('setByPath' if new else 'setByDistanceOnPath') and (('deleted' in comp.constructionPlanes.log) == rev),
       'the cut plane lands on the cut (%s path, %s): %s' % ('reversed' if rev else 'forward', 'setByPath' if new else 'setByDistanceOnPath (older Fusion)', ', '.join(comp.constructionPlanes.log)))


# ---------------------------------------------------------------- 6. the lap: roles, extrude direction, chamfer edges
cuts = [{'grower': 'up'}, {'grower': 'down'}]
roles = PS.joint_roles(cuts)
ok(roles[0] == {'grower': 0, 'receiver': 1, 'sg': -1.0} and roles[1] == {'grower': 2, 'receiver': 1, 'sg': 1.0},
   'cut 1 grows from piece 1 into piece 2, cut 2 from piece 3 back into piece 2')
t = (0.0, 1.0, 0.0)
ok(PS.toward_receiver((0, 1, 0), t, -1.0) == 1 and PS.toward_receiver((0, -1, 0), t, -1.0) == -1 and PS.toward_receiver((0, 1, 0), t, 1.0) == -1,
   'the recess and the tongue extrude toward the receiver whichever way the sketch normal points')


class Circ(object):
    def __init__(self, kind, c, r):
        self.curveType, self.center, self.radius = kind, P3(*c), r


class Edges(list):
    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


far = (5.0, 2.0, 0.0)
eb = types.SimpleNamespace(edges=Edges([types.SimpleNamespace(geometry=g) for g in (
    Circ('circle', far, 4.8475), Circ('arc', far, 4.8475), Circ('arc', far, 4.8475), Circ('circle', far, 5.08),
    Circ('circle', (3.0, 2.0, 0.0), 4.8475), Circ('line', far, 4.8475))]))
got = CT._ps_circle_edges(eb, 48.475, far)
ok(len(got) == 3, 'the shoulder edge found at the lap\'s far end: the full circle and both halves of a split one (%d edges), not the outside or the cut end' % len(got))

# ---------------------------------------------------------------- 7. the STL: on its end, not mirrored, the planned box
I = (-673.7, -493.2, -233.9)
A1, B1 = (-592.8, -456.0, -188.4), (-532.6, -441.9, -169.7)
A2, B2 = (-128.7, -421.5, -126.6), (-10.5, -302.2, -99.3)
O = (-5.7, -181.26, -83.14)


def _u(a, b):
    return tuple(x / math.dist(a, b) for x in sub(b, a))


def stations(segs, ds=5.0):
    """Stations from ('line', a, b) and ('arc', a, b, t1, t2, R) segments (mm), as tests/test_printsplit.py builds them."""
    cross = lambda a, b: (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    nrm = lambda a: mul(a, 1 / math.sqrt(dot(a, a)))
    pts, runs = [], []
    for k, sg in enumerate(segs):
        if sg[0] == 'line':
            a, b = sg[1], sg[2]
            n = max(1, int(math.dist(a, b) / ds))
            for i in range(n):
                pts.append(add(a, mul(sub(b, a), i / n))); runs.append(k)
        else:
            a, b, t1, t2, R = sg[1:]
            axn = nrm(cross(t1, t2)); th = math.acos(max(-1, min(1, dot(t1, t2))))
            c = add(a, mul(nrm(cross(axn, t1)), R))
            n = max(2, int(R * th / ds))
            for i in range(n):
                f = th * i / n; r0 = sub(a, c)
                pts.append(add(c, add(mul(r0, math.cos(f)), mul(cross(axn, r0), math.sin(f))))); runs.append(None)
    pts.append(segs[-1][2]); runs.append(runs[-1])
    return PS.stations_from_polyline(pts, runs)


segs = [('line', I, A1), ('arc', A1, B1, _u(I, A1), _u(B1, A2), 127.0), ('line', B1, A2), ('arc', A2, B2, _u(B1, A2), _u(B2, O), 127.0), ('line', B2, O)]
sti = stations(segs)
plan = PS.plan(sti, 50.8, keepouts=[(296.0, 433.0), (0.0, 4.0)])
rings = PS._rings(sti, 51.3)
fits = []
for q in plan['pieces']:
    i = q['i0'] if q['base'] == 'start' else q['i1']
    axis = sti[i]['t'] if q['base'] == 'start' else tuple(-x for x in sti[i]['t'])
    pp = PS._piece_points(sti, rings, q['i0'], q['i1'], q['grow_start'], q['grow_end'], 20.0, 51.3)
    sp = PS.stand_points(pp, sti[i]['p'], axis, q['spin_deg'])
    xs, ys, zs = [v[0] for v in sp], [v[1] for v in sp], [v[2] for v in sp]
    fits.append(abs((max(xs) - min(xs)) - q['w']) < 1e-6 and abs((max(ys) - min(ys)) - q['h']) < 1e-6 and abs(max(zs) - q['height']) < 1.01 and min(zs) == 0.0)
ok(plan['ok'] and all(fits), 'each intake piece stood for its STL has the footprint and height the planner fitted to the bed (%d pieces)' % len(plan['pieces']))
u_, v_, a_ = PS.stand_frame((0.3, -0.5, 0.8))
det = dot(u_, (v_[1] * a_[2] - v_[2] * a_[1], v_[2] * a_[0] - v_[0] * a_[2], v_[0] * a_[1] - v_[1] * a_[0]))
ok(abs(det - 1.0) < 1e-9, 'the print frame is right-handed (det %.6f): an STL is turned, never mirrored' % det)


class Mesh(object):
    def __init__(self, xyz, idx):
        self.nodeCoordinatesAsFloat, self.nodeIndices = xyz, idx


class Calc(object):
    def __init__(self, m):
        self.m, self.q = m, None

    def setQuality(self, q):
        self.q = q

    def calculate(self):
        return self.m


# a 40 x 30 x 120 mm box (cm here), its long side along a tilted axis, wound outward
ax = tuple(x / math.sqrt(0.3 ** 2 + 0.5 ** 2 + 0.8 ** 2) for x in (0.3, -0.5, 0.8))
uu, vv = PS._perp(ax)
base = (10.0, 20.0, 30.0)
corner = lambda i, j, k: add(base, add(mul(uu, (i - 0.5) * 40), add(mul(vv, (j - 0.5) * 30), mul(ax, k * 120))))
nodes = [corner(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
tris = [t for a0, b0, c0, d0 in quads for t in ((a0, b0, c0), (a0, c0, d0))]


def signed_volume(P, T):
    return sum(dot(P[a0], (P[b0][1] * P[c0][2] - P[b0][2] * P[c0][1], P[b0][2] * P[c0][0] - P[b0][0] * P[c0][2], P[b0][0] * P[c0][1] - P[b0][1] * P[c0][0])) for a0, b0, c0 in T) / 6.0


v0 = signed_volume(nodes, tris)
mesh = Mesh([c / 10.0 for n in nodes for c in n], [i for t in tris for i in t])
calc = Calc(mesh)
bod = types.SimpleNamespace(meshManager=types.SimpleNamespace(createMeshCalculator=lambda: calc))
fn = os.path.join(tempfile.mkdtemp(), 'box.stl')
CT._ps_write_stl(fn, bod, base, ax, 30.0)
data = open(fn, 'rb').read()
n = struct.unpack('<I', data[80:84])[0]
P, T = [], []
for k in range(n):
    vals = struct.unpack('<12f', data[84 + 50 * k:84 + 50 * k + 48])
    P += [vals[3:6], vals[6:9], vals[9:12]]
    T.append((3 * k, 3 * k + 1, 3 * k + 2))
zs = [q[2] for q in P]
v1 = signed_volume(P, T)
ok(calc.q == 'high' and n == 12 and len(data) == 84 + 50 * 12, 'the STL: 12 triangles, binary layout 84 + 50 per triangle, high-quality mesh asked for')
ok(abs(min(zs)) < 1e-4 and abs(max(zs) - 120) < 1e-3, 'it stands on its end: z from %.4f to %.2f mm (the box is 120 mm long)' % (min(zs), max(zs)))
ok(v0 > 0 and abs(v1 - v0) < 0.05 * v0, 'not mirrored: signed volume %.0f mm3 before and %.0f after (40 x 30 x 120 = 144000)' % (v0, v1))

print('test_printsplit_fusion_fake: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
