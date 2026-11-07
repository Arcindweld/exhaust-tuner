"""Live check of "Split the selected tube for printing" in Fusion (run it as a Fusion script, or through the Fusion MCP).
Makes a throw-away design: a 4 in x 4.5 mm-wall tube made with Pipe along 300 mm straight, a 90 degree bend on 127 mm
radius and 300 mm straight; selects its outside face and runs cadtools.act_print_split for a 256 mm bed. Checks, in
Fusion's own numbers: more than one piece, the pieces do not overlap, every piece fits the bed standing on its end
(its STL's box), the bore is clear along the whole tube (no piece inside the bore radius) and nothing sticks out past
the outside, the joint gaps are the only volume lost, and the STLs were written. Prints JSON, closes the design."""
import importlib.util
import json
import math
import os
import struct
import sys
import traceback

import adsk.core
import adsk.fusion

_DONE = []


def run(_context=None):
    if _DONE:
        return _DONE[0]
    _DONE.append(None)
    app = adsk.core.Application.get()
    ui = app.userInterface
    out = {'tests': {}}
    doc = None
    try:
        folder = os.path.join(os.environ['APPDATA'], 'Autodesk', 'Autodesk Fusion 360', 'API', 'AddIns', 'ExhaustTuner')
        if folder not in sys.path:
            sys.path.insert(0, folder)
        for mod in ('router', 'templates', 'printsplit'):
            sys.modules.pop(mod, None)
        spec = importlib.util.spec_from_file_location('cadtools_live_printsplit', os.path.join(folder, 'cadtools.py'))
        ct = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(ct)
        ct._app, ct._ui = app, ui
        doc = app.documents.add(adsk.core.DocumentTypes.FusionDesignDocumentType)
        des = adsk.fusion.Design.cast(app.activeProduct)
        root = des.rootComponent
        P = adsk.core.Point3D.create
        sk = root.sketches.add(root.xYConstructionPlane)
        sk.name = 'path'
        L1, R = 30.0, 12.7
        l1 = sk.sketchCurves.sketchLines.addByTwoPoints(P(0, 0, 0), P(L1, 0, 0))
        arc = sk.sketchCurves.sketchArcs.addByCenterStartSweep(P(L1, R, 0), P(L1, 0, 0), math.pi / 2)
        l2 = sk.sketchCurves.sketchLines.addByTwoPoints(arc.endSketchPoint.geometry, P(L1 + R, R + L1, 0))
        path = adsk.fusion.Path.create(l1, adsk.fusion.ChainedCurveOptions.connectedChainedCurves)
        pin = root.features.pipeFeatures.createInput(path, adsk.fusion.FeatureOperations.NewBodyFeatureOperation)
        pin.sectionSize = adsk.core.ValueInput.createByString('4 in')
        pin.isHollow = True
        pin.sectionThickness = adsk.core.ValueInput.createByString('4.5 mm')
        pf = root.features.pipeFeatures.add(pin)
        body = pf.bodies.item(0)
        body.name = 'TUBE'
        v0 = body.volume
        face = max((f for f in body.faces if f.geometry.surfaceType == adsk.core.SurfaceTypes.CylinderSurfaceType),
                   key=lambda f: f.geometry.radius)
        ui.activeSelections.clear()
        ui.activeSelections.add(face)
        res = ct.act_print_split({'bed_x_mm': 256, 'bed_y_mm': 256, 'bed_z_mm': 256, 'lap_mm': 20, 'clearance_mm': 0.15, 'density': 1.23})
        r = {'msg': res.get('msg'), 'ok_reported': bool(res.get('ok'))}
        sp = res.get('split') or {}
        pieces = [b for b in root.bRepBodies if b.isSolid and 'PRINT' in b.name]
        r['pieces'] = [(b.name, round(b.volume, 2)) for b in pieces]
        r['ok_split'] = len(pieces) >= 2
        tbm = adsk.fusion.TemporaryBRepManager.get()
        clash = 0.0
        for i in range(len(pieces)):
            for j in range(i + 1, len(pieces)):
                x = tbm.copy(pieces[i])
                if tbm.booleanOperation(x, tbm.copy(pieces[j]), adsk.fusion.BooleanTypes.IntersectionBooleanType):
                    clash += x.volume
        r['ok_no_overlap'] = clash < 1e-6
        # bore and outside: probe round the centreline every 5 mm
        r_in, r_out = sp.get('bore_mm', 92.6) / 20.0, sp.get('od_mm', 101.6) / 20.0
        bad_bore = bad_out = 0
        ev = []
        for c in (l1, arc, l2):
            g = c.worldGeometry
            ok_, t0, t1 = g.evaluator.getParameterExtents()
            for k in range(0, 31):
                ok_, p = g.evaluator.getPointAtParameter(t0 + (t1 - t0) * k / 30.0)
                ok_, d = g.evaluator.getFirstDerivative(t0 + (t1 - t0) * k / 30.0)
                ev.append((p, d))
        for p, d in ev:
            n = math.sqrt(d.x ** 2 + d.y ** 2 + d.z ** 2)
            t = (d.x / n, d.y / n, d.z / n)
            u = (-t[1], t[0], 0.0)
            for a in range(8):
                ca, sa = math.cos(a * math.pi / 4), math.sin(a * math.pi / 4)
                w = (ca * u[0], ca * u[1], sa)
                for rr, kind in ((r_in - 0.01, 'bore'), (r_out + 0.01, 'out')):
                    q = P(p.x + rr * w[0], p.y + rr * w[1], p.z + rr * w[2])
                    hit = any(b.pointContainment(q) == adsk.fusion.PointContainment.PointInsidePointContainment for b in pieces)
                    if hit and kind == 'bore':
                        bad_bore += 1
                    if hit and kind == 'out':
                        bad_out += 1
        r['ok_bore_clear'] = bad_bore == 0
        r['ok_outside_flush'] = bad_out == 0
        lost = v0 - sum(b.volume for b in pieces)
        gap = len(sp.get('cuts') or []) * math.pi * ((r_in + r_out) / 2.0) * 2 * 0.015 * 2.0
        r['volume_lost_cm3'], r['gap_cm3'] = round(lost, 3), round(gap, 3)
        r['ok_volume'] = abs(lost - gap) < 0.6 * gap + 0.2
        files = [os.path.join(sp.get('folder', ''), b.name + '.stl') for b in pieces]
        boxes = []
        for f in files:
            if not os.path.isfile(f):
                boxes.append(None)
                continue
            data = open(f, 'rb').read()
            n = struct.unpack('<I', data[80:84])[0]
            mn, mx = [1e9] * 3, [-1e9] * 3
            for t in range(n):
                vals = struct.unpack('<9f', data[84 + 50 * t + 12:84 + 50 * t + 48])
                for k in range(3):
                    for j in range(3):
                        mn[j] = min(mn[j], vals[3 * k + j]); mx[j] = max(mx[j], vals[3 * k + j])
            boxes.append([round(mx[j] - mn[j], 1) for j in range(3)])
        r['stl_boxes_mm'] = boxes
        r['ok_stls'] = all(b is not None for b in boxes)
        r['ok_fit_bed'] = all(b and b[2] <= 253 and max(b[0], b[1]) <= 250 for b in boxes)
        r['ok'] = all(v for k, v in r.items() if k.startswith('ok_'))
        out['tests']['print_split'] = r
        out['ok'] = r['ok']
    except Exception:
        out['error'] = traceback.format_exc()
    finally:
        if doc is not None and not os.environ.get('ET_KEEP_DOC'):
            try:
                doc.close(False)
            except Exception:
                pass
    print(json.dumps(out, indent=1, default=str))
    _DONE[0] = out
    return out


run()
