"""cadtools.act_cfd_tube ("Test this intake (CFD)" and "Use this tube in the Intake tab": the selected tube read as the
CFD generator's design) against a stand-in for adsk that follows the API reference's return types (curve evaluators
return (ok, value) tuples, lengths are cm, Selection.point is a Point3D, Torus has origin/axis/majorRadius/minorRadius).
It cannot show what Fusion itself returns (tests/fusion_live_intakecfd.py does that), but it runs the real glue:
  - the owner's reference tube, its Pipe path found from the body, clicked near the mouth: the same design the pure
    tubecfd gets from the exact curves (bends, length, bore, wall),
  - a path that runs on past the tube (into the throttle body) trimmed to the tube; clicked near the far end, or the
    far end face clicked, the air enters there; 'the other end' flips it,
  - its centreline curves selected by hand, shuffled, one reversed, the bends as NURBS: the same design,
  - a body picked through a moved occurrence (its Pipe path in the component's space): the same design,
  - a fillet on the mouth's inside edge read as the lip radius,
  - refused, in a sentence: a tapered bore, an oval bore, a mesh body, nothing selected, two bodies, no path, curves
    that do not run in the tube.
   python3 tests/test_intakecfd_fusion_fake.py"""
import math
import os
import random
import sys
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


core.Point3D, core.Vector3D = P3, P3
core.SurfaceTypes = types.SimpleNamespace(CylinderSurfaceType='cyl', PlaneSurfaceType='plane', TorusSurfaceType='torus', ConeSurfaceType='cone')
INSIDE, OUTSIDE = 'in', 'out'
fusion.PointContainment = types.SimpleNamespace(PointInsidePointContainment=INSIDE, PointOutsidePointContainment=OUTSIDE)

import cadtools as CT     # noqa: E402
import tubecfd as TC      # noqa: E402

add, sub, mul, dot, cross, unit, rot = TC._add, TC._sub, TC._mul, TC._dot, TC._cross, TC._unit, TC.rotate
dist = lambda a, b: TC._len(sub(a, b))


class Coll(list):
    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


# ---------------------------------------------------------------- an exact centreline (mm) and its sketch curves (cm)
def owner_segments(extra_end=0.0):
    I = (-673.7, -493.2, -233.9)
    A1, B1 = (-592.8, -456.0, -188.4), (-532.6, -441.9, -169.7)
    A2, B2 = (-128.7, -421.5, -126.6), (-10.5, -302.2, -99.3)
    O = (-5.7, -181.26, -83.14)
    d0, d1, d2 = unit(sub(A1, I)), unit(sub(A2, B1)), unit(sub(O, B2))
    segs, p, t = [], I, d0

    def line(L):
        nonlocal p
        segs.append({'kind': 'line', 'a': p, 'b': add(p, mul(t, L)), 't': t, 'L': L})
        p = segs[-1]['b']

    def arc(R, d):
        nonlocal p, t
        k = unit(sub(d, mul(t, dot(d, t))))
        n = unit(cross(t, k))
        c = add(p, mul(k, R))
        th = math.acos(max(-1, min(1, dot(t, d))))
        b = add(c, rot(sub(p, c), n, th))
        segs.append({'kind': 'arc', 'a': p, 'b': b, 'c': c, 'n': n, 'R': R, 'th': th, 'L': R * th})
        p, t = b, rot(t, n, th)
    line(dist(I, A1))
    arc(127.0, d1)
    line(dist(B1, A2))
    arc(127.0, d2)
    line(dist(B2, O) + extra_end)
    return segs


def seg_point(g, d):
    if g['kind'] == 'line':
        return add(g['a'], mul(g['t'], d))
    return add(g['c'], rot(sub(g['a'], g['c']), g['n'], d / g['R']))


class CurveEval(object):
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
    def __init__(self, geo, kind='SketchLine'):
        self.worldGeometry = geo
        self.objectType = 'adsk::fusion::' + kind


def sketch_curves(segs, xf=lambda p: p, reverse_one=None):
    """Sketch curves (cm) for the segments; xf maps the points (a component's space). Arcs come over as NURBS with a
    parameter 0..2 that is not their length."""
    out = []
    for k, g in enumerate(segs):
        L = g['L']
        rev = k == reverse_one
        if g['kind'] == 'line':
            f = (lambda g, L, rev: lambda t: tuple(c / 10.0 for c in xf(seg_point(g, (L - t * 10) if rev else t * 10))))(g, L, rev)
            out.append(SketchEnt(Curve('Line3D', CurveEval(f, 0.0, L / 10.0, 1.0))))
        else:
            f = (lambda g, L, rev: lambda t: tuple(c / 10.0 for c in xf(seg_point(g, L * ((2 - t) if rev else t) / 2.0))))(g, L, rev)
            out.append(SketchEnt(Curve('NurbsCurve3D', CurveEval(f, 0.0, 2.0, L / 20.0)), 'SketchArc'))
    return out


# ---------------------------------------------------------------- the tube body
class Geo(object):
    def __init__(self, kind, **kw):
        self.surfaceType = kind
        self.__dict__.update(kw)


class Face(object):
    objectType = 'adsk::fusion::BRepFace'

    def __init__(self, body, geo):
        self.body, self.geometry = body, geo


class BBox(object):
    def __init__(self, lo, hi):
        self.lo, self.hi = lo, hi

    def contains(self, q):
        return all(self.lo[i] - 1e-9 <= c <= self.hi[i] + 1e-9 for i, c in enumerate((q.x, q.y, q.z)))


class PipeFeature(object):
    def __init__(self, ents):
        self.path = Coll(types.SimpleNamespace(entity=e) for e in ents)


class TubeBody(object):
    """A tube of bore r_in(s) and outside r_out round the exact segments (mm; the API sees cm). taper: (s from, mm of
    radius per mm); oval: the bore stretched by this factor across one direction past the middle; lip: a fillet of that
    radius on the mouth's inside edge (the mouth at s = 0); xf: where the body sits (a moved occurrence's transform)."""
    objectType = 'adsk::fusion::BRepBody'

    def __init__(self, segs, r_in, r_out, path_ents=(), taper=None, oval=None, lip=None, xf=None, inv=None, name='INTAKE TUBE'):
        self.segs, self.r_in, self.r_out, self.taper, self.oval, self.lip = segs, r_in, r_out, taper, oval, lip
        self.L = sum(g['L'] for g in segs)
        self.xf, self.inv = xf or (lambda p: p), inv or (lambda p: p)
        self.name, self.isSolid, self.assemblyContext, self.nativeObject = name, True, None, None
        self.entityToken = name + str(id(self))
        faces = []
        for g in segs:
            if g['kind'] == 'line':
                for r in (r_in, r_out):
                    faces.append(Face(self, Geo('cyl', origin=P3(*[c / 10 for c in self.xf(g['a'])]), axis=P3(*g['t']), radius=r / 10.0)))
            else:
                for r in (r_in, r_out):
                    faces.append(Face(self, Geo('torus', origin=P3(*[c / 10 for c in self.xf(g['c'])]), axis=P3(*g['n']), majorRadius=g['R'] / 10.0, minorRadius=r / 10.0)))
        a0, t0 = segs[0]['a'], segs[0]['t']
        if lip:
            faces.append(Face(self, Geo('torus', origin=P3(*[c / 10 for c in self.xf(add(a0, mul(t0, lip)))]), axis=P3(*t0),
                                        majorRadius=(r_in + lip) / 10.0, minorRadius=lip / 10.0)))
        faces.append(Face(self, Geo('plane', origin=P3(*[c / 10 for c in self.xf(a0)]), normal=P3(*t0))))
        self.end_face = Face(self, Geo('plane', origin=P3(*[c / 10 for c in self.xf(segs[-1]['b'])]), normal=P3(*segs[-1]['t'])))
        faces.append(self.end_face)
        self.faces = Coll(faces)
        pts = [self.xf(seg_point(g, g['L'] * i / 8)) for g in segs for i in range(9)]
        lo = [min(p[i] for p in pts) / 10 - r_out / 10 for i in range(3)]
        hi = [max(p[i] for p in pts) / 10 + r_out / 10 for i in range(3)]
        self.boundingBox = BBox(lo, hi)
        self.parentComponent = types.SimpleNamespace(features=types.SimpleNamespace(pipeFeatures=Coll(PipeFeature(path_ents) for _ in [0] if path_ents)))

    def _near(self, p):
        """(distance from the centreline, s, the radial vector) or None past either free end."""
        best, at = None, 0.0
        for k, g in enumerate(self.segs):
            if g['kind'] == 'line':
                u = dot(sub(p, g['a']), g['t'])
                if (k == 0 and u < 0) or (k == len(self.segs) - 1 and u > g['L']):
                    cand = (1e9, None, None)
                else:
                    u = max(0.0, min(g['L'], u))
                    q = seg_point(g, u)
                    cand = (dist(p, q), at + u, sub(p, q))
            else:
                v = sub(p, g['c'])
                vp = sub(v, mul(g['n'], dot(v, g['n'])))
                ra = sub(g['a'], g['c'])
                ang = math.atan2(dot(cross(ra, vp), g['n']), dot(ra, vp)) % (2 * math.pi)
                ang = ang if ang <= g['th'] else (g['th'] if ang - g['th'] < 2 * math.pi - ang else 0.0)
                q = seg_point(g, g['R'] * ang)
                cand = (dist(p, q), at + g['R'] * ang, sub(p, q))
            if best is None or cand[0] < best[0]:
                best = cand
            at += g['L']
        return best if best and best[1] is not None else None

    def pointContainment(self, pt):
        p = self.inv((pt.x * 10, pt.y * 10, pt.z * 10))
        nb = self._near(p)
        if nb is None:
            return OUTSIDE
        d, s, rv = nb
        ri = self.r_in
        if self.taper and s > self.taper[0]:
            ri += (s - self.taper[0]) * self.taper[1]
        if self.oval and s > self.L / 2:
            # the bore stretched across one direction: r_in * f along e, r_in across
            e = unit(cross(self.segs[-1]['t'], (0.0, 0.0, 1.0)))
            x = dot(rv, e) / self.oval
            d = math.sqrt(max(0.0, d * d - dot(rv, e) ** 2 + x * x))
        if not (ri < d < self.r_out):
            return OUTSIDE
        if self.lip and s < self.lip and (s - self.lip) ** 2 + (d - (ri + self.lip)) ** 2 < self.lip ** 2 and d < ri + self.lip:
            return OUTSIDE
        return INSIDE


class Sel(object):
    def __init__(self, ent, point=None):
        self.entity, self.point = ent, (P3(*[c / 10 for c in point]) if point is not None else None)


def select(*sels):
    CT._ui = types.SimpleNamespace(activeSelections=Coll(sels))


def outside_point(body, segs, s, ang=0.7):
    """A point on the tube's outside face s mm along it (as Fusion gives Selection.point, cm)."""
    p, t = TC.point_at(segs_tc(segs), s)
    u, v = CT.PS._perp(t)
    return body.xf(tuple(p[k] + body.r_out * (math.cos(ang) * u[k] + math.sin(ang) * v[k]) for k in range(3)))


def segs_tc(segs):
    out = []
    for g in segs:
        if g['kind'] == 'line':
            out.append({'kind': 'line', 'a': g['a'], 'b': g['b'], 't0': g['t'], 't1': g['t'], 'length': g['L']})
        else:
            t0 = unit(cross(g['n'], sub(g['a'], g['c'])))
            out.append({'kind': 'arc', 'a': g['a'], 'b': g['b'], 'c': g['c'], 'R': g['R'], 'n': g['n'], 'angle': math.degrees(g['th']),
                        't0': t0, 't1': rot(t0, g['n'], g['th']), 'length': g['L']})
    return out


def run(data=None):
    return CT.dispatch('cfdTube', __import__('json').dumps(data or {}))


R_IN, R_OUT = 92.61 / 2, 92.61 / 2 + 4.76
segs = owner_segments()
want_geo, want_info = TC.design_geometry(segs_tc(segs), 92.61, 4.76)

# ---------------------------------------------------------------- 1. the owner's tube, its Pipe path found from the body
body = TubeBody(segs, R_IN, R_OUT, path_ents=sketch_curves(segs))
side = Face(body, body.faces[1].geometry)
select(Sel(side, outside_point(body, segs, 50.0)))
r = run()
t = r.get('tube') or {}
g = t.get('geometry') or {}
ok(r.get('ok') and g.get('tube_diameter_mm') == 92.61 and g.get('inlet') == {'type': 'plain', 'wall_thickness_mm': 4.76},
   'Pipe path found from the body; bore 92.61 mm and a plain mouth with the 4.76 mm wall (%s)' % (r.get('msg') or '')[:160])
gb = g.get('bend') or []
ok(len(gb) == 2 and all(abs(a[k] - b[k]) < 0.02 for a, b in zip(gb, want_geo['bend']) for k in ('clr_mm', 'angle_deg', 'start_mm', 'plane_deg'))
   and abs(g['tube_length_mm'] - want_geo['tube_length_mm']) < 0.02,
   'the same design as the exact curves give: %s, %.2f mm' % ('; '.join('%.2f deg at %.1f mm, plane %.2f' % (b['angle_deg'], b['start_mm'], b['plane_deg']) for b in gb), g.get('tube_length_mm', 0)))
ok(abs(gb[0]['angle_deg'] - 29.5) < 0.1 and abs(gb[1]['angle_deg'] - 84.1) < 0.1 and abs(gb[0]['start_mm'] - 100.0) < 0.2 and abs(gb[1]['start_mm'] - 572.1) < 0.3,
   'about 30 deg at about 100 mm and 84 deg at about 572 mm, from the mouth that was clicked near')
ok(t.get('fill', {}).get('bend_angles') == [29.5, 84.1] and t['fill']['bend_r_mm'] == 127.0 and 'mm (' in r['msg'] and ' in)' in r['msg'],
   'the Intake tab inputs come with it; the message gives mm and inches')

# ---------------------------------------------------------------- 2. a path past the tube; which end
segs_long = owner_segments(extra_end=40.0)
body2 = TubeBody(segs, R_IN, R_OUT, path_ents=sketch_curves(segs_long))
select(Sel(Face(body2, body2.faces[1].geometry), outside_point(body2, segs, 30.0)))
r2 = run()
t2 = r2.get('tube') or {}
ok(r2.get('ok') and abs(t2['geometry']['tube_length_mm'] - want_geo['tube_length_mm']) < 0.05 and abs(t2['path_beyond_mm'][1] - 40.0) < 0.05,
   'a Pipe path 40 mm past the tube (into the throttle body): trimmed to the tube (%.2f mm; %.2f mm cut off)' % (t2['geometry']['tube_length_mm'], t2['path_beyond_mm'][1]))
select(Sel(Face(body, body.faces[1].geometry), outside_point(body, segs, 830.0)))
r3 = run()
ok(r3.get('ok') and [round(b['angle_deg']) for b in r3['tube']['geometry']['bend']] == [84, 30] and 'nearer where the tube was clicked' in r3['tube']['mouth_how'],
   'clicked near the far end: the air enters there (84 then 30 deg)')
r4 = run({'mouth': 'other'})
ok(r4.get('ok') and [round(b['angle_deg']) for b in r4['tube']['geometry']['bend']] == [30, 84], '"the other end" flips it back')
select(Sel(body.end_face, body.xf(add(segs[-1]['b'], (1.0, 1.0, 0.0)))))
r5 = run()
ok(r5.get('ok') and [round(b['angle_deg']) for b in r5['tube']['geometry']['bend']] == [84, 30] and dist(r5['tube']['mouth_mm'], segs[-1]['b']) < 0.05,
   'the far end face clicked: the mouth is at that end (%s)' % r5['tube']['mouth_mm'])

# ---------------------------------------------------------------- 3. the centreline selected by hand
cur = sketch_curves(segs, reverse_one=2)
random.Random(3).shuffle(cur)
body3 = TubeBody(segs, R_IN, R_OUT)          # not made with Pipe: no pipe feature
select(Sel(Face(body3, body3.faces[1].geometry), outside_point(body3, segs, 20.0)), *[Sel(c) for c in cur])
r6 = run()
g6 = (r6.get('tube') or {}).get('geometry') or {}
ok(r6.get('ok') and all(abs(a['angle_deg'] - b['angle_deg']) < 0.02 and abs(a['start_mm'] - b['start_mm']) < 0.02 and abs(a['plane_deg'] - b['plane_deg']) < 0.02
                        for a, b in zip(g6.get('bend', []), want_geo['bend'])),
   'the centreline curves Ctrl+clicked, shuffled, one reversed, the bends as NURBS: the same design')

# ---------------------------------------------------------------- 4. a moved occurrence
ang = math.radians(35.0)
ca, sa = math.cos(ang), math.sin(ang)
T = (250.0, -120.0, 40.0)                   # mm
M = [ca, -sa, 0, T[0] / 10, sa, ca, 0, T[1] / 10, 0, 0, 1, T[2] / 10, 0, 0, 0, 1]
fwd = lambda p: (ca * p[0] - sa * p[1] + T[0], sa * p[0] + ca * p[1] + T[1], p[2] + T[2])
inv = lambda p: (ca * (p[0] - T[0]) + sa * (p[1] - T[1]), -sa * (p[0] - T[0]) + ca * (p[1] - T[1]), p[2] - T[2])
native = TubeBody(segs, R_IN, R_OUT, path_ents=sketch_curves(segs))
proxy = TubeBody(segs, R_IN, R_OUT, xf=fwd, inv=inv)
proxy.assemblyContext = types.SimpleNamespace(transform2=types.SimpleNamespace(asArray=lambda: M), name='intake:1')
proxy.nativeObject = native
select(Sel(Face(proxy, proxy.faces[1].geometry), outside_point(proxy, segs, 40.0)))
r7 = run()
g7 = (r7.get('tube') or {}).get('geometry') or {}
ok(r7.get('ok') and all(abs(a['angle_deg'] - b['angle_deg']) < 0.02 and abs(a['start_mm'] - b['start_mm']) < 0.02 for a, b in zip(g7.get('bend', []), want_geo['bend']))
   and dist(r7['tube']['mouth_mm'], fwd(segs[0]['a'])) < 0.05,
   'a tube in a moved component (turned 35 deg, moved 250, -120, 40 mm): its Pipe path taken into the assembly\'s space, the same design')

# ---------------------------------------------------------------- 5. a lip
body8 = TubeBody(segs, R_IN, R_OUT, path_ents=sketch_curves(segs), lip=3.5)
select(Sel(Face(body8, body8.faces[1].geometry), outside_point(body8, segs, 60.0)))
r8 = run()
ok(r8.get('ok') and r8['tube']['geometry']['inlet'] == {'type': 'radius', 'lip_radius_mm': 3.5} and abs(r8['tube']['geometry']['tube_length_mm'] - want_geo['tube_length_mm']) < 0.05,
   'a 3.5 mm fillet on the mouth\'s inside edge: a radius inlet, the length unchanged (%s)' % (r8.get('msg') or '')[-120:])

# ---------------------------------------------------------------- 6. refusals
def refused(want, what, data=None):
    rr = run(data)
    wants = want if isinstance(want, tuple) else (want,)
    ok(rr.get('ok') is False and any(w in (rr.get('msg') or '') for w in wants) and 'Traceback' not in (rr.get('msg') or ''), '%s: "%s"' % (what, rr.get('msg')))


bt = TubeBody(segs, R_IN, R_OUT, path_ents=sketch_curves(segs), taper=(450.0, 0.02))
select(Sel(Face(bt, bt.faces[1].geometry), outside_point(bt, segs, 20.0)))
refused('not the same round size all along', 'a bore that tapers from 450 mm on')
bo = TubeBody(segs, R_IN, R_OUT, path_ents=sketch_curves(segs), oval=1.06)
select(Sel(Face(bo, bo.faces[1].geometry), outside_point(bo, segs, 20.0)))
refused('not the same round size all along', 'a bore squashed 6% oval past the middle')
mesh = types.SimpleNamespace(objectType='adsk::fusion::MeshBody', entityToken='m')
select(Sel(mesh))
refused('mesh body', 'a mesh body (a scan)')
select()
refused('Select the intake tube first', 'nothing selected')
b2 = TubeBody(segs, R_IN, R_OUT, name='OTHER')
select(Sel(Face(body, body.faces[1].geometry)), Sel(Face(b2, b2.faces[1].geometry)))
refused('2 bodies are selected', 'two bodies')
select(Sel(Face(body3, body3.faces[1].geometry), outside_point(body3, segs, 20.0)))
refused('No Pipe path found', 'a tube not made with Pipe and no centreline selected')
away = [{'kind': 'line', 'a': (0.0, 0.0, 0.0), 'b': (500.0, 0.0, 0.0), 't': (1.0, 0.0, 0.0), 'L': 500.0}]
select(Sel(Face(body3, body3.faces[1].geometry)), Sel(sketch_curves(away)[0]))
refused(('do not run inside this tube', 'Could not find the tube wall around the path'), 'a centreline from somewhere else')

print('test_intakecfd_fusion_fake: ' + ('%d FAIL' % len(FAILS) if FAILS else 'all pass'))
sys.exit(1 if FAILS else 0)
