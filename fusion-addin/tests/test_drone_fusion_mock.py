"""The add-in's drone-fix builders (cadtools: act_helmholtz, the J-pipe cap and tee, the main-pipe finders) run
against a stand-in for Fusion's API that records what they ask Fusion to make. It cannot show that Fusion accepts
those calls (tests/fusion_live_drone_parts.py does that inside Fusion), but it runs every line of the glue: the
selections it reads, the bodies and sketches it asks for and where they land, the boolean cuts, the join, the
names, the notes, and the scan fit through the real router Scene."""
import math
import os
import sys
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)

# ---------------------------------------------------------------- a small stand-in for adsk.core / adsk.fusion
adsk = types.ModuleType('adsk')
core = types.ModuleType('adsk.core')
fusion = types.ModuleType('adsk.fusion')
adsk.core, adsk.fusion = core, fusion
for n in ('HTMLEventHandler', 'CommandCreatedEventHandler', 'CommandEventHandler', 'ApplicationEventHandler'):
    setattr(core, n, object)
sys.modules.update({'adsk': adsk, 'adsk.core': core, 'adsk.fusion': fusion})

LOG = []


class P3(object):
    def __init__(self, x, y, z):
        self.x, self.y, self.z = float(x), float(y), float(z)

    @staticmethod
    def create(x=0.0, y=0.0, z=0.0):
        return P3(x, y, z)


core.Point3D = P3
core.Vector3D = P3
core.OrientedBoundingBox3D = types.SimpleNamespace(create=lambda *a: a)
core.Matrix3D = types.SimpleNamespace(create=lambda: None)


class VI(object):
    @staticmethod
    def createByString(s):
        return ('str', s)

    @staticmethod
    def createByReal(v):
        return ('real', v)


core.ValueInput = VI


class Coll(list):
    @staticmethod
    def create():
        return Coll()

    def add(self, x):
        self.append(x)


core.ObjectCollection = Coll
core.SurfaceTypes = types.SimpleNamespace(CylinderSurfaceType='cyl', PlaneSurfaceType='plane')
core.Curve3DTypes = types.SimpleNamespace(Circle3DCurveType='circle', Line3DCurveType='line', Arc3DCurveType='arc')
fusion.BooleanTypes = types.SimpleNamespace(DifferenceBooleanType='diff', UnionBooleanType='union', IntersectionBooleanType='int')
fusion.FeatureOperations = types.SimpleNamespace(NewBodyFeatureOperation='new', JoinFeatureOperation='join', CutFeatureOperation='cut')
fusion.DesignTypes = types.SimpleNamespace(ParametricDesignType='param', DirectDesignType='direct')


class Body(object):
    def __init__(self, kind, **kw):
        self.kind, self.kw, self.name, self.isLightBulbOn, self.cuts = kind, kw, None, True, []
        self.objectType = 'adsk::fusion::BRepBody'


class TBM(object):
    def createCylinderOrCone(self, p1, r1, p2, r2):
        b = Body('cyl', p1=(p1.x, p1.y, p1.z), r1=r1, p2=(p2.x, p2.y, p2.z), r2=r2)
        LOG.append(('cyl', b))
        return b

    def createBox(self, obb):
        return Body('box', obb=obb)

    def createSphere(self, c, r):
        return Body('sphere', c=(c.x, c.y, c.z), r=r)

    def booleanOperation(self, target, tool, kind):
        target.cuts.append((kind, tool))
        LOG.append(('bool', kind, target, tool))
        return True


_tbm = TBM()
fusion.TemporaryBRepManager = types.SimpleNamespace(get=lambda: _tbm)


class Items(object):
    def __init__(self, xs=None):
        self.xs = list(xs or [])

    @property
    def count(self):
        return len(self.xs)

    def item(self, i):
        return self.xs[i]

    def __iter__(self):
        return iter(self.xs)


class SketchPoint(object):
    def __init__(self, p):
        self.worldGeometry = P3(*p)
        self.geometry = self.worldGeometry


class Line(object):
    def __init__(self, a, b):
        self.startSketchPoint = a if isinstance(a, SketchPoint) else SketchPoint((a.x, a.y, a.z))
        self.endSketchPoint = b if isinstance(b, SketchPoint) else SketchPoint((b.x, b.y, b.z))
        self.isConstruction = False


class Lines(object):
    def __init__(self, sk):
        self.sk = sk

    def addByTwoPoints(self, a, b):
        ln = Line(a, b)
        self.sk.lines.append(ln)
        return ln


class Profile(object):
    profileLoops = Items([1])

    def areaProperties(self):
        return types.SimpleNamespace(area=1.0)


class Sketch(object):
    def __init__(self, plane):
        self.plane, self.name, self.lines = plane, None, []
        self.sketchCurves = types.SimpleNamespace(sketchLines=Lines(self), sketchCircles=None, sketchArcs=None)
        self.sketchPoints = types.SimpleNamespace(add=lambda p: SketchPoint((p.x, p.y, p.z)))
        self.profiles = Items([Profile()])

    def modelToSketchSpace(self, p):
        return p

    def polygon(self):
        """The closed outline drawn on this sketch, in order, without the construction axis."""
        return [(ln.startSketchPoint.worldGeometry.x, ln.startSketchPoint.worldGeometry.y, ln.startSketchPoint.worldGeometry.z)
                for ln in self.lines if not ln.isConstruction]


class Feature(object):
    def __init__(self, kind, **kw):
        self.kind, self.kw = kind, kw
        self.bodies = Items([Body(kind)])


class Revolves(object):
    def __init__(self, comp):
        self.comp = comp

    def createInput(self, prof, axis, op):
        return types.SimpleNamespace(prof=prof, axis=axis, op=op, setAngleExtent=lambda sym, a: None)

    def add(self, inp):
        sk = self.comp.sketches.xs[-1]
        f = Feature('revolve', sketch=sk, axis=inp.axis)
        self.comp.bRepBodies.xs.append(f.bodies.item(0))
        self.comp.revolves.append(f)
        return f


class Combines(object):
    def __init__(self, comp):
        self.comp = comp

    def createInput(self, target, tools):
        return types.SimpleNamespace(target=target, tools=list(tools), operation=None, isKeepToolBodies=True)

    def add(self, inp):
        self.comp.combines.append(inp)
        for t in inp.tools:
            if not inp.isKeepToolBodies and t in self.comp.bRepBodies.xs:
                self.comp.bRepBodies.xs.remove(t)
        return inp


class BaseFeature(object):
    def startEdit(self):
        pass

    def finishEdit(self):
        pass


class Bodies(Items):
    def add(self, body, bf=None):
        self.xs.append(body)
        return body


class Comp(object):
    def __init__(self, name='Component'):
        self.name = name
        self.sketches = Items()
        self.sketches.add = self._add_sketch
        self.bRepBodies = Bodies()
        self.revolves, self.combines, self.planes = [], [], []
        self.xYConstructionPlane = 'XY'
        self.constructionPlanes = types.SimpleNamespace(createInput=lambda: types.SimpleNamespace(setByThreePoints=lambda a, b, c: None),
                                                        add=self._add_plane)
        self.features = types.SimpleNamespace(revolveFeatures=Revolves(self), combineFeatures=Combines(self),
                                              baseFeatures=types.SimpleNamespace(add=lambda: BaseFeature()))

    def _add_sketch(self, plane):
        sk = Sketch(plane)
        self.sketches.xs.append(sk)
        return sk

    def _add_plane(self, inp):
        pl = types.SimpleNamespace(name=None)
        self.planes.append(pl)
        return pl


class Cyl(object):
    surfaceType = 'cyl'

    def __init__(self, origin, axis, radius):
        self.origin, self.axis, self.radius = P3(*origin), P3(*axis), radius


class Face(object):
    objectType = 'adsk::fusion::BRepFace'

    def __init__(self, geometry, body, half_len):
        self.geometry, self.body, self.half = geometry, body, half_len
        g = geometry

        def on_face(prm):
            return abs(prm[1]) <= self.half + 1e-9

        def param_at(p):
            a = (g.axis.x, g.axis.y, g.axis.z)
            w = (p.x - g.origin.x, p.y - g.origin.y, p.z - g.origin.z)
            return True, (0.0, sum(w[k] * a[k] for k in range(3)))
        self.evaluator = types.SimpleNamespace(getParameterAtPoint=param_at, isParameterOnFace=on_face)


class Tube(object):
    """A solid main pipe: outside and bore faces on one axis, half_len either side of origin."""
    objectType = 'adsk::fusion::BRepBody'

    def __init__(self, name, origin, axis, R, R_in, half_len):
        self.name, self.isVisible, self.assemblyContext = name, True, None
        self.faces = Items([Face(Cyl(origin, axis, R), self, half_len), Face(Cyl(origin, axis, R_in), self, half_len)])
        ext = [abs(axis[k]) * half_len + R for k in range(3)]
        self.boundingBox = types.SimpleNamespace(minPoint=P3(*[origin[k] - ext[k] for k in range(3)]),
                                                 maxPoint=P3(*[origin[k] + ext[k] for k in range(3)]))


class Mesh(object):
    objectType = 'adsk::fusion::MeshBody'

    def __init__(self, name, coords, idx):
        self.name, self.isValid = name, True
        self.displayMesh = types.SimpleNamespace(nodeCoordinatesAsDouble=coords, nodeIndices=idx)
        xs, ys, zs = coords[0::3], coords[1::3], coords[2::3]
        self.boundingBox = types.SimpleNamespace(minPoint=P3(min(xs), min(ys), min(zs)), maxPoint=P3(max(xs), max(ys), max(zs)))
        self.entityToken = 'mesh-' + name


class Sel(object):
    def __init__(self, ents):
        self.ents = ents

    @property
    def count(self):
        return len(self.ents)

    def item(self, i):
        return types.SimpleNamespace(entity=self.ents[i])


def sketch_line(p0, p1):
    ln = Line(P3(*p0), P3(*p1))
    ln.objectType = 'adsk::fusion::SketchLine'
    ln.parentSketch = types.SimpleNamespace(name='Markers')
    return ln


class Design(object):
    def __init__(self, solids=()):
        self.designType = 'param'
        self.userParameters = None
        self.made = []
        root = Comp('Root')
        root.bRepBodies = Bodies(list(solids))
        root.allOccurrences = Items()
        root.occurrences = types.SimpleNamespace(addNewComponent=self._new)
        root.allOccurrencesByComponent = lambda c: Items([o for o in root.allOccurrences.xs if o.component is c])
        self.rootComponent = root

    def _new(self, m):
        c = Comp()
        occ = types.SimpleNamespace(component=c, bRepBodies=c.bRepBodies, transform2=None)
        self.rootComponent.allOccurrences.xs.append(occ)
        self.made.append(c)
        return occ

    def findEntityByToken(self, tok):
        return []


import cadtools as CT     # noqa: E402
import router as RT       # noqa: E402
import templates as TPL   # noqa: E402
import test_router as TR  # noqa: E402

fails = []


def ok(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        fails.append(m)


def setup(design, ents):
    CT._app = types.SimpleNamespace(activeProduct=design)
    CT._ui = types.SimpleNamespace(activeSelections=Sel(ents), palettes=types.SimpleNamespace(itemById=lambda i: None))
    fusion.Design = types.SimpleNamespace(cast=lambda p: p)
    CT._keepouts[:] = []
    CT._mesh_cache.clear()
    del LOG[:]


def near(a, b, tol=1e-6):
    return all(abs(a[k] - b[k]) <= tol for k in range(3))


def revolved_points_ok(sk, origin, d, sec):
    """Every corner of the drawn outline is origin + z d + r e1 for the section's (r, z), in order."""
    e1, _e2 = RT.perp_basis(RT.vunit(d))
    want = [tuple(origin[k] + d[k] * z + e1[k] * r for k in range(3)) for r, z in sec]
    got = sk.polygon()
    return len(got) == len(want) and all(near(g, w) for g, w in zip(got, want))


R, RIN = 3.175, 3.01             # 2.5 in OD x 0.065 in main pipe along X
up = (0.0, 0.0, 1.0)
start = (5.0, 0.0, R)


def helmholtz_on_a_solid():
    main = Tube('Main pipe', (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), R, RIN, 30.0)
    des = Design([main])
    marker = sketch_line(start, (5.0, 0.0, R + 2.0))
    setup(des, [marker])
    data = {'neck_id_mm': 50.8, 'neck_len_mm': 76.2, 'wall_mm': 1.651, 'can_id_mm': 127.0, 'vol_cm3': 2934.0,
            'can_wall_mm': 1.519, 'neck_into_mm': 0.0, 'gap_cm': 1.27, 'title': 'Helmholtz can'}
    res = CT.dispatch('helmholtz', __import__('json').dumps(data))
    ok(res.get('ok'), 'act_helmholtz runs to the end (%s)' % res.get('msg', '')[:160])
    if not res.get('ok'):
        print(res.get('msg'))
        return
    comp = des.made[0]
    lay = TPL.helm_can(5.08, 0.1651, 7.62, 12.7, 2934.0, 0.1519, 0.0)
    neck_sk = [sk for sk in comp.sketches.xs if sk.name == 'Helmholtz can neck section'][0]
    can_sk = [sk for sk in comp.sketches.xs if sk.name == 'Helmholtz can section'][0]
    ok(revolved_points_ok(neck_sk, start, up, lay['neck']), 'the neck section is drawn on the marker, along it')
    ok(revolved_points_ok(can_sk, start, up, lay['section']), 'the can section is drawn on the marker, along it')
    axis = [ln for ln in can_sk.lines if ln.isConstruction]
    ok(len(axis) == 1 and near((axis[0].startSketchPoint.worldGeometry.x, 0, 0), (5.0, 0, 0)), 'the can revolves about the marker line')
    cyls = [b for k, b in ((e[0], e[1]) for e in LOG if e[0] == 'cyl')]
    piece, bore, env, hole = cyls[:4]
    c = TPL.tee_cope({'p': (0, 0, 0), 'd': (1, 0, 0), 'R': R}, start, up, lay['r_hole'])
    ok(near(piece.kw['p1'], (5.0, 0.0, R - c['stub'])) and near(piece.kw['p2'], (5.0, 0.0, R + 0.002)) and abs(piece.kw['r1'] - lay['r_hole']) < 1e-9,
       'the coped piece runs from %.3f cm below the start to 20 microns into the neck, at the neck OD' % c['stub'])
    ok(abs(bore.kw['r1'] - 2.54) < 1e-9, 'its bore is the neck ID')
    ok(abs(env.kw['r1'] - R) < 1e-9 and abs(env.kw['p1'][1]) < 1e-9 and abs(env.kw['p1'][2]) < 1e-9 and env.kw['p1'][0] < 5 < env.kw['p2'][0],
       'the fishmouth is cut by the main pipe\'s outside, along its axis')
    cuts = [(e[1], e[2], e[3]) for e in LOG if e[0] == 'bool']
    ok(cuts == [('diff', piece, bore), ('diff', piece, env)], 'two cuts: the bore, then the main pipe')
    hp = TPL.tee_hole({'p': (0, 0, 0), 'd': (1, 0, 0), 'R': R}, start, up, 2.54, RIN)
    ok(abs(hole.kw['r1'] - 2.54) < 1e-9 and near(hole.kw['p1'], (5.0, 0.0, R - hp['bottom'])) and near(hole.kw['p2'], (5.0, 0.0, R + hp['top'])),
       'the hole tool is the neck ID, through the main pipe\'s wall (%.3f cm down) and no further' % hp['bottom'])
    ok(len(comp.combines) == 1, 'a square tee needs no cut beyond the coped piece')
    names = [b.name for b in comp.bRepBodies.xs]
    ok('Helmholtz can neck tee hole (cut tool)' in names and 'Helmholtz can' in names and 'Helmholtz can neck' in names, 'bodies named: %s' % names)
    hb = [b for b in comp.bRepBodies.xs if b.name == 'Helmholtz can neck tee hole (cut tool)'][0]
    ok(hb.isLightBulbOn is False, 'the hole tool is hidden')
    ok(len(comp.combines) == 1 and comp.combines[0].operation == 'join' and comp.combines[0].isKeepToolBodies is False
       and comp.combines[0].tools == [piece] and comp.combines[0].target.name == 'Helmholtz can neck', 'the coped piece is joined to the neck')
    can_it, neck_it = res['items']
    ok(abs(can_it['helm']['gas_cm3'] - 2934.0) < 1e-6 and abs(can_it['helm']['can_len_cm'] - lay['L_in']) < 1e-9, 'the can reports its gas volume and inside length')
    ok('is coped to the main pipe' in neck_it['note'] and 'Main pipe' in neck_it['note'] and 'off square' not in neck_it['note'],
       'the neck note names the main pipe it was coped to')
    ok('min_gap' not in can_it and 'Set the scan as a keep-out' in res['msg'], 'without keep-outs there is no clearance, and it says so')


def helmholtz_on_a_scan():
    cm, ci = TR.cyl_mesh((-30.0, 0.0, 0.0), (40.0, 0.0, 0.0), R, 48, 70)
    floor, fi = TR.box_mesh((-30.0, -20.0, -12.0), (40.0, 20.0, -11.0), 4)
    des = Design([])
    marker = sketch_line(start, (5.0, 0.0, R + 2.0))
    setup(des, [marker])
    CT._keepouts[:] = [('t1', 'Scan', Mesh('scan', cm, ci)), ('t2', 'Floor', Mesh('floor', floor, fi))]
    data = {'neck_id_mm': 50.8, 'neck_len_mm': 76.2, 'wall_mm': 1.651, 'can_id_mm': 127.0, 'vol_cm3': 2934.0,
            'can_wall_mm': 1.519, 'neck_into_mm': 0.0, 'gap_cm': 1.27, 'main_od_mm': 63.5}
    res = CT.dispatch('helmholtz', __import__('json').dumps(data))
    ok(res.get('ok'), 'act_helmholtz on a scan runs to the end (%s)' % res.get('msg', '')[:200])
    if not res.get('ok'):
        print(res.get('msg'))
        return
    env = [e[3] for e in LOG if e[0] == 'bool'][1]
    ok(abs(env.kw['r1'] - R) < 0.02, 'the main pipe read from the scan: %.3f cm across (true %.3f)' % (2 * env.kw['r1'], 2 * R))
    a = RT.vunit(RT.vsub(env.kw['p2'], env.kw['p1']))
    ok(abs(abs(a[0]) - 1.0) < 1e-3, 'its axis runs along the pipe (%.4f, %.4f, %.4f)' % a)
    ok('read from the scan' in res['msg'], 'the message says the main pipe came from the scan')
    can_it = res['items'][0]
    lay = TPL.helm_can(5.08, 0.1651, 7.62, 12.7, 2934.0, 0.1519, 0.0)
    # the can's near end sits lay['gap'] above the pipe's top; the scan's pipe is the closest thing to it
    ok(can_it.get('min_gap') is not None and can_it['min_gap'] <= lay['gap'] + 1e-6 and can_it['min_gap'] >= lay['gap'] - 0.3,
       'the can clears the scan by %.2f cm (its near end is %.2f cm above the pipe)' % (can_it.get('min_gap', -1), lay['gap']))


def jpipe_fittings():
    main = Tube('Main pipe', (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), R, RIN, 30.0)
    des = Design([main])
    setup(des, [])
    notes = []
    m = CT._main_pipe(start, up, {}, notes)
    ok(m is not None and abs(m['R'] - R) < 1e-12 and abs(m['R_in'] - RIN) < 1e-12 and m['how'] == 'face', 'the solid under the marker is found, outside and bore')
    off = CT._main_pipe((5.0, 0.0, R + 0.5), up, {}, [])
    ok(off is None, 'a marker 5 mm off the pipe finds nothing (no scan to fall back on)')
    comp = des.rootComponent.occurrences.addNewComponent(None).component
    tube = Body('pipe')
    tube.name = 'J-pipe'
    comp.bRepBodies.xs.append(tube)
    end, d_end = (30.0, 0.0, 12.0), (1.0, 0.0, 0.0)
    data = {'cap': True, 'tee': True, 'cap_mm': 3.175, 'title': 'J-pipe'}
    note = CT._jpipe_fittings(comp, data, tube, m, start, up, end, d_end, 6.35, 0.1651, 60.12, notes)
    cap = [sk for sk in comp.sketches.xs if sk.name == 'J-pipe cap section'][0]
    ok(revolved_points_ok(cap, end, d_end, [(0.0, 0.0), (3.175, 0.0), (3.175, 0.3175), (0.0, 0.3175)]), 'the cap plate sits on the far end, outward')
    ok('Capped the far end with a 0.125 in plate' in note and 'cut the tube' in note and 'tee hole (cut tool)' in note, 'the J-pipe note: %s' % note[:140])
    ok(len(comp.combines) == 1 and comp.combines[0].target is tube, 'the coped end is joined to the J-pipe tube')
    sq = CT._jpipe_fittings(Comp(), data, None, None, start, up, end, d_end, 6.35, 0.1651, 60.12, [])
    ok('left square' in sq, 'without a main pipe the tee end is left square and it says how to fix that')


def frames():
    comp = Comp()
    des = Design([])
    setup(des, [])

    class M(object):
        def __init__(self, a):
            self.a = list(a)

        def copy(self):
            return M(self.a)

        def invert(self):
            # a pure translation in these tests
            for r in range(3):
                self.a[4 * r + 3] = -self.a[4 * r + 3]
            return True

        def asArray(self):
            return self.a
    occ = types.SimpleNamespace(component=comp, transform2=M([1, 0, 0, 10, 0, 1, 0, -4, 0, 0, 1, 2, 0, 0, 0, 1]))
    des.rootComponent.allOccurrences.xs.append(occ)
    fr = CT._comp_frame(comp)
    e = CT._ends_in({'tee': (15.0, 1.0, 3.0), 'tee_d': (0, 0, 1), 'cap': (20, 0, 0), 'cap_d': (1, 0, 0),
                     'main': {'p': (10.0, -4.0, 2.0), 'd': (1.0, 0.0, 0.0), 'R': 3.0}, 'note': ''}, fr)
    ok(fr is not None and near(e['tee'], (5.0, 5.0, 1.0)) and near(e['main']['p'], (0, 0, 0)) and near(e['tee_d'], (0, 0, 1)),
       'a moved component: the J-pipe\'s ends and main pipe are moved into its coordinates')
    occ.transform2 = M([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    ok(CT._comp_frame(comp) is None, 'a component at the origin needs no move')


def fallbacks():
    setup(Design([]), [])
    body = CT._cone_shell((0, 0, 0), 4.0, (0, 0, 10.0), 3.0, 0.16)
    inner = body.cuts[0][1]
    ok(body.kind == 'cyl' and abs(body.kw['r1'] - 4.0) < 1e-12 and abs(inner.kw['r1'] - (4.0 - 0.16 + 0.1 * 0.05)) < 1e-9
       and abs(inner.kw['r2'] - (3.0 - 0.16 - 0.1 * 0.05)) < 1e-9, 'collector outline: the inner cone keeps the wall square to the axis past both ends')
    g = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1), 'case0': (0, 0, 0), 'case1': (0, 0, 30.0), 'p_in': (0, 0, -5.0), 'p_out': (0, 0, 35.0)}
    pbs = CT._part_bodies({'w': 10.0, 'h': 6.0, 'body': 30.0, 'shape': 'oval', 'in_d': 6.35, 'out_d': 6.35, 'name': 'Muffler'}, g)
    pb = pbs[0]
    kinds = [t.kind for _k, t in pb.cuts]
    ok(len(pbs) == 1 and pb.kind == 'box' and abs(pb.kw['obb'][5] - (6.0 - 0.002)) < 1e-12 and kinds == ['cyl', 'cyl', 'cyl', 'cyl'] and all(k == 'union' for k, _t in pb.cuts),
       'part outline: flat-oval case (box and two round ends) with its inlet and outlet, as one body')


helmholtz_on_a_solid()
helmholtz_on_a_scan()
jpipe_fittings()
frames()
fallbacks()

def off_square_and_refusals():
    main = Tube('Main pipe', (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), R, RIN, 30.0)
    des = Design([main])
    setup(des, [])
    tilt = RT.vunit((math.sin(math.radians(5.0)), 0.0, math.cos(math.radians(5.0))))
    m = CT._main_pipe(start, tilt, {}, [])
    comp = des.rootComponent.occurrences.addNewComponent(None).component
    tube = Body('pipe')
    tube.name = 'J-pipe'
    comp.bRepBodies.xs.append(tube)
    notes = []
    note = CT._jpipe_fittings(comp, {'tee': True, 'title': 'J-pipe'}, tube, m, start, tilt, (30.0, 0.0, 12.0), (1.0, 0.0, 0.0),
                              6.35, 0.1651, 60.12, notes)
    ops = [c.operation for c in comp.combines]
    ok(ops == ['join', 'cut'] and comp.combines[1].target is tube and comp.combines[1].tools[0].name == 'J-pipe main pipe outside (cut tool)'
       and comp.combines[1].isKeepToolBodies is False, 'a J-pipe 5 deg off square: joined, then its first part cut to the main pipe (%s)' % ops)
    ok('off square' in note and 'were cut to it as well' in note, 'and the note says so: %s' % note[note.find('It leaves'):][:110])
    names = [b.name for b in comp.bRepBodies.xs]
    ok('J-pipe main pipe outside (cut tool)' not in names, 'the cutting tool is used up')

    into = sketch_line(start, (5.0, 0.0, R - 2.0))            # drawn into the pipe
    setup(des, [into])
    made0 = len(des.made)
    res = CT.dispatch('helmholtz', __import__('json').dumps({'neck_id_mm': 50.8, 'neck_len_mm': 76.2, 'wall_mm': 1.651, 'can_id_mm': 127.0,
                                                              'vol_cm3': 2934.0, 'can_wall_mm': 1.519}))
    ok(len(des.made) == made0, 'and nothing was built')
    ok(not res['ok'] and 'points into the main pipe' in res['msg'], 'a neck marker drawn into the pipe is refused: ' + res['msg'][:90])

    flanged = Tube('Pipe with a flange', (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), R, RIN, 30.0)
    flanged.faces.xs.append(Face(Cyl((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), 5.08), flanged, 30.0))
    m2 = CT._pipe_of_face(flanged.faces.item(2), start)
    ok(abs(m2['R'] - R) < 1e-12 and abs(m2['R_in'] - RIN) < 1e-12, 'a coaxial flange does not stand in for the pipe: R %.3f, bore %.3f' % (m2['R'], m2['R_in']))
    m3 = CT._pipe_of_face(flanged.faces.item(1))
    ok(abs(m3['R'] - R) < 1e-12, 'picking the bore gives the outside next to it')

    setup(Design([main]), [main.faces.item(0)])
    notes = []
    far = CT._main_pipe((5.0, 0.0, R + 0.6), up, {}, notes)
    ok(far is None and any('not where the marker starts' in n for n in notes), 'a selected face 6 mm from the marker is not used, and it says why')


def offset_part():
    setup(Design([]), [])
    x, y, z = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)
    c0 = (0.0, 0.0, 5.0)
    g = {'x': x, 'y': y, 'z': z, 'p_in': (3.5, 0.0, 0.0), 'case0': c0, 'case1': (0.0, 0.0, 35.0), 'p_out': (-3.5, 0.0, 40.0)}
    del LOG[:]
    out = CT._part_bodies({'w': 25.4, 'h': 11.43, 'body': 30.0, 'shape': 'oval', 'in_d': 5.08, 'out_d': 5.08, 'name': 'Muffler'}, g)
    cyls = [e[1] for e in LOG if e[0] == 'cyl']
    stubs = [b for b in cyls if abs(b.kw['r1'] - 2.54) < 1e-9]
    ok(len(out) == 1 and len(stubs) == 2 and near(stubs[0].kw['p1'], (3.5, 0, 0)) and near(stubs[0].kw['p2'], (3.5, 0, 5.0))
       and near(stubs[1].kw['p1'], (-3.5, 0, 35.0)) and near(stubs[1].kw['p2'], (-3.5, 0, 40.0)),
       'offset ports: each stub runs along the part from its own port')
    boxes = [e for e in LOG if e[0] == 'bool']
    ok(all(k == 'union' for _x, k, _t, _u in boxes), 'one body')


def buildable_route():
    """Live in Fusion 2026-11-02 an auto-routed J-pipe failed to build. Two things: a bend of a tenth of a millimetre where
    a straight leaves its fixed point (Fusion's three-point arc check fails on it) is folded into the straight; and a
    route whose bends overlap (the fit could not finish it) is refused with a plain reason instead of a crash."""
    total = lambda es: sum(RT.elem_len(e) for e in es)
    elems = RT.chain_geometry([(0.0, 0.0, 0.0), (0.0, 0.0, 10.0), (0.002, 0.0, 30.0), (20.0, 0.0, 30.0)], 5.0)['elems']
    small = [e for e in elems if e[0] != 'line' and e[5] < 0.05]
    out = CT._buildable(elems)
    ok(len(small) == 1 and not any(e[0] != 'line' and e[5] < 0.05 for e in out) and len(out) == len(elems) - 2
       and abs(total(out) - total(elems)) < 1e-6 and all(RT.vdist(a[2], b[1]) < 1e-9 for a, b in zip(out, out[1:]))
       and out[0][1] == elems[0][1] and out[-1][2] == elems[-1][2],
       'a %.3f mm bend on a straight is folded into it (%d elements to %d, length and ends kept)'
       % (10 * small[0][5] if small else -1, len(elems), len(out)))
    plain = RT.chain_geometry([(0, 0, 0), (0, 0, 10), (10, 0, 20), (30, 0, 20)], 5.0)['elems']
    ok(CT._buildable(plain) == plain, 'a route with real bends is built as planned')
    # the live case: 90 deg of 9.5 cm radius between points 10.8 cm apart overlaps the bend before it
    folded = RT.chain_geometry([(10.0, 0.0, 3.175), (10.0, 0.0, 5.715), (9.99, 0.0, 13.999), (25.0, 0.0, 14.0)], 9.525)['elems']
    try:
        CT._build_route(None, {'elems': folded, 'msg': 'A straight is 1.92 cm where 2.54 cm is needed.'}, 'J-pipe', 6.35, 0.1651, 'jp')
        why = None
    except ValueError as ex:
        why = str(ex)
    ok(why is not None and 'overlap' in why and 'fold back' in why, 'a route whose bends overlap is refused: %s' % (why or 'built')[:90])


def tack_jig():
    """act_jig on the tubes the last auto-route built: one body per cradle in a new component, each a block joined to
    its foot, cut by the tube (cylinders and joint balls) and by two bolt holes; the message says what was built."""
    design = Design()
    CT._app = types.SimpleNamespace(activeProduct=design)
    CT._ui = types.SimpleNamespace(activeSelections=Sel([]), palettes=types.SimpleNamespace(itemById=lambda i: None))
    del CT._LAST_TUBES[:]
    try:
        CT.act_jig({})
        why = None
    except ValueError as ex:
        why = str(ex)
    ok(why is not None and 'auto-route' in why, 'nothing selected and nothing routed: says what to do (%s)' % (why or 'built')[:70])
    R = 6.65
    a = math.pi / 2
    CT._LAST_TUBES.extend([{'name': 'Primary 1', 'od': 4.445, 'elems': [
        ('line', (0.0, 0.0, 10.0), (20.0, 0.0, 10.0), 20.0),
        ('arc', (20.0, 0.0, 10.0), (20.0 + R, R, 10.0), (20.0, R, 10.0), a, R * a, (0.0, -1.0, 0.0), (1.0, 0.0, 0.0))]}])
    del LOG[:]
    res = CT.act_jig({'title': 'Tack jig'})
    comp = design.made[-1]
    bodies = comp.bRepBodies.xs
    plan = CT.JIG.plan(CT._LAST_TUBES)
    ok(res['ok'] and len(bodies) == len(plan['cradles']) == res['jig']['count'] == 3, '%d cradles built as %d bodies' % (res['jig']['count'], len(bodies)))
    ok(all(b.name.startswith('Cradle ') and 'Primary 1 at' in b.name for b in bodies), 'named: ' + ', '.join(b.name for b in bodies))
    unions = [c for b in bodies for c in b.cuts if c[0] == 'union']
    diffs = [c for b in bodies for c in b.cuts if c[0] == 'diff']
    ok(len(unions) == 3 and all(u[1].kind == 'box' for u in unions), 'each block joined to its foot')
    holes = [d for d in diffs if d[1].kind == 'cyl' and abs(d[1].kw['r1'] - 0.33) < 1e-9]
    saddle = [d for d in diffs if d[1].kind == 'cyl' and abs(d[1].kw['r1'] - (4.445 / 2 + 0.025)) < 1e-9]
    balls = [d for d in diffs if d[1].kind == 'sphere']
    ok(len(holes) == 6, 'two M6 clearance holes per foot')
    ok(len(saddle) > 3 * 5 and len(balls) > 3 * 5, 'saddles cut by %d tube cylinders and %d joint balls' % (len(saddle), len(balls)))
    ok('Built 3 cradles for the tubes the last auto-route built' in res['msg'] and 'M6' in res['msg'], res['msg'][:110])


def route_triy_glue():
    """act_route mode 'triy': the markers split into ports, Y markers and the collector; every primary and secondary is
    built at its own OD, the Y merges and the collector revolved; a wrong marker count is refused with the order."""
    design = Design()
    setup(design, [])
    ports = [((0.0, 4.0 + 10.0 * i, 0.0), (1.0, 0.0, 0.0)) for i in range(4)]
    ys = [((26.0, 9.0, -14.0), RT.vunit((0.4, 0.0, -1.0))), ((26.0, 29.0, -14.0), RT.vunit((0.4, 0.0, -1.0)))]
    col = ((40.0, 19.0, -55.0), (0.0, 0.0, -1.0))
    mks = [{'p': p, 'd': d, 'signed': True} for p, d in ports + ys + [col]]
    built = []
    saved = (CT._markers, CT._scene, CT._build_route)
    CT._markers = lambda: [dict(m) for m in mks]
    def scene(lo, hi, pad, notes):
        sc = RT.Scene(cell=1.0)
        sc.build(lo, hi, pad)
        return sc
    CT._scene = scene
    def br(comp, r, name, od, wall, pbase):
        built.append((name, od, r['length']))
        return {'path': 'sketch', 'param': True, 'body': None}
    CT._build_route = br
    data = {'mode': 'triy', 'title': 'Two-stage header', 'groups': [[0, 1], [2, 3]], 'od_mm': 41.28, 'wall_mm': 1.651,
            'target_mm': 400.0, 'y_len_mm': 24.0, 'sec_target_mm': 500.0, 'sec_od_mm': 50.8, 'collector_len_mm': 100.0,
            'collector_out_mm': 76.2, 'gap_mm': 12.7}
    try:
        res = CT.act_route(data)
        bad = None
        try:
            CT._markers = lambda: [dict(m) for m in mks[:-2]]
            CT.act_route(data)
        except ValueError as ex:
            bad = str(ex)
    finally:
        CT._markers, CT._scene, CT._build_route = saved
    prim = [b for b in built if b[0].startswith('Primary')]
    sec = [b for b in built if b[0].startswith('Secondary')]
    ok(len(prim) == 4 and all(abs(b[1] - 4.128) < 1e-9 for b in prim) and all(abs(b[2] - 40.0) < 0.06 for b in prim),
       'four primaries at 1.625 in OD, 40 cm each: %s' % [round(b[2], 2) for b in prim])
    ok(len(sec) == 2 and all(abs(b[1] - 5.08) < 1e-9 for b in sec), 'two secondaries at 2 in OD: %s' % [round(b[2], 2) for b in sec])
    comp = design.made[-1]
    ok(len(comp.revolves) == 3, 'two Y merges and the collector revolved (%d)' % len(comp.revolves))
    ok('Y merges' in res['msg'] and 'valve-to-collector length is as asked' in res['msg'], res['msg'][:140])
    ok(bad is not None and 'in cylinder order' in bad and '7 markers in all' in bad, 'a wrong marker count is refused: %s' % (bad or '')[:90])


off_square_and_refusals()
offset_part()
buildable_route()
tack_jig()
route_triy_glue()
print('FAILS:', fails)
sys.exit(1 if fails else 0)
