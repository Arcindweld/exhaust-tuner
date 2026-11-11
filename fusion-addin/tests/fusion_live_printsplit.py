"""Live check of "Split the selected tube for printing" in Fusion (run it as a Fusion script, or through the Fusion MCP).
Makes a throw-away design: a 4 in x 4.5 mm-wall (101.6 x 0.177 in) tube made with the add-in's own Pipe helper along
300 mm (11.8 in) straight, a 90 degree bend on 127 mm (5 in) radius and 300 mm straight; selects its outside face and
runs cadtools.act_print_split for a 256 mm (10.1 in) bed. Checks, in Fusion's own numbers: the tube came out 4 in, the
split found its bore and outside, more than one piece, the pieces do not overlap, a "Print split" timeline group, every
piece fits the bed standing on its end (its STL's box, its lowest point on the bed), the bore is clear and nothing
sticks out past the outside along the whole tube, the wall is there just inside both, every chamfer was made, the
volume lost is the epoxy gaps plus the tip chamfers less the shoulder fills (within 10%), and the gluing check list has
a row per joint. Prints JSON (the failing ok_ keys say what broke), closes the design (set ET_KEEP_DOC=1 to keep it)."""
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
    r = {}
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
        lines = sk.sketchCurves.sketchLines
        l1 = lines.addByTwoPoints(P(0, 0, 0), P(L1, 0, 0))
        # each curve starts on the last one's end SketchPoint, so the path is one connected chain (coincident
        # Point3Ds would make separate, unconnected sketch points)
        arc = sk.sketchCurves.sketchArcs.addByCenterStartSweep(P(L1, R, 0), l1.endSketchPoint, math.pi / 2)
        l2 = lines.addByTwoPoints(arc.endSketchPoint, P(L1 + R, R + L1, 0))
        path = adsk.fusion.Path.create(l1, adsk.fusion.ChainedCurveOptions.connectedChainedCurves)
        r['path_curves'] = path.count
        # the add-in's own Pipe helper: it checks Fusion took the section size as the diameter
        pf = ct._pipe(root, path, 10.16, 0.45)
        body = pf.bodies.item(0)
        body.name = 'TUBE'
        v0 = body.volume
        face = max((body.faces.item(i) for i in range(body.faces.count)
                    if body.faces.item(i).geometry.surfaceType == adsk.core.SurfaceTypes.CylinderSurfaceType),
                   key=lambda f: f.geometry.radius)
        r['od_mm_made'] = round(20.0 * face.geometry.radius, 2)
        ui.activeSelections.clear()
        ui.activeSelections.add(face)
        res = ct.act_print_split({'bed_x_mm': 256, 'bed_y_mm': 256, 'bed_z_mm': 256, 'lap_mm': 20, 'clearance_mm': 0.15, 'density': 1.23})
        r.update({'msg': res.get('msg'), 'ok_reported': bool(res.get('ok'))})
        sp = res.get('split') or {}
        # act_print_split names the pieces '<body name> PRINT <n>'; the cut tools are open (surface) bodies
        pieces = [root.bRepBodies.item(i) for i in range(root.bRepBodies.count)
                  if root.bRepBodies.item(i).isSolid and root.bRepBodies.item(i).name.startswith('TUBE PRINT ')]
        r['ok_od_made'] = abs(r['od_mm_made'] - 101.6) < 0.01
        r['ok_bore_od_found'] = abs(sp.get('bore_mm', 0) - 92.6) < 0.05 and abs(sp.get('od_mm', 0) - 101.6) < 0.05
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
        r['ok_split_group'] = any(des.timeline.timelineGroups.item(i).name == 'Print split' for i in range(des.timeline.timelineGroups.count))
        # bore and outside: probe round the centreline every 10 mm, offset so no probe sits on a cut plane (a point on a
        # face is not 'inside' anything); the wall itself must be there just inside the bore and the outside
        r_in, r_out = sp.get('bore_mm', 92.6) / 20.0, sp.get('od_mm', 101.6) / 20.0     # diameter mm -> radius cm
        bad = {'bore': 0, 'out': 0, 'wall_in': 0, 'wall_out': 0}
        ev = []
        for c in (l1, arc, l2):
            g = c.worldGeometry
            ok_, t0, t1 = g.evaluator.getParameterExtents()
            for k in range(0, 30):
                f = t0 + (t1 - t0) * (k + 0.37) / 30.0
                ok_, p = g.evaluator.getPointAtParameter(f)
                ok_, d = g.evaluator.getFirstDerivative(f)
                ev.append((p, d))
        INSIDE = adsk.fusion.PointContainment.PointInsidePointContainment
        for p, d in ev:
            n = math.sqrt(d.x ** 2 + d.y ** 2 + d.z ** 2)
            t = (d.x / n, d.y / n, d.z / n)
            u = (-t[1], t[0], 0.0)
            for a in range(8):
                ca, sa = math.cos(a * math.pi / 4 + 0.2), math.sin(a * math.pi / 4 + 0.2)
                w = (ca * u[0], ca * u[1], sa)
                for rr, kind, want in ((r_in - 0.01, 'bore', False), (r_out + 0.01, 'out', False),
                                       (r_in + 0.05, 'wall_in', True), (r_out - 0.05, 'wall_out', True)):
                    q = P(p.x + rr * w[0], p.y + rr * w[1], p.z + rr * w[2])
                    hit = any(b.pointContainment(q) == INSIDE for b in pieces)
                    if hit != want:
                        bad[kind] += 1
        r['probe_misses'] = bad
        r['ok_bore_clear'] = bad['bore'] == 0
        r['ok_outside_flush'] = bad['out'] == 0
        r['ok_wall_continuous'] = bad['wall_in'] == 0 and bad['wall_out'] == 0
        # the only volume lost: the epoxy gap over each lap, and the tongue tip's chamfer less the shoulder's fill
        # (each a 45 degree ring of side c round its edge: pi c^2 (r + c/3) in cm3)
        lost = v0 - sum(b.volume for b in pieces)
        jr = ct.PS.joint_radii(10.0 * r_in, 10.0 * r_out, 0.15)
        a_, b_, sh, tip, Lc = jr['tongue_in'] / 10, jr['tongue_out'] / 10, jr['shoulder'] / 10, jr['tip'] / 10, 2.0
        per = math.pi * (b_ ** 2 - a_ ** 2) * Lc + math.pi * tip ** 2 * (b_ + tip / 3) - math.pi * sh ** 2 * (a_ + sh / 3)
        want = len(sp.get('cuts') or []) * per
        r['volume_lost_cm3'], r['volume_expected_cm3'] = round(lost, 3), round(want, 3)
        r['ok_volume'] = len(sp.get('cuts') or []) > 0 and abs(lost - want) < 0.1 * want + 0.05
        r['ok_no_notes'] = not sp.get('notes')          # every chamfer made, no warnings for a 4.5 mm wall
        r['ok_assembly'] = len((sp.get('assembly') or {}).get('joints') or []) == len(sp.get('cuts') or []) > 0
        files = [os.path.join(sp.get('folder', ''), b.name + '.stl') for b in pieces]
        mins = []
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
            mins.append(round(mn[2], 3))
        r['stl_boxes_mm'] = boxes
        r['ok_stls'] = all(b is not None for b in boxes)
        r['ok_fit_bed'] = bool(boxes) and all(b and b[2] <= 253 and max(b[0], b[1]) <= 250 for b in boxes)
        r['ok_stl_on_bed'] = bool(mins) and all(abs(m) < 0.01 for m in mins)
        r['ok'] = all(v for k, v in r.items() if k.startswith('ok_'))
        out['ok'] = r['ok']
    except Exception:
        out['error'] = traceback.format_exc()
        out['ok'] = False
    finally:
        if doc is not None and not os.environ.get('ET_KEEP_DOC'):
            try:
                doc.close(False)
            except Exception:
                pass
    out['tests']['print_split'] = r
    print(json.dumps(out, indent=1, default=str))
    _DONE[0] = out
    return out


run()
