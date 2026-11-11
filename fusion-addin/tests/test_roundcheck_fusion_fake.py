"""cadtools' round-part glue against a small stand-in for adsk (the same kind as tests/test_printsplit_fusion_fake.py:
only what the code touches, lengths in cm as the API reference gives them). It cannot show what Fusion's mesher or
modeller does (tests/fusion_live_* and a live run do that), but it runs the real code:
  - _fine_mesh: setQuality first (it resets every setting), then surfaceTolerance 0.001 cm and maxNormalDeviation from
    the tube's radius; over the triangle cap it meshes again at the check's own limit and says so,
  - _ps_write_stl: with a mesher that honours the tolerance the piece's STL measures round, square to its centreline
    and again when read back from the file; with one that ignores it (the old 'high' preset, 79 facets round 100 mm)
    the report says NOT ROUND with the failing sections in mm and inches, and the split's words say not to print it,
  - the CFD STL's roundness words,
  - the boom tube: a round-to-round piece revolved (the real _revolve_section: its profile in a plane through the X
    axis, the radii the sections give, revolved about X), a flat oval piece lofted, and the loft kept as the fallback
    when the revolve is refused.
   python3 tests/test_roundcheck_fusion_fake.py"""
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


# ---------------------------------------------------------------- the stand-in (only what the glue touches)
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


class VI(object):
    @staticmethod
    def createByReal(v):
        return ('real', v)

    @staticmethod
    def createByString(v):
        return ('str', v)


class Coll(list):
    @staticmethod
    def create():
        return Coll()

    def add(self, x):
        self.append(x)

    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


core.Point3D, core.Vector3D, core.ValueInput, core.ObjectCollection = P3, P3, VI, Coll
core.Matrix3D = types.SimpleNamespace(create=lambda: 'identity')
core.SurfaceTypes = types.SimpleNamespace(PlaneSurfaceType='plane', CylinderSurfaceType='cyl')
fusion.TriangleMeshQualityOptions = types.SimpleNamespace(HighQualityTriangleMesh='high')
fusion.FeatureOperations = types.SimpleNamespace(NewBodyFeatureOperation='new', JoinFeatureOperation='join', CutFeatureOperation='cut')

import cadtools as CT     # noqa: E402
import roundcheck as RND  # noqa: E402

add = lambda a, b: tuple(x + y for x, y in zip(a, b))
sub = lambda a, b: tuple(x - y for x, y in zip(a, b))
mul = lambda a, s: tuple(x * s for x in a)
dot = lambda a, b: sum(x * y for x, y in zip(a, b))
cross = lambda a, b: (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
unit = lambda a: mul(a, 1.0 / math.sqrt(dot(a, a)))


# ---------------------------------------------------------------- a mesher: a straight tube, in cm, faceted as asked
AX = unit((0.2, -0.3, 0.93))
BASE = (40.0, 25.0, -10.0)          # mm, the piece's start on the centreline
R_OUT, R_IN, LEN = 50.0, 47.0, 200.0


def tube_cm(n_th):
    U = unit(cross(AX, (1.0, 0.0, 0.0)))
    Wv = cross(AX, U)
    xyz, idx, rings = [], [], []
    for z in (0.0, LEN):
        for r in (R_OUT, R_IN):
            row = []
            for j in range(n_th):
                th = 2 * math.pi * j / n_th
                p = add(add(BASE, mul(AX, z)), add(mul(U, r * math.cos(th)), mul(Wv, r * math.sin(th))))
                row.append(len(xyz) // 3)
                xyz += [c / 10.0 for c in p]
            rings.append(row)
    o0, i0, o1, i1 = rings
    for a, b in ((o0, o1), (i0, i1), (o0, i0), (o1, i1)):
        for j in range(n_th):
            k = (j + 1) % n_th
            idx += [a[j], a[k], b[k], a[j], b[k], b[j]]
    return xyz, idx


class Mesh(object):
    def __init__(self, xyz, idx):
        self.nodeCoordinatesAsFloat, self.nodeIndices = xyz, idx


class Calc(object):
    """Records what is set and in what order; meshes the tube with as many facets as the tolerance needs (a mesher
    that honours it), or always with the old preset's (one that does not)."""

    def __init__(self, honour=True, bbox_diag_mm=None):
        self.log, self.honour, self.calls = [], honour, 0
        self.bbox = bbox_diag_mm or math.sqrt((2 * R_OUT) ** 2 * 2 + LEN ** 2)
        self._tol = self._nd = None

    def setQuality(self, q):
        self.log.append(('quality', q))
        self._tol = self.bbox / 8192.0 / 10.0          # the API reference's 'high': diameter / 2^13
        self._nd = 0.0

    @property
    def surfaceTolerance(self):
        return self._tol

    @surfaceTolerance.setter
    def surfaceTolerance(self, v):
        self.log.append(('surfaceTolerance', v))
        self._tol = v

    @property
    def maxNormalDeviation(self):
        return self._nd

    @maxNormalDeviation.setter
    def maxNormalDeviation(self, v):
        self.log.append(('maxNormalDeviation', v))
        self._nd = v

    def calculate(self):
        self.calls += 1
        tol = self._tol if self.honour else self.bbox / 8192.0 / 10.0
        n = RND.facets_for(R_OUT, tol * 10.0)
        if self.honour and self._nd:
            n = max(n, int(math.ceil(2 * math.pi / self._nd - 1e-9)))
        self.n = n
        return Mesh(*tube_cm(n))


def body_of(calc):
    return types.SimpleNamespace(meshManager=types.SimpleNamespace(createMeshCalculator=lambda: calc))


centre = [add(BASE, mul(AX, z)) for z in (0.0, 50.0, 100.0, 150.0, 200.0)]

# ---------------------------------------------------------------- _fine_mesh
calc = Calc()
m, ms, notes = CT._fine_mesh(calc, R_OUT)
names = [k for k, _v in calc.log]
ok(names == ['quality', 'surfaceTolerance', 'maxNormalDeviation'], 'the mesh settings in order: %s (setQuality first: it resets the others)' % ', '.join(names))
ok(abs(dict(calc.log)['surfaceTolerance'] - 0.001) < 1e-12 and abs(dict(calc.log)['maxNormalDeviation'] - 2 * math.pi / 158) < 1e-12,
   'surfaceTolerance 0.001 cm (0.01 mm) and maxNormalDeviation %.5f rad for a 100 mm tube' % dict(calc.log)['maxNormalDeviation'])
ok(calc.n == 158 and not notes and ms['triangles'] == len(m.nodeIndices) // 3, 'that mesher gives %d facets round it, no notes' % calc.n)
cap = RND.MAX_TRIANGLES
RND.MAX_TRIANGLES = 1000
calc2 = Calc()
m2, ms2, notes2 = CT._fine_mesh(calc2, R_OUT)
RND.MAX_TRIANGLES = cap
tols = [v for k, v in calc2.log if k == 'surfaceTolerance']
ok(calc2.calls == 2 and abs(tols[-1] - 0.002) < 1e-12 and notes2 and 'meshed again' in notes2[0],
   'over the triangle cap: meshed again at the check\'s 0.02 mm (%s)' % (notes2[0] if notes2 else 'no note'))
calc3 = Calc()
CT._fine_mesh(calc3, None)
ok([k for k, _v in calc3.log] == ['quality', 'surfaceTolerance'], 'with no radius known (the CFD faces) only the surface tolerance is set')

# ---------------------------------------------------------------- _ps_write_stl: good mesher, then the old preset
td = tempfile.mkdtemp()
fn = os.path.join(td, 'piece.stl')
rep = CT._ps_write_stl(fn, body_of(Calc()), BASE, AX, 20.0, r_mm=R_OUT, centreline=centre, skip=[(90.0, 110.0)], s_start=0.0,
                       span=(-20.0, LEN + 20.0), name='TUBE PRINT 1')
sk = [s for s in rep['stations'] if s['status'] == 'skipped']
ok(rep['verdict'] == 'round' and rep['judged'] >= 20 and len(sk) >= 1,
   'a piece meshed to 0.01 mm: %s, %d sections square to its centreline, %d skipped in the keep-out' % (rep['verdict'], rep['judged'], len(sk)))
data = open(fn, 'rb').read()
n = struct.unpack('<I', data[80:84])[0]
back = RND.check(data)
zs = [struct.unpack('<12f', data[84 + 50 * k:84 + 48 + 50 * k])[5] for k in range(n)]
ok(back['verdict'] == 'round' and abs(min(zs)) < 1e-3 and n == len(tube_cm(158)[1]) // 3,
   'the STL as written (stood on its end, %d triangles) read back and checked with its axis found: %s' % (n, back['verdict']))
ok(CT._ps_round_words([rep, rep])[0], 'two round pieces: the split says "%s"' % CT._ps_round_words([rep, rep])[1][:110])
rep_old = CT._ps_write_stl(os.path.join(td, 'old.stl'), body_of(Calc(honour=False)), BASE, AX, 0.0, r_mm=R_OUT, centreline=centre,
                           name='TUBE PRINT 2')
lp = rep_old['stations'][5]['loops'][0]
ok(rep_old['verdict'] == 'not round' and lp['facets'] == RND.preset_facets(R_OUT, Calc().bbox)[0] and lp['sag_mm'] > RND.SAG_TOL_MM,
   'a mesher stuck at the old preset: %s, %d facets, chord error %.3f mm' % (rep_old['verdict'], lp['facets'], lp['sag_mm']))
good, words = CT._ps_round_words([rep, rep_old])
ok(not good and 'TUBE PRINT 2' in words and 'NOT ROUND' in words and 'Do not print' in words and ' in)' in words and 'TUBE PRINT 1' not in words,
   'and the split\'s words name that piece, in mm and inches: "%s"' % words[:200])
brief = CT._round_brief(rep_old)
ok(brief['failing_at'] and brief['failing_at'][0]['loops'][0]['role'] == 'outer' and 's_in' in brief['failing_at'][0],
   'its brief for the page lists the failing sections (%d) with mm and inches' % len(brief['failing_at']))

# ---------------------------------------------------------------- CFD STL words
xyz, idx = tube_cm(158)
P = [(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]) for i in range(len(xyz) // 3)]
tris = [(P[idx[3 * k]], P[idx[3 * k + 1]], P[idx[3 * k + 2]]) for k in range(len(idx) // 3)]
rnd, words = CT._stl_export_roundness({'inlet': [], 'outlet': [], 'wall': tris})
ok(rnd['verdict'] == 'round' and words.startswith('If you print it: ') and 'ROUND' in words, 'the CFD STL\'s words: "%s"' % words[:110])
rnd, words = CT._stl_export_roundness({'wall': []})
ok(rnd['verdict'] == 'not checked' and not rnd['ok'], 'an empty CFD STL: not checked (%s)' % words[:80])

# ---------------------------------------------------------------- the boom tube


class SkPt(object):
    def __init__(self, p):
        self.geometry = p


def _pt(q):
    return q.geometry if isinstance(q, SkPt) else q


class Line(object):
    def __init__(self, a, b):
        self.a, self.b = _pt(a), _pt(b)
        self.startSketchPoint, self.endSketchPoint = SkPt(self.a), SkPt(self.b)
        self.isConstruction = False


class Lines(object):
    def __init__(self, sk):
        self.sk = sk

    def addByTwoPoints(self, a, b):
        ln = Line(a, b)
        self.sk.lines.append(ln)
        return ln


class Curves(object):
    def __init__(self, sk):
        self.sketchLines = Lines(sk)
        self.sketchCircles = types.SimpleNamespace(addByCenterRadius=lambda c, r: sk.circles.append((c, r)))
        self.sketchArcs = types.SimpleNamespace(addByThreePoints=lambda a, m, b: sk.arcs.append((_pt(a), m, _pt(b))))


class Profile(object):
    def __init__(self, sk):
        self.sk = sk
        self.profileLoops = Coll([1])

    def areaProperties(self):
        return types.SimpleNamespace(area=1.0)


class Sketch(object):
    def __init__(self, plane):
        self.plane, self.lines, self.circles, self.arcs, self.name = plane, [], [], [], ''
        self.sketchCurves = Curves(self)
        self.sketchPoints = types.SimpleNamespace(add=lambda p: SkPt(p))

    def modelToSketchSpace(self, p):
        return p

    @property
    def profiles(self):
        return Coll([Profile(self)])


class Face(object):
    def __init__(self, x, nx):
        self.geometry = types.SimpleNamespace(surfaceType='plane', normal=P3(nx, 0.0, 0.0))
        self.pointOnFace = P3(x, 0.0, 0.0)


class Body(object):
    def __init__(self, x0, x1, how):
        self.x0, self.x1, self.how, self.name = x0, x1, how, ''

    @property
    def faces(self):
        return [Face(self.x0, -1.0), Face(self.x1, 1.0)]


class Feat(object):
    def __init__(self, body):
        self.bodies = Coll([body])


class Comp(object):
    def __init__(self):
        self.revolves, self.lofts, self.shells, self.sketch_list, self.refuse_revolve = [], [], [], [], False
        self.xYConstructionPlane, self.yZConstructionPlane = ('plane', 'xy', 0.0), ('plane', 'yz', 0.0)
        comp = self

        class PlaneInput(object):
            def setByOffset(self, base, v):
                self.plane = ('plane', 'offset', v[1])

            def setByThreePoints(self, a, b, c):
                self.plane = ('plane', '3pt', (_pt(a), _pt(b), _pt(c)))
        self.constructionPlanes = types.SimpleNamespace(createInput=PlaneInput, add=lambda pin: pin.plane)

        def sk_add(plane):
            s = Sketch(plane)
            comp.sketch_list.append(s)
            return s
        self.sketches = types.SimpleNamespace(add=sk_add)

        class RvIn(object):
            def __init__(self, prof, axis, op):
                self.prof, self.axis, self.op = prof, axis, op

            def setAngleExtent(self, sym, v):
                self.angle = v

        def rv_add(inp):
            if comp.refuse_revolve:
                raise RuntimeError('the revolve was refused')
            xs = [q.x for ln in inp.prof.sk.lines if not ln.isConstruction for q in (ln.a, ln.b)]
            comp.revolves.append(inp)
            return Feat(Body(min(xs), max(xs), 'revolve'))

        class LoftIn(object):
            def __init__(self, op):
                self.loftSections, self.isSolid = Coll(), False

        def loft_add(li):
            xs = [p.sk.plane[2] for p in li.loftSections]
            comp.lofts.append(li)
            return Feat(Body(min(xs), max(xs), 'loft'))

        class CombIn(object):
            def __init__(self, target, tools):
                self.target, self.tools, self.operation = target, tools, None

        def comb_add(ci):
            bs = [ci.target] + list(ci.tools)
            return Feat(Body(min(b.x0 for b in bs), max(b.x1 for b in bs), 'joined'))

        class ShellIn(object):
            def __init__(self, ends, tangent):
                self.ends, self.outsideThickness = ends, None
        self.features = types.SimpleNamespace(
            revolveFeatures=types.SimpleNamespace(createInput=RvIn, add=rv_add),
            loftFeatures=types.SimpleNamespace(createInput=LoftIn, add=loft_add),
            combineFeatures=types.SimpleNamespace(createInput=CombIn, add=comb_add),
            shellFeatures=types.SimpleNamespace(createInput=ShellIn, add=lambda si: comp.shells.append(si)))


def design_with(comp):
    occs = types.SimpleNamespace(addNewComponent=lambda m: types.SimpleNamespace(component=comp))
    return types.SimpleNamespace(rootComponent=types.SimpleNamespace(occurrences=occs))


# round 76.2 mm, a 20 mm straight, a cone to 101.6 mm, flat oval 120 x 60, round 101.6 again (cm)
secs = [(0.0, 7.62, 7.62), (2.0, 7.62, 7.62), (12.0, 10.16, 10.16), (20.0, 12.0, 6.0), (28.0, 10.16, 10.16)]
ok(CT.boom_round_pair(secs[1], secs[2]) == [(0.0, 2.0), (3.81, 2.0), (5.08, 12.0), (0.0, 12.0)] and CT.boom_round_pair(secs[2], secs[3]) is None,
   'boom_round_pair: the cone\'s half-section (r, x) from the two radii; none against a flat oval')
comp = Comp()
CT.build_boom(design_with(comp), 'Boom', secs, 0.12, True)
ok(len(comp.revolves) == 2 and len(comp.lofts) == 2, 'built: %d round-to-round pieces revolved, %d with a flat oval end lofted' % (len(comp.revolves), len(comp.lofts)))
rv = comp.revolves[1]
prof = [ln for ln in rv.prof.sk.lines if not ln.isConstruction]
pts = [q for ln in prof for q in (ln.a, ln.b)]
rad = sorted(set(round(math.hypot(q.y, q.z), 6) for q in pts))
xs = sorted(set(round(q.x, 6) for q in pts))
ax = rv.axis
ok(rad == [0.0, 3.81, 5.08] and xs == [2.0, 12.0] and len(prof) == 4,
   'the cone piece\'s profile: radii %s cm at x %s cm, four lines' % (rad, xs))
ok(ax.isConstruction and abs(ax.a.y) + abs(ax.a.z) + abs(ax.b.y) + abs(ax.b.z) < 1e-12 and ax.a.x < 2.0 and ax.b.x > 12.0 and rv.angle == ('str', '360 deg'),
   'revolved 360 degrees about the X axis (a construction line from x %.1f to %.1f cm)' % (ax.a.x, ax.b.x))
nrm = cross(sub((pts[1].x, pts[1].y, pts[1].z), (pts[0].x, pts[0].y, pts[0].z)), sub((pts[3].x, pts[3].y, pts[3].z), (pts[0].x, pts[0].y, pts[0].z)))
ok(abs(nrm[0]) < 1e-9 and all(abs(dot(nrm, (q.x, q.y, q.z))) < 1e-9 for q in pts), 'and the profile lies in one plane through the X axis')
ok(len(comp.shells) == 1 and comp.shells[0].ends.count == 2 and comp.shells[0].outsideThickness == ('real', 0.12),
   'the joined body shelled outward by the wall with both ends open')
comp2 = Comp()
comp2.refuse_revolve = True
CT.build_boom(design_with(comp2), 'Boom', secs, 0.12, True)
ok(len(comp2.revolves) == 0 and len(comp2.lofts) == 4 and len(comp2.shells) == 1, 'the revolve refused: every piece lofted as before, still shelled')

print('test_roundcheck_fusion_fake: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
