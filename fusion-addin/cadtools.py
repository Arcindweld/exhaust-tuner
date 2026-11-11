"""Exhaust Tuner panel: shows the calculator page in a Fusion palette and does the CAD work it asks for.

The page (palette.html) is the same calculator as the web app. Inside Fusion it finds
adsk.fusionSendData and shows a Fusion section on each tab. Each button sends an action
here, and the reply goes back to the page as JSON.

Actions
  measure      Measure the current selection: sketch paths and edges (centerline length,
               bend radii and a bend schedule), circular edges (diameter) and tube bodies
               (outside and inside diameters, bend radii, estimated centerline length).
  setKeepouts  Remember the selected bodies (frame, engine, steering...) as keep-outs.
  clearance    Minimum distance from each selected body to each keep-out.
  pipe         Build a hollow tube along each selected path with the page's OD and wall.
  build        Build the page's straight profile as hollow revolved bodies.
  centerlines  Draw the crossover centerlines.
  boom         Build the boom tube from the page's sections: the inside shape lofted from
               section to section (round, then flat oval), then shelled outward by the wall.
  route        Auto-route through the keep-outs (see act_route). For a J-pipe it also caps the far end
               and copes the near end to the main pipe, with a tool body for the hole.
  helmholtz    Build a Helmholtz can on a neck from a marker on the main pipe: the neck coped to the
               main pipe, the can sized to hold the page's volume around the neck.

Lengths sent back are centimeters (Fusion's internal unit). The page converts them.
"""
import json
import math
import os
import time
import traceback

import adsk.core
import adsk.fusion

try:
    from . import router as RT
    from . import templates as TPL
    from . import jig as JIG
    from . import hangers as HGR
    from . import merge as MRG
    from . import hostrun as HR
    from . import printsplit as PS
    from . import tubecfd as TC
except ImportError:          # loaded as a top-level module (the add-in's folder is on sys.path)
    import router as RT
    import templates as TPL
    import jig as JIG
    import hangers as HGR
    import merge as MRG
    import hostrun as HR
    import printsplit as PS
    import tubecfd as TC

PALETTE_ID = 'exhaustTunerPalette'
PANEL_CMD_ID = 'exhaustTunerPanelCmd'
PANEL_CMD_NAME = 'Exhaust Tuner Panel'
PANEL_CMD_TIP = 'Open the exhaust calculator beside the model, measure what you select and build tubes along your routes'
# full path, so the panel finds its page however the add-in was started
HTML_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'palette.html').replace('\\', '/')   # backslashes stop the page loading

# CAD library: real part models (STEP) the fitting placer can drop in beside the stand-in. The default is the shop's
# folder on the Windows user's Desktop; a file named cad_library.txt next to the add-in overrides it with one folder
# path per line.
CAD_DIRS_DEFAULT = [os.path.join(os.path.expanduser('~'), 'Desktop', 'claude training books', 'cad files').replace('\\', '/')]


def cad_dirs():
    cfg = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cad_library.txt')
    out = []
    if os.path.exists(cfg):
        for line in open(cfg, encoding='utf-8'):
            line = line.strip().strip('"')
            if line and not line.startswith('#'):
                out.append(line)
    return out or CAD_DIRS_DEFAULT


def find_cad(key):
    """The first STEP/IGES file under the library folders whose name contains key (case-insensitive), else None."""
    key = (key or '').lower()
    if not key:
        return None
    best = None
    for root in cad_dirs():
        if not os.path.isdir(root):
            continue
        for dp, _dn, fns in os.walk(root):
            for fn in fns:
                ext = fn.lower().rsplit('.', 1)[-1] if '.' in fn else ''
                if key in fn.lower() and ext in ('step', 'stp', 'igs', 'iges'):
                    p = os.path.join(dp, fn)
                    if best is None or (ext in ('step', 'stp') and not best.lower().endswith(('step', 'stp'))):
                        best = p
    return best


_app = None
_ui = None
_handlers = None
_build_pipe = None
_build_centerlines = None
_keepouts = []          # [(entityToken, name, body)]

TOL = 1e-4              # cm


# --------------------------------------------------------------------------
# Vector helpers on plain tuples (cm)
# --------------------------------------------------------------------------

def _t(p):
    return (p.x, p.y, p.z)


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _norm(a):
    return math.sqrt(_dot(a, a))


def _unit(a):
    n = _norm(a)
    return (a[0] / n, a[1] / n, a[2] / n) if n > 1e-12 else (0.0, 0.0, 0.0)


def _neg(a):
    return (-a[0], -a[1], -a[2])


def _ang(a, b):
    """Angle between two vectors, degrees."""
    c = _dot(_unit(a), _unit(b))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))


def _signed(a, b, axis):
    """Signed angle from a to b, right-hand rule about axis, degrees."""
    return math.degrees(math.atan2(_dot(_cross(a, b), _unit(axis)), _dot(a, b)))


# --------------------------------------------------------------------------
# Pure geometry: bend schedule and tube summary (testable without Fusion)
# --------------------------------------------------------------------------

def orient(segs):
    """Flip segments so each starts where the previous one ends."""
    segs = [dict(s) for s in segs]

    def flip(s):
        s['p0'], s['p1'] = s['p1'], s['p0']
        s['t0'], s['t1'] = _neg(s['t1']), _neg(s['t0'])

    if len(segs) >= 2:
        a, b = segs[0], segs[1]
        end_gap = min(_norm(_sub(a['p1'], b['p0'])), _norm(_sub(a['p1'], b['p1'])))
        start_gap = min(_norm(_sub(a['p0'], b['p0'])), _norm(_sub(a['p0'], b['p1'])))
        if start_gap < end_gap:
            flip(a)
    for i in range(1, len(segs)):
        prev, s = segs[i - 1], segs[i]
        if _norm(_sub(prev['p1'], s['p1'])) < _norm(_sub(prev['p1'], s['p0'])):
            flip(s)
    return segs


def bend_schedule(segs, tol_deg=0.5):
    """Length, rotation, angle (LRA) rows for an ordered path of lines and arcs.

    segs: dicts with kind ('line', 'arc' or 'other'), length, unit tangents t0 and t1 in the
    direction of travel, radius (arcs) and optionally sweep (arc angle, degrees).
    Returns (rows, note). Each row: L = straight before the bend, R = rotation from the previous
    bend plane (right-hand rule about the feed direction), A = bend angle, CLR = centerline
    radius (None for a sharp corner). The last row is the final straight.
    """
    if any(s['kind'] == 'other' for s in segs):
        return None, 'The path includes a spline or other free-form curve, so there is no bend schedule. The length is still exact.'
    rows = []
    state = {'straight': 0.0, 'n': None}

    def bend(t_in, t_out, clr, angle=None):
        a = _ang(t_in, t_out) if angle is None else angle
        if a < tol_deg:
            return False
        n = _unit(_cross(t_in, t_out))
        if _norm(n) < 0.5:          # a 180 degree turn has no single plane; keep the last one
            n = state['n'] or (0.0, 0.0, 1.0)
        r = None if state['n'] is None else _signed(state['n'], n, t_in)
        rows.append({'L': state['straight'], 'R': r, 'A': a, 'CLR': clr})
        state['straight'] = 0.0
        state['n'] = n
        return True

    prev_dir = None
    for s in segs:
        if prev_dir is not None and _ang(prev_dir, s['t0']) >= tol_deg:
            bend(prev_dir, s['t0'], None)                     # sharp corner between curves
        if s['kind'] == 'line':
            state['straight'] += s['length']
        else:
            if not bend(s['t0'], s['t1'], s.get('radius'), s.get('sweep')):
                state['straight'] += s['length']             # a nearly straight arc
        prev_dir = s['t1']
    rows.append({'L': state['straight'], 'R': None, 'A': None, 'CLR': None})
    return rows, None


def _merge_len(intervals):
    total, cur = 0.0, None
    for a, b in sorted(intervals):
        if cur is None or a > cur[1] + TOL:
            if cur:
                total += cur[1] - cur[0]
            cur = [a, b]
        else:
            cur[1] = max(cur[1], b)
    if cur:
        total += cur[1] - cur[0]
    return total


def _cluster(values, tol):
    out = []
    for v in sorted(values, reverse=True):
        if not out or abs(out[-1] - v) > tol:
            out.append(v)
    return out


def tube_summary(name, cyls, tors, max_wall=0.6):
    """cyls: dicts r, axis, origin, ts (vertex positions along the axis).
    tors: dicts R, r, origin, axis, angle (degrees or None), key (boundary signature).
    Returns a measure item (cm)."""
    radii = _cluster([c['r'] for c in cyls] + [t['r'] for t in tors], 0.003)
    outer, inner, used = [], [], set()
    for i, r in enumerate(radii):          # pair each radius with the next smaller one a wall away
        if i in used:
            continue
        if i + 1 < len(radii) and (i + 1) not in used and 0 < r - radii[i + 1] <= max_wall:
            outer.append(r)
            inner.append(radii[i + 1])
            used.update((i, i + 1))
        else:
            outer.append(r)
            used.add(i)

    def is_outer(r):
        return any(abs(r - o) <= 0.003 for o in outer)

    groups = {}
    for c in cyls:
        if not is_outer(c['r']) or len(c['ts']) < 2:
            continue
        ax, o = c['axis'], c['origin']
        sign = 1.0 if (round(ax[0], 6), round(ax[1], 6), round(ax[2], 6)) >= (0, 0, 0) else -1.0
        cax = tuple(sign * v for v in ax)                                   # one direction per axis line
        foot = _sub(o, tuple(cax[k] * _dot(o, cax) for k in range(3)))     # axis-line point nearest the origin
        key = (round(c['r'], 3), tuple(round(v, 3) for v in cax), tuple(round(v, 2) for v in foot))
        ts = [sign * v + _dot(o, cax) for v in c['ts']]                     # positions along the shared line
        groups.setdefault(key, []).append((min(ts), max(ts)))
    straight = sum(_merge_len(v) for v in groups.values())
    seen, bend_len, bends = set(), 0.0, []
    for t in tors:
        if not is_outer(t['r']) or t['angle'] is None:
            continue
        if t['key'] in seen:
            continue
        seen.add(t['key'])
        bend_len += t['R'] * math.radians(t['angle'])
        bends.append(t['R'])
    item = {'kind': 'body', 'name': name, 'od': [2 * r for r in outer], 'id': [2 * r for r in inner],
            'bends': _cluster(bends, 0.01)}
    if straight + bend_len > 0:
        item['length'] = straight + bend_len
        item['note'] = ('Estimated from the cylindrical and toroidal faces. Cones, collectors and free-form tubes are '
                        'not counted, and if this body holds several runners the length covers all of them.')
    else:
        item['note'] = ('No cylindrical or toroidal faces were found. For a scan or mesh, sketch a centerline '
                        'through it and measure the sketch instead.')
    return item


def path_signature(segs):
    """Order-free key for a path so the same chain picked twice is measured once."""
    ends = sorted([tuple(round(v, 3) for v in segs[0]['p0']), tuple(round(v, 3) for v in segs[-1]['p1'])])
    return (tuple(ends), round(sum(s['length'] for s in segs), 3), len(segs))


# --------------------------------------------------------------------------
# Fusion adapters
# --------------------------------------------------------------------------

CURVE_TYPES = ('SketchLine', 'SketchArc', 'SketchCircle', 'SketchEllipse', 'SketchEllipticalArc',
               'SketchFittedSpline', 'SketchFixedSpline', 'SketchConicCurve', 'SketchControlPointSpline')


def _kind(ent):
    ot = ent.objectType.split('::')[-1]
    if ot in CURVE_TYPES:
        return 'sketch'
    return ot


def _circumradius(a, b, c):
    """Radius of the circle through three points, or None when they are in a line."""
    ab, ac = _sub(b, a), _sub(c, a)
    n = _norm(_cross(ab, ac))
    if n < 1e-12:
        return None
    return _norm(ab) * _norm(ac) * _norm(_sub(c, b)) / (2.0 * n)


def _shape_of(ev, t0, t1, length, p0, p1):
    """Recognise a line or a circular arc from points along a curve (Fusion hands path curves over as NURBS).
    Returns ('line', None, None), ('arc', radius, sweep in degrees) or ('other', None, None)."""
    tol = max(1e-5, 1e-6 * length)
    if abs(length - _norm(_sub(p1, p0))) <= tol:
        return 'line', None, None
    pts = []
    for k in range(9):
        _ok, q = ev.getPointAtParameter(t0 + (t1 - t0) * k / 8.0)
        pts.append(_t(q))
    r = _circumradius(pts[0], pts[4], pts[8])
    if r is None:
        return 'other', None, None
    # every sample must sit on that circle and in its plane
    ab, ac = _sub(pts[4], pts[0]), _sub(pts[8], pts[0])
    nrm = _unit(_cross(ab, ac))
    for q in pts:
        if abs(_dot(_sub(q, pts[0]), nrm)) > 1e-4 * max(1.0, r):
            return 'other', None, None
    for k in (2, 6):
        if abs(_circumradius(pts[0], pts[k], pts[8]) - r) > 1e-4 * max(1.0, r):
            return 'other', None, None
    return 'arc', r, math.degrees(length / r)


def _curve_seg(curve):
    ev = curve.evaluator
    _ok, t0, t1 = ev.getParameterExtents()
    _ok, p0, p1 = ev.getEndPoints()
    _ok, length = ev.getLengthAtParameter(t0, t1)
    _ok, d0 = ev.getFirstDerivative(t0)
    _ok, d1 = ev.getFirstDerivative(t1)
    ct = curve.curveType
    seg = {'kind': 'other', 'length': length, 'p0': _t(p0), 'p1': _t(p1),
           't0': _unit(_t(d0)), 't1': _unit(_t(d1)), 'radius': None}
    if ct == adsk.core.Curve3DTypes.Line3DCurveType:
        seg['kind'] = 'line'
    elif ct == adsk.core.Curve3DTypes.Arc3DCurveType:
        seg['kind'] = 'arc'
        seg['radius'] = curve.radius
        try:
            seg['sweep'] = abs(math.degrees(curve.endAngle - curve.startAngle))
        except Exception:
            pass
    else:
        kind, r, sweep = _shape_of(ev, t0, t1, length, seg['p0'], seg['p1'])
        seg['kind'] = kind
        if kind == 'arc':
            seg['radius'], seg['sweep'] = r, sweep
    return seg


def _path_for(ent):
    opt = (adsk.fusion.ChainedCurveOptions.connectedChainedCurves if _kind(ent) == 'sketch'
           else adsk.fusion.ChainedCurveOptions.tangentChainedCurves)
    path = adsk.fusion.Path.create(ent, opt)
    if path is None or path.count == 0:
        raise ValueError('Fusion could not make a path from the selected curve.')
    return path


def _path_curve(pe):
    """The exact geometry behind a path entity: the sketch curve or edge itself when Fusion gives it,
    since PathEntity.curve comes back as NURBS even for lines and arcs."""
    try:
        ent = pe.entity
        if ent is not None:
            g = ent.worldGeometry if _kind(ent) == 'sketch' else ent.geometry
            if g is not None:
                return g
    except Exception:
        pass
    return pe.curve


def _path_segs(path):
    return orient([_curve_seg(_path_curve(path.item(i))) for i in range(path.count)])


def _world_geometry(ent):
    return ent.worldGeometry if _kind(ent) == 'sketch' else ent.geometry


def _name(ent):
    try:
        if _kind(ent) == 'sketch':
            return ent.parentSketch.name + ' path'
        if _kind(ent) == 'BRepEdge':
            return ent.body.name + ' edge'
        return ent.name
    except Exception:
        return 'Selection'


def _selected():
    sels = _ui.activeSelections
    return [sels.item(i).entity for i in range(sels.count)]


def _bodies_of(ents):
    out, seen = [], set()
    for e in ents:
        k = _kind(e)
        found = []
        if k in ('BRepBody', 'MeshBody'):
            found = [e]
        elif k == 'BRepFace':
            found = [e.body]
        elif k == 'Occurrence':
            found = [e.bRepBodies.item(i) for i in range(e.bRepBodies.count)]
            try:
                found += [e.meshBodies.item(i) for i in range(e.meshBodies.count)]
            except Exception:
                pass
        for b in found:
            tok = _token(b)
            if tok not in seen:
                seen.add(tok)
                out.append(b)
    return out


def _token(b):
    try:
        return b.entityToken
    except Exception:
        return str(id(b))


def _bname(b):
    try:
        occ = b.assemblyContext
        return (occ.name + ' / ' if occ else '') + b.name
    except Exception:
        return 'Body'


def analyze_body(body):
    cyls, tors = [], []
    for i in range(body.faces.count):
        f = body.faces.item(i)
        g = f.geometry
        st = g.surfaceType
        if st == adsk.core.SurfaceTypes.CylinderSurfaceType:
            ax, o = _unit(_t(g.axis)), _t(g.origin)
            ts = [_dot(_sub(_t(f.vertices.item(j).geometry), o), ax) for j in range(f.vertices.count)]
            cyls.append({'r': g.radius, 'axis': ax, 'origin': o, 'ts': ts})
        elif st == adsk.core.SurfaceTypes.TorusSurfaceType:
            o = _t(g.origin)
            centers = []
            for j in range(f.edges.count):
                eg = f.edges.item(j).geometry
                if eg.curveType == adsk.core.Curve3DTypes.Circle3DCurveType:
                    centers.append(_t(eg.center))
            angle = _ang(_sub(centers[0], o), _sub(centers[1], o)) if len(centers) >= 2 else None
            key = tuple(sorted(tuple(round(v, 3) for v in c) for c in centers[:2]))
            tors.append({'R': g.majorRadius, 'r': g.minorRadius, 'origin': o, 'axis': _t(g.axis),
                         'angle': angle, 'key': key})
    item = tube_summary(_bname(body), cyls, tors)
    box = _box(body)
    if box:
        item['box'] = box
        if 'length' not in item:
            item['note'] = ('No round tube faces were found, so only the overall size is given. To measure a '
                            'route, select its centerline sketch instead.')
    return item


def _box(body):
    """Overall size in cm, longest first, from the smallest box that fits around the body in any orientation.
    BRepBody and MeshBody have orientedMinimumBoundingBox from Fusion's January 2024 update; older builds get None."""
    try:
        b = body.orientedMinimumBoundingBox
        dims = sorted((float(b.length), float(b.width), float(b.height)), reverse=True)
        return dims if dims[0] > 0 else None
    except Exception:
        return None


def _max_min_radius(bodies):
    rs = []
    for k in range(bodies.count):
        b = bodies.item(k)
        for i in range(b.faces.count):
            g = b.faces.item(i).geometry
            st = g.surfaceType
            if st == adsk.core.SurfaceTypes.CylinderSurfaceType:
                rs.append(g.radius)
            elif st == adsk.core.SurfaceTypes.TorusSurfaceType:
                rs.append(g.minorRadius)
    return (max(rs), min(rs)) if rs else (None, None)


def _component_of(ent):
    k = _kind(ent)
    if k == 'sketch':
        return ent.parentSketch.parentComponent
    if k == 'BRepEdge':
        return ent.body.parentComponent
    return adsk.fusion.Design.cast(_app.activeProduct).rootComponent


def _pipe(comp, path, od, wall):
    """Hollow tube along the path. Checks that Fusion took the section size as the diameter."""
    pipes = comp.features.pipeFeatures

    def make(size):
        inp = pipes.createInput(path, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        inp.sectionSize = adsk.core.ValueInput.createByReal(size)
        inp.sectionThickness = adsk.core.ValueInput.createByReal(wall)
        return pipes.add(inp)

    feat = make(od)
    rmax, _rmin = _max_min_radius(feat.bodies)
    if rmax is not None and abs(rmax - od) < 0.01 and abs(rmax - od / 2) > 0.01:
        feat.deleteMe()             # the size was read as a radius; rebuild at half
        feat = make(od / 2)
    return feat


def _sweep_fallback(comp, path, od, wall):
    """For older Fusion without the Pipe API: a ring profile normal to the path start, swept."""
    planes = comp.constructionPlanes
    pin = planes.createInput()
    zero = adsk.core.ValueInput.createByReal(0)
    if hasattr(pin, 'setByPath'):
        pin.setByPath(path, adsk.fusion.PathDistanceTypes.ProportionalPathDistanceType, zero)
    else:
        pin.setByDistanceOnPath(path, zero)
    plane = planes.add(pin)
    sk = comp.sketches.add(plane)
    _ok, p0, _p1 = path.item(0).curve.evaluator.getEndPoints()
    c = sk.modelToSketchSpace(p0)
    circles = sk.sketchCurves.sketchCircles
    circles.addByCenterRadius(c, od / 2)
    circles.addByCenterRadius(c, od / 2 - wall)
    prof = None
    for i in range(sk.profiles.count):
        if sk.profiles.item(i).profileLoops.count == 2:
            prof = sk.profiles.item(i)
    if prof is None:
        raise RuntimeError('Could not find the ring profile for the sweep.')
    sweeps = comp.features.sweepFeatures
    return sweeps.add(sweeps.createInput(prof, path, adsk.fusion.FeatureOperations.NewBodyFeatureOperation))


# --------------------------------------------------------------------------
# Actions
# --------------------------------------------------------------------------

def _design():
    d = adsk.fusion.Design.cast(_app.activeProduct)
    if not d:
        raise ValueError('Open a Fusion design first.')
    return d


def act_measure(_data):
    ents = _selected()
    if not ents:
        raise ValueError('Select a sketch path, an edge, a tube face or a tube body in the model first.')
    items, seen = [], set()
    for e in ents:
        k = _kind(e)
        if k == 'MeshBody':
            it = {'kind': 'mesh', 'name': e.name, 'note': 'Mesh bodies have no exact faces. Sketch a centerline '
                  'through the scan, then measure the sketch.'}
            box = _box(e)
            if box:
                it['box'] = box
                it['note'] = ('Overall size is from the mesh. For lengths and bends, sketch a centerline through '
                              'the scan, then measure the sketch.')
            items.append(it)
            continue
        if k not in ('sketch', 'BRepEdge'):
            continue
        g = _world_geometry(e)
        if g.curveType == adsk.core.Curve3DTypes.Circle3DCurveType:
            items.append({'kind': 'circle', 'name': _name(e) + ' (circle)', 'diameter': 2 * g.radius})
            continue
        segs = _path_segs(_path_for(e))
        key = path_signature(segs)
        if key in seen:
            continue
        seen.add(key)
        rows, note = bend_schedule(segs)
        it = {'kind': 'path', 'name': _name(e), 'length': sum(s['length'] for s in segs),
              'bends': _cluster([s['radius'] for s in segs if s['kind'] == 'arc'], 0.01)}
        if rows:
            it['lra'] = rows
        if note:
            it['note'] = note
        items.append(it)
    for b in _bodies_of(ents):
        if _kind(b) != 'MeshBody':          # meshes were handled above
            items.append(analyze_body(b))
    if not items:
        raise ValueError('Nothing measurable is selected. Pick sketch curves, edges, faces or bodies.')
    for n, it in enumerate(items, 1):
        if it['kind'] == 'path':
            it['name'] = '%s %d' % (it['name'], n)
    return {'ok': True, 'items': items, 'msg': 'Measured %d item%s.' % (len(items), '' if len(items) == 1 else 's')}


def act_set_keepouts(_data):
    bodies = _bodies_of(_selected())
    if not bodies:
        raise ValueError('Select the frame, engine, floor or other bodies the exhaust has to clear, then try again.')
    _keepouts[:] = [(_token(b), _bname(b), b) for b in bodies]
    _mesh_cache.clear()
    names = ', '.join(k[1] for k in _keepouts[:6]) + (' and more' if len(_keepouts) > 6 else '')
    return {'ok': True, 'msg': '%d keep-out bod%s stored: %s.' % (len(_keepouts), 'y' if len(_keepouts) == 1 else 'ies', names)}


def _resolve(token, body):
    try:
        found = _design().findEntityByToken(token)
        if found:
            return found[0]
    except Exception:
        pass
    try:
        return body if body.isValid else None
    except Exception:
        return None


def act_clearance(data):
    if not _keepouts:
        raise ValueError('Set the keep-out bodies first: select them and press Set keep-outs.')
    tubes = _bodies_of(_selected())
    if not tubes:
        raise ValueError('Select the tube bodies to check.')
    tubes = [t for t in tubes if _kind(t) == 'BRepBody']
    if not tubes:
        raise ValueError('Select the tube bodies (solids) to check. A mesh can be a keep-out but not the part being checked.')
    rows = []
    for t in tubes:
        for tok, name, b in _keepouts:
            kb = _resolve(tok, b)
            if kb is None or _token(kb) == _token(t):
                continue
            if _kind(kb) == 'MeshBody':
                # Fusion's measure does not take meshes: smallest distance from points spread over the
                # tube's surface to the scan's triangles, less the point spacing, so it never reads high
                d = _mesh_gap(t, kb)
                rows.append({'a': _bname(t), 'b': name, 'd': d, 'mesh': True})
            else:
                res = _app.measureManager.measureMinimumDistance(t, kb)
                rows.append({'a': _bname(t), 'b': name, 'd': res.value})
    if not rows:
        raise ValueError('The selected bodies are the keep-outs themselves. Select the tubes instead.')
    gap = float(data.get('gap_cm', 1.27))
    close = [r for r in rows if r['d'] < gap]
    msg = ('Everything clears by at least the minimum.' if not close else
           '%d pair%s closer than the minimum.' % (len(close), '' if len(close) == 1 else 's'))
    return {'ok': True, 'rows': rows, 'msg': msg}


def act_pipe(data):
    od = float(data.get('od_mm', 0)) / 10.0
    wall = float(data.get('wall_mm', 0)) / 10.0
    noun = str(data.get('noun') or 'runner')
    if od <= 0 or wall <= 0 or wall >= od / 2:
        raise ValueError('The tube size from the page is not valid. Check the inside diameter and wall.')
    ents = [e for e in _selected() if _kind(e) in ('sketch', 'BRepEdge')]
    if not ents:
        raise ValueError('Select one curve of each route. A connected sketch path is picked up automatically.')
    jpipe = bool(data.get('cap') or data.get('tee'))
    notes = []
    items, seen = [], set()
    for e in ents:
        if _world_geometry(e).curveType == adsk.core.Curve3DTypes.Circle3DCurveType:
            continue
        path = _path_for(e)
        segs = _path_segs(path)
        key = path_signature(segs)
        if key in seen:
            continue
        seen.add(key)
        comp = _component_of(e)
        ends = _jpipe_ends(segs, data, od, notes) if jpipe else None     # before the tube exists
        fr = _comp_frame(comp, e) if ends else None
        if fr:
            ends = _ends_in(ends, fr)
        try:
            comp.features.pipeFeatures
            feat = _pipe(comp, path, od, wall)
        except AttributeError:
            feat = _sweep_fallback(comp, path, od, wall)
        try:
            feat.bodies.item(0).name = '%s %d' % (data.get('title', 'Runner'), len(items) + 1)
        except Exception:
            pass
        it = {'kind': 'path', 'name': 'Built %s %d' % (noun, len(items) + 1), 'length': sum(s['length'] for s in segs)}
        if ends:
            tube = None
            try:
                tube = feat.bodies.item(0)
            except Exception:
                pass
            extra = _jpipe_fittings(comp, data, tube, ends['main'], ends['tee'], ends['tee_d'], ends['cap'], ends['cap_d'],
                                    od, wall, it['length'], notes)
            it['note'] = ((ends['note'] + ' ') if ends['note'] else '') + extra
        items.append(it)
    if not items:
        raise ValueError('No open path found in the selection.')
    target = data.get('target_mm')
    msg = 'Built %d %s%s at %.3f in OD, %.3f in wall.' % (len(items), noun, '' if len(items) == 1 else 's', od / 2.54, wall / 2.54)
    if target:
        diffs = [it['length'] * 10 - float(target) for it in items]
        worst = max(diffs, key=abs)
        msg += ' The page asks for %.2f in; the routes are %s by up to %.2f in.' % (
            float(target) / 25.4, 'long' if worst > 0 else 'short', abs(worst) / 25.4)
    if notes:
        msg += ' ' + ' '.join(notes)
    return {'ok': True, 'msg': msg, 'items': items}


def act_build(data):
    segs = [(str(s[0]), float(s[1]), float(s[2]), float(s[3])) for s in data.get('segs', [])]
    if not segs:
        raise ValueError('Nothing to build yet. Fill in the calculator first.')
    _build_pipe(_design(), data.get('title', 'Exhaust'), segs, float(data.get('wall_mm', 1.651)), bool(data.get('split')))
    return {'ok': True, 'msg': 'Built %s as hollow bodies along X in a new component.' % data.get('title', 'the pipe')}


def act_centerlines(data):
    strokes = data.get('strokes') or []
    if not strokes:
        raise ValueError('Nothing to draw yet. Fill in the crossover first.')
    _build_centerlines(_design(), data.get('title', 'Crossover'), strokes)
    return {'ok': True, 'msg': 'Drew the crossover centerlines in a new component.'}


# --------------------------------------------------------------------------
# Boom tubes: lofted flat-oval sections, shelled outward
# --------------------------------------------------------------------------

def boom_sections(stations, tol_mm=0.1):
    """Clean the page's stations [[x_mm, width_mm, height_mm], ...] into (x, w, h) in cm.

    Stations at the same place with the same size are dropped; the same place with a
    different size is an error, as is anything not positive."""
    out = []
    for s in stations:
        try:
            x, w, h = float(s[0]), float(s[1]), float(s[2])
        except (TypeError, ValueError, IndexError):
            raise ValueError('The boom tube sizes from the page are not valid. Check the Boom tubes tab.')
        if not all(math.isfinite(v) for v in (x, w, h)) or w <= 0 or h <= 0 or x < 0:
            raise ValueError('The boom tube sizes from the page are not valid. Check the Boom tubes tab.')
        if out:
            px, pw, ph = out[-1][0] * 10, out[-1][1] * 10, out[-1][2] * 10
            if x < px - tol_mm:
                raise ValueError('The boom tube sections from the page are out of order.')
            if x - px < tol_mm:
                if abs(w - pw) < tol_mm and abs(h - ph) < tol_mm:
                    continue
                raise ValueError('Two boom tube sections sit at the same place. Give the transition and the flat run some length.')
        out.append((x / 10.0, w / 10.0, h / 10.0))
    if len(out) < 2:
        raise ValueError('The boom tube needs at least two sections. Fill in the Boom tubes tab first.')
    return out


def obround_pts(w, h):
    """Outline of a flat oval w wide and h tall, centered on (0, 0), as (across, up) points.

    Returns None for a circle. Otherwise (p0, p1, p2, p3, m1, m2): straights p0-p1 and p2-p3,
    arcs p1-m1-p2 and p3-m2-p0, going around the loop."""
    if abs(w - h) < 1e-6:
        return None
    if w > h:
        r, a = h / 2.0, w / 2.0 - h / 2.0
        return ((-a, r), (a, r), (a, -r), (-a, -r), (a + r, 0.0), (-a - r, 0.0))
    r, a = w / 2.0, h / 2.0 - w / 2.0
    return ((r, a), (r, -a), (-r, -a), (-r, a), (0.0, -a - r), (0.0, a + r))


def _z_up():
    try:
        o = _app.preferences.generalPreferences.defaultModelingOrientation
        return o != adsk.core.DefaultModelingOrientations.YUpModelingOrientation
    except Exception:
        return True


def build_boom(design, title, sections, wall, z_up=True):
    """Loft the inside shape through the sections (cm) along X in a new component, then shell
    it outward by the wall with both ends open. Width runs across, height runs up."""
    comp = new_component(design, title)
    P = adsk.core.Point3D.create
    up, across = ((0.0, 0.0, 1.0), (0.0, 1.0, 0.0)) if z_up else ((0.0, 1.0, 0.0), (0.0, 0.0, 1.0))

    def model(x, u, v):
        return P(x, u * across[1] + v * up[1], u * across[2] + v * up[2])

    planes = comp.constructionPlanes
    profiles = []
    for i, (x, w, h) in enumerate(sections):
        if abs(x) < TOL:
            plane = comp.yZConstructionPlane
        else:
            pin = planes.createInput()
            pin.setByOffset(comp.yZConstructionPlane, adsk.core.ValueInput.createByReal(x))
            plane = planes.add(pin)
        sk = comp.sketches.add(plane)
        sk.name = '%s section %d' % (title, i + 1)

        def S(q, x=x, sk=sk):
            return sk.modelToSketchSpace(model(x, q[0], q[1]))

        pts = obround_pts(w, h)
        if pts is None:
            sk.sketchCurves.sketchCircles.addByCenterRadius(S((0.0, 0.0)), w / 2.0)
        else:
            p0, p1, p2, p3, m1, m2 = pts
            lines = sk.sketchCurves.sketchLines
            arcs = sk.sketchCurves.sketchArcs
            a = lines.addByTwoPoints(S(p0), S(p1))
            b = lines.addByTwoPoints(S(p2), S(p3))
            arcs.addByThreePoints(a.endSketchPoint, S(m1), b.startSketchPoint)
            arcs.addByThreePoints(b.endSketchPoint, S(m2), a.startSketchPoint)
        if sk.profiles.count < 1:
            raise RuntimeError('Section %d of the boom tube did not close into a profile.' % (i + 1))
        profiles.append(sk.profiles.item(0))

    lofts = comp.features.loftFeatures
    bodies = []
    for pa, pb in zip(profiles[:-1], profiles[1:]):
        li = lofts.createInput(adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        li.loftSections.add(pa)
        li.loftSections.add(pb)
        li.isSolid = True
        bodies.append(lofts.add(li).bodies.item(0))
    body = bodies[0]
    if len(bodies) > 1:
        tools = adsk.core.ObjectCollection.create()
        for bb in bodies[1:]:
            tools.add(bb)
        combines = comp.features.combineFeatures
        ci = combines.createInput(body, tools)
        ci.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation
        body = combines.add(ci).bodies.item(0)

    x0, x1 = sections[0][0], sections[-1][0]
    ends = adsk.core.ObjectCollection.create()
    for f in body.faces:
        if f.geometry.surfaceType != adsk.core.SurfaceTypes.PlaneSurfaceType:
            continue
        if abs(abs(f.geometry.normal.x) - 1.0) > 1e-6:
            continue
        px = f.pointOnFace.x
        if abs(px - x0) < 1e-3 or abs(px - x1) < 1e-3:
            ends.add(f)
    if ends.count != 2:
        raise RuntimeError('Could not find the two open ends of the boom tube (found %d).' % ends.count)
    shells = comp.features.shellFeatures
    si = shells.createInput(ends, False)
    si.outsideThickness = adsk.core.ValueInput.createByReal(wall)
    shells.add(si)
    try:
        body.name = title
    except Exception:
        pass
    return comp


def act_boom(data):
    secs = boom_sections(data.get('stations') or [])
    wall = float(data.get('wall_mm', 0) or 0) / 10.0
    if not (0 < wall < 2.5):
        raise ValueError('The sheet thickness from the page is not valid. Check it on the Boom tubes tab.')
    z_up = _z_up()
    title = str(data.get('title') or 'Boom tube')
    build_boom(_design(), title, secs, wall, z_up)
    length = secs[-1][0] - secs[0][0]
    axes = 'Width runs along Y and height along Z.' if z_up else 'Width runs along Z and height along Y (your designs are Y-up).'
    return {'ok': True, 'msg': 'Built %s along X in a new component: %.2f in long, inside shape from the page, %.3f in wall '
                               'added outside, ends open. %s' % (title.lower(), length / 2.54, wall / 2.54, axes)}


# what the page reports about itself: that it loaded, and answers to test probes
PAGE_NOTES = []


# --------------------------------------------------------------------------
# Scans as space limits: auto-routing tubes, collectors and off-the-shelf parts
# --------------------------------------------------------------------------

_mesh_cache = {}        # keep-out token -> (coords, indices, tolerance, note)


def _bbox_of(coords):
    n = len(coords) // 3
    if n == 0:
        return None
    xs = coords[0::3]
    ys = coords[1::3]
    zs = coords[2::3]
    return (min(xs), min(ys), min(zs)), (max(xs), max(ys), max(zs))


def _box_match(bb, body, tol):
    try:
        b = body.boundingBox
        lo, hi = _t(b.minPoint), _t(b.maxPoint)
    except Exception:
        return None
    return all(abs(bb[0][k] - lo[k]) <= tol and abs(bb[1][k] - hi[k]) <= tol for k in range(3))


def _transform(coords, m):
    """Apply a Fusion Matrix3D (16 values, row major) to a flat coordinate list."""
    a = list(m.asArray())
    out = [0.0] * len(coords)
    for i in range(0, len(coords), 3):
        x, y, z = coords[i], coords[i + 1], coords[i + 2]
        out[i] = a[0] * x + a[1] * y + a[2] * z + a[3]
        out[i + 1] = a[4] * x + a[5] * y + a[6] * z + a[7]
        out[i + 2] = a[8] * x + a[9] * y + a[10] * z + a[11]
    return out


def _keepout_mesh(body, tess_tol=0.02):
    """Triangles of a keep-out in world coordinates (cm): the scan's own mesh, or a fine
    tessellation of a solid. Checked against the body's bounding box so an assembly offset is
    never missed."""
    tok = _token(body)
    if tok in _mesh_cache:
        return _mesh_cache[tok]
    k = _kind(body)
    if k == 'MeshBody':
        tm = body.displayMesh
        tol = 0.0
    else:
        calc = body.meshManager.createMeshCalculator()
        calc.surfaceTolerance = tess_tol
        tm = calc.calculate()
        tol = tess_tol
    coords = list(tm.nodeCoordinatesAsDouble)
    idx = list(tm.nodeIndices)
    note = None
    bb = _bbox_of(coords)
    if bb is not None:
        size = max(bb[1][i] - bb[0][i] for i in range(3))
        btol = max(0.05, 0.002 * size) + tol
        ok = _box_match(bb, body, btol)
        if ok is False:
            occ = None
            try:
                occ = body.assemblyContext
            except Exception:
                pass
            moved = None
            if occ is not None:
                try:
                    moved = _transform(coords, occ.transform2)
                except Exception:
                    moved = _transform(coords, occ.transform)
            if moved is not None and _box_match(_bbox_of(moved), body, btol):
                coords = moved
            else:
                note = ('Could not confirm where %s sits in the assembly; its triangles were used as stored. '
                        'If routes ignore it, move the scan into the root component.' % _bname(body))
    _mesh_cache[tok] = (coords, idx, tol, note)
    return _mesh_cache[tok]


def _scene(lo, hi, pad, notes):
    if not _keepouts:
        raise ValueError('Set the keep-outs first: select the scan (mesh body) and any solids the pipe must '
                         'clear, then press Set keep-outs.')
    sc = RT.Scene(cell=1.0, sample_len=0.3)
    for tok, name, b in _keepouts:
        kb = _resolve(tok, b)
        if kb is None:
            notes.append('Keep-out %s is no longer in the design and was skipped.' % name)
            continue
        coords, idx, tol, note = _keepout_mesh(kb)
        if note:
            notes.append(note)
        sc.add_mesh(coords, idx, tol, name)
    sc.build(lo, hi, pad)
    return sc


def _marker_of(e):
    """A route end from a selection: a sketch line drawn from the pipe's centre the way the gas
    flows, or a circular edge or sketch circle (centre and axis; the sign is settled later)."""
    k = _kind(e)
    ot = e.objectType.split('::')[-1]
    if k == 'sketch' and ot == 'SketchLine':
        p0 = _t(e.startSketchPoint.worldGeometry)
        p1 = _t(e.endSketchPoint.worldGeometry)
        d = _unit(_sub(p1, p0))
        if _norm(d) < 0.5:
            return None
        return {'p': p0, 'd': d, 'signed': True, 'name': _name(e)}
    g = None
    if k == 'sketch' and ot == 'SketchCircle':
        g = e.worldGeometry
    elif k == 'BRepEdge':
        g = e.geometry
    if g is not None and g.curveType == adsk.core.Curve3DTypes.Circle3DCurveType:
        return {'p': _t(g.center), 'd': _unit(_t(g.normal)), 'signed': False, 'name': _name(e), 'dia': 2 * g.radius}
    return None


def _markers():
    out = []
    for e in _selected():
        m = _marker_of(e)
        if m:
            out.append(m)
    return out


def _sign(m, toward):
    if not m['signed'] and _dot(m['d'], _sub(toward, m['p'])) < 0:
        m['d'] = _neg(m['d'])
        m['signed'] = True
    return m


def _cm(data, key, default=None):
    v = data.get(key)
    if v is None or v == '':
        return default
    return float(v) / 10.0


def _route_spec(data):
    od = _cm(data, 'od_mm', 0.0)
    wall = _cm(data, 'wall_mm', 0.0)
    if od <= 0 or wall <= 0 or wall >= od / 2:
        raise ValueError('The tube size from the page is not valid. Check the inside diameter and wall.')
    clr = _cm(data, 'clr_mm') or 1.5 * od
    if clr < od / 2 + 0.01:
        raise ValueError('The bend radius has to be more than half the tube diameter.')
    return {'od': od, 'wall': wall, 'clr': clr,
            'gap': _cm(data, 'gap_mm', 1.27), 'gap_tt': _cm(data, 'gap_tt_mm', 0.32),
            'lead_start': _cm(data, 'lead_mm', 2.54), 'lead_end': _cm(data, 'lead_mm', 2.54),
            'min_straight': _cm(data, 'min_straight_mm', 0.0), 'max_bend_deg': float(data.get('max_bend_deg') or 180.0),
            'target': _cm(data, 'target_mm'), 'tol': 0.05, 'time_budget': float(data.get('time_s') or 40.0)}


def _status(text):
    try:
        pal = _ui.palettes.itemById(PALETTE_ID)
        if pal:
            pal.sendInfoToHTML('status', text)
    except Exception:
        pass
    try:
        adsk.doEvents()
    except Exception:
        pass


def new_component(design, name):
    """A new component named name, or the root component in a Part Design document (Fusion 2025+ Part
    documents hold one component only; everything then goes into the root, named bodies and sketches tell them apart)."""
    root = design.rootComponent
    # ask first: a failed addNewComponent leaves Fusion's error set, and the next TemporaryBRepManager.get() raises it
    # again (seen live, Fusion 2026, a Part Design document); designIntent is a preview property, so read it carefully
    try:
        if int(getattr(design, 'designIntent')) == 0:        # DesignIntentTypes.PartDesignIntentType
            return root
    except Exception:
        pass
    try:
        occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
        comp = occ.component
        comp.name = name
        return comp
    except Exception as ex:
        if 'one component' in str(ex) or 'Part Design' in str(ex):
            return root
        raise


def _new_component(name):
    return new_component(_design(), name)


def _drop_component(comp):
    """Delete a component this run made (its occurrence), so a build that failed half way leaves nothing behind."""
    try:
        root = _design().rootComponent
        if comp == root:
            return
        occs = root.allOccurrencesByComponent(comp)
        for i in range(occs.count - 1, -1, -1):
            occs.item(i).deleteMe()
    except Exception:
        pass



def _ctx(comp, ent):
    """An entity in the context of the component's occurrence. Fusion's Path.create (and the features
    fed by it) wants the occurrence proxy for a curve in a sub-component; the component-level curve
    raises InternalValidationError (getObjectPath) and leaves the API in a bad state until the
    command ends."""
    try:
        root = _design().rootComponent
        if comp == root:
            return ent
        occs = root.allOccurrencesByComponent(comp)
        if occs.count:
            px = ent.createForAssemblyContext(occs.item(0))
            if px is not None:
                return px
    except Exception:
        pass
    return ent


def _P3(p):
    return adsk.core.Point3D.create(p[0], p[1], p[2])


def _sketch_route(comp, elems, name):
    """The route as connected sketch lines and arcs. Each arc is checked against the planned
    centre and radius; the whole chain is checked against the planned length."""
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = name
    lines = sk.sketchCurves.sketchLines
    arcs = sk.sketchCurves.sketchArcs
    S = lambda p: sk.modelToSketchSpace(_P3(p))
    prev, first = None, None
    for e in elems:
        a = prev if prev is not None else S(e[1])
        if e[0] == 'line':
            ln = lines.addByTwoPoints(a, S(e[2]))
            prev = ln.endSketchPoint
            first = first or ln
        else:
            arc = arcs.addByThreePoints(a, S(RT.elem_point(e, 0.5)), S(e[2]))
            if arc is None:
                raise RuntimeError('arc')
            g = arc.worldGeometry
            R = e[5] / e[4]
            if abs(g.radius - R) > 1e-3 or _norm(_sub(_t(g.center), e[3])) > 1e-3:
                raise RuntimeError('arc geometry')
            ends = [arc.startSketchPoint, arc.endSketchPoint]
            prev = min(ends, key=lambda sp: _norm(_sub(_t(sp.worldGeometry), e[2])))
            first = first or arc
    path = adsk.fusion.Path.create(_ctx(comp, first), adsk.fusion.ChainedCurveOptions.connectedChainedCurves)
    total = 0.0
    for i in range(path.count):
        ev = _path_curve(path.item(i)).evaluator
        _ok, t0, t1 = ev.getParameterExtents()
        _ok, L = ev.getLengthAtParameter(t0, t1)
        total += L
    want = sum(RT.elem_len(e) for e in elems)
    if abs(total - want) > 1e-3:
        raise RuntimeError('chain')
    return sk, path


def _add_bodies(comp, named):
    """Add temporary B-Rep bodies to a component (inside a base feature in a parametric design)."""
    des = _design()
    out = []
    parametric = False
    try:
        parametric = des.designType == adsk.fusion.DesignTypes.ParametricDesignType
    except Exception:
        pass
    if parametric:
        n0 = comp.bRepBodies.count
        bf = comp.features.baseFeatures.add()
        bf.startEdit()
        try:
            for body, name in named:
                out.append(comp.bRepBodies.add(body, bf))
        finally:
            bf.finishEdit()
        # name them after finishEdit: a name set while the base feature is open comes back as "BodyN"
        added = [comp.bRepBodies.item(i) for i in range(n0, comp.bRepBodies.count)]
        if len(added) == len(named):
            out = added
        for b, (_body, name) in zip(out, named):
            try:
                b.name = name
            except Exception:
                pass
    else:
        for body, name in named:
            b = comp.bRepBodies.add(body)
            b.name = name
            out.append(b)
    return out


def _wire_path(comp, elems, name):
    """Fallback when a sketch will not take the arcs: the centreline as a wire body."""
    tbm = adsk.fusion.TemporaryBRepManager.get()
    curves = []
    for e in elems:
        if e[0] == 'line':
            curves.append(adsk.core.Line3D.create(_P3(e[1]), _P3(e[2])))
        else:
            curves.append(adsk.core.Arc3D.createByThreePoints(_P3(e[1]), _P3(RT.elem_point(e, 0.5)), _P3(e[2])))
    wire, _edge_map = tbm.createWireFromCurves(curves, False)
    body = _add_bodies(comp, [(wire, name + ' centreline')])[0]
    return adsk.fusion.Path.create(_ctx(comp, body.edges.item(0)), adsk.fusion.ChainedCurveOptions.tangentChainedCurves)


def _pname(text):
    """A legal Fusion parameter name from a label."""
    out = ''.join(ch if ch.isalnum() else '_' for ch in text).strip('_')
    if not out or not out[0].isalpha():
        out = 'ET_' + out
    return out


def _user_param(name, cm, comment=''):
    """Create or update a length user parameter (value in cm, shown in mm). Returns its name."""
    ups = _design().userParameters
    name = _pname(name)
    expr = '%.4f mm' % (cm * 10.0)
    p = ups.itemByName(name)
    if p:
        p.expression = expr
    else:
        ups.add(name, adsk.core.ValueInput.createByString(expr), 'mm', comment)
    return name


def _pipe_param(comp, path, od, wall, base):
    """Pipe feature whose size and wall follow user parameters, so editing them updates the tube.
    Falls back to fixed numbers if the expressions are refused."""
    pod = _user_param(base + '_OD', od, 'Tube outside diameter (Exhaust Tuner)')
    pw = _user_param(base + '_wall', wall, 'Tube wall (Exhaust Tuner)')
    pipes = comp.features.pipeFeatures

    def make(size_expr):
        inp = pipes.createInput(path, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        inp.sectionSize = adsk.core.ValueInput.createByString(size_expr)
        inp.sectionThickness = adsk.core.ValueInput.createByString(pw)
        return pipes.add(inp)
    try:
        feat = make(pod)
        rmax, _rmin = _max_min_radius(feat.bodies)
        if rmax is not None and abs(rmax - od) < 0.01 and abs(rmax - od / 2) > 0.01:
            feat.deleteMe()             # the size was read as a radius
            feat = make('(%s) / 2' % pod)
        return feat, True
    except Exception:
        return _pipe(comp, path, od, wall), False


def _buildable(elems):
    """The route's elements as Fusion can build them. Where a straight leaves a fixed point the router keeps a corner,
    and after the fit its bend can be a few hundredths of a millimetre long; Fusion cannot draw a three-point arc that
    small (the sketch's check fails), and a wire with one in it reads as folding back on itself. Such a bend (under
    0.5 mm and 0.5 deg) becomes part of the straight around it, and straights that then meet in line are one."""
    out = []
    for e in elems:
        if e[0] != 'line' and e[5] < 0.05 and e[4] < math.radians(0.5):
            e = ('line', e[1], e[2], _norm(_sub(e[2], e[1])))
        if e[0] == 'line':
            if e[3] < 1e-6:
                continue
            if out and out[-1][0] == 'line':
                a = out[-1]
                if _dot(_sub(a[2], a[1]), _sub(e[2], e[1])) >= math.cos(math.radians(0.5)) * a[3] * e[3]:
                    out[-1] = ('line', a[1], e[2], _norm(_sub(e[2], a[1])))
                    continue
        out.append(e)
    return out


_LAST_TUBES = []    # the tubes the last auto-route built (name, elements, OD in cm): the tack jig's default


def _build_route(comp, res, name, od, wall, pbase):
    elems = _buildable(res['elems'])
    # a route the fit could not finish can have two bends closer than their own arcs: the second starts before the
    # first ends, so the tube would fold back through itself. Nothing can be swept along that; say so plainly.
    short = max([_norm(_sub(b[1], a[2])) for a, b in zip(elems, elems[1:])] or [0.0])
    if short > 1e-3:
        raise ValueError('%s could not be built: two of its bends overlap by about %.1f mm, so the tube would fold back '
                         'through itself. %s Move the end marker farther away, use a smaller bend radius, or a shorter '
                         'target length.' % (name, 10 * short, res.get('msg') or ''))
    try:
        _sk, path = _sketch_route(comp, elems, name + ' centreline')
        how = 'sketch'
    except Exception:
        path = _wire_path(comp, elems, name)
        how = 'wire'
    feat, param = _pipe_param(comp, path, od, wall, pbase)
    _LAST_TUBES.append({'name': name, 'elems': elems, 'od': od})
    body = None
    try:
        body = feat.bodies.item(0)
        body.name = name
    except Exception:
        pass
    return {'path': how, 'param': param and how == 'sketch', 'body': body}


def _plane_3pt(comp, a, b, c, name):
    """A construction plane through three model points (a sketch holds the points)."""
    sk = comp.sketches.add(comp.xYConstructionPlane)
    sk.name = name + ' frame'
    pts = sk.sketchPoints
    sa, sb, sc = (pts.add(sk.modelToSketchSpace(_P3(q))) for q in (a, b, c))
    pin = comp.constructionPlanes.createInput()
    pin.setByThreePoints(sa, sb, sc)
    pl = comp.constructionPlanes.add(pin)
    try:
        pl.name = name + ' plane'
    except Exception:
        pass
    return pl


def _poly(sk, pts):
    lines = sk.sketchCurves.sketchLines
    S = lambda p: sk.modelToSketchSpace(_P3(p))
    first = lines.addByTwoPoints(S(pts[0]), S(pts[1]))
    prev = first
    for p in pts[2:]:
        prev = lines.addByTwoPoints(prev.endSketchPoint, S(p))
    lines.addByTwoPoints(prev.endSketchPoint, first.startSketchPoint)


def _revolve_cone(comp, p0, d0, p1, d1, wall, name):
    """Merge collector as a sketch profile revolved about its axis (parametric)."""
    u = _unit(_sub(p1, p0))
    e1, _e2 = RT.perp_basis(u)
    off = lambda p, r: tuple(p[k] + e1[k] * r for k in range(3))
    plane = _plane_3pt(comp, p0, p1, off(p0, d0), name)
    sk = comp.sketches.add(plane)
    sk.name = name + ' profile'
    S = lambda p: sk.modelToSketchSpace(_P3(p))
    axis = sk.sketchCurves.sketchLines.addByTwoPoints(S(p0), S(p1))
    axis.isConstruction = True
    _poly(sk, [off(p0, d0 / 2.0 - wall), off(p0, d0 / 2.0), off(p1, d1 / 2.0), off(p1, d1 / 2.0 - wall)])
    prof = None
    for i in range(sk.profiles.count):
        if sk.profiles.item(i).profileLoops.count == 1:
            prof = sk.profiles.item(i)
    if prof is None:
        raise RuntimeError('profile')
    rv = comp.features.revolveFeatures
    inp = rv.createInput(prof, axis, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    inp.setAngleExtent(False, adsk.core.ValueInput.createByString('360 deg'))
    f = rv.add(inp)
    f.bodies.item(0).name = name
    return f


def _extrude_section(comp, origin, x, y, z, length, outline, name, op=None):
    """Extrude a closed outline drawn in the plane through origin (axes x, y) along z by length; op: a Fusion
    FeatureOperations value (new body when None; a cut with CutFeatureOperation)."""
    plane = _plane_3pt(comp, origin, RT.vadd(origin, x), RT.vadd(origin, y), name)
    sk = comp.sketches.add(plane)
    sk.name = name + ' section'
    outline(sk)
    prof = sk.profiles.item(0)
    best = 0.0
    for i in range(sk.profiles.count):     # the outer profile is the biggest
        pr = sk.profiles.item(i)
        try:
            a = pr.areaProperties().area
        except Exception:
            a = 0.0
        if a > best:
            best, prof = a, pr
    nrm = _cross(_t(sk.xDirection), _t(sk.yDirection))
    sign = 1.0 if _dot(nrm, z) >= 0 else -1.0
    ex = comp.features.extrudeFeatures
    f = ex.addSimple(prof, adsk.core.ValueInput.createByReal(sign * length),
                     op if op is not None else adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    if op is None:
        f.bodies.item(0).name = name
    return f


def _stadium(sk, c0, x, y, w, h):
    """A flat oval (stadium) w across x by h across y, centred on c0, drawn as two lines and two arcs from plain
    points (coincident ends close the profile); a circle when w = h."""
    S = lambda p: sk.modelToSketchSpace(_P3(p))
    at = lambda u, v: RT.vadd(c0, RT.vadd(RT.vmul(x, u), RT.vmul(y, v)))
    if abs(w - h) < 1e-6:
        sk.sketchCurves.sketchCircles.addByCenterRadius(S(c0), w / 2.0)
        return
    big, small = max(w, h), min(w, h)
    fl, r = (big - small) / 2.0, small / 2.0
    if w >= h:
        pa, pb, pc, pd, ma, mb = at(-fl, -r), at(fl, -r), at(fl, r), at(-fl, r), at(fl + r, 0), at(-fl - r, 0)
    else:
        pa, pb, pc, pd, ma, mb = at(r, -fl), at(r, fl), at(-r, fl), at(-r, -fl), at(0, fl + r), at(0, -fl - r)
    lines, arcs = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs
    lines.addByTwoPoints(S(pa), S(pb))
    arcs.addByThreePoints(S(pb), S(ma), S(pc))
    lines.addByTwoPoints(S(pc), S(pd))
    arcs.addByThreePoints(S(pd), S(mb), S(pa))


def _part_param(comp, part, g):
    """Off-the-shelf part outline as sketches and extrudes: the case (round, flat oval or box) and
    the inlet and outlet stubs. Each is its own body so the case can be swapped for a scan later."""
    x, y, z = g['x'], g['y'], g['z']
    w, h = float(part['w']), float(part['h'])
    body = float(part['body'])
    shape = part.get('shape', 'round')
    c0 = g['case0']
    if shape == 'cone':
        w2 = float(part.get('w2') or w)
        bore = 0.05      # a hair of bore so the profile stays off the axis line
        feats = [_revolve_cone(comp, c0, w + 0.0, g['case1'], w2, max(w, w2) / 2.0 - bore, part['name'] + ' outline')]
        d = part.get('out_d') or 0.0
        L = RT.vdot(RT.vsub(g['p_out'], g['case1']), z)
        if d > 0 and L > 0.05:
            circ = lambda sk, a=g['case1'], d=d: sk.sketchCurves.sketchCircles.addByCenterRadius(sk.modelToSketchSpace(_P3(a)), d / 2.0)
            feats.append(_extrude_section(comp, g['case1'], x, y, z, L, circ, part['name'] + ' flange'))
        return feats

    def case_outline(sk):
        S = lambda p: sk.modelToSketchSpace(_P3(p))
        at = lambda u, v: RT.vadd(c0, RT.vadd(RT.vmul(x, u), RT.vmul(y, v)))
        if shape == 'rectangular':
            _poly(sk, [at(-w / 2, -h / 2), at(w / 2, -h / 2), at(w / 2, h / 2), at(-w / 2, h / 2)])
        elif shape == 'oval' and abs(w - h) > 1e-6:
            big, small = max(w, h), min(w, h)
            fl = (big - small) / 2.0
            r = small / 2.0
            if w >= h:
                pa, pb, pc, pd = at(-fl, -r), at(fl, -r), at(fl, r), at(-fl, r)
                ma, mb = at(fl + r, 0), at(-fl - r, 0)
            else:
                pa, pb, pc, pd = at(r, -fl), at(r, fl), at(-r, fl), at(-r, -fl)
                ma, mb = at(0, fl + r), at(0, -fl - r)
            lines = sk.sketchCurves.sketchLines
            arcs = sk.sketchCurves.sketchArcs
            l1 = lines.addByTwoPoints(S(pa), S(pb))
            a1 = arcs.addByThreePoints(l1.endSketchPoint, S(ma), S(pc))
            e1 = a1.endSketchPoint if _norm(_sub(_t(a1.endSketchPoint.worldGeometry), pc)) < 1e-4 else a1.startSketchPoint
            l2 = lines.addByTwoPoints(e1, S(pd))
            arcs.addByThreePoints(l2.endSketchPoint, S(mb), l1.startSketchPoint)
        else:
            sk.sketchCurves.sketchCircles.addByCenterRadius(S(c0), w / 2.0)

    feats = []
    try:
        feats.append(_extrude_section(comp, c0, x, y, z, body, case_outline, part['name'] + ' case'))
        # each stub runs along the part's axis from its own port: an offset inlet or outlet stays offset
        L_in = RT.vdot(RT.vsub(c0, g['p_in']), z)
        L_out = RT.vdot(RT.vsub(g['p_out'], g['case1']), z)
        for key, d, a, L in (('in', part['in_d'], g['p_in'], L_in),
                             ('out', part['out_d'], RT.vsub(g['p_out'], RT.vmul(z, L_out)), L_out)):
            if d > 0 and L > 0.05:
                circ = lambda sk, a=a, d=d: sk.sketchCurves.sketchCircles.addByCenterRadius(sk.modelToSketchSpace(_P3(a)), d / 2.0)
                feats.append(_extrude_section(comp, a, x, y, z, L, circ, part['name'] + ' ' + key + 'let'))
    except Exception:
        for f in reversed(feats):        # leave nothing half made: the caller adds the outline instead
            try:
                f.deleteMe()
            except Exception:
                pass
        raise
    return feats


def _attach_param(comp, att, pl, name):
    """A weld-on fitting as a cylinder standing on the tube: from just inside the tube wall out by its height."""
    d, h, tr = float(att['d']), float(att['h']), float(att['tube_r'])
    u = pl['dir']
    origin = RT.vadd(pl['center'], RT.vmul(u, tr - 0.2))
    e1, e2 = RT.perp_basis(u)
    circ = lambda sk, o=origin, d=d: sk.sketchCurves.sketchCircles.addByCenterRadius(sk.modelToSketchSpace(_P3(o)), d / 2.0)
    return _extrude_section(comp, origin, e1, e2, u, h + 0.2, circ, name)


def _cone_shell(p0, r0, p1, r1, wall):
    """A cone frustum with its wall taken out, as a fixed body: the merge collector when the revolve is refused.
    The wall is measured square to the axis, as in _revolve_cone; the inner cone runs a hair past both ends so
    the cut goes clean through."""
    tbm = adsk.fusion.TemporaryBRepManager.get()
    L = _norm(_sub(p1, p0))
    u = _unit(_sub(p1, p0))
    k = (r1 - r0) / L if L > 1e-9 else 0.0
    e = 0.05
    outer = tbm.createCylinderOrCone(_P3(p0), r0, _P3(p1), r1)
    a = tuple(p0[i] - u[i] * e for i in range(3))
    b = tuple(p1[i] + u[i] * e for i in range(3))
    inner = tbm.createCylinderOrCone(_P3(a), max(0.01, r0 - wall - k * e), _P3(b), max(0.01, r1 - wall + k * e))
    if outer is None or inner is None or not tbm.booleanOperation(outer, inner, adsk.fusion.BooleanTypes.DifferenceBooleanType):
        raise RuntimeError('collector outline')
    return outer


def _merge_param(comp, p, name):
    """The merge (merge.plan) as features: the shell and the spike revolved from one half section, the merge plate
    extruded from its holes, all joined into one body. Anything made before a refusal is taken out again."""
    u = p['axis']
    e1, e2 = RT.perp_basis(u)
    A = lambda x, r=0.0: MRG.at(p, x, r, e1)
    feats = []
    try:
        plane = _plane_3pt(comp, A(0.0), A(1.0), A(0.0, 1.0), name)
        sk = comp.sketches.add(plane)
        sk.name = name + ' section'
        S = lambda q: sk.modelToSketchSpace(_P3(q))
        axis = sk.sketchCurves.sketchLines.addByTwoPoints(S(A(-p['sleeve'] - 0.5)), S(A(p['length'] + 0.5)))
        axis.isConstruction = True
        _poly(sk, [A(x, r) for x, r in p['section']])
        t = p['plate_t']
        if p['spike']:
            sp = p['spike']
            rb, Ls = sp['r'], sp['len']
            # its foot runs half into the plate so the two join through metal, not along a face; a rolled spike is
            # a cone of sheet, closed underneath by the plate
            if sp['hollow']:
                _poly(sk, [A(0.5 * t, sp['r_in']), A(0.5 * t, rb), A(t, rb), A(t + Ls), A(t + sp['len_in']), A(t, sp['r_in'])])
            else:
                _poly(sk, [A(0.5 * t), A(0.5 * t, rb), A(t, rb), A(t + Ls)])
        profs = adsk.core.ObjectCollection.create()
        for i in range(sk.profiles.count):
            if sk.profiles.item(i).profileLoops.count == 1:
                profs.add(sk.profiles.item(i))
        if profs.count != (2 if p['spike'] else 1):
            raise RuntimeError('section profiles')
        rv = comp.features.revolveFeatures
        inp = rv.createInput(profs, axis, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        inp.setAngleExtent(False, adsk.core.ValueInput.createByString('360 deg'))
        f = rv.add(inp)
        feats.append(f)
        bodies = [f.bodies.item(i) for i in range(f.bodies.count)]
        if p['plate']:
            pl = p['plate']

            def outline(sk2):
                C = sk2.sketchCurves.sketchCircles
                # the plate's rim runs half a wall into the sleeve, again so they join through metal
                C.addByCenterRadius(sk2.modelToSketchSpace(_P3(pl['center'])), pl['r'] + 0.5 * p['wall'])
                for c, r in pl['holes']:
                    C.addByCenterRadius(sk2.modelToSketchSpace(_P3(c)), r)
            fp = _extrude_section(comp, pl['center'], e1, e2, u, t, outline, name + ' plate')
            feats.append(fp)
            bodies += [fp.bodies.item(i) for i in range(fp.bodies.count)]
        target = max(bodies, key=lambda b: b.volume)
        tools = adsk.core.ObjectCollection.create()
        for b in bodies:
            if b != target:
                tools.add(b)
        if tools.count:
            ci = comp.features.combineFeatures.createInput(target, tools)
            ci.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation
            feats.append(comp.features.combineFeatures.add(ci))
        target.name = name
        if target.lumps.count != 1:
            raise RuntimeError('the merge came out in %d pieces' % target.lumps.count)
        try:
            sk.isVisible = False
            plane.isLightBulbOn = False
        except Exception:
            pass
        return target
    except Exception:
        for f in reversed(feats):
            try:
                f.deleteMe()
            except Exception:
                pass
        raise


def _merge_body(p):
    """The same merge as one fixed body (temporary B-Rep), when the features are refused."""
    tbm = adsk.fusion.TemporaryBRepManager.get()
    BT = adsk.fusion.BooleanTypes
    u = p['axis']
    e1, _e2 = RT.perp_basis(u)
    A = lambda x, r=0.0: _P3(MRG.at(p, x, r, e1))
    s, t, L, e = p['sleeve'], p['plate_t'], p['length'], 0.05
    Ri0, Ro0, Ri1, Ro1 = p['Ri0'], p['Ro0'], p['Ri1'], p['Ro1']
    k = (Ri1 - Ri0) / (L - t)

    def cc(x0, r0, x1, r1):
        b = tbm.createCylinderOrCone(A(x0), r0, A(x1), r1)
        if b is None:
            raise RuntimeError('cone')
        return b

    def op(a, b, how):
        if not tbm.booleanOperation(a, b, how):
            raise RuntimeError('boolean')
    shell = cc(-s, Ro0, t, Ro0)
    op(shell, cc(t, Ro0, L, Ro1), BT.UnionBooleanType)
    hole = cc(-s - e, Ri0, t, Ri0)
    op(hole, cc(t, Ri0, L + e, Ri1 + k * e), BT.UnionBooleanType)
    op(shell, hole, BT.DifferenceBooleanType)
    if p['plate']:
        pl = p['plate']
        plate = cc(0.0, Ri0 + 0.5 * p['wall'], t, Ri0 + 0.5 * p['wall'])
        for c, r in pl['holes']:
            a = tuple(c[i] - u[i] * e for i in range(3))
            b = tuple(c[i] + u[i] * (t + e) for i in range(3))
            h = tbm.createCylinderOrCone(_P3(a), r, _P3(b), r)
            op(plate, h, BT.DifferenceBooleanType)
        op(shell, plate, BT.UnionBooleanType)
    if p['spike']:
        S = p['spike']
        rb, Ls = S['r'], S['len']
        sp = cc(0.5 * t, rb, t, rb)

        def cone(r0, h):
            for r_tip in (0.0, 0.002):
                try:
                    return cc(t, r0, t + h, r_tip)
                except Exception:
                    pass
            return None
        tip = cone(rb, Ls)
        if tip is not None:
            op(sp, tip, BT.UnionBooleanType)
            if S['hollow']:
                inner = cone(S['r_in'], S['len_in'])
                if inner is not None:
                    op(sp, inner, BT.DifferenceBooleanType)
        op(shell, sp, BT.UnionBooleanType)
    return shell


def _merge_collector(comp, col, ends, od, wall, name, notes, lead_end=None):
    """A merge collector or Y merge as one welded part: slip sleeve, merge plate with a bore-size hole per tube,
    cone and centre spike (merge.plan), as features, else as a fixed body; a plain cone when the tube ends do not
    sit on one ring at the inlet. Returns what the builders list."""
    L = _norm(_sub(col['end'], col['start']))
    try:
        p = MRG.plan(col['start'], _sub(col['end'], col['start']), [tuple(q) for q in ends], od, wall,
                     col['d_in'], col['d_out'], L, lead_end=lead_end)
    except ValueError as ex:
        notes.append('%s was built as a plain cone: %s' % (name, ex))
        try:
            _revolve_cone(comp, col['start'], col['d_in'], col['end'], col['d_out'], wall, name)
            return {'param': True}
        except Exception:
            body = _cone_shell(col['start'], col['d_in'] / 2.0, col['end'], col['d_out'] / 2.0, wall)
            _add_bodies(comp, [(body, name + ' (outline)')])
            return {'param': False}
    for s in p['notes']:
        notes.append('%s: %s' % (name, s))
    try:
        _merge_param(comp, p, name)
        return {'param': True, 'merge': p, 'name': name}
    except Exception:
        _add_bodies(comp, [(_merge_body(p), name + ' (fixed)')])
        return {'param': False, 'merge': p, 'name': name}


def _part_bodies(part, g):
    """An off-the-shelf part's outline as one fixed body, when the sketches and extrudes are refused: the same
    shapes as _part_param (round, flat oval, box or cone case, and the inlet and outlet stubs). Returns a list:
    one body, or more when Fusion refuses to join a piece to the rest."""
    tbm = adsk.fusion.TemporaryBRepManager.get()
    x, y, z = g['x'], g['y'], g['z']
    w, h, body = float(part['w']), float(part['h']), float(part['body'])
    shape = part.get('shape', 'round')
    c0, c1 = g['case0'], g['case1']
    mid = tuple((c0[k] + c1[k]) / 2.0 for k in range(3))
    pieces = []
    if shape == 'cone':
        pieces.append(tbm.createCylinderOrCone(_P3(c0), w / 2.0, _P3(c1), float(part.get('w2') or w) / 2.0))
    elif shape == 'rectangular':
        pieces.append(tbm.createBox(adsk.core.OrientedBoundingBox3D.create(_P3(mid), _V3(z), _V3(x), body, w, h)))
    elif shape == 'oval' and abs(w - h) > 1e-6:
        big, small = max(w, h), min(w, h)
        fl = (big - small) / 2.0
        ax = x if w >= h else y                      # the long way across the case
        # the box is 20 microns thinner than the round ends, so its faces cross them instead of touching
        pieces.append(tbm.createBox(adsk.core.OrientedBoundingBox3D.create(_P3(mid), _V3(z), _V3(ax), body, 2 * fl, small - 0.002)))
        for s in (-fl, fl):
            a = tuple(c0[k] + ax[k] * s for k in range(3))
            b = tuple(c1[k] + ax[k] * s for k in range(3))
            pieces.append(tbm.createCylinderOrCone(_P3(a), small / 2.0, _P3(b), small / 2.0))
    else:
        pieces.append(tbm.createCylinderOrCone(_P3(c0), w / 2.0, _P3(c1), w / 2.0))
    L_in = RT.vdot(RT.vsub(c0, g['p_in']), z)
    L_out = RT.vdot(RT.vsub(g['p_out'], c1), z)
    for key, d, a, L in (('in', part.get('in_d') or 0.0, g['p_in'], L_in),
                         ('out', part.get('out_d') or 0.0, RT.vsub(g['p_out'], RT.vmul(z, L_out)), L_out)):
        if shape == 'cone' and key == 'in':
            continue                                 # as _part_param: a cone (stack, filter) has only its flange
        if d > 0 and L > 0.05:                       # along the axis from its own port, as _part_param
            pieces.append(tbm.createCylinderOrCone(_P3(a), d / 2.0, _P3(RT.vadd(a, RT.vmul(z, L))), d / 2.0))
    pieces = [p for p in pieces if p is not None]
    if not pieces:
        raise RuntimeError('part outline')
    out, apart = pieces[0], []
    for p in pieces[1:]:
        if not tbm.booleanOperation(out, p, adsk.fusion.BooleanTypes.UnionBooleanType):
            apart.append(p)                          # a union Fusion refused: keep that piece as its own body
    return [out] + apart


def _import_cad_at(comp, path, att, pl, name):
    """Import a STEP/IGES model from the CAD library and stand it where the fitting goes: the model's Y axis
    points out of the tube, its X axis runs along the tube. The file is opened in a scratch document, its bodies
    copied in as temporary B-Reps (a base feature in a parametric design) and the scratch document closed, which
    works in Part Design documents where importToTarget does not. Returns the list of bodies added."""
    im = _app.importManager
    ext = path.lower().rsplit('.', 1)[-1]
    opts = im.createSTEPImportOptions(path) if ext in ('step', 'stp') else im.createIGESImportOptions(path)
    doc0 = _app.activeDocument
    doc2 = im.importToNewDocument(opts)
    if not doc2:
        return []
    tmp = adsk.fusion.TemporaryBRepManager.get()
    copies = []
    try:
        d2 = adsk.fusion.Design.cast(doc2.products.itemByProductType('DesignProductType'))

        def walk(c, tr):
            for b in c.bRepBodies:
                cp = tmp.copy(b)
                tmp.transform(cp, tr)
                copies.append(cp)
            for i in range(c.occurrences.count):
                o = c.occurrences.item(i)
                t = tr.copy()
                t.transformBy(o.transform)
                walk(o.component, t)
        walk(d2.rootComponent, adsk.core.Matrix3D.create())
    finally:
        try:
            doc0.activate()
        except Exception:
            pass
        try:
            doc2.close(False)
        except Exception:
            pass
    if not copies:
        return []
    tr_ = float(att['tube_r'])
    out_dir, along = RT.vunit(pl['dir']), RT.vunit(pl['axis'])
    side = RT.vcross(out_dir, along)
    origin = RT.vadd(pl['center'], RT.vmul(out_dir, tr_))
    m = adsk.core.Matrix3D.create()
    m.setWithCoordinateSystem(_P3(origin), _V3(along), _V3(out_dir), _V3(side))
    des = _design()
    bf = None
    if des.designType == adsk.fusion.DesignTypes.ParametricDesignType:
        bf = comp.features.baseFeatures.add()
        bf.startEdit()
    added = []
    n0 = comp.bRepBodies.count
    try:
        for i, cp in enumerate(copies):
            tmp.transform(cp, m)
            nb = comp.bRepBodies.add(cp, bf) if bf else comp.bRepBodies.add(cp)
            added.append(nb)
    finally:
        if bf:
            bf.finishEdit()
    # name after finishEdit: a name set while the base feature is open comes back as "BodyN"
    added = [comp.bRepBodies.item(i) for i in range(n0, comp.bRepBodies.count)] or added
    for i, nb in enumerate(added):
        try:
            nb.name = name if len(added) == 1 else '%s %d' % (name, i + 1)
        except Exception:
            pass
    return added


def _V3(v):
    return adsk.core.Vector3D.create(float(v[0]), float(v[1]), float(v[2]))


def _route_item(name, r, gap, od=None, data=None):
    it = {'kind': 'path', 'name': name, 'length': r.get('length'), 'ok': bool(r.get('ok')),
          'lra': r.get('lra'), 'note': r.get('msg')}
    if r.get('min_gap') is not None:
        it['min_gap'] = r['min_gap']
    if od:
        it['od'] = [od]          # the page's cut list picks stock bends of this OD
    if r.get('elems') and od:
        data = data or {}
        it['fab'] = RT.fab_report(r['elems'], od, _cm(data, 'clamp_mm'), _cm(data, 'min_clr_mm'),
                                  data.get('material') or '')
    return it


def _part_spec(p):
    """A part from the page (inches, as the parts list stores them) in cm for the router.
    The case is w wide and h high and body long; oal includes the inlet and outlet stubs.
    at: 'start' (filter or bellmouth at the start marker), 'end' (coupler on the throttle body) or
    in line; lead_in / lead_out: straight pipe the part needs before and after it (a MAF sensor)."""
    I = 2.54
    def num(v):
        if isinstance(v, (list, tuple)):
            v = max(v) if v else None              # a reducer's two sizes: the bigger one bounds the outline
        return None if v in (None, '') else float(v)
    kind = p.get('kind')
    name = ' '.join(str(v) for v in (p.get('brand'), p.get('model'), p.get('pn')) if v) or 'Part'
    out = {'name': name, 'kind': kind, 'at': p.get('at'), 'guessed_size': False, 'assumed_offset': False,
           'lead_in': (num(p.get('lead_in_in')) or 0.0) * I, 'lead_out': (num(p.get('lead_out_in')) or 0.0) * I,
           'in_off': (0.0, 0.0), 'out_off': (0.0, 0.0)}
    if kind in ('bov', 'bung', 'mafbung'):
        tube_od = num(p.get('tube_od_in'))
        if not tube_od:
            raise ValueError('%s: the pipe size is missing for this fitting.' % name)
        if kind == 'mafbung':
            # a weld-on MAF pad: its footprint is bounded by a round of the longer pad side. Only ICT publishes
            # pad sizes (2 x 2 x 1 in, 3 x 2 x 1 in); anything else is a 2 in / 1 in guess and flagged.
            d = max([v for v in (num(p.get('padL')), num(p.get('padW'))) if v] or [0]) or None
            h = num(p.get('padH'))
            if not d:
                d = 2.0
                out['guessed_size'] = True
            if h is None:
                h = 1.0
                out['guessed_size'] = True
            out['cad'] = p.get('cad')
            out.update({'attach': True, 'd': d * I, 'h': h * I, 'tube_r': tube_od * I / 2.0, 'prefer': p.get('prefer') or 'mid',
                        'lead': (num(p.get('lead_in_in')) or 3.0) * I, 'lead_out': (num(p.get('lead_out_in')) or 1.0) * I,
                        'min_from_end': (num(p.get('min_from_end_in')) or 8.0) * I,
                        'shape': 'round', 'w': d * I, 'h_case': h * I, 'oal': h * I})
            return out
        if kind == 'bov':
            d = num(p.get('bodyD')) or num(p.get('flangeOD'))
            h = num(p.get('h'))
            if not d:
                raise ValueError('%s: neither the body nor the flange diameter is published; enter it as a custom fitting.' % name)
            if h is None:
                h = 3.5                       # a typical 50 mm valve on its flange; the maker does not publish it
                out['guessed_size'] = True
        else:
            d = num(p.get('od'))
            h = num(p.get('h'))
            if not d:
                raise ValueError('%s: the bung outside diameter is not published.' % name)
            if h is None:
                h = 1.0
                out['guessed_size'] = True
        out['cad'] = p.get('cad')
        out.update({'attach': True, 'd': d * I, 'h': h * I, 'tube_r': tube_od * I / 2.0, 'prefer': p.get('prefer') or 'end',
                    'shape': 'round', 'w': d * I, 'h_case': h * I, 'oal': h * I})
        return out
    if kind == 'intercooler':
        raise ValueError('%s: model the intercooler core and tanks as a body (or scan them) and set them as a keep-out; '
                         'then auto-route the hot side to its inlet and the cold side from its outlet.' % name)
    if kind == 'filter':
        L = num(p.get('L'))
        fl = num(p.get('flangeL')) or 0.0
        fid = num(p.get('flangeID'))
        if not (L and fid):
            raise ValueError('%s: the filter length or flange size is not published; enter it as a custom part.' % name)
        shape = p.get('shape') or 'cone'
        base = num(p.get('baseOD')) or num(p.get('baseW'))
        top = num(p.get('topOD')) or num(p.get('topW')) or base
        if base is None:
            raise ValueError('%s: the filter base size is not published.' % name)
        if shape == 'oval':
            out.update({'shape': 'oval', 'w': base * I, 'h': (num(p.get('baseH')) or base) * I})
        else:
            # the closed top faces upstream, the base sits at the flange
            out.update({'shape': 'cone', 'w': top * I, 'w2': base * I, 'h': top * I})
        out.update({'oal': L * I, 'body': (L - fl) * I, 'stub_in': 0.0, 'in_d': 0.0, 'out_d': fid * I})
        return out
    if kind == 'stack':
        De = num(p.get('De'))
        lip = num(p.get('lipOD'))
        L = num(p.get('L'))
        if not (De and lip):
            raise ValueError('%s: the throat or lip size is not published; enter it as a custom part.' % name)
        if L is None:
            L = De                                   # Blair and Cahoon: best length is one exit diameter
            out['guessed_size'] = True
        out.update({'shape': 'cone', 'w': lip * I, 'w2': (De + 0.25) * I, 'h': lip * I, 'oal': L * I, 'body': L * I,
                    'stub_in': 0.0, 'in_d': 0.0, 'out_d': De * I})
        return out
    if kind == 'coupler':
        d = num(p.get('id1'))
        L = num(p.get('L'))
        if not (d and L):
            raise ValueError('%s: the coupler size or length is not published.' % name)
        od = num(p.get('od')) or (d + 2 * (num(p.get('wall')) or 0.197))
        out.update({'shape': 'round', 'w': od * I, 'h': od * I, 'oal': L * I, 'body': L * I, 'in_d': d * I,
                    'out_d': (num(p.get('id2')) or d) * I})
        return out
    if kind == 'clamp':
        t = num(p.get('tubeOD'))
        o = num(p.get('clampOD')) or num(p.get('flangeOD'))
        wdt = num(p.get('width'))
        if not (t and o and wdt):
            raise ValueError('%s: the clamp outside size or width is not published, so it cannot be modelled.' % name)
        out.update({'shape': 'round', 'w': o * I, 'h': o * I, 'oal': wdt * I, 'body': wdt * I, 'in_d': t * I, 'out_d': t * I})
        return out
    if kind == 'maf':
        d = num(p.get('tubeD')) or num(p.get('housingID'))
        L = num(p.get('L')) or num(p.get('oal'))
        if not (d and L):
            raise ValueError('%s: the housing size or length is not published; the straight tube rule is used instead.' % name)
        od = d + 2 * 0.065
        out.update({'shape': 'round', 'w': od * I, 'h': od * I, 'oal': L * I, 'body': L * I, 'in_d': d * I, 'out_d': d * I})
        return out
    shape = (p.get('shape') or 'round').lower()
    ind = num(p.get('inD')) or num(p.get('id')) or 0.0
    outd = num(p.get('outD')) or ind
    oal = num(p.get('oal')) or 0.0
    if oal <= 0 or ind <= 0:
        raise ValueError('%s has no published overall length or inlet size; enter it as a custom part.' % name)
    body = num(p.get('body')) or num(p.get('bellowsL')) or oal
    w = num(p.get('w')) or num(p.get('od'))
    h = num(p.get('h')) or w
    if w is None:
        w = h = ind + 0.5             # a flex pipe or tube part with no published outside size
        out['guessed_size'] = True
    big = max(w, h)
    off_in = num(p.get('offset_in'))

    def off(pos, d):
        if pos != 'offset':
            return (0.0, 0.0)
        x = off_in if off_in is not None else max(0.0, (big - d) / 2.0 - 0.25)
        return (x * I, 0.0)
    xi = off(p.get('inPos'), ind)
    xo = off(p.get('outPos'), outd)
    if p.get('inPos') == 'offset' and p.get('outPos') == 'offset' and p.get('opposite'):
        xo = (-xo[0], xo[1])
    out.update({'oal': oal * I, 'body': min(body, oal) * I, 'shape': shape, 'w': w * I, 'h': h * I,
                'in_d': ind * I, 'out_d': outd * I, 'in_off': xi, 'out_off': xo,
                'assumed_offset': (p.get('inPos') == 'offset' or p.get('outPos') == 'offset') and off_in is None})
    return out


class _BayFrame(object):
    """The template's bay frame (X forward, Y to the driver's side, Z up) placed on the model's markers."""
    def __init__(self, origin, ex, ey, ez):
        self.o, self.ex, self.ey, self.ez = origin, ex, ey, ez

    def to(self, p):
        q = _sub(p, self.o)
        return (_dot(q, self.ex), _dot(q, self.ey), _dot(q, self.ez))

    def to_dir(self, d):
        return (_dot(d, self.ex), _dot(d, self.ey), _dot(d, self.ez))

    def out_dir(self, d):
        return tuple(self.ex[k] * d[0] + self.ey[k] * d[1] + self.ez[k] * d[2] for k in range(3))

    def out(self, p):
        v = self.out_dir(p)
        return (self.o[0] + v[0], self.o[1] + v[1], self.o[2] + v[2])

    def elems(self, elems):
        out = []
        for e in elems:
            if e[0] == 'line':
                out.append(('line', self.out(e[1]), self.out(e[2]), e[3]))
            else:
                out.append(('arc', self.out(e[1]), self.out(e[2]), self.out(e[3]), e[4], e[5],
                            self.out_dir(e[6]), self.out_dir(e[7])))
        return out


class _FrameScene(object):
    """The keep-out scene queried from the bay frame."""
    def __init__(self, scene, frame):
        self.scene, self.frame = scene, frame
        self.built = bool(scene is not None and getattr(scene, 'built', False))

    def dist_exact(self, p, cap, planes=None):
        return self.scene.dist_exact(self.frame.out(p), cap, planes)


def _firing_order(data, n):
    o = data.get('order')
    if isinstance(o, str):
        o = [int(s) for s in o.replace(',', '-').replace(' ', '-').split('-') if s.strip()]
    if not o:
        o = [1, 8, 7, 2, 6, 5, 4, 3] if n == 8 else list(range(1, n + 1))
    if sorted(o) != list(range(1, n + 1)):
        raise ValueError('The firing order must list cylinders 1 to %d once each (got %s).' % (n, o))
    return o


def _route_bundle180(data, sp, mk, scene, log, notes, title):
    """True 180-degree headers from the template: eight port markers selected in cylinder order (1..8),
    then the two collector markers (either order). Returns (comp, built, items, msg)."""
    if len(mk) != 10:
        raise ValueError('Select the eight port markers in cylinder order (1 to 8), then the two collector '
                         'markers: %d selected.' % len(mk))
    ports, cols = mk[:8], mk[8:]
    ez = _unit(_up_vector())
    mean = lambda ms: tuple(sum(m['p'][k] for m in ms) / float(len(ms)) for k in range(3))
    fwd = _sub(mean(ports[:2]), mean(ports[6:]))
    fwd = _sub(fwd, tuple(ez[k] * _dot(fwd, ez) for k in range(3)))
    if _norm(fwd) < 1.0:
        raise ValueError('Cylinders 1-2 and 7-8 are too close together to tell the front of the engine from the back.')
    ex = _unit(fwd)
    ey = _unit(_cross(ez, ex))
    frame = _BayFrame(mean(ports), ex, ey, ez)
    fp = {}
    for i, m in enumerate(ports):
        c = i + 1
        q = frame.to(m['p'])
        _sign(m, tuple(m['p'][k] + ey[k] * (10.0 if q[1] > 0 else -10.0) for k in range(3)))   # out of the port, outboard
        fp[c] = (q, frame.to_dir(m['d']))
    if sorted(1 if fp[c][0][1] > 0 else -1 for c in fp) != [-1] * 4 + [1] * 4:
        raise ValueError('The port markers do not split four to a bank across the engine centreline; check the '
                         'cylinder order they were selected in.')
    if sum(1 for c in (1, 3, 5, 7) if fp[c][0][1] > 0) not in (0, 4):
        raise ValueError('Odd and even cylinders must sit on opposite banks (select the markers in cylinder order).')
    for m in cols:
        _sign(m, tuple(m['p'][k] - ex[k] * 10.0 for k in range(3)))                            # gas flows rearward
    ca, cb = (cols[0], cols[1]) if frame.to(cols[0]['p'])[1] > 0 else (cols[1], cols[0])
    cA = (frame.to(ca['p']), frame.to_dir(ca['d']))
    cB = (frame.to(cb['p']), frame.to_dir(cb['d']))
    order = _firing_order(data, 8)
    od, wall = sp['od'], sp['wall']
    B = TPL.Bundle180(fp, cA, cB, order, od / TPL.IN, sp['clr'] / TPL.IN, scene=_FrameScene(scene, frame),
                      params=data.get('template_params') or None, log=log)
    target_in = (sp['target'] / TPL.IN) if sp.get('target') else None
    res = B.layout(target_in)
    for n in res.get('notes') or []:
        notes.append(n)
    comp = _new_component(title)
    built, items = [], []
    for c in sorted(res['tubes']):
        t = res['tubes'][c]
        el = frame.elems(t['elems'])
        gap = t.get('scene_gap')
        ok = (not t.get('bend_overlap')) and (gap is None or gap >= sp['gap'])
        msg = []
        if t.get('bend_overlap'):
            msg.append('two bends overlap: give it a tighter radius or a different plan.')
        if gap is not None and gap < sp['gap']:
            msg.append('%.1f mm from the scan at (%s) cm; your rule is %.1f mm.' % (
                10 * gap, ', '.join('%.1f' % v for v in frame.out(t['where'])), 10 * sp['gap']))
        r = {'elems': el, 'length': t['length'], 'ok': ok, 'lra': RT.lra_schedule(el),
             'min_gap': gap, 'msg': ' '.join(msg) if msg else ('%s tube, trimmed %.1f in; collector %s' % (
                 B.role[c], t.get('trim') or 0.0, B.coll_of[c]))}
        nm = 'Primary %d (collector %s)' % (c, B.coll_of[c])
        built.append(_build_route(comp, r, nm, od, wall, title + '_primary'))
        items.append(_route_item(nm, r, sp['gap'], od, data))
    clen = _cm(data, 'collector_len_mm') or 15.0
    cout = _cm(data, 'collector_out_mm') or od * 1.6
    for tag, m in (('A', ca), ('B', cb)):
        col = RT.collector_body(m['p'], m['d'], 4, od, clen, cout, scene, sp['gap'])
        nm = 'Collector %s (cyl %s)' % (tag, ', '.join(str(c) for c in res['groups'][tag]))
        try:
            ends = [frame.elems(res['tubes'][c]['elems'])[-1][2] for c in res['groups'][tag]]
        except Exception:
            ends = RT.collector_slots(m['p'], m['d'], 4, od)
        built.append(_merge_collector(comp, col, ends, od, wall, nm, notes))
        if col.get('min_gap') is not None and col['min_gap'] < sp['gap']:
            notes.append('%s comes within %.1f mm of the scan.' % (nm, 10 * col['min_gap']))
    for k, v in res['pairs'].items():
        if v[0] is not None and v[0] < 0.125 * TPL.IN * 0.8:
            notes.append('Primaries %s pass %.1f mm apart at (%s) cm.' % (
                k.strip('()'), 10 * v[0], ', '.join('%.1f' % q for q in frame.out(v[1]))))
    lens = [res['tubes'][c]['length'] for c in res['tubes']]
    msg = ('Built eight 180-degree primaries, %.1f in each (spread %.1f mm), into collectors A (%s) and B (%s); '
           'the deep crossing is on the %s bank.' % (
               res['target_in'], 10 * TPL.IN * (max(lens) - min(lens)),
               '-'.join(str(c) for c in res['groups']['A']), '-'.join(str(c) for c in res['groups']['B']),
               'driver\'s' if res['deep_side'] > 0 else 'passenger\'s'))
    if not res['ok']:
        msg += ' Some tubes need attention (see below).'
    return comp, built, items, msg


def act_route(data):
    """Auto-route through the keep-outs (a scan). mode: 'single' (select a start and an end marker),
    'header' (select each port marker, then the collector marker last), 'bundle180' (eight port markers in
    cylinder order, then both collector markers: the 180-degree template) or 'parts' (start and end,
    with the page's parts in line)."""
    t0 = __import__('time').time()
    del _LAST_TUBES[:]
    mode = data.get('mode') or 'single'
    sp = _route_spec(data)
    mk = _markers()
    notes = []
    title = str(data.get('title') or 'Auto route')
    if mode in ('single', 'parts') and len(mk) != 2:
        raise ValueError('Select two marker lines: one at the start and one at the end. Draw each from the '
                         'centre of the pipe the way the gas flows (a circular edge works too).')
    if mode == 'triy':
        grp = data.get('groups') or []
        nport = sum(len(g) for g in grp)
        if not grp or len(mk) != nport + len(grp) + 1:
            raise ValueError('Two-stage header: select the %d port markers in cylinder order, then one marker for each of '
                             'the %d Y merges (in the order the page lists the pairs), then the collector marker last: '
                             '%d markers in all, %d are selected. Draw each from the centre the way the gas flows.' % (
                                 nport, len(grp), nport + len(grp) + 1, len(mk)))
    if mode == 'header' and len(mk) < 2:
        raise ValueError('Select a marker line at each port, then the collector marker last. Draw each from '
                         'the centre the way the gas flows: out of the port, and into the collector.')
    ends = mk[-1]
    if mode != 'bundle180':
        for m in mk[:-1]:
            _sign(m, ends['p'])
        if not ends['signed']:
            c = tuple(sum(m['p'][k] for m in mk[:-1]) / (len(mk) - 1) for k in range(3))
            if _dot(ends['d'], _sub(ends['p'], c)) < 0:
                ends['d'] = _neg(ends['d'])
    reach = (sp['target'] or 0) / 2.0 + 10.0
    if mode == 'bundle180':
        reach = max(reach, 80.0)        # the template's forward lobes and crossings reach well past the markers
    pts = [m['p'] for m in mk]
    lo = tuple(min(p[k] for p in pts) for k in range(3))
    hi = tuple(max(p[k] for p in pts) for k in range(3))
    span = max(_norm(_sub(hi, lo)), 1.0)
    pad = max(reach, 0.5 * span + 10.0)
    _status('Reading the scan…')
    scene = _scene(lo, hi, pad, notes)
    _status('Routing…')
    log = lambda s: _status(s)
    items = []
    built = []
    comp = None
    coped = False
    od, wall = sp['od'], sp['wall']
    rspec = {k: v for k, v in sp.items() if k != 'wall'}
    if mode == 'bundle180':
        comp, built, items, msg = _route_bundle180(data, sp, mk, scene, log, notes, title)
    elif mode == 'header':
        hs = dict(rspec, collector_len=_cm(data, 'collector_len_mm'), collector_out_d=_cm(data, 'collector_out_mm'),
                  clock_deg=data.get('clock_deg'))
        tl = data.get('targets_mm')          # unequal-length headers: one length per port marker, in selection order
        if isinstance(tl, list) and tl:
            if len(tl) != len(mk) - 1:
                raise ValueError('Unequal-length headers: %d lengths were given for %d port markers. Select the port '
                                 'markers in cylinder order so each gets its own length.' % (len(tl), len(mk) - 1))
            hs['targets'] = [float(v) / 10.0 if v else None for v in tl]
            hs['target'] = None
        res = RT.route_header(scene, [(m['p'], m['d']) for m in mk[:-1]], (ends['p'], ends['d']), hs, log=log)
        comp = _new_component(title)
        for i, r in enumerate(res['primaries']):
            nm = 'Primary %d' % (i + 1)
            if r.get('elems'):
                built.append(_build_route(comp, r, nm, od, wall, title + '_primary'))
            items.append(_route_item(nm, r, sp['gap'], od, data))
        col = res.get('collector')
        if col:
            built.append(_merge_collector(comp, col, res['slots'], od, wall, 'Merge collector', notes, hs.get('lead_end')))
            if col.get('min_gap') is not None and col['min_gap'] < sp['gap']:
                notes.append('The merge collector comes within %.2f cm of the scan.' % col['min_gap'])
        lens = [r['length'] for r in res['primaries'] if r.get('length')]
        msg = 'Built %d primar%s into the collector' % (len(lens), 'y' if len(lens) == 1 else 'ies')
        if hs.get('targets'):
            errs = [abs(r['length'] - t) for r, t in zip(res['primaries'], hs['targets']) if r.get('length') and t]
            msg += '; unequal lengths as asked (%s cm), largest miss %.2f mm' % (
                ', '.join('%.1f' % r['length'] for r in res['primaries'] if r.get('length')), 10 * max(errs) if errs else 0.0)
        elif len(lens) > 1:
            msg += '; lengths within %.2f mm of each other' % (10 * (max(lens) - min(lens)))
        msg += '.' if res['ok'] else '. Some primaries need attention (see below).'
    elif mode == 'triy':
        grp = [[int(i) for i in g] for g in data['groups']]
        nport = sum(len(g) for g in grp)
        sec_od = _cm(data, 'sec_od_mm')
        ts = dict(rspec, target=_cm(data, 'target_mm'), y_len=_cm(data, 'y_len_mm'), sec_od=sec_od,
                  sec_target=_cm(data, 'sec_target_mm'), collector_len=_cm(data, 'collector_len_mm'),
                  collector_out_d=_cm(data, 'collector_out_mm'))
        res = RT.route_triy(scene, [(m['p'], m['d']) for m in mk[:nport]], [(m['p'], m['d']) for m in mk[nport:-1]],
                            (ends['p'], ends['d']), grp, ts, log=log)
        comp = _new_component(title)
        for i, r in enumerate(res['primaries']):
            nm = 'Primary %d' % (i + 1)
            if r and r.get('elems'):
                built.append(_build_route(comp, r, nm, od, wall, title + '_primary'))
            items.append(_route_item(nm, r or {}, sp['gap'], od, data))
        cones = [(y, 'Y merge %d' % (gi + 1), res['stage1'][gi]['slots'], od) for gi, y in enumerate(res['ys'])]
        if res.get('collector'):
            cones.append((res['collector'], 'Merge collector', res['stage2']['slots'], sec_od))
        for gi, r in enumerate(res['secondaries']):
            nm = 'Secondary %d' % (gi + 1)
            if r and r.get('elems'):
                built.append(_build_route(comp, r, nm, sec_od, wall, title + '_secondary'))
            items.append(_route_item(nm, r or {}, sp['gap'], sec_od, data))
        for c, nm, slots, tod in cones:
            built.append(_merge_collector(comp, c, slots, tod, wall, nm, notes, ts.get('lead_end')))
            if c.get('min_gap') is not None and c['min_gap'] < sp['gap']:
                notes.append('%s comes within %.2f cm of the scan.' % (nm, c['min_gap']))
        msg = ('Built %d primaries into %d Y merges (%.1f cm long, each a %d-into-1 at a 15 deg included angle) and %d '
               'secondaries into the collector' % (nport, len(grp), res['y_len'], max(len(g) for g in grp), len(grp),))
        if res.get('sec_target') is not None and ts.get('sec_target') and abs(res['sec_target'] - ts['sec_target']) > 1e-6:
            msg += '; the secondaries are %.1f cm, shorter by what the Y merges take beyond the page\'s %.1f cm, so the valve-to-collector length is as asked' % (
                res['sec_target'], ts['y_len'] or 0.0)
        msg += '.' if res['ok'] else '. Some tubes need attention (see below).'
    elif mode == 'parts':
        parts = [_part_spec(dict(p, tube_od_in=p.get('tube_od_in') or sp['od'] / 2.54)) for p in (data.get('parts') or [])]
        if not parts:
            raise ValueError('Add parts to the build list on the page first.')
        for p in parts:
            if p['guessed_size']:
                notes.append('%s: a size the maker does not publish was assumed (outline only); measure the part.' % p['name'])
            if p['assumed_offset']:
                notes.append('%s: the offset of its inlet or outlet is not published, so it was taken as close to '
                             'the case edge as the pipe allows. Measure the part and enter the offset.' % p['name'])
        res = RT.route_with_parts(scene, dict(rspec, start=mk[0]['p'], start_dir=mk[0]['d'], end=ends['p'],
                                              end_dir=ends['d'], target=None), parts,
                                  up=_up_vector(), log=log)
        comp = _new_component(title)
        for i, r in enumerate(res['pieces']):
            nm = '%s pipe %d' % (title, i + 1)
            if r.get('elems'):
                built.append(_build_route(comp, r, nm, od, wall, title))
            items.append(_route_item(nm, r, sp['gap'], od, data))
        named = []
        for pl, part in zip(res['parts'], res.get('part_specs') or parts):
            try:
                _part_param(comp, part, pl['geom'])
                built.append({'param': True})
            except Exception:
                named.extend((b, part['name'] + ' (outline)') for b in _part_bodies(part, pl['geom']))
                built.append({'param': False})
            where = {'start': 'At the start marker.', 'end': 'At the end marker.'}.get(pl.get('at'), 'Placed %.1f cm along the route.' % pl['s'])
            items.append({'kind': 'part', 'name': part['name'], 'ok': pl['ok'], 'min_gap': pl['gap'],
                          'gap_over': bool(pl.get('gap_over')), 'note': where})
        if named:
            _add_bodies(comp, named)
        for pl, att in zip(res.get('attachments') or [], res.get('attach_specs') or []):
            if pl.get('ok') is not None and pl.get('center') is not None:
                nb0 = comp.bRepBodies.count
                try:
                    _attach_param(comp, att, pl, att['name'] + ' fitting')
                    built.append({'param': True})
                except Exception:
                    built.append({'param': False})
                outline = [comp.bRepBodies.item(i) for i in range(nb0, comp.bRepBodies.count)]
                where = '%.1f cm from the end of the route, clocked %.0f deg round the tube from up' % (pl['from_end'], pl['rot'])
                tip = '. Weld it on a straight run; never on the inside of a bend.'
                cad = find_cad(att.get('cad')) if att.get('cad') else None
                if cad:
                    try:
                        if _import_cad_at(comp, cad, att, pl, att['name'] + ' (CAD model)'):
                            tip += ' The real part was imported from your CAD library (%s) and stood at the same spot: its Y axis out of the tube, X along it; check its orientation. The round outline that stands for its footprint is hidden (turn it on in the browser to see the clearance it was checked with).' % os.path.basename(cad)
                            for ob in outline:
                                try:
                                    ob.isLightBulbOn = False
                                except Exception:
                                    pass
                    except Exception as ex:
                        tip += ' The CAD model %s could not be imported: %s' % (os.path.basename(cad), ex)
                elif att.get('cad'):
                    tip += ' No STEP file matching "%s" was found in the CAD library (%s).' % (att['cad'], '; '.join(cad_dirs()))
                if att.get('kind') == 'mafbung':
                    tip = tip.replace('. Weld it on a straight run; never on the inside of a bend.', '').rstrip('.') + ('. Sensor arrow toward the throttle; %.0f cm of straight tube before it and %.0f cm after on this run; '
                           'tape the pad on and check fuel trims before welding (AEM); keep the PCV hose between the sensor and the throttle (Spectre).'
                           % (att.get('lead') or 0, att.get('lead_out') or 0))
                items.append({'kind': 'fitting', 'name': att['name'], 'ok': pl['ok'], 'min_gap': pl['gap'],
                              'gap_over': bool(pl.get('gap_over')), 'note': where + tip})
            else:
                items.append({'kind': 'fitting', 'name': att.get('name'), 'ok': False, 'note': pl.get('msg')})
        msg = 'Built the pipe in %d pieces around %d part%s.' % (len(res['pieces']), len(parts), '' if len(parts) == 1 else 's')
        if not res['ok']:
            msg += ' Some pieces need attention (see below).'
    else:
        jpipe = bool(data.get('cap') or data.get('tee'))
        main = _main_pipe(mk[0]['p'], mk[0]['d'], data, notes, scene) if data.get('tee') else None
        r = RT.route(scene, dict(rspec, start=mk[0]['p'], start_dir=mk[0]['d'], end=ends['p'], end_dir=ends['d']), log=log)
        if not r.get('elems'):
            raise ValueError(r.get('msg') or 'No route was found.')
        comp = _new_component(title)
        b = _build_route(comp, r, title, od, wall, title)
        built.append(b)
        it = _route_item(title, r, sp['gap'], od, data)
        if jpipe:
            _status('Capping and coping the J-pipe…')
            extra = _jpipe_fittings(comp, data, b.get('body'), main, mk[0]['p'], mk[0]['d'], ends['p'], ends['d'],
                                    od, wall, r.get('length'), notes)
            if extra:
                it['note'] = ((it.get('note') or '') + ' ' + extra).strip()
            if 'is coped to the main pipe' in extra:
                coped = True
        items.append(it)
        msg = ('Built %s along a route that clears the scan.' % title.lower()) if r['ok'] else \
            ('Built %s, but it needs attention (see below).' % title.lower())
    _status('Done.')
    secs = __import__('time').time() - t0
    msg += ' %.0f s, %s.' % (secs, RT.NATIVE_NOTE)
    if notes:
        msg += ' ' + ' '.join(notes)
    # each merge as a part of its own in the list, with its cut files (the plate, the cone and the sleeve flat)
    files = []
    for b in built:
        if b.get('merge'):
            items.append({'kind': 'merge', 'name': b['name'], 'ok': True, 'note': MRG.summary(b['merge'], b['name'])})
            files += [{k: f[k] for k in ('name', 'text', 'what')} for f in MRG.cut_files(b['merge'], b['name'])]
    allok = all(it.get('ok', True) for it in items)
    if built and not all(b.get('param') for b in built):
        msg += (' Some geometry could not be made as editable sketches and features, so it was added as '
                'fixed bodies; those parts will not follow parameter changes.')
    elif built:
        msg += (' Everything%s is sketch-driven: tube size and wall follow the user parameters named after '
                'the build, and each centreline sketch can be edited.' % (' but the coped end' if coped else ''))
    return {'ok': True, 'msg': msg, 'items': items, 'route_ok': allok, 'files': files,
            'scan': {'triangles': scene.ntri, 'points': scene.npoints, 'e_cover': scene.e_cover}}


# --------------------------------------------------------------------------
# Drone fixes: the tee on the main pipe, the J-pipe's cap and the Helmholtz can
# --------------------------------------------------------------------------
# A branch (a J-pipe or a Helmholtz neck) starts at a marker on the main pipe's outside, on the branch
# centreline, heading the way the branch leaves. The main pipe comes from a selected cylindrical face, else
# from a solid the marker sits on, else from the scan (a cylinder fitted to the keep-out points round the
# marker). The branch's end is coped to the main pipe's outside as a short fixed piece joined to the tube,
# and a hidden tool body is left for the hole: Combine > Cut the main pipe with it.

def _cyl(g):
    return g is not None and g.surfaceType == adsk.core.SurfaceTypes.CylinderSurfaceType


def _coaxial(g1, g2, tol=1e-4):
    a1, a2 = _unit(_t(g1.axis)), _unit(_t(g2.axis))
    if _norm(_cross(a1, a2)) > 1e-6:
        return False
    return _norm(_cross(_sub(_t(g2.origin), _t(g1.origin)), a1)) < tol


def _pipe_of_face(face, p=None):
    """The main pipe from one of its round faces: its axis, its outside radius and its bore radius when the body
    has one. Of the body's round faces on that axis, the outside is the one the branch start sits on (nearest the
    start's distance from the axis), so a coaxial flange, slip-joint end or muffler case does not stand in for the
    pipe; without a start, the selected face itself (or the face round it when the bore was picked)."""
    g = face.geometry
    radii = [g.radius]
    name = 'the selected face'
    try:
        body = face.body
        name = _bname(body)
        for i in range(body.faces.count):
            g2 = body.faces.item(i).geometry
            if _cyl(g2) and _coaxial(g, g2):
                radii.append(g2.radius)
    except Exception:
        pass
    radii = sorted(set(round(r, 9) for r in radii))
    if p is not None:
        a = _unit(_t(g.axis))
        w = _sub(p, _t(g.origin))
        t = _dot(w, a)
        rho = _norm(_sub(w, tuple(a[k] * t for k in range(3))))
        R = min(radii, key=lambda r: abs(r - rho))
    else:
        R = g.radius
        up = [r for r in radii if r > R + 1e-4]
        if up and up[0] - R < 1.0:      # the bore was picked: the outside is the next face out (a wall under 1 cm)
            R = up[0]
    bore = [r for r in radii if r < R - 1e-4]
    return {'p': _t(g.origin), 'd': _unit(_t(g.axis)), 'R': R, 'R_in': max(bore) if bore else None,
            'name': name, 'how': 'face'}


def _all_solids():
    """Every solid in the design, as proxies in the root's frame (world coordinates)."""
    root = _design().rootComponent
    out = [root.bRepBodies.item(i) for i in range(root.bRepBodies.count)]
    for i in range(root.allOccurrences.count):
        occ = root.allOccurrences.item(i)
        out.extend(occ.bRepBodies.item(j) for j in range(occ.bRepBodies.count))
    return out


def _pipe_under(p, tol=0.2):
    """The round outside face of a solid in the design that the branch start sits on (within 2 mm), or None.
    Run it before the branch is built, so the branch's own faces are not there to be found."""
    best, bestd = None, tol
    for b in _all_solids():
        try:
            if not b.isVisible:
                continue
            bb = b.boundingBox
            lo, hi = _t(bb.minPoint), _t(bb.maxPoint)
            if any(p[k] < lo[k] - tol or p[k] > hi[k] + tol for k in range(3)):
                continue
            for i in range(b.faces.count):
                f = b.faces.item(i)
                g = f.geometry
                if not _cyl(g):
                    continue
                a = _unit(_t(g.axis))
                w = _sub(p, _t(g.origin))
                t = _dot(w, a)
                radial = _sub(w, tuple(a[k] * t for k in range(3)))
                rho = _norm(radial)
                miss = abs(rho - g.radius)
                if miss >= bestd or rho < 1e-6:
                    continue
                on = tuple(_t(g.origin)[k] + a[k] * t + radial[k] / rho * g.radius for k in range(3))
                okp, prm = f.evaluator.getParameterAtPoint(_P3(on))
                if okp and f.evaluator.isParameterOnFace(prm):
                    best, bestd = f, miss
        except Exception:
            continue
    return _pipe_of_face(best, p) if best is not None else None


def _pipe_from_scan(p, d, R0, notes, scene=None):
    """Fit the main pipe to the keep-out scan round the branch start (a square tee). None when it does not fit."""
    if not _keepouts or not (R0 and R0 > 0):
        return None
    try:
        if scene is None:
            box = 3.0 * R0
            scene = _scene(tuple(p[k] - box for k in range(3)), tuple(p[k] + box for k in range(3)), 1.0, notes)
        _status('Reading the main pipe from the scan…')
        c = tuple(p[k] - d[k] * R0 for k in range(3))
        pts = TPL.scene_points_near(scene, c, 2.2 * R0 + 0.5)
        f = TPL.fit_main_pipe(pts, p, d, R0)
    except ValueError:
        return None
    if not f['ok']:
        notes.append('The main pipe could not be read from the scan at the tee (%s), so the branch end is left '
                     'square: select the main pipe\'s outside face, or model it as a body, to cope it.' % f['why'])
        return None
    note = ('Main pipe read from the scan at the tee: %.2f in across, the scan within %.1f mm of a round pipe over '
            '%.0f deg of the way round.' % (2 * f['R'] / 2.54, 10 * f['rms'], f['cover']))
    if abs(f['off']) > 0.1:
        note += ' The start marker is %.1f mm %s the pipe\'s surface; the coped end fills that.' % (
            10 * abs(f['off']), 'off' if f['off'] > 0 else 'inside')
    notes.append(note)
    return {'p': f['p'], 'd': f['d'], 'R': f['R'], 'R_in': None, 'name': 'the scan', 'how': 'scan', 'fit': f}


def _main_pipe(p, d, data, notes, scene=None):
    """The main pipe under a branch start: a selected round face, else a solid the start sits on, else the scan.
    None when none of them gives one (the branch's end is then left square). Run it before building the branch."""
    for e in _selected():
        try:
            if _kind(e) == 'BRepFace' and _cyl(e.geometry):
                m = _pipe_of_face(e, p)
                if _off_pipe(p, m) <= 0.3:
                    return m
                notes.append('The selected round face (%s) is not where the marker starts (%.1f mm off it), so it '
                             'was not used.' % (m['name'], 10 * _off_pipe(p, m)))
        except Exception:
            continue
    try:
        found = _pipe_under(p)
        if found:
            return found
    except Exception:
        pass
    od = _cm(data, 'main_od_mm')
    try:
        return _pipe_from_scan(p, d, od / 2.0 if od else None, notes, scene)
    except Exception as ex:
        notes.append('The main pipe could not be read from the scan (%s).' % ex)
        return None


def _revolve_section(comp, origin, d, sec, name):
    """A closed (r, z) half-section revolved about the line through origin along d: a sketch and a revolve,
    so it stays editable."""
    d = _unit(d)
    e1, _e2 = RT.perp_basis(d)
    P = lambda r, z: tuple(origin[k] + d[k] * z + e1[k] * r for k in range(3))
    zs = [z for _r, z in sec]
    a0, a1 = P(0.0, min(zs) - 1.0), P(0.0, max(zs) + 1.0)
    plane = _plane_3pt(comp, a0, a1, P(1.0, min(zs)), name)
    sk = comp.sketches.add(plane)
    sk.name = name + ' section'
    S = lambda q: sk.modelToSketchSpace(_P3(q))
    axis = sk.sketchCurves.sketchLines.addByTwoPoints(S(a0), S(a1))
    axis.isConstruction = True
    _poly(sk, [P(r, z) for r, z in sec])
    prof, best = None, 0.0
    for i in range(sk.profiles.count):
        pr = sk.profiles.item(i)
        if pr.profileLoops.count != 1:
            continue
        try:
            a = pr.areaProperties().area
        except Exception:
            a = 1.0
        if a > best:
            prof, best = pr, a
    if prof is None:
        raise RuntimeError('profile')
    rv = comp.features.revolveFeatures
    inp = rv.createInput(prof, axis, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    inp.setAngleExtent(False, adsk.core.ValueInput.createByString('360 deg'))
    f = rv.add(inp)
    f.bodies.item(0).name = name
    return f


WHY_SQUARE = {
    'wider': 'the branch is wider than the main pipe',
    'side': 'the branch leans across the main pipe, so one side of it runs past the main pipe\'s side',
    'along': 'the branch runs along the main pipe',
    'into': 'the marker points into the main pipe (draw it from the outside, pointing away)',
    'steep': 'the branch leaves the main pipe too far off square for one coped piece',
}


def _tee_bodies(comp, main, start, d, od, wall, name, notes):
    """The branch's end coped to the main pipe's outside, and a hidden tool for the hole in the main pipe.
    The coped piece runs from below the start to 20 microns past it (so it stays one solid at the crotch of a
    square tee, where the fishmouth has no height, and the overlap with the tube is too short to stray from a tube
    that starts with a bend); _cope_tube joins it to the tube. Returns (coped piece or None, hole tool or None,
    the cope numbers)."""
    d = _unit(d)
    r_o, r_i = od / 2.0, od / 2.0 - wall
    c = TPL.tee_cope(main, start, d, r_o)
    if not c['full']:
        notes.append('%s: %s, so its end is left square; fit it by hand.' % (name, WHY_SQUARE.get(c['why'], c['why'])))
        return None, None, c
    R = c['R']
    tbm = adsk.fusion.TemporaryBRepManager.get()
    at = lambda s: _P3(tuple(start[k] + d[k] * s for k in range(3)))
    diff = adsk.fusion.BooleanTypes.DifferenceBooleanType
    piece = tbm.createCylinderOrCone(at(-c['stub']), r_o, at(0.002), r_o)
    bore = tbm.createCylinderOrCone(at(-c['stub'] - 0.1), r_i, at(0.1), r_i)
    if piece is None or bore is None or not tbm.booleanOperation(piece, bore, diff):
        raise RuntimeError('the tube piece for the coped end')
    env = _envelope(main, R, start, d, r_o, c['stub'] + c['top'])
    if env is None or not tbm.booleanOperation(piece, env, diff):
        raise RuntimeError('cutting the fishmouth')
    named = [(piece, name + ' coped end')]
    R_in = main.get('R_in') or (R - 1.5 * wall)
    hp = TPL.tee_hole(dict(main, R=R), start, d, r_i, R_in)
    if hp is not None:
        hole = tbm.createCylinderOrCone(at(-hp['bottom']), r_i, at(hp['top']), r_i)
        if hole is not None:
            named.append((hole, name + ' tee hole (cut tool)'))
    if len(named) == 1:
        notes.append('%s: no tool for the hole was made; cut it to the branch\'s bore by hand.' % name)
    bodies = _add_bodies(comp, named)
    piece_b = bodies[0] if bodies else None
    hole_b = bodies[1] if len(bodies) > 1 else None
    if hole_b is not None:
        try:
            hole_b.isLightBulbOn = False
        except Exception:
            pass
    return piece_b, hole_b, c


def _envelope(main, R, start, d, r_o, reach):
    """The main pipe's outside round the tee as a solid temporary cylinder (radius R), long enough to cover the
    branch's footprint however far off square it leaves."""
    tbm = adsk.fusion.TemporaryBRepManager.get()
    a = _unit(main['d'])
    q = tuple(main['p'][k] + a[k] * _dot(_sub(start, main['p']), a) for k in range(3))
    sin_ = max(0.2, _norm(_cross(a, d)))
    half = (r_o + reach) / sin_ + 1.0
    return tbm.createCylinderOrCone(_P3(tuple(q[k] - a[k] * half for k in range(3))), R,
                                    _P3(tuple(q[k] + a[k] * half for k in range(3))), R)


def _join(comp, target, tools):
    coll = adsk.core.ObjectCollection.create()
    for t in tools:
        coll.add(t)
    ci = comp.features.combineFeatures.createInput(target, coll)
    ci.operation = adsk.fusion.FeatureOperations.JoinFeatureOperation
    ci.isKeepToolBodies = False
    return comp.features.combineFeatures.add(ci)


def _cope_tube(comp, tube, piece, main, c, start, d, od, notes, name):
    """Join the coped piece to the tube; for a branch off square, also cut the tube's first part, which runs
    inside the main pipe, to the main pipe's outside. Returns True when the tube is one coped body."""
    if tube is None:
        notes.append('%s: the coped end is its own body (the tube was not found to join it to).' % name)
        return False
    try:
        _join(comp, tube, [piece])
    except Exception as ex:
        notes.append('%s: the coped end could not be joined to the tube (%s), so it is its own body.' % (name, ex))
        return False
    if c['top'] > 1e-4:
        try:
            env = _envelope(main, c['R'], start, d, od / 2.0, c['stub'] + c['top'])
            tool = _add_bodies(comp, [(env, name + ' main pipe outside (cut tool)')])[0]
            coll = adsk.core.ObjectCollection.create()
            coll.add(tool)
            ci = comp.features.combineFeatures.createInput(tube, coll)
            ci.operation = adsk.fusion.FeatureOperations.CutFeatureOperation
            ci.isKeepToolBodies = False
            comp.features.combineFeatures.add(ci)
        except Exception as ex:
            notes.append('%s leaves the main pipe %.0f deg off square, so its first %.1f mm run inside the main pipe, '
                         'and cutting them away failed (%s): trim the tube to the main pipe by hand.' % (
                             name, math.degrees(math.acos(max(-1.0, min(1.0, TPL._radial_cos(main, start, d))))),
                             10 * c['top'], ex))
            return False
    return True


def _tee_note(name, main, c, length=None, start=None, d=None, hole=True, joined=True):
    how = {'face': 'the face of %s' % main['name'], 'scan': 'the scan'}.get(main['how'], main['name'])
    s = ('%s is coped to the main pipe (%.2f in across, from %s): the fishmouth reaches %.2f in below the centreline '
         'at its sides' % (name, 2 * c['R'] / 2.54, how, c['depth'] / 2.54))
    if length:
        s += ', so cut the tube %.2f in long at its longest side' % ((length + c['depth']) / 2.54)
    if c['trim'] > 0:
        s += (' (the last %.1f mm of its tips is left off, where a branch the size of the main pipe meets it '
              'tangentially; finish them by hand)' % (10 * c['trim']))
    if c['top'] > 1e-4 and start is not None and d is not None:
        off = math.degrees(math.acos(max(-1.0, min(1.0, TPL._radial_cos(main, start, d)))))
        s += ('. It leaves the main pipe %.1f deg off square, so the tube\'s first %.1f mm, which ran inside the main '
              'pipe, were cut to it as well' % (off, 10 * c['top']))
    s += '. The coped end is a fixed piece cut from the main pipe\'s shape'
    s += (', joined to the tube: if you change the tube size, build it again.' if joined else
          '; it is its own body (see the message).')
    if hole:
        s += (' The hole is the hidden body "%s tee hole (cut tool)": Combine > Cut the main pipe with it, Keep Tools '
              'off.' % name)
    return s


def _cap_end(comp, end, d, od, t, name):
    """A flat plate cap on a tube end: its inside face on the end, so the tube's inside length is unchanged."""
    return _revolve_section(comp, end, d, [(0.0, 0.0), (od / 2.0, 0.0), (od / 2.0, t), (0.0, t)], name)


def _comp_frame(comp, ent=None):
    """World to component coordinates for comp, as a row-major 4x4 list, or None when they are the same (the root,
    or a component whose occurrence sits at the origin). Sketch points and temporary bodies added to a component
    are placed in its own coordinates, while selections and the scan are read in world coordinates."""
    try:
        occ = None
        try:
            occ = ent.assemblyContext if ent is not None else None   # the occurrence the selection was made through
        except Exception:
            occ = None
        if occ is None:
            root = _design().rootComponent
            if comp == root:
                return None
            occs = root.allOccurrencesByComponent(comp)
            if occs.count == 0:
                return None
            occ = occs.item(0)
        try:
            m = occ.transform2.copy()
        except Exception:
            m = occ.transform.copy()
        if not m.invert():
            return None
        a = list(m.asArray())
        if all(abs(a[i] - (1.0 if i in (0, 5, 10, 15) else 0.0)) < 1e-12 for i in range(16)):
            return None
        return a
    except Exception:
        return None


def _xp(a, p):
    return tuple(a[4 * r] * p[0] + a[4 * r + 1] * p[1] + a[4 * r + 2] * p[2] + a[4 * r + 3] for r in range(3))


def _xd(a, v):
    return tuple(a[4 * r] * v[0] + a[4 * r + 1] * v[1] + a[4 * r + 2] * v[2] for r in range(3))


def _ends_in(ends, a):
    """A J-pipe's ends (and its main pipe) moved into a component's coordinates."""
    out = dict(ends)
    for k in ('tee', 'cap'):
        out[k] = _xp(a, ends[k])
        out[k + '_d'] = _xd(a, ends[k + '_d'])
    if ends.get('main'):
        m = dict(ends['main'])
        m['p'], m['d'] = _xp(a, m['p']), _xd(a, m['d'])
        out['main'] = m
    return out


def _off_pipe(p, m):
    a = _unit(m['d'])
    w = _sub(p, m['p'])
    t = _dot(w, a)
    return abs(_norm(_sub(w, tuple(a[k] * t for k in range(3)))) - m['R'])


def _jpipe_ends(segs, data, od, notes):
    """Which end of a sketched J-pipe tees into the main pipe: the end on a selected round face, else the end on a
    solid, else the end nearer the scan. The other end gets the cap. Directions point away from the main pipe at
    the tee and out of the tube at the cap."""
    a_p, a_d = segs[0]['p0'], _unit(segs[0]['t0'])
    b_p, b_d = segs[-1]['p1'], _unit(segs[-1]['t1'])
    keep = {'tee': a_p, 'tee_d': a_d, 'cap': b_p, 'cap_d': b_d, 'main': None, 'note': ''}
    flip = {'tee': b_p, 'tee_d': _neg(b_d), 'cap': a_p, 'cap_d': _neg(a_d), 'main': None, 'note': ''}
    sel = []
    for e in _selected():
        try:
            if _kind(e) == 'BRepFace' and _cyl(e.geometry):
                sel.append(e)
        except Exception:
            pass
    if sel:
        m = _pipe_of_face(sel[0])
        ch = keep if _off_pipe(a_p, m) <= _off_pipe(b_p, m) else flip
        ch['main'] = m
        return ch
    for ch in (keep, flip):
        try:
            m = _pipe_under(ch['tee'])
        except Exception:
            m = None
        if m:
            ch['main'] = m
            return ch
    od_main = _cm(data, 'main_od_mm')
    if data.get('tee') and _keepouts and od_main:
        R0 = od_main / 2.0
        try:
            lo = tuple(min(a_p[k], b_p[k]) - 3 * R0 for k in range(3))
            hi = tuple(max(a_p[k], b_p[k]) + 3 * R0 for k in range(3))
            scene = _scene(lo, hi, 1.0, notes)
            ch = keep if scene.dist_exact(a_p, 12.0) <= scene.dist_exact(b_p, 12.0) else flip
            ch['main'] = _pipe_from_scan(ch['tee'], ch['tee_d'], R0, notes, scene)
            if ch['main'] is None:
                ch['note'] = 'The end nearer the scan was taken as the tee end.'
            return ch
        except Exception as ex:
            notes.append('The scan could not be read at the J-pipe\'s ends (%s).' % ex)
    if data.get('tee'):
        keep['note'] = ('The cap went on the end the path finishes at. If that is the tee end, select the main '
                        'pipe\'s outside face with the path and build it again.')
    return keep


def _jpipe_fittings(comp, data, tube, main, start, d_start, end, d_end, od, wall, length, notes):
    """Cap the far end and cope the tee end of a built J-pipe (main: the main pipe found before the tube was
    built, or None). Returns a note for the J-pipe's row."""
    name = str(data.get('title') or 'J-pipe')
    parts = []
    if data.get('cap'):
        t = _cm(data, 'cap_mm') or max(wall, 0.15)
        try:
            _cap_end(comp, end, d_end, od, t, name + ' cap')
            parts.append('Capped the far end with a %.3f in plate; the inside length to the cap is the cut length.' % (t / 2.54))
        except Exception as ex:
            notes.append('The cap could not be built (%s); weld a cap on the far end.' % ex)
    if data.get('tee'):
        if main is None:
            parts.append('No main pipe found at the tee end, so it is left square: select the main pipe\'s outside '
                         'face (Ctrl+click) with the markers, or set the scan as a keep-out, to cope it.')
        else:
            try:
                piece, hole, c = _tee_bodies(comp, main, start, d_start, od, wall, name, notes)
                if piece is not None:
                    joined = _cope_tube(comp, tube, piece, main, c, start, d_start, od, notes, name)
                    parts.append(_tee_note(name, main, c, length, start, d_start, hole is not None, joined))
                else:
                    parts.append('The tee end is left square: %s.' % WHY_SQUARE.get(c['why'], c['why']))
            except Exception as ex:
                notes.append('The tee could not be built (%s); the tee end is left square.' % ex)
    return ' '.join(parts)


def act_helmholtz(data):
    """A Helmholtz can on a straight neck from one marker on the main pipe: a sketch line drawn from the main pipe's
    outside where the neck tees in, out the way the neck goes. The can's axis follows the neck. Sizes come from the
    Mufflers tab: the neck (inside diameter, length from the main pipe's outside to its open end, wall), the can's
    inside diameter and the gas volume; the can's inside length is set so the gas round the neck is that volume."""
    t0 = time.time()
    mk = [m for m in _markers() if m['signed']]
    if len(mk) != 1:
        raise ValueError('Select one sketch line, drawn on the main pipe\'s outside where the neck tees in and '
                         'pointing out the way the neck goes. Ctrl+click the main pipe\'s outside face too if it is a body.')
    start, d = mk[0]['p'], _unit(mk[0]['d'])
    neck_id, wall, neck_len = _cm(data, 'neck_id_mm', 0.0), _cm(data, 'wall_mm', 0.0), _cm(data, 'neck_len_mm', 0.0)
    can_id, cw, nin = _cm(data, 'can_id_mm', 0.0), _cm(data, 'can_wall_mm', 0.1519), _cm(data, 'neck_into_mm', 0.0)
    vol = float(data.get('vol_cm3') or 0.0)
    lay = TPL.helm_can(neck_id, wall, neck_len, can_id, vol, cw, nin)
    title = str(data.get('title') or 'Helmholtz can')
    notes = []
    scene = None
    if _keepouts:
        reach = lay['z1'] + lay['R_out'] + 3.0
        try:
            scene = _scene(tuple(start[k] - reach for k in range(3)), tuple(start[k] + reach for k in range(3)), 1.0, notes)
        except ValueError:
            scene = None
    main = _main_pipe(start, d, data, notes, scene)
    if main is not None and TPL._radial_cos(main, start, d) < 0.15:
        raise ValueError('The marker points into the main pipe (or along its surface). Draw it from the main pipe\'s '
                         'outside, pointing away from the pipe the way the neck goes.')
    _status('Building the can…')
    comp = _new_component(title)
    try:
        neck_f = _revolve_section(comp, start, d, lay['neck'], title + ' neck')
        _revolve_section(comp, start, d, lay['section'], title)
    except Exception as ex:
        _drop_component(comp)
        raise ValueError('Fusion would not build the can (%s). Nothing was left in the design.' % ex)
    neck_note = ''
    if main is None:
        neck_note = ('No main pipe found at the marker, so the neck\'s end is left square: select the main pipe\'s '
                     'outside face (Ctrl+click) with the marker, or set the scan as a keep-out, to cope it.')
    else:
        try:
            piece, hole, c = _tee_bodies(comp, main, start, d, 2 * lay['r_hole'], wall, title + ' neck', notes)
            if piece is not None:
                joined = _cope_tube(comp, neck_f.bodies.item(0), piece, main, c, start, d, 2 * lay['r_hole'], notes, title + ' neck')
                neck_note = _tee_note(title + ' neck', main, c, neck_len, start, d, hole is not None, joined)
            else:
                neck_note = 'The neck\'s end is left square: %s.' % WHY_SQUARE.get(c['why'], c['why'])
        except Exception as ex:
            notes.append('The tee could not be built (%s); the neck\'s end is left square.' % ex)
    gap, gap_over, ok_gap = None, False, True
    if scene is not None:
        _status('Checking the can against the keep-outs…')
        pts, err = TPL.helm_samples(start, d, lay, step=0.3, neck=False)     # the can; the neck rises from the main pipe
        gap, _at = TPL.clearance(scene, pts, err)
        if gap is None:
            gap, gap_over = 12.0, True
        ok_gap = gap_over or gap >= float(data.get('gap_cm', 1.27))
    can_note = ('Inside %.2f in across and %.2f in long, %.2f L of gas round the neck (target %.2f L); %.2f in long '
                'outside with %.3f in wall and end plates. Its near end sits %.2f in above the main pipe.' % (
                    can_id / 2.54, lay['L_in'] / 2.54, lay['gas'] / 1000.0, vol / 1000.0, lay['outside_len'] / 2.54,
                    cw / 2.54, lay['gap'] / 2.54))
    if lay['grow'] > 1e-6:
        can_note += ' The neck runs %.2f in into the can, so the can is %.2f in longer than for a flush neck.' % (nin / 2.54, lay['grow'] / 2.54)
    items = [{'kind': 'part', 'name': title, 'ok': ok_gap, 'note': can_note,
              'helm': {'gas_cm3': lay['gas'], 'neck_id_cm': neck_id, 'neck_len_cm': neck_len, 'can_id_cm': can_id,
                       'can_len_cm': lay['L_in']}},
             {'kind': 'neck', 'name': title + ' neck', 'length': neck_len, 'note': neck_note}]
    if gap is not None:
        items[0]['min_gap'] = gap
        items[0]['gap_over'] = gap_over
    msg = 'Built the Helmholtz can on its neck in a new component, the can along the neck.'
    if scene is None and not _keepouts:
        msg += ' Set the scan as a keep-out to check the can\'s clearance.'
    msg += ' %.0f s.' % (time.time() - t0)
    if notes:
        msg += ' ' + ' '.join(notes)
    msg += (' The can and the neck are sketch-driven revolves (edit their section sketches); the coped end and the hole '
            'tool are fixed bodies, cut from the main pipe\'s shape.')
    return {'ok': True, 'msg': msg, 'items': items, 'route_ok': ok_gap}


def _up_vector():
    try:
        return (0.0, 0.0, 1.0) if _z_up() else (0.0, 1.0, 0.0)
    except Exception:
        return (0.0, 0.0, 1.0)


def _mesh_gap(tube, mesh_body):
    """Smallest gap from a solid tube to a scan mesh, never over-stated."""
    tc, ti, ttol, _n = _keepout_mesh(tube, 0.01)
    bb = _bbox_of(tc)
    if bb is None:
        return 0.0
    sc = RT.Scene(cell=1.0, sample_len=0.3)
    coords, idx, tol, _note2 = _keepout_mesh(mesh_body)
    sc.add_mesh(coords, idx, tol)
    sc.build(bb[0], bb[1], 12.0)
    tube_sc = RT.Scene(cell=1.0, sample_len=0.3)
    tube_sc.add_mesh(tc, ti, ttol)
    tube_sc.build(bb[0], bb[1], 0.5)
    best, _at = sc.nearest(tube_sc.all_points(), 12.0)
    return max(0.0, best - tube_sc.e_cover)


def _note(kind):
    def act(data):
        PAGE_NOTES.append({'kind': kind, 'data': data})
        del PAGE_NOTES[:-20]
        return {'ok': True}
    return act


def act_save_text(data):
    """Save text the page made (an Engine Simulator engine file) where the user picks."""
    text, name = data.get('text'), str(data.get('filename') or 'engine.mr')
    if not isinstance(text, str) or not text:
        return {'ok': False, 'msg': 'Nothing to save.'}
    ui = _ui or adsk.core.Application.get().userInterface
    dlg = ui.createFileDialog()
    dlg.isMultiSelectEnabled = False
    dlg.title = data.get('title') or 'Save file'
    ext = os.path.splitext(name)[1].lower() or '.txt'
    label = 'Engine Simulator script' if ext == '.mr' else 'File'
    dlg.filter = '%s (*%s);;All files (*.*)' % (label, ext)
    dlg.initialFilename = name
    if dlg.showSave() != adsk.core.DialogResults.DialogOK:
        return {'ok': False, 'msg': 'Not saved.'}
    path = dlg.filename
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    return {'ok': True, 'msg': 'Saved ' + path, 'path': path}


def act_save_base64(data):
    """Save one binary file the page made (a WAV of the estimated sound), sent as base64, where the user picks."""
    import base64
    name = os.path.basename(str(data.get('filename') or 'file.bin'))
    try:
        raw = base64.b64decode(data.get('b64') or '', validate=True)
    except Exception:
        return {'ok': False, 'msg': 'The file could not be read.'}
    if not raw:
        return {'ok': False, 'msg': 'Nothing to save.'}
    ui = _ui or adsk.core.Application.get().userInterface
    dlg = ui.createFileDialog()
    dlg.title = data.get('title') or 'Save file'
    ext = os.path.splitext(name)[1].lower() or '.bin'
    dlg.filter = '%s (*%s);;All files (*.*)' % ('Sound' if ext == '.wav' else 'File', ext)
    dlg.initialFilename = name
    if dlg.showSave() != adsk.core.DialogResults.DialogOK:
        return {'ok': False, 'msg': 'Not saved.'}
    with open(dlg.filename, 'wb') as f:
        f.write(raw)
    return {'ok': True, 'msg': 'Saved ' + dlg.filename, 'path': dlg.filename}


def act_save_files(data):
    """Save several text files the page made (an OpenWAM case: .wam inputs, run_all.bat, README) into a folder the user picks."""
    files = data.get('files') or []
    files = [f for f in files if isinstance(f, dict) and isinstance(f.get('text'), str) and f.get('name')]
    if not files:
        return {'ok': False, 'msg': 'Nothing to save.'}
    ui = _ui or adsk.core.Application.get().userInterface
    dlg = ui.createFolderDialog()
    dlg.title = data.get('title') or 'Choose a folder'
    if dlg.showDialog() != adsk.core.DialogResults.DialogOK:
        return {'ok': False, 'msg': 'Not saved.'}
    folder = dlg.folder
    written = []
    for f in files:
        # names may carry a sub-path (a CFD case folder: name/system/controlDict); keep it under the chosen folder
        parts = [q for q in str(f['name']).replace('\\', '/').split('/') if q and q not in ('.', '..')]
        if not parts:
            continue
        name = '/'.join(parts)
        path = os.path.join(folder, *parts)
        if len(parts) > 1 and not os.path.isdir(os.path.dirname(path)):
            os.makedirs(os.path.dirname(path))
        nl = '\r\n' if name.lower().endswith(('.bat', '.txt', '.wam')) else '\n'
        with open(path, 'w', encoding='utf-8', newline='') as fh:
            fh.write(f['text'].replace('\r\n', '\n').replace('\n', nl))
        if f.get('exec'):
            try:
                os.chmod(path, 0o755)
            except Exception:
                pass
        written.append(name)
    how = 'Double-click run_all.bat there to run OpenWAM.' if any(n.lower().endswith('.bat') for n in written) else \
        ('Run ./Allrun in that folder on a machine with OpenFOAM.' if any(n.endswith('Allrun') for n in written) else '')
    return {'ok': True, 'msg': ('Saved %d files in %s (%s). ' % (len(written), folder, ', '.join(written[:4]) + ('…' if len(written) > 4 else ''))) + how,
            'path': folder, 'files': written}


def stl_ascii(regions, scale=10.0):
    """One ASCII STL with a 'solid NAME' block per region, the form intake_cfd.py reads (exhaust mode: inlet or
    inlet1..N, outlet, anything else is wall). regions: [(name, [(p0, p1, p2), ...])] with points in Fusion's
    centimetres; scale 10 writes millimetres. Facet normals follow the vertex order (right-hand rule);
    zero-area triangles are left out. Returns (text, triangles written)."""
    out, n = [], 0
    for name, tris in regions:
        out.append('solid %s' % name)
        for a, b, c in tris:
            ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
            vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
            nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
            ln = math.sqrt(nx * nx + ny * ny + nz * nz)
            if ln <= 1e-18:
                continue
            out.append('  facet normal %.6e %.6e %.6e' % (nx / ln, ny / ln, nz / ln))
            out.append('    outer loop')
            for q in (a, b, c):
                out.append('      vertex %.6f %.6f %.6f' % (q[0] * scale, q[1] * scale, q[2] * scale))
            out.append('    endloop')
            out.append('  endfacet')
            n += 1
        out.append('endsolid %s' % name)
    return '\n'.join(out) + '\n', n


def _face_triangles(face, tol_cm):
    """Fusion's own triangulation of one face (a proxy face gives assembly coordinates), in cm."""
    calc = face.meshManager.createMeshCalculator()
    calc.setQuality(adsk.fusion.TriangleMeshQualityOptions.HighQualityTriangleMesh)
    try:
        calc.surfaceTolerance = tol_cm
    except Exception:
        pass
    mesh = calc.calculate()
    xyz = list(mesh.nodeCoordinatesAsDouble)
    idx = list(mesh.nodeIndices)
    pts = [(xyz[3 * i], xyz[3 * i + 1], xyz[3 * i + 2]) for i in range(len(xyz) // 3)]
    return [(pts[idx[3 * k]], pts[idx[3 * k + 1]], pts[idx[3 * k + 2]]) for k in range(len(idx) // 3)]


def act_export_cfd_stl(data, path=None):
    """The exhaust CFD case's STL from the model: the user selects the gas-space body's openings in order (the
    roles the page sends, e.g. inlet1..inlet4 then outlet) and this writes every face of that body, each
    selected face under its role and all others as wall, as one ASCII STL in millimetres."""
    roles = [str(r) for r in (data.get('roles') or [])]
    if not roles or roles[-1] != 'outlet':
        return {'ok': False, 'msg': 'The page sent no face roles.'}
    faces = [e for e in _selected() if _kind(e) == 'BRepFace']
    if len(faces) != len(roles):
        raise ValueError('Select the %d openings of the gas-space body in this order (Ctrl+click): %s. Selected now: %d face%s.'
                         % (len(roles), ', '.join(roles), len(faces), '' if len(faces) == 1 else 's'))
    body = faces[0].body
    if any(f.body.entityToken != body.entityToken for f in faces):
        raise ValueError('All the openings must be faces of the same body (the gas space inside the part).')
    if not body.isSolid:
        raise ValueError('%s is not a closed solid. Model the gas space as one solid body with every opening capped by a flat face.' % body.name)
    for r, f in zip(roles, faces):
        if f.geometry.surfaceType != adsk.core.SurfaceTypes.PlaneSurfaceType:
            raise ValueError('The face picked as %s is not flat. Each opening must be a flat cap across the pipe end.' % r)
    tol = float(data.get('tolerance_mm') or 0.05) / 10.0
    picked = {}
    for r, f in zip(roles, faces):
        picked[f.tempId] = r
    regions = {r: [] for r in roles}
    regions['wall'] = []
    for i in range(body.faces.count):
        f = body.faces.item(i)
        regions[picked.get(f.tempId, 'wall')].extend(_face_triangles(f, tol))
    text, ntri = stl_ascii([(r, regions[r]) for r in roles + ['wall']])
    # path: only for a direct Python call (tests/fusion_live_cfd_stl.py); the palette goes through ACTIONS with one
    # argument, so the page always gets the save dialog
    if not path:
        ui = _ui or adsk.core.Application.get().userInterface
        dlg = ui.createFileDialog()
        dlg.isMultiSelectEnabled = False
        dlg.title = data.get('title') or 'Save the STL next to design.json'
        dlg.filter = 'STL (*.stl);;All files (*.*)'
        dlg.initialFilename = str(data.get('filename') or 'part.stl')
        if dlg.showSave() != adsk.core.DialogResults.DialogOK:
            return {'ok': False, 'msg': 'Not saved.'}
        path = dlg.filename
    with open(path, 'w', encoding='ascii', newline='\n') as fh:
        fh.write(text)
    counts = ', '.join('%s %d' % (r, len(regions[r])) for r in roles + ['wall'])
    return {'ok': True, 'path': path, 'triangles': ntri,
            'msg': 'Saved %s: %d triangles (%s), millimetres. Put it in the case folder next to design.json.' % (path, ntri, counts)}


# --------------------------------------------------------------------------
# Tack jig: printable cradles under the routed tubes (jig.py plans them)
# --------------------------------------------------------------------------

def _jig_tubes(data):
    """Selected centreline sketches or edges (with the page's tube OD), else the tubes the last auto-route built."""
    od = _cm(data, 'od_mm')
    tubes, seen = [], set()
    for e in _selected():
        if _kind(e) not in ('sketch', 'BRepEdge'):
            continue
        segs = _path_segs(_path_for(e))
        key = path_signature(segs)
        if key in seen:
            continue
        seen.add(key)
        if not od:
            raise ValueError('Fill in the tube size on this tab first: the jig is cut to the tube outside diameter.')
        tubes.append({'name': '%s %d' % (_name(e), len(tubes) + 1), 'elems': JIG.segs_to_elems(segs), 'od': od})
    if tubes:
        return tubes, 'the selected centrelines'
    if _LAST_TUBES:
        return list(_LAST_TUBES), 'the tubes the last auto-route built'
    raise ValueError('Select the tube centrelines (sketch lines and arcs, or edges), or auto-route the tubes first.')


def jig_body(tbm, c):
    """One cradle as a temporary body: the block and its foot, the saddles cut by every tube through it (short
    cylinders along the centreline with a ball at each joint, so an arc is followed without slivers), two bolt holes."""
    P, V = (lambda p: adsk.core.Point3D.create(*p)), (lambda v: adsk.core.Vector3D.create(*v))
    OBB = adsk.core.OrientedBoundingBox3D.create
    B = adsk.fusion.BooleanTypes
    blk = tbm.createBox(OBB(P(c['centre']), V(c['d']), V(c['w']), c['length'], c['width'], c['height']))
    f = c['foot']
    tbm.booleanOperation(blk, tbm.createBox(OBB(P(f['centre']), V(c['d']), V(c['w']), c['length'], f['width'], f['thick'])),
                         B.UnionBooleanType)
    joints = set()
    def cut(make):
        # a cut whose faces nearly meet the block's (seen live: ASM_BAD_CONTAINMENT on a two-stage header) is tried
        # again 0.03 mm larger and 0.1 mm longer at each end, well inside the 0.25 mm clearance; still failing, skipped
        for grow in (0.0, 0.003):
            try:
                tbm.booleanOperation(blk, make(grow), B.DifferenceBooleanType)
                return
            except RuntimeError:
                pass
        c['skipped_cuts'] = c.get('skipped_cuts', 0) + 1
    def ext(a, b, e):
        d = _unit(_sub(b, a))
        return tuple(a[k] - d[k] * e for k in range(3)), tuple(b[k] + d[k] * e for k in range(3))
    for a, b, r in c['cut']:
        cut(lambda g, a=a, b=b, r=r: (lambda q: tbm.createCylinderOrCone(P(q[0]), r + g, P(q[1]), r + g))(ext(a, b, 10 * g / 3) if g else (a, b)))
        for q in (a, b):
            k = tuple(round(x, 5) for x in q) + (round(r, 5),)
            if k not in joints:
                joints.add(k)
                if hasattr(tbm, 'createSphere'):
                    cut(lambda g, q=q, r=r: tbm.createSphere(P(q), r + g))
    up, h = c['up'], f['thick'] + 0.2
    for q in f['holes']:
        a = tuple(q[k] - up[k] * h for k in range(3))
        b = tuple(q[k] + up[k] * h for k in range(3))
        tbm.booleanOperation(blk, tbm.createCylinderOrCone(P(a), f['hole_d'] / 2.0, P(b), f['hole_d'] / 2.0),
                             B.DifferenceBooleanType)
    return blk


def fab_body(tbm, part):
    """One planned jig part (jig.plan_fab) as a temporary body: its boxes joined, then the tube saddles cut (short
    cylinders and joint balls, retried a hair larger where faces nearly meet), the flange bores and bolt circles, and
    the bolt holes through the base."""
    P, V = (lambda p: adsk.core.Point3D.create(*p)), (lambda v: adsk.core.Vector3D.create(*v))
    OBB = adsk.core.OrientedBoundingBox3D.create
    B = adsk.fusion.BooleanTypes

    def make(q, g=0.0):
        if q['k'] == 'box':
            return tbm.createBox(OBB(P(q['c']), V(q['d']), V(q['w']), q['L'], q['W'], q['H']))
        if q['k'] == 'sph':
            return tbm.createSphere(P(q['p']), q['r'] + g)
        a, b = q['a'], q['b']
        if g:
            d = _unit(_sub(b, a))
            e = 10 * g / 3
            a = tuple(a[k] - d[k] * e for k in range(3))
            b = tuple(b[k] + d[k] * e for k in range(3))
        return tbm.createCylinderOrCone(P(a), q['r'] + g, P(b), q['r'] + g)
    body = None
    for q in part['add']:
        if body is None:
            body = make(q)
        else:
            tbm.booleanOperation(body, make(q), B.UnionBooleanType)
    skipped = 0
    for q in part['cut'] + part.get('hole_cuts', []):
        if q['k'] == 'sph' and not hasattr(tbm, 'createSphere'):
            continue
        for g in ((0.0, 0.003) if q.get('soft') else (0.0,)):
            try:
                tbm.booleanOperation(body, make(q, g), B.DifferenceBooleanType)
                break
            except RuntimeError:
                continue
        else:
            skipped += 1
    part['skipped_cuts'] = skipped
    return body


def _jig_opts(data):
    """The page's Fabrication jig options (mm and degrees) for jig.plan_fab (cm)."""
    j = data.get('jig') or {}
    mm = lambda k: (float(j[k]) / 10.0) if j.get(k) not in (None, '') else None
    o = {'style': j.get('style') or 'cradles', 'layout': j.get('layout') or 'model', 'mount': j.get('mount') or 'free',
         'spacing': _cm(data, 'spacing_mm') or mm('spacing_mm'), 'block_len': _cm(data, 'block_mm') or mm('block_mm'),
         'max_height': _cm(data, 'max_height_mm'), 'weld_gap': mm('weld_gap_mm'), 'bed': mm('bed_mm'),
         'clearance': mm('clearance_mm'), 'grid_pitch': mm('grid_pitch_mm'), 'grid_hole': mm('grid_hole_mm'),
         'flange_ends': j.get('flange_ends') or 'none', 'flange_size': mm('flange_size_mm'),
         'flange_thick': mm('flange_thick_mm'), 'flange_pcd': mm('flange_pcd_mm'), 'flange_hole': mm('flange_hole_mm'),
         'flange_n': int(j['flange_n']) if j.get('flange_n') not in (None, '') else None,
         'flange_angle_deg': float(j['flange_angle_deg']) if j.get('flange_angle_deg') not in (None, '') else None,
         'grid_angle_deg': float(j['grid_angle_deg']) if j.get('grid_angle_deg') not in (None, '') else None,
         'free_holes': bool(j['free_holes']) if 'free_holes' in j else None}
    o['gussets'] = j.get('gussets') or None
    o['table_feet'] = j.get('table_feet') or None
    o['flange_shape'] = j.get('flange_shape') or None
    o['flange_w'], o['flange_h'], o['flange_bore'] = mm('flange_w_mm'), mm('flange_h_mm'), mm('flange_bore_mm')
    hl = j.get('flange_holes')
    if hl:
        o['flange_holes'] = [tuple(float(x) / 10.0 if k != 4 else float(x) for k, x in enumerate(h)) for h in hl]
    sd = j.get('flange_seat')
    if sd and sd.get('kind') in ('pocket', 'boss') and float(sd.get('d_mm') or 0) > 0:
        o['flange_seat'] = {'kind': sd['kind'], 'd': float(sd['d_mm']) / 10.0, 'depth': float(sd.get('depth_mm') or 0) / 10.0}
    sg = j.get('flange_spigot')
    if sg and float(sg.get('d_mm') or 0) > 0 and float(sg.get('len_mm') or 0) > 0:
        o['flange_spigot'] = {'d': float(sg['d_mm']) / 10.0, 'len': float(sg['len_mm']) / 10.0}
    if j.get('grid_x_mm') not in (None, '') or j.get('grid_y_mm') not in (None, ''):
        o['grid_origin'] = (float(j.get('grid_x_mm') or 0) / 10.0, float(j.get('grid_y_mm') or 0) / 10.0)
    return o


def act_jig(data):
    tubes, src = _jig_tubes(data)
    z_up = _z_up()
    o = _jig_opts(data)
    plan = JIG.plan_fab(tubes, (0.0, 0.0, 1.0) if z_up else (0.0, 1.0, 0.0), o)
    if not plan['parts']:
        raise ValueError('No place along these tubes is level enough for a jig. ' + ' '.join(plan['notes']))
    tbm = adsk.fusion.TemporaryBRepManager.get()         # before the component (see new_component)
    style = plan['opts']['style']
    comp = _new_component(str(data.get('title') or 'Fabrication jig'))
    named = [(fab_body(tbm, q), q['name']) for q in plan['parts']]
    bodies = _add_bodies(comp, named)
    sm = JIG.fab_summary(plan)
    split = [b.name for b in bodies if getattr(getattr(b, 'lumps', None), 'count', 1) > 1]
    if split:
        plan['notes'].append('%s came out in more than one piece (a tube cuts through it): move or delete %s.' % (
            ', '.join(split), 'it' if len(split) == 1 else 'them'))
    rough = [q['name'] for q in plan['parts'] if q.get('skipped_cuts')]
    if rough:
        plan['notes'].append('Fusion could not cut part of the saddle in %s (faces too nearly touching): check it there '
                             'before printing.' % ', '.join(rough))
    what = {'cradles': 'separate cradles', 'base': 'cradles on one base frame', 'plate': 'a plate with cradles along the tubes',
            'saddle': 'continuous saddles', 'frame': 'a flange frame'}[style]
    kinds = ', '.join('%d %s' % (v, {'cradle': 'cradle', 'base': 'base frame', 'plate': 'plate', 'saddle': 'saddle piece', 'flange': 'flange locator', 'frame': 'flange frame'}[k] + ('s' if v > 1 else ''))
                      for k, v in sm['kinds'].items())
    mount = ('bolted to the fixture table through %d holes on its grid' % sm['holes']) if plan['opts']['mount'] == 'table' else \
        ('free-standing' + (', with M6 holes to screw down if you want' if sm['holes'] else ''))
    msg = ('Built a fabrication jig for %s: %s (%s), %s. Every part stands on one level %.0f mm under the lowest tube, its '
           'saddles open at the top so the pieces drop in; the tallest is %.0f mm. Print them, set them down, lay the cut '
           'pieces in and tack.' % (src, kinds, what, mount, 10 * plan['opts']['min_below'], 10 * sm['tallest']))
    if plan['notes']:
        msg += ' ' + ' '.join(plan['notes'])
    return {'ok': True, 'msg': msg, 'jig': {'count': sm['count'], 'kinds': sm['kinds'], 'holes': sm['holes'],
                                             'tallest_mm': 10 * sm['tallest'], 'style': style, 'mount': plan['opts']['mount'],
                                             'parts': [{'name': q['name'], 'size_mm': [round(10 * x, 1) for x in q['size']],
                                                        'holes': len(q['holes'])} for q in plan['parts']],
                                             'skipped': [{'tube': k['tube'], 's_mm': 10 * k['s'], 'why': k['why']} for k in plan['skipped']]}}


# --------------------------------------------------------------------------
# Hangers and brackets: the page's flat parts (Hangers tab) put on the tube where the user clicked (hangers.py)
# --------------------------------------------------------------------------

def _hang_frame(data):
    """The tube frame from the selection: the pipe's outside face clicked where the hanger goes (or a straight
    centreline: a sketch line or linear edge), and optionally a second pick on the body where it mounts."""
    sels = _ui.activeSelections
    picks = [(sels.item(i).entity, sels.item(i).point) for i in range(sels.count)]
    if not picks:
        raise ValueError('Click the pipe’s outside face where the hanger goes (Ctrl+click a mount point on the body too, if you want the reach measured).')
    ent, click = picks[0]
    click = _t(click) if click is not None else None
    k, od = _kind(ent), None
    if k == 'BRepFace':
        if click is None:            # selected in code, not clicked: a point on the face stands in
            click = _t(ent.pointOnFace)
        g = ent.geometry
        if g.surfaceType != adsk.core.SurfaceTypes.CylinderSurfaceType:
            raise ValueError('That face is not a straight piece of tube: click a cylindrical face (bends are not supported yet).')
        ap, ad, od = _t(g.origin), _t(g.axis), 2.0 * g.radius
    elif k in ('sketch', 'BRepEdge'):
        geo = _world_geometry(ent)
        if geo.curveType != adsk.core.Curve3DTypes.Line3DCurveType:
            raise ValueError('Pick a straight centreline (a sketch line or a straight edge), or the tube’s outside face.')
        _ok, a, b = geo.evaluator.getEndPoints()
        ap, ad = _t(a), _sub(_t(b), _t(a))
        if click is None:
            click = _t(a)
    else:
        raise ValueError('Click the pipe’s outside face first (a cylindrical face of the tube body).')
    mount = None
    if len(picks) > 1:
        m_ent, m_pt = picks[1]
        if m_pt is None:               # selected in code: a sketch point's or vertex's own position
            g = getattr(m_ent, 'worldGeometry', None) or getattr(m_ent, 'geometry', None)
            m_pt = g if g is not None and hasattr(g, 'x') else None
            if m_pt is None and _kind(m_ent) == 'BRepFace':
                m_pt = m_ent.pointOnFace
        if m_pt is not None:
            mount = _t(m_pt)
    up = (0.0, 0.0, 1.0) if _z_up() else (0.0, 1.0, 0.0)
    fr = HGR.frame(ap, ad, click, mount, up)
    return fr, od


def act_hang_pick(data):
    fr, od = _hang_frame(data)
    out = {'ok': True}
    bits = []
    if od:
        out['od_mm'] = round(10.0 * od, 3)
        bits.append('tube %.1f mm (%.3f in) outside' % (10 * od, 10 * od / 25.4))
    if fr['reach_cm'] is not None:
        out['reach_mm'] = round(10.0 * fr['reach_cm'], 2)
        bits.append('the mount %.1f mm (%.3f in) out from the tube centre' % (10 * fr['reach_cm'], 10 * fr['reach_cm'] / 25.4))
    out['msg'] = ('Read ' + ' and '.join(bits) + '.') if bits else 'Read the tube there; select its outside face to read its size.'
    return out


def _hang_loop(sk, loop):
    """One closed loop of ('L', a, b) and ('A', a, m, b) model points as connected sketch curves. Fusion orders an
    arc's two ends its own way (counter-clockwise about the sketch normal), so each next curve starts from whichever
    end of the last sits on that segment's end, and the loop closes on the first curve's starting point."""
    S = lambda p: sk.modelToSketchSpace(_P3(p))
    lines, arcs = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs
    first_sp, cur_sp = None, None
    for i, sg in enumerate(loop):
        last = i == len(loop) - 1
        p0, p1 = S(sg[1]), S(sg[-1])
        start = cur_sp if cur_sp is not None else p0
        end = first_sp if (last and first_sp is not None) else p1
        cur = lines.addByTwoPoints(start, end) if sg[0] == 'L' else arcs.addByThreePoints(start, S(sg[2]), end)
        a, b = cur.startSketchPoint, cur.endSketchPoint
        if first_sp is None:
            first_sp = a if a.geometry.distanceTo(p0) <= b.geometry.distanceTo(p0) else b
        cur_sp = b if b.geometry.distanceTo(p1) <= a.geometry.distanceTo(p1) else a
    return first_sp


def _hang_plate(comp, pl):
    plane = _plane_3pt(comp, pl['plane3'][0], pl['plane3'][1], pl['plane3'][2], pl['name'])
    sk = comp.sketches.add(plane)
    sk.name = pl['name']
    for loop in pl['loops']:
        _hang_loop(sk, loop)
    for c, r in pl['circles']:
        sk.sketchCurves.sketchCircles.addByCenterRadius(sk.modelToSketchSpace(_P3(c)), r)
    best, area = None, -1.0
    for i in range(sk.profiles.count):
        pr = sk.profiles.item(i)
        a = pr.areaProperties().area
        if a > area:
            best, area = pr, a
    if best is None:
        raise RuntimeError('Fusion made no closed profile from the %s outline.' % pl['name'])
    ext = comp.features.extrudeFeatures
    inp = ext.createInput(best, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    inp.setSymmetricExtent(adsk.core.ValueInput.createByReal(pl['t']), True)
    f = ext.add(inp)
    body = f.bodies.item(0)
    body.name = pl['name']
    return body


def _hang_rod(comp, rd):
    plane = _plane_3pt(comp, rd['plane3'][0], rd['plane3'][1], rd['plane3'][2], rd['name'])
    sk = comp.sketches.add(plane)
    sk.name = rd['name'] + ' path'
    S = lambda p: sk.modelToSketchSpace(_P3(p))
    lines, arcs = sk.sketchCurves.sketchLines, sk.sketchCurves.sketchArcs
    curves, end_pt = [], None
    for sg in rd['path']:
        start = end_pt if end_pt is not None else S(sg[1])
        cur = lines.addByTwoPoints(start, S(sg[-1])) if sg[0] == 'L' else arcs.addByThreePoints(start, S(sg[2]), S(sg[-1]))
        tgt = _P3(sg[-1])
        a, b = cur.startSketchPoint, cur.endSketchPoint
        end_pt = b if b.worldGeometry.distanceTo(tgt) <= a.worldGeometry.distanceTo(tgt) else a
        curves.append(cur)
    path = adsk.fusion.Path.create(_ctx(comp, curves[0]), adsk.fusion.ChainedCurveOptions.connectedChainedCurves)
    planes = comp.constructionPlanes
    pin = planes.createInput()
    zero = adsk.core.ValueInput.createByReal(0)
    if hasattr(pin, 'setByPath'):
        pin.setByPath(path, adsk.fusion.PathDistanceTypes.ProportionalPathDistanceType, zero)
    else:
        pin.setByDistanceOnPath(path, zero)
    pl = planes.add(pin)
    sk2 = comp.sketches.add(pl)
    sk2.name = rd['name'] + ' section'
    sk2.sketchCurves.sketchCircles.addByCenterRadius(sk2.modelToSketchSpace(_P3(rd['path'][0][1])), rd['d'] / 2.0)
    prof = sk2.profiles.item(0)
    sw = comp.features.sweepFeatures
    f = sw.add(sw.createInput(prof, path, adsk.fusion.FeatureOperations.NewBodyFeatureOperation))
    body = f.bodies.item(0)
    body.name = rd['name']
    return body


def act_hang(data):
    h = data.get('hanger') or {}
    fr, od = _hang_frame(data)
    if od and h.get('od_mm') and abs(10.0 * od - float(h['od_mm'])) > 0.5:
        raise ValueError('The tube clicked is %.1f mm (%.3f in) across but the page has %.1f mm: press Read the tube and reach first.'
                         % (10 * od, 10 * od / 25.4, float(h['od_mm'])))
    P = HGR.plan(h, fr)
    comp = _new_component(str(data.get('title') or 'Hanger'))
    made = []
    try:
        plates = [(_hang_plate(comp, pl), pl) for pl in P['plates']]
        made += [b.name for b, _pl in plates]
        for rd in P['rods']:
            made.append(_hang_rod(comp, rd).name)
        if P['cyls'] or P['cuts']:
            tbm = adsk.fusion.TemporaryBRepManager.get()
            named = [(tbm.createCylinderOrCone(_P3(c['a']), c['r'], _P3(c['b']), c['r']), c['name']) for c in P['cyls']]
            if named:
                made += [b.name for b in _add_bodies(comp, named)]
            if P['cuts'] and plates:
                tools = _add_bodies(comp, [(tbm.createCylinderOrCone(_P3(c['a']), c['r'], _P3(c['b']), c['r']), c['name']) for c in P['cuts']])
                for body, _pl in plates:
                    col = adsk.core.ObjectCollection.create()
                    for t in tools:
                        col.add(t)
                    ci = comp.features.combineFeatures.createInput(body, col)
                    ci.operation = adsk.fusion.FeatureOperations.CutFeatureOperation
                    ci.isKeepToolBodies = body is not plates[-1][0]
                    comp.features.combineFeatures.add(ci)
    except Exception:
        _drop_component(comp)
        raise
    # the frame sketches, profiles and construction planes stay in the timeline (edit the part there) but out of sight
    try:
        for i in range(comp.sketches.count):
            comp.sketches.item(i).isVisible = False
        for i in range(comp.constructionPlanes.count):
            comp.constructionPlanes.item(i).isLightBulbOn = False
    except Exception:
        pass
    where = 'square to the tube, pointing ' + ('at the mount you picked' if fr['reach_cm'] is not None else 'out through the point you clicked')
    return {'ok': True, 'msg': 'Built %s %s: %s.' % (str(data.get('title') or 'the hanger').lower(), where, ', '.join(made)),
            'bodies': made}


def act_chamber(data):
    """An inline expansion chamber with extended inlet and outlet tubes, from one marker on the pipe's axis: a sketch
    line drawn along the pipe's centreline where the chamber's near end plate goes, pointing the way the gas flows.
    Sizes come from the Mufflers tab (pipe inside diameter and wall, chamber inside diameter and length, the two
    extensions, the chamber wall); each stub runs 2 in past the end plates for the slip joint or weld. Three
    sketch-driven revolves in one component: the shell with its end plates, the inlet tube, the outlet tube."""
    t0 = time.time()
    mk = [m for m in _markers() if m['signed']]
    if len(mk) != 1:
        raise ValueError('Select one sketch line, drawn along the pipe\'s centreline where the chamber\'s near end plate '
                         'goes, pointing the way the gas flows.')
    start, d = mk[0]['p'], _unit(mk[0]['d'])
    pipe_id, wall = _cm(data, 'pipe_id_mm', 0.0), _cm(data, 'wall_mm', 0.1651)
    can_id, cw, L = _cm(data, 'can_id_mm', 0.0), _cm(data, 'can_wall_mm', 0.1519), _cm(data, 'can_len_mm', 0.0)
    l_in, l_out, stub = _cm(data, 'in_mm', 0.0), _cm(data, 'out_mm', 0.0), _cm(data, 'stub_mm', 5.08)
    nb, hole = int(float(data.get('baffles') or 0)), _cm(data, 'baffle_hole_mm', 0.0)
    lay = TPL.ext_chamber(pipe_id, wall, can_id, cw, L, l_in, l_out, stub, nb, hole, cw)
    title = str(data.get('title') or 'Expansion chamber')
    notes = []
    scene = None
    if _keepouts:
        reach = lay['overall'] + lay['R_out'] + 3.0
        try:
            scene = _scene(tuple(start[k] - reach for k in range(3)), tuple(start[k] + reach for k in range(3)), 1.0, notes)
        except ValueError:
            scene = None
    _status('Building the chamber…')
    comp = _new_component(title)
    try:
        _revolve_section(comp, start, d, lay['shell'], title + ' shell')
        _revolve_section(comp, start, d, lay['inlet'], title + ' inlet tube')
        _revolve_section(comp, start, d, lay['outlet'], title + ' outlet tube')
        for i, sec in enumerate(lay['baffles']):
            _revolve_section(comp, start, d, sec, '%s baffle %d' % (title, i + 1))
    except Exception as ex:
        _drop_component(comp)
        raise ValueError('Fusion would not build the chamber (%s). Nothing was left in the design.' % ex)
    gap, gap_over, ok_gap = None, False, True
    if scene is not None:
        _status('Checking the chamber against the keep-outs…')
        pts, err = TPL.cylinder_samples(start, d, lay['R_out'], 0.0, lay['z1'], step=0.3)
        gap, _at = TPL.clearance(scene, pts, err)
        if gap is None:
            gap, gap_over = 12.0, True
        ok_gap = gap_over or gap >= float(data.get('gap_cm', 1.27))
    note = (('%d baffle%s with a %.2f in hole, evenly spaced between the tube mouths. ' % (nb, '' if nb == 1 else 's', hole / 2.54)) if nb else '') + ('Inside %.2f in across and %.2f in long, %.2f L of gas; inlet tube runs %.2f in in, outlet tube %.2f in; '
            '%.2f in long outside with %.3f in wall and end plates, %.2f in over the stubs.' % (
                can_id / 2.54, L / 2.54, lay['gas'] / 1000.0, l_in / 2.54, l_out / 2.54, lay['outside_len'] / 2.54,
                cw / 2.54, lay['overall'] / 2.54))
    items = [{'kind': 'part', 'name': title, 'ok': ok_gap, 'note': note,
              'chamber': {'gas_cm3': lay['gas'], 'can_id_cm': can_id, 'can_len_cm': L, 'in_cm': l_in, 'out_cm': l_out}}]
    if gap is not None:
        items[0]['min_gap'] = gap
        items[0]['gap_over'] = gap_over
    msg = 'Built the expansion chamber with its extended tubes in a new component, along the marker.'
    if scene is None and not _keepouts:
        msg += ' Set the scan as a keep-out to check its clearance.'
    msg += ' %.0f s.' % (time.time() - t0)
    if notes:
        msg += ' ' + ' '.join(notes)
    msg += ' The shell and both tubes are sketch-driven revolves (edit their section sketches); the tubes pass through the end plates, so join or weld them there.'
    return {'ok': True, 'msg': msg, 'items': items, 'route_ok': ok_gap}


def act_revchamber(data):
    """A reverse-flow chamber, the layout of most chambered street mufflers: a round or flat-oval case with the inlet
    and outlet tubes side by side through one end plate, each running the same distance into the case, the far plate
    blank. One marker: a sketch line along the case's axis from the middle of the pipe end plate's outside face,
    pointing into the case; the tubes sit either side of it across the case's width (the marker's own square-to
    direction, the longer way of the oval). Sizes come from the Mufflers tab: pipe ID and wall, the case (round
    chamber bore, or a flat oval of the same area at the given height, inside), its wall, the inside length, the
    tubes' run-in and centre spacing, the stubs. Built as a shell (an outer extrusion with the inside cut away between
    the end plates), two holes cut through the pipe plate, and the two tubes as revolves."""
    t0 = time.time()
    mk = [m for m in _markers() if m['signed']]
    if len(mk) != 1:
        raise ValueError('Select one sketch line, drawn along the case\'s centreline from the middle of the pipe end plate, pointing into the case.')
    start, d = mk[0]['p'], _unit(mk[0]['d'])
    pipe_id, wall = _cm(data, 'pipe_id_mm', 0.0), _cm(data, 'wall_mm', 0.1651)
    W, H, cw, L = _cm(data, 'case_w_mm', 0.0), _cm(data, 'case_h_mm', 0.0), _cm(data, 'can_wall_mm', 0.1519), _cm(data, 'can_len_mm', 0.0)
    run_in, sp, stub = _cm(data, 'in_mm', 0.0), _cm(data, 'spacing_mm', 0.0), _cm(data, 'stub_mm', 5.08)
    od = pipe_id + 2 * wall
    if not (pipe_id > 0 and wall > 0 and W > 0 and H > 0 and cw > 0 and L > 0):
        raise ValueError('Fill in the pipe, the case and its walls on the Mufflers tab first.')
    if sp <= 0:
        sp = od + 1.2
    if run_in < 0 or run_in >= L:
        raise ValueError('The tubes run in by less than the case\'s length.')
    if sp + od > W - 0.2 or od > H - 0.2:
        raise ValueError('The two tubes side by side do not fit across the case: a wider case or a smaller pipe.')
    title = str(data.get('title') or 'Reverse-flow chamber')
    e1, e2 = RT.perp_basis(d)                        # e1 across the case's width, e2 its height
    Wo, Ho, Lo = W + 2 * cw, H + 2 * cw, L + 2 * cw
    _status('Building the case…')
    comp = _new_component(title)
    try:
        _extrude_section(comp, start, e1, e2, d, Lo, lambda sk: _stadium(sk, start, e1, e2, Wo, Ho), title + ' case')
        inside0 = RT.vadd(start, RT.vmul(d, cw))
        _extrude_section(comp, inside0, e1, e2, d, L, lambda sk: _stadium(sk, inside0, e1, e2, W, H), title + ' inside',
                         op=adsk.fusion.FeatureOperations.CutFeatureOperation)
        hole_r = od / 2.0 + 0.025
        back = RT.vadd(start, RT.vmul(d, -0.1))
        for k, sgn in ((0, -1.0), (1, 1.0)):
            c = RT.vadd(back, RT.vmul(e1, sgn * sp / 2.0))
            _extrude_section(comp, back, e1, e2, d, cw + 0.2, lambda sk, c=c: sk.sketchCurves.sketchCircles.addByCenterRadius(sk.modelToSketchSpace(_P3(c)), hole_r),
                             title + (' inlet hole' if k == 0 else ' outlet hole'), op=adsk.fusion.FeatureOperations.CutFeatureOperation)
            o = RT.vadd(start, RT.vmul(e1, sgn * sp / 2.0))
            tube = [(pipe_id / 2.0, -stub), (od / 2.0, -stub), (od / 2.0, cw + run_in), (pipe_id / 2.0, cw + run_in)]
            _revolve_section(comp, o, d, tube, title + (' inlet tube' if k == 0 else ' outlet tube'))
    except Exception as ex:
        _drop_component(comp)
        raise ValueError('Fusion would not build the chamber (%s). Nothing was left in the design.' % ex)
    gas = (math.pi * H * H / 4.0 + (W - H) * H) * L - 2 * math.pi * (od / 2.0) ** 2 * run_in
    note = ('Case %.2f x %.2f in outside, %.2f in long over the plates (%.2f in inside), %.2f in wall; two %.2f in OD tubes %.2f in '
            'apart, run in %.2f in, stubs %.2f in; %.2f L of gas.' % (Wo / 2.54, Ho / 2.54, Lo / 2.54, L / 2.54, cw / 2.54, od / 2.54, sp / 2.54, run_in / 2.54, stub / 2.54, gas / 1000.0))
    items = [{'kind': 'part', 'name': title, 'ok': True, 'note': note, 'chamber': {'gas_cm3': gas, 'W_cm': W, 'H_cm': H, 'L_cm': L, 'in_cm': run_in, 'spacing_cm': sp}}]
    msg = 'Built the reverse-flow chamber in a new component: the case as a shell, two holes through the pipe plate, the two tubes as revolves. %.0f s.' % (time.time() - t0)
    msg += ' The case and the holes are sketch-driven extrudes and the tubes revolves (edit their sketches); the tubes pass through the plate, so weld them there. Internal gussets round the outlet are yours to add.'
    return {'ok': True, 'msg': msg, 'items': items}



# --------------------------------------------------------------------------
# Split a tube for printing (printsplit.py plans it): pieces that each fit the bed standing up, joined by flush lap
# joints with the walls thinned where they overlap, so neither the outside nor the bore shows a step
# --------------------------------------------------------------------------

def _ps_curve_geo(ent):
    try:
        return ent.worldGeometry
    except Exception:
        return ent.geometry


def _ps_native(body):
    """The body itself when it was picked through an occurrence: the features, the bodies the split makes and the path
    are all in the component's own space, so a moved occurrence is refused rather than cut in the wrong place."""
    occ = None
    try:
        occ = body.assemblyContext
    except Exception:
        pass
    if occ is None:
        return body
    try:
        m = occ.transform2
    except Exception:
        m = occ.transform
    arr = list(m.asArray())
    ident = [1.0 if i % 5 == 0 else 0.0 for i in range(16)]
    if any(abs(a - b) > 1e-9 for a, b in zip(arr, ident)):
        raise ValueError('The tube is in a component that has been moved (%s): open that component on its own '
                         '(right-click it, Open in a new window, or Activate it and move it back to the origin), then split it.' % occ.name)
    return body.nativeObject or body


_PS_RESTORED = set()     # points of selections this module re-added after a timeline roll
_CFD_CLICK = {}          # body entityToken -> the owner's last real click on it (mm)


def _ps_pipe_path_ents(pf):
    """A Pipe feature's path curves. Fusion only gives a feature's inputs with the timeline rolled to just before it
    ("Didn't roll editing feature back" otherwise, found live 2026-11-11), so roll there, read, and put the marker back."""
    try:
        path = pf.path
        return [path.item(k).entity for k in range(path.count)]
    except RuntimeError:
        pass
    tlo = pf.timelineObject
    des = adsk.fusion.Design.cast(_app.activeProduct) if _app else adsk.fusion.Design.cast(adsk.core.Application.get().activeProduct)
    tl = des.timeline
    mark = tl.markerPosition
    sels = adsk.core.Application.get().userInterface.activeSelections
    kept = [sels.item(k).entity for k in range(sels.count)]      # rolling the timeline clears the selection
    tlo.rollTo(True)
    try:
        path = pf.path
        return [path.item(k).entity for k in range(path.count)]
    finally:
        tl.markerPosition = mark
        for e in kept:
            try:
                sels.add(e)
            except Exception:
                pass
        # a selection put back by code carries a point of Fusion's choosing, not the owner's click: note those points
        # so act_cfd_tube can tell them from a real click (it keeps the click it read before the roll)
        _PS_RESTORED.clear()
        for k in range(sels.count):
            try:
                q = sels.item(k).point
                _PS_RESTORED.add(tuple(round(c, 6) for c in _t(q)))
            except Exception:
                pass


def _ps_find_path(body):
    """The path of the Pipe feature that made this body (its component's pipe features, nearest first)."""
    comp = body.parentComponent
    bb = body.boundingBox
    best = None
    for i in range(comp.features.pipeFeatures.count):
        pf = comp.features.pipeFeatures.item(i)
        try:
            ents = _ps_pipe_path_ents(pf)
            pts = []
            for e in ents:
                g = _ps_curve_geo(e)
                ok_, t0, t1 = g.evaluator.getParameterExtents()
                ok_, pm = g.evaluator.getPointAtParameter(0.5 * (t0 + t1))
                pts.append(pm)
        except Exception:
            continue
        inside = sum(1 for q in pts if bb.contains(q))
        if inside and (best is None or inside > best[0]):
            best = (inside, ents)
    return best[1] if best else []


def _ps_chain(ents):
    """The curves end to end: [(item, flipped)], from one free end to the other (printsplit.chain_order, cm)."""
    items = []
    for e in ents:
        g = _ps_curve_geo(e)
        ok_, t0, t1 = g.evaluator.getParameterExtents()
        ok_, a = g.evaluator.getPointAtParameter(t0)
        ok_, b = g.evaluator.getPointAtParameter(t1)
        items.append({'e': e, 'g': g, 't0': t0, 't1': t1, 'a': _t(a), 'b': _t(b)})
    return [(items[k], flip) for k, flip in PS.chain_order([(it['a'], it['b']) for it in items], tol=1e-3)]


def _ps_stations(chain, ds_cm=0.5):
    """Centreline points (mm), straight-run ids, and the sketch line of each run."""
    pts, runs, run_ent, k = [], [], {}, 0
    for it, flip in chain:
        g = it['g']
        ok_, length = g.evaluator.getLengthAtParameter(it['t0'], it['t1'])
        line = g.objectType.split('::')[-1] in ('Line3D', 'InfiniteLine3D')
        if not line:                    # path curves can come over as NURBS: a straight one is as long as its chord
            line = abs(length - math.dist(it['a'], it['b'])) < 1e-4 * max(1.0, length)
        n = max(2, int(math.ceil(length / ds_cm)))
        rid = None
        if line:
            rid = k
            run_ent[k] = it['e']
            k += 1
        for i in range(n):
            f = i / float(n)
            if flip:
                f = 1.0 - f
            ok_, prm = g.evaluator.getParameterAtLength(it['t0'], f * length)
            ok_, q = g.evaluator.getPointAtParameter(prm)
            pts.append(tuple(10.0 * c for c in _t(q)))
            runs.append(rid)
    last = chain[-1][0]
    pts.append(tuple(10.0 * c for c in (last['a'] if chain[-1][1] else last['b'])))
    runs.append(runs[-1])
    return pts, runs, run_ent


def _ps_ring_point(q, s_off, r, ang=0.0):
    """A point (mm) r from the centreline at station q, s_off along it, ang radians round it."""
    u, v = PS._perp(q['t'])
    c, s = math.cos(ang), math.sin(ang)
    return tuple(q['p'][k] + s_off * q['t'][k] + r * (c * u[k] + s * v[k]) for k in range(3))


def _ps_wall_point(q, s_off, r):
    return _ps_ring_point(q, s_off, r, 0.0)


def _ps_inside(body, p_mm):
    pt = adsk.core.Point3D.create(*[c / 10.0 for c in p_mm])
    return body.pointContainment(pt) == adsk.fusion.PointContainment.PointInsidePointContainment


_PS_ANGLES = [0.3 + 2 * math.pi * k / 8 for k in range(8)]     # off the seams Pipe puts at angle 0


def _ps_radii(body, st):
    """Bore and outside radius (mm) of the tube at the middle of its longest straight (or of the path, when it is all
    bend): the coaxial cylinders' exact radii when there are some, picked by what is solid either side of each
    (printsplit.pick_wall_radii: embossed lettering adds cylinders), else stepped out from the centreline."""
    best = None
    for i, q in enumerate(st):
        if q['run'] is not None:
            j = i
            while j + 1 < len(st) and st[j + 1]['run'] == q['run']:
                j += 1
            if best is None or j - i > best[1] - best[0]:
                best = (i, j)
    q = st[(best[0] + best[1]) // 2] if best else st[len(st) // 2]

    def solid(r):                       # the majority of 8 angles, so a letter on one side does not decide it
        return sum(1 for a in _PS_ANGLES if _ps_inside(body, _ps_ring_point(q, 0.0, r, a))) >= 5
    rs = []
    if best:
        for i in range(body.faces.count):
            g = body.faces.item(i).geometry
            if g.surfaceType != adsk.core.SurfaceTypes.CylinderSurfaceType:
                continue
            ax = _t(g.axis)
            n = math.sqrt(_dot(ax, ax)) or 1.0
            ax = tuple(x / n for x in ax)
            if abs(abs(_dot(ax, q['t'])) - 1.0) > 1e-4:
                continue
            o = tuple(10.0 * x for x in _t(g.origin))
            d = _sub(q['p'], o)
            if math.sqrt(max(0.0, _dot(d, d) - _dot(d, ax) ** 2)) < 0.05:
                rs.append(10.0 * g.radius)
    got = PS.pick_wall_radii(rs, solid) if len(set(round(r, 3) for r in rs)) >= 2 else None
    if got is None:
        scans = []
        for a in _PS_ANGLES[::3]:
            s = PS.scan_wall_radii(lambda r: _ps_inside(body, _ps_ring_point(q, 0.0, r, a)))
            if s:
                scans.append(s)
        if not scans:
            raise ValueError('Could not find the tube wall around the path: select the tube body and its centreline.')
        scans.sort()
        got = scans[len(scans) // 2]
    return got


def _ps_keepouts(body, st, r_in, r_out):
    """Stretches of the tube (mm along it) with anything but plain wall on them: lettering, bosses, end lips. Samples
    a 5 x 5 grid on each face, keeping only the samples on the face itself (a trimmed face's grid runs off it)."""
    faces = []
    for fi in range(body.faces.count):
        ev = body.faces.item(fi).evaluator
        try:
            rng = ev.parametricRange()            # a BoundingBox2D (not a tuple)
            pts = []
            for a in range(5):
                for b in range(5):
                    prm = adsk.core.Point2D.create(rng.minPoint.x + (rng.maxPoint.x - rng.minPoint.x) * a / 4.0,
                                                   rng.minPoint.y + (rng.maxPoint.y - rng.minPoint.y) * b / 4.0)
                    if not ev.isParameterOnFace(prm):
                        continue
                    ok_, p = ev.getPointAtParameter(prm)
                    if ok_:
                        pts.append(tuple(10.0 * c for c in _t(p)))
        except Exception:
            continue
        faces.append(pts)
    return PS.keepouts_from_samples(faces, st, r_in, r_out)


def _ps_body_at(comp, p_mm):
    pt = adsk.core.Point3D.create(*[c / 10.0 for c in p_mm])
    for i in range(comp.bRepBodies.count):
        b = comp.bRepBodies.item(i)
        if b.isSolid and b.pointContainment(pt) == adsk.fusion.PointContainment.PointInsidePointContainment:
            return b
    return None


def _ps_find(comp, q, r_mid, s_off=0.0):
    """The solid body in the wall at station q (re-found after every feature: a split or a combine can hand back new
    body objects)."""
    for a in _PS_ANGLES[::2]:
        b = _ps_body_at(comp, _ps_ring_point(q, s_off, r_mid, a))
        if b is not None:
            return b
    return None


def _ps_piece(comp, st, pc, r_mid):
    """Piece pc's body, looked for at its middle station, then a quarter and three quarters along."""
    for f in (0.5, 0.25, 0.75):
        b = _ps_find(comp, st[int(round(pc['i0'] + f * (pc['i1'] - pc['i0'])))], r_mid)
        if b is not None:
            return b
    return None


def _ps_plane(comp, ln, p_cm, n):
    """A construction plane normal to the straight ln through p (cm). Placed by proportion along the line; checked,
    and placed from the other end when the path runs the other way."""
    g = _ps_curve_geo(ln)
    ok_, a0, a1 = g.evaluator.getParameterExtents()
    ok_, pa = g.evaluator.getPointAtParameter(a0)
    ok_, pb = g.evaluator.getPointAtParameter(a1)
    a, b = _t(pa), _t(pb)
    ab = _sub(b, a)
    r = max(0.0, min(1.0, _dot(_sub(p_cm, a), ab) / _dot(ab, ab)))
    path = adsk.fusion.Path.create(ln, adsk.fusion.ChainedCurveOptions.noChainedCurves)
    for rr in (r, 1.0 - r):
        pi = comp.constructionPlanes.createInput()
        if hasattr(pi, 'setByPath'):            # September 2026 on; setByDistanceOnPath is retired
            pi.setByPath(path, adsk.fusion.PathDistanceTypes.ProportionalPathDistanceType, adsk.core.ValueInput.createByReal(rr))
        else:
            pi.setByDistanceOnPath(path, adsk.core.ValueInput.createByReal(rr))
        plane = comp.constructionPlanes.add(pi)
        pg = plane.geometry
        nv = _t(pg.normal)
        nn = math.sqrt(_dot(nv, nv)) or 1.0
        if abs(_dot(_sub(p_cm, _t(pg.origin)), nv)) / nn < 0.005:
            return plane
        plane.deleteMe()
    raise ValueError('Could not place the plane for cut %d on its straight.' % n)


def _ps_circle_edges(body, r_mm, centre_cm):
    """The circular (or arc) edges of body with radius r_mm centred at centre_cm."""
    out = []
    C3, A3 = adsk.core.Curve3DTypes.Circle3DCurveType, adsk.core.Curve3DTypes.Arc3DCurveType
    for i in range(body.edges.count):
        e = body.edges.item(i)
        g = e.geometry
        if g.curveType in (C3, A3) and abs(g.radius - r_mm / 10.0) < 0.002 and math.dist(_t(g.center), centre_cm) < 0.01:
            out.append(e)
    return out


def _ps_write_stl(path, body, base, axis, spin_deg):
    calc = body.meshManager.createMeshCalculator()
    calc.setQuality(adsk.fusion.TriangleMeshQualityOptions.HighQualityTriangleMesh)
    m = calc.calculate()
    xyz, idx = m.nodeCoordinatesAsFloat, m.nodeIndices
    pts = PS.stand_points([(10.0 * xyz[3 * j], 10.0 * xyz[3 * j + 1], 10.0 * xyz[3 * j + 2]) for j in range(len(xyz) // 3)],
                          base, axis, spin_deg)
    import struct
    with open(path, 'wb') as fh:
        fh.write(b'Exhaust Tuner print split'.ljust(80, b' '))
        fh.write(struct.pack('<I', len(idx) // 3))
        for t in range(len(idx) // 3):
            A, B, C = pts[idx[3 * t]], pts[idx[3 * t + 1]], pts[idx[3 * t + 2]]
            n = _cross(_sub(B, A), _sub(C, A))
            ln = math.sqrt(_dot(n, n)) or 1.0
            fh.write(struct.pack('<12fH', n[0] / ln, n[1] / ln, n[2] / ln, A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], 0))


def act_print_split(data):
    sels = _selected()
    bodies = _bodies_of([e for e in sels if _kind(e) in ('BRepBody', 'BRepFace')])
    curves = [e for e in sels if _kind(e) in ('sketch', 'BRepEdge')]
    if not bodies:
        raise ValueError('Select the tube (click its outside face). If it was not made with Pipe, Ctrl+click its centreline curves too.')
    body = bodies[0]
    if _kind(body) != 'BRepBody':
        raise ValueError('That is a mesh: the split needs a solid tube.')
    body = _ps_native(body)
    comp = body.parentComponent
    if not curves:
        curves = _ps_find_path(body)
    if not curves:
        raise ValueError('No Pipe path found for this body: Ctrl+click its centreline sketch curves too.')
    bed = [float(data.get(k, 256.0)) for k in ('bed_x_mm', 'bed_y_mm', 'bed_z_mm')]
    L = float(data.get('lap_mm', 20.0))
    clr = float(data.get('clearance_mm', 0.15))
    dens = float(data.get('density', 1.2))
    chain = _ps_chain(curves)
    pts, runs, run_ent = _ps_stations(chain)
    st_all = PS.stations_from_polyline(pts, runs)
    r_in, r_out = _ps_radii(body, st_all)
    # the part of the path the body covers (a path often runs on into the throttle body or the flange)
    r_mid = 0.5 * (r_in + r_out)
    inside = [any(_ps_inside(body, _ps_ring_point(q, 0.0, r_mid, a)) for a in _PS_ANGLES[::3]) for q in st_all]
    if not any(inside):
        raise ValueError('The selected curves do not run inside this tube.')
    i0 = inside.index(True)
    i1 = len(inside) - 1 - inside[::-1].index(True)
    st = PS.stations_from_polyline([q['p'] for q in st_all[i0:i1 + 1]], [q['run'] for q in st_all[i0:i1 + 1]])
    keep = _ps_keepouts(body, st, r_in, r_out)
    t0 = time.time()
    pl = PS.plan(st, r_out, keepouts=keep, bed=bed, L=L, r_in=r_in, clearance=clr)
    if not pl['ok']:
        return {'ok': False, 'msg': ' '.join(pl['notes'])}
    if not pl['cuts']:
        return {'ok': True, 'msg': 'This tube fits the bed in one piece (%s tall standing on its end): no split needed.' % PS.mm_in(pl['pieces'][0]['height'], 0),
                'split': {'pieces': [], 'cuts': []}}
    jr = PS.joint_radii(r_in, r_out, clr)
    roles = PS.joint_roles(pl['cuts'])
    V = adsk.core.ValueInput
    FE = adsk.fusion.FeatureOperations
    POS, NEG = adsk.fusion.ExtentDirections.PositiveExtentDirection, adsk.fusion.ExtentDirections.NegativeExtentDirection
    des = adsk.fusion.Design.cast(_app.activeProduct)
    try:
        tl = des.timeline                       # none in a direct-modelling design
        tl_start = tl.count
    except Exception:
        tl, tl_start = None, 0
    name0 = body.name
    notes = list(pl['notes'])
    names = ['%s PRINT %d' % (name0, k) for k in range(1, len(pl['pieces']) + 1)]
    step = 'the cut planes'

    def group(label):
        try:
            if tl is not None and tl.count - 1 > tl_start:
                tl.timelineGroups.add(tl_start, tl.count - 1).name = label
        except Exception:
            pass
    try:
        made = []
        for n, c in enumerate(pl['cuts'], 1):
            q = st[c['i']]
            ln = run_ent.get(q['run'])
            if ln is None:
                raise ValueError('Lost the straight under cut %d.' % n)
            p = tuple(x / 10.0 for x in c['p'])
            plane = _ps_plane(comp, ln, p, n)
            plane.name = 'PRINT SPLIT %d' % n
            made.append((plane, c, p))
        for n, (plane, c, p) in enumerate(made, 1):
            step = 'cut %d' % n
            sk = comp.sketches.add(plane)
            sk.name = 'PRINT SPLIT %d CUT' % n
            sk.sketchCurves.sketchCircles.addByCenterRadius(sk.modelToSketchSpace(adsk.core.Point3D.create(*p)), (r_out + 15.0) / 10.0)
            pf = comp.features.patchFeatures.add(comp.features.patchFeatures.createInput(sk.profiles.item(0), FE.NewBodyFeatureOperation))
            pf.name = 'PRINT SPLIT %d TOOL' % n
            tool = pf.bodies.item(0)
            tgt = _ps_find(comp, st[c['i']], r_mid)
            if tgt is None:
                raise ValueError('Lost the tube at cut %d.' % n)
            sf = comp.features.splitBodyFeatures.add(comp.features.splitBodyFeatures.createInput(tgt, tool, False))
            sf.name = 'PRINT SPLIT %d' % n
            try:
                tool.isVisible = False
            except Exception:
                pass
        step = 'naming the pieces'
        for k, pc in enumerate(pl['pieces']):
            b = _ps_piece(comp, st, pc, r_mid)
            if b is None:
                raise ValueError('Could not find piece %d after the cuts.' % (k + 1))
            b.name = names[k]
        for k, pc in enumerate(pl['pieces']):      # two pieces found in one body would leave the first renamed
            b = _ps_piece(comp, st, pc, r_mid)
            if b is None or b.name != names[k]:
                raise ValueError('The cuts did not separate piece %d from its neighbour.' % (k + 1))
        for n, (plane, c, p) in enumerate(made, 1):
            step = 'the lap joint at cut %d' % n
            rl = roles[n - 1]
            t, sg = st[c['i']]['t'], rl['sg']
            pg, pr = pl['pieces'][rl['grower']], pl['pieces'][rl['receiver']]
            sk = comp.sketches.add(plane)
            sk.name = 'PRINT SPLIT %d LAP' % n
            to_recv = POS if PS.toward_receiver(_cross(_t(sk.xDirection), _t(sk.yDirection)), t, sg) > 0 else NEG
            cc = sk.modelToSketchSpace(adsk.core.Point3D.create(*p))
            radii = (jr['tongue_in'], jr['tongue_out'], r_out, r_out + 2.0)
            for rr in radii:
                sk.sketchCurves.sketchCircles.addByCenterRadius(cc, rr / 10.0)
            profs = [sk.profiles.item(i) for i in range(sk.profiles.count) if sk.profiles.item(i).profileLoops.count == 2]
            if len(profs) < 3:
                raise ValueError('The lap sketch at cut %d has %d rings, not 3.' % (n, len(profs)))

            def ring(a_mm, b_mm):
                want = math.pi * ((b_mm / 10.0) ** 2 - (a_mm / 10.0) ** 2)
                return min(profs, key=lambda pr_: abs(pr_.areaProperties().area - want))
            # the receiver: everything from the inner tongue out, L deep (participantBodies holds for a cut)
            cut = adsk.core.ObjectCollection.create()
            for a_mm, b_mm in ((radii[0], radii[1]), (radii[1], radii[2]), (radii[2], radii[3])):
                cut.add(ring(a_mm, b_mm))
            recv = _ps_piece(comp, st, pr, r_mid)
            e1 = comp.features.extrudeFeatures.createInput(cut, FE.CutFeatureOperation)
            e1.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(V.createByReal(L / 10.0)), to_recv)
            e1.participantBodies = [recv]
            comp.features.extrudeFeatures.add(e1).name = 'PRINT SPLIT %d RECESS' % n
            # the grower's outer tongue: a new body combined into the grower only. A Join extrude would also take in the
            # receiver, whose shoulder face the tongue's tip touches (participantBodies is for cut and intersect only).
            e2 = comp.features.extrudeFeatures.createInput(ring(radii[1], radii[2]), FE.NewBodyFeatureOperation)
            e2.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(V.createByReal(L / 10.0)), to_recv)
            xf = comp.features.extrudeFeatures.add(e2)
            xf.name = 'PRINT SPLIT %d TONGUE' % n
            tongue = xf.bodies.item(0)
            tools = adsk.core.ObjectCollection.create()
            tools.add(tongue)
            grower = _ps_piece(comp, st, pg, r_mid)
            ci = comp.features.combineFeatures.createInput(grower, tools)
            ci.operation = FE.JoinFeatureOperation
            ci.isKeepToolBodies = False
            comp.features.combineFeatures.add(ci).name = 'PRINT SPLIT %d TONGUE JOIN' % n
            far = tuple(p[k] - sg * (L / 10.0) * t[k] for k in range(3))
            for r_mm, size, label, pc in ((jr['tongue_in'], jr['shoulder'], 'SHOULDER', pr), (jr['tongue_out'], jr['tip'], 'TONGUE TIP', pg)):
                if size <= 0:
                    continue
                bb = _ps_piece(comp, st, pc, r_mid)
                edges = _ps_circle_edges(bb, r_mm, far) if bb is not None else []
                if not edges:
                    notes.append('No %s edge found at cut %d: that chamfer was not made.' % (label.lower(), n))
                    continue
                oc = adsk.core.ObjectCollection.create()
                for e in edges:
                    oc.add(e)
                try:
                    ch = comp.features.chamferFeatures.createInput2()
                    ch.chamferEdgeSets.addEqualDistanceChamferEdgeSet(oc, V.createByReal(size / 10.0), False)
                    comp.features.chamferFeatures.add(ch).name = 'PRINT SPLIT %d %s' % (n, label)
                except Exception as ex:
                    notes.append('Fusion refused the %s chamfer at cut %d (%s): add it by hand (%s, 45 degrees).' % (
                        label.lower(), n, str(ex).splitlines()[0][:80] if str(ex) else 'no reason given', PS.mm_in(size, 1)))
    except Exception as ex:
        group('Print split (incomplete)')
        raise ValueError('The split stopped at %s: %s. What it made is in the "Print split (incomplete)" timeline group: '
                         'delete that group (or undo) before trying again.' % (step, str(ex).strip() or type(ex).__name__))
    group('Print split')
    # clash check, then the print-ready STLs
    pieces = [_ps_piece(comp, st, pc, r_mid) for pc in pl['pieces']]
    if any(b is None for b in pieces):
        raise ValueError('Lost a piece after the lap joints: check the "Print split" group.')
    tbm = adsk.fusion.TemporaryBRepManager.get()
    clash = []
    for i in range(len(pieces)):
        for j in range(i + 1, len(pieces)):
            x = tbm.copy(pieces[i])
            if tbm.booleanOperation(x, tbm.copy(pieces[j]), adsk.fusion.BooleanTypes.IntersectionBooleanType) and x.volume > 1e-6:
                clash.append((pieces[i].name, pieces[j].name))
    doc = _app.activeDocument.name if _app.activeDocument else 'design'
    folder = os.path.join(os.path.expanduser('~'), 'Documents', 'Exhaust Tuner', 'prints', ''.join(ch for ch in doc if ch not in '<>:"/\\|?*'))
    os.makedirs(folder, exist_ok=True)
    rows, vol = [], 0.0
    for k, (b, pc) in enumerate(zip(pieces, pl['pieces']), 1):
        i = pc['i0'] if pc['base'] == 'start' else pc['i1']
        axis = st[i]['t'] if pc['base'] == 'start' else tuple(-x for x in st[i]['t'])
        fn = os.path.join(folder, b.name + '.stl')
        _ps_write_stl(fn, b, st[i]['p'], axis, pc['spin_deg'])
        vol += b.volume
        rows.append({'name': b.name, 'vol_cm3': round(b.volume, 1), 'height_mm': round(pc['height'], 1),
                     'footprint_mm': [round(pc['w'], 1), round(pc['h'], 1)], 'base': pc['base'],
                     'length_mm': round(pc['s1'] - pc['s0'], 1)})
    fil = PS.filament(vol, dens)
    sheet = PS.assembly_sheet(pl, r_in, r_out, clr, L, names)
    msg = ('Split %s into %d pieces that each print standing up on a %.0f x %.0f x %.0f mm (%.1f x %.1f x %.1f in) bed, joined by '
           'flush lap joints %s long: the walls are thinned to %s and %s where they overlap with a %s epoxy gap, so the '
           'outside stays %s and the bore %s straight through. Cuts at %s mm (%s in) along the tube, clear of the '
           'bends%s. %.0f cm3 in all: about %.0f g and %.0f m of 1.75 mm filament at %.2f g/cm3. Epoxy: %.1f mL in the bond '
           'lines in all (%.2f mL a joint; mix about three times that). Print-ready STLs (each stood on its end) are in %s.' % (
               name0, len(pieces), bed[0], bed[1], bed[2], bed[0] / 25.4, bed[1] / 25.4, bed[2] / 25.4, PS.mm_in(L, 0),
               PS.mm_in(jr['inner_t']), PS.mm_in(jr['outer_t']), PS.mm_in(clr, 2), PS.mm_in(2 * r_out), PS.mm_in(2 * r_in),
               ', '.join('%.0f' % c['s'] for c in pl['cuts']), ', '.join('%.2f' % (c['s'] / 25.4) for c in pl['cuts']),
               ' and the %d raised or recessed area%s' % (len(keep), '' if len(keep) == 1 else 's') if keep else '',
               vol, fil['mass_g'], fil['length_m'], dens, sheet['total_bond_ml'],
               sheet['joints'][0]['bond_ml'] if sheet['joints'] else 0.0, folder))
    if notes:
        msg += ' ' + ' '.join(notes)
    if clash:
        msg += ' Check %s: Fusion found them overlapping.' % '; '.join(' and '.join(c) for c in clash)
    return {'ok': not clash, 'msg': msg, 'split': {'pieces': rows, 'cuts': [{'s_mm': round(c['s'], 1), 'grower': c['grower']} for c in pl['cuts']],
                                                    'bore_mm': round(2 * r_in, 2), 'od_mm': round(2 * r_out, 2), 'lap_mm': L,
                                                    'keepouts_mm': [[round(a, 1), round(b, 1)] for a, b in keep],
                                                    'volume_cm3': round(vol, 1), 'mass_g': round(fil['mass_g']), 'filament_m': round(fil['length_m']),
                                                    'assembly': sheet, 'notes': notes,
                                                    'folder': folder, 'plan_s': round(time.time() - t0, 1)}}


# --------------------------------------------------------------------------
# Test this intake (CFD): the selected tube read as the CFD generator's parametric design (tubecfd.py turns the
# samples into it); the page adds the Intake tab's airflow and runs it on the program's OpenFOAM (foamrun.py)
# --------------------------------------------------------------------------

def _cfd_xf(occ):
    """Component space -> the assembly's (mm), for a Pipe path found in the component of a body picked through occ."""
    if occ is None:
        return lambda p: p
    try:
        m = occ.transform2
    except Exception:
        m = occ.transform
    a = list(m.asArray())               # row-major 4 x 4; the translation (cm) in the last column
    return lambda p: tuple(a[4 * r] * p[0] + a[4 * r + 1] * p[1] + a[4 * r + 2] * p[2] + 10.0 * a[4 * r + 3] for r in range(3))


def _cfd_samples(chain, xf):
    """Each chained curve at 9 equal steps of arc length from its start to its end (mm), with its length."""
    out = []
    for it, flip in chain:
        g = it['g']
        ok_, length = g.evaluator.getLengthAtParameter(it['t0'], it['t1'])
        pts = []
        for i in range(9):
            f = i / 8.0
            if flip:
                f = 1.0 - f
            ok_, prm = g.evaluator.getParameterAtLength(it['t0'], f * length)
            ok_, q = g.evaluator.getPointAtParameter(prm)
            pts.append(xf(tuple(10.0 * c for c in _t(q))))
        out.append({'pts': pts, 'length': 10.0 * length})
    return out


def _cfd_stations(segs, ds=5.0):
    """Stations (printsplit form: p, t, s, run) every ds mm, the straights numbered as runs, for _ps_radii."""
    pts, runs, at = [], [], 0.0
    for k, g in enumerate(segs):
        n = max(2, int(math.ceil(g['length'] / ds)))
        for i in range(n):
            pts.append(TC.point_at(segs, at + g['length'] * i / n)[0])
            runs.append(k if g['kind'] == 'line' else None)
        at += g['length']
    pts.append(segs[-1]['b'])
    runs.append(runs[-1])
    return PS.stations_from_polyline(pts, runs)


def _cfd_inside(body, counter):
    """pointContainment for tubecfd.probe_bore (points in mm), counting the probes."""
    def inside(p):
        counter[0] += 1
        return _ps_inside(body, p)
    return inside


def act_cfd_tube(data):
    """The selected intake tube as the CFD generator's parametric geometry (tubecfd.design_geometry) and the Intake
    tab's inputs for it. data: {mouth: 'auto' | 'other'}: auto = the end whose end face was clicked, or the end nearer
    where the tube was clicked; other = the opposite end."""
    sels = _ui.activeSelections
    items = [sels.item(i) for i in range(sels.count)]
    ents = [it.entity for it in items]
    bodies = _bodies_of([e for e in ents if _kind(e) in ('BRepBody', 'BRepFace', 'MeshBody')])
    if not bodies:
        raise ValueError('Select the intake tube first: click its outside face near the end the air goes in (or that end face). '
                         'If it was not made with Pipe, Ctrl+click its centreline sketch curves too.')
    if len(bodies) > 1:
        raise ValueError('%d bodies are selected: select one intake tube (and its centreline curves, if it was not made with Pipe).' % len(bodies))
    body = bodies[0]
    if _kind(body) != 'BRepBody':
        raise ValueError('That is a mesh body (an STL or a scan): the CFD test reads a solid tube with its centreline.')
    curves = [e for e in ents if _kind(e) == 'sketch']
    xf = lambda p: p
    # the click, read before anything rolls the timeline (which clears the selection); a selection this module put
    # back is not a click, so the last real click on this body stands in for it
    pick = None
    for it in items:
        try:
            if _kind(it.entity) == 'BRepFace' and it.point is not None:
                raw = _t(it.point)
                if tuple(round(c, 6) for c in raw) not in _PS_RESTORED:
                    pick = tuple(10.0 * c for c in raw)
                break
        except Exception:
            continue
    try:
        tok = body.entityToken
    except Exception:
        tok = None
    if pick is not None:
        _CFD_CLICK[tok] = pick
    else:
        pick = _CFD_CLICK.get(tok)
    if not curves:
        occ = None
        try:
            occ = body.assemblyContext
        except Exception:
            pass
        native = (body.nativeObject or body) if occ is not None else body
        curves = _ps_find_path(native)
        xf = _cfd_xf(occ)
    if not curves:
        raise ValueError('No Pipe path found for this tube: Ctrl+click its centreline sketch curves too, then click the button again.')
    chain = _ps_chain(curves)
    segs = TC.join([TC.classify(c['pts'], c['length']) for c in _cfd_samples(chain, xf)])
    r_in, r_out = _ps_radii(body, _cfd_stations(segs))
    L_path = TC.total(segs)
    # the bore all along, probed from the centreline run on past both ends of the path (a cone, cuff or bellmouth
    # joined on past the Pipe path is part of the tube); only the bore is read, so beads on the outside do not matter
    probes, t_read = [0], time.time()
    probe = TC.probe_bore(segs, _cfd_inside(body, probes), r_in, r_out - r_in)
    s0, s1 = probe['s0'] - probe['e0'], probe['s1'] - probe['e0']
    segs = TC.covered(probe)
    L = TC.total(segs)
    # which end the air goes in
    how = 'the first end of its centreline'
    at_end = False
    if pick is not None:
        at_end = TC.nearest_s(segs, pick) > 0.5 * L
        how = 'the end nearer where the tube was clicked'
    if str(data.get('mouth') or 'auto') == 'other':
        at_end = not at_end
        how = 'the other end from ' + how
    if at_end:
        segs = TC.reverse(segs)
    mouth_p, mouth_t = segs[0]['a'], segs[0]['t0']
    tori = []
    for i in range(body.faces.count):
        g = body.faces.item(i).geometry
        if g.surfaceType == adsk.core.SurfaceTypes.TorusSurfaceType:
            tori.append((tuple(10.0 * c for c in _t(g.origin)), _t(g.axis), 10.0 * g.majorRadius, 10.0 * g.minorRadius))
    lip = TC.mouth_lip(tori, mouth_p, mouth_t, r_in)
    geometry, info = TC.design_geometry(segs, 2.0 * r_in, r_out - r_in, lip, profile=TC.profile_from(probe, at_end))
    name = body.name
    msg = TC.describe(info, name) + ' Air enters at %s, at (%s) mm.' % (how, ', '.join('%.1f' % c for c in mouth_p))
    bends = [{'clr_mm': round(b['clr_mm'], 2), 'angle_deg': round(b['angle_deg'], 2), 'start_mm': round(b['start_mm'], 1),
              'plane_deg': round(b['plane_deg'], 1)} for b in info['bends']]
    return {'ok': True, 'msg': msg, 'tube': {'name': name, 'geometry': geometry, 'fill': TC.tab_fill(info), 'bends': bends,
                                             'bore_mm': round(info['bore_mm'], 3), 'od_mm': round(2.0 * r_out, 3), 'wall_mm': round(r_out - r_in, 3),
                                             'length_mm': round(L, 2), 'lip_mm': info['lip_mm'], 'mouth_mm': [round(c, 2) for c in mouth_p],
                                             'mouth_how': how, 'path_beyond_mm': [round(max(0.0, s0), 1), round(max(0.0, L_path - s1), 1)],
                                             'body_beyond_path_mm': [round(max(0.0, -s0), 1), round(max(0.0, s1 - L_path), 1)],
                                             'mouth': info['mouth'], 'cone': info['cone'], 'notes': info['notes'],
                                             'probes': probes[0], 'read_s': round(time.time() - t_read, 2)}}


ACTIONS = {'measure': act_measure, 'setKeepouts': act_set_keepouts, 'clearance': act_clearance,
           'pipe': act_pipe, 'build': act_build, 'centerlines': act_centerlines, 'boom': act_boom,
           'route': act_route, 'jig': act_jig, 'hang': act_hang, 'hangPick': act_hang_pick, 'helmholtz': act_helmholtz, 'chamber': act_chamber, 'revchamber': act_revchamber, 'saveText': act_save_text, 'saveBase64': act_save_base64, 'saveFiles': act_save_files, 'exportCfdStl': act_export_cfd_stl, 'printSplit': act_print_split, 'cfdTube': act_cfd_tube,
           'pageReady': _note('pageReady'), 'probeResult': _note('probeResult'),
           # the page's solver runs on this PC (hostrun.py): OpenWAM without leaving Fusion
           'hostInfo': HR.host_info, 'hostCall': HR.host_call, 'hostChunk': HR.host_chunk, 'hostCancel': HR.host_cancel,
           'findOpenWAM': lambda d: HR.pick_openwam(_ui or adsk.core.Application.get().userInterface)}


def dispatch(action, data_str):
    try:
        data = json.loads(data_str) if data_str else {}
    except ValueError:
        data = {}
    fn = ACTIONS.get(action)
    if not fn:
        return {'ok': False, 'msg': 'Unknown action: %s' % action}
    try:
        return fn(data)
    except ValueError as e:
        return {'ok': False, 'msg': str(e)}
    except Exception:
        return {'ok': False, 'msg': 'Exhaust Tuner hit an error:\n' + traceback.format_exc()}


# --------------------------------------------------------------------------
# Palette and command plumbing
# --------------------------------------------------------------------------

class _PaletteHTML(adsk.core.HTMLEventHandler):
    def notify(self, args):
        try:
            h = adsk.core.HTMLEventArgs.cast(args)
            if h.action == 'response':          # reply to sendInfoToHTML
                if h.data and h.data != 'OK':
                    PAGE_NOTES.append({'kind': 'response', 'data': h.data})
                    del PAGE_NOTES[:-20]
                return
            h.returnData = json.dumps(dispatch(h.action, h.data))
        except Exception:
            try:
                args.returnData = json.dumps({'ok': False, 'msg': traceback.format_exc()})
            except Exception:
                pass


_NavBase = getattr(adsk.core, 'NavigationEventHandler', None)
if _NavBase is not None:
    class _PaletteNav(_NavBase):
        def notify(self, args):
            try:
                a = adsk.core.NavigationEventArgs.cast(args)
                if a.navigationURI.startswith('http'):
                    a.launchExternally = True   # source links open in the normal browser
            except Exception:
                pass
else:
    _PaletteNav = None


def show_palette():
    pal = _ui.palettes.itemById(PALETTE_ID)
    if pal is not None and not pal.isValid:
        pal = None
    if pal is None:
        pal = _ui.palettes.add(PALETTE_ID, 'Exhaust Tuner', HTML_FILE, True, True, True, 460, 820, True)
        try:
            pal.dockingState = adsk.core.PaletteDockingStates.PaletteDockStateRight
        except Exception:
            pass
        h = _PaletteHTML()
        pal.incomingFromHTML.add(h)
        _handlers.append(h)
        if _PaletteNav is not None:
            try:
                nav = _PaletteNav()
                pal.navigatingURL.add(nav)
                _handlers.append(nav)
            except Exception:
                pass
    else:
        pal.isVisible = True
    return pal


class _ShowPalette(adsk.core.CommandEventHandler):
    def notify(self, args):
        try:
            show_palette()
        except Exception:
            _ui.messageBox('Could not open the Exhaust Tuner panel:\n%s' % traceback.format_exc())


class _PanelCreated(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            h = _ShowPalette()
            args.command.execute.add(h)
            _handlers.append(h)
        except Exception:
            _ui.messageBox('Could not start the Exhaust Tuner panel:\n%s' % traceback.format_exc())


HOST_EVENT_ID = 'exhaustTunerHostEvent'
_host_q = []
_host_qlock = __import__('threading').Lock()


class _HostEvent(getattr(adsk.core, 'CustomEventHandler', object)):
    """On Fusion's main thread: send the queued run messages (hostrun.py's threads) to the panel."""
    def notify(self, args):
        with _host_qlock:
            items = _host_q[:]
            del _host_q[:]
        try:
            pal = _ui.palettes.itemById(PALETTE_ID)
        except Exception:
            pal = None
        for kind, payload in items:
            try:
                if pal and pal.isValid:
                    pal.sendInfoToHTML(kind, payload)
            except Exception:
                pass


def _host_post(kind, payload):
    with _host_qlock:
        _host_q.append((kind, json.dumps(payload)))
    try:
        _app.fireCustomEvent(HOST_EVENT_ID, '')
    except Exception:
        pass


def start(app, ui, handlers, panel_id, build_pipe, build_centerlines):
    global _app, _ui, _handlers, _build_pipe, _build_centerlines
    _app, _ui, _handlers = app, ui, handlers
    try:
        try:
            app.unregisterCustomEvent(HOST_EVENT_ID)
        except Exception:
            pass
        ev = app.registerCustomEvent(HOST_EVENT_ID)
        he = _HostEvent()
        ev.add(he)
        handlers.append(he)
        HR._post = _host_post
    except Exception:
        HR._post = None
    _build_pipe, _build_centerlines = build_pipe, build_centerlines
    old = ui.commandDefinitions.itemById(PANEL_CMD_ID)
    if old:
        old.deleteMe()
    cmd_def = ui.commandDefinitions.addButtonDefinition(PANEL_CMD_ID, PANEL_CMD_NAME, PANEL_CMD_TIP, '')
    h = _PanelCreated()
    cmd_def.commandCreated.add(h)
    handlers.append(h)
    panel = ui.allToolbarPanels.itemById(panel_id)
    if panel and not panel.controls.itemById(PANEL_CMD_ID):
        panel.controls.addCommand(cmd_def)


def stop(ui, panel_id):
    try:
        HR.host_cancel()
        adsk.core.Application.get().unregisterCustomEvent(HOST_EVENT_ID)
    except Exception:
        pass
    try:
        pal = ui.palettes.itemById(PALETTE_ID)
        if pal:
            pal.deleteMe()
    except Exception:
        pass
    panel = ui.allToolbarPanels.itemById(panel_id)
    ctrl = panel.controls.itemById(PANEL_CMD_ID) if panel else None
    if ctrl:
        ctrl.deleteMe()
    cmd_def = ui.commandDefinitions.itemById(PANEL_CMD_ID)
    if cmd_def:
        cmd_def.deleteMe()
    _keepouts[:] = []
