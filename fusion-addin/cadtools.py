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
except ImportError:          # loaded as a top-level module (the add-in's folder is on sys.path)
    import router as RT
    import templates as TPL

PALETTE_ID = 'exhaustTunerPalette'
PANEL_CMD_ID = 'exhaustTunerPanelCmd'
PANEL_CMD_NAME = 'Exhaust Tuner Panel'
PANEL_CMD_TIP = 'Open the exhaust calculator beside the model, measure what you select and build tubes along your routes'
# full path, so the panel finds its page however the add-in was started
HTML_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'palette.html').replace('\\', '/')   # backslashes stop the page loading

# CAD library: real part models (STEP) the fitting placer can drop in beside the stand-in. The default is the owner's
# folder; a file named cad_library.txt next to the add-in overrides it with one folder path per line.
CAD_DIRS_DEFAULT = ['C:/Users/<you>/Desktop/claude training books/cad files']


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


def _extrude_section(comp, origin, x, y, z, length, outline, name):
    """Extrude a closed outline drawn in the plane through origin (axes x, y) along z by length."""
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
                     adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
    f.bodies.item(0).name = name
    return f


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
            _revolve_cone(comp, col['start'], col['d_in'], col['end'], col['d_out'], wall, nm)
            built.append({'param': True})
        except Exception:
            body = _cone_shell(col['start'], col['d_in'] / 2.0, col['end'], col['d_out'] / 2.0, wall)
            _add_bodies(comp, [(body, nm + ' (outline)')])
            built.append({'param': False})
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
    mode = data.get('mode') or 'single'
    sp = _route_spec(data)
    mk = _markers()
    notes = []
    title = str(data.get('title') or 'Auto route')
    if mode in ('single', 'parts') and len(mk) != 2:
        raise ValueError('Select two marker lines: one at the start and one at the end. Draw each from the '
                         'centre of the pipe the way the gas flows (a circular edge works too).')
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
            try:
                _revolve_cone(comp, col['start'], col['d_in'], col['end'], col['d_out'], wall, 'Merge collector')
                built.append({'param': True})
            except Exception:
                body = _cone_shell(col['start'], col['d_in'] / 2.0, col['end'], col['d_out'] / 2.0, wall)
                _add_bodies(comp, [(body, 'Merge collector (outline)')])
                built.append({'param': False})
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
    allok = all(it.get('ok', True) for it in items)
    if built and not all(b.get('param') for b in built):
        msg += (' Some geometry could not be made as editable sketches and features, so it was added as '
                'fixed bodies; those parts will not follow parameter changes.')
    elif built:
        msg += (' Everything%s is sketch-driven: tube size and wall follow the user parameters named after '
                'the build, and each centreline sketch can be edited.' % (' but the coped end' if coped else ''))
    return {'ok': True, 'msg': msg, 'items': items, 'route_ok': allok,
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


ACTIONS = {'measure': act_measure, 'setKeepouts': act_set_keepouts, 'clearance': act_clearance,
           'pipe': act_pipe, 'build': act_build, 'centerlines': act_centerlines, 'boom': act_boom,
           'route': act_route, 'helmholtz': act_helmholtz, 'saveText': act_save_text, 'saveFiles': act_save_files, 'exportCfdStl': act_export_cfd_stl,
           'pageReady': _note('pageReady'), 'probeResult': _note('probeResult')}


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


def start(app, ui, handlers, panel_id, build_pipe, build_centerlines):
    global _app, _ui, _handlers, _build_pipe, _build_centerlines
    _app, _ui, _handlers = app, ui, handlers
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
