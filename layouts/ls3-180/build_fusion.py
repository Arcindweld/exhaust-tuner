"""Build the LS3 180-degree headers-back exhaust in Fusion from ls3_180.json (run inside Fusion via the MCP).
Stages: 'keepouts' (new design, reference solids, markers), 'headerA', 'headerB', 'down' (collector pipes,
mufflers, tailpipes), 'params' (summary). Each stage is one script call so none runs long."""
import adsk.core, adsk.fusion, json, sys, os, math, importlib, traceback

STAGE = '__STAGE__'
ADDIN_DIR = os.path.join(os.environ.get('APPDATA', ''), 'Autodesk', 'Autodesk Fusion 360', 'API', 'AddIns', 'ExhaustTuner')
JSON_PATH = os.path.join(ADDIN_DIR, 'ls3_180.json')
DOC_NAME = 'LS3 180-degree headers-back'
IN = 2.54


def _ct(app, ui):
    p = ADDIN_DIR
    if p not in sys.path:
        sys.path.insert(0, p)
    import cadtools as CT
    import router as RT
    CT._app, CT._ui = app, ui
    return CT, RT


def _design(app):
    return adsk.fusion.Design.cast(app.activeProduct)


def _comp(design, name):
    root = design.rootComponent
    for i in range(root.occurrences.count):
        c = root.occurrences.item(i).component
        if c.name == name:
            return c
    occ = root.occurrences.addNewComponent(adsk.core.Matrix3D.create())
    occ.component.name = name
    return occ.component


def _P(p):
    return adsk.core.Point3D.create(float(p[0]), float(p[1]), float(p[2]))


def _V(v):
    return adsk.core.Vector3D.create(float(v[0]), float(v[1]), float(v[2]))


def _uparam(design, name, value_cm, unit, comment):
    ups = design.userParameters
    p = ups.itemByName(name)
    expr = ('%.4f mm' % (value_cm * 10.0)) if unit == 'mm' else ('%.4f in' % (value_cm / IN))
    if p:
        p.expression = expr
    else:
        ups.add(name, adsk.core.ValueInput.createByString(expr), unit, comment)
    return name


def _add_temp_bodies(comp, named):
    des = _design(adsk.core.Application.get())
    bf = comp.features.baseFeatures.add()
    bf.startEdit()
    n0 = comp.bRepBodies.count
    try:
        for body, name in named:
            comp.bRepBodies.add(body, bf)
    finally:
        bf.finishEdit()
    out = [comp.bRepBodies.item(i) for i in range(n0, comp.bRepBodies.count)]
    for b, (_body, name) in zip(out, named):
        try:
            b.name = name
        except Exception:
            pass
    return out


def stage_keepouts(app, ui, D):
    doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
    des = _design(app)
    des.designType = adsk.fusion.DesignTypes.ParametricDesignType
    try:
        doc.name = DOC_NAME
    except Exception:
        pass
    root = des.rootComponent
    P = D['params']
    # user parameters (inches, as the parts are sold)
    _uparam(des, 'Primary_OD', P['od_in'] * IN, 'in', '1.875 in 16 ga tube, Stainless Bros / SHM mandrel bends (Exhaust Tuner)')
    _uparam(des, 'Primary_wall', P['wall_in'] * IN, 'in', '16 gauge')
    _uparam(des, 'Primary_CLR', P['clr_in'] * IN, 'in', 'bend centreline radius, 1.5D mandrel bends')
    _uparam(des, 'Primary_length', P['target_in'] * IN, 'in', 'flange to merge, every tube (re-route in Exhaust Tuner to change)')
    _uparam(des, 'Collector_outlet', P['coll_out_in'] * IN, 'in', '4-1 merge collector outlet')
    _uparam(des, 'Collector_length', P['coll_len_in'] * IN, 'in', 'merge cone length')
    _uparam(des, 'Pipe_OD', 3.0 * IN, 'in', 'collector-back pipe, 3 in 16 ga')
    _uparam(des, 'Pipe_wall', 0.065 * IN, 'in', '16 gauge')
    _uparam(des, 'Pipe_to_muffler', 12.0 * IN, 'in', 'straight from the collector outlet to the muffler inlet')
    _uparam(des, 'Muffler_body_length', 15.0 * IN, 'in', 'Stainless Bros 3 in race muffler 17 in OAL: 15 in body')
    _uparam(des, 'Muffler_body_dia', 5.0 * IN, 'in', 'round body (oval option: 4 x 9 in)')
    _uparam(des, 'Tailpipe_length', 20.0 * IN, 'in', 'muffler outlet to the tip')
    _uparam(des, 'Tip_length', 4.0 * IN, 'in', 'slash or straight-cut tip beyond the tailpipe')
    ko = _comp(des, 'Keep-outs (LS3, driveline, floor): replace with your scan')
    tmp = adsk.fusion.TemporaryBRepManager.get()
    named = []
    for s in D['solids']:
        k, p, nm = s['kind'], s['p'], s['name']
        if k == 'box':
            lo, hi = p['lo'], p['hi']
            c = [(lo[i] + hi[i]) / 2.0 for i in range(3)]
            obb = adsk.core.OrientedBoundingBox3D.create(_P(c), _V((1, 0, 0)), _V((0, 1, 0)), hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
            named.append((tmp.createBox(obb), nm))
        elif k == 'obb':
            h = p['half']
            obb = adsk.core.OrientedBoundingBox3D.create(_P(p['center']), _V(p['ex']), _V(p['ey']), 2 * h[0], 2 * h[1], 2 * h[2])
            named.append((tmp.createBox(obb), nm))
        elif k == 'cylx':
            a = _P((p['x0'], p.get('cy', 0.0), p.get('cz', 0.0)))
            b = _P((p['x1'], p.get('cy', 0.0), p.get('cz', 0.0)))
            named.append((tmp.createCylinderOrCone(a, p['r'], b, p['r']), nm))
    bodies = _add_temp_bodies(ko, named)
    # port and collector markers (sketch lines from the centre the way the gas flows) for re-routing with the add-in
    mk = _comp(des, 'Markers: ports and collectors (select these to re-route)')
    sk = mk.sketches.add(mk.xYConstructionPlane)
    sk.name = 'Route markers'
    lines = sk.sketchCurves.sketchLines
    for c, pt in sorted(D['ports'].items(), key=lambda kv: int(kv[0])):
        p0 = pt['p']; d = pt['d']
        p1 = [p0[i] + d[i] * 3.0 for i in range(3)]
        lines.addByTwoPoints(sk.modelToSketchSpace(_P(p0)), sk.modelToSketchSpace(_P(p1)))
    for tag, col in D['collectors'].items():
        p1 = col['point']; d = col['dir']
        p0 = [p1[i] - d[i] * 3.0 for i in range(3)]
        lines.addByTwoPoints(sk.modelToSketchSpace(_P(p0)), sk.modelToSketchSpace(_P(p1)))
    return {'doc': app.activeDocument.name, 'keepouts': len(bodies), 'markers': lines.count}


def stage_header(app, ui, D, tag):
    CT, RT = _ct(app, ui)
    des = _design(app)
    col = D['collectors'][tag]
    P = D['params']
    od, wall = P['od_in'] * IN, P['wall_in'] * IN
    name = 'Header %s: cylinders %s' % (tag, '-'.join(str(c) for c in col['cyls']))
    comp = _comp(des, name)
    built = []
    for pr in col['primaries']:
        if not pr.get('elems'):
            built.append({'cyl': pr['cyl'], 'built': False, 'msg': pr.get('msg')})
            continue
        elems = [tuple(e) if isinstance(e, list) else e for e in pr['elems']]
        elems = [tuple(tuple(x) if isinstance(x, list) else x for x in e) for e in elems]
        r = dict(pr, elems=elems)
        nm = 'Primary cyl %d' % pr['cyl']
        try:
            b = CT._build_route(comp, r, nm, od, wall, 'Primary')
            built.append({'cyl': pr['cyl'], 'built': True, 'how': b.get('path'), 'param': b.get('param'), 'length_in': round(pr['length'] / IN, 2)})
        except Exception as ex:
            built.append({'cyl': pr['cyl'], 'built': False, 'error': str(ex)[:200]})
    # header flange: one 3/8 in plate per bank on the head face over its four ports (LS flanges from Stainless Headers
    # Mfg / Stainless Bros: about 19.4 in long, 3.5 in tall, 1.875 in ports). Collector A sits on the left, B on the right.
    side = 1 if col['point'][1] > 0 else -1
    bank_ports = [D['ports'][str(c)] for c in (1, 3, 5, 7)] if side > 0 else [D['ports'][str(c)] for c in (2, 4, 6, 8)]
    try:
        tmp = adsk.fusion.TemporaryBRepManager.get()
        pc = [sum(pt['p'][k] for pt in bank_ports) / 4.0 for k in range(3)]
        n = bank_ports[0]['d']
        # face frame: ex along X, ey = port direction (plate thickness), ez = in the face, upward
        th = 0.375 * IN
        centre = [pc[k] + n[k] * th / 2.0 for k in range(3)]
        obb = adsk.core.OrientedBoundingBox3D.create(_P(centre), _V((1, 0, 0)), _V(n), 19.4 * IN, th, 3.5 * IN)
        plate = tmp.createBox(obb)
        # port holes
        for pt in bank_ports:
            a = _P([pt['p'][k] - n[k] * 1.0 for k in range(3)]); b = _P([pt['p'][k] + n[k] * (th + 1.0) for k in range(3)])
            hole = tmp.createCylinderOrCone(a, od / 2.0, b, od / 2.0)
            tmp.booleanOperation(plate, hole, adsk.fusion.BooleanTypes.DifferenceBooleanType)
        _add_temp_bodies(comp, [(plate, 'Header flange %s bank (3/8 in, 4 x 1.875 in ports)' % ('left' if side > 0 else 'right'))])
        flange_ok = True
    except Exception as ex:
        flange_ok = str(ex)[:200]
    cone = col['cone']
    try:
        CT._revolve_cone(comp, tuple(cone['start']), cone['d_in'], tuple(cone['end']), cone['d_out'], wall, 'Merge collector %s (4-1, 1.875 in to 3 in)' % tag)
        cone_ok = True
    except Exception as ex:
        cone_ok = str(ex)[:200]
    return {'component': name, 'primaries': built, 'cone': cone_ok, 'flange': flange_ok}


def stage_down(app, ui, D):
    """Collector outlet -> straight 3 in pipe -> muffler -> tailpipe -> tip, each length a user parameter."""
    CT, RT = _ct(app, ui)
    des = _design(app)
    out = {}
    for tag, col in D['collectors'].items():
        side = 'left' if col['point'][1] > 0 else 'right'
        comp = _comp(des, 'Collector-back %s: 3 in pipe, muffler, tailpipe' % side)
        end = col['cone']['end']
        d = col['dir']
        # one sketch with the centreline as four collinear lines, each dimensioned by a parameter
        sk = comp.sketches.add(comp.xYConstructionPlane)   # the centreline lies in z = const; use a plane through it
        sk.deleteMe()
        pl_in = comp.constructionPlanes.createInput()
        pl_in.setByOffset(comp.xYConstructionPlane, adsk.core.ValueInput.createByReal(float(end[2])))
        plane = comp.constructionPlanes.add(pl_in)
        plane.name = 'Collector-back centreline plane %s' % side
        sk = comp.sketches.add(plane)
        sk.name = 'Collector-back centreline %s' % side
        S = lambda p: sk.modelToSketchSpace(_P(p))
        lines = sk.sketchCurves.sketchLines
        dims = sk.sketchDimensions
        segs = [('Pipe_to_muffler', 'pipe'), ('Muffler_body_length', 'muffler'), ('Tailpipe_length', 'tail'), ('Tip_length', 'tip')]
        p = list(end)
        made = []
        prev = None
        for pname, kind in segs:
            L = des.userParameters.itemByName(pname).value
            q = [p[i] + d[i] * L for i in range(3)]
            ln = lines.addByTwoPoints(prev.endSketchPoint if prev else S(p), S(q))
            if prev is None:
                ln.startSketchPoint.isFixed = True
            dm = dims.addDistanceDimension(ln.startSketchPoint, ln.endSketchPoint,
                                           adsk.fusion.DimensionOrientations.AlignedDimensionOrientation,
                                           S([ (p[0] + q[0]) / 2.0, p[1] + 3.0, p[2] ]))
            try:
                dm.parameter.expression = pname
            except Exception:
                pass
            try:
                sk.geometricConstraints.addHorizontal(ln)
            except Exception:
                pass
            made.append((ln, kind, p, q))
            prev = ln
            p = q
        # pipes: one pipe feature per straight (the muffler's inlet/outlet necks are the neighbouring pipes)
        pipes = comp.features.pipeFeatures
        n = 0
        for ln, kind, p0, p1 in made:
            if kind == 'muffler':
                continue
            path = adsk.fusion.Path.create(CT._ctx(comp, ln), adsk.fusion.ChainedCurveOptions.noChainedCurves)
            inp = pipes.createInput(path, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
            inp.sectionSize = adsk.core.ValueInput.createByString('Pipe_OD')
            inp.sectionThickness = adsk.core.ValueInput.createByString('Pipe_wall')
            f = pipes.add(inp)
            try:
                f.bodies.item(0).name = {'pipe': 'Collector outlet pipe', 'tail': 'Tailpipe', 'tip': 'Tip'}[kind] + ' ' + side
            except Exception:
                pass
            n += 1
        # muffler body: a circle on a plane at the muffler inlet, extruded by the body length parameter
        ln, kind, p0, p1 = made[1]
        pin = comp.constructionPlanes.createInput()
        pin.setByDistanceOnPath(CT._ctx(comp, ln), adsk.core.ValueInput.createByReal(0.0))
        mp = comp.constructionPlanes.add(pin)
        mp.name = 'Muffler inlet plane %s' % side
        msk = comp.sketches.add(mp)
        msk.name = 'Muffler body %s' % side
        c = msk.modelToSketchSpace(_P(p0))
        msk.sketchCurves.sketchCircles.addByCenterRadius(c, des.userParameters.itemByName('Muffler_body_dia').value / 2.0)
        prof = msk.profiles.item(0)
        ex = comp.features.extrudeFeatures
        ei = ex.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        # extrude along the flow: the plane normal may point either way, so pick the sign from a test
        dist = adsk.fusion.DistanceExtentDefinition.create(adsk.core.ValueInput.createByString('Muffler_body_length'))
        ei.setOneSideExtent(dist, adsk.fusion.ExtentDirections.PositiveExtentDirection)
        f = ex.add(ei)
        bb = f.bodies.item(0).boundingBox
        mid_x = (bb.minPoint.x + bb.maxPoint.x) / 2.0
        want_x = (p0[0] + p1[0]) / 2.0
        if abs(mid_x - want_x) > 1.0:
            f.deleteMe()
            ei = ex.createInput(prof, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
            ei.setOneSideExtent(adsk.fusion.DistanceExtentDefinition.create(adsk.core.ValueInput.createByString('Muffler_body_length')),
                                adsk.fusion.ExtentDirections.NegativeExtentDirection)
            f = ex.add(ei)
        f.bodies.item(0).name = 'Muffler body %s (straight-through, 3 in in/out)' % side
        out[side] = {'pipes': n, 'muffler': True}
    return out


def run(ctx=None):
    app = adsk.core.Application.get()
    ui = app.userInterface
    res = {'stage': STAGE}
    try:
        D = json.load(open(JSON_PATH))
        if STAGE == 'keepouts':
            res.update(stage_keepouts(app, ui, D))
        elif STAGE in ('headerA', 'headerB'):
            res.update(stage_header(app, ui, D, STAGE[-1]))
        elif STAGE == 'down':
            res.update(stage_down(app, ui, D))
        try:
            app.activeViewport.fit()
        except Exception:
            pass
    except Exception:
        res['error'] = traceback.format_exc()
    s = json.dumps(res, default=str)
    print(s)
    return s
