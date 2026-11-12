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
  - the bore probed from the centreline: the owner's tube with a 60 mm cone to a 105 mm throttle bore joined on past its
    Pipe path (diameter_change, the tract end half a tube bore past the throttle face, the tab's throttle bore), the same
    with a 3.5 mm lip fillet, beads / hose barbs / a filter cuff on the outside (no change), a bellmouth ahead of the path,
  - two diameter changes (a reducer mid-run and the cone to the throttle) as the generator's diameter_change list,
  - the mount: flange by default, free on request, auto (free unless another body is against the mouth face),
  - a taper into a bend read as a cone on the bend; refused, in a sentence: an oval bore, an unknown mount, a mesh body, nothing selected, two
    bodies, no path, curves that do not run in the tube.
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

    def __init__(self, segs, r_in, r_out, path_ents=(), taper=None, oval=None, lip=None, xf=None, inv=None, name='INTAKE TUBE',
                 bore=None, outer=None):
        self.segs, self.r_in, self.r_out, self.taper, self.oval, self.lip = segs, r_in, r_out, taper, oval, lip
        self.bore, self.outer = bore, outer            # the bore and outside radius as functions of s (mm), when not constant
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
        ri = self.bore(s) if self.bore else self.r_in
        if self.taper and s > self.taper[0]:
            ri += (s - self.taper[0]) * self.taper[1]
        if self.oval and s > self.L / 2:
            # the bore stretched across one direction: r_in * f along e, r_in across
            e = unit(cross(self.segs[-1]['t'], (0.0, 0.0, 1.0)))
            x = dot(rv, e) / self.oval
            d = math.sqrt(max(0.0, d * d - dot(rv, e) ** 2 + x * x))
        if not (ri < d < (self.outer(s) if self.outer else self.r_out)):
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

# ---------------------------------------------------------------- 6. the bore: a cone past the Pipe path, a lip, beads, a bellmouth
L_own = sum(g['L'] for g in segs)
segs_c = owner_segments(extra_end=60.0)            # the body runs 60 mm on past its Pipe path: the cone to the throttle
cone = lambda s: R_IN + (52.5 - R_IN) * min(1.0, max(0.0, (s - L_own) / 60.0))
bc = TubeBody(segs_c, R_IN, R_OUT, path_ents=sketch_curves(segs), bore=cone, outer=lambda s: cone(s) + 4.76)
select(Sel(Face(bc, bc.faces[1].geometry), outside_point(bc, segs, 50.0)))
rc = run()
tc = rc.get('tube') or {}
gc = tc.get('geometry') or {}
dcc = gc.get('diameter_change') or {}
ok(rc.get('ok') and dcc.get('to_diameter_mm') == 105.0 and abs(dcc.get('start_mm', 0) - L_own) < 0.05 and abs(dcc.get('cone_half_angle_deg', 0) - 5.895) < 0.02
   and abs(tc['body_beyond_path_mm'][1] - 60.0) < 0.05,
   'the owner\'s tube with a 60 mm cone (92.61 to 105 mm) joined on past its Pipe path: found (%.2f mm past the path), diameter_change %s' % (tc.get('body_beyond_path_mm', [0, 0])[1], dcc))
ok(abs(gc.get('tube_length_mm', 0) - (L_own + 60 + 46.305)) < 0.06 and set(gc.get('planes_mm', {})) == {'tube_end', 'throttle_face'}
   and [round(b['angle_deg'], 1) for b in gc.get('bend', [])] == [29.5, 84.1] and tc['cone']['at_throttle'],
   'the tract end half a tube bore past the throttle face (%.2f mm), planes at the cone\'s ends, the bends unchanged' % gc.get('tube_length_mm', 0))
f = tc.get('fill') or {}
ok(f.get('tb_mm') == 105.0 and f.get('lt_mm') == round(gc.get('tube_length_mm', 0), 2) and f.get('dt_mm') == 92.61 and '105.00 mm (4.1339 in)' in rc.get('msg', '')
   and tc.get('probes', 0) > 100 and tc.get('read_s') is not None,
   'the Intake tab gets the 105 mm throttle bore; the message says it in mm and inches; %d probes, %.2f s' % (tc.get('probes', 0), tc.get('read_s', 0)))
FIX_CONE = tc
bl_ = TubeBody(segs_c, R_IN, R_OUT, path_ents=sketch_curves(segs), bore=cone, outer=lambda s: cone(s) + 4.76, lip=3.5)
select(Sel(Face(bl_, bl_.faces[1].geometry), outside_point(bl_, segs, 50.0)))
rl = run()
gl = (rl.get('tube') or {}).get('geometry') or {}
ok(rl.get('ok') and gl.get('inlet') == {'type': 'radius', 'lip_radius_mm': 3.5} and gl.get('diameter_change') == dcc and rl['tube']['fill']['mouth'] == 'radius'
   and rl['tube']['fill']['lip_mm'] == 3.5, 'and with a 3.5 mm fillet on the mouth\'s inside edge (its torus face): a radius inlet of exactly 3.5 mm, the same cone')
beads = lambda s: R_OUT + (3.0 if (s % 200.0) < 6.0 else 0.0) + (6.0 if s < 25.0 else 0.0) + (2.0 * ((s - 820.0) % 8.0) / 8.0 if s > 820.0 else 0.0)
bb = TubeBody(segs, R_IN, R_OUT, path_ents=sketch_curves(segs), outer=beads)
select(Sel(Face(bb, bb.faces[1].geometry), outside_point(bb, segs, 50.0)))
rb = run()
ok(rb.get('ok') and rb['tube']['geometry'] == r['tube']['geometry'], 'beads every 200 mm, hose barbs on the last 60 mm and a 25 mm filter cuff on the outside: the same design as the plain tube')
st = [{'kind': 'line', 'a': (0.0, 0.0, 0.0), 'b': (0.0, 0.0, 440.0), 't': (0.0, 0.0, 1.0), 'L': 440.0}]
st_path = [{'kind': 'line', 'a': (0.0, 0.0, 40.0), 'b': (0.0, 0.0, 440.0), 't': (0.0, 0.0, 1.0), 'L': 400.0}]
h_ = 0.25 * 92.61
bell = lambda s: (R_IN + h_ - h_ * math.sqrt(max(0.0, 1 - ((40.0 - s) / 40.0) ** 2))) if s < 40.0 else R_IN
be = TubeBody(st, R_IN, R_OUT, path_ents=sketch_curves(st_path), bore=bell, outer=lambda s: R_IN + h_ + 3.0, name='STACK')
select(Sel(Face(be, be.faces[1].geometry), (0.0, R_OUT + 20.0, 5.0)))
rbe = run()
ib = ((rbe.get('tube') or {}).get('geometry') or {}).get('inlet') or {}
ok(rbe.get('ok') and ib.get('type') == 'ellipse' and ib.get('exit_diameter_mm') == 92.61 and abs(ib['length_mm'] - 40.0) < 0.5 and abs(ib['entry_diameter_mm'] - 138.91) < 0.5 and rbe['tube']['fill']['mouth'] == 'ellipse'
   and 'elliptical bellmouth' in rbe.get('msg', ''), 'an elliptical bellmouth (40 mm, 138.9 mm entry) joined on ahead of the path: %s; the tab gets "Elliptical bellmouth" (%s)' % (ib, rbe.get('msg')))

# a reducer mid-run (92.61 -> 80 mm over 30 mm from 200 mm) and the cone at the end (80 -> 105 mm over 60 mm past the
# Pipe path): two diameter changes, each from the bore before it (the generator's diameter_change list)
two = lambda s: 40.0 + 12.5 * min(1.0, (s - L_own) / 60.0) if s > L_own else (40.0 if s > 230 else (R_IN - (R_IN - 40.0) * (s - 200) / 30.0 if s > 200 else R_IN))
b2c = TubeBody(segs_c, R_IN, R_OUT, path_ents=sketch_curves(segs), bore=two, outer=lambda s: two(s) + 4.76)
select(Sel(Face(b2c, b2c.faces[1].geometry), outside_point(b2c, segs, 50.0)))
r2c = run()
t2c = r2c.get('tube') or {}
dl = (t2c.get('geometry') or {}).get('diameter_change')
ok(r2c.get('ok') and isinstance(dl, list) and len(dl) == 2 and dl[0]['to_diameter_mm'] == 80.0 and abs(dl[0]['start_mm'] - 200.0) < 0.1
   and abs(dl[0]['cone_half_angle_deg'] - math.degrees(math.atan(6.305 / 30.0))) < 0.05 and dl[1]['to_diameter_mm'] == 105.0
   and abs(dl[1]['start_mm'] - L_own) < 0.1 and abs(dl[1]['cone_half_angle_deg'] - math.degrees(math.atan(12.5 / 60.0))) < 0.05
   and set(t2c['geometry']['planes_mm']) == {'reducer_in', 'reducer_out', 'tube_end', 'throttle_face'}
   and t2c['fill']['tb_mm'] == 105.0 and t2c['fill']['reducer']['to_mm'] == 80.0 and len(t2c['cones']) == 2,
   'a reducer mid-run and the cone at the end: two diameter changes %s, planes %s, the tab gets the 105 mm throttle bore and the 80 mm reducer'
   % (dl, sorted((t2c.get('geometry') or {}).get('planes_mm', {}))))

# ---------------------------------------------------------------- 6b. the mount: flange (default), free, auto
select(Sel(Face(body, body.faces[1].geometry), outside_point(body, segs, 20.0)))
rf = run({'mount': 'free'})
tf_ = rf.get('tube') or {}
ok(rf.get('ok') and tf_['geometry']['mount'] == {'type': 'free'} and tf_['mount'] == 'free' and abs(tf_['protrusion_mm'] - 92.61) < 0.01
   and 'free-standing' in rf['msg'] and {k: v for k, v in tf_['geometry'].items() if k != 'mount'} == {k: v for k, v in r['tube']['geometry'].items() if k != 'mount'},
   'mount free: the same tube with mount {type: free}, standing %.2f mm proud (to bend 1 at 100 mm)' % tf_.get('protrusion_mm', 0))
ok(r['tube']['geometry']['mount'] == {'type': 'flange'} and r['tube']['mount'] == 'flange', 'no mount asked: flange-mounted, as before')
m0, t0_ = segs_tc(segs)[0]['a'], segs_tc(segs)[0]['t0']


class Plate(object):
    """A plenum wall or airbox 5 mm thick against the mouth face (all of it within 300 mm of the axis)."""
    objectType, isSolid, isVisible, entityToken = 'adsk::fusion::BRepBody', True, True, 'plate'

    def pointContainment(self, pt):
        p = (pt.x * 10, pt.y * 10, pt.z * 10)
        a = dot(sub(p, m0), t0_)
        return INSIDE if -5.0 < a < 0.0 and TC._len(sub(sub(p, m0), mul(t0_, a))) < 300.0 else OUTSIDE


body.isVisible = True
for others, want_m in (([body], 'free'), ([body, Plate()], 'flange')):
    CT._design = lambda o=others: types.SimpleNamespace(rootComponent=types.SimpleNamespace(bRepBodies=Coll(o), allOccurrences=Coll([])))
    select(Sel(Face(body, body.faces[1].geometry), outside_point(body, segs, 20.0)))
    ra = run({'mount': 'auto'})
    ok(ra.get('ok') and ra['tube']['mount'] == want_m and ra['tube']['geometry']['mount'] == {'type': want_m} and 'auto' in ra['tube']['mount_how'],
       'mount auto, %s: %s (%s)' % ('a plate against the mouth face' if len(others) > 1 else 'nothing but the tube', want_m, ra.get('tube', {}).get('mount_how')))

if os.environ.get('ET_WRITE_FIXTURES') == '1':
    # the page test's add-in answers (web/tests/fxcfd_ui.js): the plain tube and the cone-ended one, as read here
    fx = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'web', 'tests', 'fixtures')
    for fn, tt in (('fxcfd_tube.json', r['tube']), ('fxcfd_tube_cone.json', FIX_CONE)):
        with open(os.path.join(fx, fn), 'w') as fh:
            __import__('json').dump(tt, fh, indent=1)
    print('wrote the fixtures in ' + fx)

# ---------------------------------------------------------------- 7. refusals
def refused(want, what, data=None):
    rr = run(data)
    wants = want if isinstance(want, tuple) else (want,)
    ok(rr.get('ok') is False and any(w in (rr.get('msg') or '') for w in wants) and 'Traceback' not in (rr.get('msg') or ''), '%s: "%s"' % (what, rr.get('msg')))


bt = TubeBody(segs, R_IN, R_OUT, path_ents=sketch_curves(segs), taper=(450.0, 0.02))
select(Sel(Face(bt, bt.faces[1].geometry), outside_point(bt, segs, 20.0)))
rt = run()
dct = ((rt.get('tube') or {}).get('geometry') or {}).get('diameter_change') or {}
ok(rt.get('ok') and abs(dct.get('start_mm', 0) - 450.0) < 0.5 and 'a cone from 92.61' in rt.get('msg', ''),
   'a bore that tapers from 450 mm on, into bend 2: read as a cone that runs into the bend (the generator meshes it): %s' % dct)
bo = TubeBody(segs, R_IN, R_OUT, path_ents=sketch_curves(segs), oval=1.06)
select(Sel(Face(bo, bo.faces[1].geometry), outside_point(bo, segs, 20.0)))
refused('The bore is not round', 'a bore squashed 6% oval past the middle')
select(Sel(Face(body, body.faces[1].geometry), outside_point(body, segs, 20.0)))
refused('mount must be', 'mount neither flange, free nor auto', {'mount': 'sideways'})
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
